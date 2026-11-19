// Slice Q2 real-app tests (L6, Appium mac2 on the built test app, D-382): docs/acceptance/views.md "Real-app tests":
// FR-QRY-07 AC-6 (a real tab drag), AC-13 (the remembered tab after a relaunch), AC-15 (helper edits of book.yml and a query
// file); FR-QRY-05 AC-13 (a real card drag: bytes, mtime, inode), AC-18 (folds after a relaunch), AC-21 (a drag in the
// note's block), AC-23 (widths after a relaunch); FR-QRY-09 AC-6 (helper edits move cards); FR-STO-07 AC-10 (view state in
// the temporary Application Support only); FR-SYN-06 AC-48 (the tour writes nothing; each action writes only its file);
// FR-UX-08 AC-24 (what the macOS accessibility tree reads). The latency criteria are in nfr_perf_07_board.ac.test.ts.
// Always TEGG_TEST=1 with the Q2 test clock (TEGG_NOW), a temporary Application Support and a temporary copy of
// tests/fixtures/vaults/views plus tests/fixtures/vaults/new-empty/.tegg (D-62). Keys go only to Tegg (D-799): every key
// is sent while Tegg is frontmost (helpers/capture.ts `press`). Interface docs/contracts/v1-views.md §4.3 (names), §4.6
// (strings), §4.7 (ui-state keys), §5 (TEGG_NOW, the external helper). Written from the ACs and the contract only (D-61).
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import {
  FX, REPO, appiumDown, changedPaths, end, marks, need, needMenuItem, paste, press, ready, session, shown, sleep, support, testEnv, textContains, tmp, tree,
  waitFor, type Driver, type Env,
} from './helpers/capture.ts';

after(appiumDown);
process.on('exit', appiumDown);

/** The Q2 test clock (views.md): Thursday 19 Nov 2026, 10:00 in Prague (testEnv's TZ). */
const NOW_V = '2026-11-19T10:00:00+01:00';
const EXPECTED = join(REPO, 'tests/fixtures/queries-files/expected/views');
const EXTERNAL = resolve(import.meta.dirname, 'helpers/external.ts');
const expected = (name: string) => readFileSync(join(EXPECTED, name), 'utf8');
const Q = (name: string) => `.tegg/queries/${name}.yml`;
const BOOK = '.tegg/types/book.yml';
const CTENI = 'Pages/Čtení 2026.md';
const KNIHA = 'Books/Kniha o horách.md';

