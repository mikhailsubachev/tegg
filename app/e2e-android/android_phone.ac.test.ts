// Slice AND-2, LA (the test APK on the arm64 emulator `tegg-and-35`, `pixel_7` profile, gesture navigation; adb + CDP;
// contract docs/contracts/android-phone.md §12.1, §13.3, §14.2): docs/acceptance/android-phone.md "Real-app tests":
// FR-UX-04 AC-3, AC-4, AC-7; FR-NAV-04 AC-14, AC-15; FR-NAV-03 AC-17, AC-18; FR-HOM-04 AC-1; FR-INB-01 AC-15;
// FR-DLY-01 AC-13; FR-QRY-05 AC-32; FR-QRY-09 AC-9; FR-EDT-10 AC-10; FR-ATT-01 AC-17; FR-NAV-08 AC-3; FR-MMP-02 AC-33,
// AC-34; FR-NAV-01 AC-24; FR-SET-01 AC-14; FR-SET-02 AC-11, AC-12; FR-UX-08 AC-26, AC-27; NFR-SEC-01 AC-4.
// Each test pushes a fresh copy of its synthetic fixture to shared storage (D-62), starts the test APK with
// `test-env.json` (`TEGG_VAULT`, `TEGG_ROUTE`, `TEGG_IPC_LOG`) and checks "untouched" with AND-1's `fileState` and "zero
// writes" with the IPC log (§2.3). Every test starts with `ready()` (requireDevice): without an emulator it fails, never
// skips.
// Red-test readings (reported): taps that must be real touches (keyboard, swipes, long presses, intents) go through
// `input`; navigation steps that don't depend on touch use CDP clicks on the contract's `data-command`s; the keyboard's
// search key is `KEYCODE_ENTER` (Gboard sends Enter for `enterkeyhint="search"`); "the theme's dark token" (FR-SET-02
// AC-11) is the `--bg` the page has with `Dark` chosen; "a light token" (AC-12) is any colour the page computes in the
// light theme with the system in day mode. The "Opening …" start screen of FR-UX-04 AC-3 is checked when it is caught
// (it may be shorter than one CDP round trip on a small vault).
// Written from the ACs and the contract only (D-61).
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  adb, appops, back, clearPrivate, eventually, fileState, forceStop, foregroundPackage, home, install, perfMarks, pidOf, pushVault, quote, requireDevice, resume, runAs,
  sh, SHARED, sleep, socketsOf, start, TEST_APK, TEST_ID, uiDump, uidOf, webview, writeShared, writeTestEnv, type WebView,
} from './helpers/device.ts';
import {
  actionModeShown, barAppearance, cssRect, DRAWER, edgeBack, fontScale, FRAME, imeShown, ipcLog, ipcLogPath, ipcWrites, launchPhone, logcatMark, logcatSince,
  nightMode, pixel, pushPhone, rotate, swipe, systemFrames, tap, tapEl, title, titleIs, toDevice, webViewRect,
} from './helpers/phone.ts';

const views: WebView[] = [];
let installed = false;
function ready() {
  requireDevice();
  if (!installed) { install(TEST_APK); installed = true; }
}
after(() => {
  for (const v of views) v.close();
  try { rotate(0); nightMode(false); fontScale(1); } catch { /* no device */ }
  adb(['shell', `rm -rf ${SHARED}/Documents/tegg-la-*`]);
});

const MAPA = 'Pages/Mapa výletu.md';
const DLOUHA = 'Pages/Dlouhá poznámka.md';
const VEN = 'Pages/Odkazy ven.md';
/** Pushes `dirs` as one vault without the fixtures' READMEs and generator scripts. */
function pushClean(dirs: string[], name: string): string {
  const root = pushVault(dirs, name);
  sh(`find ${quote(root)} -maxdepth 1 \\( -name README.md -o -name 'make-*.mjs' \\) -delete`, false);
  return root;
}
/** Writes `text` to `path` as a sync app does: a temporary file beside it, then `mv`. */
function syncWrite(path: string, text: string) {
  const tmp = `${path.replace(/[^/]*$/, '')}.sync-${Math.random().toString(36).slice(2, 8)}.tmp`;
  writeShared(tmp, text);
  sh(`mv ${quote(tmp)} ${quote(path)}`);
}
const go = async (v: WebView, cmd: string) => {
  if (!(await v.waitFor(DRAWER, 100))) await v.click(`${FRAME} [data-command="phone.menu"]`);
  assert.ok(await v.waitFor(DRAWER, 3000), 'the drawer opens');
  await v.click(`${DRAWER} [data-command="${cmd}"]`);
};
const route = (v: WebView) => title(v);
const changed = (a: Record<string, unknown>, b: Record<string, unknown>) => [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k])).sort();
const dpr = (v: WebView) => v.eval<number>('devicePixelRatio');

// ------------------------------------------------------------------------------------------------ FR-UX-04 AC-3

/** Device-px boxes of every element with text or a role (button, link, heading, textbox) in the page. */
async function textBoxes(v: WebView): Promise<{ what: string; left: number; top: number; right: number; bottom: number }[]> {
  const r = webViewRect();
  const d = await dpr(v);
  const css = await v.eval<{ what: string; left: number; top: number; right: number; bottom: number }[]>(`(() => {
    const out = [];
    const ROLE = /^(button|link|heading|textbox|searchbox)$/;
    for (const e of document.querySelectorAll('body *')) {
      const s = getComputedStyle(e);
      if (s.visibility === 'hidden' || s.display === 'none' || e.closest('[inert]')) continue;
      const role = e.getAttribute('role') || ({ BUTTON: 'button', A: 'link', H1: 'heading', H2: 'heading', INPUT: 'textbox' })[e.tagName] || '';
      const own = [...e.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim());
      if (!own && !ROLE.test(role)) continue;
      const r = e.getBoundingClientRect();
      // Clipped by every ancestor that clips (a scroller shows only what is inside it; AC-Test-Change, approved by
      // the owner, as D-2222 at L5p).
      const b = { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
      for (let a = e.parentElement; a && a !== document.body; a = a.parentElement) {
        const as = getComputedStyle(a);
        if (as.overflowX === 'visible' && as.overflowY === 'visible') continue;
        const c = a.getBoundingClientRect();
        b.left = Math.max(b.left, c.left); b.top = Math.max(b.top, c.top); b.right = Math.min(b.right, c.right); b.bottom = Math.min(b.bottom, c.bottom);
      }
      if (b.right - b.left <= 0 || b.bottom - b.top <= 0 || b.bottom <= 0 || b.top >= innerHeight) continue;
      out.push({ what: e.tagName + ' ' + (e.getAttribute('aria-label') || e.innerText || '').slice(0, 20), left: b.left, top: b.top, right: b.right, bottom: b.bottom });
    }
    return out;
  })()`);
  return css.map((b) => ({ what: b.what, left: r.left + b.left * d, top: r.top + b.top * d, right: r.left + b.right * d, bottom: r.top + b.bottom * d }));
}
const hits = (a: { left: number; top: number; right: number; bottom: number }, b: { left: number; top: number; right: number; bottom: number } | null) =>
  !!b && a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
