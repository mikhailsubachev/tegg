// Minimal JUnit XML reader: enough for Vitest, node:test and cargo-nextest reports.

import fs from 'node:fs';
import path from 'node:path';

export type TestCase = {
  name: string;
  classname: string;
  /** Text of <failure>/<error> including its attributes; undefined if the testcase didn't fail. */
  failure: string | undefined;
  skipped: boolean;
};

function unescape(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, '&');
}

function attr(attrs: string, name: string): string {
  const m = new RegExp(`\\b${name}="([^"]*)"`).exec(attrs);
  return m ? unescape(m[1]) : '';
}

export function parseJunit(xml: string): TestCase[] {
  const cases: TestCase[] = [];
  const re = /<testcase\b([^>]*?)(?:\/>|>([\s\S]*?)<\/testcase>)/g;
  for (let m = re.exec(xml); m; m = re.exec(xml)) {
    const body = m[2] ?? '';
    const fail = /<(failure|error)\b[\s\S]*?(?:\/>|<\/\1>)/.exec(body);
    cases.push({
      name: attr(m[1], 'name'),
      classname: attr(m[1], 'classname'),
      failure: fail ? unescape(fail[0]) : undefined,
      skipped: /<skipped\b/.test(body),
    });
  }
  return cases;
}

/** All testcases of all *.xml files in `dir` (recursively); empty if the dir doesn't exist. */
export function parseJunitDir(dir: string): TestCase[] {
  if (!fs.existsSync(dir)) return [];
  const cases: TestCase[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.xml')) continue;
    cases.push(...parseJunit(fs.readFileSync(path.join(entry.parentPath, entry.name), 'utf8')));
  }
  return cases;
}
