// MS6 slice 6A, L5 (WebKit + fake core): adding images and PDFs in a note, docs/acceptance/trash-media.md R72, R73,
// FR-ATT-01 AC-1 (paste a screenshot: file, object, note in that order; the image within 1 s; image wins over text),
// AC-2 (drop files in drop order; a folder or an unsupported file is refused), AC-3 (slash Image/PDF, palette, ⇧⌘A open
// the picker; Cancel changes nothing), AC-4 (names and titles; ` (2)` in the same second; the next free number; (TZ)),
// AC-6 (refused content), AC-7 (a failed object write removes the file; Try again; a failed note write keeps the
// pair), AC-8 (⌘Z removes the paragraph only, ⇧⌘Z puts it back), AC-9 (the attachments folder setting). Interface
// docs/contracts/ms6-trash-media.md §3.3…§3.5 (names, bytes), §4 (`media_add` raw body with `x-tegg-*` headers,
// `media_add_paths`, `media_pick`), §6.1 (`EditorUi.onFiles`, `insertEmbeds`), §6.2 (`addMedia`), §8, §9.2 (fake core
// `dropFiles`, `paste`, `FakeOptions.files`, `pick`). Written from the ACs and the contract only (D-61). Every lookup
// goes through `must` (TS-I1).
import { test, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import {
  NOW_IN, PASTED, TM, alertWith, block, callsOf, caretIn, click, editorBody, eventually, fixtureBytes, imgNamed, must, nfc, openTM, original,
  runCommand, sample, seen, sleep, tmVault, waitLoaded, type FakeCoreHandle,
} from './trash-media-helpers';

test.use({ timezoneId: 'Europe/Prague' });

const PLAN = 'Plán zahrady';
const PNG = () => fixtureBytes('_attachments/záhon.png');
const PDF = () => fixtureBytes('_attachments/Rozpočet.pdf');
const DESK = '/Users/tester/Plocha';
const OUTSIDE = () => ({
  [`${DESK}/Záhon 2.PNG`]: PNG(),
  [`${DESK}/Rozpočet 2026.pdf`]: PDF(),
  [`${DESK}/image.png`]: PNG(),
  [`${DESK}/IMG_1234.HEIC`]: sample('header.heic'),
  [`${DESK}/text.png`]: sample('text.png'),
  [`${DESK}/empty.png`]: sample('empty.png'),
  [`${DESK}/zprava.docx`]: sample('zprava.docx'),
  [`${DESK}/Složka/fotka.png`]: PNG(),
});
const ID_LINE = /^id: ([0-9A-HJKMNP-TV-Z]{26})$/m;
const masked = (t: string | undefined) => (t ?? '').replace(ID_LINE, 'id: <ULID>');
/** §3.5 bytes of an Image object (R72's key order). */
function imageObject(o: { title: string; now: string; file: string; size: number; w: number; h: number; source?: string }): string {
  return `---\nid: <ULID>\ntype: image\ntitle: ${o.title}\ncreated: ${o.now}\nmodified: ${o.now}\nfile: "[[${o.file}]]"\nmedia-type: image/png\nsize: ${o.size}\nwidth: ${o.w}\nheight: ${o.h}\n${o.source ? `source: "[[${o.source}]]"\n` : ''}---\n`;
}
const planBody = () => original(TM.plan);
async function openPlan(page: Page, o: Parameters<typeof openTM>[3] = {}): Promise<FakeCoreHandle> {
  const core = await openTM(page, TM.plan, PLAN, { files: OUTSIDE(), ...o });
  await must(editorBody(page), 'the editor', 5000);
  return core;
}
async function planText(core: FakeCoreHandle, ok: (t: string | undefined) => boolean, ms = 3000) {
  return eventually(async () => (await core.files())[nfc(TM.plan)], ok, ms);
}
async function dropOn(page: Page, core: FakeCoreHandle, n: number, paths: string[]) {
  const b = await (await must(block(page, n), `block ${n}`)).boundingBox();
  assert.ok(b, `block ${n} has a box`);
  await core.dropFiles(paths, { x: Math.round(b!.x + b!.width / 2), y: Math.round(b!.y + b!.height / 2) });
}

// ------------------------------------------------------------------------------------------------ AC-1

test('fr_att_01_ac1_paste_a_screenshot', async ({ page }) => {
  const core = await openPlan(page);
  await caretIn(page, 1, 'Záhon u plotu.');
  await core.paste(page, { files: [{ name: 'image.png', type: 'image/png', bytes: PNG() }] });
  const want = planBody().replace('Záhon u plotu.\n\n', `Záhon u plotu.\n\n![[${PASTED}]]\n\n`);
  const text = await planText(core, (t) => t !== undefined && t.includes(PASTED), 3000);
  assert.equal(text?.replace(/^modified: .*$/m, 'modified: <x>'), want.replace(/^modified: .*$/m, 'modified: <x>'), 'Plán gets the new paragraph after the caret\'s block');
  assert.deepEqual(await core.writesTo(), [`_attachments/${PASTED}`, 'Images/Plán zahrady 1.md', nfc(TM.plan)], 'file, object, note, in this order');
  const bin = await core.binary();
  assert.deepEqual([...bin[`_attachments/${PASTED}`] ?? []], [...PNG()], 'the clipboard bytes, unchanged');
  assert.equal(masked((await core.files())['Images/Plán zahrady 1.md']), imageObject({ title: 'Plán zahrady 1', now: NOW_IN['Europe/Prague'], file: PASTED, size: 1234, w: 64, h: 48, source: PLAN }), 'R72 object');
  assert.equal((await callsOf(core, 'note_write')).length, 1, 'one autosave');
  const size = await waitLoaded(imgNamed(editorBody(page), 'Plán zahrady 1'), 1000);
  assert.deepEqual([size.w, size.h], [64, 48], 'the image shows within 1 s');
});

test('fr_att_01_ac1_the_image_wins_over_text', async ({ page }) => {
  const core = await openPlan(page);
  await caretIn(page, 1, 'Záhon u plotu.');
  await core.paste(page, { files: [{ name: 'image.png', type: 'image/png', bytes: PNG() }], text: 'Jen text ze schránky' });
  const text = await planText(core, (t) => t !== undefined && t.includes(PASTED), 3000);
  assert.ok(text?.includes(`![[${PASTED}]]`), 'the image is added (D-186 changed)');
  assert.ok(!text?.includes('Jen text ze schránky'), 'the text is not pasted');
  assert.equal(await page.getByRole('status').filter({ hasText: /MS6/ }).count(), 0, 'the MS6 notice is retired');
});

// ------------------------------------------------------------------------------------------------ AC-2

test('fr_att_01_ac2_drop_files_in_drop_order', async ({ page }) => {
  const core = await openPlan(page);
  await dropOn(page, core, 1, [`${DESK}/Záhon 2.PNG`, `${DESK}/Rozpočet 2026.pdf`]);
  const calls = await eventually(() => callsOf(core, 'media_add_paths'), (c) => c.length > 0, 2000);
  assert.deepEqual(((calls[0]?.args as any)?.paths ?? []).map(nfc), [`${DESK}/Záhon 2.PNG`, `${DESK}/Rozpočet 2026.pdf`], 'media_add_paths in drop order');
  const text = await planText(core, (t) => !!t && t.includes('![[Rozpočet 2026.pdf]]'), 3000);
  assert.ok(text?.includes('![[Záhon 2.PNG]]\n\n![[Rozpočet 2026.pdf]]'), 'two paragraphs at the drop point, in drop order');
  assert.equal(text?.replace('![[Záhon 2.PNG]]\n\n![[Rozpočet 2026.pdf]]\n\n', '').replace(/^modified: .*$/m, ''), planBody().replace(/^modified: .*$/m, ''), 'nothing else changes');
  const files = await core.files();
  assert.ok(files['Images/Záhon 2.md']?.includes('title: Záhon 2'), 'Images/Záhon 2.md (R72)');
  assert.ok(files['PDFs/Rozpočet 2026.md']?.includes('title: Rozpočet 2026'), 'PDFs/Rozpočet 2026.md');
  assert.ok(files['PDFs/Rozpočet 2026.md']?.includes('pages: 2'), 'pages: 2');
  const bin = await core.binary();
  assert.deepEqual([...bin['_attachments/Záhon 2.PNG'] ?? []], [...PNG()], 'the bytes copied, name kept');
  assert.ok(bin['_attachments/Rozpočet 2026.pdf'], 'the PDF copied');
});

test('fr_att_01_ac2_a_folder_or_unsupported_file_adds_nothing', async ({ page }) => {
  const core = await openPlan(page);
  await dropOn(page, core, 1, [`${DESK}/Složka`, `${DESK}/zprava.docx`]);
  await must(alertWith(page, `"Složka" isn't an image or PDF Tegg can add.`), 'media.refused for the folder', 3000);
  await must(alertWith(page, `"zprava.docx" isn't an image or PDF Tegg can add.`), 'media.refused for the .docx', 3000);
  await sleep(1500);
  assert.equal((await core.files())[nfc(TM.plan)], planBody(), 'Plán unchanged');
  assert.deepEqual(await core.writesTo(), [], 'nothing written');
});

// ------------------------------------------------------------------------------------------------ AC-3

test('fr_att_01_ac3_slash_image_opens_the_picker', async ({ page }) => {
  const core = await openPlan(page, { pick: [`${DESK}/Záhon 2.PNG`] });
  await caretIn(page, 1, 'Záhon u plotu.');
  await page.keyboard.press('Enter');
  await page.keyboard.type('/Image');
  await sleep(200);
  const menu = await must(page.getByRole('listbox', { name: 'Insert block', exact: true }), 'the slash menu');
  await click(menu.getByRole('option', { name: /^Image/ }).first(), 'option Image');
  assert.equal((await eventually(() => callsOf(core, 'media_pick'), (c) => c.length > 0, 2000)).length, 1, 'the system file dialog');
  const text = await planText(core, (t) => !!t && t.includes('![[Záhon 2.PNG]]'), 3000);
  assert.ok(text?.includes('Záhon u plotu.\n\n![[Záhon 2.PNG]]'), 'added at the caret');
});

test('fr_att_01_ac3_palette_and_shortcut_and_cancel', async ({ page }) => {
  const core = await openPlan(page, { pick: [] });
  await caretIn(page, 1, 'Záhon u plotu.');
  await page.keyboard.press('Meta+Shift+a');
  assert.equal((await eventually(() => callsOf(core, 'media_pick'), (c) => c.length > 0, 2000)).length, 1, '⇧⌘A opens the picker');
  await caretIn(page, 1, 'Záhon u plotu.');
  await runCommand(page, 'Add image or PDF…');
  assert.equal((await eventually(() => callsOf(core, 'media_pick'), (c) => c.length > 1, 2000)).length, 2, 'the palette command opens it');
  await sleep(1500);
  assert.deepEqual(await core.writesTo(), [], 'Cancel changes nothing');
});

test('fr_att_01_ac3_slash_pdf_offers_pdfs', async ({ page }) => {
  const core = await openPlan(page, { pick: [`${DESK}/Rozpočet 2026.pdf`] });
  await caretIn(page, 1, 'Záhon u plotu.');
  await page.keyboard.press('Enter');
  await page.keyboard.type('/PDF');
  await sleep(200);
  await click(page.getByRole('listbox', { name: 'Insert block', exact: true }).getByRole('option', { name: /^PDF/ }).first(), 'option PDF');
  const picks = await eventually(() => callsOf(core, 'media_pick'), (c) => c.length > 0, 2000);
  assert.equal((picks[0]?.args as any)?.kind, 'pdf', 'the dialog filtered to PDFs');
  assert.ok((await planText(core, (t) => !!t && t.includes('![[Rozpočet 2026.pdf]]'), 3000))?.includes('![[Rozpočet 2026.pdf]]'), 'added');
});

// ------------------------------------------------------------------------------------------------ AC-4 (TZ)

for (const [tz, stamp] of [['Europe/Prague', '20261022100000'], ['America/Los_Angeles', '20261022010000']] as const) {
  test.describe(`names in ${tz}`, () => {
    test.use({ timezoneId: tz });
    test(`fr_att_01_ac4_pasted_names_and_titles_${tz.replace(/\W/g, '_')}`, async ({ page }) => {
      const core = await openPlan(page);
      await caretIn(page, 1, 'Záhon u plotu.');
      await core.paste(page, { files: [{ name: 'image.png', type: 'image/png', bytes: PNG() }] });
      await eventually(() => core.writesTo(), (w) => w.length >= 2, 3000);
      await caretIn(page, 1, 'Záhon u plotu.');
      await core.paste(page, { files: [{ name: 'image.png', type: 'image/png', bytes: PNG() }] });
      const w = await eventually(() => core.writesTo(), (x) => x.filter((p) => !p.startsWith('Pages/')).length >= 4, 3000);
      assert.deepEqual(w.filter((p) => !p.startsWith('Pages/')), [
        `_attachments/Pasted image ${stamp}.png`, 'Images/Plán zahrady 1.md', `_attachments/Pasted image ${stamp} (2).png`, 'Images/Plán zahrady 2.md',
      ], `local time ${stamp}; the same second gets ` + '` (2)`; the next free number');
    });
  });
}

test('fr_att_01_ac4_generic_and_kept_names', async ({ page }) => {
  const core = await openPlan(page);
  await dropOn(page, core, 1, [`${DESK}/image.png`, `${DESK}/IMG_1234.HEIC`, `${DESK}/Záhon 2.PNG`]);
  const w = await eventually(() => core.writesTo(), (x) => x.filter((p) => !p.startsWith('Pages/')).length >= 6, 3000);
  assert.deepEqual(w.filter((p) => !p.startsWith('Pages/')), [
    '_attachments/image.png', 'Images/Plán zahrady 1.md', '_attachments/IMG_1234.HEIC', 'Images/Plán zahrady 2.md', '_attachments/Záhon 2.PNG', 'Images/Záhon 2.md',
  ], 'generic names (R73) give `<note title> <n>`; others keep their stem');
  const files = await core.files();
  assert.ok(files['Images/Plán zahrady 2.md']?.includes('media-type: image/heic'), 'HEIC stored as-is (AP-533)');
});

// ------------------------------------------------------------------------------------------------ AC-6

test('fr_att_01_ac6_refused_content', async ({ page }) => {
  const core = await openPlan(page);
  await dropOn(page, core, 1, [`${DESK}/text.png`, `${DESK}/empty.png`, `${DESK}/Záhon 2.PNG`]);
  await must(alertWith(page, `"text.png" isn't an image or PDF Tegg can add.`), 'a .png that is text is refused', 3000);
  await must(alertWith(page, `"empty.png" isn't an image or PDF Tegg can add.`), 'a 0-byte file is refused', 3000);
  const w = await eventually(() => core.writesTo(), (x) => x.length >= 3, 3000);
  assert.ok(!w.some((p) => /text\.png|empty\.png/.test(p)), 'nothing written for the refused files');
});

// ------------------------------------------------------------------------------------------------ AC-7

test('fr_att_01_ac7_a_failed_object_write_leaves_nothing', async ({ page }) => {
  const core = await openPlan(page);
  await core.writeControl({ fail: 'Io', path: 'Images/Záhon 2.md' });
  await dropOn(page, core, 1, [`${DESK}/Záhon 2.PNG`]);
  const alert = await must(alertWith(page, `Couldn't add "Záhon 2.PNG". Try again.`), 'media.failed', 3000);
  assert.equal((await core.binary())['_attachments/Záhon 2.PNG'], undefined, 'the file written first is removed again');
  assert.equal((await core.files())[nfc(TM.plan)], planBody(), 'the note is not changed');
  await click(alert.getByRole('button', { name: 'Try again', exact: true }), 'Try again');
  assert.ok((await planText(core, (t) => !!t && t.includes('![[Záhon 2.PNG]]'), 3000))?.includes('![[Záhon 2.PNG]]'), 'Try again adds it');
});

test('fr_att_01_ac7_a_failed_note_write_keeps_the_pair', async ({ page }) => {
  const core = await openPlan(page);
  await core.writeControl({ fail: 'Io', path: TM.plan });
  await dropOn(page, core, 1, [`${DESK}/Záhon 2.PNG`]);
  await eventually(() => core.writesTo(), (w) => w.length >= 2, 3000);
  assert.ok(await seen(page.getByRole('alert'), 4000), "the note's autosave alert");
  assert.ok((await core.binary())['_attachments/Záhon 2.PNG'], 'the file stays');
  assert.ok((await core.files())['Images/Záhon 2.md'], 'the object stays (valid on its own)');
});

// ------------------------------------------------------------------------------------------------ AC-8

test('fr_att_01_ac8_undo_removes_the_paragraph_only', async ({ page }) => {
  const core = await openPlan(page);
  await caretIn(page, 1, 'Záhon u plotu.');
  await core.paste(page, { files: [{ name: 'image.png', type: 'image/png', bytes: PNG() }] });
  await planText(core, (t) => !!t && t.includes(PASTED), 3000);
  await page.keyboard.press('Meta+z');
  const back = await planText(core, (t) => !!t && !t.includes(PASTED), 3000);
  assert.equal(back?.replace(/^modified: .*$/m, ''), planBody().replace(/^modified: .*$/m, ''), '⌘Z removes the embed paragraph only');
  assert.ok((await core.binary())[`_attachments/${PASTED}`], 'the file stays');
  assert.ok((await core.files())['Images/Plán zahrady 1.md'], 'the object stays (FR-ATT-04)');
  await page.keyboard.press('Meta+Shift+z');
  assert.ok((await planText(core, (t) => !!t && t.includes(PASTED), 3000))?.includes(`![[${PASTED}]]`), '⇧⌘Z puts it back');
});

// ------------------------------------------------------------------------------------------------ AC-9

test('fr_att_01_ac9_the_attachments_folder_setting', async ({ page }) => {
  const vault = tmVault((f) => { f['.tegg/vault.yml'] = f['.tegg/vault.yml'].replace('attachments: _attachments', 'attachments: Přílohy'); });
  const core = await openPlan(page, { vault });
  await caretIn(page, 1, 'Záhon u plotu.');
  await core.paste(page, { files: [{ name: 'image.png', type: 'image/png', bytes: PNG() }] });
  const w = await eventually(() => core.writesTo(), (x) => x.length >= 2, 3000);
  assert.equal(w[0], `Přílohy/${PASTED}`, 'new files go to Přílohy/');
  assert.ok((await core.binary())[nfc(TM.png)], 'existing files are not moved');
  assert.ok((await planText(core, (t) => !!t && t.includes(PASTED), 3000))?.includes(`![[${PASTED}]]`), 'the embed names the file');
});
