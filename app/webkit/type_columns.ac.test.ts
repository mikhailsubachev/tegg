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
    return cells.filter((c) => { const r = c.getBoundingClientRect(); return r.bottom > 0 && r.top < vh; }).map((c) => {
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

test('fr_typ_09_ac18_headers_come_from_the_columns_key_with_real_values', async ({ page }) => {
  const vault = typesVault((f) => withLine(f, 'schůzka', PREVIEW_S, 'columns: [místo, datum]\n'));
  const core = await openTypes(page, undefined, { vault });
  const readsBefore = (await callsOf(core, 'note_read')).length;
  await gotoTypePage(page, S);
  assert.deepEqual(await headersWhen(page, (h) => h.includes('Místo')), ['Title', 'Místo', 'Datum'], '(a) Title, then the columns in order; no Modified, no Účastníci');
  assert.equal((await cell(page, S, '2026-10-07 Porada', 'Místo'))?.text, '', '(d) Porada\'s empty místo: an empty cell');
  await core.setFile(P.porada, swap(vault.files[nfc(P.porada)], 'místo:\n', 'místo: Zasedačka\n'));
  const shown = await eventually(() => cell(page, S, '2026-10-07 Porada', 'Místo'), (c) => c?.text === 'Zasedačka', 2000);
  assert.equal(shown?.text, 'Zasedačka', '(d) the new value within 2 s');
  assert.ok((await callsOf(core, 'index_type_rows')).length >= 1, 'rows from index_type_rows');
  const reads = (await callsOf(core, 'note_read')).slice(readsBefore).filter((c) => [P.porada, P.prazdna, P.veStrankach].map(nfc).includes(nfc(String((c.args as any)?.path ?? '')))).length;
  assert.equal(reads, 0, '(d) never reads notes for the rows (D-241)');
  await core.setFile(typeFile('schůzka'), schuzkaWith('columns: []\n'));
  assert.deepEqual(await headersWhen(page, (h) => h.length === 1, S, 2000), ['Title'], '(c) columns: [] shows Title only');
  assert.deepEqual(await nonReadCalls(core), [], 'nothing written');
});

test('fr_typ_09_ac18_without_columns_the_preview_fallback_follows_type_settings', async ({ page }) => {
  const core = await openTypes(page);
  await gotoTypePage(page, S);
  assert.deepEqual(await headers(page), ['Title', 'Datum', 'Účastníci', 'Modified'], '(b) the R130 fallback');
  await gotoSettings(page, S, 'Schůzka');
  const sec = await must(section(page, 'Preview properties'), 'Preview properties');
  await (await must(sec.getByRole('button', { name: 'Remove Datum from preview', exact: true }), 'Remove Datum from preview')).click();
  await fileWhen(core, typeFile('schůzka'), (t) => !!t?.includes('preview: [účastníci]\n'));
  await gotoTypePage(page, S);
  assert.deepEqual(await headersWhen(page, (h) => !h.includes('Datum')), ['Title', 'Účastníci', 'Modified'], '(b) the fallback follows preview within 1 s');
  await openColumns(page);
  const checked = (await menuItems(page)).filter((i) => i.checked).map((i) => i.name);
  assert.deepEqual(checked, ['Title', 'Účastníci', 'Modified'], 'the fallback columns are the checked items, Modified included (D-1240)');
  assert.ok(!(await fileText(core, typeFile('schůzka')))?.includes('columns:'), 'no columns key is written by viewing (AC-20 (g))');
});

test('fr_typ_09_ac18_review_and_date_cells_use_the_existing_display', async ({ page }) => {
  const vault = typesVault((f) => {
    withLine(f, 'nápad', 'preview: [hodnocení]\n', 'columns: [review, created, modified]\n');
    f['Nápady/Ověřený nápad.md'] = '---\nid: 01JBCOL0000000000000000001\ntype: nápad\ntitle: Ověřený nápad\nreview: reviewed\ncreated: 2026-10-05T08:00:00+02:00\nmodified: 2026-10-05T08:00:00+02:00\n---\n';
    f['Nápady/Divný nápad.md'] = '---\nid: 01JBCOL0000000000000000002\ntype: nápad\ntitle: Divný nápad\nreview: možná\ncreated: 2026-10-06T08:00:00+02:00\nmodified: 2026-10-06T08:00:00+02:00\n---\n';
  });
  await openTypes(page, undefined, { vault, region: 'cs' });
  await gotoTypePage(page, 'Nápady');
  assert.deepEqual(await headersWhen(page, (h) => h.includes('Review'), 'Nápady'), ['Title', 'Review', 'Created', 'Modified'], 'columns [review, created, modified]');
  assert.equal((await cell(page, 'Nápady', 'Nápad k ověření', 'Review'))?.text, 'Unreviewed', 'Review cell: Unreviewed');
  assert.equal((await cell(page, 'Nápady', 'Ověřený nápad', 'Review'))?.text, 'Reviewed', 'Review cell: Reviewed');
  const odd = await cell(page, 'Nápady', 'Divný nápad', 'Review');
  assert.ok(odd?.warning, `an other value shows the invalid-value warning icon (FR-TYP-08 AC-11): ${JSON.stringify(odd)}`);
  const created = (await cell(page, 'Nápady', 'Nápad k ověření', 'Created'))?.text ?? '';
  assert.ok(created !== '' && !/^\d{4}-\d{2}-\d{2}T/.test(created), `Created shows the D-160 date-time, not the raw value: "${created}"`);
});

// ------------------------------------------------------------------------------------------------ FR-TYP-09 AC-19

test('fr_typ_09_ac19_columns_menu_contents_on_schuzka', async ({ page }) => {
  const core = await openTypes(page);
  await gotoTypePage(page, S);
  const m = await openColumns(page);
  const items = await menuItems(page);
  assert.deepEqual(items.map((i) => i.name), ['Title', 'Datum', 'Začátek', 'Účastníci', 'Projekt', 'Místo', 'Tags', 'Source', 'Aliases', 'Created', 'Modified'], 'R130 order');
  assert.deepEqual(items.filter((i) => i.checked).map((i) => i.name), ['Title', 'Datum', 'Účastníci', 'Modified'], 'the fallback is checked');
  assert.deepEqual(items.filter((i) => i.disabled).map((i) => i.name), ['Title'], 'only Title is aria-disabled');
  assert.equal(await description(item(page, 'Title')), 'Always shown', 'Title: Always shown');
  const order = await m.evaluate((el) => [...el.querySelectorAll('[role="menuitemcheckbox"], [role="menuitem"], [role="separator"]')].map((e) => e.getAttribute('role') === 'separator' ? '—' : ((e as HTMLElement).innerText ?? '').split('\n')[0].trim()));
  const np = order.indexOf('New property…');
  assert.ok(np > 0 && order[np - 1] === '—' && order[np - 2] === 'Modified', `a separator, then New property… after the items: ${order.join(' | ')}`);
  await (await must(item(page, 'Title'), 'menu item Title')).click({ force: true });
  await item(page, 'Title').focus();
  await page.keyboard.press('Space');
  await page.keyboard.press('Enter');
  await sleep(300);
  assert.equal((await callsOf(core, 'type_patch')).length, 0, 'activating Title writes nothing');
});

test('fr_typ_09_ac19_menu_items_on_napad_quick_note_and_task', async ({ page }) => {
  await openTypes(page);
  await gotoTypePage(page, 'Nápady');
  await openColumns(page);
  assert.deepEqual((await menuItems(page)).map((i) => i.name), ['Title', 'Hodnocení', 'Tags', 'Source', 'Aliases', 'Review', 'Created', 'Modified'], 'nápad (review on)');
  await page.keyboard.press('Escape');
  await gotoTypePage(page, 'Quick Notes');
  await openColumns(page);
  assert.ok((await menuItems(page)).some((i) => i.name === 'Review'), 'quick-note (locked): Review listed');
  await page.keyboard.press('Escape');
  await gotoTypePage(page, 'Tasks');
  await openColumns(page);
  const names = (await menuItems(page)).map((i) => i.name);
  // R130 labels items with the attribute Name; the built-in `due` is named `Due date` in task.yml.
  assert.deepEqual(names.slice(0, 6), ['Title', 'Status', 'Priority', 'Due date', 'Completed', 'Recurrence'], `task: built-in attributes in schema order: ${names.join(', ')}`);
});

test('fr_typ_09_ac19_menu_keyboard_stays_open_and_scrolls', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 360 });
  const core = await openTypes(page);
  await gotoTypePage(page, 'Projekty');
  const b = await must(columnsButton(page), 'button Columns');
  await b.focus();
  await page.keyboard.press('Enter');
  const m = await must(columnsMenu(page), 'menu Columns');
  for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowDown');
  const label = await page.evaluate(() => ((document.activeElement as HTMLElement | null)?.innerText ?? '').split('\n')[0].trim());
  assert.equal(label, 'Rozpočet', '↓ moves through Title, Stav, Období to Rozpočet');
  await page.keyboard.press('Space');
  assert.ok((await fileWhen(core, typeFile('projekt'), (t) => !!t?.includes('columns:')))?.includes('columns: [stav, období, modified, rozpočet]\n'), 'Space toggles (writes columns)');
  assert.ok(await seen(columnsMenu(page), 300), 'the menu stays open after the toggle');
  const box = await m.evaluate((el) => {
    let s: HTMLElement | null = el as HTMLElement;
    while (s && s.scrollHeight <= s.clientHeight) s = s.querySelector('*') as HTMLElement | null;
    return { scrolls: !!s, height: (el as HTMLElement).getBoundingClientRect().height };
  });
  assert.ok(box.scrolls && box.height <= 360, `taller than the window: the menu scrolls (${JSON.stringify(box)})`);
  for (let i = 0; i < 9; i++) await page.keyboard.press('ArrowDown');
  const visible = await page.evaluate(() => {
    const a = document.activeElement as HTMLElement | null;
    const menu = a?.closest('[role="menu"]') as HTMLElement | null;
    if (!a || !menu) return false;
    const r = a.getBoundingClientRect(), mr = menu.getBoundingClientRect();
    return r.top >= mr.top - 1 && r.bottom <= mr.bottom + 1 && r.bottom <= window.innerHeight;
  });
  assert.ok(visible, '↓ keeps the highlighted item visible');
  await page.keyboard.press('Escape');
  assert.equal(await columnsMenu(page).count(), 0, 'Esc closes');
  assert.equal(await columnsButton(page).evaluate((e) => e === document.activeElement), true, 'focus back on Columns');
});

