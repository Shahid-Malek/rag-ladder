# Hosting

This guide covers how the frontend is served today and how the L1/L2 backend is designed to be deployed. L3 is meant to run locally and is not part of the hosted design.

## Status

| Part | State |
| --- | --- |
| Frontend | Static Astro build on Cloudflare Pages, served at `https://projects.shahidmalek.com/rag-ladder/` through a Cloudflare Worker. |
| Live demo | Locked in the frontend (`DEMO_LOCKED = true` in `web/src/components/SafeTryDemo.tsx`); no backend API URL is configured. |
| Backend (L1/L2) | **Not deployed.** The design below is complete, but no real image build, model load, database/tunnel/provider call or VM provisioning has been performed. |
| Host | **Not chosen yet.** Oracle Cloud free-tier signup failed; Google Cloud is the likely alternative. |

The Dockerfile and Compose file currently target `linux/arm64`, and the hashed locks were compiled for `aarch64-manylinux_2_28`. An x86-64 VM would need the `platform` settings changed and both locks recompiled for that platform.

## Frontend hosting

- **Cloudflare Pages** builds `web/`: root directory `web`, build command `npm run build`, output directory `dist`, Node 22.23.4 or newer. The build reads `../results/`, so the whole repository must be available to the build.
- **Cloudflare Worker** on `projects.shahidmalek.com` routes `/rag-ladder/*`: it strips the `/rag-ladder` prefix, fetches the path from the Pages site, and re-adds the prefix to relative `Location` headers on redirects.
- `web/astro.config.mjs` hard-codes `site` and `base`, so page links, canonical URLs and the sitemap use `/rag-ladder/`, while `_redirects` and `_headers` stay unprefixed because Pages sees unprefixed paths.
- Security headers (CSP, `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`) are generated into `dist/_headers` at build time. See [web/README.md](web/README.md).

## Backend images and dependencies

Compose builds `Dockerfile` targets `app` and `parser`, both `python:3.12-slim-bookworm` for linux/arm64; cloudflared uses release 2026.10.7. The app lock resolves 60 hashed packages and the parser lock 80. `requirements-hosted.in/.txt` and `requirements-parser.in/.txt` are the roots and resolved locks; the full local `requirements.txt` stays separate. No Docling, RapidOCR, Qdrant, FlagEmbedding, LangGraph or CUDA packages enter either hosted image. ONNX Runtime belongs to the L2 PyMuPDF Layout parser and stays only in the parser image. The app image keeps the L3 source to satisfy an eager import, but hosted L3 and admin routes are disabled and L3's optional dependencies and models are absent.

The two hashed locks cover hosted L1/L2 only. Local L3 uses the full `requirements.txt`, which is not a complete hashed lock.

The app build bakes immutable BGE-small, BGE-base and prompt-injection-classifier Hugging Face snapshots and verifies loading them with socket connections forbidden. The parser build verifies synthetic PDF parsing and OCR with sockets forbidden; PyMuPDF Layout assets come from its pinned wheel and Tesseract English from the OS package. Runtime Hugging Face/Transformers access is offline, and weights are read-only. Digest capture, native ABI compatibility and advisory checks still need the real build host.

```sh
uv pip compile requirements-hosted.in --python-version 3.12 --python-platform aarch64-manylinux_2_28 --torch-backend cpu --extra-index-url https://download.pytorch.org/whl/cpu --only-binary :all: --no-python-downloads --no-config --no-header --no-annotate --generate-hashes --emit-index-url -o requirements-hosted.txt
uv pip compile requirements-parser.in --python-version 3.12 --python-platform aarch64-manylinux_2_28 --only-binary :all: --no-python-downloads --no-config --no-header --no-annotate --generate-hashes -o requirements-parser.txt
```

## Secrets, ingress and storage

Set `RAG_APP_ENV_FILE`, `RAG_TUNNEL_TOKEN_FILE` and `RAG_RUNTIME_DIR` to absolute paths outside the repository. Run Compose as `docker compose --env-file /dev/null ...` so it does not load a project `.env` automatically. The app environment file holds app, Neon, Turnstile and provider settings only, never the tunnel token. The token is a separate file-backed secret readable only by the owner and the tunnel UID 65532. Do not print the resolved Compose configuration: it contains secret values. The image disables dotenv, and SlowAPI uses the explicit empty `limiter.conf` instead of looking for a `.env` in the working directory.

