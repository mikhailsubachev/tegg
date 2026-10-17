// MS5 slice 5A-1, L5 (WebKit + fake core): the universal task card (R43) and every write it makes. FR-TSK-01 AC-2…AC-4
// (the panel rows, recurrence kept, `completed` automatic, TZ), FR-TSK-02 AC-9 (the `Not a status` chip), AC-10 (the
// write path per surface), AC-11 (an external change is a conflict), AC-12 (failure, read-only), FR-TSK-03 AC-3
// (priority chip and menu), FR-TSK-08 AC-1…AC-3 (the source chip), FR-TSK-09 AC-2, AC-3 (the due chip). Interface
// docs/contracts/ms5-tasks.md §5 (`note_read` + @tegg/doc + `note_write` with the row's version), §6.2 (`SourceChip`,
// `selectEmbedOf`), §7 (fake core: silent `setFile`, `writeControl` per path). Written from the ACs and the contract
// only (D-61).
import { test, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import {
  NOW, NOW_IN, O, T, attr, callsOf, card, checkbox, click, column, description, eventually, fileText, fileWhen, gotoKanban, gotoTasks, isDisabled, main,
  moreBtn, must, mustBeOn, navs, nfc, original, seen, shortDate, sleep, startTasks, swap, tasksVault, textOf, touched, writeCalls, writesOf, flat,
} from './tasks-helpers';

test.use({ timezoneId: 'Europe/Prague' });

const props = (page: Page) => page.getByRole('region', { name: 'Properties', exact: true });
const alertWith = (page: Page, text: string) => page.getByRole('alert').filter({ hasText: text });
async function dueChip(page: Page, title: string) {
  return must(card(page, title).locator('[data-due], [data-tone]').first(), `${title}: due chip`);
}
/** Computed colours of an element and the theme tokens they should equal. */
async function chipStyle(loc: ReturnType<Page['locator']>) {
  return loc.evaluate((e) => {
    const s = getComputedStyle(e);
    const probe = (v: string) => { const p = document.createElement('span'); p.style.color = `var(--${v})`; document.body.appendChild(p); const c = getComputedStyle(p).color; p.remove(); return c; };
    return { color: s.color, bg: s.backgroundColor, weight: s.fontWeight, tok: { danger: probe('danger'), dangerBg: probe('danger-bg'), link: probe('link'), linkBg: probe('link-bg'), muted: probe('muted'), hover: probe('hover') } };
  });
}

// ------------------------------------------------------------------------------------------------ R43, FR-TSK-02 AC-10

test('fr_tsk_02_ac10_card_parts_follow_r43', async ({ page }) => {
  await startTasks(page);
  await gotoTasks(page);
  const c = await must(card(page, 'Zavolat Janě'), 'article "Task: Zavolat Janě"');
  assert.equal(await attr(c, 'data-path'), T.t01, 'data-path');
  assert.equal(await attr(c, 'data-state'), 'open', 'data-state');
  assert.equal(await attr(c, 'data-overdue'), 'true', 'data-overdue');
  assert.equal(await attr(checkbox(c, 'Zavolat Janě'), 'aria-checked'), 'false', 'checkbox Complete "Zavolat Janě"');
  await must(c.getByRole('link', { name: 'Zavolat Janě', exact: true }), 'title link');
  assert.equal(await attr(moreBtn(c, 'Zavolat Janě'), 'aria-haspopup'), 'menu', 'More actions for "Zavolat Janě"');
  const text = await textOf(c);
  assert.ok(text.includes('#práce'), 'tag chip');
  assert.ok(text.includes('Domluvit schůzku na příští týden.'), 'body start');
  assert.ok(!text.includes('To do'), 'no status chip for the first status option (AP-412)');
  const t04 = await textOf(card(page, 'Koupit dárek'));
  assert.ok(t04.includes('Waiting'), 'a status chip for Waiting');
  const many = await textOf(card(page, 'Poslat rozpočet'));
  assert.ok(many.includes('#práce') && many.includes('#finance'), 'both tags');
});

test('fr_tsk_02_ac10_checkbox_writes_through_one_note_write', async ({ page }) => {
  const core = await startTasks(page);
  await gotoTasks(page);
  const base = await core.version(T.t03);
  await click(checkbox(card(page, 'Zalít květiny'), 'Zalít květiny'), 'checkbox of T03');
  const w = await eventually(() => writesOf(core, T.t03), (x) => x.length >= 1);
  assert.equal(w.length, 1, 'one note_write');
  const want = swap(swap(original(T.t03), 'status: To do', 'status: Done'), 'modified: 2026-10-01T09:00:00+02:00\n', `modified: ${NOW}\ncompleted: ${NOW}\n`);
  assert.equal(String((w[0].args as any).text), want, 'status Done, completed appended, modified updated');
  assert.deepEqual((w[0].args as any).base, base, 'the base is the version the view was loaded with');
  assert.ok((await callsOf(core, 'note_read')).some((c) => nfc(String((c.args as any).path)) === T.t03), 'note_read before the write (§5)');
  await click(checkbox(card(page, 'Zalít květiny'), 'Zalít květiny'), 'uncheck T03');
  const back = await fileWhen(core, T.t03, (t) => !!t && !t.includes('completed:'));
  assert.equal(back, touched(original(T.t03)), 'To do, completed removed');
  await click(checkbox(card(page, 'Poslat rozpočet'), 'Poslat rozpočet'), 'check T02');
  assert.ok((await fileWhen(core, T.t02, (t) => t !== original(T.t02)))?.includes('status: Done'), 'T02 (In progress) gives Done');
  await click(moreBtn(card(page, 'Úklid garáže'), 'Úklid garáže'), 'More of T05');
  await click(page.getByRole('menuitem', { name: 'Status', exact: true }), 'Status');
  await click(page.getByRole('menuitemradio', { name: 'Waiting', exact: true }), 'Status › Waiting');
  assert.equal(await fileWhen(core, T.t05, (t) => t !== original(T.t05)), touched(swap(original(T.t05), 'status: To do', 'status: Waiting')), 'only status and modified');
  const n = (await writesOf(core, T.t05)).length;
  await click(moreBtn(card(page, 'Úklid garáže'), 'Úklid garáže'), 'More again');
  await click(page.getByRole('menuitem', { name: 'Status', exact: true }), 'Status');
  await click(page.getByRole('menuitemradio', { name: 'Waiting', exact: true }), 'the current status');
  await sleep(300);
  assert.equal((await writesOf(core, T.t05)).length, n, 'the same status writes nothing');
});

test('fr_tsk_02_ac10_kanban_card_checkbox_writes_the_same_bytes', async ({ page }) => {
  const core = await startTasks(page);
  await gotoKanban(page, 'Status');
  await click(checkbox(column(page, 'To do').getByRole('article', { name: 'Task: Zalít květiny' }), 'Zalít květiny'), 'Kanban checkbox of T03');
  const w = await eventually(() => writesOf(core, T.t03), (x) => x.length === 1);
  assert.equal(w.length, 1, 'one write');
  assert.ok(String((w[0].args as any).text).includes(`completed: ${NOW}`), 'the same §5 bytes');
});

// ------------------------------------------------------------------------------------------------ FR-TSK-02 AC-11, AC-12

test('fr_tsk_02_ac11_an_external_change_is_never_overwritten', async ({ page }) => {
  const core = await startTasks(page);
  await gotoTasks(page);
  const ext = swap(original(T.t03), 'priority: Low', 'priority: High');
  await core.setFile(T.t03, ext, { silent: true });
  await click(checkbox(card(page, 'Zalít květiny'), 'Zalít květiny'), 'checkbox of T03');
  await sleep(300);
  assert.equal(await fileText(core, T.t03), ext, 'the file keeps the external bytes');
  assert.ok(await seen(alertWith(page, '"Zalít květiny" changed outside Tegg. Your change wasn\'t saved.'), 2000), 'non-modal alert');
  assert.equal(await page.getByRole('dialog').count(), 0, 'not modal');
  assert.ok((await textOf(card(page, 'Zalít květiny'))).includes('High'), 'the card reloads from disk within 2 s');
  assert.equal(await attr(checkbox(card(page, 'Zalít květiny'), 'Zalít květiny'), 'aria-checked'), 'false', 'unchecked');
  await core.setFile(T.t04, swap(original(T.t04), 'status: Waiting', 'status: In progress'));
  assert.equal(await eventually(() => attr(card(page, 'Koupit dárek'), 'data-state'), (s) => s === 'in-progress', 2000), 'in-progress', 'with vault:changed the card follows within 2 s');
});

test('fr_tsk_02_ac12_a_failed_write_and_try_again', async ({ page }) => {
  const core = await startTasks(page);
  await gotoTasks(page);
  await core.writeControl({ fail: 'Io', path: T.t03 });
  await click(checkbox(card(page, 'Zalít květiny'), 'Zalít květiny'), 'checkbox of T03');
  const alert = await must(alertWith(page, 'Couldn’t save "Zalít květiny". Try again.'), 'the save alert', 2000);
  assert.equal(await attr(checkbox(card(page, 'Zalít květiny'), 'Zalít květiny'), 'aria-checked'), 'false', 'the card returns to its previous state');
  assert.equal(await fileText(core, T.t03), original(T.t03), 'nothing partial');
  await click(checkbox(card(page, 'Poslat rozpočet'), 'Poslat rozpočet'), 'another task still writes');
  assert.ok((await fileWhen(core, T.t02, (t) => t !== original(T.t02)))?.includes('status: Done'), 'the failure hits T03 only (writeControl path)');
  await core.writeControl({ fail: null, path: null });
  await core.setFile(T.t03, swap(original(T.t03), 'priority: Low', 'priority: Medium'));
  await click(alert.getByRole('button', { name: 'Try again', exact: true }), 'Try again');
  const t = await fileWhen(core, T.t03, (x) => !!x?.includes('status: Done'));
  assert.ok(t?.includes('priority: Medium') && t.includes('status: Done'), 'Try again writes with the file\'s current base');
});

test('fr_tsk_02_ac12_a_read_only_task_is_never_written', async ({ page }) => {
  const core = await startTasks(page);
  // The invalid byte is in the body, so the frontmatter (and the task) still reads (NFR-REL-03).
  const bytes = new TextEncoder().encode(original(T.t03).replace('Zalít květiny', 'Zalít kytky'));
  const bad = new Uint8Array([...bytes, 0x78, 0xff, 0x0a]);
  await core.setFile('Tasks/Zalít kytky.md', bad);
  await gotoTasks(page);
  const c = await must(card(page, 'Zalít kytky'), 'the invalid-UTF-8 copy');
  const box = checkbox(c, 'Zalít kytky');
  assert.equal(await isDisabled(box), true, 'checkbox disabled');
  assert.equal(await description(box), 'This task can\'t be edited here.', 'with the reason');
  await box.click({ force: true }).catch(() => {});
  await sleep(300);
  assert.deepEqual(await writesOf(core, 'Tasks/Zalít kytky.md'), [], 'never written');
});

// ------------------------------------------------------------------------------------------------ FR-TSK-03 AC-3

test('fr_tsk_03_ac3_priority_chip_and_menu', async ({ page }) => {
  const core = await startTasks(page);
  await gotoTasks(page);
  const chip = await must(card(page, 'Zavolat Janě').locator('[data-priority]'), 'T01 priority chip');
  assert.equal(await textOf(chip), 'High', 'High');
  const colour = await chip.evaluate((e) => { const p = document.createElement('span'); p.style.color = 'var(--type-red)'; document.body.appendChild(p); const want = getComputedStyle(p).color; p.remove(); return [getComputedStyle(e.querySelector('svg, [data-flag]') ?? e).color, want]; });
  assert.equal(colour[0], colour[1], 'in the option colour token (type-red)');
  for (const t of ['Obnovit pas', 'Opravit kolo']) assert.equal(await card(page, t).locator('[data-priority]').count(), 0, `${t}: no priority chip`);
  await click(moreBtn(card(page, 'Zavolat Janě'), 'Zavolat Janě'), 'More');
  await click(page.getByRole('menuitem', { name: 'Priority', exact: true }), 'Priority');
  const items = (await page.getByRole('menuitemradio').allInnerTexts()).map(flat);
  assert.deepEqual(items, ['High', 'Medium', 'Low', 'None', 'No priority'], 'options in order plus No priority');
  await click(page.getByRole('menuitemradio', { name: 'No priority', exact: true }), 'No priority');
  assert.equal(await fileWhen(core, T.t01, (t) => t !== original(T.t01)), touched(swap(original(T.t01), 'priority: High\n', '')), 'removes the priority line (D-230)');
});

// ------------------------------------------------------------------------------------------------ FR-TSK-08

test('fr_tsk_08_ac1_source_chip_on_every_task_view', async ({ page }) => {
  const vault = tasksVault((f) => {
    f['Tasks/Chybějící zdroj.md'] = swap(swap(f[T.t01], 'E001', 'W001'), '"[[Porada]]"', '"[[Chybí]]"').replace('title: Zavolat Janě', 'title: Chybějící zdroj');
    f['Tasks/Ze dne.md'] = swap(swap(f[T.t01], 'E001', 'W002'), '"[[Porada]]"', '"[[2026-10-09]]"').replace('title: Zavolat Janě', 'title: Ze dne');
  });
  await startTasks(page, { vault });
  await gotoTasks(page);
  const chip = await must(card(page, 'Zavolat Janě').locator('[data-link-kind]').filter({ hasText: 'Porada' }), 'source chip Porada');
  assert.equal(await description(chip), 'Source: Porada');
  assert.equal(await attr(chip, 'data-link-kind'), 'note', 'D-73 link style');
  assert.equal(await card(page, 'Zalít květiny').locator('[data-link-kind]').count(), 0, 'no source, no chip');
  const broken = await must(card(page, 'Chybějící zdroj').locator('[data-link-kind]'), 'unresolved chip');
  assert.equal(await attr(broken, 'data-link-kind'), 'unresolved');
  assert.ok((await description(broken)).includes('No note named Chybí'), 'broken style description');
  const day = await must(card(page, 'Ze dne').locator('[data-link-kind]'), 'date chip');
  assert.equal(await textOf(day), '2026-10-09', 'the date');
  assert.equal(await attr(day, 'data-link-kind'), 'daily', 'the Daily Note icon and kind');
  for (const g of ['Status', 'Tag'] as const) {
    await gotoKanban(page, g);
    assert.ok(await seen(main(page).getByRole('article', { name: 'Task: Zavolat Janě' }).first().locator('[data-link-kind]').filter({ hasText: 'Porada' })), `Kanban by ${g}: chip`);
  }
});

test('fr_tsk_08_ac2_the_chip_opens_the_source_at_the_embed', async ({ page }) => {
  const core = await startTasks(page);
  await gotoTasks(page);
  await click(card(page, 'Zavolat Janě').locator('[data-link-kind]').filter({ hasText: 'Porada' }), 'source chip');
  await mustBeOn(page, 'Porada', 'note/Pages/Porada.md', 5000);
  const sel = await must(main(page).locator('[data-block-selected]'), 'a selected block');
  assert.ok((await textOf(sel)).includes('Zavolat Janě'), 'the embed of T01 is selected');
  const top = await sel.evaluate((e) => {
    let sc: HTMLElement | null = e.parentElement;
    while (sc && !(sc.scrollHeight > sc.clientHeight && /(auto|scroll)/.test(getComputedStyle(sc).overflowY))) sc = sc.parentElement;
    return e.getBoundingClientRect().top - (sc ?? document.documentElement).getBoundingClientRect().top;
  });
  assert.ok(Math.abs(top) <= 8, `at the top of the centre pane's scroll area (± 8 px): ${top}`);
  assert.ok((await navs(core)).includes(O.porada), 'nav_opened records Porada');
  assert.equal(await page.getByRole('dialog').count(), 0, 'no preview popover');
  assert.deepEqual(await writeCalls(core), [], 'nothing written');
});

test('fr_tsk_08_ac2_without_an_embed_the_note_opens_at_the_top', async ({ page }) => {
  const vault = tasksVault((f) => { f[O.porada] = swap(f[O.porada], '![[Zavolat Janě]]\n\n', ''); });
  await startTasks(page, { vault });
  await gotoTasks(page);
  await click(card(page, 'Zavolat Janě').locator('[data-link-kind]').filter({ hasText: 'Porada' }), 'source chip');
  await mustBeOn(page, 'Porada', 'Porada opens', 5000);
  assert.equal(await main(page).locator('[data-block-selected]').count(), 0, 'nothing selected; the top');
});

test('fr_tsk_08_ac2_unresolved_and_date_chips', async ({ page }) => {
  const vault = tasksVault((f) => {
    f['Tasks/Chybějící zdroj.md'] = swap(swap(f[T.t01], 'E001', 'W001'), '"[[Porada]]"', '"[[Chybí]]"').replace('title: Zavolat Janě', 'title: Chybějící zdroj');
    f['Tasks/Ze dne.md'] = swap(swap(f[T.t01], 'E001', 'W002'), '"[[Porada]]"', '"[[2026-10-09]]"').replace('title: Zavolat Janě', 'title: Ze dne');
  });
  await startTasks(page, { vault });
  await gotoTasks(page);
  await click(card(page, 'Chybějící zdroj').locator('[data-link-kind]'), 'unresolved chip');
  await must(page.getByRole('dialog', { name: 'Create note' }), 'the Create offer (FR-LNK-04 AC-4)');
  await page.keyboard.press('Escape');
  await click(card(page, 'Ze dne').locator('[data-link-kind]'), 'date chip');
  await must(page.getByRole('textbox', { name: 'Title', exact: true }), 'daily/2026-10-09', 5000);
  assert.equal(flat(await page.getByRole('textbox', { name: 'Title', exact: true }).first().evaluate((e) => (e as HTMLInputElement).value ?? e.textContent)), '2026-10-09');
});

test('fr_tsk_08_ac3_the_panel_source_row_opens_at_the_embed', async ({ page }) => {
  await startTasks(page, { at: T.t01 });
  await mustBeOn(page, 'Zavolat Janě', 'T01', 5000);
  await click(props(page).locator('[data-link-kind]').filter({ hasText: 'Porada' }), 'Source row chip');
  await mustBeOn(page, 'Porada', 'Porada', 5000);
  assert.ok((await textOf(await must(main(page).locator('[data-block-selected]'), 'selected embed'))).includes('Zavolat Janě'), 'at the embed');
});

// ------------------------------------------------------------------------------------------------ FR-TSK-09 AC-2, AC-3

for (const theme of ['light', 'dark'] as const) {
  test(`fr_tsk_09_ac2_due_chip_styles_${theme}`, async ({ page }) => {
    await startTasks(page, { theme });
    await gotoTasks(page);
    const t01 = await dueChip(page, 'Zavolat Janě');
    assert.equal(await textOf(t01), `${shortDate('2026-10-09', 'cs')} · 5 days overdue`, 'T01 text');
    const s01 = await chipStyle(t01);
    assert.deepEqual([s01.color, s01.bg, s01.weight], [s01.tok.danger, s01.tok.dangerBg, '600'], 'danger on danger-bg, 600');
    assert.equal(await textOf(await dueChip(page, 'Poslat rozpočet')), `${shortDate('2026-10-13', 'cs')} · Yesterday`, 'T02 text');
    const s03 = await chipStyle(await dueChip(page, 'Zalít květiny'));
    assert.deepEqual([s03.color, s03.bg, s03.weight], [s03.tok.link, s03.tok.linkBg, '600'], 'Today: link on link-bg, 600');
    const s05 = await chipStyle(await dueChip(page, 'Úklid garáže'));
    assert.deepEqual([s05.color, s05.bg, s05.weight], [s05.tok.muted, s05.tok.hover, '400'], 'others: muted on hover, 400');
    const h = await must(main(page).locator('[data-section="today"]').getByRole('heading', { level: 3, name: 'Overdue' }), 'Overdue heading');
    const hs = await chipStyle(h);
    assert.equal(hs.color, hs.tok.danger, 'the Overdue heading uses danger');
  });

  test(`fr_tsk_09_ac3_not_by_colour_alone_${theme}`, async ({ page }) => {
    await startTasks(page, { theme });
    await gotoTasks(page);
    for (const t of ['Zavolat Janě', 'Poslat rozpočet']) {
      const chip = await dueChip(page, t);
      assert.match(await textOf(chip), /overdue|Yesterday/, `${t}: a word, not only a colour`);
      const name = await chip.evaluate((e) => e.getAttribute('aria-label') ?? '');
      assert.ok(name.endsWith(', overdue'), `${t}: accessible name ends with ", overdue": ${name}`);
    }
  });
}

test('fr_tsk_09_ac2_the_panel_due_row_of_an_overdue_task', async ({ page }) => {
  await startTasks(page, { at: T.t01 });
  await mustBeOn(page, 'Zavolat Janě', 'T01', 5000);
  const row = await must(props(page).locator('[data-overdue="true"]'), 'the Due date row shows the overdue highlight');
  const s = await chipStyle(row);
  assert.equal(s.color, s.tok.danger, 'danger colour');
});

// ------------------------------------------------------------------------------------------------ FR-TSK-01 AC-2…AC-4

test('fr_tsk_01_ac2_panel_rows_and_due_bytes', async ({ page }) => {
  const core = await startTasks(page, { at: T.t01 });
  await mustBeOn(page, 'Zavolat Janě', 'T01', 5000);
  const p = await must(props(page), 'Properties');
  const text = await p.innerText();
  const order = ['Status', 'Priority', 'Due date', 'Completed', 'Recurrence', 'Tags', 'Source'];
  const pos = order.map((l) => text.indexOf(l));
  assert.ok(pos.every((x) => x >= 0) && pos.every((v, i) => i === 0 || v > pos[i - 1]), `schema order, then Tags and Source: ${order.map((l, i) => `${l}@${pos[i]}`).join(' ')}`);
  assert.ok(text.includes('To do') && text.includes('High') && text.includes('práce') && text.includes('Porada'), 'the values');
  assert.equal(await p.locator('[data-overdue="true"]').count(), 1, 'Due date with the overdue highlight (FR-TSK-09 AC-2)');
  const due = await must(p.getByRole('textbox', { name: 'Due date', exact: true }), 'Due date control');
  await due.fill('20. 10. 2026');
  await due.press('Enter');
  assert.equal(await fileWhen(core, T.t01, (t) => t !== original(T.t01)), touched(swap(original(T.t01), 'due: 2026-10-09', 'due: 2026-10-20')), 'only due (no time, no offset) and modified');
  await gotoTasks(page);
  assert.equal(await attr(card(page, 'Zavolat Janě'), 'data-overdue'), 'false', 'no longer overdue on the Tasks page');
});

test('fr_tsk_01_ac3_recurrence_stays_v1', async ({ page }) => {
  const rec = 'recurrence: "FREQ=WEEKLY;BYDAY=MO"\n';
  const vault = tasksVault((f) => { f[T.t03] = swap(f[T.t03], 'due: 2026-10-14\n', `due: 2026-10-14\n${rec}`); });
  const core = await startTasks(page, { vault, at: T.t03 });
  await mustBeOn(page, 'Zalít květiny', 'T03', 5000);
  const r = props(page).getByRole('textbox', { name: 'Recurrence', exact: true }).or(props(page).getByRole('button', { name: 'Recurrence', exact: true }));
  assert.equal(await isDisabled(r), true, 'the Recurrence row is read-only');
  assert.equal(await description(r), 'Coming in v1.0', 'Coming in v1.0 (D-381)');
  await gotoTasks(page);
  await click(checkbox(card(page, 'Zalít květiny'), 'Zalít květiny'), 'check T03');
  const t = await fileWhen(core, T.t03, (x) => !!x?.includes('status: Done'));
  assert.ok(t?.includes(`due: 2026-10-14\n${rec}`), 'the recurrence line is kept byte for byte');
  assert.equal(await main(page).getByText(/next:/).count(), 0, 'no recurrence badge');
});

for (const tz of ['Europe/Prague', 'America/Los_Angeles'] as const) {
  test.describe(`completed in ${tz}`, () => {
    test.use({ timezoneId: tz });

    test(`fr_tsk_01_ac4_completed_is_automatic_${tz.replace(/\W/g, '_')}`, async ({ page }) => {
      const core = await startTasks(page, { at: T.t12 });
      await mustBeOn(page, 'Vrátit knihy', 'T12', 5000);
      const row = props(page).getByRole('textbox', { name: 'Completed', exact: true }).or(props(page).getByRole('button', { name: 'Completed', exact: true }));
      assert.equal(await isDisabled(row), true, 'the Completed row is read-only (AP-402)');
      assert.equal(await description(row), 'Set when the task is done');
      await gotoTasks(page);
      await click(checkbox(card(page, 'Zalít květiny'), 'Zalít květiny'), 'check T03');
      const now = NOW_IN[tz];
      const t = await fileWhen(core, T.t03, (x) => !!x?.includes('completed:'));
      assert.ok(t?.includes(`completed: ${now}\n`), `completed with the zone's offset: ${now}`);
      assert.equal(await fileText(core, T.t12), original(T.t12), 'T12 keeps having no completed (reading never fixes it)');
    });
  });
}

// ------------------------------------------------------------------------------------------------ FR-TSK-02 AC-9 (card part)

test('fr_tsk_02_ac9_an_unknown_status_shows_not_a_status', async ({ page }) => {
  await startTasks(page);
  await gotoKanban(page, 'Status');
  const c = await must(column(page, 'no-status').getByRole('article', { name: 'Task: Cizí stav' }), 'T15 in No status');
  const chip = await must(c.locator('[data-status]'), 'status chip');
  assert.equal(await textOf(chip), 'Rozpracováno', 'the raw value');
  assert.equal(await description(chip), 'Not a status', 'Not a status (AP-401)');
  assert.ok(await seen(column(page, 'no-status').getByRole('article', { name: 'Task: Bez stavu' })), 'T14 in No status');
});