// ------------------------------------------------------------------------------------------------ FR-TYP-09 AC-20

test('fr_typ_09_ac20_toggling_writes_only_the_columns_line', async ({ page }) => {
  const core = await openTypes(page);
  await gotoTypePage(page, S);
  await openColumns(page);
  await toggle(page, 'Místo');
  const a = await fileWhen(core, typeFile('schůzka'), (t) => !!t?.includes('columns:'));
  assert.equal(a, schuzkaWith('columns: [datum, účastníci, modified, místo]\n'), '(a) one line after line 11, seeded and appended (AP-1142); preview unchanged');
  assert.deepEqual(await columnsOps(core), [[['datum', 'účastníci', 'modified', 'místo']]], '(a) one type_patch with the columns op');
  assert.deepEqual(await headersWhen(page, (h) => h.includes('Místo')), ['Title', 'Datum', 'Účastníci', 'Modified', 'Místo'], '(a) within 1 s');
  await toggle(page, 'Modified');
  assert.equal(await fileWhen(core, typeFile('schůzka'), (t) => !!t?.includes('columns: [datum, účastníci, místo]\n')), schuzkaWith('columns: [datum, účastníci, místo]\n'), '(b) unchecking Modified');
  await toggle(page, 'Místo');
  await fileWhen(core, typeFile('schůzka'), (t) => !!t?.includes('columns: [datum, účastníci]\n'));
  await toggle(page, 'Místo');
  assert.equal(await fileWhen(core, typeFile('schůzka'), (t) => !!t?.includes('columns: [datum, účastníci, místo]\n')), schuzkaWith('columns: [datum, účastníci, místo]\n'), '(c) the key is never removed');
  for (const n of ['Datum', 'Účastníci', 'Místo']) { await toggle(page, n); await sleep(150); }
  assert.equal(await fileWhen(core, typeFile('schůzka'), (t) => !!t?.includes('columns: []\n')), schuzkaWith('columns: []\n'), '(c) unchecking every item writes columns: []');
  assert.deepEqual(await writtenOutside(core, [typeFile('schůzka')]), [], 'no note file is written');
});

test('fr_typ_09_ac20_placement_on_osoba_hidden_and_napad', async ({ page }) => {
  const vault = typesVault((f) => withLine(f, 'schůzka', PREVIEW_S, 'hidden: [místo]\n'));
  const core = await openTypes(page, undefined, { vault });
  const osoba = vault.files[typeFile('osoba')];
  await gotoTypePage(page, 'Osoby');
  await openColumns(page);
  await toggle(page, 'Firma');
  assert.equal(await fileWhen(core, typeFile('osoba'), (t) => !!t?.includes('columns:')), swap(osoba, 'preview: [firma]\n', 'preview: [firma]\ncolumns: [modified]\n'), '(d) osoba: between preview and the unknown key; comment and final newline kept');
  await page.keyboard.press('Escape');
  await gotoTypePage(page, S);
  await openColumns(page);
  await toggle(page, 'Místo');
  const h = vault.files[typeFile('schůzka')];
  assert.equal(await fileWhen(core, typeFile('schůzka'), (t) => !!t?.includes('columns:')), swap(h, 'hidden: [místo]\n', 'hidden: [místo]\ncolumns: [datum, účastníci, modified, místo]\n'), '(d) after the hidden line');
  await page.keyboard.press('Escape');
  await gotoTypePage(page, 'Nápady');
  await openColumns(page);
  await toggle(page, 'Review');
  const n = vault.files[typeFile('nápad')];
  assert.equal(await fileWhen(core, typeFile('nápad'), (t) => !!t?.includes('columns:')), swap(n, 'preview: [hodnocení]\n', 'preview: [hodnocení]\ncolumns: [hodnocení, modified, review]\n'), '(d) nápad: between preview and template');
});

test('fr_typ_09_ac20_seeding_from_shown_columns_and_a_missing_version', async ({ page }) => {
  const vault = typesVault((f) => {
    f[typeFile('schůzka')] = swap(f[typeFile('schůzka')], PREVIEW_S, 'preview: [datum, neznámý]\n');
    f[typeFile('osoba')] = swap(f[typeFile('osoba')], 'version: 1\n', '');
  });
  const core = await openTypes(page, undefined, { vault });
  await gotoTypePage(page, S);
  await openColumns(page);
  await toggle(page, 'Místo');
  assert.equal(await fileWhen(core, typeFile('schůzka'), (t) => !!t?.includes('columns:')),
    swap(vault.files[typeFile('schůzka')], 'preview: [datum, neznámý]\n', 'preview: [datum, neznámý]\ncolumns: [datum, modified, místo]\n'), '(e) seeded from the shown columns; preview stays');
  await page.keyboard.press('Escape');
  await gotoTypePage(page, 'Osoby');
  await openColumns(page);
  await toggle(page, 'Firma');
  assert.equal(await fileWhen(core, typeFile('osoba'), (t) => !!t?.includes('columns:')),
    swap(typesVault().files[typeFile('osoba')], 'preview: [firma]\n', 'preview: [firma]\ncolumns: [modified]\n'), '(f) version: 1 written first after the header, and nothing else');
});

test('fr_typ_09_ac20_viewing_sorting_filtering_scrolling_and_resizing_never_write', async ({ page }) => {
  const core = await openTypes(page);
  for (const pl of [S, 'Projekty', 'Osoby']) {
    await gotoTypePage(page, pl);
    await (await must(header(page, pl, 'Title'), `${pl}: Title header`)).click();
    await main(page).getByRole('searchbox', { name: `Filter ${pl}…` }).fill('a');
    await page.mouse.wheel(300, 600);
  }
  await gotoTypePage(page, S);
  await dragBy(page, handle(page, S, 'Datum'), 60);
  await (await must(handle(page, S, 'Datum'), 'Resize Datum')).dblclick();
  assert.deepEqual(await callsOf(core, 'type_patch'), [], '(g) no type-file write: no lazy seeding');
  assert.deepEqual(await nonReadCalls(core), [], '(g) no write command');
});

