// Slice Q (board QueryBlock F, G) and Q2 (R188, D-1767, D-1784, D-1785, D-1798, D-1810): the Table body of a query block,
// a view tab and the query page. Title first (the type icon when mixed, the read-only task checkbox for a Task), then
// `columns` in order; empty cells `—`; at most 60 rows in the DOM. For a saved query (not an inline fence): a header click
// makes the column the only sort level, ⇧-click adds or flips a level (markers `↑²`, `aria-sort` on the first level only),
// a header drag reorders `columns` (Title stays first), and the resize handles keep widths per query, shared by every
// table of that query (machine-local).
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { t } from '../i18n/catalog';
import type { QueryDefDto, QueryRowDto } from '../ipc/queries';
import type { TypeDto, TypeRowDto } from '../ipc/types';
import { chipIcon } from '../links/icons';
import { RefElement } from '../preview/useReference';
import { Icon, typeIconName } from '../shell/Icon';
import { HeaderCell } from '../tables/HeaderCell';
import { WIDTH, useColumnWidths } from '../tables/widths';
import { TypeCell } from '../types/cell';
import { columnChoices, UNIVERSAL } from './model';
import { queryNav } from './nav';
import { levels, markers } from './sort';
import { isPhone } from '../phone/layout';

const nfc = (s: string) => s.normalize('NFC');
/** At most this many table rows in the DOM (§4.3, D-1482). */
const MAX_ROWS = 60;

type Col = { key: string; label: string; userNamed: boolean; sortable: boolean };

/** `columns` after a header drag: `key` right before `before` (null: last); null when nothing changes. */
export function columnsAfterDrop(columns: string[], key: string, before: string | null): string[] | null {
  const k = nfc(key);
  const rest = columns.filter((c) => nfc(c) !== k);
  if (rest.length === columns.length) return null;
  const at = before === null ? -1 : rest.findIndex((c) => nfc(c) === nfc(before));
  const out = at < 0 ? [...rest, k] : [...rest.slice(0, at), k, ...rest.slice(at)];
  return out.every((c, i) => nfc(c) === nfc(columns[i])) ? null : out;
}

