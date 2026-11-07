// Slice PIN (docs/contracts/v1-pinned.md §3.1 `drag.ts`; R135, D-1381): pointer drags into and inside the Pinned section,
// the Kanban's way (a `mousedown`, then window `mousemove` / `mouseup` capture listeners): a drag starts after 5 px
// (|dx| + |dy|); a shorter press and release stays a click; after a drag the click is swallowed; Esc cancels. The drop
// zone is found with `elementFromPoint(…).closest('[data-pinned-drop]')`. Not HTML5 drag and drop, so Tauri's file-drop
// handling is never involved.
import { tagOfFile } from '../tags/store';
import { useEffect, useState } from 'react';
import type { PinRequestDto } from '../ipc/pins';
import { dropIndex, editReason, findPin } from './model';
import { move, pinsNow, pinTarget } from './store';

/** What a source drags in: the target, and how the chip draws it. */
export type DragItem = { request: PinRequestDto; label: string; icon: string; color?: string | null };

export type DragState =
  | null
  | {
    kind: 'row' | 'in';
    item: DragItem;
    /** The dragged row's index (reorder). */
    from: number | null;
    x: number; y: number;
    /** Over the section; the 0-based final position where it would land. */
    over: boolean; at: number | null;
  };

let drag: DragState = null;
const subs = new Set<(d: DragState) => void>();
function publish(d: DragState) {
  drag = d;
  for (const f of subs) f(d);
}

export function useDrag(): DragState {
  const [d, setD] = useState<DragState>(drag);
  useEffect(() => { subs.add(setD); setD(drag); return () => { subs.delete(setD); }; }, []);
  return d;
}

/** The section's list items (rows and the placeholder) in order, for R135's line. */
function rowRects(zone: Element): { top: number; bottom: number; height: number }[] {
  return [...zone.querySelectorAll('[data-pin-li]')].map((li) => {
    const r = li.getBoundingClientRect();
    return { top: r.top, bottom: r.bottom, height: r.height };
  });
}

function where(x: number, y: number, from: number | null): { over: boolean; at: number | null } {
  if (editReason(pinsNow())) return { over: false, at: null };
  const el = document.elementFromPoint(x, y);
  const zone = el?.closest('[data-pinned-drop]');
  if (!zone) return { over: false, at: null };
  return { over: true, at: dropIndex(rowRects(zone), y, from ?? undefined) };
}

/** Starts watching a press on a source; `item` null: not a source (nothing happens). Returns whether it took the press.
 *  `from`: the dragged row (reorder); `pinned`: a dragged-in target's own row, discounted like a reordered row (D-1379). */
function press(e: { button: number; clientX: number; clientY: number }, item: DragItem | null, from: number | null, drop: (d: NonNullable<DragState>) => void, pinned: number | null = null, onStart?: () => void): boolean {
  if (!item || e.button !== 0) return false;
  const own = from ?? pinned;
  const x0 = e.clientX, y0 = e.clientY;
  let started = false;
  const onMove = (m: MouseEvent) => {
    if (!started) {
      if (Math.abs(m.clientX - x0) + Math.abs(m.clientY - y0) < 5) return;
      started = true;
      window.getSelection()?.removeAllRanges();
      onStart?.();
    }
    m.preventDefault();
    publish({ kind: from === null ? 'in' : 'row', item, from, x: m.clientX, y: m.clientY, ...where(m.clientX, m.clientY, own) });
  };
  const stop = () => {
    window.removeEventListener('mousemove', onMove, true);
    window.removeEventListener('mouseup', onUp, true);
    window.removeEventListener('keydown', onKey, true);
  };
  const swallowClick = () => {
    const eat = (c: MouseEvent) => { c.preventDefault(); c.stopPropagation(); };
    window.addEventListener('click', eat, { capture: true, once: true });
    setTimeout(() => window.removeEventListener('click', eat, true), 0);
  };
  const onUp = (u: MouseEvent) => {
    stop();
    if (!started) return;
    u.preventDefault();
    swallowClick();
    const d = drag;
    publish(null);
    if (d && d.over && d.at !== null) drop(d);
  };
  const onKey = (k: KeyboardEvent) => {
    if (k.key !== 'Escape') return;
    k.preventDefault();
    k.stopPropagation();
    stop();
    if (started) { swallowClick(); publish(null); }
  };
  window.addEventListener('mousemove', onMove, true);
  window.addEventListener('mouseup', onUp, true);
  window.addEventListener('keydown', onKey, true);
  return true;
}

/** Props for a drag-in source (R135); null: not a source. `draggable: false` keeps the browser's own drag away. */
export function pinDragSource(item: DragItem | null): { onMouseDown?: (e: React.MouseEvent) => void; draggable?: false; onDragStart?: (e: React.DragEvent) => void } {
  if (!item) return {};
  return {
    draggable: false,
    onDragStart: (e) => e.preventDefault(),
    onMouseDown: (e) => { startPinDrag(e.nativeEvent, item); },
  };
}

/** For sources outside React (editor chips): watch this press. Returns whether it took it. */
/** `onStart`: runs once the press becomes a drag (the editor forgets the press as a click then). */
export function startPinDrag(e: MouseEvent, item: DragItem | null, onStart?: () => void): boolean {
  if (!item) return false;
  // A target already pinned moves to the line (D-1379): its own row doesn't count for the position.
  const pinned = findPin(pinsNow(), item.request, tagOfFile);
  return press(e, item, null, (d) => {
    if (d.at === null) return;
    if (pinned !== null) void move(pinned, d.at);
    else void pinTarget(item.request, d.at, () => item.label);
  }, pinned, onStart);
}

/** A pinned row's press: reorders on a drop inside the section; a drop at its own place writes nothing (store.move). */
export function startRowDrag(e: React.MouseEvent, index: number, item: DragItem) {
  press(e, item, index, (d) => { if (d.at !== null) void move(index, d.at); });
}
