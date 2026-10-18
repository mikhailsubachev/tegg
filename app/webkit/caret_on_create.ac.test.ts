// MS4 slice 4B preview feedback (D-367), L5 (WebKit + fake core): every create path that navigates puts the caret at
// the end of the new object's title; a Daily Note gets it at the start of its first body block. editor.md FR-EDT-01
// AC-13; daily-notes.md FR-DLY-01 AC-5 (caret part); backlinks.md FR-LNK-04 AC-5 (caret part, through AC-13).
// Interface docs/contracts/ms3-shell.md §15.2 (`data-focus-target`), app-shell R3 (sidebar `New object`). Written from
// the ACs and the contracts only (D-61). Missing elements fail through `must`/node:assert (TS-I1).
// D-520 (FR-EDT-01 AC-13 annotation): ⌘N / New object and `New <Name>` open an unsaved draft with an empty title, so
// for them the caret is checked in the empty title and the ` 2` typing check applies to the switcher's create item
// and the Create offer only.
import { test, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import { mustBeDraft, mustBeOn, runCommand, sidebar, switcherDialog, typesList } from './helpers';
import { E, editorBody, eventually, fileText, must, noModified, openEditor, sleep, titleField, type FakeCoreHandle } from './editor-helpers';
import { B, createOffer, chips, openLinks } from './links-helpers';
import { D, callsOf, dailyVault, mustDaily, startDaily, swap } from './daily-helpers';

test.use({ timezoneId: 'Europe/Prague' });

const focusTarget = (page: Page) => page.evaluate(() => document.querySelector('[data-focus-target]')?.getAttribute('data-focus-target') ?? null);

async function titleCaretAtEnd(page: Page): Promise<{ inTitle: boolean; atEnd: boolean; collapsed: boolean }> {
  return page.evaluate(() => {
    const a = document.activeElement as HTMLElement | null;
    const title = document.querySelector('[aria-label="Title"]') as HTMLElement | null;
    const inTitle = !!a && !!title && (a === title || title.contains(a));
    if (a instanceof HTMLInputElement || a instanceof HTMLTextAreaElement) {
      return { inTitle, atEnd: a.selectionStart === a.value.length, collapsed: a.selectionStart === a.selectionEnd };
    }
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || !title) return { inTitle, atEnd: false, collapsed: false };
    const r = document.createRange();
    r.selectNodeContents(title);
    r.setStart(sel.focusNode!, sel.focusOffset);
    return { inTitle, atEnd: r.toString().length === 0, collapsed: sel.isCollapsed };
  });
}
async function caretBlock(page: Page): Promise<{ inBody: boolean; text: string; offset: number } | null> {
  return page.evaluate(() => {
    const body = document.querySelector('[aria-label="Note body"]');
    const sel = window.getSelection();
    const inBody = !!document.activeElement?.closest('[aria-label="Note body"]');
    if (!body || !sel || sel.rangeCount === 0 || !sel.isCollapsed) return null;
    let blk: Node | null = sel.anchorNode;
    while (blk && blk.parentNode !== body) blk = blk.parentNode;
    if (!blk) return { inBody, text: '', offset: -1 };
    const r = document.createRange();
    r.setStart(blk, 0);
    r.setEnd(sel.anchorNode!, sel.anchorOffset);
    return { inBody, text: ((blk as HTMLElement).innerText ?? blk.textContent ?? '').replace(/\s+/g, ' ').trim(), offset: r.toString().length };
  });
}

/** After a create path navigated to `title` at `path`: title focused with the caret at its end; ` 2` changes only the
 *  title (and `modified`). */
async function expectTitleCaretThenType(page: Page, core: FakeCoreHandle, title: string, path: string, how: string) {
  await mustBeOn(page, title, `${how}: the new note opens`, 5000);
  await must(titleField(page), `${how}: textbox "Title"`);
  await sleep(300);
  assert.equal(await focusTarget(page), 'title', `${how}: data-focus-target="title"`);
  assert.deepEqual(await titleCaretAtEnd(page), { inTitle: true, atEnd: true, collapsed: true }, `${how}: document.activeElement is the title, caret at its end, nothing selected`);
  const created = await eventually(() => fileText(core, path), (t) => t !== undefined, 2000);
  assert.ok(created, `${how}: ${path} was created`);
  const writesBefore = (await core.writesTo()).length;
  assert.deepEqual(await core.writesTo(), [path], `${how}: placing the caret writes nothing; the creation write is the only write`);
  await page.keyboard.type(' 2');
  const t = await eventually(() => fileText(core, path), (x) => (x ?? '').includes(`title: ${title} 2\n`), 3000);
  assert.equal(noModified(t ?? ''), noModified(created!.replace(`title: ${title}\n`, `title: ${title} 2\n`)), `${how}: typing " 2" saves title: ${title} 2 and nothing else but modified`);
  assert.ok((await core.writesTo()).length > writesBefore, `${how}: the edit is saved`);
}

