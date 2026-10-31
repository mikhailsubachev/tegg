import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { RefElement } from './preview/useReference';
import { ipc } from './ipc/client';
import type { DateTimeUiDto, SearchResultDto, TypeDto } from './ipc/types';
import { Highlighted } from './Highlighted';
import { Icon } from './shell/Icon';
import { TypeIcon } from './icons';
import { catalogLocale, t } from './i18n/catalog';
import { collator } from './i18n/collate';
import { formatDate } from './i18n/dates';
import { TagFilter } from './tasks/TagFilter';
import { useTags } from './tags/store';
import { tagKey } from './tags/keys';
import { tagChipStyle } from './theme/tagChip';
import { PopupMenu, type MenuEntry } from './shell/Menu';
import { GoTo, type GoToKeys } from './GoTo';
import type { SearchState } from './shell/history';
import type { SwitcherItemDto } from './ipc/types';
import type { Prepared } from './types/create';

const PAGE = 50;

/** The local calendar date of an ISO date-time in the machine's zone (D-104, D-1206), as `YYYY-MM-DD`. */
function localDay(iso: string): string | null {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return null;
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** The nearest scrolling ancestor (the centre pane). */
function scroller(e: HTMLElement | null): HTMLElement | null {
  for (let n = e?.parentElement ?? null; n; n = n.parentElement) {
    if (/(auto|scroll)/.test(getComputedStyle(n).overflowY)) return n;
  }
  return null;
}

/** A catalog message with user text (`{q}`) in `data-user-content` spans (D-1230). */
function withUser(key: string, vars: Record<string, string>, user: Record<string, string>): React.ReactNode {
  const marks = Object.keys(user);
  const text = t(key, { ...vars, ...Object.fromEntries(marks.map((k, i) => [k, `\u0000${i}\u0000`])) });
  return text.split('\u0000').map((part, i) => (i % 2 === 1 ? <span key={i} data-user-content>{user[marks[Number(part)]]}</span> : part));
}

/** FR-SRC-01…04: the Search page (board `Search`; docs/contracts/v1-search.md §3, D-1200…D-1230): the query field, the
 *  Type and tag filters (D-1203, D-706), the `Go to` list (FR-NAV-01, D-760, D-1200), the count line, result rows with
 *  type, date, match line, snippet or body lead and tag chips, `Show next`, and the empty states. Its state belongs to
 *  the history entry (D-1217): `initial` restores it, `onState` reports it. */
export function Search({ onOpen, onGoTo, onCreate, onLeave, refresh, inputRef, tag, types, dateTime, initial, onState }: {
  onOpen: (path: string) => void;
  /** A `Go to` row: replaces the Search entry in the history (D-760). */
  onGoTo: (path: string) => void;
  /** Esc: back to the page Search was opened from, as the switcher closed (D-760); false when there is none. */
  onLeave: () => boolean;
  onCreate: (item: SwitcherItemDto, prepared?: Prepared | null) => void;
  refresh: number;
  inputRef: React.RefObject<HTMLInputElement | null>;
  tag?: string;
  types: TypeDto[];
  dateTime?: DateTimeUiDto;
  initial?: SearchState;
  onState?: (s: SearchState) => void;
}) {
  const [text, setText] = useState(initial?.text ?? '');
  const [type, setType] = useState<string | null>(initial?.type ?? null);
  const [tagFilter, setTagFilter] = useState<string[]>(initial?.tags ?? (tag ? [tagKey(tag)] : []));
  const prevTag = useRef(tag);
  useEffect(() => {
    if (prevTag.current === tag) return;
    prevTag.current = tag;
    setTagFilter(tag ? [tagKey(tag)] : []);
  }, [tag]);
  const all = useTags();
  const options = all.filter((r) => r.count >= 1).sort((a, b) => b.count - a.count || collator().compare(a.name, b.name)).map((r) => ({ key: r.key, label: r.name, count: r.count }));
  const colors = Object.fromEntries(all.map((r) => [r.key, r.color]));
  const tagNames = Object.fromEntries(all.map((r) => [r.key, r.name]));
  const tagName = (k: string) => tagNames[k] ?? k;
  const typeNames = useMemo(() => Object.fromEntries(types.map((x) => [x.key, x.name])), [types]);
  const typeName = (k: string) => typeNames[k || 'page'] ?? k;

  // Buttons carry tabIndex 0: WebKit's Tab reaches a button only with an explicit tabindex (as on the tag page).
  const [rows, setRows] = useState<SearchResultDto[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const loaded = useRef(initial?.loaded ?? 0);
  const totalRef = useRef<number | null>(null);
  const focusPath = useRef<string | null>(initial?.focusPath ?? null);
  const restoreFocus = useRef<string | null>(initial?.focusPath ?? null);
  const restored = useRef(!!initial);
  /** The row `Show next` focuses once it is rendered (FR-SRC-03 AC-12). */
  const focusRow = useRef<number | null>(null);
  const seq = useRef(0);
  const goto = useRef<GoToKeys>(null);
  const [active, setActive] = useState<string | undefined>();
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [menuOpen, setMenuOpen] = useState(false);
  const typeButton = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const keepScroll = useRef<{ el: HTMLElement; top: number } | null>(null);
  const query = useRef({ text, type, tagFilter });
  query.current = { text, type, tagFilter };

  const report = () => onState?.({ text: query.current.text, type: query.current.type, tags: query.current.tagFilter, loaded: loaded.current, focusPath: focusPath.current });
  useEffect(report, [text, type, tagFilter]);

  useEffect(() => {
    ipc.typeCounts().then(setCounts, () => setCounts({}));
  }, [refresh]);

  const hasText = !!text.trim();
  const hasFilter = type !== null || tagFilter.length > 0;
  const search = (offset: number, limit: number) => ipc.search({ text, types: type ? [type] : [], tags: tagFilter, offset, limit });

  // A new query: the first page (or as many rows as the restored entry had, D-1217).
  const keyOf = `${text}\u0000${type ?? ''}\u0000${tagFilter.join('\u0001')}`;
  const lastKey = useRef<string | null>(null);
  useEffect(() => {
    const n = ++seq.current;
    if (!hasText && !hasFilter) {
      lastKey.current = keyOf;
      setRows([]);
      setTotal(null);
      totalRef.current = null;
      loaded.current = 0;
      report();
      return;
    }
    const same = lastKey.current === keyOf;
    lastKey.current = keyOf;
    // The first query of a restored entry asks for the rows it had; any other new query starts at one page.
    const keep = same || restored.current ? Math.max(loaded.current, same ? 0 : PAGE) : PAGE;
    restored.current = false;
    const timer = setTimeout(async () => {
      try {
        let p = await search(0, Math.max(PAGE, keep));
        if (n !== seq.current) return;
        // D-1225: a live refresh keeps every loaded row; the new matches come on top of them.
        const old = totalRef.current;
        if (same && old !== null && p.total > old && p.results.length < p.total && keep > PAGE - 1) {
          p = await search(0, keep + (p.total - old));
          if (n !== seq.current) return;
        }
        // A live refresh keeps the scroll position, also when rows come in above the shown ones (FR-SRC-03 AC-21).
        if (same) {
          const el = scroller(list.current);
          keepScroll.current = el ? { el, top: el.scrollTop } : null;
        }
        setRows(p.results);
        setTotal(p.total);
        totalRef.current = p.total;
        loaded.current = p.results.length;
        report();
      } catch {
        /* the next change asks again */
      }
    }, same || !hasText ? 0 : 120);
    return () => clearTimeout(timer);
  }, [keyOf, refresh]);

  useLayoutEffect(() => {
    const k = keepScroll.current;
    keepScroll.current = null;
    if (k && k.el.scrollTop !== k.top) k.el.scrollTop = k.top;
  }, [rows]);

  // Back to this entry: the row that was opened gets the focus again (D-1217).
  useEffect(() => {
    const p = restoreFocus.current;
    if (p === null || !rows.length) return;
    restoreFocus.current = null;
    const a = [...(list.current?.querySelectorAll<HTMLElement>('a.result') ?? [])].find((x) => x.dataset.path === p);
    if (a) a.focus({ preventScroll: true });
    else inputRef.current?.focus({ preventScroll: true });
  }, [rows]);

  const showNext = async () => {
    const n = ++seq.current;
    const at = rows.length;
    const p = await search(at, PAGE).catch(() => null);
    if (!p || n !== seq.current) return;
    const seen = new Set(rows.map((r) => r.path));
    const next = [...rows, ...p.results.filter((r) => !seen.has(r.path))];
    focusRow.current = at;
    setRows(next);
    setTotal(p.total);
    totalRef.current = p.total;
    loaded.current = next.length;
    report();
  };
  // The first new row gets the focus once it is rendered; a frame callback could run before React renders it (#105).
  useLayoutEffect(() => {
    const at = focusRow.current;
    focusRow.current = null;
    if (at !== null) list.current?.querySelectorAll<HTMLElement>('a.result')[at]?.focus({ preventScroll: true });
  }, [rows]);

  const clearFilters = () => {
    setType(null);
    setTagFilter([]);
    inputRef.current?.focus();
  };
  const addTag = (k: string) => {
    if (!tagFilter.includes(k)) setTagFilter([...tagFilter, k]);
  };

  // D-1203: types with objects, D-122 order by name; types without a definition after them (D-121).
  const typeOptions = Object.entries(counts).filter(([, c]) => c >= 1).map(([k, c]) => ({ key: k, name: typeName(k), count: c, defined: k in typeNames }))
    .sort((a, b) => Number(b.defined) - Number(a.defined) || collator().compare(a.name, b.name));
  const menu: MenuEntry[] = [
    { kind: 'radio', key: '*', label: t('search.allTypes'), content: t('search.allTypes'), checked: type === null, onChoose: () => { setMenuOpen(false); setType(null); typeButton.current?.focus(); } },
    ...typeOptions.map((o): MenuEntry => ({ kind: 'radio', key: o.key, label: `${o.name} ${o.count}`, content: <><span data-user-content>{o.name}</span> {o.count}</>, checked: type === o.key,
      onChoose: () => { setMenuOpen(false); setType(o.key); typeButton.current?.focus(); } })),
  ];

  const tagsText = tagFilter.map((k) => `#${tagName(k)}`).join(' ');
  const filterList = () => {
    const parts = [...(type ? [t('search.filterType', { type: typeName(type) })] : []), ...tagFilter.map((k) => `#${tagName(k)}`)];
    return new Intl.ListFormat(catalogLocale(), { type: 'conjunction' }).format(parts);
  };
  const countLine = () => {
    const n = total ?? 0;
    if (hasText) return t('search.count', { count: n });
    if (type && tagFilter.length) return t('search.countTypeTags', { count: n, type: typeName(type), tags: tagsText });
    if (type) return t('search.countType', { count: n, type: typeName(type) });
    return t('search.countTags', { count: n, tags: tagsText });
  };
  const q = text.trim();
  let empty: { title: React.ReactNode; label: string; body: React.ReactNode; clear: boolean } | null = null;
  if (!hasText && !hasFilter) {
    empty = { title: t('search.emptyTitle'), label: t('search.emptyTitle'), body: t('search.emptyBody'), clear: false };
  } else if (total === 0) {
    if (hasText && hasFilter) {
      empty = { title: withUser('search.noResultsTitle', {}, { q }), label: t('search.noResultsTitle', { q }), body: withUser('search.noResultsBody', { filters: filterList() }, { q }), clear: true };
    } else if (hasText) {
      empty = { title: withUser('search.noResultsTitle', {}, { q }), label: t('search.noResultsTitle', { q }), body: withUser('search.noMatchBody', {}, { q }), clear: false };
    } else {
      const f = filterList();
      empty = { title: t('search.noObjectsTitle', { filters: f }), label: t('search.noObjectsTitle', { filters: f }), body: t('search.noObjectsBody'), clear: true };
    }
  }
  const moveRow = (from: HTMLElement, dir: 1 | -1) => {
    const links = [...(list.current?.querySelectorAll<HTMLElement>('a.result') ?? [])];
    links[links.indexOf(from) + dir]?.focus();
  };
  const tagOrder = (keys: string[]) => [...keys].sort((a, b) => collator().compare(tagName(a), tagName(b)));
  const date = (r: SearchResultDto) => {
    const day = r.modified ? localDay(r.modified) : null;
    return day ? formatDate(day, dateTime) : '';
  };

  return (
    <section className="search"
      onFocus={(e) => { const a = (e.target as HTMLElement).closest<HTMLElement>('a.result'); focusPath.current = a?.dataset.path ?? null; report(); }}>
      <div role="search" className="search-field">
        <Icon name="search" />
        <input ref={inputRef} type="search" autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false} aria-label={t('search.label')} placeholder={t('search.placeholder')} value={text}
          aria-controls={active ? 'goto-list' : undefined} aria-activedescendant={active}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (goto.current?.onKey(e)) return;
            if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); if (!onLeave()) setText(''); }
          }} />
        {text && <button type="button" tabIndex={0} className="clear-search" data-command="search.clear" aria-label={t('search.clear')} onClick={() => { setText(''); inputRef.current?.focus(); }}><Icon name="x" /></button>}
        <span className="shortcut-hint" aria-hidden="true">{t('search.shortcut')}</span>
      </div>
      <div className="filters" role="group" aria-label={t('search.filters')}>
        <button ref={typeButton} type="button" tabIndex={0} className="type-filter" data-command="search.type" aria-haspopup="menu" aria-expanded={menuOpen} data-active={type !== null || undefined}
          aria-label={type === null ? t('search.typeAll') : t('search.typeOne', { type: typeName(type) })}
          onClick={() => setMenuOpen((o) => !o)}
          onKeyDown={(e) => { if (e.key === 'ArrowDown') { e.preventDefault(); setMenuOpen(true); } }}>
          {/* The board's pill: the label, then the value (bold when on). */}
          {type === null ? t('search.typeAll') : <>{t('search.typeOne', { type: '\u0000' }).split('\u0000')[0]}<b data-user-content>{typeName(type)}</b>{t('search.typeOne', { type: '\u0000' }).split('\u0000')[1]}</>}
          <Icon name="chevron-down" />
        </button>
        {menuOpen && <PopupMenu label={t('search.typeLabel')} anchor={typeButton.current} entries={menu} onClose={() => setMenuOpen(false)} />}
        <TagFilter tags={options} selected={tagFilter} onChange={setTagFilter} colors={colors} allHint={t('search.tagAll')} />
        {hasFilter && <button type="button" tabIndex={0} className="text-button" data-command="search.clearFilters" onClick={clearFilters}>{t('search.clearFilters')}</button>}
      </div>
      <GoTo q={text} keys={goto} onActive={setActive} onOpen={onGoTo} onCreate={onCreate} onRefocus={() => inputRef.current?.focus()} />
      {!empty && total !== null && <div className="count" role="status">{countLine()}</div>}
      {empty && (
        <section className="search-empty" aria-label={empty.label}>
          <span className="empty-icon" aria-hidden="true"><Icon name="search" /></span>
          <h2>{empty.title}</h2>
          <p>{empty.body}</p>
          {empty.clear && <button type="button" tabIndex={0} className="text-button" data-command="search.clearFilters" onClick={clearFilters}>{t('search.clearFilters')}</button>}
        </section>
      )}
      <ul ref={list} aria-label={t('search.results')}>
        {!empty && rows.map((r) => {
          const label = r.attribute ? (types.find((x) => x.key === r.type)?.attributes.find((a) => a.key === r.attribute!.key)?.name ?? r.attribute.key) : '';
          return (
            <li key={r.path} className={r.tags.length ? 'has-tags' : undefined}>
              {/* A link row, not a <button>: WebKit centres a flex button's content (3C preview feedback). */}
              {/* Slice P (R104 row 8, D-930): a click anywhere on the row previews; ⏎ and a double-click open it. */}
              <RefElement as="a" reference={{ target: { path: r.path.normalize('NFC'), fragment: null, kind: 'note' }, kind: 'row', open: () => onOpen(r.path) }}
                href="#" tabIndex={0} className="result" data-command="search.open" data-path={r.path} aria-label={r.title} aria-description={[typeName(r.type), date(r)].filter(Boolean).join(' · ')} onClick={(e) => e.preventDefault()}
                onKeyDown={(e: React.KeyboardEvent<HTMLElement>) => {
                  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); moveRow(e.currentTarget, e.key === 'ArrowDown' ? 1 : -1); }
                }}>
                <span className="icon"><TypeIcon type={r.type} /></span>
                <span className="head">
                  <span className="title" data-user-content><Highlighted text={r.title} ranges={r.title_highlights} /></span>
                  {r.typo && <span className="typo">{t('search.typo')}</span>}
                  <span className="meta">
                    <span className="type" data-user-content>{typeName(r.type)}</span>
                    {r.modified && date(r) && <time className="modified" dateTime={r.modified}>{date(r)}</time>}
                  </span>
                </span>
                {r.file_name && (() => {
                  // D-254: a hit by its file name only says so, with the stem's matches highlighted.
                  const [before, after = ''] = t('search.fileName').split('{stem}');
                  return (
                    <span className="file-name line">
                      {before}<span data-user-content><Highlighted text={r.file_name.text} ranges={r.file_name.highlights} /></span>{after}
                    </span>
                  );
                })()}
                {r.alias && (() => {
                  const [before, after = ''] = t('search.alias').split('{alias}');
                  return <span className="alias line">{before}<span data-user-content><Highlighted text={r.alias.text} ranges={r.alias.highlights} /></span>{after}</span>;
                })()}
                {r.attribute && (
                  <span className="attribute line">
                    {(() => {
                      const parts = t('search.attribute', { label: '\u0001', value: '\u0002' }).split(/(\u0001|\u0002)/);
                      return parts.map((p, i) => p === '\u0001' ? <span key={i} data-user-content>{label}</span>
                        : p === '\u0002' ? <span key={i} data-user-content><Highlighted text={r.attribute!.value.text} ranges={r.attribute!.value.highlights} /></span> : p);
                    })()}
                  </span>
                )}
                {r.snippet && (
                  <span className="snippet" data-user-content>
                    <Highlighted text={r.snippet.text} ranges={r.snippet.highlights} />
                  </span>
                )}
              </RefElement>
              {r.tags.length > 0 && (
                <span className="tags">
                  {tagOrder(r.tags).map((k) => (
                    <button key={k} type="button" tabIndex={0} className="tag-chip" data-command="search.filterTag" style={tagChipStyle(colors[k])} aria-label={t('search.filterTag', { tag: tagName(k) })}
                      onClick={() => addTag(k)}>#<span data-user-content>{tagName(k)}</span></button>
                  ))}
                </span>
              )}
            </li>
          );
        })}
      </ul>
      {!empty && total !== null && rows.length < total && (
        <button type="button" tabIndex={0} className="show-next" data-command="search.showNext" onClick={() => void showNext()}>{t('search.showNext', { count: Math.min(PAGE, total - rows.length) })}</button>
      )}
    </section>
  );
}
