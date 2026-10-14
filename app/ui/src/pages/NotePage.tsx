// The note route. Slice 3B read view (D-117) and, from 3C, the editor: the body is @tegg/editor with autosave
// (FR-EDT-01, FR-EDT-08), the title is editable (D-173), external changes reload a clean note and open the merge
// dialog for a dirty one (FR-SYN-03 AC-12…AC-18), and files the editor can't open safely stay read-only (NFR-REL-03
// AC-6…AC-9, D-117). Opening a note writes nothing (FR-FMT-07 AC-8).
import { useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type Ref } from 'react';
import { parse } from '@tegg/doc';
import type { TeggEditor } from '@tegg/editor';
import { t } from '../i18n/catalog';
import { events, ipc } from '../ipc/client';
import type { LinkTargetDto, TypeDefDto, VersionDto } from '../ipc/types';
import { Saver, type ConflictInfo, type Failure, type SaveState } from '../edit/autosave';
import { Compare } from '../edit/Compare';
import { EditorPane, type EditAction, type EditorPaneApi } from '../edit/EditorPane';
import { linkTargets, noteTitle, ReadView } from '../read/ReadView';
import { Properties } from '../read/PropertiesStrip';
import { SourceView, WarningBanner } from '../read/SourceView';
import { frontmatterWarning } from '../read/warning';
import { Icon } from '../shell/Icon';
import { pluralOf } from '../shell/types';

export type NoteMeta = { title: string; type: string };

/** Title and type from the frontmatter (untyped files are Pages, D-103), else the file name. */
export function noteMeta(path: string, text: string): NoteMeta {
  const doc = parse(text.replace(/^﻿/, ''));
  const type = doc.frontmatter?.data?.type;
  return { title: noteTitle(doc, path), type: (typeof type === 'string' && type.trim() ? type : 'page').toLowerCase().normalize('NFC') };
}

const nfc = (s: string) => s.normalize('NFC');