async function safeOn(v: WebView, how: string) {
  const f = systemFrames();
  const bad = (await textBoxes(v)).filter((b) => hits(b, f.status) || hits(b, f.nav) || hits(b, f.cutout)).map((b) => `${b.what} [${Math.round(b.top)}…${Math.round(b.bottom)}]`);
  assert.deepEqual(bad, [], `${how}: nothing with text or a role under the status bar, the navigation bar or a cutout`);
  const r = webViewRect();
  const d = await dpr(v);
  const bar = await cssRect(v, 'header[role="banner"] h1, header[role="banner"] [role="search"]');
  if (bar && f.status) assert.ok(r.top + bar.top * d >= f.status.bottom - 1, `${how}: the app bar's content is at or below the status bar`);
  const nav = await cssRect(v, `${FRAME} button`);
  if (nav && f.nav && f.nav.top > 0) {
    const navBottom = await v.eval<number>(`Math.max(...[...document.querySelectorAll('${FRAME} button')].map((b) => b.getBoundingClientRect().bottom))`);
    assert.ok(r.top + navBottom * d <= f.nav.top + 1, `${how}: the bottom bar ends at or above the navigation bar`);
  }
  if (f.status) {
    const bg = await v.eval<string>('getComputedStyle(document.body).backgroundColor');
    const [br, bgc, bb] = (bg.match(/\d+/g) ?? []).map(Number);
    const [pr, pg, pb] = pixel(Math.round(f.screen.width / 2), Math.max(1, Math.round((f.status.top + f.status.bottom) / 2)));
    assert.ok(Math.abs(pr - br) <= 2 && Math.abs(pg - bgc) <= 2 && Math.abs(pb - bb) <= 2, `${how}: the pixels under the status bar have the theme's bg (${[pr, pg, pb]} vs ${bg})`);
  }
}

test('fr_ux_04_ac3_safe_areas', async () => {
  ready();
  const vault = pushPhone();
  for (const turn of [0, 1] as const) {
    rotate(turn);
    const o = turn ? 'landscape' : 'portrait';
    for (const r of ['inbox', `note/${MAPA}`, 'type/book', 'search']) {
      const { v } = await launchPhone(vault, { TEGG_ROUTE: r }, views);
      await sleep(800);
      await safeOn(v, `${o}, ${r}`);
      if (r === 'inbox') {
        await v.click(`${FRAME} [data-command="phone.menu"]`);
        assert.ok(await v.waitFor(DRAWER, 3000), 'the drawer');
        await sleep(400);
        await safeOn(v, `${o}, drawer open`);
      }
    }
    // the start screens: permission, Opening …, chooser
    forceStop(TEST_ID); clearPrivate(TEST_ID); appops(TEST_ID, 'deny'); writeTestEnv(TEST_ID, { TEGG_VAULT: vault });
    start(TEST_ID);
    let v = await webview(TEST_ID); views.push(v);
    assert.ok(await v.waitFor('main[aria-label="Allow access to your notes"]', 20_000), 'the permission screen');
    await safeOn(v, `${o}, the permission screen`);
    forceStop(TEST_ID); clearPrivate(TEST_ID); appops(TEST_ID, 'allow'); writeTestEnv(TEST_ID, { TEGG_VAULT: vault });
    start(TEST_ID, { wait: false });
    v = await webview(TEST_ID); views.push(v);
    if (await v.waitFor('[role="status"]', 1500) && await v.eval<boolean>(`document.body.innerText.includes('Opening')`)) await safeOn(v, `${o}, Opening …`);
    forceStop(TEST_ID); clearPrivate(TEST_ID); writeTestEnv(TEST_ID, {});
    start(TEST_ID);
    v = await webview(TEST_ID); views.push(v);
    assert.ok(await v.waitFor('main[aria-label="Choose a vault"]', 20_000), 'the chooser');
    await safeOn(v, `${o}, the chooser`);
  }
  rotate(0);
});

// ------------------------------------------------------------------------------------------------ FR-UX-04 AC-4

