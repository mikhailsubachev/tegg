// Slice OL, L1: docs/acceptance/outline.md NFR-OTH-02 AC-19 (the catalog has exactly R177's keys with their English
// texts; `outline.count` and `outline.hidden` are plurals by `Intl.PluralRules`, shown by the Czech test catalog for 1, 3
// and 5) and FR-UX-05 AC-22's L1 part (the rail's current and ancestor lines, `--text` and `--muted`, are ≥ 3:1 against
// `--bg` in both themes; `--link-bg` and `--faint` exist in both). Interface docs/contracts/v1-outline.md §6.2, §3.6;
// `theme/tokens.ts`, `theme/contrast.ts`. Written from the ACs and the contract only (D-61). Modules load inside the
// tests (TS-I1).
import { afterEach, test } from 'vitest';
import assert from 'node:assert/strict';

type Mod = Record<string, any>;
async function load(path: string): Promise<Mod | null> {
  try { return (await import(/* @vite-ignore */ path)) as Mod; } catch { return null; }
}
async function catalog(): Promise<Mod> {
  const cat = await load('../ui/src/i18n/catalog.ts');
  assert.ok(cat, 'ui/src/i18n/catalog.ts loads');
  return cat!;
}
afterEach(async () => {
  const cat = await load('../ui/src/i18n/catalog.ts');
  cat?.setCatalog?.(cat.en, 'en');
});

/** R177 with the variables each text is checked with. */
const R177: [string, Record<string, string | number>, string][] = [
  ['outline.count', { count: 11 }, '11 headings'], ['outline.count', { count: 1 }, '1 heading'], ['outline.empty', {}, 'No headings yet'],
  ['outline.emptyHint', { hash: '#' }, 'Start a line with # to add one.'], ['outline.tree', {}, 'Outline'], ['outline.card', {}, 'Outline'],
  ['outline.expandAll', {}, 'Expand all'], ['outline.collapseAll', {}, 'Collapse all'], ['outline.collapseAllHint', {}, 'Collapse all · ⌥-click a chevron'],
  ['outline.expand', {}, 'Expand'], ['outline.collapse', {}, 'Collapse'], ['outline.hidden', { count: 4 }, '4 hidden headings'], ['outline.hidden', { count: 1 }, '1 hidden heading'],
  ['cmd.outline.show', {}, 'Show outline'], ['cmd.outline.jump', {}, 'Outline: jump to heading…'], ['cmd.outline.expandAll', {}, 'Outline: Expand all'],
  ['cmd.outline.collapseAll', {}, 'Outline: Collapse all'], ['cmd.outline.toggleRail', {}, 'Toggle outline rail'],
  ['settings.appearance.outlineRail', {}, 'Show outline rail'],
  ['settings.appearance.outlineRailNote', {}, 'Short lines on the note’s right edge; hover them to see the outline.'],
];

test('nfr_oth_02_ac19_outline_strings_in_the_catalog', async () => {
  const cat = await catalog();
  const en = cat.en as Record<string, unknown>;
  const bad: string[] = [];
  for (const [key, vars, want] of R177) {
    const got = key in en ? cat.t(key, vars) : 'missing';
    if (got !== want) bad.push(`${key} ${JSON.stringify(vars)}: want ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
  }
  assert.deepEqual(bad, [], 'R177\'s keys with their English texts');
  assert.ok(String(en['outline.emptyHint']).includes('{hash}'), 'outline.emptyHint keeps `{hash}` (rendered as `code` `#`)');
  for (const k of ['outline.count', 'outline.hidden']) assert.equal(typeof en[k], 'object', `${k} is a plural object { one, other } (D-133)`);
  const keys = new Set(R177.map(([k]) => k));
  const extra = Object.keys(en).filter((k) => (k.startsWith('outline.') || k.startsWith('cmd.outline.') || k.startsWith('settings.appearance.outlineRail')) && !keys.has(k));
  assert.deepEqual(extra, [], 'no other outline key (§6.2)');
  assert.equal(cat.t('tab.outline', {}), 'Outline', 'the tab\'s existing name key stays');
});

test('nfr_oth_02_ac19_outline_strings_in_the_catalog_czech_plurals', async () => {
  const cat = await catalog();
  const en = cat.en as Record<string, unknown>;
  for (const k of ['outline.count', 'outline.hidden']) assert.ok(k in en, `catalog key ${k}`);
  cat.setCatalog({
    ...en,
    'outline.count': { one: '{count} nadpis', few: '{count} nadpisy', other: '{count} nadpisů' },
    'outline.hidden': { one: '{count} skrytý nadpis', few: '{count} skryté nadpisy', other: '{count} skrytých nadpisů' },
  }, 'cs');
  assert.deepEqual([1, 3, 5].map((n) => cat.t('outline.count', { count: n })), ['1 nadpis', '3 nadpisy', '5 nadpisů'], 'outline.count: one, few, other');
  assert.deepEqual([1, 3, 5].map((n) => cat.t('outline.hidden', { count: n })), ['1 skrytý nadpis', '3 skryté nadpisy', '5 skrytých nadpisů'], 'outline.hidden: one, few, other');
});

test('fr_ux_05_ac22_outline_in_light_and_dark_line_contrast', async () => {
  const tok = await load('../ui/src/theme/tokens.ts');
  const con = await load('../ui/src/theme/contrast.ts');
  assert.ok(tok && con, 'theme tokens and contrast load');
  const model = await load('../ui/src/outline/model.ts');
  assert.ok(model, 'ui/src/outline/model.ts loads (the rail\'s line states, v1-outline §3.6)');
  const bad: string[] = [];
  for (const theme of ['light', 'dark'] as const) {
    const t = tok!.themes[theme] as Record<string, string>;
    for (const k of ['text', 'muted', 'faint', 'bg', 'hover', 'link-bg', 'pop', 'border']) if (!t[k]) bad.push(`${theme}: token --${k} missing`);
    for (const fg of ['text', 'muted']) {
      const r = con!.ratio(t[fg], t.bg);
      if (!(r >= 3)) bad.push(`${theme}: --${fg} on --bg = ${r.toFixed(2)} (< 3:1, WCAG 1.4.11)`);
    }
  }
  assert.deepEqual(bad, [], 'the current (--text) and ancestor (--muted) rail lines reach 3:1 on --bg in both themes');
});
