// Slice 6A (docs/contracts/ms6-trash-media.md §6.1, §6.2): mounts a file embed's view into the editor's block DOM
// (`EditorUi.media`); it re-renders when the page's links resolve again (a file trashed, restored or added).
import { createRoot } from 'react-dom/client';
import { linkTarget, type EmbedHandle, type LinkInfo } from '@tegg/editor';
import { MediaView } from './MediaView';

export function mountMedia(dom: HTMLElement, source: string, info: (target: string) => LinkInfo | undefined, onOpen: (p: string) => void, views: Set<() => void>): EmbedHandle {
  const container = document.createElement('div');
  container.className = 'media-root';
  dom.appendChild(container);
  const root = createRoot(container);
  let src = source;
  const render = () => {
    const target = linkTarget(src.trim().replace(/^!\[\[|\]\]$/g, '')).target.normalize('NFC');
    const i = info(target);
    root.render(<MediaView target={target} info={i ? { kind: i.kind, path: i.path ?? null, title: i.title ?? null, type: i.type ?? null, object: i.object ?? null } as never : null} onOpen={onOpen} />);
  };
  views.add(render);
  render();
  return {
    update(next: string) { src = next; render(); },
    selected() {},
    destroy() { views.delete(render); setTimeout(() => root.unmount(), 0); container.remove(); },
  };
}
