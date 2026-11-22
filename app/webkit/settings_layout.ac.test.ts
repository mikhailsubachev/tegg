// Slice OC, L5: the shared Settings layout (docs/acceptance/app-shell.md R219, FR-UX-02 AC-22…AC-26; D-1959, D-1994):
// the 168 px section list, the 170 px label column, notes under their controls, the 940 px content, the eight sections,
// nothing added, removed or changed against tests/fixtures/settings/controls-0.5.json, keyboard and screen reader, and the
// trash-history placeholder's design entry. Through the fake core with the inbox vault (docs/contracts/v1-cards.md §7.10,
// §8.4; settings-helpers.ts). Written from the ACs and the contract only (D-61).
import type { Page } from '@playwright/test';
import { test } from '@playwright/test';
import assert from 'node:assert/strict';
import { description, eventually, focusName, must, runCommand, sleep, vaultWrites } from './capture-helpers';
import { SECTION_NAMES, SETTINGS_ROUTES, settingsControls, snapshot05, startSettings } from './settings-helpers';

test.use({ timezoneId: 'Europe/Prague' });

const nav = (page: Page) => page.getByRole('navigation', { name: /^⟦?Settings sections⟧?$/ });
type Row = { label: { x: number; y: number; w: number } | null; control: { x: number; y: number; bottom: number } | null; notes: { x: number; y: number }[]; box: { x: number; y: number; w: number; h: number } };
async function rows(page: Page): Promise<{ nav: { x: number; w: number } | null; content: { x: number; w: number; scroll: boolean } | null; rows: Row[] }> {
  return page.evaluate(() => {
    const r = (e: Element | null) => (e ? e.getBoundingClientRect() : null);
    const navEl = document.querySelector('nav.settings-sections');
    const layout = document.querySelector('div.settings-layout') as HTMLElement | null;
    const out = ([...document.querySelectorAll('div.settings-row')] as HTMLElement[]).map((row) => {
      const l = r(row.querySelector('.settings-label'));
      const ctl = row.querySelector('.settings-control');
      const first = ctl?.querySelector('button, input, select, textarea, [role="switch"], [role="radiogroup"], [role="combobox"], a[href]') ?? ctl;
      const c = r(first);
      const b = row.getBoundingClientRect();
      return {
        label: l ? { x: l.left, y: l.top, w: l.width } : null, control: c ? { x: c.left, y: c.top, bottom: c.bottom } : null,
        notes: ([...row.querySelectorAll('.settings-note')] as HTMLElement[]).map((n) => ({ x: n.getBoundingClientRect().left, y: n.getBoundingClientRect().top })),
        box: { x: b.left, y: b.top, w: b.width, h: b.height },
      };
    });
    const nb = r(navEl);
    const lb = layout?.getBoundingClientRect();
    const pane = document.querySelector('main') as HTMLElement | null;
    return { nav: nb ? { x: nb.left, w: nb.width } : null, content: lb ? { x: lb.left, w: lb.width, scroll: !!pane && pane.scrollWidth > pane.clientWidth + 1 } : null, rows: out };
  });
}
const near = (a: number, b: number, t = 1) => Math.abs(a - b) <= t;

// ------------------------------------------------------------------------------------------------ FR-UX-02 AC-22

