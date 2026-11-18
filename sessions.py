"""Postgres demo sessions, quotas, jobs and complete collection deletion."""
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
import hashlib
import hmac
import json
import os
import re
from pathlib import Path
import secrets
import shutil
import threading
import time

import psycopg
from psycopg import sql
from psycopg.rows import dict_row

import config
import protection
import level1
import session_store
import watchdog

# Fixed stripes avoid retaining per-session objects after deletion.
_locks = [threading.RLock() for _ in range(64)]
_trace_lock = threading.Lock()
_next_sweep = float("inf")
_sweep_revision = 0
_trace_day = None
_next_orphan_sweep = float("inf")


class SessionError(Exception):
    def __init__(self, status: int, code: str, message: str, rule_id: str | None = None):
        self.status, self.code, self.message = status, code, message
        self.rule_id = rule_id


@contextmanager
def connection():
    conn = level1.postgres_connection(config.PG_DSN)
    conn.row_factory = dict_row
    try:
        with conn.transaction():
            yield conn
    finally:
        conn.close()


def history_tokens(history: list[dict], tokenizer) -> int:
    return level1.token_count(json.dumps(history, ensure_ascii=False), tokenizer) if history else 0


def trim_history(history: list[dict], tokenizer) -> list[dict]:
    trimmed = [dict(q=turn["q"][:300],
                    a=re.sub(r"\[L[123]:[^\]\n]+\]", "", turn["a"]).strip()[:300], ts=turn["ts"])
               for turn in history]
    while trimmed and history_tokens(trimmed, tokenizer) > config.HISTORY_TOKEN_BUDGET:
        trimmed.pop(0)
    return trimmed


def append_history(session_id: str, question: str, result: dict, tokenizer) -> None:
    if not result.get("answer") or not result.get("citation_valid") or result.get("output_blocked"):
        return
    answer = result["answer"]
    for citation in result.get("citations", []):
        answer = answer.replace("[" + citation + "]", "")
    with connection() as conn:
        row = conn.execute("SELECT history,level,status FROM sessions WHERE id=%s FOR UPDATE", (session_id,)).fetchone()
        if not row or row["level"] != 2 or row["status"] != "active":
            return
        turns = row["history"] + [dict(q=question, a=answer, ts=datetime.now(timezone.utc).isoformat())]
        history = trim_history(turns, tokenizer)
        protection.check_deadline()
        conn.execute("UPDATE sessions SET history=%s WHERE id=%s", (psycopg.types.json.Jsonb(history), session_id))
        protection.check_deadline()


def session_lock(session_id: str):
    return _locks[int(hashlib.sha256(session_id.encode()).hexdigest()[:8], 16) % len(_locks)]


def collection_name(session_id: str) -> str:
    return config.validate_collection("s" + hashlib.sha256(session_id.encode()).hexdigest()[:20])


def upload_directory(session_id: str) -> Path:
    return config.DATA / "uploads" / collection_name(session_id)


