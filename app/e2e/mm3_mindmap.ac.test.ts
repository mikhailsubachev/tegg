// Slice MM3 real-app tests (L6, Appium mac2 on the built test app, D-382, TS-I7): docs/acceptance/mindmap.md part three.
// FR-MMP-02 AC-45 (folds are view state: a fold doesn't survive a relaunch, writes nothing and adds no key to
// ui-state.json) and FR-SYN-06 AC-58 (browsing, folding, hovering and cancelled drags in Výjezd, Pavouk, Bratranci and
// Více kořenů, and folding in Výjezd's read view, change no vault file: bytes, mtime and inode; nothing created; no
// `mindmap`, `fold` or `collapsed` key in ui-state.json). TEGG_TEST=1 with TEGG_NOW, a temporary Application Support
// and a temporary copy of the synthetic mindmap fixture plus new-empty/.tegg (D-62). Interface: docs/contracts/
// mm-mindmap.md §7.5 (the fold control `Collapse <node>` / `Expand <node>, <n> hidden`, `Add child to <node>`), ms3-shell
// §1 (TEGG_ROUTE, `route-ready:` marks). Keys go through helpers/osa.ts (D-758, D-799: keys only while Tegg is
// frontmost). Drags use mac2's `macos: clickAndDragAndHold`. Written from the ACs and the contracts only (D-61).
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { join, relative } from 'node:path';
import { FX, MARK_TIMEOUT, appiumDown, changedPaths, end, need, paste, press, ready, session, shown, sleep, support, testEnv, tmp, tree, waitMark, type Driver } from './helpers/capture.ts';

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
const uiState = (sup: string) => (existsSync(join(sup, 'ui-state.json')) ? readFileSync(join(sup, 'ui-state.json'), 'utf8') : '');
/** ⇧⌘F, the title pasted into `Search query`, ⏎ (D-760). */
async function goTo(title: string) {
  press('f', ['command', 'shift']);
  await sleep(500);
  paste(title);
  await sleep(700);
  press('enter');
  await sleep(1200);
}
async function centre(d: Driver, label: string): Promise<{ x: number; y: number }> {
  const e = await need(d, label, 5000);
  const r = await d.getElementRect(e.elementId);
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
}
/** A pointer drag from `from` to `to` held for `holdMs`; `escape` presses Esc while the button is still held. */
async function drag(d: Driver, from: { x: number; y: number }, to: { x: number; y: number }, o: { holdMs?: number; escape?: boolean } = {}) {
  const run = d.execute('macos: clickAndDragAndHold', { startX: from.x, startY: from.y, endX: to.x, endY: to.y, duration: 0.3, holdDuration: (o.holdMs ?? 300) / 1000, velocity: 600 });
  if (o.escape) { await sleep(600); press('escape'); }
  await run.catch(() => {});
  await sleep(400);
}

test('fr_mmp_02_ac45_folds_end_with_a_relaunch_in_the_real_app', { timeout: 600_000 }, async () => {
  await ready();
  const base = tmp('mm3-ac45');
  const vault = mindmapCopy(base);
  const sup = support(base);
  const before = tree(vault);
  let d: Driver | undefined;
  try {
    const log = join(base, 'perf-1.jsonl');
    d = await session(testEnv(sup, log, { TEGG_VAULT: vault, TEGG_ROUTE: `note/${VYJEZD}`, TEGG_NOW: NOW_MM }));
    assert.ok(await waitMark(log, `route-ready:note/${VYJEZD}`, MARK_TIMEOUT), 'Výjezd 2026 shown');
    await (await need(d, 'Program', 5000)).click();
    press('space');
    await sleep(500);
    assert.ok(await shown(d, 'Expand Program, 2 hidden', 3000), 'Space folds Program (the control Expand Program, 2 hidden)');
    assert.ok(!(await shown(d, 'Přehled Q4', 500)), 'Přehled Q4 is hidden');
    await (await need(d, 'Místo')).click();
    press('space');
    await sleep(500);
    assert.ok(await shown(d, 'Expand Místo, 1 hidden', 3000), 'Místo folded');
    await sleep(2000);
  } finally {
    await end(d);
    d = undefined;
  }
  try {
    const log = join(base, 'perf-2.jsonl');
    d = await session(testEnv(sup, log, { TEGG_VAULT: vault, TEGG_ROUTE: `note/${VYJEZD}`, TEGG_NOW: NOW_MM }));
    assert.ok(await waitMark(log, `route-ready:note/${VYJEZD}`, MARK_TIMEOUT), 'Výjezd 2026 shown after the relaunch');
    await need(d, 'Map of Výjezd 2026', 5000);
    assert.ok(await shown(d, 'Přehled Q4', 3000) && (await shown(d, 'Lisabon', 3000)), 'after a relaunch the map shows unfolded (D-2601)');
    assert.ok(!(await shown(d, 'Expand Program, 2 hidden', 500)), 'no folded control');
  } finally {
    await end(d);
  }
  assert.deepEqual(changedPaths(before, tree(vault)), [], 'every vault file unchanged (bytes, mtime, inode), nothing created');
  assert.ok(!/mindmap|fold|collapsed/i.test(uiState(sup)), 'ui-state.json gains no fold key');
  rmSync(base, { recursive: true, force: true });
});

