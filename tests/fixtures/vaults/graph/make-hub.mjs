#!/usr/bin/env node
// The hub of the graph fixture (README "Hub"; docs/contracts/v1-graph.md §8), generated at runtime and never committed
// as vault files: 1,362 pages under `Pages/Hub/`. Deterministic: the same bytes on every run (LF, NFC, one final
// newline). Test code, used by the L5 and L6 graph tests; the L4 tests use its Rust twin
// (crates/tegg-index/tests/support/hub.rs).
//
//   node tests/fixtures/vaults/graph/make-hub.mjs <vault-dir>     writes the files into a temporary vault copy
//   import { hubFiles } from '.../make-hub.mjs'                    vault path → text, for an in-memory vault
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const two = (n) => String(n).padStart(2, '0');
const four = (n) => String(n).padStart(4, '0');

function page(n, title, body) {
  return `---\nid: 01JBGR000000000000000H${four(n)}\ntype: page\ntitle: ${title}\ncreated: 2026-10-01T09:00:00+02:00\nmodified: 2026-10-01T09:00:00+02:00\n---\n${body}\n`.normalize('NFC');
}

/** Vault path (NFC) → file text, in a fixed order. */
export function hubFiles() {
  const out = {};
  const put = (title, n, body) => { out[`Pages/Hub/${title}.md`.normalize('NFC')] = page(n, title, body); };
  const nn = Array.from({ length: 40 }, (_, i) => i + 1);
  put('Rozcestník', 1, nn.map((n) => `[[Paprsek ${two(n)}]]`).join(' '));
  for (const n of nn) put(`Paprsek ${two(n)}`, 1 + n, ['a', 'b', 'c'].map((x) => `[[Uzel ${two(n)}-${x}]]`).join(' '));
  for (const n of nn) {
    ['a', 'b', 'c'].forEach((x, i) => {
      const body = x === 'c' ? 'Konec.' : Array.from({ length: 15 }, (_, m) => `[[List ${two(n)}-${x}-${two(m + 1)}]]`).join(' ');
      put(`Uzel ${two(n)}-${x}`, 41 + 3 * (n - 1) + (i + 1), body);
    });
  }
  for (const n of nn) {
    ['a', 'b'].forEach((x, xi) => {
      for (let m = 1; m <= 15; m++) put(`List ${two(n)}-${x}-${two(m)}`, 161 + 15 * (2 * (n - 1) + xi) + m, 'List.');
    });
  }
  put('Široký rozcestník', 1362, nn.map((n) => `[[List ${two(n)}-a-01]] [[List ${two(n)}-a-02]] [[List ${two(n)}-b-01]] [[List ${two(n)}-b-02]]`).join(' '));
  return out;
}

/** Writes the hub into `vault` (a temporary copy of the fixture); returns the vault paths written. */
export function writeHub(vault) {
  const files = hubFiles();
  for (const [rel, text] of Object.entries(files)) {
    const p = join(vault, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, text);
  }
  return Object.keys(files);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const dir = process.argv[2];
  if (!dir) {
    console.error('usage: node make-hub.mjs <vault-dir>');
    process.exit(2);
  }
  console.log(`${writeHub(dir).length} hub files written`);
}