Hosted configuration requires an exact HTTPS `PUBLIC_ORIGIN`, the same origin as the only `CORS_ORIGINS` entry, a matching `TURNSTILE_HOSTNAME`, and non-empty Turnstile action, secret and site key.

No ports are published. The internal ingress subnet `172.30.0.0/29` has the tunnel at `172.30.0.2` and the app at `172.30.0.3`; only the tunnel IP is trusted for Cloudflare headers, and `X-Forwarded-For` is ignored. App and tunnel have separate outbound bridges; the parser has `network_mode: none`. Configure the managed tunnel origin as `http://app:8000`, with the expected public host, HTTPS and a fallback 404. Check for subnet conflicts and deny all inbound IPv4/IPv6 at both the cloud firewall and the host firewall. Root administrators can still reach bridge IPs.

On the VM, the owner runs `sudo ./provision_runtime_dir.sh /var/lib/rag-runtime.img /srv/rag-runtime`. It creates a dedicated 1 GiB ext4 loop filesystem, mounts it `nodev,nosuid,noexec`, sets UID/GID 10001 and mode 0700, and refuses unknown existing images, symlinks or non-empty unmounted targets. It prints the exact `/etc/fstab` line to add once; verify persistence across a reboot before starting Compose. It never formats an existing unknown device or file. `container_start.py` independently rejects an unmounted, oversized or unwritable runtime. Keep this filesystem across restarts and `down`/`up`: `capacity.json`, watchdog state and session files are durable. Losing those ledgers is a NO-GO; never erase them to bypass a limit or lock.

## Parser boundary

The **only** cross-container mount is Docker's `local` volume driver with `type=tmpfs`, `device=tmpfs`, `o=size=1m,mode=0750,uid=10002,gid=10002,nodev,nosuid,noexec`, mounted at `/run/parser-ipc`. Parser UID/GID 10002 has read-write access; app UID 10001 mounts it read-only with supplementary GID 10002. The parser creates socket `parser.sock` with mode 0660; the group can connect but cannot write the directory, and the app's read-only mount prevents create/unlink. Unix-socket connect through that read-only mount must be proven on the real kernel.

The normal service creates only a socket inode. A compromised parser could write other files inside the 1 MiB IPC mount, but the app only connects to the hard-coded socket and never reads, executes or loads configuration from those files. The app sends bounded upload bytes and metadata; the parser writes them to its private `/app/.cache/parser` tmpfs (256 MiB), with a separate private 32 MiB `/tmp`. App code, config, models and runtime paths are never mounted into the parser. Parser root, code and config are image-owned and read-only. The worker environment is an explicit secretless allowlist: no app env file, database URL, keys, model cache or Docker socket. All hosted PDF/image validation, conversion, extraction and hidden-span inspection happen in per-job parser children, and the app validates returned owner, pages, text, flags and size before using them.

A timeout or client disconnect kills and reaps the parser job group. Crash, OOM or malformed output produces a generic 503 `parser_unavailable` with no user strike; losing the connection or container is handled the same way. The supervisor exits 70 after a job failure and Compose restarts only the parser, with a 3 s launch delay. The app stays up and can still answer over existing documents; uploads fail safely while the parser recovers. Uploads are never replayed automatically.

## Sessions and limits

`GET /` and `GET /notice` show the data policy before upload. `POST /session` accepts level 1 or 2 and requires a valid Turnstile token plus `notice_accepted: true`; verification binds hostname, action and age and rejects expired or reused challenges. Work uses the session bearer token; no administrative key belongs in a browser.

Defaults: four active or locked sessions; two documents and ten admitted questions per session (failed generations count); one ingest and two questions at a time; sixteen in-flight HTTP requests and four database connections. Request, ingest and LLM budgets default to 90, 180 and 60 seconds, with bounded upstream I/O and SQL timeouts.

## Watchdog, resources and deletion

A separate lightweight parent process supervises the single Uvicorn process group. Before native question, upload or background ingest work, start time, deadline and session are durably written, fsynced and acknowledged over a private inherited socketpair. Completion is recorded only after the work really stops. At deadline + 2 s the parent persists a lock on the triggering session, SIGKILLs and reaps the app group, and exits so Compose restarts it. Stale acknowledged starts lock conservatively after any crash; corrupt or unwritable state fails closed. The parent shares the app's cgroup but has its own interpreter; real scheduler and kill latency still need VM proof.

