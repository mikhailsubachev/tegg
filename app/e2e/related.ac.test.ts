// Slice REL real-app tests (L6, Appium mac2 on the built test app, D-382): docs/acceptance/related.md "Real-app tests" —
// FR-LNK-15 AC-9 (the built app opened on an index one schema version older shows Souhvězdí's list after the rebuild),
// AC-25 (the switch after a relaunch), AC-28 (once: an external trash move), AC-32 (the socket monitor during the tour),
// FR-NAV-05 AC-7 (the tab after a relaunch), FR-STO-07 AC-9 (the switch after a relaunch, atomically, at the top level;
// a fresh Application Support is off), FR-SYN-06 AC-47 (the tour writes nothing to the vault; in the Application
// Support only ui-state.json changes, apart from what opening a vault writes, D-1676) and FR-UX-08 AC-23 (the macOS
// accessibility tree shows the switch with its state and the chips by name). Interface docs/contracts/v1-related.md §6
// (`TEGG_ROUTE=note/<path>` with a seeded `ui-state.json` whose `rightPanel.tab` is `related`, then the DOM or
// `perfMark('related-ready')`; the older index: `PRAGMA user_version = SCHEMA_VERSION − 1` in the one `index.sqlite`
// under the temporary Application Support, with the system `sqlite3`; external changes through helpers/external.ts; the
// socket monitor of previews.ac.test.ts). Always TEGG_TEST=1 with the REL test clock, a temporary Application Support and a
// temporary copy of tests/fixtures/vaults/related plus new-empty/.tegg (D-62). Keys go only to Tegg (D-799): every key is
// sent with helpers/capture.ts `press` / `palette` while Tegg is frontmost. Written from the ACs and the contract only
// (D-61).
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, lstatSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { join, relative } from 'node:path';
import {
  BUNDLE_ID, FX, NetMonitor, appiumDown, changedPaths, end, marks, need, osa, palette, press, ready, session, sleep, support, testEnv, textContains, tmp, tree,
  waitFor, type Driver, type Env,
} from './helpers/capture.ts';
import { external } from './helpers/graph.ts';

after(appiumDown);
process.on('exit', appiumDown);

const NOW_REL = '2026-11-14T10:00:00+01:00';
const P = {
  souhvezdi: 'Pages/Souhvězdí.md', rozpocet: 'Pages/Rozpočet na offsite 2027.md', den: 'Daily/2026-09-30.md', ukol: 'Tasks/Poslat návrh rozpočtu financím.md',
  terminy: 'Pages/Důležité termíny školení.md', zahrada: 'Pages/Zahrada na jaře.md', vcelstvo: 'Pages/Včelstvo na zimu.md', prohlidka: 'Pages/Jarní prohlídka úlu.md',
  ul: 'Images/Úl u lesa.md', hiking: 'Pages/Hiking in the mountains.md', gear: 'Pages/gear list.md', buben: 'Quick Notes/Buben.md', svatba: 'Pages/Svatba Petra a Lucie.md',
  prazdna: 'Pages/Prázdná.md',
};
const noteRoute = (p: string) => `note/${p.normalize('NFC')}`;
const PANEL = (tab = 'related', open = true) => ({ rightPanel: { open, tab, width: 288 }, preview: { mode: 'hover', hoverDelay: 1000 } });

type Ctx = { base: string; vault: string; sup: string; log: string; d?: Driver; n: number };
/** A temp copy of the related fixture (without README.md) plus new-empty/.tegg, and an Application Support whose
 *  `ui-state.json` has `ui`. */
