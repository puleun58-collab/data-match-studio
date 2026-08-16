import { useMemo, useState } from 'react';
import type { ComparisonResult } from '../../web/src/engine/comparisonEngine';
import { decodeScalar } from '../../web/src/engine/serialization';
import { downloadResultCsv, downloadResultJson, downloadResultXlsx } from '../../web/src/export/download';

const statusLabels: Record<string, string> = {
  matched: '동일', changed: '불일치', added: '두 번째 시트에만 존재', removed: '첫 번째 시트에만 존재',
  duplicate: '중복 키', 'nm-pending': 'N:M 처리 필요', 'invalid-key': '빈 키', 'conversion-failed': '형식 변환 실패',
};

function comparisonValues(resultRow: ComparisonResult['rows'][number], side: 'A' | 'B'): string {
  const values = resultRow.trace
    .filter(item => item.side === side && item.ruleId !== 'row')
    .flatMap(item => item.originalValues.map(value => decodeScalar(value)))
    .map(value => value === null ? '(빈 값)' : String(value));
  return [...new Set(values)].join(', ') || '—';
}

export default function ResultsPanel({ result }: { result?: ComparisonResult }) {
  const [status, setStatus] = useState('all');
  const [query, setQuery] = useState('');
  const rows = useMemo(() => result?.rows.filter(row => (status === 'all' || row.status === status) && JSON.stringify(row.key).toLowerCase().includes(query.toLowerCase())) ?? [], [result, status, query]);
  if (!result) return null;
  const duplicateBlocked = result.summary.comparable === 0 && (result.summary.duplicate > 0 || result.summary.nmPending > 0);
  return <section className="results-panel">
    <h2>비교 결과 ({rows.length}건)</h2>
    <p>전체 {result.summary.total} · 비교 가능 {result.summary.comparable} · 동일 {result.summary.identical} · 불일치 {result.summary.mismatch} · 일치율 {result.summary.matchRate.toFixed(2)}%</p>
    {duplicateBlocked && <p className="result-warning" role="alert">중복 키 때문에 값 비교가 실행되지 않았습니다. 위의 ‘중복 키/N:M 처리 방식’을 ‘집합으로 비교’ 또는 목적에 맞는 방식으로 변경한 뒤 다시 실행하세요.</p>}
    <div className="result-toolbar"><button onClick={() => downloadResultCsv(result)}>CSV 다운로드</button><button onClick={() => downloadResultJson(result)}>JSON 다운로드</button><button onClick={() => downloadResultXlsx(result)}>XLSX 다운로드</button><input placeholder="키 검색" value={query} onChange={event => setQuery(event.target.value)} /><select value={status} onChange={event => setStatus(event.target.value)}><option value="all">전체 상태</option>{Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
    {result.diagnostics.length > 0 && <details><summary>진단 메시지 {result.diagnostics.length}건</summary><ul>{result.diagnostics.map((diagnostic, index) => <li key={index}>{diagnostic.message}</li>)}</ul></details>}
    <div className="result-table-wrap"><table><thead><tr><th>Lane 키</th><th>일치 여부</th><th>첫째/둘째 행 수</th><th>첫 번째 시트 비교값</th><th>두 번째 시트 비교값</th></tr></thead><tbody>{rows.map((row, index) => <tr key={index}><td>{row.key.map(value => String(decodeScalar(value))).join(' / ')}</td><td>{statusLabels[row.status] ?? row.displayStatus}</td><td>{row.aCount}/{row.bCount}</td><td>{comparisonValues(row, 'A')}</td><td>{comparisonValues(row, 'B')}</td></tr>)}</tbody></table></div>
  </section>;
}