Compose configures persisted restart backoff of 10, 20, 40 … 300 seconds, reset by ten minutes of healthy operation. The parent waits before spawning the app, so this does not depend on Swarm-only restart delays. Every app restart reloads three models and interrupts all in-flight requests; the killed request may see a tunnel gateway error. Startup applies targeted session locks before readiness. Kill recovery fetches at most five indexed live-session or pending-job rows, reconciles metadata and local files, and runs no vector counts, vector DDL or catalog scans. Due cleanup runs later; orphan retention is scheduled after ten minutes. Startup has its own 300 s watchdog deadline. Healthchecks alone do not cause restarts.

Caps: app 1.5 CPU / 6 GiB / 192 PIDs; parser 0.25 CPU / 2 GiB / 64 PIDs; tunnel 0.25 CPU / 256 MiB / 32 PIDs; no swap beyond each RAM cap. Temp and shared-memory mounts are explicitly bounded. Runtime admission (512 MiB) sits inside the 1 GiB filesystem; database admission is 250 MiB with a 64 MiB ingest reserve. A durable activity ledger gates new work with ten-minute reservations and a default one-hour-per-day ceiling; it is **not** a Neon compute-hour meter. These are configured ceilings, not measured capacity; check the chosen provider's current free-tier limits and real peaks. JSON logs rotate at 1 MiB × 3 per service; app metadata traces are capped at 1 MiB per day for 30 days; terminal summaries and provider counters are kept 30 days. No prompts or documents belong in logs.

Deletion first commits token/history revocation and a terminal tombstone, then deletes owned vectors, index state, jobs, BM25 data and files under work locks; success sets `data_deleted_at`. Failures keep retryable tombstones. End, TTL, restart and orphan paths are idempotent. Startup removes abandoned local staging and uploads; vector foreign keys prevent ownerless shared rows. Empty installations do not poll Neon; active-session orphan maintenance runs every ten minutes and terminal retention only when due. Provider records and Neon backups are outside the live-data deletion guarantee.

## Neon

Run `neon_setup.sql` as the owner in a **fresh, dedicated PostgreSQL 17+ database**. It is transactional and idempotent: it creates owner-owned `rag` tables and the extension, creates `rag_app` as NOLOGIN, revokes CREATE/TEMP and grants only the required DML. Enable the role's login and set its password privately afterwards. No legacy per-table migration is attempted. The hosted pool forces `rag_app`, TLS `verify-full` with the system CA bundle, a `rag,public` search path and statement/lock/transaction limits. Startup checks live TLS, a non-owner, non-BYPASSRLS identity with no role memberships, no schema or database CREATE rights, and forced RLS on the tables. No schema DDL or TRUNCATE runs at runtime.

The authenticated session scope must match the hashed collection before any database work. Each vector transaction sets a local `app.session_id`, and an explicit session `WHERE` precedes the exact cosine sort and top 20. Forced RLS also covers index state. Session metadata is a shared service control plane with authenticated-ID predicates, not RLS isolation from a compromised app role or process. BM25 stays per session; RRF (k=60), stable ties and the final 5 are unchanged.

## Pending real-VM checks

None of these have been run. All must pass before the backend is deployed or the demo is unlocked:

- [ ] ARM (or rebuilt x86-64) image build, model and OCR startup, and memory peaks
- [ ] Container, socket and network confinement on the real kernel, including connect through the read-only IPC mount
- [ ] Watchdog kill/restart timing and model reload time
- [ ] Runtime mount and ledger persistence across reboot
- [ ] IPv4/IPv6 cloud and host firewalls; tunnel origin and Turnstile hostname/action
- [ ] Live Neon role, TLS, RLS, pool reset and deletion behaviour
- [ ] Provider account storage/compute limits and retention
- [ ] Image configuration, history and every layer inspected for private files and credentials, including files deleted by later layers

References: [Compose services](https://docs.docker.com/reference/compose-file/services/), [local volumes](https://docs.docker.com/reference/compose-file/volumes/), [tmpfs limits](https://docs.docker.com/engine/storage/tmpfs), [Cloudflare token-file](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/configure-tunnels/run-parameters/), [PostgreSQL RLS](https://www.postgresql.org/docs/current/ddl-rowsecurity.html), [libpq verified TLS](https://www.postgresql.org/docs/18/libpq-ssl.html).
