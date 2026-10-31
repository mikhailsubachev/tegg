// v0.94 feedback real-app tests (L6, Appium mac2 on the built test app, D-382, TS-I7): docs/acceptance/previews.md part
// three, FR-LNK-12 AC-19 L6 once (with a temporary Application Support and no `ui-state.json`, the first click on Rozpočet
// 2027 in Odkazy opens it; `ui-state.json`, once written for other reasons, has no `preview.mode`), FR-LNK-12 AC-20 L6
// (each stored `preview` value survives a relaunch with its bytes unchanged), FR-SYN-06 AC-42 L6 once (FR-SYN-06 AC-37's
// tour once more with no `ui-state.json`, hover by default, with clicks inside previews and on embeds: every vault file's
// bytes, mtime and inode unchanged). TEGG_TEST=1 with TEGG_NOW, a temporary Application Support (no `ui-state.json` where
// the criterion says "nothing stored", D-1164's test rule) and a temporary copy of the synthetic previews fixture plus
// new-empty/.tegg and the README's runtime binaries (D-62). Interface: docs/contracts/v1-previews.md §1 (`ui-state.json`
// `preview`), §3.3, §4, §6; ms3-shell.md §1, §6 (TEGG_ROUTE, `route-ready:<route>`). Written from the ACs and the
// contracts only (D-61). Keys go through helpers/osa.ts (D-758, D-799: only while Tegg is frontmost).
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import {
  FX, MARK_TIMEOUT, appiumDown, changedPaths, clickable, end, firstShown, marks, need, osa, palette, paste, press, ready, session, shown, sleep,
  testEnv, textContains, tmp, tree, waitMark, type Driver, type Env,
} from './helpers/capture.ts';

after(appiumDown);
process.on('exit', appiumDown);

const NOW_P = '2026-10-28T10:00:00+01:00';
const P = { odkazy: 'Pages/Odkazy.md', rozpocet: 'Pages/Rozpočet 2027.md', jana: 'Osoby/Jana Nováková.md', petr: 'Osoby/Petr Dvořák.md', vlozeni: 'Pages/Vložení.md' };
const UI = { version: 1, theme: 'light', sidebarOpen: true, rightPanel: { open: false, tab: 'backlinks' } };

/** A temp copy of tests/fixtures/vaults/previews (without README.md) plus new-empty/.tegg and the runtime binaries. */
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
/** `ui`: the `ui-state.json` to write before launch; `null`: none (a new Application Support, "nothing stored"). */
function fresh(name: string, ui: Record<string, unknown> | null): Ctx {
  const base = tmp(`v094-${name}`);
  const sup = join(base, 'support');
  mkdirSync(sup, { recursive: true });
  if (ui) writeFileSync(join(sup, 'ui-state.json'), JSON.stringify(ui));
  return { base, vault: previewsCopy(base), sup, log: join(base, 'perf.jsonl') };
}
async function launch(c: Ctx, route: string, extra: Env = {}): Promise<Driver> {
  c.log = join(c.base, `perf-${Date.now()}.jsonl`);
  c.d = await session(testEnv(c.sup, c.log, { TEGG_VAULT: c.vault, TEGG_ROUTE: route, TEGG_NOW: NOW_P, ...extra }));
  assert.ok(await waitMark(c.log, `route-ready:${route}`, MARK_TIMEOUT), `${route} shown`);
  await sleep(500);
  return c.d;
}
async function cleanup(c: Ctx) {
  await end(c.d);
  rmSync(c.base, { recursive: true, force: true });
}
const uiText = (sup: string) => (existsSync(join(sup, 'ui-state.json')) ? readFileSync(join(sup, 'ui-state.json'), 'utf8') : null);
const uiState = (sup: string): any => { try { return JSON.parse(uiText(sup) ?? ''); } catch { return null; } };
const countMark = (log: string, m: string) => marks(log).filter((x) => x === m).length;
async function waitMarkCount(log: string, m: string, n: number, ms = MARK_TIMEOUT): Promise<boolean> {
  const endAt = Date.now() + ms;
  while (Date.now() < endAt) { if (countMark(log, m) >= n) return true; await sleep(50); }
  return false;
}
/** A preview dialog is shown (`Preview: <title>`; any title when null). */
async function previewShown(d: Driver, title: string | null, ms = 3000): Promise<boolean> {
  if (title !== null) return shown(d, `Preview: ${title}`, ms);
  const endAt = Date.now() + ms;
  while (Date.now() < endAt) {
    for (const e of await d.$$('-ios predicate string:label BEGINSWITH "Preview: "').catch(() => [] as any[])) if (await e.isDisplayed().catch(() => false)) return true;
    await sleep(100);
  }
  return false;
}
async function hoverEl(d: Driver, e: any) {
  const r = await d.getElementRect(e.elementId);
  await d.execute('macos: hover', { x: Math.round(r.x + Math.min(8, r.width / 2)), y: Math.round(r.y + r.height / 2) });
}
async function hoverAway(d: Driver, e: any) {
  const r = await d.getElementRect(e.elementId);
  await d.execute('macos: hover', { x: Math.round(r.x + r.width / 2), y: Math.max(5, Math.round(r.y - 220)) });
  await sleep(700);
}
/** The Search page's Go to list (⇧⌘F, D-760), the title pasted, ⏎. */
async function openNote(title: string) {
  osa('tell application "System Events" to key code 3 using {command down, shift down}');
  await sleep(500);
  paste(title);
  await sleep(700);
  press('enter');
  await sleep(1200);
}
function radioOn(v: unknown): boolean {
  return String(v) === '1' || String(v).toLowerCase() === 'true';
}

