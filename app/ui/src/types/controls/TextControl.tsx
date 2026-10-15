// Text, Long text, Number, URL and Email (R10). The typed text is committed with ⏎ (single line; ⌘↩ for Long text),
// Tab or leaving the field (FR-EDT-07 AC-4); Esc reverts to the saved value and keeps the focus (AC-10). The input is
// parsed with @tegg/schema (D-230); a refused value shows its catalog message and writes nothing (AC-5).
import { useRef, useState } from 'react';
import { parseEmail, parseNumber, parseUrl, type Parsed } from '@tegg/schema';
import { t } from '../../i18n/catalog';
import { locale, rawText } from '../util';
import { EmptyMark, FieldError, WarnIcon, useErrorId, useField, type Value } from './common';
import { hasLinks, LinkedText, type LinkContext } from './LinkedText';

export type TextKind = 'text' | 'long-text' | 'number' | 'url' | 'email';

export function parseText(kind: TextKind, text: string): Parsed {
  const s = text.normalize('NFC');
  if (s.trim() === '') return { ok: true, value: null };
  switch (kind) {
    case 'number': return parseNumber(s, locale());
    case 'url': return parseUrl(s);
    case 'email': return parseEmail(s);
    default: return { ok: true, value: s };
  }
}

export function TextControl({ kind, name, desc, raw, invalid, disabled, onValue, onNext, inputRef, describedBy, linked }: {
  kind: TextKind;
  name: string;
  desc?: string;
  raw: unknown;
  invalid?: boolean;
  disabled?: boolean;
  /** Returns false when the value couldn't be applied (nothing changes then). */
  onValue: (v: Value) => boolean | void;
  onNext?: () => void;
  inputRef?: (el: HTMLElement | null) => void;
  describedBy?: string;
  /** Text and Long text: `[[links]]` show as chips out of edit mode (D-249, D-257). */
  linked?: LinkContext;
}) {
  const saved = rawText(raw);
  const f = useField(saved);
  const [error, setError] = useState<string | null>(null);
  const [focused, setFocused] = useState(false);
  const last = useRef<string | null>(null);
  const errId = useErrorId();
  const el = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);

  /** true: committed or nothing to do; false: refused. */
  const commit = (): boolean => {
    const text = f.value;
    if (!f.editing.current || text === saved || text === last.current) { setError(null); return true; }
    const p = parseText(kind, text);
    if (!p.ok) { setError(t(p.error)); return false; }
    setError(null);
    last.current = text;
    if (onValue(p.value) === false) return false;
    f.reset(text);
    return true;
  };
  const common = {
    ref: (e: HTMLInputElement | HTMLTextAreaElement | null) => { el.current = e; inputRef?.(e); },
    'aria-label': name,
    'aria-description': desc,
    'aria-describedby': error ? errId : describedBy,
    'aria-invalid': error ? true : undefined,
    disabled,
    value: f.value,
    className: `pfield ${invalid ? 'invalid' : ''}`,
    spellCheck: false,
    autoComplete: 'off',
    autoCorrect: 'off',
    autoCapitalize: 'off',
    onFocus: () => { setFocused(true); last.current = null; },
    onBlur: () => { setFocused(false); setOpen(false); commit(); },
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => f.set(e.target.value),
    // A single-line field gets pasted line breaks as spaces (FR-EDT-07 AC-5, D-256).
    onPaste: (e: React.ClipboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      const text = e.clipboardData.getData('text/plain');
      if (kind === 'long-text' || !/[\r\n]/.test(text)) return;
      e.preventDefault();
      const el2 = e.currentTarget;
      const a = el2.selectionStart ?? f.value.length, b = el2.selectionEnd ?? f.value.length;
      f.set(f.value.slice(0, a) + text.replace(/\s*\r?\n\s*/g, ' ') + f.value.slice(b));
    },
    onKeyDown: (e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      if (f.history(e)) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        f.reset();
        setError(null);
        return;
      }
      const single = kind !== 'long-text';
      if (e.key === 'Enter' && (single || e.metaKey) && !e.nativeEvent.isComposing) {
        e.preventDefault();
        e.stopPropagation();
        if (commit()) {
          if (single) onNext?.();
          else if (linked && hasLinks(f.value)) {
            // ⌘↩ in Long text leaves edit mode: the value shows its link chips, the focus stays on the field.
            setOpen(false);
            setFocused(false);
            stay.current = true;
          }
        }
      }
    },
  };
  const [open, setOpen] = useState(false);
  const display = useRef<HTMLElement | null>(null);
  const stay = useRef(false); // focus moved to the chips view after a commit: don't reopen
  const edit = () => { setOpen(true); requestAnimationFrame(() => el.current?.focus()); };
  if (linked && !open && !focused && !disabled && f.value === saved && hasLinks(saved)) {
    return (
      <span className="field-wrap">
        <span role="textbox" tabIndex={0} aria-label={name} aria-description={desc} aria-readonly="false" ref={(e) => { display.current = e; inputRef?.(e); if (e && stay.current) e.focus({ preventScroll: true }); }}
          aria-multiline={kind === 'long-text' ? 'true' : undefined} className={`pfield linked-text ${kind === 'long-text' ? 'multi' : ''}`}
          onFocus={() => { if (stay.current) { stay.current = false; return; } edit(); }} onClick={edit}
          onKeyDown={(e) => { if (e.key === 'Enter' || (e.key.length === 1 && !e.metaKey && !e.ctrlKey)) { e.preventDefault(); edit(); } }}>
          <LinkedText text={saved} ctx={linked} />
        </span>
        {invalid && <WarnIcon />}
      </span>
    );
  }
  return (
    <span className="field-wrap">
      {kind === 'long-text'
        ? <textarea {...common} aria-multiline="true" rows={Math.min(8, Math.max(1, f.value.split('\n').length))} />
        : <input {...common} type="text" inputMode={kind === 'number' ? 'decimal' : kind === 'url' ? 'url' : kind === 'email' ? 'email' : undefined} />}
      {f.value === '' && !focused && !disabled && <EmptyMark onActivate={() => el.current?.focus()} />}
      {invalid && f.value === saved && <WarnIcon />}
      <FieldError id={errId} text={error} />
    </span>
  );
}
