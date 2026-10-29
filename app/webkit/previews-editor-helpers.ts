// Helpers for the v1.0 slice P WebKit tests of the editor and Settings › Previews (L5): docs/acceptance/previews.md
// (R102, R103, R106, R107; FR-LNK-08 AC-1, FR-LNK-11 AC-4, FR-LNK-12, FR-LNK-13, FR-SET-07, FR-SYN-06 AC-37, FR-UX-03
// AC-19, FR-UX-05 AC-14, NFR-OTH-02 AC-11) and docs/contracts/v1-previews.md (§1 UI state, §4 settings, §5 editor, §6
// commands, §9 fake core). The previews fixture in the fake core, the injected clock, zone and region, locators and call
// probes. No AC assertions here except `must` (re-exported) and the `need*` lookups, which turn a missing element into an
// AssertionError instead of a Playwright timeout (TS-I1). Written from the ACs and the contract only (D-61).
import type { Locator, Page } from '@playwright/test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { loadFixtureVault, type CallRecord, type FakeVault, type UiStateDto } from '../ui/test/fake-core';
import { READ_COMMANDS, eventually, mainName, must, mustBeOn, runCommand, seen, sleep, start, type FakeCoreHandle, type StartOptions } from './helpers';

export { eventually, mainName, must, mustBeOn, runCommand, seen, sleep };
export type { CallRecord, FakeCoreHandle };

export const REPO = resolve(import.meta.dirname, '../..');
export const nfc = (s: string) => s.normalize('NFC');
export const nfd = (s: string) => s.normalize('NFD');
export const flat = (s: string | null | undefined) => nfc((s ?? '').replace(/\s+/g, ' ').trim());
export const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The test clock of previews.md ("Test clock"): Europe/Prague (set with `test.use({ timezoneId })`), region en-US. */
export const NOW = '2026-10-28T10:00:00+01:00';

/** Objects of tests/fixtures/vaults/previews (README.md). */
export const PV = {
  rozpocet: 'Pages/Rozpočet 2027.md',
  jana: 'Osoby/Jana Nováková.md',
  petr: 'Osoby/Petr Dvořák.md',
  alfa: 'Projekty/Projekt Alfa.md',
  odkazy: 'Pages/Odkazy.md',
  vlozeni: 'Pages/Vložení.md',
  kruhA: 'Pages/Kruh A.md',
  ukol: 'Tasks/Zavolat Janě.md',
  porada: 'Pages/Porada 2026-10-27.md',
  denni: 'Daily/2026-10-07.md',
  ucty: 'Tags/Účty.md',
  graf: 'Images/Graf.md',
  smlouva: 'PDFs/Smlouva.md',
  planP: 'Pages/Plán.md',
  planQ: 'Quick Notes/Plán.md',
  prazdna: 'Pages/Prázdná.md',
  neplatna: 'Pages/Neplatná hlavička.md',
  napad: 'Quick Notes/Nápad na podcast.md',
  mapa: 'Pages/Mapa.md',
} as const;

export const TITLES: Record<string, string> = {
  [PV.rozpocet]: 'Rozpočet 2027', [PV.jana]: 'Jana Nováková', [PV.petr]: 'Petr Dvořák', [PV.alfa]: 'Projekt Alfa',
  [PV.odkazy]: 'Odkazy', [PV.vlozeni]: 'Vložení', [PV.kruhA]: 'Kruh A', [PV.ukol]: 'Zavolat Janě', [PV.porada]: 'Porada 2026-10-27',
  [PV.denni]: '2026-10-07', [PV.graf]: 'Graf', [PV.smlouva]: 'Smlouva', [PV.prazdna]: 'Prázdná', [PV.neplatna]: 'Neplatná hlavička',
  [PV.napad]: 'Nápad na podcast', [PV.mapa]: 'Mapa',
};

/** Odkazy's paragraphs used below (fixture `Pages/Odkazy.md`; block n is the n-th body paragraph). */
export const ODK = {
  p1: 'Hlavní [[Rozpočet 2027]].',
  p2: 'S popisem [[Rozpočet 2027|rozpočet]].',
  p7: 'Projekt [[Projekt Alfa]].',
} as const;

