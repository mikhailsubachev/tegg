// Slice MM (docs/contracts/mm-mindmap.md §2, docs/acceptance/mindmap.md R92): the map's layout, pure and deterministic
// (D-683, D-775, D-777). A left-to-right tree: one column per depth, each subtree stacked below the previous one,
// each parent centred on its children, elbow connectors. Nothing of it is stored (R-08).
import type { MindInline, MindItem, MindmapLayout, MindmapTree } from '@tegg/doc';

/** A text's width on one line; `depth` gives the node's weight (root 650, first level 600, deeper 400, R92). */
export type Measure = (text: string, depth?: number) => number;
export type Tone = 'root' | 'blue' | 'orange' | 'purple' | 'teal' | 'green' | 'yellow' | 'red' | 'plain';
/** Slice MM2 (mm-mindmap §6.2, R96): `side` in the spider layout (absent on the root and in `right`). */
export type MindLayoutNode = { id: string; depth: number; x: number; y: number; w: number; h: number; lines: string[]; tone: Tone; side?: 'left' | 'right' };
export type MindConnector = { from: string; to: string; points: [number, number][] };
export type MindLayout = { width: number; height: number; nodes: MindLayoutNode[]; connectors: MindConnector[]; layout: MindmapLayout };

/** D-775: the branch colours by position, then repeating. */
export const PALETTE = ['blue', 'orange', 'purple', 'teal', 'green', 'yellow', 'red'] as const;

/** The test Measurer of R92: 7 px per Unicode scalar value of the NFC text. */
export const textMeasurer: Measure = (text) => [...text.normalize('NFC')].length * 7;

// R92 geometry.
const PAD = 10;
const LINE = 18;
const WRAP = 180;
const MIN_W = 48;
const MAX_W = 200;
const COL_GAP = 60;
const ROW_GAP = 8;
const ELBOW = 30;

let count = 0;
/** How many layouts were computed (the L5 hook `window.__TEGG_MINDMAP_LAYOUTS__`, FR-MMP-02 AC-6). */
export function layoutCount(): number {
  return count;
}

