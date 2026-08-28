'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import ProgressPanel from './components/ProgressPanel';
import ResultsPanel from './components/ResultsPanel';
import KeyMappingPanel, { type KeyMappingUiState } from './components/KeyMappingPanel';
import RulePolicyEditor from './components/RulePolicyEditor';
import SearchableColumnSelect from './components/SearchableColumnSelect';
import UploadPanel, { type UploadValue } from './components/UploadPanel';
import { Button, Container, Field, Form, Heading, Section, StateMessage } from './components/ui';
import { loadCsv } from '../web/src/loaders/csvLoader';
import { listXlsxSheets, loadXlsx } from '../web/src/loaders/xlsxLoader';
import type { ComparisonConfig, ComparisonResult, ComparisonRule } from '../web/src/engine/comparisonEngine';
import type { WorkerResponse } from '../web/src/workers/workerProtocol';
import { remapConfig, type BrowserTemplateV2 } from '../web/src/templates/remap';
import { buildMapping } from '../web/src/mapping/keyMapping';

type TemplateMessage = { tone: 'success' | 'error'; text: string };

const duplicatePolicyHelp: Record<string, { title: string; description: string }> = {
  report: {
    title: '중복 여부만 표시',
    description: '같은 키가 여러 행에 있으면 중복으로 표시하고 해당 키의 값은 비교하지 않습니다.',
  },
  first: {
    title: '같은 키의 첫 번째 행 기준',
    description: '각 파일에서 같은 키로 묶인 행 중 첫 번째 행만 비교하고 나머지 행은 제외합니다.',
  },
  last: {
    title: '같은 키의 마지막 행 기준',
    description: '각 파일에서 같은 키로 묶인 행 중 마지막 행만 비교하고 나머지 행은 제외합니다.',
  },
  representative: {
    title: '대표 행 기준',
    description: '선택한 기준 컬럼의 값이 가장 큰 행 한 건을 각 파일에서 골라 비교합니다.',
  },
  set: {
    title: '고유값 기준',
    description: '값의 순서와 반복 횟수는 무시하고, 서로 다른 값의 종류가 같은지 비교합니다.',
  },
  multiset: {
    title: '전체값 기준',
    description: '값의 순서는 무시하지만 같은 값이 몇 번 나타나는지까지 포함해 비교합니다.',
  },
  aggregate: {
    title: '집계값 기준',
    description: '같은 키의 모든 값을 합계, 평균, 개수 등으로 계산한 뒤 집계 결과를 비교합니다.',
  },
};

const emptyResult = (diagnostics: { code: string; message: string }[]): ComparisonResult => ({
  rows: [],
  diagnostics,
  summary: {
    total: 0,
    comparable: 0,
    identical: 0,
    mismatch: 0,
    aOnly: 0,
    bOnly: 0,
    duplicate: 0,
    conversionFailed: 0,
    nmPending: 0,
    matchRate: 0,
  },
});

