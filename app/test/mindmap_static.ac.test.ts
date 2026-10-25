// Slice MM, L0 and L1 checks that hold before the build and guard it (docs/acceptance/mindmap.md):
// FR-FMT-05 AC-6 (L0, D-679, D-683, NFR-SEC-01): no package.json of app/ or packages/ and no lockfile entry names
// `mermaid`, `markmap`, `markmap-*`, `d3` or `d3-*`; FR-UX-05 AC-10 (L1 tokens, D-129, AP-736): in light and dark, `bg`
// on `text` (root), each `type-<c>` on `type-<c>-bg` for the seven palette colours, `text` on `bg` (deeper nodes),
// `text` and `muted` on the header's `embed-bg` (R91's `embed` token), `muted` on `bg` ≥ 4.5:1; the connector token
// `muted` on `bg` ≥ 3:1 (WCAG 1.4.11). Written from the ACs only (D-61).
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const REPO = resolve(import.meta.dirname, '../..');
const BANNED = /^(mermaid|markmap|markmap-.+|d3|d3-.+|@mermaid-js\/.+)$/;

function manifests(): string[] {
  const out = [join(REPO, 'app/package.json'), join(REPO, 'app/package-lock.json')];
  for (const p of readdirSync(join(REPO, 'packages'))) {
    for (const f of ['package.json', 'package-lock.json']) if (existsSync(join(REPO, 'packages', p, f))) out.push(join(REPO, 'packages', p, f));
  }
  return out.filter((f) => existsSync(f));
}

test('fr_fmt_05_ac6_no_mermaid_markmap_or_d3_package', () => {
  const files = manifests();
  assert.ok(files.length >= 4, `manifests found: ${files.length}`);
  const hits: string[] = [];
  for (const f of files) {
    const j = JSON.parse(readFileSync(f, 'utf8')) as Record<string, any>;
    const names = new Set<string>();
    for (const k of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) for (const n of Object.keys(j[k] ?? {})) names.add(n);
    for (const key of Object.keys(j.packages ?? {})) {
      const m = /(?:^|\/)node_modules\/((?:@[^/]+\/)?[^/]+)$/.exec(key);
      if (m) names.add(m[1]);
      for (const k of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) for (const n of Object.keys(j.packages[key]?.[k] ?? {})) names.add(n);
    }
    for (const n of names) if (BANNED.test(n)) hits.push(`${f.slice(REPO.length + 1)}: ${n}`);
  }
  assert.deepEqual(hits, [], 'Tegg ships no Mermaid, markmap or d3 (D-679, D-683)');
});

test('fr_ux_05_ac10_mindmap_token_contrast_in_both_themes', async () => {
  const tok = (await import('../ui/src/theme/tokens.ts')) as { themes: Record<string, Record<string, string>> };
  const con = (await import('../ui/src/theme/contrast.ts')) as { ratio(fg: string, bg: string): number };
  const pairs: [string, string, number][] = [
    ['bg', 'text', 4.5], ['text', 'bg', 4.5], ['text', 'embed-bg', 4.5], ['muted', 'embed-bg', 4.5], ['muted', 'bg', 4.5], ['muted', 'bg', 3],
    ...['blue', 'orange', 'purple', 'teal', 'green', 'yellow', 'red'].map((c) => [`type-${c}`, `type-${c}-bg`, 4.5] as [string, string, number]),
  ];
  const bad: string[] = [];
  for (const theme of ['light', 'dark']) {
    const t = tok.themes[theme];
    for (const [fg, bg, min] of pairs) {
      if (!t[fg] || !t[bg]) { bad.push(`${theme}: no token ${t[fg] ? bg : fg}`); continue; }
      const r = con.ratio(t[fg], t[bg]);
      if (r < min) bad.push(`${theme}: ${fg} on ${bg} = ${r.toFixed(2)} < ${min}`);
    }
  }
  assert.deepEqual(bad, [], 'R92 node, header and connector tokens');
});
