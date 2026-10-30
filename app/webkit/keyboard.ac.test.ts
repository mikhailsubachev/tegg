// MS3 slice 3A, L5 (WebKit + fake core): FR-UX-03 keyboard-first (palette, shortcuts, focus).
// Written from docs/acceptance/app-shell.md and docs/contracts/ms3-shell.md only (D-61).
import { test, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import { R1, R4, STATIC_COMMANDS } from '../test/shell-tables';
import {
  absent, draftStatus, eventually, focused, gotoTagPage, gotoType, isDraft, mainName, must, mustBeDraft, mustBeOn, newObjectDialog, nonReadCalls, onPage, openNote, panel,
  paletteDialog, paletteOptions, runCommand, seen, shellVaultWithTag, sidebar, sleep, start, switcherDialog, theme, titleState, settled,
  searchQueryField,
} from './helpers';

const TYPE_PLURALS = ['Pages', 'Tasks', 'Quick Notes', 'Daily Notes', 'Cesty', 'Čajovny', 'Schůzky', 'Images', 'PDFs', 'recept'];
const query = (page: Page) => page.getByRole('combobox', { name: 'Command query' });

/** Stands for the unsaved draft `new/<type>` (D-520), which is recognised by `isDraft`, not by a page name. */
const DRAFT = '\u0000new-object-draft';
/** Whether the route `goRoute` returned for is shown: the centre-pane name, or the draft for `new/<type>`. */
async function reached(page: Page, name: string, ms: number): Promise<boolean> {
  return name === DRAFT ? isDraft(page, ms) : onPage(page, name, ms);
}

/** Starts the app for an R1 row: `tag/<key>` needs a vault with a tag (AP-685, D-747: `tag/účty`). */
const startFor = (page: Page, row: (typeof R1)[number]) => start(page, row.id === 'tag/<key>' ? { vault: shellVaultWithTag() } : {});

/** Goes to an R1 route by its "Reached by" palette means; returns the expected centre-pane name (DRAFT for a draft). */
async function goRoute(page: Page, row: (typeof R1)[number]): Promise<string> {
  if (row.id === 'chooser') { await runCommand(page, 'Open vault…'); return 'Choose a vault'; }
  if (row.id === 'new/<type>') { await page.keyboard.press('Meta+n'); return DRAFT; } // D-520: New object (⌘N)
  if (row.id === 'type/<type>') { await gotoType(page, 'Quick Notes'); return 'Quick Notes'; }
  if (row.id === 'tag/<key>') return gotoTagPage(page); // AP-685 (D-747): tag/účty, on startFor's vault
  if (row.id === 'note/<path>') { await openNote(page, '2026-10-07 Porada'); return '2026-10-07 Porada'; }
  // Slice G1 (D-1022): `graph/<path>` has no Go to command; it is the full view of a note, opened with ⌘⇧G.
  if (row.id === 'graph/<path>') { await openNote(page, '2026-10-07 Porada'); await page.keyboard.press('Meta+Shift+g'); return 'Graph · 2026-10-07 Porada'; }
  if (row.id === 'type-settings/<type>') {
    await gotoType(page, 'Quick Notes');
    await page.getByRole('main').getByRole('button', { name: 'Type settings' }).or(page.getByRole('main').getByRole('link', { name: 'Type settings' })).first().click();
    return 'Type settings';
  }
  await runCommand(page, row.goto!);
  return row.page;
}

async function paletteOpensWithCursor(page: Page, keys: string, where: string) {
  await page.keyboard.press(keys);
  assert.ok(await seen(paletteDialog(page), 1500), `${keys} at ${where}: palette not open`);
  const f = await page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? '');
  assert.equal(f, 'Command query', `${keys} at ${where}: cursor not in Command query`);
  await page.keyboard.press('Escape');
  assert.ok(await absent(paletteDialog(page)), `${where}: Esc closes the palette`);
}

