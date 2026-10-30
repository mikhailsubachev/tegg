// The `Link` menu of a chip and the `Edit link` dialog (FR-LNK-13 AC-5, AC-6; D-927; v1-previews §5.3). One of each per
// window, opened by the editor (and the read view's chips, which get `Open` and `Show preview` only), rendered by the
// preview provider. Every text is a catalog string (R107).
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { t } from '../i18n/catalog';
import { ipc } from '../ipc/client';
import type { SwitcherItemDto } from '../ipc/types';
import { DuplicateDetails } from '../links/DuplicateDetails';
import { chipIcon, typeNameOf } from '../links/icons';
import { Icon } from '../shell/Icon';
import { PopupMenu, type MenuEntry } from '../shell/Menu';
import { close as closePreview, getCurrent } from './store';

export type LinkMenuReq = {
  anchor: HTMLElement;
  target: string;
  /** Unresolved (or only in the trash): `Create "<target>"` instead of `Open` and `Show preview`. */
  broken: boolean;
  open?: () => void;
  preview?: () => void;
  /** Present in an editable note only. */
  edit?: () => void;
  remove?: () => void;
  create?: () => void;
  /** Where the focus goes when the menu closes without a choice (the caret after the chip). */
  restore: () => void;
};
export type EditLinkReq = {
  anchor: HTMLElement | null;
  /** The note the link is in (D-184: the written target resolves from it). */
  from: string;
  target: string;
  alias: string | null;
  /** False when nothing was written (the editor turned read-only, or the target or text can't be written, FR-FMT-07):
   *  the dialog stays open. */
  apply: (target: string, alias: string | null) => boolean;
  restore: () => void;
};

type State = { menu: LinkMenuReq | null; edit: EditLinkReq | null };
let state: State = { menu: null, edit: null };
const subs = new Set<() => void>();
const set = (s: Partial<State>) => { state = { ...state, ...s }; for (const f of subs) f(); };
const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };

/** One popup at a time (D-924): a menu or the dialog closes an open preview. */
export function showLinkMenu(req: LinkMenuReq): void {
  if (getCurrent()) closePreview('outside');
  set({ menu: req, edit: null });
}
export function showEditLink(req: EditLinkReq): void {
  if (getCurrent()) closePreview('outside');
  set({ edit: req, menu: null });
}

const key = (k: string) => <kbd className="menu-key" data-shortcut="" aria-hidden="true">{k}</kbd>;

function LinkMenu({ req }: { req: LinkMenuReq }) {
  const done = (f?: () => void) => () => { set({ menu: null }); f?.(); };
  const entries: MenuEntry[] = [];
  if (req.broken) {
    if (req.create) entries.push({ kind: 'item', key: 'create', label: t('createLink.create', { target: req.target }), content: t('createLink.create', { target: req.target }), onChoose: done(req.create) });
  } else {
    entries.push({ kind: 'item', key: 'open', label: t('link.menu.open'), content: <>{t('link.menu.open')}{key('⌘↩')}</>, onChoose: done(req.open) });
    entries.push({ kind: 'item', key: 'preview', label: t('link.menu.preview'), content: <>{t('link.menu.preview')}{key('⌥Space')}</>, onChoose: done(req.preview) });
  }
  if (req.edit || req.remove) {
    if (entries.length) entries.push({ kind: 'separator' });
    if (req.edit) entries.push({ kind: 'item', key: 'edit', label: t('link.menu.edit'), content: t('link.menu.edit'), onChoose: done(req.edit) });
    if (req.remove) entries.push({ kind: 'item', key: 'remove', label: t('link.menu.remove'), content: t('link.menu.remove'), onChoose: done(req.remove) });
  }
  return <PopupMenu label={t('menu.link')} anchor={req.anchor} entries={entries} onClose={() => { set({ menu: null }); req.restore(); }} restoreFocus={false} />;
}

