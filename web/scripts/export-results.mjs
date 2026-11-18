import { readFile, writeFile, mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';

export function parseCsv(text) {
  const rows = [];
  let row = [],
    field = '',
    quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') {
      if (quoted && text[i + 1] === '"') {
        field += '"';
        i++;
      } else quoted = !quoted;
    } else if (char === ',' && !quoted) {
      row.push(field);
      field = '';
    } else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += char;
  }
  assert(!quoted, 'Unclosed CSV field');
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

// Only approved public fields cross the static-export boundary.
export function publicQuestion(question, text) {
  return {
    id: question.id,
    question_type: question.question_type,
    subject: question.subject,
    answerable: question.answerable,
    evidence_logic: question.evidence_logic,
    required_evidence_count: question.required_evidence_count,
    annotated_evidence_entries: question.annotated_evidence_entries,
    gold_evidence_pointers: question.gold_evidence_pointers.map(
      ({ document, pages, entry, evidence_type, type_scope }) => ({
        document,
        pages,
        entry,
        evidence_type,
        type_scope,
      }),
    ),
    levels: Object.fromEntries(
      ['L1', 'L2', 'L3'].map((id) => {
        const score = question.levels[id];
        return [
          id,
          {
            hit_at_1: score.hit_at_1,
            hit_at_5: score.hit_at_5,
            evidence_coverage_at_5: score.evidence_coverage_at_5,
            failure_cause: score.failure_cause,
            failure_detail: score.failure_detail
              ? 'The saved diagnostics do not establish a more specific cause.'
              : null,
          },
        ];
      }),
    ),
    question_text: text,
  };
}

export async function exportResults() {
  const source = new URL('../../results/', import.meta.url);
  const evaluation = JSON.parse(
    await readFile(new URL('final_results.json', source), 'utf8'),
  );
  const [header, ...rows] = parseCsv(
    await readFile(new URL('questions_with_text.csv', source), 'utf8'),
  );
  assert.deepEqual(header, ['neutral_id', 'question_text']);
  const texts = new Map(rows.map(([id, text]) => [id, text]));
  assert.equal(texts.size, evaluation.n_total);
  const questions = evaluation.per_question.map((question) => {
    assert(texts.has(question.id), `Missing public question ${question.id}`);
    return publicQuestion(question, texts.get(question.id));
  });
  assert.equal(questions.length, evaluation.n_total);
  const directory = new URL('../public/data/', import.meta.url);
  await mkdir(directory, { recursive: true });
  await writeFile(
    new URL('questions.json', directory),
    JSON.stringify(questions),
  );
  console.log(
    `Exported ${questions.length} owner-reviewed public questions and evidence pointers.`,
  );
}
if (
  process.argv[1] &&
  import.meta.url === new URL(process.argv[1], 'file://').href
)
  await exportResults();
