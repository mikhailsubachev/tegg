// Slice AND-3, L5p (projects `phone-webkit`, `phone-chromium`): docs/acceptance/android-edit.md, the other writes:
// - FR-TSK-02 AC-14 (task checkboxes complete tasks), FR-TSK-11 AC-5 (a tap toggles a checklist item), FR-INB-02 AC-18
//   (`Reviewed` in the row and on the note), FR-HOM-02 AC-33 (pin and unpin), FR-HIS-01 AC-16 (one note to the trash),
//   FR-FMT-12 AC-18 (L5p: an NFD-named note stays read-only; contract §19 lists it here).
// Contract docs/contracts/android-edit.md §2.4 rows 3, 4, 5, 14, 15, §7.1, §7.4, §7.7, §12.1, §12.2, §12.4, §12.6.
// Red-test readings (reported): "AC-10's bytes" of tasks.md are built from the fixture (`status: Done`, `completed`
// appended after the last entry, `modified` at the clock); a task embed is a runtime note embedding T03.
// Written from the ACs and the contract only (D-61).
import { test, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import {
  EDIT_NOW, PE, PH, assertWritesExactly, assertZeroWrites, bodyFocused, editVault, eventually, fileStateOf, flat, h1Is, hitArea, loadVault, main,
  moreButton, moreMenu, must, needBody, nfc, noteBody, notice, openDrawer, phonePage, phoneVault, runById, saveState, seen, sleep, startPhone, systemBack, tap,
  writeCalls, WRITE_COMMANDS, goNote, tapToEdit, setCaret, keyboard, panel,
} from './phone-helpers';
import { ime } from './phone-ime';
import { inboxVault, reviewedText } from './capture-helpers';

test.use({ timezoneId: 'Europe/Prague' });

async function openMore(page: Page) {
  await (await must(moreButton(page), 'More actions')).click();
  return must(moreMenu(page), 'menu "More actions"');
}

// ------------------------------------------------------------------------------------------------ FR-TSK-02 AC-14

const T03 = 'Tasks/Zalít květiny.md';
const tasksVault = () => loadVault('Úkoly', ['tasks', 'new-empty/.tegg', 'views-tasks'], (f) => {
  f['Pages/Vložený úkol.md'] = '---\nid: 01JBAN3000000000000000T901\ntype: page\ntitle: Vložený úkol\n---\n![[Zalít květiny]]\n';
});
const T03_TEXT = () => tasksVault().files[T03];
const checked = () => T03_TEXT().replace('status: To do', 'status: Done').replace(/^modified: .*$/m, `modified: ${EDIT_NOW}\ncompleted: ${EDIT_NOW}`);
const unchecked = () => T03_TEXT().replace(/^modified: .*$/m, `modified: ${EDIT_NOW}`);

test('fr_tsk_02_ac14_checkboxes_complete_tasks_on_the_phone', async ({ browser }) => {
  test.setTimeout(150_000);
  const surfaces: [string, string, (p: Page) => Promise<void>][] = [
    ['All Tasks', 'type/task', async (p) => { await tap(p, main(p).getByRole('tab', { name: 'All Tasks' }), 'All Tasks'); }],
    ['Schedule', 'type/task', async (p) => { await tap(p, main(p).getByRole('tab', { name: /Schedule|Plán/ }).first(), 'Schedule'); }],
    ['Kanban', 'type/task', async (p) => { await tap(p, main(p).getByRole('tab', { name: /Kanban/ }).first(), 'Kanban'); }],
    ['Tasks due', 'daily/2026-10-14', async () => undefined],
    ['a task embed', 'note/Pages/Vložený úkol.md', async () => undefined],
  ];
  for (const [what, route, go] of surfaces) {
    const page = await phonePage(browser);
    const core = await startPhone(page, { vault: tasksVault(), route, now: EDIT_NOW });
    const before = await fileStateOf(core);
    await go(page);
    const box = page.locator(`[data-command="task.complete:${T03}"]`).first();
    await must(box, `${what}: T03's checkbox with task.complete:<path>`, 4000);
    assert.equal(await box.getAttribute('role') ?? 'checkbox', 'checkbox', `${what}: a checkbox`);
    assert.equal(await box.getAttribute('aria-label'), 'Complete "Zalít květiny"', `${what}: named Complete "Zalít květiny" (R43)`);
    assert.notEqual(await box.getAttribute('aria-disabled'), 'true', `${what}: enabled`);
    const hit = await hitArea(box);
    assert.ok(hit.width >= 47.5 && hit.height >= 47.5, `${what}: a 48 × 48 hit area`);
    await tap(page, box, `${what}: T03`);
    await assertWritesExactly(core, before, [{ cmd: 'note_write', path: T03 }], `${what}: checking T03`);
    assert.equal((await core.files())[T03], checked(), `${what}: AC-10's bytes`);
    assert.ok(await eventually(async () => (await page.locator(`[data-command="task.complete:${T03}"]`).first().getAttribute('aria-label')) === 'Mark "Zalít květiny" not done', (v) => v, 1000), `${what}: within 1 s it shows its new state`);
    if (what === 'Kanban') assert.ok(await eventually(() => page.locator(`[data-command="task.complete:${T03}"]`).first().evaluate((b) => /done/i.test(b.closest('[data-lane]')?.getAttribute('data-lane') ?? '')), (v) => v, 1000), 'Kanban: in Done');
    if (what === 'Tasks due') assert.ok(!Object.keys(await core.files()).includes('Daily/2026-10-14.md'), 'on the virtual day only the task is written (FR-DLY-04 AC-12)');
    if (what === 'All Tasks') {
      await tap(page, page.locator(`[data-command="task.complete:${T03}"]`).first(), 'uncheck');
      await sleep(1200);
      assert.equal((await core.files())[T03], unchecked(), 'unchecking writes status: To do and removes completed');
      for (const name of ['Status', 'Priority', 'Due']) assert.equal(await main(page).getByRole('button', { name: new RegExp(`^${name}\\b`) }).count(), 0, `no ${name} control`);
      assert.equal(await main(page).locator('[draggable="true"]').count(), 0, 'no card drags (D-2006)');
    }
    await page.close();
  }
  // a task that would open read-only stays aria-disabled (AC-12)
  const page = await phonePage(browser);
  await startPhone(page, { vault: tasksVault(), route: 'type/task', now: EDIT_NOW, nfdNames: [T03] });
  await tap(page, main(page).getByRole('tab', { name: 'All Tasks' }), 'All Tasks');
  const ro = main(page).getByRole('checkbox', { name: /Zalít květiny/ }).first();
  await must(ro, 'T03\'s checkbox');
  assert.equal(await ro.getAttribute('aria-disabled'), 'true', 'a read-only task stays aria-disabled');
  assert.equal(await ro.getAttribute('data-command'), null, 'with no command');
  await page.close();
});

// ------------------------------------------------------------------------------------------------ FR-TSK-11 AC-5

test('fr_tsk_11_ac5_tap_toggles_a_checklist_item', async ({ page, browser }) => {
  const core = await startPhone(page, { vault: editVault(), route: `note/${PE.ukoly}`, now: EDIT_NOW });
  const before = await fileStateOf(core);
  await needBody(page, 'Úkoly');
  const box = noteBody(page).locator('.checklist-item .check, [role="checkbox"]').first();
  await tap(page, box, 'Koupit mléko\'s checkbox');
  await assertWritesExactly(core, before, [{ cmd: 'note_write', path: PE.ukoly }], 'the tap');
  const want = before.files[nfc(PE.ukoly)].replace('- [ ] Koupit mléko', '- [x] Koupit mléko').replace(/^modified: .*$/m, `modified: ${EDIT_NOW}`);
  assert.equal((await core.files())[nfc(PE.ukoly)], want, 'only ` ` → `x` and modified change (editor FR-EDT-02 AC-18)');
  assert.equal(await bodyFocused(page), false, 'the tap doesn\'t place the caret');
  assert.deepEqual(await core.imeCalls(), [], 'nor shows the keyboard');
  assert.ok(!Object.keys(await core.files()).some((p) => p.startsWith('Tasks/')), 'no Task file is created');
  // Jízdenky inside the mindmap doesn't toggle
  const p2 = await phonePage(browser);
  const c2 = await startPhone(p2, { vault: editVault(), route: `note/${PE.mapa}`, now: EDIT_NOW });
  const b2 = await fileStateOf(c2);
  await needBody(p2, 'Mapa v textu');
  const list = noteBody(p2).getByRole('button', { name: 'List' });
  if (await seen(list, 1000)) await list.tap();
  const j = noteBody(p2).getByRole('checkbox').first();
  if (await seen(j, 1000)) await j.tap({ force: true });
  await sleep(1500);
  await assertZeroWrites(c2, b2, 'Jízdenky inside the map (FR-MMP-02 AC-37)');
  await p2.close();
});

// ------------------------------------------------------------------------------------------------ FR-INB-02 AC-18

const Q1 = 'Quick Notes/Koupit mléko.md';
const Q5 = 'Quick Notes/Divná hodnota.md';

test('fr_inb_02_ac18_reviewed_on_the_phone', async ({ page, browser }) => {
  const core = await startPhone(page, { vault: inboxVault(), route: 'inbox', now: EDIT_NOW });
  const before = await fileStateOf(core);
  const boxes = main(page).getByRole('checkbox', { name: 'Reviewed', exact: true });
  assert.equal(await boxes.count(), 13, 'every Inbox row has a checkbox Reviewed');
  for (const b of await boxes.all()) {
    const h = await hitArea(b);
    assert.ok(h.width >= 47.5 && h.height >= 47.5, `a 48 × 48 hit area (${h.width} × ${h.height})`);
  }
  const row = (path: string) => main(page).locator(`[data-command="note.markReviewed:${nfc(path)}"], [data-command="note.markUnreviewed:${nfc(path)}"]`).first();
  await tap(page, row(Q1), 'Q1\'s Reviewed');
  await assertWritesExactly(core, before, [{ cmd: 'note_write', path: Q1 }], 'checking Q1');
  assert.equal((await core.files())[nfc(Q1)], reviewedText(Q1, EDIT_NOW), 'AC-1 and AC-2\'s bytes');
  assert.equal(await row(Q1).getAttribute('data-command'), `note.markUnreviewed:${nfc(Q1)}`, 'the row stays, checked');
  assert.ok(await eventually(async () => flat(await main(page).innerText()).includes('12 to review'), (v) => v, 1000), 'the summary drops within 1 s');
  const d = await openDrawer(page);
  assert.match(flat(await d.locator('[data-command="goto.inbox"]').innerText()), /12$/, 'the drawer count drops');
  await systemBack(page);
  await tap(page, row(Q5), 'Q5 (CRLF)');
  await sleep(1200);
  assert.equal((await core.files())[nfc(Q5)], reviewedText(Q5, EDIT_NOW, 'review: maybe'), 'Q5 keeps its CRLF line ends');
  await tap(page, row(Q1), 'uncheck Q1');
  await sleep(1200);
  assert.match((await core.files())[nfc(Q1)] ?? '', /^review: unreviewed$/m, 'unchecking writes review: unreviewed');
  for (const name of ['Mark all reviewed', 'Convert to']) assert.equal(await page.getByRole('button', { name }).count() + await page.getByRole('menuitem', { name }).count(), 0, `no ${name}`);
  assert.equal(await main(page).getByRole('toolbar').count(), 0, 'no selection toolbar');
  // on a Quick Note's page the strip starts with the review checkbox
  await tap(page, main(page).getByRole('link', { name: /Nápad na článek/ }).first(), 'Q2');
  const first = main(page).locator('input[type="checkbox"], [role="checkbox"]').first();
  await must(first, 'the strip\'s review checkbox');
  assert.match(flat(await first.getAttribute('aria-label') ?? ''), /^(Mark reviewed|Reviewed)$/, 'Mark reviewed / Reviewed (AC-16)');
  // a read-only item stays aria-disabled
  const p2 = await phonePage(browser);
  await startPhone(p2, { vault: inboxVault(), route: 'inbox', now: EDIT_NOW, nfdNames: [Q1] });
  const ro = main(p2).locator('li').filter({ hasText: 'Koupit mléko' }).getByRole('checkbox', { name: 'Reviewed' });
  await must(ro, 'Q1\'s Reviewed');
  assert.equal(await ro.getAttribute('aria-disabled'), 'true', 'a read-only item stays aria-disabled (FR-INB-01 AC-9)');
  await p2.close();
});

// ------------------------------------------------------------------------------------------------ FR-HOM-02 AC-33

test('fr_hom_02_ac33_pin_and_unpin_on_the_phone', async ({ page }) => {
  const core = await startPhone(page, { vault: phoneVault(), route: `note/${PH.dlouha}` });
  await needBody(page, 'Dlouhá poznámka');
  const before = await fileStateOf(core);
  const base = await core.version(PH.pins);
  let menu = await openMore(page);
  await (await must(menu.getByRole('menuitem', { name: 'Pin' }), 'More actions › Pin')).click();
  await assertWritesExactly(core, before, [{ cmd: 'pins_apply', path: PH.pins }], 'Pin');
  const calls = await core.pinCalls();
  assert.deepEqual(calls.map((c) => c.base), [base], 'pins_apply once, with pinned.yml\'s version as base');
  const yml = (await core.files())[PH.pins] ?? '';
  assert.ok(/- query: Rozečtené\n {2}- id: 01JBAN2000000000000000N004\b/.test(yml), `Dlouhá poznámka is added by id after Rozečtené: ${yml}`);
  const d = await openDrawer(page);
  const pinned = (await d.locator('[data-pin-row], [data-command^="sidebar.pinned.open"]').allInnerTexts()).map(flat);
  assert.equal(pinned[pinned.length - 1], 'Dlouhá poznámka', 'the drawer\'s Pinned shows it last');
  assert.equal(await d.locator('[draggable="true"]').count(), 0, 'no drag in the drawer');
  assert.equal(await d.getByRole('button', { name: /Move up|Move down|Pinned item actions/ }).count(), 0, 'no reorder or row menu');
  await systemBack(page);
  // Unpin removes only that entry
  menu = await openMore(page);
  await (await must(menu.getByRole('menuitem', { name: 'Unpin' }), 'Unpin on a pinned note')).click();
  await sleep(800);
  assert.equal((await core.files())[PH.pins], before.files[PH.pins], 'Unpin removes only that entry');
  // a pinned.yml changed on disk: pinned.md's alert, the section reloads
  await core.pinsFail('Conflict');
  menu = await openMore(page);
  await (await must(menu.getByRole('menuitem', { name: 'Pin' }), 'Pin')).click();
  await must(page.getByRole('alert'), 'pinned.md\'s alert', 2000);
});

// ------------------------------------------------------------------------------------------------ FR-HIS-01 AC-16

test('fr_his_01_ac16_move_one_note_to_the_trash_on_the_phone', async ({ page, browser }) => {
  const core = await startPhone(page, { vault: editVault(), route: 'inbox', now: EDIT_NOW });
  await goNote(page, 'Psaní');
  await needBody(page, 'Psaní');
  // a pending edit is saved first (D-196)
  await tapToEdit(page, 'Konec');
  await setCaret(page, 'Konec.', 'end');
  await ime(page, [{ text: '!' }]);
  await keyboard(page, false);
  const n = (await core.calls()).length;
  const menu = await openMore(page);
  await (await must(menu.getByRole('menuitem', { name: 'Move to trash' }), 'Move to trash')).click();
  const w = await eventually(() => writeCalls(core, n), (x) => x.some((y) => y.cmd === 'object_trash'), 2500);
  assert.deepEqual(w.map((x) => x.cmd), ['note_write', 'object_trash'], 'the pending edit is saved first, then object_trash (D-2527)');
  const files = await core.files();
  assert.equal(files[nfc(PE.psani)], undefined, 'Pages/Psaní.md is gone');
  assert.ok(files['.trash/Pages/Psaní.md']?.includes('Konec.!'), 'it is .trash/Pages/Psaní.md with its bytes');
  assert.deepEqual((await core.moves()).map((m) => [m.kind, m.from, m.to]), [['trash', nfc(PE.psani), '.trash/Pages/Psaní.md']], 'one rename');
  assert.ok(await h1Is(page, 'Inbox'), 'the app goes Back (to inbox without history)');
  const note = await must(notice(page).filter({ hasText: 'Moved "Psaní" to the trash' }), 'the notice', 1000);
  const undo = await must(note.getByRole('button', { name: 'Undo' }), 'Undo');
  assert.equal(await undo.getAttribute('data-command'), 'phone.notice.undo', 'data-command phone.notice.undo');
  await undo.click();
  await eventually(() => writeCalls(core, n), (x) => x.some((y) => y.cmd === 'trash_restore'), 2000);
  assert.ok((await core.files())[nfc(PE.psani)], 'Undo calls trash_restore');
  assert.ok(await h1Is(page, 'Psaní'), 'and returns to the note');
  // the notice lasts 4 s
  const p3 = await phonePage(browser);
  await startPhone(p3, { vault: editVault(), route: `note/${PE.cil}`, now: EDIT_NOW });
  await needBody(p3, 'Cíl');
  await (await openMore(p3)).getByRole('menuitem', { name: 'Move to trash' }).click();
  const nt = await must(notice(p3).filter({ hasText: 'Moved "Cíl" to the trash' }), 'the notice', 1500);
  await sleep(3500);
  assert.ok(await seen(nt, 100), 'still shown after 3.5 s');
  assert.ok(await eventually(() => nt.count(), (c) => c === 0, 1500) === 0, 'gone after 4 s');
  await p3.close();
  // a file changed on disk: AC-2's alert, nothing moves
  const p4 = await phonePage(browser);
  const c4 = await startPhone(p4, { vault: editVault(), route: `note/${PE.cil}`, now: EDIT_NOW });
  await needBody(p4, 'Cíl');
  const ext = `${(await c4.files())[nfc(PE.cil)]}Změna venku.\n`;
  await c4.setFile(PE.cil, ext, { silent: true });
  await (await openMore(p4)).getByRole('menuitem', { name: 'Move to trash' }).click();
  await must(p4.getByRole('alert').filter({ hasText: '"Cíl" changed outside Tegg. It wasn\'t moved to the trash.' }), 'AC-2\'s alert', 2500);
  assert.equal((await c4.files())[nfc(PE.cil)], ext, 'nothing moves');
  await p4.close();
  // a draft and a virtual day: aria-disabled with Nothing to delete yet.
  for (const route of ['new/page', 'daily/2026-10-14']) {
    const p = await phonePage(browser);
    await startPhone(p, { vault: editVault(), route, now: EDIT_NOW });
    const item = (await openMore(p)).getByRole('menuitem', { name: 'Move to trash' });
    await must(item, `${route}: Move to trash`);
    assert.equal(await item.getAttribute('aria-disabled'), 'true', `${route}: aria-disabled`);
    assert.equal(await item.getAttribute('aria-description'), 'Nothing to delete yet.', `${route}: Nothing to delete yet.`);
    await p.close();
  }
  // no Trash page or drawer entry
  const d = await openDrawer(page);
  assert.equal(await d.getByText('Trash', { exact: true }).count(), 0, 'no Trash entry in the drawer');
});

// ------------------------------------------------------------------------------------------------ FR-FMT-12 AC-18 (L5p)

test('fr_fmt_12_ac18_nfd_named_note_read_only_on_the_phone', async ({ page }) => {
  const POZ = 'Pages/Poznámka.md';
  const vault = editVault((f) => {
    f[POZ] = '---\nid: 01JBAN3000000000000000P001\ntype: page\ntitle: Poznámka\nreview: unreviewed\n---\n- [ ] Úkol v poznámce\n';
    f['Pages/Úvodní.md'] = '---\nid: 01JBAN3000000000000000P002\ntype: page\ntitle: Úvodní\n---\nViz [[Poznámka]].\n';
  });
  const core = await startPhone(page, { vault, route: `note/${POZ}`, now: EDIT_NOW, nfdNames: [POZ] });
  const before = await fileStateOf(core);
  const text = 'This note\'s file name uses a Unicode form the phone can\'t save safely. Edit it on the Mac.';
  await must(page.getByRole('alert').filter({ hasText: text }), 'the alert phone.nfdReadOnly');
  await must(saveState(page).filter({ hasText: 'Read-only' }), 'Save state Read-only');
  assert.equal(await page.locator('main [contenteditable="true"]').count(), 0, 'the read view');
  const box = main(page).getByRole('checkbox').first();
  assert.equal(await box.getAttribute('aria-disabled'), 'true', 'its checkbox is aria-disabled');
  assert.equal(await box.getAttribute('aria-description'), text, 'with that text');
  await box.tap({ force: true });
  const menu = await openMore(page);
  const trash = menu.getByRole('menuitem', { name: 'Move to trash' });
  if (await seen(trash, 500)) assert.equal(await trash.getAttribute('aria-disabled'), 'true', 'Move to trash is aria-disabled');
  await must(menu.getByRole('menuitem', { name: 'Pin' }), 'Pin stays (it writes only pinned.yml)');
  await page.keyboard.press('Escape');
  assert.equal(await runById(page, 'phone.properties'), 'ok', 'the Properties sheet');
  const sheet = page.getByRole('dialog', { name: 'Properties' });
  const controls = sheet.locator('[data-command^="phone.prop:"], input, [role="checkbox"], [role="combobox"]');
  for (const c of await controls.all()) assert.equal(await c.getAttribute('aria-disabled') ?? (await c.isDisabled() ? 'true' : null), 'true', 'the sheet\'s controls are aria-disabled');
  await systemBack(page);
  await sleep(1500);
  const named = (await core.calls()).filter((c) => (c.args as any)?.path === POZ && WRITE_COMMANDS.includes(c.cmd));
  assert.deepEqual(named, [], 'no write command names its path');
  await assertZeroWrites(core, before, 'the NFD-named note');
  // [[Poznámka]] in Úvodní still opens it; a [[Poznámka create from another note writes Quick Notes/Poznámka (2).md
  await goNote(page, 'Úvodní');
  await tap(page, noteBody(page).locator('[data-wikilink], .chip, a').filter({ hasText: 'Poznámka' }).first(), '[[Poznámka]]');
  assert.ok(await h1Is(page, 'Poznámka'), '[[Poznámka]] still opens it');
  await systemBack(page);
  await tapToEdit(page, 'Viz');
  await setCaret(page, 'Viz', 'end');
  await ime(page, [{ text: ' [[Poznámka' }]);
  await tap(page, panel(page, 'Link suggestions').getByRole('option').filter({ hasText: 'Create "Poznámka"' }).first(), 'Create "Poznámka"');
  const w = await eventually(() => writeCalls(core), (x) => x.some((y) => y.cmd === 'note_create'), 3000);
  assert.equal(w.find((x) => x.cmd === 'note_create')?.path, 'Quick Notes/Poznámka (2).md', 'vault-wide NFC stems: Quick Notes/Poznámka (2).md');
});
