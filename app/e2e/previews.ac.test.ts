// v1.0 slice P real-app tests (L6, Appium mac2 on the built test app, D-382, TS-I7): docs/acceptance/previews.md
// FR-NAV-08 AC-2 (previews in the built app: click, Esc, ⌥Space, double-click, Back; bytes, mtime, inode unchanged, no
// socket), FR-SYN-06 AC-37 (a preview tour writes nothing, then one atomic `Remove link` writes exactly Pages/Odkazy.md),
// FR-SET-07 AC-2 L6 part (hover and 600 ms survive a relaunch and apply in another vault; the vault is untouched),
// FR-LNK-11 AC-4 L6 part (the popover size is restored after a relaunch), FR-LNK-11 AC-11 L6 once (one external edit of
// the previewed note shows within 2 s). TEGG_TEST=1 with TEGG_NOW, a temporary Application Support whose ui-state.json
// is written before launch (v1-previews §9), and a temporary copy of the synthetic previews fixture plus new-empty/.tegg
// and the README's runtime binaries (D-62). Interface: docs/contracts/v1-previews.md §1 (`ui-state.json` `preview`),
// §3.3 (the popover's names), §4 (Settings › Previews), §6 (palette commands); ms3-shell.md §1, §6 (TEGG_ROUTE,
// `route-ready:<route>`), §13.6 (helpers/external.ts). Written from the ACs and the contracts only (D-61). Keys go
// through helpers/osa.ts (D-758, D-799: only while Tegg is frontmost). Shared helpers: app/e2e/helpers/capture.ts.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFileSync, cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import {
  FX, MARK_TIMEOUT, NetMonitor, appiumDown, changedPaths, clickable, end, firstShown, marks, need, osa, palette, paste, press, read, ready,
  session, shown, sleep, support, testEnv, textContains, tmp, tree, waitFile, waitMark, type Driver, type Env,
} from './helpers/capture.ts';

after(appiumDown);
process.on('exit', appiumDown);

/** The slice P test clock (previews.md "Test clock"). */
const NOW_P = '2026-10-28T10:00:00+01:00';
const EXTERNAL = resolve(import.meta.dirname, 'helpers/external.ts');
const P = {
  odkazy: 'Pages/Odkazy.md', rozpocet: 'Pages/Rozpočet 2027.md', jana: 'Osoby/Jana Nováková.md', vlozeni: 'Pages/Vložení.md',
};
const UI = { version: 1, theme: 'light', sidebarOpen: true, rightPanel: { open: false, tab: 'backlinks' } };

// ---------------------------------------------------------------- setup helpers (no AC assertions)

/** A temp copy of tests/fixtures/vaults/previews (without README.md) plus new-empty/.tegg and the README's runtime
 *  binaries (`_attachments/graf.png`, `_attachments/Smlouva.pdf` from trash-media). */
function previewsCopy(base: string, name = 'Náhledy'): string {
  const v = join(base, name);
  const src = join(FX, 'previews');
  cpSync(src, v, { recursive: true, filter: (s) => relative(src, s) !== 'README.md' });
  cpSync(join(FX, 'new-empty/.tegg'), join(v, '.tegg'), { recursive: true });
  const att = join(FX, 'trash-media/_attachments');
  const pick = (n: string) => join(att, readdirSync(att).find((x) => x.normalize('NFC') === n.normalize('NFC'))!);
  mkdirSync(join(v, '_attachments'), { recursive: true });
  copyFileSync(pick('záhon.png'), join(v, '_attachments/graf.png'));
  copyFileSync(pick('Rozpočet.pdf'), join(v, '_attachments/Smlouva.pdf'));
  return v;
}
type Ctx = { base: string; vault: string; sup: string; log: string; d?: Driver };
function fresh(name: string, ui: Record<string, unknown> = {}): Ctx {
  const base = tmp(`p-${name}`);
  return { base, vault: previewsCopy(base), sup: support(base, { ui: { ...UI, ...ui } }), log: join(base, 'perf.jsonl') };
}
async function launch(c: Ctx, route: string, extra: Env = {}): Promise<Driver> {
  c.log = join(c.base, `perf-${Date.now()}.jsonl`); // one perf log per launch
  c.d = await session(testEnv(c.sup, c.log, { TEGG_VAULT: c.vault, TEGG_ROUTE: route, TEGG_NOW: NOW_P, ...extra }));
  assert.ok(await waitMark(c.log, `route-ready:${route}`, MARK_TIMEOUT), `${route} shown`);
  await sleep(500);
  return c.d;
}
async function cleanup(c: Ctx) {
  await end(c.d);
  rmSync(c.base, { recursive: true, force: true });
}
const uiStateOf = (sup: string): any => { try { return JSON.parse(readFileSync(join(sup, 'ui-state.json'), 'utf8')); } catch { return null; } };
const countMark = (log: string, m: string) => marks(log).filter((x) => x === m).length;
async function waitMarkCount(log: string, m: string, n: number, ms = MARK_TIMEOUT): Promise<boolean> {
  const endAt = Date.now() + ms;
  while (Date.now() < endAt) { if (countMark(log, m) >= n) return true; await sleep(50); }
  return false;
}
const tempFiles = (root: string) => Object.keys(tree(root)).filter((p) => p.includes('.tegg-tmp'));
const inode = (vault: string, rel: string) => lstatSync(join(vault, rel)).ino;
const noModified = (t: string | null) => (t ?? '').replace(/^modified: .*$/m, 'modified: <x>');
const ISO_MOD = /^modified: \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?[+-]\d{2}:\d{2}$/m;

