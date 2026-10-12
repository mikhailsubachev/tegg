// MS3 slice 3A, L1: FR-UX-05 AC-1 (one token set) and AC-3 (contrast of token pairs, AP-73).
// Written from docs/acceptance/app-shell.md and docs/contracts/ms3-shell.md §3.5 only (D-61).
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

type Mod = Record<string, any>;
async function load(path: string): Promise<Mod | null> {
  try {
    return (await import(/* @vite-ignore */ path)) as Mod;
  } catch {
    return null;
  }
}

const BASE = ['bg', 'side', 'panel', 'pop', 'row', 'hover', 'border', 'text', 'muted', 'faint', 'link', 'accent', 'danger', 'focus'];
const SURFACES = ['bg', 'side', 'panel', 'pop', 'row', 'hover'];
const TEXT = ['text', 'muted', 'link', 'accent', 'danger'];

/** Type colours used by the fixtures' type files (new-empty system types and the shell fixture's user types). */
function typeColours(): string[] {
  const fx = resolve(import.meta.dirname, '../../tests/fixtures/vaults');
  const out = new Set<string>();
  for (const dir of ['new-empty/.tegg/types', 'shell/.tegg/types']) {
    for (const f of readdirSync(resolve(fx, dir))) {
      const m = /^color:\s*(\S+)/m.exec(readFileSync(resolve(fx, dir, f), 'utf8'));
      if (m) out.add(m[1]);
    }
  }
  return [...out].sort();
}

test('fr_ux_05_ac1_light_and_dark_define_the_same_tokens', async () => {
  const tok = await load('../ui/src/theme/tokens.ts');
  assert.ok(tok, 'ui/src/theme/tokens.ts is missing');
  const l = Object.keys(tok.light ?? {}).sort();
  const d = Object.keys(tok.dark ?? {}).sort();
  assert.deepEqual(l.filter((k) => !d.includes(k)), [], 'tokens only in light');
  assert.deepEqual(d.filter((k) => !l.includes(k)), [], 'tokens only in dark');
  const required = [...BASE, ...typeColours().flatMap((c) => [`type-${c}`, `type-${c}-bg`])];
  assert.deepEqual(required.filter((k) => !l.includes(k)), [], 'tokens the contract requires (ms3-shell §3.5)');
});

test('fr_ux_05_ac3_text_tokens_have_4_5_contrast_on_their_surfaces', async () => {
  const tok = await load('../ui/src/theme/tokens.ts');
  const con = await load('../ui/src/theme/contrast.ts');
  assert.ok(tok && con, 'theme/tokens.ts or theme/contrast.ts is missing');
  // The ratio function itself (WCAG 2.x): black on white is 21:1, equal colours 1:1.
  assert.ok(Math.abs(con.ratio('#000000', '#ffffff') - 21) < 0.01, `ratio(black, white) = ${con.ratio('#000000', '#ffffff')}`);
  assert.ok(Math.abs(con.ratio('#777777', '#777777') - 1) < 0.01, 'ratio of equal colours');
  const failures: string[] = [];
  for (const [name, t] of [['light', tok.light], ['dark', tok.dark]] as const) {
    assert.ok(t && Object.keys(t).length > 0, `${name} theme has no tokens`);
    const check = (fg: string, bg: string) => {
      assert.ok(t[fg] !== undefined && t[bg] !== undefined, `${name}: token ${t[fg] === undefined ? fg : bg} missing`);
      const r = con.ratio(t[fg], t[bg]);
      if (!(r >= 4.5)) failures.push(`${name}: ${fg} on ${bg} = ${r.toFixed(2)}`);
    };
    for (const fg of TEXT) for (const bg of SURFACES) check(fg, bg);
    for (const c of typeColours()) {
      for (const bg of SURFACES) check(`type-${c}`, bg);
      check(`type-${c}`, `type-${c}-bg`);
    }
  }
  assert.deepEqual(failures, [], 'token pairs under 4.5:1 (AP-73)');
});
