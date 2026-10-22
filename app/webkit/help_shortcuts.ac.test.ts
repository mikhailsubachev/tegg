// v0.52 feedback, L5 (WebKit + fake core): Help › Keyboard Shortcuts. docs/acceptance/app-shell.md FR-UX-03 AC-14, the L5
// part (D-608): the palette command `Keyboard shortcuts` and ⇧⌘/ open `help/shortcuts` (heading `Keyboard shortcuts`),
// which lists every shortcut of the registry once with its command title in the groups `General`, `Navigation`,
// `Editor`, `Daily Notes`, `Tasks`, `Inbox`, the global shortcuts with their state and the typing triggers. Interface
// docs/contracts/ms3-shell.md §16.6 (route `help/shortcuts`, command `help.shortcuts`, grouping in
// `shell/shortcutGroups.ts`), §3.2 (`SHORTCUTS: { keys, command }[]` in `shell/registry.ts`), §3.3 (commands carry
// their `shortcut`). The L6 menu item is not part of this file. Written from the AC and the contracts only (D-61).
// Every lookup goes through `must`/node:assert (TS-I1).
import { test, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import { mainName, must, mustBeOn, paletteDialog, runCommand, sleep, start } from './helpers';

const GROUPS = ['General', 'Navigation', 'Editor', 'Daily Notes', 'Tasks', 'Inbox'];
const TRIGGERS = ['[[', '@', '/', '#', '![['];
const heading = (page: Page) => page.getByRole('main').getByRole('heading', { level: 1, name: 'Keyboard shortcuts', exact: true });

/** The registry's shortcuts (`shell/registry.ts` SHORTCUTS). */
async function registry(page: Page): Promise<{ keys: string; command: string }[]> {
  return page.evaluate(async () => ((await import('/src/shell/registry.ts' as string)).SHORTCUTS as { keys: string; command: string }[]).map((s) => ({ keys: s.keys, command: s.command })));
}
/** Command titles by shortcut as the palette shows them (an option's text ends with its shortcut). */
async function paletteTitles(page: Page, keys: string[]): Promise<Record<string, string>> {
  await page.keyboard.press('Meta+k');
  await must(paletteDialog(page), 'Command palette');
  await sleep(150);
  const opts = (await page.getByRole('listbox', { name: 'Commands' }).getByRole('option').allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim());
  await page.keyboard.press('Escape');
  const out: Record<string, string> = {};
  for (const k of keys) {
    const o = opts.find((t) => t.endsWith(` ${k}`));
    if (o) out[k] = o.slice(0, -(k.length + 1)).trim();
  }
  return out;
}
/** Minimal elements of the main pane whose text holds `parts` (each as a whole token); their texts. */
async function rowsWith(page: Page, parts: string[]): Promise<string[]> {
  return page.getByRole('main').evaluate((m, ps) => {
    const has = (t: string, p: string) => {
      const i = t.indexOf(p);
      if (i < 0) return false;
      for (let j = i; j >= 0; j = t.indexOf(p, j + 1)) {
        const before = j === 0 ? ' ' : t[j - 1];
        const after = j + p.length >= t.length ? ' ' : t[j + p.length];
        if (/[\s·,:()]/.test(before) && /[\s·,:()]/.test(after)) return true;
      }
      return false;
    };
    const all = [...m.querySelectorAll('*')] as HTMLElement[];
    const text = (e: HTMLElement) => ` ${(e.innerText ?? '').replace(/\s+/g, ' ').trim()} `;
    const hits = all.filter((e) => (ps as string[]).every((p) => has(text(e), p)));
    return hits.filter((e) => !hits.some((x) => x !== e && e.contains(x))).map((e) => text(e).trim());
  }, parts);
}

test('fr_ux_03_ac14_palette_and_shortcut_open_help_shortcuts', async ({ page }) => {
  await start(page);
  await runCommand(page, 'Keyboard shortcuts');
  await mustBeOn(page, 'Keyboard shortcuts', 'the palette command "Keyboard shortcuts"', 3000);
  await must(heading(page), 'heading "Keyboard shortcuts"');
  await runCommand(page, 'Go to Inbox'); // 6A: Go to Home is removed (D-609)
  await sleep(300);
  assert.notEqual(await mainName(page), 'Keyboard shortcuts', 'setup: left the page');
  await page.keyboard.press('Meta+Shift+Slash');
  await mustBeOn(page, 'Keyboard shortcuts', '⇧⌘/', 3000);
});

test('fr_ux_03_ac14_every_registry_shortcut_once_in_its_group', async ({ page }) => {
  await start(page);
  const reg = await registry(page);
  assert.ok(reg.some((s) => s.keys === '⇧⌘/' && s.command === 'help.shortcuts'), '⇧⌘/ is in the registry as help.shortcuts (ms3-shell §16.6)');
  const titles = await paletteTitles(page, reg.map((s) => s.keys));
  await runCommand(page, 'Keyboard shortcuts');
  await must(heading(page), 'heading "Keyboard shortcuts"', 3000);
  const groups = (await page.getByRole('main').getByRole('heading', { level: 2 }).allInnerTexts()).map((t) => t.trim());
  assert.deepEqual(groups.filter((g) => GROUPS.includes(g)), GROUPS, `the groups in order: ${groups.join(', ')}`);
  const problems: string[] = [];
  for (const s of reg) {
    const rows = await rowsWith(page, titles[s.keys] ? [s.keys, titles[s.keys]] : [s.keys]);
    if (rows.length !== 1) problems.push(`${s.keys} ${titles[s.keys] ?? s.command}: ${rows.length} rows`);
  }
  assert.deepEqual(problems, [], 'each registry shortcut is listed exactly once with its command title');
});

test('fr_ux_03_ac14_global_shortcuts_and_typing_triggers', async ({ page }) => {
  await start(page, { hotkeys: [{ id: 'quick-capture', keys: '⌃⌥Space', state: 'active' }, { id: 'new-task', keys: '⌃⌥T', state: 'taken' }] });
  await runCommand(page, 'Keyboard shortcuts');
  await must(heading(page), 'heading "Keyboard shortcuts"', 3000);
  const qc = await rowsWith(page, ['⌃⌥Space', 'Quick Capture']);
  const nt = await rowsWith(page, ['⌃⌥T', 'New Task']);
  assert.equal(qc.length, 1, `⌃⌥Space Quick Capture is listed once: ${JSON.stringify(qc)}`);
  assert.equal(nt.length, 1, `⌃⌥T New Task is listed once: ${JSON.stringify(nt)}`);
  assert.notEqual(qc[0].replace('⌃⌥Space', '').replace('Quick Capture', '').trim(), nt[0].replace('⌃⌥T', '').replace('New Task', '').trim(), 'each shows its state (active vs taken)');
  const missing = await page.getByRole('main').evaluate((m, ts) => (ts as string[]).filter((t) => ![...m.querySelectorAll('*')].some((e) => e.children.length === 0 && (e.textContent ?? '').trim() === t)), TRIGGERS);
  assert.deepEqual(missing, [], 'the typing triggers [[, @, /, #, ![[ are listed');
});
