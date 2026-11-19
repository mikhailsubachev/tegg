// Slice Q2: the board of a saved query or a fence (docs/contracts/v1-views.md §4.2 `QueryBoard.tsx`, §4.4, §4.5, §4.7,
// §4.8; R187; D-1769, D-1773, D-1789, D-1791…D-1794, D-1800, D-1820): `Board` bound to a `QueryResultDto` with `group`.
// A card drop moves the card at once (optimistic) and writes its object once (`writeCardMove`); a lane drag writes
// `lane_order` once (`apply`); folds are machine-local per saved query (in memory for an inline fence); `New <Type> in
// <lane>` opens the pre-filled draft. Used by a view tab (`ViewPanel`), a query block and the query page.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import { t, catalogLocale } from '../../i18n/catalog';
import { ipc } from '../../ipc/client';
import type { GroupingDto, LaneDto, QueryDefDto, QueryResultDto, QueryRowDto } from '../../ipc/queries';
import type { TypeDto } from '../../ipc/types';
import { Board, type BoardLaneView } from '../../board/Board';
import { PopupMenu, type MenuEntry } from '../../shell/Menu';
import { lastFocused } from '../../views/actions';
import { foldedOf, setFolded } from '../../views/uiState';
import { queryAlert } from '../editorHost';
import { announceView, ensureViewsLive } from '../../views/live';
import { queryNav } from '../nav';
import { BoardCard } from './BoardCard';
import { cardMove, excludedValues, laneOrderAfterDrop, neighbourDropLane, prefillFor } from './model';
import { writeCardMove } from './write';

const nfc = (s: string) => s.normalize('NFC');
const fold = (s: string) => nfc(s).toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').normalize('NFC');

/** What the page or block hands the palette (§4.7). */
export type BoardControl = {
  status(): { lanes: 'vertical' | 'horizontal'; laneOrder: boolean; cardFocused: boolean; laneFocused: boolean };
  run(id: string): boolean;
};

/** The toolbar's narrowing (D-1796): folded title text and every chosen tag key. */
export type BoardFilter = { text: string; tags: string[] };

/** The card a board should focus when it shows again (Back after ⏎ on a card, R191). */
let returnTo: { name: string | null; key: string; lane: string } | null = null;

// ------------------------------------------------------------------ `__TEGG_TEST__.board()` (contract §5)

type Snapshot = { name: string | null; lanes: { id: string; cards: string[] }[]; domCards: number };
const mounted = new Set<() => Snapshot>();
function installHook() {
  if (typeof window === 'undefined') return;
  const w = window as { __TEGG_TEST__?: Record<string, unknown> };
  if (typeof w.__TEGG_TEST__?.board === 'function') return;
  w.__TEGG_TEST__ = { ...(w.__TEGG_TEST__ ?? {}), board: () => [...mounted].map((f) => f()) };
}

/** The `Lanes` radiogroup (R187, §4.3): one `query_apply` with `lanes` flipped; the checked radio writes nothing. */
export function LanesSwitch({ lanes, disabled, onSwitch }: { lanes: 'vertical' | 'horizontal'; disabled: string | null; onSwitch: (l: 'vertical' | 'horizontal') => void }) {
  return (
    <div role="radiogroup" aria-label={t('board.lanes')} data-command="board.switchLanes" className="segmented lanes-switch">
      {(['vertical', 'horizontal'] as const).map((l) => (
        <button key={l} type="button" role="radio" aria-checked={lanes === l} tabIndex={lanes === l ? 0 : -1}
          title={t(l === 'vertical' ? 'board.verticalTitle' : 'board.horizontalTitle')}
          aria-disabled={disabled ? 'true' : undefined} aria-description={disabled ?? undefined}
          className={lanes === l ? 'on' : ''}
          onClick={() => { if (!disabled && lanes !== l) onSwitch(l); }}
          onKeyDown={(e) => {
            if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight' && e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
            e.preventDefault();
            const next = lanes === 'vertical' ? 'horizontal' : 'vertical';
            (e.currentTarget.parentElement?.querySelector<HTMLElement>(`[role="radio"]:nth-child(${next === 'vertical' ? 1 : 2})`))?.focus();
            if (!disabled) onSwitch(next);
          }}>
          {t(l === 'vertical' ? 'board.vertical' : 'board.horizontal')}
        </button>
      ))}
    </div>
  );
}

