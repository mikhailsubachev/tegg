// AC coverage report and milestone AC check (TS-COV, tools/qa/CONTRACT.md §9).

import fs from 'node:fs';
import path from 'node:path';
import { parseJunitDir, type TestCase } from './junit.ts';

export type Ac = {
  id: string; // FR-SYN-02/AC-3
  aliases: string[]; // NFR-REL-01/AC-3
  manual: boolean;
  file: string; // repository-relative acceptance file
};

const ID = /^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+/;

/** Parses the IDs of a requirement heading (`FR-STO-01 / -03 Vault layout` → FR-STO-01, FR-STO-03). */
export function headingIds(text: string): string[] {
  const first = ID.exec(text);
  if (!first) return [];
  const ids = [first[0]];
  let rest = text.slice(first[0].length);
  for (;;) {
    const sep = /^\s*\/\s*/.exec(rest);
    if (!sep) break;
    const after = rest.slice(sep[0].length);
    const full = ID.exec(after);
    const short = /^-([A-Z0-9]+)\b/.exec(after);
    if (full) {
      ids.push(full[0]);
      rest = after.slice(full[0].length);
    } else if (short) {
      const prev = ids[ids.length - 1];
      ids.push(`${prev.slice(0, prev.lastIndexOf('-'))}-${short[1]}`);
      rest = after.slice(short[0].length);
    } else break;
  }
  return ids;
}

