// Helpers for the slice I2 WebKit tests (L5): the Import window over the fake core (docs/contracts/v1-import-window.md
// §7), canned answers from tests/fixtures/import/window/, the test clock and region of docs/acceptance/import-capacities.md,
// locators from §3 (R151…R155) and probes of the window, the status element and the fake's import log. No AC assertions
// here except `must`, `click` and the handle guards, which turn a missing element or a missing fake hook into an
// AssertionError instead of a Playwright timeout or a TypeError (TS-I1).
//
// Assumptions where the contract leaves the test interface open (listed in the red-test report):
// - the fake's options (§7.2 `FakeImportOptions`) are passed as `FakeOptions.import`;
// - a canned file is named with its extension (`{ scan: 'scan-c01-spaces.json' }`, `plans: { 'PKM|newVault': 'plan-…json' }`,
//   `where: 'where-osobni.json'`), as `loadImportFixture(name)` reads it;
// - the generated canned files are named `scan-<fixture>.json`, `scan-c01-spaces-zip.json` (the zipped scan) and
//   `plan-<fixture>-<space>-<new|existing>.json` (crates/tegg-import/tests/ac_import_window_fixtures.rs).
import type { Locator, Page } from '@playwright/test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { newEmptyVault, type FakeCoreHandle, type FakeVault, type UiStateDto } from '../ui/test/fake-core';
import { absent, callsOf, click, description, eventually, flat, focusName, isDisabled, main, must, nfc, runCommand, seen, sleep, textOf } from './capture-helpers';
import { READ_COMMANDS, box, catalogText, paletteDialog, paletteOptions, pseudoLocale, start, type StartOptions } from './helpers';

export { absent, box, callsOf, catalogText, click, description, eventually, flat, focusName, isDisabled, main, must, nfc, paletteDialog, paletteOptions, runCommand, seen, sleep, textOf };
export type { FakeCoreHandle, FakeVault };

export const REPO = resolve(import.meta.dirname, '../..');
const WINDOW = resolve(REPO, 'tests/fixtures/import/window');

/** The test clock of import-capacities.md: 12 Nov 2026, 10:00 in Prague, region `cs`. */
export const NOW = '2026-11-12T10:00:00+01:00';
export const REPORT_DATE = '2026-11-12';

// ------------------------------------------------------------------------------------------------ §2, §7 types

export type ImportErrorDto = { code: string; [k: string]: unknown };
export type NewVaultDto = { parent: string; name: string; path: string; display: string; problem: string | null };
export type WhereDto = { newVault: NewVaultDto; current: { name: string; path: string; notes: number; alreadyImported: number } | null };
export type TargetTypeDto = {
  key: string; name: string; plural: string; system: boolean;
  attributes: { key: string; name: string; type: string }[];
  statuses: { label: string; state: 'open' | 'in progress' | 'done' | 'cancelled' }[] | null;
};
export type FakeImportOptions = {
  sources?: Record<string, { scan: string } | { error: 'NotCapacities' | 'UnreadableArchive' | 'EncryptedArchive' | 'Empty' | 'SourceGone' }>;
  plans?: Record<string, string>;
  where?: string | WhereDto;
  targetTypes?: TargetTypeDto[];
  pickFile?: string | null;
  pickSourceDir?: string | null;
  taken?: string[];
  free?: number | null;
};
export type FakeImportHandle = {
  importCalls(): Promise<{ cmd: string; args: unknown }[]>;
  importPace(ms: number): Promise<void>;
  importHold(at: 'reading' | 'planning' | 'queued' | 'backup' | 'writing' | null): Promise<void>;
  importRelease(): Promise<void>;
  importFail(f: { at: 'scan' | 'plan' | 'start' | 'backup' | 'writing'; error: ImportErrorDto } | null): Promise<void>;
  importQueued(on: boolean): Promise<void>;
};

/** A canned file of tests/fixtures/import/window/ as JSON. A missing file is an assertion (the generated files come
 *  with the implementation, §7.1). */
export function canned<T = any>(name: string): T {
  const p = join(WINDOW, name);
  assert.ok(existsSync(p), `tests/fixtures/import/window/${name} exists (v1-import-window §7.1)`);
  return JSON.parse(readFileSync(p, 'utf8')) as T;
}

// ------------------------------------------------------------------------------------------------ the fake's import hooks (§7.2)