// One test per route so Playwright spreads the routes over workers (D-343); each starts from a fresh app.
for (const row of R1) {
  test(`fr_ux_03_ac1_palette_opens_from_every_route_and_focus: ${row.id}`, async ({ page }) => {
    await startFor(page, row);
    const name = await goRoute(page, row);
    if (name === DRAFT) await mustBeDraft(page, `route ${row.id}`);
    else await mustBeOn(page, name, `route ${row.id}`);
    for (const keys of ['Meta+k', 'Meta+Shift+p']) {
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      await paletteOpensWithCursor(page, keys, `${row.id}, focus on body`);
      if (row.id !== 'chooser') {
        await sidebar(page).getByRole('link', { name: 'Inbox', exact: true }) /* 5B: the entry may show its count */.focus();
        await paletteOpensWithCursor(page, keys, `${row.id}, focus on a sidebar entry`);
        await sidebar(page).getByRole('button', { name: 'New type' }).focus();
        await paletteOpensWithCursor(page, keys, `${row.id}, focus on a disabled control`);
      }
    }
    if (row.id === 'search') {
      await page.getByRole('textbox', { name: 'Search query' }).or(page.getByRole('searchbox', { name: 'Search query' })).first().focus();
      await paletteOpensWithCursor(page, 'Meta+k', 'search, focus in a text field');
    }
  });
}

test('fr_ux_03_ac1_palette_opens_from_every_route_and_focus: over the search field and New object', async ({ page }) => {
  await start(page);
  // D-760: the ⌘O switcher is gone; the palette opens over the Search page with the caret in its field. D-520: New
  // object opens an unsaved draft (no dialog); the palette opens over it with the caret in the draft's title.
  await page.keyboard.press('Meta+Shift+f');
  await must(searchQueryField(page), 'Search query');
  await page.keyboard.press('Meta+k');
  assert.ok(await seen(paletteDialog(page)), 'palette over the search field');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Meta+n');
  await mustBeDraft(page, 'New object');
  await page.keyboard.press('Meta+Shift+p');
  assert.ok(await seen(paletteDialog(page)), 'palette over the New object draft');
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? ''), 'Command query', 'cursor in Command query');
  assert.ok(await absent(newObjectDialog(page), 300), 'no New object dialog');
});

/** The effect a command title should have (FR-UX-03 AC-2). */
async function checkEffect(page: Page, title: string, before: { main: string | null; sidebar: boolean; panel: boolean; theme?: string }): Promise<string | null> {
  // 4B (R18): `Go to date…` opens the calendar, not a page.
  if (title === 'Go to date…') {
    const ok = await seen(page.getByRole('dialog', { name: 'Calendar' }), 1500);
    await page.keyboard.press('Escape');
    return ok ? null : `${title}: no calendar`;
  }
  const go = /^Go to (?:type: )?(.+)$/.exec(title);
  if (go) {
    // 4B (D-320): Today opens the daily route, named by its date.
    const target = go[1] === 'Settings' ? 'Settings: Appearance' : go[1] === 'Today' ? new Date().toLocaleDateString('sv') : go[1];
    return (await onPage(page, target, 2000)) ? null : `${title}: centre pane is ${await mainName(page)}`;
  }
  const t = /^Theme: (System|Light|Dark)$/.exec(title);
  if (t) {
    if (t[1] === 'System') return null;
    const want = t[1].toLowerCase();
    return (await eventually(() => theme(page), (v) => v === want, 1000)) === want ? null : `${title}: theme ${await theme(page)}`;
  }
  switch (title) {
    case 'Open vault…':
    case 'Create new vault…':
      return (await seen(page.getByRole('main', { name: 'Choose a vault' }), 1500)) || (await seen(page.getByRole('form', { name: 'New vault' }), 300)) ? null : `${title}: no chooser`;
    // D-520: an unsaved draft with an empty title (the caret is checked in fr_nav_01_ac13 and fr_ux_03_ac1).
    // 3 s as `isDraft`: ⌘N reaches the draft through several async steps (switcher, flush, prepareObject).
    case 'New object': return (await seen(draftStatus(page), 3000)) && (await titleState(page)).text === '' ? null : `${title}: no unsaved draft`;
    case 'Toggle sidebar': return (await seen(sidebar(page), 800)) !== before.sidebar ? null : `${title}: sidebar unchanged`;
    case 'Toggle right panel': return (await seen(panel(page), 800)) !== before.panel ? null : `${title}: panel unchanged`;
    case 'Toggle focus mode': return (await absent(sidebar(page), 800)) ? null : `${title}: sidebar still shown`;
    case 'Open command palette': return (await seen(paletteDialog(page), 800)) ? null : `${title}: palette not open`;
    default: return null; // effect not derivable from the title; only "ranked first, runs, closes" is checked
  }
}

