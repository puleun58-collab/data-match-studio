'use client';

import { useId } from 'react';
import type { Table } from '../../web/src/engine/contracts';
import { Button, Field } from './ui';

export type UploadValue = {
  file: File;
  table?: Table;
  error?: string;
  sheets?: string[];
  sheetName?: string;
  status?: 'loading' | 'success' | 'error';
};

type Props = {
  side: 'left' | 'right';
  value?: UploadValue;
  onChange: (file?: File) => void;
  onSheetChange: (sheet: string) => void;
  onRetry: () => void;
};

export default function UploadPanel({ side, value, onChange, onSheetChange, onRetry }: Props) {
  const inputId = useId();
  const sheetId = useId();
  const isLeft = side === 'left';
  const title = isLeft ? '첫 번째 파일' : '두 번째 파일';
  const descriptionId = `${inputId}-description`;

  return (
    <article className="upload-panel" aria-labelledby={`${inputId}-title`}>
      <div className="upload-panel__topline">
        <h3 id={`${inputId}-title`}>{title}</h3>
        <span className="upload-panel__side">DATASET {isLeft ? 'A' : 'B'}</span>
      </div>

      <label className="upload-panel__dropzone" htmlFor={inputId}>
        <span>
          <strong>{value ? '다른 파일 선택' : '파일 선택'}</strong>
          <span id={descriptionId}>CSV, TSV, XLSX 형식</span>
        </span>
        <input
          className="visually-hidden"
          id={inputId}
          type="file"
          accept=".csv,.tsv,.xlsx,.xlsm,.xls"
          aria-describedby={descriptionId}
          onChange={event => onChange(event.target.files?.[0])}
        />
      </label>

      {value?.status === 'loading' ? (
        <p className="upload-panel__meta" role="status" aria-live="polite">
          {value.file.name}을 읽고 있습니다.
        </p>
      ) : null}

      {value?.table ? (
        <p className="upload-panel__meta" role="status" aria-live="polite">
          <strong>{value.file.name}</strong><br />
          {value.table.rows.length.toLocaleString('ko-KR')}개 행, {value.table.headers.length.toLocaleString('ko-KR')}개 컬럼
        </p>
      ) : null}

      {value?.sheets && value.sheets.length > 1 ? (
        <Field label="시트" htmlFor={sheetId} hint="비교할 시트를 선택하세요.">
          <select id={sheetId} value={value.sheetName ?? value.sheets[0]} onChange={event => onSheetChange(event.target.value)}>
            {value.sheets.map(sheet => <option key={sheet}>{sheet}</option>)}
          </select>
        </Field>
      ) : null}

      {value?.error ? (
        <div className="state-message state-message--error" role="alert">
          <div>
            <strong>파일을 열지 못했습니다</strong>
            <p>{value.error}</p>
          </div>
          <Button variant="danger" onClick={onRetry}>다시 시도</Button>
        </div>
      ) : null}
    </article>
  );
}
