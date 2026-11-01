// Slice G2, L5 (WebKit + fake core): the panel graph after changes (docs/acceptance/graph-panel.md; D-914, D-915, D-980,
// D-1026, D-1039): FR-GRP-01 AC-39 (live updates within 2 s, debounced, an equal result moves nothing, the fade and
// Reduce motion), AC-40 (requests only while the Graph tab is shown), AC-41 (renames in Tegg and by another program),
// AC-42 (the page's file trashed, deleted, restored) and FR-GRP-06 AC-9 (the previewed node changes or disappears).
// Changes come from "another program" through the fake core (`setFile`, `renameFile`, which emit `vault:changed`) and
// from Tegg's own editor and rename job. Interface docs/contracts/v1-graph.md §15.1, §15.4, §15.7 (on §3, §6, §8).
// Written from the ACs and the contracts only (D-61). Every lookup goes through `must`/`seen` and node:assert (TS-I1).
import { test, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import { goToQuery, mustPreview, anyPreviewDialog } from './helpers';
import { commit, typeTitle } from './rename-helpers';
import {
  callsOf, drawn, drawnEdges, drawnKeys, eventually, flat, graphVault, mainName, must, nfc, nodeAt, original, pairOf, positions, routeReady,
  samePlaces, seen, sleep, swap, waitDrawn, clickNode, isDisabled,
} from './graph-helpers';
import {
  GP, P, VIEWPORT, backlinksTab, ctxPanel, footerIs, footerText, graphPanel, graphTab, noteRoute, openFullBtn, openPanel, panelText, requests,
  searchOpen, startPanel, stepOverSearch, trigger,
} from './graph-panel-helpers';

test.use({ timezoneId: 'Europe/Prague', locale: 'en-US', viewport: VIEWPORT });

const LIVE = 2000;
const D1 = [P.plan, P.rozpocet, P.zapis, P.shrnuti, P.graf, P.ukol, P.den, 'tag:účty', 'tag:nápad', P.recept].map(nfc).sort();
const keysIn = (page: Page) => drawnKeys(page, GP(page));
const waitIn = (page: Page, n: number, ms = 3000) => waitDrawn(page, n, ms, GP(page));
const saved = (page: Page) => page.getByRole('status', { name: 'Save state' }).filter({ hasText: 'Saved' });

/** Polls for a node at `path` in the panel and reports, at its first sight, its running animations' durations and its
 *  computed opacity (D-1026: a 150 ms fade-in, none under Reduce motion). */
async function firstSight(page: Page, path: string, ms = LIVE): Promise<{ durations: number[]; opacity: number } | null> {
  return page.evaluate(async ([p, limit]) => {
    const end = Date.now() + (limit as number);
    while (Date.now() < end) {
      const g = [...document.querySelectorAll('[role="tabpanel"] [data-graph-node]')].find((e) => (e.getAttribute('data-path') ?? '').normalize('NFC') === p) as SVGGElement | undefined;
      if (g) {
        const anims = [g, ...g.querySelectorAll('*')].flatMap((e) => (e as Element).getAnimations?.() ?? []);
        return { durations: anims.map((a) => Number((a.effect?.getTiming().duration as number) ?? 0)), opacity: Number(getComputedStyle(g).opacity) };
      }
      await new Promise((r) => setTimeout(r, 5));
    }
    return null;
  }, [nfc(path), ms] as const);
}

// ------------------------------------------------------------------------------------------------ FR-GRP-01 AC-39

test('fr_grp_01_ac39_panel_live_updates_within_two_seconds', async ({ page }) => {
  const core = await openPanel(page, P.plan, { realTime: true });
  await waitIn(page, 10);
  const p0 = await positions(page, GP(page));
  const sight = firstSight(page, P.osamela);
  await core.setFile(P.osamela, `${original(P.osamela).trimEnd()}\nViz [[Plán čtvrtletí]].\n`);
  const s = await sight;
  assert.ok(s, 'Osamělá is added within 2 s (D-980)');
  assert.ok(s!.durations.some((d) => Math.abs(d - 150) <= 1), `it fades in over 150 ms (animations: ${JSON.stringify(s!.durations)})`);
  assert.ok(await footerIs(page, '11 objects · click a node to preview'), `footer: ${await footerText(page)}`);
  const p1 = await positions(page, GP(page));
  assert.deepEqual(samePlaces(p0, p1, 0.5), [], 'the other nodes keep their positions (± 0.5 px)');
  const o = p1[nfc(P.osamela)], c = p1[nfc(P.plan)];
  assert.ok(o && c && Math.hypot(o.x - c.x, o.y - c.y) <= 100, 'Osamělá starts within 100 px of Plán');
  // Ten external changes within 500 ms: at most 3 requests, and the final graph equals a fresh query.
  const n0 = (await core.graphCalls()).length;
  const base = (await core.files())[nfc(P.plan)];
  for (let i = 0; i < 10; i++) { await core.setFile(P.plan, `${base.trimEnd()} ${i}\n`); await sleep(45); }
  await sleep(1200);
  const n = (await core.graphCalls()).length - n0;
  assert.ok(n <= 3, `ten changes within 500 ms: at most 3 graph_neighbourhood calls (got ${n})`);
  const final = (await keysIn(page)).join('|');
  await searchOpen(page, 'Výdaje 2026');
  await stepOverSearch(page, 'back'); // D-1348: over the Search entry Výdaje was opened from
  await eventually(() => mainName(page), (x) => x === 'Plán čtvrtletí', 4000);
  await waitIn(page, 11, 4000);
  assert.equal((await keysIn(page)).join('|'), final, 'the final graph equals a fresh query');
  // A change that leaves the result equal moves no node and redraws nothing.
  const before = await positions(page, GP(page));
  await page.evaluate(() => {
    const w = window as any;
    w.__panelMutations = 0;
    const svg = document.querySelector('[role="tabpanel"] [data-graph-node]')?.closest('svg');
    if (svg) new MutationObserver((m) => { w.__panelMutations += m.length; }).observe(svg, { subtree: true, attributes: true, childList: true });
    else w.__panelMutations = -1;
  });
  await core.setFile(P.nakup, `${original(P.nakup).trimEnd()} Ještě máslo.\n`);
  await sleep(1000);
  assert.deepEqual(samePlaces(before, await positions(page, GP(page)), 0), [], 'an equal result: no node moves');
  assert.equal(await page.evaluate(() => (window as any).__panelMutations), 0, 'and no redraw');
});

test('fr_grp_01_ac39_panel_live_updates_within_two_seconds_reduce_motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const core = await openPanel(page, P.plan, { realTime: true });
  await waitIn(page, 10);
  const sight = firstSight(page, P.osamela);
  await core.setFile(P.osamela, `${original(P.osamela).trimEnd()}\nViz [[Plán čtvrtletí]].\n`);
  const s = await sight;
  assert.ok(s, 'Osamělá is added');
  assert.deepEqual([s!.durations.filter((d) => d > 0), s!.opacity], [[], 1], 'under Reduce motion it appears at once (no fade, opacity 1)');
});