function hook<K extends keyof FakeImportHandle>(core: FakeCoreHandle, k: K): FakeImportHandle[K] {
  const f = (core as unknown as Partial<FakeImportHandle>)[k];
  assert.equal(typeof f, 'function', `the fake core's handle has ${k} (v1-import-window §7.2)`);
  return f as FakeImportHandle[K];
}
export const importCalls = (core: FakeCoreHandle) => hook(core, 'importCalls')();
export const importPace = (core: FakeCoreHandle, ms: number) => hook(core, 'importPace')(ms);
export const importHold = (core: FakeCoreHandle, at: Parameters<FakeImportHandle['importHold']>[0]) => hook(core, 'importHold')(at);
export const importRelease = (core: FakeCoreHandle) => hook(core, 'importRelease')();
export const importFail = (core: FakeCoreHandle, f: Parameters<FakeImportHandle['importFail']>[0]) => hook(core, 'importFail')(f);
export const importQueued = (core: FakeCoreHandle, on: boolean) => hook(core, 'importQueued')(on);
/** The `import_*` calls of one command, in order. */
export async function importCallsOf(core: FakeCoreHandle, cmd: string): Promise<any[]> {
  return (await importCalls(core)).filter((c) => c.cmd === cmd).map((c) => c.args);
}
/** `emit` with the names §7.3 widens it to (`import:open`, `app:quit-requested`). */
export async function emit(core: FakeCoreHandle, event: 'import:open' | 'app:quit-requested', payload: unknown = null): Promise<void> {
  await (core.emit as (e: string, p: unknown) => Promise<void>)(event, payload);
}

/** The window's commands that write nothing (§2.1): everything but `import_start`. */
export const IMPORT_READS = new Set(['import_pick_source', 'import_scan', 'import_cancel', 'import_where', 'import_check_target', 'import_plan', 'import_status', 'import_discard', 'import_transform_result']);
/** IPC calls that may write: every call but the shell's reads, the window's reads and events (FR-SYN-06 AC-45). */
export async function writeCalls(core: FakeCoreHandle): Promise<string[]> {
  return (await core.calls()).map((c) => c.cmd).filter((c) => !READ_COMMANDS.has(c) && !IMPORT_READS.has(c) && !c.startsWith('plugin:event|'));
}

// ------------------------------------------------------------------------------------------------ vaults and canned sources

export const DL = '/fake/home/Downloads';
export const C01_ZIP = `${DL}/c01-spaces.zip`;
export const C01_DIR = `${DL}/c01-spaces`;
export const C12_DIR = `${DL}/c12-task-dates`;
export const C09_DIR = `${DL}/c09-unresolved-links`;
export const C0507_DIR = `${DL}/c05+c07`;
export const BOARD_ZIP = `${DL}/Capacities export.zip`;
export const DECISIONS_DIR = `${DL}/Rozhodnutí`;
export const BROKEN_ZIP = `${DL}/Poškozený export.zip`;
export const OSOBNI_PATH = '/fake/home/Documents/Osobní';

