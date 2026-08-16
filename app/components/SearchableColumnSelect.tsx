'use client';

import { useId, useMemo, useState } from 'react';

type Props = {
  label: string;
  options: string[];
  value: string[];
  onChange: (value: string[]) => void;
};

export default function SearchableColumnSelect({ label, options, value, onChange }: Props) {
  const [query, setQuery] = useState('');
  const searchId = useId();
  const selectId = useId();
  const statusId = useId();
  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return normalized ? options.filter(option => option.toLocaleLowerCase().includes(normalized)) : options;
  }, [options, query]);

  function updateVisible(selected: string[]) {
    const visible = new Set(filtered);
    const retained = value.filter(item => !visible.has(item));
    const combined = new Set([...retained, ...selected]);
    onChange(options.filter(option => combined.has(option)));
  }

  return (
    <fieldset className="column-selector">
      <legend>{label}</legend>
      <div className="column-selector__controls">
        <label className="visually-hidden" htmlFor={searchId}>{label} 검색</label>
        <input
          id={searchId}
          type="search"
          value={query}
          placeholder="컬럼명 검색"
          onChange={event => setQuery(event.target.value)}
        />
        <label className="visually-hidden" htmlFor={selectId}>{label} 선택</label>
        <select
          id={selectId}
          size={7}
          multiple
          value={value}
          aria-describedby={statusId}
          onChange={event => updateVisible(Array.from(event.target.selectedOptions, option => option.value))}
        >
          {filtered.length ? filtered.map(option => <option key={option}>{option}</option>) : <option disabled>검색 결과가 없습니다</option>}
        </select>
        <small id={statusId} aria-live="polite">
          선택 {value.length}개{query ? ` / 검색 결과 ${filtered.length}개` : ''}
        </small>
      </div>
      {value.length > 0 ? (
        <div className="selected-columns" aria-label="선택한 컬럼">
          {value.map(item => (
            <button
              type="button"
              key={item}
              title={`${item} 선택 해제`}
              onClick={() => onChange(value.filter(selected => selected !== item))}
            >
              {item} ×
            </button>
          ))}
        </div>
      ) : null}
    </fieldset>
  );
}