test('fr_ux_04_ac4_keyboard_never_hides_the_field', async () => {
  ready();
  const vault = pushClean(['tests/fixtures/vaults/search', 'tests/fixtures/vaults/search-page', 'tests/fixtures/vaults/new-empty/.tegg'], 'Hledání');
  for (let i = 1; i <= 60; i++) writeShared(`${vault}/Pages/Hromada ${String(i).padStart(2, '0')}.md`, `---\ntype: page\ntags: [hromada]\nmodified: 2026-08-01T10:${String(i % 60).padStart(2, '0')}:00+02:00\n---\nPoznámka číslo ${i}: ostružiník.\n`);
  const { v } = await launchPhone(vault, { TEGG_ROUTE: 'search' }, views);
  const field = 'header[role="banner"] [role="search"] input';
  assert.ok(await v.waitFor(field, 5000), 'Search query');
  // The 500 ms are timed in the page, from the keyboard's showing (the plugin's `keyboard: true` push, sent when its
  // animation starts) to the last resize, not across adb calls (about 1 s each) and not from the tap, which also
  // counts Android starting the keyboard (AC-Test-Change, approved by the owner).
  await v.eval(`(() => { window.__teggKb = { shown: 0, resize: 0 }; const n = window.__TEGG_NATIVE__; const r0 = n.receive.bind(n); n.receive = (k, p) => { if (p && p.keyboard === true && !window.__teggKb.shown) window.__teggKb.shown = performance.now(); return r0(k, p); }; addEventListener('resize', () => { window.__teggKb.resize = performance.now(); }); return true; })()`);
  await tapEl(v, field);
  assert.equal(await eventually(() => imeShown(), (x) => x, 2000, 100), true, 'a tap on Search query shows the keyboard');
  const fitted = await eventually(() => { const f = systemFrames(); const r = webViewRect(); return f.ime ? Math.abs(r.bottom - f.ime.top) : 999; }, (d) => d <= 2, 3000, 50);
  assert.ok(fitted <= 2, `the WebView's visible bottom equals the keyboard's top (± 2 device px; off by ${fitted})`);
  const kb = await v.eval<{ shown: number; resize: number }>('window.__teggKb');
  // The WebView may resize a few ms before the push's script call runs: within 500 ms on either side (AC-Test-Change,
  // approved by the owner).
  assert.ok(kb.shown > 0 && kb.resize > 0 && Math.abs(kb.resize - kb.shown) <= 500, `the page is resized to the keyboard within 500 ms of its showing (${Math.round(kb.resize - kb.shown)} ms)`);
  await v.type('ostružiník');
  await sleep(600);
  const above = async (sel: string, what: string) => {
    const r = await cssRect(v, sel);
    const ih = await v.eval<number>('innerHeight');
    assert.ok(r && r.top >= 0 && r.bottom <= ih + 0.5, `${what} lies fully above the keyboard (${r?.top}…${r?.bottom} of ${ih})`);
  };
  await above(field, 'Search query');
  await above('header[role="banner"] [role="search"] button[aria-label="Clear search"]', 'Clear search');
  assert.equal(await v.waitFor(FRAME, 200), false, 'the bottom bar is hidden');
  await v.eval(`(() => { const m = [...document.querySelectorAll('main')].find((e) => e.getClientRects().length > 0); m.scrollTop = m.scrollHeight; return true; })()`);
  await sleep(400);
  await above('main button[data-command="search.showNext"]', 'Show next 10, scrolled to the end');
  back();
  assert.equal(await eventually(() => imeShown(), (x) => !x, 1000, 100), false, 'Back hides the keyboard');
  assert.ok(await v.waitFor(FRAME, 500), 'the full height and the bottom bar come back within 500 ms');
  // the chooser and the New vault form
  forceStop(TEST_ID); clearPrivate(TEST_ID); writeTestEnv(TEST_ID, {});
  start(TEST_ID);
  const c = await webview(TEST_ID); views.push(c);
  assert.ok(await c.waitFor('main[aria-label="Choose a vault"] input', 20_000), 'the chooser\'s Folder path');
  const ih0 = await c.eval<number>('innerHeight');
  await tapEl(c, 'main[aria-label="Choose a vault"] input');
  await eventually(() => imeShown(), (x) => x, 2000, 100);
  // Measured once the page has fitted the keyboard, not after a fixed time (AC-Test-Change, approved by the owner).
  await eventually(() => c.eval<number>('innerHeight'), (h) => h < ih0 - 100, 2000, 100);
  await sleep(300);
  for (const [sel, what] of [['main[aria-label="Choose a vault"] input', 'Folder path'], ['[data-command="vault.openPath"]', 'Open']]) {
    const r = await cssRect(c, sel);
    const ih = await c.eval<number>('innerHeight');
    assert.ok(r && r.bottom <= ih + 0.5, `the chooser: ${what} fully above the keyboard`);
  }
  back();
  await c.click('[data-command="vault.new"]');
  assert.ok(await c.waitFor('form[aria-label="New vault"] input', 3000), 'the New vault form');
  await tapEl(c, 'form[aria-label="New vault"] input');
  await eventually(() => imeShown(), (x) => x, 2000, 100);
  await c.eval(`document.querySelector('form[aria-label="New vault"] [data-command="vault.create"]').scrollIntoView({ block: 'nearest' })`);
  await sleep(300);
  const cr = await cssRect(c, 'form[aria-label="New vault"] [data-command="vault.create"]');
  const ih = await c.eval<number>('innerHeight');
  assert.ok(cr && cr.bottom <= ih + 0.5, 'Vault name and Create can be scrolled fully above the keyboard');
});

// ------------------------------------------------------------------------------------------------ FR-UX-04 AC-7

test('fr_ux_04_ac7_rotation_keeps_the_place', async () => {
  ready();
  const vault = pushPhone();
  const before = fileState(vault);
  const { pid, v } = await launchPhone(vault, { TEGG_ROUTE: `note/${DLOUHA}` }, views);
  await titleIs(v, 'Dlouhá poznámka');
  await v.eval(`(() => { const m = [...document.querySelectorAll('main')].find((e) => e.getClientRects().length > 0); const h = [...m.querySelectorAll('h1, h2, h3, h4, h5, h6')].find((x) => x.innerText.trim() === 'Druhá kapitola'); m.scrollTop += h.getBoundingClientRect().top - m.getBoundingClientRect().top; return true; })()`);
  const first = () => v.eval<string>(`(() => { const m = [...document.querySelectorAll('main')].find((e) => e.getClientRects().length > 0); const t = m.getBoundingClientRect().top; const b = [...m.querySelectorAll('p, h1, h2, h3, h4, h5, h6')].find((x) => x.getBoundingClientRect().bottom > t + 2); return b ? b.innerText.trim().slice(0, 30) : ''; })()`);
  assert.match(await first(), /^Druhá kapitola/, 'setup: Druhá kapitola first');
  const ok = (b: string) => /^(Druhá kapitola|Další odstavec 1:|Odstavec 40:)/.test(b);
  for (const turn of [1, 0] as const) {
    rotate(turn);
    await sleep(2000);
    assert.equal(await route(v), 'Dlouhá poznámka', `rotation ${turn}: the route stays`);
    assert.equal(await v.eval<string>(`document.documentElement.getAttribute('data-layout')`), 'phone', `rotation ${turn}: the phone layout`);
    assert.ok(ok(await first()), `rotation ${turn}: Druhá kapitola is still the first visible block (± one line)`);
    assert.equal(pidOf(TEST_ID), pid, `rotation ${turn}: the same process`);
  }
  assert.equal(perfMarks(TEST_ID).filter((m) => m.mark === 'ui-ready').length, 1, 'no second ui-ready mark (the same WebView)');
  assert.deepEqual(changed(before, fileState(vault)), [], 'the vault is untouched');
});

