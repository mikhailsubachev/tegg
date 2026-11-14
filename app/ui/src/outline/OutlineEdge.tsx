// Slice OL (docs/contracts/v1-outline.md §3.6, §3.7, §3.8; outline.md R173, FR-EDT-16): the edge rail, its card and the
// outline's live region, mounted in `div.centre` after `main` on the note routes. The rail is a pointer shortcut
// (`aria-hidden`); the card is a non-modal dialog with the outline's tree. Nothing here writes or calls IPC.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { railRows } from '@tegg/doc';
import { t } from '../i18n/catalog';
import { jump } from './jump';
import { CARD_MAX_H, CARD_MAX_VH, cardChevrons, HOVER_CLOSE_MS, HOVER_OPEN_MS, RAIL_LINE, RAIL_MARGIN, RAIL_MIN_PANE, railGap } from './model';
import { OutlineTree } from './OutlineTree';
import { markOutlineReady } from './ready';
import { closeCard, getCard, openCard, setRailRows, setTempOpen, takeFocus, useCard, useCurrent, useFocusReq, useLive, useOutline } from './store';

/** The card's vertical padding (px), inside its max-height. */
const CARD_PAD = 6;
const reduceMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export function OutlineEdge({ wanted }: {
  /** The rail may show on this route: not focus mode, `Show outline rail` on (D-1601, D-1602). */
  wanted: boolean;
}) {
  const source = useOutline();
  const current = useCurrent();
  const card = useCard();
  const live = useLive();
  const focusReq = useFocusReq();
  const liveRef = useRef<HTMLDivElement | null>(null);
  const railRef = useRef<HTMLDivElement | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const cardScroll = useRef<HTMLDivElement | null>(null);
  const [geo, setGeo] = useState({ paneW: 0, mainMid: 0, mainH: 0 });
  const [hover, setHover] = useState<number | null>(null);
  const [cardReq, setCardReq] = useState<{ n: number; index: number | null } | null>(null);

  // Geometry from the measured centre pane and `main` (a separator drag counts while it moves, §3.6).
  useLayoutEffect(() => {
    const centre = liveRef.current?.parentElement;
    const main = centre?.querySelector<HTMLElement>(':scope > main');
    if (!centre || !main) return;
    const measure = () => {
      const c = centre.getBoundingClientRect();
      const m = main.getBoundingClientRect();
      const next = { paneW: c.width, mainMid: m.top - c.top + main.clientHeight / 2, mainH: main.clientHeight };
      setGeo((g) => (g.paneW === next.paneW && g.mainMid === next.mainMid && g.mainH === next.mainH ? g : next));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(centre);
    ro.observe(main);
    window.addEventListener('resize', measure);
    return () => { ro.disconnect(); window.removeEventListener('resize', measure); };
  }, []);

  const tree = source?.tree ?? [];
  const rows = useMemo(() => railRows(tree, current, card.tempOpen), [tree, current, card.tempOpen]);
  const gap = railGap(rows.length, geo.mainH - RAIL_MARGIN);
  const fits = tree.length >= 2 && geo.paneW >= RAIL_MIN_PANE && gap !== null;
  const shown = wanted && fits;
  // The fade-in (R173); none under Reduce motion. D-1675: no fade-out (it was for the removed Outline tab).
  const [phase, setPhase] = useState<'shown' | 'gone'>(shown ? 'shown' : 'gone');
  const entering = useRef(false);
  useLayoutEffect(() => {
    if (shown) {
      if (phase !== 'shown') { entering.current = !reduceMotion(); setPhase('shown'); }
      return;
    }
    if (phase === 'shown') setPhase('gone');
  }, [shown]); // eslint-disable-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    const el = railRef.current;
    if (!el || !entering.current) return;
    entering.current = false;
    el.setAttribute('data-entering', '');
    void el.getBoundingClientRect(); // the start value, so the change below is a transition
    void getComputedStyle(el).opacity;
    el.removeAttribute('data-entering');
  }, [phase]);
  const railOn = phase !== 'gone';
  useEffect(() => { setRailRows(shown ? rows : []); }, [shown, rows]);
  useEffect(() => { if (shown && rows.length) markOutlineReady(); }, [shown]);

  // `div.centre[data-outline-rail]`: the text clearance (§3.6, D-1614).
  useLayoutEffect(() => {
    const centre = liveRef.current?.parentElement;
    if (!centre) return;
    if (shown) centre.setAttribute('data-outline-rail', geo.paneW < 760 + 2 * 4 ? 'narrow' : '');
    else centre.removeAttribute('data-outline-rail');
  }, [shown, geo.paneW]);
  useEffect(() => () => liveRef.current?.parentElement?.removeAttribute('data-outline-rail'), []);

  // The card closes when the rail goes from shown to hidden (R173).
  const wasShown = useRef(shown);
  useEffect(() => {
    if (wasShown.current && !shown && getCard().open) closeCard();
    wasShown.current = shown;
  }, [shown]);
  // …and on a `mousedown` outside the rail and the card (the click goes on to its target).
  useEffect(() => {
    if (!card.open) return;
    const down = (e: MouseEvent) => {
      const el = e.target as Node | null;
      if (el && (railRef.current?.contains(el) || cardRef.current?.contains(el))) return;
      closeCard();
    };
    document.addEventListener('mousedown', down, true);
    return () => document.removeEventListener('mousedown', down, true);
  }, [card.open]);

  // Hover (R173): 150 ms on the rail opens; leaving both the rail and the card closes 300 ms later. A card opened by ⌘J
  // ignores the pointer.
  const openT = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeT = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clear = (r: typeof openT) => { if (r.current) clearTimeout(r.current); r.current = null; };
  useEffect(() => () => { clear(openT); clear(closeT); }, []);
  useEffect(() => { if (!card.open) { clear(closeT); setHover(null); } }, [card.open]);
  const enter = () => {
    clear(closeT);
    if (!getCard().open && !openT.current) openT.current = setTimeout(() => { openT.current = null; openCard('hover'); }, HOVER_OPEN_MS);
  };
  const leave = () => {
    clear(openT);
    const c = getCard();
    if (c.open && c.by === 'hover') { clear(closeT); closeT.current = setTimeout(() => { closeT.current = null; if (getCard().by === 'hover') closeCard(); }, HOVER_CLOSE_MS); }
  };

  // A card opened by ⌘J takes the focus on the current row (else the first).
  useLayoutEffect(() => {
    if (!card.open || focusReq?.where !== 'card') return;
    takeFocus('card');
    setCardReq((r) => ({ n: (r?.n ?? 0) + 1, index: current !== null && rows.includes(current) ? current : rows[0] ?? null }));
  }, [focusReq, card.open]); // eslint-disable-line react-hooks/exhaustive-deps
  // The current row in the card's middle when the card scrolls (D-1645).
  useLayoutEffect(() => {
    const sc = cardScroll.current;
    if (!card.open || !sc || current === null) return;
    const el = sc.querySelector<HTMLElement>(`[data-outline-row="${current}"]`);
    if (!el) return;
    const sb = sc.getBoundingClientRect();
    const eb = el.getBoundingClientRect();
    sc.scrollTop = Math.max(0, Math.min(sc.scrollTop + (eb.top + eb.height / 2) - (sb.top + sb.height / 2), sc.scrollHeight - sc.clientHeight));
  }, [card.open]); // eslint-disable-line react-hooks/exhaustive-deps

  const ancestors = useMemo(() => {
    const a = new Set<number>();
    for (let p = current !== null ? tree[current]?.parent ?? null : null; p !== null; p = tree[p]?.parent ?? null) a.add(p);
    return a;
  }, [tree, current]);
  const chevrons = useMemo(() => cardChevrons(tree, rows, card.tempOpen), [tree, rows, card.tempOpen]);
  const slot = RAIL_LINE + (gap ?? 0);
  const close = () => { closeCard(); source?.refocus(); };

  return (
    <>
      {railOn && source && (
        <div ref={railRef} className="outline-rail" data-outline-rail="" aria-hidden="true"
          style={{ top: geo.mainMid }}
          onPointerEnter={enter} onPointerLeave={() => { leave(); setHover(null); }}
          onPointerMove={(e) => {
            const l = (e.target as HTMLElement).closest<HTMLElement>('[data-outline-line]');
            setHover(l ? Number(l.dataset.outlineLine) : null);
            // A pointer resting on the rail after a line's jump closed the card opens it again (R173 hover).
            if (!getCard().open && !openT.current) enter();
          }}
          onMouseDown={(e) => e.preventDefault()}
          onClick={(e) => { const l = (e.target as HTMLElement).closest<HTMLElement>('[data-outline-line]'); if (l) { clear(openT); jump(Number(l.dataset.outlineLine), 'rail'); } }}>
          {rows.map((i) => {
            const n = tree[i];
            const state = i === current ? 'current' : ancestors.has(i) ? 'ancestor' : 'rest';
            return <i key={n.key} data-outline-line={i} data-state={state} data-level={n.level} data-hover={hover === i ? '' : undefined} style={{ height: slot }} />;
          })}
        </div>
      )}
      {card.open && source && (
        <div ref={cardRef} role="dialog" aria-label={t('outline.card')} data-outline-card="" className="outline-card"
          style={{ top: geo.mainMid, maxHeight: Math.min(CARD_MAX_H, CARD_MAX_VH * geo.mainH) }}
          onMouseDown={(e) => e.preventDefault()}
          onPointerEnter={() => clear(closeT)} onPointerLeave={leave}>
          <div className="outline-card-scroll" ref={cardScroll} style={{ maxHeight: Math.min(CARD_MAX_H, CARD_MAX_VH * geo.mainH) - 2 * CARD_PAD - 2 }}>
            <OutlineTree tree={tree} rows={rows} current={current} ancestors={ancestors} chevrons={chevrons} tempOpen={card.tempOpen}
              hoverRow={hover} onHoverRow={setHover}
              onJump={(i) => jump(i, 'card')}
              onFold={(i, op) => setTempOpen(i, op === 'expand' ? true : op === 'collapse' ? false : !card.tempOpen.has(i))}
              onEscape={close} onLeave={close} focusReq={cardReq} />
          </div>
        </div>
      )}
      <div ref={liveRef} className="sr-live" data-outline-live="" role="status" aria-live="polite">{live}</div>
    </>
  );
}
