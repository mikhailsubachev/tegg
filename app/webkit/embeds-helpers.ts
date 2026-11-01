// Helpers for the MS4 slice 4F WebKit tests (L5): the embeds fixture in the fake core, the injected clock, zone and
// region, locators from docs/acceptance/embeds.md R30/R30a/R33 and docs/contracts/ms4-embeds.md §6–§9, and call probes.
// No AC assertions here except `must` (re-exported) and the `need*` lookups, which turn a missing element into an
// AssertionError instead of a Playwright timeout (TS-I1). Written from the ACs and the contract only (D-61).
import type { Locator, Page } from '@playwright/test';
import assert from 'node:assert/strict';
import { loadFixtureVault, type CallRecord, type FakeVault, type UiStateDto } from '../ui/test/fake-core';
import { READ_COMMANDS, absent, eventually, mainName, must, mustBeOn, runCommand, seen, settled, sleep, start, type FakeCoreHandle, type StartOptions } from './helpers';
import { goToQuery } from './helpers'; // D-1345: the Search page's first result (D-1340)

export { absent, eventually, mainName, must, mustBeOn, runCommand, seen, sleep };
export type { CallRecord, FakeCoreHandle };

export const nfc = (s: string) => s.normalize('NFC');
export const nfd = (s: string) => s.normalize('NFD');
export const flat = (s: string | null | undefined) => nfc((s ?? '').replace(/\s+/g, ' ').trim());

/** The test clock of embeds.md ("Test clock"): Europe/Prague (set with `test.use({ timezoneId })`), region en-US. */
export const NOW = '2026-10-17T10:00:00+02:00';
export const MODIFIED = `modified: ${NOW}`;

/** Objects of tests/fixtures/vaults/embeds (README.md). */
export const M = {
  cil: 'Pages/Cíl.md',
  rezimy: 'Pages/Režimy.md',
  sekce: 'Pages/Sekce.md',
  rozbita: 'Pages/Rozbitá vložení.md',
  uvnitr: 'Pages/Uvnitř textu.md',
  nfdHost: 'Pages/NFD vložení.md',
  kruhA: 'Pages/Kruh A.md',
  kruhB: 'Pages/Kruh B.md',
  samaSebe: 'Pages/Sama sebe.md',
  obsah: 'Pages/Obsah.md',
  kartaSebe: 'Pages/Karta sebe.md',
  retez1: 'Pages/Řetěz 1.md',
  retez2: 'Pages/Řetěz 2.md',
  retez3: 'Pages/Řetěz 3.md',
  retez4: 'Pages/Řetěz 4.md',
  retez5: 'Pages/Řetěz 5.md',
  kosoctverec: 'Pages/Kosočtverec.md',
  vetev1: 'Pages/Větev 1.md',
  vetev2: 'Pages/Větev 2.md',
  list: 'Pages/List.md',
  upravy: 'Pages/Úpravy.md',
  upravitelna: 'Pages/Upravitelná.md',
  bez: 'Pages/Bez hlavičky.md',
  chybaHlavicky: 'Pages/Chyba hlavičky.md',
  vkladani: 'Pages/Vkládání.md',
  jana: 'Osoby/Jana Nováková.md',
  sarka: 'Osoby/Šárka Malá.md',
  svickova: 'Recepty/Svíčková.md',
  saturnin: 'Knihy/Saturnin.md',
  zavolat: 'Tasks/Zavolat Janě.md',
  praha: 'Místa/Praha.md',
  denni: 'Daily/2026-10-07.md',
  dvojnikP: 'Pages/Dvojník.md',
  dvojnikQ: 'Quick Notes/Dvojník.md',
  vlozeniDvojnika: 'Quick Notes/Vložení dvojníka.md',
  spm: 'Pages/Senior Product Manager.md',
  spm2: 'Pages/Senior Product Manager (2).md',
  ctips: 'Pages/C tips.md',
  sablona: '_templates/Page/Šablona.md',
  smazana: '.trash/Pages/Smazaná.md',
  osobaYml: '.tegg/types/osoba.yml',
  receptYml: '.tegg/types/recept.yml',
  knihaYml: '.tegg/types/kniha.yml',
  mistoYml: '.tegg/types/místo.yml',
  taskYml: '.tegg/types/task.yml',
} as const;

