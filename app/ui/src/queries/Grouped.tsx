// Slice Q3: grouped Table and List bodies (docs/contracts/v1-views.md §40.1 `Grouped.tsx`, §41.5, §42.1; R225; boards
// Views H1, H2; D-2181…D-2184, D-2194 (d)). The core groups for every display (`QueryResultDto.group`); this draws its
// lanes as groups: only groups with rows (D-2184), in the run's order (`lane_order`, then option order, `No <attribute>`
// last), period groups flat (D-2181), a multi-value row under each of its values (D-1769). A full-width header per group
// (chevron, value: option colour / relation chip / `#tag` / period label, count, grip). Folds per usage key on this Mac
// (`usageFolded`, shared with the usage's wall; ⌥-click folds or unfolds all). A header drag (pointer, > 4 px) writes
// the usage's `lane_order` (`laneOrderForGroupDrop`); `Move lane up` / `down` on a focused header. No row drags between
// groups and no `New <Type>` rows (D-2182, D-2183).
import { useEffect, useRef, useState, type MutableRefObject, type ReactNode } from 'react';
import { t } from '../i18n/catalog';
import type { GroupingDto, QueryDefDto, QueryResultDto, QueryRowDto } from '../ipc/queries';
import type { TypeDto } from '../ipc/types';
import { Icon } from '../shell/Icon';
import { lastFocused } from '../views/actions';
import { groupModel, laneOrderForGroupDrop, type GroupView } from '../views/display';
import { announceView, ensureViewsLive } from '../views/live';
import { foldedOf, setFolded } from '../views/uiState';
import { laneLabelKey } from './board/period';
import { queryNav } from './nav';
import { ResultChip } from './QueryBlock';

const nfc = (s: string) => s.normalize('NFC');

export type GroupItem = { kind: 'header'; g: GroupView } | { kind: 'row'; row: QueryRowDto; g: string };
/** What the palette drives on a grouped Table or List (`board.laneUp` / `board.laneDown`, §42.4). */
export type GroupControl = { focused: () => boolean; move: (dir: 1 | -1) => void };

// ------------------------------------------------------------------ `__TEGG_TEST__.groups()` (§43.1)

const mounted = new Set<() => unknown>();
function installHook() {
  if (typeof window === 'undefined') return;
  const w = window as { __TEGG_TEST__?: Record<string, unknown> };
  if (typeof w.__TEGG_TEST__?.groups === 'function') return;
  w.__TEGG_TEST__ = { ...(w.__TEGG_TEST__ ?? {}), groups: () => [...mounted].map((f) => f()) };
}

export type Grouped = {
  /** The shown groups (with ≥ 1 kept row), each with its kept rows' indices. */
  groups: GroupView[];
  folded: Set<string>;
  /** Headers and the rows of unfolded groups, flat, in order (a Table windows over them). */
  items: GroupItem[];
  /** A header's parts (chevron, value, count, grip). */
  parts: (g: GroupView) => ReactNode;
  /** A header element's attributes (class, ids, drop indicator). */
  attrs: (g: GroupView) => Record<string, string | undefined>;
  rootRef: MutableRefObject<HTMLElement | null>;
};

