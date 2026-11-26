// Slice AND-3 (docs/contracts/android-edit.md §9.1; RA16, FR-EDT-01 AC-19, AC-20, FR-EDT-04 AC-5, FR-EDT-14 AC-8): the
// phone's keyboard input. Android keyboards send `keydown` 229 and `beforeinput` instead of key events, so Enter and
// Backspace come as `insertParagraph` / `deleteContentBackward`; they run the editor's own keymap, so the result is the
// desktop's. Text that arrives from the keyboard or a paste is stored in NFC. Installed on the phone only.
import type { TeggEditor } from '@tegg/editor';

// The app reaches ProseMirror only through @tegg/editor's view; these are the few shapes used here.
/* eslint-disable @typescript-eslint/no-explicit-any */
type EditorView = TeggEditor['view'];
type Transaction = any;
type PmNode = { isText: boolean; text?: string | null };

const KEY = 'teggPhoneNfc';
/** How long after an input event a transaction counts as typed (ms). */
const INPUT_WINDOW = 400;

type Observer = { flush?: () => void };

function flushDom(view: EditorView) {
  (view as unknown as { domObserver?: Observer }).domObserver?.flush?.();
}

/** The non-NFC text inside `from…to` of `tr.doc`, replaced by its NFC form; the caret stays after the inserted text. */
function normalizeRange(tr: Transaction, from: number, to: number): boolean {
  const edits: { from: number; to: number; text: string }[] = [];
  tr.doc.nodesBetween(from, to, (node: PmNode, pos: number) => {
    if (!node.isText || !node.text) return;
    const s = Math.max(from, pos), e = Math.min(to, pos + node.text.length);
    const part = node.text.slice(s - pos, e - pos);
    const n = part.normalize('NFC');
    if (n !== part) edits.push({ from: s, to: e, text: n });
  });
  if (!edits.length) return false;
  const head = tr.selection.head;
  let shift = 0;
  for (const ed of edits.reverse()) {
    const marks = tr.doc.resolve(ed.from + 1 <= ed.to ? ed.from + 1 : ed.from).marks();
    tr.replaceWith(ed.from, ed.to, tr.doc.type.schema.text(ed.text, marks));
    if (head >= ed.to) shift += ed.text.length - (ed.to - ed.from);
  }
  const at = Math.max(0, Math.min(head + shift, tr.doc.content.size));
  const Sel = tr.selection.constructor as { create?: (doc: unknown, pos: number) => unknown };
  if (tr.selection.empty && typeof Sel.create === 'function') {
    try { tr.setSelection(Sel.create(tr.doc, at)); } catch { /* not a text position: keep the mapped one */ }
  }
  return true;
}

