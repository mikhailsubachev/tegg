// Slice G1 IPC payloads (docs/contracts/v1-graph.md §2, §5), as the contract writes them. The build generates them from
// the Rust DTOs into ipc/types.ts (architecture §6) and this file then re-exports those.
export type EdgeKindDto = 'link' | 'relation' | 'embed' | 'tag';
export type NodeIdDto = { path: string } | { tag: string };
export type GraphRequestDto = {
  centre: string; depth: 1 | 2 | 3; hiddenTypes: string[]; hiddenKinds: EdgeKindDto[]; cap: number; showAll: boolean;
};
export type GraphNodeDto = {
  id: NodeIdDto; objectId: string | null; path: string | null; title: string; typeKey: string; depth: number;
  degree: number; tagKey: string | null; color: string | null;
};
export type GraphWayDto = { kind: EdgeKindDto; from: NodeIdDto; key: string | null };
export type GraphEdgeDto = { a: NodeIdDto; b: NodeIdDto; style: EdgeKindDto; ways: GraphWayDto[] };
export type GraphResultDto = {
  nodes: GraphNodeDto[]; edges: GraphEdgeDto[]; total: number; unfiltered: number; hidden: number; truncated: boolean;
  typeCounts: [string, number][];
  /** D-999: the filtered total at each depth from 1 to the requested one, centre included. */
  depthTotals?: number[];
};
/** §5 (D-993): the full view's (and G2's panel's) stored state, under `vaults[<vault path, NFC>].graph`. */
export type GraphViewStateDto = {
  depth?: 1 | 2 | 3;
  hiddenTypes?: string[];
  hiddenKinds?: EdgeKindDto[];
  sizeByLinks?: boolean;
};