test('fr_ux_02_ac22_settings_layout', async ({ page }) => {
  const routes = [...SETTINGS_ROUTES.filter((r) => r !== 'settings/trash-history'), 'type-settings/page'];
  const bad: string[] = [];
  let ref: { label: number; control: number } | null = null;
  for (const [w, h] of [[1440, 900], [1024, 900]]) {
    for (const r of routes) {
      const p = await page.context().newPage();
      await startSettings(p, r, { width: w, height: h });
      await must(nav(p), `${r}: the nav Settings sections`, 8000);
      const g = await rows(p);
      if (!g.nav || !near(g.nav.w, 168)) bad.push(`${w} ${r}: section list ${g.nav?.w} px, not 168`);
      if (!g.content || g.content.w > 940 + 0.5) bad.push(`${w} ${r}: content ${g.content?.w} px > 940`);
      if (!g.rows.length) bad.push(`${w} ${r}: no settings-row`);
      for (const [i, row] of g.rows.entries()) {
        if (!row.label || !row.control) continue;
        ref ??= { label: row.label.x, control: row.control.x };
        if (!near(row.label.x, ref.label) || !near(row.label.w, 170)) bad.push(`${w} ${r} row ${i}: label at ${row.label.x}, ${row.label.w} px wide`);
        if (!near(row.control.x, ref.control)) bad.push(`${w} ${r} row ${i}: control at ${row.control.x}, not ${ref.control}`);
        if (Math.abs(row.label.y - row.control.y) > 4) bad.push(`${w} ${r} row ${i}: label top ${row.label.y} vs control ${row.control.y}`);
        for (const n of row.notes) if (n.y < row.control.bottom - 0.5 || !near(n.x, row.control.x)) bad.push(`${w} ${r} row ${i}: a note not under its control`);
        for (const [j, other] of g.rows.entries()) {
          if (j <= i) continue;
          const a = row.box, b = other.box;
          if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h - 0.5 && b.y < a.y + a.h - 0.5) bad.push(`${w} ${r}: rows ${i} and ${j} overlap`);
        }
      }
      await p.close();
    }
    ref = null;
  }
  // The minimum window: the control column shrinks, nothing scrolls sideways.
  const m = await page.context().newPage();
  await startSettings(m, 'settings/vault', { width: 800, height: 500 });
  await must(nav(m), 'minimum window: the section list', 8000);
  const g = await rows(m);
  if (!g.content || g.content.scroll) bad.push('800 × 500: the pane scrolls sideways');
  assert.deepEqual(bad, [], 'R219\'s layout on every route');
});

// ------------------------------------------------------------------------------------------------ FR-UX-02 AC-23

test('fr_ux_02_ac23_the_eight_sections', async ({ page }) => {
  for (const r of SETTINGS_ROUTES) {
    const p = await page.context().newPage();
    await startSettings(p, r);
    const n = await must(nav(p), `${r}: the section list`, 8000);
    assert.deepEqual((await n.getByRole('link').allTextContents()).map((t) => t.trim()), SECTION_NAMES, `${r}: the eight sections in order`);
    const beside = await p.evaluate(() => {
      const nv = document.querySelector('div.settings-layout > nav.settings-sections');
      const content = document.querySelector('div.settings-layout > div.settings-content');
      return !!nv && !!content && nv.getBoundingClientRect().right <= content.getBoundingClientRect().left;
    });
    assert.ok(beside, `${r}: the section list is one column beside the content in the shared layout (§8.4)`);
    if (r === 'settings/trash-history') assert.ok((await p.getByRole('main').innerText()).includes('Coming in v1.0'), 'trash-history: its TBD placeholder inside the layout');
    await p.close();
  }
  await startSettings(page, 'inbox');
  await page.keyboard.press('Meta+Comma');
  const n = await must(nav(page), '⌘, opens Settings with the section list', 5000);
  assert.equal(await n.getByRole('link', { name: /^⟦?Appearance⟧?$/ }).getAttribute('aria-current'), 'page', 'Appearance is aria-current="page"');
  await n.getByRole('link', { name: /^⟦?Backups⟧?$/ }).click();
  assert.equal((await eventually(async () => (await focusName(page)).name, (x) => x.includes('Backups'), 2000)).replace(/[⟦⟧]/g, '').includes('Backups'), true, 'each link opens its route, the focus on the h1');
});

// ------------------------------------------------------------------------------------------------ FR-UX-02 AC-24

