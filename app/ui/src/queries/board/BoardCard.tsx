// Slice Q2: the universal card of a board (docs/contracts/v1-views.md §4.3 Card; R187, D-1793, AP-1509; CardAnatomy as
// the Tasks card R43 without the checkbox): an `article` `<Type>: <title>`, the title link (a reference: previews, opens),
// `More actions for "<title>"`, the tags, the body's first two lines, one pill per Preview property that isn't a
// relation (`No <attribute>` when empty), the relation values as link chips in the footer. The grouping attribute shows
// only on a multi-value card that has another value (then all its values, D-1769) and on a period board (R203).
// Slice Q2-T (§28.2, §29.5; D-1891, D-1904, D-1910): the keys are the card's own type's `preview` (at most 4), never the
// query's `columns`; a Task row is the R43 card (`tasks/TaskCard.tsx`); relation chips resolve from `row.links` for every
// value whatever the lane (F3).
import { t } from '../../i18n/catalog';
import type { ReactNode } from 'react';
import type { GroupingDto, QueryRowDto } from '../../ipc/queries';
import type { LinkTargetDto, TaskDefsDto, TypeDto } from '../../ipc/types';
import { TaskCard, type TaskNav } from '../../tasks/TaskCard';
import { RefElement } from '../../preview/useReference';
import { Icon } from '../../shell/Icon';
import { useTagLook } from '../../tags/store';
import { dateText, dateTimeText, rawText, wiki } from '../../types/util';
import type { CardSlotProps } from '../../board/Board';
import { UNIVERSAL } from '../model';

const nfc = (s: string) => s.normalize('NFC');
const isEmpty = (v: unknown) => v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : isEmpty(v) ? [] : [v]);
/** At most this many Preview properties on a card (D-1240). */
const MAX_PREVIEW = 4;

/** The link a relation value names, from the row's own links (F3: every value, whatever lane the card is drawn in). */
export function linkOf(links: readonly LinkTargetDto[], v: string): LinkTargetDto | undefined {
  const w = wiki(v);
  const names = new Set([v, ...(w ? [w.target, w.inner] : [])].map((x) => nfc(String(x)).trim()));
  const lower = new Set([...names].map((x) => x.toLowerCase()));
  return links.find((l) => names.has(nfc(l.target).trim())) ?? links.find((l) => lower.has(nfc(l.target).trim().toLowerCase()));
}

/** What a Task card on a board needs (§29.5): the result's Task definitions and the run's date and region. */
export type TaskCardContext = {
  defs: TaskDefsDto; today: string; region: string; zone?: string; nav: TaskNav;
  preview: string[];
  onToggle: (row: QueryRowDto, done: boolean) => void;
};