// ------------------------------------------------------------------------------------------------ FR-NAV-04 AC-14, AC-15

test('fr_nav_04_ac14_drawer_open_and_close', async () => {
  ready();
  const vault = pushPhone();
  const { v } = await launchPhone(vault, { TEGG_ROUTE: 'inbox' }, views);
  await tapEl(v, `${FRAME} [data-command="phone.menu"]`);
  assert.ok(await v.waitFor(DRAWER, 3000), 'Menu opens the drawer');
  back();
  assert.equal(await eventually(() => v.waitFor(DRAWER, 50), (x) => !x, 2000, 100), false, 'system Back closes the drawer');
  assert.equal(await route(v), 'Inbox', 'the route stays');
  assert.equal(foregroundPackage(), TEST_ID, 'the app stays in front');
  assert.deepEqual(ipcWrites(), [], 'nothing written');
});

test('fr_nav_04_ac15_drawer_counts_follow_files', async () => {
  ready();
  const vault = pushClean(['tests/fixtures/vaults/inbox', 'tests/fixtures/vaults/new-empty/.tegg'], 'Doručené');
  const { v } = await launchPhone(vault, { TEGG_ROUTE: 'inbox' }, views);
  await v.click(`${FRAME} [data-command="phone.menu"]`);
  const count = () => v.eval<string>(`(document.querySelector('${DRAWER} [data-command="goto.inbox"]')?.innerText ?? '').replace(/\\D/g, '')`);
  assert.equal(await eventually(count, (c) => c === '13', 30_000, 250), '13', 'Inbox 13');
  const q1 = `${vault}/Quick Notes/Koupit mléko.md`;
  syncWrite(q1, sh(`cat ${quote(q1)}`).replace('review: unreviewed', 'review: reviewed'));
  assert.equal(await eventually(count, (c) => c === '12', 2000, 100), '12', 'an external review shows 12 within 2 s');
});

// ------------------------------------------------------------------------------------------------ FR-NAV-03 AC-17, AC-18

test('fr_nav_03_ac17_system_back_is_tegg_back', async () => {
  ready();
  const vault = pushPhone();
  const before = fileState(vault);
  for (const how of ['KEYCODE_BACK', 'the edge gesture'] as const) {
    const { pid, v } = await launchPhone(vault, {}, views);
    await titleIs(v, 'Inbox', 10_000);
    await go(v, 'goto.type:book');
    await titleIs(v, 'Books');
    assert.ok(await v.waitFor('main [role="tab"][data-view-tab="Přečtené 2026"]', 10_000), 'the view tab Přečtené 2026');
    await v.click('main [role="tab"][data-view-tab="Přečtené 2026"]');
    assert.ok(await v.waitFor('main [data-query-result="Books/Mapa bez severu.md"]', 10_000), 'Mapa bez severu in the view');
    await v.click(`main [data-query-result="Books/Mapa bez severu.md"]`);
    await titleIs(v, 'Mapa bez severu');
    await v.click('main a[href][data-link-kind], main .phone-strip a');
    await sleep(800);
    const chipTarget = await title(v);
    assert.notEqual(chipTarget, 'Mapa bez severu', 'a chip opened its target');
    const press = how === 'KEYCODE_BACK' ? back : edgeBack;
    for (const want of ['Mapa bez severu', 'Books', 'Inbox']) {
      press();
      assert.equal(await titleIs(v, want), want, `${how}: back to ${want}`);
    }
    press();
    await sleep(1500);
    assert.notEqual(foregroundPackage(), TEST_ID, `${how}: one more Back moves the app to the background (the launcher is in front)`);
    assert.equal(pidOf(TEST_ID), pid, `${how}: the same process`);
    resume(TEST_ID);
    await sleep(1500);
    assert.equal(await route(v), 'Inbox', `${how}: returning shows inbox`);
    // Back with the drawer, the sheet, a menu or a full-screen map open closes it; the route stays
    await v.click(`${FRAME} [data-command="phone.menu"]`);
    press();
    assert.equal(await eventually(() => v.waitFor(DRAWER, 50), (x) => !x, 2000, 100), false, `${how}: Back closes the drawer`);
    assert.equal(await route(v), 'Inbox', `${how}: the route stays`);
  }
  assert.deepEqual(changed(before, fileState(vault)), [], 'the vault is untouched');
});

test('fr_nav_03_ac18_no_swipe_navigates', async () => {
  ready();
  const vault = pushPhone();
  const before = fileState(vault);
  const { v } = await launchPhone(vault, { TEGG_ROUTE: `note/${DLOUHA}` }, views);
  await titleIs(v, 'Dlouhá poznámka');
  const p = await cssRect(v, 'main p');
  const a = await toDevice(v, 4, p!.top + 10);
  const c = await toDevice(v, p!.left + p!.width / 2, p!.top + 10);
  for (const [from, dx] of [[a, 1], [c, 1], [c, -1]] as const) {
    swipe(from.x, from.y, from.x + dx * 200 * (await v.eval<number>('devicePixelRatio')), from.y, 300);
    await sleep(600);
    assert.equal(await route(v), 'Dlouhá poznámka', 'a horizontal drag over the note never navigates');
    assert.equal(await v.waitFor(DRAWER, 100), false, 'never opens the drawer');
  }
  assert.deepEqual(ipcWrites(), [], 'zero writes');
  assert.deepEqual(changed(before, fileState(vault)), [], 'the vault is untouched');
});

// ------------------------------------------------------------------------------------------------ FR-HOM-04 AC-1