test('fr_ux_02_ac24_nothing_added_removed_or_changed', async ({ page }) => {
  const snap = snapshot05();
  assert.ok(snap, 'tests/fixtures/settings/controls-0.5.json exists');
  const bad: string[] = [];
  for (const r of SETTINGS_ROUTES) {
    const p = await page.context().newPage();
    const core = await startSettings(p, r);
    await must(nav(p), `${r}: the shared layout`, 8000);
    await sleep(500);
    const got = await settingsControls(p);
    const outside = await p.getByRole('main').evaluate((m) => ([...m.querySelectorAll('button, input, select, textarea, [role="switch"], [role="radio"], [role="slider"], [role="combobox"]')] as HTMLElement[])
      .filter((e) => e.getClientRects().length && !e.closest('nav.settings-sections') && !e.closest('div.settings-row .settings-control')).length);
    if (outside) bad.push(`${r}: ${outside} control(s) outside the shared layout's rows (SettingsRow, §6.2)`);
    if (JSON.stringify(got) !== JSON.stringify(snap![r])) bad.push(`${r}:\n got  ${JSON.stringify(got)}\n want ${JSON.stringify(snap![r])}`);
    if ((await vaultWrites(core)).length) bad.push(`${r}: opening wrote ${await vaultWrites(core)}`);
    await p.close();
  }
  assert.deepEqual(bad, [], 'every control of every settings/* route equals the 0.5.x snapshot (role, name, description, value, disabled)');
});

// ------------------------------------------------------------------------------------------------ FR-UX-02 AC-25

test('fr_ux_02_ac25_settings_keyboard_and_screen_reader', async ({ page }) => {
  await startSettings(page, 'settings/date-time');
  const n = await must(nav(page), 'the section list', 8000);
  await page.getByRole('main').getByRole('heading', { level: 1 }).focus();
  const seen: string[] = [];
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press('Tab');
    const f = await focusName(page);
    seen.push(`${f.role}:${f.name.replace(/[⟦⟧]/g, '')}`);
  }
  assert.deepEqual(seen.slice(0, 8), SECTION_NAMES.map((s) => `link:${s}`), 'Tab from the h1 reaches the section links in order');
  assert.ok(seen.slice(8).every((s) => !s.startsWith('generic:') && !/label/i.test(s)), 'then the controls; the label column is never a Tab stop');
  const labelled = await page.locator('div.settings-row').evaluateAll((rs) => rs.map((r) => {
    const label = r.querySelector('.settings-label');
    const ctl = r.querySelector('.settings-control button, .settings-control input, .settings-control select, .settings-control [role="switch"], .settings-control [role="radiogroup"], .settings-control [role="combobox"]') as HTMLElement | null;
    if (!label || !ctl) return 'missing';
    const viaFor = label.tagName === 'LABEL' && (label as HTMLLabelElement).htmlFor === ctl.id;
    const viaBy = (ctl.getAttribute('aria-labelledby') ?? '').split(/\s+/).includes(label.id);
    return viaFor || viaBy ? 'ok' : `unlabelled: ${label.textContent}`;
  }));
  assert.ok(labelled.length > 0 && labelled.every((x) => x === 'ok'), `each control is named by its label (${labelled})`);
  const tabStopBox = await page.evaluate(() => { const e = document.activeElement as HTMLElement; const cs = getComputedStyle(e); return cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) >= 2; });
  assert.ok(tabStopBox, 'the focused control shows the indicator');
  await n.getByRole('link', { name: /^⟦?Vault⟧?$/ }).focus();
  await page.keyboard.press('Enter');
  await must(page.getByRole('main').getByRole('heading', { level: 1, name: /Vault/ }), '⏎ on a section link opens its route', 3000);
  void description; void runCommand;
});

// ------------------------------------------------------------------------------------------------ FR-UX-02 AC-26 (L5)

test('fr_ux_02_ac26_settings_design_entries', async ({ page }) => {
  await startSettings(page, 'settings/trash-history');
  await must(nav(page), 'the section list beside the placeholder', 8000);
  assert.ok((await page.getByRole('main').innerText()).includes('View design: Settings'), 'the placeholder shows View design: Settings');
});
