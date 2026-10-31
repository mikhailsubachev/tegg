// Slice G3 real-app tests (L6, Appium mac2 on the built test app, D-382): docs/acceptance/graph.md part two — every
// L6-marked criterion: FR-GRP-02 AC-12 (once: applying presets keeps graph.yml's bytes, mtime and inode), AC-19 (once:
// an unreadable file is never rewritten; another program fixes it), AC-22 (the preset survives a relaunch), AC-23
// (once with the helper process: outside changes reload the list only), FR-SYN-03 AC-23 (a synced atomic replace;
// sync conflict copies are never touched), FR-SYN-06 AC-40 (only Save as, Update, Rename and Delete write, once each,
// only `.tegg/graph.yml`) and FR-UX-08 AC-5 (the List view survives a relaunch). Interface docs/contracts/v1-graph.md
// §16.2, §16.4, §16.6 and ms3-shell §13.6 (the external helper). Always TEGG_TEST=1 with the G1 test clock, a temporary
// Application Support and a temporary copy of the synthetic graph fixture plus tests/fixtures/graph-presets (D-62).
// Written from the ACs and the contracts only (D-61). Shared helpers: app/e2e/helpers/capture.ts.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import {
  FX, REPO, appiumDown, changedPaths, end, marks, need, needMenuItem, palette, paste, press, ready, session, shown, sleep, support, testEnv, textContains,
  tmp, tree, typeAscii, waitFor, type Driver, type Env,
} from './helpers/capture.ts';

after(appiumDown);
process.on('exit', appiumDown);

const NOW_G1 = '2026-10-28T10:00:00+01:00';
const PLAN = 'Pages/Plán čtvrtletí.md';
const YML = '.tegg/graph.yml';
const COPY_A = '.tegg/graph (conflicted copy 2026-10-28).yml';
const COPY_B = '.tegg/graph 2.yml';
const PRESETS = join(REPO, 'tests/fixtures/graph-presets');
const EXTERNAL = resolve(import.meta.dirname, 'helpers/external.ts');
const graphRoute = (p: string) => `graph/${p.normalize('NFC')}`;
const fx = (name: string) => readFileSync(join(PRESETS, name), 'utf8');

/** A temp copy of tests/fixtures/vaults/graph (without README.md and make-hub.*) plus new-empty/.tegg, the README's
 *  runtime attachments and, when given, a presets fixture as `.tegg/graph.yml`. */
