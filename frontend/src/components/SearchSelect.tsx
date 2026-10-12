import { useEffect, useMemo, useRef, useState } from 'react';
import { fold } from '../format';

export interface SearchOption {
  value: string;
  label: string;
  /** Chữ phụ để tìm kiếm (ví dụ tên tiếng Anh, mã nước), không hiển thị. */
  keywords?: string;
}

/**
 * Ô chọn nhiều giá trị có gõ để lọc: bấm vào là mở danh sách, bấm từng dòng để tick/bỏ tick (danh sách vẫn mở).
 * Bàn phím: ↑↓ di chuyển, Enter tick/bỏ tick, Backspace khi ô trống bỏ giá trị cuối, Esc đóng.
 * Mảng rỗng = "Tất cả".
 */
export function SearchSelect({ value, options, onChange, allLabel, placeholder, width = 200 }: {
  value: string[];
  options: SearchOption[];
  onChange: (value: string[]) => void;
  allLabel: string;
  placeholder?: string;
  width?: number;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);

  const chosen = new Set(value);
  const labelOf = (v: string) => options.find((o) => o.value === v)?.label ?? v;

  const items = useMemo(() => {
    const q = fold(query.trim());
    if (!q) {
      // Không gõ gì: các giá trị đã chọn lên đầu để dễ bỏ chọn.
      return [...options].sort((a, b) => Number(chosen.has(b.value)) - Number(chosen.has(a.value)));
    }
    // Xếp hạng: trùng mã (gõ "us" → Hoa Kỳ) > tên bắt đầu bằng chữ vừa gõ > chỉ chứa chữ đó.
    const rank = (o: SearchOption) => {
      if (fold(o.value) === q) return 0;
      if (fold(o.label).startsWith(q) || fold(o.keywords ?? '').startsWith(q)) return 1;
      return 2;
    };
    return options
      .filter((o) => fold(`${o.label} ${o.value} ${o.keywords ?? ''}`).includes(q))
      .sort((a, b) => rank(a) - rank(b));
    // chosen chỉ ảnh hưởng thứ tự lúc mở, không sắp xếp lại khi đang tick để danh sách không nhảy.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options, query, open]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  useEffect(() => {
    list.current?.children[active]?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  function show() {
    setQuery('');
    setActive(0);
    setOpen(true);
  }

  function toggle(v: string) {
    onChange(chosen.has(v) ? value.filter((x) => x !== v) : [...value, v]);
    // Gõ để tìm rồi tick xong thì xoá chữ để tìm nước tiếp theo.
    if (query) {
      setQuery('');
      setActive(0);
    }
    input.current?.focus();
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'Enter') { e.preventDefault(); show(); }
      return;
    }
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => Math.min(i + 1, items.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); if (items[active]) toggle(items[active].value); }
    else if (e.key === 'Backspace' && !query && value.length) onChange(value.slice(0, -1));
    else if (e.key === 'Escape') { setOpen(false); input.current?.blur(); }
  }

  // Khi đóng: tóm tắt các giá trị đã chọn, ví dụ "Việt Nam (VN), Hoa Kỳ (US) +2".
  const summary = !value.length
    ? ''
    : value.length <= 2
      ? value.map(labelOf).join(', ')
      : `${value.slice(0, 2).map(labelOf).join(', ')} +${value.length - 2}`;

  return (
    <div className="ss" ref={root} style={{ width }}>
      <input
        ref={input}
        className={value.length ? 'ss-input has-value' : 'ss-input'}
        value={open ? query : summary}
        title={value.map(labelOf).join('\n')}
        placeholder={open ? (placeholder ?? 'Tìm…') : allLabel}
        onFocus={() => !open && show()}
        onClick={() => !open && show()}
        onChange={(e) => { setQuery(e.target.value); setActive(0); setOpen(true); }}
        onKeyDown={onKeyDown}
        role="combobox"
        aria-expanded={open}
        autoComplete="off"
      />
      {value.length > 0 && !open ? (
        <button type="button" className="ss-clear" aria-label="Bỏ chọn tất cả" onMouseDown={(e) => e.preventDefault()}
          onClick={() => onChange([])}>×</button>
      ) : (
        <span className="ss-caret" aria-hidden="true">▾</span>
      )}
      {open && (
        <div className="ss-pop">
          <div className="ss-head">
            <span>{value.length ? `Đã chọn ${value.length}` : allLabel}</span>
            {value.length > 0 && (
              <button type="button" className="link" onMouseDown={(e) => e.preventDefault()}
                onClick={() => onChange([])}>Bỏ chọn tất cả</button>
            )}
          </div>
          <ul className="ss-list" ref={list} role="listbox" aria-multiselectable="true">
            {items.map((o, i) => {
              const on = chosen.has(o.value);
              return (
                <li key={o.value} role="option" aria-selected={on}
                  className={[i === active ? 'active' : '', on ? 'selected' : ''].join(' ')}
                  onMouseEnter={() => setActive(i)}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => toggle(o.value)}>
                  <span className={on ? 'ss-check on' : 'ss-check'} aria-hidden="true">{on ? '✓' : ''}</span>
                  {o.label}
                </li>
              );
            })}
            {!items.length && <li className="ss-empty">Không tìm thấy “{query}”</li>}
          </ul>
        </div>
      )}
    </div>
  );
}
