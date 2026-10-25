// Date, Date-time and Date range (R10, FR-FMT-11, D-230). Since D-763 (date-picker.md R89) a date is a button with the
// calendar icon and the date in the region format, or `No date`; it opens the app's date picker (`Pick date`), where it
// can also be typed. Dates never shift with the time zone. A date-time is that date and a time field in the machine's
// zone, written with that moment's offset; a time that doesn't exist is refused. A date range is one row with two date
// buttons, committed together once both are set (FR-TYP-02 AC-3).
import { useRef, useState } from 'react';
import { parseDateRange, parseDateTime } from '@tegg/schema';
import { t } from '../../i18n/catalog';
import { PickDate } from '../../dates/PickDate';
import { localDate } from '../../zone';
import { Icon } from '../../shell/Icon';
import { dateText, dateTimeParts, rawText } from '../util';
import { FieldError, WarnIcon, useErrorId, useField, type Value } from './common';

const isYmd = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);

/** The opener of R89: the calendar icon and the date, or a faint `No date`; its name is `<name>: <date or No date>`. */
function DateButton({ name, label, desc, shown, value, invalid, disabled, onPick, onClear, btnRef }: {
  name: string;
  /** The button's accessible name prefix (the attribute's name, or a range half's). */
  label: string;
  desc?: string;
  /** The text shown: the date in the region format, or the raw invalid value; empty for none. */
  shown: string;
  value: string | null;
  invalid?: boolean;
  disabled?: boolean;
  onPick: (ymd: string) => void;
  onClear: () => void;
  btnRef?: (el: HTMLElement | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement | null>(null);
  const text = shown || t('capture.noDate');
  const back = () => { setOpen(false); btn.current?.focus(); };
  return (
    <>
      <button ref={(e) => { btn.current = e; btnRef?.(e); }} type="button" data-command="panel.date.open" className={`date-button${shown ? '' : ' empty'}${invalid ? ' invalid' : ''}`}
        aria-label={`${label}: ${text}`} aria-description={desc} aria-haspopup="dialog" aria-expanded={open} disabled={disabled} data-name={name}
        onClick={() => setOpen((o) => !o)}>
        <Icon name="calendar" size={13} />
        <span data-user-content={shown ? '' : undefined}>{text}</span>
      </button>
      {open && (
        <PickDate label={t('date.pick')} today={localDate(Date.now())} value={value} anchor={btn.current}
          onPick={(d) => { back(); onPick(d); }} onClear={() => { back(); onClear(); }} onClose={back} />
      )}
    </>
  );
}

export function DateControl({ name, desc, raw, invalid, disabled, onValue, inputRef }: {
  name: string;
  desc?: string;
  raw: unknown;
  invalid?: boolean;
  disabled?: boolean;
  onValue: (v: Value) => boolean | void;
  onNext?: () => void;
  inputRef?: (el: HTMLElement | null) => void;
}) {
  const value = isYmd(raw) ? raw : null;
  return (
    <span className="field-wrap date-field">
      <DateButton name={name} label={name} desc={desc} shown={value ? dateText(value) : rawText(raw)} value={value} invalid={invalid} disabled={disabled} btnRef={inputRef}
        onPick={(d) => onValue({ date: d })} onClear={() => onValue(null)} />
      {invalid && <WarnIcon />}
    </span>
  );
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
  const savedT = parts ? parts.time : '';
  const tm = useField(savedT);
  const [error, setError] = useState<string | null>(null);
  const errId = useErrorId();
  /** Writes `ymd` with the time field's text (00:00 when empty); a time that doesn't parse or exist is refused. */
  const write = (ymd: string, time: string): boolean => {
    const p = parseDateTime(ymd, time.trim() === '' ? '00:00' : time);
    if (!p.ok) { setError(t(p.error)); return false; }
    setError(null);
    if (onValue(p.value) === false) return false;
    tm.reset(time);
    return true;
  };
  const commitTime = (): boolean => {
    if (!tm.editing.current || tm.value === savedT) { setError(null); return true; }
    if (!parts) { setError(t('value.notDate')); return false; }
    return write(parts.ymd, tm.value);
  };
  return (
    <span role="group" aria-label={name} aria-description={desc} className="field-wrap date-time">
      <DateButton name={name} label={t('panel.dateField', { name })} shown={parts ? parts.date : rawText(raw)} value={parts?.ymd ?? null} invalid={invalid} disabled={disabled} btnRef={inputRef}
        onPick={(d) => { write(d, tm.value); }} onClear={() => { setError(null); if (onValue(null) !== false) tm.reset(''); }} />
      <input type="text" aria-label={t('panel.timeField', { name })} disabled={disabled} className="pfield time" value={tm.value} spellCheck={false} autoComplete="off"
        aria-describedby={error ? errId : undefined} onChange={(e) => tm.set(e.target.value)} onBlur={() => commitTime()}
        onKeyDown={(e) => {
          if (tm.history(e)) return;
          if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); tm.reset(); setError(null); }
          else if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); if (commitTime()) onNext?.(); }
        }} />
      {invalid && <WarnIcon />}
      <FieldError id={errId} text={error} />
    </span>
  );
}

export function DateRangeControl({ name, desc, raw, invalid, disabled, onRange, inputRef }: {
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
  const savedS = isYmd(r.start) ? r.start : null, savedE = isYmd(r.end) ? r.end : null;
  // A half chosen while the other is still empty waits here; both are written together (D-230).
  const [pending, setPending] = useState<{ start: string | null; end: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const errId = useErrorId();
  const cur = pending ?? { start: savedS, end: savedE };
  const set = (half: 'start' | 'end', d: string | null) => {
    const next = { ...cur, [half]: d };
    if ((next.start === null) !== (next.end === null)) { setError(null); setPending(next); return; }
    const p = parseDateRange(next.start ?? '', next.end ?? '');
    if (!p.ok) { setError(t(p.error)); setPending(next); return; }
    setError(null);
    if (onRange(next.start, next.end) !== false) setPending(null);
  };
  const shown = (v: string | null, rawV: unknown) => (v ? dateText(v) : rawText(rawV));
  return (
    <span role="group" aria-label={name} aria-description={desc} className="field-wrap date-range">
      <DateButton name={name} label={t('panel.rangeStart', { name })} shown={shown(cur.start, pending ? null : r.start)} value={cur.start} invalid={invalid} disabled={disabled} btnRef={inputRef}
        onPick={(d) => set('start', d)} onClear={() => set('start', null)} />
      <span className="range-sep" aria-hidden="true">–</span>
      <DateButton name={name} label={t('panel.rangeEnd', { name })} shown={shown(cur.end, pending ? null : r.end)} value={cur.end} invalid={invalid} disabled={disabled}
        onPick={(d) => set('end', d)} onClear={() => set('end', null)} />
      {invalid && <WarnIcon />}
      <FieldError id={errId} text={error ?? (pending && (pending.start === null) !== (pending.end === null) ? t('panel.rangeHalf') : null)} />
    </span>
  );
}
