import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
test('legacy HTML redirects target the /rag-ladder base; Cloudflare redirects stay unprefixed', async () => {
  const { default: config } = await import('../astro.config.mjs');
  assert.equal(
    config.redirects['/l1/how-it-works/'],
    '/rag-ladder/naive/?view=how-it-works',
  );
  assert.equal(config.redirects['/l3/run-locally/'], '/rag-ladder/advanced/');
  // The Worker strips /rag-ladder before Pages, so rule sources must not carry it.
  const redirects = await readFile(
    new URL('../public/_redirects', import.meta.url),
    'utf8',
  );
  assert.ok(
    redirects.includes('/l1/how-it-works/ /naive/?view=how-it-works 301'),
  );
  assert.ok(!redirects.includes('rag-ladder'));
});
