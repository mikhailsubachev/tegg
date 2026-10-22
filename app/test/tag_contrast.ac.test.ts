// MS4 slice 4D-lite, L1: the tag colours (docs/acceptance/tags.md FR-TAG-05 AC-7, D-129, FR-UX-05 AC-3, AC-4; D-655):
// every tag surface takes its colours from `tagChipStyle` (docs/contracts/ms4-tags.md §6.2), and for each of the eight
// R14 colours the token on its `-bg` tint, on `bg` and on `side` is ≥ 4.5:1 in both themes; the neutral chip too.
// Written from the AC and the contract only (D-61). Modules load inside the tests (TS-I1).
import { test } from 'vitest';
import assert from 'node:assert/strict';

type Mod = Record<string, any>;
async function load(path: string): Promise<Mod | null> {
  try {
    return (await import(/* @vite-ignore */ path)) as Mod;
  } catch {
    return null;
  }
}
const COLOURS = ['gray', 'blue', 'green', 'orange', 'purple', 'red', 'teal', 'yellow'];
/** `var(--x)` → `x`. */
const tokenOf = (v: string) => /^var\(--([\w-]+)\)$/.exec(String(v).trim())?.[1] ?? null;

test('fr_tag_05_ac7_tag_chip_style_uses_the_type_tokens', async () => {
  const chip = await load('../ui/src/tags/chip.ts');
  assert.ok(chip && typeof chip.tagChipStyle === 'function', 'tags/chip.ts exports tagChipStyle (ms4-tags §6.2)');
  for (const c of COLOURS) {
    assert.deepEqual(chip!.tagChipStyle(c), { background: `var(--type-${c}-bg)`, color: `var(--type-${c})` }, `${c}: the -bg tint and the token`);
  }
  assert.deepEqual(chip!.tagChipStyle(null), { background: 'var(--hover)', color: 'var(--muted)' }, 'None: the neutral chip');
});

test('fr_tag_05_ac7_contrast_of_every_tag_colour_in_both_themes', async () => {
  const chip = await load('../ui/src/tags/chip.ts');
  const tok = await load('../ui/src/theme/tokens.ts');
  const con = await load('../ui/src/theme/contrast.ts');
  assert.ok(chip && typeof chip.tagChipStyle === 'function', 'tags/chip.ts exports tagChipStyle');
  assert.ok(tok && con, 'theme tokens and contrast');
  const bad: string[] = [];
  for (const theme of ['light', 'dark'] as const) {
    const t = tok!.themes[theme] as Record<string, string>;
    for (const c of COLOURS) {
      const s = chip!.tagChipStyle(c);
      const fg = tokenOf(s.color), bg = tokenOf(s.background);
      if (!fg || !bg || !t[fg] || !t[bg]) { bad.push(`${theme} ${c}: unknown tokens ${s.color} on ${s.background}`); continue; }
      for (const on of [bg, 'bg', 'side']) {
        const r = con!.ratio(t[fg], t[on]);
        if (r < 4.5) bad.push(`${theme} ${c}: ${fg} on ${on} = ${r.toFixed(2)}`);
      }
    }
  }
  assert.deepEqual(bad, [], '≥ 4.5:1 on the tint, bg and side (D-129)');
});