// Four shards over the command list so they run on parallel workers (D-343); every command is in exactly one.
const AC2_SHARDS = 4;
for (let shard = 0; shard < AC2_SHARDS; shard++) test(`fr_ux_03_ac2_every_command_ranks_first_and_runs: shard ${shard + 1}/${AC2_SHARDS}`, async ({ page }) => {
  test.setTimeout(120_000);
  await start(page);
  await openNote(page, '2026-10-07 Porada'); // so the panel and focus-mode commands have an object
  await page.keyboard.press('Meta+k');
  await must(paletteDialog(page), 'Command palette');
  const all = (await paletteOptions(page)).map((t) => t.split('\n')[0].trim());
  await page.keyboard.press('Escape');
  for (const s of STATIC_COMMANDS) assert.ok(all.includes(s), `palette lists "${s}"`);
  const failures: string[] = [];
  for (const [i, title] of all.entries()) {
    if (i % AC2_SHARDS !== shard) continue;
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    if (!(await onPage(page, '2026-10-07 Porada', 200))) await openNote(page, '2026-10-07 Porada');
    const before = { main: await mainName(page), sidebar: await seen(sidebar(page), 200), panel: await seen(panel(page), 200) };
    await page.keyboard.press('Meta+k');
    await query(page).fill(title);
    await sleep(60);
    const first = ((await paletteOptions(page))[0] ?? '').split('\n')[0].trim();
    if (first !== title) { failures.push(`"${title}" ranks "${first}" first`); continue; }
    const disabled = /Coming in/.test((await paletteOptions(page))[0]);
    // 6A (trash-media.md R75): `Move to trash` would move Porada itself (FR-HIS-01 AC-3 runs it, trash.ac.test.ts).
    if (title === 'Move to trash') { await page.keyboard.press('Escape'); continue; }
    await page.keyboard.press('Enter');
    if (disabled) continue; // FR-UX-03 AC-6 checks disabled commands
    if (title !== 'Open command palette' && !(await absent(paletteDialog(page), 1000))) failures.push(`"${title}": palette stays open`);
    const e = await checkEffect(page, title, before);
    if (e) failures.push(e);
    if (title === 'Toggle focus mode') await page.keyboard.press('Escape');
  }
  assert.deepEqual(failures, []);
});

test('fr_ux_03_ac3_type_commands_follow_external_type_changes', async ({ page }) => {
  const core = await start(page);
  await page.keyboard.press('Meta+k');
  await must(paletteDialog(page), 'Command palette');
  await query(page).fill('Go to type:');
  const titles = (await paletteOptions(page)).map((t) => t.split('\n')[0].trim()).filter((t) => t.startsWith('Go to type: '));
  assert.deepEqual([...titles].sort(), TYPE_PLURALS.map((p) => `Go to type: ${p}`).sort());
  await page.keyboard.press('Escape');
  await core.setFile('.tegg/types/kniha.yml', 'version: 1\nname: Kniha\nplural: Knihy\nsystem: false\nfolder: Knihy\nicon: book\ncolor: purple\nreview: false\npreview: []\nattributes: []\n');
  const found = await eventually(async () => {
    await page.keyboard.press('Meta+k');
    await query(page).fill('Go to type: Knihy');
    await sleep(50);
    const o = ((await paletteOptions(page))[0] ?? '').split('\n')[0].trim();
    await page.keyboard.press('Escape');
    return o;
  }, (o) => o === 'Go to type: Knihy', 2000);
  assert.equal(found, 'Go to type: Knihy', 'a new type file adds its command within 2 s');
});

test('fr_ux_03_ac4_palette_matching_folds_case_diacritics_and_nfd', async ({ page }) => {
  await start(page);
  for (const q of ['cajovny', 'ČAJOVNY', 'čajovny'.normalize('NFD'), 'gtcaj']) {
    await page.keyboard.press('Meta+k');
    await must(paletteDialog(page), 'Command palette');
    await query(page).fill(q);
    await sleep(60);
    const first = ((await paletteOptions(page))[0] ?? '').split('\n')[0].trim();
    assert.equal(first, 'Go to type: Čajovny', `query ${JSON.stringify(q)}`);
    await page.keyboard.press('Escape');
  }
});

