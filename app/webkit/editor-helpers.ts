// Helpers for the MS3 slice 3C WebKit tests (L5): the editor fixture in the fake core, editor probes, clipboard and
// composition events. No AC assertions here except `must` (re-exported) and the `need*` lookups, which turn a missing
// element into an AssertionError (TS-I1). Labels from docs/contracts/ms3-shell.md §13.5; hooks from §13.6, §13.7.
import type { Locator, Page } from '@playwright/test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadFixtureVault, type CallRecord, type FakeVault } from '../ui/test/fake-core';
import { eventually, must, mustBeOn, seen, sleep, start, type FakeCoreHandle, type StartOptions } from './helpers';

export { eventually, must, seen, sleep };
export type { FakeCoreHandle };

export const REPO = resolve(import.meta.dirname, '../..');

export const E = {
  deset: 'Pages/Deset bloků.md',
  cil: 'Pages/Cíl.md',
  dvojnikP: 'Pages/Dvojník.md',
  dvojnikQ: 'Quick Notes/Dvojník.md',
  ctips: 'Pages/C tips.md',
  spm: 'Pages/Senior Product Manager.md',
  spm2: 'Pages/Senior Product Manager (2).md',
  stitky: 'Pages/Štítky.md',
  bez: 'Pages/Bez hlavičky.md',
  cizi: 'Pages/Cizí hlavička.md',
  uvozovky: 'Pages/Chyba uvozovky.md',
  seznamy: 'Pages/Seznamy.md',
  odsazeny: 'Pages/Odsazený kód.md',
  odstavce: 'Pages/Odstavce.md',
  ukoly: 'Pages/Úkoly.md',
  surove: 'Pages/Surové bloky.md',
  prazdna: 'Pages/Prázdná.md',
  sablona: '_templates/Page/Šablona.md',
  smazana: '.trash/Pages/Smazaná.md',
} as const;

export const TITLES: Record<string, string> = {
  [E.deset]: 'Deset bloků', [E.cil]: 'Cíl', [E.dvojnikP]: 'Dvojník', [E.dvojnikQ]: 'Dvojník', [E.ctips]: 'C# tips',
  [E.spm]: 'Senior Product Manager', [E.spm2]: 'Senior Product Manager', [E.stitky]: 'Štítky', [E.bez]: 'Bez hlavičky',
  [E.cizi]: 'Cizí hlavička', [E.seznamy]: 'Seznamy', [E.odsazeny]: 'Odsazený kód', [E.odstavce]: 'Odstavce',
  [E.ukoly]: 'Úkoly', [E.surove]: 'Surové bloky', [E.prazdna]: 'Prázdná',
};

/** The editor fixture plus `new-empty/.tegg` (editor.md "Fixtures"). */
export function editorVault(): FakeVault {
  return { ...loadFixtureVault('tests/fixtures/vaults/editor', 'tests/fixtures/vaults/new-empty/.tegg'), name: 'Editor' };
}
export function conflictsVault(): FakeVault {
  return { ...loadFixtureVault('tests/fixtures/vaults/conflicts', 'tests/fixtures/vaults/new-empty/.tegg'), name: 'Konflikty' };
}
export const fixtureText = (rel: string) => readFileSync(resolve(REPO, rel), 'utf8');
export const original = (path: string) => editorVault().files[path];

export function idOf(text: string): string | null {
  return /^id: (\S+)$/m.exec(text)?.[1] ?? null;
}

// ------------------------------------------------------------------------------------------------ locators

