// MS6 slice 6A real-app tests (L6, Appium mac2 on the built test app, D-382): docs/acceptance/trash-media.md —
// FR-HIS-01 AC-1 (once: Move to trash is one rename, the app goes to the Inbox), AC-7 (Delete permanently into the
// system trash, here TEGG_TEST_SYSTEM_TRASH); FR-ATT-01 AC-1 (once: an NSPasteboard PNG pasted into Plán), AC-2 (a drop,
// sent through TEGG_TEST_DROP: a real Finder drag is not automatable), AC-3 (the picker through TEGG_TEST_PICK_FILES),
// AC-11 (the capture window: a pasted image saved with the capture), AC-12 (the real `tegg-media` scheme: the image's
// `media-ready` mark, no socket), AC-13 (double-click opens the object; Open in Preview and Reveal in Finder through
// TEGG_TEST_REVEAL); FR-NAV-04 AC-6 (the sidebar without Home), AC-7 (launch on `inbox`); FR-SYN-06 AC-29 (a browsing tour
// writes nothing), AC-30 (each action writes only its files). Interface docs/contracts/ms6-trash-media.md §3.6, §4, §7
// (`route-ready:trash`, `media-ready:<path>`), §9.1 (test hooks), ms3-shell §1. Always TEGG_TEST=1 with TEGG_NOW, a
// temporary Application Support and a temporary copy of the synthetic trash-media fixture (D-62). Written from the ACs and
// the contracts only (D-61). Shared helpers: app/e2e/helpers/capture.ts.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import {
  FX, NetMonitor, appiumDown, changedPaths, end, hotkey, marks, need, osa, palette, paste, press, quitApp, read, ready, session, shown, sleep, spawnApp,
  support, testEnv, tmp, tree, typeAscii, waitExit, waitFile, waitMark, type Driver, type Env,
} from './helpers/capture.ts';

after(appiumDown);
process.on('exit', appiumDown);

/** The 6A test clock (trash-media.md), running from here (D-504). */
const NOW6A = '2026-10-22T10:00:00+02:00';
const P = {
  plan: 'Pages/Plán zahrady.md', ukol: 'Tasks/Koupit semínka.md', odkazy: 'Pages/Odkazy.md', img: 'Images/Záhon.md', png: '_attachments/záhon.png',
  pdfObj: 'PDFs/Rozpočet.md', t1: '.trash/Quick Notes/Stará poznámka.md', t2: '.trash/Pages/Zahrada.md', t3: '.trash/Images/Smazaný obrázek.md',
  t3file: '.trash/_attachments/Smazaný obrázek.png', t4: '.trash/_attachments/osiřelý.jpg', t5: '.trash/Tasks/Hotovo.md', folder: '.trash/Recepty',
};
const files = (a: Record<string, unknown>, b: Record<string, unknown>) => changedPaths(a as any, b as any).filter((p) => !p.endsWith('/'));

/** A temp copy of tests/fixtures/vaults/trash-media (without README.md, make-media.mjs) plus new-empty/.tegg, with R71's
 *  trash times (each trashed entry renamed out of `.trash/` and back, oldest first, 25 ms apart). */
