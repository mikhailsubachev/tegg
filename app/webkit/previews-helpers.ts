// Helpers for the v1.0 slice P WebKit tests (L5): the previews fixture in the fake core (plus new-empty/.tegg and the
// runtime files of its README: `_attachments/graf.png`, `_attachments/Smlouva.pdf`, `Pages/Dlouhá.md`), the test clock
// of docs/acceptance/previews.md (2026-10-28T10:00:00+01:00, Europe/Prague, region en-US), the stored Object preview
// mode (v1-previews §1, §9), locators for the R102 parts and call probes. No AC assertions here except `must`
// (re-exported) and the `need*` lookups, which turn a missing element into an AssertionError instead of a Playwright
// timeout (TS-I1). Written from the ACs and the contract only (D-61); other slice P test files may import it.
import type { Locator, Page } from '@playwright/test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadFixtureVault, type CallRecord, type FakeVault, type UiStateDto } from '../ui/test/fake-core';
import { READ_COMMANDS, absent, eventually, focusSettled, mainName, must, mustBeOn, runCommand, seen, sidebar, sleep, start, type FakeCoreHandle, type StartOptions } from './helpers';

export { absent, eventually, focusSettled, mainName, must, mustBeOn, runCommand, seen, sidebar, sleep };
export type { CallRecord, FakeCoreHandle, FakeVault };

export const nfc = (s: string) => s.normalize('NFC');
export const nfd = (s: string) => s.normalize('NFD');
export const flat = (s: string | null | undefined) => nfc((s ?? '').replace(/[\s ]+/g, ' ').replace(/ ([.,;:!?])/g, '$1').trim());
export const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const exactRe = (s: string) => new RegExp(`^\\s*${esc(nfc(s))}\\s*$`);

const REPO = resolve(import.meta.dirname, '../..');

/** The test clock (previews.md "Test clock"): a Wednesday, three days after the change to CET. */
export const NOW = '2026-10-28T10:00:00+01:00';
export const ZONE = 'Europe/Prague';
export const REGION = 'en-US';

/** The fixture's paths (tests/fixtures/vaults/previews/README.md). */
export const PV = {
  rozpocet: 'Pages/Rozpočet 2027.md',
  jana: 'Osoby/Jana Nováková.md',
  petr: 'Osoby/Petr Dvořák.md',
  alfa: 'Projekty/Projekt Alfa.md',
  odkazy: 'Pages/Odkazy.md',
  vlozeni: 'Pages/Vložení.md',
  kruhA: 'Pages/Kruh A.md',
  kruhB: 'Pages/Kruh B.md',
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
  sablona: '_templates/Page/Šablona.md',
  smazana: '.trash/Pages/Smazaná.md',
  dlouha: 'Pages/Dlouhá.md',
  png: '_attachments/graf.png',
  pdf: '_attachments/Smlouva.pdf',
  osobaYml: '.tegg/types/osoba.yml',
  projektYml: '.tegg/types/projekt.yml',
} as const;

export const TITLES: Record<string, string> = {
  [PV.rozpocet]: 'Rozpočet 2027', [PV.jana]: 'Jana Nováková', [PV.petr]: 'Petr Dvořák', [PV.alfa]: 'Projekt Alfa', [PV.odkazy]: 'Odkazy',
  [PV.vlozeni]: 'Vložení', [PV.kruhA]: 'Kruh A', [PV.kruhB]: 'Kruh B', [PV.ukol]: 'Zavolat Janě', [PV.porada]: 'Porada 2026-10-27',
  [PV.denni]: '2026-10-07', [PV.ucty]: 'Účty', [PV.graf]: 'Graf', [PV.smlouva]: 'Smlouva', [PV.planP]: 'Plán', [PV.planQ]: 'Plán',
  [PV.prazdna]: 'Prázdná', [PV.neplatna]: 'Neplatná hlavička', [PV.napad]: 'Nápad na podcast', [PV.mapa]: 'Mapa', [PV.dlouha]: 'Dlouhá',
};

