// Slice REL, L5 (WebKit + fake core): the Related tab over time (docs/acceptance/related.md R178; contract
// docs/contracts/v1-related.md §3.4, §3.5, §6): FR-LNK-15 AC-10 (the panel follows type and folder changes), AC-27 (the
// list follows the page; a late answer is dropped; no other object's list is ever drawn), AC-28 (live updates keep the
// focus; no request per keystroke; bursts), AC-29 (no background work), AC-30 (loading and the index not ready) and
// FR-FMT-12 AC-11 (NFD paths). Playwright's clock drives the 300 ms, 800 ms and 2 s timings where a criterion counts
// them. Written from the ACs and the contract only (D-61). Every lookup goes through `must`/`seen` and node:assert
// (TS-I1).
import { test, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import {
  R, TITLE, ZONE, chipOf, click, drawn, drawnPaths, editorBody, entry, eventually, focusName, hv, linkedSwitch, listsDrawn, loadingStatus, must, nfc,
  noteRoute, onlyEmpty, openFromSearch, openRelated, pathsWhen, pauseClock, recordLists, relCalls, relPanel, relTab, relatedVault, runFor, saved, seen, setWhen,
  sleep, startRelated, uiSetCalls, type FakeCoreHandle,
} from './related-helpers';

test.use({ timezoneId: ZONE, locale: 'en-US' });

const ROZ = [R.den, R.ukol];
const HIK = [R.trail, R.gear];
const H_HIDDEN = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(hv);
const H_SHOWN = [hv(2), hv(1), ...[3, 4, 5, 6, 7, 8, 9, 10].map(hv)];
const key = (l: string[]) => JSON.stringify(l);

// ------------------------------------------------------------------------------------------------ FR-LNK-15 AC-10 (panel)

test('fr_lnk_15_ac10_candidates_by_type_and_folder', async ({ page }) => {
  const core = await openRelated(page, R.vcelstvo);
  assert.deepEqual(await pathsWhen(page, [R.prohlidka]), [R.prohlidka], 'Včelstvo → [Prohlídka]');
  const text = await relPanel(page).innerText();
  for (const t of ['Včelaření', 'Úl u lesa', 'Návod ke krmení', 'Včelí deník', 'Starý úl']) assert.ok(!text.includes(t), `${t} never appears`);
  const orig = (await core.files())[R.prohlidka]!;
  await core.setFile(R.prohlidka, orig.replace('type: page', 'type: tag'));
  assert.ok(await onlyEmpty(page, 2000), 'Prohlídka changed to a tag by another program: Včelstvo\'s list is empty within 2 s');
  await core.setFile(R.prohlidka, orig);
  assert.deepEqual(await pathsWhen(page, [R.prohlidka], 2000), [R.prohlidka], 'restored');
  await core.relatedAnswer(R.vcelstvo, 'both', { entries: [entry(R.prohlidka, { excerpt: 'Věta.' }), entry('Pages/Starý úl.md', { excerpt: 'Věta.' })], reason: null });
  await core.renameFile('.trash/Pages/Starý úl.md', 'Pages/Starý úl.md');
  assert.ok(sameSet(await setWhen(page, [R.prohlidka, nfc('Pages/Starý úl.md')], 2000), [R.prohlidka, nfc('Pages/Starý úl.md')]), 'Starý úl moved out of the trash: {Prohlídka, Starý úl} within 2 s');
});
const sameSet = (a: string[], b: string[]) => key([...a].map(nfc).sort()) === key([...b].map(nfc).sort());

// ------------------------------------------------------------------------------------------------ FR-LNK-15 AC-27

// D-1751 (B-5): opening from Search adds a history entry (D-1217), so Hiking is opened by its route: a sidebar pin of
// Hiking (`.tegg/pinned.yml`), whose row opens `note/<path>` directly, and ⌘[ goes back to Rozpočet.
const HIKING_PIN = `version: 1\npins:\n  - id: 01JRE000000000000000000031\n    path: ${R.hiking}\n`;
async function openHikingByRoute(page: Page) {
  await click(page.locator('.sidebar-pinned [data-pinned-row]').first(), `the sidebar pin of ${TITLE[R.hiking]} (note/${R.hiking})`);
  await page.mouse.move(720, 860); // off the row, so no hover preview opens over it
}

test('fr_lnk_15_ac27_list_follows_navigation', async ({ page }) => {
  const core = await openRelated(page, R.rozpocet, { vault: relatedVault((f) => { f['.tegg/pinned.yml'] = HIKING_PIN; }) });
  await pathsWhen(page, ROZ);
  await recordLists(page);
  await openHikingByRoute(page);
  assert.deepEqual(await pathsWhen(page, HIK, 2000), HIK, 'Hiking\'s 2 entries within 2 s');
  await page.keyboard.press('Meta+BracketLeft');
  assert.deepEqual(await pathsWhen(page, ROZ, 2000), ROZ, '⌘[ shows Rozpočet\'s again');
  let lists = await listsDrawn(page);
  assert.ok(lists.every((l) => [key([]), key(ROZ), key(HIK)].includes(key(l))), `only whole lists of the shown object are drawn: ${JSON.stringify(lists)}`);
  const firstHik = lists.findIndex((l) => key(l) === key(HIK));
  const backToRoz = lists.findIndex((l, i) => i > firstHik && key(l) === key(ROZ));
  assert.ok(firstHik > 0 && backToRoz > firstHik && lists.slice(firstHik + 1, backToRoz).every((l) => key(l) !== key(ROZ)), 'no Rozpočet frame while Hiking is shown');
  // A late answer is dropped.
  await page.keyboard.press('Meta+BracketRight');
  await pathsWhen(page, HIK, 2000);
  await core.relatedDelay(800, R.rozpocet);
  await recordLists(page);
  await page.keyboard.press('Meta+BracketLeft');
  await sleep(150);
  await page.keyboard.press('Meta+BracketRight');
  assert.deepEqual(await pathsWhen(page, HIK, 2000), HIK, 'Hiking\'s list');
  await sleep(1200);
  assert.deepEqual(await drawnPaths(page), HIK, 'Rozpočet\'s late answer is dropped: still only Hiking\'s list');
  lists = await listsDrawn(page);
  assert.ok(lists.every((l) => key(l) !== key(ROZ)), `Rozpočet\'s list is never drawn, even for one frame: ${JSON.stringify(lists)}`);
  assert.ok((await relCalls(core)).some((c) => nfc(c.path) === R.rozpocet), 'setup: Rozpočet was asked');
});

// ------------------------------------------------------------------------------------------------ FR-LNK-15 AC-28

test('fr_lnk_15_ac28_live_updates_keep_focus', async ({ page }) => {
  // The user's own edit.
  const core = await openRelated(page, R.svatba);
  assert.ok(await onlyEmpty(page), 'Svatba: empty');
  await core.relatedAnswer(R.svatba, 'both', { entries: [entry(R.vcelstvo, { excerpt: 'Věta.' }), entry(R.prohlidka, { excerpt: 'Věta.' })], reason: null });
  const asked = (await relCalls(core)).length;
  const ed = await must(editorBody(page), 'the note body');
  await ed.click();
  await page.keyboard.press('Meta+ArrowDown');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Dárek: rámky, plod, pyl a dělnice pro včelstvo.', { delay: 15 });
  assert.equal((await relCalls(core)).length, asked, 'no index_related while the user types');
  assert.deepEqual(await drawnPaths(page), [], 'before Saved, the tab is unchanged');
  const inEditor = async () => page.evaluate(() => !!document.activeElement?.closest('.ProseMirror'));
  assert.ok(await inEditor(), 'the focus stays in the editor while typing');
  assert.ok(await seen(saved(page), 5000), 'Saved');
  assert.ok(sameSet(await setWhen(page, [R.vcelstvo, R.prohlidka], 2000), [R.vcelstvo, R.prohlidka]), 'within 2 s of Saved: {Včelstvo, Prohlídka}');
  assert.ok(await inEditor(), 'the focus and the caret stay in the editor');
  const caretAtEnd = await page.evaluate(() => { const s = getSelection(); return !!s && s.isCollapsed && (s.anchorNode?.textContent ?? '').trimEnd().endsWith('včelstvo.'); });
  assert.ok(caretAtEnd, 'the caret is still after the typed text');
  // Another program's changes, with Včelstvo shown.
  const p2 = await page.context().newPage();
  const c2 = await openRelated(p2, R.vcelstvo);
  await pathsWhen(p2, [R.prohlidka]);
  await c2.renameFile(R.prohlidka, `.trash/${R.prohlidka}`);
  assert.ok(await onlyEmpty(p2, 2000), 'Prohlídka moved to .trash/: No related notes within 2 s');
  await c2.renameFile(`.trash/${R.prohlidka}`, R.prohlidka);
  assert.deepEqual(await pathsWhen(p2, [R.prohlidka], 2000), [R.prohlidka], 'moved back: [Prohlídka] within 2 s');
  await p2.close();
  const p3 = await page.context().newPage();
  const c3 = await openRelated(p3, R.rozpocet);
  await pathsWhen(p3, ROZ);
  const ukol = (await c3.files())[R.ukol]!;
  await c3.setFile(R.ukol, ukol.replace('title: Poslat návrh rozpočtu financím', 'title: Poslat rozpočet'));
  const title = await eventually(async () => (await drawn(p3)).find((d) => d.path === R.ukol)?.title ?? '', (t) => t === nfc('Poslat rozpočet'), 2000);
  assert.equal(title, nfc('Poslat rozpočet'), 'Úkol\'s title change relabels its chip within 2 s');
  // Bursts: ten external changes within 500 ms cause at most 3 requests; the final list equals a fresh query.
  const before = (await relCalls(c3)).length;
  for (let i = 0; i < 10; i++) {
    await c3.emit('vault:changed', { paths: [R.svatba] });
    await sleep(45);
  }
  await sleep(1200);
  const n = (await relCalls(c3)).length - before;
  assert.ok(n >= 1 && n <= 3, `10 changes in 500 ms: 1…3 index_related calls (got ${n})`);
  const last = (await c3.calls()).filter((c) => c.cmd === 'index_related').at(-1)?.result as any;
  assert.deepEqual(await drawnPaths(p3), (last?.entries ?? []).map((e: any) => e.path), 'the final list equals the latest answer');
  // Focus after updates (AP-1472): keep, next, previous, the switch.
  const many = [3, 4, 5, 6, 7, 8, 9].map((k) => entry(hv(k), { excerpt: 'Věta.' }));
  const set = async (paths: string[]) => {
    const all = [...many, entry(R.den, { type: 'daily-note' }), entry(R.ukol), entry(R.trail)];
    await c3.relatedAnswer(R.rozpocet, false, { entries: paths.map((p) => all.find((e) => e.path === nfc(p))!), reason: null });
    await c3.emit('vault:changed', { paths: [] });
    await pathsWhen(p3, paths, 2000);
  };
  await set([...many.map((e) => e.path), R.den, R.ukol, R.trail]);
  await (await must(chipOf(p3, R.ukol), 'Úkol\'s chip')).focus();
  await relPanel(p3).evaluate((e) => { e.scrollTop = 40; });
  const top = await relPanel(p3).evaluate((e) => e.scrollTop);
  await c3.emit('vault:changed', { paths: [R.svatba] });
  await sleep(700);
  assert.equal((await focusName(p3)).name, nfc('Poslat rozpočet'), 'an update that keeps Úkol keeps the focus on it');
  assert.equal(await relPanel(p3).evaluate((e) => e.scrollTop), top, 'the tab\'s scroll position is kept');
  await set([R.den, R.ukol, R.trail]);
  await (await must(chipOf(p3, R.ukol), 'Úkol\'s chip')).focus();
  await set([R.den, R.trail]);
  assert.equal((await eventually(() => focusName(p3), (f) => f.name === 'Trail notes', 1000)).name, 'Trail notes', 'the focused entry removed: the next entry');
  await (await must(chipOf(p3, R.trail), 'Trail\'s chip')).focus();
  await set([R.den]);
  assert.equal((await eventually(() => focusName(p3), (f) => f.name === '2026-09-30', 1000)).name, '2026-09-30', 'no next entry: the previous one');
  await (await must(chipOf(p3, R.den), 'Den\'s chip')).focus();
  await c3.relatedAnswer(R.rozpocet, false, { entries: [], reason: null });
  await c3.emit('vault:changed', { paths: [] });
  assert.equal((await eventually(() => focusName(p3), (f) => f.role === 'switch', 1500)).role, 'switch', 'no entry left: the switch');
});

// ------------------------------------------------------------------------------------------------ FR-LNK-15 AC-29

test('fr_lnk_15_ac29_no_background_work', async ({ page }) => {
  const core = await startRelated(page, noteRoute(R.rozpocet), { tab: 'backlinks' });
  for (const [q, t] of [['Hiking', TITLE[R.hiking]], ['Trail', TITLE[R.trail]], ['Svatba', TITLE[R.svatba]], ['Včelstvo', TITLE[R.vcelstvo]], ['Kniha', TITLE[R.kniha]]] as const) {
    await openFromSearch(page, q, t);
  }
  for (let i = 0; i < 3; i++) await core.emit('vault:changed', { paths: [R.svatba] });
  await sleep(800);
  assert.deepEqual(await relCalls(core), [], 'panel on Backlinks: 5 notes and 3 external changes cause 0 index_related');
  await click(relTab(page), 'tab "Related"');
  await sleep(800);
  assert.equal((await relCalls(core)).length, 1, 'choosing Related causes exactly 1');
  await page.keyboard.press('Meta+Backslash');
  assert.equal(await eventually(() => relPanel(page).count(), (n) => n === 0), 0, 'the panel is closed');
  for (let i = 0; i < 3; i++) await core.emit('vault:changed', { paths: [R.svatba] });
  await sleep(800);
  assert.equal((await relCalls(core)).length, 1, 'panel closed: external changes cause 0');
  await page.keyboard.press('Meta+Backslash');
  await must(relPanel(page), 'reopened on Related');
  await sleep(800);
  assert.equal((await relCalls(core)).length, 2, 'reopening it on Related causes 1');
});

// ------------------------------------------------------------------------------------------------ FR-LNK-15 AC-30

async function watchLoading(page: Page) {
  await page.evaluate(() => {
    const w = window as any;
    w.__relLoading = [] as number[];
    w.__relAnims = 0;
    const check = () => {
      const p = document.querySelector('[role="tabpanel"].related') ?? [...document.querySelectorAll('[role="tabpanel"]')].find((e) => /Related/.test(e.getAttribute('aria-label') ?? ''));
      const st = p?.querySelector('[role="status"]');
      if (st && /Loading…/.test(st.textContent ?? '')) w.__relLoading.push(performance.now());
      if (p && p.getAnimations({ subtree: true }).length > 0) w.__relAnims++;
    };
    w.__relLoadObs?.disconnect();
    w.__relLoadObs = new MutationObserver(check);
    w.__relLoadObs.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true });
  });
}
const loadingSeen = (page: Page) => page.evaluate(() => ((window as any).__relLoading ?? []).length as number);
const animsSeen = (page: Page) => page.evaluate(() => (window as any).__relAnims as number);

