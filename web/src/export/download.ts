import type { ComparisonResult } from '../engine/comparisonEngine';
import { decodeScalar } from '../engine/serialization';
import * as XLSX from 'xlsx';

function save(text: string, filename: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = filename; anchor.click(); URL.revokeObjectURL(url);
}

function comparisonValues(row: ComparisonResult['rows'][number], side: 'A' | 'B'): string {
  const values = row.trace.filter(item => item.side === side && item.ruleId !== 'row').flatMap(item => item.originalValues.map(decodeScalar)).map(value => typeof value === 'number' && Number.isFinite(value) ? new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 10 }).format(value) : value === null ? '(빈 값)' : String(value));
  return [...new Set(values)].join(' | ');
}

function keyMappingValue(row: ComparisonResult['rows'][number], side: 'A' | 'B', field: 'original' | 'normalized' | 'standard'): string {
  return (row.keyMapping?.[side] ?? [])
    .map(keyRow => keyRow.map(item => item[field] === null ? '(빈 값)' : String(item[field])).join(' | '))
    .filter((value, index, values) => values.indexOf(value) === index)
    .join(' / ');
}

function mappingApplied(row: ComparisonResult['rows'][number], side: 'A' | 'B'): string {
  return (row.keyMapping?.[side] ?? []).some(keyRow => keyRow.some(item => item.applied)) ? 'Yes' : 'No';
}

export function resultCsv(result: ComparisonResult): string {
  const quote = (value: unknown) => `"${String(value ?? '').replaceAll('"', '""')}"`;
  const headers = ['key', 'status', 'displayStatus', 'aCount', 'bCount', 'aOriginalKey', 'aNormalizedKey', 'aStandardKey', 'aMappingApplied', 'bOriginalKey', 'bNormalizedKey', 'bStandardKey', 'bMappingApplied', 'firstSheetValue', 'secondSheetValue'];
  return [headers.join(','), ...result.rows.map((row) => [row.key.map(decodeScalar).join(' | '), row.status, row.displayStatus, row.aCount, row.bCount, keyMappingValue(row, 'A', 'original'), keyMappingValue(row, 'A', 'normalized'), keyMappingValue(row, 'A', 'standard'), mappingApplied(row, 'A'), keyMappingValue(row, 'B', 'original'), keyMappingValue(row, 'B', 'normalized'), keyMappingValue(row, 'B', 'standard'), mappingApplied(row, 'B'), comparisonValues(row, 'A'), comparisonValues(row, 'B')].map(quote).join(','))].join('\n');
}

export function downloadResultCsv(result: ComparisonResult): void { save(resultCsv(result), 'data-match-result.csv', 'text/csv;charset=utf-8'); }
export function downloadResultJson(result: ComparisonResult): void { save(JSON.stringify(result, null, 2), 'data-match-result.json', 'application/json'); }
export function downloadResultXlsx(result: ComparisonResult): void {
  const validRows = result.rows.filter((row) => row.status !== 'invalid-key');
  const rows = validRows.map((row) => ({ Lane: row.key.map(decodeScalar).join(' | '), 판정: row.status === 'matched' ? '일치' : row.status === 'changed' ? '불일치' : row.displayStatus, 첫_시트_행수: row.aCount, 두번째_시트_행수: row.bCount, A_원본_키: keyMappingValue(row, 'A', 'original'), A_정규화_키: keyMappingValue(row, 'A', 'normalized'), A_표준_키: keyMappingValue(row, 'A', 'standard'), A_매핑_적용: mappingApplied(row, 'A'), B_원본_키: keyMappingValue(row, 'B', 'original'), B_정규화_키: keyMappingValue(row, 'B', 'normalized'), B_표준_키: keyMappingValue(row, 'B', 'standard'), B_매핑_적용: mappingApplied(row, 'B'), 첫_시트_비교값: comparisonValues(row, 'A'), 두번째_시트_비교값: comparisonValues(row, 'B') }));
  const blankRows = result.rows.filter((row) => row.status === 'invalid-key').map((row) => { const side = row.aCount ? 'A' : 'B'; const rowIndex = side === 'A' ? row.provenance.leftRow : row.provenance.rightRow; return { 시트: side === 'A' ? '첫 번째 시트' : '두 번째 시트', Excel_행: (rowIndex ?? 0) + 2, 선택한_비교값: comparisonValues(row, side), 사유: '선택한 Lane 키 컬럼이 비어 있음' }; });
  const matched = validRows.filter((row) => row.status === 'matched').length;
  const mismatched = validRows.filter((row) => row.status === 'changed').length;
  const summary = [{ 유효_Lane_결과: validRows.length, 일치: matched, 불일치: mismatched, 첫_시트에만: validRows.filter((row) => row.status === 'removed').length, 두번째_시트에만: validRows.filter((row) => row.status === 'added').length, 빈_키_행: blankRows.length, 일치율: matched + mismatched ? matched / (matched + mismatched) : 0 }];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), 'Lane 비교 결과');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows.filter((row) => row.판정 === '불일치')), '불일치');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows.filter((row) => row.판정 === '첫 번째 시트에만 존재')), '첫 시트에만 존재');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows.filter((row) => row.판정 === '두 번째 시트에만 존재')), '두번째 시트에만 존재');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(blankRows), '빈 키 행');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(summary), '요약');
  const bytes = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer;
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })); const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'data-match-result.xlsx'; anchor.click(); URL.revokeObjectURL(url);
}
