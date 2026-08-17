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
  const listId = useId();
  const statusId = useId();
  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return normalized ? options.filter(option => option.toLocaleLowerCase().includes(normalized)) : options;
  }, [options, query]);
  const selectedOrder = useMemo(
    () => new Map(value.map((column, index) => [column, index + 1])),
    [value],
  );

  function toggle(column: string) {
    if (selectedOrder.has(column)) {
      onChange(value.filter(selected => selected !== column));
      return;
    }
    onChange([...value, column]);
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
          aria-controls={listId}
          onChange={event => setQuery(event.target.value)}
        />
        <p className="column-selector__hint">컬럼을 선택한 순서대로 반대쪽 컬럼과 매칭됩니다.</p>
        <div
          id={listId}
          className="column-selector__list"
          role="listbox"
          aria-label={`${label} 목록`}
          aria-multiselectable="true"
          aria-describedby={statusId}
        >
          {filtered.length ? filtered.map(option => {
            const order = selectedOrder.get(option);
            return (
              <button
                type="button"
                role="option"
                aria-selected={Boolean(order)}
                className={order ? 'column-selector__option is-selected' : 'column-selector__option'}
                key={option}
                onClick={() => toggle(option)}
              >
                <span>{option}</span>
                {order ? <strong aria-label={`${order}번째 선택`}>{order}</strong> : null}
              </button>
            );
          }) : <p className="column-selector__empty">검색 결과가 없습니다.</p>}
        </div>
        <small id={statusId} aria-live="polite">
          선택 {value.length}개{query ? ` / 검색 결과 ${filtered.length}개` : ''}
        </small>
      </div>
      {value.length > 0 ? (
        <ol className="selected-columns" aria-label="선택한 컬럼 순서">
          {value.map((item, index) => (
            <li key={item}>
              <span className="selected-columns__order" aria-hidden="true">{index + 1}</span>
              <span className="selected-columns__name">{item}</span>
              <button
                type="button"
                title={`${item} 선택 해제`}
                aria-label={`${index + 1}번째 컬럼 ${item} 선택 해제`}
                onClick={() => toggle(item)}
              >
                ×
              </button>
            </li>
          ))}
        </ol>
      ) : null}
    </fieldset>
  );
}
