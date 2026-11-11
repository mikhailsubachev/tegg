// Slice PIN, L1: the pins model (app/ui/src/pinned/model.ts; docs/contracts/v1-pinned.md §3.1): `rowView` (R133 icons,
// colours, labels, descriptions, tooltips, what a click does), `findPin` (NFC, a Tag object maps to its tag), `targetOfRoute`
// (what can be pinned, AP-1239), `editReason` (AC-22, AC-23), `dropIndex` (R135's line) and `moveTarget` (⌥⌘↑/↓ at the
// ends). docs/acceptance/pinned.md FR-HOM-02 AC-2, AC-3, AC-4, AC-7, AC-10, AC-11, AC-16…AC-18, AC-22, AC-23, FR-FMT-12
// AC-8. Rows come from the fake core's resolution of tests/fixtures/pinned-files/ (app/ui/test/fake-pins.ts, the same
// files the Rust module reads). Written from the ACs and the contract only (D-61). Modules load inside the tests and every
// call goes through `run`, so a missing module is an AssertionError (TS-I1).
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { loadFixtureVault } from '../ui/test/fake-core';
import { pinsRead, pinsResolve, type PinRowDto, type PinsDto } from '../ui/test/fake-pins';

type Mod = Record<string, any>;
async function load(path: string): Promise<Mod | null> {
  try { return (await import(/* @vite-ignore */ path)) as Mod; } catch { return null; }
}
async function model(): Promise<Mod> {
  const m = await load('../ui/src/pinned/model.ts');
  assert.ok(m, 'ui/src/pinned/model.ts loads (§3.1)');
  return m!;
}
function run<T>(what: string, f: () => T): T {
  try { return f(); } catch (e) { assert.fail(`${what} threw: ${(e as Error)?.message ?? e}`); }
}

const FX = resolve(import.meta.dirname, '../../tests/fixtures/pinned-files');
const fx = (name: string) => readFileSync(join(FX, name), 'utf8');
const files = (() => {
  const v = loadFixtureVault('tests/fixtures/vaults/pinned', 'tests/fixtures/vaults/new-empty/.tegg');
  delete v.files['README.md'];
  delete v.files['_attachments/graf.png'];
  return v.files;
})();
const dtoOf = (text: string | null, ready = true): PinsDto => {
  const read = pinsRead(text);
  return { version: null, state: read.state, error: read.error, patchable: read.patchable, indexReady: ready, rows: pinsResolve(read, files, ready) };
};
/** The Types list's entries (`typeEntries`, ms3-shell §3) for the fixture's types. */
const TYPES = [
  { key: 'page', name: 'Page', plural: 'Pages', icon: 'file-text', color: 'gray', system: true },
  { key: 'task', name: 'Task', plural: 'Tasks', icon: 'check-square', color: 'blue', system: true },
  { key: 'daily-note', name: 'Daily Note', plural: 'Daily Notes', icon: 'calendar', color: 'purple', system: true },
  { key: 'image', name: 'Image', plural: 'Images', icon: 'image', color: 'teal', system: true },
  { key: 'tag', name: 'Tag', plural: 'Tags', icon: 'hash', color: 'green', system: true },
  { key: 'projekt', name: 'Projekt', plural: 'Projekty', icon: 'folder', color: 'orange', system: false },
  { key: 'schůzka', name: 'Schůzka', plural: 'Schůzky', icon: 'users', color: 'teal', system: false },
].map((t) => ({ ...t, folder: t.plural, count: 1, invalid: false }));
/** Tag names and colours as tags/store.ts gives them. */
const tagLook = (key: string) => (key === 'offsite' ? { name: 'offsite', color: 'teal' } : { name: key, color: null });
const view = async (row: PinRowDto) => { const m = await model(); return run('rowView', () => m.rowView(row, TYPES, tagLook)); };

