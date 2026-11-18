# Frontend architecture

Astro builds every route to static HTML (`output: 'static'`). React is only used for islands that need state; everything else is Astro components plus small TypeScript modules wired to Astro's view-transition lifecycle (`astro:page-load` / `astro:before-swap`).

## Routes

| Route | Source | Notes |
| --- | --- | --- |
| `/rag-ladder/` | `src/pages/index.astro` | Overview, headline metrics, level sections |
| `/rag-ladder/{naive,intermediate,advanced}/` | `src/pages/[level]/index.astro` | One page per level; `?view=how-it-works` switches to the pipeline walkthrough. Naive and Intermediate include the (locked) demo; Advanced links to local setup |
| `/rag-ladder/pipeline/` | `src/pages/pipeline.astro` | Pipeline explorer; `?level=` selects levels |
| `/rag-ladder/compare/` | `src/pages/compare.astro` | Side-by-side stacks and metrics |
| `/rag-ladder/results/` | `src/pages/results.astro` | Saved evidence by level and question type |
| `/rag-ladder/{privacy,cookies}/` | `src/pages/*.astro` | Draft notices describing actual browser behaviour |
| 404 | `src/pages/404.astro` | `noindex`, no canonical |

Legacy `/l1/`, `/l2/`, `/l3/` paths are redirected by `public/_redirects` (Pages) and by the `redirects` map in `astro.config.mjs` (meta-refresh fallback).

## Base-aware routing

The site lives under `/rag-ladder`. `astro.config.mjs` sets `base`, so Astro exposes it as `import.meta.env.BASE_URL`. `withBase(path)` in `src/lib/paths.ts` is the single helper for internal links and explicit asset or data URLs: it prefixes the base once and returns already-prefixed paths unchanged. Hash links stay page-relative. Cloudflare-facing files (`_redirects`, `_headers`) are deliberately unprefixed; see [README.md](README.md#base-path-rag-ladder).

## Data flow

```text
../results/final_results.json ──import──> src/data/results.ts ──> src/data/evaluation.ts ──> pages (metrics, intervals, notes)
../results/final_results.json ─┐
../results/questions_with_text.csv ─┴─> scripts/export-results.mjs ──> public/data/questions.json ──> dist/data/questions.json
```

- `src/data/results.ts` imports the frozen JSON at build time, so headline numbers are never hand-typed. `evaluation.ts` derives the per-level stats the Overview and Compare pages show; `results.astro` builds its evidence view from the same object.
- `scripts/export-results.mjs` runs on `predev`/`prebuild`. It joins the approved question wording to the JSON by neutral ID, asserts that all 200 questions are present, and keeps only public fields (evidence pointers, per-level hits, coverage and failure labels). The output is git-ignored and regenerated on every build; no page currently fetches it.
- `src/data/levels.ts` holds the per-level stage descriptions and technology tiles, written to match the Python source. `src/data/site.ts` holds the repository link and the `repositoryPrivate` flag (now `false`, so the header shows a live GitHub star count).

## Islands

| Island | Hydration | Role |
| --- | --- | --- |
| `SafeTryDemo` → `LockedDemo` / `TryDemo` | `client:visible` | Demo panel; locked by `DEMO_LOCKED` |
| `ResultsWindow` | `client:visible` | URL-backed level selection over saved evidence |
| `LevelTabs` | `client:visible` | Comparison tabs |
| `PartsSelector` | `client:visible` | Level-section stage picker |
| `HeroSwarm` | `client:media` | Decorative cursor effect; loads only on hover-capable, fine-pointer devices with motion allowed |

`IslandBoundary` wraps islands so a render error shows a safe notice instead of a blank area. `TryDemo` talks to the backend only through `src/lib/api.ts` (typed, validated responses; bearer-token sessions; never an admin key), with uploads checked by `src/lib/uploads.ts` and errors explained by `src/lib/errors.ts`.

## Scripts and motion

- `src/scripts/site.ts` mounts page behaviour on every `astro:page-load` and cleans up on `astro:before-swap`: sliding toggles (`src/lib/controls.ts`), level views, metric counters and section reveals.
- `src/scripts/sections.ts` reveals sections once as they enter the viewport, using the shared observer in `src/lib/visibility.ts`. Above-the-fold content is never hidden.
- `src/scripts/pipeline.ts` with `src/lib/pipeline.ts` pins the pipeline diagram and slides stage cards in with GSAP ScrollTrigger. GSAP is loaded only here, and only when needed.
- `src/scripts/explorer.ts` handles level selection and scrolling in the pipeline explorer; `src/scripts/header.ts` keeps the header's active-route indicator in sync across navigations.

**Fallbacks:**
- With `prefers-reduced-motion: reduce`, the pipeline skips GSAP entirely and keeps the plain vertical card list, section reveals are skipped, and CSS animations are disabled.
- Without JavaScript, every page still renders its full static content and the pipeline cards stay a readable vertical list. The explorer shows a `<noscript>` notice with direct links to each level's walkthrough.
- If an animation module fails to load, the native layout is restored.

## Styling

Tailwind CSS v4 through `@tailwindcss/vite`; there is no Tailwind config file. Colours, type scale and motion tokens live in `@theme` in `src/styles/global.css`, and components use those tokens rather than raw values. The Inter variable font is self-hosted and preloaded.
