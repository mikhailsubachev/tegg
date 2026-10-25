// D-763 (docs/acceptance/date-picker.md R89): the one date picker. The typed `Date` field, the quick picks of D-602,
// a month grid from the Date & time week start (D-329, D-566) with today ringed and the value filled, and `No date`.
// Used by the attribute panel, task cards, the `@` list, the Daily Notes calendar (with its note marks, R18) and the
// capture. It reads nothing from the vault itself (the capture window may not, D-553, NFR-SEC-03 AC-4): the Daily Notes
// calendar passes its marks in. Region formats come from Intl (D-133).
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { addDays } from '@tegg/doc';
import { parseDate } from '@tegg/schema';
import { t } from '../i18n/catalog';
import { region } from '../i18n/collate';
import { dateTimeSetting } from '../i18n/dates';
import { Icon } from '../shell/Icon';

const pad = (n: number) => String(n).padStart(2, '0');
const parts = (d: string) => d.split('-').map(Number) as [number, number, number];
const utc = (d: string) => { const [y, m, dd] = parts(d); return Date.UTC(y, m - 1, dd, 12); };
const isYmd = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
/** 0 = Monday … 6 = Sunday. */
const mondayIndex = (d: string) => (new Date(utc(d)).getUTCDay() + 6) % 7;

/** The next `target` weekday (0 = Monday) after `today`. */
export function nextWeekday(today: string, target: number): string {
  let d = addDays(today, 1);
  while (mondayIndex(d) !== target) d = addDays(d, 1);
  return d;
}

