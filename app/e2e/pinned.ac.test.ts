// Slice PIN real-app tests (L6, Appium mac2 on the built test app, D-382): docs/acceptance/pinned.md, every L6-marked
// criterion: FR-HOM-02 AC-1 (once: the section and its rows), AC-5 (once: the first pin creates expected/created.yml, an
// exclusive create, nothing before it), AC-10 (once: a pointer reorder writes expected/valid-after-move.yml), AC-13 (a chip
// dragged out of Odkazy never changes the note: bytes, mtime, inode), AC-15 (the collapsed state survives a relaunch),
// AC-18 (once with the helper: a deleted target is `Not found`, never unpinned, and comes back), AC-20 (pending, never
// `Not found`, while the first index build runs), AC-22 (once: an unreadable file is never rewritten), FR-SYN-03 AC-27
// (once with the helper: outside changes reload the rows; conflict copies untouched), FR-SYN-06 AC-43 (the tour writes
// nothing; each pin action writes only .tegg/pinned.yml), FR-UX-08 AC-16 (once: the macOS accessibility tree's names) and
// FR-NAV-04 AC-9 (once: the sidebar order). Interface docs/contracts/v1-pinned.md §3.2, §4, §5 (`TEGG_TEST_HOLD=
// first-index:<ms>`, the external helper). Always TEGG_TEST=1 with the PIN test clock, a temporary Application Support and
// a temporary copy of tests/fixtures/vaults/pinned plus tests/fixtures/pinned-files (D-62). Keys go only to Tegg (D-799):
// every key is sent while Tegg is frontmost (helpers/capture.ts `press`). Written from the ACs and the contract only
// (D-61).
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import {
  FX, REPO, appiumDown, changedPaths, end, marks, need, needMenuItem, palette, press, ready, session, shown, sleep, support, testEnv, textContains,
  tmp, tree, waitFor, type Driver, type Env,
} from './helpers/capture.ts';

after(appiumDown);
process.on('exit', appiumDown);

const NOW_PIN = '2026-11-07T10:00:00+01:00';
const YML = '.tegg/pinned.yml';
const PINS = join(REPO, 'tests/fixtures/pinned-files');
const EXTERNAL = resolve(import.meta.dirname, 'helpers/external.ts');
const fx = (name: string) => readFileSync(join(PINS, name), 'utf8');
const P = {
  rozpocet: 'Projekty/Rozpočet 2027.md', lisabon: 'Projekty/Výjezd Lisabon 2026.md', porada: 'Schůzky/2026-10-07 Týdenní porada.md',
  odkazy: 'Pages/Odkazy.md', cajovna: 'Pages/Čajovna.md',
};
const ROWS = ['Rozpočet 2027', 'Výjezd Lisabon 2026', '2026-10-07 Týdenní porada', '#offsite', 'Projekty'];

/** A temp copy of tests/fixtures/vaults/pinned (without README.md) plus new-empty/.tegg, Čajovna renamed to its NFD name
 *  (fixture README), and, when given, a pinned-files sample as `.tegg/pinned.yml`. */
