// Slice Q2.1 real-app tests (L6, Appium mac2 on the built test app, D-382): docs/acceptance/views.md part two "Real-app
// tests": `bug_q21_fr_qry_07_view_menu_stays_in_the_window` (the reported case at 1,440 × 900 and at the native minimum
// 800 × 500, D-136); FR-QRY-07 AC-20 (trash from the view menu: bytes, mtime, inode; Undo); FR-QRY-01 AC-14 (a real header
// click in Čtení's block: one note write, the query file untouched); FR-QRY-05 AC-25, AC-27 (widths and folds per usage
// after a relaunch); FR-QRY-09 AC-8 (helper edits); FR-STO-07 AC-11; FR-SYN-06 AC-49 (the tour). Always TEGG_TEST=1 with
// the test clock (TEGG_NOW), a temporary Application Support and a temporary copy of the base or the overlay (D-62).
// Window sizes through System Events (`set size of window 1`, as ms3_shell.ac.test.ts). Keys go only to Tegg (D-799):
// `press` sends them while Tegg is frontmost. Interface docs/contracts/v1-views.md §19, §21. Written from the ACs and the
// contract only (D-61).
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import {
  BUNDLE_ID, FX, REPO, appiumDown, changedPaths, end, marks, need, osa, press, ready, session, shown, sleep, support, testEnv, tmp, tree, waitFor, type Driver, type Env,
} from './helpers/capture.ts';

after(appiumDown);
process.on('exit', appiumDown);

const NOW_V = '2026-11-19T10:00:00+01:00';
const EXPECTED = join(REPO, 'tests/fixtures/queries-files/expected/views-usage');
const EXTERNAL = resolve(import.meta.dirname, 'helpers/external.ts');
const expected = (name: string) => readFileSync(join(EXPECTED, name), 'utf8');
const Q = (name: string) => `.tegg/queries/${name}.yml`;
const BOOK = '.tegg/types/book.yml';
const CTENI = 'Pages/Čtení 2026.md';
const CESTY = 'Pages/Knihy na cesty.md';
const CESTY_ID = '01JB5V00000000000000000030';

function vaultCopy(base: string, overlay: boolean): string {
  const v = join(base, 'Knihovna');
  const src = join(FX, 'views');
  cpSync(src, v, { recursive: true, filter: (s) => relative(src, s) !== 'README.md' });
  cpSync(join(FX, 'new-empty/.tegg'), join(v, '.tegg'), { recursive: true });
  if (overlay) {
    const o = join(FX, 'views-usage');
    cpSync(o, v, { recursive: true, filter: (s) => relative(o, s) !== 'README.md' });
  }
  return v;
}
type Ctx = { base: string; vault: string; sup: string; log: string; d?: Driver; n: number };
function fresh(name: string, overlay = false, ui: Record<string, unknown> = {}): Ctx {
  const base = tmp(`vu-${name}`);
  return { base, vault: vaultCopy(base, overlay), sup: support(base, { ui: { preview: { mode: 'hover', hoverDelay: 1000 }, ...ui } }), log: join(base, 'perf.jsonl'), n: 0 };
}
async function launch(c: Ctx, route: string, extra: Env = {}): Promise<Driver> {
  c.n += 1;
  c.log = join(c.base, `perf-${c.n}.jsonl`);
  c.d = await session(testEnv(c.sup, c.log, { TEGG_VAULT: c.vault, TEGG_ROUTE: route, TEGG_NOW: NOW_V, ...extra }));
  const want = `route-ready:${route.normalize('NFC')}`;
  assert.ok(await waitFor(() => marks(c.log).map((m) => m.normalize('NFC')).includes(want), 20_000), `${route} shown (route-ready)`);
  return c.d;
}
async function relaunch(c: Ctx, route: string): Promise<Driver> {
  await end(c.d);
  c.d = undefined;
  return launch(c, route);
}
async function cleanup(c: Ctx) {
  await end(c.d);
  rmSync(c.base, { recursive: true, force: true });
}
function externalWrite(c: Ctx, rel: string, text: string) {
  const f = join(c.base, `ext-${Date.now()}.txt`);
  writeFileSync(f, text);
  execFileSync(process.execPath, [EXTERNAL, 'write', join(c.vault, rel), f], { encoding: 'utf8' });
  rmSync(f, { force: true });
}
const read = (c: Ctx, rel: string) => (existsSync(join(c.vault, rel)) ? readFileSync(join(c.vault, rel), 'utf8') : null);
const fixture = (rel: string) => readFileSync(join(FX, 'views', rel), 'utf8');
const uiState = (c: Ctx) => (existsSync(join(c.sup, 'ui-state.json')) ? JSON.parse(readFileSync(join(c.sup, 'ui-state.json'), 'utf8')) : null);
async function waitText(c: Ctx, rel: string, ok: (t: string | null) => boolean, ms: number): Promise<string | null> {
  await waitFor(() => ok(read(c, rel)), ms);
  return read(c, rel);
}
async function rectOf(d: Driver, label: string, ms = 5000) {
  const e = await need(d, label, ms);
  return d.getElementRect(e.elementId);
}
const mid = (r: { x: number; y: number; width: number; height: number }) => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 });
async function dragFromTo(d: Driver, from: { x: number; y: number }, to: { x: number; y: number }) {
  await d.execute('macos: clickAndDrag', { startX: Math.round(from.x), startY: Math.round(from.y), endX: Math.round(to.x), endY: Math.round(to.y), duration: 0.6 });
}
async function selectTab(d: Driver, name: string) {
  await (await need(d, name, 5000)).click();
  await sleep(500);
}
const PROC = `(first process whose bundle identifier is "${BUNDLE_ID}")`;
function setWindowSize(w: number, h: number) {
  osa(`tell application "System Events" to tell ${PROC} to set position of window 1 to {40, 40}`);
  osa(`tell application "System Events" to tell ${PROC} to set size of window 1 to {${w}, ${h}}`);
}
function windowBox(): { x: number; y: number; w: number; h: number } {
  const [x, y] = osa(`tell application "System Events" to tell ${PROC} to get position of window 1`).trim().split(/,\s*/).map(Number);
  const [w, h] = osa(`tell application "System Events" to tell ${PROC} to get size of window 1`).trim().split(/,\s*/).map(Number);
  return { x, y, w, h };
}