function fresh(name: string, ui: Record<string, unknown> = PANEL()): Ctx {
  const base = tmp(`rel-${name}`);
  const v = join(base, 'Related');
  const src = join(FX, 'related');
  cpSync(src, v, { recursive: true, filter: (s) => relative(src, s) !== 'README.md' });
  cpSync(join(FX, 'new-empty/.tegg'), join(v, '.tegg'), { recursive: true });
  return { base, vault: v, sup: support(base, { ui }), log: join(base, 'perf-0.jsonl'), n: 0 };
}
async function launch(c: Ctx, route: string, extra: Env = {}): Promise<Driver> {
  await end(c.d);
  c.n += 1;
  c.log = join(c.base, `perf-${c.n}.jsonl`);
  c.d = await session(testEnv(c.sup, c.log, { TEGG_VAULT: c.vault, TEGG_ROUTE: route, TEGG_NOW: NOW_REL, ...extra }));
  const want = `route-ready:${route.normalize('NFC')}`;
  assert.ok(await waitFor(() => marks(c.log).map((m) => m.normalize('NFC')).includes(want), 20_000), `${route} shown (route-ready)`);
  return c.d;
}
const relatedReady = (c: Ctx, ms = 5000) => waitFor(() => marks(c.log).includes('related-ready'), ms);
async function quit(c: Ctx) {
  await end(c.d);
  c.d = undefined;
}
async function cleanup(c: Ctx) {
  await end(c.d);
  rmSync(c.base, { recursive: true, force: true });
}
const uiState = (c: Ctx) => (existsSync(join(c.sup, 'ui-state.json')) ? JSON.parse(readFileSync(join(c.sup, 'ui-state.json'), 'utf8')) : null);
const tegg = () => osa(`tell application id "${BUNDLE_ID}" to activate`);
async function textShown(d: Driver, text: string, ms = 3000): Promise<boolean> {
  return waitFor(async () => {
    for (const e of await d.$$(`-ios predicate string:${textContains(text)}`).catch(() => [] as any[])) if (await e.isDisplayed().catch(() => false)) return true;
    return false;
  }, ms);
}
/** Elements of the accessibility tree labelled exactly `label`, with their type and value. */
async function labelled(d: Driver, label: string): Promise<{ type: string; value: string }[]> {
  const l = label.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const out: { type: string; value: string }[] = [];
  for (const e of await d.$$(`-ios predicate string:label == "${l}" OR title == "${l}"`).catch(() => [] as any[])) {
    out.push({ type: String(await e.getAttribute('elementType').catch(() => '')), value: String(await e.getAttribute('value').catch(() => '')) });
  }
  return out;
}
/** The switch `Show linked notes` is on (accessibility value 1 / true). */
async function switchOn(d: Driver): Promise<boolean> {
  return (await labelled(d, 'Show linked notes')).some((e) => /^(1|true|on)$/i.test(e.value));
}
/** The one `index.sqlite` under the Application Support. */
function indexDb(sup: string): string | null {
  const found: string[] = [];
  const walk = (dir: string) => {
    for (const n of readdirSync(dir)) {
      const p = join(dir, n);
      if (lstatSync(p).isDirectory()) walk(p);
      else if (n === 'index.sqlite') found.push(p);
    }
  };
  walk(sup);
  return found.length === 1 ? found[0] : null;
}
const opening = (p: string) => p === 'last-vault' || p === 'recent-vaults' || p === 'vaults/' || /^vaults\/[^/]+\/?(index\.sqlite(-shm|-wal)?|last-opened\.json|recent[^/]*)?$/.test(p);

// ------------------------------------------------------------------------------------------------ FR-LNK-15 AC-9

test('fr_lnk_15_ac9_index_version_rebuild_and_crash_safety', { timeout: 300_000 }, async () => {
  await ready();
  const c = fresh('ac9');
  try {
    await launch(c, noteRoute(P.souhvezdi));
    assert.ok(await relatedReady(c), 'Souhvězdí\'s list (related-ready)');
    await quit(c);
    const db = indexDb(c.sup);
    assert.ok(db, 'one index.sqlite in the temporary Application Support');
    const v = Number(execFileSync('/usr/bin/sqlite3', [db!, 'PRAGMA user_version'], { encoding: 'utf8' }).trim());
    assert.ok(v >= 7, `the index's schema version is at least 7 (contract §1.5): ${v}`);
    execFileSync('/usr/bin/sqlite3', [db!, `PRAGMA user_version = ${v - 1}`]);
    const before = tree(c.vault);
    const d = await launch(c, noteRoute(P.souhvezdi));
    assert.ok(await relatedReady(c, 20_000), 'after the rebuild: related-ready');
    for (const t of ['Hvězda 03', 'Hvězda 12']) assert.ok(await textShown(d, t, 5000), `Souhvězdí's list shows ${t}`);
    assert.equal(Number(execFileSync('/usr/bin/sqlite3', [db!, 'PRAGMA user_version'], { encoding: 'utf8' }).trim()), v, 'the index is rebuilt at the current version');
    assert.deepEqual(changedPaths(before, tree(c.vault)), [], 'every vault file is untouched');
  } finally {
    await cleanup(c);
  }
});

// ------------------------------------------------------------------------------------------------ FR-LNK-15 AC-25

test('fr_lnk_15_ac25_show_linked_notes_switch', { timeout: 300_000 }, async () => {
  await ready();
  const c = fresh('ac25');
  try {
    const d = await launch(c, noteRoute(P.souhvezdi));
    assert.ok(await relatedReady(c), 'related-ready');
    assert.equal(await switchOn(d), false, 'the switch starts off');
    tegg();
    await (await need(d, 'Show linked notes', 5000)).click();
    assert.ok(await waitFor(() => uiState(c)?.related?.showLinked === true, 3000), 'ui-state.json: related.showLinked true');
    assert.ok(await textShown(d, 'Hvězda 02', 3000), 'the linked-shown list');
    await quit(c);
    const d2 = await launch(c, noteRoute(P.souhvezdi));
    assert.ok(await relatedReady(c), 'related-ready after the relaunch');
    assert.ok(await switchOn(d2), 'after a relaunch the switch is still on');
    assert.ok(await textShown(d2, 'Hvězda 02', 3000) && await textShown(d2, 'Linked', 3000), 'with the linked-shown list and the Linked mark');
  } finally {
    await cleanup(c);
  }
});

