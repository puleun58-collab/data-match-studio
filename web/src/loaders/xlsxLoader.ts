import type { DiagnosticCode, LoaderResult, ScalarV1, Table } from '../engine/contracts';
import { encodeScalar } from '../engine/serialization';
import { DEFAULT_XLSX_LIMITS, inspectXlsxZip, zipEntryBytes, type XlsxLimits } from './xlsxPreflight';

export type XlsxLoaderOptions = {
  limits?: Partial<XlsxLimits>;
  rejectFormulas?: boolean;
  signal?: AbortSignal;
  sheetName?: string;
  headerOffset?: number;
  dataStartRow?: number;
};

export type XlsxSheetResult = { ok: true; sheets: string[] } | { ok: false; diagnostics: { code: string; message: string }[] };

export type WorkbookSheet = { name: string; relationshipId: string };

export type WorkbookRelationship = { id: string; target: string; type: string };

const fail = (code: DiagnosticCode, message: string): LoaderResult => ({
  ok: false,
  diagnostics: [{ code, message }],
  trace: [],
});
async function inflate(data: Uint8Array, method: number, expectedSize: number, maxOutput: number): Promise<Uint8Array> {
  if (method === 0) { if (data.byteLength > maxOutput || (expectedSize > 0 && data.byteLength !== expectedSize)) throw new Error('ZIP_LIMIT'); return data; }
  if (method !== 8 || typeof DecompressionStream === 'undefined') {
    throw new Error('Deflate decompression unavailable');
  }
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  const reader = stream.getReader(); const chunks: Uint8Array[] = []; let total = 0;
  while (true) { const part = await reader.read(); if (part.done) break; total += part.value.byteLength; if (total > maxOutput) { await reader.cancel(); throw new Error('ZIP_LIMIT'); } chunks.push(part.value); }
  if (expectedSize > maxOutput || (expectedSize > 0 && total !== expectedSize)) throw new Error('ZIP_LIMIT');
  const output = new Uint8Array(total); let offset = 0; for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.byteLength; } return output;
}

