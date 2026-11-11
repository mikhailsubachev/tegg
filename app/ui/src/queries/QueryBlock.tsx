// Slice Q (queries.md R141; boards QueryBlock A, C, D, F, G and their Dark variants; v1-queries §4.2…§4.4): the query
// block. One `query_run` per render of a fence (D-1452), live results while its editor is open (D-1453), every state of
// R141 (loading, results, no results, broken parts, needs context, draft, not found, in the trash, unreadable,
// read-only), the List body (Backlinks chips, D-368) and the Table body (virtualized, at most 60 rows in the DOM, header
// sorts and the Columns menu writing the query file once, D-1444, AP-1294), `Show more` paging in memory (D-1443) and
// the new-object footer (D-1439). Used by the read view, the editor (`EditorUi.query`), embeds and the query page.
import { lazy, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import { newQueryFence, referenceFence, savedName, withSavedName } from '@tegg/doc';
import { t } from '../i18n/catalog';
import { events, ipc } from '../ipc/client';
import type { BrokenDto, FilterItemDto, QueryDefDto, QueryDto, QueryResultDto, QueryRowDto, QuerySourceDto } from '../ipc/queries';
import type { TypeDto, TypeRowDto } from '../ipc/types';
import { chipIcon, chipTypes, onChipTypes, typeNameOf } from '../links/icons';
import { chipParts } from '../links/ChipParts';
import { RefElement } from '../preview/useReference';
import { Icon, typeIconName } from '../shell/Icon';
import { TypeCell } from '../types/cell';
import { announceQuery, dismissQueryEditor, openQueryEditor, queryAlert, queryEditorOpen } from './editorHost';
import { openNameDialog } from './dialogs';
import { nowIso, queryEnv } from './env';
import { attributeOf, columnChoices, prefill, toggleColumn, UNIVERSAL } from './model';
import { queryNav } from './nav';
import { openQueryPicker } from './QueryPicker';
import { blockMounted } from './ready';
import { clearSelectedQueryBlock, setSelectedQueryBlock, type SelectedBlock } from './selection';
import { useQueryRun } from './useQueryRun';
import './block.css';

/** The editor's control of a block (contract §3.2 `QueryCtl`), absent in the read view and on the query page. */
export type BlockCtl = {
  getPos(): number | undefined;
  readonly nested: boolean;
  readonly draft: boolean;
  /** Replaces the fence's text as one transaction and one undo step (one autosave), clearing `draft`. */
  setSource(source: string): boolean;
  select(): void;
};

/** What the query page drives on its block. */
export type QueryBlockApi = {
  /** Opens the editor anchored at `anchor` (the page's `Edit query`), focus back to `returnFocus`. */
  edit: (o: { anchor: HTMLElement | null; returnFocus: HTMLElement | null; focusFilter?: number[] | null }) => void;
};

export type QueryBlockProps = {
  /** A block's fence body as written, or a saved query by name (the query page). */
  source: { kind: 'fence'; body: string } | { kind: 'saved'; name: string };
  /** The note whose body holds the fence (`this`, FR-QRY-03); null on the query page. */
  host: string | null;
  /** In the editor (contract §3.2); the fence's full source for `Choose a query…` / `Save as query…`. */
  ctl?: BlockCtl | null;
  fenceSource?: string;
  /** In the editor: the block is the selected node (the 2 px focus ring, board C). */
  selected?: boolean;
  /** In the editor: drop an unsaved draft (Esc with nothing chosen, D-1471). */
  dropDraft?: () => void;
  /** On the query page: a `this` query shows the needs-page section instead of the block (R143). */
  onPage?: boolean;
  apiRef?: MutableRefObject<QueryBlockApi | null>;
  /** The page's query as read (its title, state), when known. */
  query?: QueryDto | null;
};

const nfc = (s: string) => s.normalize('NFC');
/** `New property…` (§4.4) loads the type settings' dialog only when used (it pulls in the editor package). */
const NewPropertyDialog = lazy(() => import('../pages/TypeSettingsPage').then((m) => ({ default: m.NewPropertyDialog })));
/** At most this many table rows in the DOM (§4.3, D-1482). */
const MAX_ROWS = 60;
const DRAFT_DEF = (): QueryDefDto => ({
  title: t('query.editor.untitled'), types: [], match: 'all', filters: [], sort: { by: 'modified', order: 'desc' }, limit: 50, view: 'list', columns: ['type', 'modified'],
});

type BlockState = 'loading' | 'ok' | 'noResults' | 'draft' | 'notFound' | 'trashed' | 'unreadable' | 'needsContext' | 'needsHost' | 'noType';

function useTypes(): TypeDto[] {
  const [types, setTypes] = useState(() => chipTypes() as TypeDto[]);
  useEffect(() => onChipTypes(() => setTypes(chipTypes() as TypeDto[])), []);
  return types;
}

/** The state R141 draws for a result. */
function stateOf(r: QueryResultDto | null, draft: boolean, loading: boolean): BlockState {
  if (draft) return 'draft';
  if (!r || (!r.indexReady && r.rows.length === 0 && r.form !== 'unreadable' && r.lookup !== 'missing' && r.lookup !== 'trashed' && r.lookup !== 'unreadable')) return 'loading';
  if (r.form === 'empty') return 'draft';
  if (r.form === 'unreadable' || r.lookup === 'unreadable') return 'unreadable';
  if (r.lookup === 'missing') return 'notFound';
  if (r.lookup === 'trashed') return 'trashed';
  if (r.state === 'noType') return 'noType';
  if (r.state === 'needsHost') return 'needsHost';
  if (r.state === 'needsContext') return 'needsContext';
  if (loading && !r) return 'loading';
  return r.total > 0 || r.rows.length > 0 ? 'ok' : 'noResults';
}

/** The notice of the first broken part (§4.5). */
function noticeOf(b: BrokenDto, types: TypeDto[]): string {
  if (b.reason === 'noType') return t('query.block.noType', { key: b.key });
  if (b.reason === 'badValue') return t('query.block.brokenKey', { key: b.key });
  if (b.reason === 'notAttribute') return t('query.block.brokenAttr', { attribute: b.key, type: types.find((x) => nfc(x.key) === nfc(b.type ?? ''))?.name ?? typeNameOf(b.type ?? '') });
  return t('query.block.brokenFilter', { attribute: b.key });
}

/** `Links to · This note`: the needs-page example (R143), from the query's first `this` filter. */
function thisExample(def: QueryDefDto | null, types: TypeDto[]): string {
  const find = (items: FilterItemDto[]): Extract<FilterItemDto, { kind: 'filter' }> | null => {
    for (const f of items) {
      if (f.kind === 'filter' && f.value === 'this') return f;
      if (f.kind === 'group') { const g = find(f.filters); if (g) return g; }
    }
    return null;
  };
  const f = def ? find(def.filters) : null;
  const a = f ? attributeOf(types, def!.types, f.key) : null;
  const label = a ? (a.userNamed ? a.label : t(a.label)) : t('query.editor.linksTo');
  return `${label} · ${t('query.editor.thisNote')}`;
}

/** A fence's body (between its fence lines), as the core reads it (R140). */
export function fenceBody(source: string): string {
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  if (lines.length && lines[lines.length - 1] === '') lines.pop();
  const open = lines[0] ?? '';
  const m = /^\s*(`{3,}|~{3,})/.exec(open);
  if (!m) return source;
  const marker = m[1];
  let end = lines.length;
  const last = lines[lines.length - 1];
  if (lines.length > 1 && new RegExp(`^\\s*${marker[0]}{${marker.length},}\\s*$`).test(last)) end = lines.length - 1;
  return lines.slice(1, end).join('\n');
}

export function QueryBlock(p: QueryBlockProps) {
  const types = useTypes();
  const draft = !!p.ctl?.draft;
  const source: QuerySourceDto | null = draft ? null : p.source.kind === 'fence' ? { kind: 'fence', body: p.source.body } : { kind: 'saved', name: p.source.name };
  const run = useQueryRun(source, p.host);
  const [live, setLive] = useState<QueryResultDto | null>(null);
  const editing = useRef(false);
  const result = live ?? run.result;
  const state = stateOf(result, draft, run.loading);
  const def = result?.def ?? (draft ? DRAFT_DEF() : null);
  const name = result?.name ?? (p.source.kind === 'saved' ? p.source.name : null);
  // R144: ⌘↩ (and `Edit query`) on a block still drawing its first rows opens the editor at once, on the reference
  // fence's `saved:` name; the editor reads the query itself (and closes when it can't, as for any missing query).
  const editName = name ?? (state === 'loading' && p.source.kind === 'fence' ? savedName(p.source.body) : null);
  const form = draft ? 'empty' : result?.form ?? (p.source.kind === 'saved' ? 'reference' : null);
  const inline = form === 'inline';
  const readOnly = result?.lookup === 'newer' || p.query?.state === 'newer';
  const title = def?.title ?? name ?? (draft ? t('query.editor.untitled') : '');
  const figure = useRef<HTMLElement | null>(null);
  const editBtn = useRef<HTMLButtonElement | null>(null);
  const [shown, setShown] = useState<number | null>(null);
  const [columnsOpen, setColumnsOpen] = useState(false);
  const columnsBtn = useRef<HTMLButtonElement | null>(null);
  const [newProp, setNewProp] = useState(false);
  const undo = useRef<{ name: string; text: string; el: HTMLElement | null } | null>(null);

  // D-1503: `query-ready` once every block of the opened note has painted its first rows.
  const ready = useRef<ReturnType<typeof blockMounted> | null>(null);
  useEffect(() => { ready.current = blockMounted(p.host ?? ''); return () => ready.current?.unmount(); }, [p.host]);
  useEffect(() => { if (state !== 'loading') ready.current?.painted(); }, [state]);

  /** Opens the editor (R142). */
  const edit = (o: { anchor?: HTMLElement | null; returnFocus?: HTMLElement | null; focusFilter?: number[] | null } = {}) => {
    if (readOnly || inline) return;
    if (!draft && (!editName || state === 'notFound' || state === 'trashed' || state === 'unreadable')) return;
    const ret = o.returnFocus ?? editBtn.current ?? figure.current;
    editing.current = true;
    // The block's own editor (anchored at the block) closes with the block; the query page's stays with its page.
    ownAnchor.current = !o.anchor || o.anchor === figure.current;
    openQueryEditor({
      name: draft ? null : editName,
      host: p.host,
      anchor: o.anchor ?? figure.current,
      returnFocus: ret,
      selectTitle: draft,
      focusFilter: o.focusFilter ?? null,
      def: draft ? DRAFT_DEF() : null,
      onResult: (r) => setLive(r),
      onCommitted: ({ query, undo: before }) => {
        if (before !== null && query.name) undo.current = { name: query.name, text: before, el: ret };
        run.rerun();
        // One polite announcement per commit (FR-UX-08 AC-18): the committed query's count.
        void ipc.queryRun({ kind: 'saved', name: query.name }, p.host, queryEnv()).then((r) => announceQuery(t('query.editor.results', { count: r.total })), () => {});
      },
      onDraftCommit: async (newTitle, d) => {
        const q = await ipc.queryCreate(newTitle, d, null, true, nowIso(Date.now()));
        p.ctl?.setSource(newQueryFence(q.name));
      },
      onDraftDrop: () => p.dropDraft?.(),
      onClosed: () => { editing.current = false; setLive(null); },
    });
  };
  const editRef = useRef(edit);
  editRef.current = edit;
  const editAfterRun = useRef(false);
  useEffect(() => {
    if (!editAfterRun.current || (state !== 'ok' && state !== 'noResults')) return;
    editAfterRun.current = false;
    editRef.current();
  }, [state]);
  // The host note changed outside Tegg while this block's editor is open: the note reloads and the editor closes
  // without a commit (FR-EDT-02 AC-25).
  useEffect(() => {
    if (!p.host) return;
    const h = nfc(p.host);
    const un = events.changed((c) => {
      if (editing.current && (c.paths ?? []).some((x) => nfc(x) === h)) dismissQueryEditor();
    });
    return () => { void un.then((f) => f()).catch(() => {}); };
  }, [p.host]);
  useEffect(() => {
    if (p.apiRef) p.apiRef.current = { edit: (o) => editRef.current({ anchor: o.anchor ?? undefined, returnFocus: o.returnFocus ?? undefined, focusFilter: o.focusFilter }) };
    return () => { if (p.apiRef) p.apiRef.current = null; };
  }, [p.apiRef]);
  // A new draft opens its editor at once with the title selected (board C).
  const opened = useRef(false);
  useEffect(() => {
    if (draft && !opened.current) { opened.current = true; setTimeout(() => editRef.current(), 0); }
  }, [draft]);
  // The block leaves (or the note reloads): an editor of this block closes without a commit (FR-EDT-02 AC-25).
  const ownAnchor = useRef(true);
  useEffect(() => () => { if (editing.current && ownAnchor.current && queryEditorOpen()) dismissQueryEditor(); }, []);

  // The selected block in the editor: `Edit query` in the palette and ⌘↩ (v1-queries §4.6).
  const sel = useRef<SelectedBlock | null>(null);
  useEffect(() => {
    if (!p.selected) return;
    const b: SelectedBlock = { name: draft ? null : editName, editable: !readOnly && !inline && state !== 'unreadable', edit: () => editRef.current() };
    sel.current = b;
    setSelectedQueryBlock(b);
    return () => clearSelectedQueryBlock(b);
  }, [p.selected, editName, readOnly, inline, state, draft]);

  // ⌘Z right after a commit, while the block's `Edit query` (or the page's) still has the focus: one `query_revert`
  // with the bytes before (D-1476).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const u = undo.current;
      if (!u || !(e.metaKey && !e.shiftKey && e.key.toLowerCase() === 'z')) return;
      const a = document.activeElement;
      if (!a || !(a === u.el || figure.current?.contains(a))) return;
      e.preventDefault();
      e.stopPropagation();
      undo.current = null;
      void (async () => {
        try {
          const q = await ipc.queryGet(u.name);
          await ipc.queryRevert(u.name, q.version, u.text);
        } catch { queryAlert(t('query.editor.changedOutside')); }
        run.rerun();
      })();
    };
    const drop = (e: FocusEvent) => { const u = undo.current; if (u && e.target !== u.el && !figure.current?.contains(e.target as Node)) undo.current = null; };
    window.addEventListener('keydown', onKey, true);
    document.addEventListener('focusin', drop);
    return () => { window.removeEventListener('keydown', onKey, true); document.removeEventListener('focusin', drop); };
  }, []);

  /** A header sort or a Columns change: `query_apply` with only that key changed (D-1444, §4.4). */
  const apply = async (patch: Partial<QueryDefDto>) => {
    const r = run.result;
    if (!r?.def || !name || readOnly || inline) return;
    try {
      const out = await ipc.queryApply(name, r.version, { ...r.def, ...patch }, nowIso(Date.now()));
      if (out.undo !== null) undo.current = null;
    } catch (e) {
      const k = (e as { kind?: string } | null)?.kind;
      if (k === 'Io') queryAlert(t('query.saveFailed'));
      else queryAlert(t('query.editor.changedOutside'));
    }
    run.rerun();
  };

  // Show more: pages of `limit`, in memory (D-1443).
  const limit = Math.max(1, def?.limit ?? 50);
  const total = result?.total ?? result?.rows.length ?? 0;
  const count = Math.min(shown ?? limit, result?.rows.length ?? 0);
  const rows = result?.rows.slice(0, count) ?? [];
  const more = Math.min(limit, (result?.rows.length ?? 0) - count);

  const broken = result?.broken ?? [];
  const firstBroken = broken[0] ?? null;
  const showResults = state === 'ok' || state === 'noResults';
  const view = def?.view ?? 'list';
  const host = p.host;
  const foot = showResults && host && def && !inline && !readOnly ? prefill(def, host, types) : null;
  const typeName = (k: string) => types.find((x) => nfc(x.key) === nfc(k))?.name ?? typeNameOf(k);

  if (p.onPage && (state === 'needsHost' || state === 'needsContext')) {
    return (
      <section className="query-needs-page" data-query-state="needsHost">
        <span className="query-tile" aria-hidden="true"><Icon name="query" size={20} /></span>
        <h2>{t('query.needsPage')}</h2>
        <p>{t('query.needsPageBody', { example: thisExample(def, types) })}</p>
      </section>
    );
  }

  const message = (() => {
    const btn = (label: string, on: () => void, primary = false) => (
      <button type="button" tabIndex={0} className={`query-msg-button${primary ? ' primary' : ''}`} data-command="query.block.action" onClick={on}>{label}</button>
    );
    switch (state) {
      case 'noResults':
        return <p className="query-message">{t('query.block.noResults')} {!inline && !readOnly && name && btn(t('query.edit'), () => edit())}</p>;
      case 'draft':
        return (
          <p className="query-message">{t('query.block.draft')} {!draft && p.ctl && btn(t('query.block.chooseQuery'), () => chooseQuery())}</p>
        );
      case 'notFound':
        return (
          <p className="query-message">{t('query.block.notFound', { name: name ?? '' })}{' '}
            {p.ctl && btn(t('query.block.chooseQuery'), () => chooseQuery())}{' '}
            {btn(t('query.block.createIt'), () => { void createIt(); })}
          </p>
        );
      case 'trashed':
        return <p className="query-message">{t('query.block.trashed', { name: name ?? '' })} {btn(t('query.block.restore'), () => { void restore(); })}</p>;
      case 'unreadable':
        return (
          <p className="query-message">{t('query.block.unreadable', { line: result?.line ?? 1 })}{' '}
            {form !== 'inline' && form !== 'unreadable' && name && btn(t('query.block.openQuery'), () => queryNav()?.openQuery(name))}
          </p>
        );
      case 'needsContext': case 'needsHost':
        return <p className="query-message">{t('query.block.needsContext')}</p>;
      default:
        return null;
    }
  })();

  const chooseQuery = () => {
    const src = p.fenceSource;
    if (!p.ctl || !src) return;
    const anchor = figure.current?.getBoundingClientRect();
    openQueryPicker({
      at: anchor ? { left: anchor.left, top: anchor.top + 36 } : null,
      withNew: false,
      onChoose: (n) => {
        if (!n) return;
        const next = withSavedName(src, n) ?? newQueryFence(n);
        p.ctl?.setSource(next);
      },
      onCancel: () => {},
    });
  };
  const createIt = async () => {
    if (!name) return;
    try {
      await ipc.queryCreate(name, null, null, false, nowIso(Date.now()));
    } catch (e) {
      const k = (e as { kind?: string } | null)?.kind;
      queryAlert(k === 'NameTaken' ? t('query.newQuery.taken') : t('query.saveFailed'));
      return;
    }
    // D-1486: the editor opens on the block (once its result arrives), which shows the default's results.
    editAfterRun.current = true;
    run.rerun();
  };
  const restore = async () => {
    if (!name) return;
    try { await ipc.queryRestore(name); } catch { queryAlert(t('query.saveFailed')); }
    run.rerun();
  };
  const saveAs = () => {
    const src = p.fenceSource;
    const body = p.source.kind === 'fence' ? p.source.body : null;
    if (!p.ctl || !src || body === null) return;
    openNameDialog({
      kind: 'saveAs', initial: def?.title ?? '', fence: body, returnFocus: document.activeElement as HTMLElement | null,
      onCreated: (n) => { p.ctl?.setSource(referenceFence(src, n)); },
    });
  };

  const header = (
    <div className="query-header">
      <span className="query-icon" aria-hidden="true"><Icon name="query" size={14} dataIcon="query" /></span>
      <span className="query-title" data-user-content>{title}</span>
      {showResults && <span className="query-count" aria-hidden="true">{total}</span>}
      <span className="query-header-gap" />
      {inline ? (
        p.ctl && showResults && <button type="button" tabIndex={0} className="query-head-button" data-command="query.saveAs" onClick={saveAs}>{t('query.block.saveAs')}</button>
      ) : (
        <>
          {showResults && view === 'table' && (
            <button ref={columnsBtn} type="button" tabIndex={0} className="query-head-button" data-command="query.columns" aria-haspopup="menu" aria-expanded={columnsOpen}
              aria-disabled={readOnly || undefined} onClick={() => { if (!readOnly) setColumnsOpen((o) => !o); }}>
              <Icon name="panel" size={13} />{t('query.block.columns')}
            </button>
          )}
          {(draft || name) && state !== 'notFound' && state !== 'trashed' && state !== 'unreadable' && (
            <button ref={editBtn} type="button" tabIndex={0} className="icon-button small query-edit" data-command="query.edit" aria-label={t('query.edit')} title={t('query.edit')} aria-haspopup="dialog"
              aria-disabled={readOnly || undefined} aria-description={readOnly ? t('query.block.readOnly') : undefined}
              onClick={() => edit()}>
              <Icon name="pencil" size={14} />
            </button>
          )}
        </>
      )}
    </div>
  );

  const typeOf = (k: string) => types.find((x) => nfc(x.key) === nfc(k));
  const openRow = (path: string) => queryNav()?.openNote(path);
  const body = (() => {
    if (state === 'loading') {
      // The run failed (no core answered): the fence's text, so nothing written is lost from view (FR-EDT-02 AC-12).
      if (run.error && p.source.kind === 'fence') return <pre className="query-source" data-user-content>{p.source.body}</pre>;
      return <div className="query-skeleton" aria-hidden="true"><span /><span /><span /></div>;
    }
    if (state !== 'ok') return null;
    if (view === 'table' && def) {
      return <ResultsTable def={def} rows={rows} types={types} typeOf={typeOf} typeName={typeName} title={title} onOpen={openRow}
        onSort={(by) => {
          const cur = def.sort;
          const order: 'asc' | 'desc' = nfc(cur.by) === nfc(by) && cur.order === 'asc' ? 'desc' : 'asc';
          void apply({ sort: { by, order } });
        }} />;
    }
    return (
      <ul className="query-list" aria-label={title}>
        {rows.map((r) => <li key={r.path}><ResultChip row={r} onOpen={openRow} /></li>)}
      </ul>
    );
  })();

  const label = t('query.block.label', { title });
  return (
    <figure ref={figure as MutableRefObject<HTMLElement | null>} className={`query-block-frame${p.selected ? ' selected' : ''}`} aria-label={label}
      aria-description={showResults ? t('query.editor.results', { count: total }) : undefined}
      data-query-block="" data-query-form={form ?? undefined} data-query-name={name ?? undefined} data-query-state={state}
      data-query-broken={showResults && broken.length ? String(broken.length) : undefined} data-query-readonly={readOnly ? '' : undefined}
      onKeyDown={(e) => {
        // ⌘↩ with the focus in the block (its `Edit query`, a result) opens the editor (R144).
        if (e.key === 'Enter' && e.metaKey && !e.shiftKey && !e.altKey) { e.preventDefault(); e.stopPropagation(); edit(); }
      }}>
      {header}
      {showResults && firstBroken && (
        <p className="query-notice">
          <Icon name="warning" size={13} />{noticeOf(firstBroken, types)}{' '}
          {firstBroken.reason !== 'noType' && firstBroken.reason !== 'badValue' && !inline && !readOnly && name && (
            <button type="button" tabIndex={0} className="text-button" data-command="query.edit" onClick={() => edit({ focusFilter: firstBroken.at })}>{t('query.block.fixFilter')}</button>
          )}
        </p>
      )}
      {state === 'noType' && firstBroken && <p className="query-notice"><Icon name="warning" size={13} />{noticeOf(firstBroken, types)}</p>}
      {message}
      {state === 'unreadable' && form === 'unreadable' && p.source.kind === 'fence' && <pre className="query-source" data-user-content>{p.source.body}</pre>}
      {body}
      {state === 'ok' && more > 0 && (
        <button type="button" tabIndex={0} className="query-more" data-command="query.showMore" onClick={() => setShown(count + limit)}>
          {t('query.block.showMore', { count: more, total })}
        </button>
      )}
      {foot && (
        <div className="query-foot">
          <button type="button" tabIndex={0} className="query-new" data-command="query.newObject" aria-description={foot.values.some(([k]) => k === 'source') ? t('query.block.linksHere') : undefined}
            onClick={() => queryNav()?.openNew(foot.type, foot.values)}>
            <Icon name="plus" size={13} />{t('query.block.newObject', { type: typeName(foot.type) })}
          </button>
          {foot.values.some(([k]) => k === 'source') && <span className="query-foot-hint" aria-hidden="true">{t('query.block.linksHere')}</span>}
        </div>
      )}
      {columnsOpen && def && (
        <ColumnsMenu def={def} types={types} anchor={columnsBtn.current}
          onToggle={(key, on) => { void apply({ columns: toggleColumn(def, key, on) }); }}
          onNewProperty={() => { setColumnsOpen(false); setNewProp(true); }}
          onClose={() => { setColumnsOpen(false); columnsBtn.current?.focus(); }} />
      )}
      {newProp && def && def.types.length === 1 && typeOf(def.types[0]) && (
        <Suspense fallback={null}><NewPropertyDialog type={typeOf(def.types[0])!} types={types}
          onClose={() => { setNewProp(false); columnsBtn.current?.focus(); }}
          onDone={() => {
            setNewProp(false);
            const before = new Set(typeOf(def.types[0])!.attributes.map((a) => nfc(a.key)));
            // The new property joins the columns once the type is read again (`New property…`, §4.4).
            void ipc.vaultTypes().then((all) => {
              const tNew = all.find((x) => nfc(x.key) === nfc(def.types[0]));
              const added = tNew?.attributes.find((a) => !before.has(nfc(a.key)));
              if (added) void apply({ columns: [...def.columns, nfc(added.key)] });
            }, () => {});
          }} /></Suspense>
      )}
    </figure>
  );
}

/** A List row: the object's link chip exactly as in the Backlinks panel (D-368): type icon, title and, for a Task, its
 *  due date and status after a divider. */
function ResultChip({ row, onOpen }: { row: QueryRowDto; onOpen: (path: string) => void }) {
  const icon = chipIcon(row.type);
  const parts = chipParts({ kind: 'note', type: row.type, review: (row.values.review as string | undefined) ?? null, status: row.task?.status ?? null, due: row.task?.due ?? null, completed: (row.values.completed as string | undefined) ?? null });
  return (
    <RefElement as="a" href="#" tabIndex={0} className="chip link-chip kind-note" data-link-kind="note" data-query-result={nfc(row.path)} data-path={nfc(row.path)}
      data-title={row.title} data-icon={icon.def} title={row.title} aria-label={row.title} aria-description={parts.description ?? undefined} {...parts.attrs}
      reference={{ target: { path: nfc(row.path), fragment: null, kind: 'note' }, kind: 'chip', open: () => onOpen(row.path) }}
      onClick={(e: React.MouseEvent) => e.preventDefault()}>
      {parts.icon ?? <Icon name={icon.glyph} dataIcon={icon.def} size={13} />}
      <span className="chip-text"><span data-user-content>{row.title}</span>{parts.suffix}</span>
    </RefElement>
  );
}

type Col = { key: string; label: string; userNamed: boolean; sortable: boolean };

/** The Table body (board F, G): Title first (the type icon when mixed, the read-only task checkbox for a Task), then
 *  `columns` in order; empty cells `—`; a header click / ⏎ / Space sorts (D-1444); at most 60 rows in the DOM. */
function ResultsTable({ def, rows, types, typeOf, typeName, title, onOpen, onSort }: {
  def: QueryDefDto; rows: QueryRowDto[]; types: TypeDto[]; typeOf: (k: string) => TypeDto | undefined; typeName: (k: string) => string;
  title: string; onOpen: (path: string) => void; onSort: (by: string) => void;
}) {
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
  const win = useRowWindow(body, rows.length);
  const [cursor, setCursor] = useState(0);
  const sortBy = nfc(def.sort.by);
  const shown = rows.slice(win.from, win.to);
  const focusRow = (i: number) => {
    const j = Math.max(0, Math.min(rows.length - 1, i));
    setCursor(j);
    win.reveal(j);
    requestAnimationFrame(() => body.current?.querySelector<HTMLElement>(`tr[data-index="${j}"]`)?.focus());
  };
  return (
    <div className="query-table-box">
      <table className="query-table" aria-label={title}>
        <thead>
          <tr>
            {cols.map((c) => {
              const sorted = c.sortable && sortBy === c.key ? def.sort.order : null;
              return (
                <th key={c.key} tabIndex={0} scope="col" aria-sort={sorted ? (sorted === 'asc' ? 'ascending' : 'descending') : c.sortable ? 'none' : undefined}
                  className={c.sortable ? 'sortable' : undefined}
                  onClick={() => { if (c.sortable) onSort(c.key); }}
                  onKeyDown={(e) => { if (c.sortable && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); e.stopPropagation(); onSort(c.key); } }}>
                  <span data-user-content={c.userNamed ? '' : undefined}>{c.label}</span>{sorted && <span className="sort-arrow">{sorted === 'asc' ? ' ↑' : ' ↓'}</span>}
                </th>
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
                  <td key={c.key} onClick={c.key === 'title' ? undefined : (e) => e.stopPropagation()} onDoubleClick={c.key === 'title' ? undefined : (e) => e.stopPropagation()}>
                    {c.key === 'title' ? (
                      <span className="cell-title">
                        {r.task && !mixed
                          ? <span role="checkbox" aria-checked={done} aria-disabled="true" aria-label={r.title} aria-description={t('query.block.taskReadOnly')} className={`query-task-box${done ? ' done' : ''}`}>{done && <Icon name="check" size={11} />}</span>
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
    onOpen={(p) => queryNav()?.openNote(p)} onTag={(k) => queryNav()?.go({ id: 'tag/<key>', param: k })} typeKey={row.type} />;
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

/** The block's Columns menu (board F, G; R130's rows for one type, the universal rows plus Type when mixed, AP-1294):
 *  Title checked and disabled, the choices checked when shown, then `New property…` (one type, not Tag). Each change
 *  writes `columns:` once. Arrow keys move (disabled items too), Space / ⏎ toggle, Esc closes. */
function ColumnsMenu({ def, types, anchor, onToggle, onNewProperty, onClose }: {
  def: QueryDefDto; types: TypeDto[]; anchor: HTMLElement | null; onToggle: (key: string, on: boolean) => void; onNewProperty: () => void; onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number }>({ left: 0, top: 0 });
  const one = def.types.length === 1 ? types.find((x) => nfc(x.key) === nfc(def.types[0])) : undefined;
  const mixed = def.types.length !== 1;
  const shownCols = new Set(def.columns.map(nfc));
  const choices = columnChoices(def, types).filter((k) => k !== 'title');
  const labelOf = (k: string): { label: string; user: boolean } => {
    if (k === 'type') return { label: t('ts.type'), user: false };
    const a = one?.attributes.find((x) => nfc(x.key) === k);
    if (a) return { label: a.name, user: true };
    if (k === 'modified') return { label: t('typePage.modified'), user: false };
    return { label: t(UNIVERSAL.find((u) => u.key === k)?.label ?? k), user: false };
  };
  useLayoutEffect(() => {
    if (!anchor) return;
    const r = anchor.getBoundingClientRect();
    setPos({ left: Math.min(r.left, window.innerWidth - 260), top: r.bottom + 4 });
  }, [anchor]);
  const items = () => [...(ref.current?.querySelectorAll<HTMLElement>('[data-menu-item]') ?? [])];
  useEffect(() => {
    items()[0]?.focus();
    const outside = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node) && !anchor?.contains(e.target as Node)) onClose(); };
    document.addEventListener('mousedown', outside, true);
    return () => document.removeEventListener('mousedown', outside, true);
  }, []);
  const onKeyDown = (e: React.KeyboardEvent) => {
    const list = items();
    const i = list.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (list.length) list[e.key === 'ArrowDown' ? (i + 1) % list.length : (i - 1 + list.length) % list.length].focus();
    } else if (e.key === 'Home' || e.key === 'End') { e.preventDefault(); list[e.key === 'Home' ? 0 : list.length - 1]?.focus(); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); }
    else if (e.key === 'Tab') e.preventDefault();
    e.stopPropagation();
  };
  const check = (on: boolean) => <span className="menu-check" aria-hidden="true">{on && <Icon name="check" size={14} />}</span>;
  // Each checkbox item also carries a `menuitem` part, so lists of a menu's items name every row (its role is
  // presentational inside the checkbox item for assistive technology).
  const item = (key: string, label: string, user: boolean, on: boolean, disabled: boolean, choose: () => void) => (
    <div key={key} role="menuitemcheckbox" aria-checked={on} aria-disabled={disabled || undefined} aria-label={label} tabIndex={-1} data-menu-item=""
      className={`menu-item${on ? ' checked' : ''}`}
      onClick={() => { if (!disabled) choose(); }}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (!disabled) choose(); } }}>
      {check(on)}<span role="menuitem" className="menu-title" data-user-content={user ? '' : undefined}>{label}</span>
    </div>
  );
  return (
    <div ref={ref} className="popup-menu query-columns-menu" role="menu" aria-label={t('query.block.columns')} onKeyDown={onKeyDown}
      style={{ left: pos.left, top: pos.top, maxHeight: `calc(100vh - ${pos.top + 8}px)`, overflowY: 'auto' }}>
      {item('title', t('typePage.title'), false, true, true, () => {})}
      {choices.map((k) => { const l = labelOf(k); const on = shownCols.has(k); return item(k, l.label, l.user, on, false, () => onToggle(k, !on)); })}
      {mixed && <div className="menu-note"><span className="muted-text">{t('query.columns.mixed')}</span></div>}
      {!mixed && one && one.key !== 'tag' && (
        <>
          <div role="separator" className="menu-sep" />
          <div role="menuitem" tabIndex={-1} data-menu-item="" className="menu-item" aria-label={t('typePage.newProperty')}
            onClick={onNewProperty} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onNewProperty(); } }}>
            <span className="menu-check" aria-hidden="true" /><span className="menu-title">{t('typePage.newProperty')}</span>
          </div>
        </>
      )}
    </div>
  );
}