export default function HomePage() {
  const [left, setLeft] = useState<UploadValue>();
  const [right, setRight] = useState<UploadValue>();
  const [keys, setKeys] = useState<string[]>([]);
  const [keysB, setKeysB] = useState<string[]>([]);
  const [compare, setCompare] = useState<string[]>([]);
  const [compareB, setCompareB] = useState<string[]>([]);
  const [rules, setRules] = useState<ComparisonRule[]>([]);
  const [representativeColumn, setRepresentativeColumn] = useState<string>();
  const [aggregationMethod, setAggregationMethod] = useState<ComparisonRule['aggregationMethod']>('sum');
  const [nullPolicy, setNullPolicy] = useState<NonNullable<ComparisonRule['nullPolicy']>>({ bothEmptyEqual: true, oneEmptyMismatch: true, emptyEqualsZero: false });
  const [caseSensitive, setCaseSensitive] = useState(true);
  const [policy, setPolicy] = useState('set');
  const [keyMapping, setKeyMapping] = useState<KeyMappingUiState>({ enabled: false, applyA: [], applyB: [] });
  const [result, setResult] = useState<ComparisonResult>();
  const [resultRules, setResultRules] = useState<ComparisonRule[]>([]);
  const [progress, setProgress] = useState<{ completed: number; total: number }>();
  const [templateMessage, setTemplateMessage] = useState<TemplateMessage>();
  const worker = useRef<Worker | null>(null);
  const request = useRef('');

  const leftHeaders = useMemo(() => left?.table?.headers ?? [], [left]);
  const rightHeaders = useMemo(() => right?.table?.headers ?? [], [right]);
  const headers = useMemo(() => [...new Set([...leftHeaders, ...rightHeaders])], [leftHeaders, rightHeaders]);
  const selectionsMatch = keys.length === keysB.length && compare.length === compareB.length;
  const mappingReady = !keyMapping.enabled || Boolean(keyMapping.dictionary?.applicable && keyMapping.dictionary.groups.length && (keyMapping.applyA.length || keyMapping.applyB.length));
  const canRun = Boolean(left?.table && right?.table && keys.length && selectionsMatch && mappingReady && !progress);

  useEffect(() => () => worker.current?.terminate(), []);

  async function readFile(file: File, sheetName?: string): Promise<UploadValue> {
    try {
      const lower = file.name.toLowerCase();
      if (lower.endsWith('.xls')) return { file, status: 'error', error: 'Legacy .xls files are not supported in the browser. Use the local Python/Streamlit path or convert to XLSX.' };
      if (lower.endsWith('.xlsm')) return { file, status: 'error', error: 'Macro-enabled XLSM files are not supported in the browser. Use the local Python/Streamlit path with macro execution disabled.' };
      if (lower.endsWith('.xlsx')) {
        const sheetList = await listXlsxSheets(file);
        if (!sheetList.ok) return { file, status: 'error', error: sheetList.diagnostics.map(diagnostic => `${diagnostic.code}: ${diagnostic.message}`).join('\n') };
        const selectedSheet = sheetName ?? sheetList.sheets[0];
        const parsed = await loadXlsx(file, { sheetName: selectedSheet });
        if (!parsed.ok) return { file, status: 'error', sheets: sheetList.sheets, sheetName: selectedSheet, error: parsed.diagnostics.map(diagnostic => `${diagnostic.code}: ${diagnostic.message}`).join('\n') };
        return { file, status: 'success', sheets: sheetList.sheets, sheetName: selectedSheet, table: parsed.value };
      }
      const parsed = loadCsv(new Uint8Array(await file.arrayBuffer()), { format: lower.endsWith('.tsv') ? 'tsv' : 'csv' });
      if (!parsed.ok) return { file, status: 'error', error: parsed.diagnostics.map(diagnostic => `${diagnostic.code}: ${diagnostic.message}`).join('\n') };
      return { file, status: 'success', table: parsed.value };
    } catch (error) {
      return { file, status: 'error', error: error instanceof Error ? error.message : String(error) };
    }
  }

  function clearSideSelection(side: 'left' | 'right') {
    if (side === 'left') {
      setKeys([]);
      setCompare([]);
    } else {
      setKeysB([]);
      setCompareB([]);
    }
    setRules([]);
    setResult(undefined);
    setResultRules([]);
    setTemplateMessage(undefined);
  }

  async function choose(side: 'left' | 'right', file?: File) {
    if (!file) return;
    const loadingValue: UploadValue = { file, status: 'loading' };
    if (side === 'left') setLeft(loadingValue);
    else setRight(loadingValue);
    clearSideSelection(side);
    const value = await readFile(file);
    if (side === 'left') setLeft(value);
    else setRight(value);
  }

  async function chooseSheet(side: 'left' | 'right', sheetName: string) {
    const current = side === 'left' ? left : right;
    if (!current) return;
    const loadingValue: UploadValue = { ...current, table: undefined, error: undefined, sheetName, status: 'loading' };
    if (side === 'left') setLeft(loadingValue);
    else setRight(loadingValue);
    clearSideSelection(side);
    const value = await readFile(current.file, sheetName);
    if (side === 'left') setLeft(value);
    else setRight(value);
  }

  function run() {
    if (!left?.table || !right?.table || !keys.length || !selectionsMatch || progress) return;
    const id = crypto.randomUUID();
    request.current = id;
    worker.current?.terminate();
    worker.current = new Worker(new URL('../web/src/workers/compare.worker.ts', import.meta.url));
    worker.current.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const message = event.data;
      if (message.requestId !== id) return;
      if (message.type === 'progress') setProgress({ completed: message.completed, total: message.total });
      else if (message.type === 'result') {
        setResult(message.result);
        setProgress(undefined);
      } else if (message.type === 'error') {
        setResult(emptyResult([{ code: message.code ?? 'COMPARE_FAILED', message: message.message }]));
        setProgress(undefined);
      }
    };
    worker.current.onerror = () => {
      setResult(emptyResult([{ code: 'WORKER_FAILED', message: '비교 작업을 시작하지 못했습니다. 다시 시도하세요.' }]));
      setProgress(undefined);
    };
    setResult(undefined);
    setProgress({ completed: 0, total: left.table.rows.length + right.table.rows.length });
    const effectiveRules = rules.length ? rules : compare.map((column, index) => ({ id: `rule-${index + 1}`, columnA: column, columnB: compareB[index], aggregationMethod, nullPolicy }));
    setResultRules(effectiveRules);
    const config: ComparisonConfig = {
      keyColumns: keys,
      keyColumnsB: keysB,
      compareColumns: compare.length ? compare : undefined,
      rules: effectiveRules,
      representativeColumn: representativeColumn ?? compare[0],
      caseSensitive,
      duplicatePolicy: policy as ComparisonConfig['duplicatePolicy'],
      nmPolicy: policy as ComparisonConfig['nmPolicy'],
      keyNormalization: keyMapping.enabled ? { trim: true, caseInsensitive: !caseSensitive } : undefined,
      keyMappings: keyMapping.enabled && keyMapping.dictionary ? {
        A: Object.fromEntries(keyMapping.applyA.map(column => [column, { enabled: true, dictionary: keyMapping.dictionary! }])),
        B: Object.fromEntries(keyMapping.applyB.map(column => [column, { enabled: true, dictionary: keyMapping.dictionary! }])),
      } : undefined,
    };
    worker.current.postMessage({ type: 'compare', requestId: id, left: left.table, right: right.table, config });
  }

  function cancel() {
    if (request.current) worker.current?.postMessage({ type: 'cancel', requestId: request.current });
    worker.current?.terminate();
    worker.current = null;
    request.current = '';
    setProgress(undefined);
  }

  function saveTemplate() {
    const occurrences = new Map<string, number>();
    const expectations = headers.map((id, index) => {
      const normalizedName = id.trim().toLocaleLowerCase();
      const occurrence = occurrences.get(normalizedName) ?? 0;
      occurrences.set(normalizedName, occurrence + 1);
      return { side: 'both' as const, index, id, raw: id, display: id, normalizedName, sheet: null, fingerprint: `${normalizedName}:${occurrence}`, occurrence };
    });
    const effectiveRules = rules.length ? rules : compare.map((column, index) => ({ id: `rule-${index + 1}`, columnA: column, columnB: compareB[index], dataType: 'text' as const, aggregationMethod, nullPolicy }));
    const value: BrowserTemplateV2 = {
      version: 2,
      expectations,
      keyColumns: keys,
      keyColumnsB: keysB,
      compareColumns: compare,
      rules: effectiveRules,
      representativeColumn,
      caseSensitive,
      duplicatePolicy: policy,
      keyMapping: keyMapping.dictionary ? {
        enabled: keyMapping.enabled,
        name: keyMapping.dictionary.name,
        groups: keyMapping.dictionary.groups,
        applyA: keyMapping.applyA,
        applyB: keyMapping.applyB,
      } : undefined,
    };
    const blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'data-match-template-v2.json';
    link.click();
    URL.revokeObjectURL(link.href);
    setTemplateMessage({ tone: 'success', text: '현재 비교 설정을 JSON 템플릿으로 저장했습니다.' });
  }

  async function importTemplate(file?: File) {
    if (!file) return;
    try {
      const value = JSON.parse(await file.text()) as BrowserTemplateV2;
      const remapped = remapConfig(headers, value);
      if (remapped.diagnostics.length || !remapped.config) {
        setResult(emptyResult(remapped.diagnostics.map(diagnostic => ({ code: diagnostic.code, message: diagnostic.message }))));
        setTemplateMessage({ tone: 'error', text: '템플릿 컬럼을 현재 파일에 연결하지 못했습니다.' });
        return;
      }
      setKeys(remapped.config.keyColumns.map(String));
      setKeysB((remapped.config.keyColumnsB ?? remapped.config.keyColumns).map(String));
      setCompare(remapped.config.compareColumns.map(String));
      setCompareB(remapped.config.rules.map(rule => String(rule.columnB)));
      setRules(remapped.config.rules);
      setAggregationMethod(remapped.config.rules[0]?.aggregationMethod ?? 'sum');
      setNullPolicy(remapped.config.rules[0]?.nullPolicy ?? nullPolicy);
      setRepresentativeColumn(remapped.config.representativeColumn === undefined ? undefined : String(remapped.config.representativeColumn));
      setCaseSensitive(remapped.config.caseSensitive);
      setPolicy(remapped.config.duplicatePolicy);
      if (remapped.config.keyMapping) {
        const importedMapping = remapped.config.keyMapping;
        setKeyMapping({
          enabled: importedMapping.enabled,
          dictionary: buildMapping(importedMapping.groups, { trim: true, caseInsensitive: !remapped.config.caseSensitive }, importedMapping.name),
          applyA: importedMapping.applyA.map(String),
          applyB: importedMapping.applyB.map(String),
        });
      } else {
        setKeyMapping({ enabled: false, applyA: [], applyB: [] });
      }
      setTemplateMessage({ tone: 'success', text: '템플릿 설정을 현재 파일에 적용했습니다.' });
    } catch {
      setResult(emptyResult([{ code: 'INVALID_TEMPLATE', message: 'Template is not valid JSON.' }]));
      setTemplateMessage({ tone: 'error', text: '올바른 JSON 템플릿 파일을 선택하세요.' });
    }
  }

  function editRule(column: string, patch: Partial<ComparisonRule>) {
    setRules(previous => {
      const base = previous.length ? previous : compare.map((name, index) => ({ id: `rule-${index + 1}`, columnA: name, columnB: compareB[index] ?? name }));
      return base.map(rule => String(rule.columnA) === column ? { ...rule, ...patch } : rule);
    });
  }

  const disabledReason = !left?.table || !right?.table
    ? '두 파일을 모두 선택하면 비교를 실행할 수 있습니다.'
    : !keys.length
      ? '각 파일에서 키 컬럼을 하나 이상 선택하세요.'
      : !selectionsMatch
        ? `양쪽 선택 개수를 맞추세요. 키 ${keys.length}:${keysB.length}, 비교 ${compare.length}:${compareB.length}`
        : !mappingReady
          ? '키 매핑 충돌을 해결하고 적용할 키 컬럼을 선택하세요.'
          : progress
            ? '현재 비교가 진행 중입니다.'
            : '';

  return (
    <>
      <header className="site-header">
        <Container className="site-header__inner">
          <a className="brand" href="#top" aria-label="Data Match Studio 홈">
            <span className="brand__mark" aria-hidden="true">
              <svg viewBox="0 0 24 24" focusable="false">
                <path d="M4 5.5h5M15 5.5h5M4 12h5M15 12h5M4 18.5h5" />
                <path className="brand__connector" d="M10.5 5.5h3M10.5 12h3" />
                <circle cx="17.5" cy="18.5" r="2.25" />
              </svg>
            </span>
            <span>Data Match Studio</span>
          </a>
          <nav className="primary-nav" aria-label="작업 단계">
            <a href="#upload">파일 선택</a>
            <a href="#comparison-setup">비교 설정</a>
            <a href="#results">결과</a>
          </nav>
        </Container>
      </header>

      <main id="main-content">
        <Container>
          <div className="masthead" id="top">
            <div className="masthead__copy">
              <p className="masthead__eyebrow">LOCAL DATA COMPARISON</p>
              <h1>
                <span className="headline-line">원본은 그대로.</span>
                <span className="headline-line">
                  <span>차이만</span>{' '}
                  <span>선명하게.</span>
                </span>
              </h1>
              <p>키 컬럼을 기준으로 Excel, CSV, TSV 데이터를 비교하고 달라진 항목을 원하는 형식으로 저장하세요.</p>
              <div className="hero-actions">
                <a className="button button--primary hero-cta" href="#upload">
                  <span>파일 선택 시작</span>
                  <span className="button__trailing" aria-hidden="true">↓</span>
                </a>
              </div>
            </div>
            <aside className="privacy-note" aria-label="로컬 처리 안내">
              <span className="privacy-note__label">PROCESSING BOUNDARY</span>
              <strong>파일은 이 화면 안에 머뭅니다.</strong>
              <span className="privacy-note__copy">데이터는 서버로 전송되거나 저장되지 않습니다.</span>
              <dl className="privacy-note__facts">
                <div><dt>Server upload</dt><dd>없음</dd></div>
                <div><dt>File support</dt><dd>XLSX / CSV / TSV</dd></div>
              </dl>
            </aside>
          </div>

          <div className="workflow">
            <Section id="upload" tone="muted" aria-labelledby="upload-title">
              <div className="section-heading">
                <Heading level={2} description="비교할 두 파일을 선택하세요. 서로 다른 파일 형식을 함께 사용할 수 있습니다.">
                  <span id="upload-title">파일 선택</span>
                </Heading>
              </div>
              <div className="upload-grid">
                <UploadPanel side="left" value={left} onChange={file => choose('left', file)} onSheetChange={sheet => chooseSheet('left', sheet)} onRetry={() => left && choose('left', left.file)} />
                <UploadPanel side="right" value={right} onChange={file => choose('right', file)} onSheetChange={sheet => chooseSheet('right', sheet)} onRetry={() => right && choose('right', right.file)} />
              </div>
            </Section>

            {headers.length > 0 ? (
              <Section id="comparison-setup" className="comparison-setup" tone="surface" aria-labelledby="setup-title">
                <div className="section-heading">
                  <Heading level={2} description="서로 대응하는 키와 비교 컬럼을 같은 개수, 같은 순서로 선택하세요.">
                    <span id="setup-title">비교 설정</span>
                  </Heading>
                </div>

                <Form onSubmit={event => { event.preventDefault(); run(); }}>
                  {!selectionsMatch ? (
                    <StateMessage title="선택 개수를 맞춰주세요" tone="warning" role="alert">
                      현재 키 {keys.length}:{keysB.length}, 비교 {compare.length}:{compareB.length}입니다.
                    </StateMessage>
                  ) : null}

                  <div className="setup-group">
                    <div className="setup-group__title"><h3>키 컬럼</h3><p>각 행을 연결할 기준입니다. 복합 키는 같은 순서로 선택하세요.</p></div>
                    <div className="column-pair-grid">
                      <SearchableColumnSelect label="첫 번째 시트 키 컬럼" options={leftHeaders} value={keys} onChange={setKeys} />
                      <SearchableColumnSelect label="두 번째 시트 키 컬럼" options={rightHeaders} value={keysB} onChange={setKeysB} />
                    </div>
                  </div>
                  <KeyMappingPanel keysA={keys} keysB={keysB} caseSensitive={caseSensitive} value={keyMapping} onChange={setKeyMapping} />

                  <div className="setup-group">
                    <div className="setup-group__title"><h3>비교 컬럼</h3><p>값의 일치 여부를 확인할 컬럼입니다. 선택하지 않으면 키와 존재 여부만 비교합니다.</p></div>
                    <div className="column-pair-grid">
                      <SearchableColumnSelect label="첫 번째 시트 비교 컬럼" options={leftHeaders} value={compare} onChange={value => { setCompare(value); setRules([]); }} />
                      <SearchableColumnSelect label="두 번째 시트 비교 컬럼" options={rightHeaders} value={compareB} onChange={value => { setCompareB(value); setRules([]); }} />
                    </div>
                    {compare.length > 0 ? (
                      <div className="rule-grid">
                        {compare.map((column, index) => {
                          const rule = rules.find(item => String(item.columnA) === column);
                          return <RulePolicyEditor key={`rule-${column}`} column={column} pairedColumn={compareB[index]} rule={rule} defaultPolicy={nullPolicy} onChange={patch => editRule(column, patch)} />;
                        })}
                      </div>
                    ) : null}
                  </div>

                  <div className="setup-group">
                    <div className="setup-group__title"><h3>중복 키 처리</h3><p>같은 키가 여러 행에 있을 때 값을 비교하는 기준을 선택하세요.</p></div>
                    <div className="setup-options">
                      <label className="checkbox-label" title="켜면 S001과 s001을 다른 키로 처리합니다."><input type="checkbox" checked={caseSensitive} onChange={event => setCaseSensitive(event.target.checked)} /> 키의 영문 대소문자 구분</label>
                      <div className="duplicate-policy-control">
                        <Field label="중복 키 비교 기준" htmlFor="duplicate-policy" hint="같은 키가 한쪽 또는 양쪽 파일에 여러 번 나타날 때 적용됩니다.">
                          <select id="duplicate-policy" value={policy} aria-describedby="duplicate-policy-description" onChange={event => { setPolicy(event.target.value); setResult(undefined); }}>
                            <option value="report">중복만 확인</option>
                            <option value="set">고유값 기준 (중복 횟수 제외)</option>
                            <option value="multiset">전체값 기준 (중복 횟수 포함)</option>
                            <option value="aggregate">집계값 기준</option>
                            {policy === 'representative' ? <option value="representative">대표 행 기준 (고급 설정)</option> : null}
                            {policy === 'first' ? <option value="first">이전 설정: 같은 키의 첫 번째 행 기준</option> : null}
                            {policy === 'last' ? <option value="last">이전 설정: 같은 키의 마지막 행 기준</option> : null}
                          </select>
                          <p className="policy-description" id="duplicate-policy-description">
                            <strong>{duplicatePolicyHelp[policy].title}</strong>
                            <span>{duplicatePolicyHelp[policy].description}</span>
                          </p>
                        </Field>
                        {policy === 'aggregate' ? (
                          <Field label="중복 행 집계 방식" htmlFor="aggregation-method">
                            <select id="aggregation-method" value={aggregationMethod} onChange={event => setAggregationMethod(event.target.value as ComparisonRule['aggregationMethod'])}>
                              <option value="sum">합계</option><option value="mean">평균</option><option value="min">최솟값</option><option value="max">최댓값</option><option value="count">값이 있는 행 수</option><option value="nunique">서로 다른 값의 수</option><option value="concat_unique">서로 다른 값 이어 붙이기</option>
                            </select>
                          </Field>
                        ) : null}
                        <details className="duplicate-advanced" open={policy === 'representative'}>
                          <summary>고급 설정</summary>
                          <div className="duplicate-advanced__body">
                            <label className="advanced-option">
                              <input type="radio" name="duplicate-policy-advanced" checked={policy === 'representative'} onChange={() => { setPolicy('representative'); setResult(undefined); }} />
                              <span><strong>대표 행 기준</strong><small>선택한 컬럼의 값이 가장 큰 행 하나를 각 파일에서 골라 비교합니다.</small></span>
                            </label>
                            {policy === 'representative' ? (
                              <Field label="대표 행을 고를 기준 컬럼" htmlFor="representative-column">
                                <select id="representative-column" value={representativeColumn ?? ''} onChange={event => setRepresentativeColumn(event.target.value || undefined)}>
                                  <option value="">첫 번째 비교 컬럼 사용</option>
                                  {leftHeaders.map(header => <option key={header}>{header}</option>)}
                                </select>
                              </Field>
                            ) : null}
                          </div>
                        </details>
                      </div>
                    </div>
                  </div>

                  <div className="form-actions">
                    <Button type="submit" variant="primary" disabled={!canRun}>브라우저에서 비교 실행</Button>
                    <Button onClick={saveTemplate}>설정 템플릿 저장</Button>
                    <label className="button button--secondary" htmlFor="template-upload">설정 템플릿 불러오기</label>
                    <input className="visually-hidden" id="template-upload" type="file" accept="application/json" onChange={event => importTemplate(event.target.files?.[0])} />
                    {disabledReason ? <p className="disabled-reason">{disabledReason}</p> : null}
                  </div>
                  {templateMessage ? (
                    <div aria-live="polite">
                      <StateMessage title={templateMessage.tone === 'success' ? '템플릿 처리 완료' : '템플릿 처리 오류'} tone={templateMessage.tone} role={templateMessage.tone === 'error' ? 'alert' : 'status'}>
                        {templateMessage.text}
                      </StateMessage>
                    </div>
                  ) : null}
                </Form>
              </Section>
            ) : (
              <Section id="comparison-setup" className="comparison-setup" tone="surface" aria-labelledby="setup-title">
                <div className="section-heading">
                  <Heading level={2} description="두 파일을 선택하면 키와 비교 컬럼 설정이 이곳에 표시됩니다."><span id="setup-title">비교 설정</span></Heading>
                </div>
                <StateMessage title="파일을 기다리고 있습니다">첫 번째 파일과 두 번째 파일을 모두 선택하세요.</StateMessage>
              </Section>
            )}

            <ProgressPanel progress={progress} onCancel={cancel} />
            {!progress ? <ResultsPanel result={result} rules={resultRules} onRetry={run} isReady={canRun} duplicatePolicy={policy} aggregationMethod={aggregationMethod} /> : null}
          </div>

          <footer className="site-footer">
            <div>
              <span className="site-footer__brand">Data Match Studio</span>
              <p>정확한 비교를 위한 로컬 데이터 도구</p>
            </div>
            <div className="site-footer__meta">
              <span>파일은 브라우저 안에서만 처리됩니다.</span>
              <a href="#upload">새 비교 시작</a>
            </div>
          </footer>
        </Container>
      </main>
    </>
  );
}
