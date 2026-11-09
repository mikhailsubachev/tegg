// Preview v0.120 feedback (D-1431, D-1432; board `NewObjectPicker` A–E), L5 (WebKit + fake core): ⌘N asks for a type,
// docs/acceptance/capture.md FR-VLT-05 AC-8 (three ways into one picker: ⌘N, the sidebar's `New object`, the palette's
// `New object…`; its place), AC-9 (the default type preselected and marked `Default`), AC-10 (⏎ or a click creates:
// the unsaved draft of D-520, or the Tasks quick-add, or today's Daily Note), AC-11 (typing filters by the start of any
// word, case, accents and NFD aside), AC-12 (↑/↓ wrap, Tab kept inside, Esc and a click outside close and give the focus
// back), AC-13 (`New <Name>` paths don't ask), AC-14 (the palette command on every route, the pseudo-locale, axe in
// light and dark; the registry and catalog are checked at L1 in app/test/new_object_picker_registry.ac.test.ts).
// AC-15 is manual. AC-11's matcher has no public interface yet (no contract names it), so it is covered here at L5.
// The inbox fixture (types Page, Task, Quick Note, Nápad, Schůzka; default Quick Note; clock 2026-10-14). Accessible
// names from the ACs (no contract section for the picker). Written from the ACs only (D-61). Every lookup goes through
// `must` (TS-I1), so a missing picker fails on an assertion.
import { test, type Locator, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import {
  I, absent, eventually, gotoInbox, inboxVault, main, mainName, must, mustBeOn, runCommand, seen, sidebar, sleep, startMain, swap,
  vaultWrites, type FakeCoreHandle,
} from './capture-helpers';
import { gotoType, mustBeDraft, paletteDialog, paletteOptions, pseudoLocale, searchQueryField } from './helpers';
import { editorBody } from './editor-helpers';

test.use({ timezoneId: 'Europe/Prague' });

const AXE = createRequire(import.meta.url).resolve('axe-core/axe.min.js');
const ALL = ['Page', 'Task', 'Quick Note', 'Nápad', 'Schůzka'];
const TODAY = '2026-10-14';
const ROZBITY = '.tegg/types/rozbitý.yml';
/** An invalid type file (unterminated quote), as the types fixture's `rozbitý.yml`: never listed (AC-8). */
const rozbity = '# Tegg type definition (FR-TYP-01, FR-STO-06, D-90). Edit it in Tegg\'s type settings.\nversion: 1\nname: Rozbitý\nplural: "Rozbité\nfolder: Rozbité\nicon: file-text\ncolor: red\nreview: false\npreview: []\nattributes: []\n';

function vault(defaultType?: string, edit?: (f: Record<string, string>) => void) {
  return inboxVault((f) => {
    if (defaultType) f['.tegg/vault.yml'] = swap(f['.tegg/vault.yml'], 'default-type: Quick Note', `default-type: ${defaultType}`);
    edit?.(f);
  });
}

// ------------------------------------------------------------------------------------------------ locators (AC-8)

const picker = (page: Page) => page.getByRole('dialog', { name: 'New object', exact: true });
const anyPicker = (page: Page) => page.getByRole('dialog', { name: /^⟦?New object⟧?$/ });
const field = (page: Page) => picker(page).getByRole('combobox', { name: 'Choose a type', exact: true });
const typesBox = (page: Page) => picker(page).getByRole('listbox', { name: 'Types', exact: true });
const option = (page: Page, name: string) => typesBox(page).getByRole('option', { name, exact: true });
const newObjectButton = (page: Page) => sidebar(page).getByRole('button', { name: /^New object/ });
const draftTab = (page: Page, name: string) => page.getByRole('tab', { name: new RegExp(`^${name}`) });
const quickAdd = (page: Page) => main(page).getByRole('textbox', { name: 'Add a task…', exact: true });

async function mustPicker(page: Page, how: string, ms = 3000): Promise<Locator> {
  return must(picker(page), `${how}: dialog "New object" (the type picker, D-1431)`, ms);
}

type PickerState = { options: string[]; selected: string[]; focusInField: boolean; activeIsSelected: boolean };
/** The listed options (accessible names, in order), the selected ones, whether `Choose a type` holds the focus and
 *  whether its `aria-activedescendant` names the selected option. */
async function pickerState(page: Page): Promise<PickerState> {
  const snap = await typesBox(page).ariaSnapshot({ timeout: 1000 }).catch(() => '');
  const options: string[] = [];
  const selected: string[] = [];
  for (const line of snap.split('\n')) {
    const m = /^\s*- option "((?:[^"\\]|\\.)*)"(.*)$/.exec(line);
    if (!m) continue;
    const name = m[1].replace(/\\"/g, '"').normalize('NFC');
    options.push(name);
    if (/\[selected\]/.test(m[2])) selected.push(name);
  }
  const dom = await field(page).evaluate((f) => {
    const id = f.getAttribute('aria-activedescendant');
    const target = id ? document.getElementById(id) : null;
    return {
      focusInField: document.activeElement === f,
      activeIsSelected: !!target && target.getAttribute('role') === 'option' && target.getAttribute('aria-selected') === 'true',
    };
  }, undefined, { timeout: 1000 }).catch(() => ({ focusInField: false, activeIsSelected: false }));
  return { options, selected, ...dom };
}
async function stateWhen(page: Page, ok: (s: PickerState) => boolean, ms = 2000) {
  return eventually(() => pickerState(page), ok, ms);
}
/** The accessible description of an option (`aria-description` or `aria-describedby`) and its visible text. */
async function optionInfo(loc: Locator) {
  return loc.evaluate((e) => {
    const ids = (e.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean);
    const desc = e.getAttribute('aria-description') ?? ids.map((id) => document.getElementById(id)?.textContent ?? '').join(' ');
    return { desc: desc.replace(/\s+/g, ' ').trim(), text: (e as HTMLElement).innerText.replace(/\s+/g, ' ').trim() };
  });
}
/** The picker's structure of AC-8: its field with the focus and placeholder, the five options in order. */
async function mustBeThePicker(page: Page, how: string, want = ALL) {
  const d = await mustPicker(page, how);
  const f = await must(field(page), `${how}: combobox "Choose a type"`, 1000);
  assert.equal(await f.getAttribute('placeholder'), 'Choose a type…', `${how}: placeholder "Choose a type…"`);
  await must(typesBox(page), `${how}: listbox "Types"`, 1000);
  const s = await stateWhen(page, (x) => x.focusInField && JSON.stringify(x.options) === JSON.stringify(want));
  assert.deepEqual(s.options, want, `${how}: the options in D-550 order (no Daily Note, Tag, Image, PDF or invalid type)`);
  assert.equal(s.focusInField, true, `${how}: "Choose a type" has the focus`);
  assert.equal(await picker(page).count(), 1, `${how}: one picker`);
  return d;
}
async function closePicker(page: Page, how: string) {
  await page.keyboard.press('Escape');
  assert.ok(await absent(anyPicker(page), 2000), `${how}: Esc closes the picker`);
}
/** Asserts the picker never shows during `ms` (AC-13). */
async function neverPicker(page: Page, how: string, ms = 800) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    assert.equal(await anyPicker(page).count(), 0, `${how}: no "New object" dialog`);
    await sleep(50);
  }
}
async function rect(loc: Locator, what: string) {
  const b = await (await must(loc, what, 1000)).boundingBox();
  assert.ok(b, `${what} has a box`);
  return b!;
}
/** ⌘N / the palette: centred in the window, its top in the upper quarter (the palette's place, AC-8). */
async function mustBeAtPalettePlace(page: Page, how: string) {
  const vp = page.viewportSize()!;
  const d = await rect(picker(page), `${how}: the picker`);
  assert.ok(Math.abs(d.x + d.width / 2 - vp.width / 2) <= 2, `${how}: horizontally centred (${d.x + d.width / 2} vs ${vp.width / 2})`);
  assert.ok(d.y >= 0 && d.y <= vp.height / 4, `${how}: its top (${d.y}) in the upper quarter (≤ ${vp.height / 4})`);
}
async function caretAt(page: Page) {
  return page.evaluate(() => {
    const body = document.querySelector('[aria-label="Note body"]');
    const s = getSelection();
    const a = document.activeElement;
    return {
      inBody: !!body && !!a && (a === body || body.contains(a)),
      node: s?.anchorNode?.textContent ?? null,
      offset: s?.anchorOffset ?? -1,
      collapsed: s?.isCollapsed ?? false,
    };
  });
}
async function nonVaultWrites(core: FakeCoreHandle, how: string) {
  assert.deepEqual(await vaultWrites(core), [], `${how}: nothing written`);
}