/** The Search page's Go to list (⇧⌘F, D-760), the title pasted, ⏎. */
async function openNote(title: string) {
  osa('tell application "System Events" to key code 3 using {command down, shift down}');
  await sleep(500);
  paste(title);
  await sleep(700);
  press('enter');
  await sleep(1200);
}
function externalWrite(vault: string, rel: string, text: string) {
  const f = join(tmpdir(), `tegg-ext-p-${process.pid}-${Date.now()}.md`);
  writeFileSync(f, text);
  execFileSync(process.execPath, [EXTERNAL, 'write', join(vault, rel), f], { encoding: 'utf8' });
  rmSync(f, { force: true });
}

/** Every displayed element named `label` (label, title or value), in the order the accessibility tree gives. */
async function allShown(d: Driver, label: string): Promise<any[]> {
  const l = label.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const out: any[] = [];
  for (const e of await d.$$(`-ios predicate string:(label == "${l}" OR title == "${l}")`).catch(() => [] as any[])) {
    if (await e.isDisplayed().catch(() => false)) out.push(clickable(d, e));
  }
  return out;
}
/** The shown elements labelled `label`, one per text line (a chip and the text inside it share a line), top to bottom. */
async function shownLines(d: Driver, label: string): Promise<any[]> {
  const rows: { y: number; e: any }[] = [];
  for (const e of await allShown(d, label)) {
    const r = await d.getElementRect(e.elementId);
    const y = r.y + r.height / 2;
    if (!rows.some((o) => Math.abs(o.y - y) < 8)) rows.push({ y, e });
  }
  return rows.sort((a, b) => a.y - b.y).map((o) => o.e);
}
/** The first of `labels` that is shown. */
async function needAny(d: Driver, labels: string[], ms = 3000): Promise<any> {
  const endAt = Date.now() + ms;
  while (Date.now() < endAt) {
    for (const l of labels) { const e = await firstShown(d, l); if (e) return clickable(d, e); }
    await sleep(100);
  }
  assert.fail(`one of ${JSON.stringify(labels)} is shown`);
}
/** A preview dialog is shown (`Preview: <title>`; any title when `title` is null). */
async function previewShown(d: Driver, title: string | null, ms = 3000): Promise<boolean> {
  if (title !== null) return shown(d, `Preview: ${title}`, ms);
  const endAt = Date.now() + ms;
  while (Date.now() < endAt) {
    for (const e of await d.$$('-ios predicate string:label BEGINSWITH "Preview: "').catch(() => [] as any[])) if (await e.isDisplayed().catch(() => false)) return true;
    await sleep(100);
  }
  return false;
}
async function noPreview(d: Driver, ms = 2000): Promise<boolean> {
  const endAt = Date.now() + ms;
  while (Date.now() < endAt) {
    if (!(await previewShown(d, null, 150))) return true;
    await sleep(100);
  }
  return false;
}
async function scrollIn(d: Driver, e: any) {
  const r = await d.getElementRect(e.elementId);
  await d.execute('macos: scroll', { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), deltaX: 0, deltaY: -240 }).catch(() => {});
  await sleep(150);
}
/** Clicks `el`, asserts the preview, scrolls its body, closes it with Esc. */
async function previewAndClose(d: Driver, el: any, title: string | null, what: string) {
  await el.click();
  assert.ok(await previewShown(d, title, 3000), `${what}: the preview ${title === null ? '' : `"Preview: ${title}"`} is shown`);
  const dlg = title !== null ? await firstShown(d, `Preview: ${title}`) : null;
  if (dlg) await scrollIn(d, dlg);
  press('escape');
  assert.ok(await noPreview(d), `${what}: Esc closes the preview`);
}
/** The slider (XCUIElementTypeSlider, 33) named `label`: its visible label is a static text with the same text. */
async function needSlider(d: Driver, label: string, ms = 3000): Promise<any> {
  const endAt = Date.now() + ms;
  while (true) {
    for (const e of await d.$$(`-ios predicate string:elementType == 33 AND (label == "${label}" OR title == "${label}")`).catch(() => [] as any[])) {
      if (await e.isDisplayed().catch(() => false)) return e;
    }
    if (Date.now() > endAt) break;
    await sleep(100);
  }
  assert.fail(`the slider "${label}" is shown`);
}
function radioOn(v: unknown): boolean {
  return String(v) === '1' || String(v).toLowerCase() === 'true';
}