test('fr_typ_09_ac20_five_quick_toggles_are_serialized', async ({ page }) => {
  const core = await openTypes(page);
  await gotoTypePage(page, S);
  await openColumns(page);
  for (const n of ['Místo', 'Projekt', 'Začátek', 'Tags', 'Modified']) await toggle(page, n);
  const want = schuzkaWith('columns: [datum, účastníci, místo, projekt, začátek, tags]\n');
  assert.equal(await fileWhen(core, typeFile('schůzka'), (t) => t === want, 3000), want, '(h) the same file as the toggles done slowly');
  assert.equal((await callsOf(core, 'type_patch')).length, 5, '(h) five writes');
  assert.equal(await page.getByRole('alert').count(), 0, '(h) no Conflict alert');
  assert.deepEqual(await writtenOutside(core, [typeFile('schůzka')]), [], 'no note file');
});

// ------------------------------------------------------------------------------------------------ FR-TYP-09 AC-21

test('fr_typ_09_ac21_no_limit_on_columns', async ({ page }) => {
  const core = await openTypes(page);
  await gotoTypePage(page, 'Projekty');
  await openColumns(page);
  const items = await menuItems(page);
  let n = 0;
  for (const i of items.filter((x) => !x.checked)) {
    await toggle(page, i.name);
    n++;
    await eventually(async () => (await callsOf(core, 'type_patch')).length, (c) => c === n, 2000);
  }
  assert.equal(n, 9, 'nine unchecked items');
  const t = await fileWhen(core, typeFile('projekt'), (x) => !!x?.includes('created]'));
  assert.equal(t, swap(typesVault().files[typeFile('projekt')], 'preview: [stav, období]\n', `preview: [stav, období]\n${PROJEKT_ALL}`), '12 columns; preview unchanged');
  assert.deepEqual(await headersWhen(page, (h) => h.length === 13, 'Projekty'),
    ['Title', 'Stav', 'Období', 'Modified', 'Rozpočet', 'Aktivní', 'Oblasti', 'Web', 'Poznámka', 'Tags', 'Source', 'Aliases', 'Created'], '13 headers');
  assert.deepEqual((await menuItems(page)).filter((i) => i.disabled).map((i) => i.name), ['Title'], 'nothing but Title is aria-disabled');
  assert.equal(await page.getByText(/Up to 4 columns/).count(), 0, 'no limit text');
});

// ------------------------------------------------------------------------------------------------ FR-TYP-09 AC-22

test('fr_typ_09_ac22_default_sort_is_title_when_modified_is_hidden', async ({ page }) => {
  await openTypes(page);
  await gotoTypePage(page, S);
  assert.deepEqual(await rowTitles(page, S), ['2026-10-07 Porada', 'Schůzka ve stránkách', 'Prázdná schůzka'], 'fallback columns: Modified descending');
  await openColumns(page);
  await toggle(page, 'Modified');
  await headersWhen(page, (h) => !h.includes('Modified'));
  await page.keyboard.press('Escape');
  assert.deepEqual(await eventually(() => rowTitles(page, S), (r) => r[1] === 'Prázdná schůzka', 1000), ['2026-10-07 Porada', 'Prázdná schůzka', 'Schůzka ve stránkách'], 'Title ascending (D-122)');
  assert.deepEqual(await sortOf(page, S), [['Title', 'ascending']], 'exactly one header has aria-sort: Title ascending');
});

test('fr_typ_09_ac22_a_remembered_sort_on_a_hidden_column_is_set_aside', async ({ page }) => {
  const core = await openTypes(page, undefined, { uiState: ui({ typeSort: { 'schůzka': { column: 'datum', dir: 'asc' } } }) });
  await gotoTypePage(page, S);
  assert.deepEqual(await sortOf(page, S), [['Datum', 'ascending']], 'setup: Datum ascending remembered');
  await openColumns(page);
  await toggle(page, 'Datum');
  await headersWhen(page, (h) => !h.includes('Datum'));
  assert.deepEqual(await columnsOps(core), [[['účastníci', 'modified']]], 'unchecking Datum writes columns (seeded, AC-20), not preview');
  assert.deepEqual(await eventually(() => sortOf(page, S), (s) => s[0]?.[0] === 'Modified', 1000), [['Modified', 'descending']], 'Datum hidden: the default sort (Modified shown → descending)');
  assert.deepEqual(((await core.uiState()) as any)?.typeSort?.['schůzka'], { column: 'datum', dir: 'asc' }, 'the remembered sort is not deleted');
  await toggle(page, 'Datum');
  assert.deepEqual(await eventually(() => sortOf(page, S), (s) => s[0]?.[0] === 'Datum', 1000), [['Datum', 'ascending']], 'checking Datum again restores Datum ascending');
});

// ------------------------------------------------------------------------------------------------ FR-TYP-09 AC-23