test('fr_hom_04_ac1_phone_launch_landing', async () => {
  ready();
  const vault = pushPhone();
  const before = fileState(vault);
  forceStop(TEST_ID); clearPrivate(TEST_ID); appops(TEST_ID, 'allow');
  writeTestEnv(TEST_ID, { TEGG_VAULT: vault });
  start(TEST_ID);
  let v = await webview(TEST_ID); views.push(v);
  assert.equal(await titleIs(v, 'Inbox', 20_000), 'Inbox', 'no note ever opened: inbox');
  await v.click(`${FRAME} [data-command="phone.menu"]`);
  await v.click(`${DRAWER} .sidebar-pinned [data-pinned-row="0"]`);
  await titleIs(v, 'Mapa výletu');
  await sleep(1000);
  forceStop(TEST_ID);
  sh(`am start -W -n ${TEST_ID}/.MainActivity`);
  v = await webview(TEST_ID); views.push(v);
  assert.equal(await titleIs(v, 'Mapa výletu', 20_000), 'Mapa výletu', 'a cold start after Mapa výletu shows note/Pages/Mapa výletu.md');
  forceStop(TEST_ID);
  sh(`rm ${quote(`${vault}/${MAPA}`)}`);
  sh(`am start -W -n ${TEST_ID}/.MainActivity`);
  v = await webview(TEST_ID); views.push(v);
  assert.equal(await titleIs(v, 'Inbox', 20_000), 'Inbox', 'with Mapa výletu deleted while stopped: inbox');
  assert.equal(await v.eval<number>(`document.querySelectorAll('[role="alert"]').length`), 0, 'with no error');
  const now = fileState(vault);
  assert.deepEqual(changed(before, now), [MAPA], 'no start writes to the vault (only the test\'s removal differs)');
});

// ------------------------------------------------------------------------------------------------ FR-INB-01 AC-15

test('fr_inb_01_ac15_no_row_swipes', async () => {
  ready();
  const vault = pushClean(['tests/fixtures/vaults/inbox', 'tests/fixtures/vaults/new-empty/.tegg'], 'Doručené');
  const before = fileState(vault);
  const { v } = await launchPhone(vault, { TEGG_ROUTE: 'inbox' }, views);
  await titleIs(v, 'Inbox');
  assert.ok(await v.waitFor('main li', 20_000), 'the Inbox rows');
  const r = await v.eval<{ left: number; top: number; width: number; height: number }>(`(() => { const l = [...document.querySelectorAll('main li')].find((x) => x.innerText.includes('Koupit mléko')); const b = l.getBoundingClientRect(); return { left: b.left, top: b.top, width: b.width, height: b.height }; })()`);
  const c = await toDevice(v, r.left + r.width / 2, r.top + r.height / 2);
  const d = await dpr(v);
  swipe(c.x - 100 * d, c.y, c.x + 100 * d, c.y, 300);
  swipe(c.x + 100 * d, c.y, c.x - 100 * d, c.y, 300);
  swipe(c.x, c.y, c.x, c.y, 800);
  await sleep(800);
  assert.equal(await route(v), 'Inbox', 'no route change');
  assert.equal(await v.eval<number>(`document.querySelectorAll('[role="menu"]').length`), 0, 'no menu');
  assert.equal(actionModeShown(), false, 'no WebView context menu');
  assert.deepEqual(ipcWrites(), [], 'zero writes');
  assert.deepEqual(changed(before, fileState(vault)), [], 'no reviewed state, the vault untouched');
});

// ------------------------------------------------------------------------------------------------ FR-DLY-01 AC-13

test('fr_dly_01_ac13_today_on_the_phone_writes_nothing', async () => {
  ready();
  const vault = pushClean(['tests/fixtures/vaults/daily', 'tests/fixtures/vaults/new-empty/.tegg'], 'Deník');
  const daily = () => sh(`ls -1 ${quote(`${vault}/Daily`)}`, false).split('\n').filter(Boolean).sort();
  const list0 = daily();
  const { v } = await launchPhone(vault, { TEGG_ROUTE: 'inbox' }, views);
  await tapEl(v, `${FRAME} [data-command="daily.today"]`);
  const today = sh("date '+%Y-%m-%d'").trim();
  assert.equal(await titleIs(v, today), today, 'Today opens daily/<today>');
  await sleep(10_000);
  assert.deepEqual(daily(), list0, 'no file appears in Daily/ after 10 s');
  await v.click(`${FRAME} [data-command="phone.menu"]`);
  await v.click(`${DRAWER} [data-command="goto.inbox"]`);
  await sleep(2000);
  assert.deepEqual(daily(), list0, 'nor after leaving the page');
  assert.deepEqual(ipcWrites(), [], 'zero writes');
});

// ------------------------------------------------------------------------------------------------ FR-QRY-05 AC-32, FR-QRY-09 AC-9

test('fr_qry_05_ac32_vertical_board_on_the_phone', async () => {
  ready();
  const vault = pushPhone();
  const before = fileState(vault);
  const { v } = await launchPhone(vault, { TEGG_ROUTE: 'type/book' }, views);
  assert.ok(await v.waitFor('main [role="tab"][data-view-tab="Rozečtené"]', 10_000), 'the view tab Rozečtené');
  await v.click('main [role="tab"][data-view-tab="Rozečtené"]');
  const card = 'main article[data-board-card="Books/Noční vlak.md"]';
  assert.ok(await v.waitFor(card, 5000), 'the card Noční vlak');
  const lane = () => v.eval<string>(`document.querySelector('${card}')?.closest('[data-lane]')?.getAttribute('data-lane') ?? ''`);
  const l0 = await lane();
  const r = await cssRect(v, card);
  const c = await toDevice(v, r!.left + 20, r!.top + r!.height / 2);
  swipe(c.x, c.y, c.x + 320 * (await dpr(v)), c.y, 500);
  await sleep(800);
  assert.equal(await lane(), l0, 'a touch drag of the card moves no card');
  assert.deepEqual(ipcWrites(), [], 'zero writes');
  assert.deepEqual(changed(before, fileState(vault)), [], 'the vault is untouched');
});

test('fr_qry_09_ac9_live_views_on_the_phone', async () => {
  ready();
  const vault = pushPhone();
  const { v } = await launchPhone(vault, { TEGG_ROUTE: 'type/book' }, views);
  assert.ok(await v.waitFor('main [role="tab"][data-view-tab="Rozečtené"]', 10_000), 'the view tab Rozečtené');
  await v.click('main [role="tab"][data-view-tab="Rozečtené"]');
  const dum = 'main article[data-board-card="Books/Dům u řeky.md"]';
  assert.ok(await v.waitFor(dum, 5000), 'Dům u řeky');
  const p = `${vault}/Books/Dům u řeky.md`;
  syncWrite(p, sh(`cat ${quote(p)}`).replace('status: To read', 'status: Reading'));
  const lane = await eventually(() => v.eval<string>(`document.querySelector('${dum}')?.closest('[data-lane]')?.getAttribute('data-lane') ?? ''`), (l) => l === 'option:Reading', 2000, 100);
  assert.equal(lane, 'option:Reading', 'an external status change moves the card within 2 s');
  assert.deepEqual(ipcWrites(), [], 'no write by Tegg');
});