// ------------------------------------------------------------------------------------------------ FR-NAV-08 AC-2

test('fr_nav_08_ac2_previews_in_the_built_app_write_nothing_and_open_no_socket', { timeout: 300_000 }, async () => {
  await ready();
  const c = fresh('nav08ac2');
  const before = tree(c.vault);
  const net = new NetMonitor().start();
  try {
    const d = await launch(c, `note/${P.odkazy}`);
    await (await need(d, 'Rozpočet 2027', 5000)).click();
    assert.ok(await previewShown(d, 'Rozpočet 2027'), 'a click on Rozpočet 2027 shows the dialog "Preview: Rozpočet 2027"');
    assert.ok((await d.$$(`-ios predicate string:${textContains('Návrh rozpočtu na rok 2027 pro celý tým.')}`)).length > 0, 'with the text "Návrh rozpočtu na rok 2027 pro celý tým."');
    press('escape');
    assert.ok(await noPreview(d), 'Esc closes it');
    // ⌥Space with the caret after Projekt Alfa (a click leaves the caret after the chip, D-926; Esc closes that preview).
    await (await need(d, 'Projekt Alfa')).click();
    assert.ok(await previewShown(d, 'Projekt Alfa'), 'the click on Projekt Alfa previews');
    press('escape');
    assert.ok(await noPreview(d), 'closed again');
    press('space', ['option']);
    assert.ok(await previewShown(d, 'Projekt Alfa'), '⌥Space with the caret after Projekt Alfa shows "Preview: Projekt Alfa"');
    press('escape');
    assert.ok(await noPreview(d), 'closed');
    // A double-click on Jana Nováková opens Jana's page; Back returns to Odkazy.
    const odkazyReady = countMark(c.log, `route-ready:note/${P.odkazy}`);
    await (await need(d, 'Jana Nováková')).doubleClick();
    assert.ok(await waitMark(c.log, `route-ready:note/${P.jana}`, 5000), 'a double-click on Jana Nováková opens Jana\'s page');
    assert.ok(await noPreview(d, 1000), 'no popover left after the double-click');
    press('lbracket', ['command']);
    assert.ok(await waitMarkCount(c.log, `route-ready:note/${P.odkazy}`, odkazyReady + 1, 5000), 'Back returns to Odkazy');
    await sleep(500);
    assert.deepEqual(changedPaths(before, tree(c.vault)), [], 'every vault file keeps its bytes, mtime and inode; no file created');
    const r = net.stop();
    assert.deepEqual(r.sockets, [], 'no socket other than local IPC (NFR-SEC-01)');
  } finally { net.stop(); await cleanup(c); }
});

// ------------------------------------------------------------------------------------------------ FR-SYN-06 AC-37

