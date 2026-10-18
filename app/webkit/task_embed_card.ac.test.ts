// MS5 slice 5A-2, L5 (WebKit + fake core): the Task card (D-74). docs/acceptance/conversion.md FR-CNV-05 AC-1…AC-10 and
// table R52: header controls (checkbox, title, Status, Priority, Due, Open, Display as), writes through tasks/write.ts
// with the card's version as base, the body as a nested editor with the `Add details…` hint, conflicts, two cards of one
// task, read-only places and the non-editable title. Interface docs/contracts/ms5-tasks.md §11.5 (TaskEmbed, taskHeader,
// EmbedStore `peerWrote`, D-509 hooks `data-status`, `data-priority`, `data-due`, `data-tone`), §5 (task writes),
// ms4-embeds §6–§9 (R30 frame, `data-embed-depth`, `data-embed-body`, `data-embed-editable`). Written from the ACs and
// the contracts only (D-61). Test clock 2026-10-14T12:00:00+02:00, Europe/Prague, region cs.
import { test, type Locator, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import { shortDate } from './tasks-helpers';
import {
  C, NOW, alertWith, cardCheckbox, caretAfter, caretAt, convertVault, description, displayAsButton, dueButton, embedBody, eventually, fileText,
  fileWhen, flat, focusInside, isDisabled, main, menuItem, mergeDialog, must, mustBeOn, nameOf, needCard, nfc, openButton, openConvert, original,
  priorityButton, runCommand, seen, selectTop, selectedBlocks, sleep, statusButton, swap, tabOrder, topIndexOf, touched, writeLog, writesOf,
  type FakeCoreHandle,
  switchTo,
} from './convert-helpers';

test.use({ timezoneId: 'Europe/Prague' });

const T01 = C.t01;
const J = 'Zavolat Janě';
const T01_0 = original(T01);
const DUE_09 = `${shortDate('2026-10-09', 'cs')} · 5 days overdue`;
/** T01 after the checkbox (tasks.md FR-TSK-02 AC-10 bytes, ms5-tasks §5). */
const T01_DONE = swap(swap(T01_0, 'status: To do', 'status: Done'), 'modified: 2026-10-01T09:00:00+02:00\n', `modified: ${NOW}\ncompleted: ${NOW}\n`);
const READ_ONLY = 'This task can\'t be edited here.';

/** The header title element of a card: its text, line-through, editability. */
async function titleInfo(card: Locator, title: string) {
  return card.evaluate((root, t) => {
    const all = [...root.querySelectorAll('*')].filter((e) => !e.closest('[data-embed-body], button, [role="button"], [role="checkbox"], [role="menu"]'));
    const el = all.find((e) => (e.textContent ?? '').trim().normalize('NFC') === t && ![...e.children].some((c) => (c.textContent ?? '').trim().normalize('NFC') === t)) as HTMLElement | undefined;
    if (!el) return null;
    let struck = false;
    for (let x: HTMLElement | null = el; x && x !== root; x = x.parentElement) if (getComputedStyle(x).textDecorationLine.includes('line-through')) struck = true;
    const headerTextboxes = [...root.querySelectorAll('[role="textbox"], input, textarea, [contenteditable="true"]')].filter((e) => !e.closest('[data-embed-body]')).length;
    return { struck, editable: el.isContentEditable, role: el.getAttribute('role'), headerTextboxes };
  }, nfc(title));
}
async function poradaCard(page: Page, o: Parameters<typeof openConvert>[2] = {}): Promise<{ core: FakeCoreHandle; card: Locator }> {
  const core = await openConvert(page, C.porada, o);
  return { core, card: await needCard(main(page), J) };
}
async function choose(page: Page, button: Locator, item: string, what: string) {
  await (await must(button, `${what} button`)).click();
  await (await must(menuItem(page, item), `${what} › ${item}`)).click();
}
const writeCount = async (core: FakeCoreHandle) => (await writesOf(core, T01)).length;

// ------------------------------------------------------------------------------------------------ AC-1

test('fr_cnv_05_ac1_the_task_card_on_porada', async ({ page }) => {
  const { card } = await poradaCard(page);
  assert.equal(await card.getAttribute('data-embed-mode'), 'card', 'R30 frame in card mode');
  const box = await must(cardCheckbox(card, J), 'the checkbox');
  assert.equal(await nameOf(box), `Complete "${J}"`, 'Complete "Zavolat Janě"');
  assert.equal(await box.getAttribute('aria-checked'), 'false', 'unchecked');
  const ti = await titleInfo(card, J);
  assert.ok(ti, 'the title text Zavolat Janě');
  assert.equal(await nameOf(statusButton(card)), 'Status: To do', 'Status: To do');
  assert.equal(await statusButton(card).getAttribute('aria-haspopup'), 'menu', 'Status opens a menu');
  assert.equal(await nameOf(priorityButton(card)), 'Priority: High', 'Priority: High');
  assert.equal(await priorityButton(card).getAttribute('aria-haspopup'), 'menu', 'Priority opens a menu');
  const due = await nameOf(dueButton(card));
  assert.ok(due.startsWith(`Due: ${DUE_09}`), `Due: <Fri 9 Oct in cs> · 5 days overdue: ${due}`);
  assert.equal(await card.locator('[data-tone]').first().getAttribute('data-tone'), 'overdue', 'the overdue highlight (D-509)');
  await must(openButton(card, J), 'Open Zavolat Janě');
  await must(displayAsButton(card), 'Display as');
  const body = await must(embedBody(card), 'the body');
  assert.equal(flat(await body.innerText()), 'Domluvit schůzku na příští týden.', 'the body below the header');
  assert.equal(await body.getAttribute('data-embed-editable'), 'true', 'editable');
  assert.equal(await card.getByRole('list', { name: 'Properties', exact: true }).count(), 0, 'no preview strip on a Task card');
});

test('fr_cnv_05_ac1_full_and_link_keep_the_4f_frames', async ({ page }) => {
  const vault = convertVault((f) => { f[C.dveKarty] = `${f[C.dveKarty]}\n\n![[Zavolat Janě|full]]\n\n![[Zavolat Janě|link]]\n`; });
  await openConvert(page, C.dveKarty, { vault });
  await needCard(main(page), J, 'the plain embed is a Task card');
  const modes = await eventually(() => main(page).evaluate(() => [...document.querySelectorAll('[data-embed-mode]')]
    .filter((e) => !e.parentElement?.closest('[data-embed-mode]'))
    .map((e) => `${e.getAttribute('data-embed-mode')}${e.hasAttribute('data-task-card') ? '+task' : ''}`)), (m) => m.length >= 4, 5000);
  assert.deepEqual(modes, ['card+task', 'card+task', 'full', 'link'], '|full is the 4F full frame and |link the 4F link-mode embed, without the Task card');
});

// ------------------------------------------------------------------------------------------------ AC-2

test('fr_cnv_05_ac2_checkbox_writes_only_the_task', async ({ page }) => {
  const { core, card } = await poradaCard(page, { tasksUi: { view: 'schedule', groupBy: 'status', dateFilter: 'all', tags: [], doneExpanded: true } });
  await (await must(cardCheckbox(card, J), 'checkbox')).click();
  assert.equal(await fileWhen(core, T01, (t) => t !== T01_0, 2000), T01_DONE, 'status: Done, completed, modified (FR-TSK-02 AC-10)');
  assert.equal(await eventually(() => nameOf(statusButton(card)), (n) => n === 'Status: Done', 1000), 'Status: Done', 'within 1 s: Status: Done');
  assert.equal(await nameOf(cardCheckbox(card, J)), `Mark "${J}" not done`, 'Mark "Zavolat Janě" not done');
  assert.equal((await titleInfo(card, J))?.struck, true, 'the title is struck through');
  await sleep(1200);
  assert.deepEqual(await writesOf(core, C.porada), [], 'Porada isn\'t written');
  assert.deepEqual([...new Set(await writeLog(core))], [`note_write ${T01}`], 'only Tasks/Zavolat Janě.md');
  await runCommand(page, 'Go to Tasks');
  const done = main(page).locator('[data-section="done"]');
  await must(done, 'the Done section', 5000);
  assert.ok(await seen(done.locator(`[data-path="${nfc(T01)}"]`), 3000), 'the Tasks page shows T01 in Done');
});

// ------------------------------------------------------------------------------------------------ AC-3

test('fr_cnv_05_ac3_status_from_the_card', async ({ page }) => {
  const { core, card } = await poradaCard(page);
  const base = await core.version(T01);
  await choose(page, statusButton(card), 'Waiting', 'Status');
  assert.equal(await fileWhen(core, T01, (t) => t !== T01_0), touched(swap(T01_0, 'status: To do', 'status: Waiting')), 'only status and modified');
  const w = await writesOf(core, T01);
  assert.equal(w.length, 1, 'one note_write');
  assert.deepEqual((w[0].args as any).base, base, 'with the card\'s version as base');
  const items = (await (async () => { await statusButton(card).click(); await sleep(150); return page.getByRole('menuitemradio').allInnerTexts(); })()).map(flat);
  assert.deepEqual(items, ['To do', 'In progress', 'Waiting', 'Done', 'Cancelled'], 'one menuitemradio per status option, in order');
  await (await must(menuItem(page, 'Waiting'), 'the current status')).click();
  await sleep(400);
  assert.equal(await writeCount(core), 1, 'an equal value writes nothing');
});

test('fr_cnv_05_ac3_priority_from_the_card', async ({ page }) => {
  const { core, card } = await poradaCard(page);
  await (await must(priorityButton(card), 'Priority')).click();
  assert.deepEqual((await page.getByRole('menuitemradio').allInnerTexts()).map(flat), ['High', 'Medium', 'Low', 'None', 'No priority'], 'options plus No priority');
  await (await must(menuItem(page, 'No priority'), 'No priority')).click();
  assert.equal(await fileWhen(core, T01, (t) => t !== T01_0), touched(swap(T01_0, 'priority: High\n', '')), 'the priority line is removed');
  assert.equal(await eventually(() => nameOf(priorityButton(card)), (n) => n === 'Priority: None', 1000), 'Priority: None', 'Priority: None');
  assert.equal(await writeCount(core), 1, 'one write');
});

test('fr_cnv_05_ac3_due_and_clear_from_the_card', async ({ page }) => {
  const { core, card } = await poradaCard(page);
  await (await must(dueButton(card), 'Due')).click();
  const input = await must(page.getByRole('textbox', { name: 'Due date', exact: true }).last(), 'the attribute panel\'s date control');
  await input.fill('20. 10. 2026');
  await input.press('Enter');
  const t = await fileWhen(core, T01, (x) => x !== T01_0);
  assert.equal(t, touched(swap(T01_0, 'due: 2026-10-09', 'due: 2026-10-20')), 'due: 2026-10-20 (FR-FMT-11)');
  assert.notEqual(await eventually(() => card.locator('[data-tone]').first().getAttribute('data-tone'), (x) => x !== 'overdue', 1000), 'overdue', 'the overdue highlight disappears');
  await page.keyboard.press('Escape');
  await (await must(dueButton(card), 'Due')).click();
  await (await must(page.getByRole('button', { name: 'Clear', exact: true }).last(), 'Clear')).click();
  const c = await fileWhen(core, T01, (x) => !!x && !/^due:/m.test(x));
  assert.equal(c, touched(swap(T01_0, 'due: 2026-10-09\n', '')), 'Clear removes due');
  assert.equal(await writeCount(core), 2, 'one note_write per change');
  assert.equal(await eventually(() => nameOf(dueButton(card)), (n) => n === 'Due: None', 1000), 'Due: None', 'Due: None');
});

// ------------------------------------------------------------------------------------------------ AC-4

test('fr_cnv_05_ac4_header_controls_by_keyboard', async ({ page }) => {
  const { core, card } = await poradaCard(page);
  await caretAfter(page, 'Objednat projektor');
  await page.keyboard.press('ArrowDown');
  const n = await topIndexOf(page, J);
  let sel = await selectedBlocks(page);
  if (!sel.includes(n)) sel = await selectTop(page, n);
  assert.deepEqual(sel, [n], 'the card is selected as a block');
  const order = await tabOrder(page, card, 6);
  assert.deepEqual(order.slice(0, 3).concat(order[3]?.startsWith('Due: ') ? ['Due'] : [order[3]], order.slice(4)),
    [`Complete "${J}"`, 'Status: To do', 'Priority: High', 'Due', `Open ${J}`, 'Display as'], 'Tab: checkbox, Status, Priority, Due, Open, Display as');
  for (let i = 0; i < 5; i++) await page.keyboard.press('Shift+Tab');
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? ''), `Complete "${J}"`, 'back on the checkbox');
  await page.keyboard.press('Space');
  assert.equal(await fileWhen(core, T01, (t) => t !== T01_0, 2000), T01_DONE, 'Space toggles the checkbox');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Enter');
  await must(page.getByRole('menu'), 'Enter on Status opens its menu');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Escape');
  assert.ok((await page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? '')).startsWith('Status: '), 'Esc returns the focus to the Status button');
  sel = await selectTop(page, n);
  assert.deepEqual(sel, [n], 'selected again');
  await page.keyboard.press('Enter');
  assert.equal(await eventually(() => focusInside(embedBody(card)), (x) => x, 1000), true, '⏎ on the selected card enters the body (FR-EMB-02 AC-14)');
});

