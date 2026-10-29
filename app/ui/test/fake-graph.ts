// Fake core, slice G1 (docs/contracts/v1-graph.md §8): `graph_neighbourhood` as a TypeScript reference walk of §1 over
// the fake's files, with the real `@tegg/doc` extraction and the ms3-shell §11.1 resolution rules; tag keys and
// colours as fake-tags.ts. Runs in Node (installFakeCore exposes it to the page as `__teggGraph`). Checked against the
// Rust query on the graph fixture through tests/fixtures/vaults/graph-golden/expected.json
// (app/test/graph_reference.ac.test.ts). Test code, not product code.
//
// STUB (G1 red tests, TS-I1): answers `NotImplemented` until slice G1 is built.
import type { GraphRequestDto, GraphResultDto } from '../src/graph/types';

export type GraphErr = { kind: 'CentreNotFound' | 'CentreInTrash' | 'InvalidDepth' | 'Cancelled' | 'NotReady' | 'NotImplemented'; message: string; title?: string };

/** The reference walk: `files` vault path → text (`.tegg/types/*.yml` included), `bin` the binary vault paths
 *  (attachments). Throws a `GraphErr`. */
export function graphNeighbourhood(files: Record<string, string>, req: GraphRequestDto, bin: string[] = []): GraphResultDto {
  void files;
  void req;
  void bin;
  throw { kind: 'NotImplemented', message: 'fake: graph_neighbourhood comes with G1' } satisfies GraphErr;
}

export async function handle(cmd: string, a: any, files: Record<string, string>, bin: string[]): Promise<{ result?: unknown; error?: GraphErr }> {
  try {
    switch (cmd) {
      case 'graph_neighbourhood': return { result: graphNeighbourhood(files, a.req as GraphRequestDto, bin) };
      default: return { error: { kind: 'NotImplemented', message: `fake-graph: unknown command ${cmd}` } };
    }
  } catch (e) {
    return { error: e as GraphErr };
  }
}
