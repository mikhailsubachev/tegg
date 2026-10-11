// Runs Rust AC test files with `cargo test` and writes a JUnit report (CONTRACT §5.2, §5.3).
// No extra tools: libtest's text output is parsed. A failure counts as an assertion (red) only if the
// panic happened inside the test file itself and isn't an unwrap of a setup error; a stub's `todo!()`,
// a panic elsewhere or a compile error is not red.
//
// Usage (from the Cargo workspace root): node tools/qa/src/cargo-junit.ts --junit <report.xml> <tests/ac_*.rs …>

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

export type RustCase = { name: string; status: 'ok' | 'failed' | 'ignored'; output: string; assertion: boolean };

const SETUP_PANICS = [/^called `(Result|Option)::unwrap\(\)`/, /^called `(Result|Option)::expect\(\)`/, /^not (yet )?implemented/];

/** Parses libtest output of one test binary; `testFile` is the AC test's path (only its file name is used). */
export function parseCargoTest(output: string, testFile: string): RustCase[] {
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
    const panic = /panicked at ([^\n]+?):\d+:\d+:\n([^\n]*)/.exec(text);
    c.assertion = !!panic && (panic[1] === file || panic[1].endsWith(`/${file}`)) && !SETUP_PANICS.some((re) => re.test(panic[2]));
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

function main(argv: string[]): number {
  const i = argv.indexOf('--junit');
  if (i < 0 || !argv[i + 1]) {
    console.error('usage: cargo-junit.ts --junit <report.xml> <test files…>');
    return 2;
  }
  const junit = argv[i + 1];
  const files = argv.filter((_, k) => k !== i && k !== i + 1);
  let status = 0;
  const reports: string[] = [];
  for (const f of files) {
    const pkg = packageOf(f);
    const stem = path.basename(f, '.rs');
    const r = spawnSync('cargo', ['test', '-p', pkg, '--test', stem, '--no-fail-fast', '--', '--test-threads=1'], { encoding: 'utf8', maxBuffer: 1 << 28 });
    process.stdout.write(r.stdout ?? '');
    process.stderr.write(r.stderr ?? '');
    if (r.status !== 0) status = 1;
    reports.push(toJunit(`${pkg}::${stem}`, parseCargoTest(`${r.stdout}\n${r.stderr}`, f)));
  }
  // One report per file would need one path each; merge the suites into one file.
  const merged = reports.map((x) => x.replace(/^<\?xml[^>]*>\n<testsuites>|<\/testsuites>\n$/g, '')).join('');
  fs.writeFileSync(junit, `<?xml version="1.0" encoding="UTF-8"?>\n<testsuites>${merged}</testsuites>\n`);
  return status;
}

if (import.meta.url === `file://${process.argv[1]}`) process.exit(main(process.argv.slice(2)));