def init_tables() -> None:
    if config.HOSTED_MODE:
        # Owner runs neon_setup.sql; the hosted role cannot migrate schemas.
        with connection() as conn:
            session_store.check_database(conn)
            conn.execute("SELECT data_deleted_at,collection FROM sessions LIMIT 0")
            conn.execute("SELECT document_hash,error_status,error_detail FROM ingest_jobs LIMIT 0")
            conn.execute("SELECT attempts FROM provider_daily_usage LIMIT 0")
        return
    with connection() as conn:
        conn.execute("CREATE EXTENSION IF NOT EXISTS vector")
        conn.execute("""CREATE TABLE IF NOT EXISTS sessions (
            id text PRIMARY KEY, token_hash text, level integer NOT NULL CHECK (level IN (1,2)),
            created_at timestamptz NOT NULL DEFAULT now(), last_active timestamptz NOT NULL DEFAULT now(),
            expires_at timestamptz NOT NULL, status text NOT NULL DEFAULT 'active'
                CHECK (status IN ('active','ended','expired','locked')),
            docs_used integer NOT NULL DEFAULT 0, questions_used integer NOT NULL DEFAULT 0,
            history jsonb NOT NULL DEFAULT '[]', pages_total bigint NOT NULL DEFAULT 0,
            bytes_total bigint NOT NULL DEFAULT 0, llm_calls bigint NOT NULL DEFAULT 0,
            tokens_total bigint NOT NULL DEFAULT 0, guardrail_rejections integer NOT NULL DEFAULT 0,
            end_reason text, ended_at timestamptz)""")
        conn.execute("ALTER TABLE sessions ADD COLUMN IF NOT EXISTS collection text")
        conn.execute("ALTER TABLE sessions ADD COLUMN IF NOT EXISTS data_deleted_at timestamptz")
        conn.execute("ALTER TABLE sessions ADD COLUMN IF NOT EXISTS notice_accepted boolean NOT NULL DEFAULT false")
        conn.execute("CREATE INDEX IF NOT EXISTS sessions_token_hash ON sessions(token_hash)")
        conn.execute("""CREATE TABLE IF NOT EXISTS ingest_jobs (
            id text PRIMARY KEY, session_id text NOT NULL REFERENCES sessions(id),
            status text NOT NULL DEFAULT 'queued', stage text NOT NULL DEFAULT 'queued',
            duplicate boolean NOT NULL DEFAULT false, chunks integer NOT NULL DEFAULT 0,
            flagged_chunks integer NOT NULL DEFAULT 0, error_code text,
            pages integer NOT NULL DEFAULT 0, bytes bigint NOT NULL DEFAULT 0,
            reserved boolean NOT NULL DEFAULT true,
            created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
            finished_at timestamptz)""")
        conn.execute("ALTER TABLE ingest_jobs ADD COLUMN IF NOT EXISTS document_hash text")
        conn.execute("CREATE UNIQUE INDEX IF NOT EXISTS ingest_jobs_running_session ON ingest_jobs(session_id) WHERE status NOT IN ('done','failed')")

        conn.execute("ALTER TABLE sessions ADD COLUMN IF NOT EXISTS failed_attempts integer NOT NULL DEFAULT 0")
        conn.execute("ALTER TABLE ingest_jobs ADD COLUMN IF NOT EXISTS error_status integer")
        conn.execute("ALTER TABLE ingest_jobs ADD COLUMN IF NOT EXISTS error_detail text")
        conn.execute("""CREATE TABLE IF NOT EXISTS provider_daily_usage (
            day date PRIMARY KEY, attempts bigint NOT NULL DEFAULT 0)""")


def capacity_reached() -> None:
    write_trace(dict(event="ask", status_code=503, error_code="demo_capacity_reached"))
    raise SessionError(503, "demo_capacity_reached", "Demo capacity reached, try later")


def check_provider_capacity() -> None:
    with connection() as conn:
        row = conn.execute("SELECT attempts FROM provider_daily_usage WHERE day=(now() AT TIME ZONE 'UTC')::date").fetchone()
    if (row["attempts"] if row else 0) >= config.GLOBAL_DAILY_PROVIDER_ATTEMPTS:
        capacity_reached()


def reserve_provider_attempt() -> None:
    with connection() as conn:
        # CLI/evaluation calls can precede the API's startup migration.
        if not config.HOSTED_MODE:
            conn.execute("""CREATE TABLE IF NOT EXISTS provider_daily_usage (
                day date PRIMARY KEY, attempts bigint NOT NULL DEFAULT 0)""")
        row = conn.execute("""INSERT INTO provider_daily_usage(day, attempts)
            SELECT (now() AT TIME ZONE 'UTC')::date, 1 WHERE %s > 0
            ON CONFLICT (day) DO UPDATE SET attempts=provider_daily_usage.attempts+1
            WHERE provider_daily_usage.attempts < %s RETURNING attempts""",
            (config.GLOBAL_DAILY_PROVIDER_ATTEMPTS, config.GLOBAL_DAILY_PROVIDER_ATTEMPTS)).fetchone()
    if not row:
        capacity_reached()


def get(session_id: str) -> dict:
    with connection() as conn:
        row = conn.execute("SELECT * FROM sessions WHERE id = %s", (session_id,)).fetchone()
    if not row:
        raise SessionError(401, "invalid_token", "Invalid session token")
    return row


