// Slice PW (page width, Normal / Wide), L5 (WebKit + fake core): docs/acceptance/page-width.md FR-SET-02 AC-6…AC-9 (the
// `Page width` radiogroup in the Note toolbar, a switch applies at once to this note only, drafts and virtual daily
// notes, keyboard), FR-STO-07 AC-4, AC-5 (machine-local, keyed by `id`, else by the NFC path and re-keyed on the first
// edit), FR-SET-01 AC-11 (the Settings › Vault row: calls), AC-12 (UI part: reading, the Conflict alert), AC-13 (the
// vault default applies to notes without a choice, live), FR-UX-01 AC-6 (measured widths), FR-SYN-06 AC-35 (zero
// vault writes from switching; one file per setting change), FR-UX-03 AC-17 (palette commands), FR-UX-05 AC-12 (both
// themes), NFR-OTH-02 AC-9 (pseudo-locale). Interface: docs/contracts/page-width.md §1 (`UiStateDto.noteWidth`,
// `ui_state_set`), §2 (`vault_settings`, `vault_settings_patch` with `key: 'page-width'`), §3 (names, `data-command`,
// `data-icon`, `.note-column[data-width]`), §4 (the Settings row); ms3-shell §3 (the fake core, `__TEGG_UI_STATE__`),
// §13.7 (`setFile`, `renameFile`), read-view.md D-215 (`__TEGG_TEST__.readView`). Fixtures: the shell vault (+
// new-empty/.tegg) and the inbox vault for Settings › Vault. Written from the ACs and the contracts only (D-61); every
// lookup goes through `must`/node:assert (TS-I1).
//
// The fake core's `UiStateDto` type predates `noteWidth`; states with it are passed through a cast (as panel_resize does).
import { test, type Locator, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import type { UiStateDto } from '../ui/test/fake-core';
import {
  P, absent, eventually, focused, gotoTagPage, gotoType, mainName, must, mustBeDraft, mustBeOn, nonReadCalls, openNote, paletteDialog,
  paletteOptions, panel, pseudoLocale, runCommand, seen, settled, shellVault, shellVaultWithTag, sidebar, sleep, start, theme,
  type FakeCoreHandle, type FakeVault,
} from './helpers';
import { callsOf, click, description, fileText, fileWhen, flat, focusName, inboxEntry, inboxVault, main, nfc, startMain, vaultWrites } from './capture-helpers';
import { editorBody, titleField, saveState } from './editor-helpers';
import { cmdD } from './daily-helpers';
import { axeContrast, colourLeaks } from './read-helpers';

test.use({ timezoneId: 'Europe/Prague' });

const NOW = '2026-10-27T12:00:00+02:00';
const TODAY = '2026-10-27';
const DAILY_PATH = 'Daily/2026-10-27.md';
const PORADA = '2026-10-07 Porada';
const UVODNI = 'Úvodní stránka';
const BEZ = 'Bez hlavičky';
const PORADA_ID = '01JA0H0000000000000000H005';
const STALE_ID = '01JZZZZZZZZZZZZZZZZZZZZZZ1';
const YML = '.tegg/vault.yml';
const G = /^⟦?Page width⟧?$/;

type Width = 'normal' | 'wide';
type Radio = 'Normal' | 'Wide';
const asWidth = (r: Radio): Width => (r === 'Wide' ? 'wide' : 'normal');

const ui = (o: { theme?: 'light' | 'dark'; noteWidth?: Record<string, string>; panel?: boolean } = {}) =>
  ({ version: 1, theme: o.theme ?? 'light', sidebarOpen: true, rightPanel: { open: o.panel ?? false, tab: 'backlinks' }, ...(o.noteWidth ? { noteWidth: o.noteWidth } : {}) }) as unknown as UiStateDto;

/** The shell vault whose `vault.yml` has `page-width: <value>` appended after `daily-format: YYYY-MM-DD`. */
function shellWith(line: string | null, base: FakeVault = shellVault()): FakeVault {
  const files = { ...base.files };
  const y = files[YML];
  assert.ok(y !== undefined && y.endsWith('daily-format: YYYY-MM-DD\n'), 'setup: the shell copy has new-empty\'s vault.yml');
  if (line !== null) files[YML] = `${y}${line}\n`;
  return { ...base, files };
}
/** The shell vault plus a runtime note with a 12-column table (FR-UX-01 AC-6). */
function shellWithTable(): FakeVault {
  const base = shellVault();
  const files = { ...base.files };
  const head = Array.from({ length: 12 }, (_, i) => `Sloupec ${i + 1}`);
  const row = Array.from({ length: 12 }, (_, i) => `hodnota ${i + 1} žluťoučká`);
  files['Pages/Tabulka.md'] = `---\nid: 01JA0H0000000000000000T012\ntype: page\ntitle: Tabulka\n---\n| ${head.join(' | ')} |\n| ${head.map(() => '---').join(' | ')} |\n| ${row.join(' | ')} |\n| ${row.join(' | ')} |\n`;
  return { ...base, files };
}

type ShellStart = { vault?: FakeVault; uiState?: UiStateDto; prelude?: string; readView?: boolean; last?: { path: string; id: string | null } | null; viewport?: number };
/** The shell fixture at 1440 × 900 (sidebar open, panel closed), the clock on 27 Oct 2026 noon in Prague. */
async function startShell(page: Page, o: ShellStart = {}): Promise<FakeCoreHandle> {
  await page.setViewportSize({ width: o.viewport ?? 1440, height: 900 });
  await page.clock.setFixedTime(new Date(NOW));
  if (o.readView) await page.addInitScript(() => { const w = window as any; w.__TEGG_TEST__ = { ...(w.__TEGG_TEST__ ?? {}), readView: true }; });
  return start(page, { vault: o.vault ?? shellVault(), uiState: o.uiState ?? ui(), ...(o.prelude ? { prelude: o.prelude } : {}), ...(o.last !== undefined ? { last: o.last } : {}) });
}

// ------------------------------------------------------------------------------------------------ locators and probes

const noteToolbar = (page: Page) => page.getByRole('toolbar', { name: /^⟦?Note toolbar⟧?$/ });
const group = (page: Page) => page.getByRole('radiogroup', { name: G });
const radio = (page: Page, name: Radio) => group(page).getByRole('radio', { name: new RegExp(`^⟦?${name}⟧?$`) });
async function needGroup(page: Page, how: string, ms = 3000): Promise<Locator> {
  const g = await must(group(page), `${how}: radiogroup "Page width"`, ms);
  assert.equal(await g.getByRole('radio').count(), 2, `${how}: exactly two radios`);
  return g;
}
/** `data-width` of `.note-column` in the centre pane. */
const dataWidth = (page: Page) => page.evaluate(() => document.querySelector('main .note-column')?.getAttribute('data-width') ?? null);
/** The checked radio's name (`Normal` | `Wide`), or null. */
async function checkedName(page: Page): Promise<string | null> {
  if (!(await seen(group(page), 1500))) return null;
  return group(page).first().evaluate((g) => {
    const on = [...g.querySelectorAll('[role="radio"]')].filter((r) => r.getAttribute('aria-checked') === 'true');
    if (on.length !== 1) return on.length === 0 ? null : `several: ${on.length}`;
    return (on[0].getAttribute('aria-label') ?? on[0].textContent ?? '').replace(/[⟦⟧]/g, '').trim();
  });
}
/** Waits until the checked radio and the column agree on `want`; returns what was seen. */
async function widthState(page: Page, want: Width, ms = 3000): Promise<{ checked: string | null; column: string | null }> {
  const name: Radio = want === 'wide' ? 'Wide' : 'Normal';
  return eventually(async () => ({ checked: await checkedName(page), column: await dataWidth(page) }), (s) => s.checked === name && s.column === want, ms);
}
async function mustBeWidth(page: Page, want: Width, how: string, ms = 3000) {
  const name: Radio = want === 'wide' ? 'Wide' : 'Normal';
  assert.deepEqual(await widthState(page, want, ms), { checked: name, column: want }, `${how}: "${name}" checked and .note-column[data-width="${want}"]`);
}
async function choose(page: Page, name: Radio) {
  await click(radio(page, name), `radio "${name}"`);
}
const noteWidthOf = async (core: FakeCoreHandle) => (((await core.uiState()) as any)?.noteWidth ?? null) as Record<string, string> | null;
const uiSets = (core: FakeCoreHandle) => callsOf(core, 'ui_state_set');
/** The `UiStateDto` inside a `ui_state_set` call's args (the object carrying `version`). */
function dtoOf(args: unknown): any {
  const a = args as any;
  if (a && typeof a === 'object' && 'version' in a) return a;
  return Object.values(a ?? {}).find((v: any) => v && typeof v === 'object' && 'version' in v) ?? null;
}
const idOf = (text: string | undefined) => /^id: (\S+)$/m.exec(text ?? '')?.[1] ?? null;

/** Records `data-width` mutations in the centre pane and the last pointer/key time, for "within 100 ms". */
async function armTimer(page: Page) {
  await page.evaluate(() => {
    const w = window as any;
    if (w.__pwArmed) { w.__at = null; w.__widthAt = []; return; }
    w.__pwArmed = true; w.__at = null; w.__widthAt = [];
    const rec = () => w.__widthAt.push([document.querySelector('main .note-column')?.getAttribute('data-width') ?? null, performance.now()]);
    new MutationObserver(rec).observe(document.querySelector('main') ?? document.body, { attributes: true, subtree: true, childList: true, attributeFilter: ['data-width'] });
    document.addEventListener('pointerdown', () => { w.__at = performance.now(); }, true);
    document.addEventListener('keydown', () => { if (w.__at === null) w.__at = performance.now(); }, true);
  });
}
const appliedWithin = (page: Page, want: Width) => page.evaluate((v) => { const x = window as any; const hit = (x.__widthAt as [string | null, number][]).find(([a]) => a === v); return hit && x.__at !== null ? hit[1] - x.__at : Infinity; }, want);

/** The accessible names of the Note toolbar's controls in DOM order (buttons, the status, the radiogroup), the radios aside. */
async function toolbarOrder(page: Page): Promise<string[]> {
  const tb = await must(noteToolbar(page), 'toolbar "Note toolbar"');
  return tb.evaluate((t) => {
    const out: string[] = [];
    const walk = (n: Element) => {
      for (const c of n.children) {
        const role = c.getAttribute('role') ?? (c.tagName === 'BUTTON' ? 'button' : null);
        if (role === 'button' || role === 'status' || role === 'radiogroup') {
          out.push((c.getAttribute('aria-label') ?? (role === 'radiogroup' ? '' : c.textContent) ?? '').replace(/[⟦⟧]/g, '').replace(/\s+/g, ' ').trim());
          if (role === 'radiogroup') continue;
        }
        walk(c);
      }
    };
    walk(t);
    return out.filter(Boolean);
  });
}
const WANT_ORDER = ['Show Markdown source', 'Save state', 'Page width', 'Focus mode', 'Toggle right panel'];
const keep = (xs: string[]) => xs.filter((x) => WANT_ORDER.includes(x) || x === 'Show formatted note');

/** Marks the Note body node so a later read tells a reload (new node) from the same node. */
const markBody = (page: Page) => editorBody(page).first().evaluate((e) => { (e as any).__pwBody = 1; });
const bodyIsSame = (page: Page) => editorBody(page).first().evaluate((e) => (e as any).__pwBody === 1);
const selectionOf = (page: Page) => page.evaluate(() => { const s = getSelection(); return s && s.rangeCount ? [s.anchorOffset, s.focusOffset, (s.anchorNode?.textContent ?? '').slice(0, 40)] : null; });

// ================================================================================================ FR-SET-02 AC-6

test('fr_set_02_ac6_group_in_the_note_toolbar_with_two_radios_in_order', async ({ page }) => {
  await startShell(page);
  await openNote(page, PORADA);
  const tb = await must(noteToolbar(page), 'toolbar "Note toolbar"');
  const g = await must(tb.getByRole('radiogroup', { name: 'Page width', exact: true }), 'radiogroup "Page width" inside the Note toolbar');
  const radios = await g.getByRole('radio').evaluateAll((rs) => rs.map((r) => ({
    text: (r.textContent ?? '').replace(/\s+/g, ' ').trim(),
    command: r.getAttribute('data-command'),
    icon: r.querySelector('[data-icon]')?.getAttribute('data-icon') ?? r.getAttribute('data-icon'),
    checked: r.getAttribute('aria-checked'),
  })));
  assert.deepEqual(radios.map(({ checked, ...r }) => r), [
    { text: 'Normal', command: 'note.width.normal', icon: 'width-normal' },
    { text: 'Wide', command: 'note.width.wide', icon: 'width-wide' },
  ], 'two radios: visible text, data-command, data-icon (contract §3)');
  assert.equal(await g.getByRole('radio', { name: 'Normal', exact: true }).count(), 1, 'the accessible name of the first radio is its text "Normal"');
  assert.equal(await g.getByRole('radio', { name: 'Wide', exact: true }).count(), 1, 'the accessible name of the second radio is its text "Wide"');
  assert.deepEqual(radios.map((r) => r.checked), ['true', 'false'], 'exactly one is aria-checked="true" (Normal on Porada, no entry)');
  assert.deepEqual(keep(await toolbarOrder(page)), WANT_ORDER, 'edit view: DOM order Show Markdown source, Save state, Page width, Focus mode, Toggle right panel');
  // The source view (⌥⌘U): the group is present, same checked radio, immediately before Focus mode.
  await page.keyboard.press('Alt+Meta+u');
  await must(page.getByRole('region', { name: 'Markdown source', exact: true }), 'the source view (⌥⌘U)');
  await needGroup(page, 'source view');
  assert.equal(await checkedName(page), 'Normal', 'source view: the same checked radio');
  const src = keep(await toolbarOrder(page));
  assert.equal(src[src.indexOf('Page width') + 1], 'Focus mode', `source view: Page width immediately before Focus mode (${src.join(', ')})`);
});

test('fr_set_02_ac6_group_in_the_read_view_before_focus_mode', async ({ page }) => {
  await startShell(page, { readView: true, uiState: ui({ noteWidth: { [PORADA_ID]: 'wide' } }) });
  await openNote(page, PORADA);
  await must(page.getByRole('article', { name: PORADA, exact: true }), 'the read view (article) of Porada');
  await needGroup(page, 'read view');
  await mustBeWidth(page, 'wide', 'read view with the entry "wide"');
  const order = keep(await toolbarOrder(page));
  assert.equal(order[order.indexOf('Page width') + 1], 'Focus mode', `read view: Page width immediately before Focus mode (${order.join(', ')})`);
  await page.keyboard.press('Alt+Meta+u');
  await must(page.getByRole('region', { name: 'Markdown source', exact: true }), 'the source view from the read view');
  await mustBeWidth(page, 'wide', 'source view keeps the checked radio');
});

test('fr_set_02_ac6_present_on_note_routes_and_absent_elsewhere', async ({ page }) => {
  await startShell(page, { vault: shellVaultWithTag() });
  await openNote(page, BEZ);
  await needGroup(page, 'Bez hlavičky');
  await cmdD(page, TODAY);
  await needGroup(page, `daily/${TODAY} (virtual)`);
  await page.keyboard.press('Meta+n');
  await mustBeDraft(page, 'new/quick-note');
  await needGroup(page, 'new/quick-note');
  const failures: string[] = [];
  const check = async (route: string) => {
    if (await seen(noteToolbar(page), 500)) failures.push(`${route}: the Note toolbar is shown`);
    const inToolbar = await page.evaluate(() => [...document.querySelectorAll('[role="toolbar"] [role="radiogroup"]')].some((g) => /page width/i.test(g.getAttribute('aria-label') ?? '')));
    if (inToolbar) failures.push(`${route}: a Page width group inside a toolbar`);
    if (route !== 'settings/vault' && (await group(page).count()) > 0) failures.push(`${route}: a Page width radiogroup is shown`);
  };
  await runCommand(page, 'Go to Inbox'); await mustBeOn(page, 'Inbox', 'Go to Inbox'); await check('home (Inbox, the launch fallback D-614)');
  await runCommand(page, 'Go to Tasks'); await mustBeOn(page, 'Tasks', 'Go to Tasks'); await check('tasks');
  await gotoType(page, 'Pages'); await check('type/page');
  const tag = await gotoTagPage(page); await mustBeOn(page, tag, 'tag page'); await check('tag/<name>');
  await runCommand(page, 'Go to Search'); await mustBeOn(page, 'Search', 'Go to Search'); await check('search');
  await runCommand(page, 'Go to Settings: Vault'); await mustBeOn(page, 'Settings: Vault', 'Go to Settings: Vault'); await check('settings/vault');
  await runCommand(page, 'Go to Settings: Appearance'); await mustBeOn(page, 'Settings: Appearance', 'Go to Settings: Appearance'); await check('settings/appearance');
  assert.deepEqual(failures, [], 'absent on home, tasks, type/page, tag/<name>, search and the Settings pages');
});

test('fr_set_02_ac6_focus_mode_hides_the_group_and_keeps_the_width', async ({ page }) => {
  await startShell(page);
  await openNote(page, PORADA);
  await needGroup(page, 'Porada');
  await choose(page, 'Wide');
  await mustBeWidth(page, 'wide', 'after Wide');
  await page.getByRole('main').getByRole('heading', { level: 1 }).focus();
  await page.keyboard.press('Meta+Shift+Backslash');
  assert.ok(await absent(sidebar(page)), 'focus mode: the sidebar is hidden');
  assert.ok(await absent(group(page)), 'focus mode: the group leaves with the toolbar');
  assert.equal(await dataWidth(page), 'wide', 'focus mode: .note-column keeps data-width="wide"');
  await page.keyboard.press('Escape');
  assert.ok(await seen(sidebar(page)), 'leaving focus mode');
  await mustBeWidth(page, 'wide', 'after leaving focus mode: the group is back, unchanged');
});

// ================================================================================================ FR-SET-02 AC-7

test('fr_set_02_ac7_switch_applies_at_once_to_this_note_only', async ({ page }) => {
  await startShell(page);
  await openNote(page, PORADA);
  await needGroup(page, 'Porada');
  await mustBeWidth(page, 'normal', 'Porada without an entry');
  const body = await must(editorBody(page), 'Note body');
  await body.click();
  await page.keyboard.press('End');
  const text0 = flat(await body.innerText());
  const sel0 = await selectionOf(page);
  await markBody(page);
  await armTimer(page);
  await choose(page, 'Wide');
  await mustBeWidth(page, 'wide', 'click Wide');
  const dt = await appliedWithin(page, 'wide');
  assert.ok(dt <= 100, `data-width="wide" within 100 ms of the click (${dt.toFixed(1)} ms)`);
  assert.equal(await bodyIsSame(page), true, 'the Note body is the same DOM node (no reload)');
  assert.equal(flat(await editorBody(page).first().innerText()), text0, 'the body text is unchanged');
  assert.deepEqual(await selectionOf(page), sel0, "the editor's selection is unchanged");
  await armTimer(page);
  await choose(page, 'Normal');
  await mustBeWidth(page, 'normal', 'click Normal reverses it');
  assert.ok((await appliedWithin(page, 'normal')) <= 100, 'Normal within 100 ms');
  await choose(page, 'Wide');
  await mustBeWidth(page, 'wide', 'Wide again');
  await openNote(page, UVODNI);
  await mustBeWidth(page, 'normal', 'Úvodní has no entry: Normal');
  await page.keyboard.press('Meta+BracketLeft');
  await mustBeOn(page, PORADA, 'Back (⌘[)');
  await mustBeWidth(page, 'wide', 'Back to Porada: Wide still checked');
});

test('fr_set_02_ac7_a_choice_made_in_the_read_view_shows_in_the_editor_and_the_source_view', async ({ page, context }) => {
  const core = await startShell(page, { readView: true });
  await openNote(page, PORADA);
  await must(page.getByRole('article', { name: PORADA, exact: true }), 'the read view of Porada');
  await needGroup(page, 'read view');
  await choose(page, 'Wide');
  await mustBeWidth(page, 'wide', 'read view: Wide');
  const stored = await eventually(() => core.uiState(), (s) => (s as any)?.noteWidth?.[PORADA_ID] === 'wide', 2000);
  assert.equal((stored as any)?.noteWidth?.[PORADA_ID], 'wide', 'the read view stores the entry under the id');
  // The same machine-local state, the editor route (a second page without the read-view switch).
  const p2 = await context.newPage();
  await startShell(p2, { uiState: stored as UiStateDto });
  await openNote(p2, PORADA);
  await must(editorBody(p2), 'the editor on Porada');
  await mustBeWidth(p2, 'wide', 'editor: the same width');
  await p2.keyboard.press('Alt+Meta+u');
  await must(p2.getByRole('region', { name: 'Markdown source', exact: true }), 'source view');
  await mustBeWidth(p2, 'wide', 'source view: the same width');
  await p2.close();
});

// ================================================================================================ FR-SET-02 AC-8

test('fr_set_02_ac8_a_draft_stores_nothing_until_it_is_created', async ({ page }) => {
  const core = await startShell(page);
  await page.keyboard.press('Meta+n');
  await mustBeDraft(page, 'new/quick-note');
  await needGroup(page, 'draft');
  await mustBeWidth(page, 'normal', 'the draft opens with the vault default');
  const n0 = (await uiSets(core)).length;
  await choose(page, 'Wide');
  await mustBeWidth(page, 'wide', 'draft: Wide');
  await sleep(400);
  assert.equal((await uiSets(core)).length, n0, 'no ui_state_set for a draft (nothing to key)');
  assert.deepEqual(await noteWidthOf(core) ?? {}, {}, 'no entry stored');
  await (await must(titleField(page), 'Title')).click();
  await page.keyboard.type('Široký nápad');
  await page.keyboard.press('Enter');
  await mustBeOn(page, 'Široký nápad', '⏎ creates the note');
  const text = await fileWhen(core, 'Quick Notes/Široký nápad.md', (t) => t !== undefined, 5000);
  assert.ok(text !== undefined, 'Quick Notes/Široký nápad.md is created');
  const id = idOf(text);
  assert.ok(id, 'the new file has an id');
  await mustBeWidth(page, 'wide', 'the route note/Quick Notes/Široký nápad.md is still wide');
  const nw = await eventually(() => noteWidthOf(core), (m) => !!m && Object.keys(m).length > 0, 3000);
  assert.deepEqual(nw, { [id!]: 'wide' }, 'exactly one new entry, keyed by the new file\'s id, no path key');
});

test('fr_set_02_ac8_an_abandoned_wide_draft_stores_nothing', async ({ page }) => {
  const core = await startShell(page);
  await page.keyboard.press('Meta+n');
  await mustBeDraft(page, 'new/quick-note');
  await needGroup(page, 'draft');
  await choose(page, 'Wide');
  await mustBeWidth(page, 'wide', 'draft: Wide');
  const n0 = (await uiSets(core)).length;
  await click(inboxEntry(page), 'sidebar "Inbox"');
  await mustBeOn(page, 'Inbox', 'leaving the draft');
  await sleep(300);
  assert.equal((await uiSets(core)).length, n0, 'leaving the draft stores nothing');
  assert.deepEqual(await noteWidthOf(core) ?? {}, {}, 'no entry');
  assert.deepEqual(await vaultWrites(core), [], 'nothing written');
  await page.keyboard.press('Meta+n');
  await mustBeDraft(page, 'the next new/quick-note');
  await mustBeWidth(page, 'normal', 'the next draft opens with the vault default');
});

test('fr_set_02_ac8_a_virtual_daily_note_is_keyed_by_path_then_by_id', async ({ page }) => {
  const core = await startShell(page);
  await cmdD(page, TODAY);
  assert.equal(await fileText(core, DAILY_PATH), undefined, `setup: no ${DAILY_PATH} yet`);
  await needGroup(page, 'virtual daily');
  await choose(page, 'Wide');
  await mustBeWidth(page, 'wide', 'daily: Wide');
  const nw = await eventually(() => noteWidthOf(core), (m) => !!m && Object.keys(m).length > 0, 2000);
  assert.deepEqual(nw, { [DAILY_PATH]: 'wide' }, 'stored at once under the path of the file to be');
  await (await must(editorBody(page), 'Note body')).click();
  await page.keyboard.type('Ráno');
  const text = await fileWhen(core, DAILY_PATH, (t) => t !== undefined, 5000);
  assert.ok(text !== undefined, `${DAILY_PATH} is written on the first edit`);
  const id = idOf(text);
  assert.ok(id, 'the written file has an id');
  const moved = await eventually(() => noteWidthOf(core), (m) => !!m && m[id!] === 'wide' && !(DAILY_PATH in m), 3000);
  assert.deepEqual(moved, { [id!]: 'wide' }, 'the entry moves to the id; the path key is gone');
  await mustBeWidth(page, 'wide', 'still wide after the write');
  await runCommand(page, 'Go to Inbox');
  await mustBeOn(page, 'Inbox', 'away');
  await cmdD(page, TODAY);
  await mustBeWidth(page, 'wide', `reopening daily/${TODAY}`);
});

// ================================================================================================ FR-SET-02 AC-9

/** ⇧Tabs from the focused element (AP-762, owner 2026-10-27: the toolbar sits above the note, so the group is reached
 *  backwards from the type chip) until a radio of the group has the focus (at most `max` stops); returns the stops. */
async function tabToGroup(page: Page, max = 14, key = 'Shift+Tab'): Promise<{ role: string; name: string }[]> {
  const stops: { role: string; name: string }[] = [];
  for (let i = 0; i < max; i++) {
    await page.keyboard.press(key);
    const f = await focusName(page);
    stops.push(f);
    if (f.role === 'radio' && /^(Normal|Wide)$/.test(f.name)) break;
  }
  return stops;
}
const outlineOfActive = (page: Page) => page.evaluate(() => { const a = document.activeElement as HTMLElement | null; if (!a) return null; const s = getComputedStyle(a); return { style: s.outlineStyle, width: parseFloat(s.outlineWidth) || 0 }; });

test('fr_set_02_ac9_tab_reaches_the_checked_radio_and_arrows_space_enter_choose', async ({ page }) => {
  await startShell(page);
  await openNote(page, PORADA);
  await needGroup(page, 'Porada');
  await (await must(main(page).getByRole('link', { name: /^Type: / }), 'the type chip')).focus();
  const stops = await tabToGroup(page);
  const last = stops[stops.length - 1];
  assert.deepEqual(last, { role: 'radio', name: 'Normal' }, `⇧Tab from the type chip reaches the group, landing on the checked radio (stops: ${stops.map((s) => `${s.role} ${s.name}`).join(' → ')})`);
  await page.keyboard.press('Tab');
  const next = await focusName(page);
  assert.ok(!(next.role === 'radio' && /^(Normal|Wide)$/.test(next.name)), `the unchecked radio is not a Tab stop (next stop: ${next.role} ${next.name})`);
  await page.keyboard.press('Shift+Tab');
  assert.deepEqual(await focusName(page), { role: 'radio', name: 'Normal' }, '⇧Tab returns to the checked radio');
  await armTimer(page);
  await page.keyboard.press('ArrowRight');
  await mustBeWidth(page, 'wide', '→ on Normal chooses Wide');
  assert.ok((await appliedWithin(page, 'wide')) <= 100, `→ applies within 100 ms (${(await appliedWithin(page, 'wide')).toFixed(1)} ms)`);
  assert.deepEqual(await focusName(page), { role: 'radio', name: 'Wide' }, '→ moves the focus to Wide');
  const ring = await outlineOfActive(page);
  assert.ok(ring && ring.style !== 'none' && ring.width >= 2, `the focused radio shows the ≥ 2 px outline (FR-UX-03 AC-13 b): ${JSON.stringify(ring)}`);
  await page.keyboard.press('ArrowLeft');
  await mustBeWidth(page, 'normal', '← chooses Normal');
  assert.deepEqual(await focusName(page), { role: 'radio', name: 'Normal' }, '← moves the focus to Normal');
  await radio(page, 'Wide').focus();
  await page.keyboard.press('Space');
  await mustBeWidth(page, 'wide', 'Space on the focused radio chooses it');
  assert.deepEqual(await focusName(page), { role: 'radio', name: 'Wide' }, 'the focus stays on the radio after Space');
  await radio(page, 'Normal').focus();
  await page.keyboard.press('Enter');
  await mustBeWidth(page, 'normal', '⏎ on the focused radio chooses it');
  assert.deepEqual(await focusName(page), { role: 'radio', name: 'Normal' }, 'the focus stays on the radio after ⏎');
});

test('fr_set_02_ac9_keyboard_only_run_from_search_to_back', async ({ page }) => {
  await startShell(page);
  await openNote(page, PORADA); // ⇧⌘F, the title typed, ⏎: keyboard only
  await needGroup(page, 'Porada');
  await (await must(main(page).getByRole('link', { name: /^Type: / }), 'the type chip')).focus();
  const stops = await tabToGroup(page);
  assert.deepEqual(stops[stops.length - 1], { role: 'radio', name: 'Normal' }, '⇧Tab from the type chip reaches the checked radio');
  await page.keyboard.press('ArrowRight');
  await mustBeWidth(page, 'wide', '→ sets Wide');
  await openNote(page, UVODNI);
  await mustBeWidth(page, 'normal', 'Úvodní: Normal');
  await page.keyboard.press('Meta+BracketLeft');
  await mustBeOn(page, PORADA, '⌘[');
  await mustBeWidth(page, 'wide', 'Back finds Wide checked');
});

// ================================================================================================ FR-STO-07 AC-4

test('fr_sto_07_ac4_one_ui_state_set_per_change_keyed_by_id_and_nothing_in_the_vault', async ({ page }) => {
  const init = ui({ noteWidth: { [STALE_ID]: 'wide' } });
  const core = await startShell(page, { uiState: init });
  await openNote(page, PORADA);
  await needGroup(page, 'Porada');
  const prev = ((await core.uiState()) ?? init) as any;
  const n0 = (await uiSets(core)).length;
  await choose(page, 'Wide');
  await mustBeWidth(page, 'wide', 'Wide');
  const sets = await eventually(() => uiSets(core), (c) => c.length >= n0 + 1, 2000);
  assert.equal(sets.length, n0 + 1, 'exactly one ui_state_set');
  const dto = dtoOf(sets[sets.length - 1].args);
  assert.ok(dto, `the call carries a UiStateDto: ${JSON.stringify(sets[sets.length - 1].args)}`);
  assert.equal(dto.version, 1, 'version 1');
  assert.deepEqual(dto.noteWidth, { [STALE_ID]: 'wide', [PORADA_ID]: 'wide' }, 'noteWidth: the stale entry kept (no pruning), Porada\'s id → wide');
  const { noteWidth: _a, ...restNew } = dto;
  const { noteWidth: _b, ...restOld } = prev;
  // AP-764 (owner 2026-10-27): the UI writes the state as it reads it, with the defaults of fields a 3A-era file lacks
  // (ms3-shell §3, §11.2, §14.7.1).
  const asRead = { propertiesOpen: true, typeSort: {}, otherPropertiesOpen: false, ...restOld };
  assert.deepEqual(restNew, asRead, 'every other field unchanged (missing fields read as their defaults)');
  await choose(page, 'Normal');
  await mustBeWidth(page, 'normal', 'Normal');
  const sets2 = await eventually(() => uiSets(core), (c) => c.length >= n0 + 2, 2000);
  assert.equal(sets2.length, n0 + 2, 'one more ui_state_set');
  assert.deepEqual(dtoOf(sets2[sets2.length - 1].args)?.noteWidth, { [STALE_ID]: 'wide', [PORADA_ID]: 'normal' }, 'the key stays, with "normal" (AP-760)');
  await choose(page, 'Normal');
  await sleep(400);
  assert.equal((await uiSets(core)).length, n0 + 2, 'a second click on the checked radio sends nothing (AP-760)');
  assert.deepEqual(await nonReadCalls(core), [], 'no write command of any kind');
  assert.deepEqual(await vaultWrites(core), [], 'no note_write, vault_settings_patch or other vault write');
  assert.equal(await core.writes(), 0, 'no vault write');
});

test('fr_sto_07_ac4_missing_note_width_reads_as_empty_and_the_entry_follows_the_id', async ({ page }) => {
  const core = await startShell(page, { uiState: ui() }); // a 3A-era state: no noteWidth
  await openNote(page, PORADA);
  await mustBeWidth(page, 'normal', 'Porada: the vault default');
  await openNote(page, UVODNI);
  await mustBeWidth(page, 'normal', 'Úvodní: the vault default');
  await openNote(page, BEZ);
  await mustBeWidth(page, 'normal', 'Bez hlavičky: the vault default');
  await openNote(page, PORADA);
  await choose(page, 'Wide');
  await mustBeWidth(page, 'wide', 'Porada: Wide');
  assert.deepEqual(await eventually(() => noteWidthOf(core), (m) => !!m?.[PORADA_ID], 2000), { [PORADA_ID]: 'wide' }, 'stored under the id');
  await openNote(page, UVODNI);
  const renamed = 'Schůzky/2026-10-07 Porada týmu.md';
  await core.renameFile(P.porada, renamed); // another program renames the file, same id; vault:changed
  // AP-763 (owner 2026-10-27): the note keeps its frontmatter title (FR-FMT-08); it is opened by it and its path checked.
  await openNote(page, PORADA);
  const reads = (await core.calls()).filter((c) => c.cmd === 'note_read').map((c) => String((c.args as any)?.path ?? '').normalize('NFC'));
  assert.equal(reads[reads.length - 1], renamed, 'the opened file is the renamed one');
  await mustBeWidth(page, 'wide', 'the renamed note (same id) opens Wide');
  assert.deepEqual(await noteWidthOf(core), { [PORADA_ID]: 'wide' }, 'the entry is keyed by the id, not the path');
  assert.deepEqual(await vaultWrites(core), [], 'nothing written');
});

// ================================================================================================ FR-STO-07 AC-5

test('fr_sto_07_ac5_no_id_keyed_by_the_nfc_path_and_rekeyed_on_the_first_edit', async ({ page }) => {
  // An NFD route through the app: a runtime note links to Bez hlavičky with the target spelt in NFD; the link chip is
  // clicked in the editor (the fake's `vault_last` only matches NFC keys, so a `last` path can't be the NFD route).
  const nfdTarget = BEZ.normalize('NFD');
  assert.notEqual(nfdTarget, BEZ, 'setup: the NFD target differs from the NFC title');
  const vault = shellVault();
  vault.files['Pages/Odkaz.md'] = `---\nid: 01JA0H0000000000000000L001\ntype: page\ntitle: Odkaz\n---\nViz [[${nfdTarget}]].\n`;
  // D-949: the chip is opened with a single click, so the steps run under preview.mode = off.
  const core = await startShell(page, { vault, uiState: { ...ui(), preview: { mode: 'off' } } });
  await openNote(page, 'Odkaz');
  const chip = await must(editorBody(page).locator('[data-link-kind]').filter({ hasText: /Bez hlavi/ }), 'the NFD link chip to Bez hlavičky');
  await chip.click();
  await mustBeOn(page, BEZ, 'opening Bez hlavičky through the NFD link');
  await needGroup(page, 'Bez hlavičky');
  await choose(page, 'Wide');
  await mustBeWidth(page, 'wide', 'Wide');
  const nw = await eventually(() => noteWidthOf(core), (m) => !!m && Object.keys(m).length > 0, 2000);
  assert.deepEqual(nw, { [P.bez]: 'wide' }, 'keyed by the vault-relative path in NFC (FR-FMT-12)');
  assert.ok(Object.keys(nw ?? {}).every((k) => k === k.normalize('NFC')), 'the key is NFC');
  await openNote(page, UVODNI);
  await openNote(page, BEZ); // the NFC path
  await mustBeWidth(page, 'wide', 'opened again through the NFC path: Wide');
  await (await must(editorBody(page), 'Note body')).click();
  await page.keyboard.press('End');
  await page.keyboard.type(' Doplněk');
  assert.ok(await seen(saveState(page).filter({ hasText: 'Saved' }), 6000), 'Saved');
  const text = await fileText(core, P.bez);
  const id = idOf(text);
  assert.ok(id, `the first edit writes an id (editor.md FR-FMT-02 AC-5): ${text?.slice(0, 80)}`);
  const moved = await eventually(() => noteWidthOf(core), (m) => !!m && m[id!] === 'wide' && !(P.bez in m), 3000);
  assert.deepEqual(moved, { [id!]: 'wide' }, 'the entry moves to the written id; the path key is gone');
  const calls = await core.calls();
  const write = [...calls].reverse().find((c) => c.cmd === 'note_write');
  assert.ok(write, 'a note_write happened');
  const after = calls.filter((c) => c.cmd === 'ui_state_set' && (c.seq ?? 0) > (write!.seq ?? 0));
  assert.equal(after.length, 1, `one ui_state_set after the write (got ${after.length})`);
  assert.equal(dtoOf(after[0]?.args)?.noteWidth?.[id!], 'wide', 'that call carries the id-keyed entry');
  await mustBeWidth(page, 'wide', 'the note stays Wide');
});

test('fr_sto_07_ac5_a_file_without_id_renamed_outside_has_no_entry_under_its_new_path', async ({ page }) => {
  const core = await startShell(page);
  await openNote(page, BEZ);
  await needGroup(page, 'Bez hlavičky');
  await choose(page, 'Wide');
  await mustBeWidth(page, 'wide', 'Wide');
  assert.deepEqual(await eventually(() => noteWidthOf(core), (m) => !!m?.[P.bez], 2000), { [P.bez]: 'wide' }, 'keyed by the path');
  await openNote(page, UVODNI);
  await core.renameFile(P.bez, 'Pages/Bez názvu.md'); // outside Tegg, no id to follow
  await openNote(page, 'Bez názvu');
  await mustBeWidth(page, 'normal', 'the renamed id-less file shows the vault default (AP-753)');
  assert.deepEqual(await noteWidthOf(core), { [P.bez]: 'wide' }, 'the old path entry is left as it is (no pruning)');
  assert.deepEqual(await vaultWrites(core), [], 'nothing written');
});

// ================================================================================================ FR-SET-01 AC-11

async function openVaultSettings(page: Page, o: Parameters<typeof startMain>[1] = {}): Promise<FakeCoreHandle> {
  const core = await startMain(page, o);
  await runCommand(page, 'Go to Settings: Vault');
  await mustBeOn(page, 'Settings: Vault', 'Go to Settings: Vault');
  return core;
}
const attachmentsField = (page: Page) => main(page).getByRole('textbox', { name: 'Attachments folder', exact: true });

test('fr_set_01_ac11_the_settings_row_sends_one_patch_per_change', async ({ page }) => {
  const core = await openVaultSettings(page);
  const g = await needGroup(page, 'settings/vault');
  const af = await must(attachmentsField(page), 'textbox Attachments folder');
  const after = await af.evaluate((a, gEl) => !!(a.compareDocumentPosition(gEl as Node) & Node.DOCUMENT_POSITION_FOLLOWING), await g.elementHandle());
  assert.equal(after, true, 'the Page width row comes after Attachments folder');
  const cmds = await g.getByRole('radio').evaluateAll((rs) => rs.map((r) => [(r.textContent ?? '').trim(), r.getAttribute('data-command')]));
  assert.deepEqual(cmds, [['Normal', 'settings.pageWidth.normal'], ['Wide', 'settings.pageWidth.wide']], 'the radios and their commands (contract §4)');
  const desc = await description(g);
  const shown = desc === 'For notes without their own choice.' || (await seen(main(page).getByText('For notes without their own choice.', { exact: true }), 1000));
  assert.ok(shown, `the description "For notes without their own choice." (described-by: ${JSON.stringify(desc)})`);
  assert.equal(await checkedName(page), 'Normal', 'no page-width line: Normal checked');
  assert.deepEqual(await vaultWrites(core), [], 'opening the page writes nothing');
  const before = await fileText(core, YML);
  assert.ok(before?.endsWith('daily-format: YYYY-MM-DD\n'), 'setup: the fixture ends with the daily-format line');
  const v0 = await core.version(YML);
  await choose(page, 'Wide');
  const calls = await eventually(() => callsOf(core, 'vault_settings_patch'), (c) => c.length >= 1, 2000);
  assert.equal(calls.length, 1, 'exactly one vault_settings_patch');
  assert.deepEqual(calls[0].args, { base: v0, key: 'page-width', value: 'wide' }, 'key page-width, value wide, base = the file\'s last-read version');
  assert.equal(await fileWhen(core, YML, (t) => t !== before), `${before}page-width: wide\n`, 'exactly the line page-width: wide appended; every other byte unchanged');
  assert.deepEqual(await core.writesTo(), [YML], 'no other file written');
  assert.equal(await checkedName(page), 'Wide', 'Wide checked');
  await choose(page, 'Normal');
  assert.equal(await fileWhen(core, YML, (t) => !!t && t.endsWith('page-width: normal\n')), `${before}page-width: normal\n`, 'Normal changes only that line');
  assert.deepEqual(await core.writesTo(), [YML, YML], 'one file per change');
  await choose(page, 'Normal');
  await sleep(400);
  assert.equal((await callsOf(core, 'vault_settings_patch')).length, 2, 'choosing the checked value sends nothing');
  assert.deepEqual(await core.writesTo(), [YML, YML], 'and writes nothing');
});

// ================================================================================================ FR-SET-01 AC-12 (UI)

test('fr_set_01_ac12_the_page_reads_every_value_and_never_offers_a_third', async ({ browser }) => {
  test.setTimeout(150_000);
  const cases: [string | null, Radio][] = [
    ['page-width: wide', 'Wide'], [null, 'Normal'], ['page-width: normal', 'Normal'], ['page-width: Wide', 'Normal'],
    ['page-width: huge', 'Normal'], ['page-width:', 'Normal'], ['page-width: 1200', 'Normal'],
  ];
  const failures: string[] = [];
  for (const [line, want] of cases) {
    const page = await browser.newPage();
    const vault = inboxVault((f) => { if (line !== null) f[YML] = `${f[YML]}${line}\n`; });
    const text = vault.files[YML];
    const core = await openVaultSettings(page, { vault });
    const g = group(page);
    if (!(await seen(g, 3000))) { failures.push(`${line ?? '(missing)'}: no Page width group`); await page.close(); continue; }
    const n = await g.getByRole('radio').count();
    if (n !== 2) failures.push(`${line ?? '(missing)'}: ${n} radios (never a third value)`);
    const got = await eventually(() => checkedName(page), (c) => c === want, 2000);
    if (got !== want) failures.push(`${line ?? '(missing)'}: ${got} checked, want ${want}`);
    if ((await vaultWrites(core)).length) failures.push(`${line ?? '(missing)'}: reading wrote ${(await vaultWrites(core)).join(', ')}`);
    if ((await fileText(core, YML)) !== text) failures.push(`${line ?? '(missing)'}: vault.yml was rewritten`);
    await page.close();
  }
  assert.deepEqual(failures, [], 'wide for page-width: wide; normal for a missing line, normal, Wide, huge, empty and 1200; nothing written');
});

test('fr_set_01_ac12_a_stale_base_shows_the_alert_and_reloads', async ({ page }) => {
  const core = await openVaultSettings(page);
  await needGroup(page, 'settings/vault');
  const theirs = (await fileText(core, YML))!.replace('attachments: _attachments', 'attachments: Soubory');
  await core.setFile(YML, theirs, { silent: true }); // changed outside Tegg, no event: the page's base is stale
  await choose(page, 'Wide');
  assert.ok(await seen(page.getByRole('alert').filter({ hasText: "Changed outside Tegg. Your change to Page width wasn't saved." }), 2000), 'the R58 alert names Page width');
  assert.equal(await fileText(core, YML), theirs, 'the file keeps the external bytes (nothing written)');
  assert.deepEqual(await core.writesTo(), [], 'no write');
  const v = await eventually(() => attachmentsField(page).first().inputValue().catch(() => ''), (x) => x === 'Soubory', 2000);
  assert.equal(v, 'Soubory', 'the page reloads the file within 2 s');
  assert.equal(await checkedName(page), 'Normal', 'the row shows the file\'s value (no page-width line: Normal)');
});

// ================================================================================================ FR-SET-01 AC-13

test('fr_set_01_ac13_the_vault_default_applies_to_notes_without_a_choice_live', async ({ page }) => {
  const core = await startShell(page, { vault: shellWith('page-width: wide'), uiState: ui({ noteWidth: { [PORADA_ID]: 'normal' } }) });
  await openNote(page, UVODNI);
  await mustBeWidth(page, 'wide', 'Úvodní (no entry) follows the default wide');
  await openNote(page, BEZ);
  await mustBeWidth(page, 'wide', 'Bez hlavičky (no entry) follows the default wide');
  await openNote(page, PORADA);
  await mustBeWidth(page, 'normal', 'Porada with the entry "normal" opens Normal');
  await page.keyboard.press('Meta+n');
  await mustBeDraft(page, 'new/quick-note');
  await mustBeWidth(page, 'wide', 'the draft opens Wide');
  await cmdD(page, TODAY);
  await mustBeWidth(page, 'wide', `daily/${TODAY} opens Wide`);
  // Changing the default on settings/vault: back on Úvodní the new default shows.
  await openNote(page, UVODNI);
  await mustBeWidth(page, 'wide', 'Úvodní again');
  await runCommand(page, 'Go to Settings: Vault');
  await mustBeOn(page, 'Settings: Vault', 'settings');
  await needGroup(page, 'settings/vault');
  assert.equal(await checkedName(page), 'Wide', 'the row shows the file\'s wide');
  await choose(page, 'Normal');
  assert.ok((await fileWhen(core, YML, (t) => !!t && t.endsWith('page-width: normal\n'))) !== undefined, 'the default is written as normal');
  await page.keyboard.press('Meta+BracketLeft');
  await mustBeOn(page, UVODNI, '⌘[');
  await mustBeWidth(page, 'normal', 'Úvodní follows the new default Normal', 2000);
  // `page-width: wide` written outside Tegg (vault:changed): live within 2 s, no reload, no write.
  await markBody(page);
  const w0 = (await vaultWrites(core)).length;
  const theirs = (await fileText(core, YML))!.replace('page-width: normal\n', 'page-width: wide\n');
  await core.setFile(YML, theirs);
  await mustBeWidth(page, 'wide', 'vault:changed with page-width: wide: Úvodní shows Wide', 2000);
  assert.equal(await bodyIsSame(page), true, 'no reload of the note (the Note body is the same node)');
  assert.equal((await vaultWrites(core)).length, w0, 'zero write commands from following the default');
  await openNote(page, PORADA);
  await mustBeWidth(page, 'normal', 'Porada\'s own entry is unaffected');
  assert.equal(((await core.uiState()) as any)?.noteWidth?.[PORADA_ID], 'normal', 'Porada\'s entry still "normal"');
});

// ================================================================================================ FR-UX-01 AC-6

type Measure = { maxWidth: string; pl: string; pr: string; width: number; left: number; right: number; mainWidth: number; dataWidth: string | null };
const measure = (page: Page) => page.evaluate((): Measure | null => {
  const m = document.querySelector('main');
  const col = document.querySelector('main .note-column') as HTMLElement | null;
  if (!m || !col) return null;
  const cs = getComputedStyle(col);
  const r = col.getBoundingClientRect();
  const mr = m.getBoundingClientRect();
  return { maxWidth: cs.maxWidth, pl: cs.paddingLeft, pr: cs.paddingRight, width: r.width, left: r.left - mr.left, right: mr.right - r.right, mainWidth: mr.width, dataWidth: col.getAttribute('data-width') };
});
const near = (a: number, b: number, tol = 1) => Math.abs(a - b) <= tol;

test('fr_ux_01_ac6_measured_widths_at_three_window_widths_with_the_panel_closed_and_open', async ({ page }) => {
  test.setTimeout(150_000);
  await startShell(page, { vault: shellWithTable() });
  await openNote(page, PORADA);
  await needGroup(page, 'Porada');
  const failures: string[] = [];
  const expectWide: Record<string, number> = { '1440 closed': 1208, '1440 open': 920, '2560 closed': 2328, '2560 open': 2040 };
  for (const vw of [1024, 1440, 2560]) {
    await page.setViewportSize({ width: vw, height: 900 });
    await sleep(150);
    for (const open of [false, true]) {
      if ((await seen(panel(page), 300)) !== open) await page.keyboard.press('Meta+Backslash');
      if ((await seen(panel(page), 1000)) !== open) { failures.push(`${vw} ${open ? 'open' : 'closed'}: the panel did not ${open ? 'open' : 'close'}`); continue; }
      await sleep(150);
      const pw = open ? ((await panel(page).boundingBox())?.width ?? 0) : 0;
      if (open && !near(pw, 288)) failures.push(`${vw} open: panel ${pw} px, want 288`);
      const sw = (await sidebar(page).boundingBox())?.width ?? 0;
      if (!near(sw, 232)) failures.push(`${vw}: sidebar ${sw} px, want 232`);
      const label = `${vw} ${open ? 'open' : 'closed'}`;
      const centre = vw - 232 - pw;
      for (const w of ['normal', 'wide'] as const) {
        await choose(page, w === 'wide' ? 'Wide' : 'Normal');
        const st = await widthState(page, w);
        if (st.column !== w) { failures.push(`${label} ${w}: data-width ${st.column}`); continue; }
        await sleep(100);
        const x = await measure(page);
        if (!x) { failures.push(`${label} ${w}: no .note-column`); continue; }
        if (!near(x.mainWidth, centre, 2)) failures.push(`${label}: centre pane ${x.mainWidth} px, want ${centre}`);
        if (w === 'normal') {
          if (x.maxWidth !== '760px') failures.push(`${label} normal: max-width ${x.maxWidth}`);
          if (x.pl !== '40px' || x.pr !== '40px') failures.push(`${label} normal: padding ${x.pl} / ${x.pr}`);
          if (!near(x.width, Math.min(760, x.mainWidth))) failures.push(`${label} normal: width ${x.width}, want min(760, ${x.mainWidth})`);
          if (!near(x.left, x.right)) failures.push(`${label} normal: margins ${x.left} / ${x.right} not equal`);
        } else {
          if (x.maxWidth !== 'none') failures.push(`${label} wide: max-width ${x.maxWidth}`);
          if (x.pl !== '56px' || x.pr !== '56px') failures.push(`${label} wide: padding ${x.pl} / ${x.pr}`);
          if (!near(x.width, x.mainWidth)) failures.push(`${label} wide: width ${x.width}, want the centre pane's ${x.mainWidth}`);
          if (label in expectWide && !near(x.width, expectWide[label])) failures.push(`${label} wide: width ${x.width}, want ${expectWide[label]}`);
        }
      }
    }
    // The panel narrows a Wide column by exactly its width (D-634).
    await choose(page, 'Wide');
    await widthState(page, 'wide');
    if (await seen(panel(page), 300)) await page.keyboard.press('Meta+Backslash');
    await absent(panel(page), 1000); await sleep(100);
    const closed = (await measure(page))?.width ?? 0;
    await page.keyboard.press('Meta+Backslash');
    await must(panel(page), 'panel'); await sleep(100);
    const opened = (await measure(page))?.width ?? 0;
    const pw2 = (await panel(page).boundingBox())?.width ?? 0;
    if (!near(closed - opened, pw2)) failures.push(`${vw}: opening the panel narrows the Wide column by ${closed - opened}, panel ${pw2}`);
    await page.keyboard.press('Meta+Backslash');
    await absent(panel(page), 1000);
  }
  // No horizontal scrollbar in Wide: Porada, and a runtime note with a 12-column table.
  await page.setViewportSize({ width: 1440, height: 900 });
  await choose(page, 'Wide');
  await widthState(page, 'wide');
  const sw1 = await page.evaluate(() => [document.scrollingElement!.scrollWidth, window.innerWidth]);
  if (sw1[0] !== sw1[1]) failures.push(`Porada wide: scrollWidth ${sw1[0]} ≠ viewport ${sw1[1]}`);
  await openNote(page, 'Tabulka');
  await choose(page, 'Wide');
  await widthState(page, 'wide');
  await sleep(200);
  const sw2 = await page.evaluate(() => [document.scrollingElement!.scrollWidth, window.innerWidth]);
  if (sw2[0] !== sw2[1]) failures.push(`12-column table wide: scrollWidth ${sw2[0]} ≠ viewport ${sw2[1]}`);
  assert.deepEqual(failures, [], 'computed widths (FR-UX-01 AC-6)');
});

// ================================================================================================ FR-SYN-06 AC-35

test('fr_syn_06_ac35_zero_vault_writes_from_switching_and_one_file_from_the_setting', async ({ page }) => {
  test.setTimeout(180_000);
  const core = await startShell(page);
  const files0 = await core.files();
  const versions0: Record<string, unknown> = {};
  for (const p of Object.keys(files0)) versions0[p] = await core.version(p);
  const modifiedOf = (fs: Record<string, string>) => Object.fromEntries(Object.entries(fs).map(([p, t]) => [p, /^modified: (.*)$/m.exec(t)?.[1] ?? null]));
  const modified0 = modifiedOf(files0);
  const contexts: [string, () => Promise<void>][] = [
    ['Porada', () => openNote(page, PORADA)],
    ['Bez hlavičky', () => openNote(page, BEZ)],
    [`daily/${TODAY}`, () => cmdD(page, TODAY)],
    ['new/quick-note', async () => { await page.keyboard.press('Meta+n'); await mustBeDraft(page, 'draft'); }],
  ];
  const n0 = (await uiSets(core)).length;
  let expectSets = n0;
  for (const [name, go] of contexts) {
    await go();
    await needGroup(page, name);
    for (let i = 0; i < 10; i++) {
      const target: Radio = i % 2 === 0 ? 'Wide' : 'Normal';
      if (i % 2 === 0) await choose(page, target); // by radio
      else await runCommand(page, `Page width: ${target}`); // by palette command
      await mustBeWidth(page, asWidth(target), `${name}: switch ${i + 1} to ${target}`);
    }
    if (name !== 'new/quick-note') expectSets += 10;
    const sets = await eventually(() => uiSets(core), (c) => c.length >= expectSets, 2000);
    assert.equal(sets.length, expectSets, `${name}: ui_state_set once per effective change (${name === 'new/quick-note' ? 'none for the draft' : '10'})`);
  }
  assert.equal((await uiSets(core)).length - n0, 30, '30 ui_state_set in all');
  assert.deepEqual(await vaultWrites(core), [], 'zero note_write, vault_settings_patch or other write / create commands');
  assert.deepEqual(await nonReadCalls(core), [], 'no other non-read command');
  assert.equal(await core.writes(), 0, 'no vault write');
  const files1 = await core.files();
  assert.deepEqual(files1, files0, 'every file of the fake core\'s vault has the same bytes');
  for (const p of Object.keys(files0)) assert.deepEqual(await core.version(p), versions0[p], `${p}: the same version`);
  assert.deepEqual(modifiedOf(files1), modified0, 'no modified value changed');
  // The setting: one vault_settings_patch and one file per change; the per-note entries untouched.
  const entries = await noteWidthOf(core);
  assert.deepEqual(entries, { [PORADA_ID]: 'normal', [P.bez]: 'normal', [DAILY_PATH]: 'normal' }, 'the three per-note entries after ten switches each');
  await runCommand(page, 'Go to Settings: Vault');
  await mustBeOn(page, 'Settings: Vault', 'settings');
  await needGroup(page, 'settings/vault');
  await choose(page, 'Wide');
  await eventually(() => core.writesTo(), (w) => w.length >= 1, 2000);
  assert.deepEqual(await core.writesTo(), [YML], 'Wide: exactly one file, .tegg/vault.yml');
  assert.equal((await callsOf(core, 'vault_settings_patch')).length, 1, 'one vault_settings_patch');
  await choose(page, 'Normal');
  await eventually(() => core.writesTo(), (w) => w.length >= 2, 2000);
  assert.deepEqual(await core.writesTo(), [YML, YML], 'Normal: one more write of vault.yml only');
  assert.equal((await callsOf(core, 'vault_settings_patch')).length, 2, 'one vault_settings_patch per change');
  assert.deepEqual(await noteWidthOf(core), entries, 'the per-note entries in ui-state.json are untouched by the setting');
});

// ================================================================================================ FR-UX-03 AC-17

test('fr_ux_03_ac17_palette_lists_and_runs_the_width_commands_on_note_routes', async ({ page }) => {
  const core = await startShell(page);
  const listed = async (where: string) => {
    await page.keyboard.press('Meta+k');
    await must(paletteDialog(page), `palette on ${where}`);
    await page.getByRole('combobox', { name: 'Command query' }).fill('Page width');
    await sleep(200);
    const opts = (await paletteOptions(page)).map((o) => o.split('\n')[0].trim());
    await page.keyboard.press('Escape');
    assert.ok(opts.includes('Page width: Normal') && opts.includes('Page width: Wide'), `${where}: the palette lists both width commands (got ${opts.join(' | ') || 'nothing'})`);
  };
  await openNote(page, PORADA);
  await needGroup(page, 'Porada');
  await listed('note/<path>');
  await (await must(titleField(page), 'Title')).focus();
  const n0 = (await uiSets(core)).length;
  await runCommand(page, 'Page width: Wide');
  await mustBeWidth(page, 'wide', 'Page width: Wide from the palette');
  assert.ok(await absent(paletteDialog(page)), 'the palette closes');
  assert.equal((await eventually(() => uiSets(core), (c) => c.length >= n0 + 1, 2000)).length, n0 + 1, 'one ui_state_set');
  assert.deepEqual(await focusName(page), { role: 'textbox', name: 'Title' }, 'the focus returns to the element that had it (D-139)');
  await runCommand(page, 'Page width: Wide');
  await sleep(400);
  assert.equal((await uiSets(core)).length, n0 + 1, 'running the already-effective command changes nothing');
  await mustBeWidth(page, 'wide', 'still wide');
  await runCommand(page, 'Page width: Normal');
  await mustBeWidth(page, 'normal', 'Page width: Normal from the palette');
  await cmdD(page, TODAY);
  await listed(`daily/${TODAY}`);
  await page.keyboard.press('Meta+n');
  await mustBeDraft(page, 'new/quick-note');
  await listed('new/quick-note');
  assert.deepEqual(await vaultWrites(core), [], 'nothing written');
});

test('fr_ux_03_ac17_the_width_commands_do_nothing_on_other_routes', async ({ page }) => {
  const core = await startShell(page);
  // Precondition: the commands exist (listed on a note route); without it "not run elsewhere" would hold vacuously.
  await openNote(page, PORADA);
  await needGroup(page, 'Porada');
  await page.keyboard.press('Meta+k');
  await must(paletteDialog(page), 'palette on Porada');
  await page.getByRole('combobox', { name: 'Command query' }).fill('Page width');
  await sleep(200);
  const onNote = (await paletteOptions(page)).map((o) => o.split('\n')[0].trim());
  await page.keyboard.press('Escape');
  assert.ok(onNote.includes('Page width: Wide') && onNote.includes('Page width: Normal'), `the palette lists both width commands on Porada (got ${onNote.join(' | ') || 'nothing'})`);
  const routes: [string, () => Promise<void>][] = [
    ['home (Inbox, D-614)', async () => { await runCommand(page, 'Go to Inbox'); await mustBeOn(page, 'Inbox', 'Inbox'); }],
    ['tasks', async () => { await runCommand(page, 'Go to Tasks'); await mustBeOn(page, 'Tasks', 'Tasks'); }],
    ['type/page', () => gotoType(page, 'Pages')],
    ['search', async () => { await runCommand(page, 'Go to Search'); await mustBeOn(page, 'Search', 'Search'); }],
    ['settings/vault', async () => { await runCommand(page, 'Go to Settings: Vault'); await mustBeOn(page, 'Settings: Vault', 'Settings: Vault'); }],
  ];
  const failures: string[] = [];
  for (const [name, go] of routes) {
    await go();
    const route = await mainName(page);
    const n0 = (await uiSets(core)).length;
    await page.keyboard.press('Meta+k');
    await must(paletteDialog(page), `palette on ${name}`);
    await page.getByRole('combobox', { name: 'Command query' }).fill('Page width: Wide');
    await settled(page, 'Commands', 'Page width: Wide', 1000);
    const opts = (await paletteOptions(page)).map((o) => o.split('\n')[0].trim());
    if (opts.includes('Page width: Wide')) await page.keyboard.press('Enter'); // listed: running it must do nothing
    else await page.keyboard.press('Escape');
    await sleep(400);
    if ((await uiSets(core)).length !== n0) failures.push(`${name}: ui_state_set was sent`);
    if ((await page.getByRole('alert').count()) > 0) failures.push(`${name}: an error alert`);
    if ((await mainName(page)) !== route) failures.push(`${name}: the route changed to ${await mainName(page)}`);
    if (await seen(paletteDialog(page), 300)) { failures.push(`${name}: the palette stayed open`); await page.keyboard.press('Escape'); }
  }
  assert.deepEqual(failures, [], 'no ui_state_set, no error, the route unchanged (tasks.md R45 rule)');
  assert.deepEqual(await vaultWrites(core), [], 'nothing written');
});

// ================================================================================================ FR-UX-05 AC-12

type Look = { bg: string; color: string; textContrast: number; iconLiterals: string[]; iconCurrent: boolean };
/** Computed look of a radio: effective background (first non-transparent ancestor), text colour, its WCAG contrast,
 *  and the svg's colour attributes. */
const lookOf = (loc: Locator) => loc.first().evaluate((r): Look => {
  const lum = (c: string) => { const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(c); if (!m) return 0; const f = (v: number) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(+m[1]) + 0.7152 * f(+m[2]) + 0.0722 * f(+m[3]); };
  let el: HTMLElement | null = r as HTMLElement; let bg = 'rgba(0, 0, 0, 0)';
  while (el) { const b = getComputedStyle(el).backgroundColor; if (b !== 'rgba(0, 0, 0, 0)' && b !== 'transparent') { bg = b; break; } el = el.parentElement; }
  const color = getComputedStyle(r).color;
  const [l1, l2] = [lum(color), lum(bg)];
  const textContrast = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  const svg = r.querySelector('svg');
  const attrs = svg ? [svg, ...svg.querySelectorAll('*')].flatMap((e) => ['fill', 'stroke', 'color', 'style'].map((a) => e.getAttribute(a) ?? '')) : ['no svg'];
  const iconLiterals = attrs.filter((v) => /#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i.test(v));
  const iconCurrent = !!svg && (svg.getAttribute('stroke') === 'currentColor' || svg.getAttribute('fill') === 'currentColor' || /currentColor/.test(svg.outerHTML));
  return { bg: getComputedStyle(r).backgroundColor, color, textContrast, iconLiterals, iconCurrent };
});
const columnColours = (page: Page) => page.evaluate(() => { const c = document.querySelector('main .note-column'); if (!c) return null; const s = getComputedStyle(c); return [s.color, s.backgroundColor]; });

for (const th of ['light', 'dark'] as const) {
  test(`fr_ux_05_ac12_both_widths_in_every_view_${th}`, async ({ page, context }) => {
    test.setTimeout(180_000);
    await startShell(page, { uiState: ui({ theme: th }) });
    assert.equal(await eventually(() => theme(page), (v) => v === th), th, `theme ${th} applied`);
    await openNote(page, PORADA);
    await needGroup(page, 'Porada');
    const failures: string[] = [];
    const check = async (view: string) => {
      const cols: (string[] | null)[] = [];
      for (const w of ['Normal', 'Wide'] as const) {
        await choose(page, w);
        await widthState(page, asWidth(w));
        await sleep(100);
        for (const v of await axeContrast(page)) failures.push(`${view} ${w}: axe color-contrast ${v}`);
        for (const l of await colourLeaks(page, th)) failures.push(`${view} ${w}: colour leak ${l}`);
        const on = await lookOf(radio(page, w));
        const off = await lookOf(radio(page, w === 'Wide' ? 'Normal' : 'Wide'));
        if (on.bg === off.bg && on.color === off.color) failures.push(`${view} ${w}: the checked radio looks like the unchecked one (bg ${on.bg}, color ${on.color})`);
        if (!(on.textContrast >= 4.5)) failures.push(`${view} ${w}: checked text contrast ${on.textContrast.toFixed(2)} < 4.5`);
        if (on.iconLiterals.length || !on.iconCurrent) failures.push(`${view} ${w}: icon not drawn with currentColor (${on.iconLiterals.join(', ') || 'no currentColor'})`);
        cols.push(await columnColours(page));
      }
      if (JSON.stringify(cols[0]) !== JSON.stringify(cols[1])) failures.push(`${view}: the column's colours change between Normal and Wide (${JSON.stringify(cols)})`);
    };
    await check('edit');
    await page.keyboard.press('Alt+Meta+u');
    await must(page.getByRole('region', { name: 'Markdown source', exact: true }), 'source view');
    await check('source');
    await page.keyboard.press('Alt+Meta+u');
    await must(editorBody(page), 'editor again');
    // The keyboard focus ring on a radio.
    await radio(page, 'Normal').focus();
    await page.keyboard.press('ArrowRight');
    await widthState(page, 'wide');
    const ring = await outlineOfActive(page);
    if (!ring || ring.style === 'none' || ring.width < 2) failures.push(`edit: focused radio outline ${JSON.stringify(ring)} (≥ 2 px)`);
    // The read view (D-215 switch), same state.
    const p2 = await context.newPage();
    await startShell(p2, { uiState: ui({ theme: th }), readView: true });
    await openNote(p2, PORADA);
    await must(p2.getByRole('article', { name: PORADA, exact: true }), 'read view');
    await needGroup(p2, 'read view');
    for (const w of ['Normal', 'Wide'] as const) {
      await click(radio(p2, w), `read view radio ${w}`);
      await widthState(p2, asWidth(w));
      await sleep(100);
      for (const v of await axeContrast(p2)) failures.push(`read ${w}: axe color-contrast ${v}`);
      for (const l of await colourLeaks(p2, th)) failures.push(`read ${w}: colour leak ${l}`);
      const on = await lookOf(radio(p2, w)); const off = await lookOf(radio(p2, w === 'Wide' ? 'Normal' : 'Wide'));
      if (on.bg === off.bg && on.color === off.color) failures.push(`read ${w}: the checked radio looks like the unchecked one`);
    }
    await p2.close();
    // settings/vault
    await runCommand(page, 'Go to Settings: Vault');
    await mustBeOn(page, 'Settings: Vault', 'settings');
    await needGroup(page, 'settings/vault');
    for (const w of ['Wide', 'Normal'] as const) {
      await choose(page, w);
      await eventually(() => checkedName(page), (c) => c === w, 2000);
      await sleep(100);
      for (const v of await axeContrast(page)) failures.push(`settings ${w}: axe color-contrast ${v}`);
      for (const l of await colourLeaks(page, th)) failures.push(`settings ${w}: colour leak ${l}`);
      const on = await lookOf(radio(page, w)); const off = await lookOf(radio(page, w === 'Wide' ? 'Normal' : 'Wide'));
      if (on.bg === off.bg && on.color === off.color) failures.push(`settings ${w}: the checked radio looks like the unchecked one`);
      if (!(on.textContrast >= 4.5)) failures.push(`settings ${w}: checked text contrast ${on.textContrast.toFixed(2)} < 4.5`);
    }
    assert.deepEqual(failures, [], `${th}: FR-UX-05 AC-12`);
  });
}

// ================================================================================================ NFR-OTH-02 AC-9

test('nfr_oth_02_ac9_pseudo_locale_wraps_every_width_string_and_leaves_user_content', async ({ page }) => {
  await startShell(page, { prelude: pseudoLocale });
  await openNote(page, PORADA);
  const g = await must(group(page), 'radiogroup "Page width" (pseudo-locale)');
  const names = await g.evaluate((el) => {
    const nameOf = (e: Element) => e.getAttribute('aria-label') ?? (e.getAttribute('aria-labelledby') ?? '').split(/\s+/).filter(Boolean).map((id) => document.getElementById(id)?.textContent ?? '').join(' ') ?? '';
    return { group: nameOf(el).trim(), radios: [...el.querySelectorAll('[role="radio"]')].map((r) => ({ name: (nameOf(r) || r.textContent || '').trim(), text: (r.textContent ?? '').trim() })) };
  });
  const wrapped = (s: string) => /^⟦.*⟧$/s.test(s);
  assert.ok(wrapped(names.group), `the group's name is wrapped: ${JSON.stringify(names.group)}`);
  assert.deepEqual(names.radios.map((r) => wrapped(r.name) && wrapped(r.text)), [true, true], `the radios' names and visible texts are wrapped: ${JSON.stringify(names.radios)}`);
  await page.keyboard.press('Meta+k');
  await must(paletteDialog(page), 'palette');
  await page.getByRole('combobox', { name: /^⟦?Command query⟧?$/ }).fill('width');
  await sleep(200);
  const rows = (await paletteOptions(page)).map((o) => o.split('\n')[0].trim()).filter((o) => /width/i.test(o.normalize('NFD')));
  assert.equal(rows.length, 2, `the two palette rows (got ${rows.join(' | ') || 'none'})`);
  assert.ok(rows.every(wrapped), `the two palette rows are wrapped: ${rows.join(' | ')}`);
  await page.keyboard.press('Escape');
  // The title field's accessible name is itself a catalog string (`⟦Title⟧` here), so the locator tolerates the wrap.
  const title = await page.getByRole('textbox', { name: /^⟦?Title⟧?$/ }).first().evaluate((e) => (e as HTMLInputElement).value ?? e.textContent ?? '').catch(() => '');
  assert.equal(nfc(title), PORADA, 'the note\'s title stays user content');
  const body = flat(await editorBody(page).first().innerText());
  assert.ok(body.includes('Týdenní porada') && !body.includes('⟦'), `the body stays user content: ${body.slice(0, 60)}`);
  await runCommand(page, '⟦Go to Settings: Vault⟧');
  await mustBeOn(page, '⟦Settings: Vault⟧', 'settings in the pseudo-locale');
  const sg = await must(group(page), 'the Settings row (pseudo-locale)');
  const row = await sg.evaluate((el) => (el.getAttribute('aria-label') ?? (el.getAttribute('aria-labelledby') ?? '').split(/\s+/).filter(Boolean).map((id) => document.getElementById(id)?.textContent ?? '').join(' ')).trim());
  assert.ok(wrapped(row), `the Settings row label is wrapped: ${JSON.stringify(row)}`);
  const desc = await description(sg);
  const descShown = wrapped(desc) || (await seen(main(page).getByText(/^⟦For notes without their own choice\.⟧$/), 1000));
  assert.ok(descShown, `the description is wrapped (described-by: ${JSON.stringify(desc)})`);
  assert.deepEqual(await sg.getByRole('radio').evaluateAll((rs) => rs.map((r) => (r.textContent ?? '').trim())).then((t) => t.map(wrapped)), [true, true], 'the Settings radios are wrapped');
});
