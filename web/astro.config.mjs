import { writeFile } from 'node:fs/promises';
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import tailwindcss from '@tailwindcss/vite';
import { loadEnv } from 'vite';
import { fileURLToPath } from 'node:url';

// Served at https://projects.shahidmalek.com/rag-ladder/ by a Worker that strips
// /rag-ladder before fetching from Pages. HTML needs the prefix; Pages rules
// (_redirects sources, _headers patterns) must not have it.
const site = 'https://projects.shahidmalek.com';
const base = '/rag-ladder';

export default defineConfig({
  output: 'static',
  redirects: Object.fromEntries(
    ['l1', 'l2', 'l3'].flatMap((id, i) => {
      const slug = ['naive', 'intermediate', 'advanced'][i];
      return [
        [`/${id}/`, `${base}/${slug}/`],
        [`/${id}/how-it-works/`, `${base}/${slug}/?view=how-it-works`],
        [`/${id}/${i === 2 ? 'run-locally' : 'try'}/`, `${base}/${slug}/`],
      ];
    }),
  ),
  prefetch: { defaultStrategy: 'hover' },
  devToolbar: { enabled: false },
  site,
  base,
  integrations: [
    react(),
    {
      name: 'base-aware-redirects',
      hooks: {
        'astro:build:done': async ({ dir, pages = [] }) => {
          // public/_redirects is copied as-is: unprefixed, as Pages sees it.
          const canonical = pages
            .map((page) => `/${page.pathname.replace(/^\//, '')}`)
            .filter(
              (path) => !/^\/(?:l[123](?:\/|$)|404(?:\.|\/|$))/.test(path),
            );
          const htmlPaths = [
            ...new Set(
              canonical.flatMap((path) => [path, `${path}index.html`]),
            ),
          ];
          const apiBase = loadEnv(
            'production',
            fileURLToPath(new URL('.', import.meta.url)),
            'PUBLIC_',
          ).PUBLIC_API_BASE_URL;
          const apiOrigin =
            apiBase && !apiBase.startsWith('/') ? new URL(apiBase).origin : '';
          // Static Astro scripts/styles need inline execution; no eval or arbitrary script hosts.
          // DEMO_LOCKED (src/components/SafeTryDemo.tsx) means Turnstile never loads. When the demo
          // is unlocked, re-add https://challenges.cloudflare.com to script-src and connect-src, and
          // restore "frame-src https://challenges.cloudflare.com".
          const policy = [
            "default-src 'self'",
            "script-src 'self' 'unsafe-inline'",
            "style-src 'self' 'unsafe-inline'",
            "img-src 'self' data: blob:",
            "font-src 'self'",
            `connect-src 'self' https://api.github.com ${apiOrigin}`.trim(),
            "object-src 'none'",
            "base-uri 'self'",
            "form-action 'self'",
            "frame-ancestors 'none'",
          ].join('; ');
          const headers = [
            `/*\n  Content-Security-Policy: ${policy}\n  X-Content-Type-Options: nosniff\n  X-Frame-Options: DENY\n  Referrer-Policy: strict-origin-when-cross-origin\n  Permissions-Policy: camera=(), microphone=(), geolocation=()`,
            `/_astro/*\n  Cache-Control: public, max-age=31536000, immutable`,
            ...htmlPaths.map(
              (path) =>
                `${path}\n  Cache-Control: public, max-age=0, must-revalidate`,
            ),
          ];
          await writeFile(
            new URL('_headers', dir),
            headers.join('\n\n') + '\n',
          );
          const escape = (value) =>
            value
              .replaceAll('&', '&amp;')
              .replaceAll('"', '&quot;')
              .replaceAll('<', '&lt;')
              .replaceAll('>', '&gt;');
          const urls = canonical.map(
            (path) => new URL(`${base}${path}`, site).href,
          );
          await writeFile(
            new URL('sitemap.xml', dir),
            `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.map((url) => `<url><loc>${escape(url)}</loc></url>`).join('')}</urlset>`,
          );
          await writeFile(
            new URL('robots.txt', dir),
            `User-agent: *\nAllow: /\nSitemap: ${new URL(`${base}/sitemap.xml`, site).href}\n`,
          );
        },
      },
    },
  ],
  vite: { plugins: [tailwindcss()] },
});
