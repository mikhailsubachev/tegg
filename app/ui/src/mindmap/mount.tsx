// Slice MM (mm-mindmap §3.3): the map of an editor mindmap block, drawn by a bare read view of the block's Markdown,
// so nodes show their chips as the read view does. Re-drawn live while the list is edited, at most once per 150 ms
// (D-776); links are resolved as in a read-only table.
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import type { EditorUi, MindmapCtl, MindmapHandle } from '@tegg/editor';
import { t } from '../i18n/catalog';
import { iconElement } from '../shell/Icon';
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
  let shownView = '';
  const draw = (sync = false) => {
    if (!alive) return;
    last = performance.now();
    shownView = `${ctl.view()}${ctl.folded?.() ? '-folded' : ''}`;
    if (sync) { flushSync(() => draw(false)); return; }
    if (ctl.folded?.()) { root.render(null); return; }
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
      if (!alive) return;
      // A view switch draws at once (the tree must be current when it takes the focus); edits at most every 150 ms.
      if (`${ctl.view()}${ctl.folded?.() ? '-folded' : ''}` !== shownView) { if (timer) { clearTimeout(timer); timer = null; } draw(true); return; }
      if (timer) return;
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

/** D-776: each mindmap block's view while the app runs (`<note path>#<block index>`); never written. */
const viewState = new Map<string, 'map' | 'list'>();
/** Another vault: every mindmap opens in Map again (FR-MMP-02 AC-7). */
export function resetMindmapViews(): void {
  viewState.clear();
}

/** The mindmap part of an editor's `EditorUi` (mm-mindmap §3.3): the map, its texts, icon and view state. */
export function mindmapUi(host: MindmapHost): Pick<EditorUi, 'mindmap' | 'mindmapState' | 'mindmapText' | 'mindmapIcon'> {
  return {
    mindmap: (dom, ctl) => mountMindmap(dom, ctl, host),
    mindmapState: { get: (k) => viewState.get(`${host.path()}#${k}`), set: (k, v) => { viewState.set(`${host.path()}#${k}`, v); } },
    mindmapText: (k, title) => (k === 'figure' ? t('mindmap.figure', { title: title ?? '' }) : k === 'expand' || k === 'collapse' ? t(k === 'expand' ? 'callout.expand' : 'callout.collapse', { title: title ?? '' }) : t(`mindmap.${k}`)),
    mindmapIcon: () => iconElement('mindmap', 15, 'mindmap'),
  };
}
