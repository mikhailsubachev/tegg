// MS3 slice 3C, L5 (WebKit + fake core): external changes while a note is open in the editor. FR-SYN-03 AC-12…AC-18
// (verifying data-safety FR-SYN-03 AC-2, -3, -4, -6). Written from docs/acceptance/editor.md and
// docs/contracts/ms3-shell.md §13 only (D-61). External changes come from the fake core (`setFile`, `renameFile`, with or
// without `vault:changed`); autosave is held with the injected clock or `writeControl`.
import { test, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import { absent, nonReadCalls, sidebar } from './helpers';
import { sourceRegion } from './read-helpers';
import {
  E, argText, block, bodyOf, caretIn, compareRegion, deletedAlert, editorBody, eventually, fileText, mergeDialog, must,
  mustBeSaved, noModified, openEditor, original, seen, sleep, stateIs, writes, type FakeCoreHandle,
} from './editor-helpers';

const B5 = 'Pátý blok, který test upraví.';
const theirs = () => original(E.deset).replace('| a \\| b | 1 |', '| a \\| b | 2 |'); // block 8 changed elsewhere

/** Caret position as (1-based top-level block, offset in that block's first text node). */
async function caretPos(page: Page): Promise<{ block: number; offset: number } | null> {
  return page.evaluate(() => {
    const s = window.getSelection();
    const body = document.querySelector('[aria-label="Note body"]');
    if (!s || !s.anchorNode || !body) return null;
    const kids = [...body.children];
    const i = kids.findIndex((k) => k.contains(s.anchorNode));
    if (i < 0) return null;
    const walker = document.createTreeWalker(kids[i], NodeFilter.SHOW_TEXT);
    const first = walker.nextNode();
    return { block: i + 1, offset: s.anchorNode === first ? s.anchorOffset : -1 };
  });
}

async function pausedEditor(page: Page, path: string = E.deset): Promise<FakeCoreHandle> {
  await page.clock.install({ time: new Date('2026-10-13T12:00:00Z') });
  const core = await openEditor(page, path);
  await page.clock.pauseAt(new Date('2026-10-13T12:00:05Z'));
  return core;
}

test('fr_syn_03_ac12_reload_when_clean_keeps_caret_and_scroll', async ({ page }) => {
  const core = await openEditor(page, E.deset);
  await caretIn(page, 9, 'Tip');
  const before = await caretPos(page);
  assert.deepEqual(before, { block: 9, offset: 3 }, 'setup: caret in block 9 at offset 3');
  const scroll0 = await editorBody(page).first().evaluate((el) => { let s: Element | null = el; while (s && s.scrollHeight <= s.clientHeight) s = s.parentElement; return s ? s.scrollTop : 0; });
  await core.setFile(E.deset, original(E.deset).replace('Odstavec s _kurzívou_', 'Odstavec změněný jinde s _kurzívou_'));
  const shown = await eventually(async () => (await block(page, 2).innerText().catch(() => '')).includes('změněný jinde'), (v) => v, 2000);
  assert.ok(shown, 'the new text within 2 s');
  assert.deepEqual(await caretPos(page), { block: 9, offset: 3 }, 'caret still in block 9 at offset 3');
  const scroll1 = await editorBody(page).first().evaluate((el) => { let s: Element | null = el; while (s && s.scrollHeight <= s.clientHeight) s = s.parentElement; return s ? s.scrollTop : 0; });
  assert.ok(Math.abs(scroll1 - scroll0) <= 30, 'scroll kept (± one line)');
  assert.equal(await page.getByRole('dialog').count(), 0, 'no dialog');
  assert.equal((await writes(core)).length, 0, 'no write');
});

test('fr_syn_03_ac12_deleted_caret_block_moves_to_end_of_previous', async ({ page }) => {
  const core = await openEditor(page, E.deset);
  await caretIn(page, 9, 'Tip');
  await core.setFile(E.deset, original(E.deset).replace('> [!tip]+ Tip\n> Obsah tipu.\n\n', ''));
  await eventually(async () => (await editorBody(page).first().innerText()).includes('Obsah tipu'), (v) => !v, 2000);
  const pos = await caretPos(page);
  const b8len = await block(page, 8).evaluate((el) => { const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); let last: Node | null = null; for (let n = w.nextNode(); n; n = w.nextNode()) last = n; const s = window.getSelection(); return { atEnd: !!s && s.anchorNode === last && s.anchorOffset === (last as Text | null)?.data.length }; });
  assert.equal(pos?.block, 8, 'caret goes to block 8');
  assert.ok(b8len.atEnd, 'at the end of block 8');
});