test('fr_typ_09_ac23_dragging_a_header_reorders_and_a_short_press_sorts', async ({ page }) => {
  const vault = typesVault((f) => withLine(f, 'schůzka', PREVIEW_S, 'columns: [datum, účastníci, modified, místo]\n'));
  const core = await openTypes(page, undefined, { vault });
  await gotoTypePage(page, S);
  const from = await (await must(header(page, S, 'Místo'), 'Místo')).boundingBox();
  const to = await (await must(header(page, S, 'Datum'), 'Datum')).boundingBox();
  assert.ok(from && to, 'header boxes');
  await page.mouse.move(from!.x + 20, from!.y + from!.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) await page.mouse.move(from!.x + 20 + ((to!.x + 4 - from!.x - 20) * i) / 12, to!.y + to!.height / 2);
  await page.mouse.up();
  const t = await fileWhen(core, typeFile('schůzka'), (x) => !!x?.includes('columns: [místo,'));
  assert.equal(t, schuzkaWith('columns: [místo, datum, účastníci, modified]\n'), 'dropped before Datum: one write, only that line');
  assert.equal((await callsOf(core, 'type_patch')).length, 1, 'one write');
  const box = await (await must(header(page, S, 'Účastníci'), 'Účastníci')).boundingBox();
  await page.mouse.move(box!.x + 20, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.mouse.move(box!.x + 22, box!.y + box!.height / 2);
  await page.mouse.up();
  await sleep(300);
  assert.equal((await sortOf(page, S))[0]?.[0], 'Účastníci', 'a press without moving more than 4 px sorts');
  assert.equal((await callsOf(core, 'type_patch')).length, 1, 'and writes nothing');
});

test('fr_typ_09_ac23_alt_arrows_move_a_focused_header', async ({ page }) => {
  const vault = typesVault((f) => withLine(f, 'schůzka', PREVIEW_S, 'columns: [datum, účastníci, modified, místo]\n'));
  const core = await openTypes(page, undefined, { vault });
  await gotoTypePage(page, S);
  await focusHeader(page, S, 'Místo');
  await page.keyboard.press('Alt+ArrowLeft');
  assert.equal(await fileWhen(core, typeFile('schůzka'), (x) => !!x?.includes('místo, modified]')), schuzkaWith('columns: [datum, účastníci, místo, modified]\n'), '⌥← moves one place');
  assert.equal(await eventually(() => focusedHeader(page), (f) => f === 'Místo', 1000), 'Místo', 'the focus stays on the moved header');
  const n = (await callsOf(core, 'type_patch')).length;
  await focusHeader(page, S, 'Datum');
  await page.keyboard.press('Alt+ArrowLeft');
  await focusHeader(page, S, 'Modified');
  await page.keyboard.press('Alt+ArrowRight');
  await focusHeader(page, S, 'Title');
  await page.keyboard.press('Alt+ArrowRight');
  await sleep(300);
  assert.equal((await callsOf(core, 'type_patch')).length, n, '⌥← on the first, ⌥→ on the last and Title write nothing');
  await gotoTypePage(page, 'Projekty');
  await focusHeader(page, 'Projekty', 'Období');
  await page.keyboard.press('Alt+ArrowRight');
  assert.ok((await fileWhen(core, typeFile('projekt'), (x) => !!x?.includes('columns:')))?.includes('columns: [stav, modified, období]\n'), 'on a type without columns the first move seeds the key');
});

// ------------------------------------------------------------------------------------------------ FR-TYP-09 AC-24

test('fr_typ_09_ac24_new_property_from_the_menu_adds_a_column_not_a_preview', async ({ page }) => {
  const core = await openTypes(page);
  await gotoTypePage(page, S);
  const m = await openColumns(page);
  await m.getByRole('menuitem', { name: 'New property…', exact: true }).click();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  assert.equal((await callsOf(core, 'type_patch')).length, 0, 'Cancel writes nothing');
  await (await openColumns(page)).getByRole('menuitem', { name: 'New property…', exact: true }).click();
  await page.keyboard.type('Telefon do práce');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  const want = `${schuzkaWith('columns: [datum, účastníci, modified, telefon-do-práce]\n')}  - key: telefon-do-práce\n    name: Telefon do práce\n    type: text\n`;
  assert.equal(await fileWhen(core, typeFile('schůzka'), (t) => !!t?.includes('telefon-do-práce\n    name')), want, 'the item appended and the key appended to columns in one write; preview unchanged');
  const calls = await callsOf(core, 'type_patch');
  assert.equal(calls.length, 1, 'one type_patch');
  assert.deepEqual(((calls[0].args as any)?.ops ?? []).map((o: any) => o.op), ['addAttribute', 'columns'], '[addAttribute, columns] (contract §2)');
  assert.equal((await headersWhen(page, (h) => h.includes('Telefon do práce'))).at(-1), 'Telefon do práce', 'the new column is the last header within 1 s');
  assert.equal(await page.getByText(/Up to 4 columns/).count(), 0, 'no limit message');
  // Type settings' Add property writes the item only (AP-1141).
  await gotoSettings(page, S, 'Schůzka');
  await (await must(section(page, 'Properties').getByRole('button', { name: 'Add property', exact: true }), 'Add property')).click();
  await page.keyboard.type('Mobil');
  await section(page, 'Properties').getByRole('button', { name: 'Add', exact: true }).click();
  const after = await fileWhen(core, typeFile('schůzka'), (t) => !!t?.includes('key: mobil'));
  assert.equal(after, `${want}  - key: mobil\n    name: Mobil\n    type: text\n`, 'Type settings\' Add property doesn\'t touch columns');
});

// ------------------------------------------------------------------------------------------------ FR-TYP-09 AC-25

test('fr_typ_09_ac25_hand_written_columns_show_warn_and_stay', async ({ page }) => {
  const vault = typesVault((f) => withLine(f, 'schůzka', PREVIEW_S, 'columns: [datum, neznámý, datum, title, místo]\n'));
  const core = await openTypes(page, undefined, { vault });
  await gotoTypePage(page, S);
  assert.deepEqual(await headersWhen(page, (h) => h.includes('Místo')), ['Title', 'Datum', 'Místo'], '(a) unknown and title skipped; a repeat once');
  const m = await openColumns(page);
  assert.ok(await seen(m.getByText('Not a property of Schůzka, kept in the file: neznámý', { exact: true }), 1000), '(a) the menu warning');
  await toggle(page, 'Created');
  assert.ok((await fileWhen(core, typeFile('schůzka'), (t) => !!t?.includes('created]')))?.includes('columns: [datum, neznámý, datum, title, místo, created]\n'), '(a) every hand-written entry kept in place');
  await toggle(page, 'Datum');
  assert.equal(await fileWhen(core, typeFile('schůzka'), (t) => !!t?.includes('columns: [neznámý')), schuzkaWith('columns: [neznámý, title, místo, created]\n'), '(a) every datum entry removed');
});

test('fr_typ_09_ac25_an_nfd_entry_matches_and_is_written_nfc', async ({ page }) => {
  const vault = typesVault((f) => withLine(f, 'schůzka', PREVIEW_S, `columns: [datum, ${NFD_MISTO}]\n`));
  const core = await openTypes(page, undefined, { vault });
  await gotoTypePage(page, S);
  assert.deepEqual(await headersWhen(page, (h) => h.includes('Místo')), ['Title', 'Datum', 'Místo'], '(b) the NFD entry shows Místo');
  await openColumns(page);
  assert.equal(await item(page, 'Místo').getAttribute('aria-checked'), 'true', '(b) Místo checked');
  await toggle(page, 'Created');
  assert.equal(await fileWhen(core, typeFile('schůzka'), (t) => !!t?.includes('created]')), schuzkaWith('columns: [datum, místo, created]\n'), '(b) written in NFC (FR-FMT-12)');
});

test('fr_typ_09_ac25_a_block_list_is_rewritten_as_one_flow_line', async ({ page }) => {
  const vault = typesVault((f) => withLine(f, 'schůzka', PREVIEW_S, 'columns:\n  - datum\n  - místo\n'));
  const core = await openTypes(page, undefined, { vault });
  await gotoTypePage(page, S);
  assert.deepEqual(await headersWhen(page, (h) => h.includes('Místo')), ['Title', 'Datum', 'Místo'], '(c) read like a flow list');
  await openColumns(page);
  await toggle(page, 'Created');
  assert.equal(await fileWhen(core, typeFile('schůzka'), (t) => !!t?.includes('created]')), schuzkaWith('columns: [datum, místo, created]\n'), '(c) one flow line replaces the block lines');
});

test('fr_typ_09_ac25_a_value_that_is_not_a_list_disables_columns', async ({ page }) => {
  for (const line of ['columns: datum\n', 'columns: { a: b }\n']) {
    const vault = typesVault((f) => withLine(f, 'schůzka', PREVIEW_S, line));
    const core = await openTypes(page, undefined, { vault });
    await gotoTypePage(page, S);
    assert.deepEqual(await headers(page), ['Title', 'Datum', 'Účastníci', 'Modified'], `(d) ${line.trim()}: the fallback columns`);
    const b = await must(columnsButton(page), 'button Columns');
    assert.equal(await b.getAttribute('aria-disabled'), 'true', `(d) ${line.trim()}: Columns aria-disabled`);
    assert.equal(await description(b), 'The columns setting in .tegg/types/schůzka.yml can\'t be read. Fix it in the file to change columns.', '(d) the reason');
    await b.click({ force: true });
    await sleep(300);
    assert.equal((await callsOf(core, 'type_patch')).length, 0, '(d) no type write');
    assert.equal(await fileText(core, typeFile('schůzka')), vault.files[typeFile('schůzka')], '(d) the file keeps its bytes');
  }
});

// ------------------------------------------------------------------------------------------------ FR-TYP-09 AC-26

async function expand(page: Page, name: string): Promise<Locator> {
  const g = await must(property(page, name), `property group "${name}"`);
  const edit = g.getByRole('button', { name: `Edit ${name}`, exact: true });
  if (await seen(edit, 500)) await edit.click();
  return g;
}

test('fr_typ_09_ac26_deleting_a_property_removes_it_from_columns', async ({ page }) => {
  const vault = typesVault((f) => withLine(f, 'schůzka', PREVIEW_S, `columns: [místo, datum, ${NFD_MISTO}]\n`));
  const core = await openTypes(page, undefined, { vault });
  await gotoSettings(page, S, 'Schůzka');
  const g = await expand(page, 'Místo');
  await (await must(g.getByRole('button', { name: 'Delete property…', exact: true }), 'Delete property…')).click();
  const d = await must(page.getByRole('dialog', { name: 'Delete property "Místo"?' }).or(page.getByRole('alertdialog', { name: 'Delete property "Místo"?' })), 'Delete property dialog');
  await (await must(d.getByRole('button', { name: /^Delete (property|from)/ }).first(), 'confirm')).click();
  const item = '  - key: místo\n    name: Místo\n    type: text\n    description: Kde se schůzka konala\n';
  const want = swap(schuzkaWith('columns: [datum]\n'), item, '');
  assert.equal(await fileWhen(core, typeFile('schůzka'), (t) => !t?.includes('key: místo')), want, '(a) the item and every columns entry go in the same change');
});

test('fr_typ_09_ac26_rename_and_review_off_keep_the_columns_line', async ({ page }) => {
  const vault = typesVault((f) => {
    withLine(f, 'schůzka', PREVIEW_S, 'columns: [místo, datum]\n');
    withLine(f, 'nápad', 'preview: [hodnocení]\n', 'columns: [hodnocení, review]\n');
  });
  const core = await openTypes(page, undefined, { vault });
  await gotoTypePage(page, S);
  assert.deepEqual(await headersWhen(page, (h) => h.includes('Místo')), ['Title', 'Místo', 'Datum'], 'setup: the runtime columns');
  await gotoSettings(page, S, 'Schůzka');
  const g = await expand(page, 'Místo');
  const name = g.getByRole('textbox', { name: 'Name', exact: true });
  await name.fill('Místo konání');
  await name.press('Enter');
  const t = await fileWhen(core, typeFile('schůzka'), (x) => !!x?.includes('name: Místo konání'));
  assert.ok(t?.includes('columns: [místo, datum]\n'), '(b) renaming a Name changes no columns line');
  await gotoTypePage(page, S);
  assert.deepEqual(await headersWhen(page, (h) => h.includes('Místo konání')), ['Title', 'Místo konání', 'Datum'], '(b) the header shows the new Name');
  await gotoTypePage(page, 'Nápady');
  assert.deepEqual(await headersWhen(page, (h) => h.includes('Review'), 'Nápady'), ['Title', 'Hodnocení', 'Review'], 'review on: the Review column');
  await gotoSettings(page, 'Nápady', 'Nápad');
  await (await must(section(page, 'Review workflow').getByRole('switch', { name: 'Review workflow' }), 'switch')).click();
  const n = await fileWhen(core, typeFile('nápad'), (x) => !!x?.includes('review: false'));
  assert.ok(n?.includes('columns: [hodnocení, review]\n'), '(d) review off keeps the key in the file');
  await gotoTypePage(page, 'Nápady');
  assert.deepEqual(await headersWhen(page, (h) => !h.includes('Review'), 'Nápady'), ['Title', 'Hodnocení'], '(d) the column is hidden while the workflow is off');
  await openColumns(page);
  assert.ok(!(await menuItems(page)).some((i) => i.name === 'Review'), '(d) and its menu item');
});

// ------------------------------------------------------------------------------------------------ FR-TYP-09 AC-27

test('fr_typ_09_ac27_a_changed_type_file_refuses_columns_changes', async ({ page }) => {
  const core = await openTypes(page);
  await gotoTypePage(page, S);
  await openColumns(page);
  await toggle(page, 'Místo');
  await fileWhen(core, typeFile('schůzka'), (t) => !!t?.includes('columns:'));
  await sleep(500);
  const theirs = swap(schuzka(), 'color: teal\n', 'color: red\n');
  await core.setFile(typeFile('schůzka'), theirs, { silent: true });
  await toggle(page, 'Projekt');
  const alert = await must(page.getByRole('alert').filter({ hasText: 'Changed outside Tegg' }), 'the alert of FR-TYP-01 AC-7');
  assert.ok((await alert.innerText()).includes('Columns'), `the alert names Columns: "${await alert.innerText()}"`);
  assert.equal(await fileText(core, typeFile('schůzka')), theirs, '(a) nothing written');
  assert.deepEqual(await headersWhen(page, (h) => !h.includes('Místo'), S, 2000), ['Title', 'Datum', 'Účastníci', 'Modified'], '(a) the table shows the disk state');
  await focusHeader(page, S, 'Účastníci');
  await core.setFile(typeFile('schůzka'), swap(schuzka(), 'color: teal\n', 'color: green\n'), { silent: true });
  await page.keyboard.press('Alt+ArrowLeft');
  await sleep(500);
  assert.ok((await fileText(core, typeFile('schůzka')))?.includes('color: green\n') && !(await fileText(core, typeFile('schůzka')))?.includes('columns:'), '(a) a move is refused too');
});

test('fr_typ_09_ac27_a_missing_task_file_is_created_with_the_columns_line', async ({ page }) => {
  const vault = typesVault((f) => { delete f[typeFile('task')]; });
  const core = await openTypes(page, undefined, { vault });
  await gotoTypePage(page, 'Tasks');
  await openColumns(page);
  await toggle(page, 'Completed');
  const want = swap(fixture('vaults/new-empty/.tegg/types/task.yml'), 'preview: [status, priority, due]\n', 'preview: [status, priority, due]\ncolumns: [status, priority, due, modified, completed]\n');
  assert.equal(await fileWhen(core, typeFile('task'), (t) => t !== undefined), want, '(b) new-empty\'s task.yml plus one columns line (D-90)');
});

test('fr_typ_09_ac27_newer_invalid_and_undefined_types', async ({ page }) => {
  const vault = typesVault((f) => {
    withLine(f, 'budoucí', 'preview: []\n', 'columns: [hodnota, created]\n');
    f['Budoucí/Zpráva z budoucnosti.md'] = '---\nid: 01JBCOL0000000000000000003\ntype: budoucí\ntitle: Zpráva z budoucnosti\nhodnota: zítra\ncreated: 2026-10-01T08:00:00+02:00\nmodified: 2026-10-01T08:00:00+02:00\n---\n';
    f['Pages/Rozbitý objekt.md'] = '---\nid: 01JBCOL0000000000000000004\ntype: rozbitý\ntitle: Rozbitý objekt\nmodified: 2026-10-01T08:00:00+02:00\n---\n';
    f['Recepty/Svíčková.md'] = '---\nid: 01JBCOL0000000000000000005\ntype: recept\ntitle: Svíčková\nmodified: 2026-10-01T08:00:00+02:00\n---\n';
  });
  const core = await openTypes(page, undefined, { vault });
  const before = await core.files();
  await gotoTypePage(page, 'Budoucí');
  assert.deepEqual(await headersWhen(page, (h) => h.includes('Hodnota'), 'Budoucí'), ['Title', 'Hodnota', 'Created'], '(c) a newer file\'s columns are read');
  const b = await must(columnsButton(page), 'Columns on budoucí');
  assert.equal(await b.getAttribute('aria-disabled'), 'true', '(c) Columns aria-disabled');
  assert.equal(await description(b), 'Made by a newer version of Tegg. Read-only.', '(c) AR-07 AC-3\'s reason');
  await runCommand(page, 'Go to type: rozbitý');
  await sleep(500);
  assert.deepEqual(await headers(page, 'rozbitý'), ['Title', 'Modified'], '(d) invalid: Title and Modified');
  const r = await must(columnsButton(page), 'Columns on rozbitý');
  assert.equal(await r.getAttribute('aria-disabled'), 'true', '(d) aria-disabled');
  assert.notEqual(await description(r), '', '(d) with AR-07 AC-4\'s reason');
  await gotoTypePage(page, 'recept');
  assert.equal(await columnsButton(page).count(), 0, '(e) no Columns on an undefined type');
  assert.deepEqual(await headers(page, 'recept'), ['Title', 'Modified'], '(e) Title and Modified');
  await dragBy(page, handle(page, 'recept', 'Modified'), 40);
  const u = await eventually(() => core.uiState(), (x: any) => !!x?.typeColumnWidths?.recept, 2000) as any;
  assert.equal(u?.typeColumnWidths?.recept?.modified, 200, '(e) the width is stored under the key recept (AP-1146)');
  assert.equal((await callsOf(core, 'type_patch')).length, 0, 'no type write');
  assert.deepEqual(await core.files(), before, '(c)…(e) every file keeps its bytes');
});

// ------------------------------------------------------------------------------------------------ FR-TYP-09 AC-28

test('fr_typ_09_ac28_an_external_columns_change_keeps_sort_and_width', async ({ page }) => {
  const core = await openTypes(page);
  await gotoTypePage(page, S);
  await (await must(header(page, S, 'Datum'), 'Datum header')).click();
  assert.deepEqual(await sortOf(page, S), [['Datum', 'ascending']], 'setup: Datum ascending');
  await (await must(handle(page, S, 'Datum'), 'Resize Datum')).focus();
  for (let i = 0; i < 8; i++) await page.keyboard.press('ArrowRight');
  assert.ok(near(await width(header(page, S, 'Datum')), 240), 'setup: Datum 240 px');
  await openColumns(page);
  await core.setFile(typeFile('schůzka'), schuzkaWith('columns: [místo, datum]\n'));
  assert.deepEqual(await headersWhen(page, (h) => h.includes('Místo'), S, 2000), ['Title', 'Místo', 'Datum'], 'within 2 s (NFR-PERF-08)');
  assert.deepEqual(await sortOf(page, S), [['Datum', 'ascending']], 'the sort is kept');
  assert.ok(near(await width(header(page, S, 'Datum')), 240), 'the 240 px width is kept');
  assert.deepEqual((await menuItems(page)).filter((i) => i.checked).map((i) => i.name), ['Title', 'Datum', 'Místo'], 'the open menu shows the new checks');
  await page.keyboard.press('Escape');
  await core.setFile(typeFile('schůzka'), schuzkaWith('columns: [místo]\n'));
  await headersWhen(page, (h) => !h.includes('Datum'), S, 2000);
  assert.deepEqual(await eventually(() => sortOf(page, S), (s) => s[0]?.[0] === 'Title', 1000), [['Title', 'ascending']], 'the sorted column removed: the default sort (AC-22)');
  await core.setFile(typeFile('schůzka'), schuzka());
  assert.deepEqual(await headersWhen(page, (h) => h.includes('Modified'), S, 2000), ['Title', 'Datum', 'Účastníci', 'Modified'], 'the line deleted: the fallback columns');
  assert.equal((await callsOf(core, 'type_patch')).length, 0, 'nothing is written');
});

// ------------------------------------------------------------------------------------------------ FR-TYP-09 AC-29

test('fr_typ_09_ac29_many_columns_scroll_with_a_sticky_title', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const vault = typesVault((f) => withLine(f, 'projekt', 'preview: [stav, období]\n', PROJEKT_ALL));
  await openTypes(page, undefined, { vault, uiState: ui(), ...setPreviewMode('off') });
  await gotoTypePage(page, 'Projekty');
  await headersWhen(page, (h) => h.length === 13, 'Projekty');
  const s0 = await hScroll(page, 'Projekty');
  assert.ok(s0.found && s0.scrollWidth > s0.clientWidth, `the table's scroll container scrolls sideways: ${JSON.stringify(s0)}`);
  assert.equal(s0.docScroll, false, 'the page itself has no horizontal scroll');
  const tb = await (await must(typeTable(page, 'Projekty'), 'table')).boundingBox();
  await page.mouse.move(tb!.x + tb!.width / 2, tb!.y + 40);
  await page.mouse.wheel(300, 0);
  await sleep(200);
  assert.ok((await hScroll(page, 'Projekty')).scrollLeft > 0, 'a horizontal wheel scrolls it');
  const together = await typeTable(page, 'Projekty').evaluate((t) => {
    const hs = [...t.querySelectorAll('[role="columnheader"], th')] as HTMLElement[];
    const i = hs.findIndex((h) => h.innerText.trim() === 'Web');
    const r = ([...t.querySelectorAll('[role="row"], tr')] as HTMLElement[]).find((x) => !x.querySelector('[role="columnheader"], th'));
    const c = [...(r?.querySelectorAll('[role="cell"], [role="gridcell"], [role="rowheader"], td') ?? [])][i] as HTMLElement | undefined;
    return { header: hs[i]?.getBoundingClientRect().left ?? NaN, cell: c?.getBoundingClientRect().left ?? NaN };
  });
  assert.ok(near(together.header, together.cell), `the header row and the body scroll together: ${JSON.stringify(together)}`);
  await setScrollLeft(page, 'Projekty', 'end');
  const s1 = await hScroll(page, 'Projekty');
  const title = await titleColumn(page, 'Projekty');
  assert.ok(title.length >= 2, 'the Title header and cells');
  for (const c of title) {
    assert.ok(near(c.left, s1.left), `Title keeps its left edge at the container's (${c.left} vs ${s1.left})`);
    assert.equal(c.alpha, 1, 'an opaque background');
    assert.ok(c.onTop, 'the other cells pass under it');
  }
  await setScrollLeft(page, 'Projekty', 0);
  await focusHeader(page, 'Projekty', 'Title');
  const titleRight = (await titleColumn(page, 'Projekty'))[0].right;
  for (let i = 0; i < 24; i++) {
    await page.keyboard.press('Tab');
    const box = await page.evaluate(() => {
      const a = document.activeElement as HTMLElement | null;
      const h = a?.closest('[role="columnheader"], th') as HTMLElement | null;
      if (!h || a?.getAttribute('role') === 'separator') return null;
      const r = h.getBoundingClientRect();
      return { name: h.innerText.trim(), left: r.left, right: r.right };
    });
    if (!box) continue;
    const s = await hScroll(page, 'Projekty');
    assert.ok(box.left >= titleRight - 1 && box.right <= s.right + 1, `Tab: ${box.name} fully in view right of Title (${box.left}…${box.right}, Title ends ${titleRight}, view ends ${s.right})`);
  }
  await setScrollLeft(page, 'Projekty', 'half');
  const half = (await hScroll(page, 'Projekty')).scrollLeft;
  await typeTable(page, 'Projekty').getByRole('row').nth(1).focus();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowUp');
  assert.equal((await hScroll(page, 'Projekty')).scrollLeft, half, '↑/↓ on rows don\'t change scrollLeft');
  await page.keyboard.press('Enter');
  assert.ok(await eventually(() => mainName(page), (n) => !!n && n !== 'Projekty', 2000), '⏎ opens the row at any scroll position');
});

