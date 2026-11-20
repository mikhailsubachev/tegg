// Slice Q (v1-queries §3.2, §4.2): the editor's query blocks (`EditorUi.query`): each fence is a React root drawing
// `QueryBlock` with the editor's `QueryCtl`; ⌘↩ on a selected block opens its editor (`onQueryKey`, R144). Slice Q2.1
// (v1-views §18, CP-16, D-1858): each reference block is a usage `block:<note key>/<name key>#<n>`, its `n` counted
// among the note's query blocks of the same query (document order, nested included), again whenever a block comes or
// goes.
import { createRoot } from 'react-dom/client';
import { savedName } from '@tegg/doc';
import type { EmbedHandle, QueryCtl } from '@tegg/editor';
import { blockOrdinal } from '../views/usage';
import { fenceBody, QueryBlock, type QueryBlockApi } from './QueryBlock';

export type QueryMountHost = {
  /** The host note's vault path (`this`, FR-QRY-03). */
  path: () => string;
  /** Removes a draft block without a history entry (`dropQueryDraft`, D-1471). */
  dropDraft: (pos: number) => void;
  /** Slice Q2.1: the host note's key parts (its frontmatter `id`, else its path). */
  note?: () => { id: string | null; path: string };
  /** Slice Q2.1: the block at `pos`'s place among the note's blocks of its query (1-based; null when unknown). */
  ordinal?: (pos: number) => number | null;
  /** Slice Q2.1: false where the block's fence can't be written as a usage (inside an embedded note, D-1839). */
  editable?: boolean;
};

type Mounted = { ctl: QueryCtl; api: { current: QueryBlockApi | null }; render: () => void };
const mounted = new Set<Mounted>();

let refreshQueued = false;
/** Blocks came or went: every block counts its place again (next microtask, once). */
function queueRefresh() {
  if (refreshQueued) return;
  refreshQueued = true;
  queueMicrotask(() => { refreshQueued = false; refreshQueryBlocks(); });
}

/** CP-16: the 1-based place of the block at `pos` among `blocks` (the editor's `queryBlocks()`) of the same query. */
export function ordinalAt(blocks: readonly { pos: number; source: string; draft: boolean }[], pos: number): number | null {
  const names = blocks.map((b) => (b.draft ? null : savedName(fenceBody(b.source))));
  const i = blocks.findIndex((b) => b.pos === pos);
  return i < 0 ? null : blockOrdinal(names, i);
}

/** A note head's `id:` value (R198's note key), null when it has none. */
export function frontmatterId(head: string): string | null {
  const m = /^id:[ \t]*(.*)$/m.exec(head.replace(/\r\n/g, '\n'));
  const v = m ? m[1].trim().replace(/^(['"])(.*)\1$/, '$2').trim() : '';
  return v ? v.normalize('NFC') : null;
}

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
    const body = fenceBody(src);
    const name = ctl.draft ? null : savedName(body);
    const pos = ctl.getPos();
    const n = name && pos !== undefined ? host.ordinal?.(pos) ?? 1 : 1;
    const note = host.note?.() ?? { id: null, path: host.path() };
    const usage = name ? { kind: 'block' as const, note, name, n: n ?? 1, editable: host.editable !== false } : null;
    root.render(<QueryBlock source={{ kind: 'fence', body }} host={host.path()} ctl={ctl} fenceSource={src} selected={selected}
      dropDraft={() => { const p = ctl.getPos(); if (p !== undefined) host.dropDraft(p); }} apiRef={entry.api} usage={usage} />);
  };
  render();
  queueRefresh();
  return {
    update(next) { if (next === src) { render(); return; } src = next; render(); },
    selected(on) { if (on === selected) return; selected = on; render(); },
    destroy() {
      if (!alive) return;
      alive = false;
      mounted.delete(entry);
      queueRefresh();
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

/** The host note was renamed (the page follows it, FR-SYN-03 AC-18), or blocks came or went: blocks read their host
 *  and their place again. */
export function refreshQueryBlocks() {
  for (const m of mounted) m.render();
}
