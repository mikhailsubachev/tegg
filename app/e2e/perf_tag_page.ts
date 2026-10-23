// FR-TAG-06 AC-11 benchmark (report-only until MS8, D-152; docs/acceptance/tags.md; docs/contracts/ms4-tags.md §6.1,
// ms3-shell §1 marks): on the reference vault (tools/gen-vault --seed 1 --small-images) with one tag on 1,000 objects,
// `tag/<key>` paints its first rows (`route-ready:tag/<key>`) within NFR-PERF-07's budget and keeps at most 100 row
// elements in the DOM (virtualized; the test build writes `tag-rows:<n>` with the row elements it rendered, a mark
// whose name is red-test point AP-674). Synthetic data only; never the owner's Application Support or vault (D-62).
// Used by nfr_perf_tag_page.ac.test.ts and nightly_tag_crash.ac.test.ts; no assertions here.
import { spawn, type ChildProcess } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { EXE, generateVault, p95, readMarks } from './perf_open_note.ts';

export { EXE, generateVault, p95, readMarks };
export const TAG = 'nightly-štítek';
export const tagRoute = (key: string) => `tag/${encodeURIComponent(key)}`;
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Every `.md` note of the vault outside dot-folders and `_templates/`, sorted. */
export function notes(vault: string): string[] {
  const out: string[] = [];
  const walk = (d: string, rel: string) => {
    for (const n of readdirSync(d)) {
      if (n.startsWith('.') || n === '_templates' || n === '_attachments') continue;
      const p = join(d, n);
      if (statSync(p).isDirectory()) walk(p, `${rel}${n}/`);
      else if (n.endsWith('.md')) out.push(`${rel}${n}`.normalize('NFC'));
    }
  };
  walk(vault, '');
  return out.sort();
}
/** Appends `#<tag>` as a last paragraph to the first `count` notes; returns their paths. */
export function tagNotes(vault: string, count: number, tag = TAG): string[] {
  const picked = notes(vault).slice(0, count);
  for (const p of picked) appendFileSync(join(vault, p), `\n#${tag}\n`);
  return picked;
}
export function launch(env: Record<string, string>): ChildProcess {
  const clean = { ...process.env };
  for (const k of Object.keys(clean)) if (k.startsWith('TEGG_')) delete clean[k];
  return spawn(EXE, [], { env: { ...clean, ...env }, stdio: 'ignore' });
}
export async function waitMark(log: string, pred: (m: string) => boolean, ms: number): Promise<{ mark: string; ms?: number } | null> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (existsSync(log)) {
      const hit = readMarks(log).find((m: any) => pred(String(m.mark)));
      if (hit) return hit as any;
    }
    await sleep(50);
  }
  return null;
}
/** One cold open of `tag/<TAG>`: the paint time (`route-ready` ms) and the row elements rendered (`tag-rows:<n>`). */
export async function oneRun(env: Record<string, string>, log: string): Promise<{ ms: number | null; rows: number | null }> {
  const child = launch({ ...env, TEGG_PERF_LOG: log, TEGG_ROUTE: tagRoute(TAG), TEGG_EXIT_AFTER: `route-ready:${tagRoute(TAG)}` });
  const ready = await waitMark(log, (m) => m === `route-ready:${tagRoute(TAG)}` || m === `route-ready:tag/${TAG}`, 60_000);
  await sleep(300);
  const rows = existsSync(log) ? readMarks(log).map((m: any) => /^tag-rows:(\d+)$/.exec(String(m.mark))?.[1]).find((x) => x !== undefined) : undefined;
  if (child.exitCode === null) child.kill('SIGTERM');
  return { ms: ready?.ms ?? null, rows: rows === undefined ? null : Number(rows) };
}
export const readText = (vault: string, rel: string) => (existsSync(join(vault, rel)) ? readFileSync(join(vault, rel), 'utf8') : null);
