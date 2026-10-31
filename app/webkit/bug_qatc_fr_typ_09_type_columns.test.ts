// QA review of the type-columns build (bug_qatc): regressions next to the AC tests, reusing their helpers.
// (1) FR-TYP-09 AC-27 (a), NFR-REL-02: column writes queued behind a refused one are dropped, never sent on top of the
//     outside change, and the alert stays. (2) AC-23, FR-SYN-06: a header dropped on its own left half writes nothing.
// Helpers copied from app/webkit/type_columns.ac.test.ts:
// Configurable type-page columns, L5 (WebKit + fake core): docs/acceptance/type-columns.md R130, FR-TYP-09 AC-18…AC-34
// (L5 parts), FR-TYP-11 AC-4. BRD D-1240…D-1252. Interface: docs/contracts/type-columns.md §2…§5 (Columns menu,
// `columns` op of `type_patch`, resize handles, `UiStateDto.typeColumnWidths`, palette commands) and
// docs/contracts/ms3-shell.md §14.3, §14.7, §15.7. Written from the ACs and the contracts only (D-61). Fixture:
// tests/fixtures/vaults/types + new-empty/.tegg; the runtime variants of the ACs' fixture table are made here with
// `typesVault(edit)` (the fixture files are never changed). Every lookup goes through `must` and node:assert, so a
// missing control is an AssertionError (TS-I1).
import { test, type Locator, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import { mainName, mustPreview } from './helpers';
import { axeContrast, colourLeaks } from './read-helpers';
import { setPreviewMode } from '../ui/test/fake-core';
import {
  P, callsOf, description, eventually, fileText, fileWhen, fixture, gotoSettings, gotoTypePage, isDisabled, main, must, nfc, nonReadCalls,
  openTypes, property, rowTitles, runCommand, section, seen, sleep, swap, typeFile, typeTable, typesVault, writtenOutside,
  type FakeCoreHandle,
} from './types-helpers';

const S = 'Schůzky';
const PREVIEW_S = 'preview: [datum, účastníci]\n';
const NFD_MISTO = 'místo';
const schuzka = () => typesVault().files[typeFile('schůzka')];
/** The fixture schůzka.yml with `line` right after its preview line. */
const schuzkaWith = (line: string) => swap(schuzka(), PREVIEW_S, `${PREVIEW_S}${line}`);
/** A runtime variant: `<key>.yml` with `line` inserted after `after`. */
const withLine = (f: Record<string, string>, key: string, after: string, line: string) => { f[typeFile(key)] = swap(f[typeFile(key)], after, `${after}${line}`); };
const ui = (extra: Record<string, unknown> = {}) => ({ version: 1, theme: 'light', sidebarOpen: true, rightPanel: { open: false, tab: 'backlinks' }, typeSort: {}, ...extra }) as any;

// ------------------------------------------------------------------------------------------------ locators (§4)

const columnsButton = (page: Page) => main(page).getByRole('button', { name: 'Columns', exact: true });
const columnsMenu = (page: Page) => page.getByRole('menu', { name: 'Columns', exact: true });
const item = (page: Page, name: string) => columnsMenu(page).getByRole('menuitemcheckbox', { name, exact: true });
const header = (page: Page, plural: string, name: string) => typeTable(page, plural).getByRole('columnheader', { name, exact: true });
const handle = (page: Page, plural: string, column: string) => typeTable(page, plural).getByRole('separator', { name: `Resize ${column}`, exact: true });
/** Activates the Columns menu item `name` (a missing item is an assertion failure, not a click timeout). */
async function toggle(page: Page, name: string) {
  const i = await must(item(page, name), `menu item "${name}"`);
  assert.equal(await isDisabled(i), false, `menu item "${name}" is enabled (no column limit, AC-21)`);
  await i.click();
}
async function openColumns(page: Page): Promise<Locator> {
  await (await must(columnsButton(page), 'button Columns')).click();
  return must(columnsMenu(page), 'menu Columns');
}
async function headers(page: Page, plural = S): Promise<string[]> {
  return typeTable(page, plural).evaluate((t) => [...t.querySelectorAll('[role="columnheader"], th')].map((h) => ((h as HTMLElement).innerText ?? '').replace(/\s+/g, ' ').trim()));
}
async function headersWhen(page: Page, ok: (h: string[]) => boolean, plural = S, ms = 1000): Promise<string[]> {
  return eventually(() => headers(page, plural), ok, ms);
}
/** The menu's checkbox items in DOM order with their checked and disabled state. */
async function menuItems(page: Page): Promise<{ name: string; checked: boolean; disabled: boolean }[]> {
  const m = await must(columnsMenu(page), 'menu Columns');
  return m.evaluate((el) => [...el.querySelectorAll('[role="menuitemcheckbox"]')].map((i) => ({
    name: ((i as HTMLElement).innerText ?? '').split('\n')[0].trim(),
    checked: i.getAttribute('aria-checked') === 'true',
    disabled: i.getAttribute('aria-disabled') === 'true',
  })));
}
/** The `columns` op keys of each `type_patch` call (contract §2). */
async function columnsOps(core: FakeCoreHandle): Promise<unknown[]> {
  return (await callsOf(core, 'type_patch')).map((c) => ((c.args as any)?.ops ?? []).filter((o: any) => o?.op === 'columns').map((o: any) => o.keys));
}
async function width(loc: Locator): Promise<number> {
  return (await must(loc, 'element to measure')).evaluate((e) => e.getBoundingClientRect().width);
}
async function left(loc: Locator): Promise<number> {
  return (await must(loc, 'element to measure')).evaluate((e) => e.getBoundingClientRect().left);
}
const near = (a: number, b: number, tol = 1) => Math.abs(a - b) <= tol;
/** Drags `loc` by `dx` px with the pointer (down at its centre, moved in steps, up). `beforeUp` runs before release. */
async function dragBy(page: Page, loc: Locator, dx: number, beforeUp?: () => Promise<void>) {
  const box = await (await must(loc, 'drag source')).boundingBox();
  assert.ok(box, 'drag source has a box');
  const x = box!.x + box!.width / 2, y = box!.y + box!.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(x + (dx * i) / 10, y);
  await beforeUp?.();
  await page.mouse.up();
  await sleep(150);
}
/** Focuses a column header (the header itself when focusable, else its first focusable child). */
async function focusHeader(page: Page, plural: string, name: string) {
  const h = await must(header(page, plural, name), `columnheader ${name}`);
  await h.evaluate((e) => {
    const f = (e.matches('[tabindex], button') ? e : e.querySelector('button, [tabindex]')) as HTMLElement | null;
    (f ?? (e as HTMLElement)).focus();
  });
}
/** The column header that holds the focus, or the focused separator's name. */
async function focusedHeader(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const a = document.activeElement as HTMLElement | null;
    if (!a) return null;
    if (a.getAttribute('role') === 'separator') return `separator:${a.getAttribute('aria-label') ?? ''}`;
    const h = a.closest('[role="columnheader"], th') as HTMLElement | null;
    return h ? (h.innerText ?? '').replace(/\s+/g, ' ').trim() : null;
  });
}
const sortOf = async (page: Page, plural: string) =>
  typeTable(page, plural).evaluate((t) => [...t.querySelectorAll('[role="columnheader"], th')]
    .map((h) => [((h as HTMLElement).innerText ?? '').trim(), h.getAttribute('aria-sort') ?? 'none'] as [string, string])
    .filter(([, s]) => s !== 'none'));
