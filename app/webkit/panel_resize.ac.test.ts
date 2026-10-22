// Preview v0.55 panel feedback, L5 (WebKit + fake core): the resizable right panel. docs/acceptance/app-shell.md
// FR-UX-02 AC-19 (D-634: a `separator` `Resize panel` on the panel's left edge, drag 240…480 px, default 288, the centre
// pane narrows by the same amount, the note column stays centred, double-click resets, nothing in the vault is
// written), AC-20 (keyboard: in the Tab order right before the tabs, ←/→ ±16 px, Home/End, a visible focus ring in both
// themes), AC-21 L5 part (the width survives closing/reopening and moving to another note, `ui_state_set` stores
// `rightPanel.width`, a missing width reads as 288, a narrow window draws the panel narrower without changing the
// stored width, AC-18's automatic closing still holds). Interface docs/contracts/ms4-links.md §9.3 (`RightPanelDto`
// gains `width`; the separator is `role="separator"`, `tabIndex=0`, `aria-label` `Resize panel`, `aria-orientation`
// `vertical`, `aria-valuemin` 240, `aria-valuemax` 480, `aria-valuenow` = the drawn width; stored when a drag ends or a
// key changes it), ms3-shell.md §3 (UiStateDto, `ui_state_set`). Written from the ACs and the contracts only (D-61).
// Every lookup goes through `must`/node:assert (TS-I1).
//
// The fake core's `UiStateDto` type predates `width`; a state with a width is passed through a cast.
import { test, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import type { UiStateDto } from '../ui/test/fake-core';
import { absent, eventually, must, nonReadCalls, openNote, panel, seen, sidebar, sleep, start, type FakeCoreHandle } from './helpers';

const near = (a: number, b: number, tol = 1) => Math.abs(a - b) <= tol;
const PORADA = '2026-10-07 Porada';
const OTHER = 'Zavolat Evě';

const ui = (o: { theme?: 'light' | 'dark'; width?: number; open?: boolean } = {}) =>
  ({ version: 1, theme: o.theme ?? 'light', sidebarOpen: true, rightPanel: { open: o.open ?? true, tab: 'backlinks', ...(o.width === undefined ? {} : { width: o.width }) } }) as unknown as UiStateDto;

const separator = (page: Page) => page.getByRole('separator', { name: 'Resize panel', exact: true });

/** Starts the shell fixture in a 1440 × 900 (or given) viewport and opens Porada with the panel open. */
async function openWithPanel(page: Page, o: { theme?: 'light' | 'dark'; width?: number; viewport?: number } = {}): Promise<FakeCoreHandle> {
  await page.setViewportSize({ width: o.viewport ?? 1440, height: 900 });
  const core = await start(page, { uiState: ui({ theme: o.theme, width: o.width }) });
  await openNote(page, PORADA);
  if (!(await seen(panel(page), 1000))) await page.keyboard.press('Meta+Backslash');
  await must(panel(page), 'Context panel');
  return core;
}
const widthOf = async (page: Page) => (await panel(page).boundingBox())?.width ?? 0;
const mainWidth = async (page: Page) => (await page.getByRole('main').boundingBox())?.width ?? 0;
async function valueNow(page: Page): Promise<number | null> {
  const v = await separator(page).first().getAttribute('aria-valuenow', { timeout: 1000 }).catch(() => null);
  return v === null ? null : Number(v);
}
async function needSeparator(page: Page) {
  return must(separator(page), 'separator "Resize panel"', 3000);
}
/** Drags the separator horizontally by `dx` px from its centre (pointer down, moves, up). */
async function drag(page: Page, dx: number) {
  const b = (await (await needSeparator(page)).boundingBox())!;
  const x = b.x + b.width / 2, y = b.y + b.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y, { steps: 12 });
  await page.mouse.up();
  await sleep(100);
}
/** Left and right margins of the note column inside the centre pane (FR-UX-01 AC-1). */
async function columnMargins(page: Page): Promise<[number, number] | null> {
  return page.getByRole('main').evaluate((m) => {
    const h = m.querySelector('h1');
    const mb = m.getBoundingClientRect();
    let col: Element | null = h;
    let best: DOMRect | null = null;
    while (col && col !== m) {
      const r = col.getBoundingClientRect();
      if (r.width < mb.width - 2) best = r;
      col = col.parentElement;
    }
    return best ? [best.x - mb.x, mb.x + mb.width - (best.x + best.width)] as [number, number] : null;
  });
}
async function storedWidth(core: FakeCoreHandle): Promise<unknown> {
  return ((await core.uiState()) as any)?.rightPanel?.width;
}

// ------------------------------------------------------------------------------------------------ FR-UX-02 AC-19

