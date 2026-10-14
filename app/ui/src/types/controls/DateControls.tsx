// Date, Date-time and Date range (R10, FR-FMT-11, D-230). Dates are typed in the region's numeric format or as
// `YYYY-MM-DD`, or chosen in the `Choose date` dialog; they never shift with the time zone. A date-time is a date
// and a time in the machine's zone, written with that moment's offset; a time that doesn't exist is refused. A date
// range is one row with two date fields, committed together (FR-TYP-02 AC-3).
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { parseDate, parseDateRange, parseDateTime } from '@tegg/schema';
import { t } from '../../i18n/catalog';
import { dateText, dateTimeParts, locale, rawText } from '../util';
import { EmptyMark, FieldError, WarnIcon, useErrorId, useField, type Value } from './common';

const pad = (n: number) => String(n).padStart(2, '0');
const isYmd = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);

/** The `Choose date` dialog: a month grid; ←/→/↑/↓ move, ⏎ chooses, Esc closes (focus back to the opener). */
export function DatePicker({ value, onPick, onClose, anchor }: { value: string | null; onPick: (ymd: string) => void; onClose: () => void; anchor: HTMLElement | null }) {
  const start = isYmd(value) ? value : (() => { const d = new Date(Date.now()); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; })();
  const [month, setMonth] = useState(() => ({ y: +start.slice(0, 4), m: +start.slice(5, 7) }));
  const [day, setDay] = useState(+start.slice(8, 10));
  const ref = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number }>({ left: 0, top: 0 });
  useLayoutEffect(() => {
    const r = anchor?.getBoundingClientRect();
    if (r) setPos({ left: Math.max(8, Math.min(r.left, window.innerWidth - 280)), top: Math.min(r.bottom + 4, window.innerHeight - 300) });
  }, [anchor]);
  const days = new Date(month.y, month.m, 0).getDate();
  const lead = (new Date(month.y, month.m - 1, 1).getDay() + 6) % 7; // weeks start on Monday
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>(`[data-day="${Math.min(day, days)}"]`)?.focus();
  }, [month, day, days]);
  useEffect(() => {
    const outside = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node) && !anchor?.contains(e.target as Node)) onClose(); };
    document.addEventListener('mousedown', outside, true);
    return () => document.removeEventListener('mousedown', outside, true);
  }, []);
  const shift = (dm: number) => setMonth(({ y, m }) => { const n = new Date(y, m - 1 + dm, 1); return { y: n.getFullYear(), m: n.getMonth() + 1 }; });
  const move = (dd: number) => {
    const d = new Date(month.y, month.m - 1, Math.min(day, days) + dd);
    setMonth({ y: d.getFullYear(), m: d.getMonth() + 1 });
    setDay(d.getDate());
  };
  const pick = (d: number) => onPick(`${String(month.y).padStart(4, '0')}-${pad(month.m)}-${pad(d)}`);
  const title = new Intl.DateTimeFormat(locale(), { month: 'long', year: 'numeric' }).format(new Date(month.y, month.m - 1, 1));
  const weekdays = Array.from({ length: 7 }, (_, i) => new Intl.DateTimeFormat(locale(), { weekday: 'short' }).format(new Date(2024, 0, 1 + i)));
  const cells: (number | null)[] = [...Array(lead).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)];
  while (cells.length % 7) cells.push(null);
  const weeks = Array.from({ length: cells.length / 7 }, (_, w) => cells.slice(w * 7, w * 7 + 7));
  return (
    <div ref={ref} role="dialog" aria-modal="true" aria-label={t('panel.datePicker')} className="popover date-picker" style={pos}
      onKeyDown={(e) => {
        const k = e.key;
        if (k === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); return; }
        const d = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[k as 'ArrowLeft'];
        if (d && (e.target as HTMLElement).dataset.day) { e.preventDefault(); e.stopPropagation(); move(d); }
        if ((k === 'Enter' || k === ' ') && (e.target as HTMLElement).dataset.day) { e.preventDefault(); e.stopPropagation(); pick(Number((e.target as HTMLElement).dataset.day)); }
      }}>
      <div className="date-picker-head">
        <button data-command="panel.date.button0" type="button" className="icon-button" aria-label={t('panel.prevMonth')} onClick={() => shift(-1)}>‹</button>
        <span className="date-picker-title">{title}</span>
        <button data-command="panel.date.button1" type="button" className="icon-button" aria-label={t('panel.nextMonth')} onClick={() => shift(1)}>›</button>
      </div>
      <div role="grid" aria-label={title} className="date-grid">
        <div role="row" className="date-row">
          {weekdays.map((w) => <span key={w} role="columnheader" className="date-wd">{w}</span>)}
        </div>
        {weeks.map((w, i) => (
          <div role="row" key={i} className="date-row">
            {w.map((d, j) => (d === null
              ? <span key={j} role="gridcell" className="date-cell blank" />
              : (
                <span key={j} role="gridcell" data-day={d} tabIndex={d === Math.min(day, days) ? 0 : -1}
                  aria-selected={isYmd(value) && value === `${String(month.y).padStart(4, '0')}-${pad(month.m)}-${pad(d)}`}
                  className="date-cell" onClick={() => pick(d)}>{d}</span>
              )))}
          </div>
        ))}
      </div>
    </div>
  );
}

