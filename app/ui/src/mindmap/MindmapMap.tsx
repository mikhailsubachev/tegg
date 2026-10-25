// Slice MM (docs/acceptance/mindmap.md R91, R92; D-681…D-684, D-770, D-774, D-775): the map of a mindmap block. Nodes
// are placed by `layoutMindmap` and drawn as boxes over SVG elbow connectors; their content is rendered by the caller
// (the read view's inline rendering, so chips look as everywhere else). A `tree` with one Tab stop and arrow keys.
import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { MindItem, MindmapTree } from '@tegg/doc';
import { t } from '../i18n/catalog';
import { ipc } from '../ipc/client';
import { layoutCount, layoutMindmap, type ChipExtra, type Measure, type MindLayoutNode } from './layout';

/** Map-area padding (R92): 12 px top and bottom, 16 px left and right. */
const PAD_X = 16;
const PAD_Y = 12;
/** What a chip adds to its text's width: icon, gap and padding (link chips, D-600). */
const CHIP_EXTRA = 30;

let canvas: HTMLCanvasElement | null = null;
/** The real measurer: the node font (13 px, the document's family) on a canvas, at the node's weight (R92). */
function realMeasure(): Measure {
  canvas ??= document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const family = getComputedStyle(document.body).fontFamily || 'system-ui';
  if (!ctx) return (s) => s.length * 7;
  const font = (depth = 2) => `${depth === 0 ? 650 : depth === 1 ? 600 : 400} 13px ${family}`;
  return (s, depth) => { ctx.font = font(depth); return ctx.measureText(s.normalize('NFC')).width; };
}

type Info = { item: MindItem | null; parent: string | null; index: number; size: number; path: number[] | null };

/** Each layout node's item, parent and position among its siblings. */
function infos(tree: MindmapTree): Map<string, Info> {
  const out = new Map<string, Info>();
  const walk = (it: MindItem, parent: string | null, index: number, size: number) => {
    const id = it.path.join('.');
    out.set(id, { item: it, parent, index, size, path: it.path });
    it.children.forEach((c, i) => walk(c, id, i, it.children.length));
  };
  if (tree.root.kind === 'item') walk(tree.root.item, null, 0, 1);
  else if (tree.root.kind === 'synthesized') {
    out.set('root', { item: null, parent: null, index: 0, size: 1, path: null });
    tree.items.forEach((c, i) => walk(c, 'root', i, tree.items.length));
  }
  return out;
}

/** The last layouts by content (the tree and its chips' suffixes); the measurer and the font don't change. */
const LAYOUTS = new Map<string, ReturnType<typeof layoutMindmap>>();
function layoutKey(tree: MindmapTree, chipSuffix?: (target: string) => string | null): string {
  const suffixes: (string | null)[] = [];
  if (chipSuffix) {
    const walk = (it: MindmapTree['items'][number]) => {
      for (const r of it.inline) if (r.k === 'link') suffixes.push(chipSuffix(r.target));
      it.children.forEach(walk);
    };
    tree.items.forEach(walk);
  }
  return JSON.stringify([tree, suffixes]);
}

