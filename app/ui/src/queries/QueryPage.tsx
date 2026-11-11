// Slice Q (queries.md R143 `query/<name>`, FR-QRY-06 AC-4, FR-QRY-03 AC-4, FR-TPL-04 AC-2; board QueryPage): one saved
// query: `‹ All queries`, its title and `Created <date>`, `Edit query`, `Query actions`, its results as a block shows
// them (no host: a `this` query shows the needs-page state, drawn by the block), and `Used on`: the notes and templates
// whose fence names it (title-sorted, notes first). Read again on `vault:changed`; viewing writes nothing.
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type MutableRefObject, type RefObject } from 'react';
import { t } from '../i18n/catalog';
import { collator } from '../i18n/collate';
import { events, ipc } from '../ipc/client';
import type { QueryDto, QueryUsageDto } from '../ipc/queries';
import { Icon } from '../shell/Icon';
import { useReference } from '../preview/useReference';
import { chipIcon } from '../links/icons';
import { QueryBlock, type QueryBlockApi } from './QueryBlock';
import { QueryMenu, renameQuery, trashQuery, useUndoQueryRename } from './QueryMenu';
import { queryNav, takePendingEdit } from './nav';
import { dayText } from './QueriesPage';
import { isQueryPath } from './store';
import './pages.css';

export type QueryPageCommand = 'edit' | 'rename' | 'trash';
export type QueryPageProps = {
  name: string;
  heading: RefObject<HTMLHeadingElement | null>;
  /** `‹ All queries`. */
  onAll: () => void;
  /** The palette's `Edit query`, `Rename query…`, `Move query to trash` on this page. */
  commandRef: MutableRefObject<((id: QueryPageCommand) => void) | null>;
  /** `queryStatus` (v1-queries §4.6): this page's query and whether it can be written. */
  statusRef: MutableRefObject<(() => { name: string; editable: boolean; title: string } | null) | null>;
  /** The query was renamed (the route follows) or trashed (Back, else `queries`). */
  onRenamed: (name: string) => void;
  onTrashed: () => void;
};

const nfc = (s: string) => s.normalize('NFC');

/** A `Used on` chip (R143): previews and opens like a Backlinks chip (D-930). */
function UsageChip({ u }: { u: QueryUsageDto }) {
  const open = () => queryNav()?.openNote(u.path);
  const { props } = useReference({ target: { path: nfc(u.path), fragment: null, kind: 'note' }, kind: 'chip', open });
  const icon = chipIcon(u.type ?? 'page');
  return (
    <li>
      <a href="#" tabIndex={0} className="chip link-chip kind-note query-usage" data-command="query.openUsage" data-link-kind="note" data-usage={nfc(u.path)} data-icon={icon.def} title={u.title} {...props}>
        <Icon name={icon.glyph} dataIcon={icon.def} size={13} />
        <span className="chip-text"><span data-user-content>{u.title}</span>{u.template && <span className="query-usage-template">{t('query.template')}</span>}</span>
      </a>
    </li>
  );
}