export const TITLES: Record<string, string> = {
  [M.cil]: 'Cíl', [M.rezimy]: 'Režimy', [M.sekce]: 'Sekce', [M.rozbita]: 'Rozbitá vložení', [M.uvnitr]: 'Uvnitř textu', [M.nfdHost]: 'NFD vložení',
  [M.kruhA]: 'Kruh A', [M.kruhB]: 'Kruh B', [M.samaSebe]: 'Sama sebe', [M.obsah]: 'Obsah', [M.kartaSebe]: 'Karta sebe',
  [M.retez1]: 'Řetěz 1', [M.retez2]: 'Řetěz 2', [M.retez3]: 'Řetěz 3', [M.retez4]: 'Řetěz 4', [M.retez5]: 'Řetěz 5',
  [M.kosoctverec]: 'Kosočtverec', [M.vetev1]: 'Větev 1', [M.vetev2]: 'Větev 2', [M.list]: 'List', [M.upravy]: 'Úpravy', [M.upravitelna]: 'Upravitelná',
  [M.bez]: 'Bez hlavičky', [M.vkladani]: 'Vkládání', [M.jana]: 'Jana Nováková', [M.sarka]: 'Šárka Malá',
  [M.svickova]: 'Svíčková', [M.saturnin]: 'Saturnin', [M.zavolat]: 'Zavolat Janě', [M.praha]: 'Praha', [M.denni]: '2026-10-07',
  [M.dvojnikP]: 'Dvojník', [M.dvojnikQ]: 'Rychlý dvojník', [M.vlozeniDvojnika]: 'Vložení dvojníka', [M.ctips]: 'C# tips',
};
/** Every fixture note a user can open (not the template, the trashed note or Chyba hlavičky, whose title is broken). */
export const NOTE_PATHS = Object.keys(TITLES);

/** The 12 embeds of Režimy in file order with their mode (FR-EMB-02 AC-1, README "Derived facts"). */
export const REZIMY: { value: string; title: string; mode: 'full' | 'card' | 'link'; target: string }[] = [
  { value: 'Cíl', title: 'Cíl', mode: 'full', target: M.cil },
  { value: 'Jana Nováková', title: 'Jana Nováková', mode: 'card', target: M.jana },
  { value: 'Šárka Malá', title: 'Šárka Malá', mode: 'card', target: M.sarka },
  { value: 'Svíčková', title: 'Svíčková', mode: 'full', target: M.svickova },
  { value: 'Saturnin', title: 'Saturnin', mode: 'link', target: M.saturnin },
  { value: 'Zavolat Janě', title: 'Zavolat Janě', mode: 'card', target: M.zavolat },
  { value: 'Praha', title: 'Praha', mode: 'card', target: M.praha },
  { value: '2026-10-07', title: '2026-10-07', mode: 'full', target: M.denni },
  { value: 'Cíl|card', title: 'Cíl', mode: 'card', target: M.cil },
  { value: 'Jana Nováková|full', title: 'Jana Nováková', mode: 'full', target: M.jana },
  { value: 'Svíčková|link', title: 'Svíčková', mode: 'link', target: M.svickova },
  { value: 'Cíl|jiný text', title: 'Cíl', mode: 'full', target: M.cil },
];

/** The embeds fixture plus `new-empty/.tegg` (embeds.md "Fixture"); the README isn't a vault file. `edit` changes
 *  files before the app starts. */
export function embedsVault(edit?: (files: Record<string, string>) => void): FakeVault {
  const v = { ...loadFixtureVault('tests/fixtures/vaults/embeds', 'tests/fixtures/vaults/new-empty/.tegg'), name: 'Vložení' };
  delete v.files['README.md'];
  edit?.(v.files);
  return v;
}
export const original = (path: string) => embedsVault().files[nfc(path)];
export const idOf = (text: string | undefined) => /^id: (\S+)$/m.exec(text ?? '')?.[1] ?? null;
export function swap(text: string | undefined, from: string, to: string): string {
  assert.ok(text !== undefined && text.includes(from), `fixture text contains ${JSON.stringify(from)}`);
  return text!.replace(from, to);
}
export const bodyOf = (text: string | undefined) => (text ?? '').replace(/^---\n[\s\S]*?\n---\n/, '');
export const frontOf = (text: string | undefined) => (text ?? '').slice(0, (text ?? '').length - bodyOf(text).length);
export const noModified = (t: string | undefined) => (t ?? '').replace(/^modified: .*$/m, 'modified: <x>');

