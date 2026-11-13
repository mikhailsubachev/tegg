// Slice I2, L5 (WebKit + fake core): the Preview step and "nothing written before Import" of
// docs/acceptance/import-capacities.md: FR-IMP-05 AC-9 (the four groups with the plan's numbers, the line, the primary
// button; R153 `NoSpace`), AC-10 (Cancel and Esc on steps 0–5, 4b and 4c's lists change nothing; closing the app is
// L6's), FR-SYN-06 AC-45 (the fake records every call: no write before `Import`; after an import into a new vault the
// open vault is untouched). Interface docs/contracts/v1-import-window.md §2.1, §3.2, §3.9, §5.3, §7 (the canned plans
// of c05+c07, the decisions plan, plan-board). Written from the ACs and the contract only (D-61). Lookups go through
// `must` (TS-I1).
import { test, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import {
  BOARD, C01, C0507, DECISIONS, alertBox, attrRow, backBtn, canned, click, cmd, continueBtn, dialog, enabledSoon, eventually, flat, footerNamed, goTo,
  hideBtn, importBtn, importCallsOf, importHold, importRelease, isDisabled, main, menuNamed, must, mustBeClosed, mustStep, next, num, openImport, planNumbers,
  radioStarting, seen, startImport, startImportRun, startOsobni, statusButton, statusOpen, targetButton, typeRow, writeCalls, type FakeCoreHandle,
} from './import-helpers';
import { mainName } from './helpers';

test.use({ timezoneId: 'Europe/Prague' });

/** 4a → 5 through 4c when the plan has rows there. */
async function toPreview(page: Page) {
  await enabledSoon(continueBtn(page), 'Continue on 4a');
  await click(continueBtn(page), 'Continue on 4a');
  const s = await eventually(async () => (await dialog(page).getAttribute('data-import-step').catch(() => null)) ?? '', (x) => x === '5' || x === '4c', 5000);
  if (s === '4c') await next(page, '5', '4c');
  await mustStep(page, '5', 'the preview');
}
/** Step 5's groups: title → rows (label, text). */
async function groups(page: Page): Promise<{ title: string; rows: { label: string; text: string }[]; text: string }[]> {
  return dialog(page).evaluate((d) => [...d.querySelectorAll('section')].map((s) => ({
    title: (s.querySelector('h3')?.textContent ?? '').replace(/\s+/g, ' ').trim(),
    rows: [...s.querySelectorAll('[role="group"]')].map((g) => ({ label: (g.getAttribute('aria-label') ?? '').trim(), text: ((g as HTMLElement).innerText ?? '').replace(/\s+/g, ' ').trim() })),
    text: ((s as HTMLElement).innerText ?? '').replace(/\s+/g, ' ').trim(),
  })));
}

// ------------------------------------------------------------------------------------------------ FR-IMP-05 AC-9

test('fr_imp_05_ac9_preview_step', async ({ page }) => {
  const plan = canned('plan-c05+c07-PKM-new.json');
  const existing = canned('plan-c05+c07-PKM-existing.json');
  const n = planNumbers(plan);
  const core = await startImport(page, { imports: C0507() });
  await goTo(page, '4a', { how: 'folder' });
  await toPreview(page);
  const g = await groups(page);
  const want: { title: string; rows: [string, number, string][] }[] = [
    { title: 'Will be imported', rows: [['Objects', n.objects, `${n.types} types · ${n.newTypes} new`], ['Attachments', n.attachments, 'into _attachments/'], ['Links', n.links, 'rewritten by source ID']] },
    { title: 'Needs attention after', rows: [['Unresolved links', n.unresolved, 'kept and marked'], ['Query stubs', n.stubs, 'needs rebuilding']] },
    { title: 'Not in the export, can’t be imported', rows: [] },
    { title: 'Left out', rows: [['Technical attributes', n.technical.length, `${n.technical.length} kinds`], ['Missing files', n.missing, '']] },
  ];
  const shownGroups = want.filter((w) => w.title.startsWith('Not in the export') || w.rows.some(([, c]) => c > 0));
  assert.deepEqual(g.map((x) => x.title), shownGroups.map((w) => w.title), 'the groups in order; a group with no row isn\'t shown, `Not in the export` always is');
  for (const w of shownGroups) {
    const got = g.find((x) => x.title === w.title)!;
    const rows = w.rows.filter(([, c]) => c > 0);
    assert.deepEqual(got.rows.map((r) => r.label), rows.map(([l]) => l), `${w.title}: rows with a count above 0, each a group named by its label`);
    for (const [label, count, help] of rows) {
      const r = got.rows.find((x) => x.label === label)!;
      assert.ok(r.text.includes(num(count)), `${label}: the plan's count ${count}: ${r.text}`);
      if (label === 'Technical attributes') {
        const m = /kinds\s+(.+)$/.exec(r.text);
        const keys = (m?.[1] ?? '').replace(/, …$/, '').split(', ');
        assert.ok(r.text.includes(help), `${label}: \`${help}\`: ${r.text}`);
        assert.equal(keys.length, Math.min(2, n.technical.length), `${label}: the first two keys: ${r.text}`);
        assert.ok(keys.every((k) => n.technical.includes(k)), `${label}: keys dropped by D-78's default (${n.technical.join(', ')}): ${r.text}`);
        assert.equal(r.text.endsWith(', …'), n.technical.length > 2, `${label}: \`, …\` only when there are more`);
      } else if (help) assert.ok(r.text.includes(help), `${label}: the help \`${help}\`: ${r.text}`);
    }
  }
  assert.ok(g.find((x) => x.title.startsWith('Not in the export'))?.text.includes('Query definitions · tag colours · comments'), '`Query definitions · tag colours · comments`');
  await must(dialog(page).getByText('Nothing has been written yet. A new vault Capacities · PKM will be created.', { exact: true }), 'the line for a new vault');
  const primary = await must(importBtn(page), 'the primary button');
  assert.equal(flat(await primary.innerText()), `Import ${n.objects} objects`, 'the primary reads `Import <n> objects`');
  assert.match((await primary.getAttribute('class')) ?? '', /\bprimary\b/, 'it is the primary button');
  assert.deepEqual(await writeCalls(core), [], 'no call that writes before Import (FR-IMP-05 AC-9)');
  // This vault: the other sentence with the vault's name.
  await click(backBtn(page), 'Back');
  for (let i = 0; i < 3 && (await dialog(page).getAttribute('data-import-step')) !== '3'; i++) await click(backBtn(page), 'Back');
  await mustStep(page, '3', 'back to step 3');
  await click(radioStarting(page, 'Destination', 'This vault'), '`This vault · Trezor`');
  await next(page, '4a', 'step 3');
  await toPreview(page);
  const m = planNumbers(existing);
  await must(dialog(page).getByText(`Nothing has been written yet. ${num(m.objects)} objects will be added to Trezor after a backup.`, { exact: true }), 'the line for This vault (`<n> objects will be added to Trezor after a backup.`)', 3000);
  assert.equal(flat(await importBtn(page).innerText()), `Import ${m.objects} objects`, 'the primary counts the existing-vault plan');
  assert.deepEqual(await writeCalls(core), [], 'still no write');
});

test('fr_imp_05_ac9_preview_step: not enough disk space (R153 NoSpace)', async ({ page }) => {
  const core = await startImport(page, { imports: C0507({ free: 1000 }) });
  await goTo(page, '4a', { how: 'folder' });
  await toPreview(page);
  const alert = await must(alertBox(page), 'role="alert"', 3000);
  assert.match(flat(await alert.innerText()), /^Not enough disk space: the import needs about \S+ (MB|GB), \S+ (MB|GB) is free\.$/, 'R153\'s NoSpace text with two sizes');
  assert.equal(await isDisabled(importBtn(page)), true, 'the primary is aria-disabled');
  await importBtn(page).click({ force: true });
  await page.waitForTimeout(300);
  assert.deepEqual(await importCallsOf(core, 'import_start'), [], 'a press does nothing');
});

// ------------------------------------------------------------------------------------------------ FR-IMP-05 AC-10

/** Focus a sidebar link (the palette's opener), open the window, go to `s`. */
async function openAt(page: Page, s: string, go: () => Promise<void>) {
  await (await must(page.getByRole('navigation', { name: 'Sidebar' }).getByRole('link', { name: /^Inbox/ }), 'the sidebar\'s Inbox')).focus();
  await go();
  await mustStep(page, s, `setup: step ${s}`);
}
async function closesWithNothingWritten(page: Page, core: FakeCoreHandle, what: string, route: string | null, discards: number) {
  await mustBeClosed(page, what);
  assert.ok((await importCallsOf(core, 'import_discard')).length > discards, `${what}: import_discard`);
  assert.deepEqual(await writeCalls(core), [], `${what}: no call that writes`);
  assert.equal(await core.writes(), 0, `${what}: no write`);
  assert.equal(await mainName(page), route, `${what}: the route is unchanged`);
  const focus = await eventually(() => page.evaluate(() => (document.activeElement?.textContent ?? '').trim()), (t) => t.startsWith('Inbox'), 2000);
  assert.ok(focus.startsWith('Inbox'), `${what}: the focus is back on the element that opened the palette (${focus})`);
}

test('fr_imp_05_ac10_cancel_writes_nothing: steps 0–4a, Cancel and Esc', async ({ page }) => {
  const core = await startImport(page, { imports: C01() });
  const route = await mainName(page);
  const reach: Record<string, () => Promise<void>> = {
    '0': () => openImport(page),
    '1': () => goTo(page, '1'),
    '2': () => goTo(page, '2', { spaces: 3 }),
    '3': () => goTo(page, '3', { spaces: 3 }),
    '4a': () => goTo(page, '4a', { spaces: 3 }),
  };
  for (const s of ['0', '1', '2', '3', '4a']) {
    for (const how of ['Cancel', 'Esc'] as const) {
      const discards = (await importCallsOf(core, 'import_discard')).length;
      await openAt(page, s, reach[s]);
      if (how === 'Cancel') await click(cmd(page, 'import.cancel'), `step ${s}: Cancel`);
      else await page.keyboard.press('Escape');
      await closesWithNothingWritten(page, core, `step ${s}, ${how}`, route, discards);
    }
  }
});

test('fr_imp_05_ac10_cancel_writes_nothing: 4b, 4c and its lists, 5', async ({ page }) => {
  // 4b (the board): Esc is `Back to types` (R151), then Esc cancels from 4a.
  let core = await startOsobni(page);
  const discards0 = (await importCallsOf(core, 'import_discard')).length;
  await openAt(page, '3', () => goTo(page, '3'));
  await click(radioStarting(page, 'Destination', 'This vault'), '`This vault`');
  await next(page, '4a', 'step 3');
  await click(statusButton(typeRow(page, 'Tasks')), 'the Tasks status');
  await mustStep(page, '4b', '4b');
  await click(attrRow(page, 'priority').getByRole('button', { name: 'Merge', exact: true }), 'a choice on 4b');
  await page.keyboard.press('Escape');
  await mustStep(page, '4a', 'Esc on 4b');
  await page.keyboard.press('Escape');
  await closesWithNothingWritten(page, core, '4b, then Esc on 4a', await mainName(page), discards0);

  // 4c, its lists and 5 (the decisions plan).
  const page2 = await page.context().newPage();
  core = await startImport(page2, { imports: DECISIONS() });
  // The new page's route is ready before it is read (state, not time).
  const route = await eventually(() => mainName(page2), (n) => !!n, 5000);
  assert.ok(route, 'the second page shows its route after start');
  for (const [s, how] of [['4c', 'Cancel'], ['4c', 'Esc'], ['list', 'Esc'], ['5', 'Cancel'], ['5', 'Esc']] as const) {
    const discards = (await importCallsOf(core, 'import_discard')).length;
    await openAt(page2, s === '5' ? '5' : '4c', async () => {
      await goTo(page2, '4c', { how: 'folder' });
      if (s === '5') await next(page2, '5', '4c');
    });
    if (s === 'list') {
      await click(dialog(page2).getByRole('button', { name: 'Review…', exact: true }), '`Review…`');
      await dialog(page2).getByRole('checkbox', { name: 'Use this object' }).first().check();
      await page2.keyboard.press('Escape');
      assert.ok(await seen(dialog(page2).getByRole('button', { name: 'Info', exact: true }), 2000), 'Esc on 4c\'s list goes back to 4c');
      await page2.keyboard.press('Escape');
    } else if (how === 'Cancel') await click(cmd(page2, 'import.cancel'), `${s}: Cancel`);
    else await page2.keyboard.press('Escape');
    await closesWithNothingWritten(page2, core, `${s}, ${how}`, route, discards);
  }
  await page2.close();
});

// ------------------------------------------------------------------------------------------------ FR-SYN-06 AC-45

test('fr_syn_06_ac45_import_window_writes_nothing', async ({ page }) => {
  const core = await startImport(page, { imports: DECISIONS() });
  const before = await core.files();
  // Open, read, every step, choices, Back, Cancel, reopen.
  await goTo(page, '4a', { how: 'folder' });
  await click(targetButton(typeRow(page, 'Pages')), 'the Pages target button');
  await must(menuNamed(page, 'Pages becomes'), 'menu `Pages becomes`');
  await page.keyboard.press('Escape');
  await next(page, '4c', '4a');
  await click(dialog(page).getByRole('button', { name: 'Review…', exact: true }), '`Review…`');
  await dialog(page).getByRole('checkbox', { name: 'Use this object' }).first().check();
  await click(footerNamed(page, 'Done'), '`Done`');
  await next(page, '5', '4c');
  await click(backBtn(page), 'Back');
  await mustStep(page, '4c', 'Back');
  await next(page, '5', '4c again');
  await click(cmd(page, 'import.cancel'), 'Cancel');
  await mustBeClosed(page, 'Cancel');
  assert.deepEqual(await writeCalls(core), [], 'no call that writes up to and including the preview, choices, Back and Cancel');
  assert.equal(await core.writes(), 0, 'the fake counted 0 writes');
  assert.deepEqual(await core.files(), before, 'the open vault is unchanged');
  // Again, then Import into a new vault, Hide and reopen.
  await goTo(page, '4c', { how: 'folder' });
  await next(page, '5', '4c');
  assert.equal(await core.writes(), 0, 'still 0 writes before Import');
  await importHold(core, 'writing');
  await startImportRun(page);
  assert.deepEqual(await writeCalls(core), ['import_start'], 'the first write call is import_start');
  await click(hideBtn(page), 'Hide');
  await mustBeClosed(page, 'Hide');
  await click(statusOpen(page), 'the status element');
  await mustStep(page, '6', 'reopened');
  await importRelease(core);
  await mustStep(page, '7', 'done', 15_000);
  assert.deepEqual(await core.files(), before, 'after Import into a new vault the open vault is still untouched');
  assert.ok(await seen(main(page)), 'the app is still on its page');
});

test('fr_syn_06_ac45_import_window_writes_nothing: the board into This vault writes nothing before Import', async ({ page }) => {
  const core = await startOsobni(page, { imports: BOARD() });
  const before = await core.files();
  await goTo(page, '3');
  await click(radioStarting(page, 'Destination', 'This vault'), '`This vault`');
  await next(page, '4a', 'step 3');
  await click(targetButton(typeRow(page, 'People')), 'People');
  await click(menuNamed(page, 'People becomes').getByRole('menuitemradio', { name: 'Don’t import', exact: true }), '`Don’t import`');
  await next(page, '5', '4a');
  assert.deepEqual(await writeCalls(core), [], 'no call that writes');
  assert.equal(await core.writes(), 0, '0 writes');
  assert.deepEqual(await core.files(), before, 'the vault is unchanged');
});
