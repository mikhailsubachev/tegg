// Helpers for the MS3 slice 3A WebKit tests (L5). No assertions about AC outcomes live here except `must`, which
// turns a missing element into an AssertionError instead of a Playwright timeout (TS-I1: red for an assertion).
// Accessible names come from docs/contracts/ms3-shell.md §3.7 and ms2-shell §3.
import type { Locator, Page } from '@playwright/test';
import assert from 'node:assert/strict';
import { installFakeCore, shellVault, type FakeCoreHandle, type FakeOptions, type FakeVault } from '../ui/test/fake-core';

export { shellVault };
export type { FakeCoreHandle, FakeVault };

export const P = {
  porada: 'Schůzky/2026-10-07 Porada.md',
  bez: 'Pages/Bez hlavičky.md',
  uvodni: 'Pages/Úvodní stránka.md',
  ctvrtek: 'Quick Notes/Nápad na čtvrtek.md',
  druhy: 'Quick Notes/Druhý nápad.md',
  eva: 'Tasks/Zavolat Evě.md',
  svickova: 'Recepty/Svíčková.md',
};

export const isMac = true;
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Collation prelude (ms3-shell §3.6 `setCollationLocale`), run before the app renders. */
export const collation = (locale: string) => `import { setCollationLocale as __tcl } from '/src/i18n/collate.ts'; __tcl(${JSON.stringify(locale)});`;
export const pseudoLocale = `import { setCatalog as __tsc, pseudo as __tps, en as __ten } from '/src/i18n/catalog.ts'; __tsc(__tps(__ten), 'en');`;

export type StartOptions = FakeOptions & { vault?: FakeVault | null; frame?: 'vault' | 'chooser' | 'none' };

/** Loads the app with the fake core. By default the shell fixture is open and the test waits for the frame. */
export async function start(page: Page, o: StartOptions = {}): Promise<FakeCoreHandle> {
  const vault = o.vault === undefined ? shellVault() : o.vault;
  const core = await installFakeCore(page, vault, o);
  await page.goto('/');
  const frame = o.frame ?? (vault ? 'vault' : 'chooser');
  // 10 s: the fake core ships the whole vault to Node on every call, so a 1,000-note vault (FR-LNK-01 AC-16) can take
  // more than 5 s to show the frame while the push gate runs its Rust lanes.
  if (frame === 'vault') await must(sidebar(page), 'the frame (navigation "Sidebar")', 10_000);
  if (frame === 'chooser') await must(page.getByRole('main', { name: 'Choose a vault' }), 'the chooser (main "Choose a vault")', 10_000);
  return core;
}

export async function seen(loc: Locator, ms = 3000): Promise<boolean> {
  try {
    await loc.first().waitFor({ state: 'visible', timeout: ms });
    return true;
  } catch {
    return false;
  }
}

export async function absent(loc: Locator, ms = 3000): Promise<boolean> {
  try {
    await loc.first().waitFor({ state: 'hidden', timeout: ms });
    return true;
  } catch {
    return false;
  }
}

export async function must(loc: Locator, what: string, ms = 3000): Promise<Locator> {
  assert.ok(await seen(loc, ms), `${what} is not shown`);
  return loc.first();
}

/** Polls `get` until `ok(value)` or the timeout; returns the last value (assert on it afterwards). */
export async function eventually<T>(get: () => Promise<T>, ok: (v: T) => boolean, ms = 3000): Promise<T> {
  const end = Date.now() + ms;
  let v = await get();
  while (!ok(v) && Date.now() < end) {
    await sleep(25);
    v = await get();
  }
  return v;
}

export const sidebar = (page: Page) => page.getByRole('navigation', { name: 'Sidebar' });
export const panel = (page: Page) => page.getByRole('complementary', { name: 'Context panel' });
export const paletteDialog = (page: Page) => page.getByRole('dialog', { name: 'Command palette' });
/** The `Quick switcher` dialog, removed by D-760: tests only assert that it is absent. */
export const switcherDialog = (page: Page) => page.getByRole('dialog', { name: 'Quick switcher' });
/** The `New object` dialog, removed by D-520 (ms5-tasks §12.2): tests only assert that it is absent. */
export const newObjectDialog = (page: Page) => page.getByRole('dialog', { name: 'New object' });
export const typesList = (page: Page) => page.getByRole('list', { name: 'Types' });

