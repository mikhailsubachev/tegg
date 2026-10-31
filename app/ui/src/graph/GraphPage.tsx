// Slice G1 (docs/contracts/v1-graph.md §3, §4, §6; graph.md R109…R113): the `graph/<path>` route: the request
// lifecycle (a newer request wins, a late answer is dropped), the full view's state (D-993), the 300 ms loading rule
// (D-912), the R110 states, the cap's banner, live updates (D-980), the preview column (D-982) and the narrow layout
// (D-988). Its state goes to `ui-state.json` through `onView`. G3 (v1-graph §16): the preset control and the presets
// file as read (the page's only vault writes, through `PresetControl`), the `Graph` / `List` switch, the keyboard
// (R120), the hover controller and the hint and empty column per Object preview setting (FR-LNK-12, replacing D-983).
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { t } from '../i18n/catalog';
import { events, ipc } from '../ipc/client';
import { chipIcon, chipTypes, typeNameOf } from '../links/icons';
import { usePreview } from '../preview/PreviewProvider';
import { getCurrent } from '../preview/store';
import type { GraphCommandId, GraphStatus } from '../shell/commands';
import { Icon } from '../shell/Icon';
import { GraphCanvas, nodeBox, shapeHalf, type View } from './GraphCanvas';
import { GraphFilters } from './GraphFilters';
import { GraphList } from './GraphList';
import { buildModel, connectionPhrase, displayTitle, headingCount, hiddenText, nodeDescription, positionOrder, sortKey, type ModelNode, type NodeKey } from './graphModel';
import { graphHover } from './hover';
import { ARROWS, graphKeyAction, nearestInDirection } from './keyboard';
import { layout, type Point } from './layout';
import { currentPreset, isModified, nameKey } from './presets';
import { PresetControl, type PresetActions } from './PresetControl';
import { DEBOUNCE, LOADING_AFTER, ZOOM_MAX, ZOOM_MIN, ZOOM_STEP, fmt, kindsOf, reduceMotion, relationNames, stemOf, strings, targetOf, typesAfterAll, unknownHidden, validDepth } from './viewState';
import type { EdgeKindDto, GraphPresetsDto, GraphRequestDto, GraphResultDto, GraphViewStateDto, NodeIdDto } from './types';

const CAP = 150;
const MAX_DRAWN = 1000;
const NARROW = 960;
const GRAPH_YML = '.tegg/graph.yml';
/** R120: the margin a focused node keeps from the canvas's edges after an arrow. */
const PAN_MARGIN = 24;

