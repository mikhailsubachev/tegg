import type { VersionDto } from '../ipc/types';

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
  /** G3 (§16.4): missing or unknown → 'graph', not rewritten (D-906, AP-940). */
  view?: 'graph' | 'list';
  /** G3 (§16.4): the current preset's name, NFC; missing → Default; a name not listed → the Default label (AP-930). */
  preset?: string;
};
/** G3 (§16.2): one preset of `.tegg/graph.yml`. */
export type GraphPresetDto = { name: string; hiddenTypes: string[]; hiddenKinds: string[] };
/** G3 (§16.2): the presets file as read. */
export type GraphPresetsDto = {
  version: VersionDto | null;
  state: 'missing' | 'ok' | 'newer' | 'unreadable';
  /** Only for 'unreadable'. */
  error: { line: number | null; reason: string } | null;
  presets: GraphPresetDto[];
};
/** G3 (§16.2). */
export type PresetOpDto =
  | { op: 'save'; name: string; hiddenTypes: string[]; hiddenKinds: string[] }
  | { op: 'update'; name: string; hiddenTypes: string[]; hiddenKinds: string[] }
  | { op: 'rename'; from: string; to: string }
  | { op: 'delete'; name: string };