export function QueryPage({ name, heading, onAll, commandRef, statusRef, onRenamed, onTrashed }: QueryPageProps) {
  const [q, setQ] = useState<QueryDto | null>(null);
  const [usages, setUsages] = useState<QueryUsageDto[] | null>(null);
  const [menu, setMenu] = useState<HTMLElement | null>(null);
  const editBtn = useRef<HTMLButtonElement | null>(null);
  const moreBtn = useRef<HTMLButtonElement | null>(null);
  const blockApi = useRef<QueryBlockApi | null>(null);
  useUndoQueryRename();

  const load = useCallback(() => {
    let live = true;
    void ipc.queryGet(name).then((r) => { if (live) setQ((o) => (JSON.stringify(o) === JSON.stringify(r) ? o : r)); }, () => {});
    void ipc.queryUsages(name).then((r) => { if (live) setUsages((o) => (JSON.stringify(o) === JSON.stringify(r) ? o : r)); }, () => {});
    return () => { live = false; };
  }, [name]);
  useEffect(() => load(), [load]);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const un = events.changed((c) => {
      const paths = c.paths ?? [];
      if (!paths.some((p) => isQueryPath(p) || p.endsWith('.md'))) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { timer = null; load(); }, 300);
    });
    return () => { if (timer) clearTimeout(timer); void un.then((f) => f()); };
  }, [load]);

  const state = q?.state ?? 'ok';
  const editable = state === 'ok';
  const title = q?.def?.title ?? q?.name ?? name;
  const menuQuery = { name: q?.name ?? name, title, state };
  const edit = () => { if (editable && editBtn.current) blockApi.current?.edit({ anchor: editBtn.current, returnFocus: editBtn.current }); };
  const rename = () => { if (editable) renameQuery(menuQuery, document.activeElement as HTMLElement | null, onRenamed); };
  const trash = () => { void trashQuery(menuQuery.name, title, onTrashed); };
  useLayoutEffect(() => {
    commandRef.current = (id) => { if (id === 'edit') edit(); else if (id === 'rename') rename(); else trash(); };
    statusRef.current = () => ({ name: q?.name ?? name, editable, title });
  });
  useEffect(() => () => { commandRef.current = null; statusRef.current = null; }, [commandRef, statusRef]);
  // New query and Create it (R144): the page opens with its editor, once the block is there.
  useEffect(() => {
    if (!q || q.state !== 'ok' || !takePendingEdit(name)) return;
    let n = 0;
    const tick = () => { if (blockApi.current && editBtn.current) edit(); else if (n++ < 100) setTimeout(tick, 20); };
    tick();
  }, [q?.state]);

  const coll = collator();
  const sorted = [...(usages ?? [])].sort((a, b) => Number(a.template) - Number(b.template) || coll.compare(a.title, b.title) || (a.path < b.path ? -1 : 1));
  return (
    <div className="page-column query-page">
      <nav className="query-crumbs">
        <a href="#" tabIndex={0} className="query-back" data-command="queries.go" aria-label={t('query.back')} onClick={(e) => { e.preventDefault(); onAll(); }}>‹ {t('query.back')}</a>
      </nav>
      <header className="page-header query-page-header">
        <span className="query-tile" aria-hidden="true"><Icon name="query" size={22} /></span>
        <div className="type-header-text">
          <h1 ref={heading} tabIndex={-1} data-user-content>{title}</h1>
          {q?.created && <p className="type-count">{t('query.created', { date: dayText(q.created) })}</p>}
        </div>
        <div className="page-actions">
          <button ref={editBtn} tabIndex={0} type="button" className="text-button query-edit-button" aria-haspopup="dialog" data-command="query.edit"
            aria-disabled={editable ? undefined : 'true'} aria-description={state === 'newer' ? t('query.block.readOnly') : undefined}
            onClick={edit}>
            <Icon name="pen-line" size={14} />{t('query.edit')}
          </button>
          <button ref={moreBtn} tabIndex={0} type="button" className="icon-button query-more" data-command="query.menu" aria-label={t('queries.rowMenu')} aria-haspopup="menu" aria-expanded={!!menu}
            onClick={(e) => setMenu(e.currentTarget)}>
            <Icon name="more-horizontal" size={16} />
          </button>
        </div>
      </header>
      {state === 'unreadable' && q
        ? <p className="query-page-message">{t('query.block.unreadable', { line: q.line ?? 1 })}</p>
        : q && (q.state === 'ok' || q.state === 'newer') && <QueryBlock source={{ kind: 'saved', name: q.name }} host={null} onPage apiRef={blockApi} query={q} />}
      {state === 'missing' && <p className="query-page-message">{t('query.block.notFound', { name })}</p>}
      {state === 'trashed' && <p className="query-page-message">{t('query.block.trashed', { name })}</p>}
      <section className="query-used-on">
        <h2>{t('query.usedOn')}</h2>
        {usages && sorted.length === 0 && <p className="muted">{t('query.notUsed')}</p>}
        {sorted.length > 0 && (
          <ul className="query-usages" aria-label={t('query.usedOn')}>
            {sorted.map((u) => <UsageChip key={u.path} u={u} />)}
          </ul>
        )}
      </section>
      {menu && (
        <QueryMenu query={menuQuery} anchor={menu} onRenamed={onRenamed} onTrashed={onTrashed}
          onClose={() => { setMenu(null); }} />
      )}
    </div>
  );
}
