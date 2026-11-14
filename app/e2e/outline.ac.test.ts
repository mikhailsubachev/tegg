// Slice OL real-app tests (L6, Appium mac2 on the built test app, D-382): docs/acceptance/outline.md "Real-app tests" —
// FR-EDT-11 AC-8 (once with the helper process: an external edit reaches the outline card), AC-10 (once: a jump from the
// card, then typing lands at the heading's end), FR-EDT-16 AC-11 (once: ⌘J, ↓, ⏎), FR-SYN-06 AC-46 (the tour writes
// nothing to the vault; only ui-state.json changes, atomically), FR-UX-08 AC-21 (the macOS accessibility tree names the
// card's rows and reports the current one) and FR-SET-02 AC-10 (the switch after a relaunch). D-1675: no Outline tab, so
// FR-NAV-05 AC-5 (the tab after a relaunch) and FR-STO-07 AC-8 (fold state after a relaunch) are removed. Interface docs/contracts/v1-outline.md §5, §7, §9, §10 (the mark `outline-ready`, the external
// helper of ms3-shell §13.6). Always TEGG_TEST=1 with the OL test clock, a temporary Application Support (seeded
// `ui-state.json`) and a temporary copy of tests/fixtures/vaults/outline plus new-empty/.tegg (D-62). Keys go only to
// Tegg (D-799): every key is sent while Tegg is frontmost (helpers/capture.ts `press`, `palette`). Written from the ACs and
// the contract only (D-61).
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, lstatSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import {
  FX, KEY, appiumDown, changedPaths, end, marks, need, osa, palette, paste, press, ready, session, shown, sleep, support, testEnv, textContains, tmp, tree,
  typeAscii, waitFile, waitFor, type Driver, type Env,
} from './helpers/capture.ts';
import { external } from './helpers/graph.ts';

after(appiumDown);
process.on('exit', appiumDown);

// ⌘J and the letters the tour types (macOS virtual key codes, kVK_ANSI_*).
KEY.j ??= 38;
KEY.z ??= 6;
KEY.u ??= 32;

const NOW_OL = '2026-11-13T10:00:00+01:00';
const P = {
  plan: 'Pages/Plán offsitu 2026.md', arch: 'Pages/Architektura.md', cten: 'Pages/Čtenářské poznámky.md', okraje: 'Pages/Okraje.md',
  rozbita: 'Pages/Rozbitá hlavička.md', bezHlavicky: 'Pages/Bez hlavičky.md',
};
const noteRoute = (p: string) => `note/${p.normalize('NFC')}`;
const PANEL = (tab: 'backlinks' | 'graph', open = true) => ({ rightPanel: { open, tab, width: 288 } });

type Ctx = { base: string; vault: string; sup: string; log: string; d?: Driver; n: number };
/** A temp copy of tests/fixtures/vaults/outline (without README.md) plus new-empty/.tegg, and an Application Support whose
 *  `ui-state.json` has `ui` (preview Off, so a click on a row never opens a preview). */