export const editorBody = (page: Page) => page.getByRole('textbox', { name: 'Note body', exact: true });
export const titleField = (page: Page) => page.getByRole('textbox', { name: 'Title', exact: true });
export const saveState = (page: Page) => page.getByRole('status', { name: 'Save state', exact: true });
export const slashMenu = (page: Page) => page.getByRole('listbox', { name: 'Insert block', exact: true });
export const blockMenu = (page: Page) => page.getByRole('menu', { name: 'Block actions', exact: true });
export const toolbar = (page: Page) => page.getByRole('toolbar', { name: 'Formatting', exact: true });
export const linkSuggestions = (page: Page) => page.getByRole('listbox', { name: 'Link suggestions', exact: true });
export const tagSuggestions = (page: Page) => page.getByRole('listbox', { name: 'Tag suggestions', exact: true });
export const mergeDialog = (page: Page) => page.getByRole('dialog', { name: 'Note changed outside Tegg', exact: true });
export const compareRegion = (page: Page) => page.getByRole('region', { name: 'Compare versions', exact: true });
export const deletedAlert = (page: Page) => page.getByRole('alert').filter({ hasText: 'This note was deleted outside Tegg' });
export const sourceBlocks = (page: Page) => editorBody(page).getByRole('group', { name: 'Source block', exact: true });
export const addBelow = (page: Page) => page.getByRole('button', { name: 'Add block below', exact: true });
export const handle = (page: Page) => page.getByRole('button', { name: 'Drag to move, click for block menu', exact: true });
export const conflictsList = (page: Page) => page.getByRole('list', { name: 'Conflicts', exact: true });

/** Top-level block element `n` (1-based) of the editor body (ADR 0002: one top-level node per body block). */
export const block = (page: Page, n: number) => editorBody(page).locator(':scope > *').nth(n - 1);

// ------------------------------------------------------------------------------------------------ start

export type EditorStart = StartOptions & { vault?: FakeVault; at?: string; tz?: string };

/** Starts the app with the editor vault on `path` (launch landing via `vault_last`, D-132) and waits for the editor. */
export async function openEditor(page: Page, path: string, o: EditorStart = {}): Promise<FakeCoreHandle> {
  const vault = o.vault ?? editorVault();
  const id = idOf(vault.files[path] ?? '') ?? null;
  const core = await start(page, { vault, last: { path, id }, ...o });
  if (TITLES[path]) await mustBeOn(page, TITLES[path], `landing on ${path}`, 5000);
  await must(editorBody(page), `the editor (textbox "Note body") on ${path}`, 5000);
  return core;
}

/** Waits until `Save state` reads `want` (R9). */
export async function stateIs(page: Page, want: string, ms = 3000): Promise<boolean> {
  const got = await eventually(async () => ((await seen(saveState(page), 200)) ? (await saveState(page).first().innerText()).trim() : null), (t) => t === want, ms);
  return got === want;
}
export async function mustBeSaved(page: Page, ms = 3000) {
  assert.ok(await stateIs(page, 'Saved', ms), `Save state should read "Saved" within ${ms} ms`);
}

export async function writes(core: FakeCoreHandle, path?: string): Promise<CallRecord[]> {
  return (await core.calls()).filter((c) => c.cmd === 'note_write' && (!path || (c.args as any)?.path?.normalize('NFC') === path.normalize('NFC')));
}
export const argText = (c: CallRecord) => String((c.args as any)?.text ?? '');

/** Current file text in the fake core. */
export async function fileText(core: FakeCoreHandle, path: string): Promise<string | undefined> {
  return (await core.files())[path.normalize('NFC')];
}

/** Puts the DOM caret in block `n` after the first occurrence of `after` (or at the end) and focuses the editor. */
export async function caretIn(page: Page, n: number, after: string | null = null, atStart = false) {
  const blk = await must(block(page, n), `block ${n}`);
  await blk.evaluate((el, [a, s]) => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const texts: Text[] = [];
    for (let t = walker.nextNode(); t; t = walker.nextNode()) texts.push(t as Text);
    let node: Text | null = null, off = 0;
    if (s) { node = texts[0] ?? null; off = 0; }
    else if (a) { for (const t of texts) { const i = t.data.indexOf(a as string); if (i >= 0) { node = t; off = i + (a as string).length; break; } } }
    else { node = texts[texts.length - 1] ?? null; off = node ? node.data.length : 0; }
    const host = (el.closest('[contenteditable="true"]') as HTMLElement | null) ?? (el as HTMLElement);
    host.focus();
    const r = document.createRange();
    if (node) r.setStart(node, off); else r.setStart(el, 0);
    r.collapse(true);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(r);
    document.dispatchEvent(new Event('selectionchange'));
  }, [after, atStart] as const);
  await sleep(50);
}