export const ui = (o: { theme?: UiStateDto['theme']; panel?: boolean } = {}): UiStateDto =>
  ({ version: 1, theme: o.theme ?? 'light', sidebarOpen: true, rightPanel: { open: o.panel ?? false, tab: 'backlinks' } });

export type EmbedsStart = StartOptions & {
  vault?: FakeVault;
  /** Region (default en-US). */
  region?: string;
  /** Read view (D-215 switch). */
  readView?: boolean;
  theme?: UiStateDto['theme'];
  /** Fixed clock (default NOW); `false` leaves the real clock (tests that measure the app's own timers). */
  clock?: string | false;
};

/** Starts the app on the embeds vault landing on `at` (D-132) with the injected clock and region. */
export async function openEmbeds(page: Page, at: string, o: EmbedsStart = {}): Promise<FakeCoreHandle> {
  await page.addInitScript((r) => { (window as any).__TEGG_REGION__ = r; }, o.region ?? 'en-US');
  if (o.readView) await page.addInitScript(() => { const w = window as any; w.__TEGG_TEST__ = { ...(w.__TEGG_TEST__ ?? {}), readView: true }; });
  if (o.clock !== false) await page.clock.setFixedTime(new Date(o.clock ?? NOW));
  const vault = o.vault ?? embedsVault();
  const core = await start(page, { vault, last: { path: nfc(at), id: idOf(vault.files[nfc(at)]) }, uiState: ui({ theme: o.theme }), ...o });
  if (TITLES[at]) await mustBeOn(page, TITLES[at], `landing on ${at}`, 5000);
  return core;
}

// ------------------------------------------------------------------------------------------------ locators (R30)

export const main = (page: Page) => page.getByRole('main');
export const editorBody = (page: Page) => page.getByRole('textbox', { name: /^⟦?Note body⟧?$/ });
export const saveState = (page: Page) => page.getByRole('status', { name: 'Save state', exact: true });
export const slashMenu = (page: Page) => page.getByRole('listbox', { name: 'Insert block', exact: true });
export const blockMenu = (page: Page) => page.getByRole('menu', { name: 'Block actions', exact: true });
export const linkSuggestions = (page: Page) => page.getByRole('listbox', { name: 'Link suggestions', exact: true });
export const addBelow = (page: Page) => page.getByRole('button', { name: 'Add block below', exact: true });
export const mergeDialog = (page: Page) => page.getByRole('dialog', { name: 'Note changed outside Tegg', exact: true });
export const deletedAlert = (page: Page) => page.getByRole('alert').filter({ hasText: 'This note was deleted outside Tegg' });
export const createOffer = (page: Page) => page.getByRole('dialog', { name: 'Create note' });
export const sourceRegion = (page: Page) => page.getByRole('region', { name: 'Markdown source', exact: true });
export const TOGGLE_SOURCE = 'Alt+Meta+KeyU';

/** Every embed element (frames and link-mode embeds) carries `data-embed-mode` (R30). */
export const embeds = (scope: Locator) => scope.locator('[data-embed-mode]');
/** A full or card frame (`group` `Embedded: <title>`); several may match (nested or repeated). */
export const frame = (scope: Locator, title: string) => scope.getByRole('group', { name: `Embedded: ${title}`, exact: true });
/** A frame at a given depth. */
export const frameAt = (scope: Locator, title: string, depth: number) => frame(scope, title).and(scope.page().locator(`[data-embed-depth="${depth}"]`));
/** Link-mode embeds whose shown title is `title`. */
export const linkEmbed = (scope: Locator, title: string) =>
  scope.locator('[data-embed-mode="link"]').filter({ hasText: new RegExp(`^\\s*${esc(title)}\\s*$`) });
