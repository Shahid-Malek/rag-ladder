"""Student notes API. Serve with exactly one Uvicorn worker."""
import argparse
import asyncio
from contextvars import copy_context
from html import escape
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager
from enum import IntEnum
import hashlib
import hmac
import json
import logging
import os
from pathlib import Path
import re
import shutil
import tempfile
import threading
import time
from typing import Literal
import uuid

import httpx
import psycopg
from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, Request, Response, Security, UploadFile
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.security import APIKeyHeader
from pydantic import BaseModel, ConfigDict, Field, ValidationError
from slowapi import Limiter
from slowapi.errors import RateLimitExceeded
from starlette.concurrency import run_in_threadpool
from starlette.formparsers import MultiPartException

import config
import guardrails
import protection
import level1
import level2
import level3
import sessions
import watchdog
from llm import LLMUnavailable, validate_question

api_key = APIKeyHeader(name="X-API-Key", auto_error=False)
_job_gate = threading.BoundedSemaphore(config.MAX_CONCURRENT_INGESTS)
_question_gate = threading.BoundedSemaphore(config.MAX_CONCURRENT_QUESTIONS)
_request_gate = threading.BoundedSemaphore(16)


def authenticate(request: Request, key: str | None = Security(api_key),
                 authorization: str | None = Header(None)) -> None:
    if getattr(request.state, "api_identity", None):
        return
    if authorization is not None:
        scheme, _, token = authorization.partition(" ")
        if scheme.lower() != "bearer" or not token:
            raise sessions.SessionError(401, "invalid_token", "Invalid session token")
        row = sessions.authenticate(token, allow_locked=request.method == "DELETE" and request.url.path == "/session")
        if config.HOSTED_MODE and not row.get("notice_accepted") and not (request.method == "DELETE" and request.url.path == "/session"):
            raise sessions.SessionError(403, "notice_required", "Read the notice and start a new session")
        request.state.session = row
        request.state.api_identity = "session:" + row["id"]
        request.state.trace.update(session_id=row["id"], level=row["level"])
        return
    if config.HOSTED_MODE:
        raise HTTPException(401, "A session Bearer token is required")
    if not config.APP_API_KEYS:
        raise HTTPException(503, "Set APP_API_KEYS in .env before using the API")
    if not key or not any(hmac.compare_digest(key.encode(), allowed.encode()) for allowed in config.APP_API_KEYS):
        raise HTTPException(401, "Missing or invalid X-API-Key")
    request.state.api_identity = "key:" + hashlib.sha256(key.encode()).hexdigest()


def rate_key(request: Request) -> str:
    return getattr(request.state, "api_identity", getattr(request.state, "client_ip", request.client.host if request.client else "unknown"))


def sweep_loop(stop: threading.Event) -> None:
    while not stop.wait(30):
        try:
            sessions.sweep_expired()
            sessions.sweep_orphans()
        except Exception:
            sessions.write_trace(dict(event="sweep", status_code=503, error_code="infrastructure_unavailable"))


@asynccontextmanager
async def lifespan(application: FastAPI):
    protection.validate_hosted_config()
    if config.HOSTED_MODE:
        watchdog.require_supervisor()
    light_recovery = config.HOSTED_MODE and os.getenv("WATCHDOG_RECOVERY") == "true"
    sessions.prune_traces()
    application.state.db_ready = False
    # An unavailable database is surfaced by health/requests, without exception contents in logs.
    try:
        await run_in_threadpool(sessions.init_tables)
        await run_in_threadpool(sessions.apply_watchdog_locks)
        await run_in_threadpool(sessions.recover_jobs, light=light_recovery)
        if not light_recovery:
            await run_in_threadpool(sessions.sweep_expired, force=True)
        application.state.db_ready = True
    except psycopg.Error:
        sessions.write_trace(dict(event="sweep", status_code=503, error_code="infrastructure_unavailable"))
        if config.HOSTED_MODE:
            raise RuntimeError("Database is unavailable") from None
    if not await run_in_threadpool(guardrails.load_classifier):
        raise RuntimeError("Safety classifier is unavailable")
    try:
        await run_in_threadpool(level1.warm_encoders)
    except Exception:
        sessions.write_trace(dict(event="sweep", status_code=503, error_code="infrastructure_unavailable"))
        if config.HOSTED_MODE:
            raise RuntimeError("Encoders are unavailable") from None
    application.state.ingest_worker = ThreadPoolExecutor(max_workers=config.MAX_CONCURRENT_INGESTS, thread_name_prefix="ingest")
    stop = threading.Event()
    sweeper = threading.Thread(target=sweep_loop, args=(stop,), name="session-sweeper", daemon=True)
    sweeper.start()
    watchdog.ready()
    try:
        yield
    finally:
        stop.set()
        await run_in_threadpool(sweeper.join)
        await run_in_threadpool(application.state.ingest_worker.shutdown, wait=True)
        await run_in_threadpool(level1.close_postgres_pools)