function vaultCopy(base: string, name = 'Knihovna'): string {
  const v = join(base, name);
  const src = join(FX, 'views');
  cpSync(src, v, { recursive: true, filter: (s) => relative(src, s) !== 'README.md' });
  cpSync(join(FX, 'new-empty/.tegg'), join(v, '.tegg'), { recursive: true });
  return v;
}
type Ctx = { base: string; vault: string; sup: string; log: string; d?: Driver; n: number };
function fresh(name: string, ui: Record<string, unknown> = {}): Ctx {
  const base = tmp(`v-${name}`);
  return { base, vault: vaultCopy(base), sup: support(base, { ui: { preview: { mode: 'hover', hoverDelay: 1000 }, ...ui } }), log: join(base, 'perf.jsonl'), n: 0 };
}
async function launch(c: Ctx, route = 'inbox', extra: Env = {}): Promise<Driver> {
  c.n += 1;
  c.log = join(c.base, `perf-${c.n}.jsonl`);
  c.d = await session(testEnv(c.sup, c.log, { TEGG_VAULT: c.vault, TEGG_ROUTE: route, TEGG_NOW: NOW_V, ...extra }));
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
function externalWrite(c: Ctx, rel: string, text: string | null) {
  if (text === null) { external('delete', join(c.vault, rel)); return; }
  const f = join(c.base, `ext-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`);
  writeFileSync(f, text);
  external('write', join(c.vault, rel), f);
  rmSync(f, { force: true });
}
const read = (c: Ctx, rel: string) => (existsSync(join(c.vault, rel)) ? readFileSync(join(c.vault, rel), 'utf8') : null);
const fixture = (rel: string) => readFileSync(join(FX, 'views', rel), 'utf8');
const uiState = (c: Ctx) => (existsSync(join(c.sup, 'ui-state.json')) ? JSON.parse(readFileSync(join(c.sup, 'ui-state.json'), 'utf8')) : null);
async function waitText(c: Ctx, rel: string, ok: (t: string | null) => boolean, ms: number): Promise<string | null> {
  await waitFor(() => ok(read(c, rel)), ms);
  return read(c, rel);
}
const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
async function rectOf(d: Driver, label: string, ms = 5000) {
  const e = await need(d, label, ms);
  return d.getElementRect(e.elementId);
}
/** A pointer drag in the real app (`macos: clickAndDrag`, coordinates). */
async function dragFromTo(d: Driver, from: { x: number; y: number }, to: { x: number; y: number }) {
  await d.execute('macos: clickAndDrag', { startX: Math.round(from.x), startY: Math.round(from.y), endX: Math.round(to.x), endY: Math.round(to.y), duration: 0.6 });
}
const mid = (r: { x: number; y: number; width: number; height: number }) => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 });
/** Whether an element labelled `label` lies inside the element labelled `region` (by its rectangle). */
async function inside(d: Driver, label: string, region: string): Promise<boolean> {
  const a = await rectOf(d, label, 2000).catch(() => null);
  const b = await rectOf(d, region, 2000).catch(() => null);
  if (!a || !b) return false;
  const m = mid(a);
  return m.x >= b.x && m.x <= b.x + b.width && m.y >= b.y && m.y <= b.y + b.height;
}
async function textShown(d: Driver, text: string, ms = 3000): Promise<boolean> {
  return waitFor(async () => {
    for (const e of await d.$$(`-ios predicate string:${textContains(text)}`).catch(() => [] as any[])) if (await e.isDisplayed().catch(() => false)) return true;
    return false;
  }, ms);
}
/** Opens a note through the Search page (D-760, D-1340): ⇧⌘F, its title, ⏎ on the first result. */
async function openNote(d: Driver, title: string) {
  press('f', ['command', 'shift']);
  assert.ok(await shown(d, 'Search query', 3000), `the Search page (for ${title})`);
  paste(title);
  await sleep(600);
  press('enter');
  await sleep(800);
}
async function selectTab(d: Driver, name: string) {
  await (await need(d, name, 5000)).click();
  await sleep(500);
}

// ------------------------------------------------------------------------------------------------ FR-QRY-07 AC-6

test('fr_qry_07_ac6_reorder_tabs_writes_views_once', { timeout: 300_000 }, async () => {
  await ready();
  const c = fresh('q07ac6');
  try {
    const before = tree(c.vault);
    const d = await launch(c, 'type/book');
    assert.ok(await shown(d, 'Views', 8000), 'the tablist `Views`');
    const vyb = await rectOf(d, 'Výborné knihy');
    const roz = await rectOf(d, 'Rozečtené');
    await dragFromTo(d, mid(vyb), { x: roz.x + 4, y: roz.y + roz.height / 2 });
    const got = await waitText(c, BOOK, (t) => t === expected('types/book-views-dragged.yml'), 5000);
    assert.equal(got, expected('types/book-views-dragged.yml'), 'book.yml: line 13 only, `views: [Výborné knihy, Rozečtené, Přečtené 2026]`');
    const after = tree(c.vault);
    assert.deepEqual(changedPaths(before, after), [BOOK], 'only book.yml changed');
    const b0 = before[BOOK], b1 = after[BOOK];
    assert.ok(b0 !== 'dir' && b1 !== 'dir' && b0.ino !== b1.ino, 'an atomic write (a new inode)');
    const x = (await rectOf(d, 'Výborné knihy')).x;
    assert.ok(x < (await rectOf(d, 'Rozečtené')).x, 'the tab shows before Rozečtené');
  } finally { await cleanup(c); }
});