test('fr_grp_01_ac39_panel_live_updates_within_two_seconds_own_edit', async ({ page }) => {
  const core = await openPanel(page, P.plan, { realTime: true });
  await waitIn(page, 10);
  const body = await must(page.getByRole('textbox', { name: /^⟦?Note body⟧?$/ }), 'the note body');
  await (await must(body.getByText('Cíle na čtvrtletí podle', { exact: false }), 'Plán\'s first paragraph')).click();
  await page.keyboard.press('End');
  await page.keyboard.type(' [[Výdaje');
  const lb = await must(page.getByRole('listbox', { name: 'Link suggestions', exact: true }), 'Link suggestions');
  await (await must(lb.getByRole('option').filter({ hasText: /^Výdaje 2026/ }), 'option Výdaje 2026')).click();
  const early: string[] = [];
  const end = Date.now() + 4000;
  while (Date.now() < end && !(await seen(saved(page), 10))) early.push((await keysIn(page)).join('|'));
  assert.ok(await seen(saved(page), 100), 'the page reads Saved');
  assert.ok(early.every((k) => k === D1.join('|')), 'nothing changes in the panel before `Saved`');
  const k = await eventually(() => keysIn(page), (x) => x.includes(nfc(P.vydaje)), LIVE);
  assert.ok(k.includes(nfc(P.vydaje)), 'Výdaje is added at depth 1 within 2 s of `Saved`');
  assert.equal((await drawn(page, GP(page))).find((n) => n.key === nfc(P.vydaje))?.depth, 1, 'at depth 1');
  assert.ok((await core.writesTo()).map(nfc).includes(nfc(P.plan)), 'the page\'s own save');
});

// ------------------------------------------------------------------------------------------------ FR-GRP-01 AC-40

