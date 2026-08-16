import assert from 'node:assert/strict';
import { test } from 'node:test';
import { inspectXlsxZip } from '../src/loaders/xlsxPreflight';

test('XLSX preflight rejects malformed and unsafe ZIP input before parsing', () => {
  const result = inspectXlsxZip(new Uint8Array([1, 2, 3]));
  assert.equal(result.entries.length, 0);
  assert.equal(result.diagnostics[0]?.code, 'INVALID_ZIP');
});

test('static boundary has no API route directory', async () => {
  const fs = await import('node:fs/promises');
  await assert.rejects(fs.access('app/api'));
});
