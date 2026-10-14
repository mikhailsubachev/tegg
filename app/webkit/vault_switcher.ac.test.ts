// D-219, L5 (WebKit + fake core): FR-VLT-01 AC-16 (vault switcher in the title bar) and the L5 part of AC-17
// (recent vaults in the menu, ⌃⌘1…9, palette commands). The L4 part of AC-17 is crates/tegg-vault/tests/ac_recent.rs.
// Written from docs/acceptance/app-shell.md, docs/contracts/ms3-shell.md §3.7 and §12.5 only (D-61).
import { test, type Locator, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import { newEmptyVault, type RecentVaultDto } from '../ui/test/fake-core';
import {
  eventually, focused, must, mustBeOn, onPage, openNote, paletteOptions, runCommand, seen, absent, sleep, start,
  typeEntries, type FakeCoreHandle,
} from './helpers';

const HERE = '/Users/test/Trezor';
const OTHER = '/Users/test/Knihovna';
const GONE = '/Users/test/Archiv starých poznámek';
const RECENT: RecentVaultDto[] = [
  { name: 'Trezor', path: HERE, exists: true },
  { name: 'Knihovna', path: OTHER, exists: true },
  { name: 'Archiv starých poznámek', path: GONE, exists: false },
];
const SWITCHER = 'Vault: Trezor. Switch vault';

function knihovna() {
  const v = newEmptyVault('Knihovna');
  v.files['.tegg/types/kniha.yml'] = 'version: 1\nname: Kniha\nplural: Knihy\nsystem: false\nfolder: Knihy\nicon: book\ncolor: purple\nreview: false\npreview: []\nattributes: []\n';
  return v;
}

async function open(page: Page, o: { pickDir?: string | null; recent?: RecentVaultDto[] } = {}): Promise<FakeCoreHandle> {
  return start(page, {
    vaultPath: HERE,
    recent: o.recent ?? RECENT,
    pickDir: o.pickDir === undefined ? OTHER : o.pickDir,
    dirs: { [OTHER]: knihovna() },
  });
}

const switcher = (page: Page, name = SWITCHER) => page.getByRole('button', { name, exact: true });
const menu = (page: Page) => page.getByRole('menu', { name: 'Vaults' });
const radios = (page: Page) => menu(page).getByRole('menuitemradio');
const item = (page: Page, name: string) => menu(page).getByRole('menuitem', { name, exact: true });

async function openMenu(page: Page, name = SWITCHER): Promise<Locator> {
  const b = await must(switcher(page, name), `title bar button "${name}"`);
  await b.click();
  return must(menu(page), 'menu "Vaults"');
}

async function vaultOpens(core: FakeCoreHandle) {
  return (await core.calls()).filter((c) => c.cmd === 'vault_open').map((c) => (c.args as { path: string }).path);
}

async function focusIsOnSwitcher(page: Page) {
  return (await eventually(() => focused(page), (f) => f.label === SWITCHER, 1500)).label;
}

// ------------------------------------------------------------------------------------------------ AC-16: the button

test('fr_vlt_01_ac16_switcher_button_in_title_bar_before_back_and_forward', async ({ page }) => {
  await open(page);
  const b = await must(switcher(page), `button "${SWITCHER}"`);
  assert.equal(await b.getAttribute('aria-haspopup'), 'menu', 'aria-haspopup="menu"');
  assert.equal(await b.getAttribute('aria-expanded'), 'false', 'aria-expanded="false" while closed');
  assert.match(await b.innerText(), /Trezor/, 'the vault name is visible text');
  const sb = await b.boundingBox();
  const back = await page.getByRole('button', { name: 'Back', exact: true }).boundingBox();
  const fwd = await page.getByRole('button', { name: 'Forward', exact: true }).boundingBox();
  assert.ok(sb && back && fwd, 'switcher, Back and Forward are shown');
  assert.ok(sb.y + sb.height <= 44 + 1, `the switcher lies in the 44 px title bar (bottom ${sb.y + sb.height})`);
  assert.ok(sb.x + sb.width <= back.x + 0.5 && sb.x + sb.width <= fwd.x + 0.5, 'the switcher comes before Back and Forward');
  const order = await page.evaluate((name) => {
    const all = [...document.querySelectorAll('button, [role="button"]')] as HTMLElement[];
    const idx = (n: string) => all.findIndex((e) => (e.getAttribute('aria-label') ?? e.textContent?.trim()) === n);
    return [idx(name), idx('Back'), idx('Forward')];
  }, SWITCHER);
  assert.ok(order[0] >= 0 && order[0] < order[1] && order[0] < order[2], `DOM order switcher < Back, Forward: ${order}`);
});

/** The computed colour of the dot inside the switcher, and the computed value of each `--type-<name>` token. */
async function dotInfo(page: Page) {
  return page.evaluate(async (name) => {
    const b = [...document.querySelectorAll('button')].find((e) => e.getAttribute('aria-label') === name);
    if (!b) return null;
    const dots = ([...b.querySelectorAll('*')] as HTMLElement[]).filter((e) => {
      const r = e.getBoundingClientRect();
      const bg = getComputedStyle(e).backgroundColor;
      return r.width > 0 && r.width <= 16 && Math.abs(r.width - r.height) <= 1 && !e.textContent?.trim() && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent';
    });
    let palette: string[] = [];
    try {
      const m = await import('/src/shell/vaultColor.ts' as string);
      palette = [...(m.VAULT_COLORS as string[])];
    } catch { /* missing module → empty palette, asserted below */ }
    const probe = document.createElement('span');
    document.body.appendChild(probe);
    const tokenColor = (n: string) => { probe.style.backgroundColor = `var(--type-${n})`; return getComputedStyle(probe).backgroundColor; };
    const tokens = Object.fromEntries(palette.map((n) => [n, tokenColor(n)]));
    probe.remove();
    return { dot: dots.length === 1 ? getComputedStyle(dots[0]).backgroundColor : null, dots: dots.length, palette, tokens };
  }, SWITCHER);
}

async function vaultColorOf(page: Page, path: string): Promise<string | null> {
  return page.evaluate(async (p) => {
    try { return (await import('/src/shell/vaultColor.ts' as string)).vaultColor(p) as string; } catch { return null; }
  }, path);
}

test('fr_vlt_01_ac16_colour_dot_from_the_fixed_palette_and_stable_for_the_path', async ({ page, browser }) => {
  await open(page);
  const first = await dotInfo(page);
  assert.ok(first, 'switcher button');
  assert.equal(first.dots, 1, 'one colour dot in the switcher');
  // The palette is the type colour names of theme/tokens.ts (ms3-shell §12.5).
  const typeNames = await page.evaluate(async () => {
    const t = await import('/src/theme/tokens.ts' as string);
    return Object.keys(t.light as Record<string, string>).map((k) => /^type-([a-z]+)$/.exec(k)?.[1]).filter(Boolean) as string[];
  });
  assert.ok(first.palette.length > 1, 'VAULT_COLORS (shell/vaultColor.ts) is a fixed palette');
  assert.deepEqual([...first.palette].sort(), [...new Set(typeNames)].sort(), 'VAULT_COLORS = the type colour names');
  const want = await vaultColorOf(page, HERE);
  assert.ok(want && first.palette.includes(want), `vaultColor(${HERE}) is in the palette: ${want}`);
  assert.equal(first.dot, first.tokens[want!], `the dot uses var(--type-${want})`);
  // Another session with the same folder path: same colour; NFD spelling of the path: same colour (NFC).
  const p2 = await browser.newPage();
  await open(p2);
  assert.equal((await dotInfo(p2))?.dot, first.dot, 'same path → same colour in another session');
  assert.equal(await vaultColorOf(p2, HERE.normalize('NFD')), want, 'NFD and NFC path give one colour');
  await p2.close();
});

test('fr_vlt_01_ac16_vault_colour_is_fnv1a32_of_the_nfc_path', async ({ page }) => {
  await open(page);
  const fnv = (s: string) => {
    let h = 0x811c9dc5;
    for (const byte of Buffer.from(s.normalize('NFC'), 'utf8')) { h ^= byte; h = Math.imul(h, 0x01000193) >>> 0; }
    return h >>> 0;
  };
  const got = await page.evaluate(async (paths) => {
    try {
      const m = await import('/src/shell/vaultColor.ts' as string);
      return { palette: [...(m.VAULT_COLORS as string[])], colors: paths.map((p) => m.vaultColor(p) as string) };
    } catch { return null; }
  }, [HERE, OTHER, GONE, '/Users/test/Čtenářský deník']);
  assert.ok(got, 'shell/vaultColor.ts exports vaultColor and VAULT_COLORS');
  const want = [HERE, OTHER, GONE, '/Users/test/Čtenářský deník'].map((p) => got.palette[fnv(p) % got.palette.length]);
  assert.deepEqual(got.colors, want);
});

test('fr_vlt_01_ac16_switcher_hidden_in_focus_mode', async ({ page }) => {
  await open(page);
  await openNote(page, '2026-10-07 Porada');
  await must(switcher(page), 'switcher before focus mode');
  await page.keyboard.press('Meta+Shift+Backslash');
  assert.ok(await absent(page.getByRole('tab'), 1500), 'setup: focus mode hides the tab strip');
  assert.ok(await absent(switcher(page), 1500), 'the switcher is hidden in focus mode');
  await page.keyboard.press('Escape');
  assert.ok(await seen(switcher(page), 1500), 'the switcher is back after focus mode');
});

// ------------------------------------------------------------------------------------------------ AC-16: the menu

test('fr_vlt_01_ac16_menu_lists_recent_vaults_then_actions', async ({ page }) => {
  const core = await open(page);
  await openMenu(page);
  assert.equal(await switcher(page).getAttribute('aria-expanded'), 'true', 'aria-expanded="true" while open');
  assert.ok((await core.calls()).some((c) => c.cmd === 'vault_recent'), 'the menu reads vault_recent');
  const seq = await menu(page).evaluate((m) =>
    ([...m.querySelectorAll('[role="menuitemradio"], [role="menuitem"], [role="separator"], hr')] as HTMLElement[]).map((e) =>
      `${e.getAttribute('role') ?? 'separator'}|${e.getAttribute('aria-label') ?? ''}`.replace(/\|$/, '')));
  const roles = seq.map((s) => s.split('|')[0]);
  assert.deepEqual(roles, ['menuitemradio', 'menuitemradio', 'menuitemradio', 'separator', 'menuitem', 'menuitem', 'menuitem'], `menu structure: ${seq.join(', ')}`);
  const texts = (await radios(page).allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim());
  for (const [i, r] of RECENT.entries()) {
    assert.ok(texts[i]?.includes(r.name), `row ${i + 1} shows the name ${r.name}: ${texts[i]}`);
    assert.ok(texts[i]?.includes(r.path), `row ${i + 1} shows the folder path ${r.path}: ${texts[i]}`);
    assert.ok(texts[i]?.includes(`⌃⌘${i + 1}`), `row ${i + 1} shows ⌃⌘${i + 1}: ${texts[i]}`);
  }
  const attr = (i: number, a: string) => radios(page).nth(i).getAttribute(a);
  assert.equal(await attr(0, 'aria-checked'), 'true', 'the open vault is checked');
  assert.notEqual(await attr(1, 'aria-checked'), 'true', 'another vault is not checked');
  assert.notEqual(await attr(2, 'aria-checked'), 'true', 'the missing vault is not checked');
  assert.equal(await attr(2, 'aria-disabled'), 'true', 'a missing folder is aria-disabled');
  assert.ok(texts[2]?.includes('Not found'), `a missing folder shows "Not found": ${texts[2]}`);
  assert.notEqual(await attr(1, 'aria-disabled'), 'true', 'an existing vault is enabled');
  assert.ok(!texts[1]?.includes('Not found'), 'an existing vault shows no "Not found"');
  const actions = await menu(page).getByRole('menuitem').allInnerTexts();
  assert.deepEqual(actions.map((t) => t.replace(/\s+/g, ' ').trim().replace(/\s*⌘.*$/, '')), ['Open folder as vault…', 'Create new vault…', 'Vault settings…']);
});

test('fr_vlt_01_ac16_menu_shows_at_most_nine_recent_vaults_in_order', async ({ page }) => {
  const many: RecentVaultDto[] = [RECENT[0], ...Array.from({ length: 8 }, (_, i) => ({ name: `Trezor č. ${i + 2}`, path: `/Users/test/Trezor č. ${i + 2}`, exists: true }))];
  await open(page, { recent: many });
  await openMenu(page);
  const texts = (await radios(page).allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim());
  assert.equal(texts.length, 9, 'nine rows');
  for (const [i, r] of many.entries()) {
    assert.ok(texts[i].includes(r.path) && texts[i].includes(`⌃⌘${i + 1}`), `row ${i + 1}: ${texts[i]}`);
  }
});

test('fr_vlt_01_ac16_choosing_another_vault_opens_it', async ({ page }) => {
  const core = await open(page);
  await runCommand(page, 'Go to Inbox');
  await mustBeOn(page, 'Inbox', 'setup');
  await openMenu(page);
  await radios(page).filter({ hasText: 'Knihovna' }).first().click();
  await mustBeOn(page, 'Home', 'the other vault lands per FR-UX-02 AC-16');
  assert.deepEqual(await vaultOpens(core), [OTHER], 'one vault_open with the chosen path');
  const labels = (await eventually(() => typeEntries(page), (v) => v.some(([l]) => l === 'Knihy'))).map(([l]) => l);
  assert.ok(labels.includes('Knihy') && !labels.includes('Schůzky'), `Types list replaced: ${labels.join(', ')}`);
  assert.ok(await seen(switcher(page, 'Vault: Knihovna. Switch vault'), 1500), 'the switcher names the new vault');
  assert.ok(await absent(menu(page), 1000), 'the menu is closed');
  assert.equal(await core.writes(), 0, 'no writes');
});

test('fr_vlt_01_ac16_choosing_the_open_vault_only_closes_the_menu', async ({ page }) => {
  const core = await open(page);
  await runCommand(page, 'Go to Inbox');
  await mustBeOn(page, 'Inbox', 'setup');
  await openMenu(page);
  await radios(page).first().click();
  assert.ok(await absent(menu(page), 1500), 'the menu closes');
  await sleep(300);
  assert.equal(await onPage(page, 'Inbox', 500), true, 'the route is unchanged');
  assert.deepEqual(await vaultOpens(core), [], 'no vault_open');
});

test('fr_vlt_01_ac16_missing_vault_cannot_be_chosen', async ({ page }) => {
  const core = await open(page);
  await runCommand(page, 'Go to Inbox');
  await mustBeOn(page, 'Inbox', 'setup');
  await openMenu(page);
  await radios(page).nth(2).click({ force: true }).catch(() => {});
  await sleep(300);
  assert.deepEqual(await vaultOpens(core), [], 'no vault_open for a missing folder');
  assert.equal(await onPage(page, 'Inbox', 500), true, 'the route is unchanged');
});

test('fr_vlt_01_ac16_open_folder_as_vault_uses_the_folder_picker', async ({ page }) => {
  const core = await open(page);
  await runCommand(page, 'Go to Inbox');
  await mustBeOn(page, 'Inbox', 'setup');
  await openMenu(page);
  await (await must(item(page, 'Open folder as vault…'), 'menuitem "Open folder as vault…"')).click();
  await mustBeOn(page, 'Home', 'the picked vault lands per FR-UX-02 AC-16');
  const calls = (await core.calls()).map((c) => c.cmd);
  assert.ok(calls.includes('vault_pick_dir'), 'the folder picker was shown (vault_pick_dir)');
  assert.deepEqual(await vaultOpens(core), [OTHER], 'the picked folder is opened');
  assert.ok(await seen(switcher(page, 'Vault: Knihovna. Switch vault'), 1500), 'the switcher names the new vault');
});

test('fr_vlt_01_ac16_open_folder_as_vault_cancel_changes_nothing', async ({ page }) => {
  const core = await open(page, { pickDir: null });
  await runCommand(page, 'Go to Inbox');
  await mustBeOn(page, 'Inbox', 'setup');
  await openMenu(page);
  await (await must(item(page, 'Open folder as vault…'), 'menuitem "Open folder as vault…"')).click();
  await eventually(() => core.calls(), (c) => c.some((x) => x.cmd === 'vault_pick_dir'), 1500);
  assert.ok((await core.calls()).some((c) => c.cmd === 'vault_pick_dir'), 'the folder picker was shown');
  await sleep(300);
  assert.equal(await onPage(page, 'Inbox', 500), true, 'Cancel: the route is unchanged');
  assert.deepEqual(await vaultOpens(core), [], 'Cancel: no vault_open');
  assert.ok(await seen(switcher(page), 500), 'Cancel: the same vault stays open');
  assert.equal(await core.writes(), 0);
});

test('fr_vlt_01_ac16_create_new_vault_shows_the_new_vault_form', async ({ page }) => {
  const core = await open(page);
  await runCommand(page, 'Go to Inbox');
  await mustBeOn(page, 'Inbox', 'setup');
  await openMenu(page);
  await (await must(item(page, 'Create new vault…'), 'menuitem "Create new vault…"')).click();
  await must(page.getByRole('form', { name: 'New vault' }), 'the New vault form');
  await page.keyboard.press('Escape');
  await mustBeOn(page, 'Inbox', 'Esc returns to the previous route (as AC-15)');
  assert.equal(await core.writes(), 0);
});

test('fr_vlt_01_ac16_vault_settings_opens_settings_vault', async ({ page }) => {
  await open(page);
  await openMenu(page);
  await (await must(item(page, 'Vault settings…'), 'menuitem "Vault settings…"')).click();
  await mustBeOn(page, 'Settings: Vault', 'Vault settings… → settings/vault');
});

test('fr_vlt_01_ac16_escape_closes_the_menu_and_returns_focus', async ({ page }) => {
  await open(page);
  await openMenu(page);
  await page.keyboard.press('Escape');
  assert.ok(await absent(menu(page), 1500), 'Esc closes the menu');
  assert.equal(await focusIsOnSwitcher(page), SWITCHER, 'focus returns to the switcher');
  assert.equal(await switcher(page).getAttribute('aria-expanded'), 'false');
});

test('fr_vlt_01_ac16_click_outside_closes_the_menu_and_returns_focus', async ({ page }) => {
  await open(page);
  await runCommand(page, 'Go to Inbox');
  await mustBeOn(page, 'Inbox', 'setup');
  await openMenu(page);
  const main = await page.getByRole('main').boundingBox();
  assert.ok(main, 'centre pane');
  await page.mouse.click(main.x + main.width - 20, main.y + main.height - 20);
  assert.ok(await absent(menu(page), 1500), 'a click outside closes the menu');
  assert.equal(await focusIsOnSwitcher(page), SWITCHER, 'focus returns to the switcher');
  assert.equal(await onPage(page, 'Inbox', 300), true, 'the route is unchanged');
});

test('fr_vlt_01_ac16_menu_works_from_the_keyboard', async ({ page }) => {
  const core = await open(page);
  const b = await must(switcher(page), 'switcher');
  await b.focus();
  await page.keyboard.press('Enter');
  await must(menu(page), 'Enter opens the menu');
  await page.keyboard.press('ArrowDown');
  const label = await eventually(() => page.evaluate(() => document.activeElement?.textContent ?? ''), (t) => t.includes('Knihovna'), 1000);
  assert.ok(label.includes('Knihovna'), `ArrowDown moves to the second row: ${label}`);
  await page.keyboard.press('Enter');
  await mustBeOn(page, 'Home', 'Enter chooses it');
  assert.deepEqual(await vaultOpens(core), [OTHER]);
});

// ------------------------------------------------------------------------------------------------ AC-17 (L5)

test('fr_vlt_01_ac17_ctrl_cmd_n_opens_the_nth_recent_vault_from_any_route', async ({ browser }) => {
  for (const setup of ['inbox', 'note'] as const) {
    const page = await browser.newPage();
    const core = await open(page);
    if (setup === 'inbox') { await runCommand(page, 'Go to Inbox'); await mustBeOn(page, 'Inbox', 'setup'); }
    else await openNote(page, 'Zavolat Evě');
    await page.keyboard.press('Meta+Control+2');
    await mustBeOn(page, 'Home', `⌃⌘2 from ${setup} opens Knihovna`);
    assert.deepEqual(await vaultOpens(core), [OTHER], `${setup}: vault_open of the 2nd entry`);
    await page.close();
  }
});

test('fr_vlt_01_ac17_ctrl_cmd_n_on_open_missing_or_absent_entry_does_nothing', async ({ page }) => {
  const core = await open(page);
  await runCommand(page, 'Go to Inbox');
  await mustBeOn(page, 'Inbox', 'setup');
  // Red guard: the shortcuts exist (their palette entries), so "nothing happens" isn't vacuous.
  await page.keyboard.press('Meta+k');
  await page.getByRole('combobox', { name: 'Command query' }).fill('Open recent vault 1');
  await sleep(150);
  assert.ok((await paletteOptions(page)).some((t) => /Open recent vault 1/.test(t)), 'palette lists "Open recent vault 1"');
  await page.keyboard.press('Escape');
  for (const k of ['1', '3', '9']) {
    await page.keyboard.press(`Meta+Control+${k}`);
    await sleep(250);
    assert.equal(await onPage(page, 'Inbox', 300), true, `⌃⌘${k}: route unchanged`);
  }
  assert.deepEqual(await vaultOpens(core), [], 'no vault_open for the open, a missing or an absent entry');
  assert.equal(await core.writes(), 0);
});

test('fr_vlt_01_ac17_palette_commands_open_recent_vault_n', async ({ page }) => {
  const core = await open(page);
  await page.keyboard.press('Meta+k');
  await page.getByRole('combobox', { name: 'Command query' }).fill('Open recent vault');
  await sleep(150);
  const opts = (await paletteOptions(page)).map((t) => t.replace(/\s+/g, ' ').trim());
  for (let n = 1; n <= 9; n++) {
    const o = opts.find((t) => new RegExp(`^Open recent vault ${n}\\b`).test(t));
    assert.ok(o, `palette lists "Open recent vault ${n}": ${opts.join(' / ')}`);
    assert.ok(o.includes(`⌃⌘${n}`), `"Open recent vault ${n}" shows ⌃⌘${n}: ${o}`);
  }
  await page.keyboard.press('Escape');
  await runCommand(page, 'Open recent vault 2');
  await mustBeOn(page, 'Home', 'the palette command opens the 2nd entry');
  assert.deepEqual(await vaultOpens(core), [OTHER]);
});

test('fr_vlt_01_ac17_menu_reflects_the_list_after_switching', async ({ page }) => {
  await open(page);
  await openMenu(page);
  await radios(page).filter({ hasText: 'Knihovna' }).first().click();
  await mustBeOn(page, 'Home', 'setup: Knihovna opened');
  await openMenu(page, 'Vault: Knihovna. Switch vault');
  const texts = (await radios(page).allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim());
  assert.ok(texts[0]?.includes(OTHER), `the opened vault is first: ${texts.join(' / ')}`);
  assert.ok(texts[1]?.includes(HERE), `the previous vault is second: ${texts.join(' / ')}`);
  assert.equal(texts.length, 3, 'no duplicates');
  assert.equal(await radios(page).first().getAttribute('aria-checked'), 'true', 'Knihovna is checked');
});