test('fr_ux_03_ac5_keyboard_inside_the_palette', async ({ page }) => {
  await start(page);
  const entry = sidebar(page).getByRole('link', { name: 'Inbox', exact: true }) /* 5B: the entry may show its count */;
  await entry.focus();
  const before = await focused(page);
  await page.keyboard.press('Meta+k');
  await must(paletteDialog(page), 'Command palette');
  await query(page).fill('Go to');
  await sleep(60);
  const selected = () => page.getByRole('listbox', { name: 'Commands' }).getByRole('option', { selected: true }).innerText().then((t) => t.split('\n')[0].trim(), () => '');
  const opts = (await paletteOptions(page)).map((t) => t.split('\n')[0].trim());
  assert.ok(opts.length >= 3, 'several Go to commands');
  assert.equal(await selected(), opts[0], 'first option selected');
  await page.keyboard.press('ArrowDown');
  assert.equal(await selected(), opts[1], '↓ moves down');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowUp');
  assert.equal(await selected(), opts[1], '↑ moves up');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  assert.ok(await absent(paletteDialog(page)), '⏎ closes the palette');
  const target = opts[2].replace(/^Go to (type: )?/, '');
  await mustBeOn(page, target === 'Settings' ? 'Settings: Appearance' : target, '⏎ runs the selected command');
  // The page takes the focus a frame after it shows (its heading or field); wait for that before focusing the entry,
  // or it takes the focus back from the entry under load.
  assert.ok((await eventually(() => focused(page), (f) => f.inMain)).inMain, 'the new page takes the focus');
  await sidebar(page).getByRole('link', { name: 'Inbox', exact: true }) /* 5B: the entry may show its count */.focus();
  await page.keyboard.press('Meta+k');
  await must(paletteDialog(page), 'Command palette (second open)');
  await page.keyboard.press('Escape');
  assert.ok(await absent(paletteDialog(page)), 'Esc closes');
  assert.deepEqual(await focused(page), before, 'focus returns to the element that had it');
});

test('fr_ux_03_ac6_shortcut_display_and_disabled_commands', async ({ page }) => {
  const core = await start(page);
  const shown: [string, string][] = [
    ['Go to Search', '⇧⌘F'], ['Toggle sidebar', '⌃⌘S'], ['New object', '⌘N'], // D-760: no ⌘O
    ['Go to Today', '⌘D'], ['Go to Inbox', '⇧⌘I'], ['Toggle right panel', '⌘\\'], ['Toggle focus mode', '⇧⌘\\'],
  ];
  for (const [title, keys] of shown) {
    await page.keyboard.press('Meta+k');
    await must(paletteDialog(page), 'Command palette');
    await query(page).fill(title);
    await sleep(60);
    const row = (await paletteOptions(page))[0] ?? '';
    assert.ok(row.startsWith(title), `"${title}" first`);
    assert.ok(row.replace(/\s+/g, '').endsWith(keys), `"${title}" shows ${keys}: ${JSON.stringify(row)}`);
    await page.keyboard.press('Escape');
  }
  for (const [title, due] of [['New tab', 'v1.0']]) { // `New type` is built in 3D (types.md R3 changes)
    const route = await mainName(page);
    await page.keyboard.press('Meta+k');
    await query(page).fill(title);
    await sleep(60);
    const row = (await paletteOptions(page)).find((r) => r.split('\n')[0].trim() === title) ?? '';
    assert.match(row, new RegExp(`Coming in ${due.replace(/[.()]/g, '\\$&')}`), `"${title}" shows Coming in ${due}`);
    await page.keyboard.press('Enter');
    await page.keyboard.press('Escape');
    assert.equal(await mainName(page), route, `"${title}" does not run`);
  }
  assert.deepEqual(await nonReadCalls(core), []);
});

const CONTROL_SELECTOR = 'button, a[href], [role="button"], [role="link"], [role="tab"], [role="menuitem"], [role="checkbox"], [role="radio"], [role="switch"], input[type="checkbox"], input[type="radio"]';