/** `Pages/Dlouhá.md` (README "Created at runtime"): 3,000 paragraphs, a `## Kapitola <k>` before 1, 101, 201, … */
export function dlouhaText(): string {
  const blocks: string[] = [];
  for (let n = 1; n <= 3000; n++) {
    if ((n - 1) % 100 === 0) blocks.push(`## Kapitola ${(n - 1) / 100 + 1}`);
    blocks.push(`Odstavec ${n}.`);
  }
  return `---\nid: 01JBPV0000000000000000P030\ntype: page\ntitle: Dlouhá\n---\n${blocks.join('\n\n')}\n`;
}
/** The 3,030 blocks of Dlouhá in file order (FR-LNK-10 AC-14). */
export function dlouhaBlocks(): string[] {
  const out: string[] = [];
  for (let n = 1; n <= 3000; n++) {
    if ((n - 1) % 100 === 0) out.push(`Kapitola ${(n - 1) / 100 + 1}`);
    out.push(`Odstavec ${n}.`);
  }
  return out;
}

/** A file of `tests/fixtures/vaults/trash-media/_attachments/` found by its NFC name (README "Created at runtime"). */
function trashMediaFile(name: string): Buffer {
  const dir = resolve(REPO, 'tests/fixtures/vaults/trash-media/_attachments');
  const hit = readdirSync(dir).find((f) => nfc(f) === nfc(name));
  assert.ok(hit, `tests/fixtures/vaults/trash-media/_attachments/${name} exists`);
  return readFileSync(resolve(dir, hit!));
}
export const grafPng = () => new Uint8Array(trashMediaFile('záhon.png'));

/** The previews fixture plus `new-empty/.tegg` (previews.md "Fixture"; the README isn't a vault file), the two runtime
 *  attachments as binary files and `Pages/Dlouhá.md`. `edit` changes text files before the app starts. */
export function previewsVault(edit?: (files: Record<string, string>, bin: Record<string, string>) => void): FakeVault {
  const v = loadFixtureVault('tests/fixtures/vaults/previews', 'tests/fixtures/vaults/new-empty/.tegg');
  delete v.files['README.md'];
  v.files[nfc(PV.dlouha)] = dlouhaText();
  const bin: Record<string, string> = {
    [nfc(PV.png)]: trashMediaFile('záhon.png').toString('base64'),
    [nfc(PV.pdf)]: trashMediaFile('Rozpočet.pdf').toString('base64'),
  };
  edit?.(v.files, bin);
  return { name: 'Náhledy', files: v.files, bin };
}
export const original = (path: string) => previewsVault().files[nfc(path)];
export const idOf = (text: string | undefined) => /^id: (\S+)$/m.exec(text ?? '')?.[1] ?? null;
export function swap(text: string | undefined, from: string, to: string): string {
  assert.ok(text !== undefined && text.includes(from), `fixture text contains ${JSON.stringify(from)}`);
  return text!.replace(from, to);
}
export const noModified = (t: string | undefined) => (t ?? '').replace(/^modified: .*$/m, 'modified: <x>');

export type PreviewMode = 'click' | 'hover' | 'off';
export type PreviewUi = NonNullable<UiStateDto['preview']>;
/** The stored UI state; `preview` is left out when not given (the fake then stores `click`, D-1164's test rule, unless
 *  `previewStored: 'asGiven'`). */
export const ui = (o: { theme?: UiStateDto['theme']; panel?: boolean; preview?: PreviewUi } = {}): UiStateDto => ({
  version: 1, theme: o.theme ?? 'light', sidebarOpen: true, rightPanel: { open: o.panel ?? false, tab: 'backlinks' }, propertiesOpen: true,
  ...(o.preview ? { preview: o.preview } : {}),
});

export type PreviewsStart = StartOptions & {
  vault?: FakeVault;
  /** Land on this note (`vault_last`, D-132). */
  at?: string;
  /** Start on this route (`window.__TEGG_ROUTE__`, ms3-shell §3.7), e.g. `tasks`, `type/osoba`. */
  route?: string;
  /** The stored Object preview mode (missing = click stored, D-1164's test rule; `previewStored: 'asGiven'` and the
   *  v0.94 files store nothing: hover, the default). */
  mode?: PreviewMode;
  hoverDelay?: number;
  /** The stored popover size. */
  size?: { width?: number; height?: number };
  theme?: UiStateDto['theme'];
  panel?: boolean;
  /** Read view (the D-215 switch, the `__TEGG_TEST__.readView` hook of the 3B tests). */
  readView?: boolean;
  /** Clock (default NOW). */
  now?: string;
  /** `page.clock.install` instead of `setFixedTime` (hover timing tests advance it with `page.clock.runFor`). */
  install?: boolean;
  region?: string;
  reducedMotion?: 'reduce' | 'no-preference';
};