// ------------------------------------------------------------------------------------------------ AC-5, AC-6

test('fr_cnv_05_ac5_body_edits_write_the_task_only', async ({ page }) => {
  const { core, card } = await poradaCard(page);
  assert.ok(await caretAt(embedBody(card), 'týden.'), 'caret at the end of the body');
  await page.keyboard.type(' Zítra.');
  const t = await fileWhen(core, T01, (x) => !!x?.includes('Zítra.'), 1500);
  assert.equal(t, touched(swap(T01_0, 'příští týden.', 'příští týden. Zítra.')), 'body line and modified only; frontmatter otherwise byte-identical');
  await sleep(1200);
  assert.deepEqual(await writesOf(core, C.porada), [], 'Porada isn\'t written');
});

test('fr_cnv_05_ac6_an_empty_body_shows_add_details', async ({ page }) => {
  const task = 'Tasks/Koupit lepidlo (2).md';
  const text = `---\nid: 01JB5A0000000000000000W601\ntype: task\ntitle: Koupit lepidlo\nstatus: To do\nsource: "[[Bloky]]"\ncreated: ${NOW}\nmodified: ${NOW}\n---\n`;
  const vault = convertVault((f) => { f[task] = text; f[C.bloky] = swap(f[C.bloky], '- [ ] Koupit lepidlo\n- [x] Vrátit nářadí', '![[Koupit lepidlo (2)]]\n\n- [x] Vrátit nářadí'); });
  const core = await openConvert(page, C.bloky, { vault });
  const card = await needCard(main(page), 'Koupit lepidlo');
  const body = await must(embedBody(card), 'the body');
  const hint = await must(body.getByText('Add details…', { exact: true }), 'the hint Add details…');
  const muted = await hint.evaluate((e) => { const p = document.createElement('span'); p.style.color = 'var(--muted)'; document.body.appendChild(p); const want = getComputedStyle(p).color; p.remove(); return getComputedStyle(e).color === want || getComputedStyle(e, '::before').color === want; });
  assert.equal(muted, true, 'in the muted colour');
  assert.equal(await body.getAttribute('data-embed-editable'), 'true', 'an editable empty paragraph');
  await hint.click();
  await sleep(1300);
  assert.deepEqual(await writesOf(core, task), [], 'focusing it writes nothing');
  await page.keyboard.type('Nejlépe Herkules.');
  const t = await fileWhen(core, task, (x) => !!x?.includes('Herkules'), 2000);
  assert.equal(t, `${text}Nejlépe Herkules.\n`, 'the body Nejlépe Herkules.\\n only (modified already NOW)');
  await sleep(1200);
  assert.deepEqual(await writesOf(core, C.bloky), [], 'Bloky isn\'t written');
});

