// Slice AND-3, L5p (projects `phone-webkit`, `phone-chromium`; the macOS part of AR-03 AC-15 on a desktop page in the
// same test): docs/acceptance/android-edit.md, quality on AND-3's surfaces:
// - FR-UX-03 AC-60 (every new control is a command), AR-03 AC-15 (no excluded action; the desktop unchanged), FR-UX-08
//   AC-30 (the editing surfaces are named), FR-UX-05 AC-29 (contrast while editing), NFR-OTH-02 AC-27 (catalog and
//   pseudo-locale).
// Contract docs/contracts/android-edit.md §8, §10, §12, §13 (command ids), §14 (strings), §15.1, §17.1. The surfaces are
// reached one by one through `eachSurface` (one fresh page per surface).
// Red-test readings (reported): "the hidden commands AND-3 shows are exactly …" is checked at L1
// (app/test/android_edit.ac.test.ts); here every shown control carries a registered command and running it by id has
// the tap's effect for one control of each kind.
// Written from the ACs and the contract only (D-61).
import { test, type Browser, type Locator, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import { axeContrast, colourLeaks } from './read-helpers';
import { pseudoLocale } from './helpers';
import {
  EDIT_NOW, PE, blockTypeGroup, controls, desktopPage, editVault, eventually, formatBar, formatButton, keyboard, loadVault, main, mergeBanner, moreButton,
  moreMenu, must, needBody, nfc, noteBody, panel, phonePage, propsSheet, runById, savedText, seen, setCaret, sleep, startDesktop, startPhone, tap, tapToEdit,
  typeSheet, ui, unwrappedTexts, writeCalls, type PhoneHandle, type PhoneOptions,
} from './phone-helpers';
import { inboxVault } from './capture-helpers';
import { ime } from './phone-ime';

test.use({ timezoneId: 'Europe/Prague' });

type Surface = { how: string; scope: (page: Page) => Locator };
/** AND-3's surfaces, each reached on a fresh page: the callback sees the surface shown. */
async function eachSurface(browser: Browser, fn: (page: Page, s: Surface, core: PhoneHandle) => Promise<void>, o: PhoneOptions = {}) {
  const openPsani = async (page: Page) => {
    const core = await startPhone(page, { vault: editVault(), route: `note/${PE.psani}`, now: EDIT_NOW, ...o });
    await needBody(page, 'Psaní');
    await tapToEdit(page, 'Konec');
    await setCaret(page, 'Konec.', 'end');
    return core;
  };
  const steps: [string, (page: Page) => Promise<PhoneHandle>, (page: Page) => Locator][] = [
    ['the bar', openPsani, (p) => formatBar(p)],
    ['the Block type row', async (p) => { const c = await openPsani(p); await tap(p, formatButton(p, 'Heading'), 'Heading'); return c; }, (p) => blockTypeGroup(p)],
    ['Link suggestions', async (p) => { const c = await openPsani(p); await ime(p, [{ text: ' [[C' }]); return c; }, (p) => panel(p, 'Link suggestions')],
    ['Tag suggestions', async (p) => { const c = await openPsani(p); await ime(p, [{ text: ' #p' }]); return c; }, (p) => panel(p, 'Tag suggestions')],
    ['the type sheet', async (p) => { const c = await startPhone(p, { vault: editVault(), route: 'inbox', now: EDIT_NOW, ...o }); await runById(p, 'object.new'); return c; }, (p) => typeSheet(p)],
    ['the Properties sheet', async (p) => { const c = await startPhone(p, { vault: loadVault('Typy', ['types', 'new-empty/.tegg']), route: 'note/Schůzky/2026-10-07 Porada.md', now: EDIT_NOW, ...o }); await needBody(p, 'Porada'); await runById(p, 'phone.properties'); return c; }, (p) => propsSheet(p)],
    ['More actions', async (p) => { const c = await startPhone(p, { vault: editVault(), route: `note/${PE.psani}`, now: EDIT_NOW, ...o }); await needBody(p, 'Psaní'); await (await must(moreButton(p), 'More actions')).click(); return c; }, (p) => moreMenu(p)],
    ['the merge banner', async (p) => {
      const c = await openPsani(p);
      await c.writeControl({ hold: true });
      await ime(p, [{ text: 'X' }]);
      await c.setFile(PE.psani, editVault().files[nfc(PE.psani)].replace('Konec.', 'Konec jinde.'));
      await c.release();
      await must(mergeBanner(p), 'the banner', 2500);
      return c;
    }, (p) => mergeBanner(p)],
    ['Compare versions', async (p) => {
      const c = await openPsani(p);
      await c.writeControl({ hold: true });
      await ime(p, [{ text: 'X' }]);
      await c.setFile(PE.psani, editVault().files[nfc(PE.psani)].replace('Konec.', 'Konec jinde.'));
      await c.release();
      await (await must(mergeBanner(p).getByRole('button', { name: 'Compare' }), 'Compare', 2500)).click();
      return c;
    }, (p) => p.getByRole('dialog', { name: 'Compare versions' })],
    ['the Create offer', async (p) => {
      const c = await startPhone(p, { vault: loadVault('Odkazy', ['backlinks', 'new-empty/.tegg']), route: 'note/Pages/Rozbité odkazy.md', now: EDIT_NOW, ...o });
      await needBody(p, 'Rozbité odkazy');
      await tap(p, noteBody(p).locator('[data-wikilink], .chip, a').filter({ hasText: 'Neexistuje' }).first(), '[[Neexistuje]]');
      return c;
    }, (p) => p.getByRole('dialog', { name: 'Create note' })],
    ['the conflict actions', async (p) => {
      const c = await startPhone(p, { vault: loadVault('Konflikty', ['conflicts', 'new-empty/.tegg']), route: 'conflicts', now: EDIT_NOW, ...o });
      await main(p).getByRole('list', { name: 'Conflicts' }).getByRole('link').first().click();
      return c;
    }, (p) => main(p)],
    ['the conflict confirmation', async (p) => {
      const c = await startPhone(p, { vault: loadVault('Konflikty', ['conflicts', 'new-empty/.tegg']), route: 'conflicts', now: EDIT_NOW, ...o });
      await main(p).getByRole('list', { name: 'Conflicts' }).getByRole('link').first().click();
      await (await must(p.getByRole('button', { name: 'Keep this version' }).first(), 'Keep this version')).click();
      return c;
    }, (p) => p.getByRole('dialog', { name: 'Move to trash?' })],
    ['Merge versions', async (p) => {
      const c = await startPhone(p, { vault: loadVault('Konflikty', ['conflicts', 'new-empty/.tegg']), route: 'conflicts', now: EDIT_NOW, ...o });
      await main(p).getByRole('list', { name: 'Conflicts' }).getByRole('link').first().click();
      await (await must(p.getByRole('button', { name: 'Merge…' }), 'Merge…')).click();
      return c;
    }, (p) => p.getByRole('dialog', { name: 'Merge versions' })],
    ['the Inbox with Reviewed', async (p) => startPhone(p, { vault: inboxVault(), route: 'inbox', now: EDIT_NOW, ...o }), (p) => main(p)],
    ['task checkboxes', async (p) => startPhone(p, { vault: loadVault('Úkoly', ['tasks', 'new-empty/.tegg', 'views-tasks']), route: 'type/task', now: EDIT_NOW, ...o }), (p) => main(p)],
  ];
  for (const [how, go, scope] of steps) {
    const page = await phonePage(browser);
    try {
      const core = await go(page);
      await must(scope(page), `${how} is shown`, 4000);
      await fn(page, { how, scope }, core);
    } finally {
      await page.close();
    }
  }
}

// ------------------------------------------------------------------------------------------------ FR-UX-03 AC-60

test('fr_ux_03_ac60_commands_after_and3', async ({ browser }) => {
  test.setTimeout(600_000);
  await eachSurface(browser, async (page, s) => {
    const registered = new Set(await page.evaluate(() => ((window as any).__TEGG_TEST__?.commands?.() ?? []) as string[]));
    assert.ok(registered.size > 0, `${s.how}: __TEGG_TEST__.commands() lists the registry`);
    const ctl = (await controls(page, s.scope(page))).filter((c) => !c.inert && !c.text && !c.row && c.role !== 'option' && !((c.role === 'link' || c.role === 'checkbox') && c.exempt) && ['button', 'link', 'tab', 'menuitem', 'menuitemradio', 'checkbox', 'radio', 'switch'].includes(c.role));
    assert.ok(ctl.length > 0, `${s.how}: has controls`);
    const missing = ctl.filter((c) => !c.command || (!registered.has(c.command) && !registered.has(c.command.split(':')[0]))).map((c) => `${c.role} "${c.name.slice(0, 30)}" → ${c.command ?? '(none)'}`);
    assert.deepEqual(missing, [], `${s.how}: every control carries the data-command of a registered command`);
  });
  // running by id has the tap's effect: edit.bold, task.complete:<path>, note.markReviewed:<path>, sidebar.pin, object.trash
  let page = await phonePage(browser);
  let core = await startPhone(page, { vault: editVault(), route: `note/${PE.deset}`, now: EDIT_NOW });
  await needBody(page, 'Deset bloků');
  await tapToEdit(page, 'Pátý');
  await setCaret(page, 'blok', 0, { select: true });
  assert.equal(await runById(page, 'edit.bold'), 'ok', 'edit.bold runs');
  assert.ok((await savedText(core, PE.deset, 3000))?.includes('Pátý **blok**'), 'edit.bold by id bolds the selection');
  assert.equal(await runById(page, 'sidebar.pin'), 'ok', 'sidebar.pin runs');
  assert.ok(await eventually(async () => (await core.pinCalls()).length, (n) => n === 1, 2000), 'sidebar.pin by id pins');
  await page.close();
  page = await phonePage(browser);
  core = await startPhone(page, { vault: inboxVault(), route: 'inbox', now: EDIT_NOW });
  assert.equal(await runById(page, 'note.markReviewed:Quick Notes/Koupit mléko.md'), 'ok', 'note.markReviewed:<path> runs');
  assert.ok(await eventually(async () => (await writeCalls(core)).length, (n) => n === 1, 2000), 'and writes the item');
  await page.close();
  page = await phonePage(browser);
  core = await startPhone(page, { vault: loadVault('Úkoly', ['tasks', 'new-empty/.tegg', 'views-tasks']), route: 'type/task', now: EDIT_NOW });
  assert.equal(await runById(page, 'task.complete:Tasks/Zalít květiny.md'), 'ok', 'task.complete:<path> runs');
  assert.ok(await eventually(async () => (await writeCalls(core)).map((w) => w.path), (p) => p.includes('Tasks/Zalít květiny.md'), 2000), 'and completes the task');
  await page.close();
  page = await phonePage(browser);
  core = await startPhone(page, { vault: editVault(), route: `note/${PE.cil}`, now: EDIT_NOW });
  await needBody(page, 'Cíl');
  assert.equal(await runById(page, 'object.trash'), 'ok', 'object.trash runs');
  assert.ok(await eventually(async () => (await writeCalls(core)).map((w) => w.cmd), (c) => c.includes('object_trash'), 2000), 'and moves the note to the trash');
  await page.close();
});

// ------------------------------------------------------------------------------------------------ AR-03 AC-15

const EXCLUDED = ['note_rename', 'tag_rename', 'tag_delete', 'merge_start', 'type_move_plan', 'type_move', 'folder_move_preview', 'tidy_now', 'value_remove_start', 'type_delete_start', 'inbox_bulk', 'starter_add', 'backup_restore', 'job_undo', 'job_redo', 'type_create', 'type_patch', 'type_delete', 'trash_delete', 'trash_empty', 'open_external', 'media_pick'];

test('ar_03_ac15_platform_layer_after_and3', async ({ browser }) => {
  test.setTimeout(600_000);
  // the DOM walk (AR-03 AC-13) on AND-3's surfaces: running every control's command reaches no excluded command
  await eachSurface(browser, async (page, s, core) => {
    const ids = [...new Set((await controls(page, s.scope(page))).map((c) => c.command).filter((c): c is string => !!c))];
    const n = (await core.calls()).length;
    for (const id of ids) await runById(page, id);
    await sleep(300);
    const bad = (await core.calls()).slice(n).map((c) => c.cmd).filter((c) => EXCLUDED.includes(c));
    assert.deepEqual(bad, [], `${s.how}: no control reaches an excluded command`);
  });
  // the desktop: with 'macos' none of RA15's bar, RA18's panels or the merge banner renders
  const { page, context } = await desktopPage(browser);
  const core = await startDesktop(page, { vault: editVault(), route: `note/${PE.psani}`, now: EDIT_NOW });
  const body = await must(page.getByRole('textbox', { name: 'Note body' }), 'desktop: Psaní\'s editor', 8000);
  await body.click();
  await page.keyboard.press('End');
  await page.keyboard.type(' [[C');
  await must(page.getByRole('listbox', { name: 'Link suggestions' }), 'desktop: its own Link suggestions popover');
  assert.equal(await page.locator('.phone-panel, .phone-format-bar').count(), 0, 'desktop: no phone panel and no format bar');
  await page.keyboard.press('Escape');
  await core.writeControl({ hold: true });
  await page.keyboard.type('X');
  await core.setFile(PE.psani, editVault().files[nfc(PE.psani)].replace('Konec.', 'Konec jinde.'));
  await core.release();
  await sleep(2000);
  assert.equal(await page.locator('.phone-merge').count(), 0, 'desktop: no phone merge banner (the desktop\'s merge dialog instead)');
  assert.equal(await page.getByRole('toolbar', { name: 'Formatting' }).locator('xpath=self::*[contains(@class, "phone-format-bar")]').count(), 0, 'desktop: no RA15 bar');
  await context.close();
});

// ------------------------------------------------------------------------------------------------ FR-UX-08 AC-30

test('fr_ux_08_ac30_talkback_while_editing', async ({ page, browser }) => {
  await startPhone(page, { vault: editVault(), route: `note/${PE.psani}`, now: EDIT_NOW });
  const body = await needBody(page, 'Psaní');
  const desc = await body.evaluate((b) => { const id = b.getAttribute('aria-describedby'); return id ? (document.getElementById(id)?.textContent ?? '').trim() : null; });
  assert.equal(desc, 'Psaní', 'the body is textbox Note body with the note\'s title as its description');
  await tapToEdit(page, 'Konec');
  const bar = await must(formatBar(page), 'toolbar "Formatting"');
  const names = await bar.getByRole('button').evaluateAll((bs) => bs.map((b) => [b.getAttribute('aria-label') ?? (b as HTMLElement).innerText.trim(), b.getAttribute('aria-pressed'), b.getAttribute('aria-disabled')]));
  assert.deepEqual(names.map((n) => n[0]), ['Heading', 'Bold', 'Italic', 'Link', 'Tag', 'Bulleted list', 'Checklist', 'Indent', 'Outdent', 'Undo', 'Redo'], 'RA15\'s names');
  for (const [n, pressed] of names) if (['Heading', 'Bold', 'Italic', 'Bulleted list', 'Checklist'].includes(n as string)) assert.ok(pressed === 'true' || pressed === 'false', `${n} carries aria-pressed`);
  assert.equal(names.find((n) => n[0] === 'Undo')?.[2], 'true', 'Undo carries aria-disabled with an empty history');
  // the merge banner is an alert; the sheets are aria-modal with the page behind them inert
  const p2 = await phonePage(browser);
  const c2 = await startPhone(p2, { vault: editVault(), route: `note/${PE.psani}`, now: EDIT_NOW });
  await needBody(p2, 'Psaní');
  await tapToEdit(p2, 'Konec');
  await c2.writeControl({ hold: true });
  await ime(p2, [{ text: 'X' }]);
  await c2.setFile(PE.psani, editVault().files[nfc(PE.psani)].replace('Konec.', 'Konec jinde.'));
  await c2.release();
  const banner = await must(mergeBanner(p2), 'the banner', 2500);
  assert.equal(await banner.getAttribute('role'), 'alert', 'the merge banner is an alert');
  await keyboard(p2, false);
  await p2.close();
  for (const [what, open, sheet] of [
    ['the type sheet', async (p: Page) => { await runById(p, 'object.new'); }, (p: Page) => typeSheet(p)],
    ['the Properties sheet', async (p: Page) => { await runById(p, 'phone.properties'); }, (p: Page) => propsSheet(p)],
  ] as const) {
    const p = await phonePage(browser);
    await startPhone(p, { vault: editVault(), route: `note/${PE.psani}`, now: EDIT_NOW });
    await needBody(p, 'Psaní');
    await open(p);
    const s = await must(sheet(p), what);
    assert.equal(await s.getAttribute('aria-modal'), 'true', `${what}: aria-modal`);
    assert.ok(await main(p).evaluate((m) => !!m.closest('[inert]') || m.hasAttribute('inert')), `${what}: the page behind is inert`);
    await p.close();
  }
});

// ------------------------------------------------------------------------------------------------ FR-UX-05 AC-29

test('fr_ux_05_ac29_contrast_while_editing', async ({ browser }) => {
  test.setTimeout(900_000);
  for (const theme of ['light', 'dark'] as const) {
    await eachSurface(browser, async (page, s) => {
      assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), theme, `${s.how}: the ${theme} theme`);
      assert.deepEqual(await axeContrast(page), [], `${theme}, ${s.how}: axe color-contrast reports no violation`);
      if (theme === 'dark') assert.deepEqual(await colourLeaks(page, 'dark'), [], `dark, ${s.how}: no light colour (FR-UX-05 AC-5)`);
    }, { uiState: ui({ theme }) });
  }
  // a text selection in the body, and the bar with a pressed and a disabled button
  const page = await phonePage(browser);
  await startPhone(page, { vault: editVault(), route: `note/${PE.deset}`, now: EDIT_NOW, uiState: ui({ theme: 'dark' }) });
  await needBody(page, 'Deset bloků');
  await tapToEdit(page, 'Pátý');
  await setCaret(page, 'blok', 0, { select: true });
  await tap(page, formatButton(page, 'Bold'), 'Bold');
  assert.equal(await formatButton(page, 'Bold').getAttribute('aria-pressed'), 'true', 'a pressed button');
  assert.deepEqual(await axeContrast(page), [], 'dark: the selection and the pressed and disabled buttons');
  await page.close();
});

// ------------------------------------------------------------------------------------------------ NFR-OTH-02 AC-27

test('nfr_oth_02_ac27_strings_of_and3', async ({ browser }) => {
  test.setTimeout(600_000);
  await eachSurface(browser, async (page, s) => {
    for (const [what, loc] of [['the surface', s.scope(page)], ['the app bar', page.getByRole('banner')], ['a sheet', page.getByRole('dialog')]] as const) {
      if (!(await seen(loc, 100))) continue;
      assert.deepEqual(await unwrappedTexts(loc), [], `${s.how}, ${what}: every visible text is inside ⟦ ⟧ (user content aside)`);
    }
  }, { prelude: pseudoLocale });
});
