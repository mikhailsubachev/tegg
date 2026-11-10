// Slice Q real-app tests (L6, Appium mac2 on the built test app, D-382): docs/acceptance/queries.md, every criterion whose
// layer names L6 except the three latency criteria (NFR-PERF-05 AC-5, NFR-PERF-07 AC-2, NFR-PERF-08 AC-2), which are in
// nfr_perf_queries.ac.test.ts. Here: FR-QRY-03 AC-1 (once: the same query on two notes), FR-QRY-06 AC-1 (once: the
// sidebar entry and the Queries page), AC-6 (once: the rename job patches the file, the three usages and a pin), AC-9
// (once: `/query` inserts a reference fence), AC-17 (once with the helper: query files changed outside), FR-QRY-09 AC-2
// (with the helper: external edits update an open block), FR-TPL-04 AC-1 (once: a new Schůzka from the template finds its
// own tasks), FR-SYN-06 AC-44 (the tour writes nothing; each query action writes only its file), FR-NAV-04 AC-12 (once: the
// sidebar order) and FR-UX-08 AC-18 (once: what the macOS accessibility tree reads). Interface
// docs/contracts/v1-queries.md §4.3 (DOM names), §4.5 (strings), §5 (TEGG_NOW, the external helper). Always TEGG_TEST=1
// with the slice Q test clock, a temporary Application Support and a temporary copy of tests/fixtures/vaults/queries plus
// tests/fixtures/vaults/new-empty/.tegg (D-62). Keys go only to Tegg (D-799): every key is sent while Tegg is frontmost
// (helpers/capture.ts `press`). Written from the ACs and the contract only (D-61).
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import {
  FX, REPO, appiumDown, changedPaths, clickable, end, firstShown, marks, need, needMenuItem, paste, press, ready, session, shown, sleep, support,
  testEnv, textContains, tmp, tree, typeAscii, waitFor, type Driver, type Env,
} from './helpers/capture.ts';

after(appiumDown);
process.on('exit', appiumDown);

/** The slice Q test clock (queries.md): Tuesday 10 Nov 2026, 10:00 in Prague (testEnv's TZ). */
const NOW_Q = '2026-11-10T10:00:00+01:00';
const EXPECTED = join(REPO, 'tests/fixtures/queries-files/expected');
const EXTERNAL = resolve(import.meta.dirname, 'helpers/external.ts');
const expected = (name: string) => readFileSync(join(EXPECTED, name), 'utf8');
const Q = (name: string) => `.tegg/queries/${name}.yml`;
const P = {
  porada7: 'Schůzky/2026-10-07 Týdenní porada.md', porada14: 'Schůzky/2026-10-14 Týdenní porada.md',
  t1: 'Tasks/Poslat návrh rozpočtu Janě.md', t4: 'Tasks/Zeptat se Jany na limit cest.md',
  lisabon: 'Projekty/Výjezd Lisabon 2026.md', prehled: 'Pages/Přehled dotazů.md', sablona: '_templates/Schůzka/Schůzka.md',
  pins: '.tegg/pinned.yml',
};
/** Task titles of the fixture (R146 short names). */
const T = {
  t1: 'Poslat návrh rozpočtu Janě', t2: 'Zarezervovat místo v Lisabonu', t3: 'Připravit program výjezdu', t4: 'Zeptat se Jany na limit cest',
  t5: 'Uzavřít zápis z porady', t6: 'Úkol z druhé porady', t7: 'Zaplatit zálohu',
};
const ALL_TASKS = Object.values(T);
const OPEN = 'Otevřené úkoly z této schůzky';
const UKOLY = 'Úkoly z této schůzky';
/** FR-QRY-06 AC-1: the eleven queries ordered Created ↓, `Nečitelný` (unreadable) last. */
const CREATED_DESC = [
  'Vytvořeno v tento den', OPEN, UKOLY, 'Vše, co sem odkazuje', 'Projekty v běhu', 'Knihy s hodnocením', 'Zrušené úkoly', 'Úkoly po termínu',
  'Komentáře a neznámé klíče', 'Novější verze', 'Nečitelný',
];