function vaultCopy(base: string, presets: string | null, name = 'Graf'): string {
  const v = join(base, name);
  const src = join(FX, 'graph');
  cpSync(src, v, { recursive: true, filter: (s) => { const r = relative(src, s); return r !== 'README.md' && !r.startsWith('make-hub.'); } });
  cpSync(join(FX, 'new-empty/.tegg'), join(v, '.tegg'), { recursive: true });
  mkdirSync(join(v, '_attachments'), { recursive: true });
  cpSync(join(FX, 'trash-media/_attachments/záhon.png'), join(v, '_attachments/graf.png'));
  cpSync(join(FX, 'trash-media/_attachments/Rozpočet.pdf'), join(v, '_attachments/Smlouva.pdf'));
  if (presets !== null) writeFileSync(join(v, YML), fx(presets));
  return v;
}
type Ctx = { base: string; vault: string; sup: string; log: string; d?: Driver; n: number };
function fresh(name: string, presets: string | null): Ctx {
  const base = tmp(`g3-${name}`);
  return { base, vault: vaultCopy(base, presets), sup: support(base), log: join(base, 'perf.jsonl'), n: 0 };
}
async function launch(c: Ctx, route = graphRoute(PLAN), extra: Env = {}): Promise<Driver> {
  c.n += 1;
  c.log = join(c.base, `perf-${c.n}.jsonl`);
  c.d = await session(testEnv(c.sup, c.log, { TEGG_VAULT: c.vault, TEGG_ROUTE: route, TEGG_NOW: NOW_G1, ...extra }));
  const want = `route-ready:${route.normalize('NFC')}`;
  assert.ok(await waitFor(() => marks(c.log).map((m) => m.normalize('NFC')).includes(want), 20_000), `${route} shown (route-ready)`);
  return c.d;
}
async function relaunch(c: Ctx, route = graphRoute(PLAN)): Promise<Driver> {
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
/** Another program writes `rel` in place (helper `write`). */
function externalWrite(c: Ctx, rel: string, text: string) {
  const f = join(c.base, `ext-${Date.now()}.txt`);
  writeFileSync(f, text);
  external('write', join(c.vault, rel), f);
  rmSync(f, { force: true });
}
/** A sync client replaces `rel` atomically: a new file on the same volume renamed over it (helper `rename`). */
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
const uiState = (sup: string) => (existsSync(join(sup, 'ui-state.json')) ? JSON.parse(readFileSync(join(sup, 'ui-state.json'), 'utf8')) : null);
const full = (c: Ctx) => uiState(c.sup)?.vaults?.[c.vault.normalize('NFC')]?.graph?.full ?? null;
const stamp = (c: Ctx, rel: string) => tree(c.vault)[rel.normalize('NFC')] ?? null;
/** Opens the preset menu (the button is named `Preset: <name>`). */
async function presetMenu(d: Driver, current: string) {
  await (await need(d, `Preset: ${current}`, 5000)).click();
  await sleep(300);
}
async function apply(d: Driver, current: string, name: string) {
  await presetMenu(d, current);
  await (await needMenuItem(d, name)).click();
  await sleep(400);
}
/** Saves the current filters as `name` (ASCII or pasted) through the Save dialog. */
async function saveAs(d: Driver, current: string, name: string) {
  await presetMenu(d, current);
  await (await needMenuItem(d, 'Save as new preset…')).click();
  await (await need(d, 'Name')).click();
  if (/^[\x20-\x7e]+$/.test(name)) typeAscii(name); else paste(name);
  press('enter');
  await sleep(600);
}
const listedNames = (text: string) => [...text.matchAll(/^\s*- name: "?(.*?)"?\s*$/gm)].map((m) => m[1].normalize('NFC'));

// ------------------------------------------------------------------------------------------------ FR-GRP-02 AC-12

test('fr_grp_02_ac12_applying_a_preset_sets_this_views_filters', { timeout: 300_000 }, async () => {
  await ready();
  const c = fresh('ac12', 'valid.yml');
  try {
    const before = tree(c.vault);
    const d = await launch(c);
    assert.ok(await textShown(d, '10 objects', 5000), 'Plán\'s graph');
    await apply(d, 'Default', 'Bez štítků');
    assert.ok(await textShown(d, '2 hidden', 3000), 'Bez štítků: `2 hidden`');
    assert.ok(await shown(d, 'Preset: Bez štítků', 2000), '`Preset: Bez štítků`');
    await apply(d, 'Bez štítků', 'Jen vztahy');
    assert.ok(await textShown(d, '7 hidden', 3000), 'Jen vztahy: `7 hidden`');
    await apply(d, 'Jen vztahy', 'Lidé a schůzky');
    assert.ok(await textShown(d, '8 hidden', 3000), 'Lidé a schůzky: `8 hidden`');
    await apply(d, 'Lidé a schůzky', 'Default');
    assert.ok(await textShown(d, '10 objects', 3000), 'Default: 10 objects');
    assert.ok(await waitFor(() => full(c)?.preset === undefined && JSON.stringify(full(c)?.hiddenTypes ?? []) === '[]', 3000), 'graph.full back to Default');
    assert.deepEqual(changedPaths(before, tree(c.vault)), [], '.tegg/graph.yml (and every vault file) keeps its bytes, mtime and inode throughout');
  } finally { await cleanup(c); }
});

// ------------------------------------------------------------------------------------------------ FR-GRP-02 AC-19

test('fr_grp_02_ac19_unreadable_file_is_never_rewritten', { timeout: 300_000 }, async () => {
  await ready();
  const c = fresh('ac19', 'invalid-yaml.yml');
  try {
    const s0 = stamp(c, YML);
    const d = await launch(c);
    await presetMenu(d, 'Default');
    assert.ok(await textShown(d, 'The presets file can\'t be read (line 5).', 2000), 'the unreadable line with the parser\'s line');
    press('escape');
    await (await need(d, 'Tags', 3000)).click().catch(() => {});
    await sleep(500);
    await relaunch(c);
    assert.deepEqual(stamp(c, YML), s0, 'the file keeps its bytes, mtime and inode (also across a relaunch)');
    externalWrite(c, YML, fx('valid.yml'));
    await sleep(2000);
    await presetMenu(c.d!, 'Default');
    assert.ok(await textShown(c.d!, 'Jen vztahy', 1000), 'fixed by another program: the presets appear within 2 s');
  } finally { await cleanup(c); }
});

// ------------------------------------------------------------------------------------------------ FR-GRP-02 AC-22

test('fr_grp_02_ac22_preset_remembered_per_view_and_vault', { timeout: 300_000 }, async () => {
  await ready();
  const c = fresh('ac22', 'valid.yml');
  try {
    const d = await launch(c);
    await apply(d, 'Default', 'Bez štítků');
    assert.ok(await waitFor(() => full(c)?.preset === 'Bez štítků', 3000), 'ui-state.json: graph.full.preset `Bez štítků`');
    const d2 = await relaunch(c);
    assert.ok(await shown(d2, 'Preset: Bez štítků', 5000), 'after a relaunch: `Preset: Bez štítků`');
    assert.ok(await textShown(d2, '2 hidden', 3000), 'with its filters');
    assert.ok(!(await textShown(d2, '· modified', 500)), 'not modified');
    await end(d2);
    c.d = undefined;
    const other = vaultCopy(c.base, 'valid.yml', 'Jiný');
    const c2: Ctx = { ...c, vault: other };
    const d3 = await launch(c2);
    c.d = d3;
    assert.ok(await shown(d3, 'Preset: Default', 5000), 'another vault has its own `preset`');
  } finally { await cleanup(c); }
});

// ------------------------------------------------------------------------------------------------ FR-GRP-02 AC-23

test('fr_grp_02_ac23_external_changes_reload_the_list_only', { timeout: 300_000 }, async () => {
  await ready();
  const c = fresh('ac23', 'valid.yml');
  try {
    const d = await launch(c);
    await apply(d, 'Default', 'Bez štítků');
    assert.ok(await textShown(d, '2 hidden', 3000), 'Bez štítků applied');
    externalWrite(c, YML, fx('valid.yml').replace('hidden-types: [tag, kniha]', 'hidden-types: [page]'));
    assert.ok(await textShown(d, '· modified', 2000), 'another program\'s change shows `· modified` within 2 s');
    assert.ok(await textShown(d, '2 hidden', 500), 'the view\'s filters stay');
    externalWrite(c, YML, `${fx('valid.yml')}  - name: Nová zvenku\n    hidden-types: []\n    hidden-kinds: [tag]\n`);
    await sleep(2000);
    await presetMenu(d, 'Bez štítků');
    assert.ok(await textShown(d, 'Nová zvenku', 1000), 'a preset added outside is listed within 2 s');
    press('escape');
    external('delete', join(c.vault, YML));
    await sleep(2000);
    await presetMenu(d, 'Default').catch(() => {});
    assert.ok(!(await textShown(d, 'Jen vztahy', 800)), 'the file deleted: Default only');
    press('escape');
    assert.ok(await textShown(d, '2 hidden', 500), 'the filters unchanged');
    assert.ok(!existsSync(join(c.vault, YML)), 'and nothing is created');
  } finally { await cleanup(c); }
});

// ------------------------------------------------------------------------------------------------ FR-SYN-03 AC-23

test('fr_syn_03_ac23_synced_changes_and_conflict_copies', { timeout: 300_000 }, async () => {
  await ready();
  const c = fresh('syn03ac23', 'valid.yml');
  try {
    const copy = `${fx('valid.yml')}  - name: Z jiného Macu\n    hidden-types: [osoba]\n    hidden-kinds: []\n`;
    writeFileSync(join(c.vault, COPY_A), copy);
    writeFileSync(join(c.vault, COPY_B), copy);
    const copies = () => [stamp(c, COPY_A), stamp(c, COPY_B)];
    const c0 = copies();
    const d = await launch(c);
    await presetMenu(d, 'Default');
    assert.ok(!(await textShown(d, 'Z jiného Macu', 800)), 'the conflict copies are never read for presets');
    press('escape');
    externalReplace(c, YML, copy);
    await sleep(2000);
    await presetMenu(d, 'Default');
    assert.ok(await textShown(d, 'Z jiného Macu', 1000), 'the synced version (an atomic replace) is listed within 2 s');
    press('escape');
    await (await need(d, 'Tags', 3000)).click().catch(() => {});
    await saveAs(d, 'Default', 'Moje');
    assert.ok(await waitFor(() => listedNames(readFileSync(join(c.vault, YML), 'utf8')).join('|') === ['Bez štítků', 'Jen vztahy', 'Lidé a schůzky', 'Z jiného Macu', 'Moje'].join('|'), 3000),
      `all four earlier presets and Moje last: ${listedNames(readFileSync(join(c.vault, YML), 'utf8')).join(', ')}`);
    await apply(d, 'Moje', 'Jen vztahy');
    await presetMenu(d, 'Jen vztahy');
    await (await needMenuItem(d, 'Delete “Jen vztahy”…')).click();
    await (await need(d, 'Delete')).click();
    await sleep(800);
    assert.deepEqual(copies(), c0, 'the conflict copies keep their bytes, mtime and inode after the tour');
  } finally { await cleanup(c); }
});

// ------------------------------------------------------------------------------------------------ FR-SYN-06 AC-40

test('fr_syn_06_ac40_only_preset_actions_write_graph_yml', { timeout: 900_000 }, async () => {
  await ready();
  const c = fresh('syn06ac40', 'valid.yml');
  try {
    const before = tree(c.vault);
    const d = await launch(c);
    let cur = 'Default';
    for (const n of ['Bez štítků', 'Jen vztahy', 'Lidé a schůzky', 'Default']) { await apply(d, cur, n); cur = n; }
    await apply(d, cur, 'Bez štítků');
    cur = 'Bez štítků';
    await (await need(d, 'Tags', 3000)).click();
    await (await need(d, 'Revert', 3000)).click();
    for (const v of ['List', 'Graph']) await (await need(d, v)).click();
    await (await need(d, 'Plán čtvrtletí, Page')).click();
    for (const k of ['right', 'left', 'down', 'up', 'escape', 'escape']) press(k);
    for (const m of ['Object preview: Hover to preview', 'Object preview: Off', 'Object preview: Click to preview']) { palette(m); await sleep(400); }
    await presetMenu(d, cur);
    await (await needMenuItem(d, 'Save as new preset…')).click();
    await (await need(d, 'Cancel')).click();
    await presetMenu(d, cur);
    await (await needMenuItem(d, 'Rename “Bez štítků”…')).click();
    press('escape');
    await presetMenu(d, cur);
    await (await needMenuItem(d, 'Delete “Bez štítků”…')).click();
    await (await need(d, 'Cancel')).click();
    const d2 = await relaunch(c);
    assert.ok(await shown(d2, 'Preset: Bez štítků', 5000), 'relaunched');
    assert.deepEqual(changedPaths(before, tree(c.vault)), [], 'the tour leaves every vault file byte-, mtime- and inode-identical and creates nothing');
    const step = async (what: string, f: () => Promise<void>) => {
      const t0 = tree(c.vault);
      await f();
      assert.ok(await waitFor(() => changedPaths(t0, tree(c.vault)).length > 0, 3000), `${what}: a write`);
      await sleep(500);
      assert.deepEqual(changedPaths(t0, tree(c.vault)), [YML], `${what}: exactly one file, .tegg/graph.yml`);
    };
    await (await need(d2, 'Pages', 3000)).click().catch(() => {});
    await step('Save as', () => saveAs(d2, 'Bez štítků', 'Moje'));
    await (await need(d2, 'Tasks', 3000)).click().catch(() => {});
    await step('Update', async () => { await (await need(d2, 'Update')).click(); });
    const same = tree(c.vault);
    await presetMenu(d2, 'Moje');
    await (await needMenuItem(d2, 'Rename “Moje”…')).click();
    press('enter');
    await sleep(800);
    assert.deepEqual(changedPaths(same, tree(c.vault)), [], 'a rename to the same name writes nothing');
    await step('Rename', async () => {
      await presetMenu(d2, 'Moje');
      await (await needMenuItem(d2, 'Rename “Moje”…')).click();
      typeAscii(' 2');
      press('enter');
    });
    await step('Delete', async () => {
      await presetMenu(d2, 'Moje 2');
      await (await needMenuItem(d2, 'Delete “Moje 2”…')).click();
      await (await need(d2, 'Delete')).click();
    });
  } finally { await cleanup(c); }
});

// ------------------------------------------------------------------------------------------------ FR-UX-08 AC-5

test('fr_ux_08_ac5_graph_list_switch_remembered', { timeout: 300_000 }, async () => {
  await ready();
  const c = fresh('ux08ac5', null);
  try {
    const before = tree(c.vault);
    const d = await launch(c);
    await (await need(d, 'List', 5000)).click();
    assert.ok(await shown(d, 'Local graph as a list', 3000), 'the tree `Local graph as a list`');
    assert.ok(await waitFor(() => full(c)?.view === 'list', 3000), 'ui-state.json: graph.full.view `list`');
    const d2 = await relaunch(c, graphRoute('Daily/2026-10-07.md'));
    assert.ok(await shown(d2, 'Local graph as a list', 5000), 'after a relaunch the next graph starts in List');
    assert.deepEqual(changedPaths(before, tree(c.vault)), [], 'no vault write');
  } finally { await cleanup(c); }
});
