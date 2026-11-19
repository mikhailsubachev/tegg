// Slice Q2, L1: the shared width helper (docs/contracts/v1-views.md §4.2 `app/ui/src/tables/widths.ts`, D-1767) behind
// docs/acceptance/views.md FR-QRY-05 AC-23 (widths per query, shared by a view tab and its blocks; R130's numbers and
// limits, D-1248; Title's minimum 160 px, D-1812): `WIDTH` and `clampWidth` move to `tables/widths.ts` and
// `types/columns.ts` re-exports them unchanged, so the type page and the query tables clamp alike. The hook itself is
// checked at L5. Written from the ACs and the contract only (D-61). Modules load inside the test (TS-I1).
import { test } from 'vitest';
import assert from 'node:assert/strict';

type Mod = Record<string, any>;
async function load(path: string): Promise<Mod | null> {
  try { return (await import(/* @vite-ignore */ path)) as Mod; } catch { return null; }
}

test('fr_qry_05_ac23_widths_per_query_shared_by_tab_and_blocks', async () => {
  const w = await load('../ui/src/tables/widths.ts');
  assert.ok(w, 'ui/src/tables/widths.ts loads (v1-views §4.2)');
  const cols = await load('../ui/src/types/columns.ts');
  assert.ok(cols, 'ui/src/types/columns.ts loads');
  assert.deepEqual({ ...(w!.WIDTH ?? {}) }, { default: 160, min: 80, max: 960, titleMin: 160, titleFill: 240 }, 'WIDTH (R130, D-1248)');
  assert.equal(cols!.WIDTH, w!.WIDTH, 'types/columns.ts re-exports the same WIDTH');
  assert.equal(cols!.clampWidth, w!.clampWidth, 'and the same clampWidth');
  assert.equal(typeof w!.useColumnWidths, 'function', 'useColumnWidths(scope) is exported');
  const cases: [string, number, number][] = [['title', 200, 200], ['title', 150, 160], ['title', 100, 160], ['rating', 60, 80], ['finished', 2000, 960], ['author', 212, 212]];
  for (const [k, px, want] of cases) assert.equal(w!.clampWidth(k, px), want, `clampWidth(${k}, ${px}) = ${want}`);
});
