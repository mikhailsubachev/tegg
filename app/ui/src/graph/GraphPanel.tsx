// Slice G2 (docs/contracts/v1-graph.md §15; graph-panel.md R114…R117): the right panel's `tabpanel` `Graph` — request
// lifecycle (300 ms loading, latest request wins, debounced live re-query; §6, §15.7), the R115 states, the selection
// and its preview popover beside the panel (§15.4, D-1041), the `Depth and filters` popover (R114) and the way to the
// full view (§15.5). It reuses G1's canvas, filters, model and layout with their panel variants. Its state goes to
// `ui-state.json` (`graph.panel`) through `onState`. Slice "G3 in the panel" (§17; graph-panel-g3.md R125…R128): G3's
// preset control in the popover (the panel's only vault writes, `.tegg/graph.yml`, through `PresetControl`), the
// `Graph` / `List` switch, the keyboard map (R126), the hover controller with the popover grace, the descriptions (R121),
// the footer per Object preview setting and R123's commands on the panel (R127).
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { t } from '../i18n/catalog';
import { events, ipc } from '../ipc/client';
import type { TypeDefDto } from '../ipc/types';
import { typeNameOf } from '../links/icons';
import { usePreview } from '../preview/PreviewProvider';
import { close as closePreview, getCurrent as currentPreview } from '../preview/store';
import type { PreviewTarget } from '../preview/types';
import type { GraphCommandId, GraphStatus } from '../shell/commands';
import { Icon } from '../shell/Icon';
import { SHORTCUTS } from '../shell/registry';
import { GraphCanvas, nodeBox, shapeHalf, type View } from './GraphCanvas';
import { GraphFilters } from './GraphFilters';
import { GraphList } from './GraphList';
import { buildModel, connectionPhrase, displayTitle, nodeDescription, positionOrder, type ModelNode, type NodeKey } from './graphModel';
import { graphHover } from './hover';
import { ARROWS, graphKeyAction, nearestInDirection } from './keyboard';
import { layout, type Point } from './layout';
import { PANEL_CAP, footerText, lowerDepthOffer, panelFit, panelState, triggerText, type PanelState } from './panelModel';
import { currentPreset, isModified, nameKey } from './presets';
import { PresetControl, type PresetActions } from './PresetControl';
import type { EdgeKindDto, GraphNodeDto, GraphPresetsDto, GraphRequestDto, GraphResultDto, GraphViewStateDto, NodeIdDto } from './types';
import { DEBOUNCE, LOADING_AFTER, ZOOM_MAX, ZOOM_MIN, ZOOM_STEP, fmt, kindsOf, reduceMotion, relationNames, stemOf, strings, targetOf, typesAfterAll, unknownHidden, validDepth } from './viewState';

/** §15.5: what the panel hands to the full view, on the new history entry. */
export type GraphHandover = { depth: 1 | 2 | 3; select: NodeIdDto | null };

/** What the shell asks of a shown panel graph: `Graph: Depth n` (D-1035), ⌘⇧G / `Open graph` (R116 rule 3) and R123's
 *  preset and view commands (R127, §17.1). */
export type GraphPanelCommands = {
  depth: (d: 1 | 2 | 3) => void;
  openFull: () => void;
  command: (id: GraphCommandId) => void;
  /** `{ view, stored, modified, file }` of `graph.panel` and the panel's presets as read. */
  status: () => GraphStatus;
  /** The R115 state shown (AP-972 = D-1142); null before any answer or while a day is pending. */
  state: () => PanelState | null;
};

export type GraphPanelProps = {
  /** The page's object; null path = no file (new/<type>, a virtual day) → R115 No file. */
  centre: { path: string | null; title: string; objectId: string | null };
  vaultPath: string;
  state: GraphViewStateDto;
  onState(next: GraphViewStateDto): void;
  /** Opens a node's object in the centre pane; `byKey` (⌘⏎, ⏎ in hover and Off): the focus goes to its heading. */
  onOpen(node: GraphNodeDto, o?: { byKey?: boolean }): void;
  onOpenFull(handover: GraphHandover): void;
  refresh: number;
  width: number;
  types: TypeDefDto[];
  /** The day's file isn't known yet: nothing is drawn and nothing is asked. */
  pending?: boolean;
  /** `Show local graph` (FR-NAV-05 AC-2): each change puts the focus on `Depth and filters`. */
  focusTrigger?: number;
  /** The page's own saves (the watcher doesn't report them): subscribe, get the unsubscribe (§15.7). */
  onOwnSave?: (f: () => void) => () => void;
  /** Set while mounted: the shell's commands for the shown panel graph. */
  commandRef?: React.MutableRefObject<GraphPanelCommands | null>;
  /** G3 in the panel (§17.1, §16.4): a change to every view of this vault in one `ui_state_set` (a Tegg rename or
   *  delete of a preset). */
  onViews(f: (g: { full?: GraphViewStateDto; panel?: GraphViewStateDto }) => { full?: GraphViewStateDto; panel?: GraphViewStateDto }): void;
  /** AP-960 (D-1130): the second Esc puts the focus on the Context panel's `tab` `Graph`. */
  onFocusTab(): void;
};

