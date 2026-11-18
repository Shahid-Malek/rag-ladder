import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

for (const locked of [true, false]) {
  test(`demo lock ${locked ? 'replaces' : 'restores'} the live demo for both levels`, async () => {
    const server = await createServer({
      root: fileURLToPath(new URL('..', import.meta.url)),
      configFile: false,
      envFile: false,
      logLevel: 'silent',
      server: { middlewareMode: true },
      esbuild: { jsx: 'automatic' },
      resolve: {
        alias: { '@': fileURLToPath(new URL('../src', import.meta.url)) },
      },
      plugins: locked
        ? []
        : [
            {
              name: 'unlock-demo-for-test',
              transform(source, id) {
                if (id.endsWith('/SafeTryDemo.tsx'))
                  return source.replace(
                    'DEMO_LOCKED = true',
                    'DEMO_LOCKED = false',
                  );
              },
            },
          ],
    });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = () => {
      throw new Error('The locked view must not request data');
    };
    try {
      const { default: Demo, DEMO_LOCKED } = await server.ssrLoadModule(
        '/src/components/SafeTryDemo.tsx',
      );
      assert.equal(DEMO_LOCKED, locked);
      for (const level of [1, 2]) {
        const html = renderToStaticMarkup(createElement(Demo, { level }));
        if (locked) {
          assert.equal((html.match(/aria-disabled="true"/g) || []).length, 2);
          assert.match(html, /Upload a PDF/);
          assert.match(html, /Your question/);
          assert.match(html, /Coming soon/);
          assert.doesNotMatch(html, /<input|<textarea|\sdisabled(?:=|\s|>)/);
          assert.doesNotMatch(html, /Loading session|Start mock session/);
        } else {
          assert.match(html, /Loading session/);
          assert.doesNotMatch(html, /data-demo-locked/);
        }
      }
    } finally {
      globalThis.fetch = originalFetch;
      await server.close();
    }
  });
}
