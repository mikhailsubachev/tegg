// The note route. Slice 3B read view (D-117) and, from 3C, the editor: the body is @tegg/editor with autosave
// (FR-EDT-01, FR-EDT-08), the title is editable (D-173), external changes reload a clean note and open the merge
// dialog for a dirty one (FR-SYN-03 AC-12…AC-18), and files the editor can't open safely stay read-only (NFR-REL-03
// AC-6…AC-9, D-117). Opening a note writes nothing (FR-FMT-07 AC-8).
import { listen } from '@tauri-apps/api/event';
import { MediaObjectView } from '../media/MediaObjectView';
import { useCallback, useEffect, useId, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type Ref } from 'react';
import { EmbedStore } from '../embeds/store';
import { Embed } from '../embeds/Embed';
import { restampDraft } from '../daily/stamp';
import { noteReady } from '../readiness';
import { localIso } from '../zone';
import { fixDailyTitle, parse, parseDate, setAttribute, setValue, transform, type TextOp } from '@tegg/doc';
import { lastJobOf, moveNotes, onMoved, onRewritten, redoLast, renameNote, undoLast, undoMove } from '../jobs/jobs';
import { ChangeTypeDialog, type TypeMovePlanDto } from '../types/ChangeTypeDialog';
import { registerLive } from '../jobs/bridge';
import { typeMatch } from '@tegg/schema';
import type { TeggEditor } from '@tegg/editor';
import { t } from '../i18n/catalog';
import { events, ipc } from '../ipc/client';
import type { LinkTargetDto, TypeDefDto, VersionDto } from '../ipc/types';
import { Saver, type ConflictInfo, type Failure, type SaveState } from '../edit/autosave';
import { Compare } from '../edit/Compare';
import { EditorPane, type EditAction, type EditorPaneApi } from '../edit/EditorPane';
import { linkTargets, noteTitle, ReadView } from '../read/ReadView';
import { clearAlerts, dismissAlert, usePageAlerts } from '../convert/alerts';
import { Properties } from '../read/PropertiesStrip';
import { SourceView, WarningBanner } from '../read/SourceView';
import { frontmatterWarning } from '../read/warning';
import { Icon } from '../shell/Icon';
import { WidthSwitch, pageWidthOf, type PageWidth } from '../edit/WidthSwitch';
import { AttributePanel, type Commit, type PanelApi } from '../types/AttributePanel';
import { TypeChip, type TypeChipApi } from '../types/ChangeTypeMenu';
import { ReviewCheck } from '../shell/ReviewCheck';
import { pageFallback, typeOfValue } from '../types/util';
import { reviewable } from '../review';
import { DailyHeader, type DailyInfo } from '../daily/DailyHeader';
import { ContextSections } from '../daily/ContextSections';

/** `review`: the raw value, `hasFrontmatter` for D-591's review toggle and commands. */
export type NoteMeta = { title: string; type: string; review?: unknown; hasFrontmatter?: boolean };
/** D-520 (ms5-tasks §12.2): an unsaved new object. */
export type DraftInfo = { text: string; stamp: string; onCreate: (text: string) => Promise<{ path: string; version: VersionDto }> };

/** Title and type from the frontmatter (untyped files are Pages, D-103), else the file name. */
export function noteMeta(path: string, text: string): NoteMeta {
  const doc = parse(text.replace(/^﻿/, ''));
  const type = doc.frontmatter?.data?.type;
  return { title: noteTitle(doc, path), type: typeMatch(type).key.normalize('NFC'), review: doc.frontmatter?.data?.review, hasFrontmatter: !!doc.frontmatter };
}

const nfc = (s: string) => s.normalize('NFC');