def check_active(row: dict) -> None:
    if row["status"] == "ended":
        raise SessionError(410, "session_ended", "Session has ended")
    if row["status"] == "expired" or datetime.now(timezone.utc) >= expiry(row):
        raise SessionError(410, "session_expired", "Session has expired")
    if row["status"] == "locked":
        raise SessionError(403, "session_locked", "Session is locked")


def expiry(row: dict):
    return min(row["expires_at"], row["last_active"] + timedelta(minutes=config.SESSION_IDLE_MINUTES))


def quota(row: dict) -> dict:
    return dict(docs_remaining=max(0, config.SESSION_MAX_DOCS - row["docs_used"]),
                questions_remaining=max(0, config.SESSION_MAX_QUESTIONS - row["questions_used"]),
                expires_at=expiry(row).isoformat(), status=row["status"])


def authenticate(token: str, allow_locked: bool = False) -> dict:
    session_id, separator, _ = token.partition(".")
    if not separator or len(token) > 256:
        raise SessionError(401, "invalid_token", "Invalid session token")
    row = get(session_id)
    # Terminal rows retain only the random public ID and summary, not a token digest.
    if row["status"] in ("ended", "expired"):
        check_active(row)
    digest = hashlib.sha256(token.encode()).hexdigest()
    if not hmac.compare_digest(digest, row["token_hash"] or ""):
        raise SessionError(401, "invalid_token", "Invalid session token")
    try:
        check_active(row)
    except SessionError as exc:
        if exc.code == "session_expired":
            delete_session_data(row, status="expired", reason="ttl")
        if not (exc.code == "session_locked" and allow_locked):
            raise
    with connection() as conn:
        updated = conn.execute("""UPDATE sessions SET last_active=now() WHERE id=%s
            AND status IN ('active','locked') AND token_hash=%s RETURNING *""", (session_id, digest)).fetchone()
    if not updated:
        check_active(get(session_id))
        raise SessionError(401, "invalid_token", "Invalid session token")
    return updated


@contextmanager
def activity(session_id: str):
    with session_lock(session_id):
        row = get(session_id)
        check_active(row)
        with session_store.scope(session_id):
            yield row


def create(level: int) -> dict:
    sweep_expired()
    session_id = secrets.token_urlsafe(16)
    token = session_id + "." + secrets.token_urlsafe(32)
    expires_at = datetime.now(timezone.utc) + timedelta(minutes=config.SESSION_ABSOLUTE_MINUTES)
    with level1._ingest_lock, connection() as conn:
        protection.check_deadline()
        count = conn.execute("SELECT count(*) AS count FROM sessions WHERE status IN ('active','locked')").fetchone()["count"]
        if count >= config.MAX_ACTIVE_SESSIONS:
            capacity_reached()
        check_storage_capacity(conn=conn)
        row = conn.execute("INSERT INTO sessions(id,token_hash,level,expires_at,notice_accepted,collection) VALUES (%s,%s,%s,%s,true,%s) RETURNING *",
                           (session_id, hashlib.sha256(token.encode()).hexdigest(), level, expires_at, collection_name(session_id))).fetchone()
    schedule_sweep()
    return dict(session_id=session_id, token=token, level=level,
                limits=dict(documents=config.SESSION_MAX_DOCS, questions=config.SESSION_MAX_QUESTIONS,
                            upload_bytes=config.DEMO_MAX_UPLOAD_BYTES, pages=config.DEMO_MAX_PAGES,
                            idle_minutes=config.SESSION_IDLE_MINUTES, absolute_minutes=config.SESSION_ABSOLUTE_MINUTES),
                expires_at=expiry(row).isoformat(), notice=config.DEMO_NOTICE)


def reserve_question(session_id: str) -> None:
    with level1._ingest_lock, connection() as conn:
        row = conn.execute("""UPDATE sessions SET questions_used=questions_used+1 WHERE id=%s
            AND status='active' AND expires_at>now()
            AND last_active>now() - make_interval(mins => %s)
            AND questions_used<%s RETURNING id""",
            (session_id, config.SESSION_IDLE_MINUTES, config.SESSION_MAX_QUESTIONS)).fetchone()
    if not row:
        check_active(get(session_id))
        raise SessionError(403, "quota_exceeded", "Question quota exhausted")