test('fr_typ_09_ac29_title_stays_opaque_in_dark_and_fills_with_few_columns', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const vault = typesVault((f) => withLine(f, 'projekt', 'preview: [stav, období]\n', PROJEKT_ALL));
  await openTypes(page, undefined, { vault, uiState: ui({ theme: 'dark' }) });
  await gotoTypePage(page, 'Projekty');
  await headersWhen(page, (h) => h.length === 13, 'Projekty');
  await setScrollLeft(page, 'Projekty', 'end');
  for (const c of await titleColumn(page, 'Projekty')) {
    assert.equal(c.alpha, 1, 'dark: an opaque Title background');
    assert.ok(c.onTop, 'dark: the other cells pass under Title');
  }
  await gotoTypePage(page, S);
  const s = await hScroll(page, S);
  assert.ok(s.found && s.scrollWidth <= s.clientWidth, `four fallback columns: no horizontal scroll (${JSON.stringify(s)})`);
  const tw = await width(header(page, S, 'Title'));
  assert.ok(near(tw, s.clientWidth - 3 * 160, 2) && tw >= 240, `Title fills the rest: ${tw} of ${s.clientWidth} (R130)`);
});

test('fr_typ_09_ac29_thirty_columns_scroll_with_a_sticky_title', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const core = await openTypes(page, undefined, { vault: wideVault() });
  await addWideObjects(core);
  await gotoTypePage(page, 'Široké');
  assert.equal((await headersWhen(page, (h) => h.length === 31, 'Široké')).length, 31, 'Title and 30 columns');
  const s = await hScroll(page, 'Široké');
  assert.ok(s.found && s.scrollWidth > s.clientWidth && !s.docScroll, `scrolls inside the table only: ${JSON.stringify(s)}`);
  await setScrollLeft(page, 'Široké', 'end');
  const after = await hScroll(page, 'Široké');
  for (const c of await titleColumn(page, 'Široké')) assert.ok(near(c.left, after.left) && c.alpha === 1 && c.onTop, 'sticky, opaque Title on top');
});