export function parseAcs(root: string): Ac[] {
  const dir = path.join(root, 'docs', 'acceptance');
  if (!fs.existsSync(dir)) return [];
  const acs: Ac[] = [];
  for (const name of fs.readdirSync(dir).filter((n) => n.endsWith('.md') && n !== 'README.md').sort()) {
    const file = `docs/acceptance/${name}`;
    let ids: string[] = [];
    for (const line of fs.readFileSync(path.join(dir, name), 'utf8').split('\n')) {
      const h = /^### (.+)$/.exec(line);
      if (h) {
        ids = headingIds(h[1]);
        continue;
      }
      if (/^#{1,2} /.test(line)) ids = [];
      // The marker follows the AC label directly: `- **AC-5** [manual] …` (a mention elsewhere in the text doesn't count).
      const ac = /^- \*\*AC-(\d+)\*\*(\s*\[manual\])?/.exec(line);
      if (ac && ids.length > 0) {
        acs.push({ id: `${ids[0]}/AC-${ac[1]}`, aliases: ids.slice(1).map((i) => `${i}/AC-${ac[1]}`), manual: ac[2] !== undefined, file });
        continue;
      }
      // Table criterion: a row whose first cell is exactly a requirement ID (performance.md targets).
      const row = /^\|\s*([A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+)\s*\|/.exec(line);
      if (row && !acs.some((a) => a.id === `${row[1]}/AC-1`)) {
        acs.push({ id: `${row[1]}/AC-1`, aliases: [], manual: false, file });
        continue;
      }
      // Explicit form used outside headings, e.g. `- **NFR-PERF-02/AC-2** …` in performance.md.
      const explicit = /^- \*\*([A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+)\/AC-(\d+)\*\*(\s*\[manual\])?/.exec(line);
      if (explicit) acs.push({ id: `${explicit[1]}/AC-${explicit[2]}`, aliases: [], manual: explicit[3] !== undefined, file });
    }
  }
  return acs;
}

export function acKey(id: string): string {
  const [req, ac] = id.split('/AC-');
  return `${req.toLowerCase().replace(/-/g, '_')}_ac${ac}`;
}

export function reqOf(id: string): string {
  return id.split('/AC-')[0];
}

const REF = /\b((?:fr|nfr|ar|ts|s\d+)(?:_[a-z0-9]+)*?_ac\d+)(?![0-9])/g;

export function references(text: string): string[] {
  return [...text.matchAll(REF)].map((m) => m[1]);
}

const SKIP_DIRS = new Set(['node_modules', '.git', '.verify', 'target', 'dist']);
const SKIP_PATHS = new Set(['tests/fixtures', '.claude/worktrees']);

/** Test sources (CONTRACT §9.2): repository-relative paths. */
export function testSources(root: string): string[] {
  const out: string[] = [];
  const walk = (rel: string) => {
    for (const e of fs.readdirSync(path.join(root, rel), { withFileTypes: true })) {
      const p = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name) && !SKIP_PATHS.has(p)) walk(p);
      } else if (e.isFile()) {
        if (/\.(ts|tsx|js|mjs)$/.test(e.name) && /\.(test|spec)\./.test(e.name)) out.push(p);
        else if (e.name.endsWith('.rs') && /^\s*#\[test\]/m.test(fs.readFileSync(path.join(root, p), 'utf8'))) out.push(p);
      }
    }
  };
  walk('');
  return out.sort();
}

export type ManualRecord = { milestone: string; result: 'pass' | 'fail'; file: string };

/** Latest manual record per AC ID, plus all records (CONTRACT §9.3). */
export function manualRecords(root: string): { latest: Map<string, ManualRecord>; all: Map<string, ManualRecord[]> } {
  const latest = new Map<string, ManualRecord>();
  const all = new Map<string, ManualRecord[]>();
  const files: string[] = [];
  for (const sub of ['qa/sessions', 'qa/manual']) {
    const dir = path.join(root, sub);
    if (fs.existsSync(dir)) files.push(...fs.readdirSync(dir).filter((n) => n.endsWith('.md')).map((n) => `${sub}/${n}`));
  }
  files.sort((a, b) => path.basename(a).localeCompare(path.basename(b)) || a.localeCompare(b));
  for (const file of files) {
    const text = fs.readFileSync(path.join(root, file), 'utf8');
    const ms = /^milestone:\s*(MS\d+)\s*$/m.exec(text);
    if (!ms) continue;
    for (const m of text.matchAll(/^- ([A-Z][A-Z0-9-]*\/AC-\d+): (pass|fail)\s*$/gm)) {
      const rec: ManualRecord = { milestone: ms[1], result: m[2] as 'pass' | 'fail', file };
      latest.set(m[1], rec);
      all.set(m[1], [...(all.get(m[1]) ?? []), rec]);
    }
  }
  return { latest, all };
}

export type AcStatus = {
  ac: Ac;
  sources: string[];
  status: 'pass' | 'fail' | 'not run' | 'untested' | 'manual';
  manual?: ManualRecord;
  text: string;
};

export type Coverage = { statuses: AcStatus[]; orphans: Array<{ key: string; file: string }> };

export function computeCoverage(root: string, resultsDir: string): Coverage {
  const acs = parseAcs(root);
  const keyToAc = new Map<string, Ac>();
  for (const ac of acs) for (const id of [ac.id, ...ac.aliases]) keyToAc.set(acKey(id), ac);

  const sourcesByAc = new Map<string, Set<string>>();
  const orphans: Array<{ key: string; file: string }> = [];
  for (const file of testSources(root)) {
    const seen = new Set<string>();
    for (const key of references(fs.readFileSync(path.join(root, file), 'utf8'))) {
      if (seen.has(key)) continue;
      seen.add(key);
      const ac = keyToAc.get(key);
      if (!ac) orphans.push({ key, file });
      else sourcesByAc.set(ac.id, (sourcesByAc.get(ac.id) ?? new Set()).add(file));
    }
  }

  const casesByAc = new Map<string, TestCase[]>();
  for (const tc of parseJunitDir(resultsDir)) {
    const keys = new Set([...references(tc.name), ...references(tc.classname)]);
    for (const key of keys) {
      const ac = keyToAc.get(key);
      if (ac) casesByAc.set(ac.id, [...(casesByAc.get(ac.id) ?? []), tc]);
    }
  }

  const { latest } = manualRecords(root);
  const statuses: AcStatus[] = acs.map((ac) => {
    const sources = [...(sourcesByAc.get(ac.id) ?? [])].sort();
    if (ac.manual) {
      const rec = [ac.id, ...ac.aliases].map((id) => latest.get(id)).find((r) => r !== undefined);
      const text = rec ? `manual: ${rec.result} (${rec.milestone}, ${rec.file})` : 'manual: no record';
      return { ac, sources, status: 'manual', manual: rec, text };
    }
    const cases = casesByAc.get(ac.id) ?? [];
    let status: AcStatus['status'];
    if (sources.length === 0 && cases.length === 0) status = 'untested';
    else if (cases.some((c) => c.failure !== undefined)) status = 'fail';
    else if (cases.some((c) => !c.skipped)) status = 'pass';
    else status = 'not run';
    return { ac, sources, status, text: status };
  });
  return { statuses, orphans };
}

export function renderReport(cov: Coverage): string {
  const lines = ['# AC coverage', '', 'Generated by `./verify coverage` (tools/qa/CONTRACT.md §9.3).', ''];
  lines.push('| AC | Kind | Test sources | Status |', '| --- | --- | --- | --- |');
  for (const s of cov.statuses) {
    lines.push(`| ${s.ac.id} | ${s.ac.manual ? 'manual' : 'auto'} | ${s.sources.length ? s.sources.join(', ') : '—'} | ${s.text} |`);
  }
  lines.push('', '## Untested ACs', '');
  for (const s of cov.statuses.filter((x) => x.status === 'untested')) lines.push(`- ${s.ac.id}`);
  lines.push('', '## Orphan tests', '');
  for (const o of cov.orphans) lines.push(`- ${o.key} in ${o.file}`);
  lines.push('', '## Manual ACs', '');
  for (const s of cov.statuses.filter((x) => x.ac.manual)) lines.push(`- ${s.ac.id}: ${s.text}`);
  return lines.join('\n') + '\n';
}

export function writeReport(root: string, resultsDir: string): string {
  const out = path.join(root, 'qa', 'coverage', 'ac-matrix.md');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, renderReport(computeCoverage(root, resultsDir)));
  return out;
}

