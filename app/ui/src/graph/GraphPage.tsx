// Slice G1 (docs/contracts/v1-graph.md §3, §4, §6; graph.md R109…R113): the `graph/<path>` route: the request
// lifecycle (a newer request wins, a late answer is dropped), the full view's state (D-993), the 300 ms loading rule
// (D-912), the R110 states, the cap's banner, live updates (D-980), the preview column (D-982) and the narrow layout
// (D-988). It writes nothing to the vault; its state goes to `ui-state.json` through `onView`.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { t } from '../i18n/catalog';
import { events, ipc } from '../ipc/client';
import { chipIcon, chipTypes, typeNameOf } from '../links/icons';
import { usePreview } from '../preview/PreviewProvider';
import { Icon } from '../shell/Icon';
import { GraphCanvas, nodeBox, type View } from './GraphCanvas';
import { GraphFilters } from './GraphFilters';
import { buildModel, connectionPhrase, displayTitle, headingCount, hiddenText, sortKey, type ModelNode, type NodeKey } from './graphModel';
import { layout, type Point } from './layout';
import { DEBOUNCE, LOADING_AFTER, ZOOM_MAX, ZOOM_MIN, ZOOM_STEP, fmt, kindsOf, reduceMotion, relationNames, stemOf, strings, targetOf, typesAfterAll, unknownHidden, validDepth } from './viewState';
import type { EdgeKindDto, GraphRequestDto, GraphResultDto, GraphViewStateDto, NodeIdDto } from './types';

const CAP = 150;
const MAX_DRAWN = 1000;
const NARROW = 960;

/** Positions per centre and depth for this session (never stored, D-913): Back shows the picture it left. */
const placed = new Map<string, Map<NodeKey, Point>>();

export type GraphNav = {
  /** Opens a node's object (double-click, D-970: in the current view). */
  open: (n: ModelNode) => void;
  /** `Center graph here` / `Recenter`: pushes `graph/<path>` (D-914). */
  centre: (path: string) => void;
  /** An external rename of the centre: replaces the entry (D-914). */
  replace: (path: string) => void;
  back: () => void;
};

export type GraphPageProps = {
  path: string;
  view: GraphViewStateDto | undefined;
  onView: (next: GraphViewStateDto) => void;
  heading: React.RefObject<HTMLHeadingElement | null>;
  nav: GraphNav;
  onTitle: (title: string) => void;
  commandRef: React.RefObject<((id: 'depth1' | 'depth2' | 'depth3' | 'recenter') => void) | null>;
  /** Slice G2 (v1-graph §15.5, D-1037): the panel's hand-over on this history entry: its depth overrides
   *  `graph.full.depth` for the entry only; its node is selected and previewed once drawn. */
  handover?: { depth: 1 | 2 | 3; select: NodeIdDto | null } | null;
  /** A depth change on an entry with a hand-over: the entry keeps what was last seen. */
  onHandoverDepth?: (d: 1 | 2 | 3) => void;
};

type Failure = { kind: 'trash' | 'gone'; title: string };