function findFile(dir: string, name: string): string {
  const hit = readdirSync(dir).find((n) => nfc(n) === nfc(name));
  assert.ok(hit, `fixture file ${name} in ${dir}`);
  return join(dir, hit!);
}

/** The previews fixture plus `new-empty/.tegg` (previews.md "Fixture"); the README isn't a vault file. The two runtime
 *  binaries of the README (`_attachments/graf.png`, `_attachments/Smlouva.pdf`) are copied from trash-media. `edit`
 *  changes text files before the app starts. */
export function previewsVault(edit?: (files: Record<string, string>) => void): FakeVault {
  const v = { ...loadFixtureVault('tests/fixtures/vaults/previews', 'tests/fixtures/vaults/new-empty/.tegg'), name: 'Náhledy' };
  delete v.files['README.md'];
  const att = resolve(REPO, 'tests/fixtures/vaults/trash-media/_attachments');
  v.bin = {
    '_attachments/graf.png': readFileSync(findFile(att, 'záhon.png')).toString('base64'),
    '_attachments/Smlouva.pdf': readFileSync(findFile(att, 'Rozpočet.pdf')).toString('base64'),
  };
  edit?.(v.files);
  return v;
}
export const original = (path: string) => previewsVault().files[nfc(path)];
export const idOf = (text: string | undefined) => /^id: (\S+)$/m.exec(text ?? '')?.[1] ?? null;
export const noModified = (t: string | undefined) => (t ?? '').replace(/^modified: .*$/m, 'modified: <x>');
export const ISO_MODIFIED = /^modified: \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?[+-]\d{2}:\d{2}$/m;

export type PreviewUi = NonNullable<UiStateDto['preview']>;
export const ui = (o: { theme?: UiStateDto['theme']; preview?: PreviewUi; panel?: boolean } = {}): UiStateDto =>
  ({ version: 1, theme: o.theme ?? 'light', sidebarOpen: true, rightPanel: { open: !!o.panel, tab: 'backlinks' }, ...(o.preview ? { preview: o.preview } : {}) } as UiStateDto);

export type PvStart = StartOptions & {
  vault?: FakeVault;
  /** A launch route (`window.__TEGG_ROUTE__`), e.g. `settings/previews`. */
  route?: string;
  region?: string;
  readView?: boolean;
  theme?: UiStateDto['theme'];
  preview?: PreviewUi;
  /** Fixed clock (default NOW); `false` leaves the real clock. */
  clock?: string | false;
};

/** Starts the main window on the previews vault, optionally landing on `at` (D-132) or `route`. */
export async function startPv(page: Page, at: string | null, o: PvStart = {}): Promise<FakeCoreHandle> {
  await page.addInitScript((r) => { (window as any).__TEGG_REGION__ = r; }, o.region ?? 'en-US');
  // Init scripts accumulate on the page, so the flag is set every time.
  await page.addInitScript((rv) => { const w = window as any; w.__TEGG_TEST__ = { ...(w.__TEGG_TEST__ ?? {}), readView: rv }; }, !!o.readView);
  if (o.route) await page.addInitScript((r) => { (window as any).__TEGG_ROUTE__ = r; }, o.route);
  if (o.clock !== false) await page.clock.setFixedTime(new Date(o.clock ?? NOW));
  const vault = o.vault ?? previewsVault();
  const last = at ? { path: nfc(at), id: idOf(vault.files[nfc(at)]) } : null;
  return start(page, { ...o, vault, last, uiState: o.uiState ?? ui({ theme: o.theme, preview: o.preview, panel: false }) });
}

/** Starts on a note (launch landing) and waits for its page and, unless `readView`, the editor. */
export async function openPv(page: Page, path: string, o: PvStart = {}): Promise<FakeCoreHandle> {
  const core = await startPv(page, path, o);
  const title = TITLES[path] ?? nfc(path.split('/').pop()!.replace(/\.md$/, ''));
  await mustBeOn(page, title, `landing on ${path}`, 5000);
  if (!o.readView) await must(editorBody(page), `the editor (textbox "Note body") on ${path}`, 5000);
  return core;
}

