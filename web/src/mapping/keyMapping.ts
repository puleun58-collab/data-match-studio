import type { ScalarV1, Table } from '../engine/contracts';
import { decodeScalar } from '../engine/serialization';

export type KeyNormalizationOptions = {
  trim?: boolean;
  collapseSpaces?: boolean;
  removeAllSpaces?: boolean;
  caseInsensitive?: boolean;
};

export type MappingGroup = { canonical: string; aliases: string[]; rowNumber?: number };
export type MappingIssue = { severity: 'error' | 'warning'; code: string; message: string; alias?: string; canonicals?: string[]; rowNumbers?: number[] };
export type MappingStats = {
  canonicalCount: number;
  aliasCount: number;
  mappingItemCount: number;
  duplicateAliasCount: number;
  emptyAliasCellCount: number;
  collisionAliasCount: number;
  emptyCanonicalCount: number;
  duplicateRowCount: number;
  aliaslessGroupCount: number;
};
export type MappingDictionary = {
  name: string;
  groups: MappingGroup[];
  aliasToCanonical: Record<string, string>;
  preview: { originalAlias: string; normalizedAlias: string; canonical: string; kind: 'canonical' | 'alias'; rowNumber: number }[];
  issues: MappingIssue[];
  stats: MappingStats;
  applicable: boolean;
};
export type KeyMappingSelection = { dictionary: MappingDictionary; enabled: boolean };
export type KeyMappingTrace = { original: unknown; normalized: unknown; standard: unknown; applied: boolean; mappingEnabled: boolean; canonical?: string; alias?: string; group?: string };

export function normalizeKeyValue(value: unknown, options: KeyNormalizationOptions = {}): string | null {
  if (value === null || value === undefined) return null;
  let text = String(value);
  if (options.trim !== false) text = text.trim();
  if (!text) return null;
  text = text.replace(/[\u00a0\u2007\u202f]/g, ' ').replace(/[\r\n]+/g, ' ');
  if (options.removeAllSpaces) text = text.replace(/\s+/g, '');
  else if (options.collapseSpaces) text = text.replace(/\s+/g, ' ');
  if (options.caseInsensitive) text = text.toLocaleLowerCase();
  return text || null;
}

export function groupsFromWideTable(table: Table, canonicalColumn: string, aliasColumns: string[]): MappingGroup[] {
  const canonicalIndex = table.headers.indexOf(canonicalColumn);
  if (canonicalIndex < 0) throw new Error('대표값 컬럼을 선택하세요.');
  const selected = aliasColumns.filter(column => column !== canonicalColumn);
  if (!selected.length) throw new Error('별칭 컬럼을 하나 이상 선택하세요.');
  const aliasIndexes = selected.map(column => {
    const index = table.headers.indexOf(column);
    if (index < 0) throw new Error(`별칭 컬럼을 찾을 수 없습니다: ${column}`);
    return index;
  });
  return table.rows.map((row, index) => ({
    canonical: scalarText(row[canonicalIndex]),
    aliases: aliasIndexes.map(aliasIndex => scalarText(row[aliasIndex])),
    rowNumber: index + (table.headerOffset ?? 0) + 2,
  }));
}

