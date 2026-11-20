// Slice Q (queries.md R142; board QueryBlock B; v1-queries §4.3, §4.4, §2.1): the query editor, rendered once by the App
// for the request of editorHost.ts. A non-modal 640 px popover on a working copy of the definition: every change runs
// `query_run` `def` (no write) and hands the result to the opener; Done, Esc or a click outside commits once
// (`query_apply`, then the `query-rename` job when the title changed). A draft creates its file on the first commit with a
// type, a filter or a changed title (D-1471).
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { t } from '../i18n/catalog';
import { ipc, errorKind } from '../ipc/client';
import type { TypeDefDto, SwitcherItemDto, TypeDto } from '../ipc/types';
import type { FilterItemDto, QueryDefDto, QueryDto, QueryOp, QueryResultDto } from '../ipc/queries';
import { Icon } from '../shell/Icon';
import { usePopupPlacement } from '../shell/usePopupPlacement';
import { announceQuery, editorClosed, queryAlert, useEditorRequest, type EditorRequest } from './editorHost';
import { queryEnv, nowIso } from './env';
import { FLAG_OPS, UNIVERSAL, attributeGroups, attributeOf, columnsAfterTypes, defEquals, isValidRow, operatorsFor, parseLimit, type AttrItem } from './model';
import { Chooser, type ListOption } from './Listbox';
import { defaultGroupBy, groupByChoices } from '../views/model';
import { ColumnsMenu } from './QueryBlock';
import './editor.css';

type Filter = Extract<FilterItemDto, { kind: 'filter' }>;
const nfc = (s: string) => s.normalize('NFC');
const stem = (p: string) => nfc((p.split('/').pop() ?? p).replace(/\.md$/i, ''));
const DEFAULT_DEF = (): QueryDefDto => ({ title: t('query.editor.untitled'), types: [], match: 'all', filters: [], sort: [{ by: 'modified', order: 'desc' }], limit: 50, view: 'list', groupBy: null, lanes: 'vertical', laneOrder: null, columns: ['type', 'modified'] });

/** Rows without an attribute and groups without rows are left out of runs and commits. */
function clean(d: QueryDefDto): QueryDefDto {
  const items = (l: FilterItemDto[]): FilterItemDto[] => l.flatMap((f): FilterItemDto[] => {
    if (f.kind === 'filter') return f.key ? [f] : [];
    if (f.kind === 'group') { const c = items(f.filters); return c.length ? [{ ...f, filters: c }] : []; }
    return [f];
  });
  return { ...d, filters: items(d.filters) };
}

export function QueryEditorHost({ types }: { types: TypeDefDto[] }) {
  const { req, seq } = useEditorRequest();
  if (!req) return null;
  return <QueryEditor key={seq} req={req} types={types} />;
}