// ------------------------------------------------------------------------------------------------ FR-TYP-09 AC-30

test('fr_typ_09_ac30_every_header_has_a_resize_handle', async ({ page }) => {
  await openTypes(page);
  await gotoTypePage(page, S);
  for (const n of ['Title', 'Datum', 'Účastníci', 'Modified']) {
    const h = await must(handle(page, S, n), `separator "Resize ${n}"`);
    assert.equal(await h.getAttribute('aria-orientation'), 'vertical', `${n}: aria-orientation vertical`);
    const look = await h.evaluate((e) => ({ cursor: getComputedStyle(e).cursor, width: e.getBoundingClientRect().width }));
    assert.equal(look.cursor, 'col-resize', `${n}: cursor col-resize`);
    assert.ok(look.width >= 8, `${n}: a hit area at least 8 px wide (${look.width})`);
  }
});

test('fr_typ_09_ac30_dragging_resizes_one_column_within_the_limits', async ({ page }) => {
  const core = await openTypes(page, undefined, { uiState: ui(), ...setPreviewMode('click') });
  await gotoTypePage(page, S);
  const sort0 = await sortOf(page, S);
  const [w0, l0, wu0] = [await width(header(page, S, 'Datum')), await left(header(page, S, 'Účastníci')), await width(header(page, S, 'Účastníci'))];
  assert.ok(near(w0, 160), `Datum starts at 160 px (${w0})`);
  await dragBy(page, handle(page, S, 'Datum'), 100);
  assert.ok(near(await width(header(page, S, 'Datum')), 260), 'dragging 100 px right: 260 px');
  assert.ok(near(await left(header(page, S, 'Účastníci')), l0 + 100) && near(await width(header(page, S, 'Účastníci')), wu0), 'the columns to its right move; none changes width');
  await dragBy(page, handle(page, S, 'Datum'), -500);
  assert.ok(near(await width(header(page, S, 'Datum')), 80), 'stops at 80 px');
  await dragBy(page, handle(page, S, 'Datum'), 2000);
  assert.ok(near(await width(header(page, S, 'Datum')), 960), 'stops at 960 px');
  const tw = await width(header(page, S, 'Title'));
  await dragBy(page, handle(page, S, 'Title'), 100 - tw);
  assert.ok(near(await width(header(page, S, 'Title')), 160), 'Title dragged to 100 px stops at 160 px');
  assert.deepEqual(await sortOf(page, S), sort0, 'pressing, dragging and releasing a handle never sorts');
  assert.equal(await page.getByRole('dialog', { name: /^Preview: / }).count(), 0, 'and never previews a row');
  assert.equal((await callsOf(core, 'type_patch')).length, 0, 'and never reorders');
  const before = await width(header(page, S, 'Datum'));
  await dragBy(page, handle(page, S, 'Datum'), -200, async () => { await page.keyboard.press('Escape'); });
  assert.ok(near(await width(header(page, S, 'Datum')), before), 'Esc during a drag restores the width');
  await (await must(handle(page, S, 'Datum'), 'Resize Datum')).dblclick();
  assert.ok(near(await width(header(page, S, 'Datum')), 160), 'a double-click resets to 160 px');
  await (await must(handle(page, S, 'Title'), 'Resize Title')).dblclick();
  const s = await hScroll(page, S);
  assert.ok(near(await width(header(page, S, 'Title')), s.clientWidth - 3 * 160, 2), 'Title back to filling');
  assert.deepEqual(await sortOf(page, S), sort0, 'a double-click doesn\'t sort');
});

