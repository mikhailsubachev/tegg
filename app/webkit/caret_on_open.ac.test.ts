// MS3 3D follow-up, L5 (WebKit + fake core): where the focus goes when a note opens (D-247, D-255). FR-EDT-01 AC-11
// (existing note: caret in the first editable body block), AC-12 (new note: title in edit mode, caret at its end).
// docs/acceptance/editor.md; interface docs/contracts/ms3-shell.md §15.2 (`data-focus-target` on the NotePage root,
// the body's `aria-describedby` → title). Written from the ACs and the contract only (D-61). Missing elements fail
// through `must`/node:assert (TS-I1). D-520: ⌘N and `New <Name>` open an unsaved draft with an empty title in edit mode
// (types.md FR-TYP-09 AC-17); the title is typed there and ↩ creates the note and moves the caret to the body.
import { test, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import { eventually, focused, mustBeDraft, mustBeOn, openNote, sidebar, switcherDialog, typesList, settled } from './helpers';
import {
  E, TITLES, bodyOf, editorBody, editorVault, fileText, must, mustBeSaved, noModified, openEditor, original, sleep, titleField, writes,
  type FakeCoreHandle,
} from './editor-helpers';
import { goToQuery, searchCreateButton } from './helpers'; // D-1345: the Search page's results and create buttons (D-1340)
import { escPreview, mustNoPreview, mustPreview, switchPreviewMode } from './helpers';
import { pressNewObject } from './helpers'; // D-1431: ⌘N opens the type picker; ⏎ in it takes the default
import { setPreviewMode } from '../ui/test/fake-core';

async function focusTarget(page: Page): Promise<string | null> {
  return page.evaluate(() => document.querySelector('[data-focus-target]')?.getAttribute('data-focus-target') ?? null);
}
async function caretInBody(page: Page): Promise<boolean> {
  return page.evaluate(() => !!document.activeElement?.closest('[aria-label="Note body"]'));
}
/** Text of the top-level body block holding the DOM caret, and the caret's text offset inside it. */
async function caretBlock(page: Page): Promise<{ text: string; offset: number } | null> {
  return page.evaluate(() => {
    const body = document.querySelector('[aria-label="Note body"]');
    const sel = window.getSelection();
    if (!body || !sel || sel.rangeCount === 0 || !sel.isCollapsed) return null;
    let blk: Node | null = sel.anchorNode;
    while (blk && blk.parentNode !== body) blk = blk.parentNode;
    if (!blk) return null;
    const r = document.createRange();
    r.setStart(blk, 0);
    r.setEnd(sel.anchorNode!, sel.anchorOffset);
    return { text: ((blk as HTMLElement).innerText ?? blk.textContent ?? '').trim(), offset: r.toString().length };
  });
}
async function bodyDescription(page: Page): Promise<string> {
  return editorBody(page).first().evaluate((e) => {
    const ids = (e.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean);
    return (e.getAttribute('aria-description') ?? ids.map((id) => document.getElementById(id)?.textContent ?? '').join(' ')).replace(/\s+/g, ' ').trim();
  });
}
async function saved(page: Page, core: FakeCoreHandle, path: string): Promise<string> {
  await sleep(150);
  await mustBeSaved(page);
  return (await fileText(core, path)) ?? '';
}
async function expectCaretAtStartOfBody(page: Page, firstBlock: string, how: string) {
  await sleep(200);
  assert.equal(await focusTarget(page), 'body', `${how}: data-focus-target="body"`);
  assert.ok(await caretInBody(page), `${how}: document.activeElement is inside the textbox "Note body"`);
  const c = await caretBlock(page);
  assert.deepEqual(c, { text: firstBlock, offset: 0 }, `${how}: caret at the start of the first body block`);
}

// ------------------------------------------------------------------------------------------------ AC-11

test('fr_edt_01_ac11_switcher_open_puts_the_caret_at_the_start_of_the_body', async ({ page }) => {
  const core = await openEditor(page, E.prazdna);
  await openNote(page, 'Deset bloků');
  await expectCaretAtStartOfBody(page, 'Přehled', 'switcher');
  assert.equal(await bodyDescription(page), 'Deset bloků', 'the Note body textbox is described by the title (AP-187)');
  await page.keyboard.type('X');
  const t = await saved(page, core, E.deset);
  assert.equal(noModified(t), noModified(original(E.deset)).replace('## Přehled', '## XPřehled'), 'X at the start of block 1, nothing else but modified');
});

test('fr_edt_01_ac11_link_and_type_page_open_put_the_caret_in_the_body', async ({ page }) => {
  // D-943: the click-to-open steps run with Object preview Off; in click mode the same opens are double-clicks.
  const core = await openEditor(page, E.deset, setPreviewMode('off'));
  const link = await must(editorBody(page).getByRole('link', { name: 'Cíl' }), 'link chip Cíl');
  await link.click();
  await mustBeOn(page, 'Cíl', 'followed the link');
  await sleep(200);
  assert.equal(await focusTarget(page), 'body', 'link: data-focus-target="body"');
  assert.ok(await caretInBody(page), 'link: caret in the body');
  // Type page (FR-TYP-09 AC-5): sidebar entry Pages, then a row.
  await (await must(typesList(page).getByRole('link', { name: /^Pages/ }).or(typesList(page).getByRole('button', { name: /^Pages/ })).first(), 'sidebar entry Pages')).click();
  await mustBeOn(page, 'Pages', 'type page Pages');
  const row = await must(page.getByRole('main').getByRole('row').filter({ hasText: 'Deset bloků' }), 'row Deset bloků');
  await row.click();
  await mustBeOn(page, 'Deset bloků', 'opened from the type page');
  await expectCaretAtStartOfBody(page, 'Přehled', 'type page');
  void sidebar;

  // Click to preview (D-943): a double-click on the chip and on the row opens; the caret rule is unchanged.
  await switchPreviewMode(page, core, 'click');
  await (await must(editorBody(page).getByRole('link', { name: 'Cíl' }), 'link chip Cíl (click mode)')).dblclick();
  await mustBeOn(page, 'Cíl', 'click mode: a double-click follows the link');
  await mustNoPreview(page, 'click mode: after the double-click on the chip', 300);
  await sleep(200);
  assert.equal(await focusTarget(page), 'body', 'click mode, link: data-focus-target="body"');
  assert.ok(await caretInBody(page), 'click mode, link: caret in the body');
  await (await must(typesList(page).getByRole('link', { name: /^Pages/ }).or(typesList(page).getByRole('button', { name: /^Pages/ })).first(), 'sidebar entry Pages (click mode)')).click();
  await mustBeOn(page, 'Pages', 'type page Pages (click mode)');
  const row2 = await must(page.getByRole('main').getByRole('row').filter({ hasText: 'Deset bloků' }), 'row Deset bloků (click mode)');
  await row2.click();
  await mustPreview(page, 'Deset bloků', 'click mode: a click on the row previews (AP-812)');
  await escPreview(page, 'click mode: the row preview');
  await row2.dblclick();
  await mustBeOn(page, 'Deset bloků', 'click mode: a double-click on the row opens it');
  await expectCaretAtStartOfBody(page, 'Přehled', 'click mode, type page');
});

test('fr_edt_01_ac11_a_read_only_first_block_puts_the_caret_in_the_first_editable_block', async ({ page }) => {
  const vault = editorVault();
  vault.files[E.surove] = vault.files[E.surove].replace('Úvodní odstavec.\n\n', '');
  assert.ok(vault.files[E.surove].includes('---\n<details>'), 'setup: Surové bloky starts with the HTML block');
  const core = await openEditor(page, E.prazdna, { vault });
  await openNote(page, 'Surové bloky');
  await sleep(200);
  assert.equal(await focusTarget(page), 'body', 'data-focus-target="body"');
  await page.keyboard.type('X');
  const t = await saved(page, core, E.surove);
  assert.ok((await bodyOf(t)).includes('\nXText s poznámkou pod čarou.[^1]\n'), 'X at the start of the first editable block');
  assert.equal(noModified(t).replace('XText s', 'Text s'), noModified(vault.files[E.surove]), 'nothing else changes');
});

test('fr_edt_01_ac11_an_empty_body_gets_the_caret_in_its_empty_paragraph', async ({ page }) => {
  const core = await openEditor(page, E.deset);
  await openNote(page, 'Prázdná');
  await sleep(200);
  assert.equal(await focusTarget(page), 'body', 'data-focus-target="body"');
  assert.ok(await caretInBody(page), 'caret in the body');
  await page.keyboard.type('X');
  const t = await saved(page, core, E.prazdna);
  assert.equal(await bodyOf(t), 'X\n', 'typed into the single empty paragraph (FR-EDT-01 AC-9)');
});

test('fr_edt_01_ac11_a_read_only_file_keeps_the_heading_focus', async ({ page }) => {
  await openEditor(page, E.deset);
  await goToQuery(page, 'Chyba uvozovky');
  await page.keyboard.press('Enter');
  await sleep(500);
  assert.equal(await focusTarget(page), 'heading', 'data-focus-target="heading" on a file opened read-only (D-130)');
  assert.equal((await focused(page)).heading, true, 'the focus is on the title heading');
});

test('fr_edt_01_ac11_placing_the_caret_writes_nothing', async ({ page }) => {
  const core = await openEditor(page, E.prazdna);
  const titles = [...new Set(Object.values(TITLES))].filter((t) => t !== 'Prázdná');
  for (const t of titles) await openNote(page, t);
  await openNote(page, 'Prázdná');
  await sleep(1500);
  assert.equal(await focusTarget(page), 'body', 'red guard: the caret is placed in the body (§15.2)');
  assert.deepEqual((await writes(core)).map((c) => (c.args as any)?.path), [], 'zero note_write after opening every note (FR-FMT-07 AC-8)');
});

test('fr_edt_01_ac11_back_keeps_the_restored_scroll_position', async ({ page }) => {
  const vault = editorVault();
  const extra = Array.from({ length: 80 }, (_, i) => `Odstavec číslo ${i + 1} s textem, aby se poznámka posouvala.`).join('\n\n');
  vault.files[E.deset] = `${vault.files[E.deset].replace(/\n*$/, '\n')}\n${extra}\n\nKonec: [[Cíl]]\n`;
  // D-949: the link is followed with a single click, so the steps run under preview.mode = off.
  await openEditor(page, E.prazdna, { ...setPreviewMode('off'), vault });
  await openNote(page, 'Deset bloků');
  const scroller = () => page.evaluate(() => {
    let s: Element | null = document.querySelector('[aria-label="Note body"]');
    while (s && !(s.scrollHeight > s.clientHeight + 1 && /(auto|scroll)/.test(getComputedStyle(s).overflowY))) s = s.parentElement;
    return s ? s.scrollTop : null;
  });
  const link = await must(editorBody(page).getByRole('link', { name: 'Cíl' }).last(), 'link Cíl at the end');
  await link.evaluate((e) => e.scrollIntoView({ block: 'center' }));
  await sleep(200);
  const left = await scroller();
  assert.ok(left !== null && left > 600, `setup: scrolled (${left})`);
  await link.click();
  await mustBeOn(page, 'Cíl', 'followed the link');
  await page.keyboard.press('Meta+BracketLeft');
  await mustBeOn(page, 'Deset bloků', 'Back');
  await sleep(600); // a late caret placement with scrolling would move it
  const back = await scroller();
  assert.ok(back !== null && Math.abs(back - left!) <= 24, `scroll restored (${back} vs ${left})`);
  assert.equal(await focusTarget(page), 'body', 'the caret is placed (without scrolling)');
});

// ------------------------------------------------------------------------------------------------ AC-12

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

test('fr_edt_01_ac12_new_object_opens_with_the_title_in_edit_mode', async ({ page }) => {
  const core = await openEditor(page, E.deset);
  await pressNewObject(page, '⌘N');
  await mustBeDraft(page, '⌘N');
  await sleep(300);
  assert.deepEqual(await titleCaretAtEnd(page), { inTitle: true, atEnd: true, collapsed: true }, 'the empty title in edit mode, caret in it, nothing selected');
  assert.deepEqual(await core.writesTo(), [], 'focusing the title writes nothing (D-520: the draft is unsaved)');
  await page.keyboard.type('Nový zápis');
  await page.keyboard.press('Enter');
  await mustBeOn(page, 'Nový zápis', 'the new note after ↩', 5000);
  const path = 'Quick Notes/Nový zápis.md';
  assert.deepEqual(await eventually(() => core.writesTo(), (w) => w.length > 0, 2000), [path], 'the creation write is the only write');
  assert.ok(await eventually(() => caretInBody(page), (x) => x, 1000), '⏎ moves the caret to the body');
});

test('fr_edt_01_ac12_switcher_create_item_opens_with_the_title_focused', async ({ page }) => {
  await openEditor(page, E.deset);
  await goToQuery(page, 'Úplně nový');
  await sleep(150);
  await searchCreateButton(page).click(); // D-1343, D-1345: the Search page's `Create “…”` button (before it the Go to create row)
  await mustBeOn(page, 'Úplně nový', 'new note opens');
  await sleep(300);
  assert.equal(await focusTarget(page), 'title', 'data-focus-target="title"');
  assert.deepEqual(await titleCaretAtEnd(page), { inTitle: true, atEnd: true, collapsed: true }, 'caret at the end of the title');
});

test('fr_edt_01_ac12_type_page_new_opens_with_the_title_focused', async ({ page }) => {
  await openEditor(page, E.deset);
  await (await must(typesList(page).getByRole('link', { name: /^Pages/ }).or(typesList(page).getByRole('button', { name: /^Pages/ })).first(), 'sidebar entry Pages')).click();
  await mustBeOn(page, 'Pages', 'type page Pages');
  await page.getByRole('main').getByRole('button', { name: 'New Page', exact: true }).click();
  await mustBeDraft(page, 'New Page');
  await sleep(300);
  assert.deepEqual(await titleCaretAtEnd(page), { inTitle: true, atEnd: true, collapsed: true }, 'caret in the empty title, nothing selected');
  await page.keyboard.type('Nová stránka z typu');
  await page.keyboard.press('Enter');
  await mustBeOn(page, 'Nová stránka z typu', 'the new note after ↩', 5000);
});

test('fr_edt_01_ac12_link_create_moves_no_focus', async ({ page }) => {
  await openEditor(page, E.prazdna);
  await editorBody(page).first().click();
  await page.keyboard.type('[[Nový cíl');
  await page.getByRole('listbox', { name: 'Link suggestions', exact: true }).getByRole('option', { name: 'Create "Nový cíl"', exact: true }).click();
  await sleep(300);
  assert.ok(await caretInBody(page), 'the caret stays in the body');
  assert.equal(await focusTarget(page), 'body', 'no navigation, the focus target is still the body (§15.2)');
});
