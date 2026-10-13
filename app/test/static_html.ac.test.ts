// MS3 slice 3B static rule (L0): no raw HTML rendering in the UI (FR-EDT-02 AC-11, D-145): app/ui/src never uses
// `dangerouslySetInnerHTML` or `rehype-raw`. docs/contracts/ms3-shell.md §11.3 ("Rendering").
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const SRC = resolve(import.meta.dirname, '../ui/src');
const RULES: [string, RegExp][] = [
  ['dangerouslySetInnerHTML', /dangerouslySetInnerHTML/],
  ['rehype-raw', /rehype-raw|rehypeRaw/],
];

function files(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...files(p));
    else if (/\.(tsx?|jsx?|mjs|html)$/.test(name)) out.push(p);
  }
  return out.sort();
}

export function offenders(sources: [string, string][]): string[] {
  const out: string[] = [];
  for (const [rel, text] of sources) {
    text.split('\n').forEach((line, i) => {
      for (const [what, re] of RULES) if (re.test(line)) out.push(`${rel}:${i + 1}: ${what}`);
    });
  }
  return out;
}

test('fr_edt_02_ac11_static_rule_detects_raw_html_rendering', () => {
  const sample: [string, string][] = [
    ['ok.tsx', 'export const A = () => <p>{text}</p>;'],
    ['bad.tsx', 'export const B = () => <div dangerouslySetInnerHTML={{ __html: x }} />;'],
    ['bad.ts', "import rehypeRaw from 'rehype-raw';"],
  ];
  assert.deepEqual(offenders(sample), ['bad.tsx:1: dangerouslySetInnerHTML', 'bad.ts:1: rehype-raw']);
});

test('fr_edt_02_ac11_no_dangerously_set_inner_html_or_rehype_raw', () => {
  const found = offenders(files(SRC).map((f) => [relative(SRC, f), readFileSync(f, 'utf8')]));
  assert.deepEqual(found, [], 'raw HTML rendering in app/ui/src (D-145)');
});