// ------------------------------------------------------------------------------------------------ FR-LNK-15 AC-28

test('fr_lnk_15_ac28_live_updates_keep_focus', { timeout: 300_000 }, async () => {
  await ready();
  const c = fresh('ac28');
  try {
    const d = await launch(c, noteRoute(P.vcelstvo));
    assert.ok(await relatedReady(c), 'related-ready');
    assert.ok(await textShown(d, 'Jarní prohlídka úlu', 3000), 'Včelstvo → [Prohlídka]');
    external('rename', join(c.vault, P.prohlidka), join(c.vault, '.trash', P.prohlidka));
    assert.ok(await textShown(d, 'No related notes', 2000), 'Prohlídka moved to .trash/ by another program: No related notes within 2 s');
    external('rename', join(c.vault, '.trash', P.prohlidka), join(c.vault, P.prohlidka));
    assert.ok(await textShown(d, 'Jarní prohlídka úlu', 2000), 'moved back: [Prohlídka] within 2 s');
  } finally {
    await cleanup(c);
  }
});

// ------------------------------------------------------------------------------------------------ the tour (FR-SYN-06 AC-47, FR-LNK-15 AC-32)

async function tour(c: Ctx) {
  for (const route of [
    noteRoute(P.souhvezdi), noteRoute(P.rozpocet), 'daily/2026-09-30', noteRoute(P.terminy), noteRoute(P.zahrada), noteRoute(P.vcelstvo), noteRoute(P.ul),
    noteRoute(P.hiking), noteRoute(P.gear), noteRoute(P.buben), noteRoute(P.svatba), noteRoute(P.prazdna), 'daily/2026-11-14',
  ]) {
    await launch(c, route);
    await sleep(800);
  }
  for (const p of [P.souhvezdi, P.zahrada]) {
    const d = await launch(c, noteRoute(p));
    tegg();
    await (await need(d, 'Show linked notes', 5000)).click();
    await sleep(400);
    await (await need(d, 'Show linked notes', 5000)).click();
    await sleep(400);
  }
  let d = await launch(c, noteRoute(P.rozpocet));
  assert.ok(await relatedReady(c), 'Rozpočet: related-ready');
  tegg();
  await (await need(d, '2026-09-30', 5000)).moveTo();
  assert.ok(await textShown(d, 'Preview: 2026-09-30', 3000) || (await labelled(d, 'Preview: 2026-09-30')).length > 0, 'hovering Den 30. 9.\'s chip previews it');
  press('escape');
  await (await need(d, 'Poslat návrh rozpočtu financím', 5000)).click();
  await sleep(800);
  press('lbracket', ['command']);
  await sleep(800);
  for (const cmd of ['Show related', 'Related: Show linked notes', 'Related: Hide linked notes']) {
    palette(cmd);
    await sleep(600);
  }
  const sep = await need(d, 'Resize panel', 3000);
  await sep.click();
  for (let i = 0; i < 3; i++) press('left');
  press('backslash', ['command']);
  await sleep(300);
  press('backslash', ['command']);
  await sleep(300);
  await quit(c);
  d = await launch(c, noteRoute(P.rozpocet));
  await sleep(800);
  return d;
}

test('fr_syn_06_ac47_related_tour_writes_nothing', { timeout: 900_000 }, async () => {
  await ready();
  const c = fresh('syn47');
  try {
    const before = tree(c.vault);
    const supBefore = tree(c.sup);
    const ui0 = lstatSync(join(c.sup, 'ui-state.json')).ino;
    await tour(c);
    await quit(c);
    assert.deepEqual(changedPaths(before, tree(c.vault)), [], 'every vault file keeps its bytes, mtime and inode; nothing was created');
    assert.ok(!existsSync(join(c.vault, 'Daily/2026-11-14.md')), 'no Daily/2026-11-14.md');
    const changed = changedPaths(supBefore, tree(c.sup)).filter((p) => p !== 'ui-state.json' && !opening(p));
    assert.deepEqual(changed, [], 'apart from what opening a vault writes (D-1676), only ui-state.json changed in the Application Support');
    assert.notEqual(lstatSync(join(c.sup, 'ui-state.json')).ino, ui0, 'ui-state.json was written atomically (a new inode)');
    assert.ok(marks(c.log).length > 0 && (uiState(c)?.rightPanel?.tab === 'related'), 'the tour ran with the Related tab');
  } finally {
    await cleanup(c);
  }
});