test('fr_hom_02_ac2_rows_keep_type_icon_and_colour', async () => {
  const d = dtoOf(fx('valid.yml'));
  const v = await Promise.all(d.rows.map(view));
  assert.deepEqual(v.slice(0, 5).map((x: any) => [x.label, x.icon, x.color, x.description]), [
    ['Rozpočet 2027', 'folder', 'orange', 'Projekt'], ['Výjezd Lisabon 2026', 'folder', 'orange', 'Projekt'],
    ['2026-10-07 Týdenní porada', 'users', 'teal', 'Schůzka'], ['#offsite', v[3]?.icon, 'teal', 'Tag'], ['Projekty', 'folder', 'orange', 'Type page'],
  ], 'R133 per kind');
  // Slice Q (queries.md FR-HOM-02 AC-29, D-1484, D-1501): valid.yml's `query:` item is a sixth row, `Not found` here.
  assert.deepEqual(v.slice(5).map((x: any) => [x.label, x.icon, x.description]), [['Otevřené úkoly tento týden', 'query', 'Query, Not found']], 'the query pin is listed (slice Q)');
  assert.equal(v[0].tooltip, 'Rozpočet 2027\nProjekty/Rozpočet 2027.md', 'object tooltip: label, newline, path (§8 14)');
  assert.equal(v[3].tooltip, '#offsite', 'tag tooltip: the label');
  const recoloured = await (await model()).rowView(d.rows[0], TYPES.map((t) => (t.key === 'projekt' ? { ...t, color: 'blue' } : t)), tagLook);
  assert.equal(recoloured.color, 'blue', 'colours come from the type entries (§8 11)');
});

test('fr_hom_02_ac3_rows_open_their_targets', async () => {
  const text = `${fx('valid.yml')}  - id: 01JB5P00000000000000000006\n    path: Daily/2026-10-07.md\n  - id: 01JB5P00000000000000000007\n    path: Images/Graf.md\n`;
  const v = await Promise.all(dtoOf(text).rows.map(view));
  assert.deepEqual(v.map((x: any) => [x.opens, x.route?.id ?? null, x.route?.param ?? null]), [
    ['route', 'note/<path>', 'Projekty/Rozpočet 2027.md'], ['route', 'note/<path>', 'Projekty/Výjezd Lisabon 2026.md'],
    ['route', 'note/<path>', 'Schůzky/2026-10-07 Týdenní porada.md'], ['route', 'tag/<key>', 'offsite'], ['route', 'type/<type>', 'projekt'],
    ['alert', null, null], // slice Q (D-1484, D-1501): valid.yml's missing `query:` pin shows the alert
    ['route', 'daily/YYYY-MM-DD', '2026-10-07'], ['route', 'note/<path>', 'Images/Graf.md'],
  ], 'each row\'s route (Den on daily/<date>, Graf on its Image page)');
  assert.equal(v[6].icon, 'calendar', 'Den: the Daily Note icon');
});

test('fr_hom_02_ac4_duplicate_titles_resolve_by_id', async () => {
  const text = `${fx('expected/created.yml').split('  - id:')[0]}  - id: 01JB5P00000000000000000010\n    path: Pages/Plán.md\n  - id: 01JB5P00000000000000000011\n    path: Pages/Plán (2).md\n`;
  const v = await Promise.all(dtoOf(text).rows.map(view));
  assert.deepEqual(v.map((x: any) => [x.label, x.tooltip, x.route?.param]), [
    ['Plán', 'Plán\nPages/Plán.md', 'Pages/Plán.md'], ['Plán', 'Plán\nPages/Plán (2).md', 'Pages/Plán (2).md'],
  ], 'same label, own tooltip and route');
});

test('fr_hom_02_ac7_pin_and_unpin_from_the_palette', async () => {
  const m = await model();
  const t = (route: unknown) => run('targetOfRoute', () => m.targetOfRoute(route));
  assert.deepEqual(t({ id: 'note/<path>', param: 'Projekty/Rozpočet 2027.md', path: 'Projekty/Rozpočet 2027.md' }), { kind: 'object', path: 'Projekty/Rozpočet 2027.md' });
  assert.deepEqual(t({ id: 'tag/<key>', param: 'účty' }), { kind: 'tag', key: 'účty' });
  assert.deepEqual(t({ id: 'type/<type>', param: 'schůzka' }), { kind: 'type', key: 'schůzka' });
  assert.equal(t({ id: 'new/<type>', param: 'page' }), 'unsaved', 'new/<type> is unsaved (AP-1239)');
  for (const id of ['inbox', 'tasks', 'search', 'tags', 'trash', 'graph/<path>', 'settings/appearance']) assert.equal(t({ id, param: id === 'graph/<path>' ? 'Pages/Plán.md' : undefined }), null, `${id}: not pinnable`);
});

test('fr_hom_02_ac10_reorder_by_pointer', async () => {
  const m = await model();
  const rects = [0, 30, 60, 90, 120].map((top) => ({ top, bottom: top + 30, height: 30 }));
  const d = (y: number, from?: number) => run('dropIndex', () => (from === undefined ? m.dropIndex(rects, y) : m.dropIndex(rects, y, from)));
  assert.equal(d(5), 0, 'above the middle of row 1: position 1');
  assert.equal(d(40), 1, 'between rows 1 and 2');
  assert.equal(d(118, 1), 3, 'Lisabon dragged below #offsite: final position 4 (index 3)');
  assert.equal(d(40, 1), 1, 'its own place');
  assert.equal(d(500), 5, 'below the list: the end');
});