// ------------------------------------------------------------------------------------------------ AC-7

test('fr_cnv_05_ac7_a_silent_external_change_is_a_conflict', async ({ page }) => {
  const { core, card } = await poradaCard(page);
  const ext = swap(T01_0, 'priority: High', 'priority: Medium');
  await core.setFile(T01, ext, { silent: true });
  await choose(page, statusButton(card), 'Waiting', 'Status');
  await sleep(300);
  assert.equal(await fileText(core, T01), ext, 'nothing is written');
  await must(alertWith(page, `"${J}" changed outside Tegg. Your change wasn't saved.`), 'the FR-TSK-02 AC-11 alert', 2000);
  assert.equal(await eventually(() => nameOf(priorityButton(card)), (n) => n === 'Priority: Medium', 2000), 'Priority: Medium', 'the card reloads within 2 s');
  assert.equal(await nameOf(statusButton(card)), 'Status: To do', 'with the file\'s status');
});

test('fr_cnv_05_ac7_unsaved_body_edits_and_an_external_change_open_the_dialog', async ({ page }) => {
  const { core, card } = await poradaCard(page);
  await core.writeControl({ hold: true, path: T01 });
  assert.ok(await caretAt(embedBody(card), 'týden.'), 'caret in the body');
  await page.keyboard.type(' Moje.');
  await sleep(200);
  const theirs = swap(T01_0, 'příští týden.', 'příští týden jinde.');
  await core.setFile(T01, theirs);
  const dlg = await must(mergeDialog(page), 'dialog "Note changed outside Tegg"', 2000);
  assert.equal(await description(dlg), J, 'naming Zavolat Janě');
  assert.equal(await fileText(core, T01), theirs, 'nothing overwritten');
  await core.release();
  await sleep(500);
  assert.equal(await fileText(core, T01), theirs, 'still the other program\'s bytes');
});

