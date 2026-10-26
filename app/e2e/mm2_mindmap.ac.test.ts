// Slice MM2 real-app test (L6, Appium mac2 on the built test app, D-382, TS-I7): docs/acceptance/mindmap.md
// FR-SYN-06 AC-34 (browsing and navigating the map writes nothing: on a copy of the fixture, open Pavouk, Neznámé
// metadata and Metadata; in each mindmap block move through every node with ↓, → and ←, open the field with Space and
// cancel with Esc, switch to List and back; every file's bytes, mtime and inode unchanged, no write reaches the
// vault). TEGG_TEST=1 with TEGG_NOW, a temporary Application Support and a temporary copy of the synthetic mindmap
// fixture plus new-empty/.tegg (D-62). Interface: docs/contracts/mm-mindmap.md §6.3, §6.4 (the `Edit node` textbox,
// the `Map` / `List` buttons, the tree `Map of <title>`), ms3-shell.md §1 (TEGG_ROUTE, `route-ready:` marks).
// Written from the ACs and the contracts only (D-61). Keys go through helpers/osa.ts (D-758: ⌘Q/⌘W only while Tegg
// is frontmost; none are sent here).
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { join, relative } from 'node:path';
import { FX, MARK_TIMEOUT, appiumDown, changedPaths, end, need, osa, paste, press, ready, session, shown, sleep, support, testEnv, tmp, tree, waitMark, type Driver } from './helpers/capture.ts';

after(appiumDown);
process.on('exit', appiumDown);

const NOW_MM = '2026-10-22T10:00:00+02:00';
const PAVOUK = 'Pages/Pavouk.md';

function mindmapCopy(base: string): string {
  const v = join(base, 'Mapy');
  const src = join(FX, 'mindmap');
  cpSync(src, v, { recursive: true, filter: (s) => relative(src, s) !== 'README.md' });
  cpSync(join(FX, 'new-empty/.tegg'), join(v, '.tegg'), { recursive: true });
  return v;
}
const uiState = (sup: string) => (existsSync(join(sup, 'ui-state.json')) ? readFileSync(join(sup, 'ui-state.json'), 'utf8') : '');
/** ⇧⌘F, the title pasted into `Search query`, ⏎ (D-760). */
async function goTo(title: string) {
  osa('tell application "System Events" to key code 3 using {command down, shift down}');
  await sleep(500);
  paste(title);
  await sleep(700);
  press('enter');
  await sleep(1200);
}

test('fr_syn_06_ac34_navigating_the_map_writes_nothing_in_the_real_app', { timeout: 600_000 }, async () => {
  await ready();
  const base = tmp('mm2-ac34');
  const vault = mindmapCopy(base);
  const sup = support(base);
  const before = tree(vault);
  let d: Driver | undefined;
  try {
    const log = join(base, 'perf.jsonl');
    d = await session(testEnv(sup, log, { TEGG_VAULT: vault, TEGG_ROUTE: `note/${PAVOUK}`, TEGG_NOW: NOW_MM }));
    assert.ok(await waitMark(log, `route-ready:note/${PAVOUK}`, MARK_TIMEOUT), 'Pavouk shown');
    // [note title, tree name, node count]: every node with ↓ (outline order), then → and ← on each side (D-790).
    const tour: [string, string, number][] = [['Pavouk', 'Map of Pavouk', 8], ['Neznámé metadata', 'Map of Cizí', 2], ['Metadata', 'Map of Velká písmena', 4]];
    for (const [title, treeName, count] of tour) {
      if (title !== 'Pavouk') await goTo(title);
      const t = await need(d, treeName, 5000);
      assert.ok(await shown(d, 'Mindmap layout', 3000), `${title}: the layout switch is shown (untouched)`);
      await t.click();
      for (let i = 0; i < count; i++) press('down');
      press('up');
      press('right');
      press('right');
      press('left');
      press('left');
      press('left');
      press('right');
      await sleep(300);
      // the field: Space opens it, Esc cancels (R95a); on a synthesized root Space does nothing
      press('space');
      await sleep(400);
      if (title !== 'Metadata') assert.ok(await shown(d, 'Edit node', 3000), `${title}: Space opens the textbox "Edit node"`);
      press('escape');
      await sleep(300);
      assert.ok(!(await shown(d, 'Edit node', 500)), `${title}: Esc closes the field`);
      await (await need(d, 'List')).click();
      await sleep(400);
      await (await need(d, 'Map')).click();
      await sleep(400);
    }
    await sleep(2000);
  } finally {
    await end(d);
  }
  assert.deepEqual(changedPaths(before, tree(vault)), [], 'every vault file unchanged (bytes, mtime, inode), nothing created');
  assert.ok(!/mindmap|layout/i.test(uiState(sup)), 'ui-state.json gains no mindmap or layout key');
  rmSync(base, { recursive: true, force: true });
});
