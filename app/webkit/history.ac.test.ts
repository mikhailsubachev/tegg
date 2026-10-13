// MS3 slice 3B.1, L5 (WebKit + fake core): Back and Forward (FR-NAV-03 AC-1, AC-2, AC-4…AC-7) and the logo
// (FR-UX-01 AC-5), D-164, D-165.
// Written from docs/acceptance/app-shell.md and docs/contracts/ms3-shell.md §3.7, §5, §11, §12 only (D-61). Every
// lookup goes through `must`/`seen` and node:assert, so a missing element is an AssertionError (TS-I1).
import { test, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { newEmptyVault } from '../ui/test/fake-core';
import {
  P, eventually, focused, mainName, must, mustBeOn, newObjectDialog, nonReadCalls, onPage, openNote, paletteDialog,
  runCommand, seen, sidebar, sleep, start, switcherDialog, theme,
} from './helpers';
import { IDS, R, article, firstVisibleBlockText, headingFn, placement, readVault, scrollToTop, ui, watchNetwork } from './read-helpers';

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

/** AC-1 setup: the fixture on `home`, then Porada (switcher) → type/schůzka (breadcrumb) → search (⌘⇧F). */
async function visitThree(page: Page) {
  await mustBeOn(page, 'Home', 'the fixture opens on home');
  await openNote(page, PORADA);
  const crumb = await must(page.getByRole('main').getByRole('link', { name: 'Schůzky', exact: true }), 'breadcrumb link "Schůzky"');
  await crumb.click();
  await mustBeOn(page, 'Schůzky', 'breadcrumb → type/schůzka');
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
  await t.back(page); await mustBeOn(page, 'Home', 'Back again');
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
    await t.back(page); await mustBeOn(page, 'Home', `${t.name}: Back again`);
    await t.back(page); await sleep(300);
    assert.equal(await mainName(page), 'Home', `${t.name}: Back with nothing behind does nothing`);
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
  await mustBeOn(page, 'Home', 'landing');
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
  assert.equal(await mainName(page), 'Home', 'nothing happened');

  await openNote(page, PORADA);
  assert.equal(await eventually(() => disabled(page, 'Back'), (v) => !v, 1000), false, 'Back enabled with an entry behind');
  assert.equal(await disabled(page, 'Forward'), true, 'Forward still disabled');
  await backBtn(page).click({ force: true });
  await mustBeOn(page, 'Home', 'Back');
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
  const vault = readVault();
  vault.files[R.cil] = `${vault.files[R.cil].replace(/\n*$/, '\n')}\nOdkaz ven: [[Odkazy]]\n`; // Cíl needs a link to follow
  await start(page, { vault, last: { path: R.cil, id: IDS[R.cil] } });
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
  await start(page, { vault: readVault(), last: { path: R.odkazy, id: IDS[R.odkazy] } });
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
    await mustBeOn(page, 'Home', 'landing');
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
    await mustBeOn(page, 'Home', 'Back past the gone note to home');
    assert.deepEqual(await nonReadCalls(core), [], 'no write');
  });
}

test('fr_nav_03_ac5_back_to_a_renamed_note_shows_it_at_its_new_path', async ({ page }) => {
  const core = await start(page);
  await mustBeOn(page, 'Home', 'landing');
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
  assert.match((await page.getByRole('main').innerText()).normalize('NFC'), /Porada týmu/, 'breadcrumb shows the new file name');
  assert.equal(await page.getByText('This note was moved or deleted').count(), 0, 'not shown as deleted');
  const reads = (await core.calls()).slice(before).filter((c) => c.cmd === 'note_read').map((c) => String((c.args as any)?.path).normalize('NFC'));
  assert.ok(reads.includes(renamed), `read from the new path: ${reads.join(', ')}`);
});

// ------------------------------------------------------------------------------------------------ AC-6

for (const [dialog, key, loc] of [
  ['palette', 'Meta+k', paletteDialog], ['switcher', 'Meta+o', switcherDialog], ['new_object', 'Meta+n', newObjectDialog],
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
  for (const [step, want] of [['back', 'Schůzky'], ['back', PORADA], ['forward', 'Schůzky'], ['back', PORADA], ['back', 'Home']] as const) {
    await (await must(sidebar(page), 'sidebar')).focus().catch(() => {});
    if (step === 'back') await backBtn(page).click({ force: true }); else await fwdBtn(page).click({ force: true });
    await mustBeOn(page, want, `${step}`);
    const f = await eventually(() => focused(page), (x) => x.heading && x.inMain, 1500);
    assert.ok(f.heading && f.inMain, `${step} to ${want}: focus on the page heading, got ${JSON.stringify(f)}`);
  }
});

// ------------------------------------------------------------------------------------------------ AC-7

