// Helpers for the MS5 slice 5B WebKit tests (L5): the inbox fixture in the fake core (main window and capture window,
// docs/contracts/ms5-capture.md §11.2), the injected clock, zone and region, locators from docs/acceptance/capture.md
// R55, R58 and docs/acceptance/inbox.md R60, and call probes. No AC assertions here except `must` (re-exported), `click`
// and the `need*` lookups, which turn a missing element into an AssertionError instead of a Playwright timeout (TS-I1).
import type { Locator, Page } from '@playwright/test';
import assert from 'node:assert/strict';
import { installFakeCore, loadFixtureVault, type FakeOptions, type FakeVault, type UiStateDto } from '../ui/test/fake-core';
import { READ_COMMANDS, absent, eventually, mainName, must, mustBeOn, onPage, runCommand, seen, sidebar, sleep, start, type FakeCoreHandle, type StartOptions } from './helpers';

export { absent, eventually, mainName, must, mustBeOn, onPage, runCommand, seen, sidebar, sleep };
export type { FakeCoreHandle, FakeVault };

export const nfc = (s: string) => s.normalize('NFC');
export const flat = (s: string | null | undefined) => nfc((s ?? '').replace(/\s+/g, ' ').trim());
export const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The test clock (capture.md, tasks.md): Wednesday 14 Oct 2026, 12:00 in Prague = 03:00 in Los Angeles. */
export const NOW = '2026-10-14T12:00:00+02:00';
export const NOW_IN: Record<string, string> = { 'Europe/Prague': '2026-10-14T12:00:00+02:00', 'America/Los_Angeles': '2026-10-14T03:00:00-07:00' };

/** The inbox fixture (tests/fixtures/vaults/inbox README). */
export const I = {
  Q1: 'Quick Notes/Koupit mléko.md', Q2: 'Quick Notes/Nápad na článek.md', Q3: 'Quick Notes/Přečteno.md', Q4: 'Quick Notes/Bez stavu.md',
  Q5: 'Quick Notes/Divná hodnota.md', Q6: 'Quick Notes/Žluťoučký kůň.md', Q7: 'Quick Notes/Bez offsetu.md', Q8: 'Quick Notes/Bez data.md',
  Holy: 'Quick Notes/Holý text.md', D1: 'Daily/2026-10-13.md', D2: 'Daily/2026-10-12.md', D3: 'Daily/2026-10-07.md',
  N1: 'Nápady/Aplikace na čaj.md', N2: 'Nápady/Starý nápad.md', P1: 'Pages/Zachycená stránka.md', P2: 'Pages/Plán webu.md',
  T1: 'Tasks/Zavolat instalatérovi.md', S1: 'Schůzky/Porada týmu.md', DQ: 'Quick Notes/Dvojník.md', DP: 'Pages/Dvojník.md',
} as const;
export type IKey = keyof typeof I;
/** R60 card names: `<type name>: <title>`. */
export const CARD: Record<string, string> = {
  Q1: 'Quick Note: Koupit mléko', Q2: 'Quick Note: Nápad na článek', Q4: 'Quick Note: Bez stavu', Q5: 'Quick Note: Divná hodnota',
  Q6: 'Quick Note: Žluťoučký kůň', Q7: 'Quick Note: Bez offsetu', Q8: 'Quick Note: Bez data', D1: 'Daily Note: 2026-10-13',
  D3: 'Daily Note: 2026-10-07', N1: 'Nápad: Aplikace na čaj', P1: 'Page: Zachycená stránka', T1: 'Task: Zavolat instalatérovi', S1: 'Schůzka: Porada týmu',
};
export const MEMBERS: IKey[] = ['Q1', 'Q2', 'Q4', 'Q5', 'Q6', 'Q7', 'Q8', 'D1', 'D3', 'N1', 'P1', 'T1', 'S1'];
export const ip = (...k: IKey[]) => k.map((x) => nfc(I[x]));
export const titleOf = (p: string) => nfc(p.split('/').pop()!.replace(/\.md$/, ''));

/** The inbox fixture plus `new-empty/.tegg` (its README.md isn't a vault file). `edit` changes files before start. */
export function inboxVault(edit?: (files: Record<string, string>) => void): FakeVault {
  const v = { ...loadFixtureVault('tests/fixtures/vaults/inbox', 'tests/fixtures/vaults/new-empty/.tegg'), name: 'Doručené' };
  delete v.files['README.md'];
  edit?.(v.files);
  return v;
}
export const original = (path: string) => inboxVault().files[nfc(path)];
export function swap(text: string | undefined, from: string, to: string): string {
  assert.ok(text !== undefined && text.includes(from), `fixture text contains ${JSON.stringify(from)}`);
  return text!.replace(from, () => to);
}
/** The fixture text of `path` with `review: unreviewed` (or `from`) → `to` and `modified` → `now`. */
export function reviewedText(path: string, now = NOW, from = 'review: unreviewed', to = 'review: reviewed'): string {
  return swap(original(path), from, to).replace(/^modified: .*$/m, `modified: ${now}`);
}

