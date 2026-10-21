// v0.52 feedback, L5 (WebKit + fake core): the Task card of a done task. docs/acceptance/conversion.md FR-CNV-05 AC-11
// (D-599, AP-525): `Completed <date>` (the `completed` stamp's date in the vault zone, D-160 medium date of the region)
// where the `Due` button is, and no `Due` button, while the status is in the Done or Cancelled state. Interface
// conversion.md R52, docs/contracts/ms5-tasks.md §11.5. Written from the AC and the contracts only (D-61). Every lookup
// goes through `must`/node:assert (TS-I1). Test clock 2026-10-14T12:00:00+02:00, Europe/Prague, region cs.
import { test, type Locator, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import {
  C, NOW, cardCheckbox, convertVault, dueButton, eventually, flat, main, must, nameOf, needCard, openConvert, sleep, swap, writesOf,
  type FakeCoreHandle,
} from './convert-helpers';

test.use({ timezoneId: 'Europe/Prague' });

const J = 'Zavolat Janě';
const T01 = C.t01;
/** D-160 medium date of the region `cs` in the vault zone. */
const medium = (instant: string) => new Intl.DateTimeFormat('cs', { dateStyle: 'medium', timeZone: 'Europe/Prague' }).format(new Date(instant));

/** The card header's visible text (not the body) and whether a `Due:` button is there. */
async function header(card: Locator): Promise<{ text: string; due: number }> {
  const text = await card.evaluate((root) => {
    const parts: string[] = [];
    const walk = (n: Node) => {
      if (n instanceof HTMLElement && (n.hasAttribute('data-embed-body') || n.getAttribute('role') === 'menu')) return;
      if (n.nodeType === 3) parts.push(n.textContent ?? '');
      n.childNodes.forEach(walk);
    };
    walk(root);
    return parts.join(' ').replace(/\s+/g, ' ').trim().normalize('NFC');
  });
  return { text, due: await dueButton(card).count() };
}
async function poradaCard(page: Page, vault = convertVault()): Promise<{ core: FakeCoreHandle; card: Locator }> {
  const core = await openConvert(page, C.porada, { vault });
  return { core, card: await needCard(main(page), J) };
}

test('fr_cnv_05_ac11_checking_shows_the_completion_date_instead_of_due', async ({ page }) => {
  const { core, card } = await poradaCard(page);
  assert.ok((await nameOf(dueButton(card))).startsWith('Due: '), 'setup: an open task shows its Due button');
  await (await must(cardCheckbox(card, J), 'the checkbox')).click();
  const want = `Completed ${medium(NOW)}`;
  const done = await eventually(() => header(card), (h) => h.text.includes(want) && h.due === 0, 1500);
  assert.ok(done.text.includes(want), `the header shows "${want}" (D-599): ${done.text}`);
  assert.equal(done.due, 0, 'no "Due:" button in the header of a done task');
  assert.equal(await card.getAttribute('data-embed-mode'), 'card', 'the card stays in card mode');
  await (await must(cardCheckbox(card, J), 'the checkbox')).click();
  const open = await eventually(() => header(card), (h) => h.due === 1 && !h.text.includes('Completed'), 1500);
  assert.equal(open.due, 1, 'unchecking brings back "Due: …"');
  assert.ok(!open.text.includes('Completed'), 'and removes the Completed text');
  assert.ok((await nameOf(dueButton(card))).startsWith('Due: '), 'Due: …');
  await sleep(500);
  assert.equal((await writesOf(core, T01)).length, 2, 'only the two checkbox writes (no extra write)');
});

test('fr_cnv_05_ac11_cancelled_with_completed_shows_its_date', async ({ page }) => {
  const vault = convertVault((f) => { f[T01] = swap(swap(f[T01], 'status: To do', 'status: Cancelled'), 'modified: 2026-10-01T09:00:00+02:00\n', 'modified: 2026-10-01T09:00:00+02:00\ncompleted: 2026-10-12T08:00:00+02:00\n'); });
  const { core, card } = await poradaCard(page, vault);
  const want = `Completed ${medium('2026-10-12T08:00:00+02:00')}`;
  const h = await eventually(() => header(card), (x) => x.text.includes(want), 1500);
  assert.ok(h.text.includes(want), `a Cancelled task shows "${want}": ${flat(h.text)}`);
  assert.equal(h.due, 0, 'no Due button');
  await sleep(300);
  assert.deepEqual(await writesOf(core, T01), [], 'opening writes nothing');
});

test('fr_cnv_05_ac11_done_without_completed_shows_neither', async ({ page }) => {
  const vault = convertVault((f) => { f[T01] = swap(f[T01], 'status: To do', 'status: Done'); });
  assert.ok(!/^completed:/m.test(vault.files[T01]), 'setup: no completed key');
  const { core, card } = await poradaCard(page, vault);
  await sleep(500);
  const h = await header(card);
  assert.equal(h.due, 0, 'a done task without completed shows no Due button');
  assert.ok(!h.text.includes('Completed'), `and no Completed text: ${h.text}`);
  assert.equal(await card.getAttribute('data-embed-mode'), 'card', 'still a card');
  assert.deepEqual(await writesOf(core, T01), [], 'nothing written');

});
