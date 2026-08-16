'use client';

import { useMemo, useRef, useState } from 'react';
import UploadPanel from './components/UploadPanel';
import ProgressPanel from './components/ProgressPanel';
import ResultsPanel from './components/ResultsPanel';
import { loadCsv } from '../web/src/loaders/csvLoader';
import { listXlsxSheets, loadXlsx } from '../web/src/loaders/xlsxLoader';
import type { Table } from '../web/src/engine/contracts';
import type { ComparisonConfig, ComparisonResult, ComparisonRule } from '../web/src/engine/comparisonEngine';
import type { WorkerResponse } from '../web/src/workers/workerProtocol';
import { remapConfig, type BrowserTemplateV2 } from '../web/src/templates/remap';

type BrowserFileState = { file: File; table?: Table; error?: string; sheets?: string[]; sheetName?: string };

export default function HomePage() {
  const [left, setLeft] = useState<BrowserFileState>();
  const [right, setRight] = useState<BrowserFileState>();
  const [keys, setKeys] = useState<string[]>([]); const [compare, setCompare] = useState<string[]>([]); const [rules, setRules] = useState<ComparisonRule[]>([]); const [representativeColumn, setRepresentativeColumn] = useState<string>();
  const [aggregationMethod, setAggregationMethod] = useState<ComparisonRule['aggregationMethod']>('sum');
  const [nullPolicy, setNullPolicy] = useState<NonNullable<ComparisonRule['nullPolicy']>>({ bothEmptyEqual: true, oneEmptyMismatch: true, emptyEqualsZero: false });
  const [caseSensitive, setCaseSensitive] = useState(true); const [policy, setPolicy] = useState('report');
  const [result, setResult] = useState<ComparisonResult>(); const [progress, setProgress] = useState<{ completed: number; total: number }>();
  const worker = useRef<Worker | null>(null); const request = useRef('');
  const headers = useMemo(() => left?.table && right?.table ? left.table.headers.filter(h => right.table!.headers.includes(h)) : (left?.table?.headers ?? right?.table?.headers ?? []), [left, right]);
  const emptyResult = (diagnostics: { code: string; message: string }[]): ComparisonResult => ({ rows: [], diagnostics, summary: { total: 0, comparable: 0, identical: 0, mismatch: 0, aOnly: 0, bOnly: 0, duplicate: 0, conversionFailed: 0, nmPending: 0, matchRate: 0 } });
  async function readFile(file: File, sheetName?: string) {
    try {
      const lower = file.name.toLowerCase();
      if (lower.endsWith('.xls')) return { file, error: 'Legacy .xls files are not supported in the browser. Use the local Python/Streamlit path or convert to XLSX.' };
      if (lower.endsWith('.xlsm')) return { file, error: 'Macro-enabled XLSM files are not supported in the browser. Use the local Python/Streamlit path with macro execution disabled.' };
      if (lower.endsWith('.xlsx')) {
        const sheetList = await listXlsxSheets(file);
        if (!sheetList.ok) return { file, error: sheetList.diagnostics.map(d => `${d.code}: ${d.message}`).join('\n') };
        const selectedSheet = sheetName ?? sheetList.sheets[0];
        const parsed = await loadXlsx(file, { sheetName: selectedSheet });
        if (!parsed.ok) return { file, sheets: sheetList.sheets, sheetName: selectedSheet, error: parsed.diagnostics.map(d => `${d.code}: ${d.message}`).join('\n') };
        return { file, sheets: sheetList.sheets, sheetName: selectedSheet, table: parsed.value };
      }
      const parsed = lower.endsWith('.xlsm') ? await loadXlsx(file) : loadCsv(new Uint8Array(await file.arrayBuffer()), { format: lower.endsWith('.tsv') ? 'tsv' : 'csv' });
      if (!parsed.ok) return { file, error: parsed.diagnostics.map(d => `${d.code}: ${d.message}`).join('\n') };
      return { file, table: parsed.value };
    } catch (e) { return { file, error: e instanceof Error ? e.message : String(e) }; }
  }
  async function choose(side: 'left' | 'right', file?: File) { if (!file) return; const value = await readFile(file); side === 'left' ? setLeft(value) : setRight(value); setResult(undefined); }
  async function chooseSheet(side: 'left' | 'right', sheetName: string) { const current = side === 'left' ? left : right; if (!current) return; const value = await readFile(current.file, sheetName); side === 'left' ? setLeft(value) : setRight(value); setResult(undefined); }
  function run() {
    if (!left?.table || !right?.table || !keys.length) return;
    const id = crypto.randomUUID(); request.current = id; worker.current?.terminate(); worker.current = new Worker(new URL('../web/src/workers/compare.worker.ts', import.meta.url));
    worker.current.onmessage = (event: MessageEvent<WorkerResponse>) => { const m = event.data; if (m.requestId !== id) return; if (m.type === 'progress') setProgress({ completed: m.completed, total: m.total }); else if (m.type === 'result') { setResult(m.result); setProgress(undefined); } else if (m.type === 'error') { setResult(emptyResult([{ code: m.code ?? 'COMPARE_FAILED', message: m.message }])); setProgress(undefined); } };
    setProgress({ completed: 0, total: left.table.rows.length + right.table.rows.length });
    const effectiveRules = rules.length ? rules : compare.map((column, index) => ({ id: `rule-${index + 1}`, columnA: column, columnB: column, aggregationMethod, nullPolicy }));
    const config: ComparisonConfig = { keyColumns: keys, compareColumns: compare.length ? compare : undefined, rules: effectiveRules, representativeColumn: representativeColumn ?? compare[0], caseSensitive, duplicatePolicy: policy as ComparisonConfig['duplicatePolicy'], nmPolicy: policy as ComparisonConfig['nmPolicy'] };
    worker.current.postMessage({ type: 'compare', requestId: id, left: left.table, right: right.table, config });
  }
  function cancel() { if (request.current) worker.current?.postMessage({ type: 'cancel', requestId: request.current }); worker.current?.terminate(); worker.current = null; request.current = ''; setProgress(undefined); }
  function template() { const occurrences = new Map<string, number>(); const expectations = headers.map((id, index) => { const normalizedName = id.trim().toLocaleLowerCase(); const occurrence = occurrences.get(normalizedName) ?? 0; occurrences.set(normalizedName, occurrence + 1); return { side: 'both' as const, index, id, raw: id, display: id, normalizedName, sheet: null, fingerprint: `${normalizedName}:${occurrence}`, occurrence }; }); const effectiveRules = rules.length ? rules : compare.map((column, index) => ({ id: `rule-${index + 1}`, columnA: column, columnB: column, dataType: 'text' as const, aggregationMethod, nullPolicy })); const value: BrowserTemplateV2 = { version: 2, expectations, keyColumns: keys, compareColumns: compare, rules: effectiveRules, representativeColumn, caseSensitive, duplicatePolicy: policy }; const blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'data-match-template-v2.json'; a.click(); URL.revokeObjectURL(a.href); }
  function importTemplate(file?: File) { if (!file) return; file.text().then(t => { try { const x = JSON.parse(t) as BrowserTemplateV2; const remapped = remapConfig(headers, x); if (remapped.diagnostics.length || !remapped.config) { setResult(emptyResult(remapped.diagnostics.map(d => ({ code: d.code, message: d.message })))); return; } setKeys(remapped.config.keyColumns.map(String)); setCompare(remapped.config.compareColumns.map(String)); setRules(remapped.config.rules); setAggregationMethod(remapped.config.rules[0]?.aggregationMethod ?? 'sum'); setNullPolicy(remapped.config.rules[0]?.nullPolicy ?? nullPolicy); setRepresentativeColumn(remapped.config.representativeColumn === undefined ? undefined : String(remapped.config.representativeColumn)); setCaseSensitive(remapped.config.caseSensitive); setPolicy(remapped.config.duplicatePolicy); } catch { setResult(emptyResult([{ code: 'INVALID_TEMPLATE', message: 'Template is not valid JSON.' }])); } }); }
  function editRulePolicy(column: string, patch: NonNullable<ComparisonRule['nullPolicy']>) { setRules(previous => { const base = previous.length ? previous : compare.map((name, index) => ({ id: `rule-${index + 1}`, columnA: name, columnB: name })); return base.map(rule => String(rule.columnA) === column ? { ...rule, nullPolicy: { ...((rule as ComparisonRule).nullPolicy ?? {}), ...patch } } : rule); }); }
  return <main><h1>Data Match Studio</h1><p>Compare files locally in your browser. File bytes never leave this page.</p>
    <UploadPanel side="left" value={left} onChange={f => choose('left', f)} onSheetChange={sheet => chooseSheet('left', sheet)} /><UploadPanel side="right" value={right} onChange={f => choose('right', f)} onSheetChange={sheet => chooseSheet('right', sheet)} />
    {headers.length > 0 && <section className="comparison-setup"><h2>3. 비교 설정 (Comparison setup)</h2><p>키 컬럼으로 같은 행을 찾고, 비교 컬럼의 값을 비교합니다. 여러 항목은 Ctrl 또는 Cmd를 누른 채 선택하세요.</p><label>1) 키 컬럼 — 행 식별용 <select size={6} multiple value={keys} onChange={e => setKeys(Array.from(e.target.selectedOptions, o => o.value))}>{headers.map(h => <option key={h}>{h}</option>)}</select></label><label>2) 비교 컬럼 — 값 비교 대상 <select size={6} multiple value={compare} onChange={e => setCompare(Array.from(e.target.selectedOptions, o => o.value))}>{headers.map(h => <option key={h}>{h}</option>)}</select></label><label>대표 행 기준 컬럼 <select value={representativeColumn ?? ''} onChange={e => setRepresentativeColumn(e.target.value || undefined)}><option value="">첫 번째 행 사용</option>{headers.map(h => <option key={h}>{h}</option>)}</select></label><label>중복 행 집계 방식 <select value={aggregationMethod} onChange={e => setAggregationMethod(e.target.value as ComparisonRule['aggregationMethod'])}><option value="sum">Sum</option><option value="mean">Mean</option><option value="min">Minimum</option><option value="max">Maximum</option><option value="count">Count</option><option value="nunique">Unique count</option><option value="concat_unique">Concatenate unique</option></select></label>{compare.map(column => { const rule = rules.find(item => String(item.columnA) === column); const policyForRule = rule?.nullPolicy ?? nullPolicy; return <fieldset key={`null-${column}`}><legend>빈 값 처리 규칙: {column}</legend><label><input type="checkbox" checked={policyForRule.bothEmptyEqual !== false} onChange={e => editRulePolicy(column, { bothEmptyEqual: e.target.checked })} /> 빈 값끼리 같음</label><label><input type="checkbox" checked={policyForRule.oneEmptyMismatch !== false} onChange={e => editRulePolicy(column, { oneEmptyMismatch: e.target.checked })} /> 한쪽만 빈 값이면 불일치</label><label><input type="checkbox" checked={policyForRule.emptyEqualsZero === true} onChange={e => editRulePolicy(column, { emptyEqualsZero: e.target.checked })} /> 빈 값을 0으로 처리</label><label>빈 값을 다음 문자로 처리 <input value={policyForRule.emptyEqualsText ?? ''} onChange={e => editRulePolicy(column, { emptyEqualsText: e.target.value || undefined })} /></label><label>빈 값으로 볼 문자 <input value={(policyForRule.missingTokens ?? []).join(', ')} onChange={e => editRulePolicy(column, { missingTokens: e.target.value.split(',').map(token => token.trim().toLocaleLowerCase()).filter(Boolean) })} /></label></fieldset>})}<label><input type="checkbox" checked={caseSensitive} onChange={e => setCaseSensitive(e.target.checked)} /> Case-sensitive keys</label><label>중복 키/N:M 처리 방식 <select value={policy} onChange={e => setPolicy(e.target.value)}><option value="report">진단만 표시 (N:M은 대기)</option><option value="first">첫 번째 행 사용</option><option value="last">마지막 행 사용</option><option value="representative">대표 행 사용</option><option value="set">집합으로 비교</option><option value="multiset">멀티셋으로 비교</option><option value="aggregate">집계값으로 비교</option></select></label><button onClick={run} disabled={!left?.table || !right?.table || !keys.length}>브라우저에서 비교 실행</button><button onClick={template}>설정 템플릿 저장</button><label>설정 템플릿 불러오기 <input type="file" accept="application/json" onChange={e => importTemplate(e.target.files?.[0])} /></label></section>}
    <ProgressPanel progress={progress} onCancel={cancel} /><ResultsPanel result={result} /></main>;
}
