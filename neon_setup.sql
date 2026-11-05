-- Run as the Neon database owner in a DEDICATED PG17+ database, before Step 2 deployment.
-- No password/token/connection URL belongs here. Set rag_app's login/password privately afterward.
-- Hosted runtime uses this shared-vector schema; use a fresh dedicated database, not a legacy-table migration.
BEGIN;
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA public;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='rag_app') THEN
        CREATE ROLE rag_app NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='rag_app'
               AND (rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls))
       OR EXISTS (SELECT 1 FROM pg_auth_members WHERE member=(SELECT oid FROM pg_roles WHERE rolname='rag_app')) THEN
        RAISE EXCEPTION 'rag_app must be an unprivileged role with no inherited memberships';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_database WHERE datname=current_database()
               AND datdba=(SELECT oid FROM pg_roles WHERE rolname='rag_app')) THEN
        RAISE EXCEPTION 'rag_app must not own the database';
    END IF;
    EXECUTE format('REVOKE CREATE, TEMPORARY ON DATABASE %I FROM PUBLIC, rag_app', current_database());
    EXECUTE format('GRANT CONNECT ON DATABASE %I TO rag_app', current_database());
END $$;
CREATE SCHEMA IF NOT EXISTS rag;
REVOKE ALL ON SCHEMA rag FROM PUBLIC, rag_app;
REVOKE CREATE ON SCHEMA public FROM PUBLIC, rag_app;
GRANT USAGE ON SCHEMA rag, public TO rag_app;
SET LOCAL search_path = rag, public;
CREATE TABLE IF NOT EXISTS sessions (
            id text PRIMARY KEY, token_hash text, level integer NOT NULL CHECK (level IN (1,2)),
            created_at timestamptz NOT NULL DEFAULT now(), last_active timestamptz NOT NULL DEFAULT now(),
            expires_at timestamptz NOT NULL, status text NOT NULL DEFAULT 'active'
                CHECK (status IN ('active','ended','expired','locked')),
            docs_used integer NOT NULL DEFAULT 0, questions_used integer NOT NULL DEFAULT 0,
            history jsonb NOT NULL DEFAULT '[]', pages_total bigint NOT NULL DEFAULT 0,
            bytes_total bigint NOT NULL DEFAULT 0, llm_calls bigint NOT NULL DEFAULT 0,
            tokens_total bigint NOT NULL DEFAULT 0, guardrail_rejections integer NOT NULL DEFAULT 0,
            end_reason text, ended_at timestamptz);

ALTER TABLE sessions ADD COLUMN IF NOT EXISTS data_deleted_at timestamptz;

ALTER TABLE sessions ADD COLUMN IF NOT EXISTS notice_accepted boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS sessions_token_hash ON sessions(token_hash);
CREATE INDEX IF NOT EXISTS sessions_live ON sessions(expires_at,last_active) WHERE status IN ('active','locked');
CREATE INDEX IF NOT EXISTS sessions_cleanup ON sessions(data_deleted_at) WHERE status IN ('ended','expired');
CREATE INDEX IF NOT EXISTS sessions_pending_cleanup ON sessions(id) WHERE status IN ('ended','expired') AND data_deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS ingest_jobs (
            id text PRIMARY KEY, session_id text NOT NULL REFERENCES sessions(id),
            status text NOT NULL DEFAULT 'queued', stage text NOT NULL DEFAULT 'queued',
            duplicate boolean NOT NULL DEFAULT false, chunks integer NOT NULL DEFAULT 0,
            flagged_chunks integer NOT NULL DEFAULT 0, error_code text,
            pages integer NOT NULL DEFAULT 0, bytes bigint NOT NULL DEFAULT 0,
            reserved boolean NOT NULL DEFAULT true,
            created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
            finished_at timestamptz);

ALTER TABLE ingest_jobs ADD COLUMN IF NOT EXISTS document_hash text;

CREATE UNIQUE INDEX IF NOT EXISTS ingest_jobs_running_session ON ingest_jobs(session_id) WHERE status NOT IN ('done','failed');

ALTER TABLE sessions ADD COLUMN IF NOT EXISTS failed_attempts integer NOT NULL DEFAULT 0;

ALTER TABLE ingest_jobs ADD COLUMN IF NOT EXISTS error_status integer;

ALTER TABLE ingest_jobs ADD COLUMN IF NOT EXISTS error_detail text;

CREATE TABLE IF NOT EXISTS provider_daily_usage (
            day date PRIMARY KEY, attempts bigint NOT NULL DEFAULT 0);

-- Shared exact-search rows: Step 2 scopes by authenticated session BEFORE top-20.
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS collection text;
CREATE UNIQUE INDEX IF NOT EXISTS sessions_collection ON sessions(collection);
CREATE TABLE IF NOT EXISTS session_vectors (
    session_id text NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    id integer NOT NULL,
    embedding public.vector(768) NOT NULL,
    PRIMARY KEY (session_id, id)
);
CREATE TABLE IF NOT EXISTS stage1_index_state (
    name text PRIMARY KEY, signature text NOT NULL,
    session_id text REFERENCES sessions(id) ON DELETE CASCADE
);
ALTER TABLE stage1_index_state ADD COLUMN IF NOT EXISTS session_id text REFERENCES sessions(id) ON DELETE CASCADE;
ALTER TABLE session_vectors ENABLE ROW LEVEL SECURITY;
ALTER TABLE session_vectors FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS owned_vectors ON session_vectors;
CREATE POLICY owned_vectors ON session_vectors TO rag_app
    USING (session_id = NULLIF(current_setting('app.session_id', true), ''))
    WITH CHECK (session_id = NULLIF(current_setting('app.session_id', true), ''));
ALTER TABLE stage1_index_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE stage1_index_state FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS owned_index_state ON stage1_index_state;
CREATE POLICY owned_index_state ON stage1_index_state TO rag_app
    USING (session_id = NULLIF(current_setting('app.session_id', true), ''))
    WITH CHECK (session_id = NULLIF(current_setting('app.session_id', true), ''));
-- Metadata is a service control plane; API operations bind the authenticated id.
REVOKE ALL ON ALL TABLES IN SCHEMA rag FROM PUBLIC, rag_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON sessions, ingest_jobs, provider_daily_usage,
    stage1_index_state TO rag_app;
GRANT SELECT, INSERT, DELETE ON session_vectors TO rag_app;
ALTER ROLE rag_app SET search_path = rag, public;
ALTER ROLE rag_app SET statement_timeout = '10s';
ALTER ROLE rag_app SET lock_timeout = '2s';
ALTER ROLE rag_app SET idle_in_transaction_session_timeout = '10s';
ALTER ROLE rag_app SET transaction_timeout = '10s';
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
               WHERE n.nspname='rag' AND c.relowner=(SELECT oid FROM pg_roles WHERE rolname='rag_app'))
       OR EXISTS (SELECT 1 FROM pg_namespace WHERE nspname='rag'
                  AND nspowner=(SELECT oid FROM pg_roles WHERE rolname='rag_app')) THEN
        RAISE EXCEPTION 'rag_app must not own schema or tables';
    END IF;
END $$;
COMMIT;
-- Enable LOGIN and set a password through the owner's private role-management workflow.
-- Do not grant rag_app to the app as an owner role; use its own login with TLS verify-full.