function fresh(name: string, ui: Record<string, unknown> = PANEL('backlinks', false)): Ctx {
  const base = tmp(`ol-${name}`);
  const v = join(base, 'Outline');
  const src = join(FX, 'outline');
  cpSync(src, v, { recursive: true, filter: (s) => relative(src, s) !== 'README.md' });
  cpSync(join(FX, 'new-empty/.tegg'), join(v, '.tegg'), { recursive: true });
  return { base, vault: v, sup: support(base, { ui: { preview: { mode: 'off' }, ...ui } }), log: join(base, 'perf-0.jsonl'), n: 0 };
}
async function launch(c: Ctx, route: string, extra: Env = {}): Promise<Driver> {
  await end(c.d);
  c.n += 1;
  c.log = join(c.base, `perf-${c.n}.jsonl`);
  c.d = await session(testEnv(c.sup, c.log, { TEGG_VAULT: c.vault, TEGG_ROUTE: route, TEGG_NOW: NOW_OL, ...extra }));
  const want = `route-ready:${route.normalize('NFC')}`;
  assert.ok(await waitFor(() => marks(c.log).map((m) => m.normalize('NFC')).includes(want), 20_000), `${route} shown (route-ready)`);
  return c.d;
}
const outlineReady = (c: Ctx, ms = 5000) => waitFor(() => marks(c.log).includes('outline-ready'), ms);
async function cleanup(c: Ctx) {
  await end(c.d);
  rmSync(c.base, { recursive: true, force: true });
}
const uiState = (c: Ctx) => (existsSync(join(c.sup, 'ui-state.json')) ? JSON.parse(readFileSync(join(c.sup, 'ui-state.json'), 'utf8')) : null);
const read = (c: Ctx, rel: string) => (existsSync(join(c.vault, rel)) ? readFileSync(join(c.vault, rel), 'utf8') : null);
async function textShown(d: Driver, text: string, ms = 3000): Promise<boolean> {
  return waitFor(async () => {
    for (const e of await d.$$(`-ios predicate string:${textContains(text)}`).catch(() => [] as any[])) if (await e.isDisplayed().catch(() => false)) return true;
    return false;
  }, ms);
}
/** Elements of the accessibility tree labelled exactly `label` (shown or not), with their type and selection. */
async function labelled(d: Driver, label: string): Promise<{ type: string; selected: string; value: string; x: number }[]> {
  const l = label.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const out: { type: string; selected: string; value: string; x: number }[] = [];
  for (const e of await d.$$(`-ios predicate string:label == "${l}" OR title == "${l}"`).catch(() => [] as any[])) {
    const r = await d.getElementRect(e.elementId).catch(() => ({ x: -1 }));
    out.push({
      type: String(await e.getAttribute('elementType').catch(() => '')), selected: String(await e.getAttribute('selected').catch(() => '')),
      value: String(await e.getAttribute('value').catch(() => '')), x: (r as { x: number }).x,
    });
  }
  return out;
}
/** The rightmost shown element labelled `label`: the outline card's row, not the heading in the note. */
async function rightmost(d: Driver, label: string): Promise<any> {
  const l = label.replace(/"/g, '\\"');
  let best: any = null, bx = -Infinity;
  for (const e of await d.$$(`-ios predicate string:label == "${l}" OR title == "${l}" OR value == "${l}"`).catch(() => [] as any[])) {
    if (!(await e.isDisplayed().catch(() => false))) continue;
    const r = await d.getElementRect(e.elementId);
    if (r.x > bx) { bx = r.x; best = e; }
  }
  assert.ok(best, `"${label}" is shown`);
  return best;
}
/** Opens a note through the Search page (⇧⌘F, its title, ⏎). */
async function openFromSearch(c: Ctx, title: string) {
  press('f', ['command', 'shift']);
  await sleep(500);
  paste(title);
  await sleep(700);
  press('enter');
  await sleep(1000);
}
const tegg = () => osa('tell application id "app.tegg.desktop" to activate');
/** ⌘J: opens the outline card (Tegg frontmost). */
async function card(d: Driver) {
  press('j', ['command']);
  await sleep(500);
  assert.ok(await shown(d, 'Outline', 2000), '⌘J opens the card (dialog Outline)');
}
/** Resizes Tegg's main window (System Events, no keys). */
function windowSize(w: number, h: number) {
  osa('tell application "System Events" to tell (first process whose bundle identifier is "app.tegg.desktop")', `set size of window 1 to {${w}, ${h}}`, 'end tell');
}

// ------------------------------------------------------------------------------------------------ FR-EDT-11 AC-8

test('fr_edt_11_ac8_external_change_updates_the_outline', { timeout: 300_000 }, async () => {
  await ready();
  const c = fresh('ac8');
  try {
    const d = await launch(c, noteRoute(P.plan));
    assert.ok(await outlineReady(c), 'the rail paints its rows (outline-ready)');
    const f = join(c.base, 'ext.md');
    writeFileSync(f, `${read(c, P.plan)}\n# Rezervy\n\nText.\n`);
    external('write', join(c.vault, P.plan), f);
    assert.ok(await textShown(d, 'Rezervy', 4000), 'another program\'s edit reaches the note within 2 s (+ the watcher)');
    tegg();
    await card(d);
    assert.ok(await waitFor(async () => (await labelled(d, 'Rezervy')).length >= 2, 4000), 'Rezervy is in the note and in the outline card');
  } finally {
    await cleanup(c);
  }
});

// ------------------------------------------------------------------------------------------------ FR-EDT-11 AC-10

test('fr_edt_11_ac10_click_jumps_to_the_heading', { timeout: 300_000 }, async () => {
  await ready();
  const c = fresh('ac10');
  try {
    const d = await launch(c, noteRoute(P.cten));
    assert.ok(await outlineReady(c), 'outline-ready');
    const before = tree(c.vault);
    tegg();
    await card(d);
    await (await rightmost(d, 'Replikace')).click();
    await sleep(600);
    assert.deepEqual(changedPaths(before, tree(c.vault)), [], 'the jump writes nothing');
    tegg();
    typeAscii('X');
    const t = await waitFile(join(c.vault, P.cten), (x) => !!x && x.includes('# ReplikaceX'), 8000);
    assert.ok(t?.includes('# ReplikaceX\n'), 'typing X after the jump from the card gives `ReplikaceX` (the caret was at the heading\'s end)');
  } finally {
    await cleanup(c);
  }
});

// ------------------------------------------------------------------------------------------------ FR-EDT-16 AC-11

test('fr_edt_16_ac11_card_by_keyboard', { timeout: 300_000 }, async () => {
  await ready();
  const c = fresh('ac11');
  try {
    const d = await launch(c, noteRoute(P.plan));
    assert.ok(await outlineReady(c), 'the rail paints its rows (outline-ready)');
    await (await rightmost(d, 'Cíle')).click(); // the heading in the note: the caret is in the editor
    await sleep(300);
    press('j', ['command']);
    await sleep(500);
    assert.ok(await shown(d, 'Outline', 2000), '⌘J opens the card (dialog Outline)');
    press('down');
    await sleep(200);
    press('enter');
    await sleep(600);
    tegg();
    typeAscii('Y');
    const t = await waitFile(join(c.vault, P.plan), (x) => !!x && x.includes('## Co od toho chcemeY'), 8000);
    assert.ok(t?.includes('## Co od toho chcemeY\n'), '⌘J, ↓, ⏎ jumped to Co od toho chceme with the caret at its end');
  } finally {
    await cleanup(c);
  }
});

// ------------------------------------------------------------------------------------------------ FR-SYN-06 AC-46

test('fr_syn_06_ac46_outline_tour_writes_nothing', { timeout: 900_000 }, async () => {
  await ready();
  const c = fresh('syn46');
  try {
    const before = tree(c.vault);
    const ui0 = lstatSync(join(c.sup, 'ui-state.json')).ino;
    const supBefore = tree(c.sup);
    let d = await launch(c, noteRoute(P.plan));
    assert.ok(await outlineReady(c), 'outline-ready');
    // The card (D-1675: no Outline tab): ⌘J, rows, a chevron opened and closed, End / Home, a jump, Back, ⌘J, Esc.
    const tour = async () => {
      press('j', ['command']);
      await sleep(400);
      press('down'); press('down');
      press('right'); press('left');
      press('end'); press('home');
      press('enter');
      await sleep(400);
      press('lbracket', ['command']);
      await sleep(300);
      press('j', ['command']);
      await sleep(300);
      press('escape');
    };
    await tour();
    for (const t of ['Architektura', 'Čtenářské poznámky', 'Okraje', 'Rozbitá hlavička', 'Bez hlavičky']) {
      await openFromSearch(c, t);
      await tour();
    }
    // Okraje's folded callout through a jump from the card.
    await openFromSearch(c, 'Okraje');
    press('j', ['command']);
    await sleep(400);
    for (let i = 0; i < 5; i++) press('down');
    press('enter');
    await sleep(500);
    // The rail and the card; panel tabs; focus mode; the switch; the window across 640 px.
    press('backslash', ['command']);
    await sleep(400);
    press('j', ['command']);
    press('down');
    press('enter');
    await sleep(400);
    press('backslash', ['command']);
    palette('Show local graph');
    palette('Show backlinks');
    press('backslash', ['command', 'shift']);
    await sleep(300);
    press('backslash', ['command', 'shift']);
    palette('Toggle outline rail');
    palette('Toggle outline rail');
    windowSize(900, 800);
    await sleep(500);
    windowSize(1440, 900);
    await sleep(500);
    // The days.
    d = await launch(c, 'daily/2026-11-12');
    await tour();
    d = await launch(c, 'daily/2026-11-13');
    await tour();
    // Relaunch.
    d = await launch(c, noteRoute(P.plan));
    assert.ok(await outlineReady(c), 'relaunched');
    await end(c.d);
    c.d = undefined;
    await sleep(500);
    const after = tree(c.vault);
    assert.deepEqual(changedPaths(before, after), [], 'every vault file keeps its bytes, mtime and inode; nothing was created');
    assert.ok(!existsSync(join(c.vault, 'Daily/2026-11-13.md')), 'no Daily/2026-11-13.md');
    const supAfter = tree(c.sup);
    assert.deepEqual(changedPaths(supBefore, supAfter).filter((p) => p !== 'ui-state.json' && !p.endsWith('.jsonl')), [], 'only ui-state.json changed in the Application Support');
    assert.notEqual(lstatSync(join(c.sup, 'ui-state.json')).ino, ui0, 'ui-state.json was written atomically (a new inode)');
    void d;
  } finally {
    await cleanup(c);
  }
});

// ------------------------------------------------------------------------------------------------ FR-UX-08 AC-21

test('fr_ux_08_ac21_outline_voiceover', { timeout: 300_000 }, async () => {
  await ready();
  const c = fresh('ux21');
  try {
    const d = await launch(c, noteRoute(P.plan));
    assert.ok(await outlineReady(c), 'outline-ready');
    // Jump to Program, then to Den 1, from the card; then the card again with Den 1 current.
    tegg();
    await card(d);
    await (await rightmost(d, 'Program')).click();
    await sleep(600);
    tegg();
    await card(d);
    await (await rightmost(d, 'Den 1')).click();
    await sleep(800);
    tegg();
    await card(d);
    const ROW_TYPES = new Set(['27', '30', '75']); // XCUIElementType TableRow, OutlineRow, Cell
    for (const name of ['Cíle', 'Program', 'Den 1', 'Den 2', 'Logistika']) {
      const els = await labelled(d, name);
      assert.ok(els.some((e) => ROW_TYPES.has(e.type)), `the macOS accessibility tree shows the row ${name} by name (types ${els.map((e) => e.type).join(', ')})`);
    }
    const den = (await labelled(d, 'Den 1')).filter((e) => ROW_TYPES.has(e.type));
    assert.ok(den.some((e) => e.selected === 'true' || /current/i.test(e.value)), `the current row Den 1 is reported as selected or current: ${JSON.stringify(den)}`);
  } finally {
    await cleanup(c);
  }
});

// ------------------------------------------------------------------------------------------------ FR-SET-02 AC-10

test('fr_set_02_ac10_outline_rail_switch', { timeout: 300_000 }, async () => {
  await ready();
  const c = fresh('set10', PANEL('backlinks', false));
  try {
    const before = tree(c.vault);
    const d = await launch(c, 'settings/appearance');
    const sw = await need(d, 'Show outline rail', 5000);
    assert.equal(String(await sw.getAttribute('value')), '1', 'the switch is on with no stored value');
    await sw.click();
    await sleep(800);
    assert.equal(uiState(c)?.outlineRail, false, 'ui-state.json: outlineRail false');
    await end(c.d);
    c.d = undefined;
    const d2 = await launch(c, 'settings/appearance');
    const sw2 = await need(d2, 'Show outline rail', 5000);
    assert.equal(String(await sw2.getAttribute('value')), '0', 'after a relaunch the switch keeps its state (off)');
    assert.deepEqual(changedPaths(before, tree(c.vault)), [], 'nothing is written to the vault; .tegg/vault.yml is untouched');
  } finally {
    await cleanup(c);
  }
});
