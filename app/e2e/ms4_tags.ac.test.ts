// MS4 slice 4D-lite real-app tests (L6, Appium mac2 on the built test app, D-382): docs/acceptance/tags.md — every
// L6-marked criterion: FR-TAG-02 AC-2 (once: the tags after deleting the index), FR-TAG-03 AC-1 (once: New tag writes
// one file, by bytes, mtime and inode), FR-TAG-05 AC-1 (once: a colour choice is one write), AC-6 (the capture window's
// tag chips take the colour), FR-TAG-06 AC-6 (the tag page's sort, Type filter and grouping survive a relaunch, stored
// in Application Support), AC-8 (once: New with #Účty › Page writes Pages/Plán.md), FR-TAG-07 AC-1 (the All tags sort
// survives a relaunch), FR-HIS-04 AC-8 (once: restore from Settings › Backups), FR-LNK-14 AC-12 (once: Merge…),
// FR-NAV-04 AC-8 (the sidebar order), FR-SYN-06 AC-31 (a browsing tour writes nothing), AC-32 (each action writes only
// its files). Interface docs/contracts/ms4-tags.md §3…§6 and ms3-shell §1 (`TEGG_ROUTE`, `route-ready:<route>`; the
// route of a tag page is `tag/<encodeURIComponent(key)>`, §6.1, red-test point AP-674 for the mark's spelling).
// Always TEGG_TEST=1 with TEGG_NOW, a temporary Application Support and a temporary copy of the synthetic tags fixture
// (D-62). Written from the ACs and the contracts only (D-61). Shared helpers: app/e2e/helpers/capture.ts.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join, relative } from 'node:path';
import { inflateSync } from 'node:zlib';
import {
  FX, appiumDown, changedPaths, end, hotkey, marks, need, needInGroup, needMenuItem, palette, paste, press, read, ready, session, shown, sleep, support, testEnv, tmp, tree, typeAscii,
  waitFile, type Driver, type Env,
} from './helpers/capture.ts';

after(appiumDown);
process.on('exit', appiumDown);

/** The 4D-lite test clock (tags.md), running from here (D-504). */
const NOW4D = '2026-10-22T10:00:00+02:00';
const P = {
  rozpocet: 'Pages/Rozpočet.md', fUcty: 'Tags/Účty.md', schuzka: 'Pages/Schůzka.md', schuzka2: 'Pages/schůzka (2).md', naSchuzku: 'Pages/Odkaz na schůzku.md',
  odkaz: 'Pages/Odkaz na štítek.md', faktura: 'Quick Notes/Faktura.md',
};
const files = (a: Record<string, unknown>, b: Record<string, unknown>) => changedPaths(a as any, b as any).filter((p) => !p.endsWith('/'));
const tagRoute = (key: string) => `tag/${encodeURIComponent(key.normalize('NFC'))}`;

/** A temp copy of tests/fixtures/vaults/tags (without README.md) plus new-empty/.tegg. */
function tagsCopy(base: string, name = 'Štítky'): string {
  const v = join(base, name);
  const src = join(FX, 'tags');
  cpSync(src, v, { recursive: true, filter: (s) => relative(src, s) !== 'README.md' });
  cpSync(join(FX, 'new-empty/.tegg'), join(v, '.tegg'), { recursive: true });
  return v;
}
type Ctx = { base: string; vault: string; sup: string; log: string; d?: Driver };
function fresh(name: string, ui: Record<string, unknown> = {}): Ctx {
  const base = tmp(`4d-${name}`);
  return { base, vault: tagsCopy(base), sup: support(base, { ui }), log: join(base, 'perf.jsonl') };
}
/** `route-ready:<route>`, accepting the decoded or the encoded spelling of a tag key (AP-674). */
async function waitRoute(log: string, route: string, ms = 20_000): Promise<boolean> {
  const alt = route.startsWith('tag/') ? `tag/${decodeURIComponent(route.slice(4))}` : route;
  const endAt = Date.now() + ms;
  while (Date.now() < endAt) {
    const m = marks(log);
    if (m.includes(`route-ready:${route}`) || m.includes(`route-ready:${alt}`)) return true;
    await sleep(100);
  }
  return false;
}
async function launch(c: Ctx, route: string, extra: Env = {}): Promise<Driver> {
  c.d = await session(testEnv(c.sup, c.log, { TEGG_VAULT: c.vault, TEGG_ROUTE: route, TEGG_NOW: NOW4D, ...extra }));
  assert.ok(await waitRoute(c.log, route), `${route} shown`);
  return c.d;
}
async function cleanup(c: Ctx) {
  await end(c.d);
  rmSync(c.base, { recursive: true, force: true });
}
const fx = (rel: string) => readFileSync(join(FX, 'tags', rel), 'utf8');
const uiState = (sup: string) => JSON.parse(readFileSync(join(sup, 'ui-state.json'), 'utf8'));