test('fr_grp_01_ac40_panel_queries_only_while_the_graph_tab_is_shown', async ({ page }) => {
  const core = await startPanel(page, noteRoute(P.plan), { tab: 'backlinks' });
  await eventually(() => mainName(page), (n) => n === 'Plán čtvrtletí', 5000);
  await must(backlinksTab(page), 'the Backlinks tab');
  await searchOpen(page, 'Rozpočet 2027');
  await goToQuery(page, '2026-10-07');
  await page.keyboard.press('Enter');
  assert.ok(await routeReady(core, 'daily/2026-10-07', 5000), 'on Den');
  await stepOverSearch(page, 'back'); // D-1348: over the Search entry Den was opened from
  assert.equal(await eventually(() => mainName(page), (n) => n === 'Rozpočet 2027', 4000), 'Rozpočet 2027', 'Back on Rozpočet');
  for (let i = 0; i < 3; i++) { await core.setFile(P.plan, `${original(P.plan).trimEnd()} změna ${i}\n`); await sleep(150); }
  await sleep(800);
  assert.equal((await core.graphCalls()).length, 0, 'with the panel on Backlinks: 0 graph_neighbourhood calls');
  await (await must(graphTab(page), 'the Graph tab')).click();
  await waitIn(page, 7, 4000);
  await sleep(600);
  const r = await requests(core);
  assert.equal(r.length, 1, `choosing the Graph tab: exactly 1 call (got ${r.length})`);
  assert.equal(r[0]?.centre, nfc(P.rozpocet), 'Rozpočet\'s (Back returned there)');
  await page.keyboard.press('Meta+Backslash');
  assert.ok(!(await seen(ctxPanel(page), 800)), 'the panel closed');
  await core.setFile(P.plan, `${original(P.plan).trimEnd()} další změna\n`);
  await sleep(1000);
  assert.equal((await core.graphCalls()).length, 1, 'closed: 0 more');
  await page.keyboard.press('Meta+Backslash');
  await waitIn(page, 7, 4000);
  await sleep(600);
  assert.equal((await core.graphCalls()).length, 2, 'reopening it: 1 more');
});

// ------------------------------------------------------------------------------------------------ FR-GRP-01 AC-41

test('fr_grp_01_ac41_panel_follows_renames', async ({ page }) => {
  const core = await openPanel(page, P.plan, { realTime: true });
  await waitIn(page, 10);
  const p0 = await positions(page, GP(page));
  await typeTitle(page, 'Plán Q4');
  await commit(page, 'enter');
  const q4 = 'Pages/Plán Q4.md';
  const name = await eventually(async () => (await nodeAt(page, q4, GP(page)).getAttribute('aria-label', { timeout: 200 }).catch(() => null)) ?? '', (n) => n.startsWith('Plán Q4'), LIVE + 1000);
  assert.equal(name, 'Plán Q4, Page', 'the centre is relabelled `Plán Q4` within 2 s');
  assert.equal((await keysIn(page)).length, 10, 'the 10 nodes stay');
  const p1 = await positions(page, GP(page));
  const moved = Object.keys(p0).filter((k) => {
    const to = k === nfc(P.plan) ? nfc(q4) : k;
    return !p1[to] || Math.abs(p1[to].x - p0[k].x) > 0.5 || Math.abs(p1[to].y - p0[k].y) > 0.5;
  });
  assert.deepEqual(moved, [], 'and their positions (± 0.5 px; the layout is kept by object id)');
  await must(GP(page).getByRole('group', { name: 'Local graph: Plán Q4 and the objects linked to it, 1 level deep', exact: true }), 'the canvas name follows');
  assert.equal((await requests(core)).at(-1)?.centre, nfc(q4), 'the request after the rename has centre "Pages/Plán Q4.md"');
  assert.ok(!(await seen(GP(page).getByText('This object was deleted'), 300)), 'not shown as deleted');
});

test('fr_grp_01_ac41_panel_follows_renames_external', async ({ page }) => {
  const core = await openPanel(page, P.plan);
  await waitIn(page, 10);
  const files = await core.files();
  await core.renameFile(P.shrnuti, 'Pages/Souhrn.md');
  await core.setFile('Pages/Souhrn.md', swap(files[nfc(P.shrnuti)], 'title: Shrnutí', 'title: Souhrn'));
  for (const p of [P.plan, P.bez, P.chybna]) await core.setFile(p, files[nfc(p)].replace(/\[\[Shrnutí\]\]/g, '[[Souhrn]]'));
  const name = await eventually(async () => (await nodeAt(page, 'Pages/Souhrn.md', GP(page)).getAttribute('aria-label', { timeout: 200 }).catch(() => null)) ?? '', (n) => n.startsWith('Souhrn'), LIVE);
  assert.equal(name, 'Souhrn, Page', 'another program\'s rename relabels the node `Souhrn` within 2 s (D-1004)');
  assert.equal((await keysIn(page)).length, 10, 'the same 10 nodes');
  assert.ok(!(await seen(GP(page).getByText('This object was deleted'), 300)), 'not shown as deleted');
});