limiter = Limiter(key_func=rate_key, config_filename=str(config.ROOT / "limiter.conf"))
app = FastAPI(title="Student Notes RAG", version="0.3.0", lifespan=lifespan,
              docs_url=None if config.HOSTED_MODE else "/docs",
              openapi_url=None if config.HOSTED_MODE else "/openapi.json")
app.state.limiter = limiter
# Structured audit events are the request log; library access logs expose URLs/identities.
for logger_name in ("httpx", "httpcore", "slowapi"):
    logging.getLogger(logger_name).disabled = True
app.add_middleware(CORSMiddleware, allow_origins=list(config.CORS_ORIGINS),
                   allow_methods=["GET", "POST", "DELETE"], allow_headers=["Authorization", "X-API-Key", "Content-Type"],
                   expose_headers=["X-Request-ID"])


class Level(IntEnum):
    level_1 = 1
    level_2 = 2
    level_3 = 3



def get_level(level: Level | int):
    return {1: level1, 2: level2, 3: level3}[level]


class SessionCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    level: Literal[1, 2]
    turnstile_token: str = Field(default="", max_length=2048)
    notice_accepted: bool = Field(default=False, strict=True)


class SessionQuestion(BaseModel):
    model_config = ConfigDict(extra="forbid")
    question: str = Field(min_length=1, max_length=config.MAX_QUESTION_CHARS)
    query_processing: bool = True


class AskResponse(BaseModel):
    original_question: str
    rewritten_query: str | None
    rewritten_queries: list[str]
    answer: str | None
    citations: list[str]
    citation_valid: bool
    invalid_citations: list[str]
    missing_citations: bool
    retrieved_chunks: list[dict]
    trace: dict
    session: dict | None = None
    generation_status: str | None = None
    conversation: str | None = None


def write_trace(record: dict) -> None:
    sessions.write_trace(record)


def error_response(request: Request, status: int, code: str, detail):
    request.state.trace["error_code"] = code
    return JSONResponse(status_code=status, content=dict(error_code=code, detail=detail))


@app.exception_handler(sessions.SessionError)
async def session_error(request: Request, exc: sessions.SessionError):
    response = error_response(request, exc.status, exc.code, exc.message)
    if exc.rule_id:
        response = JSONResponse(status_code=exc.status, content=dict(error_code=exc.code, detail=exc.message, rule_id=exc.rule_id))
    if exc.status == 429:
        response.headers["Retry-After"] = str(config.CAPACITY_RETRY_AFTER_SECONDS)
    return response


@app.exception_handler(HTTPException)
async def http_error(request: Request, exc: HTTPException):
    codes = {401: "invalid_token", 413: "file_too_large", 415: "unsupported_type", 422: "validation_failed",
             429: "rate_limited", 503: "infrastructure_unavailable"}
    response = error_response(request, exc.status_code, codes.get(exc.status_code, "validation_failed"), exc.detail)
    response.headers.update(exc.headers or {})
    return response


@app.exception_handler(RequestValidationError)
async def validation_error(request: Request, exc: RequestValidationError):
    return error_response(request, 422, "validation_failed", "Invalid request fields")


@app.exception_handler(RateLimitExceeded)
async def rate_error(request: Request, exc: RateLimitExceeded):
    return error_response(request, 429, "rate_limited", "Request rate limit exceeded")


@app.exception_handler(psycopg.Error)
async def database_error(request: Request, exc: psycopg.Error):
    app.state.db_ready = False
    return error_response(request, 503, "infrastructure_unavailable", "PostgreSQL unavailable")


class BodyTooLarge(MultiPartException):
    pass