/** Starts the main window on the previews vault (zone from `test.use({ timezoneId })`). */
export async function startPreviews(page: Page, o: PreviewsStart = {}): Promise<FakeCoreHandle> {
  await page.addInitScript((r) => { (window as any).__TEGG_REGION__ = r; }, o.region ?? REGION);
  if (o.readView) await page.addInitScript(() => { const w = window as any; w.__TEGG_TEST__ = { ...(w.__TEGG_TEST__ ?? {}), readView: true }; });
  if (o.route) await page.addInitScript((r) => { (window as any).__TEGG_ROUTE__ = r; }, o.route);
  if (o.reducedMotion) await page.emulateMedia({ reducedMotion: o.reducedMotion });
  const t = new Date(o.now ?? NOW);
  if (o.install) await page.clock.install({ time: t });
  else await page.clock.setFixedTime(t);
  const vault = o.vault ?? previewsVault();
  const last = o.at ? { path: nfc(o.at), id: idOf(vault.files[nfc(o.at)]) } : null;
  const preview: PreviewUi | undefined = o.mode || o.hoverDelay || o.size ? { ...(o.mode ? { mode: o.mode } : {}), ...(o.hoverDelay ? { hoverDelay: o.hoverDelay } : {}), ...(o.size ?? {}) } : undefined;
  const core = await start(page, { ...o, vault, last, uiState: o.uiState ?? ui({ theme: o.theme, panel: o.panel, preview }) });
  if (o.at && TITLES[o.at] && !o.route) await mustBeOn(page, TITLES[o.at], `landing on ${o.at}`, 5000);
  return core;
}

// ------------------------------------------------------------------------------------------------ R102 locators

/** Every preview popover (`dialog` named `Preview: …`, R102); the pseudo-locale wraps the name in ⟦⟧. */
export const previews = (page: Page) => page.getByRole('dialog', { name: /^⟦?Preview: / });
/** The popover of `title` (for a `#Heading` link the dialog may carry `<title> › <heading>`). */
export const preview = (page: Page, title: string) => page.getByRole('dialog', { name: `Preview: ${nfc(title)}`, exact: true });
export const backBtn = (dlg: Locator, prev: string) => dlg.getByRole('button', { name: `Back to ${nfc(prev)}`, exact: true });
export const anyBack = (dlg: Locator) => dlg.getByRole('button', { name: /^Back to / });
export const closeBtn = (dlg: Locator) => dlg.getByRole('button', { name: 'Close preview', exact: true });
export const strip = (dlg: Locator) => dlg.getByRole('region', { name: 'Preview properties', exact: true });
export const content = (dlg: Locator, title: string) => dlg.getByRole('article', { name: `Content of ${nfc(title)}`, exact: true });
export const anyContent = (dlg: Locator) => dlg.getByRole('article', { name: /^Content of / });
export const openBtn = (dlg: Locator, title: string) => dlg.getByRole('button', { name: `Open ${nfc(title)}`, exact: true });
export const resizeHandle = (dlg: Locator) => dlg.locator('[data-preview-resize]');
export const header = (dlg: Locator) => dlg.locator('header').first();

