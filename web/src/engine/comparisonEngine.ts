import type { ScalarV1, Table } from './contracts';
import { decodeScalar, encodeScalar, serializeDeterministic } from './serialization';

export type DuplicatePolicy = 'report' | 'first' | 'last' | 'set' | 'multiset' | 'aggregate' | 'representative';
export type NullPolicy = { bothEmptyEqual?: boolean; oneEmptyMismatch?: boolean; emptyEqualsZero?: boolean; emptyEqualsText?: string; missingTokens?: string[] };
export type ComparisonRule = { id: string; columnA: string | number; columnB: string | number; dataType?: 'text' | 'number' | 'date' | 'boolean'; caseSensitive?: boolean; aggregationMethod?: 'sum' | 'mean' | 'min' | 'max' | 'count' | 'nunique' | 'concat_unique'; nullPolicy?: NullPolicy };
export type ComparisonConfig = { keyColumns: (string | number)[]; compareColumns?: (string | number)[]; rules?: ComparisonRule[]; caseSensitive?: boolean; duplicatePolicy?: DuplicatePolicy; nmPolicy?: DuplicatePolicy; representativeColumn?: string | number };
export type ComparisonStatus = 'matched' | 'added' | 'removed' | 'changed' | 'duplicate' | 'nm-pending' | 'invalid-key' | 'conversion-failed';
export type OutcomeFlag = 'comparable' | 'identical' | 'mismatch' | 'conversion_failed' | 'duplicate' | 'nm_pending' | 'a_only' | 'b_only' | 'invalid_key' | 'structural_block';
export type TraceItem = { side: 'A' | 'B'; ruleId: string; rowIndex: number; ordinal: number; originalValues: ScalarV1[]; normalizedValues: ScalarV1[]; status: string; reason: string; conversionSuccess: boolean; numericDifference?: number; absoluteDifference?: number; differenceRate?: number; values: ScalarV1[] };
export type ComparisonRow = { key: ScalarV1[]; status: ComparisonStatus; displayStatus: string; flags: OutcomeFlag[]; left: ScalarV1[] | null; right: ScalarV1[] | null; aCount: number; bCount: number; trace: TraceItem[]; provenance: { leftRow?: number; rightRow?: number } };
export type ComparisonSummary = { total: number; comparable: number; identical: number; mismatch: number; aOnly: number; bOnly: number; duplicate: number; conversionFailed: number; nmPending: number; matchRate: number };
export type ComparisonResult = { rows: ComparisonRow[]; diagnostics: { code: string; message: string; details?: Record<string, ScalarV1> }[]; summary: ComparisonSummary };