test('fr_syn_06_ac58_browsing_folding_and_cancelled_drags_write_nothing_in_the_real_app', { timeout: 900_000 }, async () => {
  await ready();
  const base = tmp('mm3-ac56');
  const vault = mindmapCopy(base);
  const sup = support(base);
  const before = tree(vault);
  let d: Driver | undefined;
  try {
    const log = join(base, 'perf.jsonl');
    d = await session(testEnv(sup, log, { TEGG_VAULT: vault, TEGG_ROUTE: `note/${VYJEZD}`, TEGG_NOW: NOW_MM }));
    assert.ok(await waitMark(log, `route-ready:note/${VYJEZD}`, MARK_TIMEOUT), 'Výjezd 2026 shown');
    // [note, tree, nodes with children, a first-level node, its first child, the keys that walk every visible node]
    const maps: [string, string, string[], string, string, string[]][] = [
      ['Výjezd 2026', 'Map of Výjezd 2026', ['Výjezd 2026', 'Program', 'Místo'], 'Program', 'Přehled Q4', ['right', 'right', 'down', 'down', 'left', 'down', 'right', 'down', 'up', 'home', 'end']],
      ['Pavouk', 'Map of Pavouk', ['Střed', 'Alfa', 'Beta'], 'Alfa', 'A1', ['right', 'right', 'down', 'down', 'right', 'right', 'left', 'down', 'down', 'up']],
      ['Bratranci', 'Map of Bratranci', ['Kořen', 'Alfa', 'A2', 'Gama', 'G1'], 'Alfa', 'A1', ['right', 'right', 'down', 'right', 'down', 'down', 'up', 'left', 'left', 'down', 'down', 'right', 'down', 'up']],
      ['Více kořenů', 'Map of Témata', ['Témata', 'Práce'], 'Práce', 'Porady', ['right', 'down', 'down', 'up', 'right', 'left', 'home', 'end']],
    ];
    for (const [title, treeName, parents, first, child, keys] of maps) {
      if (title !== 'Výjezd 2026') await goTo(title);
      const t = await need(d, treeName, 5000);
      await t.click();
      for (const k of keys) press(k);
      await sleep(300);
      for (const p of parents) {
        await (await need(d, p, 3000)).click();
        press('space');
        await sleep(300);
        const sp = await d.$(`-ios predicate string:label BEGINSWITH "Expand ${p}, "`);
        assert.ok(await sp.isDisplayed().catch(() => false), `${title}: Space folded ${p}`);
        press('space');
        await sleep(300);
        // by its control: hover the node, click `Collapse <p>`, then `Expand <p>, …` (not on the root, whose name the
        // callout header's own fold button may share, AP-2116; the root is folded by Space above)
        if (treeName === `Map of ${p}`) continue;
        await (await need(d, p, 3000)).moveTo();
        await (await need(d, `Collapse ${p}`, 3000)).click();
        await sleep(300);
        const exp = await d.$(`-ios predicate string:label BEGINSWITH "Expand ${p}, "`);
        assert.ok(await exp.isDisplayed().catch(() => false), `${title}: Collapse ${p} folded it`);
        await exp.click();
        await sleep(300);
      }
      // hover every parent: the `+` shows and isn't clicked
      for (const p of parents) {
        await (await need(d, p, 3000)).moveTo();
        assert.ok(await shown(d, `Add child to ${p}`, 2000), `${title}: hovering ${p} shows its \`+\``);
      }
      const a = await centre(d, first);
      const c = await centre(d, child);
      const box = await d.getElementRect((await need(d, treeName)).elementId);
      await drag(d, a, { x: a.x, y: a.y + 60 }, { holdMs: 1500, escape: true });
      await drag(d, a, { x: c.x + 6, y: c.y + 4 });
      await drag(d, a, { x: box.x + box.width - 10, y: box.y + 8 });
    }
    // RT-10: the built app shows the read view for read-only notes only (D-117, D-215), so the read-view fold of the
    // criterion is done on Neplatná mapa (invalid frontmatter, shown read-only); L5 covers Výjezd's read view (AC-46).
    await goTo('Neplatná mapa');
    if (await shown(d, 'Show formatted note', 3000)) await (await need(d, 'Show formatted note')).click();
    await need(d, 'Map of Jen ke čtení', 5000);
    await (await need(d, 'Druhá větev', 3000)).click();
    press('left');
    press('space');
    await sleep(400);
    assert.ok(await shown(d, 'Expand Jen ke čtení, 2 hidden', 3000), 'the read view folds the root');
    press('space');
    await sleep(2000);
  } finally {
    await end(d);
  }
  assert.deepEqual(changedPaths(before, tree(vault)), [], 'every vault file unchanged (bytes, mtime, inode), nothing created');
  assert.ok(!/mindmap|fold|collapsed/i.test(uiState(sup)), 'ui-state.json gains no key containing mindmap, fold or collapsed');
  rmSync(base, { recursive: true, force: true });
});
