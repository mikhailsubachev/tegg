// Runs Rust AC test files with `cargo test` and writes a JUnit report (CONTRACT §5.2, §5.3; D-610).
// No extra tools: libtest's text output is parsed. A failure counts as an assertion (red) only if the
// panic happened inside the test file itself and isn't an unwrap of a setup error; a stub's `todo!()`,
// a panic elsewhere or a compile error is not red.
//
// Usage (from the Cargo workspace root):
//   node tools/qa/src/cargo-junit.ts --junit <report.xml> [--threads N] [--serial <file>]… <tests/ac_*.rs …> [-- <libtest args>]
// All files of one package run in one `cargo test` invocation (one suite per file in the report); `--serial` files
// run alone with one thread. Arguments after `--` go to every test binary, e.g. `--skip nfr_perf_` (the push gate
// leaves latency ACs to nightly, D-343).

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export type RustCase = { name: string; status: 'ok' | 'failed' | 'ignored'; output: string; assertion: boolean };

const SETUP_PANICS = [/^called `(Result|Option)::unwrap\(\)`/, /^not (yet )?implemented/];

/** Parses libtest output of one test binary; `testFile` is the AC test's path. `source`, when given, is the
 *  test file's text: a panic on a line with `.expect(` or `.unwrap(` is a setup failure, not an assertion
 *  (`expect` panics with "<msg>: <err>", which no message pattern can tell from an `assert!` message). */