// ------------------------------------------------------------------------------------------------ FR-EDT-10 AC-10, FR-ATT-01 AC-17, FR-NAV-08 AC-3

test('fr_edt_10_ac10_note_is_the_read_view_on_the_phone', async () => {
  ready();
  const vault = pushPhone();
  const { v } = await launchPhone(vault, { TEGG_ROUTE: `note/${DLOUHA}` }, views);
  await titleIs(v, 'Dlouhá poznámka');
  assert.equal(await v.eval<number>(`document.querySelectorAll('[contenteditable], .ProseMirror').length`), 0, 'no editor');
  await tapEl(v, 'main p');
  await sleep(800);
  assert.equal(imeShown(), false, 'a tap on the text never shows the keyboard (mInputShown=false)');
  assert.deepEqual(ipcWrites(), [], 'zero writes');
});

test('fr_att_01_ac17_media_on_the_phone', async () => {
  ready();
  const vault = pushClean(['tests/fixtures/vaults/trash-media', 'tests/fixtures/vaults/new-empty/.tegg'], 'Zahrada');
  const { v } = await launchPhone(vault, { TEGG_ROUTE: 'note/Pages/Plán zahrady.md' }, views);
  assert.ok(await v.waitFor('main img[alt="Záhon"]', 10_000), 'záhon.png');
  const w = await eventually(() => v.eval<number>(`document.querySelector('main img[alt="Záhon"]').naturalWidth`), (x) => x > 0, 5000, 200);
  assert.ok(w > 0, 'the image loads in Android\'s WebView (naturalWidth > 0)');
  assert.deepEqual(ipcWrites(), [], 'zero writes');
});

test('fr_nav_08_ac3_no_previews_on_the_phone', async () => {
  ready();
  const vault = pushPhone();
  const { v } = await launchPhone(vault, { TEGG_ROUTE: `note/Pages/Čtení 2026.md` }, views);
  assert.ok(await v.waitFor('main article a', 10_000), 'a link in Čtení 2026');
  const r = await cssRect(v, 'main article a');
  const c = await toDevice(v, r!.left + r!.width / 2, r!.top + r!.height / 2);
  swipe(c.x, c.y, c.x, c.y, 800);
  await sleep(1500);
  assert.equal(actionModeShown(), false, 'a long press shows no floating toolbar or ActionMode window');
  assert.equal(await v.eval<number>(`document.querySelectorAll('[role="dialog"][aria-label^="Preview: "]').length`), 0, 'and no preview');
});

// ------------------------------------------------------------------------------------------------ FR-MMP-02 AC-33, AC-34

test('fr_mmp_02_ac33_mindmap_zoom_on_the_phone', async () => {
  ready();
  const vault = pushPhone();
  const { v } = await launchPhone(vault, { TEGG_ROUTE: `note/${MAPA}` }, views);
  const area = 'main figure[aria-label="Mindmap: Výlet"] [data-map-area]';
  assert.ok(await v.waitFor(area, 10_000), 'the map area');
  const s0 = await v.eval<number>(`Number(document.querySelector('${area}').getAttribute('data-scale'))`);
  await tapEl(v, 'main figure[aria-label="Mindmap: Výlet"] [data-command="mindmap.zoomIn"]');
  const s1 = await eventually(() => v.eval<number>(`Number(document.querySelector('${area}').getAttribute('data-scale'))`), (s) => Math.abs(s - Math.min(2.5, s0 * 1.25)) <= 0.01, 2000, 100);
  assert.ok(Math.abs(s1 - Math.min(2.5, s0 * 1.25)) <= 0.01, `a tap on Zoom in multiplies the scale by 1.25 (${s0} → ${s1})`);
  assert.deepEqual(ipcWrites(), [], 'zero writes');
});

test('fr_mmp_02_ac34_mindmap_pan_and_full_screen', async () => {
  ready();
  const vault = pushPhone();
  const { v } = await launchPhone(vault, { TEGG_ROUTE: `note/${MAPA}` }, views);
  const fs = 'main figure[aria-label="Mindmap: Výlet"] [data-command="mindmap.fullScreen"]';
  assert.ok(await v.waitFor(fs, 10_000), 'Open full screen');
  await tapEl(v, fs);
  assert.ok(await v.waitFor('[role="dialog"][aria-label="Mindmap: Výlet"]', 3000), 'the full-screen map');
  back();
  assert.equal(await eventually(() => v.waitFor('[role="dialog"][aria-label="Mindmap: Výlet"]', 50), (x) => !x, 2000, 100), false, 'system Back closes it');
  assert.equal(await route(v), 'Mapa výletu', 'the route stays');
});

// ------------------------------------------------------------------------------------------------ FR-NAV-01 AC-24

test('fr_nav_01_ac24_search_from_the_bottom_bar', async () => {
  ready();
  const vault = pushClean(['tests/fixtures/vaults/search', 'tests/fixtures/vaults/search-page', 'tests/fixtures/vaults/new-empty/.tegg'], 'Hledání');
  const { v } = await launchPhone(vault, { TEGG_ROUTE: 'inbox' }, views);
  await tapEl(v, `${FRAME} [data-command="goto.search"]`);
  assert.ok(await v.waitFor('main[aria-label="Search"]', 3000), 'the bottom bar\'s Search opens search');
  assert.equal(await eventually(() => imeShown(), (x) => x, 2000, 100), true, 'the keyboard is shown');
  assert.equal(await v.eval<string>(`document.activeElement?.getAttribute('aria-label') ?? ''`), 'Search query', 'the caret is in Search query');
  assert.equal(await v.eval<string>(`document.activeElement?.getAttribute('enterkeyhint') ?? ''`), 'search', 'enterkeyhint="search"');
  await v.type('cteni');
  await sleep(800);
  sh('input keyevent KEYCODE_ENTER');
  assert.equal(await titleIs(v, 'Čtení knih'), 'Čtení knih', 'the keyboard\'s search key opens Čtení knih');
  back();
  await sleep(500);
  await v.eval(`(() => { const i = document.querySelector('header[role="banner"] [role="search"] input'); i.focus(); i.select(); return true; })()`);
  await v.type('čtení'.normalize('NFD'));
  await sleep(800);
  const first = await v.eval<string>(`(document.querySelector('main [aria-label="Search results"] a')?.innerText ?? '').split('\\n')[0].trim()`);
  assert.equal(first.normalize('NFC'), 'Čtení knih', 'NFD čtení gives the same first row');
});