test('fr_syn_06_ac37_a_preview_tour_writes_nothing_then_remove_link_writes_odkazy_atomically', { timeout: 900_000 }, async () => {
  await ready();
  const c = fresh('syn06ac37');
  const before = tree(c.vault);
  try {
    const d = await launch(c, `note/${P.odkazy}`);
    // Every resolved link of Odkazy, by click (a section, block or missing-heading chip may show its heading).
    const chips: [string[], string | null, number][] = [
      [['Rozpočet 2027'], 'Rozpočet 2027', 0], [['rozpočet'], 'Rozpočet 2027', 0],
      [['Rozpočet 2027 › Rozsah', 'Rozpočet 2027#Rozsah', 'Rozsah'], null, 0], [['Rozpočet 2027'], 'Rozpočet 2027', -1], // the block-link chip shows the title only (no `^id`): the second line with it
      [['Rozpočet 2027 › Neexistující nadpis', 'Rozpočet 2027#Neexistující nadpis', 'Neexistující nadpis'], null, 0],
      [['Jana Nováková'], 'Jana Nováková', 0], [['Petr Dvořák'], 'Petr Dvořák', 0], [['Projekt Alfa'], 'Projekt Alfa', 0],
      [['Zavolat Janě'], 'Zavolat Janě', 0], [['2026-10-07'], '2026-10-07', 0], [['2026-10-30'], '2026-10-30', 0],
      [['#účty', 'účty'], '#Účty', 0], [['#nápad', 'nápad'], '#nápad', 0], [['Účty'], '#Účty', 0],
      [['Graf'], 'Graf', 0], [['graf.png'], 'Graf', 0], [['Smlouva'], 'Smlouva', 0], [['Plán'], 'Plán', 0], [['Plán'], 'Plán', 1],
      [['Prázdná'], 'Prázdná', 0], [['Neplatná hlavička'], 'Neplatná hlavička', 0], [['Kruh A'], 'Kruh A', 0],
      [['odkaz na rozpočet'], 'Rozpočet 2027', 0], [['Nápad na podcast'], 'Nápad na podcast', 0], [['Mapa'], 'Mapa', 0],
    ];
    for (const [labels, title, n] of chips) {
      let el: any;
      if (n === 0) el = await needAny(d, labels);
      else if (n === -1) {
        // `Hlavní [[Rozpočet 2027]].` is the first line that shows this title, `Blok [[Rozpočet 2027#^otazka1]].` the second.
        const lines = await shownLines(d, labels[0]);
        assert.ok(lines.length >= 2, `${labels[0]}: a second line shows it (the block-link chip): ${lines.length}`);
        el = lines[1];
      }
      else { const all = await allShown(d, labels[0]); assert.ok(all.length > n, `${labels[0]}: instance ${n + 1} is shown`); el = all[n]; }
      await previewAndClose(d, el, title, `click on ${labels[0]}`);
    }
    // ⌥Space at a chip.
    await (await need(d, 'Projekt Alfa')).click();
    press('escape');
    await sleep(200);
    press('space', ['option']);
    assert.ok(await previewShown(d, 'Projekt Alfa'), '⌥Space at Projekt Alfa');
    press('escape');
    // Follow a link inside a preview and Back; resize the popover.
    await (await need(d, 'Rozpočet 2027')).click();
    const dlg = await need(d, 'Preview: Rozpočet 2027');
    const inner = (await dlg.$$('-ios predicate string:label == "Jana Nováková" OR title == "Jana Nováková"').catch(() => [] as any[]))[0];
    assert.ok(inner, 'the chip Jana Nováková inside the preview');
    await clickable(d, inner).click();
    assert.ok(await previewShown(d, 'Jana Nováková'), 'a click on a link inside the preview replaces it (AP-814)');
    await (await need(d, 'Back to Rozpočet 2027')).click();
    assert.ok(await previewShown(d, 'Rozpočet 2027'), 'Back restores Rozpočet\'s preview');
    await (await need(d, 'Resize preview')).click();
    press('right'); press('right'); press('down');
    await sleep(300);
    press('escape');
    assert.ok(await noPreview(d), 'closed');
    // Hover mode with the pointer, then Off, then Click to preview again (three mode switches).
    palette('Object preview: Hover to preview');
    await sleep(800);
    const petr = await need(d, 'Petr Dvořák');
    const pr = await d.getElementRect(petr.elementId);
    await d.execute('macos: hover', { x: Math.round(pr.x + pr.width / 2), y: Math.round(pr.y + pr.height / 2) });
    assert.ok(await previewShown(d, 'Petr Dvořák', 3000), 'hover mode: resting the pointer on Petr Dvořák previews it');
    await d.execute('macos: hover', { x: Math.round(pr.x + pr.width / 2), y: Math.max(5, Math.round(pr.y - 200)) });
    await sleep(800);
    palette('Object preview: Off');
    await sleep(500);
    palette('Object preview: Click to preview');
    await sleep(500);
    // Every embed of Vložení.
    await openNote('Vložení');
    assert.ok(await waitMark(c.log, `route-ready:note/${P.vlozeni}`, 5000), 'Vložení shown');
    // D-1166: a click on an embed opens it, so the tour previews them on request: ⌥Space with the embed selected as a
    // block (↓ from the paragraph above walks the blocks, embeds.md FR-EMB-02 AC-14), and the Link menu's Show preview.
    await (await need(d, 'Před vloženími.')).click();
    press('end');
    for (const [title, what] of [['Rozpočet 2027', 'the full embed'], ['Jana Nováková', 'the card embed of Jana'], [null, 'the section embed']] as const) {
      press('down');
      if (title === null) press('down'); // past Petr's link-mode embed
      await sleep(200);
      press('space', ['option']);
      assert.ok(await previewShown(d, title, 3000), `${what}: ⌥Space on the selected embed previews it`);
      press('escape');
      assert.ok(await noPreview(d), `${what}: Esc closes the preview`);
    }
    await d.execute('macos: rightClick', { elementId: (await need(d, 'Petr Dvořák')).elementId });
    await (await need(d, 'Show preview')).click();
    assert.ok(await previewShown(d, 'Petr Dvořák', 3000), 'the link-mode embed of Petr: the Link menu\'s Show preview');
    press('escape');
    assert.ok(await noPreview(d), 'Petr: Esc closes the preview');
    await (await needAny(d, ['Graf', 'graf.png'])).click();
    await sleep(200);
    press('space', ['option']);
    assert.ok(await previewShown(d, 'Graf'), '⌥Space on the selected figure previews Graf (D-938)');
    press('escape');
    // The source chip of Úkol on `tasks`.
    palette('Go to Tasks');
    assert.ok(await waitMark(c.log, 'route-ready:tasks', 5000), 'tasks shown');
    await previewAndClose(d, await need(d, 'Porada 2026-10-27', 5000), 'Porada 2026-10-27', 'the source chip');
    // The backlinks of Rozpočet.
    await openNote('Rozpočet 2027');
    assert.ok(await waitMark(c.log, `route-ready:note/${P.rozpocet}`, 5000), 'Rozpočet shown');
    osa('tell application "System Events" to key code 42 using {command down}'); // ⌘\ the Context panel
    await sleep(800);
    for (const src of ['Odkazy', 'Projekt Alfa', '2026-10-07', 'Neplatná hlavička', 'Vložení', 'Mapa']) {
      const all = await allShown(d, src);
      assert.ok(all.length > 0, `backlink chip ${src}`);
      await previewAndClose(d, all[all.length - 1], src, `backlink ${src}`);
    }
    osa('tell application "System Events" to key code 42 using {command down}');
    await sleep(400);
    // A search result.
    osa('tell application "System Events" to key code 3 using {command down, shift down}');
    await sleep(500);
    paste('rozpočet');
    await sleep(1200);
    const snippet = (await d.$$(`-ios predicate string:${textContains('Návrh rozpočtu')}`).catch(() => [] as any[]))[0];
    assert.ok(snippet, 'the full-text result Rozpočet 2027 (its snippet)');
    await previewAndClose(d, clickable(d, snippet), 'Rozpočet 2027', 'a search result row');
    // A type-page row.
    palette('Go to type: Osoby');
    assert.ok(await waitMark(c.log, 'route-ready:type/osoba', 5000), 'type/osoba shown');
    await previewAndClose(d, await need(d, 'Petr Dvořák'), 'Petr Dvořák', 'a type-page row');
    // Daily 2026-10-30: its preview and Open.
    await openNote('Odkazy');
    await sleep(500);
    await (await need(d, '2026-10-30')).click();
    assert.ok(await previewShown(d, '2026-10-30'), 'the preview of the day without a note');
    await (await need(d, 'Open 2026-10-30')).click();
    assert.ok(await waitMark(c.log, 'route-ready:daily/2026-10-30', 5000), 'Open opens daily/2026-10-30');
    await sleep(800);
    const afterTour = tree(c.vault);
    assert.deepEqual(changedPaths(before, afterTour), [], 'the tour leaves every vault file\'s bytes, mtime and inode unchanged and creates nothing');
    assert.equal(existsSync(join(c.vault, 'Daily/2026-10-30.md')), false, 'no Daily/2026-10-30.md');
    assert.equal(existsSync(join(c.vault, 'Tags/nápad.md')), false, 'no Tags/nápad.md');
    // Then one Remove link on [[Projekt Alfa]] in Odkazy.
    const orig = read(c.vault, P.odkazy)!;
    const ino0 = inode(c.vault, P.odkazy);
    await openNote('Odkazy');
    await sleep(500);
    await (await need(d, 'Projekt Alfa')).click();
    press('escape');
    await sleep(200);
    palette('Remove link');
    const t = await waitFile(join(c.vault, P.odkazy), (x) => !!x && x !== orig, 5000);
    assert.ok(t && t !== orig, 'Odkazy is written');
    await sleep(1500);
    const final = read(c.vault, P.odkazy);
    assert.equal(noModified(final), noModified(orig.replace('Projekt [[Projekt Alfa]].', 'Projekt Projekt Alfa.')), 'only that line and modified changed');
    assert.match(final ?? '', ISO_MOD, 'modified is ISO 8601 with offset');
    assert.notEqual(inode(c.vault, P.odkazy), ino0, 'written atomically: temp file + rename (a new inode)');
    assert.deepEqual(tempFiles(c.vault), [], 'no .tegg-tmp file left in Pages/');
    assert.deepEqual(changedPaths(afterTour, tree(c.vault)), [P.odkazy], 'exactly Pages/Odkazy.md is written');
  } finally { await cleanup(c); }
});

