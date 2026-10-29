// The link chips of an editor (the note's and an embedded note's, FR-LNK-13 AC-8): their gestures map through
// `resolveRefInput` (R103; v1-previews §5.1) to the preview, the editor's own open or the Create offer; the right-click
// opens the `Link` menu (D-927); hover mode previews after the delay (D-942); the palette's `Show preview`, `Edit link`
// and `Remove link` act on the chip at the caret (R106).
import type { EditorUi, LinkGesture, TeggEditor } from '@tegg/editor';
import { chipPreviewTarget } from '../links/ChipParts';
import { registerEditorLinks } from './editorLink';
import { hoverLeave, hoverMove } from './hover';
import { ipc } from '../ipc/client';
import { resolveRefInput } from './input';
import { showEditLink, showLinkMenu } from './linkUi';
import { close, getCurrent, getPrefs, show, subscribe } from './store';
import { hintText } from './useReference';
import type { PreviewTarget } from './types';

type Chip = { pos: number; dom: HTMLElement | null };
export type EditorChipsHost = {
  editor(): TeggEditor | null;
  /** The note the editor shows (resolution and `Edit link` targets are relative to it, D-184). */
  path(): string;
  /** The editor's link resolution of a target, if known. */
  resolve(target: string): { kind: string; path?: string | null } | undefined;
  /** The editor's open of a chip as before slice P (D-140, FR-DLY-08 AC-6, R74), or its Create offer when broken. */
  open(target: string, fragment: string | null, chip?: Chip): void;
  /** The Create offer of a broken chip (FR-LNK-04 AC-4); absent where the editor has none. */
  offer?(target: string, chip: Chip): void;
  /** A tag chip's open (`tag/<key>`). */
  openTag(key: string): void;
  /** After `Edit link` changed a target (the chips resolve again). */
  relinked?(): void;
};

export function editorChips(h: EditorChipsHost): Pick<EditorUi, 'onLink' | 'onLinkHover' | 'onLinkMenu' | 'onTag' | 'linkHint'> & { register(dom: HTMLElement): () => void } {
  const target = (t: string, f: string | null): PreviewTarget | null => chipPreviewTarget(h.resolve(t.normalize('NFC')), t, f);
  const preview = (pt: PreviewTarget, chip: Chip, origin: 'click' | 'key', open: () => void) => {
    const dom = chip.dom ?? (h.editor()?.view.nodeDOM(chip.pos) as HTMLElement | null);
    if (!dom) return;
    // Esc puts the caret back: after the chip for a click (D-924), where it was for ⌥Space (FR-LNK-13 AC-3).
    const ed = h.editor();
    const track = origin === 'key' && ed ? ed.trackPos(ed.view.state.selection.from) : null;
    const back = () => {
      const e = h.editor();
      const at = track?.();
      if (!e) return;
      if (at === null || at === undefined) { e.focusAfterChip(chip.pos); return; }
      e.view.focus();
      e.editor.commands.setTextSelection(Math.min(at, e.view.state.doc.content.size));
    };
    show(pt, { el: dom }, origin, undefined, undefined, { open, returnFocus: back });
  };
  const gesture = (t: string, f: string | null, chip: Chip | undefined, g: LinkGesture) => {
    const pt = target(t, f);
    const r = h.resolve(t.normalize('NFC'));
    const action = resolveRefInput(getPrefs().mode, 'chip', g, pt === null);
    if (action === 'preview' && chip) preview(pt!, chip, g === 'click' ? 'click' : 'key', () => h.open(t, f, chip));
    else if (action === 'open') { if (getCurrent()) close('open'); h.open(t, f, chip); }
    else if (action === 'createOffer') {
      if (getCurrent()) close('open');
      if (r?.kind === 'trashed' || !h.offer) h.open(t, f, chip); // 6A (R74): a chip only in the trash opens the Trash
      else if (t && chip) h.offer(t, chip);
    }
  };
  const editDialog = (pos: number, dom: HTMLElement | null) => openEditLink(h, pos, dom);
  const remove = (pos: number) => { const e = h.editor(); if (!e || !canEdit(h, pos)) return; e.focusAfterChip(pos); e.commands.removeLink(); };
  const menu = (t: string, pos: number, dom: HTMLElement) => {
    const ed = h.editor();
    if (!ed) return;
    ed.focusAfterChip(pos);
    const f = ed.linkAt(pos)?.fragment ?? null;
    const pt = target(t, f);
    const chip = { pos, dom };
    showLinkMenu({
      anchor: dom, target: t, broken: pt === null,
      open: () => gesture(t, f, chip, 'modEnter'),
      preview: () => { if (pt) preview(pt, chip, 'key', () => h.open(t, f, chip)); },
      create: h.offer ? () => h.offer!(t, chip) : undefined,
      ...(canEdit(h, pos) ? { edit: () => editDialog(pos, dom), remove: () => remove(pos) } : {}),
      restore: () => h.editor()?.focusAfterChip(pos),
    });
  };
  return {
    linkHint: () => hintText(getPrefs().mode),
    onLink: (t, f, chip, g) => gesture(t, f, chip, g ?? 'click'),
    onLinkHover: (t, f, chip, phase) => {
      if (phase === 'leave') { hoverLeave(); return; }
      if (getPrefs().mode !== 'hover') return;
      const pt = target(t, f);
      if (pt) hoverMove(pt, chip.dom, false, () => h.open(t, f, chip));
    },
    onLinkMenu: (t, chip) => { menu(t ?? '', chip.pos, chip.dom); return true; },
    onTag: (v, chip, g) => {
      const key = v.normalize('NFC').toLowerCase();
      const action = resolveRefInput(getPrefs().mode, 'chip', g ?? 'click', false);
      if (action === 'preview' && chip?.dom) {
        show({ path: '', fragment: null, kind: 'tag', key }, { el: chip.dom }, g === 'altSpace' ? 'key' : 'click', undefined, undefined,
          { open: () => h.openTag(key), returnFocus: () => h.editor()?.view.focus() });
      } else if (action === 'open') { if (getCurrent()) close('open'); h.openTag(key); }
    },
    register(dom) {
      // The chip at the caret when the focus left the editor (for the palette): a focus given back with a plain
      // `focus()` can put the caret at the start before ProseMirror restores its own. It counts while the text is the
      // same and the reader hasn't moved the caret in the editor since.
      let kept: { doc: unknown; pos: number } | null = null;
      const chipNow = () => {
        const e = h.editor();
        if (!e) return null;
        const c = e.chipAtCaret();
        if (c) return c;
        if (!kept || kept.doc !== e.view.state.doc) return null;
        const l = e.linkAt(kept.pos);
        if (!l) return null;
        e.focusAfterChip(kept.pos);
        return { pos: kept.pos, target: l.target, fragment: l.fragment };
      };
      const onOut = () => { const e = h.editor(); const c = e?.chipAtCaret(); kept = e && c ? { doc: e.view.state.doc, pos: c.pos } : null; };
      const onMove = () => { kept = null; };
      dom.addEventListener('focusout', onOut);
      dom.addEventListener('pointerdown', onMove);
      dom.addEventListener('keydown', onMove);
      const reg = registerEditorLinks({
        atChip: () => !!chipNow(),
        preview: () => {
          const e = h.editor();
          const c = chipNow();
          if (!e || !c) return;
          const pt = target(c.target, c.fragment);
          const chip = { pos: c.pos, dom: e.view.nodeDOM(c.pos) as HTMLElement | null };
          if (pt) preview(pt, chip, 'key', () => h.open(c.target, c.fragment, chip));
        },
        edit: () => { const e = h.editor(); const c = chipNow(); if (e && c) editDialog(c.pos, e.view.nodeDOM(c.pos) as HTMLElement | null); },
        remove: () => { const c = chipNow(); if (c) remove(c.pos); },
        host: dom,
      });
      // An embedded note's editor sits inside the note's: the innermost editor with the focus is the one acted on.
      dom.setAttribute('data-link-host', '');
      const onFocus = (e: FocusEvent) => { if ((e.target as HTMLElement | null)?.closest?.('[data-link-host]') === dom) reg.focused(); };
      dom.addEventListener('focusin', onFocus);
      // The editor may already hold the focus when it registers (a note opened from the palette or `Go to`).
      const held = document.activeElement;
      if (held && dom.contains(held) && held.closest('[data-link-host]') === dom) reg.focused();
      // NFR-PERF-12 (v1-previews §8): a chip's pointerup starts the click-to-preview measurement, as `useReference`'s.
      const onUp = (e: PointerEvent) => {
        if (getPrefs().mode !== 'off' && (e.target as HTMLElement | null)?.closest?.('[data-link-kind]')) void ipc.perfMark('preview-click').catch(() => {});
      };
      dom.addEventListener('pointerup', onUp);
      // A mode change redraws the chips' descriptions (FR-LNK-12 AC-4).
      let mode = getPrefs().mode;
      const off = subscribe(() => { const m = getPrefs().mode; if (m !== mode) { mode = m; h.editor()?.refreshUi(); } });
      return () => {
        dom.removeEventListener('focusin', onFocus);
        dom.removeEventListener('pointerup', onUp);
        dom.removeEventListener('focusout', onOut);
        dom.removeEventListener('pointerdown', onMove);
        dom.removeEventListener('keydown', onMove);
        off();
        reg.dispose();
      };
    },
  };
}