export function QueryBoard({ result, name, title, readOnly, types, filter, apply, rerun, controlRef }: {
  result: QueryResultDto & { group: GroupingDto; def: QueryDefDto };
  /** The saved query's name (folds, the hook); null for an inline fence. */
  name: string | null;
  title: string;
  /** A read-only view (`version` > 1): the reason; every write control is refused. */
  readOnly: string | null;
  types: TypeDto[];
  filter?: BoardFilter;
  /** One `query_apply` with only these keys changed (lane order, lanes). */
  apply: (patch: Partial<QueryDefDto>) => void;
  rerun: () => void;
  controlRef?: MutableRefObject<BoardControl | null>;
}) {
  const { group, def } = result;
  const root = useRef<HTMLDivElement | null>(null);
  const typeOf = (k: string) => types.find((x) => nfc(x.key) === nfc(k));
  const pageType = def.types.length === 1 ? typeOf(def.types[0]) : undefined;
  const typeName = (k: string) => typeOf(k)?.name ?? k;
  const rowsByPath = useMemo(() => new Map(result.rows.map((r) => [nfc(r.path), r])), [result.rows]);

  // ---- optimistic moves (NFR-PERF-07 AC-4): the card shows in its target lane until the next answer.
  const [moves, setMoves] = useState<{ key: string; from: string; to: string; alt: boolean; at: number }[]>([]);
  // A move stays drawn until an answer shows it (the card in its target lane, or gone from its source lane), so an
  // answer read before the write landed doesn't flick the card back.
  useEffect(() => {
    setMoves((ms) => ms.filter((m) => {
      if (performance.now() - m.at > 3000) return false;
      const lane = (id: string) => group.lanes.find((l) => l.id === id)?.cards.some((c) => nfc(result.rows[c.row]?.path ?? '') === m.key) ?? false;
      return !(lane(m.to) || (!m.alt && !lane(m.from)));
    }));
  }, [result]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- folds (R190): saved queries keep them in the UI state, inline fences in memory.
  const [folded, setFoldedState] = useState<string[]>(() => (name ? foldedOf(name) : []));
  const onFold = (id: string, every: boolean) => {
    const all = group.lanes.map((l) => l.id);
    const next = every ? (folded.includes(id) ? [] : all) : folded.includes(id) ? folded.filter((x) => x !== id) : [...folded, id];
    setFoldedState(next);
    if (name) setFolded(name, next);
  };

  // ---- the lanes as shown: narrowed by the toolbar's filters, with the optimistic moves applied.
  const q = filter ? fold(filter.text.trim()) : '';
  const keep = (r: QueryRowDto | undefined) => {
    if (!r) return false;
    if (q && !fold(r.title).includes(q)) return false;
    if (filter?.tags.length) {
      const keys = (Array.isArray(r.values.tags) ? r.values.tags : []).map((x) => nfc(String(x)).replace(/^#/, '').toLowerCase());
      if (!filter.tags.every((k) => keys.includes(k))) return false;
    }
    return true;
  };
  const listFormat = (xs: string[]) => { try { return new Intl.ListFormat(catalogLocale(), { type: 'conjunction' }).format(xs); } catch { return xs.join(', '); } };
  const attrName = group.name;
  const labelOf = (l: LaneDto) => (l.kind === 'none' ? t('board.none', { attribute: attrName }) : l.label);
  const lanesShown: BoardLaneView[] = group.lanes.map((l) => {
    let cards = l.cards.map((c) => nfc(result.rows[c.row]?.path ?? '')).filter((p) => p && keep(rowsByPath.get(p)));
    for (const m of moves) {
      if (m.from === l.id && !m.alt) cards = cards.filter((k) => k !== m.key);
      if (m.to === l.id && !cards.includes(m.key)) cards = [m.key, ...cards];
    }
    const writable = !readOnly;
    const newOk = writable && l.dropTarget && !l.excluded && l.value !== null && (l.kind === 'option' || l.kind === 'tag' || l.kind === 'relation') && !!pageType;
    return {
      id: l.id, kind: l.kind, label: labelOf(l), userLabel: l.kind !== 'none', color: l.color, cards, excluded: l.excluded,
      excludedText: def.lanes === 'horizontal' ? t('board.excludedLong', { values: listFormat(excludedValues(group)) }) : t('board.excluded'),
      dropTarget: l.dropTarget, grip: l.dropTarget && l.kind !== 'none',
      newLabel: newOk ? t('board.newIn', { type: pageType!.name, lane: labelOf(l) }) : null,
    };
  });

  // ---- the perf marks (D-1800): `board-ready` once the first cards painted; `board-card-moved` per drop.
  useEffect(() => {
    let a = 0, b = 0;
    a = requestAnimationFrame(() => { b = requestAnimationFrame(() => { void ipc.perfMark('board-ready').catch(() => {}); }); });
    return () => { cancelAnimationFrame(a); cancelAnimationFrame(b); };
  }, []);
  const marked = useRef(0);
  useLayoutEffect(() => {
    const m = moves[moves.length - 1];
    if (!m || marked.current === m.at) return;
    const el = root.current?.querySelector(`section[data-lane="${CSS.escape(m.to)}"] article[data-board-card="${CSS.escape(m.key)}"]`);
    if (!el) return;
    marked.current = m.at;
    void ipc.perfTimed('board-card-moved', Math.max(0, performance.now() - m.at)).catch(() => {});
  });

  // ---- the test hook (contract §5).
  const snap = useRef<() => Snapshot>(() => ({ name, lanes: [], domCards: 0 }));
  snap.current = () => ({ name, lanes: lanesShown.map((l) => ({ id: l.id, cards: l.cards })), domCards: root.current?.querySelectorAll('article[data-board-card]').length ?? 0 });
  useEffect(() => {
    ensureViewsLive();
    installHook();
    const f = () => snap.current();
    mounted.add(f);
    return () => { mounted.delete(f); };
  }, []);

  // ---- the focus to restore (Back, a moved card) and the one the palette's commands act on.
  const [focusRequest, setFocusRequest] = useState<{ key: string; laneId: string | null; n: number } | null>(() => {
    const r = returnTo;
    if (r && r.name === name) { returnTo = null; return { key: r.key, laneId: r.lane, n: 1 }; }
    return null;
  });
  const after = useRef<{ key: string; from: string; index: number } | null>(null);
  useEffect(() => {
    const a = after.current;
    if (!a) return;
    after.current = null;
    if (lanesShown.some((l) => l.cards.includes(a.key))) { setFocusRequest((r) => ({ key: a.key, laneId: null, n: (r?.n ?? 0) + 1 })); return; }
    const l = lanesShown.find((x) => x.id === a.from);
    const next = l?.cards[Math.min(a.index, l.cards.length - 1)];
    if (next) setFocusRequest((r) => ({ key: next, laneId: a.from, n: (r?.n ?? 0) + 1 }));
  }, [result]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- a card move (drop, `Move to`, `Also add to`, `Move card to next / previous lane`).
  const laneById = (id: string) => group.lanes.find((l) => l.id === id);
  const moveFor = (key: string, from: string, to: string, alt: boolean) => {
    const row = rowsByPath.get(key);
    if (!row || row.readOnly || readOnly) return null;
    const rowIndex = result.rows.indexOf(row);
    return cardMove(group, rowIndex, from, to, alt && group.kind !== 'select' && !(group.kind === 'relation' && !group.multiple));
  };
  const doMove = (key: string, from: string, to: string, alt: boolean) => {
    const move = moveFor(key, from, to, alt);
    const row = rowsByPath.get(key);
    const target = laneById(to);
    if (!move || !row || !target) return;
    const added = move.shape === 'list' && move.remove.length === 0;
    setMoves((m) => [...m, { key, from, to, alt: added, at: performance.now() }]);
    void writeCardMove(row, move).then((r) => {
      if (r.outcome === 'written') {
        const lane = labelOf(target);
        const fromNone = laneById(from)?.kind === 'none';
        let text = target.excluded ? t('board.leftView', { title: row.title, lane }) : t((alt || fromNone) && added ? 'board.added' : 'board.moved', { title: row.title, lane });
        // D-478: a tag that is (also) in the body stays; the note names it.
        const src = laneById(from);
        const inlineOnly = group.kind === 'tags' && src?.kind === 'tag' && !alt && move.remove.length === 0;
        if (r.inlineKept) for (const tag of move.remove) text += ` ${t('board.inlineKept', { tag: tag.replace(/^#/, ''), title: row.title })}`;
        else if (inlineOnly && src) text += ` ${t('board.inlineKept', { tag: src.label.replace(/^#/, ''), title: row.title })}`;
        announceView(text);
      } else if (r.outcome === 'conflict') {
        setMoves((m) => m.filter((x) => x.key !== key));
        queryAlert(t('board.changedOutside', { title: row.title }));
      } else if (r.outcome === 'failed') {
        setMoves((m) => m.filter((x) => x.key !== key));
        queryAlert(t('query.saveFailed'));
      } else setMoves((m) => m.filter((x) => x.key !== key));
      rerun();
    });
  };
  const dropLabel = (key: string, from: string, to: string, alt: boolean): string | null => {
    const lane = laneById(to);
    if (!lane || !lane.dropTarget) return null;
    const list = group.kind !== 'select' && !(group.kind === 'relation' && !group.multiple);
    const move = moveFor(key, from, to, alt);
    if (!move) return null;
    return alt && list ? t('board.dropAdd', { lane: labelOf(lane) }) : t('board.dropSet', { attribute: attrName, lane: labelOf(lane) });
  };

  // ---- the card menu: Open, Move to ›, Also add to › (list kinds).
  const [menu, setMenu] = useState<{ row: QueryRowDto; anchor: HTMLElement; lane: string; level: 'root' | 'move' | 'also' } | null>(null);
  const listKind = group.kind !== 'select' && !(group.kind === 'relation' && !group.multiple);
  const menuEntries = (): MenuEntry[] => {
    if (!menu) return [];
    const { row, lane } = menu;
    const path = nfc(row.path);
    const why = readOnly ?? (row.readOnly ? t('task.readOnly') : undefined);
    const close = () => { setMenu(null); };
    if (menu.level !== 'root') {
      return group.lanes.filter((l) => l.dropTarget && l.id !== lane && !(menu.level === 'also' && l.cards.some((c) => nfc(result.rows[c.row]?.path ?? '') === path)))
        .map((l) => ({ kind: 'item', key: l.id, label: labelOf(l), content: <span data-user-content={l.kind !== 'none' ? '' : undefined}>{labelOf(l)}</span>,
          disabled: !!why, description: why, onChoose: () => { close(); doMove(path, lane, l.id, menu.level === 'also'); } }));
    }
    return [
      { kind: 'item', key: 'open', label: t('pinned.open'), content: <span className="menu-title">{t('pinned.open')}</span>, onChoose: () => { close(); open(path, lane); } },
      { kind: 'item', key: 'move', label: t('board.cardMenu.moveTo'), content: <span className="menu-title">{t('board.cardMenu.moveTo')}</span>, disabled: !!why, description: why,
        onChoose: () => setMenu((m) => (m ? { ...m, level: 'move' } : m)) },
      ...(listKind ? [{ kind: 'item', key: 'also', label: t('board.cardMenu.alsoAdd'), content: <span className="menu-title">{t('board.cardMenu.alsoAdd')}</span>, disabled: !!why, description: why,
        onChoose: () => setMenu((m) => (m ? { ...m, level: 'also' } : m)) } as MenuEntry] : []),
    ];
  };

  const open = (key: string, lane: string | null) => {
    if (lane) returnTo = { name, key, lane };
    queryNav()?.openNote(key);
  };

  // ---- the palette (§4.7): card and lane commands act on the focused card or lane of this board.
  const focusedHere = () => {
    const el = lastFocused();
    return el && root.current?.contains(el) ? el : null;
  };
  const focusedCard = () => {
    const el = focusedHere()?.closest<HTMLElement>('article[data-board-card]');
    return el ? { key: el.getAttribute('data-board-card') ?? '', lane: el.getAttribute('data-lane') ?? '' } : null;
  };
  const focusedLane = () => {
    const el = focusedHere();
    if (!el) return null;
    const card = el.closest<HTMLElement>('article[data-board-card]');
    if (card) return card.getAttribute('data-lane');
    return el.closest<HTMLElement>('section[data-lane]')?.getAttribute('data-lane') ?? null;
  };
  const moveLane = (dir: 1 | -1) => {
    const id = focusedLane();
    if (!id || readOnly) return;
    const movable = group.lanes.filter((l) => l.kind !== 'none');
    const i = movable.findIndex((l) => l.id === id);
    if (i < 0) return;
    const j = i + dir;
    if (j < 0 || j >= movable.length) return;
    const before = dir < 0 ? movable[j].id : movable[j + 1]?.id ?? null;
    const order = laneOrderAfterDrop(group, id, before);
    if (!order) return;
    apply({ laneOrder: order });
    announceView(t('board.laneMoved', { lane: labelOf(movable[i]) }));
  };
  const control: BoardControl = {
    status: () => ({ lanes: def.lanes, laneOrder: def.laneOrder !== null, cardFocused: !!focusedCard(), laneFocused: focusedLane() !== null }),
    run: (id) => {
      switch (id) {
        case 'board.switchLanes': if (!readOnly) apply({ lanes: def.lanes === 'vertical' ? 'horizontal' : 'vertical' }); return true;
        case 'board.resetLaneOrder': if (!readOnly && def.laneOrder !== null) apply({ laneOrder: null }); return true;
        case 'board.cardNext': case 'board.cardPrevious': {
          const c = focusedCard();
          if (!c) return true;
          const to = neighbourDropLane(group, c.lane, id === 'board.cardNext' ? 1 : -1);
          if (!to) return true;
          const from = lanesShown.find((l) => l.id === c.lane);
          after.current = { key: c.key, from: c.lane, index: Math.max(0, from?.cards.indexOf(c.key) ?? 0) };
          doMove(c.key, c.lane, to.id, false);
          setFocusRequest((r) => ({ key: c.key, laneId: to.id, n: (r?.n ?? 0) + 1 }));
          return true;
        }
        case 'board.laneLeft': case 'board.laneUp': moveLane(-1); return true;
        case 'board.laneRight': case 'board.laneDown': moveLane(1); return true;
        default: return false;
      }
    },
  };
  if (controlRef) controlRef.current = control;
  useEffect(() => () => { if (controlRef && controlRef.current) controlRef.current = null; }, [controlRef]);

  const row = (key: string) => rowsByPath.get(key);
  return (
    <div ref={root} className="query-board">
      <Board label={title} name={name} groupBy={nfc(group.key)} lanes={def.lanes} data={lanesShown} folded={folded} onFold={onFold}
        readOnly={readOnly}
        canDragCard={(key) => !!row(key) && !row(key)!.readOnly}
        dropLabel={dropLabel}
        onCardDrop={(key, from, to, alt) => doMove(key, from, to, alt)}
        onLaneDrop={(id, before) => {
          if (readOnly) return;
          const order = laneOrderAfterDrop(group, id, before);
          if (order) apply({ laneOrder: order });
        }}
        onNew={(laneId) => {
          const pf = prefillFor(def, group, laneId, pageType);
          if (pf) queryNav()?.openNew(pf.type, pf.values);
        }}
        onOpen={(key) => open(key, lanesShown.find((l) => l.cards.includes(key))?.id ?? null)}
        newTile={pageType ? t('board.newTile', { type: pageType.name }) : ''}
        focusRequest={focusRequest}
        renderCard={(key, laneId, slot) => {
          const r = row(key);
          if (!r) return null;
          return (
            <BoardCard key={`${laneId}\n${key}`} row={r} laneId={laneId} columns={def.columns} type={typeOf(r.type)} typeName={typeName(r.type)} group={group}
              slot={{ ...slot, onKeyDown: (e) => { if (e.key === 'F10' && e.shiftKey && e.target === e.currentTarget) { e.preventDefault(); setMenu({ row: r, anchor: e.currentTarget, lane: laneId, level: 'root' }); return; } slot.onKeyDown(e); } }}
              onOpen={(p) => open(p, laneId)}
              onMenu={(rr, anchor, lane) => setMenu({ row: rr, anchor, lane, level: 'root' })} />
          );
        }} />
      {menu && (
        <PopupMenu key={menu.level} label={t('task.more', { title: menu.row.title })} anchor={menu.anchor} entries={menuEntries()} onClose={() => setMenu(null)} />
      )}
    </div>
  );
}
