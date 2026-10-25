// Helpers for the MS5 slice 5A-2 WebKit tests (L5): block → object conversion and the Task card. The tasks fixture
// (tests/fixtures/vaults/tasks with the conversion notes) in the fake core, the tasks.md test clock (Wednesday
// 2026-10-14 12:00 Europe/Prague, region cs), locators from docs/acceptance/conversion.md R50…R54 and
// docs/contracts/ms5-tasks.md §11.4…§11.7, and call probes. No AC assertions here except `must` (re-exported), `click`
// and the `need*` lookups, which turn a missing element into an AssertionError instead of a Playwright timeout
// (TS-I1). Written from the ACs and the contracts only (D-61).
import type { Locator, Page } from '@playwright/test';
import assert from 'node:assert/strict';
import type { CallRecord, FakeVault, UiStateDto } from '../ui/test/fake-core';
import { READ_COMMANDS, absent, eventually, mainName, must, mustBeOn, runCommand, seen, settled, sleep, start, type FakeCoreHandle, type StartOptions } from './helpers';
import { tasksVault } from './tasks-helpers';
import {
  embedList, topEmbeds, blockMenu, caretAt, description, displayAsButton, editorBody, embedBody, focusInside, frame, hostBlock, isDisabled, linkEmbed, mergeDialog, nestedEditors,
  openButton, saveState, selectedBlocks, slashMenu, addBelow,
} from './embeds-helpers';
import { goToQuery } from './helpers'; // D-760: the Search page's Go to list replaces ⌘O

export { absent, eventually, mainName, must, mustBeOn, runCommand, seen, sleep };
export { embedList, topEmbeds, blockMenu, caretAt, description, displayAsButton, editorBody, embedBody, focusInside, frame, hostBlock, isDisabled, linkEmbed, mergeDialog, nestedEditors, openButton, saveState, selectedBlocks, slashMenu, addBelow };
export type { CallRecord, FakeCoreHandle, FakeVault };

export const nfc = (s: string) => s.normalize('NFC');
export const nfd = (s: string) => s.normalize('NFD');
export const flat = (s: string | null | undefined) => nfc((s ?? '').replace(/\s+/g, ' ').trim());
export const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The test clock (tasks.md "Test clock"). */
export const NOW = '2026-10-14T12:00:00+02:00';
export const STAMP = '2026-10-01T09:00:00+02:00';
export const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/;

/** Notes of tests/fixtures/vaults/tasks used by conversion.md (README "Conversion notes"). */
export const C = {
  bloky: 'Pages/Bloky.md',
  zasedacka: 'Pages/Zasedačka.md',
  lepidlo: 'Pages/Koupit lepidlo.md',
  nfdHost: 'Pages/NFD host.md',
  crlfHost: 'Pages/CRLF host.md',
  bezHost: 'Pages/Bez hlavičky host.md',
  dvojnikP: 'Pages/Dvojník.md',
  dvojnikQ: 'Quick Notes/Dvojník.md',
  ctips: 'Pages/C tips.md',
  dveKarty: 'Pages/Dvě karty.md',
  obal: 'Pages/Obal.md',
  sablona: '_templates/Page/Page.md',
  porada: 'Pages/Porada.md',
  t01: 'Tasks/Zavolat Janě.md',
} as const;
export const TITLES: Record<string, string> = {
  [C.bloky]: 'Bloky', [C.zasedacka]: 'Zasedačka', [C.lepidlo]: 'Koupit lepidlo', [C.nfdHost]: 'NFD host', [C.crlfHost]: 'CRLF host',
  [C.bezHost]: 'Bez hlavičky host', [C.dvojnikP]: 'Dvojník', [C.dvojnikQ]: 'Dvojník', [C.ctips]: 'C# tips', [C.dveKarty]: 'Dvě karty',
  [C.obal]: 'Obal', [C.sablona]: 'Page', [C.porada]: 'Porada', [C.t01]: 'Zavolat Janě',
};
/** The Bloky paragraph of FR-CNV-02 AC-1 / FR-CNV-03 AC-1 and the task it becomes. */
export const ZAVOLAT = 'Zavolat do servisu kvůli kolu';
export const ZAVOLAT_PARA = `${ZAVOLAT}\na domluvit termín.\n`;
export const ZAVOLAT_TASK = `Tasks/${ZAVOLAT}.md`;

