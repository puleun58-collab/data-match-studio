import type { LoaderResult, ScalarV1, Table } from '../engine/contracts';
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

const fail = (code: string, message: string): LoaderResult => ({
  ok: false,
  diagnostics: [{ code: code as any, message }],
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

function localName(element: Element): string {
  return element.localName || element.tagName.split(':').pop() || element.tagName;
}

function childrenByName(parent: ParentNode, name: string): Element[] {
  return Array.from(parent.querySelectorAll('*')).filter((node) => localName(node) === name) as Element[];
}

function firstChildByName(parent: ParentNode, name: string): Element | undefined {
  return childrenByName(parent, name)[0];
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
  if (document.querySelector('parsererror')) throw new Error('Malformed worksheet XML.');
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
      return { ok: false, diagnostics: preflight.diagnostics.map((item) => ({ code: item.code as any, message: item.message })), trace: [] };
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
    const relationshipMap = new Map<string, string>();
    for (const match of relsXml.matchAll(/Relationship[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"/g)) {
      const target = match[2].replace(/^\//, '');
      relationshipMap.set(match[1], target.startsWith('xl/') ? target : `xl/${target}`);
    }
    const sheetMatches = [...workbookXml.matchAll(/<sheet\b[^>]*name="([^"]+)"[^>]*r:id="([^"]+)"[^>]*>/g)];
    if (!sheetMatches.length) return fail('UNSUPPORTED_FORMAT', 'Workbook contains no worksheets.');
    const selected = sheetMatches.find((match) => match[1] === options.sheetName) ?? sheetMatches[0];
    if (options.sheetName && selected[1] !== options.sheetName && !sheetMatches.some((match) => match[1] === options.sheetName)) {
      return fail('UNSUPPORTED_FORMAT', `Worksheet not found: ${options.sheetName}`);
    }
    const sheetPath = relationshipMap.get(selected[2]);
    if (!sheetPath) return fail('UNSUPPORTED_FORMAT', 'Worksheet relationship is missing.');
    const shared = sharedStrings(await get('xl/sharedStrings.xml'));
    const rows = parseWorksheet(await get(sheetPath), shared, options.rejectFormulas !== false, options.signal);
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
    return { ok: true, value: { headers, rows: data, headerOffset, delimiter: '' } as Table, diagnostics: [], trace: [{ phase: 'parse', message: `Parsed ${data.length} data rows and ${headers.length} columns.` }] };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message === 'CANCELLED') return fail('CANCELLED', 'Loading cancelled.');
    if (message === 'FORMULA_REJECTED') return fail('FORMULA_REJECTED', 'Formula cells are not supported for safe browser comparison.');
    if (message === 'ZIP_LIMIT') return fail('RESOURCE_LIMIT', 'XLSX decompression exceeded the browser resource limit.');
    return fail('UNSUPPORTED_FORMAT', `Unable to load XLSX: ${message}`);
  }
}

export const xlsxLoader = loadXlsx;