export function DateControl({ name, desc, raw, invalid, disabled, onValue, onNext, inputRef }: {
  name: string;
  desc?: string;
  raw: unknown;
  invalid?: boolean;
  disabled?: boolean;
  onValue: (v: Value) => boolean | void;
  onNext?: () => void;
  inputRef?: (el: HTMLElement | null) => void;
}) {
  const saved = isYmd(raw) ? dateText(raw) : rawText(raw);
  const f = useField(saved);
  const [error, setError] = useState<string | null>(null);
  const [focused, setFocused] = useState(false);
  const [picker, setPicker] = useState(false);
  const errId = useErrorId();
  const el = useRef<HTMLInputElement | null>(null);
  const btn = useRef<HTMLButtonElement | null>(null);
  const commit = (): boolean => {
    const text = f.value;
    if (!f.editing.current || text === saved) { setError(null); return true; }
    if (text.trim() === '') { setError(null); if (onValue(null) !== false) f.reset(''); return true; }
    const p = parseDate(text, locale());
    if (!p.ok) { setError(t(p.error)); return false; }
    setError(null);
    if (onValue(p.value) === false) return false;
    f.reset(text);
    return true;
  };
  return (
    <span className="field-wrap date-field">
      <input ref={(e) => { el.current = e; inputRef?.(e); }} type="text" aria-label={name} aria-description={desc} aria-describedby={error ? errId : undefined}
        aria-invalid={error ? true : undefined} disabled={disabled} className={`pfield ${invalid ? 'invalid' : ''}`} value={f.value} spellCheck={false} autoComplete="off"
        onFocus={() => setFocused(true)} onBlur={() => { setFocused(false); commit(); }} onChange={(e) => f.set(e.target.value)}
        onKeyDown={(e) => {
          if (f.history(e)) return;
          if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); f.reset(); setError(null); return; }
          if (e.key === 'ArrowDown' && e.altKey) { e.preventDefault(); setPicker(true); return; }
          if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); if (commit()) onNext?.(); }
        }} />
      {f.value === '' && !focused && !disabled && <EmptyMark onActivate={() => el.current?.focus()} />}
      {invalid && f.value === saved && <WarnIcon />}
      {!disabled && (
        <button data-command="panel.date.button2" ref={btn} type="button" tabIndex={-1} className="icon-button small" aria-label={t('panel.chooseDate', { name })} aria-haspopup="dialog" aria-expanded={picker}
          onClick={() => setPicker((p) => !p)}>
          <span aria-hidden="true">▾</span>
        </button>
      )}
      <FieldError id={errId} text={error} />
      {picker && (
        <DatePicker value={isYmd(raw) ? raw : null} anchor={btn.current}
          onClose={() => { setPicker(false); el.current?.focus(); }}
          onPick={(d) => { setPicker(false); setError(null); if (onValue({ date: d }) !== false) f.reset(dateText(d)); el.current?.focus(); }} />
      )}
    </span>
  );
}

/** Commits a group of fields when ⏎ is pressed in one of them or the focus leaves the group. */
function useGroupCommit(commit: () => boolean, onNext?: () => void) {
  const ref = useRef<HTMLSpanElement | null>(null);
  return {
    ref,
    onBlur: (e: React.FocusEvent) => { if (!ref.current?.contains(e.relatedTarget as Node | null)) commit(); },
    onKeyDown: (e: React.KeyboardEvent) => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); if (commit()) onNext?.(); } },
  };
}

