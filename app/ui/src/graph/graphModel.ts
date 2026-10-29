// Slice G1 (docs/contracts/v1-graph.md §4, §7): the pure view model of the full view, L1-tested without the DOM:
// node keys and sort keys (§1.6), size steps (R113, D-975), label rules (D-985), the connection phrases of D-982 from an
// edge's `ways`, and the heading and depth-status texts (R109, D-976).
//
// STUB (G1 red tests, TS-I1): every function answers a wrong or empty value until slice G1 is built.
import type { GraphEdgeDto, GraphNodeDto, GraphResultDto, NodeIdDto } from './types';

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

/** §1.6: the path for objects, `tag:<key>` for tag nodes. */
export function sortKey(id: NodeIdDto): string {
  void id;
  return '';
}
export function nodeKey(node: GraphNodeDto): NodeKey {
  void node;
  return '';
}
/** D-975: `small` 0–4, `medium` 5–19, `large` ≥ 20 (vault-wide degree). */
export function sizeStep(degree: number): 'small' | 'medium' | 'large' {
  void degree;
  return 'medium';
}
export function buildModel(result: GraphResultDto, opts: { sizeByLinks: boolean }): GraphModel {
  void result;
  void opts;
  return { centre: null, nodes: [], edges: [] };
}
/** D-985: whether a node's label shows at this node count and zoom (1 = 100 %). */
export function labelVisible(o: { drawn: number; zoom: number; centre: boolean; selected: boolean; hovered: boolean }): boolean {
  void o;
  return false;
}
/** D-982: line 2 of the graph's preview, how `node` is linked to the centre (depth 1) or to its first neighbour one
 *  step closer (by path); null for the centre. */
export function connectionPhrase(node: GraphNodeDto, result: GraphResultDto, types: RelationNames): string | null {
  void node;
  void result;
  void types;
  return null;
}
/** R109 heading: `<n> objects`, or `<shown> of <n> objects` when the cap dropped nodes (D-976). */
export function headingCount(result: GraphResultDto): string {
  void result;
  return '';
}
/** R109 depth status: `<n> hidden`, or null when the filters removed nothing at this depth (D-976). */
export function hiddenText(result: GraphResultDto): string | null {
  void result;
  return null;
}