// ------------------------------------------------------------------------------------------------ locators

export const main = (page: Page) => page.getByRole('main');
export const editorBody = (page: Page) => page.getByRole('textbox', { name: /^⟦?Note body⟧?$/ });
export const saveState = (page: Page) => page.getByRole('status', { name: 'Save state', exact: true });
/** Top-level block element `n` (1-based) of the editor body (ADR 0002). */
export const block = (page: Page, n: number) => editorBody(page).locator(':scope > *').nth(n - 1);
/** The link chip named `name` inside editor block `n`. */
export const chipIn = (page: Page, n: number, name: string) => block(page, n).getByRole('link', { name: nfc(name), exact: true });

/** R102: the popover is a `dialog` named `Preview: <title>` (the pseudo-locale wraps the catalog part). */
export const previewOf = (page: Page, title: string) => page.getByRole('dialog', { name: new RegExp(`^⟦?Preview: ${esc(nfc(title))}⟧?$`) });
export const anyPreview = (page: Page) => page.getByRole('dialog', { name: /^⟦?Preview: / });
export const linkMenu = (page: Page) => page.getByRole('menu', { name: /^⟦?Link⟧?$/ });
export const selectionMenu = (page: Page) => page.getByRole('menu', { name: 'Selection', exact: true });
export const editLinkDialog = (page: Page) => page.getByRole('dialog', { name: /^⟦?Edit link⟧?$/ });
export const linkSuggestions = (page: Page) => page.getByRole('listbox', { name: 'Link suggestions', exact: true });
export const createOffer = (page: Page) => page.getByRole('dialog', { name: 'Create note' });
/** A field of the `Edit link` dialog (`Link to` is a combobox with the `[[` suggestions, `Link text` a textbox). */
export const field = (dlg: Locator, name: 'Link to' | 'Link text') =>
  dlg.getByRole('combobox', { name: new RegExp(`^⟦?${name}⟧?$`) }).or(dlg.getByRole('textbox', { name: new RegExp(`^⟦?${name}⟧?$`) })).first();

export async function needPreview(page: Page, title: string, what: string, ms = 3000): Promise<Locator> {
  return must(previewOf(page, title), `${what}: dialog "Preview: ${title}"`, ms);
}
/** Number of preview dialogs in the DOM (R102: one at a time). */
export async function previewCount(page: Page): Promise<number> {
  return anyPreview(page).count();
}
export async function fieldValue(loc: Locator): Promise<string> {
  return nfc(await loc.evaluate((e) => (e as HTMLInputElement).value ?? e.textContent ?? ''));
}

// ------------------------------------------------------------------------------------------------ menus

/** Dispatches a right-click (`contextmenu`) at the element's centre-left and returns whether the page prevented the
 *  system menu (as editor_context_menu.ac.test.ts). With `atSelection`, at the current DOM selection. */
export async function rightClick(page: Page, at: Locator | null): Promise<boolean> {
  const target = at ? await at.first().elementHandle() : null;
  return page.evaluate((el) => {
    let x = 0, y = 0, node: Element | null = el as Element | null;
    const sel = window.getSelection();
    if (!node && sel && sel.rangeCount) {
      const r = sel.getRangeAt(0).getBoundingClientRect();
      x = r.left + r.width / 2; y = r.top + r.height / 2;
      const a = sel.anchorNode;
      node = a ? (a.nodeType === 3 ? a.parentElement : (a as Element)) : null;
    } else if (node) {
      const r = node.getBoundingClientRect();
      x = r.left + Math.min(6, r.width / 2); y = r.top + r.height / 2;
    }
    const ev = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, button: 2, buttons: 2 });
    (node ?? document.body).dispatchEvent(ev);
    return ev.defaultPrevented;
  }, target);
}

/** The items of a menu in order (accessible name or first text line, the key hint after the label dropped), and the
 *  item each separator follows. */
