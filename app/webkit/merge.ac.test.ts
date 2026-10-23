// MS4 slice 4D-lite L5 (WebKit, fake core): `Merge…` on Duplicate titles (docs/acceptance/tags.md FR-LNK-14 AC-11:
// enabled, the dialog `Merge "Schůzka"` with the Keep radiogroup, the conflict list from `job_plan`, the line, Cancel
// and Esc write nothing; AC-12: Merge writes the kept object, the linking file and the trash move, the group leaves
// the page within 2 s, no Undo). Interface docs/contracts/ms4-tags.md §4.4 (`merge_start`, `job_plan` conflicts,
// `job_confirm`), §6.2 (`links/MergeDialog.tsx`). Written from the ACs and the contract only (D-61).
import { test, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import { P, callsOf, click, eventually, flat, main, must, original, seen, startTags, vaultWrites } from './tags-helpers';

const dialog = (page: Page) => page.getByRole('dialog', { name: 'Merge "Schůzka"', exact: true });
async function openDuplicates(page: Page) {
  const core = await startTags(page, { route: 'duplicate-titles' });
  await must(main(page).getByText('SCHŮZKA', { exact: true }).or(main(page).getByText('Schůzka 2')).first(), 'Duplicate titles lists the Schůzka group', 5000);
  return core;
}
const groupOf = (page: Page) => main(page).getByRole('group').filter({ hasText: 'Pages/schůzka (2).md' }).or(main(page).locator('section, [role="region"], li').filter({ hasText: 'Pages/schůzka (2).md' })).first();

test('fr_lnk_14_ac11_merge_is_offered_with_its_dialog', async ({ page }) => {
  const core = await openDuplicates(page);
  const btn = await must(groupOf(page).getByRole('button', { name: 'Merge…', exact: true }), 'the group\'s Merge…');
  assert.notEqual(await btn.getAttribute('aria-disabled'), 'true', 'enabled');
  assert.equal(await main(page).getByText('Coming in MS4 (4D)').count(), 0, 'no Coming in MS4 (4D)');
  await btn.click();
  const d = await must(dialog(page), 'dialog Merge "Schůzka"');
  const keep = await must(d.getByRole('radiogroup', { name: 'Keep', exact: true }), 'radiogroup Keep');
  const radios = keep.getByRole('radio');
  assert.equal(await radios.count(), 2, 'one radio per object');
  const checked = await radios.evaluateAll((rs) => rs.map((r) => [(r.getAttribute('aria-label') ?? r.textContent ?? '').replace(/\s+/g, ' '), r.getAttribute('aria-checked') ?? String((r as HTMLInputElement).checked)]));
  assert.ok(String(checked[0][1]) === 'true' && /Pages\/Schůzka\.md/.test(flat(await keep.textContent())), `the first by created checked: ${JSON.stringify(checked)}`);
  const conflicts = await must(d.getByText('Different values: the kept object\'s value stays', { exact: true }), 'the conflict list');
  void conflicts;
  assert.ok(/x-místo/.test(flat(await d.textContent())) && /Brno/.test(flat(await d.textContent())) && /Praha/.test(flat(await d.textContent())), 'x-místo: Brno / Praha');
  await must(d.getByText('The other 1 objects are added to the kept one and moved to the trash. Links to them are changed. A backup is made first. This can\'t be undone.').or(d.getByText(/^The other 1 object(s)? (is|are) added to the kept one/)), 'merge.line');
  await must(d.getByRole('button', { name: 'Merge 2 objects', exact: true }), 'Merge 2 objects');
  assert.ok((await callsOf(core, 'job_plan')).length >= 1, 'the conflicts come from job_plan');
  await d.getByRole('button', { name: 'Cancel', exact: true }).click();
  await btn.click();
  await must(dialog(page), 'again');
  await page.keyboard.press('Escape');
  assert.deepEqual((await vaultWrites(core)).filter((c) => c !== 'merge_start'), [], 'Cancel and Esc write nothing');
  assert.equal((await core.jobs()).filter((j) => j.phase === 'done').length, 0, 'no merge ran');
});

test('fr_lnk_14_ac12_merge_from_the_dialog', async ({ page }) => {
  const core = await openDuplicates(page);
  await click(groupOf(page).getByRole('button', { name: 'Merge…', exact: true }), 'Merge…');
  await click(dialog(page).getByRole('button', { name: 'Merge 2 objects', exact: true }), 'Merge 2 objects');
  const files = await eventually(() => core.files(), (f) => f[P.schuzka2] === undefined, 3000);
  assert.ok(files[`.trash/${P.schuzka2}`] === original(P.schuzka2), 'schůzka (2) moved to .trash/ with its bytes');
  assert.equal(files[P.naSchuzku], original(P.naSchuzku).replace('[[schůzka (2)]]', '[[Schůzka]]'), 'Na schůzku retargeted');
  assert.ok(files[P.schuzka]?.includes('\n## SCHŮZKA (merged)\n\nZápis B.\n'), 'the merged section');
  assert.equal((await core.backups()).filter((b) => b.kind === 'merge').length, 1, 'a zip first');
  assert.ok(!(await seen(main(page).getByText('Pages/schůzka (2).md'), 2000)) || (await eventually(async () => main(page).getByText('Pages/schůzka (2).md').count(), (n) => n === 0, 2000)) === 0, 'the group leaves the page within 2 s');
  assert.equal(await page.getByRole('status').getByRole('button', { name: 'Undo', exact: true }).count(), 0, 'no Undo (D-290, D-395)');
  await must(page.getByRole('status').filter({ hasText: 'Merged into "Schůzka"' }), 'Merged into "Schůzka"');
});