class RequestProtection:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        request = Request(scope)
        request_id = uuid.uuid4().hex
        path = scope["path"]
        event = ("session_create" if request.method == "POST" else "delete") if path == "/session" else path.strip("/").split("/")[0]
        request.state.trace = dict(request_id=request_id, event=event)
        start = time.perf_counter()
        status, received, response_bytes, started = 500, 0, 0, False
        gate, admitted, exceeded = None, False, False
        messages = []
        cap = config.MAX_JSON_BODY_BYTES
        if path == "/ingest":
            cap = config.DEMO_MAX_UPLOAD_BODY_BYTES if request.headers.get("authorization") else config.MAX_UPLOAD_BODY_BYTES
        headers = protection.security_headers()
        headers["X-Request-ID"] = request_id

        async def respond(code, error, detail):
            nonlocal status, started
            status, started = code, True
            request.state.trace["error_code"] = error
            if code == 429:
                headers["Retry-After"] = str(config.CAPACITY_RETRY_AFTER_SECONDS)
            await JSONResponse(status_code=code, content=dict(error_code=error, detail=detail), headers=headers)(scope, receive, send)

        async def limited_receive():
            nonlocal received, exceeded
            try:
                message = await asyncio.wait_for(receive(), timeout=protection.remaining())
            except TimeoutError:
                raise protection.ProtectionError("deadline_exceeded", "Request body timed out") from None
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > cap:
                    exceeded = True
                    raise BodyTooLarge("Request body exceeds limit")
            return message

        async def bounded_send(message):
            nonlocal status, response_bytes
            if message["type"] == "http.response.start":
                status = message["status"]
                replaced = {key.lower().encode() for key in headers}
                message = dict(message, headers=[(k, v) for k, v in message.get("headers", []) if k.lower() not in replaced]
                               + [(k.lower().encode(), v.encode()) for k, v in headers.items()])
            if message["type"] == "http.response.body":
                response_bytes += len(message.get("body", b""))
                if response_bytes > config.MAX_RESPONSE_BYTES:
                    raise protection.ProtectionError("response_too_large", "Response exceeds limit")
            messages.append(message)

        try:
            with protection.deadline(config.INGEST_TIMEOUT_SECONDS if path == "/ingest" else config.REQUEST_TIMEOUT_SECONDS):
                local_health = path == "/health" and request.method == "GET" and request.client and request.client.host == "127.0.0.1"
                request.state.client_ip = "127.0.0.1" if local_health else protection.client_ip(request)
                protection.admit_ip(request.state.client_ip)
                admitted = _request_gate.acquire(blocking=False)
                if not admitted:
                    return await respond(429, "server_busy", "Demo is busy; retry shortly")
                # Ending sessions remains available when new-work capacity is exhausted.
                if config.HOSTED_MODE and request.method != "DELETE" and (path in ("/session", "/ask", "/ingest") or path.startswith("/ingest/")):
                    protection.reserve_database_activity()
                length = request.headers.get("content-length")
                if length is not None and not length.isdigit():
                    return await respond(422, "validation_failed", "Invalid Content-Length")
                if length is not None and int(length) > cap:
                    return await respond(413, "file_too_large", "Request body exceeds limit")
                if request.method == "POST" and path in ("/ingest", "/ask"):
                    await run_in_threadpool(authenticate, request, request.headers.get("x-api-key"), request.headers.get("authorization"))
                    if config.HOSTED_MODE:
                        guardrails.require_classifier()
                    gate = _job_gate if path == "/ingest" else _question_gate
                    if not gate.acquire(blocking=False):
                        gate = None
                        return await respond(429, "server_busy", "Demo is busy; retry shortly")
                    if path == "/ask":
                        await run_in_threadpool(sessions.check_provider_capacity)
                await self.app(scope, limited_receive, bounded_send)
                if exceeded:
                    raise protection.ProtectionError("file_too_large", "Request body exceeds limit", 413)
                protection.check_deadline()
                if status < 400 and path in ("/session", "/ask", "/ingest"):
                    app.state.db_ready = True
                for message in messages:
                    started = True
                    await send(message)
        except (protection.ProtectionError, sessions.SessionError) as exc:
            if not started:
                await respond(exc.status, exc.code, exc.message)
        except HTTPException as exc:
            if not started:
                if exceeded:
                    return await respond(413, "file_too_large", "Request body exceeds limit")
                await respond(exc.status_code, "invalid_token" if exc.status_code == 401 else "infrastructure_unavailable", exc.detail)
        except BodyTooLarge:
            if not started:
                await respond(413, "file_too_large", "Request body exceeds limit")
        except Exception:
            if not started:
                await respond(503, "infrastructure_unavailable", "Request unavailable")
        finally:
            if gate is not None and not getattr(request.state, "ingest_submitted", False):
                gate.release()
            if admitted:
                _request_gate.release()
            if event in ("session_create", "ingest", "ask", "delete", "guardrail", "sweep") and not (path == "/session" and request.method == "GET"):
                request.state.trace.update(status_code=status)
                request.state.trace.setdefault("timings", {})["request"] = round(time.perf_counter() - start, 4)
                write_trace(request.state.trace)


