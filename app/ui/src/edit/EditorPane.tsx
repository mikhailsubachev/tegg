// The note body as the editor (slice 3C, docs/contracts/ms3-shell.md §13, editor.md R6–R8): block handles and the
// block menu (FR-EDT-01 AC-3…AC-6), the slash menu (FR-EDT-03), the formatting toolbar and link field (FR-EDT-05),
// `[[` and `#` autocomplete (FR-EDT-06, -15), block selection (FR-EDT-13) and paste notices (FR-EDT-14). The editor
// itself is @tegg/editor; every visible text comes from the catalog (NFR-OTH-02).
import { importOpen } from '../import/store';
import { chipPinRequest } from '../pinned/editorDrag';
import { startPinDrag } from '../pinned/drag';
import { TypeMenu } from '../shell/TypeMenu';
import { useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type Ref } from 'react';
import { createEditor, createProbeTrigger, embedTarget, leaveCodeBlock, linkTarget, noteHref, type ChipExtra, type EditorUi, type LinkInfo, type TeggEditor } from '@tegg/editor';
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
import { Icon, iconElement, typeIconName } from '../shell/Icon';
import { eventKeys } from '../shell/keys';
import { headingForFragment } from '@tegg/doc';
import { startFlash } from '../outline/jump';
import { jumpTop } from '../outline/model';
import { invalidateTracker, rendered, viewportTop } from '../outline/tracker';
import { SHORTCUTS } from '../shell/registry';
import { firstRow, menuRows, type MenuRow } from './slashMenu';
import { NewObjectDialog } from './NewObjectDialog';
import { SlashMenu, type Slash } from './SlashMenuView';
import { isPhone } from '../phone/layout';
import { phoneSlashItems } from '../phone/commands';
import { chooseType } from '../phone/chooser';
import { FormatBar } from '../phone/FormatBar';
import { keepCaretInView } from '../phone/caret';
import { nativeState, onNative } from '../phone/native';
import { installPhoneInput } from './phoneInput';
import { pushAlert } from '../convert/alerts';
import { objectFromUnit, parse, type ConvertUnit } from '@tegg/doc';
import { ConvertPopover, RemoveEmbedDialog } from '../convert/ConvertPopover';
import { conversionHooks, convert as runConvert, type ConvertHost } from '../convert/flow';
import { convertPrefs, setConvertPrefs } from '../convert/prefs';
import { tagChipStyle } from '../theme/tagChip';
import { mindmapUi } from '../mindmap/mount';
import { frontmatterId, mountQueryBlock, openQueryBlockAt, ordinalAt, refreshQueryBlocks } from '../queries/mount';
import { openQueryPicker } from '../queries/QueryPicker';
import { noteTitle } from '../read/ReadView';
import { editLinkAtCaret, editorChips, type EditorChipsHost } from '../preview/editorChips';
import { editorLinkAction } from '../preview/editorLink';
import { getCurrent as currentPreview, show as showPreview } from '../preview/store';

export type EditAction =
  | 'undo' | 'redo' | 'bold' | 'italic' | 'strike' | 'code' | 'highlight' | 'link' | 'moveBlockUp' | 'moveBlockDown'
  | 'blockMenu' | 'selectBlock' | 'openOrToggle' | 'pastePlain' | 'saveNow' | 'embedObject' | 'openEmbed' | 'displayEmbedAs'
  | 'turnIntoTask' | 'turnIntoObject' | 'addMedia' | 'mindmapMap' | 'mindmapList' | 'mindmapLayoutRight' | 'mindmapLayoutSpider' | 'insertQuery';

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
  /** Slice OL (v1-outline §3.4): the jump to a heading of `outline()` at `version`. 'stale' changes nothing. */
  jumpToHeading: (version: number, pos: number) => 'ok' | 'stale';
  /** Esc in the outline's tree or card (R174, D-1618): the focus back to the body with its selection; no scroll moves. */
  refocus: () => void;
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

/** The `New <type>` dialog (R236): the type, and the trigger and query it replaces (`from…to`, their text). */
type NewObj = { type: TypeDefDto; from: number; to: number; text: string };
/** 4B (D-331, ms4-daily §6.4): the `@` list adds date rows and `Pick a date…` (rows of kind `date` / `pickDate`). */
type Row = SwitcherItemDto | { kind: 'date'; title: string; date: string; path: null; type: 'daily-note'; matched_alias: null; duplicate: null } | { kind: 'pickDate'; title: string; path: null; type: ''; matched_alias: null; duplicate: null };
type Suggest = { kind: 'link'; from: number; to: number; query: string; items: Row[]; sel: number; at?: boolean }
  | { kind: 'tag'; from: number; to: number; query: string; items: TagRowDto[]; sel: number };