async function controlsWithoutCommand(page: Page): Promise<string[]> {
  return page.evaluate((sel) => {
    const out: string[] = [];
    for (const e of document.querySelectorAll(sel)) {
      const el = e as HTMLElement;
      if (el.getClientRects().length === 0) continue;
      if (el.closest('main') && el.closest('[role="row"], [role="listitem"], li') && el.closest('[role="row"], [role="listitem"], li')!.querySelector('[data-user-content]')) continue; // object list rows
      const cmd = el.getAttribute('data-command');
      if (!cmd || !cmd.trim()) out.push(`${el.tagName.toLowerCase()} "${(el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 40)}"`);
    }
    return out;
  }, CONTROL_SELECTOR);
}

for (const row of R1) {
  test(`fr_ux_03_ac8_every_control_carries_a_command: ${row.id}`, async ({ page }) => {
    await startFor(page, row);
    const failures: string[] = [];
    const name = await goRoute(page, row);
    assert.ok(await reached(page, name, 2000), `${row.id}: not reached`);
    for (const p of await controlsWithoutCommand(page)) failures.push(`${row.id}: ${p}`);
    if (row.id === 'note/<path>') {
      await page.keyboard.press('Meta+Backslash');
      if (!(await seen(panel(page), 1000))) failures.push('note: panel did not open');
      for (const p of await controlsWithoutCommand(page)) failures.push(`${row.id} (panel open): ${p}`);
      await page.keyboard.press('Meta+Backslash');
    }
    assert.deepEqual(failures, []);
  });
}

const ac9Reset = async (page: Page) => { for (let i = 0; i < 3; i++) await page.keyboard.press('Escape'); };

for (const row of R1.filter((r) => r.id !== 'chooser')) {
  test(`fr_ux_03_ac9_global_shortcuts_from_every_route: ${row.id}`, async ({ page }) => {
    const core = await startFor(page, row);
    const failures: string[] = [];
    const reset = () => ac9Reset(page);
    for (const r4 of R4.filter((x) => x.enabled)) {
      if (['Toggle right panel', 'Toggle focus mode'].includes(r4.command) && row.id !== 'note/<path>') continue; // object routes only (FR-UX-02 AC-7, AC-9)
      if (r4.command.startsWith('Open recent vault')) continue; // switches the vault: from every route in vault_switcher.ac.test.ts (FR-VLT-01 AC-17)
      // 6A (trash-media.md R75): ⌘⌫ moves the note to the trash (a write, FR-HIS-01 AC-1, trash.ac.test.ts) and ⇧⌘A opens
      // the file picker in an editor (FR-ATT-01 AC-3, media_add.ac.test.ts).
      if (r4.command === 'Move to trash' || r4.command === 'Add image or PDF…') continue;
      await reset();
      const name = await goRoute(page, row);
      if (!(await reached(page, name, 2000))) { failures.push(`${row.id}: not reached (before ${r4.keys}; main ${await mainName(page)}, title ${JSON.stringify(await titleState(page))})`); break; }
      await page.getByRole('main').getByRole('heading', { level: 1 }).first().focus().catch(() => {});
      const before = { sidebar: await seen(sidebar(page), 200), panel: await seen(panel(page), 200) };
      await page.keyboard.press(r4.press);
      const e = await checkEffect(page, r4.command, { main: name, ...before });
      if (e) failures.push(`${row.id} ${r4.keys}: ${e}`);
      if (r4.command === 'Toggle sidebar' && (await seen(sidebar(page), 200)) !== before.sidebar) await page.keyboard.press(r4.press);
      if (r4.command === 'Toggle right panel' && (await seen(panel(page), 200))) await page.keyboard.press(r4.press);
    }
    if ((await nonReadCalls(core)).length) failures.push(`non-read commands: ${(await nonReadCalls(core)).join(', ')}`);
    assert.deepEqual(failures, []);
  });
}

