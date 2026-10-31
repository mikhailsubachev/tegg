// v0.94 (docs/contracts/v1-graph.md §4.1; graph.md FR-GRP-01 AC-47…AC-49; D-1169, D-1179, D-1180): wheel and pinch
// input on a graph canvas, shared by the full view (GraphPage) and the right panel (GraphPanel). A plain wheel or
// two-finger scroll pans the drawing by (−dx, −dy) screen pixels, as a scrolled page, at any zoom and without a limit; a
// ⌘- or ctrl-wheel zooms by 1.25^(−deltaY ⁄ 120) around the pointer (a 120 px mouse notch is one × 1.25 step); a
// WebKit pinch (`gesturestart` / `gesturechange`, `scale` relative to the start) zooms by its scale change around the
// pointer. Zoom stays within 25–400 % (D-985). Every such event is prevented, so neither the page nor the panel behind
// scrolls and WebKit doesn't zoom the page; any wheel over the canvas box also hides a hover preview (AP-941).
import type { View } from './GraphCanvas';
import { ZOOM_MAX, ZOOM_MIN, ZOOM_STEP } from './viewState';

const clampZoom = (z: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(z * 10000) / 10000));
/** Line and page wheel deltas in pixels (a mouse may report lines). */
const pixels = (d: number, mode: number, page: number) => (mode === 1 ? d * 16 : mode === 2 ? d * page : d);

/** `v` zoomed to `zoom` (clamped) with the drawing's point under `at` (canvas-local pixels) kept in place. */
export function zoomAround(v: View, zoom: number, at: { x: number; y: number }, size: { width: number; height: number }): View {
  const z = clampZoom(zoom);
  const f = z / v.zoom;
  const cx = size.width / 2, cy = size.height / 2;
  return { zoom: z, panX: at.x - cx - f * (at.x - cx - v.panX), panY: at.y - cy - f * (at.y - cy - v.panY) };
}
/** `v` zoomed by `f` around the canvas's centre (the buttons and `+` / `−`, D-985). */
export function zoomCentre(v: View, f: number, size: { width: number; height: number } | null): View {
  return size ? zoomAround(v, v.zoom * f, { x: size.width / 2, y: size.height / 2 }, size) : { ...v, zoom: clampZoom(v.zoom * f) };
}

type Input = {
  /** The canvas's box: the wheel over it hides a hover preview, whatever is drawn in it (the graph or the List). */
  box: () => HTMLElement | null;
  setView: (f: (v: View) => View) => void;
  /** Any wheel or pinch over the box (it hides a hover preview, AP-941). */
  onInput: () => void;
};

/** Installs the window listeners; returns their removal. */
export function installCanvasInput(o: Input): () => void {
  const svgOf = (target: EventTarget | null): SVGSVGElement | null => {
    const box = o.box();
    const el = target instanceof Element ? target : null;
    if (!box || !el || !box.contains(el)) return null;
    return el.closest('svg.graph-svg') as SVGSVGElement | null;
  };
  const local = (svg: SVGSVGElement, x: number, y: number) => {
    // Canvas pixels: the svg has no viewBox, so its user units are CSS pixels from its top-left corner; its centre is
    // the drawing's origin plus the pan (GraphCanvas), from the `width` / `height` it is drawn with.
    const r = svg.getBoundingClientRect();
    return { at: { x: x - r.left, y: y - r.top }, size: { width: svg.width.baseVal.value || r.width, height: svg.height.baseVal.value || r.height } };
  };
  const onWheel = (e: WheelEvent) => {
    const box = o.box();
    if (!box || !(e.target instanceof Node) || !box.contains(e.target)) return;
    o.onInput();
    // In List the canvas's box holds the tree, which scrolls as any list (graph-panel-g3.md FR-UX-08 AC-12).
    const svg = svgOf(e.target);
    if (!svg) return;
    e.preventDefault();
    const { at, size } = local(svg, e.clientX, e.clientY);
    if (e.metaKey || e.ctrlKey) {
      const dy = pixels(e.deltaY, e.deltaMode, size.height);
      o.setView((v) => zoomAround(v, v.zoom * Math.pow(ZOOM_STEP, -dy / 120), at, size));
      return;
    }
    const dx = pixels(e.deltaX, e.deltaMode, size.width), dy = pixels(e.deltaY, e.deltaMode, size.height);
    if (dx || dy) o.setView((v) => ({ ...v, panX: v.panX - dx, panY: v.panY - dy }));
  };
  // A WebKit pinch: the zoom at its start times the gesture's scale.
  let pinch: { zoom: number } | null = null;
  type Gesture = Event & { scale?: number; clientX?: number; clientY?: number };
  const onGesture = (e: Event) => {
    const g = e as Gesture;
    const svg = svgOf(e.target);
    if (!svg) { if (e.type === 'gestureend') pinch = null; return; }
    e.preventDefault();
    o.onInput();
    if (e.type === 'gestureend') { pinch = null; return; }
    if (e.type === 'gesturestart') { pinch = null; return; } // the first change takes the zoom it starts from
    const scale = typeof g.scale === 'number' && Number.isFinite(g.scale) && g.scale > 0 ? g.scale : 1;
    const { at, size } = local(svg, g.clientX ?? 0, g.clientY ?? 0);
    o.setView((v) => {
      pinch ??= { zoom: v.zoom };
      return zoomAround(v, pinch.zoom * scale, at, size);
    });
  };
  window.addEventListener('wheel', onWheel, { passive: false });
  for (const type of ['gesturestart', 'gesturechange', 'gestureend']) window.addEventListener(type, onGesture, { passive: false });
  return () => {
    window.removeEventListener('wheel', onWheel);
    for (const type of ['gesturestart', 'gesturechange', 'gestureend']) window.removeEventListener(type, onGesture);
  };
}
