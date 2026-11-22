// Slice Q2-T, L5 (WebKit + fake core): keyboard, themes, accessibility and strings of the Tasks views, docs/acceptance/
// views.md part three (R207): FR-UX-03 AC-53 (the R207 commands; a keyboard-only tour with the focus indicator),
// FR-UX-05 AC-25 (both themes: axe contrast, token colours, lane heading tones), FR-UX-08 AC-25 (what VoiceOver reads;
// one polite announcement per move; no animation with reduced motion) and NFR-OTH-02 AC-23 (pseudo-locale). Interface
// docs/contracts/v1-views.md §29.3, §29.4, §30.1, §30.2, §30.4. Clock `2026-10-14T12:00:00+02:00`, Europe/Prague, `cs`.
// Written from the ACs and the contract only (D-61). Lookups go through `must` (TS-I1).
import { test, type Locator, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import { axeContrast, colourLeaks, tokenColour } from './read-helpers';
import {
  KANBAN, SCHEDULE, T, TYPE_TASK, allTab, click, dayGroup, doneLane, doneToggle, drag, editor, eventually, expectedTasks, fileText, fileWhen, focusedCard, lane,
  laneGrip, liveRegion, main, menuItem, must, mustBeOn, openTagFilter, openTasks, overlayOriginal, paletteOptions, periodLanes, qfile, rx, runCommand, seen,
  selectedTab, sleep, startTasksViews, tab, tablist, taskCard, textOf, titleOf, toolbar, toolbarMenuButton, viewMenu, writesTo,
} from './views-tasks-helpers';

test.use({ timezoneId: 'Europe/Prague' });

async function palette(page: Page, q: string): Promise<{ text: string; disabled: boolean }[]> {
  await page.keyboard.press('Meta+k');
  await page.getByRole('combobox', { name: 'Command query' }).fill(q);
  await sleep(250);
  const o = await page.getByRole('listbox', { name: 'Commands' }).getByRole('option').evaluateAll((xs) => xs.map((x) => ({ text: ((x as HTMLElement).innerText ?? '').split('\n')[0].trim(), disabled: x.getAttribute('aria-disabled') === 'true' })));
  await page.keyboard.press('Escape');
  return o;
}
const has = (o: { text: string }[], t: string) => o.some((x) => x.text === t);
/** The keyboard focus indicator (app-shell FR-UX-03 AC-13 (b)): a ≥ 2 px outline, or a background that differs from the
 *  blurred one (rows, cards, menu items). */
async function indicatorShown(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const a = document.activeElement as HTMLElement | null;
    if (!a || a === document.body) return false;
    const cs = getComputedStyle(a);
    if (cs.outlineStyle !== 'none' && (parseFloat(cs.outlineWidth) || 0) >= 2) return true;
    const bg = cs.backgroundColor;
    const isField = a instanceof HTMLInputElement || a instanceof HTMLTextAreaElement || a.isContentEditable;
    if (isField) return true; // text fields show no ring (AC-13 (c))
    a.blur();
    const bg2 = getComputedStyle(a).backgroundColor;
    a.focus();
    return bg !== bg2;
  });
}
async function tabUntil(page: Page, ok: () => Promise<boolean>, n = 80): Promise<boolean> {
  for (let i = 0; i < n; i++) { if (await ok()) return true; await page.keyboard.press('Tab'); }
  return ok();
}
async function holdOver(page: Page, from: Locator, to: Locator) {
  const a = (await (await must(from, 'drag source')).boundingBox())!;
  const b = (await (await must(to, 'drag target')).boundingBox())!;
  await page.mouse.move(a.x + a.width / 2, a.y + Math.min(20, a.height / 2));
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) await page.mouse.move(a.x + a.width / 2 + ((b.x + b.width / 2 - a.x - a.width / 2) * i) / 12, a.y + 20 + ((b.y + Math.min(b.height / 2, 60) - a.y - 20) * i) / 12);
  await sleep(150);
}
async function release(page: Page) {
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await sleep(150);
}

// ------------------------------------------------------------------------------------------------ FR-UX-03 AC-53