/** c01-spaces as a zip (`Choose zip…`) and as a folder (`Choose folder…`), with its four canned plans. */
export const C01 = (o: FakeImportOptions = {}): FakeImportOptions => ({
  pickFile: C01_ZIP, pickSourceDir: C01_DIR,
  sources: { [C01_ZIP]: { scan: 'scan-c01-spaces-zip.json' }, [C01_DIR]: { scan: 'scan-c01-spaces.json' } },
  plans: {
    'PKM|newVault': 'plan-c01-spaces-PKM-new.json', 'Work|newVault': 'plan-c01-spaces-Work-new.json', 'IDC|newVault': 'plan-c01-spaces-IDC-new.json',
    'PKM|existing': 'plan-c01-spaces-PKM-existing.json',
  },
  ...o,
});
/** The board's export (one space PKM) with plan-board.json for `This vault` (Osobní) and where-osobni.json. */
export const BOARD = (o: FakeImportOptions = {}): FakeImportOptions => ({
  pickFile: BOARD_ZIP, sources: { [BOARD_ZIP]: { scan: 'scan-board.json' } },
  plans: { 'PKM|existing': 'plan-board.json', 'PKM|newVault': 'plan-c01-spaces-PKM-new.json' }, where: 'where-osobni.json', targetTypes: OSOBNI_TYPES,
  ...o,
});
/** FR-IMP-10 AC-13's plan (3 case-only links, 2 ambiguous), one space PKM, a new vault. */
export const DECISIONS = (o: FakeImportOptions = {}): FakeImportOptions => ({
  pickSourceDir: DECISIONS_DIR, sources: { [DECISIONS_DIR]: { scan: 'scan-decisions.json' } }, plans: { 'PKM|newVault': 'plan-decisions.json' }, ...o,
});
/** c09-unresolved-links (the tag-like `Trip.status`), one space, a new vault. */
export const C09 = (o: FakeImportOptions = {}): FakeImportOptions => ({
  pickSourceDir: C09_DIR, sources: { [C09_DIR]: { scan: 'scan-c09-unresolved-links.json' } }, plans: { 'PKM|newVault': 'plan-c09-unresolved-links-PKM-new.json' }, ...o,
});
/** c12-task-dates, one space, a new vault. */
export const C12 = (o: FakeImportOptions = {}): FakeImportOptions => ({
  pickSourceDir: C12_DIR, sources: { [C12_DIR]: { scan: 'scan-c12-task-dates.json' } }, plans: { 'PKM|newVault': 'plan-c12-task-dates-PKM-new.json' }, ...o,
});
/** c05-media-objects + c07-query-shells merged into one space PKM (FR-IMP-05 AC-9), new and existing. */
export const C0507 = (o: FakeImportOptions = {}): FakeImportOptions => ({
  pickSourceDir: C0507_DIR, sources: { [C0507_DIR]: { scan: 'scan-c05+c07.json' } },
  plans: { 'PKM|newVault': 'plan-c05+c07-PKM-new.json', 'PKM|existing': 'plan-c05+c07-PKM-existing.json' }, ...o,
});

const sys = (key: string, name: string, plural: string, attributes: TargetTypeDto['attributes'] = [], statuses: TargetTypeDto['statuses'] = null): TargetTypeDto =>
  ({ key, name, plural, system: true, attributes, statuses });
const user = (key: string, name: string, plural: string, attributes: TargetTypeDto['attributes'] = []): TargetTypeDto =>
  ({ key, name, plural, system: false, attributes, statuses: null });
/** The types of the board's vault `Osobní` (Page, Task, Daily Note, Meeting, Project, Idea, and the other system types). */
export const OSOBNI_TYPES: TargetTypeDto[] = [
  sys('page', 'Page', 'Pages'),
  sys('task', 'Task', 'Tasks', [
    { key: 'status', name: 'Status', type: 'select' }, { key: 'priority', name: 'Priority', type: 'select' }, { key: 'due', name: 'Due date', type: 'date' },
    { key: 'completed', name: 'Completed', type: 'date-time' }, { key: 'people', name: 'Assignees', type: 'relation' },
  ], [
    { label: 'To do', state: 'open' }, { label: 'In progress', state: 'in progress' }, { label: 'Waiting', state: 'open' }, { label: 'Done', state: 'done' },
    { label: 'Cancelled', state: 'cancelled' },
  ]),
  sys('quick-note', 'Quick Note', 'Quick Notes'), sys('daily-note', 'Daily Note', 'Daily Notes', [{ key: 'date', name: 'Date', type: 'date' }]),
  sys('tag', 'Tag', 'Tags'), sys('image', 'Image', 'Images', [{ key: 'file', name: 'File', type: 'file' }]), sys('pdf', 'PDF', 'PDFs', [{ key: 'file', name: 'File', type: 'file' }]),
  user('meeting', 'Meeting', 'Meetings', [{ key: 'date', name: 'Date', type: 'date' }, { key: 'attendees', name: 'Attendees', type: 'relation' }]),
  user('project', 'Project', 'Projects', [{ key: 'status', name: 'Status', type: 'select' }]),
  user('idea', 'Idea', 'Ideas'),
];
const typeFile = (key: string, name: string, plural: string) =>
  `version: 1\nname: ${name}\nplural: ${plural}\nsystem: false\nfolder: ${plural}\nicon: file-text\ncolor: gray\nreview: false\npreview: []\nattributes: []\n`;
