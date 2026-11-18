import assert from 'node:assert/strict';
import { validateFiles } from '../src/lib/uploads.ts';
const max = 5 * 1024 * 1024;
const pdf = { name: 'notes.pdf', type: 'application/pdf', size: max };
assert.equal(validateFiles([pdf], 1, 2, max), null);
assert.ok(validateFiles([pdf, pdf], 1, 1, max));
assert.ok(validateFiles([{ ...pdf, size: max + 1 }], 1, 2, max));
assert.ok(validateFiles([{ ...pdf, size: 0 }], 1, 2, max));
const image = { name: 'notes.JPG', type: 'image/jpeg', size: 100 };
assert.ok(validateFiles([image], 1, 2, max));
assert.match(validateFiles([image], 2, 2, max), /Only text PDFs/);
assert.ok(validateFiles([{ ...pdf, type: 'text/html' }], 1, 2, max));
assert.ok(validateFiles([{ ...pdf, name: 'notes.html' }], 2, 2, max));
assert.ok(validateFiles([], 1, 2, max));
console.log('Upload validation checks passed.');

assert.match(validateFiles([pdf], 1, 2, max, [pdf]), /already been added/);
assert.match(validateFiles([pdf, pdf], 1, 2, max), /already been added/);
assert.match(
  validateFiles([{ ...pdf, size: 38 * 1024 * 1024 }], 1, 2, max),
  /38 MB.*5 MB/,
);
assert.match(validateFiles([pdf], 1, 0, max), /Up to 2 documents/);