test('fr_lnk_15_ac32_offline_and_stemmer_licence', { timeout: 900_000 }, async () => {
  await ready();
  const c = fresh('ac32');
  const net = new NetMonitor().start();
  try {
    await tour(c);
    assert.ok(marks(c.log).includes('related-ready'), 'the tour showed Related lists');
    const r = net.stop();
    assert.ok(r.watched.length > 0, 'the monitor watched the app');
    assert.deepEqual(r.sockets, [], 'no socket other than local IPC (NFR-SEC-01)');
  } finally {
    net.stop();
    await cleanup(c);
  }
});

// ------------------------------------------------------------------------------------------------ FR-NAV-05 AC-7

test('fr_nav_05_ac7_related_tab_remembered', { timeout: 300_000 }, async () => {
  await ready();
  const c = fresh('nav7', PANEL('backlinks'));
  try {
    const before = tree(c.vault);
    const d = await launch(c, noteRoute(P.rozpocet));
    tegg();
    await (await need(d, 'Related', 5000)).click();
    assert.ok(await waitFor(() => uiState(c)?.rightPanel?.tab === 'related', 3000), 'choosing Related stores rightPanel.tab: related');
    await quit(c);
    const d2 = await launch(c, noteRoute(P.rozpocet));
    assert.ok(await relatedReady(c), 'after the relaunch the panel opens on Related (related-ready)');
    for (const t of ['2026-09-30', 'Poslat návrh rozpočtu financím']) assert.ok(await textShown(d2, t, 3000), `with its entry ${t}`);
    assert.deepEqual(changedPaths(before, tree(c.vault)), [], 'the vault\'s files are untouched');
  } finally {
    await cleanup(c);
  }
});

// ------------------------------------------------------------------------------------------------ FR-STO-07 AC-9

test('fr_sto_07_ac9_show_linked_is_machine_local', { timeout: 300_000 }, async () => {
  await ready();
  const c = fresh('sto9');
  try {
    const before = tree(c.vault);
    const ui0 = lstatSync(join(c.sup, 'ui-state.json')).ino;
    const d = await launch(c, noteRoute(P.zahrada));
    assert.ok(await textShown(d, 'No related notes', 5000), 'Zahrada, linked hidden: No related notes');
    tegg();
    await (await need(d, 'Show linked notes', 5000)).click();
    assert.ok(await waitFor(() => uiState(c)?.related?.showLinked === true, 3000), 'related.showLinked: true at the top level of ui-state.json');
    assert.ok(!JSON.stringify(uiState(c)?.vaults ?? {}).includes('showLinked'), 'not under vaults[…]');
    assert.notEqual(lstatSync(join(c.sup, 'ui-state.json')).ino, ui0, 'written atomically (a new inode)');
    assert.deepEqual(changedPaths(before, tree(c.vault)), [], 'nothing created or changed under .tegg/ (and nowhere in the vault)');
    await quit(c);
    const d2 = await launch(c, noteRoute(P.zahrada));
    assert.ok(await switchOn(d2), 'after a relaunch the switch is still on');
    assert.ok(await textShown(d2, 'Semínka na jaro', 3000), 'with Zahrada\'s linked-shown list');
    await quit(c);
    const sup2 = support(c.base, { name: 'support-fresh', ui: PANEL() });
    c.sup = sup2;
    const d3 = await launch(c, noteRoute(P.zahrada));
    assert.equal(await switchOn(d3), false, 'a fresh Application Support with the same vault: off');
  } finally {
    await cleanup(c);
  }
});

// ------------------------------------------------------------------------------------------------ FR-UX-08 AC-23

test('fr_ux_08_ac23_related_voiceover_and_motion', { timeout: 300_000 }, async () => {
  await ready();
  const c = fresh('ux23', { ...PANEL(), related: { showLinked: true } });
  try {
    const d = await launch(c, noteRoute(P.souhvezdi));
    assert.ok(await relatedReady(c), 'related-ready');
    const sw = await labelled(d, 'Show linked notes');
    assert.ok(sw.length > 0 && sw.some((e) => /^(1|true|on)$/i.test(e.value)), `the macOS accessibility tree shows the switch with its state: ${JSON.stringify(sw)}`);
    for (const name of ['Hvězda 02', 'Hvězda 01', 'Hvězda 03', 'Hvězda 10']) {
      assert.ok((await labelled(d, name)).length > 0, `the entries' chips by name: ${name}`);
    }
  } finally {
    await cleanup(c);
  }
});
