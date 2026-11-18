# RAG-Ladder frontend

Static Astro site with React islands and Tailwind CSS v4. It explains the three RAG levels, compares their frozen evaluation results and hosts the (currently locked) L1/L2 demo. Production URL: <https://projects.shahidmalek.com/rag-ladder/>.

## Setup

Requires Node 22.23.4 or newer (Astro 7's minimum). Run everything from `web/`:

```sh
npm ci
npm run dev        # http://localhost:4321/rag-ladder/
```

The build reads `../results/`, so keep the whole repository checked out.

| Script | What it does |
| --- | --- |
| `npm run dev` | Dev server. `predev` first runs `scripts/export-results.mjs`. |
| `npm run build` | Static build into `dist/`. `prebuild` runs the same export. |
| `npm run preview` | Serves `dist/` locally. |
| `npm run check` | `astro check` type and template diagnostics. |
| `npm test` | Node's built-in test runner over `tests/*.test.mjs`. |

Astro telemetry is disabled in every script. The site has no analytics.

## Base path `/rag-ladder`

`astro.config.mjs` hard-codes `site = 'https://projects.shahidmalek.com'` and `base = '/rag-ladder'`. There are no environment variables for them; edit those two constants to move the site.

- Internal links and asset URLs go through `withBase()` in `src/lib/paths.ts`, which adds the prefix once and leaves already-prefixed paths alone.
- Canonical URLs, `og:url`, `og:image` and `sitemap.xml` use the full `https://projects.shahidmalek.com/rag-ladder/...` URLs.
- `public/_redirects` and the generated `dist/_headers` stay **unprefixed**, because Cloudflare Pages sees paths after the Worker has stripped `/rag-ladder`.

## Demo lock

`DEMO_LOCKED = true` in `src/components/SafeTryDemo.tsx` renders `LockedDemo` (a preview with a "Coming soon" dialog) instead of `TryDemo` on the Naive and Intermediate pages. No backend API is deployed, so nothing is called.

To unlock once the backend is live (see [../HOSTING.md](../HOSTING.md)):

1. Set `DEMO_LOCKED = false`.
2. Copy `.env.example` to `.env` and set `PUBLIC_API_BASE_URL` (the API origin, optionally with a path prefix) and `PUBLIC_TURNSTILE_SITE_KEY`. Both are embedded at build time; never put private keys here. With `PUBLIC_API_BASE_URL` empty, `TryDemo` runs a clearly labelled in-memory mock that makes no network requests.
3. Re-add `https://challenges.cloudflare.com` to the CSP in `astro.config.mjs` (see the comment there).
4. Configure the backend's `PUBLIC_ORIGIN`/`CORS_ORIGINS` and Turnstile hostname to match the site, then rebuild and redeploy.

## Deploying

**Cloudflare Pages:** root directory `web`, build command `npm run build`, output directory `dist`, Node 22.23.4+.

**Cloudflare Worker** on `projects.shahidmalek.com`: requests under `/rag-ladder/` have the prefix stripped and are fetched from the Pages site; relative `Location` headers on redirects get `/rag-ladder` added back.

## Headers and CSP

A build hook in `astro.config.mjs` writes `dist/_headers`, `dist/sitemap.xml` and `dist/robots.txt`:

- **Every path:** `Content-Security-Policy`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy: camera=(), microphone=(), geolocation=()`.
- **CSP:** `'self'` plus `https://api.github.com` (header star count) and the origin of `PUBLIC_API_BASE_URL` when set. Turnstile is left out while the demo is locked. Inline scripts and styles are allowed, as the static Astro output needs them; `eval` is not.
- **Caching:** `/_astro/*` assets are immutable for a year; HTML pages revalidate on every request.

Legacy short links (`/l1/`, `/l2/try/`, `/l3/run-locally/` and so on) redirect with 301s from `public/_redirects`, with Astro's meta-refresh pages as a fallback.

## Tests

`npm test` covers:
- the API client contract and error handling
- upload validation
- the results CSV/JSON export
- redirect, sitemap and header generation
- the demo lock in both states
- pipeline scroll planning

There is also a browser check of the locked demo, which needs Playwright and a running preview:

```sh
npm run build && npm run preview
node tests/demo-lock.browser.mjs    # TEST_BASE_URL defaults to http://127.0.0.1:4321
```

## Credits

| Source | Used for | License |
| --- | --- | --- |
| [shadcn/ui](https://ui.shadcn.com/docs/installation/astro) | UI primitives in `src/components/ui/` | MIT, restyled |
| [Watermelon](https://registry.watermelon.sh) | `error-3`, `file-upload-2`, `stats-2` | Registry sources, adapted |
| [React Bits](https://reactbits.dev) | `LatticeLoader`, `CallChip`, `SwarmCursor` | Registry sources, adapted |
| [Inter](https://github.com/rsms/inter) | Self-hosted variable font | SIL OFL 1.1 |
| [Lucide](https://lucide.dev/license) | Icons | ISC |
| [theSVG](https://thesvg.org) | Technology logos in `src/assets/logos/` | Per-icon licences in `src/assets/logos/credits.json` |

Logos remain trademarks of their owners. They render inline with `currentColor`. No GitHub token or other secret is part of the frontend.
