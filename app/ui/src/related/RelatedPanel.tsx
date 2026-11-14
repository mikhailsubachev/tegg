// The Related tab (slice REL, related.md R178; docs/contracts/v1-related.md §3): notes that share distinctive words with
// the open object, one flat list of Backlinks chips (D-600, D-633) with one plain excerpt sentence each (R182), and the
// `Show linked notes` switch (D-1695). One `index_related` per object and switch state, re-asked on vault changes
// (debounced), the page's own saves and the index's `done`; only while this tab is shown (AC-29). Nothing here writes.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { t } from '../i18n/catalog';
import { errorKind, events, ipc } from '../ipc/client';
import type { RelatedDto, RelatedEntryDto, TypeDefDto } from '../ipc/types';
import { chipParts } from '../links/ChipParts';
import { chipIcon } from '../links/icons';
import { BacklinkChip } from '../links/BacklinksPanel';
import { Icon, SYSTEM_DEFAULT } from '../shell/Icon';
import { focusAfter } from './model';

/** §3.4: `Loading…` only when the answer takes longer than this (NFR-PERF-08, D-1707). */
const LOADING_AFTER = 300;
/** §3.4: `vault:changed` re-asks this long after the last one (trailing, AC-28). */
const DEBOUNCE = 300;
const EMPTY: RelatedDto = { entries: [], reason: null };
/** §3.5: the tab panel's scroll position per path, for this session (Back restores it, AC-26). */
const scrolls = new Map<string, number>();
/** The last `Show related` tick whose focus was placed (the panel may mount because of it). */
let focusConsumed = 0;

export type RelatedPanelProps = {
  /** `centrePath(…)`: null → the empty state, no request. */
  path: string | null;
  /** `showLinkedOf(ui)`. */
  showLinked: boolean;
  /** App: one `ui_state_set` with `withShowLinked`. */
  onToggleLinked(): void;
  /** App: opens `openRouteOf(entry)` (one `nav_opened`, as a Backlinks chip). */
  onOpen(entry: RelatedEntryDto): void;
  /** App's own-save listeners (as GraphPanel): re-ask after the page's `Saved`; `idle()` is true while the page has
   *  nothing left to save (D-1753). */
  onOwnSave(f: (idle: () => boolean) => void): () => void;
  /** Changes when `Show related` ran. */
  focusFirst: number;
  types: TypeDefDto[];
};

type Shown = { key: string; dto: RelatedDto; json: string };