test('fr_syn_03_ac12_history_emptied_on_reload', async ({ page }) => {
  const core = await openEditor(page, E.deset);
  await caretIn(page, 5);
  await page.keyboard.type(' A');
  await mustBeSaved(page);
  await core.setFile(E.deset, (await fileText(core, E.deset))!.replace('## Přehled', '## Přehled jinde'));
  await eventually(async () => (await editorBody(page).first().innerText()).includes('Přehled jinde'), (v) => v, 2000);
  const n = (await writes(core)).length;
  await page.keyboard.press('Meta+z');
  await sleep(1500);
  assert.equal((await writes(core)).length, n, 'undo history emptied (AP-122)');
});

test('fr_syn_03_ac12_invalid_frontmatter_switches_to_read_only_source', async ({ page }) => {
  const core = await openEditor(page, E.deset);
  await core.setFile(E.deset, original(E.deset).replace('title: Deset bloků', 'title: "Deset bloků'));
  await must(sourceRegion(page), 'read-only source view', 2500);
  await must(page.getByRole('alert'), 'warning of read-view NFR-REL-03 AC-3');
  assert.ok(await absent(editorBody(page), 500), 'no editor');
  await sleep(1000);
  assert.deepEqual(await nonReadCalls(core), [], 'no write');
});

test('fr_syn_03_ac13_unsaved_edits_never_overwritten', async ({ page }) => {
  const core = await pausedEditor(page);
  await caretIn(page, 5);
  await page.keyboard.type(' Moje.');
  await core.setFile(E.deset, theirs());
  const dlg = await must(mergeDialog(page), 'dialog "Note changed outside Tegg"', 2000);
  assert.equal(await dlg.getAttribute('aria-modal'), 'true', 'modal');
  for (const b of ['Keep mine', 'Keep theirs', 'Keep both', 'Compare']) await must(dlg.getByRole('button', { name: b, exact: true }), b);
  await page.clock.runFor(10_000);
  await sleep(200);
  assert.equal(await fileText(core, E.deset), theirs(), 'the file holds the other program\'s bytes after 10 s');
  assert.ok((await writes(core)).every((w) => w.ok === false), 'no note_write of the editor\'s version succeeded');
  const text0 = await editorBody(page).first().innerText();
  await page.keyboard.type('Q');
  assert.equal(await editorBody(page).first().innerText(), text0, 'the editor doesn\'t accept typing while the dialog is open');
  await page.keyboard.press('Escape');
  assert.ok(await seen(mergeDialog(page), 300), 'Esc doesn\'t close it');
});

test('fr_syn_03_ac14_save_time_check_catches_silent_change', async ({ page }) => {
  const core = await openEditor(page, E.deset);
  await core.setFile(E.deset, theirs(), { silent: true });
  await caretIn(page, 5);
  await page.keyboard.type(' Moje.');
  await must(mergeDialog(page), 'merge dialog after the Conflict', 3000);
  const ws = await writes(core, E.deset);
  assert.ok(ws.length >= 1 && ws.every((w) => w.ok === false), 'the save got Conflict');
  assert.equal(await fileText(core, E.deset), theirs(), 'nothing written');
});

async function conflictOpen(page: Page): Promise<FakeCoreHandle> {
  const core = await pausedEditor(page);
  await caretIn(page, 5);
  await page.keyboard.type(' Moje.');
  await core.setFile(E.deset, theirs());
  await must(mergeDialog(page), 'merge dialog', 2000);
  return core;
}

test('fr_syn_03_ac15_keep_theirs', async ({ page }) => {
  const core = await conflictOpen(page);
  const n = (await writes(core)).length;
  await mergeDialog(page).getByRole('button', { name: 'Keep theirs', exact: true }).click();
  await page.clock.runFor(2000);
  assert.ok(await absent(mergeDialog(page)), 'dialog closed');
  const txt = await editorBody(page).first().innerText();
  assert.ok(!txt.includes('Moje.') && /\b2\b/.test(await block(page, 8).innerText()), 'the editor shows the disk version');
  assert.equal((await writes(core)).length, n, 'nothing written');
});

