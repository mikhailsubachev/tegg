// Read view: the formatted, read-only note body (FR-EDT-02, slice 3B; docs/contracts/ms3-shell.md §11.3).
// STUB (TS-I1): compiles and returns a deliberately wrong result until slice 3B is built.
import type { LinkTargetDto } from '../ipc/types';

export type ReadViewProps = {
  text: string;
  path: string;
  links: Map<string, LinkTargetDto>;
  onOpen: (path: string, fragment?: string) => void;
  onTag: (key: string) => void;
  onExternal: (url: string) => void;
  onScrollInNote: (fragment: string) => void;
};

export function ReadView(_props: ReadViewProps) {
  return null;
}

/** The targets to send to `link_resolve` (body + frontmatter relations, no attachments), deduplicated. */
export function linkTargets(_text: string): string[] {
  return [];
}