// ------------------------------------------------------------------------------------------------ FR-LNK-12 AC-19 (L6 once)

test('fr_lnk_12_ac19_hover_is_the_default_in_a_new_application_support', { timeout: 300_000 }, async () => {
  await ready();
  const c = fresh('lnk12ac19', null);
  const before = tree(c.vault);
  try {
    const d = await launch(c, `note/${P.odkazy}`);
    const chip = await need(d, 'Rozpočet 2027', 5000);
    await chip.click();
    assert.ok(await waitMark(c.log, `route-ready:note/${P.rozpocet}`, 5000), 'with no ui-state.json the first click on Rozpočet 2027 opens it (hover is the default, D-1164)');
    assert.equal(await previewShown(d, null, 800), false, 'no popover after the click');
    // ui-state.json, once written for other reasons (the Context panel toggled), has no preview.mode.
    osa('tell application "System Events" to key code 42 using {command down}'); // ⌘\ the Context panel
    await sleep(1500);
    const st = uiState(c.sup);
    assert.ok(st, 'ui-state.json is written once the panel is toggled');
    assert.equal(st?.preview?.mode, undefined, `ui-state.json has no preview.mode (${JSON.stringify(st?.preview)})`);
    assert.deepEqual(changedPaths(before, tree(c.vault)), [], 'the vault is untouched');
  } finally { await cleanup(c); }
});

// ------------------------------------------------------------------------------------------------ FR-LNK-12 AC-20 (L6)

const STORED: { name: string; preview: Record<string, unknown>; checked: string }[] = [
  { name: 'click', preview: { mode: 'click' }, checked: 'Click to preview, double-click to open' },
  { name: 'off', preview: { mode: 'off' }, checked: 'Off: click opens' },
  { name: 'hover_400', preview: { mode: 'hover', hoverDelay: 400 }, checked: 'Hover to preview, click to open' },
  { name: 'delay_600', preview: { hoverDelay: 600 }, checked: 'Hover to preview, click to open' },
  { name: 'hover_only', preview: { mode: 'hover' }, checked: 'Hover to preview, click to open' },
  { name: 'size_only', preview: { width: 500, height: 300 }, checked: 'Hover to preview, click to open' },
];

test('fr_lnk_12_ac20_a_stored_value_stays_after_a_relaunch', { timeout: 900_000 }, async () => {
  await ready();
  for (const s of STORED) {
    const c = fresh(`lnk12ac20-${s.name}`, { ...UI, preview: s.preview });
    const bytes0 = JSON.stringify(uiState(c.sup)?.preview);
    try {
      for (const run of ['launch', 'relaunch']) {
        const d = await launch(c, 'settings/previews');
        const r = await need(d, s.checked, 5000);
        assert.ok(radioOn(await r.getAttribute('value')), `${s.name} (${run}): ${JSON.stringify(s.preview)} reads as ${s.checked}`);
        await end(d); c.d = undefined;
        await sleep(500);
        assert.equal(JSON.stringify(uiState(c.sup)?.preview), bytes0, `${s.name} (${run}): ui-state.json's preview is unchanged (no migration)`);
      }
    } finally { await cleanup(c); }
  }
});

// ------------------------------------------------------------------------------------------------ FR-SYN-06 AC-42 (L6 once)

