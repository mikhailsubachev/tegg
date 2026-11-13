// Slice I2 (docs/contracts/v1-import-window.md §3.6, §3.7): the Import window's menus (`<Source> becomes`, `<key>
// becomes`, a value's status, the kept spelling, the split target). As `PopupMenu` (shell/Menu.tsx): ↑/↓ move, ⏎ and
// Space choose, Esc closes and returns the focus to the button; besides it has labelled groups, a note line and a
// `rename…` item that turns into a field in place (⏎ commits a valid name, Esc restores it, the menu stays open).
import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Icon } from '../shell/Icon';
import { t } from '../i18n/catalog';

export type ImportMenuEntry =
  | { kind: 'note'; key: string; text: string }
  | { kind: 'radio'; key: string; text: string; checked: boolean; description?: string; label?: string; group?: string; onChoose: () => void }
  | { kind: 'rename'; key: string; field: string; value: string; valid: (name: string) => boolean; onCommit: (name: string) => void };

export function ImportMenu({ label, anchor, entries, onClose }: { label: string; anchor: HTMLElement | null; entries: ImportMenuEntry[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number }>({ left: 0, top: 0 });
  const [editing, setEditing] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [invalid, setInvalid] = useState(false);
  const field = useRef<HTMLInputElement>(null);

  useLayoutEffect(() => {
    if (!anchor) return;
    const r = anchor.getBoundingClientRect();
    const h = ref.current?.offsetHeight ?? 0;
    const top = r.bottom + 4 + h > window.innerHeight - 8 ? Math.max(8, r.top - 4 - h) : r.bottom + 4;
    setPos({ left: Math.min(r.left, Math.max(8, window.innerWidth - (ref.current?.offsetWidth ?? 280) - 8)), top });
  }, [anchor, entries.length]);

  const items = () => [...(ref.current?.querySelectorAll<HTMLElement>('[role="menuitem"], [role="menuitemradio"]') ?? [])];
  useEffect(() => {
    const list = items();
    (list.find((e) => e.getAttribute('aria-checked') === 'true') ?? list[0])?.focus();
    const outside = (e: MouseEvent) => {
      const tg = e.target as Node;
      if (ref.current?.contains(tg) || anchor?.contains(tg)) return;
      onClose();
    };
    // Esc closes the menu wherever the focus is (a field's own Esc aside), and goes no further.
    const esc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.target instanceof HTMLInputElement) return;
      e.preventDefault();
      e.stopPropagation();
      onClose();
      anchor?.focus();
    };
    document.addEventListener('mousedown', outside, true);
    window.addEventListener('keydown', esc, true);
    return () => { document.removeEventListener('mousedown', outside, true); window.removeEventListener('keydown', esc, true); };
  }, []);
  useEffect(() => { if (editing) field.current?.focus(); }, [editing]);

  const close = () => { onClose(); anchor?.focus(); };
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement) return;
    const list = items();
    const i = list.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (list.length) list[e.key === 'ArrowDown' ? (i + 1) % list.length : (i - 1 + list.length) % list.length].focus();
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      list[e.key === 'Home' ? 0 : list.length - 1]?.focus();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
    } else if (e.key === 'Tab') {
      e.preventDefault();
      e.stopPropagation();
    }
  };

  const renderEntry = (m: ImportMenuEntry) => {
    if (m.kind === 'note') return <div key={m.key} className="menu-note import-menu-note">{m.text}</div>;
    if (m.kind === 'rename') {
      if (editing === m.key) {
        const commit = () => {
          if (!m.valid(text)) { setInvalid(true); return; }
          setInvalid(false);
          setEditing(null);
          m.onCommit(text.trim());
          requestAnimationFrame(() => (ref.current?.querySelector<HTMLElement>(`[data-key="${m.key}"]`) ?? items()[0])?.focus());
        };
        return (
          <div key={m.key} className="import-rename">
            <input ref={field} type="text" aria-label={m.field} aria-invalid={invalid || undefined} value={text} spellCheck={false} autoComplete="off"
              onChange={(e) => { setText(e.target.value); setInvalid(false); }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); commit(); }
                else if (e.key === 'Escape') {
                  e.preventDefault();
                  e.stopPropagation();
                  setEditing(null);
                  setInvalid(false);
                  requestAnimationFrame(() => ref.current?.querySelector<HTMLElement>(`[data-key="${m.key}"]`)?.focus());
                } else if (e.key === 'Tab') { e.preventDefault(); e.stopPropagation(); }
              }} />
          </div>
        );
      }
      return (
        <div key={m.key} data-key={m.key} role="menuitem" tabIndex={-1} className="menu-item"
          onClick={() => { setText(m.value); setInvalid(false); setEditing(m.key); }}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); setText(m.value); setInvalid(false); setEditing(m.key); } }}>
          {t('import.types.rename')}
        </div>
      );
    }
    const choose = () => { m.onChoose(); onClose(); anchor?.focus(); };
    return (
      <div key={m.key} data-key={m.key} role="menuitemradio" aria-checked={m.checked} tabIndex={-1} aria-label={m.label} aria-description={m.description}
        className={`menu-item import-menu-item${m.checked ? ' checked' : ''}`} onClick={choose}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); choose(); } }}>
        <span className="import-check" aria-hidden="true">{m.checked && <Icon name="check" size={14} />}</span>
        <span className="import-menu-text">{m.text}</span>
        {m.description && <span className="import-menu-desc" aria-hidden="true">{m.description}</span>}
      </div>
    );
  };

  // Consecutive entries of one group are drawn inside one labelled `group`.
  const blocks: { group?: string; entries: ImportMenuEntry[] }[] = [];
  for (const e of entries) {
    const g = e.kind === 'radio' ? e.group : undefined;
    const last = blocks[blocks.length - 1];
    if (last && last.group === g && g !== undefined) last.entries.push(e);
    else blocks.push({ group: g, entries: [e] });
  }
  return (
    <div ref={ref} className="popup-menu import-menu" role="menu" aria-label={label} onKeyDown={onKeyDown} style={{ left: pos.left, top: pos.top }}>
      {blocks.map((b, i) => (b.group !== undefined ? (
        <div key={`g${i}`} role="group" aria-label={b.group} className="import-menu-group">
          <div className="import-menu-head" aria-hidden="true">{b.group}</div>
          {b.entries.map(renderEntry)}
        </div>
      ) : <Fragment key={`b${i}`}>{b.entries.map(renderEntry)}</Fragment>))}
    </div>
  );
}
