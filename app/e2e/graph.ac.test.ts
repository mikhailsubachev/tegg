// Slice G1 real-app tests (L6, Appium mac2 on the built test app, D-382): docs/acceptance/graph.md — every L6-marked
// criterion except the benchmark (nfr_perf_11_graph.ac.test.ts): FR-GRP-01 AC-13 (once: another program renames the
// centre), AC-14 (the depth survives a relaunch), AC-20 (once: another program's edit adds a node within 2 s), AC-22
// (once: the centre moved to `.trash/` and restored), FR-GRP-02 AC-5 (the filters survive a relaunch, per vault),
// FR-SYN-06 AC-38 (a graph tour writes nothing: every vault file keeps its bytes, mtime and inode; only ui-state.json in
// Application Support is written, atomically). Interface docs/contracts/v1-graph.md §3, §5, §6, §8 (`TEGG_ROUTE=graph/
// <path>`, `route-ready:graph/<path>`, window 1,440 × 980) and ms3-shell §13.6 (the external helper). Always TEGG_TEST=1
// with the G1 test clock, a temporary Application Support and a temporary copy of the synthetic graph fixture (D-62).
// Written from the ACs and the contracts only (D-61). Shared helpers: app/e2e/helpers/capture.ts.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { writeHub } from '../../tests/fixtures/vaults/graph/make-hub.mjs';
import {
  FX, appiumDown, changedPaths, end, marks, need, needInGroup, palette, press, ready, session, shown, sleep, support, testEnv, textContains, tmp, tree,
  waitFor, type Driver, type Env,
} from './helpers/capture.ts';

after(appiumDown);
process.on('exit', appiumDown);

/** The G1 test clock (graph.md). */
const NOW_G1 = '2026-10-28T10:00:00+01:00';
const PLAN = 'Pages/Plán čtvrtletí.md';
const EXTERNAL = resolve(import.meta.dirname, 'helpers/external.ts');
const graphRoute = (p: string) => `graph/${p.normalize('NFC')}`;

/** A temp copy of tests/fixtures/vaults/graph (without README.md and make-hub.*) plus new-empty/.tegg and the README's
 *  runtime attachments; `hub` writes the hub. */