export async function menuItems(menu: Locator): Promise<{ items: string[]; separatorsAfter: string[] }> {
  return menu.first().evaluate((m) => {
    const kids = [...m.querySelectorAll('[role="menuitem"], [role="separator"], [role="menuitemradio"], [role="menuitemcheckbox"]')] as HTMLElement[];
    const items: string[] = [];
    const separatorsAfter: string[] = [];
    for (const k of kids) {
      if (k.getAttribute('role') === 'separator') { separatorsAfter.push(items[items.length - 1] ?? ''); continue; }
      const label = k.getAttribute('aria-label') ?? '';
      let text = label;
      if (!text) {
        // The visible label without the key hint (`<kbd>` or an element with `data-shortcut`).
        const c = k.cloneNode(true) as HTMLElement;
        c.querySelectorAll('kbd, [data-shortcut], [aria-hidden="true"]').forEach((x) => x.remove());
        text = c.textContent ?? '';
      }
      items.push(text.replace(/\s+/g, ' ').trim().normalize('NFC'));
    }
    return { items, separatorsAfter };
  });
}
/** The accessible name (or text) of the focused element. */
export async function focusedName(page: Page): Promise<string> {
  return page.evaluate(() => {
    const a = document.activeElement as HTMLElement | null;
    if (!a) return '';
    const c = a.cloneNode(true) as HTMLElement;
    c.querySelectorAll('kbd, [data-shortcut], [aria-hidden="true"]').forEach((x) => x.remove());
    return (a.getAttribute('aria-label') ?? c.textContent ?? '').replace(/\s+/g, ' ').trim().normalize('NFC');
  });
}
/** Whether the focus is inside `loc`. */
export async function focusInside(loc: Locator): Promise<boolean> {
  return loc.first().evaluate((e) => !!document.activeElement && (e === document.activeElement || e.contains(document.activeElement))).catch(() => false);
}

// ------------------------------------------------------------------------------------------------ caret

/** Puts the DOM caret inside `loc` after the first occurrence of `after` (or at the end; or at the start) and focuses
 *  the nearest editable root. Returns false when the text isn't there. */
export async function caretAt(loc: Locator, after: string | null = null, atStart = false): Promise<boolean> {
  if (!(await seen(loc, 2000))) return false;
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
    const startEl = node ? node.parentElement! : (el as HTMLElement);
    const host = (startEl.closest('[contenteditable="true"]') as HTMLElement | null) ?? (el as HTMLElement);
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
  await sleep(60);
  return ok;
}
export async function mustCaret(loc: Locator, after: string | null, what: string, atStart = false) {
  assert.ok(await caretAt(loc, after, atStart), `${what}: caret placed${after ? ` after "${after}"` : ''}`);
}

export type CaretRel = 'after' | 'before' | 'inside' | 'elsewhere' | 'range' | 'none' | 'no chip';
/** Where the DOM selection is relative to `chip`: a collapsed caret directly `after` or `before` it (only zero-width
 *  characters between), `inside` it, `elsewhere`, a non-collapsed `range`, or `none`. */
export async function caretRel(chip: Locator): Promise<CaretRel> {
  if (!(await seen(chip, 1000))) return 'no chip';
  return chip.first().evaluate((c) => {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return 'none';
    if (!sel.isCollapsed) return 'range';
    const r = sel.getRangeAt(0);
    if (c.contains(r.startContainer)) return 'inside';
    const clean = (s: string) => s.replace(/[​⁠﻿]/g, '');
    const after = document.createRange();
    after.setStartAfter(c); after.collapse(true);
    const before = document.createRange();
    before.setStartBefore(c); before.collapse(true);
    if (r.compareBoundaryPoints(Range.START_TO_START, after) >= 0) {
      const between = document.createRange();
      between.setStart(after.startContainer, after.startOffset);
      between.setEnd(r.startContainer, r.startOffset);
      return clean(between.toString()) === '' ? 'after' : 'elsewhere';
    }
    if (r.compareBoundaryPoints(Range.START_TO_START, before) <= 0) {
      const between = document.createRange();
      between.setStart(r.startContainer, r.startOffset);
      between.setEnd(before.startContainer, before.startOffset);
      return clean(between.toString()) === '' ? 'before' : 'elsewhere';
    }
    return 'inside';
  }) as Promise<CaretRel>;
}
/** True when the editor shows a ProseMirror node selection (D-926 says a click never makes one). */
export async function nodeSelected(page: Page): Promise<boolean> {
  return (await page.locator('.ProseMirror-selectednode').count()) > 0;
}

