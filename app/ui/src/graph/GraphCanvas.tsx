// Slice G1 (docs/contracts/v1-graph.md §4; graph.md R108, R109, R113; ADR 0004): the SVG canvas of the full view: one
// `<g data-graph-node>` per node and one `<line data-graph-edge>` per edge, zoom and pan (D-985), the selection and
// hover highlight (D-983). Positions come from `layout.ts`; this component only draws them.
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
/** Slice G2 (R114, D-1031): the panel's label width. */
const PANEL_LABEL_MAX = 96;
export type CanvasScale = 'full' | 'panel';
const labelMax = (scale: CanvasScale) => (scale === 'panel' ? PANEL_LABEL_MAX : LABEL_MAX);
/** Label font size by scale (R109, R114). */
const fontOf = (n: ModelNode, scale: CanvasScale) => (scale === 'panel' ? (n.centre ? 13 : 10) : n.centre ? 14 : n.node.depth === 1 ? 12 : 11);
/** A tag pill's size by scale: height, font, and width of its text (R113, R114). */
const pillOf = (text: string, scale: CanvasScale) => (scale === 'panel'
  ? { h: 22, font: 11, w: Math.min(PANEL_LABEL_MAX, 12 + 6.6 * [...text].length) }
  : { h: 26, font: 12, w: Math.min(LABEL_MAX, 16 + 7.2 * [...text].length) });

export type View = { zoom: number; panX: number; panY: number };

const colourOf = (typeKey: string) => typeColour(typeKey, chipTypes());

let measure: CanvasRenderingContext2D | null = null;
let family: string | null = null;
const cuts = new Map<string, string>();
/** D-985: a label cut at 150 px (the panel: 96 px, R114) with `…` (the full title stays in the accessible name);
 *  remembered per text and font. */
function cut(text: string, px: number, weight: string, max = LABEL_MAX): string {
  if (typeof document === 'undefined') return text;
  const key = `${weight}|${px}|${max}|${text}`;
  const known = cuts.get(key);
  if (known !== undefined) return known;
  const out = cutNow(text, px, weight, max);
  if (cuts.size > 5000) cuts.clear();
  cuts.set(key, out);
  return out;
}
function cutNow(text: string, px: number, weight: string, max: number): string {
  measure ??= document.createElement('canvas').getContext('2d');
  if (!measure) return text;
  family ??= getComputedStyle(document.body).fontFamily || 'sans-serif';
  measure.font = `${weight} ${px}px ${family}`;
  if (measure.measureText(text).width <= max - 2) return text;
  const chars = [...text];
  let lo = 0, hi = chars.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (measure.measureText(`${chars.slice(0, mid).join('').trimEnd()}…`).width <= max - 6) lo = mid; else hi = mid - 1;
  }
  return `${chars.slice(0, lo).join('').trimEnd()}…`;
}

/** A node's box with its label at 100 %: width, and extent above and below its centre (for Fit, D-985). */
export function nodeBox(n: ModelNode, scale: CanvasScale = 'full'): { w: number; top: number; bottom: number } {
  if (n.node.typeKey === 'tag') {
    const p = pillOf(`#${n.node.title}`, scale);
    return { w: p.w + 8, top: p.h / 2 + 4, bottom: p.h / 2 + 4 };
  }
  const max = labelMax(scale);
  const r = n.size / 2 + 4;
  const fontSize = fontOf(n, scale);
  measure ??= typeof document !== 'undefined' ? document.createElement('canvas').getContext('2d') : null;
  let lw = max;
  if (measure) {
    family ??= getComputedStyle(document.body).fontFamily || 'sans-serif';
    measure.font = `${n.centre ? 650 : 400} ${fontSize}px ${family}`;
    lw = Math.min(max, measure.measureText(n.node.title).width);
  }
  const ring = scale === 'panel' && n.centre ? 30 + 1 : r;
  const gap = scale === 'panel' ? 5 : 7;
  return { w: Math.max(2 * ring, lw + 4), top: ring, bottom: Math.max(ring, n.size / 2 + gap + fontSize * 1.4) };
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
  /** Slice G2 (R114, D-1031): the panel's sizes, labels always shown, 96 px labels. */
  scale?: CanvasScale;
};

export function GraphCanvas(p: CanvasProps) {
  const { model, positions, size, view } = p;
  const scale: CanvasScale = p.scale ?? 'full';
  const max = labelMax(scale);
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
            const showLabel = scale === 'panel' || labelVisible({ drawn, zoom: view.zoom, centre: n.centre, selected, hovered: p.hovered === n.key });
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
              const pill = pillOf(text, scale);
              const { w, h } = pill;
              return (
                <g key={n.key} {...common} data-tag-key={n.node.tagKey ?? ''} data-path={undefined}>
                  <rect x={-w / 2} y={-h / 2} width={w} height={h} rx={h / 2} className="graph-pill" style={{ fill: c ? `var(--type-${c}-bg)` : 'var(--hover)', stroke: c ? `var(--type-${c})` : 'var(--muted)' }} />
                  {selected && <rect x={-w / 2 - 4} y={-h / 2 - 4} width={w + 8} height={h + 8} rx={h / 2 + 4} className="graph-ring" />}
                  <text className="graph-pill-text" textAnchor="middle" dominantBaseline="central" style={{ fill: c ? `var(--type-${c})` : 'var(--muted)', fontSize: pill.font }}>{cut(text, pill.font, '600', Math.min(max, w - 4))}</text>
                </g>
              );
            }
            const colour = colourOf(n.node.typeKey);
            const r = n.size / 2;
            const icon = chipIcon(n.node.typeKey);
            const fontSize = fontOf(n, scale);
            const iconSize = scale === 'panel' ? (n.centre ? 20 : n.size >= 34 ? 14 : 12) : n.centre ? 24 : 16;
            const panelRing = scale === 'panel' && n.centre;
            return (
              <g key={n.key} {...common} data-path={n.node.path ?? undefined}>
                <circle r={r} className="graph-circle" style={{ fill: `var(--type-${colour}-bg)`, stroke: `var(--type-${colour})`, strokeWidth: n.centre && scale !== 'panel' ? 3 : 1.5 }} />
                {panelRing && <circle r={30} className="graph-centre-ring" style={{ stroke: `var(--type-${colour})` }} />}
                {selected && <circle r={(panelRing ? 30 : r) + 4} className="graph-ring" />}
                <g transform={`translate(${-iconSize / 2} ${-iconSize / 2})`} style={{ color: `var(--type-${colour})` }}>
                  <Icon name={icon.glyph} dataIcon={icon.def} size={iconSize} />
                </g>
                <text className={`graph-label${n.centre ? ' centre' : ''}`} y={(panelRing ? 30 : r) + (scale === 'panel' ? 5 : 7)} textAnchor="middle" dominantBaseline="hanging"
                  style={{ fontSize, fontWeight: n.centre ? 650 : 400, display: showLabel ? undefined : 'none' }}>
                  {cut(n.node.title, fontSize, n.centre ? '650' : '400', max)}
                </text>
              </g>
            );
          })}
        </g>
      </g>
    </svg>
  );
}
