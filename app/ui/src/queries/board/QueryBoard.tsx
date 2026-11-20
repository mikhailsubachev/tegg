// Slice Q2: the board of a saved query or a fence (docs/contracts/v1-views.md §4.2 `QueryBoard.tsx`, §4.4, §4.5, §4.7,
// §4.8; R187; D-1769, D-1773, D-1789, D-1791…D-1794, D-1800, D-1820): `Board` bound to a `QueryResultDto` with `group`.
// A card drop moves the card at once (optimistic) and writes its object once (`writeCardMove`); a lane drag writes
// `lane_order` once (`apply`); folds are machine-local per saved query (in memory for an inline fence); `New <Type> in
// <lane>` opens the pre-filled draft. Used by a view tab (`ViewPanel`), a query block and the query page.
// Slice Q2-T (§28.2, §29.3…§29.5; R201, R203, R205): period lanes with day groups, the done lane and its window, drops
// and tiles from the shown run's bounds (`period.ts`), the Task card (R43) with its menu, and every write from a board
// through one per-object queue (`writeCardChange`).
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import { applyTaskChange, completeTask, type TaskState } from '@tegg/doc';
import { t, catalogLocale } from '../../i18n/catalog';
import { ipc } from '../../ipc/client';
import type { GroupingDto, LaneDto, QueryDefDto, QueryEnvDto, QueryResultDto, QueryRowDto } from '../../ipc/queries';
import type { TaskRowDto, TypeDto } from '../../ipc/types';
import { CardMenu, type MoveTarget } from '../../tasks/CardMenu';
import { shortDate } from '../../tasks/views';
import { carriesStates } from '../../views/model';
import { queryEnv, nowIso } from '../env';
import { bounds as boundsOf, dayHeading, dropFor, laneLabelKey, neighbourTarget, targets, type Target } from './period';
import { Board, type BoardLaneView } from '../../board/Board';
import { PopupMenu, type MenuEntry } from '../../shell/Menu';
import { lastFocused } from '../../views/actions';
import { foldedOf, setFolded } from '../../views/uiState';
import { queryAlert } from '../editorHost';
import { announceView, ensureViewsLive } from '../../views/live';
import { queryNav } from '../nav';
import { BoardCard, type TaskCardContext } from './BoardCard';
import { cardMove, excludedValues, laneOrderAfterDrop, neighbourDropLane, prefillFor } from './model';
import { writeCardChange, writeCardMove, writePeriodMove, type CardMoveResult } from './write';
import type { PeriodMove } from '@tegg/doc';

const nfc = (s: string) => s.normalize('NFC');
const fold = (s: string) => nfc(s).toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').normalize('NFC');

/** What the page or block hands the palette (§4.7). */
export type BoardControl = {
  status(): { lanes: 'vertical' | 'horizontal'; laneOrder: boolean; cardFocused: boolean; laneFocused: boolean; taskFocused: boolean };
  run(id: string): boolean;
};

/** The toolbar's narrowing (D-1796): folded title text and every chosen tag key. */
export type BoardFilter = { text: string; tags: string[] };

/** The card a board should focus when it shows again (Back after ⏎ on a card, R191). */
let returnTo: { name: string | null; key: string; lane: string } | null = null;

// ------------------------------------------------------------------ `__TEGG_TEST__.board()` (contract §5)

type Snapshot = { name: string | null; lanes: { id: string; cards: string[]; days: { date: string; cards: string[] }[]; folded: boolean }[]; domCards: number };
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

