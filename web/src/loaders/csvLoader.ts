import type { Diagnostic, LoaderOptions, LoaderResult, ScalarV1, Table, TraceEvent } from '../engine/contracts';
import { encodeScalar } from '../engine/serialization';

const supported = new Set([',', ';', '\t', '|']);
const fail = (diagnostics: Diagnostic[], trace: TraceEvent[] = []): LoaderResult => ({ ok: false, diagnostics, trace });

function parse(text: string, delimiter: string): string[][] | Diagnostic {
  const rows: string[][] = []; let row: string[] = []; let field = ''; let quoted = false; let afterQuote = false;
  const push = () => { row.push(field); field = ''; };
  const end = () => { push(); rows.push(row); row = []; };
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (quoted) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i += 1; } else { quoted = false; afterQuote = true; } }
      else field += c;
    } else if (afterQuote) {
      if (c === delimiter) { push(); afterQuote = false; }
      else if (c === '\r' || c === '\n') { end(); afterQuote = false; if (c === '\r' && text[i + 1] === '\n') i += 1; }
      else if (c === ' ' || c === '\t') { /* permit trailing whitespace */ }
      else return { code: 'MALFORMED_CSV', message: `Unexpected character after closing quote at offset ${i}.` };
    } else if (c === '"' && field.length === 0) quoted = true;
    else if (c === delimiter) push();
    else if (c === '\r' || c === '\n') { end(); if (c === '\r' && text[i + 1] === '\n') i += 1; }
    else field += c;
  }
  if (quoted) return { code: 'MALFORMED_CSV', message: 'CSV ended inside a quoted field.' };
  if (field.length || row.length) end();
  return rows;
}

export function loadCsv(input: string | Uint8Array, options: LoaderOptions = {}): LoaderResult {
  const trace: TraceEvent[] = [{ phase: 'load', message: 'Reading CSV input.' }];
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input).byteLength : input.byteLength;
  if (bytes > (options.maxBytes ?? 64 * 1024 * 1024)) return fail([{ code: 'RESOURCE_LIMIT', message: 'CSV input exceeds the browser byte limit.' }], trace);
  if (options.format && options.format !== 'csv' && options.format !== 'tsv') return fail([{ code: 'UNSUPPORTED_FORMAT', message: `Unsupported format: ${options.format}.` }], trace);
  if (options.encoding && options.encoding !== 'utf-8' && options.encoding !== 'utf-8-bom') return fail([{ code: 'UNSUPPORTED_ENCODING', message: `Unsupported encoding: ${options.encoding}.` }], trace);
  const delimiter = options.delimiter ?? (options.format === 'tsv' ? '\t' : ',');
  if (delimiter.length !== 1 || !supported.has(delimiter)) return fail([{ code: 'INVALID_DELIMITER', message: 'Delimiter must be one of comma, semicolon, tab, or pipe.' }], trace);
  const offset = options.headerOffset ?? 0;
  if (!Number.isInteger(offset) || offset < 0) return fail([{ code: 'INVALID_HEADER_OFFSET', message: 'Header offset must be a non-negative integer.' }], trace);
  let text: string;
  try { text = typeof input === 'string' ? input : new TextDecoder('utf-8', { fatal: true }).decode(input); }
  catch { return fail([{ code: 'INVALID_UTF8', message: 'Input is not valid UTF-8.' }], trace); }
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  if (!text.trim()) return fail([{ code: 'EMPTY_INPUT', message: 'CSV input is empty.' }], trace);
  const parsed = parse(text, delimiter);
  if (!Array.isArray(parsed)) return fail([parsed], trace);
  if (offset >= parsed.length) return fail([{ code: 'INVALID_HEADER_OFFSET', message: 'Header offset exceeds the number of CSV rows.' }], trace);
  const sourceHeader = parsed[offset];
  const width = Math.max(sourceHeader.length, ...parsed.slice(offset + 1).map(r => r.length), 0);
  if (width > (options.maxColumns ?? 512)) return fail([{ code: 'RESOURCE_LIMIT', message: 'CSV input exceeds the browser column limit.' }], trace);
  if (parsed.length - offset - 1 > (options.maxRows ?? 1_000_000) || width * Math.max(0, parsed.length - offset - 1) > (options.maxCells ?? 5_000_000)) return fail([{ code: 'RESOURCE_LIMIT', message: 'CSV input exceeds the browser row/cell limit.' }], trace);
  const headers: string[] = []; const seen = new Map<string, number>();
  for (let i = 0; i < width; i += 1) {
    const base = (sourceHeader[i] ?? '').trim() || `column_${i + 1}`;
    const count = (seen.get(base) ?? 0) + 1; seen.set(base, count); headers.push(count === 1 ? base : `${base}_${count}`);
  }
  const rows: ScalarV1[][] = parsed.slice(offset + 1).map(r => Array.from({ length: width }, (_, i) => encodeScalar(r[i] ?? '')));
  const table: Table = { headers, rows, headerOffset: offset, delimiter };
  trace.push({ phase: 'parse', message: `Parsed ${rows.length} data rows and ${headers.length} columns.` });
  return { ok: true, value: table, diagnostics: [], trace };
}

export default loadCsv;
export const parseCsv = loadCsv;