// ------------------------------------------------------------------------------------------------ unsaved drafts (D-520)

/** The status under the title of an unsaved new object (`newObject.notSaved`, app-shell FR-NAV-01 AC-13). */
export const NOT_SAVED = 'Not saved yet. Start typing to create this note.';
export const draftStatus = (page: Page) => page.getByRole('status').filter({ hasText: NOT_SAVED }).or(page.getByText(NOT_SAVED, { exact: true }));

/** The visible `Title` field: its text (value or text content) and whether it holds `document.activeElement`. */
export async function titleState(page: Page): Promise<{ text: string | null; focused: boolean }> {
  return page.evaluate(() => {
    const all = [...document.querySelectorAll('[aria-label="Title"]')] as HTMLElement[];
    const t = all.find((e) => (e.getAttribute('role') === 'textbox' || e instanceof HTMLInputElement || e instanceof HTMLTextAreaElement || e.isContentEditable) && e.getClientRects().length > 0);
    if (!t) return { text: null, focused: false };
    const a = document.activeElement;
    const text = t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement ? t.value : (t.textContent ?? '');
    return { text, focused: !!a && (a === t || t.contains(a)) };
  });
}

/** True when an unsaved draft is shown: the status, and an empty `Title` field holding the caret (D-520). */
export async function isDraft(page: Page, ms = 3000): Promise<boolean> {
  if (!(await seen(draftStatus(page), ms))) return false;
  const s = await eventually(() => titleState(page), (x) => x.text === '' && x.focused, 1000);
  return s.text === '' && s.focused;
}

/** Asserts an unsaved draft is shown (FR-NAV-01 AC-13, FR-TYP-09 AC-17): no dialog, the `Not saved yet…` status, and
 *  an empty `Title` field in edit mode with the caret (`document.activeElement`). */
export async function mustBeDraft(page: Page, how: string, ms = 3000) {
  await must(page.getByRole('textbox', { name: 'Title', exact: true }), `${how}: textbox "Title" of the new draft`, ms);
  const s = await eventually(() => titleState(page), (x) => x.text === '' && x.focused, ms);
  assert.deepEqual(s, { text: '', focused: true }, `${how}: an empty Title field holds the caret (D-520)`);
  assert.ok(await seen(draftStatus(page), 1000), `${how}: the status "${NOT_SAVED}" is shown`);
  assert.equal(await page.getByRole('dialog').count(), 0, `${how}: no dialog opens (D-520 removes the New object dialog)`);
}

/** From a just-opened draft: types `title` in the Title field and commits it with ↩ (D-522); waits for the note. */
export async function createFromDraft(page: Page, title: string, how: string) {
  await mustBeDraft(page, how);
  await page.keyboard.type(title);
  await page.keyboard.press('Enter');
  await mustBeOn(page, title.normalize('NFC'), `${how}: the new note "${title}" after ↩`, 5000);
}

/** The accessible name of the centre pane (`main`): the current page name or note title (§3.7). */
export async function mainName(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const mains = [...document.querySelectorAll('main, [role="main"]')] as HTMLElement[];
    const m = mains.find((e) => e.offsetParent !== null || e.getClientRects().length > 0);
    if (!m) return null;
    const label = m.getAttribute('aria-label');
    if (label) return label;
    const ids = m.getAttribute('aria-labelledby');
    if (ids) return ids.split(/\s+/).map((id) => document.getElementById(id)?.textContent?.trim() ?? '').join(' ');
    return null;
  });
}

export async function onPage(page: Page, name: string, ms = 3000): Promise<boolean> {
  return (await eventually(() => mainName(page), (n) => n === name, ms)) === name;
}

// 5 s: a route that follows core work (a rename job, a big vault) can take longer than 3 s while the push gate runs
// its Rust lanes beside WebKit; a passing wait still returns at once.
export async function mustBeOn(page: Page, name: string, how: string, ms = 5000) {
  const got = await eventually(() => mainName(page), (n) => n === name, ms);
  assert.equal(got, name, `${how}: centre pane should be "${name}"`);
}

