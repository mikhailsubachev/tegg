// Regression test for the second QA review of slice 4E-1 (qa/reviews/4e-1-type-moves-2.md, N2): while a type move of
// the open note runs, nothing typed in the body, the title or the property panel reaches the file, so the moved note
// keeps its new type (D-804, NFR-REL-02).
import { test } from '@playwright/test';
import assert from 'node:assert/strict';
import { M, changeTo, editorBody, eventually, fileWhen, jobStatus, main, movesVault, must, openMoves, sleep } from './type-moves-helpers';

test('bug_qa4e1_n2_fr_sto_04_ac4_typing_during_a_move_does_not_revert_it', async ({ page }) => {
  const core = await openMoves(page, { at: M.plan });
  const release = await core.holdJob('writing');
  await changeTo(page, 'Kniha');
  await sleep(300);
  await (await must(editorBody(page), 'Note body')).click({ force: true });
  await page.keyboard.type('psaní během přesunu');
  assert.equal(await main(page).getByRole('textbox', { name: /^⟦?Title⟧?$/ }).count(), 0, 'the title is not editable while the note moves');
  const panelInputs = main(page).getByRole('region', { name: 'Properties', exact: true }).locator('input:not([disabled]), textarea:not([disabled]), [contenteditable="true"]');
  assert.equal(await panelInputs.count(), 0, 'nor any property field (QA m5)');
  const source = main(page).locator('[data-command="note.toggleSource"]');
  if (await source.count()) assert.equal(await source.isDisabled(), true, 'nor the source view');
  await release();
  const t = await fileWhen(core, 'Knihy/Plán.md', (x) => !!x?.includes('type: kniha'), 5000);
  assert.ok(t?.includes('\ntype: kniha\n'), 'the moved note keeps its new type');
  assert.ok(!t?.includes('psaní během přesunu'), 'nothing typed during the move reached the file');
  await sleep(1500);
  const after = await fileWhen(core, 'Knihy/Plán.md', (x) => x !== undefined);
  assert.ok(after?.includes('\ntype: kniha\n'), 'and no later save brings the old type back');
});

// Fourth QA review (qa/reviews/4e-1-type-moves-4.md, M1′): a type change in place is written on disk, and so is its
// undo; the open page shows the restored type at once (FR-STO-04 AC-11, D-812).
test('bug_qa4e1_4_m1p_fr_sto_04_ac11_the_open_page_shows_the_undone_in_place_type_change', async ({ page }) => {
  const p = 'Knihy/Stránka.md';
  const pre = '---\nid: 01JB4E0000000000000000E0C1\ntype: page\ntitle: Stránka\n---\nText.\n';
  // A Page in Knihy/ is a stray: no tidy job here, so the test changes its type itself.
  const core = await openMoves(page, { vault: movesVault((f) => { f[p] = pre; }), at: p, tidy: false });
  const chip = (name: string) => main(page).getByRole('link', { name: `Type: ${name}`, exact: true });
  await must(chip('Page'), 'chip "Type: Page"');
  await changeTo(page, 'Kniha');
  await fileWhen(core, p, (t) => !!t?.includes('\ntype: kniha\n'));
  await must(chip('Kniha'), 'chip "Type: Kniha" after the change');
  await (await must(jobStatus(page, 'Now a Kniha').getByRole('button', { name: 'Undo', exact: true }), 'status Undo')).click();
  assert.equal(await fileWhen(core, p, (t) => t === pre), pre, 'the exact pre-change bytes');
  assert.ok(await eventually(() => chip('Page').count(), (n) => n === 1, 3000), 'the open page shows Page again');
  assert.equal(await chip('Kniha').count(), 0);
});
