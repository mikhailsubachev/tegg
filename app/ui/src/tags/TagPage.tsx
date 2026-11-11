// The tag page `tag/<key>` (docs/acceptance/tags.md R82; board `TagPage`, table only, D-704): the breadcrumb, the colour
// tile, the heading and its unfiltered summary, Tag actions (no `New with #tag`, D-762), the text and Type filters, the sort and the
// grouping (D-690, D-702, D-703), and one table of every object carrying the tag. Viewing writes nothing (FR-SYN-06).
import { RefElement } from '../preview/useReference';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { localDate } from '@tegg/doc';
import { t } from '../i18n/catalog';
import { collator } from '../i18n/collate';
import { ipc } from '../ipc/client';
import type { TagObjectRowDto, TagUsageDto, TypeDefDto } from '../ipc/types';
import { PopupMenu, type MenuEntry } from '../shell/Menu';
import { usePinMenuEntry } from '../pinned/PinMenu';
import { pinDragSource } from '../pinned/drag';
import { Icon, typeIconName } from '../shell/Icon';
import { chipState, taskGlyph } from '../links/chip';
import { currentRegion } from '../tasks/useTasks';
import { dueLabel } from '../tasks/views';
import { dateTimeText } from '../types/util';
import { appZone } from '../zone';
import { tagChipStyle } from './chip';
import { DEFAULT_TAG_PAGE, summary, tagPageRows, typeOptions, type TagPageSort, type TagPageUi } from './model';
import { ColourPopover, DeleteTagDialog, RenameTagDialog } from './TagDialogs';
import { useTags, syncTags } from './store';

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
  /** After a rename the route is replaced by the new key's (FR-TAG-04 AC-9); after a removal it is `tags` (D-720). */
  onRenamed: (key: string) => void;
  onRemoved: () => void;
  commandRef: React.MutableRefObject<((id: string) => void) | null>;
};

const WINDOW_FROM = 80;
const ROW_EST = 33;
const OVERSCAN = 10;

const COLUMNS: { key: TagPageSort['column']; label: string }[] = [
  { key: 'title', label: 'tag.col.title' }, { key: 'type', label: 'tag.col.type' }, { key: 'otherTags', label: 'tag.col.otherTags' }, { key: 'modified', label: 'tag.col.modified' },
];