// Accents, case, punctuation and the pseudo-locale's ⟦⟧ aside (NFR-OTH-02 AC-3), so `Go to type Osoby` matches
// `Go to type: Osoby`.
const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
/**
 * Waits until the selected option of `list` (the palette's `Commands` or the Search page's `Go to`, D-760) answers
 * `query`: its first line contains the query, accents and case aside. `Go to` asks the core for its results, so
 * right after typing the list can still show the previous query's; ⏎ then opens the wrong note. A fixed sleep was not
 * enough under the push gate's load. Gives up after `ms` without failing, for fuzzy queries no option spells out (the
 * test's next assertion still decides), and logs that it did.
 */
export async function settled(page: Page, list: string, query: string, ms = 3000): Promise<boolean> {
  const want = fold(query);
  const name = new RegExp(`^⟦?${list.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}⟧?$`); // the pseudo-locale wraps it in ⟦⟧
  const sel = page.getByRole('listbox', { name }).getByRole('option', { selected: true }).first();
  const got = await eventually(() => sel.innerText({ timeout: 200 }).then((t) => fold(t.split('\n')[0]), () => ''), (t) => t.includes(want), ms);
  if (!got.includes(want)) console.warn(`settled: no selected option of "${list}" matched ${JSON.stringify(query)} within ${ms} ms (last: ${JSON.stringify(got)})`);
  return got.includes(want);
}

/** Opens the palette with ⌘K, types `query`, runs the first result with ⏎. */
export async function runCommand(page: Page, query: string) {
  await page.keyboard.press('Meta+k');
  await must(paletteDialog(page), `Command palette (for "${query}")`);
  await page.getByRole('combobox', { name: 'Command query' }).fill(query);
  await settled(page, 'Commands', query);
  await page.keyboard.press('Enter');
}

/** The palette's options in order, as shown text (title plus shortcut or "Coming in …"). */
export async function paletteOptions(page: Page): Promise<string[]> {
  return page.getByRole('listbox', { name: 'Commands' }).getByRole('option').allInnerTexts();
}

/** D-760 (search-navigation.md FR-NAV-01 AC-15…AC-18): ⌘O and the Quick switcher are gone; the Search page's field. */
export const searchQueryField = (page: Page) =>
  page.getByRole('searchbox', { name: /^⟦?Search query⟧?$/ }).or(page.getByRole('textbox', { name: /^⟦?Search query⟧?$/ })).first();
/** The Search page's `Go to` list (D-760). Both accept the pseudo-locale's ⟦⟧ (NFR-OTH-02 AC-3). */
export const goToListbox = (page: Page) => page.getByRole('listbox', { name: /^⟦?Go to⟧?$/ });
/** ⇧⌘F, `query` typed in `Search query`, then waits until the selected `Go to` option answers it (D-760). The caret stays
 *  in the field, so ⏎ opens the selected option and ↓/↑ move the selection. */
export async function goToQuery(page: Page, query: string) {
  await page.keyboard.press('Meta+Shift+f');
  const q = await must(searchQueryField(page), `textbox "Search query" (⇧⌘F, for ${JSON.stringify(query)})`, 5000);
  await q.fill(query);
  await must(goToListbox(page), `listbox "Go to" (for ${JSON.stringify(query)})`, 3000);
  await settled(page, 'Go to', query);
}

/** Opens a note through the Search page's `Go to` list (D-760; before it, the ⌘O switcher). */
export async function openNote(page: Page, title: string) {
  await goToQuery(page, title);
  await page.keyboard.press('Enter');
  await mustBeOn(page, title, `open "${title}" from the Search page's Go to list`);
}

export async function gotoType(page: Page, plural: string) {
  await runCommand(page, `Go to type: ${plural}`);
  await mustBeOn(page, plural, `Go to type: ${plural}`);
}

