// Slice G1 (docs/contracts/v1-graph.md §4; graph.md R108, R109, R113; ADR 0004): the SVG canvas of the full view: one
// `<g data-graph-node>` per node and one `<line data-graph-edge>` per edge, zoom and pan (D-985), the selection and
// hover highlight (D-983). Positions come from `layout.ts`; this component only draws them. G3 (v1-graph §16.3, §16.5):
// roving focus (one node with `tabindex="0"`, the centre by default, AP-935), the `--focus` ring (`:focus-visible`),
// the hover ring `[data-hover-ring]` filling over the delay (AP-942), the accessible descriptions (R121) and one
// `keydown` listener that hands the keys to the page.
import { useMemo, useRef, useState } from 'react';
import { chipIcon, chipTypes, typeNameOf } from '../links/icons';
import { Icon } from '../shell/Icon';
import { displayTitle, labelVisible, typeColour, sortKey, type GraphModel, type ModelNode, type NodeKey } from './graphModel';
import type { Point } from './layout';
import type { EdgeKindDto } from './types';

/** R108 lines (D-902): width and dash per style. */
const LINE: Record<EdgeKindDto, { width: number; dash?: string }> = {
  embed: { width: 3 }, relation: { width: 1.5, dash: '5 4' }, link: { width: 1.5 }, tag: { width: 1, dash: '1 3' },
};
const TAG_COLORS = new Set(['gray', 'blue', 'green', 'orange', 'purple', 'red', 'teal', 'yellow']);
const LABEL_MAX = 150;

export type View = { zoom: number; panX: number; panY: number };

const colourOf = (typeKey: string) => typeColour(typeKey, chipTypes());

let measure: CanvasRenderingContext2D | null = null;
let family: string | null = null;
const cuts = new Map<string, string>();
/** D-985: a label cut at 150 px with `…` (the full title stays in the accessible name); remembered per text and font. */
function cut(text: string, px: number, weight: string): string {
  if (typeof document === 'undefined') return text;
  const key = `${weight}|${px}|${text}`;
  const known = cuts.get(key);
  if (known !== undefined) return known;
  const out = cutNow(text, px, weight);
  if (cuts.size > 5000) cuts.clear();
  cuts.set(key, out);
  return out;
}
function cutNow(text: string, px: number, weight: string): string {
  measure ??= document.createElement('canvas').getContext('2d');
  if (!measure) return text;
  family ??= getComputedStyle(document.body).fontFamily || 'sans-serif';
  measure.font = `${weight} ${px}px ${family}`;
  if (measure.measureText(text).width <= LABEL_MAX - 2) return text;
  const chars = [...text];
  let lo = 0, hi = chars.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (measure.measureText(`${chars.slice(0, mid).join('').trimEnd()}…`).width <= LABEL_MAX - 6) lo = mid; else hi = mid - 1;
  }
  return `${chars.slice(0, lo).join('').trimEnd()}…`;
}

/** Half the width and height of a node's shape (a circle, or a tag's pill), for panning it into view (R120). */
export function shapeHalf(n: ModelNode): { w: number; h: number } {
  // With half the outline's width (1.5 px, the centre's 3 px): the shape as drawn.
  if (n.node.typeKey === 'tag') return { w: Math.min(LABEL_MAX, 16 + 7.2 * [...`#${n.node.title}`].length) / 2 + 0.75, h: 13.75 };
  const r = n.size / 2 + (n.centre ? 1.5 : 0.75);
  return { w: r, h: r };
}

/** A node's box with its label at 100 %: width, and extent above and below its centre (for Fit, D-985). */
export function nodeBox(n: ModelNode): { w: number; top: number; bottom: number } {
  if (n.node.typeKey === 'tag') {
    const w = Math.min(LABEL_MAX, 16 + 7.2 * [...`#${n.node.title}`].length) + 8;
    return { w, top: 17, bottom: 17 };
  }
  const r = n.size / 2 + 4;
  const fontSize = n.centre ? 14 : n.node.depth === 1 ? 12 : 11;
  measure ??= typeof document !== 'undefined' ? document.createElement('canvas').getContext('2d') : null;
  let lw = LABEL_MAX;
  if (measure) {
    family ??= getComputedStyle(document.body).fontFamily || 'sans-serif';
    measure.font = `${n.centre ? 650 : 400} ${fontSize}px ${family}`;
    lw = Math.min(LABEL_MAX, measure.measureText(n.node.title).width);
  }
  return { w: Math.max(2 * r, lw + 4), top: r, bottom: n.size / 2 + 7 + fontSize * 1.4 };
}