// ------------------------------------------------------------------------------------------------ AC-8

test('fr_vlt_05_ac8_three_ways_into_one_picker', async ({ page }) => {
  test.setTimeout(120_000);
  const core = await startMain(page, { vault: vault(undefined, (f) => { f[ROZBITY] = rozbity; }) });
  const opens: [string, () => Promise<void>, () => Promise<void>][] = [
    ['⌘N on inbox', () => gotoInbox(page), async () => { await page.keyboard.press('Meta+n'); }],
    ['⌘N on a note, caret in the body', async () => {
      await runCommand(page, 'Go to Inbox');
      await page.keyboard.press('Meta+Shift+f');
      await (await must(searchQueryField(page), 'Search query', 5000)).fill('Plán webu');
      await sleep(300);
      await page.keyboard.press('Enter');
      await mustBeOn(page, 'Plán webu', 'open Plán webu');
      await (await must(editorBody(page), 'Note body', 5000)).click();
      await page.keyboard.press('End');
    }, async () => { await page.keyboard.press('Meta+n'); }],
    ['⌘N on type/schůzka', () => gotoType(page, 'Schůzky'), async () => { await page.keyboard.press('Meta+n'); }],
    ['⌘N on search', async () => { await runCommand(page, 'Go to Search'); await must(searchQueryField(page), 'Search query', 5000); }, async () => { await page.keyboard.press('Meta+n'); }],
    ['a click on New object', () => gotoInbox(page), async () => { await (await must(newObjectButton(page), 'sidebar button "New object"')).click(); }],
    ['⏎ on New object', () => gotoInbox(page), async () => { await (await must(newObjectButton(page), 'sidebar button "New object"')).focus(); await page.keyboard.press('Enter'); }],
    ['the palette\'s New object…', () => gotoInbox(page), () => runCommand(page, 'New object…')],
  ];
  for (const [how, setup, open] of opens) {
    await setup();
    await sleep(200);
    const route = await mainName(page);
    const writes0 = await vaultWrites(core);
    await open();
    await mustBeThePicker(page, how);
    if (how.includes('New object') && !how.includes('palette')) {
      const b = await rect(newObjectButton(page), 'sidebar button "New object"');
      const d = await rect(picker(page), `${how}: the picker`);
      assert.ok(d.y - (b.y + b.height) >= 0 && d.y - (b.y + b.height) <= 8, `${how}: its top (${d.y}) within 8 px below the button's bottom (${b.y + b.height})`);
      assert.ok(Math.abs(d.x - b.x) <= 8, `${how}: its left (${d.x}) within 8 px of the button's left (${b.x})`);
    } else await mustBeAtPalettePlace(page, how);
    await sleep(300);
    assert.equal(await mainName(page), route, `${how}: the route doesn't change`);
    assert.deepEqual(await vaultWrites(core), writes0, `${how}: opening writes nothing`);
    await closePicker(page, how);
  }
  await nonVaultWrites(core, 'all openings');
});

