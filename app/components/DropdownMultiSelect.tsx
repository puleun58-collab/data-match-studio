'use client';

import { useEffect, useId, useRef, useState } from 'react';

type Props = {
  id?: string;
  options: string[];
  value: string[];
  onChange: (value: string[]) => void;
  disabled?: boolean;
  placeholder?: string;
};

export default function DropdownMultiSelect({ id, options, value, onChange, disabled, placeholder = '선택 안 함' }: Props) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(event: PointerEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  function toggle(option: string) {
    onChange(value.includes(option) ? value.filter(item => item !== option) : [...value, option]);
  }

  const summary = value.length ? value.join(', ') : placeholder;

  return (
    <div className="dropdown-multiselect" ref={containerRef}>
      <button
        id={id}
        type="button"
        className="dropdown-multiselect__trigger"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen(previous => !previous)}
      >
        <span className="dropdown-multiselect__summary">{summary}</span>
        <span className="dropdown-multiselect__caret" aria-hidden="true">▾</span>
      </button>
      {open ? (
        <div className="dropdown-multiselect__panel" id={listId} role="listbox" aria-multiselectable="true">
          {options.length ? options.map(option => (
            <label className="dropdown-multiselect__option" key={option}>
              <input type="checkbox" checked={value.includes(option)} onChange={() => toggle(option)} />
              <span>{option}</span>
            </label>
          )) : <p className="dropdown-multiselect__empty">선택할 컬럼이 없습니다.</p>}
        </div>
      ) : null}
    </div>
  );
}