test('fr_typ_09_ac30_cells_follow_the_header_width_and_cut_long_text', async ({ page }) => {
  const long = 'Zasedací místnost ve třetím patře budovy B naproti kuchyňce, vedle tiskárny a velkého fíkusu';
  const vault = typesVault((f) => {
    withLine(f, 'schůzka', PREVIEW_S, 'columns: [místo, datum]\n');
    f[nfc(P.porada)] = swap(f[nfc(P.porada)], 'místo:\n', `místo: ${long}\n`);
  });
  await openTypes(page, undefined, { vault });
  await gotoTypePage(page, S);
  await dragBy(page, handle(page, S, 'Místo'), 40);
  const c = await cell(page, S, '2026-10-07 Porada', 'Místo');
  const other = await cell(page, S, 'Prázdná schůzka', 'Místo');
  assert.ok(c && near(c.width, await width(header(page, S, 'Místo'))), `the cell is as wide as its header (${c?.width})`);
  assert.ok(c!.ellipsis && c!.cutOverflows, 'long content is cut with an ellipsis');
  assert.ok(other && near(c!.height, other.height), 'it never wraps into a taller row');
  assert.equal(c!.title, long, 'the full text is the cell\'s title tooltip');
});

// ------------------------------------------------------------------------------------------------ FR-TYP-09 AC-31

test('fr_typ_09_ac31_resize_by_keyboard', async ({ page }) => {
  const core = await openTypes(page);
  await gotoTypePage(page, S);
  await focusHeader(page, S, 'Datum');
  await page.keyboard.press('Tab');
  assert.equal(await focusedHeader(page), 'separator:Resize Datum', 'Tab: the header, then its resize handle');
  await page.keyboard.press('Tab');
  assert.equal(await focusedHeader(page), 'Účastníci', 'then the next header');
  const h = await must(handle(page, S, 'Datum'), 'Resize Datum');
  await h.focus();
  const v = async () => Number(await h.getAttribute('aria-valuenow'));
  assert.deepEqual([await v(), await h.getAttribute('aria-valuemin'), await h.getAttribute('aria-valuemax')], [160, '80', '960'], 'aria-valuenow 160, min 80, max 960');
  const steps: [string, number][] = [['ArrowRight', 170], ['ArrowLeft', 160], ['Shift+ArrowRight', 210], ['Shift+ArrowLeft', 160], ['Home', 80], ['End', 960], ['Backspace', 160], ['End', 960], ['Delete', 160]];
  for (const [key, want] of steps) {
    await page.keyboard.press(key);
    assert.equal(await v(), want, `${key}: aria-valuenow ${want}`);
    assert.ok(near(await width(header(page, S, 'Datum')), want), `${key}: the column is ${want} px at once`);
  }
  assert.deepEqual(await nonReadCalls(core), [], 'no vault write');
});

test('fr_typ_09_ac31_reset_column_widths_and_palette_commands', async ({ page }) => {
  const core = await openTypes(page, undefined, { uiState: ui({ typeColumnWidths: { 'schůzka': { datum: 300, title: 400 }, 'nápad': { 'hodnocení': 200 } } }) });
  await gotoTypePage(page, S);
  assert.ok(near(await width(header(page, S, 'Datum')), 300), 'setup: the stored width');
  const m = await openColumns(page);
  const order = await m.evaluate((el) => [...el.querySelectorAll('[role="menuitemcheckbox"], [role="menuitem"], [role="separator"]')].map((e) => e.getAttribute('role') === 'separator' ? '—' : ((e as HTMLElement).innerText ?? '').trim()));
  assert.deepEqual(order.slice(-4), ['—', 'New property…', '—', 'Reset column widths'], `the menu ends with a separator and Reset column widths: ${order.join(' | ')}`);
  await m.getByRole('menuitem', { name: 'Reset column widths', exact: true }).click();
  assert.ok(near(await width(header(page, S, 'Datum')), 160), 'Datum back to 160 px');
  const s = await hScroll(page, S);
  assert.ok(near(await width(header(page, S, 'Title')), s.clientWidth - 3 * 160, 2), 'Title back to filling');
  const u = await eventually(() => core.uiState(), (x: any) => x?.typeColumnWidths?.['nápad']?.['hodnocení'] === 200 && !x?.typeColumnWidths?.['schůzka']?.datum, 2000) as any;
  assert.equal(u?.typeColumnWidths?.['nápad']?.['hodnocení'], 200, 'other types\' widths are left alone');
  await runCommand(page, 'Choose columns…');
  assert.ok(await seen(columnsMenu(page), 1000), '`Choose columns…` opens the Columns menu');
  await page.keyboard.press('Escape');
  assert.deepEqual(await nonReadCalls(core), [], 'none of these writes to the vault');
});

// ------------------------------------------------------------------------------------------------ FR-TYP-09 AC-32