// ------------------------------------------------------------------------------------------------ FR-GRP-01 AC-42

async function deletedState(page: Page, line: string) {
  await must(GP(page).getByText('This object was deleted', { exact: true }), 'the Deleted state (R115)', LIVE);
  assert.ok((await panelText(page)).includes(line), `${line}: ${await panelText(page)}`);
  const live = await graphPanel(page).locator('[role="status"], [role="alert"], [aria-live]').allInnerTexts();
  assert.ok(live.map(flat).some((t) => t.includes(line)), `in a live region: ${JSON.stringify(live)}`);
  assert.equal((await drawn(page, GP(page))).length, 0, 'no node');
  assert.equal(await GP(page).getByRole('button', { name: 'Back', exact: true }).count(), 0, 'no `Back`');
  assert.equal(await isDisabled(trigger(page)), true, 'the trigger is aria-disabled');
  assert.equal(await isDisabled(openFullBtn(page)), true, '`Open full view` is aria-disabled');
}

test('fr_grp_01_ac42_panel_when_the_page_file_is_deleted', async ({ page }) => {
  const core = await openPanel(page, P.plan);
  await waitIn(page, 10);
  await core.renameFile(P.plan, `.trash/${P.plan}`);
  await deletedState(page, '“Plán čtvrtletí” is in the trash, so there is no graph to show.');
  await core.renameFile(`.trash/${P.plan}`, P.plan);
  assert.deepEqual(await eventually(() => keysIn(page), (k) => k.length === 10, LIVE), D1, 'restoring Plán brings its 10-node graph back within 2 s');
  await core.setFile(P.plan, null);
  await deletedState(page, '“Plán čtvrtletí” no longer exists, so there is no graph to show.');
});

// ------------------------------------------------------------------------------------------------ FR-GRP-06 AC-9

test('fr_grp_06_ac9_panel_preview_live_and_removed_node', async ({ page }) => {
  const core = await openPanel(page, P.plan);
  await waitIn(page, 10);
  await clickNode(page, P.rozpocet, {}, GP(page));
  const d = await mustPreview(page, 'Rozpočet 2027', 'Rozpočet previewed');
  await core.setFile(P.rozpocet, swap(original(P.rozpocet), 'Rozpočet na příští rok.', 'Rozpočet na rok 2027.'));
  const t = await eventually(async () => flat(await d.innerText().catch(() => '')), (x) => x.includes('Rozpočet na rok 2027.'), LIVE);
  assert.ok(t.includes('Rozpočet na rok 2027.'), 'the popover updates within 2 s');
  await core.setFile(P.osamela, `${original(P.osamela).trimEnd()}\n[[Rozpočet 2027]]\n`);
  const t2 = await eventually(async () => flat(await d.innerText().catch(() => '')), (x) => x.includes('Projekt · 7 connections'), LIVE);
  assert.ok(t2.includes('Projekt · 7 connections'), `its line becomes \`Projekt · 7 connections\` within 2 s: ${t2}`);
});

test('fr_grp_06_ac9_panel_preview_live_and_removed_node_trashed', async ({ page }) => {
  const core = await openPanel(page, P.plan, { panel: { depth: 2 } });
  await waitIn(page, 19);
  await clickNode(page, P.shrnuti, {}, GP(page));
  await mustPreview(page, 'Shrnutí', 'Shrnutí previewed');
  await core.renameFile(P.shrnuti, `.trash/${P.shrnuti}`);
  assert.equal(await eventually(() => anyPreviewDialog(page).count(), (c) => c === 0, LIVE), 0, 'the popover closes within 2 s');
  const k = await waitIn(page, 15, LIVE);
  assert.equal(k.length, 15, 'redrawn with 15 objects');
  for (const gone of [P.shrnuti, P.bez, P.chybna, 'tag:archiv']) assert.ok(!k.includes(nfc(gone)), `${gone} is gone`);
  assert.deepEqual((await drawn(page, GP(page))).filter((n) => n.selected), [], 'the selection is cleared');
  assert.ok(pairOf(await drawnEdges(page, GP(page)), P.plan, P.rozpocet), 'the rest stays');
  assert.equal((await callsOf(core, 'note_write')).length, 0, 'nothing written');
});
