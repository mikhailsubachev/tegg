// Slice G3 (docs/contracts/v1-graph.md §16.3; R122): the List view, a `tree` `Local graph as a list`. Red-test stub
// (TS-I1): renders nothing and is not mounted yet.
import type { GraphResultDto } from './types';

export type GraphListProps = { result: GraphResultDto };

export function GraphList(p: GraphListProps) {
  void p;
  return null;
}
