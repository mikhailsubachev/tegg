// 5B preview feedback round 2, L5 (WebKit + fake core): FR-UX-03 AC-13 (D-594, AP-522; extends D-266): (a) a pointer
// click leaves no focus ring (computed `outline-style` none or `outline-width` 0, and no `box-shadow` ring) on a sidebar
// entry, the `Kanban` and `Status` tabs, a button, a task card, an Inbox card, a table row and a menu item; (b) reaching
// them with Tab or arrows shows an indicator: a ≥ 2 px outline in the `focus` token on buttons, tabs, links and chips,
// the `hover` background on rows, cards and menu items; (c) a focused text field (quick-add, tag filter, dialog inputs,
// property fields) has no outline ring, by click or by Tab; no computed `outline-color` equals the old blue focus values
// `#1D5CCB` / `#86AEFF`. Routes: Home, Inbox, Tasks (Schedule and Kanban), a type page, a note page and Settings.
// docs/acceptance/app-shell.md; fixture tests/fixtures/vaults/inbox (+ new-empty/.tegg). Interface: ms3-shell §3.5
// (tokens as `--<key>` on `:root`, `theme/tokens.ts`), §3.7 (names), §12.5 (logo menu), ms5-tasks §6, ms5-capture §6
// (Inbox), ms3-shell §14 (type table, Properties). A "box-shadow ring" is a focused box-shadow that differs from the
// element's box-shadow once it loses focus (decorative shadows are allowed). Written from the AC and the contracts only
// (D-61); every lookup goes through `must` (TS-I1).
import { test, type Locator, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import { CARD, I, cardNamed, gotoInbox, inboxEntry, main, must, runCommand, sidebar, sleep, startMain } from './capture-helpers';
import { openNote } from './helpers';
import { tokenColour } from './read-helpers';
import { card, dateFilter, groupBy, quickAdd, tagInput as taskTagInput, viewTab, heading as tasksHeading } from './tasks-helpers';

test.use({ timezoneId: 'Europe/Prague' });

const OLD_BLUE = ['rgb(29, 92, 203)', 'rgb(134, 174, 255)']; // #1D5CCB, #86AEFF
const logoButton = (page: Page) => sidebar(page).getByRole('button', { name: 'Tegg: About and Settings', exact: true });
const logoMenu = (page: Page) => page.getByRole('menu', { name: 'About and Settings' });
const props = (page: Page) => page.getByRole('region', { name: 'Properties', exact: true });
const typeTable = (page: Page, plural: string) => main(page).getByRole('table', { name: plural, exact: true });

type State = {
  what: string; tag: string; role: string; label: string; outlineStyle: string; outlineWidth: number; outlineColor: string;
  shadow: string; shadowBlurred: string; bg: string; textField: boolean;
} | null;

/** The computed focus look of `document.activeElement` (or of the active descendant of a focused menu/listbox). The
 *  element is blurred at the end to read its unfocused box-shadow. */
async function activeState(page: Page, what: string, within?: Locator, blur = true): Promise<State> {
  const scope = within ? await within.elementHandle().catch(() => null) : null;
  return page.evaluate(([w, sc, bl]) => {
    let a = document.activeElement as HTMLElement | null;
    if (!a || a === document.body || a === document.documentElement) return null;
    const ad = a.getAttribute('aria-activedescendant');
    if (ad && document.getElementById(ad)) a = document.getElementById(ad) as HTMLElement;
    if (sc && !(sc as Element).contains(a)) return null;
    const implicit: Record<string, string> = { A: 'link', BUTTON: 'button', TR: 'row', ARTICLE: 'article', INPUT: 'textbox', TEXTAREA: 'textbox', LI: 'listitem', H1: 'heading' };
    const role = a.getAttribute('role') ?? implicit[a.tagName] ?? a.tagName.toLowerCase();
    const textField = a instanceof HTMLTextAreaElement || (a instanceof HTMLInputElement && !['button', 'checkbox', 'radio', 'submit'].includes(a.type))
      || a.isContentEditable || role === 'textbox' || role === 'searchbox' || (role === 'combobox' && (a instanceof HTMLInputElement));
    const cs = getComputedStyle(a);
    const s = {
      what: w, tag: a.tagName.toLowerCase(), role, label: (a.getAttribute('aria-label') ?? a.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 60),
      outlineStyle: cs.outlineStyle, outlineWidth: parseFloat(cs.outlineWidth) || 0, outlineColor: cs.outlineColor, shadow: cs.boxShadow,
      shadowBlurred: '', bg: cs.backgroundColor, textField,
    };
    if (bl) {
      (document.activeElement as HTMLElement).blur();
      s.shadowBlurred = getComputedStyle(a).boxShadow;
    } else s.shadowBlurred = s.shadow; // not blurred: only the outline is judged
    return s;
  }, [what, scope, blur] as const);
}
const hasOutline = (s: NonNullable<State>) => s.outlineStyle !== 'none' && s.outlineWidth > 0;
const hasShadowRing = (s: NonNullable<State>) => s.shadow !== 'none' && s.shadow !== s.shadowBlurred;
const show = (s: State) => (s ? `${s.what}: <${s.tag} role=${s.role} "${s.label}"> outline ${s.outlineStyle} ${s.outlineWidth}px ${s.outlineColor}, shadow ${s.shadow} (unfocused ${s.shadowBlurred}), bg ${s.bg}` : 'nothing focused');

/** Presses the pointer on `loc` (focus happens on press), reads the focus look, releases, and reads it again if the
 *  focus is still inside the element. Returns the states read while the focus was in the element. */
async function pointer(page: Page, loc: Locator, what: string): Promise<NonNullable<State>[]> {
  const el = await must(loc, what);
  await el.scrollIntoViewIfNeeded();
  const b = await el.boundingBox();
  assert.ok(b, `${what} has a box`);
  const out: NonNullable<State>[] = [];
  await page.mouse.move(b!.x + Math.min(b!.width / 2, 40), b!.y + b!.height / 2);
  await page.mouse.down();
  await sleep(80);
  const s1 = await activeState(page, `${what} (pressed)`, el, false);
  if (s1) out.push(s1);
  await page.mouse.up();
  await sleep(150);
  if (await el.isVisible().catch(() => false)) {
    const s2 = await activeState(page, `${what} (clicked)`, el);
    if (s2) out.push(s2);
  }
  return out;
}

/** Puts the focus on `loc` by keyboard: the element before it, then Tab (⇧Tab then Tab from the element). */
async function keyboard(page: Page, loc: Locator, what: string): Promise<NonNullable<State>> {
  const el = await must(loc, what);
  await el.evaluate((e) => (e as HTMLElement).focus());
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Tab');
  await sleep(80);
  const s = await activeState(page, `${what} (Tab)`);
  assert.ok(s, `${what}: Tab puts the focus on an element`);
  return s!;
}

/** Elements with a drawn outline whose colour is one of the old blue focus values. */
async function oldBlueOutlines(page: Page): Promise<string[]> {
  return page.evaluate((blue) => {
    const out: string[] = [];
    for (const e of document.querySelectorAll('body *')) {
      const cs = getComputedStyle(e);
      if (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0 && blue.includes(cs.outlineColor)) out.push(`${e.tagName.toLowerCase()} ${cs.outlineColor}`);
    }
    return out;
  }, OLD_BLUE);
}

// ------------------------------------------------------------------------------------------------ (a) pointer

test('fr_ux_03_ac13_no_focus_ring_after_a_pointer_click', async ({ page }) => {
  await startMain(page);
  const states: NonNullable<State>[] = [];
  // Trash (6A: Home is removed, D-613) → a sidebar entry (Inbox).
  await runCommand(page, 'Go to Trash');
  await sleep(200);
  states.push(...await pointer(page, inboxEntry(page), 'sidebar entry Inbox'));
  // Inbox: a filter button and an Inbox card.
  await gotoInbox(page);
  states.push(...await pointer(page, main(page).getByRole('group', { name: 'Filter by type', exact: true }).getByRole('button').first(), 'Inbox filter button'));
  states.push(...await pointer(page, cardNamed(page, CARD.Q2), `Inbox card ${CARD.Q2}`));
  // Tasks: a button (Today), the tabs Kanban and Status, a task card.
  await runCommand(page, 'Go to Tasks');
  await must(tasksHeading(page), 'heading "Tasks"', 5000);
  states.push(...await pointer(page, dateFilter(page).getByRole('button', { name: 'Today', exact: true }), 'button Today'));
  states.push(...await pointer(page, dateFilter(page).getByRole('button', { name: 'All', exact: true }), 'button All'));
  states.push(...await pointer(page, viewTab(page, 'Kanban'), 'tab Kanban'));
  await must(groupBy(page), 'tablist "Group by"');
  states.push(...await pointer(page, groupBy(page).getByRole('tab', { name: 'Status', exact: true }), 'tab Status'));
  states.push(...await pointer(page, card(page, 'Zavolat instalatérovi'), 'task card Zavolat instalatérovi'));
  // A type page: a table row.
  await runCommand(page, 'Go to type: Quick Notes');
  states.push(...await pointer(page, (await must(typeTable(page, 'Quick Notes'), 'table "Quick Notes"', 5000)).getByRole('row').nth(1), 'type table row'));
  // A note page: a button.
  await openNote(page, 'Koupit mléko');
  states.push(...await pointer(page, page.getByRole('button', { name: 'Show Markdown source', exact: true }), 'button Show Markdown source'));
  // The logo button and a menu item (Settings…), then Settings: the Theme radio.
  states.push(...await pointer(page, logoButton(page), 'logo button'));
  if (!(await logoMenu(page).isVisible().catch(() => false))) await (await must(logoButton(page), 'logo button')).click();
  await must(logoMenu(page), 'menu "About and Settings"');
  states.push(...await pointer(page, logoMenu(page).getByRole('menuitem', { name: 'Settings…', exact: true }), 'menu item Settings…'));
  const theme = await must(main(page).getByRole('radiogroup', { name: 'Theme' }), 'radiogroup Theme (Settings)', 5000);
  states.push(...await pointer(page, theme.getByRole('radio', { name: 'Light', exact: true }), 'radio Light'));

  assert.ok(states.length >= 4, `the pointer focused some of the controls (${states.length} reads)`);
  const rings = states.filter((s) => hasOutline(s) || hasShadowRing(s)).map(show);
  assert.deepEqual(rings, [], 'no focus ring after a pointer click (D-594)');
});

// ------------------------------------------------------------------------------------------------ (b) keyboard

test('fr_ux_03_ac13_keyboard_focus_shows_the_neutral_indicator', async ({ page }) => {
  await startMain(page);
  const focus = await tokenColour(page, 'focus');
  const sel = await tokenColour(page, 'hover'); // D-594: the neutral hover background, not the blue sel
  assert.ok(focus, 'the focus token exists');
  assert.ok(sel, 'the hover token exists (D-594: the --hover background on rows, cards and menu items)');
  const states: NonNullable<State>[] = [];
  await runCommand(page, 'Go to Trash'); // 6A: Go to Home is removed (D-613)
  await sleep(200);
  states.push(await keyboard(page, inboxEntry(page), 'sidebar entry Inbox'));
  await gotoInbox(page);
  states.push(await keyboard(page, main(page).getByRole('group', { name: 'Filter by type', exact: true }).getByRole('button').first(), 'Inbox filter button'));
  states.push(await keyboard(page, cardNamed(page, CARD.Q2), `Inbox card ${CARD.Q2}`));
  await runCommand(page, 'Go to Tasks');
  await must(tasksHeading(page), 'heading "Tasks"', 5000);
  states.push(await keyboard(page, dateFilter(page).getByRole('button', { name: 'Today', exact: true }), 'button Today'));
  states.push(await keyboard(page, viewTab(page, 'Schedule'), 'tab Schedule'));
  await page.keyboard.press('ArrowRight'); // arrows between tabs
  await sleep(80);
  const arrowTab = await activeState(page, 'tab after ArrowRight');
  if (arrowTab) states.push(arrowTab);
  await (await must(viewTab(page, 'Kanban'), 'tab Kanban')).evaluate((e) => (e as HTMLElement).click());
  await must(groupBy(page), 'tablist "Group by"');
  states.push(await keyboard(page, card(page, 'Zavolat instalatérovi'), 'task card Zavolat instalatérovi'));
  await runCommand(page, 'Go to type: Quick Notes');
  const table = await must(typeTable(page, 'Quick Notes'), 'table "Quick Notes"', 5000);
  states.push(await keyboard(page, table.getByRole('row').nth(2), 'type table row'));
  await openNote(page, 'Koupit mléko');
  states.push(await keyboard(page, props(page).getByRole('link', { name: /nákup/ }), 'tag chip #nákup'));
  states.push(await keyboard(page, logoButton(page), 'logo button'));
  // The logo menu by keyboard: Enter opens it, ArrowDown moves between its items.
  await (await must(logoButton(page), 'logo button')).focus();
  await page.keyboard.press('Enter');
  await must(logoMenu(page), 'menu "About and Settings"');
  await page.keyboard.press('ArrowDown');
  await sleep(80);
  const item = await activeState(page, 'logo menu item (ArrowDown)');
  assert.ok(item, 'a menu item has the focus');
  states.push(item!);

  const outlineRoles = new Set(['button', 'link', 'tab', 'radio', 'switch', 'checkbox']);
  const selRoles = new Set(['row', 'article', 'menuitem', 'menuitemradio', 'menuitemcheckbox', 'option', 'listitem']);
  const bad: string[] = [];
  for (const s of states) {
    if (s.textField) continue;
    if (selRoles.has(s.role)) {
      if (s.bg !== sel) bad.push(`${show(s)}: background should be the hover token ${sel}`);
    } else if (outlineRoles.has(s.role)) {
      if (!(hasOutline(s) && s.outlineWidth >= 2 && s.outlineColor === focus)) bad.push(`${show(s)}: should be a ≥ 2 px outline in the focus token ${focus}`);
    } else bad.push(`${show(s)}: unexpected focus target`);
    if (OLD_BLUE.includes(s.outlineColor) && hasOutline(s)) bad.push(`${show(s)}: old blue outline`);
  }
  assert.deepEqual(bad, [], 'keyboard focus shows the neutral indicator (D-594)');
});

// ------------------------------------------------------------------------------------------------ (c) text fields

test('fr_ux_03_ac13_text_fields_show_no_outline_ring', async ({ page }) => {
  await startMain(page);
  const states: NonNullable<State>[] = [];
  const both = async (loc: Locator, what: string) => {
    const el = await must(loc, what);
    await el.click();
    await sleep(80);
    const s1 = await activeState(page, `${what} (click)`);
    assert.ok(s1 && s1.textField, `${what}: a click focuses the text field (${show(s1)})`);
    states.push(s1!);
    states.push(await keyboard(page, loc, what));
  };
  await runCommand(page, 'Go to Tasks');
  await must(tasksHeading(page), 'heading "Tasks"', 5000);
  await both(quickAdd(page), 'quick-add "Add a task…"');
  await both(taskTagInput(page), 'tag filter input');
  // Dialog inputs: the palette and the switcher.
  await page.keyboard.press('Meta+k');
  const q = await must(page.getByRole('combobox', { name: 'Command query' }), 'combobox "Command query"');
  await sleep(80);
  const pal = await activeState(page, 'palette input (⌘K)');
  assert.ok(pal && pal.textField, `the palette input has the focus (${show(pal)})`);
  states.push(pal!);
  await q.click();
  const pal2 = await activeState(page, 'palette input (click)');
  if (pal2) states.push(pal2);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Meta+Shift+f'); // D-760: the Search page's field replaces the ⌘O switcher input
  await sleep(150);
  const sw = await activeState(page, 'search input (⇧⌘F)');
  assert.ok(sw && sw.textField, `the search input has the focus (${show(sw)})`);
  states.push(sw!);
  await page.keyboard.press('Escape');
  // A property field on a note page.
  await openNote(page, I.Q1.split('/').pop()!.replace(/\.md$/, ''));
  await both(props(page).getByRole('textbox', { name: 'Source', exact: true }), 'property field Source');
  const rings = states.filter((s) => s.textField && hasOutline(s)).map(show);
  assert.deepEqual(rings, [], 'focused text fields show no outline ring, by click or by Tab (D-266, D-594)');
  const notText = states.filter((s) => !s.textField).map(show);
  assert.deepEqual(notText, [], 'every read was a text field');
});

// ------------------------------------------------------------------------------------------------ the old blue

for (const theme of ['light', 'dark'] as const) {
  test(`fr_ux_03_ac13_no_outline_in_the_old_blue_${theme}`, async ({ page }) => {
    await startMain(page, { theme });
    const hits: string[] = [];
    const tabThrough = async (route: string) => {
      for (let i = 0; i < 25; i++) {
        await page.keyboard.press('Tab');
        hits.push(...(await oldBlueOutlines(page)).map((h) => `${route}: ${h}`));
      }
    };
    await runCommand(page, 'Go to Trash'); // 6A: Home is removed (D-613); the Trash page is tabbed instead
    await sleep(200);
    await tabThrough('trash');
    await gotoInbox(page);
    await tabThrough('inbox');
    await runCommand(page, 'Go to Tasks');
    await must(tasksHeading(page), 'heading "Tasks"', 5000);
    await tabThrough('tasks');
    await (await must(viewTab(page, 'Kanban'), 'tab Kanban')).click();
    await tabThrough('kanban');
    await runCommand(page, 'Go to type: Quick Notes');
    await sleep(300);
    await tabThrough('type page');
    await openNote(page, 'Koupit mléko');
    await tabThrough('note');
    await (await must(logoButton(page), 'logo button')).click();
    await (await must(logoMenu(page).getByRole('menuitem', { name: 'Settings…', exact: true }), 'menu item Settings…')).click();
    await must(main(page).getByRole('radiogroup', { name: 'Theme' }), 'radiogroup Theme', 5000);
    await tabThrough('settings');
    assert.deepEqual([...new Set(hits)], [], `no computed outline-color equals ${OLD_BLUE.join(' / ')} (${theme})`);
  });
}