// ------------------------------------------------------------------------------------------------ FR-SET-07 AC-2 (L6)

test('fr_set_07_ac2_hover_and_600_ms_survive_a_relaunch_and_apply_in_another_vault', { timeout: 400_000 }, async () => {
  await ready();
  // D-1192: the delay is stored at 400 ms first (click mode as D-1164's test rule), so the two steps reach 600.
  const c = fresh('set07ac2', { preview: { mode: 'click', hoverDelay: 400 } });
  const before = tree(c.vault);
  const other = previewsCopy(c.base, 'Druhý trezor');
  try {
    let d = await launch(c, 'settings/previews');
    await (await need(d, 'Hover to preview, click to open', 5000)).click();
    await sleep(300);
    press('tab'); // the slider follows the radiogroup
    press('right'); press('right');
    const st = await waitFile(join(c.sup, 'ui-state.json'), (x) => { try { const p = JSON.parse(x ?? '').preview; return p?.mode === 'hover' && p?.hoverDelay === 600; } catch { return false; } }, 3000);
    assert.ok(st, `ui-state.json holds preview.mode = hover and preview.hoverDelay = 600: ${JSON.stringify(uiStateOf(c.sup)?.preview)}`);
    await end(d); c.d = undefined;
    assert.deepEqual(changedPaths(before, tree(c.vault)), [], 'the vault (every file and .tegg/) is byte-identical; no file created');
    // Relaunch: the same mode and delay.
    d = await launch(c, 'settings/previews');
    const hover = await need(d, 'Hover to preview, click to open', 5000);
    assert.ok(radioOn(await hover.getAttribute('value')), 'after a relaunch Hover to preview is checked');
    const sl = await needSlider(d, 'Hover delay');
    assert.match(String(await sl.getAttribute('value')), /600/, 'after a relaunch the delay is 600 ms');
    await end(d); c.d = undefined;
    // Another vault in the same app (same Application Support).
    d = await launch({ ...c, vault: other } as Ctx, 'settings/previews');
    c.d = d;
    assert.ok(radioOn(await (await need(d, 'Hover to preview, click to open', 5000)).getAttribute('value')), 'the other vault: Hover to preview');
    assert.match(String(await (await needSlider(d, 'Hover delay')).getAttribute('value')), /600/, 'the other vault: 600 ms');
    assert.deepEqual(changedPaths(before, tree(c.vault)), [], 'the first vault is still untouched');
    const p = uiStateOf(c.sup)?.preview;
    assert.deepEqual({ mode: p?.mode, hoverDelay: p?.hoverDelay }, { mode: 'hover', hoverDelay: 600 }, 'still stored machine-local');
  } finally { await cleanup(c); }
});