/** The tasks fixture (+ new-empty/.tegg) with the conversion notes. `edit` changes files before start. */
export function convertVault(edit?: (files: Record<string, string>) => void): FakeVault {
  return tasksVault(edit);
}
export const original = (path: string) => convertVault().files[nfc(path)];
export const idOf = (text: string | undefined) => /^id: (\S+)$/m.exec(text ?? '')?.[1] ?? null;
export function swap(text: string | undefined, from: string, to: string): string {
  assert.ok(text !== undefined && text.includes(from), `text contains ${JSON.stringify(from)}`);
  return text!.replace(from, to);
}
/** `modified` replaced in place (D-55): the source note's save at `now`. */
export const touched = (text: string, now = NOW) => text.replace(/^modified: .*$/m, `modified: ${now}`);
export const bodyOf = (text: string | undefined) => (text ?? '').replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '');
export const frontOf = (text: string | undefined) => (text ?? '').slice(0, (text ?? '').length - bodyOf(text).length);
/** A frontmatter value as written (the line after `key: `), or null. */
export const fm = (text: string | undefined, key: string) => new RegExp(`^${esc(key)}: (.*)$`, 'm').exec(text ?? '')?.[1] ?? null;
/** The text with its `id` value checked as a ULID and masked (a new object's id is random). */
export function maskId(text: string | undefined): string {
  const id = idOf(text);
  assert.ok(id && ULID.test(id), `id is a ULID: ${id}`);
  return (text ?? '').replace(/^id: .*$/m, 'id: <id>');
}
/** The FR-CNV-03 AC-1 bytes of a new Task created by a conversion at NOW (id masked). */
export function taskBytes(title: string, o: { status?: string; tags?: string; source: string; completed?: boolean; body?: string; titleYaml?: string }): string {
  return '---\nid: <id>\ntype: task\n'
    + `title: ${o.titleYaml ?? title}\n`
    + `status: ${o.status ?? 'To do'}\n`
    + (o.completed ? `completed: ${NOW}\n` : '')
    + (o.tags ? `tags: ${o.tags}\n` : '')
    + `source: ${o.source}\n`
    + `created: ${NOW}\nmodified: ${NOW}\n---\n${o.body ?? ''}`;
}

export const ui = (o: { theme?: UiStateDto['theme']; convert?: UiStateDto['convert']; panel?: boolean; tasks?: UiStateDto['tasks'] } = {}): UiStateDto =>
  ({ version: 1, theme: o.theme ?? 'light', sidebarOpen: true, rightPanel: { open: o.panel ?? false, tab: 'backlinks' }, ...(o.convert ? { convert: o.convert } : {}), ...(o.tasks ? { tasks: o.tasks } : {}) });

export type ConvertStart = StartOptions & {
  vault?: FakeVault;
  region?: string;
  /** `UiStateDto.convert` at launch (D-493 last type, D-496 skip). Default: absent (first time). */
  convert?: UiStateDto['convert'];
  readView?: boolean;
  theme?: UiStateDto['theme'];
  panel?: boolean;
  /** `UiStateDto.tasks` at launch (the Tasks page's remembered state, ms5-tasks §6.3). */
  tasksUi?: UiStateDto['tasks'];
  /** `false`: the real clock (tests that wait for the app's own timers). */
  clock?: string | false;
  /** Don't wait for the editor (read view, read-only files, Home). */
  noEditor?: boolean;
  /** Start on this route (`window.__TEGG_ROUTE__`, ms3-shell §1 / rename-helpers), e.g. a template's note route. */
  route?: string;
};

/** Starts the app on the tasks vault landing on `at` (D-132) with the test clock, zone (test.use) and region `cs`. */
export async function openConvert(page: Page, at: string | null, o: ConvertStart = {}): Promise<FakeCoreHandle> {
  await page.addInitScript((r) => { (window as any).__TEGG_REGION__ = r; }, o.region ?? 'cs');
  if (o.readView) await page.addInitScript(() => { const w = window as any; w.__TEGG_TEST__ = { ...(w.__TEGG_TEST__ ?? {}), readView: true }; });
  if (o.clock !== false) await page.clock.setFixedTime(new Date(o.clock ?? NOW));
  if (o.route) await page.addInitScript((r) => { (window as any).__TEGG_ROUTE__ = r; }, o.route);
  const vault = o.vault ?? convertVault();
  const last = at ? { path: nfc(at), id: idOf(vault.files[nfc(at)]) } : null;
  const core = await start(page, { vault, last, uiState: ui({ theme: o.theme, convert: o.convert, panel: o.panel, tasks: o.tasksUi }), ...o });
  if (at && TITLES[at]) await mustBeOn(page, TITLES[at], `landing on ${at}`, 5000);
  if (at && !o.noEditor && !o.readView) await must(editorBody(page), `the editor of ${at}`, 5000);
  return core;
}

// ------------------------------------------------------------------------------------------------ R50 popover

