// Slice REL, L5 (WebKit + fake core): the Related tab (docs/acceptance/related.md R178, R182, R183): FR-LNK-15 AC-21 (the
// tab, second of Backlinks · Related · Graph, D-1699), AC-22 (entries are Backlinks chips in one flat list), AC-23 (the
// excerpt: plain, clamped, not clickable), AC-24 (one empty state), AC-26 (the chips preview and open as Backlinks
// chips), AC-31 (which routes), FR-NAV-05 AC-6 (`Show related`) and AC-7 (the tab is remembered). Interface
// docs/contracts/v1-related.md §2, §3 (DOM hooks of §3.3), §6 (fake core); fixture tests/fixtures/vaults/related (its
// README's expected lists and excerpts). Written from the ACs and the contract only (D-61). Every lookup goes through
// `must`/`seen` and node:assert, so a missing element is an AssertionError (TS-I1).
import { test, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import {
  R, TITLE, ZONE, anyPreviewDialog, backlinksTab, boxOf, callsOf, chipOf, click, ctxPanel, description, drawn, drawnPaths, emptyText, entry, entryAt,
  entryItems, eventually, excerptOf, flat, focusName, graphTab, hv, linkedSwitch, mainName, must, mustBeOn, mustPreview, navOpened, nfc, noteRoute, onlyEmpty,
  openFromSearch, openRelated, paletteDialog, paletteOptions, pathsWhen, pauseClock, relCalls, relList, relPanel, relTab, runCommand, runFor, seen, setWhen,
  sleep, startRelated, switchPreviewMode, tabsOf, tokenRgb, uiSetCalls, vaultWrites, type FakeCoreHandle,
} from './related-helpers';

test.use({ timezoneId: ZONE, locale: 'en-US' });

const tabNames = async (page: Page) =>
  (await tabsOf(page).evaluateAll((els) => els.map((e) => (e.getAttribute('aria-label') ?? e.textContent ?? '').replace(/\s+/g, ' ').trim()))).map(nfc);
const since = async (core: FakeCoreHandle, from: number) => (await core.calls()).slice(from).filter((c) => !c.cmd.startsWith('plugin:event|'));
const selected = async (page: Page) => (await relTab(page).getAttribute('aria-selected').catch(() => null)) === 'true';

// ------------------------------------------------------------------------------------------------ FR-LNK-15 AC-21

test('fr_lnk_15_ac21_related_tab', async ({ page }) => {
  const core = await startRelated(page, noteRoute(R.rozpocet), { tab: 'backlinks' });
  await must(backlinksTab(page), 'tab "Backlinks"');
  const names = await tabNames(page);
  assert.equal(names.length, 3, `three tabs: ${names}`);
  assert.ok(/^Backlinks/.test(names[0]) && names[1] === 'Related' && /^Graph/.test(names[2]), `Backlinks, Related, Graph in this order (D-1699): ${names}`);
  const tab = await must(relTab(page), 'tab "Related"');
  assert.equal(await tab.getAttribute('data-command'), 'panel.related', 'data-command="panel.related"');
  assert.equal(flat(await tab.innerText()), 'Related', 'no badge, no count');
  assert.ok(!/\d/.test((await tab.getAttribute('aria-description')) ?? ''), 'no aria-description with a number');
  const from = (await core.calls()).length;
  const navs = (await navOpened(core)).length;
  await tab.click();
  assert.deepEqual(await pathsWhen(page, [R.den, R.ukol]), [R.den, R.ukol], 'it shows 2 entries');
  const calls = await since(core, from);
  const rel = calls.filter((c) => c.cmd === 'index_related');
  assert.deepEqual(rel.map((c) => c.args), [{ path: R.rozpocet, showLinked: false }], 'one index_related with exactly { path, showLinked: false }');
  const sets = calls.filter((c) => c.cmd === 'ui_state_set');
  assert.equal(sets.length, 1, 'one ui_state_set');
  assert.equal((sets[0]?.args as any)?.state?.rightPanel?.tab, 'related', 'storing rightPanel.tab: related');
  assert.equal((await navOpened(core)).length, navs, 'showing the tab calls nav_opened zero times');
});

// ------------------------------------------------------------------------------------------------ FR-LNK-15 AC-22

test('fr_lnk_15_ac22_entries_are_chips_in_one_flat_list', async ({ page }) => {
  const core = await openRelated(page, R.rozpocet);
  await must(relList(page), 'list "Related notes"');
  assert.equal(await eventually(() => entryItems(page).count(), (n) => n === 2), 2, 'exactly 2 listitems');
  const d = await drawn(page);
  assert.deepEqual(d.map((x) => x.path), [R.den, R.ukol], 'in the order the core returned: Den 30. 9., then Úkol');
  assert.equal(await relPanel(page).getByRole('heading').count(), 0, 'no group headers or count headings');
  const text = flat(await relPanel(page).innerText());
  for (const w of ['Daily Notes', 'Daily Note', 'Tasks', 'Pages', ' 2 ']) assert.ok(!text.includes(w), `no type names or counts (${w}): ${text}`);
  // The chips: as on the Backlinks tab (D-600, D-633).
  const chip = async (path: string) => must(chipOf(page, path), `${path}: the chip`);
  const icon = async (path: string) => (await chip(path)).evaluate((a) => a.getAttribute('data-icon') ?? a.querySelector('svg[data-icon]')?.getAttribute('data-icon') ?? null);
  assert.equal(await icon(R.den), 'calendar', 'Den 30. 9.: the Daily Note icon');
  assert.equal(await (await chip(R.den)).getAttribute('aria-label'), '2026-09-30', 'Den 30. 9.: 2026-09-30');
  const ukolIcon = await icon(R.ukol);
  assert.ok(ukolIcon && !['file-text', 'calendar'].includes(ukolIcon), `Úkol: a task icon (${ukolIcon})`);
  const suffix = await (await chip(R.ukol)).evaluate((a) => (a.querySelector('.chip-suffix') as HTMLElement | null)?.innerText.replace(/\s+/g, ' ').trim() ?? null);
  // D-1750 (B-4): the en-US label of the shared chip code under the test clock's region, as a Backlinks chip shows it.
  assert.equal(suffix, 'Fri, Nov 27 · To do', 'Úkol: the suffix Fri, Nov 27 · To do (R44 label, en-US region)');
  for (const p of [R.den, R.ukol]) {
    const a = await chip(p);
    assert.deepEqual([await a.getAttribute('data-link-kind'), await a.getAttribute('tabindex'), await a.getAttribute('data-command')], ['note', '0', 'panel.related.open'], `${p}: a.chip.link-chip (§3.3)`);
    assert.ok(await a.evaluate((e) => e.classList.contains('chip') && e.classList.contains('link-chip')), `${p}: class chip link-chip`);
  }
  // The tab shows exactly what index_related returned.
  const last = (await callsOf(core, 'index_related')).at(-1)?.result as any;
  assert.deepEqual(d.map((x) => [x.path, x.title, x.excerpt]), (last?.entries ?? []).map((e: any) => [e.path, e.title, e.excerpt]), 'the drawn list is the core\'s answer');
  // Hover: the whole entry gets --hover.
  const li = entryAt(page, R.den);
  await li.hover();
  await sleep(150);
  assert.equal(await li.evaluate((e) => getComputedStyle(e).backgroundColor), await tokenRgb(page, '--hover'), 'a hovered entry has the --hover background');
  // On Termíny, Školení's chip has the amber ring and the description Unreviewed. D-1752 (B-6): Termíny is opened by its
  // route, since Search ranks its unaccented twin first.
  const tp = await page.context().newPage();
  const tc = await openRelated(tp, R.terminyA);
  await pathsWhen(tp, [R.terminyB, R.skoleni]);
  const sk = await must(chipOf(tp, R.skoleni), `${R.skoleni}: the chip`);
  assert.equal(await sk.getAttribute('data-review'), 'unreviewed', 'Školení: data-review="unreviewed" (the amber ring)');
  assert.ok((await description(sk)).includes('Unreviewed'), 'Školení: the description Unreviewed');
  // A 120-character title wraps inside the 288 px panel (backlinks.md FR-LNK-01 AC-25).
  const long = 'Velmi dlouhý název poznámky o přípravě podkladů pro celoroční plánování celého týmu a všech jeho projektů v příštím roce';
  assert.equal(long.length >= 115 && long.length <= 125, true, 'setup: about 120 characters');
  await tc.relatedAnswer(R.terminyA, 'both', { entries: [entry('Pages/Dlouhý název.md', { title: long, excerpt: 'Krátká věta.' })], reason: null });
  await tc.emit('vault:changed', { paths: [] });
  const lc = await must(chipOf(tp, 'Pages/Dlouhý název.md'), 'the long title\'s chip', 4000);
  const pb = await boxOf(relPanel(tp), 'the tab panel');
  const cb = await boxOf(lc, 'the long chip');
  assert.ok(cb.width <= pb.width + 0.5 && cb.height > 30, `it wraps inside the panel (chip ${cb.width}×${cb.height}, panel ${pb.width})`);
  assert.equal(await lc.getAttribute('title'), long, 'title = the full title');
});

// ------------------------------------------------------------------------------------------------ FR-LNK-15 AC-23

test('fr_lnk_15_ac23_excerpt_plain_clamped_not_clickable', async ({ page }) => {
  const core = await openRelated(page, R.rozpocet);
  await pathsWhen(page, [R.den, R.ukol]);
  const ex = await must(excerptOf(page, R.ukol), 'Úkol\'s p[data-related-excerpt]');
  assert.equal(nfc(await ex.innerText()), nfc('Do pá 27. 11. musí návrh rozpočtu na offsite projít přes finance, Jana ho podepíše.'), 'the whole sentence');
  const props = await ex.evaluate((p) => ({
    tag: p.tagName, role: p.getAttribute('role'), tabindex: p.getAttribute('tabindex'), marks: p.querySelectorAll('mark, strong, em, b, i').length,
    afterChip: !!p.previousElementSibling && !!p.parentElement?.querySelector('a[data-link-kind="note"]'), link: !!p.closest('a'),
  }));
  assert.deepEqual(props, { tag: 'P', role: null, tabindex: null, marks: 0, afterChip: true, link: false }, 'a plain p under the chip: no link role, no tabindex, no mark/strong/em');
  // A 600-character sentence is clamped to 3 lines.
  const sentence = `${'Dlouhá věta o rozpočtu, ubytování, letenkách a nákladech na offsite v Lisabonu, kterou Jana pošle financím '.repeat(6)}a konec.`.slice(0, 597) + 'cí.';
  await core.relatedAnswer(R.rozpocet, false, { entries: [entry(R.den, { excerpt: sentence, title: '2026-09-30', type: 'daily-note' }), entry(R.ukol, { excerpt: null })], reason: null });
  await core.emit('vault:changed', { paths: [] });
  await eventually(() => excerptOf(page, R.den).innerText().catch(() => ''), (t) => t.length > 500, 4000);
  const clamp = await excerptOf(page, R.den).evaluate((p) => {
    const cs = getComputedStyle(p);
    const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.4;
    return { clamp: cs.getPropertyValue('-webkit-line-clamp'), overflow: cs.overflow, h: p.getBoundingClientRect().height, lh, text: p.textContent ?? '', clipped: p.scrollHeight > p.clientHeight };
  });
  assert.equal(clamp.clamp, '3', 'computed -webkit-line-clamp: 3');
  assert.ok(clamp.h <= 3 * clamp.lh + 1, `no taller than 3 lines + 1 px (${clamp.h} vs ${clamp.lh})`);
  assert.ok(clamp.clipped && clamp.overflow === 'hidden', 'clipped, ending in … (WebKit\'s line clamp)');
  assert.equal(nfc(clamp.text), nfc(sentence), 'the p\'s text content is the whole sentence');
  assert.equal(await excerptOf(page, R.ukol).count(), 0, 'an entry whose excerpt is null has no p');
  // A click on the excerpt does nothing, in each preview mode.
  for (const mode of ['hover', 'click', 'off'] as const) {
    if (mode !== 'hover') await switchPreviewMode(page, core, mode);
    const before = await mainName(page);
    const from = (await core.calls()).length;
    await excerptOf(page, R.den).click();
    await sleep(1300);
    assert.equal(await mainName(page), before, `${mode}: no route change`);
    assert.equal(await anyPreviewDialog(page).count(), 0, `${mode}: no preview`);
    assert.deepEqual((await since(core, from)).map((c) => c.cmd).filter((c) => c !== 'perf_mark'), [], `${mode}: no command sent`); // test-build timing marks aside, as editor and embeds tests (D-1758)
  }
});

// ------------------------------------------------------------------------------------------------ FR-LNK-15 AC-24

test('fr_lnk_15_ac24_one_empty_state', async ({ page }) => {
  for (const [what, path] of [['no match', R.svatba], ['no match', R.tura], ['short', R.buben], ['short', R.mleko], ['short', R.prazdna], ['every candidate linked', R.zahrada]] as const) {
    const p = await page.context().newPage();
    await openRelated(p, path);
    assert.ok(await onlyEmpty(p), `${what} (${path}): the switch and No related notes, nothing else`);
    assert.ok(!(await p.content()).includes('Not enough text to find related notes'), `${path}: no second message (D-1697)`);
    await p.close();
  }
  for (const route of ['new/page', 'daily/2026-11-14']) {
    const p = await page.context().newPage();
    const c = await startRelated(p, route);
    await must(relPanel(p), `${route}: the Related tab`);
    assert.ok(await onlyEmpty(p), `${route}: No related notes`);
    assert.deepEqual(await relCalls(c), [], `${route}: no index_related`);
    await p.close();
  }
  // Svatba trashed by another program while shown.
  const core = await openRelated(page, R.svatba);
  assert.ok(await onlyEmpty(page), 'Svatba: empty');
  await core.relatedAnswer(R.svatba, 'both', { entries: [entry(R.vcelstvo, { title: 'Včelstvo na zimu', excerpt: 'Věta.' })], reason: null });
  await core.emit('vault:changed', { paths: [] });
  assert.deepEqual(await pathsWhen(page, [R.vcelstvo], 3000), [R.vcelstvo], 'setup: Svatba shows an entry');
  await core.renameFile(R.svatba, `.trash/${R.svatba}`);
  assert.ok(await onlyEmpty(page, 2000), 'the file trashed by another program: No related notes within 2 s');
  // On Buben, turning the switch on sends one ui_state_set and keeps the empty state.
  const p = await page.context().newPage();
  const c = await openRelated(p, R.buben);
  const before = (await uiSetCalls(c)).length;
  await click(linkedSwitch(p), 'switch "Show linked notes"');
  assert.equal(await eventually(async () => (await uiSetCalls(c)).length, (n) => n === before + 1), before + 1, 'one ui_state_set');
  assert.ok(await onlyEmpty(p), 'Buben with the switch on: still No related notes');
});

// ------------------------------------------------------------------------------------------------ FR-LNK-15 AC-26

async function routeWhen(core: FakeCoreHandle, from: number, want: RegExp, ms = 3000) {
  return eventually(async () => (await navOpened(core)).slice(from).map((a) => String(a?.route ?? a?.path ?? '')), (r) => r.some((x) => want.test(nfc(x))), ms);
}

test('fr_lnk_15_ac26_chips_preview_and_open_as_backlinks', async ({ page }) => {
  // Hover to preview (the default): 1,000 ms, beside the panel; a click opens; Back keeps the tab and its scroll.
  const many = [3, 4, 5, 6, 7, 8, 9, 10].map((k) => entry(hv(k), { title: `Hvězda ${String(k).padStart(2, '0')}`, excerpt: 'Pozorování: teleskopem.' }));
  const core = await startRelated(page, noteRoute(R.rozpocet));
  await core.relatedAnswer(R.rozpocet, false, { entries: [...many, entry(R.den, { title: '2026-09-30', type: 'daily-note', excerpt: 'Zítra.' }), entry(R.ukol, { excerpt: 'Do pá.' })], reason: null });
  await core.emit('vault:changed', { paths: [] });
  await eventually(drawnPaths.bind(null, page), (p) => p.length === 10, 4000);
  const den = await must(chipOf(page, R.den), 'Den 30. 9.\'s chip');
  await den.scrollIntoViewIfNeeded();
  const scroll = await relPanel(page).evaluate((e) => e.scrollTop);
  await pauseClock(page);
  await den.hover();
  await runFor(page, 940);
  assert.equal(await anyPreviewDialog(page).count(), 0, 'no preview before 1,000 ms');
  await runFor(page, 110);
  const pv = await mustPreview(page, '2026-09-30', 'Preview: 2026-09-30 after 1,000 ms (± 50 ms)', 1000);
  await page.clock.resume();
  const panelBox = await boxOf(ctxPanel(page), 'the panel');
  const pvBox = await boxOf(pv, 'the preview');
  assert.ok(pvBox.x + pvBox.width <= panelBox.x + 1, 'the preview is to the left of the panel (previews.md FR-LNK-08 AC-4)');
  await page.mouse.move(10, 450);
  await page.keyboard.press('Escape');
  const navFrom = (await navOpened(core)).length;
  await den.click();
  const r = await routeWhen(core, navFrom, /^daily\/2026-09-30$|^Daily\/2026-09-30\.md$/);
  assert.equal(r.length, 1, `one nav_opened, for daily/2026-09-30: ${r}`);
  assert.ok(await selectedOrWait(page), 'the panel stays on Related');
  assert.ok(sameSet(await setWhen(page, [R.ukol, R.rozpocet]), [R.ukol, R.rozpocet]), 'and shows Den 30. 9.\'s own list {Rozpočet, Úkol}');
  await page.keyboard.press('Meta+BracketLeft');
  await mustBeOn(page, TITLE[R.rozpocet], '⌘[ returns to Rozpočet');
  await eventually(drawnPaths.bind(null, page), (p) => p.length === 10, 3000);
  assert.ok(await selectedOrWait(page), 'with the panel on Related');
  assert.ok(Math.abs((await relPanel(page).evaluate((e) => e.scrollTop)) - scroll) <= 1, 'and its scroll position kept');
  // Click to preview: a click previews; a double-click and ⌘↩ open; ⏎ previews.
  await switchPreviewMode(page, core, 'click');
  const den2 = await must(chipOf(page, R.den), 'Den 30. 9.\'s chip');
  await den2.click();
  await mustPreview(page, '2026-09-30', 'click mode: a click previews');
  await page.keyboard.press('Escape');
  await den2.focus();
  await page.keyboard.press('Enter');
  await mustPreview(page, '2026-09-30', 'click mode: ⏎ previews');
  await page.keyboard.press('Escape');
  let from = (await navOpened(core)).length;
  await den2.dblclick();
  assert.equal((await routeWhen(core, from, /2026-09-30/)).length >= 1, true, 'click mode: a double-click opens');
  await page.keyboard.press('Meta+BracketLeft');
  await eventually(drawnPaths.bind(null, page), (p) => p.length === 10, 3000);
  from = (await navOpened(core)).length;
  await (await must(chipOf(page, R.den), 'the chip')).focus();
  await page.keyboard.press('Meta+Enter');
  assert.equal((await routeWhen(core, from, /2026-09-30/)).length >= 1, true, 'click mode: ⌘↩ opens');
  await page.keyboard.press('Meta+BracketLeft');
  await eventually(drawnPaths.bind(null, page), (p) => p.length === 10, 3000);
  // ⌥Space previews in every mode.
  for (const mode of ['click', 'off', 'hover'] as const) {
    if (mode !== 'click') await switchPreviewMode(page, core, mode);
    await (await must(chipOf(page, R.den), 'the chip')).focus();
    await page.keyboard.press('Alt+Space');
    await mustPreview(page, '2026-09-30', `${mode}: ⌥Space previews`);
    await page.keyboard.press('Escape');
  }
  // Off: a click opens.
  await switchPreviewMode(page, core, 'off');
  from = (await navOpened(core)).length;
  await (await must(chipOf(page, R.den), 'the chip')).click();
  assert.equal((await routeWhen(core, from, /2026-09-30/)).length >= 1, true, 'off: a click opens');
  assert.deepEqual(await vaultWrites(core), [], 'nothing is written');
});
async function selectedOrWait(page: Page) {
  return eventually(() => selected(page), (s) => s, 2000);
}

// ------------------------------------------------------------------------------------------------ FR-LNK-15 AC-31

test('fr_lnk_15_ac31_routes_with_the_related_tab', async ({ page }) => {
  for (const route of ['daily/2026-09-30', 'new/page']) {
    const p = await page.context().newPage();
    await startRelated(p, route);
    await must(relPanel(p), `${route}: the Related tab`, 5000);
    await p.close();
  }
  await startRelated(page, 'daily/2026-09-30');
  assert.ok(sameSet(await setWhen(page, [R.rozpocet, R.ukol]), [R.rozpocet, R.ukol]), 'daily/2026-09-30: Den 30. 9.\'s list');
  for (const path of [R.ul, R.navod]) {
    const p = await page.context().newPage();
    await openRelated(p, path);
    assert.deepEqual(await pathsWhen(p, [R.vcelstvo]), [R.vcelstvo], `${path}: [Včelstvo]`);
    await p.close();
  }
  for (const route of ['tag/včelaření', `graph/${R.rozpocet}`, 'search', 'tasks', 'type/page']) {
    const p = await page.context().newPage();
    await startRelated(p, route, { wait: false });
    await sleep(800);
    assert.equal(await ctxPanel(p).count(), 0, `${route}: no panel`);
    await p.keyboard.press('Meta+Backslash');
    await sleep(300);
    assert.equal(await ctxPanel(p).count(), 0, `${route}: ⌘\\ does nothing`);
    await p.close();
  }
});
const sameSet = (a: string[], b: string[]) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());