test('fr_ux_03_ac53_tasks_views_by_keyboard', async ({ page }) => {
  const core = await startTasksViews(page, { route: `note/${'Pages/Porada.md'}` });
  await mustBeOn(page, 'Porada', 'a note');
  const anywhere = [...await palette(page, 'Tasks'), ...await palette(page, 'Show'), ...await palette(page, 'Filter')];
  for (const t of ['Go to Tasks', 'Show Schedule', 'Show Kanban', 'Filter tasks']) assert.ok(has(anywhere, t), `\`${t}\` is listed anywhere`);
  assert.ok(!has(await palette(page, 'Restore default'), 'Restore default views'), '`Restore default views` isn\'t listed on a note');
  for (const t of ['Group Kanban by status', 'Group Kanban by tag', 'Show all tasks', 'Show tasks for today', 'Show tasks for this week', 'Add task…', 'Move task to next column',
    'Move task to previous column', 'Move column left', 'Move column right']) {
    assert.ok(!has(await palette(page, t), t), `\`${t}\` is removed`);
  }
  // With no pointer event: Go to Tasks; Tab to Přečíst knihu; Move card to previous lane (to Later, one write).
  await runCommand(page, 'Go to Tasks');
  await mustBeOn(page, 'Tasks', '`Go to Tasks`');
  const b = await openTasks(page, SCHEDULE).catch(() => main(page));
  assert.ok(await tabUntil(page, async () => (await focusedCard(page)) === T.t08), 'Tab reaches Přečíst knihu');
  assert.ok(await indicatorShown(page), 'the focused card shows the indicator');
  await runCommand(page, 'Move card to previous lane');
  assert.ok((await fileWhen(core, T.t08, (x) => !!x?.includes('due: 2026-10-19')))?.includes('due: 2026-10-19'), '`Move card to previous lane`: to Later (`due: 2026-10-19`), one write');
  assert.equal((await writesTo(core)).filter((p) => p === T.t08).length, 1, 'one write');
  // Next view to Kanban; Tab to a lane heading; Move lane right (one Kanban.yml write).
  await runCommand(page, 'Next view');
  assert.equal(await eventually(() => selectedTab(page), (s) => s === KANBAN, 2000), KANBAN, '`Next view` selects Kanban');
  const k = await openTasks(page, KANBAN);
  assert.ok(await tabUntil(page, async () => page.evaluate(() => document.activeElement?.getAttribute('data-command') === 'board.laneDrag')), 'Tab reaches a lane heading');
  assert.ok(await indicatorShown(page), 'the lane grip shows the indicator');
  await runCommand(page, 'Move lane right');
  assert.ok((await fileWhen(core, qfile(KANBAN), (x) => !!x?.includes('lane_order:')))?.includes('lane_order:'), '`Move lane right` writes Kanban.yml');
  assert.equal((await writesTo(core)).filter((p) => p === qfile(KANBAN)).length, 1, 'once');
  // Filter tasks, type za, Esc.
  await runCommand(page, 'Filter tasks');
  assert.ok(await eventually(() => page.evaluate(() => (document.activeElement?.getAttribute('aria-label') ?? '').replace(/[⟦⟧]/g, '') === 'Filter Tasks…'), (x) => x, 2000), 'the focus in `Filter Tasks…`');
  await page.keyboard.type('za');
  await page.keyboard.press('Escape');
  // Restore default views: disabled, its reason read.
  const r = (await palette(page, 'Restore default views')).find((x) => x.text === 'Restore default views');
  assert.ok(r, '`Restore default views` listed on type/task');
  assert.equal(r?.disabled, true, 'disabled (both listed and live)');
  await page.keyboard.press('Meta+k');
  await page.getByRole('combobox', { name: 'Command query' }).fill('Restore default views');
  await sleep(250);
  assert.ok((await paletteOptions(page)).some((o) => o.includes('Schedule and Kanban are on the Tasks page.')), 'its reason is read');
  await page.keyboard.press('Escape');
  void b; void k;
});