export const openButton = (scope: Locator, title: string) => scope.getByRole('button', { name: `Open ${title}`, exact: true });
export const displayAsButton = (scope: Locator) => scope.getByRole('button', { name: 'Display as', exact: true });
export const displayAsMenu = (page: Page) => page.getByRole('menu', { name: 'Display as', exact: true });
export const modeItem = (page: Page, mode: 'Full' | 'Card' | 'Link') => displayAsMenu(page).getByRole('menuitemradio', { name: mode, exact: true });
export const embedBody = (f: Locator) => f.locator('[data-embed-body]');
export const cardStrip = (f: Locator) => f.getByRole('list', { name: 'Properties', exact: true });
export const embedMessage = (f: Locator) => f.locator('[data-embed-message]');
export const picker = (page: Page) => page.getByRole('combobox', { name: 'Embed object', exact: true });
export const pickerList = (page: Page) => page.getByRole('listbox', { name: 'Embed suggestions', exact: true });
/** The editable body of a full embed: a `textbox` named by the embedded title (R30 "Full body"). */
export const embedTextbox = (f: Locator, title: string) => f.getByRole('textbox', { name: title, exact: true });

export const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The n-th (0-based) embed element under `scope` that isn't inside another embed. */
export const topEmbed = (scope: Locator, n: number) => scope.locator('[data-embed-mode]:not([data-embed-mode] [data-embed-mode])').nth(n);
export async function needTop(scope: Locator, n: number, what: string, ms = 5000): Promise<Locator> {
  const l = topEmbed(scope, n);
  assert.ok(await seen(l, ms), `${what}: top-level embed ${n + 1} is not shown`);
  return l;
}
/** Header (first child) text of a frame, NFC and flattened. */
export async function headerText(f: Locator): Promise<string> {
  return f.first().evaluate((e) => ((e.firstElementChild as HTMLElement | null)?.innerText ?? '').replace(/\s+/g, ' ').trim().normalize('NFC'));
}

/** Selects the host's top-level block `n` (1-based) when it is an embed: a click on the frame's edge, then Esc if the
 *  click didn't select it (FR-EDT-13, FR-EMB-01 AC-13). Returns the selected block indexes. */
export async function selectEmbedBlock(page: Page, n: number): Promise<number[]> {
  const blk = editorBody(page).locator(':scope > *').nth(n - 1);
  assert.ok(await seen(blk, 5000), `host block ${n}`);
  await blk.click({ position: { x: 3, y: 3 } }).catch(() => {});
  await sleep(100);
  let sel = await selectedBlocks(page);
  if (!sel.includes(n)) { await page.keyboard.press('Escape'); await sleep(100); sel = await selectedBlocks(page); }
  return sel;
}

export async function needFrame(scope: Locator, title: string, what = `frame "Embedded: ${title}"`, n = 0, ms = 5000): Promise<Locator> {
  const f = frame(scope, title);
  assert.ok(await seen(f, ms), `${what} is not shown`);
  const c = await f.count();
  assert.ok(c > n, `${what}: instance ${n + 1} of ${c}`);
  return f.nth(n);
}

/** Every embed element under `scope` in document order, as plain data. */
export type EmbedInfo = {
  mode: string | null; state: string | null; depth: string | null; target: string | null; label: string; text: string;
  icon: string | null; inP: boolean; inline: boolean; editable: string | null; description: string;
};
export async function embedList(scope: Locator): Promise<EmbedInfo[]> {
  return scope.first().evaluate((root) => {
    const desc = (e: Element) => {
      const ids = (e.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean);
      return (e.getAttribute('aria-description') ?? ids.map((id) => document.getElementById(id)?.textContent ?? '').join(' ')).replace(/\s+/g, ' ').trim();
    };
    return [...root.querySelectorAll('[data-embed-mode]')].map((e) => {
      const body = e.querySelector('[data-embed-body]');
      const header = e.firstElementChild;
      return {
        mode: e.getAttribute('data-embed-mode'),
        state: e.getAttribute('data-embed-state'),
        depth: e.getAttribute('data-embed-depth'),
        target: e.getAttribute('data-embed-target')?.normalize('NFC') ?? null,
        label: (e.getAttribute('aria-label') ?? '').normalize('NFC'),
        text: ((e as HTMLElement).innerText ?? '').replace(/\s+/g, ' ').trim().normalize('NFC'),
        icon: e.getAttribute('data-icon') ?? header?.querySelector('[data-icon]')?.getAttribute('data-icon') ?? null,
        inP: !!e.parentElement?.closest('p'),
        inline: !!e.parentElement?.closest('p, li, blockquote, td, th, h1, h2, h3, h4, h5, h6, [role="note"]'),
        editable: body?.getAttribute('data-embed-editable') ?? null,
        description: desc(e),
      };
    });
  });
}
/** Only the top-level embeds (not inside another embed). */
export async function topEmbeds(scope: Locator): Promise<EmbedInfo[]> {
  const all = await scope.first().evaluate((root) =>
    [...root.querySelectorAll('[data-embed-mode]')].map((e) => !e.parentElement?.closest('[data-embed-mode]')));
  return (await embedList(scope)).filter((_, i) => all[i]);
}
/** Waits until at least `n` embed elements are shown under `scope`; returns the list. */
export async function embedsShown(scope: Locator, n: number, ms = 5000): Promise<EmbedInfo[]> {
  return eventually(() => embedList(scope).catch(() => [] as EmbedInfo[]), (l) => l.length >= n, ms);
}

