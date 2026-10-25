import { useEffect, useImperativeHandle, useRef, useState } from 'react';
import { DuplicateDetails } from './links/DuplicateDetails';
import { typeNameOf } from './links/icons';
import { ipc } from './ipc/client';
import type { SwitcherItemDto } from './ipc/types';
import { TypeIcon } from './icons';
import { t } from './i18n/catalog';
import { prepareObject, type Prepared } from './types/create';
import { Icon } from './shell/Icon';
import { TypeMenu } from './shell/TypeMenu';

/** At most this many `Go to` rows (D-760). */
const ROWS = 8;

export type GoToKeys = { onKey: (e: React.KeyboardEvent) => boolean };

/** FR-NAV-01 on the Search page (D-760, search-navigation AC-15…AC-18): the core's switcher answer for the query as a
 *  `Go to` listbox. The caret stays in the Search field, which hands its keys to `keys.onKey`: ↑/↓ move, ⏎ opens,
 *  ⌥⏎ on the create row chooses its type (FR-VLT-05 AC-3). */
export function GoTo({ q, keys, onActive, onOpen, onCreate, onRefocus }: {
  q: string;
  keys: React.Ref<GoToKeys>;
  /** The selected option's element id, for the field's `aria-activedescendant`. */
  onActive: (id: string | undefined) => void;
  onOpen: (path: string) => void;
  onCreate: (item: SwitcherItemDto, prepared?: Prepared | null) => void;
  /** Called when the Type menu closes without a choice. */
  onRefocus: () => void;
}) {
  const [items, setItems] = useState<SwitcherItemDto[]>([]);
  const [sel, setSel] = useState(0);
  const [asType, setAsType] = useState<{ item: SwitcherItemDto; at: { left: number; top: number } } | null>(null);
  const list = useRef<HTMLUListElement>(null);
  const seq = useRef(0);
  const pointer = useRef<{ x: number; y: number } | null>(null);
  // The create item's type, read once (type_get, type_template), so creating sends note_create at once (D-232).
  const prepared = useRef<{ key: string; p: Prepared | null } | null>(null);
  const empty = !q.trim();

  useEffect(() => {
    const n = ++seq.current;
    if (empty) { setItems([]); return; }
    ipc.switcher(q, ROWS).then((r) => {
      if (n !== seq.current) return;
      // `Create "<q>" as…` below the create row (FR-VLT-05 AC-3); found objects give way to keep both create rows.
      const out: SwitcherItemDto[] = [];
      for (const x of r) { out.push(x); if (x.kind === 'create') out.push({ ...x, kind: 'create-as' }); }
      for (let k = out.length - 1; out.length > ROWS && k >= 0; k--) if (out[k].kind !== 'create' && out[k].kind !== 'create-as') out.splice(k, 1);
      setItems(out);
      setSel(0);
      const c = r.find((x) => x.kind === 'create');
      if (c && prepared.current?.key !== c.type) {
        const slot = { key: c.type, p: null as Prepared | null };
        prepared.current = slot;
        prepareObject(c.type).then((p) => { slot.p = p; }, () => {});
      }
    }, () => {});
  }, [q]);

  const openAs = (i: SwitcherItemDto) => {
    const r = list.current?.getBoundingClientRect();
    setAsType({ item: i, at: { left: (r?.left ?? 100) + 40, top: (r?.top ?? 100) + 20 } });
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
  const shown = empty ? [] : items;

  useImperativeHandle(keys, () => ({
    onKey: (e) => {
      if (!shown.length) return false;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        const d = e.key === 'ArrowDown' ? 1 : -1;
        setSel((s) => (s + d + shown.length) % shown.length);
      } else if (e.key === 'Enter' && e.altKey && shown[sel]?.kind === 'create') openAs(shown[sel]);
      else if (e.key === 'Enter') choose(shown[sel]);
      else return false;
      e.preventDefault();
      return true;
    },
  }), [shown, sel]);

  useEffect(() => onActive(shown.length ? `goto-${Math.min(sel, shown.length - 1)}` : undefined), [shown, sel]);

  if (!shown.length) return null;
  return (
    <>
      <h2 className="search-section">{t('goto.heading')}</h2>
      <ul ref={list} id="goto-list" role="listbox" aria-label={t('goto.label')} className="goto">
        {shown.map((i, n) => (
          <li
            key={i.path ?? `${i.kind}:${i.title}`}
            id={`goto-${n}`}
            role="option"
            aria-label={i.kind === 'create' ? t('switcher.create', { title: i.title }) : i.kind === 'create-as' ? t('create.as', { query: i.title }) : undefined}
            aria-selected={n === sel}
            className={n === sel ? 'selected' : ''}
            onMouseDown={(e) => e.preventDefault()}
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
            {i.matched_alias && <span className="alias">{t('switcher.alias', { alias: '\u0000' }).split('\u0000')[0]}<span data-user-content>{i.matched_alias}</span>{t('switcher.alias', { alias: '\u0000' }).split('\u0000')[1]}</span>}
            {i.kind === 'create-as' ? null : i.duplicate ? <DuplicateDetails details={i.duplicate} typeName={typeNameOf(i.type)} /> : <span className="folder" data-user-content>{i.folder}</span>}
          </li>
        ))}
      </ul>
      {asType && (
        <TypeMenu at={asType.at} onClose={() => { setAsType(null); onRefocus(); }}
          onChoose={(ty) => { const it = asType.item; setAsType(null); onCreate({ ...it, kind: 'create', type: ty.key, folder: ty.folder }, null); }} />
      )}
    </>
  );
}
