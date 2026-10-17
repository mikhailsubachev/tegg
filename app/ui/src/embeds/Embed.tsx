// One embed of R30 (docs/contracts/ms4-embeds.md §6; FR-EMB-02, FR-LNK-07, D-418, D-424, D-427). 4F stub.
import type { ReactNode } from 'react';
import type { EmbedMode } from '@tegg/doc';
import type { EmbedNode } from './tree';

export type EmbedProps = {
  node: EmbedNode;
  host: string;
  editable: boolean;
  onOpen: (path: string, fragment?: string) => void;
  onMode?: (mode: EmbedMode) => void;
  onEnter?: () => void;
  onCreate?: (el: HTMLElement) => void;
};

export function Embed(_props: EmbedProps): ReactNode {
  return null; // 4F stub
}