/** Like `embedsShown`, but asserts that at least `n` embed elements are shown. */
export async function needEmbeds(scope: Locator, n: number, what: string, ms = 5000): Promise<EmbedInfo[]> {
  const l = await embedsShown(scope, n, ms);
  assert.ok(l.length >= n, `${what}: ${n} embeds shown, got ${l.length}`);
  return l;
}

/** Waits until the centre pane's scroll position has held for 8 animation frames (D-688, issue #59): after Back the
 *  scroll is restored while embeds load, and a click while the content still moves lands its mouse-up elsewhere. */
export async function scrollSteady(page: Page, what: string, ms = 5000): Promise<void> {
  const ok = await page.evaluate((ms) => new Promise<boolean>((done) => {
    const end = performance.now() + ms;
    const top = () => {
      let s: Element | null = document.querySelector('main [data-embed-mode]') ?? document.querySelector('main');
      while (s && !(s.scrollHeight > s.clientHeight + 1 && /(auto|scroll)/.test(getComputedStyle(s).overflowY))) s = s.parentElement;
      return s ? s.scrollTop : -1;
    };
    let last = top();
    let same = 0;
    const tick = () => {
      const now = top();
      same = now === last ? same + 1 : 0;
      last = now;
      if (same >= 8) done(true);
      else if (performance.now() > end) done(false);
      else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }), ms);
  assert.ok(ok, `${what}: the scroll position settles within ${ms} ms`);
}

/** Visible text blocks (paragraphs, headings, list items) inside an element, in order. */
export async function blockTexts(loc: Locator): Promise<string[]> {
  return loc.first().evaluate((root) =>
    [...root.querySelectorAll('p, h1, h2, h3, h4, h5, h6, li')]
      .filter((e) => !e.closest('[data-embed-message]') && !(e.parentElement && e.parentElement.closest('p, li') && e.tagName === 'P' && e.parentElement.closest('li')))
      // D-453: WebKit's innerText puts a space after an inline-flex chip; whitespace before punctuation is dropped.
      .map((e) => ((e as HTMLElement).innerText ?? '').replace(/\s+/g, ' ').replace(/ ([.,;:!?])/g, '$1').trim().normalize('NFC'))
      .filter(Boolean));
}
/** Occurrences of `text` in the visible DOM of `scope` (text nodes, NFC). */
export async function occurrences(scope: Locator, text: string): Promise<number> {
  return scope.first().evaluate((root, t) => {
    const all = ((root as HTMLElement).innerText ?? '').normalize('NFC');
    let n = 0, i = 0;
    while ((i = all.indexOf(t, i)) >= 0) { n++; i += t.length; }
    return n;
  }, nfc(text));
}

/** Accessible description of an element (aria-describedby texts or aria-description). */
export async function description(loc: Locator): Promise<string> {
  return loc.first().evaluate((e) => {
    const ids = (e.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean);
    return (e.getAttribute('aria-description') ?? ids.map((id) => document.getElementById(id)?.textContent ?? '').join(' ')).replace(/\s+/g, ' ').trim();
  });
}
export async function isDisabled(loc: Locator): Promise<boolean> {
  return loc.first().evaluate((e) => (e as HTMLButtonElement).disabled === true || e.getAttribute('aria-disabled') === 'true');
}
/** Waits for `Save state` to read `want` (editor.md R9). */
export async function stateIs(page: Page, want: string, ms = 3000): Promise<boolean> {
  return (await eventually(async () => flat(await saveState(page).first().innerText({ timeout: 200 }).catch(() => '')), (t) => t === want, ms)) === want;
}
export async function mustBeSaved(page: Page, ms = 3000) {
  assert.ok(await stateIs(page, 'Saved', ms), `Save state should read "Saved" within ${ms} ms`);
}

// ------------------------------------------------------------------------------------------------ caret

/** Puts the DOM caret inside `loc` after the first occurrence of `after` (or at the end; or at the start) and focuses
 *  the nearest editable root. Returns false when the text isn't there. */
export async function caretAt(loc: Locator, after: string | null = null, atStart = false): Promise<boolean> {
  const ok = await loc.first().evaluate((el, [a, s]) => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const texts: Text[] = [];
    for (let t = walker.nextNode(); t; t = walker.nextNode()) texts.push(t as Text);
    let node: Text | null = null, off = 0;
    if (s) { node = texts[0] ?? null; off = 0; }
    else if (a) {
      for (const t of texts) { const i = t.data.normalize('NFC').indexOf(a as string); if (i >= 0) { node = t; off = i + (a as string).length; break; } }
      if (!node) return false;
    } else { node = texts[texts.length - 1] ?? null; off = node ? node.data.length : 0; }
    const start = node ? node.parentElement! : (el as HTMLElement);
    const host = (start.closest('[contenteditable="true"]') as HTMLElement | null) ?? (el as HTMLElement);
    host.focus();
    const r = document.createRange();
    if (node) r.setStart(node, off); else r.setStart(el, 0);
    r.collapse(true);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(r);
    document.dispatchEvent(new Event('selectionchange'));
    return true;
  }, [after === null ? null : nfc(after), atStart] as const).catch(() => false);
  await sleep(50);
  return ok;
}
export async function mustCaret(loc: Locator, after: string | null, what: string, atStart = false) {
  assert.ok(await caretAt(loc, after, atStart), `${what}: caret placed${after ? ` after "${after}"` : ''}`);
}
/** The top-level host paragraph of the editor with text `text` (exact, trimmed). */
export const hostBlock = (page: Page, text: string) =>
  editorBody(page).locator(':scope > *').filter({ hasText: new RegExp(`^\\s*${esc(text)}\\s*$`) });
