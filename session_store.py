"""Hosted shared-vector ownership; local/evaluation tables remain separate."""
from contextlib import contextmanager
from contextvars import ContextVar
import hashlib

_current = ContextVar("owned_session", default=None)


@contextmanager
def scope(session_id):
    token = _current.set(session_id)
    try: yield
    finally: _current.reset(token)


def current(collection=None):
    session_id = _current.get()
    expected = "s" + hashlib.sha256(session_id.encode()).hexdigest()[:20] if session_id else None
    if not session_id or collection is not None and collection != expected:
        raise ValueError("Session ownership is unavailable")
    return session_id


@contextmanager
def owned_transaction(connection, session_id):
    with connection.transaction():
        connection.execute("SELECT set_config('app.session_id', %s, true)", (session_id,))
        yield


def pool_settings(dsn):
    from psycopg.conninfo import conninfo_to_dict
    options = conninfo_to_dict(dsn)
    hosts = options.get("host", "").split(",")
    if not hosts or any(not host or host.startswith(("/", "@")) for host in hosts):
        raise ValueError("Hosted database requires a TLS host")
    return dict(user="rag_app", sslmode="verify-full", sslrootcert="/etc/ssl/certs/ca-certificates.crt")


def check_database(connection):
    # Catalog/current-backend checks only: no vector counts, table scans or size queries.
    row = connection.execute("""SELECT current_user='rag_app'
        AND NOT (r.rolsuper OR r.rolcreatedb OR r.rolcreaterole OR r.rolreplication OR r.rolbypassrls)
        AND NOT EXISTS (SELECT 1 FROM pg_auth_members WHERE member=r.oid)
        AND NOT has_schema_privilege(current_user,'rag','CREATE')
        AND NOT has_schema_privilege(current_user,'public','CREATE')
        AND NOT has_database_privilege(current_user,current_database(),'CREATE')
        AND NOT has_database_privilege(current_user,current_database(),'TEMP')
        AND NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
                        WHERE n.nspname='rag' AND c.relowner=r.oid)
        AND (SELECT count(*)=2 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
             WHERE n.nspname='rag' AND c.relname IN ('session_vectors','stage1_index_state')
             AND c.relrowsecurity AND c.relforcerowsecurity)
        AND current_setting('server_version_num')::integer>=170000
        AND COALESCE((SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()),false) AS safe
        FROM pg_roles r WHERE r.rolname=current_user""").fetchone()
    if not row or row["safe"] is not True:
        raise ValueError("Hosted database confinement is unavailable")


def open_vectors(state, cached):
    owner = current(state["subject"])
    import level1
    from pgvector.psycopg import register_vector
    connection = level1.postgres_connection()
    try:
        register_vector(connection)
        with owned_transaction(connection, owner):
            active = connection.execute("SELECT id FROM rag.sessions WHERE id=%s AND collection=%s AND status='active'",
                                        (owner, state["subject"])).fetchone()
            if not active: raise ValueError("Session is inactive")
            stored = connection.execute("SELECT signature FROM rag.stage1_index_state WHERE name=%s AND session_id=%s",
                                        (state["subject"],owner)).fetchone()
            cached = cached and stored is not None and stored[0] == state["signature"]
            count = connection.execute("SELECT count(*) FROM rag.session_vectors WHERE session_id=%s",(owner,)).fetchone()[0]
            if not cached or count != len(state["chunks"]):
                cached = False
                connection.execute("DELETE FROM rag.session_vectors WHERE session_id=%s",(owner,))
                with connection.cursor() as cursor:
                    cursor.executemany("INSERT INTO rag.session_vectors(session_id,id,embedding) VALUES (%s,%s,%s)",
                                       [(owner,index,vector) for index,vector in enumerate(state["vectors"])])
                connection.execute("""INSERT INTO rag.stage1_index_state(name,signature,session_id) VALUES (%s,%s,%s)
                    ON CONFLICT (name) DO UPDATE SET signature=EXCLUDED.signature
                    WHERE stage1_index_state.session_id=EXCLUDED.session_id""",(state["subject"],state["signature"],owner))
        return dict(client=connection,session_id=owner),cached
    except Exception:
        connection.close()
        raise


def dense_query(store, vector, count):
    if current() != store["session_id"]: raise ValueError("Session ownership mismatch")
    connection = store["client"]
    with owned_transaction(connection, store["session_id"]):
        connection.execute("SET LOCAL enable_indexscan = off")
        connection.execute("SET LOCAL enable_bitmapscan = off")
        connection.execute("SET LOCAL enable_indexonlyscan = off")
        return connection.execute("""SELECT id, 1 - (embedding <=> %s) AS score FROM rag.session_vectors
            WHERE session_id=%s ORDER BY embedding <=> %s, id LIMIT %s""",
            (vector,store["session_id"],vector,count)).fetchall()


def delete_vectors(connection, session_id):
    with owned_transaction(connection, session_id):
        connection.execute("DELETE FROM rag.session_vectors WHERE session_id=%s",(session_id,))
        connection.execute("DELETE FROM rag.stage1_index_state WHERE session_id=%s",(session_id,))