test('fr_syn_06_ac42_the_tour_with_no_ui_state_json_writes_nothing', { timeout: 900_000 }, async () => {
  await ready();
  const c = fresh('syn06ac42', null);
  const before = tree(c.vault);
  try {
    const d = await launch(c, `note/${P.odkazy}`);
    // Hover on links of Odkazy (the default, 1,000 ms): each previews.
    for (const label of ['Rozpočet 2027', 'Jana Nováková', 'Petr Dvořák', 'Projekt Alfa', 'Zavolat Janě', 'Prázdná', 'Kruh A']) {
      const e = await need(d, label, 5000);
      await hoverEl(d, e);
      assert.ok(await previewShown(d, label, 3000), `hovering ${label} previews it`);
      await hoverAway(d, e);
    }
    // Follow a link inside a preview by hovering, then Back to Rozpočet 2027.
    const roz = await need(d, 'Rozpočet 2027');
    await hoverEl(d, roz);
    assert.ok(await previewShown(d, 'Rozpočet 2027'), 'Preview: Rozpočet 2027');
    const dlg = await need(d, 'Preview: Rozpočet 2027');
    const inner = (await dlg.$$('-ios predicate string:label == "Jana Nováková" OR title == "Jana Nováková"').catch(() => [] as any[]))[0];
    assert.ok(inner, 'the chip Jana Nováková inside the preview');
    await hoverEl(d, clickable(d, inner));
    assert.ok(await previewShown(d, 'Jana Nováková', 3000), 'hovering the link inside replaces the content (D-1170)');
    await (await need(d, 'Back to Rozpočet 2027')).click();
    assert.ok(await previewShown(d, 'Rozpočet 2027'), 'Back restores Rozpočet');
    // A click inside the preview's body opens Rozpočet (D-1165); Back.
    const odkazyReady = countMark(c.log, `route-ready:note/${P.odkazy}`);
    const body = (await d.$$(`-ios predicate string:${textContains('Návrh rozpočtu na rok 2027 pro celý tým.')}`).catch(() => [] as any[]))[0];
    assert.ok(body, 'the body text inside the preview');
    await clickable(d, body).click();
    assert.ok(await waitMark(c.log, `route-ready:note/${P.rozpocet}`, 5000), 'a click inside the preview opens Rozpočet');
    press('lbracket', ['command']);
    assert.ok(await waitMarkCount(c.log, `route-ready:note/${P.odkazy}`, odkazyReady + 1, 5000), 'Back to Odkazy');
    await sleep(500);
    // Embeds of Vložení: a click opens each (D-1166); Back.
    await openNote('Vložení');
    assert.ok(await waitMark(c.log, `route-ready:note/${P.vlozeni}`, 5000), 'Vložení shown');
    for (const [label, path] of [['Jana Nováková', P.jana], ['Petr Dvořák', P.petr], ['Rozpočet 2027', P.rozpocet]] as const) {
      const n = countMark(c.log, `route-ready:note/${path}`);
      const vReady = countMark(c.log, `route-ready:note/${P.vlozeni}`);
      await (await need(d, label, 5000)).click();
      assert.ok(await waitMarkCount(c.log, `route-ready:note/${path}`, n + 1, 5000), `a click on the embed ${label} opens it`);
      press('lbracket', ['command']);
      assert.ok(await waitMarkCount(c.log, `route-ready:note/${P.vlozeni}`, vReady + 1, 5000), 'Back to Vložení');
      await sleep(500);
    }
    // ⌥Space on the selected figure still previews (D-938), then Esc.
    const fig = await firstShown(d, 'Graf');
    if (fig) { await clickable(d, fig).click(); await sleep(200); press('space', ['option']); assert.ok(await previewShown(d, 'Graf'), '⌥Space on the selected figure previews Graf'); press('escape'); }
    palette('Go to Tasks');
    assert.ok(await waitMark(c.log, 'route-ready:tasks', 5000), 'tasks shown');
    await sleep(800);
    assert.deepEqual(changedPaths(before, tree(c.vault)), [], 'the tour leaves every vault file\'s bytes, mtime and inode unchanged and creates nothing');
    assert.equal(existsSync(join(c.vault, 'Daily/2026-10-30.md')), false, 'no Daily/2026-10-30.md');
    assert.equal(existsSync(join(c.vault, 'Tags/nápad.md')), false, 'no Tags/nápad.md');
    assert.equal(uiState(c.sup)?.preview?.mode, undefined, 'and stores no preview.mode');
  } finally { await cleanup(c); }
});
