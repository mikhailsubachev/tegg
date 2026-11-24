// Slice AND-2 (docs/contracts/android-phone.md §9.4; FR-MMP-02 AC-32…AC-36, D-2191): the read view's mindmap on the
// phone. A header with `Map` / `List`, zoom out, zoom in, fit to width and full screen; the map area scrolls sideways
// and the drawing is scaled from its top left. Scale and view are session state per block; nothing is stored.
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { t } from '../i18n/catalog';
import { ipc } from '../ipc/client';
import { Icon } from '../shell/Icon';
import { pushLayer } from '../phone/back';
import { setMapFullScreen } from '../phone/fullScreen';
import { blockHeight, canZoomIn, canZoomOut, openingScale, pinchScale, scrollAfterZoom, zoomIn, zoomOut } from './zoom';

type Size = { width: number; height: number };

/** The drawing's size at scale 1: the `mindmap-canvas` the map renders. */
function measure(inner: HTMLElement | null): Size | null {
  const c = inner?.querySelector<HTMLElement>('.mindmap-canvas');
  if (!c) return null;
  return { width: c.offsetWidth, height: c.offsetHeight };
}

let zoomSteps = 0;

/** The scaled map area; `fill` pans both ways (full screen). */
function Area({ map, scale, onScale, size, onSize, fill }: {
  map: ReactNode; scale: number | null; onScale: (s: number, centre?: { x: number; y: number }) => void; size: Size | null; onSize: (s: Size) => void; fill: boolean;
}) {
  const area = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const m = measure(inner.current);
    if (m && (!size || m.width !== size.width || m.height !== size.height)) onSize(m);
  });
  // A pinch (two fingers) scales around its centre. Touch events, not pointer events: the browser would take two
  // pointers for a pan and cancel them; a two-finger move is kept from it (preventDefault).
  const live = useRef({ scale, onScale });
  live.current = { scale, onScale };
  useEffect(() => {
    const el = area.current;
    if (!el) return;
    let from = 0;
    const two = (e: TouchEvent) => (e.touches.length === 2 ? [e.touches[0], e.touches[1]] as const : null);
    const start = (e: TouchEvent) => { const t = two(e); from = t ? Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY) : 0; };
    const move = (e: TouchEvent) => {
      const t = two(e);
      const { scale: s0, onScale: on } = live.current;
      if (!t || from <= 0 || s0 === null) return;
      e.preventDefault();
      const to = Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
      const r = el.getBoundingClientRect();
      const next = pinchScale(s0, from, to);
      live.current.scale = next;
      on(next, { x: (t[0].clientX + t[1].clientX) / 2 - r.left, y: (t[0].clientY + t[1].clientY) / 2 - r.top });
      from = to;
    };
    const end = (e: TouchEvent) => { if (e.touches.length < 2) from = 0; };
    el.addEventListener('touchstart', start, { passive: true });
    el.addEventListener('touchmove', move, { passive: false });
    el.addEventListener('touchend', end);
    el.addEventListener('touchcancel', end);
    return () => {
      el.removeEventListener('touchstart', start);
      el.removeEventListener('touchmove', move);
      el.removeEventListener('touchend', end);
      el.removeEventListener('touchcancel', end);
    };
  }, []);
  const s = scale ?? 1;
  const w = size ? size.width * s : undefined;
  const h = size ? blockHeight(size.height, s) : undefined;
  return (
    <div ref={area} className={`phone-map-area${fill ? ' fill' : ''}`} data-map-area="" data-scale={String(Math.round(s * 1000) / 1000)}
      style={fill ? undefined : { height: h }}>
      {/* The drawing at scale 1 (its offset size is the layout's), scaled from the top left; the sizer after it gives
          the area its scaled scroll extent. */}
      <div ref={inner} className="phone-map-inner" style={{ transform: `scale(${s})`, transformOrigin: '0 0', width: size?.width, height: size?.height }}>
        {map}
      </div>
      <div className="phone-map-sizer" aria-hidden="true" style={{ width: w, height: size ? size.height * s : undefined }} />
    </div>
  );
}

