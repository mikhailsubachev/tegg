// Slice Q (v1-queries §3.2, §4.2): the editor's query blocks (`EditorUi.query`): each fence is a React root drawing
// `QueryBlock` with the editor's `QueryCtl`; ⌘↩ on a selected block opens its editor (`onQueryKey`, R144).
import { createRoot } from 'react-dom/client';
import type { EmbedHandle, QueryCtl } from '@tegg/editor';
import { fenceBody, QueryBlock, type QueryBlockApi } from './QueryBlock';

export type QueryMountHost = {
  /** The host note's vault path (`this`, FR-QRY-03). */
  path: () => string;
  /** Removes a draft block without a history entry (`dropQueryDraft`, D-1471). */
  dropDraft: (pos: number) => void;
};

type Mounted = { ctl: QueryCtl; api: { current: QueryBlockApi | null }; render: () => void };
const mounted = new Set<Mounted>();

export function mountQueryBlock(source: string, dom: HTMLElement, ctl: QueryCtl, host: QueryMountHost): EmbedHandle {
  const box = document.createElement('div');
  box.className = 'query-mount';
  dom.appendChild(box);
  const root = createRoot(box);
  let src = source;
  let selected = false;
  let alive = true;
  const entry: Mounted = { ctl, api: { current: null }, render: () => render() };
  mounted.add(entry);
  const render = () => {
    if (!alive) return;
    root.render(<QueryBlock source={{ kind: 'fence', body: fenceBody(src) }} host={host.path()} ctl={ctl} fenceSource={src} selected={selected}
      dropDraft={() => { const p = ctl.getPos(); if (p !== undefined) host.dropDraft(p); }} apiRef={entry.api} />);
  };
  render();
  return {
    update(next) { if (next === src) { render(); return; } src = next; render(); },
    selected(on) { if (on === selected) return; selected = on; render(); },
    destroy() {
      if (!alive) return;
      alive = false;
      mounted.delete(entry);
      queueMicrotask(() => root.unmount());
    },
  };
}

/** ⌘↩ on the selected block at `pos`: its editor opens. */
export function openQueryBlockAt(pos: number): boolean {
  for (const m of mounted) {
    if (m.ctl.getPos() === pos && m.api.current) { m.api.current.edit({ anchor: null, returnFocus: null }); return true; }
  }
  return false;
}

/** The host note was renamed (the page follows it, FR-SYN-03 AC-18): blocks read their host again. */
export function refreshQueryBlocks() {
  for (const m of mounted) m.render();
}
