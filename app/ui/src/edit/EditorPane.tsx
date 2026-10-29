// The note body as the editor (slice 3C, docs/contracts/ms3-shell.md §13, editor.md R6–R8): block handles and the
// block menu (FR-EDT-01 AC-3…AC-6), the slash menu (FR-EDT-03), the formatting toolbar and link field (FR-EDT-05),
// `[[` and `#` autocomplete (FR-EDT-06, -15), block selection (FR-EDT-13) and paste notices (FR-EDT-14). The editor
// itself is @tegg/editor; every visible text comes from the catalog (NFR-OTH-02).
import { TypeMenu } from '../shell/TypeMenu';
import { useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type Ref } from 'react';
import { createEditor, embedTarget, linkTarget, noteHref, type ChipExtra, type EditorUi, type LinkInfo, type TeggEditor } from '@tegg/editor';
import { chipAttrs, chipState, chipSuffix, taskGlyph, taskIconDef, trashedText, unreviewedText } from '../links/chip';
import { SelectionMenu, type SelectionAction } from './SelectionMenu';
import { mountReadOnlyTable } from './readOnlyTable';
import { listen } from '@tauri-apps/api/event';
import { addMedia, pickMedia, type MediaTarget } from '../media/addMedia';
import { mountMedia } from '../media/mount';
import { isAttachmentTarget } from '@tegg/doc';
import type { EmbedStore } from '../embeds/store';
import { mountEmbed } from '../embeds/slot';
import { taskWrites } from '../embeds/TaskEmbed';
import { EmbedPicker } from '../embeds/EmbedPicker';
import { extract } from '@tegg/doc';
import { requestOffer } from '../links/offer';
import { DuplicateDetails } from '../links/DuplicateDetails';
import { chipIcon } from '../links/icons';
import { t } from '../i18n/catalog';
import { ipc } from '../ipc/client';
import type { LinkTargetDto, SwitcherItemDto, TagRowDto, TypeDefDto } from '../ipc/types';
import { localIso, ulid } from '../newNote';
import { openDate } from '../daily/open';
import { PickDate } from '../dates/PickDate';
import { dateRows } from '@tegg/doc';
import { localDate } from '../zone';
import { region } from '../i18n/collate';
import { createObject, prepareObject, type Prepared } from '../types/create';
import { CALLOUT_TYPES } from '../read/callout';
import { rank } from '../shell/commands';
import { Icon, iconElement } from '../shell/Icon';
import { eventKeys } from '../shell/keys';
import { SHORTCUTS, SLASH_ITEMS, showDue, type SlashDef } from '../shell/registry';
import { objectFromUnit, parse, type ConvertUnit } from '@tegg/doc';
import { ConvertPopover, RemoveEmbedDialog } from '../convert/ConvertPopover';
import { conversionHooks, convert as runConvert, type ConvertHost } from '../convert/flow';
import { convertPrefs, setConvertPrefs } from '../convert/prefs';
import { tagChipStyle } from '../theme/tagChip';
import { mindmapUi } from '../mindmap/mount';
import { noteTitle } from '../read/ReadView';
import { editLinkAtCaret, editorChips, type EditorChipsHost } from '../preview/editorChips';
import { editorLinkAction } from '../preview/editorLink';
import { getCurrent as currentPreview, show as showPreview } from '../preview/store';

export type EditAction =
  | 'undo' | 'redo' | 'bold' | 'italic' | 'strike' | 'code' | 'highlight' | 'link' | 'moveBlockUp' | 'moveBlockDown'
  | 'blockMenu' | 'selectBlock' | 'openOrToggle' | 'pastePlain' | 'saveNow' | 'embedObject' | 'openEmbed' | 'displayEmbedAs'
  | 'turnIntoTask' | 'turnIntoObject' | 'addMedia' | 'mindmapMap' | 'mindmapList' | 'mindmapLayoutRight' | 'mindmapLayoutSpider';

export type EditorPaneApi = {
  ed: TeggEditor | null; run: (a: EditAction) => void; focus: () => void; slashOpen: () => boolean;
  /** D-247, D-255: the caret at the start of the first editable block (or of the heading `fragment`), without
   *  scrolling; false when nothing in the body is editable. Writes nothing. */
  caretToStart: (fragment?: string) => boolean;
  /** ms4-links §5.4: the caret right before the wikilink that starts at `at` in `text` (the file as read). */
  caretAtLink: (at: { line: number; byte: number }, text: string) => boolean;
  /** D-322: the caret at the end of the last editable block (a virtual Daily Note). */
  caretToEnd: () => boolean;
  /** 5A-1 (D-486): the targets of the top-level block embeds, by block index. */
  embedBlocks: () => { index: number; target: string }[];
  /** Selects block `index` as a block and scrolls it to the top of the centre pane. */
  selectBlockAtTop: (index: number) => boolean;
  /** 5A-2 (FR-CNV-01 AC-5, D-494): why `Turn into object` can't run now (a nested editor, a template, read-only), or null. */
  convertBlocked: () => string | null;
};

/** A chip's icon element with the type's icon name as `data-icon` (FR-LNK-07 AC-1). */
function chipIconElement(type: string): Element {
  const i = chipIcon(type);
  return iconElement(i.glyph, 13, i.def);
}

/** D-600: the Unreviewed mark and a task's box and suffix on an editor chip (links/chip.ts). */
function chipExtraOf(info: LinkInfo): ChipExtra | null {
  const s = chipState(info);
  if (!s.unreviewed && !s.task && s.link === 'ok') return null;
  const glyph = taskGlyph(s);
  return { attrs: chipAttrs(s), description: s.link === 'trashed' ? trashedText() : s.unreviewed ? unreviewedText() : null, icon: glyph ? iconElement(glyph, 13, taskIconDef(s)) : null, suffix: chipSuffix(s) };
}

/** R94: the second line of a slash row (board Main). */
const SLASH_DESC: Record<string, string> = { mindmap: 'slash.mindmap.description' };

const SLASH_BLOCK: Record<string, { kind: string; level?: number }> = {
  text: { kind: 'paragraph' }, heading1: { kind: 'heading', level: 1 }, heading2: { kind: 'heading', level: 2 },
  heading3: { kind: 'heading', level: 3 }, bulletList: { kind: 'bulletList' }, orderedList: { kind: 'orderedList' },
  checklist: { kind: 'checklist' }, quote: { kind: 'blockquote' }, callout: { kind: 'callout' }, codeBlock: { kind: 'codeBlock' },
  divider: { kind: 'divider' }, table: { kind: 'table' },
  // Slice MM (W1, D-685): an empty mindmap in List, caret in its item.
  mindmap: { kind: 'mindmap' },
};