test('fr_syn_03_ac15_keep_mine', async ({ page }) => {
  const core = await conflictOpen(page);
  const v = await core.version(E.deset);
  const n = (await writes(core)).length;
  await mergeDialog(page).getByRole('button', { name: 'Keep mine', exact: true }).click();
  await page.clock.runFor(2000);
  await sleep(200);
  const ws = (await writes(core, E.deset)).slice(n);
  assert.equal(ws.length, 1, 'one note_write');
  assert.deepEqual((ws[0].args as any).base, v, 'its base is the disk version just shown');
  const t = (await fileText(core, E.deset))!;
  assert.equal(noModified(t), noModified(original(E.deset)).replace(B5, `${B5} Moje.`), 'the file becomes the editor\'s content');
  assert.notEqual(/^modified: .*/m.exec(t)?.[0], /^modified: .*/m.exec(original(E.deset))?.[0], 'with a new modified');
});

test('fr_syn_03_ac15_keep_both', async ({ page }) => {
  const core = await conflictOpen(page);
  await mergeDialog(page).getByRole('button', { name: 'Keep both', exact: true }).click();
  await page.clock.runFor(2000);
  await sleep(200);
  const files = await core.files();
  const copy = Object.keys(files).find((p) => /^Pages\/Deset bloků \(conflict \d{4}-\d\d-\d\d \d\d-\d\d\)\.md$/.test(p));
  assert.ok(copy, `conflict copy created: ${Object.keys(files).filter((p) => p.includes('Deset')).join(', ')}`);
  assert.ok((await core.calls()).some((c) => c.cmd === 'note_create_exact'), 'created with note_create_exact');
  assert.equal(/^id: (\S+)/m.exec(files[copy!])?.[1], '01JB0E0000000000000000E001', 'same id');
  assert.ok(files[copy!].includes(`${B5} Moje.`), 'the copy holds the editor\'s content');
  assert.equal(files[E.deset], theirs(), 'the note keeps the disk version');
  assert.ok(!(await editorBody(page).first().innerText()).includes('Moje.'), 'the editor shows the disk version');
  await must(sidebar(page).getByRole('link', { name: /Conflicts/ }), 'Conflicts entry lists the pair (FR-SYN-04 AC-5/AC-6)');
});

test('fr_syn_03_ac15_compare_and_newest_base', async ({ page }) => {
  const core = await conflictOpen(page);
  await mergeDialog(page).getByRole('button', { name: 'Compare', exact: true }).click();
  const r = await must(compareRegion(page), 'region "Compare versions"');
  const txt = await r.innerText();
  assert.ok(txt.includes('Your version') && txt.includes('Version on disk'), 'both columns');
  const changed = await r.locator('[data-diff="changed"]').allInnerTexts();
  assert.ok(changed.some((x) => x.includes('Moje.')) && changed.some((x) => x.includes('| 2 |') || x.includes('2')), `differing lines marked: ${changed.join(' | ')}`);
  for (const b of ['Keep mine', 'Keep theirs', 'Keep both']) await must(page.getByRole('button', { name: b, exact: true }), `${b} in compare`);
  const newest = theirs().replace('Obsah tipu.', 'Obsah tipu, znovu.');
  await core.setFile(E.deset, newest);
  await eventually(async () => (await r.innerText()).includes('znovu'), (v) => v, 2000);
  assert.ok((await r.innerText()).includes('znovu'), 'the disk side updates');
  const v = await core.version(E.deset);
  const n = (await writes(core)).length;
  await page.getByRole('button', { name: 'Keep mine', exact: true }).first().click();
  await page.clock.runFor(2000);
  await sleep(200);
  const w = (await writes(core, E.deset)).slice(n)[0];
  assert.deepEqual((w?.args as any)?.base, v, 'Keep mine uses the newest version as base');
});

test('fr_syn_03_ac16_same_bytes_rewrite_is_not_a_change', async ({ page }) => {
  const core = await openEditor(page, E.deset);
  await core.setFile(E.deset, original(E.deset), { sameBytesTouch: true });
  await sleep(1000);
  assert.equal(await page.getByRole('dialog').count(), 0, 'no dialog');
  await caretIn(page, 5);
  await page.keyboard.type(' Po.');
  await mustBeSaved(page);
  const ws = await writes(core, E.deset);
  assert.ok(ws.length === 1 && ws[0].ok === true && (ws[0].result as any)?.outcome === 'written', 'next save succeeds without Conflict');
});