/** Number of preview popovers in the DOM (R102: one at a time). */
export async function previewCount(page: Page): Promise<number> {
  return previews(page).count();
}
/** Asserts that `Preview: <title>` is shown and that it is the only preview in the window. */
export async function needPreview(page: Page, title: string, what: string, ms = 3000): Promise<Locator> {
  const d = preview(page, title);
  assert.ok(await seen(d, ms), `${what}: dialog "Preview: ${nfc(title)}" is not shown (got ${JSON.stringify(await previewNames(page))}, centre pane ${JSON.stringify(await mainName(page))})`);
  const n = await previewCount(page);
  assert.equal(n, 1, `${what}: exactly one preview popover in the window (got ${n})`);
  return d.first();
}
/** Asserts that some preview is shown; returns it. */
export async function needAnyPreview(page: Page, what: string, ms = 3000): Promise<Locator> {
  assert.ok(await seen(previews(page), ms), `${what}: no preview popover (dialog "Preview: …") is shown (centre pane ${JSON.stringify(await mainName(page))})`);
  return previews(page).first();
}
/** Waits `ms` and asserts that no preview popover is in the DOM. */
export async function needNoPreview(page: Page, what: string, ms = 600) {
  await sleep(ms);
  const names = await previewNames(page);
  assert.deepEqual(names, [], `${what}: no preview popover is shown`);
}
/** Waits until no preview popover is shown; asserts it. */
export async function needClosed(page: Page, what: string, ms = 2000) {
  const n = await eventually(() => previewCount(page), (c) => c === 0, ms);
  assert.equal(n, 0, `${what}: the preview popover closes`);
}
export async function previewNames(page: Page): Promise<string[]> {
  return page.evaluate(() => [...document.querySelectorAll('[role="dialog"]')]
    .map((d) => {
      const l = d.getAttribute('aria-label');
      if (l) return l;
      const ids = (d.getAttribute('aria-labelledby') ?? '').split(/\s+/).filter(Boolean);
      return ids.map((id) => document.getElementById(id)?.textContent ?? '').join(' ');
    })
    .map((s) => s.replace(/\s+/g, ' ').trim().normalize('NFC'))
    .filter((s) => /^⟦?Preview: /.test(s)));
}
export async function previewPath(dlg: Locator): Promise<string | null> {
  const p = await dlg.first().getAttribute('data-preview-path').catch(() => null);
  return p === null ? null : nfc(p);
}

/** The header as data: the first icon's `data-icon`, the `h2` text, and the header's text after the `h2`. */
export async function headerInfo(dlg: Locator): Promise<{ icon: string | null; icons: string[]; title: string; rest: string; text: string } | null> {
  return dlg.first().evaluate((d) => {
    const h = d.querySelector('header');
    if (!h) return null;
    const f = (s: string | null | undefined) => (s ?? '').replace(/[\s ]+/g, ' ').trim().normalize('NFC');
    const h2 = h.querySelector('h2');
    const text = f((h as HTMLElement).innerText);
    const title = f(h2 ? (h2 as HTMLElement).innerText : '');
    const icons = [...h.querySelectorAll('[data-icon]')].map((e) => e.getAttribute('data-icon') ?? '');
    const i = text.indexOf(title);
    return { icon: icons[0] ?? null, icons, title, rest: f(i >= 0 ? text.slice(i + title.length) : text), text };
  }).catch(() => null);
}
export async function needHeader(dlg: Locator, what: string) {
  const h = await headerInfo(dlg);
  assert.ok(h, `${what}: the popover has a header element (R102)`);
  return h!;
}

/** The strip's items as flat text (`<Name> <value>`), in order; null when there is no strip region. */
export async function stripItems(dlg: Locator): Promise<string[] | null> {
  const s = strip(dlg);
  if ((await s.count()) === 0) return null;
  return s.first().evaluate((r) => {
    const f = (x: string | null | undefined) => (x ?? '').replace(/[\s ]+/g, ' ').trim().normalize('NFC');
    let items = [...r.querySelectorAll('[role="listitem"], li')] as HTMLElement[];
    if (items.length === 0) {
      let root: Element = r;
      while (root.children.length === 1) root = root.children[0];
      items = [...root.children] as HTMLElement[];
    }
    return items.filter((e) => e.getClientRects().length > 0).map((e) => f(e.innerText)).filter(Boolean);
  });
}

/** The body article's content in document order: `P:`/`H<n>:`/`LI:` texts, `IMG:<src>` and `CARD:<title>` for an
 *  embed card (nested content of a card is not walked). */
