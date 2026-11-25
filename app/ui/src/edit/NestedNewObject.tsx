// `+` in a nested editor (an editable full embed or a Task card's body; new-object-menu.md R235, FR-EDT-03 AC-16;
// D-2626): the same menu as the note's editor, where the New rows work and write the link into the embedded note;
// the other rows need the note itself (`Not available in an embedded note`, as conversion there, D-494). The menu and
// the `New <type>` dialog are drawn over the page; while either is open the nested editor doesn't save (D-2631).
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { TeggEditor } from '@tegg/editor';
import { pushAlert } from '../convert/alerts';
import { t } from '../i18n/catalog';
import { ipc } from '../ipc/client';
import type { TypeDefDto } from '../ipc/types';
import { createObject } from '../types/create';
import { NewObjectDialog } from './NewObjectDialog';
import { firstRow, menuRows, plusOpens, type MenuRow } from './slashMenu';
import { SlashMenu, type Slash } from './SlashMenuView';

type Open = { type: TypeDefDto; from: number; to: number; text: string; at: { left: number; top: number } };

export function NestedNewObject({ editor, path, open }: {
  editor: () => TeggEditor | null;
  /** The embedded note's vault path (the links are resolved from it). */
  path: string;
  /** Set while the menu or the dialog is open: the nested editor's saver waits. */
  open: { current: boolean };
}) {
  const [slash, setSlash] = useState<(Slash & { at: { left: number; top: number } }) | null>(null);
  const [dialog, setDialog] = useState<Open | null>(null);
  const [types, setTypes] = useState<TypeDefDto[]>([]);
  const dismissed = useRef<number | null>(null);
  const live = useRef({ slash, dialog, types });
  live.current = { slash, dialog, types };
  // QA (D-2631): the saver also waits from a successful create until the link is in.
  const inserting = useRef(false);
  open.current = !!slash || !!dialog || inserting.current;
  const rows = (q: string): MenuRow[] => menuRows({ types: live.current.types, query: q, trigger: '+' });

  useEffect(() => {
    const ed = editor();
    if (!ed) return;
    const check = () => {
      if (live.current.dialog) return;
      const state = ed.view.state;
      const sel = state.selection;
      const $f = sel.$from;
      const inCode = !!$f.parent.type.spec.code;
      const before = sel.empty && $f.parent.isTextblock ? $f.parent.textBetween(0, $f.parentOffset, undefined, '￼') : '';
      const m = !inCode && sel.empty && $f.parent.type.name !== 'calloutTitle' ? /\+([^\s+￼]*)$/.exec(before) : null;
      const ok = m && plusOpens(before.slice(0, m.index)) && !state.doc.resolve($f.pos - m[1].length).marks().some((k) => k.type.name === 'code' || k.type.name === 'link');
      if (!ok || !m) {
        if (live.current.slash) setSlash(null);
        dismissed.current = null;
        return;
      }
      const from = $f.pos - m[1].length - 1;
      if (dismissed.current === from) return;
      const cur = live.current.slash;
      if (cur && cur.from === from && cur.query === m[1]) return;
      const c = ed.view.coordsAtPos(from);
      const at = { left: c.left, top: c.bottom + 4 };
      if (!cur) void ipc.vaultTypes().then(setTypes, () => {});
      setSlash({ from, query: m[1], sel: firstRow(rows(m[1]), '+', m[1]), trigger: '+', at });
    };
    const key = (e: KeyboardEvent) => {
      const s = live.current.slash;
      if (!s) return;
      const items = rows(s.query);
      const stop = () => { e.preventDefault(); e.stopPropagation(); };
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        stop();
        if (items.length) setSlash({ ...s, sel: (s.sel + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length });
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        if (!items.length) { dismissed.current = s.from; setSlash(null); return; } // R235: the key does its own thing
        stop();
        const pick = items[Math.min(s.sel, items.length - 1)];
        if (pick && !pick.disabled && pick.group === 'newObject') choose(pick);
      } else if (e.key === 'Escape') {
        stop();
        dismissed.current = s.from;
        setSlash(null);
      }
    };
    ed.editor.on('transaction', check);
    // On the editor's parent, in the capture phase: before ProseMirror's own key handling.
    const dom = ((ed.view.dom as HTMLElement).parentElement ?? ed.view.dom) as HTMLElement;
    dom.addEventListener('keydown', key, true);
    return () => {
      ed.editor.off('transaction', check);
      dom.removeEventListener('keydown', key, true);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const choose = (row: MenuRow) => {
    const ed = editor();
    const s = live.current.slash;
    if (!ed || !s || row.group !== 'newObject') return;
    const ty = live.current.types.find((x) => x.key === row.type);
    if (!ty) return;
    const to = ed.view.state.selection.from;
    dismissed.current = s.from;
    setSlash(null);
    setDialog({ type: ty, from: s.from, to, text: ed.view.state.doc.textBetween(s.from, to, '\n', '￼'), at: s.at });
  };
  const range = (d: Open, ed: TeggEditor): [number, number] | null => {
    const doc = ed.view.state.doc;
    return d.to <= doc.content.size && doc.textBetween(d.from, d.to, '\n', '￼') === d.text ? [d.from, d.to] : null;
  };
  const cancel = () => {
    const ed = editor();
    const d = dialog;
    setDialog(null);
    open.current = false;
    if (!ed || !d) return;
    const r = range(d, ed);
    if (r) {
      ed.view.dispatch(ed.view.state.tr.delete(r[0], r[1]).setMeta('addToHistory', false));
      ed.editor.commands.setTextSelection(r[0]);
    }
    ed.view.focus();
  };
  const create = async (title: string) => {
    const ed = editor();
    const d = dialog;
    if (!ed || !d) return;
    let made: string;
    try {
      made = await createObject(d.type.key, title);
    } catch {
      setDialog(null);
      open.current = false;
      pushAlert(t('newObject.failed', { title }));
      ed.view.focus();
      return;
    }
    inserting.current = true;
    setDialog(null);
    const stem = made.split('/').pop()!.replace(/\.md$/, '');
    const res = await ipc.linkResolve(path, [stem]).catch(() => []);
    const stemResolves = res[0]?.path?.normalize('NFC') === made.normalize('NFC');
    const r = range(d, ed);
    try {
      if (r) ed.commands.insertObjectLink(r[0], r[1], { path: made, title, fromPath: path, stemResolves });
    } finally {
      inserting.current = false;
      open.current = false;
    }
    ed.view.focus();
  };

  return createPortal(
    <>
      {slash && (
        <SlashMenu slash={slash} rows={rows(slash.query)} pos={slash.at} fixed
          unavailable={(r) => (r.group === 'newObject' ? null : t('menu.notInEmbed'))}
          onPick={choose} onSel={(i) => setSlash({ ...slash, sel: i })} />
      )}
      {dialog && (
        <NewObjectDialog key={`${dialog.from}:${dialog.type.key}`} type={dialog.type} at={dialog.at} fixed
          onCreate={(title) => void create(title)} onCancel={cancel} />
      )}
    </>,
    document.body,
  );
}
