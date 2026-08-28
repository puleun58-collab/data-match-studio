import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DOMParser as XmlDomParser } from '@xmldom/xmldom';
import * as XLSX from 'xlsx';
import { listXlsxSheets, loadXlsx, parseWorkbookSheets } from '../src/loaders/xlsxLoader';
import { decodeScalar } from '../src/engine/serialization';

// Node's test runner has no browser DOMParser; xmldom implements enough of the
// DOM (childNodes/localName/attributes/textContent) for the namespace-agnostic
// parsing paths this loader relies on. Real browsers use their native DOMParser.
if (typeof globalThis.DOMParser === 'undefined') {
  globalThis.DOMParser = XmlDomParser as unknown as typeof DOMParser;
}

function u16le(value: number): number[] { return [value & 0xff, (value >> 8) & 0xff]; }
function u32le(value: number): number[] { return [value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff, (value >>> 24) & 0xff]; }

/** Builds a minimal STORED-method ZIP. CRC-32 is unchecked by this loader's preflight/inflate path, so it is left as 0. */
function buildZip(entries: { name: string; content: string }[]): Uint8Array {
  const encoder = new TextEncoder();
  const bytes: number[] = [];
  const localOffsets: number[] = [];
  for (const entry of entries) {
    const nameBytes = Array.from(encoder.encode(entry.name));
    const dataBytes = Array.from(encoder.encode(entry.content));
    localOffsets.push(bytes.length);
    bytes.push(
      ...u32le(0x04034b50), ...u16le(20), ...u16le(0), ...u16le(0), ...u16le(0), ...u16le(0),
      ...u32le(0), ...u32le(dataBytes.length), ...u32le(dataBytes.length),
      ...u16le(nameBytes.length), ...u16le(0),
      ...nameBytes, ...dataBytes,
    );
  }
  const centralStart = bytes.length;
  entries.forEach((entry, index) => {
    const nameBytes = Array.from(encoder.encode(entry.name));
    const dataLength = encoder.encode(entry.content).length;
    bytes.push(
      ...u32le(0x02014b50), ...u16le(20), ...u16le(20), ...u16le(0), ...u16le(0), ...u16le(0), ...u16le(0),
      ...u32le(0), ...u32le(dataLength), ...u32le(dataLength),
      ...u16le(nameBytes.length), ...u16le(0), ...u16le(0), ...u16le(0), ...u16le(0), ...u32le(0),
      ...u32le(localOffsets[index]), ...nameBytes,
    );
  });
  const centralSize = bytes.length - centralStart;
  bytes.push(...u32le(0x06054b50), ...u16le(0), ...u16le(0), ...u16le(entries.length), ...u16le(entries.length), ...u32le(centralSize), ...u32le(centralStart), ...u16le(0));
  return Uint8Array.from(bytes);
}

type SheetFixture = { name: string; rid: string; text: string };

function relsXml(sheets: SheetFixture[]): string {
  const body = sheets.map((sheet, index) => `<Relationship Id="${sheet.rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${body}</Relationships>`;
}

function worksheetXml(text: string): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>제목</t></is></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>${text}</t></is></c></row></sheetData></worksheet>`;
}

/** `elementPrefix`/`relPrefix` model the two independent namespace-prefix axes the bug report calls out. */
function workbookXml(sheets: SheetFixture[], elementPrefix?: string, relPrefix = 'r'): string {
  const tag = elementPrefix ? `${elementPrefix}:` : '';
  const elementNsDecl = elementPrefix ? `xmlns:${elementPrefix}="http://schemas.openxmlformats.org/spreadsheetml/2006/main"` : 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"';
  const sheetsXml = sheets.map((sheet) => `<${tag}sheet name="${sheet.name}" sheetId="1" ${relPrefix}:id="${sheet.rid}"/>`).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><${tag}workbook ${elementNsDecl} xmlns:${relPrefix}="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><${tag}sheets>${sheetsXml}</${tag}sheets></${tag}workbook>`;
}

function buildPackage(workbook: string, sheets: SheetFixture[]): Uint8Array {
  return buildZip([
    { name: 'xl/workbook.xml', content: workbook },
    { name: 'xl/_rels/workbook.xml.rels', content: relsXml(sheets) },
    ...sheets.map((sheet, index) => ({ name: `xl/worksheets/sheet${index + 1}.xml`, content: worksheetXml(sheet.text) })),
  ]);
}

test('parseWorkbookSheets reads a default-namespace workbook.xml', () => {
  const sheets = parseWorkbookSheets(workbookXml([{ name: 'Sheet1', rid: 'rId1', text: 'a' }]));
  assert.deepEqual(sheets, [{ name: 'Sheet1', relationshipId: 'rId1' }]);
});

test('default-namespace workbook: listXlsxSheets and loadXlsx both succeed', async () => {
  const fixture = [{ name: 'Sheet1', rid: 'rId1', text: '값1' }];
  const bytes = buildPackage(workbookXml(fixture), fixture);
  const listed = await listXlsxSheets(bytes);
  assert.equal(listed.ok, true);
  if (!listed.ok) return;
  assert.deepEqual(listed.sheets, ['Sheet1']);
  const loaded = await loadXlsx(bytes, { headerOffset: 0, dataStartRow: 1 });
  assert.equal(loaded.ok, true);
  if (!loaded.ok) return;
  assert.deepEqual(loaded.value.headers, ['제목']);
  assert.equal(decodeScalar(loaded.value.rows[0][0]), '값1');
});

