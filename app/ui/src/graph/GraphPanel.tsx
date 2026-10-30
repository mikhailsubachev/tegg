// Slice G2 (docs/contracts/v1-graph.md §15.2): the right panel's `tabpanel` `Graph` — request lifecycle, R115 states,
// selection, the preview hand-over (§15.4), the depth and filters popover and `Open full view` (§15.5).
//
// STUB (G2 red tests, TS-I1): renders nothing and isn't used by the Context panel until slice G2 is built.
import type { TypeDefDto } from '../ipc/types';
import type { GraphNodeDto, GraphViewStateDto, NodeIdDto } from './types';

/** §15.5: what the panel hands to the full view, on the new history entry. */
export type GraphHandover = { depth: 1 | 2 | 3; select: NodeIdDto | null };

export type GraphPanelProps = {
  centre: { path: string | null; title: string; objectId: string | null };
  vaultPath: string;
  state: GraphViewStateDto;
  onState(next: GraphViewStateDto): void;
  onOpen(node: GraphNodeDto): void;
  onOpenFull(handover: GraphHandover): void;
  refresh: number;
  width: number;
  types: TypeDefDto[];
};

export function GraphPanel(_props: GraphPanelProps): null {
  return null;
}
