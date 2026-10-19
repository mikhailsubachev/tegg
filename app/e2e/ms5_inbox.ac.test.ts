// MS5 slice 5B real-app tests (L6, Appium mac2 on the built test app, D-382): docs/acceptance/inbox.md — FR-INB-02
// AC-1 (once: the file), AC-3 (once: a real external writer), AC-13 (once: the vault); FR-INB-03 AC-4 (L6 in FR-SYN-06
// AC-26); FR-NAV-04 AC-2 (once after a capture); FR-SYN-06 AC-26 (a browsing tour writes nothing), AC-27 (each action
// writes only its files; a bulk convert also one zip in Application Support). Interface: docs/contracts/ms5-capture.md
// §7 (route `inbox`, `route-ready:inbox`, R60 accessible names), ms3-shell §1. Always TEGG_TEST=1 with TEGG_NOW
// (D-504), a temporary Application Support and a temporary copy of the synthetic inbox fixture (D-62). Written from the
// ACs and the contracts only (D-61). Shared helpers: app/e2e/helpers/capture.ts.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import {
  NOW, REPO, activateFinder, appiumDown, captureOpen, changedPaths, end, fx, hotkey, inboxCopy, need, palette, press, read, ready, session, shown,
  sleep, support, testEnv, tmp, tree, typeAscii, waitFile, waitFor, waitMark, type Driver,
} from './helpers/capture.ts';

after(appiumDown);
process.on('exit', appiumDown);

type Ctx = { base: string; vault: string; sup: string; log: string; d?: Driver };
function fresh(name: string): Ctx {
  const base = tmp(name);
  return { base, vault: inboxCopy(base), sup: support(base), log: join(base, 'perf.jsonl') };
}
async function launch(c: Ctx, route = 'inbox') {
  c.d = await session(testEnv(c.sup, c.log, { TEGG_VAULT: c.vault, TEGG_ROUTE: route }));
  assert.ok(await waitMark(c.log, `route-ready:${route}`), `${route} shown`);
  return c.d;
}
async function cleanup(c: Ctx) {
  await end(c.d);
  rmSync(c.base, { recursive: true, force: true });
}
const Q1 = 'Quick Notes/Koupit mléko.md';
const reviewed = (rel: string, mod: string) => fx(rel).replace('review: unreviewed', 'review: reviewed').replace(mod, `modified: ${NOW}`);
function zips(sup: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => { if (!existsSync(d)) return; for (const n of readdirSync(d, { withFileTypes: true })) { const p = join(d, n.name); if (n.isDirectory()) walk(p); else if (n.name.endsWith('.zip')) out.push(p); } };
  walk(join(sup, 'backups'));
  return out;
}

test('fr_inb_02_ac1_mark_reviewed_writes_the_file_once', { timeout: 300_000 }, async () => {
  await ready();
  const c = fresh('inb02ac1');
  try {
    const d = await launch(c);
    const before = tree(c.vault);
    await (await need(d, 'Quick Note: Koupit mléko')).click();
    press('r');
    const t = await waitFile(join(c.vault, Q1), (x) => x !== null && x.includes('review: reviewed'), 2000);
    assert.equal(t, reviewed(Q1, 'modified: 2026-10-14T08:15:00+02:00'), 'only review and modified');
    assert.deepEqual(changedPaths(before, tree(c.vault)), [Q1], 'once, only Q1');
    assert.ok(await shown(d, '12 to review', 1000), 'the summary');
  } finally { await cleanup(c); }
});

test('fr_inb_02_ac3_a_real_external_writer_is_never_overwritten', { timeout: 300_000 }, async () => {
  await ready();
  const c = fresh('inb02ac3');
  try {
    const d = await launch(c);
    await need(d, 'Quick Note: Koupit mléko');
    const theirs = fx(Q1).replace('Polotučné, 2 litry.', 'Polotučné, 3 litry (Dropbox).');
    const content = join(c.base, 'theirs.md');
    writeFileSync(content, theirs);
    await new Promise<void>((r) => spawn('node', [join(REPO, 'app/e2e/helpers/external.ts'), 'write', join(c.vault, Q1), content], { stdio: 'ignore' }).on('exit', () => r()));
    await (await need(d, 'Quick Note: Koupit mléko')).click();
    press('r');
    await sleep(2500);
    assert.equal(read(c.vault, Q1), theirs, 'the file keeps the external bytes');
    assert.ok(await shown(d, 'Polotučné, 3 litry (Dropbox).', 2000), 'the card shows the external text');
  } finally { await cleanup(c); }
});

test('fr_inb_02_ac13_mark_all_reviewed_on_the_vault', { timeout: 300_000 }, async () => {
  await ready();
  const c = fresh('inb02ac13');
  try {
    const d = await launch(c);
    const before = tree(c.vault);
    await (await need(d, 'Mark all reviewed')).click();
    assert.ok(await shown(d, 'Mark 13 items reviewed?', 2000), 'the confirmation');
    press('escape');
    await sleep(500);
    assert.deepEqual(changedPaths(before, tree(c.vault)), [], 'Esc writes nothing');
    await (await need(d, 'Mark all reviewed')).click();
    await (await need(d, 'Mark reviewed')).click();
    assert.ok(await shown(d, 'Inbox zero', 5000), 'the empty state');
    const changed = changedPaths(before, tree(c.vault));
    assert.equal(changed.length, 13, `the 13 items: ${changed.join(', ')}`);
    for (const p of changed) assert.ok(/review: reviewed|review: "reviewed"/.test(read(c.vault, p) ?? ''), `${p} reviewed`);
  } finally { await cleanup(c); }
});

