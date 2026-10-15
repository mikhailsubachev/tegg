// The relation picker (FR-EDT-07 AC-6, D-243): the dialog `Choose <Name>` with the switcher's matching (FR-NAV-01)
// limited to the allowed types, without the chosen objects (templates and `.trash/` are never offered by the index).
// The last row `Create "<query>"` creates an object of the first allowed type (or the default type) through the one
// creation path (D-232) and links it without leaving the note. The link text follows editor.md FR-EDT-06 AC-3 (D-184).
import { useEffect, useRef, useState } from 'react';
import { DuplicateDetails } from '../links/DuplicateDetails';
import { linkText } from '@tegg/editor';
import { t } from '../i18n/catalog';
import { ipc } from '../ipc/client';
import type { SwitcherItemDto, TypeDto } from '../ipc/types';
import { Icon, typeIconName } from '../shell/Icon';
import { prepareObject, type Prepared } from './create';
import { nfc } from './util';

export type Picked = { path: string; text: string };

/** The wikilink text for an object chosen from `from` (D-184). */
export async function linkFor(from: string, path: string, title: string, alias?: string | null): Promise<string> {
  const stem = path.split('/').pop()!.replace(/\.md$/, '');
  const r = await ipc.linkResolve(from, [stem]).catch(() => []);
  const stemResolves = nfc(r[0]?.path ?? '') === nfc(path);
  return linkText({ path, title, viaAlias: alias ?? undefined, fromPath: from, stemResolves });
}

export function RelationPicker({ name, to, exclude, from, types, onPick, onClose }: {
  name: string;
  /** Allowed type keys; null = any type. */
  to: string[] | null;
  /** Paths already chosen (and the note itself). */
  exclude: string[];
  from: string;
  types: TypeDto[];
  onPick: (p: Picked) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState('');
  const [items, setItems] = useState<SwitcherItemDto[]>([]);
  const [sel, setSel] = useState(0);
  const input = useRef<HTMLInputElement | null>(null);
  const busy = useRef(false);
  // The create row's type is read when the picker opens, so `Create` sends note_create at once (D-243, D-232).
  const prepared = useRef<Promise<Prepared> | null>(null);
  const ready = useRef<Prepared | null>(null);
  useEffect(() => {
    input.current?.focus();
    const keyOf = async () => (to && to.length ? to[0] : (await ipc.switcher('?', 0).catch(() => [])).find((i) => i.kind === 'create')?.type ?? 'page');
    prepared.current = keyOf().then(prepareObject);
    prepared.current.then((p) => { ready.current = p; }, () => {});
  }, []);
  useEffect(() => {
    let live = true;
    ipc.switcher(q, 50).then((r) => {
      if (!live) return;
      const allowed = to && to.length ? new Set(to.map(nfc)) : null;
      const ex = new Set(exclude.map(nfc));
      setItems(r.filter((i) => i.kind === 'object' && i.path && !ex.has(nfc(i.path)) && (!allowed || allowed.has(nfc(i.type)))));
      setSel(0);
    }, () => live && setItems([]));
    return () => { live = false; };
  }, [q]);
  const query = q.normalize('NFC').trim();
  const rows: (SwitcherItemDto | 'create')[] = [...items, ...(query ? ['create' as const] : [])];
  const titles = new Map<string, number>();
  for (const it of items) titles.set(it.title, (titles.get(it.title) ?? 0) + 1);

  const choose = async (row: SwitcherItemDto | 'create') => {
    if (busy.current) return;
    busy.current = true;
    try {
      if (row === 'create') {
        const p = ready.current ?? (await prepared.current!);
        const path = await p.create(query);
        onPick({ path, text: await linkFor(from, path, query) });
      } else if (row.path) {
        onPick({ path: row.path, text: await linkFor(from, row.path, row.title, row.matched_alias) });
      }
    } catch { /* nothing chosen */ } finally {
      busy.current = false;
    }
  };

  return (
    <div className="overlay" onMouseDown={onClose}>
      <div role="dialog" aria-modal="true" aria-label={t('picker.title', { name })} className="dialog relation-picker" onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); }
          else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); e.stopPropagation(); setSel((s) => (s + (e.key === 'ArrowDown' ? 1 : -1) + rows.length) % Math.max(1, rows.length)); }
          else if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); if (rows[sel]) void choose(rows[sel]); }
        }}>
        <h2 data-user-content>{t('picker.title', { name })}</h2>
        <input ref={input} type="text" role="combobox" aria-label={t('picker.search')} aria-expanded="true" aria-controls="picker-results" aria-autocomplete="list"
          value={q} spellCheck={false} autoComplete="off" autoCorrect="off" autoCapitalize="off" onChange={(e) => setQ(e.target.value)} />
        <div id="picker-results" role="listbox" aria-label={t('picker.results')} className="picker-results">
          {rows.map((it, i) => {
            if (it === 'create') {
              const label = t('picker.create', { query });
              return (
                <div key="create" role="option" aria-selected={i === sel} aria-label={label} className={`option ${i === sel ? 'selected' : ''}`}
                  onMouseDown={(e) => e.preventDefault()} onMouseEnter={() => setSel(i)} onClick={() => void choose(it)}>
                  <Icon name="plus" size={14} />
                  <span>{label}</span>
                </div>
              );
            }
            const typeName = types.find((x) => nfc(x.key) === nfc(it.type))?.name ?? it.type;
            return (
              <div key={it.path ?? it.title} role="option" aria-selected={i === sel} className={`option ${i === sel ? 'selected' : ''}`}
                onMouseDown={(e) => e.preventDefault()} onMouseEnter={() => setSel(i)} onClick={() => void choose(it)}>
                <Icon name={typeIconName(it.type, types.find((x) => nfc(x.key) === nfc(it.type))?.icon)} size={14} />
                <span data-user-content>{it.title}</span>
                {it.matched_alias && <span className="meta" data-user-content>{it.matched_alias}</span>}
                {it.duplicate ? <DuplicateDetails details={it.duplicate} typeName={typeName} /> : <span className="meta" data-user-content>{typeName}</span>}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