test('fr_cnv_05_ac7_a_clean_external_status_change_shows_in_the_card', async ({ page }) => {
  const { core, card } = await poradaCard(page);
  await core.setFile(T01, swap(T01_0, 'status: To do', 'status: Waiting'));
  assert.equal(await eventually(() => nameOf(statusButton(card)), (n) => n === 'Status: Waiting', 2000), 'Status: Waiting', 'within 2 s');
  assert.deepEqual(await writeLog(core), [], 'nothing written');
});

// ------------------------------------------------------------------------------------------------ AC-8

test('fr_cnv_05_ac8_two_cards_of_one_task', async ({ page }) => {
  const core = await openConvert(page, C.dveKarty);
  const first = await needCard(main(page), J, 'the first card', 0);
  const second = await needCard(main(page), J, 'the second card', 1);
  await (await must(cardCheckbox(first, J), 'the first card\'s checkbox')).click();
  assert.equal(await eventually(() => nameOf(statusButton(second)), (n) => n === 'Status: Done', 1000), 'Status: Done', 'the second card follows within 1 s');
  const v = await core.version(T01);
  await choose(page, statusButton(second), 'Waiting', 'Status (second card)');
  const t = await fileWhen(core, T01, (x) => !!x?.includes('status: Waiting'));
  assert.ok(t?.includes('status: Waiting'), 'written');
  const w = await writesOf(core, T01);
  assert.equal(w.length, 2, 'two writes');
  assert.deepEqual((w[1].args as any).base, v, 'the second write\'s base is the first write\'s result');
  assert.equal(w[1].ok, true, 'no Conflict');
  assert.equal(await page.getByRole('alert').filter({ hasText: 'changed outside Tegg' }).count(), 0, 'no conflict alert');
});