// ------------------------------------------------------------------------------------------------ FR-QRY-07 AC-13, FR-STO-07 AC-10

test('fr_qry_07_ac13_last_tab_per_type_is_machine_local', { timeout: 300_000 }, async () => {
  await ready();
  const c = fresh('q07ac13');
  try {
    const before = tree(c.vault);
    let d = await launch(c, 'type/book');
    await selectTab(d, 'Rozečtené');
    assert.ok(await waitFor(() => uiState(c)?.typeViews?.lastTab?.book === 'Rozečtené', 3000), 'ui-state.json: typeViews.lastTab.book "Rozečtené"');
    d = await relaunch(c, 'type/book');
    assert.ok(await shown(d, 'Reading, 3 cards', 8000), 'after a relaunch the Rozečtené tab opens (its board)');
    assert.deepEqual(changedPaths(before, tree(c.vault)), [], 'no vault file changes');
    const c2 = fresh('q07ac13b');
    try {
      c2.vault = c.vault;
      const d2 = await launch(c2, 'type/book');
      assert.ok(await shown(d2, 'Noční vlak', 8000), 'a fresh Application Support opens on All Books');
      assert.equal(await shown(d2, 'Reading, 3 cards', 1000), false, 'not on the board');
      await end(d2);
    } finally { rmSync(c2.base, { recursive: true, force: true }); }
  } finally { await cleanup(c); }
});

test('fr_sto_07_ac10_view_state_is_machine_local', { timeout: 300_000 }, async () => {
  await ready();
  const c = fresh('sto07ac10');
  try {
    writeFileSync(join(c.vault, BOOK), fixture(BOOK).replace('views: [Rozečtené, Přečtené 2026, Výborné knihy]', 'views: [Rozečtené, Přečtené 2026, Výborné knihy, Podle žánru]'));
    const before = tree(c.vault);
    const d = await launch(c, 'type/book');
    await selectTab(d, 'Podle žánru');
    await (await need(d, 'Collapse Román', 5000)).click();
    await selectTab(d, 'Přečtené 2026');
    const handle = await rectOf(d, 'Resize Title');
    await dragFromTo(d, mid(handle), { x: mid(handle).x + 40, y: mid(handle).y });
    assert.ok(await waitFor(() => {
      const u = uiState(c);
      return u?.typeViews?.lastTab?.book === 'Přečtené 2026' && Array.isArray(u?.boardFolded?.['Podle žánru']) && typeof u?.queryColumnWidths?.['Přečtené 2026']?.title === 'number';
    }, 3000), `ui-state.json holds the three keys (${JSON.stringify(uiState(c))})`);
    await sleep(800);
    assert.deepEqual(changedPaths(before, tree(c.vault)), [], 'nothing under the vault (its .tegg/ included) is created or changed');
  } finally { await cleanup(c); }
});

// ------------------------------------------------------------------------------------------------ FR-QRY-07 AC-15, FR-QRY-09 AC-6

test('fr_qry_07_ac15_views_follow_external_changes', { timeout: 300_000 }, async () => {
  await ready();
  const c = fresh('q07ac15');
  try {
    const d = await launch(c, 'type/book');
    assert.ok(await shown(d, 'Přečtené 2026', 8000), 'the tabs');
    const before = tree(c.vault);
    externalWrite(c, BOOK, fixture(BOOK).replace('views: [Rozečtené, Přečtené 2026, Výborné knihy]', 'views: [Výborné knihy, Rozečtené]'));
    assert.ok(await waitFor(async () => !(await shown(d, 'Přečtené 2026', 200)), 2500), 'Přečtené 2026 leaves the tabs within 2 s');
    await selectTab(d, 'Rozečtené');
    externalWrite(c, Q('Rozečtené'), fixture(Q('Rozečtené')).replace('lanes: vertical', 'lanes: horizontal'));
    assert.ok(await shown(d, 'Collapse Reading', 2500), 'lanes: horizontal shows within 2 s (rows with chevrons)');
    const changed = changedPaths(before, tree(c.vault));
    assert.deepEqual(changed, [BOOK, Q('Rozečtené')].sort(), 'Tegg writes nothing itself');
  } finally { await cleanup(c); }
});