export function buildMapping(groups: MappingGroup[], options: KeyNormalizationOptions = {}, name = '기본 키 매핑'): MappingDictionary {
  const issues: MappingIssue[] = [];
  const preview: MappingDictionary['preview'] = [];
  const candidates = new Map<string, Set<string>>();
  const rowsByAlias = new Map<string, Set<number>>();
  const registrationCounts = new Map<string, number>();
  const canonicalSet = new Set<string>();
  const rowCounts = new Map<string, number[]>();
  let aliasCount = 0;
  let emptyAliasCellCount = 0;
  let emptyCanonicalCount = 0;
  let aliaslessGroupCount = 0;

  const register = (rawAlias: string, canonical: string, rowNumber: number, kind: 'canonical' | 'alias') => {
    const alias = normalizeKeyValue(rawAlias, options);
    if (alias === null) return;
    const targets = candidates.get(alias) ?? new Set<string>();
    targets.add(canonical); candidates.set(alias, targets);
    const rows = rowsByAlias.get(alias) ?? new Set<number>(); rows.add(rowNumber); rowsByAlias.set(alias, rows);
    const countKey = `${JSON.stringify(alias)}\u0000${JSON.stringify(canonical)}`;
    registrationCounts.set(countKey, (registrationCounts.get(countKey) ?? 0) + 1);
    preview.push({ originalAlias: rawAlias, normalizedAlias: alias, canonical, kind, rowNumber });
  };

  groups.forEach((group, index) => {
    const rowNumber = group.rowNumber ?? index + 2;
    const canonical = normalizeKeyValue(group.canonical, options);
    if (canonical === null) {
      emptyCanonicalCount += 1;
      issues.push({ severity: 'warning', code: 'EMPTY_CANONICAL', message: `${rowNumber}행의 대표값이 비어 있어 제외했습니다.`, rowNumbers: [rowNumber] });
      return;
    }
    canonicalSet.add(canonical);
    const nonemptyAliases = group.aliases.filter(alias => normalizeKeyValue(alias, options) !== null);
    emptyAliasCellCount += group.aliases.length - nonemptyAliases.length;
    if (!nonemptyAliases.length) {
      aliaslessGroupCount += 1;
      issues.push({ severity: 'warning', code: 'ALIASLESS_GROUP', message: `${rowNumber}행의 대표값에는 별칭이 없습니다.`, canonicals: [canonical], rowNumbers: [rowNumber] });
    }
    const signature = JSON.stringify([group.canonical, group.aliases]);
    const duplicateRows = rowCounts.get(signature) ?? []; duplicateRows.push(rowNumber); rowCounts.set(signature, duplicateRows);
    register(group.canonical, canonical, rowNumber, 'canonical');
    nonemptyAliases.forEach(alias => { aliasCount += 1; register(alias, canonical, rowNumber, 'alias'); });
  });

  let duplicateRowCount = 0;
  rowCounts.forEach(rowNumbers => {
    if (rowNumbers.length > 1) {
      duplicateRowCount += rowNumbers.length - 1;
      issues.push({ severity: 'warning', code: 'DUPLICATE_ROW', message: `완전히 동일한 매핑 행이 ${rowNumbers.length}번 등록되었습니다.`, rowNumbers });
    }
  });

  let duplicateAliasCount = 0;
  registrationCounts.forEach((count, key) => {
    if (count <= 1) return;
    duplicateAliasCount += count - 1;
    const [alias, canonical] = key.split('\u0000').map(value => JSON.parse(value) as string);
    issues.push({ severity: 'warning', code: 'DUPLICATE_ALIAS', message: `별칭 '${alias}'이(가) 같은 대표값 '${canonical}'에 반복 등록되었습니다.`, alias, canonicals: [canonical], rowNumbers: [...(rowsByAlias.get(alias) ?? [])] });
  });

  const collisionAliases = new Set<string>();
  candidates.forEach((canonicals, alias) => {
    if (canonicals.size <= 1) return;
    collisionAliases.add(alias);
    issues.push({ severity: 'error', code: 'NORMALIZED_ALIAS_CONFLICT', message: `키 매핑 충돌: '${alias}' → ${[...canonicals].join(', ')}`, alias, canonicals: [...canonicals], rowNumbers: [...(rowsByAlias.get(alias) ?? [])] });
  });

  const canonicalAliasConflicts = new Set<string>();
  canonicalSet.forEach(canonical => {
    const targets = candidates.get(canonical);
    if (!targets || ![...targets].some(target => target !== canonical)) return;
    canonicalAliasConflicts.add(canonical);
    collisionAliases.add(canonical);
    issues.push({ severity: 'error', code: 'CANONICAL_ALIAS_CONFLICT', message: `대표값 '${canonical}'이(가) 다른 그룹의 별칭으로 사용되었습니다. 체인 매핑은 지원하지 않습니다.`, alias: canonical, canonicals: [...targets, canonical], rowNumbers: [...(rowsByAlias.get(canonical) ?? [])] });
  });

  const aliasToCanonical: Record<string, string> = {};
  candidates.forEach((canonicals, alias) => {
    if (canonicals.size === 1 && !canonicalAliasConflicts.has(alias)) aliasToCanonical[alias] = [...canonicals][0];
  });
  const uniquePreview = preview.filter((item, index) => preview.findIndex(candidate => candidate.normalizedAlias === item.normalizedAlias && candidate.canonical === item.canonical) === index);
  const stats: MappingStats = { canonicalCount: canonicalSet.size, aliasCount, mappingItemCount: Object.keys(aliasToCanonical).length, duplicateAliasCount, emptyAliasCellCount, collisionAliasCount: collisionAliases.size, emptyCanonicalCount, duplicateRowCount, aliaslessGroupCount };
  return { name, groups, aliasToCanonical, preview: uniquePreview, issues, stats, applicable: !issues.some(issue => issue.severity === 'error') };
}

export function applyKeyMapping(value: unknown, mapping: KeyMappingSelection | undefined, options: KeyNormalizationOptions = {}): KeyMappingTrace {
  const normalized = normalizeKeyValue(value, options);
  if (!mapping?.enabled) return { original: value, normalized, standard: normalized, applied: false, mappingEnabled: false };
  if (!mapping.dictionary.applicable || normalized === null) return { original: value, normalized, standard: normalized, applied: false, mappingEnabled: true };
  const canonical = mapping.dictionary.aliasToCanonical[normalized];
  if (canonical === undefined) return { original: value, normalized, standard: normalized, applied: false, mappingEnabled: true };
  return { original: value, normalized, standard: canonical, applied: true, mappingEnabled: true, canonical, alias: normalized, group: canonical };
}

export function mappingToJson(groups: MappingGroup[]): string {
  const result: Record<string, string[]> = {};
  groups.forEach(group => {
    const canonical = group.canonical.trim();
    if (!canonical) return;
    result[canonical] ??= [];
    group.aliases.filter(alias => alias.trim()).forEach(alias => { if (!result[canonical].includes(alias)) result[canonical].push(alias); });
  });
  return JSON.stringify(result, null, 2);
}

export function mappingFromJson(text: string): MappingGroup[] {
  const value: unknown = JSON.parse(text);
  if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error('키 매핑 JSON은 대표값을 키로 사용하는 객체여야 합니다.');
  return Object.entries(value).map(([canonical, aliases], index) => {
    if (!Array.isArray(aliases) || aliases.some(alias => typeof alias !== 'string')) throw new Error(`대표값 '${canonical}'의 별칭은 문자열 배열이어야 합니다.`);
    return { canonical, aliases: aliases as string[], rowNumber: index + 1 };
  });
}

function scalarText(value: ScalarV1 | undefined): string {
  const decoded = value === undefined ? null : decodeScalar(value);
  return decoded === null || decoded === undefined ? '' : String(decoded);
}
