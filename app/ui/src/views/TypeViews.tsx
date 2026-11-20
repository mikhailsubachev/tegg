// Slice Q2: the type page's views (docs/contracts/v1-views.md §4.2 `TypeViews.tsx`, §4.3, §4.4, §4.7, §2.1; R184, R186,
// R190, R191; boards Views A, B, E, ViewsApp; D-1762…D-1765, D-1781, D-1787…D-1790, D-1796, D-1803, D-1809). The `Views`
// tablist (`All <plural>` first, a tab per `views:` name), `Add view` (New view › Table / List / Board as a draft with the
// editor; Show a saved query), tab drags and `Move view left / right`, the view menu (chevron, right-click, ⇧F10, the
// toolbar's `⋯`), rename / duplicate / remove / trash, the remembered tab (machine-local, no history entry) and the
// per-tab filter text. Each tab change is one `type_patch` of the `views` line, refused on an outside change.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { usePopupPlacement } from '../shell/usePopupPlacement';
import { t } from '../i18n/catalog';
import { errorKind, ipc } from '../ipc/client';
import type { QueryDefDto, QueryResultDto, QuerySummaryDto } from '../ipc/queries';
import type { TypeDto, TypeOpDto } from '../ipc/types';
import { Icon } from '../shell/Icon';
import { PopupMenu, type MenuEntry } from '../shell/Menu';
import { openQueryEditor, queryAlert } from '../queries/editorHost';
import { announceView, ensureViewsLive } from './live';
import { nowIso } from '../queries/env';
import { queryNav } from '../queries/nav';
import { renameQuery } from '../queries/QueryMenu';
import { trashView } from './trashView';
import type { TypePatch } from './useUsageWrite';
import { refreshQueries, useQueries } from '../queries/store';
import { defaultGroupBy, hasViews, nameKey, newViewDef, savedOffers, viewTabs, viewsAfterDrop, viewsAfterInsert, viewsAfterMove, viewsAfterRemove, type OfferReason } from './model';
import { lastTab, setLastTab } from './uiState';
import { lastFocused, useViewsHandler } from './actions';
import { ViewPanel, type PanelApi, type TabFilter, type ViewState } from './ViewPanel';
import './views.css';

const nfc = (s: string) => s.normalize('NFC');
const DRAFT = '\u0000draft';
const EMPTY: TabFilter = { text: '', tags: [] };

export { hasViews };

export type AllTab = { toolbar: ReactNode; body: ReactNode };

