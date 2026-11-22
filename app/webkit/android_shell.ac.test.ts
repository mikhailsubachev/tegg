// Slice AND-1, L5 (WebKit + the fake core over mocked IPC, `window.__TEGG_PLATFORM__` set by the test, AP-2026 →
// D-2026): docs/acceptance/android-shell.md
// - AR-03 AC-11: on Android the client refuses RA2's commands (no invoke, the `error.unsupported` alert, state kept),
//   the chooser has no `import.open` / `vault.pickDir`, the logo menu no `About Tegg`, the switcher's `Open folder as
//   vault…` shows RA4, the palette lists no command whose only action is excluded, the start reads `vault_start` and
//   never `vault_current`. On `macos` the same surfaces are as at `7ff0fc0b` (red-test reading: the parts this slice
//   touches, listed explicitly from the existing L5 tests of those surfaces, instead of a recorded snapshot).
// - FR-VLT-01 AC-18 (three orderings of `vault_start` and `vault:start`), AC-19 (opening, progress, failed), AC-20 (the
//   permission screen from `needsAccess`), AC-21 (L5: `Open settings`, the return still off, then on), AC-23 (the
//   Android chooser), AC-26 (L5: the New vault form on the phone);
// - FR-EDT-08 AC-14 (L5): on Android a pending edit is written at once on `visibilitychange: hidden`; on macOS nothing
//   changes.
// Contract: docs/contracts/android-shell.md §5, §9. Fake-core additions: ./android-helpers.ts. Written from the ACs and
// the contract only (D-61).
import { test, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import { newEmptyVault, shellVault } from '../ui/test/fake-core';
import { eventually, must, mustBeOn, paletteDialog, paletteOptions, seen, sidebar, sleep, typeEntries, typesList } from './helpers';
import { accessScreen, chooser, EVA, S, SHARED, SHELL_PATH, shellAtPhone, startAndroid, UVODNI, type AndroidHandle } from './android-helpers';

const callsOf = async (core: AndroidHandle, cmd: string) => (await core.calls()).filter((c) => c.cmd === cmd);
const startReads = async (core: AndroidHandle, how: string) => {
  const cmds = (await core.calls()).map((c) => c.cmd);
  assert.ok(cmds.includes('vault_start'), `${how}: the page reads vault_start (contract §9.2)`);
  assert.ok(!cmds.includes('vault_current'), `${how}: the page never calls vault_current on Android`);
};
const logoMenuItems = async (page: Page): Promise<string[]> => {
  const btn = await must(sidebar(page).getByRole('button', { name: 'Tegg: About and Settings', exact: true }), 'the version button at the bottom left');
  await btn.click();
  const m = await must(page.getByRole('menu', { name: 'About and Settings' }), 'menu "About and Settings"');
  const items = (await m.getByRole('menuitem').allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim().replace(/\s*⌘.*$/, ''));
  await page.keyboard.press('Escape');
  return items;
};
async function paletteFor(page: Page, query: string): Promise<string[]> {
  await page.keyboard.press('Meta+k');
  await must(paletteDialog(page), `Command palette (for "${query}")`);
  await page.getByRole('combobox', { name: 'Command query' }).fill(query);
  await sleep(300);
  const out = (await paletteOptions(page)).map((t) => t.split('\n')[0].trim());
  await page.keyboard.press('Escape');
  return out;
}
const switcherMenuItem = async (page: Page, name: string) => {
  await (await must(page.getByRole('button', { name: /^Vault: .*\. Switch vault$/ }), 'the vault switcher')).click();
  const menu = await must(page.getByRole('menu', { name: 'Vaults' }), 'menu "Vaults"');
  await (await must(menu.getByRole('menuitem', { name, exact: true }), `menuitem "${name}"`)).click();
};

// ------------------------------------------------------------------------------------------------ AR-03 AC-11

// The palette titles of commands whose only action is excluded (`import.open`, `capture.open`, `app.about`; the AC's
// `Reveal vault in Finder` is no palette command today, so it is checked as absent only).
const EXCLUDED_PALETTE = ['Import…', 'Quick Capture', 'Capture a task', 'About Tegg'];

test('ar_03_ac11_ui_skips_missing_commands_on_android', async ({ browser }) => {
  const { vault, opts } = shellAtPhone();

  // macOS: unchanged.
  {
    const page = await browser.newPage();
    const core = await startAndroid(page, { ...opts, vault, platform: 'macos', pickDir: null });
    await mustBeOn(page, 'Zavolat Evě', 'macOS: the launch landing');
    assert.deepEqual(await logoMenuItems(page), ['About Tegg', 'Settings…'], 'macOS: the logo menu is unchanged');
    for (const t of EXCLUDED_PALETTE) assert.ok((await paletteFor(page, t)).some((o) => o.startsWith(t)), `macOS: the palette still lists ${t}`);
    await switcherMenuItem(page, 'Open folder as vault…');
    await eventually(() => callsOf(core, 'vault_pick_dir'), (c) => c.length > 0, 1500);
    assert.equal((await callsOf(core, 'vault_pick_dir')).length, 1, 'macOS: Open folder as vault… shows the folder picker');
    assert.ok(!(await callsOf(core, 'vault_start')).length, 'macOS: no vault_start');
    await page.close();
    const empty = await browser.newPage();
    await startAndroid(empty, { platform: 'macos', vault: null });
    await must(chooser(empty), 'macOS: the chooser');
    assert.ok(await seen(chooser(empty).getByRole('button', { name: 'Choose…' }).or(chooser(empty).locator('[data-command="vault.pickDir"]')), 1000) ||
      await seen(chooser(empty).locator('[data-command="import.open"]'), 500) || await seen(chooser(empty).getByRole('button', { name: /^Import/ }), 500), 'macOS: the chooser keeps its desktop controls');
    await empty.close();
  }

  // Android.
  const page = await browser.newPage();
  const core = await startAndroid(page, { ...opts, vault, platform: 'android' });
  await mustBeOn(page, 'Zavolat Evě', 'Android: the launch landing from vault_start');
  await startReads(core, 'Android');
  assert.deepEqual(await logoMenuItems(page), ['Settings…'], 'Android: the logo menu has no About Tegg');
  for (const t of EXCLUDED_PALETTE) assert.ok(!(await paletteFor(page, t)).some((o) => o.startsWith(t)), `Android: the palette lists no ${t}`);
  for (const t of ['Reveal vault in Finder', 'New type…', 'Add starter types…', 'Rename tag…', 'Delete tag…', 'New view…', 'Open graph', 'Delete permanently…']) {
    assert.ok(!(await paletteFor(page, t)).some((o) => o.startsWith(t)), `Android: the palette lists no ${t} (groups P5, J, V, O)`);
  }

  // A user action that needs an excluded command: renaming by the title (note_rename, group J).
  const title = await must(page.getByRole('textbox', { name: 'Title', exact: true }), 'textbox "Title"', 5000);
  await title.click();
  await page.keyboard.press('Meta+a');
  await page.keyboard.type('Zavolat Evě zítra');
  await page.keyboard.press('Enter');
  const alert = await must(page.getByRole('alert').filter({ hasText: S.unsupported }), `alert "${S.unsupported}"`, 3000);
  assert.equal(await alert.getAttribute('aria-modal'), null, 'the alert is non-modal');
  assert.equal(await page.locator('[role="dialog"][aria-modal="true"], [aria-modal="true"]').count(), 0, 'no modal');
  assert.deepEqual(await callsOf(core, 'note_rename'), [], 'no invoke of note_rename was sent (refused in the client)');
  assert.ok(await seen(page.getByRole('textbox', { name: 'Title', exact: true }), 500), 'the page keeps its state (the note stays open)');
  assert.deepEqual(await core.writesTo(), [], 'nothing was written');

  // The switcher's Open folder as vault… shows RA4, without a folder dialog.
  await page.keyboard.press('Escape');
  await switcherMenuItem(page, 'Open folder as vault…');
  await must(chooser(page), 'Open folder as vault… shows the Android chooser');
  await must(chooser(page).getByText(S.found, { exact: true }), `section "${S.found}"`);
  assert.equal(await chooser(page).locator('[data-command="import.open"], [data-command="vault.pickDir"]').count(), 0, 'no import.open or vault.pickDir control');
  assert.deepEqual(await callsOf(core, 'vault_pick_dir'), [], 'no folder dialog (vault_pick_dir)');
  await startReads(core, 'Android, at the end');
  await page.close();
});

// ------------------------------------------------------------------------------------------------ FR-VLT-01 AC-18

test('fr_vlt_01_ac18_remembered_vault_never_shows_chooser', async ({ browser }) => {
  const { vault, opts } = shellAtPhone();
  const opening = { state: 'opening', name: 'shell', path: SHELL_PATH } as const;
  for (const order of ['a: the event before vault_start resolves', 'b: the event after it', 'c: vault_start answers open at once'] as const) {
    const page = await browser.newPage();
    const which = order[0];
    const core = await startAndroid(page, {
      ...opts, vault,
      start: which === 'c' ? { state: 'open' } : opening,
      holdStartMs: which === 'a' ? 3100 : 0,
    });
    if (which !== 'c') {
      await sleep(3000);
      await core.setStart({ state: 'open' });
    }
    await mustBeOn(page, 'Zavolat Evě', `${order}: the page ends on the launch landing (FR-UX-02 AC-16)`, 8000);
    await sleep(500);
    assert.equal(await core.seenChooser(), false, `${order}: the chooser was never in the DOM`);
    await startReads(core, order);
    assert.equal((await callsOf(core, 'link_resolve')).length, 1, `${order}: exactly one link_resolve for the landing (NFR-PERF-05 AC-3)`);
    assert.equal((await callsOf(core, 'note_read')).filter((c) => (c.args as { path?: string })?.path === EVA).length, 1, `${order}: exactly one note_read of the landing`);
    assert.equal((await callsOf(core, 'note_read')).length, 1, `${order}: no other note_read`);
    await page.close();
  }
});

// ------------------------------------------------------------------------------------------------ FR-VLT-01 AC-19

test('fr_vlt_01_ac19_opening_state_and_failure', async ({ browser }) => {
  const { vault, opts } = shellAtPhone();
  const page = await browser.newPage();
  const core = await startAndroid(page, { ...opts, vault, start: { state: 'opening', name: 'shell', path: SHELL_PATH } });
  const status = await must(page.getByRole('status').filter({ hasText: 'Opening shell…' }), 'status "Opening shell…"', 5000);
  assert.equal((await status.innerText()).trim(), 'Opening shell…', 'the status text');
  assert.equal(await typesList(page).count(), 0, 'opening: no sidebar entries (no Types list)');
  assert.equal(await sidebar(page).getByText('Inbox', { exact: true }).count(), 0, 'opening: no sidebar entries (no Inbox)');
  assert.equal(await core.seenChooser(), false, 'opening: no chooser');
  const options = await paletteFor(page, '');
  for (const o of options) {
    assert.ok(/^(Create new vault…|Open vault…|Go to Settings|Theme|Use (light|dark|system)|Light|Dark|System|Switch theme|Toggle theme)/.test(o), `opening: the palette offers only D-137's no-vault commands; got "${o}"`);
  }
  assert.ok(options.some((o) => o.startsWith('Create new vault…')) && options.some((o) => o.startsWith('Go to Settings')), `opening: D-137's commands are offered: ${options.join(' | ')}`);
  await startReads(core, 'opening');

  await core.setStart({ state: 'open' });
  await mustBeOn(page, 'Zavolat Evě', 'open: the landing', 5000);
  await core.emit('index:progress', { done: 120, total: 500, state: 'running' });
  const prog = await must(page.getByRole('status', { name: 'Indexing progress' }), 'status "Indexing progress" (FR-UX-07 AC-7)');
  assert.match(await prog.innerText(), /Indexing 120 of 500/, 'index:progress after open shows as on the desktop');
  await page.close();

  const gone = `${SHARED}/Documents/tegg-la-x/Smazaný trezor`;
  const failed = await browser.newPage();
  const f = await startAndroid(failed, { vault: null, start: { state: 'failed', path: gone, kind: 'NotFound' } });
  await must(chooser(failed), 'failed: the chooser', 5000);
  assert.ok(await seen(chooser(failed).getByText(gone, { exact: false }), 1000), `failed: the FR-VLT-01 AC-7 message names ${gone}`);
  assert.ok(await seen(chooser(failed).getByText(S.found, { exact: true }), 1000), 'failed: it is the Android chooser (RA4)');
  const cmds = (await f.calls()).map((c) => c.cmd);
  assert.ok(!cmds.includes('vault_create') && !cmds.includes('vault_open'), 'failed: nothing is created or opened at the old path');
  await startReads(f, 'failed');
  await failed.close();
});

// ------------------------------------------------------------------------------------------------ FR-VLT-01 AC-20

test('fr_vlt_01_ac20_no_vault_without_all_files_access', async ({ browser }) => {
  for (const remembered of [true, false]) {
    const how = remembered ? 'a remembered vault' : 'no vault remembered';
    const page = await browser.newPage();
    const core = await startAndroid(page, { vault: null, granted: false, start: remembered ? { state: 'needsAccess', path: SHELL_PATH } : { state: 'needsAccess' } });
    const screen = await must(accessScreen(page), `${how}: main "${S.accessTitle}"`, 5000);
    await must(screen.getByRole('heading', { name: S.accessTitle }), `${how}: the heading`);
    assert.ok(await seen(screen.getByText(S.accessBody, { exact: true }), 500), `${how}: the body text`);
    await must(screen.getByRole('button', { name: S.openSettings }), `${how}: button "${S.openSettings}"`);
    const vaultLine = screen.getByText(`Vault: ${SHELL_PATH}`, { exact: true });
    if (remembered) assert.ok(await seen(vaultLine, 500), `${how}: "Vault: ${SHELL_PATH}"`);
    else assert.equal(await screen.getByText(/^Vault: /).count(), 0, `${how}: no Vault: line`);
    await sleep(1000);
    assert.equal(await core.seenChooser(), false, `${how}: the chooser was never shown`);
    assert.equal(await sidebar(page).count(), 0, `${how}: no sidebar`);
    assert.equal(await typesList(page).count(), 0, `${how}: no type count (no 0)`);
    const cmds = (await core.calls()).map((c) => c.cmd);
    for (const c of ['vault_find', 'vault_open', 'index_type_counts', 'index_list', 'note_read']) assert.ok(!cmds.includes(c), `${how}: ${c} is not called`);
    await startReads(core, how);
    await page.close();
  }
});

// ------------------------------------------------------------------------------------------------ FR-VLT-01 AC-21

test('fr_vlt_01_ac21_open_settings_and_recheck', async ({ page }) => {
  const { vault, opts } = shellAtPhone();
  const core = await startAndroid(page, { ...opts, vault, granted: false, start: { state: 'needsAccess', path: SHELL_PATH } });
  const screen = await must(accessScreen(page), `main "${S.accessTitle}"`, 5000);
  const button = await must(screen.getByRole('button', { name: S.openSettings }), `button "${S.openSettings}"`);
  assert.equal(await button.getAttribute('data-command'), 'android.openSettings', 'data-command="android.openSettings"');
  // TalkBack's linear order: the heading, the texts and the button are in the page's reading order, the button focusable.
  const order = await screen.evaluate((m, s) => {
    const text = (m as HTMLElement).innerText;
    return [text.indexOf(s.title), text.indexOf(s.body.slice(0, 30)), text.indexOf('Vault: '), text.indexOf(s.button)];
  }, { title: S.accessTitle, body: S.accessBody, button: S.openSettings });
  assert.ok(order.every((i) => i >= 0) && order[0] < order[1] && order[1] < order[2] && order[2] < order[3], `reading order heading, body, Vault:, button: ${order}`);
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => (document.activeElement as HTMLElement | null)?.textContent?.trim()), S.openSettings, 'Tab reaches Open settings');

  await button.click();
  await eventually(() => callsOf(core, 'storage_access_settings'), (c) => c.length === 1, 1500);
  assert.equal((await callsOf(core, 'storage_access_settings')).length, 1, 'Open settings calls storage_access_settings once');
  const before = (await callsOf(core, 'vault_start')).length;
  await core.visibility('hidden');
  await sleep(200);
  await core.visibility('visible');
  await eventually(() => callsOf(core, 'vault_start'), (c) => c.length > before, 2000);
  assert.ok((await callsOf(core, 'vault_start')).length > before, 'the return to the page asks vault_start again (the resume fallback)');
  await must(screen.getByText(S.stillOff, { exact: true }), `still off: "${S.stillOff}"`, 2000);
  assert.ok(await seen(screen.getByRole('button', { name: S.openSettings }), 200), 'still off: the screen stays');
  assert.equal(await core.seenChooser(), false, 'still off: no chooser');

  await core.setStart({ state: 'opening', name: 'shell', path: SHELL_PATH });
  await core.setStart({ state: 'open' });
  await mustBeOn(page, 'Zavolat Evě', 'granted: the remembered vault opens', 2000);
  const counts = new Map(await eventually(() => typeEntries(page), (e) => e.length >= 4, 3000));
  for (const [t, n] of [['Pages', 2], ['Quick Notes', 2], ['Schůzky', 1]] as const) assert.equal(counts.get(t), n, `type count ${t} ${n}`);
  assert.ok([...counts.entries()].some(([t, n]) => /^recept\b/.test(t) && n === 1), `type count recept 1: ${JSON.stringify([...counts])}`);
});

