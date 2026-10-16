// The calendar popover (FR-DLY-03 AC-3…AC-6, daily-notes.md R18, D-329): a WAI-ARIA date-picker grid of one month,
// days with a Daily Note marked from `daily_dates`, live on every vault change. Region formats come from Intl (D-133).
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { addDays, localDate } from '@tegg/doc';
import { t } from '../i18n/catalog';
import { region } from '../i18n/collate';
import { events, ipc } from '../ipc/client';
import { Icon } from '../shell/Icon';

const pad = (n: number) => String(n).padStart(2, '0');
const parts = (d: string) => d.split('-').map(Number) as [number, number, number];
const utc = (d: string) => { const [y, m, dd] = parts(d); return Date.UTC(y, m - 1, dd, 12); };

/** The long date of the region (R19, D-337): `středa 14. října 2026`, `Wednesday, October 14, 2026`. */
export function longDate(date: string, loc = region() ?? undefined): string {
  return new Intl.DateTimeFormat(loc, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' }).format(utc(date));
}

/** First day of the week from the region (D-329): 0 Sunday … 6 Saturday. */
function weekStart(loc: string | undefined): number {
  try {
    const l = new Intl.Locale(loc ?? navigator.language) as Intl.Locale & { getWeekInfo?: () => { firstDay: number }; weekInfo?: { firstDay: number } };
    const w = l.getWeekInfo?.() ?? l.weekInfo;
    if (w) return w.firstDay % 7;
    const r = (l.region ?? '').toUpperCase();
    if (r === 'US' || r === 'CA' || r === 'JP' || (!r && l.language === 'en')) return 0;
    return 1;
  } catch {
    return 1;
  }
}

export function Calendar({ selected, anchor, at, onChoose, onClose }: {
  /** The open date (selected), `YYYY-MM-DD`. */
  selected: string;
  anchor: HTMLElement | null;
  /** Fixed coordinates instead of an anchor (the `@` list's caret, FR-DLY-08 AC-3). */
  at?: { left: number; top: number };
  onChoose: (date: string) => void;
  onClose: () => void;
}) {
  const loc = region() ?? undefined;
  const today = localDate(Date.now());
  const [focus, setFocus] = useState(selected);
  const [marks, setMarks] = useState<Set<string>>(new Set());
  const [refresh, setRefresh] = useState(0);
  const box = useRef<HTMLDivElement | null>(null);
  const [y, m] = parts(focus);

  useEffect(() => {
    const un = events.changed(() => setRefresh((n) => n + 1));
    return () => void un.then((f) => f());
  }, []);
  useEffect(() => {
    let live = true;
    ipc.dailyDates(y, m).then((d) => { if (live) setMarks(new Set(d)); }, () => {});
    return () => { live = false; };
  }, [y, m, refresh]);
  useLayoutEffect(() => {
    box.current?.querySelector<HTMLElement>(`[data-date="${focus}"]`)?.focus();
  }, [focus]);

  const first = `${y}-${pad(m)}-01`;
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const start = weekStart(loc);
  const lead = (new Date(utc(first)).getUTCDay() - start + 7) % 7;
  const cells: (string | null)[] = [...Array(lead).fill(null), ...Array.from({ length: days }, (_, i) => `${y}-${pad(m)}-${pad(i + 1)}`)];
  while (cells.length % 7) cells.push(null);
  const weeks: (string | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  const wd = (i: number) => new Date(Date.UTC(2026, 9, 11 + ((start + i) % 7), 12)); // 2026-10-11 is a Sunday
  const fmt = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(loc, { ...o, timeZone: 'UTC' });
  const monthName = fmt({ month: 'long', year: 'numeric' }).format(utc(first));
  const shiftMonth = (n: number) => {
    const [fy, fm, fd] = parts(focus);
    const tm = new Date(Date.UTC(fy, fm - 1 + n, 1));
    const last = new Date(Date.UTC(tm.getUTCFullYear(), tm.getUTCMonth() + 1, 0)).getUTCDate();
    setFocus(`${tm.getUTCFullYear()}-${pad(tm.getUTCMonth() + 1)}-${pad(Math.min(fd, last))}`);
  };
  const dow = (d: string) => (new Date(utc(d)).getUTCDay() - start + 7) % 7;

  const onKey = (e: React.KeyboardEvent) => {
    const k = e.key;
    let next: string | null = null;
    if (k === 'ArrowRight') next = addDays(focus, 1);
    else if (k === 'ArrowLeft') next = addDays(focus, -1);
    else if (k === 'ArrowDown') next = addDays(focus, 7);
    else if (k === 'ArrowUp') next = addDays(focus, -7);
    else if (k === 'Home') next = addDays(focus, -dow(focus));
    else if (k === 'End') next = addDays(focus, 6 - dow(focus));
    else if (k === 'PageDown' || k === 'PageUp') { e.preventDefault(); e.stopPropagation(); shiftMonth(k === 'PageDown' ? 1 : -1); return; }
    else if (k === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); return; }
    else if (k === 'Enter' || k === ' ') { e.preventDefault(); e.stopPropagation(); onChoose(focus); return; }
    if (next) { e.preventDefault(); e.stopPropagation(); setFocus(next); }
  };

  const r = at ? { bottom: at.top, left: at.left } : anchor?.getBoundingClientRect();
  const style: React.CSSProperties = r ? { position: 'fixed', top: Math.min(r.bottom + 4, window.innerHeight - 320), left: Math.max(8, Math.min(r.left, window.innerWidth - 300)) } : {};
  return (
    <div className="calendar-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={box} role="dialog" aria-label={t('daily.calendar')} className="calendar popover" style={style} onKeyDown={onKey}>
        <div className="calendar-head">
          <button type="button" tabIndex={0} className="icon-button small" aria-label={t('daily.previousMonth')} onClick={() => shiftMonth(-1)}><Icon name="chevron-left" size={14} /></button>
          <h2 className="calendar-month" data-user-content>{monthName}</h2>
          <button type="button" tabIndex={0} className="icon-button small" aria-label={t('daily.nextMonth')} onClick={() => shiftMonth(1)}><Icon name="chevron-right" size={14} /></button>
        </div>
        <table role="grid" aria-label={monthName} className="calendar-grid">
          <thead>
            <tr>{[0, 1, 2, 3, 4, 5, 6].map((i) => <th key={i} role="columnheader" scope="col" abbr={fmt({ weekday: 'long' }).format(wd(i))} data-user-content>{fmt({ weekday: 'short' }).format(wd(i))}</th>)}</tr>
          </thead>
          <tbody>
            {weeks.map((w, i) => (
              <tr key={i}>
                {w.map((d, j) => (
                  <td key={j} role="gridcell">
                    {d && (
                      <button type="button" data-date={d} tabIndex={d === focus ? 0 : -1} aria-label={longDate(d, loc)}
                        aria-current={d === today ? 'date' : undefined} aria-selected={d === selected ? 'true' : 'false'}
                        data-has-note={marks.has(d) ? 'true' : undefined} aria-description={marks.has(d) ? t('daily.hasNote') : undefined}
                        className={`calendar-day ${marks.has(d) ? 'has-note' : ''} ${d === selected ? 'selected' : ''} ${d === today ? 'today' : ''}`}
                        onClick={() => onChoose(d)}>
                        {parts(d)[2]}
                      </button>
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