/** `tag/<key>`'s example parameter in the R1 route tours (AP-685, D-747): the shell fixture plus one note tagged `účty`. */
export const TAG_ROUTE_KEY = 'účty';
export function shellVaultWithTag(base: FakeVault = shellVault()): FakeVault {
  const files = { ...base.files };
  files['Pages/Rozpočet.md'] = '---\nid: 01JB0K0000000000000000T001\ntype: page\ntitle: Rozpočet\ntags: [účty]\n---\nMěsíční přehled.\n';
  return { ...base, files };
}
/** Opens `tag/účty` the app's way: `Go to Tags`, then its All tags row (FR-TAG-06 AC-1). Returns the centre-pane name. */
export async function gotoTagPage(page: Page): Promise<string> {
  await runCommand(page, 'Go to Tags');
  const row = page.getByRole('main').getByRole('table').first().locator(`[data-tag="${TAG_ROUTE_KEY}"]`);
  await must(row, `All tags row ${TAG_ROUTE_KEY}`, 5000);
  // D-949: the callers run in the default mode (click to preview), where a double-click on the row opens it (R103).
  await row.first().dblclick();
  return `#${TAG_ROUTE_KEY}`;
}

/** Visible Types list entries as [label, count] (count = last integer in the entry, 0 if none). */
export async function typeEntries(page: Page): Promise<[string, number][]> {
  const items = await typesList(page).getByRole('listitem').allInnerTexts();
  return items.map((t) => {
    const s = t.replace(/\s+/g, ' ').trim();
    const m = /^(.*?)\s*(\d+)\s*$/.exec(s);
    return m ? [m[1].trim(), Number(m[2])] : [s, 0];
  });
}

export async function box(loc: Locator) {
  if (!(await seen(loc, 500))) return null;
  return loc.first().boundingBox();
}

export async function theme(page: Page): Promise<string | undefined> {
  return page.evaluate(() => document.documentElement.dataset.theme);
}

/** Describes the focused element: role, accessible label and whether it is inside main / sidebar. */
export async function focused(page: Page) {
  return page.evaluate(() => {
    const a = document.activeElement as HTMLElement | null;
    if (!a || a === document.body) return { tag: 'body', label: '', inMain: false, inSidebar: false, heading: false };
    const label = a.getAttribute('aria-label') ?? a.textContent?.trim() ?? '';
    return {
      tag: a.tagName.toLowerCase(),
      label,
      inMain: !!a.closest('main, [role="main"]'),
      inSidebar: !!a.closest('nav[aria-label="Sidebar"], [role="navigation"][aria-label="Sidebar"]'),
      heading: /^h1$/i.test(a.tagName) || a.getAttribute('aria-level') === '1',
    };
  });
}

/** Commands that read only (ms2-shell §2, ms3-shell §2); everything else counts as a write. */
export const READ_COMMANDS = new Set([
  'vault_current', 'vault_last', 'vault_types', 'vault_pick_dir', 'index_type_counts', 'index_list', 'index_search',
  'index_switcher', 'note_read', 'ui_state_get', 'ui_state_set', 'nav_opened', 'perf_mark', 'vault_open',
  'link_resolve', 'open_external', // 3B (ms3-shell §11.1): read-only resolution; a URL opened outside the vault
  'index_tags', 'index_conflicts', // 3C (ms3-shell §13.2): read-only
  'vault_recent', 'app_about', // D-219, D-220 (ms3-shell §12.5): read-only list; shows the About panel
  'type_get', 'type_template', 'type_usage', 'type_misfits', 'index_type_rows', 'starter_plan', // 3D (ms3-shell §14.3): read-only
  'index_backlinks', 'index_broken_links', 'index_duplicate_titles', 'link_create_plan', 'backlinks', // 4A (ms4-links §4): read-only
  'daily_view', 'daily_dates', 'daily_draft', 'daily_context', 'daily_backlinks', // 4B (ms4-daily §4): read-only
  'job_report', 'job_interrupted', 'backups_list', 'editor_open', 'editor_close', // 4C (ms4-jobs §4): read-only / editor registration
  'embed_load', // 4F (ms4-embeds §4): read-only, records no recency
  'task_list', 'daily_tasks', // 5A-1 (ms5-tasks §3): read-only (the sidebar's Tasks count reads on every route)
  'inbox_list', 'inbox_count', 'index_versions', 'hotkeys', 'vault_settings', 'shell_settings', // 5B (ms5-capture §5, §7): read-only
  'trash_list', // 6A (ms6-trash-media §4, D-632): read-only
  'tag_objects', // 4D-lite (ms4-tags §3; D-703, AP-685/D-747): the tag page's rows, read-only
  'index_tagged_objects', // D-784 (ms4-tags §1.6): All tags' summary, read-only
  'type_move_plan', 'folder_move_preview', 'jobs_ready', // 4E-1 (ms4-jobs §14.7): read-only; jobs_ready only lets the tidy job start (D-819)
  // 4E-2 (ms4-jobs §14.9.6): the delete dialogs start their job to read its plan; it writes nothing before job_confirm,
  // and Cancel or Esc cancels it in confirm.
  'value_remove_start', 'type_delete_start', 'job_plan', 'job_cancel',
  'graph_neighbourhood', // G1 (v1-graph §2): read-only, no recency
  'index_path_by_id', // slice P (v1-previews §2): read-only, no recency
  'graph_presets_get', // G3 (v1-graph §16.2): read-only, never creates `.tegg/graph.yml`
]);
export async function nonReadCalls(core: FakeCoreHandle): Promise<string[]> {
  return (await core.calls()).map((c) => c.cmd).filter((c) => !READ_COMMANDS.has(c) && !c.startsWith('plugin:event|'));
}

