// MS6 slice 6A, L5 (WebKit + fake core in capture mode): images and PDFs in the capture window,
// docs/acceptance/trash-media.md FR-ATT-01 AC-11 and capture.md FR-CAP-01 AC-12 ([MS6], the 6A part): the drop zone
// `Add an image or PDF` is enabled; dropping, pasting or clicking it (the picker) stages the files as thumbnails with
// `Remove`; saving writes the pairs (R72's capture row) and then the captured note with one `![[…]]` paragraph per file
// after its text; cancelling writes nothing; the capture window uses only `capture_media_add` (never a vault read,
// NFR-SEC-03, D-553). Interface docs/contracts/ms6-trash-media.md §5 (`capture_media_add`: raw body with `x-tegg-name`,
// `{ paths }`, `{ pick: true }`; `capture_create` `media` tokens; staging URLs), §9.2. Written from the ACs and the
// contracts only (D-61). Every lookup goes through `must` (TS-I1).
import { test, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import {
  callsOf, capText, click, creates, description, dropZone, eventually, isDisabled, must, saveBtn, seen, sleep, startCapture, typeInCapture,
  type FakeCoreHandle,
} from './capture-helpers';
import { NOW, PASTED, fixtureBytes, sample, tmVault } from './trash-media-helpers';

test.use({ timezoneId: 'Europe/Prague' });

const DESK = '/Users/tester/Plocha';
const PNG = () => fixtureBytes('_attachments/záhon.png');
const OUTSIDE = () => ({ [`${DESK}/Záhon 2.PNG`]: PNG(), [`${DESK}/Rozpočet 2026.pdf`]: fixtureBytes('_attachments/Rozpočet.pdf'), [`${DESK}/zprava.docx`]: sample('zprava.docx') });
/** The capture commands of ms5-capture §2.2 plus 6A's `capture_media_add`; nothing else may be called. */
const CAPTURE_CMDS = new Set([
  'capture_context', 'capture_create', 'capture_ready', 'capture_hide', 'capture_resize', 'capture_open_main', 'capture_draft_get', 'capture_draft_set',
  'capture_saved_show', 'capture_suggest', 'capture_media_add',
]);
const thumbs = (page: Page) => page.locator('img').filter({ hasNot: page.locator('svg') });
const removeBtns = (page: Page) => page.getByRole('button', { name: /^Remove(?! #)/ });

async function open(page: Page, o: { pick?: string[] } = {}): Promise<FakeCoreHandle> {
  return startCapture(page, { vault: tmVault(), now: NOW, files: OUTSIDE(), pick: o.pick ?? [] });
}
async function otherCalls(core: FakeCoreHandle) {
  return (await core.calls()).map((c) => c.cmd).filter((c) => !c.startsWith('plugin:event|') && !CAPTURE_CMDS.has(c));
}

test('fr_att_01_ac11_the_drop_zone_is_enabled_and_opens_the_picker', async ({ page }) => {
  const core = await open(page, { pick: [`${DESK}/Záhon 2.PNG`] });
  const zone = await must(dropZone(page), 'button "Add an image or PDF"');
  assert.equal(await isDisabled(zone), false, 'enabled (FR-CAP-01 AC-12, D-624)');
  assert.ok(!(await description(zone)).includes('Coming in'), 'no Coming in MS6');
  await click(zone, 'the drop zone');
  const staged = await eventually(() => callsOf(core, 'capture_media_add'), (c) => c.length > 0, 2000);
  assert.deepEqual(staged[0]?.args, { pick: true }, 'the shell opens the dialog (the capture window has no media_pick)');
  await must(removeBtns(page), 'a thumbnail with Remove', 3000);
  assert.ok(await seen(thumbs(page), 2000), 'the thumbnail image');
  assert.deepEqual(await otherCalls(core), [], 'only capture commands');
});

test('fr_cap_01_ac12_a_pasted_image_is_saved_with_the_capture', async ({ page }) => {
  const core = await open(page);
  await typeInCapture(page, 'Semínka na jaro');
  await (await must(capText(page), 'Capture text')).focus();
  await core.paste(page, { files: [{ name: 'image.png', type: 'image/png', bytes: PNG() }] });
  await must(removeBtns(page), 'the pasted image is staged as a thumbnail', 3000);
  assert.deepEqual(await core.writesTo(), [], 'staging writes nothing');
  await page.keyboard.press('Meta+Enter');
  const w = await eventually(() => core.writesTo(), (x) => x.length >= 3, 3000);
  assert.deepEqual(w, [`_attachments/${PASTED}`, 'Images/Semínka na jaro 1.md', 'Quick Notes/Semínka na jaro.md'], 'the pair first, then the note (R72 capture row)');
  const note = (await core.files())['Quick Notes/Semínka na jaro.md'] ?? '';
  assert.ok(note.endsWith(`\n![[${PASTED}]]\n`), `the capture's body ends with the embed: ${JSON.stringify(note.slice(-80))}`);
  const obj = (await core.files())['Images/Semínka na jaro 1.md'] ?? '';
  assert.ok(obj.includes('source: "[[Semínka na jaro]]"'), 'the object\'s source is the captured note');
  assert.equal((await creates(core)).length, 1, 'one capture');
  assert.deepEqual(await otherCalls(core), [], 'only capture commands (NFR-SEC-03)');
});

test('fr_att_01_ac11_drop_two_files_and_remove_one', async ({ page }) => {
  const core = await open(page);
  await typeInCapture(page, 'Výkres a rozpočet');
  await core.dropFiles([`${DESK}/Záhon 2.PNG`, `${DESK}/Rozpočet 2026.pdf`], { x: 200, y: 120 });
  assert.equal(await eventually(() => removeBtns(page).count(), (n) => n === 2, 3000), 2, 'two thumbnails');
  await click(removeBtns(page).last(), 'Remove the PDF');
  assert.equal(await eventually(() => removeBtns(page).count(), (n) => n === 1, 2000), 1, 'one left');
  await click(saveBtn(page), 'Save capture');
  const w = await eventually(() => core.writesTo(), (x) => x.length >= 3, 3000);
  assert.deepEqual(w, ['_attachments/Záhon 2.PNG', 'Images/Záhon 2.md', 'Quick Notes/Výkres a rozpočet.md'], 'only the kept file');
  const c = (await creates(core))[0] as any;
  assert.equal((c?.media ?? []).length, 1, 'capture_create gets one token');
});

test('fr_att_01_ac11_untitled_capture_names_and_refused_files', async ({ page }) => {
  const core = await open(page);
  await core.dropFiles([`${DESK}/zprava.docx`], { x: 200, y: 120 });
  assert.ok(await seen(page.getByText(`"zprava.docx" isn't an image or PDF Tegg can add.`), 3000), 'media.refused');
  await core.dropFiles([`${DESK}/Záhon 2.PNG`], { x: 200, y: 120 });
  await must(removeBtns(page), 'staged', 3000);
  await (await must(capText(page), 'Capture text')).focus();
  await core.paste(page, { files: [{ name: 'image.png', type: 'image/png', bytes: PNG() }] });
  assert.equal(await eventually(() => removeBtns(page).count(), (n) => n === 2, 3000), 2, 'two staged');
  await page.keyboard.press('Meta+Enter');
  const w = await eventually(() => core.writesTo(), (x) => x.length >= 5, 3000);
  assert.deepEqual(w.slice(0, 4), ['_attachments/Záhon 2.PNG', 'Images/Záhon 2.md', `_attachments/${PASTED}`, 'Images/Capture 2026-10-22 1.md'], 'without a title: `Capture <date> 1` for a pasted image');
});

test('fr_att_01_ac11_cancel_writes_nothing', async ({ page }) => {
  const core = await open(page);
  await typeInCapture(page, 'Nic');
  await core.dropFiles([`${DESK}/Záhon 2.PNG`], { x: 200, y: 120 });
  await must(removeBtns(page), 'staged', 3000);
  await page.keyboard.press('Escape');
  await sleep(500);
  assert.deepEqual(await core.writesTo(), [], 'nothing written');
  assert.deepEqual(await core.binary().then((b) => Object.keys(b).filter((k) => k.includes('Záhon 2'))), [], 'no file');
});