export function TypeViews({ typeKey, type, types, plural, all }: {
  typeKey: string;
  type: TypeDto;
  types: TypeDto[];
  plural: string;
  /** `All <plural>`: the type page's own toolbar and table (FR-TYP-09, type-columns, unchanged). */
  all: AllTab;
}) {
  const summaries = useQueries();
  useEffect(() => { ensureViewsLive(); }, []);
  useEffect(() => { void refreshQueries(); }, []);
  // The type as the last `views` write returned it, until the types store brings the file again.
  const [local, setLocal] = useState<TypeDto | null>(null);
  useEffect(() => { setLocal(null); }, [type]);
  const cur = local ?? type;
  const tabs = viewTabs(cur, summaries ?? []);
  const names = cur.views ?? [];
  const writable = cur.state === 'ok' && !cur.viewsUnreadable;
  const reason = cur.viewsUnreadable ? t('views.unreadableSetting', { file: `.tegg/types/${cur.key}.yml` })
    : cur.state === 'newer' ? t('ts.newer') : cur.state !== 'ok' ? t('typePage.columnsInvalid') : null;

  // ---- the selected tab (D-1765, D-1790): the remembered one when it is still listed; a switch adds no history entry.
  const [selected, setSelected] = useState<string | null>(() => lastTab(typeKey));
  const [draft, setDraft] = useState<{ kind: 'table' | 'list' | 'board'; def: QueryDefDto } | null>(null);
  const [live, setLive] = useState<QueryResultDto | null>(null);
  const shownName = selected === DRAFT ? (draft ? DRAFT : null) : selected !== null && tabs.some((x) => x.key === nameKey(selected)) ? tabs.find((x) => x.key === nameKey(selected))!.name : null;
  const select = (name: string | null) => {
    setSelected(name);
    if (name !== DRAFT) setLastTab(typeKey, name);
    const s = name ? tabs.find((x) => x.key === nameKey(name))?.summary : null;
    if (s?.view === 'board') void ipc.perfMark('board-request').catch(() => {});
  };
  // A remembered board tab opened with the page asks for its board too (D-1800).
  const opened = useRef(false);
  useEffect(() => {
    if (opened.current || !summaries || !shownName || shownName === DRAFT) return;
    opened.current = true;
    if (tabs.find((x) => x.name === shownName)?.summary?.view === 'board') void ipc.perfMark('board-request').catch(() => {});
  }, [summaries, shownName]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- per-tab state: the filter text and tags (D-1796) and the run state shown on the tab.
  const [filters, setFilters] = useState<Record<string, TabFilter>>({});
  const [states, setStates] = useState<Record<string, ViewState>>({});
  const panel = useRef<PanelApi | null>(null);
  const [slot, setSlot] = useState<HTMLDivElement | null>(null);
  const tablist = useRef<HTMLDivElement | null>(null);
  const addBtn = useRef<HTMLButtonElement | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [menu, setMenu] = useState<{ name: string; anchor: HTMLElement; toolbar: boolean; at?: { x: number; y: number } } | null>(null);
  const undoNew = useRef<{ name: string; before: string[]; version: unknown } | null>(null);

  // ---- one `views` write (D-1803): queued, each based on the version the last one wrote; refused on an outside change.
  const queue = useRef<Promise<void>>(Promise.resolve());
  const disk = useRef<TypeDto | null>(null);
  useEffect(() => { disk.current = null; }, [type]);
  /** Reloads the type file from disk (a refusal: the tabs show what the file holds). */
  const reload = () => {
    disk.current = null;
    void ipc.typeGet(cur.key).then((x) => { if (x) setLocal(x); }, () => {});
  };
  /** Slice Q2.1: one `type_patch` in the page's queue, based on `base` (else the version the last write returned).
   *  On a refusal the type as on disk is shown and the error is passed on (the caller says what failed). */
  const patchType: TypePatch = (ops, base) => {
    const p = queue.current.then(async () => {
      const on = base ?? disk.current ?? cur;
      try {
        const r = await ipc.typePatch(on.key, on.exists ? on.version : null, ops);
        disk.current = r;
        setLocal(r);
        return r;
      } catch (e) {
        const x = e as { kind?: string; disk?: TypeDto };
        disk.current = null;
        if (x.kind === 'Conflict' && x.disk) setLocal(x.disk); else if (x.kind === 'Conflict' || x.kind === 'Rule') reload();
        throw e;
      }
    });
    queue.current = p.then(() => undefined, () => undefined);
    return p;
  };
  /** A tab's sort or columns (R197): refusals alert as the views do (FR-SYN-03 AC-31). */
  const usagePatch: TypePatch = (ops, base) => patchType(ops, base).catch((e) => {
    const k = errorKind(e);
    queryAlert(k === 'Conflict' || k === 'Rule' || k === 'Gone' || k === 'NewerVersion' ? t('views.changedOutside', { plural }) : t('query.saveFailed'));
    throw e;
  });
  const writeViews = (next: string[], o: { afterCreate?: boolean; select?: string | null; announce?: string } = {}): Promise<boolean> => {
    const base = disk.current ?? cur;
    if (!(base.state === 'ok' && !base.viewsUnreadable)) return Promise.resolve(false);
    const before = base.views ?? [];
    setLocal({ ...base, views: next });
    if (o.select !== undefined) select(o.select);
    return patchType([{ op: 'views', names: next.map(nfc) }]).then(() => {
      if (o.announce) announceView(o.announce);
      return true;
    }, (e) => {
      const x = e as { kind?: string; disk?: TypeDto };
      if (!(x.kind === 'Conflict' && x.disk)) setLocal({ ...base, views: before });
      if (o.select !== undefined) setSelected((s) => (s === o.select ? (o.afterCreate ? null : s) : s));
      queryAlert(t(o.afterCreate ? 'views.addFailed' : 'views.changedOutside', { plural }));
      return false;
    });
  };

  // ---- actions
  const viewName = () => (shownName && shownName !== DRAFT ? shownName : null);
  const trash = (tabName: string, queryName: string, title: string) => {
    if (!writable) return;
    const i = tabs.findIndex((x) => x.key === nameKey(tabName));
    const shownKey = shownName ? nameKey(shownName) : null;
    const previous = shownKey === nameKey(tabName) ? (i > 0 ? tabs[i - 1].name : null) : shownName;
    void trashView(disk.current ?? cur, queryName, title, {
      patch: patchType, plural, previous,
      select: (n) => select(n),
      reload,
    });
  };
  const remove = (name: string) => {
    if (!writable) return;
    const next = viewsAfterRemove(names, name);
    if (!next) return;
    const i = tabs.findIndex((x) => x.key === nameKey(name));
    const shownKey = shownName ? nameKey(shownName) : null;
    const sel = shownKey === nameKey(name) ? (i > 0 ? tabs[i - 1].name : null) : undefined;
    void writeViews(next, { select: sel });
  };
  const moveBy = (delta: number) => {
    const n = viewName();
    if (!n || !writable) return;
    const next = viewsAfterMove(names, n, delta);
    if (next) void writeViews(next, { announce: t('views.moved', { name: n }) });
  };
  const duplicate = async (name: string) => {
    let q;
    try { q = await ipc.queryDuplicate(name, nowIso(Date.now())); } catch (e) { queryAlert(errorKind(e) === 'NewerVersion' ? t('query.block.readOnly') : t('query.saveFailed')); return; }
    void refreshQueries();
    const next = viewsAfterInsert(names, q.name, name);
    if (!next) return;
    // D-1843, D-1863: the copy gets the tab's own sort and columns in the same write (widths aren't copied).
    const item = (cur.viewItems ?? []).find((x) => nameKey(x.name) === nameKey(name)) ?? null;
    const extra: TypeOpDto[] = [];
    if (item?.sort && !item.sortBroken) extra.push({ op: 'viewSort', name: nfc(q.name), sort: item.sort });
    if (item?.columns && !item.columnsBroken) extra.push({ op: 'viewColumns', name: nfc(q.name), columns: item.columns.map(nfc) });
    if (!extra.length) { void writeViews(next, { afterCreate: true, select: q.name }); return; }
    const base = disk.current ?? cur;
    if (!(base.state === 'ok' && !base.viewsUnreadable)) return;
    setLocal({ ...base, views: next });
    select(q.name);
    void patchType([{ op: 'views', names: next.map(nfc) }, ...extra]).catch(() => {
      setLocal(null);
      setSelected((s) => (s === q.name ? null : s));
      queryAlert(t('views.addFailed', { plural }));
    });
  };
  const showSaved = (s: QuerySummaryDto) => {
    if (!writable) return;
    const next = viewsAfterInsert(names, s.name, null);
    if (next) void writeViews(next, { select: s.name });
  };
  const newView = (kind: 'table' | 'list' | 'board') => {
    if (!writable) return;
    const def = newViewDef(cur, kind, types);
    setDraft({ kind, def });
    setLive(null);
    setSelected(DRAFT);
    setTimeout(() => {
      openQueryEditor({
        name: null, host: null, anchor: tablist.current, returnFocus: tablist.current?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]') ?? null,
        selectTitle: true, def, viewDraft: true, fixedType: { key: cur.key, plural },
        onResult: (r) => setLive(r),
        onDraftCommit: async (title, d) => {
          const q = await ipc.queryCreate(title, d, null, true, nowIso(Date.now()));
          void refreshQueries();
          const before = disk.current?.views ?? cur.views ?? [];
          const next = viewsAfterInsert(before, q.name, null);
          setDraft(null);
          setLive(null);
          if (next) {
            const ok = await writeViews(next, { afterCreate: true, select: q.name });
            if (ok) undoNew.current = { name: q.name, before: [...before], version: null };
          }
        },
        onDraftDrop: () => { setDraft(null); setLive(null); setSelected((s) => (s === DRAFT ? lastTab(typeKey) : s)); },
        onClosed: () => setLive(null),
      });
    }, 0);
  };
  const editView = (anchor: HTMLElement | null) => {
    const n = viewName();
    if (!n) return;
    openQueryEditor({
      name: n, host: null, anchor: anchor ?? tablist.current, returnFocus: anchor ?? tablist.current,
      fixedType: { key: cur.key, plural },
      usage: panel.current?.editorUsage() ?? null,
      onResult: (r) => setLive(r),
      onCommitted: () => { panel.current?.rerun(); },
      onClosed: () => setLive(null),
    });
  };
  // ⌘Z right after New view, while its tab has the focus (D-1809): the views line back, then the query to the trash.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const u = undoNew.current;
      if (!u || !(e.metaKey && !e.shiftKey && e.key.toLowerCase() === 'z')) return;
      const a = document.activeElement as HTMLElement | null;
      if (!a || nfc(a.getAttribute('data-view-tab') ?? '') !== nfc(u.name)) return;
      e.preventDefault();
      e.stopPropagation();
      undoNew.current = null;
      void writeViews(u.before, { select: null }).then((ok) => { if (ok) void ipc.queryTrash(u.name).then(() => refreshQueries(), () => {}); });
    };
    const drop = (e: FocusEvent) => { const u = undoNew.current; if (u && nfc((e.target as HTMLElement | null)?.getAttribute?.('data-view-tab') ?? '') !== nfc(u.name)) undoNew.current = null; };
    window.addEventListener('keydown', onKey, true);
    document.addEventListener('focusin', drop);
    return () => { window.removeEventListener('keydown', onKey, true); document.removeEventListener('focusin', drop); };
  }); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- the tab list as shown: All, the views, the draft.
  type TabItem = { name: string; label: string; kind: 'table' | 'list' | 'board' | null; summary: QuerySummaryDto | null; draft: boolean };
  const items: TabItem[] = [
    ...tabs.map((x) => ({ name: x.name, label: x.name, kind: x.summary?.view ?? null, summary: x.summary, draft: false })),
    ...(draft ? [{ name: DRAFT, label: t('views.newName'), kind: draft.kind, summary: null, draft: true }] : []),
  ];
  const order = [null, ...items.map((x) => x.name)];
  const tabId = (name: string | null) => (name === null ? 'view-tab-all' : `view-tab-${[...nfc(name)].map((c) => c.codePointAt(0)!.toString(36)).join('-')}`);
  const focusTab = (name: string | null) => requestAnimationFrame(() => document.getElementById(tabId(name))?.focus());
  const step = (dir: 1 | -1, focus = false) => {
    const i = order.indexOf(shownName);
    const j = i + dir;
    if (j < 0 || j >= order.length) return;
    select(order[j]);
    if (focus) focusTab(order[j]);
  };

  // ---- tab drag (§4.4): > 4 px moves; a drop indicator; a drop before All lands after it; Esc writes nothing.
  const [tabDrag, setTabDrag] = useState<{ name: string; before: string | null | undefined } | null>(null);
  const startTabDrag = (name: string) => (e: React.MouseEvent<HTMLElement>) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest('[data-view-chevron]')) return;
    const x0 = e.clientX, y0 = e.clientY;
    let started = false;
    let cancelled = false;
    const beforeAt = (x: number, y: number): string | null | undefined => {
      const tabEl = (document.elementFromPoint(x, y) as HTMLElement | null)?.closest<HTMLElement>('[role="tab"]');
      if (!tabEl || !tablist.current?.contains(tabEl)) return undefined;
      const over = tabEl.getAttribute('data-view-tab') ?? '';
      const views = items.filter((it) => !it.draft).map((it) => it.name);
      if (over === '') return views[0] ?? null; // before All lands after it
      const r = tabEl.getBoundingClientRect();
      if (x < r.left + r.width / 2) return views.find((v) => nfc(v) === nfc(over)) ?? null;
      const i = views.findIndex((v) => nfc(v) === nfc(over));
      return views[i + 1] ?? null;
    };
    const esc = (k: KeyboardEvent) => { if (k.key === 'Escape' && started) { k.preventDefault(); k.stopPropagation(); cancelled = true; setTabDrag(null); } };
    const move = (m: MouseEvent) => {
      if (cancelled) return;
      if (!started && Math.abs(m.clientX - x0) + Math.abs(m.clientY - y0) <= 4) return;
      m.preventDefault();
      started = true;
      setTabDrag({ name, before: beforeAt(m.clientX, m.clientY) });
    };
    const up = (u: MouseEvent) => {
      window.removeEventListener('mousemove', move, true);
      window.removeEventListener('mouseup', up, true);
      window.removeEventListener('keydown', esc, true);
      setTabDrag(null);
      if (!started || cancelled) return;
      const swallow = (c: MouseEvent) => { c.stopPropagation(); c.preventDefault(); window.removeEventListener('click', swallow, true); };
      window.addEventListener('click', swallow, true);
      setTimeout(() => window.removeEventListener('click', swallow, true), 0);
      const before = beforeAt(u.clientX, u.clientY);
      if (before === undefined || !writable) return;
      const next = viewsAfterDrop(names, name, before);
      if (next) void writeViews(next, { announce: t('views.moved', { name }) });
    };
    window.addEventListener('mousemove', move, true);
    window.addEventListener('mouseup', up, true);
    window.addEventListener('keydown', esc, true);
  };

  // ---- the palette (§4.7).
  useViewsHandler(true, {
    status: () => {
      const v = viewName();
      const ro = v ? panel.current?.readOnly() ?? null : null;
      const b = v ? panel.current?.board() ?? null : null;
      return { typeKey: cur.key, tab: v, writable, viewWritable: !!v && !ro && !!panel.current?.def(), board: b ? b.status() : null, sortable: !!v && !!panel.current?.def(),
        usage: v ? panel.current?.usage() ?? null : null };
    },
    run: (id) => {
      switch (id) {
        case 'views.new': if (writable) { setAddOpen(true); } return;
        case 'views.edit': editView(null); return;
        case 'views.next': step(1); return;
        case 'views.previous': step(-1); return;
        case 'views.moveLeft': moveBy(-1); return;
        case 'views.moveRight': moveBy(1); return;
        case 'sort.addLevel': panel.current?.openSort(true); return;
        case 'sort.useQuery': panel.current?.useQuery('sort'); return;
        case 'columns.useQuery': panel.current?.useQuery('columns'); return;
        default: panel.current?.board()?.run(id);
      }
    },
  });
  void lastFocused;

  // ---- the menus.
  const viewMenuEntries = (name: string, toolbar: boolean): MenuEntry[] => {
    const summary = tabs.find((x) => x.key === nameKey(name))?.summary ?? null;
    const item = (key: string, label: string, run: () => void, o: { description?: string; disabled?: boolean } = {}): MenuEntry =>
      ({ kind: 'item', key, label, content: <span className="menu-title">{label}</span>, description: o.description, disabled: o.disabled, onChoose: () => { setMenu(null); run(); } });
    const def = panel.current?.def() ?? null;
    const isSel = shownName !== null && nameKey(shownName) === nameKey(name);
    return [
      item('edit', t('views.edit'), () => { if (!isSel) select(name); setTimeout(() => editView(menu?.anchor ?? null), 0); }),
      item('rename', t('views.rename'), () => renameQuery({ name: summary?.name ?? name, title: summary?.title ?? name, state: summary?.state ?? 'ok' }, menu?.anchor ?? null,
        (to) => { setSelected((s) => (s !== null && nameKey(s) === nameKey(name) ? nfc(to) : s)); })),
      item('duplicate', t('views.duplicate'), () => { void duplicate(summary?.name ?? name); }, { disabled: summary?.state === 'newer' }),
      item('open', t('views.openAsQuery'), () => queryNav()?.openQuery(summary?.name ?? name), { description: t('views.openAsQueryHint') }),
      { kind: 'separator' },
      item('remove', t('views.remove', { plural }), () => remove(name), { description: writable ? t('views.removeHint') : reason ?? undefined, disabled: !writable }),
      // Slice Q2.1 (§15; D-1835): the tab goes too, in one Undo with the move.
      item('trash', t('views.trash'), () => { trash(name, summary?.name ?? name, summary?.title ?? name); }, { description: writable ? undefined : reason ?? undefined, disabled: !writable }),
      ...(toolbar && isSel && def?.view === 'board' && def.laneOrder !== null
        ? [item('reset', t('board.resetOrder'), () => panel.current?.board()?.run('board.resetLaneOrder'))] : []),
    ];
  };

  const offers = savedOffers(typeKey, summaries ?? [], tabs);
  const reasonText = (r: OfferReason, s: QuerySummaryDto) => {
    const other = s.types?.[0] ?? '';
    return r === 'otherType' ? t('views.reason.otherType', { type: types.find((x) => nfc(x.key) === nfc(other))?.name ?? other, thisType: cur.name })
      : r === 'severalTypes' ? t('views.reason.severalTypes', { thisType: cur.name })
        : r === 'allTypes' ? t('views.reason.allTypes', { thisType: cur.name })
          : r === 'needsNote' ? t('views.reason.needsNote') : t('views.reason.unreadable');
  };
  const groupName = (() => { const k = defaultGroupBy(cur); return k === 'tags' ? t('attr.tags') : cur.attributes.find((a) => nfc(a.key) === k)?.name ?? k; })();

  const selectedItem = shownName === null ? null : items.find((it) => it.name === shownName) ?? null;
  return (
    <>
      <div className="view-bar">
        <aside className="view-tabs-wrap">
          <div ref={tablist} role="tablist" aria-label={t('typePage.views')} className="view-tabs" data-views-tablist=""
            onKeyDown={(e) => {
              if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
                if (!(e.target as HTMLElement).matches('[role="tab"]')) return;
                e.preventDefault();
                step(e.key === 'ArrowRight' ? 1 : -1, true);
              }
            }}>
            <div role="tab" id={tabId(null)} data-command="views.next" data-view-tab="" data-view-kind="table" aria-selected={shownName === null} tabIndex={shownName === null ? 0 : -1}
              aria-posinset={1} aria-setsize={items.length + 1} aria-controls={shownName === null ? 'view-panel' : undefined}
              className={`view-tab${shownName === null ? ' on' : ''}${tabDrag && tabDrag.before === (items[0]?.name ?? null) && tabDrag.name !== items[0]?.name ? '' : ''}`}
              onClick={() => { if (shownName !== null) select(null); }}
              onContextMenu={(e) => e.preventDefault()}>
              <span data-icon="table" className="view-tab-icon" aria-hidden="true"><Icon name="table" size={14} /></span>
              <span>{t('views.all', { plural: '\u0000' }).split('\u0000')[0]}<span data-user-content>{plural}</span>{t('views.all', { plural: '\u0000' }).split('\u0000')[1]}</span>
            </div>
            {items.map((it, i) => {
              const on = shownName === it.name;
              const st = it.draft ? 'draft' : states[it.name];
              const dropBefore = tabDrag && tabDrag.name !== it.name && tabDrag.before !== undefined && tabDrag.before !== null && nfc(tabDrag.before) === nfc(it.name);
              const dropAfter = tabDrag && tabDrag.before === null && i === items.length - 1 && tabDrag.name !== it.name;
              return (
                <div key={it.name} role="tab" id={tabId(it.name)} data-command="views.next" data-view-tab={it.draft ? t('views.newName') : nfc(it.name)} data-view-kind={it.kind ?? undefined}
                  data-view-state={st && (on || it.draft || st === 'trashed' || st === 'missing') ? st : undefined} aria-selected={on} aria-haspopup={it.draft ? undefined : 'menu'}
                  aria-posinset={i + 2} aria-setsize={items.length + 1} tabIndex={on ? 0 : -1}
                  className={`view-tab${on ? ' on' : ''}${tabDrag?.name === it.name ? ' dragging' : ''}${dropBefore ? ' drop-before' : ''}${dropAfter ? ' drop-after' : ''}`}
                  onMouseDown={it.draft ? undefined : startTabDrag(it.name)}
                  onClick={() => { if (!on) select(it.name); }}
                  onContextMenu={(e) => { e.preventDefault(); if (!it.draft) setMenu({ name: it.name, anchor: e.currentTarget, toolbar: false, at: { x: e.clientX, y: e.clientY } }); }}
                  onKeyDown={(e) => {
                    if (e.key === 'F10' && e.shiftKey && !it.draft) { e.preventDefault(); e.stopPropagation(); setMenu({ name: it.name, anchor: e.currentTarget, toolbar: false }); }
                  }}>
                  <span data-icon={it.kind ?? 'table'} className="view-tab-icon" aria-hidden="true"><Icon name={it.kind ?? 'table'} size={14} /></span>
                  <span data-user-content={it.draft ? undefined : ''}>{it.label}</span>
                  {on && !it.draft && (
                    <span className="view-chevron" data-view-chevron="" aria-hidden="true"
                      onMouseDown={(e) => e.stopPropagation()}
                      onClick={(e) => { e.stopPropagation(); setMenu({ name: it.name, anchor: e.currentTarget.parentElement as HTMLElement, toolbar: false }); }}>
                      <Icon name="chevron-down" size={11} />
                    </span>
                  )}
                </div>
              );
            })}
          </div>
          <button ref={addBtn} type="button" tabIndex={0} className="icon-button view-add" aria-label={t('views.add')} title={t('views.add')} aria-haspopup="menu" aria-expanded={addOpen}
            data-command="views.new" aria-disabled={writable ? undefined : 'true'} aria-description={writable ? undefined : reason ?? undefined}
            onClick={() => { if (writable) setAddOpen((o) => !o); }}>
            <Icon name="plus" size={14} />
          </button>
        </aside>
        <div className="view-toolbar-slot" ref={setSlot}>{shownName === null && all.toolbar}</div>
      </div>
      {shownName === null ? (
        <div role="tabpanel" id="view-panel" aria-labelledby={tabId(null)} data-view-panel="" className="view-panel">{all.body}</div>
      ) : selectedItem && (
        <ViewPanel key={selectedItem.name} name={selectedItem.draft ? t('views.newName') : selectedItem.name} typeKey={typeKey} type={cur} types={types} plural={plural} slot={slot}
          filter={filters[selectedItem.name] ?? EMPTY} onFilter={(f) => setFilters((m) => ({ ...m, [selectedItem.name]: f }))}
          onState={(s) => setStates((m) => (m[selectedItem.name] === s ? m : { ...m, [selectedItem.name]: s }))}
          onMenu={(anchor) => setMenu({ name: selectedItem.name, anchor, toolbar: true })}
          onRemove={() => remove(selectedItem.name)} apiRef={panel} live={live} draft={selectedItem.draft} labelledBy={tabId(selectedItem.name)}
          patch={usagePatch} />
      )}
      {addOpen && (
        <AddViewMenu anchor={addBtn.current} boardBy={t('views.kind.boardBy', { attribute: groupName })}
          offers={offers} reasonText={reasonText}
          onKind={(k) => { setAddOpen(false); newView(k); }}
          onSaved={(s) => { setAddOpen(false); showSaved(s); }}
          onClose={() => { setAddOpen(false); addBtn.current?.focus(); }} />
      )}
      {menu && (
        <PopupMenu label={t('views.menu')} anchor={menu.anchor} disabledFocusable entries={viewMenuEntries(menu.name, menu.toolbar)}
          onClose={() => setMenu(null)} fit popupId={menu.toolbar ? 'views.menu' : 'views.tabMenu'}
          openerKind={menu.at ? 'context' : 'menu'} at={menu.at ?? null} />
      )}
    </>
  );
}