/** Selects `text` (first occurrence) inside block `n`. */
export async function selectIn(page: Page, n: number, text: string) {
  const blk = await must(block(page, n), `block ${n}`);
  const ok = await blk.evaluate((el, t) => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let x = walker.nextNode(); x; x = walker.nextNode()) {
      const i = (x as Text).data.indexOf(t);
      if (i >= 0) {
        (el.closest('[contenteditable="true"]') as HTMLElement | null)?.focus();
        const r = document.createRange();
        r.setStart(x, i);
        r.setEnd(x, i + t.length);
        const sel = window.getSelection()!;
        sel.removeAllRanges();
        sel.addRange(r);
        document.dispatchEvent(new Event('selectionchange'));
        return true;
      }
    }
    return false;
  }, text);
  assert.ok(ok, `text "${text}" in block ${n}`);
  await sleep(50);
}

/** Dispatches a paste event with the given clipboard items on the focused element (the L5 stand-in for ⌘V). */
export async function paste(page: Page, items: { plain?: string; html?: string; png?: boolean }) {
  await page.evaluate((it) => {
    const dt = new DataTransfer();
    if (it.plain !== undefined) dt.setData('text/plain', it.plain);
    if (it.html !== undefined) dt.setData('text/html', it.html);
    if (it.png) dt.items.add(new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])], 'image.png', { type: 'image/png' }));
    const target = (document.activeElement as HTMLElement | null) ?? document.body;
    target.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  }, items);
  await sleep(100);
}

/** Dispatches a copy or cut event on the focused element and returns what the app put on the clipboard. */
export async function copyOrCut(page: Page, kind: 'copy' | 'cut'): Promise<{ plain: string; html: string }> {
  return page.evaluate((k) => {
    const dt = new DataTransfer();
    const target = (document.activeElement as HTMLElement | null) ?? document.body;
    target.dispatchEvent(new ClipboardEvent(k, { clipboardData: dt, bubbles: true, cancelable: true }));
    return { plain: dt.getData('text/plain'), html: dt.getData('text/html') };
  }, kind);
}

/** Records the page time of every keydown (for the autosave timing checks). */
export async function recordKeys(page: Page) {
  await page.evaluate(() => {
    (window as any).__keys = [];
    window.addEventListener('keydown', () => (window as any).__keys.push(Date.now()), true);
  });
}
export async function keyTimes(page: Page): Promise<number[]> {
  return page.evaluate(() => [...((window as any).__keys ?? [])] as number[]);
}

/** Body of a note text (after the frontmatter), through the real @tegg/doc. */
export async function bodyOf(text: string): Promise<string> {
  const { parse } = await import('@tegg/doc');
  return text.slice(parse(text).bodyStart);
}
export async function blocksOf(text: string): Promise<string[]> {
  const { parse } = await import('@tegg/doc');
  return parse(text).blocks.map((b) => b.raw);
}
export async function kindsOf(text: string): Promise<string[]> {
  const { parse } = await import('@tegg/doc');
  return parse(text).blocks.map((b) => b.kind);
}
/** The text with its `modified:` line blanked, to compare files that may differ only there. */
export const noModified = (t: string) => t.replace(/^modified: .*$/m, 'modified: <x>');

/** Byte ranges outside which two texts are equal: [start of first difference, end in a, end in b]. */
export function diffSpan(a: string, b: string): { start: number; endA: number; endB: number } | null {
  if (a === b) return null;
  let s = 0;
  while (s < a.length && s < b.length && a[s] === b[s]) s++;
  let ea = a.length, eb = b.length;
  while (ea > s && eb > s && a[ea - 1] === b[eb - 1]) { ea--; eb--; }
  return { start: s, endA: ea, endB: eb };
}

export async function visibleTexts(loc: Locator): Promise<string[]> {
  return (await loc.allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim());
}