export function parseCargoTest(output: string, testFile: string, source?: string): RustCase[] {
  const srcLines = source?.split('\n') ?? []
  const cases = new Map<string, RustCase>();
  for (const m of output.matchAll(/^test (\S+) \.\.\. (ok|FAILED|ignored)\b/gm)) {
    cases.set(m[1], { name: m[1], status: m[2] === 'FAILED' ? 'failed' : (m[2] as 'ok' | 'ignored'), output: '', assertion: false });
  }
  const file = path.basename(testFile);
  const sections = output.split(/^---- (\S+) stdout ----$/m);
  for (let i = 1; i + 1 < sections.length; i += 2) {
    const c = cases.get(sections[i]);
    if (!c) continue;
    const text = sections[i + 1].split(/^\n?failures:$|^---- /m)[0].trim();
    c.output = text;
    const panic = /panicked at ([^\n]+?):(\d+):\d+:\n([^\n]*)/.exec(text);
    const atLine = panic ? (srcLines[Number(panic[2]) - 1] ?? '') : '';
    c.assertion =
      !!panic &&
      (panic[1] === file || panic[1].endsWith(`/${file}`)) &&
      !SETUP_PANICS.some((re) => re.test(panic[3])) &&
      !/\.(expect|unwrap)\(/.test(atLine);
  }
  return [...cases.values()];
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function toJunit(suite: string, cases: RustCase[]): string {
  const body = cases.map((c) => {
    const head = `<testcase name="${esc(c.name)}" classname="${esc(suite)}"`;
    if (c.status === 'ok') return `${head}/>`;
    if (c.status === 'ignored') return `${head}><skipped/></testcase>`;
    const type = c.assertion ? 'AssertionError' : 'Panic';
    return `${head}><failure type="${type}" message="${esc(c.output.split('\n').slice(0, 2).join(' '))}">${esc(c.output)}</failure></testcase>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>\n<testsuites><testsuite name="${esc(suite)}" tests="${cases.length}">\n${body.join('\n')}\n</testsuite></testsuites>\n`;
}

/** Nearest Cargo.toml with a [package] section above the test file: its package name. */
function packageOf(testFile: string): string {
  for (let dir = path.dirname(path.resolve(testFile)); dir !== path.dirname(dir); dir = path.dirname(dir)) {
    const manifest = path.join(dir, 'Cargo.toml');
    if (!fs.existsSync(manifest)) continue;
    const m = /\[package\][^[]*?\bname\s*=\s*"([^"]+)"/.exec(fs.readFileSync(manifest, 'utf8'));
    if (m) return m[1];
  }
  throw new Error(`no Cargo package above ${testFile}`);
}

// ---------------------------------------------------------------------------
// Batched runs (CONTRACT §5.2, D-610)
// ---------------------------------------------------------------------------

export type Batch = { pkg: string; files: string[]; threads: number };
export type Split = { stems: string[]; blocks: string[] };
export type Args = { junit: string; threads: number; serial: Set<string>; files: string[]; libtest: string[] };

export class ArgsError extends Error {}

export function parseArgs(argv: string[]): Args {
  const dd = argv.indexOf('--');
  const own = dd < 0 ? argv : argv.slice(0, dd);
  const libtest = dd < 0 ? [] : argv.slice(dd + 1);
  const a: Args = { junit: '', threads: 1, serial: new Set(), files: [], libtest };
  for (let i = 0; i < own.length; i++) {
    const x = own[i];
    const value = () => {
      const v = own[++i];
      if (v === undefined) throw new ArgsError(`${x} needs a value`);
      return v;
    };
    if (x === '--junit') a.junit = value();
    else if (x === '--threads') {
      const n = Number(value());
      if (!Number.isInteger(n) || n < 1) throw new ArgsError('--threads needs a positive integer');
      a.threads = n;
    } else if (x === '--serial') a.serial.add(value());
    else a.files.push(x);
  }
  if (!a.junit) throw new ArgsError('--junit <report.xml> is required');
  return a;
}

/** Groups the files by package, in order of first appearance; a serial file splits its package's batch and runs
 *  alone with one thread where it appears. */
export function planBatches(files: string[], serial: Set<string>, threads: number, pkgOf: (file: string) => string = packageOf): Batch[] {
  const batches: Batch[] = [];
  const open = new Map<string, Batch>();
  const isSerial = (f: string) => serial.has(f) || serial.has(path.resolve(f));
  for (const f of files) {
    const pkg = pkgOf(f);
    if (isSerial(f)) {
      open.delete(pkg);
      batches.push({ pkg, files: [f], threads: 1 });
      continue;
    }
    let b = open.get(pkg);
    if (!b) {
      b = { pkg, files: [], threads };
      open.set(pkg, b);
      batches.push(b);
    }
    b.files.push(f);
  }
  return batches;
}

/** Cargo runs the selected binaries one after another: the i-th `running <n> tests` block on stdout belongs to the
 *  i-th `Running tests/<stem>.rs` line on stderr. */
export function splitLibtestOutput(stdout: string, stderr: string): Split {
  const stems = [...stderr.matchAll(/^\s*Running tests\/([^/\s]+)\.rs \(/gm)].map((m) => m[1]);
  const blocks = stdout.split(/^(?=running \d+ tests?$)/m).filter((b) => /^running \d+ tests?$/m.test(b));
  return { stems, blocks };
}

/** Pairs each file with its block (by stem: cargo runs the binaries in its own order, not the order given);
 *  `undefined` when the counts or stems don't match the files or a block names a test the paired file doesn't
 *  declare (then the caller runs the files one by one). */
export function pairBlocks(split: Split, files: string[], sources: Map<string, string>): Map<string, string> | undefined {
  if (split.stems.length !== split.blocks.length || split.stems.length !== files.length) return undefined;
  const byStem = new Map(split.stems.map((s, i) => [s, split.blocks[i]]));
  const out = new Map<string, string>();
  for (const f of files) {
    const block = byStem.get(path.basename(f, '.rs'));
    if (block === undefined) return undefined;
    const source = sources.get(f) ?? '';
    for (const m of block.matchAll(/^test (\S+) \.\.\. (?:ok|FAILED|ignored)\b/gm)) {
      const name = m[1].split('::').pop()!;
      if (!new RegExp(`\\bfn\\s+${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*[(<]`).test(source)) return undefined;
    }
    out.set(f, block);
  }
  return out;
}

function runCargo(pkg: string, files: string[], threads: number, libtest: string[]): { status: number; stdout: string; stderr: string } {
  const args = ['test', '-p', pkg, ...files.flatMap((f) => ['--test', path.basename(f, '.rs')]), '--no-fail-fast', '--', `--test-threads=${threads}`, ...libtest];
  const r = spawnSync('cargo', args, { encoding: 'utf8', maxBuffer: 1 << 28 });
  process.stdout.write(r.stdout ?? '');
  process.stderr.write(r.stderr ?? '');
  return { status: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

function main(argv: string[]): number {
  let a: Args;
  try {
    a = parseArgs(argv);
  } catch (e) {
    if (!(e instanceof ArgsError)) throw e;
    console.error(`cargo-junit.ts: ${e.message}\nusage: cargo-junit.ts --junit <report.xml> [--threads N] [--serial <file>]… <test files…> [-- <libtest args>]`);
    return 2;
  }
  let status = 0;
  const texts = new Map<string, string>(); // file → the libtest output attributed to it
  const sources = new Map(a.files.map((f) => [f, fs.readFileSync(f, 'utf8')]));
  for (const b of planBatches(a.files, a.serial, a.threads)) {
    const r = runCargo(b.pkg, b.files, b.threads, a.libtest);
    if (r.status !== 0) status = 1;
    const combined = `${r.stdout}\n${r.stderr}`;
    if (b.files.length === 1) {
      texts.set(b.files[0], combined);
      continue;
    }
    const paired = pairBlocks(splitLibtestOutput(r.stdout, r.stderr), b.files, sources);
    if (paired) {
      for (const [f, block] of paired) texts.set(f, `${block}\n${r.stderr}`);
      continue;
    }
    process.stderr.write(`cargo-junit: could not attribute libtest output for ${b.pkg}; running its files one by one\n`);
    for (const f of b.files) {
      const one = runCargo(b.pkg, [f], b.threads, a.libtest);
      if (one.status !== 0) status = 1;
      texts.set(f, `${one.stdout}\n${one.stderr}`);
    }
  }
  const reports = a.files.map((f) => toJunit(`${packageOf(f)}::${path.basename(f, '.rs')}`, parseCargoTest(texts.get(f) ?? '', f, sources.get(f))));
  // One report per file would need one path each; merge the suites into one file.
  const merged = reports.map((x) => x.replace(/^<\?xml[^>]*>\n<testsuites>|<\/testsuites>\n$/g, '')).join('');
  fs.writeFileSync(a.junit, `<?xml version="1.0" encoding="UTF-8"?>\n<testsuites>${merged}</testsuites>\n`);
  return status;
}

// pathToFileURL: the repository path may contain spaces ("Tegg notes" → %20).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exit(main(process.argv.slice(2)));