// ------------------------------------------------------------------------------------------------ the reported bug

test('bug_q21_fr_qry_07_view_menu_stays_in_the_window', { timeout: 300_000 }, async () => {
  await ready();
  const c = fresh('bug-q21');
  try {
    const d = await launch(c, 'type/book');
    for (const [w, h] of [[1440, 900], [800, 500]]) {
      setWindowSize(w, h);
      await sleep(800);
      const win = windowBox();
      assert.deepEqual([win.w, win.h], [w, h], `setup: the window is ${w} × ${h}`);
      await selectTab(d, 'Přečtené 2026');
      await (await need(d, 'View actions', 5000)).click();
      await sleep(500);
      const edit = await rectOf(d, 'Edit view', 3000);
      assert.ok(edit.x + edit.width <= win.x + win.w - 8 + 0.5, `${w} × ${h}: \`Edit view\` ends at ${edit.x + edit.width}, the window at ${win.x + win.w}`);
      await d.execute('macos: click', { x: Math.round(mid(edit).x), y: Math.round(mid(edit).y) });
      assert.ok(await shown(d, 'Edit query', 3000), `${w} × ${h}: a click at \`Edit view\`'s centre opens the editor`);
      press('escape');
      await sleep(400);
    }
  } finally { await cleanup(c); }
});

// FR-QRY-07 AC-19's L6 reference (tools/qa CONTRACT §9.5): at the native minimum 800 × 500, the toolbar `⋯`, the sort
// popover and the tab menu of the last tab each end inside the window.
test('fr_qry_07_ac19_view_menus_stay_in_the_window', { timeout: 300_000 }, async () => {
  await ready();
  const c = fresh('q07ac19');
  try {
    const d = await launch(c, 'type/book');
    setWindowSize(800, 500);
    await sleep(800);
    const win = windowBox();
    await selectTab(d, 'Výborné knihy');
    for (const [opener, item] of [['View actions', 'Edit view'], ['Sort', '+ Add sort']] as const) {
      await (await need(d, opener, 5000)).click();
      await sleep(500);
      const r = await rectOf(d, item, 3000);
      assert.ok(r.x >= win.x + 8 - 0.5 && r.x + r.width <= win.x + win.w - 8 + 0.5 && r.y + r.height <= win.y + win.h - 8 + 0.5, `${opener}: \`${item}\` inside the window (${JSON.stringify(r)}, window ${JSON.stringify(win)})`);
      press('escape');
      await sleep(400);
    }
  } finally { await cleanup(c); }
});

// ------------------------------------------------------------------------------------------------ FR-QRY-07 AC-20