test('fr_ux_03_ac53_tasks_views_by_keyboard_menus_and_type_settings', async ({ page }) => {
  // FR-UX-03 AC-7, AC-8 (Esc closes the topmost layer and returns the focus) with the sort popover, `Filter by tag` and a
  // card menu open on each tab, and on type-settings/task.
  await startTasksViews(page, { route: TYPE_TASK });
  for (const name of [SCHEDULE, KANBAN]) {
    const b = await openTasks(page, name);
    await toolbar(page).locator('button[data-command="sort.open"]').focus();
    await page.keyboard.press('Enter');
    assert.ok(await seen(page.getByRole('dialog', { name: rx('Sort') }), 2000), `${name}: the sort popover opens by ⏎`);
    await page.keyboard.press('Escape');
    assert.equal(await page.getByRole('dialog', { name: rx('Sort') }).count(), 0, `${name}: Esc closes it`);
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('data-command')), 'sort.open', `${name}: the focus returns to the sort button`);
    await openTagFilter(page);
    await page.keyboard.press('Escape');
    assert.equal(await page.getByRole('listbox', { name: rx('Tags') }).count(), 0, `${name}: Esc closes the tag list`);
    await taskCard(b, T.t01).getByRole('button', { name: /More actions/ }).focus();
    await page.keyboard.press('Enter');
    assert.ok(await seen(page.getByRole('menu').last(), 2000), `${name}: the card menu opens by ⏎`);
    await page.keyboard.press('Escape');
    assert.equal(await page.getByRole('menu').count(), 0, `${name}: Esc closes the card menu`);
  }
  await startTasksViews(page, { route: 'type-settings/task' });
  await must(main(page).locator('button[data-command="types.restoreDefaultViews"]'), 'type-settings/task: `Restore default views`', 8000);
  assert.ok(await tabUntil(page, () => page.evaluate(() => document.activeElement?.getAttribute('data-command') === 'types.restoreDefaultViews'), 120), 'Tab reaches `Restore default views`');
  assert.ok(await indicatorShown(page), 'it shows the indicator');
});

// ------------------------------------------------------------------------------------------------ FR-UX-05 AC-25

for (const theme of ['light', 'dark'] as const) {
  test(`fr_ux_05_ac25_tasks_views_in_both_themes${theme === 'dark' ? '_dark' : ''}`, async ({ page }) => {
    await startTasksViews(page, { route: TYPE_TASK, theme });
    const b = await openTasks(page, SCHEDULE);
    await click(doneToggle(b), '`Expand Done`');
    await holdOver(page, taskCard(b, T.t08), dayGroup(b, '2026-10-16'));
    assert.deepEqual(await axeContrast(page), [], `${theme}: Schedule, the done lane open, a card over pátek 16.`);
    await release(page);
    assert.deepEqual(await colourLeaks(page, theme), [], `${theme}: colours from tokens only`);
    const colourOf = (l: Locator) => l.locator('h2').first().evaluate((h) => getComputedStyle(h).color);
    const probe = (key: string) => page.evaluate((k) => { const p = document.createElement('i'); p.style.color = `var(--${k})`; document.body.append(p); const c = getComputedStyle(p).color; p.remove(); return c; }, key);
    assert.equal(await colourOf(lane(b, 'period:today')), await probe('danger'), `${theme}: \`Today & overdue\` uses --danger`);
    assert.equal(await colourOf(lane(b, 'none')), await probe('muted'), `${theme}: \`Not scheduled\` uses --muted`);
    assert.equal(await colourOf(doneLane(b)), await probe('type-green'), `${theme}: \`Done\` uses the Done option's colour token (green)`);
    void tokenColour;
    const k = await openTasks(page, KANBAN);
    await holdOver(page, taskCard(k, T.t03), lane(k, 'option:Done'));
    assert.deepEqual(await axeContrast(page), [], `${theme}: Kanban, a card over Done`);
    await release(page);
    await click(allTab(page), 'All Tasks');
    await openTagFilter(page);
    assert.deepEqual(await axeContrast(page), [], `${theme}: All Tasks with Filter by tag open`);
    await page.keyboard.press('Escape');
    await openTasks(page, SCHEDULE);
    await click(toolbarMenuButton(page), '`View actions`');
    await click(menuItem(await must(viewMenu(page), 'menu'), 'Edit view'), 'Edit view');
    await must(editor(page), 'the editor');
    assert.deepEqual(await axeContrast(page), [], `${theme}: the editor from Schedule`);
    await page.keyboard.press('Escape');
    await startTasksViews(page, { route: 'type-settings/task', theme });
    await must(main(page).locator('button[data-command="types.restoreDefaultViews"]'), 'Default views', 8000);
    assert.deepEqual(await axeContrast(page), [], `${theme}: type-settings/task with Default views`);
  });
}