function tmCopy(base: string, name = 'Zahrada'): string {
  const v = join(base, name);
  const src = join(FX, 'trash-media');
  cpSync(src, v, { recursive: true, filter: (s) => !['README.md', 'make-media.mjs'].includes(relative(src, s)) });
  cpSync(join(FX, 'new-empty/.tegg'), join(v, '.tegg'), { recursive: true });
  for (const group of [[P.t1], [P.folder], [P.t5], [P.t4], [P.t2], [P.t3, P.t3file]]) {
    for (const rel of group) { renameSync(join(v, rel), join(v, '.touch-6a')); renameSync(join(v, '.touch-6a'), join(v, rel)); }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
  }
  return v;
}
type Ctx = { base: string; vault: string; sup: string; log: string; d?: Driver };
function fresh(name: string): Ctx {
  const base = tmp(`6a-${name}`);
  return { base, vault: tmCopy(base), sup: support(base), log: join(base, 'perf.jsonl') };
}
async function launch(c: Ctx, route: string, extra: Env = {}): Promise<Driver> {
  c.d = await session(testEnv(c.sup, c.log, { TEGG_VAULT: c.vault, TEGG_ROUTE: route, TEGG_NOW: NOW6A, ...extra }));
  assert.ok(await waitMark(c.log, `route-ready:${route}`), `${route} shown`);
  return c.d;
}
async function cleanup(c: Ctx) {
  await end(c.d);
  rmSync(c.base, { recursive: true, force: true });
}
const fx = (rel: string) => readFileSync(join(FX, 'trash-media', rel));
function pngToClipboard(path: string) {
  execFileSync('osascript', ['-e', `set the clipboard to (read (POSIX file "${path}") as «class PNGf»)`]);
}
/** The Search page's Go to list (⇧⌘F; D-760 replaced the ⌘O switcher), the title pasted (non-ASCII through the pasteboard), ⏎. */
function openNote(title: string) {
  osa('tell application "System Events" to keystroke "f" using {command down, shift down}');
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 300);
  paste(title);
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 300);
  press('enter');
}
function listAttachments(vault: string): string[] {
  const d = join(vault, '_attachments');
  return existsSync(d) ? readdirSync(d).map((n) => n.normalize('NFC')).sort() : [];
}

// ------------------------------------------------------------------------------------------------ FR-HIS-01

test('fr_his_01_ac1_move_to_trash_in_the_real_app', { timeout: 300_000 }, async () => {
  await ready();
  const c = fresh('his01ac1');
  try {
    await launch(c, `note/${P.ukol}`);
    const before = tree(c.vault);
    palette('Move to trash');
    const moved = await waitFile(join(c.vault, `.trash/${P.ukol}`), (t) => t !== null, 3000);
    assert.equal(moved, fx(P.ukol).toString('utf8'), 'the bytes untouched in .trash/');
    const after = tree(c.vault);
    assert.deepEqual(files(before, after), [`.trash/${P.ukol}`, P.ukol].sort(), 'one rename, nothing else written');
    assert.deepEqual((after as any)[`.trash/${P.ukol}`].ino, (before as any)[P.ukol].ino, 'the same file (inode)');
    assert.deepEqual((after as any)[`.trash/${P.ukol}`].mtimeMs, (before as any)[P.ukol].mtimeMs, 'mtime untouched');
    assert.ok(await waitMark(c.log, 'route-ready:inbox', 3000), 'no history: the app goes to the Inbox');
  } finally { await cleanup(c); }
});

test('fr_his_01_ac7_delete_permanently_moves_into_the_system_trash', { timeout: 300_000 }, async () => {
  await ready();
  const c = fresh('his01ac7');
  const sys = join(c.base, 'system-trash');
  mkdirSync(sys, { recursive: true });
  try {
    const d = await launch(c, 'trash', { TEGG_TEST_SYSTEM_TRASH: sys });
    const before = tree(c.vault);
    await (await need(d, 'Delete "Hotovo" permanently…')).click();
    assert.ok(await shown(d, 'Delete permanently?', 2000), 'the dialog');
    await (await need(d, 'Delete')).click();
    assert.ok(await waitFile(join(sys, 'Hotovo.md'), (t) => t !== null, 3000), 'moved into the (test) system trash');
    assert.deepEqual(files(before, tree(c.vault)), [P.t5], 'only the row left the vault');
  } finally { await cleanup(c); }
});

// ------------------------------------------------------------------------------------------------ FR-ATT-01

