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
