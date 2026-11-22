// Slice AND-2 (docs/contracts/android-phone.md §9.4; FR-MMP-02 AC-32…AC-36, D-2073): the read view's mindmap on the
// phone. A header with `Map` / `List`, zoom out, zoom in, fit to width and full screen; the map area scrolls sideways
// and the drawing is scaled from its top left. Scale and view are session state per block; nothing is stored.
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { t } from '../i18n/catalog';
import { ipc } from '../ipc/client';
import { Icon } from '../shell/Icon';
import { pushLayer } from '../phone/back';
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
  // A pinch (two pointers) scales around its centre.
  useEffect(() => {
    const el = area.current;
    if (!el) return;
    const pts = new Map<number, { x: number; y: number }>();
    let from = 0;
    const dist = () => { const [a, b] = [...pts.values()]; return Math.hypot(a.x - b.x, a.y - b.y); };
    const down = (e: PointerEvent) => { if (e.pointerType !== 'touch') return; pts.set(e.pointerId, { x: e.clientX, y: e.clientY }); if (pts.size === 2) from = dist(); };
    const move = (e: PointerEvent) => {
      if (!pts.has(e.pointerId)) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size !== 2 || from <= 0 || scale === null) return;
      const to = dist();
      const [a, b] = [...pts.values()];
      const r = el.getBoundingClientRect();
      onScale(pinchScale(scale, from, to), { x: (a.x + b.x) / 2 - r.left, y: (a.y + b.y) / 2 - r.top });
      from = to;
    };
    const up = (e: PointerEvent) => { pts.delete(e.pointerId); if (pts.size < 2) from = 0; };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    return () => {
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
    };
  }, [scale, onScale]);
  const s = scale ?? 1;
  const w = size ? size.width * s : undefined;
  const h = size ? blockHeight(size.height, s) : undefined;
  return (
    <div ref={area} className={`phone-map-area${fill ? ' fill' : ''}`} data-map-area="" data-scale={String(Math.round(s * 1000) / 1000)}
      style={fill ? undefined : { height: h }}>
      <div className="phone-map-sizer" style={{ width: w, height: size ? size.height * s : undefined }}>
        <div ref={inner} className="phone-map-inner" style={{ transform: `scale(${s})`, transformOrigin: '0 0', width: size?.width }}>
          {map}
        </div>
      </div>
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
      const a = document.querySelector<HTMLElement>(full ? '.phone-map-full [data-map-area]' : '[data-map-area]');
      if (a && centre) {
        const sc = scrollAfterZoom({ left: a.scrollLeft, top: a.scrollTop }, centre, p, next);
        requestAnimationFrame(() => { a.scrollLeft = sc.left; a.scrollTop = sc.top; });
      }
      return next;
    });
    const t0 = performance.now();
    const step = zoomSteps++;
    requestAnimationFrame(() => { void ipc.perfMarkFrame('mindmap-zoom', step, Math.round((performance.now() - t0) * 10) / 10).catch(() => {}); });
  }, [full]);
  const s = scale ?? 1;
  const openFull = () => {
    savedScroll.current = document.querySelector('main')?.scrollTop ?? 0;
    setFull(true);
  };
  const closeFull = useCallback(() => {
    setFull(false);
    requestAnimationFrame(() => { const m = document.querySelector('main'); if (m) m.scrollTop = savedScroll.current; });
  }, []);
  useEffect(() => (full ? pushLayer(closeFull) : undefined), [full, closeFull]);
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
      {view === 'map' && !full && <Area map={map} scale={scale} onScale={apply} size={size} onSize={setSize} fill={false} />}
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