export async function contentSequence(article: Locator): Promise<string[]> {
  return article.first().evaluate((root) => {
    const f = (x: string | null | undefined) => (x ?? '').replace(/[\s ]+/g, ' ').replace(/ ([.,;:!?])/g, '$1').trim().normalize('NFC');
    const out: string[] = [];
    const walk = (e: Element) => {
      for (const c of [...e.children]) {
        const el = c as HTMLElement;
        if (el.getClientRects().length === 0 && el.tagName !== 'IMG') continue;
        const label = el.getAttribute('aria-label') ?? '';
        if (el.hasAttribute('data-embed-mode') || /^Embedded: /.test(label)) {
          const t = /^Embedded: (.*)$/.exec(label)?.[1] ?? f((el.querySelector('h1, h2, h3, h4, h5, h6, [data-embed-title]') as HTMLElement | null)?.innerText ?? el.innerText.split('\n')[0]);
          out.push(`CARD:${f(t)}`);
          continue;
        }
        if (el.tagName === 'IMG') { out.push(`IMG:${el.getAttribute('src') ?? ''}`); continue; }
        const m = /^H([1-6])$/.exec(el.tagName);
        if (m) { out.push(`H${m[1]}:${f(el.innerText)}`); continue; }
        if (el.tagName === 'P' || el.tagName === 'LI') {
          const imgs = [...el.querySelectorAll('img')];
          const t = f(el.innerText);
          if (t) out.push(`${el.tagName}:${t}`);
          for (const i of imgs) out.push(`IMG:${i.getAttribute('src') ?? ''}`);
          if (el.tagName === 'LI') continue;
          continue;
        }
        walk(el);
      }
    };
    walk(root);
    return out;
  });
}
/** Visible text of a locator, flattened. */
export async function textOf(loc: Locator): Promise<string> {
  return flat(await loc.first().innerText({ timeout: 1000 }).catch(() => ''));
}

/** Accessible description of an element (aria-describedby texts or aria-description). */
export async function description(loc: Locator): Promise<string> {
  return loc.first().evaluate((e) => {
    const ids = (e.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean);
    return (e.getAttribute('aria-description') ?? ids.map((id) => document.getElementById(id)?.textContent ?? '').join(' ')).replace(/\s+/g, ' ').trim();
  }).catch(() => '');
}
export async function isDisabled(loc: Locator): Promise<boolean> {
  return loc.first().evaluate((e) => (e as HTMLButtonElement).disabled === true || e.getAttribute('aria-disabled') === 'true');
}
/** Whether the focus is inside `loc` (or on it). */
export async function focusInside(loc: Locator): Promise<boolean> {
  return loc.first().evaluate((e) => !!document.activeElement && (e === document.activeElement || e.contains(document.activeElement))).catch(() => false);
}
/** The focused element: tag, role, accessible name, and whether it is in the editor body. */
export async function focusInfo(page: Page): Promise<{ tag: string; role: string; name: string; inBody: boolean; inPreview: boolean }> {
  return page.evaluate(() => {
    const a = document.activeElement as HTMLElement | null;
    if (!a || a === document.body) return { tag: 'body', role: '', name: '', inBody: false, inPreview: false };
    const ids = (a.getAttribute('aria-labelledby') ?? '').split(/\s+/).filter(Boolean);
    const name = (a.getAttribute('aria-label') ?? (ids.length ? ids.map((i) => document.getElementById(i)?.textContent ?? '').join(' ') : a.innerText) ?? '').replace(/\s+/g, ' ').trim().normalize('NFC');
    return {
      tag: a.tagName.toLowerCase(), role: a.getAttribute('role') ?? '', name,
      inBody: !!a.closest('[aria-label="Note body"]'),
      inPreview: !!a.closest('[role="dialog"][data-preview-path]') || /^Preview: /.test(a.getAttribute('aria-label') ?? ''),
    };
  });
}

// ------------------------------------------------------------------------------------------------ references

export const main = (page: Page) => page.getByRole('main');
export const editorBody = (page: Page) => page.getByRole('textbox', { name: /^⟦?Note body⟧?$/ });
export const readArticle = (page: Page, title: string) => main(page).getByRole('article', { name: nfc(title), exact: true });
/** The note body of the open note, editor or read view. */
export const noteBody = (page: Page, title: string) => editorBody(page).or(readArticle(page, title));
export const saveState = (page: Page) => page.getByRole('status', { name: 'Save state', exact: true });
export const props = (page: Page) => main(page).getByRole('region', { name: 'Properties', exact: true });
export const contextPanel = (page: Page) => page.getByRole('complementary', { name: 'Context panel' });
export const backlinksPanel = (page: Page) => page.getByRole('tabpanel', { name: 'Backlinks' });
export const createOffer = (page: Page) => page.getByRole('dialog', { name: 'Create note' });
export const paletteDialog = (page: Page) => page.getByRole('dialog', { name: 'Command palette' });
export const searchQuery = (page: Page) => page.getByRole('searchbox', { name: /^⟦?Search query⟧?$/ }).or(page.getByRole('textbox', { name: /^⟦?Search query⟧?$/ })).first();
export const searchResults = (page: Page) => page.getByRole('list', { name: 'Search results', exact: true });
export const goToList = (page: Page) => page.getByRole('listbox', { name: /^⟦?Go to⟧?$/ });
export const sourceRegion = (page: Page) => page.getByRole('region', { name: 'Markdown source', exact: true });
export const TOGGLE_SOURCE = 'Alt+Meta+KeyU';

