// A popup menu opened from a button (D-219 vault switcher, D-220 logo menu; ms3-shell §12.5): arrow keys move,
// Enter/Space choose, Esc or a click outside closes it and returns focus to the opener.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';

export type MenuEntry =
  | { kind: 'separator' }
  | { kind: 'note'; key: string; content: React.ReactNode }
  | { kind: 'item' | 'radio' | 'checkbox'; key: string; content: React.ReactNode; label?: string; checked?: boolean; disabled?: boolean; description?: string; onChoose: () => void };

export function PopupMenu({ label, anchor, entries, onClose, placement = 'below', restoreFocus = true, disabledFocusable = false, scrollable = false }: {
  label: string;
  anchor: HTMLElement | null;
  entries: MenuEntry[];
  /** Called with whether focus should go back to the opener (always, except when a chosen item moves it). */
  onClose: () => void;
  placement?: 'below' | 'above';
  /** False: the caller puts the focus back itself in `onClose` (slice P's `Link` menu: the caret after the chip). */
  restoreFocus?: boolean;
  /** Arrow keys also stop on disabled items (WAI-ARIA; the type page's Columns menu, whose first item is Title). */
  disabledFocusable?: boolean;
  /** Capped at the window's height and scrolling (the type page's Columns menu, which has no limit, D-1240). */
  scrollable?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number }>({ left: 0, top: 0 });

  useLayoutEffect(() => {
    if (!anchor) return;
    const r = anchor.getBoundingClientRect();
    setPos(placement === 'below' ? { left: r.left, top: r.bottom + 4 } : { left: r.left, bottom: window.innerHeight - r.top + 4 });
  }, [anchor, placement]);

  const items = () => [...(ref.current?.querySelectorAll<HTMLElement>(disabledFocusable ? '[role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"]'
    : '[role="menuitem"]:not([aria-disabled="true"]), [role="menuitemradio"]:not([aria-disabled="true"]), [role="menuitemcheckbox"]:not([aria-disabled="true"])') ?? [])];

  useEffect(() => {
    // A radio menu opens on its checked item (the Search page's Type filter, FR-SRC-03 AC-17).
    const list = items();
    (list.find((e) => e.getAttribute('aria-checked') === 'true' && e.getAttribute('role') === 'menuitemradio') ?? list[0])?.focus();
    const outside = (e: MouseEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || anchor?.contains(t)) return;
      onClose();
      // After the click's own focus change.
      if (restoreFocus) setTimeout(() => anchor?.focus(), 0);
    };
    document.addEventListener('mousedown', outside, true);
    return () => document.removeEventListener('mousedown', outside, true);
  }, []);

  const onKeyDown = (e: React.KeyboardEvent) => {
    const list = items();
    const i = list.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const n = list.length;
      if (!n) return;
      list[e.key === 'ArrowDown' ? (i + 1) % n : (i - 1 + n) % n].focus();
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      list[e.key === 'Home' ? 0 : list.length - 1]?.focus();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onClose();
      if (restoreFocus) anchor?.focus();
    } else if (e.key === 'Tab') {
      e.preventDefault();
    }
  };

  return (
    // A scrollable menu taller than the window scrolls; focusing an item keeps it in view.
    <div ref={ref} className="popup-menu" role="menu" aria-label={label} onKeyDown={onKeyDown}
      style={{ left: pos.left, top: pos.top, bottom: pos.bottom, ...(scrollable ? { maxHeight: `calc(100vh - ${(pos.top ?? pos.bottom ?? 0) + 8}px)`, overflowY: 'auto' as const } : {}) }}>
      {entries.map((m, i) => {
        if (m.kind === 'separator') return <div key={`sep${i}`} role="separator" className="menu-sep" />;
        if (m.kind === 'note') return <div key={m.key} className="menu-note">{m.content}</div>;
        const choose = () => { if (!m.disabled) m.onChoose(); };
        return (
          <div
            key={m.key}
            role={m.kind === 'radio' ? 'menuitemradio' : m.kind === 'checkbox' ? 'menuitemcheckbox' : 'menuitem'}
            aria-checked={m.kind === 'radio' || m.kind === 'checkbox' ? !!m.checked : undefined}
            aria-disabled={m.disabled || undefined}
            aria-description={m.description}
            aria-label={m.label}
            tabIndex={-1}
            className={`menu-item${m.checked ? ' checked' : ''}`}
            onClick={choose}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(); } }}
          >
            {m.content}
          </div>
        );
      })}
    </div>
  );
}