app.add_middleware(RequestProtection)


@app.get("/", response_class=HTMLResponse)
def notice_page():
    return "<!doctype html><html lang=\"en\"><meta charset=\"utf-8\"><title>Demo data notice</title><h1>Before you upload</h1><p>" + escape(config.DEMO_NOTICE) + "</p></html>"


@app.get("/notice")
def notice():
    return dict(notice=config.DEMO_NOTICE, turnstile_site_key=config.TURNSTILE_SITE_KEY,
                turnstile_action=config.TURNSTILE_ACTION, notice_accepted_required=True)


@app.exception_handler(protection.ProtectionError)
async def protection_error(request: Request, exc: protection.ProtectionError):
    return error_response(request, exc.status, exc.code, exc.message)


@app.post("/session")
@limiter.limit(config.INGEST_RATE_LIMIT)
def create_session(request: Request, response: Response, body: SessionCreate):
    if config.HOSTED_MODE:
        guardrails.require_classifier()
    if not body.notice_accepted:
        raise sessions.SessionError(422, "notice_required", "Read and accept the notice before starting a session")
    if config.TURNSTILE_ENABLED:
        if not body.turnstile_token.strip():
            raise sessions.SessionError(422, "turnstile_rejected", "Turnstile token is required")
        if not config.TURNSTILE_SECRET:
            raise sessions.SessionError(503, "infrastructure_unavailable", "Turnstile is not configured")
        try:
            verified = protection.post("https://challenges.cloudflare.com/turnstile/v0/siteverify",
                                       maximum=8192, timeout=10,
                                       data=dict(secret=config.TURNSTILE_SECRET, response=body.turnstile_token,
                                                 remoteip=request.state.client_ip))
            verified.raise_for_status()
            protection.validate_turnstile(verified.json())
        except (httpx.HTTPError, ValueError):
            raise sessions.SessionError(503, "infrastructure_unavailable", "Turnstile unavailable") from None
    result = sessions.create(body.level)
    request.state.trace.update(session_id=result["session_id"], level=body.level)
    return result


@app.get("/session", dependencies=[Depends(authenticate)])
@limiter.limit(config.STATUS_RATE_LIMIT)
def session_status(request: Request, response: Response):
    row = require_session(request)
    block = sessions.quota(sessions.get(row["id"]))
    return dict(block, session=block)


def require_session(request: Request) -> dict:
    row = getattr(request.state, "session", None)
    if row is None:
        raise sessions.SessionError(401, "invalid_token", "A session Bearer token is required")
    return row


@app.delete("/session", dependencies=[Depends(authenticate)])
@limiter.limit(config.STATUS_RATE_LIMIT)
def end_session(request: Request, response: Response):
    row = require_session(request)
    sessions.delete_session_data(row)
    return dict(status="ended")


@app.get("/health")
@limiter.limit(config.STATUS_RATE_LIMIT)
def health(request: Request, response: Response):
    if config.HOSTED_MODE:
        ready = bool(getattr(app.state, "db_ready", False)) and guardrails.classifier_info()["classifier_loaded"]
        return JSONResponse(status_code=200 if ready else 503, content=dict(ok=ready, classifier_loaded=guardrails.classifier_info()["classifier_loaded"]))
    try:
        with sessions.connection() as conn:
            version = conn.execute("SELECT extversion FROM pg_extension WHERE extname='vector'").fetchone()
        return dict(ok=version is not None, db=True, pgvector_version=version["extversion"] if version else None,
                    classifier_loaded=guardrails.classifier_info()["classifier_loaded"])
    except psycopg.Error:
        return JSONResponse(status_code=503, content=dict(ok=False, db=False, pgvector_version=None,
                                                         classifier_loaded=guardrails.classifier_info()["classifier_loaded"],
                                                         error_code="infrastructure_unavailable"))


