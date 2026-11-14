// Slice OL, L1: docs/acceptance/outline.md NFR-OTH-02 AC-19 (the catalog has exactly R177's keys with their English
// texts; D-1675: no Outline tab, so no tab, count, hint, hidden-count or fold-command strings) and FR-UX-05 AC-22's L1 part (the rail's current and ancestor lines, `--text` and `--muted`, are ≥ 3:1 against
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
  ['outline.empty', {}, 'No headings yet'], ['outline.tree', {}, 'Outline'], ['outline.card', {}, 'Outline'],
  ['outline.expand', {}, 'Expand'], ['outline.collapse', {}, 'Collapse'],
  ['cmd.outline.jump', {}, 'Outline: jump to heading…'], ['cmd.outline.toggleRail', {}, 'Toggle outline rail'],
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
  const keys = new Set(R177.map(([k]) => k));
  const extra = Object.keys(en).filter((k) => (k.startsWith('outline.') || k.startsWith('cmd.outline.') || k.startsWith('settings.appearance.outlineRail')) && !keys.has(k));
  assert.deepEqual(extra, [], 'no other outline key (§6.2)');
  assert.ok(!('tab.outline' in en), 'no Outline tab name (D-1675)');
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
