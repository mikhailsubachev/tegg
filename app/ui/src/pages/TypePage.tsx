// The type page (FR-TYP-09, D-233; ms3-shell §14.7): header with the type icon, plural, description, count, `Type
// settings` and `New <Name>`; the view tab `All <Plural>`; a title filter; a read-only table of Title, the preview
// properties and Modified from one index query (D-241), sortable per column with the choice kept in the machine-local
// UI state (AC-3). `Columns` (D-252, D-260) checks and unchecks the preview properties, one write each, up to 4
// (D-72), and offers `New property…`. Nothing here writes a note.
import { useEffect, useMemo, useRef, useState } from 'react';
import { chipIcon } from '../links/icons';
import { canDefine, validate } from '@tegg/schema';
import { parse as parseDoc } from '@tegg/doc';
import { t } from '../i18n/catalog';
import { collator } from '../i18n/collate';
import { ipc } from '../ipc/client';
import type { AttributeDto, LinkTargetDto, TypeDto, TypeRowDto } from '../ipc/types';
import { Disabled } from '../shell/Disabled';
import { Icon, typeIconName } from '../shell/Icon';
import { NewPropertyDialog } from './TypeSettingsPage';
import { PopupMenu, type MenuEntry } from '../shell/Menu';
import type { TypeOpDto } from '../ipc/types';
import { typeErrorMessage } from '../types/util';
import { attrTypeLabel, colorName, dateText, dateTimeText, nfc, rawText, wiki } from '../types/util';

export type TypeSort = { column: string; dir: 'asc' | 'desc' };
const DEFAULT_SORT: TypeSort = { column: 'modified', dir: 'desc' };

const UNIVERSAL: Record<string, string> = { tags: 'attr.tags', aliases: 'attr.aliases', source: 'attr.source', created: 'attr.created', modified: 'attr.modified', review: 'attr.review' };

import { TypeCell as Cell, type TypeColumn as Column } from '../types/cell';

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

