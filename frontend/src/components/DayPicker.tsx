import { useEffect, useRef, useState } from 'react';

/**
 * Chọn các mốc DN hiển thị thành cột (D0…D30 từng ngày, thêm các mốc extra). Chọn trong bảng nháp, chỉ áp dụng khi
 * bấm "Áp dụng" để bảng không tải lại sau mỗi lần bấm. Dùng ở Retention và bảng ROAS.
 */
export function DayPicker({ value, max, defaults, extra = [], label = 'Cột', align = 'right', onChange }: {
  value: number[];
  max: number;
  /** Mốc của nút "Mặc định". */
  defaults: number[];
  extra?: number[];
  label?: string;
  /** Phía popup bám vào: right (mặc định, ô ở cuối hàng) hoặc left (ô ở đầu hàng). */
  align?: 'left' | 'right';
  onChange: (days: number[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<number[]>(value);
  const ref = useRef<HTMLDivElement>(null);
  // Mở lại thì bắt đầu từ lựa chọn đang áp dụng; đóng mà không bấm Áp dụng thì bỏ lựa chọn nháp.
  useEffect(() => {
    if (open) setDraft(value);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  const options = [...Array.from({ length: 31 }, (_, i) => i), ...extra].filter((n) => n <= max);
  const toggle = (n: number) => setDraft((d) => (d.includes(n) ? d.filter((x) => x !== n) : [...d, n].sort((a, b) => a - b)));
  const same = draft.length === value.length && draft.every((n, i) => n === value[i]);
  const apply = () => {
    if (!same && draft.length) onChange(draft);
    setOpen(false);
  };
  return (
    <div className={`day-picker ${align === 'left' ? 'left' : ''}`} ref={ref}>
      <button type="button" onClick={() => setOpen(!open)}>{label}: {value.map((n) => `D${n}`).join(' · ') || '—'} ▾</button>
      {open && (
        <div className="day-picker-pop">
          <div className="day-picker-head">
            <span className="small muted">Chọn ngày hiển thị ({draft.length})</span>
            <span>
              <button type="button" className="link" onClick={() => setDraft(defaults)}>Mặc định</button>
              {' · '}
              <button type="button" className="link" onClick={() => setDraft([])}>Bỏ chọn</button>
            </span>
          </div>
          <div className="day-grid">
            {options.map((n) => (
              <button key={n} type="button" className={draft.includes(n) ? 'chip active' : 'chip'} onClick={() => toggle(n)}>
                D{n}
              </button>
            ))}
          </div>
          <div className="day-picker-foot">
            <button type="button" onClick={() => setOpen(false)}>Huỷ</button>
            <button type="button" className="primary" disabled={!draft.length} onClick={apply}>Áp dụng</button>
          </div>
        </div>
      )}
    </div>
  );
}
