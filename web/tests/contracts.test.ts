import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decodeScalar, encodeScalar, serializeDeterministic } from '../src/engine/serialization';
import { loadCsv } from '../src/loaders/csvLoader';
import { compareTables } from '../src/engine/comparisonEngine';

test('ScalarV1 preserves tagged primitive values', () => {
  const values = [null, 'x', true, 3, 1.25, { a: 1 }];
  for (const value of values) assert.deepEqual(decodeScalar(encodeScalar(value)), value);
});

test('CSV loader handles quoted fields, duplicate headers, and offsets', () => {
  const result = loadCsv('title\nCode,Code\nA,"x,y"\n', { headerOffset: 1 });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.value.headers, ['Code', 'Code_2']);
  assert.equal(decodeScalar(result.value.rows[0][1]), 'x,y');
});

test('CSV loader rejects oversized input before table allocation', () => {
  const result = loadCsv('id\n1\n2\n', { maxRows: 1 });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.diagnostics[0]?.code, 'RESOURCE_LIMIT');
});

test('canonical serialization is deterministic', () => {
  assert.equal(serializeDeterministic({ b: 2, a: 1 }), '{"a":1,"b":2}');
});

test('browser engine emits one row per key and duplicate diagnostics', () => {
  const left = { headers: ['id', 'value'], rows: [['a', '1'], ['a', '2']].map(([id, value]) => [encodeScalar(id), encodeScalar(value)]), headerOffset: 0, delimiter: ',' };
  const right = { headers: ['id', 'value'], rows: [['a', '1']].map(([id, value]) => [encodeScalar(id), encodeScalar(value)]), headerOffset: 0, delimiter: ',' };
  const result = compareTables(left, right, { keyColumns: ['id'], compareColumns: ['value'] });
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].status, 'duplicate');
  assert.equal(result.rows[0].displayStatus, '중복 키');
});

test('browser engine maps different key and value columns between sheets', () => {
  const left = { headers: ['left_id', 'left_value'], rows: [[encodeScalar('A'), encodeScalar(10)]], headerOffset: 0, delimiter: '' };
  const right = { headers: ['right_id', 'right_value'], rows: [[encodeScalar('A'), encodeScalar(10)]], headerOffset: 0, delimiter: '' };
  const result = compareTables(left, right, {
    keyColumns: ['left_id'],
    keyColumnsB: ['right_id'],
    rules: [{ id: 'value', columnA: 'left_value', columnB: 'right_value', dataType: 'number' }],
  });
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].status, 'matched');
});

test('ScalarV1 decoder rejects malformed payloads', () => {
  assert.throws(() => decodeScalar({ version: 1, type: 'float', value: Number.NaN } as any));
  assert.throws(() => decodeScalar({ version: 1, type: 'datetime', value: '2026-01-01T00:00:00' } as any));
});
