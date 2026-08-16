import { useMemo, useState } from 'react';
import type { ComparisonResult } from '../../web/src/engine/comparisonEngine';
import { decodeScalar } from '../../web/src/engine/serialization';
import { downloadResultCsv, downloadResultJson, downloadResultXlsx } from '../../web/src/export/download';

const statusLabels: Record<string, string> = {
  matched: '일치', changed: '불일치', added: '두 번째 시트에만 존재', removed: '첫 번째 시트에만 존재',
  duplicate: '중복 키', 'nm-pending': 'N:M 처리 필요', 'invalid-key': '빈 키', 'conversion-failed': '형식 변환 실패',
};

function displayValue(value: unknown): string {
  return typeof value === 'number' && Number.isFinite(value)
    ? new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 10 }).format(value)
    : value === null ? '(빈 값)' : String(value);
}

function comparisonValues(resultRow: ComparisonResult['rows'][number], side: 'A' | 'B'): string {
  const values = resultRow.trace
    .filter(item => item.side === side && item.ruleId !== 'row')
    .flatMap(item => item.originalValues.map(value => decodeScalar(value)))
    .map(displayValue);
  return [...new Set(values)].join(', ') || '—';
}

export default function ResultsPanel({ result }: { result?: ComparisonResult }) {
  const [status, setStatus] = useState('all');
  const [query, setQuery] = useState('');
  const validRows = useMemo(() => result?.rows.filter(row => row.status !== 'invalid-key') ?? [], [result]);
  const blankRows = useMemo(() => result?.rows.filter(row => row.status === 'invalid-key') ?? [], [result]);
  const rows = useMemo(() => validRows.filter(row => (status === 'all' || row.status === status) && row.key.map(decodeScalar).join(' / ').toLowerCase().includes(query.toLowerCase())), [validRows, status, query]);
  if (!result) return null;
  const duplicateBlocked = result.summary.comparable === 0 && (result.summary.duplicate > 0 || result.summary.nmPending > 0);
  const matched = validRows.filter(row => row.status === 'matched').length;
  const mismatched = validRows.filter(row => row.status === 'changed').length;
  const firstOnly = validRows.filter(row => row.status === 'removed').length;
  const secondOnly = validRows.filter(row => row.status === 'added').length;
  const firstBlank = blankRows.filter(row => row.aCount > 0).length;
  const secondBlank = blankRows.filter(row => row.bCount > 0).length;
  const matchRate = matched + mismatched ? matched / (matched + mismatched) * 100 : 0;
  const otherDiagnostics = result.diagnostics.filter(diagnostic => diagnostic.code !== 'INVALID_KEY');

  return <section className="results-panel">
    <h2>Lane 비교 결과</h2>
    <div className="summary-cards"><strong>유효 Lane 결과<br />{validRows.length.toLocaleString('ko-KR')}</strong><strong>일치<br />{matched.toLocaleString('ko-KR')}</strong><strong>불일치<br />{mismatched.toLocaleString('ko-KR')}</strong><strong>첫 시트에만<br />{firstOnly.toLocaleString('ko-KR')}</strong><strong>두 번째 시트에만<br />{secondOnly.toLocaleString('ko-KR')}</strong><strong>빈 키 행<br />{blankRows.length.toLocaleString('ko-KR')}</strong><strong>일치율<br />{matchRate.toFixed(2)}%</strong></div>
    {duplicateBlocked && <p className="result-warning" role="alert">중복 키 때문에 값 비교가 실행되지 않았습니다. 위의 ‘중복 키/N:M 처리 방식’을 ‘집합으로 비교’ 또는 목적에 맞는 방식으로 변경한 뒤 다시 실행하세요.</p>}
    <div className="result-toolbar"><button onClick={() => downloadResultCsv(result)}>CSV 다운로드</button><button onClick={() => downloadResultJson(result)}>JSON 다운로드</button><button onClick={() => downloadResultXlsx(result)}>XLSX 다운로드</button><input placeholder="Lane 키 검색" value={query} onChange={event => setQuery(event.target.value)} /><select value={status} onChange={event => setStatus(event.target.value)}><option value="all">전체 상태</option>{Object.entries(statusLabels).filter(([value]) => value !== 'invalid-key').map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
    <div className="result-table-wrap"><table><thead><tr><th>Lane 키</th><th>일치 여부</th><th>첫째/둘째 행 수</th><th>첫 번째 시트 비교값</th><th>두 번째 시트 비교값</th></tr></thead><tbody>{rows.map((row, index) => <tr key={index}><td>{row.key.map(value => String(decodeScalar(value))).join(' / ')}</td><td>{statusLabels[row.status] ?? row.displayStatus}</td><td>{row.aCount}/{row.bCount}</td><td>{comparisonValues(row, 'A')}</td><td>{comparisonValues(row, 'B')}</td></tr>)}</tbody></table></div>
    {blankRows.length > 0 && <details className="blank-key-details"><summary>Lane 값이 없는 행 {blankRows.length}건 — 첫 번째 시트 {firstBlank}건 / 두 번째 시트 {secondBlank}건</summary><p>키가 없어 Lane 비교와 일치율 계산에서는 제외했습니다.</p><div className="result-table-wrap"><table><thead><tr><th>시트</th><th>Excel 행</th><th>선택한 비교값</th><th>사유</th></tr></thead><tbody>{blankRows.map((row, index) => { const side = row.aCount ? 'A' : 'B'; const rowIndex = side === 'A' ? row.provenance.leftRow : row.provenance.rightRow; return <tr key={index}><td>{side === 'A' ? '첫 번째 시트' : '두 번째 시트'}</td><td>{(rowIndex ?? 0) + 2}</td><td>{comparisonValues(row, side)}</td><td>선택한 Lane 키 컬럼이 비어 있음</td></tr>; })}</tbody></table></div></details>}
    {otherDiagnostics.length > 0 && <details><summary>기타 진단 메시지 {otherDiagnostics.length}건</summary><ul>{otherDiagnostics.map((diagnostic, index) => <li key={index}>{diagnostic.message}</li>)}</ul></details>}
  </section>;
}
