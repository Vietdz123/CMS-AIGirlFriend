import { useEffect, useRef, useState } from 'react';
import { daysAgo, isoDate } from '../format';

const WEEKDAYS = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'];

function presets() {
  const now = new Date();
  const monthStart = isoDate(new Date(now.getFullYear(), now.getMonth(), 1));
  const prevStart = isoDate(new Date(now.getFullYear(), now.getMonth() - 1, 1));
  const prevEnd = isoDate(new Date(now.getFullYear(), now.getMonth(), 0));
  return [
    { label: 'Hôm nay', from: daysAgo(0), to: daysAgo(0) },
    { label: 'Hôm qua', from: daysAgo(1), to: daysAgo(1) },
    { label: '7 ngày qua', from: daysAgo(6), to: daysAgo(0) },
    { label: '30 ngày qua', from: daysAgo(29), to: daysAgo(0) },
    { label: '90 ngày qua', from: daysAgo(89), to: daysAgo(0) },
    { label: 'Tháng này', from: monthStart, to: daysAgo(0) },
    { label: 'Tháng trước', from: prevStart, to: prevEnd },
  ];
}

/** Các ô ngày của 1 tháng, tuần bắt đầu từ thứ Hai; null = ô trống đầu tháng. */
function monthCells(year: number, month: number): (string | null)[] {
  const first = new Date(year, month, 1);
  const lead = (first.getDay() + 6) % 7;
  const days = new Date(year, month + 1, 0).getDate();
  const cells: (string | null)[] = Array(lead).fill(null);
  for (let d = 1; d <= days; d++) cells.push(isoDate(new Date(year, month, d)));
  return cells;
}

/**
 * Ô khoảng ngày kiểu "2026-10-01 ~ 2026-10-12": bấm vào mở lịch, bấm ngày bắt đầu rồi ngày kết thúc.
 * Không có ô gõ tay.
 */
export function DateRangePicker({ from, to, onChange }: {
  from: string;
  to: string;
  onChange: (range: { from: string; to: string }) => void;
}) {
  const [open, setOpen] = useState(false);
  const [start, setStart] = useState<string | null>(null); // đã chọn ngày đầu, đang chờ ngày cuối
  const [hover, setHover] = useState<string | null>(null);
  const [view, setView] = useState(() => {
    const d = new Date(`${to}T00:00:00`);
    return { year: d.getFullYear(), month: d.getMonth() - 1 };
  });
  const ref = useRef<HTMLDivElement>(null);
  const today = daysAgo(0);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  function toggle() {
    if (!open) {
      const d = new Date(`${to}T00:00:00`);
      setView({ year: d.getFullYear(), month: d.getMonth() - 1 });
      setStart(null);
    }
    setOpen(!open);
  }

  function pick(day: string) {
    if (!start) {
      setStart(day);
      return;
    }
    const [a, b] = day < start ? [day, start] : [start, day];
    onChange({ from: a, to: b });
    setStart(null);
    setOpen(false);
  }

  // Khoảng đang tô: lúc chọn dở thì từ ngày đầu tới ngày đang rê chuột.
  const lo = start ? (hover && hover < start ? hover : start) : from;
  const hi = start ? (hover && hover > start ? hover : start) : to;

  const months = [0, 1].map((i) => {
    const d = new Date(view.year, view.month + i, 1);
    return { year: d.getFullYear(), month: d.getMonth() };
  });

  return (
    <div className="drp" ref={ref}>
      <button type="button" className={open ? 'drp-field open' : 'drp-field'} onClick={toggle}>
        <span>{from} ~ {to}</span>
        <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
          <rect x="1.5" y="2.5" width="13" height="12" rx="1.5" fill="none" stroke="currentColor" />
          <path d="M1.5 6h13M5 1v3M11 1v3" stroke="currentColor" />
        </svg>
      </button>

      {open && (
        <div className="drp-pop">
          <ul className="drp-presets">
            {presets().map((p) => {
              const active = p.from === from && p.to === to;
              return (
                <li key={p.label}>
                  <button type="button" className={active ? 'active' : ''}
                    onClick={() => { onChange({ from: p.from, to: p.to }); setOpen(false); }}>
                    {p.label}{active && <span className="check">✓</span>}
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="drp-cal">
            <div className="drp-nav">
              <button type="button" aria-label="Tháng trước"
                onClick={() => setView({ year: view.year, month: view.month - 1 })}>‹</button>
              <span className="drp-hint">{start ? 'Chọn ngày kết thúc' : 'Chọn ngày bắt đầu'}</span>
              <button type="button" aria-label="Tháng sau"
                onClick={() => setView({ year: view.year, month: view.month + 1 })}>›</button>
            </div>
            <div className="drp-months">
              {months.map(({ year, month }) => (
                <div key={`${year}-${month}`} className="drp-month">
                  <div className="drp-title">Tháng {month + 1}, {year}</div>
                  <div className="drp-grid">
                    {WEEKDAYS.map((w) => <span key={w} className="drp-wd">{w}</span>)}
                    {monthCells(year, month).map((day, i) => {
                      if (!day) return <span key={`e${i}`} />;
                      const future = day > today;
                      const cls = [
                        'drp-day',
                        day >= lo && day <= hi ? 'in' : '',
                        day === lo || day === hi ? 'edge' : '',
                        day === today ? 'today' : '',
                      ].join(' ');
                      return (
                        <button type="button" key={day} className={cls} disabled={future}
                          onMouseEnter={() => setHover(day)} onClick={() => pick(day)}>
                          {Number(day.slice(8))}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
