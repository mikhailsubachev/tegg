// The generic board (docs/contracts/v1-views.md §4.2 `board/Board.tsx`, §4.3, §4.4; R187; boards Views D1, D2): lanes
// as columns (vertical) or rows (horizontal), a pointer drag of cards (Alt adds only) and of lanes, folds of horizontal
// rows, sideways scroll of vertical lanes inside the board, lane virtualisation (at most 150 card elements in the DOM,
// NFR-PERF-07 AC-3), the drop label and the keyboard focus moves of R191 (D-1789). No data access: the caller says what
// the lanes hold and what a drop does. Kept apart from the Tasks Kanban (plan §6); a later slice moves it onto this.
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { t } from '../i18n/catalog';
import { Icon } from '../shell/Icon';
import { isPhone } from '../phone/layout';
import './board.css';

export type BoardLaneView = {
  id: string;
  kind: string;
  /** The shown name (an option label, a tag, a title, `No <attribute>`). */
  label: string;
  /** The label is the user's text (not a catalog string). */
  userLabel: boolean;
  /** A Select option's colour name (the heading uses `var(--type-<colour>)`). */
  color: string | null;
  /** The cards' keys (paths) in order, as shown (after the toolbar's filters). */
  cards: string[];
  excluded: boolean;
  /** The excluded text (`Not in this view`, or the long form for rows). */
  excludedText: string;
  dropTarget: boolean;
  /** The lane can be dragged (not `none`). */
  grip: boolean;
  /** `New <Type> in <lane>`; null: no new control. */
  newLabel: string | null;
  /** Q2-T (§28.2): the `period:week` lane's day groups (`id` = `day:<date>`, the drop and keyboard target). */
  days?: { id: string; date: string; label: string; cards: string[]; dropTarget: boolean; countLabel?: string }[];
  /** Q2-T: the hint under the heading (`p.lane-hint`: the done lane's window). */
  hint?: string;
  /** Q2-T: the heading's tone (`data-tone`). */
  tone?: 'danger' | 'muted' | null;
  /** Q2-T: the count part of the lane's accessible name (`board.laneCountOf`); `board.laneCount` by default. */
  countLabel?: string;
};

export type CardSlotProps = {
  tabIndex: number;
  'data-lane': string;
  onFocus: (e?: React.FocusEvent<HTMLElement>) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLElement>) => void;
  onMouseDown: (e: React.MouseEvent<HTMLElement>) => void;
  onDragStart: (e: React.DragEvent) => void;
  draggable: false;
  dragging: boolean;
  /** Slice AND-2: the phone's tap on a card. */
  onClick?: (e: React.MouseEvent<HTMLElement>) => void;
};

export type BoardProps = {
  /** Slice Q3 (v1-views §42.1): a grouped wall (`data-wall`, `data-grouped="true"`). */
  wall?: boolean;
  label: string;
  name: string | null;
  groupBy: string;
  lanes: 'vertical' | 'horizontal';
  data: BoardLaneView[];
  folded: readonly string[];
  /** A chevron: one row, or (⌥) every row. */
  onFold: (laneId: string, every: boolean) => void;
  renderCard: (key: string, laneId: string, slot: CardSlotProps) => ReactNode;
  canDragCard: (key: string) => boolean;
  /** The drop label over `to`, or null when `to` isn't a target for this card. */
  dropLabel: (key: string, from: string, to: string, alt: boolean) => string | null;
  onCardDrop: (key: string, from: string, to: string, alt: boolean) => void;
  onLaneDrop: (laneId: string, before: string | null) => void;
  onNew: (laneId: string) => void;
  onOpen: (key: string) => void;
  /** The text of the dashed tile of a horizontal row (`New Book`). */
  newTile: string;
  /** Write controls refused (a read-only view): the reason. */
  readOnly: string | null;
  /** Called when a card element is focused or blurred (the palette's card commands). */
  onCardFocus?: (key: string | null, laneId: string | null) => void;
  /** The card to focus once it is in the DOM (Back to the board, a moved card). */
  focusRequest?: { key: string; laneId: string | null; n: number; keepScroll?: boolean } | null;
};