export function MindmapMap({ tree, label, content, onNode, readOnly, chipSuffix }: {
  tree: MindmapTree;
  /** The tree's accessible name (`Map of <title>`). */
  label: string;
  /** A node's content: `root` (a synthesized root) or an item's path id. */
  content: (id: string) => ReactNode;
  /** A node click, ⏎ or Space (D-776); null for the synthesized root. Not called when `readOnly`. */
  onNode?: (path: number[] | null) => void;
  readOnly: boolean;
  /** A chip's suffix text (a task's `<due> · <status>`, D-600), so the layout leaves room for it. */
  chipSuffix?: (target: string) => string | null;
}) {
  const layout = useMemo(() => {
    // A re-created node view (a save redraws the document) or a re-render with the same content reuses the layout,
    // so only a change lays the map out again (FR-MMP-02 AC-6).
    const key = layoutKey(tree, chipSuffix);
    const hit = LAYOUTS.get(key);
    if (hit) return hit;
    const t0 = performance.now();
    const m = realMeasure();
    const extra: ChipExtra = (r) => {
      const s = r.k === 'link' ? chipSuffix?.(r.target) : null;
      return CHIP_EXTRA + (s ? m(s) + 16 : 0);
    };
    const l = layoutMindmap(tree, m, { chipExtra: extra });
    (window as unknown as { __TEGG_MINDMAP_LAYOUTS__?: number }).__TEGG_MINDMAP_LAYOUTS__ = layoutCount();
    if (l.nodes.length >= 100) void ipc.perfTimed('mindmap-layout', performance.now() - t0).catch(() => {}); // FR-MMP-02 AC-14 (mm-mindmap §4)
    LAYOUTS.set(key, l);
    if (LAYOUTS.size > 32) LAYOUTS.delete(LAYOUTS.keys().next().value!);
    return l;
  }, [tree, chipSuffix]);
  const info = useMemo(() => infos(tree), [tree]);
  const [focus, setFocus] = useState(layout.nodes[0]?.id ?? '');
  const box = useRef<HTMLDivElement | null>(null);
  const moved = useRef(false);
  useLayoutEffect(() => {
    if (!moved.current) return;
    moved.current = false;
    const el = box.current?.querySelector<HTMLElement>(`[data-node="${CSS.escape(focus)}"]`);
    el?.focus({ preventScroll: true });
    el?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [focus]);

  if (tree.root.kind === 'empty') {
    return readOnly ? null : (
      <button type="button" className="mindmap-empty" onMouseDown={(e) => e.preventDefault()} onClick={() => onNode?.([0])}>{t('mindmap.empty')}</button>
    );
  }
  const order = layout.nodes.map((n) => n.id);
  const ids = new Set(order);
  // The roving tab stop: the focused node, else the root (a map that was empty or lost its node).
  const stop = ids.has(focus) ? focus : order[0];
  const go = (id: string | null | undefined) => { if (id && ids.has(id)) { moved.current = true; setFocus(id); } };
  const activate = (id: string) => { if (!readOnly) onNode?.(info.get(id)?.path ?? null); };
  const openLink = (el: HTMLElement) => { el.querySelector<HTMLElement>('.chip, .embed-chip, a[href]')?.click(); };

  const onKey = (e: React.KeyboardEvent, n: MindLayoutNode) => {
    const i = order.indexOf(n.id);
    const firstChild = order.find((id) => info.get(id)?.parent === n.id);
    const k = e.key;
    if (k === 'ArrowDown') go(order[i + 1]);
    else if (k === 'ArrowUp') go(order[i - 1]);
    else if (k === 'ArrowRight') go(firstChild);
    else if (k === 'ArrowLeft') go(info.get(n.id)?.parent);
    else if (k === 'Home') go(order[0]);
    else if (k === 'End') go(order[order.length - 1]);
    else if (k === 'Enter' && (e.metaKey || e.ctrlKey)) openLink(e.currentTarget as HTMLElement);
    else if (k === 'Enter' || k === ' ') activate(n.id);
    else return;
    e.preventDefault();
    e.stopPropagation();
  };

  const width = layout.width + 2 * PAD_X;
  const height = layout.height + 2 * PAD_Y;
  return (
    <div ref={box} className="mindmap-canvas" style={{ width, height }}>
      <svg className="mindmap-lines" width={width} height={height} aria-hidden="true">
        {layout.connectors.map((c) => (
          <path key={`${c.from}>${c.to}`} data-from={c.from} data-to={c.to}
            d={c.points.map(([x, y], i) => `${i ? 'L' : 'M'}${x + PAD_X} ${y + PAD_Y}`).join(' ')} />
        ))}
      </svg>
      <div role="tree" aria-label={label} className="mindmap-tree">
        {layout.nodes.map((n) => {
          const it = info.get(n.id);
          const item = it?.item ?? null;
          const name = n.lines.join(' ');
          const desc = [item?.more ? t('mindmap.more') : null, item && item.checked !== null ? t(item.checked ? 'mindmap.checked' : 'mindmap.unchecked') : null].filter(Boolean).join(', ') || undefined;
          return (
            <div key={n.id} role="treeitem" data-node={n.id} data-tone={n.tone} aria-level={n.depth + 1} aria-setsize={it?.size ?? 1} aria-posinset={(it?.index ?? 0) + 1}
              aria-label={name} aria-description={desc} aria-selected={stop === n.id} tabIndex={stop === n.id ? 0 : -1}
              className={`mindmap-node tone-${n.tone}${n.lines.length === 1 ? ' one-line' : ''}`} style={{ left: n.x + PAD_X, top: n.y + PAD_Y, width: n.w, height: n.h }}
              onFocus={() => setFocus(n.id)}
              onMouseDown={(e) => { if (!(e.target as HTMLElement).closest('a, .chip, .embed-chip')) e.preventDefault(); }}
              onClick={(e) => { if (!(e.target as HTMLElement).closest('a, .chip, .embed-chip, .tag-chip')) activate(n.id); }}
              onKeyDown={(e) => onKey(e, n)}>
              {item && item.checked !== null && <span className={`mindmap-box${item.checked ? ' checked' : ''}`} data-checkbox="" data-checked={item.checked ? 'true' : 'false'} aria-hidden="true">{item.checked ? '✓' : ''}</span>}
              <span className="mindmap-text">{content(n.id)}{item?.more ? <span className="mindmap-more"> …</span> : null}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
