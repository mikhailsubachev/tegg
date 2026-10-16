// MS4 slice 4A, L5 (WebKit + fake core): the Backlinks panel. FR-LNK-01 AC-1, AC-2 (panel = query), AC-3, AC-7
// (Dvojník panels), AC-9, AC-10, AC-11 (one case), AC-13…AC-15, AC-16 (DOM part); FR-LNK-02 AC-6. docs/acceptance/backlinks.md
// (R15, R16); interface docs/contracts/ms4-links.md §4–§6. Written from the ACs and the contract only (D-61). Every
// lookup goes through `must`/node:assert with short timeouts, so a missing panel fails an assertion (TS-I1).
// D-368 (slice 4B preview feedback): entries are chips; the excerpt tests of FR-LNK-01 AC-4…AC-6 and FR-LNK-02
// AC-4, AC-5 are superseded and replaced by backlinks_chips.ac.test.ts (AC-17…AC-21, FR-LNK-02 AC-7); the rest is adapted.
import { test, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import {
  B, CIL_SOURCES, backlinksPanel, backlinksTab, callsOf, chipNames as entries, chipsIn as entriesIn, contextPanel, description, editorBody, eventually,
  fileText, flat, focus, gotoNote, groupHeader, groups, linksVault, must, mustBeOn, mustPanel, openLinks, panelChip, panelChips,
  panelHeading, props, runCommand, seen, sleep, swap, writeCalls,
} from './links-helpers';
import { absent } from './helpers';

const AXE = createRequire(import.meta.url).resolve('axe-core/axe.min.js');
const CIL_GROUPS = ['Pages, 4', 'Quick Notes, 1', 'Daily Notes, 1', 'Schůzky, 2', 'neznámý, 1'];

async function badge(page: Page): Promise<string> {
  return flat(await (await must(backlinksTab(page), 'tab "Backlinks"')).innerText()).replace(/^Backlinks\s*/, '');
}

// ------------------------------------------------------------------------------------------------ FR-LNK-01

test('fr_lnk_01_ac1_cmd_backslash_opens_the_built_backlinks_tab', async ({ page }) => {
  await openLinks(page, B.cil, { panel: false });
  await page.keyboard.press('Meta+Backslash');
  await must(contextPanel(page), 'complementary "Context panel"');
  const tab = await must(backlinksTab(page), 'tab "Backlinks"');
  assert.equal(await tab.getAttribute('aria-selected'), 'true', 'Backlinks selected (UI state default)');
  await mustPanel(page);
  assert.ok(!(await seen(backlinksPanel(page).getByText(/^Coming in/), 300)), 'not the placeholder');
  assert.equal(await badge(page), '9', 'badge 9');
  assert.equal(await description(tab), '9 objects link here', 'tab description');
  assert.equal(flat(await (await must(panelHeading(page), 'panel heading h2')).innerText()), '9 objects link here');
});

test('fr_lnk_01_ac1_same_panel_in_the_read_view_and_on_a_read_only_note', async ({ page }) => {
  await openLinks(page, B.cil, { readView: true });
  await mustPanel(page);
  assert.equal(await badge(page), '9', 'read view: badge 9');
  assert.equal(flat(await panelHeading(page).first().innerText()), '9 objects link here');
  // Neplatná hlavička (the editor can't open it) as the target of a runtime link.
  const v = linksVault((f) => { f[B.osamela] = swap(f[B.osamela], 'Na tuto stránku nic neodkazuje.', 'Viz [[Neplatná hlavička]].'); });
  const p2 = await page.context().newPage();
  await openLinks(p2, B.neplatna, { vault: v });
  await mustPanel(p2);
  assert.equal(await badge(p2), '1', 'badge 1 on a note the editor can not open');
  assert.deepEqual(await entries(p2), ['Osamělá']);
});

test('fr_lnk_01_ac1_no_panel_on_routes_without_an_object', async ({ page }) => {
  await openLinks(page, B.cil);
  await mustPanel(page, 'Backlinks on Cíl');
  for (const [go, name] of [['Go to type: Pages', 'Pages'], ['Go to Search', 'Search']] as const) {
    await runCommand(page, go);
    await mustBeOn(page, name, go, 5000);
    assert.ok(await absent(backlinksPanel(page), 1500), `${name}: no Backlinks panel (D-127)`);
  }
});

test('fr_lnk_01_ac2_panel_shows_exactly_what_the_query_returns', async ({ page }) => {
  const core = await openLinks(page, B.cil);
  await mustPanel(page);
  assert.deepEqual([...(await entries(page))].sort(), [...CIL_SOURCES].sort(), 'the 9 sources, each once');
  const q = await callsOf(core, 'index_backlinks');
  assert.ok(q.some((c) => (c.args as any)?.path === B.cil), 'index_backlinks(path) for the opened note');
});

for (const [region, tz] of [['cs', 'Europe/Prague'], ['en', 'America/Los_Angeles'], ['cs', 'America/Los_Angeles'], ['en', 'Europe/Prague']] as const) {
  test.describe(`order in ${region} ${tz}`, () => {
    test.use({ timezoneId: tz });
    test(`fr_lnk_01_ac3_groups_and_entries_in_order_${region}_${tz.replace(/\W/g, '_')}`, async ({ page }) => {
      await openLinks(page, B.cil, { region });
      assert.deepEqual(await groups(page), CIL_GROUPS, 'D-121 group order');
      assert.deepEqual(await entriesIn(page, 'Pages'), ['Odkazy v textu', 'Rozbité odkazy', 'Markdown odkaz', 'Neplatná hlavička'], 'by modified, then title');
      assert.deepEqual(await entriesIn(page, 'Schůzky'), ['2026-10-08 Porada', 'Starší porada']);
      const undef = backlinksPanel(page).getByRole('group', { name: 'neznámý', exact: true });
      assert.ok((await seen(undef, 500)) && flat(await undef.innerText()).includes('No type definition'), 'the undefined group has the marker No type definition');
    });
  });
}

test('fr_lnk_01_ac7_dvojnik_panels_follow_link_resolution', async ({ page }) => {
  await openLinks(page, B.dvojnikQ);
  assert.deepEqual([...(await entries(page))].sort(), ['Z kořene', 'Z rychlých'], 'Quick Notes/Dvojník: same folder and path link');
  const p2 = await page.context().newPage();
  await openLinks(p2, B.dvojnikP);
  assert.deepEqual([...(await entries(p2))].sort(), ['Z kořene', 'Ze stránek'], 'Pages/Dvojník: same folder and shortest path');
});

test('fr_lnk_01_ac9_external_changes_update_the_open_panel', async ({ page }) => {
  const core = await openLinks(page, B.cil);
  await mustPanel(page);
  const header = await must(groupHeader(page, 'Pages'), 'Pages header');
  await header.focus();
  const w0 = (await writeCalls(core)).length;
  await core.setFile(B.osamela, `${await fileText(core, B.osamela)}Viz [[Cíl]].\n`);
  assert.ok((await eventually(() => entriesIn(page, 'Pages'), (x) => x.includes('Osamělá'), 2000)).includes('Osamělá'), 'Osamělá added within 2 s');
  assert.equal(await eventually(() => badge(page), (b) => b === '10', 2000), '10', 'badge 10');
  assert.equal((await focus(page)).name, 'Pages, 5', 'the focus stays on the focused element');
  await core.setFile(B.rychla, swap(await fileText(core, B.rychla), 'Malými písmeny: [[cíl]].', 'Bez odkazů.').replace(/\nV NFD: .*\n/, '\n').replace('![[Cíl]]', ''));
  assert.ok(!(await eventually(() => groups(page), (g) => !g.some((x) => x.startsWith('Quick Notes')), 2000)).some((x) => x.startsWith('Quick Notes')), 'Quick Notes group gone');
  await core.renameFile(B.starsi, '.trash/Schůzky/Starší porada.md');
  assert.ok(!(await eventually(() => entries(page), (x) => !x.includes('Starší porada'), 2000)).includes('Starší porada'), 'trashed source gone');
  await core.setFile(B.bezTypu, swap(await fileText(core, B.bezTypu), 'type: neznámý', 'type: page'));
  assert.ok((await eventually(() => entriesIn(page, 'Pages'), (x) => x.includes('Bez typu s vlastností'), 2000)).includes('Bez typu s vlastností'), 'moved to Pages');
  // D-368: there are no labels; renaming the property changes nothing in the panel and Porada stays listed.
  const before = await entries(page);
  await core.setFile('.tegg/types/schůzka.yml', swap(await fileText(core, '.tegg/types/schůzka.yml'), 'name: Poznámka', 'name: Komentář'));
  await sleep(1000);
  assert.deepEqual(await entries(page), before, 'the property rename changes nothing in the panel');
  assert.ok((await entriesIn(page, 'Schůzky')).includes('2026-10-08 Porada'), 'Porada stays listed');
  assert.deepEqual((await writeCalls(core)).slice(w0), [], 'nothing is written');
});

test('fr_lnk_01_ac10_own_links_show_up_within_1s_of_note_ready', async ({ page }) => {
  await openLinks(page, B.osamela);
  await (await must(editorBody(page), 'Note body')).click();
  await page.keyboard.press('End');
  await page.keyboard.type(' [[Cíl');
  const lb = await must(page.getByRole('listbox', { name: 'Link suggestions', exact: true }), 'Link suggestions');
  await (await must(lb.getByRole('option').filter({ hasText: /^Cíl/ }), 'option Cíl')).click();
  assert.ok(await seen(page.getByRole('status', { name: 'Save state' }).filter({ hasText: 'Saved' }), 4000), 'Saved');
  await (await must(editorBody(page).locator('[data-link-kind="note"]').filter({ hasText: 'Cíl' }), 'the new chip')).click();
  await mustBeOn(page, 'Cíl', 'the chip opens Cíl', 5000);
  assert.ok((await eventually(() => entriesIn(page, 'Pages'), (x) => x.includes('Osamělá'), 1000)).includes('Osamělá'), 'Osamělá within 1 s');
  await gotoNote(page, 'Osamělá');
  await must(editorBody(page).locator('[data-link-kind="note"]').filter({ hasText: 'Cíl' }), 'the chip');
  await editorBody(page).focus();
  await page.keyboard.press('Meta+ArrowDown'); // the end of the body, right after the chip
  await page.keyboard.press('Backspace');
  assert.ok(await seen(page.getByRole('status', { name: 'Save state' }).filter({ hasText: 'Saved' }), 4000), 'Saved again');
  await gotoNote(page, 'Cíl');
  assert.ok(!(await eventually(() => entries(page), (x) => !x.includes('Osamělá'), 1000)).includes('Osamělá'), 'gone within 1 s');
});

test('fr_lnk_01_ac11_lower_case_and_nfd_links_give_one_chip', async ({ page }) => {
  // D-368: [[cíl]], NFD [[Cíl]] and ![[Cíl]] count as occurrences of Cíl; the panel shows one chip `Rychlá poznámka`.
  await openLinks(page, B.cil);
  assert.deepEqual(await entriesIn(page, 'Quick Notes'), ['Rychlá poznámka']);
  assert.equal(await panelChip(page, 'Rychlá poznámka').count(), 1, 'one chip');
});

test('fr_lnk_01_ac13_empty_state', async ({ page }) => {
  await openLinks(page, B.osamela);
  await mustPanel(page);
  assert.equal(flat(await panelHeading(page).first().innerText()), 'No backlinks yet');
  assert.ok(await seen(backlinksPanel(page).getByText('Link to this note with [[ or @ from another note.', { exact: true }), 1000), 'the hint');
  assert.equal(await badge(page), '', 'no badge');
  assert.equal(await description(backlinksTab(page)), '', 'no description');
  assert.equal(await backlinksPanel(page).getByRole('group').count(), 0, 'no groups');
});

test('fr_lnk_01_ac14_keyboard_only', async ({ page }) => {
  await openLinks(page, B.cil, { panel: false });
  await runCommand(page, 'Show backlinks');
  await mustPanel(page);
  assert.deepEqual(await eventually(() => focus(page), (f) => f.role === 'link'), { role: 'link', name: 'Odkazy v textu', inPanel: true, inBody: false }, 'focus on the first chip (D-368)');
  await page.keyboard.press('Shift+Tab');
  assert.equal((await focus(page)).name, 'Pages, 4', 'Shift+Tab: the group header before it');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  assert.equal((await focus(page)).name, 'Rozbité odkazy', 'then the next chip (no excerpt stop, D-368)');
  const header = await must(groupHeader(page, 'Pages'), 'Pages header');
  await header.focus();
  await page.keyboard.press('Enter');
  assert.equal(await header.getAttribute('aria-expanded'), 'false', 'Enter collapses');
  assert.ok(await absent(panelChip(page, 'Odkazy v textu'), 1000), 'chips hidden');
  await page.keyboard.press('Space');
  assert.equal(await header.getAttribute('aria-expanded'), 'true', 'Space expands');
  await page.keyboard.press('Meta+Backslash');
  assert.ok(await absent(backlinksPanel(page), 1500), '⌘\\ closes the panel');
  assert.equal((await focus(page)).inBody, true, 'focus back in the note body');
});

test('fr_lnk_01_ac14_every_panel_control_is_a_command', async ({ page }) => {
  await openLinks(page, B.cil);
  await mustPanel(page);
  const ids = await page.evaluate(() => ((window as any).__TEGG_TEST__?.commands?.() ?? []) as string[]);
  assert.ok(ids.includes('panel.backlinks'), 'panel.backlinks is a registered command');
  const missing = await page.evaluate(() =>
    [...document.querySelectorAll('[role="complementary"] button, [role="complementary"] [role="tab"]')].filter((b) => !b.closest('[role="tabpanel"]') && !b.hasAttribute('data-command')).map((b) => b.textContent?.trim()));
  assert.deepEqual(missing, [], 'frame controls of the panel carry data-command (FR-UX-03 AC-8)');
});

test('fr_lnk_01_ac15_czech_test_catalog_and_pseudo_locale', async ({ page }) => {
  const prelude = `import { setCatalog as __s, en as __en } from '/src/i18n/catalog.ts'; __s({ ...__en, 'backlinks.count': { one: '{count} objekt sem odkazuje', few: '{count} objekty sem odkazují', other: '{count} objektů sem odkazuje' } }, 'cs');`;
  await openLinks(page, B.spm, { prelude });
  assert.equal(flat(await (await must(panelHeading(page), 'heading')).innerText()), '1 objekt sem odkazuje', 'one');
  await gotoNote(page, 'Jana Nováková');
  assert.equal(await eventually(async () => flat(await panelHeading(page).first().innerText()), (t) => t.startsWith('3')), '3 objekty sem odkazují', 'few');
  await gotoNote(page, 'Cíl');
  assert.equal(await eventually(async () => flat(await panelHeading(page).first().innerText()), (t) => t.startsWith('9')), '9 objektů sem odkazuje', 'other');
  const p2 = await page.context().newPage();
  await openLinks(p2, B.cil, { prelude: `import { setCatalog as __tsc, pseudo as __tps, en as __ten } from '/src/i18n/catalog.ts'; __tsc(__tps(__ten), 'en');` });
  const panel = await must(backlinksPanel(p2), 'panel with the pseudo-locale', 5000);
  const leaks = await panel.evaluate((root) => {
    const out: string[] = [];
    const walk = (n: Node) => {
      if (n.nodeType === 3) {
        const t = (n.textContent ?? '').trim();
        const el = n.parentElement;
        if (t && el && !el.closest('[data-user-content]') && !/⟦|⟧/.test(el.textContent ?? '')) out.push(t);
      } else n.childNodes.forEach(walk);
    };
    walk(root);
    return out;
  });
  assert.deepEqual(leaks, [], 'only titles, type names, attribute names and excerpts are outside the markers');
});

test('fr_lnk_01_ac15_contrast_with_every_group_expanded', async ({ browser }) => {
  for (const theme of ['light', 'dark'] as const) {
    const page = await browser.newPage();
    await openLinks(page, B.cil, { theme });
    await mustPanel(page);
    await page.addScriptTag({ path: AXE });
    const v = await page.evaluate(async () => {
      const r = await (window as any).axe.run(document.querySelector('[role="tabpanel"]'), { runOnly: { type: 'rule', values: ['color-contrast'] } });
      return r.violations.flatMap((x: any) => x.nodes.map((n: any) => n.target.join(' ')));
    });
    assert.deepEqual(v, [], `${theme}: no color-contrast violation in the panel`);
    await page.close();
  }
});

test('fr_lnk_01_ac16_panel_keeps_at_most_100_entries_in_the_dom', async ({ page }) => {
  // [MS8] AC-16, the DOM part (L5): 1,000 notes link to Osamělá; the virtualized panel never holds more than 100
  // entry elements while scrolling. The paint time is the L6 benchmark (app/e2e/perf_backlinks.ts).
  const v = linksVault((f) => {
    for (let i = 0; i < 1000; i++) {
      const n = String(i).padStart(4, '0');
      f[`Pages/Odkazující ${n}.md`] = `---\nid: 01JB4AREF${n.padStart(17, '0')}\ntype: page\ntitle: Odkazující ${n}\n---\nZmínka o [[Osamělá]].\n`;
    }
  });
  await openLinks(page, B.osamela, { vault: v });
  const panel = await mustPanel(page);
  assert.equal(await eventually(() => badge(page), (b) => b === '1000', 5000), '1000', 'badge 1000');
  let most = 0;
  for (const frac of [0, 0.25, 0.5, 0.75, 1]) {
    await panel.evaluate((el, f) => { el.scrollTop = (el.scrollHeight - el.clientHeight) * f; }, frac);
    await sleep(150);
    most = Math.max(most, await panelChips(backlinksPanel(page)).count());
  }
  assert.ok(most > 0 && most <= 100, `at most 100 entry chips in the DOM while scrolling (saw ${most})`);
});

// ------------------------------------------------------------------------------------------------ FR-LNK-02

test('fr_lnk_02_ac6_janas_panel_and_clearing_a_relation', async ({ page }) => {
  await openLinks(page, B.jana);
  assert.equal(await badge(page), '3');
  assert.deepEqual(await entriesIn(page, 'Pages'), ['Cíl']);
  assert.deepEqual(await entriesIn(page, 'Schůzky'), ['2026-10-08 Porada', 'Starší porada']);
  await gotoNote(page, '2026-10-08 Porada');
  await (await must(props(page).getByRole('button', { name: 'Remove Jana Nováková', exact: true }), 'Remove Jana Nováková')).click();
  assert.ok(await seen(page.getByRole('status', { name: 'Save state' }).filter({ hasText: 'Saved' }), 4000), 'Saved');
  await gotoNote(page, 'Jana Nováková');
  assert.equal(await eventually(() => badge(page), (b) => b === '2', 1000), '2', '2 within 1 s');
});