// ------------------------------------------------------------------------------------------------ FR-VLT-01 AC-23

test('fr_vlt_01_ac23_android_chooser', async ({ browser }) => {
  const found = [
    { name: 'Archiv', path: `${SHARED}/Documents/Staré/Archiv`, rel: 'Documents/Staré/Archiv' },
    { name: 'Poznámky', path: `${SHARED}/Documents/Poznámky`, rel: 'Documents/Poznámky' },
    { name: 'Tegg', path: `${SHARED}/Documents/Tegg`, rel: 'Documents/Tegg' },
  ];
  const recent = [
    { name: 'shell', path: SHELL_PATH, exists: true },
    { name: 'Smazaný', path: `${SHARED}/Documents/Smazaný`, exists: false },
  ];
  const page = await browser.newPage();
  const core = await startAndroid(page, { vault: null, start: { state: 'none' }, recent, found, findHoldMs: 1000, dirs: { [found[1].path]: { ...newEmptyVault('Poznámky') }, [SHELL_PATH]: { ...shellVault(), name: 'shell' } } });
  const c = await must(chooser(page), 'main "Choose a vault"', 5000);
  await must(c.getByRole('heading', { name: 'Choose a vault' }).or(c.getByText('Choose a vault', { exact: true })), 'heading "Choose a vault"');
  await must(c.getByText(S.searching, { exact: true }), `"${S.searching}" while vault_find runs`, 900);
  await must(c.getByText(S.recent, { exact: true }), `section "${S.recent}"`);
  const recentButtons = c.locator('[data-command="vault.openRecent"]');
  assert.equal(await recentButtons.count(), 1, 'Recent vaults: only the existing entry');
  assert.match(await recentButtons.first().innerText(), new RegExp(`shell[\\s\\S]*${SHELL_PATH.replace(/\//g, '\\/')}`), 'the recent entry shows its name and path');
  await must(c.getByText(S.found, { exact: true }), `section "${S.found}"`);
  const foundButtons = c.locator('[data-command="vault.openFound"]');
  await eventually(() => foundButtons.count(), (n) => n === 3, 2000);
  const texts = await foundButtons.allInnerTexts();
  assert.equal(texts.length, 3, 'three found vaults');
  found.forEach((f, i) => {
    assert.ok(texts[i].includes(f.name) && texts[i].includes(f.rel), `found entry ${i + 1}: ${f.name} with ${f.rel}; got ${texts[i]}`);
  });
  assert.equal(await c.getByText(S.searching, { exact: true }).count(), 0, 'the searching text goes once vault_find answered');
  const field = await must(c.getByRole('textbox', { name: S.path }), `textbox "${S.path}"`);
  assert.equal(await field.getAttribute('autocapitalize'), 'off', 'no capitalisation');
  assert.equal(await field.getAttribute('autocorrect'), 'off', 'no autocorrect');
  assert.equal(await field.getAttribute('spellcheck'), 'false', 'no spellcheck');
  const open = await must(c.locator('[data-command="vault.openPath"]'), `button "${S.openPath}"`);
  assert.equal((await open.innerText()).trim(), S.openPath, 'the Open button');
  await must(c.locator('[data-command="vault.new"]'), 'Create new vault');
  assert.equal(await c.locator('[data-command="import.open"], [data-command="vault.pickDir"]').count(), 0, 'no Import… and no Choose…');
  assert.equal(await c.getByRole('button', { name: /^Import…$|^Choose…$/ }).count(), 0, 'no Import… or Choose… button');
  const missing = await c.locator('button, input, select, textarea, a[href]').evaluateAll((els) => els.filter((e) => !e.hasAttribute('data-command') && !(e as HTMLElement).closest('[data-command]')).map((e) => (e as HTMLElement).outerHTML.slice(0, 80)));
  assert.deepEqual(missing, [], 'every control has a data-command (FR-UX-03 AC-8)');
  await foundButtons.nth(1).click();
  await eventually(() => callsOf(core, 'vault_open'), (x) => x.length > 0, 2000);
  assert.deepEqual((await callsOf(core, 'vault_open')).map((x) => (x.args as { path: string }).path), [found[1].path], 'an entry opens its path');
  assert.deepEqual(await callsOf(core, 'vault_pick_dir'), [], 'no folder dialog');
  await startReads(core, 'chooser');
  await page.close();

  const none = await browser.newPage();
  await startAndroid(none, { vault: null, start: { state: 'none' }, found: [] });
  await must(chooser(none).getByText(S.noneFound, { exact: true }), `"${S.noneFound}" for an empty answer`, 5000);
  await none.close();
});