test('fr_lnk_15_ac30_loading_and_index_not_ready', async ({ page }) => {
  const core = await openRelated(page, R.souhvezdi);
  await pathsWhen(page, H_HIDDEN);
  // 250 ms: Loading… never appears.
  await core.relatedDelay(250);
  await watchLoading(page);
  await pauseClock(page);
  await click(linkedSwitch(page), 'switch "Show linked notes"');
  for (let t = 0; t < 4; t++) await runFor(page, 100);
  assert.deepEqual(await pathsWhen(page, H_SHOWN, 1000), H_SHOWN, 'the 250 ms answer is drawn');
  assert.equal(await loadingSeen(page), 0, 'with a 250 ms answer, Loading… never appears');
  // 800 ms: Loading… from 300 ms (± 1 frame), replaced by the list, no animation.
  await core.relatedDelay(800);
  await watchLoading(page);
  await click(linkedSwitch(page), 'switch "Show linked notes"');
  await runFor(page, 280);
  assert.equal(await loadingStatus(page).count(), 0, 'no Loading… at 280 ms');
  await runFor(page, 40);
  assert.ok(await loadingStatus(page).count() === 1, 'Loading… at 300 ms (± 1 frame), as a status');
  assert.equal(await relPanel(page).evaluate((e) => e.getAnimations({ subtree: true }).length), 0, 'getAnimations() is empty while loading');
  await runFor(page, 520);
  assert.deepEqual(await pathsWhen(page, H_HIDDEN, 1000), H_HIDDEN, 'replaced by the list');
  assert.equal(await loadingStatus(page).count(), 0, 'Loading… is gone');
  assert.equal(await animsSeen(page), 0, 'no animation throughout');
  // The switch works while loading; a new request makes the earlier answer obsolete.
  await recordLists(page);
  const sets = (await uiSetCalls(core)).length;
  await click(linkedSwitch(page), 'switch "Show linked notes" (on, while loading)');
  await runFor(page, 400);
  await click(linkedSwitch(page), 'switch "Show linked notes" (off again, while loading)');
  for (let t = 0; t < 14; t++) await runFor(page, 100);
  assert.equal((await uiSetCalls(core)).length, sets + 2, 'the switch works while loading (two ui_state_set)');
  assert.deepEqual(await pathsWhen(page, H_HIDDEN, 1000), H_HIDDEN, 'the latest request\'s list');
  assert.ok((await listsDrawn(page)).every((l) => key(l) !== key(H_SHOWN)), 'the obsolete (linked shown) answer is never drawn');
  await page.clock.resume();
  // While the index isn't ready: Loading…, then the list on index:progress done, without a reload.
  await core.relatedDelay(0);
  await core.relatedNotReady(true);
  await core.emit('vault:changed', { paths: [] });
  await click(linkedSwitch(page), 'switch "Show linked notes"');
  assert.ok(await seen(loadingStatus(page), 2000), 'while the fake core reports indexing, the tab shows Loading…');
  await core.relatedNotReady(false);
  assert.deepEqual(await pathsWhen(page, H_SHOWN, 2000), H_SHOWN, 'index:progress done: the list, without a reload');
});