test('fr_ux_03_ac9_global_shortcuts_from_every_route: dialogs and unbound keys', async ({ page }) => {
  const core = await start(page);
  const failures: string[] = [];
  const reset = () => ac9Reset(page);
  // While a dialog is open only its keys act.
  await reset();
  await runCommand(page, 'Go to Inbox');
  for (const open of ['Meta+k']) { // D-520: ⌘N opens no dialog any more (an unsaved draft); D-760: no ⌘O switcher
    await page.keyboard.press(open);
    await page.keyboard.press('Meta+d');
    if ((await mainName(page)) !== 'Inbox') failures.push(`${open} dialog open: ⌘D navigated`);
    await page.keyboard.press('Control+Meta+s');
    if (!(await seen(sidebar(page), 300))) failures.push(`${open} dialog open: ⌃⌘S toggled the sidebar`);
    await reset();
  }
  // ⌘T does nothing and writes nothing (⌘[ / ⌘] are built in 3B.1, D-165: app/webkit/history.ac.test.ts).
  for (const k of ['Meta+t']) {
    await page.keyboard.press(k);
    if ((await mainName(page)) !== 'Inbox') failures.push(`${k} changed the route`);
  }
  if ((await nonReadCalls(core)).length) failures.push(`non-read commands: ${(await nonReadCalls(core)).join(', ')}`);
  assert.deepEqual(failures, []);
});

test('fr_ux_03_ac10_keyboard_only_tour_with_visible_focus', async ({ page }) => {
  test.setTimeout(240_000);
  await start(page);
  await page.evaluate(() => {
    const w = window as any;
    w.__focusLog = new Map<Element, { on?: string; off?: string; label: string }>();
    const sig = (e: Element) => { const s = getComputedStyle(e); return JSON.stringify([s.outlineStyle, s.outlineWidth, s.outlineColor, s.boxShadow, s.backgroundColor]); };
    document.addEventListener('focusin', (ev) => { const t = ev.target as Element; const r = w.__focusLog.get(t) ?? { label: (t.getAttribute('aria-label') ?? t.textContent ?? t.tagName).trim().slice(0, 40) }; r.on = sig(t); w.__focusLog.set(t, r); }, true);
    document.addEventListener('focusout', (ev) => { const t = ev.target as Element; setTimeout(() => { const r = w.__focusLog.get(t); if (r && document.activeElement !== t) r.off = sig(t); }, 0); }, true);
    w.__pointer = 0;
    for (const k of ['pointerdown', 'mousedown', 'click']) document.addEventListener(k, (e) => { if ((e as MouseEvent).detail > 0) w.__pointer++; }, true);
  });
  const label = () => page.evaluate(() => (document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.textContent ?? '').trim());
  const tabTo = async (re: RegExp, what: string) => {
    for (const key of ['Tab', 'Shift+Tab']) {
      for (let i = 0; i < 80; i++) {
        if (re.test(await label())) return;
        await page.keyboard.press(key);
      }
    }
    assert.fail(`keyboard tour: could not reach ${what} with Tab / ⇧Tab`);
  };
  for (const e of ['Inbox', 'Today', 'Tasks', 'Tags', 'Pinned', 'Saved queries', 'Trash']) { // 6A: no Home (D-613), Trash added (R75)
    await tabTo(new RegExp(`^${e}\\b`), `sidebar ${e}`);
    await page.keyboard.press('Enter');
    await mustBeOn(page, e === 'Today' ? new Date().toLocaleDateString('sv') : e, `keyboard: sidebar ${e}`); // 4B: named by its date
  }
  for (const t of TYPE_PLURALS.filter((p) => p !== 'Tasks')) { // D-516: Task is not in the Types list
    await tabTo(new RegExp(`^${t}\\b`), `Types entry ${t}`);
    await page.keyboard.press('Enter');
    await mustBeOn(page, t, `keyboard: Types ${t}`);
  }
  await page.keyboard.press('Meta+Shift+f'); // D-760: the Search page's Go to list replaces the ⌘O switcher
  await must(searchQueryField(page), 'Search query');
  await page.keyboard.insertText('Porada');
  await settled(page, 'Go to', 'Porada');
  await page.keyboard.press('Enter');
  await mustBeOn(page, '2026-10-07 Porada', 'keyboard: Go to');
  await page.keyboard.press('Control+Meta+s');
  assert.ok(await absent(sidebar(page)), 'keyboard: sidebar hidden');
  await page.keyboard.press('Control+Meta+s');
  await page.keyboard.press('Meta+Backslash');
  assert.ok(await seen(panel(page)), 'keyboard: panel open');
  await page.keyboard.press('Meta+Backslash');
  await page.keyboard.press('Meta+Shift+Backslash');
  assert.ok(await absent(sidebar(page)), 'keyboard: focus mode');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Meta+Comma');
  await mustBeOn(page, 'Settings: Appearance', 'keyboard: settings');
  for (const [name, want] of [['Light', 'light'], ['Dark', 'dark'], ['System', null]] as const) {
    await tabTo(new RegExp(`^${name}$`), `theme radio ${name}`);
    await page.keyboard.press('Space');
    if (want) assert.equal(await eventually(() => theme(page), (v) => v === want, 500), want, `keyboard: theme ${name}`);
  }
  await page.keyboard.press('Meta+n');
  await mustBeDraft(page, 'keyboard: New object');
  await page.keyboard.insertText('Klávesnicový nápad');
  await page.keyboard.press('Enter');
  await mustBeOn(page, 'Klávesnicový nápad', 'keyboard: New object');
  assert.equal(await page.evaluate(() => (window as any).__pointer), 0, 'no pointer events');
  const bad = await page.evaluate(() => {
    const out: string[] = [];
    const w = window as any;
    for (const [el, r] of w.__focusLog as Map<Element, { on?: string; off?: string; label: string }>) {
      if (!r.on || !r.off) continue;
      // D-266: the note body, title, description and property fields show their caret instead of a ring.
      if (el.matches('.ProseMirror, .title-field, .note-subtitle-field, .pfield')) continue;
      // D-594: every text field shows only its caret, and the page heading focused after a route change (AC-11) no ring.
      if (el.matches('h1')) continue;
      if (el.matches("textarea, [contenteditable='true'], input:not([type='checkbox']):not([type='radio']):not([type='range']):not([type='button'])")) continue;
      const [style, width, , shadow, bg] = JSON.parse(r.on) as string[];
      const outline = style !== 'none' && parseFloat(width) >= 2;
      const ring = shadow !== 'none' && (shadow.match(/(-?\d+(?:\.\d+)?)px/g) ?? []).map(parseFloat).some((v, i) => i >= 2 && v >= 2);
      // D-594: rows, cards and menu items show a background instead of a ring.
      const row = ['row', 'article', 'menuitem', 'menuitemradio', 'menuitemcheckbox', 'option', 'listitem', 'gridcell'].includes(el.getAttribute('role') ?? (el.tagName === 'TR' ? 'row' : el.tagName === 'ARTICLE' ? 'article' : ''));
      const fill = row && bg !== (JSON.parse(r.off) as string[])[4];
      if (r.on === r.off || !(outline || ring || fill)) out.push(r.label);
    }
    return out;
  });
  assert.deepEqual(bad, [], 'focused elements without a visible ≥ 2 px focus indicator');
});