// ------------------------------------------------------------------------------------------------ FR-VLT-01 AC-26 (L5)

test('fr_vlt_01_ac26_new_vault_on_android', async ({ browser }) => {
  const form = (page: Page) => page.getByRole('form', { name: 'New vault' });
  const page = await browser.newPage();
  const core = await startAndroid(page, { vault: null, start: { state: 'none' } });
  await (await must(chooser(page).locator('[data-command="vault.new"]'), 'Create new vault', 5000)).click();
  const loc = await must(form(page).getByRole('textbox', { name: 'Location' }), 'textbox "Location" (instead of Choose…)');
  assert.equal(await loc.inputValue(), `${SHARED}/Documents`, 'Location holds <shared root>/Documents');
  assert.equal(await form(page).getByRole('button', { name: 'Choose…' }).count(), 0, 'no Choose… button');
  await form(page).getByRole('textbox', { name: 'Vault name' }).fill('Můj trezor'.normalize('NFD'));
  await form(page).getByRole('radio', { name: 'Empty vault' }).check();
  await (await must(form(page).locator('[data-command="vault.create"]'), 'button Create (vault.create)')).click();
  await eventually(() => callsOf(core, 'vault_create'), (x) => x.length > 0, 2000);
  const created = (await callsOf(core, 'vault_create')).map((x) => x.args as { parent: string; name: string; kind?: string });
  assert.equal(created.length, 1, 'one vault_create');
  assert.equal(created[0].parent, `${SHARED}/Documents`, 'in /storage/emulated/0/Documents');
  assert.equal(String(created[0].name).normalize('NFC'), 'Můj trezor', 'named Můj trezor');
  await must(page.getByRole('button', { name: 'Vault: Můj trezor. Switch vault' }), 'the new vault opens', 5000);
  await page.close();

  const outside = await browser.newPage();
  const o = await startAndroid(outside, { vault: null, start: { state: 'none' }, createError: { kind: 'OutsideShared', message: '' } });
  await (await must(chooser(outside).locator('[data-command="vault.new"]'), 'Create new vault', 5000)).click();
  const l2 = await must(form(outside).getByRole('textbox', { name: 'Location' }), 'textbox "Location"');
  await l2.fill('/data/user/0/app.tegg.desktop/files');
  await form(outside).getByRole('textbox', { name: 'Vault name' }).fill('Můj trezor');
  await form(outside).locator('[data-command="vault.create"]').click();
  await must(outside.getByText(S.outsideShared, { exact: true }), `"${S.outsideShared}"`, 2000);
  assert.ok(await seen(form(outside), 300), 'the form stays with its input');
  assert.equal(await form(outside).getByRole('textbox', { name: 'Vault name' }).inputValue(), 'Můj trezor', 'the name is kept');
  assert.deepEqual(await o.writesTo(), [], 'nothing was created');
  await outside.close();
});

