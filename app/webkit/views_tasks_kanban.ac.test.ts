// Slice Q2-T, L5 (WebKit + fake core): the `Kanban` tab of docs/acceptance/views.md part three (R187, R201, R205, R207,
// R208): FR-TSK-05 AC-19 (lanes; states hide lanes; unknown and no-value lanes), AC-20 (status drags and the lane order in
// `Kanban.yml`, never `task.yml`), AC-21 (a runtime view grouped by tags) and AC-22 (the board by keyboard; R207 commands;
// no ⌥←/⌥→). Interface docs/contracts/v1-views.md §26, §29.3, §29.5, §30.1, §30.4, §31.1, expected bytes §31.4 and
// tasks.md FR-TSK-05 AC-2, AC-4…AC-6 (the 5A bytes). Clock `2026-10-14T12:00:00+02:00`, Europe/Prague, `cs`. Written from
// the ACs and the contract only (D-61). Lookups go through `must` (TS-I1).
import { test, type Locator, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import {
  CEKA, KANBAN, NOW, SCHEDULE, T, TASK_YML, TYPE_TASK, addMenu, addView, allTab, changedFiles, click, drag, dropLabel, eventually, expectedTasks, fileText, fileWhen,
  flat, focusedCard, kanbanLanes, lane, laneCards, laneGrip, liveRegion, main, menuItem, must, mustBeOn, newInLane, nfc, openTasks, overlayOriginal, overlayVault,
  paletteDialog, paletteOptions, panelRowsAre, paths, periodLanes, podleStitku, qfile, runCommand, seen, selectTab, sleep, startTasksViews, swap, tab, taskCard,
  taskCheckbox, textOf, titleOf, touched, whereIs, writesTo, type FakeCoreHandle,
} from './views-tasks-helpers';

test.use({ timezoneId: 'Europe/Prague' });

const OLD_MOD = 'modified: 2026-10-01T09:00:00+02:00\n';
const done = (text: string) => swap(swap(text, 'status: To do', 'status: Done'), OLD_MOD, `modified: ${NOW}\ncompleted: ${NOW}\n`);
const once = async (core: FakeCoreHandle, path: string) => (await writesTo(core)).filter((p) => p === nfc(path)).length;
async function kanban(page: Page): Promise<Locator> {
  return openTasks(page, KANBAN);
}
async function lanesOf(b: Locator) {
  return (await periodLanes(b)).map((l) => ({ id: l.id, cards: l.cards }));
}
async function lanesWhen(b: Locator, want: { id: string; cards: string[] }[], ms = 3000) {
  const w = JSON.stringify(want);
  return eventually(() => lanesOf(b), (l) => JSON.stringify(l) === w, ms);
}
async function dropOn(page: Page, from: Locator, to: Locator, o: { alt?: boolean } = {}): Promise<string> {
  let label = '';
  await drag(page, from, to, { ...o, beforeUp: async () => { label = flat(await dropLabel(page).first().innerText({ timeout: 500 }).catch(() => '')); } });
  return label;
}

// ------------------------------------------------------------------------------------------------ FR-TSK-05 AC-19

test('fr_tsk_05_ac19_kanban_lanes', async ({ page }) => {
  const core = await startTasksViews(page, { route: TYPE_TASK });
  const b = await kanban(page);
  assert.deepEqual(await lanesWhen(b, kanbanLanes(), 5000), kanbanLanes(), 'R208\'s lanes and cards: To do 10, In progress 2, Waiting 1, Done 2, Rozpracováno 1, No Status 1');
  const ls = await periodLanes(b);
  assert.equal(ls.some((l) => l.id === 'option:Cancelled'), false, 'no `Cancelled` lane (hidden by the state filter, not hatched)');
  assert.equal(ls.find((l) => l.id === 'option:Done')?.hint, 'Last 7 days', '`Done` hint `Last 7 days`');
  assert.equal(await b.getAttribute('data-lanes'), 'vertical', 'vertical');
  for (const id of ['unknown:Rozpracováno', 'none']) {
    assert.equal(await lane(b, id).getAttribute('data-drop-target'), 'false', `${id}: not a drop target`);
    assert.equal(await newInLane(b, id).count(), 0, `${id}: no +`);
  }
  assert.equal(ls.at(-1)?.id, 'none', '`No Status` last');
  for (const [k, status] of [['t04', 'Waiting'], ['t02', 'In progress'], ['t10', 'Done']] as const) {
    assert.ok(!(await textOf(taskCard(b, T[k]))).includes(status), `${titleOf(T[k])}: no Status pill (the grouping key is hidden)`);
  }
  // Runtime options: Delegováno (done) gives a lane after Done; Odloženo (cancelled) gives none.
  const yml = overlayOriginal(TASK_YML);
  const doneLine = '      - { label: Done, state: done, color: green }\n';
  assert.ok(yml.includes(doneLine), 'setup: task.yml has the Done option line');
  await core.setFile(TASK_YML, yml.replace(doneLine, `${doneLine}      - { label: Delegováno, state: done, color: purple }\n      - { label: Odloženo, state: cancelled, color: gray }\n`));
  await core.setFile('Tasks/Odložený.md', '---\nid: 01JB5A0000000000000000W920\ntype: task\ntitle: Odložený\nstatus: Odloženo\ndue: 2026-10-14\ncreated: 2026-10-01T09:00:00+02:00\nmodified: 2026-10-01T09:00:00+02:00\n---\n');
  const l2 = await eventually(() => periodLanes(b), (l) => l.some((x) => x.id === 'option:Delegováno'), 3000);
  assert.deepEqual(l2.map((l) => l.id), ['option:To do', 'option:In progress', 'option:Waiting', 'option:Done', 'option:Delegováno', 'unknown:Rozpracováno', 'none'], 'a `Delegováno` lane after `Done`; no `Odloženo` lane');
  assert.equal(l2.find((l) => l.id === 'option:Delegováno')?.hint, 'Last 7 days', '`Delegováno` also limited to 7 days');
  assert.equal(await whereIs(b, 'Tasks/Odložený.md'), null, 'a task with `status: Odloženo` is not on Kanban');
  const s = await openTasks(page, SCHEDULE);
  await sleep(300);
  assert.equal(await whereIs(s, 'Tasks/Odložený.md'), null, '… nor on Schedule');
  await click(allTab(page), 'All Tasks');
  assert.ok((await eventually(() => main(page).locator('[data-query-result]').evaluateAll((xs) => xs.map((x) => (x.getAttribute('data-query-result') ?? '').normalize('NFC'))), (r) => r.includes('Tasks/Odložený.md'), 3000)).includes('Tasks/Odložený.md'), '… but on All Tasks');
  // Reordering the options (Waiting above In progress, as Type settings writes it) reorders the lanes within 2 s.
  const b2 = await kanban(page);
  const ip = '      - { label: In progress, state: in-progress, color: blue }\n';
  const wt = '      - { label: Waiting, state: open, color: yellow }\n';
  assert.ok(yml.includes(ip + wt), 'setup: In progress then Waiting');
  await core.setFile(TASK_YML, yml.replace(ip + wt, wt + ip));
  const l3 = await eventually(async () => (await periodLanes(b2)).map((l) => l.id), (x) => x[1] === 'option:Waiting', 2000);
  assert.deepEqual(l3.slice(0, 3), ['option:To do', 'option:Waiting', 'option:In progress'], 'the lanes follow the option order (no lane_order in Kanban.yml)');
  assert.equal(await fileText(core, qfile(KANBAN)), overlayOriginal(qfile(KANBAN)), 'Kanban.yml untouched');
});

// ------------------------------------------------------------------------------------------------ FR-TSK-05 AC-20

test('fr_tsk_05_ac20_kanban_drags_and_lane_order', async ({ page }) => {
  const core = await startTasksViews(page, { route: TYPE_TASK });
  const b = await kanban(page);
  await lanesWhen(b, kanbanLanes(), 5000);
  const label = await dropOn(page, taskCard(b, T.t03), lane(b, 'option:In progress'));
  assert.equal(label, 'Drop to set Status: In progress', 'the drop label');
  const ip = touched(swap(overlayOriginal(T.t03), 'status: To do', 'status: In progress'));
  assert.equal(await fileWhen(core, T.t03, (x) => x === ip), ip, 'tasks.md FR-TSK-05 AC-2\'s bytes');
  assert.equal(await once(core, T.t03), 1, 'once');
  await dropOn(page, taskCard(b, T.t01), lane(b, 'option:Done'));
  const d = done(overlayOriginal(T.t01));
  assert.equal(await fileWhen(core, T.t01, (x) => x === d), d, 'onto Done: status Done and completed set');
  await eventually(() => whereIs(b, T.t01), (w) => w?.lane === 'option:Done', 2000);
  await dropOn(page, taskCard(b, T.t01), lane(b, 'option:To do'));
  const back = touched(overlayOriginal(T.t01));
  assert.equal(await fileWhen(core, T.t01, (x) => x === back), back, 'from Done back to To do: completed removed');
  // The Waiting lane's grip before To do writes Kanban.yml once; task.yml and task files untouched.
  const before = await core.files();
  await drag(page, laneGrip(b, 'option:Waiting'), lane(b, 'option:To do'), { at: 'left' });
  const want = expectedTasks('queries/kanban-lane-order-waiting.yml');
  assert.equal(await fileWhen(core, qfile(KANBAN), (x) => x === want), want, 'Kanban.yml: `lane_order: [Waiting, To do, In progress, Done, Rozpracováno]` after `lanes: vertical`, modified');
  assert.deepEqual(await changedFiles(core, before), [qfile(KANBAN)], 'task.yml and every task file unchanged');
  assert.equal(await fileText(core, TASK_YML), overlayOriginal(TASK_YML), 'task.yml byte-identical');
  await runCommand(page, 'Reset lane order');
  const reset = expectedTasks('queries/kanban-lane-order-reset.yml');
  assert.equal(await fileWhen(core, qfile(KANBAN), (x) => x === reset), reset, '`Reset lane order` removes the line');
  // The palette: Move lane left / right; Move column left / right no longer exist.
  await laneGrip(b, 'option:Waiting').focus();
  await runCommand(page, 'Move lane left');
  assert.ok((await fileWhen(core, qfile(KANBAN), (x) => !!x?.includes('lane_order: [To do, Waiting, In progress, Done, Rozpracováno]')))?.includes('lane_order:'), '`Move lane left` writes lane_order');
  assert.equal(await fileText(core, TASK_YML), overlayOriginal(TASK_YML), 'never task.yml');
  await page.keyboard.press('Meta+k');
  await must(paletteDialog(page), 'the palette');
  await page.getByRole('combobox', { name: 'Command query' }).fill('Move column');
  await sleep(300);
  assert.ok(!(await paletteOptions(page)).some((o) => /Move column (left|right)/.test(o)), '`Move column left` / `right` no longer exist');
  await page.keyboard.press('Escape');
});

// ------------------------------------------------------------------------------------------------ FR-TSK-05 AC-21

test('fr_tsk_05_ac21_grouped_by_tags', async ({ page }) => {
  const core = await startTasksViews(page, { route: TYPE_TASK, vault: overlayVault((f) => { f[qfile('Podle štítků')] = podleStitku(); }) });
  await must(tab(page, SCHEDULE), 'tab Schedule', 8000);
  await click(addView(page), 'Add view');
  const menu = await must(addMenu(page), 'menu `Add view`');
  await click(menu.locator('[data-query="Podle štítků"]').or(menuItem(menu, 'Podle štítků')).first(), '`Show a saved query` › Podle štítků');
  assert.ok((await fileWhen(core, TASK_YML, (x) => !!x?.includes('Podle štítků')))?.includes(`views: [Schedule, Kanban, ${CEKA}, Podle štítků]`), 'task.yml lists the new tab');
  const b = await openTasks(page, 'Podle štítků');
  const want = [
    { id: 'tag:čtení', cards: paths('t08') }, { id: 'tag:doma', cards: paths('t03', 't04', 't19', 't05') }, { id: 'tag:finance', cards: paths('t02', 't10') },
    { id: 'tag:práce', cards: paths('t01', 't02', 't06', 't18') }, { id: 'tag:rodina', cards: paths('t18') }, { id: 'none', cards: paths('t14', 't15', 't07', 't09', 't17', 't16', 't12') },
  ];
  assert.deepEqual(await lanesWhen(b, want, 5000), want, 'lanes čtení 1, doma 4, finance 2 (T02, T10), práce 4, rodina 1, No Tags 7');
  const t02 = taskCard(b, T.t02, 'tag:finance');
  const tags = await t02.locator('span.card-tag').allInnerTexts();
  assert.deepEqual(tags.map(flat).sort(), ['#finance', '#práce'], 'all of a card\'s tags on it');
  assert.equal(await t02.getByText(/also in/).count(), 0, 'no `also in`');
  assert.equal(await lane(b, 'none').getAttribute('data-drop-target'), 'false', '`No Tags` isn\'t a drop target');
  // tasks.md FR-TSK-05 AC-4…AC-6's drags give the same bytes.
  await dropOn(page, taskCard(b, T.t04, 'tag:doma'), lane(b, 'tag:práce'));
  assert.equal(await fileWhen(core, T.t04, (x) => x !== overlayOriginal(T.t04)), touched(swap(overlayOriginal(T.t04), 'tags: [doma]', 'tags: [práce]')), 'T04: [doma] → [práce]');
  await dropOn(page, taskCard(b, T.t05, 'tag:doma'), lane(b, 'tag:čtení'));
  assert.equal(await fileWhen(core, T.t05, (x) => x !== overlayOriginal(T.t05)), touched(swap(overlayOriginal(T.t05), 'tags: [Doma]', 'tags: [čtení]')), 'T05: `Doma` removed (case-insensitive)');
  await dropOn(page, taskCard(b, T.t19, 'tag:doma'), lane(b, 'tag:práce'));
  assert.equal(await fileWhen(core, T.t19, (x) => x !== overlayOriginal(T.t19)), touched(swap(overlayOriginal(T.t19), `tags: [${'doma'.normalize('NFD')}]`, 'tags: [práce]')), 'T19: the NFD entry replaced, NFD title kept');
  const alt = await dropOn(page, taskCard(b, T.t03, 'tag:doma'), lane(b, 'tag:finance'), { alt: true });
  assert.ok(alt.includes('finance'), `Alt-drag label (${alt})`);
  assert.equal(await fileWhen(core, T.t03, (x) => x !== overlayOriginal(T.t03)), touched(swap(overlayOriginal(T.t03), 'tags: [doma]', 'tags: [doma, finance]')), 'Alt-drag adds: [doma, finance]');
  await dropOn(page, taskCard(b, T.t18, 'tag:rodina'), lane(b, 'tag:doma'));
  assert.equal(await fileWhen(core, T.t18, (x) => x !== overlayOriginal(T.t18)), touched(swap(overlayOriginal(T.t18), 'tags: [práce]', 'tags: [práce, doma]')), 'T18: tags: [práce, doma], body kept');
  assert.ok(await eventually(() => textOf(liveRegion(page)), (t) => t.includes('#rodina is in the text of "Štítek v textu" and stays.'), 2000).then((t) => t.includes('#rodina is in the text')), 'the inline note');
  const n = (await writesTo(core)).length;
  await dropOn(page, taskCard(b, T.t06, 'tag:práce'), lane(b, 'none'));
  await sleep(300);
  assert.equal((await writesTo(core)).length, n, '`No Tags`: nothing written');
});

// ------------------------------------------------------------------------------------------------ FR-TSK-05 AC-22

test('fr_tsk_05_ac22_keyboard', async ({ page }) => {
  const core = await startTasksViews(page, { route: TYPE_TASK, ui: { typeViews: { lastTab: { task: KANBAN } } } });
  const b = await kanban(page);
  await lanesWhen(b, kanbanLanes(), 5000);
  await main(page).focus().catch(() => undefined);
  let first: string | null = null;
  for (let i = 0; i < 40 && !first; i++) { await page.keyboard.press('Tab'); first = await focusedCard(page); }
  assert.equal(first, T.t01, 'Tab reaches the first card, Zavolat Janě');
  await page.keyboard.press('ArrowDown');
  assert.equal(await focusedCard(page), T.t03, '↓ moves inside the lane');
  await page.keyboard.press('ArrowUp');
  assert.equal(await focusedCard(page), T.t01, '↑ back');
  await page.keyboard.press('ArrowRight');
  assert.equal(await focusedCard(page), T.t02, '→ to the nearest card of In progress');
  await page.keyboard.press('ArrowLeft');
  assert.equal(await focusedCard(page), T.t01, '← back to To do');
  const n0 = (await writesTo(core)).length;
  await page.keyboard.press('Alt+ArrowRight');
  await page.keyboard.press('Alt+ArrowLeft');
  await sleep(300);
  assert.equal((await writesTo(core)).length, n0, '⌥→ / ⌥← on a card write nothing');
  assert.equal(await whereIs(b, T.t01).then((w) => w?.lane), 'option:To do', '… and move nothing');
  await page.keyboard.press('Enter');
  await mustBeOn(page, 'Zavolat Janě', '⏎ opens');
  await page.keyboard.press('Meta+[');
  const b2 = await kanban(page);
  // Space on a card's checkbox completes it.
  await taskCheckbox(taskCard(b2, T.t19), titleOf(T.t19)).focus();
  await page.keyboard.press('Space');
  assert.ok((await fileWhen(core, T.t19, (x) => !!x?.includes('status: Done')))?.includes('completed: '), 'Space completes Nákup (FR-TSK-02 AC-10 write)');
  // Move card to next lane: Zalít květiny to In progress, one write.
  await taskCard(b2, T.t03).focus();
  await runCommand(page, 'Move card to next lane');
  const ip = touched(swap(overlayOriginal(T.t03), 'status: To do', 'status: In progress'));
  assert.equal(await fileWhen(core, T.t03, (x) => x === ip), ip, '`Move card to next lane`: In progress, one write');
  assert.equal(await once(core, T.t03), 1, 'once');
  // From Done, the next lane skips Rozpracováno and No Status: nothing to move to.
  await taskCard(b2, T.t10).focus();
  const n1 = (await writesTo(core)).length;
  await runCommand(page, 'Move card to next lane');
  await sleep(300);
  assert.equal((await writesTo(core)).length, n1, 'from the last option lane, `Rozpracováno` and `No Status` are skipped: nothing written');
  // Complete task and Set task status… on the focused card.
  await taskCard(b2, T.t05).focus();
  await runCommand(page, 'Complete task');
  assert.ok((await fileWhen(core, T.t05, (x) => !!x?.includes('status: Done')))?.includes('status: Done'), '`Complete task` on Úklid garáže');
  await taskCard(b2, T.t06).focus();
  await runCommand(page, 'Set task status…');
  await click(page.getByRole('menuitemradio', { name: 'Waiting', exact: true }).or(page.getByRole('option', { name: 'Waiting', exact: true })).first(), 'Waiting');
  assert.ok((await fileWhen(core, T.t06, (x) => !!x?.includes('status: Waiting')))?.includes('status: Waiting'), '`Set task status…` on Příprava prezentace');
  // ⌥←/⌥→ on a lane heading do nothing.
  await laneGrip(b2, 'option:Waiting').focus();
  const n2 = (await writesTo(core)).length;
  await page.keyboard.press('Alt+ArrowLeft');
  await sleep(300);
  assert.equal((await writesTo(core)).length, n2, '⌥← on a lane heading writes nothing');
  assert.equal(await fileText(core, qfile(KANBAN)), overlayOriginal(qfile(KANBAN)), 'Kanban.yml untouched');
});

test('fr_tsk_05_ac22_keyboard_on_schedule', async ({ page }) => {
  const core = await startTasksViews(page, { route: TYPE_TASK });
  const b = await openTasks(page, SCHEDULE);
  await eventually(() => laneCards(b, 'period:today'), (c) => c.length === 4, 5000);
  await taskCard(b, T.t01).focus();
  await page.keyboard.press('ArrowRight');
  assert.equal(await focusedCard(page), T.t02, 'horizontal: → inside a row');
  await page.keyboard.press('ArrowDown');
  assert.equal((await whereIs(b, (await focusedCard(page)) ?? ''))?.lane, 'period:week', '↓ to the next row (This week)');
  await taskCard(b, T.t01).focus();
  await runCommand(page, 'Move card to next lane');
  const t = await fileWhen(core, T.t01, (x) => !!x?.includes('due: 2026-10-15'));
  assert.equal(t, touched(swap(overlayOriginal(T.t01), 'due: 2026-10-09', 'due: 2026-10-15')), '`Move card to next lane` from `Today & overdue`: `čtvrtek 15.`, `due: 2026-10-15`');
  assert.deepEqual(await eventually(() => whereIs(b, T.t01), (w) => w?.day === '2026-10-15', 2000), { lane: 'period:week', day: '2026-10-15' }, 'the card is in `čtvrtek 15.`');
  const n = (await writesTo(core)).length;
  await taskCard(b, T.t02).focus();
  await page.keyboard.press('Alt+ArrowRight');
  await sleep(300);
  assert.equal((await writesTo(core)).length, n, '⌥→ on a Schedule card writes nothing');
});

void panelRowsAre;
void seen;