export function QueryBoard({ result, name, title, readOnly, types, filter, apply, rerun, controlRef, foldKey = null, env: runEnv }: {
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
  /** Slice Q2.1 (R198): the usage key its folds are kept under (null: in memory). */
  foldKey?: string | null;
  /** Slice Q2.1 (D-1844): kept for callers; a board never reads `columns` (Q2-T, D-1891). */
  columns?: string[];
  /** Q2-T (§29.3): the environment the shown result was run with (drops and tiles use its bounds). */
  env?: QueryEnvDto | null;
}) {
  const { group, def } = result;
  const env = runEnv ?? queryEnv();
  const isPeriod = group.kind === 'period';
  const b = useMemo(() => boundsOf({ today: env.today, weekStart: env.weekStart }), [env.today, env.weekStart]);
  const isTaskDue = isPeriod && nfc(group.key) === 'due' && def.types.length > 0 && def.types.every((x) => nfc(x) === 'task');
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
      const lane = (id: string) => (id.startsWith('day:')
        ? group.lanes.some((l) => l.days.some((d) => `day:${d.date}` === id && d.cards.some((c) => nfc(result.rows[c.row]?.path ?? '') === m.key)))
        : group.lanes.find((l) => l.id === id)?.cards.some((c) => nfc(result.rows[c.row]?.path ?? '') === m.key) ?? false);
      return !(lane(m.to) || (!m.alt && !lane(m.from)));
    }));
  }, [result]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- folds (R190, R198): a usage keeps them in the UI state under its key, inline fences in memory.
  // Q2-T (§29.4): lanes the done lane folds at first (the done lane; on a board by status, the limited Done lanes);
  // `!<id>` records that the user unfolded one of them.
  const [stored, setStored] = useState<string[]>(() => (foldKey ? foldedOf(foldKey) : []));
  const initially = new Set(def.doneLane?.folded ? group.lanes.filter((l) => l.kind === 'done' || (l.kind === 'option' && l.doneWithin !== null)).map((l) => l.id) : []);
  const folded = group.lanes.map((l) => l.id).filter((id) => (initially.has(id) ? !stored.includes(`!${id}`) : stored.includes(id)));
  const onFold = (id: string, every: boolean) => {
    const all = group.lanes.map((l) => l.id);
    const next = every ? (folded.includes(id) ? [] : all) : folded.includes(id) ? folded.filter((x) => x !== id) : [...folded, id];
    const keep = stored.filter((x) => !all.includes(x.replace(/^!/, '')));
    const entries = [...keep, ...all.flatMap((x) => (initially.has(x) ? (next.includes(x) ? [] : [`!${x}`]) : next.includes(x) ? [x] : []))];
    setStored(entries);
    if (foldKey) setFolded(foldKey, entries);
  };

  // ---- the lanes as shown: narrowed by the toolbar's filters, with the optimistic moves applied.
  const q = filter ? fold(filter.text.trim()) : '';
  const keep = (r: QueryRowDto | undefined) => {
    if (!r) return false;
    if (q && !fold(r.title).includes(q)) return false;
    if (filter?.tags.length) {
      // Q2-T (§24.1): the row's tag keys (frontmatter and inline), NFC and case-folded.
      const keys = (r.tags ?? (Array.isArray(r.values.tags) ? r.values.tags : [])).map((x) => nfc(String(x)).replace(/^#/, '').toLowerCase());
      if (!filter.tags.every((k) => keys.includes(nfc(k).toLowerCase()))) return false;
    }
    return true;
  };
  const listFormat = (xs: string[]) => { try { return new Intl.ListFormat(catalogLocale(), { type: 'conjunction' }).format(xs); } catch { return xs.join(', '); } };
  const attrName = group.name;
  const labelOf = (l: LaneDto) => {
    if (isPeriod && (l.kind === 'period' || l.kind === 'none')) return t(laneLabelKey(l.id, isTaskDue), { attribute: attrName });
    if (l.kind === 'done') return t('board.done');
    return l.kind === 'none' ? t('board.none', { attribute: attrName }) : l.label;
  };
  /** The shown name of a target: a lane's label or a day group's heading. */
  const targetLabel = (id: string) => (id.startsWith('day:') ? dayHeading(id.slice(4), env.locale) : (() => { const l = laneById(id); return l ? labelOf(l) : id; })());
  const singleType = def.types.length === 1 ? pageType : undefined;
  // CP-28 (D-1920, D-1930): a single-type board counts in the type's words (`3 Books`, `1 Task`); `cards` with several types.
  const countText = (n: number) => (singleType ? t('board.laneCountOf', { count: n, name: singleType.name, plural: singleType.plural }) : t('board.laneCount', { count: n }));
  const pathOf = (row: number) => nfc(result.rows[row]?.path ?? '');
  /** The optimistic moves applied to one list of cards (a lane, or a day group by `dayId`). */
  const withMoves = (cards: string[], laneId: string, dayId: string | null) => {
    let out = cards;
    for (const m of moves) {
      if (m.from === laneId && !m.alt) out = out.filter((k) => k !== m.key);
      if (dayId ? m.to === dayId : m.to === laneId) { if (!out.includes(m.key)) out = [m.key, ...out]; }
    }
    return out;
  };
  const lanesShown: BoardLaneView[] = group.lanes.map((l) => {
    const days = l.days.length ? l.days.map((d) => {
      const id = `day:${d.date}`;
      const cards = withMoves(d.cards.map((c) => pathOf(c.row)).filter((p) => p && keep(rowsByPath.get(p))), l.id, id);
      return { id, date: d.date, label: dayHeading(d.date, env.locale), cards, dropTarget: l.dropTarget, countLabel: countText(cards.length) };
    }) : undefined;
    const cards = days ? days.flatMap((d) => d.cards) : withMoves(l.cards.map((c) => pathOf(c.row)).filter((p) => p && keep(rowsByPath.get(p))), l.id, null);
    const writable = !readOnly;
    const newOk = writable && !!pageType && (isPeriod
      ? l.kind !== 'done' && (l.kind === 'period' || l.kind === 'none')
      : l.dropTarget && !l.excluded && l.value !== null && (l.kind === 'option' || l.kind === 'tag' || l.kind === 'relation'));
    const hint = l.doneWithin !== null ? t(l.kind === 'done' ? 'board.doneHint' : 'board.doneStatusHint', { count: l.doneWithin }) : undefined;
    const tone = isPeriod && l.id === 'period:today' && isTaskDue ? 'danger' as const : isPeriod && l.kind === 'none' ? 'muted' as const : null;
    return {
      id: l.id, kind: l.kind, label: labelOf(l), userLabel: !(l.kind === 'none' || l.kind === 'period' || l.kind === 'done'), color: l.color, cards, excluded: l.excluded,
      excludedText: def.lanes === 'horizontal' ? t('board.excludedLong', { values: listFormat(excludedValues(group)) }) : t('board.excluded'),
      dropTarget: l.dropTarget, grip: (l.dropTarget || l.kind === 'period') && l.kind !== 'none' && l.kind !== 'done',
      newLabel: newOk ? t('board.newIn', { type: pageType!.name, lane: labelOf(l) }) : null,
      days, hint, tone, countLabel: countText(cards.length),
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
    const sel = m.to.startsWith('day:') ? `div[data-day="${CSS.escape(m.to.slice(4))}"]` : `section[data-lane="${CSS.escape(m.to)}"]`;
    const el = root.current?.querySelector(`${sel} article[data-board-card="${CSS.escape(m.key)}"]`);
    if (!el) return;
    marked.current = m.at;
    void ipc.perfTimed('board-card-moved', Math.max(0, performance.now() - m.at)).catch(() => {});
  });

  // ---- the test hook (contract §5).
  const snap = useRef<() => Snapshot>(() => ({ name, lanes: [], domCards: 0 }));
  snap.current = () => ({ name, lanes: lanesShown.map((l) => ({ id: l.id, cards: l.cards, days: (l.days ?? []).map((d) => ({ date: d.date, cards: d.cards })), folded: folded.includes(l.id) && def.lanes === 'horizontal' })),
    domCards: root.current?.querySelectorAll('article[data-board-card]').length ?? 0 });
  useEffect(() => {
    ensureViewsLive();
    installHook();
    const f = () => snap.current();
    mounted.add(f);
    return () => { mounted.delete(f); };
  }, []);

  // ---- the focus to restore (Back, a moved card) and the one the palette's commands act on.
  const [focusRequest, setFocusRequest] = useState<{ key: string; laneId: string | null; n: number; keepScroll?: boolean } | null>(() => {
    const r = returnTo;
    // Back to the board (§29.1): the card gets the focus, the page keeps the scroll position Back restores.
    if (r && r.name === name) { returnTo = null; return { key: r.key, laneId: r.lane, n: 1, keepScroll: true }; }
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
  const typeOptions = (typeKey: string) => typeOf(typeKey)?.attributes.find((a) => nfc(a.key) === 'status')?.options ?? [];
  /** The day group a card is in on this board (period boards), else null. */
  const dayOf = (key: string): string | null => {
    for (const l of lanesShown) for (const d of l.days ?? []) if (d.cards.includes(key)) return d.id;
    return null;
  };
  /** Q2-T (§26): what a period drop from `from` (a lane id) onto `to` (a lane or `day:<date>`) writes; null: nothing. */
  const periodMoveFor = (key: string, from: string, to: string): PeriodMove | null => {
    const row = rowsByPath.get(key);
    if (!row || row.readOnly || readOnly || !isPeriod) return null;
    const laneId = to.startsWith('day:') ? 'period:week' : to;
    const target = laneById(laneId);
    if (!target || !target.dropTarget) return null;
    if (to === from || (to.startsWith('day:') && dayOf(key) === to)) return null;
    const opts = typeOptions(row.type);
    if (target.kind === 'done') {
      if (from === 'done') return null;
      const done = opts.find((o) => o.state === 'done');
      return done ? { kind: 'done', status: done.label, now: nowIso(Date.now()) } : null;
    }
    const date = dropFor(laneId, to.startsWith('day:') ? to.slice(4) : null, b);
    if (date === undefined) return null;
    const key2 = nfc(group.key);
    if (from === 'done') {
      const open = opts.find((o) => o.state === 'open');
      return open ? { kind: 'reopen', status: open.label, key: key2, date } : null;
    }
    return { kind: 'set', key: key2, date };
  };
  const moveFor = (key: string, from: string, to: string, alt: boolean) => {
    const row = rowsByPath.get(key);
    if (!row || row.readOnly || readOnly) return null;
    const rowIndex = result.rows.indexOf(row);
    return cardMove(group, rowIndex, from, to, alt && group.kind !== 'select' && !(group.kind === 'relation' && !group.multiple));
  };
  /** Q2-T (§26, D-472): a status move on a `status` that carries states sets or removes `completed`. */
  const statusChange = (row: QueryRowDto, to: LaneDto) => {
    if (nfc(group.key) !== 'status' || group.kind !== 'select' || to.value === null) return null;
    const type = typeOf(row.type);
    if (!carriesStates(type, 'status')) return null;
    const opts = typeOptions(row.type);
    const stateOf = (label: string | null) => (opts.find((o) => o.label === label)?.state ?? 'open') as TaskState;
    const cur = typeof row.values.status === 'string' ? nfc(row.values.status) : null;
    const firstOpen = opts.find((o) => o.state === 'open')?.label ?? opts[0]?.label ?? '';
    return { kind: 'status' as const, to: to.value, toState: stateOf(to.value), fromState: stateOf(cur), firstOpen, now: nowIso(Date.now()) };
  };
  const settle = (key: string, row: QueryRowDto, write: Promise<CardMoveResult>, ok: (r: Extract<CardMoveResult, { outcome: 'written' }>) => void) => {
    void write.then((r) => {
      if (r.outcome === 'written') ok(r);
      else if (r.outcome === 'conflict') {
        setMoves((m) => m.filter((x) => x.key !== key));
        queryAlert(t('board.changedOutside', { title: row.title }));
      } else if (r.outcome === 'failed') {
        setMoves((m) => m.filter((x) => x.key !== key));
        queryAlert(t('query.saveFailed'));
      } else setMoves((m) => m.filter((x) => x.key !== key));
      rerun();
    });
  };
  const doMove = (key: string, from: string, to: string, alt: boolean) => {
    const row = rowsByPath.get(key);
    if (!row) return;
    if (isPeriod) {
      const pm = periodMoveFor(key, from, to);
      if (!pm) return;
      setMoves((m) => [...m, { key, from, to, alt: false, at: performance.now() }]);
      settle(key, row, writePeriodMove(row, pm), () => announceView(t('board.moved', { title: row.title, lane: targetLabel(to) })));
      return;
    }
    const move = moveFor(key, from, to, alt);
    const target = laneById(to);
    if (!move || !target) return;
    const added = move.shape === 'list' && move.remove.length === 0;
    setMoves((m) => [...m, { key, from, to, alt: added, at: performance.now() }]);
    const sc = statusChange(row, target);
    const write = sc ? writeCardChange(row, (text) => applyTaskChange(text, sc)) : writeCardMove(row, move);
    settle(key, row, write, (r) => {
      const lane = labelOf(target);
      const fromNone = laneById(from)?.kind === 'none';
      let text = target.excluded ? t('board.leftView', { title: row.title, lane }) : t((alt || fromNone) && added ? 'board.added' : 'board.moved', { title: row.title, lane });
      // D-478: a tag that is (also) in the body stays; the note names it.
      const src = laneById(from);
      const inlineOnly = group.kind === 'tags' && src?.kind === 'tag' && !alt && move.remove.length === 0;
      if (r.inlineKept) for (const tag of move.remove) text += ` ${t('board.inlineKept', { tag: tag.replace(/^#/, ''), title: row.title })}`;
      else if (inlineOnly && src) text += ` ${t('board.inlineKept', { tag: src.label.replace(/^#/, ''), title: row.title })}`;
      announceView(text);
    });
  };
  const dropLabel = (key: string, from: string, to: string, alt: boolean): string | null => {
    if (isPeriod) {
      const pm = periodMoveFor(key, from, to);
      if (!pm) return null;
      if (pm.kind === 'done') return t('board.dropDone');
      return pm.date === null ? t('board.period.dropClear', { attribute: attrName }) : t('board.period.dropDate', { attribute: attrName, date: shortDate(pm.date, env.locale) });
    }
    const lane = laneById(to);
    if (!lane || !lane.dropTarget) return null;
    const list = group.kind !== 'select' && !(group.kind === 'relation' && !group.multiple);
    const move = moveFor(key, from, to, alt);
    if (!move) return null;
    return alt && list ? t('board.dropAdd', { lane: labelOf(lane) }) : t('board.dropSet', { attribute: attrName, lane: labelOf(lane) });
  };
  /** The targets `Move to ›` offers a card (§29.3): every drop target but its own place. */
  const moveTargets = (key: string, lane: string, also: boolean): MoveTarget[] => {
    if (isPeriod) {
      const here = dayOf(key);
      return targets(group).map((x) => (x.day ? `day:${x.day}` : x.lane))
        .filter((id) => id !== lane && id !== here && periodMoveFor(key, lane, id) !== null)
        .map((id) => ({ id, label: targetLabel(id) }));
    }
    return group.lanes.filter((l) => l.dropTarget && l.id !== lane && !(also && l.cards.some((c) => pathOf(c.row) === key)))
      .map((l) => ({ id: l.id, label: labelOf(l) }));
  };

  // ---- the Task card (§29.5): R43's menu and writes, through the board's queue.
  const taskType = typeOf('task');
  const [taskMenu, setTaskMenu] = useState<{ row: QueryRowDto; anchor: HTMLElement; lane: string; start?: 'status' } | null>(null);
  const taskWrite = (row: QueryRowDto, change: (text: string) => string | null) => {
    settle(nfc(row.path), row, writeCardChange(row, (text) => { const a = change(text); return a === null ? null : { text: a, inlineKept: false }; }), () => {});
  };
  const taskCtx: TaskCardContext | null = result.taskDefs ? {
    defs: result.taskDefs, today: env.today, region: env.locale, zone: env.zone,
    preview: (taskType?.preview ?? ['status', 'priority', 'due']).map(nfc),
    nav: {
      openNote: (p) => open(p, null),
      openSource: (p, task) => queryNav()?.go({ id: 'note/<path>', param: nfc(p), selectEmbedOf: nfc(task) }),
      openDay: (d) => queryNav()?.go({ id: 'daily/YYYY-MM-DD', param: d }),
    },
    onToggle: (row, done) => { const defs = result.taskDefs!; taskWrite(row, (text) => completeTask(text, defs as never, done, nowIso(Date.now()))); },
  } : null;
  const taskStatus = (row: QueryRowDto, label: string) => {
    const defs = result.taskDefs;
    if (!defs) return;
    const stateOf = (l: string | null) => (defs.statuses.find((x) => x.label === l)?.state ?? 'open') as TaskState;
    const firstOpen = defs.statuses.find((x) => x.state === 'open')?.label ?? defs.statuses[0]?.label ?? '';
    taskWrite(row, (text) => applyTaskChange(text, { kind: 'status', to: label, toState: stateOf(label), fromState: stateOf(row.taskRow?.status ?? null), firstOpen, now: nowIso(Date.now()) })?.text ?? null);
  };

  // ---- the card menu: Open, Move to ›, Also add to › (list kinds); the two submenus open beside their item (§20).
  const [menu, setMenu] = useState<{ row: QueryRowDto; anchor: HTMLElement; lane: string } | null>(null);
  const [sub, setSub] = useState<{ level: 'move' | 'also'; anchor: HTMLElement } | null>(null);
  const listKind = group.kind !== 'select' && !(group.kind === 'relation' && !group.multiple);
  const closeMenu = () => { setSub(null); setMenu(null); };
  const why = menu ? readOnly ?? (menu.row.readOnly ? t('task.readOnly') : undefined) : undefined;
  const subEntries = (): MenuEntry[] => {
    if (!menu || !sub) return [];
    const { row, lane } = menu;
    const path = nfc(row.path);
    return moveTargets(path, lane, sub.level === 'also')
      .map((x) => { const l = laneById(x.id); return { kind: 'item', key: x.id, label: x.label, content: <span data-user-content={l && l.kind !== 'none' && l.kind !== 'period' && l.kind !== 'done' ? '' : undefined}>{x.label}</span>,
        disabled: !!why, description: why, onChoose: () => { closeMenu(); doMove(path, lane, x.id, sub.level === 'also'); } } as MenuEntry; });
  };
  const openSub = (level: 'move' | 'also', el: HTMLElement | null) => {
    if (!el || why) return;
    setSub((s) => (s && s.level === level && s.anchor === el ? s : { level, anchor: el }));
  };
  const menuEntries = (): MenuEntry[] => {
    if (!menu) return [];
    const { lane } = menu;
    const path = nfc(menu.row.path);
    const itemEl = (key: string) => document.querySelector<HTMLElement>(`[data-popup="card.menu"] [data-menu-key="${key}"]`);
    return [
      { kind: 'item', key: 'open', label: t('pinned.open'), content: <span className="menu-title">{t('pinned.open')}</span>, onChoose: () => { closeMenu(); open(path, lane); } },
      { kind: 'item', key: 'move', label: t('board.cardMenu.moveTo'), content: <span className="menu-title" data-menu-key="move">{t('board.cardMenu.moveTo')}</span>, disabled: !!why, description: why,
        onChoose: () => openSub('move', itemEl('move')?.closest<HTMLElement>('[role="menuitem"]') ?? null) },
      ...(listKind ? [{ kind: 'item', key: 'also', label: t('board.cardMenu.alsoAdd'), content: <span className="menu-title" data-menu-key="also">{t('board.cardMenu.alsoAdd')}</span>, disabled: !!why, description: why,
        onChoose: () => openSub('also', itemEl('also')?.closest<HTMLElement>('[role="menuitem"]') ?? null) } as MenuEntry] : []),
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
    const movable = group.lanes.filter((l) => l.kind !== 'none' && l.kind !== 'done');
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
    status: () => {
      const c = focusedCard();
      return { lanes: def.lanes, laneOrder: def.laneOrder !== null, cardFocused: !!c, laneFocused: focusedLane() !== null, taskFocused: !!c && !!rowsByPath.get(c.key)?.taskRow && !!taskCtx };
    },
    run: (id) => {
      switch (id) {
        case 'board.switchLanes': if (!readOnly) apply({ lanes: def.lanes === 'vertical' ? 'horizontal' : 'vertical' }); return true;
        case 'board.resetLaneOrder': if (!readOnly && def.laneOrder !== null) apply({ laneOrder: null }); return true;
        case 'task.complete': case 'task.setStatus': {
          const c = focusedCard();
          const row = c ? rowsByPath.get(c.key) : undefined;
          if (!c || !row?.taskRow || !taskCtx) return true;
          if (id === 'task.complete') taskCtx.onToggle(row, row.taskRow.state !== 'done');
          else {
            const el = focusedHere()?.closest<HTMLElement>('article[data-board-card]');
            if (el) setTaskMenu({ row, anchor: el.querySelector<HTMLElement>('[data-command="task.setStatus"]') ?? el, lane: c.lane, start: 'status' });
          }
          return true;
        }
        case 'board.cardNext': case 'board.cardPrevious': {
          const c = focusedCard();
          if (!c) return true;
          if (isPeriod) {
            const day = dayOf(c.key);
            const at: Target = { lane: c.lane, day: day ? day.slice(4) : null };
            const n = neighbourTarget({ lanes: group.lanes.filter((l) => l.dropTarget || l.days.length) }, at, id === 'board.cardNext' ? 1 : -1);
            if (!n) return true;
            const toId = n.day ? `day:${n.day}` : n.lane;
            const from = lanesShown.find((l) => l.id === c.lane);
            after.current = { key: c.key, from: c.lane, index: Math.max(0, from?.cards.indexOf(c.key) ?? 0) };
            doMove(c.key, c.lane, toId, false);
            setFocusRequest((r) => ({ key: c.key, laneId: n.lane, n: (r?.n ?? 0) + 1 }));
            return true;
          }
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
          if (!order) return;
          apply({ laneOrder: order });
          const l = laneById(id);
          if (l) announceView(t('board.laneMoved', { lane: labelOf(l) }));
        }}
        onNew={(laneId) => {
          const pf = prefillFor(def, group, laneId, pageType, b);
          if (pf) queryNav()?.openNew(pf.type, pf.values);
        }}
        onOpen={(key) => open(key, lanesShown.find((l) => l.cards.includes(key))?.id ?? null)}
        newTile={pageType ? t('board.newTile', { type: pageType.name }) : ''}
        focusRequest={focusRequest}
        renderCard={(key, laneId, slot) => {
          const r = row(key);
          if (!r) return null;
          return (
            <BoardCard key={`${laneId}\n${key}`} row={r} laneId={laneId} type={typeOf(r.type)} typeName={typeName(r.type)} group={group} task={taskCtx}
              slot={{ ...slot, onKeyDown: (e) => { if (e.key === 'F10' && e.shiftKey && e.target === e.currentTarget) { e.preventDefault(); setSub(null); if (r.taskRow && taskCtx) setTaskMenu({ row: r, anchor: e.currentTarget, lane: laneId }); else setMenu({ row: r, anchor: e.currentTarget, lane: laneId }); return; } slot.onKeyDown(e); } }}
              onOpen={(p) => open(p, laneId)}
              onMenu={(rr, anchor, lane) => { setSub(null); if (rr.taskRow && taskCtx) setTaskMenu({ row: rr, anchor, lane }); else setMenu({ row: rr, anchor, lane }); }} />
          );
        }} />
      {menu && (
        <PopupMenu label={t('task.more', { title: menu.row.title })} anchor={menu.anchor} entries={menuEntries()} onClose={closeMenu} fit popupId="card.menu"
          keepOpenOn={() => [document.querySelector<HTMLElement>('[data-popup="card.moveTo"], [data-popup="card.alsoAdd"]')]}
          onItemHover={(key, el) => { if (key === 'move' || key === 'also') openSub(key, el); else setSub(null); }}
          onKeyDownExtra={(e, focused) => {
            const key = focused?.querySelector('[data-menu-key]')?.getAttribute('data-menu-key');
            if (e.key === 'ArrowRight' && (key === 'move' || key === 'also')) { e.preventDefault(); openSub(key, focused); return true; }
            return false;
          }} />
      )}
      {taskMenu && taskMenu.row.taskRow && result.taskDefs && (() => {
        const row = taskMenu.row;
        const tr: TaskRowDto = { ...row.taskRow!, readOnly: row.readOnly || row.taskRow!.readOnly };
        const path = nfc(row.path);
        const ro = !!readOnly;
        return (
          <CardMenu key={taskMenu.start ?? 'root'} target={{ row: tr, anchor: taskMenu.anchor, opener: taskMenu.anchor.closest('article') }} defs={result.taskDefs!} start={taskMenu.start}
            moveTo={ro ? undefined : moveTargets(path, taskMenu.lane, false)}
            alsoAddTo={!ro && !isPeriod && group.kind !== 'select' && !(group.kind === 'relation' && !group.multiple) ? moveTargets(path, taskMenu.lane, true) : undefined}
            onClose={() => setTaskMenu(null)}
            actions={{
              open: () => open(path, taskMenu.lane),
              status: (_r, label) => taskStatus(row, label),
              priority: (_r, label) => taskWrite(row, (text) => applyTaskChange(text, { kind: 'priority', to: label })?.text ?? null),
              due: (_r, date) => taskWrite(row, (text) => applyTaskChange(text, { kind: 'due', to: date })?.text ?? null),
              moveTo: (_r, to, also) => doMove(path, taskMenu.lane, to.id, also),
            }} />
        );
      })()}
      {menu && sub && (
        <PopupMenu key={sub.level} label={t(sub.level === 'move' ? 'board.cardMenu.moveTo' : 'board.cardMenu.alsoAdd')} anchor={sub.anchor} entries={subEntries()}
          onClose={() => setSub(null)} fit openerKind="submenu" popupId={sub.level === 'move' ? 'card.moveTo' : 'card.alsoAdd'}
          onKeyDownExtra={(e) => { if (e.key === 'ArrowLeft') { e.preventDefault(); const a = sub.anchor; setSub(null); a.focus(); return true; } return false; }} />
      )}
    </div>
  );
}
