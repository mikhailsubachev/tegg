// Slice MM, L5 (WebKit, fake core): FR-LNK-01 AC-27, the panel part (docs/acceptance/mindmap.md; backlinks.md R15,
// contract docs/contracts/ms4-links.md §4): Lisabon's Backlinks panel lists exactly `Pages, 2` (Výjezd 2026 and Uzly;
// Stará mapa in `.trash/` and the template aren't listed); a runtime note holding `> [!mindmap]\n> - [[Lisabon]]` in NFD
// bytes adds a third entry within 2 s; the Broken links page lists Uzly's `[[Neexistuje]]` with the excerpt
// `Neexistuje` (the list item's own text, D-277). Written from the AC and the contracts only (D-61).
import { test } from '@playwright/test';
import assert from 'node:assert/strict';
import { MM, eventually, main, must, nfd, openMm, runCommand } from './mindmap-helpers';
import { chipNames, groups, mustPanel } from './links-helpers';

test.use({ timezoneId: 'Europe/Prague' });

test('fr_lnk_01_ac27_node_links_are_backlinks_in_the_panel', async ({ page }) => {
  const core = await openMm(page, MM.lisabon, { panel: true });
  await mustPanel(page);
  assert.deepEqual(await eventually(() => groups(page), (g) => g.length > 0, 3000), ['Pages, 2'], 'exactly Pages, 2');
  assert.deepEqual((await chipNames(page)).sort(), ['Uzly', 'Výjezd 2026'], 'Výjezd 2026 and Uzly, each once');
  await core.setFile('Pages/NFD odkaz.md', nfd('---\nid: 01JB4M0000000000000000M030\ntype: page\ntitle: NFD odkaz\n---\n> [!mindmap]\n> - [[Lisabon]]\n'));
  const g = await eventually(() => groups(page), (x) => x.join() === 'Pages, 3', 2000);
  assert.deepEqual(g, ['Pages, 3'], 'the NFD note adds a third entry within 2 s');
});

test('fr_lnk_01_ac27_broken_link_in_a_node_has_the_item_text_as_excerpt', async ({ page }) => {
  await openMm(page, MM.uzly);
  await runCommand(page, 'Go to Broken links');
  await must(main(page).getByRole('heading', { name: 'Broken links', exact: true }), 'Broken links', 5000);
  const occ = main(page).locator('[data-occurrence]');
  await must(occ.first(), 'an occurrence', 5000);
  const texts = (await occ.allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim());
  assert.deepEqual(texts, ['Neexistuje'], 'one occurrence, the list item\'s own text: no >, - or child items');
});