export function ResultsTable({ def: fileDef, rows, types, typeOf, typeName, title, name, readOnly, plain = false, onOpen, onSort, onColumns, sort, columns, widthKey }: {
  def: QueryDefDto; rows: QueryRowDto[]; types: TypeDto[]; typeOf: (k: string) => TypeDto | undefined; typeName: (k: string) => string;
  title: string; onOpen: (path: string) => void;
  /** The saved query (widths, levels, drags); null for an inline fence (slice Q's behaviour, D-1810). */
  name: string | null;
  /** Write controls refused (a read-only query): the reason. */
  readOnly: string | null;
  /** A query block (slice Q's header semantics). */
  plain?: boolean;
  onSort: (by: string, shift: boolean) => void;
  onColumns: (columns: string[]) => void;
  /** Slice Q2.1 (R194): the usage's effective sort and columns (else the query file's). */
  sort?: QueryDefDto['sort'];
  columns?: string[];
  /** Slice Q2.1 (R198): the usage key its widths are kept under (machine-local). */
  widthKey?: string | null;
}) {
  const def = useMemo(() => ({ ...fileDef, sort: sort ?? fileDef.sort, columns: columns ?? fileDef.columns }), [fileDef, sort, columns]);
  const one = def.types.length === 1 ? typeOf(def.types[0]) : undefined;
  const mixed = def.types.length !== 1;
  const cols: Col[] = useMemo(() => {
    const out: Col[] = [{ key: 'title', label: t('typePage.title'), userNamed: false, sortable: true }];
    const choices = new Set(columnChoices(def, types));
    for (const k0 of def.columns) {
      const k = nfc(k0);
      if (!choices.has(k) || out.some((c) => c.key === k)) continue; // unknown keys are kept in the file, not shown
      if (k === 'type') { out.push({ key: k, label: t('ts.type'), userNamed: false, sortable: false }); continue; }
      const a = one?.attributes.find((x) => nfc(x.key) === k);
      if (a) { out.push({ key: k, label: a.name, userNamed: true, sortable: a.type !== 'date-range' }); continue; }
      const u = UNIVERSAL.find((x) => x.key === k);
      out.push({ key: k, label: k === 'modified' ? t('typePage.modified') : t(u?.label ?? k), userNamed: false, sortable: true });
    }
    return out;
  }, [def, types, one]);
  const body = useRef<HTMLTableSectionElement | null>(null);
  const box = useRef<HTMLDivElement | null>(null);
  const win = useRowWindow(body, rows.length);
  const [cursor, setCursor] = useState(0);
  const saved = name !== null;
  const ls = levels(def.sort);
  const marks = markers(def.sort);
  const shown = rows.slice(win.from, win.to);
  // Slice AND-2 (android-phone §9.5): on the phone a tap anywhere on a row opens it (the cells' values are inert).
  const phone = isPhone();

  // ---- widths per usage (R198, D-1845): stored per column; Title without one fills what the others leave.
  const { widths, set } = useColumnWidths({ kind: 'usage', key: saved && widthKey ? widthKey : '\u0000inline' });
  const [boxWidth, setBoxWidth] = useState(0);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    setBoxWidth(el.clientWidth);
    const ro = new ResizeObserver(() => setBoxWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const stored = saved && widthKey ? widths : {};
  const others = cols.slice(1).reduce((n, c) => n + (stored[c.key] ?? WIDTH.default), 0);
  const widthOf = (key: string) => stored[key] ?? (key === 'title' ? Math.max(WIDTH.titleFill, boxWidth - others) : WIDTH.default);
  const fixed = saved && boxWidth > 0;
  const tableWidth = widthOf('title') + others;

  const focusRow = (i: number) => {
    const j = Math.max(0, Math.min(rows.length - 1, i));
    setCursor(j);
    win.reveal(j);
    requestAnimationFrame(() => body.current?.querySelector<HTMLElement>(`tr[data-index="${j}"]`)?.focus());
  };
  return (
    <div className="query-table-box" ref={box}>
      <table className={`query-table${fixed ? ' fixed' : ''}`} aria-label={title} style={fixed ? { width: tableWidth } : undefined}>
        {fixed && <colgroup>{cols.map((c) => <col key={c.key} style={{ width: widthOf(c.key) }} />)}</colgroup>}
        <thead>
          <tr>
            {cols.map((c, i) => {
              const m = c.sortable ? marks.get(c.key) ?? null : null;
              const level = m ? ls.findIndex((l) => l.by === c.key) : -1;
              const order = level >= 0 ? ls[level].order : null;
              return (
                <HeaderCell key={c.key} col={{ key: c.key, label: c.label, userNamed: c.userNamed }} first={i === 0} width={widthOf(c.key)} sortable={c.sortable && saved}
                  ariaSort={level === 0 ? (order === 'asc' ? 'ascending' : 'descending') : undefined}
                  marker={m} description={level > 0 ? t('sort.level', { n: level + 1, order: t(order === 'asc' ? 'sort.ascending' : 'sort.descending') }) : readOnly ?? undefined}
                  disabled={!!readOnly} movable={saved && i > 0} resizable={saved} plain={plain} scroller={box} titleWidth={widthOf('title')}
                  onSort={(shift) => onSort(c.key, shift)}
                  onDrop={(before) => { const next = columnsAfterDrop(def.columns, c.key, before); if (next) onColumns(next); }}
                  onWidth={(px, save) => {
                    if (!saved || !widthKey) return;
                    if (px === null) { set(c.key, c.key === 'title' ? WIDTH.titleFill : WIDTH.default, true); return; }
                    // Resizing one column never changes another's width: a filling Title keeps the width it has now.
                    if (c.key !== 'title' && stored.title === undefined) set('title', widthOf('title'), false);
                    set(c.key, px, save === 'now' ? true : save === 'later' ? 'later' : false);
                  }} />
              );
            })}
          </tr>
        </thead>
        <tbody ref={body}>
          {win.top > 0 && <tr className="query-spacer" aria-hidden="true"><td colSpan={cols.length} style={{ height: win.top }} /></tr>}
          {shown.map((r, k) => {
            const i = win.from + k;
            const rt = typeOf(r.type);
            const done = r.task ? r.task.state === 'done' || r.task.state === 'cancelled' : false;
            return (
              <RefElement as="tr" key={r.path} data-query-result={nfc(r.path)} data-path={nfc(r.path)} data-title={r.title} data-index={i}
                tabIndex={i === Math.min(Math.max(cursor, win.from), Math.min(win.to, rows.length) - 1) ? 0 : -1} className="query-row"
                reference={{ target: { path: nfc(r.path), fragment: null, kind: 'note' }, kind: 'row', open: () => onOpen(r.path) }}
                onFocus={() => setCursor(i)}
                onKeyDown={(e: React.KeyboardEvent) => {
                  if (e.target !== e.currentTarget) return;
                  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); focusRow(i + (e.key === 'ArrowDown' ? 1 : -1)); }
                }}>
                {cols.map((c) => (
                  // Read-only cells (FR-QRY-05 AC-8): a click or double-click on a value does nothing; the title opens.
                  <td key={c.key} onClick={c.key === 'title' || phone ? undefined : (e) => e.stopPropagation()} onDoubleClick={c.key === 'title' || phone ? undefined : (e) => e.stopPropagation()}>
                    {c.key === 'title' ? (
                      <span className="cell-title">
                        {r.task && !mixed
                          ? <span role="checkbox" aria-checked={done} aria-disabled="true" aria-label={r.title} aria-description={t(isPhone() ? 'phone.viewOnly' : 'query.block.taskReadOnly')} className={`query-task-box${done ? ' done' : ''}`}>{done && <Icon name="check" size={11} />}</span>
                          : <Icon name={typeIconName(r.type, rt?.icon)} dataIcon={chipIcon(r.type).def} size={14} />}
                        <span data-user-content>{r.title}</span>
                      </span>
                    ) : c.key === 'type' ? (
                      <span className="cell-type"><Icon name={typeIconName(r.type, rt?.icon)} dataIcon={chipIcon(r.type).def} size={13} /><span data-user-content>{typeName(r.type)}</span></span>
                    ) : (
                      <Cell row={r} col={c} type={rt} types={types} />
                    )}
                  </td>
                ))}
              </RefElement>
            );
          })}
          {win.bottom > 0 && <tr className="query-spacer" aria-hidden="true"><td colSpan={cols.length} style={{ height: win.bottom }} /></tr>}
        </tbody>
      </table>
    </div>
  );
}

