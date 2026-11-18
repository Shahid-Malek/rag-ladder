import { test } from 'node:test';
import assert from 'node:assert/strict';
import { explain } from '../src/lib/errors.ts';
import { readSelection, selectionUrl } from '../src/lib/selection.ts';
import { publicNotice } from '../src/lib/api.ts';
test('error explanations never echo untrusted messages or unknown stages', () => {
  const secret = 'private-provider-key-and-stack';
  for (const error of [
    new Error(secret),
    { code: secret, stage: secret, status: 502 },
    { code: 'invalid_response', message: secret },
    { code: 'guardrail_blocked', message: secret },
  ])
    assert.ok(!JSON.stringify(explain(error, 'answering')).includes(secret));
  assert.match(
    explain({ stage: 'chunking' }, 'uploading').whatBroke,
    /splitting your notes into windows/,
  );
  assert.match(explain({ code: 'timeout' }).title, /too long/);
  assert.match(
    explain({ status: 410 }).whatBroke,
    /cleanup may still be pending/,
  );
  assert.match(explain({ status: 429 }).title, /free service/);
  assert.match(explain({ code: 'unsupported_browser' }).nextStep, /browser/);
  assert.match(explain({ code: 'chunk_load' }, 'page').nextStep, /Reload/);
});
test('selection parsing allowlists, deduplicates and orders shareable level slugs', () => {
  assert.deepEqual(readSelection(''), []);
  assert.deepEqual(readSelection('?levels=advanced,naive,naive,private'), [
    'naive',
    'advanced',
  ]);
  assert.equal(
    selectionUrl('https://example.test/results/?keep=yes', [
      'advanced',
      'naive',
    ]).searchParams.get('levels'),
    'naive,advanced',
  );
  assert.equal(
    selectionUrl('https://example.test/results/?levels=advanced', []).search,
    '',
  );
});
test('live notices use public level names', () => {
  assert.equal(publicNotice('L1 Level 2 L3'), 'Naive Intermediate Advanced');
});
