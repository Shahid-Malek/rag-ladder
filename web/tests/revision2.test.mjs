import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
test('Pipeline delivery rules are unprefixed for Pages and the sitemap uses the public /rag-ladder URL', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'rag-delivery-'));
  try {
    const { default: config } =
      await import('../astro.config.mjs?delivery-test');
    await config.integrations
      .find((item) => item.name === 'base-aware-redirects')
      .hooks['astro:build:done']({
        dir: pathToFileURL(directory + '/'),
        pages: [
          { pathname: 'pipeline/' },
          { pathname: 'l1/try/' },
          { pathname: '404.html' },
          { pathname: '' },
        ],
      });
    const xml = await readFile(join(directory, 'sitemap.xml'), 'utf8');
    assert.match(
      xml,
      /<loc>https:\/\/projects.shahidmalek.com\/rag-ladder\/pipeline\/<\/loc>/,
    );
    assert.ok(!xml.includes('l1/try'));
    assert.ok(!xml.includes('404'));
    const headers = await readFile(join(directory, '_headers'), 'utf8');
    assert.match(
      headers,
      /^\/_astro\/\*\n  Cache-Control: public, max-age=31536000, immutable/m,
    );
    assert.match(
      headers,
      /^\/pipeline\/\n  Cache-Control: public, max-age=0, must-revalidate/m,
    );
    assert.ok(!headers.includes('/*\n  Cache-Control: public, max-age=0'));
    assert.ok(!headers.includes('rag-ladder'));
    assert.match(
      await readFile(new URL('../public/_redirects', import.meta.url), 'utf8'),
      /^\/pipeline \/pipeline\/ 301$/m,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