def add_strike(session_id: str) -> None:
    with connection() as conn:
        conn.execute("""UPDATE sessions SET guardrail_rejections=guardrail_rejections+1,
            status=CASE WHEN guardrail_rejections+1 >= 3 THEN 'locked' ELSE status END
            WHERE id=%s AND status='active'""", (session_id,))


def finish_question(session_id: str, trace: dict, failed: bool = False) -> None:
    llm = trace.get("llm", {})
    with connection() as conn:
        conn.execute("""UPDATE sessions SET failed_attempts=failed_attempts+%s,
            llm_calls=llm_calls+%s, tokens_total=tokens_total+%s WHERE id=%s""",
            (int(failed), llm.get("llm_calls", 0), llm.get("tokens", {}).get("total", 0), session_id))



def reserve_job(row: dict, pages: int, size: int, duplicate: bool, document_hash: str | None = None) -> str:
    job_id = secrets.token_urlsafe(16)
    with connection() as conn:
        if not duplicate:
            reserved = conn.execute("""UPDATE sessions SET docs_used=docs_used+1 WHERE id=%s
                AND status='active' AND expires_at>now()
                AND last_active>now()-make_interval(mins => %s) AND docs_used<%s RETURNING id""",
                (row["id"], config.SESSION_IDLE_MINUTES, config.SESSION_MAX_DOCS)).fetchone()
            if not reserved:
                raise SessionError(403, "quota_exceeded", "Document quota exhausted")
        conn.execute("""INSERT INTO ingest_jobs(id,session_id,pages,bytes,reserved,duplicate,document_hash)
            VALUES (%s,%s,%s,%s,%s,%s,%s)""", (job_id, row["id"], pages, size, not duplicate, duplicate, document_hash))
    return job_id


def get_job(job_id: str, session_id: str) -> dict:
    with connection() as conn:
        row = conn.execute("SELECT * FROM ingest_jobs WHERE id=%s AND session_id=%s", (job_id, session_id)).fetchone()
    if not row:
        raise SessionError(401, "invalid_token", "Job is unavailable to this session")
    return {key: row[key] for key in ("status", "stage", "duplicate", "chunks", "flagged_chunks", "error_code", "error_status", "error_detail")}


def progress(job_id: str, stage: str) -> None:
    with connection() as conn:
        conn.execute("UPDATE ingest_jobs SET status=%s,stage=%s,updated_at=now() WHERE id=%s", (stage, stage, job_id))


def finish_job(job_id: str, result: dict | None = None, error_code: str | None = None,
               error_status: int | None = None, error_detail: str | None = None) -> None:
    result = result or {}
    with connection() as conn:
        job = conn.execute("SELECT * FROM ingest_jobs WHERE id=%s FOR UPDATE", (job_id,)).fetchone()
        if not job or job["status"] in ("done", "failed"):
            return
        refund = job["reserved"] and (error_code is not None or result.get("duplicate", False))
        conn.execute("""UPDATE sessions SET docs_used=GREATEST(0,docs_used-%s),
            pages_total=pages_total+%s, bytes_total=bytes_total+%s WHERE id=%s""",
            (int(refund), job["pages"] if not error_code and not result.get("duplicate") else 0,
             job["bytes"] if not error_code and not result.get("duplicate") else 0, job["session_id"]))
        conn.execute("""UPDATE ingest_jobs SET status=%s,stage=%s,duplicate=%s,chunks=%s,
            flagged_chunks=%s,error_code=%s,error_status=%s,error_detail=%s,reserved=false,updated_at=now(),finished_at=now() WHERE id=%s""",
            ("failed" if error_code else "done", job["stage"] if error_code else "done",
             result.get("duplicate", job["duplicate"]), result.get("chunks", 0), result.get("flagged_chunks", 0), error_code, error_status, error_detail, job_id))


