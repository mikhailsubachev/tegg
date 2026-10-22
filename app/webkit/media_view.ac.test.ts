// MS6 slice 6A, L5 (WebKit + fake core): media in notes and the Image/PDF object pages, docs/acceptance/trash-media.md
// R76, R77, FR-ATT-01 AC-12 (figure with img at natural size, PDF link card, bare file, `Can't find`; loaded through
// the media URL only), AC-13 (double-click / ⌘-click open the object page; `Open in Preview` and `Reveal in Finder`
// call the shell), AC-14 (⌫ on the selected image block removes the paragraph only; copy/paste copies the embed text;
// no write without edits), AC-15 (backlinks of media; search; the type pages). Interface
// docs/contracts/ms6-trash-media.md §3.2 (`media` kind, `object`), §3.6 (`mediaUrl`, `__TEGG_MEDIA_BASE__`), §4
// (`media_open`, `media_reveal`), §6.1 (`EditorUi.media`), §6.2 (MediaFigure, PdfCard, MediaObjectView), §7
// (`media-ready:<path>`). Written from the ACs and the contract only (D-61). Every lookup goes through `must` (TS-I1).
import { test, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import {
  TM, callsOf, click, editorBody, eventually, figure, fixtureBytes, flat, imgNamed, main, must, mustBeOn, nfc, openTM, original, pdfCard, seen, sleep,
  startTM, tmVault, waitLoaded, caretIn, type FakeCoreHandle,
} from './trash-media-helpers';
import { gotoType, mainName } from './helpers';

test.use({ timezoneId: 'Europe/Prague' });

const PLAN = 'Plán zahrady';
async function openPlan(page: Page, o: Parameters<typeof openTM>[3] = {}): Promise<FakeCoreHandle> {
  return openTM(page, TM.plan, PLAN, o);
}
async function shellCalls(core: FakeCoreHandle, cmd: string) {
  return (await callsOf(core, cmd)).map((c) => nfc(String((c.args as any)?.path ?? '')));
}

// ------------------------------------------------------------------------------------------------ AC-12

for (const view of ['editor', 'read view'] as const) {
  test(`fr_att_01_ac12_display_in_the_${view.replace(' ', '_')}`, async ({ page }) => {
    const requests: string[] = [];
    page.on('request', (r) => requests.push(r.url()));
    await openPlan(page, { readView: view === 'read view' });
    const img = imgNamed(main(page), 'Záhon');
    await must(figure(main(page), 'Záhon'), 'figure with img alt="Záhon"', 3000);
    const s = await waitLoaded(img, 2000);
    assert.deepEqual([s.w, s.h], [64, 48], 'natural size 64 × 48');
    const box = await img.first().boundingBox();
    assert.ok(box && Math.round(box.width) === 64 && Math.round(box.height) === 48, `shown at natural size: ${JSON.stringify(box)}`);
    const origin = new URL(page.url()).origin;
    assert.ok(s.src.startsWith(`${origin}/__media/`), `loaded through the media URL (fake base for tegg-media://): ${s.src}`);
    assert.equal(decodeURIComponent(new URL(s.src).pathname.replace(/^\/__media\//, '')).normalize('NFC'), nfc(TM.png), 'the vault file');
    const card = await must(pdfCard(main(page), 'Rozpočet'), 'the PDF link card', 3000);
    assert.match(flat(await card.innerText()), /Rozpočet.*2 pages · 844 bytes/, 'title and `2 pages · 844 bytes` (§11, AP-560)');
    assert.deepEqual(requests.filter((u) => !u.startsWith(origin)), [], 'no other scheme, no network');
  });
}

test('fr_att_01_ac12_bare_file_and_missing_file', async ({ page }) => {
  const vault = tmVault((f, b) => {
    f[TM.plan] = `${f[TM.plan]}\n![[holý.png]]\n\n![[missing.png]]\n`;
    b['_attachments/holý.png'] = Buffer.from(fixtureBytes('_attachments/záhon.png')).toString('base64');
  });
  await openPlan(page, { vault });
  const imgs = main(page).locator('figure img');
  const bare = await eventually(async () => imgs.evaluateAll((es) => es.map((e) => decodeURIComponent((e as HTMLImageElement).src))), (l) => l.some((u) => u.normalize('NFC').endsWith('_attachments/holý.png')), 3000);
  assert.ok(bare.some((u) => u.normalize('NFC').endsWith('_attachments/holý.png')), 'a bare file with no object shows as an image');
  await must(main(page).getByText(`Can't find "missing.png"`, { exact: true }), 'the broken-media placeholder', 3000);
});

// ------------------------------------------------------------------------------------------------ AC-13

test('fr_att_01_ac13_double_click_and_cmd_click_open_the_object', async ({ page }) => {
  await openPlan(page);
  const img = await must(imgNamed(editorBody(page), 'Záhon'), 'the image', 3000);
  await img.click();
  await sleep(200);
  assert.equal(await mainName(page), PLAN, "a single click selects, it doesn't open (AP-538)");
  await img.dblclick();
  await mustBeOn(page, 'Záhon', 'double-click opens note/Images/Záhon.md');
  await page.keyboard.press('Meta+BracketLeft');
  await mustBeOn(page, PLAN, 'back');
  await (await must(imgNamed(editorBody(page), 'Záhon'), 'the image again', 3000)).click({ modifiers: ['Meta'] });
  await mustBeOn(page, 'Záhon', '⌘-click opens it');
  await page.keyboard.press('Meta+BracketLeft');
  await mustBeOn(page, PLAN, 'back');
  await click(pdfCard(main(page), 'Rozpočet'), 'the PDF card');
  await mustBeOn(page, 'Rozpočet', 'a click on the PDF card opens note/PDFs/Rozpočet.md');
});

test('fr_att_01_ac13_context_menu_preview_and_finder', async ({ page }) => {
  const core = await openPlan(page);
  await (await must(imgNamed(editorBody(page), 'Záhon'), 'the image', 3000)).click({ button: 'right' });
  const menu = await must(page.getByRole('menu').last(), 'the context menu');
  for (const n of ['Open', 'Open in Preview', 'Reveal in Finder']) await must(menu.getByRole('menuitem', { name: n, exact: true }), `menuitem ${n}`);
  await click(menu.getByRole('menuitem', { name: 'Open in Preview', exact: true }), 'Open in Preview');
  assert.deepEqual(await eventually(() => shellCalls(core, 'media_open'), (c) => c.length > 0, 2000), [nfc(TM.png)], 'media_open of the file');
  await (await must(imgNamed(editorBody(page), 'Záhon'), 'the image', 3000)).click({ button: 'right' });
  await click(page.getByRole('menu').last().getByRole('menuitem', { name: 'Reveal in Finder', exact: true }), 'Reveal in Finder');
  assert.deepEqual(await eventually(() => shellCalls(core, 'media_reveal'), (c) => c.length > 0, 2000), [nfc(TM.png)], 'media_reveal of the file');
  assert.deepEqual(await core.writesTo(), [], 'nothing written');
});

test('fr_att_01_ac13_a_bare_file_has_no_open', async ({ page }) => {
  const vault = tmVault((f, b) => {
    f[TM.plan] = `${f[TM.plan]}\n![[holý.png]]\n`;
    b['_attachments/holý.png'] = Buffer.from(fixtureBytes('_attachments/záhon.png')).toString('base64');
  });
  await openPlan(page, { vault });
  const bare = main(page).locator('figure img').last();
  await must(bare, 'the bare image', 3000);
  await bare.click({ button: 'right' });
  const menu = await must(page.getByRole('menu').last(), 'the context menu');
  await must(menu.getByRole('menuitem', { name: 'Reveal in Finder', exact: true }), 'Reveal in Finder');
  assert.equal(await menu.getByRole('menuitem', { name: 'Open', exact: true }).count(), 0, 'no Open (no object)');
});

test('fr_att_01_ac13_image_object_page_r76', async ({ page }) => {
  const core = await openTM(page, TM.img, 'Záhon');
  const s = await waitLoaded(imgNamed(main(page), 'Záhon'), 2000);
  assert.deepEqual([s.w, s.h], [64, 48], 'the image at its natural size');
  for (const [label, value] of [['File', 'záhon.png'], ['Media type', 'image/png'], ['Size', '1.2 KB'], ['Width', '64'], ['Height', '48']]) {
    assert.ok(await seen(main(page).getByText(value, { exact: false }), 1000), `${label}: ${value}`);
  }
  await click(main(page).getByRole('button', { name: 'Open in Preview', exact: true }), 'Open in Preview');
  await click(main(page).getByRole('button', { name: 'Reveal in Finder', exact: true }), 'Reveal in Finder');
  assert.deepEqual(await shellCalls(core, 'media_open'), [nfc(TM.png)], 'the default app for the file');
  assert.deepEqual(await shellCalls(core, 'media_reveal'), [nfc(TM.png)], 'Finder');
});

test('fr_att_01_ac13_pdf_object_page_r76', async ({ page }) => {
  await openTM(page, TM.pdfObj, 'Rozpočet');
  await must(pdfCard(main(page), 'Rozpočet'), 'a link card instead of the image', 3000);
  await must(main(page).getByRole('button', { name: 'Open in Preview', exact: true }), 'Open in Preview');
  await must(main(page).getByRole('button', { name: 'Reveal in Finder', exact: true }), 'Reveal in Finder');
});

// ------------------------------------------------------------------------------------------------ AC-14

test('fr_att_01_ac14_backspace_on_the_selected_image_removes_the_paragraph_only', async ({ page }) => {
  const core = await openPlan(page);
  await (await must(imgNamed(editorBody(page), 'Záhon'), 'the image', 3000)).click();
  await page.keyboard.press('Backspace');
  const t = await eventually(async () => (await core.files())[nfc(TM.plan)], (x) => !!x && !x.includes('![[záhon.png]]'), 3000);
  assert.equal(t?.replace(/^modified: .*$/m, ''), original(TM.plan).replace('![[záhon.png]]\n\n', '').replace(/^modified: .*$/m, ''), 'only the paragraph');
  assert.equal((await core.files())[nfc(TM.img)], original(TM.img), 'the object stays (D-27 rule)');
  assert.ok((await core.binary())[nfc(TM.png)], 'the file stays');
  assert.equal((await callsOf(core, 'object_trash')).length, 0, 'nothing trashed');
});

test('fr_att_01_ac14_copy_paste_duplicates_the_embed_text', async ({ page }) => {
  const core = await openPlan(page);
  await (await must(imgNamed(editorBody(page), 'Záhon'), 'the image', 3000)).click();
  const copied = await page.evaluate(() => {
    const dt = new DataTransfer();
    (document.activeElement as HTMLElement | null ?? document.body).dispatchEvent(new ClipboardEvent('copy', { clipboardData: dt, bubbles: true, cancelable: true }));
    return dt.getData('text/plain');
  });
  assert.equal(copied, '![[záhon.png]]', 'the embed text');
  // Put the caret at the end of the text (the last paragraph holds the inline PDF card, which opens on a click; D-628).
  await caretIn(page, await editorBody(page).locator(':scope > *').count());
  await page.keyboard.press('Enter');
  await page.evaluate((txt) => {
    const dt = new DataTransfer();
    dt.setData('text/plain', txt);
    (document.activeElement as HTMLElement | null ?? document.body).dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  }, copied);
  const t = await eventually(async () => (await core.files())[nfc(TM.plan)], (x) => !!x && x.split('![[záhon.png]]').length === 3, 3000);
  assert.equal(t?.split('![[záhon.png]]').length, 3, 'the embed text twice');
  assert.equal((await callsOf(core, 'media_add')).length + (await callsOf(core, 'media_add_paths')).length, 0, 'no new file');
});

test('fr_att_01_ac14_no_write_without_edits', async ({ page }) => {
  const core = await openPlan(page);
  const s = await waitLoaded(imgNamed(editorBody(page), 'Záhon'), 2000);
  assert.equal(s.w, 64, 'the image shows');
  await sleep(1500);
  await page.keyboard.press('Meta+s');
  await sleep(500);
  assert.deepEqual(await core.writesTo(), [], 'the round trip of Plán with no edits writes nothing (FR-FMT-07)');
});

// ------------------------------------------------------------------------------------------------ AC-15

test('fr_att_01_ac15_backlinks_search_and_type_pages', async ({ page }) => {
  await startTM(page, { at: TM.img, panel: true });
  await mustBeOn(page, 'Záhon', 'on Img', 5000);
  await must(figure(main(page), 'Záhon').or(imgNamed(main(page), 'Záhon')), "Img's page shows its image (R76)", 3000);
  const panel = page.getByRole('complementary', { name: 'Context panel' });
  assert.ok(await seen(panel.getByText(PLAN, { exact: true }), 3000), "Img's backlinks list Plán (it embeds the file, FR-ATT-07)");
  await gotoType(page, 'Images');
  assert.ok(await seen(main(page).getByRole('row').filter({ hasText: 'Záhon' }), 2000), 'Images lists Záhon');
  await gotoType(page, 'PDFs');
  assert.ok(await seen(main(page).getByRole('row').filter({ hasText: 'Rozpočet' }), 2000), 'PDFs lists Rozpočet');
  await page.keyboard.press('Meta+Shift+f');
  // Wait for the Search page's field before typing (D-628).
  const input = await must(page.getByRole('searchbox').or(page.getByRole('textbox', { name: 'Search query' })).first(), 'the search field', 3000);
  await input.fill('Záhon');
  await page.keyboard.press('Enter');
  assert.ok(await seen(main(page).getByText('Záhon', { exact: true }), 3000), 'search finds Záhon');
});