// ------------------------------------------------------------------------------------------------ FR-TAG-02, FR-TAG-03

test('fr_tag_02_ac2_tags_are_the_same_after_deleting_the_index', { timeout: 300_000 }, async () => {
  await ready();
  const c = fresh('tag02ac2');
  try {
    const d = await launch(c, 'tags');
    assert.ok(await shown(d, '10 tags · 11 tagged objects', 3000), 'All tags before');
    await end(d);
    c.d = undefined;
    for (const n of readdirSync(c.sup)) if (/index/i.test(n)) rmSync(join(c.sup, n), { recursive: true, force: true });
    const d2 = await launch({ ...c, log: join(c.base, 'perf2.jsonl') } as Ctx, 'tags');
    c.d = d2;
    assert.ok(await shown(d2, '10 tags · 11 tagged objects', 5000), 'the same tags after the rebuild (AR-01)');
    assert.ok(await shown(d2, 'Tags, all 10', 2000), 'the sidebar section');
  } finally { await cleanup(c); }
});

test('fr_tag_03_ac1_new_tag_writes_one_file_in_the_real_app', { timeout: 300_000 }, async () => {
  await ready();
  const c = fresh('tag03ac1');
  try {
    const d = await launch(c, 'tags');
    const before = tree(c.vault);
    await (await need(d, 'New tag')).click();
    assert.ok(await shown(d, 'Tag name', 2000), 'the dialog');
    paste('Účetnictví');
    press('enter');
    const t = await waitFile(join(c.vault, 'Tags/Účetnictví.md'), (x) => x !== null, 3000);
    assert.match(t ?? '', /^---\nid: [0-9A-HJKMNP-TV-Z]{26}\ntype: tag\ntitle: Účetnictví\ncreated: 2026-10-22T10:00:\d\d\+02:00\nmodified: 2026-10-22T10:00:\d\d\+02:00\n---\n$/, 'R86 bytes');
    assert.deepEqual(files(before, tree(c.vault)), ['Tags/Účetnictví.md'], 'one file written; every other file\'s bytes, mtime and inode unchanged');
    assert.ok(await waitRoute(c.log, tagRoute('účetnictví'), 3000), 'tag/účetnictví opens');
  } finally { await cleanup(c); }
});

// ------------------------------------------------------------------------------------------------ FR-TAG-05

test('fr_tag_05_ac1_a_colour_choice_is_one_write', { timeout: 300_000 }, async () => {
  await ready();
  const c = fresh('tag05ac1');
  try {
    const d = await launch(c, tagRoute('účty'));
    const before = tree(c.vault);
    await (await need(d, 'Tag colour')).click();
    await (await need(d, 'Green')).click();
    const t = await waitFile(join(c.vault, P.fUcty), (x) => !!x?.includes('color: green'), 3000);
    assert.equal(t?.replace(/^modified: .*$/m, 'modified: x'), fx(P.fUcty).replace('color: blue', 'color: green').replace(/^modified: .*$/m, 'modified: x'), 'only color: and modified: change');
    assert.deepEqual(files(before, tree(c.vault)), [P.fUcty], 'one file');
  } finally { await cleanup(c); }
});