/** A top-level paragraph of the note body whose text starts with `start` (Odkazy has one paragraph per case). */
export const para = (scope: Locator, start: string) => scope.locator('p').filter({ hasText: new RegExp(`^\\s*${esc(nfc(start))}`) });
/** The `n`-th (0-based) link in the paragraph starting with `start`. */
export const linkIn = (scope: Locator, start: string, n = 0) => para(scope, start).first().getByRole('link').nth(n);
/** A link (chip) by its exact visible name inside `scope`. */
export const chipNamed = (scope: Locator, name: string) => scope.getByRole('link', { name: nfc(name), exact: true });

export async function need(loc: Locator, what: string, ms = 5000): Promise<Locator> {
  assert.ok(await seen(loc, ms), `${what} is not shown`);
  return loc.first();
}
/** The `n`-th link of Odkazy's paragraph starting with `start` (editor or read view). */
export async function needOdkazyLink(page: Page, start: string, n = 0, what = `link ${n + 1} of the paragraph "${start}…" in Odkazy`): Promise<Locator> {
  return need(linkIn(noteBody(page, 'Odkazy'), start, n), what);
}
/** Clicks `ref` and asserts that `Preview: <title>` opens (R103 click mode). */
export async function clickToPreview(page: Page, ref: Locator, title: string, what: string): Promise<Locator> {
  await ref.click();
  return needPreview(page, title, what);
}

/** The bounding boxes of the popover and a reference; null parts when not shown. */
export async function boxes(dlg: Locator, ref: Locator) {
  return { d: await dlg.first().boundingBox().catch(() => null), r: await ref.first().boundingBox().catch(() => null) };
}
/** R102 placement: 8 px below the reference (or 8 px above it), not covering it, 8 px inside the window (± `tol`). */
export async function placementOf(page: Page, dlg: Locator, ref: Locator, tol = 2) {
  const { d, r } = await boxes(dlg, ref);
  const vp = page.viewportSize() ?? { width: 1440, height: 900 };
  if (!d || !r) return { ok: false, why: `boxes ${JSON.stringify({ d, r })}`, d, r };
  const below = Math.abs(d.y - (r.y + r.height + 8)) <= tol;
  const above = Math.abs(d.y + d.height - (r.y - 8)) <= tol;
  const overlap = !(d.x + d.width <= r.x + 0.5 || r.x + r.width <= d.x + 0.5 || d.y + d.height <= r.y + 0.5 || r.y + r.height <= d.y + 0.5);
  const inside = d.x >= 8 - tol && d.y >= 8 - tol && d.x + d.width <= vp.width - 8 + tol && d.y + d.height <= vp.height - 8 + tol;
  return { ok: (below || above) && !overlap && inside, below, above, overlap, inside, d, r, why: JSON.stringify({ d, r, below, above, overlap, inside }) };
}

// ------------------------------------------------------------------------------------------------ calls