// ------------------------------------------------------------------------------------------------ AC-9

test('fr_vlt_05_ac9_default_type_preselected', async ({ browser }) => {
  test.setTimeout(120_000);
  const cases: [string, string | undefined, string, string[]][] = [
    ['the fixture', undefined, 'Quick Note', ALL],
    ['default-type: nápad', 'nápad', 'Nápad', ALL],
    ['default-type: task', 'task', 'Task', ALL],
    ['default-type: Neexistuje', 'Neexistuje', 'Quick Note', ALL],
    ['default-type: Daily Note', 'Daily Note', 'Daily Note', ['Daily Note', ...ALL]],
  ];
  for (const [how, value, want, list] of cases) {
    const ctx = await browser.newContext({ timezoneId: 'Europe/Prague' });
    const page = await ctx.newPage();
    const core = await startMain(page, { vault: vault(value) });
    await gotoInbox(page);
    await page.keyboard.press('Meta+n');
    await mustBeThePicker(page, how, list);
    const s = await stateWhen(page, (x) => x.selected.length === 1 && x.selected[0] === want);
    assert.deepEqual(s.selected, [want], `${how}: only ${want} is selected`);
    assert.equal(await typesBox(page).locator('[role="option"][aria-selected="true"]').count(), 1, `${how}: one option with aria-selected="true"`);
    const info = await optionInfo(await must(option(page, want), `${how}: option ${want}`));
    assert.ok(info.text.includes('Default'), `${how}: ${want} shows "Default" (${JSON.stringify(info.text)})`);
    assert.equal(info.desc, 'Default', `${how}: ${want}'s accessible description is "Default"`);
    for (const other of list.filter((n) => n !== want)) {
      const o = await optionInfo(await must(option(page, other), `${how}: option ${other}`));
      assert.ok(!o.text.includes('Default') && o.desc !== 'Default', `${how}: ${other} isn't marked Default`);
    }
    if (want === 'Daily Note') {
      await page.keyboard.press('Enter');
      await mustBeOn(page, TODAY, `${how}: ⏎ opens today's Daily Note (FR-DLY-01 AC-5)`);
      assert.ok(await absent(anyPicker(page), 1000), `${how}: the picker closes`);
    }
    await nonVaultWrites(core, how);
    await ctx.close();
  }
});

