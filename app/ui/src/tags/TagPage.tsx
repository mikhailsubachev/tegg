// The tag page `tag/<key>` (docs/acceptance/tags.md R82; board `TagPage`, table only, D-650): the breadcrumb, the colour
// tile, the heading and its unfiltered summary, Tag actions, `New with #tag`, the text and Type filters, the sort and the
// grouping (D-636, D-648, D-649), and one table of every object carrying the tag. Viewing writes nothing (FR-SYN-06).
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { localDate } from '@tegg/doc';
import { t } from '../i18n/catalog';
import { collator } from '../i18n/collate';
import { ipc } from '../ipc/client';
import type { TagObjectRowDto, TagUsageDto, TypeDefDto } from '../ipc/types';
import { PopupMenu, type MenuEntry } from '../shell/Menu';
import { Icon, typeIconName } from '../shell/Icon';
import { captureTargets } from '../shell/TypeMenu';
import { chipState, taskGlyph } from '../links/chip';
import { currentRegion } from '../tasks/useTasks';
import { dueLabel } from '../tasks/views';
import { dateTimeText } from '../types/util';
import { appZone } from '../zone';
import { tagChipStyle } from './chip';
import { DEFAULT_TAG_PAGE, summary, tagPageRows, typeOptions, type TagPageSort, type TagPageUi } from './model';
import { ColourPopover, DeleteTagDialog, RenameTagDialog } from './TagDialogs';
import { refreshTags, useTags } from './store';

export type TagPageProps = {
  tagKey: string;
  types: TypeDefDto[];
  refresh: number;
  heading: React.RefObject<HTMLHeadingElement | null>;
  ui: TagPageUi | undefined;
  onUi: (u: TagPageUi) => void;
  onOpen: (path: string) => void;
  onTag: (key: string) => void;
  onAll: () => void;
  /** After a rename the route is replaced by the new key's (FR-TAG-04 AC-9); after a removal it is `tags` (D-666). */
  onRenamed: (key: string) => void;
  onRemoved: () => void;
  onNewWith: (typeKey: string, name: string) => void;
  commandRef: React.MutableRefObject<((id: string) => void) | null>;
};

const COLUMNS: { key: TagPageSort['column']; label: string }[] = [
  { key: 'title', label: 'tag.col.title' }, { key: 'type', label: 'tag.col.type' }, { key: 'otherTags', label: 'tag.col.otherTags' }, { key: 'modified', label: 'tag.col.modified' },
];

