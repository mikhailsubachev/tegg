// Slice MM real-app tests (L6, Appium mac2 on the built test app, D-382, TS-I7): docs/acceptance/mindmap.md
// FR-MMP-02 AC-7 (relaunch part: a mindmap switched to List opens in Map after a relaunch; the view is never written,
// D-684, D-776) and FR-SYN-06 AC-33 (a browsing tour writes nothing: bytes, mtime and inode of every vault file
// unchanged, nothing created, no mindmap key in `ui-state.json`). TEGG_TEST=1 with TEGG_NOW, a temporary Application
// Support and a temporary copy of the synthetic mindmap fixture plus new-empty/.tegg (D-62). Interface:
// docs/contracts/mm-mindmap.md §4 (the `Map` / `List` buttons with `aria-pressed`, the tree `Map of <title>`),
// ms3-shell.md §1 (TEGG_ROUTE, `route-ready:` marks). Written from the ACs and the contracts only (D-61). Keys go
// through helpers/osa.ts (D-758: ⌘Q/⌘W only while Tegg is frontmost; none are sent here).
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import {
  FX, MARK_TIMEOUT, appiumDown, changedPaths, end, need, osa, paste, press, ready, session, shown, sleep, support, testEnv, tmp, tree, waitMark,
  type Driver,
} from './helpers/capture.ts';

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
function sirokaText(): string {
  const items = Array.from({ length: 7 }, (_, i) => `Dlouhá větev číslo ${i + 1} se čtyřiceti znaky`.padEnd(40, '.').slice(0, 40));
  return '---\nid: 01JB4M0000000000000000M020\ntype: page\ntitle: Široká mapa\n---\n> [!mindmap] Široká\n' + items.map((t, i) => `> ${'  '.repeat(i)}- ${t}`).join('\n') + '\n';
}
const uiState = (sup: string) => (existsSync(join(sup, 'ui-state.json')) ? readFileSync(join(sup, 'ui-state.json'), 'utf8') : '');
/** `aria-pressed` as XCUITest reports a toggle button: value 1 / 0. */
async function isPressed(d: Driver, label: string): Promise<string> {
  const e = await need(d, label, 5000);
  return String(await e.getAttribute('value').catch(() => ''));
}
/** ⇧⌘F, the title pasted into `Search query`, ⏎ (D-760). */
async function goTo(title: string) {
  osa('tell application "System Events" to key code 3 using {command down, shift down}');
  await sleep(500);
  paste(title);
  await sleep(700);
  press('enter');
  await sleep(1200);
}

test('fr_mmp_02_ac7_view_resets_to_map_after_a_relaunch', { timeout: 300_000 }, async () => {
  await ready();
  const base = tmp('mm-ac7');
  const vault = mindmapCopy(base);
  const sup = support(base);
  const before = tree(vault);
  const ui0 = uiState(sup);
  let d: Driver | undefined;
  try {
    const log = join(base, 'perf.jsonl');
    d = await session(testEnv(sup, log, { TEGG_VAULT: vault, TEGG_ROUTE: `note/${VYJEZD}`, TEGG_NOW: NOW_MM }));
    assert.ok(await waitMark(log, `route-ready:note/${VYJEZD}`, MARK_TIMEOUT), 'Výjezd 2026 shown');
    assert.ok(await shown(d, 'Map of Výjezd 2026', 5000), 'the tree "Map of Výjezd 2026"');
    assert.equal(await isPressed(d, 'Map'), '1', 'opens in Map');
    await (await need(d, 'List')).click();
    await sleep(500);
    assert.equal(await isPressed(d, 'List'), '1', 'switched to List');
    await end(d);
    d = undefined;
    assert.ok(!/mindmap/i.test(uiState(sup)), 'ui-state.json has no mindmap key');
    const log2 = join(base, 'perf2.jsonl');
    d = await session(testEnv(sup, log2, { TEGG_VAULT: vault, TEGG_ROUTE: `note/${VYJEZD}`, TEGG_NOW: NOW_MM }));
    assert.ok(await waitMark(log2, `route-ready:note/${VYJEZD}`, MARK_TIMEOUT), 'Výjezd 2026 shown after the relaunch');
    assert.equal(await isPressed(d, 'Map'), '1', 'after a relaunch it opens in Map (D-776)');
    assert.equal(await isPressed(d, 'List'), '0', 'List not pressed');
  } finally {
    await end(d);
  }
  assert.deepEqual(changedPaths(before, tree(vault)), [], 'no vault file changed, nothing created (bytes, mtime, inode)');
  assert.equal(JSON.parse(uiState(sup) || '{}').theme, JSON.parse(ui0).theme, 'the UI state keeps its keys');
  assert.ok(!/mindmap/i.test(uiState(sup)), 'no mindmap key in ui-state.json');
  rmSync(base, { recursive: true, force: true });
});

