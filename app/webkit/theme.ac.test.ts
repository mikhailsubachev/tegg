// MS3 slice 3A, L5 (WebKit + fake core): FR-UX-05 AC-4…AC-6 (rendered themes) and FR-SET-02 AC-1…AC-3, AC-5.
// Written from docs/acceptance/app-shell.md and docs/contracts/ms3-shell.md §3.5, §3.7 only (D-61).
import { test, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import type { UiStateDto } from '../ui/test/fake-core';
import {
  absent, eventually, gotoType, mainName, must, mustBeDraft, mustBeOn, openNote, paletteDialog, runCommand, seen, sleep,
  start, switcherDialog, theme,
} from './helpers';

const AXE = createRequire(import.meta.url).resolve('axe-core/axe.min.js');
const ui = (t: UiStateDto['theme']): UiStateDto => ({ version: 1, theme: t, sidebarOpen: true, rightPanel: { open: false, tab: 'backlinks' } });
const themeGroup = (page: Page) => page.getByRole('radiogroup', { name: 'Theme' });

/** Built routes of R1 plus one TBD placeholder, each reached by the palette or switcher. */
const VIEWS: [string, (p: Page) => Promise<void>][] = [
  ['search', (p) => runCommand(p, 'Go to Search')],
  ['type/quick-note', (p) => gotoType(p, 'Quick Notes')],
  ['note/Porada', (p) => openNote(p, '2026-10-07 Porada')],
  ['settings/appearance', (p) => p.keyboard.press('Meta+Comma')],
  ['inbox (placeholder)', (p) => runCommand(p, 'Go to Inbox')],
];

test('fr_ux_05_ac4_axe_color_contrast_has_no_violations', async ({ browser }) => {
  let page!: Page;
  test.setTimeout(180_000);
  const failures: string[] = [];
  const axe = async (what: string) => {
    if (!(await page.evaluate(() => 'axe' in window))) await page.addScriptTag({ path: AXE });
    const v = await page.evaluate(async () => {
      const r = await (window as any).axe.run(document, { runOnly: { type: 'rule', values: ['color-contrast'] } });
      return r.violations.flatMap((x: any) => x.nodes.map((n: any) => n.target.join(' ')));
    });
    for (const n of v) failures.push(`${what}: ${n}`);
  };
  for (const t of ['light', 'dark'] as const) {
    page = await browser.newPage();
    await start(page, { uiState: ui(t) });
    assert.equal(await eventually(() => theme(page), (v) => v === t), t, `theme ${t} applied`);
    for (const [name, go] of VIEWS) { await go(page); await sleep(100); await axe(`${t} ${name}`); }
    await page.keyboard.press('Meta+k'); await must(paletteDialog(page), 'palette'); await axe(`${t} palette`); await page.keyboard.press('Escape');
    await page.keyboard.press('Meta+o'); await must(switcherDialog(page), 'switcher'); await axe(`${t} switcher`); await page.keyboard.press('Escape');
    await page.keyboard.press('Meta+n'); await mustBeDraft(page, 'New object'); await axe(`${t} New object draft`); // D-520: no dialog
    await page.close();
    page = await browser.newPage();
    await start(page, { vault: null, uiState: ui(t) });
    await axe(`${t} chooser`);
    await page.close();
  }
  assert.deepEqual(failures, []);
});

test('fr_ux_05_ac5_every_computed_colour_is_a_token_of_the_theme', async ({ browser }) => {
  test.setTimeout(180_000);
  const failures: string[] = [];
  for (const t of ['light', 'dark'] as const) {
    const page = await browser.newPage();
    await start(page, { uiState: ui(t) });
    assert.equal(await eventually(() => theme(page), (v) => v === t), t, `theme ${t} applied`);
    for (const [name, go] of VIEWS) {
      await go(page);
      await sleep(100);
      const bad = await page.evaluate(async (th) => {
        const tokens = (await import('/src/theme/tokens.ts' as string))[th] as Record<string, string>;
        const probe = document.createElement('div');
        document.body.appendChild(probe);
        const allowed = new Set<string>(['rgba(0, 0, 0, 0)', 'transparent']);
        for (const v of Object.values(tokens ?? {})) { probe.style.color = ''; probe.style.color = v; allowed.add(getComputedStyle(probe).color); }
        probe.remove();
        if (Object.keys(tokens ?? {}).length === 0) return ['no tokens for this theme'];
        const out = new Set<string>();
        for (const e of document.querySelectorAll('body *')) {
          const el = e as HTMLElement;
          if (el.getClientRects().length === 0) continue;
          const s = getComputedStyle(el);
          if (s.visibility === 'hidden') continue;
          const props: [string, string][] = [['color', s.color], ['background-color', s.backgroundColor]];
          for (const side of ['Top', 'Right', 'Bottom', 'Left'] as const) {
            if (parseFloat((s as any)[`border${side}Width`]) > 0 && (s as any)[`border${side}Style`] !== 'none') props.push([`border-${side.toLowerCase()}-color`, (s as any)[`border${side}Color`]]);
          }
          for (const [p, v] of props) if (!allowed.has(v)) out.add(`${el.tagName.toLowerCase()}${el.className ? '.' + String(el.className).split(' ')[0] : ''} ${p} ${v}`);
        }
        return [...out].slice(0, 20);
      }, t);
      for (const b of bad) failures.push(`${t} ${name}: ${b}`);
    }
    await page.close();
  }
  assert.deepEqual(failures, []);
});

test('fr_ux_05_ac6_first_paint_uses_the_stored_dark_theme', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.addInitScript(() => {
    const w = window as any;
    w.__firstPaint = null;
    const tick = () => {
      const b = document.body;
      if (b && b.innerText.trim().length > 0 && w.__firstPaint === null) {
        w.__firstPaint = { theme: document.documentElement.dataset.theme ?? null, bg: getComputedStyle(b).backgroundColor };
        return;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await start(page, { uiState: ui('dark') });
  const first = await eventually(() => page.evaluate(() => (window as any).__firstPaint), (v) => v !== null);
  assert.ok(first, 'first non-empty paint recorded');
  assert.equal(first.theme, 'dark', 'the first rendered frame uses the dark theme');
  const darkBg = await page.evaluate(async () => {
    const d = (await import('/src/theme/tokens.ts' as string)).dark as Record<string, string>;
    const probe = document.createElement('div');
    probe.style.color = d?.bg ?? '';
    document.body.appendChild(probe);
    const c = getComputedStyle(probe).color;
    probe.remove();
    return d?.bg ? c : null;
  });
  assert.equal(first.bg, darkBg, 'first frame background is the dark bg token');
});

test('fr_set_02_ac1_theme_control_has_three_choices_system_default', async ({ page }) => {
  await start(page);
  await page.keyboard.press('Meta+Comma');
  await mustBeOn(page, 'Settings: Appearance', '⌘,');
  const group = await must(themeGroup(page), 'radiogroup "Theme"');
  const radios = group.getByRole('radio');
  const names = await radios.evaluateAll((rs) => rs.map((r) => (r.getAttribute('aria-label') ?? r.textContent ?? (r as HTMLInputElement).labels?.[0]?.textContent ?? '').trim()));
  assert.deepEqual(names, ['System', 'Light', 'Dark']);
  assert.equal(await group.getByRole('radio', { name: 'System' }).isChecked(), true, 'System selected with empty Application Support');
});

test('fr_set_02_ac2_choice_applies_within_100ms_keeping_route_and_focus', async ({ page }) => {
  await start(page);
  await page.keyboard.press('Meta+Comma');
  await must(themeGroup(page), 'radiogroup "Theme"');
  await page.evaluate(() => {
    const w = window as any;
    w.__noReload = true;
    w.__themeAt = [];
    new MutationObserver(() => w.__themeAt.push([document.documentElement.dataset.theme, performance.now()])).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'style', 'class'] });
    document.addEventListener('pointerdown', () => { w.__clickAt = performance.now(); }, true);
    document.addEventListener('keydown', () => { w.__clickAt = performance.now(); }, true);
  });
  for (const [name, want] of [['Light', 'light'], ['Dark', 'dark']] as const) {
    const route = await mainName(page);
    await themeGroup(page).getByRole('radio', { name }).click();
    const got = await eventually(() => theme(page), (v) => v === want, 1000);
    assert.equal(got, want, `${name} applied`);
    const dt = await page.evaluate((w) => { const x = window as any; const hit = x.__themeAt.find(([t]: [string]) => t === w); return hit ? hit[1] - x.__clickAt : Infinity; }, want);
    assert.ok(dt <= 100, `${name} applied after ${dt} ms`);
    assert.equal(await mainName(page), route, 'route kept');
    assert.equal(await page.evaluate(() => (window as any).__noReload), true, 'no reload');
    const f = await page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.textContent?.trim() ?? '');
    assert.match(f, new RegExp(name), 'focus kept on the chosen option');
  }
  // From the palette (D-139): the palette closes and the focus returns to where it was.
  const radio = themeGroup(page).getByRole('radio', { name: 'Dark' });
  await radio.focus();
  const route = await mainName(page);
  await runCommand(page, 'Theme: Light');
  assert.equal(await eventually(() => theme(page), (v) => v === 'light', 1000), 'light', 'Theme: Light from the palette');
  assert.equal(await eventually(() => paletteDialog(page).count(), (n) => n === 0, 1000), 0, 'palette closed');
  assert.equal(await mainName(page), route, 'route kept (palette)');
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.textContent?.trim() ?? ''), 'Dark', 'focus returned to the element that had it');
});

