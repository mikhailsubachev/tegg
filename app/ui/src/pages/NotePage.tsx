// The note route (slice 3B, D-117): breadcrumb, title, the Properties strip and the formatted read-only body, with a
// read-only source view (FR-EDT-10, D-146). Files with invalid frontmatter open in the source view with a warning
// (NFR-REL-03). Links are resolved in one batch (NFR-PERF-05 AC-3). External changes reload in place; a rename
// follows the note by `id`, a delete shows a message (FR-SYN-03 AC-10, AC-11). Opening a note writes nothing.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { parse } from '@tegg/doc';
import { t } from '../i18n/catalog';
import { events, ipc } from '../ipc/client';
import type { LinkTargetDto, TypeDefDto } from '../ipc/types';
import { linkTargets, noteTitle, ReadView } from '../read/ReadView';
import { Properties } from '../read/PropertiesStrip';
import { SourceView, WarningBanner } from '../read/SourceView';
import { frontmatterWarning } from '../read/warning';
import { Disabled } from '../shell/Disabled';
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

/** The scrolling ancestor of an element (the centre pane). */
function scroller(el: Element | null): Element | null {
  let s = el?.parentElement ?? null;
  while (s && !(s.scrollHeight > s.clientHeight + 1 && /(auto|scroll)/.test(getComputedStyle(s).overflowY))) s = s.parentElement;
  return s;
}

/** The 1-based source line at the top of the visible area, from the view that is shown now. */
function visibleLine(root: HTMLElement | null): number | null {
  if (!root) return null;
  const items = [...root.querySelectorAll<HTMLElement>('[data-line], article > [data-src-line]')];
  if (items.length === 0) return null;
  const s = scroller(items[0]);
  const top = s ? Math.max(s.getBoundingClientRect().top, 0) : 0;
  const hit = items.find((e) => e.getBoundingClientRect().bottom > top + 2) ?? items[items.length - 1];
  return Number(hit.dataset.line ?? hit.dataset.srcLine);
}

function scrollToLine(root: HTMLElement | null, line: number) {
  if (!root) return;
  const lines = [...root.querySelectorAll<HTMLElement>('[data-line]')];
  if (lines.length) {
    (lines.find((l) => Number(l.dataset.line) >= line) ?? lines[lines.length - 1]).scrollIntoView({ block: 'start' });
    return;
  }
  const blocks = [...root.querySelectorAll<HTMLElement>('article > [data-src-line]')];
  let best: HTMLElement | null = null;
  for (const b of blocks) if (Number(b.dataset.srcLine) <= line) best = b;
  (best ?? blocks[0])?.scrollIntoView({ block: 'start' });
}