function graphCopy(base: string, o: { hub?: boolean; name?: string } = {}): string {
  const v = join(base, o.name ?? 'Graf');
  const src = join(FX, 'graph');
  cpSync(src, v, { recursive: true, filter: (s) => { const r = relative(src, s); return r !== 'README.md' && !r.startsWith('make-hub.'); } });
  cpSync(join(FX, 'new-empty/.tegg'), join(v, '.tegg'), { recursive: true });
  mkdirSync(join(v, '_attachments'), { recursive: true });
  cpSync(join(FX, 'trash-media/_attachments/záhon.png'), join(v, '_attachments/graf.png'));
  cpSync(join(FX, 'trash-media/_attachments/Rozpočet.pdf'), join(v, '_attachments/Smlouva.pdf'));
  if (o.hub) writeHub(v);
  return v;
}
type Ctx = { base: string; vault: string; sup: string; log: string; d?: Driver };
function fresh(name: string, o: { hub?: boolean } = {}): Ctx {
  const base = tmp(`g1-${name}`);
  return { base, vault: graphCopy(base, o), sup: support(base), log: join(base, 'perf.jsonl') };
}
async function waitRoute(log: string, route: string, ms = 20_000): Promise<boolean> {
  const want = `route-ready:${route.normalize('NFC')}`;
  return waitFor(() => marks(log).map((m) => m.normalize('NFC')).includes(want), ms);
}
async function launch(c: Ctx, route: string, extra: Env = {}): Promise<Driver> {
  c.d = await session(testEnv(c.sup, c.log, { TEGG_VAULT: c.vault, TEGG_ROUTE: route, TEGG_NOW: NOW_G1, ...extra }));
  assert.ok(await waitRoute(c.log, route), `${route} shown (route-ready)`);
  return c.d;
}
async function cleanup(c: Ctx) {
  await end(c.d);
  rmSync(c.base, { recursive: true, force: true });
}
function external(...args: string[]) {
  execFileSync(process.execPath, [EXTERNAL, ...args], { encoding: 'utf8' });
}
function externalWrite(path: string, text: string) {
  const f = join(tmpdir(), `tegg-g1-ext-${process.pid}-${Date.now()}.md`);
  writeFileSync(f, text);
  external('write', path, f);
  rmSync(f, { force: true });
}
/** Some element's text contains `text` within `ms`. */
async function textShown(d: Driver, text: string, ms = 3000): Promise<boolean> {
  return waitFor(async () => {
    for (const e of await d.$$(`-ios predicate string:${textContains(text)}`).catch(() => [] as any[])) if (await e.isDisplayed().catch(() => false)) return true;
    return false;
  }, ms);
}
/** A control inside the group named `group` whose name starts with `prefix` (a type row is `<Plural> <count>`). */
async function needStarting(d: Driver, group: string, prefix: string, ms = 3000): Promise<any> {
  const g = group.replace(/"/g, '\\"'), p = prefix.replace(/"/g, '\\"');
  const endAt = Date.now() + ms;
  while (Date.now() < endAt) {
    for (const box of await d.$$(`-ios predicate string:label ==[c] "${g}"`).catch(() => [] as any[])) {
      for (const e of await box.$$(`-ios predicate string:label BEGINSWITH "${p}" OR title BEGINSWITH "${p}"`).catch(() => [] as any[])) {
        if (await e.isDisplayed().catch(() => false)) return e;
      }
    }
    await sleep(100);
  }
  assert.fail(`a control starting "${prefix}" in the group "${group}" is shown`);
}
const uiState = (sup: string) => (existsSync(join(sup, 'ui-state.json')) ? JSON.parse(readFileSync(join(sup, 'ui-state.json'), 'utf8')) : null);
const full = (sup: string, vault: string) => uiState(sup)?.vaults?.[vault.normalize('NFC')]?.graph?.full ?? null;
const vaultFiles = (a: ReturnType<typeof tree>, b: ReturnType<typeof tree>) => changedPaths(a, b);

// ------------------------------------------------------------------------------------------------ FR-GRP-01

test('fr_grp_01_ac13_route_and_labels_follow_renames', { timeout: 300_000 }, async () => {
  await ready();
  const c = fresh('ac13');
  try {
    const d = await launch(c, graphRoute(PLAN));
    assert.ok(await textShown(d, '10 objects', 3000), 'Plán\'s graph');
    const q4 = join(c.vault, 'Pages/Plán Q4.md');
    external('rename', join(c.vault, PLAN), q4);
    externalWrite(q4, readFileSync(q4, 'utf8').replace('title: Plán čtvrtletí', 'title: Plán Q4'));
    assert.ok(await waitRoute(c.log, graphRoute('Pages/Plán Q4.md'), 2000), 'the route follows the external rename within 2 s (same id)');
    assert.ok(await shown(d, 'Graph · Plán Q4', 2000), 'the tab and window title `Graph · Plán Q4`');
    assert.ok(await textShown(d, '10 objects', 1000), 'the same nodes');
    assert.ok(!(await textShown(d, 'This object was deleted', 300)), 'never shown as deleted');
  } finally { await cleanup(c); }
});

test('fr_grp_01_ac14_depth_defaults_to_one_and_is_remembered', { timeout: 300_000 }, async () => {
  await ready();
  const c = fresh('ac14');
  try {
    const before = tree(c.vault);
    const d = await launch(c, graphRoute(PLAN));
    assert.ok(await textShown(d, '10 objects', 3000), 'depth 1 by default: 10 objects');
    await (await needInGroup(d, 'Depth', '2')).click();
    assert.ok(await textShown(d, '19 objects', 3000), 'depth 2: 19 objects');
    assert.ok(await waitFor(() => full(c.sup, c.vault)?.depth === 2, 3000), 'ui-state.json: graph.full.depth 2 under the vault\'s NFC path (D-993)');
    await end(d);
    c.d = undefined;
    const d2 = await launch({ ...c, log: join(c.base, 'perf2.jsonl') } as Ctx, graphRoute('Daily/2026-10-07.md'));
    c.d = d2;
    assert.ok(await textShown(d2, '11 objects', 5000), 'after a relaunch the next graph (Den) starts at depth 2: 11 objects');
    assert.deepEqual(vaultFiles(before, tree(c.vault)), [], 'no vault file is written');
  } finally { await cleanup(c); }
});

test('fr_grp_01_ac20_live_updates_within_two_seconds', { timeout: 300_000 }, async () => {
  await ready();
  const c = fresh('ac20');
  try {
    const d = await launch(c, graphRoute(PLAN));
    assert.ok(await textShown(d, '10 objects', 3000), 'Plán at depth 1');
    const osamela = join(c.vault, 'Pages/Osamělá.md');
    externalWrite(osamela, `${readFileSync(osamela, 'utf8').trimEnd()}\nViz [[Plán čtvrtletí]].\n`);
    assert.ok(await textShown(d, '11 objects', 2000), 'another program\'s edit adds Osamělá within 2 s (D-980)');
    assert.ok(await shown(d, 'Osamělá, Page', 1000), 'the node Osamělá');
  } finally { await cleanup(c); }
});

test('fr_grp_01_ac22_centre_deleted_state', { timeout: 300_000 }, async () => {
  await ready();
  const c = fresh('ac22');
  try {
    const d = await launch(c, graphRoute(PLAN));
    assert.ok(await textShown(d, '10 objects', 3000), 'Plán\'s graph');
    mkdirSync(join(c.vault, '.trash/Pages'), { recursive: true });
    external('rename', join(c.vault, PLAN), join(c.vault, '.trash', PLAN));
    assert.ok(await textShown(d, 'This object was deleted', 2000), 'the deleted state within 2 s');
    assert.ok(await textShown(d, '“Plán čtvrtletí” is in the trash, so there is no graph to show.', 1000), 'the trash text');
    assert.ok(await shown(d, 'Back', 1000), '`Back`');
    external('rename', join(c.vault, '.trash', PLAN), join(c.vault, PLAN));
    assert.ok(await textShown(d, '10 objects', 2000), 'restoring brings the graph back within 2 s');
  } finally { await cleanup(c); }
});

// ------------------------------------------------------------------------------------------------ FR-GRP-02

test('fr_grp_02_ac5_filters_remembered_per_view_and_vault', { timeout: 300_000 }, async () => {
  await ready();
  const c = fresh('g02ac5');
  try {
    const d = await launch(c, graphRoute(PLAN));
    assert.ok(await textShown(d, '10 objects', 3000), 'Plán\'s graph');
    await (await needStarting(d, 'Types', 'Tags')).click();
    assert.ok(await textShown(d, '2 hidden', 3000), 'Tags off: `2 hidden`');
    await (await needInGroup(d, 'Connections', 'Relations')).click();
    assert.ok(await waitFor(() => JSON.stringify(full(c.sup, c.vault)?.hiddenTypes) === '["tag"]' && JSON.stringify(full(c.sup, c.vault)?.hiddenKinds) === '["relation"]', 3000),
      `the hidden keys under graph.full: ${JSON.stringify(full(c.sup, c.vault))}`);
    assert.ok(!JSON.stringify(uiState(c.sup)).includes('"panel"'), 'graph.panel is never written by the full view');
    await end(d);
    c.d = undefined;
    const d2 = await launch({ ...c, log: join(c.base, 'perf2.jsonl') } as Ctx, graphRoute(PLAN));
    c.d = d2;
    assert.ok(await textShown(d2, '2 hidden', 5000), 'the filters survive a relaunch');
    await end(d2);
    c.d = undefined;
    const other = graphCopy(c.base, { name: 'Jiný' });
    const d3 = await launch({ ...c, vault: other, log: join(c.base, 'perf3.jsonl') } as Ctx, graphRoute(PLAN));
    c.d = d3;
    assert.ok(await textShown(d3, '10 objects', 5000), 'another vault keeps its own filters (none hidden)');
    assert.ok(!(await textShown(d3, 'hidden', 500)), 'no hidden count there');
  } finally { await cleanup(c); }
});

// ------------------------------------------------------------------------------------------------ FR-SYN-06 AC-38

test('fr_syn_06_ac38_graph_tour_writes_nothing', { timeout: 900_000 }, async () => {
  await ready();
  const c = fresh('syn06ac38', { hub: true });
  try {
    const before = tree(c.vault);
    const uiBefore = lstatSync(join(c.sup, 'ui-state.json')).ino;
    const d = await launch(c, graphRoute(PLAN));
    for (const n of ['2', '3', '1']) await (await needInGroup(d, 'Depth', n)).click();
    for (const t of ['Pages', 'Tasks', 'Quick Notes', 'Daily Notes', 'Cesty', 'Osoby', 'Projekty', 'Schůzky', 'Images', 'PDFs', 'Tags', 'recept']) {
      await (await needStarting(d, 'Types', t)).click();
      await (await needStarting(d, 'Types', t)).click();
    }
    for (const k of ['Links', 'Relations', 'Embeds', 'Tags']) { await (await needInGroup(d, 'Connections', k)).click(); await (await needInGroup(d, 'Connections', k)).click(); }
    await (await needInGroup(d, 'Types', 'None')).click();
    await (await need(d, 'Show all types')).click();
    await (await needInGroup(d, 'Types', 'All')).click();
    await (await need(d, 'Size nodes by links')).click();
    for (const z of ['Zoom in', 'Zoom out', 'Fit to screen']) await (await need(d, z)).click();
    for (const node of ['Rozpočet 2027, Projekt', '#Účty, Tag', '#nápad, Tag', '2026-10-07, Daily Note', 'Graf výdajů, Image']) {
      await (await need(d, node)).click();
      await sleep(300);
    }
    await (await need(d, 'Rozpočet 2027, Projekt')).click();
    await (await need(d, 'Center graph here')).click();
    await (await need(d, 'Plán čtvrtletí, Page')).click();
    await (await need(d, 'Center graph here')).click();
    press('lbracket', ['command']);
    palette('Go forward');
    await sleep(500);
    await end(d);
    c.d = undefined;
    for (const [i, route] of [graphRoute('Pages/Hub/Rozcestník.md'), graphRoute('Tags/Účty.md'), graphRoute('Daily/2026-10-07.md'), graphRoute('Pages/Osamělá.md')].entries()) {
      const di = await launch({ ...c, log: join(c.base, `perf-${i}.jsonl`) } as Ctx, route);
      c.d = di;
      if (route.includes('Rozcestník')) {
        await (await needInGroup(di, 'Depth', '2')).click();
        await (await need(di, 'Show all', 5000)).click();
        await sleep(500);
      }
      await end(di);
      c.d = undefined;
    }
    assert.deepEqual(vaultFiles(before, tree(c.vault)), [], 'every vault file keeps its bytes, mtime and inode; no file or folder is created');
    for (const p of ['.tegg/graph.yml', 'Tags/nápad.md', 'Daily/2026-10-30.md']) assert.ok(!existsSync(join(c.vault, p)), `no ${p}`);
    assert.ok(full(c.sup, c.vault) !== null, 'ui-state.json holds the graph state');
    assert.notEqual(lstatSync(join(c.sup, 'ui-state.json')).ino, uiBefore, 'ui-state.json was replaced atomically (a new inode)');
  } finally { await cleanup(c); }
});