export const main = (page: Page) => page.getByRole('main');
export const popover = (page: Page) => page.getByRole('dialog', { name: 'Turn into object', exact: true });
export const titleBox = (page: Page) => popover(page).getByRole('textbox', { name: 'Title', exact: true });
export const typeGroup = (page: Page) => popover(page).getByRole('radiogroup', { name: 'Type', exact: true });
export const typeRadio = (page: Page, name: string) => typeGroup(page).getByRole('radio', { name, exact: true });
export const convertButton = (page: Page) => popover(page).getByRole('button', { name: 'Convert', exact: true });
export const cancelButton = (page: Page) => popover(page).getByRole('button', { name: 'Cancel', exact: true });
export const summary = (page: Page) => popover(page).getByText(/An embed takes their place\.$/);
export const toolbar = (page: Page) => page.getByRole('toolbar', { name: 'Formatting', exact: true });
export const alertWith = (page: Page, text: string) => page.getByRole('alert').filter({ hasText: text });
export const removeDialog = (page: Page) => page.getByRole('alertdialog');

export async function needPopover(page: Page, how: string, ms = 2000): Promise<Locator> {
  return must(popover(page), `${how}: dialog "Turn into object" (R50)`, ms);
}
/** The radio names of the `Type` radiogroup, in order. */
export async function typeNames(page: Page): Promise<string[]> {
  await must(typeGroup(page), 'radiogroup "Type"');
  return (await typeGroup(page).getByRole('radio').evaluateAll((rs) => rs.map((r) => r.getAttribute('aria-label') ?? (r as HTMLElement).innerText ?? ''))).map(flat);
}
/** The checked radio's name, or null. */
export async function checkedType(page: Page): Promise<string | null> {
  if (!(await seen(typeGroup(page), 2000))) return null;
  const all = await typeGroup(page).getByRole('radio').evaluateAll((rs) => rs.map((r) => ({
    name: r.getAttribute('aria-label') ?? (r as HTMLElement).innerText ?? '', on: r.getAttribute('aria-checked') === 'true' || (r as HTMLInputElement).checked === true,
  })));
  return flat(all.find((r) => r.on)?.name ?? '') || null;
}
/** The title field's value and whether all of it is selected. */
export async function titleState(page: Page): Promise<{ value: string; allSelected: boolean; focused: boolean }> {
  const t = await must(titleBox(page), 'textbox "Title" (R50)');
  return t.evaluate((e) => {
    const i = e as HTMLInputElement;
    const v = i.value ?? e.textContent ?? '';
    return { value: v.normalize('NFC'), allSelected: i.selectionStart === 0 && i.selectionEnd === v.length, focused: document.activeElement === e };
  });
}
/** Clicks an element after asserting it is shown and enabled. */
export async function click(loc: Locator, what: string, ms = 3000) {
  const el = await must(loc, what, ms);
  const off = await el.evaluate((e) => (e as HTMLButtonElement).disabled === true || e.getAttribute('aria-disabled') === 'true');
  assert.equal(off, false, `${what} is enabled`);
  await el.click();
}

// ------------------------------------------------------------------------------------------------ caret and entry points

/** Opens a note through the Search page's Go to list (D-760; before it the ⌘O switcher): asserts the switcher, types `title`, ⏎ (the caller checks the page). */
export async function switchTo(page: Page, title: string) {
  await goToQuery(page, title);
  await page.keyboard.press('Enter');
}
/** Caret after the first occurrence of `text` in the host editor (any block, list items included). */
export async function caretAfter(page: Page, text: string) {
  assert.ok(await caretAt(editorBody(page), text), `caret placed after "${text}"`);
}
/** Selects `text` (first occurrence) in the host editor as a text selection. */
export async function selectText(page: Page, text: string, to?: string) {
  const ok = await editorBody(page).first().evaluate((root, [a, b]) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const find = (t: string): [Text, number] | null => {
      walker.currentNode = root;
      for (let x = walker.nextNode(); x; x = walker.nextNode()) { const i = (x as Text).data.normalize('NFC').indexOf(t); if (i >= 0) return [x as Text, i]; }
      return null;
    };
    const s = find(a as string);
    const e = b ? find(b as string) : s;
    if (!s || !e) return false;
    (root as HTMLElement).focus();
    const r = document.createRange();
    r.setStart(s[0], s[1]);
    r.setEnd(e[0], e[1] + (b ? (b as string).length : (a as string).length));
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(r);
    document.dispatchEvent(new Event('selectionchange'));
    return true;
  }, [nfc(text), to ? nfc(to) : null] as const).catch(() => false);
  assert.ok(ok, `text selection "${text}"${to ? ` … "${to}"` : ''}`);
  await sleep(100);
}
/** Block selection (FR-EDT-13): Esc on the caret's block, then ⇧↓ `extend` times. */
export async function selectBlocks(page: Page, firstText: string, extend: number): Promise<number[]> {
  await caretAfter(page, firstText);
  await page.keyboard.press('Escape');
  for (let i = 0; i < extend; i++) await page.keyboard.press('Shift+ArrowDown');
  await sleep(100);
  return selectedBlocks(page);
}
/** Selects the host's top-level block `n` (1-based) when it is an embed (FR-EMB-02 AC-14): ↓ from the end of the
 *  block before it, else ↑ from the start of the block after it, else a click on its edge. Returns the selected blocks. */