# Kept as aliases for callers that validate local fixtures.
validate_demo_pdf = level1.validate_upload_pdf
image_to_pdf = level1.image_to_pdf


def run_ingest_job(session_id: str, job_id: str, path: Path, request_id: str,
                   force_ocr: bool = False, document_hash: str | None = None, parsed: dict | None = None) -> None:
    start = time.perf_counter()
    error_code, error_status, result = None, None, {}
    row, timings = {}, {}
    stage, stage_start = "queued", start
    def progress(next_stage):
        nonlocal stage, stage_start
        now = time.perf_counter()
        timings[stage] = round(now - stage_start, 4)
        protection.check_deadline()
        sessions.check_storage_capacity(reserve=config.INGEST_RESERVE_BYTES)
        stage, stage_start = next_stage, now
        sessions.progress(job_id, next_stage)
    try:
        with watchdog.operation(session_id, min(config.INGEST_TIMEOUT_SECONDS, protection.remaining())):
            sessions.sweep_expired()
            with protection.deadline(config.INGEST_TIMEOUT_SECONDS), sessions.activity(session_id) as row, level1._ingest_lock:
                result = level1.ingest_document(sessions.collection_name(session_id), path, "document.pdf", level=row["level"],
                                               parse_timeout=config.DEMO_PARSE_TIMEOUT_SECONDS,
                                               progress=progress, guard_context=dict(request_id=request_id, session_id=session_id),
                                               force_ocr=force_ocr, document_hash=document_hash, parsed=parsed)
                sessions.finish_job(job_id, result)
    except protection.ProtectionError as exc:
        error_code, error_status = exc.code, exc.status
    except level1.DocumentError as exc:
        error_code, error_status = exc.code, exc.status
        sessions.finish_job(job_id, error_code=exc.code, error_status=exc.status, error_detail=str(exc))
    except sessions.SessionError as exc:
        error_code, error_status = exc.code, exc.status
    except TimeoutError:
        error_code = "parse_timeout"
    except level1.NoTextFound:
        error_code = "no_text_found"
    except psycopg.Error:
        app.state.db_ready = False
        error_code = "infrastructure_unavailable"
    except Exception:
        error_code = "validation_failed"
    finally:
        try:
            if error_code:
                sessions.finish_job(job_id, error_code=error_code, error_status=error_status)
            timings[stage] = round(time.perf_counter() - stage_start, 4)
            timings["total"] = round(time.perf_counter() - start, 4)
            write_trace(dict(event="ingest", request_id=request_id, session_id=session_id, level=row.get("level"),
                             status_code=(error_status or (503 if error_code == "infrastructure_unavailable" else 422)) if error_code else 200,
                             error_code=error_code, chunks=result.get("chunks", 0),
                             flagged_chunks=result.get("flagged_chunks", 0), timings=timings))
        finally:
            shutil.rmtree(path.parent, ignore_errors=True)
            _job_gate.release()