test('fr_qry_09_ac6_cards_follow_edits', { timeout: 300_000 }, async () => {
  await ready();
  const c = fresh('q09ac6');
  try {
    const d = await launch(c, 'type/book');
    await selectTab(d, 'Rozečtené');
    assert.ok(await shown(d, 'Reading, 3 cards', 8000), 'Reading, 3 cards');
    const before = tree(c.vault);
    externalWrite(c, 'Books/Noční vlak.md', fixture('Books/Noční vlak.md').replace('status: Reading', 'status: Read'));
    externalWrite(c, 'Books/Nová kniha.md', '---\nid: 01JB5V00000000000000000099\ntype: book\ntitle: Nová kniha\nstatus: To read\ncreated: 2026-11-19T09:00:00+01:00\nmodified: 2026-11-19T09:00:00+01:00\n---\nNová.\n');
    externalWrite(c, KNIHA, null);
    assert.ok(await shown(d, 'Reading, 2 cards', 2500), 'Noční vlak leaves Reading within 2 s');
    assert.ok(await shown(d, 'Book: Nová kniha', 2500), 'the new book shows');
    assert.equal(await shown(d, 'Book: Kniha o horách', 500), false, 'the deleted book is gone');
    assert.ok(await shown(d, 'To read, 2 cards', 1000), 'counts included');
    const changed = changedPaths(before, tree(c.vault));
    assert.deepEqual(changed, ['Books/Kniha o horách.md', 'Books/Nová kniha.md', 'Books/Noční vlak.md'].map((p) => p.normalize('NFC')).sort(), 'the board writes nothing');
  } finally { await cleanup(c); }
});

// ------------------------------------------------------------------------------------------------ FR-QRY-05 AC-13, AC-18, AC-21, AC-23

test('fr_qry_05_ac13_card_drag_writes_once', { timeout: 300_000 }, async () => {
  await ready();
  const c = fresh('q05ac13');
  try {
    const before = tree(c.vault);
    const d = await launch(c, 'type/book');
    await selectTab(d, 'Rozečtené');
    const from = await rectOf(d, 'Book: Kniha o horách', 8000);
    const to = await rectOf(d, 'Reading, 3 cards');
    await dragFromTo(d, { x: from.x + from.width / 2, y: from.y + 12 }, { x: to.x + to.width / 2, y: to.y + to.height - 30 });
    assert.equal(await waitText(c, KNIHA, (t) => t === expected('books/kniha-o-horach-reading.md'), 5000), expected('books/kniha-o-horach-reading.md'), 'exactly line 6 and line 9 change');
    await sleep(800);
    const after = tree(c.vault);
    assert.deepEqual(changedPaths(before, after), [KNIHA.normalize('NFC')], 'every other vault file untouched');
    const a = before[KNIHA.normalize('NFC')], b = after[KNIHA.normalize('NFC')];
    assert.ok(a !== 'dir' && b !== 'dir' && a.ino !== b.ino && b.mtimeMs >= a.mtimeMs, 'a temporary file renamed in Books/ (new inode)');
    assert.ok(await shown(d, 'Reading, 4 cards', 2000), 'Reading shows 4');
    assert.ok(await textShown(d, 'Moved "Kniha o horách" to Reading', 2000) || await shown(d, 'Moved "Kniha o horách" to Reading', 500), 'the live region');
  } finally { await cleanup(c); }
});