// ------------------------------------------------------------------------------------------------ FR-SET-01 AC-14, FR-SET-02 AC-11, AC-12

test('fr_set_01_ac14_settings_on_the_phone', async () => {
  ready();
  const vault = pushPhone();
  const { v } = await launchPhone(vault, { TEGG_ROUTE: 'settings/storage' }, views);
  assert.ok(await v.waitFor('main [data-command="android.openSettings"]', 10_000), 'Open settings');
  await tapEl(v, 'main [data-command="android.openSettings"]');
  assert.equal(await eventually(() => foregroundPackage(), (p) => p === 'com.android.settings', 5000, 250), 'com.android.settings', 'the foreground package becomes com.android.settings');
  resume(TEST_ID);
});

const bgVar = (v: WebView) => v.eval<string>(`getComputedStyle(document.documentElement).getPropertyValue('--bg').trim()`);
async function chooseTheme(v: WebView, name: 'System' | 'Light' | 'Dark') {
  if (!(await v.waitFor('main [role="radiogroup"][aria-label="Theme"]', 200))) {
    await go(v, 'goto.settings');
    await v.click('main [data-command="goto.settings/appearance"]');
  }
  assert.ok(await v.waitFor('main [role="radiogroup"][aria-label="Theme"]', 3000), 'Theme');
  await v.eval(`(() => { const r = [...document.querySelectorAll('main [role="radiogroup"][aria-label="Theme"] [role="radio"], main [role="radiogroup"][aria-label="Theme"] input')].find((x) => (x.getAttribute('aria-label') || x.closest('label')?.innerText || x.innerText || '').trim() === ${JSON.stringify(name)}); r.click(); return true; })()`);
  await sleep(400);
}

test('fr_set_02_ac11_theme_follows_android', async () => {
  ready();
  nightMode(false);
  const vault = pushPhone();
  const { v } = await launchPhone(vault, { TEGG_ROUTE: 'settings/appearance' }, views);
  assert.ok(await v.waitFor('main [role="radiogroup"][aria-label="Theme"]', 10_000), 'Theme');
  assert.equal(await v.eval<boolean>(`!![...document.querySelectorAll('main [role="radiogroup"][aria-label="Theme"] [aria-checked="true"], main [role="radiogroup"][aria-label="Theme"] input:checked')].find((x) => /System/.test(x.getAttribute('aria-label') || x.closest('label')?.innerText || x.innerText || ''))`), true, 'System is selected on a fresh install');
  const light = await bgVar(v);
  await chooseTheme(v, 'Dark');
  const dark = await bgVar(v);
  assert.notEqual(dark, light, 'setup: the dark --bg differs');
  await chooseTheme(v, 'System');
  nightMode(true);
  assert.equal(await eventually(() => bgVar(v), (b) => b === dark, 1000, 100), dark, 'night yes turns the page dark within 1 s');
  nightMode(false);
  assert.equal(await eventually(() => bgVar(v), (b) => b === light, 1000, 100), light, 'night no turns it light');
  await chooseTheme(v, 'Light');
  nightMode(true);
  await sleep(1000);
  assert.equal(await bgVar(v), light, 'with Light chosen, night yes leaves it light');
  forceStop(TEST_ID);
  start(TEST_ID);
  const w = await webview(TEST_ID); views.push(w);
  assert.ok(await w.waitFor(FRAME, 30_000), 'a cold start');
  assert.equal(await bgVar(w), light, 'the choice survives a cold start (private storage)');
  nightMode(false);
});

test('fr_set_02_ac12_system_bars_follow_the_theme', async () => {
  ready();
  nightMode(false);
  const vault = pushPhone();
  const { v } = await launchPhone(vault, { TEGG_ROUTE: 'settings/appearance' }, views);
  assert.ok(await v.waitFor('main [role="radiogroup"][aria-label="Theme"]', 10_000), 'Theme');
  await chooseTheme(v, 'Light');
  assert.deepEqual(await eventually(() => barAppearance(), (a) => a.lightStatus && a.lightNav, 1000, 100), { lightStatus: true, lightNav: true }, 'the light theme: dark bar icons (APPEARANCE_LIGHT_* set)');
  const colours = () => v.eval<string[]>(`[...new Set([...document.querySelectorAll('body *')].filter((e) => e.getClientRects().length).flatMap((e) => { const s = getComputedStyle(e); return [s.color, s.backgroundColor]; }))]`);
  const lightSet = new Set(await colours());
  await chooseTheme(v, 'Dark');
  assert.deepEqual(await eventually(() => barAppearance(), (a) => !a.lightStatus && !a.lightNav, 1000, 100), { lightStatus: false, lightNav: false }, 'the dark theme: not set, within 1 s');
  await chooseTheme(v, 'Light');
  nightMode(true);
  await sleep(1500);
  const leaks = (await colours()).filter((c) => !lightSet.has(c));
  assert.deepEqual(leaks, [], 'Light chosen with the system in night mode: every computed colour is a light one (no algorithmic darkening)');
  nightMode(false);
});

// ------------------------------------------------------------------------------------------------ FR-UX-08 AC-26, AC-27

test('fr_ux_08_ac26_talkback_reads_the_frame', async () => {
  ready();
  const vault = pushPhone();
  const { v } = await launchPhone(vault, { TEGG_ROUTE: 'inbox' }, views);
  await sleep(1000);
  // The WebView builds its accessibility tree lazily: the first dump after start can be empty (AC-Test-Change,
  // approved by the owner).
  const dump = await eventually(async () => uiDump(), (d) => /(text|content-desc)="Menu"/.test(d), 3000, 300);
  for (const name of ['Menu', 'Search', 'New', 'Today']) assert.match(dump, new RegExp(`(text|content-desc)="${name}"`), `the dump lists ${name}`);
  assert.match(dump, /(text|content-desc)="New"[^>]*enabled="false"|enabled="false"[^>]*(text|content-desc)="New"/, 'New is not enabled');
  // The row's link, not the `li` (the first match of `main li a, main li`; AC-Test-Change, approved by the owner).
  await v.click('main li a');
  await sleep(1000);
  assert.match(await eventually(async () => uiDump(), (d) => /(text|content-desc)="Back"/.test(d), 3000, 300), /(text|content-desc)="Back"/, 'Back in the app bar after one navigation');
  await v.click(`${FRAME} [data-command="phone.menu"]`);
  await sleep(800);
  const d2 = uiDump();
  assert.doesNotMatch(d2, /(text|content-desc)="New"/, 'with the drawer open, the elements behind it (the bottom bar) are not in the dump');
});