function EditLink({ req }: { req: EditLinkReq }) {
  const [to, setTo] = useState(req.target);
  const [text, setText] = useState(req.alias ?? '');
  const [items, setItems] = useState<SwitcherItemDto[] | null>(null);
  const [sel, setSel] = useState(0);
  const box = useRef<HTMLDivElement | null>(null);
  const toField = useRef<HTMLInputElement | null>(null);
  const [pos, setPos] = useState({ left: 120, top: 120 });
  useLayoutEffect(() => {
    const r = req.anchor?.getBoundingClientRect();
    if (!r) return;
    const h = box.current?.offsetHeight ?? 160;
    const below = r.bottom + 6 + h <= window.innerHeight - 8;
    setPos({ left: Math.max(8, Math.min(r.left, window.innerWidth - 348)), top: below ? r.bottom + 6 : Math.max(8, r.top - 6 - h) });
  }, [req.anchor]);
  useEffect(() => { toField.current?.focus(); toField.current?.select(); }, []);
  const closeIt = (restore: boolean) => { set({ edit: null }); if (restore) req.restore(); };
  useEffect(() => {
    const outside = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) set({ edit: null }); };
    document.addEventListener('pointerdown', outside, true);
    return () => document.removeEventListener('pointerdown', outside, true);
  }, []);
  const query = (q: string) => {
    setTo(q);
    if (!q.trim()) { setItems(null); return; }
    void ipc.switcher(q, 20).then((r) => { setItems(r.filter((x) => x.kind !== 'create' && x.path)); setSel(0); }, () => setItems(null));
  };
  const choose = async (it: SwitcherItemDto) => {
    setItems(null);
    const path = it.path!;
    const stem = path.split('/').pop()!.replace(/\.md$/i, '');
    const r = await ipc.linkResolve(req.from, [stem]).catch(() => []);
    const stemResolves = r[0]?.path?.normalize('NFC') === path.normalize('NFC');
    // D-184: the file name when it resolves to that file from the note, else the vault path (no `.md`).
    const p = path.normalize('NFC').replace(/\.md$/i, '');
    setTo(stemResolves ? p.slice(p.lastIndexOf('/') + 1) : p);
    toField.current?.focus();
  };
  const apply = () => {
    const target = to.trim();
    if (!target) return;
    if (req.apply(target, text.trim() ? text.trim() : null)) closeIt(false);
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (items && items.length && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault();
      setSel((s) => (s + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length);
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      if (items) { setItems(null); return; }
      closeIt(true);
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      if (items && items.length && e.target === toField.current) { void choose(items[sel]); return; }
      apply();
    }
  };
  return (
    <div ref={box} role="dialog" aria-modal="false" aria-label={t('linkEdit.label')} className="popover edit-link" style={{ position: 'fixed', left: pos.left, top: pos.top }} onKeyDown={onKey}>
      <label className="field">
        <span>{t('linkEdit.target')}</span>
        <input ref={toField} type="text" role="combobox" aria-expanded={!!items && items.length > 0} aria-autocomplete="list" aria-label={t('linkEdit.target')}
          data-command="linkEdit.target" value={to} onChange={(e) => query(e.target.value)} />
      </label>
      {items && items.length > 0 && (
        <div className="suggestions">
          <div role="listbox" aria-label={t('suggest.links')}>
            {items.map((it, i) => (
              <div key={it.path ?? it.title} role="option" aria-selected={i === sel} className={`option ${i === sel ? 'selected' : ''}`}
                onMouseDown={(e) => e.preventDefault()} onClick={() => void choose(it)}>
                <Icon name={chipIcon(it.type).glyph} />
                <span data-user-content>{it.title}</span>
                {it.duplicate && <DuplicateDetails details={it.duplicate} typeName={typeNameOf(it.type)} />}
              </div>
            ))}
          </div>
        </div>
      )}
      <label className="field">
        <span>{t('linkEdit.text')}</span>
        <input type="text" aria-label={t('linkEdit.text')} data-command="linkEdit.text" value={text} onChange={(e) => setText(e.target.value)} />
      </label>
    </div>
  );
}

export function LinkUiHost() {
  const s = useSyncExternalStore(subscribe, () => state);
  return (
    <>
      {s.menu && <LinkMenu key="menu" req={s.menu} />}
      {s.edit && <EditLink key="edit" req={s.edit} />}
    </>
  );
}