async function tour(d: Driver) {
  for (const f of ['All', 'Pages', 'Tasks', 'Quick Notes', 'Daily Notes', 'Nápady', 'Schůzky', 'All']) { await (await need(d, f)).click(); await sleep(150); }
  for (const t of ['Koupit mléko', 'Nápad na článek', 'Bez stavu', 'Divná hodnota', 'Bez data', '2026-10-07']) {
    await (await need(d, `Triage actions for "${t}"`)).click();
    await sleep(150);
    press('escape');
  }
  await (await need(d, 'Quick Note: Koupit mléko')).click();
  typeAscii('a');
  await need(d, 'Append "Koupit mléko" to…');
  press('escape');
  typeAscii('l');
  await need(d, 'Link "Koupit mléko" to…');
  press('escape');
  press('space');
  press('escape');
  await (await need(d, 'Mark all reviewed')).click();
  await (await need(d, 'Cancel')).click();
  for (const t of ['Bez stavu', 'Divná hodnota', 'Bez data']) {
    await (await need(d, t)).click();
    await sleep(500);
    press('lbracket', ['command']);
    await sleep(300);
  }
  for (const s of ['Go to Settings: Vault', 'Go to Settings: Menu bar and startup', 'Go to Settings: Shortcuts']) { palette(s); await sleep(400); }
}

test('fr_syn_06_ac26_a_browsing_tour_writes_nothing', { timeout: 600_000 }, async () => {
  await ready();
  const c = fresh('syn06ac26');
  try {
    const d = await launch(c);
    const before = tree(c.vault);
    await tour(d);
    assert.deepEqual(changedPaths(before, tree(c.vault)), [], 'bytes, mtime and inode unchanged; no file or folder created');
  } finally { await cleanup(c); }
});

test('fr_inb_03_ac4_reading_never_writes_in_the_built_app', { timeout: 600_000 }, async () => {
  await ready();
  const c = fresh('inb03ac4');
  try {
    const d = await launch(c);
    const before = tree(c.vault);
    for (const t of ['Bez stavu', 'Divná hodnota', 'Bez data', '2026-10-07']) {
      await (await need(d, t)).click();
      await sleep(800);
      press('lbracket', ['command']);
      await sleep(300);
    }
    assert.deepEqual(changedPaths(before, tree(c.vault)), [], 'Q4, Q5, Q8 and D3 opened: nothing written (D-330)');
  } finally { await cleanup(c); }
});

test('fr_syn_06_ac27_each_action_writes_only_its_files', { timeout: 600_000 }, async () => {
  await ready();
  const c = fresh('syn06ac27');
  try {
    const d = await launch(c);
    let before = tree(c.vault);
    const step = async (what: string, want: string[], act: () => Promise<void>) => {
      await act();
      await waitFor(() => changedPaths(before, tree(c.vault)).length >= want.length, 3000);
      await sleep(300);
      assert.deepEqual(changedPaths(before, tree(c.vault)), [...want].sort(), `${what} writes exactly ${want.join(', ')}`);
      before = tree(c.vault);
    };
    await step('mark reviewed', [Q1], async () => { await (await need(d, 'Quick Note: Koupit mléko')).click(); press('r'); });
    await step('mark unreviewed', [Q1], async () => { press('r'); });
    await step('convert', ['Quick Notes/Nápad na článek.md'], async () => {
      await (await need(d, 'Triage actions for "Nápad na článek"')).click();
      await (await need(d, 'Page')).click();
    });
    await step('link to', [Q1], async () => {
      await (await need(d, 'Triage actions for "Koupit mléko"')).click();
      await (await need(d, 'Link to…')).click();
      typeAscii('Plan webu');
      await sleep(300);
      press('enter');
    });
    await step('append to', ['Pages/Plán webu.md', 'Quick Notes/Bez stavu.md'], async () => {
      await (await need(d, 'Triage actions for "Bez stavu"')).click();
      await (await need(d, 'Append to…')).click();
      typeAscii('Plan webu');
      await sleep(300);
      press('enter');
    });
    const zips0 = zips(c.sup).length;
    await step('bulk convert', ['Quick Notes/Bez data.md', 'Quick Notes/Bez offsetu.md'], async () => {
      await (await need(d, 'Quick Note: Bez data')).click();
      press('space');
      await (await need(d, 'Quick Note: Bez offsetu')).click();
      press('space');
      await (await need(d, 'Convert to…')).click();
      await (await need(d, 'Nápad')).click();
    });
    assert.equal(zips(c.sup).length, zips0 + 1, 'a bulk convert writes one zip in Application Support');
  } finally { await cleanup(c); }
});

test('fr_nav_04_ac2_the_sidebar_count_after_a_capture', { timeout: 300_000 }, async () => {
  await ready();
  const c = fresh('nav04ac2');
  try {
    const d = await launch(c);
    assert.ok(await shown(d, '13 items to review', 2000), 'the Inbox entry: 13');
    await activateFinder();
    hotkey('quick');
    assert.ok(await waitFor(() => captureOpen(d), 2000), 'capture');
    typeAscii('Pocitadlo');
    press('enter', ['command']);
    assert.ok(await shown(d, '14 items to review', 2000), 'within 2 s of a capture');
  } finally { await cleanup(c); }
});