export function GraphPage(p: GraphPageProps) {
  const centrePath = p.path.normalize('NFC');
  const depth = p.handover ? validDepth(p.handover.depth) : validDepth(p.view?.depth);
  const hiddenTypes = strings(p.view?.hiddenTypes);
  const hiddenKinds = kindsOf(p.view?.hiddenKinds);
  const sizeByLinks = p.view?.sizeByLinks === true;
  const [showAll, setShowAll] = useState(false);
  const [result, setResult] = useState<GraphResultDto | null>(null);
  // The type rows stay while the centre is deleted (its controls are disabled, R110).
  const [lastCounts, setLastCounts] = useState<[string, number][]>([]);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [loading, setLoading] = useState(false);
  const [positions, setPositions] = useState<Map<NodeKey, Point>>(new Map());
  const [entering, setEntering] = useState<Set<NodeKey>>(new Set());
  const [selected, setSelected] = useState<NodeKey | null>(null);
  const [hovered, setHovered] = useState<NodeKey | null>(null);
  const [view, setView] = useState<View>({ zoom: 1, panX: 0, panY: 0 });
  const [pageWidth, setPageWidth] = useState(1200);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const canvasBox = useRef<HTMLDivElement>(null);
  const column = useRef<HTMLDivElement>(null);
  const content = useRef<SVGGElement>(null);
  const allRef = useRef<HTMLButtonElement>(null);
  const allPopRef = useRef<HTMLButtonElement>(null);
  const filtersBtn = useRef<HTMLButtonElement>(null);
  const popover = useRef<HTMLDivElement>(null);
  const seq = useRef(0);
  const shown = useRef<{ json: string; depth: number; sizeKey: string } | null>(null);
  const objectId = useRef<string | null>(null);
  const preview = usePreview();
  // v1-graph §3: `route-ready:graph/<path>` once the first graph or state has painted.
  const routeMarked = useRef(false);
  const markRoute = () => {
    if (routeMarked.current) return;
    routeMarked.current = true;
    void ipc.perfMark(`route-ready:graph/${centrePath}`).catch(() => {});
  };
  useEffect(() => { if (failure) requestAnimationFrame(() => markRoute()); });
  const narrow = pageWidth < NARROW;

  const req: GraphRequestDto = useMemo(() => ({ centre: centrePath, depth, hiddenTypes, hiddenKinds, cap: CAP, showAll }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [centrePath, depth, JSON.stringify(hiddenTypes), JSON.stringify(hiddenKinds), showAll]);
  const reqRef = useRef(req);
  reqRef.current = req;

  // ------------------------------------------------------------------ sizes
  useLayoutEffect(() => {
    const measure = () => {
      if (root.current) setPageWidth(root.current.clientWidth);
      const b = canvasBox.current;
      if (b && b.clientWidth > 0 && b.clientHeight > 0) setSize((s) => (s && s.width === b.clientWidth && s.height === b.clientHeight ? s : { width: b.clientWidth, height: b.clientHeight }));
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (root.current) ro.observe(root.current);
    if (canvasBox.current) ro.observe(canvasBox.current);
    return () => ro.disconnect();
  }, [narrow]);

  // ------------------------------------------------------------------ requests (§6)
  const ask = useCallback(async (r: GraphRequestDto, live: boolean) => {
    const my = ++seq.current;
    const timer = window.setTimeout(() => { if (seq.current === my) setLoading(true); }, LOADING_AFTER);
    try {
      void ipc.perfMark('graph-request').catch(() => {}); // NFR-PERF-11 (D-986): the benchmark's start
      const res = await ipc.graphNeighbourhood(r);
      if (seq.current !== my) return;
      window.clearTimeout(timer);
      setLoading(false);
      setFailure(null);
      const centre = res.nodes.find((n) => n.depth === 0);
      if (centre) { objectId.current = centre.objectId; p.onTitle(displayTitle(centre)); }
      const json = JSON.stringify(res);
      if (live && shown.current?.json === json) return; // an equal result: no redraw (D-980)
      setResult(res);
      setLastCounts(res.typeCounts);
    } catch (e) {
      if (seq.current !== my) return;
      const err = e as { kind?: string; title?: string; name?: string };
      if (err?.kind === 'Cancelled') return;
      if (err?.kind === 'NotReady') return; // the loading state stays until the index is ready (D-990)
      window.clearTimeout(timer);
      if (err?.kind === 'CentreNotFound' || err?.kind === 'CentreInTrash') {
        // An external rename is followed, never shown as deleted (D-981).
        if (err.kind === 'CentreNotFound' && objectId.current) {
          const moved = await ipc.indexPathById(objectId.current).catch(() => null);
          if (seq.current !== my) return;
          if (moved && moved.normalize('NFC') !== r.centre) { p.nav.replace(moved.normalize('NFC')); return; }
        }
        setLoading(false);
        setResult(null);
        shown.current = null;
        setSelected(null);
        const title = err.kind === 'CentreInTrash' ? (err.title ?? err.name ?? stemOf(r.centre)) : (result?.nodes.find((n) => n.depth === 0)?.title ?? stemOf(r.centre));
        setFailure({ kind: err.kind === 'CentreInTrash' ? 'trash' : 'gone', title });
        return;
      }
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result]);
  const askRef = useRef(ask);
  askRef.current = ask;

  useEffect(() => { void askRef.current(req, false); }, [req]);
  // D-979: `Show all` lasts while centre, depth and filters stay.
  useEffect(() => { setShowAll(false); }, [centrePath, depth, JSON.stringify(hiddenTypes), JSON.stringify(hiddenKinds)]);
  // D-980: every vault change re-asks (debounced); D-990: the end of the first index build too.
  useEffect(() => {
    let timer = 0;
    const again = () => { window.clearTimeout(timer); timer = window.setTimeout(() => { void askRef.current(reqRef.current, true); }, DEBOUNCE); };
    const offA = events.changed(again);
    const offB = events.progress((x) => { if (x.state === 'done') again(); });
    return () => { window.clearTimeout(timer); void offA.then((f) => f()).catch(() => {}); void offB.then((f) => f()).catch(() => {}); };
  }, []);

  // ------------------------------------------------------------------ model and layout
  const model = useMemo(() => (result ? buildModel(result, { sizeByLinks }) : null), [result, sizeByLinks]);
  useEffect(() => {
    if (!result || !size || !model) return;
    const json = JSON.stringify(result);
    const key = `${centrePath}\n${depth}`;
    const sizeKey = `${size.width}x${size.height}`;
    const prev = shown.current;
    // Same centre and depth: the nodes that stay keep their place (a filter change or a live update, D-913); a new
    // depth or a first paint: the session's last picture of it, else a fresh layout.
    const keep = prev && prev.depth === depth ? positions : placed.get(key);
    const rel = new Map<NodeKey, Point>();
    if (keep) for (const [k, v] of keep) rel.set(k, { x: v.x + size.width / 2, y: v.y + size.height / 2 });
    const abs = layout(model, size, keep ? rel : undefined);
    const out = new Map<NodeKey, Point>();
    for (const [k, v] of abs) out.set(k, { x: v.x - size.width / 2, y: v.y - size.height / 2 });
    const fresh = new Set<NodeKey>(prev && prev.depth === depth && !reduceMotion() ? [...out.keys()].filter((k) => !positions.has(k)) : []);
    placed.set(key, out);
    shown.current = { json, depth, sizeKey };
    setEntering(fresh);
    setPositions(out);
    if (selected && !model.nodes.some((n) => n.key === selected)) clearSelection();
    requestAnimationFrame(() => requestAnimationFrame(() => { void ipc.perfMark('graph-ready').catch(() => {}); markRoute(); }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result, model, size?.width, size?.height]);

  // ------------------------------------------------------------------ selection and preview (D-982, D-983)
  const lines = useCallback((n: ModelNode) => {
    if (!result) return [];
    const first = t('graph.preview.connections', { type: typeNameOf(n.node.typeKey), count: n.node.degree });
    const second = connectionPhrase(n.node, result, relationNames(chipTypes()));
    return second ? [first, second] : [first];
  }, [result]);
  const centreable = (n: ModelNode) => !n.centre && !!n.node.path;
  const showPreview = (n: ModelNode, el: Element) => {
    const container = column.current;
    if (!container) return;
    preview.show(targetOf(n.node), { el: el as HTMLElement }, 'click', { placement: 'column', container }, lines(n),
      { label: t('graph.centerHere'), disabled: !centreable(n), run: () => { if (centreable(n)) p.nav.centre(n.node.path!); } });
  };
  const pendingShow = useRef<{ n: ModelNode; el: Element } | null>(null);
  const select = (n: ModelNode, el: Element) => {
    setSelected(n.key);
    setFiltersOpen(false);
    pendingShow.current = { n, el };
    if (column.current) { showPreview(n, el); pendingShow.current = null; }
  };
  // In the narrow layout the column mounts with the selection; show the preview once it is there.
  useEffect(() => {
    const s = pendingShow.current;
    if (s && column.current) { pendingShow.current = null; showPreview(s.n, s.el); }
  });
  function clearSelection() {
    setSelected(null);
    pendingShow.current = null;
    if (preview.current) preview.close('outside');
  }
  // Slice G2 (§15.5): the hand-over's node is selected and previewed in the column once it is drawn (D-1037).
  const handed = useRef(false);
  useEffect(() => {
    const want = p.handover?.select;
    if (handed.current || !model || positions.size === 0) return;
    handed.current = true;
    if (!want) return;
    const n = model.nodes.find((x) => x.sortKey === sortKey(want));
    if (!n) return;
    const el = root.current?.querySelector(n.node.typeKey === 'tag'
      ? `[data-graph-node][data-tag-key="${CSS.escape(n.node.tagKey ?? '')}"]`
      : `[data-graph-node][data-path="${CSS.escape(n.node.path ?? '')}"]`);
    if (el) select(n, el);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model, positions]);
  // The preview closed by itself (its close button): the selection goes too.
  const hadPreview = useRef(false);
  useEffect(() => {
    if (preview.current) hadPreview.current = true;
    else if (hadPreview.current) { hadPreview.current = false; if (selected) setSelected(null); }
  }, [preview.current]);
  // A live update or a filter change: the selected node's lines follow (D-982).
  useEffect(() => {
    if (!selected || !model || !column.current) return;
    const n = model.nodes.find((x) => x.key === selected);
    const el = n && document.querySelector(`[data-graph-node][data-path="${CSS.escape(n.node.path ?? '')}"]`);
    if (n && el) showPreview(n, el);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result]);
  // Narrow layout: the selected node stays left of the preview overlay (D-988).
  useEffect(() => {
    if (!narrow || !selected || !size) return;
    const pos = positions.get(selected);
    if (!pos) return;
    const overlay = Math.min(320, size.width * 0.6);
    const x = size.width / 2 + view.panX + pos.x * view.zoom;
    const limit = size.width - overlay - 40;
    if (x > limit) setView((v) => ({ ...v, panX: v.panX - (x - limit) }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, narrow]);

  // ------------------------------------------------------------------ view state (D-993)
  const write = (patch: Partial<GraphViewStateDto>) => p.onView({ ...(p.view ?? {}), ...patch });
  const setDepth = (d: 1 | 2 | 3) => {
    if (d === depth) return;
    write({ depth: d });
    if (p.handover) p.onHandoverDepth?.(d);
  };
  const known = (result?.typeCounts ?? []).map(([k]) => k);
  const unknown = unknownHidden(hiddenTypes, known);
  const setType = (key: string, visible: boolean) => write({ hiddenTypes: visible ? hiddenTypes.filter((k) => k !== key) : [...hiddenTypes, key] });
  const setAll = (visible: boolean) => write({ hiddenTypes: typesAfterAll(hiddenTypes, known, visible) });
  const setKind = (kind: EdgeKindDto, visible: boolean) => write({ hiddenKinds: visible ? hiddenKinds.filter((k) => k !== kind) : [...hiddenKinds, kind] });
  const recenter = () => {
    const n = model?.nodes.find((x) => x.key === selected);
    if (n && centreable(n)) p.nav.centre(n.node.path!);
  };
  p.commandRef.current = (id) => {
    if (id === 'recenter') recenter();
    else setDepth(Number(id.slice(5)) as 1 | 2 | 3);
  };

  // ------------------------------------------------------------------ zoom and pan (D-985)
  const zoomBy = (f: number) => setView((v) => ({ ...v, zoom: Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(v.zoom * f * 10000) / 10000)) }));
  // Fit uses every node's box with its label as drawn at 100 % (shown or not), so labels that appear at the new zoom
  // still fit (D-985).
  const fit = () => {
    if (!model || !size) return;
    let l = Infinity, tp = Infinity, r = -Infinity, bt = -Infinity;
    for (const n of model.nodes) {
      const pos = positions.get(n.key);
      if (!pos) continue;
      const box = nodeBox(n);
      l = Math.min(l, pos.x - box.w / 2); r = Math.max(r, pos.x + box.w / 2);
      tp = Math.min(tp, pos.y - box.top); bt = Math.max(bt, pos.y + box.bottom);
    }
    const b = { x: l, y: tp, width: r - l, height: bt - tp };
    if (!(b.width > 0) || !(b.height > 0)) return;
    const zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.min((size.width - 48) / b.width, (size.height - 48) / b.height)));
    setView({ zoom, panX: -(b.x + b.width / 2) * zoom, panY: -(b.y + b.height / 2) * zoom });
  };
  useEffect(() => {
    const onWheel = (e: WheelEvent) => {
      if (!e.metaKey || !canvasBox.current?.contains(e.target as Node)) return;
      e.preventDefault();
      zoomBy(e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP);
    };
    window.addEventListener('wheel', onWheel, { passive: false });
    return () => window.removeEventListener('wheel', onWheel);
  }, []);

  // ------------------------------------------------------------------ keys: Esc closes the popover, then the preview
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      if (filtersOpen) { e.preventDefault(); setFiltersOpen(false); filtersBtn.current?.focus(); return; }
      if (narrow && selected) { e.preventDefault(); clearSelection(); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });
  useEffect(() => {
    if (!filtersOpen) return;
    const onDown = (e: PointerEvent) => {
      if (popover.current?.contains(e.target as Node) || filtersBtn.current?.contains(e.target as Node)) return;
      setFiltersOpen(false);
    };
    window.addEventListener('pointerdown', onDown, true);
    return () => window.removeEventListener('pointerdown', onDown, true);
  }, [filtersOpen]);
  const filterTypes = () => {
    if (narrow) { setFiltersOpen(true); setTimeout(() => allPopRef.current?.focus(), 0); } else allRef.current?.focus();
  };

  // ------------------------------------------------------------------ what to show
  const centre = result?.nodes.find((n) => n.depth === 0) ?? null;
  const title = centre ? displayTitle(centre) : stemOf(centrePath);
  const noLinks = !!result && result.unfiltered <= 1;
  const allHidden = !!result && !noLinks && result.total <= 1;
  const deleted = !!failure;
  const controlsOff = deleted || noLinks;
  const canvasName = noLinks ? t('graph.noLinks.canvas', { title }) : t('graph.canvas', { title, count: depth });
  const selNode = model?.nodes.find((n) => n.key === selected) ?? null;
  const filterProps = {
    typeCounts: result?.typeCounts ?? lastCounts, hiddenTypes, hiddenKinds, sizeByLinks, disabled: controlsOff,
    onType: setType, onAll: setAll, onKind: setKind, onSize: (on: boolean) => write({ sizeByLinks: on }), allRef,
  };
  const banner = (() => {
    if (!result || deleted) return null;
    const lower = depth > 1 && result.depthTotals?.[depth - 2] !== undefined
      ? <button type="button" data-command="graph.lowerDepth" className="link-button" onClick={() => setDepth((depth - 1) as 1 | 2)}>{t('graph.lowerDepth', { depth: depth - 1, count: fmt(result.depthTotals![depth - 2]) })}</button>
      : null;
    if (result.truncated) {
      const over = result.total > MAX_DRAWN;
      return (
        <div role="status" className="graph-banner">
          <span>{t('graph.tooMany', { count: fmt(result.total), depth })}</span>{' '}
          <span>{over ? t('graph.tooMany.over') : t('graph.tooMany.showing', { shown: fmt(result.nodes.length) })}</span>
          <span className="graph-banner-actions">
            {lower}
            <button type="button" data-command="graph.filterTypes" className="link-button" onClick={filterTypes}>{t('graph.filterTypes')}</button>
            {!over && <button type="button" data-command="graph.showAll" className="link-button" onClick={() => setShowAll(true)}>{t('graph.showAll')}</button>}
          </span>
        </div>
      );
    }
    if (showAll && result.total > CAP) return <div role="status" className="graph-banner">{t('graph.shownAll', { count: fmt(result.total) })}</div>;
    return null;
  })();

  // The side column (hidden below 960 px by CSS) and, in the narrow layout, the overlay; the active one hosts the preview.
  const columnEl = (overlay: boolean) => (
    <aside className={`graph-preview-column${overlay ? ' graph-overlay' : ' side'}`} aria-label={t('graph.preview.label')}>
      <div ref={overlay === narrow ? column : undefined} className="graph-preview-host" />
      {!selNode && (
        <div className="graph-preview-empty">
          <p>{t('graph.preview.empty')}</p>
          <p className="muted">{t('graph.preview.emptyNote')}</p>
        </div>
      )}
    </aside>
  );

  return (
    <div ref={root} className={`graph-page${narrow ? ' narrow' : ''}`}>
      {deleted ? (
        <div role="status" className="graph-deleted">
          <h1 ref={p.heading} tabIndex={-1}>{t('graph.deleted')}</h1>
          <p>{t(failure.kind === 'trash' ? 'graph.deleted.trash' : 'graph.deleted.gone', { title: failure.title })}</p>
          <button type="button" data-command="nav.back" className="button" onClick={p.nav.back}>{t('graph.back')}</button>
        </div>
      ) : (
        <h1 ref={p.heading} tabIndex={-1} className="graph-heading">
          {t('graph.heading')}{' '}
          <span className="graph-centre-chip" data-user-content>
            {centre && centre.typeKey !== 'tag' && <Icon name={chipIcon(centre.typeKey).glyph} dataIcon={chipIcon(centre.typeKey).def} size={14} />}
            {title}
          </span>
          {result && <>{' · '}{headingCount(result)}</>}
        </h1>
      )}
      <div className="graph-toolbar">
        <div role="group" aria-label={t('graph.depth')} className="graph-depth">
          {([1, 2, 3] as const).map((d) => (
            <button key={d} type="button" data-command={`graph.depth${d}`} aria-pressed={depth === d} aria-disabled={controlsOff ? 'true' : undefined}
              onClick={() => { if (!controlsOff) setDepth(d); }}>{d}</button>
          ))}
        </div>
        {result && !deleted && hiddenText(result) && <span role="status" className="graph-hidden">{hiddenText(result)}</span>}
        <button type="button" data-command="graph.recenter" className="button" aria-disabled={!selNode || selNode.centre || !selNode.node.path ? 'true' : undefined} onClick={recenter}>{t('graph.recenter')}</button>
        {/* D-988: shown below 960 px by a container query, so the switch follows the width at once. */}
        <button type="button" ref={filtersBtn} data-command="graph.filters" className="button graph-filters-btn" aria-haspopup="dialog" aria-expanded={filtersOpen} onClick={() => setFiltersOpen((o) => !o)}>{t('graph.filtersButton')}</button>
      </div>
      {banner}
      <div className="graph-body">
        <aside className="graph-filters side" aria-label={t('graph.filters')}><GraphFilters {...filterProps} /></aside>
        {filtersOpen && <div ref={popover} role="dialog" aria-label={t('graph.filters')} className="graph-filters popover"><GraphFilters {...filterProps} allRef={allPopRef} /></div>}
        <div className="graph-canvas-wrap">
          <div ref={canvasBox} className="graph-canvas">
            {size && (
              <GraphCanvas model={deleted || !model ? { centre: null, nodes: [], edges: [] } : model} positions={positions} size={size} view={view} onView={setView}
                selected={selected} hovered={hovered} onHover={setHovered} entering={entering} contentRef={content} name={canvasName}
                onSelect={(n, el) => select(n, el)} onOpen={(n) => p.nav.open(n)} onEmpty={() => { setFiltersOpen(false); clearSelection(); }} />
            )}
            {loading && (
              <div className="graph-loading">
                <div className="graph-skeleton" data-graph-skeleton="" aria-hidden="true"><span /><span /><span /><span /></div>
                <div role="status">{t('graph.loading')}</div>
              </div>
            )}
            {noLinks && <p className="graph-state">{t('graph.noLinks')}</p>}
            {allHidden && (
              <div className="graph-state">
                <p>{t(hiddenKinds.length ? 'graph.allHidden.filters' : 'graph.allHidden.types', { count: result!.hidden })}</p>
                <button type="button" data-command="graph.showAllTypes" className="button" onClick={() => (hiddenKinds.length ? write({ hiddenTypes: unknown, hiddenKinds: [] }) : write({ hiddenTypes: unknown }))}>
                  {t(hiddenKinds.length ? 'graph.showEverything' : 'graph.showAllTypes')}
                </button>
              </div>
            )}
            <p className="graph-hint">{t('graph.hint.click')}</p>
            <div className="graph-zoom">
              <button type="button" className="icon-button" data-command="graph.zoomIn" aria-label={t('graph.zoomIn')} aria-disabled={deleted ? 'true' : undefined} onClick={() => { if (!deleted) zoomBy(ZOOM_STEP); }}><Icon name="plus" size={14} /></button>
              <button type="button" className="icon-button" data-command="graph.zoomOut" aria-label={t('graph.zoomOut')} aria-disabled={deleted ? 'true' : undefined} onClick={() => { if (!deleted) zoomBy(1 / ZOOM_STEP); }}><Icon name="minus" size={14} /></button>
              <button type="button" className="icon-button" data-command="graph.fit" aria-label={t('graph.fit')} aria-disabled={deleted ? 'true' : undefined} onClick={() => { if (!deleted) fit(); }}><Icon name="focus" size={14} /></button>
            </div>
            {narrow && selNode && columnEl(true)}
          </div>
        </div>
        {columnEl(false)}
      </div>
    </div>
  );
}