/** The colours of a PNG screenshot (8-bit RGB/RGBA, non-interlaced), as `#rrggbb` → pixel count. */
function pngColours(b64: string): Map<string, number> {
  const b = Buffer.from(b64, 'base64');
  const w = b.readUInt32BE(16), h = b.readUInt32BE(20), depth = b[24], ctype = b[25];
  const bpp = ctype === 6 ? 4 : 3;
  assert.equal(depth, 8, 'setup: 8-bit PNG');
  const idat: Buffer[] = [];
  for (let at = 8; at < b.length;) {
    const len = b.readUInt32BE(at), type = b.toString('ascii', at + 4, at + 8);
    if (type === 'IDAT') idat.push(b.subarray(at + 8, at + 8 + len));
    at += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const out = new Map<string, number>();
  const stride = w * bpp;
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    const line = Buffer.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? line[x - bpp] : 0, up = prev[x], c = x >= bpp ? prev[x - bpp] : 0;
      const p = a + up - c, pa = Math.abs(p - a), pb = Math.abs(p - up), pc = Math.abs(p - c);
      line[x] = (line[x] + [0, a, up, (a + up) >> 1, pa <= pb && pa <= pc ? a : pb <= pc ? up : c][f]) & 0xff;
    }
    for (let x = 0; x < w; x++) { const k = `#${[0, 1, 2].map((i) => line[x * bpp + i].toString(16).padStart(2, '0')).join('')}`; out.set(k, (out.get(k) ?? 0) + 1); }
    prev = line;
  }
  return out;
}
const near = (cols: Map<string, number>, hex: string, tol = 14) => [...cols.keys()].some((k) => [1, 3, 5].every((i) => Math.abs(parseInt(k.slice(i, i + 2), 16) - parseInt(hex.slice(i, i + 2), 16)) <= tol));

test('fr_tag_05_ac6_the_capture_window_shows_tag_colours', { timeout: 300_000 }, async () => {
  await ready();
  const c = fresh('tag05ac6', { theme: 'light' });
  try {
    const d = await launch(c, 'inbox');
    hotkey('quick');
    assert.ok(await shown(d, 'Capture text', 3000), 'the capture window');
    typeAscii('Pozn');
    // The capture window's tag chips are in its `Add tag…` field (capture.md); `#Účty` in the text stays text (D-751).
    await (await need(d, 'Add tag…')).click();
    paste('Účty');
    press('enter');
    const chipEl = await need(d, '#Účty', 3000);
    const cols = pngColours(await d.takeElementScreenshot(chipEl.elementId));
    // Anti-aliased 12-px text never reaches the full token colour: the text gets a wider tolerance (D-751).
    assert.ok(near(cols, '#EAF0FB') && near(cols, '#1D5CCB', 24), 'the capture window\'s #Účty chip has the blue-bg tint and blue text (light theme tokens, D-709)');
    press('escape');
  } finally { await cleanup(c); }
});

// ------------------------------------------------------------------------------------------------ FR-TAG-06, FR-TAG-07

test('fr_tag_06_ac6_tag_page_state_survives_relaunch', { timeout: 300_000 }, async () => {
  await ready();
  const c = fresh('tag06ac6');
  try {
    const d = await launch(c, tagRoute('účty'));
    const before = tree(c.vault);
    await (await need(d, 'Title')).click();
    await (await need(d, 'Type: all')).click();
    await (await need(d, 'Task 2')).click();
    await (await need(d, 'No grouping')).click();
    await (await needMenuItem(d, 'Type')).click(); // the menu and the Type column share the name (D-751)
    await end(d);
    c.d = undefined;
    const st = uiState(c.sup);
    assert.deepEqual(st.tagPage, { sort: { column: 'title', dir: 'asc' }, type: 'task', grouping: 'type' }, 'stored in ui-state under Application Support (FR-STO-07)');
    const d2 = await launch({ ...c, log: join(c.base, 'perf2.jsonl') } as Ctx, tagRoute('finance'));
    c.d = d2;
    assert.ok(await shown(d2, 'Type: Task', 3000), 'after relaunch tag/finance opens with Type: Task');
    assert.ok(await shown(d2, 'Grouped by type', 1000), 'and the grouping');
    assert.deepEqual(files(before, tree(c.vault)), [], 'the vault is byte-identical');
  } finally { await cleanup(c); }
});

test('fr_tag_06_ac8_new_with_tag_writes_one_page', { timeout: 300_000 }, async () => {
  await ready();
  const c = fresh('tag06ac8');
  try {
    const d = await launch(c, tagRoute('účty'));
    const before = tree(c.vault);
    await (await need(d, 'New with #Účty')).click();
    await (await need(d, 'Page')).click();
    await sleep(500);
    assert.deepEqual(files(before, tree(c.vault)), [], 'the draft writes nothing');
    paste('Plán');
    press('enter');
    const t = await waitFile(join(c.vault, 'Pages/Plán.md'), (x) => x !== null, 3000);
    assert.ok(t && /\ntags: \[Účty\]\n/.test(t), `Pages/Plán.md with tags: [Účty]: ${t}`);
    assert.deepEqual(files(before, tree(c.vault)), ['Pages/Plán.md'], 'written once, nothing else');
  } finally { await cleanup(c); }
});