// ------------------------------------------------------------------------------------------------ FR-LNK-11 AC-4 (L6)

test('fr_lnk_11_ac4_the_popover_size_is_restored_after_a_relaunch', { timeout: 300_000 }, async () => {
  await ready();
  const c = fresh('lnk11ac4');
  const before = tree(c.vault);
  try {
    let d = await launch(c, `note/${P.odkazy}`);
    await (await need(d, 'Rozpočet 2027', 5000)).click();
    const dlg = await need(d, 'Preview: Rozpočet 2027');
    const r0 = await d.getElementRect(dlg.elementId);
    assert.ok(Math.abs(r0.width - 380) <= 2, `default width 380 px (got ${r0.width})`);
    await (await need(d, 'Resize preview')).click();
    press('right'); press('right'); press('down');
    const want = { width: 412, height: Math.round(r0.height) + 16 };
    const st = await waitFile(join(c.sup, 'ui-state.json'), (x) => { try { const p = JSON.parse(x ?? '').preview; return p?.width === want.width && Math.abs((p?.height ?? 0) - want.height) <= 1; } catch { return false; } }, 3000);
    assert.ok(st, `ui-state.json holds preview.width ${want.width} and preview.height ${want.height}: ${JSON.stringify(uiStateOf(c.sup)?.preview)}`);
    await end(d); c.d = undefined;
    d = await launch(c, `note/${P.odkazy}`);
    await (await need(d, 'Rozpočet 2027', 5000)).click();
    const r1 = await d.getElementRect((await need(d, 'Preview: Rozpočet 2027')).elementId);
    assert.ok(Math.abs(r1.width - want.width) <= 2 && Math.abs(r1.height - want.height) <= 2, `after a relaunch the popover is ${want.width} × ${want.height} (got ${r1.width} × ${r1.height})`);
    assert.deepEqual(changedPaths(before, tree(c.vault)), [], 'resizing writes nothing to the vault');
  } finally { await cleanup(c); }
});

