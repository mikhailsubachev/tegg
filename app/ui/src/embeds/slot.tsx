// A block embed inside an editor (ms4-embeds §6, §7): `EditorUi.embed` mounts a React root in the node view and
// renders the embed's tree node there, with the nested editor when it is editable (D-421).
//
// ProseMirror rebuilds every node view when the document's attributes change (the host's frontmatter after each save),
// so a destroyed embed is parked for a moment and moved into the next node view for the same source: the nested
// editor keeps its text, its pending save and its undo history (FR-EMB-03 AC-6).
import { createRoot, type Root } from 'react-dom/client';
import { useRef, useSyncExternalStore } from 'react';
import { embedParts, type EmbedMode } from '@tegg/doc';
import type { EmbedHandle } from '@tegg/editor';
import { t } from '../i18n/catalog';
import type { TypeDto } from '../ipc/types';
import { Embed } from './Embed';
import { EmbedEditor } from './EmbedEditor';
import type { EmbedStore } from './store';
import { embedModeFor, type EmbedNode } from './tree';

const nfc = (s: string) => s.normalize('NFC');
const innerOf = (source: string) => source.trim().replace(/^!\[\[|\]\]$/g, '');

/** Which tree node a block embed shows: the k-th block embed with the same text in the editor. */
type Pick = (value: string, k: number) => EmbedNode | null;
type Props = { source: string; getPos: () => number | undefined; selected: boolean };

function Slot({ store, container, props, pick }: { store: EmbedStore; container: HTMLElement; props: Props; pick: Pick }) {
  useSyncExternalStore(store.subscribe, store.getSnapshot);
  const { source, getPos, selected } = props;
  const value = innerOf(source);
  // The k-th block embed with this text in the editor (DOM order is document order).
  const dom = container.parentElement;
  const root = dom?.parentElement;
  const same = root && dom ? [...root.children].filter((e) => e.classList.contains('embed-block') && (e as HTMLElement).dataset.embedSource === nfc(source)) : [];
  const k = dom ? Math.max(0, same.indexOf(dom)) : 0;
  const picked = pick(value, k);
  // FR-EMB-03 AC-4: an edited embed whose file was deleted outside Tegg keeps its editor and asks.
  const last = useRef<EmbedNode | null>(null);
  let node = picked;
  let gone = false;
  if (picked && picked.state === 'broken' && last.current?.note && picked.target.target === last.current.target.target && store.dirtyAt(last.current.note.path)) {
    node = last.current;
    gone = true;
  }
  if (!node) return null;
  if (!gone && node.state === 'ok' && node.mode === 'full' && node.note) last.current = node;
  const editable = store.editable && node.depth === 1 && node.mode === 'full' && node.state === 'ok' && !node.readOnly && !!node.note;
  const title = node.target.title ?? node.target.target;
  const onMode = (m: EmbedMode) => {
    const pos = getPos();
    if (pos === undefined) return;
    // D-416: choosing the type's default removes the keyword.
    const def = embedModeFor(embedParts(value).target, node.target.type, store.types as TypeDto[], false);
    store.host?.setMode(pos, m === def ? null : m);
  };
  return (
    <div className="embed-slot" data-selected={selected ? '' : undefined}>
      <Embed
        node={node}
        host={store.path}
        editable={editable}
        modeDisabled={store.editable && node.depth === 1 && getPos() !== undefined ? null : t('embed.cantEdit')}
        onOpen={(p, f) => store.host?.onOpen(p, f)}
        onTag={(k2) => store.host?.onTag(k2)}
        onExternal={(u) => store.host?.onExternal(u)}
        onMode={onMode}
        body={editable ? <EmbedEditor key={`${node.note!.path}#${node.subpath ?? ''}`} node={node} store={store} getPos={getPos} title={title} gone={gone} /> : undefined}
      />
    </div>
  );
}

type Live = { source: string; container: HTMLDivElement; root: Root; props: Props; render(): void; timer: ReturnType<typeof setTimeout> | null };
const parked = new WeakMap<EmbedStore, Live[]>();

/** Mounts the embed for `source` into `dom` (the editor's node view). `pick` defaults to the host's block embeds. */
export function mountEmbed(store: EmbedStore, source: string, dom: HTMLElement, getPos: () => number | undefined, pick?: Pick): EmbedHandle {
  dom.dataset.embedSource = nfc(source);
  const choose: Pick = pick ?? ((value, k) => store.blockNodes(value)[k] ?? null);
  // A parked embed of the same source (the node view was rebuilt): move it here.
  const list = pick ? null : (parked.get(store) ?? []);
  const i = list ? list.findIndex((l) => nfc(l.source) === nfc(source)) : -1;
  let live: Live;
  if (list && i >= 0) {
    live = list.splice(i, 1)[0];
    if (live.timer) clearTimeout(live.timer);
    live.timer = null;
    live.props = { source, getPos, selected: false };
    dom.appendChild(live.container);
    live.render();
  } else {
    const container = document.createElement('div');
    container.className = 'embed-root';
    dom.appendChild(container);
    const root = createRoot(container);
    live = {
      source, container, root, props: { source, getPos, selected: false }, timer: null,
      render() { root.render(<Slot store={store} container={container} props={live.props} pick={choose} />); },
    };
    live.render();
  }
  let active = true;
  return {
    update(next) {
      if (!active || next === live.props.source) return;
      live.props = { ...live.props, source: next };
      live.source = next;
      dom.dataset.embedSource = nfc(next);
      live.render();
    },
    selected(on) {
      if (!active) return;
      live.props = { ...live.props, selected: on };
      live.render();
    },
    destroy() {
      if (!active) return;
      active = false;
      if (pick) {
        // Read-only nested embeds: unmount outside ProseMirror's update.
        queueMicrotask(() => live.root.unmount());
        return;
      }
      const l = parked.get(store) ?? [];
      parked.set(store, l);
      l.push(live);
      live.timer = setTimeout(() => {
        const at = l.indexOf(live);
        if (at >= 0) l.splice(at, 1);
        live.root.unmount();
        live.container.remove();
      }, 0);
    },
  };
}