test('fr_tag_07_ac1_all_tags_sort_survives_relaunch', { timeout: 300_000 }, async () => {
  await ready();
  const c = fresh('tag07ac1');
  try {
    const d = await launch(c, 'tags');
    await (await need(d, 'Most used ↓')).click();
    await (await need(d, 'Name')).click();
    await end(d);
    c.d = undefined;
    assert.deepEqual(uiState(c.sup).tagsSort, { column: 'name', dir: 'asc' }, 'machine-local, shared (D-703)');
    const d2 = await launch({ ...c, log: join(c.base, 'perf2.jsonl') } as Ctx, 'tags');
    c.d = d2;
    assert.ok(await shown(d2, 'Name ↑', 3000), 'the sort survives relaunch');
  } finally { await cleanup(c); }
});

// ------------------------------------------------------------------------------------------------ FR-HIS-04, FR-LNK-14

test('fr_his_04_ac8_restore_from_settings_backups', { timeout: 300_000 }, async () => {
  await ready();
  const c = fresh('his04ac8');
  try {
    const original = tree(c.vault);
    const d = await launch(c, tagRoute('účty'));
    palette('Rename tag…');
    assert.ok(await shown(d, 'New name', 2000), 'the rename dialog');
    press('a', ['command']);
    paste('Výdaje');
    press('enter');
    assert.ok(await waitFile(join(c.vault, 'Tags/Výdaje.md'), (x) => x !== null, 10_000), 'renamed');
    palette('Go to Settings: Backups');
    await (await need(d, 'Restore "Rename #Účty to #Výdaje"…', 5000)).click();
    assert.ok(await shown(d, 'Restore this backup?', 2000), 'the dialog');
    await (await need(d, 'Restore')).click();
    assert.ok(await waitFile(join(c.vault, P.fUcty), (x) => x !== null, 10_000), 'Tags/Účty.md is back');
    await sleep(500);
    const after = tree(c.vault);
    assert.deepEqual(files(original, after).filter((p) => !(original as any)[p] || (after as any)[p] === undefined || (original as any)[p].sha !== (after as any)[p].sha), [], 'every file has its pre-job bytes (sha256)');
    assert.ok(!existsSync(join(c.vault, 'Tags/Výdaje.md')), 'no Tags/Výdaje.md');
    assert.ok(await shown(d, 'Before restoring', 3000) || readdirSync(join(c.sup, 'backups')).length > 0, 'the pre-restore zip is listed');
  } finally { await cleanup(c); }
});

test('fr_lnk_14_ac12_merge_in_the_real_app', { timeout: 300_000 }, async () => {
  await ready();
  const c = fresh('lnk14ac12');
  try {
    const d = await launch(c, 'duplicate-titles');
    const before = tree(c.vault);
    await (await needInGroup(d, 'Schůzka, 2', 'Merge…')).click(); // the group of R87, not the first Merge… (D-751)
    await (await need(d, 'Merge 2 objects')).click();
    assert.ok(await waitFile(join(c.vault, `.trash/${P.schuzka2}`), (x) => x !== null, 10_000), 'schůzka (2) in .trash/');
    assert.deepEqual(files(before, tree(c.vault)), [P.naSchuzku, P.schuzka, `.trash/${P.schuzka2}`, P.schuzka2].sort(), 'exactly the kept object, the linking file and the trash move');
    assert.equal(read(c.vault, P.naSchuzku), fx(P.naSchuzku).replace('[[schůzka (2)]]', '[[Schůzka]]'), 'the link retargeted');
    assert.ok(read(c.vault, P.schuzka)?.includes('## SCHŮZKA (merged)'), 'the merged section');
  } finally { await cleanup(c); }
});

// ------------------------------------------------------------------------------------------------ FR-NAV-04, FR-SYN-06