/** Scrolls to `#Heading` or `#^block` inside the note; a missing target leaves the note at the top (D-140). */
export function scrollToFragment(root: HTMLElement | null, fragment: string) {
  if (!root) return;
  const f = nfc(fragment.replace(/^#/, ''));
  const art = root.querySelector('article, [aria-label][contenteditable]');
  if (!art) return;
  const el = f.startsWith('^')
    ? art.querySelector(`[id="${CSS.escape(f)}"]`)
    : [...art.querySelectorAll<HTMLElement>('[data-heading], h1, h2, h3, h4, h5, h6')].find((h) => nfc(h.dataset.heading ?? h.textContent ?? '').trim().toLowerCase() === f.toLowerCase());
  el?.scrollIntoView({ block: 'start' });
}

/** What the page shows: the editor, or a read-only view with the reason (R9 "Read-only"). */
type Mode = 'edit' | 'invalidFrontmatter' | 'utf8' | 'editorFailed' | 'readView';
type Loaded = { text: string; version: VersionDto; mode: Mode; links: Map<string, LinkTargetDto> };
type Merge = { mine: string; theirs: string; theirsVersion: VersionDto; compare: boolean };

export type NotePageApi = {
  flush: () => Promise<void>;
  edit: (a: EditAction) => void;
  pending: () => boolean;
  /** The merge dialog is open (FR-SYN-03 AC-19). */
  mergeOpen: () => boolean;
  /** `Keep both`, for quitting with the merge dialog open (D-176). */
  keepBoth: () => Promise<void>;
};

function stamp(): string {
  const d = new Date(Date.now());
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}-${p(d.getMinutes())}`;
}

export function NotePage({ apiRef, path, fragment, restoreScroll, types, heading, onType, onMeta, onOpen, onTag, onRenamed, toggleSource, focusMode, onTogglePanel, onFocus, propertiesOpen, onToggleProperties, onRestored, knownId, onId, created }: {
  apiRef?: Ref<NotePageApi>;
  path: string;
  fragment?: string;
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
  /** A note just created with New object: the caret goes into the empty body (AP-135). */
  created?: boolean;
}) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [gone, setGone] = useState(false);
  const [source, setSource] = useState<boolean | null>(null);
  const [save, setSave] = useState<{ state: SaveState; failure: Failure }>({ state: 'saved', failure: null });
  const [merge, setMerge] = useState<Merge | null>(null);
  const [deleted, setDeleted] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [title, setTitle] = useState<string>('');
  const [diskText, setDiskText] = useState<string>('');
  const root = useRef<HTMLDivElement | null>(null);
  const pane = useRef<EditorPaneApi | null>(null);
  const edRef = useRef<TeggEditor | null>(null);
  const saver = useRef<Saver | null>(null);
  const savedTitle = useRef('');
  const live = useRef({ path, loaded, merge, deleted });
  live.current = { path, loaded, merge, deleted };

  // ------------------------------------------------------------------ load
  const loadedOnce = useRef(false);
  const load = useCallback(async () => {
    try {
      const n = await ipc.noteRead(path);
      const doc = parse(n.text.replace(/^﻿/, ''));
      // D-215: a test-only switch shows the read view (the fallback view of D-117) instead of the editor.
      const readView = !!(window as { __TEGG_TEST__?: { readView?: boolean } }).__TEGG_TEST__?.readView;
      const mode: Mode = !n.utf8 ? 'utf8' : frontmatterWarning(doc) ? 'invalidFrontmatter' : readView ? 'readView' : 'edit';
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
      setTitle(meta.title);
      savedTitle.current = meta.title;
      const id = doc.frontmatter?.data?.id;
      if (typeof id === 'string' && id) onId?.(id);
      onMeta(meta);
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
    saver.current = new Saver(path, ed, l.version, {
      state: (state, failure) => setSave({ state, failure }),
      conflict: (c: ConflictInfo) => setMerge({ mine: c.mine, theirs: c.theirs, theirsVersion: c.theirsVersion, compare: false }),
      gone: () => setDeleted(true),
      written: (text) => {
        setDiskText(text);
        savedTitle.current = noteMeta(live.current.path, text).title;
        void ipc.perfMark('note-saved').catch(() => {});
      },
    }, () => !!pane.current?.slashOpen());
    const w = window as { __TEGG_TEST__?: Record<string, unknown> };
    w.__TEGG_TEST__ = { ...(w.__TEGG_TEST__ ?? {}), editor: { text: () => ed.text(), dirty: () => ed.dirty() || !!saver.current?.pending, historyDepth: () => ed.historyDepth() } };
  }, [path]);

  useEffect(() => () => saver.current?.dispose(), []);

  const flush = useCallback(async () => {
    const s = saver.current;
    if (s) await s.flush();
  }, []);

  useImperativeHandle(apiRef, () => ({
    flush,
    edit: (a) => {
      if (a === 'saveNow') { void flush(); return; }
      pane.current?.run(a);
    },
    pending: () => !!saver.current?.pending || !!live.current.merge || live.current.deleted,
    mergeOpen: () => !!live.current.merge,
    keepBoth: () => keepBothRef.current(),
  }), [flush]);

  // ------------------------------------------------------------------ external changes (FR-SYN-03)
  const external = useCallback(async () => {
    const l = live.current.loaded;
    if (!l) return;
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
    const meta = noteMeta(live.current.path, n.text);
    savedTitle.current = meta.title;
    setTitle(meta.title);
    onMeta(meta);
  }, [diskText, knownId]);
  const diskTextRef = useRef(diskText);
  diskTextRef.current = diskText;
  const externalRef = useRef(external);
  externalRef.current = external;
  useEffect(() => {
    const un = events.changed((c) => {
      if (c.paths.some((p) => nfc(p) === nfc(live.current.path))) void externalRef.current();
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
    setTitle(v);
    const ed = edRef.current;
    if (!ed) return;
    const tt = v.normalize('NFC');
    ed.setTitle(tt.trim() === '' ? null : tt);
    if (tt.trim() !== '') saver.current?.changed();
  };
  const onTitleBlur = () => {
    if (title.trim() === '') {
      setTitle(savedTitle.current);
      edRef.current?.setTitle(null);
    }
  };

  // ------------------------------------------------------------------ note-ready and the first focus
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
      if (created && loaded.mode === 'edit') requestAnimationFrame(() => pane.current?.focus());
      onRestored?.();
      void ipc.perfMark('note-ready').catch(() => {});
    });
  }, [loaded, fragment, path]);

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
  const plural = pluralOf(types, meta.type);
  const segs = path.split('/');
  const stem = segs.pop()!.replace(/\.md$/, '');
  const folder = segs.join('/');
  const editable = loaded.mode === 'edit';
  const warning = loaded.mode === 'invalidFrontmatter' ? frontmatterWarning(parse(loaded.text.replace(/^﻿/, ''))) : null;
  const saveText = t(`save.${save.state}`);

  return (
    <div ref={root} className="note-root">
      {!focusMode && (
        <div className="note-toolbar" role="toolbar" aria-label={t('note.toolbar')}>
          <button tabIndex={0} type="button" className="icon-button source-toggle" aria-pressed={showSource} aria-label={t(showSource ? 'note.showFormatted' : 'note.showSource')} title={t(showSource ? 'note.showFormatted' : 'note.showSource')} data-command="note.toggleSource" onMouseDown={(e) => e.preventDefault()} onClick={() => void toggle()}>
            <Icon name="source" />
          </button>
          <span role="status" aria-live="polite" aria-label={t('save.label')} className={`save-state ${save.state}`}>
            {save.state === 'saved' && <Icon name="check" size={14} />}
            <span>{saveText}</span>
          </span>
          <span className="spacer" />
          <button tabIndex={0} type="button" className="icon-button" aria-label={t('frame.focusMode')} data-command="view.toggleFocus" onClick={onFocus}>
            <Icon name="focus" />
          </button>
          <button tabIndex={0} type="button" className="icon-button" aria-label={t('cmd.toggleRightPanel')} data-command="view.toggleRightPanel" onClick={onTogglePanel}>
            <Icon name="panel" />
          </button>
        </div>
      )}
      <div className="note-column">
        <nav className="breadcrumb" aria-label={t('note.breadcrumb')}>
          <a href="#" tabIndex={0} data-command={`goto.type:${meta.type}`} onClick={(e) => { e.preventDefault(); onType(meta.type); }}>
            <span data-user-content>{plural}</span>
          </a>
          {folder && types.some((x) => x.key === meta.type && x.folder !== folder) && (
            <>
              <span className="sep" aria-hidden="true">/</span>
              <span data-user-content>{folder}</span>
            </>
          )}
          <span className="sep" aria-hidden="true">/</span>
          <span data-user-content>{stem}</span>
        </nav>
        {editable && !showSource ? (
          <h1 className="note-title">
            <TitleField
              elRef={(el) => { (heading as React.MutableRefObject<HTMLElement | null>).current = el; }}
              value={title}
              label={t('editor.title')}
              onChange={onTitle}
              onLeave={onTitleBlur}
              onDown={() => { onTitleBlur(); pane.current?.focus(); }}
            />
          </h1>
        ) : (
          <h1 ref={heading} tabIndex={-1} className="note-title">
            <span data-user-content>{meta.title}</span>
          </h1>
        )}
        {loaded.mode === 'utf8' && (
          <div role="alert" className="fm-warning"><strong>{t('readOnly.utf8')}</strong> {t('readOnly.utf8Body')}</div>
        )}
        {loaded.mode === 'editorFailed' && <div role="alert" className="fm-warning">{t('readOnly.editorFailed')}</div>}
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
              onExternal={(url) => void ipc.openExternal(url).catch(() => {})} onScrollInNote={(f) => scrollToFragment(root.current, f)} />
          </>
        )}
        {editable && (
          <div hidden={showSource}>
            <Properties text={diskText || loaded.text} links={loaded.links} open={propertiesOpen} onToggle={onToggleProperties} onOpen={(p: string) => onOpen(p)} onTag={onTag} />
            <EditorPane
              apiRef={pane}
              text={loaded.text}
              path={path}
              types={types}
              labelBody={t('editor.body')}
              onReady={onEditor}
              onSaveNow={() => void flush()}
              autoFocus={created}
              onChange={() => saver.current?.changed()}
              onOpen={onOpen}
              onTag={onTag}
              onExternal={(url) => void ipc.openExternal(url).catch(() => {})}
              onImagePaste={() => { setNotice(t('paste.images')); setTimeout(() => setNotice(null), 4000); }}
              onFailedLoad={() => { setLoaded((l) => (l ? { ...l, mode: 'editorFailed' } : l)); setSave({ state: 'readOnly', failure: null }); }}
            />
          </div>
        )}
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
function TitleField({ elRef, value, label, onChange, onLeave, onDown }: {
  elRef: (el: HTMLElement | null) => void;
  value: string;
  label: string;
  onChange: (v: string) => void;
  onLeave: () => void;
  onDown: () => void;
}) {
  const ref = useRef<HTMLSpanElement | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el && el.textContent !== value) el.textContent = value;
  }, [value]);
  return (
    <span
      ref={(el) => { ref.current = el; elRef(el); }}
      role="textbox" aria-label={label} aria-level={1} tabIndex={-1} className="title-field" data-user-content
      contentEditable="plaintext-only" suppressContentEditableWarning spellCheck={false} autoCorrect="off"
      onInput={(e) => onChange((e.currentTarget.textContent ?? '').replace(/\n/g, ' '))}
      onBlur={onLeave}
      onPaste={(e) => {
        e.preventDefault();
        const text = e.clipboardData.getData('text/plain').replace(/\s*\n\s*/g, ' ');
        document.execCommand('insertText', false, text);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === 'ArrowDown' || (e.key === 'Tab' && !e.shiftKey)) { e.preventDefault(); onDown(); }
      }}
    />
  );
}

function MergeDialog({ merge, onCompare, onMine, onTheirs, onBoth }: { merge: Merge; onCompare: () => void; onMine: () => void; onTheirs: () => void; onBoth: () => void }) {
  const ref = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    ref.current?.querySelector<HTMLElement>('button')?.focus();
  }, []);
  return (
    <div className="dialog-backdrop">
      <div ref={ref} role="dialog" aria-modal="true" aria-label={t('merge.title')} className="dialog merge-dialog"
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
        <h2>{t('merge.title')}</h2>
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