/** The middle of the first occurrence of `word` inside `loc`, in viewport coordinates. */
export async function wordPoint(loc: Locator, word: string): Promise<{ x: number; y: number } | null> {
  if (!(await seen(loc, 1000))) return null;
  return loc.first().evaluate((el, w) => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let t = walker.nextNode(); t; t = walker.nextNode()) {
      const i = (t as Text).data.normalize('NFC').indexOf(w);
      if (i < 0) continue;
      const r = document.createRange();
      r.setStart(t, i); r.setEnd(t, i + w.length);
      const b = r.getBoundingClientRect();
      return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
    }
    return null;
  }, nfc(word));
}

// ------------------------------------------------------------------------------------------------ calls

/** Read-only commands of earlier slices plus `embed_load` (ms4-embeds §4) and `index_path_by_id` (v1-previews §2). */
export const PREVIEW_READS = new Set([...READ_COMMANDS, 'embed_load', 'index_path_by_id']);
export async function callsFrom(core: FakeCoreHandle, from = 0): Promise<CallRecord[]> {
  return (await core.calls()).slice(from).filter((c) => !c.cmd.startsWith('plugin:'));
}
export async function callCount(core: FakeCoreHandle): Promise<number> {
  return (await core.calls()).length;
}
export async function cmdsFrom(core: FakeCoreHandle, from = 0): Promise<string[]> {
  return (await callsFrom(core, from)).map((c) => c.cmd);
}
/** Calls that aren't reads (anything that may write the vault), as command names. */
export async function writeCmds(core: FakeCoreHandle, from = 0): Promise<string[]> {
  return (await callsFrom(core, from)).map((c) => c.cmd).filter((c) => !PREVIEW_READS.has(c));
}
export const pathOf = (c: CallRecord) => nfc(String((c.args as any)?.path ?? ''));
export async function noteWrites(core: FakeCoreHandle, path?: string, from = 0): Promise<CallRecord[]> {
  return (await callsFrom(core, from)).filter((c) => c.cmd === 'note_write' && (!path || pathOf(c) === nfc(path)));
}
export async function fileText(core: FakeCoreHandle, path: string): Promise<string | undefined> {
  return (await core.files())[nfc(path)];
}
export async function fileWhen(core: FakeCoreHandle, path: string, ok: (t: string | undefined) => boolean, ms = 3000): Promise<string | undefined> {
  return eventually(() => fileText(core, path), ok, ms);
}
/** `ui_state_set` calls from index `from`, their `preview` sub-objects. */
export async function uiSets(core: FakeCoreHandle, from = 0): Promise<CallRecord[]> {
  return (await callsFrom(core, from)).filter((c) => c.cmd === 'ui_state_set');
}
export const previewOfSet = (c: CallRecord): PreviewUi | undefined => ((c.args as any)?.state ?? (c.args as any)?.ui ?? c.args as any)?.preview;

/** Waits until `Save state` reads `Saved` (editor.md R9). */
export async function stateIs(page: Page, want: string, ms = 3000): Promise<boolean> {
  return (await eventually(async () => flat(await saveState(page).first().innerText({ timeout: 200 }).catch(() => '')), (t) => t === want, ms)) === want;
}
export async function mustBeSaved(page: Page, ms = 3000) {
  assert.ok(await stateIs(page, 'Saved', ms), `Save state should read "Saved" within ${ms} ms`);
}

// ------------------------------------------------------------------------------------------------ a11y, themes, strings

/** Accessible description of an element (aria-describedby texts or aria-description). */
export async function description(loc: Locator): Promise<string> {
  if (!(await seen(loc, 500))) return '<not shown>';
  return loc.first().evaluate((e) => {
    const ids = (e.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean);
    return (e.getAttribute('aria-description') ?? ids.map((id) => document.getElementById(id)?.textContent ?? '').join(' ')).replace(/\s+/g, ' ').trim();
  });
}
export async function isDisabled(loc: Locator): Promise<boolean> {
  return loc.first().evaluate((e) => (e as HTMLButtonElement).disabled === true || e.getAttribute('aria-disabled') === 'true');
}