function xmlText(bytes: Uint8Array): string {
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

// Local-name lookups ignore namespace prefixes entirely (e.g. `<sheet>`, `<x:sheet>`,
// `r:id`, `rel:id` all resolve the same way) instead of hardcoding a prefix string.
function localName(element: Element): string {
  return element.localName || element.tagName.split(':').pop() || element.tagName;
}

function attributeLocalName(attribute: Attr): string {
  return attribute.localName || attribute.name.split(':').pop() || attribute.name;
}

function attributeByLocalName(element: Element, name: string): string | null {
  const attributes = element.attributes;
  for (let index = 0; index < attributes.length; index += 1) {
    const attribute = attributes[index];
    if (attributeLocalName(attribute) === name) return attribute.value;
  }
  return null;
}

// Manual tree walk instead of `querySelectorAll` — CSS selector support is not
// guaranteed across every `DOMParser` implementation (including some XML-mode
// parsers used in non-browser test environments), while `childNodes` traversal
// by local name works everywhere.
function collectByLocalName(node: Node, name: string, results: Element[]): void {
  const children = node.childNodes;
  for (let index = 0; index < children.length; index += 1) {
    const child = children[index];
    if (child.nodeType === 1) {
      const element = child as Element;
      if (localName(element) === name) results.push(element);
      collectByLocalName(element, name, results);
    }
  }
}

function childrenByName(parent: Node, name: string): Element[] {
  const results: Element[] = [];
  collectByLocalName(parent, name, results);
  return results;
}

function firstChildByName(parent: Node, name: string): Element | undefined {
  return childrenByName(parent, name)[0];
}

function hasParserError(document: Node): boolean {
  return childrenByName(document, 'parsererror').length > 0;
}

/**
 * Parses `xl/workbook.xml` and returns every declared worksheet with its
 * relationship id, regardless of the namespace prefix the producer used
 * (`<sheet>`, `<x:sheet>`, `r:id`, `rel:id`, ...). Throws on malformed XML;
 * returns an empty array when the workbook genuinely has no worksheets.
 */
export function parseWorkbookSheets(workbookXml: string): WorkbookSheet[] {
  const document = new DOMParser().parseFromString(workbookXml, 'application/xml');
  if (hasParserError(document)) throw new Error('Malformed workbook XML.');
  const sheetsContainer = childrenByName(document, 'sheets')[0];
  if (!sheetsContainer) return [];
  return childrenByName(sheetsContainer, 'sheet')
    .map((element) => ({
      name: attributeByLocalName(element, 'name') ?? '',
      relationshipId: attributeByLocalName(element, 'id') ?? '',
    }))
    .filter((sheet) => sheet.name.length > 0);
}

/**
 * Parses `xl/_rels/workbook.xml.rels` and returns every `Relationship` with
 * its `Id`/`Target`/`Type`, independent of attribute order and of the
 * `Relationship` element's namespace prefix (`<Relationship>`, `<r:Relationship>`, ...).
 * Throws on malformed XML.
 */
export function parseWorkbookRelationships(relsXml: string): WorkbookRelationship[] {
  const document = new DOMParser().parseFromString(relsXml, 'application/xml');
  if (hasParserError(document)) throw new Error('Malformed workbook relationships XML.');
  return childrenByName(document, 'Relationship')
    .map((element) => ({
      id: attributeByLocalName(element, 'Id') ?? '',
      target: attributeByLocalName(element, 'Target') ?? '',
      type: attributeByLocalName(element, 'Type') ?? '',
    }))
    .filter((relationship) => relationship.id.length > 0 && relationship.target.length > 0);
}

/**
 * Resolves a relationship `Target` to its ZIP-internal path. Targets are
 * relative to `xl/` (the directory that owns `_rels/workbook.xml.rels`)
 * unless they already carry an `xl/` segment, so a leading `xl/` is added
 * exactly once regardless of an optional leading slash.
 */
function normalizeRelationshipTarget(target: string): string {
  const withoutLeadingSlashes = target.replace(/^\/+/, '');
  return withoutLeadingSlashes.startsWith('xl/') ? withoutLeadingSlashes : `xl/${withoutLeadingSlashes}`;
}

export function resolveWorksheetPath(relationshipId: string, relationships: WorkbookRelationship[]): string | undefined {
  const relationship = relationships.find((item) => item.id === relationshipId);
  return relationship ? normalizeRelationshipTarget(relationship.target) : undefined;
}

export async function listXlsxSheets(input: Blob | ArrayBuffer | Uint8Array, limits?: Partial<XlsxLimits>): Promise<XlsxSheetResult> {
  try {
    const bytes = input instanceof Blob ? new Uint8Array(await input.arrayBuffer()) : input instanceof Uint8Array ? input : new Uint8Array(input);
    const preflight = inspectXlsxZip(bytes, limits);
    if (preflight.diagnostics.length) return { ok: false, diagnostics: preflight.diagnostics.map((item) => ({ code: item.code, message: item.message })) };
    const entry = preflight.entries.find((item) => item.name === 'xl/workbook.xml');
    if (!entry) return { ok: false, diagnostics: [{ code: 'UNSUPPORTED_FORMAT', message: 'Workbook metadata is missing.' }] };
    const xml = xmlText(await inflate(zipEntryBytes(bytes, entry), entry.method, entry.uncompressedSize, limits?.maxUncompressedBytes ?? DEFAULT_XLSX_LIMITS.maxUncompressedBytes));
    const sheets = parseWorkbookSheets(xml).map((sheet) => sheet.name);
    return sheets.length ? { ok: true, sheets } : { ok: false, diagnostics: [{ code: 'UNSUPPORTED_FORMAT', message: 'Workbook contains no worksheets.' }] };
  } catch (error) { return { ok: false, diagnostics: [{ code: 'UNSUPPORTED_FORMAT', message: `Unable to inspect XLSX sheets: ${error instanceof Error ? error.message : String(error)}` }] }; }
}

function columnIndex(ref: string): number {
  let result = 0;
  for (const char of ref.replace(/\d/g, '')) result = result * 26 + char.charCodeAt(0) - 64;
  return result - 1;
}

function uniqueHeaders(values: string[]): string[] {
  const counts = new Map<string, number>();
  return values.map((value, index) => {
    const base = value.trim() || `Column ${index + 1}`;
    const count = (counts.get(base) ?? 0) + 1;
    counts.set(base, count);
    return count === 1 ? base : `${base}_${count}`;
  });
}

function sharedStrings(xml: string): string[] {
  if (!xml) return [];
  const document = new DOMParser().parseFromString(xml, 'application/xml');
  return childrenByName(document, 'si').map((si) => childrenByName(si, 't').map((item) => item.textContent ?? '').join(''));
}

function cellValue(cell: Element, shared: string[]): ScalarV1 {
  const type = cell.getAttribute('t') ?? '';
  if (type === 'inlineStr') {
    const inline = firstChildByName(cell, 't');
    return encodeScalar(inline?.textContent ?? '');
  }
  const raw = firstChildByName(cell, 'v')?.textContent ?? '';
  if (type === 's') {
    const index = Number.parseInt(raw, 10);
    return encodeScalar(Number.isInteger(index) ? shared[index] ?? '' : '');
  }
  if (type === 'b') return encodeScalar(raw === '1' || raw.toLowerCase() === 'true');
  if (type === 'str') return encodeScalar(raw);
  if (raw === '') return encodeScalar(null);
  const numeric = Number(raw);
  return Number.isFinite(numeric) ? encodeScalar(numeric) : encodeScalar(raw);
}

function parseWorksheet(xml: string, shared: string[], rejectFormulas: boolean, signal?: AbortSignal): ScalarV1[][] {
  const document = new DOMParser().parseFromString(xml, 'application/xml');
  if (hasParserError(document)) throw new Error('Malformed worksheet XML.');
  const result: ScalarV1[][] = [];
  for (const row of childrenByName(document, 'row')) {
    if (signal?.aborted) throw new Error('CANCELLED');
    const values: ScalarV1[] = [];
    for (const cell of childrenByName(row, 'c')) {
      if (rejectFormulas && childrenByName(cell, 'f').length) throw new Error('FORMULA_REJECTED');
      const index = columnIndex(cell.getAttribute('r') ?? 'A1');
      while (values.length <= index) values.push(encodeScalar(null));
      values[index] = cellValue(cell, shared);
    }
    result.push(values);
  }
  return result;
}

export async function loadXlsx(input: Blob | ArrayBuffer | Uint8Array, options: XlsxLoaderOptions = {}): Promise<LoaderResult> {
  try {
    const bytes = input instanceof Blob
      ? new Uint8Array(await input.arrayBuffer())
      : input instanceof Uint8Array ? input : new Uint8Array(input);
    const preflight = inspectXlsxZip(bytes, options.limits);
    if (preflight.diagnostics.length) {
      // Preflight uses its own XlsxDiagnosticCode namespace (ZIP-level codes like
      // UNSUPPORTED_XLSX/MACRO_REJECTED) that is disjoint from the loader-facing
      // DiagnosticCode union; both are stable string enums surfaced as diagnostics.
      return { ok: false, diagnostics: preflight.diagnostics.map((item) => ({ code: item.code as unknown as DiagnosticCode, message: item.message })), trace: [] };
    }
    const entries = new Map(preflight.entries.map((entry) => [entry.name, entry]));
    const get = async (name: string): Promise<string> => {
      const entry = entries.get(name);
      if (!entry) return '';
      return xmlText(await inflate(zipEntryBytes(bytes, entry), entry.method, entry.uncompressedSize, options.limits?.maxUncompressedBytes ?? 256 * 1024 * 1024));
    };
    const workbookXml = await get('xl/workbook.xml');
    const relsXml = await get('xl/_rels/workbook.xml.rels');
    if (!workbookXml || !relsXml) return fail('UNSUPPORTED_FORMAT', 'Workbook metadata is missing.');
    const sheets = parseWorkbookSheets(workbookXml);
    if (!sheets.length) return fail('UNSUPPORTED_FORMAT', 'Workbook contains no worksheets.');
    const relationships = parseWorkbookRelationships(relsXml);
    if (options.sheetName && !sheets.some((sheet) => sheet.name === options.sheetName)) {
      return fail('UNSUPPORTED_FORMAT', `Worksheet not found: ${options.sheetName}`);
    }
    const selected = sheets.find((sheet) => sheet.name === options.sheetName) ?? sheets[0];
    const sheetPath = resolveWorksheetPath(selected.relationshipId, relationships);
    if (!sheetPath) return fail('UNSUPPORTED_FORMAT', 'Worksheet relationship is missing.');
    const shared = sharedStrings(await get('xl/sharedStrings.xml'));
    const worksheetXml = await get(sheetPath);
    const formulaCount = (worksheetXml.match(/<f(?:\s|>)/g) ?? []).length;
    const rows = parseWorksheet(worksheetXml, shared, options.rejectFormulas === true, options.signal);
    const limits = { ...DEFAULT_XLSX_LIMITS, ...options.limits };
    const headerOffset = options.headerOffset ?? 0;
    const dataStartRow = options.dataStartRow ?? headerOffset + 1;
    if (!Number.isInteger(headerOffset) || headerOffset < 0 || dataStartRow < headerOffset + 1 || headerOffset >= rows.length) {
      return fail('INVALID_HEADER_OFFSET', 'Header/data start row is outside the worksheet.');
    }
    const width = Math.max(rows[headerOffset]?.length ?? 0, ...rows.slice(dataStartRow).map((row) => row.length), 0);
    if (width > limits.maxColumns || rows.length - dataStartRow > limits.maxRows || width * Math.max(0, rows.length - dataStartRow) > limits.maxCells) return fail('RESOURCE_LIMIT', 'XLSX worksheet exceeds the browser row/column/cell limit.');
    const headers = uniqueHeaders(Array.from({ length: width }, (_, index) => {
      const value = rows[headerOffset]?.[index];
      return value?.type === 'string' ? String(value.value ?? '') : String(value?.value ?? '');
    }));
    const data = rows.slice(dataStartRow).map((row) => Array.from({ length: width }, (_, index) => row[index] ?? encodeScalar(null)));
    const trace = [{ phase: 'parse', message: `Parsed ${data.length} data rows and ${headers.length} columns.` }];
    if (formulaCount) trace.push({ phase: 'formula-cache', message: `Read ${formulaCount} formula cells from their cached values; formulas are not evaluated in the browser.` });
    return { ok: true, value: { headers, rows: data, headerOffset, delimiter: '' } as Table, diagnostics: [], trace };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message === 'CANCELLED') return fail('CANCELLED', 'Loading cancelled.');
    if (message === 'FORMULA_REJECTED') return fail('FORMULA_REJECTED', 'Formula cells are not supported for safe browser comparison.');
    if (message === 'ZIP_LIMIT') return fail('RESOURCE_LIMIT', 'XLSX decompression exceeded the browser resource limit.');
    return fail('UNSUPPORTED_FORMAT', `Unable to load XLSX: ${message}`);
  }
}

export const xlsxLoader = loadXlsx;