export function installPhoneInput(ed: TeggEditor, o: { onImagePaste?: () => void } = {}): () => void {
  const view = ed.view;
  const dom = view.dom as HTMLElement;
  let lastInput = -Infinity;
  const typed = () => { lastInput = performance.now(); };

  // NFC (FR-EDT-01 AC-20): only the ranges a typed transaction inserted; other text keeps its bytes (FR-FMT-12 AC-5).
  // Run right after the typed transaction, so it joins the same undo step.
  const onTx = ({ transaction: t }: { transaction: Transaction }) => {
    if (!t.docChanged || t.getMeta(KEY) || t.getMeta('addToHistory') === false) return;
    if (view.composing || performance.now() - lastInput > INPUT_WINDOW) return;
    const ranges: [number, number][] = [];
    const maps = t.mapping.maps as any[];
    maps.forEach((m, i) => m.forEach((_os: number, _oe: number, ns: number, ne: number) => {
      let a = ns, b = ne;
      for (let j = i + 1; j < maps.length; j++) { a = maps[j].map(a, -1); b = maps[j].map(b, 1); }
      ranges.push([a, b]);
    }));
    queueMicrotask(() => {
      if (view.isDestroyed) return;
      const tr = view.state.tr;
      let changed = false;
      for (const [a, b] of ranges) {
        const from = Math.max(0, Math.min(a, tr.doc.content.size));
        const to = Math.max(from, Math.min(b, tr.doc.content.size));
        if (to > from && normalizeRange(tr, from, to)) changed = true;
      }
      if (changed) { tr.setMeta(KEY, true); view.dispatch(tr); }
    });
  };
  ed.editor.on('transaction', onTx);

  // A committed composition: normalise the caret's block once ProseMirror has read it.
  const compositionEnd = () => {
    typed();
    setTimeout(() => {
      if (view.composing) return;
      flushDom(view);
      const { $head } = view.state.selection;
      const tr = view.state.tr;
      // Always dispatched: the suggestion plugins look at the committed text again ([[, @, #, / inside a composition).
      normalizeRange(tr, $head.start(), $head.end());
      tr.setMeta(KEY, true);
      view.dispatch(tr);
    }, 0);
  };

  const atBlockStart = () => {
    const { empty, $from } = view.state.selection;
    void empty;
    return $from.parentOffset === 0;
  };
  const afterAtom = () => {
    const { empty, $from } = view.state.selection;
    if (!empty) return false;
    const before = $from.nodeBefore;
    return !!before && !before.isText && before.isAtom;
  };

  /** The desktop's key path for `key`: the editor host's handlers, then ProseMirror's keymaps (as a hardware key). */
  const runKey = (key: 'Enter' | 'Backspace', code: number) => {
    const ev = new KeyboardEvent('keydown', { key, code: key, bubbles: true, cancelable: true });
    Object.defineProperty(ev, 'keyCode', { get: () => code });
    Object.defineProperty(ev, 'which', { get: () => code });
    dom.dispatchEvent(ev);
    if (!ev.defaultPrevented) ed.editor.commands.keyboardShortcut(key);
  };

  // A Backspace or Enter keydown the editor already handled (its keymap prevented it) isn't run again by an input event
  // that follows it for the same key (a keyboard or WebView that sends both).
  let handledKey: { key: string; t: number } | null = null;
  const keydownAfter = (e: KeyboardEvent) => {
    handledKey = e.defaultPrevented && (e.key === 'Backspace' || e.key === 'Enter') ? { key: e.key, t: performance.now() } : null;
  };
  const beforeinput = (e: InputEvent) => {
    const type = e.inputType;
    const k = handledKey;
    handledKey = null;
    if (k && performance.now() - k.t < 100 && ((k.key === 'Backspace' && type === 'deleteContentBackward') || (k.key === 'Enter' && (type === 'insertParagraph' || type === 'insertLineBreak')))) {
      e.preventDefault();
      e.stopImmediatePropagation();
      return;
    }
    if (type === 'insertText' || type === 'insertReplacementText' || type === 'insertCompositionText' || type === 'insertFromPaste') typed();
    // Text the keyboard inserts outside a composition goes the way typed keys go (`handleTextInput`), so the input
    // rules (Markdown shortcuts, tags) apply as on the desktop (R7).
    if (type === 'insertText' && e.data && !view.composing && !e.isComposing) {
      const text = e.data;
      const { from, to } = view.state.selection;
      e.preventDefault();
      e.stopImmediatePropagation(); // ProseMirror would read the DOM change as well
      flushDom(view);
      const deflt = () => view.state.tr.insertText(text, from, to);
      const handled = (view as unknown as { someProp: (n: string, f: (h: (...a: unknown[]) => boolean) => boolean) => boolean })
        .someProp('handleTextInput', (h) => h(view, from, to, text, deflt));
      if (!handled) view.dispatch(deflt().scrollIntoView());
      return;
    }
    if (type === 'insertParagraph' || type === 'insertLineBreak') {
      e.preventDefault();
      e.stopImmediatePropagation(); // ProseMirror's Android fallback would run the key again
      flushDom(view);
      runKey('Enter', 13);
      return;
    }
    if (type === 'deleteContentBackward') {
      const { empty } = view.state.selection;
      if ((empty && (atBlockStart() || afterAtom())) || (!empty && atBlockStart())) {
        e.preventDefault();
        e.stopImmediatePropagation(); // ProseMirror's Android fallback would run the key again
        flushDom(view);
        runKey('Backspace', 8);
        return;
      }
      // A grapheme of several code units (an emoji with a skin tone, a flag) goes in one step, as on the desktop.
      const { $from } = view.state.selection;
      if (empty && !view.composing && typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
        const before = $from.parent.textBetween(0, $from.parentOffset, undefined, '￼');
        const segs = [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(before)];
        const last = segs[segs.length - 1]?.segment ?? '';
        if (last.length > 1 && last !== '￼') {
          e.preventDefault();
          e.stopImmediatePropagation(); // ProseMirror's Android fallback would run the key again
          view.dispatch(view.state.tr.delete($from.pos - last.length, $from.pos).scrollIntoView());
        }
      }
    }
  };

  // FR-EDT-14 AC-8: an image without text isn't added on the phone (yet); nothing is inserted or written.
  const paste = (e: ClipboardEvent) => {
    typed();
    const d = e.clipboardData;
    if (!d) return;
    const text = d.getData('text/plain');
    const image = [...d.items].some((i) => i.kind === 'file' && i.type.startsWith('image/')) || [...d.types].some((x) => x.startsWith('image/'));
    if (!text && image) {
      e.preventDefault();
      e.stopImmediatePropagation();
      o.onImagePaste?.();
    }
  };

  // Enter or Backspace right after a composition: ProseMirror reads the committed word first, so it isn't added twice.
  const keydown = (e: KeyboardEvent) => { if (e.key === 'Enter' || e.key === 'Backspace' || e.keyCode === 229) flushDom(view); };
  dom.addEventListener('keydown', keydown, true);
  dom.addEventListener('beforeinput', beforeinput, true);
  window.addEventListener('keydown', keydownAfter);
  dom.addEventListener('compositionend', compositionEnd);
  dom.addEventListener('paste', paste, true);
  return () => {
    dom.removeEventListener('keydown', keydown, true);
    dom.removeEventListener('beforeinput', beforeinput, true);
    window.removeEventListener('keydown', keydownAfter);
    dom.removeEventListener('compositionend', compositionEnd);
    dom.removeEventListener('paste', paste, true);
    ed.editor.off('transaction', onTx);
  };
}