export const ui = (o: { theme?: UiStateDto['theme']; dateTime?: UiStateDto['dateTime']; inbox?: UiStateDto['inbox'] } = {}): UiStateDto =>
  ({ version: 1, theme: o.theme ?? 'light', sidebarOpen: true, rightPanel: { open: false, tab: 'backlinks' }, ...(o.dateTime ? { dateTime: o.dateTime } : {}), ...(o.inbox ? { inbox: o.inbox } : {}) });

export type Start5B = StartOptions & {
  vault?: FakeVault;
  region?: string;
  /** ISO instant for the Playwright clock (default NOW). `install: true` installs a controllable clock. */
  now?: string;
  install?: boolean;
  theme?: UiStateDto['theme'];
  dateTime?: UiStateDto['dateTime'];
  inboxUi?: UiStateDto['inbox'];
  /** Land on this note path (`vault_last`), else Home. */
  at?: string;
};

async function clock(page: Page, o: { region?: string; now?: string; install?: boolean }) {
  await page.addInitScript((r) => { (window as any).__TEGG_REGION__ = r; }, o.region ?? 'cs');
  const t = new Date(o.now ?? NOW);
  if (o.install) await page.clock.install({ time: t });
  else await page.clock.setFixedTime(t);
}

/** Starts the main window on the inbox vault (the zone comes from `test.use({ timezoneId })`). */
export async function startMain(page: Page, o: Start5B = {}): Promise<FakeCoreHandle> {
  await clock(page, o);
  const vault = o.vault ?? inboxVault();
  const last = o.at ? { path: nfc(o.at), id: /^id: (\S+)$/m.exec(vault.files[nfc(o.at)] ?? '')?.[1] ?? null } : null;
  return start(page, { ...o, vault, last, uiState: o.uiState ?? ui({ theme: o.theme, dateTime: o.dateTime, inbox: o.inboxUi }) });
}

// ------------------------------------------------------------------------------------------------ the Inbox (R60)

export const main = (page: Page) => page.getByRole('main');
export const inboxHeading = (page: Page) => main(page).getByRole('heading', { level: 1, name: /^⟦?Inbox⟧?$/ });
/** `Go to Inbox` from the palette, then the heading (or the Inbox zero region). */
export async function gotoInbox(page: Page) {
  await runCommand(page, 'Go to Inbox');
  await must(inboxHeading(page).or(page.getByRole('region', { name: 'Inbox zero' })), 'heading "Inbox" (R60)', 5000);
}
export async function startInbox(page: Page, o: Start5B = {}): Promise<FakeCoreHandle> {
  const core = await startMain(page, o);
  await gotoInbox(page);
  return core;
}
export const filterGroup = (page: Page) => main(page).getByRole('group', { name: 'Filter by type', exact: true });
export const filterBtn = (page: Page, key: string) => filterGroup(page).locator(`[data-type="${nfc(key)}"]`);
export const groupRegion = (page: Page, id: 'today' | 'yesterday' | 'week' | 'older') => main(page).locator(`[data-group="${id}"]`);
export const cardAt = (page: Page, path: string) => main(page).locator(`[data-path="${nfc(path)}"]`).and(page.getByRole('article'));
export const cardNamed = (page: Page, name: string) => main(page).getByRole('article', { name, exact: true });
export const reviewedBox = (card: Locator) => card.getByRole('checkbox', { name: 'Reviewed', exact: true });
export const triageBtn = (page: Page, title: string) => main(page).getByRole('button', { name: `Triage actions for "${title}"`, exact: true });
export const triageMenu = (page: Page) => page.getByRole('menu', { name: 'Triage actions', exact: true });
export const liveRegion = (page: Page) => main(page).getByRole('status');
export const markAllBtn = (page: Page) => main(page).getByRole('button', { name: 'Mark all reviewed', exact: true });
export const toolbar = (page: Page) => main(page).getByRole('toolbar');
export const zero = (page: Page) => page.getByRole('region', { name: 'Inbox zero', exact: true });

