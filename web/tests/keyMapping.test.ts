import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compareTables, type ComparisonConfig } from '../src/engine/comparisonEngine';
import type { Table } from '../src/engine/contracts';
import { decodeScalar, encodeScalar } from '../src/engine/serialization';
import { applyKeyMapping, buildMapping, groupsFromWideTable, mappingFromJson, mappingToJson } from '../src/mapping/keyMapping';
import { remapConfig, type BrowserTemplateV2 } from '../src/templates/remap';

function table(headers: string[], rows: unknown[][]): Table {
  return { headers, rows: rows.map(row => row.map(encodeScalar)), headerOffset: 0, delimiter: ',' };
}

const groups = [
  { canonical: 'DUNS', aliases: ['빨강', '파랑', '노랑', '주황', '초록'] },
  { canonical: '고구마', aliases: ['수박', '파도', '비행', '땅'] },
];

function mappingConfig(leftKey = 'company', rightKey = 'company'): Pick<ComparisonConfig, 'keyMappings' | 'keyNormalization'> {
  const dictionary = buildMapping(groups, { trim: true });
  return {
    keyNormalization: { trim: true },
    keyMappings: {
      A: { [leftKey]: { enabled: true, dictionary } },
      B: { [rightKey]: { enabled: true, dictionary } },
    },
  };
}

test('wide mapping uses arbitrary selected headers and variable alias columns', () => {
  const source = table(['업체', '다른이름', '구명칭', '약칭'], [
    ['DUNS', '빨강', '파랑', '노랑'],
    ['고구마', '수박', '파도', ''],
  ]);
  const selected = groupsFromWideTable(source, '업체', ['다른이름', '구명칭', '약칭']);
  const dictionary = buildMapping(selected);

  assert.equal(dictionary.applicable, true);
  assert.equal(dictionary.aliasToCanonical.DUNS, 'DUNS');
  assert.equal(dictionary.aliasToCanonical['빨강'], 'DUNS');
  assert.equal(dictionary.aliasToCanonical['파도'], '고구마');
  assert.equal(dictionary.stats.emptyAliasCellCount, 1);
});

test('all noncanonical columns can be selected as aliases without a fixed limit', () => {
  const headers = ['기준명', ...Array.from({ length: 21 }, (_, index) => `명칭${index + 1}`)];
  const source = table(headers, [['표준', ...Array.from({ length: 21 }, (_, index) => `별칭${index + 1}`)]]);
  const selected = groupsFromWideTable(source, '기준명', headers.filter(header => header !== '기준명'));
  const dictionary = buildMapping(selected);

  assert.equal(dictionary.stats.aliasCount, 21);
  assert.equal(dictionary.stats.mappingItemCount, 22);
});

test('normalization precedes mapping and unmapped keys remain unchanged', () => {
  const dictionary = buildMapping(groups, { trim: true });
  assert.deepEqual(applyKeyMapping(' 빨강 ', { enabled: true, dictionary }, { trim: true }), {
    original: ' 빨강 ', normalized: '빨강', standard: 'DUNS', applied: true, mappingEnabled: true, canonical: 'DUNS', alias: '빨강', group: 'DUNS',
  });
  assert.equal(applyKeyMapping('보라', { enabled: true, dictionary }, { trim: true }).standard, '보라');
});

test('case normalization, alias collisions, and canonical alias chains are validated', () => {
  const caseConflict = buildMapping([
    { canonical: 'FIRST', aliases: ['ABC'] },
    { canonical: 'SECOND', aliases: ['abc'] },
  ], { caseInsensitive: true });
  assert.equal(caseConflict.applicable, false);
  assert.ok(caseConflict.issues.some(issue => issue.code === 'NORMALIZED_ALIAS_CONFLICT'));

  const chainConflict = buildMapping([
    { canonical: 'DUNS', aliases: ['빨강'] },
    { canonical: 'ABC', aliases: ['DUNS'] },
  ]);
  assert.equal(chainConflict.applicable, false);
  assert.ok(chainConflict.issues.some(issue => issue.code === 'CANONICAL_ALIAS_CONFLICT'));
});

test('mapping diagnostics report duplicate rows, duplicate aliases, empty cells, and aliasless groups', () => {
  const dictionary = buildMapping([
    { canonical: 'DUNS', aliases: ['빨강', ''] },
    { canonical: 'DUNS', aliases: ['빨강', ''] },
    { canonical: '고구마', aliases: [] },
  ]);
  const codes = new Set(dictionary.issues.map(issue => issue.code));

  assert.ok(codes.has('DUPLICATE_ROW'));
  assert.ok(codes.has('DUPLICATE_ALIAS'));
  assert.ok(codes.has('ALIASLESS_GROUP'));
  assert.equal(dictionary.stats.emptyAliasCellCount, 2);
});

