'use client';

import { useId } from 'react';
import type { ComparisonRule, NullPolicy } from '../../web/src/engine/comparisonEngine';

type Props = {
  column: string;
  pairedColumn?: string;
  rule?: ComparisonRule;
  defaultPolicy: NullPolicy;
  onChange: (patch: Partial<ComparisonRule>) => void;
};

export default function RulePolicyEditor({ column, pairedColumn, rule, defaultPolicy, onChange }: Props) {
  const dataType = rule?.dataType ?? 'text';
  const policy = { ...defaultPolicy, ...(rule?.nullPolicy ?? {}) };
  const typeId = useId();
  const missingId = useId();
  const emptyTextId = useId();
  const updatePolicy = (patch: Partial<NullPolicy>) => onChange({ nullPolicy: { ...policy, ...patch } });

  return (
    <fieldset className="rule-policy-editor">
      <legend>비교 규칙: {column}{pairedColumn && pairedColumn !== column ? ` ↔ ${pairedColumn}` : ''}</legend>
      <div className="rule-policy-editor__body">
        <label htmlFor={typeId}>데이터 유형
          <select id={typeId} value={dataType} onChange={event => onChange({ dataType: event.target.value as ComparisonRule['dataType'] })}>
            <option value="text">문자</option>
            <option value="number">숫자·금액·수량</option>
            <option value="date">날짜·시간</option>
            <option value="boolean">참/거짓</option>
          </select>
        </label>
        <label><input type="checkbox" checked={policy.bothEmptyEqual !== false} onChange={event => updatePolicy({ bothEmptyEqual: event.target.checked })} /> 양쪽 모두 빈 값이면 동일</label>
        <label><input type="checkbox" checked={policy.oneEmptyMismatch !== false} onChange={event => updatePolicy({ oneEmptyMismatch: event.target.checked })} /> 한쪽만 빈 값이면 불일치</label>
        <label htmlFor={missingId}>빈 값으로 인식할 문자
          <input id={missingId} value={(policy.missingTokens ?? []).join(', ')} placeholder="-, N/A, NULL, 없음" onChange={event => updatePolicy({ missingTokens: event.target.value.split(',').map(token => token.trim().toLocaleLowerCase()).filter(Boolean) })} />
        </label>
        <details>
          <summary>고급 빈 값 설정</summary>
          {dataType === 'number' ? <label><input type="checkbox" checked={policy.emptyEqualsZero === true} onChange={event => updatePolicy({ emptyEqualsZero: event.target.checked })} /> 빈 값을 숫자 0으로 처리</label> : null}
          {dataType === 'text' ? <label htmlFor={emptyTextId}>빈 값을 특정 문자로 처리 <input id={emptyTextId} value={policy.emptyEqualsText ?? ''} onChange={event => updatePolicy({ emptyEqualsText: event.target.value || undefined })} /></label> : null}
          {dataType === 'boolean' ? <label><input type="checkbox" checked={policy.emptyEqualsFalse === true} onChange={event => updatePolicy({ emptyEqualsFalse: event.target.checked })} /> 빈 값을 거짓(False)으로 처리</label> : null}
          {dataType === 'date' ? <p>날짜 빈 값은 자동으로 임의 날짜로 변경하지 않습니다.</p> : null}
        </details>
      </div>
    </fieldset>
  );
}