// ------------------------------------------------------------------------------------------------ FR-EDT-08 AC-14 (L5)

async function editAndHide(page: Page, core: AndroidHandle, how: string): Promise<{ hiddenAt: number; writes: number[] }> {
  await mustBeOn(page, 'Úvodní stránka', `${how}: Úvodní open`, 5000);
  const body = await must(page.getByRole('textbox', { name: /^⟦?Note body⟧?$/ }), `${how}: textbox "Note body"`, 5000);
  await body.click();
  await page.keyboard.press('Meta+ArrowDown');
  await page.keyboard.type(' Ahoj');
  await sleep(100);
  const hiddenAt = await core.visibility('hidden');
  await sleep(1600);
  const writes = (await callsOf(core, 'note_write')).filter((c) => (c.args as { path?: string })?.path === UVODNI && String((c.args as { text?: string })?.text ?? '').includes('Ahoj')).map((c) => (c.at ?? 0) - hiddenAt);
  return { hiddenAt, writes };
}

test('fr_edt_08_ac14_flush_when_backgrounded', async ({ browser }) => {
  const id = /^id:\s*(\S+)/m.exec(shellVault().files[UVODNI] ?? '')?.[1] ?? null;
  const base = { ...shellAtPhone().opts, vault: { ...shellVault(), name: 'shell' }, last: { path: UVODNI, id } };

  const mac = await browser.newPage();
  const m = await editAndHide(mac, await startAndroid(mac, { ...base, platform: 'macos' }), 'macOS');
  assert.ok(m.writes.length >= 1, 'macOS: the edit is still saved by the debounce');
  // The desktop's autosave debounce, measured at red time, ends about 300 ms after the last key (the AC says 1 s): the
  // edit 100 ms before hidden is written about 200 ms after it. A write within 100 ms of hidden would be the event's.
  assert.ok(m.writes[0] > 100, `macOS: visibilitychange changes nothing (the write waits for the debounce; it started ${m.writes[0]} ms after hidden)`);
  await mac.close();

  const phone = await browser.newPage();
  const a = await editAndHide(phone, await startAndroid(phone, { ...base, platform: 'android' }), 'Android');
  assert.ok(a.writes.length >= 1, 'Android: the edit is written');
  assert.ok(a.writes[0] >= 0 && a.writes[0] <= 50, `Android: a note_write with the edit starts within 50 ms of hidden (got ${a.writes[0]} ms)`);
  await phone.close();
});