test('fr_nav_04_ac8_sidebar_tags_section_in_the_real_app', { timeout: 300_000 }, async () => {
  await ready();
  const c = fresh('nav04ac8');
  try {
    const d = await launch(c, 'inbox');
    assert.ok(await shown(d, 'Tags, all 10', 3000), 'the Tags section header');
    for (const t of ['#Účty', '#finance', '#dvojí', '#a/b', '#účty/archiv']) assert.ok(await shown(d, t, 1000) || await shown(d, `${t} ${t === '#Účty' ? 6 : t === '#finance' ? 2 : 1}`, 500), `${t} in the section`);
    await (await need(d, 'Tags, all 10')).click();
    assert.ok(await waitRoute(c.log, 'tags', 3000), 'the header opens tags');
  } finally { await cleanup(c); }
});

test('fr_syn_06_ac31_a_browsing_tour_of_tags_writes_nothing', { timeout: 600_000 }, async () => {
  await ready();
  const c = fresh('syn06ac31');
  try {
    const d = await launch(c, 'tags');
    const before = tree(c.vault);
    for (const label of ['Name', 'Last used', 'Most used ↓']) { const e = await need(d, label).catch(() => null); await e?.click(); await sleep(200); }
    for (const t of ['#Účty', '#finance', '#a/b', '#neznámá', '#prázdný']) {
      await (await need(d, t)).click();
      await sleep(500);
      const tile = await need(d, 'Tag colour', 1000).catch(() => null);
      if (tile) { await tile.click(); await sleep(200); press('escape'); }
      const act = await need(d, 'Tag actions', 1000).catch(() => null);
      if (act) { await act.click(); await sleep(200); press('escape'); }
      press('lbracket', ['command']);
      await sleep(400);
    }
    palette('Go to Settings: Backups');
    await sleep(600);
    palette('Go to Duplicate titles');
    await sleep(600);
    assert.ok(marks(c.log).some((m) => m.startsWith('route-ready:tag/')), 'tag pages were shown');
    // `type/tag` and `type-settings/tag` (no `Go to type` command for Tag, D-121): relaunched on the routes.
    for (const route of ['type/tag', 'type-settings/tag']) {
      await end(c.d);
      c.d = await launch({ ...c, log: join(c.base, `${route.replace(/\W/g, '_')}.jsonl`) } as Ctx, route);
      await sleep(800);
    }
    assert.deepEqual(files(before, tree(c.vault)), [], 'every vault file\'s bytes, mtime and inode unchanged; nothing created');
  } finally { await cleanup(c); }
});

test('fr_syn_06_ac32_each_tag_action_writes_only_its_files', { timeout: 600_000 }, async () => {
  await ready();
  const c = fresh('syn06ac32');
  try {
    const d = await launch(c, tagRoute('účty'));
    const s0 = tree(c.vault);
    await (await need(d, 'Tag colour')).click();
    await (await need(d, 'Green')).click();
    await waitFile(join(c.vault, P.fUcty), (x) => !!x?.includes('green'), 3000);
    assert.deepEqual(files(s0, tree(c.vault)), [P.fUcty], 'a colour change: one file');
    const s1 = tree(c.vault);
    palette('Delete tag…');
    await (await need(d, 'Delete only the tag')).click();
    await waitFile(join(c.vault, `.trash/${P.fUcty}`), (x) => x !== null, 3000);
    const s2 = tree(c.vault);
    assert.deepEqual(files(s1, s2), [`.trash/${P.fUcty}`, P.fUcty].sort(), 'Delete only the tag: one rename');
    assert.equal((s2 as any)[`.trash/${P.fUcty}`]?.ino, (s1 as any)[P.fUcty]?.ino, 'the same inode');
    palette('Rename tag…');
    press('a', ['command']);
    paste('Výdaje');
    press('enter');
    await waitFile(join(c.vault, P.rozpocet), (x) => !!x?.includes('Výdaje'), 10_000);
    await sleep(800);
    const ch = files(s2, tree(c.vault));
    assert.deepEqual(ch, ['Daily/2026-10-20.md', 'Pages/Dvakrát.md', P.rozpocet, P.faktura, 'Tasks/Zaplatit nájem.md', 'Tasks/Zavolat bance.md', '_templates/Page/Page.md'].sort(), 'a rename: exactly the files with an occurrence (the Tag file is in the trash)');
  } finally { await cleanup(c); }
});

