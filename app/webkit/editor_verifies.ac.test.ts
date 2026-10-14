// MS3 slice 3C, L5: the existing criteria that editor.md says this slice verifies ("Existing criteria this slice
// verifies"), each under its own AC name so the milestone check counts them (tools/qa CONTRACT §9.2: one AC per test
// name): data-safety FR-EDT-08 AC-1…AC-3, FR-SYN-03 AC-2…AC-4, FR-SYN-04 AC-3, FR-VLT-01 AC-8 (flush part) and
// file-format FR-STO-02 AC-2 (the MS3 gate's editor round-trip through UI edits, BRD §11.2). Each runs the scenario of
// the editor.md criterion that verifies it (named in the test). Written from the ACs and ms3-shell §13 only (D-61).
import { test } from '@playwright/test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { newEmptyVault } from '../ui/test/fake-core';
import { openNote, runCommand, start, mustBeOn } from './helpers';
import {
  E, REPO, argText, caretIn, conflictsList, conflictsVault, deletedAlert, editorBody, editorVault, eventually, fileText,
  keyTimes, mergeDialog, must, mustBeSaved, openEditor, original, recordKeys, sleep, writes,
} from './editor-helpers';

const B5 = 'Pátý blok, který test upraví.';

test('fr_edt_08_ac1_written_within_1s_of_the_last_keystroke', async ({ page }) => {
  // Verified by editor.md FR-EDT-08 AC-4 (first part).
  await page.clock.install({ time: new Date('2026-10-13T12:00:00Z') });
  const core = await openEditor(page, E.deset);
  await caretIn(page, 5);
  await page.clock.pauseAt(new Date('2026-10-13T12:00:10Z'));
  await recordKeys(page);
  await page.keyboard.type('abc');
  await page.clock.runFor(1000);
  await sleep(100);
  const last = (await keyTimes(page)).pop()!;
  const w = (await writes(core, E.deset)).find((x) => argText(x).includes(`${B5}abc`));
  assert.ok(w, 'the last keystroke is written');
  assert.ok(w!.at! - last <= 1000, `written ${w!.at! - last} ms after the last keystroke (≤ 1 s)`);
});

test('fr_edt_08_ac2_ten_seconds_of_typing_at_most_ten_writes', async ({ page }) => {
  // Verified by editor.md FR-EDT-08 AC-4 (second part).
  await page.clock.install({ time: new Date('2026-10-13T12:00:00Z') });
  const core = await openEditor(page, E.deset);
  await caretIn(page, 5);
  await page.clock.pauseAt(new Date('2026-10-13T12:00:10Z'));
  for (let i = 0; i < 100; i++) {
    await page.keyboard.press('x');
    await page.clock.runFor(100);
  }
  const during = (await writes(core, E.deset)).length;
  assert.ok(during >= 1 && during <= 10, `writes during 10 s of typing: ${during} (1…10)`);
});

test('fr_edt_08_ac3_switching_notes_flushes_pending_changes', async ({ page }) => {
  // Verified by editor.md FR-EDT-08 AC-7 (switcher; close and ⌘Q in L6).
  const core = await openEditor(page, E.deset);
  await core.writeControl({ delayMs: 300 });
  await caretIn(page, 5);
  const n0 = (await core.calls()).length;
  await page.keyboard.type('F');
  await openNote(page, 'Cíl');
  await sleep(1000);
  const calls = (await core.calls()).slice(n0);
  const w = calls.find((c) => c.cmd === 'note_write' && argText(c).includes(`${B5}F`));
  const r = calls.find((c) => c.cmd === 'note_read' && (c.args as any).path === E.cil);
  assert.ok(w && r && w.endSeq! < r.seq!, 'the pending change is written before the other note is read');
});

test('fr_vlt_01_ac8_opening_another_vault_flushes_pending_saves', async ({ page }) => {
  // Verified by editor.md FR-EDT-08 AC-7 (opening another vault).
  const core = await openEditor(page, E.deset, { pickDir: '/fake/Druhý', dirs: { '/fake/Druhý': newEmptyVault('Druhý') } });
  await core.writeControl({ delayMs: 300 });
  await caretIn(page, 5);
  const n0 = (await core.calls()).length;
  await page.keyboard.type('V');
  await runCommand(page, 'Open vault…');
  await page.getByRole('main', { name: 'Choose a vault' }).getByRole('button', { name: 'Open existing folder' }).click({ timeout: 3000 }).catch(() => {});
  await sleep(1000);
  const calls = (await core.calls()).slice(n0);
  const w = calls.find((c) => c.cmd === 'note_write' && argText(c).includes(`${B5}V`));
  assert.ok(w && w.ok, 'the pending save of the current vault is written');
  const o = calls.find((c) => c.cmd === 'vault_open');
  if (o) assert.ok(w!.endSeq! < o.seq!, 'before the other vault opens');
});