/** D-1054: a centre change or a live update waits at most this long for a running rename job. */
const JOB_WAIT = 5000;
/** D-1054: the job kinds that move a file and rewrite its links in steps (4C). */
const RENAME_JOBS = new Set(['note-rename']);
/** D-1031: the panel's tighter forces. */
const PANEL_FORCES = { distance: 72, charge: -150, gap: 14 };
const POPOVER_W = 268;
const GAP = 8;
const GRAPH_YML = '.tegg/graph.yml';
/** R126 (as R120): the margin a focused node keeps from the canvas's edges after an arrow. */
const PAN_MARGIN = 24;


type Failure = { kind: 'trash' | 'gone'; title: string };
/** The last `Show local graph` that put the focus on the trigger: a later mount of the tab doesn't take it again. */
let focusSeen = 0;
type Shown = { centre: string; objectId: string | null; depth: number; filters: string; json: string };

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
  /** The last answered centre: its object id (to follow a rename, D-914) and title (the Deleted line). Used only for
   *  that same centre, and reset when the page's centre changes, so a failure never follows the previous centre. */
  const known = useRef<{ centre: string; objectId: string | null; title: string } | null>(null);
  /** The path a rename of the page's centre was followed to (§15.1), until the page's centre changes. */
  const followed = useRef<string | null>(null);
  const centreTitle = useRef(p.centre.title);
  centreTitle.current = p.centre.title;
  const preview = usePreview();
  const mode = preview.mode;
  const previewRef = useRef(preview);
  previewRef.current = preview;
  const types = p.types;
  // G3 in the panel (§17.1): the presets file as the panel read it, the node with the tab stop (AP-935), the hover ring
  // (AP-942) and the view (D-906: missing or unknown reads as Graph, not rewritten).
  const [presets, setPresets] = useState<GraphPresetsDto | null>(null);
  const [focusKey, setFocusKey] = useState<NodeKey | null>(null);
  const [ring, setRing] = useState<{ key: NodeKey; ms: number; seq: number } | null>(null);
  const viewMode: 'graph' | 'list' = p.state?.view === 'list' ? 'list' : 'graph';
  const hadFocus = useRef(false);
  const root = useRef<HTMLDivElement>(null);
  const presetActions = useRef<PresetActions | null>(null);
  const filtersOpenRef = useRef(false);
  filtersOpenRef.current = filtersOpen;
  /** A popover opened by an R123 command: no focus on the radio; closes with the command's layer (AP-968 c). */
  const noAutoFocus = useRef(false);
  const cmdLayer = useRef<MutationObserver | null>(null);

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
      if (centre) known.current = { centre: r.centre, objectId: centre.objectId ?? (known.current?.centre === r.centre ? known.current.objectId : null), title: displayTitle(centre) };
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
        const mine = known.current?.centre === r.centre ? known.current : null;
        if (err.kind === 'CentreNotFound' && mine?.objectId) {
          const moved = await ipc.indexPathById(mine.objectId).catch(() => null);
          if (seq.current !== my) return;
          if (moved && moved.normalize('NFC') !== r.centre) {
            followed.current = moved.normalize('NFC');
            void askRef.current({ ...r, centre: followed.current }, true);
            return;
          }
        }
        setWaiting(false);
        setError(null);
        setResult(null);
        shown.current = null;
        dropSelection();
        const fallback = mine?.title ?? (centreTitle.current || stemOf(r.centre));
        const title = err.kind === 'CentreInTrash' ? (err.title ?? err.name ?? fallback) : fallback;
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
    // A centre change waits in the Loading state, never beside the previous centre's graph (D-1054).
    if (!live) { seq.current++; setWaiting(true); }
    const d = deferred.current;
    if (d) { d.live = d.live && live; return true; }
    deferred.current = { live, timer: window.setTimeout(() => { jobs.current.clear(); flushDeferred(); }, JOB_WAIT) };
    return true;
  };
  useEffect(() => {
    const off = events.jobProgress((x) => {
      if (!RENAME_JOBS.has(x.kind)) return;
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
  // A centre change (navigation): nothing selected (AC-30); what was known of the previous centre is forgotten.
  const lastCentre = useRef(centrePath);
  useEffect(() => {
    if (lastCentre.current === centrePath) return;
    // A rename of the shown centre (followed already, or the same object) keeps what is known of it (FR-GRP-01 AC-41).
    if (centrePath !== followed.current) known.current = null;
    followed.current = null;
    lastCentre.current = centrePath;
    dropSelection();
    setFiltersOpen(false);
    // A navigation moves the tab stop back to the new centre (FR-UX-03 AC-31).
    setFocusKey(null);
    hadFocus.current = false;
  }, [centrePath]);
  useEffect(() => {
    if (p.centre.objectId && centrePath) known.current = { centre: centrePath, objectId: p.centre.objectId, title: known.current?.title ?? p.centre.title };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.centre.objectId]);
  // D-980: every vault change re-asks (debounced); the shell's refresh tick (own saves) and D-990's `done` too.
  const again = useRef<() => void>(() => {});
  const presetsOnly = useRef(false);
  useEffect(() => {
    let timer = 0;
    again.current = () => { window.clearTimeout(timer); timer = window.setTimeout(() => { const r = reqRef.current; if (r && !deferIfJob(true)) void askRef.current(r, true); }, DEBOUNCE); };
    const offA = events.changed((c) => {
      const paths = (c?.paths ?? []).map((x) => x.normalize('NFC'));
      if (paths.includes(GRAPH_YML)) loadPresets();
      // A change to `.tegg/graph.yml` alone reloads the list, never the graph (FR-GRP-02 AC-31); the shell's refresh
      // tick that follows the same event is skipped too.
      if (paths.length && paths.every((x) => x === GRAPH_YML)) { presetsOnly.current = true; return; }
      presetsOnly.current = false;
      again.current();
    });
    const offB = events.progress((x) => { if (x.state === 'done') again.current(); });
    return () => { window.clearTimeout(timer); again.current = () => {}; void offA.then((f) => f()).catch(() => {}); void offB.then((f) => f()).catch(() => {}); };
  }, []);
  useEffect(() => p.onOwnSave?.(() => again.current()), [p.onOwnSave]);
  const lastRefresh = useRef(p.refresh);
  useEffect(() => {
    if (lastRefresh.current === p.refresh) return;
    lastRefresh.current = p.refresh;
    if (presetsOnly.current) { presetsOnly.current = false; return; }
    again.current();
  }, [p.refresh]);

  // ------------------------------------------------------------------ presets (§17.3): read on mount, on each opening of
  // the popover and on a change of the file, so a write made in the full view is never the panel's stale base.
  const presetSeq = useRef(0);
  function loadPresets() {
    const my = ++presetSeq.current;
    ipc.graphPresetsGet().then((x) => { if (presetSeq.current === my) setPresets(x); }, () => {});
  }
  useEffect(() => { loadPresets(); }, []);
  const presetState = (x: GraphPresetsDto) => { presetSeq.current++; setPresets(x); };

  // ------------------------------------------------------------------ state of the tab (R115, D-1048)
  // Only an answer for the page's centre (or the path its rename was followed to) is drawn: never the previous centre's.
  const forCentre = !!result && !!centrePath && (result.req.centre === centrePath || result.req.centre === followed.current);
  const res = forCentre ? result!.res : null;
  // The day's file isn't known yet (`daily_view` pending): nothing, never No file (R115).
  const state = p.pending ? null : panelState({ path: centrePath, error: failure ? (failure.kind === 'trash' ? 'CentreInTrash' : 'CentreNotFound') : error, waiting, result: res, cap: PANEL_CAP });
  const drawable = !!res && res.total <= PANEL_CAP;

  // ------------------------------------------------------------------ model, layout and the first-paint fit (D-1031)
  const model = useMemo(() => (res && drawable ? buildModel(res, { sizeByLinks, scale: 'panel' }) : null), [res, drawable, sizeByLinks]);
  const sizeReady = !!size;
  useEffect(() => {
    if (!result || !res || !model || !size) return;
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
  /** The popover beside the panel; `In full graph` hands over the previewed node in every mode (AP-973). */
  const showPreview = (n: GraphNodeDto, el: Element, r: GraphResultDto, origin: 'click' | 'key' | 'hover' = 'click') => {
    const l = lines(n, r);
    shownLines.current = JSON.stringify(l);
    preview.show(targetOf(n), { el: el as HTMLElement }, origin, { placement: 'popover' }, l,
      { label: t('graph.panel.inFullGraph'), run: () => p.onOpenFull({ depth, select: n.id }) });
  };
  /** A click (click mode), ⏎ (click mode) or ⌥Space: select and preview; the focus moves into the popover (AP-961). */
  const select = (n: ModelNode, el: Element, origin: 'click' | 'key' = 'click') => {
    if (!res) return;
    hover.cancel();
    setSelected(n.key);
    setFiltersOpen(false);
    showPreview(n.node, el, res, origin);
  };
  /** Clears the selection and closes its preview (D-1041). Reads only refs and the preview store, so a callback made
   *  at mount (`ask`) calls it safely. */
  function dropSelection() {
    if (selRef.current === null) return;
    setSelected(null);
    setHovered(null); // the pointer still on the node highlights again only once it re-enters
    if (currentPreview()) closePreview('outside');
  }
  const clearSelection = dropSelection;
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
    const el = n && elementOf(n.key);
    if (n && el && JSON.stringify(lines(n.node, res)) !== shownLines.current) showPreview(n.node, el, res, preview.current.origin === 'key' ? 'key' : 'click');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [res]);
  // Closing the panel (⌘\, a tab change, the window too narrow) closes the preview it opened (D-1041).
  useEffect(() => () => {
    const c = currentPreview();
    if (selRef.current || (c && 'el' in c.anchor && root.current?.contains(c.anchor.el))) closePreview('outside');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ------------------------------------------------------------------ hover (R126; §17.4; AP-941 = D-1101, AP-970 = D-1140)
  const modelRef = useRef(model);
  modelRef.current = model;
  const resRef = useRef(res);
  resRef.current = res;
  /** A node's element in the shown view: its `<g>` on the canvas, its row in the List. */
  function elementOf(k: NodeKey): HTMLElement | null {
    return root.current?.querySelector<HTMLElement>(`[data-node-key="${CSS.escape(k)}"], [data-graph-row="${CSS.escape(k)}"]`) ?? null;
  }
  const hover = useMemo(() => graphHover({
    delay: () => previewRef.current.hoverDelay,
    show: (k) => {
      const n = modelRef.current?.nodes.find((x) => x.key === k);
      const el = elementOf(k);
      const r = resRef.current;
      if (n && el && r) showPreview(n.node, el, r, 'hover');
    },
    hide: () => { if (currentPreview()?.origin === 'hover') closePreview('outside'); },
    showing: (k) => {
      const c = currentPreview();
      return !!c && c.origin === 'hover' && 'el' in c.anchor && c.anchor.el === elementOf(k);
    },
    ring: (k) => {
      if (k === null) { setRing(null); return; }
      setRing((r) => {
        if (r && r.key === k) {
          // The same node: restart its fill from the last movement.
          for (const a of root.current?.querySelector('[data-hover-ring]')?.getAnimations() ?? []) a.currentTime = 0;
          return r;
        }
        return { key: k, ms: previewRef.current.hoverDelay, seq: (r?.seq ?? 0) + 1 };
      });
    },
  }, { grace: 'popover' }),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  []);
  useEffect(() => () => hover.dispose(), [hover]);
  // The popover is a portal of the preview provider: the pointer reaching it is seen on the document (AP-941).
  useEffect(() => {
    let onPopover = false;
    const onOver = (e: PointerEvent) => {
      const now = !!(e.target as Element | null)?.closest?.('[data-preview-popover]');
      if (now !== onPopover) { onPopover = now; hover.area('popover', now); }
    };
    document.addEventListener('pointerover', onOver, true);
    return () => document.removeEventListener('pointerover', onOver, true);
  }, [hover]);
  // A mode change applies to the next pointer input (FR-LNK-12 AC-18).
  useEffect(() => { hover.cancel(); setRing(null); }, [mode, hover]);
  /** AP-970: while `Depth and filters` or a preset layer is open, resting on a node only highlights it. */
  const layerOpen = () => filtersOpenRef.current || !!document.querySelector('[data-preset-layer]');
  const onNodePointer = (n: ModelNode, over: boolean, ringToo: boolean) => {
    if (previewRef.current.mode !== 'hover') return;
    if (!over) { hover.leave(n.key); return; }
    if (layerOpen()) return;
    hover.move(n.key, ringToo);
  };
  // R126: a click previews in click mode (⌘-click opens, R120); in hover and Off it opens; the centre never opens
  // (D-1042). The second click of a double-click and the double-click after an opening click do nothing more.
  /** The last single click opened the object (hover, Off, ⌘-click): the double-click it starts does nothing more. */
  const clickOpened = useRef(false);
  const openNode = (n: ModelNode, byKey = false) => p.onOpen(n.node, byKey ? { byKey } : undefined);
  const onNodeClick = (n: ModelNode, el: Element, e: React.MouseEvent) => {
    hover.cancel();
    if (e.detail > 1) return;
    clickOpened.current = false;
    if (mode === 'click' && !e.metaKey) { select(n, el); return; }
    if (!n.centre) { clickOpened.current = true; openNode(n); }
  };
  const onDoubleOpen = (n: ModelNode) => {
    hover.cancel();
    if (clickOpened.current) { clickOpened.current = false; return; }
    if (!n.centre) openNode(n);
  };

  // ------------------------------------------------------------------ keyboard (R126; §17.4)
  const focusNode = (k: NodeKey | null) => { if (k) elementOf(k)?.focus({ preventScroll: true }); };
  /** Pans the node into view with a 24 px margin, zoom unchanged (instant, also under Reduce motion). */
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
  const zoomBy = (f: number) => setView((v) => ({ ...v, zoom: Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(v.zoom * f * 10000) / 10000)) }));
  /** AP-963 (D-1133): `0` returns to the first-paint fit, the centre pinned. */
  const refit = () => {
    if (!model || !size) return;
    const cx = size.width / 2, cy = size.height / 2;
    const abs = new Map<NodeKey, Point>();
    for (const [k, v] of positions) abs.set(k, { x: v.x + cx, y: v.y + cy });
    const boxes = new Map(model.nodes.map((n) => [n.key, nodeBox(n, 'panel')]));
    setView({ zoom: panelFit(abs, boxes, size), panX: 0, panY: 0 });
  };
  const onKey = (e: React.KeyboardEvent, n: ModelNode, el: Element, target: 'node' | 'row') => {
    // Any key with the focus in the graph hides a hover preview; Esc does only that (D-942).
    const hoverShown = currentPreview()?.origin === 'hover';
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
      case 'open': if (!n.centre) openNode(n, true); return; // D-1042: the centre is the page already shown
      case 'centre': return; // AP-962 (D-1132): `C` does nothing in the panel
      case 'zoomIn': if (target === 'node') zoomBy(ZOOM_STEP); return;
      case 'zoomOut': if (target === 'node') zoomBy(1 / ZOOM_STEP); return;
      case 'fit': if (target === 'node') refit(); return;
      case 'escape':
        // 1st: the preview; 2nd (nothing shown): the panel's `Graph` tab (AP-960 = D-1130).
        if (selRef.current || currentPreview()) clearSelectionAndPreview();
        else p.onFocusTab();
        return;
    }
  };
  function clearSelectionAndPreview() {
    if (currentPreview()) closePreview('outside');
    setSelected(null);
  }
  // Esc hides a hover preview wherever the focus is (AP-941); the focus stays.
  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      const c = currentPreview();
      if (!c || c.origin !== 'hover' || !('el' in c.anchor) || !root.current?.contains(c.anchor.el)) return;
      e.preventDefault();
      e.stopPropagation();
      hover.cancel();
    };
    window.addEventListener('keydown', onEsc, true);
    return () => window.removeEventListener('keydown', onEsc, true);
  }, [hover]);
  const onFocusKey = (k: NodeKey | null) => { hadFocus.current = k !== null; setFocusKey(k); };
  // The focused node (or row) disappeared in a redraw: the tab stop, and the focus if it had it, go to the centre.
  useEffect(() => {
    if (!model || !focusKey || model.nodes.some((n) => n.key === focusKey)) return;
    setFocusKey(null);
    const lost = !document.activeElement || document.activeElement === document.body;
    if (hadFocus.current && lost) setTimeout(() => focusNode(model.centre), 0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model]);
  const positionIndex = useMemo(() => new Map((res ? positionOrder(res) : []).map((k, i) => [k, i + 1])), [res]);
  const relTypes = useMemo(() => relationNames(types), [types]);
  const describe = (n: ModelNode) => (res ? nodeDescription(n.node, res, relTypes, positionIndex.get(n.key) ?? null) : '');

  // ------------------------------------------------------------------ view state (§15.3, §17.2)
  const write = (patch: Partial<GraphViewStateDto>) => p.onState({ ...(p.state ?? {}), ...patch });
  const setDepth = (d: 1 | 2 | 3) => { if (d !== depth) write({ depth: d }); };
  const knownTypes = (res?.typeCounts ?? lastCounts).map(([k]) => k);
  const unknown = unknownHidden(hiddenTypes, knownTypes);
  const setType = (key: string, visible: boolean) => write({ hiddenTypes: visible ? hiddenTypes.filter((k) => k !== key) : [...hiddenTypes, key] });
  const setAll = (visible: boolean) => write({ hiddenTypes: typesAfterAll(hiddenTypes, knownTypes, visible) });
  const setKind = (kind: EdgeKindDto, visible: boolean) => write({ hiddenKinds: visible ? hiddenKinds.filter((k) => k !== kind) : [...hiddenKinds, kind] });
  /** The `View` switch (R125): a shown node preview closes and the selection clears (AP-969 = D-1139). */
  const setViewMode = (v: 'graph' | 'list') => {
    hover.cancel();
    if (currentPreview()) closePreview('outside');
    setSelected(null);
    if (v !== viewMode) write({ view: v });
  };
  // §16.4: a Tegg rename or delete changes `preset` in every view of the vault that named it, in one write.
  const onRenamed = (from: string, to: string | null) => {
    const key = nameKey(from);
    const fix = (v: GraphViewStateDto | undefined): GraphViewStateDto | undefined => {
      if (!v || typeof v.preset !== 'string' || nameKey(v.preset) !== key) return v;
      const { preset: _old, ...rest } = v;
      void _old;
      return to === null ? rest : { ...rest, preset: to };
    };
    p.onViews((g) => ({ ...g, ...(g.full ? { full: fix(g.full) } : {}), ...(g.panel ? { panel: fix(g.panel) } : {}) }));
  };
  const listed = presets?.state === 'unreadable' ? [] : presets?.presets ?? [];
  const current = currentPreset(p.state ?? {}, listed);

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
  const openFull = (sel: NodeIdDto | null) => { if (canOpenFull) p.onOpenFull({ depth, select: sel }); };

  // ------------------------------------------------------------------ R123's commands on the panel (R127, §17.5)
  /** AP-968 (c): the popover a command opened closes with that command's layer; the focus returns where it was. */
  const watchLayer = (returnTo: HTMLElement | null) => {
    cmdLayer.current?.disconnect();
    let seen = !!document.querySelector('[data-preset-layer]');
    const obs = new MutationObserver(() => {
      if (document.querySelector('[data-preset-layer]')) { seen = true; return; }
      if (!seen) return;
      obs.disconnect();
      if (cmdLayer.current === obs) cmdLayer.current = null;
      setFiltersOpen(false);
      setTimeout(() => { if (returnTo?.isConnected) returnTo.focus(); }, 0);
    });
    obs.observe(document.body, { childList: true, subtree: true });
    cmdLayer.current = obs;
  };
  const presetCommand = (id: GraphCommandId) => {
    // After the palette gave the focus back (D-139).
    setTimeout(() => {
      const returnTo = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      const wasOpen = filtersOpenRef.current;
      const layered = id !== 'preset.update' && id !== 'preset.revert';
      const act = (): boolean => {
        const a = presetActions.current;
        if (!a) return false;
        if (!wasOpen && layered) watchLayer(returnTo);
        if (id === 'preset.apply') a.openMenu(returnTo);
        else if (id === 'preset.save') a.save();
        else if (id === 'preset.update') a.update();
        else if (id === 'preset.revert') a.revert();
        else if (id === 'preset.rename') a.rename();
        else if (id === 'preset.delete') a.remove();
        return true;
      };
      if (wasOpen) { act(); return; }
      if (triggerOff) return;
      noAutoFocus.current = true;
      setFiltersOpen(true);
      let tries = 0;
      const step = () => { if (!act() && ++tries < 30) requestAnimationFrame(step); };
      requestAnimationFrame(step);
    }, 0);
  };
  if (p.commandRef) {
    p.commandRef.current = {
      depth: (d) => setDepth(d),
      openFull: () => openFull(selectedId()),
      command: (id) => {
        if (id === 'depth1' || id === 'depth2' || id === 'depth3') setDepth(Number(id.slice(5)) as 1 | 2 | 3);
        else if (id === 'view.list') setViewMode('list');
        else if (id === 'view.graph') setViewMode('graph');
        else if (id.startsWith('preset.')) presetCommand(id);
      },
      status: () => ({ view: viewMode, stored: !!current, modified: isModified(p.state ?? {}, current), file: presets?.state ?? 'missing' }),
      state: () => state,
    };
  }
  useEffect(() => () => { if (p.commandRef) p.commandRef.current = null; cmdLayer.current?.disconnect(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  // ------------------------------------------------------------------ zoom and pan (D-985, D-1031)
  useEffect(() => {
    const onWheel = (e: WheelEvent) => {
      if (!canvasBox.current?.contains(e.target as Node)) return;
      hover.cancel(); // a wheel hides a hover preview (AP-941)
      if (!(e.metaKey || e.ctrlKey)) return;
      e.preventDefault();
      const f = e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
      setView((v) => ({ ...v, zoom: Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(v.zoom * f * 10000) / 10000)) }));
    };
    window.addEventListener('wheel', onWheel, { passive: false });
    return () => window.removeEventListener('wheel', onWheel);
  }, [hover]);

  // ------------------------------------------------------------------ the `Depth and filters` popover (R114, R125)
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
    if (!filtersOpen) {
      presetActions.current = null;
      cmdLayer.current?.disconnect();
      cmdLayer.current = null;
      return;
    }
    loadPresets(); // §17.3: each opening re-reads the file, so the panel's base is never stale
    if (noAutoFocus.current) noAutoFocus.current = false;
    else {
      // At once, so a key pressed right after the opening goes on from the radio (FR-UX-03 AC-38).
      radioRef.current?.focus({ preventScroll: true });
    }
    const onDown = (e: PointerEvent) => {
      if (popover.current?.contains(e.target as Node) || triggerRef.current?.contains(e.target as Node)) return;
      // A press inside a preset layer (the menu, the Save dialog, the delete confirm) is not a click outside (R125).
      if ((e.target as Element | null)?.closest?.('[data-preset-layer]')) return;
      setFiltersOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      // The preset control's layers close one at a time first (FR-GRP-02 AC-33).
      if (document.querySelector('[data-preset-layer]')) return;
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtersOpen, placePopover]);
  useEffect(() => {
    if (!triggerOff || !filtersOpenRef.current) return;
    // AP-968 (b): the trigger turning aria-disabled with the focus inside puts the focus on the trigger (D-130).
    const inside = !!popover.current?.contains(document.activeElement) || !!document.activeElement?.closest?.('[data-preset-layer]');
    setFiltersOpen(false);
    if (inside) setTimeout(() => triggerRef.current?.focus(), 0);
  }, [triggerOff]);
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
  const drawState = state === 'graph' || state === 'noLinks' || state === 'allHidden';
  const showCanvas = viewMode === 'graph' && drawState && !!model && !!size;
  const showList = viewMode === 'list' && drawState && !!model && !!res;
  const offer = state === 'tooMany' && res ? lowerDepthOffer(res.depthTotals ?? [], depth, PANEL_CAP) : null;
  const openFullText = t('graph.panel.openFullShortcut', { shortcut: keys });
  const filterProps = {
    typeCounts: res?.typeCounts ?? lastCounts, hiddenTypes, hiddenKinds, sizeByLinks, disabled: false,
    onType: setType, onAll: setAll, onKind: setKind, onSize: (on: boolean) => write({ sizeByLinks: on }),
  };

  return (
    <div ref={root} role="tabpanel" aria-label={t('tab.graph')} className="panel-body graph-panel">
      <div className="graph-panel-toolbar">
        <button type="button" tabIndex={0} ref={triggerRef} className="graph-panel-trigger" aria-label={t('graph.panel.filters')} aria-haspopup="dialog"
          aria-expanded={filtersOpen} aria-description={tText} aria-disabled={triggerOff ? 'true' : undefined}
          onClick={() => { if (!triggerOff) setFiltersOpen((o) => !o); }}>
          {tText}
        </button>
        <span className="graph-panel-spacer" />
        {/* R125 (board GraphPanel B8, AP-965 = D-1135): the `View` switch, two icon buttons. */}
        <div role="group" aria-label={t('graph.view')} className="graph-panel-view">
          {(['graph', 'list'] as const).map((v) => (
            <button key={v} type="button" tabIndex={0} data-command={`graph.view.${v}`} aria-pressed={viewMode === v} aria-label={t(`graph.view.${v}`)} title={t(`graph.view.${v}`)}
              onClick={(e) => { e.currentTarget.focus(); setViewMode(v); }}>
              <Icon name={v === 'graph' ? 'graph' : 'query'} size={14} />
            </button>
          ))}
        </div>
        {/* As in G2, no explicit tab stop (WebKit's Tab skips it; ⌘⇧G and the palette reach it): Tab from `List` goes on
            to the canvas or the tree (FR-UX-03 AC-38). */}
        <button type="button" ref={fullBtn} className="graph-panel-full" data-command="graph.open" aria-label={openFullText} title={openFullText}
          aria-disabled={canOpenFull ? undefined : 'true'} aria-description={needsObject}
          onClick={() => { const sel = pressed.current !== undefined ? pressed.current : selectedId(); pressed.current = undefined; openFull(sel); }}>
          <Icon name="external" size={14} />
        </button>
      </div>
      {filtersOpen && (
        <div ref={popover} role="dialog" aria-modal="false" aria-label={t('graph.panel.filters')} className="graph-filters graph-panel-popover"
          style={{ left: popPos?.left ?? -9999, top: popPos?.top ?? 0, width: POPOVER_W }}>
          <GraphFilters {...filterProps} variant="popover" depth={depth} onDepth={setDepth} radioRef={radioRef}
            preset={<PresetControl view="panel" state={presets} onState={presetState} graph={p.state ?? {}} onApply={p.onState} onRenamed={onRenamed} actionsRef={presetActions} />} />
        </div>
      )}
      <div ref={canvasBox} className="graph-panel-canvas">
        {showCanvas && (
          <GraphCanvas model={model!} positions={positions} size={size!} view={view} onView={setView} scale="panel"
            selected={selected} hovered={hovered} onHover={setHovered} entering={entering} contentRef={content} name={canvasName}
            help={t('graph.canvas.help')} describe={describe} focusKey={focusKey} onFocusKey={onFocusKey} ring={mode === 'hover' ? ring : null}
            onKey={(e, n, el) => onKey(e, n, el, 'node')} onNodePointer={(n, over) => onNodePointer(n, over, true)} onPan={() => hover.cancel()}
            onNodeClick={onNodeClick}
            onOpen={onDoubleOpen}
            onEmpty={() => { setFiltersOpen(false); hover.cancel(); clearSelection(); }} />
        )}
        {showList && (
          <div className="graph-panel-list" style={{ width: canvasW, height: height ?? undefined }}>
            <GraphList variant="panel" result={res!} model={model!} types={relTypes} selected={selected} focusKey={focusKey} onFocusKey={onFocusKey}
              onClick={(n, el, e) => onNodeClick(n, el, e)} onDoubleClick={onDoubleOpen}
              onKey={(e, n, el) => onKey(e, n, el, 'row')} onPointer={(n, over) => onNodePointer(n, over, false)} onMove={() => hover.cancel()} />
          </div>
        )}
        {state === 'noLinks' && <p className="graph-state">{t('graph.noLinks')}</p>}
        {state === 'allHidden' && res && (
          <div className="graph-state">
            <p>{t(hiddenKinds.length ? 'graph.allHidden.filters' : 'graph.allHidden.types', { count: res.hidden })}</p>
            <button type="button" data-command="graph.showAllTypes" className="button" onClick={() => (hiddenKinds.length ? write({ hiddenTypes: unknown, hiddenKinds: [] }) : write({ hiddenTypes: unknown }))}>
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
      {state === 'graph' && model && <p className="graph-panel-footer">{footerText(model.nodes.length, mode)}</p>}
    </div>
  );
}
