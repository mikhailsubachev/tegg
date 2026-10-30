// Slice G1 (docs/contracts/v1-graph.md §4, §7; D-998): the pure view model of the full view, L1-tested without the
// DOM: node keys and sort keys (§1.6), size steps (R113, D-975), label rules (D-985), the connection phrases of D-982
// from an edge's `ways`, and the heading and depth-status texts (R109, D-976).
import { t } from '../i18n/catalog';
import type { EdgeKindDto, GraphEdgeDto, GraphNodeDto, GraphResultDto, GraphWayDto, NodeIdDto } from './types';

/** `objectId` when present, else the sort key (§4): a renamed node keeps its place and its selection. */
export type NodeKey = string;
export type SizeStep = 'centre' | 'default' | 'small' | 'medium' | 'large';
export type ModelNode = {
  key: NodeKey;
  sortKey: string;
  node: GraphNodeDto;
  centre: boolean;
  /** R113: `centre`; `default` with `Size nodes by links` off; else the D-975 step. */
  step: SizeStep;
  /** Diameter in px (R109, R113): centre 68; off: 44 at depth 1, 38 deeper; on: 36 / 44 / 56. */
  size: number;
};
export type GraphModel = { centre: NodeKey | null; nodes: ModelNode[]; edges: GraphEdgeDto[] };
/** The type definitions a phrase needs: a relation is named by the property's Name from the source's type (D-971). */
export type RelationNames = { key: string; attributes: { key: string; name: string }[] }[];

const STEP_SIZE = { small: 36, medium: 44, large: 56 } as const;
const STRENGTH: Record<EdgeKindDto, number> = { embed: 0, relation: 1, link: 2, tag: 3 };
/** D-971: reserved keys named by the catalog. */
const RESERVED_NAMES: Record<string, string> = { source: 'graph.relKey.source', description: 'graph.relKey.description' };

/** §1.6: the path for objects, `tag:<key>` for tag nodes. */
export function sortKey(id: NodeIdDto): string {
  return 'path' in id ? id.path : `tag:${id.tag}`;
}
export function nodeKey(node: GraphNodeDto): NodeKey {
  return node.objectId ?? sortKey(node.id);
}
/** D-975: `small` 0–4, `medium` 5–19, `large` ≥ 20 (vault-wide degree). */
export function sizeStep(degree: number): 'small' | 'medium' | 'large' {
  return degree >= 20 ? 'large' : degree >= 5 ? 'medium' : 'small';
}
export function buildModel(result: GraphResultDto, opts: { sizeByLinks: boolean }): GraphModel {
  const nodes = result.nodes.map((node): ModelNode => {
    const centre = node.depth === 0;
    const step: SizeStep = centre ? 'centre' : opts.sizeByLinks ? sizeStep(node.degree) : 'default';
    const size = step === 'centre' ? 68 : step === 'default' ? (node.depth === 1 ? 44 : 38) : STEP_SIZE[step];
    return { key: nodeKey(node), sortKey: sortKey(node.id), node, centre, step, size };
  });
  return { centre: nodes.find((n) => n.centre)?.key ?? null, nodes, edges: result.edges };
}
/** D-985: whether a node's label shows at this node count and zoom (1 = 100 %). */
export function labelVisible(o: { drawn: number; zoom: number; centre: boolean; selected: boolean; hovered: boolean }): boolean {
  if (o.centre || o.selected || o.hovered) return true;
  if (o.zoom < 0.6) return false;
  return o.drawn <= 60 || o.zoom >= 1.5;
}

const COLOURS = new Set(['gray', 'blue', 'green', 'orange', 'purple', 'red', 'teal', 'yellow']);
/** A type's colour token from its definition (D-236); gray when it has none or isn't defined (D-121). */
export function typeColour(typeKey: string, types: { key: string; color?: string | null }[]): string {
  const c = types.find((x) => x.key.normalize('NFC') === typeKey.normalize('NFC'))?.color;
  return c && COLOURS.has(c) ? c : 'gray';
}

/** The name a node has in a phrase: its title, `#<name>` for a tag. */
export function displayTitle(node: GraphNodeDto): string {
  return node.typeKey === 'tag' ? `#${node.title}` : node.title;
}

function relationName(way: GraphWayDto, result: GraphResultDto, types: RelationNames): string {
  const key = way.key ?? '';
  const from = result.nodes.find((n) => sortKey(n.id) === sortKey(way.from));
  const def = types.find((x) => x.key.normalize('NFC') === from?.typeKey.normalize('NFC'));
  const name = def?.attributes.find((a) => a.key.normalize('NFC') === key.normalize('NFC'))?.name;
  if (name) return name;
  return RESERVED_NAMES[key] ? t(RESERVED_NAMES[key]) : key;
}

/** D-982: line 2 of the graph's preview, how `node` is linked to the centre (depth 1) or to its first neighbour one
 *  step closer (by path); null for the centre. */