export function BoardCard({ row, laneId, type, typeName, group, slot, onOpen, onMenu, task }: {
  row: QueryRowDto;
  laneId: string;
  type: TypeDto | undefined;
  typeName: string;
  group: GroupingDto;
  slot: CardSlotProps;
  onOpen: (path: string) => void;
  onMenu: (row: QueryRowDto, anchor: HTMLElement, laneId: string) => void;
  /** Q2-T: a Task row with its `taskRow` is drawn as the R43 card. */
  task?: TaskCardContext | null;
}) {
  const look = useTagLook();
  const path = nfc(row.path);
  const tags = list(row.values.tags).map((x) => nfc(String(x)).replace(/^#/, ''));
  const gkey = nfc(group.key);
  const pills: { key: string; label: string; values: string[]; empty: boolean }[] = [];
  const chips: { key: string; values: string[] }[] = [];
  const isTask = !!task && !!row.taskRow;
  const period = group.kind === 'period';
  // D-1769: a card placed by two or more values of the grouping key (a multi-value kind, or a single relation written as
  // a list, F3) shows all of them.
  const multi = group.kind !== 'select' && !period;
  const keys = (type?.preview ?? []).map(nfc).filter((k, i, a) => k !== 'title' && k !== 'type' && a.indexOf(k) === i).slice(0, MAX_PREVIEW);
  // D-1769: a multi-value grouping key is on the card when the card has another value too.
  const gvals = list(row.values[gkey]);
  if (gkey !== 'tags' && multi && gvals.length >= 2 && !keys.includes(gkey)) keys.push(gkey);
  for (const k of keys) {
    if (k === 'tags') continue; // the tags line
    if (isTask && (k === 'status' || k === 'priority' || k === 'due')) continue; // the Task card's own chips
    if (!period && k === gkey && !(gvals.length >= 2 && multi)) continue;
    const a = type?.attributes.find((x) => nfc(x.key) === k);
    const label = a ? a.name : k === 'modified' ? t('typePage.modified') : t(UNIVERSAL.find((u) => u.key === k)?.label ?? k);
    const v = k === 'modified' ? row.modified : k === 'created' ? row.created : row.values[k];
    if (a?.type === 'relation' || k === 'source') {
      const vs = list(v).map((x) => String(x));
      if (vs.length) chips.push({ key: k, values: vs });
      else pills.push({ key: k, label, values: [], empty: true });
      continue;
    }
    if (isEmpty(v)) { pills.push({ key: k, label, values: [], empty: true }); continue; }
    const text = (x: unknown) => (a?.type === 'date' ? dateText(x) : a?.type === 'date-time' || k === 'modified' || k === 'created' ? dateTimeText(x)
      : a?.type === 'checkbox' ? t(x === true ? 'panel.checked' : 'panel.unchecked') : rawText(x));
    pills.push({ key: k, label, values: Array.isArray(v) ? v.map(text) : [text(v)], empty: false });
  }
  const pillsEl: ReactNode = pills.length > 0 ? (
    <div className="board-card-pills">
      {pills.flatMap((pl) => (pl.empty
        ? [<span key={pl.key} className="card-pill" data-attribute={pl.key} data-empty="">{t('board.none', { attribute: pl.label })}</span>]
        : pl.values.map((v, i) => <span key={`${pl.key}:${i}`} className="card-pill" data-attribute={pl.key} data-user-content>{v}</span>)))}
    </div>
  ) : null;
  const chipsEl: ReactNode = chips.length > 0 ? (
    <footer className="board-card-foot">
      {chips.flatMap((c) => c.values.map((v, i) => {
        const w = wiki(v);
        const info = linkOf(row.links, v);
        const ok = !!info?.path && (info.kind === 'note' || info.kind === 'daily');
        const shown = w?.alias ?? (ok ? info!.title ?? w?.target ?? v : w?.target ?? v);
        return (
          <a key={`${c.key}:${i}`} href="#" tabIndex={-1} className={`chip link-chip ${ok ? 'kind-note' : 'kind-unresolved'}`} data-attribute={c.key}
            data-link-kind={ok ? info!.kind : 'unresolved'}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); if (ok) onOpen(info!.path!); }}>
            <span data-user-content>{shown}</span>
          </a>
        );
      }))}
    </footer>
  ) : null;
  if (isTask && task && row.taskRow) {
    const tr = { ...row.taskRow, readOnly: row.readOnly || row.taskRow.readOnly };
    return (
      <TaskCard row={tr} defs={task.defs} today={task.today} region={task.region} zone={task.zone} nav={task.nav}
        preview={task.preview} hideKey={period ? null : gkey} typeName={typeName} slot={slot}
        pills={<>{pillsEl}{chipsEl}</>}
        onToggle={(_r, done) => task.onToggle(row, done)}
        onMenu={(_r, anchor) => onMenu(row, anchor, laneId)} />
    );
  }
  const { dragging, ...rest } = slot;
  return (
    <article {...rest} className={`board-card${dragging ? ' dragging' : ''}`} aria-label={t('board.card', { type: typeName, title: row.title })}
      data-board-card={path} data-path={path} data-read-only={row.readOnly ? '' : undefined}>
      <div className="board-card-head">
        <RefElement as="a" reference={{ target: { path, fragment: null, kind: 'note' }, kind: 'card', open: () => onOpen(path) }}
          href="#" tabIndex={-1} draggable={false} data-card-title="" className="board-card-title"
          onClick={(e: React.MouseEvent) => { e.preventDefault(); e.stopPropagation(); }}>
          <span data-user-content>{row.title}</span>
        </RefElement>
        <button type="button" tabIndex={-1} className="icon-button small board-card-more" aria-label={t('task.more', { title: row.title })} aria-haspopup="menu"
          onClick={(e) => { e.stopPropagation(); onMenu(row, e.currentTarget, laneId); }}>
          <Icon name="more-horizontal" size={14} />
        </button>
      </div>
      {tags.length > 0 && (
        <div className="board-card-tags">
          {tags.map((x) => <span key={x} className="card-tag" data-user-content>#{look(x).name}</span>)}
        </div>
      )}
      {row.excerpt && <p className="card-excerpt" data-user-content>{row.excerpt}</p>}
      {pillsEl}
      {chipsEl}
    </article>
  );
}