// ------------------------------------------------------------------------------------------------ AC-10

test('fr_vlt_05_ac10_enter_or_click_creates', async ({ page, browser }) => {
  test.setTimeout(120_000);
  const core = await startMain(page);
  const creates: [string, () => Promise<void>, string][] = [
    ['⏎', async () => { await page.keyboard.press('Enter'); }, 'New Quick Note'],
    ['↓ to Nápad, ⏎', async () => {
      await page.keyboard.press('ArrowDown');
      const s = await stateWhen(page, (x) => x.selected[0] === 'Nápad', 1000);
      assert.deepEqual(s.selected, ['Nápad'], '↓ from Quick Note selects Nápad');
      await page.keyboard.press('Enter');
    }, 'New Nápad'],
    ['a click on Schůzka', async () => { await (await must(option(page, 'Schůzka'), 'option Schůzka')).click(); }, 'New Schůzka'],
  ];
  for (const [how, act, tab] of creates) {
    await gotoInbox(page);
    await page.keyboard.press('Meta+n');
    await mustPicker(page, how);
    await act();
    assert.ok(await absent(anyPicker(page), 2000), `${how}: the picker closes`);
    await mustBeDraft(page, how);
    assert.ok(await seen(draftTab(page, tab), 2000), `${how}: the tab ${tab} (new/<type>)`);
    await sleep(300);
    await nonVaultWrites(core, `${how}: the draft`);
    await page.keyboard.press('Meta+BracketLeft');
    await mustBeOn(page, 'Inbox', `${how}: Back returns to the route the picker was opened on (one history entry)`);
  }
  // The draft writes on its first write only (D-522): the title and ⏎.
  await page.keyboard.press('Meta+n');
  await mustPicker(page, 'first write');
  await page.keyboard.press('Enter');
  await mustBeDraft(page, 'first write');
  await page.keyboard.insertText('Nápad z výběru');
  await sleep(300);
  await nonVaultWrites(core, 'typing the title');
  await page.keyboard.press('Enter');
  const w = await eventually(() => core.writesTo(), (x) => x.length > 0, 3000);
  assert.deepEqual(w, ['Quick Notes/Nápad z výběru.md'], 'the first write creates the Quick Note');
  // default-type: task → tasks.md FR-TSK-04 AC-17.
  const ctx = await browser.newContext({ timezoneId: 'Europe/Prague' });
  const p2 = await ctx.newPage();
  const c2 = await startMain(p2, { vault: vault('task') });
  await gotoInbox(p2);
  await p2.keyboard.press('Meta+n');
  await mustPicker(p2, 'default Task');
  await p2.keyboard.press('Enter');
  assert.ok(await absent(anyPicker(p2), 2000), 'default Task: the picker closes');
  const q = await must(quickAdd(p2), 'default Task: textbox "Add a task…" on tasks', 5000);
  assert.equal(await eventually(() => q.evaluate((e) => document.activeElement === e), (x) => x, 2000), true, 'default Task: the caret is in "Add a task…"');
  await nonVaultWrites(c2, 'default Task');
  await p2.keyboard.press('Meta+BracketLeft');
  await mustBeOn(p2, 'Inbox', 'default Task: Back returns to Inbox');
  await ctx.close();
});