/** `Edit link` and `Remove link` change the text: not while a type move or the merge dialog holds the note read-only
 *  (D-804, FR-SYN-03 AC-13), and not on an inline embed's chip (its `|link` is the mode word, not a link text). */
function canEdit(h: EditorChipsHost, pos: number): boolean {
  const e = h.editor();
  return !!e && e.editor.isEditable && !!e.linkAt(pos) && !e.view.state.doc.nodeAt(pos)?.attrs.embed;
}

/** ⇧⌘K with the caret at a chip opens `Edit link` (FR-LNK-13 AC-6); false when the caret isn't at one. At a chip it
 *  can't edit (see `canEdit`) the key does nothing. */
export function editLinkAtCaret(h: EditorChipsHost): boolean {
  const e = h.editor();
  const c = e?.chipAtCaret();
  if (!e || !c) return false;
  openEditLink(h, c.pos, e.view.nodeDOM(c.pos) as HTMLElement | null);
  return true;
}

/** `Edit link` on the chip at `pos` (FR-LNK-13 AC-6): one undo step, the caret after the chip again. */
function openEditLink(h: EditorChipsHost, pos: number, dom: HTMLElement | null) {
  const ed = h.editor();
  const l = ed?.linkAt(pos);
  if (!ed || !l || !canEdit(h, pos)) return;
  const track = ed.trackPos(pos);
  showEditLink({
    anchor: dom ?? (ed.view.nodeDOM(pos) as HTMLElement | null), from: h.path(), target: l.target, alias: l.alias,
    apply: (to, alias) => {
      const at = track();
      const e = h.editor();
      if (at === null || !e) return false;
      if (!e.editLink(at, { target: to, alias })) return false;
      e.focusAfterChip(at);
      h.relinked?.();
      return true;
    },
    restore: () => { const at = track(); if (at !== null) h.editor()?.focusAfterChip(at); else h.editor()?.view.focus(); },
  });
}