function col(table: Table, c: string | number): number { return typeof c === 'number' ? c : table.headers.indexOf(c); }
function keyValues(row: ScalarV1[], table: Table, config: ComparisonConfig): ScalarV1[] { return config.keyColumns.map((c) => row[col(table, c)] ?? encodeScalar(null)); }
function keyOf(row: ScalarV1[], table: Table, config: ComparisonConfig): string | null {
  const values = keyValues(row, table, config);
  if (values.some((value) => value.type === 'null' || (value.type === 'string' && String(value.value).trim() === ''))) return null;
  const text = serializeDeterministic(values.map(decodeScalar));
  return config.caseSensitive === false ? text.toLocaleLowerCase() : text;
}
function rulesFor(config: ComparisonConfig): ComparisonRule[] { return config.rules?.length ? config.rules : (config.compareColumns ?? []).map((column, index) => ({ id: `rule-${index + 1}`, columnA: column, columnB: column })); }
function normalize(value: unknown, rule: ComparisonRule): { value: unknown; ok: boolean } {
  const policy = rule.nullPolicy ?? {};
  if (value === null || value === undefined || value === '' || policy.missingTokens?.includes(String(value).trim().toLocaleLowerCase())) {
    if (policy.emptyEqualsZero && rule.dataType === 'number') return { value: 0, ok: true };
    if (policy.emptyEqualsText !== undefined) return { value: policy.emptyEqualsText, ok: true };
    return { value: null, ok: true };
  }
  if (rule.dataType === 'number') { const token = String(value).replace(/[,\s]/g, ''); if (!/^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(token)) return { value, ok: false }; const number = Number(token); return { value: number, ok: Number.isFinite(number) }; }
  if (rule.dataType === 'date') { const date = new Date(String(value)); return { value: Number.isNaN(date.getTime()) ? value : date.toISOString().slice(0, 10), ok: !Number.isNaN(date.getTime()) }; }
  if (rule.dataType === 'boolean') { const text = String(value).trim().toLocaleLowerCase(); if (['true', '1', 'y', 'yes'].includes(text)) return { value: true, ok: true }; if (['false', '0', 'n', 'no'].includes(text)) return { value: false, ok: true }; return { value, ok: false }; }
  const text = String(value).trim(); return { value: rule.caseSensitive === false ? text.toLocaleLowerCase() : text, ok: true };
}
function evaluateRows(left: ScalarV1[], right: ScalarV1[], leftTable: Table, rightTable: Table, config: ComparisonConfig): { same: boolean; conversionFailed: boolean; decisions: { rule: ComparisonRule; left: unknown; right: unknown; normalizedLeft: unknown; normalizedRight: unknown; equal: boolean; conversionSuccessA: boolean; conversionSuccessB: boolean; reason: string; numericDifference?: number }[] } {
  const rules = rulesFor(config); const decisions = rules.map((rule) => { const leftValue = decodeScalar(left[col(leftTable, rule.columnA)] ?? encodeScalar(null)); const rightValue = decodeScalar(right[col(rightTable, rule.columnB)] ?? encodeScalar(null)); const a = normalize(leftValue, rule), b = normalize(rightValue, rule); const bothEmpty = a.value === null && b.value === null; const oneEmpty = (a.value === null) !== (b.value === null); const equal = a.ok && b.ok && (bothEmpty ? rule.nullPolicy?.bothEmptyEqual !== false : oneEmpty ? rule.nullPolicy?.oneEmptyMismatch === false : serializeDeterministic(a.value) === serializeDeterministic(b.value)); return { rule, left: leftValue, right: rightValue, normalizedLeft: a.value, normalizedRight: b.value, equal, conversionSuccessA: a.ok, conversionSuccessB: b.ok, reason: !a.ok || !b.ok ? '값을 지정한 형식으로 변환할 수 없습니다.' : equal ? '동일' : '불일치', numericDifference: rule.dataType === 'number' && a.ok && b.ok ? Number(a.value) - Number(b.value) : undefined }; });
  return { same: decisions.every((decision) => decision.equal), conversionFailed: decisions.some((decision) => !decision.conversionSuccessA || !decision.conversionSuccessB), decisions };
}
function trace(side: 'A' | 'B', members: { row: ScalarV1[]; index: number }[], counterpart: { row: ScalarV1[] } | undefined, ownTable: Table, otherTable: Table, config: ComparisonConfig): TraceItem[] { return members.flatMap((member, ordinal) => { if (!counterpart) return [{ side, ruleId: 'row', rowIndex: member.index, ordinal, originalValues: member.row, normalizedValues: member.row, status: 'missing-side', reason: '', conversionSuccess: true, numericDifference: undefined, absoluteDifference: undefined, differenceRate: undefined, values: member.row }]; const evaluated = side === 'A' ? evaluateRows(member.row, counterpart.row, ownTable, otherTable, config) : evaluateRows(counterpart.row, member.row, otherTable, ownTable, config); return evaluated.decisions.map((decision) => { const difference = decision.numericDifference; const base = side === 'A' ? Number(decision.normalizedLeft) : Number(decision.normalizedRight); return { side, ruleId: decision.rule.id, rowIndex: member.index, ordinal, originalValues: [encodeScalar(side === 'A' ? decision.left : decision.right)], normalizedValues: [encodeScalar(side === 'A' ? decision.normalizedLeft : decision.normalizedRight)], status: decision.equal ? 'identical' : evaluated.conversionFailed ? 'conversion-failed' : 'mismatch', reason: decision.reason, conversionSuccess: side === 'A' ? decision.conversionSuccessA : decision.conversionSuccessB, numericDifference: difference, absoluteDifference: difference === undefined ? undefined : Math.abs(difference), differenceRate: difference === undefined || !Number.isFinite(base) || base === 0 ? undefined : Math.abs(difference / base), values: member.row }; }); }); }
function comparableRows(left: ScalarV1[], right: ScalarV1[], leftTable: Table, rightTable: Table, config: ComparisonConfig): { same: boolean; conversionFailed: boolean } {
  const evaluated = evaluateRows(left, right, leftTable, rightTable, config); return { same: evaluated.same, conversionFailed: evaluated.conversionFailed };
}
function collectionValues(members: { row: ScalarV1[] }[], table: Table, config: ComparisonConfig): string[] {
  const columns = config.compareColumns ?? table.headers.map((_, index) => index);
  return members.map((member) => serializeDeterministic(columns.map((column) => member.row[col(table, column)] ?? encodeScalar(null)).map(decodeScalar)));
}
function collectionRuleValues(members: { row: ScalarV1[] }[], table: Table, rule: ComparisonRule, side: 'A' | 'B'): { values: unknown[]; valid: boolean } {
  const column = side === 'A' ? rule.columnA : rule.columnB;
  const values = members.map((member) => normalize(decodeScalar(member.row[col(table, column)] ?? encodeScalar(null)), rule));
  return { values: values.map((value) => value.value), valid: values.every((value) => value.ok) };
}

