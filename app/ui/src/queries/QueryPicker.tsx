// Slice Q (queries.md R144; board QueryBlock C; v1-queries §4.2 `QueryPicker.tsx`): `Choose a query` at the caret (from
// `/query`, the `+` handle's Query item, `Insert query`) and from a block's `Choose a query…`: a searchbox `Find a
// query…`, `New query` first, then every readable saved query by title (D-122). ⏎ chooses, Esc cancels.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { t } from '../i18n/catalog';
import { collator } from '../i18n/collate';
import { Icon } from '../shell/Icon';
import { refreshQueries, useQueries } from './store';

export type PickerRequest = {
  /** Where the popover sits (the caret); null: centred under the title bar. */
  at: { left: number; top: number } | null;
  /** `New query` is offered (not for a block's `Choose a query…`). */
  withNew?: boolean;
  /** The chosen query's name, or null for `New query`. */
  onChoose: (name: string | null) => void;
  onCancel: () => void;
};

let current: PickerRequest | null = null;
let seq = 0;
const subs = new Set<(r: { req: PickerRequest | null; seq: number }) => void>();
export function openQueryPicker(r: PickerRequest | null) { current = r; seq++; for (const f of subs) f({ req: r, seq }); }
export function queryPickerOpen(): boolean { return current !== null; }

const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().normalize('NFC');

export function QueryPicker() {
  const [s, setS] = useState({ req: current, seq });
  useEffect(() => { subs.add(setS); setS({ req: current, seq }); return () => { subs.delete(setS); }; }, []);
  if (!s.req) return null;
  return <PickerDialog key={s.seq} req={s.req} />;
}

function PickerDialog({ req }: { req: PickerRequest }) {
  const list = useQueries();
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const withNew = req.withNew !== false;
  useEffect(() => { void refreshQueries(); }, []);
  const items = useMemo(() => {
    const coll = collator();
    const readable = (list ?? []).filter((x) => x.state !== 'unreadable').sort((a, b) => coll.compare(a.title, b.title) || (a.name < b.name ? -1 : 1));
    const f = fold(q.trim());
    return f ? readable.filter((x) => fold(x.title).includes(f) || fold(x.name).includes(f)) : readable;
  }, [list, q]);
  const rows: ({ kind: 'new' } | { kind: 'query'; name: string; title: string })[] = [
    ...(withNew ? [{ kind: 'new' as const }] : []),
    ...items.map((x) => ({ kind: 'query' as const, name: x.name, title: x.title })),
  ];
  // Typing moves the choice to the first matching query (⏎ then picks it, R144).
  useEffect(() => { setSel(q.trim() && withNew && items.length ? 1 : 0); }, [q, items.length, withNew]);
  useLayoutEffect(() => { input.current?.focus(); }, []);
  const close = (choose: number | null) => {
    openQueryPicker(null);
    if (choose === null) { req.onCancel(); return; }
    const r = rows[choose];
    if (!r) { req.onCancel(); return; }
    req.onChoose(r.kind === 'new' ? null : r.name);
  };
  useEffect(() => {
    const outside = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) close(null); };
    document.addEventListener('mousedown', outside, true);
    return () => document.removeEventListener('mousedown', outside, true);
  });
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const n = rows.length;
      if (n) setSel((s) => (e.key === 'ArrowDown' ? (s + 1) % n : (s - 1 + n) % n));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      close(sel);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close(null);
    } else if (e.key === 'Tab') e.preventDefault();
  };
  const at = req.at ?? { left: Math.max(16, window.innerWidth / 2 - 160), top: 96 };
  const left = Math.min(at.left, window.innerWidth - 340);
  const top = Math.min(at.top, window.innerHeight - 320);
  return (
    <div ref={box} role="dialog" aria-label={t('query.picker.title')} className="popover query-picker" style={{ left, top }} onKeyDown={onKey}>
      <input ref={input} type="search" className="query-picker-find" aria-label={t('queries.find')} placeholder={t('queries.find')} value={q}
        role="searchbox" aria-controls="query-picker-list" aria-activedescendant={rows.length ? `query-picker-${sel}` : undefined}
        onChange={(e) => setQ(e.target.value)} />
      <div role="listbox" id="query-picker-list" aria-label={t('query.picker.title')} className="query-picker-list">
        {rows.map((r, i) => (
          <div key={r.kind === 'new' ? '\u0000new' : r.name} id={`query-picker-${i}`} role="option" aria-selected={i === sel}
            className={`option ${i === sel ? 'selected' : ''} ${r.kind === 'new' ? 'query-picker-new' : ''}`}
            onMouseDown={(e) => e.preventDefault()} onMouseMove={() => i !== sel && setSel(i)} onClick={() => close(i)}>
            <span className="query-picker-icon" aria-hidden="true"><Icon name={r.kind === 'new' ? 'plus' : 'query'} size={13} /></span>
            {r.kind === 'new' ? <span>{t('query.picker.new')}</span> : <span data-user-content>{r.title}</span>}
          </div>
        ))}
      </div>
    </div>
  );
}