test('x:sheet namespace-prefixed workbook.xml is recognized, not reported as having no worksheets', async () => {
  const fixture = [{ name: '데이터A', rid: 'rId1', text: '프리픽스값' }];
  const bytes = buildPackage(workbookXml(fixture, 'x'), fixture);
  const listed = await listXlsxSheets(bytes);
  assert.equal(listed.ok, true);
  if (!listed.ok) return;
  assert.deepEqual(listed.sheets, ['데이터A']);
  const loaded = await loadXlsx(bytes, { sheetName: '데이터A' });
  assert.equal(loaded.ok, true);
  if (!loaded.ok) return;
  assert.equal(decodeScalar(loaded.value.rows[0][0]), '프리픽스값');
});

test('multiple worksheets are all listed in order and selectable by name', async () => {
  const fixture = [
    { name: '첫번째', rid: 'rId1', text: 'one' },
    { name: '두번째', rid: 'rId2', text: 'two' },
    { name: '세번째', rid: 'rId3', text: 'three' },
  ];
  const bytes = buildPackage(workbookXml(fixture, 'x'), fixture);
  const listed = await listXlsxSheets(bytes);
  assert.equal(listed.ok, true);
  if (!listed.ok) return;
  assert.deepEqual(listed.sheets, ['첫번째', '두번째', '세번째']);
  const loaded = await loadXlsx(bytes, { sheetName: '세번째' });
  assert.equal(loaded.ok, true);
  if (!loaded.ok) return;
  assert.equal(decodeScalar(loaded.value.rows[0][0]), 'three');
});

test('Korean worksheet names round-trip through parseWorkbookSheets, listXlsxSheets, and loadXlsx', async () => {
  const fixture = [{ name: '테스트안내', rid: 'R774b0d33cb0642f8', text: '한글값' }];
  assert.deepEqual(parseWorkbookSheets(workbookXml(fixture, 'x')), [{ name: '테스트안내', relationshipId: 'R774b0d33cb0642f8' }]);
  const bytes = buildPackage(workbookXml(fixture, 'x'), fixture);
  const listed = await listXlsxSheets(bytes);
  assert.equal(listed.ok, true);
  if (!listed.ok) return;
  assert.deepEqual(listed.sheets, ['테스트안내']);
  const loaded = await loadXlsx(bytes);
  assert.equal(loaded.ok, true);
  if (!loaded.ok) return;
  assert.equal(decodeScalar(loaded.value.rows[0][0]), '한글값');
});

test('relationship id attribute with a non-"r" namespace prefix (rel:id) still resolves the worksheet path', async () => {
  const fixture = [{ name: 'Sheet1', rid: 'rIdCustom', text: 'relPrefixValue' }];
  const bytes = buildPackage(workbookXml(fixture, undefined, 'rel'), fixture);
  const sheets = parseWorkbookSheets(workbookXml(fixture, undefined, 'rel'));
  assert.deepEqual(sheets, [{ name: 'Sheet1', relationshipId: 'rIdCustom' }]);
  const loaded = await loadXlsx(bytes);
  assert.equal(loaded.ok, true);
  if (!loaded.ok) return;
  assert.equal(decodeScalar(loaded.value.rows[0][0]), 'relPrefixValue');
});

test('a workbook with genuinely zero worksheets reports "no worksheets", not a parse failure', async () => {
  const emptyWorkbook = '<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheets></sheets></workbook>';
  assert.deepEqual(parseWorkbookSheets(emptyWorkbook), []);
  const bytes = buildZip([
    { name: 'xl/workbook.xml', content: emptyWorkbook },
    { name: 'xl/_rels/workbook.xml.rels', content: relsXml([]) },
  ]);
  const listed = await listXlsxSheets(bytes);
  assert.equal(listed.ok, false);
  if (listed.ok) return;
  assert.match(listed.diagnostics[0].message, /no worksheets/i);
  const loaded = await loadXlsx(bytes);
  assert.equal(loaded.ok, false);
  if (loaded.ok) return;
  assert.match(loaded.diagnostics[0].message, /no worksheets/i);
});

test('malformed workbook.xml is reported as a distinct parse failure, never as "no worksheets"', async () => {
  const malformed = '<workbook><sheets><sheet name="A"></sheets></workbook>';
  assert.throws(() => parseWorkbookSheets(malformed));
  const bytes = buildZip([
    { name: 'xl/workbook.xml', content: malformed },
    { name: 'xl/_rels/workbook.xml.rels', content: relsXml([]) },
  ]);
  const listed = await listXlsxSheets(bytes);
  assert.equal(listed.ok, false);
  if (listed.ok) return;
  assert.doesNotMatch(listed.diagnostics[0].message, /no worksheets/i);
  const loaded = await loadXlsx(bytes);
  assert.equal(loaded.ok, false);
  if (loaded.ok) return;
  assert.doesNotMatch(loaded.diagnostics[0].message, /no worksheets/i);
});

test('an existing SheetJS-generated XLSX fixture still loads (regression sanity check)', async () => {
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([['이름', '값'], ['행1', 10]]);
  XLSX.utils.book_append_sheet(workbook, sheet, '기존시트');
  const buffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer' }) as Uint8Array;
  const listed = await listXlsxSheets(buffer);
  assert.equal(listed.ok, true);
  if (!listed.ok) return;
  assert.deepEqual(listed.sheets, ['기존시트']);
  const loaded = await loadXlsx(buffer);
  assert.equal(loaded.ok, true);
  if (!loaded.ok) return;
  assert.deepEqual(loaded.value.headers, ['이름', '값']);
  assert.equal(decodeScalar(loaded.value.rows[0][0]), '행1');
  assert.equal(decodeScalar(loaded.value.rows[0][1]), 10);
});
