// Slice OC, L5: reads and live updates of cards (docs/acceptance/cards.md FR-TYP-11 AC-18 one read per list, AC-19
// cards follow changes, FR-LNK-14 AC-15 the duplicate details line from the card list), counting the fake core's calls
// (docs/contracts/v1-cards.md §1.2, §3.4, §3.5, §13). Written from the ACs and the contract only (D-61).
import { test } from '@playwright/test';
import assert from 'node:assert/strict';
import {
  BOOK_YML, P, SEVEN, STAV_Q, VYLET_YML, another, board, callsOf, cardInfo, cardWhen, cardsVault, eventually, main, must, nfc, noteRoute, objectCard, objectCards, queryRoute,
  sevenTypes, sleep, startCards, swap, vyletWith, writtenPaths,
} from './cards-helpers';

test.use({ timezoneId: 'Europe/Prague' });

const PER_CARD = ['note_read', 'type_get', 'embed_load', 'link_resolve'];
async function perCard(core: Awaited<ReturnType<typeof startCards>>): Promise<string[]> {
  return (await core.calls()).map((c) => c.cmd).filter((c) => PER_CARD.includes(c) || c.startsWith('index_'));
}

// ------------------------------------------------------------------------------------------------ FR-TYP-11 AC-18

test('fr_typ_11_ac18_one_read_per_list', async ({ page }) => {
  for (const [name, vault] of [[STAV_Q, cardsVault()], ['Rozečtené', cardsVault()], [SEVEN, cardsVault((f) => sevenTypes(f))]] as const) {
    const o = await another(page, { vault, route: queryRoute(name) });
    const b = await must(board(o.page), name, 8000);
    await eventually(() => objectCards(b).count(), (n) => n > 0, 5000);
    await must(objectCards(b).first(), `${name}: object cards`);
    await sleep(500);
    assert.equal((await callsOf(o.core, 'query_run')).length, 1, `${name}: exactly one query_run`);
    assert.deepEqual(await perCard(o.core), [], `${name}: no note_read, type_get, embed_load, link_resolve or index_* per card`);
    const rows = ((await callsOf(o.core, 'query_run'))[0] as any)?.result?.rows ?? [];
    assert.ok(rows.length > 0 && rows.every((r: any) => r.card && Array.isArray(r.card.keys)), `${name}: every row carries its card data`);
  }
  // Karty: one link_resolve, at most one embed-content call for the five card embeds.
  const k = await another(page, { route: noteRoute(P.karty) });
  await must(objectCard(main(k.page), P.pravidla), 'Karty\'s fifth card', 8000);
  await sleep(500);
  assert.equal((await callsOf(k.core, 'link_resolve')).length, 1, 'Karty: one link_resolve');
  assert.ok((await callsOf(k.core, 'embed_load')).length <= 1, 'Karty: at most one embed_load');
  assert.deepEqual((await k.core.calls()).map((c) => c.cmd).filter((c) => c === 'note_read' || c === 'type_get' || c.startsWith('index_')), [], 'no read per card');
  // Přečtené 2026 (a Table) asks for no excerpt.
  const t = await another(page, { route: queryRoute('Přečtené 2026') });
  await must(main(t.page).locator('[data-query-result]').first(), 'Přečtené 2026', 8000);
  const tr = ((await callsOf(t.core, 'query_run'))[0] as any)?.result?.rows ?? [];
  assert.ok(tr.length > 0 && tr.every((r: any) => r.card === null), 'a Table run has no card data');
});

// ------------------------------------------------------------------------------------------------ FR-TYP-11 AC-19