/** After a path that opens an unsaved draft (D-520): the empty title holds the caret with nothing selected and nothing
 *  is written; typing a title and ↩ then creates `path` as the only write (D-522). */
async function expectDraftTitleCaret(page: Page, core: FakeCoreHandle, title: string, path: string, how: string) {
  await mustBeDraft(page, how, 5000);
  await sleep(300);
  assert.deepEqual(await titleCaretAtEnd(page), { inTitle: true, atEnd: true, collapsed: true }, `${how}: document.activeElement is the empty title, caret in it, nothing selected`);
  assert.deepEqual(await core.writesTo(), [], `${how}: placing the caret writes nothing (the draft is unsaved)`);
  await page.keyboard.type(title);
  await page.keyboard.press('Enter');
  await mustBeOn(page, title, `${how}: ↩ creates the note`, 5000);
  const created = await eventually(() => fileText(core, path), (t) => t !== undefined, 2000);
  assert.ok(created, `${how}: ${path} was created`);
  assert.deepEqual(await core.writesTo(), [path], `${how}: the creation write is the only write`);
}

// ------------------------------------------------------------------------------------------------ FR-EDT-01 AC-13

test('fr_edt_01_ac13_cmd_n_new_object_puts_the_caret_at_the_end_of_the_title', async ({ page }) => {
  const core = await openEditor(page, E.deset);
  await page.keyboard.press('Meta+n');
  await expectDraftTitleCaret(page, core, 'Nový zápis', 'Quick Notes/Nový zápis.md', '⌘N');
});

test('fr_edt_01_ac13_palette_new_object_puts_the_caret_at_the_end_of_the_title', async ({ page }) => {
  const core = await openEditor(page, E.deset);
  await runCommand(page, 'New object');
  await expectDraftTitleCaret(page, core, 'Zápis z palety', 'Quick Notes/Zápis z palety.md', 'palette New object');
});

test('fr_edt_01_ac13_switcher_create_item_puts_the_caret_at_the_end_of_the_title', async ({ page }) => {
  const core = await openEditor(page, E.deset);
  await page.keyboard.press('Meta+o');
  await must(switcherDialog(page), 'switcher');
  await page.getByRole('textbox', { name: 'Switcher query' }).or(page.getByRole('combobox', { name: 'Switcher query' })).first().fill('Úplně nový');
  await sleep(150);
  await switcherDialog(page).getByRole('option').last().click();
  await expectTitleCaretThenType(page, core, 'Úplně nový', 'Quick Notes/Úplně nový.md', 'switcher create item');
});

test('fr_edt_01_ac13_type_page_new_puts_the_caret_at_the_end_of_the_title', async ({ page }) => {
  const core = await openEditor(page, E.deset);
  await (await must(typesList(page).getByRole('link', { name: /^Pages/ }).or(typesList(page).getByRole('button', { name: /^Pages/ })).first(), 'sidebar entry Pages')).click();
  await mustBeOn(page, 'Pages', 'type page Pages');
  await (await must(page.getByRole('main').getByRole('button', { name: 'New Page', exact: true }), 'New Page')).click();
  await expectDraftTitleCaret(page, core, 'Stránka z typu', 'Pages/Stránka z typu.md', 'type page New Page');
});

test('fr_edt_01_ac13_sidebar_new_object_puts_the_caret_at_the_end_of_the_title', async ({ page }) => {
  const core = await openEditor(page, E.deset);
  await (await must(sidebar(page).getByRole('button', { name: /^New object/ }), 'sidebar button "New object"')).click();
  await expectDraftTitleCaret(page, core, 'Ze sidebaru', 'Quick Notes/Ze sidebaru.md', 'sidebar New object');
});