/** One read-only cell (the type page's renderer); `—` when empty (R141). */
function Cell({ row, col, type, types }: { row: QueryRowDto; col: Col; type: TypeDto | undefined; types: TypeDto[] }) {
  const v = col.key === 'modified' ? row.modified : col.key === 'created' ? row.created : row.values[col.key];
  const a = type?.attributes.find((x) => nfc(x.key) === col.key) ?? null;
  const empty = a?.type === 'date-range'
    ? [row.values[`${col.key}-start`], row.values[`${col.key}-end`]].every((x) => x === undefined || x === null || x === '')
    : v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);
  if (empty) return <span className="query-empty">—</span>;
  const typeRow = { path: row.path, id: row.id, title: row.title, type: row.type, created: row.created, modified: row.modified, values: row.values, links: row.links } as unknown as TypeRowDto;
  return <TypeCell row={typeRow} col={{ key: col.key, label: col.label, attr: a, userNamed: col.userNamed }} type={type} types={types}
    onOpen={(p) => queryNav()?.openNote(p)} onTag={(k) => queryNav()?.go({ id: 'tag/<key>', param: k })} typeKey={row.type} inert={isPhone()} />;
}

/** The nearest ancestor that scrolls vertically, or null for the window. */
function scrollerOf(el: HTMLElement | null): HTMLElement | null {
  for (let x = el?.parentElement ?? null; x; x = x.parentElement) {
    const o = getComputedStyle(x).overflowY;
    if ((o === 'auto' || o === 'scroll') && x.scrollHeight > x.clientHeight) return x;
  }
  return null;
}

/** The rows rendered: all up to 60, else a window around the visible part with spacers for the rest (§4.3). */
function useRowWindow(body: React.RefObject<HTMLTableSectionElement | null>, count: number) {
  const [start, setStart] = useState(0);
  const rowH = useRef(33);
  const windowed = count > MAX_ROWS;
  useLayoutEffect(() => {
    if (!windowed) { setStart(0); return; }
    const scroller = scrollerOf(body.current);
    const target: HTMLElement | Window = scroller ?? window;
    const update = () => {
      const b = body.current;
      if (!b) return;
      const sample = b.querySelector<HTMLElement>('tr[data-index]');
      if (sample) rowH.current = sample.getBoundingClientRect().height || rowH.current;
      const top = scroller ? scroller.getBoundingClientRect().top : 0;
      const view = scroller ? scroller.clientHeight : window.innerHeight;
      const first = Math.floor((top - b.getBoundingClientRect().top) / rowH.current);
      const want = Math.max(0, Math.min(count - MAX_ROWS, first - Math.floor((MAX_ROWS - Math.ceil(view / rowH.current)) / 2)));
      setStart((s) => (s === want ? s : want));
    };
    update();
    target.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    return () => { target.removeEventListener('scroll', update); window.removeEventListener('resize', update); };
  }, [windowed, count, body]);
  const from = windowed ? Math.min(start, count - MAX_ROWS) : 0;
  const to = windowed ? from + MAX_ROWS : count;
  return {
    from, to,
    top: from * rowH.current,
    bottom: Math.max(0, count - to) * rowH.current,
    reveal: (i: number) => { if (windowed && (i < from || i >= to)) setStart(Math.max(0, Math.min(count - MAX_ROWS, i - MAX_ROWS / 2))); },
  };
}
