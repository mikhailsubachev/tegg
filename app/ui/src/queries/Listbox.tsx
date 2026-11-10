// Slice Q (R142): the editor's pop-up choosers. A combobox (or a button with `aria-haspopup="listbox"`) keeps the focus
// while its listbox is open: typing filters, ↑/↓ move, ⏎ picks, Esc closes only the list (FR-UX-03 AC-42).
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';

export type ListOption = { id: string; label: string; userNamed?: boolean; extra?: string; group?: string };
export type ListGroup = { label: string; userNamed?: boolean };

const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().normalize('NFC');
let uid = 0;

export function Chooser({ role = 'combobox', label, display, faint, options, groups, current, onPick, onQuery, filterHint, className, describedBy, disabled }: {
  role?: 'combobox' | 'button';
  label: string;
  /** The visible text of the control. */
  display: ReactNode;
  /** Draw the visible text muted (a placeholder). */
  faint?: boolean;
  /** The options for a filter text (filtered here unless `onQuery` takes the text). */
  options: ListOption[];
  groups?: Record<string, ListGroup>;
  current?: string | null;
  onPick: (id: string) => void;
  /** Async options: called with the typed text; the caller passes the matching `options`. */
  onQuery?: (q: string) => void;
  /** Shown above the list (`Find attribute…`) while nothing is typed. */
  filterHint?: string;
  className?: string;
  describedBy?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const ref = useRef<HTMLElement | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const id = useRef(`qe-lb-${++uid}`).current;
  const shown = onQuery || !q ? options : options.filter((o) => fold(o.label).includes(fold(q)) || (o.extra ? fold(o.extra).includes(fold(q)) : false));
  useLayoutEffect(() => {
    if (!open || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    const below = window.innerHeight - r.bottom;
    setPos(below < 240 && r.top > below ? { left: r.left, top: Math.max(8, r.top - 2 - Math.min(320, r.top - 8)) } : { left: r.left, top: r.bottom + 2 });
  }, [open]);
  const show = () => {
    if (disabled) return;
    setQ('');
    onQuery?.('');
    const i = options.findIndex((o) => o.id === current);
    setActive(i >= 0 ? i : 0);
    setOpen(true);
  };
  const pick = (i: number) => {
    const o = shown[i];
    setOpen(false);
    setQ('');
    if (o) onPick(o.id);
  };
  useEffect(() => { if (open && q) setActive(0); }, [q]);
  useEffect(() => { if (active >= shown.length && shown.length) setActive(0); }, [shown.length]);
  const onKey = (e: React.KeyboardEvent) => {
    if (!open) {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') { e.preventDefault(); e.stopPropagation(); show(); }
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      e.stopPropagation();
      const n = shown.length;
      if (n) setActive((a) => (e.key === 'ArrowDown' ? (a + 1) % n : (a - 1 + n) % n));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      pick(active);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
    } else if (e.key === 'Tab') {
      setOpen(false);
    } else if (e.key === 'Backspace') {
      e.preventDefault();
      e.stopPropagation();
      const next = q.slice(0, -1);
      setQ(next);
      onQuery?.(next);
    } else if (e.key.length === 1 && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      e.stopPropagation();
      const next = q + e.key;
      setQ(next);
      onQuery?.(next);
    }
  };
  useEffect(() => {
    if (!open) return;
    const outside = (e: MouseEvent) => {
      const tg = e.target as Node;
      if (ref.current?.contains(tg) || document.getElementById(id)?.contains(tg)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', outside, true);
    return () => document.removeEventListener('mousedown', outside, true);
  }, [open]);
  const common = {
    'aria-label': label,
    'aria-haspopup': 'listbox' as const,
    'aria-expanded': open,
    'aria-controls': open ? id : undefined,
    'aria-describedby': describedBy,
    onKeyDown: onKey,
    onClick: () => (open ? setOpen(false) : show()),
  };
  // Options in display order, with the group headers.
  let lastGroup: string | undefined;
  const body: ReactNode[] = [];
  let bucket: ReactNode[] = [];
  const flush = () => {
    if (!bucket.length) return;
    const g = lastGroup !== undefined && groups ? groups[lastGroup] : undefined;
    body.push(g
      ? <div key={`g${body.length}`} role="group" aria-label={g.label} className="qe-lb-group"><div className="qe-lb-head" aria-hidden="true" data-user-content={g.userNamed ? '' : undefined}>{g.label}</div>{bucket}</div>
      : <div key={`g${body.length}`} role="presentation">{bucket}</div>);
    bucket = [];
  };
  shown.forEach((o, i) => {
    if (o.group !== lastGroup) { flush(); lastGroup = o.group; }
    bucket.push(
      <div key={o.id} id={`${id}-${i}`} role="option" aria-selected={i === active} className={`option ${i === active ? 'selected' : ''}`}
        onMouseDown={(e) => e.preventDefault()} onMouseMove={() => i !== active && setActive(i)} onClick={() => pick(i)}>
        <span data-user-content={o.userNamed ? '' : undefined}>{o.label}</span>
        {o.extra && <span className="meta" data-user-content>{o.extra}</span>}
      </div>,
    );
  });
  flush();
  return (
    <>
      {role === 'combobox' ? (
        <div ref={(e) => { ref.current = e; }} role="combobox" tabIndex={disabled ? -1 : 0} aria-disabled={disabled || undefined}
          aria-activedescendant={open && shown.length ? `${id}-${active}` : undefined}
          className={`qe-combo ${faint ? 'faint' : ''} ${className ?? ''}`} {...common}>
          <span className="qe-combo-text">{display}</span>
          <svg className="qe-caret" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
        </div>
      ) : (
        <button ref={(e) => { ref.current = e; }} tabIndex={0} type="button" className={className ?? 'qe-add'} {...common}>{display}</button>
      )}
      {open && pos && (
        <div id={id} role="listbox" aria-label={label} className="popover qe-listbox" style={{ left: pos.left, top: pos.top, maxHeight: Math.max(120, Math.min(340, window.innerHeight - pos.top - 8)) }}>
          {(q || filterHint) && <div className="qe-lb-find" aria-hidden="true">{q || filterHint}</div>}
          {body}
        </div>
      )}
    </>
  );
}
