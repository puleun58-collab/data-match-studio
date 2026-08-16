import type { ComparisonResult } from '../engine/comparisonEngine';
import { decodeScalar } from '../engine/serialization';
import * as XLSX from 'xlsx';

function save(text: string, filename: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = filename; anchor.click(); URL.revokeObjectURL(url);
}

function comparisonValues(row: ComparisonResult['rows'][number], side: 'A' | 'B'): string {
  const values = row.trace.filter(item => item.side === side && item.ruleId !== 'row').flatMap(item => item.originalValues.map(decodeScalar)).map(value => value === null ? '(빈 값)' : String(value));
  return [...new Set(values)].join(' | ');
}

export function resultCsv(result: ComparisonResult): string {
  const quote = (value: unknown) => `"${String(value ?? '').replaceAll('"', '""')}"`;
  return ['key,status,displayStatus,aCount,bCount,firstSheetValue,secondSheetValue', ...result.rows.map((row) => [row.key.map(decodeScalar).join(' | '), row.status, row.displayStatus, row.aCount, row.bCount, comparisonValues(row, 'A'), comparisonValues(row, 'B')].map(quote).join(','))].join('\n');
}

export function downloadResultCsv(result: ComparisonResult): void { save(resultCsv(result), 'data-match-result.csv', 'text/csv;charset=utf-8'); }
export function downloadResultJson(result: ComparisonResult): void { save(JSON.stringify(result, null, 2), 'data-match-result.json', 'application/json'); }
export function downloadResultXlsx(result: ComparisonResult): void {
  const rows = result.rows.map((row) => ({ key: row.key.map(decodeScalar).join(' | '), status: row.status, displayStatus: row.displayStatus, aCount: row.aCount, bCount: row.bCount, firstSheetValue: comparisonValues(row, 'A'), secondSheetValue: comparisonValues(row, 'B'), trace: JSON.stringify(row.trace) }));
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), 'results');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet([result.summary]), 'summary');
  const bytes = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer;
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })); const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'data-match-result.xlsx'; anchor.click(); URL.revokeObjectURL(url);
}
