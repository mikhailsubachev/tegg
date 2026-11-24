// Slice Q3: the ungrouped wall (docs/contracts/v1-views.md §40.1 `WallGrid.tsx`, §41.3, §42.1; R224; board W1;
// D-2185): every result as its type's card in a wrapping grid (`grid.ts`: 220…300 px cards), in `rows` order, left to
// right, row by row. No lanes, no `+` tile, no card drag, no `Move to`; a Task card's `More actions` is R43's menu
// without `Move to` and `Also add to` (D-2220). Windowed against the page (or note) scroller with
// measured row heights (the visible rows ± 2, never more than 150 card elements); the container keeps the full height.
// Keyboard: one roving Tab stop, →/← reading order, ↓/↑ the same column, ⏎ opens, Back gives the card the focus again.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { applyTaskChange, completeTask } from '@tegg/doc';
import { t } from '../../i18n/catalog';
import { ipc } from '../../ipc/client';
import type { QueryEnvDto, QueryRowDto } from '../../ipc/queries';
import type { TaskDefsDto, TaskRowDto, TypeDto } from '../../ipc/types';
import type { CardSlotProps } from '../../board/Board';
import { ObjectCard, cardEnv } from '../../cards/ObjectCard';
import { CardMenu } from '../../tasks/CardMenu';
import { PopupMenu } from '../../shell/Menu';
import { ensureViewsLive } from '../../views/live';
import { queryAlert } from '../editorHost';
import { nowIso, queryEnv } from '../env';
import { queryNav } from '../nav';
import { GRID, gridNeighbour, gridOf, windowRows } from './grid';
import { registerBoardSnapshot } from './QueryBoard';
import { taskStatusChange, writeCardChange } from './write';

const nfc = (s: string) => s.normalize('NFC');
const MAX_CARDS = 150;
const OVERSCAN = 2;

/** The card a wall should focus when it shows again (Back after ⏎ on a card). */
let returnTo: { name: string | null; key: string } | null = null;

/** The nearest ancestor that scrolls vertically (the main pane), or null for the window. */
function verticalScroller(el: HTMLElement | null): HTMLElement | null {
  for (let p = el?.parentElement ?? null; p; p = p.parentElement) {
    const o = getComputedStyle(p).overflowY;
    if (o === 'auto' || o === 'scroll') return p;
  }
  return null;
}