/** `Add view` (board B, §4.3): group `New view` (Table, List, Board `by <attribute>`), a separator, group `Show a saved
 *  query` (enabled first by title, then greyed with their reasons). Arrow keys move over every item; ⏎ / a click
 *  chooses; a greyed item does nothing; Esc or a click outside closes it. */
function AddViewMenu({ anchor, boardBy, offers, reasonText, onKind, onSaved, onClose }: {
  anchor: HTMLElement | null; boardBy: string;
  offers: ReturnType<typeof savedOffers>; reasonText: (r: OfferReason, s: QuerySummaryDto) => string;
  onKind: (k: 'table' | 'list' | 'board') => void; onSaved: (s: QuerySummaryDto) => void; onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  // Slice Q2.1 (§20): placed inside the window, in a body portal.
  const style = usePopupPlacement(ref, anchor, 'menu');
  const items = () => [...(ref.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
  useEffect(() => {
    items()[0]?.focus();
    const outside = (e: MouseEvent) => { const tg = e.target as Node; if (ref.current?.contains(tg) || anchor?.contains(tg)) return; onClose(); };
    document.addEventListener('mousedown', outside, true);
    return () => document.removeEventListener('mousedown', outside, true);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const item = (key: string, name: string, label: React.ReactNode, choose: (() => void) | null, o: { description?: string; query?: string; user?: boolean } = {}) => {
    const el = (
      <div key={key} role="menuitem" tabIndex={-1} className="menu-item" aria-label={name} aria-disabled={choose ? undefined : 'true'} aria-description={o.description}
        data-query={o.query} data-user-content={o.user ? '' : undefined}
        onClick={() => choose?.()} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose?.(); } }}>
        {label}
      </div>
    );
    return el;
  };
  return createPortal(
    <div ref={ref} role="menu" aria-label={t('views.addMenu')} className="popup-menu view-add-menu" style={style} data-popup="views.addMenu"
      onKeyDown={(e) => {
        const list = items();
        const i = list.indexOf(document.activeElement as HTMLElement);
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          if (list.length) list[e.key === 'ArrowDown' ? (i + 1) % list.length : (i - 1 + list.length) % list.length].focus();
        } else if (e.key === 'Home' || e.key === 'End') { e.preventDefault(); list[e.key === 'Home' ? 0 : list.length - 1]?.focus(); }
        else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); }
        else if (e.key === 'Tab') e.preventDefault();
      }}>
      <div role="group" aria-label={t('views.newGroup')}>
        <div className="menu-group-head" aria-hidden="true">{t('views.newGroup')}</div>
        {item('table', t('views.kind.table'), <><Icon name="table" size={14} /><span className="menu-title">{t('views.kind.table')}</span></>, () => onKind('table'))}
        {item('list', t('views.kind.list'), <><Icon name="list" size={14} /><span className="menu-title">{t('views.kind.list')}</span></>, () => onKind('list'))}
        {item('board', t('views.kind.board'), <><Icon name="board" size={14} /><span className="menu-title">{t('views.kind.board')}</span><span className="menu-hint" aria-hidden="true">{boardBy}</span></>, () => onKind('board'), { description: boardBy })}
      </div>
      <div role="separator" className="menu-sep" />
      <div role="group" aria-label={t('views.savedGroup')}>
        <div className="menu-group-head" aria-hidden="true">{t('views.savedGroup')}</div>
        {offers.enabled.map((s) => item(`q:${s.name}`, s.title || s.name, <><Icon name={s.view ?? 'table'} size={14} /><span className="menu-title">{s.title || s.name}</span></>, () => onSaved(s), { query: nfc(s.name), user: true }))}
        {offers.greyed.map(({ summary: s, reason }) => item(`g:${s.name}`, s.state === 'unreadable' ? s.name : s.title || s.name, <><Icon name={s.view ?? 'table'} size={14} /><span className="menu-title">{s.state === 'unreadable' ? s.name : s.title || s.name}</span><span className="menu-hint" aria-hidden="true">{reasonText(reason, s)}</span></>,
          null, { description: reasonText(reason, s), query: nfc(s.name), user: true }))}
      </div>
    </div>,
    document.body,
  );
}
