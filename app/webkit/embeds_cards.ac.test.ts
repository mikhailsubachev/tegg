// Slice OC, L5: card embeds are object cards (docs/acceptance/embeds.md FR-EMB-02 AC-19…AC-21; cards.md AP-1587, R213),
// on the cards fixture's Karty and the embeds fixture's Jana Nováková, through the fake core (docs/contracts/v1-cards.md
// §3.3 `EmbedNote.card`, §7.4, §8.1, §13). A new file: the 4F embed tests change in the build commit (cards.md
// "Existing criteria this slice changes", D-1997). Written from the ACs and the contract only (D-61).
import { test } from '@playwright/test';
import assert from 'node:assert/strict';
import {
  P, VYLET_YML, another, callsOf, cardInfo, cardWhen, click, eventually, mainName, main, must, noteRoute, objectCard, perCardReads, settingsRoute, sleep, startCards, tsSection, typePatches,
  writtenPaths,
} from './cards-helpers';
import { M, openEmbeds } from './embeds-helpers';

test.use({ timezoneId: 'Europe/Prague' });

const FRAMES: [string, string][] = [['Sněžka z Pece', P.snezka], ['Účetní ze Žižkova', P.ucetni], ['Horské chaty', P.chaty], ['Vyhlídka na Pálavě', P.vyhlidka], ['Pravidla tábora', P.pravidla]];

// ------------------------------------------------------------------------------------------------ FR-EMB-02 AC-19

test('fr_emb_02_ac19_card_mode_is_the_object_card', async ({ page }) => {
  const core = await startCards(page, { route: noteRoute(P.karty) });
  const bad: string[] = [];
  for (const [title, path] of FRAMES) {
    const frame = await must(main(page).getByRole('group', { name: new RegExp(`^⟦?Embedded: ${title}⟧?$`) }), `the frame Embedded: ${title}`, 8000);
    if ((await frame.getAttribute('data-embed-mode')) !== 'card') bad.push(`${title}: data-embed-mode`);
    const card = objectCard(frame, path);
    if (!(await card.count())) { bad.push(`${title}: no ObjectCard in the frame`); continue; }
    if (await card.getByRole('button', { name: /^⟦?More actions for/ }).count()) bad.push(`${title}: a ⋯ in the embed`);
    for (const b of [`Open ${title}`, 'Display as']) if (!(await card.getByRole('button', { name: new RegExp(`^⟦?${b}⟧?$`) }).count())) bad.push(`${title}: no ${b} in the card's head`);
    if ((await frame.locator('.embed-header').count()) > 0) bad.push(`${title}: a second header above the card`);
  }
  assert.deepEqual(bad, [], 'each of the five embeds is a frame holding one ObjectCard whose head has Open and Display as');
  const ch = await cardInfo(objectCard(main(page), P.chaty));
  assert.equal(ch?.items[0]?.kind, 'unreviewed', 'Horské chaty: Unreviewed as the card\'s first pill');
  const vy = await objectCard(main(page), P.vyhlidka).evaluate((c) => c.firstElementChild?.getAttribute('data-strip')).catch(() => null);
  const pr = await objectCard(main(page), P.pravidla).evaluate((c) => c.firstElementChild?.getAttribute('data-strip')).catch(() => null);
  assert.deepEqual([vy, pr], ['image', 'pdf'], 'Vyhlídka and Pravidla start with their strips');
  // A click on the card outside its buttons and chips opens the object; no value is editable.
  const sn = objectCard(main(page), P.snezka);
  assert.equal(await sn.locator('[contenteditable="true"], input, textarea').count(), 0, 'no value is editable');
  await sn.locator('p.card-text').click();
  assert.ok((await eventually(() => mainName(page), (n) => (n ?? '').includes('Sněžka z Pece'), 3000) ?? '').includes('Sněžka z Pece'), 'a click on the card opens Sněžka');
  assert.deepEqual(await core.writesTo(), [], 'no note written');
  // The embeds fixture's Režimy (D-2026): Jana's card shows Osoba's default list; Zavolat Janě stays R52's Task card embed.
  const e = await page.context().newPage();
  await openEmbeds(e, M.rezimy);
  const jana = await must(e.getByRole('group', { name: 'Embedded: Jana Nováková', exact: true }).locator('article[data-object-card]'), 'Jana\'s ObjectCard', 8000);
  const j = await cardInfo(jana);
  assert.deepEqual([j?.text, j?.items.map((i) => i.text)], ['Poznámky o Janě.', ['Firma Beta a.s.', 'Role Analytička']], 'Jana: the text and the pills Firma, Role');
  assert.equal(await e.getByRole('group', { name: 'Embedded: Zavolat Janě', exact: true }).locator('article[data-object-card]').count(), 0, 'Zavolat Janě stays R52\'s Task card embed');
});

// ------------------------------------------------------------------------------------------------ FR-EMB-02 AC-20

test('fr_emb_02_ac20_embeds_section_points_to_card', async ({ page }) => {
  const core = await startCards(page, { route: settingsRoute('výlet') });
  const sec = await must(tsSection(page, 'embeds'), 'the Embeds section', 8000);
  assert.ok((await sec.innerText()).replace(/\s+/g, ' ').includes('How Výlety look when embedded in a note. Card uses the Card section above.'), 'the Embeds hint points to Card');
  const k = await another(page, { route: noteRoute(P.karty) });
  const sn = objectCard(main(k.page), P.snezka);
  await cardWhen(sn, (c) => (c?.items.length ?? 0) > 0, 8000);
  await click(page.getByRole('button', { name: /^⟦?Remove Kraj from the card⟧?$/ }), 'Remove Kraj');
  const yml = await eventually(async () => (await core.files())[VYLET_YML], (t) => !t?.includes('náročnost, kraj,'), 2000);
  assert.equal((await typePatches(core)).length, 1, 'one výlet.yml write');
  await k.core.setFile(VYLET_YML, yml!);
  const after = await cardWhen(sn, (c) => !!c && !c.items.some((i) => i.attribute === 'kraj'), 2000);
  assert.ok(after && !after.items.some((i) => i.attribute === 'kraj'), 'Karty re-renders Sněžka\'s card within 2 s');
  assert.deepEqual(await k.core.writesTo(), [], 'no note file is written');
  void writtenPaths; void sleep;
});

// ------------------------------------------------------------------------------------------------ FR-EMB-02 AC-21

test('fr_emb_02_ac21_card_embeds_load_in_one_batch', async ({ page }) => {
  const core = await startCards(page, { route: noteRoute(P.karty) });
  await must(objectCard(main(page), P.pravidla), 'the fifth card', 8000);
  await sleep(500);
  assert.equal((await callsOf(core, 'link_resolve')).length, 1, 'one link_resolve');
  const loads = await callsOf(core, 'embed_load');
  assert.ok(loads.length <= 1, `at most one embed-content call (${loads.length})`);
  const notes = ((loads[0] as any)?.result ?? []) as any[];
  assert.ok(notes.length === 5 && notes.every((n) => n.card && Array.isArray(n.card.keys) && 'values' in n.card), 'the batch carries every card\'s data');
  // Only reads per card count, not app-level calls or Karty's own note_read (D-2018).
  assert.deepEqual((await perCardReads(core, main(page))).filter((c) => !/^(embed_load|link_resolve) /.test(c)), [], 'no read per card');
});