def delete_session_data(row: dict, status: str = "ended", reason: str = "user") -> None:
    session_id = row["id"]
    with session_lock(session_id), level1._ingest_lock:
        # Commit revocation first: failures leave a terminal, retryable tombstone.
        with connection() as conn:
            current = conn.execute("SELECT * FROM sessions WHERE id=%s FOR UPDATE", (session_id,)).fetchone()
            if not current or current.get("data_deleted_at"):
                return
            if current["status"] in ("ended", "expired"):
                status, reason = current["status"], current["end_reason"]
            conn.execute("""UPDATE sessions SET token_hash=NULL,history='[]',status=%s,
                end_reason=%s,ended_at=COALESCE(ended_at,now()) WHERE id=%s""", (status, reason, session_id))
        schedule_sweep()
        collection = collection_name(session_id)
        level1.invalidate_bm25(collection)
        with connection() as conn:
            if current["level"] == 2 and config.HOSTED_MODE:
                session_store.delete_vectors(conn, session_id)
            elif current["level"] == 2:
                table = "stage2_l2_" + hashlib.sha256(collection.encode()).hexdigest()[:24]
                conn.execute(sql.SQL("DROP TABLE IF EXISTS {}").format(sql.Identifier(table)))
                if conn.execute("SELECT to_regclass('stage1_index_state') AS name").fetchone()["name"]:
                    conn.execute("DELETE FROM stage1_index_state WHERE name=%s", (table,))
            conn.execute("DELETE FROM ingest_jobs WHERE session_id=%s", (session_id,))
            for directory in (level1.collection_directory(collection, current["level"]), upload_directory(session_id)):
                if directory.is_symlink():
                    directory.unlink()
                elif directory.exists():
                    shutil.rmtree(directory)
            conn.execute("UPDATE sessions SET data_deleted_at=now() WHERE id=%s", (session_id,))


def schedule_sweep() -> None:
    global _next_sweep, _sweep_revision, _next_orphan_sweep
    with level1._ingest_lock:
        _next_orphan_sweep = min(_next_orphan_sweep, time.monotonic() + 600)
        _sweep_revision += 1
        _next_sweep = min(_next_sweep, time.monotonic() + min(30, 60 * min(config.SESSION_IDLE_MINUTES, config.SESSION_ABSOLUTE_MINUTES)))


def check_storage_capacity(reserve: int = 0, conn=None) -> None:
    protection.check_deadline()
    if protection.runtime_bytes() + reserve > config.MAX_RUNTIME_BYTES:
        capacity_reached()
    if conn is None:
        with connection() as active:
            return check_storage_capacity(reserve, active)
    size = conn.execute("SELECT pg_database_size(current_database()) AS bytes").fetchone()["bytes"]
    if size + reserve > config.MAX_DATABASE_BYTES:
        capacity_reached()


def sweep_expired(force: bool = False) -> int:
    global _next_sweep
    with level1._ingest_lock:
        revision = _sweep_revision
        if not force and time.monotonic() < _next_sweep:
            return 0
    with connection() as conn:
        rows = conn.execute("""SELECT * FROM sessions WHERE
            (status IN ('ended','expired') AND data_deleted_at IS NULL) OR
            (status IN ('active','locked') AND (expires_at<=now() OR
             last_active<=now()-make_interval(mins => %s)))""",
            (config.SESSION_IDLE_MINUTES,)).fetchall()
    count = 0
    for row in rows:
        try:
            with session_lock(row["id"]):
                current = get(row["id"])
                if current["status"] in ("ended", "expired") or datetime.now(timezone.utc) >= expiry(current):
                    delete_session_data(current, status="expired", reason="ttl")
                    write_trace(dict(event="sweep", session_id=row["id"], level=row["level"], status_code=200))
                    count += 1
        except (psycopg.Error, OSError):
            write_trace(dict(event="sweep", status_code=503, error_code="infrastructure_unavailable"))
    with connection() as conn:
        pending = conn.execute("SELECT count(*) AS count FROM sessions WHERE status IN ('ended','expired') AND data_deleted_at IS NULL").fetchone()["count"]
        upcoming = conn.execute("""SELECT min(LEAST(expires_at, last_active + make_interval(mins => %s))) AS expiry
            FROM sessions WHERE status IN ('active','locked')""", (config.SESSION_IDLE_MINUTES,)).fetchone()["expiry"]
    with level1._ingest_lock:
        delay = max(1, (upcoming - datetime.now(timezone.utc)).total_seconds()) if upcoming else float("inf")
        due = time.monotonic() + (min(30, delay) if pending else delay)
        _next_sweep = due if revision == _sweep_revision else min(_next_sweep, due)
    return count