// ------------------------------------------------------------------------------------------------ FR-UX-08 AC-25

test('fr_ux_08_ac25_tasks_views_for_voiceover', async ({ page }) => {
  const core = await startTasksViews(page, { route: TYPE_TASK, reducedMotion: 'reduce' });
  const b = await openTasks(page, SCHEDULE);
  assert.equal((await tablist(page).getAttribute('aria-label'))?.replace(/[⟦⟧]/g, ''), 'Views', '`Views, tab list`');
  const s = tab(page, SCHEDULE);
  assert.deepEqual([await s.getAttribute('aria-selected'), await s.getAttribute('aria-posinset'), await s.getAttribute('aria-setsize')], ['true', '2', '4'], '`Schedule, tab, selected, 2 of 4`');
  const ls = await eventually(() => periodLanes(b), (l) => l.length === 5, 5000);
  assert.deepEqual(ls.map((l) => l.label), ['Today & overdue, 4 Tasks', 'This week, 4 Tasks', 'Later, 2 Tasks', 'Not scheduled, 5 Tasks', 'Done, 2 Tasks'], 'each lane a region `<label>, <n> Tasks`');
  const pat = ls[1].days.find((d) => d.date === '2026-10-16');
  assert.ok(pat && /, 1 Task$/.test(pat.label), `day groups \`<weekday day>, <n> Tasks\` (${pat?.label})`);
  assert.equal(await dayGroup(b, '2026-10-16').getAttribute('role'), 'group', 'a group');
  const tg = doneToggle(b);
  assert.deepEqual([(await tg.getAttribute('aria-label'))?.replace(/[⟦⟧]/g, ''), await tg.getAttribute('aria-expanded')], ['Expand Done', 'false'], '`Expand Done, collapsed`');
  for (const k of ['t01', 't04', 't08'] as const) assert.equal(await taskCard(b, T[k]).getAttribute('aria-label'), `Task: ${titleOf(T[k])}`, `\`Task: ${titleOf(T[k])}\``);
  const chipName = await taskCard(b, T.t01).locator('[data-due]').first().evaluate((e) => (e.getAttribute('aria-label') ?? (e as HTMLElement).innerText ?? '').replace(/\s+/g, ' ').trim());
  assert.ok(chipName.endsWith(', overdue'), `the overdue chip ends with \`, overdue\` (${chipName})`);
  // Announcements: a period drag, a done-lane drop and a lane move, once each, politely.
  const live = await must(liveRegion(page), 'div.sr-live');
  assert.equal(await live.getAttribute('aria-live'), 'polite', 'polite');
  await drag(page, taskCard(b, T.t08), dayGroup(b, '2026-10-16'));
  assert.equal(((await eventually(() => textOf(live), (t) => t.includes('Moved "Přečíst knihu"'), 2000)).match(/Moved "Přečíst knihu"/g) ?? []).length, 1, 'the period drag announced once');
  await click(tg, 'Expand Done');
  await drag(page, taskCard(b, T.t09), doneLane(b));
  assert.equal(((await eventually(() => textOf(live), (t) => t.includes('Moved "Opravit kolo"'), 2000)).match(/Moved "Opravit kolo"/g) ?? []).length, 1, 'the done-lane drop announced once');
  const k = await openTasks(page, KANBAN);
  await drag(page, laneGrip(k, 'option:Waiting'), lane(k, 'option:To do'), { at: 'left' });
  assert.ok(await eventually(() => textOf(live), (t) => t.includes('Moved lane '), 2000).then((t) => (t.match(/Moved lane /g) ?? []).length === 1), 'the lane move announced once');
  await click(tab(page, SCHEDULE), 'Schedule');
  const b2 = await openTasks(page, SCHEDULE);
  await click(doneToggle(b2), 'fold Done');
  assert.equal(await page.evaluate(() => document.getAnimations().length), 0, 'no animation with reduced motion');
  void core; void fileText; void overlayOriginal; void expectedTasks;
});