test('fr_att_01_ac1_paste_a_png_from_nspasteboard', { timeout: 300_000 }, async () => {
  await ready();
  const c = fresh('att01ac1');
  try {
    const d = await launch(c, `note/${P.plan}`);
    const before = tree(c.vault);
    await (await need(d, 'Záhon u plotu.')).click();
    press('right', ['command']);
    const png = join(c.base, 'schranka.png');
    writeFileSync(png, fx(P.png));
    pngToClipboard(png);
    press('v', ['command']);
    const att = await (async () => { for (let i = 0; i < 60; i++) { const a = listAttachments(c.vault).filter((n) => n.startsWith('Pasted image ')); if (a.length) return a; await sleep(50); } return []; })();
    assert.equal(att.length, 1, `one pasted file: ${att.join(', ')}`);
    assert.match(att[0], /^Pasted image 2026102210\d{4}\.png$/, 'Obsidian\'s name on the test clock');
    assert.ok(await waitMark(c.log, `media-ready:_attachments/${att[0]}`, 1000), 'the image shows within 1 s (media-ready)');
    const plan = await waitFile(join(c.vault, P.plan), (t) => !!t && t.includes(`![[${att[0]}]]`), 3000);
    assert.ok(plan?.includes(`Záhon u plotu.\n\n![[${att[0]}]]\n\n`), 'the paragraph after the caret\'s block');
    assert.deepEqual(readFileSync(join(c.vault, '_attachments', att[0])), fx(P.png), 'the clipboard bytes (PNG data unchanged)');
    assert.deepEqual(files(before, tree(c.vault)), [`_attachments/${att[0]}`, 'Images/Plán zahrady 1.md', P.plan].sort(), 'file, object, note; nothing else');
  } finally { await cleanup(c); }
});

test('fr_att_01_ac2_drop_files_through_the_drop_hook', { timeout: 300_000 }, async () => {
  await ready();
  const c = fresh('att01ac2');
  const desk = join(c.base, 'Plocha');
  mkdirSync(desk, { recursive: true });
  writeFileSync(join(desk, 'Záhon 2.PNG'), fx(P.png));
  writeFileSync(join(desk, 'Rozpočet 2026.pdf'), fx('_attachments/Rozpočet.pdf'));
  try {
    await launch(c, `note/${P.plan}`, { TEGG_TEST_DROP: `${join(desk, 'Záhon 2.PNG')}:${join(desk, 'Rozpočet 2026.pdf')}@600,760` }); // D-751: a point in the note's body (it starts below the title and properties)
    const plan = await waitFile(join(c.vault, P.plan), (t) => !!t && t.includes('![[Rozpočet 2026.pdf]]'), 5000);
    assert.ok(plan?.includes('![[Záhon 2.PNG]]\n\n![[Rozpočet 2026.pdf]]'), 'two paragraphs at the drop point, in drop order');
    assert.ok(existsSync(join(c.vault, 'Images/Záhon 2.md')) && existsSync(join(c.vault, 'PDFs/Rozpočet 2026.md')), 'the objects');
    assert.ok(existsSync(join(desk, 'Záhon 2.PNG')), 'the original is left where it was');
  } finally { await cleanup(c); }
});

test('fr_att_01_ac3_the_picker_through_the_pick_hook', { timeout: 300_000 }, async () => {
  await ready();
  const c = fresh('att01ac3');
  const pick = join(c.base, 'Záhon 2.PNG');
  writeFileSync(pick, fx(P.png));
  try {
    const d = await launch(c, `note/${P.plan}`, { TEGG_TEST_PICK_FILES: pick });
    await (await need(d, 'Záhon u plotu.')).click();
    press('a', ['shift', 'command']);
    const plan = await waitFile(join(c.vault, P.plan), (t) => !!t && t.includes('![[Záhon 2.PNG]]'), 5000);
    assert.ok(plan?.includes('![[Záhon 2.PNG]]'), '⇧⌘A: the picked file is added at the caret');
  } finally { await cleanup(c); }
});