// ---------------------------------------------------------------------------
// Milestones (CONTRACT §9.4)
// ---------------------------------------------------------------------------

export type MilestoneReqs = { reqs: Set<string>; prefixes: string[] };

/** Expands a requirement list cell: `FR-STO-01…09, -06, -08…11, AR-01, All NFR-PERF (note)`. */
export function expandRequirements(cell: string): MilestoneReqs {
  const reqs = new Set<string>();
  const prefixes: string[] = [];
  let prefix = '';
  const range = (start: string, end: string | undefined) => {
    const from = Number(start);
    const to = end === undefined ? from : Number(end);
    for (let n = from; n <= to; n++) reqs.add(`${prefix}-${String(n).padStart(start.length, '0')}`);
  };
  for (const raw of cell.replace(/\([^)]*\)/g, '').split(',')) {
    const item = raw.trim();
    if (!item) continue;
    const all = /^All\s+([A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*)$/.exec(item);
    const full = /^([A-Z][A-Z0-9]*(?:-[A-Z][A-Z0-9]*)*)-(\d+)(?:\s*(?:…|\.\.\.)\s*(\d+))?$/.exec(item);
    const short = /^-(\d+)(?:\s*(?:…|\.\.\.)\s*(\d+))?$/.exec(item);
    if (all) prefixes.push(`${all[1]}-`);
    else if (full) {
      prefix = full[1];
      range(full[2], full[3]);
    } else if (short && prefix) range(short[1], short[2]);
  }
  return { reqs, prefixes };
}

/** Milestone rows of the BRD §11.2 table: MSn → requirements. */
export function milestones(root: string): Map<string, MilestoneReqs> {
  const file = path.join(root, 'docs', 'Business Requirements.md');
  const result = new Map<string, MilestoneReqs>();
  if (!fs.existsSync(file)) return result;
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  const start = lines.findIndex((l) => l.startsWith('### 11.2'));
  if (start < 0) return result;
  for (const line of lines.slice(start + 1)) {
    if (/^#{1,3} /.test(line)) break;
    if (!line.startsWith('|')) continue;
    const cells = line.split('|').slice(1, -1).map((c) => c.trim());
    if (/^MS\d+$/.test(cells[0] ?? '') && cells[2] !== undefined) result.set(cells[0], expandRequirements(cells[2]));
  }
  return result;
}

/** Problems that fail the milestone-acs check for the given milestones (release: all of them). */
export function milestoneProblems(root: string, names: string[], resultsDir: string, forRelease: boolean): string[] {
  const all = milestones(root);
  const problems: string[] = [];
  const reqs = new Set<string>();
  const prefixes: string[] = [];
  for (const name of names) {
    const ms = all.get(name);
    if (!ms) {
      problems.push(`${name}: not found in the BRD §11.2 milestone table`);
      continue;
    }
    for (const r of ms.reqs) reqs.add(r);
    prefixes.push(...ms.prefixes);
  }
  const inScope = (req: string) => reqs.has(req) || prefixes.some((p) => req.startsWith(p));
  const cov = computeCoverage(root, resultsDir);
  const { all: records } = manualRecords(root);
  const covered = new Set<string>();
  for (const s of cov.statuses) {
    const ids = [s.ac.id, ...s.ac.aliases];
    if (!ids.some((id) => inScope(reqOf(id)))) continue;
    for (const id of ids) covered.add(reqOf(id));
    if (s.ac.manual) {
      const recs = ids.flatMap((id) => records.get(id) ?? []).filter((r) => forRelease || names.includes(r.milestone));
      const last = recs[recs.length - 1];
      if (!last || last.result !== 'pass') problems.push(`${s.ac.id}: manual AC has no pass record for ${names.join(', ')}`);
    } else if (s.status !== 'pass') {
      problems.push(`${s.ac.id}: ${s.status}`);
    }
  }
  for (const req of [...reqs].sort()) if (!covered.has(req)) problems.push(`${req}: requirement has no acceptance criteria`);
  return problems;
}