test('fr_qry_07_ac20_trash_from_the_view_menu_removes_the_tab', { timeout: 300_000 }, async () => {
  await ready();
  const c = fresh('q07ac20');
  try {
    const before = tree(c.vault);
    const d = await launch(c, 'type/book');
    await selectTab(d, 'Výborné knihy');
    await (await need(d, 'View actions', 5000)).click();
    await (await need(d, 'Move to trash', 3000)).click();
    const got = await waitText(c, BOOK, (t) => t === expected('types/book-trash-vyborne.yml'), 5000);
    assert.equal(got, expected('types/book-trash-vyborne.yml'), 'book.yml: line 13 only');
    const after = tree(c.vault);
    const t = `.trash/${Q('Výborné knihy')}`;
    assert.deepEqual(changedPaths(before, after).sort(), [BOOK, Q('Výborné knihy'), t].sort(), 'book.yml and the move, nothing else');
    const q0 = before[Q('Výborné knihy')], q1 = after[t];
    assert.ok(q0 !== 'dir' && q1 && q1 !== 'dir' && q0.ino === q1.ino && q0.sha === q1.sha, 'the query file moved: same bytes and inode');
    const b0 = before[BOOK], b1 = after[BOOK];
    assert.ok(b0 !== 'dir' && b1 !== 'dir' && b0.ino !== b1.ino, 'book.yml written atomically (a new inode)');
    await (await need(d, 'Undo', 3000)).click();
    assert.equal(await waitText(c, BOOK, (x) => x === fixture(BOOK), 5000), fixture(BOOK), 'Undo: book.yml back to its bytes');
    assert.ok(existsSync(join(c.vault, Q('Výborné knihy'))), 'Undo: the query file back');
  } finally { await cleanup(c); }
});

// ------------------------------------------------------------------------------------------------ FR-QRY-01 AC-14

test('fr_qry_01_ac14_block_sort_is_its_own', { timeout: 300_000 }, async () => {
  await ready();
  const c = fresh('q01ac14');
  try {
    const before = tree(c.vault);
    const d = await launch(c, `note/${CTENI}`);
    await (await need(d, 'Rating', 8000)).click();
    assert.equal(await waitText(c, CTENI, (t) => t === expected('notes/cteni-2026-click-rating.md'), 5000), expected('notes/cteni-2026-click-rating.md'), 'Čtení: one line and modified:');
    assert.deepEqual(changedPaths(before, tree(c.vault)), [CTENI], 'only the note; the query file and book.yml untouched');
  } finally { await cleanup(c); }
});

// ------------------------------------------------------------------------------------------------ FR-QRY-05 AC-25, FR-STO-07 AC-11

test('fr_qry_05_ac25_widths_per_usage', { timeout: 300_000 }, async () => {
  await ready();
  const c = fresh('q05ac25', true);
  try {
    const before = tree(c.vault);
    let d = await launch(c, 'type/book');
    await selectTab(d, 'Přečtené 2026');
    const h = await rectOf(d, 'Resize Title', 8000);
    const title = await rectOf(d, 'Title');
    await dragFromTo(d, mid(h), { x: mid(h).x + (300 - title.width), y: mid(h).y });
    // Slice Q3 (AC-Test-Change, D-2196; D-2177): the tab's widths go into its views: item once, on release.
    assert.ok(await waitFor(() => !!read(c, BOOK)?.includes('    widths: { title: 300 }\n'), 3000), 'book.yml: the item gets `    widths: { title: 300 }`');
    assert.equal(uiState(c)?.usageColumnWidths?.['tab:book/přečtené 2026'], undefined, 'no ui-state.json entry');
    d = await relaunch(c, 'type/book');
    await selectTab(d, 'Přečtené 2026');
    assert.ok(Math.abs((await rectOf(d, 'Title', 5000)).width - 300) <= 2, 'after a relaunch the tab keeps 300 px');
    d = await relaunch(c, `note/${CESTY}`);
    assert.ok(Math.abs((await rectOf(d, 'Title', 5000)).width - 300) > 2, 'Cesty\'s blocks keep their own default');
    assert.deepEqual(changedPaths(before, tree(c.vault)), [BOOK], 'only book.yml');
  } finally { await cleanup(c); }
});

test('fr_qry_05_ac27_folds_per_usage', { timeout: 300_000 }, async () => {
  await ready();
  const c = fresh('q05ac27');
  try {
    writeFileSync(join(c.vault, BOOK), fixture(BOOK).replace('views: [Rozečtené, Přečtené 2026, Výborné knihy]', 'views: [Rozečtené, Přečtené 2026, Výborné knihy, Podle žánru]'));
    const before = tree(c.vault);
    let d = await launch(c, 'type/book');
    await selectTab(d, 'Podle žánru');
    await (await need(d, 'Collapse Román', 5000)).click();
    assert.ok(await waitFor(() => (uiState(c)?.usageFolded?.['tab:book/podle žánru'] ?? []).includes('option:Román'), 3000), `usageFolded["tab:book/podle žánru"] (${JSON.stringify(uiState(c)?.usageFolded)})`);
    d = await relaunch(c, 'type/book');
    await selectTab(d, 'Podle žánru');
    assert.ok(await shown(d, 'Expand Román', 5000), 'folded after a relaunch');
    assert.deepEqual(changedPaths(before, tree(c.vault)), [], 'no vault file changes');
  } finally { await cleanup(c); }
});

