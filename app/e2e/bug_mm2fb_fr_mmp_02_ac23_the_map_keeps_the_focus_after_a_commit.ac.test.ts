// Regression (L6, Appium mac2 on the built test app), owner feedback on MM2: after editing a node's text on the map
// and committing it with ⏎, the map lost the focus, so the next ⏎ did nothing (FR-MMP-02 AC-23, R95: the committed
// node keeps the focus). On a copy of the mindmap fixture: click `Plán 2027`, Space, type, ⏎; after the autosave a
// second ⏎ must open the `Edit node` field of a new sibling, which only a focused node does; the same after committing
// that new node. TEGG_TEST=1 with TEGG_NOW, a temporary Application Support and vault (D-62).
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, rmSync } from 'node:fs';
import { join, relative } from 'node:path';
import { FX, MARK_TIMEOUT, appiumDown, end, need, press, read, ready, session, shown, sleep, support, testEnv, tmp, typeAscii, waitFile, waitMark, type Driver } from './helpers/capture.ts';

after(appiumDown);
process.on('exit', appiumDown);

const NOW_MM = '2026-10-22T10:00:00+02:00';
const VYJEZD = 'Pages/Výjezd 2026.md';

function mindmapCopy(base: string): string {
  const v = join(base, 'Mapy');
  const src = join(FX, 'mindmap');
  cpSync(src, v, { recursive: true, filter: (s) => relative(src, s) !== 'README.md' });
  cpSync(join(FX, 'new-empty/.tegg'), join(v, '.tegg'), { recursive: true });
  return v;
}

test('bug_mm2fb_fr_mmp_02_ac23_the_map_keeps_the_focus_after_a_commit', { timeout: 300_000 }, async () => {
  await ready();
  const base = tmp('mm2-focus');
  const vault = mindmapCopy(base);
  const sup = support(base);
  let d: Driver | undefined;
  try {
    const log = join(base, 'perf.jsonl');
    d = await session(testEnv(sup, log, { TEGG_VAULT: vault, TEGG_ROUTE: `note/${VYJEZD}`, TEGG_NOW: NOW_MM }));
    assert.ok(await waitMark(log, `route-ready:note/${VYJEZD}`, MARK_TIMEOUT), 'Výjezd 2026 shown');
    await need(d, 'Map of Výjezd 2026', 5000);
    await (await need(d, 'Plán 2027', 5000)).click();
    await sleep(300);
    // the text field: Space, the text, ⏎ (R95a)
    press('space');
    assert.ok(await shown(d, 'Edit node', 3000), 'Space opens the textbox "Edit node"');
    typeAscii(' v2');
    press('enter');
    const t1 = await waitFile(join(vault, VYJEZD), (t) => !!t?.includes('>     - Plán 2027 v2\n'), 6000);
    assert.ok(t1?.includes('>     - Plán 2027 v2\n'), 'the edit is saved');
    await sleep(1500);
    assert.ok(!(await shown(d, 'Edit node', 300)), 'the field is closed');
    // ⏎ on the still focused node adds a sibling (R95)
    press('enter');
    assert.ok(await shown(d, 'Edit node', 3000), 'after the commit and the save, ⏎ opens a new node: the map kept the focus');
    typeAscii('Novy');
    press('enter');
    const t2 = await waitFile(join(vault, VYJEZD), (t) => !!t?.includes('>     - Plán 2027 v2\n>     - Novy\n'), 6000);
    assert.ok(t2?.includes('>     - Plán 2027 v2\n>     - Novy\n'), 'the new sibling is saved after Plán 2027 v2');
    await sleep(1500);
    press('enter');
    assert.ok(await shown(d, 'Edit node', 3000), 'after committing the new node, ⏎ opens another one: the map kept the focus');
    press('escape');
    await sleep(500);
    // the same with the pointer: a double-click opens the field (R95a), ⏎ commits, ⏎ again adds a sibling
    await (await need(d, 'Doprava', 5000)).doubleClick();
    assert.ok(await shown(d, 'Edit node', 3000), 'a double-click opens the textbox "Edit node"');
    typeAscii(' auto');
    press('enter');
    const t3 = await waitFile(join(vault, VYJEZD), (t) => !!t?.includes('>   - Doprava auto\n'), 6000);
    assert.ok(t3?.includes('>   - Doprava auto\n'), 'the pointer edit is saved');
    await sleep(1500);
    press('enter');
    assert.ok(await shown(d, 'Edit node', 3000), 'after a double-click edit and its save, ⏎ opens a new node: the map kept the focus');
    press('escape');
    await sleep(500);
  } finally {
    await end(d);
  }
  assert.ok(!read(vault, VYJEZD)?.includes('- \n'), 'the cancelled pending node is never written');
  rmSync(base, { recursive: true, force: true });
});