// ------------------------------------------------------------------------------------------------ AC-9

async function mustBeReadOnly(page: Page, core: FakeCoreHandle, card: Locator, title: string, path: string, what: string) {
  for (const [loc, name] of [[cardCheckbox(card, title), 'checkbox'], [statusButton(card), 'Status'], [priorityButton(card), 'Priority'], [dueButton(card), 'Due']] as const) {
    await must(loc, `${what}: ${name}`);
    assert.equal(await isDisabled(loc), true, `${what}: ${name} aria-disabled`);
    assert.equal(await description(loc), READ_ONLY, `${what}: ${name} says why`);
    await loc.first().click({ force: true }).catch(() => {});
    await page.keyboard.press('Escape');
  }
  const body = await must(embedBody(card), `${what}: the body`);
  assert.equal(await body.getAttribute('data-embed-editable'), 'false', `${what}: the body is read-only`);
  await body.click().catch(() => {});
  await page.keyboard.type('x');
  await sleep(1300);
  assert.deepEqual(await writesOf(core, path), [], `${what}: no write is sent`);
}
test('fr_cnv_05_ac9_read_view_of_porada', async ({ page }) => {
  const core = await openConvert(page, C.porada, { readView: true });
  await mustBeReadOnly(page, core, await needCard(main(page), J), J, T01, 'read view');
});