/** The vault `Osobní` (new-empty plus Meeting, Project, Idea and two notes). */
export function osobniVault(): FakeVault {
  const v = newEmptyVault('Osobní');
  v.files['.tegg/types/meeting.yml'] = typeFile('meeting', 'Meeting', 'Meetings');
  v.files['.tegg/types/project.yml'] = typeFile('project', 'Project', 'Projects');
  v.files['.tegg/types/idea.yml'] = typeFile('idea', 'Idea', 'Ideas');
  v.files['Pages/Čtenářský deník.md'] = '---\nid: 01JB5W00000000000000000001\ntype: page\ntitle: Čtenářský deník\ncreated: 2026-10-01T09:00:00+02:00\nmodified: 2026-10-01T09:00:00+02:00\n---\nPoznámky o knihách.\n';
  v.files['Meetings/Porada týmu.md'] = '---\nid: 01JB5W00000000000000000002\ntype: meeting\ntitle: Porada týmu\ncreated: 2026-10-02T09:00:00+02:00\nmodified: 2026-10-02T09:00:00+02:00\n---\nZápis.\n';
  return v;
}

// ------------------------------------------------------------------------------------------------ start

export type StartImport = StartOptions & {
  imports?: FakeImportOptions;
  region?: string;
  theme?: UiStateDto['theme'];
  reducedMotion?: 'reduce' | 'no-preference';
  pseudo?: boolean;
  route?: string;
};
const ui = (theme: UiStateDto['theme'] = 'light'): UiStateDto =>
  ({ version: 1, theme, sidebarOpen: true, rightPanel: { open: false, tab: 'backlinks' }, propertiesOpen: true, preview: { mode: 'off' } } as UiStateDto);

/** Starts the main window (the shell fixture `Trezor` unless `vault` is given; `vault: null` opens the chooser), region
 *  `cs`, the fake's import options as `FakeOptions.import`. */
export async function startImport(page: Page, o: StartImport = {}): Promise<FakeCoreHandle> {
  await page.addInitScript((r) => { (window as any).__TEGG_REGION__ = r; }, o.region ?? 'cs');
  if (o.route) await page.addInitScript((r) => { (window as any).__TEGG_ROUTE__ = r; }, o.route);
  if (o.reducedMotion) await page.emulateMedia({ reducedMotion: o.reducedMotion });
  const prelude = o.pseudo ? pseudoLocale : undefined;
  const opts = { ...o, ...(prelude ? { prelude } : {}), uiState: o.uiState ?? ui(o.theme), previewStored: 'asGiven', import: o.imports ?? {} } as StartOptions;
  return start(page, opts);
}
/** Starts on the vault Osobní (FR-HIS-04 AC-14's open vault) with the board's canned answers. */
export async function startOsobni(page: Page, o: StartImport = {}): Promise<FakeCoreHandle> {
  return startImport(page, { vault: osobniVault(), vaultPath: OSOBNI_PATH, ...o, imports: o.imports ?? BOARD() });
}

