// Slice REL, L5 (WebKit + fake core): the `Show linked notes` switch and what Related stores (docs/acceptance/related.md
// R178, R183): FR-LNK-15 AC-25 (the switch: default off, on and off again, shared by routes and vaults, bad values read as
// off and aren't rewritten; D-1695, D-634), FR-STO-07 AC-9 (`related.showLinked` at the top level of `ui-state.json`,
// nothing under `.tegg/`) and FR-SYN-06 AC-47 (the tour: the fake core counts 0 write commands). The relaunch halves are
// in app/e2e/related.ac.test.ts. Interface docs/contracts/v1-related.md §3.3, §4, §6. Written from the ACs and the
// contract only (D-61). Every lookup goes through `must`/`seen` and node:assert (TS-I1).
import { test, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import {
  R, TITLE, ZONE, chipOf, click, ctxPanel, description, drawn, eventually, hv, linkedSwitch, must, mustPreview, nfc, noteRoute, onlyEmpty, openFromSearch,
  openRelated, pathsWhen, relCalls, relPanel, relatedVault, runCommand, sleep, startRelated, uiSetCalls, type FakeCoreHandle,
} from './related-helpers';

test.use({ timezoneId: ZONE, locale: 'en-US' });

const H_HIDDEN = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(hv);
const H_SHOWN = [hv(2), hv(1), ...[3, 4, 5, 6, 7, 8, 9, 10].map(hv)];
const checked = async (page: Page) => (await must(linkedSwitch(page), 'switch "Show linked notes"')).getAttribute('aria-checked');

// ------------------------------------------------------------------------------------------------ FR-LNK-15 AC-25

test('fr_lnk_15_ac25_show_linked_notes_switch', async ({ page }) => {
  const core = await openRelated(page, R.souhvezdi);
  assert.equal(await checked(page), 'false', 'with no related key, the switch is unchecked');
  assert.deepEqual(await pathsWhen(page, H_HIDDEN), H_HIDDEN, 'Souhvězdí, linked hidden (AC-12)');
  const sw = await must(linkedSwitch(page), 'the switch');
  assert.deepEqual([await sw.getAttribute('role'), await sw.getAttribute('data-command')], ['switch', 'related.toggleLinked'], 'role="switch", data-command="related.toggleLinked"');
  const sets = (await uiSetCalls(core)).length;
  const asks = (await relCalls(core)).length;
  await click(linkedSwitch(page), 'switch "Show linked notes"');
  assert.deepEqual(await pathsWhen(page, H_SHOWN, 2000), H_SHOWN, 'on: AC-12\'s linked-shown list');
  const newSets = (await uiSetCalls(core)).slice(sets);
  assert.equal(newSets.length, 1, 'one ui_state_set');
  assert.deepEqual(newSets[0]?.related, { showLinked: true }, 'with related: { showLinked: true }');
  assert.deepEqual((await relCalls(core)).slice(asks).map((c) => [c.path, c.showLinked]), [[R.souhvezdi, true]], 'one index_related with showLinked: true');
  assert.equal(await checked(page), 'true', 'the switch is checked');
  const d = await drawn(page);
  assert.deepEqual(d.filter((x) => x.linked).map((x) => x.path), [hv(2), hv(1)], 'the visible text Linked on Hvězda 02 and Hvězda 01 only');
  for (const p of [hv(2), hv(1)]) {
    assert.ok((await description(chipOf(page, p))).includes('Linked with this note'), `${p}: the chip's description includes Linked with this note`);
    const mark = page.locator(`[data-related-entry="${p}"] [data-related-linked]`);
    assert.equal((await mark.innerText()).trim(), 'Linked', `${p}: the mark reads Linked`);
  }
  await click(linkedSwitch(page), 'switch "Show linked notes" (off)');
  assert.deepEqual(await pathsWhen(page, H_HIDDEN, 2000), H_HIDDEN, 'off again: AC-12\'s other list');
  assert.equal((await drawn(page)).filter((x) => x.linked).length, 0, 'no Linked mark');
  // Shared: every route, and a second vault in the same app.
  await click(linkedSwitch(page), 'switch "Show linked notes" (on)');
  await openFromSearch(page, 'Rozpočet na offsite', TITLE[R.rozpocet]);
  assert.equal(await checked(page), 'true', 'the choice holds on another route');
  await core.setVault({ ...relatedVault(), name: 'Druhý trezor' });
  await openFromSearch(page, 'Hiking', TITLE[R.hiking]);
  assert.equal(await checked(page), 'true', 'and in a second vault opened in the same app');
  // Bad values read as off and aren't rewritten until the switch changes.
  for (const stored of [{}, { showLinked: 'yes' }]) {
    const p = await page.context().newPage();
    const c = await openRelated(p, R.souhvezdi, { related: stored });
    assert.equal(await checked(p), 'false', `related: ${JSON.stringify(stored)} reads as off`);
    assert.deepEqual(await pathsWhen(p, H_HIDDEN), H_HIDDEN, 'linked hidden');
    await openFromSearch(p, 'Rozpočet na offsite', TITLE[R.rozpocet]);
    assert.deepEqual((await c.uiState())?.related, stored, `${JSON.stringify(stored)} is kept as stored`);
    await click(linkedSwitch(p), 'switch "Show linked notes"');
    assert.equal((await eventually(async () => (await c.uiState())?.related?.showLinked, (v) => v === true)), true, 'flipping it stores showLinked: true');
    await p.close();
  }
});

// ------------------------------------------------------------------------------------------------ FR-STO-07 AC-9 (L5)

test('fr_sto_07_ac9_show_linked_is_machine_local', async ({ page }) => {
  const core = await openRelated(page, R.zahrada);
  const tegg = Object.entries(await core.files()).filter(([k]) => k.startsWith('.tegg/'));
  assert.ok(await onlyEmpty(page), 'Zahrada, linked hidden: empty');
  await click(linkedSwitch(page), 'switch "Show linked notes"');
  await pathsWhen(page, [R.seminka, R.zahon], 2000);
  const ui = (await core.uiState()) as any;
  assert.deepEqual(ui?.related, { showLinked: true }, 'related.showLinked: true at the top level of ui-state.json');
  assert.ok(!JSON.stringify(ui?.vaults ?? {}).includes('showLinked'), 'not under vaults[…]');
  assert.deepEqual(Object.entries(await core.files()).filter(([k]) => k.startsWith('.tegg/')), tegg, 'nothing created or changed under .tegg/ (vault.yml untouched)');
  await core.setVault({ ...relatedVault(), name: 'Druhý trezor' });
  await openFromSearch(page, 'Zahrada na jaře', TITLE[R.zahrada] ?? 'Zahrada na jaře');
  assert.equal(await (await must(linkedSwitch(page), 'the switch')).getAttribute('aria-checked'), 'true', 'a second vault on the same machine shows the switch on');
  const p = await page.context().newPage();
  await openRelated(p, R.zahrada);
  assert.equal(await (await must(linkedSwitch(p), 'the switch')).getAttribute('aria-checked'), 'false', 'a fresh Application Support with the same vault: off');
  await p.close();
});

// ------------------------------------------------------------------------------------------------ FR-SYN-06 AC-47 (L5)

test('fr_syn_06_ac47_related_tour_writes_nothing', async ({ page }) => {
  const core = await openRelated(page, R.souhvezdi);
  const files = await core.files();
  const tour: [string, string][] = [
    ['Rozpočet na offsite', TITLE[R.rozpocet]], ['Důležité termíny', TITLE[R.terminyA]], ['Zahrada na jaře', 'Zahrada na jaře'], ['Včelstvo', TITLE[R.vcelstvo]],
    ['Úl u lesa', 'Úl u lesa'], ['Hiking', TITLE[R.hiking]], ['gear list', 'gear list'], ['Buben', 'Buben'], ['Svatba', TITLE[R.svatba]], ['Prázdná', 'Prázdná'],
  ];
  for (const [q, t] of tour) {
    await openFromSearch(page, q, t);
    await must(relPanel(page), `${t}: the Related tab`);
    await sleep(300);
  }
  const den = await page.context().newPage();
  const cDen = await startRelated(den, 'daily/2026-09-30');
  await must(relPanel(den), 'Den 30. 9.: the Related tab');
  const virt = await page.context().newPage();
  const cVirt = await startRelated(virt, 'daily/2026-11-14');
  await must(relPanel(virt), 'daily/2026-11-14: the Related tab');
  // The switch on and off on Souhvězdí and Zahrada.
  for (const [q, t] of [['Souhvězdí', 'Souhvězdí'], ['Zahrada na jaře', 'Zahrada na jaře']]) {
    await openFromSearch(page, q, t);
    await click(linkedSwitch(page), 'the switch (on)');
    await sleep(300);
    await click(linkedSwitch(page), 'the switch (off)');
  }
  // Preview Den 30. 9.'s chip by hover and open Úkol's chip by a click, then go Back.
  await openFromSearch(page, 'Rozpočet na offsite', TITLE[R.rozpocet]);
  await pathsWhen(page, [R.den, R.ukol]);
  await (await must(chipOf(page, R.den), 'Den 30. 9.\'s chip')).hover();
  await mustPreview(page, '2026-09-30', 'hover preview of Den 30. 9.', 3000);
  await page.mouse.move(10, 450);
  await page.keyboard.press('Escape');
  await (await must(chipOf(page, R.ukol), 'Úkol\'s chip')).click();
  await sleep(500);
  await page.keyboard.press('Meta+BracketLeft');
  await pathsWhen(page, [R.den, R.ukol]);
  // The palette commands.
  for (const c of ['Show related', 'Related: Show linked notes', 'Related: Hide linked notes']) {
    await runCommand(page, c);
    await sleep(300);
  }
  // Resize the panel; close and reopen it.
  const sep = page.getByRole('separator', { name: /^⟦?Resize panel⟧?$/ });
  const b = await (await must(sep, 'separator "Resize panel"')).boundingBox();
  if (b) {
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.mouse.down();
    await page.mouse.move(b.x - 60, b.y + b.height / 2, { steps: 4 });
    await page.mouse.up();
  }
  await page.keyboard.press('Meta+Backslash');
  await sleep(200);
  await page.keyboard.press('Meta+Backslash');
  await must(ctxPanel(page), 'the panel reopened');
  for (const [c, what] of [[core, 'the tour'], [cDen, 'Den 30. 9.'], [cVirt, 'daily/2026-11-14']] as [FakeCoreHandle, string][]) {
    assert.equal(await c.writes(), 0, `${what}: the fake core counts 0 write commands`);
    assert.ok(!(nfc('Daily/2026-11-14.md') in (await c.files())), `${what}: no Daily/2026-11-14.md`);
  }
  assert.deepEqual(await core.files(), files, 'every vault file is untouched; nothing under .tegg/');
  assert.ok((await relCalls(core)).length > 0, 'the tour asked for Related lists');
});