export function RelatedPanel({ path, showLinked, onToggleLinked, onOpen, onOwnSave, focusFirst, types }: RelatedPanelProps) {
  const key = path === null ? null : `${path}\u0000${showLinked ? 1 : 0}`;
  const [shown, setShown] = useState<Shown | null>(null);
  /** The key whose `Loading…` is shown (300 ms without an answer, or `NotReady`). */
  const [loading, setLoading] = useState<string | null>(null);
  // §3.4 (AC-27): a key change clears the drawn list in the same render, so no list of another object, or of the other
  // switch state, is drawn even for one frame.
  const [forKey, setForKey] = useState(key);
  if (forKey !== key) {
    setForKey(key);
    setShown(null);
    setLoading(null);
  }

  const box = useRef<HTMLDivElement | null>(null);
  const sw = useRef<HTMLButtonElement | null>(null);
  const seq = useRef(0);
  const timer = useRef(0);
  /** The latest request has its answer (the frame after 300 ms then draws no `Loading…`). */
  const answered = useRef(false);
  const live = useRef({ path, showLinked, key });
  live.current = { path, showLinked, key };
  const shownRef = useRef(shown);
  shownRef.current = shown;
  /** §3.5: the focused entry before a live update, placed again after it is drawn. */
  const pendingFocus = useRef<{ prev: string[]; focused: string } | null>(null);

  const ask = useCallback((isLive: boolean) => {
    const { path: p, showLinked: on, key: k } = live.current;
    if (p === null || k === null) return;
    const my = ++seq.current;
    window.clearTimeout(timer.current);
    // A re-ask of the drawn key keeps its list and never shows `Loading…`. The status is drawn in the frame after
    // 300 ms (AC-30: 300 ms ± 1 frame), so an answer that is already on its way at 300 ms is drawn instead.
    if (!isLive || shownRef.current?.key !== k) {
      timer.current = window.setTimeout(() => {
        if (seq.current === my) requestAnimationFrame(() => { if (seq.current === my && !answered.current) setLoading(k); });
      }, LOADING_AFTER);
    }
    answered.current = false;
    void ipc.perfMark('related-request').catch(() => {}); // §1.13
    ipc.related(p, on).then((dto) => {
      if (seq.current !== my) return; // latest wins (AC-27)
      answered.current = true;
      window.clearTimeout(timer.current);
      setLoading(null);
      const json = JSON.stringify(dto);
      const cur = shownRef.current;
      if (cur && cur.key === k && cur.json === json) return; // an equal answer redraws nothing
      const a = document.activeElement as HTMLElement | null;
      const entry = a && box.current?.contains(a) ? a.closest<HTMLElement>('[data-related-entry]') : null;
      pendingFocus.current = entry && cur && cur.key === k ? { prev: cur.dto.entries.map((e) => e.path), focused: entry.dataset.relatedEntry ?? '' } : null;
      setShown({ key: k, dto, json });
    }, (e) => {
      if (seq.current !== my) return;
      answered.current = true;
      window.clearTimeout(timer.current);
      // AC-30 (D-990's rule): `Loading…` while the index is built; asked again on `index:progress` `done`.
      if (errorKind(e) === 'NotReady') { setLoading(k); return; }
      setLoading(null);
      setShown({ key: k, dto: EMPTY, json: JSON.stringify(EMPTY) });
    });
  }, []);

  // (1) On mount and on a change of path or switch: at once (StrictMode's second run sends none).
  const asked = useRef<string | null>(null);
  useEffect(() => {
    if (key === null) { asked.current = null; seq.current++; window.clearTimeout(timer.current); return; }
    if (asked.current === key) return;
    asked.current = key;
    ask(false);
  }, [key, ask]);
  // (2) `vault:changed`, debounced; (4) `index:progress` `done`, at once. The App's refresh tick isn't an input.
  useEffect(() => {
    let debounce = 0;
    const offA = events.changed(() => { window.clearTimeout(debounce); debounce = window.setTimeout(() => ask(true), DEBOUNCE); });
    const offB = events.progress((x) => { if (x.state === 'done') ask(true); });
    return () => {
      window.clearTimeout(debounce);
      void offA.then((f) => f()).catch(() => {});
      void offB.then((f) => f()).catch(() => {});
    };
  }, [ask]);
  // (3) The page's own `Saved` (never per keystroke). D-1753: the editor's 1 s maximum-wait writes save while the user
  // is still typing, so a save asks once the page has stayed saved for DEBOUNCE (a keystroke since then: the next
  // save asks).
  useEffect(() => {
    let wait = 0;
    const off = onOwnSave((idle) => {
      window.clearTimeout(wait);
      wait = window.setTimeout(() => { if (idle()) ask(true); }, DEBOUNCE);
    });
    return () => { window.clearTimeout(wait); off(); };
  }, [onOwnSave, ask]);

  const fresh = shown && shown.key === key ? shown : null;
  const entries = fresh?.dto.entries ?? [];
  const state: 'list' | 'empty' | 'loading' | 'idle' = key === null ? 'empty' : fresh ? (entries.length ? 'list' : 'empty') : loading === key ? 'loading' : 'idle';

  // §3.5 (AC-28): after a live update the focus stays on its entry, else moves to a neighbour or the switch.
  const chipOf = (p: string) => [...(box.current?.querySelectorAll<HTMLElement>('[data-related-entry]') ?? [])]
    .find((el) => el.dataset.relatedEntry === p)?.querySelector<HTMLElement>('a[data-link-kind="note"]') ?? null;
  useLayoutEffect(() => {
    const pf = pendingFocus.current;
    pendingFocus.current = null;
    if (!pf || !fresh) return;
    const r = focusAfter(pf.prev, pf.focused, fresh.dto.entries.map((e) => e.path));
    if (r === 'switch') sw.current?.focus();
    else {
      const el = chipOf(r === 'keep' ? pf.focused : r.path);
      if (el && document.activeElement !== el) el.focus();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown]);

  // §3.5 (AC-26): the scroll position per path, restored when that path's list is drawn again; a live update keeps it.
  const restored = useRef<string | null>(null);
  const listDrawn = state === 'list';
  useLayoutEffect(() => {
    if (!listDrawn || path === null || restored.current === path || !box.current) return;
    restored.current = path;
    box.current.scrollTop = scrolls.get(path) ?? 0;
  }, [listDrawn, path]);

  // §1.13: `related-ready` two frames after an answer is drawn.
  useEffect(() => {
    if (!fresh) return;
    requestAnimationFrame(() => requestAnimationFrame(() => { void ipc.perfMark('related-ready').catch(() => {}); }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown]);

  // §3.5 (FR-NAV-05 AC-6): `Show related` focuses the first chip once the answer is drawn, else the switch.
  useEffect(() => {
    if (focusFirst <= focusConsumed || state === 'idle' || state === 'loading') return;
    focusConsumed = focusFirst;
    requestAnimationFrame(() => {
      const first = box.current?.querySelector<HTMLElement>('[data-related-entry] a[data-link-kind="note"]');
      (first ?? sw.current)?.focus();
    });
  }, [focusFirst, state]);

  const defined = (type: string) => type in SYSTEM_DEFAULT || types.some((x) => x.key.normalize('NFC') === type.normalize('NFC'));
  const entryEl = (e: RelatedEntryDto) => {
    // As a Backlinks chip (FR-LNK-01 AC-17): a type without a definition shows the generic type icon.
    const icon = defined(e.type) ? chipIcon(e.type) : { glyph: 'type', def: 'type' };
    const parts = chipParts({ kind: 'note', type: e.type, review: e.review, status: e.status, due: e.due, completed: e.completed });
    const linked = showLinked && e.linked;
    const description = [parts.description, linked ? t('related.linkedDescription') : null].filter(Boolean).join(', ') || undefined;
    return (
      <li key={e.path} className="related-entry" data-related-entry={e.path}>
        <BacklinkChip source={e.path} open={() => onOpen(e)}
          /* D-1755: an explicit link role (FR-NAV-05 AC-6 reads the focused chip as a link). */
          href="#" role="link" tabIndex={0} className="chip link-chip kind-note" data-link-kind="note" data-icon={icon.def} data-command="panel.related.open"
          aria-label={e.title} aria-description={description} title={e.title} {...parts.attrs}>
          {parts.icon ?? <Icon name={icon.glyph} dataIcon={icon.def} size={13} />}
          {/* D-764: the title wraps inside the chip; the suffix moves to the next line whole. */}
          <span className="chip-text"><span data-user-content>{e.title}</span>{parts.suffix}</span>
        </BacklinkChip>
        {linked && <span className="related-linked" data-related-linked><Icon name="link" size={11} />{t('related.linked')}</span>}
        {e.excerpt !== null && <p className="related-excerpt" data-related-excerpt data-user-content>{e.excerpt}</p>}
      </li>
    );
  };

  return (
    <div role="tabpanel" aria-label={t('related.tab')} className="panel-body related" data-related-state={state} ref={box}
      onScroll={(ev) => { if (listDrawn && path !== null) scrolls.set(path, (ev.target as HTMLElement).scrollTop); }}>
      <div className="related-header">
        <button ref={sw} type="button" role="switch" aria-checked={showLinked} tabIndex={0} className="related-switch" data-command="related.toggleLinked"
          onClick={() => onToggleLinked()}>
          <span className="related-switch-label">{t('related.showLinked')}</span>
          <span className={`related-track${showLinked ? ' on' : ''}`} aria-hidden="true"><span className="related-knob" /></span>
        </button>
      </div>
      {state === 'list' && <ul role="list" aria-label={t('related.list')} className="related-list">{entries.map(entryEl)}</ul>}
      {state === 'empty' && (
        <div className="related-empty-box">
          <Icon name="file-text" size={24} />
          <p className="related-empty">{t('related.empty')}</p>
        </div>
      )}
      {state === 'loading' && <div role="status" aria-live="polite" className="related-loading">{t('related.loading')}</div>}
    </div>
  );
}
