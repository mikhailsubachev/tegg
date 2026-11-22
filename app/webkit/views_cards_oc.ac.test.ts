// Slice OC, L5: board cards are object cards (docs/acceptance/views.md part four, FR-QRY-05 AC-30 on the cards fixture,
// AC-31 on the views-tasks overlay; cards.md R211…R213, D-1942, D-1904), through the fake core (docs/contracts/
// v1-cards.md §7.1, §7.4, §8.1, §13). A new file: the part-one…three board tests change in the build commit
// (cards.md "Existing criteria this slice changes", D-1997). Written from the ACs and the contract only (D-61).
import { test } from '@playwright/test';
import assert from 'node:assert/strict';
import {
  BOOK_YML, P, STAV_Q, another, board, cardInfo, cardWhen, cardsVault, click, fileText, fileWhen, main, must, nfc, objectCard, objectCards, queryRoute, settingsRoute,
  startCards, swap, typePatches, writtenPaths,
} from './cards-helpers';
import { SCHEDULE, overlayVault, startTasksViews, TYPE_TASK } from './views-tasks-helpers';

test.use({ timezoneId: 'Europe/Prague' });

// ------------------------------------------------------------------------------------------------ FR-QRY-05 AC-30

test('fr_qry_05_ac30_board_cards_are_object_cards', async ({ page }) => {
  const core = await startCards(page, { route: queryRoute('Rozečtené') });
  const b = await must(board(page), 'Rozečtené', 8000);
  const u = await must(b.getByRole('article', { name: /^⟦?Book: Účetní ze Žižkova⟧?$/ }), 'the article Book: Účetní ze Žižkova');
  assert.equal(await u.getAttribute('data-object-card'), '', 'data-object-card');
  const c = await cardInfo(u);
  assert.deepEqual([c?.lead, c?.text, c?.items, c?.footerLink, c?.date], ['book', 'Kriminálka z kanceláře nad hospodou.', [], 'Jana Brázdová', 'Edited Mon'], 'lead book, the text, no pill, the author chip and Edited Mon');
  assert.ok(await u.getByRole('button', { name: /^⟦?More actions for "Účetní ze Žižkova"⟧?$/ }).count(), 'More actions for "Účetní ze Žižkova"');
  assert.ok(!(await u.innerText()).includes('No Rating'), 'no empty No Rating pill');
  assert.deepEqual((await cardInfo(objectCard(b, 'Books/Dům u řeky.md')))?.tags, ['#doporučené'], 'Dům u řeky shows #doporučené');
  const za = await another(page, { route: queryRoute('Podle autora') });
  const zb = await must(board(za.page), 'Podle autora', 8000);
  const au = await cardWhen(objectCard(zb, P.ucetni), (x) => !!x, 5000);
  assert.deepEqual([au?.footerLink, au?.date], [null, 'Edited Mon'], 'Podle autora: the author chip hidden, the footer holds only the date');
  const zn = await another(page, { route: queryRoute('Podle žánru') });
  const gb = await must(board(zn.page), 'Podle žánru', 8000);
  const g = await cardWhen(gb.locator(`article[data-object-card][data-path="${nfc(P.ucetni)}"]`).first(), (x) => !!x, 5000);
  assert.deepEqual(g?.items.filter((i) => i.attribute === 'genres').map((i) => i.text), ['Genres Detektivka', 'Genres Román'], 'two genres shown on a card (D-1769)');
  const sv = await another(page, { route: queryRoute(STAV_Q) });
  const sb = await must(board(sv.page), STAV_Q, 8000);
  assert.ok(!((await cardInfo(objectCard(sb, P.snezka)))?.items.some((i) => i.attribute === 'stav') ?? true), 'Výlety podle stavu: R218\'s cards without stav');
  // Adding rating through Book's Card section: one book.yml write; a Rating pill on every Book card within 2 s.
  const st = await another(page, { route: settingsRoute('book') });
  await click(st.page.locator('button[data-command="card.add"]'), 'Add property', 8000);
  await st.page.getByRole('combobox', { name: /^⟦?Find a property…⟧?$/ }).fill('rating');
  await st.page.keyboard.press('Enter');
  const by = await fileWhen(st.core, BOOK_YML, (t) => !!t?.includes('card:'), 2000);
  assert.equal(by, swap(cardsVault().files[BOOK_YML], 'preview: [author, status]\n', 'preview: [author, status]\ncard: [tags, body, author, status, modified, rating]\n'), 'one book.yml write of card:');
  await core.setFile(BOOK_YML, by!);
  const n = await cardWhen(objectCard(b, 'Books/Noční vlak.md'), (x) => !!x?.items.some((i) => i.attribute === 'rating'), 2000);
  assert.ok(n?.items.some((i) => i.attribute === 'rating' && i.text.includes('Good')), 'a Rating pill within 2 s');
  assert.equal(await fileText(core, '.tegg/queries/Rozečtené.yml'), cardsVault().files['.tegg/queries/Rozečtené.yml'], 'Rozečtené.yml (columns: [author, rating]) byte for byte');
  assert.deepEqual((await writtenPaths(st.core)).filter((p) => p.startsWith('query_')), [], 'no query file written');
  void objectCards; void typePatches; void main;
});

// ------------------------------------------------------------------------------------------------ FR-QRY-05 AC-31

test('fr_qry_05_ac31_task_card_follows_the_card_list', async ({ page }) => {
  const core = await startTasksViews(page, { vault: overlayVault(), route: TYPE_TASK });
  const sched = await must(main(page).locator(`div[role="group"][data-board][data-board-name="${SCHEDULE}"]`), 'Schedule', 8000);
  const zj = sched.locator('article[data-object-card][data-task-card]').filter({ hasText: 'Zavolat Janě' }).first();
  const c = await cardWhen(zj, (x) => !!x, 5000);
  assert.deepEqual([c?.leadChecbox, c?.footerLink], [true, 'Porada'], 'R43\'s checkbox, the source chip Porada in the footer');
  assert.ok(await zj.getByRole('button', { name: /^⟦?More actions for "Zavolat Janě"⟧?$/ }).count(), 'More actions');
  // Adding projekt in Type settings › Card.
  const st = await startTasksViews(await page.context().newPage(), { vault: overlayVault(), route: settingsRoute('task') });
  void st;
  const sp = page.context().pages().at(-1)!;
  await click(sp.locator('button[data-command="card.add"]'), 'Task: Add property', 8000);
  await sp.getByRole('combobox', { name: /^⟦?Find a property…⟧?$/ }).fill('projekt');
  await sp.keyboard.press('Enter');
  const t = await fileWhen(st, '.tegg/types/task.yml', (x) => !!x?.includes('card:'), 2000);
  assert.ok(t?.includes('card: [tags, body, status, due, priority, recurrence, source, projekt]\n'), 'task.yml\'s card: line once');
  assert.equal((await typePatches(st)).length, 1, 'one write');
  await core.setFile('.tegg/types/task.yml', t!);
  const withP = await cardWhen(sched.locator('article[data-object-card][data-task-card]').filter({ has: page.locator('[data-attribute="projekt"]') }).first(), (x) => !!x, 2000);
  assert.ok(withP, 'a projekt chip within 2 s on Tasks whose projekt is set');
});