/** Scrolls to `#Heading` or `#^block` inside the note; a missing target leaves the note at the top (D-140). */
export function scrollToFragment(root: HTMLElement | null, fragment: string) {
  if (!root) return;
  const f = nfc(fragment.replace(/^#/, ''));
  // The note body: the read view's article, else the editor (not the title field, which comes first).
  const art = root.querySelector('article') ?? root.querySelector('.editor-host [contenteditable]');
  if (!art) return;
  const el = f.startsWith('^')
    ? art.querySelector(`[id="${CSS.escape(f)}"]`)
    : [...art.querySelectorAll<HTMLElement>('[data-heading], h1, h2, h3, h4, h5, h6')].find((h) => nfc(h.dataset.heading ?? h.textContent ?? '').trim().toLowerCase() === f.toLowerCase());
  el?.scrollIntoView({ block: 'start' });
}

/** What the page shows: the editor, or a read-only view with the reason (R9 "Read-only"). */
type Mode = 'edit' | 'invalidFrontmatter' | 'utf8' | 'editorFailed' | 'readView';
type Loaded = { text: string; version: VersionDto; mode: Mode; links: Map<string, LinkTargetDto> };
export type Merge = { mine: string; theirs: string; theirsVersion: VersionDto; compare: boolean };

export type NotePageApi = {
  flush: () => Promise<void>;
  edit: (a: EditAction) => void;
  pending: () => boolean;
  /** The merge dialog is open (FR-SYN-03 AC-19). */
  mergeOpen: () => boolean;
  /** `Keep both`, for quitting with the merge dialog open (D-176). */
  keepBoth: () => Promise<void>;
  /** 3D (R13): the `Change type` menu and `Edit properties`. */
  changeType: () => void;
  editProperties: () => void;
  /** D-247, D-255: put the focus where an opened note wants it (after navigation; App calls it instead of focusing
   *  the heading): a new note's title, else the start of the first editable body block, else the heading (D-130). */
  placeFocus: () => void;
  /** 4B: the user changed the note (or a save is pending) since it opened (D-326 needs an untouched virtual note). */
  touched: () => boolean;
  /** Slice PW (AP-756): the palette's `Page width: …` commands. */
  setWidth: (w: PageWidth) => void;
  /** 4B (D-330): the review toggle, also from the palette. */
  setReviewed: (reviewed: boolean) => void;
  /** 5A-2 (FR-CNV-01 AC-5): why `Turn into object` can't run now, or null. */
  convertBlocked: () => string | null;
  /** 5B (FR-VLT-05 AC-4): the title as typed (an unwritten draft keeps it when its type changes). */
  title: () => string;
  /** 5B (FR-VLT-05 AC-4): drop an unwritten draft without writing it (its type changes). */
  discardDraft: () => void;
  /** 6A (FR-HIS-01 AC-1, D-196): saves first, then what Move to trash needs; null when the save failed or there is
   *  no file (a virtual Daily Note, an unsaved object). */
  trashTarget: () => Promise<{ path: string; base: VersionDto; title: string } | null>;
  /** 6A (FR-HIS-01 AC-3): why there is nothing to trash, or null. */
  trashBlocked: () => string | null;
  /** 6A (FR-HIS-01 AC-2): re-reads the file after a refused trash. */
  reload: () => void;
};

const headOf = (text: string): string => text.slice(0, parse(text).bodyStart);

/** D-330: a missing or unknown `review` counts as unreviewed. */
const reviewOf = (fm: unknown): boolean => String((fm as Record<string, unknown> | null)?.review ?? '').trim() === 'reviewed';

function stamp(): string {
  const t = localIso(Date.now()); // the app's zone (zone.ts)
  return `${t.slice(0, 10)} ${t.slice(11, 13)}-${t.slice(14, 16)}`;
}

export function NotePage({ apiRef, path, fragment, at, attr, selectEmbedOf, onOpenSource, restoreScroll, types, heading, onType, onMeta, onOpen, onTag, onRenamed, toggleSource, focusMode, onTogglePanel, onFocus, propertiesOpen, onToggleProperties, onRestored, knownId, onId, created, otherOpen = false, onToggleOther, onTypeSaved, daily, onDaily, draft, widths, defaultWidth = 'normal', onWidth, onRekeyWidth }: {
  apiRef?: Ref<NotePageApi>;
  path: string;
  fragment?: string;
  /** ms4-links §5.4: the caret at the link starting there (a backlinks excerpt, FR-LNK-01 AC-6). */
  at?: { line: number; byte: number };
  /** ms4-links §5.4: the focus on this property's value control. */
  attr?: string;
  /** 5A-1 (D-486, FR-TSK-08 AC-2): select the first block embed of this path, at the top of the pane. */
  selectEmbedOf?: string;
  /** 5A-1 (FR-TSK-08 AC-3): open a note with this note's embed selected. */
  onOpenSource?: (path: string) => void;
  restoreScroll?: number;
  types: TypeDefDto[];
  heading: React.RefObject<HTMLHeadingElement | null>;
  onType: (key: string) => void;
  onMeta: (m: NoteMeta | null) => void;
  onOpen: (path: string, fragment?: string) => void;
  onTag: (key: string) => void;
  onRenamed: (path: string) => void;
  toggleSource: number;
  focusMode: boolean;
  onTogglePanel: () => void;
  onFocus: () => void;
  propertiesOpen: boolean;
  onToggleProperties: () => void;
  onRestored?: () => void;
  knownId?: string;
  onId?: (id: string) => void;
  /** A note just created (⌘N, switcher Create, `New <Type>`): the title is in edit mode (D-247, D-255). */
  created?: boolean;
  /** 3D: Other properties expanded (machine-local UI state, FR-EDT-07 AC-2). */
  otherOpen?: boolean;
  onToggleOther?: () => void;
  /** 3D: a save changed the note's type (sidebar counts follow, FR-TYP-07 AC-5). */
  onTypeSaved?: () => void;
  /** 4B (ms4-daily §4.1, R17, R19): this page shows a Daily Note (virtual while `daily.virtual` is set). */
  daily?: DailyInfo;
  /** 4B: a note route opened a Daily Note (type daily-note with a valid date). */
  onDaily?: (date: string) => void;
  /** D-520 (ms5-tasks §12.2): an unsaved new object, opened on `text` (stamped `stamp`) and written by `onCreate`. */
  draft?: DraftInfo;
  /** Slice PW (page-width.md, AP-753): the per-note widths of `ui-state.json`, keyed by `id`, else by the NFC path. */
  widths?: Record<string, PageWidth>;
  /** AP-754: the vault default for notes without an entry. */
  defaultWidth?: PageWidth;
  onWidth?: (key: string, width: PageWidth) => void;
  /** AP-753, AP-758: the entry moves from the path (or nothing) to the id the first write assigned. */
  onRekeyWidth?: (from: string | null, to: string, width: PageWidth) => void;
}) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  // 4F (ms4-embeds §6): the embeds of this page (tree, nested editors and their save states).
  const embeds = useMemo(() => new EmbedStore(path, true), []);
  embeds.path = path;
  embeds.types = types;
  useSyncExternalStore(embeds.subscribe, embeds.getSnapshot);
  const [, setEmbedTick] = useState(0);
  useEffect(() => embeds.onState(() => setEmbedTick((n) => n + 1)), []);
  const [gone, setGone] = useState(false);
  // Slice PW (AP-753, AP-758): the id of the file on disk (none for an unwritten draft or virtual note), and the choice
  // made on an unwritten draft, kept for the page until its first write keys it.
  const [savedId, setSavedId] = useState<string | null>(null);
  const [draftWidth, setDraftWidth] = useState<PageWidth | null>(null);
  const [source, setSource] = useState<boolean | null>(null);
  const [save, setSave] = useState<{ state: SaveState; failure: Failure }>({ state: 'saved', failure: null });
  const [merge, setMerge] = useState<Merge | null>(null);
  const [deleted, setDeleted] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [title, setTitle] = useState<string>('');
  const titleRef = useRef('');
  titleRef.current = title;
  const [diskText, setDiskText] = useState<string>('');
  const [mapping, setMapping] = useState<{ plan: TypeMovePlanDto; names: Record<string, string>; key: string; toName: string } | null>(null);
  const [moveError, setMoveError] = useState<string | null>(null);
  // QA N2: while a type move of this note runs, nothing changes its text (body, title, panel, chip, review, source):
  // that text would carry the old frontmatter to the new path. It ends once the moved note is reloaded.
  const [moving, setMoving] = useState(false);
  const movingDone = useRef<(() => void) | null>(null);
  const mergeOpen = useRef(false);
  useEffect(() => { mergeOpen.current = !!merge; }, [merge]);
  useEffect(() => { if (!moveError) return; const h = setTimeout(() => setMoveError(null), 5000); return () => clearTimeout(h); }, [moveError]);
  const root = useRef<HTMLDivElement | null>(null);
  // D-247, D-255: where the focus went when the note opened (`data-focus-target`, ms3-shell §15.2).
  const [focusTarget, setFocusTarget] = useState<'body' | 'title' | 'heading' | null>(null);
  // Test build only (D-751): the core sends `tegg://test-focus-title` under TEGG_TEST_FOCUS_TITLE once the note is ready,
  // for the L6 tests that type a new title without Appium (FR-LNK-03 AC-17, FR-UX-07 AC-11).
  useEffect(() => {
    const un = listen('tegg://test-focus-title', () => (heading.current as HTMLElement | null)?.focus());
    return () => void un.then((f) => f());
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const wantFocus = useRef(false);
  const editorReady = useRef(false);
  const placeFocus = useRef<() => void>(() => {});
  const createdAtOpen = useRef(!!created);
  const titleId = useId();
  const pane = useRef<EditorPaneApi | null>(null);
  const edRef = useRef<TeggEditor | null>(null);
  const saver = useRef<Saver | null>(null);
  const savedTitle = useRef('');
  /** The title when the current title edit started (D-394); null when no edit is open. */
  const titleFrom = useRef<string | null>(null);
  const fresh = useRef(false);
  /** The editor's history depth when the note last moved: deeper means it was edited since. */
  const freshDepth = useRef(0);
  const liveFragment = useRef(fragment);
  liveFragment.current = fragment;
  const liveRestore = useRef(restoreScroll);
  liveRestore.current = restoreScroll;
  const chooseWidthRef = useRef<(w: PageWidth) => void>(() => {});
  const live = useRef({ path, loaded, merge, deleted, daily, draft });
  live.current = { path, loaded, merge, deleted, daily, draft };
  /** D-522: still an unwritten draft (typing its title writes nothing until the commit). */
  const isDraft = () => !!(live.current.draft && saver.current?.create);
  // 3D: the frontmatter in effect in the editor (saved or committed by the panel, §14.6), for the panel and the chip.
  const [head, setHead] = useState<string>('');
  const panelApi = useRef<PanelApi | null>(null);
  const chipApi = useRef<TypeChipApi | null>(null);
  const syncHead = useCallback(() => {
    const ed = edRef.current;
    if (!ed) return;
    const h = ed.editor.state.doc.attrs.frontmatter;
    setHead(typeof h === 'string' ? h : headOf(ed.text()));
  }, []);

  // ------------------------------------------------------------------ load
  const loadedOnce = useRef(false);
  const load = useCallback(async () => {
    try {
      // 4B (ms4-daily §4.1): a virtual Daily Note opens on its draft; nothing is read or written.
      const v = live.current.daily?.virtual ?? live.current.draft;
      const n = v ? { text: v.text, version: null as unknown as VersionDto, utf8: true } : await ipc.noteRead(path);
      const doc = parse(n.text.replace(/^﻿/, ''));
      // D-215: a test-only switch shows the read view (the fallback view of D-117) instead of the editor.
      const readView = !!(window as { __TEGG_TEST__?: { readView?: boolean } }).__TEGG_TEST__?.readView;
      // 6A (FR-HIS-01 AC-6): an object in the trash is shown read-only, never edited.
      const mode: Mode = !n.utf8 ? 'utf8' : frontmatterWarning(doc) ? 'invalidFrontmatter' : readView || path.startsWith('.trash/') ? 'readView' : 'edit';
      // The read-only views resolve their links here; the editor resolves its own chips.
      let links = new Map<string, LinkTargetDto>();
      if (mode !== 'edit') {
        const targets = linkTargets(n.text);
        const resolved = targets.length ? await ipc.linkResolve(path, targets).catch(() => [] as LinkTargetDto[]) : [];
        links = new Map(resolved.map((r) => [r.target, r]));
      }
      if (live.current.path !== path) return;
      setLoaded({ text: n.text, version: n.version, mode, links });
      setDiskText(n.text);
      const meta = noteMeta(path, n.text);
      // D-520: a draft's title starts empty (its planned file name is no title), unless the draft carries the title typed
      // before its type changed (FR-VLT-05 AC-4).
      const carried = live.current.draft ? String(doc.frontmatter?.data?.title ?? '').normalize('NFC') : '';
      const shownTitle = live.current.draft ? carried : meta.title;
      setTitle(shownTitle);
      savedTitle.current = live.current.draft ? '' : shownTitle;
      const id = doc.frontmatter?.data?.id;
      if (typeof id === 'string' && id) onId?.(id);
      if (typeof id === 'string' && id && !live.current.draft && !live.current.daily?.virtual) setSavedId(id);
      const day = meta.type === 'daily-note' ? parseDate(String(doc.frontmatter?.data?.date ?? '').trim().slice(0, 10)) : null;
      onMeta(day ? { ...meta, title: day } : meta); // D-320: a Daily Note's title is its date
      if (day && !live.current.daily) onDaily?.(day);
      if (mode !== 'edit') setSave({ state: 'readOnly', failure: null });
    } catch {
      if (live.current.path !== path) return;
      if (!(await followRename(knownId))) { setGone(true); onMeta(null); }
    }
  }, [path]);

  /** A note gone from its path that still exists under its `id` was renamed (FR-SYN-03 AC-5, AC-18). */
  const followRename = async (id: string | undefined | null): Promise<boolean> => {
    if (typeof id !== 'string' || !id) return false;
    const [r] = await ipc.linkResolve(path, [id]).catch(() => [] as LinkTargetDto[]);
    if (r?.path && r.kind === 'note' && nfc(r.path) !== nfc(path)) {
      onRenamed(r.path);
      return true;
    }
    return false;
  };

  useEffect(() => {
    if (!loadedOnce.current) {
      loadedOnce.current = true;
      void load();
    }
  }, []);

  // A rename keeps this page (and its editor): saving goes on at the new path (FR-SYN-03 AC-18). A note that hadn't
  // loaded yet (found by its id after a rename, FR-NAV-03 AC-5) loads from the new path.
  const firstPath = useRef(path);
  useEffect(() => {
    if (saver.current) saver.current.path = path;
    if (path !== firstPath.current && (!live.current.loaded || live.current.loaded.mode !== 'edit')) void load();
  }, [path]);

  // ------------------------------------------------------------------ the editor and autosave
  const onEditor = useCallback((ed: TeggEditor) => {
    edRef.current = ed;
    const l = live.current.loaded!;
    saver.current?.dispose();
    const fromDraft = !!live.current.draft; // the route may drop the draft before the first write's result arrives
    const s = new Saver(path, ed, l.version, {
      state: (state, failure) => setSave({ state, failure }),
      conflict: (c: ConflictInfo) => setMerge({ mine: c.mine, theirs: c.theirs, theirsVersion: c.theirsVersion, compare: false }),
      gone: () => setDeleted(true),
      written: (text) => {
        const writtenId = parse(text).frontmatter?.data?.id;
        if (typeof writtenId === 'string' && writtenId) setSavedId(writtenId);
        const before = noteMeta(live.current.path, diskTextRef.current || text).type;
        diskTextRef.current = text; // at once: a watcher event can arrive before the next render (FR-SYN-03 AC-21)
        setDiskText(text);
        syncHead();
        if (noteMeta(live.current.path, text).type !== before) onTypeSaved?.();
        savedTitle.current = noteMeta(live.current.path, text).title;
        const written = savedTitle.current;
        setTitle((cur) => (cur.trim() === '' ? written : cur)); // D-523: an empty title was written as `Untitled`
        if (fromDraft) onMeta(noteMeta(s.path, text)); // D-520: the page now shows this note (its name, its type)
        void ipc.perfMark('note-saved').catch(() => {});
      },
    }, () => !!pane.current?.slashOpen());
    saver.current = s;
    const d = live.current.daily;
    if (d) {
      s.transform = fixDailyTitle; // D-334
      if (d.virtual) {
        const stamp = d.virtual.stamp;
        s.create = (text) => live.current.daily!.onCreate(text);
        // ms4-daily §3: the first write carries the write time, not the time the virtual note opened.
        s.transform = (text) => fixDailyTitle(s.create ? restampDraft(text, stamp, localIso(Date.now())) : text);
      }
    }
    const dr = live.current.draft;
    if (dr) {
      // D-520, D-523: the first write goes through the creation path, stamped at the write time, `Untitled` when the
      // title is still empty.
      s.create = (text) => live.current.draft!.onCreate(text);
      s.transform = (text) => {
        if (!s.create) return text;
        const out = restampDraft(text, dr.stamp, localIso(Date.now()));
        const tt = parse(out).frontmatter?.data?.title;
        return typeof tt === 'string' && tt.trim() !== '' ? out : setAttribute(parse(out), 'title', t('newObject.untitled'));
      };
    }
    const w = window as { __TEGG_TEST__?: Record<string, unknown> };
    w.__TEGG_TEST__ = { ...(w.__TEGG_TEST__ ?? {}), editor: { text: () => ed.text(), dirty: () => ed.dirty() || !!saver.current?.pending, historyDepth: () => ed.historyDepth() }, embeds: () => embeds.nested().map((e) => ({ path: e.path, depth: e.depth, editable: e.editable, text: () => e.text(), dirty: () => e.dirty(), historyDepth: () => e.historyDepth() })) };
    syncHead();
    requestAnimationFrame(() => {
      // D-140: `#Heading` scrolls once the editor's content exists (the link or embed `Open` that opened it).
      if (liveFragment.current && liveRestore.current === undefined) scrollToFragment(root.current, liveFragment.current);
      placeFocus.current(); // D-247: the caret goes in once the editor is ready
      void ipc.perfMark('note-ready').catch(() => {}); // NFR-PERF-05 AC-4: mounted, editable, caret placed
      noteReady();
    });
  }, [path]);

  /** A committed panel edit (FR-EDT-07 AC-4, D-240): the next note text from @tegg/doc, one undo step, autosaved. */
  const commit: Commit = useCallback((edit) => {
    const ed = edRef.current;
    if (!ed || live.current.merge || live.current.deleted) return false;
    try {
      const cur = ed.text();
      const next = edit(parse(cur));
      if (next !== cur) ed.applyFrontmatter(next);
    } catch {
      return false;
    }
    saver.current?.changed();
    syncHead();
    return true;
  }, []);

  useEffect(() => () => saver.current?.dispose(), []);
  // A note route that turned out to be a Daily Note (D-334) gets the title fix once known.
  useEffect(() => { if (saver.current && !saver.current.create) saver.current.transform = daily ? fixDailyTitle : null; }, [!!daily]);

  /** D-330, D-562: writes only `review` (and `modified`) through the editor's save path; a virtual Daily Note has no
   *  file yet. */
  const setReviewedRef = useRef<(r: boolean) => void>(() => {});
  setReviewedRef.current = (r: boolean) => {
    if (live.current.daily?.virtual) return;
    const only = !saver.current?.pending; // nothing else waits to be saved: only `review` and `modified` change
    commit((d) => setValue(d, 'review', r ? 'reviewed' : 'unreviewed'));
    if (only && saver.current) saver.current.skipTransform = true;
  };

  const flush = useCallback(async () => {
    const s = saver.current;
    // D-421: leaving the page saves every file it edits (FR-EMB-03 AC-7).
    await Promise.all([s ? s.flush() : Promise.resolve(), embeds.flush()]);
  }, []);

  useEffect(() => () => clearAlerts(), [path]);

  useImperativeHandle(apiRef, () => ({
    flush,
    edit: (a) => {
      if (a === 'saveNow') { void flush(); return; }
      pane.current?.run(a);
    },
    pending: () => !!saver.current?.pending || !!live.current.merge || live.current.deleted || embeds.pending(),
    mergeOpen: () => !!live.current.merge,
    keepBoth: () => keepBothRef.current(),
    changeType: () => chipApi.current?.open(),
    editProperties: () => {
      if (!propertiesOpen) { onToggleProperties(); setTimeout(() => panelApi.current?.focusFirst(), 0); }
      else panelApi.current?.focusFirst();
    },
    placeFocus: () => { wantFocus.current = true; placeFocus.current(); },
    setWidth: (w) => chooseWidthRef.current(w),
    touched: () => !!saver.current?.pending || !!edRef.current?.dirty() || !!(saver.current && !saver.current.create && (live.current.daily?.virtual || live.current.draft)),
    setReviewed: (r) => setReviewedRef.current(r),
    title: () => titleRef.current,
    trashTarget: async () => {
      if (live.current.daily?.virtual || live.current.draft) return null;
      await flush();
      if (saver.current?.pending) return null;
      const base = saver.current?.base ?? live.current.loaded?.version ?? null;
      if (!base) return null;
      const stem = path.split('/').pop()!.replace(/\.md$/i, '');
      return { path, base, title: live.current.daily?.date ?? (titleRef.current.trim() || stem) };
    },
    trashBlocked: () => (live.current.daily?.virtual || live.current.draft ? t('trash.nothing') : null),
    reload: () => { void externalRef.current(); },
    discardDraft: () => { if (isDraft()) saver.current?.discard(); },
    // D-494: only the note's own editor converts; the read view, the source view and read-only files don't.
    convertBlocked: () => (pane.current && live.current.loaded?.mode === 'edit' ? pane.current.convertBlocked() : t('convert.readOnly')),
  }), [flush, propertiesOpen, onToggleProperties]);

  // ------------------------------------------------------------------ external changes (FR-SYN-03)
  const external = useCallback(async () => {
    const l = live.current.loaded;
    if (!l) return;
    if (saver.current?.create) return; // a virtual Daily Note: a file at its planned path isn't this note (D-326)
    let n: { text: string; version: VersionDto; utf8: boolean } | null = null;
    try { n = await ipc.noteRead(live.current.path); } catch { n = null; }
    const ed = edRef.current;
    const s = saver.current;
    if (!n) {
      const id = parse(diskText || l.text).frontmatter?.data?.id;
      if (await followRename(typeof id === 'string' ? id : knownId)) return;
      if (ed && s && (s.pending || ed.dirty())) { s.block(); setDeleted(true); }
      else { setGone(true); onMeta(null); }
      return;
    }
    if (live.current.merge) {
      // The dialog always compares with the newest disk version (FR-SYN-03 AC-15).
      setMerge((m) => (m ? { ...m, theirs: n!.text, theirsVersion: n!.version } : m));
      return;
    }
    if (l.mode !== 'edit' || !ed || !s) {
      setLoaded({ ...l, text: n.text, version: n.version });
      setDiskText(n.text);
      return;
    }
    if (n.text === diskTextRef.current) {
      // Same bytes with a new mtime: nothing changed (D-175); keep the newest version as base.
      if (!s.isBlocked() && !s.pending) s.base = n.version;
      return;
    }
    // FR-SYN-03 AC-21 (v0.52 H9, H10): the watcher reporting this page's own save, on its way or just landed; the
    // write's result sets the base. Taking it as external opened the merge dialog or reloaded the editor (caret jump).
    if (n.text === s.writing || n.text === s.lastWritten) return;
    const doc = parse(n.text.replace(/^﻿/, ''));
    const dirty = s.pending || ed.dirty();
    if (dirty) {
      if (n.text === ed.text()) {
        ed.markSaved(n.text);
        s.resume(n.version);
        setDiskText(n.text);
        return;
      }
      s.block();
      setMerge({ mine: ed.text(), theirs: n.text, theirsVersion: n.version, compare: false });
      return;
    }
    if (frontmatterWarning(doc)) {
      setLoaded({ ...l, text: n.text, version: n.version, mode: 'invalidFrontmatter' });
      setDiskText(n.text);
      setSave({ state: 'readOnly', failure: null });
      return;
    }
    ed.reload(n.text);
    s.base = n.version;
    setDiskText(n.text);
    syncHead();
    const meta = noteMeta(live.current.path, n.text);
    savedTitle.current = meta.title;
    setTitle(meta.title);
    onMeta(meta);
  }, [diskText, knownId]);
  /** Rebuilds the embed tree: the editor re-resolves its embed targets; the read view resolves its links again. */
  const refreshEmbedsRef = useRef<() => void>(() => {});
  refreshEmbedsRef.current = () => {
    const l = live.current.loaded;
    if (!l) return;
    if (l.mode === 'edit') { embeds.refresh?.(); return; }
    void (async () => {
      const targets = linkTargets(l.text);
      const resolved = targets.length ? await ipc.linkResolve(live.current.path, targets).catch(() => [] as LinkTargetDto[]) : [];
      const links = new Map(resolved.map((r) => [r.target, r]));
      setLoaded((x) => (x && x.text === l.text ? { ...x, links } : x));
      void embeds.build(l.text, links);
    })();
  };
  // The read view's tree: its links are resolved in one batch with the embeds (load()).
  useEffect(() => {
    if (!loaded) return;
    embeds.editable = loaded.mode === 'edit';
    if (loaded.mode !== 'edit') void embeds.build(loaded.text, loaded.links);
  }, [loaded]);
  // Back restores the scroll position again once the embeds have their height (FR-EMB-02 AC-9).
  const embedSnap = embeds.getSnapshot();
  const restoredAfterEmbeds = useRef(false);
  const restoreAtOpen = useRef(restoreScroll); // the App clears its value once restored the first time
  useEffect(() => {
    const target = restoreAtOpen.current;
    if (restoredAfterEmbeds.current || target === undefined || !embedSnap.tree) return;
    restoredAfterEmbeds.current = true;
    const apply = () => { const main = root.current?.closest('main'); if (main && Math.abs(main.scrollTop - target) > 1) main.scrollTop = target; };
    requestAnimationFrame(() => { apply(); requestAnimationFrame(apply); for (const ms of [100, 300, 600]) setTimeout(apply, ms); });
  }, [embedSnap.version]);
  // A type's default changed (FR-EMB-02 AC-7, AC-10).
  const typesSig = types.map((x) => `${x.key}:${(x as { embed?: string }).embed ?? ''}:${x.icon}:${x.preview.join(',')}`).join('|');
  const firstTypes = useRef(true);
  useEffect(() => {
    if (firstTypes.current) { firstTypes.current = false; return; }
    refreshEmbedsRef.current();
  }, [typesSig]);
  const diskTextRef = useRef(diskText);
  diskTextRef.current = diskText;
  const externalRef = useRef(external);
  externalRef.current = external;
  // QA 4E-1 4 M1′: a type change (or its undo) written in place on disk: reloaded when clean, the merge dialog otherwise.
  useEffect(() => onRewritten((p) => { if (nfc(p) === nfc(live.current.path)) void externalRef.current(); }), []);
  useEffect(() => {
    const un = events.changed((c) => {
      if (c.paths.some((p) => nfc(p) === nfc(live.current.path))) void externalRef.current();
      // 4F (FR-EMB-02 AC-10): embedded notes, created targets and type files change what the embeds show.
      if (c.paths.some((p) => nfc(p) !== nfc(live.current.path))) refreshEmbedsRef.current();
    });
    return () => void un.then((f) => f());
  }, []);

  // The editor takes no input while the merge dialog or the deleted alert is open (FR-SYN-03 AC-13).
  useEffect(() => {
    edRef.current?.editor.setEditable(!merge);
  }, [merge]);

  // ------------------------------------------------------------------ merge dialog and deleted alert
  const keepMine = async () => {
    const m = merge, ed = edRef.current, s = saver.current;
    if (!m || !ed || !s) return;
    const text = (await ed.save()) ?? ed.text();
    try {
      const r = await ipc.noteWrite(live.current.path, text, m.theirsVersion);
      ed.markSaved(text);
      setDiskText(text);
      setMerge(null);
      s.resume(r.version);
    } catch (e) {
      const x = e as { kind?: string; theirs?: string; theirsVersion?: VersionDto };
      if (x.kind === 'Conflict' && x.theirsVersion) setMerge({ ...m, theirs: x.theirs ?? m.theirs, theirsVersion: x.theirsVersion });
    }
  };
  const keepTheirs = () => {
    const m = merge, ed = edRef.current, s = saver.current;
    if (!m || !ed || !s) return;
    ed.reload(m.theirs);
    setDiskText(m.theirs);
    syncHead();
    setMerge(null);
    s.resume(m.theirsVersion);
  };
  const keepBoth = async () => {
    const m = merge, ed = edRef.current, s = saver.current;
    if (!m || !ed || !s) return;
    const mine = (await ed.save()) ?? ed.text();
    const p = live.current.path;
    const dir = p.includes('/') ? p.slice(0, p.lastIndexOf('/') + 1) : '';
    const stem = p.slice(dir.length).replace(/\.md$/, '');
    const base = `${dir}${stem} (conflict ${stamp()})`;
    for (let n = 1; n < 50; n++) {
      try {
        await ipc.noteCreateExact(`${base}${n > 1 ? ` (${n})` : ''}.md`, mine);
        break;
      } catch (e) {
        if ((e as { kind?: string }).kind !== 'NameTaken') return;
      }
    }
    ed.reload(m.theirs);
    setDiskText(m.theirs);
    syncHead();
    setMerge(null);
    s.resume(m.theirsVersion);
  };
  const keepBothRef = useRef(keepBoth);
  keepBothRef.current = keepBoth;
  const restore = async () => {
    const ed = edRef.current, s = saver.current;
    if (!ed || !s) return;
    const text = (await ed.save()) ?? ed.text();
    try {
      const r = await ipc.noteWrite(live.current.path, text, null);
      ed.markSaved(text);
      setDiskText(text);
      setDeleted(false);
      s.resume(r.version);
    } catch (e) {
      const x = e as { kind?: string; theirs?: string; theirsVersion?: VersionDto };
      setDeleted(false);
      if (x.kind === 'Conflict' && x.theirsVersion) setMerge({ mine: text, theirs: x.theirs ?? '', theirsVersion: x.theirsVersion, compare: false });
    }
  };
  const discard = () => {
    saver.current?.dispose();
    setDeleted(false);
    setGone(true);
    onMeta(null);
  };

  // ------------------------------------------------------------------ source toggle (FR-EDT-10 AC-9: saves first)
  const showSource = source ?? (loaded ? loaded.mode === 'invalidFrontmatter' : false);
  const toggle = async () => {
    if (!showSource) await flush();
    setSource(!showSource);
  };
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    if (!loaded) return;
    void toggle();
  }, [toggleSource]);

  // ------------------------------------------------------------------ title (FR-EDT-01 AC-10, D-173)
  const onTitle = (v: string) => {
    // D-394: links compare with this title. Only once the note has loaded: an input event while it opens (a key of
    // the navigation landing in the field) must not start an edit from an empty title (PR #45 gate run).
    if (titleFrom.current === null && live.current.loaded && savedTitle.current.trim() !== '') titleFrom.current = savedTitle.current;
    fresh.current = false;
    setTitle(v);
    const ed = edRef.current;
    if (!ed) return;
    const tt = v.normalize('NFC');
    ed.setTitle(tt.trim() === '' ? null : tt.trim()); // FR-FMT-08 AC-7: the title is stored trimmed
    if (tt.trim() !== '' && !isDraft()) saver.current?.changed(); // D-522: a draft's title is written on its commit
  };
  const onTitleBlur = (to?: HTMLElement | null) => {
    // FR-VLT-05 AC-4 (D-550): a draft's title isn't committed by the palette or a menu taking the focus for a moment
    // (`Change type…` writes nothing); leaving the draft still flushes it (D-522).
    if (isDraft() && to?.closest('.palette, [role="menu"], .type-menu')) return;
    const from = titleFrom.current;
    titleFrom.current = null;
    if (title.trim() === '') {
      setTitle(savedTitle.current);
      edRef.current?.setTitle(null);
      return;
    }
    // D-522: committing a draft's title is its first write.
    if (isDraft()) { saver.current!.forceFirst = true; saver.current!.changed(); void saver.current!.flush(); return; }
    // D-268: the commit (↩, Tab, leaving the field) renames the file and moves the links; typing only autosaves
    // `title:` (D-394). Templates and trashed notes keep their file name (D-391); a Daily Note's title is read-only.
    const next = title.trim().normalize('NFC');
    if (from === null || from.trim() === '' || next === from.trim().normalize('NFC')) return;
    const p = live.current.path;
    if (live.current.daily || live.current.loaded?.mode !== 'edit' || p.startsWith('_templates/') || p.startsWith('.trash/')) return;
    const sv = saver.current;
    sv?.hold(); // ms4-jobs §9: no write to the old path while the job moves the note
    void renameNote(p, next, from, (r) => { if (!r?.renamed) sv?.release(); }).catch(() => sv?.release());
  };

  // ------------------------------------------------------------------ rename (4C, ms4-jobs §9, §10)
  /** True from a rename, undo or redo of this note until the next edit: ⌘Z / ⇧⌘Z then undo / redo it (FR-LNK-03 AC-14). */
  const onRenameKey = (e: React.KeyboardEvent) => {
    if (!e.metaKey || e.key.toLowerCase() !== 'z' || !fresh.current || (edRef.current?.historyDepth() ?? 0) > freshDepth.current) return;
    const l = lastJobOf(live.current.path);
    if (!l) return;
    // 4E-1 (D-812): right after a type change, ⌘Z / ⇧⌘Z undo / redo its job.
    if (!e.shiftKey && !l.undone) { e.preventDefault(); e.stopPropagation(); void (l.move ? undoMove(l.jobId, true) : undoLast()); }
    else if (e.shiftKey && l.undone) { e.preventDefault(); e.stopPropagation(); void (l.move ? undoMove(l.jobId, false) : redoLast()); }
  };
  // A job moved this note (rename, undo, redo): the page stays, its editor saves at the new path; unsaved text gets
  // the same title and self-link change (FR-FMT-08 AC-5, FR-LNK-03 AC-18).
  useEffect(() => onMoved((m) => {
    const here = live.current.path.normalize('NFC');
    // The page may have followed the file by its id already (FR-SYN-03 AC-18 path); the editor still needs the move.
    if (m.from !== here && m.to !== here) return;
    void (async () => {
      const n = await ipc.noteRead(m.to).catch(() => null);
      if (!n) return;
      const ed = edRef.current;
      const s = saver.current;
      if (ed && s) {
        const dirty = ed.dirty() || s.pending;
        s.moved(m.to, n.version);
        if (dirty) {
          const toTitle = noteMeta(m.to, n.text).title;
          const stemOf = (x: string) => x.split('/').pop()!.replace(/\.md$/i, '');
          const ops: TextOp[] = [
            { op: 'set-title', title: toTitle, now: localIso(Date.now()) },
            { op: 'retarget-links', fromPath: m.from, fromStem: stemOf(m.from), fromTitle: savedTitle.current, toPath: m.to, toStem: stemOf(m.to), toTitle, paths: [m.from] },
          ];
          const r = transform(m.to, ed.text(), ops);
          ed.reload(r.kind === 'bytes' ? r.text : ed.text());
          ed.markSaved(n.text);
          s.changed();
        } else {
          ed.reload(n.text);
        }
        syncHead(); // a type move changed the frontmatter the panel and the chip read (4E-1)
      }
      setDiskText(n.text);
      const meta = noteMeta(m.to, n.text);
      setTitle(meta.title);
      savedTitle.current = meta.title;
      titleFrom.current = null;
      fresh.current = true;
      freshDepth.current = edRef.current?.historyDepth() ?? 0;
      onRenamed(m.to);
      onMeta(meta);
      movingDone.current?.(); // QA N2: a type move of this note ends once its new text is in the editor
    })();
  }), []);
  // D-386: while this note is open, a job changes it through this editor, never on disk behind it.
  const editing = loaded?.mode === 'edit' && !daily?.virtual;
  useEffect(() => {
    if (!editing) return;
    const p = path;
    void ipc.editorOpen(p).catch(() => {});
    const un = registerLive(p, (ops) => {
      const ed = edRef.current;
      const s = saver.current;
      if (!ed || !s) return;
      const cur = ed.text();
      const r = transform(p, cur, ops as TextOp[]);
      if (r.kind !== 'bytes') return;
      // 4D-lite: a change of the frontmatter only (a tag in `tags:`) is one frontmatter edit, as the attribute panel's.
      if (r.text.slice(headOf(r.text).length) === cur.slice(headOf(cur).length)) {
        ed.applyFrontmatter(r.text);
        setHead(headOf(r.text));
        s.changed();
        return;
      }
      ed.reload(r.text);
      ed.markSaved(diskTextRef.current);
      s.changed();
    });
    return () => { un(); void ipc.editorClose(p).catch(() => {}); };
  }, [path, editing]);

  // ------------------------------------------------------------------ note-ready and the first focus
  // D-520, D-255: a new note's title holds the caret before it is painted, so keys typed right after ⌘N land in it.
  // The App's own placeFocus call comes frames later (after the meta); until then nothing else has the focus.
  useLayoutEffect(() => {
    if (!loaded || loaded.mode !== 'edit' || showSource || !createdAtOpen.current || live.current.daily || !heading.current) return;
    const a = document.activeElement;
    if ((a && a !== document.body) || document.querySelector('[role="dialog"]')) return;
    wantFocus.current = true;
    placeFocus.current();
  }, [loaded]); // eslint-disable-line react-hooks/exhaustive-deps
  const readyFor = useRef<string | null>(null);
  useEffect(() => {
    if (!loaded) return;
    const key = `${path}#${fragment ?? ''}`;
    if (readyFor.current === key) return;
    readyFor.current = key;
    requestAnimationFrame(() => {
      const main = root.current?.closest('main');
      if (restoreScroll !== undefined && main) main.scrollTop = restoreScroll;
      else if (fragment) scrollToFragment(root.current, fragment);
      onRestored?.();
      placeFocus.current();
      // NFR-PERF-05 AC-4 (D-247): an editable note is ready once the editor is mounted and the caret placed (onEditor).
      if (loaded.mode !== 'edit') {
        void ipc.perfMark('note-ready').catch(() => {});
        noteReady();
      }
    });
  }, [loaded, fragment, path]);

  placeFocus.current = () => {
    if (!wantFocus.current || !loaded) return;
    if (document.querySelector('[role="dialog"]')) { wantFocus.current = false; return; }
    const edit = loaded.mode === 'edit' && !showSource;
    // A new note: the title in edit mode, caret at its end, nothing selected (D-255). The title field exists before the
    // editor mounts, so it takes the focus at once: what is typed right after ⌘N lands in it (D-520).
    if (edit && !edRef.current) return; // again when the editor is ready
    wantFocus.current = false;
    // D-367: a new object whose title is fixed (a Daily Note, D-320) gets the caret at the start of its first block.
    if (edit && createdAtOpen.current && live.current.daily && pane.current?.caretToStart()) {
      setFocusTarget('body');
      return;
    }
    if (edit && createdAtOpen.current) {
      const el = heading.current;
      if (el) {
        el.focus({ preventScroll: true });
        const r = document.createRange();
        r.selectNodeContents(el);
        r.collapse(false);
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(r);
        setFocusTarget('title');
        return;
      }
    }
    // FR-LNK-01 AC-6 (D-280): from a backlinks excerpt, the property or the link itself.
    if (attr) {
      const row = [...(root.current?.querySelectorAll<HTMLElement>('[data-key]') ?? [])].find((r) => r.dataset.key?.normalize('NFC') === attr.normalize('NFC'));
      const ctl = row?.querySelector<HTMLElement>('input, textarea, [role="combobox"], [role="textbox"], button:not([aria-disabled="true"]), [tabindex="0"]');
      if (ctl) {
        row!.scrollIntoView({ block: 'nearest' });
        ctl.focus({ preventScroll: true });
        setFocusTarget('body');
        return;
      }
    }
    if (selectEmbedOf && edit && pane.current) {
      const p = pane.current;
      const blocks = p.embedBlocks();
      setFocusTarget('body');
      if (!blocks.length) { p.caretToStart(); return; }
      void ipc.linkResolve(path, blocks.map((b) => b.target)).then((rs) => {
        const i = rs.findIndex((r) => (r.path ?? '').normalize('NFC') === selectEmbedOf.normalize('NFC'));
        if (i < 0 || !p.selectBlockAtTop(blocks[i].index)) p.caretToStart();
      }, () => p.caretToStart());
      return;
    }
    if (at && !edit) {
      const line = root.current?.querySelector<HTMLElement>(`[data-line="${at.line}"]`);
      if (line) line.scrollIntoView({ block: 'center' });
    }
    if (at && edit && pane.current?.caretAtLink(at, loaded.text)) {
      setFocusTarget('body');
      return;
    }
    if (edit && live.current.daily?.virtual && pane.current?.caretToEnd()) {
      setFocusTarget('body');
      return;
    }
    if (edit && pane.current?.caretToStart(fragment)) {
      setFocusTarget('body');
      // Back/Forward restore a scroll position: the caret never moves it (D-255).
      const main = root.current?.closest('main');
      if (restoreScroll !== undefined && main) {
        main.scrollTop = restoreScroll;
        requestAnimationFrame(() => { main.scrollTop = restoreScroll; });
      }
      return;
    }
    heading.current?.focus({ preventScroll: true });
    setFocusTarget('heading');
  };

  // Slice PW: the page width. The key is the file's id, else its NFC path; an unwritten draft has no key (AP-758); a
  // virtual Daily Note is keyed by its path until its first write (`savedId` is set only for a file on disk).
  const widthKey = savedId ?? (draft ? null : nfc(path));
  const stored = widthKey ? widths?.[widthKey] : undefined;
  // A stored value is read as `wide` or `normal` only (a hand-edited or newer ui-state.json never breaks the radios).
  const pageWidth: PageWidth = stored !== undefined ? pageWidthOf(stored) : (draft ? draftWidth ?? undefined : undefined) ?? defaultWidth;
  const chooseWidth = (w: PageWidth) => {
    if (w === pageWidth) return; // AP-760: a click on the checked value sends nothing
    if (!widthKey) { setDraftWidth(w); return; }
    onWidth?.(widthKey, w);
  };
  chooseWidthRef.current = chooseWidth;
  // The key moved to the id the first write assigned: the entry follows it (AC-5, AC-8), one `ui_state_set`.
  const prevKey = useRef<string | null>(widthKey);
  useEffect(() => {
    const from = prevKey.current;
    prevKey.current = widthKey;
    if (!widthKey || from === widthKey) return;
    if (from && widths?.[from] !== undefined && widths?.[widthKey] === undefined) onRekeyWidth?.(from, widthKey, widths[from]);
    else if (!from && draftWidth && widths?.[widthKey] === undefined) { onRekeyWidth?.(null, widthKey, draftWidth); setDraftWidth(null); }
  }, [widthKey]);

  if (gone) {
    return (
      <div className="note-column">
        <h1 ref={heading} tabIndex={-1} className="note-title sr-only">{t('note.gone')}</h1>
        <p role="status" aria-label={t('note.gone')} className="note-gone">{t('note.gone')}</p>
      </div>
    );
  }
  if (!loaded) return null;
  const meta = noteMeta(path, diskText || loaded.text);
  const editable = loaded.mode === 'edit';
  const warning = loaded.mode === 'invalidFrontmatter' ? frontmatterWarning(parse(loaded.text.replace(/^﻿/, ''))) : null;
  // D-421: the Save state covers every file of the page (host and editable embeds).
  const embedState = embeds.saveState();
  const RANK: Record<string, number> = { saved: 0, saving: 1, failed: 2, conflict: 3 };
  const shownState = save.state === 'readOnly' ? save.state : (RANK[embedState] ?? 0) > (RANK[save.state] ?? 0) ? embedState : save.state;
  const saveText = t(`save.${shownState}`);
  // 3D: the type in effect (FR-TYP-13): the panel's frontmatter in the editor, else the file.
  const fmDoc = parse(editable ? head : (diskText || loaded.text));
  const fmData = fmDoc.frontmatter?.data ?? {};
  const typed = typeOfValue(types, (fmData as Record<string, unknown>).type);
  const chipType = typed.single ? typed.type : pageFallback(types);
  const chipKey = typed.single ? typed.key : 'page';
  // 4E-1 (D-804, ms4-jobs §14.7): a type change is a `type-move` job: the core's R101 plan, the mapping dialog when a
  // property needs an answer, then the move. Templates and unsaved drafts keep the in-place change (D-829, D-520).
  const changeType = async (key: string) => {
    const p = live.current.path;
    if (isDraft() || p.startsWith('_templates/')) { commit((d) => setValue(d, 'type', key)); return; }
    const plan = await ipc.typeMovePlan([p], key).catch(() => null);
    if (!plan) { setMoveError(t('typeMove.failed')); return; } // never a silent in-place change (QA 4E-1)
    const toName = types.find((x) => x.key === key)?.name ?? key;
    if (plan.needsDialog) setMapping({ plan: { rows: plan.rows, needsDialog: true }, names: {}, key, toName });
    else void startMove(key, toName, []);
  };
  const startMove = async (key: string, toName: string, map: { from: string; to: string }[]) => {
    const p = live.current.path;
    const sv = saver.current;
    await sv?.flush();
    sv?.hold(); // ms4-jobs §9: no write to the old path while the job moves the note
    // Nothing is typed while the job moves the note: its text would carry the old frontmatter (QA 4E-1).
    const tiptap = edRef.current?.editor;
    tiptap?.setEditable(false);
    setMoving(true);
    let ended = false;
    const unblock = () => {
      if (ended) return;
      ended = true;
      movingDone.current = null;
      setMoving(false);
      if (!mergeOpen.current) tiptap?.setEditable(true); // the merge dialog keeps the editor read-only (FR-SYN-03 AC-13)
    };
    const reload = async () => {
      // The type changed in place (the note was already in its new type's folder): the editor takes the new bytes.
      const n = await ipc.noteRead(p).catch(() => null);
      if (n && sv) { sv.moved(p, n.version); edRef.current?.reload(n.text); syncHead(); setDiskText(n.text); onMeta(noteMeta(p, n.text)); }
      else sv?.release();
    };
    void moveNotes([p], key, toName, map, false, (r) => {
      // N12: "nothing was written" only when nothing was; a job that wrote files lists what it skipped instead.
      if (r && r.phase !== 'done' && r.written.length === 0) setMoveError(t('typeMove.failed'));
      // A moved note is reloaded by `onMoved`, which ends the block; the timer only guards a lost event.
      if (!r?.renamed) void reload().finally(unblock);
      else { movingDone.current = unblock; setTimeout(unblock, 10_000); }
    }).catch(() => { sv?.release(); unblock(); setMoveError(t('typeMove.failed')); });
  };
  const panelType = typed.type && typed.single ? typed.type : pageFallback(types);
  // D-591, D-607: the review control at the right end of the type row (the daily header has its own, D-330).
  const reviewShown = !daily && !draft && editable && !showSource && !moving && reviewable({ path, type: chipKey, hasFrontmatter: !!fmDoc.frontmatter, review: (fmData as Record<string, unknown>).review, typeReview: (chipType as { review?: string } | undefined)?.review });
  const reviewed = reviewOf(fmData);
  const reviewToggle = reviewShown ? (
    <ReviewCheck reviewed={reviewed} onToggle={(r) => setReviewedRef.current(r)} commands={['note.markReviewed', 'note.markUnreviewed']} />
  ) : null;


  return (
    <div ref={root} className="note-root" data-focus-target={focusTarget ?? undefined} onKeyDownCapture={onRenameKey}>
      {!focusMode && (
        <div className="note-toolbar" role="toolbar" aria-label={t('note.toolbar')}>
          <button tabIndex={0} type="button" className="icon-button source-toggle" aria-pressed={showSource} aria-label={t(showSource ? 'note.showFormatted' : 'note.showSource')} title={t(showSource ? 'note.showFormatted' : 'note.showSource')} data-command="note.toggleSource" disabled={moving} onMouseDown={(e) => e.preventDefault()} onClick={() => void toggle()}>
            <Icon name="source" />
          </button>
          <span role="status" aria-live="polite" aria-label={t('save.label')} className={`save-state ${shownState}`}>
            {shownState === 'saved' && <Icon name="check" size={14} />}
            <span>{saveText}</span>
          </span>
          <span className="spacer" />
          <WidthSwitch value={pageWidth} onChange={chooseWidth} commands="note.width" keepFocus />
          <button tabIndex={0} type="button" className="icon-button" aria-label={t('frame.focusMode')} data-command="view.toggleFocus" onClick={onFocus}>
            <Icon name="focus" />
          </button>
          <button tabIndex={0} type="button" className="icon-button" aria-label={t('cmd.toggleRightPanel')} data-command="view.toggleRightPanel" onClick={onTogglePanel}>
            <Icon name="panel" />
          </button>
        </div>
      )}
      <div className="note-column" data-width={pageWidth}>
        <div className="note-type-row">
          <TypeChip apiRef={chipApi} type={chipType} typeKey={chipKey} types={types} readOnly={!editable || showSource || moving}
            onChange={(key) => { void changeType(key); }} onOpenType={onType} />
          {moveError && <span className="warning-text" role="alert">{moveError}</span>}
          {mapping && (
            <ChangeTypeDialog plan={mapping.plan} fromName={chipType?.name ?? chipKey} toName={mapping.toName} targetNames={mapping.names}
              targets={types.filter((x) => !['daily-note', 'tag', 'image', 'pdf', chipKey].includes(x.key)).map((x) => ({ key: x.key, name: x.name }))}
              onTarget={(k) => { setMapping(null); void changeType(k); }}
              onCancel={() => setMapping(null)}
              onConfirm={(m) => { const x = mapping; setMapping(null); void startMove(x.key, x.toName, m); }} />
          )}
          {reviewToggle && <span className="spacer" />}
          {reviewToggle}
        </div>
        {daily && (
          <DailyHeader info={daily} review={reviewOf(fmData)} written={!daily.virtual && editable}
            onReview={(r) => setReviewedRef.current(r)} />
        )}
        {daily ? (
          <h1 className="note-title">
            <span ref={(el) => { (heading as React.MutableRefObject<HTMLElement | null>).current = el; }} id={titleId}
              role="textbox" aria-label={t('editor.title')} aria-readonly="true" aria-description={t('daily.titleReadonly')} aria-level={1}
              tabIndex={-1} className="title-field readonly" data-user-content
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === 'ArrowDown') { e.preventDefault(); pane.current?.focus(); } else if (e.key.length === 1 || e.key === 'Backspace' || e.key === 'Delete') e.preventDefault(); }}>
              {daily.date}
            </span>
          </h1>
        ) : editable && !showSource && !moving ? (
          <div className="note-title-row">
          <h1 className="note-title" aria-label={title.trim() || undefined}>
            <TitleField
              id={titleId}
              elRef={(el) => { (heading as React.MutableRefObject<HTMLElement | null>).current = el; }}
              value={title}
              label={t('editor.title')}
              onChange={onTitle}
              onLeave={onTitleBlur}
              onDown={() => { onTitleBlur(); pane.current?.focus(); }}
              onTab={() => { onTitleBlur(); if (propertiesOpen) panelApi.current?.focusFirst(); else pane.current?.focus(); }}
            />
          </h1>
          </div>
        ) : (
          <h1 ref={heading} tabIndex={-1} className="note-title">
            <span data-user-content>{meta.title}</span>
          </h1>
        )}
        {(chipKey === 'image' || chipKey === 'pdf') && !draft && (
          <MediaObjectView path={path} type={chipKey} title={meta.title} data={fmData as Record<string, unknown>} />
        )}
        {draft && saver.current?.create !== null && !daily && <p role="status" className="daily-virtual">{t('newObject.notSaved')}</p>}
        {loaded.mode === 'utf8' && (
          <div role="alert" className="fm-warning"><strong>{t('readOnly.utf8')}</strong> {t('readOnly.utf8Body')}</div>
        )}
        {loaded.mode === 'editorFailed' && <div role="alert" className="fm-warning">{t('readOnly.editorFailed')}</div>}
        <PageAlerts />
        {path.startsWith('.trash/') && (
          <div role="status" className="banner trash-banner">
            <span>{t('trash.readOnly')}</span>
            <button type="button" onClick={() => { void ipc.trashRestore(path).then((m) => { const to = m[0]?.to; if (to) onOpen(to); }, () => {}); }}>{t('cmd.trashRestore')}</button>
          </div>
        )}
        {save.state === 'failed' && save.failure === 'io' && (
          <div role="alert" className="save-alert">
            <span>{t('save.ioFailed')}</span>
            <button type="button" onClick={() => saver.current?.retryNow()}>{t('save.tryAgain')}</button>
          </div>
        )}
        {save.state === 'failed' && save.failure === 'verify' && (
          <div role="alert" className="save-alert">
            <span>{t('save.verifyFailed')}</span>
            <button type="button" onClick={() => { edRef.current?.commands.undo(); saver.current?.changed(); }}>{t('save.undo')}</button>
          </div>
        )}
        {deleted && (
          <div role="alert" className="save-alert">
            <span><strong>{t('deleted.title')}</strong> {t('deleted.body')}</span>
            <button type="button" onClick={() => void restore()}>{t('deleted.restore')}</button>
            <button type="button" onClick={discard}>{t('deleted.discard')}</button>
          </div>
        )}
        {notice && <div role="status" className="paste-notice">{notice}</div>}
        {showSource && <SourceView text={diskText || loaded.text} warning={warning} />}
        {!showSource && loaded.mode !== 'edit' && (
          <>
            {warning && <WarningBanner warning={warning} />}
            <Properties text={loaded.text} links={loaded.links} open={propertiesOpen} onToggle={onToggleProperties} onOpen={(p: string) => onOpen(p)} onTag={onTag} />
            <ReadView text={loaded.text} path={path} links={loaded.links} onOpen={onOpen} onTag={onTag}
              onExternal={(url) => void ipc.openExternal(url).catch(() => {})} onScrollInNote={(f) => scrollToFragment(root.current, f)}
              renderEmbed={(value, line, inline) => {
                const n = embeds.getSnapshot().tree?.embeds.find((x) => x.line === line && x.inline === inline && nfc(x.value) === nfc(value));
                return n ? <Embed node={n} host={path} editable={false} modeDisabled={t('embed.cantEdit')} onOpen={(p, f) => onOpen(p, f)} onTag={onTag}
                  onExternal={(url) => void ipc.openExternal(url).catch(() => {})} /> : null;
              }} />
          </>
        )}
        {editable && (
          <div hidden={showSource}>
            {!typed.single && <p role="status" className="type-warning">{t('panel.typeWarning')}</p>}
            <AttributePanel apiRef={panelApi} text={head} type={panelType} types={types} path={path} editable={!merge && !deleted && !moving}
              open={propertiesOpen} onToggle={onToggleProperties}
              otherOpen={otherOpen} onToggleOther={() => onToggleOther?.()} onCommit={commit} onOpen={(p) => onOpen(p)} onOpenSource={onOpenSource} onTag={onTag}
              onLeaveLast={() => pane.current?.focus()} />
            <EditorPane
              embeds={embeds}
              apiRef={pane}
              text={loaded.text}
              path={path}
              types={types}
              labelBody={t('editor.body')}
              onReady={onEditor}
              onSaveNow={() => void flush()}
              flush={flush}
              daily={daily?.date ?? null}
              describedBy={titleId}
              onChange={() => {
                if (saver.current && document.activeElement?.closest('.ProseMirror')) saver.current.skipTransform = false;
                if (!(isDraft() && document.activeElement === heading.current)) saver.current?.changed(); // D-522
                syncHead();
              }}
              onOpen={onOpen}
              onTag={onTag}
              onExternal={(url) => void ipc.openExternal(url).catch(() => {})}
              onImagePaste={() => { setNotice(t('paste.images')); setTimeout(() => setNotice(null), 4000); }}
              onFailedLoad={() => { setLoaded((l) => (l ? { ...l, mode: 'editorFailed' } : l)); setSave({ state: 'readOnly', failure: null }); }}
            />
          </div>
        )}
        {daily && <ContextSections date={daily.date} onOpen={(p) => onOpen(p)} />}
      </div>
      {merge && (
        <MergeDialog merge={merge}
          onCompare={() => setMerge({ ...merge, compare: true })}
          onMine={() => void keepMine()} onTheirs={keepTheirs} onBoth={() => void keepBoth()} />
      )}
    </div>
  );
}

