// Slice G1, L1: the fake core's TypeScript reference walk (app/ui/test/fake-graph.ts, docs/contracts/v1-graph.md §8)
// gives, on the graph fixture, exactly the hand-made golden that the Rust query is checked against
// (tests/fixtures/vaults/graph-golden/expected.json; crates/tegg-index/tests/ac_graph.rs), for every centre, depth and
// filter scenario of the fixture README: FR-GRP-01 AC-1, AC-4, AC-5, AC-7 and FR-GRP-02 AC-2, AC-3 through the L5
// layer's fake. Written from the ACs, the contract and the fixture README only (D-61). Modules load inside the tests.
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { BIN, expand, golden, graphFiles } from './graph-data';

type Mod = Record<string, any>;
async function load(path: string): Promise<Mod | null> {
  try {
    return (await import(/* @vite-ignore */ path)) as Mod;
  } catch {
    return null;
  }
}
async function walk(): Promise<(files: Record<string, string>, req: unknown, bin: string[]) => unknown> {
  const m = await load('../ui/test/fake-graph.ts');
  assert.ok(m && typeof m.graphNeighbourhood === 'function', 'fake-graph.ts exports graphNeighbourhood');
  return m!.graphNeighbourhood;
}

test('fr_grp_01_ac7_result_shape_on_the_fixture_reference_walk_equals_the_golden', async () => {
  const run = await walk();
  const g = golden();
  const files = graphFiles();
  const bad: string[] = [];
  for (const s of g.scenarios) {
    let got: unknown;
    try {
      got = run(files, s.req, BIN);
    } catch (e) {
      bad.push(`${s.name}: ${JSON.stringify(e)}`);
      continue;
    }
    try {
      assert.deepStrictEqual(JSON.parse(JSON.stringify(got)), expand(g, s));
    } catch (e) {
      bad.push(`${s.name}: ${(e as Error).message.slice(0, 2000)}`);
    }
  }
  assert.deepEqual(bad, [], `${bad.length} of ${g.scenarios.length} golden scenarios differ`);
});

test('fr_grp_01_ac8_deterministic_and_rebuild_stable_reference_walk', async () => {
  const run = await walk();
  const g = golden();
  for (const s of g.scenarios.slice(0, 6)) {
    let a = '', b = '';
    try {
      a = JSON.stringify(run(graphFiles(), s.req, BIN));
      // The same vault built in the other order (a rebuild reads the files in any order).
      const files = Object.fromEntries(Object.entries(graphFiles()).reverse());
      b = JSON.stringify(run(files, s.req, BIN));
    } catch (e) {
      assert.fail(`${s.name}: ${JSON.stringify(e)}`);
    }
    assert.equal(b, a, `${s.name}: the same JSON whatever the file order`);
  }
});

test('fr_grp_01_ac22_centre_deleted_state_reference_errors', async () => {
  const run = await walk();
  const files = graphFiles();
  const err = (f: Record<string, string>, centre: string, depth = 1) => {
    try {
      run(f, { centre, depth, hiddenTypes: [], hiddenKinds: [], cap: 150, showAll: false }, BIN);
      return null;
    } catch (e) {
      return e as { kind: string; title?: string };
    }
  };
  assert.equal(err(files, 'Pages/Neexistuje.md')?.kind, 'CentreNotFound', 'a path that doesn\'t exist');
  assert.equal(err(files, 'Pages/Plán čtvrtletí.md', 4)?.kind, 'InvalidDepth', 'depth 4');
  const trashed = { ...files };
  trashed['.trash/Pages/Plán čtvrtletí.md'] = trashed['Pages/Plán čtvrtletí.md'];
  delete trashed['Pages/Plán čtvrtletí.md'];
  const e = err(trashed, 'Pages/Plán čtvrtletí.md');
  assert.deepEqual(e && { kind: e.kind, title: e.title }, { kind: 'CentreInTrash', title: 'Plán čtvrtletí' }, 'Plán in .trash/');
});