test('fr_att_01_ac11_capture_window_saves_a_pasted_image', { timeout: 300_000 }, async () => {
  await ready();
  const c = fresh('att01ac11');
  try {
    const d = await launch(c, 'inbox');
    const before = tree(c.vault);
    hotkey('quick');
    assert.ok(await shown(d, 'Capture text', 3000), 'the capture window');
    typeAscii('Seminka na jaro');
    const png = join(c.base, 'schranka.png');
    writeFileSync(png, fx(P.png));
    pngToClipboard(png);
    press('v', ['command']);
    // The button is `Remove "<file name>"` (the L5 test matches /^Remove/ too).
    let removeShown = false;
    for (const endAt = Date.now() + 2000; !removeShown && Date.now() < endAt; await sleep(100)) {
      for (const e of await d.$$('-ios predicate string:label BEGINSWITH "Remove \\""').catch(() => [] as any[])) if (await e.isDisplayed().catch(() => false)) removeShown = true;
    }
    assert.ok(removeShown, 'a thumbnail with Remove');
    press('enter', ['command']);
    const note = await waitFile(join(c.vault, 'Quick Notes/Seminka na jaro.md'), (t) => !!t && /!\[\[Pasted image 2026102210\d{4}\.png\]\]\n$/.test(t), 5000);
    assert.ok(note, 'the captured note ends with the embed');
    const changed = files(before, tree(c.vault));
    assert.equal(changed.length, 3, `the pair and the note: ${changed.join(', ')}`);
    assert.ok(changed.includes('Images/Seminka na jaro 1.md'), 'R72 capture row');
  } finally { await cleanup(c); }
});

test('fr_att_01_ac12_the_real_media_scheme', { timeout: 300_000 }, async () => {
  await ready();
  const c = fresh('att01ac12');
  const net = new NetMonitor().start();
  try {
    await launch(c, `note/${P.plan}`);
    assert.ok(await waitMark(c.log, `media-ready:${P.png}`, 3000), 'the image loads through tegg-media:// (media-ready)');
    const r = net.stop();
    assert.deepEqual(r.sockets, [], 'no network (NFR-SEC-01)');
  } finally { net.stop(); await cleanup(c); }
});

test('fr_att_01_ac13_open_the_object_and_the_shell_calls', { timeout: 300_000 }, async () => {
  await ready();
  const c = fresh('att01ac13');
  const rec = join(c.base, 'reveal.txt');
  try {
    const d = await launch(c, `note/${P.plan}`, { TEGG_TEST_REVEAL: rec });
    assert.ok(await waitMark(c.log, `media-ready:${P.png}`, 3000), 'the image');
    const img = await need(d, 'Záhon');
    await img.doubleClick();
    assert.ok(await waitMark(c.log, `route-ready:note/${P.img}`, 3000), 'double-click opens note/Images/Záhon.md');
    await (await need(d, 'Open in Preview')).click();
    await (await need(d, 'Reveal in Finder')).click();
    const t = await waitFile(rec, (x) => !!x && x.includes('reveal '), 3000);
    assert.ok(t?.includes(`open ${P.png}`), 'media_open of the file');
    assert.ok(t?.includes(`reveal ${P.png}`), 'media_reveal of the file');
  } finally { await cleanup(c); }
});

// ------------------------------------------------------------------------------------------------ FR-NAV-04

test('fr_nav_04_ac6_sidebar_without_home_in_the_real_app', { timeout: 300_000 }, async () => {
  await ready();
  const c = fresh('nav04ac6');
  try {
    const d = await launch(c, 'inbox');
    await (await need(d, 'Trash')).click();
    assert.ok(await waitMark(c.log, 'route-ready:trash', 3000), 'the sidebar Trash entry opens the Trash');
    assert.equal(await shown(d, 'Home', 500), false, 'no Home entry');
    palette('Go to Home');
    await sleep(500);
    assert.ok(!marks(c.log).includes('route-ready:home'), 'no Go to Home');
  } finally { await cleanup(c); }
});