/** Read-only commands (helpers.ts READ_COMMANDS) plus slice P's `index_path_by_id` (v1-previews §2). */
export const PREVIEW_READS = new Set([...READ_COMMANDS, 'embed_load', 'index_path_by_id', 'tag_objects', 'tag_usage', 'media_open', 'media_reveal']);
/** Index of the next call; pass it to `callsSince`. */
export async function mark(core: FakeCoreHandle): Promise<number> {
  return (await core.calls()).length;
}
export async function callsSince(core: FakeCoreHandle, from: number, cmd?: string): Promise<CallRecord[]> {
  return (await core.calls()).slice(from).filter((c) => !c.cmd.startsWith('plugin:') && (!cmd || c.cmd === cmd));
}
/** Commands since `from` that aren't reads (any vault write, D-923: `ui_state_set` is machine-local and a read here). */
export async function writesSince(core: FakeCoreHandle, from = 0): Promise<string[]> {
  return (await callsSince(core, from)).map((c) => c.cmd).filter((c) => !PREVIEW_READS.has(c));
}
export const pathOf = (c: CallRecord) => nfc(String((c.args as any)?.path ?? ''));
/** The `paths` of every `embed_load` call since `from`. */
export async function embedLoadsSince(core: FakeCoreHandle, from = 0): Promise<string[][]> {
  return (await callsSince(core, from, 'embed_load')).map((c) => ((c.args as any)?.paths ?? []).map((p: string) => nfc(String(p))));
}
/** Paths routed by `nav_opened` since `from`. */
export async function navsSince(core: FakeCoreHandle, from = 0): Promise<string[]> {
  return (await callsSince(core, from, 'nav_opened')).map(pathOf);
}
export async function fileText(core: FakeCoreHandle, path: string): Promise<string | undefined> {
  return (await core.files())[nfc(path)];
}
export async function fileWhen(core: FakeCoreHandle, path: string, ok: (t: string | undefined) => boolean, ms = 3000): Promise<string | undefined> {
  return eventually(() => fileText(core, path), ok, ms);
}
/** Every vault file's text (for "nothing changed" checks). */
export async function snapshot(core: FakeCoreHandle): Promise<Record<string, string>> {
  return core.files();
}

// ------------------------------------------------------------------------------------------------ pages

/** Back (⌘[), then the centre pane named `name`. */
export async function back(page: Page, name: string, what = `Back to ${name}`) {
  await page.keyboard.press('Meta+BracketLeft');
  await mustBeOn(page, nfc(name), what, 5000);
}
/** `search` with `q` typed in `Search query`; waits for a full-text result row containing `title`. */
export async function searchFor(page: Page, q: string, title: string): Promise<Locator> {
  await page.keyboard.press('Meta+Shift+f');
  await mustBeOn(page, 'Search', 'the search route (⇧⌘F)', 5000);
  const f = await need(searchQuery(page), 'textbox "Search query"', 3000);
  await f.fill(q);
  return need(searchResults(page).getByRole('listitem').filter({ hasText: nfc(title) }), `full-text result row "${title}" for ${JSON.stringify(q)}`, 5000);
}
export const typeTable = (page: Page, plural: string) => main(page).getByRole('table', { name: plural, exact: true });
export const tagObjectsTable = (page: Page, name: string) => main(page).getByRole('table', { name: `Objects with #${nfc(name)}`, exact: true });
export const tagsTable = (page: Page) => main(page).getByRole('table', { name: 'Tags', exact: true });
export const tagRoute = (key: string) => `tag/${encodeURIComponent(nfc(key))}`;
export const taskCard = (page: Page, title: string) => main(page).getByRole('article', { name: `Task: ${nfc(title)}`, exact: true });
export const taskCheckbox = (scope: Locator, title: string) => scope.getByRole('checkbox', { name: new RegExp(`^(Complete|Mark) "${esc(nfc(title))}"( not done)?$`) });
export const dailySection = (page: Page, name: 'Quick Notes' | 'Tasks due' | 'Created' | 'Modified') => main(page).getByRole('region', { name, exact: true });
export const frame = (scope: Locator, title: string) => scope.getByRole('group', { name: `Embedded: ${nfc(title)}`, exact: true });
export const topEmbed = (scope: Locator, n: number) => scope.locator('[data-embed-mode]:not([data-embed-mode] [data-embed-mode])').nth(n);
export const linkEmbed = (scope: Locator, title: string) => scope.locator('[data-embed-mode="link"]').filter({ hasText: exactRe(title) });
export const mindmapFigure = (page: Page, title: string) => main(page).getByRole('figure', { name: `Mindmap: ${nfc(title)}`, exact: true });
export const mapNode = (fig: Locator, text: string) => fig.getByRole('treeitem', { name: nfc(text), exact: true });
/** Indexes (1-based) of host blocks with `data-block-selected`. */
export async function selectedBlocks(page: Page): Promise<number[]> {
  return editorBody(page).first().evaluate((b) => [...b.children].map((e, i) => (e.hasAttribute('data-block-selected') ? i + 1 : 0)).filter(Boolean)).catch(() => []);
}
/** Selects host block `n` (1-based) as a block from the keyboard (embeds.md FR-EMB-02 AC-14): the caret at the end of
 *  the first host block, then ↓ until `n` is selected; inside a full embed's editable body (FR-EMB-03) Esc selects the
 *  embed as a block. D-1166: embeds are previewed this way (⌥Space) now that a click opens them. */
