// All tags (`tags`; docs/acceptance/tags.md R81, board `TagsAll`, no descriptions, D-691): every tag with its colour
// chip, count and Last used, `Find a tag…`, the remembered sort (D-703), and `New tag` (D-696). Viewing writes nothing.
import { RefElement } from '../preview/useReference';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { t } from '../i18n/catalog';
import { collator } from '../i18n/collate';
import { ipc } from '../ipc/client';
import { PopupMenu } from '../shell/Menu';
import { PinContextMenu } from '../pinned/PinMenu';
import { pinDragSource } from '../pinned/drag';
import { dateTimeText } from '../types/util';
import { tagChipStyle } from './chip';
import { DEFAULT_TAGS_SORT, allTagsRows, type TagsSort } from './model';
import { NewTagDialog } from './TagDialogs';
import { refreshTags, useTags } from './store';

const COLUMNS: { key: TagsSort['column']; label: string; menu: string }[] = [
  { key: 'name', label: 'tags.col.tag', menu: 'tags.sort.name' },
  { key: 'count', label: 'tags.col.objects', menu: 'tags.sort.mostUsed' },
  { key: 'lastUsed', label: 'tags.col.lastUsed', menu: 'tags.sort.lastUsed' },
];

export function AllTagsPage({ heading, sort: sort0, onSort, onOpen, commandRef }: {
  heading: React.RefObject<HTMLHeadingElement | null>;
  sort: TagsSort | undefined;
  onSort: (s: TagsSort) => void;
  onOpen: (key: string) => void;
  /** `New tag…` from the palette opens the dialog here. */
  commandRef: React.MutableRefObject<(() => void) | null>;
}) {
  const tags = useTags();
  useEffect(() => { void refreshTags(); }, []);
  const sort = sort0 ?? DEFAULT_TAGS_SORT;
  const [find, setFind] = useState('');
  const [menu, setMenu] = useState(false);
  const [dialog, setDialog] = useState(false);
  const [rowMenu, setRowMenu] = useState<{ key: string; name: string; anchor: HTMLElement } | null>(null);
  const [objects, setObjects] = useState<number | null>(null);
  const sortBtn = useRef<HTMLButtonElement | null>(null);
  useLayoutEffect(() => {
    const f = () => setDialog(true);
    commandRef.current = f;
    return () => { if (commandRef.current === f) commandRef.current = null; };
  });
  // `<m> tagged objects`: distinct objects (D-721), one core read (D-784). One `tag_objects` read per tag kept the core
  // busy for ~50 s on a vault with 802 tags and left every page empty meanwhile (bug v0.74).
  useEffect(() => {
    let live = true;
    void ipc.taggedObjects().then((n) => { if (live) setObjects(n); }, () => { if (live) setObjects(0); });
    return () => { live = false; };
  }, [tags]);
  const rows = allTagsRows(tags, sort, find, collator());
  const by = (column: TagsSort['column']) => {
    const dir = sort.column === column ? (sort.dir === 'asc' ? 'desc' : 'asc') : 'asc';
    onSort({ column, dir });
  };
  const sortName = t(COLUMNS.find((c) => c.key === sort.column)!.menu);
  return (
    <div className="page-column tags-page">
      <header className="page-header tag-header">
        <span className="tag-tile" aria-hidden="true">#</span>
        <div className="type-header-text">
          <h1 ref={heading} tabIndex={-1}>{t('tags.title')}</h1>
          <p className="type-count">{t('tags.summary', { tags: tags.length, objects: objects ?? 0 })}</p>
        </div>
        <div className="page-actions">
          <button tabIndex={0} type="button" className="text-button primary" data-command="tags.new" onClick={() => setDialog(true)}>{t('tags.new')}</button>
        </div>
      </header>
      <div className="page-toolbar type-toolbar">
        <input data-command="tagsPage.c5" type="text" className="type-filter" aria-label={t('tags.find')} placeholder={t('tags.findPlaceholder')} value={find} spellCheck={false} autoComplete="off"
          onChange={(e) => setFind(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setFind(''); } }} />
        <span className="spacer" />
        <button data-command="tagsPage.c4" ref={sortBtn} tabIndex={0} type="button" className="text-button" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu((m) => !m)}>
          {`${sortName} ${sort.dir === 'asc' ? '↑' : '↓'}`}
        </button>
      </div>
      {tags.length > 0 && rows.length === 0 && <p role="status" className="empty">{t('tags.noMatch', { text: find.trim() })}</p>}
      {tags.length === 0 && <p className="empty">{t('tags.empty')}</p>}
      <div className="table-scroll">
        <table className="type-table tags-table" aria-label={t('tags.title')}>
          <thead>
            <tr>
              {COLUMNS.map((c) => {
                const on = sort.column === c.key;
                return (
                  <th data-command="tagsPage.c3" key={c.key} role="columnheader" tabIndex={0} aria-sort={on ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'} className={on ? 'sorted' : ''}
                    onClick={() => by(c.key)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); by(c.key); } }}>
                    {t(c.label)}
                  </th>
                );
              })}
              <th data-command="tagsPage.c2" aria-hidden="true" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              // Slice P (R104 row 10, D-937): a click previews the Tag; ⏎ and a double-click open its page.
              <RefElement as="tr" reference={{ target: { path: '', fragment: null, kind: 'tag', key: r.key }, kind: 'row', open: () => onOpen(r.key) }}
                key={r.key} className="type-row" data-tag={r.key} tabIndex={i === 0 ? 0 : -1}
                // Slice PIN (R134, R135): `Tag` menu (right-click, ⇧F10) and a drag source of the tag.
                onContextMenu={(e) => { e.preventDefault(); setRowMenu({ key: r.key, name: r.name, anchor: e.currentTarget }); }}
                {...pinDragSource({ request: { kind: 'tag', key: r.key }, label: `#${r.name}`, icon: 'hash', color: r.color })}
                onKeyDown={(e) => {
                  if (e.key === 'F10' && e.shiftKey) { e.preventDefault(); setRowMenu({ key: r.key, name: r.name, anchor: e.currentTarget }); return; }
                  const list = [...((e.currentTarget.parentElement?.querySelectorAll<HTMLElement>('tr[data-tag]')) ?? [])];
                  const at = list.indexOf(e.currentTarget);
                  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); list[Math.max(0, Math.min(list.length - 1, at + (e.key === 'ArrowDown' ? 1 : -1)))]?.focus(); }
                }}>
                <td><a data-command="tagsPage.c1" href="#" className="tag-chip" style={tagChipStyle(r.color)} tabIndex={-1} onClick={(e) => e.preventDefault()}><span data-user-content>#{r.name}</span></a></td>
                <td className="num">{r.count}</td>
                <td>{r.lastUsed ? dateTimeText(r.lastUsed) : ''}</td>
                <td aria-hidden="true" className="chevron">›</td>
              </RefElement>
            ))}
          </tbody>
        </table>
      </div>
      {menu && (
        <PopupMenu label={t('tag.sortMenu')} anchor={sortBtn.current} onClose={() => setMenu(false)}
          entries={(['count', 'name', 'lastUsed'] as const).map((k) => ({ kind: 'radio' as const, key: k, label: t(COLUMNS.find((c) => c.key === k)!.menu), content: t(COLUMNS.find((c) => c.key === k)!.menu), checked: sort.column === k, onChoose: () => { setMenu(false); onSort({ column: k, dir: k === 'name' ? 'asc' : 'desc' }); } }))} />
      )}
      {rowMenu && (
        <PinContextMenu label={t('tagsAll.rowMenu')} anchor={rowMenu.anchor} target={{ request: { kind: 'tag', key: rowMenu.key }, label: `#${rowMenu.name}` }}
          onOpen={() => onOpen(rowMenu.key)} onClose={() => { const a = rowMenu.anchor; setRowMenu(null); if (a.isConnected) a.focus(); }} />
      )}
      {dialog && <NewTagDialog onClose={() => setDialog(false)} onOpen={onOpen} />}
    </div>
  );
}
