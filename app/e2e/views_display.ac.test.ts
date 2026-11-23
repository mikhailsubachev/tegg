// Slice Q3 real-app tests (L6, Appium mac2 on the built test app, D-382): docs/acceptance/views.md part five "Real-app
// tests": FR-QRY-05 AC-32 (a real display click: book.yml bytes, mtime, inode), AC-42 (folds after a relaunch), AC-43 (a
// real resize drag: one write on release; widths read on a fresh Application Support), AC-44 (0.6.0 widths), FR-TYP-09
// AC-37 (`All Books` after a relaunch), FR-QRY-09 AC-9 (helper edits), FR-STO-07 AC-16, FR-SYN-06 AC-52 (the tour),
// FR-UX-08 AC-27 (the accessibility tree). Always TEGG_TEST=1 with the test clock (TEGG_NOW), a temporary Application
// Support and a temporary copy of the base or the overlay views-display/ (D-62). Keys go only to Tegg (D-799): `press`
// sends them while Tegg is frontmost. Interface docs/contracts/v1-views.md §42, §43.1. Expected bytes
// tests/fixtures/queries-files/expected/views-display/. Written from the ACs and the contract only (D-61).
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import {
  FX, REPO, appiumDown, changedPaths, end, marks, need, press, ready, session, shown, sleep, support, testEnv, tmp, tree, waitFor, type Driver, type Env,
} from './helpers/capture.ts';

after(appiumDown);
process.on('exit', appiumDown);

const NOW_V = '2026-11-19T10:00:00+01:00';
const EXPECTED = join(REPO, 'tests/fixtures/queries-files/expected/views-display');
const EXTERNAL = resolve(import.meta.dirname, 'helpers/external.ts');
const expected = (name: string) => readFileSync(join(EXPECTED, name), 'utf8');
const Q = (name: string) => `.tegg/queries/${name}.yml`;
const BOOK = '.tegg/types/book.yml';
const CTENI = 'Pages/Čtení 2026.md';
const ZOB = 'Pages/Zobrazení knih.md';
const ZOB_ID = '01JB5V00000000000000000031';