/** The cell of `row` (by its title) under the header `column`. */
async function cell(page: Page, plural: string, row: string, column: string) {
  return typeTable(page, plural).evaluate((t, [rowTitle, col]) => {
    const hs = [...t.querySelectorAll('[role="columnheader"], th')] as HTMLElement[];
    const i = hs.findIndex((h) => (h.innerText ?? '').replace(/\s+/g, ' ').trim() === col);
    const rows = ([...t.querySelectorAll('[role="row"], tr')] as HTMLElement[]).filter((r) => !r.querySelector('[role="columnheader"], th'));
    const r = rows.find((x) => ((x.querySelector('[role="cell"], [role="gridcell"], [role="rowheader"], td') as HTMLElement | null)?.innerText ?? '').replace(/\s+/g, ' ').trim() === rowTitle);
    if (i < 0 || !r) return null;
    const c = [...r.querySelectorAll('[role="cell"], [role="gridcell"], [role="rowheader"], td')][i] as HTMLElement | undefined;
    if (!c) return null;
    const els = [c, ...c.querySelectorAll('*')] as HTMLElement[];
    const cut = els.find((e) => getComputedStyle(e).textOverflow === 'ellipsis' && getComputedStyle(e).whiteSpace === 'nowrap') ?? null;
    return {
      text: (c.innerText ?? '').replace(/\s+/g, ' ').trim(), width: c.getBoundingClientRect().width, height: r.getBoundingClientRect().height,
      title: els.map((e) => e.getAttribute('title')).find((x) => !!x) ?? null, ellipsis: !!cut, cutOverflows: cut ? cut.scrollWidth > cut.clientWidth : false,
      warning: !!c.querySelector('[role="img"][aria-hidden="true"], svg[aria-hidden="true"]'),
    };
  }, [row, column] as const);
}
/** The horizontal scroll container of the table (overflow-x auto/scroll, §4) and the page's own scroll widths. */
async function hScroll(page: Page, plural: string) {
  return typeTable(page, plural).evaluate((t) => {
    let s: HTMLElement | null = t as HTMLElement;
    while (s && !['auto', 'scroll'].includes(getComputedStyle(s).overflowX)) s = s.parentElement;
    const doc = document.scrollingElement as HTMLElement;
    if (!s) return { found: false, scrollWidth: 0, clientWidth: 0, scrollLeft: 0, left: 0, right: 0, docScroll: doc.scrollWidth > doc.clientWidth };
    const r = s.getBoundingClientRect();
    return { found: true, scrollWidth: s.scrollWidth, clientWidth: s.clientWidth, scrollLeft: s.scrollLeft, left: r.left, right: r.left + s.clientWidth, docScroll: doc.scrollWidth > doc.clientWidth };
  });
}
async function setScrollLeft(page: Page, plural: string, to: 'end' | 'half' | number) {
  await typeTable(page, plural).evaluate((t, v) => {
    let s: HTMLElement | null = t as HTMLElement;
    while (s && !['auto', 'scroll'].includes(getComputedStyle(s).overflowX)) s = s.parentElement;
    if (!s) return;
    s.scrollLeft = v === 'end' ? s.scrollWidth : v === 'half' ? (s.scrollWidth - s.clientWidth) / 2 : (v as number);
    s.dispatchEvent(new Event('scroll'));
  }, to);
  await sleep(150);
}
/** The Title header and the visible Title cells: left edge, background alpha, and whether they are on top at their right edge. */
async function titleColumn(page: Page, plural: string) {
  return typeTable(page, plural).evaluate((t) => {
    const alpha = (c: string) => { const m = /rgba?\(([^)]+)\)/.exec(c); if (!m) return c === 'transparent' ? 0 : 1; const p = m[1].split(/[ ,/]+/).filter(Boolean); return p.length > 3 ? Number(p[3]) : 1; };
    const head = [...t.querySelectorAll('[role="columnheader"], th')][0] as HTMLElement | undefined;
    const rows = ([...t.querySelectorAll('[role="row"], tr')] as HTMLElement[]).filter((r) => !r.querySelector('[role="columnheader"], th'));
    const cells = [head, ...rows.map((r) => r.querySelector('[role="cell"], [role="gridcell"], [role="rowheader"], td') as HTMLElement | null)].filter(Boolean) as HTMLElement[];
    const vh = window.innerHeight;
    // D-1256: only cells whose middle is inside the window (a row cut by the window's edge has nothing under its probe).
    return cells.filter((c) => { const r = c.getBoundingClientRect(); const mid = r.top + r.height / 2; return mid > 0 && mid < vh; }).map((c) => {
      const r = c.getBoundingClientRect();
      const hit = document.elementFromPoint(r.right - 4, r.top + r.height / 2);
      return { left: r.left, right: r.right, alpha: alpha(getComputedStyle(c).backgroundColor), onTop: !!hit && (hit === c || c.contains(hit)) };
    });
  });
}
/** Data rows in the DOM and the cell count of each (virtualized rows, AC-33). */
async function domRows(page: Page, plural: string): Promise<{ rows: number; cells: number[]; titles: string[] }> {
  return typeTable(page, plural).evaluate((t) => {
    const rows = ([...t.querySelectorAll('[role="row"], tr')] as HTMLElement[]).filter((r) => !r.querySelector('[role="columnheader"], th'));
    return {
      rows: rows.length,
      cells: rows.map((r) => r.querySelectorAll('[role="cell"], [role="gridcell"], [role="rowheader"], td').length),
      titles: rows.map((r) => ((r.querySelector('[role="cell"], [role="gridcell"], [role="rowheader"], td') as HTMLElement | null)?.innerText ?? '').trim()),
    };
  });
}
async function scrollRows(page: Page, plural: string, to: 'end' | 'start') {
  await typeTable(page, plural).evaluate((t, where) => {
    let s: HTMLElement | null = t as HTMLElement;
    while (s && !(['auto', 'scroll'].includes(getComputedStyle(s).overflowY) && s.scrollHeight > s.clientHeight)) s = s.parentElement;
    const el = s ?? (document.scrollingElement as HTMLElement);
    el.scrollTop = where === 'end' ? el.scrollHeight : 0;
    el.dispatchEvent(new Event('scroll'));
  }, to);
}
/** The runtime type `Široký` of the ACs' fixture table: 30 Text attributes `pole-01`…`pole-30` (Names `Pole 01`…). */
const WIDE_KEYS = Array.from({ length: 30 }, (_, i) => `pole-${String(i + 1).padStart(2, '0')}`);
function wideVault() {
  return typesVault((f) => {
    const attrs = WIDE_KEYS.map((k, i) => `  - key: ${k}\n    name: Pole ${String(i + 1).padStart(2, '0')}\n    type: text\n`).join('');
    f[typeFile('široký')] = `# Tegg type definition (FR-TYP-01, FR-STO-06, D-90). Edit it in Tegg's type settings.\nversion: 1\nname: Široký\nplural: Široké\nsystem: false\nfolder: Široké\nicon: file-text\ncolor: gray\nreview: false\npreview: []\ncolumns: [${WIDE_KEYS.join(', ')}]\nattributes:\n${attrs}`;
  });
}
/** Its 300 objects `Široké/Řádek 001.md`…, each value `Hodnota <n>`; added after launch (a 300 × 30 vault takes the fake
 *  core longer to ship than `start` waits for the frame), silently, before the type page is opened. */