def session_ingest(request: Request, file: UploadFile):
    row = require_session(request)
    extension = Path(file.filename or "").suffix.lower()
    image = extension in (".png", ".jpg", ".jpeg", ".webp")
    if extension != ".pdf" and not (image and row["level"] == 2):
        raise sessions.SessionError(415, "unsupported_type", "Level 1 accepts PDFs only; Level 2 accepts PDFs, PNG, JPEG and WebP")
    lock = sessions.session_lock(row["id"])
    if not lock.acquire(blocking=False):
        raise sessions.SessionError(429, "server_busy", "A request is already processing for this session")
    temporary = None
    submitted = False
    job_id = None
    try:
        with watchdog.operation(row["id"], protection.remaining()), sessions.activity(row["id"]):
            guardrails.require_classifier()
            sessions.check_storage_capacity(reserve=config.INGEST_RESERVE_BYTES)
            level1.collection_directory(sessions.collection_name(row["id"]), row["level"]).mkdir(parents=True, exist_ok=True, mode=0o700)
            directory = sessions.upload_directory(row["id"])
            directory.mkdir(parents=True, exist_ok=True, mode=0o700)
            temporary = Path(tempfile.mkdtemp(dir=directory))
            path = temporary / "document.pdf"
            size = 0
            with path.open("wb") as output:
                while data := file.file.read(1024 * 1024):
                    size += len(data)
                    if size > config.DEMO_MAX_UPLOAD_BYTES:
                        raise sessions.SessionError(413, "file_too_large", "Demo PDF exceeds upload limit")
                    output.write(data)
            digest = hashlib.sha256(path.read_bytes()).hexdigest()
            try:
                state = level1.load_collection(sessions.collection_name(row["id"]), row["level"])
                duplicate = digest in state.get("uploaded_hashes", [])
            except FileNotFoundError:
                duplicate = False
            if not duplicate and sessions.get(row["id"])["docs_used"] >= config.SESSION_MAX_DOCS:
                raise sessions.SessionError(403, "quota_exceeded", "Document quota exhausted")
            if duplicate:
                parsed, pages = None, 0
            else:
                try:
                    parsed = level1.parse_upload(path, row["level"], sessions.collection_name(row["id"]),
                                                 min(config.DEMO_PARSE_TIMEOUT_SECONDS, protection.remaining()), force_ocr=image,
                                                 image_extension=extension if image else None, scan_hidden=True)
                except level1.DocumentError as exc:
                    raise sessions.SessionError(exc.status, exc.code, str(exc)) from None
                except TimeoutError:
                    raise sessions.SessionError(422, "parse_timeout", "Document processing timed out") from None
                pages = parsed["page_count"]
            job_id = sessions.reserve_job(sessions.get(row["id"]), pages, size, duplicate, digest)
            request.app.state.ingest_worker.submit(copy_context().run, run_ingest_job, row["id"], job_id, path, request.state.trace["request_id"], image, digest, parsed)
            submitted = True
            request.state.ingest_submitted = True
        request.state.trace.update(pages=pages, bytes=size)
        return JSONResponse(status_code=202, content=dict(job_id=job_id))
    finally:
        lock.release()
        if not submitted:
            if job_id:
                sessions.finish_job(job_id, error_code="infrastructure_unavailable")
            if temporary:
                shutil.rmtree(temporary, ignore_errors=True)


@app.get("/ingest/{job_id}", dependencies=[Depends(authenticate)])
@limiter.limit(config.STATUS_RATE_LIMIT)
def ingest_status(request: Request, response: Response, job_id: str):
    row = require_session(request)
    job = sessions.get_job(job_id, row["id"])
    result = dict(job, session=sessions.quota(sessions.get(row["id"])))
    return JSONResponse(status_code=job.get("error_status") or 200, content=result)


@app.post("/ingest", dependencies=[Depends(authenticate)], summary="Append a PDF; session mode returns an asynchronous job")
@limiter.limit(config.INGEST_RATE_LIMIT)
def ingest(request: Request, response: Response, level: Level | None = Form(None),
           collection: str | None = Form(None, min_length=1, max_length=64), file: UploadFile = File(...)):
    try:
        if getattr(request.state, "session", None):
            return session_ingest(request, file)
        if level is None or collection is None:
            raise HTTPException(422, "Level and collection are required")
        if not level1._ingest_lock.acquire(blocking=False):
            raise sessions.SessionError(429, "server_busy", "Ingestion is busy; retry shortly")
        try:
            return legacy_ingest(request, response, level, collection, file)
        finally:
            level1._ingest_lock.release()
    finally:
        file.file.close()


