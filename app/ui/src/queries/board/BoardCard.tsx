// Slice Q2: the universal card of a board (docs/contracts/v1-views.md §4.3 Card; R187, D-1793, AP-1509; CardAnatomy as
// the Tasks card R43 without the checkbox): an `article` `<Type>: <title>`, the title link (a reference: previews, opens),
// `More actions for "<title>"`, the tags, the body's first two lines, one pill per `On cards` attribute that isn't a
// relation (`No <attribute>` when empty), the relation values as link chips in the footer. The grouping attribute shows
// only on a multi-value card that has another value (then all its values, D-1769).
import { t } from '../../i18n/catalog';
import type { GroupingDto, QueryRowDto } from '../../ipc/queries';
import type { TypeDto } from '../../ipc/types';
import { RefElement } from '../../preview/useReference';
import { Icon } from '../../shell/Icon';
import { useTagLook } from '../../tags/store';
import { dateText, dateTimeText, rawText, wiki } from '../../types/util';
import type { CardSlotProps } from '../../board/Board';
import { UNIVERSAL } from '../model';

const nfc = (s: string) => s.normalize('NFC');
const isEmpty = (v: unknown) => v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : isEmpty(v) ? [] : [v]);

export function BoardCard({ row, laneId, columns, type, typeName, group, slot, onOpen, onMenu }: {
  row: QueryRowDto;
  laneId: string;
  /** `On cards`: the query's columns (Title excluded). */
  columns: string[];
  type: TypeDto | undefined;
  typeName: string;
  group: GroupingDto;
  slot: CardSlotProps;
  onOpen: (path: string) => void;
  onMenu: (row: QueryRowDto, anchor: HTMLElement, laneId: string) => void;
}) {
  const look = useTagLook();
  const path = nfc(row.path);
  const tags = list(row.values.tags).map((x) => nfc(String(x)).replace(/^#/, ''));
  const gkey = nfc(group.key);
  const pills: { key: string; label: string; values: string[]; empty: boolean }[] = [];
  const chips: { key: string; values: string[] }[] = [];
  const keys = columns.map(nfc).filter((k, i, a) => k !== 'title' && k !== 'type' && a.indexOf(k) === i);
  // D-1769: a multi-value grouping key is on the card when the card has another value too.
  const gvals = list(row.values[gkey]);
  if (gkey !== 'tags' && group.kind !== 'select' && !(group.kind === 'relation' && !group.multiple) && gvals.length >= 2 && !keys.includes(gkey)) keys.push(gkey);
  for (const k of keys) {
    if (k === 'tags') continue; // the tags line
    if (k === gkey && !(gvals.length >= 2 && group.kind !== 'select' && !(group.kind === 'relation' && !group.multiple))) continue;
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
      {pills.length > 0 && (
        <div className="board-card-pills">
          {pills.flatMap((pl) => (pl.empty
            ? [<span key={pl.key} className="card-pill" data-attribute={pl.key} data-empty="">{t('board.none', { attribute: pl.label })}</span>]
            : pl.values.map((v, i) => <span key={`${pl.key}:${i}`} className="card-pill" data-attribute={pl.key} data-user-content>{v}</span>)))}
        </div>
      )}
      {chips.length > 0 && (
        <footer className="board-card-foot">
          {chips.flatMap((c) => c.values.map((v, i) => {
            const w = wiki(v);
            const info = w ? row.links.find((l) => [nfc(w.target), nfc(w.inner), nfc(v)].includes(nfc(l.target))) : undefined;
            const ok = !!info?.path && (info.kind === 'note' || info.kind === 'daily');
            const shown = w?.alias ?? (ok ? info!.title ?? w!.target : w?.target ?? v);
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
      )}
    </article>
  );
}