const AXE = createRequire(import.meta.url).resolve('axe-core/axe.min.js');
/** axe `color-contrast` violations inside `scope` (FR-UX-05 AC-4), as target selectors. */
export async function axeContrastIn(page: Page, scope: Locator): Promise<string[]> {
  if (!(await page.evaluate(() => 'axe' in window))) await page.addScriptTag({ path: AXE });
  const el = await scope.first().elementHandle();
  assert.ok(el, 'axe scope element');
  return page.evaluate(async (node) => {
    const r = await (window as any).axe.run(node, { runOnly: { type: 'rule', values: ['color-contrast'] } });
    return r.violations.flatMap((x: any) => x.nodes.map((n: any) => n.target.join(' ')));
  }, el);
}

/** Computed colours inside `scope` that aren't a token of the theme (FR-UX-05 AC-5), as in the read-view theme test. */
export async function colourLeaksIn(scope: Locator, theme: 'light' | 'dark'): Promise<string[]> {
  return scope.first().evaluate(async (root, th) => {
    const tokens = (await import('/src/theme/tokens.ts' as string))[th] as Record<string, string>;
    const probe = document.createElement('div');
    document.body.appendChild(probe);
    const allowed = new Set<string>(['rgba(0, 0, 0, 0)', 'transparent']);
    for (const v of Object.values(tokens ?? {})) { probe.style.color = ''; probe.style.color = v; allowed.add(getComputedStyle(probe).color); }
    probe.remove();
    if (Object.keys(tokens ?? {}).length === 0) return ['no tokens for this theme'];
    const out = new Set<string>();
    for (const e of [root, ...root.querySelectorAll('*')]) {
      const el = e as HTMLElement;
      if (el.getClientRects().length === 0) continue;
      const s = getComputedStyle(el);
      if (s.visibility === 'hidden') continue;
      const props: [string, string][] = [['color', s.color], ['background-color', s.backgroundColor]];
      for (const side of ['Top', 'Right', 'Bottom', 'Left'] as const) {
        if (parseFloat((s as any)[`border${side}Width`]) > 0 && (s as any)[`border${side}Style`] !== 'none') props.push([`border-${side.toLowerCase()}-color`, (s as any)[`border${side}Color`]]);
      }
      for (const [p, v] of props) if (!allowed.has(v)) out.add(`${el.tagName.toLowerCase()} ${p} ${v}`);
    }
    return [...out].slice(0, 20);
  }, theme);
}

/** The computed colour of a theme token in the page (e.g. `focus`), or null. */
export async function tokenColour(page: Page, key: string): Promise<string | null> {
  return page.evaluate(async (k) => {
    const th = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
    const v = ((await import('/src/theme/tokens.ts' as string))[th] as Record<string, string>)?.[k];
    if (!v) return null;
    const p = document.createElement('div');
    p.style.color = v;
    document.body.appendChild(p);
    const c = getComputedStyle(p).color;
    p.remove();
    return c;
  }, key);
}

/** Pseudo-locale check (NFR-OTH-02): visible words and accessible names inside `scope` outside ⟦ ⟧, skipping user
 *  content (`data-user-content`), key hints (`kbd`, `data-shortcut`) and form values. */
