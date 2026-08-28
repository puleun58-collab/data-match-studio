'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { loadCsv } from '../../web/src/loaders/csvLoader';
import DropdownMultiSelect from './DropdownMultiSelect';
import { listXlsxSheets, loadXlsx } from '../../web/src/loaders/xlsxLoader';
import { buildMapping, groupsFromWideTable, mappingFromJson, mappingToJson, type MappingDictionary, type MappingGroup } from '../../web/src/mapping/keyMapping';
import type { Table } from '../../web/src/engine/contracts';
import { decodeScalar } from '../../web/src/engine/serialization';
import { Button, Field, StateMessage } from './ui';

export type KeyMappingUiState = {
  enabled: boolean;
  dictionary?: MappingDictionary;
  applyA: string[];
  applyB: string[];
};

type Props = {
  keysA: string[];
  keysB: string[];
  caseSensitive: boolean;
  value?: KeyMappingUiState;
  onChange: (state: KeyMappingUiState) => void;
};

export default function KeyMappingPanel({ keysA, keysB, caseSensitive, value, onChange }: Props) {
  const [enabled, setEnabled] = useState(value?.enabled ?? false);
  const [name, setName] = useState(value?.dictionary?.name ?? '기본 매핑');
  const [file, setFile] = useState<File>();
  const [table, setTable] = useState<Table>();
  const [sheets, setSheets] = useState<string[]>([]);
  const [sheet, setSheet] = useState('');
  const [headerRow, setHeaderRow] = useState(1);
  const [canonicalColumn, setCanonicalColumn] = useState('');
  const [aliasColumns, setAliasColumns] = useState<string[]>([]);
  const [allOtherColumns, setAllOtherColumns] = useState(true);
  const [manualGroups, setManualGroups] = useState<MappingGroup[]>(value?.dictionary?.groups ?? []);
  const [applyA, setApplyA] = useState<string[]>(value?.applyA ?? []);
  const [applyB, setApplyB] = useState<string[]>(value?.applyB ?? []);
  const [loadError, setLoadError] = useState('');
  const lastEmittedDictionary = useRef<MappingDictionary | undefined>(undefined);

  const fileGroups = useMemo(() => {
    if (!table || !canonicalColumn) return [];
    const aliases = allOtherColumns ? table.headers.filter(header => header !== canonicalColumn) : aliasColumns;
    if (!aliases.length) return [];
    try { return groupsFromWideTable(table, canonicalColumn, aliases); }
    catch { return []; }
  }, [table, canonicalColumn, aliasColumns, allOtherColumns]);
  const groups = useMemo(() => [...fileGroups, ...manualGroups], [fileGroups, manualGroups]);
  const dictionary = useMemo(() => buildMapping(groups, { trim: true, caseInsensitive: !caseSensitive }, name), [groups, caseSensitive, name]);
  const groupedPreview = useMemo(() => {
    const order: string[] = [];
    const aliasesByCanonical = new Map<string, string[]>();
    dictionary.preview.forEach(item => {
      if (item.kind !== 'alias') return;
      const existing = aliasesByCanonical.get(item.canonical);
      if (existing) { existing.push(item.originalAlias); return; }
      aliasesByCanonical.set(item.canonical, [item.originalAlias]);
      order.push(item.canonical);
    });
    return order.map(canonical => ({ canonical, aliases: aliasesByCanonical.get(canonical) ?? [] }));
  }, [dictionary.preview]);
  const ready = enabled && groups.length > 0 && dictionary.applicable && (applyA.length > 0 || applyB.length > 0);
  useEffect(() => {
    lastEmittedDictionary.current = groups.length ? dictionary : undefined;
    onChange({ enabled, dictionary: groups.length ? dictionary : undefined, applyA, applyB });
  }, [enabled, dictionary, groups.length, applyA, applyB, onChange]);

  useEffect(() => {
    if (!value?.dictionary || value.dictionary === lastEmittedDictionary.current) return;
    setEnabled(value.enabled);
    setName(value.dictionary.name);
    setManualGroups(value.dictionary.groups);
    setApplyA(value.applyA);
    setApplyB(value.applyB);
  }, [value]);

  useEffect(() => {
    setApplyA(previous => previous.filter(column => keysA.includes(column)));
    setApplyB(previous => previous.filter(column => keysB.includes(column)));
  }, [keysA, keysB]);

  async function parseFile(source: File, selectedSheet = sheet, selectedHeaderRow = headerRow) {
    setLoadError('');
    try {
      const lower = source.name.toLocaleLowerCase();
      if (lower.endsWith('.xlsx')) {
        const listed = await listXlsxSheets(source);
        if (!listed.ok) throw new Error(listed.diagnostics.map(item => item.message).join(' '));
        const targetSheet = selectedSheet && listed.sheets.includes(selectedSheet) ? selectedSheet : listed.sheets[0];
        setSheets(listed.sheets); setSheet(targetSheet);
        const parsed = await loadXlsx(source, { sheetName: targetSheet, headerOffset: selectedHeaderRow - 1 });
        if (!parsed.ok) throw new Error(parsed.diagnostics.map(item => item.message).join(' '));
        setTable(parsed.value);
      } else {
        setSheets([]); setSheet('');
        const parsed = loadCsv(new Uint8Array(await source.arrayBuffer()), { format: 'csv', headerOffset: selectedHeaderRow - 1 });
        if (!parsed.ok) throw new Error(parsed.diagnostics.map(item => item.message).join(' '));
        setTable(parsed.value);
      }
    } catch (error) {
      setTable(undefined);
      setLoadError(error instanceof Error ? error.message : String(error));
    }
  }

  async function chooseFile(source?: File) {
    if (!source) return;
    setFile(source); setHeaderRow(1); setCanonicalColumn(''); setAliasColumns([]);
    await parseFile(source, '', 1);
  }

  function updateManualGroup(index: number, patch: Partial<MappingGroup>) {
    setManualGroups(previous => previous.map((group, groupIndex) => groupIndex === index ? { ...group, ...patch } : group));
  }

  function downloadDictionary() {
    const blob = new Blob([mappingToJson(groups)], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob); link.download = 'key-mapping.json'; link.click(); URL.revokeObjectURL(link.href);
  }

  async function importJson(source?: File) {
    if (!source) return;
    try { setManualGroups(mappingFromJson(await source.text())); setLoadError(''); }
    catch (error) { setLoadError(error instanceof Error ? error.message : String(error)); }
  }

  return (
    <div className="setup-group key-mapping-panel">
      <div className="setup-group__title">
        <h3>키 이름 통합</h3>
        <p>서로 다른 이름을 하나의 표준 키로 통합한 뒤 비교합니다.</p>
      </div>
      <div className="key-mapping-panel__toggle">
        <label className="checkbox-label"><input type="checkbox" checked={enabled} onChange={event => setEnabled(event.target.checked)} /> 키 이름 통합 사용</label>
        {enabled ? <span className="key-mapping-panel__note">하나의 사전을 양쪽 파일에서 선택한 키 컬럼에 공통으로 적용합니다.</span> : null}
      </div>
      {enabled ? (
        <div className="key-mapping-panel__body">
          <div className="column-pair-grid">
            <Field label="매핑 이름" htmlFor="mapping-name"><input id="mapping-name" type="text" value={name} onChange={event => setName(event.target.value)} /></Field>
            <Field label="매핑 파일" htmlFor="mapping-file" hint="XLSX 또는 UTF-8 CSV"><input id="mapping-file" type="file" accept=".xlsx,.csv" onChange={event => chooseFile(event.target.files?.[0])} /></Field>
          </div>
          {sheets.length || file ? (
            <div className="column-pair-grid">
              {sheets.length ? <Field label="매핑 시트" htmlFor="mapping-sheet"><select id="mapping-sheet" value={sheet} onChange={event => { setSheet(event.target.value); if (file) void parseFile(file, event.target.value, headerRow); }}>{sheets.map(item => <option key={item}>{item}</option>)}</select></Field> : <div />}
              {file ? <Field label="헤더 행" htmlFor="mapping-header-row" hint="1부터 시작"><input id="mapping-header-row" type="number" min="1" value={headerRow} onChange={event => { const next = Math.max(1, Number(event.target.value) || 1); setHeaderRow(next); void parseFile(file, sheet, next); }} /></Field> : null}
            </div>
          ) : null}
          {table ? (
            <>
              <div className="column-pair-grid">
                <Field label="대표값 컬럼" htmlFor="mapping-canonical"><select id="mapping-canonical" value={canonicalColumn} onChange={event => { setCanonicalColumn(event.target.value); setAliasColumns([]); }}><option value="">선택하세요</option>{table.headers.map(header => <option key={header}>{header}</option>)}</select></Field>
                <Field label="별칭 컬럼" htmlFor="mapping-aliases">
                  <DropdownMultiSelect id="mapping-aliases" options={table.headers.filter(header => header !== canonicalColumn)} value={aliasColumns} onChange={setAliasColumns} disabled={allOtherColumns || !canonicalColumn} placeholder={allOtherColumns ? '전체 자동 선택됨' : '선택 안 함'} />
                </Field>
              </div>
              <label className="checkbox-label"><input type="checkbox" checked={allOtherColumns} onChange={event => setAllOtherColumns(event.target.checked)} /> 대표값 컬럼을 제외한 나머지 컬럼을 모두 별칭으로 사용</label>
              <details className="diagnostics"><summary>원본 매핑 표 미리보기 · {table.rows.length.toLocaleString('ko-KR')}행</summary><div className="result-table-wrap"><table><thead><tr>{table.headers.map(header => <th key={header}>{header}</th>)}</tr></thead><tbody>{table.rows.slice(0, 20).map((row, rowIndex) => <tr key={rowIndex}>{table.headers.map((header, columnIndex) => <td key={header}>{String(decodeScalar(row[columnIndex]))}</td>)}</tr>)}</tbody></table></div></details>
            </>
          ) : null}

          <div className="manual-mapping">
            <div className="manual-mapping__heading"><strong>직접 등록</strong><Button onClick={() => setManualGroups(previous => [...previous, { canonical: '', aliases: [] }])}>그룹 추가</Button></div>
            {manualGroups.map((group, index) => <div className="manual-mapping__row" key={index}><input type="text" aria-label={`대표값 ${index + 1}`} placeholder="대표값" value={group.canonical} onChange={event => updateManualGroup(index, { canonical: event.target.value })} /><input type="text" aria-label={`별칭 ${index + 1}`} placeholder="별칭을 쉼표로 구분" value={group.aliases.join(', ')} onChange={event => updateManualGroup(index, { aliases: event.target.value.split(',').map(value => value.trim()).filter(Boolean) })} /><Button variant="danger" onClick={() => setManualGroups(previous => previous.filter((_, groupIndex) => groupIndex !== index))}>삭제</Button></div>)}
          </div>

          <div className="mapping-json-actions"><Button onClick={downloadDictionary} disabled={!groups.length}>JSON 저장</Button><label className="button button--secondary" htmlFor="mapping-json-import">JSON 불러오기</label><input className="visually-hidden" id="mapping-json-import" type="file" accept="application/json" onChange={event => importJson(event.target.files?.[0])} /></div>
          <div className="column-pair-grid">
            <fieldset><legend>첫 번째 시트 적용 키</legend>{keysA.map(key => <label className="checkbox-label" key={key}><input type="checkbox" checked={applyA.includes(key)} onChange={event => setApplyA(previous => event.target.checked ? [...previous, key] : previous.filter(item => item !== key))} /> {key}</label>)}</fieldset>
            <fieldset><legend>두 번째 시트 적용 키</legend>{keysB.map(key => <label className="checkbox-label" key={key}><input type="checkbox" checked={applyB.includes(key)} onChange={event => setApplyB(previous => event.target.checked ? [...previous, key] : previous.filter(item => item !== key))} /> {key}</label>)}</fieldset>
          </div>

          {loadError ? <StateMessage title="매핑 파일을 읽지 못했습니다" tone="error" role="alert">{loadError}</StateMessage> : null}
          {dictionary.issues.filter(issue => issue.severity === 'error').map((issue, index) => <StateMessage key={`${issue.code}-${index}`} title="키 이름 통합 충돌" tone="error" role="alert">{issue.message}{issue.canonicals?.length ? ` 연결된 대표값: ${issue.canonicals.join(', ')}` : ''} 매핑 파일을 수정하거나 충돌을 해결한 뒤 비교를 다시 실행하세요.</StateMessage>)}
          {dictionary.issues.filter(issue => issue.severity === 'warning').length ? <details className="diagnostics"><summary>매핑 경고 {dictionary.issues.filter(issue => issue.severity === 'warning').length}건</summary><ul>{dictionary.issues.filter(issue => issue.severity === 'warning').map((issue, index) => <li key={`${issue.code}-${index}`}>{issue.message}</li>)}</ul></details> : null}
          <div className="mapping-metrics"><span>대표값 <strong>{dictionary.stats.canonicalCount}</strong></span><span>별칭 <strong>{dictionary.stats.aliasCount}</strong></span><span>전체 항목 <strong>{dictionary.stats.mappingItemCount}</strong></span><span>중복 별칭 <strong>{dictionary.stats.duplicateAliasCount}</strong></span><span>빈 셀 <strong>{dictionary.stats.emptyAliasCellCount}</strong></span><span>충돌 <strong>{dictionary.stats.collisionAliasCount}</strong></span><span>상태 <strong>{ready ? '적용 가능' : '설정 필요'}</strong></span></div>
          {groupedPreview.length ? <details className="diagnostics"><summary>별칭 → 표준 키 매핑 결과</summary><div className="result-table-wrap"><table><thead><tr><th>표준 키</th><th>별칭 개수</th><th>별칭 목록</th></tr></thead><tbody>{groupedPreview.map(group => <tr key={group.canonical}><td>{group.canonical}</td><td>{group.aliases.length}</td><td>{group.aliases.join(', ')}</td></tr>)}</tbody></table></div></details> : null}
        </div>
      ) : null}
    </div>
  );
}