test('fr_cnv_05_ac9_depth_2_in_obal', async ({ page }) => {
  const core = await openConvert(page, C.obal);
  const card = await needCard(main(page), J, 'T01\'s card inside Porada\'s full embed');
  assert.equal(await card.getAttribute('data-embed-depth'), '2', 'at depth 2');
  await mustBeReadOnly(page, core, card, J, T01, 'depth 2');
});

test('fr_cnv_05_ac9_read_only_task_files', async ({ page }) => {
  const host = 'Pages/Kopie host.md';
  const bad = 'Tasks/Neplatná kopie.md';
  const badFm = 'Tasks/Chybná hlavička.md';
  const vault = convertVault((f) => {
    f[host] = `---\nid: 01JB5A0000000000000000W901\ntype: page\ntitle: Kopie host\ncreated: 2026-10-01T09:00:00+02:00\nmodified: 2026-10-01T09:00:00+02:00\n---\n![[Neplatná kopie]]\n\n![[Chybná hlavička]]\n`;
    f[badFm] = swap(swap(swap(T01_0, 'title: Zavolat Janě', 'title: Chybná hlavička'), 'E001', 'W902'), 'tags: [práce]', 'tags: [práce');
  });
  const core = await openConvert(page, null, { vault, noEditor: true });
  const bytes = new TextEncoder().encode(swap(swap(T01_0, 'title: Zavolat Janě', 'title: Neplatná kopie'), 'E001', 'W903'));
  await core.setFile(bad, new Uint8Array([...bytes, 0x78, 0xff, 0x0a]));
  await switchTo(page, 'Kopie host');
  await mustBeOn(page, 'Kopie host', 'Kopie host', 5000);
  await mustBeReadOnly(page, core, await needCard(main(page), 'Neplatná kopie', 'the invalid-UTF-8 copy as a Task card'), 'Neplatná kopie', bad, 'not UTF-8');
  // Invalid frontmatter (AP-462): when its type can still be read it is a read-only Task card; it never writes.
  const fmCard = main(page).locator('[data-task-card]').filter({ hasText: 'Chybná hlavička' });
  if (await seen(fmCard, 1000)) await mustBeReadOnly(page, core, fmCard.first(), 'Chybná hlavička', badFm, 'invalid frontmatter');
  assert.deepEqual(await writesOf(core, badFm), [], 'invalid frontmatter: never written');
});

// ------------------------------------------------------------------------------------------------ AC-10

test('fr_cnv_05_ac10_the_title_is_not_editable_in_the_card', async ({ page }) => {
  const { card } = await poradaCard(page);
  const ti = await titleInfo(card, J);
  assert.ok(ti, 'the title text');
  assert.equal(ti!.editable, false, 'no contenteditable');
  assert.notEqual(ti!.role, 'textbox', 'no textbox');
  assert.equal(ti!.headerTextboxes, 0, 'no text input in the header');
});