const TABBABLE = 'a[href], button, input, select, textarea, [tabindex]';
/** The first tab stop after (or before) `svg` in document order. */
function tabNeighbour(svg: Element, back: boolean): HTMLElement | null {
  const all = [...document.querySelectorAll<HTMLElement>(TABBABLE)].filter((e) => {
    if (svg.contains(e) || e.tabIndex < 0 || (e as HTMLButtonElement).disabled) return false;
    const r = e.getBoundingClientRect();
    return r.width > 0 || r.height > 0;
  });
  const after = all.filter((e) => !!(svg.compareDocumentPosition(e) & Node.DOCUMENT_POSITION_FOLLOWING));
  const before = all.filter((e) => !!(svg.compareDocumentPosition(e) & Node.DOCUMENT_POSITION_PRECEDING));
  return back ? before[before.length - 1] ?? null : after[0] ?? null;
}

export type CanvasProps = {
  model: GraphModel;
  positions: Map<NodeKey, Point>;
  size: { width: number; height: number };
  view: View;
  onView: (v: View) => void;
  selected: NodeKey | null;
  hovered: NodeKey | null;
  onHover: (k: NodeKey | null) => void;
  /** A click on a node; the page decides by the Object preview setting (R120). */
  onNodeClick: (n: ModelNode, el: Element, e: React.MouseEvent) => void;
  onOpen: (n: ModelNode) => void;
  onEmpty: () => void;
  /** A pan started (it hides a hover preview, AP-941). */
  onPan: () => void;
  name: string;
  /** R121: the canvas's description (`graph.canvas.help`) and each node's. */
  help: string;
  describe: (n: ModelNode) => string;
  /** The node with the tab stop (null: the centre) and its changes; null on focus leaving the canvas (AP-935). */
  focusKey: NodeKey | null;
  onFocusKey: (k: NodeKey | null) => void;
  onKey: (e: React.KeyboardEvent, n: ModelNode, el: SVGGElement) => void;
  /** The pointer over a node, for the hover controller (`over` false: it left). */
  onNodePointer: (n: ModelNode, over: boolean) => void;
  /** The node showing the hover ring and the ring's run time (ms, the hover delay). `ringSeq` restarts it. */
  ring: { key: NodeKey; ms: number; seq: number } | null;
  /** Nodes added by a live update or a filter change fade in (D-992). */
  entering: Set<NodeKey>;
  contentRef: React.RefObject<SVGGElement | null>;
};