function vaultCopy(base: string, overlay: boolean): string {
  const v = join(base, 'Knihovna');
  const src = join(FX, 'views');
  cpSync(src, v, { recursive: true, filter: (s) => relative(src, s) !== 'README.md' });
  cpSync(join(FX, 'new-empty/.tegg'), join(v, '.tegg'), { recursive: true });
  if (overlay) {
    const o = join(FX, 'views-display');
    cpSync(o, v, { recursive: true, filter: (s) => relative(o, s) !== 'README.md' });
  }
  return v;
}
type Ctx = { base: string; vault: string; sup: string; log: string; d?: Driver; n: number };
function fresh(name: string, overlay = false, ui: Record<string, unknown> = {}): Ctx {
  const base = tmp(`vd-${name}`);
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
const overlayFile = (rel: string) => readFileSync(join(FX, 'views-display', rel), 'utf8');
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
async function choose(d: Driver, item: string) {
  await (await need(d, 'Group', 5000)).click();
  await sleep(300);
  await (await need(d, item, 3000)).click();
  await sleep(300);
}

// ------------------------------------------------------------------------------------------------ FR-QRY-05 AC-32

test('fr_qry_05_ac32_display_switch_on_a_tab', { timeout: 300_000 }, async () => {
  await ready();
  const c = fresh('q05ac32');
  try {
    const before = tree(c.vault);
    const d = await launch(c, 'type/book');
    await selectTab(d, 'Přečtené 2026');
    await (await need(d, 'Wall', 5000)).click();
    assert.equal(await waitText(c, BOOK, (t) => t === expected('types/book-prectene-view-wall.yml'), 5000), expected('types/book-prectene-view-wall.yml'), 'book.yml: the item with `    view: wall`');
    const after = tree(c.vault);
    assert.deepEqual(changedPaths(before, after), [BOOK], 'only book.yml; the query file and Čtení byte-, mtime- and inode-identical');
    const b0 = before[BOOK], b1 = after[BOOK];
    assert.ok(b0 !== 'dir' && b1 !== 'dir' && b0.ino !== b1.ino, 'book.yml written atomically (a new inode)');
  } finally { await cleanup(c); }
});

// ------------------------------------------------------------------------------------------------ FR-QRY-05 AC-42

test('fr_qry_05_ac42_group_order_and_folds', { timeout: 300_000 }, async () => {
  await ready();
  const c = fresh('q05ac42', true);
  try {
    const before = tree(c.vault);
    let d = await launch(c, `note/${ZOB}`);
    await (await need(d, 'Reading, 3 Books', 8000)).click();
    const key = `block:id:${ZOB_ID}/rozečtené#1`;
    assert.ok(await waitFor(() => JSON.stringify(uiState(c)?.usageFolded?.[key]) === JSON.stringify(['option:Reading']), 3000), `usageFolded["${key}"] (${JSON.stringify(uiState(c)?.usageFolded)})`);
    d = await relaunch(c, `note/${ZOB}`);
    const btn = await need(d, 'Reading, 3 Books', 8000);
    assert.equal(await d.getElementAttribute(btn.elementId, 'expanded').catch(() => null), 'false', 'folded after a relaunch');
    assert.deepEqual(changedPaths(before, tree(c.vault)), [], 'no vault file changes');
  } finally { await cleanup(c); }
});

// ------------------------------------------------------------------------------------------------ FR-QRY-05 AC-43

test('fr_qry_05_ac43_widths_are_stored_with_the_usage', { timeout: 300_000 }, async () => {
  await ready();
  const c = fresh('q05ac43');
  try {
    const before = tree(c.vault);
    let d = await launch(c, 'type/book');
    await selectTab(d, 'Přečtené 2026');
    const h = await rectOf(d, 'Resize Title', 8000);
    const title = await rectOf(d, 'Title');
    await dragFromTo(d, mid(h), { x: mid(h).x + (300 - title.width), y: mid(h).y });
    assert.equal(await waitText(c, BOOK, (t) => t === expected('types/book-prectene-widths-title-300.yml'), 5000), expected('types/book-prectene-widths-title-300.yml'), 'one write on release: `    widths: { title: 300 }`');
    assert.deepEqual(changedPaths(before, tree(c.vault)), [BOOK], 'only book.yml');
    assert.equal(uiState(c)?.usageColumnWidths?.['tab:book/přečtené 2026'], undefined, 'no ui-state.json entry');
    // (d) The overlay's Výborné knihy on a fresh Application Support (another Mac): Title 260, Author 180.
    await end(c.d);
    const c2 = fresh('q05ac43b', true);
    try {
      d = await launch(c2, 'type/book');
      await selectTab(d, 'Výborné knihy');
      assert.ok(Math.abs((await rectOf(d, 'Title', 5000)).width - 260) <= 2, '(d) Title 260 from the vault');
      assert.ok(Math.abs((await rectOf(d, 'Author', 5000)).width - 180) <= 2, '(d) Author 180 from the vault');
    } finally { await cleanup(c2); }
  } finally { await cleanup(c); }
});

// ------------------------------------------------------------------------------------------------ FR-QRY-05 AC-44

test('fr_qry_05_ac44_widths_kept_by_0_6', { timeout: 300_000 }, async () => {
  await ready();
  const c = fresh('q05ac44', false, { usageColumnWidths: { 'tab:book/přečtené 2026': { title: 200, author: 180 } } });
  try {
    const d = await launch(c, 'type/book');
    await selectTab(d, 'Přečtené 2026');
    assert.ok(Math.abs((await rectOf(d, 'Title', 5000)).width - 200) <= 2, 'the 0.6.0 Title width');
    const h = await rectOf(d, 'Resize Rating', 5000);
    const rating = await rectOf(d, 'Rating');
    await dragFromTo(d, mid(h), { x: mid(h).x + (150 - rating.width), y: mid(h).y });
    assert.equal(await waitText(c, BOOK, (t) => t === expected('types/book-prectene-widths-legacy-rating.yml'), 5000), expected('types/book-prectene-widths-legacy-rating.yml'), 'the kept widths plus the new one');
    assert.ok(await waitFor(() => uiState(c)?.usageColumnWidths?.['tab:book/přečtené 2026'] === undefined, 3000), 'the 0.6.0 entry removed');
  } finally { await cleanup(c); }
});

// ------------------------------------------------------------------------------------------------ FR-TYP-09 AC-37

test('fr_typ_09_ac37_all_tab_display_and_grouping_on_this_mac', { timeout: 300_000 }, async () => {
  await ready();
  const c = fresh('typ09ac37');
  try {
    const before = tree(c.vault);
    let d = await launch(c, 'type/book');
    await selectTab(d, 'All Books');
    await (await need(d, 'Wall', 5000)).click();
    await choose(d, 'Status');
    assert.ok(await waitFor(() => uiState(c)?.allView?.book?.view === 'wall' && uiState(c)?.allView?.book?.groupBy === 'status', 3000), `allView.book (${JSON.stringify(uiState(c)?.allView)})`);
    d = await relaunch(c, 'type/book');
    await selectTab(d, 'All Books');
    assert.ok(await shown(d, 'Book: Noční vlak', 5000), 'the wall after a relaunch');
    assert.deepEqual(changedPaths(before, tree(c.vault)), [], 'no vault file; book.yml byte-identical');
  } finally { await cleanup(c); }
});

// ------------------------------------------------------------------------------------------------ FR-QRY-09 AC-9

test('fr_qry_09_ac9_display_and_grouping_follow_external_changes', { timeout: 300_000 }, async () => {
  await ready();
  const c = fresh('q09ac9', true);
  try {
    const d = await launch(c, 'type/book');
    await selectTab(d, 'Přečtené 2026');
    assert.ok(await shown(d, 'Book: Mapa bez severu', 5000), 'setup: the tab\'s own wall');
    const before = tree(c.vault);
    externalWrite(c, BOOK, overlayFile(BOOK).replace('  - name: Přečtené 2026\n    view: wall\n', '  - name: Přečtené 2026\n    view: table\n'));
    assert.ok(await waitFor(async () => !!(await need(d, 'Finished', 300).catch(() => null)), 2000), 'line 17 `view: table`: a Table within 2 s');
    const after = tree(c.vault);
    assert.deepEqual(changedPaths(before, after), [BOOK], 'only the helper\'s write');
    assert.equal(read(c, Q('Přečtené 2026')), fixture(Q('Přečtené 2026')), 'nothing written by Tegg');
  } finally { await cleanup(c); }
});

// ------------------------------------------------------------------------------------------------ FR-STO-07 AC-16

test('fr_sto_07_ac16_display_state_on_this_mac', { timeout: 300_000 }, async () => {
  await ready();
  const c = fresh('sto07ac16');
  try {
    const before = tree(c.vault);
    let d = await launch(c, 'query/Přečtené 2026');
    const h = await rectOf(d, 'Resize Title', 8000);
    await dragFromTo(d, mid(h), { x: mid(h).x + 40, y: mid(h).y });
    assert.ok(await waitFor(() => !!uiState(c)?.usageColumnWidths?.['page:přečtené 2026'], 3000), `usageColumnWidths["page:přečtené 2026"] (${JSON.stringify(uiState(c)?.usageColumnWidths)})`);
    d = await relaunch(c, 'type/book');
    await selectTab(d, 'All Books');
    await (await need(d, 'Wall', 5000)).click();
    assert.ok(await waitFor(() => !!uiState(c)?.allView?.book, 3000), 'allView.book');
    const keys = Object.keys(uiState(c)?.usageColumnWidths ?? {});
    assert.ok(keys.every((k) => !k.startsWith('tab:') && !k.startsWith('block:')), `never a tab: or block: entry (${keys})`);
    assert.deepEqual(changedPaths(before, tree(c.vault)), [], 'nothing under the vault (.tegg/ included)');
  } finally { await cleanup(c); }
});

// ------------------------------------------------------------------------------------------------ FR-SYN-06 AC-52

test('fr_syn_06_ac52_display_actions_write_one_file_once', { timeout: 600_000 }, async () => {
  await ready();
  const c = fresh('syn06ac52', true);
  try {
    const before = tree(c.vault);
    let d = await launch(c, 'type/book');
    for (const t of ['Rozečtené', 'Přečtené 2026', 'Výborné knihy', 'Podle žánru', 'Podle autora', 'Celá zeď']) {
      await selectTab(d, t);
      await (await need(d, 'Group', 5000)).click();
      await sleep(300);
      press('escape');
      await sleep(300);
    }
    await selectTab(d, 'All Books');
    d = await relaunch(c, `note/${ZOB}`);
    await sleep(1000);
    d = await relaunch(c, 'type/book');
    assert.deepEqual(changedPaths(before, tree(c.vault)), [], '(a) the tour: every vault file byte-, mtime- and inode-identical');
    // (c) A 300 px resize drag writes once.
    await selectTab(d, 'Výborné knihy');
    const h = await rectOf(d, 'Resize Title', 5000);
    await dragFromTo(d, mid(h), { x: mid(h).x + 40, y: mid(h).y });
    assert.ok(await waitFor(() => read(c, BOOK) !== overlayFile(BOOK), 5000), '(c) book.yml written');
    assert.deepEqual(changedPaths(before, tree(c.vault)), [BOOK], '(b), (c) one file once');
    void CTENI;
  } finally { await cleanup(c); }
});

// ------------------------------------------------------------------------------------------------ FR-UX-08 AC-27

test('fr_ux_08_ac27_display_for_voiceover', { timeout: 300_000 }, async () => {
  await ready();
  const c = fresh('ux08ac27', true);
  try {
    const d = await launch(c, 'type/book');
    await selectTab(d, 'Výborné knihy');
    for (const name of ['Display', 'List', 'Table', 'Wall', 'Group', 'Lucie Horká, 1 Book', 'Eva Lindová, 2 Books']) {
      assert.ok(await shown(d, name, 5000), `the accessibility tree shows ${name}`);
    }
    await selectTab(d, 'Přečtené 2026');
    assert.ok(await shown(d, 'Book: Mapa bez severu', 5000), 'wall cards by name');
  } finally { await cleanup(c); }
});