test('fr_typ_11_ac19_cards_follow_changes', async ({ page }) => {
  const core = await startCards(page, { route: queryRoute(STAV_Q) });
  const b = await must(board(page), 'Výlety podle stavu', 8000);
  const sn = objectCard(b, P.snezka);
  await cardWhen(sn, (c) => (c?.items.length ?? 0) > 0, 5000);
  const step = async (what: string, change: () => Promise<void>, ok: (c: Awaited<ReturnType<typeof cardInfo>>) => boolean) => {
    await change();
    const c = await cardWhen(sn, ok, 2000);
    assert.ok(ok(c), `${what}: Sněžka's card follows within 2 s (${JSON.stringify(c?.items.map((i) => [i.attribute, i.icon, i.label]))})`);
  };
  await step('kraj: Liberecký by another program', async () => core.setFile(P.snezka, swap((await core.files())[nfc(P.snezka)], 'kraj: Královéhradecký', 'kraj: Liberecký')), (c) => !!c?.items.some((i) => i.attribute === 'kraj' && i.text.includes('Liberecký')));
  await step('kraj\'s icon: mountain', async () => core.setFile(VYLET_YML, swap((await core.files())[nfc(VYLET_YML)], '    icon: map-pin\n', '    icon: mountain\n')), (c) => !!c?.items.some((i) => i.attribute === 'kraj' && i.icon === 'mountain'));
  await step('the Name Kraj → Region', async () => core.setFile(VYLET_YML, swap((await core.files())[nfc(VYLET_YML)], '    name: Kraj\n', '    name: Region\n')), (c) => !!c?.items.some((i) => i.attribute === 'kraj' && i.label === 'Region: Liberecký'));
  await step('card: removed from výlet.yml', async () => core.setFile(VYLET_YML, swap((await core.files())[nfc(VYLET_YML)], 'card: [tags, description, stav, náročnost, kraj, vybavení, délka, termín, odkaz, průvodce, neznámý-klíč, modified]\n', '')),
    (c) => c?.textFrom === 'body' && !c.items.some((i) => i.attribute === 'vybavení'));
  // Book's card in another window: card: [tags, kraj] added to book.yml.
  const k = await another(page, { route: noteRoute(P.karty) });
  const u = objectCard(main(k.page), P.ucetni);
  await cardWhen(u, (c) => !!c, 8000);
  await k.core.setFile(BOOK_YML, swap((await k.core.files())[nfc(BOOK_YML)], 'preview: [author, status]\n', 'preview: [author, status]\ncard: [tags, kraj]\n'));
  const uc = await cardWhen(u, (c) => !!c && c.text === null && !c.date, 2000);
  assert.deepEqual([uc?.text, uc?.date, uc?.items], [null, null, []], 'Karty\'s Book card follows book.yml\'s card: within 2 s');
  assert.deepEqual([...(await writtenPaths(core)), ...(await writtenPaths(k.core))], [], 'nothing is written');
  void vyletWith;
});

// ------------------------------------------------------------------------------------------------ FR-LNK-14 AC-15

test('fr_lnk_14_ac15_details_from_the_card_list', async ({ page }) => {
  const vault = cardsVault((f) => { f['Pages/Sněžka z Pece.md'] = '---\ntype: page\ntitle: Sněžka z Pece\ncreated: 2026-11-01T09:00:00+01:00\nmodified: 2026-11-01T09:00:00+01:00\n---\nStránka.\n'; });
  const core = await startCards(page, { vault, route: 'duplicate-titles' });
  const line = main(page).getByText(/^⟦?Výlet · Feb 10, 2026 · /);
  await must(line, 'the details line of Sněžka (a Výlet)', 8000);
  assert.equal((await line.first().textContent())?.trim(), 'Výlet · Feb 10, 2026 · Hotový · Střední', 'the first two set pill values of the card list');
  await core.setFile(VYLET_YML, vyletWith('card: [kraj, stav]\n'));
  const after = await eventually(async () => (await main(page).getByText(/^⟦?Výlet · Feb 10, 2026 · /).first().textContent().catch(() => ''))?.trim() ?? '', (t) => t.includes('Královéhradecký'), 2000);
  assert.equal(after, 'Výlet · Feb 10, 2026 · Královéhradecký · Hotový', 'after card: [kraj, stav] within 2 s');
});
