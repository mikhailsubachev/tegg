// Slice OC real-app tests (L6, Appium mac2 on the built test app, D-382): docs/acceptance/cards.md "Real-app tests":
// FR-SYN-06 AC-51 (the upgrade and the tour: bytes, mtime and inode), FR-TYP-11 AC-21 (a real Card change: one write
// through a temporary file, new inode), FR-TYP-01 AC-17 (a real icon choice), AC-18 (Recent after a relaunch), AC-20 (c)
// the socket monitor and (d) the licence in the built bundle, FR-STO-07 AC-13 (ui-state.json in Application Support),
// FR-UX-08 AC-26 (the macOS accessibility tree); app-shell.md FR-UX-02 AC-24 (the settings' storage as it was). Always
// TEGG_TEST=1 with the cards clock (TEGG_NOW `2026-11-19T10:00:00+01:00`, TZ Europe/Prague), a temporary Application
// Support and a temporary copy of tests/fixtures/vaults/views + new-empty/.tegg + the cards/ overlay with its README's
// attachments (D-62). Keys go only to Tegg (D-799). Interface docs/contracts/v1-cards.md §5.6, §10, §13.
// Written from the ACs and the contract only (D-61).
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join, relative } from 'node:path';
import {
  APP, FX, NetMonitor, appiumDown, changedPaths, end, marks, need, press, ready, session, shown, sleep, support, testEnv, tmp, tree, waitFor, type Driver, type Env,
} from './helpers/capture.ts';

after(appiumDown);
process.on('exit', appiumDown);

const NOW = '2026-11-19T10:00:00+01:00';
const VYLET = '.tegg/types/výlet.yml'.normalize('NFC');
const BOOK = '.tegg/types/book.yml';

