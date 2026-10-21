// D-602 (QuickCapture board state 4; FR-CAP-01 AC-19): the capture's due-date dialog: the typed-date field (D-537),
// quick picks, a month grid from Monday with today ringed and the chosen day filled, and `No date`. The capture window
// can't read the vault, so this grid marks no Daily Notes (unlike daily/Calendar.tsx).
import { useEffect, useRef, useState } from 'react';
import { addDays } from '@tegg/doc';
import { t } from '../i18n/catalog';

const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;
const utc = (s: string) => { const [y, m, d] = s.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d, 12)); };
/** 0 = Monday … 6 = Sunday. */
const weekday = (s: string) => (utc(s).getUTCDay() + 6) % 7;

export function nextWeekday(today: string, target: number): string {
  let d = addDays(today, 1);
  while (weekday(d) !== target) d = addDays(d, 1);
  return d;
}

export function DueCalendar({ today, due, region, field, onPick, onClose }: {
  today: string;
  due: string | null;
  region: string;
  /** The typed-date field (D-537) above the picks. */
  field: React.ReactNode;
  onPick: (date: string | null) => void;
  onClose: () => void;
}) {
  const start = due ?? today;
  const [month, setMonth] = useState(() => start.slice(0, 7));
  const [focus, setFocus] = useState(start);
  const grid = useRef<HTMLDivElement | null>(null);
  const [y, m] = month.split('-').map(Number);
  const first = ymd(y, m, 1);
  const lead = weekday(first);
  const days: string[] = [];
  for (let i = 0; i < 42; i++) days.push(addDays(first, i - lead));
  const rows = Math.ceil((lead + new Date(Date.UTC(y, m, 0)).getUTCDate()) / 7);
  const shown = days.slice(0, rows * 7);
  const fmt = (o: Intl.DateTimeFormatOptions) => (d: string) => new Intl.DateTimeFormat(region, { ...o, timeZone: 'UTC' }).format(utc(d));
  const monthName = fmt({ month: 'long', year: 'numeric' })(first);
  const dayName = fmt({ weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const weekNames = [0, 1, 2, 3, 4, 5, 6].map((i) => fmt({ weekday: 'short' })(addDays('2026-10-12', i))); // a Monday
  const shift = (n: number) => { const d = new Date(Date.UTC(y, m - 1 + n, 1)); setMonth(`${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`); };
  useEffect(() => { if (focus.slice(0, 7) !== month) setMonth(focus.slice(0, 7)); }, [focus]);
  useEffect(() => { grid.current?.querySelector<HTMLElement>(`[data-date="${focus}"]`)?.focus(); }, [focus, month]);
  const onKey = (e: React.KeyboardEvent) => {
    const step = ({ ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 } as Record<string, number>)[e.key];
    if (step) { e.preventDefault(); e.stopPropagation(); setFocus(addDays(focus, step)); }
    else if (e.key === 'Enter' && !e.metaKey) { e.preventDefault(); e.stopPropagation(); onPick(focus); }
  };
  const quick: [string, string][] = [['due.today', today], ['due.tomorrow', addDays(today, 1)], ['due.nextWeek', nextWeekday(today, 0)], ['due.fri', nextWeekday(today, 4)]];
  return (
    <div role="dialog" aria-label={t('capture.dueTitle')} className="capture-menu capture-due capture-cal"
      onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); } }}>
      {field}
      <div className="cal-quick">
        {quick.map(([label, d]) => <button key={label} type="button" onClick={() => onPick(d)}>{t(label)}</button>)}
      </div>
      <div className="cal-head">
        <b data-user-content>{monthName}</b>
        <button type="button" className="icon-button small" aria-label={t('daily.previousMonth')} onClick={() => shift(-1)}>‹</button>
        <button type="button" className="icon-button small" aria-label={t('daily.nextMonth')} onClick={() => shift(1)}>›</button>
      </div>
      <div ref={grid} role="grid" aria-label={monthName} className="cal-grid" onKeyDown={onKey}>
        {weekNames.map((w) => <span key={w} role="columnheader" className="cal-wd" data-user-content>{w}</span>)}
        {shown.map((d) => {
          const out = d.slice(0, 7) !== month;
          return (
            <button key={d} type="button" role="gridcell" data-date={d} tabIndex={d === focus ? 0 : -1} title={dayName(d)}
              aria-selected={d === due} aria-current={d === today ? 'date' : undefined}
              className={`cal-day${out ? ' out' : ''}${d === due ? ' sel' : ''}${d === today ? ' today' : ''}${d < today ? ' past' : ''}`}
              onClick={() => onPick(d)}>
              {Number(d.slice(8))}
            </button>
          );
        })}
      </div>
      <div className="cal-foot">
        <span className="muted">{t('capture.dueHint')}</span>
        <button type="button" className="text-button" onClick={() => onPick(null)}>{t('capture.noDate')}</button>
      </div>
    </div>
  );
}
