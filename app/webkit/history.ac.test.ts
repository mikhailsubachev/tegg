// MS3 slice 3B.1, L5 (WebKit + fake core): Back and Forward (FR-NAV-03 AC-1, AC-2, AC-4…AC-7) and the About and
// Settings button's menu (FR-UX-01 AC-5; its version label, D-597, is in version_label.ac.test.ts), D-164, D-165.
// Written from docs/acceptance/app-shell.md and docs/contracts/ms3-shell.md §3.7, §5, §11, §12 only (D-61). Every
// lookup goes through `must`/`seen` and node:assert, so a missing element is an AssertionError (TS-I1).
import { test, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import { newEmptyVault, setPreviewMode } from '../ui/test/fake-core';
import {
  P, eventually, focused, mainName, must, mustBeOn, nonReadCalls, onPage, openNote, paletteDialog,
  runCommand, seen, sidebar, sleep, start, switcherDialog, theme, typesList,
} from './helpers';
import { IDS, R, article, firstVisibleBlockText, headingFn, placement, readVault, scrollToTop, ui } from './read-helpers';

const PORADA = '2026-10-07 Porada';
const backBtn = (page: Page) => page.getByRole('button', { name: 'Back', exact: true });
const fwdBtn = (page: Page) => page.getByRole('button', { name: 'Forward', exact: true });

async function disabled(page: Page, which: 'Back' | 'Forward'): Promise<boolean> {
  const b = await must(which === 'Back' ? backBtn(page) : fwdBtn(page), `title-bar button "${which}"`);
  return (await b.getAttribute('aria-disabled')) === 'true';
}
async function description(page: Page, which: 'Back' | 'Forward'): Promise<string> {
  const b = await must(which === 'Back' ? backBtn(page) : fwdBtn(page), `title-bar button "${which}"`);
  return b.evaluate((e) => {
    const ids = (e.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean);
    return (e.getAttribute('aria-description') ?? ids.map((id) => document.getElementById(id)?.textContent ?? '').join(' ')).trim();
  });
}
const mouse = (page: Page, button: 3 | 4) =>
  page.evaluate((b) => { document.body.dispatchEvent(new MouseEvent('mouseup', { button: b, bubbles: true, cancelable: true })); }, button);

type Trigger = { name: string; back: (p: Page) => Promise<void>; forward: (p: Page) => Promise<void> };
const TRIGGERS: Trigger[] = [
  { name: 'title_bar_buttons', back: async (p) => { await (await must(backBtn(p), 'Back')).click({ force: true }); }, forward: async (p) => { await (await must(fwdBtn(p), 'Forward')).click({ force: true }); } },
  { name: 'shortcuts', back: (p) => p.keyboard.press('Meta+BracketLeft'), forward: (p) => p.keyboard.press('Meta+BracketRight') },
  { name: 'palette_commands', back: (p) => runCommand(p, 'Go back'), forward: (p) => runCommand(p, 'Go forward') },
  { name: 'mouse_buttons', back: (p) => mouse(p, 3), forward: (p) => mouse(p, 4) },
];

/** AC-1 setup: the fixture on `home`, then Porada (switcher) → type/schůzka (sidebar Types list; no breadcrumb, D-315)
 *  → search (⌘⇧F). */
async function visitThree(page: Page) {
  await mustBeOn(page, 'Inbox', 'the fixture opens on the Inbox (D-614)');
  await openNote(page, PORADA);
  const entry = await must(typesList(page).getByRole('link', { name: /^Schůzky\b/ }), 'sidebar Types entry "Schůzky"');
  await entry.click();
  await mustBeOn(page, 'Schůzky', 'Types list → type/schůzka');
  await page.keyboard.press('Meta+Shift+f');
  await mustBeOn(page, 'Search', '⌘⇧F → search');
}

// ------------------------------------------------------------------------------------------------ AC-1

test('fr_nav_03_ac1_back_and_forward_through_the_visited_routes', async ({ page }) => {
  await start(page);
  await visitThree(page);
  const t = TRIGGERS[1];
  await t.back(page); await mustBeOn(page, 'Schůzky', 'Back from search');
  await t.back(page); await mustBeOn(page, PORADA, 'Back again');
  await t.back(page); await mustBeOn(page, 'Inbox', 'Back again');
  await t.forward(page); await mustBeOn(page, PORADA, 'Forward');
  await t.forward(page); await mustBeOn(page, 'Schůzky', 'Forward again');
});

test('fr_nav_03_ac1_new_navigation_after_back_drops_forward_entries', async ({ page }) => {
  await start(page);
  await visitThree(page);
  await page.keyboard.press('Meta+BracketLeft'); await mustBeOn(page, 'Schůzky', 'Back');
  await page.keyboard.press('Meta+BracketLeft'); await mustBeOn(page, PORADA, 'Back');
  assert.equal(await disabled(page, 'Forward'), false, 'Forward enabled after Back');
  await runCommand(page, 'Go to Inbox');
  await mustBeOn(page, 'Inbox', 'new navigation');
  assert.equal(await eventually(() => disabled(page, 'Forward'), (v) => v, 1000), true, 'no forward entries after a new navigation');
  await page.keyboard.press('Meta+BracketRight');
  await sleep(300);
  assert.equal(await mainName(page), 'Inbox', 'Forward does nothing');
  await page.keyboard.press('Meta+BracketLeft'); await mustBeOn(page, PORADA, 'Back from Inbox goes to Porada');
});

test('fr_nav_03_ac1_same_route_adds_no_entry', async ({ page }) => {
  await start(page);
  await visitThree(page);
  await page.keyboard.press('Meta+Shift+f'); // search again: the same route string
  await mustBeOn(page, 'Search', 'still search');
  await runCommand(page, 'Go to Search');
  await mustBeOn(page, 'Search', 'still search');
  await page.keyboard.press('Meta+BracketLeft');
  await mustBeOn(page, 'Schůzky', 'one Back leaves search: the repeats added no entry');
});

// ------------------------------------------------------------------------------------------------ AC-2

for (const t of TRIGGERS) {
  test(`fr_nav_03_ac2_${t.name}_go_back_and_forward`, async ({ page }) => {
    const core = await start(page);
    await visitThree(page);
    await t.back(page); await mustBeOn(page, 'Schůzky', `${t.name}: Back from search`);
    await t.back(page); await mustBeOn(page, PORADA, `${t.name}: Back again`);
    await t.back(page); await mustBeOn(page, 'Inbox', `${t.name}: Back again`);
    await t.back(page); await sleep(300);
    assert.equal(await mainName(page), 'Inbox', `${t.name}: Back with nothing behind does nothing`);
    await t.forward(page); await mustBeOn(page, PORADA, `${t.name}: Forward`);
    await t.forward(page); await mustBeOn(page, 'Schůzky', `${t.name}: Forward again`);
    await t.forward(page); await mustBeOn(page, 'Search', `${t.name}: Forward again`);
    await t.forward(page); await sleep(300);
    assert.equal(await mainName(page), 'Search', `${t.name}: Forward with nothing ahead does nothing`);
    assert.deepEqual(await nonReadCalls(core), [], 'no write');
  });
}

test('fr_nav_03_ac2_title_bar_buttons_disabled_only_without_history', async ({ page }) => {
  await start(page);
  await mustBeOn(page, 'Inbox', 'landing');
  assert.equal(await disabled(page, 'Back'), true, 'Back disabled on the first route');
  assert.equal(await disabled(page, 'Forward'), true, 'Forward disabled on the first route');
  for (const w of ['Back', 'Forward'] as const) {
    assert.doesNotMatch(await description(page, w), /Coming in/, `${w}: no "Coming in" description (built control)`);
    assert.equal(await (w === 'Back' ? backBtn(page) : fwdBtn(page)).getAttribute('data-command'), w === 'Back' ? 'nav.back' : 'nav.forward', `${w}: data-command`);
  }
  // Activating a disabled control or its shortcut does nothing.
  await backBtn(page).click({ force: true });
  await fwdBtn(page).click({ force: true });
  await page.keyboard.press('Meta+BracketLeft');
  await page.keyboard.press('Meta+BracketRight');
  await sleep(300);
  assert.equal(await mainName(page), 'Inbox', 'nothing happened');

  await openNote(page, PORADA);
  assert.equal(await eventually(() => disabled(page, 'Back'), (v) => !v, 1000), false, 'Back enabled with an entry behind');
  assert.equal(await disabled(page, 'Forward'), true, 'Forward still disabled');
  await backBtn(page).click({ force: true });
  await mustBeOn(page, 'Inbox', 'Back');
  assert.equal(await eventually(() => disabled(page, 'Back'), (v) => v, 1000), true, 'Back disabled at the start');
  assert.equal(await disabled(page, 'Forward'), false, 'Forward enabled with an entry ahead');
  for (const w of ['Back', 'Forward'] as const) assert.doesNotMatch(await description(page, w), /Coming in/, `${w}: no "Coming in"`);
});

// ------------------------------------------------------------------------------------------------ AC-4

const lineTol = 24; // ± one line

async function topIs(page: Page, heading: string): Promise<number | null> {
  const p = await placement(page, headingFn(heading));
  return p ? p.top - p.viewTop : null;
}

test('fr_nav_03_ac4_back_restores_scroll_position', async ({ page }) => {
  await page.addInitScript(() => { const w = window as any; w.__TEGG_TEST__ = { ...(w.__TEGG_TEST__ ?? {}), readView: true }; }); // D-215: the read view
  const vault = readVault();
  vault.files[R.cil] = `${vault.files[R.cil].replace(/\n*$/, '\n')}\nOdkaz ven: [[Odkazy]]\n`; // Cíl needs a link to follow
  // D-949: the link is followed with a single click, so the steps run under preview.mode = off.
  await start(page, { vault, last: { path: R.cil, id: IDS[R.cil] }, ...setPreviewMode('off') });
  await mustBeOn(page, 'Cíl', 'landing on Cíl', 5000);
  await must(article(page, 'Cíl'), 'Cíl body');
  await scrollToTop(page, headingFn('Druhá kapitola'));
  await sleep(200);
  assert.equal(await firstVisibleBlockText(page), 'Druhá kapitola', 'setup: Druhá kapitola is the first visible block');
  const link = await must(article(page, 'Cíl').getByRole('link', { name: 'Odkazy', exact: true }), 'link to Odkazy in Cíl');
  await link.dispatchEvent('click'); // follow the link without scrolling it into view
  await mustBeOn(page, 'Odkazy', 'followed the link');
  await page.keyboard.press('Meta+BracketLeft');
  await mustBeOn(page, 'Cíl', 'Back to Cíl');
  const off = await eventually(() => topIs(page, 'Druhá kapitola'), (v) => v !== null && Math.abs(v) <= lineTol, 2000);
  assert.ok(off !== null && Math.abs(off) <= lineTol, `Druhá kapitola is again the first visible block (offset ${off})`);
});

test('fr_nav_03_ac4_fragment_entry_restored_to_its_scroll_not_the_fragment', async ({ page }) => {
  await page.addInitScript(() => { const w = window as any; w.__TEGG_TEST__ = { ...(w.__TEGG_TEST__ ?? {}), readView: true }; }); // D-215: the read view
  // D-949: the link is followed with a single click, so the steps run under preview.mode = off.
  await start(page, { vault: readVault(), last: { path: R.odkazy, id: IDS[R.odkazy] }, ...setPreviewMode('off') });
  await mustBeOn(page, 'Odkazy', 'landing on Odkazy', 5000);
  const block = await must(page.locator('main li', { hasText: 'Blok:' }).getByRole('link'), 'link [[Cíl#^blok1]]');
  await block.click();
  await mustBeOn(page, 'Cíl', '[[Cíl#^blok1]]');
  await sleep(300);
  await scrollToTop(page, headingFn('Úvod')); // the user scrolls back to the top before leaving
  await sleep(200);
  assert.equal(await firstVisibleBlockText(page), 'Úvod', 'setup: Úvod first visible');
  await page.keyboard.press('Meta+Shift+f');
  await mustBeOn(page, 'Search', 'left Cíl');
  await page.keyboard.press('Meta+BracketLeft');
  await mustBeOn(page, 'Cíl', 'Back to Cíl');
  const off = await eventually(() => topIs(page, 'Úvod'), (v) => v !== null && Math.abs(v) <= lineTol, 2000);
  await sleep(300); // a late fragment scroll would move it
  const settled = await topIs(page, 'Úvod');
  assert.ok(off !== null && settled !== null && Math.abs(settled) <= lineTol, `restored to the top as left, not re-scrolled to ^blok1 (offset ${settled})`);
});

// ------------------------------------------------------------------------------------------------ AC-5

async function moveFile(page: Page, from: string, to: string | null) {
  await page.evaluate(([f, t]) => {
    const fake = (window as any).__teggFake;
    if (t) fake.vault.files[t] = fake.vault.files[f!];
    delete fake.vault.files[f!];
    return fake.emit('vault:changed', { paths: t ? [f, t] : [f] });
  }, [from, to] as const);
}

for (const how of ['trashed', 'deleted'] as const) {
  test(`fr_nav_03_ac5_back_to_a_${how}_note_shows_the_message_and_keeps_history`, async ({ page }) => {
    const core = await start(page);
    await mustBeOn(page, 'Inbox', 'landing');
    await openNote(page, PORADA);
    await page.keyboard.press('Meta+Shift+f');
    await mustBeOn(page, 'Search', 'search');
    await moveFile(page, P.porada, how === 'trashed' ? `.trash/${P.porada}` : null);
    await sleep(300);
    await page.keyboard.press('Meta+BracketLeft');
    assert.ok(await seen(page.getByText('This note was moved or deleted'), 3000), 'deleted-note message');
    assert.equal(await page.getByRole('article').count(), 0, 'no content');
    assert.equal(await disabled(page, 'Back'), false, 'history kept: home is behind');
    assert.equal(await disabled(page, 'Forward'), false, 'history kept: search is ahead');
    await page.keyboard.press('Meta+BracketRight');
    await mustBeOn(page, 'Search', 'Forward to search');
    await page.keyboard.press('Meta+BracketLeft');
    await page.keyboard.press('Meta+BracketLeft');
    await mustBeOn(page, 'Inbox', 'Back past the gone note to the Inbox');
    assert.deepEqual(await nonReadCalls(core), [], 'no write');
  });
}

test('fr_nav_03_ac5_back_to_a_renamed_note_shows_it_at_its_new_path', async ({ page }) => {
  await page.addInitScript(() => { const w = window as any; w.__TEGG_TEST__ = { ...(w.__TEGG_TEST__ ?? {}), readView: true }; }); // D-215: the read view
  const core = await start(page);
  await mustBeOn(page, 'Inbox', 'landing');
  await openNote(page, PORADA);
  await page.keyboard.press('Meta+Shift+f');
  await mustBeOn(page, 'Search', 'search');
  const renamed = 'Schůzky/2026-10-07 Porada týmu.md';
  await moveFile(page, P.porada, renamed);
  await sleep(300);
  const before = (await core.calls()).length;
  await page.keyboard.press('Meta+BracketLeft');
  await mustBeOn(page, PORADA, 'Back shows the renamed note (same id, title unchanged)');
  assert.ok(await seen(article(page, PORADA), 3000), 'note body shown');
  // No breadcrumb (D-315): the new path shows in the read below.
  assert.equal(await page.getByText('This note was moved or deleted').count(), 0, 'not shown as deleted');
  const reads = (await core.calls()).slice(before).filter((c) => c.cmd === 'note_read').map((c) => String((c.args as any)?.path).normalize('NFC'));
  assert.ok(reads.includes(renamed), `read from the new path: ${reads.join(', ')}`);
});

// ------------------------------------------------------------------------------------------------ AC-6

// D-520: ⌘N no longer opens a dialog (it navigates to an unsaved draft), so the New object case is gone.
// D-760: ⌘O and the Quick switcher dialog are removed, so the switcher case is gone too.
for (const [dialog, key, loc] of [
  ['palette', 'Meta+k', paletteDialog],
] as const) {
  test(`fr_nav_03_ac6_no_navigation_while_${dialog}_is_open`, async ({ page }) => {
    await start(page);
    await visitThree(page);
    await page.keyboard.press('Meta+BracketLeft');
    await mustBeOn(page, 'Schůzky', 'setup: an entry in each direction');
    await page.keyboard.press(key);
    await must(loc(page), `${dialog} dialog`);
    await page.keyboard.press('Meta+BracketLeft');
    await page.keyboard.press('Meta+BracketRight');
    await mouse(page, 3);
    await mouse(page, 4);
    await sleep(300);
    assert.ok(await seen(loc(page), 300), `${dialog} still open`);
    await page.keyboard.press('Escape');
    await sleep(200);
    assert.equal(await mainName(page), 'Schůzky', `no navigation while the ${dialog} was open`);
    await page.keyboard.press('Meta+BracketLeft');
    await mustBeOn(page, PORADA, 'Back works again after the dialog closed');
  });
}

test('fr_nav_03_ac6_focus_on_page_heading_after_back_and_forward', async ({ page }) => {
  await start(page);
  await visitThree(page);
  for (const [step, want] of [['back', 'Schůzky'], ['back', PORADA], ['forward', 'Schůzky'], ['back', PORADA], ['back', 'Inbox']] as const) {
    await (await must(sidebar(page), 'sidebar')).focus().catch(() => {});
    if (step === 'back') await backBtn(page).click({ force: true }); else await fwdBtn(page).click({ force: true });
    await mustBeOn(page, want, `${step}`);
    // A note gets the caret in its body (D-247, FR-EDT-01 AC-11); other pages focus their heading (D-130).
    const note = want === PORADA;
    const f = await eventually(() => focused(page), (x) => x.inMain && (note ? x.label === 'Note body' : x.heading), 1500);
    assert.ok(f.inMain && (note ? f.label === 'Note body' : f.heading), `${step} to ${want}: ${note ? 'caret in the note body' : 'focus on the page heading'}, got ${JSON.stringify(f)}`);
  }
});

// ------------------------------------------------------------------------------------------------ AC-7

test('fr_nav_03_ac7_back_forward_write_nothing_and_record_opens', async ({ page }) => {
  const core = await start(page);
  await visitThree(page);
  const from = (await core.calls()).length;
  await page.keyboard.press('Meta+BracketLeft'); await mustBeOn(page, 'Schůzky', 'Back');
  await page.keyboard.press('Meta+BracketLeft'); await mustBeOn(page, PORADA, 'Back');
  await page.keyboard.press('Meta+BracketLeft'); await mustBeOn(page, 'Inbox', 'Back');
  await page.keyboard.press('Meta+BracketRight'); await mustBeOn(page, PORADA, 'Forward');
  await sleep(300);
  const calls = (await core.calls()).slice(from);
  const opened = calls.filter((c) => c.cmd === 'nav_opened').map((c) => String((c.args as any)?.path).normalize('NFC'));
  assert.deepEqual(opened, [P.porada, P.porada], 'Porada shown twice by Back/Forward, recorded with nav_opened each time');
  assert.deepEqual(calls.filter((c) => c.cmd === 'ui_state_set'), [], 'nothing written to ui-state.json');
  assert.deepEqual(await nonReadCalls(core), [], 'no vault write');
  assert.equal(await core.writes(), 0);
});

async function withHistory(page: Page) {
  await mustBeOn(page, 'Inbox', 'landing');
  await openNote(page, PORADA);
  await runCommand(page, 'Go to Inbox');
  await mustBeOn(page, 'Inbox', 'inbox');
  await page.keyboard.press('Meta+BracketLeft');
  await mustBeOn(page, PORADA, 'Back');
  assert.equal(await disabled(page, 'Back'), false, 'setup: Back enabled');
  assert.equal(await disabled(page, 'Forward'), false, 'setup: Forward enabled');
}

test('fr_nav_03_ac7_opening_another_vault_clears_history', async ({ page }) => {
  const core = await start(page, { pickDir: '/Users/test/Knihovna', dirs: { '/Users/test/Knihovna': newEmptyVault('Knihovna') } });
  await withHistory(page);
  await runCommand(page, 'Open vault…');
  await (await must(page.getByRole('main', { name: 'Choose a vault' }).getByRole('button', { name: 'Open existing folder' }), 'Open existing folder')).click();
  await mustBeOn(page, 'Inbox', 'the other vault opens');
  await sleep(300);
  assert.equal(await disabled(page, 'Back'), true, 'Back disabled in the other vault');
  assert.equal(await disabled(page, 'Forward'), true, 'Forward disabled in the other vault');
  await page.keyboard.press('Meta+BracketLeft');
  await sleep(300);
  assert.equal(await mainName(page), 'Inbox', '⌘[ does nothing');
  assert.equal(await core.writes(), 0);
});

test('fr_nav_03_ac7_creating_another_vault_clears_history', async ({ page }) => {
  await start(page, { pickDir: '/Users/test' });
  await withHistory(page);
  await runCommand(page, 'Create new vault…');
  const form = page.getByRole('form', { name: 'New vault' });
  if (!(await seen(form, 1000))) await (await must(page.getByRole('main', { name: 'Choose a vault' }).getByRole('button', { name: 'Create new vault' }), 'Create new vault')).click();
  await must(form, 'New vault form');
  await form.getByRole('textbox', { name: 'Vault name' }).fill('Nový trezor');
  await form.getByRole('button', { name: 'Choose…' }).click();
  await form.getByRole('button', { name: 'Create', exact: true }).click();
  await mustBeOn(page, 'Inbox', 'the new vault opens');
  await sleep(300);
  assert.equal(await disabled(page, 'Back'), true, 'Back disabled in the new vault');
  assert.equal(await disabled(page, 'Forward'), true, 'Forward disabled in the new vault');
});

// ------------------------------------------------------------------------------------------------ FR-UX-01 AC-5

// D-220: the logo is the bottom-left button `Tegg: About and Settings` (ms3-shell §3.7), no longer the link `Tegg home`.
const logoButton = (page: Page) => sidebar(page).getByRole('button', { name: 'Tegg: About and Settings', exact: true });
const logoMenu = (page: Page) => page.getByRole('menu', { name: 'About and Settings' });

// D-597: the button shows the version, no logo (the image checks are in version_label.ac.test.ts).
test('fr_ux_01_ac5_logo_button_opens_its_menu', async ({ page }) => {
  const core = await start(page, { uiState: ui('dark') });
  const btn = await must(logoButton(page), 'sidebar button "Tegg: About and Settings"');
  assert.equal(await btn.getAttribute('aria-haspopup'), 'menu', 'aria-haspopup="menu"');
  assert.equal(await btn.getAttribute('aria-expanded'), 'false', 'aria-expanded="false" while closed');
  await runCommand(page, 'Go to Inbox');
  await mustBeOn(page, 'Inbox', 'setup');
  await btn.click();
  const m = await must(logoMenu(page), 'menu "About and Settings"');
  assert.equal(await btn.getAttribute('aria-expanded'), 'true', 'aria-expanded="true" while open');
  const items = (await m.getByRole('menuitem').allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim().replace(/\s*⌘.*$/, ''));
  assert.deepEqual(items, ['About Tegg', 'Settings…'], 'menu items');
  assert.equal(await onPage(page, 'Inbox', 300), true, 'activating the logo no longer goes home (D-220)');
  // Esc closes and returns focus to the button.
  await page.keyboard.press('Escape');
  assert.equal(await eventually(() => logoMenu(page).count(), (n) => n === 0, 1500), 0, 'Esc closes the menu');
  const f = await eventually(() => focused(page), (x) => x.label === 'Tegg: About and Settings', 1500);
  assert.equal(f.label, 'Tegg: About and Settings', 'focus returns to the logo button');
  // About Tegg calls app_about and nothing else.
  await btn.click();
  await (await must(logoMenu(page).getByRole('menuitem', { name: 'About Tegg' }), 'About Tegg')).click();
  const about = await eventually(() => core.calls(), (c) => c.some((x) => x.cmd === 'app_about'), 1500);
  assert.equal(about.filter((x) => x.cmd === 'app_about').length, 1, 'About Tegg calls app_about once');
  assert.equal(await onPage(page, 'Inbox', 300), true, 'About Tegg leaves the route unchanged');
  // Settings… → settings/appearance.
  await btn.click();
  await (await must(logoMenu(page).getByRole('menuitem', { name: 'Settings…' }), 'Settings…')).click();
  await mustBeOn(page, 'Settings: Appearance', 'Settings… → settings/appearance');
  assert.equal(await core.writes(), 0);
});