test('fr_nav_03_ac7_back_forward_write_nothing_and_record_opens', async ({ page }) => {
  const core = await start(page);
  await visitThree(page);
  const from = (await core.calls()).length;
  await page.keyboard.press('Meta+BracketLeft'); await mustBeOn(page, 'Schůzky', 'Back');
  await page.keyboard.press('Meta+BracketLeft'); await mustBeOn(page, PORADA, 'Back');
  await page.keyboard.press('Meta+BracketLeft'); await mustBeOn(page, 'Home', 'Back');
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
  await mustBeOn(page, 'Home', 'landing');
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
  await mustBeOn(page, 'Home', 'the other vault opens');
  await sleep(300);
  assert.equal(await disabled(page, 'Back'), true, 'Back disabled in the other vault');
  assert.equal(await disabled(page, 'Forward'), true, 'Forward disabled in the other vault');
  await page.keyboard.press('Meta+BracketLeft');
  await sleep(300);
  assert.equal(await mainName(page), 'Home', '⌘[ does nothing');
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
  await mustBeOn(page, 'Home', 'the new vault opens');
  await sleep(300);
  assert.equal(await disabled(page, 'Back'), true, 'Back disabled in the new vault');
  assert.equal(await disabled(page, 'Forward'), true, 'Forward disabled in the new vault');
});

// ------------------------------------------------------------------------------------------------ FR-UX-01 AC-5

const ASSETS = resolve(import.meta.dirname, '../ui/src/assets');
const asset = (name: string) => { try { return readFileSync(resolve(ASSETS, name), 'utf8'); } catch { return null; } };

async function logoInfo(page: Page) {
  const link = await must(sidebar(page).getByRole('link', { name: 'Tegg home', exact: true }), 'sidebar link "Tegg home"');
  return link.evaluate(async (a) => {
    const imgs = [...a.querySelectorAll('img')] as HTMLImageElement[];
    const walker = document.createTreeWalker(a, NodeFilter.SHOW_TEXT);
    const texts: string[] = [];
    for (let n = walker.nextNode(); n; n = walker.nextNode()) if ((n.textContent ?? '').trim()) texts.push(n.textContent!.trim());
    const img = imgs[0];
    let body: string | null = null;
    if (img) {
      if (!img.complete) await new Promise((r) => { img.onload = r; img.onerror = r; setTimeout(r, 2000); });
      try { body = await (await fetch(img.currentSrc || img.src)).text(); } catch { body = null; }
    }
    return { imgs: imgs.length, svgs: a.querySelectorAll('svg').length, texts, alt: img?.getAttribute('alt') ?? null, loaded: !!img && img.naturalWidth > 0, body };
  });
}
const norm = (s: string | null) => (s ?? '').replace(/\r\n/g, '\n').trim();

test('fr_ux_01_ac5_logo_image_follows_the_theme_without_network', async ({ page }) => {
  const hits = watchNetwork(page);
  await start(page, { uiState: ui('light') });
  assert.equal(await theme(page), 'light', 'setup: light theme');
  const light = asset('logo-light.svg');
  const dark = asset('logo-dark.svg');
  assert.ok(light && dark, 'logo assets exist (ms3-shell §12.3)');
  let info = await logoInfo(page);
  assert.equal(info.imgs, 1, 'the link shows one image');
  assert.equal(info.svgs, 0, 'no inline SVG beside the image');
  assert.deepEqual(info.texts, [], 'no visible text node in the link (the wordmark is part of the image)');
  assert.equal(info.alt, '', 'decorative image: alt=""');
  assert.ok(info.loaded, 'the image loaded');
  assert.equal(norm(info.body), norm(light), 'light theme shows logo-light.svg');

  await page.evaluate(() => { (window as any).__noReload = true; });
  await runCommand(page, 'Theme: Dark');
  assert.equal(await eventually(() => theme(page), (v) => v === 'dark', 1500), 'dark', 'dark theme');
  info = await eventually(() => logoInfo(page), (v) => norm(v.body) === norm(dark), 2000);
  assert.equal(norm(info.body), norm(dark), 'dark theme shows logo-dark.svg');
  assert.equal(await page.evaluate(() => (window as any).__noReload === true), true, 'switched without a reload');
  await runCommand(page, 'Theme: Light');
  info = await eventually(() => logoInfo(page), (v) => norm(v.body) === norm(light), 2000);
  assert.equal(norm(info.body), norm(light), 'back to logo-light.svg');
  assert.deepEqual(hits, [], 'no network request (NFR-SEC-01)');
});

test('fr_ux_01_ac5_logo_link_keeps_its_name_and_goes_home', async ({ page }) => {
  await start(page, { uiState: ui('dark') });
  const link = await must(sidebar(page).getByRole('link', { name: 'Tegg home', exact: true }), 'sidebar link "Tegg home"');
  assert.equal(await link.getAttribute('aria-label'), 'Tegg home', 'aria-label stays Tegg home');
  const info = await logoInfo(page);
  assert.equal(info.imgs, 1, 'one image');
  assert.equal(norm(info.body), norm(asset('logo-dark.svg')), 'dark asset in the dark theme');
  await runCommand(page, 'Go to Inbox');
  await mustBeOn(page, 'Inbox', 'setup');
  await link.click();
  assert.ok(await onPage(page, 'Home', 2000), 'the logo link goes home');
});