/** Indexes (1-based) of host blocks with `data-block-selected`. */
export async function selectedBlocks(page: Page): Promise<number[]> {
  return editorBody(page).first().evaluate((b) => [...b.children].map((e, i) => (e.hasAttribute('data-block-selected') ? i + 1 : 0)).filter(Boolean)).catch(() => []);
}
/** Whether the focus is inside `loc`. */
export async function focusInside(loc: Locator): Promise<boolean> {
  return loc.first().evaluate((e) => !!document.activeElement && e.contains(document.activeElement)).catch(() => false);
}

// ------------------------------------------------------------------------------------------------ calls

/** Read-only commands (helpers.ts, ms4-links §4, ms4-daily §4) plus `embed_load` (ms4-embeds §4: read-only). */
export const EMBED_READS = new Set([...READ_COMMANDS, 'embed_load']);
export async function writeCalls(core: FakeCoreHandle): Promise<CallRecord[]> {
  return (await core.calls()).filter((c) => !EMBED_READS.has(c.cmd) && !c.cmd.startsWith('plugin:'));
}
export async function callsOf(core: FakeCoreHandle, cmd: string): Promise<CallRecord[]> {
  return (await core.calls()).filter((c) => c.cmd === cmd);
}
export const pathOf = (c: CallRecord) => nfc(String((c.args as any)?.path ?? ''));
export const argText = (c: CallRecord) => String((c.args as any)?.text ?? '');
/** `note_write` calls, optionally for one path. */
export async function writes(core: FakeCoreHandle, path?: string): Promise<CallRecord[]> {
  return (await callsOf(core, 'note_write')).filter((c) => !path || pathOf(c) === nfc(path));
}
/** Paths of every write command (note_write, note_create, …, type_patch) in call order. */
export async function writePaths(core: FakeCoreHandle): Promise<string[]> {
  // D-454: `note_create` has no path argument; the created path is its result.
  return (await writeCalls(core)).map((c) => (c.cmd === 'type_patch' ? `type:${String((c.args as any)?.key ?? '')}` : c.cmd === 'note_create' ? nfc(String(c.result ?? '')) : pathOf(c)));
}
/** The `paths` of every `embed_load` call (ms4-embeds §8). */
export async function embedLoads(core: FakeCoreHandle): Promise<string[][]> {
  return (await callsOf(core, 'embed_load')).map((c) => ((c.args as any)?.paths ?? []).map((p: string) => nfc(String(p))));
}
export async function fileText(core: FakeCoreHandle, path: string): Promise<string | undefined> {
  return (await core.files())[nfc(path)];
}
export async function fileWhen(core: FakeCoreHandle, path: string, ok: (t: string | undefined) => boolean, ms = 3000): Promise<string | undefined> {
  return eventually(() => fileText(core, path), ok, ms);
}
/** Paths routed by `nav_opened`, in order. */
export async function navs(core: FakeCoreHandle): Promise<string[]> {
  return (await callsOf(core, 'nav_opened')).map(pathOf);
}