test('fr_ux_02_ac19_separator_on_the_left_edge_with_its_aria_values', async ({ page }) => {
  await openWithPanel(page);
  const sep = await needSeparator(page);
  const attrs = await sep.evaluate((e) => ['aria-orientation', 'aria-valuemin', 'aria-valuemax', 'aria-valuenow'].map((a) => e.getAttribute(a)));
  assert.deepEqual(attrs, ['vertical', '240', '480', '288'], 'aria-orientation vertical, valuemin 240, valuemax 480, valuenow 288');
  assert.ok(near(await widthOf(page), 288), `the panel opens at its default 288 px (${await widthOf(page)})`);
  const s = (await sep.boundingBox())!;
  const p = (await panel(page).boundingBox())!;
  assert.ok(s.x <= p.x + 8 && s.x + s.width >= p.x - 8 && s.height >= p.height * 0.5, `the separator sits on the panel's left edge (separator ${JSON.stringify(s)}, panel x ${p.x})`);
  await sep.hover();
  const cursor = await sep.evaluate((e) => getComputedStyle(e).cursor);
  assert.ok(['col-resize', 'ew-resize'].includes(cursor), `the resize cursor on hover (got ${cursor})`);
});

test('fr_ux_02_ac19_dragging_sets_the_width_between_240_and_480', async ({ page }) => {
  const core = await openWithPanel(page);
  await needSeparator(page);
  const main0 = await mainWidth(page);
  await drag(page, -100);
  assert.ok(near(await widthOf(page), 388), `100 px to the left: the panel is 388 px (${await widthOf(page)})`);
  assert.ok(near(main0 - (await mainWidth(page)), 100), `the centre pane is 100 px narrower (${main0} → ${await mainWidth(page)})`);
  assert.equal(await valueNow(page), 388, 'aria-valuenow 388');
  const m = await columnMargins(page);
  assert.ok(m && near(m[0], m[1]), `the note column stays centred in the centre pane (${JSON.stringify(m)})`);
  await drag(page, -400);
  assert.ok(near(await widthOf(page), 480), `400 px further left stops at 480 (${await widthOf(page)})`);
  assert.equal(await valueNow(page), 480, 'aria-valuenow 480');
  await drag(page, 400);
  assert.ok(near(await widthOf(page), 240), `400 px to the right stops at 240 (${await widthOf(page)})`);
  assert.equal(await valueNow(page), 240, 'aria-valuenow 240');
  assert.ok(near(main0 - (await mainWidth(page)), -48), `the centre pane is 48 px wider than at 288 (${main0} → ${await mainWidth(page)})`);
  const m2 = await columnMargins(page);
  assert.ok(m2 && near(m2[0], m2[1]), `the note column stays centred at 240 (${JSON.stringify(m2)})`);
  await (await needSeparator(page)).dblclick();
  await sleep(100);
  assert.ok(near(await widthOf(page), 288), `a double-click resets to 288 (${await widthOf(page)})`);
  assert.equal(await valueNow(page), 288, 'aria-valuenow 288 after the double-click');
  assert.deepEqual(await nonReadCalls(core), [], 'nothing in the vault is written (ui_state_set is machine-local)');
  assert.equal(await core.writes(), 0, 'no vault write');
});

// ------------------------------------------------------------------------------------------------ FR-UX-02 AC-20

test('fr_ux_02_ac20_separator_is_in_the_tab_order_right_before_the_tabs', async ({ page }) => {
  await openWithPanel(page);
  await needSeparator(page);
  const tab = await must(panel(page).getByRole('tab', { selected: true }), 'the selected panel tab');
  await tab.focus();
  await page.keyboard.press('Shift+Tab');
  const prev = await page.evaluate(() => ({ role: document.activeElement?.getAttribute('role') ?? null, name: document.activeElement?.getAttribute('aria-label') ?? null }));
  assert.deepEqual(prev, { role: 'separator', name: 'Resize panel' }, '⇧Tab from the tabs focuses the separator');
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('role') ?? null), 'tab', 'Tab from the separator goes to the tabs');
});

test('fr_ux_02_ac20_arrows_home_and_end_resize', async ({ page }) => {
  await openWithPanel(page);
  const sep = await needSeparator(page);
  await sep.focus();
  const steps: [string, number][] = [
    ['ArrowLeft', 304], ['ArrowRight', 288], ['ArrowRight', 272], ['Home', 240], ['ArrowRight', 240],
    ['End', 480], ['ArrowLeft', 480], ['ArrowRight', 464],
  ];
  const got: string[] = [];
  for (const [key, want] of steps) {
    await page.keyboard.press(key);
    await sleep(60);
    const w = Math.round(await widthOf(page));
    const v = await valueNow(page);
    if (!near(w, want) || v !== want) got.push(`${key}: width ${w}, aria-valuenow ${v}, want ${want}`);
  }
  assert.deepEqual(got, [], '← widens and → narrows by 16 px, Home 240, End 480, clamped; aria-valuenow follows');
});