test('fr_edt_01_ac13_broken_link_create_puts_the_caret_at_the_end_of_the_title', async ({ page }) => {
  const core = await openLinks(page, B.rozbite);
  const c = await must(chips(editorBody(page), 'Neexistuje').and(page.locator('[data-link-kind="unresolved"]')), 'unresolved chip Neexistuje', 5000);
  await c.click();
  const offer = await must(createOffer(page), 'dialog "Create note"');
  await (await must(offer.getByRole('button', { name: 'Create "Neexistuje"', exact: true }), 'Create "Neexistuje"')).click();
  await expectTitleCaretThenType(page, core, 'Neexistuje', 'Quick Notes/Neexistuje.md', 'broken-link Create');
  const t = (await fileText(core, 'Quick Notes/Neexistuje.md')) ?? '';
  assert.equal(t.replace(/^---\n[\s\S]*?\n---\n/, ''), '', 'the body stays empty');
});

test('fr_edt_01_ac13_link_create_does_not_navigate_or_move_the_focus', async ({ page }) => {
  await openEditor(page, E.prazdna);
  await editorBody(page).first().click();
  await page.keyboard.type('[[Nový cíl');
  const before = await page.evaluate(() => document.activeElement?.closest('[aria-label="Note body"]') !== null);
  await (await must(page.getByRole('listbox', { name: 'Link suggestions', exact: true }).getByRole('option', { name: 'Create "Nový cíl"' }), 'Create option')).click();
  await sleep(300);
  assert.ok(before, 'setup: the caret is in the body');
  assert.equal(await page.evaluate(() => document.activeElement?.closest('[aria-label="Note body"]') !== null), true, 'document.activeElement unchanged (still the body)');
  assert.equal(await focusTarget(page), 'body', 'no navigation');
});

// ------------------------------------------------------------------------------------------------ Daily Note (fixed title)

const DAILY_FIRST_BLOCK = 'Deník 14. 10. 2026';

async function expectDailyBodyCaretThenType(page: Page, core: FakeCoreHandle, how: string) {
  await mustDaily(page, '2026-10-14', how);
  await sleep(300);
  assert.equal(await focusTarget(page), 'body', `${how}: data-focus-target="body"`);
  const t = await must(titleField(page), `${how}: title field`);
  assert.equal(await t.getAttribute('aria-readonly'), 'true', `${how}: the title stays aria-readonly`);
  const c = await caretBlock(page);
  assert.deepEqual(c, { inBody: true, text: DAILY_FIRST_BLOCK, offset: 0 }, `${how}: caret at the start of the first body block, inside "Note body"`);
  assert.deepEqual(await core.writesTo(), [], `${how}: no write for a virtual Daily Note`);
  await page.keyboard.type('X');
  const created = await eventually(() => callsOf(core, 'daily_create'), (x) => x.some((y) => y.ok === true), 3000);
  const ok = created.filter((x) => x.ok);
  assert.equal(ok.length, 1, `${how}: one daily_create (FR-DLY-02 AC-2)`);
  const text = String((ok[0].args as any)?.text ?? (await fileText(core, D.new14)) ?? '');
  const body = text.replace(/^---\n[\s\S]*?\n---\n/, '');
  assert.ok(body.startsWith(`# X${DAILY_FIRST_BLOCK}\n`), `${how}: X at the start of the first body block: ${JSON.stringify(body.slice(0, 60))}`);
}

test('fr_edt_01_ac13_daily_note_by_cmd_n_with_default_type_gets_the_caret_in_the_body', async ({ page }) => {
  const v = dailyVault((f) => { f['.tegg/vault.yml'] = swap(f['.tegg/vault.yml'], 'default-type: Quick Note', 'default-type: Daily Note'); });
  const core = await startDaily(page, { vault: v });
  await page.keyboard.press('Meta+n');
  await expectDailyBodyCaretThenType(page, core, '⌘N with default-type Daily Note');
});

test('fr_dly_01_ac5_type_page_new_daily_note_opens_today_with_the_caret_in_the_body', async ({ page }) => {
  const core = await startDaily(page);
  await runCommand(page, 'Go to type: Daily Notes');
  await mustBeOn(page, 'Daily Notes', 'Daily Notes type page', 5000);
  await (await must(page.getByRole('main').getByRole('button', { name: 'New Daily Note', exact: true }), 'button "New Daily Note"')).click();
  await expectDailyBodyCaretThenType(page, core, 'New Daily Note on the type page');
});