/**
 * D-943 (previews.md "AC-test changes"): switches the Object preview mode of the running app with its palette command
 * (R106 `preview.mode.*`) and waits until the machine-local UI state stores it (v1-previews §1). The older tests run
 * their steps under `off` (started with `setPreviewMode('off', …)`) and then switch to `click` for the slice P steps.
 */
export async function switchPreviewMode(page: Page, core: FakeCoreHandle, mode: 'click' | 'hover' | 'off') {
  const title = { click: 'Object preview: Click to preview', hover: 'Object preview: Hover to preview', off: 'Object preview: Off' }[mode];
  await runCommand(page, title);
  // A missing `preview.mode` is the default, hover (D-1164).
  const got = await eventually(() => core.uiState().then((s) => (s as any)?.preview?.mode ?? 'hover'), (m) => m === mode, 3000);
  assert.equal(got, mode, `palette "${title}" stores preview.mode = ${mode}`);
  await absent(paletteDialog(page), 1000);
}
/** The slice P preview popover of `title` (R102: a `dialog` named `Preview: <title>`). */
export const previewDialog = (page: Page, title: string | RegExp) =>
  typeof title === 'string' ? page.getByRole('dialog', { name: `Preview: ${title.normalize('NFC')}`, exact: true }) : page.getByRole('dialog', { name: title });
/** Every slice P preview popover in the window. */
export const anyPreviewDialog = (page: Page) => page.getByRole('dialog', { name: /^⟦?Preview: / });
/** Asserts that `Preview: <title>` is shown and is the only preview popover (R102: one at a time). */
export async function mustPreview(page: Page, title: string | RegExp, what: string, ms = 3000): Promise<Locator> {
  const d = await must(previewDialog(page, title), `${what}: dialog "Preview: ${typeof title === 'string' ? title.normalize('NFC') : title}"`, ms);
  assert.equal(await anyPreviewDialog(page).count(), 1, `${what}: exactly one preview popover`);
  return d;
}
/** Waits `ms`, then asserts that no preview popover is shown. */
export async function mustNoPreview(page: Page, what: string, ms = 500) {
  await sleep(ms);
  assert.equal(await anyPreviewDialog(page).count(), 0, `${what}: no preview popover`);
}
/** Esc closes the preview popover (R103). */
export async function escPreview(page: Page, what: string) {
  await page.keyboard.press('Escape');
  const n = await eventually(() => anyPreviewDialog(page).count(), (c) => c === 0, 2000);
  assert.equal(n, 0, `${what}: Esc closes the preview`);
}

/** Reads a registry entry and a catalog text in the page (dev server modules, ms3-shell §3.1–§3.2). */
export async function catalogText(page: Page, key: string, vars?: Record<string, string | number>): Promise<string> {
  return page.evaluate(async ([k, v]) => {
    const m = await import('/src/i18n/catalog.ts' as string);
    return m.t(k, v ?? undefined) as string;
  }, [key, vars ?? null] as const);
}
export async function routeDefs(page: Page): Promise<{ id: string; name: string; purpose: string }[]> {
  return page.evaluate(async () => {
    const m = await import('/src/shell/registry.ts' as string);
    return (m.ROUTES as { id: string; name: string; purpose: string }[]).map((r) => ({ id: r.id, name: r.name, purpose: r.purpose }));
  });
}