test('fr_typ_09_ac32_widths_are_machine_local_and_per_type', async ({ page }) => {
  const core = await openTypes(page, undefined, { uiState: ui({ typeColumnWidths: { 'schůzka': { smazaný: 300 } } }) });
  await gotoTypePage(page, S);
  assert.ok(near(await width(header(page, S, 'Datum')), 160), 'a column key with no column is ignored');
  const n0 = (await callsOf(core, 'ui_state_set')).length;
  await dragBy(page, handle(page, S, 'Datum'), 100, async () => {
    assert.equal((await callsOf(core, 'ui_state_set')).length, n0, 'nothing stored before the release');
  });
  const n1 = (await callsOf(core, 'ui_state_set')).length;
  assert.equal(n1 - n0, 1, 'the UI state is written once per drag (on release)');
  assert.equal(((await core.uiState()) as any)?.typeColumnWidths?.['schůzka']?.datum, 260, 'typeColumnWidths.schůzka.datum = 260');
  await gotoTypePage(page, 'Nápady');
  const h = await must(handle(page, 'Nápady', 'Hodnocení'), 'Resize Hodnocení');
  await h.focus();
  for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowRight');
  const u = await eventually(() => core.uiState(), (x: any) => x?.typeColumnWidths?.['nápad']?.['hodnocení'] === 200, 1000) as any;
  assert.equal(u?.typeColumnWidths?.['nápad']?.['hodnocení'], 200, 'stored within 1 s of the last keyboard change');
  await gotoTypePage(page, 'Projekty');
  for (const n of ['Stav', 'Období', 'Modified']) assert.ok(near(await width(header(page, 'Projekty', n)), 160), `projekt ${n}: the R130 default`);
  assert.deepEqual(await nonReadCalls(core), [], 'no vault write by any resize');
  await gotoTypePage(page, 'Nápady');
  await openColumns(page);
  await toggle(page, 'Hodnocení');
  await headersWhen(page, (x) => !x.includes('Hodnocení'), 'Nápady');
  await toggle(page, 'Hodnocení');
  await headersWhen(page, (x) => x.includes('Hodnocení'), 'Nápady');
  assert.ok(near(await width(header(page, 'Nápady', 'Hodnocení')), 200), 'a width is kept while its column is unchecked and comes back with it');
});

// ------------------------------------------------------------------------------------------------ FR-TYP-09 AC-33

test('fr_typ_09_ac33_thirty_columns_and_300_rows_keep_the_dom_bounded', async ({ page }) => {
  const core = await openTypes(page, undefined, { vault: wideVault() });
  await addWideObjects(core);
  await gotoTypePage(page, 'Široké');
  await headersWhen(page, (h) => h.length === 31, 'Široké', 3000);
  const top = await domRows(page, 'Široké');
  assert.ok(top.rows > 0 && top.rows <= 100, `at most 100 rows in the DOM: ${top.rows}`);
  assert.ok(top.cells.every((c) => c === 31), `each with 31 cells (columns are not virtualized): ${[...new Set(top.cells)].join(', ')}`);
  await scrollRows(page, 'Široké', 'end');
  const end = await eventually(() => domRows(page, 'Široké'), (d) => d.titles.includes('Řádek 300'), 2000);
  assert.ok(end.titles.includes('Řádek 300') && end.rows <= 100, `scrolled to the last row: Řádek 300 (${end.rows} rows)`);
  await scrollRows(page, 'Široké', 'start');
  const back = await eventually(() => domRows(page, 'Široké'), (d) => d.titles.includes('Řádek 001'), 2000);
  assert.ok(back.titles.includes('Řádek 001'), 'and back: Řádek 001');
});

// ------------------------------------------------------------------------------------------------ FR-TYP-09 AC-34

for (const theme of ['light', 'dark'] as const) {
  test(`fr_typ_09_ac34_themes_with_many_columns_the_menu_and_a_handle_${theme}`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.emulateMedia({ colorScheme: theme });
    const vault = typesVault((f) => withLine(f, 'projekt', 'preview: [stav, období]\n', PROJEKT_ALL.replace('created]', 'created, neznámý]')));
    await openTypes(page, undefined, { vault, uiState: ui({ theme }) });
    await gotoTypePage(page, 'Projekty');
    await headersWhen(page, (h) => h.length === 13, 'Projekty');
    await setScrollLeft(page, 'Projekty', 'half');
    const m = await openColumns(page);
    assert.ok(await seen(m.getByText('Not a property of Projekt, kept in the file: neznámý', { exact: true }), 1000), 'the AC-25 warning is shown');
    assert.deepEqual(await axeContrast(page), [], `${theme}: axe color-contrast with the menu open (FR-UX-05 AC-4)`);
    assert.deepEqual(await colourLeaks(page, theme), [], `${theme}: only theme tokens (FR-UX-05 AC-5)`);
    await page.keyboard.press('Escape');
    const h = await must(handle(page, 'Projekty', 'Web'), 'Resize Web');
    await h.focus();
    const look = await h.evaluate((e) => {
      const opaque = (c: string) => !!c && c !== 'transparent' && !/rgba\([^)]*,\s*0\)$/.test(c);
      const bg = (el: Element | null): string => { while (el) { const c = getComputedStyle(el).backgroundColor; if (opaque(c)) return c; el = el.parentElement; } return 'rgb(255, 255, 255)'; };
      const colours = [e, ...e.querySelectorAll('*')].flatMap((x) => [getComputedStyle(x).backgroundColor, getComputedStyle(x).borderLeftColor, getComputedStyle(x, '::after').backgroundColor, getComputedStyle(x, '::before').backgroundColor]);
      const s = getComputedStyle(e);
      return { mark: colours.find(opaque) ?? null, ring: s.outlineStyle !== 'none' ? s.outlineColor : (/rgba?\([^)]+\)/.exec(s.boxShadow)?.[0] ?? null), header: bg(e.closest('[role="columnheader"], th') ?? e.parentElement) };
    });
    assert.ok(look.mark && contrast(look.mark, look.header) >= 3, `${theme}: the handle has ≥ 3:1 against the header (${JSON.stringify(look)})`);
    assert.ok(look.ring && contrast(look.ring, look.header) >= 3, `${theme}: its focus ring has ≥ 3:1 against the header (${JSON.stringify(look)})`);
    assert.deepEqual(await axeContrast(page), [], `${theme}: axe color-contrast with a handle focused`);
  });
}

// ------------------------------------------------------------------------------------------------ FR-TYP-11 AC-4

test('fr_typ_11_ac4_preview_and_columns_are_separate', async ({ page }) => {
  const vault = typesVault((f) => withLine(f, 'schůzka', PREVIEW_S, 'columns: [místo, datum]\n'));
  const core = await openTypes(page, undefined, { vault, ...setPreviewMode('click') });
  await gotoTypePage(page, S);
  assert.deepEqual(await headersWhen(page, (h) => h.includes('Místo')), ['Title', 'Místo', 'Datum'], 'setup: the runtime columns');
  await (await must(typeTable(page, S).getByRole('row').filter({ hasText: '2026-10-07 Porada' }), 'row Porada')).click();
  const strip = await mustPreview(page, '2026-10-07 Porada', '(d) the row preview of Porada');
  const text = await strip.innerText();
  assert.ok(text.includes('Datum') && text.includes('Účastníci') && !text.includes('Místo'), `(d) the preview strip follows preview, never columns: ${text.replace(/\s+/g, ' ')}`);
  await page.keyboard.press('Escape');
  await gotoSettings(page, S, 'Schůzka');
  const sec = await must(section(page, 'Preview properties'), 'Preview properties');
  await (await must(sec.getByRole('button', { name: 'Remove Datum from preview', exact: true }), 'Remove Datum from preview')).click();
  const t = await fileWhen(core, typeFile('schůzka'), (x) => !!x?.includes('preview: [účastníci]\n'));
  assert.equal(t, swap(vault.files[typeFile('schůzka')], PREVIEW_S, 'preview: [účastníci]\n'), '(b) only the preview line is written');
  await gotoTypePage(page, S);
  assert.deepEqual(await headers(page), ['Title', 'Místo', 'Datum'], '(b) the type page\'s columns don\'t change');
  assert.deepEqual(await writtenOutside(core, [typeFile('schůzka')]), [], 'no note file');
});