// ------------------------------------------------------------------------------------------------ AC-11

test('fr_vlt_05_ac11_typing_filters_types', async ({ page }) => {
  test.setTimeout(90_000);
  const core = await startMain(page);
  await gotoInbox(page);
  await page.keyboard.press('Meta+n');
  await mustBeThePicker(page, '⌘N');
  const f = field(page);
  const failures: string[] = [];
  const cases: [string, string[]][] = [
    ['sch', ['Schůzka']], ['SCHU', ['Schůzka']], ['schů', ['Schůzka']], ['schů'.normalize('NFD'), ['Schůzka']],
    ['napad', ['Nápad']], ['note', ['Quick Note']], ['n', ['Quick Note', 'Nápad']], ['p', ['Page']], ['uick', []],
  ];
  for (const [q, want] of cases) {
    const label = JSON.stringify(q) + (q !== q.normalize('NFC') ? ' (NFD)' : '');
    await f.fill('');
    // Keystroke by keystroke: after each one, the first remaining option is the selected one.
    for (const ch of [...q]) {
      await page.keyboard.insertText(ch);
      await sleep(60);
      const s = await pickerState(page);
      if (s.options.length > 0 && JSON.stringify(s.selected) !== JSON.stringify([s.options[0]])) failures.push(`${label} after "${ch}": selected ${JSON.stringify(s.selected)}, first ${s.options[0]}`);
    }
    const s = await stateWhen(page, (x) => JSON.stringify(x.options) === JSON.stringify(want));
    if (JSON.stringify(s.options) !== JSON.stringify(want)) { failures.push(`${label}: ${JSON.stringify(s.options)}, want ${JSON.stringify(want)}`); continue; }
    if (want.length && JSON.stringify(s.selected) !== JSON.stringify([want[0]])) failures.push(`${label}: selected ${JSON.stringify(s.selected)}, want ${want[0]}`);
    if (want.includes('Quick Note')) {
      const info = await optionInfo(option(page, 'Quick Note'));
      if (!info.text.includes('Default')) failures.push(`${label}: Quick Note lost "Default"`);
    }
  }
  assert.deepEqual(failures, [], 'filtering by the start of any word, case, accents and NFD aside');
  // No match: an empty list and the message; ⏎ does nothing.
  await f.fill('');
  await page.keyboard.insertText('uick');
  const none = await stateWhen(page, (x) => x.options.length === 0);
  assert.deepEqual(none.options, [], '"uick": the listbox has no options');
  assert.equal(await typesBox(page).getByRole('option').count(), 0, '"uick": no option elements');
  await must(picker(page).getByText('No type matches “uick”.', { exact: true }), 'the message No type matches “uick”.', 1000);
  const route = await mainName(page);
  await page.keyboard.press('Enter');
  await sleep(500);
  assert.equal(await picker(page).count(), 1, '"uick": ⏎ leaves the picker open');
  assert.equal(await mainName(page), route, '"uick": ⏎ doesn\'t change the route');
  await nonVaultWrites(core, '"uick": ⏎');
  // Clearing lists all five again with the default selected.
  await f.fill('');
  await page.keyboard.press('Backspace');
  const all = await stateWhen(page, (x) => x.options.length === 5 && x.selected[0] === 'Quick Note');
  assert.deepEqual({ options: all.options, selected: all.selected }, { options: ALL, selected: ['Quick Note'] }, 'cleared: all five, Quick Note selected');
});