export function connectionPhrase(node: GraphNodeDto, result: GraphResultDto, types: RelationNames): string | null {
  if (node.depth === 0) return null;
  const me = sortKey(node.id);
  const closer = result.edges
    .map((e) => (sortKey(e.a) === me ? e.b : sortKey(e.b) === me ? e.a : null))
    .filter((x): x is NodeIdDto => x !== null)
    .map((id) => result.nodes.find((n) => sortKey(n.id) === sortKey(id)))
    .filter((n): n is GraphNodeDto => !!n && n.depth === node.depth - 1)
    .sort((a, b) => (sortKey(a.id) < sortKey(b.id) ? -1 : sortKey(a.id) > sortKey(b.id) ? 1 : 0))[0];
  if (!closer) return null;
  const other = sortKey(closer.id);
  const edge = result.edges.find((e) => (sortKey(e.a) === me && sortKey(e.b) === other) || (sortKey(e.b) === me && sortKey(e.a) === other));
  if (!edge) return null;
  const title = displayTitle(closer);
  const ways = [...edge.ways].sort((x, y) => STRENGTH[x.kind] - STRENGTH[y.kind]);
  const parts = ways.map((w) => {
    const mine = sortKey(w.from) === me;
    switch (w.kind) {
      case 'embed': return t(mine ? 'graph.rel.embedTo' : 'graph.rel.embedFrom', { title });
      case 'relation': return t(mine ? 'graph.rel.relationTo' : 'graph.rel.relationFrom', { title, name: relationName(w, result, types) });
      case 'link': return t(mine ? 'graph.rel.linkTo' : 'graph.rel.linkFrom', { title });
      case 'tag': return t(mine ? 'graph.rel.taggedWith' : 'graph.rel.tagOf', { title });
    }
  });
  return [...new Set(parts)].join(' · ');
}
/** R109 heading: `<n> objects`, or `<shown> of <n> objects` when the cap dropped nodes (D-976). */
export function headingCount(result: GraphResultDto): string {
  return result.truncated ? t('graph.countTruncated', { shown: result.nodes.length, count: result.total }) : t('graph.count', { count: result.nodes.length });
}
/** R109 depth status: `<n> hidden`, or null when the filters removed nothing at this depth (D-976). */
export function hiddenText(result: GraphResultDto): string | null {
  return result.hidden > 0 ? t('graph.hidden', { count: result.hidden }) : null;
}

// ------------------------------------------------------------------------------------------------ slice G3
// docs/contracts/v1-graph.md §16.3 (R121, R122; AP-937, AP-938; D-1106).

const byCode = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** R121: the result's node order (depth, then degree descending, then sort key; §1.6), as node keys. */
export function positionOrder(result: GraphResultDto): NodeKey[] {
  return [...result.nodes].sort((a, b) => a.depth - b.depth || b.degree - a.degree || byCode(sortKey(a.id), sortKey(b.id))).map(nodeKey);
}
/** R121: a node's accessible description, `<n> connections. <how it is linked>. <i> of <N>.` (the centre:
 *  `<n> connections. Centre of the graph. 1 of <N>.`). `index` is the 1-based `<i>` in `positionOrder(result)`;
 *  `null` leaves the position out (a List row, R122): the message without its `{position}` part (D-1106). */
export function nodeDescription(node: GraphNodeDto, result: GraphResultDto, types: RelationNames, index: number | null): string {
  const connections = t('graph.connectionsCount', { count: node.degree });
  const vars: Record<string, string> = { connections };
  if (index !== null) vars.position = t('graph.a11y.position', { index, total: result.nodes.length });
  if (node.depth !== 0) vars.relation = connectionPhrase(node, result, types) ?? '';
  const text = t(node.depth === 0 ? 'graph.a11y.centre' : 'graph.a11y.node', vars);
  return index === null ? text.replace(/\s*\{position\}\.?/, '') : text;
}
/** R122 (AP-938): the List tree in row order (pre-order): each node once, under its first neighbour one step closer by
 *  sort key; children in the result's node order. `level` is the node's depth (0 for the centre). */
export type ListRow = { key: NodeKey; parentKey: NodeKey | null; level: number; children: NodeKey[] };
export function listTree(result: GraphResultDto): ListRow[] {
  const order = positionOrder(result);
  const byKey = new Map(result.nodes.map((n) => [nodeKey(n), n]));
  const bySort = new Map(result.nodes.map((n) => [sortKey(n.id), n]));
  const near = new Map<string, string[]>();
  for (const e of result.edges) {
    const a = sortKey(e.a), b = sortKey(e.b);
    near.set(a, [...(near.get(a) ?? []), b]);
    near.set(b, [...(near.get(b) ?? []), a]);
  }
  const parent = new Map<NodeKey, NodeKey | null>();
  const children = new Map<NodeKey, NodeKey[]>();
  for (const k of order) {
    const n = byKey.get(k)!;
    const up = n.depth === 0 ? undefined : (near.get(sortKey(n.id)) ?? []).filter((s) => bySort.get(s)?.depth === n.depth - 1).sort(byCode)[0];
    const p = up ? nodeKey(bySort.get(up)!) : null;
    parent.set(k, p);
    if (p !== null) children.set(p, [...(children.get(p) ?? []), k]);
  }
  const rows: ListRow[] = [];
  const seen = new Set<NodeKey>();
  const visit = (k: NodeKey) => {
    if (seen.has(k)) return;
    seen.add(k);
    rows.push({ key: k, parentKey: parent.get(k) ?? null, level: byKey.get(k)!.depth, children: children.get(k) ?? [] });
    for (const c of children.get(k) ?? []) visit(c);
  };
  // The centre's tree, then any node without a parent one step closer (none in a well-formed result).
  for (const k of order) if (parent.get(k) === null) visit(k);
  return rows;
}
