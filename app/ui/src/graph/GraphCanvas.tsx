// Slice G1 (docs/contracts/v1-graph.md §4; graph.md R108, R109, R113; ADR 0004): the SVG canvas of the full view: one
// `<g data-graph-node>` per node and one `<line data-graph-edge>` per edge, zoom and pan (D-985), the selection and
// hover highlight (D-983). Positions come from `layout.ts`; this component only draws them.
import { useMemo, useRef, useState } from 'react';
import { chipIcon, chipTypes, typeNameOf } from '../links/icons';
import { Icon } from '../shell/Icon';
import { displayTitle, labelVisible, sortKey, type GraphModel, type ModelNode, type NodeKey } from './graphModel';
import type { Point } from './layout';
import type { EdgeKindDto } from './types';

/** R108 lines (D-902): width and dash per style. */
const LINE: Record<EdgeKindDto, { width: number; dash?: string }> = {
  embed: { width: 3 }, relation: { width: 1.5, dash: '5 4' }, link: { width: 1.5 }, tag: { width: 1, dash: '1 3' },
};
const TAG_COLORS = new Set(['gray', 'blue', 'green', 'orange', 'purple', 'red', 'teal', 'yellow']);
const SYSTEM_COLOR: Record<string, string> = { page: 'gray', task: 'blue', 'quick-note': 'yellow', 'daily-note': 'purple', image: 'teal', pdf: 'red' };
const LABEL_MAX = 150;

export type View = { zoom: number; panX: number; panY: number };

function colourOf(typeKey: string): string {
  const def = chipTypes().find((x) => x.key.normalize('NFC') === typeKey.normalize('NFC'));
  const c = def?.color ?? SYSTEM_COLOR[typeKey];
  return c && TAG_COLORS.has(c) ? c : 'gray';
}

let measure: CanvasRenderingContext2D | null = null;
/** D-985: a label cut at 150 px with `…` (the full title stays in the accessible name). */
function cut(text: string, px: number, weight: string): string {
  if (typeof document === 'undefined') return text;
  measure ??= document.createElement('canvas').getContext('2d');
  if (!measure) return text;
  const family = getComputedStyle(document.body).fontFamily || 'sans-serif';
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
    measure.font = `${n.centre ? 650 : 400} ${fontSize}px ${getComputedStyle(document.body).fontFamily || 'sans-serif'}`;
    lw = Math.min(LABEL_MAX, measure.measureText(n.node.title).width);
  }
  return { w: Math.max(2 * r, lw + 4), top: r, bottom: n.size / 2 + 7 + fontSize * 1.4 };
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
  onSelect: (n: ModelNode, el: Element) => void;
  onOpen: (n: ModelNode) => void;
  onEmpty: () => void;
  name: string;
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

  return (
    <svg className="graph-svg" role="group" aria-label={p.name} width={size.width} height={size.height}
      onPointerDown={(e) => {
        if ((e.target as Element).closest('[data-graph-node]')) return;
        drag.current = { x: e.clientX, y: e.clientY, panX: view.panX, panY: view.panY, moved: false };
        (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d) return;
        const dx = e.clientX - d.x, dy = e.clientY - d.y;
        if (!d.moved && Math.hypot(dx, dy) < 3) return;
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
            const showLabel = labelVisible({ drawn, zoom: view.zoom, centre: n.centre, selected, hovered: p.hovered === n.key });
            const typeName = typeNameOf(n.node.typeKey);
            const common = {
              'data-graph-node': '', 'data-type': n.node.typeKey, 'data-depth': n.node.depth, 'data-size-step': n.step,
              'data-selected': selected ? 'true' : undefined, 'data-user-content': '', tabIndex: -1, role: 'img',
              'aria-label': `${displayTitle(n.node)}, ${typeName}`,
              className: `graph-node${n.centre ? ' centre' : ''}${p.entering.has(n.key) ? ' graph-enter' : ''}`,
              transform: `translate(${pos.x} ${pos.y})`, style: { opacity: dim ? 0.3 : 1 },
              onPointerEnter: () => p.onHover(n.key), onPointerLeave: () => p.onHover(null),
              onClick: (e: React.MouseEvent<SVGGElement>) => { e.stopPropagation(); p.onSelect(n, e.currentTarget); },
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
