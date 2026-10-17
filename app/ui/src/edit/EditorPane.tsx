// The note body as the editor (slice 3C, docs/contracts/ms3-shell.md §13, editor.md R6–R8): block handles and the
// block menu (FR-EDT-01 AC-3…AC-6), the slash menu (FR-EDT-03), the formatting toolbar and link field (FR-EDT-05),
// `[[` and `#` autocomplete (FR-EDT-06, -15), block selection (FR-EDT-13) and paste notices (FR-EDT-14). The editor
// itself is @tegg/editor; every visible text comes from the catalog (NFR-OTH-02).
import { useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type Ref } from 'react';
import { createEditor, linkTarget, type EditorUi, type LinkInfo, type TeggEditor } from '@tegg/editor';
import { extract } from '@tegg/doc';
import { requestOffer } from '../links/offer';
import { DuplicateDetails } from '../links/DuplicateDetails';
import { chipIcon } from '../links/icons';
import { t } from '../i18n/catalog';
import { ipc } from '../ipc/client';
import type { SwitcherItemDto, TagDto, TypeDefDto } from '../ipc/types';
import { localIso, ulid } from '../newNote';
import { openDate } from '../daily/open';
import { Calendar } from '../daily/Calendar';
import { dateRows } from '@tegg/doc';
import { localDate } from '../zone';
import { region } from '../i18n/collate';
import { createObject, prepareObject, type Prepared } from '../types/create';
import { CALLOUT_TYPES } from '../read/callout';
import { rank } from '../shell/commands';
import { Icon, iconElement, typeIconName } from '../shell/Icon';
import { eventKeys } from '../shell/keys';
import { SHORTCUTS, SLASH_ITEMS, showDue, type SlashDef } from '../shell/registry';

export type EditAction =
  | 'undo' | 'redo' | 'bold' | 'italic' | 'strike' | 'code' | 'highlight' | 'link' | 'moveBlockUp' | 'moveBlockDown'
  | 'blockMenu' | 'selectBlock' | 'openOrToggle' | 'pastePlain' | 'saveNow';

export type EditorPaneApi = {
  ed: TeggEditor | null; run: (a: EditAction) => void; focus: () => void; slashOpen: () => boolean;
  /** D-247, D-255: the caret at the start of the first editable block (or of the heading `fragment`), without
   *  scrolling; false when nothing in the body is editable. Writes nothing. */
  caretToStart: (fragment?: string) => boolean;
  /** ms4-links §5.4: the caret right before the wikilink that starts at `at` in `text` (the file as read). */
  caretAtLink: (at: { line: number; byte: number }, text: string) => boolean;
  /** D-322: the caret at the end of the last editable block (a virtual Daily Note). */
  caretToEnd: () => boolean;
};

/** A chip's icon element with the type's icon name as `data-icon` (FR-LNK-07 AC-1). */
function chipIconElement(type: string): Element {
  const i = chipIcon(type);
  return iconElement(i.glyph, 13, i.def);
}

const SLASH_BLOCK: Record<string, { kind: string; level?: number }> = {
  text: { kind: 'paragraph' }, heading1: { kind: 'heading', level: 1 }, heading2: { kind: 'heading', level: 2 },
  heading3: { kind: 'heading', level: 3 }, bulletList: { kind: 'bulletList' }, orderedList: { kind: 'orderedList' },
  checklist: { kind: 'checklist' }, quote: { kind: 'blockquote' }, callout: { kind: 'callout' }, codeBlock: { kind: 'codeBlock' },
  divider: { kind: 'divider' }, table: { kind: 'table' },
};

const TURN_INTO: { label: string; kind: string; level?: number }[] = [
  { label: 'slash.text', kind: 'paragraph' }, { label: 'slash.heading1', kind: 'heading', level: 1 },
  { label: 'slash.heading2', kind: 'heading', level: 2 }, { label: 'slash.heading3', kind: 'heading', level: 3 },
  { label: 'slash.bulletList', kind: 'bulletList' }, { label: 'slash.orderedList', kind: 'orderedList' },
  { label: 'slash.checklist', kind: 'checklist' }, { label: 'slash.quote', kind: 'blockquote' },
  { label: 'slash.callout', kind: 'callout' }, { label: 'slash.codeBlock', kind: 'codeBlock' },
];

const MARKS = [
  ['bold', 'toolbar.bold'], ['italic', 'toolbar.italic'], ['strike', 'toolbar.strike'], ['code', 'toolbar.code'], ['highlight', 'toolbar.highlight'],
] as const;

const SAFE_URL = /^(https?:\/\/|mailto:)/i;
const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().normalize('NFC');

type Slash = { from: number; query: string; sel: number };
/** 4B (D-331, ms4-daily §6.4): the `@` list adds date rows and `Pick a date…` (rows of kind `date` / `pickDate`). */
type Row = SwitcherItemDto | { kind: 'date'; title: string; date: string; path: null; type: 'daily-note'; matched_alias: null; duplicate: null } | { kind: 'pickDate'; title: string; path: null; type: ''; matched_alias: null; duplicate: null };
type Suggest = { kind: 'link'; from: number; to: number; query: string; items: Row[]; sel: number; at?: boolean }
  | { kind: 'tag'; from: number; to: number; query: string; items: TagDto[]; sel: number };
type Menu = { block: number; sub: null | 'turnInto' | 'calloutType'; x: number; y: number } | null;
type LinkField = { query: string; items: SwitcherItemDto[]; sel: number; error: boolean; onLink: boolean } | null;

function Due({ due }: { due: SlashDef['due'] }) {
  return due ? <span className="due">{t('due.coming', { milestone: showDue(due) })}</span> : null;
}