export function DateTimeControl({ name, desc, raw, invalid, disabled, onValue, onNext, inputRef }: {
  name: string;
  desc?: string;
  raw: unknown;
  invalid?: boolean;
  disabled?: boolean;
  onValue: (v: Value) => boolean | void;
  onNext?: () => void;
  inputRef?: (el: HTMLElement | null) => void;
}) {
  const parts = dateTimeParts(raw);
  const savedD = parts ? parts.date : rawText(raw);
  const savedT = parts ? parts.time : '';
  const d = useField(savedD);
  const tm = useField(savedT);
  const [error, setError] = useState<string | null>(null);
  const errId = useErrorId();
  const commit = (): boolean => {
    if (!d.editing.current && !tm.editing.current) return true;
    if (d.value === savedD && tm.value === savedT) { setError(null); return true; }
    if (d.value.trim() === '' && tm.value.trim() === '') { setError(null); if (onValue(null) !== false) { d.reset(''); tm.reset(''); } return true; }
    const p = parseDateTime(d.value, tm.value.trim() === '' ? '00:00' : tm.value);
    if (!p.ok) { setError(t(p.error)); return false; }
    setError(null);
    if (onValue(p.value) === false) return false;
    d.reset(d.value);
    tm.reset(tm.value);
    return true;
  };
  const g = useGroupCommit(commit, onNext);
  const esc = (e: React.KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); d.reset(); tm.reset(); setError(null); } };
  return (
    <span ref={g.ref} role="group" aria-label={name} aria-description={desc} className="field-wrap date-time" onBlur={g.onBlur} onKeyDown={g.onKeyDown}>
      <input ref={inputRef} type="text" aria-label={t('panel.dateField', { name })} disabled={disabled} className={`pfield ${invalid ? 'invalid' : ''}`} value={d.value}
        aria-describedby={error ? errId : undefined} spellCheck={false} autoComplete="off" onChange={(e) => d.set(e.target.value)} onKeyDown={(e) => { if (!d.history(e)) esc(e); }} />
      <input type="text" aria-label={t('panel.timeField', { name })} disabled={disabled} className="pfield time" value={tm.value} spellCheck={false} autoComplete="off"
        aria-describedby={error ? errId : undefined} onChange={(e) => tm.set(e.target.value)} onKeyDown={(e) => { if (!tm.history(e)) esc(e); }} />
      {d.value === '' && tm.value === '' && !disabled && <EmptyMark />}
      {invalid && <WarnIcon />}
      <FieldError id={errId} text={error} />
    </span>
  );
}

export function DateRangeControl({ name, desc, raw, invalid, disabled, onRange, onNext, inputRef }: {
  name: string;
  desc?: string;
  raw: unknown;
  invalid?: boolean;
  disabled?: boolean;
  onRange: (start: string | null, end: string | null) => boolean | void;
  onNext?: () => void;
  inputRef?: (el: HTMLElement | null) => void;
}) {
  const r = (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) as { start?: unknown; end?: unknown };
  const show = (v: unknown) => (isYmd(v) ? dateText(v) : rawText(v));
  const savedS = show(r.start), savedE = show(r.end);
  const s = useField(savedS);
  const e2 = useField(savedE);
  const [error, setError] = useState<string | null>(null);
  const errId = useErrorId();
  const commit = (): boolean => {
    if (!s.editing.current && !e2.editing.current) return true;
    if (s.value === savedS && e2.value === savedE) { setError(null); return true; }
    const p = parseDateRange(s.value, e2.value);
    if (!p.ok) { setError(t(p.error)); return false; }
    setError(null);
    const [a, b] = p.value as [{ date: string } | null, { date: string } | null];
    if (onRange(a?.date ?? null, b?.date ?? null) === false) return false;
    s.reset(s.value);
    e2.reset(e2.value);
    return true;
  };
  const g = useGroupCommit(commit, onNext);
  const esc = (e: React.KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); s.reset(); e2.reset(); setError(null); } };
  return (
    <span ref={g.ref} role="group" aria-label={name} className="field-wrap date-range" onBlur={g.onBlur} onKeyDown={g.onKeyDown}>
      <input ref={inputRef} type="text" aria-label={t('panel.rangeStart', { name })} aria-description={desc} disabled={disabled} className={`pfield ${invalid ? 'invalid' : ''}`}
        value={s.value} aria-describedby={error ? errId : undefined} spellCheck={false} autoComplete="off" onChange={(e) => s.set(e.target.value)} onKeyDown={(e) => { if (!s.history(e)) esc(e); }} />
      <span className="range-sep" aria-hidden="true">–</span>
      <input type="text" aria-label={t('panel.rangeEnd', { name })} disabled={disabled} className="pfield" value={e2.value} spellCheck={false} autoComplete="off"
        aria-describedby={error ? errId : undefined} onChange={(e) => e2.set(e.target.value)} onKeyDown={(e) => { if (!e2.history(e)) esc(e); }} />
      {s.value === '' && e2.value === '' && !disabled && <EmptyMark />}
      {invalid && <WarnIcon />}
      <FieldError id={errId} text={error} />
    </span>
  );
}
