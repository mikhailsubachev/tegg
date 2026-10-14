// Text, Long text, Number, URL and Email (R10). The typed text is committed with ⏎ (single line; ⌘↩ for Long text),
// Tab or leaving the field (FR-EDT-07 AC-4); Esc reverts to the saved value and keeps the focus (AC-10). The input is
// parsed with @tegg/schema (D-230); a refused value shows its catalog message and writes nothing (AC-5).
import { useRef, useState } from 'react';
import { parseEmail, parseNumber, parseUrl, type Parsed } from '@tegg/schema';
import { t } from '../../i18n/catalog';
import { locale, rawText } from '../util';
import { EmptyMark, FieldError, WarnIcon, useErrorId, useField, type Value } from './common';

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

export function TextControl({ kind, name, desc, raw, invalid, disabled, onValue, onNext, inputRef, describedBy }: {
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
    onBlur: () => { setFocused(false); commit(); },
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => f.set(e.target.value),
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
        if (commit() && single) onNext?.();
      }
    },
  };
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
