// The views' perf marks (docs/contracts/v1-views.md §42.5, D-1800, D-2185, D-2226): `board-request` / `rows-request` when a
// view tab, `All <plural>` or a `query/<name>` page is asked for, by its effective display; `rows-ready` two frames after
// a Table or List first drew its rows and headers (a wall marks `board-ready` itself, WallGrid / QueryBoard).
import { useEffect, useRef } from 'react';
import { ipc } from '../ipc/client';

export type MarkDisplay = 'table' | 'list' | 'wall' | 'board' | null | undefined;

/** The request mark of a display: `board-request` for a wall (`board` is its old word), `rows-request` for a Table or List. */
export function requestMark(kind: MarkDisplay) {
  if (kind === 'wall' || kind === 'board') void ipc.perfMark('board-request').catch(() => {});
  else if (kind === 'table' || kind === 'list') void ipc.perfMark('rows-request').catch(() => {});
}

/** `rows-ready` once per `key` (a panel, a page), two frames after `drawn` first holds; a null key resets. */
export function useRowsReady(drawn: boolean, key: string | null) {
  const marked = useRef<string | null>(null);
  useEffect(() => {
    if (key === null) { marked.current = null; return; }
    if (!drawn || marked.current === key) return;
    let a = 0, b = 0;
    a = requestAnimationFrame(() => {
      b = requestAnimationFrame(() => {
        if (marked.current === key) return;
        marked.current = key;
        void ipc.perfMark('rows-ready').catch(() => {});
      });
    });
    return () => { cancelAnimationFrame(a); cancelAnimationFrame(b); };
  }, [drawn, key]);
}