// ------------------------------------------------------------------------------------------------ FR-NAV-05 AC-6

test('fr_nav_05_ac6_show_related_opens_the_tab', async ({ page }) => {
  const core = await startRelated(page, noteRoute(R.rozpocet), { open: false, tab: 'backlinks' });
  assert.equal(await relPanel(page).count(), 0, 'setup: the panel is closed');
  const sets = (await uiSetCalls(core)).length;
  await runCommand(page, 'Show related');
  await must(relPanel(page), 'the Context panel on Related', 3000);
  await pathsWhen(page, [R.den, R.ukol]);
  assert.deepEqual(await eventually(() => focusName(page), (f) => f.name === '2026-09-30'), { role: 'link', name: '2026-09-30' }, 'the focus is on Den 30. 9.\'s chip');
  const writes = (await uiSetCalls(core)).slice(sets);
  assert.equal(writes.length, 1, 'one write');
  assert.deepEqual([writes[0]?.rightPanel?.open, writes[0]?.rightPanel?.tab], [true, 'related'], 'rightPanel.open: true, tab: related');
  // With the panel open on Graph, it switches to Related.
  const p2 = await page.context().newPage();
  await startRelated(p2, noteRoute(R.rozpocet), { tab: 'graph' });
  await must(graphTab(p2), 'the Graph tab');
  await runCommand(p2, 'Show related');
  assert.ok(await eventually(async () => (await relTab(p2).getAttribute('aria-selected')) === 'true', (x) => x, 3000), 'the panel switches to Related');
  await p2.close();
  // On Svatba (no entries), the focus goes to the switch.
  const p3 = await page.context().newPage();
  await startRelated(p3, noteRoute(R.svatba), { open: false });
  await runCommand(p3, 'Show related');
  assert.deepEqual(await eventually(() => focusName(p3), (f) => f.role === 'switch'), { role: 'switch', name: 'Show linked notes' }, 'Svatba: the focus is on the switch');
  await p3.close();
  // Listed on note, daily and new; not on tag, graph, search or tasks.
  for (const [route, listed] of [[noteRoute(R.rozpocet), true], ['daily/2026-09-30', true], ['new/page', true], ['tag/včelaření', false], [`graph/${R.rozpocet}`, false], ['search', false], ['tasks', false]] as const) {
    const p = await page.context().newPage();
    await startRelated(p, route, { wait: false });
    await sleep(500);
    await p.keyboard.press('Meta+k');
    await must(paletteDialog(p), `${route}: the palette`);
    await p.getByRole('combobox', { name: 'Command query' }).fill('Show related');
    await sleep(300);
    const opts = (await paletteOptions(p)).map(flat);
    assert.equal(opts.some((o) => o.startsWith('Show related')), listed, `${route}: Show related ${listed ? 'is' : 'is not'} listed (${opts})`);
    await p.close();
  }
});