export function compareTables(left: Table, right: Table, config: ComparisonConfig): ComparisonResult {
  const diagnostics: ComparisonResult['diagnostics'] = [];
  const leftGroups = new Map<string, { row: ScalarV1[]; index: number }[]>();
  const rightGroups = new Map<string, { row: ScalarV1[]; index: number }[]>();
  const invalid: { side: 'A' | 'B'; row: ScalarV1[]; index: number }[] = [];
  const add = (target: Map<string, { row: ScalarV1[]; index: number }[]>, table: Table, side: 'A' | 'B') => table.rows.forEach((row, index) => {
    const key = keyOf(row, table, config);
    if (key === null) { invalid.push({ side, row, index }); diagnostics.push({ code: 'INVALID_KEY', message: `${side} row ${index + 1} has an empty key.` }); return; }
    const members = target.get(key) ?? [];
    if (members.length) diagnostics.push({ code: 'DUPLICATE_KEY', message: `${side} contains duplicate key at row ${index + 1}.` });
    members.push({ row, index }); target.set(key, members);
  });
  add(leftGroups, left, 'A'); add(rightGroups, right, 'B');
  const keys = new Set([...leftGroups.keys(), ...rightGroups.keys()]);
  const rows: ComparisonRow[] = [];
  for (const key of keys) {
    const leftMembers = leftGroups.get(key) ?? [], rightMembers = rightGroups.get(key) ?? [];
    const aCount = leftMembers.length, bCount = rightMembers.length;
    const duplicate = aCount > 1 || bCount > 1;
    const policy = config.nmPolicy ?? config.duplicatePolicy ?? 'report';
    const representative = (members: { row: ScalarV1[]; index: number }[], table: Table) => config.representativeColumn === undefined ? members[0] : [...members].sort((a, b) => { const av = decodeScalar(a.row[col(table, config.representativeColumn!)] ?? encodeScalar(null)), bv = decodeScalar(b.row[col(table, config.representativeColumn!)] ?? encodeScalar(null)); if (av === null && bv === null) return 0; if (av === null) return 1; if (bv === null) return -1; if (typeof av === 'number' && typeof bv === 'number') return bv - av; return String(bv).localeCompare(String(av)); })[0];
    const selectedLeft = duplicate && policy === 'last' ? leftMembers.at(-1) : duplicate && policy === 'representative' ? representative(leftMembers, left) : leftMembers[0];
    const selectedRight = duplicate && policy === 'last' ? rightMembers.at(-1) : duplicate && policy === 'representative' ? representative(rightMembers, right) : rightMembers[0];
    let status: ComparisonStatus;
    let displayStatus: string;
    let flags: OutcomeFlag[];
    if (!aCount || !bCount) { status = aCount ? 'removed' : 'added'; displayStatus = aCount ? '데이터셋 B에만 존재' : '데이터셋 A에만 존재'; flags = [aCount ? 'b_only' : 'a_only']; }
    else if (duplicate && policy === 'report') { status = aCount > 1 && bCount > 1 ? 'nm-pending' : 'duplicate'; displayStatus = aCount > 1 && bCount > 1 ? 'N:M 처리 필요' : '중복 키'; flags = aCount > 1 && bCount > 1 ? ['nm_pending', 'duplicate', 'structural_block'] : ['duplicate', 'structural_block']; }
    else {
      let same: boolean;
      const collectionRules = rulesFor(config);
      const collectionConversionFailed = duplicate && (policy === 'set' || policy === 'multiset' || policy === 'aggregate') && [...leftMembers.map((member) => ({ member, table: left, side: 'A' as const })), ...rightMembers.map((member) => ({ member, table: right, side: 'B' as const }))].some(({ member, table, side }) => collectionRules.some((rule) => !normalize(decodeScalar(member.row[col(table, side === 'A' ? rule.columnA : rule.columnB)] ?? encodeScalar(null)), rule).ok));
      if (collectionConversionFailed) {
        status = 'conversion-failed'; displayStatus = '형식 변환 실패'; flags = duplicate ? ['conversion_failed', 'duplicate'] : ['conversion_failed']; rows.push({ key: keyValues((selectedLeft ?? selectedRight)!.row, selectedLeft ? left : right, config), status, displayStatus, flags, left: selectedLeft?.row ?? null, right: selectedRight?.row ?? null, aCount, bCount, trace: [...trace('A', leftMembers, selectedRight, left, right, config), ...trace('B', rightMembers, selectedLeft, right, left, config)], provenance: { leftRow: selectedLeft?.index, rightRow: selectedRight?.index } }); continue;
      }
      if (duplicate && (policy === 'aggregate' || policy === 'set' || policy === 'multiset')) {
        same = rulesFor(config).every((rule) => {
          const aValues = collectionRuleValues(leftMembers, left, rule, 'A').values;
          const bValues = collectionRuleValues(rightMembers, right, rule, 'B').values;
          const aEmpty = aValues.every((value) => value === null), bEmpty = bValues.every((value) => value === null);
          if (aEmpty && bEmpty) return rule.nullPolicy?.bothEmptyEqual !== false;
          if (aEmpty !== bEmpty && rule.nullPolicy?.oneEmptyMismatch !== false) return false;
          const aClean = aValues.filter((value) => value !== null), bClean = bValues.filter((value) => value !== null);
          if (policy === 'aggregate') {
            const method = rule.aggregationMethod ?? 'sum';
            if (method === 'count') return aClean.length === bClean.length;
            if (method === 'nunique') return new Set(aClean.map((value) => serializeDeterministic(value))).size === new Set(bClean.map((value) => serializeDeterministic(value))).size;
            if (method === 'concat_unique') return [...new Set(aClean.map(String))].sort().join('|') === [...new Set(bClean.map(String))].sort().join('|');
            const aNumeric = aClean, bNumeric = bClean;
            if (!aNumeric.length && !bNumeric.length) return true;
            if (!aNumeric.every((value) => typeof value === 'number' && Number.isFinite(value)) || !bNumeric.every((value) => typeof value === 'number' && Number.isFinite(value))) return false;
            const aggregate = (values: number[]) => method === 'mean' ? values.reduce((sum, value) => sum + value, 0) / values.length : method === 'min' ? Math.min(...values) : method === 'max' ? Math.max(...values) : values.reduce((sum, value) => sum + value, 0);
            return aggregate(aNumeric as number[]) === aggregate(bNumeric as number[]);
          }
          const aComparable = policy === 'set' ? [...new Set(aClean.map((value) => serializeDeterministic(value)))].sort() : aClean.map((value) => serializeDeterministic(value)).sort();
          const bComparable = policy === 'set' ? [...new Set(bClean.map((value) => serializeDeterministic(value)))].sort() : bClean.map((value) => serializeDeterministic(value)).sort();
          return serializeDeterministic(aComparable) === serializeDeterministic(bComparable);
        });
      } else {
        const evaluated = comparableRows(selectedLeft!.row, selectedRight!.row, left, right, config);
        same = evaluated.same;
        if (evaluated.conversionFailed) { status = 'conversion-failed'; displayStatus = '형식 변환 실패'; flags = duplicate ? ['conversion_failed', 'duplicate'] : ['conversion_failed']; rows.push({ key: keyValues((selectedLeft ?? selectedRight)!.row, selectedLeft ? left : right, config), status, displayStatus, flags, left: selectedLeft?.row ?? null, right: selectedRight?.row ?? null, aCount, bCount, trace: [...trace('A', leftMembers, selectedRight, left, right, config), ...trace('B', rightMembers, selectedLeft, right, left, config)], provenance: { leftRow: selectedLeft?.index, rightRow: selectedRight?.index } }); continue; }
      }
      status = same ? 'matched' : 'changed'; displayStatus = same ? (duplicate ? '중복 키 · 값 동일' : '모두 동일') : (duplicate ? '중복 키 · 값 상이' : '일부 항목 불일치'); flags = duplicate ? ['duplicate', ...(same ? ['comparable', 'identical'] : ['comparable', 'mismatch'])] as OutcomeFlag[] : (same ? ['comparable', 'identical'] : ['comparable', 'mismatch']);
    }
    rows.push({ key: keyValues((selectedLeft ?? selectedRight)!.row, selectedLeft ? left : right, config), status, displayStatus, flags, left: selectedLeft?.row ?? null, right: selectedRight?.row ?? null, aCount, bCount, trace: [...trace('A', leftMembers, selectedRight, left, right, config), ...trace('B', rightMembers, selectedLeft, right, left, config)], provenance: { leftRow: selectedLeft?.index, rightRow: selectedRight?.index } });
  }
  for (const item of invalid) rows.push({ key: keyValues(item.row, item.side === 'A' ? left : right, config), status: 'invalid-key', displayStatus: '빈 키', flags: ['invalid_key', 'structural_block'], left: item.side === 'A' ? item.row : null, right: item.side === 'B' ? item.row : null, aCount: item.side === 'A' ? 1 : 0, bCount: item.side === 'B' ? 1 : 0, trace: trace(item.side, [{ row: item.row, index: item.index }], undefined, item.side === 'A' ? left : right, item.side === 'A' ? right : left, config), provenance: item.side === 'A' ? { leftRow: item.index } : { rightRow: item.index } });
  const summary: ComparisonSummary = { total: rows.length, comparable: rows.filter((row) => row.flags.includes('comparable')).length, identical: rows.filter((row) => row.flags.includes('identical')).length, mismatch: rows.filter((row) => row.flags.includes('mismatch')).length, aOnly: rows.filter((row) => row.flags.includes('a_only')).length, bOnly: rows.filter((row) => row.flags.includes('b_only')).length, duplicate: rows.filter((row) => row.flags.includes('duplicate')).length, conversionFailed: rows.filter((row) => row.flags.includes('conversion_failed')).length, nmPending: rows.filter((row) => row.flags.includes('nm_pending')).length, matchRate: 0 };
  summary.matchRate = summary.comparable ? (summary.identical / summary.comparable) * 100 : 0;
  return { rows, diagnostics, summary };
}
export const compare = compareTables;
