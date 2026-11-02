// v0.113 feedback, L5 (WebKit + fake core): reordering the Kanban's status columns (D-1357, AP-1215). FR-TSK-05 AC-17
// (drag a column heading) and AC-18 (⌥← / ⌥→ on a focused heading, palette `Move column left` / `Move column right`).
// docs/acceptance/tasks.md R42, R46; interface docs/contracts/ms5-tasks.md §14 (one `type_patch` `moveOption` on
// `status`, `to` in the full option list with the hidden `Cancelled`; the handle: role `button`, tabIndex 0,
// `draggable`, label `Drag to reorder columns`, described by the column's name; `tasks.column.moved`) and §7 (the fake
// core applies type ops through the real schema; `setFile(…, { silent: true })` changes the disk without an event).
// The bytes of `.tegg/types/task.yml` are those the fake core writes, as in FR-TSK-02 AC-2 (tasks_type_settings).
// Clock 2026-10-14T12:00:00+02:00, Europe/Prague, region cs. Written from the ACs and the contract only (D-61).
import { test, type Locator, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import {
  O, callsOf, column, columnIds, columns, eventually, fileText, fileWhen, gotoKanban, liveTexts, main, must, nfc, original, paths, runCommand, seen,
  sleep, startTasks, swap, tasksVault, writeCalls,
} from './tasks-helpers';

test.use({ timezoneId: 'Europe/Prague' });

const YML = O.taskYml;
const L = {
  todo: '      - { label: To do, state: open, color: gray }\n',
  inProgress: '      - { label: In progress, state: in-progress, color: blue }\n',
  waiting: '      - { label: Waiting, state: open, color: yellow }\n',
  done: '      - { label: Done, state: done, color: green }\n',
  cancelled: '      - { label: Cancelled, state: cancelled, color: red }\n',
};
type Line = keyof typeof L;
const SHIPPED: Line[] = ['todo', 'inProgress', 'waiting', 'done', 'cancelled'];
/** `task.yml` with the status option lines in `order` and every other byte as shipped (AR-07 AC-5). */
const ymlWith = (order: Line[]) => swap(original(YML), SHIPPED.map((k) => L[k]).join(''), order.map((k) => L[k]).join(''));
/** R42 by status on the fixture (All filter): the cards per column, which a column move never changes. */
const CARDS = {
  'To do': paths('t01', 't03', 't19', 't05', 't06', 't07', 't08', 't17', 't16', 't18'), 'In progress': paths('t02', 't09'), Waiting: paths('t04'),
  Done: paths('t10', 't12'), 'no-status': paths('t14', 't15'),
};
const DRAG = 'Drag to reorder columns';
const handles = (page: Page) => main(page).getByRole('button', { name: DRAG, exact: true });
const handleOf = (page: Page, col: string) => column(page, col).getByRole('button', { name: DRAG, exact: true });
const headingOf = (page: Page, col: string) => column(page, col).getByRole('heading', { level: 2 });
type Core = Awaited<ReturnType<typeof startTasks>>;

/** Successful `type_patch` calls (args), in order. */
async function typePatches(core: Core): Promise<{ key: string; ops: unknown[] }[]> {
  return (await callsOf(core, 'type_patch')).filter((c) => c.ok !== false).map((c) => c.args as any);
}
/** Every vault file but `task.yml` is as in the fixture (no task file written). */
async function onlyTypeFileChanged(core: Core, what: string) {
  const now = await core.files();
  const was = tasksVault().files;
  const changed = [...new Set([...Object.keys(now), ...Object.keys(was)])].map(nfc).filter((p) => p !== YML && now[p] !== was[p]);
  assert.deepEqual(changed, [], `${what}: no file but task.yml changed`);
  assert.deepEqual((await callsOf(core, 'note_write')).length, 0, `${what}: no note_write (cards don't change status)`);
  assert.deepEqual([...new Set((await core.writesTo()).map(nfc))].filter((p) => p !== YML), [], `${what}: only task.yml written`);
}
/** The column of the focused element and whether it is that column's handle. */
async function focusAt(page: Page): Promise<{ column: string | null; handle: boolean }> {
  return page.evaluate((label) => {
    const a = document.activeElement as HTMLElement | null;
    return { column: a?.closest('[data-column]')?.getAttribute('data-column')?.normalize('NFC') ?? null, handle: a?.getAttribute('aria-label') === label };
  }, DRAG);
}
/** Accessible description of an element (aria-describedby texts or aria-description). */
async function describedAs(loc: Locator): Promise<string> {
  return loc.first().evaluate((e) => {
    const ids = (e.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean);
    return (e.getAttribute('aria-description') ?? ids.map((id) => document.getElementById(id)?.textContent ?? '').join(' ')).replace(/\s+/g, ' ').trim().normalize('NFC');
  });
}
/** Drags the heading handle of `from` with the mouse and drops it over the left (`before`) or right (`after`) part of
 *  the heading of `to`. `during` runs before the drop. */
async function dragHeading(page: Page, from: string, to: string, side: 'before' | 'after', during?: () => Promise<void>) {
  const src = await must(handleOf(page, from), `the handle "${DRAG}" of ${from}`);
  await src.scrollIntoViewIfNeeded();
  const a = await src.boundingBox();
  assert.ok(a, `the handle of ${from} is on screen`);
  await page.mouse.move(a!.x + a!.width / 2, a!.y + a!.height / 2);
  await page.mouse.down();
  await page.mouse.move(a!.x + a!.width / 2 + 12, a!.y + a!.height / 2 + 4, { steps: 4 });
  const dst = await must(headingOf(page, to), `the heading of ${to}`);
  await dst.scrollIntoViewIfNeeded();
  const b = await dst.boundingBox();
  assert.ok(b, `the heading of ${to} is on screen`);
  await page.mouse.move(b!.x + b!.width * (side === 'before' ? 0.2 : 0.8), b!.y + b!.height / 2, { steps: 12 });
  if (during) await during();
  await page.mouse.up();
  await sleep(200);
}
/** The palette's option for `title`: listed, aria-disabled. Closes the palette. */
async function paletteEntry(page: Page, title: string): Promise<{ listed: boolean; disabled: boolean }> {
  await page.keyboard.press('Meta+k');
  await must(page.getByRole('dialog', { name: 'Command palette' }), 'the command palette');
  await page.getByRole('combobox', { name: 'Command query' }).fill(title);
  await sleep(250);
  const opt = page.getByRole('listbox', { name: 'Commands' }).getByRole('option').filter({ hasText: title });
  const listed = (await opt.count()) > 0;
  const disabled = listed ? await opt.first().evaluate((e) => e.getAttribute('aria-disabled') === 'true') : false;
  await page.keyboard.press('Escape');
  await sleep(100);
  return { listed, disabled };
}

// ------------------------------------------------------------------------------------------------ AC-17

test('fr_tsk_05_ac17_column_headings_are_drag_handles_except_no_status', async ({ page }) => {
  const core = await startTasks(page);
  await gotoKanban(page, 'Status');
  assert.deepEqual(await columnIds(page), ['To do', 'In progress', 'Waiting', 'Done', 'no-status'], 'setup: R42 columns');
  for (const col of ['To do', 'In progress', 'Waiting', 'Done']) {
    const h = await must(handleOf(page, col), `${col}: a button "${DRAG}" in its heading`);
    const a = await h.evaluate((e) => ({ tab: (e as HTMLElement).tabIndex, draggable: (e as HTMLElement).draggable || e.getAttribute('draggable') === 'true' }));
    assert.deepEqual(a, { tab: 0, draggable: true }, `${col}: the handle is focusable (tabIndex 0) and draggable (ms5-tasks §14)`);
    assert.equal(await describedAs(h), col, `${col}: the handle is described by the column's name`);
  }
  assert.equal(await handleOf(page, 'no-status').count(), 0, 'No status has no drag handle');
  assert.equal(await handles(page).count(), 4, 'one handle per status column');
  assert.deepEqual(await writeCalls(core), [], 'showing the handles writes nothing');
});

test('fr_tsk_05_ac17_drag_waiting_before_to_do_and_to_do_after_done', async ({ page }) => {
  const core = await startTasks(page);
  await gotoKanban(page, 'Status');
  await dragHeading(page, 'Waiting', 'To do', 'before');
  assert.deepEqual(await eventually(() => columnIds(page), (c) => c[0] === 'Waiting', 2000), ['Waiting', 'To do', 'In progress', 'Done', 'no-status'], 'the columns after dropping Waiting before To do');
  assert.equal(await fileWhen(core, YML, (t) => !!t && t.indexOf('label: Waiting') < t.indexOf('label: To do')), ymlWith(['waiting', 'todo', 'inProgress', 'done', 'cancelled']), 'only the Waiting line moves, to just before To do');
  const p1 = await typePatches(core);
  assert.deepEqual(p1.map((p) => [p.key, p.ops]), [['task', [{ op: 'moveOption', attr: 'status', label: 'Waiting', to: 0 }]]], 'one type_patch: moveOption Waiting to 0 (ms5-tasks §14)');
  assert.deepEqual(await columns(page), { Waiting: CARDS.Waiting, 'To do': CARDS['To do'], 'In progress': CARDS['In progress'], Done: CARDS.Done, 'no-status': CARDS['no-status'] }, 'cards don\'t change column');
  await onlyTypeFileChanged(core, 'after the first drop');
  // Dropping after the last status column puts the line just after that column's option; Cancelled keeps its place.
  await dragHeading(page, 'To do', 'Done', 'after');
  assert.deepEqual(await eventually(() => columnIds(page), (c) => c[3] === 'To do', 2000), ['Waiting', 'In progress', 'Done', 'To do', 'no-status'], 'To do after Done; No status stays last');
  assert.equal(await fileWhen(core, YML, (t) => !!t && t.indexOf('label: To do') > t.indexOf('label: Done')), ymlWith(['waiting', 'inProgress', 'done', 'todo', 'cancelled']), 'the To do line just after Done, Cancelled still last');
  const ops = (await typePatches(core)).map((p) => p.ops);
  assert.deepEqual(ops, [[{ op: 'moveOption', attr: 'status', label: 'Waiting', to: 0 }], [{ op: 'moveOption', attr: 'status', label: 'To do', to: 3 }]], 'one moveOption per drop; `to` counts the hidden Cancelled');
  await onlyTypeFileChanged(core, 'after the second drop');
});

test('fr_tsk_05_ac17_no_status_stays_last_and_an_outside_change_cancels_the_drop', async ({ page }) => {
  const core = await startTasks(page);
  await gotoKanban(page, 'Status');
  await must(handleOf(page, 'Waiting'), `Waiting: a button "${DRAG}"`);
  // An outside change to task.yml during the drag (no event): the drop writes nothing and the columns go back.
  const ext = swap(original(YML), L.done, '      - { label: Done, state: done, color: teal }\n');
  await dragHeading(page, 'Waiting', 'To do', 'before', async () => { await core.setFile(YML, ext, { silent: true }); });
  await sleep(300);
  assert.equal(await fileText(core, YML), ext, 'nothing written: task.yml keeps the outside bytes (NFR-REL-02)');
  assert.deepEqual(await eventually(() => columnIds(page), (c) => c[0] === 'To do', 2000), ['To do', 'In progress', 'Waiting', 'Done', 'no-status'], 'the columns go back');
  assert.deepEqual(await columns(page), CARDS, 'every card where it was');
  assert.equal((await typePatches(core)).length, 0, 'no type_patch succeeded');
  // No status can't be dragged; dropping a heading on it doesn't move anything after it.
  await dragHeading(page, 'Done', 'no-status', 'after');
  await sleep(300);
  const ids = await columnIds(page);
  assert.equal(ids[ids.length - 1], 'no-status', 'No status stays last');
  assert.equal(await handleOf(page, 'no-status').count(), 0, 'No status is no drag handle');
  assert.deepEqual((await callsOf(core, 'note_write')).length, 0, 'no task file written');
});

// ------------------------------------------------------------------------------------------------ AC-18

test('fr_tsk_05_ac18_alt_arrows_on_a_focused_heading_move_the_column', async ({ page }) => {
  const core = await startTasks(page);
  await gotoKanban(page, 'Status');
  const todo = await must(handleOf(page, 'To do'), `To do: a button "${DRAG}"`);
  const order = await todo.evaluate((h) => {
    const first = h.closest('[data-column]')?.querySelector('[data-path]');
    return { tab: (h as HTMLElement).tabIndex, before: !!first && !!(h.compareDocumentPosition(first) & Node.DOCUMENT_POSITION_FOLLOWING) };
  });
  assert.deepEqual(order, { tab: 0, before: true }, 'the heading is focusable and comes before its cards in the Tab order');
  await (await must(handleOf(page, 'Waiting'), 'the handle of Waiting')).focus();
  await page.keyboard.press('Alt+ArrowLeft');
  assert.equal(await fileWhen(core, YML, (t) => !!t && t.indexOf('label: Waiting') < t.indexOf('label: In progress')), ymlWith(['todo', 'waiting', 'inProgress', 'done', 'cancelled']), '⌥←: Waiting one place left, one line moved');
  assert.deepEqual(await eventually(() => columnIds(page), (c) => c[1] === 'Waiting', 2000), ['To do', 'Waiting', 'In progress', 'Done', 'no-status'], 'the columns follow');
  assert.deepEqual(await focusAt(page), { column: 'Waiting', handle: true }, 'the focus stays on the moved heading');
  assert.ok((await eventually(() => liveTexts(page), (t) => t.includes('Moved column Waiting'), 2000)).includes('Moved column Waiting'), 'announced "Moved column Waiting" (polite)');
  await page.keyboard.press('Alt+ArrowRight');
  assert.equal(await fileWhen(core, YML, (t) => !!t && t.indexOf('label: Waiting') > t.indexOf('label: In progress')), original(YML), '⌥→: back, the shipped bytes');
  assert.deepEqual(await focusAt(page), { column: 'Waiting', handle: true }, 'the focus stays on the moved heading');
  const n = (await typePatches(core)).length;
  assert.equal(n, 2, 'one write per move');
  await (await must(handleOf(page, 'To do'), 'the handle of To do')).focus();
  await page.keyboard.press('Alt+ArrowLeft');
  await (await must(handleOf(page, 'Done'), 'the handle of Done')).focus();
  await page.keyboard.press('Alt+ArrowRight');
  await sleep(300);
  assert.equal((await typePatches(core)).length, n, 'at the first and the last status column nothing is written');
  assert.deepEqual(await columnIds(page), ['To do', 'In progress', 'Waiting', 'Done', 'no-status'], 'and nothing moves');
  await onlyTypeFileChanged(core, 'keyboard moves');
});

test('fr_tsk_05_ac18_palette_move_column_left_and_right', async ({ page }) => {
  const core = await startTasks(page);
  await gotoKanban(page, 'Status');
  await (await must(column(page, 'In progress').getByRole('article', { name: 'Task: Poslat rozpočet', exact: true }), 'T02 in In progress')).focus();
  await runCommand(page, 'Move column right');
  assert.equal(await fileWhen(core, YML, (t) => !!t && t.indexOf('label: In progress') > t.indexOf('label: Waiting')), ymlWith(['todo', 'waiting', 'inProgress', 'done', 'cancelled']), 'with a card of In progress focused, `Move column right` moves In progress');
  assert.deepEqual(await eventually(() => columnIds(page), (c) => c[2] === 'In progress', 2000), ['To do', 'Waiting', 'In progress', 'Done', 'no-status'], 'the columns follow');
  assert.ok((await eventually(() => liveTexts(page), (t) => t.includes('Moved column In progress'), 2000)).includes('Moved column In progress'), 'announced');
  await (await must(handleOf(page, 'Waiting'), 'the handle of Waiting')).focus();
  await runCommand(page, 'Move column left');
  assert.equal(await fileWhen(core, YML, (t) => !!t && t.indexOf('label: Waiting') < t.indexOf('label: To do')), ymlWith(['waiting', 'todo', 'inProgress', 'done', 'cancelled']), 'with the Waiting heading focused, `Move column left` moves Waiting');
  assert.deepEqual(await focusAt(page), { column: 'Waiting', handle: true }, 'the focus is on the moved heading');
  const n = (await typePatches(core)).length;
  await (await must(handleOf(page, 'Waiting'), 'the handle of Waiting (now first)')).focus();
  const left = await paletteEntry(page, 'Move column left');
  assert.ok(!left.listed || left.disabled, '`Move column left` at the first column is disabled');
  await (await must(handleOf(page, 'Waiting'), 'the handle of Waiting')).focus();
  await runCommand(page, 'Move column left');
  await sleep(300);
  assert.equal((await typePatches(core)).length, n, 'at the first column the command writes nothing');
  await onlyTypeFileChanged(core, 'palette moves');
});

test('fr_tsk_05_ac18_grouped_by_tag_no_handles_and_the_commands_are_disabled', async ({ page }) => {
  const core = await startTasks(page);
  await gotoKanban(page, 'Status');
  await (await must(handleOf(page, 'Waiting'), `by status: the handle "${DRAG}" of Waiting`)).focus();
  const enabled = await paletteEntry(page, 'Move column right');
  assert.deepEqual(enabled, { listed: true, disabled: false }, 'by status, with a heading focused, `Move column right` is enabled');
  await gotoKanban(page, 'Tag');
  assert.ok(await seen(column(page, '#doma'), 3000), 'setup: the tag columns');
  assert.equal(await handles(page).count(), 0, 'grouped by tag the headings aren\'t drag handles');
  const before = await columnIds(page);
  const heading = await must(headingOf(page, '#doma'), 'the heading of #doma');
  await heading.evaluate((e) => (e as HTMLElement).focus());
  if (await heading.evaluate((e) => document.activeElement === e || e.contains(document.activeElement))) {
    await page.keyboard.press('Alt+ArrowRight');
    await page.keyboard.press('Alt+ArrowLeft');
    await sleep(300);
  }
  assert.deepEqual(await columnIds(page), before, '⌥← / ⌥→ on a tag heading move nothing');
  await (await must(column(page, '#doma').getByRole('article').first(), 'a card in #doma')).focus();
  for (const c of ['Move column left', 'Move column right']) {
    const e = await paletteEntry(page, c);
    assert.ok(!e.listed || e.disabled, `grouped by tag, \`${c}\` is disabled`);
  }
  assert.deepEqual(await writeCalls(core), [], 'nothing written');
});
