// Slice I2, L5 (WebKit + fake core): entry points and the keyboard of docs/acceptance/import-capacities.md: FR-UX-03
// AC-43 (the palette with and without a vault, the chooser button, the app menu's `import:open`, the focus on the
// heading, one window brought forward; no `Go to Import`), AC-44 (the whole import without the pointer: c01-spaces
// zipped, `Work`, a new vault; the start call names Work's plan). The registry part is app/test/import_registry.ac.test.ts,
// the menu item app/e2e/import.ac.test.ts. Interface docs/contracts/v1-import-window.md §3.2, §4, §7. Written from the ACs
// and the contract only (D-61). Lookups go through `must` (TS-I1).
import { test, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import {
  C01, DECISIONS, click, dialog, emit, enabledSoon, eventually, focusName, goTo, hideBtn, importCallsOf, importHold, importRelease, lastMapping,
  must, mustBeClosed, mustStep, next, paletteOptions, paletteRun, radiogroup, radios, seen, startImport, startImportRun, statusOpen, vaultOpens,
} from './import-helpers';

test.use({ timezoneId: 'Europe/Prague' });

/** The focused element: inside the Import dialog, or inside an open menu of it; never the page behind. */
async function focusInside(page: Page): Promise<{ inside: boolean; what: string; command: string | null; role: string | null; popup: string | null }> {
  return page.evaluate(() => {
    const a = document.activeElement as HTMLElement | null;
    const inside = !!a && (!!a.closest('[data-import-step]') || !!a.closest('[role="menu"]'));
    return { inside, what: (a?.getAttribute('aria-label') ?? a?.textContent ?? a?.tagName ?? '').replace(/\s+/g, ' ').trim().slice(0, 60), command: a?.getAttribute('data-command') ?? null, role: a?.getAttribute('role') ?? null, popup: a?.getAttribute('aria-haspopup') ?? null };
  });
}
async function headingHasFocus(page: Page, ms = 2000): Promise<boolean> {
  return eventually(() => page.evaluate(() => {
    const a = document.activeElement;
    return !!a && a.tagName === 'H2' && !!a.closest('[data-import-step]');
  }), (v) => v, ms);
}
/** Presses a key and asserts the focus stayed in the window (FR-UX-03 AC-44). */
async function key(page: Page, k: string, what: string) {
  await page.keyboard.press(k);
  const f = await focusInside(page);
  assert.ok(f.inside, `${what} (${k}): the focus stays in the Import window, not on "${f.what}"`);
}
/** Tab (⇧Tab with `back`) until the focused element matches; asserts it was reached. */
async function tabTo(page: Page, ok: (f: Awaited<ReturnType<typeof focusInside>>) => boolean, what: string, back = false, max = 40) {
  for (let i = 0; i < max; i++) {
    if (ok(await focusInside(page))) return;
    await key(page, back ? 'Shift+Tab' : 'Tab', `looking for ${what}`);
  }
  assert.ok(ok(await focusInside(page)), `${what} is reached with Tab`);
}
const byCommand = (c: string) => (f: { command: string | null }) => f.command === c;

// ------------------------------------------------------------------------------------------------ FR-UX-03 AC-43

test('fr_ux_03_ac43_import_entry_points: the palette with a vault, the menu event, one window', async ({ page }) => {
  const core = await startImport(page, { imports: DECISIONS() });
  // The palette lists `Import…` (no shortcut) and no `Go to Import`.
  await page.keyboard.press('Meta+k');
  await page.getByRole('combobox', { name: 'Command query' }).fill('Import');
  await page.waitForTimeout(200);
  const options = (await paletteOptions(page)).map((o) => o.split('\n').map((x) => x.trim()).filter(Boolean));
  const imp = options.find((o) => o[0] === 'Import…');
  assert.ok(imp, `the palette lists \`Import…\`: ${JSON.stringify(options)}`);
  assert.equal(imp!.length, 1, `\`Import…\` shows no shortcut: ${JSON.stringify(imp)}`);
  assert.ok(!options.some((o) => o[0] === 'Go to Import'), 'no `Go to Import` (the route is gone)');
  await page.keyboard.press('Escape');
  await paletteRun(page, 'Import…');
  await mustStep(page, '0', 'the palette opens step 0');
  assert.ok(await headingHasFocus(page), 'the focus is on the heading');
  assert.equal(await dialog(page).count(), 1, 'one window');
  // The app menu's `File › Import…` arrives as `import:open`: with the window open it brings it forward, never a second.
  await next(page, '1', 'step 0');
  await click(dialog(page).locator('button[data-command="import.chooseFolder"]'), 'Choose folder…');
  await next(page, '3', 'step 1 (one space)');
  await emit(core, 'import:open');
  await page.waitForTimeout(300);
  assert.equal(await dialog(page).count(), 1, 'still one window');
  assert.equal(await dialog(page).getAttribute('data-import-step'), '3', 'the open window keeps its step (not a new import)');
  assert.equal((await importCallsOf(core, 'import_scan')).length, 1, 'and its source');
  await page.keyboard.press('Escape');
  await mustBeClosed(page, 'Esc');
  // The menu event with no window: step 0, focus on the heading.
  await emit(core, 'import:open');
  await mustStep(page, '0', '`import:open` (File › Import…) opens step 0');
  assert.ok(await headingHasFocus(page), 'the focus is on the heading');
  await page.keyboard.press('Escape');
  // With an import running (hidden), Import… brings the window forward at step 6.
  await goTo(page, '4c', { how: 'folder' });
  await next(page, '5', '4c');
  await importHold(core, 'writing');
  await startImportRun(page);
  await click(hideBtn(page), 'Hide');
  await mustBeClosed(page, 'Hide');
  await paletteRun(page, 'Import…');
  await mustStep(page, '6', 'Import… with an import running shows it (step 6)');
  assert.ok(await headingHasFocus(page), 'focus on the heading');
  assert.equal(await dialog(page).count(), 1, 'one window');
  await emit(core, 'import:open');
  await page.waitForTimeout(300);
  assert.equal(await dialog(page).getAttribute('data-import-step'), '6', '`import:open` keeps step 6');
  await importRelease(core);
});

test('fr_ux_03_ac43_import_entry_points: without a vault, the palette and the chooser', async ({ page }) => {
  await startImport(page, { vault: null, frame: 'chooser', imports: DECISIONS() });
  await page.keyboard.press('Meta+k');
  await page.getByRole('combobox', { name: 'Command query' }).fill('Import…');
  await page.waitForTimeout(200);
  assert.equal(((await paletteOptions(page))[0] ?? '').split('\n')[0].trim(), 'Import…', 'the palette offers `Import…` with no vault (D-137 gains it)');
  await page.keyboard.press('Enter');
  await mustStep(page, '0', 'the palette opens step 0 over the chooser');
  assert.ok(await headingHasFocus(page), 'focus on the heading');
  await page.keyboard.press('Escape');
  await mustBeClosed(page, 'Esc');
  const chooser = page.getByRole('main', { name: 'Choose a vault' });
  const b = await must(chooser.locator('button[data-command="import.open"]'), 'the chooser\'s `Import…`');
  const buttons = await chooser.getByRole('button').allInnerTexts();
  const i = buttons.findIndex((t) => t.trim() === 'Import…');
  assert.ok(i > 0 && buttons.slice(0, i).some((t) => /Open/.test(t)), `\`Import…\` follows the chooser's open button: ${JSON.stringify(buttons)}`);
  await b.focus();
  await page.keyboard.press('Enter');
  await mustStep(page, '0', 'the chooser button opens step 0');
  assert.ok(await headingHasFocus(page), 'focus on the heading');
});

// ------------------------------------------------------------------------------------------------ FR-UX-03 AC-44

test('fr_ux_03_ac44_import_without_the_pointer', async ({ page }) => {
  const core = await startImport(page, { imports: C01() });
  await page.keyboard.press('Meta+k');
  await page.keyboard.type('Import…');
  await page.waitForTimeout(200);
  await page.keyboard.press('Enter');
  await mustStep(page, '0', 'the palette (keys)');
  assert.ok(await headingHasFocus(page), 'step 0: focus on the heading');
  await tabTo(page, byCommand('import.continue'), 'Continue (step 0)');
  await key(page, 'Enter', 'Continue');
  await mustStep(page, '1', 'step 1');
  await tabTo(page, byCommand('import.chooseZip'), '`Choose zip…`');
  await key(page, 'Enter', 'Choose zip…');
  await enabledSoon(dialog(page).locator('button[data-command="import.continue"]'), 'Continue after reading', 8000);
  await tabTo(page, byCommand('import.continue'), 'Continue (step 1)');
  await key(page, 'Enter', 'Continue');
  await mustStep(page, '2', 'step 2');
  // The Space radios: one Tab stop, ↓ checks Work.
  await tabTo(page, (f) => f.role === 'radio', 'the checked space');
  await key(page, 'ArrowDown', 'Space: ↓');
  assert.equal(await radiogroup(page, 'Space').getByRole('radio', { checked: true }).innerText().then((t) => t.split('\n')[0].trim()), 'Work', '↓ checks Work');
  await tabTo(page, byCommand('import.continue'), 'Continue (step 2)');
  await key(page, 'Enter', 'Continue');
  await mustStep(page, '3', 'step 3');
  // Keep `A new vault`.
  await enabledSoon(dialog(page).locator('button[data-command="import.continue"]'), 'Continue on step 3');
  await tabTo(page, byCommand('import.continue'), 'Continue (step 3)');
  await key(page, 'Enter', 'Continue');
  await mustStep(page, '4a', '4a');
  // A `becomes` menu: open it, choose a type (the one checked, so the written vault stays FR-IMP-22 AC-1's), back.
  await tabTo(page, (f) => f.popup === 'menu' && f.what === 'Task', 'the Tasks row\'s target button (`Task`)');
  await key(page, 'Enter', 'open `Tasks becomes`');
  await must(page.getByRole('menu', { name: 'Tasks becomes' }), 'menu `Tasks becomes`');
  for (let i = 0; i < 8 && (await focusName(page)).name !== 'Task'; i++) await key(page, 'ArrowDown', 'in the menu');
  assert.equal((await focusName(page)).name, 'Task', 'the item `Task` is reached with ↓');
  await key(page, 'Enter', 'choose `Task`');
  assert.ok(!(await seen(page.getByRole('menu', { name: 'Tasks becomes' }), 300)), 'the menu closes');
  const back = await focusInside(page);
  assert.deepEqual([back.popup, back.what], ['menu', 'Task'], 'the focus is back on the target button');
  assert.deepEqual((await lastMapping(core))?.types?.Task?.to, { kind: 'existing', key: 'task' }, 'the choice reached the plan');
  // 4b from a status button and back.
  await tabTo(page, byCommand('import.mapAttributes'), 'a status button');
  await key(page, 'Enter', 'open 4b');
  await mustStep(page, '4b', '4b');
  await key(page, 'Escape', 'Back to types');
  await mustStep(page, '4a', 'back on 4a');
  assert.equal((await focusInside(page)).command, 'import.mapAttributes', 'the focus is on the status button again');
  // On to the preview and Import.
  await tabTo(page, byCommand('import.continue'), 'Continue (4a)');
  await key(page, 'Enter', 'Continue');
  const s = await eventually(async () => (await dialog(page).getAttribute('data-import-step')) ?? '', (x) => x === '5' || x === '4c', 3000);
  if (s === '4c') {
    await tabTo(page, byCommand('import.continue'), 'Continue (4c)');
    await key(page, 'Enter', 'Continue');
  }
  await mustStep(page, '5', 'the preview');
  await enabledSoon(dialog(page).locator('button[data-command="import.start"]'), 'Import <n> objects');
  await tabTo(page, byCommand('import.start'), '`Import <n> objects`');
  await key(page, 'Enter', 'Import');
  await mustStep(page, '6', 'importing');
  await mustStep(page, '7', 'done', 20_000);
  // The start call names Work's plan.
  const calls = await core.calls();
  const plans = calls.filter((c) => c.cmd === 'import_plan');
  const lastPlan = plans.at(-1);
  assert.equal((lastPlan?.args as any)?.space, 'Work', 'the last plan is Work\'s');
  const start = calls.find((c) => c.cmd === 'import_start');
  assert.equal((start?.args as any)?.token, (lastPlan?.result as any)?.token, 'import_start starts the token of Work\'s plan');
  assert.ok(Object.keys((start?.args as any)?.reportStrings ?? {}).every((k) => k.startsWith('import.report.')) && Object.keys((start?.args as any)?.reportStrings ?? {}).length > 0, 'reportStrings: the `import.report.*` entries');
  // Open vault.
  await tabTo(page, byCommand('import.openVault'), '`Open vault`');
  await page.keyboard.press('Enter');
  assert.ok((await eventually(() => vaultOpens(core), (v) => v.length > 0, 3000)).length > 0, 'Open vault opens the new vault');
  await mustBeClosed(page, 'Open vault');
});

test('fr_ux_03_ac44_import_without_the_pointer: Tab cycles inside the dialog; Step 0\'s radios move with arrows', async ({ page }) => {
  await startImport(page, { imports: C01() });
  await paletteRun(page, 'Import…');
  await mustStep(page, '0', 'step 0');
  const seenFocus: string[] = [];
  for (let i = 0; i < 12; i++) {
    await key(page, 'Tab', 'Tab on step 0');
    seenFocus.push((await focusInside(page)).what);
  }
  for (let i = 0; i < 12; i++) await key(page, 'Shift+Tab', '⇧Tab on step 0');
  assert.ok(new Set(seenFocus).size >= 3, `Tab cycles through the dialog's controls: ${JSON.stringify(seenFocus)}`);
  await tabTo(page, (f) => f.role === 'radio', 'the Source radios');
  const list = radios(page, 'Source');
  assert.equal(await list.count(), 3, 'three sources');
  await key(page, 'ArrowDown', '↓ on Source');
  assert.equal(await list.nth(0).getAttribute('aria-checked'), 'true', '`Capacities export` stays checked: the others are aria-disabled');
  await key(page, 'Escape', 'Esc');
  await mustBeClosed(page, 'Esc on step 0 is Cancel');
  assert.ok((await statusOpen(page).count()) === 0, 'no status');
});
