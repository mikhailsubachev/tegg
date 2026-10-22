// D-606 (FR-EDT-02 AC-22): a table the editor can't edit losslessly, rendered read-only by the read view's rules into
// the editor's raw block. Its links are resolved once (one `link_resolve` for the table's targets).
import { createRoot } from 'react-dom/client';
import { ipc } from '../ipc/client';
import type { LinkTargetDto } from '../ipc/types';
import { linkTargets, ReadView } from '../read/ReadView';

export type TableHost = { path: string; onOpen: (path: string, fragment?: string) => void; onTag: (key: string) => void; onExternal: (url: string) => void };

export function mountReadOnlyTable(markdown: string, dom: HTMLElement, host: TableHost): { destroy(): void } {
  const box = document.createElement('div');
  box.className = 'table-readonly';
  dom.appendChild(box);
  const root = createRoot(box);
  let alive = true;
  const render = (links: Map<string, LinkTargetDto>) => {
    if (!alive) return;
    root.render(<ReadView text={`${markdown}\n`} path={host.path} links={links} bare onOpen={host.onOpen} onTag={host.onTag} onExternal={host.onExternal} onScrollInNote={(f) => host.onOpen(host.path, f)} />);
  };
  render(new Map());
  const targets = linkTargets(markdown);
  if (targets.length) void ipc.linkResolve(host.path, targets).then((r) => render(new Map(r.map((x) => [x.target, x])))).catch(() => {});
  return { destroy() { alive = false; queueMicrotask(() => root.unmount()); } };
}
