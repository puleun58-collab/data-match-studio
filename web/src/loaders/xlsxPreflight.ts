export type XlsxDiagnosticCode = 'INVALID_ZIP' | 'ZIP_LIMIT' | 'UNSAFE_PATH' | 'MACRO_REJECTED' | 'FORMULA_REJECTED' | 'UNSUPPORTED_XLSX' | 'DECOMPRESSION_FAILED';
export type XlsxDiagnostic = { code: XlsxDiagnosticCode; message: string; details?: Record<string, unknown> };
export type XlsxLimits = { maxInputBytes: number; maxEntries: number; maxCompressedBytes: number; maxUncompressedBytes: number; maxCompressionRatio: number; maxWorksheetBytes: number; maxSharedStringsBytes: number; maxRows: number; maxColumns: number; maxCells: number };
export const DEFAULT_XLSX_LIMITS: XlsxLimits = { maxInputBytes: 128 * 1024 * 1024, maxEntries: 2000, maxCompressedBytes: 64 * 1024 * 1024, maxUncompressedBytes: 256 * 1024 * 1024, maxCompressionRatio: 100, maxWorksheetBytes: 64 * 1024 * 1024, maxSharedStringsBytes: 64 * 1024 * 1024, maxRows: 1_000_000, maxColumns: 512, maxCells: 5_000_000 };
export type ZipEntry = { name: string; compressedSize: number; uncompressedSize: number; method: number; localOffset: number };
export type XlsxPreflight = { entries: ZipEntry[]; diagnostics: XlsxDiagnostic[] };

const decoder = new TextDecoder();
function u16(b: Uint8Array, p: number) { return b[p] | (b[p + 1] << 8); }
function u32(b: Uint8Array, p: number) { return (b[p] | (b[p + 1] << 8) | (b[p + 2] << 16) | (b[p + 3] << 24)) >>> 0; }
function unsafe(name: string) { return name.startsWith('/') || name.split('/').some(x => x === '..' || x === '') || /^[A-Za-z]:/.test(name) || name.includes('\\') || /[\x00-\x1f]/.test(name); }

export function inspectXlsxZip(input: ArrayBuffer | Uint8Array, limits: Partial<XlsxLimits> = {}): XlsxPreflight {
  const lim = { ...DEFAULT_XLSX_LIMITS, ...limits }; const b = input instanceof Uint8Array ? input : new Uint8Array(input); const diagnostics: XlsxDiagnostic[] = [];
  if (b.byteLength > lim.maxInputBytes) return { entries: [], diagnostics: [{ code: 'ZIP_LIMIT', message: 'XLSX input exceeds the browser byte limit.' }] };
  let eocd = -1; for (let p = Math.max(0, b.length - 22 - 0xffff); p <= b.length - 22; p++) if (u32(b, p) === 0x06054b50) eocd = p;
  if (eocd < 0) return { entries: [], diagnostics: [{ code: 'INVALID_ZIP', message: 'ZIP end-of-central-directory record not found.' }] };
  const count = u16(b, eocd + 10), size = u32(b, eocd + 12), offset = u32(b, eocd + 16);
  if (count === 0xffff || size === 0xffffffff || offset === 0xffffffff) return { entries: [], diagnostics: [{ code: 'ZIP_LIMIT', message: 'ZIP64 workbooks are not supported by browser preflight.' }] };
  if (count > lim.maxEntries || offset + size > b.length) return { entries: [], diagnostics: [{ code: 'ZIP_LIMIT', message: 'ZIP central directory exceeds safety limits.', details: { entryCount: count } }] };
  const entries: ZipEntry[] = []; let p = offset; let totalC = 0, totalU = 0;
  for (let i = 0; i < count; i++) {
    if (p + 46 > b.length || u32(b, p) !== 0x02014b50) { diagnostics.push({ code: 'INVALID_ZIP', message: 'Malformed ZIP central directory.' }); break; }
    const flags = u16(b, p + 8), method = u16(b, p + 10), c = u32(b, p + 20), u = u32(b, p + 24), nl = u16(b, p + 28), xl = u16(b, p + 30), cl = u16(b, p + 32); const name = decoder.decode(b.subarray(p + 46, p + 46 + nl));
    if (flags & 1) diagnostics.push({ code: 'UNSUPPORTED_XLSX', message: `Encrypted ZIP entry is not supported: ${name}` });
    if (method !== 0 && method !== 8) diagnostics.push({ code: 'UNSUPPORTED_XLSX', message: `Unsupported ZIP compression method for ${name}.` });
    if (unsafe(name)) diagnostics.push({ code: 'UNSAFE_PATH', message: `Unsafe ZIP entry path: ${name}` });
    totalC += c; totalU += u; if (totalC > lim.maxCompressedBytes || totalU > lim.maxUncompressedBytes || (c > 0 && u / c > lim.maxCompressionRatio)) diagnostics.push({ code: 'ZIP_LIMIT', message: `ZIP entry exceeds safety limits: ${name}`, details: { compressedSize: c, uncompressedSize: u } });
    entries.push({ name, compressedSize: c, uncompressedSize: u, method, localOffset: u32(b, p + 42) }); p += 46 + nl + xl + cl;
  }
  for (const e of entries) { if (/^xl\/worksheets\//i.test(e.name) && e.uncompressedSize > lim.maxWorksheetBytes) diagnostics.push({ code: 'ZIP_LIMIT', message: `Worksheet exceeds limit: ${e.name}` }); if (/^xl\/sharedStrings\.xml$/i.test(e.name) && e.uncompressedSize > lim.maxSharedStringsBytes) diagnostics.push({ code: 'ZIP_LIMIT', message: 'Shared strings exceed limit.' }); if (/vbaProject|\.bin$/i.test(e.name)) diagnostics.push({ code: 'MACRO_REJECTED', message: 'Macro-enabled workbooks are not supported.' }); }
  return { entries, diagnostics };
}

export function zipEntryBytes(input: ArrayBuffer | Uint8Array, entry: ZipEntry): Uint8Array { const b = input instanceof Uint8Array ? input : new Uint8Array(input); const p = entry.localOffset; if (p < 0 || p + 30 > b.length || u32(b, p) !== 0x04034b50) throw new Error('Invalid local ZIP header'); const n = u16(b, p + 26), x = u16(b, p + 28); const start = p + 30 + n + x; const end = start + entry.compressedSize; if (start < p + 30 || end < start || end > b.length) throw new Error('Invalid local ZIP bounds'); return b.subarray(start, end); }