test('fr_hom_02_ac11_reorder_by_keyboard', async () => {
  const m = await model();
  const mt = (i: number, dir: number, n: number) => run('moveTarget', () => m.moveTarget(i, dir, n));
  assert.deepEqual([mt(1, 1, 5), mt(2, 1, 5), mt(0, -1, 5), mt(4, 1, 5), mt(3, -1, 5)], [2, 3, null, null, 2], 'down, down, nothing at the ends, up');
});

test('fr_hom_02_ac16_external_renames_resolve_by_id_never_by_reused_path', async () => {
  const v = await Promise.all(dtoOf(fx('stale.yml')).rows.map(view));
  assert.deepEqual(v.map((x: any) => [x.label, x.opens, x.description, x.icon]), [
    ['Rozpočet 2027', 'route', 'Projekt', 'folder'], ['Bez hlavičky', 'route', 'Page', 'file-text'], ['Starý plán', 'trash', 'Page, In the trash', 'file-text'],
    ['Smazaný', 'alert', 'Not found', 'file'], ['Plán', 'alert', 'Not found', 'file'], ['#zrušený', 'route', 'Tag, No objects', v[5]?.icon], ['kniha', 'alert', 'Type page, Not found', 'type'],
  ], 'R133 states of stale.yml');
  assert.equal(v[4].tooltip, 'Plán\nPages/Plán.md', 'a missing row shows its stored path');
});

test('fr_hom_02_ac17_trashed_targets_stay_pinned', async () => {
  const text = `${fx('expected/created.yml').split('  - id:')[0]}  - id: 01JB5P00000000000000000008\n    path: Pages/Starý plán.md\n`;
  const [v] = await Promise.all(dtoOf(text).rows.map(view));
  assert.deepEqual([v?.label, v?.opens, v?.route?.id ?? v?.route, v?.description], ['Starý plán', 'trash', 'trash', 'Page, In the trash'], 'opens trash');
});

test('fr_hom_02_ac18_missing_targets_are_never_unpinned_silently', async () => {
  const v = await Promise.all(dtoOf(fx('valid.yml'), false).rows.map(view));
  assert.deepEqual(v.map((x: any) => [x.label, x.opens, x.description]).slice(0, 4), [
    ['Rozpočet 2027', 'none', 'Loading'], ['Výjezd Lisabon 2026', 'none', 'Loading'], ['2026-10-07 Týdenní porada', 'none', 'Loading'], ['#offsite', 'none', 'Tag, Loading'],
  ], 'pending rows: stored stems, `Loading`, a click does nothing (AC-20)');
});

test('fr_hom_02_ac22_unreadable_pins_file_is_never_rewritten', async () => {
  const m = await model();
  assert.equal(run('editReason', () => m.editReason(dtoOf(fx('invalid-yaml.yml')))), 'pinned.fixFile', 'unreadable: pinned.fixFile');
  assert.equal(m.editReason({ ...dtoOf(fx('valid.yml')), patchable: false }), 'pinned.fixFile', 'unpatchable: pinned.fixFile');
  assert.equal(m.editReason(dtoOf(fx('valid.yml'))), null, 'valid: editable');
  assert.equal(m.editReason(dtoOf(null)), null, 'no file: editable');
});

test('fr_hom_02_ac23_newer_and_missing_versions', async () => {
  const m = await model();
  assert.equal(run('editReason', () => m.editReason(dtoOf(fx('newer-version.yml')))), 'pinned.newer', 'newer: pinned.newer');
});

test('fr_fmt_12_ac8_pins_are_nfc', async () => {
  const m = await model();
  const d = dtoOf(fx('nfd.yml'));
  const f = (t: unknown) => run('findPin', () => m.findPin(d, t));
  assert.equal(f({ kind: 'object', path: 'Projekty/Výjezd Lisabon 2026.md' }), 1, 'the NFD path matches as NFC');
  assert.equal(f({ kind: 'object', path: 'Projekty/Výjezd Lisabon 2026.md'.normalize('NFD') }), 1, 'an NFD request too');
  assert.equal(f({ kind: 'tag', key: 'Offsite' }), 3, 'tag keys compare as tag_key');
  assert.equal(f({ kind: 'object', path: 'Tags/Offsite.md' }), 3, 'a Tag object maps to its tag (D-1382)');
  assert.equal(f({ kind: 'type', key: 'projekt' }), 4, 'type key');
  assert.equal(f({ kind: 'object', path: 'Pages/Čajovna.md' }), null, 'not pinned');
});
