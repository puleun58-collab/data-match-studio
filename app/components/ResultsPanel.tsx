'use client';

import { useId, useMemo, useState } from 'react';
import type { ComparisonResult } from '../../web/src/engine/comparisonEngine';
import { decodeScalar } from '../../web/src/engine/serialization';
import { downloadResultCsv, downloadResultJson, downloadResultXlsx } from '../../web/src/export/download';
import { Button, Field, Heading, Section, StateMessage } from './ui';

const statusLabels: Record<string, string> = {
  matched: '일치',
  changed: '불일치',
  added: '두 번째 시트에만 존재',
  removed: '첫 번째 시트에만 존재',
  duplicate: '중복 키',
  'nm-pending': '양쪽 파일에 중복 키',
  'invalid-key': '빈 키',
  'conversion-failed': '형식 변환 실패',
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
  return [...new Set(values)].join(', ') || '-';
}

type Props = {
  result?: ComparisonResult;
  onRetry: () => void;
  isReady: boolean;
};

export default function ResultsPanel({ result, onRetry, isReady }: Props) {
  const [status, setStatus] = useState('all');
  const [query, setQuery] = useState('');
  const queryId = useId();
  const statusId = useId();
  const validRows = useMemo(() => result?.rows.filter(row => row.status !== 'invalid-key') ?? [], [result]);
  const blankRows = useMemo(() => result?.rows.filter(row => row.status === 'invalid-key') ?? [], [result]);
  const rows = useMemo(
    () => validRows.filter(row => (status === 'all' || row.status === status) && row.key.map(decodeScalar).join(' / ').toLowerCase().includes(query.toLowerCase())),
    [validRows, status, query],
  );

  if (!result) {
    return (
      <Section id="results" className="results-panel" tone="surface" aria-labelledby="results-title">
        <div className="section-heading">
          <Heading level={2} description="비교가 끝나면 요약, 필터, 상세 결과와 다운로드가 이곳에 표시됩니다." className="heading-group">
            <span id="results-title">비교 결과</span>
          </Heading>
        </div>
        <div className="result-empty">
          <strong>{isReady ? '비교할 준비가 되었습니다' : '아직 결과가 없습니다'}</strong>
          <span>{isReady ? '비교 설정에서 실행 버튼을 누르세요.' : '두 파일을 선택하고 비교 기준을 설정하세요.'}</span>
        </div>
      </Section>
    );
  }

  const duplicateBlocked = result.summary.comparable === 0 && (result.summary.duplicate > 0 || result.summary.nmPending > 0);
  const matched = validRows.filter(row => row.status === 'matched').length;
  const mismatched = validRows.filter(row => row.status === 'changed').length;
  const firstOnly = validRows.filter(row => row.status === 'removed').length;
  const secondOnly = validRows.filter(row => row.status === 'added').length;
  const firstBlank = blankRows.filter(row => row.aCount > 0).length;
  const secondBlank = blankRows.filter(row => row.bCount > 0).length;
  const matchRate = matched + mismatched ? matched / (matched + mismatched) * 100 : 0;
  const otherDiagnostics = result.diagnostics.filter(diagnostic => diagnostic.code !== 'INVALID_KEY');
  const hasErrorOnly = !result.rows.length && otherDiagnostics.length > 0;

  return (
    <Section id="results" className="results-panel" tone="surface" aria-labelledby="results-title">
      <div className="section-heading">
        <Heading level={2} description="유효 키를 기준으로 비교한 결과와 제외된 행을 확인하세요.">
          <span id="results-title">Lane 비교 결과</span>
        </Heading>
      </div>

      {hasErrorOnly ? (
        <StateMessage
          title="비교를 완료하지 못했습니다"
          tone="error"
          role="alert"
          action={<Button variant="danger" onClick={onRetry}>다시 실행</Button>}
        >
          {otherDiagnostics.map(diagnostic => diagnostic.message).join(' ')}
        </StateMessage>
      ) : null}

      {!hasErrorOnly ? (
        <>
          <div className="summary-layout" aria-label="비교 결과 요약">
            <div className="summary-primary">
              <div className="metric metric--accent"><span>일치율</span><strong>{matchRate.toFixed(2)}%</strong></div>
              <div className="metric"><span>일치</span><strong>{matched.toLocaleString('ko-KR')}</strong></div>
              <div className="metric"><span>불일치</span><strong>{mismatched.toLocaleString('ko-KR')}</strong></div>
            </div>
            <div className="summary-secondary">
              <div><span>유효 Lane</span><strong>{validRows.length.toLocaleString('ko-KR')}</strong></div>
              <div><span>빈 키 행</span><strong>{blankRows.length.toLocaleString('ko-KR')}</strong></div>
              <div><span>첫 시트에만</span><strong>{firstOnly.toLocaleString('ko-KR')}</strong></div>
              <div><span>두 번째 시트에만</span><strong>{secondOnly.toLocaleString('ko-KR')}</strong></div>
            </div>
          </div>

          {duplicateBlocked ? (
            <StateMessage title="중복 키 처리 방식이 필요합니다" tone="warning" role="alert" action={<Button onClick={() => document.querySelector('#comparison-setup')?.scrollIntoView()}>설정으로 이동</Button>}>
              값 비교가 실행되지 않았습니다. 비교 설정에서 중복 키 비교 방법을 선택한 뒤 다시 실행하세요.
            </StateMessage>
          ) : null}

          {validRows.length ? (
            <>
              <div className="result-toolbar" aria-label="결과 필터와 다운로드">
                <Field label="Lane 키 검색" htmlFor={queryId}>
                  <input id={queryId} type="search" placeholder="키 또는 조합 검색" value={query} onChange={event => setQuery(event.target.value)} />
                </Field>
                <Field label="상태" htmlFor={statusId}>
                  <select id={statusId} value={status} onChange={event => setStatus(event.target.value)}>
                    <option value="all">전체 상태</option>
                    {Object.entries(statusLabels).filter(([value]) => value !== 'invalid-key').map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                </Field>
                <div className="download-group" aria-label="결과 다운로드">
                  <Button onClick={() => downloadResultCsv(result)}>CSV</Button>
                  <Button onClick={() => downloadResultJson(result)}>JSON</Button>
                  <Button variant="primary" onClick={() => downloadResultXlsx(result)}>XLSX 다운로드</Button>
                </div>
              </div>

              {rows.length ? (
                <div className="result-table-wrap" tabIndex={0} aria-label="비교 결과 표, 가로로 스크롤할 수 있습니다">
                  <table>
                    <caption>현재 필터에 해당하는 {rows.length.toLocaleString('ko-KR')}개 Lane</caption>
                    <thead>
                      <tr>
                        <th scope="col">Lane 키</th>
                        <th scope="col">일치 여부</th>
                        <th scope="col">Lane별 데이터 건수</th>
                        <th scope="col">첫 번째 시트 비교값</th>
                        <th scope="col">두 번째 시트 비교값</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row, index) => (
                        <tr key={`${row.key.map(value => String(decodeScalar(value))).join('-')}-${index}`}>
                          <th scope="row">{row.key.map(value => String(decodeScalar(value))).join(' / ')}</th>
                          <td><span className={`status-badge status-badge--${row.status}`}>{statusLabels[row.status] ?? row.displayStatus}</span></td>
                          <td>첫 시트 {row.aCount.toLocaleString('ko-KR')}건 / 두 번째 시트 {row.bCount.toLocaleString('ko-KR')}건</td>
                          <td>{comparisonValues(row, 'A')}</td>
                          <td>{comparisonValues(row, 'B')}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="result-empty" role="status">
                  <strong>필터와 일치하는 결과가 없습니다</strong>
                  <span>검색어를 지우거나 상태 필터를 변경하세요.</span>
                </div>
              )}
            </>
          ) : (
            <div className="result-empty" role="status">
              <strong>비교 가능한 Lane이 없습니다</strong>
              <span>선택한 키 컬럼과 중복 처리 방식을 확인하세요.</span>
            </div>
          )}

          {blankRows.length > 0 ? (
            <details className="diagnostics">
              <summary>Lane 값이 없는 행 {blankRows.length}건 - 첫 번째 시트 {firstBlank}건 / 두 번째 시트 {secondBlank}건</summary>
              <p>키가 없어 Lane 비교와 일치율 계산에서는 제외했습니다.</p>
              <div className="result-table-wrap" tabIndex={0} aria-label="빈 키 행 표, 가로로 스크롤할 수 있습니다">
                <table>
                  <caption>Lane 키가 비어 비교에서 제외된 행</caption>
                  <thead><tr><th scope="col">시트</th><th scope="col">Excel 행</th><th scope="col">선택한 비교값</th><th scope="col">사유</th></tr></thead>
                  <tbody>
                    {blankRows.map((row, index) => {
                      const side = row.aCount ? 'A' : 'B';
                      const rowIndex = side === 'A' ? row.provenance.leftRow : row.provenance.rightRow;
                      return <tr key={index}><td>{side === 'A' ? '첫 번째 시트' : '두 번째 시트'}</td><td>{(rowIndex ?? 0) + 2}</td><td>{comparisonValues(row, side)}</td><td>선택한 Lane 키 컬럼이 비어 있음</td></tr>;
                    })}
                  </tbody>
                </table>
              </div>
            </details>
          ) : null}

          {otherDiagnostics.length > 0 ? (
            <details className="diagnostics">
              <summary>기타 진단 메시지 {otherDiagnostics.length}건</summary>
              <ul>{otherDiagnostics.map((diagnostic, index) => <li key={index}>{diagnostic.message}</li>)}</ul>
            </details>
          ) : null}
        </>
      ) : null}
    </Section>
  );
}