// ------------------------------------------------------------------------------------------------ NFR-OTH-02 AC-23

test('nfr_oth_02_ac23_q2t_strings', async ({ page }) => {
  await startTasksViews(page, { route: TYPE_TASK, pseudo: true });
  const b = await openTasks(page, SCHEDULE);
  await eventually(() => periodLanes(b), (l) => l.length === 5, 5000);
  const user = ['Tasks', 'Task', SCHEDULE, KANBAN, 'Čeká na ostatní', 'To do', 'In progress', 'Waiting', 'Done', 'Cancelled', 'High', 'Medium', 'Low', 'None', 'Status', 'Priority',
    'Due date', 'Rozpracováno', 'Porada', ...Object.values(T).map((p) => titleOf(p)), '#práce', '#doma', '#Doma', '#finance', '#čtení', '#rodina', `#${'doma'.normalize('NFD')}`];
  const check = () => main(page).evaluate((m, userContent) => {
    const out: string[] = [];
    const scope = [m.querySelector('[data-views-tablist]'), m.querySelector('div.view-toolbar'), m.querySelector('div[role="group"][data-board]'), m.querySelector('p[data-tasks-summary]'), m.querySelector('section[aria-labelledby]')].filter(Boolean) as Element[];
    for (const root of scope) {
      const els = [root, ...root.querySelectorAll('button, [role="button"], [role="tab"], [role="radio"], [role="checkbox"], section[role="region"], div[role="group"], article, h1, h2, p, [aria-label], [aria-description]')];
      for (const e of els) {
        if (e.closest('[data-due], h3.day-heading, p.card-excerpt, [data-user-content]') && !(e.matches('section, article, div[role="group"]'))) continue;
        for (const t of [e.getAttribute('aria-label'), e.getAttribute('aria-description'), e.getAttribute('title'), e.matches('p:not(.card-excerpt), h2') ? (e as HTMLElement).innerText : null]) {
          const s = (t ?? '').trim().normalize('NFC');
          if (!s || userContent.includes(s)) continue;
          if (!/^⟦[\s\S]*⟧$/.test(s)) out.push(s);
        }
      }
    }
    return { out, n: scope.length };
  }, user);
  const r1 = await check();
  assert.ok(r1.n >= 4, 'the tablist, the toolbar, the board and the summary are checked');
  assert.deepEqual(r1.out, [], 'Schedule: every text and accessible name inside ⟦ ⟧, except user content and dates');
  await click(toolbarMenuButton(page), '`View actions`');
  await click(page.getByRole('menu').last().getByRole('menuitem').filter({ hasText: /Edit view/ }).first(), 'Edit view');
  const e = await must(editor(page), 'the editor');
  const ed = await e.evaluate((d, userContent) => {
    const out: string[] = [];
    for (const el of [...d.querySelectorAll('[aria-label], label, h2, p, input[data-done-lane]')]) {
      for (const t of [el.getAttribute('aria-label'), el.matches('label, h2, p') ? (el as HTMLElement).innerText : null]) {
        const s = (t ?? '').trim().normalize('NFC');
        if (!s || userContent.includes(s)) continue;
        if (!/^⟦[\s\S]*⟧$/.test(s)) out.push(s);
      }
    }
    return out;
  }, user);
  assert.deepEqual(ed, [], 'the editor: inside ⟦ ⟧');
  await page.keyboard.press('Escape');
  await startTasksViews(page, { route: 'type-settings/task', pseudo: true });
  const btn = await must(main(page).locator('button[data-command="types.restoreDefaultViews"]'), 'Default views', 8000);
  assert.match((await btn.innerText()).trim(), /^⟦[\s\S]*⟧$/, '`Restore default views` inside ⟦ ⟧');
  assert.match((await btn.getAttribute('aria-description')) ?? '', /^⟦[\s\S]*⟧$/, 'its reason inside ⟦ ⟧');
});

void focusedCard;