// ------------------------------------------------------------------------------------------------ AC-12

test('fr_vlt_05_ac12_keyboard_and_closing', async ({ page }) => {
  test.setTimeout(120_000);
  const core = await startMain(page);
  await gotoInbox(page);
  const btn = await must(newObjectButton(page), 'sidebar button "New object"');
  await btn.focus();
  await page.keyboard.press('Enter');
  await mustBeThePicker(page, '⏎ on New object');
  // ↓ / ↑ move and wrap; the focus stays in the field and aria-activedescendant follows.
  const steps: [string, string][] = [['ArrowDown', 'Nápad'], ['ArrowDown', 'Schůzka'], ['ArrowDown', 'Page'], ['ArrowUp', 'Schůzka'], ['ArrowUp', 'Nápad'], ['ArrowUp', 'Quick Note'], ['ArrowUp', 'Task'], ['ArrowUp', 'Page'], ['ArrowUp', 'Schůzka']];
  for (const [key, want] of steps) {
    await page.keyboard.press(key);
    const s = await stateWhen(page, (x) => x.selected.length === 1 && x.selected[0] === want, 1000);
    assert.deepEqual({ selected: s.selected, focusInField: s.focusInField, activeIsSelected: s.activeIsSelected }, { selected: [want], focusInField: true, activeIsSelected: true }, `${key} → ${want}, focus in the field, aria-activedescendant on it`);
  }
  // Tab and ⇧Tab keep the focus inside the dialog.
  for (const key of ['Tab', 'Tab', 'Tab', 'Shift+Tab', 'Shift+Tab', 'Shift+Tab', 'Shift+Tab']) {
    await page.keyboard.press(key);
    const inside = await picker(page).evaluate((d) => !!document.activeElement && d.contains(document.activeElement));
    assert.equal(inside, true, `${key}: the focus stays inside the picker`);
  }
  // ⌘N while it is open: still exactly one picker.
  await page.keyboard.press('Meta+n');
  await sleep(300);
  assert.equal(await anyPicker(page).count(), 1, '⌘N while open leaves exactly one picker');
  // Esc: closed, nothing written, the route unchanged, the focus back on the button.
  await page.keyboard.press('Escape');
  assert.ok(await absent(anyPicker(page), 2000), 'Esc closes the picker');
  await mustBeOn(page, 'Inbox', 'Esc: the route is unchanged', 1000);
  assert.equal(await eventually(() => btn.evaluate((e) => document.activeElement === e), (x) => x, 1000), true, 'Esc: the focus returns to New object');
  // A click outside: the same.
  await btn.click();
  await mustPicker(page, 'a click on New object');
  const d = await rect(picker(page), 'the picker');
  const vp = page.viewportSize()!;
  await page.mouse.click(Math.min(vp.width - 10, d.x + d.width + 200), vp.height - 10);
  assert.ok(await absent(anyPicker(page), 2000), 'a click outside closes the picker');
  await mustBeOn(page, 'Inbox', 'a click outside: the route is unchanged', 1000);
  assert.equal(await eventually(() => btn.evaluate((e) => document.activeElement === e), (x) => x, 1000), true, 'a click outside: the focus returns to New object');
  // From a note body with the caret inside a word: Esc and a click outside give the caret back where it was.
  await runCommand(page, 'Go to Search');
  await (await must(searchQueryField(page), 'Search query', 5000)).fill('Plán webu');
  await sleep(300);
  await page.keyboard.press('Enter');
  await mustBeOn(page, 'Plán webu', 'open Plán webu');
  const body = await must(editorBody(page), 'Note body', 5000);
  await body.getByText('Rychlý web.', { exact: true }).click();
  await page.keyboard.press('End');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  const caret = await caretAt(page);
  assert.equal(caret.inBody, true, 'setup: the caret is in the body');
  for (const how of ['Esc', 'a click outside'] as const) {
    await page.keyboard.press('Meta+n');
    await mustPicker(page, `${how} from the body`);
    if (how === 'Esc') await page.keyboard.press('Escape');
    else {
      const r = await rect(picker(page), 'the picker');
      await page.mouse.click(Math.min(vp.width - 10, r.x + r.width + 200), vp.height - 10);
    }
    assert.ok(await absent(anyPicker(page), 2000), `${how}: closes the picker`);
    await mustBeOn(page, 'Plán webu', `${how}: the route is unchanged`, 1000);
    const back = await eventually(() => caretAt(page), (c) => c.inBody, 1000);
    assert.deepEqual(back, caret, `${how}: the note body has the focus with the caret at the same position`);
  }
  await nonVaultWrites(core, 'opening and closing');
});