/** Positions per centre and depth for this session (never stored, D-913): Back shows the picture it left. */
const placed = new Map<string, Map<NodeKey, Point>>();
/** `C` (R120): the next graph page focuses its centre once drawn. */
let focusCentreNext = false;

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
  commandRef: React.RefObject<((id: GraphCommandId) => void) | null>;
  /** G3 (§16.4): a change to every view of this vault in one `ui_state_set` (a Tegg rename or delete of a preset). */
  onViews: (f: (g: { full?: GraphViewStateDto; panel?: GraphViewStateDto }) => { full?: GraphViewStateDto; panel?: GraphViewStateDto }) => void;
  /** G3 (R123): what the palette's preset and view commands read. */
  statusRef: React.RefObject<(() => GraphStatus) | null>;
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
  // G3: the presets file as read (§16.2), the node with the tab stop (AP-935) and the hover ring (AP-942).
  const [presets, setPresets] = useState<GraphPresetsDto | null>(null);
  const [focusKey, setFocusKey] = useState<NodeKey | null>(null);
  const [ring, setRing] = useState<{ key: NodeKey; ms: number; seq: number } | null>(null);
  const viewMode: 'graph' | 'list' = p.view?.view === 'list' ? 'list' : 'graph';
  const hadFocus = useRef(false);
  // Read once, on the first render of this page (an older page re-rendering must not take it).
  const focusCentre = useRef<boolean | null>(null);
  if (focusCentre.current === null) { focusCentre.current = focusCentreNext; focusCentreNext = false; }
  const sideActions = useRef<PresetActions | null>(null);
  const popActions = useRef<PresetActions | null>(null);
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
  const mode = preview.mode;
  const previewRef = useRef(preview);
  previewRef.current = preview;
  // v1-graph §3: `route-ready:graph/<path>` once the first graph or state has painted.
  const routeMarked = useRef(false);
  const markRoute = () => {
    if (routeMarked.current) return;
    routeMarked.current = true;
    void ipc.perfMark(`route-ready:graph/${centrePath}`).catch(() => {});
  };
  useEffect(() => { if (failure) requestAnimationFrame(() => markRoute()); });
  // G3 build note: the mark goes with the commit that first shows the result's heading count, so a test that saw the
  // heading has seen the mark too (the graph itself is drawn by the next commit; `graph-ready` keeps its frame wait).
  useLayoutEffect(() => { if (result || failure) markRoute(); }, [result, failure]);
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
    const offA = events.changed((c) => {
      const paths = (c?.paths ?? []).map((x) => x.normalize('NFC'));
      if (paths.includes(GRAPH_YML)) loadPresets();
      // A change to `.tegg/graph.yml` alone reloads the list, never the graph (FR-GRP-02 AC-23).
      if (paths.length && paths.every((x) => x === GRAPH_YML)) return;
      again();
    });
    const offB = events.progress((x) => { if (x.state === 'done') again(); });
    return () => { window.clearTimeout(timer); void offA.then((f) => f()).catch(() => {}); void offB.then((f) => f()).catch(() => {}); };
  }, []);

  // ------------------------------------------------------------------ presets (§16.2): read on open and on a change of the file
  const presetSeq = useRef(0);
  const loadPresets = () => {
    const my = ++presetSeq.current;
    ipc.graphPresetsGet().then((s) => { if (presetSeq.current === my) setPresets(s); }, () => {});
  };
  useEffect(() => { loadPresets(); }, []);
  const presetState = (s: GraphPresetsDto) => { presetSeq.current++; setPresets(s); };

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
  const showPreview = (n: ModelNode, el: Element, origin: 'click' | 'hover' | 'key' = 'click') => {
    const container = column.current;
    if (!container) return;
    preview.show(targetOf(n.node), { el: el as HTMLElement }, origin, { placement: 'column', container }, lines(n),
      { label: t('graph.centerHere'), disabled: !centreable(n), run: () => { if (centreable(n)) p.nav.centre(n.node.path!); } });
  };
  const pendingShow = useRef<{ n: ModelNode; el: Element; origin: 'click' | 'key' } | null>(null);
  const select = (n: ModelNode, el: Element, origin: 'click' | 'key' = 'click') => {
    setSelected(n.key);
    setFiltersOpen(false);
    pendingShow.current = { n, el, origin };
    if (column.current) { showPreview(n, el, origin); pendingShow.current = null; }
  };
  // In the narrow layout the column mounts with the selection; show the preview once it is there.
  useEffect(() => {
    const s = pendingShow.current;
    if (s && column.current) { pendingShow.current = null; showPreview(s.n, s.el, s.origin); }
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
    // In List (graph.full.view "list") the node's row is selected and previews (graph-panel-g3.md FR-GRP-01 AC-45).
    const el = elementOf(n.key);
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
    const el = n && elementOf(n.key);
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

  // ------------------------------------------------------------------ hover (R120, AP-941, AP-942)
  const modelRef = useRef(model);
  modelRef.current = model;
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  /** The element of a node in the shown view: its `<g>` on the canvas, its row in the List. */
  function elementOf(k: NodeKey): HTMLElement | null {
    return root.current?.querySelector<HTMLElement>(`[data-node-key="${CSS.escape(k)}"], [data-graph-row="${CSS.escape(k)}"]`) ?? null;
  }
  const hover = useMemo(() => graphHover({
    delay: () => previewRef.current.hoverDelay,
    show: (k) => {
      const n = modelRef.current?.nodes.find((x) => x.key === k);
      const el = elementOf(k);
      if (n && el) showPreview(n, el, 'hover');
    },
    hide: () => {
      const c = getCurrent();
      if (!c || c.origin !== 'hover') return;
      // The column then shows the selected node's preview, if one is selected, else its empty state.
      const sel = modelRef.current?.nodes.find((x) => x.key === selectedRef.current);
      const el = sel && elementOf(sel.key);
      if (sel && el) showPreview(sel, el); else previewRef.current.close('outside');
    },
    showing: (k) => {
      const c = getCurrent();
      const n = modelRef.current?.nodes.find((x) => x.key === k);
      return !!c && !!n && c.origin === 'hover' && 'el' in c.anchor && c.anchor.el === elementOf(k);
    },
    ring: (k) => {
      if (k === null) { setRing(null); return; }
      setRing((r) => {
        if (r && r.key === k) {
          // The same node: restart its fill from the last movement.
          for (const a of document.querySelector('[data-hover-ring]')?.getAnimations() ?? []) a.currentTime = 0;
          return r;
        }
        return { key: k, ms: previewRef.current.hoverDelay, seq: (r?.seq ?? 0) + 1 };
      });
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), []);
  useEffect(() => () => hover.dispose(), [hover]);
  // Native listeners: the preview in the column is a portal of the preview provider, so React's enter and leave
  // would not see the pointer reach it (AP-941).
  const canvasWrap = useRef<HTMLDivElement>(null);
  const columnBox = useRef<HTMLElement>(null);
  useEffect(() => {
    const pairs: [HTMLElement | null, 'canvas' | 'column'][] = [[canvasWrap.current, 'canvas'], [columnBox.current, 'column']];
    const offs = pairs.map(([el, part]) => {
      if (!el) return () => {};
      const on = () => hover.area(part, true), off = () => hover.area(part, false);
      el.addEventListener('pointerenter', on);
      el.addEventListener('pointerleave', off);
      return () => { el.removeEventListener('pointerenter', on); el.removeEventListener('pointerleave', off); };
    });
    return () => { for (const f of offs) f(); };
  });
  // A mode change applies to the next pointer input (FR-LNK-12 AC-13).
  useEffect(() => { hover.cancel(); setRing(null); }, [mode, hover]);
  const onNodePointer = (n: ModelNode, over: boolean, ringToo: boolean) => {
    if (previewRef.current.mode !== 'hover') return;
    if (over) hover.move(n.key, ringToo); else hover.leave(n.key);
  };
  // R120: a click previews in click mode; in hover and Off, and with ⌘ in every mode, it opens.
  const onNodeClick = (n: ModelNode, el: Element, e: React.MouseEvent) => {
    hover.cancel();
    if (mode === 'click' && !e.metaKey) select(n, el);
    else p.nav.open(n);
  };

  // ------------------------------------------------------------------ keyboard (R120; §16.5)
  const focusNode = (k: NodeKey | null) => {
    if (!k) return;
    elementOf(k)?.focus({ preventScroll: true });
  };
  /** Pans the node into view with a 24 px margin, zoom unchanged (instant: within D-913's 150 ms, and so under
   *  Reduce motion too). */
  const panInto = (k: NodeKey) => {
    const n = model?.nodes.find((x) => x.key === k);
    const pos = positions.get(k);
    if (!n || !pos || !size) return;
    const half = shapeHalf(n);
    setView((v) => {
      const sx = size.width / 2 + v.panX + pos.x * v.zoom, sy = size.height / 2 + v.panY + pos.y * v.zoom;
      const hw = half.w * v.zoom, hh = half.h * v.zoom;
      const shift = (c: number, h: number, len: number) => (c - h < PAN_MARGIN ? PAN_MARGIN - (c - h) : c + h > len - PAN_MARGIN ? len - PAN_MARGIN - (c + h) : 0);
      const dx = shift(sx, hw, size.width), dy = shift(sy, hh, size.height);
      return dx || dy ? { ...v, panX: v.panX + dx, panY: v.panY + dy } : v;
    });
  };
  const onKey = (e: React.KeyboardEvent, n: ModelNode, el: Element, target: 'node' | 'row') => {
    // Any key with the focus in the graph hides a hover preview; Esc does only that (D-942, FR-UX-03 AC-26).
    const hoverShown = getCurrent()?.origin === 'hover';
    hover.cancel();
    if (hoverShown && e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); return; }
    const action = graphKeyAction(e, mode, target);
    if (!action) return;
    e.preventDefault();
    e.stopPropagation();
    switch (action) {
      case 'focusDir': {
        if (target !== 'node' || !model) return;
        const sortKeys = new Map(model.nodes.map((x) => [x.key, x.sortKey]));
        const next = nearestInDirection(positions, n.key, ARROWS[e.key], sortKeys);
        if (next) { focusNode(next); panInto(next); }
        return;
      }
      case 'preview': select(n, el, 'key'); return;
      case 'open': p.nav.open(n); return;
      case 'centre':
        if (centreable(n)) { focusCentreNext = true; p.nav.centre(n.node.path!); }
        return;
      case 'zoomIn': zoomBy(ZOOM_STEP); return;
      case 'zoomOut': zoomBy(1 / ZOOM_STEP); return;
      case 'fit': fit(); return;
      case 'escape':
        if (selected || getCurrent()) clearSelection();
        else p.heading.current?.focus();
        return;
    }
  };
  const onFocusKey = (k: NodeKey | null) => { hadFocus.current = k !== null; setFocusKey(k); };
  // The focused node disappeared in a redraw: the tab stop, and the focus if it had it, go to the centre (AC-22).
  useEffect(() => {
    if (!model || !focusKey || model.nodes.some((n) => n.key === focusKey)) return;
    setFocusKey(null);
    const lost = !document.activeElement || document.activeElement === document.body;
    if (hadFocus.current && lost) setTimeout(() => focusNode(model.centre), 0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model]);
  // After `C` the focus lands on the new centre (R120).
  useEffect(() => {
    if (!focusCentre.current || !model?.centre || !positions.size) return;
    const el = elementOf(model.centre);
    if (!el) return;
    focusCentre.current = false;
    el.focus({ preventScroll: true });
  });
  const positionIndex = useMemo(() => new Map((result ? positionOrder(result) : []).map((k, i) => [k, i + 1])), [result]);
  const types = useMemo(() => relationNames(chipTypes()), [result]);
  const describe = (n: ModelNode) => (result ? nodeDescription(n.node, result, types, positionIndex.get(n.key) ?? null) : '');

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
  const setViewMode = (v: 'graph' | 'list') => { if (v !== viewMode) write({ view: v }); };
  // G3 (§16.4): a Tegg rename or delete changes `preset` in every view of the vault that named it, in one write.
  const onRenamed = (from: string, to: string | null) => {
    const key = nameKey(from); // D-1123: one rule (White_Space trim, not U+FEFF; NFC; lower case) everywhere
    const fix = (v: GraphViewStateDto | undefined): GraphViewStateDto | undefined => {
      if (!v || typeof v.preset !== 'string' || nameKey(v.preset) !== key) return v;
      const { preset: _old, ...rest } = v;
      void _old;
      return to === null ? rest : { ...rest, preset: to };
    };
    p.onViews((g) => ({ ...g, ...(g.full ? { full: fix(g.full) } : {}), ...(g.panel ? { panel: fix(g.panel) } : {}) }));
  };
  const listed = presets?.state === 'unreadable' ? [] : presets?.presets ?? [];
  const current = currentPreset(p.view ?? {}, listed);
  p.statusRef.current = () => ({
    view: viewMode, stored: !!current, modified: isModified(p.view ?? {}, current), file: presets?.state ?? 'missing',
  });
  const presetActions = () => (narrow ? popActions.current : sideActions.current);
  p.commandRef.current = (id) => {
    if (id === 'recenter') recenter();
    else if (id === 'view.list') setViewMode('list');
    else if (id === 'view.graph') setViewMode('graph');
    else if (id.startsWith('preset.')) {
      // After the palette gave the focus back (D-139); in a narrow window the `Filters` popover opens first.
      const runIt = () => {
        const a = presetActions();
        if (!a) return;
        if (id === 'preset.apply') a.openMenu(document.activeElement as HTMLElement | null);
        else if (id === 'preset.save') a.save();
        else if (id === 'preset.update') a.update();
        else if (id === 'preset.revert') a.revert();
        else if (id === 'preset.rename') a.rename();
        else if (id === 'preset.delete') a.remove();
      };
      if (narrow && !filtersOpen) { setFiltersOpen(true); setTimeout(runIt, 50); } else setTimeout(runIt, 0);
    } else setDepth(Number(id.slice(5)) as 1 | 2 | 3);
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
      if (!canvasBox.current?.contains(e.target as Node)) return;
      hover.cancel(); // a wheel hides a hover preview (AP-941)
      if (!e.metaKey) return;
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
      // The preset control's layers close one at a time first (FR-GRP-02 AC-24); the graph handles its own Esc.
      if (document.querySelector('[data-preset-layer]')) return;
      if ((e.target as Element | null)?.closest?.('svg[role="group"], [role="tree"]')) return;
      // Esc hides a hover preview wherever the focus is (AP-941).
      if (getCurrent()?.origin === 'hover') { e.preventDefault(); hover.cancel(); return; }
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
      if ((e.target as Element | null)?.closest?.('[data-preset-layer]')) return;
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
  const presetControl = (actionsRef: React.MutableRefObject<PresetActions | null>) => (
    <PresetControl view="full" state={presets} onState={presetState} graph={p.view ?? {}} onApply={p.onView} onRenamed={onRenamed} actionsRef={actionsRef} />
  );
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

  const filtersAside = <aside className="graph-filters side" aria-label={t('graph.filters')}><GraphFilters {...filterProps} preset={presetControl(sideActions)} /></aside>;
  // The side column (hidden below 960 px by CSS) and, in the narrow layout, the overlay; the active one hosts the preview.
  const columnEl = (overlay: boolean) => (
    <aside ref={overlay === narrow ? columnBox : undefined} className={`graph-preview-column${overlay ? ' graph-overlay' : ' side'}`} aria-label={t('graph.preview.label')}>
      <div ref={overlay === narrow ? column : undefined} className="graph-preview-host" />
      {!selNode && !preview.current && (
        <div className="graph-preview-empty">
          <p>{t(mode === 'hover' ? 'graph.preview.emptyHover' : mode === 'off' ? 'graph.preview.emptyOff' : 'graph.preview.empty')}</p>
          <p className="muted">{t(mode === 'hover' ? 'graph.preview.emptyHoverNote' : mode === 'off' ? 'graph.preview.emptyOffNote' : 'graph.preview.emptyNote')}</p>
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
        <div role="group" aria-label={t('graph.view')} className="graph-depth graph-view-switch">
          {(['graph', 'list'] as const).map((v) => (
            <button key={v} type="button" data-command={`graph.view.${v}`} aria-pressed={viewMode === v}
              onClick={(e) => { e.currentTarget.focus(); setViewMode(v); }}>{t(`graph.view.${v}`)}</button>
          ))}
        </div>
        {result && !deleted && hiddenText(result) && <span role="status" className="graph-hidden">{hiddenText(result)}</span>}
        <button type="button" data-command="graph.recenter" className="button" aria-disabled={!selNode || selNode.centre || !selNode.node.path ? 'true' : undefined} onClick={recenter}>{t('graph.recenter')}</button>
        {/* D-988: shown below 960 px by a container query, so the switch follows the width at once. */}
        <button type="button" ref={filtersBtn} data-command="graph.filters" className="button graph-filters-btn" aria-haspopup="dialog" aria-expanded={filtersOpen} onClick={() => setFiltersOpen((o) => !o)}>{t('graph.filtersButton')}</button>
      </div>
      {banner}
      <div className="graph-body">
        {/* In List the tree comes before the filter column in the tab order (Tab from the switch reaches it, FR-UX-03
            AC-30); CSS `order` keeps the column on the left. */}
        {viewMode === 'graph' && filtersAside}
        {filtersOpen && <div ref={popover} role="dialog" aria-label={t('graph.filters')} className="graph-filters popover"><GraphFilters {...filterProps} allRef={allPopRef} preset={presetControl(popActions)} /></div>}
        <div ref={canvasWrap} className="graph-canvas-wrap">
          <div ref={canvasBox} className={`graph-canvas${viewMode === 'list' ? ' list' : ''}`}>
            {viewMode === 'graph' && size && (
              <GraphCanvas model={deleted || !model ? { centre: null, nodes: [], edges: [] } : model} positions={positions} size={size} view={view} onView={setView}
                selected={selected} hovered={hovered} onHover={setHovered} entering={entering} contentRef={content} name={canvasName} help={t('graph.canvas.help')}
                describe={describe} focusKey={focusKey} onFocusKey={onFocusKey} ring={mode === 'hover' ? ring : null}
                onKey={(e, n, el) => onKey(e, n, el, 'node')} onNodePointer={(n, over) => onNodePointer(n, over, true)} onPan={() => hover.cancel()}
                onNodeClick={onNodeClick} onOpen={(n) => { hover.cancel(); p.nav.open(n); }} onEmpty={() => { setFiltersOpen(false); hover.cancel(); clearSelection(); }} />
            )}
            {viewMode === 'list' && result && model && !deleted && (
              <GraphList result={result} model={model} types={types} selected={selected} focusKey={focusKey} onFocusKey={onFocusKey}
                onClick={(n, el, e) => onNodeClick(n, el, e)} onDoubleClick={(n) => { hover.cancel(); p.nav.open(n); }}
                onKey={(e, n, el) => onKey(e, n, el, 'row')} onPointer={(n, over) => onNodePointer(n, over, false)} onMove={() => hover.cancel()} />
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
            {viewMode === 'graph' && <p className="graph-hint">{t(mode === 'hover' ? 'graph.hint.hover' : mode === 'off' ? 'graph.hint.off' : 'graph.hint.click')}</p>}
            {viewMode === 'graph' && <div className="graph-zoom">
              <button type="button" className="icon-button" data-command="graph.zoomIn" aria-label={t('graph.zoomIn')} aria-disabled={deleted ? 'true' : undefined} onClick={() => { if (!deleted) zoomBy(ZOOM_STEP); }}><Icon name="plus" size={14} /></button>
              <button type="button" className="icon-button" data-command="graph.zoomOut" aria-label={t('graph.zoomOut')} aria-disabled={deleted ? 'true' : undefined} onClick={() => { if (!deleted) zoomBy(1 / ZOOM_STEP); }}><Icon name="minus" size={14} /></button>
              <button type="button" className="icon-button" data-command="graph.fit" aria-label={t('graph.fit')} aria-disabled={deleted ? 'true' : undefined} onClick={() => { if (!deleted) fit(); }}><Icon name="focus" size={14} /></button>
            </div>}
            {narrow && selNode && columnEl(true)}
          </div>
        </div>
        {viewMode === 'list' && filtersAside}
        {columnEl(false)}
      </div>
    </div>
  );
}