export function EditorPane({ apiRef, text, path, types, labelBody, onChange, onReady, onOpen, onTag, onExternal, onImagePaste, onFailedLoad, onSaveNow, autoFocus, describedBy }: {
  onSaveNow?: () => void;
  /** A note just created: the caret goes into the body at once (AP-135). */
  autoFocus?: boolean;
  /** The note body is described by the title for screen readers (D-255). */
  describedBy?: string;
  apiRef: Ref<EditorPaneApi>;
  text: string;
  path: string;
  types: TypeDefDto[];
  labelBody: string;
  onChange: () => void;
  onReady: (ed: TeggEditor) => void;
  onOpen: (path: string, fragment?: string) => void;
  onTag: (key: string) => void;
  onExternal: (url: string) => void;
  onImagePaste: () => void;
  onFailedLoad: () => void;
}) {
  const host = useRef<HTMLDivElement | null>(null);
  const wrap = useRef<HTMLDivElement | null>(null);
  const edRef = useRef<TeggEditor | null>(null);
  /** The chip of the open Create offer, mapped through every edit (null once it's deleted). */
  const chipTrack = useRef<(() => number | null) | null>(null);
  const [, setTick] = useState(0);
  const rerender = useCallback(() => setTick((n) => n + 1), []);
  const links = useRef(new Map<string, LinkInfo & { path?: string | null }>());
  const pathRef = useRef(path);
  pathRef.current = path;
  const cbSave = useRef(onSaveNow);
  cbSave.current = onSaveNow;
  const cb = useRef({ onChange, onOpen, onTag, onExternal, onImagePaste });
  cb.current = { onChange, onOpen, onTag, onExternal, onImagePaste };

  const [hover, setHover] = useState<number | null>(null);
  const [slash, setSlash] = useState<Slash | null>(null);
  const [suggest, setSuggest] = useState<Suggest | null>(null);
  const [menu, setMenu] = useState<Menu>(null);
  const [linkField, setLinkField] = useState<LinkField>(null);
  const [toolbarHidden, setToolbarHidden] = useState<string | null>(null);
  const dismissed = useRef<string | null>(null);
  const live = useRef({ slash, suggest, menu, linkField });
  live.current = { slash, suggest, menu, linkField };

  // ------------------------------------------------------------------ create the editor
  useLayoutEffect(() => {
    if (!host.current) return;
    const ui: EditorUi = {
      resolve: (target) => links.current.get(target.normalize('NFC')),
      unresolved: (target) => t('link.noNote', { target }),
      sourceBlock: t('editor.sourceBlock'),
      checkbox: t('editor.checkbox'),
      chipIcon: (type) => (type ? chipIconElement(type) : null),
      hint: t('editor.hint'),
      placeholder: (kind, value) => {
        const v = value.replace(/^!\[\[|\]\]$/g, '');
        const name = kind === 'query' ? t('ph.query') : kind === 'mindmap' ? t('ph.mindmap') : /\.(png|jpe?g|gif|webp|svg|heic|avif|bmp|tiff?)(\||#|$)/i.test(v) ? t('ph.embedImage') : /\.pdf(\||#|$)/i.test(v) ? t('ph.embedPdf') : t('ph.embedNote');
        const id = kind !== 'embed' ? kind : name === t('ph.embedImage') ? 'embed-image' : name === t('ph.embedPdf') ? 'embed-pdf' : 'embed-note';
        return { name, text: kind === 'embed' ? `${name}: ${v}` : name, id, note: id === 'embed-note' };
      },
      onLink: (target, fragment, chip) => {
        const r = links.current.get(target.normalize('NFC'));
        if ((r?.kind === 'daily' || r?.kind === 'date-missing') && openDate(target)) return; // FR-DLY-08 AC-6
        if (r?.path && (r.kind === 'note' || r.kind === 'daily')) cb.current.onOpen(r.path, fragment ? `#${fragment}` : undefined);
        else if (r?.kind !== 'date-missing' && target && chip) offerFor(target, chip.pos, chip.dom); // FR-LNK-04 AC-4
      },
      onTag: (v) => cb.current.onTag(v.normalize('NFC').toLowerCase()),
      onExternal: (url) => cb.current.onExternal(url),
    };
    let ed: TeggEditor;
    try {
      ed = createEditor({
        text,
        element: host.current,
        now: localNow,
        newId: ulid,
        label: labelBody,
        ui,
        onChange: (dirty) => { if (dirty) cb.current.onChange(); },
        onUpdate: () => { rerender(); probeApplied(); },
        onSelection: () => setHover(null),
        onImagePaste: () => cb.current.onImagePaste(),
      });
    } catch {
      onFailedLoad();
      return;
    }
    edRef.current = ed;
    if (describedBy) (ed.view.dom as HTMLElement).setAttribute('aria-describedby', describedBy);
    onReady(ed);
    // A dialog opened meanwhile (the palette while the object was being created) keeps the focus.
    if (autoFocus && !document.querySelector('[role="dialog"]')) ed.view.focus();
    void resolveLinks();
    return () => {
      edRef.current = null;
      ed.destroy();
    };
  }, []);

  // Link chips: one link_resolve call for the note's targets, then one per new target (NFR-PERF-05 AC-3).
  const resolving = useRef(false);
  const resolveLinks = useCallback(async () => {
    const ed = edRef.current;
    if (!ed || resolving.current) return;
    const targets = new Set<string>();
    ed.view.state.doc.descendants((n) => {
      if (n.type.name === 'wikiLink' && !n.attrs.embed) {
        const tg = linkTarget(String(n.attrs.value)).target.normalize('NFC');
        if (tg && !links.current.has(tg)) targets.add(tg);
      }
      return true;
    });
    if (!targets.size) return;
    resolving.current = true;
    try {
      const res = await ipc.linkResolve(pathRef.current, [...targets]);
      for (const r of res) links.current.set(r.target.normalize('NFC'), { kind: r.kind as LinkInfo['kind'], path: r.path, type: r.type, title: r.title });
      edRef.current?.refreshUi();
    } catch { /* chips stay unresolved */ } finally {
      resolving.current = false;
    }
  }, []);

  // ------------------------------------------------------------------ typing-latency probe (NFR-PERF-06 AC-3)
  // One record per keystroke: frames are counted from the keydown to the first frame after the editor applied it.
  const probes = useRef<{ t0: number; frames: number; applied: boolean }[]>([]);
  const probeOn = () => {
    const w = window as { __TEGG_TEST__?: { latencyProbe?: boolean }; __TEGG_TEST_MODE__?: boolean };
    return !!w.__TEGG_TEST__?.latencyProbe || !!w.__TEGG_TEST_MODE__;
  };
  function probeApplied() {
    for (const p of probes.current) p.applied = true;
  }
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const onKey = (e: KeyboardEvent) => {
      if (!probeOn() || e.metaKey || e.ctrlKey || e.key.length !== 1) return;
      const p = { t0: performance.now(), frames: 0, applied: false };
      probes.current.push(p);
      const tick = () => {
        p.frames++;
        if (p.applied || p.frames >= 30) {
          probes.current = probes.current.filter((x) => x !== p);
          void ipc.perfKey(p.frames, performance.now() - p.t0).catch(() => {});
          return;
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    };
    el.addEventListener('keydown', onKey, true);
    return () => el.removeEventListener('keydown', onKey, true);
  }, []);

  // ------------------------------------------------------------------ menus that follow the caret
  const ed = edRef.current;
  useEffect(() => {
    if (!ed) return;
    const state = ed.view.state;
    const sel = state.selection;
    void resolveLinks();
    const $f = sel.$from;
    const inCode = !!$f.parent.type.spec.code;
    const before = sel.empty && $f.parent.isTextblock ? $f.parent.textBetween(0, $f.parentOffset, undefined, '￼') : '';
    const key = `${$f.pos}`;
    // Slash menu: `/` at a block start or after a space (FR-EDT-03 AC-1).
    const sm = !inCode && sel.empty ? /(^|\s)\/([^\s/￼]*)$/.exec(before) : null;
    if (sm && $f.parent.type.name !== 'calloutTitle') {
      const from = $f.pos - sm[2].length - 1;
      if (dismissed.current !== `s${from}`) {
        if (!live.current.slash || live.current.slash.from !== from || live.current.slash.query !== sm[2]) setSlash({ from, query: sm[2], sel: 0 });
      } else if (live.current.slash) setSlash(null);
    } else if (live.current.slash) setSlash(null);
    // `[[` autocomplete (FR-EDT-06 AC-1), and `@` at a mention start with the same list (D-250, D-258): after a
    // line start, a space or `(`, not inside a word (`eva@example.com`), code, a link or math; the query may hold
    // spaces, and a space typed when only the Create row is left closes it, leaving `@<query>` as text.
    const lm0 = !inCode && sel.empty ? /\[\[([^[\]\n|￼]*)$/.exec(before) : null;
    const am0 = !lm0 && !inCode && sel.empty && !$f.marks().some((m) => m.type.name === 'link') ? /(?:^|[\s(])@([^\s@￼[\]][^@\n￼[\]]*|)$/.exec(before) : null;
    // The `@` itself in inline code or a link (a code span closed after it) is no mention start (D-258).
    const atMarks = am0 ? state.doc.resolve($f.pos - am0[1].length).marks() : [];
    const am = am0 && !atMarks.some((m) => m.type.name === 'code' || m.type.name === 'link') ? am0 : null;
    const lm = lm0 ?? (am ? [`@${am[1]}`, am[1]] as const : null);
    if (am && !lm0) {
      const from = $f.pos - am[1].length - 1;
      const cur = live.current.suggest;
      if (am[1].endsWith(' ') && cur?.kind === 'link' && cur.from === from && cur.items.length > 0 && cur.items.every((x) => x.kind === 'create' || x.kind === 'pickDate')) {
        dismissed.current = `a${from}`;
        setSuggest(null);
      }
    }
    if (lm) {
      const from = $f.pos - lm[0].length;
      // The dismissal is per trigger: closing the `@` list doesn't block a `[[` typed at the same place.
      if (dismissed.current !== `${lm0 ? 'l' : 'a'}${from}`) {
        const cur = live.current.suggest;
        if (!cur || cur.kind !== 'link' || cur.from !== from || cur.query !== lm[1]) {
          const q = lm[1];
          const at = !lm0;
          setSuggest((s) => ({ kind: 'link', from, to: $f.pos, query: q, items: s?.kind === 'link' ? s.items : [], sel: 0, at }));
          void ipc.switcher(q, 20).then((found) => {
            const items: Row[] = at ? withDates(q, found) : found;
            // The create row's type is read ahead (D-232), so choosing it sends note_create at once.
            const c = found.find((x) => x.kind === 'create');
            if (c && prepared.current?.key !== c.type) {
              const slot = { key: c.type, p: null as Prepared | null };
              prepared.current = slot;
              prepareObject(c.type).then((p) => { slot.p = p; }, () => {});
            }
            setSuggest((s) => (s && s.kind === 'link' && s.query === q ? { ...s, items, to: $f.pos } : s));
          }, () => {});
        }
        return;
      }
    }
    // `#` autocomplete: the caret right after a tag the user is typing (FR-EDT-15 AC-1).
    const nb = sel.empty ? $f.nodeBefore : null;
    if (!inCode && nb?.type.name === 'tag') {
      const from = $f.pos - nb.nodeSize;
      const q = String(nb.attrs.value);
      if (dismissed.current !== `t${from}:${q}`) {
        const cur = live.current.suggest;
        if (!cur || cur.kind !== 'tag' || cur.from !== from || cur.query !== q) {
          setSuggest((s) => ({ kind: 'tag', from, to: $f.pos, query: q, items: s?.kind === 'tag' ? s.items : [], sel: 0 }));
          void ipc.tags().then((all) => {
            const f = fold(q);
            const items = all.filter((x) => fold(x.key).startsWith(f)).sort((a, b) => b.count - a.count || (a.key < b.key ? -1 : 1));
            setSuggest((s) => (s && s.kind === 'tag' && s.query === q ? { ...s, items } : s));
          }, () => {});
        }
        return;
      }
    }
    if (live.current.suggest) setSuggest(null);
    void key;
  });

  // ------------------------------------------------------------------ actions
  const focusEditor = () => edRef.current?.view.focus();
  const caretToStart = (fragment?: string): boolean => {
    const ed = edRef.current;
    if (!ed) return false;
    const { state } = ed.view;
    const want = fragment?.replace(/^#/, '').normalize('NFC').toLowerCase();
    let pos: number | null = null;
    let first: number | null = null;
    state.doc.descendants((n, p) => {
      if (pos !== null) return false;
      if (n.type.name === 'rawBlock' || (n.isAtom && n.isBlock)) return false; // read-only blocks (D-191)
      if (n.isTextblock) {
        if (first === null) first = p + 1;
        if (want && n.type.name === 'heading' && n.textContent.normalize('NFC').toLowerCase() === want) pos = p + 1;
        return false;
      }
      return true;
    });
    const at = pos ?? first;
    if (at === null) return false;
    // WebKit scrolls a focused editable to a new caret; keep every scroll position (Back restores one, D-255).
    const kept: [Element, number][] = [];
    for (let e: Element | null = ed.view.dom; e; e = e.parentElement) if (e.scrollTop) kept.push([e, e.scrollTop]);
    const restore = () => { for (const [e, top] of kept) e.scrollTop = top; };
    // Focus first: on focus ProseMirror reads the DOM selection, which would move the caret to the document start.
    (ed.view.dom as HTMLElement).focus({ preventScroll: true });
    ed.editor.commands.setTextSelection(at); // a selection change: no write, no history step
    restore();
    requestAnimationFrame(restore);
    return true;
  };

  const caretToEnd = (): boolean => {
    const ed = edRef.current;
    if (!ed) return false;
    let last: number | null = null;
    ed.view.state.doc.descendants((n, p) => {
      if (n.type.name === 'rawBlock' || (n.isAtom && n.isBlock)) return false;
      if (n.isTextblock) { last = p + n.nodeSize - 1; return false; }
      return true;
    });
    if (last === null) return false;
    (ed.view.dom as HTMLElement).focus({ preventScroll: true });
    ed.editor.commands.setTextSelection(last);
    return true;
  };

  /** FR-LNK-04 AC-4: the Create offer for the broken chip at `pos`; the caret goes right after it (⌘↩ works again). */
  const offerFor = (target: string, pos: number, dom: HTMLElement | null) => {
    const ed = edRef.current;
    if (!ed) return;
    const node = ed.view.state.doc.nodeAt(pos);
    if (node) ed.editor.commands.setTextSelection(pos + node.nodeSize);
    // The offer is non-modal: the note can change while it is open, so `pos` is mapped through every edit and Create
    // uses the clicked chip only if it is still there (D-287).
    const track = ed.trackPos(pos);
    chipTrack.current = track;
    const chipAt = () => {
      const at = chipTrack.current === track && edRef.current === ed ? track() : null;
      if (at === null) return null;
      const n = ed.view.state.doc.nodeAt(at);
      const same = n?.type.name === 'wikiLink' && linkTarget(String(n.attrs.value)).target.normalize('NFC') === target.normalize('NFC');
      return same ? at : null;
    };
    requestOffer({ from: pathRef.current, target, relationTo: null, anchor: dom, editor: ed, chipPos: pos, chipAt });
  };
  const caretAtLink = (at: { line: number; byte: number }, text: string): boolean => {
    const ed = edRef.current;
    if (!ed) return false;
    // The n-th body wikilink of the file is the n-th wikiLink node of the editor's document.
    const body = extract(text, '').links.filter((l) => !l.inFrontmatter && !l.markdown);
    const n = body.findIndex((l) => l.at.line === at.line && l.at.byte === at.byte);
    if (n < 0) return false;
    let k = 0;
    let pos: number | null = null;
    ed.view.state.doc.descendants((node, p) => {
      if (pos !== null) return false;
      if (node.type.name === 'wikiLink') {
        if (k === n) pos = p;
        k++;
        return false;
      }
      return true;
    });
    if (pos === null) return false;
    (ed.view.dom as HTMLElement).focus({ preventScroll: true });
    ed.editor.commands.setTextSelection(pos);
    const dom = ed.view.nodeDOM(pos) as HTMLElement | null;
    dom?.scrollIntoView?.({ block: 'center' });
    return true;
  };

  const openMenu = useCallback((block: number) => {
    const e = edRef.current;
    if (!e) return;
    const el = blockEl(block);
    const r = el?.getBoundingClientRect();
    setMenu({ block, sub: null, x: (r?.left ?? 100) - 8, y: (r?.top ?? 100) + 24 });
  }, []);

  const blockEl = (k: number): HTMLElement | null => (edRef.current?.view.dom.children[k] as HTMLElement | undefined) ?? null;

  /** Puts the caret (or a node selection for atoms) into top-level block `k`. */
  const selectBlockCaret = (k: number) => {
    const e = edRef.current;
    if (!e) return;
    const doc = e.view.state.doc;
    if (k >= doc.childCount) return;
    let pos = 0;
    for (let i = 0; i < k; i++) pos += doc.child(i).nodeSize;
    const node = doc.child(k);
    if (node.isAtom || node.type.name === 'horizontalRule') e.editor.commands.setNodeSelection(pos);
    else e.editor.commands.setTextSelection(pos + 1);
  };

  const chooseSlash = (item: SlashDef) => {
    const e = edRef.current;
    const s = live.current.slash;
    if (!e || !s || !item.status.built) return;
    const b = SLASH_BLOCK[item.id];
    setSlash(null);
    e.commands.slashInsert(s.from, e.view.state.selection.from, b.kind, { level: b.level });
    focusEditor();
  };

  const prepared = useRef<{ key: string; p: Prepared | null } | null>(null);
  /** FR-DLY-08 AC-1…AC-3: a date row inserts `[[YYYY-MM-DD]]` at the `@` (D-333); `Pick a date…` opens the calendar. */
  const [pick, setPick] = useState<{ at: { left: number; top: number } } | null>(null);
  const insertDate = (date: string) => {
    const e = edRef.current;
    const s = live.current.suggest;
    if (!e || !s || s.kind !== 'link') return;
    setSuggest(null);
    setPick(null);
    dismissed.current = `${s.at ? 'a' : 'l'}${s.from}`;
    links.current.set(date, { kind: 'date-missing', type: 'daily-note' });
    e.commands.replaceWithLink(s.from, e.view.state.selection.from, { path: date, title: date, fromPath: pathRef.current, stemResolves: true });
    focusEditor();
  };
  const chooseLink = async (row: Row) => {
    const e = edRef.current;
    const s = live.current.suggest;
    if (!e || !s || s.kind !== 'link') return;
    if (row.kind === 'date') { insertDate((row as { date: string }).date); return; }
    if (row.kind === 'pickDate') {
      const c = e.view.coordsAtPos(s.from);
      setPick({ at: { left: c.left, top: c.bottom + 4 } });
      return;
    }
    const item = row;
    setSuggest(null);
    dismissed.current = `${s.at ? 'a' : 'l'}${s.from}`; // ⌘Z restores the typed query as text; it doesn't reopen the list
    let path = item.path;
    let title = item.title.normalize('NFC');
    if (item.kind === 'create') {
      try {
        const ready = prepared.current?.key === item.type ? prepared.current.p : null;
        path = await (ready ? ready.create(title) : createObject(item.type, title));
      } catch {
        return;
      }
    }
    if (!path) return;
    const stem = path.split('/').pop()!.replace(/\.md$/, '');
    const r = await ipc.linkResolve(pathRef.current, [stem]).catch(() => []);
    const stemResolves = r[0]?.path?.normalize('NFC') === path.normalize('NFC');
    links.current.set(stemResolves ? stem.normalize('NFC') : path.replace(/\.md$/, '').normalize('NFC'), { kind: 'note', path, type: item.type });
    e.commands.replaceWithLink(s.from, e.view.state.selection.from, { path, title, viaAlias: item.matched_alias ?? undefined, fromPath: pathRef.current, stemResolves });
    focusEditor();
  };

  const chooseTag = (spelling: string) => {
    const e = edRef.current;
    const s = live.current.suggest;
    if (!e || !s || s.kind !== 'tag') return;
    setSuggest(null);
    dismissed.current = `t${s.from}:${spelling.normalize('NFC')}`;
    e.commands.replaceWithTag(s.from, s.to, spelling);
    focusEditor();
  };

  const openLinkField = () => {
    const e = edRef.current;
    if (!e) return;
    const st = e.view.state;
    const onLink = e.editor.isActive('link') || st.selection.$from.nodeBefore?.type.name === 'wikiLink' || st.selection.$from.nodeAfter?.type.name === 'wikiLink'
      || (st.selection as { node?: { type: { name: string } } }).node?.type.name === 'wikiLink';
    setLinkField({ query: '', items: [], sel: 0, error: false, onLink });
  };

  const run = useCallback((a: EditAction) => {
    const e = edRef.current;
    if (!e) return;
    const c = e.commands;
    switch (a) {
      case 'undo': c.undo(); break;
      case 'redo': c.redo(); break;
      case 'bold': case 'italic': case 'strike': case 'code': case 'highlight': c.toggleMark(a === 'strike' ? 'strike' : a); focusEditor(); break;
      case 'link': openLinkField(); break;
      case 'moveBlockUp': c.moveBlock('up'); break;
      case 'moveBlockDown': c.moveBlock('down'); break;
      case 'blockMenu': openMenu(e.blockSelection()?.from ?? e.caretBlock()); break;
      case 'selectBlock': c.selectBlock(); break;
      case 'openOrToggle': {
        const $f = e.view.state.selection.$from;
        const n = [$f.nodeBefore, $f.nodeAfter].find((x) => x?.type.name === 'wikiLink');
        if (n) {
          const { target, fragment } = linkTarget(String(n.attrs.value));
          const r = links.current.get(target.normalize('NFC'));
          if ((r?.kind === 'daily' || r?.kind === 'date-missing') && openDate(target)) break; // FR-DLY-08 AC-6
          if (r?.path) cb.current.onOpen(r.path, fragment ? `#${fragment}` : undefined);
          else if (r?.kind !== 'date-missing' && target) {
            const pos = $f.nodeBefore === n ? $f.pos - n.nodeSize : $f.pos;
            offerFor(target, pos, e.view.nodeDOM(pos) as HTMLElement | null); // ⌘↩ on a broken link (FR-LNK-04 AC-4)
          }
        } else c.toggleChecklist();
        break;
      }
      case 'pastePlain': {
        e.pastePlainNext();
        // The native menu has no "Paste as plain text"; read the clipboard when no paste event follows.
        setTimeout(() => {
          void navigator.clipboard?.readText?.().then((txt) => { if (txt) { e.commands.pasteText(txt, true); } }).catch(() => {});
        }, 150);
        break;
      }
      case 'saveNow': cbSave.current?.(); break; // the note page flushes (FR-EDT-08 AC-9)
    }
  }, [openMenu]);

  useImperativeHandle(apiRef, () => ({ ed: edRef.current, run, focus: focusEditor, slashOpen: () => !!live.current.slash, caretToStart, caretAtLink, caretToEnd }), [run, edRef.current]);

  // ------------------------------------------------------------------ keyboard in the editor (capture: before ProseMirror)
  const onKeyDownCapture = (e: React.KeyboardEvent) => {
    const ed = edRef.current;
    if (!ed || !host.current?.contains(e.target as Node)) return; // menus and fields handle their own keys
    const L = live.current;
    const stop = () => { e.preventDefault(); e.stopPropagation(); };
    if (L.slash) {
      const items = slashMatches(L.slash.query);
      const enabled = items.map((x, i) => (x.status.built ? i : -1)).filter((i) => i >= 0);
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        stop();
        if (!items.length) return;
        let i = L.slash.sel;
        for (let n = 0; n < items.length; n++) { i = (i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length; if (items[i].status.built) break; }
        setSlash({ ...L.slash, sel: i });
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        stop();
        const pick = items[L.slash.sel]?.status.built ? items[L.slash.sel] : items[enabled[0]];
        if (pick && items.length) chooseSlash(pick);
        else { dismissed.current = `s${L.slash.from}`; setSlash(null); }
        return;
      }
      if (e.key === 'Escape') { stop(); dismissed.current = `s${L.slash.from}`; setSlash(null); return; }
    }
    if (L.suggest) {
      const n = L.suggest.kind === 'link' ? L.suggest.items.length : L.suggest.items.length + 1;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        stop();
        if (n) setSuggest({ ...L.suggest, sel: (L.suggest.sel + (e.key === 'ArrowDown' ? 1 : -1) + n) % n } as Suggest);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        stop();
        if (L.suggest.kind === 'link') { const it = L.suggest.items[L.suggest.sel]; if (it) void chooseLink(it); }
        else { const it = L.suggest.items[L.suggest.sel]; chooseTag(it ? it.spelling : L.suggest.query); }
        return;
      }
      if (e.key === 'Escape') {
        stop();
        dismissed.current = L.suggest.kind === 'link' ? `${L.suggest.at ? 'a' : 'l'}${L.suggest.from}` : `t${L.suggest.from}:${L.suggest.query}`;
        setSuggest(null);
        return;
      }
    }
    // R8 shortcuts while the editor has the focus: run here, so neither the browser's own editing commands nor a
    // second handler act (the app's key handler skips handled events).
    const keys = eventKeys(e.nativeEvent);
    const sc = keys ? SHORTCUTS.find((x) => x.keys === keys && x.command.startsWith('edit.')) : undefined;
    if (sc && sc.command !== 'edit.undo' && sc.command !== 'edit.redo') {
      stop();
      run(sc.command.slice(5) as EditAction);
      return;
    }
    const bs = ed.blockSelection();
    if (e.key === 'Escape') {
      stop();
      const sel = ed.view.state.selection;
      if (bs) { ed.clearBlockSelection(); return; }
      if (!sel.empty && !(sel as { node?: unknown }).node) { setToolbarHidden(`${sel.from}-${sel.to}`); return; }
      // Owner decision (2026-10-15): in focus mode, Esc with nothing selected leaves it (FR-UX-02 AC-9) instead of
      // selecting the block; the app's key handler gets it.
      if (wrap.current?.closest('.focus-mode')) { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); return; }
      ed.commands.selectBlock();
      return;
    }
    if (bs) {
      if (e.shiftKey && !e.metaKey && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) { stop(); ed.commands.extendBlockSelection(e.key === 'ArrowDown' ? 'down' : 'up'); return; }
      if (e.key === 'Backspace' || e.key === 'Delete') { stop(); ed.commands.deleteBlocks(); return; }
    }
    if (e.key === 'Tab' && !e.metaKey) {
      // Lists nest and un-nest; elsewhere Tab stays in the editor.
      const c = ed.editor.can();
      if (e.shiftKey ? c.liftListItem('listItem') : c.sinkListItem('listItem')) {
        stop();
        if (e.shiftKey) ed.editor.commands.liftListItem('listItem'); else ed.editor.commands.sinkListItem('listItem');
      }
    }
  };

  // Shift-click selects blocks from the caret's block (FR-EDT-13 AC-1).
  const onMouseDownCapture = (e: React.MouseEvent) => {
    const ed = edRef.current;
    if (!ed || !e.shiftKey) return;
    const k = blockAt(e.clientY);
    if (k === null) return;
    e.preventDefault();
    e.stopPropagation();
    const from = ed.blockSelection()?.from ?? ed.caretBlock();
    ed.commands.selectBlockRange(from, k);
  };

  const blockAt = (y: number): number | null => {
    const kids = edRef.current ? [...edRef.current.view.dom.children] : [];
    for (let i = 0; i < kids.length; i++) {
      const r = kids[i].getBoundingClientRect();
      if (y >= r.top - 4 && y <= r.bottom + 4) return i;
    }
    return null;
  };

  const onMouseMove = (e: React.MouseEvent) => {
    if (drag.current) return;
    const target = e.target as HTMLElement;
    if (!edRef.current?.view.dom.contains(target)) return;
    const k = blockAt(e.clientY);
    if (k !== null && k !== hover) setHover(k);
  };

  // ------------------------------------------------------------------ drag by the handle (FR-EDT-01 AC-4, FR-EDT-13 AC-3)
  const drag = useRef<{ block: number; y0: number; moved: boolean } | null>(null);
  const onHandleDown = (e: React.MouseEvent, k: number) => {
    if (e.button !== 0) return;
    e.preventDefault();
    drag.current = { block: k, y0: e.clientY, moved: false };
    const move = (ev: MouseEvent) => {
      if (drag.current && Math.abs(ev.clientY - drag.current.y0) > 4) drag.current.moved = true;
    };
    const up = (ev: MouseEvent) => {
      window.removeEventListener('mousemove', move, true);
      window.removeEventListener('mouseup', up, true);
      const d = drag.current;
      drag.current = null;
      const ed = edRef.current;
      if (!d || !ed) return;
      if (!d.moved) {
        const bs = ed.blockSelection();
        if (!bs || d.block < bs.from || d.block > bs.to) selectBlockCaret(d.block);
        openMenu(d.block);
        return;
      }
      const kids = [...ed.view.dom.children];
      let before = kids.length;
      for (let i = 0; i < kids.length; i++) {
        const r = kids[i].getBoundingClientRect();
        if (ev.clientY < r.top + r.height / 2) { before = i; break; }
      }
      const bs = ed.blockSelection();
      const [from, to] = bs && d.block >= bs.from && d.block <= bs.to ? [bs.from, bs.to] : [d.block, d.block];
      ed.commands.moveBlocksTo(from, to, before);
    };
    window.addEventListener('mousemove', move, true);
    window.addEventListener('mouseup', up, true);
  };

  // ------------------------------------------------------------------ render
  const e2 = edRef.current;
  const state = e2?.view.state;
  const caretBlock = e2 ? e2.caretBlock() : null;
  const focused = e2?.view.hasFocus() ?? false;
  const handleBlock = hover ?? (focused ? caretBlock : null);
  const wrapRect = wrap.current?.getBoundingClientRect();
  const handleEl = handleBlock !== null ? blockEl(handleBlock) : null;
  const handleTop = handleEl && wrapRect ? handleEl.getBoundingClientRect().top - wrapRect.top : null;

  const sel = state?.selection;
  const selKey = sel ? `${sel.from}-${sel.to}` : '';
  const showToolbar = !!(e2 && sel && !sel.empty && !(sel as { node?: unknown }).node && !sel.$from.parent.type.spec.code && focused
    && !e2.blockSelection() && toolbarHidden !== selKey && !linkField && !menu);
  let toolbarPos: { left: number; top: number } | null = null;
  if (showToolbar && e2 && wrapRect) {
    const c = e2.view.coordsAtPos(sel!.from);
    toolbarPos = { left: Math.max(0, c.left - wrapRect.left), top: c.top - wrapRect.top - 44 };
  }
  const caretPos = (pos: number) => {
    if (!e2 || !wrapRect) return { left: 0, top: 0 };
    const c = e2.view.coordsAtPos(Math.min(pos, e2.view.state.doc.content.size));
    return { left: c.left - wrapRect.left, top: c.bottom - wrapRect.top + 4 };
  };

  return (
    <div ref={wrap} className="editor-wrap" onKeyDownCapture={onKeyDownCapture} onMouseDownCapture={onMouseDownCapture} onMouseMove={onMouseMove} onMouseLeave={() => setHover(null)}>
      {handleTop !== null && handleBlock !== null && (
        <div className="block-handles" style={{ top: handleTop }}>
          <button data-command="editor.addBlockBelow" type="button" tabIndex={-1} className="icon-button" aria-label={t('editor.addBelow')} title={t('editor.addBelow')}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => { selectBlockCaret(handleBlock); edRef.current?.commands.insertBlock('paragraph'); const ed = edRef.current; if (ed) { const doc = ed.view.state.doc; const k = handleBlock + 1; let p = 0; for (let i = 0; i < k && i < doc.childCount; i++) p += doc.child(i).nodeSize; void p; } focusEditor(); }}>
            <Icon name="plus" />
          </button>
          <button data-command="edit.blockMenu" type="button" tabIndex={-1} className="icon-button drag-handle" aria-label={t('editor.handle')} title={t('editor.handle')}
            onMouseDown={(e) => onHandleDown(e, handleBlock)}>
            <Icon name="grip" />
          </button>
        </div>
      )}
      <div ref={host} className="editor-host" data-user-content />
      {showToolbar && toolbarPos && e2 && (
        <div role="toolbar" aria-label={t('toolbar.label')} className="format-toolbar" style={toolbarPos}>
          {MARKS.map(([m, label]) => (
            <button key={m} type="button" tabIndex={-1} aria-label={t(label)} title={t(label)} aria-pressed={e2.editor.isActive(m)}
              onMouseDown={(ev) => ev.preventDefault()} onClick={() => run(m)}>
              <Icon name={`mark-${m}`} />
            </button>
          ))}
          <button type="button" tabIndex={-1} aria-label={t('toolbar.link')} title={t('toolbar.link')} aria-pressed={e2.editor.isActive('link')}
            onMouseDown={(ev) => ev.preventDefault()} onClick={() => openLinkField()}>
            <Icon name="link" />
          </button>
          <button type="button" tabIndex={-1} aria-label={t('ctl.turnIntoObject')} aria-disabled="true" aria-description={t('due.coming', { milestone: 'MS5' })} title={t('due.coming', { milestone: 'MS5' })} onMouseDown={(ev) => ev.preventDefault()}>
            <Icon name="object" />
          </button>
        </div>
      )}
      {slash && e2 && (
        <SlashMenu slash={slash} pos={caretPos(slash.from)} onPick={chooseSlash} onSel={(i) => setSlash({ ...slash, sel: i })} />
      )}
      {suggest && e2 && (
        <Suggestions s={suggest} types={types} pos={caretPos(suggest.from)} onLink={(i) => void chooseLink(i)} onTag={chooseTag} />
      )}
      {pick && suggest && (
        <Calendar selected={localDate(Date.now())} anchor={null} at={pick.at} onChoose={insertDate}
          onClose={() => { setPick(null); focusEditor(); }} />
      )}
      {menu && e2 && (
        <BlockMenu menu={menu} ed={e2} wrapRect={wrapRect}
          onSub={(sub) => setMenu({ ...menu, sub })}
          onClose={() => { setMenu(null); focusEditor(); }} />
      )}
      {linkField && e2 && (
        <LinkFieldView field={linkField} pos={sel ? caretPos(sel.from) : { left: 0, top: 0 }}
          onChange={(f) => setLinkField(f)}
          onClose={() => { setLinkField(null); focusEditor(); }}
          onPickNote={async (item) => {
            setLinkField(null);
            const ed = edRef.current;
            if (!ed || !item.path) return;
            const stem = item.path.split('/').pop()!.replace(/\.md$/, '');
            const r = await ipc.linkResolve(pathRef.current, [stem]).catch(() => []);
            const stemResolves = r[0]?.path?.normalize('NFC') === item.path.normalize('NFC');
            links.current.set(stemResolves ? stem.normalize('NFC') : item.path.replace(/\.md$/, '').normalize('NFC'), { kind: 'note', path: item.path, type: item.type });
            ed.commands.insertLink({ path: item.path, title: item.title, fromPath: pathRef.current, stemResolves });
            focusEditor();
          }}
          onUrl={(url) => {
            const ed = edRef.current;
            if (!ed) return false;
            if (!SAFE_URL.test(url.trim())) return false;
            setLinkField(null);
            ed.commands.setUrlLink(url.trim());
            focusEditor();
            return true;
          }}
          onRemove={() => { setLinkField(null); edRef.current?.commands.removeLink(); focusEditor(); }}
        />
      )}
    </div>
  );
}

// ------------------------------------------------------------------------------------------------ slash menu

function slashMatches(query: string): SlashDef[] {
  const items = SLASH_ITEMS.map((i) => ({ ...i, title: t(i.label) }));
  return query ? rank(query, items) : items;
}

function SlashMenu({ slash, pos, onPick, onSel }: { slash: Slash; pos: { left: number; top: number }; onPick: (i: SlashDef) => void; onSel: (i: number) => void }) {
  const items = slashMatches(slash.query);
  let lastGroup = '';
  return (
    <div className="popover slash-menu" style={pos}>
      <div role="listbox" aria-label={t('slash.label')}>
        {items.length === 0 && <div className="empty" role="presentation">{t('slash.empty')}</div>}
        {items.map((it, i) => {
          const header = !slash.query && it.group !== lastGroup ? t(`slash.group.${it.group}`) : null;
          lastGroup = it.group;
          const disabled = !it.status.built;
          return (
            <div key={it.id} role="presentation">
              {header && <div className="group-header" role="presentation">{header}</div>}
              <div role="option" aria-label={t(it.label)} aria-selected={i === slash.sel} aria-disabled={disabled || undefined}
                aria-description={disabled && it.due ? t('due.coming', { milestone: showDue(it.due) }) : undefined}
                className={`option ${i === slash.sel ? 'selected' : ''} ${disabled ? 'disabled' : ''}`}
                onMouseDown={(e) => e.preventDefault()}
                onMouseMove={() => !disabled && i !== slash.sel && onSel(i)}
                onClick={() => !disabled && onPick(it)}>
                <span>{t(it.label)}</span>
                {disabled && <Due due={it.due} />}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------------------------------------ suggestions

/** D-331: date rows first, then note rows, `Pick a date…`, then Create. */
function withDates(q: string, found: SwitcherItemDto[]): Row[] {
  const dates: Row[] = dateRows(q, localDate(Date.now()), region() ?? navigator.language)
    .map((r) => ({ kind: 'date' as const, title: r.label, date: r.date, path: null, type: 'daily-note' as const, matched_alias: null, duplicate: null }));
  const pickRow: Row = { kind: 'pickDate', title: t('mention.pickDate'), path: null, type: '', matched_alias: null, duplicate: null };
  return [...dates, ...found.filter((x) => x.kind !== 'create'), pickRow, ...found.filter((x) => x.kind === 'create')];
}

function Suggestions({ s, types, pos, onLink, onTag }: { s: Suggest; types: TypeDefDto[]; pos: { left: number; top: number }; onLink: (i: Row) => void; onTag: (spelling: string) => void }) {
  if (s.kind === 'link') {
    return (
      <div className="popover suggestions" style={pos}>
        <div role="listbox" aria-label={t('suggest.links')}>
          {s.items.map((row, i) => {
            if (row.kind === 'date' || row.kind === 'pickDate') {
              return (
                <div key={`${row.kind}:${row.title}`} role="option" aria-selected={i === s.sel} className={`option ${i === s.sel ? 'selected' : ''}`}
                  onMouseDown={(e) => e.preventDefault()} onClick={() => onLink(row)}>
                  <Icon name="calendar" dataIcon="calendar" />
                  <span>{row.title}</span>
                </div>
              );
            }
            const it = row;
            const typeName = types.find((x) => x.key === it.type)?.name ?? it.type;
            const create = it.kind === 'create';
            const label = create ? t('suggest.create', { query: it.title }) : undefined;
            return (
              <div key={`${it.kind}:${it.path ?? it.title}`} role="option" aria-selected={i === s.sel} aria-label={label}
                className={`option ${i === s.sel ? 'selected' : ''}`} onMouseDown={(e) => e.preventDefault()} onClick={() => onLink(it)}>
                {create ? <span>{label}</span> : (
                  <>
                    <Icon name={typeIconName(it.type)} />
                    <span data-user-content>{it.title}</span>
                    {it.matched_alias && <span className="alias" data-user-content>{it.matched_alias}</span>}
                    {it.duplicate ? <DuplicateDetails details={it.duplicate} typeName={typeName} /> : <span className="meta" data-user-content>{typeName}</span>}
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  }
  return (
    <div className="popover suggestions" style={pos}>
      <div role="listbox" aria-label={t('suggest.tags')}>
        {s.items.map((it, i) => (
          <div key={it.key} role="option" aria-selected={i === s.sel} className={`option ${i === s.sel ? 'selected' : ''}`}
            onMouseDown={(e) => e.preventDefault()} onClick={() => onTag(it.spelling)}>
            <span data-user-content>#{it.spelling}</span>
          </div>
        ))}
        <div role="option" aria-selected={s.sel === s.items.length} aria-label={t('suggest.createTag', { query: s.query })}
          className={`option ${s.sel === s.items.length ? 'selected' : ''}`} onMouseDown={(e) => e.preventDefault()} onClick={() => onTag(s.query)}>
          {t('suggest.createTag', { query: s.query })}
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------------------------------------ block menu

function BlockMenu({ menu, ed, wrapRect, onSub, onClose }: { menu: NonNullable<Menu>; ed: TeggEditor; wrapRect: DOMRect | undefined; onSub: (s: NonNullable<Menu>['sub']) => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const state = ed.view.state;
  const range = ed.blockSelection() ?? { from: ed.caretBlock(), to: ed.caretBlock() };
  let hasSource = false;
  for (let k = range.from; k <= range.to && k < state.doc.childCount; k++) if (state.doc.child(k).type.name === 'rawBlock') hasSource = true;
  let inTable = false;
  const $f = state.selection.$from;
  for (let d = $f.depth; d > 0; d--) if ($f.node(d).type.name === 'table') inTable = true;
  const left = (menu.x - (wrapRect?.left ?? 0));
  const top = (menu.y - (wrapRect?.top ?? 0));
  useEffect(() => {
    const first = ref.current?.querySelector<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])');
    first?.focus();
  }, [menu.sub]);
  // A click anywhere else closes the menu (bug_3c, FR-EDT-01 AC-6).
  useEffect(() => {
    const away = (e: MouseEvent) => { if (!ref.current?.parentElement?.contains(e.target as Node)) onClose(); };
    window.addEventListener('mousedown', away, true);
    return () => window.removeEventListener('mousedown', away, true);
  }, []);
  const act = (f: () => void) => () => { f(); onClose(); };
  const onKey = (e: React.KeyboardEvent) => {
    const items = [...(ref.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
    const i = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      e.stopPropagation();
      const n = items.length;
      items[(i + (e.key === 'ArrowDown' ? 1 : -1) + n) % n]?.focus();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      if (menu.sub) onSub(null); else onClose();
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      e.stopPropagation();
      (document.activeElement as HTMLElement | null)?.click();
    }
  };
  const item = (label: string, onClick: (() => void) | null, opts: { disabled?: boolean; description?: string; key?: string } = {}) => (
    <div key={opts.key ?? label} role="menuitem" tabIndex={-1} aria-label={label} aria-disabled={opts.disabled || undefined} aria-description={opts.description}
      className={`option ${opts.disabled ? 'disabled' : ''}`}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => { if (!opts.disabled && onClick) onClick(); }}>
      <span>{label}</span>
      {opts.description && <span className="due" aria-hidden="true">{opts.description}</span>}
    </div>
  );
  return (
    <div className="popover block-menu" style={{ left, top }} onKeyDown={onKey}>
      <div ref={ref} role="menu" aria-label={t('blockMenu.label')}>
        {menu.sub === null && (
          <>
            {item(t('blockMenu.turnInto'), () => onSub('turnInto'), { disabled: hasSource })}
            {item(t('blockMenu.duplicate'), act(() => ed.commands.duplicateBlock()))}
            {item(t('blockMenu.delete'), act(() => ed.commands.deleteBlocks()))}
            {inTable && item(t('blockMenu.addRowBelow'), act(() => ed.commands.tableAction('addRowBelow')))}
            {inTable && item(t('blockMenu.addColumnRight'), act(() => ed.commands.tableAction('addColumnRight')))}
            {inTable && item(t('blockMenu.deleteRow'), act(() => ed.commands.tableAction('deleteRow')))}
            {inTable && item(t('blockMenu.deleteColumn'), act(() => ed.commands.tableAction('deleteColumn')))}
            {item(t('ctl.copyBlockLink'), null, { disabled: true, description: t('due.coming', { milestone: 'v1.0' }) })}
            {item(t('ctl.turnIntoObject'), null, { disabled: true, description: t('due.coming', { milestone: 'MS5' }) })}
          </>
        )}
        {menu.sub === 'turnInto' && (
          <>
            {TURN_INTO.map((x) => item(t(x.label), act(() => ed.commands.turnInto(x.kind, { level: x.level })), { key: x.label }))}
            {item(t('blockMenu.calloutType'), () => onSub('calloutType'))}
          </>
        )}
        {menu.sub === 'calloutType' && CALLOUT_TYPES.map((ty) => item(`${t(`callout.${ty}`)} (${ty})`, act(() => ed.commands.setCalloutType(ty)), { key: ty }))}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------------------------------------ link field

function LinkFieldView({ field, pos, onChange, onClose, onPickNote, onUrl, onRemove }: {
  field: NonNullable<LinkField>;
  pos: { left: number; top: number };
  onChange: (f: LinkField) => void;
  onClose: () => void;
  onPickNote: (i: SwitcherItemDto) => void;
  onUrl: (url: string) => boolean;
  onRemove: () => void;
}) {
  const input = useRef<HTMLInputElement | null>(null);
  useEffect(() => { input.current?.focus(); }, []);
  const urlLike = (q: string) => /^[a-z][a-z0-9+.-]*:/i.test(q.trim()) || /^www\./i.test(q.trim());
  const notes = field.items.filter((i) => i.kind === 'object');
  const update = (q: string) => {
    onChange({ ...field, query: q, error: false, sel: 0 });
    if (q.trim() && !urlLike(q)) void ipc.switcher(q, 20).then((items) => onChange({ ...field, query: q, items, sel: 0, error: false }), () => {});
  };
  const onKey = (e: React.KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === 'Escape') { e.preventDefault(); onClose(); return; }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (notes.length) onChange({ ...field, sel: (field.sel + (e.key === 'ArrowDown' ? 1 : -1) + notes.length) % notes.length });
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      const q = field.query.trim();
      if (urlLike(q)) { if (!onUrl(q)) onChange({ ...field, error: true }); return; }
      const it = notes[field.sel];
      if (it) onPickNote(it);
    }
  };
  return (
    <div className="popover link-field" style={pos}>
      <input ref={input} role="combobox" aria-label={t('linkField.label')} aria-expanded={notes.length > 0} aria-autocomplete="list"
        placeholder={t('linkField.placeholder')} value={field.query} autoComplete="off" autoCorrect="off" spellCheck={false}
        onChange={(e) => update(e.target.value)} onKeyDown={onKey} />
      {field.onLink && <button type="button" aria-label={t('linkField.remove')} onMouseDown={(e) => e.preventDefault()} onClick={onRemove}>{t('linkField.remove')}</button>}
      {field.error && <div role="alert" className="field-error">{t('linkField.refused')}</div>}
      {notes.length > 0 && (
        <div role="listbox" aria-label={t('suggest.links')}>
          {notes.map((it, i) => (
            <div key={it.path ?? it.title} role="option" aria-selected={i === field.sel} className={`option ${i === field.sel ? 'selected' : ''}`}
              onMouseDown={(e) => e.preventDefault()} onClick={() => onPickNote(it)}>
              <Icon name={typeIconName(it.type)} />
              <span data-user-content>{it.title}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------------------------------------ time

/** ISO 8601 date-time with the local offset, from `Date.now()` (the injected clock in tests, ms3-shell §13.6). */
export const localNow = () => localIso(new Date(Date.now()));
