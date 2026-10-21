import { useEffect, useRef, useState } from 'react';
import { DuplicateDetails } from './links/DuplicateDetails';
import { typeNameOf } from './links/icons';
import { ipc } from './ipc/client';
import type { SwitcherItemDto } from './ipc/types';
import { TypeIcon } from './icons';
import { t } from './i18n/catalog';
import { prepareObject, type Prepared } from './types/create';
import { Icon } from './shell/Icon';
import { TypeMenu } from './shell/TypeMenu';

/** FR-NAV-01: ⌘O quick switcher. Keyboard only: ↑/↓, ⏎, Esc (AC-11, FR-UX-03). */
export function Switcher({ onOpen, onCreate, onClose }: {
  onOpen: (path: string) => void;
  onCreate: (item: SwitcherItemDto, prepared?: Prepared | null) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState('');
  const [items, setItems] = useState<SwitcherItemDto[]>([]);
  const [sel, setSel] = useState(0);
  /** FR-VLT-05 AC-3 (D-550): the create row whose type the `Type` menu is choosing. */
  const [asType, setAsType] = useState<{ item: SwitcherItemDto; at: { left: number; top: number } } | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const seq = useRef(0);
  const pointer = useRef<{ x: number; y: number } | null>(null);
  // The create item's type, read once (type_get, type_template), so creating sends note_create at once (D-232).
  const prepared = useRef<{ key: string; p: Prepared | null } | null>(null);

  useEffect(() => input.current?.focus(), []);
  useEffect(() => {
    const n = ++seq.current;
    ipc.switcher(q, 30).then((r) => {
      if (n === seq.current) {
        // `Create "<q>" as…` below the create row (FR-VLT-05 AC-3).
        const out: SwitcherItemDto[] = [];
        for (const x of r) { out.push(x); if (x.kind === 'create') out.push({ ...x, kind: 'create-as' }); }
        setItems(out);
        setSel(0);
        const c = r.find((x) => x.kind === 'create');
        if (c && prepared.current?.key !== c.type) {
          const slot = { key: c.type, p: null as Prepared | null };
          prepared.current = slot;
          prepareObject(c.type).then((p) => { slot.p = p; }, () => {});
        }
      }
    }, () => {});
  }, [q]);

  const openAs = (i: SwitcherItemDto) => {
    const r = document.querySelector('.switcher')?.getBoundingClientRect();
    setAsType({ item: i, at: { left: (r?.left ?? 100) + 40, top: (r?.top ?? 100) + 60 } });
  };
  const choose = (i: SwitcherItemDto | undefined) => {
    if (!i) return;
    if (i.kind === 'create-as') return openAs(i);
    if (i.kind === 'create') onCreate(i, prepared.current?.key === i.type ? prepared.current.p : null);
    else if (i.path) {
      void ipc.perfMark('switcher-enter').catch(() => {}); // NFR-PERF-05 AC-2 (ms3-shell §11.5)
      onOpen(i.path);
    }
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSel((s) => Math.min(s + 1, items.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSel((s) => Math.max(s - 1, 0));
    } else if (e.key === 'Enter' && e.altKey && items[sel]?.kind === 'create') {
      e.preventDefault();
      openAs(items[sel]);
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
      <div className="switcher" role="dialog" aria-label={t('switcher.label')} onMouseDown={(e) => e.stopPropagation()}>
        <input
          ref={input}
          aria-label={t('switcher.query')}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          placeholder={t('switcher.placeholder')}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={onKey}
        />
        <ul role="listbox" aria-label={t('switcher.results')}>
          {items.map((i, n) => (
            <li
              key={i.path ?? `${i.kind}:${i.title}`}
              role="option"
              aria-label={i.kind === 'create' ? t('switcher.create', { title: i.title }) : i.kind === 'create-as' ? t('create.as', { query: i.title }) : undefined}
              aria-selected={n === sel}
              className={n === sel ? 'selected' : ''}
              onMouseMove={(e) => {
                // A resting pointer never changes the selection: WebKit sends mouse moves when the list appears under it.
                const p = pointer.current;
                pointer.current = { x: e.clientX, y: e.clientY };
                if (p && (p.x !== e.clientX || p.y !== e.clientY) && n !== sel) setSel(n);
              }}
              onClick={() => choose(i)}
            >
              {i.kind === 'create' || i.kind === 'create-as' ? <span className="icon" aria-hidden="true"><Icon name="plus" size={14} /></span> : <span className="icon" aria-hidden="true"><TypeIcon type={i.type} /></span>}
              {i.kind === 'create-as' ? <span className="title">{t('create.as', { query: '\u0000' }).split('\u0000')[0]}<span data-user-content>{i.title}</span>{t('create.as', { query: '\u0000' }).split('\u0000')[1]}</span>
                : <span className="title">{i.kind === 'create' ? t('switcher.create', { title: '\u0000' }).split('\u0000')[0] : null}<span data-user-content>{i.title}</span>{i.kind === 'create' ? t('switcher.create', { title: '\u0000' }).split('\u0000')[1] : null}</span>}
              {i.matched_alias && <span className="alias" data-user-content>{i.matched_alias}</span>}
              {i.kind === 'create-as' ? null : i.duplicate ? <DuplicateDetails details={i.duplicate} typeName={typeNameOf(i.type)} /> : <span className="folder" data-user-content>{i.folder}</span>}
            </li>
          ))}
        </ul>
      </div>
      {asType && (
        <TypeMenu at={asType.at} onClose={() => { setAsType(null); input.current?.focus(); }}
          onChoose={(ty) => { const it = asType.item; setAsType(null); onCreate({ ...it, kind: 'create', type: ty.key, folder: ty.folder }, null); }} />
      )}
    </div>
  );
}