function vaultCopy(base: string, pins: string | null, name = 'Pinned'): string {
  const v = join(base, name);
  const src = join(FX, 'pinned');
  cpSync(src, v, { recursive: true, filter: (s) => relative(src, s) !== 'README.md' });
  cpSync(join(FX, 'new-empty/.tegg'), join(v, '.tegg'), { recursive: true });
  renameSync(join(v, P.cajovna), join(v, P.cajovna.normalize('NFD')));
  if (pins !== null) writeFileSync(join(v, YML), fx(pins));
  return v;
}
type Ctx = { base: string; vault: string; sup: string; log: string; d?: Driver; n: number };
function fresh(name: string, pins: string | null): Ctx {
  const base = tmp(`pin-${name}`);
  return { base, vault: vaultCopy(base, pins), sup: support(base), log: join(base, 'perf.jsonl'), n: 0 };
}
async function launch(c: Ctx, route = 'inbox', extra: Env = {}): Promise<Driver> {
  c.n += 1;
  c.log = join(c.base, `perf-${c.n}.jsonl`);
  c.d = await session(testEnv(c.sup, c.log, { TEGG_VAULT: c.vault, TEGG_ROUTE: route, TEGG_NOW: NOW_PIN, ...extra }));
  const want = `route-ready:${route.normalize('NFC')}`;
  assert.ok(await waitFor(() => marks(c.log).map((m) => m.normalize('NFC')).includes(want), 20_000), `${route} shown (route-ready)`);
  return c.d;
}
async function relaunch(c: Ctx, route = 'inbox'): Promise<Driver> {
  await end(c.d);
  c.d = undefined;
  return launch(c, route);
}
async function cleanup(c: Ctx) {
  await end(c.d);
  rmSync(c.base, { recursive: true, force: true });
}
function external(...args: string[]) {
  execFileSync(process.execPath, [EXTERNAL, ...args], { encoding: 'utf8' });
}
function externalWrite(c: Ctx, rel: string, text: string | Buffer) {
  const f = join(c.base, `ext-${Date.now()}.txt`);
  writeFileSync(f, text);
  external('write', join(c.vault, rel), f);
  rmSync(f, { force: true });
}
function externalReplace(c: Ctx, rel: string, text: string) {
  const f = join(c.base, `sync-${Date.now()}.tmp`);
  writeFileSync(f, text);
  external('rename', f, join(c.vault, rel));
}
async function textShown(d: Driver, text: string, ms = 3000): Promise<boolean> {
  return waitFor(async () => {
    for (const e of await d.$$(`-ios predicate string:${textContains(text)}`).catch(() => [] as any[])) if (await e.isDisplayed().catch(() => false)) return true;
    return false;
  }, ms);
}
const read = (c: Ctx, rel: string) => (existsSync(join(c.vault, rel)) ? readFileSync(join(c.vault, rel), 'utf8') : null);
const uiState = (sup: string) => (existsSync(join(sup, 'ui-state.json')) ? JSON.parse(readFileSync(join(sup, 'ui-state.json'), 'utf8')) : null);
const stamp = (c: Ctx, rel: string) => tree(c.vault)[rel.normalize('NFC')] ?? null;
async function rect(d: Driver, label: string) {
  const e = await need(d, label, 5000);
  return d.getElementRect(e.elementId);
}
/** A pointer drag in the real app (`macos: clickAndDrag`, coordinates; D-1355's harness passes them on). */
async function dragFromTo(d: Driver, from: { x: number; y: number }, to: { x: number; y: number }) {
  await d.execute('macos: clickAndDrag', { startX: Math.round(from.x), startY: Math.round(from.y), endX: Math.round(to.x), endY: Math.round(to.y), duration: 0.6 });
  await sleep(500);
}
const centre = (r: { x: number; y: number; width: number; height: number }) => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 });
/** The rect of the Types entry whose label starts with `plural` (its name carries the count, D-1427). */
async function typesEntry(d: Driver, plural: string) {
  for (const e of await d.$$(`-ios predicate string:label BEGINSWITH "${plural}"`).catch(() => [] as any[])) {
    if (await e.isDisplayed().catch(() => false)) return d.getElementRect(e.elementId);
  }
  return assert.fail(`Types entry ${plural} is shown`);
}
/** The shown element with one of these labels furthest right: a chip in the editor, not a sidebar row (D-1425). */
async function chipRect(d: Driver, labels: string[]) {
  let best: { x: number; y: number; width: number; height: number } | null = null;
  for (const label of labels) {
    const l = label.replace(/"/g, '\\"');
    for (const e of await d.$$(`-ios predicate string:(label == "${l}" OR title == "${l}" OR value == "${l}")`).catch(() => [] as any[])) {
      if (!(await e.isDisplayed().catch(() => false))) continue;
      const r = await d.getElementRect(e.elementId);
      if (!best || r.x > best.x) best = r;
    }
  }
  assert.ok(best, `chip ${labels[0]} is shown`);
  return best!;
}
async function rowsInOrder(d: Driver, labels: string[]): Promise<boolean> {
  const ys: number[] = [];
  for (const l of labels) { if (!(await shown(d, l, 3000))) return false; ys.push((await rect(d, l)).y); }
  return ys.every((y, i) => i === 0 || y > ys[i - 1]);
}

// ------------------------------------------------------------------------------------------------ FR-HOM-02 AC-1, FR-NAV-04 AC-9, FR-UX-08 AC-16

test('fr_hom_02_ac1_section_place_and_rows_in_the_real_app', { timeout: 300_000 }, async () => {
  await ready();
  const c = fresh('ac1', 'valid.yml');
  try {
    const d = await launch(c);
    assert.ok(await shown(d, 'Pinned', 5000), 'the header `Pinned`');
    assert.ok(await rowsInOrder(d, ROWS), 'five rows in file order');
    assert.equal(await textShown(d, 'Otevřené úkoly tento týden', 500), false, 'the query item isn\'t drawn');
  } finally { await cleanup(c); }
});

test('fr_nav_04_ac9_order_with_pinned_section_in_the_real_app', { timeout: 300_000 }, async () => {
  await ready();
  const c = fresh('nav9', 'valid.yml');
  try {
    const d = await launch(c);
    const order = ['Inbox', 'Today', 'Tasks', 'Pinned', 'Rozpočet 2027', 'Pages', 'Tags', 'Saved queries', 'Trash'];
    const ys: number[] = [];
    for (const l of order) ys.push((await rect(d, l)).y);
    for (let i = 1; i < ys.length; i++) assert.ok(ys[i] > ys[i - 1], `${order[i]} below ${order[i - 1]} (${ys.join(', ')})`);
  } finally { await cleanup(c); }
});

test('fr_ux_08_ac16_pins_for_voiceover_in_the_real_app', { timeout: 300_000 }, async () => {
  await ready();
  const c = fresh('ux16', 'valid.yml');
  try {
    const d = await launch(c);
    await need(d, 'Pinned', 5000);
    // D-1424: the description is the hidden text after the header (span.sr-only), as the Inbox entry's (R62).
    assert.ok(await textShown(d, '5 pinned items', 3000), "the header's description `5 pinned items` in the tree (span.sr-only)");
    for (const [label, desc] of [['Výjezd Lisabon 2026', 'Projekt'], ['#offsite', 'Tag'], ['Projekty', 'Type page']]) {
      assert.ok(await shown(d, label, 3000), `${label} in the tree`);
      assert.ok(await textShown(d, desc, 3000), `its description ${desc} in the tree (span.sr-only)`);
    }
    assert.equal(await shown(d, 'Drag to reorder', 500), false, 'the grip isn\'t in the tree');
  } finally { await cleanup(c); }
});

// ------------------------------------------------------------------------------------------------ FR-HOM-02 AC-5

test('fr_hom_02_ac5_pin_from_more_creates_the_file_once_in_the_real_app', { timeout: 300_000 }, async () => {
  await ready();
  const c = fresh('ac5', null);
  try {
    let d = await launch(c, `note/${P.rozpocet}`);
    await need(d, 'Pinned', 5000);
    assert.equal(await textShown(d, 'Drag things here', 1000), false, 'nothing pinned: the section shows collapsed, no area (D-1429)');
    await (await need(d, 'Pinned')).click();
    assert.ok(await textShown(d, 'Drag things here', 3000), 'a click on the header shows the empty area');
    await (await need(d, 'Pinned')).click();
    d = await relaunch(c, `note/${P.rozpocet}`);
    assert.equal(read(c, YML), null, 'no .tegg/pinned.yml after launching, collapsing and relaunching');
    await (await need(d, 'More', 5000)).click();
    await (await needMenuItem(d, 'Pin to sidebar')).click();
    assert.ok(await waitFor(() => read(c, YML) !== null, 3000), 'the file is created');
    assert.equal(read(c, YML), fx('expected/created.yml'), 'byte-identical to expected/created.yml');
    assert.ok(await shown(d, 'Rozpočet 2027', 3000), 'the row replaces the empty area');
    assert.deepEqual(Object.keys(tree(c.vault)).filter((k) => k.endsWith('.tegg-tmp')), [], 'no temp file left');
  } finally { await cleanup(c); }
});

// ------------------------------------------------------------------------------------------------ FR-HOM-02 AC-10

test('fr_hom_02_ac10_reorder_by_pointer_in_the_real_app', { timeout: 300_000 }, async () => {
  await ready();
  const c = fresh('ac10', 'valid.yml');
  try {
    const d = await launch(c);
    assert.ok(await rowsInOrder(d, ROWS), 'rows');
    const from = centre(await rect(d, 'Výjezd Lisabon 2026'));
    const r = await rect(d, '#offsite');
    await dragFromTo(d, from, { x: r.x + r.width / 2, y: r.y + r.height - 2 });
    assert.ok(await waitFor(() => read(c, YML) === fx('expected/valid-after-move.yml'), 3000), 'expected/valid-after-move.yml');
    assert.ok(await rowsInOrder(d, ['Rozpočet 2027', '2026-10-07 Týdenní porada', '#offsite', 'Výjezd Lisabon 2026', 'Projekty']), 'the new order');
  } finally { await cleanup(c); }
});

// ------------------------------------------------------------------------------------------------ FR-HOM-02 AC-13

test('fr_hom_02_ac13_dragging_a_chip_never_edits_the_note_in_the_real_app', { timeout: 600_000 }, async () => {
  await ready();
  const c = fresh('ac13', 'valid.yml');
  try {
    const d = await launch(c, `note/${P.odkazy}`);
    assert.ok(await textShown(d, 'Neexistuje', 8000), 'Odkazy in the editor');
    const before = stamp(c, P.odkazy);
    // D-1425: the chip of [[Plán (2)]] shows its title `Plán` (D-73); a pinned row may have the same label, so the chip
    // is the match furthest right (the editor), never the sidebar row.
    for (const chip of [['Plán'], ['#offsite', 'offsite'], ['Rozpočet 2027']]) {
      const s = centre(await chipRect(d, chip));
      const sec = await rect(d, 'Projekty');
      await dragFromTo(d, s, { x: sec.x + sec.width / 2, y: sec.y + sec.height - 2 });
      const types = await rect(d, 'Pages');
      await dragFromTo(d, centre(await chipRect(d, chip)), centre(types));
      const line = await rect(d, 'Neexistuje');
      await dragFromTo(d, centre(await chipRect(d, chip)), { x: line.x + 10, y: line.y + line.height + 20 });
    }
    await sleep(2500);
    assert.deepEqual(stamp(c, P.odkazy), before, 'Pages/Odkazy.md: bytes, mtime and inode unchanged');
    assert.ok(String(read(c, YML)).includes('01JB5P00000000000000000011'), 'the section drop of [[Plán (2)]] pinned Plán 2');
    const n = read(c, YML);
    await dragFromTo(d, centre(await rect(d, 'Neexistuje')), centre(await rect(d, 'Projekty')));
    await sleep(800);
    assert.equal(read(c, YML), n, 'the broken chip pins nothing');
    assert.deepEqual(stamp(c, P.odkazy), before, 'still untouched');
  } finally { await cleanup(c); }
});

// ------------------------------------------------------------------------------------------------ FR-HOM-02 AC-15

test('fr_hom_02_ac15_collapse_is_remembered_after_a_relaunch', { timeout: 300_000 }, async () => {
  await ready();
  const c = fresh('ac15', 'valid.yml');
  try {
    let d = await launch(c);
    const before = tree(c.vault);
    await (await need(d, 'Pinned', 5000)).click();
    assert.ok(await waitFor(() => uiState(c.sup)?.vaults?.[realpathSync(c.vault).normalize('NFC')]?.sidebar?.pinnedCollapsed === true, 3000), 'ui-state.json: pinnedCollapsed true');
    assert.equal(await shown(d, 'Rozpočet 2027', 800), false, 'rows hidden');
    d = await relaunch(c);
    assert.ok(await shown(d, 'Pinned', 5000), 'header after the relaunch');
    assert.equal(await shown(d, 'Rozpočet 2027', 1500), false, 'still collapsed after the relaunch');
    assert.deepEqual(changedPaths(before, tree(c.vault)), [], 'no vault file written');
  } finally { await cleanup(c); }
});

// ------------------------------------------------------------------------------------------------ FR-HOM-02 AC-18

test('fr_hom_02_ac18_missing_targets_are_never_unpinned_silently_in_the_real_app', { timeout: 300_000 }, async () => {
  await ready();
  const c = fresh('ac18', 'valid.yml');
  try {
    const d = await launch(c);
    assert.ok(await rowsInOrder(d, ROWS), 'rows');
    const porada = readFileSync(join(c.vault, P.porada));
    external('delete', join(c.vault, P.porada));
    assert.ok(await textShown(d, 'Not found', 2000), 'Porada: `Not found` within 2 s');
    await (await need(d, '2026-10-07 Týdenní porada')).click();
    assert.ok(await textShown(d, 'can\'t be found. It was deleted, or moved outside Tegg.', 2000), 'the alert');
    await sleep(1000);
    assert.equal(read(c, YML), fx('valid.yml'), 'the item is never removed by Tegg');
    externalWrite(c, P.porada, porada);
    assert.ok(await waitFor(async () => !(await textShown(d, 'Not found', 300)), 2000), 'the file comes back: the row is restored within 2 s');
    assert.equal(read(c, YML), fx('valid.yml'), 'pins file untouched throughout');
  } finally { await cleanup(c); }
});

// ------------------------------------------------------------------------------------------------ FR-HOM-02 AC-20

test('fr_hom_02_ac20_pending_never_shows_missing_in_the_real_app', { timeout: 300_000 }, async () => {
  await ready();
  const c = fresh('ac20', 'valid.yml');
  try {
    const d = await launch(c, 'inbox', { TEGG_TEST_HOLD: 'first-index:4000' });
    let missingSeen = false;
    const pendingSeen = await textShown(d, 'Loading', 3000);
    const until = Date.now() + 6000;
    while (Date.now() < until) { if (await textShown(d, 'Not found', 100)) missingSeen = true; await sleep(200); }
    assert.ok(pendingSeen, 'rows show `Loading` while the first index build runs');
    assert.equal(missingSeen, false, 'no row shows `Not found` at any time');
    assert.ok(await rowsInOrder(d, ROWS), 'then their titles');
  } finally { await cleanup(c); }
});

// ------------------------------------------------------------------------------------------------ FR-HOM-02 AC-22

test('fr_hom_02_ac22_unreadable_pins_file_is_never_rewritten_in_the_real_app', { timeout: 300_000 }, async () => {
  await ready();
  const c = fresh('ac22', 'invalid-yaml.yml');
  try {
    const before = stamp(c, YML);
    const d = await launch(c, `note/${P.rozpocet}`);
    assert.ok(await textShown(d, 'The pins file can\'t be read (line 5).', 5000), 'the notice');
    await (await need(d, 'More', 5000)).click();
    const pin = await needMenuItem(d, 'Pin to sidebar');
    await pin.click();
    await sleep(800);
    press('escape');
    assert.deepEqual(stamp(c, YML), before, 'bytes, mtime and inode unchanged');
    externalReplace(c, YML, fx('valid.yml'));
    assert.ok(await waitFor(() => rowsInOrder(d, ROWS), 2500), 'fixed by another program: the rows appear within 2 s');
  } finally { await cleanup(c); }
});

// ------------------------------------------------------------------------------------------------ FR-SYN-03 AC-27

test('fr_syn_03_ac27_external_and_synced_pins_changes_in_the_real_app', { timeout: 300_000 }, async () => {
  await ready();
  const c = fresh('syn27', 'valid.yml');
  const copyA = '.tegg/pinned (conflicted copy 2026-11-07).yml', copyB = '.tegg/pinned 2.yml';
  writeFileSync(join(c.vault, copyA), `${fx('valid.yml')}  - tag: účty\n`);
  writeFileSync(join(c.vault, copyB), `${fx('valid.yml')}  - tag: účty\n`);
  try {
    const copies = [stamp(c, copyA), stamp(c, copyB)];
    const d = await launch(c);
    assert.ok(await rowsInOrder(d, ROWS), 'rows; copies not listed');
    assert.equal(await shown(d, '#účty', 500), false, 'no row from a conflict copy');
    externalReplace(c, YML, fx('valid.yml').replace('  - tag: offsite\n', '').replace('pins:\n', 'pins:\n  - tag: offsite\n  - tag: účty\n'));
    assert.ok(await waitFor(() => rowsInOrder(d, ['#offsite', '#účty', 'Rozpočet 2027']), 2500), 'an atomic replace: the new order within 2 s');
    external('delete', join(c.vault, YML));
    assert.ok(await waitFor(async () => !(await shown(d, 'Rozpočet 2027', 300)), 2500), 'deleted: the rows are gone within 2 s');
    assert.equal(await textShown(d, 'Drag things here', 500), false, 'deleted: the section shows empty and collapsed, no area (D-1429)');
    await sleep(800);
    assert.equal(read(c, YML), null, 'nothing is created');
    assert.deepEqual([stamp(c, copyA), stamp(c, copyB)], copies, 'conflict copies: bytes, mtime and inode unchanged');
  } finally { await cleanup(c); }
});

// ------------------------------------------------------------------------------------------------ FR-SYN-06 AC-43

test('fr_syn_06_ac43_only_pin_actions_write_pinned_yml_in_the_real_app', { timeout: 600_000 }, async () => {
  await ready();
  const c = fresh('syn43', 'valid.yml');
  try {
    const before = tree(c.vault);
    let d = await launch(c);
    for (const l of ROWS) { await (await need(d, l, 5000)).click(); await sleep(400); }
    await (await need(d, 'Pinned')).click();
    await (await need(d, 'Pinned')).click();
    await d.execute('macos: rightClick', { elementId: (await need(d, 'Rozpočet 2027')).elementId });
    press('escape');
    const r = centre(await rect(d, 'Výjezd Lisabon 2026'));
    await d.execute('macos: clickAndDrag', { startX: Math.round(r.x), startY: Math.round(r.y), endX: Math.round(r.x), endY: Math.round(r.y + 3), duration: 0.3 });
    d = await relaunch(c);
    assert.deepEqual(changedPaths(before, tree(c.vault)), [], 'the tour leaves every vault file identical and creates nothing');
    const pre = tree(c.vault);
    const lis = centre(await rect(d, 'Výjezd Lisabon 2026'));
    const off = await rect(d, '#offsite');
    await dragFromTo(d, lis, { x: off.x + off.width / 2, y: off.y + off.height - 2 });
    assert.ok(await waitFor(() => read(c, YML) === fx('expected/valid-after-move.yml'), 3000), 'move: expected bytes');
    assert.deepEqual(changedPaths(pre, tree(c.vault)), [YML], 'move wrote exactly .tegg/pinned.yml');
    // D-1427: pin through the Types entry's `<Type> actions` menu (the palette helper's paste + ↩ runs no command in
    // this environment; issue #115).
    const pre2 = tree(c.vault);
    const entry = await typesEntry(d, 'Schůzky');
    await d.execute('macos: rightClick', { x: Math.round(entry.x + entry.width / 2), y: Math.round(entry.y + entry.height / 2) });
    await (await needMenuItem(d, 'Pin to sidebar', 3000)).click();
    assert.ok(await waitFor(() => String(read(c, YML)).includes('type: schůzka'), 3000), 'pin wrote');
    assert.deepEqual(changedPaths(pre2, tree(c.vault)), [YML], 'pin wrote exactly .tegg/pinned.yml (no note, no type file)');
  } finally { await cleanup(c); }
});