// ------------------------------------------------------------------------------------------------ §3.2 locators

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** A catalog text, also under the pseudo-locale (`⟦…⟧`). */
export const rx = (s: string) => new RegExp(`^⟦?${esc(nfc(s))}⟧?$`);
/** Starts with `s` (an accessible name with more after it). */
export const rxStart = (s: string) => new RegExp(`^⟦?${esc(nfc(s))}`);
export const dialog = (page: Page) => page.locator('div[role="dialog"][data-import-step]');
export const heading = (page: Page) => dialog(page).locator('h2').first();
export const stepper = (page: Page) => dialog(page).getByRole('group', { name: /^⟦?Step \d of 6⟧?$/ });
export const footer = (page: Page) => dialog(page).locator('.import-footer');
export const cmd = (page: Page, command: string) => dialog(page).locator(`button[data-command="${command}"]`);
export const continueBtn = (page: Page) => cmd(page, 'import.continue');
export const backBtn = (page: Page) => cmd(page, 'import.back');
export const cancelBtn = (page: Page) => cmd(page, 'import.cancel');
export const hideBtn = (page: Page) => cmd(page, 'import.hide');
export const closeBtn = (page: Page) => cmd(page, 'import.close');
export const importBtn = (page: Page) => cmd(page, 'import.start');
export const footerNamed = (page: Page, name: string) => footer(page).getByRole('button', { name: rx(name) });
export const alertBox = (page: Page) => dialog(page).getByRole('alert');
export const liveRegion = (page: Page) => page.locator('div.sr-live[role="status"]');
export const radiogroup = (page: Page, name: string) => dialog(page).getByRole('radiogroup', { name: rx(name) });
export const radios = (page: Page, group: string) => radiogroup(page, group).getByRole('radio');
export const radioStarting = (page: Page, group: string, name: string) => radiogroup(page, group).getByRole('radio', { name: rxStart(name) });
export const dropArea = (page: Page) => dialog(page).locator('div.import-drop');
export const sourceRow = (page: Page) => dialog(page).locator('div.import-source');
export const progressbar = (page: Page) => dialog(page).getByRole('progressbar', { name: rx('Reading the export') });
export const nameField = (page: Page) => radiogroup(page, 'Destination').locator('input').first();
export const typesTable = (page: Page) => dialog(page).getByRole('table');
export const typeRow = (page: Page, folder: string) => typesTable(page).getByRole('row').filter({ has: page.getByRole('cell').filter({ hasText: new RegExp(`^${esc(nfc(folder))}\\b`) }) }).first();
export const targetButton = (row: Locator) => row.locator('button[aria-haspopup="menu"]').first();
export const statusButton = (row: Locator) => row.locator('button[data-command="import.mapAttributes"]');
export const menuNamed = (page: Page, name: string) => page.getByRole('menu', { name: rx(name) });
export const attrRow = (page: Page, key: string) => dialog(page).locator(`li[data-attr="${key}"]`);
export const phaseItem = (page: Page, phase: string) => dialog(page).locator(`li[data-phase="${phase}"]`);
export const statusElement = (page: Page) => page.locator('span.import-status[role="status"]');
export const statusOpen = (page: Page) => statusElement(page).locator('button[data-command="import.open"]');
export const quitDialog = (page: Page) => page.getByRole('dialog', { name: rx('An import is running. Quit anyway?') });

// ------------------------------------------------------------------------------------------------ probes