for (const theme of ['light', 'dark'] as const) {
  test(`fr_ux_02_ac20_separator_focus_ring_visible_${theme}`, async ({ page }) => {
    await openWithPanel(page, { theme });
    const sep = await needSeparator(page);
    const look = () => sep.evaluate((e) => { const s = getComputedStyle(e); return { outline: `${s.outlineStyle} ${s.outlineWidth} ${s.outlineColor}`, ow: parseFloat(s.outlineWidth) || 0, os: s.outlineStyle, shadow: s.boxShadow }; });
    const before = await look();
    const tab = await must(panel(page).getByRole('tab', { selected: true }), 'the selected panel tab');
    await tab.focus();
    await page.keyboard.press('Shift+Tab');
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? null), 'Resize panel', `${theme}: the separator has the keyboard focus`);
    const after = await look();
    const outline = after.os !== 'none' && after.ow >= 2 && after.outline !== before.outline;
    const ring = after.shadow !== before.shadow && after.shadow !== 'none' && /(\d+(\.\d+)?)px/.test(after.shadow) && [...after.shadow.matchAll(/(\d+(?:\.\d+)?)px/g)].some((m) => Number(m[1]) >= 2);
    assert.ok(outline || ring, `${theme}: a visible focus ring (≥ 2 px outline or box-shadow that differs from unfocused): before ${JSON.stringify(before)}, after ${JSON.stringify(after)}`);
  });
}

// ------------------------------------------------------------------------------------------------ FR-UX-02 AC-21 (L5)

test('fr_ux_02_ac21_width_kept_across_close_reopen_and_notes_and_stored', async ({ page }) => {
  const core = await openWithPanel(page);
  const sep = await needSeparator(page);
  await sep.focus();
  for (let i = 0; i < 7; i++) await page.keyboard.press('ArrowLeft');
  assert.ok(near(await widthOf(page), 400), `set to 400 px (${await widthOf(page)})`);
  assert.equal(await eventually(() => storedWidth(core), (w) => w === 400, 2000), 400, 'ui_state_set stores rightPanel.width: 400');
  await page.keyboard.press('Meta+Backslash');
  assert.ok(await absent(panel(page), 1500), '⌘\\ closes the panel');
  await page.keyboard.press('Meta+Backslash');
  await must(panel(page), 'panel reopened');
  assert.ok(near(await widthOf(page), 400), `reopened at 400 px (${await widthOf(page)})`);
  await openNote(page, OTHER);
  await must(panel(page), 'panel on the other note');
  assert.ok(near(await widthOf(page), 400), `another note keeps 400 px (${await widthOf(page)})`);
  assert.equal(await storedWidth(core), 400, 'still stored as 400');
  assert.deepEqual(await nonReadCalls(core), [], 'nothing in the vault is written');
});

test('fr_ux_02_ac21_missing_width_reads_as_288', async ({ page }) => {
  await openWithPanel(page);
  await needSeparator(page);
  assert.ok(near(await widthOf(page), 288), `a UiStateDto without width opens the panel at 288 (${await widthOf(page)})`);
  assert.equal(await valueNow(page), 288, 'aria-valuenow 288');
});

test('fr_ux_02_ac21_a_stored_width_is_restored', async ({ page }) => {
  await openWithPanel(page, { width: 400 });
  await needSeparator(page);
  assert.ok(near(await widthOf(page), 400), `rightPanel.width 400 opens the panel at 400 (${await widthOf(page)})`);
  assert.equal(await valueNow(page), 400, 'aria-valuenow 400');
});

test('fr_ux_02_ac21_narrow_window_draws_the_panel_narrower_and_keeps_the_stored_width', async ({ page }) => {
  const core = await openWithPanel(page, { width: 480, viewport: 900 });
  await needSeparator(page);
  assert.ok(await seen(sidebar(page), 500), 'the sidebar is open');
  const main = await mainWidth(page);
  const w = await widthOf(page);
  assert.ok(main >= 399.5 && main <= 402, `the centre pane stays at least 400 px, no wider than needed (${main})`);
  assert.ok(w >= 240 && w < 479, `the panel is drawn narrower than the stored 480 (${w})`);
  assert.equal(await valueNow(page), Math.round(w), 'aria-valuenow is the drawn width');
  assert.equal(await storedWidth(core), 480, 'the stored width stays 480');
  await page.setViewportSize({ width: 1440, height: 900 });
  assert.ok(near(await eventually(() => widthOf(page), (x) => near(x, 480), 1500), 480), `widening the window brings 480 back (${await widthOf(page)})`);
  // AC-18: below the width at which even 240 px doesn't fit, the panel closes by itself and comes back.
  await page.setViewportSize({ width: 800, height: 500 });
  assert.ok(await absent(panel(page), 1500), 'at 800 px the panel closes by itself (AC-18)');
  assert.ok((await mainWidth(page)) >= 400, 'the centre pane stays at least 400 px');
  await page.setViewportSize({ width: 1440, height: 900 });
  assert.ok(await seen(panel(page), 1500), 'the panel reopens when the window is widened');
  assert.ok(near(await eventually(() => widthOf(page), (x) => near(x, 480), 1500), 480), `at 480 px again (${await widthOf(page)})`);
  assert.equal(await storedWidth(core), 480, 'the stored width is still 480');
});
