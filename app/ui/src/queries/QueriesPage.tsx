// Slice Q (queries.md R143 `queries`, FR-QRY-06 AC-1…AC-3, AC-20; board QueriesAll): every saved query of the vault, a
// find field (title match: NFC, case and diacritics folded), the machine-local sort (D-1485), `New query`, and each
// row's `Query actions`. Viewing writes nothing.
import { useEffect, useRef, useState, type RefObject } from 'react';
import { t } from '../i18n/catalog';
import { collator } from '../i18n/collate';
import { formatDate, dateTimeSetting } from '../i18n/dates';
import type { QuerySummaryDto } from '../ipc/queries';
import { Icon } from '../shell/Icon';
import { PopupMenu } from '../shell/Menu';
import { pinDragSource } from '../pinned/drag';
import { localDate } from '../zone';
import { openNameDialog } from './dialogs';
import { QueryMenu, useUndoQueryRename } from './QueryMenu';
import { SORTS, SORT_LABEL, refreshQueries, useQueries, type QueriesSort } from './store';
import './pages.css';

export type QueriesPageProps = {
  heading: RefObject<HTMLHeadingElement | null>;
  /** The machine-local sort (`ui-state.json` `queries.sort`, D-1485); missing → `created-desc`. */
  sort: QueriesSort | undefined;
  onSort: (s: QueriesSort) => void;
  onOpen: (name: string) => void;
};

const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().normalize('NFC');
/** The find text, kept for the session so Back to `queries` shows it again (FR-QRY-06 AC-4). */
let lastFind = '';

const instant = (s: string | null) => { const ms = s ? Date.parse(s) : NaN; return Number.isNaN(ms) ? -Infinity : ms; };

/** R143's order: the chosen sort over readable queries (ties by title), unreadable ones last by name. */
export function sortQueries(list: QuerySummaryDto[], sort: QueriesSort): QuerySummaryDto[] {
  const coll = collator();
  const byTitle = (a: QuerySummaryDto, b: QuerySummaryDto) => coll.compare(a.title, b.title) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  const ok = list.filter((q) => q.state !== 'unreadable');
  const bad = list.filter((q) => q.state === 'unreadable').sort((a, b) => coll.compare(a.name, b.name));
  let out: QuerySummaryDto[];
  if (sort === 'title') out = [...ok].sort(byTitle);
  else {
    const key = sort.startsWith('created') ? 'created' : 'modified';
    const desc = [...ok].sort((a, b) => instant(b[key]) - instant(a[key]) || byTitle(a, b));
    out = sort.endsWith('asc') ? desc.reverse() : desc;
  }
  return [...out, ...bad];
}

/** A row's date: the local day of the instant, in the Date & time setting (D-781). */
export function dayText(iso: string | null): string {
  const ms = iso ? Date.parse(iso) : NaN;
  return Number.isNaN(ms) ? '' : formatDate(localDate(ms), dateTimeSetting());
}