export async function stepNow(page: Page): Promise<string | null> {
  return dialog(page).first().getAttribute('data-import-step', { timeout: 300 }).catch(() => null);
}
/** Waits until the window shows step `s` (`data-import-step`) and asserts it. */
export async function mustStep(page: Page, s: string, what: string, ms = 5000): Promise<void> {
  const got = await eventually(() => stepNow(page), (x) => x === s, ms);
  assert.equal(got, s, `${what}: the window is on step ${s}`);
}
/** Asserts the window is closed. */
export async function mustBeClosed(page: Page, what: string, ms = 3000): Promise<void> {
  assert.ok(await absent(dialog(page), ms), `${what}: the Import window is closed`);
}
export async function headingText(page: Page): Promise<string> {
  return textOf(heading(page), 3000);
}
/** The stepper's name and its items: `[label, 'current' | 'done' | '']`. */
export async function stepperInfo(page: Page): Promise<{ name: string; items: [string, string][]; hidden: boolean[] }> {
  const s = await must(stepper(page), 'the stepper (group "Step <n> of 6")');
  return s.evaluate((g) => ({
    name: (g.getAttribute('aria-label') ?? '').trim(),
    items: [...g.querySelectorAll(':scope > span')].filter((e) => (e.textContent ?? '').trim()).map((e) => [
      (e.textContent ?? '').trim(), e.hasAttribute('data-current') ? 'current' : e.hasAttribute('data-done') ? 'done' : '',
    ] as [string, string]),
    hidden: [...g.querySelectorAll(':scope > span')].map((e) => e.getAttribute('aria-hidden') === 'true'),
  }));
}
/** Waits until a control is enabled (not `aria-disabled`, not `disabled`). */
export async function enabledSoon(loc: Locator, what: string, ms = 5000): Promise<void> {
  await must(loc, what, ms);
  const off = await eventually(() => isDisabled(loc), (d) => !d, ms);
  assert.equal(off, false, `${what} becomes enabled`);
}
/** Focus, then a key: keyboard activation of a control (no pointer). */
export async function pressOn(loc: Locator, key: string, what: string): Promise<void> {
  const el = await must(loc, what);
  await el.focus();
  await el.press(key);
}
/** The phase list of step 6: `[phase, state, text]` in DOM order. */
export async function phases(page: Page): Promise<{ phase: string; state: string; text: string; label: string }[]> {
  return dialog(page).evaluate((d) => [...d.querySelectorAll('li[data-phase]')].map((li) => ({
    phase: li.getAttribute('data-phase') ?? '', state: li.getAttribute('data-state') ?? '',
    text: ((li as HTMLElement).innerText ?? '').replace(/\s+/g, ' ').trim(),
    label: (li.getAttribute('aria-label') ?? '').replace(/\s+/g, ' ').trim(),
  }))).catch(() => []);
}
/** The rows of step 4a: the cells' texts per row (header row excluded). */
export async function typeRows(page: Page): Promise<string[][]> {
  return typesTable(page).evaluate((t) => [...t.querySelectorAll('[role="row"], tr')].filter((r) => !r.querySelector('[role="columnheader"], th'))
    .map((r) => [...r.querySelectorAll('[role="cell"], td')].map((c) => ((c as HTMLElement).innerText ?? '').replace(/\s+/g, ' ').trim()))).catch(() => []);
}
/** A menu's items: role, accessible name (aria-label or text), checked, description. */
export async function menuEntries(menu: Locator): Promise<{ role: string; name: string; checked: string | null; description: string; group: string | null }[]> {
  return menu.evaluate((m) => [...m.querySelectorAll('[role^="menuitem"]')].map((e) => ({
    role: e.getAttribute('role') ?? '',
    name: (e.getAttribute('aria-label') ?? (e as HTMLElement).innerText ?? '').replace(/\s+/g, ' ').trim(),
    checked: e.getAttribute('aria-checked'),
    description: (e.getAttribute('aria-description') ?? '').replace(/\s+/g, ' ').trim(),
    group: e.closest('[role="group"]')?.getAttribute('aria-label') ?? null,
  })));
}
/** The texts a page region shows (innerText, whitespace folded). */
export async function shownText(loc: Locator): Promise<string> {
  return flat(await loc.first().innerText({ timeout: 1000 }).catch(() => ''));
}
/** The last `import_plan` call's given mapping. */
export async function lastMapping(core: FakeCoreHandle): Promise<any> {
  const plans = await importCallsOf(core, 'import_plan');
  return plans.at(-1)?.mapping ?? null;
}
/** Waits until `n` `import_plan` calls were made; returns the count. */
export async function plansAtLeast(core: FakeCoreHandle, n: number, ms = 3000): Promise<number> {
  return eventually(async () => (await importCallsOf(core, 'import_plan')).length, (c) => c >= n, ms);
}

// ------------------------------------------------------------------------------------------------ moving through the steps