export async function unmarkedIn(scope: Locator): Promise<string[]> {
  return scope.first().evaluate((root) => {
    let all = '';
    const names: string[] = [];
    const walk = (n: Node) => {
      if (n.nodeType === Node.ELEMENT_NODE) {
        const el = n as HTMLElement;
        if (el.hasAttribute('data-user-content')) { all += ' '; return; }
        if (el.tagName === 'SCRIPT' || el.tagName === 'STYLE' || el.tagName === 'KBD' || el.hasAttribute('data-shortcut')) return;
        if (el.getClientRects().length === 0) return;
        if (getComputedStyle(el).visibility === 'hidden') return;
        for (const a of ['aria-label', 'aria-description', 'title', 'placeholder']) {
          const v = el.getAttribute(a);
          if (v && v.replace(/⟦[^⟦⟧]*⟧/g, '').match(/\p{L}{2,}/u)) names.push(`${a}=${v}`);
        }
      }
      if (n.nodeType === Node.TEXT_NODE) { all += n.textContent; return; }
      for (const c of n.childNodes) walk(c);
    };
    walk(root);
    const outside = all.replace(/⟦[^⟦⟧]*⟧/g, ' ');
    const words = (outside.match(/[\p{L}][\p{L}'’]*/gu) ?? []).filter((w, i, a) => a.indexOf(w) === i);
    return [...words, ...names];
  });
}

/** Controls inside `scope` without a `data-command` (FR-UX-03 AC-8), as keyboard.ac.test.ts checks them. */
export async function controlsWithoutCommand(scope: Locator): Promise<string[]> {
  const sel = 'button, a[href], [role="button"], [role="link"], [role="tab"], [role="menuitem"], [role="checkbox"], [role="radio"], [role="switch"], [role="slider"], input[type="checkbox"], input[type="radio"], input[type="range"]';
  return scope.first().evaluate((root, s) => {
    const out: string[] = [];
    for (const e of root.querySelectorAll(s)) {
      const el = e as HTMLElement;
      if (el.getClientRects().length === 0) continue;
      if (el.closest('[data-user-content]')) continue; // links inside rendered user content (the popover body)
      const cmd = el.getAttribute('data-command');
      if (!cmd || !cmd.trim()) out.push(`${el.tagName.toLowerCase()} "${(el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 40)}"`);
    }
    return out;
  }, sel);
}

/** The focused element's outline (FR-UX-05, D-594). */
export async function focusOutline(page: Page): Promise<{ name: string; style: string; width: number; color: string; visible: boolean }> {
  return page.evaluate(() => {
    const a = document.activeElement as HTMLElement | null;
    if (!a) return { name: '', style: 'none', width: 0, color: '', visible: false };
    const s = getComputedStyle(a);
    return { name: a.getAttribute('aria-label') ?? (a.textContent ?? '').trim(), style: s.outlineStyle, width: parseFloat(s.outlineWidth) || 0, color: s.outlineColor, visible: a.matches(':focus-visible') };
  });
}

/** Presses Tab up to `max` times until the focused element's name is `name`; returns whether it got there. */
export async function tabTo(page: Page, name: string, max = 40): Promise<boolean> {
  for (let i = 0; i < max; i++) {
    if ((await focusedName(page)) === name) return true;
    await page.keyboard.press('Tab');
    await sleep(30);
  }
  return (await focusedName(page)) === name;
}

/** Records whether the editor consumed a keydown (defaultPrevented at the window's bubble phase, or never reached it). */
/** Starts recording keydowns (again): the listeners are installed once per page; a later call resets the records. */
export async function recordKeydowns(page: Page) {
  await page.evaluate(() => {
    const w = window as any;
    w.__pvKeys = [];
    w.__pvSeen = [];
    if (w.__pvKeysInstalled) return;
    w.__pvKeysInstalled = true;
    window.addEventListener('keydown', (e) => { w.__pvSeen.push(e); w.__pvKeys.push({ key: e.key, code: e.code, alt: e.altKey, reached: false, prevented: false }); }, true);
    window.addEventListener('keydown', (e) => {
      const i = (w.__pvSeen as KeyboardEvent[]).indexOf(e);
      if (i >= 0) { w.__pvKeys[i].reached = true; w.__pvKeys[i].prevented = e.defaultPrevented; }
    }, false);
  });
}
export async function keydowns(page: Page): Promise<{ key: string; code: string; alt: boolean; reached: boolean; prevented: boolean }[]> {
  return page.evaluate(() => [...((window as any).__pvKeys ?? [])]);
}

/** The box of a locator, or null when not shown. */
export async function box(loc: Locator) {
  if (!(await seen(loc, 500))) return null;
  return loc.first().boundingBox();
}