def session_ask(request: Request, question: str, query_processing: bool = True, validation_seconds: float = 0):
    start = time.perf_counter()
    timings = level1.query_timings()
    timings["validation"] = validation_seconds
    row = require_session(request)
    history_start = time.perf_counter()
    with watchdog.operation(row["id"], protection.remaining()), sessions.activity(row["id"]) as current:
        history = None
        if row["level"] == 2:
            tokenizer = level1.encoder(2).tokenizer
            history = sessions.trim_history(current["history"], tokenizer)
            timings["history"] += time.perf_counter() - history_start
        guard_start = time.perf_counter()
        guard_context = dict(request_id=request.state.trace["request_id"], session_id=row["id"])
        scan = guardrails.scan_question(question, guard_context)
        timings["guardrails"] += time.perf_counter() - guard_start
        request.state.trace.update(timings=dict(timings), rule_ids=scan["rule_ids"],
                                   classifier_loaded=guardrails.classifier_info()["classifier_loaded"])
        if scan["blocked"]:
            if scan["error_code"] == "guardrail_blocked":
                sessions.add_strike(row["id"])
            raise sessions.SessionError(503 if scan["error_code"] == "classifier_unavailable" else 422, scan["error_code"], "Question blocked by safety checks", scan["rule_ids"][0])
        sessions.reserve_question(row["id"])
        trace, failed = {}, True
        try:
            options = dict(session_mode=True, timings=timings, query_processing=query_processing, guard_context=guard_context)
            if history is not None:
                options["history"] = history
            import llm
            with llm.provider_attempt_policy(current.get("failed_attempts", 0) >= config.SESSION_MAX_FAILED_ATTEMPTS):
                result = get_level(row["level"]).ask(sessions.collection_name(row["id"]), question, **options)
            protection.check_deadline()
            if result.get("answer") is not None and len(result["answer"]) > config.MAX_ANSWER_CHARS:
                raise protection.ProtectionError("answer_too_large", "Answer exceeds limit")
            trace = result["trace"]
            trace.setdefault("guardrails", {}).update(input_rule_ids=scan["rule_ids"], input_score=scan["score"],
                                                      **guardrails.classifier_info())
            if result.get("output_blocked"):
                sessions.add_strike(row["id"])
            failed = result.get("answer") is None
            if history is not None and not failed:
                history_start = time.perf_counter()
                sessions.append_history(row["id"], question, result, tokenizer)
                timings["history"] += time.perf_counter() - history_start
        except LLMUnavailable as exc:
            trace = exc.trace
            raise sessions.SessionError(503, "infrastructure_unavailable", "Answer provider unavailable") from None
        except FileNotFoundError:
            raise sessions.SessionError(422, "validation_failed", "Upload a document before asking questions") from None
        except ValueError:
            raise sessions.SessionError(422, "validation_failed", "Question could not be processed") from None
        finally:
            sessions.finish_question(row["id"], trace, failed=failed)
            timings["total"] = time.perf_counter() - start + validation_seconds
            request.state.trace.update(llm=trace.get("llm", {}), timings=dict(timings))
        trace["request_id"] = request.state.trace["request_id"]
        queries = trace["rewritten_queries"]
        result.update(original_question=question, rewritten_queries=queries,
                      rewritten_query=queries[-1] if queries else None,
                      session=sessions.quota(sessions.get(row["id"])),
                      generation_status="unavailable" if failed else "ok",
                      conversation="multi_turn" if row["level"] == 2 else "single_turn")
        timings["total"] = time.perf_counter() - start + validation_seconds
        request.state.trace["timings"] = dict(timings)
        return result


@app.post("/ask", dependencies=[Depends(authenticate)], response_model=AskResponse,
          response_model_exclude_unset=True, summary="Session JSON question, or legacy folder form",
          openapi_extra={"requestBody": {"content": {"application/json": {"schema": SessionQuestion.model_json_schema()}}}})
@limiter.limit(config.ASK_RATE_LIMIT)
async def ask(request: Request, response: Response, level: Level | None = Form(None), folder: str | None = Form(None, min_length=1, max_length=64),
              question: str | None = Form(None, min_length=1, max_length=config.MAX_QUESTION_CHARS),
              query_processing: bool = Form(True)):
    if getattr(request.state, "session", None):
        validation_start = time.perf_counter()
        try:
            body = SessionQuestion.model_validate(await request.json())
        except (ValueError, ValidationError):
            raise sessions.SessionError(422, "validation_failed", "Send a JSON question and optional query_processing") from None
        validation_seconds = time.perf_counter() - validation_start
        return await run_in_threadpool(session_ask, request, body.question, body.query_processing, validation_seconds)
    if level is None or folder is None or question is None:
        raise HTTPException(422, "Level, folder and question are required")
    return await run_in_threadpool(legacy_ask, request, response, level, folder, question, query_processing)