function vaultCopy(base: string): string {
  const v = join(base, 'Výlety a knihy');
  const skip = (root: string, names: string[]) => (s: string) => !names.includes(relative(root, s));
  cpSync(join(FX, 'views'), v, { recursive: true, filter: skip(join(FX, 'views'), ['README.md']) });
  cpSync(join(FX, 'new-empty/.tegg'), join(v, '.tegg'), { recursive: true });
  cpSync(join(FX, 'cards'), v, { recursive: true, filter: skip(join(FX, 'cards'), ['README.md', 'expected-card-data.json']) });
  mkdirSync(join(v, '_attachments'), { recursive: true });
  cpSync(join(FX, 'trash-media/_attachments/záhon.png'), join(v, '_attachments/vyhlidka.png'));
  cpSync(join(FX, 'trash-media/_attachments/Rozpočet.pdf'), join(v, '_attachments/pravidla-tabora.pdf'));
  return v;
}
type Ctx = { base: string; vault: string; sup: string; log: string; d?: Driver; n: number };
function fresh(name: string, ui: Record<string, unknown> = {}): Ctx {
  const base = tmp(`oc-${name}`);
  return { base, vault: vaultCopy(base), sup: support(base, { ui: { preview: { mode: 'click' }, ...ui } }), log: join(base, 'perf.jsonl'), n: 0 };
}
async function launch(c: Ctx, route: string, env: Env = {}): Promise<Driver> {
  c.n += 1;
  c.log = join(c.base, `perf-${c.n}.jsonl`);
  c.d = await session(testEnv(c.sup, c.log, { TEGG_VAULT: c.vault, TEGG_ROUTE: route, TEGG_NOW: NOW, ...env }));
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
const read = (c: Ctx, rel: string) => (existsSync(join(c.vault, rel)) ? readFileSync(join(c.vault, rel), 'utf8') : null);
const fixture = (rel: string) => readFileSync(join(FX, existsSync(join(FX, 'cards', rel)) ? 'cards' : 'views', rel), 'utf8');
const uiState = (c: Ctx) => (existsSync(join(c.sup, 'ui-state.json')) ? JSON.parse(readFileSync(join(c.sup, 'ui-state.json'), 'utf8')) : null);
const files = (a: Record<string, unknown>, b: Record<string, unknown>) => changedPaths(a as any, b as any).filter((p) => !p.endsWith('/'));
async function palette(d: Driver, command: string) {
  press('k', ['command']);
  await sleep(300);
  await (await need(d, 'Command query', 3000)).setValue(command);
  await sleep(300);
  press('return');
  await sleep(500);
}
async function chooseIcon(d: Driver, opener: string, name: string) {
  await (await need(d, opener, 5000)).click();
  await (await need(d, 'Search icons…', 5000)).setValue(name);
  await (await need(d, name, 3000)).click();
  await sleep(600);
}

// ------------------------------------------------------------------------------------------------ FR-SYN-06 AC-51

test('fr_syn_06_ac51_cards_upgrade_and_browsing_write_nothing', { timeout: 600_000 }, async () => {
  await ready();
  const c = fresh('syn06');
  try {
    const before = tree(c.vault);
    let d = await launch(c, 'type/výlet');
    for (const r of ['Go to type: Books', 'Go to type: Výlety', 'Go to Queries']) await palette(d, r);
    for (const key of ['výlet', 'článek', 'kontrola', 'book', 'page', 'task', 'tag']) {
      d = await relaunch(c, `type-settings/${key}`);
      if (key !== 'tag') {
        await (await need(d, 'Add property', 5000)).click();
        press('escape');
        await (await need(d, 'Change icon', 3000)).click();
        await (await need(d, 'Search icons…', 3000)).setValue('map');
        press('escape');
      }
    }
    d = await relaunch(c, 'note/Pages/Karty.md');
    for (const s of ['settings/appearance', 'settings/date-time', 'settings/vault', 'settings/previews']) d = await relaunch(c, s);
    await sleep(800);
    assert.deepEqual(files(before, tree(c.vault)), [], 'the first launch and the tour change no vault file (bytes, mtime, inode) and create nothing');
    // Each action writes exactly the one type file it names, once.
    d = await relaunch(c, 'type-settings/výlet');
    const t0 = tree(c.vault);
    await (await need(d, 'Remove Kraj from the card', 5000)).click();
    assert.ok(await waitFor(() => !!read(c, VYLET)?.includes('náročnost, vybavení'), 3000), 'the Card change is written');
    assert.deepEqual(files(t0, tree(c.vault)), [VYLET], 'a Card change writes výlet.yml only');
  } finally { await cleanup(c); }
});

// ------------------------------------------------------------------------------------------------ FR-TYP-11 AC-21

test('fr_typ_11_ac21_changing_the_card_writes_only_card', { timeout: 300_000 }, async () => {
  await ready();
  const c = fresh('typ11ac21');
  try {
    const d = await launch(c, 'type-settings/book');
    const before = tree(c.vault);
    await (await need(d, 'Remove Tags from the card', 8000)).click();
    assert.ok(await waitFor(() => read(c, BOOK) !== fixture(BOOK), 3000), 'book.yml is written');
    assert.equal(read(c, BOOK), fixture(BOOK).replace('preview: [author, status]\n', 'preview: [author, status]\ncard: [body, author, status, modified]\n'), 'one line inserted after preview');
    const changed = files(before, tree(c.vault));
    assert.deepEqual(changed, [BOOK], 'only book.yml');
    const a = before[BOOK] as any, b = tree(c.vault)[BOOK] as any;
    assert.notEqual(a?.ino, b?.ino, 'written through a temporary file (a new inode)');
    assert.deepEqual(readdirTmp(c), [], 'no temporary file left');
  } finally { await cleanup(c); }
});
function readdirTmp(c: Ctx): string[] {
  return Object.keys(tree(c.vault)).filter((p) => p.includes('tegg-tmp'));
}

// ------------------------------------------------------------------------------------------------ FR-TYP-01 AC-17

test('fr_typ_01_ac17_choosing_writes_one_line', { timeout: 300_000 }, async () => {
  await ready();
  const c = fresh('typ01ac17');
  try {
    const d = await launch(c, 'type-settings/výlet');
    const before = tree(c.vault);
    await chooseIcon(d, 'Icon for Náročnost', 'mountain');
    const naro = '    name: Náročnost\n    type: select\n';
    assert.ok(await waitFor(() => !!read(c, VYLET)?.includes('icon: mountain'), 3000), 'the icon line is written');
    assert.equal(read(c, VYLET), fixture(VYLET).replace(naro, `${naro}    icon: mountain\n`), 'one line after the item\'s type line');
    await chooseIcon(d, 'Change icon', 'tent');
    assert.ok(await waitFor(() => !!read(c, VYLET)?.includes('\nicon: tent\n'), 3000), 'General: icon: tent');
    assert.deepEqual(files(before, tree(c.vault)), [VYLET], 'only výlet.yml');
  } finally { await cleanup(c); }
});

// ------------------------------------------------------------------------------------------------ FR-TYP-01 AC-18, FR-STO-07 AC-13

test('fr_typ_01_ac18_recent_icons', { timeout: 300_000 }, async () => {
  await ready();
  const c = fresh('typ01ac18');
  try {
    let d = await launch(c, 'type-settings/výlet');
    const before = tree(c.vault);
    for (const n of ['mountain', 'tent', 'mountain']) await chooseIcon(d, 'Icon for Náročnost', n);
    assert.deepEqual(uiState(c)?.recentIcons, ['mountain', 'tent'], 'ui-state.json recentIcons');
    d = await relaunch(c, 'type-settings/výlet');
    await (await need(d, 'Icon for Kraj', 8000)).click();
    assert.ok(await shown(d, 'Recent', 3000), 'after a relaunch the Recent group is shown');
    assert.deepEqual(files(before, tree(c.vault)).filter((p) => p !== VYLET), [], 'nothing under the vault but výlet.yml changes');
  } finally { await cleanup(c); }
});

test('fr_sto_07_ac13_recent_icons_are_machine_local', { timeout: 300_000 }, async () => {
  await ready();
  const c = fresh('sto07ac13', { typeViews: { lastTab: { book: 'Rozečtené' } } });
  try {
    const d = await launch(c, 'type-settings/výlet');
    const before = tree(c.vault);
    await chooseIcon(d, 'Icon for Náročnost', 'mountain');
    const st = uiState(c);
    assert.deepEqual([st?.recentIcons, st?.typeViews], [['mountain'], { lastTab: { book: 'Rozečtené' } }], 'recentIcons added, the 0.5.x keys kept');
    assert.ok(!existsSync(join(c.sup, 'ui-state.json.tmp')), 'written atomically');
    assert.deepEqual(files(before, tree(c.vault)).filter((p) => p !== VYLET), [], 'nothing under the vault, .tegg/ included');
  } finally { await cleanup(c); }
});

// ------------------------------------------------------------------------------------------------ FR-TYP-01 AC-20 (c), (d)

test('fr_typ_01_ac20_bundled_offline_credited', { timeout: 300_000 }, async () => {
  await ready();
  const credits = join(APP, 'Contents/Resources/Credits.rtf');
  assert.ok(existsSync(credits), 'the built bundle holds Contents/Resources/Credits.rtf');
  const rtf = readFileSync(credits, 'utf8');
  assert.ok(rtf.includes('Lucide 0.460.0') && rtf.includes('ISC License') && /Copyright \(c\)/.test(rtf) && rtf.includes('d3-force'), 'Lucide\'s ISC licence text and copyright, d3-force\'s');
  const c = fresh('typ01ac20');
  const net = new NetMonitor().start();
  try {
    const d = await launch(c, 'type-settings/výlet');
    await chooseIcon(d, 'Icon for Náročnost', 'mountain');
    await (await need(d, 'Icon for Kraj', 3000)).click();
    await (await need(d, 'Search icons…', 3000)).setValue('arrow');
    press('escape');
    await sleep(500);
  } finally {
    const r = net.stop();
    await cleanup(c);
    assert.deepEqual(r.sockets, [], 'NFR-SEC-01: no non-IPC socket while the picker loads and searches');
  }
});

// ------------------------------------------------------------------------------------------------ FR-UX-08 AC-26

test('fr_ux_08_ac26_cards_and_picker_for_voiceover', { timeout: 300_000 }, async () => {
  await ready();
  const c = fresh('ux08ac26');
  try {
    let d = await launch(c, 'query/Výlety podle stavu');
    assert.ok(await shown(d, 'Výlet: Sněžka z Pece', 8000), 'the card in the accessibility tree by name');
    assert.ok(await shown(d, 'Stav: Hotový', 3000) || await shown(d, 'Vybavení: Mapa', 3000), 'its pills by their accessible names');
    d = await relaunch(c, 'type-settings/výlet');
    assert.ok(await shown(d, 'Card properties', 8000), 'the list Card properties');
    assert.ok(await shown(d, 'Drag to reorder Kraj', 3000), 'a handle by name');
    await (await need(d, 'Icon for Náročnost', 3000)).click();
    assert.ok(await shown(d, 'Search icons…', 3000), 'the picker\'s combobox');
  } finally { await cleanup(c); }
});

// ------------------------------------------------------------------------------------------------ app-shell FR-UX-02 AC-24

test('fr_ux_02_ac24_nothing_added_removed_or_changed', { timeout: 300_000 }, async () => {
  await ready();
  const c = fresh('ux02ac24');
  try {
    const before = tree(c.vault);
    let d = await launch(c, 'settings/appearance');
    assert.ok(await shown(d, 'Settings sections', 8000), 'the shared layout\'s section list');
    for (const s of ['settings/date-time', 'settings/vault', 'settings/menu-bar', 'settings/backups', 'settings/previews']) d = await relaunch(c, s);
    assert.deepEqual(files(before, tree(c.vault)), [], 'opening every settings route writes nothing');
    // A change still writes what it wrote: the theme to ui-state.json, nothing to the vault.
    d = await relaunch(c, 'settings/appearance');
    await (await need(d, 'Dark', 5000)).click();
    assert.ok(await waitFor(() => uiState(c)?.theme === 'dark', 3000), 'the theme still goes to ui-state.json');
    assert.deepEqual(files(before, tree(c.vault)), [], 'and nothing to the vault');
  } finally { await cleanup(c); }
});