// ------------------------------------------------------------------------------------------------ FR-FMT-12 AC-11 (L5)

test('fr_fmt_12_ac11_nfd_paths_and_bodies_in_related', async ({ page }) => {
  const nfdRoute = `note/${R.terminyA.normalize('NFD')}`;
  const core = await startRelated(page, nfdRoute);
  await must(relPanel(page), 'the Related tab');
  assert.deepEqual(await pathsWhen(page, [R.terminyB, R.skoleni]), [R.terminyB, R.skoleni], 'Termíny opened through an NFD path shows its 2 entries');
  const calls = await relCalls(core);
  assert.ok(calls.length >= 1 && calls.every((c) => c.path === c.path.normalize('NFC')), `the recorded request has the path in NFC: ${JSON.stringify(calls)}`);
  assert.equal(calls[0]?.path, R.terminyA, 'Termíny\'s NFC path');
  const p2 = await page.context().newPage();
  const c2 = await openRelated(p2, R.poznamky);
  await pathsWhen(p2, [R.kniha]);
  await c2.renameFile(R.kniha, R.kniha.normalize('NFD'));
  await sleep(2000);
  const d = await drawn(p2);
  assert.deepEqual(d.filter((x) => x.title === nfc('Kniha vzpomínek')).map((x) => [x.path, x.title === x.title.normalize('NFC')]), [[R.kniha, true]], 'Kniha vzpomínek shown once, as an NFC title');
  const ui = JSON.stringify(await c2.uiState());
  assert.equal(ui, ui.normalize('NFC'), 'ui-state.json holds no NFD key');
  await p2.close();
});