/** The title as editable plain text (FR-EDT-01 AC-10, D-173): it is what the page heading shows, gets the focus after
 *  navigation (D-130) and writes only `title:` (the file name changes with renames in MS4). ⏎, ↓ and Tab go to the body. */
function TitleField({ id, elRef, value, label, onChange, onLeave, onDown, onTab }: {
  id?: string;
  elRef: (el: HTMLElement | null) => void;
  value: string;
  label: string;
  onChange: (v: string) => void;
  onLeave: (to?: HTMLElement | null) => void;
  onDown: () => void;
  /** Tab: the first property, else the body (FR-EDT-07 AC-10; no description subtitle, D-313). */
  onTab?: () => void;
}) {
  const ref = useRef<HTMLSpanElement | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el && el.textContent !== value) el.textContent = value;
  }, [value]);
  return (
    <span
      ref={(el) => { ref.current = el; elRef(el); }}
      id={id} role="textbox" aria-label={label} tabIndex={-1} className="title-field" data-user-content
      data-placeholder={t('newObject.untitled')} aria-placeholder={t('newObject.untitled')}
      contentEditable="plaintext-only" suppressContentEditableWarning spellCheck={false} autoCorrect="off"
      onInput={(e) => onChange((e.currentTarget.textContent ?? '').replace(/\n/g, ' '))}
      onBlur={(e) => onLeave(e.relatedTarget as HTMLElement | null)}
      // An accessibility press (VoiceOver, UI automation) clicks without focusing the field: focus it, caret at the end.
      onClick={(e) => {
        const el = e.currentTarget;
        if (document.activeElement === el) return;
        el.focus();
        const r = document.createRange();
        r.selectNodeContents(el);
        r.collapse(false);
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(r);
      }}
      onPaste={(e) => {
        e.preventDefault();
        const text = e.clipboardData.getData('text/plain').replace(/\s*\n\s*/g, ' ');
        document.execCommand('insertText', false, text);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Tab' && !e.shiftKey && onTab) { e.preventDefault(); onTab(); return; }
        if (e.key === 'Enter' || e.key === 'ArrowDown' || (e.key === 'Tab' && !e.shiftKey)) { e.preventDefault(); onDown(); }
      }}
    />
  );
}

