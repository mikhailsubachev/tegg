// Slice G2 (docs/contracts/v1-graph.md §15; graph-panel.md R114…R117): the right panel's `tabpanel` `Graph` — request
// lifecycle (300 ms loading, latest request wins, debounced live re-query; §6, §15.7), the R115 states, the selection
// and its preview popover beside the panel (§15.4, D-1041), the `Depth and filters` popover (R114) and the way to the
// full view (§15.5). It reuses G1's canvas, filters, model and layout with their panel variants. It writes nothing to the
// vault; its state goes to `ui-state.json` (`graph.panel`) through `onState`.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { region } from '../i18n/collate';
import { t } from '../i18n/catalog';
import { events, ipc } from '../ipc/client';
import type { TypeDefDto } from '../ipc/types';
import { typeNameOf } from '../links/icons';
import { usePreview } from '../preview/PreviewProvider';
import type { PreviewTarget } from '../preview/types';
import { SHORTCUTS } from '../shell/registry';
import { GraphCanvas, nodeBox, type View } from './GraphCanvas';
import { GraphFilters } from './GraphFilters';
import { buildModel, connectionPhrase, displayTitle, type ModelNode, type NodeKey, type RelationNames } from './graphModel';
import { layout, type Point } from './layout';
import { PANEL_CAP, footerText, lowerDepthOffer, panelFit, panelState, triggerText } from './panelModel';
import type { EdgeKindDto, GraphNodeDto, GraphRequestDto, GraphResultDto, GraphViewStateDto, NodeIdDto } from './types';

/** §15.5: what the panel hands to the full view, on the new history entry. */
export type GraphHandover = { depth: 1 | 2 | 3; select: NodeIdDto | null };

/** What the shell asks of a shown panel graph: `Graph: Depth n` (D-1035) and ⌘⇧G / `Open graph` (R116 rule 3). */
export type GraphPanelCommands = { depth: (d: 1 | 2 | 3) => void; openFull: () => void };

export type GraphPanelProps = {
  /** The page's object; null path = no file (new/<type>, a virtual day) → R115 No file. */
  centre: { path: string | null; title: string; objectId: string | null };
  vaultPath: string;
  state: GraphViewStateDto;
  onState(next: GraphViewStateDto): void;
  onOpen(node: GraphNodeDto): void;
  onOpenFull(handover: GraphHandover): void;
  refresh: number;
  width: number;
  types: TypeDefDto[];
  /** The day's file isn't known yet: nothing is drawn and nothing is asked. */
  pending?: boolean;
  /** `Show local graph` (FR-NAV-05 AC-2): each change puts the focus on `Depth and filters`. */
  focusTrigger?: number;
  /** Set while mounted: the shell's commands for the shown panel graph. */
  commandRef?: React.MutableRefObject<GraphPanelCommands | null>;
};

const LOADING_AFTER = 300;
const DEBOUNCE = 300;
const JOB_WAIT = 5000;
const ZOOM_MIN = 0.25, ZOOM_MAX = 4, ZOOM_STEP = 1.25;
const KIND_KEYS: EdgeKindDto[] = ['link', 'relation', 'embed', 'tag'];
/** D-1031: the panel's tighter forces. */
const PANEL_FORCES = { distance: 72, charge: -150, gap: 14 };
const POPOVER_W = 268;
const GAP = 8;

type Failure = { kind: 'trash' | 'gone'; title: string };
/** The last `Show local graph` that put the focus on the trigger: a later mount of the tab doesn't take it again. */
let focusSeen = 0;
type Shown = { centre: string; objectId: string | null; depth: number; filters: string; json: string };

const stemOf = (p: string) => (p.split('/').pop() ?? p).replace(/\.md$/, '');
const validDepth = (d: unknown): 1 | 2 | 3 => (d === 1 || d === 2 || d === 3 ? d : 1);
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
const kindsOf = (v: unknown): EdgeKindDto[] => strings(v).filter((k): k is EdgeKindDto => (KIND_KEYS as string[]).includes(k));
const fmt = (n: number) => new Intl.NumberFormat(region() ?? 'en-US').format(n);
const reduceMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

