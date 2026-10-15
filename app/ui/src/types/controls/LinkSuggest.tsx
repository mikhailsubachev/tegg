// `[[` and `@` in text property fields (D-250, D-257, D-258; FR-EDT-06 AC-11; ms3-shell §15.5): the editor's
// `Link suggestions` list for a plain input or textarea. The typed `[[query` or `@query` before the caret is replaced
// by the link text the editor writes (`linkText`), and the field's own commit rules then apply (FR-EDT-07 AC-18).
// `Create "<query>"` makes the note with note_create and stays on this note (FR-EDT-06 AC-4).
import { useEffect, useRef, useState } from 'react';
import { DuplicateDetails } from '../../links/DuplicateDetails';
import { typeNameOf } from '../../links/icons';
import { linkText } from '@tegg/editor';
import { t } from '../../i18n/catalog';
import { ipc } from '../../ipc/client';
import type { SwitcherItemDto } from '../../ipc/types';
import { Icon, typeIconName } from '../../shell/Icon';
import { createObject } from '../create';

type Field = HTMLInputElement | HTMLTextAreaElement;
type Open = { from: number; to: number; query: string; items: SwitcherItemDto[]; sel: number };

/** The trigger before the caret: `[[query` anywhere, `@query` at a mention start (not inside a word). */
function triggerAt(before: string): { from: number; query: string; at: boolean } | null {
  const l = /\[\[([^[\]\n|]*)$/.exec(before);
  if (l) return { from: before.length - l[0].length, query: l[1], at: false };
  const a = /(?:^|[\s(])@([^\s@[\]][^@\n[\]]*|)$/.exec(before);
  if (a) return { from: before.length - a[1].length - 1, query: a[1], at: true };
  return null;
}

export function useLinkSuggest({ path, value, setValue, field }: {
  /** The note the link is written in (link_resolve, D-73). */
  path: string;
  value: string;
  setValue: (v: string) => void;
  field: React.MutableRefObject<Field | null>;
}) {
  const [open, setOpen] = useState<Open | null>(null);
  const dismissed = useRef<number | null>(null);
  const live = useRef(open);
  live.current = open;

  /** After every input or caret move: open, update or close the list. */
  const update = () => {
    const el = field.current;
    if (!el || el.selectionStart !== el.selectionEnd) { setOpen(null); return; }
    const caret = el.selectionStart ?? el.value.length;
    const tr = triggerAt(el.value.slice(0, caret));
    if (!tr || dismissed.current === tr.from) { setOpen(null); if (!tr) dismissed.current = null; return; }
    const cur = live.current;
    // D-258: a space typed when only the Create row is left closes the list; `@query` stays text.
    if (tr.at && tr.query.endsWith(' ') && cur && cur.from === tr.from && cur.items.length > 0 && cur.items.every((x) => x.kind === 'create')) {
      dismissed.current = tr.from;
      setOpen(null);
      return;
    }
    const q = tr.query;
    setOpen((o) => ({ from: tr.from, to: caret, query: q, items: o && o.from === tr.from ? o.items : [], sel: 0 }));
    void ipc.switcher(q, 20).then((items) => {
      setOpen((o) => (o && o.from === tr.from && o.query === q ? { ...o, items } : o));
    }, () => {});
  };

  const choose = async (item: SwitcherItemDto) => {
    const o = live.current;
    const el = field.current;
    if (!o || !el) return;
    setOpen(null);
    let target = item.path;
    const title = item.title.normalize('NFC');
    if (item.kind === 'create') {
      try { target = await createObject(item.type, title); } catch { return; }
    }
    if (!target) return;
    const stem = target.split('/').pop()!.replace(/\.md$/, '');
    const r = await ipc.linkResolve(path, [stem]).catch(() => []);
    const stemResolves = r[0]?.path?.normalize('NFC') === target.normalize('NFC');
    const link = `[[${linkText({ path: target, title, viaAlias: item.matched_alias ?? undefined, fromPath: path, stemResolves })}]]`;
    const next = value.slice(0, o.from) + link + value.slice(o.to);
    setValue(next);
    const at = o.from + link.length;
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(at, at); });
  };

  /** Keys while the list is open; true when handled (the field mustn't commit or revert then). */
  const onKeyDown = (e: React.KeyboardEvent): boolean => {
    const o = live.current;
    if (!o) return false;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const n = o.items.length;
      if (n) setOpen({ ...o, sel: (o.sel + (e.key === 'ArrowDown' ? 1 : n - 1)) % n });
      return true;
    }
    if (e.key === 'Enter' || e.key === 'Tab') {
      const it = o.items[o.sel];
      if (!it) return false;
      e.preventDefault();
      e.stopPropagation();
      void choose(it);
      return true;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      dismissed.current = o.from;
      setOpen(null);
      return true;
    }
    return false;
  };

  useEffect(() => { if (!value) dismissed.current = null; }, [value]);

  const list = open && (
    <div className="popover suggestions field-suggestions">
      <div role="listbox" aria-label={t('suggest.links')}>
        {open.items.map((it, i) => {
          const create = it.kind === 'create';
          const label = create ? t('suggest.create', { query: it.title }) : undefined;
          return (
            <div key={`${it.kind}:${it.path ?? it.title}`} role="option" aria-selected={i === open.sel} aria-label={label}
              className={`option ${i === open.sel ? 'selected' : ''}`} onMouseDown={(e) => e.preventDefault()} onClick={() => void choose(it)}>
              {create ? <span>{label}</span> : (
                <>
                  <Icon name={typeIconName(it.type)} />
                  <span data-user-content>{it.title}</span>
                  {it.matched_alias && <span className="alias" data-user-content>{it.matched_alias}</span>}
                  {it.duplicate && <DuplicateDetails details={it.duplicate} typeName={typeNameOf(it.type)} />}
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
  return { update, onKeyDown, list, open: !!open, close: () => setOpen(null) };
}