test('fr_set_02_ac3_system_follows_prefers_color_scheme_live', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await start(page);
  assert.equal(await eventually(() => theme(page), (v) => v === 'light'), 'light', 'System + light appearance');
  await page.evaluate(() => {
    const w = window as any;
    w.__themeAt = [];
    new MutationObserver(() => w.__themeAt.push([document.documentElement.dataset.theme, performance.now()])).observe(document.documentElement, { attributes: true });
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { w.__schemeAt = performance.now(); });
  });
  await page.emulateMedia({ colorScheme: 'dark' });
  assert.equal(await eventually(() => theme(page), (v) => v === 'dark', 1000), 'dark', 'System follows dark');
  const dt = await page.evaluate(() => { const x = window as any; const hit = x.__themeAt.find(([t]: [string]) => t === 'dark'); return hit && x.__schemeAt ? hit[1] - x.__schemeAt : Infinity; });
  assert.ok(dt <= 100, `switched ${dt} ms after the system change`);
  await page.keyboard.press('Meta+Comma');
  await (await must(themeGroup(page).getByRole('radio', { name: 'Light' }), 'Light option')).click();
  await page.emulateMedia({ colorScheme: 'light' });
  await page.emulateMedia({ colorScheme: 'dark' });
  await sleep(300);
  assert.equal(await theme(page), 'light', 'with Light selected the system change is ignored');
  await themeGroup(page).getByRole('radio', { name: 'Dark' }).click();
  await page.emulateMedia({ colorScheme: 'light' });
  await sleep(300);
  assert.equal(await theme(page), 'dark', 'with Dark selected the system change is ignored');
});

test('fr_set_02_ac5_palette_theme_commands_match_the_settings_control', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  const core = await start(page);
  await page.keyboard.press('Meta+Comma');
  await must(themeGroup(page), 'radiogroup "Theme"');
  for (const [cmd, radio, want] of [['Theme: Dark', 'Dark', 'dark'], ['Theme: Light', 'Light', 'light'], ['Theme: System', 'System', 'system']] as const) {
    await runCommand(page, cmd);
    assert.ok(await absent(paletteDialog(page)), `${cmd} closes the palette`);
    assert.equal(await themeGroup(page).getByRole('radio', { name: radio }).isChecked(), true, `${cmd} updates the control`);
    assert.equal((await core.uiState())?.theme, want, `${cmd} stores ${want}`);
    if (want !== 'system') assert.equal(await theme(page), want);
  }
  assert.equal(await seen(themeGroup(page), 100), true);
});