async function addWideObjects(core: FakeCoreHandle) {
  for (let n = 1; n <= 300; n++) {
    const nn = String(n).padStart(3, '0');
    await core.setFile(`Široké/Řádek ${nn}.md`, `---\nid: 01JBCOL${String(n).padStart(19, '0')}\ntype: široký\ntitle: Řádek ${nn}\n${WIDE_KEYS.map((k) => `${k}: Hodnota ${n}`).join('\n')}\ncreated: 2026-10-01T08:00:00+02:00\nmodified: 2026-10-01T08:00:00+02:00\n---\n`, { silent: n < 300 });
  }
}
const PROJEKT_ALL = 'columns: [stav, období, modified, rozpočet, aktivní, oblasti, web, poznámka, tags, source, aliases, created]\n';
/** WCAG contrast of two computed colours. */
function contrast(a: string, b: string): number {
  const rgb = (c: string) => (/rgba?\(([^)]+)\)/.exec(c)?.[1].split(/[ ,/]+/).filter(Boolean).slice(0, 3).map(Number) ?? [0, 0, 0]);
  const lum = (c: string) => { const [r, g, bl] = rgb(c).map((v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * bl; };
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

// ------------------------------------------------------------------------------------------------ FR-TYP-09 AC-18


test('bug_qatc_fr_typ_09_writes_queued_behind_a_conflict_are_dropped', async ({ page }) => {
  const core = await openTypes(page);
  await gotoTypePage(page, S);
  await openColumns(page);
  await toggle(page, 'Místo');
  await fileWhen(core, typeFile('schůzka'), (t) => !!t?.includes('columns:'));
  await sleep(500);
  const theirs = swap(schuzka(), 'color: teal\n', 'color: red\n');
  await core.setFile(typeFile('schůzka'), theirs, { silent: true });
  // Three toggles in one task, so the second and third are queued behind the first (which is refused).
  await columnsMenu(page).evaluate((m) => {
    for (const n of ['Projekt', 'Začátek', 'Created']) ([...m.querySelectorAll('[role="menuitemcheckbox"]')] as HTMLElement[]).find((i) => i.innerText.split('\n')[0].trim() === n)?.click();
  });
  await sleep(1500);
  assert.equal(await fileText(core, typeFile('schůzka')), theirs, 'nothing written on top of the outside change');
  assert.ok(await seen(page.getByRole('alert').filter({ hasText: 'Changed outside Tegg' }), 500), 'the Conflict alert stays');
});

test('bug_qatc_fr_typ_09_a_header_dropped_on_its_own_left_half_writes_nothing', async ({ page }) => {
  const vault = typesVault((f) => withLine(f, 'schůzka', PREVIEW_S, 'columns: [datum, účastníci, modified, místo]\n'));
  const core = await openTypes(page, undefined, { vault });
  await gotoTypePage(page, S);
  const b = await (await must(header(page, S, 'Účastníci'), 'Účastníci')).boundingBox();
  await page.mouse.move(b!.x + 6, b!.y + b!.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 5; i++) await page.mouse.move(b!.x + 6 + 3 * i, b!.y + b!.height / 2);
  await page.mouse.up();
  await sleep(500);
  assert.equal((await callsOf(core, 'type_patch')).length, 0, 'no type write');
  assert.deepEqual(await headers(page), ['Title', 'Datum', 'Účastníci', 'Modified', 'Místo'], 'the order is kept');
});