const TURN_INTO: { label: string; kind: string; level?: number }[] = [
  { label: 'slash.text', kind: 'paragraph' }, { label: 'slash.heading1', kind: 'heading', level: 1 },
  { label: 'slash.heading2', kind: 'heading', level: 2 }, { label: 'slash.heading3', kind: 'heading', level: 3 },
  { label: 'slash.bulletList', kind: 'bulletList' }, { label: 'slash.orderedList', kind: 'orderedList' },
  { label: 'slash.checklist', kind: 'checklist' }, { label: 'slash.mindmap', kind: 'mindmap' }, { label: 'slash.quote', kind: 'blockquote' },
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
  | { kind: 'tag'; from: number; to: number; query: string; items: TagRowDto[]; sel: number };
type Menu = { block: number; sub: null | 'turnInto' | 'calloutType'; x: number; y: number } | null;
type LinkField = { query: string; items: SwitcherItemDto[]; sel: number; error: boolean; onLink: boolean } | null;

function Due({ due }: { due: SlashDef['due'] }) {
  return due ? <span className="due">{t('due.coming', { milestone: showDue(due) })}</span> : null;
}

export function EditorPane({ apiRef, text, path, types, labelBody, onChange, onReady, onOpen, onTag, onExternal, onImagePaste, onFailedLoad, onSaveNow, autoFocus, describedBy, embeds, flush, daily }: {
  /** 5A-2: flushes the note's save now (a conversion's source save, FR-CNV-03 AC-6). */
  flush?: () => Promise<void>;
  /** 5A-2: the date when the note is a Daily Note (its `source` link is the date, D-162). */
  daily?: string | null;
  /** 4F (ms4-embeds §6): the page's embeds; block embeds render through it. */
  embeds?: EmbedStore;
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
  const mediaViews = useRef(new Set<() => void>());
  // 6A (FR-ATT-01 AC-2): files dropped from Finder (Tauri's window drag-drop event) go in at the drop point.
  useEffect(() => {
    const un = listen<{ paths: string[]; position: { x: number; y: number } }>('tauri://drag-drop', (e) => {
      const ed = edRef.current;
      const tg = mediaTarget();
      if (!ed || !tg || !e.payload?.paths?.length) return;
      // Tauri reports physical pixels; accept logical ones too (the point must fall on the editor either way).
      const r = ed.view.dom.getBoundingClientRect();
      const inside = (px: number, py: number) => px >= r.left && px <= r.right && py >= r.top && py <= r.bottom;
      const dpr = window.devicePixelRatio || 1;
      const { x: px, y: py } = e.payload.position;
      const [x, y] = inside(px / dpr, py / dpr) ? [px / dpr, py / dpr] : [px, py];
      if (!inside(x, y)) return;
      const at = ed.view.posAtCoords({ left: x, top: y })?.pos;
      void addMedia(tg, { kind: 'paths', paths: e.payload.paths }, at);
    });
    return () => void un.then((f) => f());
  }, []);
  /** 6A: where media goes: this editor, owned by this note (its title, else its stem). */
  const mediaTarget = (): MediaTarget | null => {
    const ed = edRef.current;
    if (!ed) return null;
    const data = (parse(ed.text()).frontmatter?.data ?? {}) as Record<string, unknown>;
    const stem = (pathRef.current.split('/').pop() ?? '').replace(/\.md$/i, '');
    const title = typeof data.title === 'string' && data.title.trim() ? data.title.trim() : stem;
    return { view: ed.view, owner: { path: pathRef.current, title } };
  };
  const pathRef = useRef(path);
  pathRef.current = path;
  const cbSave = useRef(onSaveNow);
  cbSave.current = onSaveNow;
  const cb = useRef({ onChange, onOpen, onTag, onExternal, onImagePaste });
  cb.current = { onChange, onOpen, onTag, onExternal, onImagePaste };
  const conv = useRef({ flush, daily, types });
  conv.current = { flush, daily, types };

  const [hover, setHover] = useState<number | null>(null);
  const [slash, setSlash] = useState<Slash | null>(null);
  const [suggest, setSuggest] = useState<Suggest | null>(null);
  /** FR-VLT-05 AC-3: the `Create "<q>" as…` row whose type the `Type` menu is choosing. */
  const [asType, setAsType] = useState<{ row: Row; at: { left: number; top: number } } | null>(null);
  const [menu, setMenu] = useState<Menu>(null);
  const [linkField, setLinkField] = useState<LinkField>(null);
  const [toolbarHidden, setToolbarHidden] = useState<string | null>(null);
  /** D-605: the selection's context menu at the pointer; `nested` is the embed editor it was opened in. */
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; nested: HTMLElement | null } | null>(null);
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
      chipExtra: (info) => chipExtraOf(info),
      readOnlyTable: (md, dom) => mountReadOnlyTable(md, dom, { path: pathRef.current, onOpen: (p, f) => cb.current.onOpen(p, f ? `#${f.replace(/^#/, '')}` : undefined), onTag: (k) => cb.current.onTag(k), onExternal: (u) => cb.current.onExternal(u) }),
      readOnlyTableHint: t('table.readOnly'),
      hint: t('editor.hint'),
      placeholder: (kind, value) => {
        const v = value.replace(/^!\[\[|\]\]$/g, '');
        const name = kind === 'query' ? t('ph.query') : kind === 'mindmap' ? t('ph.mindmap') : /\.(png|jpe?g|gif|webp|svg|heic|avif|bmp|tiff?)(\||#|$)/i.test(v) ? t('ph.embedImage') : /\.pdf(\||#|$)/i.test(v) ? t('ph.embedPdf') : t('ph.embedNote');
        const id = kind !== 'embed' ? kind : name === t('ph.embedImage') ? 'embed-image' : name === t('ph.embedPdf') ? 'embed-pdf' : 'embed-note';
        return { name, text: kind === 'embed' ? `${name}: ${v}` : name, id, note: id === 'embed-note' };
      },
      // Slice MM (mm-mindmap §3.3, R91): the map of a mindmap block, its texts, icon and session view state (D-776).
      ...mindmapUi({
        path: () => pathRef.current,
        // The note title for a synthesized root (D-681): `title:` of the frontmatter in effect, else the file name.
        title: () => {
          const head = String(edRef.current?.view.state.doc.attrs.frontmatter ?? '');
          const m = /^title:[ \t]*(.*)$/m.exec(head);
          const v = m ? m[1].trim().replace(/^(['"])(.*)\1$/, '$2') : '';
          return (v || pathRef.current.split('/').pop()!.replace(/\.md$/, '')).normalize('NFC');
        },
        onOpen: (p, f) => cb.current.onOpen(p, f ? `#${f.replace(/^#/, '')}` : undefined),
        onTag: (k) => cb.current.onTag(k),
        onExternal: (u) => cb.current.onExternal(u),
      }),
      // Slice P (v1-previews §5.1, R103): chips and tags map their gestures to the preview, the open or the offer.
      ...chips,
      onExternal: (url) => cb.current.onExternal(url),
      // 4F: block embeds render through the page's embed store; inline embeds are link-mode chips (D-419).
      embed: embeds ? (source, dom, getPos) => mountEmbed(embeds, source, dom, getPos) : undefined,
      // 6A (R77, D-622): file embeds as figures, PDF cards and placeholders, re-drawn when their links resolve.
      media: (source, dom) => mountMedia(dom, source, (tg) => links.current.get(tg), (p) => cb.current.onOpen(p), mediaViews.current),
      // 6A (FR-ATT-01 AC-1): files on the clipboard are added as media (an image wins over text).
      onFiles: (files, pos) => { const tg = mediaTarget(); if (!tg) return false; void addMedia(tg, { kind: 'paste', files }, pos); return true; },
      embedChip: embeds ? (value) => {
        const n = embeds.inlineNode(value);
        if (!n) return undefined;
        const broken = n.state === 'broken';
        return { title: broken ? n.target.target : n.target.title ?? n.target.target, type: n.target.type, state: broken ? 'broken' : n.state === 'too-deep' ? 'too-deep' : 'ok', description: broken ? t('link.noNote', { target: n.target.target }) : t('embed.chip'), target: n.target.path ?? n.target.target };
      } : undefined,
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
        onEmbedKey: (pos, key) => embedKey(pos, key),
        // 5A-2 (D-492, D-494, D-496).
        convertible: !pathRef.current.startsWith('_templates/'),
        conversion: conversionHooks(convertHost),
        guardEmbedRemoval: (list) => guardRemoval(list),
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
      if (n.type.name === 'wikiLink' && (!n.attrs.embed || embeds)) {
        const tg = linkTarget(String(n.attrs.value)).target.normalize('NFC');
        if (tg && !links.current.has(tg)) targets.add(tg); // 6A: inline file embeds resolve too (R77)
      }
      // Slice P (R104 row 1): Markdown links to notes resolve in the same batch (their chips preview).
      if (n.isText) for (const m of n.marks) {
        const note = m.type.name === 'link' ? noteHref(String(m.attrs.href ?? '')) : null;
        if (note && !links.current.has(note.target)) targets.add(note.target);
      }
      // 4F: block embeds resolve in the same batch as the links (FR-EMB-01 AC-2, NFR-PERF-05 AC-3).
      if (embeds && n.type.name === 'rawBlock' && n.attrs.kind === 'embed') {
        const tg = linkTarget(String(n.attrs.source).trim().replace(/^!\[\[|\]\]$/g, '')).target.normalize('NFC');
        if (tg && !links.current.has(tg)) targets.add(tg); // 6A: file embeds resolve too (R77)
      }
      return true;
    });
    if (!targets.size) { buildEmbeds(false); return; }
    resolving.current = true;
    try {
      const res = await ipc.linkResolve(pathRef.current, [...targets]);
      for (const r of res) links.current.set(r.target.normalize('NFC'), { kind: r.kind as LinkInfo['kind'], path: r.path, type: r.type, title: r.title, review: r.review ?? null, status: r.status ?? null, due: r.due ?? null, completed: r.completed ?? null, object: r.object ?? null });
      edRef.current?.refreshUi();
      mediaViews.current.forEach((f) => f());
    } catch { /* chips stay unresolved */ } finally {
      resolving.current = false;
    }
    buildEmbeds(false);
  }, []);

  // ------------------------------------------------------------------ 4F embeds (ms4-embeds §6)
  const embedSig = useRef<string | null>(null);
  /** The embed sources of the document; the tree is rebuilt when they change. */
  const embedSources = (): string[] => {
    const ed = edRef.current;
    const out: string[] = [];
    ed?.view.state.doc.descendants((n) => {
      if (n.type.name === 'rawBlock' && n.attrs.kind === 'embed') out.push(`b:${String(n.attrs.source)}`);
      if (n.type.name === 'wikiLink' && n.attrs.embed) out.push(`i:${String(n.attrs.value)}`);
      return true;
    });
    return out;
  };
  function buildEmbeds(force: boolean) {
    const ed = edRef.current;
    if (!ed || !embeds) return;
    const sig = embedSources().join('\n');
    if (!force && sig === embedSig.current) return;
    embedSig.current = sig;
    const map = new Map<string, LinkTargetDto>();
    for (const [k, v] of links.current) {
      const dto = { target: k, kind: v.kind, path: v.path ?? null, title: v.title ?? null, type: v.type ?? null, review: v.review ?? null, status: v.status ?? null, due: v.due ?? null, completed: v.completed ?? null } as LinkTargetDto;
      map.set(k, dto);
    }
    void embeds.build(ed.text(), map);
  }
  /** A file changed (vault:changed): resolve the embed targets again and rebuild (FR-EMB-02 AC-10). */
  const refreshEmbeds = useCallback(async () => {
    const ed = edRef.current;
    if (!ed || !embeds) return;
    const targets = new Set<string>();
    for (const s of embedSources()) {
      const v = s.slice(2).trim().replace(/^!\[\[|\]\]$/g, '');
      const tg = linkTarget(v).target.normalize('NFC');
      if (tg) targets.add(tg); // 6A: file embeds follow their files (R74, R77)
    }
    // D-600, FR-LNK-07 AC-10: a changed target changes its chip (Unreviewed, a task's status and dates).
    ed.view.state.doc.descendants((n) => {
      if (n.type.name === 'wikiLink' && !n.attrs.embed) { const tg = linkTarget(String(n.attrs.value)).target.normalize('NFC'); if (tg) targets.add(tg); }
      return true;
    });
    if (targets.size) {
      const res = await ipc.linkResolve(pathRef.current, [...targets]).catch(() => [] as LinkTargetDto[]);
      for (const r of res) links.current.set(r.target.normalize('NFC'), { kind: r.kind as LinkInfo['kind'], path: r.path, type: r.type, title: r.title, review: r.review ?? null, status: r.status ?? null, due: r.due ?? null, completed: r.completed ?? null, object: r.object ?? null });
    }
    buildEmbeds(true);
    edRef.current?.refreshUi();
    mediaViews.current.forEach((f) => f());
  }, []);
  useEffect(() => {
    if (!embeds) return;
    embeds.refresh = () => void refreshEmbeds();
    const un = embeds.subscribe(() => edRef.current?.refreshUi());
    embeds.host = {
      setMode: (pos, mode) => { edRef.current?.commands.setEmbedMode(pos, mode); },
      leave: (pos, how) => {
        const e = edRef.current;
        if (!e) return;
        const doc = e.view.state.doc;
        let k = 0;
        for (let p = 0; k < doc.childCount && p + doc.child(k).nodeSize <= pos; k++) p += doc.child(k).nodeSize;
        (e.view.dom as HTMLElement).focus({ preventScroll: true });
        // After the focus moved (its selection change would clear a block selection made before it).
        const select = (i: number) => requestAnimationFrame(() => edRef.current?.commands.selectBlockAt(i));
        if (how === 'escape') { select(k); return; }
        const next = how === 'up' ? k - 1 : k + 1;
        if (next < 0 || next >= doc.childCount) { select(k); return; }
        const node = doc.child(next);
        if (node.type.name === 'rawBlock') { select(next); return; }
        let at = 0;
        for (let i = 0; i < next; i++) at += doc.child(i).nodeSize;
        e.editor.commands.setTextSelection(how === 'up' ? at + node.nodeSize - 1 : at + 1);
      },
      onOpen: (p, f) => cb.current.onOpen(p, f ? `#${f.replace(/^#/, '')}` : undefined),
      onTag: (k) => cb.current.onTag(k),
      onExternal: (u) => cb.current.onExternal(u),
    };
    return () => { un(); embeds.host = null; embeds.refresh = null; };
  }, []);

  // 5A-2 (D-497): a Task card wrote its task, or found it changed: the nested editors of that file take the new text
  // and the tree is rebuilt (the core's own writes don't come back as vault:changed).
  useEffect(() => {
    if (!embeds) return;
    const on = (p: string, w: { text: string; version: unknown } | null) => {
      if (w) embeds.wrote(-1, p, w.text, w.version);
      void refreshEmbeds();
    };
    taskWrites.add(on);
    return () => { taskWrites.delete(on); };
  }, []);

  /** D-428: ⏎ / ⌘↩ / `Display embed as…` on a selected block embed. */
  /** Opens the target of an embed's `![[…]]` value through the note's link resolutions, as its card's Open does. */
  function openEmbedTarget(value: string): boolean {
    const { target, fragment } = linkTarget(value.trim().replace(/^!\[\[|\]\]$/g, ''));
    const r = links.current.get(target.normalize('NFC'));
    if ((r?.kind === 'daily' || r?.kind === 'date-missing') && openDate(target)) return true;
    if (!r?.path) return false;
    cb.current.onOpen(r.path, fragment && !fragment.startsWith('^') ? `#${fragment}` : undefined);
    return true;
  }
  /** The document position of top-level block `index`. */
  function blockStart(ed: TeggEditor, index: number): number {
    let pos = 0;
    for (let i = 0; i < index && i < ed.view.state.doc.childCount; i++) pos += ed.view.state.doc.child(i).nodeSize;
    return pos;
  }
  function embedKey(pos: number, key: 'enter' | 'open' | 'displayAs' | 'preview'): boolean {
    const e = edRef.current;
    if (!e) return false;
    const dom = e.view.nodeDOM(pos) as HTMLElement | null;
    if (!dom) return false;
    if (key === 'preview') {
      // Slice P (D-928, D-938): ⌥Space on a selected embed previews its target; on a figure, its Image or PDF object.
      const fig = dom.querySelector<HTMLElement>('[data-media-object]');
      const obj = fig?.dataset.mediaObject;
      if (obj) {
        showPreview({ path: obj.normalize('NFC'), fragment: null, kind: 'note' }, { el: fig! }, 'key', undefined, undefined, { open: () => cb.current.onOpen(obj), returnFocus: () => e.commands.selectBlockAt(e.view.state.doc.resolve(pos).index(0)) });
        return true;
      }
      const ref = dom.matches('[data-preview-ref]') ? dom : dom.querySelector<HTMLElement>('[data-preview-ref]');
      if (!ref) return false;
      const index = e.view.state.doc.resolve(pos).index(0);
      ref.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', code: 'Space', altKey: true, bubbles: true, cancelable: true }));
      const cur = currentPreview();
      if (cur) cur.opts.returnFocus = () => { edRef.current?.commands.selectBlockAt(index); edRef.current?.view.focus(); };
      return !!cur;
    }
    if (!embeds) return false;
    const click = (sel: string) => {
      const b = [...dom.querySelectorAll<HTMLElement>(sel)].find((x) => !x.closest('[data-embed-body]'));
      b?.click();
      return !!b;
    };
    // The card's own Open button, or, while the card hasn't rendered yet (the embed tree loads after a conversion's
    // save; nightly 2026-10-27, FR-CNV-04 AC-2), the target by its link resolution. ⏎ (D-448) has no such fallback:
    // before the tree loads, a card can't be told from a full embed, which ⏎ enters instead of opening.
    if (key === 'open') return click('.embed-header button[aria-label^="Open"], .embed-header button.embed-open') || click('a[data-embed-mode="link"], .embed-link') || openEmbedTarget(String(e.view.state.doc.nodeAt(pos)?.attrs.source ?? ''));
    if (key === 'displayAs') return click('.embed-header button[aria-haspopup="menu"], .embed-link-block > .embed-mode > button[aria-haspopup="menu"]');
    const nested = embeds.nested().find((x) => { const el = x.el(); return !!el && dom.contains(el); });
    if (nested) { nested.focusStart(); return true; }
    return click('.embed-header button[aria-label^="Open"], .embed-header button.embed-open') || click('a[data-embed-mode="link"], .embed-link');
  }

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
      if (am[1].endsWith(' ') && cur?.kind === 'link' && cur.from === from && cur.items.length > 0 && cur.items.every((x) => x.kind === 'create' || x.kind === 'create-as' || x.kind === 'pickDate')) {
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
            // FR-VLT-05 AC-3 (D-550): `Create "<q>" as…` right after the create row.
            const withAs = found.flatMap((x) => (x.kind === 'create' ? [x, { ...x, kind: 'create-as' }] : [x]));
            const items: Row[] = at ? withDates(q, withAs) : withAs;
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

  // ------------------------------------------------------------------ slice P: link chips (R103, FR-LNK-13)
  /** The open of a link chip as before slice P (D-140, FR-DLY-08 AC-6, 6A R74) or, broken, the Create offer. */
  function openLink(target: string, fragment: string | null, chip?: { pos: number; dom: HTMLElement | null }) {
    const r = links.current.get(target.normalize('NFC'));
    if ((r?.kind === 'daily' || r?.kind === 'date-missing') && openDate(target)) return; // FR-DLY-08 AC-6
    if (r?.path && (r.kind === 'note' || r.kind === 'daily' || r.kind === 'trashed')) cb.current.onOpen(r.path, fragment ? `#${fragment}` : undefined);
    else if (r?.kind === 'media' && r.object) cb.current.onOpen(r.object); // a file's Image or PDF object (FR-ATT-07)
    else if (r?.kind !== 'date-missing' && target && chip) offerFor(target, chip.pos, chip.dom); // FR-LNK-04 AC-4
  }
  const chipHost: EditorChipsHost = {
    editor: () => edRef.current,
    path: () => pathRef.current,
    resolve: (target) => links.current.get(target),
    open: (target, fragment, chip) => openLink(target, fragment, chip),
    offer: (target, chip) => offerFor(target, chip.pos, chip.dom),
    openTag: (key) => cb.current.onTag(key),
    relinked: () => { void resolveLinks(); },
  };
  const chips = useRef(editorChips(chipHost)).current;
  // R106: the palette's `Show preview`, `Edit link`, `Remove link` act on this editor's chip at the caret.
  useEffect(() => (host.current ? chips.register(host.current) : undefined), []);

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

  /** 4F (D-426): the `Embed object` picker, inserting at `from…to` (the typed `/emb`, or the caret). */
  const [picker, setPicker] = useState<{ at: { left: number; top: number }; pos: () => number | null; typed: string } | null>(null);
  // Saving waits while the picker is open: the typed `/emb` is a command, not text (FR-EMB-01 AC-8).
  const pickerOpen = useRef(false);
  pickerOpen.current = !!picker;
  const openPicker = (from: number, to: number) => {
    const e = edRef.current;
    if (!e) return;
    const c = e.view.coordsAtPos(Math.min(from, e.view.state.doc.content.size));
    // The typed `/query` is followed through every edit while the picker is open (its text is checked before use).
    const typed = to > from ? e.view.state.doc.textBetween(from, to) : '';
    setPicker({ at: { left: c.left, top: c.bottom + 4 }, pos: e.trackPos(from), typed });
  };
  /** The typed `/query`'s range now, or the caret when nothing was typed (palette). */
  const pickerRange = (p: NonNullable<typeof picker>, e: TeggEditor): [number, number] | null => {
    const from = p.pos();
    if (from === null) return null;
    if (!p.typed) return [from, from];
    const to = from + p.typed.length;
    if (to > e.view.state.doc.content.size || e.view.state.doc.textBetween(from, to) !== p.typed) return null;
    return [from, to];
  };
  const insertEmbedAt = (target: string) => {
    const e = edRef.current;
    const p = picker;
    setPicker(null);
    if (!e || !p) return;
    const r = pickerRange(p, e);
    // The typed `/emb` goes first, outside the history, so ⌘Z removes only the embed (FR-EMB-01 AC-8).
    if (r && r[1] > r[0]) e.view.dispatch(e.view.state.tr.delete(r[0], r[1]).setMeta('addToHistory', false));
    const at = r ? r[0] : e.view.state.selection.from;
    e.commands.insertEmbed(at, at, target);
    focusEditor();
  };
  const cancelPicker = () => {
    const e = edRef.current;
    const p = picker;
    setPicker(null);
    if (!e || !p) return;
    // Esc removes the typed `/emb` and leaves the paragraph as it was (FR-EMB-01 AC-8).
    const r = pickerRange(p, e);
    if (r && r[1] > r[0]) e.view.dispatch(e.view.state.tr.delete(r[0], r[1]).setMeta('addToHistory', false));
    focusEditor();
  };

  const chooseSlash = (item: SlashDef) => {
    const e = edRef.current;
    const s = live.current.slash;
    if (!e || !s || !item.status.built) return;
    // 6A (FR-ATT-01 AC-3): slash Image / PDF open the system file dialog; the files go at the caret.
    if (item.id === 'image' || item.id === 'pdf') {
      setSlash(null);
      dismissed.current = `s${s.from}`;
      e.view.dispatch(e.view.state.tr.delete(s.from, e.view.state.selection.from).setMeta('addToHistory', false));
      const tg = mediaTarget();
      if (tg) void pickMedia(tg, item.id === 'pdf' ? 'pdf' : 'image');
      return;
    }
    if (item.id === 'embedObject') {
      setSlash(null);
      dismissed.current = `s${s.from}`;
      openPicker(s.from, e.view.state.selection.from);
      return;
    }
    if (item.id === 'task' || item.id === 'turnIntoObject') {
      if (convertBlocked()) return;
      // FR-CNV-01 AC-2: the typed `/turn` or `/task` goes (outside the history), then R50 opens for the block.
      setSlash(null);
      dismissed.current = `s${s.from}`;
      e.view.dispatch(e.view.state.tr.delete(s.from, e.view.state.selection.from).setMeta('addToHistory', false));
      focusArea.current = 'body';
      openConvert(item.id === 'task' ? 'task' : 'last');
      return;
    }
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
  const chooseLink = async (row: Row, asType?: string) => {
    const e = edRef.current;
    const s = live.current.suggest;
    if (!e || !s || s.kind !== 'link') return;
    if (row.kind === 'create-as' && !asType) {
      // FR-VLT-05 AC-3: the `Type` menu chooses the type, then the row creates as the create row does.
      const c = e.view.coordsAtPos(s.from);
      setAsType({ row, at: { left: c.left, top: c.bottom + 4 } });
      return;
    }
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
    if (item.kind === 'create' || item.kind === 'create-as') {
      const type = asType ?? item.type;
      try {
        const ready = prepared.current?.key === type ? prepared.current.p : null;
        path = await (ready ? ready.create(title) : createObject(type, title));
      } catch {
        return;
      }
    }
    if (!path) return;
    const stem = path.split('/').pop()!.replace(/\.md$/, '');
    const r = await ipc.linkResolve(pathRef.current, [stem]).catch(() => []);
    const stemResolves = r[0]?.path?.normalize('NFC') === path.normalize('NFC');
    links.current.set(stemResolves ? stem.normalize('NFC') : path.replace(/\.md$/, '').normalize('NFC'), { kind: 'note', path, type: asType ?? item.type });
    // 4F (FR-EMB-01 AC-9, D-426): `![[` writes an embed with the D-184 target, never an alias.
    const bang = !s.at && s.from > 0 && e.view.state.doc.textBetween(s.from - 1, s.from) === '!';
    if (bang && embeds) {
      e.commands.insertEmbed(s.from - 1, e.view.state.selection.from, embedTarget({ path, title, fromPath: pathRef.current, stemResolves }));
      focusEditor();
      return;
    }
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

  // ------------------------------------------------------------------ 5A-2 block → object conversion (ms5-tasks §11.4)
  /** Where the focus last was: the note body, a nested embed editor, or elsewhere (the title, the panel). */
  const focusArea = useRef<'body' | 'embed' | 'other'>('other');
  useEffect(() => {
    const on = (ev: FocusEvent) => {
      const el = ev.target as HTMLElement | null;
      if (!el || el.closest?.('[role="dialog"], [role="alertdialog"], [role="menu"]')) return; // the palette, menus: unchanged
      if (host.current?.contains(el)) focusArea.current = el.closest('.embed-block') ? 'embed' : 'body';
      else focusArea.current = 'other';
    };
    document.addEventListener('focusin', on, true);
    return () => document.removeEventListener('focusin', on, true);
  }, []);
  /** `whole`: the block menu, which converts the whole top-level block (D-778), not the item with the caret. */
  const convertBlocked = (whole = false): string | null => {
    const e = edRef.current;
    if (!e || !e.editor.isEditable) return t('convert.readOnly');
    if (pathRef.current.startsWith('_templates/')) return t('convert.inTemplate');
    if (focusArea.current === 'embed') return t('convert.inEmbed');
    // D-778: an item of a mindmap becomes an object in v1.0; the whole block (a block selection) converts today.
    if (!whole && !e.blockSelection()) {
      const $f = e.view.state.selection.$from;
      for (let d = $f.depth; d > 0; d--) {
        const n = $f.node(d);
        if (n.type.name === 'callout' && String(n.attrs.calloutType).toLowerCase() === 'mindmap') return t('due.coming', { milestone: 'v1.0' });
      }
    }
    return null;
  };
  function convertHost(): ConvertHost | null {
    const e = edRef.current;
    if (!e) return null;
    return {
      ed: e,
      source: pathRef.current,
      daily: conv.current.daily ?? null,
      linkTitle: (tg) => links.current.get(tg.normalize('NFC'))?.title ?? null,
      flush: () => conv.current.flush?.() ?? Promise.resolve(),
    };
  }
  type Conv = { unit: ConvertUnit | null; title: string; type: string; count: number; at: { left: number; top: number } };
  const [convertOpen, setConvertOpen] = useState<Conv | null>(null);
  const openConvert = (preselect: 'task' | 'last') => {
    const e = edRef.current;
    if (!e || convertBlocked() || focusArea.current !== 'body') return;
    const unit = e.conversionUnit();
    const $f = e.view.state.selection.$from;
    // `/task` in an empty paragraph: a new empty object takes its place (FR-CNV-01 AC-2).
    if (!unit && !($f.depth === 1 && $f.parent.type.name === 'paragraph' && $f.parent.content.size === 0)) return;
    const title = unit ? objectFromUnit(e.text(), unit, (tg) => links.current.get(tg.normalize('NFC'))?.title ?? null).title : '';
    const bs = e.blockSelection();
    const k = bs ? bs.from : e.caretBlock();
    const el = blockEl(k);
    const r = wrap.current?.getBoundingClientRect();
    const b = el?.getBoundingClientRect();
    const at = r && b ? { left: b.left - r.left, top: b.bottom - r.top + 4 } : { left: 0, top: 0 };
    setConvertOpen({ unit, title, type: preselect === 'task' ? 'task' : convertPrefs().lastType ?? 'task', count: unit?.count ?? 1, at });
  };
  const [removeAsk, setRemoveAsk] = useState<{ items: { title: string; plural: string }[]; resolve: (ok: boolean) => void } | null>(null);
  /** D-496: only embeds of objects converted from this note ask before they are removed. */
  function guardRemoval(list: { pos: number; source: string }[]): Promise<boolean> | null {
    if (convertPrefs().skipRemoveConfirm || !embeds) return null;
    const host = pathRef.current.normalize('NFC');
    const names = new Set([host.replace(/\.md$/i, ''), host.replace(/\.md$/i, '').split('/').pop()!, ...(conv.current.daily ? [conv.current.daily] : [])]);
    const items: { title: string; plural: string }[] = [];
    for (const x of list) {
      const node = embeds.blockNodes(x.source.trim().replace(/^!\[\[|\]\]$/g, ''))[0];
      const text = node?.note?.text;
      if (!node || !text) continue;
      const src = parse(text).frontmatter?.data?.source;
      const m = typeof src === 'string' ? /^\[\[([^\]|#]*)/.exec(src.trim()) : null;
      if (!m || !names.has(m[1].trim().normalize('NFC'))) continue;
      items.push({ title: node.target.title ?? node.target.target, plural: conv.current.types.find((ty) => ty.key === node.target.type)?.plural ?? '' });
    }
    if (!items.length) return null;
    return new Promise((resolve) => setRemoveAsk({ items, resolve }));
  }

  const run = useCallback((a: EditAction) => {
    const e = edRef.current;
    if (!e) return;
    const c = e.commands;
    switch (a) {
      case 'turnIntoTask': openConvert('task'); break;
      // Slice MM (R94): the palette's `Show mindmap as map / list`.
      case 'mindmapMap': c.mindmapView('map'); break;
      case 'mindmapList': c.mindmapView('list'); break;
      // Slice MM2 (R97): the layout switch's palette commands.
      case 'mindmapLayoutRight': c.mindmapLayout('right'); break;
      case 'mindmapLayoutSpider': c.mindmapLayout('spider'); break;
      case 'turnIntoObject': openConvert('last'); break;
      case 'undo': c.undo(); break;
      case 'redo': c.redo(); break;
      case 'bold': case 'italic': case 'strike': case 'code': case 'highlight': c.toggleMark(a === 'strike' ? 'strike' : a); focusEditor(); break;
      case 'link': {
        // FR-LNK-13 AC-6: ⇧⌘K with the caret at a chip opens `Edit link`; elsewhere the link field as before.
        // The focused editor (the note's or an embedded note's, FR-LNK-13 AC-8) at its chip.
        if (!editorLinkAction('edit') && !editLinkAtCaret(chipHost)) openLinkField();
        break;
      }
      case 'moveBlockUp': c.moveBlock('up'); break;
      case 'moveBlockDown': c.moveBlock('down'); break;
      case 'blockMenu': openMenu(e.blockSelection()?.from ?? e.caretBlock()); break;
      case 'selectBlock': c.selectBlock(); break;
      case 'openOrToggle': {
        // D-209, D-428: ⌘↩ on a selected block embed opens its target.
        const sel = e.selectedEmbed();
        if (sel) { embedKey(sel.pos, 'open'); break; }
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
      // 6A (R75): ⇧⌘A / palette `Add image or PDF…`.
      case 'addMedia': { const tg = mediaTarget(); if (tg) void pickMedia(tg, 'any'); break; }
      // 4F (R32, D-428).
      case 'embedObject': {
        if (!embeds) break;
        const at = e.view.state.selection.from;
        openPicker(at, at);
        break;
      }
      case 'openEmbed': case 'displayEmbedAs': {
        const s = e.selectedEmbed();
        if (s) embedKey(s.pos, a === 'openEmbed' ? 'open' : 'displayAs');
        break;
      }
    }
  }, [openMenu]);

  const embedBlocks = (): { index: number; target: string }[] => {
    const e = edRef.current;
    if (!e) return [];
    const out: { index: number; target: string }[] = [];
    e.view.state.doc.forEach((n, _o, i) => {
      if (n.type.name !== 'rawBlock' || n.attrs.kind !== 'embed') return;
      const m = /^!\[\[([^\]|#]*)/.exec(String(n.attrs.source ?? '').trim());
      if (m && m[1].trim()) out.push({ index: i, target: m[1].trim() });
    });
    return out;
  };
  const selectBlockAtTop = (index: number): boolean => {
    const e = edRef.current;
    if (!e || index < 0 || index >= e.view.state.doc.childCount) return false;
    const align = () => {
      const ed = edRef.current;
      if (!ed) return;
      const dom = ed.view.nodeDOM(posOfBlock(ed, index)) as HTMLElement | null;
      const main = (ed.view.dom as HTMLElement).closest('main');
      if (!dom || !main) return;
      // Room below, so the block can sit at the top of a short note (FR-TSK-08 AC-2).
      const host = (ed.view.dom as HTMLElement).closest<HTMLElement>('.editor-host') ?? (ed.view.dom as HTMLElement);
      host.style.paddingBottom = `${main.clientHeight}px`;
      main.scrollTop += dom.getBoundingClientRect().top - main.getBoundingClientRect().top;
    };
    // After the page settled (the previous note's panel and the embeds' first layout), so the block shows selected
    // where it stays (FR-CNV-04 AC-2).
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const ed = edRef.current;
      if (!ed) return;
      (ed.view.dom as HTMLElement).focus({ preventScroll: true });
      if (!ed.commands.selectBlockAt(index)) return;
      align();
      requestAnimationFrame(align);
    }));
    return true;
  };
  useImperativeHandle(apiRef, () => ({ ed: edRef.current, run, focus: focusEditor, slashOpen: () => !!live.current.slash || !!pickerOpen.current, caretToStart, caretAtLink, caretToEnd, embedBlocks, selectBlockAtTop, convertBlocked }), [run, edRef.current]);

  // ------------------------------------------------------------------ keyboard in the editor (capture: before ProseMirror)
  const onKeyDownCapture = (e: React.KeyboardEvent) => {
    const ed = edRef.current;
    if (!ed || !host.current?.contains(e.target as Node)) return; // menus and fields handle their own keys
    // 4F: keys inside an embed (its nested editor, its menu) are the embed's own (D-428).
    if ((e.target as HTMLElement).closest?.('.embed-block') && host.current?.contains((e.target as HTMLElement).closest('.embed-block'))) return;
    // Slice MM: keys on a mindmap's map or header (its nodes, Map / List) are the map's own (D-770), never the text's.
    if ((e.target as HTMLElement).closest?.('[data-map-area], .mindmap-header')) return;
    const L = live.current;
    const stop = () => { e.preventDefault(); e.stopPropagation(); };
    // Slice P (FR-LNK-09 AC-6, AC-7; D-928, D-938): ⌥Space on a selected embed or figure previews its target.
    if (e.code === 'Space' && e.altKey && !e.metaKey && !e.ctrlKey && !e.shiftKey) {
      const bs = ed.blockSelection();
      const se = ed.selectedEmbed();
      const pos = se?.pos ?? (bs && bs.from === bs.to ? blockStart(ed, bs.from) : null);
      if (pos !== null && embedKey(pos, 'preview')) { stop(); return; }
    }
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
        else { const it = L.suggest.items[L.suggest.sel]; chooseTag(it ? it.name : L.suggest.query); }
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
      // Typing over a block selection replaces it (D-496: the removal guard asks for converted objects' embeds).
      if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
        stop();
        // D-606 (FR-EDT-02 AC-22): typing doesn't replace read-only tables; they are edited in the source view.
        const kids = [...ed.view.dom.children];
        if (kids.slice(bs.from, bs.to + 1).every((k) => k.hasAttribute('data-table-readonly'))) return;
        ed.commands.pasteText(e.key, true);
        return;
      }
    }
    // FR-CNV-05 AC-4: Tab on a selected Task card goes to its header controls (checkbox, Status, …, Display as).
    const se = e.key === 'Tab' && !e.shiftKey && !e.metaKey ? ed.selectedEmbed() : null;
    const card = se ? (ed.view.nodeDOM(se.pos) as HTMLElement | null)?.querySelector<HTMLElement>('[data-task-card]') : null;
    const first = card ? [...card.querySelectorAll<HTMLElement>('button, [role="checkbox"], a[href]')].find((x) => !x.closest('[data-embed-body]')) : null;
    if (first) { stop(); first.focus(); return; }
    if (e.key === 'Tab' && !e.metaKey) {
      // D-772: ⇧Tab on a mindmap's top-level item does nothing (the mindmap keeps one list).
      const $f = ed.view.state.selection.$from;
      if (e.shiftKey && $f.depth === 4 && $f.node(1).type.name === 'callout' && String($f.node(1).attrs.calloutType).toLowerCase() === 'mindmap' && $f.node(3).type.name === 'listItem') { stop(); return; }
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

  // D-605 (FR-EDT-05 AC-7): a right-click on a text selection opens Tegg's menu; anything else keeps the system menu.
  const onContextMenu = (ev: React.MouseEvent) => {
    const e = edRef.current;
    if (!e) return;
    const target = ev.target as HTMLElement;
    if (target.closest('pre, code')) return;
    const nested = target.closest<HTMLElement>('[data-embed-body] .ProseMirror');
    if (nested) {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || !nested.contains(sel.anchorNode)) return;
      ev.preventDefault();
      setCtxMenu({ x: ev.clientX, y: ev.clientY, nested });
      return;
    }
    if (!e.view.dom.contains(target)) return;
    const sel = e.view.state.selection;
    if (sel.empty || (sel as { node?: unknown }).node || sel.$from.parent.type.spec.code) return;
    ev.preventDefault();
    setCtxMenu({ x: ev.clientX, y: ev.clientY, nested: null });
  };
  const onSelectionAction = (a: SelectionAction, nested: HTMLElement | null) => {
    const e = edRef.current;
    if (!e) return;
    if (nested) {
      // A nested embed editor: the browser's editing commands and its own key bindings act on it.
      nested.focus();
      if (a === 'cut' || a === 'copy') document.execCommand(a);
      else if (a === 'paste') void navigator.clipboard.readText().then((txt) => { nested.focus(); document.execCommand('insertText', false, txt); }).catch(() => {});
      else if (a === 'bold' || a === 'italic' || a === 'strike' || a === 'code' || a === 'highlight') embeds?.nested().find((x) => { const el = x.el(); return !!el && (el === nested || el.contains(nested) || nested.contains(el)); })?.mark?.(a);
      return;
    }
    e.view.focus();
    if (a === 'cut' || a === 'copy') document.execCommand(a);
    else if (a === 'paste') void navigator.clipboard.readText().then((txt) => { e.view.focus(); e.view.pasteText(txt); }).catch(() => {});
    else if (a === 'link') openLinkField();
    else if (a === 'turnIntoObject') { focusArea.current = 'body'; run('turnIntoObject'); }
    else run(a);
  };

  return (
    <div ref={wrap} className="editor-wrap" onKeyDownCapture={onKeyDownCapture} onMouseDownCapture={onMouseDownCapture} onMouseMove={onMouseMove} onMouseLeave={() => setHover(null)} onContextMenu={onContextMenu}>
      {ctxMenu && (
        <SelectionMenu x={ctxMenu.x} y={ctxMenu.y}
          disabled={ctxMenu.nested ? { link: t('menu.notInEmbed'), turnIntoObject: t('menu.notInEmbed') } : { turnIntoObject: convertBlocked() ?? undefined }}
          onClose={() => { const n = ctxMenu.nested; setCtxMenu(null); if (n) n.focus(); else focusEditor(); }} onAction={(a) => onSelectionAction(a, ctxMenu.nested)} />
      )}
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
          <button type="button" tabIndex={-1} data-command="edit.turnIntoObject" aria-label={t('ctl.turnIntoObject')} title={t('ctl.turnIntoObject')}
            aria-disabled={convertBlocked() ? 'true' : undefined} aria-description={convertBlocked() ?? undefined}
            onMouseDown={(ev) => ev.preventDefault()} onClick={() => { focusArea.current = 'body'; run('turnIntoObject'); }}>
            <Icon name="object" />
          </button>
        </div>
      )}
      {slash && e2 && (
        <SlashMenu slash={slash} pos={caretPos(slash.from)} blocked={convertBlocked()} onPick={chooseSlash} onSel={(i) => setSlash({ ...slash, sel: i })} />
      )}
      {suggest && e2 && (
        <Suggestions s={suggest} types={types} pos={caretPos(suggest.from)} onLink={(i) => void chooseLink(i)} onTag={chooseTag} />
      )}
      {asType && (
        <TypeMenu at={asType.at} onClose={() => { setAsType(null); focusEditor(); }}
          onChoose={(ty) => { const row = asType.row; setAsType(null); void chooseLink(row, ty.key); }} />
      )}
      {convertOpen && (
        <ConvertPopover at={convertOpen.at} types={types} title={convertOpen.title} type={convertOpen.type} count={convertOpen.count}
          onCancel={() => { setConvertOpen(null); edRef.current?.clearBlockSelection(); focusEditor(); }}
          onConvert={(choice) => {
            const c = convertOpen;
            setConvertOpen(null);
            focusEditor();
            const h = convertHost();
            if (h) void runConvert(h, c.unit, choice.title, choice.type);
          }} />
      )}
      {removeAsk && (
        <RemoveEmbedDialog items={removeAsk.items} onAnswer={(remove, dontAsk) => {
          const r = removeAsk;
          setRemoveAsk(null);
          if (remove && dontAsk) setConvertPrefs({ skipRemoveConfirm: true });
          r.resolve(remove);
          focusEditor();
        }} />
      )}
      {picker && (
        <EmbedPicker from={path} types={types} at={picker.at} onChoose={insertEmbedAt} onCancel={cancelPicker} />
      )}
      {pick && suggest && (
        // D-763 (FR-DLY-08 AC-9): `Pick a date…` opens the app's date picker at the caret, without `No date`.
        <PickDate label={t('date.pick')} today={localDate(Date.now())} value={null} at={pick.at} onPick={insertDate}
          onClose={() => { setPick(null); focusEditor(); }} />
      )}
      {menu && e2 && (
        <BlockMenu menu={menu} ed={e2} wrapRect={wrapRect} convertWhy={convertBlocked(true)}
          onConvert={() => { setMenu(null); focusEditor(); focusArea.current = 'body'; if (!e2.blockSelection()) e2.commands.selectBlockAt(menu.block); openConvert('last'); }}
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

/** 5A-2: the conversion items, unavailable with a reason (D-494). */
const CONVERT_ITEMS = new Set(['task', 'turnIntoObject']);

function SlashMenu({ slash, pos, blocked, onPick, onSel }: { slash: Slash; pos: { left: number; top: number }; blocked: string | null; onPick: (i: SlashDef) => void; onSel: (i: number) => void }) {
  const items = slashMatches(slash.query);
  let lastGroup = '';
  return (
    <div className="popover slash-menu" style={pos}>
      <div role="listbox" aria-label={t('slash.label')}>
        {items.length === 0 && <div className="empty" role="presentation">{t('slash.empty')}</div>}
        {items.map((it, i) => {
          const header = !slash.query && it.group !== lastGroup ? t(`slash.group.${it.group}`) : null;
          lastGroup = it.group;
          const why = blocked && CONVERT_ITEMS.has(it.id) ? blocked : null;
          const disabled = !it.status.built || !!why;
          return (
            <div key={it.id} role="presentation">
              {header && <div className="group-header" role="presentation">{header}</div>}
              <div role="option" aria-label={t(it.label)} aria-selected={i === slash.sel} aria-disabled={disabled || undefined}
                aria-description={why ?? (disabled && it.due ? t('due.coming', { milestone: showDue(it.due) }) : SLASH_DESC[it.id] ? t(SLASH_DESC[it.id]) : undefined)}
                className={`option ${i === slash.sel ? 'selected' : ''} ${disabled ? 'disabled' : ''}`}
                onMouseDown={(e) => e.preventDefault()}
                onMouseMove={() => !disabled && i !== slash.sel && onSel(i)}
                onClick={() => !disabled && onPick(it)}>
                {SLASH_DESC[it.id] && !disabled ? (
                  <span className="slash-two-lines"><span>{t(it.label)}</span><span className="slash-desc">{t(SLASH_DESC[it.id])}</span></span>
                ) : <span>{t(it.label)}</span>}
                {why ? <span className="due">{why}</span> : disabled && <Due due={it.due} />}
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
  const isCreate = (x: SwitcherItemDto) => x.kind === 'create' || x.kind === 'create-as';
  return [...dates, ...found.filter((x) => !isCreate(x)), pickRow, ...found.filter(isCreate)];
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
            const create = it.kind === 'create' || it.kind === 'create-as';
            const label = it.kind === 'create-as' ? t('create.as', { query: it.title }) : create ? t('suggest.create', { query: it.title }) : undefined;
            return (
              <div key={`${it.kind}:${it.path ?? it.title}`} role="option" aria-selected={i === s.sel} aria-label={label}
                className={`option ${i === s.sel ? 'selected' : ''}`} onMouseDown={(e) => e.preventDefault()} onClick={() => onLink(it)}>
                {create ? <span>{label}</span> : (
                  <>
                    <Icon name={chipIcon(it.type).glyph} />
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
            style={it.color ? { color: `var(--type-${it.color})` } : undefined}
            onMouseDown={(e) => e.preventDefault()} onClick={() => onTag(it.name)}>
            <span data-user-content style={tagChipStyle(it.color)}>#{it.name}</span>
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

function BlockMenu({ menu, ed, wrapRect, convertWhy, onConvert, onSub, onClose }: { menu: NonNullable<Menu>; ed: TeggEditor; wrapRect: DOMRect | undefined; convertWhy: string | null; onConvert: () => void; onSub: (s: NonNullable<Menu>['sub']) => void; onClose: () => void }) {
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
  const item = (label: string, onClick: (() => void) | null, opts: { disabled?: boolean; description?: string; key?: string; checked?: boolean } = {}) => (
    <div key={opts.key ?? label} role="menuitem" tabIndex={-1} aria-label={label} aria-disabled={opts.disabled || undefined} aria-description={opts.description} aria-checked={opts.checked}
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
            {item(t('ctl.turnIntoObject'), onConvert, { disabled: !!convertWhy, description: convertWhy ?? undefined })}
          </>
        )}
        {menu.sub === 'turnInto' && (
          <>
            {TURN_INTO.map((x) => {
              // D-768: `Mindmap` for one list, one text block or a selection of text blocks; disabled for a mix.
              if (x.kind === 'mindmap') {
                const offer = ed.commands.canTurnIntoMindmap();
                if (offer === 'no') return null;
                return item(t(x.label), act(() => ed.commands.turnInto('mindmap')), { key: x.label, disabled: offer === 'disabled' });
              }
              return item(t(x.label), act(() => ed.commands.turnInto(x.kind, { level: x.level })), { key: x.label });
            })}
            {item(t('blockMenu.calloutType'), () => onSub('calloutType'))}
          </>
        )}
        {menu.sub === 'calloutType' && (() => {
          // R94: 14 entries, `Mindmap` last; the block's own type is checked.
          const cur = state.doc.child(range.from);
          const now = cur.type.name === 'callout' ? String(cur.attrs.calloutType).toLowerCase() : null;
          return [...CALLOUT_TYPES, 'mindmap'].map((ty) => item(`${t(`callout.${ty}`)} (${ty})`, act(() => ed.commands.setCalloutType(ty)), { key: ty, checked: now === null ? undefined : now === ty }));
        })()}
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
              <Icon name={chipIcon(it.type).glyph} />
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

function posOfBlock(e: { view: { state: { doc: { childCount: number; child: (i: number) => { nodeSize: number } } } } }, index: number): number {
  let p = 0;
  for (let i = 0; i < index; i++) p += e.view.state.doc.child(i).nodeSize;
  return p;
}