/** Card paths per group (`data-group` regions), in reading order. */
export async function inboxGroups(page: Page): Promise<Record<string, string[]>> {
  return main(page).evaluate((m) => {
    const out: Record<string, string[]> = {};
    for (const g of m.querySelectorAll('[data-group]') as NodeListOf<HTMLElement>) {
      out[g.getAttribute('data-group') ?? ''] = ([...g.querySelectorAll('[data-path]')] as HTMLElement[])
        .filter((e) => e.getAttribute('role') === 'article' || e.tagName === 'ARTICLE').map((e) => (e.getAttribute('data-path') ?? '').normalize('NFC'));
    }
    return out;
  });
}
/** Waits until the groups equal `want`; returns the last value. */
export async function groupsWhen(page: Page, want: Record<string, string[]>, ms = 3000) {
  return eventually(() => inboxGroups(page), (g) => JSON.stringify(g) === JSON.stringify(want), ms);
}
/** Every card path shown, in reading order. */
export async function cardPaths(page: Page): Promise<string[]> {
  return main(page).evaluate((m) => ([...m.querySelectorAll('[data-path]')] as HTMLElement[])
    .filter((e) => e.getAttribute('role') === 'article' || e.tagName === 'ARTICLE').map((e) => (e.getAttribute('data-path') ?? '').normalize('NFC')));
}
export async function liveTexts(page: Page): Promise<string[]> {
  return (await page.getByRole('status').allInnerTexts()).map(flat);
}
export async function liveSays(page: Page, text: string, ms = 2000): Promise<boolean> {
  return (await eventually(() => liveTexts(page), (t) => t.some((x) => x.includes(text)), ms)).some((x) => x.includes(text));
}
/** Opens a card's triage menu with its button; asserts the menu. */
export async function openTriage(page: Page, title: string): Promise<Locator> {
  await click(triageBtn(page, title), `Triage actions for "${title}"`);
  return must(triageMenu(page), 'menu "Triage actions"');
}
/** The sidebar's Inbox entry and the count it shows ('' when none). */
export const inboxEntry = (page: Page) => sidebar(page).locator('a, button, [role="link"], [role="button"]').filter({ has: page.getByText('Inbox', { exact: true }) }).first();
export async function sidebarCount(page: Page): Promise<string> {
  if (!(await seen(inboxEntry(page), 1000))) return '<no entry>';
  return flat(await inboxEntry(page).innerText()).replace('Inbox', '').replace(/\D/g, '');
}

// ------------------------------------------------------------------------------------------------ the capture window (R55)

export type CaptureStart = Omit<Start5B, "vault"> & { vault?: FakeVault | null; trigger?: 'status-item' | 'status-menu' | 'hotkey' | 'palette'; kind?: 'default' | 'task'; draft?: FakeOptions['captureDraft']; open?: boolean; hash?: string };

/** Loads `capture.html` with the fake core in capture mode and opens it as a trigger does (`capture:open`). */
export async function startCapture(page: Page, o: CaptureStart = {}): Promise<FakeCoreHandle> {
  await clock(page, o);
  const vault = o.vault === undefined ? inboxVault() : o.vault;
  const core = await installFakeCore(page, vault, { ...o, window: 'capture', captureDraft: o.draft ?? null, uiState: o.uiState ?? ui({ theme: o.theme, dateTime: o.dateTime }) });
  await page.goto(`/capture.html${o.hash ?? ''}`);
  if (o.open !== false && !o.hash) {
    await sleep(300);
    await core.openCapture({ trigger: o.trigger ?? 'hotkey', kind: o.kind ?? 'default' });
    await must(capText(page), 'textbox "Capture text" (R55)', 5000);
  }
  return core;
}
export const capText = (page: Page) => page.getByRole('textbox', { name: 'Capture text', exact: true });
export const typeBtn = (page: Page) => page.getByRole('button', { name: /^⟦?Type: / });
export const typeMenu = (page: Page) => page.getByRole('menu', { name: 'Type', exact: true });
export const typeItem = (page: Page, name: string) => typeMenu(page).getByRole('menuitemradio', { name, exact: true });
export const discardBtn = (page: Page) => page.getByRole('button', { name: 'Discard', exact: true });
export const saveBtn = (page: Page) => page.getByRole('button', { name: 'Save capture', exact: true });
export const dueBtn = (page: Page) => page.getByRole('button', { name: /^Due: / });
export const prioBtn = (page: Page) => page.getByRole('button', { name: /^Priority: / });
export const tagCombo = (page: Page) => page.getByRole('combobox', { name: 'Add tag…', exact: true });
export const tagInput = (page: Page) => tagCombo(page).locator('xpath=self::input | .//input').first();
export const tagsList = (page: Page) => page.getByRole('listbox', { name: 'Tags', exact: true });
export const removeChip = (page: Page, tag: string) => page.getByRole('button', { name: `Remove #${tag}`, exact: true });
export const dropZone = (page: Page) => page.getByRole('button', { name: 'Add an image or PDF', exact: true });
export const capStatus = (page: Page) => page.getByRole('status', { name: 'Capture status', exact: true });