test('direct groups save to JSON and load without file persistence', () => {
  const payload = mappingToJson(groups);
  assert.deepEqual(mappingFromJson(payload), [
    { canonical: 'DUNS', aliases: ['빨강', '파랑', '노랑', '주황', '초록'], rowNumber: 1 },
    { canonical: '고구마', aliases: ['수박', '파도', '비행', '땅'], rowNumber: 2 },
  ]);
});

test('browser comparison maps only selected composite-key columns and preserves key trace', () => {
  const left = table(['company', 'region', 'value'], [[' 빨강 ', '서울', 1], ['보라', '부산', 2]]);
  const right = table(['company', 'region', 'value'], [['초록', '서울', 1], ['보라', '부산', 2]]);
  const result = compareTables(left, right, {
    keyColumns: ['company', 'region'],
    keyColumnsB: ['company', 'region'],
    rules: [{ id: 'value', columnA: 'value', columnB: 'value', dataType: 'number' }],
    ...mappingConfig(),
  });

  assert.equal(result.rows.length, 2);
  const mapped = result.rows.find(row => row.key.map(decodeScalar).includes('DUNS'))!;
  assert.equal(mapped.status, 'matched');
  assert.equal(mapped.keyMapping?.A[0][0].original, ' 빨강 ');
  assert.equal(mapped.keyMapping?.A[0][0].normalized, '빨강');
  assert.equal(mapped.keyMapping?.A[0][0].standard, 'DUNS');
  assert.equal(mapped.keyMapping?.A[0][1].applied, false);
});

test('mapping-created duplicate cardinalities reuse 1:N, N:1, and N:M policies', () => {
  const config: ComparisonConfig = { keyColumns: ['company'], compareColumns: ['value'], duplicatePolicy: 'report', nmPolicy: 'report', ...mappingConfig() };
  const oneToMany = compareTables(table(['company', 'value'], [['DUNS', 1]]), table(['company', 'value'], [['빨강', 1], ['파랑', 1]]), config);
  const manyToOne = compareTables(table(['company', 'value'], [['빨강', 1], ['파랑', 1]]), table(['company', 'value'], [['DUNS', 1]]), config);
  const manyToMany = compareTables(table(['company', 'value'], [['빨강', 1], ['파랑', 1]]), table(['company', 'value'], [['DUNS', 1], ['초록', 1]]), config);

  assert.equal(oneToMany.rows[0].status, 'duplicate');
  assert.equal(oneToMany.rows[0].aCount, 1); assert.equal(oneToMany.rows[0].bCount, 2);
  assert.equal(manyToOne.rows[0].status, 'duplicate');
  assert.equal(manyToOne.rows[0].aCount, 2); assert.equal(manyToOne.rows[0].bCount, 1);
  assert.equal(manyToMany.rows.length, 1);
  assert.equal(manyToMany.rows[0].status, 'nm-pending');
  assert.ok(manyToMany.rows[0].flags.includes('structural_block'));
});

test('disabled mapping keeps the existing comparison result unchanged', () => {
  const left = table(['company', 'value'], [[' A ', 1]]);
  const right = table(['company', 'value'], [['A', 1]]);
  const base = compareTables(left, right, { keyColumns: ['company'], compareColumns: ['value'] });
  const dictionary = buildMapping(groups);
  const disabled = compareTables(left, right, { keyColumns: ['company'], compareColumns: ['value'], keyMappings: { A: { company: { enabled: false, dictionary } }, B: { company: { enabled: false, dictionary } } } });

  assert.deepEqual(disabled.rows.map(row => [row.key, row.status, row.aCount, row.bCount]), base.rows.map(row => [row.key, row.status, row.aCount, row.bCount]));
});

test('browser template preserves mapping groups and applied key columns', () => {
  const template: BrowserTemplateV2 = {
    version: 2,
    expectations: [{ side: 'both', index: 0, id: 'company', raw: 'company', display: 'company', normalizedName: 'company', sheet: null, fingerprint: 'company:0', occurrence: 0 }],
    keyColumns: ['company'],
    keyColumnsB: ['company'],
    compareColumns: [],
    rules: [],
    caseSensitive: true,
    duplicatePolicy: 'set',
    keyMapping: { enabled: true, name: '회사 사전', groups, applyA: ['company'], applyB: ['company'] },
  };

  const remapped = remapConfig(['company'], template);

  assert.deepEqual(remapped.diagnostics, []);
  assert.equal(remapped.config?.keyMapping?.name, '회사 사전');
  assert.deepEqual(remapped.config?.keyMapping?.groups, groups);
  assert.deepEqual(remapped.config?.keyMapping?.applyA, ['company']);
});