export function QueriesPage({ heading, sort: sort0, onSort, onOpen }: QueriesPageProps) {
  const list = useQueries();
  useEffect(() => { void refreshQueries(); }, []);
  useUndoQueryRename();
  const sort = sort0 && SORTS.includes(sort0) ? sort0 : 'created-desc';
  const [find, setFind0] = useState(lastFind);
  const setFind = (v: string) => { lastFind = v; setFind0(v); };
  const [sortMenu, setSortMenu] = useState(false);
  const [rowMenu, setRowMenu] = useState<{ q: QuerySummaryDto; anchor: HTMLElement } | null>(null);
  const sortBtn = useRef<HTMLButtonElement | null>(null);
  const newBtn = useRef<HTMLButtonElement | null>(null);
  // One row per name (NFC): a copy whose file name is the same name in NFD is the same query (FR-FMT-12 AC-9).
  const all = (list ?? []).filter((q, i, l) => l.findIndex((x) => x.name.normalize('NFC') === q.name.normalize('NFC')) === i);
  const f = fold(find.trim());
  const rows = sortQueries(all, sort).filter((q) => !f || fold(q.state === 'unreadable' ? q.name : q.title).includes(f));
  const header = (col: 'created' | 'updated') => {
    const on = sort === `${col}-desc` ? 'descending' : sort === `${col}-asc` ? 'ascending' : 'none';
    const by = () => onSort(on === 'descending' ? `${col}-asc` : `${col}-desc`);
    return (
      <th role="columnheader" tabIndex={0} aria-sort={on} className={on !== 'none' ? 'sorted' : ''}
        onClick={by} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); by(); } }}>
        {t(col === 'created' ? 'queries.col.created' : 'queries.col.updated')}{on === 'none' ? '' : on === 'descending' ? ' ↓' : ' ↑'}
      </th>
    );
  };
  const openMenu = (q: QuerySummaryDto, anchor: HTMLElement) => setRowMenu({ q, anchor });
  return (
    <div className="page-column queries-page">
      <header className="page-header query-page-header">
        <span className="query-tile" aria-hidden="true"><Icon name="query" size={22} /></span>
        <div className="type-header-text">
          <h1 ref={heading} tabIndex={-1}>{t('queries.title')}</h1>
          <p className="type-count">{t('queries.count', { count: all.length })}</p>
        </div>
      </header>
      <div className="page-toolbar type-toolbar queries-toolbar">
        <input type="search" className="type-filter queries-find" aria-label={t('queries.find')} placeholder={t('queries.find')} value={find}
          spellCheck={false} autoComplete="off" onChange={(e) => setFind(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Escape' && find) { e.preventDefault(); e.stopPropagation(); setFind(''); } }} />
        <span className="spacer" />
        <button ref={sortBtn} tabIndex={0} type="button" className="text-button" data-command="queries.sort" aria-haspopup="menu" aria-expanded={sortMenu}
          onClick={() => setSortMenu((m) => !m)}>
          {t(SORT_LABEL[sort])}
        </button>
        <button ref={newBtn} tabIndex={0} type="button" className="text-button primary" data-command="queries.new"
          onClick={() => openNameDialog({ kind: 'new', returnFocus: newBtn.current })}>
          <Icon name="plus" size={14} />{t('queries.new')}
        </button>
      </div>
      {list && all.length === 0 && <p className="empty">{t('queries.empty')}</p>}
      {all.length > 0 && (
        <div className="table-scroll">
          <table className="type-table queries-table" aria-label={t('queries.title')}>
            <thead>
              <tr>
                <th role="columnheader" className="queries-col-title">{t('queries.col.query')}</th>
                {header('created')}
                {header('updated')}
                <th role="columnheader" className="queries-col-menu" aria-hidden="true" />
              </tr>
            </thead>
            <tbody>
              {rows.map((q) => {
                const bad = q.state === 'unreadable';
                return (
                  <tr key={q.name} className="type-row query-row" data-query-row={q.name} data-query-state={q.state} tabIndex={0}
                    {...pinDragSource({ request: { kind: 'query', name: q.name }, label: q.title, icon: 'query' })}
                    onClick={(e) => { if (!(e.target as HTMLElement).closest('button')) onOpen(q.name); }}
                    onContextMenu={(e) => { e.preventDefault(); openMenu(q, e.currentTarget); }}
                    onKeyDown={(e) => {
                      if (e.target !== e.currentTarget) return;
                      if (e.key === 'F10' && e.shiftKey) { e.preventDefault(); openMenu(q, e.currentTarget); return; }
                      if (e.key === 'Enter') { e.preventDefault(); onOpen(q.name); return; }
                      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                        e.preventDefault();
                        const next = (e.key === 'ArrowDown' ? e.currentTarget.nextElementSibling : e.currentTarget.previousElementSibling) as HTMLElement | null;
                        next?.focus();
                      }
                    }}>
                    <td>
                      <span className="query-chip">
                        <Icon name="query" size={13} dataIcon="query" />
                        <span data-user-content>{bad ? q.name : q.title}</span>
                      </span>
                      {bad && <span className="query-unreadable">{t('queries.unreadable')}</span>}
                    </td>
                    <td className="muted nowrap"><span data-user-content>{dayText(q.created)}</span></td>
                    <td className="muted nowrap"><span data-user-content>{dayText(q.modified)}</span></td>
                    <td className="queries-col-menu">
                      <button type="button" tabIndex={-1} className="icon-button small query-row-menu" data-command="queries.rowMenu" aria-label={t('queries.rowMenu')} aria-haspopup="menu"
                        aria-expanded={rowMenu?.q.name === q.name} onClick={(e) => openMenu(q, e.currentTarget)}>
                        <Icon name="more-horizontal" size={14} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {sortMenu && (
        <PopupMenu label={t('queries.sortLabel')} anchor={sortBtn.current} onClose={() => setSortMenu(false)}
          entries={SORTS.map((s) => ({ kind: 'item' as const, key: s, label: t(SORT_LABEL[s]), checked: s === sort,
            content: <span className="menu-title">{t(SORT_LABEL[s])}</span>, onChoose: () => { setSortMenu(false); onSort(s); sortBtn.current?.focus(); } }))} />
      )}
      {rowMenu && (
        <QueryMenu query={rowMenu.q} anchor={rowMenu.anchor}
          onClose={() => { const a = rowMenu.anchor; setRowMenu(null); const row = a.closest('tr'); if (row?.isConnected) (row as HTMLElement).focus(); }} />
      )}
    </div>
  );
}
