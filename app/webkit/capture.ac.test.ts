// MS5 slice 5B, L5 (WebKit + fake core): the capture window's page (`capture.html`) loaded on its own with the fake
// core in capture mode (docs/contracts/ms5-capture.md §2.2, §4, §11.2; AP-480), and with a main window sharing the
// vault where a criterion needs both. docs/acceptance/capture.md FR-CAP-01 AC-1 (content), AC-2, AC-3, AC-4, AC-5,
// AC-7, AC-8, AC-10, AC-11, AC-12 (5B part), AC-13 (the panel), AC-14; FR-CAP-04 AC-1 (the call), AC-7, AC-8;
// FR-CAP-05 AC-1, AC-2 (the type); FR-TSK-10 AC-9…AC-12; NFR-SEC-03 AC-4 (the DOM); FR-SYN-06 AC-24 (L5 part).
// Written from the ACs and the contract only (D-61). Every lookup goes through `must`, so a missing page fails an
// assertion (TS-I1).
import { test, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import {
  NOW, absent, callsOf, capStatus, capText, capValue, chips, chooseType, click, creates, description, discardBtn, dropZone, dueBtn, eventually,
  flat, focusName, gotoInbox, groupRegion, inboxVault, isDisabled, must, nfc, prioBtn, saveBtn, seen, sidebarCount, sleep, startCapture,
  startMain, swap, tagCombo, tagInput, textOf, typeBtn, typeInCapture, typeItem, typeMenu, vaultWrites,
} from './capture-helpers';
import { pseudoLocale } from './helpers';
import { axeContrast } from './read-helpers';

test.use({ timezoneId: 'Europe/Prague' });

const ID = /^id: [0-9A-HJKMNP-TV-Z]{26}$/m;
/** The bytes of a capture call with its new id masked. */
const masked = (t: string) => t.replace(/^id: .*$/m, 'id: <ULID>');
const stamps = (now = NOW) => `review: unreviewed\ncreated: ${now}\nmodified: ${now}\n`; // D-595: no `captured`
/** D-604: a Task capture (review workflow off) has no `review` line. */
const plain = (now = NOW) => `created: ${now}\nmodified: ${now}\n`;
async function saveWithKeys(page: Page) {
  await page.keyboard.press('Meta+Enter');
  await sleep(200);
}

// ------------------------------------------------------------------------------------------------ FR-CAP-01 AC-1, AC-2

test('fr_cap_01_ac1_the_window_content_opened_from_the_status_item', async ({ page }) => {
  await startCapture(page, { trigger: 'status-item' });
  assert.equal(flat(await (await must(typeBtn(page), 'button "Type: …"')).getAttribute('aria-label') ?? await typeBtn(page).getAttribute('aria-label')), 'Type: Quick Note', 'the vault default type');
  assert.ok(await seen(page.getByText('Saves to Doručené', { exact: true }), 1000), 'Saves to <vault name>');
  assert.equal(await dueBtn(page).count(), 0, 'no Due control for a Quick Note');
  assert.equal(await prioBtn(page).count(), 0, 'no Priority control');
  // D-688: the window gets its focus a frame after it shows; wait for that state rather than read it once.
  const focus = await eventually(() => focusName(page), (f) => f.name === 'Capture text', 2000);
  assert.deepEqual(focus, { role: 'textbox', name: 'Capture text' }, 'the focus is in Capture text');
});

test('fr_cap_01_ac2_elements_roles_names_and_tab_order', async ({ page }) => {
  await startCapture(page);
  await must(page.getByRole('button', { name: 'Type: Quick Note', exact: true }), 'button Type: Quick Note');
  assert.equal(await page.getByRole('button', { name: 'Type: Quick Note', exact: true }).getAttribute('aria-haspopup'), 'menu', 'Type opens a menu');
  assert.equal(await description(discardBtn(page)), 'Discard · Esc', 'Discard tooltip/description');
  assert.equal(await capText(page).getAttribute('placeholder'), "What's on your mind? The first line becomes the title.", 'placeholder');
  await must(tagCombo(page), 'combobox Add tag…');
  await must(dropZone(page), 'button Add an image or PDF');
  assert.ok(await seen(page.getByText('Lands in the Inbox · unreviewed', { exact: true }), 1000), 'hint');
  assert.ok(await seen(page.getByText('↩ new line', { exact: true }), 1000), 'new-line hint');
  await must(saveBtn(page), 'button Save capture');
  assert.match(flat(await saveBtn(page).innerText()), /Save.*⌘↩/, 'visible text Save with ⌘↩');
  await must(capStatus(page).or(page.locator('[role="status"][aria-label="Capture status"]')), 'status Capture status');
  // Tab order (R55): Type, Discard, Capture text, Add tag…, Add an image or PDF, Save capture.
  const order: string[] = [];
  await capText(page).focus();
  for (let i = 0; i < 3; i++) { await page.keyboard.press('Tab'); order.push((await focusName(page)).name); }
  assert.deepEqual(order.slice(0, 3), ['Add tag…', 'Add an image or PDF', 'Save capture'], 'Tab after Capture text');
  await capText(page).focus();
  await page.keyboard.press('Shift+Tab');
  assert.equal((await focusName(page)).name, 'Discard', 'Shift-Tab reaches Discard');
  await page.keyboard.press('Shift+Tab');
  assert.equal((await focusName(page)).name, 'Type: Quick Note', 'then Type');
});

// ------------------------------------------------------------------------------------------------ FR-CAP-01 AC-3

test('fr_cap_01_ac3_the_type_menu', async ({ page }) => {
  const core = await startCapture(page);
  await click(typeBtn(page), 'Type: Quick Note');
  const menu = await must(typeMenu(page), 'menu Type');
  const items = await menu.getByRole('menuitemradio').evaluateAll((els) => els.map((e) => (e.getAttribute('aria-label') ?? e.textContent ?? '').replace(/\s+/g, ' ').trim()));
  assert.deepEqual(items.map((x) => x.replace(/ (Vault default|⌃⌥T)$/, '')), ['Page', 'Task', 'Quick Note', 'Nápad', 'Schůzka'], 'capture targets in R55 order; no Daily Note, Tag, Image, PDF');
  assert.equal(await description(typeItem(page, 'Quick Note')), 'Vault default', 'the vault default');
  assert.equal(await description(typeItem(page, 'Task')), '⌃⌥T', 'Task shows ⌃⌥T');
  await page.keyboard.press('Escape');
  assert.ok(await absent(typeMenu(page), 1000), 'Esc closes');
  assert.match((await focusName(page)).name, /^Type: /, 'the focus is back on the button');
  await chooseType(page, 'Task');
  assert.equal(flat(await (await must(dueBtn(page), 'Due control')).innerText()), 'Due: No date'); // D-602
  assert.equal(flat(await (await must(prioBtn(page), 'Priority control')).innerText()), 'Priority: None');
  // A priority chosen while Task was the type isn't written after switching to Nápad.
  await click(prioBtn(page), 'Priority');
  await click(page.getByRole('menuitemradio', { name: 'High' }).or(page.getByRole('menuitem', { name: 'High' })), 'High');
  await chooseType(page, 'Nápad');
  assert.equal(await dueBtn(page).count() + await prioBtn(page).count(), 0, 'Due and Priority hidden for Nápad');
  await typeInCapture(page, 'Nápad na víkend');
  await saveWithKeys(page);
  const c = await creates(core);
  assert.equal(c.length, 1, 'one capture');
  assert.ok(!/^priority:/m.test(c[0].text) && !/^due:/m.test(c[0].text), 'no priority or due written for Nápad');
  // Keyboard: ↑/↓ move, ⏎ chooses.
  const page2 = await page.context().newPage();
  await startCapture(page2);
  await click(typeBtn(page2), 'Type');
  await must(typeMenu(page2), 'menu');
  await page2.keyboard.press('ArrowDown');
  await page2.keyboard.press('Enter');
  assert.ok(await absent(typeMenu(page2), 1000), '⏎ chooses and closes');
});

// ------------------------------------------------------------------------------------------------ FR-CAP-01 AC-4

test('fr_cap_01_ac4_enter_is_a_new_line_and_cmd_enter_saves_once', async ({ page }) => {
  const core = await startCapture(page);
  await typeInCapture(page, 'Řádek jedna\nŘádek dva');
  assert.equal(nfc(await capValue(page)), 'Řádek jedna\nŘádek dva', 'two lines');
  assert.deepEqual(await creates(core), [], 'Enter saves nothing');
  await (await must(tagCombo(page), 'Add tag…')).focus();
  await page.keyboard.press('Meta+Enter');
  await page.keyboard.press('Meta+Enter');
  await sleep(300);
  assert.equal((await creates(core)).length, 1, '⌘↩ from another control saves once (a second ⌘↩ while saving is ignored)');
  assert.ok((await core.captureLog()).hides >= 1, 'the window hides (capture_hide)');
  // The Save capture button does the same.
  const page2 = await page.context().newPage();
  const core2 = await startCapture(page2);
  await typeInCapture(page2, 'Druhý záznam');
  await click(saveBtn(page2), 'Save capture');
  await sleep(300);
  assert.equal((await creates(core2)).length, 1, 'Save capture saves once');
  assert.ok((await core2.captureLog()).hides >= 1, 'and hides');
});

// ------------------------------------------------------------------------------------------------ FR-CAP-01 AC-5, FR-CAP-04 AC-1

test('fr_cap_01_ac5_markdown_is_kept_in_the_call', async ({ page }) => {
  const core = await startCapture(page);
  await typeInCapture(page, 'Schůzka k webu\n**Program:**\n- [ ] projít [[Plán webu]]\n- termín #práce');
  await saveWithKeys(page);
  const c = await creates(core);
  assert.equal(c.length, 1, 'one capture_create');
  assert.equal(masked(c[0].text), `---\nid: <ULID>\ntype: quick-note\ntitle: Schůzka k webu\n${stamps()}---\n**Program:**\n- [ ] projít [[Plán webu]]\n- termín #práce\n`, 'R57 bytes');
});

test('fr_cap_04_ac1_the_capture_call', async ({ page }) => {
  const core = await startCapture(page);
  await typeInCapture(page, 'Koupit dárek pro Janu\nNěco do 500 Kč, viz [[Plán webu]].');
  await (await must(tagInput(page), 'tag field')).focus();
  await page.keyboard.insertText('nákup');
  await page.keyboard.press('Enter');
  await saveWithKeys(page);
  const c = await creates(core);
  assert.equal(c.length, 1, 'exactly one capture_create');
  assert.equal(c[0].type, 'quick-note', 'type key');
  assert.equal(c[0].title, 'Koupit dárek pro Janu', 'title');
  assert.match(c[0].text, ID, 'a new ULID');
  assert.equal(masked(c[0].text), `---\nid: <ULID>\ntype: quick-note\ntitle: Koupit dárek pro Janu\ntags: [nákup]\n${stamps()}---\nNěco do 500 Kč, viz [[Plán webu]].\n`, 'FR-CAP-04 AC-1 bytes');
  assert.equal(c[0].vault, (await callsOf(core, 'capture_context')).map((x) => (x.result as any)?.vault?.id).find(Boolean), 'the vault id the window showed');
  assert.deepEqual(await core.writesTo(), ['Quick Notes/Koupit dárek pro Janu.md'], 'one file');
});

// ------------------------------------------------------------------------------------------------ FR-CAP-01 AC-7

test('fr_cap_01_ac7_nothing_to_save', async ({ page }) => {
  const core = await startCapture(page);
  for (const text of ['', '   \n  \n']) {
    await (await must(capText(page), 'Capture text')).fill(text);
    await saveWithKeys(page);
    assert.equal(await textOf(capStatus(page)), 'Nothing to save', `${JSON.stringify(text)}: Nothing to save`);
    await click(saveBtn(page), 'Save capture');
    assert.equal(await textOf(capStatus(page)), 'Nothing to save', 'Save capture: Nothing to save');
  }
  await (await must(tagInput(page), 'tag field')).focus();
  await page.keyboard.insertText('nákup');
  await page.keyboard.press('Enter');
  await saveWithKeys(page);
  assert.equal(await textOf(capStatus(page)), 'Nothing to save', 'chips alone are no capture');
  assert.equal((await core.captureLog()).hides, 0, 'the window stays open');
  assert.deepEqual(await vaultWrites(core), [], 'nothing written');
});

// ------------------------------------------------------------------------------------------------ FR-CAP-01 AC-8

test('fr_cap_01_ac8_esc_keeps_a_draft_and_discard_clears_it', async ({ page }) => {
  const core = await startCapture(page);
  await (await must(capText(page), 'Capture text')).focus();
  await page.keyboard.press('Escape');
  assert.equal((await core.captureLog()).hides, 1, 'Esc with nothing hides');
  assert.equal(await core.draft(), null, 'and stores nothing');
  await core.openCapture({ trigger: 'hotkey' });
  await chooseType(page, 'Task');
  await typeInCapture(page, 'Zavolat kominíkovi');
  await click(prioBtn(page), 'Priority');
  await click(page.getByRole('menuitemradio', { name: 'High' }).or(page.getByRole('menuitem', { name: 'High' })), 'High');
  await (await must(tagInput(page), 'tag field')).focus();
  await page.keyboard.insertText('doma');
  await page.keyboard.press('Enter');
  await (await must(capText(page), 'Capture text')).focus();
  await page.keyboard.press('Escape');
  const d = await eventually(() => core.draft(), (x) => x !== null, 1000);
  assert.deepEqual(d && { text: nfc(d.text), type: d.type, tags: d.tags, priority: d.priority }, { text: 'Zavolat kominíkovi', type: 'task', tags: ['doma'], priority: 'High' }, 'the draft (Application Support)');
  assert.deepEqual(await vaultWrites(core), [], 'never written into the vault');
  // The next open (status item keeps the draft's type) restores everything, caret at the end.
  await core.openCapture({ trigger: 'status-item', kind: 'default' });
  assert.equal(nfc(await capValue(page)), 'Zavolat kominíkovi', 'text restored');
  assert.equal(flat(await typeBtn(page).getAttribute('aria-label')), 'Type: Task', 'type kept');
  assert.deepEqual(await chips(page), ['doma'], 'chips restored');
  assert.equal(flat(await prioBtn(page).innerText()), 'Priority: High', 'priority restored');
  const caret = await capText(page).evaluate((e) => [(e as HTMLTextAreaElement).selectionStart, (e as HTMLTextAreaElement).value.length]);
  assert.equal(caret[0], caret[1], 'caret at the end');
  await click(discardBtn(page), 'Discard');
  assert.equal(await core.draft(), null, 'Discard removes the draft');
  await core.openCapture({ trigger: 'hotkey' });
  assert.equal(await capValue(page), '', 'cleared');
  assert.deepEqual(await chips(page), [], 'no chips');
  assert.deepEqual(await vaultWrites(core), [], 'nothing written');
});

test('fr_cap_01_ac8_ctrl_opt_t_switches_a_drafts_type_and_a_save_removes_it', async ({ page }) => {
  const core = await startCapture(page, { draft: { text: 'Rozepsáno', type: 'quick-note', tags: [], due: null, priority: null, savedAt: NOW } });
  assert.equal(nfc(await capValue(page)), 'Rozepsáno', 'the stored draft is shown');
  await core.openCapture({ trigger: 'hotkey', kind: 'task' });
  assert.equal(flat(await typeBtn(page).getAttribute('aria-label')), 'Type: Task', '⌃⌥T switches the type to Task');
  await saveWithKeys(page);
  assert.equal((await creates(core)).length, 1, 'saved');
  assert.equal(await eventually(() => core.draft(), (x) => x === null, 1000), null, 'a successful save removes the draft');
});

// ------------------------------------------------------------------------------------------------ FR-CAP-01 AC-10

test('fr_cap_01_ac10_a_failed_save_keeps_everything', async ({ page }) => {
  const core = await startCapture(page);
  await typeInCapture(page, 'Neztratit\nDůležitý text.');
  await (await must(tagInput(page), 'tag field')).focus();
  await page.keyboard.insertText('práce');
  await page.keyboard.press('Enter');
  await core.writeControl({ fail: 'Io' });
  await saveWithKeys(page);
  assert.equal(await textOf(capStatus(page)), 'Couldn’t save. Your text is kept. Try again', 'status with Try again');
  assert.equal(nfc(await capValue(page)), 'Neztratit\nDůležitý text.', 'text unchanged');
  assert.deepEqual(await chips(page), ['práce'], 'chips unchanged');
  assert.equal((await core.captureLog()).hides, 0, 'the window stays open');
  assert.deepEqual(await core.writesTo(), [], 'no file');
  await core.writeControl({ fail: null });
  await click(page.getByRole('button', { name: 'Try again', exact: true }), 'Try again');
  await sleep(300);
  assert.deepEqual(await core.writesTo(), ['Quick Notes/Neztratit.md'], 'Try again writes the note once');
});

// ------------------------------------------------------------------------------------------------ FR-CAP-01 AC-11

test('fr_cap_01_ac11_no_vault_open', async ({ page }) => {
  const core = await startCapture(page, { vault: null });
  assert.ok(await seen(page.getByText('Open a vault in Tegg first.', { exact: true }), 1000), 'the message');
  await must(page.getByRole('button', { name: 'Open Tegg', exact: true }), 'Open Tegg');
  assert.equal(await isDisabled(saveBtn(page)), true, 'Save capture aria-disabled');
  await typeInCapture(page, 'Bez trezoru');
  await saveWithKeys(page);
  assert.deepEqual(await creates(core), [], 'nothing written');
});

test('fr_cap_01_ac11_the_vault_changed_while_open', async ({ page }) => {
  const core = await startCapture(page);
  await typeInCapture(page, 'Do starého trezoru');
  await core.setVault({ name: 'Jiný', files: inboxVault().files });
  await saveWithKeys(page);
  assert.ok(await seen(page.getByText('"Doručené" isn\'t open any more. Your text is kept.', { exact: true }), 2000), 'the message names the vault it showed');
  assert.equal(nfc(await capValue(page)), 'Do starého trezoru', 'the text is kept');
  assert.deepEqual(await core.writesTo(), [], 'nothing written');
  await core.openCapture({ trigger: 'hotkey' });
  assert.ok(await seen(page.getByText('Saves to Jiný', { exact: true }), 2000), 'the next open shows the new vault');
});

// ------------------------------------------------------------------------------------------------ FR-CAP-01 AC-12 [MS6], 6A part
// Changed by 6A (trash-media.md FR-ATT-01 AC-11, D-624): the drop zone is enabled and a pasted image is staged as a
// thumbnail (the full criterion is app/webkit/capture_media.ac.test.ts); nothing is written before the save.

test('fr_cap_01_ac12_images_and_pdfs_are_added_from_6a', async ({ page }) => {
  const core = await startCapture(page);
  assert.equal(await isDisabled(dropZone(page)), false, 'the drop zone is enabled');
  assert.ok(!(await description(dropZone(page))).includes('Coming in'), 'no Coming in MS6');
  await typeInCapture(page, 'S obrázkem');
  await capText(page).evaluate((el) => {
    const dt = new DataTransfer();
    const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    dt.items.add(new File([new Uint8Array(png)], 'foto.png', { type: 'image/png' }));
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  });
  assert.ok(await seen(page.getByRole('button', { name: /^Remove(?! #)/ }), 2000), 'the pasted image is staged as a thumbnail with Remove');
  assert.notEqual(await textOf(capStatus(page), 300), 'Images and PDFs can be added from MS6.', 'the MS6 message is retired');
  assert.equal(nfc(await capValue(page)), 'S obrázkem', 'no text inserted');
  assert.deepEqual((await callsOf(core, 'capture_media_add')).length, 1, 'staged with capture_media_add');
  assert.deepEqual(await vaultWrites(core), [], 'nothing written before the save');
});

// ------------------------------------------------------------------------------------------------ FR-CAP-01 AC-13 (the panel)

test('fr_cap_01_ac13_the_confirmation_panel', async ({ page }) => {
  const core = await startCapture(page, { hash: '#saved' });
  await sleep(300);
  await core.showSaved({ typeName: 'Quick Note', title: 'Koupit dárek pro Janu', path: 'Quick Notes/Koupit dárek pro Janu.md' });
  assert.ok(await seen(page.getByText('Saved to Inbox', { exact: true }), 2000), 'Saved to Inbox');
  assert.ok(await seen(page.getByText('Quick Note · Koupit dárek pro Janu', { exact: true }), 1000), '<Type name> · <title>');
  await click(page.getByRole('button', { name: 'Open', exact: true }), 'Open');
  assert.deepEqual((await core.captureLog()).openMain, ['Quick Notes/Koupit dárek pro Janu.md'], 'Open asks the shell to show the note');
});

// ------------------------------------------------------------------------------------------------ FR-CAP-01 AC-14

test('fr_cap_01_ac14_pseudo_locale_marks_every_ui_text', async ({ page }) => {
  // Opened by hand: startCapture waits for the English name `Capture text`, which the pseudo-locale wraps.
  const core = await startCapture(page, { prelude: pseudoLocale, open: false });
  await sleep(300);
  await core.openCapture({ trigger: 'hotkey', kind: 'default' });
  await must(page.getByRole('textbox', { name: '⟦Capture text⟧' }), 'the pseudo-localized Capture text', 5000);
  const leaks = await page.evaluate(() => {
    const out: string[] = [];
    const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walk.nextNode(); n; n = walk.nextNode()) {
      const t = (n.textContent ?? '').trim();
      if (!t || /^[⟦⟧\s·↩⌘⌃⌥#]*$/.test(t) || t.includes('⟦')) continue;
      if ((n.parentElement?.closest('[data-user-content]'))) continue;
      out.push(t);
    }
    for (const e of document.querySelectorAll('[aria-label], [placeholder], [title]')) {
      for (const a of ['aria-label', 'placeholder', 'title']) {
        const v = e.getAttribute(a);
        if (v && !v.includes('⟦') && !e.closest('[data-user-content]')) out.push(`${a}=${v}`);
      }
    }
    return out;
  });
  const allowed = new Set(['Doručené', 'Quick Note', 'Page', 'Task', 'Nápad', 'Schůzka']);
  assert.deepEqual(leaks.filter((x) => !allowed.has(x.replace(/^aria-label=/, ''))), [], 'only type names, tag names, priority labels, the vault name and typed text outside ⟦ ⟧');
  await must(page.getByRole('textbox', { name: '⟦Capture text⟧' }), 'the pseudo-localized Capture text');
});

for (const theme of ['light', 'dark'] as const) {
  test(`fr_cap_01_ac14_contrast_and_theme_${theme}`, async ({ page }) => {
    await startCapture(page, { theme });
    assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), theme, `follows the app's ${theme} setting (D-128)`);
    assert.deepEqual(await axeContrast(page), [], `axe color-contrast in ${theme}`);
  });
}

// ------------------------------------------------------------------------------------------------ FR-CAP-04 AC-7

test('fr_cap_04_ac7_a_capture_lands_first_in_today_and_counts', async ({ browser }) => {
  const ctx = await browser.newContext({ timezoneId: 'Europe/Prague' });
  const mainPage = await ctx.newPage();
  const capPage = await ctx.newPage();
  const v = inboxVault();
  const core = await startMain(mainPage, { vault: v });
  await gotoInbox(mainPage);
  const before = await sidebarCount(mainPage);
  const cap = await startCapture(capPage, { vault: v });
  await typeInCapture(capPage, 'Koupit dárek pro Janu');
  await saveWithKeys(capPage);
  assert.equal((await creates(cap)).length, 1, 'captured');
  const first = await eventually(async () => (await groupRegion(mainPage, 'today').locator('[data-path]').first().getAttribute('data-path').catch(() => null)), (p) => p === 'Quick Notes/Koupit dárek pro Janu.md', 2000);
  assert.equal(first, 'Quick Notes/Koupit dárek pro Janu.md', 'the first card of Today within 2 s');
  assert.equal(await eventually(() => sidebarCount(mainPage), (c) => c === String(Number(before) + 1), 2000), String(Number(before) + 1), 'the sidebar count goes up by one');
  assert.ok((await core.files())['Quick Notes/Koupit dárek pro Janu.md'], 'the main window sees the file');
  await ctx.close();
});

// ------------------------------------------------------------------------------------------------ FR-CAP-04 AC-8

test('fr_cap_04_ac8_the_type_menu_follows_the_type_files', async ({ page }) => {
  const recept = "# Tegg type definition (FR-TYP-01, FR-STO-06, D-90). Edit it in Tegg's type settings.\nversion: 1\nname: Recept\nplural: Recepty\nsystem: false\nfolder: Recepty\nicon: utensils\ncolor: orange\nreview: false\npreview: []\nattributes: []\n";
  const v = inboxVault();
  const core = await startCapture(page, { vault: v, draft: { text: 'Rozepsaný nápad', type: 'schůzka', tags: [], due: null, priority: null, savedAt: NOW } });
  // A type file added and one deleted outside Tegg reach the pre-warmed window (capture:context-changed).
  await page.evaluate((t) => { const f = (window as any).__teggFake; f.vault.files['.tegg/types/recept.yml'] = t; delete f.vault.files['.tegg/types/schůzka.yml']; return f.emit('capture:context-changed', {}); }, recept);
  await core.openCapture({ trigger: 'hotkey' });
  await click(typeBtn(page), 'Type');
  const menu = await must(typeMenu(page), 'menu Type');
  const items = (await menu.getByRole('menuitemradio').allInnerTexts()).map((x) => flat(x).replace(/ (Vault default|⌃⌥T)$/, ''));
  assert.ok(items.includes('Recept'), `recept.yml is in the menu: ${items.join(', ')}`);
  assert.ok(!items.includes('Schůzka'), 'a deleted type is gone');
  await page.keyboard.press('Escape');
  assert.equal(flat(await typeBtn(page).getAttribute('aria-label')), 'Type: Quick Note', 'the draft of the deleted type falls back to the default type');
});

// ------------------------------------------------------------------------------------------------ FR-CAP-05 AC-1, AC-2 (the type)

test('fr_cap_05_ac1_the_hotkey_opens_with_the_vault_default', async ({ page }) => {
  const v = inboxVault((f) => { f['.tegg/vault.yml'] = swap(f['.tegg/vault.yml'], 'default-type: Quick Note', 'default-type: nápad'); });
  await startCapture(page, { vault: v, trigger: 'hotkey' });
  assert.equal(flat(await (await must(typeBtn(page), 'Type')).getAttribute('aria-label')), 'Type: Nápad', 'default-type: nápad');
  assert.equal((await focusName(page)).name, 'Capture text', 'focus in Capture text');
});

test('fr_cap_05_ac2_new_task_opens_as_task_whatever_the_default', async ({ page }) => {
  const v = inboxVault((f) => { f['.tegg/vault.yml'] = swap(f['.tegg/vault.yml'], 'default-type: Quick Note', 'default-type: nápad'); });
  await startCapture(page, { vault: v, trigger: 'hotkey', kind: 'task' });
  assert.equal(flat(await (await must(typeBtn(page), 'Type')).getAttribute('aria-label')), 'Type: Task');
  assert.equal(flat(await (await must(dueBtn(page), 'Due')).innerText()), 'Due: No date'); // D-602
  assert.equal(flat(await (await must(prioBtn(page), 'Priority')).innerText()), 'Priority: None');
});

// ------------------------------------------------------------------------------------------------ FR-TSK-10 AC-9…AC-12

async function taskCapture(page: Page, o: { title: string; due?: string; priority?: string; tag?: string }) {
  await typeInCapture(page, o.title);
  if (o.due) {
    await click(dueBtn(page), 'Due');
    const field = await must(page.getByRole('textbox', { name: 'Due date', exact: true }), 'textbox Due date');
    await field.fill(o.due);
    await page.keyboard.press('Enter');
  }
  if (o.priority) {
    await click(prioBtn(page), 'Priority');
    await click(page.getByRole('menuitemradio', { name: o.priority, exact: true }).or(page.getByRole('menuitem', { name: o.priority, exact: true })), o.priority);
  }
  if (o.tag) {
    await (await must(tagInput(page), 'tag field')).focus();
    await page.keyboard.insertText(o.tag);
    await page.keyboard.press('Enter');
  }
}
const TASK_BYTES = `---\nid: <ULID>\ntype: task\ntitle: Zavolat kominíkovi\nstatus: To do\npriority: High\ndue: 2026-10-15\ntags: [doma]\n${plain()}---\n`;

test('fr_tsk_10_ac9_the_task_bytes', async ({ page }) => {
  const core = await startCapture(page, { kind: 'task' });
  await taskCapture(page, { title: 'Zavolat kominíkovi', due: '15. 10. 2026', priority: 'High', tag: 'doma' });
  assert.equal(flat(await dueBtn(page).innerText()), 'Due: Tomorrow', 'R44 label for 15 Oct');
  await saveWithKeys(page);
  const c = await creates(core);
  assert.equal(c.length, 1, 'one capture');
  assert.equal(masked(c[0].text), TASK_BYTES, 'FR-TSK-10 AC-9 bytes');
  assert.equal(c[0].type, 'task');
});

test('fr_tsk_10_ac9_no_priority_and_cleared_due_write_no_key', async ({ page }) => {
  const core = await startCapture(page, { kind: 'task' });
  await taskCapture(page, { title: 'Zavolat kominíkovi', due: '15. 10. 2026', priority: 'No priority' });
  await click(dueBtn(page), 'Due');
  await click(page.getByRole('button', { name: 'No date', exact: true }), 'No date'); // D-602
  await saveWithKeys(page);
  const c = await creates(core);
  assert.equal(c.length, 1, 'one capture');
  assert.equal(masked(c[0].text), `---\nid: <ULID>\ntype: task\ntitle: Zavolat kominíkovi\nstatus: To do\n${plain()}---\n`, 'no priority, no due');
});

test('fr_tsk_10_ac10_quick_add_tokens_in_the_first_line', async ({ page }) => {
  const core = await startCapture(page, { kind: 'task' });
  await typeInCapture(page, 'Zavolat kominíkovi tomorrow !high #doma');
  assert.equal(flat(await (await must(dueBtn(page), 'Due')).innerText()), 'Due: Tomorrow', 'Due from the token');
  assert.equal(flat(await prioBtn(page).innerText()), 'Priority: High', 'Priority from the token');
  assert.deepEqual(await chips(page), ['doma'], 'the chip #doma');
  await click(dueBtn(page), 'Due');
  await click(page.getByRole('button', { name: 'No date', exact: true }), 'No date (D-602)');
  assert.ok(nfc(await capValue(page)).includes('tomorrow'), 'Clear puts tomorrow back into the text');
  const page2 = await page.context().newPage();
  const core2 = await startCapture(page2, { kind: 'task' });
  await typeInCapture(page2, 'Zavolat kominíkovi tomorrow !high #doma');
  await saveWithKeys(page2);
  assert.equal(masked((await creates(core2))[0]?.text ?? ''), TASK_BYTES, 'saving writes AC-9 bytes');
  // As a Quick Note only the trailing tag moves.
  const page3 = await page.context().newPage();
  const core3 = await startCapture(page3);
  await typeInCapture(page3, 'Zavolat kominíkovi tomorrow !high #doma');
  await saveWithKeys(page3);
  assert.equal(masked((await creates(core3))[0]?.text ?? ''), `---\nid: <ULID>\ntype: quick-note\ntitle: Zavolat kominíkovi tomorrow !high\ntags: [doma]\n${stamps()}---\n`, 'Quick Note bytes');
  assert.deepEqual(await creates(core), [], 'nothing saved by the first window');
});

for (const [zone, due, now] of [['Europe/Prague', '2026-10-16', '2026-10-15T00:30:00+02:00'], ['America/Los_Angeles', '2026-10-15', '2026-10-14T15:30:00-07:00']] as const) {
  test.describe(`late evening UTC (${zone})`, () => {
    test.use({ timezoneId: zone });
    test(`fr_tsk_10_ac11_tomorrow_never_shifts_${zone.replace(/\W/g, '_')}`, async ({ page }) => {
      const core = await startCapture(page, { kind: 'task', now: '2026-10-14T22:30:00Z' });
      await typeInCapture(page, 'Zavolat kominíkovi tomorrow');
      await saveWithKeys(page);
      const t = (await creates(core))[0]?.text ?? '';
      assert.equal(masked(t), `---\nid: <ULID>\ntype: task\ntitle: Zavolat kominíkovi\nstatus: To do\ndue: ${due}\n${plain(now)}---\n`, `${zone}: due ${due}, stamps ${now}`);
    });
  });
}

test('fr_tsk_10_ac12_the_task_shows_on_tasks_and_in_the_inbox', async ({ browser }) => {
  const ctx = await browser.newContext({ timezoneId: 'Europe/Prague' });
  const mainPage = await ctx.newPage();
  const capPage = await ctx.newPage();
  const v = inboxVault();
  await startMain(mainPage, { vault: v });
  const cap = await startCapture(capPage, { vault: v, kind: 'task' });
  await taskCapture(capPage, { title: 'Zavolat kominíkovi', due: '15. 10. 2026', priority: 'High', tag: 'doma' });
  await saveWithKeys(capPage);
  assert.equal((await creates(cap)).length, 1, 'captured');
  await gotoInbox(mainPage);
  // D-604: Task's review workflow is off, so the capture is not an Inbox item.
  await sleep(1500);
  assert.equal(await mainPage.getByRole('main').locator('[data-path="Tasks/Zavolat kominíkovi.md"]').count(), 0, 'not in the Inbox (D-604)');
  await mainPage.keyboard.press('Meta+k');
  await mainPage.getByRole('combobox', { name: 'Command query' }).fill('Go to Tasks');
  await mainPage.keyboard.press('Enter');
  const week = mainPage.getByRole('main').locator('[data-section="week"]');
  await must(week.locator('[data-path="Tasks/Zavolat kominíkovi.md"]'), 'the task in This week');
  const card = await must(mainPage.getByRole('main').getByRole('article', { name: 'Task: Zavolat kominíkovi', exact: true }), 'its card');
  assert.ok(flat(await card.innerText()).includes('High'), 'the priority chip High');
  await ctx.close();
});

// ------------------------------------------------------------------------------------------------ NFR-SEC-03 AC-4 (the DOM)

test('nfr_sec_03_ac4_nothing_from_the_vault_reaches_the_capture_dom', async ({ page }) => {
  const core = await startCapture(page);
  await typeInCapture(page, 'Vlastní text');
  await (await must(tagInput(page), 'tag field')).focus();
  await page.keyboard.insertText('n');
  await sleep(300);
  await page.keyboard.press('Escape');
  await core.openCapture({ trigger: 'hotkey' });
  await saveWithKeys(page);
  const html = nfc(await page.evaluate(() => document.documentElement.outerHTML));
  const titles = ['Koupit mléko', 'Nápad na článek', 'Bez stavu', 'Divná hodnota', 'Žluťoučký kůň', 'Bez offsetu', 'Bez data', 'Aplikace na čaj', 'Zachycená stránka', 'Zavolat instalatérovi', 'Porada týmu', 'Polotučné, 2 litry', 'O synchronizaci přes Dropbox', 'Ranní poznámky', 'Zápis týden zpět', 'Text s háčky', 'Plán webu', 'Proč na tom záleží'];
  assert.deepEqual(titles.filter((t) => html.includes(t)), [], 'no note title or body text in the capture DOM (AP-481)');
  assert.equal((await creates(core)).length, 1, 'the capture was saved');
  const forbidden = (await core.calls()).filter((c) => (c.result as any)?.kind === 'Forbidden').map((c) => c.cmd);
  assert.deepEqual(forbidden, [], 'the page calls only the capture commands (§2.2)');
});

// ------------------------------------------------------------------------------------------------ FR-SYN-06 AC-24 (L5)

test('fr_syn_06_ac24_one_capture_one_file_and_no_other_write', async ({ page }) => {
  const core = await startCapture(page);
  // Opening by each trigger, typing, types, chips, tag suggestions, Esc, Discard and a failed save write nothing.
  for (const trigger of ['status-item', 'status-menu', 'hotkey', 'palette'] as const) await core.openCapture({ trigger });
  await typeInCapture(page, 'Jen zkouška');
  await chooseType(page, 'Page');
  await chooseType(page, 'Quick Note');
  await (await must(tagInput(page), 'tag field')).focus();
  await page.keyboard.insertText('ná');
  await sleep(200);
  await page.keyboard.press('Enter');
  await (await must(capText(page), 'Capture text')).focus();
  await page.keyboard.press('Escape');
  await core.openCapture({ trigger: 'hotkey' });
  await click(discardBtn(page), 'Discard');
  await core.openCapture({ trigger: 'hotkey' });
  await typeInCapture(page, 'Selže');
  await core.writeControl({ fail: 'Io' });
  await saveWithKeys(page);
  assert.deepEqual(await core.writesTo(), [], 'nothing written before the save');
  await core.writeControl({ fail: null });
  await click(page.getByRole('button', { name: 'Try again', exact: true }), 'Try again');
  await sleep(300);
  assert.deepEqual(await core.writesTo(), ['Quick Notes/Selže.md'], 'one capture writes one file');
  assert.equal((await creates(core)).filter((c) => c).length, 2, 'two capture_create calls: the failed one and the retry');
  const other = (await vaultWrites(core)).filter((c) => c !== 'capture_create');
  assert.deepEqual(other, [], 'no other vault write command');
});