test('fr_syn_03_ac2_clean_note_reloads_silently', async ({ page }) => {
  // Verified by editor.md FR-SYN-03 AC-12.
  const core = await openEditor(page, E.deset);
  await caretIn(page, 9, 'Tip');
  await core.setFile(E.deset, original(E.deset).replace('Odstavec s _kurzívou_', 'Odstavec změněný jinde s _kurzívou_'));
  const shown = await eventually(async () => (await editorBody(page).first().innerText()).includes('změněný jinde'), (v) => v, 2000);
  assert.ok(shown, 'reloaded');
  const inBlock9 = await page.evaluate(() => {
    const s = window.getSelection();
    const kids = [...(document.querySelector('[aria-label="Note body"]')?.children ?? [])];
    return !!s?.anchorNode && kids.findIndex((k) => k.contains(s.anchorNode)) === 8;
  });
  assert.ok(inBlock9, 'the cursor stays in the same block');
  assert.equal(await page.getByRole('dialog').count(), 0, 'silently');
  assert.equal((await writes(core)).length, 0, 'no write');
});

test('fr_syn_03_ac3_unsaved_edits_get_a_merge_dialog', async ({ page }) => {
  // Verified by editor.md FR-SYN-03 AC-13.
  await page.clock.install({ time: new Date('2026-10-13T12:00:00Z') });
  const core = await openEditor(page, E.deset);
  await page.clock.pauseAt(new Date('2026-10-13T12:00:05Z'));
  await caretIn(page, 5);
  await page.keyboard.type(' Moje.');
  const theirs = original(E.deset).replace('| a \\| b | 1 |', '| a \\| b | 2 |');
  await core.setFile(E.deset, theirs);
  await must(mergeDialog(page), 'merge dialog with both versions', 2000);
  await page.clock.runFor(5000);
  assert.equal(await fileText(core, E.deset), theirs, 'the app does not write its version');
});

test('fr_syn_03_ac4_deleted_while_open_keeps_content_and_offers_restore', async ({ page }) => {
  // Verified by editor.md FR-SYN-03 AC-17.
  await page.clock.install({ time: new Date('2026-10-13T12:00:00Z') });
  const core = await openEditor(page, E.deset);
  await page.clock.pauseAt(new Date('2026-10-13T12:00:05Z'));
  await caretIn(page, 5);
  await page.keyboard.type(' Moje.');
  await core.setFile(E.deset, null);
  const al = await must(deletedAlert(page), 'deleted alert', 2000);
  await must(al.getByRole('button', { name: 'Restore file', exact: true }), 'Restore file');
  await must(al.getByRole('button', { name: 'Discard', exact: true }), 'Discard');
  assert.ok((await editorBody(page).first().innerText()).includes('Moje.'), 'content kept in the editor');
});

test('fr_syn_04_ac3_conflicts_view_keep_left_keeps_id_and_links', async ({ page }) => {
  // Verified by editor.md FR-SYN-04 AC-5, AC-7, AC-8.
  const core = await start(page, { vault: conflictsVault(), last: { path: 'Pages/Odkazuje.md', id: '01JB0K0000000000000000K007' } });
  await mustBeOn(page, 'Odkazuje', 'landing', 5000);
  await runCommand(page, 'Go to Conflicts');
  await must(conflictsList(page), 'Conflicts list');
  await conflictsList(page).getByRole('link').filter({ hasText: 'conflicted copy' }).first().click();
  for (const b of ['Keep left', 'Keep right', 'Merge…']) await must(page.getByRole('button', { name: b, exact: true }), b);
  await page.getByRole('button', { name: 'Keep left', exact: true }).click();
  await page.getByRole('dialog').getByRole('button').filter({ hasNotText: 'Cancel' }).first().click();
  await sleep(500);
  const files = await core.files();
  assert.ok(files['.trash/Pages/Plán (conflicted copy 2026-10-07).md'] !== undefined, 'the other file moved to .trash/');
  assert.equal(/^id: (\S+)/m.exec(files['Pages/Plán.md'])?.[1], '01JB0K0000000000000000K001', 'the surviving file keeps its id');
  const r = await page.evaluate(async () => (window as any).__TAURI_INTERNALS__.invoke('link_resolve', { from: 'Pages/Odkazuje.md', targets: ['Plán'] }));
  assert.equal(r[0]?.path, 'Pages/Plán.md', 'links never break');
});

test('fr_sto_02_ac2_ui_edits_keep_crlf_and_bom', async ({ page }) => {
  // The MS3 gate's "editor round-trip through UI edits" (BRD §11.2); verified by editor.md FR-FMT-07 AC-12.
  const v = editorVault();
  const crlf = readFileSync(resolve(REPO, 'tests/fixtures/format/roundtrip/edge/CRLF line endings.md'), 'utf8');
  const bom = readFileSync(resolve(REPO, 'tests/fixtures/format/roundtrip/edge/BOM.md'), 'utf8');
  v.files['Pages/CRLF.md'] = crlf;
  v.files['Pages/BOM.md'] = bom;
  const core = await openEditor(page, 'Pages/CRLF.md', { vault: v });
  const n = await editorBody(page).locator(':scope > *').count();
  await caretIn(page, n);
  await page.keyboard.type(' Ž');
  await mustBeSaved(page);
  await sleep(150);
  const t = (await fileText(core, 'Pages/CRLF.md'))!;
  assert.ok(t.includes('Paragraph. Ž\r\n') && !/[^\r]\n/.test(t), 'CRLF kept on every line');
  await openNote(page, 'With BOM');
  await must(editorBody(page), 'editor on BOM.md');
  await caretIn(page, 1);
  await page.keyboard.type(' Ž');
  await mustBeSaved(page);
  await sleep(150);
  const b = (await fileText(core, 'Pages/BOM.md'))!;
  assert.ok(b.startsWith('﻿') && b.includes('Body after BOM. Ž'), 'BOM kept');
});
