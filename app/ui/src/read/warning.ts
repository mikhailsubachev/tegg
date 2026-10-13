// Invalid-frontmatter warning (NFR-REL-03, D-97; ms3-shell §11.3).
// STUB (TS-I1): compiles and returns a deliberately wrong result until slice 3B is built.
import type { Doc } from '@tegg/doc';

export type FrontmatterWarning = { kind: 'invalidYaml' | 'notClosed'; line: number };

export function frontmatterWarning(_doc: Doc): FrontmatterWarning | null {
  return null;
}
