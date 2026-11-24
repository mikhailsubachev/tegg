// Slice OC, L5: the preview strip shows the card (docs/acceptance/previews.md part four, FR-LNK-10 AC-17…AC-19; cards.md
// AP-1588, D-2068): the `Preview properties` region holds the card's pills, then its link chip, from the target's card
// list; no tags, no text, no date. On the previews fixture (AC-17, AC-19, its clock) and the cards fixture (AC-18),
// through the fake core (docs/contracts/v1-cards.md §7.4, §8.1, §13). A new file: the previews tests change in the build
// commit (D-2109). Written from the ACs and the contract only (D-61).
import { test } from '@playwright/test';
import assert from 'node:assert/strict';
import { P, cardsVault, eventually, main, must, noteRoute, sleep, startCards, swap } from './cards-helpers';
import { PV, preview, previewsVault, startPreviews, strip } from './previews-helpers';

test.use({ timezoneId: 'Europe/Prague' });

type Item = { attribute: string | null; text: string; label: string | null; icon: string | null; hidden: boolean; chip: boolean };
async function items(region: import('@playwright/test').Locator): Promise<Item[]> {
  return region.evaluate((r) => ([...r.querySelectorAll('[data-attribute], .card-more')] as HTMLElement[]).map((e) => ({
    attribute: e.getAttribute('data-attribute'), text: (e.textContent ?? '').replace(/\s+/g, ' ').trim(), label: e.getAttribute('aria-label'),
    icon: e.querySelector('svg[data-icon]')?.getAttribute('data-icon') ?? null, hidden: e.hasAttribute('hidden') || e.hasAttribute('data-overflow'), chip: e.matches('a.chip'),
  }))).catch(() => []);
}
async function openPreview(page: import('@playwright/test').Page, from: string, title: string) {
  const chip = main(page).getByRole('link', { name: new RegExp(title) }).first();
  await (await must(chip, `a reference to ${title}`, 8000)).click();
  return must(preview(page, title), `Preview: ${title}`, 3000);
}

// ------------------------------------------------------------------------------------------------ FR-LNK-10 AC-17

test('fr_lnk_10_ac17_strip_is_the_cards_pills_and_link_chip', async ({ page }) => {
  const core = await startPreviews(page, { at: PV.odkazy, mode: 'click' });
  const dlg = await openPreview(page, PV.odkazy, 'Projekt Alfa');
  const st = await must(strip(dlg), 'the region Preview properties');
  const it = await items(st);
  assert.deepEqual(it.map((i) => [i.attribute, i.chip]), [['stav', false], ['termín', false], ['vlastník', true]], 'Stav, Termín, then the chip Jana Nováková');
  assert.deepEqual(it.map((i) => i.text), ['Stav Aktivní', 'Termín Dec 31, 2026', 'Jana Nováková'], 'their texts');
  assert.ok(!(await st.innerText()).includes('#') && !(await st.locator('time').count()), 'no tags, no date');
  await page.keyboard.press('Escape');
  const r = await openPreview(page, PV.odkazy, 'Rozpočet 2027');
  assert.equal(await strip(r).count(), 0, 'Rozpočet 2027 (Page): no strip element');
  await page.keyboard.press('Escape');
  await openPreview(page, PV.odkazy, 'Projekt Alfa');
  await core.setFile(PV.projektYml, swap(previewsVault().files[PV.projektYml], 'preview: [stav, vlastník, termín, rozpočet]\n', 'preview: [stav, vlastník, termín, rozpočet]\ncard: [termín, stav]\n'));
  const after = await eventually(() => items(strip(preview(page, 'Projekt Alfa'))), (x) => x.length === 2 && x[0].attribute === 'termín', 2000);
  assert.deepEqual(after.map((i) => [i.attribute, i.chip]), [['termín', false], ['stav', false]], 'card: [termín, stav]: Termín, then Stav, no chip, within 2 s');
  assert.deepEqual(await core.writesTo(), [], 'the preview writes nothing');
});

// ------------------------------------------------------------------------------------------------ FR-LNK-10 AC-18

test('fr_lnk_10_ac18_two_rows_icons_and_names_as_on_the_card', async ({ page }) => {
  const vault = cardsVault((f) => { f['Pages/Karty.md'] = swap(f['Pages/Karty.md'], 'Před kartami.', 'Před kartami. Viz [[Sněžka z Pece]].'); });
  await startCards(page, { vault, route: noteRoute(P.karty) });
  const dlg = await openPreview(page, P.karty, 'Sněžka z Pece');
  const st = await must(strip(dlg), 'Sněžka\'s Preview properties');
  await sleep(200);
  const it = await items(st);
  const stav = it.find((i) => i.attribute === 'stav');
  assert.deepEqual([stav?.icon, stav?.label, stav?.text.includes('Stav')], ['circle-dot', 'Stav: Hotový', false], 'the stav pill: circle-dot and no visible name');
  assert.ok(it.find((i) => i.attribute === 'náročnost')?.text.startsWith('Náročnost'), 'Náročnost by name');
  const tops = await st.evaluate((r) => [...new Set(([...r.querySelectorAll('[data-attribute], .card-more')] as HTMLElement[]).filter((e) => !e.hidden).map((e) => e.offsetTop))].length);
  assert.ok(tops <= 2, `at most 2 rows (${tops})`);
  const more = it.find((i) => i.attribute === null);
  const visible = it.filter((i) => i.attribute && !i.hidden && i.attribute !== 'průvodce').length;
  assert.equal(Number(/\d+/.exec(more?.text ?? '')?.[0] ?? -1), 16 - visible, 'N = 16 − the visible items');
  assert.equal(it.at(-1)?.attribute === 'průvodce' || it.some((i) => i.attribute === 'průvodce' && i.chip), true, 'then the chip Eva Lindová');
});

// ------------------------------------------------------------------------------------------------ FR-LNK-10 AC-19

test('fr_lnk_10_ac19_tasks_images_and_pdfs', async ({ page }) => {
  await startPreviews(page, { at: PV.odkazy, mode: 'click' });
  const t = await openPreview(page, PV.odkazy, 'Zavolat Janě');
  const ti = await items(await must(strip(t), 'Zavolat Janě\'s strip'));
  assert.deepEqual(ti.map((i) => i.attribute), ['status', 'due', 'priority', 'source'], 'status, due, priority (R210, D-2132), then the source chip');
  assert.equal(ti.at(-1)?.text, 'Porada 2026-10-27', 'the source chip');
  assert.equal(await t.locator('[role="checkbox"]:not([aria-readonly="true"]), input[type="checkbox"]:not([disabled])').count(), 0, 'no control that changes the task');
  await page.keyboard.press('Escape');
  const g = await openPreview(page, PV.odkazy, 'Graf');
  assert.deepEqual((await items(await must(strip(g), 'Graf\'s strip'))).map((i) => i.text), ['Width 64', 'Height 48', 'Size 1.2 KB'], 'Graf: Width, Height, Size');
  await page.keyboard.press('Escape');
  const s = await openPreview(page, PV.odkazy, 'Smlouva');
  assert.deepEqual((await items(await must(strip(s), 'Smlouva\'s strip'))).map((i) => i.text), ['Pages 2', 'Size 844 bytes'], 'Smlouva: Pages, Size');
});