export function useGrouped({ on, result, def, keep, foldKey, display, types, grips, disabled, onLaneOrder, controlRef }: {
  /** Draw groups (a grouped Table or List); off: nothing is computed or registered. */
  on: boolean;
  result: QueryResultDto | null;
  /** The effective def (the query file's `done_lane`, the usage's lanes and lane order). */
  def: QueryDefDto | null;
  /** The toolbar's narrowing (title text, tags); rows it drops leave their groups. */
  keep?: (r: QueryRowDto) => boolean;
  /** The usage key folds are kept under (null: in memory, an inline fence). */
  foldKey: string | null;
  display: 'table' | 'list';
  types: TypeDto[];
  /** Header grips (not on `All <plural>`). */
  grips: boolean;
  /** Why the usage can't be written (grips `aria-disabled`), else null. */
  disabled: string | null;
  onLaneOrder: (order: string[]) => void;
  controlRef?: MutableRefObject<GroupControl | null>;
}): Grouped {
  const group: GroupingDto | null = on && result?.group ? result.group : null;
  const rootRef = useRef<HTMLElement | null>(null);
  const [stored, setStored] = useState<string[]>(() => (foldKey ? foldedOf(foldKey) : []));
  const lastKey = useRef(foldKey);
  if (lastKey.current !== foldKey) { lastKey.current = foldKey; setStored(foldKey ? foldedOf(foldKey) : []); }
  const [drag, setDrag] = useState<{ id: string; over: { id: string; before: boolean } | null } | null>(null);

  const rows = result?.rows ?? [];
  const all: GroupView[] = group && result ? groupModel(result, display) : [];
  const groups = all.map((g) => {
    const kept = keep ? g.rows.filter((i) => rows[i] && keep(rows[i]!)) : g.rows;
    return { ...g, rows: kept, count: kept.length };
  }).filter((g) => g.count > 0);
  const laneIds = group ? group.lanes.map((l) => nfc(l.id)) : [];
  // Q2-T (§29.4, D-2188): the done lane (and a board by status's limited Done lanes) folds at first; `!<id>` records
  // that the user unfolded one of them. One list per usage, shared with its wall.
  const initially = new Set(def?.doneLane?.folded && group ? group.lanes.filter((l) => l.kind === 'done' || (l.kind === 'option' && l.doneWithin !== null)).map((l) => nfc(l.id)) : []);
  const folded = new Set(laneIds.filter((id) => (initially.has(id) ? !stored.includes(`!${id}`) : stored.includes(id))));
  const onFold = (id: string, every: boolean) => {
    const cur = [...folded];
    const next = every ? (groups.some((g) => !folded.has(g.id)) ? laneIds : []) : folded.has(id) ? cur.filter((x) => x !== id) : [...cur, id];
    const keepOther = stored.filter((x) => !laneIds.includes(x.replace(/^!/, '')));
    const entries = [...keepOther, ...laneIds.flatMap((x) => (initially.has(x) ? (next.includes(x) ? [] : [`!${x}`]) : next.includes(x) ? [x] : []))];
    setStored(entries);
    if (foldKey) setFolded(foldKey, entries);
  };

  // ---- labels and counts (part one's lane words; R203's period labels).
  const isPeriod = group?.kind === 'period';
  const isTaskDue = isPeriod && !!def && nfc(group!.key) === 'due' && def.types.length > 0 && def.types.every((x) => nfc(x) === 'task');
  const single = def && def.types.length === 1 ? types.find((x) => nfc(x.key) === nfc(def.types[0]!)) : undefined;
  const labelOf = (g: GroupView) => {
    const attribute = group?.name ?? '';
    if (isPeriod && (g.kind === 'period' || g.kind === 'none')) return t(laneLabelKey(g.id, isTaskDue), { attribute });
    if (g.kind === 'done') return t('board.done');
    if (g.kind === 'none') return t('board.none', { attribute });
    return g.label;
  };
  const countText = (n: number) => (single ? t('board.laneCountOf', { count: n, name: single.name, plural: single.plural }) : t('board.laneCount', { count: n }));

  // ---- header drags (§41.5): a drop on a header goes before that group, on a group's rows after it.
  const canDrag = grips && !disabled;
  const dropAt = (x: number, y: number, from: string): { id: string; before: boolean } | null => {
    const el = document.elementFromPoint(x, y) as HTMLElement | null;
    const root = rootRef.current;
    if (!el || !root || !root.contains(el)) return null;
    const head = el.closest<HTMLElement>('.group-header[data-group-id]');
    const id = nfc((head ?? el.closest<HTMLElement>('[data-group-id]'))?.getAttribute('data-group-id') ?? '');
    if (!id || !groups.some((g) => g.id === id)) return null;
    const g = groups.find((x) => x.id === id)!;
    // Nothing drops after `No <attribute>` or `Done`: a drop there goes after the last movable group.
    if (!g.grip) return { id, before: true };
    if (id === from) return { id, before: true };
    return { id, before: !!head };
  };
  const beforeIdOf = (over: { id: string; before: boolean }): string | null => {
    if (!group) return null;
    const g = groups.find((x) => x.id === over.id);
    if (g && !g.grip) return null;
    if (over.before) return over.id;
    const i = laneIds.indexOf(over.id);
    return i >= 0 && i + 1 < laneIds.length ? laneIds[i + 1]! : null;
  };
  const drop = (id: string, over: { id: string; before: boolean } | null) => {
    if (!group || !over || !canDrag) return;
    const order = laneOrderForGroupDrop(group, id, beforeIdOf(over));
    if (!order) return;
    onLaneOrder(order);
    const g = groups.find((x) => x.id === id);
    ensureViewsLive();
    announceView(t('group.moved', { group: g ? labelOf(g) : id }));
  };
  const startDrag = (id: string) => (e: React.MouseEvent) => {
    if (e.button !== 0 || !canDrag) return;
    e.preventDefault();
    const x0 = e.clientX;
    const y0 = e.clientY;
    let active = false;
    let over: { id: string; before: boolean } | null = null;
    const move = (ev: MouseEvent) => {
      if (!active && Math.hypot(ev.clientX - x0, ev.clientY - y0) <= 4) return;
      active = true;
      over = dropAt(ev.clientX, ev.clientY, id);
      setDrag({ id, over });
    };
    const up = (ev: MouseEvent) => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up, true);
      window.removeEventListener('keydown', esc, true);
      setDrag(null);
      if (!active) return;
      over = dropAt(ev.clientX, ev.clientY, id) ?? over;
      drop(id, over);
    };
    const esc = (ev: KeyboardEvent) => {
      if (ev.key !== 'Escape') return;
      ev.preventDefault();
      active = false;
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up, true);
      window.removeEventListener('keydown', esc, true);
      setDrag(null);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up, true);
    window.addEventListener('keydown', esc, true);
  };

  // ---- `Move lane up` / `down` on a focused header (D-2194 (d)).
  const focusedGroup = () => {
    const el = lastFocused();
    const root = rootRef.current;
    if (!el || !root || !root.contains(el)) return null;
    const id = el.closest<HTMLElement>('.group-header[data-group-id]')?.getAttribute('data-group-id');
    return id ? nfc(id) : null;
  };
  const control: GroupControl = {
    focused: () => focusedGroup() !== null,
    move: (dir) => {
      const id = focusedGroup();
      if (!id || !group || !canDrag) return;
      const movable = group.lanes.filter((l) => l.kind !== 'none' && l.kind !== 'done').map((l) => nfc(l.id));
      const i = movable.indexOf(id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= movable.length) return;
      const before = dir < 0 ? movable[j]! : movable[j + 1] ?? null;
      const order = laneOrderForGroupDrop(group, id, before);
      if (!order) return;
      onLaneOrder(order);
      const g = groups.find((x) => x.id === id);
      ensureViewsLive();
      announceView(t('group.moved', { group: g ? labelOf(g) : id }));
    },
  };
  if (controlRef) controlRef.current = group ? control : null;

  // ---- the test hook.
  const snap = useRef<() => unknown>(() => null);
  snap.current = () => ({
    usageKey: foldKey ?? '', display,
    groups: groups.map((g) => ({ id: g.id, count: g.count, folded: folded.has(g.id), rows: g.rows.map((i) => nfc(rows[i]?.path ?? '')) })),
    domRows: rootRef.current ? rootRef.current.querySelectorAll(display === 'table' ? 'tr[data-query-result]' : 'li.query-group-row').length : 0,
  });
  useEffect(() => {
    if (!group) return;
    installHook();
    const f = () => snap.current();
    mounted.add(f);
    return () => { mounted.delete(f); };
  }, [!!group]); // eslint-disable-line react-hooks/exhaustive-deps

  const items: GroupItem[] = [];
  for (const g of groups) {
    items.push({ kind: 'header', g });
    if (!folded.has(g.id)) for (const i of g.rows) items.push({ kind: 'row', row: rows[i]!, g: g.id });
  }

  const value = (g: GroupView, label: string): ReactNode => {
    if (g.kind === 'relation' && g.target) {
      const target = g.target;
      return (
        <a href="#" tabIndex={0} className="chip link-chip kind-note group-value" data-link-kind="note" data-path={target} title={label}
          onClick={(e) => { e.preventDefault(); queryNav()?.openNote(target); }}>
          <Icon name="file" size={13} /><span className="chip-text"><span data-user-content>{label}</span></span>
        </a>
      );
    }
    if (g.kind === 'tag') return <span className="group-value group-tag" data-user-content>{`#${label.replace(/^#/, '')}`}</span>;
    const colored = (g.kind === 'option' || g.kind === 'done') && g.color;
    const user = !(g.kind === 'none' || g.kind === 'period' || g.kind === 'done');
    return (
      <span className="group-value" data-color={colored ? g.color! : undefined} style={colored ? { color: `var(--type-${g.color})` } : undefined}>
        <span data-user-content={user ? '' : undefined}>{label}</span>
      </span>
    );
  };
  const parts = (g: GroupView) => {
    const label = labelOf(g);
    const isFolded = folded.has(g.id);
    return (
      <>
        <button type="button" tabIndex={0} className="icon-button small group-chevron" aria-expanded={!isFolded}
          aria-label={t('a11y.nameCount', { name: label, count: countText(g.count) })} data-command="group.toggle"
          onClick={(e) => onFold(g.id, e.altKey)}>
          <Icon name={isFolded ? 'chevron-right' : 'chevron-down'} size={13} />
        </button>
        {value(g, label)}
        <span className="count" aria-hidden="true">{g.count}</span>
        {grips && g.grip && (
          <span role="button" tabIndex={0} className="group-grip" data-command="group.drag" aria-label={t('group.drag')} title={t('group.drag')}
            aria-disabled={disabled ? 'true' : undefined} aria-description={disabled ?? undefined}
            onMouseDown={startDrag(g.id)} onDragStart={(e) => e.preventDefault()}>
            <Icon name="grip" size={13} />
          </span>
        )}
      </>
    );
  };
  const attrs = (g: GroupView): Record<string, string | undefined> => {
    const over = drag?.over && drag.over.id === g.id && drag.id !== g.id ? (drag.over.before ? 'before' : 'after') : null;
    return {
      className: ['group-header', over ? `group-drop-${over}` : '', drag?.id === g.id ? 'group-dragging' : ''].filter(Boolean).join(' '),
      'data-group-id': g.id, 'data-lane-kind': g.kind, 'data-folded': folded.has(g.id) ? '' : undefined,
    };
  };
  return { groups, folded, items, parts, attrs, rootRef };
}

/** A grouped List (§42.1): per group a `div[role=group]` labelled by its header, the rows as R141's chips. */
export function GroupedList({ grouped, title }: { grouped: Grouped; title: string }) {
  return (
    <div className="query-grouped-list" aria-label={title} ref={(el) => { grouped.rootRef.current = el; }}>
      {grouped.groups.map((g) => {
        const hid = `group-${g.id.replace(/[^\p{L}\p{N}_-]/gu, '_')}-${Math.abs(hash(g.id))}`;
        const { className, ...rest } = grouped.attrs(g);
        return (
          <div key={g.id} role="group" data-group-id={g.id} aria-labelledby={hid} className="query-group">
            <div id={hid} className={className} {...rest}>{grouped.parts(g)}</div>
            {!grouped.folded.has(g.id) && (
              <ul className="query-list view-list">
                {grouped.items.filter((x): x is Extract<GroupItem, { kind: 'row' }> => x.kind === 'row' && x.g === g.id).map((x) => (
                  <li key={x.row.path} className="query-group-row"><ResultChip row={x.row} onOpen={(p) => queryNav()?.openNote(p)} /></li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
}

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}