test('fr_nav_04_ac7_launch_lands_on_the_inbox', { timeout: 300_000 }, async () => {
  await ready();
  const base = tmp('6a-nav04ac7');
  const vault = tmCopy(base);
  const sup = support(base);
  const run = async (what: string, wantMark: string, extra: Env = {}) => {
    const log = join(base, `${what.replace(/\W/g, '_')}.jsonl`);
    const snap = tree(vault);
    const child = spawnApp(testEnv(sup, log, { TEGG_VAULT: vault, TEGG_NOW: NOW6A, ...extra }));
    const ok = await waitMark(log, wantMark);
    await sleep(1500);
    quitApp(child);
    await waitExit(child);
    assert.ok(ok, `${what}: expected ${wantMark}, got ${marks(log).filter((m) => m.startsWith('route-ready:')).join(', ')}`);
    assert.deepEqual(files(snap, tree(vault)), [], `${what}: no write`);
  };
  try {
    await run('no note opened', 'route-ready:inbox');
    await run('open Úkol', `route-ready:note/${P.ukol}`, { TEGG_ROUTE: `note/${P.ukol}` });
    mkdirSync(join(vault, '.trash/Tasks'), { recursive: true });
    renameSync(join(vault, P.ukol), join(vault, `.trash/${P.ukol}`));
    await run('the last note in .trash/', 'route-ready:inbox');
    const empty = join(base, 'Nový');
    cpSync(join(FX, 'new-empty/.tegg'), join(empty, '.tegg'), { recursive: true });
    const log = join(base, 'new.jsonl');
    const child = spawnApp(testEnv(support(base, { name: 'support-new' }), log, { TEGG_VAULT: empty, TEGG_NOW: NOW6A }));
    const ok = await waitMark(log, 'route-ready:inbox');
    quitApp(child);
    await waitExit(child);
    assert.ok(ok, 'a new vault opens on inbox');
  } finally { rmSync(base, { recursive: true, force: true }); }
});

// ------------------------------------------------------------------------------------------------ FR-SYN-06

test('fr_syn_06_ac29_a_browsing_tour_writes_nothing', { timeout: 600_000 }, async () => {
  await ready();
  const c = fresh('syn06ac29');
  try {
    const d = await launch(c, 'trash');
    const before = tree(c.vault);
    for (const t of ['Smazaný obrázek', 'Zahrada', 'osiřelý.jpg', 'Hotovo', 'Recepty', 'Stará poznámka']) {
      await (await need(d, t)).click();
      await sleep(600);
      press('lbracket', ['command']);
      await sleep(400);
    }
    for (const title of ['Záhon', 'Rozpočet', 'Plán zahrady', 'Odkazy']) {
      openNote(title);
      await sleep(800);
    }
    assert.ok(marks(c.log).some((m) => m.startsWith('media-ready:')), 'the media were shown');
    assert.deepEqual(files(before, tree(c.vault)), [], 'vault byte-identical, no rename');
  } finally { await cleanup(c); }
});

test('fr_syn_06_ac30_each_action_writes_only_its_files', { timeout: 600_000 }, async () => {
  await ready();
  const c = fresh('syn06ac30');
  const sys = join(c.base, 'system-trash');
  mkdirSync(sys, { recursive: true });
  try {
    const d = await launch(c, `note/${P.ukol}`, { TEGG_TEST_SYSTEM_TRASH: sys });
    const s0 = tree(c.vault);
    palette('Move to trash');
    await waitFile(join(c.vault, `.trash/${P.ukol}`), (t) => t !== null, 3000);
    assert.deepEqual(files(s0, tree(c.vault)), [`.trash/${P.ukol}`, P.ukol].sort(), 'Move to trash: exactly the object');
    palette('Go to Trash');
    assert.ok(await waitMark(c.log, 'route-ready:trash', 3000), 'trash');
    await (await need(d, 'Restore "Koupit semínka"')).click();
    await waitFile(join(c.vault, P.ukol), (t) => t !== null, 3000);
    assert.deepEqual(files(s0, tree(c.vault)), [], 'Restore: back byte-identical (rename)');
    const s1 = tree(c.vault);
    await (await need(d, 'Delete "Hotovo" permanently…')).click();
    await (await need(d, 'Delete')).click();
    await waitFile(join(sys, 'Hotovo.md'), (t) => t !== null, 3000);
    assert.deepEqual(files(s1, tree(c.vault)), [P.t5], 'Delete permanently: exactly the row\'s files');
    assert.equal(read(c.vault, P.plan), fx(P.plan).toString('utf8'), 'Plán untouched');
  } finally { await cleanup(c); }
});