test('fr_qry_05_ac18_folding_rows_is_machine_local', { timeout: 300_000 }, async () => {
  await ready();
  const c = fresh('q05ac18');
  try {
    writeFileSync(join(c.vault, BOOK), fixture(BOOK).replace('views: [Rozečtené, Přečtené 2026, Výborné knihy]', 'views: [Rozečtené, Přečtené 2026, Výborné knihy, Podle žánru]'));
    const before = tree(c.vault);
    let d = await launch(c, 'type/book');
    await selectTab(d, 'Podle žánru');
    await (await need(d, 'Collapse Román', 8000)).click();
    assert.ok(await shown(d, 'Expand Román', 2000), 'Román folded');
    assert.ok(await waitFor(() => JSON.stringify(uiState(c)?.boardFolded?.['Podle žánru']) === JSON.stringify(['option:Román']), 3000), 'ui-state.json: boardFolded["Podle žánru"]');
    d = await relaunch(c, 'type/book');
    assert.ok(await shown(d, 'Expand Román', 8000), 'the fold survives a relaunch');
    assert.deepEqual(changedPaths(before, tree(c.vault)), [], 'folding writes nothing to the vault');
  } finally { await cleanup(c); }
});

test('fr_qry_05_ac21_board_in_a_note', { timeout: 300_000 }, async () => {
  await ready();
  const c = fresh('q05ac21');
  try {
    const before = tree(c.vault);
    const d = await launch(c, `note/${CTENI}`);
    const from = await rectOf(d, 'Book: Kniha o horách', 8000);
    const to = await rectOf(d, 'Reading, 3 cards');
    await dragFromTo(d, { x: from.x + from.width / 2, y: from.y + 12 }, { x: to.x + to.width / 2, y: to.y + to.height - 30 });
    assert.equal(await waitText(c, KNIHA, (t) => t === expected('books/kniha-o-horach-reading.md'), 5000), expected('books/kniha-o-horach-reading.md'), 'a drag in the block writes AC-13\'s bytes');
    await sleep(1000);
    assert.deepEqual(changedPaths(before, tree(c.vault)), [KNIHA.normalize('NFC')], 'the note holding the block is never written');
    assert.equal(read(c, CTENI), fixture(CTENI), 'Čtení byte-identical');
  } finally { await cleanup(c); }
});

test('fr_qry_05_ac23_widths_per_query_shared_by_tab_and_blocks', { timeout: 300_000 }, async () => {
  await ready();
  const c = fresh('q05ac23');
  try {
    const before = tree(c.vault);
    let d = await launch(c, `note/${CTENI}`);
    const h = await rectOf(d, 'Resize Title', 8000);
    const title = await rectOf(d, 'Title');
    await dragFromTo(d, mid(h), { x: mid(h).x + (200 - title.width), y: mid(h).y });
    assert.ok(await waitFor(() => uiState(c)?.queryColumnWidths?.['Přečtené 2026']?.title === 200, 3000), `queryColumnWidths["Přečtené 2026"].title = 200 (${JSON.stringify(uiState(c)?.queryColumnWidths)})`);
    d = await relaunch(c, 'type/book');
    await selectTab(d, 'Přečtené 2026');
    const w = (await rectOf(d, 'Title', 5000)).width;
    assert.ok(Math.abs(w - 200) <= 2, `after a relaunch the tab's Title is 200 px (${w})`);
    assert.deepEqual(changedPaths(before, tree(c.vault)), [], 'no vault file changes');
  } finally { await cleanup(c); }
});

// ------------------------------------------------------------------------------------------------ FR-SYN-06 AC-48