export async function selectTop(page: Page, n: number): Promise<number[]> {
  const kids = editorBody(page).locator(':scope > *');
  assert.ok(await seen(kids.nth(n - 1), 5000), `host block ${n}`);
  const count = await kids.count();
  if (n > 1 && (await caretAt(kids.nth(n - 2), null))) {
    await page.keyboard.press('ArrowDown');
    await sleep(100);
    const sel = await selectedBlocks(page);
    if (sel.length === 1 && sel[0] === n) return sel;
  }
  if (n < count && (await caretAt(kids.nth(n), null, true))) {
    await page.keyboard.press('ArrowUp');
    await sleep(100);
    const sel = await selectedBlocks(page);
    if (sel.length === 1 && sel[0] === n) return sel;
  }
  await kids.nth(n - 1).click({ position: { x: 3, y: 3 } }).catch(() => {});
  await sleep(100);
  return selectedBlocks(page);
}
/** The index (1-based) of the host's top-level block whose text contains `text`, or 0. */
export async function topIndexOf(page: Page, text: string): Promise<number> {
  return editorBody(page).first().evaluate((b, t) => [...b.children].findIndex((e) => ((e as HTMLElement).innerText ?? '').normalize('NFC').includes(t as string)) + 1, nfc(text)).catch(() => 0);
}

/** ⇧⌘T (or ⇧⌘O) with the caret after `text`, then waits for R50. */
export async function popoverAt(page: Page, text: string, key: 'Meta+Shift+t' | 'Meta+Shift+o' = 'Meta+Shift+t'): Promise<Locator> {
  await caretAfter(page, text);
  await page.keyboard.press(key);
  return needPopover(page, `${key} after "${text}"`);
}
/** One full conversion: ⇧⌘T (or ⇧⌘O) on the block holding `text`, optional title and type, then ⏎ / Convert. */
export async function convertAt(page: Page, text: string, o: { key?: 'Meta+Shift+t' | 'Meta+Shift+o'; title?: string; type?: string } = {}) {
  await popoverAt(page, text, o.key ?? 'Meta+Shift+t');
  await confirm(page, o);
}
/** In an open R50: types the title (when given), picks the type (when given), then Convert. */
export async function confirm(page: Page, o: { title?: string; type?: string } = {}) {
  if (o.title !== undefined) await (await must(titleBox(page), 'textbox "Title"')).fill(o.title);
  if (o.type) await click(typeRadio(page, o.type), `radio "${o.type}"`);
  if (o.type) await click(convertButton(page), 'button "Convert"');
  else {
    await (await must(titleBox(page), 'textbox "Title"')).focus();
    await page.keyboard.press('Enter');
  }
  assert.ok(await absent(popover(page), 3000), 'R50 closes after Convert');
}

// ------------------------------------------------------------------------------------------------ R52 Task card

/** The D-74 card: the R30 frame `Embedded: <title>` with `data-task-card`. */
export const taskCard = (scope: Locator, title: string) => frame(scope, title).and(scope.page().locator('[data-task-card]'));
export async function needCard(scope: Locator, title: string, what = `Task card "${title}"`, n = 0, ms = 5000): Promise<Locator> {
  const l = taskCard(scope, title);
  assert.ok(await seen(l, ms), `${what} (frame with data-task-card) is not shown`);
  const c = await l.count();
  assert.ok(c > n, `${what}: instance ${n + 1} of ${c}`);
  return l.nth(n);
}
export const cardCheckbox = (card: Locator, title: string) => card.getByRole('checkbox', { name: new RegExp(`^(Complete "${esc(title)}"|Mark "${esc(title)}" not done)$`) });
export const statusButton = (card: Locator) => card.getByRole('button', { name: /^Status: / });
export const priorityButton = (card: Locator) => card.getByRole('button', { name: /^Priority: / });
export const dueButton = (card: Locator) => card.getByRole('button', { name: /^Due: / });
export const menuItem = (page: Page, name: string) => page.getByRole('menuitemradio', { name, exact: true }).or(page.getByRole('menuitem', { name, exact: true }));
export async function nameOf(loc: Locator): Promise<string> {
  await must(loc, 'control');
  return flat(await loc.first().evaluate((e) => e.getAttribute('aria-label') ?? (e as HTMLElement).innerText ?? ''));
}
/** The accessible names of the header controls of a card that the Tab key reaches, in Tab order from the card. */
export async function tabOrder(page: Page, card: Locator, n: number): Promise<string[]> {
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    await page.keyboard.press('Tab');
    out.push(flat(await page.evaluate(() => {
      const a = document.activeElement as HTMLElement | null;
      return a ? (a.getAttribute('aria-label') ?? a.innerText ?? '') : '';
    })));
  }
  return out;
}