test('fr_syn_06_ac33_browsing_tour_writes_nothing_in_the_real_app', { timeout: 900_000 }, async () => {
  await ready();
  const base = tmp('mm-ac33');
  const vault = mindmapCopy(base);
  writeFileSync(join(vault, 'Pages/Široká mapa.md'), sirokaText());
  const sup = support(base);
  const before = tree(vault);
  let d: Driver | undefined;
  try {
    const log = join(base, 'perf.jsonl');
    d = await session(testEnv(sup, log, { TEGG_VAULT: vault, TEGG_ROUTE: `note/${VYJEZD}`, TEGG_NOW: NOW_MM }));
    assert.ok(await waitMark(log, `route-ready:note/${VYJEZD}`, MARK_TIMEOUT), 'Výjezd 2026 shown');
    const tour: [string, string][] = [
      ['Výjezd 2026', 'Map of Výjezd 2026'], ['Uzly', 'Map of Uzly'], ['Nákup', 'Map of Mindmap'], ['Postup', 'Map of Postup'],
      ['Více kořenů', 'Map of Témata'], ['Bez titulku', 'Map of Mindmap'], ['Holá mapa', 'Map of Mindmap'], ['Rozpoznání', 'Map of Navazující text'],
      ['Z Obsidianu', 'Map of Z Obsidianu'], ['Rozložení', 'Map of Strom'], ['Rozbalení', 'Map of Titulek mapy'], ['Široká mapa', 'Map of Široká'],
      ['Mermaid', ''], ['Převody', ''], ['Lisabon', ''], ['Prázdná', ''], ['Zalít květiny', ''],
    ];
    for (const [title, treeName] of tour) {
      await goTo(title);
      if (!treeName) continue;
      const t = await need(d, treeName, 5000);
      // every mindmap block to List and back, a node click, arrows through the tree
      await (await need(d, 'List')).click();
      await sleep(300);
      await (await need(d, 'Map')).click();
      await sleep(300);
      await t.click();
      for (let i = 0; i < 8; i++) press('down');
      press('up');
      if (title === 'Široká mapa') await d.execute('macos: scroll', { elementId: t.elementId, deltaX: -600, deltaY: 0 }).catch(() => {});
      await (await need(d, 'Map')).click().catch(() => {});
    }
    await goTo('Složené');
    await (await need(d, 'Expand Složená mapa', 5000)).click();
    await (await need(d, 'Collapse Složená mapa', 3000)).click();
    await (await need(d, 'Expand Složená mapa', 3000)).click();
    await goTo('Výjezd 2026');
    await (await need(d, 'List', 5000)).click();
    await (await need(d, 'Doprava', 3000)).click();
    osa('tell application "System Events" to key code 44 using {command down}'); // ⌘/ block menu
    assert.ok(await shown(d, 'Block actions', 3000), 'the block menu');
    await (await need(d, 'Turn into')).click();
    press('escape');
    press('escape');
    osa('tell application "System Events" to key code 44 using {command down}');
    const drv = d;
    if (!(await shown(drv, 'Callout type', 1000))) await (await need(drv, 'Turn into')).click();
    await (await need(drv, 'Callout type')).click();
    press('escape');
    press('escape');
    await (await need(d, 'Map')).click();
    await (await need(d, 'Lisabon', 3000)).click();
    assert.ok(await waitMark(log, 'route-ready:note/Pages/Lisabon.md', 5000) || (await shown(d, 'Město výjezdu.', 3000)), 'Lisabon followed');
    press('lbracket', ['command']);
    await sleep(800);
    await goTo('Neplatná mapa');
    if (await shown(d, 'Show formatted note', 3000)) await (await need(d, 'Show formatted note')).click();
    assert.ok(await shown(d, 'Map of Jen ke čtení', 5000), 'the read view shows the map');
    await goTo('Vložení');
    assert.ok(await shown(d, 'Map of Výjezd 2026', 5000), 'the embedded note shows its map');
    await sleep(2000);
  } finally {
    await end(d);
  }
  assert.deepEqual(changedPaths(before, tree(vault)), [], 'every vault file unchanged (bytes, mtime, inode), nothing created');
  assert.ok(!/mindmap/i.test(uiState(sup)), 'ui-state.json gains no mindmap key');
  rmSync(base, { recursive: true, force: true });
});