export function GraphCanvas(p: CanvasProps) {
  const { model, positions, size, view } = p;
  const drag = useRef<{ x: number; y: number; panX: number; panY: number; moved: boolean } | null>(null);
  const [, setTick] = useState(0);
  const focus = p.hovered ?? p.selected;
  const near = useMemo(() => {
    if (!focus) return null;
    const node = model.nodes.find((n) => n.key === focus);
    if (!node) return null;
    const keys = new Set<string>([node.sortKey]);
    for (const e of model.edges) {
      if (sortKey(e.a) === node.sortKey) keys.add(sortKey(e.b));
      if (sortKey(e.b) === node.sortKey) keys.add(sortKey(e.a));
    }
    return { sort: node.sortKey, keys };
  }, [focus, model]);
  const bySort = useMemo(() => new Map(model.nodes.map((n) => [n.sortKey, n])), [model]);
  const drawn = model.nodes.length;
  const tx = size.width / 2 + view.panX, ty = size.height / 2 + view.panY;
  const stop = p.focusKey && bySort.size && model.nodes.some((n) => n.key === p.focusKey) ? p.focusKey : model.centre;

  return (
    <svg className="graph-svg" role="group" aria-label={p.name} aria-description={p.help} width={size.width} height={size.height}
      onKeyDown={(e) => {
        e.currentTarget.removeAttribute('data-pointer');
        // WebKit finds no next element after a focused SVG `<g>`: Tab and ⇧Tab leave the canvas here (AP-935).
        if (e.key === 'Tab' && !e.metaKey && !e.ctrlKey && !e.altKey) {
          const next = tabNeighbour(e.currentTarget, e.shiftKey);
          if (next) { e.preventDefault(); next.focus(); }
          return;
        }
        const el = (e.target as Element).closest('[data-graph-node]') as SVGGElement | null;
        const n = el && model.nodes.find((x) => x.key === el.getAttribute('data-node-key'));
        if (el && n) p.onKey(e, n, el);
      }}
      onBlur={(e) => { const to = e.relatedTarget as Node | null; if (to && !e.currentTarget.contains(to)) p.onFocusKey(null); }}
      onPointerDown={(e) => {
        // Pointer input hides the focus ring until the next key (FR-UX-08 AC-3: `:focus-visible` only).
        e.currentTarget.setAttribute('data-pointer', '');
        if ((e.target as Element).closest('[data-graph-node]')) return;
        drag.current = { x: e.clientX, y: e.clientY, panX: view.panX, panY: view.panY, moved: false };
        (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d) return;
        const dx = e.clientX - d.x, dy = e.clientY - d.y;
        if (!d.moved && Math.hypot(dx, dy) < 3) return;
        if (!d.moved) p.onPan();
        d.moved = true;
        p.onView({ ...view, panX: d.panX + dx, panY: d.panY + dy });
      }}
      onPointerUp={() => {
        const d = drag.current;
        drag.current = null;
        if (d && !d.moved) p.onEmpty();
        setTick((n) => n + 1);
      }}>
      <defs>
        <pattern id="graph-dots" width="16" height="16" patternUnits="userSpaceOnUse">
          <circle cx="1" cy="1" r="1" className="graph-dot" />
        </pattern>
      </defs>
      <rect className="graph-bg" x={0} y={0} width={size.width} height={size.height} />
      <rect className="graph-grid" x={0} y={0} width={size.width} height={size.height} fill="url(#graph-dots)" />
      <g ref={p.contentRef} transform={`translate(${tx} ${ty}) scale(${view.zoom})`}>
        <g className="graph-edges">
          {model.edges.map((e) => {
            const a = bySort.get(sortKey(e.a)), b = bySort.get(sortKey(e.b));
            const pa = a && positions.get(a.key), pb = b && positions.get(b.key);
            if (!a || !b || !pa || !pb) return null;
            const touches = !!near && (a.sortKey === near.sort || b.sortKey === near.sort);
            const line = LINE[e.style];
            const kinds = [...new Set(e.ways.map((w) => w.kind))].join(' ');
            return (
              <line key={`${a.sortKey}|${b.sortKey}`} data-graph-edge="" data-a={a.sortKey} data-b={b.sortKey} data-kinds={kinds} data-style={e.style}
                x1={pa.x} y1={pa.y} x2={pb.x} y2={pb.y}
                className={`graph-edge${touches ? ' hl' : ''}`}
                style={{ strokeWidth: line.width, strokeDasharray: line.dash ?? 'none', opacity: near && !touches ? 0.35 : 1 }} />
            );
          })}
        </g>
        <g className="graph-nodes">
          {model.nodes.map((n) => {
            const pos = positions.get(n.key);
            if (!pos) return null;
            const isTag = n.node.typeKey === 'tag';
            const dim = !!near && !near.keys.has(n.sortKey);
            const selected = p.selected === n.key;
            const ring = p.ring && p.ring.key === n.key ? p.ring : null;
            const showLabel = labelVisible({ drawn, zoom: view.zoom, centre: n.centre, selected, hovered: p.hovered === n.key });
            const typeName = typeNameOf(n.node.typeKey);
            const common = {
              'data-graph-node': '', 'data-type': n.node.typeKey, 'data-depth': n.node.depth, 'data-size-step': n.step,
              'data-selected': selected ? 'true' : undefined, 'data-user-content': '', 'data-node-key': n.key, tabIndex: n.key === stop ? 0 : -1, role: 'img',
              'aria-label': `${displayTitle(n.node)}, ${typeName}`, 'aria-description': p.describe(n),
              className: `graph-node${n.centre ? ' centre' : ''}${p.entering.has(n.key) ? ' graph-enter' : ''}`,
              transform: `translate(${pos.x} ${pos.y})`, style: { opacity: dim ? 0.3 : 1 },
              onPointerEnter: () => { p.onHover(n.key); p.onNodePointer(n, true); },
              onPointerMove: () => p.onNodePointer(n, true),
              onPointerLeave: () => { p.onHover(null); p.onNodePointer(n, false); },
              onFocus: () => p.onFocusKey(n.key),
              onClick: (e: React.MouseEvent<SVGGElement>) => { e.stopPropagation(); p.onNodeClick(n, e.currentTarget, e); },
              onDoubleClick: (e: React.MouseEvent) => { e.stopPropagation(); p.onOpen(n); },
            } as const;
            if (isTag) {
              const c = n.node.color && TAG_COLORS.has(n.node.color) ? n.node.color : null;
              const text = `#${n.node.title}`;
              const w = Math.min(LABEL_MAX, 16 + 7.2 * [...text].length);
              return (
                <g key={n.key} {...common} data-tag-key={n.node.tagKey ?? ''} data-path={undefined}>
                  <rect x={-w / 2} y={-13} width={w} height={26} rx={13} className="graph-pill" style={{ fill: c ? `var(--type-${c}-bg)` : 'var(--hover)', stroke: c ? `var(--type-${c})` : 'var(--muted)' }} />
                  {selected && <rect x={-w / 2 - 4} y={-17} width={w + 8} height={34} rx={17} className="graph-ring" />}
                  <rect x={-w / 2 - 5.5} y={-18.5} width={w + 11} height={37} rx={18.5} className="graph-focus-ring" />
                  {ring && <rect key={ring.seq} data-hover-ring="" x={-w / 2 - 5.25} y={-18.25} width={w + 10.5} height={36.5} rx={18.25} pathLength={100} className="graph-hover-ring" style={{ animationDuration: `${ring.ms}ms` }} />}
                  <text className="graph-pill-text" textAnchor="middle" dominantBaseline="central" style={{ fill: c ? `var(--type-${c})` : 'var(--muted)' }}>{cut(text, 12, '600')}</text>
                </g>
              );
            }
            const colour = colourOf(n.node.typeKey);
            const r = n.size / 2;
            const icon = chipIcon(n.node.typeKey);
            const fontSize = n.centre ? 14 : n.node.depth === 1 ? 12 : 11;
            const iconSize = n.centre ? 24 : 16;
            return (
              <g key={n.key} {...common} data-path={n.node.path ?? undefined}>
                <circle r={r} className="graph-circle" style={{ fill: `var(--type-${colour}-bg)`, stroke: `var(--type-${colour})`, strokeWidth: n.centre ? 3 : 1.5 }} />
                {selected && <circle r={r + 4} className="graph-ring" />}
                <circle r={r + 5.5} className="graph-focus-ring" />
                {ring && <circle key={ring.seq} data-hover-ring="" r={r + 6.25} pathLength={100} transform="rotate(-90)" className="graph-hover-ring" style={{ animationDuration: `${ring.ms}ms` }} />}
                <g transform={`translate(${-iconSize / 2} ${-iconSize / 2})`} style={{ color: `var(--type-${colour})` }}>
                  <Icon name={icon.glyph} dataIcon={icon.def} size={iconSize} />
                </g>
                <text className={`graph-label${n.centre ? ' centre' : ''}`} y={r + 7} textAnchor="middle" dominantBaseline="hanging"
                  style={{ fontSize, fontWeight: n.centre ? 650 : 400, display: showLabel ? undefined : 'none' }}>
                  {cut(n.node.title, fontSize, n.centre ? '650' : '400')}
                </text>
              </g>
            );
          })}
        </g>
      </g>
    </svg>
  );
}