test('fr_sto_07_ac11_usage_state_is_machine_local', { timeout: 300_000 }, async () => {
  await ready();
  const c = fresh('sto07ac11', true, { queryColumnWidths: { 'Přečtené 2026': { title: 200 } }, boardFolded: { 'Podle žánru': ['option:Román'] } });
  try {
    const before = tree(c.vault);
    const d = await launch(c, `note/${CESTY}`);
    const h = await rectOf(d, 'Resize Title', 8000);
    await dragFromTo(d, mid(h), { x: mid(h).x + 40, y: mid(h).y });
    // Slice Q3 (AC-Test-Change, D-2196; D-2177): the block's widths go into its fence (Cesty), never ui-state.json.
    const key = `block:id:${CESTY_ID}/přečtené 2026#1`;
    assert.ok(await waitFor(() => /widths: \{ title: \d+ \}/.test(read(c, CESTY) ?? ''), 3000), 'the block\'s fence gets its widths');
    const st = uiState(c);
    assert.equal(st?.usageColumnWidths?.[key], undefined, `no usageColumnWidths["${key}"]`);
    assert.deepEqual([st?.queryColumnWidths, st?.boardFolded], [{ 'Přečtené 2026': { title: 200 } }, { 'Podle žánru': ['option:Román'] }], '0.4.0 keys unchanged');
    assert.deepEqual(changedPaths(before, tree(c.vault)), [CESTY], 'only the note; nothing machine-local under the vault');
  } finally { await cleanup(c); }
});

// ------------------------------------------------------------------------------------------------ FR-QRY-09 AC-8

test('fr_qry_09_ac8_usage_settings_follow_external_changes', { timeout: 300_000 }, async () => {
  await ready();
  const c = fresh('q09ac8', true);
  try {
    const d = await launch(c, 'type/book');
    await selectTab(d, 'Přečtené 2026');
    const first0 = await rectOf(d, 'Cizí přístavy', 5000);
    const o = read(c, BOOK)!;
    externalWrite(c, BOOK, o.replace('    sort:\n      - { by: rating, order: asc }\n      - { by: title, order: asc }\n', '    sort: { by: title, order: desc }\n'));
    assert.ok(await waitFor(async () => (await rectOf(d, 'Zahrada v dešti', 500).catch(() => null))?.y! < first0.y + 5, 2000), 'the tab reorders within 2 s (Zahrada v dešti first)');
    assert.equal(read(c, Q('Přečtené 2026')), fixture(Q('Přečtené 2026')), 'nothing written');
  } finally { await cleanup(c); }
});

// ------------------------------------------------------------------------------------------------ FR-SYN-06 AC-49

test('fr_syn_06_ac49_each_usage_action_writes_one_file', { timeout: 600_000 }, async () => {
  await ready();
  const c = fresh('syn06ac49', true);
  try {
    const before = tree(c.vault);
    let d = await launch(c, 'type/book');
    for (const t of ['Rozečtené', 'Přečtené 2026', 'Výborné knihy']) {
      await selectTab(d, t);
      await (await need(d, 'View actions', 5000)).click();
      await sleep(300);
      press('escape');
      await (await need(d, 'Sort', 3000)).click();
      await sleep(300);
      press('escape');
      await sleep(300);
    }
    d = await relaunch(c, `note/${CESTY}`);
    await sleep(1000);
    d = await relaunch(c, 'type/book');
    assert.deepEqual(changedPaths(before, tree(c.vault)), [], 'the tour: every vault file byte-, mtime- and inode-identical');
    await selectTab(d, 'Přečtené 2026');
    await (await need(d, 'Finished', 5000)).click();
    assert.equal(await waitText(c, BOOK, (t) => t === expected('types/book-overlay-prectene-click-finished.yml'), 5000), expected('types/book-overlay-prectene-click-finished.yml'), 'a header click on the tab writes book.yml');
    assert.deepEqual(changedPaths(before, tree(c.vault)), [BOOK], 'one file once');
  } finally { await cleanup(c); }
});