test('fr_ux_03_ac11_focus_moves_to_the_page_heading_after_navigation', async ({ page }) => {
  await start(page);
  const check = async (how: string, name: string) => {
    await mustBeOn(page, name, how);
    const f = await eventually(() => focused(page), (x) => x.heading && x.inMain, 1000);
    assert.ok(f.heading && f.inMain, `${how}: focus on the heading in the centre pane, got ${JSON.stringify(f)}`);
    assert.equal(f.label.replace(/\s+/g, ' ').trim().startsWith(name) || f.label === name, true, `${how}: heading text`);
    await page.keyboard.press('Tab');
    assert.ok((await focused(page)).inMain, `${how}: next Tab starts in the page`);
  };
  await sidebar(page).getByRole('link', { name: 'Inbox', exact: true }) /* 5B: the entry may show its count */.click();
  await check('sidebar', 'Inbox');
  await runCommand(page, 'Go to Tasks');
  await check('palette', 'Tasks');
  await page.keyboard.press('Meta+d');
  // 4B: the daily route is named by its date and, like a note, puts the caret in its body (D-322, D-247).
  await mustBeOn(page, new Date().toLocaleDateString('sv'), 'shortcut ⌘D');
  assert.ok((await eventually(() => focused(page), (x) => x.inMain, 1000)).inMain, 'shortcut ⌘D: focus in the centre pane');
});