export function MapViewport({ title, map, list }: { title: string; map: ReactNode; list: ReactNode }) {
  const [view, setView] = useState<'map' | 'list'>('map');
  const [scale, setScale] = useState<number | null>(null);
  const [size, setSize] = useState<Size | null>(null);
  const [full, setFull] = useState(false);
  const block = useRef<HTMLElement>(null);
  const savedScroll = useRef<number>(0);
  const target = useRef<{ left: number; top: number } | null>(null);
  const areaWidth = useCallback(() => {
    const a = block.current?.querySelector<HTMLElement>('[data-map-area]');
    return a?.clientWidth ?? block.current?.clientWidth ?? 0;
  }, []);
  // The opening scale fits the width (0.5 at least), once the drawing is measured.
  useEffect(() => {
    if (scale === null && size) setScale(openingScale(areaWidth(), size.width));
  }, [scale, size, areaWidth]);
  const apply = useCallback((next: number, centre?: { x: number; y: number }) => {
    setScale((prev) => {
      const p = prev ?? 1;
      const a = full ? document.querySelector<HTMLElement>('.phone-map-full [data-map-area]') : block.current?.querySelector<HTMLElement>('[data-map-area]') ?? null;
      if (a && centre) {
        // Steps of one pinch build on the scroll the last step asked for, not the one painted yet. The inline map
        // doesn't scroll vertically: its vertical part goes to the page.
        const base = target.current ?? { left: a.scrollLeft, top: full ? a.scrollTop : 0 };
        const sc = scrollAfterZoom(base, centre, p, next);
        target.current = sc;
        const m = full ? null : a.closest('main');
        const dy = sc.top - base.top;
        requestAnimationFrame(() => {
          a.scrollLeft = sc.left;
          if (full) a.scrollTop = sc.top;
          else if (m && dy) m.scrollTop += dy;
          if (!full) target.current = { left: sc.left, top: 0 };
          requestAnimationFrame(() => { target.current = null; });
        });
      }
      return next;
    });
    const t0 = performance.now();
    const step = zoomSteps++;
    requestAnimationFrame(() => { void ipc.perfMarkFrame('mindmap-zoom', step, Math.round((performance.now() - t0) * 10) / 10).catch(() => {}); });
  }, [full]);
  const s = scale ?? 1;
  const openFull = () => {
    savedScroll.current = block.current?.closest('main')?.scrollTop ?? 0;
    setFull(true);
  };
  const closeFull = useCallback(() => {
    setFull(false);
    // The frame brings the bottom bar back after this render, which shortens the page: set the scroll again for a few
    // frames until it holds.
    let n = 0;
    const put = () => {
      const m = block.current?.closest('main');
      if (!m) return;
      m.scrollTop = savedScroll.current;
      if (n++ < 10 && Math.abs(m.scrollTop - savedScroll.current) > 1) requestAnimationFrame(put);
      else if (n < 3) requestAnimationFrame(put);
    };
    requestAnimationFrame(put);
  }, []);
  useEffect(() => (full ? pushLayer(closeFull) : undefined), [full, closeFull]);
  useEffect(() => {
    if (!full) return;
    setMapFullScreen(true);
    return () => setMapFullScreen(false);
  }, [full]);
  const zoomButtons = (
    <>
      <button type="button" className="icon-button" aria-label={t('phone.map.zoomOut')} data-command="mindmap.zoomOut"
        aria-disabled={!canZoomOut(s) || undefined} onClick={() => { if (canZoomOut(s)) apply(zoomOut(s)); }}>
        <Icon name="minus" />
      </button>
      <button type="button" className="icon-button" aria-label={t('phone.map.zoomIn')} data-command="mindmap.zoomIn"
        aria-disabled={!canZoomIn(s) || undefined} onClick={() => { if (canZoomIn(s)) apply(zoomIn(s)); }}>
        <Icon name="plus" />
      </button>
      <button type="button" className="icon-button" aria-label={t('phone.map.fit')} data-command="mindmap.fit"
        onClick={() => { if (size) apply(openingScale(areaWidth(), size.width)); }}>
        <Icon name="resize" />
      </button>
    </>
  );
  return (
    <section ref={block} className="phone-map">
      <div className="mindmap-header phone-map-header">
        <div role="group" aria-label={t('mindmap.view')} className="segmented">
          <button type="button" aria-pressed={view === 'map'} data-command="mindmap.showMap" onClick={() => setView('map')}>{t('mindmap.map')}</button>
          <button type="button" aria-pressed={view === 'list'} data-command="mindmap.showList" onClick={() => setView('list')}>{t('mindmap.list')}</button>
        </div>
        {view === 'map' && zoomButtons}
        {view === 'map' && (
          <button type="button" className="icon-button" aria-label={t('phone.map.fullScreen')} data-command="mindmap.fullScreen" onClick={openFull}>
            <Icon name="width-wide" />
          </button>
        )}
      </div>
      {/* Kept (hidden) while full screen is open, so the note keeps its height and its scroll position. */}
      {view === 'map' && <div style={full ? { visibility: 'hidden' } : undefined}><Area map={map} scale={scale} onScale={apply} size={size} onSize={setSize} fill={false} /></div>}
      {view === 'list' && <div className="phone-map-list">{list}</div>}
      {full && createPortal(
        <div role="dialog" aria-modal="true" aria-label={t('mindmap.figure', { title })} className="phone-map-full"
          onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); closeFull(); } }}>
          <div className="phone-map-header">
            <button type="button" className="icon-button" aria-label={t('phone.map.closeFullScreen')} data-command="mindmap.closeFullScreen" onClick={closeFull}>
              <Icon name="x" />
            </button>
            {zoomButtons}
          </div>
          <Area map={map} scale={scale} onScale={apply} size={size} onSize={setSize} fill />
        </div>,
        document.querySelector('.app') ?? document.body,
      )}
    </section>
  );
}
