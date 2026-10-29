// NFR-PERF-11 AC-1 benchmark (docs/acceptance/graph.md; D-912, D-986; docs/contracts/v1-graph.md §6 marks): on the
// reference vault (tools/gen-vault --seed 1 --small-images), the full view around the object with the most links, and
// for each run a depth click 1 → 2: the time from `graph-request` (the depth-2 request is sent) to `graph-ready` (nodes
// and edges painted with the layout at rest). One launch of the release test build with TEGG_TEST=1, TEGG_PERF_LOG and a
// temporary Application Support; the depth buttons are clicked through Appium. Synthetic data only (D-62). Used by
// nfr_perf_11_graph.ac.test.ts; no assertions about the AC outcome here.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { EXE, generateVault, p95, readMarks } from './perf_open_note.ts';

export { EXE, generateVault, p95, readMarks };

/** Every `.md` note outside dot-folders and `_templates/` with its title (frontmatter `title`, else the stem). */
function notes(vault: string): { path: string; title: string; text: string }[] {
  const out: { path: string; title: string; text: string }[] = [];
  const walk = (d: string, rel: string) => {
    for (const n of readdirSync(d)) {
      if (n.startsWith('.') || n === '_templates' || n === '_attachments') continue;
      const p = join(d, n);
      if (statSync(p).isDirectory()) walk(p, `${rel}${n}/`);
      else if (n.endsWith('.md')) {
        const text = readFileSync(p, 'utf8');
        const m = /^title:\s*"?([^"\n]+)"?\s*$/m.exec(text);
        out.push({ path: `${rel}${n}`.normalize('NFC'), title: (m ? m[1] : n.replace(/\.md$/, '')).normalize('NFC'), text });
      }
    }
  };
  walk(vault, '');
  return out;
}

/** The note with the most wikilink references to and from it (an estimate of the highest vault-wide degree, by text;
 *  red-test point AP-860: the test build could report the real one). */
export function mostLinked(vault: string): string {
  const all = notes(vault);
  const byTitle = new Map(all.map((n) => [n.title, n.path]));
  const deg = new Map<string, Set<string>>();
  const add = (a: string, b: string) => { if (a !== b) { (deg.get(a) ?? deg.set(a, new Set()).get(a)!).add(b); (deg.get(b) ?? deg.set(b, new Set()).get(b)!).add(a); } };
  for (const n of all) {
    for (const m of n.text.matchAll(/!?\[\[([^\]|#^]+)/g)) {
      const to = byTitle.get(m[1].trim().normalize('NFC'));
      if (to) add(n.path, to);
    }
  }
  return [...deg.entries()].sort((a, b) => b[1].size - a[1].size || (a[0] < b[0] ? -1 : 1))[0]?.[0] ?? all[0].path;
}

/** `graph-request` → `graph-ready` of the last request in a perf log, in ms (null until both are there). */
export function lastRequestToReady(log: string, from = 0): number | null {
  const m = readMarks(log).slice(from);
  const req = [...m].reverse().find((x) => x.mark === 'graph-request');
  if (!req) return null;
  const ready = m.find((x) => x.mark === 'graph-ready' && x.ms >= req.ms);
  return ready ? ready.ms - req.ms : null;
}