// ------------------------------------------------------------------------------------------------ test hook (§9)

export type NestedEditor = { path: string; depth: number; editable: boolean; text: string; dirty: boolean; historyDepth: number };
/** `window.__TEGG_TEST__.embeds()` (ms4-embeds §9), read once; [] when the hook is missing. */
export async function nestedEditors(page: Page): Promise<NestedEditor[]> {
  return page.evaluate(() => {
    const list = ((window as any).__TEGG_TEST__?.embeds?.() ?? []) as any[];
    return list.map((e) => ({ path: String(e.path).normalize('NFC'), depth: e.depth, editable: e.editable, text: e.text(), dirty: e.dirty(), historyDepth: e.historyDepth() }));
  }).catch(() => []);
}

// ------------------------------------------------------------------------------------------------ navigation

/** Opens a note through the Search page (D-1345): its title in `Search query`, ⏎ on the first result. */
export async function gotoNote(page: Page, title: string) {
  await goToQuery(page, title);
  await page.keyboard.press('Enter');
  await mustBeOn(page, title, `open "${title}"`, 5000);
}
/** `type-settings/<key>` through the type page's `Type settings` button (types-helpers pattern). */
export async function gotoSettings(page: Page, plural: string, name: string) {
  await runCommand(page, `Go to type: ${plural}`);
  await mustBeOn(page, plural, `type page ${plural}`, 5000);
  await (await must(main(page).getByRole('button', { name: 'Type settings', exact: true }), 'button "Type settings"')).click();
  await must(page.getByRole('heading', { level: 1, name: `${name} type settings`, exact: true }), `heading "${name} type settings"`, 5000);
}
export const embedModeGroup = (page: Page) => main(page).getByRole('radiogroup', { name: 'Default embed mode', exact: true });

/** Opens the slash menu in an empty paragraph added below the host paragraph `text`, types `query` and returns the
 *  menu (FR-EDT-01 AC-3 `Add block below`, FR-EDT-03). */
export async function slashBelow(page: Page, text: string, query = '/emb'): Promise<Locator> {
  await paragraphBelow(page, text);
  await page.keyboard.type(query);
  return must(slashMenu(page), `listbox "Insert block" for ${query}`);
}
/** An empty paragraph below the host paragraph `text`, with the caret in it (FR-EDT-01 AC-3 `Add block below`). */
export async function paragraphBelow(page: Page, text: string) {
  await mustCaret(hostBlock(page, text), null, `paragraph "${text}"`);
  await (await must(addBelow(page), 'button "Add block below"')).click();
  await sleep(100);
}
/** Opens the `Embed object` picker below the host paragraph `text` (slash menu ⏎). */
export async function openPicker(page: Page, text: string): Promise<Locator> {
  const menu = await slashBelow(page, text);
  await must(menu.getByRole('option', { name: 'Embed object', exact: true }), 'option "Embed object"');
  await page.keyboard.press('Enter');
  return must(picker(page), 'combobox "Embed object"');
}
/** Picker options as shown (first line of each). */
export async function pickerOptions(page: Page): Promise<string[]> {
  return (await pickerList(page).getByRole('option').allInnerTexts()).map((s) => flat(s.split('\n')[0]));
}
/** Types `query` into the picker and waits for the list to settle. */
export async function pickerQuery(page: Page, query: string) {
  const c = await must(picker(page), 'combobox "Embed object"');
  await c.fill(query);
  await sleep(250);
}