test('fr_ux_08_ac27_system_font_size', async () => {
  ready();
  const vault = pushPhone();
  fontScale(1);
  const { v } = await launchPhone(vault, { TEGG_ROUTE: 'inbox' }, views);
  const base = await v.eval<number>(`parseFloat(getComputedStyle(document.body).fontSize)`);
  // `cur` is the live WebView: after a restart the old connection is dead (AC-Test-Change, approved by the owner).
  let cur = v;
  for (const s of [1.3, 2.0]) {
    fontScale(s);
    await sleep(1500);
    const size = await eventually(() => cur.eval<number>(`parseFloat(getComputedStyle(document.body).fontSize)`), (x) => Math.abs(x - base * s) <= 0.5, 2000, 200);
    assert.ok(Math.abs(size - base * s) <= 0.5, `font scale ${s}: the computed body font size grows by ${s} (± 0.5 px, the WebView's text zoom): ${base} → ${size}`);
    for (const r of ['inbox', `note/${DLOUHA}`, 'type/book']) {
      if (cur !== v || r !== 'inbox') { forceStop(TEST_ID); writeTestEnv(TEST_ID, { TEGG_VAULT: vault, TEGG_ROUTE: r, TEGG_IPC_LOG: ipcLogPath() }); start(TEST_ID); }
      const w = cur === v && r === 'inbox' ? v : await webview(TEST_ID);
      if (w !== v) views.push(w);
      cur = w;
      assert.ok(await w.waitFor(FRAME, 30_000), `${s}, ${r}: open`);
      await sleep(800);
      const o = await w.eval<{ sw: number; iw: number }>(`({ sw: document.scrollingElement.scrollWidth, iw: innerWidth })`);
      assert.equal(o.sw, o.iw, `${s}, ${r}: no sideways page scroll`);
      const labels = await w.eval<{ ok: boolean; lines: number }[]>(`[...document.querySelectorAll('${FRAME} .phone-tab-label')].map((l) => ({ ok: l.scrollWidth <= l.clientWidth, lines: Math.round(l.getBoundingClientRect().height / parseFloat(getComputedStyle(l).lineHeight || '16')) }))`);
      assert.ok(labels.length === 4 && labels.every((l) => l.ok && l.lines <= 2), `${s}, ${r}: each bottom-bar label is shown whole, in at most two lines (${JSON.stringify(labels)})`);
    }
  }
  fontScale(1);
  assert.match(await cur.eval<string>(`document.querySelector('meta[name="viewport"]')?.content ?? ''`), /user-scalable=no/, 'the page can\'t be pinch-zoomed');
});

// ------------------------------------------------------------------------------------------------ NFR-SEC-01 AC-4

test('nfr_sec_01_ac4_external_links_leave_through_the_system', async () => {
  ready();
  const vault = pushPhone();
  const { v } = await launchPhone(vault, { TEGG_ROUTE: `note/${VEN}` }, views);
  assert.ok(await v.waitFor('main article a', 10_000), 'Odkazy ven');
  const href0 = await v.eval<string>('location.href');
  const linkSel = (text: string) => `(() => { const a = [...document.querySelectorAll('main article a')].find((x) => x.innerText.trim() === ${JSON.stringify(text)}); return a; })()`;
  const tapLink = async (text: string) => {
    const r = await v.eval<{ left: number; top: number; width: number; height: number } | null>(`(() => { const a = ${linkSel(text)}; if (!a) return null; a.scrollIntoView({ block: 'center' }); const b = a.getBoundingClientRect(); return { left: b.left, top: b.top, width: b.width, height: b.height }; })()`);
    if (!r) return false;
    const p = await toDevice(v, r.left + r.width / 2, r.top + r.height / 2);
    tap(p.x, p.y);
    return true;
  };
  let mark = logcatMark();
  assert.ok(await tapLink('web'), 'the link web');
  await sleep(2000);
  const starts = logcatSince(mark, /ActivityTaskManager: START u0 \{act=android\.intent\.action\.VIEW/);
  assert.ok(starts.some((l) => l.includes('dat=https://example.org/') && l.includes('%C4%8De%C5%A1tina') || l.includes('dat=https://example.org/…') || l.includes('dat=https://example.org/...')), `a VIEW intent for https://example.org/%C4%8De%C5%A1tina: ${starts.join(' | ')}`);
  assert.ok(ipcLog().some((x) => x.cmd === 'android_open_url'), 'through android_open_url');
  resume(TEST_ID);
  await sleep(1000);
  assert.equal(await v.eval<string>('location.href'), href0, 'the WebView\'s location.href is unchanged');
  assert.equal(await route(v), 'Odkazy ven', 'the route is unchanged');
  mark = logcatMark();
  assert.ok(await tapLink('mailto:eva@example.org') || await tapLink('eva@example.org'), 'the mailto link');
  await sleep(2000);
  assert.ok(logcatSince(mark, /START u0 \{act=android\.intent\.action\.(VIEW|SENDTO)[^}]*dat=mailto:/).length > 0, 'mailto:eva@example.org starts a VIEW intent for it');
  resume(TEST_ID);
  await sleep(1000);
  for (const text of ['skript', 'soubor']) {
    mark = logcatMark();
    await tapLink(text);
    await sleep(1500);
    assert.deepEqual(logcatSince(mark, /START u0 \{act=android\.intent\.action\.VIEW/), [], `${text}: no intent`);
    assert.equal(await v.eval<string>('location.href'), href0, `${text}: navigates nothing`);
    assert.equal(foregroundPackage(), TEST_ID, `${text}: Tegg stays in front`);
  }
  assert.deepEqual(socketsOf(uidOf(TEST_ID)), [], 'no socket of Tegg\'s uid');
});