function QueryEditor({ req, types }: { req: EditorRequest; types: TypeDefDto[] }) {
  const [query, setQuery] = useState<QueryDto | null>(null);
  const [orig, setOrig] = useState<QueryDefDto | null>(req.name === null ? (req.def ?? DEFAULT_DEF()) : null);
  const [def, setDef] = useState<QueryDefDto | null>(orig);
  const [title, setTitle] = useState(orig?.title ?? '');
  const [usages, setUsages] = useState(0);
  // Slice Q2 (R189, D-1795): the type pages listing the query (`Used on the <plural> page and <n> notes.`).
  const [pages, setPages] = useState<string[]>([]);
  const [cardsOpen, setCardsOpen] = useState(false);
  // Slice Q2.1 (D-1844, D-1860): a usage's own `On cards`, written at once by `Change…`.
  const [usageCols, setUsageCols] = useState<string[] | null>(req.usage ? req.usage.columns : null);
  const cardsBtn = useRef<HTMLButtonElement | null>(null);
  const [result, setResult] = useState<QueryResultDto | null>(null);
  const [limitText, setLimitText] = useState(orig ? String(orig.limit) : '');
  const [source, setSource] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number }>({ left: 0, top: 0 });
  const root = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const closing = useRef(false);
  const focusPath = useRef<string | null>(null);
  const state = useRef({ def, title, orig, query, result });
  state.current = { def, title, orig, query, result };

  // Read the query (its definition, version and text) and its usages.
  useEffect(() => {
    if (req.name === null) return;
    let live = true;
    ipc.queryGet(req.name).then((q) => {
      if (!live) return;
      setQuery(q);
      const d = q.def ?? req.def ?? null;
      if (!d) { finish(false); return; }
      setOrig(d);
      setDef(d);
      setTitle(d.title);
      setLimitText(String(d.limit));
    }, () => finish(false));
    ipc.queryUsages(req.name).then((u) => { if (live) setUsages(u.length); }, () => {});
    ipc.queryViewUsages(req.name).then((v) => { if (live) setPages(v.map((x) => x.type)); }, () => {});
    return () => { live = false; };
  }, []);

  // Each change runs the working copy (no write); the opener shows the result live.
  const runSeq = useRef(0);
  useEffect(() => {
    if (!def) return;
    const n = ++runSeq.current;
    const timer = setTimeout(() => {
      // CP-17 (D-1859): opened from a usage, the preview looks like the usage (its effective sort and columns).
      const shown = req.usage ? { ...def, sort: req.usage.sort, columns: usageCols ?? req.usage.columns } : def;
      ipc.queryRun({ kind: 'def', def: clean({ ...shown, title: title || def.title }), name: req.name }, req.host, queryEnv()).then((r) => {
        if (n !== runSeq.current || closing.current) return;
        setResult(r);
        req.onResult?.(r);
      }, () => {});
    }, 40);
    return () => clearTimeout(timer);
  }, [def, usageCols]);

  // Below the anchor (the block's header, a tab or `Edit query`), placed inside the window (Q2.1 §20, D-1861).
  const opener = (req.anchor?.querySelector?.('.query-header') as HTMLElement | null) ?? req.anchor;
  const placed = usePopupPlacement(root, opener, 'menu', 6);
  useLayoutEffect(() => {
    if (opener) return;
    const h = root.current?.getBoundingClientRect().height ?? 400;
    const left = Math.max(8, Math.min(240, window.innerWidth - 648));
    let top = 86;
    if (top + h > window.innerHeight - 8) top = Math.max(8, window.innerHeight - h - 8);
    setPos((p) => (p.left === left && p.top === top ? p : { left, top }));
  });

  // First focus: the title (selected for a new draft), or the row of `Fix filter`.
  const focused = useRef(false);
  useEffect(() => {
    if (focused.current || !def) return;
    focused.current = true;
    if (req.focusFilter) {
      const el = root.current?.querySelector<HTMLElement>(`[data-filter="${req.focusFilter.join('.')}"] [role="combobox"]`);
      if (el) { el.focus(); return; }
    }
    titleRef.current?.focus();
    if (req.selectTitle) titleRef.current?.select();
  }, [def]);
  useLayoutEffect(() => {
    if (!focusPath.current) return;
    const el = root.current?.querySelector<HTMLElement>(`[data-filter="${focusPath.current}"] [role="combobox"]`);
    focusPath.current = null;
    el?.focus();
  });

  // A click outside the editor (and outside its block) commits and closes it.
  useEffect(() => {
    const outside = (e: MouseEvent) => {
      const tg = e.target as Node;
      if (root.current?.contains(tg) || req.anchor?.contains(tg)) return;
      // Its own menus (the `On cards` Columns menu) are placed in the body (§20).
      if ((tg as HTMLElement).closest?.('[data-popup="columns"]')) return;
      void finish(true);
    };
    document.addEventListener('mousedown', outside, true);
    return () => document.removeEventListener('mousedown', outside, true);
  }, []);

  const close = () => {
    editorClosed(req);
    req.onResult?.(null);
    req.onClosed?.();
    const back = req.returnFocus;
    if (back?.isConnected && !document.querySelector('.query-name-dialog')) back.focus({ preventScroll: true });
  };

  async function finish(commit: boolean, done = false) {
    if (closing.current) return;
    closing.current = true;
    const { def: d, title: tt, orig: o, query: q, result: r } = state.current;
    if (!commit || !d || !o) { if (req.name === null) req.onDraftDrop?.(); close(); return; }
    const cur = clean(d);
    const newTitle = nfc(tt.trim());
    const titleChanged = !!newTitle && newTitle !== nfc(o.title);
    if (req.name === null) {
      // D-1781: a New view draft is created by `Done`, or by a close after a change; Esc with no change drops it.
      const wanted = req.viewDraft ? done || titleChanged || !defEquals(cur, clean(o)) : cur.types.length || cur.filters.length || titleChanged;
      if (wanted) {
        const name = newTitle || o.title;
        try { await req.onDraftCommit?.(name, { ...cur, title: name }); } catch { queryAlert(t('query.saveFailed')); }
      } else req.onDraftDrop?.();
      close();
      return;
    }
    const changed = !defEquals({ ...cur, title: o.title }, { ...o, title: o.title });
    if (changed) {
      try {
        const res = await ipc.queryApply(req.name, q?.version ?? null, { ...cur, title: o.title }, nowIso(Date.now()));
        req.onCommitted?.(res);
        announceQuery(t('query.editor.results', { count: r?.total ?? r?.rows.length ?? 0 }));
      } catch (e) {
        const k = errorKind(e);
        if (k === 'Conflict' || k === 'Gone') queryAlert(t('query.editor.changedOutside'));
        else if (k !== 'NewerVersion' && k !== 'Unreadable') queryAlert(t('query.saveFailed'));
        close();
        return;
      }
    }
    if (titleChanged) {
      ipc.queryRename(req.name, newTitle).catch((e) => {
        queryAlert(errorKind(e) === 'NameTaken' ? t('query.newQuery.taken') : t('query.saveFailed'));
      });
    }
    close();
  }

  if (!def) return null;
  const typeDtos = def.types.map((k) => types.find((x) => nfc(x.key) === nfc(k))).filter((x): x is TypeDefDto => !!x);
  const typeName = (k: string) => types.find((x) => nfc(x.key) === nfc(k))?.name ?? k;
  const update = (f: (d: QueryDefDto) => QueryDefDto) => setDef((d) => (d ? f(d) : d));
  const oneType = def.types.length === 1 ? (types.find((x) => nfc(x.key) === nfc(def.types[0])) as never as TypeDto | undefined) : undefined;
  const groupLabel = (k: string | null): { label: string; user: boolean } => {
    if (k === null) return { label: '', user: false };
    if (nfc(k) === 'tags') return { label: t('attr.tags'), user: false };
    const a = oneType?.attributes.find((x) => nfc(x.key) === nfc(k));
    return a ? { label: a.name, user: true } : { label: k, user: true };
  };
  const columnLabel = (k: string): string => {
    const a = oneType?.attributes.find((x) => nfc(x.key) === nfc(k));
    if (a) return a.name;
    if (nfc(k) === 'modified') return t('typePage.modified');
    const u = UNIVERSAL.find((x) => x.key === nfc(k));
    return u ? t(u.label) : k;
  };
  const setTypes = (next: string[]) => update((d) => ({ ...d, types: next, columns: columnsAfterTypes(d.columns, d.types, next, types) }));

  // ------------------------------------------------------------------ filter items, by their path
  const at = (d: QueryDefDto, path: number[]): FilterItemDto | undefined => {
    const top = d.filters[path[0]];
    return path.length === 1 ? top : top?.kind === 'group' ? top.filters[path[1]] : undefined;
  };
  const setItem = (path: number[], f: (x: FilterItemDto) => FilterItemDto | null) => update((d) => {
    const filters = [...d.filters];
    if (path.length === 1) {
      const next = f(filters[path[0]]);
      if (next) filters[path[0]] = next; else filters.splice(path[0], 1);
    } else {
      const g = filters[path[0]];
      if (g?.kind !== 'group') return d;
      const inner = [...g.filters];
      const next = f(inner[path[1]]);
      if (next) inner[path[1]] = next; else inner.splice(path[1], 1);
      filters[path[0]] = { ...g, filters: inner };
    }
    return { ...d, filters };
  });
  const newRow = (): Filter => ({ kind: 'filter', key: '', op: 'is', value: '', src: null });
  const addFilter = () => { focusPath.current = String(def.filters.length); update((d) => ({ ...d, filters: [...d.filters, newRow()] })); };
  const addGroup = () => update((d) => ({ ...d, filters: [...d.filters, { kind: 'group', match: 'any', filters: [], src: null }] }));
  const addToGroup = (i: number) => {
    const g = def.filters[i];
    if (g?.kind !== 'group') return;
    focusPath.current = `${i}.${g.filters.length}`;
    setItem([i], (x) => (x.kind === 'group' ? { ...x, filters: [...x.filters, newRow()] } : x));
  };

  const hostTitle = req.host ? stem(req.host) : null;
  const pagePlural = pages.length ? (types.find((x) => nfc(x.key) === nfc(pages[0]))?.plural ?? pages[0]) : null;
  const usedOn = pagePlural && usages >= 1 ? t('query.editor.usedOnPage', { plural: pagePlural, count: usages }) : usages > 1 ? t('query.editor.usedOn', { count: usages }) : null;
  const count = result ? (result.total ?? result.rows.length) : null;
  // R197 (D-1842): sort and columns are per usage; said when the query has two or more usages.
  const perUsage = req.name !== null && pages.length + usages >= 2;
  const cardColumns = usageCols ?? def.columns;

  // The attribute choices of the filter rows (no Sort row: sorting is on the view, D-1795).
  const groups = attributeGroups(types, def.types);
  const limitBad = parseLimit(limitText) === null;

  const connector = (match: 'all' | 'any', onPick: (m: 'all' | 'any') => void) => {
    const word = t(match === 'all' ? 'query.editor.and' : 'query.editor.or');
    return (
      <Chooser role="button" className="qe-connector" label={t('query.editor.combine', { connector: word })} display={<>{word}<Icon name="chevron-down" size={11} /></>}
        options={[{ id: 'all', label: t('query.editor.and') }, { id: 'any', label: t('query.editor.or') }]} current={match}
        onPick={(id) => onPick(id as 'all' | 'any')} />
    );
  };
  const lead = (index: number, match: 'all' | 'any', onPick: (m: 'all' | 'any') => void, top: boolean) => (
    <div className="qe-lead">
      {index === 0 ? (top ? t('query.editor.where') : null)
        : index === 1 ? connector(match, onPick)
          : <span className="qe-word">{t(match === 'all' ? 'query.editor.and' : 'query.editor.or')}</span>}
    </div>
  );

  const row = (f: Filter, path: number[], index: number, match: 'all' | 'any', onMatch: (m: 'all' | 'any') => void, top: boolean) => {
    const key = nfc(f.key);
    const attr: AttrItem | null = key ? (attributeOf(types, def.types, key) ?? anyAttr(types, key)) : null;
    const reason = key ? isValidRow(f, typeDtos) : null;
    const lacking = reason === 'notAttribute' ? def.types.find((k) => !attributeOf(types, [k], key)) : undefined;
    const attrLabel = attr ? (attr.userNamed ? attr.label : t(attr.label)) : key;
    const description = reason === 'notAttribute' ? t('query.editor.ignored.notAttribute', { type: typeName(lacking ?? def.types[0] ?? '') })
      : reason === 'operatorKind' ? t('query.editor.ignored.operator', { attribute: attrLabel })
        : reason === 'value' ? t('query.editor.ignored.value') : reason === 'nestedGroup' ? t('query.editor.ignored.nestedGroup') : undefined;
    const isLinks = key === 'links_to' || key === 'linked_from';
    const kind = attr?.kind ?? 'text';
    const ops = operatorsFor(kind);
    const opId = (o: { op: QueryOp; arg?: boolean }) => (o.arg === undefined ? o.op : `${o.op}:${o.arg}`);
    const curOp = isLinks ? 'links_to' : kind === 'checkbox' ? `is:${f.value === true}` : f.op;
    const opLabel = ops.find((o) => opId(o) === curOp)?.label ?? (key && !isLinks && kind !== 'checkbox' ? `query.op.${f.op}` : undefined);
    const attrOpts: ListOption[] = groups.flatMap((g) => g.items.map((i) => ({ id: i.key, label: i.userNamed ? i.label : t(i.label), userNamed: i.userNamed, group: g.id })));
    const groupLabels = Object.fromEntries(groups.map((g) => [g.id, { label: g.userNamed ? g.label : t(g.label), userNamed: g.userNamed }]));
    const pickAttr = (k: string) => {
      const a = attributeOf(types, def.types, k);
      const kk = a?.kind ?? 'text';
      const first = operatorsFor(kk)[0];
      const op: QueryOp = kk === 'links' ? 'is' : first?.op ?? 'is';
      const value: unknown = kk === 'checkbox' ? true : FLAG_OPS.has(op) ? true : '';
      setItem(path, () => ({ kind: 'filter', key: k, op, value, src: f.src }));
    };
    const pickOp = (id: string) => {
      const [op, arg] = id.split(':') as [QueryOp, string | undefined];
      setItem(path, (x) => {
        if (x.kind !== 'filter') return x;
        if (isLinks) return { ...x, op: 'is' };
        if (kind === 'checkbox') return { ...x, op: 'is', value: arg === 'true' };
        const value = FLAG_OPS.has(op) ? true : FLAG_OPS.has(x.op) ? '' : x.value;
        return { ...x, op, value: op === 'between' && !Array.isArray(value) ? ['', ''] : op !== 'between' && Array.isArray(value) && !['is_any_of', 'has_any_of', 'has_all_of', 'has_none_of'].includes(op) ? '' : value };
      });
    };
    const setValue = (v: unknown) => setItem(path, (x) => (x.kind === 'filter' ? { ...x, value: v } : x));
    return (
      <div key={path.join('.')} role="group" data-filter={path.join('.')} className="qe-row" data-broken={reason ?? undefined} aria-description={description}>
        {lead(index, match, onMatch, top)}
        <Chooser label={t('query.editor.attribute')} display={key ? attrLabel : t('query.editor.attribute')} faint={!key} options={attrOpts} groups={groupLabels}
          current={key || null} onPick={pickAttr} filterHint={t('query.editor.findAttr')} className="qe-attr" />
        <Chooser label={t('query.editor.operator')} display={opLabel ? t(opLabel) : t('query.editor.operator')} faint={!opLabel} disabled={!key}
          options={ops.map((o) => ({ id: opId(o), label: t(o.label) }))} current={curOp} onPick={pickOp} className="qe-op" />
        {key && <ValueControl key={`${key}:${f.op}`} f={f} kind={kind} isLinks={isLinks} attr={attr} hostTitle={hostTitle} onValue={setValue} />}
        <button tabIndex={0} type="button" className="icon-button small qe-remove" aria-label={t('query.editor.removeFilter')} title={t('query.editor.removeFilter')}
          onClick={() => setItem(path, () => null)}><Icon name="x" size={12} /></button>
      </div>
    );
  };

  const items = def.filters.map((f, i) => {
    const onTop = (m: 'all' | 'any') => update((d) => ({ ...d, match: m }));
    if (f.kind === 'filter') return row(f, [i], i, def.match, onTop, true);
    if (f.kind === 'raw') {
      return (
        <div key={i} role="group" data-filter={String(i)} className="qe-row" data-broken="shape" aria-description={t('query.editor.ignored.value')}>
          {lead(i, def.match, onTop, true)}
          <span className="qe-raw">{t('query.editor.ignored.value')}</span>
          <button tabIndex={0} type="button" className="icon-button small qe-remove" aria-label={t('query.editor.removeFilter')} onClick={() => setItem([i], () => null)}><Icon name="x" size={12} /></button>
        </div>
      );
    }
    const onGroup = (m: 'all' | 'any') => setItem([i], (x) => (x.kind === 'group' ? { ...x, match: m } : x));
    return (
      <div key={i} role="group" data-filter={String(i)} className="qe-group-row" aria-label={t(f.match === 'any' ? 'query.editor.groupAny' : 'query.editor.groupAll')}>
        {lead(i, def.match, onTop, true)}
        <div className="qe-group">
          {f.filters.map((c, j) => (c.kind === 'filter' ? row(c, [i, j], j, f.match, onGroup, false)
            : <div key={j} role="group" data-filter={`${i}.${j}`} className="qe-row" data-broken="nestedGroup" aria-description={t('query.editor.ignored.nestedGroup')}>
              <div className="qe-lead" /><span className="qe-raw">{t('query.editor.ignored.nestedGroup')}</span>
              <button tabIndex={0} type="button" className="icon-button small qe-remove" aria-label={t('query.editor.removeFilter')} onClick={() => setItem([i, j], () => null)}><Icon name="x" size={12} /></button>
            </div>))}
          <div className="qe-group-actions">
            <button tabIndex={0} type="button" className="qe-add" onClick={() => addToGroup(i)}><Icon name="plus" size={12} />{t('query.editor.addToGroup')}</button>
            <button tabIndex={0} type="button" className="qe-add" onClick={() => setItem([i], () => null)}><Icon name="trash" size={12} />{t('query.editor.removeGroup')}</button>
          </div>
        </div>
      </div>
    );
  });

  const typeOpts: ListOption[] = types.filter((x) => !def.types.some((k) => nfc(k) === nfc(x.key))).map((x) => ({ id: x.key, label: x.name, userNamed: true }));

  return (
    <div ref={root} data-qe-root="" role="dialog" aria-label={t('query.editor.dialog')} className="query-editor" data-popup="query.editor"
      style={opener ? placed : { left: pos.left, top: pos.top }}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && !e.defaultPrevented) { e.preventDefault(); e.stopPropagation(); if (source) setSource(false); else void finish(true); }
      }}>
      <div className="qe-head">
        <span className="qe-funnel" aria-hidden="true"><Icon name="query" size={15} /></span>
        <input ref={titleRef} type="text" className="qe-title" aria-label={t('query.editor.titleField')} value={title} data-user-content
          onChange={(e) => setTitle(e.target.value)} />
      </div>
      {usedOn && <p className="qe-usage">{usedOn}</p>}
      {perUsage && <p className="qe-usage" data-per-usage="">{t('query.editor.perUsage')}</p>}
      <div className="qe-section">
        <div className="qe-label">{t('query.editor.show')}</div>
        <div className="qe-types">
          {def.types.map((k) => (
            <span key={k} className="qe-chip"><span data-user-content>{typeName(k)}</span>
              {!req.fixedType && (
                <button tabIndex={0} type="button" className="qe-chip-x" aria-label={t('query.editor.removeType', { type: typeName(k) })}
                  onClick={() => setTypes(def.types.filter((x) => x !== k))}><Icon name="x" size={11} /></button>
              )}
            </span>
          ))}
          {!req.fixedType && (
            <Chooser role="button" className="qe-add" label={t('query.editor.type')} display={<><Icon name="plus" size={12} />{t('query.editor.type')}</>}
              options={typeOpts} onPick={(k) => setTypes([...def.types, k])} />
          )}
          {req.fixedType && <p className="qe-hint qe-fixed">{t('query.editor.showFixed', { plural: req.fixedType.plural })}</p>}
          {!def.types.length && !req.fixedType && <span className="qe-hint">{t('query.editor.allTypes')}</span>}
        </div>
      </div>
      <div className="qe-filters">{items}</div>
      <div className="qe-actions">
        <button tabIndex={0} type="button" className="qe-add" onClick={addFilter}><Icon name="plus" size={12} />{t('query.editor.addFilter')}</button>
        <button tabIndex={0} type="button" className="qe-add" onClick={addGroup}><Icon name="plus" size={12} />{t('query.editor.addGroup')}</button>
      </div>
      {def.view !== 'board' && (
        // D-1795: no Sort row (sorting is on the view, R188); `Limit` hidden while View is Board.
        <div className="qe-section qe-sort">
          <label className="qe-limit">
            <span>{t('query.editor.limit')}</span>
            <input type="text" inputMode="numeric" aria-label={t('query.editor.limit')} value={limitText} aria-invalid={limitBad || undefined}
              aria-describedby={limitBad ? 'qe-limit-error' : undefined}
              onChange={(e) => { setLimitText(e.target.value); const n = parseLimit(e.target.value); if (n !== null) update((d) => ({ ...d, limit: n })); }} />
          </label>
        </div>
      )}
      {limitBad && <p id="qe-limit-error" className="field-error">{t('query.editor.limitError')}</p>}
      <div className="qe-section">
        <div className="qe-label">{t('query.editor.view')}</div>
        <div className="qe-segment" role="radiogroup" aria-label={t('query.editor.view')}>
          {(['table', 'list', 'board'] as const).map((v) => (
            <button key={v} tabIndex={0} type="button" role="radio" aria-checked={def.view === v} className={def.view === v ? 'on' : ''}
              onClick={() => update((d) => ({ ...d, view: v, groupBy: v === 'board' && d.groupBy === null && oneType ? defaultGroupBy(oneType) : d.groupBy }))}>
              {t(v === 'list' ? 'query.editor.list' : v === 'table' ? 'query.editor.table' : 'query.editor.board')}
            </button>
          ))}
        </div>
        {def.view !== 'board' && <span className="qe-hint">{t('query.editor.tableHint')}</span>}
      </div>
      {def.view === 'board' && (
        <>
          <div className="qe-section">
            <div className="qe-label">{t('query.editor.groupBy')}</div>
            <Chooser label={t('query.editor.groupBy')} display={<span data-user-content={groupLabel(def.groupBy).user ? '' : undefined}>{groupLabel(def.groupBy).label}</span>}
              options={groupByChoices(oneType).map((k) => ({ id: k, label: groupLabel(k).label, userNamed: groupLabel(k).user }))} current={def.groupBy}
              onPick={(k) => update((d) => ({ ...d, groupBy: k }))} className="qe-groupby" describedBy="qe-groupby-hint" />
            <span id="qe-groupby-hint" className="qe-hint">{t('query.editor.groupByHint')}</span>
          </div>
          <div className="qe-section">
            <div className="qe-label">{t('query.editor.lanes')}</div>
            <div className="qe-segment" role="radiogroup" aria-label={t('query.editor.lanes')}>
              {(['vertical', 'horizontal'] as const).map((l) => (
                <button key={l} tabIndex={0} type="button" role="radio" aria-checked={def.lanes === l} className={def.lanes === l ? 'on' : ''}
                  onClick={() => update((d) => ({ ...d, lanes: l }))}>{t(l === 'vertical' ? 'board.vertical' : 'board.horizontal')}</button>
              ))}
            </div>
          </div>
          <div className="qe-section" role="group" aria-label={t('query.editor.onCards')}>
            <div className="qe-label">{t('query.editor.onCards')}</div>
            <span className="qe-cards" data-user-content>{cardColumns.map((k) => columnLabel(k)).join(', ')}</span>
            <button ref={cardsBtn} tabIndex={0} type="button" className="qe-add" aria-haspopup="menu" aria-expanded={cardsOpen}
              aria-disabled={req.usage?.disabled ? 'true' : undefined} aria-description={req.usage?.disabled ?? undefined}
              onClick={() => { if (!req.usage?.disabled) setCardsOpen((o) => !o); }}>{t('query.editor.onCardsChange')}</button>
          </div>
        </>
      )}
      {cardsOpen && (
        <ColumnsMenu def={def} types={types as never} anchor={cardsBtn.current} columns={cardColumns}
          scope={req.usage ? (req.fixedType ? 'tab' : 'block') : undefined}
          onToggle={(key, on) => {
            const toggled = (cols: string[]) => (on ? [...cols.filter((c) => nfc(c) !== nfc(key)), nfc(key)] : cols.filter((c) => nfc(c) !== nfc(key)));
            // D-1860: a usage's `Change…` writes its own columns at once; `Done` never writes `columns`.
            if (req.usage) { const next = toggled(cardColumns); setUsageCols(next); void req.usage.setColumns(next); return; }
            update((d) => ({ ...d, columns: toggled(d.columns) }));
          }}
          onNewProperty={() => setCardsOpen(false)}
          onClose={() => { setCardsOpen(false); cardsBtn.current?.focus(); }} />
      )}
      <div className="qe-foot">
        <p className="qe-results">{count === null ? '' : t('query.editor.results', { count })}</p>
        {req.name !== null && <button tabIndex={0} type="button" className="qe-add" onClick={() => setSource(true)}>{t('query.editor.source')}</button>}
        <button tabIndex={0} type="button" className="qe-done" onClick={() => void finish(true, true)}>{t('query.editor.done')}</button>
      </div>
      {source && query && (
        <div role="dialog" aria-label={t('query.editor.source')} className="qe-source">
          <p className="qe-source-path" data-user-content>{query.path}</p>
          <pre data-user-content>{query.text ?? ''}</pre>
          <button tabIndex={0} type="button" className="qe-done" autoFocus onClick={() => setSource(false)}>{t('query.editor.done')}</button>
        </div>
      )}
    </div>
  );
}

