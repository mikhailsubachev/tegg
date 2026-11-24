// The type page (FR-TYP-09, D-233; ms3-shell §14.7): header with the type icon, plural, description, count, `Type
// settings` and `New <Name>`; the view tab `All <Plural>`; a title filter; a read-only table of Title, the preview
// chosen columns from one index query (D-241), sortable per column with the choice kept in the machine-local UI state
// (AC-3). `Columns` (D-252, D-1240…D-1245) checks, unchecks and offers `New property…`; headers are dragged or moved
// with ⌥←/⌥→ to reorder (D-1244), one `columns` write each; widths are resized by pointer or keyboard and kept in the
// machine-local UI state (D-1241, D-1248, D-1249). Rows are windowed beyond 100 (AC-33). Nothing here writes a note.
import { RefElement } from '../preview/useReference';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { chipIcon } from '../links/icons';
import { canDefine, validate } from '@tegg/schema';
import { parse as parseDoc } from '@tegg/doc';
import { t } from '../i18n/catalog';
import { collator } from '../i18n/collate';
import { ipc } from '../ipc/client';
import type { AttributeDto, LinkTargetDto, TypeDto, TypeRowDto, TypeSortValue } from '../ipc/types';
import type { SortDto } from '../ipc/queries';
import { headerClick, markers, buttonText } from '../queries/sort';
import { SortPopover, sortKeyName } from '../queries/SortPopover';
import { levelsOf, sortTypeRows } from '../views/allSort';
import { keepRow, tagFilterKey } from '../views/tagFilter';
import { setTagFilter, tagFilterOf } from '../views/uiState';
import { TagFilterControl } from '../views/TagFilterControl';
import { TasksSummary } from '../views/TasksSummary';
import { Icon, typeIconName } from '../shell/Icon';
import { TypeSettingsButton } from '../shell/TypeSettingsButton';
import { NewPropertyDialog } from './TypeSettingsPage';
import { PopupMenu, type MenuEntry } from '../shell/Menu';
import { trashRequest } from '../trash/moveToTrash';
import type { TypeOpDto } from '../ipc/types';
import { typeErrorMessage } from '../types/util';
import { attrTypeLabel, colorName, dateText, dateTimeText, nfc, rawText, wiki } from '../types/util';

import { WIDTH, clampWidth, columnChoices, columnsRequest, defaultSort, dropColumn, effectiveColumns, moveColumn, toggleColumn } from '../types/columns';
import { HeaderCell } from '../tables/HeaderCell';
import { TypeViews, hasViews } from '../views/TypeViews';
import { useAllDisplay } from '../views/AllDisplay';
import { useCardsHandler } from '../cards/actions';
import { openIconPicker } from '../icons/IconPicker';

export type TypeSort = { column: string; dir: 'asc' | 'desc' };
/** Column widths in px by column key (D-1241); a missing key is the R130 default. */
export type ColumnWidths = Record<string, number>;
/** Rows rendered at most (AC-33): beyond this many the table windows its rows. */
const MAX_ROWS = 100;

const UNIVERSAL: Record<string, string> = { tags: 'attr.tags', aliases: 'attr.aliases', source: 'attr.source', created: 'attr.created', modified: 'attr.modified', review: 'attr.review' };

import { TypeCell as Cell, type TypeColumn as Column } from '../types/cell';
import { usePinMenuEntry } from '../pinned/PinMenu';
import { pinDragSource } from '../pinned/drag';
import { typeIconName as pinIconName } from '../shell/Icon';
import { PageHeading } from '../phone/PageHeading';
import { isPhone } from '../phone/layout';
import { phoneSortLine } from '../phone/sortLine';

const fold = (s: string) => nfc(s).toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').normalize('NFC');
const isEmpty = (v: unknown) => v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);
const instant = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v) ? Date.parse(v) : NaN);
const isYmd = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));

/** The value a column sorts by, or null (empty and invalid values sort last in both directions). */
function sortValue(row: TypeRowDto, col: Column): number | string | null {
  if (col.key === 'title') return row.title;
  if (col.key === 'modified' || col.key === 'created') { const n = instant(col.key === 'modified' ? row.modified : row.created); return Number.isNaN(n) ? null : n; }
  const a = col.attr;
  const v = a?.type === 'date-range' ? row.values[`${col.key}-start`] : row.values[col.key];
  if (isEmpty(v)) return null;
  switch (a?.type) {
    case 'date': case 'date-range': return isYmd(v) ? v : null;
    case 'date-time': { const n = instant(v); return Number.isNaN(n) ? null : n; }
    case 'number': return typeof v === 'number' ? v : null;
    case 'checkbox': return typeof v === 'boolean' ? (v ? 1 : 0) : null;
    default: return rawText(Array.isArray(v) ? v.map((x) => wiki(x)?.alias ?? wiki(x)?.target ?? x) : wiki(v)?.alias ?? wiki(v)?.target ?? v);
  }
}

