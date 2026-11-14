// The Rust licence allow-list step (docs/contracts/v1-related.md §5; FR-LNK-15 AC-32, D-1717, D-1725, D-1729).
//
//   node tools/qa/src/licences.ts --crate <crate> --allow "<SPDX ids, space-separated>"
//
// Lists the crate's runtime and build closure with `cargo tree --offline --locked` (from Cargo.lock, no network,
// CP-5 → D-1729), skips workspace path packages, and checks each package's licence expression: it passes when it is
// satisfiable with allowed ids (SPDX `OR`, `AND`, parentheses, `X WITH exception` read as `X`, the legacy `/` read as
// `OR`). A missing licence fails. Prints `licence: <name> <version>: <expression>` per failing package and exits 1, or
// `licences: <n> crates OK` and exits 0.

import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

type Tok = { kind: 'id' | 'and' | 'or' | 'open' | 'close'; text: string };

function tokenize(expr: string): Tok[] | null {
  const out: Tok[] = [];
  const raw = expr.replace(/\(/g, ' ( ').replace(/\)/g, ' ) ').replace(/\//g, ' OR ').split(/\s+/).filter(Boolean);
  for (let i = 0; i < raw.length; i++) {
    const t = raw[i]!;
    if (t === '(') out.push({ kind: 'open', text: t });
    else if (t === ')') out.push({ kind: 'close', text: t });
    else if (t.toUpperCase() === 'AND') out.push({ kind: 'and', text: t });
    else if (t.toUpperCase() === 'OR') out.push({ kind: 'or', text: t });
    else if (t.toUpperCase() === 'WITH') {
      // `X WITH exception` reads as `X`: drop the exception id.
      if (i + 1 >= raw.length) return null;
      i++;
    } else out.push({ kind: 'id', text: t });
  }
  return out;
}

/** True when the SPDX expression can be satisfied with ids from `allow`; false on a parse error or an empty one. */
export function satisfiable(expr: string, allow: ReadonlySet<string>): boolean {
  const toks = tokenize(expr.trim());
  if (!toks || toks.length === 0) return false;
  let pos = 0;
  // or := and ('OR' and)* ; and := atom ('AND' atom)* ; atom := id | '(' or ')'
  const parseOr = (): boolean | null => {
    let v = parseAnd();
    if (v === null) return null;
    while (toks[pos]?.kind === 'or') {
      pos++;
      const r = parseAnd();
      if (r === null) return null;
      v = v || r;
    }
    return v;
  };
  const parseAnd = (): boolean | null => {
    let v = parseAtom();
    if (v === null) return null;
    while (toks[pos]?.kind === 'and') {
      pos++;
      const r = parseAtom();
      if (r === null) return null;
      v = v && r;
    }
    return v;
  };
  const parseAtom = (): boolean | null => {
    const t = toks[pos];
    if (!t) return null;
    if (t.kind === 'open') {
      pos++;
      const v = parseOr();
      if (toks[pos]?.kind !== 'close') return null;
      pos++;
      return v;
    }
    if (t.kind !== 'id') return null;
    pos++;
    return allow.has(t.text.replace(/\+$/, '')) || allow.has(t.text);
  };
  const v = parseOr();
  return v === true && pos === toks.length;
}

type Pkg = { name: string; version: string; licence: string };

/** `name vX.Y.Z[ (path)]|licence` lines → packages, deduplicated, workspace path packages skipped. */
export function parseTree(text: string): Pkg[] {
  const seen = new Set<string>();
  const out: Pkg[] = [];
  for (const line of text.split('\n')) {
    const l = line.trim();
    if (!l) continue;
    const bar = l.indexOf('|');
    const p = (bar < 0 ? l : l.slice(0, bar)).trim();
    const licence = bar < 0 ? '' : l.slice(bar + 1).trim();
    const m = /^(\S+) v(\S+)(.*)$/.exec(p.replace(/ \(\*\)$/, ''));
    if (!m) continue;
    const rest = m[3]!.trim();
    // A local path in parentheses marks a workspace (path) package; registry and git packages have no path.
    if (/^\((\/|[A-Za-z]:\\|\.)/.test(rest)) continue;
    const key = `${m[1]} ${m[2]}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ name: m[1]!, version: m[2]!, licence });
  }
  return out;
}

function main(argv: string[]): number {
  let crate = '';
  let allowText = '';
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--crate') crate = argv[++i] ?? '';
    else if (argv[i] === '--allow') allowText = argv[++i] ?? '';
  }
  if (!crate || !allowText) {
    process.stderr.write('usage: node tools/qa/src/licences.ts --crate <crate> --allow "<SPDX ids>"\n');
    return 2;
  }
  const allow = new Set(allowText.split(/\s+/).filter(Boolean));
  const r = spawnSync('cargo', ['tree', '--offline', '--locked', '-p', crate, '-e', 'normal,build', '--prefix', 'none', '--format', '{p}|{l}'], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (r.status !== 0) {
    process.stderr.write(`licences: cargo tree failed (${r.status ?? r.signal}): ${r.stderr ?? ''}\n`);
    return 2;
  }
  const pkgs = parseTree(r.stdout ?? '');
  const bad = pkgs.filter((p) => !satisfiable(p.licence, allow));
  if (bad.length > 0) {
    for (const p of bad) process.stdout.write(`licence: ${p.name} ${p.version}: ${p.licence}\n`);
    return 1;
  }
  process.stdout.write(`licences: ${pkgs.length} crates OK\n`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exit(main(process.argv.slice(2)));
