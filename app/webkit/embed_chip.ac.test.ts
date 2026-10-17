// MS4 slice 4A, L5 (WebKit + fake core): the Create offer from a broken note embed's placeholder chip (D-310, AP-238).
// FR-LNK-04 AC-6 (`![[Chybí]]` -> `Chybí`), AC-12 (the offer writes nothing); read-view FR-EDT-02 AC-13 (R5 `embed-note`
// shows its target as a link chip); editor FR-EDT-02 AC-16 (the editor shows R5 placeholders as the read view does).
// Written from the ACs and docs/contracts/ms4-links.md only (D-61); every lookup goes through `must`/node:assert (TS-I1).
import { test, type Locator, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import { B, createOffer, editorBody, eventually, fileText, flat, focus, main, must, nfc, openLinks, seen, sleep, writeCalls, type FakeCoreHandle } from './links-helpers';
import { absent } from './helpers';

test.use({ timezoneId: 'Europe/Prague' });

const TARGET = nfc('Chybí');
const FILE = nfc('Quick Notes/Chybí.md');

/** The `embed-note` placeholder region for `![[Chybí]]` inside `scope` (R5). */
async function placeholder(scope: Locator): Promise<Locator> {
  const ph = scope.locator('[data-placeholder="embed-note"]').filter({ hasText: TARGET });
  return must(ph.first(), 'embed-note placeholder of ![[Chybí]]', 5000);
}
/** The unresolved link chip `Chybí` inside the placeholder (D-310). */
async function embedChip(scope: Locator): Promise<Locator> {
  const ph = await placeholder(scope);
  const c = ph.locator('[data-link-kind="unresolved"]').filter({ hasText: new RegExp(`^\\s*${TARGET}\\s*$`) });
  return must(c.first(), 'unresolved chip "Chybí" inside the embed-note placeholder', 5000);
}
async function offerFrom(page: Page, scope: Locator): Promise<Locator> {
  await (await embedChip(scope)).click();
  return must(createOffer(page), 'dialog "Create note" from the embed chip', 3000);
}
async function readPage(page: Page): Promise<{ core: FakeCoreHandle; scope: Locator }> {
  const core = await openLinks(page, B.rozbite, { readView: true });
  return { core, scope: main(page) };
}

// ------------------------------------------------------------------------------------------------ editor

test('fr_lnk_04_ac6_editor_embed_placeholder_chip_creates_chybi_chip_exists', async ({ page }) => {
  await openLinks(page, B.rozbite);
  const c = await embedChip(editorBody(page));
  assert.equal(await c.getAttribute('data-link-kind'), 'unresolved');
  assert.equal(flat(await c.innerText()), TARGET);
});

test('fr_lnk_04_ac6_editor_embed_placeholder_chip_creates_chybi_offer_title', async ({ page }) => {
  const core = await openLinks(page, B.rozbite);
  const offer = await offerFrom(page, editorBody(page));
  assert.ok(await seen(offer.getByText(`No note named "${TARGET}"`, { exact: true }), 1000), 'No note named "Chybí"');
  assert.ok(await seen(offer.getByText('Type: Quick Note', { exact: true }), 1000), 'Type: Quick Note');
  await must(offer.getByRole('button', { name: `Create "${TARGET}"`, exact: true }), 'button Create "Chybí"');
  assert.deepEqual(await writeCalls(core), [], 'opening the offer writes nothing');
});

test('fr_lnk_04_ac6_editor_embed_placeholder_chip_creates_chybi_writes_one_file', async ({ page }) => {
  const core = await openLinks(page, B.rozbite);
  const before = await core.files();
  const offer = await offerFrom(page, editorBody(page));
  await (await must(offer.getByRole('button', { name: `Create "${TARGET}"`, exact: true }), 'Create "Chybí"')).click();
  assert.deepEqual(await eventually(() => core.writesTo(), (w) => w.length > 0, 3000), [FILE], 'exactly Quick Notes/Chybí.md');
  assert.equal((await writeCalls(core)).length, 1, 'one write command');
  const t = (await fileText(core, FILE)) ?? '';
  assert.match(t, /^type: quick-note$/m);
  assert.match(t, new RegExp(`^title: ${TARGET}$`, 'm'), 'title: Chybí');
  assert.equal((await core.files())[nfc(B.rozbite)], before[nfc(B.rozbite)], 'Rozbité odkazy keeps its bytes');
});

test('fr_lnk_04_ac12_editor_embed_placeholder_chip_esc_writes_nothing', async ({ page }) => {
  const core = await openLinks(page, B.rozbite);
  const before = JSON.stringify(await core.files());
  await offerFrom(page, editorBody(page));
  await page.keyboard.press('Escape');
  assert.ok(await absent(createOffer(page), 1000), 'Esc closes the offer');
  assert.equal(flat((await focus(page)).name), TARGET, 'focus back on the chip');
  const offer = await offerFrom(page, editorBody(page));
  await (await must(offer.getByRole('button', { name: 'Cancel', exact: true }), 'Cancel')).click();
  assert.ok(await absent(createOffer(page), 1000), 'Cancel closes the offer');
  await sleep(300);
  assert.deepEqual(await writeCalls(core), [], 'no write command');
  assert.deepEqual(await core.writesTo(), [], 'no file written');
  assert.equal(JSON.stringify(await core.files()), before, 'vault unchanged');
});

// ------------------------------------------------------------------------------------------------ read view (regression guard)

test('fr_lnk_04_ac6_read_view_embed_placeholder_chip_creates_chybi', async ({ page }) => {
  const { core, scope } = await readPage(page);
  const offer = await offerFrom(page, scope);
  await (await must(offer.getByRole('button', { name: `Create "${TARGET}"`, exact: true }), 'Create "Chybí"')).click();
  assert.deepEqual(await eventually(() => core.writesTo(), (w) => w.length > 0, 3000), [FILE], 'exactly Quick Notes/Chybí.md');
  assert.match((await fileText(core, FILE)) ?? '', new RegExp(`^title: ${TARGET}$`, 'm'));
});

test('fr_lnk_04_ac12_read_view_embed_placeholder_chip_esc_writes_nothing', async ({ page }) => {
  const { core, scope } = await readPage(page);
  await offerFrom(page, scope);
  await page.keyboard.press('Escape');
  assert.ok(await absent(createOffer(page), 1000), 'Esc closes the offer');
  await sleep(300);
  assert.deepEqual(await writeCalls(core), [], 'no write command');
  assert.deepEqual(await core.writesTo(), [], 'no file written');
});