def apply_watchdog_locks() -> None:
    owners = watchdog.locked_sessions()
    if owners:
        with connection() as conn:
            for owner in owners:
                conn.execute("""UPDATE sessions SET status='locked',end_reason='deadline'
                    WHERE id=%s AND status IN ('active','locked')""",(owner,))
    watchdog.recovered()


def recover_jobs(light: bool = False) -> None:
    """Bounded recovery; kill restarts never enumerate vector tables or count storage."""
    with connection() as conn:
        rows = conn.execute("SELECT * FROM sessions WHERE status IN ('active','locked') LIMIT 5").fetchall()
    if len(rows) > 4:
        raise RuntimeError("Active session budget was exceeded")
    for row in rows:
        if not light and row["docs_used"] and not (level1.collection_directory(collection_name(row["id"]), row["level"]) / "active.json").is_file():
            delete_session_data(row, status="expired", reason="restart_missing_files")
    with connection() as conn:
        jobs = conn.execute("SELECT * FROM ingest_jobs WHERE status NOT IN ('done','failed') LIMIT 5").fetchall()
    if len(jobs) > 4:
        raise RuntimeError("Pending job budget was exceeded")
    for job in jobs:
        row = get(job["session_id"])
        try:
            state = level1.load_collection(collection_name(row["id"]), row["level"])
        except FileNotFoundError:
            state = {}
        if job["document_hash"] and job["document_hash"] in state.get("uploaded_hashes", []):
            finish_job(job["id"], dict(chunks=len(state["chunks"]), duplicate=job["duplicate"]))
        else:
            finish_job(job["id"], error_code="infrastructure_unavailable")
    if light:
        prune_local_artifacts(rows, restart=True)
        # A later due sweep handles deletion; startup only touches indexed metadata.
        global _next_sweep, _next_orphan_sweep
        _next_sweep = time.monotonic() + 30
        _next_orphan_sweep = time.monotonic() + 600
    else:
        sweep_orphans(force=True, restart=True)


def prune_local_artifacts(rows: list[dict], restart: bool = False) -> None:
    """No Neon calls; safe before readiness or under the ingestion lock."""
    with level1._ingest_lock:
        live = {collection_name(row["id"]): row for row in rows}
        with level1._bm25_lock:
            cached_orphans = {key[0] for key in level1._bm25_cache if key[0] not in live
                              and re.fullmatch(r"s[0-9a-f]{20}", key[0])}
        for name in cached_orphans:
            level1.invalidate_bm25(name)
        for level in (1, 2):
            for directory in (config.DATA / f"level_{level}").glob("s*"):
                if not re.fullmatch(r"s[0-9a-f]{20}", directory.name):
                    continue
                row = live.get(directory.name)
                if not row or row["level"] != level:
                    if directory.is_symlink():
                        directory.unlink()
                    else:
                        shutil.rmtree(directory)
                elif restart:
                    pointer = directory / "active.json"
                    active = level1.read_json(pointer)["directory"] if pointer.is_file() else None
                    for artifact in directory.iterdir():
                        if artifact.is_dir() and str(artifact.relative_to(config.ROOT)) != active:
                            shutil.rmtree(artifact)
                        elif artifact.name.endswith(".tmp"):
                            artifact.unlink()
        # Uploads are transient, and no job is running during startup recovery.
        for directory in (config.DATA / "uploads").glob("s*"):
            if re.fullmatch(r"s[0-9a-f]{20}", directory.name) and (restart or directory.name not in live):
                if directory.is_symlink():
                    directory.unlink()
                else:
                    shutil.rmtree(directory)