// ------------------------------------------------------------------------------------------------ FR-LNK-11 AC-11 (L6 once)

test('fr_lnk_11_ac11_an_external_edit_shows_in_the_open_preview_within_2_s', { timeout: 300_000 }, async () => {
  await ready();
  const c = fresh('lnk11ac11');
  try {
    const d = await launch(c, `note/${P.odkazy}`);
    await (await need(d, 'Rozpočet 2027', 5000)).click();
    assert.ok(await previewShown(d, 'Rozpočet 2027'), 'Preview: Rozpočet 2027 is open');
    const before = tree(c.vault);
    const text = read(c.vault, P.rozpocet)!;
    const next = `${text}\nNový odstavec.\n`;
    const t0 = Date.now();
    externalWrite(c.vault, P.rozpocet, next);
    let seenAt: number | null = null;
    while (Date.now() - t0 < 4000) {
      if ((await d.$$(`-ios predicate string:${textContains('Nový odstavec.')}`).catch(() => [] as any[])).length > 0) { seenAt = Date.now(); break; }
      await sleep(50);
    }
    assert.ok(seenAt !== null && seenAt - t0 <= 2000, `"Nový odstavec." shows in the preview within 2 s (${seenAt === null ? 'never' : `${seenAt - t0} ms`})`);
    assert.ok(await previewShown(d, 'Rozpočet 2027', 500), 'the preview stays open');
    await sleep(1000);
    assert.deepEqual(changedPaths(before, tree(c.vault)), [P.rozpocet], 'only the external edit changed a file');
    assert.equal(read(c.vault, P.rozpocet), next, 'Tegg wrote nothing (the bytes are the external program\'s)');
  } finally { await cleanup(c); }
});
