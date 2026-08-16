'use client';

import { useMemo, useState } from 'react';

type Props = {
  label: string;
  options: string[];
  value: string[];
  onChange: (value: string[]) => void;
};

export default function SearchableColumnSelect({ label, options, value, onChange }: Props) {
  const [query, setQuery] = useState('');
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

  return <fieldset className="column-selector">
    <legend>{label}</legend>
    <input type="search" value={query} placeholder="컬럼명 검색" onChange={event => setQuery(event.target.value)} />
    <select size={7} multiple value={value} onChange={event => updateVisible(Array.from(event.target.selectedOptions, option => option.value))}>{filtered.map(option => <option key={option}>{option}</option>)}</select>
    <small>선택 {value.length}개{query && ` · 검색 결과 ${filtered.length}개`}</small>
    {value.length > 0 && <div className="selected-columns">{value.map(item => <button type="button" key={item} title={`${item} 선택 해제`} onClick={() => onChange(value.filter(selected => selected !== item))}>{item} ×</button>)}</div>}
  </fieldset>;
}