/** The long date of the region (R19, D-337): `středa 14. října 2026`, `Wednesday, October 14, 2026`. */
export function longDate(date: string, loc = region() ?? undefined): string {
  return new Intl.DateTimeFormat(loc, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' }).format(utc(date));
}

/** First day of the week (D-329, D-566): the Date & time choice, else the region; 0 Sunday … 6 Saturday. */
export function weekStart(loc: string | undefined): number {
  const w0 = dateTimeSetting()?.week;
  if (w0 === 'monday') return 1;
  if (w0 === 'sunday') return 0;
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

const WEEKDAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

/** A typed date (D-537, R89): `YYYY-MM-DD` or the region's numeric form, `today`, `tomorrow`, `yesterday`, `next week`
 *  (next Monday) or a weekday, also abbreviated (`fri`: the next Friday). Null when it isn't a date. */
export function typedDate(text: string, today: string, loc: string): string | null {
  const s = text.normalize('NFC').trim().toLocaleLowerCase();
  if (!s) return null;
  const p = parseDate(text, loc);
  if (p.ok && p.value && typeof p.value === 'object' && 'date' in p.value) return (p.value as { date: string }).date;
  if (s === 'today') return today;
  if (s === 'tomorrow') return addDays(today, 1);
  if (s === 'yesterday') return addDays(today, -1);
  if (s === 'next week') return nextWeekday(today, 0);
  if (s.length >= 2) {
    const i = WEEKDAYS.findIndex((w) => w.startsWith(s));
    if (i >= 0) return nextWeekday(today, i);
  }
  return null;
}

export function PickDate({ label, today, value, onPick, onClear, onClose, anchor, at, inline, marks, onMonth, field, className }: {
  /** The dialog's name: `Pick date`, the capture's `Pick a due date`, the Daily Notes `Calendar`. */
  label: string;
  /** Today's local date, `YYYY-MM-DD` (the app's zone, D-104). */
  today: string;
  /** The current value (selected), `YYYY-MM-DD`, or null. */
  value: string | null;
  onPick: (date: string) => void;
  /** `No date`; without it the button isn't shown (the Daily Notes calendar, the `@` list). */
  onClear?: () => void;
  onClose: () => void;
  anchor?: HTMLElement | null;
  /** Fixed coordinates instead of an anchor (the `@` list's caret, FR-DLY-08 AC-3). */
  at?: { left: number; top: number };
  /** Placed by its parent's CSS (the capture window), without a backdrop. */
  inline?: boolean;
  /** The days that have a Daily Note (R18), for the shown month; `onMonth` asks for another month's. */
  marks?: Set<string>;
  onMonth?: (y: number, m: number) => void;
  /** The capture's own typed-date field (D-537); otherwise the picker's `Date` field. */
  field?: React.ReactNode;
  className?: string;
}) {
  const loc = region() ?? undefined;
  const [focus, setFocus] = useState(isYmd(value) ? value : today);
  const [typed, setTyped] = useState('');
  const [error, setError] = useState(false);
  const box = useRef<HTMLDivElement | null>(null);
  const moved = useRef(false);
  const [y, m] = parts(focus);

  useEffect(() => { onMonth?.(y, m); }, [y, m]);
  // The focus starts on the value's day (else today) unless the capture's own field takes it; then it follows the arrows.
  useLayoutEffect(() => {
    if (!moved.current && field) return;
    box.current?.querySelector<HTMLElement>(`[data-date="${focus}"]`)?.focus({ preventScroll: true });
  }, [focus]);

  const first = `${y}-${pad(m)}-01`;
  const start = weekStart(loc);
  const lead = (new Date(utc(first)).getUTCDay() - start + 7) % 7;
  const daysIn = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const rows = Math.ceil((lead + daysIn) / 7);
  const cells = Array.from({ length: rows * 7 }, (_, i) => addDays(first, i - lead));
  const weeks: string[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  const wd = (i: number) => new Date(Date.UTC(2026, 9, 11 + ((start + i) % 7), 12)); // 2026-10-11 is a Sunday
  const fmt = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(loc, { ...o, timeZone: 'UTC' });
  const monthName = fmt({ month: 'long', year: 'numeric' }).format(utc(first));
  const go = (d: string) => { moved.current = true; setFocus(d); };
  const shiftMonth = (n: number) => {
    const [fy, fm, fd] = parts(focus);
    const tm = new Date(Date.UTC(fy, fm - 1 + n, 1));
    const last = new Date(Date.UTC(tm.getUTCFullYear(), tm.getUTCMonth() + 1, 0)).getUTCDate();
    go(`${tm.getUTCFullYear()}-${pad(tm.getUTCMonth() + 1)}-${pad(Math.min(fd, last))}`);
  };
  const dow = (d: string) => (new Date(utc(d)).getUTCDay() - start + 7) % 7;
  const quick: [string, string][] = [['due.today', today], ['due.tomorrow', addDays(today, 1)], ['due.nextWeek', nextWeekday(today, 0)], ['due.fri', nextWeekday(today, 4)]];

  const onKey = (e: React.KeyboardEvent) => {
    const k = e.key;
    if (k === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); return; }
    if (!(e.target as HTMLElement).dataset.date) return;
    let next: string | null = null;
    if (k === 'ArrowRight') next = addDays(focus, 1);
    else if (k === 'ArrowLeft') next = addDays(focus, -1);
    else if (k === 'ArrowDown') next = addDays(focus, 7);
    else if (k === 'ArrowUp') next = addDays(focus, -7);
    else if (k === 'Home') next = addDays(focus, -dow(focus));
    else if (k === 'End') next = addDays(focus, 6 - dow(focus));
    else if (k === 'PageDown' || k === 'PageUp') { e.preventDefault(); e.stopPropagation(); shiftMonth(k === 'PageDown' ? 1 : -1); return; }
    else if ((k === 'Enter' && !e.metaKey) || k === ' ') { e.preventDefault(); e.stopPropagation(); onPick(focus); return; }
    if (next) { e.preventDefault(); e.stopPropagation(); go(next); }
  };

  let style: React.CSSProperties | undefined;
  if (!inline) {
    const r = at ? { bottom: at.top, left: at.left } : anchor?.getBoundingClientRect();
    style = r ? { position: 'fixed', top: Math.max(8, Math.min(r.bottom + 4, window.innerHeight - 380)), left: Math.max(8, Math.min(r.left, window.innerWidth - 290)) } : undefined;
  }
  const dialog = (
    <div ref={box} role="dialog" aria-label={label} className={`pick-date${inline ? '' : ' popover'}${className ? ` ${className}` : ''}`} style={style} onKeyDown={onKey}
      onMouseDown={(e) => e.stopPropagation()}>
      {field ?? (
        <span className="pick-date-field">
          <input type="text" aria-label={t('date.field')} placeholder={t('date.fieldPlaceholder')} value={typed} spellCheck={false} autoComplete="off"
            aria-invalid={error || undefined} aria-describedby={error ? 'pick-date-error' : undefined}
            onChange={(e) => { setTyped(e.target.value); setError(false); }}
            onKeyDown={(e) => {
              if (e.key !== 'Enter' || e.metaKey) return;
              e.preventDefault(); e.stopPropagation();
              const d = typedDate(typed, today, loc ?? navigator.language);
              if (d) onPick(d); else setError(true);
            }} />
          {error && <span id="pick-date-error" role="alert" className="field-error">{t('date.notADate')}</span>}
        </span>
      )}
      <div className="cal-quick">
        {quick.map(([key, d]) => <button key={key} type="button" onClick={() => onPick(d)}>{t(key)}</button>)}
      </div>
      <div className="cal-head">
        <h2 className="cal-month" data-user-content>{monthName}</h2>
        <button type="button" className="icon-button small" aria-label={t('daily.previousMonth')} onClick={() => shiftMonth(-1)}><Icon name="chevron-left" size={14} /></button>
        <button type="button" className="icon-button small" aria-label={t('daily.nextMonth')} onClick={() => shiftMonth(1)}><Icon name="chevron-right" size={14} /></button>
      </div>
      <table role="grid" aria-label={monthName} className="cal-grid">
        <thead>
          <tr>{[0, 1, 2, 3, 4, 5, 6].map((i) => <th key={i} role="columnheader" scope="col" className="cal-wd" abbr={fmt({ weekday: 'long' }).format(wd(i))} data-user-content>{fmt({ weekday: 'short' }).format(wd(i))}</th>)}</tr>
        </thead>
        <tbody>
          {weeks.map((w, i) => (
            <tr key={i}>
              {w.map((d) => {
                const out = d.slice(0, 7) !== first.slice(0, 7);
                const has = !!marks?.has(d);
                return (
                  <td key={d} role="gridcell">
                    <button type="button" data-date={d} tabIndex={d === focus ? 0 : -1} aria-label={longDate(d, loc)}
                      aria-current={d === today ? 'date' : undefined} aria-selected={d === value ? 'true' : 'false'}
                      data-has-note={has ? 'true' : undefined} aria-description={has ? t('daily.hasNote') : undefined}
                      className={`cal-day${out ? ' out' : ''}${d < today ? ' past' : ''}${d === today ? ' today' : ''}${d === value ? ' sel' : ''}${has ? ' has-note' : ''}`}
                      onClick={() => onPick(d)}>
                      {parts(d)[2]}
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="cal-foot">
        <span className="muted">{t('capture.dueHint')}</span>
        {onClear && <button type="button" className="text-button" onClick={onClear}>{t('capture.noDate')}</button>}
      </div>
    </div>
  );
  if (inline) return dialog;
  return <div className="calendar-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>{dialog}</div>;
}