def sweep_orphans(force: bool = False, restart: bool = False) -> None:
    global _next_orphan_sweep
    if not force and time.monotonic() < _next_orphan_sweep:
        return
    with level1._ingest_lock, connection() as conn:
        # Read the authority before deleting anything; a DB outage leaves files intact.
        rows = conn.execute("SELECT * FROM sessions WHERE status IN ('active','locked')").fetchall()
        live = {collection_name(row["id"]): row for row in rows}
        prune_local_artifacts(rows, restart)
        if not config.HOSTED_MODE:
            tables = conn.execute("""SELECT tablename FROM pg_tables WHERE schemaname=current_schema()
                AND tablename LIKE 'stage2_l2_%'""").fetchall()
            expected = {"stage2_l2_" + hashlib.sha256(name.encode()).hexdigest()[:24]
                        for name, row in live.items() if row["level"] == 2}
            for entry in tables:
                table = entry["tablename"]
                if re.fullmatch(r"stage2_l2_[0-9a-f]{24}", table) and table not in expected:
                    conn.execute(sql.SQL("DROP TABLE IF EXISTS {}").format(sql.Identifier(table)))
                    if conn.execute("SELECT to_regclass('stage1_index_state') AS name").fetchone()["name"]:
                        conn.execute("DELETE FROM stage1_index_state WHERE name=%s", (table,))
        # Terminal summaries and usage counters have no indefinite retention.
        conn.execute("DELETE FROM sessions WHERE data_deleted_at < now()-interval '30 days'")
        conn.execute("DELETE FROM provider_daily_usage WHERE day < (now() AT TIME ZONE 'UTC')::date-30")
        cleanup_at = conn.execute("""SELECT min(cleanup_at) AS cleanup_at FROM (
            SELECT min(data_deleted_at) + interval '30 days 1 second' AS cleanup_at FROM sessions
            UNION ALL SELECT (min(day) + 31)::timestamp AT TIME ZONE 'UTC' FROM provider_daily_usage
            ) AS retention""").fetchone()["cleanup_at"]
        delay = max(1, (cleanup_at - datetime.now(timezone.utc)).total_seconds()) if cleanup_at else float("inf")
        _next_orphan_sweep = time.monotonic() + (min(600, delay) if live else delay)


def trace_path() -> Path:
    return config.DATA / ("traces-" + datetime.now(timezone.utc).strftime("%Y-%m-%d") + ".jsonl")


def prune_traces() -> None:
    cutoff = datetime.now(timezone.utc).date() - timedelta(days=30)
    for path in config.DATA.glob("traces-*.jsonl"):
        try:
            date = datetime.strptime(path.stem.removeprefix("traces-"), "%Y-%m-%d").date()
        except ValueError:
            continue
        if date < cutoff:
            path.unlink()


def safe_llm(trace: dict) -> dict:
    allowed = {"purpose", "provider", "model", "requested_model", "key_index", "chain_index", "llm_calls",
               "attempts", "fallback_count", "fallback_used", "tokens", "prompt", "completion", "total",
               "latency_seconds", "status", "steps", "throttle_seconds", "provider_seconds",
               "cooldown_seconds", "daily_limit"}
    strings = {"answer", "query_rewrite", "visual_caption", "request", "evaluation_judge", "model_verification"}
    strings.update(e["provider"] for e in config.LLM_CHAIN)
    strings.update(e["model"] for e in config.LLM_CHAIN)
    def clean(value):
        if isinstance(value, dict):
            return {key: clean(item) for key, item in value.items() if key in allowed}
        if isinstance(value, list):
            return [clean(item) for item in value]
        if isinstance(value, str):
            return value if value in strings else "unknown"
        return value if value is None or isinstance(value, (int, float, bool)) else None
    return clean(trace)


def write_trace(record: dict) -> None:
    global _trace_day
    allowed = {"request_id", "session_id", "event", "level", "status_code", "error_code", "chunks", "pages", "bytes",
               "timings", "rule_ids", "layer", "rule_id", "action", "score", "severity",
               "flagged_chunks", "classifier_loaded"}
    output = {key: value for key, value in record.items() if key in allowed}
    if "timings" in output:
        output["timings"] = {key: value for key, value in output["timings"].items()
                             if isinstance(value, (int, float))}
    output["timestamp"] = datetime.now(timezone.utc).isoformat()
    if record.get("llm"):
        output["llm"] = safe_llm(record["llm"])
    path = trace_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    with _trace_lock:
        if _trace_day != path.name:
            prune_traces()
            _trace_day = path.name
        payload = json.dumps(output) + "\n"
        if (path.stat().st_size if path.exists() else 0) + len(payload.encode()) > config.MAX_TRACE_BYTES:
            return
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, "a", encoding="utf-8") as stream:
            stream.write(payload)
