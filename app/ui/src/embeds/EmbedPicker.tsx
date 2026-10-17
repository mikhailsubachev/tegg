// The `Embed object` picker (FR-EMB-01 AC-5…AC-8, D-426; R30): the switcher's matching (FR-NAV-01), templates and
// `.trash/` never listed, duplicate titles with their details line (D-289), and `Create "<query>"` (D-106) through the
// one creation path, without navigating. Returns the D-184 embed target of the choice.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { embedTarget } from '@tegg/editor';
import { t } from '../i18n/catalog';
import { ipc } from '../ipc/client';
import type { SwitcherItemDto, TypeDefDto } from '../ipc/types';
import { DuplicateDetails } from '../links/DuplicateDetails';
import { Icon, typeIconName } from '../shell/Icon';
import { createObject } from '../types/create';

export function EmbedPicker({ from, types, at, onChoose, onCancel }: {
  /** The note the embed goes into (D-184's target is relative to it). */
  from: string;
  types: TypeDefDto[];
  at: { left: number; top: number };
  onChoose: (target: string) => void;
  onCancel: () => void;
}) {
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<SwitcherItemDto[]>([]);
  const [sel, setSel] = useState(0);
  const input = useRef<HTMLInputElement | null>(null);
  const busy = useRef(false);
  const listId = useRef(`embed-suggestions-${Math.random().toString(36).slice(2)}`);

  useLayoutEffect(() => { input.current?.focus(); }, []);
  useEffect(() => {
    let live = true;
    void ipc.switcher(query, 20).then((found) => {
      if (!live) return;
      // The Create row is last (first when nothing else matches); none for an empty query.
      const objects = found.filter((x) => x.kind !== 'create' && x.path && !/^(_templates|\.trash)\//.test(x.path));
      const create = found.find((x) => x.kind === 'create');
      setItems(query.trim() && create ? [...objects, create] : objects);
      setSel(0);
    }, () => {});
    return () => { live = false; };
  }, [query]);

  const choose = async (it: SwitcherItemDto | undefined) => {
    if (!it || busy.current) return;
    busy.current = true;
    try {
      let path = it.path;
      let title = it.title.normalize('NFC');
      if (it.kind === 'create') {
        title = query.trim().normalize('NFC');
        path = await createObject(it.type, title);
      }
      if (!path) return;
      const stem = path.split('/').pop()!.replace(/\.md$/, '');
      const r = await ipc.linkResolve(from, [stem]).catch(() => []);
      const stemResolves = r[0]?.path?.normalize('NFC') === path.normalize('NFC');
      onChoose(embedTarget({ path, title, fromPath: from, stemResolves }));
    } catch {
      /* nothing inserted */
    } finally {
      busy.current = false;
    }
  };

  const onKey = (e: React.KeyboardEvent) => {
    const stop = () => { e.preventDefault(); e.stopPropagation(); };
    if (e.key === 'ArrowDown') { stop(); setSel((s) => Math.min(items.length - 1, s + 1)); }
    else if (e.key === 'ArrowUp') { stop(); setSel((s) => Math.max(0, s - 1)); }
    else if (e.key === 'Enter' || e.key === 'Tab') { stop(); void choose(items[sel]); }
    else if (e.key === 'Escape') { stop(); onCancel(); }
  };

  return (
    <div className="popover embed-picker" style={{ position: 'fixed', left: at.left, top: at.top }} onMouseDown={(e) => { if (e.target !== input.current) e.preventDefault(); }}>
      <input
        ref={input}
        role="combobox"
        aria-label={t('embed.picker')}
        aria-expanded="true"
        aria-controls={listId.current}
        aria-autocomplete="list"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={onKey}
        onBlur={() => setTimeout(() => { if (!document.activeElement?.closest('.embed-picker')) onCancel(); }, 0)}
      />
      <div role="listbox" id={listId.current} aria-label={t('embed.suggestions')}>
        {items.map((it, i) => {
          const create = it.kind === 'create';
          const typeName = types.find((x) => x.key === it.type)?.name ?? it.type;
          return (
            <div key={`${it.kind}:${it.path ?? it.title}`} role="option" aria-selected={i === sel}
              className={`option ${i === sel ? 'selected' : ''}`}
              onMouseMove={() => i !== sel && setSel(i)} onClick={() => void choose(it)}>
              {create ? <div>{t('suggest.create', { query: query.trim() })}</div> : (
                <>
                  <div className="option-title"><Icon name={typeIconName(it.type)} /> <span data-user-content>{it.title}</span></div>
                  {it.duplicate ? <div className="meta"><DuplicateDetails details={it.duplicate} typeName={typeName} /></div>
                    : it.matched_alias ? <div className="meta alias" data-user-content>{it.matched_alias}</div> : null}
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