// ------------------------------------------------------------------------------------------------ AC-13

test('fr_vlt_05_ac13_known_type_paths_skip_the_picker', async ({ page }) => {
  test.setTimeout(90_000);
  const core = await startMain(page);
  await gotoInbox(page);
  // The picker exists on this vault (⌘N), so its absence below is the AC's rule, not a missing feature.
  await page.keyboard.press('Meta+n');
  await mustPicker(page, '⌘N (precondition)');
  await closePicker(page, '⌘N (precondition)');
  await gotoType(page, 'Schůzky');
  await (await must(main(page).getByRole('button', { name: 'New Schůzka', exact: true }), 'New Schůzka on type/schůzka', 5000)).click();
  await neverPicker(page, 'type page New Schůzka');
  await mustBeDraft(page, 'type page New Schůzka');
  assert.ok(await seen(draftTab(page, 'New Schůzka'), 2000), 'type page New Schůzka: new/schůzka');
  await gotoType(page, 'Schůzky');
  await runCommand(page, 'New Schůzka');
  await neverPicker(page, 'palette New Schůzka');
  await mustBeDraft(page, 'palette New Schůzka');
  assert.ok(await seen(draftTab(page, 'New Schůzka'), 2000), 'palette New Schůzka: new/schůzka');
  await gotoInbox(page);
  await runCommand(page, 'New Task');
  await neverPicker(page, 'palette New Task');
  const q = await must(quickAdd(page), 'palette New Task: textbox "Add a task…"', 5000);
  assert.equal(await eventually(() => q.evaluate((e) => document.activeElement === e), (x) => x, 2000), true, 'palette New Task: the caret is in "Add a task…"');
  await gotoType(page, 'Daily Notes');
  await runCommand(page, 'New Daily Note');
  await neverPicker(page, 'palette New Daily Note');
  await mustBeOn(page, TODAY, 'palette New Daily Note: today\'s Daily Note');
  await nonVaultWrites(core, 'the known-type paths');
});

// ------------------------------------------------------------------------------------------------ AC-14

