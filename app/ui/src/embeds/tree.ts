// The embed tree of an open note (docs/contracts/ms4-embeds.md §5; FR-EMB-02, FR-EMB-04, D-416…D-420, D-429).
// Pure functions: the loader is passed in. 4F stubs: deliberately wrong results.
import type { EmbedMode, Section } from '@tegg/doc';
import type { EmbedNoteDto, LinkTargetDto, TypeDto } from '../ipc/types';

export type EmbedState = 'ok' | 'broken' | 'missing-section' | 'date-missing' | 'circular' | 'too-deep';
export type EmbedNode = {
  value: string;
  line: number;
  inline: boolean;
  depth: number;
  mode: EmbedMode;
  state: EmbedState;
  target: LinkTargetDto;
  subpath: string | null;
  note: EmbedNoteDto | null;
  section: Section | null;
  readOnly: boolean;
  children: EmbedNode[];
};
export type EmbedTree = { path: string; embeds: EmbedNode[]; loads: number };

/** D-416, D-417, D-419: the mode of one embed. */
export function embedModeFor(_value: string, _targetType: string | null, _types: TypeDto[], _inline: boolean): EmbedMode {
  return 'card'; // 4F stub
}

/** D-420, D-429: builds the tree level by level, one `load` call per depth. */
export async function buildEmbedTree(
  host: { path: string; text: string; links: Map<string, LinkTargetDto> },
  _types: TypeDto[],
  _load: (paths: string[]) => Promise<EmbedNoteDto[]>,
  _opts?: { readOnly?: boolean; maxDepth?: 3 },
): Promise<EmbedTree> {
  return { path: host.path, embeds: [], loads: 0 }; // 4F stub
}