/** A chip's label as the map shows it (D-774): the alias, else the target's file name without `.md`. */
export function chipLabel(r: Extract<MindInline, { k: 'link' }>): string {
  if (r.alias) return r.alias;
  const t = r.target.replace(/#.*$/, '');
  return (t.split('/').pop() ?? t).replace(/\.md$/i, '');
}

type Token = { text: string; chip: boolean; extra?: number } | 'break';
/** What a chip adds to its label's width: a fixed number, or per chip (a task chip's due · status suffix). */
export type ChipExtra = number | ((r: Extract<MindInline, { k: 'link' } | { k: 'tag' }>) => number);
function tokens(inline: MindInline[], more: boolean, extra: ChipExtra): Token[] {
  const ex = (r: Extract<MindInline, { k: 'link' } | { k: 'tag' }>) => (typeof extra === 'number' ? extra : extra(r));
  const out: Token[] = [];
  for (const r of inline) {
    if (r.k === 'break') out.push('break');
    else if (r.k === 'text') for (const w of r.text.split(/(\s+)/)) { if (w) out.push({ text: w, chip: false }); }
    else if (r.k === 'url') for (const w of r.text.split(/(\s+)/)) { if (w) out.push({ text: w, chip: false }); }
    else if (r.k === 'link') out.push({ text: chipLabel(r), chip: true, extra: ex(r) });
    else out.push({ text: `#${r.value}`, chip: true, extra: ex(r) });
  }
  if (more) out.push({ text: ' ', chip: false }, { text: '…', chip: false });
  return out;
}

/** Greedy wrap at word boundaries within `WRAP` px; a word wider than that breaks between characters (R92). */
function wrap(toks: Token[], measure0: Measure, depth: number): { lines: string[]; widest: number } {
  const measure = (s: string) => measure0(s, depth);
  const lines: string[] = [];
  let line = '';
  let lineW = 0;
  const width = (t: { text: string; chip: boolean; extra?: number }) => measure(t.text) + (t.chip ? t.extra ?? 0 : 0);
  const flush = () => { lines.push(line.replace(/\s+$/, '')); line = ''; lineW = 0; };
  for (const t of toks) {
    if (t === 'break') { flush(); continue; }
    const space = /^\s+$/.test(t.text);
    if (space) { if (line) { line += t.text; lineW += width(t); } continue; }
    const w = width(t);
    if (line && lineW + w > WRAP) {
      flush();
    }
    if (!line && w > WRAP && !t.chip) {
      // Break a long word between characters.
      let part = '';
      for (const ch of [...t.text]) {
        if (part && measure(part + ch) > WRAP) { line = part; flush(); part = ''; }
        part += ch;
      }
      line = part;
      lineW = measure(part);
      continue;
    }
    line += t.text;
    lineW += w;
  }
  if (line || lines.length === 0) flush();
  // The widest line, measured as a whole, with each chip's extra.
  const chips = (s: string) => toks.reduce((n, t) => n + (t !== 'break' && t.chip && s.includes(t.text) ? t.extra ?? 0 : 0), 0);
  const widest = Math.max(0, ...lines.map((l) => measure(l) + chips(l)));
  return { lines, widest };
}

type Box = { id: string; depth: number; w: number; h: number; lines: string[]; tone: Tone; kids: Box[]; y: number };

export function layoutMindmap(tree: MindmapTree, measure: Measure, opts: { chipExtra?: ChipExtra; layout?: MindmapLayout } = {}): MindLayout {
  count++;
  const chipExtra = opts.chipExtra ?? 0;
  // Slice MM2 (mm-mindmap §6.2): `spider` is R96. STUB: every layout is drawn as `right`.
  const layout: MindmapLayout = 'right';
  void (opts.layout ?? tree.layout);
  if (tree.root.kind === 'empty') return { width: 0, height: 0, nodes: [], connectors: [], layout };

  const sizeOf = (toks: Token[], depth: number) => {
    const { lines, widest } = wrap(toks, measure, depth);
    // A text that had to wrap fills the node (200 px); one that fits is as wide as its widest line (R92).
    const segments = toks.filter((t) => t === 'break').length + 1;
    const w = lines.length > segments ? MAX_W : Math.min(MAX_W, Math.max(MIN_W, widest + 2 * PAD));
    return { lines, w, h: 14 + LINE * lines.length };
  };
  const tone = (depth: number, i: number): Tone => (depth === 0 ? 'root' : depth === 1 ? PALETTE[i % PALETTE.length] : 'plain');
  const build = (it: MindItem, depth: number, i: number): Box => {
    const s = sizeOf(tokens(it.inline, it.more, chipExtra), depth);
    return { id: it.path.join('.'), depth, ...s, tone: tone(depth, i), kids: it.children.map((c, k) => build(c, depth + 1, k)), y: 0 };
  };
  let root: Box;
  if (tree.root.kind === 'item') root = build(tree.root.item, 0, 0);
  else {
    const s = sizeOf(tokens([{ k: 'text', text: tree.root.text, marks: [] }], false, chipExtra), 0);
    root = { id: 'root', depth: 0, ...s, tone: 'root', kids: tree.items.map((c, k) => build(c, 1, k)), y: 0 };
  }

  // Columns: x(0) = 0, x(d + 1) = x(d) + widest of depth d + 60.
  const widest: number[] = [];
  const walk = (b: Box, f: (b: Box) => void) => { f(b); b.kids.forEach((k) => walk(k, f)); };
  walk(root, (b) => { widest[b.depth] = Math.max(widest[b.depth] ?? 0, b.w); });
  const colX: number[] = [0];
  for (let d = 1; d < widest.length; d++) colX[d] = colX[d - 1] + widest[d - 1] + COL_GAP;

  // Rows: returns the subtree's bottom.
  const shift = (b: Box, dy: number) => walk(b, (x) => { x.y += dy; });
  const place = (b: Box, top: number): number => {
    if (b.kids.length === 0) { b.y = top; return top + b.h; }
    let cursor = top;
    let bottom = top;
    for (const k of b.kids) { bottom = place(k, cursor); cursor = bottom + ROW_GAP; }
    const first = b.kids[0], last = b.kids[b.kids.length - 1];
    const centre = (first.y + first.h / 2 + last.y + last.h / 2) / 2;
    b.y = centre - b.h / 2;
    if (b.y < top) {
      const dy = top - b.y;
      for (const k of b.kids) shift(k, dy);
      bottom += dy;
      b.y = top;
    }
    return Math.max(bottom, b.y + b.h);
  };
  const height = place(root, 0);

  const nodes: MindLayoutNode[] = [];
  const connectors: MindConnector[] = [];
  let width = 0;
  walk(root, (b) => {
    const x = colX[b.depth];
    nodes.push({ id: b.id, depth: b.depth, x, y: b.y, w: b.w, h: b.h, lines: b.lines, tone: b.tone });
    width = Math.max(width, x + b.w);
    const pc = b.y + b.h / 2;
    const elbow = (colX[b.depth + 1] ?? 0) - ELBOW;
    for (const k of b.kids) {
      const kc = k.y + k.h / 2;
      connectors.push({ from: b.id, to: k.id, points: [[x + b.w, pc], [elbow, pc], [elbow, kc], [colX[k.depth], kc]] });
    }
  });
  return { width, height, nodes, connectors, layout };
}