export function TypePage({ typeKey, type, types, plural, refresh, heading, sort, onSort, onOpen, onSettings, onNew, onTag, onDefine }: {
  typeKey: string;
  /** The definition, or undefined for a `type` value without one (D-121). */
  type: TypeDto | undefined;
  types: TypeDto[];
  plural: string;
  refresh: number;
  heading: React.RefObject<HTMLHeadingElement | null>;
  sort: TypeSort | undefined;
  onSort: (s: TypeSort) => void;
  onOpen: (path: string) => void;
  onSettings: () => void;
  onNew: () => void;
  onTag: (key: string) => void;
  /** D-251: open `New type` for this undefined value, as written. */
  onDefine?: (value: string) => void;
}) {
  const [rows, setRows] = useState<TypeRowDto[] | null>(null);
  const [filter, setFilter] = useState('');
  const [adding, setAdding] = useState(false);
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [notice, setNotice] = useState<{ text: string; alert: boolean } | null>(null);
  // The type as last written from this page, so quick toggles build on each other (D-252).
  const [local, setLocal] = useState<TypeDto | null>(null);
  useEffect(() => { setLocal(null); }, [type]);
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

  const columns: Column[] = useMemo(() => {
    const out: Column[] = [{ key: 'title', label: t('typePage.title'), attr: null, userNamed: false }];
    for (const k of type?.preview ?? []) {
      const a = type?.attributes.find((x) => nfc(x.key) === nfc(k));
      if (a) out.push({ key: a.key, label: a.name, attr: a as AttributeDto, userNamed: true });
      else if (UNIVERSAL[k] && k !== 'modified') out.push({ key: k, label: t(UNIVERSAL[k]), attr: null, userNamed: false });
    }
    out.push({ key: 'modified', label: t('typePage.modified'), attr: null, userNamed: false });
    return out;
  }, [type]);

  const current = sort && columns.some((c) => c.key === sort.column) ? sort : DEFAULT_SORT;
  const shown = useMemo(() => {
    if (!rows) return [];
    const q = fold(filter.trim());
    const list = q ? rows.filter((r) => fold(r.title).includes(q)) : [...rows];
    const col = columns.find((c) => c.key === current.column) ?? columns[columns.length - 1];
    const c = collator();
    const dir = current.dir === 'asc' ? 1 : -1;
    const byTitle = (a: TypeRowDto, b: TypeRowDto) => c.compare(a.title, b.title);
    return list.sort((a, b) => {
      const va = sortValue(a, col), vb = sortValue(b, col);
      if (va === null || vb === null) return va === vb ? byTitle(a, b) : va === null ? 1 : -1;
      const d = typeof va === 'number' && typeof vb === 'number' ? va - vb : c.compare(String(va), String(vb));
      return d !== 0 ? d * dir : byTitle(a, b);
    });
  }, [rows, filter, current.column, current.dir, columns]);

  const activate = (key: string) => onSort(current.column === key ? { column: key, dir: current.dir === 'asc' ? 'desc' : 'asc' } : { column: key, dir: 'asc' });
  const focusRow = (i: number) => {
    const n = Math.max(0, Math.min(shown.length - 1, i));
    setCursor(n);
    (tbody.current?.querySelectorAll<HTMLElement>('tr')[n])?.focus();
  };
  const name = type?.name ?? typeKey;
  const pluralName = type?.plural ?? plural;
  const writable = !!type && type.state === 'ok';
  const gone = !type && rows !== null && rows.length === 0;

  if (gone) {
    return (
      <div className="page-column">
        <h1 ref={heading} tabIndex={-1}><span data-user-content>{plural}</span></h1>
        <p role="status" className="empty">{t('typePage.gone')}</p>
      </div>
    );
  }

  /** One `preview` write (D-252); a file changed outside Tegg is refused with the alert of FR-TYP-01 AC-7. */
  const togglePreview = async (keys: string[]) => {
    if (!cur) return;
    const ops: TypeOpDto[] = [{ op: 'preview', keys }];
    setLocal({ ...cur, preview: keys });
    try {
      setLocal(await ipc.typePatch(cur.key, cur.exists ? cur.version : null, ops));
      setNotice(null);
    } catch (e) {
      const x = e as { kind?: string; disk?: TypeDto };
      if (x.kind === 'Conflict' && x.disk) {
        setLocal(x.disk);
        setNotice({ text: t('ts.conflict', { field: t('typePage.columns') }), alert: true });
      } else {
        setLocal(null);
        setNotice({ text: typeErrorMessage(e), alert: true });
      }
    }
  };

  return (
    <div className="page-column type-page">
      <header className="page-header type-header">
        <span className="type-badge" aria-hidden="true" style={{ ['--type' as string]: `var(--type-${colorName(type?.color)})` }}>
          <Icon name={typeIconName(typeKey, type?.icon)} size={20} />
        </span>
        <div className="type-header-text">
          <h1 ref={heading} tabIndex={-1}><span data-user-content>{pluralName}</span></h1>
          {type?.description && <p className="type-description" data-user-content>{type.description}</p>}
          {rows && <p className="type-count">{t('typePage.count', { count: rows.length })}</p>}
        </div>
        {type && (
          <div className="page-actions">
            <button tabIndex={0} type="button" className="text-button" data-command="type.openSettings" onClick={onSettings}>{t('cmd.typeSettings')}</button>
            <button tabIndex={0} type="button" className="text-button primary" data-command="type.newObject" onClick={onNew}>
              {t('cmd.newOfType', { name: '\u0000' }).split('\u0000')[0]}<span data-user-content>{name}</span>{t('cmd.newOfType', { name: '\u0000' }).split('\u0000')[1]}
            </button>
          </div>
        )}
      </header>
      {!type && <p role="note" className="type-note">{t('typePage.noDefinition', { value: plural })}</p>}
      {!type && onDefine && (() => {
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
      <div className="page-toolbar type-toolbar">
        <aside className="view-tabs-wrap"><div role="tablist" aria-label={t('typePage.views')} className="view-tabs">
          <span role="tab" data-command="typePage.view" aria-selected="true" tabIndex={0} className="view-tab on" data-user-content>{t('typePage.allView', { plural: pluralName })}</span>
        </div></aside>
        <span className="spacer" />
        <input type="search" role="searchbox" className="type-filter" aria-label={t('typePage.filter', { plural: pluralName })} placeholder={t('typePage.filter', { plural: pluralName })}
          value={filter} spellCheck={false} autoComplete="off" onChange={(e) => setFilter(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setFilter(''); } else if (e.key === 'ArrowDown') { e.preventDefault(); focusRow(0); } }} />
        <Disabled control="ctl.filter" />
        <Disabled control="ctl.group" />
        <Disabled control="ctl.addView" />
        {type && (
          <button ref={addBtn} type="button" className="text-button" data-command="typePage.columns" aria-haspopup="menu" aria-expanded={columnsOpen}
            aria-disabled={writable ? undefined : 'true'} aria-description={writable ? undefined : t(type.state === 'newer' ? 'typePage.columnsNewer' : 'typePage.columnsInvalid')}
            onClick={() => { if (writable) { setNotice(null); setColumnsOpen((o) => !o); } }}>
            <Icon name="panel" size={12} />{t('typePage.columns')}
          </button>
        )}
      </div>
      {rows && filter.trim() && shown.length === 0 && <p role="status" className="empty">{t('typePage.noMatch', { plural: pluralName, text: filter.trim() })}</p>}
      <div className="table-scroll">
        <table className="type-table" aria-label={pluralName}>
          <thead>
            <tr>
              {columns.map((c) => {
                const on = current.column === c.key;
                return (
                  <th key={c.key} role="columnheader" tabIndex={0} aria-sort={on ? (current.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
                    className={on ? 'sorted' : ''} onClick={() => activate(c.key)}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); activate(c.key); } }}>
                    <span data-user-content={c.userNamed ? '' : undefined}>{c.label}</span>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody ref={tbody}>
            {shown.map((r, i) => (
              <tr key={r.path} tabIndex={i === Math.min(cursor, shown.length - 1) ? 0 : -1} className="type-row"
                onClick={() => onOpen(r.path)}
                onFocus={() => setCursor(i)}
                onKeyDown={(e) => {
                  if (e.target !== e.currentTarget) return;
                  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); focusRow(i + (e.key === 'ArrowDown' ? 1 : -1)); }
                  else if (e.key === 'Enter') { e.preventDefault(); onOpen(r.path); }
                }}>
                {columns.map((c) => (
                  <td key={c.key}>
                    <Cell row={r} col={c} type={type} types={types} onOpen={onOpen} onTag={onTag} typeKey={typeKey} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows && rows.length === 0 && <p className="empty">{t('typePage.empty')}</p>}
      {notice && <p role={notice.alert ? 'alert' : 'status'} className={notice.alert ? 'warning-text' : 'type-notice'}>{notice.text}</p>}
      {columnsOpen && cur && (
        <PopupMenu label={t('typePage.columns')} anchor={addBtn.current} onClose={() => setColumnsOpen(false)}
          entries={columnEntries(cur, (keys) => void togglePreview(keys), () => { setColumnsOpen(false); setAdding(true); })} />
      )}
      {adding && cur && (
        <NewPropertyDialog type={cur} types={types} withPreview
          onClose={() => { setAdding(false); addBtn.current?.focus(); }}
          onDone={(withColumn) => { setAdding(false); addBtn.current?.focus(); if (!withColumn) setNotice({ text: t('typePage.columnLimitAdded'), alert: false }); }} />
      )}
    </div>
  );
}

/** D-260: the type's attributes in schema order, then Tags, Source, Aliases, Created (`Modified` is always the last
 *  column); checked = in `preview`; with 4 chosen (hand-written keys count too) the rest are disabled. */
function columnEntries(type: TypeDto, write: (keys: string[]) => void, onNewProperty: () => void): MenuEntry[] {
  const choices: [string, string][] = [
    ...type.attributes.map((a): [string, string] => [a.key, a.name]),
    ...(['tags', 'source', 'aliases', 'created'] as const).map((k): [string, string] => [k, t(UNIVERSAL[k])]),
  ];
  const has = (k: string) => type.preview.some((p) => nfc(p) === nfc(k));
  const full = type.preview.length >= 4;
  const out: MenuEntry[] = [];
  if (type.previewIgnored.length) {
    out.push({ kind: 'note', key: 'ignored', content: <span className="warning-text">{t('ts.previewIgnored', { keys: type.previewIgnored.join(', ') })}</span> });
  }
  for (const [k, label] of choices) {
    const on = has(k);
    const off = !on && full;
    out.push({
      kind: 'checkbox', key: k, label, checked: on, disabled: off, description: off ? t('typePage.columnLimit') : undefined,
      content: <><span className="menu-check" aria-hidden="true">{on && <Icon name="check" size={14} />}</span><span className="menu-title" data-user-content>{label}</span></>,
      onChoose: () => write(on ? type.preview.filter((p) => nfc(p) !== nfc(k)) : [...type.preview, k]),
    });
  }
  out.push({ kind: 'separator' });
  out.push({ kind: 'item', key: 'new', label: t('typePage.newProperty'), content: <span className="menu-title">{t('typePage.newProperty')}</span>, onChoose: onNewProperty });
  return out;
}