type Menu = { block: number; sub: null | 'turnInto' | 'calloutType'; x: number; y: number } | null;
type LinkField = { query: string; items: SwitcherItemDto[]; sel: number; error: boolean; onLink: boolean } | null;


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
  /** Slice AND-3 (android-edit §7.6, RA14): the phone's editor leaves out the block handles, menus and toolbars. */
  const phone = isPhone();
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
      if (!ed || !tg || !e.payload?.paths?.length || importOpen()) return; // slice I2 (§12 (8)): the Import window takes drops
      // Tauri reports physical pixels; accept logical ones too (the point must fall on the editor either way).
      const r = ed.view.dom.getBoundingClientRect();
      const inside = (px: number, py: number) => px >= r.left && px <= r.right && py >= r.top && py <= r.bottom;
      const dpr = window.devicePixelRatio || 1;
      const { x: px, y: py } = e.payload.position;
      const [x, y] = inside(px / dpr, py / dpr) ? [px / dpr, py / dpr] : [px, py];
      if (!inside(x, y)) return;
      const at = ed.view.posAtCoords({ left: x, top: y })?.pos;
      void addMedia(tg, { kind: 'paths', paths: e.payload.paths }, at);
    }, { target: { kind: 'AnyLabel', label: 'main' } }); // the main window's drops only, not the capture window's
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
  const cb = useRef({ onChange, onOpen, onTag, onExternal, onImagePaste, flush });
  cb.current = { onChange, onOpen, onTag, onExternal, onImagePaste, flush };
  const conv = useRef({ flush, daily, types });
  conv.current = { flush, daily, types };

  const [hover, setHover] = useState<number | null>(null);
  const [slash, setSlash] = useState<Slash | null>(null);
  const [newObj, setNewObj] = useState<NewObj | null>(null);
  const newObjOpen = useRef(false);
  const newObjInserting = useRef(false);
  newObjOpen.current = !!newObj || newObjInserting.current;
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
      // Slice AND-3 (android-edit §13.2, §7.7): on the phone a chip is a link in the note's text (exempt, as AND-2's
      // read view); `edit.openOrToggle` stays hidden there, so the chip carries no command.
      ...(phone ? { chipCommand: null } : {}),
      onExternal: (url) => cb.current.onExternal(url),
      // Slice Q (v1-queries §3.2): query blocks are drawn by the app; ⌘↩ on a selected one opens its editor (R144).
      // Slice Q2.1 (v1-views §18, CP-16): each block is a usage keyed by the note's `id` (else its path) and its place.
      query: (source, dom, ctl) => mountQueryBlock(source, dom, ctl, {
        path: () => pathRef.current, dropDraft: (pos) => { edRef.current?.commands.dropQueryDraft(pos); },
        note: () => ({ id: frontmatterId(String(edRef.current?.view.state.doc.attrs.frontmatter ?? '')), path: pathRef.current }),
        ordinal: (pos) => { const e = edRef.current; return e ? ordinalAt(e.queryBlocks(), pos) : null; },
      }),
      onQueryKey: (pos) => openQueryBlockAt(pos),
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
        // Slice AND-3 (android-edit §5.2, FR-MMP-02 AC-37): the phone never edits a mindmap callout.
        ...(phone ? { protectMindmaps: true } : {}),
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

  // Slice Q: a renamed host (the page follows it) gives its query blocks the new path for `this`.
  useEffect(() => { refreshQueryBlocks(); }, [path]);

  // Link chips: one link_resolve call for the note's targets, then one per new target (NFR-PERF-05 AC-3).
  const resolving = useRef(false);
  /** A change arrived while a resolve was in flight: resolve once more when it ends (bug emptyconv: a target inserted
   *  meanwhile, such as a conversion's new embed, was never resolved and its embed stayed broken until a reload). */
  const resolveAgain = useRef(false);
  const resolveLinks = useCallback(async () => {
    const ed = edRef.current;
    if (!ed) return;
    if (resolving.current) { resolveAgain.current = true; return; }
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
    if (resolveAgain.current) { resolveAgain.current = false; void resolveLinks(); return; }
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
  // and the tree is rebuilt (the core's own writes don't come back as vault:changed).  // D-1356 (FR-EDT-01 AC-14): a click in the note's empty area below the last block puts the caret in a new empty
  // paragraph after it (never written while empty, AC-3); below a last paragraph or heading, at its end (a virtual
  // Daily Note, which ends with a template heading, stays untouched, D-326).
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const ed = edRef.current;
      const root = wrap.current;
      if (!ed || !root || e.button !== 0 || e.shiftKey || e.metaKey || e.ctrlKey || e.altKey || !ed.editor.isEditable) return;
      const target = e.target instanceof Element ? e.target : null;
      const main = root.closest('main');
      // Only the editor itself and the empty layout around it (its ancestors in `main`), never a sibling below it such as
      // Backlinks or a virtual Daily Note's sections.
      if (!target || !main || !main.contains(target) || !(root.contains(target) || target.contains(root))) return;
      if (target.closest('button, a, input, textarea, select, [role="button"], [role="menu"], [role="dialog"], [role="listbox"], [contenteditable="false"]') && !ed.view.dom.contains(target)) return;
      const kids = [...ed.view.dom.children];
      const last = kids[kids.length - 1];
      if (!last) return;
      const host = ed.view.dom.getBoundingClientRect();
      if (e.clientY <= last.getBoundingClientRect().bottom || e.clientX < host.left - 40 || e.clientX > host.right + 40) return;
      e.preventDefault();
      const { state } = ed.view;
      const end = state.doc.lastChild;
      if (end && end.isTextblock && end.type.name !== 'codeBlock') {
        ed.editor.commands.setTextSelection(state.doc.content.size - 1);
      } else {
        const at = state.doc.content.size;
        ed.view.dispatch(state.tr.insert(at, state.schema.nodes.paragraph.create()).setMeta('teggEmptyBlock', true).setMeta('addToHistory', false));
        ed.editor.commands.setTextSelection(at + 1);
      }
      ed.view.focus();
    };
    document.addEventListener('mousedown', onDown, true);
    return () => document.removeEventListener('mousedown', onDown, true);
  }, []);


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
    if (key === 'open') return click('.embed-header button[aria-label^="Open"], .embed-header button.embed-open, .card-title button[aria-label^="Open"]') || click('a[data-embed-mode="link"], .embed-link') || openEmbedTarget(String(e.view.state.doc.nodeAt(pos)?.attrs.source ?? ''));
    if (key === 'displayAs') return click('.embed-header button[aria-haspopup="menu"], .card-title .embed-mode > button[aria-haspopup="menu"], .embed-link-block > .embed-mode > button[aria-haspopup="menu"]');
    const nested = embeds.nested().find((x) => { const el = x.el(); return !!el && dom.contains(el); });
    if (nested) { nested.focusStart(); return true; }
    return click('.embed-header button[aria-label^="Open"], .embed-header button.embed-open, .card-title button[aria-label^="Open"]') || click('a[data-embed-mode="link"], .embed-link');
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
    // Slice AND-3 (android-edit §5.3, NFR-PERF-06 AC-8): `beforeinput` insertText too, for keyboards that send 229.
    const trigger = createProbeTrigger();
    const onKey = (e: Event) => {
      if (!trigger.starts(e) || !probeOn()) return;
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
    el.addEventListener('beforeinput', onKey, true);
    return () => { el.removeEventListener('keydown', onKey, true); el.removeEventListener('beforeinput', onKey, true); };
  }, []);

  // FR-UX-04 AC-9: a panel opening (or closing) changes what covers `main`; the caret's line moves back above it.
  const panelOpen = phone && !!(suggest || slash || linkField);
  useLayoutEffect(() => {
    if (!phone) return undefined;
    const main = wrap.current?.closest('main') as HTMLElement | null;
    const keep = () => { const ed = edRef.current; if (ed && !ed.view.isDestroyed) keepCaretInView(ed.view, main); };
    keep();
    if (!panelOpen || typeof ResizeObserver === 'undefined') return undefined;
    // The panel's rows arrive after it opens, so it grows: the caret is kept above it as it does.
    const ro = new ResizeObserver(keep);
    main?.querySelectorAll('.phone-panel, .phone-link-panel').forEach((el) => ro.observe(el));
    return () => ro.disconnect();
  }, [panelOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  // ------------------------------------------------------------------ the phone (slice AND-3, android-edit §8, §9)
  // The bar shows while the keyboard is up and the body has the focus; the caret stays between the app bar and it.
  const [barOn, setBarOn] = useState(false);
  useEffect(() => {
    if (!phone) return undefined;
    const main = () => wrap.current?.closest('main') as HTMLElement | null;
    const caret = () => { const ed = edRef.current; if (ed && ed.view.hasFocus()) keepCaretInView(ed.view, main()); };
    const check = () => {
      const ed = edRef.current;
      const on = !!ed && nativeState().keyboard && document.activeElement === ed.view.dom;
      setBarOn(on);
      document.documentElement.toggleAttribute('data-format-bar', on);
      // §10.1 (FR-EDT-06 AC-14): the keyboard hiding, or the focus leaving the body (a tap outside the text), closes an
      // open panel as Esc does; the trigger stays as text.
      const a = document.activeElement;
      const away = !!ed && (!a || a === document.body || (!!a.closest('main, header') && !wrap.current?.contains(a))); // not a sheet the panel opened
      if (!nativeState().keyboard || away) {
        const L = live.current;
        if (L.suggest) {
          dismissed.current = L.suggest.kind === 'link' ? `${L.suggest.at ? 'a' : 'l'}${L.suggest.from}` : `t${L.suggest.from}:${L.suggest.query}`;
          setSuggest(null);
        }
        if (L.slash) { dismissed.current = `s${L.slash.from}`; setSlash(null); }
      }
      requestAnimationFrame(caret);
    };
    const later = () => setTimeout(check, 0);
    const off = onNative(check);
    document.addEventListener('focusin', check);
    document.addEventListener('focusout', later);
    window.visualViewport?.addEventListener('resize', caret);
    window.addEventListener('resize', caret);
    let unInput: (() => void) | null = null;
    let unTx: (() => void) | null = null;
    const attach = () => {
      const ed = edRef.current;
      if (!ed || unInput) return;
      unInput = installPhoneInput(ed, { onImagePaste: () => cb.current.onImagePaste() });
      const tx = () => requestAnimationFrame(caret);
      ed.editor.on('transaction', tx);
      unTx = () => ed.editor.off('transaction', tx);
    };
    attach();
    const poll = setInterval(() => { attach(); if (unInput) clearInterval(poll); }, 50);
    check();
    // §7.7 (FR-TSK-11 AC-5): a tap on a checklist item's box toggles that item with `pointerdown` prevented, so neither
    // the caret nor the keyboard moves, and saves at once (a discrete action, like a task checkbox; build point). Inside
    // a mindmap nothing toggles (§5.2). An engine that still sends the compatibility `mousedown` toggles through the
    // box's own handler; the click then only saves.
    const box = (e: Event) => {
      const el = (e.target as Element | null)?.closest?.('.checklist-item .check') ?? null;
      return el && !el.closest('[data-callout="mindmap"]') && wrap.current?.contains(el) ? el : null;
    };
    let byMouse = false;
    // Only the compatibility `mousedown` is prevented (the caret and the keyboard stay): an engine that sees
    // `pointerdown` prevented sends no click after a touch (WebKit). Nothing is toggled here before the click: a tap
    // whose `mousedown` reaches the box's own handler toggles there (`byMouse`).
    const onPointerDown = (_e: Event) => { byMouse = false; };
    const onMouseDown = (e: Event) => { if (box(e)) { byMouse = true; e.preventDefault(); } };
    const onClick = (e: Event) => {
      const el = box(e);
      const ed = edRef.current;
      if (!el || !ed) return;
      e.preventDefault();
      if (!byMouse) {
        const content = el.closest('.checklist-item')?.querySelector(':scope > .li-content');
        if (content) {
          const $p = ed.view.state.doc.resolve(ed.view.posAtDOM(content, 0));
          for (let d = $p.depth; d > 0; d--) {
            const node = $p.node(d);
            if (node.attrs.checked === null || node.attrs.checked === undefined) continue;
            ed.view.dispatch(ed.view.state.tr.setNodeMarkup($p.before(d), undefined, { ...node.attrs, checked: !node.attrs.checked }));
            break;
          }
        }
      }
      byMouse = false;
      void cb.current.flush?.();
    };
    // §7.6 (FR-EDT-01 AC-16): a tap in the text puts the caret where the finger was, as Android does; an engine that
    // snaps it to the word's end (WebKit) is corrected once it has placed it. Not for a drag, a long press or a control.
    let touch: { x: number; y: number; t: number } | null = null;
    const onTouchStart = (e: TouchEvent) => {
      const p = e.touches.length === 1 ? e.touches[0] : null;
      touch = p ? { x: p.clientX, y: p.clientY, t: performance.now() } : null;
    };
    const onTouchEnd = (e: TouchEvent) => {
      const s0 = touch;
      touch = null;
      const p = e.changedTouches[0];
      const ed = edRef.current;
      if (!s0 || !p || !ed || performance.now() - s0.t >= 500 || Math.hypot(p.clientX - s0.x, p.clientY - s0.y) > 10) return;
      const target = e.target as Element | null;
      if (!target || !ed.view.dom.contains(target) || target.closest('button, a, [role="checkbox"], [contenteditable="false"], .check, [data-wikilink], .tag')) return;
      const { clientX: x, clientY: y } = p;
      setTimeout(() => {
        const e2 = edRef.current;
        if (!e2 || e2.view.isDestroyed || !e2.view.hasFocus() || !e2.view.state.selection.empty) return;
        const at = e2.view.posAtCoords({ left: x, top: y });
        if (at && at.inside >= -1 && at.pos !== e2.view.state.selection.head) e2.editor.commands.setTextSelection(at.pos);
      }, 0);
    };
    const w = wrap.current;
    w?.addEventListener('touchstart', onTouchStart, { capture: true, passive: true });
    w?.addEventListener('touchend', onTouchEnd, { capture: true, passive: true });
    w?.addEventListener('pointerdown', onPointerDown, true);
    w?.addEventListener('mousedown', onMouseDown, true);
    w?.addEventListener('click', onClick);
    return () => {
      w?.removeEventListener('touchstart', onTouchStart, true);
      w?.removeEventListener('touchend', onTouchEnd, true);
      w?.removeEventListener('pointerdown', onPointerDown, true);
      w?.removeEventListener('mousedown', onMouseDown, true);
      w?.removeEventListener('click', onClick);
      off(); clearInterval(poll); unInput?.(); unTx?.();
      document.removeEventListener('focusin', check);
      document.removeEventListener('focusout', later);
      window.visualViewport?.removeEventListener('resize', caret);
      window.removeEventListener('resize', caret);
      document.documentElement.removeAttribute('data-format-bar');
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
    // Slash menu: `/` at a block start or after a space (FR-EDT-03 AC-1); `+` at a block start or after whitespace,
    // never in code, inline code or a link's text (new-object-menu.md R235; D-2610, D-2625, D-2626).
    const sm = !inCode && sel.empty ? /(^|[\s.,;:!?)])\/([^\s/￼]*)$/.exec(before) : null;
    const pm0 = !sm && !inCode && sel.empty ? /(^|\s)\+([^\s+￼]*)$/.exec(before) : null;
    const pm = pm0 && !state.doc.resolve($f.pos - pm0[2].length).marks().some((m) => m.type.name === 'code' || m.type.name === 'link') ? pm0 : null;
    const trig = sm ? { ch: '/' as const, q: sm[2] } : pm ? { ch: '+' as const, q: pm[2] } : null;
    if (trig && $f.parent.type.name !== 'calloutTitle' && !newObjOpen.current) {
      const from = $f.pos - trig.q.length - 1;
      if (dismissed.current !== `s${from}`) {
        const cur = live.current.slash;
        if (!cur || cur.from !== from || cur.query !== trig.q || cur.trigger !== trig.ch) setSlash({ from, query: trig.q, sel: firstRow(slashRows(trig.ch, trig.q), trig.ch, trig.q), trigger: trig.ch });
      } else if (live.current.slash) setSlash(null);
    } else {
      if (live.current.slash) setSlash(null);
      // The trigger is gone (⌫, the caret moved on): a `/` or `+` typed there again opens the menu again.
      if (dismissed.current?.startsWith('s') && !newObjOpen.current) dismissed.current = null;
    }
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
    // Slice AND-3 (§10.1): on the phone a closed link list opens again once its trigger is gone and typed again.
    if (phone && !lm && dismissed.current && /^[la]/.test(dismissed.current)) dismissed.current = null;
    // `#` autocomplete: the caret right after a tag the user is typing (FR-EDT-15 AC-1).
    const nb = sel.empty ? $f.nodeBefore : null;
    // Slice AND-3 (android-edit §8 `Tag`, §10.1; FR-EDT-15 AC-7): on the phone a bare `#` (the bar's Tag, or a tag's
    // last letter deleted) opens the list with every tag.
    const bare = phone && !inCode && sel.empty && /(^|[\s(])#$/.test(before);
    // On the phone a closed tag list opens again once the caret has left that tag (as the link list above).
    if (phone && dismissed.current?.startsWith('t')) {
      const here = nb?.type.name === 'tag' ? `t${$f.pos - nb.nodeSize}:${String(nb.attrs.value)}` : bare ? `t${$f.pos - 1}:` : null;
      if (here !== dismissed.current) dismissed.current = null;
    }
    if (!inCode && (nb?.type.name === 'tag' || bare)) {
      const from = bare ? $f.pos - 1 : $f.pos - nb!.nodeSize;
      const q = bare ? '' : String(nb!.attrs.value);
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
    // D-1625: `#Heading` resolves with the outline's heading list, by position.
    if (want && !want.startsWith('^')) {
      const o = ed.outline();
      const i = headingForFragment(o.headings, fragment!);
      if (i !== null && o.heading[i]) pos = o.pos[i] + 1;
    }
    state.doc.descendants((n, p) => {
      if (pos !== null) return false;
      if (n.type.name === 'rawBlock' || (n.isAtom && n.isBlock)) return false; // read-only blocks (D-191)
      if (n.isTextblock) {
        if (first === null) first = p + 1;
        if (pos === null && want && !want.startsWith('^') && n.type.name === 'heading' && n.textContent.normalize('NFC').toLowerCase() === want) pos = p + 1;
        // D-1197: a `#^id` open puts the caret in the block that ends with ` ^id` (read-view FR-EDT-02 AC-7).
        if (want?.startsWith('^') && n.textContent.normalize('NFC').trimEnd().toLowerCase().endsWith(` ${want}`)) pos = p + 1;
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

  /** Slice OL (§3.4 steps 3, 5; CP-2): reveal, instant scroll to JUMP_TOP, the caret at the end of the heading's text and
   *  the focus in the body (a heading in a read-only block: focus only), the flash. Writes nothing. */
  const jumpToHeading = (version: number, pos0: number): 'ok' | 'stale' => {
    const ed = edRef.current;
    if (!ed) return 'stale';
    const pos = ed.headingPos(version, pos0);
    if (pos === null) return 'stale';
    if (ed.revealPos(pos)) invalidateTracker();
    const node = ed.view.state.doc.nodeAt(pos);
    const main = host.current?.closest('main') as HTMLElement | null;
    const place = () => {
      const el = rendered(ed.view.nodeDOM(pos) as HTMLElement | null);
      if (!el || !main) return;
      const top = el.getBoundingClientRect().top - viewportTop(main);
      main.scrollTop = jumpTop(top, main.scrollTop, main.scrollHeight - main.clientHeight);
    };
    (ed.view.dom as HTMLElement).focus({ preventScroll: true });
    if (node?.type.name === 'heading') ed.editor.commands.setTextSelection(pos + node.nodeSize - 1); // a selection: no step
    place();
    requestAnimationFrame(place);
    const track = ed.trackPos(pos);
    startFlash((phase) => {
      const at = track();
      if (phase === 'off' || at === null) { ed.flash(null); return; }
      ed.flash(at, phase === 'on' ? 'data-outline-flash' : 'data-outline-fade');
      // The highlight's own style is resolved now, so the fade that follows is a transition from it.
      const el = ed.view.nodeDOM(at);
      if (phase === 'on' && el instanceof HTMLElement) void getComputedStyle(el).backgroundColor;
    });
    return 'ok';
  };
  const refocus = () => {
    const ed = edRef.current;
    if (!ed) return;
    const kept: [Element, number][] = [];
    for (let e: Element | null = ed.view.dom; e; e = e.parentElement) if (e.scrollTop) kept.push([e, e.scrollTop]);
    const restore = () => { for (const [e, top] of kept) e.scrollTop = top; };
    (ed.view.dom as HTMLElement).focus({ preventScroll: true });
    restore();
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

  /** The menu's rows for a trigger and query: R234's static rows, then the vault's New rows (new-object-menu.md). */
  const slashRows = (trigger: '/' | '+', query: string): MenuRow[] => menuRows({ types: conv.current.types, query, trigger });
  const chooseSlash = (row: MenuRow) => {
    const e = edRef.current;
    const s = live.current.slash;
    if (!e || !s || row.disabled) return;
    // new-object-menu.md R236 (D-2609): a New row opens the `New <type>` dialog; the trigger and query stay as typed
    // (never autosaved while it is open, D-2631) until Create replaces them with the link or Cancel removes them.
    if (row.group === 'newObject') {
      const ty = conv.current.types.find((x) => x.key === row.type);
      if (!ty) return;
      const to = e.view.state.selection.from;
      setSlash(null);
      dismissed.current = `s${s.from}`;
      newObjOpen.current = true;
      setNewObj({ type: ty, from: s.from, to, text: e.view.state.doc.textBetween(s.from, to, '\n', '￼') });
      return;
    }
    const item = row.def!;
    // 6A (FR-ATT-01 AC-3): slash Image / PDF open the system file dialog; the files go at the caret.
    if (item.id === 'image' || item.id === 'pdf') {
      setSlash(null);
      dismissed.current = `s${s.from}`;
      e.view.dispatch(e.view.state.tr.delete(s.from, e.view.state.selection.from).setMeta('addToHistory', false));
      const tg = mediaTarget();
      if (tg) void pickMedia(tg, item.id === 'pdf' ? 'pdf' : 'image');
      return;
    }
    // Slice Q (R144): `/query` opens `Choose a query` at the caret; the typed `/quer` goes when a query is chosen.
    if (item.id === 'query') {
      setSlash(null);
      openQueryPickerAt(s.from, e.view.state.selection.from);
      return;
    }
    if (item.id === 'embedObject') {
      setSlash(null);
      dismissed.current = `s${s.from}`;
      openPicker(s.from, e.view.state.selection.from);
      return;
    }
    if (item.id === 'turnIntoObject') {
      if (convertBlocked()) return;
      // FR-CNV-01 AC-2: the typed `/turn` goes (outside the history), then R50 opens for the block.
      setSlash(null);
      dismissed.current = `s${s.from}`;
      e.view.dispatch(e.view.state.tr.delete(s.from, e.view.state.selection.from).setMeta('addToHistory', false));
      focusArea.current = 'body';
      openConvert('last');
      return;
    }
    const b = SLASH_BLOCK[item.id];
    setSlash(null);
    e.commands.slashInsert(s.from, e.view.state.selection.from, b.kind, { level: b.level });
    focusEditor();
  };

  /** The `New <type>` dialog's trigger range, while the document still holds its text there (else null). */
  const newObjRange = (n: NewObj, e: TeggEditor): [number, number] | null => {
    const doc = e.view.state.doc;
    if (n.to > doc.content.size) return null;
    return doc.textBetween(n.from, n.to, '\n', '￼') === n.text ? [n.from, n.to] : null;
  };
  /** Esc, Cancel or a click outside (D-2630): the dialog closes and the trigger and query go (outside the history);
   *  the caret returns to where the trigger was. */
  const cancelNewObject = (refocus = true) => {
    const e = edRef.current;
    const n = newObj;
    setNewObj(null);
    newObjOpen.current = false;
    if (!e || !n) return;
    const r = newObjRange(n, e);
    if (r) {
      e.view.dispatch(e.view.state.tr.delete(r[0], r[1]).setMeta('addToHistory', false));
      e.editor.commands.setTextSelection(r[0]);
    }
    if (refocus) focusEditor();
  };
  /** Create (R237; D-2603, D-2629, D-2632): the object through the one creation path (no `source`), then the link in
   *  place of the trigger and query as one undo step, naming the file the core actually created. A failed create
   *  inserts and writes nothing: the dialog closes, the alert shows and the trigger and query stay as typed text. */
  const createNewObject = async (title: string) => {
    const e = edRef.current;
    const n = newObj;
    if (!e || !n) return;
    let path: string;
    try {
      path = await createObject(n.type.key, title);
    } catch {
      setNewObj(null);
      newObjOpen.current = false;
      pushAlert(t('newObject.failed', { title }));
      focusEditor();
      return;
    }
    newObjInserting.current = true; // QA (D-2631): the saver waits until the link is in
    setNewObj(null);
    const stem = path.split('/').pop()!.replace(/\.md$/, '');
    const res = await ipc.linkResolve(pathRef.current, [stem]).catch(() => []);
    const stemResolves = res[0]?.path?.normalize('NFC') === path.normalize('NFC');
    links.current.set(stemResolves ? stem.normalize('NFC') : path.replace(/\.md$/, '').normalize('NFC'), { kind: 'note', path, type: n.type.key });
    const r = newObjRange(n, e);
    try {
      if (r) e.commands.insertObjectLink(r[0], r[1], { path, title, fromPath: pathRef.current, stemResolves });
    } finally {
      newObjInserting.current = false;
      newObjOpen.current = false;
    }
    focusEditor();
  };

  /** Slice Q (R144): `Choose a query` for `from…to` (the typed `/quer`, or the caret): a saved query inserts its
   *  reference fence, `New query` an empty draft whose editor opens at once; Esc removes the typed text only. */
  const openQueryPickerAt = (from: number, to: number) => {
    const e = edRef.current;
    if (!e) return;
    const c = e.view.coordsAtPos(Math.min(to, e.view.state.doc.content.size));
    const track = e.trackPos(from);
    const len = to - from;
    openQueryPicker({
      at: { left: c.left, top: c.bottom + 4 },
      onChoose: (name) => {
        const ed = edRef.current;
        const at = track();
        if (!ed || at === null) return;
        ed.view.focus();
        ed.commands.insertQuery(at, at + len, name);
      },
      onCancel: () => {
        const ed = edRef.current;
        const at = track();
        if (ed && at !== null && len > 0) ed.view.dispatch(ed.view.state.tr.delete(at, at + len).setMeta('addToHistory', false));
        focusEditor();
      },
    });
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
      // Slice AND-3 (android-edit §10.3): the phone's type sheet in chooser mode.
      if (phone && chooseType((key) => void chooseLink(row, key))) return;
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
      // The new object's link is known before its embed lands, as for `+` (bug emptyconv).
      resolved: (target, path, type) => { links.current.set(target.normalize('NFC'), { kind: 'note', path, type }); },
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
        // Slice Q (R144): ⌘↩ on a selected query block opens its editor.
        const ns = e.view.state.selection as { node?: { type: { name: string }; attrs: Record<string, unknown> }; from: number };
        if (ns.node && ((ns.node.type.name === 'rawBlock' && ns.node.attrs.kind === 'query') || (ns.node.type.name === 'codeBlock' && ns.node.attrs.language === 'query'))) { openQueryBlockAt(ns.from); break; }
        const $f = e.view.state.selection.$from;
        if ($f.parent.type.name === 'codeBlock') { leaveCodeBlock(e.view.state, e.view.dispatch, false); break; } // D-1356
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
      // Slice Q (R144): `Insert query`: the picker at the caret, as `/query`.
      case 'insertQuery': { const at = e.view.state.selection.from; openQueryPickerAt(at, at); break; }
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
  useImperativeHandle(apiRef, () => ({ ed: edRef.current, run, focus: focusEditor, slashOpen: () => !!live.current.slash || !!pickerOpen.current || newObjOpen.current, caretToStart, caretAtLink, caretToEnd, embedBlocks, selectBlockAtTop, convertBlocked, jumpToHeading, refocus }), [run, edRef.current]);

  // ------------------------------------------------------------------ keyboard in the editor (capture: before ProseMirror)
  const onKeyDownCapture = (e: React.KeyboardEvent) => {
    const ed = edRef.current;
    if (!ed || !host.current?.contains(e.target as Node)) return; // menus and fields handle their own keys
    // 4F: keys inside an embed (its nested editor, its menu) are the embed's own (D-428).
    if ((e.target as HTMLElement).closest?.('.embed-block') && host.current?.contains((e.target as HTMLElement).closest('.embed-block'))) return;
    // Slice MM: keys on a mindmap's map or header (its nodes, Map / List) are the map's own (D-770), never the text's.
    if ((e.target as HTMLElement).closest?.('[data-map-area], .mindmap-header')) return;
    // Slice Q: keys on a query block's own controls (its buttons, results, menus) are the block's.
    if ((e.target as HTMLElement).closest?.('.query-mount')) return;
    const L = live.current;
    const stop = () => { e.preventDefault(); e.stopPropagation(); };
    // Slice AND-3 (§7.6): on the phone Esc and ⇧↑/↓ make no block selection (a hardware keyboard); open panels keep Esc.
    if (phone && !slash && !suggest && !linkField && !newObj && !pick) {
      if (e.key === 'Escape') { stop(); return; }
      if (e.shiftKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) { e.stopPropagation(); return; }
    }
    // Slice P (FR-LNK-09 AC-6, AC-7; D-928, D-938): ⌥Space on a selected embed or figure previews its target.
    if (e.code === 'Space' && e.altKey && !e.metaKey && !e.ctrlKey && !e.shiftKey) {
      const bs = ed.blockSelection();
      const se = ed.selectedEmbed();
      const pos = se?.pos ?? (bs && bs.from === bs.to ? blockStart(ed, bs.from) : null);
      if (pos !== null && embedKey(pos, 'preview')) { stop(); return; }
    }
    if (L.slash) {
      const items = slashRows(L.slash.trigger, L.slash.query);
      // FR-EDT-03 AC-3: ↑ and ↓ move over every row (headers are skipped); a disabled row can be selected, never chosen.
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        stop();
        if (!items.length) return;
        setSlash({ ...L.slash, sel: (L.slash.sel + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length });
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        // R235 (D-2625): `+` with no matching row closes, and the key does what it does without a menu.
        if (!items.length && L.slash.trigger === '+') { dismissed.current = `s${L.slash.from}`; setSlash(null); return; }
        stop();
        const pick = items[Math.min(L.slash.sel, items.length - 1)];
        if (pick?.disabled) return; // the menu stays open (FR-EDT-03 AC-5)
        if (pick) chooseSlash(pick);
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
    // Slice PIN (R135, D-1381): a chip pressed here can be dragged into the Pinned section; its native drag is refused.
    if (ed && !e.shiftKey && e.button === 0 && ed.view.dom.contains(e.target as Node)) {
      const item = chipPinRequest(e.target as Element, path, (target) => links.current.get(target));
      if (item) {
        // A drag isn't a click: ProseMirror would take the next press on the chip within 500 ms as a double-click
        // (which opens the link), so the drag clears its last click.
        startPinDrag(e.nativeEvent, item, () => { (ed.view as unknown as { input: { lastClick: { time: number } } }).input.lastClick.time = 0; });
        const chip = (e.target as Element).closest('[data-wikilink], span[data-tag], [data-embed-target]');
        chip?.addEventListener('dragstart', (d) => d.preventDefault(), { once: true });
      }
      return;
    }
    if (!ed || !e.shiftKey || phone) return; // no block selection on the phone (RA14)
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
    && !e2.blockSelection() && toolbarHidden !== selKey && !linkField && !menu && !phone);
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
    if (phone) return; // the system's selection menu (FR-EDT-01 AC-17)
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
      {!phone && handleTop !== null && handleBlock !== null && (
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
      {phone && barOn && e2 && !slash && !suggest && !linkField && !newObj && (
        <FormatBar ed={e2} onLink={() => openLinkField()} onChanged={() => {}} />
      )}
      {slash && e2 && !phone && (
        <SlashMenu slash={slash} rows={slashRows(slash.trigger, slash.query)} pos={caretPos(slash.from)} unavailable={(r) => (r.id === 'turnIntoObject' ? convertBlocked() : null)} onPick={chooseSlash} onSel={(i) => setSlash({ ...slash, sel: i })} />
      )}
      {/* Slice AND-3 (android-edit §10.1, D-2507): on the phone the panels dock at the bottom in the bar's place. */}
      {slash && e2 && phone && (
        <div className="phone-panel" onMouseDown={(ev) => ev.preventDefault()}>
          <SlashMenu slash={slash} rows={phoneSlashItems(slashRows(slash.trigger, slash.query))} pos={{ left: 0, top: 0 }} unavailable={() => null} onPick={chooseSlash} onSel={(i) => setSlash({ ...slash, sel: i })} />
        </div>
      )}
      {newObj && e2 && (
        <NewObjectDialog key={`${newObj.from}:${newObj.type.key}`} type={newObj.type} at={caretPos(newObj.from)} onCreate={(title) => void createNewObject(title)} onCancel={() => cancelNewObject()} />
      )}
      {suggest && e2 && !phone && (
        <Suggestions s={suggest} types={types} pos={caretPos(suggest.from)} onLink={(i) => void chooseLink(i)} onTag={chooseTag} />
      )}
      {suggest && e2 && phone && (
        <div className="phone-panel" onMouseDown={(ev) => ev.preventDefault()}>
          <Suggestions s={suggest} types={types} pos={{ left: 0, top: 0 }} onLink={(i) => void chooseLink(i)} onTag={chooseTag} />
        </div>
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
      {menu && e2 && !phone && (
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
  // Slice AND-3 (android-edit §10.2, FR-EDT-05 AC-9): on the phone a non-modal panel docked above the keyboard.
  const phone = isPhone();
  return (
    <div className={phone ? 'phone-link-panel link-field' : 'popover link-field'} style={phone ? undefined : pos}
      {...(phone ? { role: 'dialog', 'aria-label': t('linkField.label') } : {})}>
      {/* Slice AND-3 (§10.2): on the phone the field is a plain text field with the list docked above it. */}
      <input ref={input} role={phone ? undefined : 'combobox'} enterKeyHint={phone ? 'done' : undefined} aria-label={t('linkField.label')}
        aria-expanded={phone ? undefined : notes.length > 0} aria-autocomplete={phone ? undefined : 'list'}
        placeholder={t('linkField.placeholder')} value={field.query} autoComplete="off" autoCorrect="off" spellCheck={false}
        onChange={(e) => update(e.target.value)} onKeyDown={onKey} />
      {field.onLink && <button type="button" aria-label={t('linkField.remove')} data-command={phone ? 'phone.link.remove' : undefined} onMouseDown={(e) => e.preventDefault()} onClick={onRemove}>{t('linkField.remove')}</button>}
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