export function TagPage(p: TagPageProps) {
  const tags = useTags();
  useEffect(() => { void refreshTags(); }, []);
  const row = tags.find((x) => x.key === p.tagKey) ?? null;
  const name = row?.name ?? p.tagKey;
  const [objects, setObjects] = useState<TagObjectRowDto[] | null>(null);
  const [filter, setFilter] = useState('');
  const [menu, setMenu] = useState<null | 'actions' | 'type' | 'sort' | 'group' | 'new'>(null);
  const [dialog, setDialog] = useState<null | 'rename' | 'delete' | 'colour'>(null);
  const [usage, setUsage] = useState<TagUsageDto | null>(null);
  const [cursor, setCursor] = useState(0);
  const anchors = useRef<Record<string, HTMLElement | null>>({});
  const tile = useRef<HTMLButtonElement | null>(null);
  const tbody = useRef<HTMLTableElement | null>(null);
  const ui: TagPageUi = { ...DEFAULT_TAG_PAGE, ...(p.ui ?? {}) };

  useEffect(() => {
    let live = true;
    void ipc.tagObjects(p.tagKey).then((r) => { if (live) setObjects(r); }, () => { if (live) setObjects([]); });
    return () => { live = false; };
  }, [p.tagKey, p.refresh, tags]);
  useEffect(() => {
    if (dialog !== 'rename' || !row) return;
    void ipc.tagUsage(row.key).then(setUsage, () => setUsage(null));
  }, [dialog, row?.key]);

  const typeNames = useMemo(() => Object.fromEntries(p.types.map((x) => [x.key, x.name])), [p.types]);
  const all = objects ?? [];
  const s = summary(all);
  const grouped = tagPageRows(all, ui, filter, typeNames, collator());
  const flat = grouped.groups.flatMap((g) => g.rows);
  const opts = typeOptions(all, typeNames, collator());
  const tagName = (k: string) => tags.find((x) => x.key === k)?.name ?? k;
  const colourOf = (k: string) => tags.find((x) => x.key === k)?.color ?? null;

  const command = (id: string) => {
    if (id === 'tag.rename' && row) setDialog('rename');
    else if (id === 'tag.delete' && row) setDialog('delete');
    else if (id === 'tag.colour' && row) setDialog('colour');
    else if (id === 'tag.newWith') setMenu('new');
    else if (id === 'tag.groupType') p.onUi({ ...ui, grouping: 'type' });
    else if (id === 'tag.groupNone') p.onUi({ ...ui, grouping: 'none' });
  };
  useLayoutEffect(() => {
    p.commandRef.current = command;
    return () => { if (p.commandRef.current === command) p.commandRef.current = null; };
  });

  const sortBy = (column: TagPageSort['column']) => {
    const dir = ui.sort.column === column ? (ui.sort.dir === 'asc' ? 'desc' : 'asc') : 'asc';
    p.onUi({ ...ui, sort: { column, dir } });
  };
  const focusRow = (i: number) => {
    const rows = tbody.current?.querySelectorAll<HTMLElement>('tr[data-path]');
    if (!rows?.length) return;
    rows[Math.max(0, Math.min(rows.length - 1, i))].focus();
  };
  const today = localDate(Date.now(), appZone());
  const region = currentRegion();
  const typeFor = (k: string) => p.types.find((x) => x.key === k);
  const sortLabel = `${t(COLUMNS.find((c) => c.key === ui.sort.column)?.label ?? 'tag.col.modified')} ${ui.sort.dir === 'asc' ? '↑' : '↓'}`;
  const typeLabel = ui.type === null ? t('tag.typeAll') : t('tag.typeOne', { type: typeNames[ui.type] ?? ui.type });
  const newWithLabel = t('tag.newWith', { tag: name });

  const menuEntries = (): MenuEntry[] => {
    if (menu === 'actions') {
      return [
        { kind: 'item', key: 'rename', label: t('tag.rename'), content: <><span>{t('tag.rename')}</span><span className="menu-desc">{t('tag.renameUpdates', { count: row?.count ?? 0 })}</span></>, description: t('tag.renameUpdates', { count: row?.count ?? 0 }), onChoose: () => { setMenu(null); setDialog('rename'); } },
        { kind: 'item', key: 'colour', label: t('tag.colourMenu'), content: t('tag.colourMenu'), onChoose: () => { setMenu(null); setDialog('colour'); } },
        { kind: 'separator' },
        { kind: 'item', key: 'delete', label: t('tag.delete'), content: t('tag.delete'), onChoose: () => { setMenu(null); setDialog('delete'); } },
      ];
    }
    if (menu === 'type') {
      return [
        { kind: 'radio', key: '*', label: t('tag.allTypes'), content: t('tag.allTypes'), checked: ui.type === null, onChoose: () => { setMenu(null); p.onUi({ ...ui, type: null }); } },
        ...opts.map((o): MenuEntry => ({ kind: 'radio', key: o.type, label: `${o.name} ${o.count}`, content: <><span data-user-content>{o.name}</span> {o.count}</>, checked: ui.type === o.type, onChoose: () => { setMenu(null); p.onUi({ ...ui, type: o.type }); } })),
      ];
    }
    if (menu === 'sort') {
      return COLUMNS.map((c): MenuEntry => ({ kind: 'radio', key: c.key, label: t(c.label), content: t(c.label), checked: ui.sort.column === c.key, onChoose: () => { setMenu(null); sortBy(c.key); } }));
    }
    if (menu === 'group') {
      return [
        { kind: 'radio', key: 'none', label: t('tag.noGrouping'), content: t('tag.noGrouping'), checked: ui.grouping === 'none', onChoose: () => { setMenu(null); p.onUi({ ...ui, grouping: 'none' }); } },
        { kind: 'radio', key: 'type', label: t('tag.groupType'), content: t('tag.groupType'), checked: ui.grouping === 'type', onChoose: () => { setMenu(null); p.onUi({ ...ui, grouping: 'type' }); } },
      ];
    }
    if (menu === 'new') {
      return captureTargets(p.types).map((x): MenuEntry => ({ kind: 'item', key: x.key, label: x.name, content: <span data-user-content>{x.name}</span>, onChoose: () => { setMenu(null); p.onNewWith(x.key, name); } }));
    }
    return [];
  };
  const menuLabel = menu === 'actions' ? t('tag.actions') : menu === 'type' ? t('tag.col.type') : menu === 'sort' ? t('tag.sortMenu') : menu === 'group' ? t('tag.groupType') : t('cmd.newObject');
  const open = (k: typeof menu) => (e: React.MouseEvent<HTMLElement>) => { anchors.current[k ?? ''] = e.currentTarget; setMenu(menu === k ? null : k); };

  const titleCell = (r: TagObjectRowDto) => {
    const info = { kind: 'note', type: r.type, review: r.review, status: r.status, due: r.due, completed: r.completed };
    const st = chipState(info);
    const glyph = taskGlyph(st);
    const tp = typeFor(r.type);
    let suffix: string | null = null;
    let tone: string | undefined;
    if (st.task) {
      const state = st.task.state;
      const d = dueLabel({ state, due: r.due && /^\d{4}-\d{2}-\d{2}$/.test(r.due) ? r.due : null, dueRaw: r.due, completed: r.completed } as never, today, region, appZone());
      tone = d.tone;
      suffix = [d.text, r.status].filter(Boolean).join(' · ');
    }
    return (
      <a href="#" className="tag-row-title" data-state={st.task?.state} onClick={(e) => { e.preventDefault(); e.stopPropagation(); p.onOpen(r.path); }} tabIndex={-1}>
        <span className="type-icon" aria-hidden="true" style={{ color: `var(--type-${tp?.color ?? 'gray'})` }}>
          <Icon name={glyph ?? typeIconName(r.type, tp?.icon)} size={14} />
        </span>
        <span className={st.task && (st.task.state === 'done' || st.task.state === 'cancelled') ? 'done-title' : undefined} data-user-content>{r.title}</span>
        {suffix && <span className="tag-row-suffix" data-tone={tone}>{suffix}</span>}
        {st.unreviewed && <span className="chip-unrev" title={t('link.unreviewed')} aria-description={t('link.unreviewed')} role="img" aria-label={t('link.unreviewed')} />}
      </a>
    );
  };

  return (
    <div className="page-column tag-page">
      <nav aria-label={t('tag.breadcrumbNav')} className="breadcrumb">
        <a href="#" tabIndex={0} onClick={(e) => { e.preventDefault(); p.onAll(); }}>{t('tag.breadcrumbAll')}</a>
        <span aria-hidden="true"> / </span>
        <span data-user-content>#{name}</span>
      </nav>
      <header className="page-header tag-header">
        {/* The tile comes after the heading in the focus order and before it on screen (`order: -1`). */}
        <div className="type-header-text">
          <h1 ref={p.heading} tabIndex={-1}><span data-user-content>{name}</span></h1>
          <p className="type-count">{t('tag.summary', { objects: s.objects, types: s.types })}</p>
        </div>
        {row ? (
          <button ref={tile} tabIndex={0} type="button" className="tag-tile" aria-label={t('tag.colour')} aria-haspopup="dialog" data-color={row.color ?? 'none'}
            style={{ ...tagChipStyle(row.color), order: -1 }} onClick={() => setDialog('colour')}>#</button>
        ) : <span className="tag-tile" aria-hidden="true" style={{ order: -1 }}>#</span>}
        <div className="page-actions">
          {row && (
            <button tabIndex={0} type="button" className="icon-button bordered" aria-label={t('tag.actions')} title={t('tag.actions')} aria-haspopup="menu" aria-expanded={menu === 'actions'} onClick={open('actions')}>
              <Icon name="more-horizontal" size={16} />
            </button>
          )}
          <button tabIndex={0} type="button" className="text-button primary" aria-haspopup="menu" onClick={open('new')}>{newWithLabel}</button>
        </div>
      </header>
      <div className="page-toolbar type-toolbar">
        <span className="spacer" />
        <input type="text" className="type-filter" aria-label={t('tag.filter')} placeholder={t('tag.filterPlaceholder')} value={filter} spellCheck={false} autoComplete="off"
          onChange={(e) => setFilter(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setFilter(''); } else if (e.key === 'ArrowDown') { e.preventDefault(); focusRow(0); } }} />
        <button tabIndex={0} type="button" className="text-button" aria-haspopup="menu" onClick={open('type')}>{typeLabel}</button>
        <button tabIndex={0} type="button" className="text-button" aria-haspopup="menu" onClick={open('sort')}>{sortLabel}</button>
        <button tabIndex={0} type="button" className="text-button" aria-haspopup="menu" onClick={open('group')}>{ui.grouping === 'type' ? t('tag.groupedByType') : t('tag.noGrouping')}</button>
      </div>
      {objects && filter.trim() && flat.length === 0 && <p role="status" className="empty">{t('tag.noMatch', { text: filter.trim() })}</p>}
      <div className="table-scroll">
        <table ref={tbody} className="type-table tag-table" aria-label={t('tag.table', { tag: name })}>
          <thead>
            <tr>
              {COLUMNS.map((c) => {
                const on = ui.sort.column === c.key;
                return (
                  <th key={c.key} role="columnheader" tabIndex={0} aria-sort={on ? (ui.sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'} className={on ? 'sorted' : ''}
                    onClick={() => sortBy(c.key)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); sortBy(c.key); } }}>
                    {t(c.label)}
                  </th>
                );
              })}
            </tr>
          </thead>
          {grouped.groups.map((g) => {
            const body = g.rows.map((r) => {
              const i = flat.indexOf(r);
              const st = chipState({ kind: 'note', type: r.type, review: r.review, status: r.status, due: r.due, completed: r.completed });
              return (
                <tr key={r.path} className="type-row" data-path={r.path.normalize('NFC')} data-state={st.task?.state} tabIndex={i === Math.min(cursor, flat.length - 1) ? 0 : -1}
                  onClick={() => p.onOpen(r.path)} onFocus={() => setCursor(i)}
                  onKeyDown={(e) => {
                    if (e.target !== e.currentTarget) return;
                    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); focusRow(i + (e.key === 'ArrowDown' ? 1 : -1)); }
                    else if (e.key === 'Enter') { e.preventDefault(); p.onOpen(r.path); }
                  }}>
                  <td>{titleCell(r)}</td>
                  <td><span data-user-content>{typeNames[r.type] ?? r.type}</span></td>
                  <td>
                    <div className="tag-chips">
                      {[...r.tags].sort(collator().compare).map((k) => (
                        <a key={k} href="#" className="tag-chip" style={tagChipStyle(colourOf(k))} onClick={(e) => { e.preventDefault(); e.stopPropagation(); p.onTag(k); }}>#{tagName(k)}</a>
                      ))}
                    </div>
                  </td>
                  <td>{r.modified ? dateTimeText(r.modified) : ''}</td>
                </tr>
              );
            });
            return g.type === null ? <tbody key="all">{body}</tbody> : (
              <tbody key={g.type} role="rowgroup">
                <tr role="row" className="group-row"><th colSpan={4} scope="rowgroup"><span data-user-content>{typeNames[g.type] ?? g.type}</span> {g.rows.length}</th></tr>
                {body}
              </tbody>
            );
          })}
          <tbody>
            <tr className="new-row"><td colSpan={4}>
              <button tabIndex={0} type="button" className="text-button" aria-haspopup="menu" onClick={open('new')}><Icon name="plus" size={12} />{newWithLabel}</button>
            </td></tr>
          </tbody>
        </table>
      </div>
      {objects && all.length === 0 && <p className="empty">{t('tag.none', { tag: name })}</p>}
      {menu && <PopupMenu label={menuLabel} anchor={anchors.current[menu] ?? null} entries={menuEntries()} onClose={() => setMenu(null)} />}
      {dialog === 'rename' && row && <RenameTagDialog row={row} usage={usage} onClose={() => setDialog(null)} onRenamed={p.onRenamed} />}
      {dialog === 'delete' && row && <DeleteTagDialog row={row} onClose={() => setDialog(null)} onRemoved={p.onRemoved} />}
      {dialog === 'colour' && row && <ColourPopover row={row} anchor={tile.current} onClose={() => { setDialog(null); tile.current?.focus(); }} />}
    </div>
  );
}