export async function typeInCapture(page: Page, text: string) {
  await (await must(capText(page), 'textbox "Capture text"')).focus();
  for (const [i, line] of text.split('\n').entries()) {
    if (i > 0) await page.keyboard.press('Enter');
    if (line) await page.keyboard.insertText(line);
  }
}
/** The capture text's value. */
export async function capValue(page: Page): Promise<string> {
  const t = await must(capText(page), 'textbox "Capture text"');
  return t.evaluate((e) => ((e as HTMLTextAreaElement).value ?? e.textContent ?? ''));
}
export async function chips(page: Page): Promise<string[]> {
  return page.evaluate(() => ([...document.querySelectorAll('button[aria-label^="Remove #"]')] as HTMLElement[]).map((b) => (b.getAttribute('aria-label') ?? '').replace(/^Remove #/, '').normalize('NFC')));
}
export async function chooseType(page: Page, name: string) {
  await click(typeBtn(page), 'button "Type: …"');
  await must(typeMenu(page), 'menu "Type"');
  await click(typeItem(page, name), `menuitemradio ${name}`);
}
/** `capture_create` calls (args), in order. */
export async function creates(core: FakeCoreHandle): Promise<{ vault: string; type: string; title: string; text: string }[]> {
  return (await core.calls()).filter((c) => c.cmd === 'capture_create').map((c) => c.args as any);
}

// ------------------------------------------------------------------------------------------------ generic

/** Clicks an element after asserting it is shown and enabled. */
export async function click(loc: Locator, what: string, ms = 3000) {
  const el = await must(loc, what, ms);
  const off = await el.evaluate((e) => (e as HTMLButtonElement).disabled === true || e.getAttribute('aria-disabled') === 'true');
  assert.equal(off, false, `${what} is enabled`);
  await el.click();
}
export async function description(loc: Locator): Promise<string> {
  await must(loc, 'element with a description');
  return loc.first().evaluate((e) => {
    const ids = (e.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean);
    return (e.getAttribute('aria-description') ?? ids.map((id) => document.getElementById(id)?.textContent ?? '').join(' ') ?? e.getAttribute('title') ?? '').replace(/\s+/g, ' ').trim();
  });
}
export async function isDisabled(loc: Locator): Promise<boolean> {
  await must(loc, 'control');
  return loc.first().evaluate((e) => (e as HTMLButtonElement).disabled === true || e.getAttribute('aria-disabled') === 'true');
}
export async function textOf(loc: Locator, ms = 3000): Promise<string> {
  return (await seen(loc, ms)) ? flat(await loc.first().innerText()) : '';
}
/** The focused element's role and accessible name. */
export async function focusName(page: Page): Promise<{ role: string; name: string }> {
  return page.evaluate(() => {
    const a = document.activeElement as HTMLElement | null;
    if (!a || a === document.body) return { role: 'body', name: '' };
    const role = a.getAttribute('role') ?? (a.tagName === 'TEXTAREA' || (a.tagName === 'INPUT' && (a as HTMLInputElement).type === 'text') ? 'textbox' : a.tagName === 'BUTTON' ? 'button' : a.tagName.toLowerCase());
    const label = a.getAttribute('aria-label') ?? (a.getAttribute('aria-labelledby') ? a.getAttribute('aria-labelledby')!.split(/\s+/).map((id) => document.getElementById(id)?.textContent ?? '').join(' ') : '') ?? '';
    return { role, name: (label || a.textContent || '').replace(/\s+/g, ' ').trim().normalize('NFC') };
  });
}

/** Commands that write vault files (everything else is a read or machine-local, ms5-capture §11.2). */
export const VAULT_WRITES = new Set([
  'note_write', 'note_create', 'note_create_exact', 'note_trash', 'note_discard', 'note_rename', 'daily_create', 'link_create', 'type_create',
  'type_patch', 'type_delete', 'starter_add', 'vault_create', 'vault_settings_patch', 'capture_create', 'inbox_bulk', 'job_retry', 'job_undo', 'job_redo',
]);
export async function vaultWrites(core: FakeCoreHandle): Promise<string[]> {
  return (await core.calls()).map((c) => c.cmd).filter((c) => VAULT_WRITES.has(c));
}
export async function callsOf(core: FakeCoreHandle, cmd: string) {
  return (await core.calls()).filter((c) => c.cmd === cmd);
}
export async function fileText(core: FakeCoreHandle, path: string): Promise<string | undefined> {
  return (await core.files())[nfc(path)];
}
export async function fileWhen(core: FakeCoreHandle, path: string, ok: (t: string | undefined) => boolean, ms = 2000): Promise<string | undefined> {
  return eventually(() => fileText(core, path), ok, ms);
}
export const NOT_READ = (cmd: string) => !READ_COMMANDS.has(cmd);