test('fr_vlt_05_ac14_command_strings_and_themes', async ({ browser }) => {
  test.setTimeout(150_000);
  // The palette lists `New object…` with ⌘N on every kind of route (FR-UX-03 AC-7: no other command owns ⌘N).
  {
    const ctx = await browser.newContext({ timezoneId: 'Europe/Prague' });
    const page = await ctx.newPage();
    await startMain(page, { at: I.P2 });
    const routes: [string, () => Promise<void>][] = [
      ['note', async () => { await mustBeOn(page, 'Plán webu', 'note Plán webu'); }],
      ['inbox', () => gotoInbox(page)],
      ['type/schůzka', () => gotoType(page, 'Schůzky')],
      ['search', () => runCommand(page, 'Go to Search')],
      ['tasks', async () => { await runCommand(page, 'Go to Tasks'); await sleep(300); }],
      ['daily', async () => { await page.keyboard.press('Meta+d'); await mustBeOn(page, TODAY, 'Today'); }],
    ];
    const failures: string[] = [];
    for (const [route, go] of routes) {
      await go();
      await page.keyboard.press('Meta+k');
      await must(paletteDialog(page), `${route}: palette`);
      await page.getByRole('combobox', { name: 'Command query' }).fill('New object');
      await sleep(150);
      const rows = (await paletteOptions(page)).map((r) => r.replace(/\s+/g, ' ').trim());
      const row = rows.find((r) => r.startsWith('New object…'));
      if (!row) failures.push(`${route}: no "New object…" (${rows.slice(0, 3).join(' | ')})`);
      else if (!row.replace(/\s+/g, '').endsWith('⌘N')) failures.push(`${route}: "New object…" without ⌘N (${row})`);
      const others = rows.filter((r) => !r.startsWith('New object…') && r.replace(/\s+/g, '').endsWith('⌘N'));
      if (others.length) failures.push(`${route}: other rows show ⌘N (${others.join(' | ')})`);
      await page.keyboard.press('Escape');
    }
    assert.deepEqual(failures, [], 'New object… ⌘N on every route');
    await ctx.close();
  }
  // Pseudo-locale (NFR-OTH-02): every picker string is wrapped; type names are user content.
  {
    const ctx = await browser.newContext({ timezoneId: 'Europe/Prague' });
    const page = await ctx.newPage();
    await startMain(page, { prelude: pseudoLocale });
    await sleep(500);
    await page.keyboard.press('Meta+n');
    const d = await must(page.getByRole('dialog', { name: '⟦New object⟧', exact: true }), 'pseudo-locale: dialog "⟦New object⟧"', 5000);
    const leaks = async () => d.evaluate((root) => {
      const out: string[] = [];
      const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let n = walk.nextNode(); n; n = walk.nextNode()) {
        const t = (n.textContent ?? '').trim();
        if (!t || /^[⟦⟧\s↑↓⏎↩⎋·]*$/.test(t) || t.includes('⟦')) continue;
        out.push(t);
      }
      for (const e of [root, ...root.querySelectorAll('*')]) {
        for (const a of ['aria-label', 'placeholder', 'title', 'aria-description']) {
          const v = e.getAttribute(a);
          if (v && !v.includes('⟦')) out.push(`${a}=${v}`);
        }
      }
      return out;
    });
    const allowed = new Set([...ALL, 'esc', 'Esc']);
    assert.deepEqual((await leaks()).filter((x) => !allowed.has(x.replace(/^aria-label=/, ''))), [], 'pseudo-locale: only type names outside ⟦ ⟧');
    for (const s of ['⟦Default⟧', '⟦Choose⟧', '⟦Create⟧', '⟦Cancel⟧']) assert.ok(await seen(d.getByText(s), 1000), `pseudo-locale: ${s} shown`);
    assert.equal(await d.getByRole('combobox').first().getAttribute('placeholder'), '⟦Choose a type…⟧', 'pseudo-locale: the placeholder');
    await d.getByRole('combobox').first().fill('uick');
    assert.ok(await seen(d.getByText('⟦No type matches “uick”.⟧'), 1500), 'pseudo-locale: the no-match message wrapped, the query filled in');
    assert.deepEqual((await leaks()).filter((x) => !allowed.has(x.replace(/^aria-label=/, ''))), [], 'pseudo-locale: no-match state, only the query outside ⟦ ⟧');
    await ctx.close();
  }
  // axe in light and dark on the open picker.
  for (const theme of ['light', 'dark'] as const) {
    const ctx = await browser.newContext({ timezoneId: 'Europe/Prague' });
    const page = await ctx.newPage();
    await startMain(page, { theme });
    assert.equal(await eventually(() => page.evaluate(() => document.documentElement.dataset.theme), (t) => t === theme), theme, `theme ${theme}`);
    await gotoInbox(page);
    await page.keyboard.press('Meta+n');
    const d = await mustPicker(page, `${theme}: ⌘N`);
    if (!(await page.evaluate(() => 'axe' in window))) await page.addScriptTag({ path: AXE });
    const violations = await d.evaluate(async (root) => {
      const r = await (window as any).axe.run(root);
      return r.violations.flatMap((x: any) => x.nodes.map((n: any) => `${x.id}: ${n.target.join(' ')}`));
    });
    assert.deepEqual(violations, [], `${theme}: axe reports no violation in the open picker`);
    await ctx.close();
  }
});