/** `Import…` from the palette: step 0 with the focus on its heading. */
export async function openImport(page: Page): Promise<void> {
  await paletteRun(page, 'Import…');
  await mustStep(page, '0', 'Import… from the palette');
}
/** ⌘K, the command's full title, and ⏎ only when it is the first option (FR-UX-03 AC-2's rule); else an assertion. */
export async function paletteRun(page: Page, title: string): Promise<void> {
  await page.keyboard.press('Meta+k');
  await must(paletteDialog(page), `Command palette (for "${title}")`);
  await page.getByRole('combobox', { name: /^⟦?Command query⟧?$/ }).fill(title);
  const first = await eventually(async () => ((await paletteOptions(page))[0] ?? '').split('\n')[0].trim().replace(/^⟦|⟧$/g, ''), (t) => t === title, 3000);
  assert.equal(first, title, `the palette lists \`${title}\` first`);
  await page.keyboard.press('Enter');
}
/** `Continue` (pointer), then the step expected. */
export async function next(page: Page, s: string, what: string): Promise<void> {
  await enabledSoon(continueBtn(page), `${what}: Continue`);
  await click(continueBtn(page), `${what}: Continue`);
  await mustStep(page, s, what);
}
/** Step 0 → 1, then `Choose zip…` (`zip`) or `Choose folder…` (`folder`) and wait for the scan. */
export async function readSource(page: Page, how: 'zip' | 'folder' = 'zip'): Promise<void> {
  await next(page, '1', 'step 0');
  await click(cmd(page, how === 'zip' ? 'import.chooseZip' : 'import.chooseFolder'), how === 'zip' ? 'Choose zip…' : 'Choose folder…');
  await enabledSoon(continueBtn(page), 'step 1 after reading: Continue', 8000);
}
/** From a fresh start to step `to`: the source (`how`), the space (when the scan has several), the destination. */
export async function goTo(page: Page, to: '1' | '2' | '3' | '4a' | '4c' | '5', o: { how?: 'zip' | 'folder'; space?: string; destination?: 'new' | 'current'; spaces?: number } = {}): Promise<void> {
  await openImport(page);
  if (to === '1') { await next(page, '1', 'step 0'); return; }
  await readSource(page, o.how ?? 'zip');
  const multi = (o.spaces ?? 1) > 1;
  await next(page, multi ? '2' : '3', 'step 1');
  if (to === '2') return;
  if (multi && o.space) await click(radioStarting(page, 'Space', o.space), `space ${o.space}`);
  if (multi) await next(page, '3', 'step 2');
  if (to === '3') return;
  if (o.destination === 'current') await click(radioStarting(page, 'Destination', 'This vault'), '`This vault`');
  await next(page, '4a', 'step 3');
  if (to === '4a') return;
  await enabledSoon(continueBtn(page), 'step 4a: Continue');
  await click(continueBtn(page), 'step 4a: Continue');
  await mustStep(page, to, `step 4a → ${to}`);
}
/** Step 5's `Import <n> objects`, then step 6. */
export async function startImportRun(page: Page): Promise<void> {
  await enabledSoon(importBtn(page), 'step 5: Import <n> objects');
  await click(importBtn(page), 'Import <n> objects');
  await mustStep(page, '6', 'Import pressed');
}
/** The new vault the run writes to, as the window sent it (`import_plan`'s last `newVault` target). */
export async function newVaultPath(core: FakeCoreHandle): Promise<string | null> {
  const t = (await importCallsOf(core, 'import_plan')).map((a) => a?.target).filter((x) => x?.kind === 'newVault').at(-1);
  return t ? `${t.parent}/${t.name}` : null;
}
export async function vaultOpens(core: FakeCoreHandle): Promise<string[]> {
  return (await callsOf(core, 'vault_open')).map((c) => nfc((c.args as { path: string }).path));
}

// ------------------------------------------------------------------------------------------------ the plan's numbers (§3.9, §3.11)

export type PlanNumbers = {
  objects: number; types: number; newTypes: number; attachments: number; links: number; unresolved: number; stubs: number;
  technical: string[]; missing: number; ambiguous: number; merged: number; mergedExample: string | null;
};
/** Step 5's and step 7's numbers as the contract derives them from a plan (§3.9, §3.11; D-1578). */
export function planNumbers(plan: any): PlanNumbers {
  const imported = (plan.objects as any[]).filter((o) => o.outcome === 'imported' && o.kind !== 'orphanMedia');
  const keys = new Set(imported.map((o) => o.type));
  const newKeys = [...keys].filter((k) => (plan.types as any[]).some((t) => t.key === k && t.new));
  const technical: string[] = [];
  for (const t of plan.types as any[]) for (const a of t.attributes as any[]) if (a.action === 'drop' && !technical.includes(a.sourceKey)) technical.push(a.sourceKey);
  const merged = plan.report.merged as any[];
  return {
    objects: plan.totals.objects.imported, types: keys.size, newTypes: newKeys.length, attachments: plan.totals.attachments.imported,
    links: (plan.links as any[]).filter((l) => ['resolved', 'date-mention', 'attachment'].includes(l.outcome.kind)).length,
    unresolved: plan.report.unresolved.length, stubs: plan.report.stubs.length, technical,
    missing: (plan.report.files as any[]).filter((f) => f.change.kind === 'droppedReference').length,
    ambiguous: plan.report.ambiguous.length, merged: merged.length, mergedExample: merged.length ? `${merged[0].variants[0]} → ${merged[0].kept}` : null,
  };
}
/** Region `cs` number formatting (D-133: `1 180`), with plain spaces. */
export const num = (n: number) => new Intl.NumberFormat('cs').format(n).replace(/\s/g, ' ');
/** A token's resolved colour. */
export async function tokenColor(page: Page, token: string): Promise<string> {
  return page.evaluate((t) => {
    const e = document.createElement('span');
    e.style.color = `var(${t})`;
    document.body.appendChild(e);
    const c = getComputedStyle(e).color;
    e.remove();
    return c;
  }, token);
}
export { sleep as wait };
