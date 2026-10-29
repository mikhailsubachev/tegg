// Slice P (v1.0, object previews) L5: live updates of an open preview (D-935, NFR-PERF-08). docs/acceptance/previews.md
// FR-LNK-11 AC-11; contract docs/contracts/v1-previews.md §3.5 (`vault:changed`, `index_path_by_id`). External changes
// are made by the fake core (`setFile`, `renameFile`, with `vault:changed`). Written from the ACs and the contract only
// (D-61). The rename-follow fails red while `index_path_by_id` answers null (fake-core stub until P is built).
import { test, type Locator, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import {
  PV, ZONE, anyContent, clickToPreview, content, eventually, fileText, flat, isDisabled, mark, need, needOdkazyLink, needPreview, nfc, openBtn,
  previewCount, previewPath, previews, sleep, startPreviews, swap, writesSince, type FakeCoreHandle,
} from './previews-helpers';

test.use({ timezoneId: ZONE });

async function openRozpocet(page: Page, o: Parameters<typeof startPreviews>[1] = {}) {
  const core = await startPreviews(page, { at: PV.odkazy, ...o });
  const dlg = await clickToPreview(page, await needOdkazyLink(page, 'Hlavní'), 'Rozpočet 2027', 'a click on Rozpočet 2027');
  return { core, dlg };
}

/** Scrolls the body so that the block with text `text` is at the top of the body's scroller; returns false if absent. */
async function scrollBodyTo(art: Locator, text: string): Promise<boolean> {
  return art.first().evaluate((a, t) => {
    let s: HTMLElement | null = a as HTMLElement;
    while (s && !/(auto|scroll)/.test(getComputedStyle(s).overflowY)) s = s.parentElement;
    const b = [...a.querySelectorAll('p, h1, h2, h3, h4, h5, h6')].find((e) => (e.textContent ?? '').trim() === t) as HTMLElement | undefined;
    if (!s || !b) return false;
    s.scrollTop += b.getBoundingClientRect().top - s.getBoundingClientRect().top;
    return true;
  }, text);
}
/** Waits (up to `ms`) until every image in the body has loaded or failed. */
async function imagesLoaded(art: Locator, ms = 2000) {
  await eventually(() => art.first().evaluate((a) => [...a.querySelectorAll('img')].every((i) => (i as HTMLImageElement).complete)).catch(() => true), (x) => x, ms);
}
/** The first block whose bottom is below the body scroller's top, and its distance from that top (px). */
async function firstVisible(art: Locator): Promise<{ text: string; offset: number; line: number } | null> {
  return art.first().evaluate((a) => {
    let s: HTMLElement | null = a as HTMLElement;
    while (s && !/(auto|scroll)/.test(getComputedStyle(s).overflowY)) s = s.parentElement;
    const top = (s ?? a).getBoundingClientRect().top;
    const b = ([...a.querySelectorAll('p, h1, h2, h3, h4, h5, h6')] as HTMLElement[]).find((e) => e.getBoundingClientRect().bottom > top + 1);
    if (!b) return null;
    return { text: (b.textContent ?? '').trim().normalize('NFC'), offset: b.getBoundingClientRect().top - top, line: parseFloat(getComputedStyle(b).lineHeight) || 20 };
  }).catch(() => null);
}
async function noWrites(core: FakeCoreHandle, n0: number, what: string) {
  assert.deepEqual(await writesSince(core, n0), [], `${what}: none of this writes`);
}

test('fr_lnk_11_ac11_an_external_append_shows_at_the_end_and_keeps_the_scroll', async ({ page }) => {
  // The stored popover height is the minimum (200 px, FR-LNK-11 AC-4), so the body scrolls far enough to put the
  // heading at its top (in a 600 px window the default popover's body can't scroll that far).
  const { core, dlg } = await openRozpocet(page, { size: { height: 200 } });
  const n0 = await mark(core);
  const art = await need(content(dlg, 'Rozpočet 2027'), 'the body');
  assert.ok(await scrollBodyTo(art, 'Otevřené otázky'), 'the heading Otevřené otázky is in the body');
  // A lazily loaded image above the heading may load after this scroll and shift the layout: let the images load,
  // then scroll to the heading again, so the starting position is settled before the external change.
  await imagesLoaded(art);
  await scrollBodyTo(art, 'Otevřené otázky');
  await sleep(100);
  const v0 = await firstVisible(art);
  assert.equal(v0?.text, 'Otevřené otázky', `scrolled to Otevřené otázky (${JSON.stringify(v0)})`);
  await core.setFile(PV.rozpocet, (await fileText(core, PV.rozpocet))! + '\nNový odstavec.\n');
  const last = await eventually(async () => (await art.locator('p').allInnerTexts()).map(flat).pop(), (t) => t === 'Nový odstavec.', 2000);
  assert.equal(last, 'Nový odstavec.', 'another program\'s append shows at the end within 2 s');
  const v1 = await firstVisible(art);
  assert.ok(v1 && v1.text === 'Otevřené otázky' && Math.abs(v1.offset - (v0?.offset ?? 0)) <= v1.line, `Otevřené otázky stays the first visible block (± one line): ${JSON.stringify(v1)}`);
  await noWrites(core, n0, 'append');
});

test('fr_lnk_11_ac11_a_title_change_updates_the_header_and_the_dialog_name', async ({ page }) => {
  const { core } = await openRozpocet(page);
  const n0 = await mark(core);
  await core.setFile(PV.rozpocet, swap(await fileText(core, PV.rozpocet), 'title: Rozpočet 2027', 'title: Rozpočet 2028'));
  const named = await eventually(() => page.getByRole('dialog', { name: 'Preview: Rozpočet 2028', exact: true }).count(), (n) => n === 1, 2000);
  assert.equal(named, 1, 'the dialog is named Preview: Rozpočet 2028 within 2 s');
  const renamed = page.getByRole('dialog', { name: 'Preview: Rozpočet 2028', exact: true });
  assert.equal(flat(await renamed.locator('header h2').first().innerText().catch(() => '')), 'Rozpočet 2028', 'the header title');
  assert.equal(await previewCount(page), 1, 'still one popover');
  await noWrites(core, n0, 'title change');
});

test('fr_lnk_11_ac11_a_rename_with_the_same_id_follows_the_file', async ({ page }) => {
  const { core, dlg } = await openRozpocet(page);
  const n0 = await mark(core);
  await core.renameFile(PV.rozpocet, 'Pages/Rozpočet 2028.md');
  const p = await eventually(() => previewPath(previews(page)), (x) => x === nfc('Pages/Rozpočet 2028.md'), 2000);
  assert.equal(p, nfc('Pages/Rozpočet 2028.md'), 'the preview stays open on the renamed file (data-preview-path updated)');
  assert.ok(!flat(await dlg.innerText()).includes('This object was moved or deleted.'), 'not shown as gone');
  assert.equal(await isDisabled(openBtn(dlg, 'Rozpočet 2027')), false, 'Open stays enabled');
  await noWrites(core, n0, 'rename');
});

for (const how of ['trash', 'delete'] as const) {
  test(`fr_lnk_11_ac11_${how}_shows_moved_or_deleted_and_disables_open`, async ({ page }) => {
    const { core, dlg } = await openRozpocet(page);
    const n0 = await mark(core);
    if (how === 'trash') await core.renameFile(PV.rozpocet, `.trash/${PV.rozpocet}`);
    else await core.setFile(PV.rozpocet, null);
    const gone = await eventually(async () => flat(await anyContent(dlg).first().innerText().catch(() => '')), (t) => t === 'This object was moved or deleted.', 2500);
    assert.equal(gone, 'This object was moved or deleted.', `${how}: the content is replaced (preview.gone)`);
    const open = await need(dlg.getByRole('button', { name: /^Open / }), `${how}: the Open button`);
    assert.equal(await open.getAttribute('aria-disabled'), 'true', `${how}: Open is aria-disabled`);
    await sleep(800);
    assert.equal(await previewCount(page), 1, `${how}: the popover stays until Esc or a click outside`);
    await page.keyboard.press('Escape');
    assert.equal(await eventually(() => previewCount(page), (n) => n === 0, 1500), 0, `${how}: Esc closes it`);
    await noWrites(core, n0, how);
  });
}

test('fr_lnk_11_ac11_changing_jana_role_updates_her_open_preview', async ({ page }) => {
  const core = await startPreviews(page, { at: PV.odkazy });
  const dlg = await clickToPreview(page, await needOdkazyLink(page, 'Osoby', 0), 'Jana Nováková', 'Jana');
  const n0 = await mark(core);
  assert.ok(flat(await dlg.innerText()).includes('Analytička'), 'the role is shown');
  await core.setFile(PV.jana, swap(await fileText(core, PV.jana), 'role: Analytička', 'role: Vedoucí analytička'));
  const t = await eventually(async () => flat(await dlg.innerText().catch(() => '')), (x) => x.includes('Role Vedoucí analytička'), 2000);
  assert.ok(t.includes('Role Vedoucí analytička'), `the role updates within 2 s: ${t}`);
  await noWrites(core, n0, 'role change');
});


