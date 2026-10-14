// Shared pieces of the R10 value controls (FR-EDT-07 AC-4, AC-10; ms3-shell §14.7.3): the field state with its own
// text undo (⌘Z inside an open field is the field's undo, D-240), the field error (`role="alert"`), the `Empty`
// placeholder (muted, focusable) and the warning icon of invalid values (D-231).
import { useEffect, useId, useRef, useState } from 'react';
import { t } from '../../i18n/catalog';
import { Icon } from '../../shell/Icon';

export type { Value } from '@tegg/doc';

/** A text field's state: the typed text, reset to `saved` when that changes while the field isn't being edited. */
export function useField(saved: string) {
  const [value, setValueState] = useState(saved);
  const editing = useRef(false);
  const undo = useRef<string[]>([]);
  const redo = useRef<string[]>([]);
  const live = useRef(value);
  live.current = value;
  useEffect(() => {
    if (!editing.current) { setValueState(saved); undo.current = []; redo.current = []; }
  }, [saved]);
  const set = (v: string) => {
    if (v === live.current) return;
    undo.current.push(live.current);
    redo.current = [];
    editing.current = true;
    setValueState(v);
  };
  /** Back to the saved value (Esc), or after a commit: the field follows `saved` again. */
  const reset = (to: string = saved) => { editing.current = false; undo.current = []; redo.current = []; setValueState(to); };
  /** ⌘Z / ⇧⌘Z inside the field (true when handled). */
  const history = (e: React.KeyboardEvent): boolean => {
    if (!e.metaKey || (e.key !== 'z' && e.key !== 'Z')) return false;
    e.preventDefault();
    e.stopPropagation();
    const from = e.shiftKey ? redo.current : undo.current;
    const to = e.shiftKey ? undo.current : redo.current;
    const prev = from.pop();
    if (prev !== undefined) { to.push(live.current); editing.current = true; setValueState(prev); }
    return true;
  };
  return { value, set, reset, history, editing };
}

export function FieldError({ id, text }: { id: string; text: string | null }) {
  if (!text) return null;
  return <span id={id} role="alert" className="field-error">{text}</span>;
}

export function WarnIcon() {
  return <span className="warn-icon"><Icon name="warning" size={13} /></span>;
}

/** The `Empty` placeholder over an empty control (FR-EDT-07 AC-1): muted, focusable, focuses the control on click. */
export function EmptyMark({ onActivate }: { onActivate?: () => void }) {
  return (
    <span className="empty-mark" tabIndex={-1} onMouseDown={(e) => { e.preventDefault(); onActivate?.(); }}>
      {t('panel.empty')}
    </span>
  );
}

export function useErrorId() {
  return `err-${useId().replace(/:/g, '')}`;
}

/** Joins accessible-description parts (attribute description, Required, validity, read-only), skipping empties. */
export function joinDesc(...parts: (string | null | undefined | false)[]): string | undefined {
  const s = parts.filter((p): p is string => !!p && p.trim() !== '').join(' ');
  return s || undefined;
}