// ------------------------------------------------------------------------------------------------ calls and files

/** Read-only commands (helpers.ts READ_COMMANDS covers 3A…5A-1, `embed_load`, `task_list`, `daily_tasks`). */
export const CONVERT_READS = new Set([...READ_COMMANDS]);
export const pathArg = (c: CallRecord) => nfc(String((c.args as any)?.path ?? ''));
/** Every call that isn't a read, in order, as `cmd path` (note_create / daily_create: the path it returned; failed
 *  calls marked `!`). */
export async function writeLog(core: FakeCoreHandle): Promise<string[]> {
  return (await core.calls()).filter((c) => !CONVERT_READS.has(c.cmd) && !c.cmd.startsWith('plugin:')).map((c) => {
    const r = c.result as any;
    const p = c.cmd === 'note_create' || c.cmd === 'daily_create' ? nfc(String(typeof r === 'string' ? r : r?.path ?? '')) : pathArg(c);
    return `${c.cmd}${c.ok === false ? '!' : ''} ${p}`.trim();
  });
}
export async function callsOf(core: FakeCoreHandle, cmd: string): Promise<CallRecord[]> {
  return (await core.calls()).filter((c) => c.cmd === cmd);
}
export async function writesOf(core: FakeCoreHandle, path: string): Promise<CallRecord[]> {
  return (await callsOf(core, 'note_write')).filter((c) => pathArg(c) === nfc(path));
}
export async function fileText(core: FakeCoreHandle, path: string): Promise<string | undefined> {
  return (await core.files())[nfc(path)];
}
export async function fileWhen(core: FakeCoreHandle, path: string, ok: (t: string | undefined) => boolean, ms = 3000): Promise<string | undefined> {
  return eventually(() => fileText(core, path), ok, ms);
}
/** Waits for the file to exist and returns it (asserting it does). */
export async function needFile(core: FakeCoreHandle, path: string, ms = 3000): Promise<string> {
  const t = await fileWhen(core, path, (x) => x !== undefined, ms);
  assert.ok(t !== undefined, `${path} is created`);
  return t!;
}
/** Paths present now that the fixture doesn't have, sorted. */
export async function newPaths(core: FakeCoreHandle, base: FakeVault = convertVault()): Promise<string[]> {
  const now = await core.files();
  return Object.keys(now).filter((p) => base.files[p] === undefined).sort();
}
/** Paths whose text differs from the fixture (created, changed or deleted), sorted. */
export async function changedPaths(core: FakeCoreHandle, base: FakeVault = convertVault()): Promise<string[]> {
  const now = await core.files();
  return [...new Set([...Object.keys(now), ...Object.keys(base.files)])].filter((p) => now[p] !== base.files[p]).sort();
}
/** The host editor's current text (`__TEGG_TEST__.editor.text()`, ms3-shell §13.6), or null. */
export async function hostText(page: Page): Promise<string | null> {
  return page.evaluate(() => ((window as any).__TEGG_TEST__?.editor?.text?.() as string | undefined) ?? null).catch(() => null);
}
/** Waits for `Save state` to read `Saved` and for the file to satisfy `ok`. */
export async function saved(page: Page, core: FakeCoreHandle, path: string, ok: (t: string | undefined) => boolean, ms = 3000): Promise<string | undefined> {
  await sleep(100);
  await eventually(async () => flat(await saveState(page).first().innerText({ timeout: 200 }).catch(() => '')), (t) => t === 'Saved', ms);
  return fileWhen(core, path, ok, ms);
}
/** The embed targets (`![[…]]` values) of a text, in order. */
export const embedTargets = (text: string | undefined) => [...(text ?? '').matchAll(/!\[\[([^\]]+)\]\]/g)].map((m) => nfc(m[1]));