export function TagPage(p: TagPageProps) {
  const tags = useTags();
  useEffect(() => { void syncTags(); }, []);
  const row = tags.find((x) => x.key === p.tagKey) ?? null;
  const name = row?.name ?? p.tagKey;
  const [objects, setObjects] = useState<TagObjectRowDto[] | null>(null);
  const [filter, setFilter] = useState('');
  const [menu, setMenu] = useState<null | 'actions' | 'type' | 'sort' | 'group'>(null);
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
  // FR-TAG-06 AC-11 (D-736): above WINDOW_FROM rows only the rows around the viewport are in the page; the rows have
  // about one height (ROW_EST, then measured), so a row outside the window is scrolled to before it is focused.
  const [view, setView] = useState({ top: 0, height: 900 });
  const [rowH, setRowH] = useState(ROW_EST);
  const pendingFocus = useRef<number | null>(null);
  const windowed = flat.length > WINDOW_FROM;
  const scroller = () => (tbody.current?.closest('main') as HTMLElement | null) ?? null;
  const tableTop = (table: HTMLElement, main: HTMLElement) => table.getBoundingClientRect().top - main.getBoundingClientRect().top + main.scrollTop;
  useEffect(() => {
    const main = scroller();
    if (!windowed || !main) return;
    let frame = 0;
    const measure = () => {
      const table = tbody.current;
      if (!table) return;
      const next = { top: Math.round(main.scrollTop - tableTop(table, main)), height: main.clientHeight };
      setView((v) => (v.top === next.top && v.height === next.height ? v : next));
      const h = table.querySelector<HTMLElement>('tr[data-path]')?.getBoundingClientRect().height;
      if (h && Math.abs(h - rowH) > 0.5) setRowH(h);
    };
    const on = () => { if (!frame) frame = requestAnimationFrame(() => { frame = 0; measure(); }); };
    main.addEventListener('scroll', on, { passive: true });
    window.addEventListener('resize', on);
    measure();
    return () => { main.removeEventListener('scroll', on); window.removeEventListener('resize', on); if (frame) cancelAnimationFrame(frame); };
  }, [windowed, rowH]); // eslint-disable-line react-hooks/exhaustive-deps
  const from = windowed ? Math.max(0, Math.floor(view.top / rowH) - OVERSCAN) : 0;
  const to = windowed ? Math.min(flat.length, Math.ceil((view.top + view.height) / rowH) + OVERSCAN) : flat.length;
  const rowAt = (i: number) => tbody.current?.querySelector<HTMLElement>(`tr[data-index="${i}"]`) ?? null;
  const focusRow = (i: number) => {
    if (!flat.length) return;
    const at = Math.max(0, Math.min(flat.length - 1, i));
    const el = rowAt(at);
    if (el) { el.focus(); return; }
    const main = scroller();
    const table = tbody.current;
    if (!main || !table) return;
    pendingFocus.current = at;
    main.scrollTop = Math.max(0, tableTop(table, main) + at * rowH - main.clientHeight / 2);
    setView({ top: Math.round(main.scrollTop - tableTop(table, main)), height: main.clientHeight });
  };
  useLayoutEffect(() => {
    if (pendingFocus.current === null) return;
    const el = rowAt(pendingFocus.current);
    if (el) { pendingFocus.current = null; el.focus(); }
  });
  // The test build's `tag-rows:<n>` (D-736): the row elements of the first paint with rows.
  const marked = useRef<string | null>(null);
  useEffect(() => {
    if (objects === null || marked.current === p.tagKey) return;
    marked.current = p.tagKey;
    const n = tbody.current?.querySelectorAll('tr[data-path]').length ?? 0;
    void ipc.perfMark(`tag-rows:${n}`).catch(() => {});
  }, [objects, p.tagKey]);
  const today = localDate(Date.now(), appZone());
  const region = currentRegion();
  const typeFor = (k: string) => p.types.find((x) => x.key === k);
  const sortLabel = `${t(COLUMNS.find((c) => c.key === ui.sort.column)?.label ?? 'tag.col.modified')} ${ui.sort.dir === 'asc' ? '↑' : '↓'}`;
  const typeLabel = ui.type === null ? t('tag.typeAll') : t('tag.typeOne', { type: typeNames[ui.type] ?? ui.type });

  const pinEntry = usePinMenuEntry();
  const menuEntries = (): MenuEntry[] => {
    if (menu === 'actions') {
      // Slice PIN (R134): `Pin to sidebar` / `Unpin from sidebar` first.
      const pin = pinEntry(row ? { request: { kind: 'tag', key: row.key }, label: `#${row.name}` } : null, () => setMenu(null));
      return [
        ...(pin ? [pin] : []),
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
    return [];
  };
  const menuLabel = menu === 'actions' ? t('tag.actions') : menu === 'type' ? t('tag.col.type') : menu === 'sort' ? t('tag.sortMenu') : t('tag.groupType');
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
      <a data-command="tagPage.c13" href="#" className="tag-row-title" data-state={st.task?.state} onClick={(e) => e.preventDefault()} tabIndex={-1}>
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
        <a data-command="tagPage.c12" href="#" tabIndex={0} onClick={(e) => { e.preventDefault(); p.onAll(); }}>{t('tag.breadcrumbAll')}</a>
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
          <button data-command="tagPage.c11" ref={tile} tabIndex={0} type="button" className="tag-tile" aria-label={t('tag.colour')} aria-haspopup="dialog" data-color={row.color ?? 'none'}
            style={{ ...tagChipStyle(row.color), order: -1 }} onClick={() => setDialog('colour')}>#</button>
        ) : <span className="tag-tile" aria-hidden="true" style={{ order: -1 }}>#</span>}
        <div className="page-actions">
          {row && (
            <button data-command="tagPage.c10" tabIndex={0} type="button" className="icon-button bordered" aria-label={t('tag.actions')} title={t('tag.actions')} aria-haspopup="menu" aria-expanded={menu === 'actions'} onClick={open('actions')}>
              <Icon name="more-horizontal" size={16} />
            </button>
          )}
        </div>
      </header>
      <div className="page-toolbar type-toolbar">
        <span className="spacer" />
        <input data-command="tagPage.c8" type="text" className="type-filter" aria-label={t('tag.filter')} placeholder={t('tag.filterPlaceholder')} value={filter} spellCheck={false} autoComplete="off"
          onChange={(e) => setFilter(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setFilter(''); } else if (e.key === 'ArrowDown') { e.preventDefault(); focusRow(0); } }} />
        <button data-command="tagPage.c7" tabIndex={0} type="button" className="text-button" aria-haspopup="menu" onClick={open('type')}>{typeLabel}</button>
        <button data-command="tagPage.c6" tabIndex={0} type="button" className="text-button" aria-haspopup="menu" onClick={open('sort')}>{sortLabel}</button>
        <button data-command="tagPage.c5" tabIndex={0} type="button" className="text-button" aria-haspopup="menu" onClick={open('group')}>{ui.grouping === 'type' ? t('tag.groupedByType') : t('tag.noGrouping')}</button>
      </div>
      {objects && filter.trim() && flat.length === 0 && <p role="status" className="empty">{t('tag.noMatch', { text: filter.trim() })}</p>}
      <div className="table-scroll">
        <table ref={tbody} className="type-table tag-table" aria-label={t('tag.table', { tag: name })}>
          <thead>
            <tr>
              {COLUMNS.map((c) => {
                const on = ui.sort.column === c.key;
                return (
                  <th data-command="tagPage.c4" key={c.key} role="columnheader" tabIndex={0} aria-sort={on ? (ui.sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'} className={on ? 'sorted' : ''}
                    onClick={() => sortBy(c.key)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); sortBy(c.key); } }}>
                    {t(c.label)}
                  </th>
                );
              })}
            </tr>
          </thead>
          {grouped.groups.map((g) => {
            const first = flat.indexOf(g.rows[0]);
            const shown = g.rows.filter((_, k) => first + k >= from && first + k < to);
            const before = shown.length ? flat.indexOf(shown[0]) - first : Math.max(0, Math.min(g.rows.length, from - first));
            const after = g.rows.length - before - shown.length;
            const body = shown.map((r) => {
              const i = flat.indexOf(r);
              const st = chipState({ kind: 'note', type: r.type, review: r.review, status: r.status, due: r.due, completed: r.completed });
              return (
                <RefElement as="tr" reference={{ target: { path: r.path.normalize('NFC'), fragment: null, kind: 'note' }, kind: 'row', open: () => p.onOpen(r.path) }}
                  key={r.path} className="type-row" data-index={i} data-path={r.path.normalize('NFC')} data-state={st.task?.state} tabIndex={i === Math.min(cursor, flat.length - 1) ? 0 : -1}
                  {...pinDragSource({ request: { kind: 'object', path: r.path.normalize('NFC') }, label: r.title, icon: 'file' })}
                  onFocus={() => setCursor(i)}
                  onKeyDown={(e) => {
                    if (e.target !== e.currentTarget) return;
                    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); focusRow(i + (e.key === 'ArrowDown' ? 1 : -1)); }
                  }}>
                  <td>{titleCell(r)}</td>
                  <td><span data-user-content>{typeNames[r.type] ?? r.type}</span></td>
                  <td>
                    <div className="tag-chips">
                      {[...r.tags].sort(collator().compare).map((k) => (
                        <RefElement as="a" reference={{ target: { path: '', fragment: null, kind: 'tag', key: k }, kind: 'chip', open: () => p.onTag(k) }}
                          data-command="tagPage.c3" key={k} href="#" className="tag-chip" style={tagChipStyle(colourOf(k))}>#{tagName(k)}</RefElement>
                      ))}
                    </div>
                  </td>
                  <td>{r.modified ? dateTimeText(r.modified) : ''}</td>
                </RefElement>
              );
            });
            const pad = (n: number, k: string) => n > 0 && <tr key={k} aria-hidden="true" className="spacer-row" style={{ height: n * rowH }}><td colSpan={4} /></tr>;
            const rows = windowed ? [pad(before, 'before'), ...body, pad(after, 'after')] : body;
            return g.type === null ? <tbody key="all">{rows}</tbody> : (
              <tbody key={g.type} role="rowgroup">
                <tr role="row" className="group-row"><th data-command="tagPage.c2" colSpan={4} scope="rowgroup"><span data-user-content>{typeNames[g.type] ?? g.type}</span> {g.rows.length}</th></tr>
                {rows}
              </tbody>
            );
          })}
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