/** The merge dialog (FR-SYN-03 AC-13); an embed's dialog names its note as the description (FR-EMB-03 AC-3). */
export function MergeDialog({ merge, onCompare, onMine, onTheirs, onBoth, description }: { merge: Merge; onCompare: () => void; onMine: () => void; onTheirs: () => void; onBoth: () => void; description?: string }) {
  const ref = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    ref.current?.querySelector<HTMLElement>('button')?.focus();
  }, []);
  return (
    <div className="dialog-backdrop">
      <div ref={ref} role="dialog" aria-modal="true" aria-label={t('mergeNote.title')} aria-description={description} className="dialog merge-dialog"
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Escape') e.preventDefault(); // Esc doesn't close it (D-176)
          if (e.key === 'Tab') {
            const bs = [...(ref.current?.querySelectorAll<HTMLElement>('button') ?? [])];
            const i = bs.indexOf(document.activeElement as HTMLElement);
            e.preventDefault();
            bs[(i + (e.shiftKey ? -1 : 1) + bs.length) % bs.length]?.focus();
          }
        }}>
        <h2>{t('mergeNote.title')}</h2>
        <p>{t('merge.body')}</p>
        {merge.compare && <Compare left={merge.mine} right={merge.theirs} leftLabel={t('compare.mine')} rightLabel={t('compare.theirs')} />}
        <div className="dialog-buttons">
          <button type="button" onClick={onMine}>{t('merge.keepMine')}</button>
          <button type="button" onClick={onTheirs}>{t('merge.keepTheirs')}</button>
          <button type="button" onClick={onBoth}>{t('merge.keepBoth')}</button>
          {!merge.compare && <button type="button" onClick={onCompare}>{t('merge.compare')}</button>}
        </div>
      </div>
    </div>
  );
}

/** 5A-2: the conversion's and Task cards' alerts (FR-CNV-03 AC-6, FR-CNV-06 AC-3, FR-CNV-05 AC-7). */
function PageAlerts() {
  const alerts = usePageAlerts();
  return (
    <>
      {alerts.map((a) => (
        <div key={a.id} role="alert" className="save-alert">
          <span>{a.text}</span>
          {a.retry && <button type="button" tabIndex={0} data-command="task.tryAgain" onClick={() => { dismissAlert(a.id); a.retry!(); }}>{t('task.tryAgain')}</button>}
          <button type="button" tabIndex={0} className="icon-button" data-command="task.dismissAlert" aria-label={t('dialog.close')} onClick={() => dismissAlert(a.id)}>×</button>
        </div>
      ))}
    </>
  );
}