test('fr_syn_06_ac48_only_view_actions_write', { timeout: 600_000 }, async () => {
  await ready();
  const c = fresh('syn06ac48');
  try {
    writeFileSync(join(c.vault, BOOK), fixture(BOOK).replace('views: [Rozečtené, Přečtené 2026, Výborné knihy]', 'views: [Rozečtené, Přečtené 2026, Výborné knihy, Podle žánru, Podle autora]'));
    const before = tree(c.vault);
    let d = await launch(c, 'type/book');
    for (const t of ['Rozečtené', 'Přečtené 2026', 'Výborné knihy', 'Podle žánru', 'Podle autora']) {
      await selectTab(d, t);
      await (await need(d, 'View actions', 5000)).click();
      await sleep(300);
      press('escape');
      await (await need(d, 'Sort', 3000)).click();
      await sleep(300);
      press('escape');
      await sleep(300);
    }
    await selectTab(d, 'Podle žánru');
    await (await need(d, 'Collapse Román', 5000)).click();
    await (await need(d, 'Expand Román', 3000)).click();
    await (await need(d, 'Add view', 3000)).click();
    await sleep(300);
    press('escape');
    await openNote(d, 'Čtení 2026');
    await sleep(1000);
    d = await relaunch(c, 'queries');
    await sleep(800);
    assert.deepEqual(changedPaths(before, tree(c.vault)), [], 'the tour leaves every vault file byte-, mtime- and inode-identical and creates nothing');
    // Then each action writes exactly its file, once.
    d = await relaunch(c, 'type/book');
    await selectTab(d, 'Rozečtené');
    await (await need(d, 'Horizontal', 5000)).click();
    assert.equal(await waitText(c, Q('Rozečtené'), (t) => t === expected('rozectene-lanes-horizontal.yml'), 5000), expected('rozectene-lanes-horizontal.yml'), 'Switch lanes writes Rozečtené.yml');
    const mid1 = tree(c.vault);
    assert.deepEqual(changedPaths(before, mid1), [Q('Rozečtené').normalize('NFC')], 'only that file');
    await (await need(d, 'Vertical', 3000)).click();
    await waitText(c, Q('Rozečtené'), (t) => !!t && t.includes('lanes: vertical\n'), 5000);
    const vyb = await rectOf(d, 'Výborné knihy');
    const roz = await rectOf(d, 'Rozečtené');
    await dragFromTo(d, mid(vyb), { x: roz.x + 4, y: roz.y + roz.height / 2 });
    await waitText(c, BOOK, (t) => !!t && t.includes('views: [Výborné knihy, Rozečtené'), 5000);
    assert.deepEqual(changedPaths(before, tree(c.vault)), [BOOK, Q('Rozečtené')].map((p) => p.normalize('NFC')).sort(), 'a tab drag adds only book.yml');
    assert.ok(!Object.keys(tree(c.vault)).some((p) => /ui-state|\.sqlite|index/i.test(p)), 'no index or UI state in the vault');
  } finally { await cleanup(c); }
});

// ------------------------------------------------------------------------------------------------ FR-UX-08 AC-24

test('fr_ux_08_ac24_views_for_voiceover', { timeout: 300_000 }, async () => {
  await ready();
  const c = fresh('ux08ac24');
  try {
    const d = await launch(c, 'type/book');
    assert.ok(await shown(d, 'Views', 8000), 'the tab list `Views`');
    for (const t of ['All Books', 'Rozečtené', 'Přečtené 2026', 'Výborné knihy', 'Add view']) assert.ok(await shown(d, t, 3000), `${t} in the accessibility tree`);
    await selectTab(d, 'Rozečtené');
    for (const l of ['Reading, 3 cards', 'To read, 2 cards', 'Read, 0 cards', 'Book: Noční vlak', 'Book: Účetní ze Žižkova', 'Lanes', 'Vertical', 'Horizontal']) {
      assert.ok(await shown(d, l, 3000), `${l} by name`);
    }
    assert.ok(await inside(d, 'Book: Noční vlak', 'Reading, 3 cards'), 'Noční vlak is inside the Reading lane');
    const roz = await need(d, 'Rozečtené');
    assert.ok(String(await roz.getAttribute('selected').catch(() => '')).match(/true|1/) || String(await roz.getAttribute('value').catch(() => '')).match(/1|true/), 'Rozečtené reads as selected');
    void needMenuItem;
  } finally { await cleanup(c); }
});

void esc;
