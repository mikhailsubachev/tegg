// Slice MM (mm-mindmap §3.3): the map of an editor mindmap block, drawn by a bare read view of the block's Markdown,
// so nodes show their chips as the read view does. Re-drawn live while the list is edited, at most once per 150 ms
// (D-776); links are resolved as in a read-only table.
import { createRoot } from 'react-dom/client';
import type { MindmapCtl, MindmapHandle } from '@tegg/editor';
import { wikilinks, parse } from '@tegg/doc';
import { ipc } from '../ipc/client';
import type { LinkTargetDto } from '../ipc/types';
import { ReadView } from '../read/ReadView';

export type MindmapHost = {
  path: () => string;
  title: () => string;
  onOpen: (path: string, fragment?: string) => void;
  onTag: (key: string) => void;
  onExternal: (url: string) => void;
};

const LIVE_MS = 150;

export function mountMindmap(dom: HTMLElement, ctl: MindmapCtl, host: MindmapHost): MindmapHandle {
  const box = document.createElement('div');
  box.className = 'mindmap-mount';
  dom.appendChild(box);
  const root = createRoot(box);
  let alive = true;
  let links = new Map<string, LinkTargetDto>();
  let targetsKey = '';
  let timer: ReturnType<typeof setTimeout> | null = null;
  let last = 0;
  const draw = () => {
    if (!alive) return;
    last = performance.now();
    const md = ctl.markdown();
    root.render(<ReadView text={`${md}\n`} path={host.path()} links={links} bare noteTitle={host.title()}
      mindmapOnly={{ onNode: ctl.onNode, readOnly: ctl.readOnly }}
      onOpen={host.onOpen} onTag={host.onTag} onExternal={host.onExternal} onScrollInNote={(f) => host.onOpen(host.path(), f)} />);
    const targets = [...new Set(wikilinks(parse(`${md}\n`)).map((l) => l.target))].sort();
    const key = targets.join('\u0000');
    if (key !== targetsKey) {
      targetsKey = key;
      if (targets.length) void ipc.linkResolve(host.path(), targets).then((r) => { links = new Map(r.map((x) => [x.target, x])); draw(); }).catch(() => {});
    }
  };
  draw();
  return {
    update() {
      if (!alive || timer) return;
      const wait = Math.max(0, LIVE_MS - (performance.now() - last));
      timer = setTimeout(() => { timer = null; draw(); }, wait);
    },
    focusTree() {
      box.querySelector<HTMLElement>('[role="treeitem"][tabindex="0"]')?.focus();
    },
    destroy() {
      alive = false;
      if (timer) clearTimeout(timer);
      queueMicrotask(() => root.unmount());
    },
  };
}
