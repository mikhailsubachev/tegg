// Invalid-frontmatter warning (NFR-REL-03, D-97; ms3-shell §11.3): the kind and the 1-based line from `@tegg/doc`.
import type { Doc } from '@tegg/doc';

export type FrontmatterWarning = { kind: 'invalidYaml' | 'notClosed'; line: number };

export function frontmatterWarning(doc: Doc): FrontmatterWarning | null {
  if (doc.frontmatterError) return { kind: 'notClosed', line: doc.frontmatterError.line };
  if (doc.frontmatter?.error) return { kind: 'invalidYaml', line: doc.frontmatter.error.line };
  return null;
}