export function WallGrid({ rows, title, name, types, readOnly, rerun, taskDefs, env: runEnv }: {
  /** The results in their order (narrowed by the toolbar's filters). */
  rows: QueryRowDto[];
  title: string;
  /** The saved query's name (the hook, Back); null for an inline fence. */
  name: string | null;
  types: TypeDto[];
  readOnly: string | null;
  rerun: () => void;
  taskDefs: TaskDefsDto | null;
  env?: QueryEnvDto | null;
}) {
  const root = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    const measure = () => setWidth(el.clientWidth);
    measure();
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    ro?.observe(el);
    return () => ro?.disconnect();
  }, []);
  const count = rows.length;
  const { columns, cardWidth } = gridOf(width || 952, count);
  const rowCount = Math.ceil(count / columns);

  // ---- measured row heights (an estimate until a row has been drawn).
  const heights = useRef<Map<number, number>>(new Map());
  const [, setTick] = useState(0);
  const estimate = () => {
    const m = [...heights.current.values()];
    return m.length ? m.reduce((a, b) => a + b, 0) / m.length : 140 + GRID.gap;
  };
  useEffect(() => { heights.current.clear(); }, [columns]);
  const rowHeights = Array.from({ length: rowCount }, (_, i) => heights.current.get(i) ?? estimate());

  // ---- the window: the rows near the viewport of the scroller.
  const [view, setView] = useState<{ offset: number; height: number }>({ offset: 0, height: typeof window === 'undefined' ? 900 : window.innerHeight });
  useEffect(() => {
    const scroller = verticalScroller(root.current);
    const target: HTMLElement | Window = scroller ?? window;
    let raf = 0;
    const read = () => {
      raf = 0;
      const el = root.current;
      if (!el) return;
      const top = el.getBoundingClientRect().top;
      const viewTop = scroller ? scroller.getBoundingClientRect().top : 0;
      const viewH = scroller ? scroller.clientHeight : window.innerHeight;
      setView((v) => (v.offset === viewTop - top && v.height === viewH ? v : { offset: viewTop - top, height: viewH }));
    };
    const on = () => { if (!raf) raf = requestAnimationFrame(read); };
    read();
    target.addEventListener('scroll', on, { passive: true });
    window.addEventListener('resize', on);
    return () => { target.removeEventListener('scroll', on); window.removeEventListener('resize', on); if (raf) cancelAnimationFrame(raf); };
  }, []);
  let [first, last] = windowRows(rowHeights, Math.max(0, view.offset), view.height, OVERSCAN);
  const maxRows = Math.max(1, Math.floor(MAX_CARDS / columns));
  if (last - first + 1 > maxRows) last = first + maxRows - 1;

  // ---- the roving focus.
  const [active, setActive] = useState<string | null>(() => {
    const r = returnTo;
    if (r && r.name === name) { returnTo = null; return r.key; }
    return null;
  });
  const [focusReq, setFocusReq] = useState<{ index: number; n: number } | null>(() => {
    if (!active) return null;
    const i = rows.findIndex((r) => nfc(r.path) === active);
    return i >= 0 ? { index: i, n: 1 } : null;
  });
  const activeIndex = Math.max(0, active ? rows.findIndex((r) => nfc(r.path) === active) : 0);
  const rowTop = (ri: number) => rowHeights.slice(0, ri).reduce((a, b) => a + b, 0);
  // A card outside the window: its row is brought into view first (then focused).
  if (focusReq) {
    const ri = Math.floor(focusReq.index / columns);
    if (ri < first || ri > last) {
      first = Math.max(0, ri - OVERSCAN);
      last = Math.min(rowCount - 1, Math.max(first, Math.min(ri + OVERSCAN, first + maxRows - 1)));
    }
  }
  useLayoutEffect(() => {
    // Rows drawn: measured heights (the gap included).
    const el = root.current;
    if (!el) return;
    let changed = false;
    for (const r of el.querySelectorAll<HTMLElement>('[data-wall-row]')) {
      const i = Number(r.getAttribute('data-wall-row'));
      const h = r.getBoundingClientRect().height + GRID.gap;
      if (Math.abs((heights.current.get(i) ?? 0) - h) > 0.5) { heights.current.set(i, h); changed = true; }
    }
    if (changed) setTick((n) => n + 1);
  });
  useLayoutEffect(() => {
    if (!focusReq) return;
    const key = rows[focusReq.index] ? nfc(rows[focusReq.index]!.path) : null;
    const el = key ? root.current?.querySelector<HTMLElement>(`article[data-board-card="${CSS.escape(key)}"]`) : null;
    if (!el) return;
    el.focus({ preventScroll: true });
    const r = el.getBoundingClientRect();
    const scroller = verticalScroller(root.current);
    const top = scroller ? scroller.getBoundingClientRect().top : 0;
    const h = scroller ? scroller.clientHeight : window.innerHeight;
    if (r.top < top || r.bottom > top + h) el.scrollIntoView({ block: 'nearest' });
    setFocusReq(null);
  }, [focusReq, first, last]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- the perf mark (D-1800, §42.5): `board-ready` two frames after the first cards painted.
  useEffect(() => {
    let a = 0, b = 0;
    a = requestAnimationFrame(() => { b = requestAnimationFrame(() => { void ipc.perfMark('board-ready').catch(() => {}); }); });
    return () => { cancelAnimationFrame(a); cancelAnimationFrame(b); };
  }, []);

  // ---- the test hook (§43.1): `board()` entries with `display`, `grouped`, `columns`, `cards`.
  const snap = useRef<() => unknown>(() => null);
  snap.current = () => ({ name, display: 'wall', grouped: false, columns, cards: rows.map((r) => nfc(r.path)), lanes: [],
    domCards: root.current?.querySelectorAll('article[data-board-card]').length ?? 0 });
  useEffect(() => { ensureViewsLive(); return registerBoardSnapshot(() => snap.current()); }, []);

  // ---- cards.
  const typeOf = (k: string) => types.find((x) => nfc(x.key) === nfc(k));
  const env = runEnv ?? queryEnv();
  const cEnv = { ...cardEnv(), ...(env.zone ? { zone: env.zone } : {}), ...(env.locale ? { region: env.locale } : {}) };
  const open = (path: string) => { returnTo = { name, key: nfc(path) }; queryNav()?.openNote(path); };
  const [menu, setMenu] = useState<{ row: QueryRowDto; anchor: HTMLElement } | null>(null);
  const taskNav = useMemo(() => ({
    openNote: (p: string) => open(p),
    openSource: (p: string, task: string) => queryNav()?.go({ id: 'note/<path>', param: nfc(p), selectEmbedOf: nfc(task) }),
    openDay: (d: string) => queryNav()?.go({ id: 'daily/YYYY-MM-DD', param: d }),
  }), [name]); // eslint-disable-line react-hooks/exhaustive-deps
  /** One write of a Task card's file (a toggle, R43's menu), then the run again. */
  const taskWrite = (row: QueryRowDto, change: (text: string) => string | null) => {
    if (!taskDefs || readOnly) return;
    void writeCardChange(row, (text) => { const a = change(text); return a === null ? null : { text: a, inlineKept: false }; })
      .then((r) => {
        if (r.outcome === 'conflict') queryAlert(t('board.changedOutside', { title: row.title }));
        else if (r.outcome === 'failed') queryAlert(t('query.saveFailed'));
        rerun();
      });
  };
  const toggle = (row: QueryRowDto, done: boolean) => {
    if (!taskDefs) return;
    taskWrite(row, (text) => completeTask(text, taskDefs as never, done, nowIso(Date.now())));
  };
  // D-2220: a Task card's `More actions` (R43) opens R43's menu, as on a grouped wall, without `Move to` / `Also add to`.
  const openMenu = (row: QueryRowDto, anchor: HTMLElement) => setMenu({ row, anchor });
  const taskRowOf = (row: QueryRowDto): TaskRowDto | null => (row.taskRow && taskDefs ? { ...row.taskRow, readOnly: row.readOnly || row.taskRow.readOnly || !!readOnly } : null);
  const keyDown = (i: number, row: QueryRowDto) => (e: React.KeyboardEvent<HTMLElement>) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === 'Enter') { e.preventDefault(); open(row.path); return; }
    if (e.key === 'F10' && e.shiftKey) { e.preventDefault(); openMenu(row, e.currentTarget); return; }
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft' || e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const j = gridNeighbour(i, e.key, columns, count);
      if (j === i) return;
      setActive(nfc(rows[j]!.path));
      setFocusReq((r) => ({ index: j, n: (r?.n ?? 0) + 1 }));
    }
  };

  const drawn: ReactElement[] = [];
  for (let ri = first; ri <= last && ri < rowCount; ri++) {
    const cards = rows.slice(ri * columns, ri * columns + columns);
    drawn.push(
      <div key={ri} className="wall-row" data-wall-row={ri} style={{ position: 'absolute', left: 0, right: 0, top: rowTop(ri), gap: GRID.gap }}>
        {cards.map((r, k) => {
          const i = ri * columns + k;
          const path = nfc(r.path);
          const slot = {
            tabIndex: i === activeIndex ? 0 : -1,
            onFocus: () => setActive(path),
            onKeyDown: keyDown(i, r),
            onMouseDown: () => {},
            onDragStart: (e: React.DragEvent) => e.preventDefault(),
            draggable: false as const,
            dragging: false,
            'data-wall-index': String(i),
            style: { width: cardWidth, flex: 'none' },
          } as unknown as CardSlotProps;
          const ty = typeOf(r.type);
          return (
            <ObjectCard key={path} path={r.path} surface="board" type={ty ?? null} typeName={ty?.name ?? r.type} env={cEnv}
              card={r.card ?? { type: r.type, title: r.title, keys: [], values: {}, excerpt: null, links: r.links, unreviewed: false, file: null }}
              task={r.taskRow && taskDefs ? { ...r.taskRow, readOnly: r.readOnly || r.taskRow.readOnly || !!readOnly } : null}
              nav={taskNav} onToggle={(done) => toggle(r, done)}
              hideKey={null} readOnly={r.readOnly} slot={slot}
              onOpen={(p) => open(p)}
              onMenu={(anchor) => openMenu(r, anchor)} />
          );
        })}
      </div>,
    );
  }
  const total = rowHeights.reduce((a, b) => a + b, 0);
  return (
    <div ref={root} role="group" aria-label={title} data-user-content="" data-wall="" data-grouped="false" data-columns={columns}
      data-board-name={name ?? undefined} className="wall-grid" style={{ position: 'relative', height: Math.max(0, total - GRID.gap) }}>
      {drawn}
      {menu && taskRowOf(menu.row) && taskDefs && (() => {
        const row = menu.row;
        const path = nfc(row.path);
        return (
          <CardMenu target={{ row: taskRowOf(row)!, anchor: menu.anchor, opener: menu.anchor.closest('article') }} defs={taskDefs}
            onClose={() => setMenu(null)}
            actions={{
              open: () => open(path),
              status: (_r, label) => taskWrite(row, taskStatusChange(taskDefs, row, label, nowIso(Date.now()))),
              priority: (_r, label) => taskWrite(row, (text) => applyTaskChange(text, { kind: 'priority', to: label })?.text ?? null),
              due: (_r, date) => taskWrite(row, (text) => applyTaskChange(text, { kind: 'due', to: date })?.text ?? null),
            }} />
        );
      })()}
      {menu && !taskRowOf(menu.row) && (
        <PopupMenu label={t('task.more', { title: menu.row.title })} anchor={menu.anchor} fit popupId="card.menu" onClose={() => setMenu(null)}
          entries={[{ kind: 'item', key: 'open', label: t('pinned.open'), content: <span className="menu-title">{t('pinned.open')}</span>, onChoose: () => { const p = menu.row.path; setMenu(null); open(p); } }]} />
      )}
    </div>
  );
}
