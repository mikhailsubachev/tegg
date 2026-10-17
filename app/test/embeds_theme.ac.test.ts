// MS4 slice 4F, L1: FR-LNK-07 AC-8 (token part): `embed-border` and `embed-bg` exist in both themes (FR-UX-05 AC-1)
// and every text token used on `embed-bg` has a contrast of at least 4.5:1 against it (FR-UX-05 AC-3).
// docs/acceptance/embeds.md FR-LNK-07 AC-8; docs/contracts/ms4-embeds.md §6 (tokens). Written from the ACs and the
// contract only (D-61). Modules load dynamically (TS-I1).
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

/** Text tokens an embed shows on `embed-bg`: titles and body (`text`), messages (`muted`), chips (`link`), the
 *  broken chip and border (`danger`), buttons (`accent`). */
const TEXT = ['text', 'muted', 'link', 'accent', 'danger'];

test('fr_lnk_07_ac8_embed_tokens_exist_in_both_themes', async () => {
  const tok = await load('../ui/src/theme/tokens.ts');
  assert.ok(tok, 'ui/src/theme/tokens.ts is missing');
  for (const [name, t] of [['light', tok!.light], ['dark', tok!.dark]] as const) {
    assert.ok(t && typeof t === 'object', `${name} theme`);
    for (const k of ['embed-border', 'embed-bg']) assert.equal(typeof t[k], 'string', `${name}: token ${k}`);
    assert.notEqual(t['embed-bg'], t['embed-border'], `${name}: the border is visible on the background`);
  }
});

test('fr_lnk_07_ac8_text_tokens_have_4_5_contrast_on_embed_bg', async () => {
  const tok = await load('../ui/src/theme/tokens.ts');
  const con = await load('../ui/src/theme/contrast.ts');
  assert.ok(tok && con, 'theme/tokens.ts or theme/contrast.ts is missing');
  const failures: string[] = [];
  for (const [name, t] of [['light', tok!.light], ['dark', tok!.dark]] as const) {
    assert.ok(t['embed-bg'] !== undefined, `${name}: embed-bg missing`);
    for (const fg of TEXT) {
      const r = con!.ratio(t[fg], t['embed-bg']);
      if (!(r >= 4.5)) failures.push(`${name}: ${fg} on embed-bg = ${Number(r).toFixed(2)}`);
    }
  }
  assert.deepEqual(failures, [], 'text tokens under 4.5:1 on embed-bg');
});