/** A temp copy of tests/fixtures/vaults/queries (without README.md) plus new-empty/.tegg (fixture README). */
function vaultCopy(base: string, name = 'Dotazy'): string {
  const v = join(base, name);
  const src = join(FX, 'queries');
  cpSync(src, v, { recursive: true, filter: (s) => relative(src, s) !== 'README.md' });
  cpSync(join(FX, 'new-empty/.tegg'), join(v, '.tegg'), { recursive: true });
  return v;
}
type Ctx = { base: string; vault: string; sup: string; log: string; d?: Driver; n: number };
function fresh(name: string): Ctx {
  const base = tmp(`q-${name}`);
  return { base, vault: vaultCopy(base), sup: support(base), log: join(base, 'perf.jsonl'), n: 0 };
}
async function launch(c: Ctx, route = 'inbox', extra: Env = {}): Promise<Driver> {
  c.n += 1;
  c.log = join(c.base, `perf-${c.n}.jsonl`);
  c.d = await session(testEnv(c.sup, c.log, { TEGG_VAULT: c.vault, TEGG_ROUTE: route, TEGG_NOW: NOW_Q, ...extra }));
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
/** "Another program" (helpers/external.ts, contract §5): a separate process writes, renames or deletes vault files. */
function external(...args: string[]) {
  execFileSync(process.execPath, [EXTERNAL, ...args], { encoding: 'utf8' });
}
function externalWrite(c: Ctx, rel: string, text: string) {
  const f = join(c.base, `ext-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`);
  writeFileSync(f, text);
  external('write', join(c.vault, rel), f);
  rmSync(f, { force: true });
}
const read = (c: Ctx, rel: string) => (existsSync(join(c.vault, rel)) ? readFileSync(join(c.vault, rel), 'utf8') : null);
const fixture = (rel: string) => readFileSync(join(FX, 'queries', rel), 'utf8');
const stamp = (c: Ctx, rel: string) => tree(c.vault)[rel.normalize('NFC')] ?? null;
async function waitText(c: Ctx, rel: string, ok: (t: string | null) => boolean, ms: number): Promise<string | null> {
  await waitFor(() => ok(read(c, rel)), ms);
  return read(c, rel);
}
async function textShown(d: Driver, text: string, ms = 3000): Promise<boolean> {
  return waitFor(async () => {
    for (const e of await d.$$(`-ios predicate string:${textContains(text)}`).catch(() => [] as any[])) if (await e.isDisplayed().catch(() => false)) return true;
    return false;
  }, ms);
}
async function rect(d: Driver, label: string) {
  const e = await need(d, label, 5000);
  return d.getElementRect(e.elementId);
}
async function inOrder(d: Driver, labels: string[]): Promise<{ ok: boolean; ys: number[] }> {
  const ys: number[] = [];
  for (const l of labels) {
    if (!(await shown(d, l, 3000))) return { ok: false, ys };
    ys.push((await rect(d, l)).y);
  }
  return { ok: ys.every((y, i) => i === 0 || y > ys[i - 1]), ys };
}
/** What the sidebar entry `label` says: its label, help and value, and the texts inside it (the count). */
async function entrySays(d: Driver, label: string): Promise<string> {
  const e = await need(d, label, 5000);
  const own = [await e.getAttribute('label').catch(() => ''), await e.getAttribute('help').catch(() => ''), await e.getAttribute('value').catch(() => '')];
  const inner: string[] = [];
  for (const x of await e.$$('-ios predicate string:elementType == 48').catch(() => [] as any[])) inner.push(String(await x.getAttribute('value').catch(() => '')));
  return [...own.map(String), ...inner].join(' | ');
}
const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

// ------------------------------------------------------------------------------------------------ the query block (§4.3)

/** The shown query block whose accessible name is `Query: <title>` (R141 frame, `figure` `query.block.label`). */
async function blockOf(d: Driver, title: string, ms = 5000): Promise<any | null> {
  const endAt = Date.now() + ms;
  while (true) {
    for (const e of await d.$$(`-ios predicate string:label BEGINSWITH "${esc(`Query: ${title}`)}"`).catch(() => [] as any[])) {
      const l = String(await e.getAttribute('label').catch(() => ''));
      if ((l === `Query: ${title}` || l.startsWith(`Query: ${title},`)) && (await e.isDisplayed().catch(() => false))) return e;
    }
    if (Date.now() > endAt) return null;
    await sleep(100);
  }
}
/** Whether some shown element inside the block holds `text`. */
async function blockHas(d: Driver, title: string, text: string): Promise<boolean> {
  const b = await blockOf(d, title, 0);
  if (!b) return false;
  for (const e of await b.$$(`-ios predicate string:${textContains(text)}`).catch(() => [] as any[])) if (await e.isDisplayed().catch(() => false)) return true;
  return false;
}
/** Which of `candidates` the block shows (in the candidates' order). */
async function blockRows(d: Driver, title: string, candidates: string[]): Promise<string[]> {
  const out: string[] = [];
  for (const t of candidates) if (await blockHas(d, title, t)) out.push(t);
  return out;
}
/** Waits until the block shows exactly `want` among `candidates`; returns the last rows seen. */
async function blockShows(d: Driver, title: string, want: string[], candidates: string[], ms: number): Promise<string[]> {
  let last: string[] = [];
  await waitFor(async () => {
    last = await blockRows(d, title, candidates);
    return JSON.stringify(last) === JSON.stringify(candidates.filter((t) => want.includes(t)));
  }, ms);
  return last;
}
/** A button inside the block by its accessible name. */
async function blockButton(d: Driver, title: string, label: string, ms = 3000): Promise<any> {
  const endAt = Date.now() + ms;
  while (true) {
    const b = await blockOf(d, title, 0);
    for (const e of (b ? await b.$$(`-ios predicate string:label == "${esc(label)}" OR title == "${esc(label)}"`).catch(() => [] as any[]) : [])) {
      if (await e.isDisplayed().catch(() => false)) return clickable(d, e);
    }
    if (Date.now() > endAt) break;
    await sleep(100);
  }
  assert.fail(`"${label}" in the block "Query: ${title}" is shown`);
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
/** The frontmatter without its `modified:` line, and the body: an editor autosave may set `modified` (FR-FMT-02). */
function split(text: string | null): { head: string; body: string } {
  const m = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text ?? '');
  if (!m) return { head: '', body: text ?? '' };
  return { head: m[1].split('\n').filter((l) => !l.startsWith('modified:')).join('\n'), body: m[2] };
}
const fenceCount = (t: string | null) => (t ?? '').split('\n').filter((l) => l === '```query').length;

// ------------------------------------------------------------------------------------------------ FR-QRY-03 AC-1

test('fr_qry_03_ac1_this_is_the_host_in_the_real_app', { timeout: 300_000 }, async () => {
  await ready();
  const c = fresh('q03ac1');
  try {
    const before = tree(c.vault);
    let d = await launch(c, `note/${P.porada7}`);
    assert.ok(await blockOf(d, OPEN, 8000), `Porada 7: the block "Query: ${OPEN}"`);
    assert.deepEqual(await blockShows(d, OPEN, [T.t1, T.t2, T.t3], ALL_TASKS, 5000), [T.t1, T.t2, T.t3], 'Porada 7 lists T1, T2, T3 (R146)');
    await (await blockButton(d, OPEN, 'Edit query')).click();
    assert.ok(await shown(d, 'Edit query', 3000), 'the editor dialog `Edit query`');
    assert.ok(await textShown(d, 'This note · 2026-10-07 Týdenní porada', 3000), 'its Links to row reads `This note · 2026-10-07 Týdenní porada`');
    press('escape');
    await sleep(800);
    d = await relaunch(c, `note/${P.porada14}`);
    assert.ok(await blockOf(d, OPEN, 8000), `Porada 14: the block "Query: ${OPEN}"`);
    assert.deepEqual(await blockShows(d, OPEN, [T.t6], ALL_TASKS, 5000), [T.t6], 'Porada 14 lists T6, from the same file');
    await (await blockButton(d, OPEN, 'Edit query')).click();
    assert.ok(await textShown(d, 'This note · 2026-10-14 Týdenní porada', 3000), 'on Porada 14 the row reads `This note · 2026-10-14 Týdenní porada`');
    press('escape');
    await sleep(800);
    assert.deepEqual(changedPaths(before, tree(c.vault)), [], 'showing and closing the editor without a change writes nothing');
  } finally { await cleanup(c); }
});

// ------------------------------------------------------------------------------------------------ FR-QRY-06 AC-1, FR-NAV-04 AC-12

test('fr_qry_06_ac1_queries_entry_and_list_in_the_real_app', { timeout: 300_000 }, async () => {
  await ready();
  const c = fresh('q06ac1');
  try {
    const d = await launch(c);
    assert.ok(await shown(d, 'Queries', 5000), 'the sidebar entry `Queries`');
    assert.match(await entrySays(d, 'Queries'), /\b11\b/, 'its count 11');
    const order = await inOrder(d, ['Tags', 'Queries', 'Trash']);
    assert.ok(order.ok, `Queries after Tags and before Trash (${order.ys.join(', ')})`);
    await (await need(d, 'Queries')).click();
    assert.ok(await waitFor(() => marks(c.log).includes('route-ready:queries'), 5000), 'route-ready:queries');
    assert.ok(await textShown(d, '11 queries', 3000), '`11 queries` below the heading');
    for (const l of ['Find a query…', 'Created ↓', 'New query']) assert.ok(await shown(d, l, 3000) || await textShown(d, l, 1000), `${l} in the toolbar`);
    const rows = await inOrder(d, CREATED_DESC);
    assert.ok(rows.ok, `the eleven rows ordered Created ↓, Nečitelný last (${rows.ys.join(', ')})`);
    assert.ok(await textShown(d, "Can't be read", 2000), 'Nečitelný reads `Can\'t be read`');
    assert.equal(await textShown(d, 'Starý dotaz', 800), false, 'the trashed `Starý dotaz` isn\'t listed');
  } finally { await cleanup(c); }
});

test('fr_nav_04_ac12_queries_entry_in_the_real_app', { timeout: 300_000 }, async () => {
  await ready();
  const c = fresh('nav12');
  try {
    const d = await launch(c);
    const order = ['New object', 'Search', 'Inbox', 'Today', 'Tasks', 'Pinned', 'Tags', 'Queries', 'Trash'];
    const r = await inOrder(d, order);
    assert.ok(r.ok, `sidebar top to bottom: ${order.join(', ')} (${r.ys.join(', ')})`);
    assert.equal(await shown(d, 'Saved queries', 800), false, 'no `Saved queries` entry (AP-1304)');
    assert.equal(await textShown(d, 'Coming in v1.0', 500), false, 'the entry isn\'t TBD any more');
  } finally { await cleanup(c); }
});

// ------------------------------------------------------------------------------------------------ FR-QRY-06 AC-6

test('fr_qry_06_ac6_rename_patches_usages_and_pins_in_the_real_app', { timeout: 300_000 }, async () => {
  await ready();
  const c = fresh('q06ac6');
  const pins = `# Tegg sidebar pins (FR-HOM-02). Pin, unpin and reorder them in the sidebar.\nversion: 1\npins:\n  - query: ${OPEN}\n  - tag: offsite\n`;
  writeFileSync(join(c.vault, P.pins), pins);
  try {
    const before = tree(c.vault);
    const old = { p7: fixture(P.porada7), p14: fixture(P.porada14), sab: fixture(P.sablona) };
    const d = await launch(c, `query/${OPEN}`);
    await (await need(d, 'Query actions', 5000)).click();
    await (await needMenuItem(d, 'Rename…')).click();
    assert.ok(await shown(d, 'Rename query', 3000), 'the dialog `Rename query`');
    press('a', ['command']);
    paste('Otevřené úkoly porady');
    await sleep(300);
    press('enter');
    const renamed = await waitText(c, Q('Otevřené úkoly porady'), (t) => t !== null, 8000);
    assert.equal(renamed, expected('renamed-otevrene-ukoly-porady.yml'), 'the file renamed, only its `title:` line patched');
    assert.equal(read(c, Q(OPEN)), null, 'the old file name is gone');
    const saved = (t: string) => t.replace(`saved: ${OPEN}\n`, 'saved: Otevřené úkoly porady\n');
    assert.equal(await waitText(c, P.porada7, (t) => t === saved(old.p7), 5000), saved(old.p7), 'Porada 7: only the `saved:` line');
    assert.equal(await waitText(c, P.porada14, (t) => t === saved(old.p14), 5000), saved(old.p14), 'Porada 14: only the `saved:` line');
    assert.equal(await waitText(c, P.sablona, (t) => t === saved(old.sab), 5000), saved(old.sab), 'Šablona: only the `saved:` line');
    const wantPins = pins.replace(`  - query: ${OPEN}\n`, '  - query: Otevřené úkoly porady\n');
    assert.equal(await waitText(c, P.pins, (t) => t === wantPins, 5000), wantPins, '.tegg/pinned.yml: only the `query:` line');
    await sleep(1000);
    assert.deepEqual(changedPaths(before, tree(c.vault)), [P.pins, Q(OPEN), Q('Otevřené úkoly porady'), P.porada14, P.porada7, P.sablona].map((p) => p.normalize('NFC')).sort(),
      'every other vault file untouched');
    await openNote(d, '2026-10-07 Týdenní porada');
    assert.ok(await blockOf(d, 'Otevřené úkoly porady', 5000), 'Porada 7 shows the block under the new title');
    assert.deepEqual(await blockShows(d, 'Otevřené úkoly porady', [T.t1, T.t2, T.t3], ALL_TASKS, 5000), [T.t1, T.t2, T.t3], 'the block keeps its results');
  } finally { await cleanup(c); }
});

// ------------------------------------------------------------------------------------------------ FR-QRY-06 AC-9

test('fr_qry_06_ac9_insert_saved_query_block_in_the_real_app', { timeout: 300_000 }, async () => {
  await ready();
  const c = fresh('q06ac9');
  try {
    const old = fixture(P.lisabon);
    const queriesBefore = Object.keys(tree(c.vault)).filter((k) => k.startsWith('.tegg/queries/'));
    const d = await launch(c, `note/${P.lisabon}`);
    assert.ok(await shown(d, 'Note body', 5000), 'the editor');
    // The caret at the end of Lisabon's last paragraph, then a new paragraph for the slash menu (FR-EDT-03 AC-1).
    const para = await firstShown(d, 'Cesta týmu do Lisabonu.');
    assert.ok(para, 'the paragraph `Cesta týmu do Lisabonu.`');
    await clickable(d, para).click();
    press('right', ['command']);
    press('enter');
    // The main path once (L6); Esc in the picker and the palette / `+` entry points are L5 (queries_block).
    typeAscii('/quer');
    assert.ok(await shown(d, 'Query', 2000), 'the slash menu lists `Query`');
    assert.ok(await textShown(d, 'A live list of objects', 2000), 'with the description `A live list of objects`');
    press('enter');
    assert.ok(await shown(d, 'Choose a query', 3000), 'the picker `Choose a query`');
    const order = await inOrder(d, ['New query', 'Knihy s hodnocením', 'Projekty v běhu', 'Zrušené úkoly']);
    assert.ok(order.ok, `New query first, then the readable queries by title (${order.ys.join(', ')})`);
    assert.equal(await shown(d, 'Nečitelný', 500), false, 'the unreadable query isn\'t offered');
    await (await need(d, 'Projekty v běhu')).click();
    const fence = '```query\nsaved: Projekty v běhu\n```\n';
    const t = await waitText(c, P.lisabon, (x) => fenceCount(x) === 2, 5000);
    const was = split(old), now = split(t);
    assert.equal(now.head, was.head, 'the frontmatter is unchanged (apart from `modified`)');
    assert.equal(now.body, was.body.replace('Cesta týmu do Lisabonu.\n\n', `Cesta týmu do Lisabonu.\n\n${fence}\n`), 'the fence `saved: Projekty v běhu` as a new block after the paragraph');
    assert.ok(await blockOf(d, 'Projekty v běhu', 5000), 'the block `Query: Projekty v běhu`');
    const shownRows = await blockShows(d, 'Projekty v běhu', ['Cesta do Brna', 'Čajovna na nábřeží', 'Malý projekt'], ['Cesta do Brna', 'Čajovna na nábřeží', 'Malý projekt'], 5000);
    assert.deepEqual(shownRows, ['Cesta do Brna', 'Čajovna na nábřeží', 'Malý projekt'], 'its results (R146 `Projekty v běhu`)');
    assert.deepEqual(Object.keys(tree(c.vault)).filter((k) => k.startsWith('.tegg/queries/')), queriesBefore, 'inserting creates no query file');
  } finally { await cleanup(c); }
});

// ------------------------------------------------------------------------------------------------ FR-QRY-06 AC-17

test('fr_qry_06_ac17_query_files_changed_outside_in_the_real_app', { timeout: 300_000 }, async () => {
  await ready();
  const c = fresh('q06ac17');
  const LIDE = 'Pages/Lidé.md';
  writeFileSync(join(c.vault, LIDE), '---\nid: 01JB5Q00000000000000000040\ntype: page\ntitle: Lidé\n---\nKdo je kdo.\n\n```query\nsaved: Osoby\n```\n');
  const copy = Q('Projekty v běhu 2');
  writeFileSync(join(c.vault, copy), fixture(Q('Projekty v běhu')));
  const osoby = (types: string) => `version: 1\ntitle: Osoby\ntypes: [${types}]\nview: list\ncreated: 2026-11-10T09:00:00+01:00\nmodified: 2026-11-10T09:00:00+01:00\n`;
  try {
    const copyStamp = stamp(c, copy);
    let d = await launch(c, 'queries');
    assert.ok(await textShown(d, '12 queries', 5000), 'the sync conflict copy is its own query: 12 queries');
    externalWrite(c, Q('Osoby'), osoby('osoba'));
    // Counted, not looked up by name: the sidebar's Types list also has an `Osoby` entry.
    assert.ok(await textShown(d, '13 queries', 2500), 'a helper creates Osoby.yml: its row and the count within 2 s');
    d = await relaunch(c, `note/${LIDE}`);
    assert.ok(await blockOf(d, 'Osoby', 8000), 'the block `Query: Osoby` on Lidé');
    assert.deepEqual(await blockShows(d, 'Osoby', ['Jana Nováková'], ['Jana Nováková', 'Krakatit', 'Válka s mloky'], 3000), ['Jana Nováková'], 'Osoby lists Jana');
    externalWrite(c, Q('Osoby'), osoby('kniha'));
    assert.deepEqual(await blockShows(d, 'Osoby', ['Krakatit', 'Válka s mloky'], ['Jana Nováková', 'Krakatit', 'Válka s mloky'], 2500), ['Krakatit', 'Válka s mloky'],
      '`types: [kniha]` from outside: the open block follows within 2 s');
    external('delete', join(c.vault, Q('Osoby')));
    assert.ok(await textShown(d, 'The query “Osoby” doesn\'t exist.', 2500), 'deleted: the block shows not found within 2 s');
    await (await need(d, 'Queries', 3000)).click();
    assert.ok(await textShown(d, '12 queries', 3000), 'its row is gone: 12 queries');
    assert.deepEqual(stamp(c, copy), copyStamp, 'the conflict copy is never renamed, merged or rewritten (bytes, mtime, inode)');
    assert.equal(read(c, Q('Osoby')), null, 'nothing re-creates Osoby.yml');
  } finally { await cleanup(c); }
});

// ------------------------------------------------------------------------------------------------ FR-QRY-09 AC-2

test('fr_qry_09_ac2_external_edits_update_results_in_the_real_app', { timeout: 300_000 }, async () => {
  await ready();
  const c = fresh('q09ac2');
  const NEW = 'Tasks/Nový úkol z porady.md';
  const NEW_TITLE = 'Nový úkol z porady';
  const candidates = [...ALL_TASKS, NEW_TITLE];
  try {
    const d = await launch(c, `note/${P.porada7}`);
    assert.ok(await blockOf(d, OPEN, 8000), `the block "Query: ${OPEN}"`);
    assert.deepEqual(await blockShows(d, OPEN, [T.t1, T.t2, T.t3], candidates, 5000), [T.t1, T.t2, T.t3], 'T1, T2, T3 at first');
    externalWrite(c, P.t4, fixture(P.t4).replace('priority: Low\n', 'priority: Low\ndue: 2026-11-20\n'));
    assert.deepEqual(await blockShows(d, OPEN, [T.t1, T.t2, T.t3, T.t4], candidates, 2000), [T.t1, T.t2, T.t3, T.t4], 'T4 due 2026-11-20 from outside: in the block within 2 s');
    externalWrite(c, NEW, `---\nid: 01JB5Q00000000000000000041\ntype: task\ntitle: ${NEW_TITLE}\nstatus: To do\npriority: High\ndue: 2026-11-13\nsource: "[[2026-10-07 Týdenní porada]]"\ncreated: 2026-11-10T09:00:00+01:00\nmodified: 2026-11-10T09:00:00+01:00\n---\n`);
    assert.deepEqual(await blockShows(d, OPEN, [T.t1, T.t2, T.t3, T.t4, NEW_TITLE], candidates, 2000), [T.t1, T.t2, T.t3, T.t4, NEW_TITLE], 'a new task linking Porada 7: in the block within 2 s');
    external('delete', join(c.vault, P.t1));
    assert.deepEqual(await blockShows(d, OPEN, [T.t2, T.t3, T.t4, NEW_TITLE], candidates, 2000), [T.t2, T.t3, T.t4, NEW_TITLE], 'T1 deleted: gone from the block within 2 s');
    assert.equal(read(c, P.porada7), fixture(P.porada7), 'the host is never written by the block');
  } finally { await cleanup(c); }
});

// ------------------------------------------------------------------------------------------------ FR-TPL-04 AC-1

test('fr_tpl_04_ac1_template_block_uses_the_new_note_in_the_real_app', { timeout: 300_000 }, async () => {
  await ready();
  const c = fresh('tpl04');
  const NEW_NOTE = 'Schůzky/2026-11-10 Porada.md';
  const TASK = 'Tasks/Úkol z nové porady.md';
  const TASK_TITLE = 'Úkol z nové porady';
  try {
    const p7 = stamp(c, P.porada7);
    const d = await launch(c);
    press('n', ['command']);
    assert.ok(await shown(d, 'Choose a type', 3000), 'the New object type picker (D-1431)');
    typeAscii('schu');
    await sleep(400);
    press('enter');
    assert.ok(await shown(d, 'Title', 3000), 'the draft\'s Title field');
    await sleep(400);
    paste('2026-11-10 Porada');
    await sleep(300);
    press('enter');
    const t = await waitText(c, NEW_NOTE, (x) => x !== null, 5000);
    assert.ok(t !== null, 'Schůzky/2026-11-10 Porada.md is written');
    assert.equal(split(t).body, split(fixture(P.sablona)).body, 'the template body is copied with the fence unchanged');
    assert.ok(await blockOf(d, OPEN, 5000), `the new note shows the block "Query: ${OPEN}"`);
    assert.ok(await waitFor(() => blockHas(d, OPEN, 'No objects match.'), 3000), 'its block shows `No objects match.`');
    externalWrite(c, TASK, `---\nid: 01JB5Q00000000000000000042\ntype: task\ntitle: ${TASK_TITLE}\nstatus: To do\npriority: Medium\ndue: 2026-11-12\nsource: "[[2026-11-10 Porada]]"\ncreated: 2026-11-10T09:30:00+01:00\nmodified: 2026-11-10T09:30:00+01:00\n---\n`);
    // An outside write reaches an open block within NFR-PERF-08's 2 s (the 1 s of a Tegg edit is checked at L5).
    assert.deepEqual(await blockShows(d, OPEN, [TASK_TITLE], [...ALL_TASKS, TASK_TITLE], 2500), [TASK_TITLE], 'the block lists the new task');
    await openNote(d, '2026-10-07 Týdenní porada');
    assert.ok(await blockOf(d, OPEN, 5000), 'Porada 7');
    assert.deepEqual(await blockShows(d, OPEN, [T.t1, T.t2, T.t3], [...ALL_TASKS, TASK_TITLE], 3000), [T.t1, T.t2, T.t3], 'Porada 7\'s block is unchanged');
    assert.deepEqual(stamp(c, P.porada7), p7, 'Porada 7 untouched');
  } finally { await cleanup(c); }
});

// ------------------------------------------------------------------------------------------------ FR-SYN-06 AC-44

/** Every fixture note outside `_templates/` and `.trash/`, by title (fixture README). */
const NOTE_TITLES = [
  '2026-10-07 Týdenní porada', '2026-10-14 Týdenní porada', ...ALL_TASKS, 'Výjezd Lisabon 2026', 'Rozpočet Q4', 'Čajovna na nábřeží', 'Cesta do Brna',
  'Malý projekt', 'Jana Nováková', 'Válka s mloky', 'Krakatit', 'Dotaz na rozpočet', '2026-11-10', 'Přehled dotazů', 'Bez hlavičky',
];

test('fr_syn_06_ac44_only_query_actions_write_in_the_real_app', { timeout: 900_000 }, async () => {
  await ready();
  const c = fresh('syn44');
  try {
    const before = tree(c.vault);
    let d = await launch(c, 'queries');
    // The tour: every query page (and back), every note, editors and menus closed with Esc, a relaunch.
    for (const title of CREATED_DESC) {
      await (await need(d, title, 5000)).click();
      assert.ok(await shown(d, 'Query actions', 5000), `the query page of ${title}`);
      if (title !== 'Nečitelný' && title !== 'Novější verze') {
        await (await need(d, 'Edit query', 3000)).click();
        await sleep(500);
        press('escape');
      }
      await (await need(d, 'Query actions', 3000)).click();
      await sleep(300);
      press('escape');
      press('lbracket', ['command']);
      assert.ok(await shown(d, '11 queries', 5000) || await textShown(d, '11 queries', 2000), 'back on Queries');
    }
    for (const title of NOTE_TITLES) await openNote(d, title);
    await openNote(d, '2026-10-07 Týdenní porada');
    await (await blockButton(d, OPEN, 'Edit query', 5000)).click();
    await sleep(500);
    press('escape');
    await (await blockButton(d, UKOLY, 'Columns', 5000)).click();
    await sleep(300);
    press('escape');
    d = await relaunch(c, `note/${P.prehled}`);
    await sleep(1500);
    assert.deepEqual(changedPaths(before, tree(c.vault)), [], 'the tour leaves every vault file identical and creates nothing');

    // Each action writes exactly its file, once.
    d = await relaunch(c, `note/${P.porada7}`);
    let pre = tree(c.vault);
    await (await blockButton(d, UKOLY, 'Due date', 5000)).click();
    assert.ok(await waitFor(() => changedPaths(pre, tree(c.vault)).length > 0, 3000), 'a header click writes');
    await sleep(1000);
    assert.deepEqual(changedPaths(pre, tree(c.vault)), [Q(UKOLY).normalize('NFC')], 'header sort: only the query file (D-1444)');

    d = await relaunch(c, 'queries');
    pre = tree(c.vault);
    await (await need(d, 'New query', 5000)).click();
    assert.ok(await shown(d, 'Query name', 3000), 'the dialog `New query` with `Query name`');
    paste('Úkoly na víkend');
    await sleep(300);
    press('enter');
    assert.equal(await waitText(c, Q('Úkoly na víkend'), (t) => t !== null, 5000), expected('created.yml'), 'New query: expected/created.yml');
    press('escape'); // the editor opens on the new query page; Esc without a change writes nothing
    await sleep(1000);
    assert.deepEqual(changedPaths(pre, tree(c.vault)), [Q('Úkoly na víkend').normalize('NFC')], 'New query: only the new file');

    d = await relaunch(c, 'query/Projekty v běhu');
    pre = tree(c.vault);
    await (await need(d, 'Query actions', 5000)).click();
    await (await needMenuItem(d, 'Duplicate')).click();
    assert.equal(await waitText(c, Q('Projekty v běhu (2)'), (t) => t !== null, 5000), expected('duplicate-projekty-v-behu-2.yml'), 'Duplicate: expected bytes');
    await sleep(1000);
    assert.deepEqual(changedPaths(pre, tree(c.vault)), [Q('Projekty v běhu (2)').normalize('NFC')], 'Duplicate: only the copy');

    pre = tree(c.vault);
    const dup = read(c, Q('Projekty v běhu (2)'));
    await (await need(d, 'Query actions', 5000)).click();
    await (await needMenuItem(d, 'Move to trash')).click();
    const trashed = `.trash/${Q('Projekty v běhu (2)')}`;
    assert.equal(await waitText(c, trashed, (t) => t !== null, 5000), dup, 'Move to trash: the same bytes in .trash/.tegg/queries/');
    await sleep(1000);
    assert.deepEqual(changedPaths(pre, tree(c.vault)), [Q('Projekty v běhu (2)'), trashed].map((p) => p.normalize('NFC')).sort(), 'Move to trash: only the move');
  } finally { await cleanup(c); }
});

// ------------------------------------------------------------------------------------------------ FR-UX-08 AC-18

test('fr_ux_08_ac18_queries_for_voiceover_in_the_real_app', { timeout: 300_000 }, async () => {
  await ready();
  const c = fresh('ux18');
  try {
    const d = await launch(c, `note/${P.porada7}`);
    const b = await blockOf(d, OPEN, 8000);
    assert.ok(b, `the block is named "Query: ${OPEN}" in the accessibility tree`);
    const said = [
      String(await b.getAttribute('label').catch(() => '')), String(await b.getAttribute('help').catch(() => '')),
      String(await b.getAttribute('AXHelp').catch(() => '')), String(await b.getAttribute('value').catch(() => '')),
    ].join(' | ');
    assert.match(said, /3 results/, `the block reads its result count \`3 results\` (aria-description): ${said}`);
    assert.deepEqual(await blockShows(d, OPEN, [T.t1, T.t2, T.t3], ALL_TASKS, 3000), [T.t1, T.t2, T.t3], 'its three rows by title');
    for (const s of ['Thu 12 Nov', 'To do', 'In progress']) assert.ok(await blockHas(d, OPEN, s), `a row reads ${s} (task due date and status)`);
    const table = await blockOf(d, UKOLY, 3000);
    assert.ok(table, `the second block "Query: ${UKOLY}"`);
    for (const h of ['Title', 'Status', 'Priority', 'Due date', 'Modified']) assert.ok(await blockHas(d, UKOLY, h), `the table's column header ${h}`);
    await (await blockButton(d, OPEN, 'Edit query')).click();
    assert.ok(await shown(d, 'Edit query', 3000), 'the editor is a dialog named `Edit query`');
    assert.ok(await shown(d, 'Combine filters with and', 3000), 'its connector reads `Combine filters with and`');
    assert.ok(await shown(d, 'Filter group: any of', 3000), 'its group reads `Filter group: any of`');
    press('escape');
  } finally { await cleanup(c); }
});
