// MS4 slice 4A, L5 (WebKit + fake core): the Backlinks panel. FR-LNK-01 AC-1, AC-2 (panel = query), AC-3…AC-6, AC-7
// (Dvojník panels), AC-9, AC-10, AC-11 (one case), AC-13…AC-15, AC-16 (DOM part); FR-LNK-02 AC-4…AC-6. docs/acceptance/backlinks.md
// (R15, R16); interface docs/contracts/ms4-links.md §4–§6. Written from the ACs and the contract only (D-61). Every
// lookup goes through `must`/node:assert with short timeouts, so a missing panel fails an assertion (TS-I1).
import { test, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import {
  B, CIL_SOURCES, backlinksPanel, backlinksTab, callsOf, contextPanel, description, editorBody, entries, entriesIn, entry, eventually,
  excerptTexts, excerpts, fileText, flat, focus, gotoNote, groupHeader, groups, linksVault, more, must, mustBeOn, mustPanel, openLinks,
  panelHeading, props, runCommand, seen, sleep, sourceRegion, swap, writeCalls,
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

test('fr_lnk_01_ac4_excerpts_of_odkazy_v_textu_and_markdown_odkaz', async ({ page }) => {
  await openLinks(page, B.cil);
  const e = await must(entry(page, 'Odkazy v textu'), 'entry Odkazy v textu');
  await (await must(more(e), 'Show 2 more')).click();
  const t = await eventually(() => excerptTexts(e), (x) => x.length === 5);
  assert.deepEqual(t.slice(0, 4), ['Viz Cíl a také jiný text ve stejném odstavci.', 'Bod s odkazem Cíl › Úvod', 'Nadpis s Cíl', 'řádek · v tabulce']);
  assert.ok(t[4].startsWith('…') && t[4].endsWith('…'), `the long paragraph is cut on both sides: ${t[4]}`);
  assert.ok(t[4].replace(/…/g, '').trim().length <= 160, 'at most 160 characters');
  assert.equal(await excerpts(e).first().locator('[data-link-here]').count(), 2, 'both chips in (1) point here');
  for (const x of await excerpts(e).all()) assert.equal(await x.getAttribute('data-occurrence'), 'body');
  assert.equal(await e.locator('[data-link-kind]').evaluateAll((cs) => cs.filter((c) => c.matches('a[href], [role="link"]') || c.getAttribute('tabindex') === '0').length), 0, 'chips are not links of their own (AP-208)');
  const m = await must(entry(page, 'Markdown odkaz'), 'entry Markdown odkaz');
  assert.deepEqual(await excerptTexts(m), ['Markdownový odkaz první.', 'Kódovaný odkaz druhý.']);
});

test('fr_lnk_01_ac5_three_excerpts_then_show_more_not_remembered', async ({ page }) => {
  await openLinks(page, B.cil);
  for (const title of ['Odkazy v textu', '2026-10-08 Porada']) {
    const e = await must(entry(page, title), `entry ${title}`);
    assert.equal(await excerpts(e).count(), 3, `${title}: 3 excerpts`);
    const b = await must(more(e), `${title}: Show 2 more`);
    assert.equal(flat(await b.innerText()), 'Show 2 more');
    await b.focus();
    await page.keyboard.press('Enter');
    assert.equal(await eventually(() => excerpts(e).count(), (n) => n === 5), 5, `${title}: all 5 in place`);
    const f = await focus(page);
    assert.equal(f.name, flat(await excerpts(e).nth(3).innerText()), `${title}: focus on the 4th excerpt`);
  }
  await gotoNote(page, 'Osamělá');
  await gotoNote(page, 'Cíl');
  const again = await must(entry(page, 'Odkazy v textu'), 'entry after switching back');
  assert.equal(await excerpts(again).count(), 3, 'the expansion is not remembered');
});

test('fr_lnk_01_ac6_excerpt_opens_the_source_at_the_mention_and_back_restores', async ({ page }) => {
  const core = await openLinks(page, B.cil);
  const panel = await mustPanel(page);
  await panel.evaluate((el) => { el.scrollTop = 120; });
  const scroll = await panel.evaluate((el) => el.scrollTop);
  const e = await must(entry(page, 'Odkazy v textu'), 'entry Odkazy v textu');
  await excerpts(e).nth(1).click();
  await mustBeOn(page, 'Odkazy v textu', 'excerpt (2) opens the source', 5000);
  const opened = (await callsOf(core, 'nav_opened')).map((c) => (c.args as any)?.path);
  assert.ok(opened.includes(B.odkazy), 'recorded with nav_opened (D-138)');
  const caret = await page.evaluate(() => {
    const s = window.getSelection();
    const n = s?.anchorNode;
    const el = (n && (n.nodeType === 1 ? (n as Element) : n.parentElement)) as Element | null;
    return el?.closest('li')?.textContent ?? null;
  });
  assert.ok(caret && caret.includes('Bod s odkazem'), `caret in the list item with [[Cíl#Úvod]]: ${caret}`);
  assert.ok(await seen(backlinksPanel(page), 2000), 'the panel stays open on Backlinks');
  assert.equal(flat(await panelHeading(page).first().innerText()), 'No backlinks yet', "now Odkazy v textu's backlinks");
  await page.keyboard.press('Meta+BracketLeft');
  await mustBeOn(page, 'Cíl', 'Back', 5000);
  const p2 = await mustPanel(page);
  assert.equal(await eventually(() => p2.evaluate((el) => el.scrollTop), (s) => Math.abs(s - scroll) < 2), scroll, 'scroll position restored');
});

test('fr_lnk_01_ac6_attribute_excerpt_focuses_the_property_and_read_only_opens_the_source_view', async ({ page }) => {
  await openLinks(page, B.cil);
  const porada = await must(entry(page, '2026-10-08 Porada'), 'entry Porada');
  const pozn = excerpts(porada).filter({ hasText: /^\s*Poznámka:/ });
  await (await must(pozn, 'Poznámka excerpt')).click();
  await mustBeOn(page, '2026-10-08 Porada', 'opens Porada', 5000);
  await must(props(page), 'Properties region in view');
  const f = await eventually(() => focus(page), (x) => x.name === 'Poznámka');
  assert.equal(f.name, 'Poznámka', 'focus on the Poznámka value control');
  await page.keyboard.press('Meta+BracketLeft');
  await mustBeOn(page, 'Cíl', 'Back', 5000);
  const nep = await must(entry(page, 'Neplatná hlavička'), 'entry Neplatná hlavička');
  await excerpts(nep).first().click();
  await mustBeOn(page, 'Neplatná hlavička', 'opens Neplatná hlavička', 5000);
  await must(sourceRegion(page), 'source view (NFR-REL-03 AC-3)');
  const line = sourceRegion(page).locator('[data-line="6"]');
  assert.ok(await seen(line, 2000) && (await line.isVisible()), "the link's line in view");
});

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
  await core.setFile('.tegg/types/schůzka.yml', swap(await fileText(core, '.tegg/types/schůzka.yml'), 'name: Poznámka', 'name: Komentář'));
  const porada = entry(page, '2026-10-08 Porada');
  const labels = await eventually(() => excerptTexts(porada), (t) => t.some((x) => x.startsWith('Komentář:')), 2000);
  assert.ok(labels.some((x) => x.startsWith('Komentář: Připravit Cíl předem')), `label follows the schema: ${labels.join(' | ')}`);
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

test('fr_lnk_01_ac11_lower_case_and_nfd_links_give_three_excerpts', async ({ page }) => {
  await openLinks(page, B.cil);
  const e = await must(entry(page, 'Rychlá poznámka'), 'entry Rychlá poznámka');
  assert.equal(await excerpts(e).count(), 3, '[[cíl]], NFD [[Cíl]], ![[Cíl]]');
  assert.deepEqual(await excerpts(e).evaluateAll((xs) => xs.map((x) => x.getAttribute('data-occurrence'))), ['body', 'body', 'embed']);
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
  assert.deepEqual(await eventually(() => focus(page), (f) => f.role === 'link'), { role: 'link', name: 'Odkazy v textu', inPanel: true, inBody: false }, "focus on the first entry's title link");
  await page.keyboard.press('Shift+Tab');
  assert.equal((await focus(page)).name, 'Pages, 4', 'Shift+Tab: the group header before it');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  assert.equal((await focus(page)).name, flat(await excerpts(entry(page, 'Odkazy v textu')).first().innerText()), 'then its first excerpt');
  const header = await must(groupHeader(page, 'Pages'), 'Pages header');
  await header.focus();
  await page.keyboard.press('Enter');
  assert.equal(await header.getAttribute('aria-expanded'), 'false', 'Enter collapses');
  assert.ok(await absent(entry(page, 'Odkazy v textu'), 1000), 'entries hidden');
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
    for (const b of await backlinksPanel(page).getByRole('button', { name: /^Show \d+ more$/ }).all()) await b.click();
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
    most = Math.max(most, await backlinksPanel(page).getByRole('article').count());
  }
  assert.ok(most > 0 && most <= 100, `at most 100 entry elements in the DOM while scrolling (saw ${most})`);
});

// ------------------------------------------------------------------------------------------------ FR-LNK-02

test('fr_lnk_02_ac4_attribute_excerpts_with_their_names', async ({ page }) => {
  await openLinks(page, B.cil);
  const p = await must(entry(page, '2026-10-08 Porada'), 'entry Porada');
  assert.deepEqual(await excerptTexts(p), ['Téma: Cíl', 'Poznámka: Připravit Cíl předem', 'Description: Souvisí s Cíl']);
  await (await must(more(p), 'Show 2 more')).click();
  assert.deepEqual(await eventually(() => excerptTexts(p), (t) => t.length === 5), ['Téma: Cíl', 'Poznámka: Připravit Cíl předem', 'Description: Souvisí s Cíl', 'Source: Cíl', 'Probrali jsme Cíl.']);
  assert.deepEqual(await excerpts(p).evaluateAll((xs) => xs.map((x) => x.getAttribute('data-occurrence'))), ['attribute', 'attribute', 'attribute', 'attribute', 'body']);
  assert.deepEqual(await excerptTexts(await must(entry(page, 'Bez typu s vlastností'), 'entry Bez typu')), ['související: Cíl'], 'raw key');
  const s = await must(entry(page, 'Starší porada'), 'entry Starší porada');
  assert.deepEqual(await excerptTexts(s), ['Účastníci: Jana Nováková, Cíl']);
  assert.deepEqual(await excerpts(s).first().locator('[data-link-here]').allInnerTexts(), ['Cíl'], 'only the Cíl chip is here');
});

test('fr_lnk_02_ac5_embed_marker_and_embed_in_a_value', async ({ page }) => {
  const v = linksVault((f) => { f[B.osamela] = swap(f[B.osamela], 'title: Osamělá\n', 'title: Osamělá\nsource: "![[Cíl]]"\n'); });
  await openLinks(page, B.cil, { vault: v });
  const r = await must(entry(page, 'Rychlá poznámka'), 'entry Rychlá poznámka');
  const third = excerpts(r).nth(2);
  assert.equal(await third.getAttribute('data-occurrence'), 'embed');
  assert.match(flat(await third.innerText()), /^Embed ?Cíl$/, 'the visible marker Embed before the chip');
  assert.equal((await entries(page)).filter((t) => t === 'Rychlá poznámka').length, 1, 'one entry');
  const o = await must(entry(page, 'Osamělá'), 'entry Osamělá');
  assert.equal(await excerpts(o).first().getAttribute('data-occurrence'), 'attribute', '![[…]] in a value is an attribute excerpt');
  assert.ok(!flat(await excerpts(o).first().innerText()).includes('Embed'), 'without the marker');
});

test('fr_lnk_02_ac6_janas_panel_and_clearing_a_relation', async ({ page }) => {
  await openLinks(page, B.jana);
  assert.equal(await badge(page), '3');
  assert.deepEqual(await entriesIn(page, 'Pages'), ['Cíl']);
  assert.deepEqual(await entriesIn(page, 'Schůzky'), ['2026-10-08 Porada', 'Starší porada']);
  assert.deepEqual(await excerptTexts(entry(page, 'Cíl')), ['Odkaz ven: Jana Nováková']);
  assert.deepEqual(await excerptTexts(entry(page, '2026-10-08 Porada')), ['Účastníci: Jana Nováková']);
  assert.deepEqual(await excerptTexts(entry(page, 'Starší porada')), ['Účastníci: Jana Nováková, Cíl']);
  await gotoNote(page, '2026-10-08 Porada');
  await (await must(props(page).getByRole('button', { name: 'Remove Jana Nováková', exact: true }), 'Remove Jana Nováková')).click();
  assert.ok(await seen(page.getByRole('status', { name: 'Save state' }).filter({ hasText: 'Saved' }), 4000), 'Saved');
  await gotoNote(page, 'Jana Nováková');
  assert.equal(await eventually(() => badge(page), (b) => b === '2', 1000), '2', '2 within 1 s');
});

