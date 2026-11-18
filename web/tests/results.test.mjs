import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import {
  parseCsv,
  exportResults,
  publicQuestion,
} from '../scripts/export-results.mjs';

test('public CSV preserves commas, quoted text, CRLF and newlines', () => {
  assert.deepEqual(
    parseCsv('id,text\r\nQ-1,"comma, and ""quote"""\r\nQ-2,"two\nlines"\r\n'),
    [
      ['id', 'text'],
      ['Q-1', 'comma, and "quote"'],
      ['Q-2', 'two\nlines'],
    ],
  );
  assert.throws(() => parseCsv('id,"unclosed'));
});
test('public export covers all approved IDs and preserves evidence and scores', async () => {
  await exportResults();
  const rows = JSON.parse(
    await readFile(
      new URL('../public/data/questions.json', import.meta.url),
      'utf8',
    ),
  );
  const source = JSON.parse(
    await readFile(
      new URL('../../results/final_results.json', import.meta.url),
      'utf8',
    ),
  );
  assert.equal(rows.length, 200);
  assert.equal(new Set(rows.map((row) => row.id)).size, 200);
  assert.equal(rows.filter((row) => row.answerable).length, 184);
  for (const row of rows) {
    const original = source.per_question.find((item) => item.id === row.id);
    assert.ok(row.question_text.length);
    assert.deepEqual(
      row.gold_evidence_pointers,
      original.gold_evidence_pointers,
    );
    for (const id of ['L1', 'L2', 'L3']) {
      for (const key of [
        'hit_at_1',
        'hit_at_5',
        'evidence_coverage_at_5',
        'failure_cause',
      ])
        assert.equal(row.levels[id][key], original.levels[id][key]);
      assert.ok(
        !/entry_hits|entry_ranks|child_to_parent/.test(
          row.levels[id].failure_detail || '',
        ),
      );
    }
    const guarded = publicQuestion(
      {
        ...original,
        private_key: 'never-export',
        levels: Object.fromEntries(
          Object.entries(original.levels).map(([id, score]) => [
            id,
            { ...score, internal_prompt: 'never-export' },
          ]),
        ),
      },
      row.question_text,
    );
    assert.ok(!JSON.stringify(guarded).includes('never-export'));
  }
});