/** At most this many card elements in the DOM (NFR-PERF-07 AC-3). */
const MAX_DOM_CARDS = 150;
const BUFFER = 4;
const CARD_GAP = 8;

/** A lane or a day group by id (`day:<date>`). */
function targetOf(data: BoardLaneView[], id: string): { dropTarget: boolean; lane: BoardLaneView } | null {
  for (const l of data) {
    if (l.id === id) return { dropTarget: l.dropTarget, lane: l };
    const d = l.days?.find((x) => x.id === id);
    if (d) return { dropTarget: d.dropTarget, lane: l };
  }
  return null;
}

const cssId = (id: string) => Array.from(id.normalize('NFC')).map((ch) => (/[A-Za-z0-9_-]/.test(ch) ? ch : `_${ch.codePointAt(0)!.toString(16)}`)).join('');

/** The nearest ancestor that scrolls vertically (the main pane), or null for the window. */
function verticalScroller(el: HTMLElement | null): HTMLElement | null {
  for (let p = el?.parentElement ?? null; p; p = p.parentElement) {
    const o = getComputedStyle(p).overflowY;
    if (o === 'auto' || o === 'scroll') return p;
  }
  return null;
}

export function Board(p: BoardProps) {
  const root = useRef<HTMLDivElement | null>(null);
  const [drag, setDrag] = useState<{ key: string; from: string; over: string | null; alt: boolean } | null>(null);
  const [laneDrag, setLaneDrag] = useState<{ id: string; over: { id: string; before: boolean } | null } | null>(null);
  const [active, setActive] = useState<{ key: string; lane: string } | null>(null);
  const live = useRef(p);
  live.current = p;
  const vertical = p.lanes === 'vertical';
  const folded = new Set(p.folded);

  // ---- roving focus (D-1789): one card of the board is a Tab stop, the first card of the first lane with cards.
  const firstCard = (() => { for (const l of p.data) if (l.cards.length && !(folded.has(l.id) && !vertical)) return { key: l.cards[0], lane: l.id }; return null; })();
  const current = active && p.data.some((l) => l.id === active.lane && l.cards.includes(active.key)) ? active : firstCard;
  const cardEl = (key: string, lane: string) => root.current?.querySelector<HTMLElement>(`article[data-board-card="${CSS.escape(key)}"][data-lane="${CSS.escape(lane)}"]`) ?? null;
  const focusCard = (key: string, lane: string, keepScroll = false) => {
    setActive({ key, lane });
    const go = (n: number) => { const el = cardEl(key, lane); if (el) el.focus(keepScroll ? { preventScroll: true } : undefined); else if (n < 10) requestAnimationFrame(() => go(n + 1)); };
    if (!keepScroll) reveal(key, lane);
    go(0);
  };
  // Each request is handled once, as soon as its card is on the board.
  const handled = useRef(0);
  useEffect(() => {
    const r = p.focusRequest;
    if (!r || handled.current === r.n) return;
    const lane = r.laneId && p.data.some((l) => l.id === r.laneId && l.cards.includes(r.key)) ? r.laneId : p.data.find((l) => l.cards.includes(r.key))?.id;
    if (!lane) return;
    handled.current = r.n;
    focusCard(r.key, lane, !!r.keepScroll);
  }, [p.focusRequest?.n, p.data]); // eslint-disable-line react-hooks/exhaustive-deps

  // A focused card that is drawn again (it moved lanes, or an answer redrew it) keeps the focus on its new element.
  const focused = useRef<{ el: HTMLElement; key: string } | null>(null);
  useLayoutEffect(() => {
    const f = focused.current;
    if (!f || f.el.isConnected) return;
    if (document.activeElement && document.activeElement !== document.body) { focused.current = null; return; }
    const el = [...(root.current?.querySelectorAll<HTMLElement>('article[data-board-card]') ?? [])].find((c) => c.getAttribute('data-board-card') === f.key);
    if (el) { focused.current = { el, key: f.key }; el.focus({ preventScroll: true }); }
  });

  const move = (key: string, lane: string, e: React.KeyboardEvent<HTMLElement>) => {
    const lanes = p.data.filter((l) => !(folded.has(l.id) && !vertical));
    const li = lanes.findIndex((l) => l.id === lane);
    if (li < 0) return;
    const ci = lanes[li].cards.indexOf(key);
    // D-1905: ⌥←/⌥→ (and other modified arrows) do nothing on boards.
    if ((e.altKey || e.metaKey || e.ctrlKey) && e.key.startsWith('Arrow')) return;
    const within = vertical ? ['ArrowUp', 'ArrowDown'] : ['ArrowLeft', 'ArrowRight'];
    const across = vertical ? ['ArrowLeft', 'ArrowRight'] : ['ArrowUp', 'ArrowDown'];
    if (within.includes(e.key)) {
      e.preventDefault();
      const j = ci + (e.key === within[1] ? 1 : -1);
      if (j >= 0 && j < lanes[li].cards.length) focusCard(lanes[li].cards[j], lane);
    } else if (across.includes(e.key)) {
      e.preventDefault();
      const dir = e.key === across[1] ? 1 : -1;
      for (let k = li + dir; k >= 0 && k < lanes.length; k += dir) {
        const l = lanes[k];
        if (!l.cards.length) continue;
        focusCard(l.cards[Math.min(ci, l.cards.length - 1)], l.id);
        break;
      }
    } else if (e.key === 'Enter' && !e.metaKey && !e.altKey) {
      e.preventDefault();
      p.onOpen(key);
    }
  };

  // ---- hit tests by geometry: the lane, card or grip whose box holds a point (also a point the main pane has scrolled
  // out of view, which `elementFromPoint` can't see).
  const inBox = (el: Element, x: number, y: number) => { const r = el.getBoundingClientRect(); return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom; };
  const laneAt = (x: number, y: number): HTMLElement | null =>
    [...(root.current?.querySelectorAll<HTMLElement>('section[data-lane]') ?? [])].find((s) => inBox(s, x, y)) ?? null;
  const pressRef = useRef<(e: MouseEvent) => void>(() => {});
  pressRef.current = (e: MouseEvent) => {
    // A press outside the window's hit-testing (the pointer over a part scrolled out of view) still starts a drag of the
    // card or lane under it.
    if (e.button !== 0 || p.readOnly || !root.current || root.current.contains(e.target as Node)) return;
    const t = e.target as Element | null;
    if (t && t !== document.documentElement && t !== document.body) return;
    const grip = [...root.current.querySelectorAll<HTMLElement>('[data-command="board.laneDrag"]')].find((g) => inBox(g, e.clientX, e.clientY));
    if (grip) { e.preventDefault(); laneDragFrom(grip.closest('section')?.getAttribute('data-lane') ?? '', e.clientX, e.clientY); return; }
    const card = [...root.current.querySelectorAll<HTMLElement>('article[data-board-card]')].find((c) => inBox(c, e.clientX, e.clientY));
    const key = card?.getAttribute('data-board-card');
    const lane = card?.getAttribute('data-lane');
    if (!card || !key || !lane || !p.canDragCard(key)) return;
    e.preventDefault();
    cardDrag(key, lane, e.clientX, e.clientY);
  };
  useEffect(() => {
    const f = (e: MouseEvent) => pressRef.current(e);
    window.addEventListener('mousedown', f, true);
    return () => window.removeEventListener('mousedown', f, true);
  }, []);

  // ---- card drag (R187): > 4 px starts it; Alt at drop time adds only; Esc cancels.
  const startCardDrag = (key: string, from: string) => (e: React.MouseEvent<HTMLElement>) => {
    if (e.button !== 0) return;
    const el = e.target as HTMLElement;
    if (el.closest('button, input, [role="checkbox"]')) return;
    if (p.readOnly || !p.canDragCard(key)) return;
    e.preventDefault();
    cardDrag(key, from, e.clientX, e.clientY);
  };
  const cardDrag = (key: string, from: string, x0: number, y0: number) => {
    let started = false;
    let cancelled = false;
    const overAt = (x: number, y: number) => {
      const sec = laneAt(x, y);
      if (!sec) return null;
      const day = [...sec.querySelectorAll<HTMLElement>('div[data-day]')].find((d) => inBox(d, x, y));
      return day ? `day:${day.getAttribute('data-day')}` : sec.getAttribute('data-lane');
    };
    const esc = (k: KeyboardEvent) => {
      if (k.key !== 'Escape' || !started) return;
      k.preventDefault(); k.stopPropagation();
      cancelled = true;
      setDrag(null);
    };
    const moveH = (m: MouseEvent) => {
      if (cancelled) return;
      if (!started && Math.abs(m.clientX - x0) + Math.abs(m.clientY - y0) <= 4) return;
      m.preventDefault();
      started = true;
      setDrag({ key, from, over: overAt(m.clientX, m.clientY), alt: m.altKey });
    };
    const altH = (k: KeyboardEvent) => { if (k.key === 'Alt' && started && !cancelled) setDrag((d) => (d ? { ...d, alt: k.type === 'keydown' } : d)); };
    const up = (u: MouseEvent) => {
      window.removeEventListener('mousemove', moveH, true);
      window.removeEventListener('mouseup', up, true);
      window.removeEventListener('keydown', esc, true);
      window.removeEventListener('keydown', altH, true);
      window.removeEventListener('keyup', altH, true);
      if (!started) return;
      const swallow = (c: MouseEvent) => { c.stopPropagation(); c.preventDefault(); window.removeEventListener('click', swallow, true); };
      window.addEventListener('click', swallow, true);
      setTimeout(() => window.removeEventListener('click', swallow, true), 0);
      setDrag(null);
      if (cancelled) return;
      const to = overAt(u.clientX, u.clientY);
      const target = to ? targetOf(live.current.data, to) : null;
      if (to && target && target.dropTarget && to !== from && live.current.dropLabel(key, from, to, u.altKey) !== null) live.current.onCardDrop(key, from, to, u.altKey);
    };
    window.addEventListener('mousemove', moveH, true);
    window.addEventListener('mouseup', up, true);
    window.addEventListener('keydown', esc, true);
    window.addEventListener('keydown', altH, true);
    window.addEventListener('keyup', altH, true);
  };

  // ---- lane drag (R187, D-1792): the grip; vertical lanes drop by the half of the column, rows take the place.
  const startLaneDrag = (id: string) => (e: React.MouseEvent<HTMLElement>) => {
    if (e.button !== 0 || p.readOnly) return;
    e.preventDefault();
    laneDragFrom(id, e.clientX, e.clientY);
  };
  const laneDragFrom = (id: string, x0: number, y0: number) => {
    let started = false;
    let cancelled = false;
    const order = live.current.data.map((l) => l.id);
    const dropAt = (x: number, y: number): { id: string; before: boolean } | null => {
      const sec = laneAt(x, y);
      const to = sec?.getAttribute('data-lane') ?? null;
      const lane = live.current.data.find((l) => l.id === to);
      if (!sec || !lane || !lane.grip) return null; // nothing drops on or after `none`
      if (live.current.lanes === 'vertical') {
        const r = sec.getBoundingClientRect();
        return { id: lane.id, before: x < r.left + r.width / 2 };
      }
      return { id: lane.id, before: order.indexOf(id) > order.indexOf(lane.id) };
    };
    const esc = (k: KeyboardEvent) => {
      if (k.key !== 'Escape' || !started) return;
      k.preventDefault(); k.stopPropagation();
      cancelled = true;
      setLaneDrag(null);
    };
    const moveH = (m: MouseEvent) => {
      if (cancelled) return;
      if (!started && Math.abs(m.clientX - x0) + Math.abs(m.clientY - y0) <= 4) return;
      m.preventDefault();
      started = true;
      setLaneDrag({ id, over: dropAt(m.clientX, m.clientY) });
    };
    const up = (u: MouseEvent) => {
      window.removeEventListener('mousemove', moveH, true);
      window.removeEventListener('mouseup', up, true);
      window.removeEventListener('keydown', esc, true);
      setLaneDrag(null);
      if (!started || cancelled) return;
      const to = dropAt(u.clientX, u.clientY);
      if (!to || to.id === id) return;
      const movable = live.current.data.filter((l) => l.grip).map((l) => l.id);
      const before = to.before ? to.id : movable[movable.indexOf(to.id) + 1] ?? null;
      // A drop that leaves the order as it is writes nothing (R187, FR-QRY-05 AC-19, FR-SYN-06): e.g. on the near half of
      // a neighbour, where `before` is the dragged lane itself or the lane already after it.
      const rest = movable.filter((m) => m !== id);
      const at = before === null || before === id ? (before === id ? movable.indexOf(id) : rest.length) : rest.indexOf(before);
      const next = [...rest.slice(0, at), id, ...rest.slice(at)];
      if (next.every((m, i) => m === movable[i])) return;
      live.current.onLaneDrop(id, before === id ? null : before);
    };
    window.addEventListener('mousemove', moveH, true);
    window.addEventListener('mouseup', up, true);
    window.addEventListener('keydown', esc, true);
  };

  // ---- lane virtualisation (NFR-PERF-07 AC-3): each lane renders the cards near the visible part of the main pane.
  const [tick, setTick] = useState(0);
  const cardH = useRef(0);
  useEffect(() => {
    const scroller = verticalScroller(root.current);
    const target: HTMLElement | Window = scroller ?? window;
    let raf = 0;
    const on = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; setTick((n) => n + 1); }); };
    target.addEventListener('scroll', on, { passive: true });
    window.addEventListener('resize', on);
    return () => { target.removeEventListener('scroll', on); window.removeEventListener('resize', on); if (raf) cancelAnimationFrame(raf); };
  }, []);
  const total = p.data.reduce((n, l) => n + (folded.has(l.id) && !vertical ? 0 : l.cards.length), 0);
  const perLane = Math.max(10, Math.floor(MAX_DOM_CARDS / Math.max(1, p.data.length)));
  const windowOf = (laneId: string, count: number): { from: number; to: number; perRow: number } => {
    const perRow = vertical ? 1 : Math.max(1, Math.floor(((root.current?.clientWidth ?? 800) + CARD_GAP) / (210 + CARD_GAP)));
    if (total <= MAX_DOM_CARDS) return { from: 0, to: count, perRow };
    const h = (cardH.current || 96) + CARD_GAP;
    const list = root.current?.querySelector<HTMLElement>(`section[data-lane="${CSS.escape(laneId)}"] .board-cards`);
    const scroller = verticalScroller(root.current);
    const viewTop = scroller ? scroller.getBoundingClientRect().top : 0;
    const viewH = scroller ? scroller.clientHeight : window.innerHeight;
    const top = list ? list.getBoundingClientRect().top : viewTop;
    const rows = Math.ceil(count / perRow);
    const first = Math.max(0, Math.floor((viewTop - top) / h) - BUFFER);
    const maxRows = Math.max(1, Math.floor(perLane / perRow));
    const want = Math.min(maxRows, Math.ceil(viewH / h) + BUFFER * 2);
    const fromRow = Math.max(0, Math.min(first, rows - want));
    const toRow = Math.min(rows, fromRow + want);
    return { from: fromRow * perRow, to: Math.min(count, toRow * perRow), perRow };
  };
  void tick;
  useLayoutEffect(() => {
    const c = root.current?.querySelector<HTMLElement>('article[data-board-card]');
    if (c) cardH.current = c.getBoundingClientRect().height || cardH.current;
  });
  /** Brings a card of a long lane into the rendered window (keyboard moves past its edge). */
  const reveal = (key: string, lane: string) => {
    if (cardEl(key, lane)) return;
    const l = p.data.find((x) => x.id === lane);
    const list = root.current?.querySelector<HTMLElement>(`section[data-lane="${CSS.escape(lane)}"] .board-cards`);
    const scroller = verticalScroller(root.current);
    if (!l || !list || !scroller) return;
    const i = l.cards.indexOf(key);
    const h = (cardH.current || 96) + CARD_GAP;
    scroller.scrollTop += list.getBoundingClientRect().top - scroller.getBoundingClientRect().top + i * h - scroller.clientHeight / 3;
    setTick((n) => n + 1);
  };

  const slotFor = (key: string, laneId: string): CardSlotProps => ({
    tabIndex: current && current.key === key && current.lane === laneId ? 0 : -1,
    'data-lane': laneId,
    onFocus: (e?: React.FocusEvent<HTMLElement>) => { setActive({ key, lane: laneId }); if (e?.currentTarget) focused.current = { el: e.currentTarget, key }; p.onCardFocus?.(key, laneId); },
    onKeyDown: (e) => { if (e.target === e.currentTarget) move(key, laneId, e); },
    onMouseDown: startCardDrag(key, laneId),
    onDragStart: (e) => e.preventDefault(),
    draggable: false,
    dragging: !!drag && drag.key === key && drag.from === laneId,
    // Slice AND-2 (android-phone §9.5): on the phone a tap on a card opens it (its links and checkbox keep their own).
    ...(isPhone() ? { onClick: (e: React.MouseEvent<HTMLElement>) => { if (!(e.target as HTMLElement).closest('a, button, [role="checkbox"]')) p.onOpen(key); } } : {}),
  });

  return (
    <div ref={root} role="group" aria-label={p.label} data-user-content="" data-board="" data-lanes={p.lanes} data-group-by={p.groupBy}
      data-board-name={p.name ?? undefined} data-wall={p.wall ? '' : undefined} data-grouped={p.wall ? 'true' : undefined}
      className={`board board-${p.lanes}${drag ? ' dragging' : ''}`}>
      <div className="board-scroll">
        {p.data.map((l) => {
          const isFolded = !vertical && folded.has(l.id);
          const headingId = `lane-${cssId(p.name ?? 'inline')}-${cssId(l.id)}`;
          const overDay = drag && drag.over && drag.over !== drag.from && l.days?.some((d) => d.id === drag.over) ? drag.over : null;
          const over = drag && drag.over && drag.over !== drag.from && (drag.over === l.id || overDay) ? p.dropLabel(drag.key, drag.from, drag.over, drag.alt) : null;
          const laneOver = laneDrag?.over?.id === l.id && laneDrag.id !== l.id ? (laneDrag.over.before ? 'before' : 'after') : null;
          const win = isFolded ? { from: 0, to: 0, perRow: 1 } : l.days?.length ? { from: 0, to: l.cards.length, perRow: 1 } : windowOf(l.id, l.cards.length);
          const h = (cardH.current || 96) + CARD_GAP;
          const padTop = Math.ceil(win.from / win.perRow) * h;
          const padBottom = Math.ceil((l.cards.length - win.to) / win.perRow) * h;
          return (
            <section key={l.id} role="region" aria-label={t('a11y.nameCount', { name: l.label, count: l.countLabel ?? t('board.laneCount', { count: l.cards.length }) })}
              aria-description={l.excluded ? t('board.excluded') : undefined}
              data-lane={l.id} data-lane-kind={l.kind} data-excluded={l.excluded ? '' : undefined} data-drop-target={l.dropTarget ? 'true' : 'false'}
              data-folded={isFolded ? '' : undefined} data-color={l.kind === 'done' && l.color ? l.color : undefined}
              className={['board-lane', l.excluded ? 'excluded' : '', over !== null ? 'drop-over' : '', laneOver ? `lane-drop-${laneOver}` : '', laneDrag?.id === l.id ? 'lane-dragging' : ''].filter(Boolean).join(' ')}>
              <header className="board-lane-head">
                {!vertical && (
                  <button type="button" tabIndex={0} className="icon-button small lane-fold" aria-expanded={!isFolded} data-command="board.toggleLane"
                    aria-label={t(isFolded ? 'board.expand' : 'board.collapse', { lane: l.label })}
                    onClick={(e) => p.onFold(l.id, e.altKey)}>
                    <Icon name={isFolded ? 'chevron-right' : 'chevron-down'} size={13} />
                  </button>
                )}
                {/* Slice AND-2 (android-phone §9.5, RA11): no lane grips on the phone. */}
                {l.grip && !isPhone() && (
                  <span role="button" tabIndex={0} className="lane-grip" data-command="board.laneDrag" aria-label={t(vertical ? 'board.dragColumn' : 'board.dragRow')}
                    aria-describedby={headingId} aria-disabled={p.readOnly ? 'true' : undefined} title={t(vertical ? 'board.dragColumn' : 'board.dragRow')}
                    onMouseDown={startLaneDrag(l.id)} onDragStart={(e) => e.preventDefault()}>
                    <Icon name="grip" size={13} />
                  </span>
                )}
                <h2 id={headingId} data-color={(l.kind === 'option' || l.kind === 'done') && l.color ? l.color : undefined} data-tone={l.tone ?? undefined}
                  style={(l.kind === 'option' || l.kind === 'done') && l.color ? { color: `var(--type-${l.color})` } : undefined}>
                  <span data-user-content={l.userLabel ? '' : undefined}>{l.label}</span>
                </h2>
                <span className="count" aria-hidden="true">{l.cards.length}</span>
              </header>
              {l.hint && <p className="lane-hint">{l.hint}</p>}
              {l.excluded && <p className="lane-excluded">{l.excludedText}</p>}
              {over !== null && !overDay && <div className="board-drop" role="presentation">{over}</div>}
              {!isFolded && l.days && l.days.length > 0 && (
                <div className="board-days">
                  {l.days.map((d) => (
                    <div key={d.id} role="group" aria-label={t('a11y.nameCount', { name: d.label, count: d.countLabel ?? t('board.laneCount', { count: d.cards.length }) })}
                      data-day={d.date} data-drop-target={d.dropTarget ? 'true' : 'false'} className={`board-day${overDay === d.id ? ' drop-over' : ''}`}>
                      <h3 className="day-heading">{d.label}</h3>
                      {overDay === d.id && over !== null && <div className="board-drop" role="presentation">{over}</div>}
                      {d.cards.length > 0 && (
                        <div className="board-cards">
                          {d.cards.map((key) => p.renderCard(key, l.id, slotFor(key, l.id)))}
                        </div>
                      )}
                    </div>
                  ))}
                  {!vertical && l.newLabel && !p.readOnly && (
                    <button type="button" tabIndex={0} className="board-new-tile" data-command="board.newIn" aria-label={l.newLabel} onClick={() => p.onNew(l.id)}>
                      <Icon name="plus" size={13} />{p.newTile}
                    </button>
                  )}
                </div>
              )}
              {!isFolded && !(l.days && l.days.length > 0) && (
                <div className="board-cards">
                  {padTop > 0 && <div className="board-spacer" aria-hidden="true" style={{ height: padTop, gridColumn: '1 / -1' }} />}
                  {l.cards.slice(win.from, win.to).map((key) => p.renderCard(key, l.id, slotFor(key, l.id)))}
                  {padBottom > 0 && <div className="board-spacer" aria-hidden="true" style={{ height: padBottom, gridColumn: '1 / -1' }} />}
                  {!vertical && l.newLabel && !p.readOnly && (
                    <button type="button" tabIndex={0} className="board-new-tile" data-command="board.newIn" aria-label={l.newLabel} onClick={() => p.onNew(l.id)}>
                      <Icon name="plus" size={13} />{p.newTile}
                    </button>
                  )}
                </div>
              )}
              {vertical && l.newLabel && !p.readOnly && (
                <button type="button" tabIndex={0} className="board-new" data-command="board.newIn" aria-label={l.newLabel} title={l.newLabel} onClick={() => p.onNew(l.id)}>
                  <Icon name="plus" size={13} />
                </button>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
