import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

test('static security headers allow the configured API origin, omit Turnstile while the demo is locked, and stay unprefixed', async () => {
  const keys = ['PUBLIC_API_BASE_URL'];
  const saved = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  const directory = await mkdtemp(join(tmpdir(), 'rag-stage-c-'));
  try {
    process.env.PUBLIC_API_BASE_URL = 'https://api.invalid/demo';
    const { default: config } = await import('../astro.config.mjs?stage-c');
    await config.integrations
      .find((item) => item.name === 'base-aware-redirects')
      .hooks['astro:build:done']({
        dir: pathToFileURL(directory + '/'),
        pages: [{ pathname: 'pipeline/' }],
      });
    const headers = await readFile(join(directory, '_headers'), 'utf8');
    assert.ok(headers.startsWith('/*\n  Content-Security-Policy:'));
    assert.match(
      headers,
      /connect-src 'self' https:\/\/api.github.com https:\/\/api.invalid;/,
    );
    assert.ok(!headers.includes('api.invalid/demo'));
    assert.match(headers, /script-src 'self' 'unsafe-inline';/);
    assert.ok(!headers.includes('challenges.cloudflare.com'));
    assert.match(
      headers,
      /object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'/,
    );
    assert.match(headers, /X-Content-Type-Options: nosniff/);
    assert.match(
      headers,
      /Permissions-Policy: camera=\(\), microphone=\(\), geolocation=\(\)/,
    );
    assert.ok(!headers.includes('unsafe-eval'));
  } finally {
    for (const key of keys) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
    await rm(directory, { recursive: true, force: true });
  }
});