test('fr_syn_03_ac16_disk_equal_to_unsaved_content_counts_as_saved', async ({ page }) => {
  const core = await pausedEditor(page);
  await caretIn(page, 5);
  await page.keyboard.type(' Stejné.');
  const mine = await page.evaluate(() => (window as any).__TEGG_TEST__?.editor?.text?.() as string | undefined);
  assert.ok(mine && mine.includes(`${B5} Stejné.`), 'test hook editor.text() gives the would-be text (§13.6)');
  await core.setFile(E.deset, mine!);
  await page.clock.runFor(3000);
  await sleep(300);
  assert.equal(await page.getByRole('dialog').count(), 0, 'no dialog');
  assert.ok(await stateIs(page, 'Saved'), 'the edits count as saved');
  assert.ok((await writes(core)).every((w) => (w.result as any)?.outcome !== 'written'), 'nothing written');
});

test('fr_syn_03_ac17_deleted_while_open_restore', async ({ page }) => {
  const core = await pausedEditor(page);
  await caretIn(page, 5);
  await page.keyboard.type(' Moje.');
  await core.setFile(E.deset, null);
  const al = await must(deletedAlert(page), 'alert "This note was deleted outside Tegg"', 2000);
  await page.clock.runFor(3000);
  assert.ok((await editorBody(page).first().innerText()).includes('Moje.'), 'the editor keeps the content');
  assert.ok((await writes(core)).every((w) => w.ok === false || (w.args as any).base === null), 'no save to the missing path before a choice');
  await al.getByRole('button', { name: 'Restore file', exact: true }).click();
  await page.clock.runFor(2000);
  await sleep(200);
  const t = await fileText(core, E.deset);
  assert.ok(t && t.includes(`${B5} Moje.`), 'Restore file creates the file at its old path with the editor\'s content');
});

test('fr_syn_03_ac17_deleted_while_open_discard_and_trash_move', async ({ page }) => {
  const core = await pausedEditor(page);
  await caretIn(page, 5);
  await page.keyboard.type(' Moje.');
  await core.renameFile(E.deset, '.trash/Pages/Deset bloků.md');
  const al = await must(deletedAlert(page), 'alert for a move into .trash/', 2000);
  const n = (await core.writesTo()).length;
  await al.getByRole('button', { name: 'Discard', exact: true }).click();
  await must(page.getByText('This note was moved or deleted'), 'read-view message');
  await page.clock.runFor(2000);
  assert.equal((await core.writesTo()).length, n, 'Discard writes nothing');
});

test('fr_syn_03_ac17_deleted_without_edits_shows_message_at_once', async ({ page }) => {
  const core = await openEditor(page, E.deset);
  await core.setFile(E.deset, null);
  await must(page.getByText('This note was moved or deleted'), 'message at once', 2000);
  assert.ok(await absent(deletedAlert(page), 300), 'no Restore/Discard alert without edits');
});

test('fr_syn_03_ac17_restore_when_file_reappeared_is_a_conflict', async ({ page }) => {
  const core = await pausedEditor(page);
  await caretIn(page, 5);
  await page.keyboard.type(' Moje.');
  await core.setFile(E.deset, null);
  const al = await must(deletedAlert(page), 'deleted alert', 2000);
  await core.setFile(E.deset, theirs(), { silent: true });
  await al.getByRole('button', { name: 'Restore file', exact: true }).click();
  await must(mergeDialog(page), 'Conflict → the AC-13 dialog', 2000);
  assert.equal(await fileText(core, E.deset), theirs(), 'the reappeared file is not overwritten');
});

test('fr_syn_03_ac18_renamed_while_open_with_unsaved_edits', async ({ page }) => {
  const core = await pausedEditor(page);
  await caretIn(page, 5);
  await page.keyboard.type(' Moje.');
  const moved = 'Quick Notes/Deset bloků.md';
  await core.renameFile(E.deset, moved);
  await sleep(300);
  await page.clock.runFor(2000);
  await sleep(300);
  const ws = await writes(core);
  const ok = ws.filter((w) => w.ok);
  assert.equal(ok.length, 1, 'one successful save');
  assert.equal((ok[0].args as any).path, moved, 'to the new path');
  assert.ok(argText(ok[0]).includes(`${B5} Moje.`), 'with the edit');
  assert.equal((await core.files())[E.deset], undefined, 'no file at the old path');
  // No breadcrumb (D-315): the save to the new path is the evidence of D-161.
  void bodyOf;
});