/** An attribute of some type (a broken row still shows its own name and operators). */
function anyAttr(types: TypeDefDto[], key: string): AttrItem | null {
  for (const ty of types) { const a = attributeOf(types, [ty.key], key); if (a) return a; }
  const u = UNIVERSAL.find((x) => x.key === key);
  return u ? { key: u.key, kind: u.kind, label: u.label, userNamed: false, options: [], to: null } : null;
}

const LIST_OPS = new Set(['is_any_of', 'has_any_of', 'has_all_of', 'has_none_of']);
const numberOf = (s: string): unknown => (/^-?\d+(\.\d+)?$/.test(s.trim()) ? Number(s.trim()) : s);

/** The value control of a row (R142), labelled `Value`. */
function ValueControl({ f, kind, isLinks, attr, hostTitle, onValue }: {
  f: Filter; kind: string; isLinks: boolean; attr: AttrItem | null; hostTitle: string | null; onValue: (v: unknown) => void;
}) {
  const label = t('query.editor.value');
  if (FLAG_OPS.has(f.op) || kind === 'checkbox') return null;
  if (isLinks || f.op === 'links_to') return <ObjectPicker value={f.value} hostTitle={hostTitle} onValue={onValue} />;
  if (LIST_OPS.has(f.op)) {
    const tags = kind === 'tags';
    const text = Array.isArray(f.value) ? (f.value as unknown[]).join(', ') : String(f.value ?? '');
    return <ListInput label={label} initial={text} onList={(l) => onValue(tags ? l.map((x) => x.replace(/^#/, '').trim()).filter(Boolean) : l)} />;
  }
  if (f.op === 'between') {
    const v = Array.isArray(f.value) ? (f.value as unknown[]) : ['', ''];
    const conv = (s: string) => (kind === 'number' ? numberOf(s) : s.trim());
    return (
      <span className="qe-between">
        <input type="text" className="qe-value" aria-label={label} defaultValue={String(v[0] ?? '')} onChange={(e) => onValue([conv(e.target.value), v[1]])} />
        <input type="text" className="qe-value" aria-label={label} defaultValue={String(v[1] ?? '')} onChange={(e) => onValue([v[0], conv(e.target.value)])} />
      </span>
    );
  }
  if ((kind === 'select' || kind === 'review') && attr?.options.length) {
    const opts: ListOption[] = attr.options.map((o) => ({ id: o.label, label: o.label, userNamed: true }));
    const v = typeof f.value === 'string' ? f.value : '';
    return <Chooser label={label} display={v || label} faint={!v} options={opts} current={v || null} onPick={(x) => onValue(x)} className="qe-value-combo" />;
  }
  const numeric = kind === 'number' || f.op === 'within_next_days';
  return (
    <input type="text" className="qe-value" aria-label={label} defaultValue={f.value === undefined || f.value === null ? '' : String(f.value)}
      inputMode={numeric ? 'numeric' : undefined} placeholder={kind === 'date' || kind === 'datetime' ? t('date.fieldPlaceholder') : undefined}
      onChange={(e) => onValue(numeric ? numberOf(e.target.value) : e.target.value)} />
  );
}

function ListInput({ label, initial, onList }: { label: string; initial: string; onList: (l: string[]) => void }) {
  return (
    <input type="text" className="qe-value" aria-label={label} defaultValue={initial}
      onChange={(e) => onList(e.target.value.split(',').map((x) => x.trim()).filter(Boolean))} />
  );
}

/** `links to` / `linked from` and a relation's `links to`: `This note` first, then objects; an ambiguous title is
 *  written in its path form (FR-QRY-02 AC-6, FR-LNK-14). A text field, so any letter can be typed. */
function ObjectPicker({ value, hostTitle, onValue }: { value: unknown; hostTitle: string | null; onValue: (v: unknown) => void }) {
  const [found, setFound] = useState<SwitcherItemDto[]>([]);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const seq = useRef(0);
  const id = useRef(`qe-obj-${Math.random().toString(36).slice(2)}`).current;
  const thisLabel = hostTitle ? `${t('query.editor.thisNote')} · ${hostTitle}` : t('query.editor.thisNote');
  const v = typeof value === 'string' ? value : '';
  const display = v === 'this' ? thisLabel : v ? v.replace(/^\[\[|\]\]$/g, '') : '';
  const search = (text: string) => {
    const n = ++seq.current;
    if (!text.trim()) { setFound([]); return; }
    ipc.switcher(text, 20).then((r) => { if (n === seq.current) setFound(r.filter((x) => x.kind === 'object' && x.path)); }, () => {});
  };
  const opts: { id: string; label: string; extra?: string }[] = [
    { id: 'this', label: thisLabel },
    ...found.map((x) => ({ id: x.path!, label: x.title, extra: x.folder || x.path!.split('/').slice(0, -1).join('/') })),
  ];
  const show = () => {
    if (open) return;
    const r = input.current?.getBoundingClientRect();
    if (r) setPos({ left: r.left, top: r.bottom + 2 });
    setActive(0);
    setOpen(true);
  };
  const pick = (i: number) => {
    const o = opts[i];
    setOpen(false);
    setQ(null);
    if (!o) return;
    if (o.id === 'this') { onValue('this'); return; }
    const x = found.find((y) => y.path === o.id);
    if (!x?.path) return;
    const ambiguous = !!x.duplicate || found.filter((y) => nfc(y.title) === nfc(x.title)).length > 1;
    onValue(`[[${ambiguous ? nfc(x.path.replace(/\.md$/i, '')) : stem(x.path)}]]`);
  };
  useEffect(() => {
    if (!open) return;
    const outside = (e: MouseEvent) => {
      const tg = e.target as Node;
      if (input.current?.contains(tg) || document.getElementById(id)?.contains(tg)) return;
      setOpen(false);
      setQ(null);
    };
    document.addEventListener('mousedown', outside, true);
    return () => document.removeEventListener('mousedown', outside, true);
  }, [open]);
  return (
    <>
      <input ref={input} type="text" role="combobox" className="qe-value" aria-label={t('query.editor.value')} aria-expanded={open} aria-haspopup="listbox"
        aria-controls={open ? id : undefined} aria-activedescendant={open ? `${id}-${active}` : undefined} aria-autocomplete="list"
        value={q ?? display} placeholder={t('query.editor.value')}
        onClick={show}
        onChange={(e) => { setQ(e.target.value); setActive(0); search(e.target.value); show(); }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault(); e.stopPropagation();
            if (!open) { show(); return; }
            const n = opts.length;
            setActive((a) => (e.key === 'ArrowDown' ? (a + 1) % n : (a - 1 + n) % n));
          } else if (e.key === 'Enter') {
            e.preventDefault(); e.stopPropagation();
            if (open) pick(active); else show();
          } else if (e.key === 'Escape' && open) {
            e.preventDefault(); e.stopPropagation();
            setOpen(false); setQ(null);
          } else if (e.key === 'Tab') { setOpen(false); setQ(null); }
        }} />
      {/* The value as text too (the row reads `Links to · is · This note · <host>`), hidden from assistive technology. */}
      {display && <span className="sr-only" aria-hidden="true">{display}</span>}
      {open && pos && (
        <div id={id} role="listbox" aria-label={t('query.editor.value')} className="popover qe-listbox" style={{ left: pos.left, top: pos.top, maxHeight: Math.max(120, Math.min(340, window.innerHeight - pos.top - 8)) }}>
          {opts.map((o, i) => (
            <div key={o.id} id={`${id}-${i}`} role="option" aria-selected={i === active} className={`option ${i === active ? 'selected' : ''}`}
              onMouseDown={(e) => e.preventDefault()} onMouseMove={() => i !== active && setActive(i)} onClick={() => pick(i)}>
              <span data-user-content={o.id === 'this' ? undefined : ''}>{o.label}</span>
              {o.extra && <span className="meta" data-user-content>{o.extra}</span>}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