export async function selectHostBlock(page: Page, n: number, what: string) {
  const first = editorBody(page).locator(':scope > *').first();
  await focusSettled(page); // issue 112: after Esc gave the focus back to the editor, the click below keeps its caret
  await first.scrollIntoViewIfNeeded();
  const fb = (await first.boundingBox())!;
  await page.mouse.click(fb.x + fb.width - 4, fb.y + fb.height / 2);
  await page.keyboard.press('End');
  await sleep(100);
  for (let i = 0; i < 12 && !(await selectedBlocks(page)).includes(n); i++) {
    await page.keyboard.press('ArrowDown');
    await sleep(100);
    if ((await selectedBlocks(page)).length === 0) { await page.keyboard.press('Escape'); await sleep(100); }
  }
  assert.deepEqual(await selectedBlocks(page), [n], `${what}: host block ${n} is selected as a block`);
}
/** Waits for `Save state` to read `Saved` (editor.md R9). */
export async function savedWithin(page: Page, ms = 3000): Promise<boolean> {
  return (await eventually(async () => flat(await saveState(page).first().innerText({ timeout: 200 }).catch(() => '')), (t) => t === 'Saved', ms)) === 'Saved';
}
/** The top of `el` relative to its nearest scrolling ancestor's top (px), or null. */
export async function topInScroller(loc: Locator): Promise<number | null> {
  return loc.first().evaluate((e) => {
    let sc: HTMLElement | null = e.parentElement;
    while (sc && !(sc.scrollHeight > sc.clientHeight + 1 && /(auto|scroll)/.test(getComputedStyle(sc).overflowY))) sc = sc.parentElement;
    return e.getBoundingClientRect().top - (sc ?? document.documentElement).getBoundingClientRect().top;
  }).catch(() => null);
}
/** An element's top below the viewport's top (D-1673): the bottom of the sticky note toolbar (`data-sticky-top`) in
 *  its scroller when shown, else the scroller's top. Where a heading link lands (D-1625). */
export async function topBelowToolbar(loc: Locator): Promise<number | null> {
  return loc.first().evaluate((e) => {
    let sc: HTMLElement | null = e.parentElement;
    while (sc && !(sc.scrollHeight > sc.clientHeight + 1 && /(auto|scroll)/.test(getComputedStyle(sc).overflowY))) sc = sc.parentElement;
    const box = sc ?? document.documentElement;
    const bar = box.querySelector('[data-sticky-top]');
    const vt = bar ? Math.max(box.getBoundingClientRect().top, bar.getBoundingClientRect().bottom) : box.getBoundingClientRect().top;
    return e.getBoundingClientRect().top - vt;
  }).catch(() => null);
}
/** The body article's own scroll state. */
export async function scrollState(article: Locator): Promise<{ top: number; height: number; client: number; overflowY: string } | null> {
  return article.first().evaluate((a) => {
    let s: HTMLElement | null = a as HTMLElement;
    while (s && !(/(auto|scroll)/.test(getComputedStyle(s).overflowY))) s = s.parentElement;
    if (!s) return null;
    return { top: s.scrollTop, height: s.scrollHeight, client: s.clientHeight, overflowY: getComputedStyle(s).overflowY };
  }).catch(() => null);
}
/** The centre pane's scroller `scrollTop` (the note behind the popover). */
export async function mainScrollTop(page: Page): Promise<number> {
  return page.evaluate(() => {
    const m = document.querySelector('main');
    const cands = [m, ...(m ? [...m.querySelectorAll('*')] : [])] as HTMLElement[];
    const s = cands.find((e) => e && e.scrollHeight > e.clientHeight + 1 && /(auto|scroll)/.test(getComputedStyle(e).overflowY));
    return s ? s.scrollTop : -1;
  });
}
/** Theme token values (src/theme/tokens.ts) as computed colours. */
export async function tokenColour(page: Page, theme: 'light' | 'dark', key: string): Promise<string> {
  return page.evaluate(async ([th, k]) => {
    const tokens = (await import('/src/theme/tokens.ts' as string))[th] as Record<string, string>;
    const probe = document.createElement('span');
    probe.style.color = tokens[k] ?? '';
    document.body.appendChild(probe);
    const c = getComputedStyle(probe).color;
    probe.remove();
    return c;
  }, [theme, key] as const);
}
