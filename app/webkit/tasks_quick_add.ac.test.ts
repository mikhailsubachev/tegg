// MS5 slice 5A-1, L5 (WebKit + fake core): the quick-add row. FR-TSK-10 AC-1 (create through the one creation path),
// AC-3 (Clear puts the word back), AC-4 (presets by place, W), AC-6 (nothing to create), AC-7 (failure).
// docs/acceptance/tasks.md (R40, R46); interface docs/contracts/ms5-tasks.md §5 (`createObject` → `note_create`, D-245,
// values, D-470), §6.4 (parsing). Clock 2026-10-14T12:00:00+02:00, Europe/Prague. Written from the ACs and the
// contract only (D-61).
import { test, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import {
  NOW, callsOf, cardPaths, click, eventually, fileText, fileWhen, gotoKanban, gotoTasks, groupsOf, liveTexts, main, mainName, must, quickAdd, sectionOf,
  seen, shortDate, sleep, startTasks, textOf, writeCalls,
} from './tasks-helpers';

test.use({ timezoneId: 'Europe/Prague' });

const chip = (page: Page, re: RegExp) => main(page).getByRole('status').filter({ hasText: re });
const AC1 = (id: string) => `---\nid: ${id}\ntype: task\ntitle: Zavolat do servisu\nstatus: To do\npriority: High\ndue: 2026-10-15\ntags: [auto]\ncreated: ${NOW}\nmodified: ${NOW}\n---\n`;
async function created(core: Awaited<ReturnType<typeof startTasks>>) {
  return (await callsOf(core, 'note_create')).filter((c) => c.ok !== false);
}

test('fr_tsk_10_ac1_quick_add_creates_one_task', async ({ page }) => {
  const core = await startTasks(page);
  await gotoTasks(page);
  const field = await must(quickAdd(page), 'textbox "Add a task…"');
  await field.fill('Zavolat do servisu tomorrow #auto !high');
  assert.ok(await seen(chip(page, new RegExp(`^\\s*Due · ${shortDate('2026-10-15', 'cs')}`))), 'chip Due · <Thu 15 Oct> before ↩');
  assert.ok(await seen(chip(page, /^\s*Priority · High/)), 'chip Priority · High');
  await field.press('Enter');
  const c = await eventually(() => created(core), (x) => x.length === 1);
  assert.equal(c.length, 1, 'one note_create (the one creation path, D-245)');
  assert.equal(String((c[0].args as any).type), 'task');
  const text = await fileWhen(core, 'Tasks/Zavolat do servisu.md', (t) => t !== undefined);
  const id = /^id: (\S+)$/m.exec(text ?? '')?.[1] ?? '';
  assert.match(id, /^[0-9A-HJKMNP-TV-Z]{26}$/, 'a new ULID');
  assert.equal(text, AC1(id), 'exactly the FR-TSK-10 AC-1 bytes');
  assert.equal(await fileText(core, 'Tags/auto.md'), undefined, 'no Tags/auto.md (D-185)');
  assert.ok(await eventually(async () => (await groupsOf(sectionOf(page, 'week')))[0]?.paths.includes('Tasks/Zavolat do servisu.md') ?? false, (x) => x, 1000), 'within 1 s the card is in This week › Thu 15');
  assert.ok((await liveTexts(page)).includes('Created "Zavolat do servisu"'), 'live region');
  assert.equal(await field.inputValue(), '', 'the field is empty');
  assert.ok(await field.evaluate((e) => e === document.activeElement), 'and keeps the focus');
  assert.ok(await seen(chip(page, /^\s*Due · Today/)) && await seen(chip(page, /^\s*Priority · None/)), 'chips back to the presets');
  assert.equal(await mainName(page), 'Tasks', 'the page does not navigate');
});

test('fr_tsk_10_ac3_clear_puts_the_word_back', async ({ page }) => {
  const core = await startTasks(page);
  await gotoTasks(page);
  const field = await must(quickAdd(page), 'quick-add');
  await field.fill('Pay rent today');
  await click(main(page).getByRole('button', { name: 'Clear due date', exact: true }), 'Clear due date');
  assert.equal(await field.inputValue(), 'Pay rent today', 'the word is shown again in the title');
  assert.ok(await seen(chip(page, /^\s*Due · None/)), 'Due · None');
  await field.press('Enter');
  const t = await fileWhen(core, 'Tasks/Pay rent today.md', (x) => x !== undefined);
  assert.ok(t && /^title: Pay rent today$/m.test(t) && !/^due:/m.test(t), `title "Pay rent today", no due: ${t}`);
  await field.fill('Pay rent !high');
  await click(main(page).getByRole('button', { name: 'Clear priority', exact: true }), 'Clear priority');
  await field.press('Enter');
  const t2 = await fileWhen(core, 'Tasks/Pay rent !high.md', (x) => x !== undefined);
  assert.ok(t2 && /^title: Pay rent !high$/m.test(t2) && !/^priority:/m.test(t2), `title keeps !high, no priority: ${t2}`);
});

for (const [region, last] of [['cs', '2026-10-18'], ['en-US', '2026-10-17']] as const) {
  test(`fr_tsk_10_ac4_presets_by_place_${region.replace('-', '_')}`, async ({ page }) => {
    const core = await startTasks(page, { region });
    await gotoTasks(page);
    assert.ok(await seen(chip(page, /^\s*Due · Today/)), 'Schedule top row: Due · Today');
    const add = async (button: string, title: string) => {
      await click(main(page).getByRole('button', { name: button, exact: true }), button);
      const f = await must(main(page).locator('input:focus, textarea:focus'), `${button}: a focused field in its section`);
      await f.fill(title);
      await f.press('Enter');
      return fileWhen(core, `Tasks/${title.replace(/ (tomorrow)$/, '')}.md`, (x) => x !== undefined);
    };
    assert.match((await add('New task due today', 'Úkol dnes')) ?? '', /^due: 2026-10-14$/m, 'New task due today');
    assert.match((await add('New task this week', 'Úkol týden')) ?? '', new RegExp(`^due: ${last}$`, 'm'), `New task this week: the last day shown (${last})`);
    const none = await add('New task without a date', 'Úkol bez data');
    assert.ok(none !== undefined && !/^due:/m.test(none), 'New task without a date');
    assert.match((await add('New task without a date', 'Úkol zítra tomorrow')) ?? '', /^due: 2026-10-15$/m, 'a typed token overrides the preset');
    const top = await must(quickAdd(page), 'quick-add');
    await top.fill('Bez termínu');
    await click(main(page).getByRole('button', { name: 'Clear due date', exact: true }), 'Clear due date on the preset');
    await top.press('Enter');
    const t = await fileWhen(core, 'Tasks/Bez termínu.md', (x) => x !== undefined);
    assert.ok(t !== undefined && !/^due:/m.test(t), 'Clear due date on a preset leaves no due');
    await gotoKanban(page, 'Status');
    assert.ok(await seen(chip(page, /^\s*Due · None/)), 'Kanban top row: Due · None');
  });
}

test('fr_tsk_10_ac6_nothing_to_create', async ({ page }) => {
  const core = await startTasks(page);
  await gotoTasks(page);
  const field = await must(quickAdd(page), 'quick-add');
  for (const v of ['', '   ', '#x !high tomorrow']) {
    await field.fill(v);
    await field.press('Enter');
    await sleep(150);
    assert.ok(await seen(main(page).getByText('Add a title', { exact: true }), 1000), `"${v}": Add a title`);
  }
  await field.fill('Něco');
  await field.press('Escape');
  assert.equal(await field.inputValue(), '', 'Esc clears the field');
  assert.deepEqual(await created(core), [], 'nothing created');
  assert.deepEqual(await writeCalls(core), [], 'nothing written');
});

test('fr_tsk_10_ac7_a_failed_create', async ({ page }) => {
  const core = await startTasks(page);
  await gotoTasks(page);
  await core.writeControl({ fail: 'Io' });
  const field = await must(quickAdd(page), 'quick-add');
  await field.fill('Zavolat do servisu tomorrow');
  await field.press('Enter');
  const alert = await must(page.getByRole('alert').filter({ hasText: 'Couldn’t save "Zavolat do servisu". Try again.' }), 'the save alert', 2000);
  assert.equal(await field.inputValue(), 'Zavolat do servisu tomorrow', 'the text stays in the field');
  assert.equal(Object.keys(await core.files()).filter((p) => p.startsWith('Tasks/Zavolat do servisu')).length, 0, 'no file or temp file');
  await core.writeControl({ fail: null });
  await click(alert.getByRole('button', { name: 'Try again', exact: true }), 'Try again');
  assert.ok(await fileWhen(core, 'Tasks/Zavolat do servisu.md', (x) => x !== undefined), 'Try again creates it');
  void cardPaths; void textOf;
});