/** Scrolls to `#Heading` or `#^block` inside the note; a missing target leaves the note at the top (D-140). */
export function scrollToFragment(root: HTMLElement | null, fragment: string) {
  if (!root) return;
  const f = nfc(fragment.replace(/^#/, ''));
  const art = root.querySelector('article');
  if (!art) return;
  const el = f.startsWith('^')
    ? art.querySelector(`[id="${CSS.escape(f)}"]`)
    : [...art.querySelectorAll<HTMLElement>('[data-heading]')].find((h) => nfc(h.dataset.heading ?? '').toLowerCase() === f.toLowerCase());
  el?.scrollIntoView({ block: 'start' });
}

type State = { text: string; links: Map<string, LinkTargetDto> } | { gone: true } | null;

export function NotePage({ path, fragment, restoreScroll, types, heading, onType, onMeta, onOpen, onTag, onRenamed, toggleSource, focusMode, onTogglePanel, onFocus, propertiesOpen, onToggleProperties, onRestored, knownId, onId }: {
  path: string;
  fragment?: string;
  /** Back/Forward: the centre pane's saved scroll position, restored instead of the fragment (FR-NAV-03 AC-4). */
  restoreScroll?: number;
  types: TypeDefDto[];
  heading: React.RefObject<HTMLHeadingElement | null>;
  onType: (key: string) => void;
  onMeta: (m: NoteMeta | null) => void;
  onOpen: (path: string, fragment?: string) => void;
  onTag: (key: string) => void;
  onRenamed: (path: string) => void;
  /** Incremented by the `note.toggleSource` command (⌥⌘U, palette). */
  toggleSource: number;
  focusMode: boolean;
  onTogglePanel: () => void;
  onFocus: () => void;
  propertiesOpen: boolean;
  onToggleProperties: () => void;
  onRestored?: () => void;
  /** The note's `id` when it was last shown (Back/Forward), to find it after a rename. */
  knownId?: string;
  onId?: (id: string) => void;
}) {
  const [state, setState] = useState<State>(null);
  const [source, setSource] = useState<boolean | null>(null); // null: the default for this file
  const root = useRef<HTMLDivElement | null>(null);
  const pendingLine = useRef<number | null>(null);
  const live = useRef({ path, state });
  live.current = { path, state };

  const load = useCallback(async (initial: boolean) => {
    try {
      const n = await ipc.noteRead(path);
      const targets = linkTargets(n.text);
      const resolved = targets.length ? await ipc.linkResolve(path, targets).catch(() => [] as LinkTargetDto[]) : [];
      if (live.current.path !== path) return;
      setState({ text: n.text, links: new Map(resolved.map((r) => [r.target, r])) });
      const id = parse(n.text.replace(/^\uFEFF/, '')).frontmatter?.data?.id;
      if (typeof id === 'string' && id) onId?.(id);
      onMeta(noteMeta(path, n.text));
    } catch {
      if (live.current.path !== path) return;
      // Gone from this path: renamed (same `id`, FR-SYN-03 AC-5) or deleted / moved to `.trash/` (AC-11).
      const prev = live.current.state;
      const id = prev && 'text' in prev ? parse(prev.text).frontmatter?.data?.id : knownId;
      if (typeof id === 'string' && id) {
        const [r] = await ipc.linkResolve(path, [id]).catch(() => [] as LinkTargetDto[]);
        if (r?.path && r.kind === 'note' && nfc(r.path) !== nfc(path)) {
          onRenamed(r.path);
          return;
        }
      }
      setState({ gone: true });
      if (initial) onMeta(null);
    }
  }, [path]);

  // One read and one link resolution per opened note (NFR-PERF-05 AC-3), also when StrictMode re-runs the effect.
  const loadedFor = useRef<string | null>(null);
  useEffect(() => {
    if (loadedFor.current !== path) {
      loadedFor.current = path;
      setState(null);
      setSource(null);
      void load(true);
    }
    const un = events.changed((c) => {
      if (c.paths.some((p) => nfc(p) === nfc(path))) void load(false);
    });
    return () => void un.then((f) => f());
  }, [path]);

  const text = state && 'text' in state ? state.text : null;
  const doc = text !== null ? parse(text.replace(/^﻿/, '')) : null;
  const warning = doc ? frontmatterWarning(doc) : null;
  const showSource = source ?? !!warning;

  // ⌥⌘U / palette toggle, keeping the reading position (D-146).
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    if (text === null) return;
    pendingLine.current = visibleLine(root.current);
    setSource(!showSource);
  }, [toggleSource]);
  const toggle = () => {
    pendingLine.current = visibleLine(root.current);
    setSource(!showSource);
  };
  useLayoutEffect(() => {
    if (pendingLine.current === null) return;
    const line = pendingLine.current;
    pendingLine.current = null;
    scrollToLine(root.current, line);
  }, [showSource]);

  // `note-ready` (ms3-shell §11.5) and the fragment scroll, once the view with resolved links has painted.
  const readyFor = useRef<string | null>(null);
  useEffect(() => {
    if (text === null) return;
    const key = `${path}#${fragment ?? ''}`;
    if (readyFor.current === key) return;
    readyFor.current = key;
    requestAnimationFrame(() => {
      const main = root.current?.closest('main');
      if (restoreScroll !== undefined && main) main.scrollTop = restoreScroll;
      else if (fragment) scrollToFragment(root.current, fragment);
      onRestored?.();
      void ipc.perfMark('note-ready').catch(() => {});
    });
  }, [text, fragment, path]);

  if (state === null) return null;
  if ('gone' in state) {
    return (
      <div className="note-column">
        <h1 ref={heading} tabIndex={-1} className="note-title sr-only">{t('note.gone')}</h1>
        <p role="status" aria-label={t('note.gone')} className="note-gone">{t('note.gone')}</p>
      </div>
    );
  }
  const meta = noteMeta(path, state.text);
  const plural = pluralOf(types, meta.type);
  const stem = path.split('/').pop()!.replace(/\.md$/, '');
  return (
    <div ref={root} className="note-root">
      {!focusMode && (
        <div className="note-toolbar" role="toolbar" aria-label={t('note.toolbar')}>
          <button tabIndex={0} type="button" className="icon-button source-toggle" aria-pressed={showSource} aria-label={t(showSource ? 'note.showFormatted' : 'note.showSource')} title={t(showSource ? 'note.showFormatted' : 'note.showSource')} data-command="note.toggleSource" onClick={toggle}>
            <Icon name="source" />
          </button>
          <Disabled control="ctl.edit" />
          <span className="toolbar-note">{t('note.editingLater')}</span>
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
          <span className="sep" aria-hidden="true">/</span>
          <span data-user-content>{stem}</span>
        </nav>
        <div className="note-header-controls">
          <Disabled control="ctl.addIcon" />
          <Disabled control="ctl.addCover" />
        </div>
        <h1 ref={heading} tabIndex={-1} className="note-title">
          <span data-user-content>{meta.title}</span>
        </h1>
        {showSource ? (
          <SourceView text={state.text} warning={warning} />
        ) : (
          <>
            {warning && <WarningBanner warning={warning} />}
            <Properties text={state.text} links={state.links} open={propertiesOpen} onToggle={onToggleProperties} onOpen={(p: string) => onOpen(p)} onTag={onTag} />
            <ReadView
              text={state.text}
              path={path}
              links={state.links}
              onOpen={onOpen}
              onTag={onTag}
              onExternal={(url) => void ipc.openExternal(url).catch(() => {})}
              onScrollInNote={(f) => scrollToFragment(root.current, f)}
            />
          </>
        )}
      </div>
    </div>
  );
}