export function TypePage({ typeKey, type, types, plural, refresh, heading, sort, onSort, widths, onWidths, onOpen, onSettings, onNew, onTag, onDefine, header, tab, tabNonce, openAddView }: {
  typeKey: string;
  /** Slice OC (types.md FR-TYP-01 AC-26): type settings' `Add view` opens the views' `Add view` menu here. */
  openAddView?: boolean;
  /** The definition, or undefined for a `type` value without one (D-121). */
  type: TypeDto | undefined;
  types: TypeDto[];
  plural: string;
  refresh: number;
  heading: React.RefObject<HTMLHeadingElement | null>;
  /** Q2-T (§30.3): the stored levels (a 0.4.x single value reads as one level). */
  sort: TypeSortValue | TypeSort | undefined;
  /** One `ui_state_set` writing the whole list; null deletes the key (the page's default, §29.7). */
  onSort: (s: SortDto[] | null) => void;
  /** Q2-T (§29.1): the view tab the route asks for. */
  tab?: string;
  /** Changes with each navigation (a repeated request for `tab`). */
  tabNonce?: number;
  /** This type's stored column widths, and their replacement (D-1241: machine-local UI state). */
  widths?: ColumnWidths;
  onWidths?: (w: ColumnWidths) => void;
  onOpen: (path: string) => void;
  onSettings: () => void;
  onNew: () => void;
  onTag: (key: string) => void;
  /** D-251: open `New type` for this undefined value, as written. */
  onDefine?: (value: string) => void;
  /** D-516: a page header in place of the type's (the Tasks header on `type/task`), whose tablist replaces the view tab. */
  header?: React.ReactNode;
}) {
  const [rows, setRows] = useState<TypeRowDto[] | null>(null);
  const [filter, setFilter] = useState('');
  // Q2-T (§29.6): `All <plural>`'s tag selection, machine-local under `all:<type>`.
  const allTagKey = tagFilterKey({ kind: 'all', typeKey });
  const [tagSel, setTagSel] = useState<string[]>(() => tagFilterOf(allTagKey));
  const chooseTags = (tags: string[]) => { setTagSel(tags); setTagFilter(allTagKey, tags); };
  const [sortOpen, setSortOpen] = useState(false);
  const sortBtn = useRef<HTMLButtonElement | null>(null);
  const [adding, setAdding] = useState(false);
  const [rowMenu, setRowMenu] = useState<HTMLElement | null>(null);
  const pinEntry = usePinMenuEntry();
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [notice, setNotice] = useState<{ text: string; alert: boolean } | null>(null);
  // The type as last written from this page, so quick toggles build on each other (D-252).
  const [local, setLocal] = useState<TypeDto | null>(null);
  // Writes go one after another, each from the last result (AC-20 (h)); `latest` is what the next one builds on.
  const queue = useRef<Promise<void>>(Promise.resolve());
  const pending = useRef(0);
  const latest = useRef<TypeDto | undefined>(type);
  // The type as the last write returned it: the version the next queued write is based on.
  const disk = useRef<TypeDto | null>(null);
  // Bumped by a refused or failed write: the writes queued behind it are dropped, never sent on top of the outside
  // change (NFR-REL-02, AC-27 (a)).
  const generation = useRef(0);
  // The latest `type` prop; one that arrives while writes are pending is applied once they are done (AC-28).
  const typeNow = useRef(type);
  const typeMissed = useRef(false);
  useEffect(() => {
    typeNow.current = type;
    if (pending.current === 0) { setLocal(null); latest.current = type; disk.current = null; } else typeMissed.current = true;
  }, [type]);
  const cur = local ?? type;
  const [cursor, setCursor] = useState(0);
  const tbody = useRef<HTMLTableSectionElement | null>(null);
  const addBtn = useRef<HTMLButtonElement | null>(null);
  // One index query per type and vault change (D-241); StrictMode's second effect run doesn't query again.
  const asked = useRef<string | null>(null);
  const seq = useRef(0);
  useEffect(() => {
    const want = `${typeKey}\n${refresh}`;
    if (asked.current === want) return;
    asked.current = want;
    const mine = ++seq.current;
    ipc.typeRows(typeKey).then((r) => { if (mine === seq.current) setRows(r); }, () => { if (mine === seq.current) setRows([]); });
  }, [typeKey, refresh]);

  // D-251: the `type:` value as written in the first object (the route only has its key).
  const [value, setValue] = useState<string | null>(null);
  const firstPath = rows?.[0]?.path;
  useEffect(() => {
    if (type || !firstPath) return;
    let live = true;
    ipc.noteRead(firstPath).then((n) => {
      const v = (parseDoc(n.text).frontmatter?.data as Record<string, unknown> | undefined)?.type;
      if (live) setValue(typeof v === 'string' && v.trim() ? v.normalize('NFC').trim() : typeKey);
    }, () => { if (live) setValue(typeKey); });
    return () => { live = false; };
  }, [type, firstPath, typeKey]);

  const columns: Column[] = useMemo(() => [
    { key: 'title', label: t('typePage.title'), attr: null, userNamed: false },
    ...effectiveColumns(cur).map((k) => columnOf(cur, k)),
  ], [cur]);

  // D-1246: a remembered sort on a column that isn't shown is set aside (kept in the UI state). Q2-T (D-1892, D-1907):
  // several levels, a 0.4.x single value read as one.
  const storedLevels = levelsOf(sort as SortDto[] | undefined).filter((l: SortDto) => columns.some((c) => c.key === l.by));
  const fallback = defaultSort(columns.slice(1).map((c) => c.key));
  const levels: SortDto[] = storedLevels.length ? storedLevels : [{ by: fallback.column, order: fallback.dir }];
  const current = { column: levels[0].by, dir: levels[0].order };
  void sortValue;
  const shown = useMemo(() => {
    if (!rows) return [];
    const q = fold(filter.trim());
    const list = rows.filter((r) => (!q || fold(r.title).includes(q)) && keepRow({ tags: r.tags ?? [] }, tagSel));
    return sortTypeRows(list, levels, type ?? ({ attributes: [] } as unknown as TypeDto), collator()) as TypeRowDto[];
  }, [rows, filter, tagSel, JSON.stringify(levels), columns, type]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- widths (D-1241, D-1248): stored per column; Title without one fills what the others leave (≥ 240 px).
  const scrollBox = useRef<HTMLDivElement | null>(null);
  const [boxWidth, setBoxWidth] = useState(0);
  useLayoutEffect(() => {
    const el = scrollBox.current;
    if (!el) return;
    setBoxWidth(el.clientWidth);
    const ro = new ResizeObserver(() => setBoxWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // A drag or key presses change `draft` at once; the UI state gets it on release, or 500 ms after the last key.
  const [draft, setDraft] = useState<ColumnWidths | null>(null);
  const saveTimer = useRef<number | undefined>(undefined);
  const stored = draft ?? widths ?? {};
  const others = columns.slice(1).reduce((n, c) => n + (stored[c.key] ?? WIDTH.default), 0);
  const widthOf = (key: string) => stored[key] ?? (key === 'title' ? Math.max(WIDTH.titleFill, boxWidth - others) : WIDTH.default);
  const tableWidth = widthOf('title') + others;
  const commitWidths = (w: ColumnWidths) => { window.clearTimeout(saveTimer.current); flush.current = null; setDraft(null); onWidths?.(w); };
  const setWidth = (key: string, px: number | null, save: 'now' | 'later' | 'no') => {
    const next = { ...stored };
    // AC-30: resizing a column never changes another's width, so a filling Title keeps the width it has now.
    if (key !== 'title' && next.title === undefined) next.title = widthOf('title');
    if (px === null) delete next[key]; else next[key] = clampWidth(key, px);
    if (save === 'now') { commitWidths(next); return; }
    setDraft(next);
    if (save === 'later') {
      window.clearTimeout(saveTimer.current);
      flush.current = () => onWidths?.(next);
      saveTimer.current = window.setTimeout(() => { flush.current = null; commitWidths(next); }, 500);
    }
  };
  // A keyboard change still waiting to be stored is stored when the page goes away (AC-32: within 1 s).
  const flush = useRef<(() => void) | null>(null);
  useEffect(() => () => { window.clearTimeout(saveTimer.current); flush.current?.(); }, []);

  // ---- row windowing (AC-33): at most MAX_ROWS rows in the DOM; the first and last rendered rows carry the space of
  // the rows left out, so the page's scroll height stays that of the whole table.
  const win = useRowWindow(tbody, scrollBox, shown.length);
  // AC-30: a cut cell shows its full text as a tooltip.
  useLayoutEffect(() => {
    for (const td of tbody.current?.querySelectorAll<HTMLTableCellElement>('td') ?? []) {
      const text = (td.textContent ?? '').trim();
      if (td.title !== text) td.title = text;
    }
  });

  const activate = (key: string, shift = false) => onSort(headerClick(levels, key, shift));
  const marks = markers(levels);
  const focusRow = (i: number) => {
    const n = Math.max(0, Math.min(shown.length - 1, i));
    setCursor(n);
    const focus = () => {
      const scroller = scrollBox.current, x = scroller?.scrollLeft ?? 0;
      (tbody.current?.querySelector<HTMLElement>(`tr[data-index="${n}"]`))?.focus();
      // AC-29: moving between rows never scrolls sideways.
      if (scroller) scroller.scrollLeft = x;
    };
    if (n >= win.from && n < win.to) focus();
    else { win.reveal(n); requestAnimationFrame(focus); }
  };
  const name = type?.name ?? typeKey;
  const pluralName = type?.plural ?? plural;
  const writable = !!type && type.state === 'ok';
  // Slice Q3 (§41.10; D-2178, CP-34): `All <plural>`'s display and grouping on this Mac.
  const allOn = !header && !!type && hasViews(typeKey, type);
  const allDisplay = useAllDisplay({ type, typeKey, plural: pluralName, sort: levels, filterText: filter, tags: tagSel, types, on: allOn, onSort: (s) => onSort(s) });
  // D-1245: a `columns` value that isn't a list disables the menu until it is fixed in the file.
  const menuOk = writable && !type.columnsUnreadable;
  const columnsReason = !type ? undefined : type.state === 'newer' ? t('ts.newer') : type.state !== 'ok' ? t('typePage.columnsInvalid')
    : t('typePage.columnsUnreadable', { file: `.tegg/types/${type.key}.yml` });
  // D-1249: the palette's `Choose columns…` and `Reset column widths` act on this page.
  const request = useRef<(what: 'choose' | 'reset') => void>(() => {});
  request.current = (what) => {
    if (what === 'reset') commitWidths({});
    else if (menuOk) { setNotice(null); setColumnsOpen(true); }
  };
  useEffect(() => {
    const h = (what: 'choose' | 'reset') => request.current(what);
    columnsRequest.current = h;
    return () => { if (columnsRequest.current === h) columnsRequest.current = null; };
  }, []);
  const gone = !type && rows !== null && rows.length === 0;
  // Slice AND-2 (android-phone §9.5, RA11): on the phone the page is view only: no Type settings, New, filter, tags,
  // sort button, Columns, row menu or drags; the view-only line in place of the toolbar.
  const phone = isPhone();

  if (gone) {
    return (
      <div className="page-column">
        <PageHeading ref={heading} tabIndex={-1}><span data-user-content>{plural}</span></PageHeading>
        <p role="status" className="empty">{t('typePage.gone')}</p>
      </div>
    );
  }

  /** One `columns` write (D-1240), queued after the previous one and based on its result; a file changed outside
   *  Tegg is refused with the alert of FR-TYP-01 AC-7 and the page shows the disk state. `keys` builds the list from
   *  the type as last written (or as shown, while writes are pending). */
  const writeColumns = (keys: (t: TypeDto) => string[] | null) => {
    const base = latest.current;
    if (!base || base.state !== 'ok' || base.columnsUnreadable) return;
    const list = keys(base);
    if (!list) return;
    const shown: TypeDto = { ...base, columns: list };
    latest.current = shown;
    setLocal(shown);
    pending.current++;
    const gen = generation.current;
    queue.current = queue.current.then(async () => {
      try {
        if (gen !== generation.current) return; // an earlier write was refused: this change is dropped
        const on = disk.current ?? base;
        const next = await ipc.typePatch(on.key, on.exists ? on.version : null, [{ op: 'columns', keys: list }]);
        disk.current = next;
        setNotice(null);
      } catch (e) {
        generation.current++;
        const x = e as { kind?: string; disk?: TypeDto };
        disk.current = x.kind === 'Conflict' && x.disk ? x.disk : null;
        latest.current = disk.current ?? typeNow.current;
        setLocal(disk.current);
        setNotice({ text: x.kind === 'Conflict' && x.disk ? t('ts.conflict', { field: t('typePage.columns') }) : typeErrorMessage(e), alert: true });
      } finally {
        if (--pending.current === 0) {
          if (typeMissed.current) {
            // A vault change came in meanwhile: show the type as it is now.
            typeMissed.current = false;
            disk.current = null;
            latest.current = typeNow.current;
            setLocal(null);
          } else if (disk.current) { latest.current = disk.current; setLocal(disk.current); }
        }
      }
    });
  };
  // Slice OC (v1-cards §11): `Change type icon…` opens the picker on the header's icon; one write of the `icon:` line.
  const badge = useRef<HTMLSpanElement | null>(null);
  useCardsHandler({
    add: () => {}, reset: () => {}, addDisabled: () => null, resetDisabled: () => null,
    changeIcon: () => {
      const ty = latest.current ?? type;
      if (!ty || ty.state !== 'ok' || !badge.current) return;
      const current = ty.resolvedIcon?.name ?? null;
      openIconPicker({
        anchor: badge.current, title: ty.name, current, allowNone: false,
        onChoose: (n) => {
          if (!n || n === current) return;
          void ipc.typePatch(ty.key, ty.exists ? ty.version : null, [{ op: 'set', field: 'icon', value: n }]).then((next) => { disk.current = next; latest.current = next; setLocal(next); },
            (e) => { const x = e as { kind?: string }; setNotice({ text: x.kind === 'Conflict' ? t('ts.conflict', { field: t('ts.icon') }) : typeErrorMessage(e), alert: true }); });
        },
      });
    },
  });
  /** The type to build a write outside the queue on (`New property…`), once the queued writes are done. */
  const settled = async (): Promise<TypeDto | undefined> => { await queue.current; return disk.current ?? latest.current; };

  return (
    <div className="page-column page-wide type-page">
      {header ?? <header className="page-header type-header">
        <span ref={badge} className="type-badge" data-type-icon="" aria-hidden="true" style={{ ['--type' as string]: `var(--type-${colorName(type?.color)})` }}>
          <Icon name={typeIconName(typeKey, type?.icon)} size={20} />
        </span>
        <div className="type-header-text">
          <PageHeading ref={heading} tabIndex={-1}><span data-user-content>{pluralName}</span></PageHeading>
          {type?.description && <p className="type-description" data-user-content>{type.description}</p>}
          {rows && typeKey.normalize('NFC') === 'task' && type ? <TasksSummary refresh={refresh} /> : rows && <p className="type-count">{t('typePage.countPlural', { count: rows.length, plural: '\u0000' }).split('\u0000')[0]}<span data-user-content>{pluralName}</span>{t('typePage.countPlural', { count: rows.length, plural: '\u0000' }).split('\u0000')[1]}</p>}
        </div>
        {type && !phone && (
          <div className="page-actions">
            <TypeSettingsButton onClick={onSettings} />
            <button tabIndex={0} type="button" className="text-button primary" data-command="type.newObject" onClick={onNew}>
              {t('cmd.newOfType', { name: '\u0000' }).split('\u0000')[0]}<span data-user-content>{name}</span>{t('cmd.newOfType', { name: '\u0000' }).split('\u0000')[1]}
            </button>
          </div>
        )}
      </header>}
      {!type && <p role="note" className="type-note">{t('typePage.noDefinition', { value: plural })}</p>}
      {!type && onDefine && !phone && (() => {
        // The value as written, once a row is read; until then its key (the route has only the key).
        const v = value ?? typeKey;
        const ok = canDefine(v).ok;
        const [before, after = ''] = t('typePage.createType').split('{value}');
        return (
          <p className="type-define">
            <button type="button" className="text-button" data-command="typePage.createType" aria-disabled={ok ? undefined : 'true'}
              aria-description={ok ? undefined : t('typePage.cannotDefine')} title={ok ? undefined : t('typePage.cannotDefine')}
              onClick={() => { if (ok) onDefine(v); }}>
              {before}<span data-user-content>{v}</span>{after}
            </button>
          </p>
        );
      })()}
      {(() => {
        const views = !header && !!type && hasViews(typeKey, type);
        // Slice Q2 (D-1767, AP-1500): with view tabs the All tab's sorted header shows its arrow as text too, as the views do.
        const marked = views && !!type?.views?.length;
        const filterField = (
          <input type="search" role="searchbox" className="type-filter" data-command={typeKey.normalize('NFC') === 'task' ? 'tasks.search' : undefined} aria-label={t('typePage.filter', { plural: pluralName })} placeholder={t('typePage.filter', { plural: pluralName })}
            value={filter} spellCheck={false} autoComplete="off" onChange={(e) => setFilter(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setFilter(''); } else if (e.key === 'ArrowDown') { e.preventDefault(); focusRow(0); } }} />
        );
        const columnsButton = type && (
          <button ref={addBtn} type="button" className="text-button" data-command="typePage.columns" aria-haspopup="menu" aria-expanded={columnsOpen}
            aria-disabled={menuOk ? undefined : 'true'} aria-description={menuOk ? undefined : columnsReason}
            onClick={() => { if (menuOk) { setNotice(null); setColumnsOpen((o) => !o); } }}>
            <Icon name="panel" size={12} />{t('typePage.columns')}
          </button>
        );
        const body = (
          <>
            {rows && (filter.trim() || tagSel.length > 0) && shown.length === 0 && <p role="status" className="empty">{t('typePage.noMatch', { plural: pluralName, text: filter.trim() })}</p>}
            <div className="table-scroll" ref={scrollBox}>
              <table className={`type-table${marked ? ' marked-sort' : ''}`} aria-label={pluralName} style={{ width: tableWidth }}>
                <colgroup>{columns.map((c) => <col key={c.key} style={{ width: widthOf(c.key) }} />)}</colgroup>
                <thead>
                  <tr>
                    {columns.map((c, i) => {
                      const level = levels.findIndex((l) => l.by === c.key);
                      const order = level >= 0 ? levels[level].order : null;
                      const m = marks.get(c.key) ?? null;
                      return (
                        <HeaderCell key={c.key} col={c} first={i === 0} width={widthOf(c.key)}
                          ariaSort={level === 0 ? (order === 'asc' ? 'ascending' : 'descending') : level > 0 ? undefined : 'none'}
                          description={level > 0 ? t('sort.level', { n: level + 1, order: t(order === 'asc' ? 'sort.ascending' : 'sort.descending') }) : undefined}
                          marker={(marked || levels.length > 1) && m ? m : null}
                          movable={i > 0 && writable && !cur?.columnsUnreadable} keys scroller={scrollBox} titleWidth={widthOf('title')}
                          onSort={(shift) => activate(c.key, shift)}
                          onMove={(delta) => writeColumns((x) => moveColumn(x, c.key, delta))}
                          onDrop={(before) => writeColumns((x) => dropColumn(x, c.key, before))}
                          onWidth={(px, save) => setWidth(c.key, px, save)}
                          onCancelWidth={() => setDraft(null)} />
                      );
                    })}
                  </tr>
                </thead>
                <tbody ref={tbody}>
                  {shown.slice(win.from, win.to).map((r, j) => {
                    const i = win.from + j;
                    // AC-33: the first and last rendered rows hold the height of the rows left out above and below.
                    const padTop = j === 0 ? win.from * win.rowH : 0;
                    const padBottom = i === win.to - 1 ? (shown.length - win.to) * win.rowH : 0;
                    return (
                      // Slice P (R104 row 9, D-930): a click anywhere on the row previews it; ⏎ and a double-click open it.
                      <RefElement as="tr" reference={{ target: { path: r.path.normalize('NFC'), fragment: null, kind: 'note' }, kind: 'row', open: () => onOpen(r.path) }}
                        key={r.path} tabIndex={i === Math.min(Math.max(cursor, win.from), win.to - 1, shown.length - 1) ? 0 : -1} className="type-row"
                        data-path={r.path.normalize('NFC')} data-query-result={r.path.normalize('NFC')} data-title={r.title} data-index={i}
                        // 6A (FR-HIS-01 AC-3): the row's context menu has Move to trash (⌘⌫ on a focused row).
                        onContextMenu={(e) => { e.preventDefault(); if (phone) return; const el = e.currentTarget; el.focus(); setRowMenu(el); }}
                        {...(phone ? {} : pinDragSource({ request: { kind: 'object', path: r.path.normalize('NFC') }, label: r.title, icon: pinIconName(typeKey, type?.icon), color: type?.color }))}
                        onFocus={() => setCursor(i)}
                        onKeyDown={(e) => {
                          if (e.target !== e.currentTarget) return;
                          if (e.key === 'F10' && e.shiftKey && !phone) { e.preventDefault(); setRowMenu(e.currentTarget); return; }
                          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); focusRow(i + (e.key === 'ArrowDown' ? 1 : -1)); }
                        }}>
                        {columns.map((c) => (
                          <td key={c.key} style={padTop || padBottom ? { paddingTop: 6 + padTop, paddingBottom: 6 + padBottom } : undefined}>
                            <Cell row={r} col={c} type={type} types={types} onOpen={onOpen} onTag={onTag} typeKey={typeKey} inert={phone} />
                          </td>
                        ))}
                      </RefElement>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        );
        const sortLine = phone ? <p className="phone-sort-line">{phoneSortLine(levels, type)}</p> : null;
        if (views && type) {
          if (sortLine) return <TypeViews typeKey={typeKey} type={type} types={types} plural={pluralName} tab={tab} tabNonce={tabNonce} all={{ toolbar: sortLine, body }} />;
          const st = buttonText(levels, (k) => sortKeyName(k, type).label);
          const tagControl = <TagFilterControl rows={(rows ?? []).map((r) => ({ tags: r.tags ?? [] }))} selected={tagSel} onChange={chooseTags} allHint={typeKey.normalize('NFC') === 'task' ? t('tasks.tagAll') : null} />;
          const sortButton = (
            <button ref={sortBtn} type="button" tabIndex={0} className="text-button view-sort" aria-label={t('sort.button')} aria-haspopup="dialog" aria-expanded={sortOpen}
              data-command="sort.open" onClick={() => setSortOpen((o) => !o)}>
              <Icon name="sort" size={13} />
              <span className="sort-first">{st.text}</span>
              {st.more > 0 && <span className="sort-more">{t('sort.more', { count: st.more })}</span>}
            </button>
          );
          const ad = allDisplay;
          return <TypeViews typeKey={typeKey} type={type} types={types} plural={pluralName} tab={tab} tabNonce={tabNonce} openAdd={openAddView}
            all={{ toolbar: <div className="view-toolbar">{filterField}{tagControl}{ad.controls}{sortButton}{ad.view.view !== 'wall' && columnsButton}</div>,
              body: ad.body ?? body, attrs: ad.attrs, status: ad.status, run: ad.run, rowsDrawn: ad.rowsDrawn ?? rows !== null }} />;
        }
        if (sortLine) return <>{sortLine}{body}</>;
        return (
          <>
            <div className="page-toolbar type-toolbar">
              <span className="spacer" />
              {filterField}
              {columnsButton}
            </div>
            {body}
          </>
        );
      })()}
      {rows && rows.length === 0 && <p className="empty">{t('typePage.empty')}</p>}
      {notice && <p role={notice.alert ? 'alert' : 'status'} className={notice.alert ? 'warning-text' : 'type-notice'}>{notice.text}</p>}
      {rowMenu && (
        <PopupMenu label={t('typePage.rowMenu')} anchor={rowMenu} onClose={() => { const el = rowMenu; setRowMenu(null); el.focus(); }}
          entries={[
            // Slice PIN (R134): Open, Pin to sidebar / Unpin from sidebar, then Move to trash after a separator.
            { kind: 'item', key: 'open', label: t('pinned.open'), content: <span className="menu-title">{t('pinned.open')}</span>,
              onChoose: () => { const el = rowMenu; setRowMenu(null); const path = el.getAttribute('data-path'); if (path) onOpen(path); } },
            ...(() => { const path = rowMenu.getAttribute('data-path') ?? ''; const e = pinEntry({ request: { kind: 'object', path }, label: rowMenu.getAttribute('data-title') ?? '' }, () => { const el = rowMenu; setRowMenu(null); el.focus(); }); return e ? [e] : []; })(),
            { kind: 'separator' },
            { kind: 'item', key: 'trash', label: t('cmd.trash'), content: t('cmd.trash'),
            onChoose: () => { const el = rowMenu; setRowMenu(null); el.focus(); trashRequest.current?.(); } }]} />
      )}
      {sortOpen && type && (
        <SortPopover sort={levels} type={type} anchor={sortBtn.current} scope="thisMac" onUseQuery={null}
          onChange={(next) => onSort(next)} onClear={() => onSort(null)}
          onClose={() => { setSortOpen(false); sortBtn.current?.focus(); }} />
      )}
      {columnsOpen && cur && (
        <PopupMenu label={t('typePage.columns')} anchor={addBtn.current} onClose={() => setColumnsOpen(false)} disabledFocusable scrollable
          entries={columnEntries(cur, (key, on) => writeColumns((x) => toggleColumn(x, key, on)), () => { setColumnsOpen(false); setAdding(true); },
            () => commitWidths({}))} />
      )}
      {adding && cur && (
        <NewPropertyDialog type={cur} types={types} fresh={settled}
          onClose={() => { setAdding(false); addBtn.current?.focus(); }}
          onDone={() => { setAdding(false); addBtn.current?.focus(); }} />
      )}
    </div>
  );
}

/** R130 (D-1242): Title (always shown), the type's attributes in schema order, then Tags, Source, Aliases, Review
 *  (while the workflow is on), Created, Modified; checked = an effective column; then `New property…` and
 *  `Reset column widths`. No limit (D-1240). */
function columnEntries(type: TypeDto, toggle: (key: string, on: boolean) => void, onNewProperty: () => void, onReset: () => void): MenuEntry[] {
  const shown = new Set(effectiveColumns(type));
  const out: MenuEntry[] = [];
  if (type.columnsIgnored.length) {
    out.push({ kind: 'note', key: 'ignored', content: <span className="warning-text">{t('typePage.columnsIgnored', { type: type.name, keys: type.columnsIgnored.join(', ') })}</span> });
  }
  const check = (on: boolean) => <span className="menu-check" aria-hidden="true">{on && <Icon name="check" size={14} />}</span>;
  out.push({
    kind: 'checkbox', key: 'title', label: t('typePage.title'), checked: true, disabled: true, description: t('typePage.alwaysShown'),
    content: <>{check(true)}<span className="menu-title">{t('typePage.title')}</span></>, onChoose: () => {},
  });
  for (const k of columnChoices(type)) {
    const c = columnOf(type, k);
    const on = shown.has(k);
    out.push({
      kind: 'checkbox', key: k, label: c.label, checked: on,
      content: <>{check(on)}<span className="menu-title" data-user-content={c.userNamed ? '' : undefined}>{c.label}</span></>,
      onChoose: () => toggle(k, !on),
    });
  }
  out.push({ kind: 'separator' });
  // D-693: no new property on the Tag type.
  if (type.key !== 'tag') out.push({ kind: 'item', key: 'new', label: t('typePage.newProperty'), content: <span className="menu-title">{t('typePage.newProperty')}</span>, onChoose: onNewProperty });
  out.push({ kind: 'separator' });
  out.push({ kind: 'item', key: 'reset', label: t('typePage.resetWidths'), content: <span className="menu-title">{t('typePage.resetWidths')}</span>, onChoose: onReset });
  return out;
}


/** The label and attribute of a column key (R130 names: an attribute's Name, else the universal label). */
function columnOf(type: TypeDto | undefined, key: string): Column {
  const a = type?.attributes.find((x) => nfc(x.key) === key);
  if (a) return { key: a.key, label: a.name, attr: a as AttributeDto, userNamed: true };
  return { key, label: key === 'modified' ? t('typePage.modified') : t(UNIVERSAL[key] ?? key), attr: null, userNamed: false };
}

/** The nearest ancestor that scrolls vertically (the page), or null for the document. */
function verticalScroller(el: HTMLElement | null): HTMLElement | null {
  for (let p = el?.parentElement ?? null; p; p = p.parentElement) {
    if (['auto', 'scroll'].includes(getComputedStyle(p).overflowY)) return p;
  }
  return null;
}

/** Which rows to render: all up to MAX_ROWS, else a window around the visible part of the page (AC-33). */
function useRowWindow(tbody: React.RefObject<HTMLTableSectionElement | null>, box: React.RefObject<HTMLDivElement | null>, count: number) {
  const [start, setStart] = useState(0);
  const rowH = useRef(33);
  const windowed = count > MAX_ROWS;
  useEffect(() => {
    if (!windowed) { setStart(0); return; }
    const scroller = verticalScroller(box.current);
    const target: HTMLElement | Window = scroller ?? window;
    const update = () => {
      const body = tbody.current;
      if (!body) return;
      const sample = body.querySelector<HTMLElement>('tr[data-index]:not(:first-child)');
      if (sample) rowH.current = sample.getBoundingClientRect().height || rowH.current;
      const top = scroller ? scroller.getBoundingClientRect().top : 0;
      const view = scroller ? scroller.clientHeight : window.innerHeight;
      const first = Math.floor((top - body.getBoundingClientRect().top) / rowH.current);
      const want = Math.max(0, Math.min(count - MAX_ROWS, first - Math.floor((MAX_ROWS - Math.ceil(view / rowH.current)) / 2)));
      setStart((s) => (s === want ? s : want));
    };
    update();
    target.addEventListener('scroll', update, { passive: true });
    return () => target.removeEventListener('scroll', update);
  }, [windowed, count, tbody, box]);
  const from = windowed ? Math.min(start, count - MAX_ROWS) : 0;
  const to = windowed ? from + MAX_ROWS : count;
  return {
    from, to, rowH: rowH.current,
    /** Brings row `i` into the rendered window (keyboard moves past its edge). */
    reveal: (i: number) => { if (windowed && (i < from || i >= to)) setStart(Math.max(0, Math.min(count - MAX_ROWS, i - MAX_ROWS / 2))); },
  };
}