// ------------------------------------------------------------------------------------------------ FR-NAV-05 AC-7

test('fr_nav_05_ac7_related_tab_remembered', async ({ page }) => {
  const core = await openRelated(page, R.rozpocet);
  const files = await core.files();
  await pathsWhen(page, [R.den, R.ukol]);
  await openFromSearch(page, 'Hiking', TITLE[R.hiking]);
  assert.ok(await selectedOrWait(page), 'opening another note keeps the Related tab');
  assert.deepEqual(await pathsWhen(page, [R.trail, R.gear]), [R.trail, R.gear], 'with Hiking\'s list');
  await page.keyboard.press('Meta+Backslash');
  await sleep(300);
  await page.keyboard.press('Meta+Backslash');
  assert.ok(await selectedOrWait(page), '⌘\\ twice keeps the Related tab');
  await page.keyboard.press('Meta+Shift+Backslash');
  await sleep(300);
  await page.keyboard.press('Meta+Shift+Backslash');
  assert.ok(await selectedOrWait(page), 'focus mode on and off keeps the Related tab');
  assert.equal((await core.uiState())?.rightPanel?.tab, 'related', 'the stored tab is related');
  for (const stored of ['outline', 'kalendář']) {
    const p = await page.context().newPage();
    await startRelated(p, noteRoute(R.rozpocet), { tab: stored });
    assert.ok(await eventually(async () => (await backlinksTab(p).getAttribute('aria-selected')) === 'true', (x) => x, 3000), `a stored tab ${stored}: Backlinks`);
    await p.close();
  }
  assert.deepEqual(await core.files(), files, 'the vault\'s files are untouched');
  assert.deepEqual(await vaultWrites(core), [], 'no vault write');
});