function relationNames(types: TypeDefDto[]): RelationNames {
  return types.map((x) => ({ key: x.key, attributes: ((x as { attributes?: { key: string; name: string }[] }).attributes ?? []).map((a) => ({ key: a.key, name: a.name })) }));
}
const targetOf = (n: GraphNodeDto): PreviewTarget => (n.typeKey === 'tag'
  ? { kind: 'tag', key: n.tagKey ?? n.title, path: n.path ?? '', fragment: null }
  : { kind: 'note', path: n.path ?? '', fragment: null });
const sameTarget = (a: PreviewTarget, n: GraphNodeDto) => {
  const b = targetOf(n);
  return a.kind === b.kind && (a.kind === 'tag' ? (a.key ?? '').normalize('NFC') === (b.key ?? '').normalize('NFC') : a.path.normalize('NFC') === b.path.normalize('NFC'));
};

export function GraphPanel(p: GraphPanelProps) {
  const centrePath = p.pending ? null : (p.centre.path?.normalize('NFC') ?? null);
  const depth = validDepth(p.state?.depth);
  const hiddenTypes = strings(p.state?.hiddenTypes);
  const hiddenKinds = kindsOf(p.state?.hiddenKinds);
  const sizeByLinks = p.state?.sizeByLinks === true;
  const filterKey = JSON.stringify([hiddenTypes, hiddenKinds, sizeByLinks]);

  const [result, setResult] = useState<{ res: GraphResultDto; req: GraphRequestDto } | null>(null);
  const [lastCounts, setLastCounts] = useState<[string, number][]>([]);
  const [error, setError] = useState<'NotReady' | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [waiting, setWaiting] = useState(false);
  const [positions, setPositions] = useState<Map<NodeKey, Point>>(new Map());
  const [entering, setEntering] = useState<Set<NodeKey>>(new Set());
  const [selected, setSelectedState] = useState<NodeKey | null>(null);
  const selRef = useRef<NodeKey | null>(null);
  const setSelected = (k: NodeKey | null) => { selRef.current = k; setSelectedState(k); };
  const [hovered, setHovered] = useState<NodeKey | null>(null);
  const [view, setView] = useState<View>({ zoom: 1, panX: 0, panY: 0 });
  const [height, setHeight] = useState<number | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [popPos, setPopPos] = useState<{ left: number; top: number } | null>(null);
  const canvasBox = useRef<HTMLDivElement>(null);
  const content = useRef<SVGGElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popover = useRef<HTMLDivElement>(null);
  const radioRef = useRef<HTMLButtonElement>(null);
  const seq = useRef(0);
  const shown = useRef<Shown | null>(null);
  const objectId = useRef<string | null>(p.centre.objectId);
  const lastTitle = useRef<string | null>(null);
  const preview = usePreview();
  const types = p.types;

  const canvasW = Math.max(0, Math.round(p.width) - 28);
  const size = height !== null && canvasW > 0 ? { width: canvasW, height } : null;

  const req: GraphRequestDto | null = useMemo(() => (centrePath
    ? { centre: centrePath, depth, hiddenTypes, hiddenKinds, cap: PANEL_CAP, showAll: false }
    : null),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [centrePath, depth, JSON.stringify(hiddenTypes), JSON.stringify(hiddenKinds)]);
  const reqRef = useRef(req);
  reqRef.current = req;

  // ------------------------------------------------------------------ the canvas's height (R114: the rest of the tab)
  useLayoutEffect(() => {
    const b = canvasBox.current;
    if (!b) return;
    const measure = () => { if (b.clientHeight > 0) setHeight((h) => (h === b.clientHeight ? h : b.clientHeight)); };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(b);
    return () => ro.disconnect();
  }, []);

  // ------------------------------------------------------------------ requests (§6, §15.1)
  const ask = useCallback(async (r: GraphRequestDto, live: boolean) => {
    const my = ++seq.current;
    const timer = window.setTimeout(() => { if (seq.current === my) setWaiting(true); }, LOADING_AFTER);
    try {
      void ipc.perfMark('graph-request').catch(() => {}); // NFR-PERF-11 AC-3 (D-1043)
      const res = await ipc.graphNeighbourhood(r);
      if (seq.current !== my) return;
      window.clearTimeout(timer);
      setWaiting(false);
      setError(null);
      setFailure(null);
      const centre = res.nodes.find((n) => n.depth === 0);
      if (centre) { objectId.current = centre.objectId ?? objectId.current; lastTitle.current = displayTitle(centre); }
      setLastCounts(res.typeCounts);
      // An equal result redraws nothing (D-980).
      if (live && shown.current?.json === JSON.stringify(res) && shown.current.centre === r.centre) return;
      setResult({ res, req: r });
    } catch (e) {
      if (seq.current !== my) return;
      const err = e as { kind?: string; title?: string; name?: string };
      if (err?.kind === 'Cancelled') return; // a newer request runs
      window.clearTimeout(timer);
      if (err?.kind === 'NotReady') { setWaiting(false); setError('NotReady'); return; } // D-990: Loading until done
      if (err?.kind === 'CentreNotFound' || err?.kind === 'CentreInTrash') {
        // A rename is followed, never shown as deleted (D-914, D-1039).
        if (err.kind === 'CentreNotFound' && objectId.current) {
          const moved = await ipc.indexPathById(objectId.current).catch(() => null);
          if (seq.current !== my) return;
          if (moved && moved.normalize('NFC') !== r.centre) { void askRef.current({ ...r, centre: moved.normalize('NFC') }, true); return; }
        }
        setWaiting(false);
        setError(null);
        setResult(null);
        shown.current = null;
        clearSelection();
        const title = err.kind === 'CentreInTrash' ? (err.title ?? err.name ?? lastTitle.current ?? stemOf(r.centre)) : (lastTitle.current ?? (p.centre.title || stemOf(r.centre)));
        setFailure({ kind: err.kind === 'CentreInTrash' ? 'trash' : 'gone', title });
        return;
      }
      setWaiting(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const askRef = useRef(ask);
  askRef.current = ask;

  // A running job (a rename, FR-GRP-01 AC-41) moves files and rewrites links in steps: a centre change or a live
  // re-ask while it runs waits for its end, so no half-renamed neighbourhood is drawn (at most JOB_WAIT).
  const jobs = useRef(new Set<number>());
  const deferred = useRef<null | { live: boolean; timer: number }>(null);
  const flushDeferred = () => {
    const d = deferred.current;
    if (!d) return;
    deferred.current = null;
    window.clearTimeout(d.timer);
    const r = reqRef.current;
    if (r) void askRef.current(r, d.live);
  };
  const deferIfJob = (live: boolean): boolean => {
    if (jobs.current.size === 0) return false;
    const d = deferred.current;
    if (d) { d.live = d.live && live; return true; }
    deferred.current = { live, timer: window.setTimeout(() => { jobs.current.clear(); flushDeferred(); }, JOB_WAIT) };
    return true;
  };
  useEffect(() => {
    const off = events.jobProgress((x) => {
      if (x.phase === 'done' || x.phase === 'cancelled' || x.phase === 'failed') {
        jobs.current.delete(x.jobId);
        if (jobs.current.size === 0) flushDeferred();
      } else jobs.current.add(x.jobId);
    });
    return () => { void off.then((f) => f()).catch(() => {}); if (deferred.current) window.clearTimeout(deferred.current.timer); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // One request per change (StrictMode's second run of the effect sends none, FR-GRP-01 AC-40).
  const asked = useRef<string | null>(null);
  useEffect(() => {
    if (!req) { asked.current = null; seq.current++; setWaiting(false); setError(null); setFailure(null); setResult(null); shown.current = null; return; }
    const key = JSON.stringify(req);
    if (asked.current === key) return;
    const prevCentre = asked.current ? (JSON.parse(asked.current) as GraphRequestDto).centre : null;
    asked.current = key;
    if (prevCentre !== null && prevCentre !== req.centre && deferIfJob(false)) return;
    void askRef.current(req, false);
  }, [req]);
  // A centre change (navigation): nothing selected (AC-30).
  useEffect(() => { clearSelection(); setFiltersOpen(false); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [centrePath]);
  useEffect(() => { if (p.centre.objectId) objectId.current = p.centre.objectId; }, [p.centre.objectId]);
  // D-980: every vault change re-asks (debounced); the shell's refresh tick (own saves) and D-990's `done` too.
  const again = useRef<() => void>(() => {});
  useEffect(() => {
    let timer = 0;
    again.current = () => { window.clearTimeout(timer); timer = window.setTimeout(() => { const r = reqRef.current; if (r && !deferIfJob(true)) void askRef.current(r, true); }, DEBOUNCE); };
    const offA = events.changed(() => again.current());
    const offB = events.progress((x) => { if (x.state === 'done') again.current(); });
    return () => { window.clearTimeout(timer); again.current = () => {}; void offA.then((f) => f()).catch(() => {}); void offB.then((f) => f()).catch(() => {}); };
  }, []);
  const lastRefresh = useRef(p.refresh);
  useEffect(() => { if (lastRefresh.current === p.refresh) return; lastRefresh.current = p.refresh; again.current(); }, [p.refresh]);

  // ------------------------------------------------------------------ state of the tab (R115, D-1048)
  const res = result && centrePath ? result.res : null;
  const state = panelState({ path: centrePath, error: failure ? (failure.kind === 'trash' ? 'CentreInTrash' : 'CentreNotFound') : error, waiting, result: res, cap: PANEL_CAP });
  const drawable = !!res && res.total <= PANEL_CAP;

  // ------------------------------------------------------------------ model, layout and the first-paint fit (D-1031)
  const model = useMemo(() => (res && drawable ? buildModel(res, { sizeByLinks, scale: 'panel' }) : null), [res, drawable, sizeByLinks]);
  const sizeReady = !!size;
  useEffect(() => {
    if (!result || !model || !size) return;
    const r = result.req;
    const json = JSON.stringify(result.res);
    const centreNode = result.res.nodes.find((n) => n.depth === 0);
    const prev = shown.current;
    const sameCentre = !!prev && (prev.centre === r.centre || (!!prev.objectId && prev.objectId === (centreNode?.objectId ?? null)));
    const sameDepth = sameCentre && prev!.depth === r.depth;
    const refit = !sameDepth || prev!.filters !== filterKey;
    const cx = size.width / 2, cy = size.height / 2;
    let keep: Map<NodeKey, Point> | undefined;
    if (sameDepth) {
      keep = new Map();
      for (const [k, v] of positions) keep.set(k, { x: v.x + cx, y: v.y + cy });
    }
    const boxes = new Map(model.nodes.map((n) => [n.key, nodeBox(n, 'panel')]));
    const abs = layout(model, size, keep, { ...PANEL_FORCES, bounds: { margin: 12, box: (k) => boxes.get(k) ?? { w: 0, top: 0, bottom: 0 }, squeeze: 0.08 } });
    const out = new Map<NodeKey, Point>();
    for (const [k, v] of abs) out.set(k, { x: v.x - cx, y: v.y - cy });
    const fresh = new Set<NodeKey>(sameDepth && !reduceMotion() ? [...out.keys()].filter((k) => !positions.has(k)) : []);
    shown.current = { centre: r.centre, objectId: centreNode?.objectId ?? null, depth: r.depth, filters: filterKey, json };
    setEntering(fresh);
    setPositions(out);
    if (refit) {
      setView({ zoom: panelFit(abs, boxes, size), panX: 0, panY: 0 });
    }
    if (!sameCentre) clearSelection();
    else if (selRef.current && !model.nodes.some((n) => n.key === selRef.current)) clearSelection(); // D-915
    requestAnimationFrame(() => requestAnimationFrame(() => { void ipc.perfMark('graph-ready').catch(() => {}); }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result, model, sizeReady]);
  // A result the panel doesn't draw (Too many) forgets the picture.
  useEffect(() => { if (res && !drawable) { shown.current = null; clearSelection(); } /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [res, drawable]);

  // ------------------------------------------------------------------ selection and the preview popover (§15.4)
  const lines = (n: GraphNodeDto, r: GraphResultDto): string[] => {
    const first = t('graph.preview.connections', { type: typeNameOf(n.typeKey), count: n.degree });
    const second = connectionPhrase(n, r, relationNames(types));
    return second ? [first, second] : [first];
  };
  const shownLines = useRef<string>('');
  const showPreview = (n: GraphNodeDto, el: Element, r: GraphResultDto) => {
    const l = lines(n, r);
    shownLines.current = JSON.stringify(l);
    preview.show(targetOf(n), { el: el as HTMLElement }, 'click', { placement: 'popover' }, l,
      { label: t('graph.panel.inFullGraph'), run: () => p.onOpenFull({ depth, select: n.id }) });
  };
  const select = (n: ModelNode, el: Element) => {
    if (!res) return;
    setSelected(n.key);
    setFiltersOpen(false);
    showPreview(n.node, el, res);
  };
  function clearSelection() {
    if (selRef.current === null) return;
    setSelected(null);
    setHovered(null); // the pointer still on the node highlights again only once it re-enters
    if (preview.current) preview.close('outside');
  }
  // Any close of the preview (Esc, its button, a click outside, a route or tab change) clears the selection (D-1041).
  const cur = preview.current;
  useEffect(() => {
    const k = selRef.current;
    if (!k) return;
    const n = model?.nodes.find((x) => x.key === k);
    if (!cur || !n || !sameTarget(cur.target, n.node)) { setSelected(null); setHovered(null); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cur]);
  // A live update: the previewed node's lines follow (D-982).
  useEffect(() => {
    const k = selRef.current;
    if (!k || !model || !res || !preview.current) return;
    const n = model.nodes.find((x) => x.key === k);
    const el = n && canvasBox.current?.querySelector(n.node.typeKey === 'tag'
      ? `[data-graph-node][data-tag-key="${CSS.escape(n.node.tagKey ?? '')}"]`
      : `[data-graph-node][data-path="${CSS.escape(n.node.path ?? '')}"]`);
    if (n && el && JSON.stringify(lines(n.node, res)) !== shownLines.current) showPreview(n.node, el, res);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [res]);
  // Closing the panel (⌘\, a tab change, the window too narrow) closes the preview it opened (D-1041).
  useEffect(() => () => { if (selRef.current) preview.close('outside'); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  // ------------------------------------------------------------------ view state (§15.3)
  const write = (patch: Partial<GraphViewStateDto>) => p.onState({ ...(p.state ?? {}), ...patch });
  const setDepth = (d: 1 | 2 | 3) => { if (d !== depth) write({ depth: d }); };
  const known = (res?.typeCounts ?? lastCounts).map(([k]) => k);
  const unknownHidden = hiddenTypes.filter((k) => !known.includes(k));
  const setType = (key: string, visible: boolean) => write({ hiddenTypes: visible ? hiddenTypes.filter((k) => k !== key) : [...hiddenTypes, key] });
  const setAll = (visible: boolean) => write({ hiddenTypes: visible ? unknownHidden : [...unknownHidden, ...known.filter((k) => !unknownHidden.includes(k))] });
  const setKind = (kind: EdgeKindDto, visible: boolean) => write({ hiddenKinds: visible ? hiddenKinds.filter((k) => k !== kind) : [...hiddenKinds, kind] });

  // ------------------------------------------------------------------ to the full view (§15.5)
  const canOpenFull = state !== 'noFile' && state !== 'deleted' && !!centrePath;
  const selectedId = (): NodeIdDto | null => model?.nodes.find((n) => n.key === selRef.current)?.node.id ?? null;
  // The node selected when the button's pointerdown arrived: read before the preview's outside-click close (§15.5).
  const pressed = useRef<NodeIdDto | null | undefined>(undefined);
  const fullBtn = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const onDown = (e: PointerEvent) => { if (fullBtn.current?.contains(e.target as Node)) pressed.current = selectedId(); };
    window.addEventListener('pointerdown', onDown, true);
    return () => window.removeEventListener('pointerdown', onDown, true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model]);
  const openFull = (select: NodeIdDto | null) => { if (canOpenFull) p.onOpenFull({ depth, select }); };
  if (p.commandRef) p.commandRef.current = { depth: (d) => setDepth(d), openFull: () => openFull(selectedId()) };
  useEffect(() => () => { if (p.commandRef) p.commandRef.current = null; /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  // ------------------------------------------------------------------ zoom and pan (D-985, D-1031)
  useEffect(() => {
    const onWheel = (e: WheelEvent) => {
      if (!(e.metaKey || e.ctrlKey) || !canvasBox.current?.contains(e.target as Node)) return;
      e.preventDefault();
      const f = e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
      setView((v) => ({ ...v, zoom: Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(v.zoom * f * 10000) / 10000)) }));
    };
    window.addEventListener('wheel', onWheel, { passive: false });
    return () => window.removeEventListener('wheel', onWheel);
  }, []);

  // ------------------------------------------------------------------ the `Depth and filters` popover (R114)
  const triggerOff = state === 'noLinks' || state === 'noFile' || state === 'deleted' || !!p.pending;
  const placePopover = useCallback(() => {
    const tr = triggerRef.current, pop = popover.current;
    const panel = tr?.closest('.context-panel');
    if (!tr || !panel) return;
    const pr = panel.getBoundingClientRect(), tb = tr.getBoundingClientRect();
    const h = pop?.offsetHeight ?? 0;
    const left = Math.max(GAP, pr.left - GAP - POPOVER_W);
    const top = Math.max(GAP, Math.min(tb.top, window.innerHeight - GAP - h));
    setPopPos((o) => (o && o.left === left && o.top === top ? o : { left, top }));
  }, []);
  useLayoutEffect(() => { if (filtersOpen) placePopover(); });
  useEffect(() => {
    if (!filtersOpen) return;
    requestAnimationFrame(() => radioRef.current?.focus({ preventScroll: true }));
    const onDown = (e: PointerEvent) => {
      if (popover.current?.contains(e.target as Node) || triggerRef.current?.contains(e.target as Node)) return;
      setFiltersOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      e.preventDefault();
      e.stopPropagation();
      setFiltersOpen(false);
      triggerRef.current?.focus();
    };
    const onResize = () => placePopover();
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', onResize);
    return () => { window.removeEventListener('pointerdown', onDown, true); window.removeEventListener('keydown', onKey, true); window.removeEventListener('resize', onResize); };
  }, [filtersOpen, placePopover]);
  useEffect(() => { if (triggerOff) setFiltersOpen(false); }, [triggerOff]);
  useEffect(() => {
    if (!p.focusTrigger || p.focusTrigger <= focusSeen) return;
    const tick = p.focusTrigger;
    const id = setTimeout(() => { focusSeen = tick; triggerRef.current?.focus(); }, 0);
    return () => clearTimeout(id);
  }, [p.focusTrigger]);

  // ------------------------------------------------------------------ what to show
  const centreNode = res?.nodes.find((n) => n.depth === 0) ?? null;
  const title = centreNode ? displayTitle(centreNode) : (p.centre.title || (centrePath ? stemOf(centrePath) : ''));
  const hidden = res && (state === 'graph' || state === 'allHidden' || state === 'tooMany') ? res.hidden : 0;
  const tText = triggerText(depth, hidden);
  const keys = SHORTCUTS.find((s) => s.command === 'graph.open')?.keys ?? '';
  const needsObject = canOpenFull ? undefined : t('cmd.needsObject');
  const canvasName = state === 'noLinks' ? t('graph.noLinks.canvas', { title }) : t('graph.canvas', { title, count: depth });
  const showCanvas = (state === 'graph' || state === 'noLinks' || state === 'allHidden') && !!model && !!size;
  const offer = state === 'tooMany' && res ? lowerDepthOffer(res.depthTotals ?? [], depth, PANEL_CAP) : null;
  const filterProps = {
    typeCounts: res?.typeCounts ?? lastCounts, hiddenTypes, hiddenKinds, sizeByLinks, disabled: false,
    onType: setType, onAll: setAll, onKind: setKind, onSize: (on: boolean) => write({ sizeByLinks: on }),
  };

  return (
    <div role="tabpanel" aria-label={t('tab.graph')} className="panel-body graph-panel">
      <div className="graph-panel-toolbar">
        <button type="button" ref={triggerRef} className="graph-panel-trigger" aria-label={t('graph.panel.filters')} aria-haspopup="dialog"
          aria-expanded={filtersOpen} aria-description={tText} aria-disabled={triggerOff ? 'true' : undefined}
          onClick={() => { if (!triggerOff) setFiltersOpen((o) => !o); }}>
          {tText}
        </button>
        <span className="graph-panel-spacer" />
        <button type="button" ref={fullBtn} className="graph-panel-full" data-command="graph.open" aria-disabled={canOpenFull ? undefined : 'true'} aria-description={needsObject}
          onClick={() => { const s = pressed.current !== undefined ? pressed.current : selectedId(); pressed.current = undefined; openFull(s); }}>
          {t('graph.panel.openFullShortcut', { shortcut: keys })}
        </button>
      </div>
      {filtersOpen && (
        <div ref={popover} role="dialog" aria-modal="false" aria-label={t('graph.panel.filters')} className="graph-filters graph-panel-popover"
          style={{ left: popPos?.left ?? -9999, top: popPos?.top ?? 0, width: POPOVER_W }}>
          <GraphFilters {...filterProps} variant="popover" depth={depth} onDepth={setDepth} radioRef={radioRef} />
        </div>
      )}
      <div ref={canvasBox} className="graph-panel-canvas">
        {showCanvas && (
          <GraphCanvas model={model!} positions={positions} size={size!} view={view} onView={setView} scale="panel"
            selected={selected} hovered={hovered} onHover={setHovered} entering={entering} contentRef={content} name={canvasName}
            onSelect={(n, el) => select(n, el)}
            onOpen={(n) => { if (!n.centre) p.onOpen(n.node); }}
            onEmpty={() => { setFiltersOpen(false); clearSelection(); }} />
        )}
        {state === 'noLinks' && <p className="graph-state">{t('graph.noLinks')}</p>}
        {state === 'allHidden' && res && (
          <div className="graph-state">
            <p>{t(hiddenKinds.length ? 'graph.allHidden.filters' : 'graph.allHidden.types', { count: res.hidden })}</p>
            <button type="button" data-command="graph.showAllTypes" className="button" onClick={() => (hiddenKinds.length ? write({ hiddenTypes: unknownHidden, hiddenKinds: [] }) : write({ hiddenTypes: unknownHidden }))}>
              {t(hiddenKinds.length ? 'graph.showEverything' : 'graph.showAllTypes')}
            </button>
          </div>
        )}
        {state === 'loading' && (
          <div className="graph-loading graph-panel-loading">
            <div className="graph-skeleton" data-graph-skeleton="" aria-hidden="true"><span /><span /><span /><span /></div>
            <div role="status">{t('graph.panel.loading')}</div>
          </div>
        )}
        {state === 'tooMany' && res && (
          <div className="graph-panel-message">
            <p className="graph-panel-title">{t('graph.panel.tooMany')}</p>
            <p>{t('graph.panel.tooManyCount', { count: fmt(res.total), depth })}</p>
            <div className="graph-panel-actions">
              {offer !== null && (
                <button type="button" data-command="graph.lowerDepth" className="button" onClick={() => setDepth(offer as 1 | 2)}>
                  {t('graph.lowerDepth', { depth: offer, count: fmt(res.depthTotals![offer - 1]) })}
                </button>
              )}
              <button type="button" className="button" onClick={() => openFull(null)}>{t('graph.panel.openFull')}</button>
            </div>
          </div>
        )}
        {state === 'noFile' && <div className="graph-panel-message"><p>{t('graph.panel.noFile')}</p></div>}
        {state === 'deleted' && failure && (
          <div role="status" className="graph-panel-message">
            <p className="graph-panel-title">{t('graph.deleted')}</p>
            <p>{t(failure.kind === 'trash' ? 'graph.deleted.trash' : 'graph.deleted.gone', { title: failure.title })}</p>
          </div>
        )}
      </div>
      {state === 'graph' && model && <p className="graph-panel-footer">{footerText(model.nodes.length)}</p>}
    </div>
  );
}
