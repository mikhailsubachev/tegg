import { useEffect, useRef, useState } from 'react';
import { ipc } from './ipc/client';
import type { SwitcherItemDto } from './ipc/types';
import { typeIcon } from './icons';
import { t } from './strings';

/** FR-NAV-01: ⌘O quick switcher. Keyboard only: ↑/↓, ⏎, Esc (AC-11, FR-UX-03). */
export function Switcher({ onOpen, onCreate, onClose }: {
  onOpen: (path: string) => void;
  onCreate: (item: SwitcherItemDto) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState('');
  const [items, setItems] = useState<SwitcherItemDto[]>([]);
  const [sel, setSel] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const seq = useRef(0);

  useEffect(() => input.current?.focus(), []);
  useEffect(() => {
    const n = ++seq.current;
    ipc.switcher(q, 30).then((r) => {
      if (n === seq.current) {
        setItems(r);
        setSel(0);
      }
    }, () => {});
  }, [q]);

  const choose = (i: SwitcherItemDto | undefined) => {
    if (!i) return;
    if (i.kind === 'create') onCreate(i);
    else if (i.path) onOpen(i.path);
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSel((s) => Math.min(s + 1, items.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSel((s) => Math.max(s - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      choose(items[sel]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };

  return (
    <div className="overlay" onMouseDown={onClose}>
      <div className="switcher" role="dialog" aria-label={t.switcherLabel} onMouseDown={(e) => e.stopPropagation()}>
        <input
          ref={input}
          aria-label={t.switcherQuery}
          placeholder={t.switcherPlaceholder}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={onKey}
        />
        <ul role="listbox" aria-label={t.switcherLabel}>
          {items.map((i, n) => (
            <li
              key={i.path ?? `create:${i.title}`}
              role="option"
              aria-selected={n === sel}
              className={n === sel ? 'selected' : ''}
              onMouseEnter={() => setSel(n)}
              onClick={() => choose(i)}
            >
              <span className="icon">{i.kind === 'create' ? '+' : typeIcon(i.type)}</span>
              <span className="title">{i.kind === 'create' ? t.create(i.title) : i.title}</span>
              {i.matched_alias && <span className="alias">{t.alias(i.matched_alias)}</span>}
              <span className="folder">{i.folder}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
