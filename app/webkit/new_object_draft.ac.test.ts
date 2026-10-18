// MS5 slice 5A-1 preview feedback, L5 (WebKit + fake core): new objects open unsaved (D-520…D-523).
// docs/acceptance/types.md FR-TYP-09 AC-17 (a)…(f) on the types fixture; docs/acceptance/tasks.md FR-TSK-04 AC-17 (New
// Task focuses the quick-add row) on the tasks fixture. Interface: docs/contracts/ms5-tasks.md §12.2 (route
// `new/<type>`, first-write rules, history, `Not saved yet…`), ms3-shell §14.7.1 (`prepareObject`, `note_create`), the
// fake core's `writeControl({ fail: 'Io' })` (D-510). Written from the ACs and the contracts only (D-61); every lookup
// goes through `must`/node:assert, so a missing element fails an assertion (TS-I1).
//
// ⌘Q in AC-17 (c) and (d) is not reachable in WebKit (quit and its dialogs are L6 only, D-213); the L5 tests cover the
// other leaving gestures and the ⌘S flush, which D-522 lists with quitting.
import { test, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import { draftStatus, mustBeDraft, mustBeOn, nonReadCalls, sidebar, titleState } from './helpers';
import { caretIn, editorBody } from './editor-helpers';
import {
  callsOf, control, eventually, fileText, gotoTypePage, main, must, openTypes, props, runCommand, seen, sleep,
} from './types-helpers';
import {
  gotoTasks, heading, quickAdd, startTasks, swap, tasksVault, viewTab, writeCalls,
} from './tasks-helpers';

test.use({ timezoneId: 'Europe/Prague' });

const OPEN = '2026-10-14T10:00:00+02:00';
const WRITE = '2026-10-14T10:07:00+02:00';
const PLANOVANI = 'Nápady/Plánování.md';
const UNTITLED = 'Nápady/Untitled.md';
const UNTITLED2 = 'Nápady/Untitled (2).md';
const TEMPLATE_BODY = '## Proč na tom záleží\n';

/** FR-TYP-03 AC-12 bytes of a new Nápad, `id` masked. */
const napadBytes = (title: string, at: string, body = TEMPLATE_BODY) =>
  `---\nid: <id>\ntype: nápad\ntitle: ${title}\nhodnocení: 3\nzdroj-nápadu: kniha\nreview: unreviewed\ncreated: ${at}\nmodified: ${at}\n---\n${body}`;
const maskId = (t: string | undefined) => (t ?? '').replace(/^id: \S+$/m, 'id: <id>');

type Core = Awaited<ReturnType<typeof openTypes>>;

async function startAt(page: Page): Promise<Core> {
  await page.clock.setFixedTime(new Date(OPEN));
  return openTypes(page);
}
/** `New Nápad` on `type/nápad` (the button) or the palette command `New Nápad` there; then the draft is shown. */
async function openDraft(page: Page, how: 'button' | 'palette' = 'button') {
  await gotoTypePage(page, 'Nápady');
  if (how === 'button') await (await must(main(page).getByRole('button', { name: 'New Nápad', exact: true }), 'button "New Nápad"')).click();
  else await runCommand(page, 'New Nápad');
  await mustBeDraft(page, `New Nápad (${how})`, 5000);
}
async function noWrites(core: Core, how: string) {
  assert.deepEqual(await core.writesTo(), [], `${how}: no file written`);
  assert.deepEqual(await nonReadCalls(core), [], `${how}: no write command sent`);
}
/** The top-level body block holding the collapsed caret (0-based) and the caret's offset in it; null without one. */
async function caretBlock(page: Page): Promise<{ inBody: boolean; index: number; offset: number } | null> {
  return page.evaluate(() => {
    const body = document.querySelector('[aria-label="Note body"]');
    const sel = window.getSelection();
    const inBody = !!document.activeElement?.closest('[aria-label="Note body"]');
    if (!body || !sel || sel.rangeCount === 0 || !sel.isCollapsed) return null;
    let blk: Node | null = sel.anchorNode;
    while (blk && blk.parentNode !== body) blk = blk.parentNode;
    if (!blk) return { inBody, index: -1, offset: -1 };
    const r = document.createRange();
    r.setStart(blk, 0);
    r.setEnd(sel.anchorNode!, sel.anchorOffset);
    return { inBody, index: [...body.children].indexOf(blk as Element), offset: r.toString().length };
  });
}
/** Text of the centre pane, including the values of its fields (property controls show values in inputs). */
async function mainTextAndValues(page: Page): Promise<string> {
  return main(page).first().evaluate((m) => {
    const out = [m.textContent ?? ''];
    m.querySelectorAll('input, textarea').forEach((i) => out.push((i as HTMLInputElement).value));
    return out.join('\n');
  });
}
async function fieldValue(page: Page, name: string): Promise<string | null> {
  const c = control(page, 'spinbutton', name).or(control(page, 'textbox', name));
  if (!(await seen(c, 2000))) return null;
  return c.first().evaluate((e) => (e instanceof HTMLInputElement || e instanceof HTMLTextAreaElement ? e.value : (e.textContent ?? '')).trim());
}

// ------------------------------------------------------------------------------------------------ FR-TYP-09 AC-17

for (const how of ['button', 'palette'] as const) {
  test(`fr_typ_09_ac17_new_napad_${how}_opens_an_unsaved_draft_with_template_and_defaults`, async ({ page }) => {
    const core = await startAt(page);
    await openDraft(page, how);
    const body = await must(editorBody(page), 'textbox "Note body" of the draft');
    await must(body.getByRole('heading', { level: 2, name: 'Proč na tom záleží', exact: true }), 'the template body "## Proč na tom záleží"');
    await must(props(page), 'region "Properties"');
    assert.equal(await fieldValue(page, 'Hodnocení'), '3', 'Hodnocení shows its default 3');
    const other = page.getByRole('button', { name: /^Other properties \(\d+\)$/ });
    if (await seen(other, 500)) await other.first().click();
    assert.ok((await mainTextAndValues(page)).includes('kniha'), 'Zdroj nápadu shows kniha');
    await sleep(500);
    await noWrites(core, 'opening the draft');
  });
}

test('fr_typ_09_ac17_a_title_typing_writes_nothing_then_enter_writes_the_file_once', async ({ page }) => {
  const core = await startAt(page);
  await openDraft(page);
  await page.evaluate(() => { (window as any).__teggSamePage = 'kept'; });
  const callsBefore = (await core.calls()).length;
  await page.keyboard.type('Plánování');
  await sleep(2000);
  await noWrites(core, '(a) 2 s after typing the title');
  await page.clock.setFixedTime(new Date(WRITE));
  await page.keyboard.press('Enter');
  const t = await eventually(() => fileText(core, PLANOVANI), (x) => x !== undefined, 3000);
  assert.equal(maskId(t), napadBytes('Plánování', WRITE), '(a) FR-TYP-03 AC-12 bytes, created/modified at the write time');
  await sleep(1000);
  assert.deepEqual(await core.writesTo(), [PLANOVANI], '(a) written once');
  assert.equal((await callsOf(core, 'note_create')).length, 1, '(a) one note_create');
  const after = (await core.calls()).slice(callsBefore).map((c) => c.cmd);
  assert.deepEqual(after.filter((c) => c.startsWith('job_') || c === 'note_rename'), [], '(a) no rename job runs');
  await mustBeOn(page, 'Plánování', '(a) the note', 3000);
  const nav = (await callsOf(core, 'nav_opened')).map((c) => String((c.args as any)?.path ?? '').normalize('NFC'));
  assert.ok(nav.includes(PLANOVANI), `(a) the route becomes note/${PLANOVANI}: ${JSON.stringify(nav)}`);
  assert.equal(await page.evaluate(() => (window as any).__teggSamePage ?? null), 'kept', '(a) on the same page (no reload)');
  const c = await eventually(() => caretBlock(page), (x) => !!x && x.inBody, 1000);
  assert.deepEqual(c && { inBody: c.inBody, index: c.index }, { inBody: true, index: 0 }, '(a) the caret is in the first body block');
  assert.equal(await seen(draftStatus(page), 300), false, '(a) the "Not saved yet" status is gone');
});

test('fr_typ_09_ac17_b_body_typing_with_an_empty_title_writes_untitled', async ({ page }) => {
  const core = await startAt(page);
  for (const [path, n] of [[UNTITLED, 1], [UNTITLED2, 2]] as const) {
    await openDraft(page);
    await caretIn(page, 1, null, true);
    await page.keyboard.type('X');
    const t = await eventually(() => fileText(core, path), (x) => x !== undefined, 2000);
    assert.ok(t !== undefined, `(b) draft ${n}: ${path} is written within 2 s`);
    assert.equal(maskId(t), napadBytes('Untitled', OPEN, '## XProč na tom záleží\n'), `(b) draft ${n}: title: Untitled and the typed body`);
    assert.equal((await eventually(() => titleState(page), (s) => s.text === 'Untitled', 1000)).text, 'Untitled', `(b) draft ${n}: the title field shows Untitled`);
  }
  assert.deepEqual(await core.writesTo(), [UNTITLED, UNTITLED2], '(b) one creation each, nothing else');
});

test('fr_typ_09_ac17_c_leaving_an_unchanged_draft_writes_nothing', async ({ page }) => {
  const core = await startAt(page);
  await openDraft(page);
  await sidebar(page).getByText('Inbox', { exact: true }).click();
  await mustBeOn(page, 'Inbox', '(c) leave by the sidebar');
  await openDraft(page);
  await (await must(page.getByRole('button', { name: 'Back', exact: true }), 'title-bar Back')).click({ force: true });
  await mustBeOn(page, 'Nápady', '(c) leave by Back');
  await openDraft(page);
  await page.keyboard.type('Rozmyšlený');
  await sleep(200);
  for (let i = 0; i < 'Rozmyšlený'.length; i++) await page.keyboard.press('Backspace');
  assert.equal((await eventually(() => titleState(page), (s) => s.text === '', 1000)).text, '', 'setup: the title is cleared');
  await sidebar(page).getByText('Inbox', { exact: true }).click();
  await mustBeOn(page, 'Inbox', '(c) leave after clearing the title');
  await sleep(1500);
  await noWrites(core, '(c) unchanged drafts left by the sidebar, Back, and a typed-then-cleared title');
});

for (const flush of ['cmd_s', 'leaving'] as const) {
  test(`fr_typ_09_ac17_d_an_uncommitted_title_is_written_once_by_a_flush_${flush}`, async ({ page }) => {
    const core = await startAt(page);
    await openDraft(page);
    await page.keyboard.type('Plánování');
    await sleep(300);
    assert.deepEqual(await core.writesTo(), [], 'setup: the typed title is not written yet');
    if (flush === 'cmd_s') await page.keyboard.press('Meta+s');
    else {
      await sidebar(page).getByText('Inbox', { exact: true }).click();
      await mustBeOn(page, 'Inbox', 'leave');
    }
    const t = await eventually(() => fileText(core, PLANOVANI), (x) => x !== undefined, 3000);
    assert.equal(maskId(t), napadBytes('Plánování', OPEN), `(d) ${flush} writes the draft with its title`);
    await sleep(1500);
    assert.deepEqual(await core.writesTo(), [PLANOVANI], `(d) ${flush}: written once`);
    assert.deepEqual(await callsOf(core, 'note_rename'), [], `(d) ${flush}: no rename`);
  });
}

test('fr_typ_09_ac17_e_back_and_forward_never_return_to_a_draft', async ({ page }) => {
  const core = await startAt(page);
  const back = () => must(page.getByRole('button', { name: 'Back', exact: true }), 'title-bar Back');
  const fwd = () => must(page.getByRole('button', { name: 'Forward', exact: true }), 'title-bar Forward');
  const fwdDisabled = async () => (await (await fwd()).getAttribute('aria-disabled')) === 'true';
  await openDraft(page);
  await (await back()).click({ force: true });
  await mustBeOn(page, 'Nápady', '(e) Back from the draft shows type/nápad');
  assert.equal(await eventually(fwdDisabled, (x) => x, 1000), true, '(e) Forward is disabled after Back from an unwritten draft');
  await (await must(main(page).getByRole('button', { name: 'New Nápad', exact: true }), 'New Nápad')).click();
  await mustBeDraft(page, 'New Nápad again');
  await page.keyboard.type('Plánování');
  await page.keyboard.press('Enter');
  await mustBeOn(page, 'Plánování', 'after (a)', 5000);
  await eventually(() => fileText(core, PLANOVANI), (x) => x !== undefined, 3000);
  await (await back()).click({ force: true });
  await mustBeOn(page, 'Nápady', '(e) Back from the written note shows type/nápad');
  assert.equal(await eventually(fwdDisabled, (x) => !x, 1000), false, '(e) Forward is enabled');
  await (await fwd()).click({ force: true });
  await mustBeOn(page, 'Plánování', '(e) Forward shows the new note');
  assert.equal(await eventually(fwdDisabled, (x) => x, 1000), true, '(e) the note is the last entry');
  // Walk the whole history both ways: the draft is never shown again.
  const shown: string[] = [];
  for (let i = 0; i < 6; i++) {
    const b = await back();
    if ((await b.getAttribute('aria-disabled')) === 'true') break;
    await b.click({ force: true });
    await sleep(400);
    if (await seen(draftStatus(page), 200)) shown.push(`back ${i + 1}`);
  }
  for (let i = 0; i < 6; i++) {
    if (await fwdDisabled()) break;
    await (await fwd()).click({ force: true });
    await sleep(400);
    if (await seen(draftStatus(page), 200)) shown.push(`forward ${i + 1}`);
  }
  assert.deepEqual(shown, [], '(e) new/nápad is never shown again by Back or Forward');
  assert.deepEqual(await core.writesTo(), [PLANOVANI], 'only the one creation was written');
});

test('fr_typ_09_ac17_f_an_io_failure_of_the_first_write_keeps_the_draft', async ({ page }) => {
  const core = await startAt(page);
  await openDraft(page);
  await core.writeControl({ fail: 'Io' });
  await page.keyboard.type('Plánování');
  await page.keyboard.press('Enter');
  const failed = await eventually(() => callsOf(core, 'note_create'), (c) => c.some((x) => x.ok === false), 3000);
  assert.ok(failed.some((x) => x.ok === false), '(f) the first write was attempted and failed (Io)');
  await must(page.getByRole('alert'), '(f) the save alert');
  assert.equal(await fileText(core, PLANOVANI), undefined, '(f) nothing written');
  assert.equal((await titleState(page)).text, 'Plánování', '(f) the draft keeps its title text');
  await core.writeControl({ fail: null });
  await caretIn(page, 1, null, true);
  await page.keyboard.type('X');
  const t = await eventually(() => fileText(core, PLANOVANI), (x) => x !== undefined, 3000);
  assert.equal(maskId(t), napadBytes('Plánování', OPEN, '## XProč na tom záleží\n'), '(f) the next change writes it');
  assert.deepEqual(await core.writesTo(), [PLANOVANI], '(f) written once');
});

// ------------------------------------------------------------------------------------------------ FR-TSK-04 AC-17

async function quickAddFocused(page: Page): Promise<boolean> {
  if (!(await seen(quickAdd(page), 3000))) return false;
  return eventually(() => quickAdd(page).first().evaluate((e) => e === document.activeElement || e.contains(document.activeElement)), (x) => x, 2000);
}
async function selectedTab(page: Page, name: 'Schedule' | 'Kanban'): Promise<boolean> {
  if (!(await seen(viewTab(page, name), 3000))) return false;
  return (await eventually(() => viewTab(page, name).first().getAttribute('aria-selected'), (v) => v === 'true', 2000)) === 'true';
}
async function expectTasksWithQuickAdd(page: Page, view: 'Schedule' | 'Kanban', how: string) {
  await must(heading(page), `${how}: heading "Tasks"`, 5000);
  assert.ok(await selectedTab(page, view), `${how}: the ${view} view (tasks${view === 'Kanban' ? '/kanban' : ''})`);
  assert.ok(await quickAddFocused(page), `${how}: the caret is in "Add a task…" (document.activeElement)`);
  assert.equal(await page.getByRole('dialog').count(), 0, `${how}: no dialog opens`);
  assert.equal(await seen(draftStatus(page), 300), false, `${how}: no draft route is shown`);
}

test('fr_tsk_04_ac17_new_task_on_all_tasks_opens_the_schedule_with_the_caret_in_quick_add', async ({ page }) => {
  const core = await startTasks(page);
  await gotoTasks(page);
  for (const how of ['button', 'palette'] as const) {
    await (await must(viewTab(page, 'All tasks'), 'tab All tasks')).click();
    await must(main(page).getByRole('button', { name: 'New Task', exact: true }), 'New Task on type/task', 5000);
    if (how === 'button') await main(page).getByRole('button', { name: 'New Task', exact: true }).click();
    else await runCommand(page, 'New Task');
    await expectTasksWithQuickAdd(page, 'Schedule', `New Task (${how})`);
  }
  await sleep(500);
  assert.deepEqual(await writeCalls(core), [], 'nothing is written');
});

test('fr_tsk_04_ac17_new_task_opens_the_kanban_when_it_was_the_last_view_shown', async ({ page }) => {
  const core = await startTasks(page);
  await gotoTasks(page);
  await (await must(viewTab(page, 'Kanban'), 'tab Kanban')).click();
  assert.ok(await selectedTab(page, 'Kanban'), 'setup: the Kanban is shown');
  await (await must(viewTab(page, 'All tasks'), 'tab All tasks')).click();
  await (await must(main(page).getByRole('button', { name: 'New Task', exact: true }), 'New Task on type/task', 5000)).click();
  await expectTasksWithQuickAdd(page, 'Kanban', 'New Task after the Kanban');
  await sleep(500);
  assert.deepEqual(await writeCalls(core), [], 'nothing is written');
});

test('fr_tsk_04_ac17_new_object_with_default_type_task_focuses_quick_add', async ({ page }) => {
  const vault = tasksVault((f) => { f['.tegg/vault.yml'] = swap(f['.tegg/vault.yml'], 'default-type: Quick Note', 'default-type: Task'); });
  const core = await startTasks(page, { vault });
  await page.keyboard.press('Meta+n');
  await expectTasksWithQuickAdd(page, 'Schedule', '⌘N with default type Task');
  await sidebar(page).getByText('Inbox', { exact: true }).click();
  await mustBeOn(page, 'Inbox', 'leave');
  await (await must(sidebar(page).getByRole('button', { name: /^New object/ }), 'sidebar button "New object"')).click();
  await expectTasksWithQuickAdd(page, 'Schedule', 'sidebar New object with default type Task');
  await sleep(500);
  assert.deepEqual(await writeCalls(core), [], 'nothing is written');
});