def legacy_ingest(request: Request, response: Response, level: Level = Form(...),
           collection: str = Form(..., min_length=1, max_length=64), file: UploadFile = File(...)):
    if config.HOSTED_MODE:
        raise HTTPException(404, "Administrative routes are disabled")
    request.state.trace.update(level=level.value, collection=collection)
    pipeline = get_level(level)
    try:
        config.validate_collection(collection)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    filename = file.filename or ""
    if Path(filename).name != filename or "\\" in filename or not filename.lower().endswith(".pdf"):
        raise HTTPException(422, "Upload a PDF with a plain filename")
    filename = re.sub(r"[^A-Za-z0-9_. -]", "_", filename)[:180]
    directory = config.DATA / "uploads"
    directory.mkdir(parents=True, exist_ok=True)
    try:
        with tempfile.TemporaryDirectory(dir=directory) as temporary:
            path = Path(temporary) / "document.pdf"
            size = 0
            with path.open("wb") as output:
                while data := file.file.read(1024 * 1024):
                    size += len(data)
                    if size > config.MAX_UPLOAD_BYTES:
                        raise HTTPException(413, "PDF exceeds MAX_UPLOAD_MB")
                    output.write(data)
            with path.open("rb") as source:
                if not source.read(1024).lstrip().startswith(b"%PDF-"):
                    raise HTTPException(422, "File does not have a PDF header")
            try:
                result = pipeline.ingest_document(collection, path, filename, parse_timeout=config.DEMO_PARSE_TIMEOUT_SECONDS)
            except level1.DocumentError as exc:
                raise sessions.SessionError(exc.status, exc.code, str(exc)) from None
            except LLMUnavailable as exc:
                request.state.trace["llm"] = exc.trace
                raise HTTPException(503, "Caption provider unavailable; retry ingestion to reuse cached captions") from exc
            except psycopg.Error as exc:
                request.state.trace["error"] = type(exc).__name__
                raise HTTPException(503, "PostgreSQL/pgvector unavailable; run docker compose up -d --wait or check STAGE1_PG_DSN") from exc
            except ValueError as exc:
                raise HTTPException(422, str(exc)) from exc
            except Exception as exc:
                request.state.trace["error"] = type(exc).__name__
                raise HTTPException(422, "PDF ingestion failed; check its content and local model availability") from exc
        request.state.trace.update(chunks=result.get("chunks", 0), bytes=size)
        return dict(result, request_id=request.state.trace["request_id"])
    finally:
        file.file.close()


def legacy_ask(request: Request, response: Response, level: Level = Form(...), folder: str = Form(..., min_length=1, max_length=64),
        question: str = Form(..., min_length=1, max_length=config.MAX_QUESTION_CHARS),
        query_processing: bool = Form(True, description="L2: always rewrite; L3: adaptive rewrite/retry; L1: original question")):
    if config.HOSTED_MODE:
        raise HTTPException(404, "Administrative routes are disabled")
    request.state.trace.update(level=level.value, collection=folder)
    pipeline = get_level(level)
    try:
        folder = config.validate_collection(folder)
        question = validate_question(question)
        result = pipeline.ask(folder, question, query_processing=query_processing)
    except psycopg.Error as exc:
        request.state.trace.update(getattr(exc, "rag_trace", {}))
        request.state.trace["error"] = type(exc).__name__
        raise HTTPException(503, "PostgreSQL/pgvector unavailable; run docker compose up -d --wait or check STAGE1_PG_DSN") from exc
    except ValueError as exc:
        request.state.trace.update(getattr(exc, "rag_trace", {}))
        raise HTTPException(422, str(exc)) from exc
    except FileNotFoundError as exc:
        request.state.trace.update(getattr(exc, "rag_trace", {}))
        raise HTTPException(404, str(exc)) from exc
    except LLMUnavailable as exc:
        request.state.trace.update(exc.trace)
        raise HTTPException(503, dict(message=str(exc), request_id=request.state.trace["request_id"], trace=exc.trace)) from exc
    result["trace"]["request_id"] = request.state.trace["request_id"]
    request.state.trace.update(result["trace"])
    queries = result["trace"]["rewritten_queries"]
    result.update(original_question=question, rewritten_queries=queries,
                  rewritten_query=queries[-1] if queries else None)
    return result


if __name__ == "__main__":
    level1.configure_runtime()
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--ingest-folders", action="store_true")
    parser.add_argument("--level", type=int, choices=(1, 2, 3), default=1)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8000)
    args = parser.parse_args()
    if args.ingest_folders:
        datasets = config.load_datasets()
        if not datasets:
            parser.error("Local datasets are not configured")
        pipeline = get_level(Level(args.level))
        level1.seed_everything()
        for folder in datasets:
            result = pipeline.ingest_folder(folder)
            print(json.dumps({k: v for k, v in result.items() if k != "caption_trace"}))
    else:
        import uvicorn
        uvicorn.run(app, host=args.host, port=args.port, workers=1,
                    proxy_headers=not config.HOSTED_MODE and bool(config.TRUSTED_PROXY_IPS), forwarded_allow_ips=config.TRUSTED_PROXY_IPS,
                    access_log=False)
