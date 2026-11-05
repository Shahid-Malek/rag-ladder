# RAG ladder

L1/L2 document-question demo with local embeddings and injection checks. L3 and evaluation tooling remain optional private workflows; no dataset file is needed for the session API.

The deployment target is an Oracle ARM VM with **2 OCPU / 12 GB RAM**, Docker Compose, Cloudflare Tunnel as the only public path, server-verified Turnstile and external Neon pgvector. Compose now contains app, isolated parser and cloudflared; **no ports are published**. Real image/VM/Neon checks remain mandatory before deployment or public release: see [HOSTING.md](HOSTING.md).

## Hosted setup

Use Python3.12/Linux ARM64. Read [HOSTING.md](HOSTING.md) for build targets, hashed dependency locks, secret-file paths, exact socket permissions, resource limits and recovery behavior. The hosted app/parser locks are separate from the full private `requirements.txt`; L3/evaluation dependencies and models stay out of hosted images.

On the VM, the owner runs [provision_runtime_dir.sh](provision_runtime_dir.sh) to create a dedicated1GiB persistent filesystem. Add its printed mount entry once and verify reboot persistence. Never point the app at an ordinary unbounded directory or erase its capacity/watchdog ledgers to reset limits. The script refuses unknown existing images and nonempty mount targets.

Run [neon_setup.sql](neon_setup.sql) in the Neon owner's SQL editor on a fresh dedicated PG17+ database. It creates owner-owned schema/tables and a minimum-rights NOLOGIN `rag_app`; enable login/set its password privately afterward. Hosted connections force that identity, TLS verify-full and a trusted CA bundle. Startup checks the non-owner role, forced RLS and live TLS. The app never creates/drops schemas or vector tables. This setup does not migrate old per-session tables.

Set `RAG_APP_ENV_FILE`, `RAG_TUNNEL_TOKEN_FILE` and `RAG_RUNTIME_DIR` to absolute external paths. Put app/Neon/Turnstile/provider settings in the app-only env file; keep the tunnel token separate, never in app env or code. Use `docker compose --env-file /dev/null ...` only after the real deployment gates are approved, so Compose does not load a project `.env` automatically. Never print resolved Compose configuration or credential values. Model weights are baked and checked offline at build time; runtime constructors are local-only and missing assets fail startup.

Hosted configuration requires exact HTTPS `PUBLIC_ORIGIN`, identical sole `CORS_ORIGINS`, matching `TURNSTILE_HOSTNAME`, and nonempty action/secret/public-site-key. Compose trusts only tunnel172.30.0.2; raw Uvicorn peers are checked, XFF is ignored. Configure the managed tunnel origin `http://app:8000` and deny inbound IPv4/IPv6 in Oracle and host firewalls. Headers, host/proto/origin checks, body/response limits, IP/session rate limits and disabled hosted admin/docs routes remain enforced.

## Sessions, data and isolation

GET `/` and `/notice` show the data policy before upload. POST `/session` accepts levels1/2 and requires a valid Turnstile token plus Boolean `notice_accepted:true`; verification binds hostname/action/age and rejects expired/reused challenges. Use session Bearer tokens for work; no administrative key belongs in a browser.

Defaults: four active/locked sessions, two documents and ten admitted questions per session (failed generations count); one ingest, two questions, sixteen in-flight HTTP requests and four DB connections. Physical caps are app6GiB/1.5CPU, parser2GiB/0.25CPU and tunnel256MiB/0.25CPU. Runtime admission512MiB sits inside the dedicated1GiB filesystem; DB admission250MiB with64MiB ingest reserve. Check current free-tier entitlements and ARM peaks rather than treating caps as performance measurements.

All hosted native PDF/image validation, conversion, extraction and hidden-span work runs in the secretless, network-none parser container. Its only app-shared path is a1MiB socket tmpfs, parser RW/app RO; app never executes or reads configuration from it. A parser crash/OOM returns generic503, restarts parser and leaves app up. The exact volume/UID/GID permissions and private scratch bounds are in HOSTING.md.

L2 vectors are keyed by session/id with forced RLS and transaction-local ownership context. Ownership constrains exact cosine candidates **before top20**. BM25 corpus statistics/top20 stay per-session, RRF60 and final5 stay unchanged; L1 still uses exact FAISS. Session metadata remains a service control plane, not protection from a compromised app process/DB role. Live pgvector/RLS/pool behavior is still a deployment check.

Request/ingest/LLM budgets default to90/180/60seconds, with bounded upstream IO and SQL timeouts. An independent watchdog durably registers native work; at deadline+2s it records the triggering session lock and kills/reaps the app process group. Compose-configured persisted backoff is10/20/40/.../300seconds. Restart interrupts all in-flight requests and reloads three models. Before readiness, targeted session locks are applied and post-kill recovery uses bounded metadata/local files, with no heavy vector/storage queries. Actual OS kill latency/reload time must be measured.

End/TTL/restart/orphan cleanup revokes token/history first and retains retryable tombstones until owned vectors/index state/jobs/BM25/files are removed. Logs contain bounded operational metadata only (1MiB x3/container; app daily cap and30-day retention). A durable activity ledger gates new work using conservative ten-minute reservations and a default one-hour/day ceiling; it is **not** a Neon CU-hour meter. Provider records and Neon backups may outlast live-data deletion. Use only non-sensitive material you are permitted to share.

## Private local workflows and publication

For private local CLI/L3/evaluation use `HOSTED_MODE=false`, the full `requirements.txt` and separately provisioned assets/services. Local `.env` loading remains an explicit private workflow; hosted images disable it. Copy `.env.example` privately when needed; examples contain variable names/blank values only. `datasets.local.json` is optional, ignored and validated; no example dataset is loaded implicitly. Never commit source documents, questions, caches, embeddings or saved private results.

This export has no Git metadata. [Architecture flows](flow_diagrams.md) are self-contained; no absent private architecture report is required. Private progress/security/conformance reports stay excluded from Git and image contexts. Initialization, commits and publication remain owner actions, subject to the live deployment checks in [HOSTING.md](HOSTING.md); there is no public-release approval in this implementation.
