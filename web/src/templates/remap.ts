import type { ScalarV1, Table } from '../engine/contracts';

export type BrowserTemplateV2 = { version: 2; expectations: { side: 'both'; index: number; id: string; raw: string; display: string; normalizedName: string; sheet: string | null; fingerprint: string; occurrence: number }[]; keyColumns: (string | number)[]; compareColumns: (string | number)[]; rules: { id: string; columnA: string | number; columnB: string | number; dataType?: 'text' | 'number' | 'date' | 'boolean'; aggregationMethod?: 'sum' | 'mean' | 'min' | 'max' | 'count' | 'nunique' | 'concat_unique'; nullPolicy?: import('../engine/comparisonEngine').NullPolicy }[]; representativeColumn?: string | number; caseSensitive: boolean; duplicatePolicy: string };
export type RemapDiagnostic = { code: string; message: string };
export type RemappedConfig = Pick<BrowserTemplateV2, 'keyColumns' | 'compareColumns' | 'rules' | 'representativeColumn' | 'caseSensitive' | 'duplicatePolicy'>;

export function remapConfig(headers: string[], template: BrowserTemplateV2): { config?: RemappedConfig; diagnostics: RemapDiagnostic[] } {
  const diagnostics: RemapDiagnostic[] = [];
  if (template.version !== 2) return { diagnostics: [{ code: 'UNSUPPORTED_TEMPLATE_VERSION', message: 'Only template version 2 is supported.' }] };
  const available = new Set(headers);
  const remap = new Map<string, string>();
  for (const expectation of template.expectations) {
    const normalized = expectation.raw.trim().toLocaleLowerCase();
    if (normalized !== expectation.normalizedName) diagnostics.push({ code: 'STALE_TEMPLATE_COLUMN', message: `Template column identity is stale: ${expectation.id}` });
    if (available.has(expectation.id)) remap.set(expectation.id, expectation.id);
    else {
      const candidates = headers.filter((header) => header.trim().toLocaleLowerCase() === expectation.normalizedName);
      const candidate = candidates[expectation.occurrence];
      if (candidate) remap.set(expectation.id, candidate); else diagnostics.push({ code: 'STALE_TEMPLATE_COLUMN', message: `Template column is missing: ${expectation.id}` });
    }
  }
  const required = [...template.keyColumns, ...template.compareColumns, ...template.rules.flatMap((rule) => [rule.columnA, rule.columnB]), ...(template.representativeColumn ? [template.representativeColumn] : [])].filter((column): column is string => typeof column === 'string');
  const numericReferences = [...template.keyColumns, ...template.compareColumns, ...template.rules.flatMap((rule) => [rule.columnA, rule.columnB]), ...(template.representativeColumn !== undefined ? [template.representativeColumn] : [])].filter((column): column is number => typeof column === 'number');
  if (numericReferences.some((column) => !Number.isInteger(column) || column < 0 || column >= headers.length)) diagnostics.push({ code: 'STALE_TEMPLATE_COLUMN', message: 'Template contains an out-of-range numeric column reference.' });
  const missing = [...new Set(required.filter((column) => !available.has(remap.get(column) ?? column)))];
  if (missing.length) diagnostics.push({ code: 'STALE_TEMPLATE_COLUMN', message: `Template columns are not present in both current datasets: ${missing.join(', ')}` });
  if (new Set(template.keyColumns).size !== template.keyColumns.length) diagnostics.push({ code: 'DUPLICATE_KEY_COLUMN', message: 'Template contains duplicate key columns.' });
  if (diagnostics.length) return { diagnostics };
  const resolve = (column: string | number) => typeof column === 'string' ? remap.get(column) ?? column : column;
  return { config: { keyColumns: template.keyColumns.map(resolve), compareColumns: template.compareColumns.map(resolve), rules: template.rules.map((rule) => ({ ...rule, columnA: resolve(rule.columnA), columnB: resolve(rule.columnB) })), representativeColumn: template.representativeColumn === undefined ? undefined : resolve(template.representativeColumn), caseSensitive: template.caseSensitive, duplicatePolicy: template.duplicatePolicy }, diagnostics };
}

export function applyAtomicRemap(table: Table, template: { version: 2; mappings: Record<string, string> }): { table?: Table; diagnostics: RemapDiagnostic[] } {
  const diagnostics: RemapDiagnostic[] = [];
  const sources = Object.keys(template.mappings);
  const missing = sources.filter((header) => !table.headers.includes(header));
  if (missing.length) diagnostics.push({ code: 'MISSING_SOURCE_COLUMN', message: `Missing source columns: ${missing.join(', ')}` });
  const targets = Object.values(template.mappings);
  if (new Set(targets).size !== targets.length) diagnostics.push({ code: 'DUPLICATE_TARGET_COLUMN', message: 'Multiple source columns map to the same target.' });
  if (diagnostics.length) return { diagnostics };
  const indexes = sources.map((header) => table.headers.indexOf(header));
  return { table: { ...table, headers: targets, rows: table.rows.map((row) => indexes.map((index) => row[index])) }, diagnostics };
}

export const remapTemplate = applyAtomicRemap;
export const applyTemplateRemap = applyAtomicRemap;
