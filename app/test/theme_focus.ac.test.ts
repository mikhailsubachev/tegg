// 5B preview feedback round 2, L1: FR-UX-05 AC-8 (D-594, AP-522): the `focus` token is a neutral grey in both themes
// (R, G and B differ by at most 16) with a contrast ratio of at least 3:1 against `bg`, `side` and `panel` (WCAG
// 1.4.11). Interface: docs/contracts/ms3-shell.md §3.5 (`theme/tokens.ts` exports `light` and `dark`; `theme/contrast.ts`
// `ratio`), as FR-UX-05 AC-1 and AC-3 in theme.ac.test.ts. Written from the AC and the contract only (D-61); a missing
// module fails an assertion (TS-I1).
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

/** sRGB channels of a token value: `#rgb`, `#rrggbb`, `#rrggbbaa` (alpha must be opaque) or `rgb()/rgba()`. */
function channels(v: string): [number, number, number] | null {
  const s = v.trim().toLowerCase();
  let m = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(s);
  if (m) return [m[1], m[2], m[3]].map((h) => parseInt(h + h, 16)) as [number, number, number];
  m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})(ff)?$/.exec(s);
  if (m) return [m[1], m[2], m[3]].map((h) => parseInt(h, 16)) as [number, number, number];
  m = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)(?:[\s,/]+(1|1\.0+|100%))?\s*\)$/.exec(s);
  if (m) return [Number(m[1]), Number(m[2]), Number(m[3])];
  return null;
}

test('fr_ux_05_ac8_the_focus_token_is_a_neutral_grey_with_3_to_1_contrast', async () => {
  const tok = await load('../ui/src/theme/tokens.ts');
  const con = await load('../ui/src/theme/contrast.ts');
  assert.ok(tok && con, 'theme/tokens.ts or theme/contrast.ts is missing');
  const failures: string[] = [];
  for (const [name, t] of [['light', tok.light], ['dark', tok.dark]] as const) {
    assert.ok(t && typeof t.focus === 'string', `${name}: the focus token exists`);
    const rgb = channels(t.focus);
    assert.ok(rgb, `${name}: focus ${t.focus} is an opaque sRGB colour`);
    const spread = Math.max(...rgb!) - Math.min(...rgb!);
    if (spread > 16) failures.push(`${name}: focus ${t.focus} is not grey (R, G, B spread ${spread} > 16)`);
    for (const bg of ['bg', 'side', 'panel']) {
      assert.ok(typeof t[bg] === 'string', `${name}: token ${bg} exists`);
      const r = con.ratio(t.focus, t[bg]);
      if (!(r >= 3)) failures.push(`${name}: focus ${t.focus} on ${bg} ${t[bg]} = ${Number(r).toFixed(2)}:1 (< 3:1)`);
    }
    for (const old of ['#1d5ccb', '#86aeff']) if (t.focus.trim().toLowerCase() === old) failures.push(`${name}: focus is the old blue ${old}`);
  }
  assert.deepEqual(failures, [], 'the focus token is a neutral grey with ≥ 3:1 against bg, side and panel (D-594)');
});
