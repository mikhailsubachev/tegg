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

// ------------------------------------------------------------------------------------------------ slice G2 (NFR-PERF-11 AC-3)

/** The vault's graph estimated from the files' text (wikilinks and embeds by title, `tags:` and inline `#tags` as tag
 *  nodes; graph-panel.md NFR-PERF-11 AC-3, D-1043): adjacency over node keys (paths, `tag:<key>`), and the leaves of
 *  the walk (tag nodes and Daily Notes, D-903). An estimate, as `mostLinked` (red-test point AP-860). */
export function textGraph(vault: string): { adj: Map<string, Set<string>>; leaves: Set<string> } {
  const all = notes(vault);
  const byTitle = new Map(all.map((n) => [n.title, n.path]));
  const adj = new Map<string, Set<string>>();
  const leaves = new Set<string>();
  const add = (a: string, b: string) => { if (a !== b) { (adj.get(a) ?? adj.set(a, new Set()).get(a)!).add(b); (adj.get(b) ?? adj.set(b, new Set()).get(b)!).add(a); } };
  for (const n of all) {
    if (n.path.startsWith('Daily/') || /^type:\s*daily-note\s*$/m.test(n.text)) leaves.add(n.path);
    for (const m of n.text.matchAll(/!?\[\[([^\]|#^]+)/g)) {
      const to = byTitle.get(m[1].trim().normalize('NFC'));
      if (to) add(n.path, to);
    }
    const fm = /^---\n([\s\S]*?)\n---/.exec(n.text)?.[1] ?? '';
    const inline = /^tags:\s*\[([^\]]*)\]/m.exec(fm)?.[1]?.split(',') ?? [];
    const listed = [...(/^tags:\s*\n((?:\s+-\s+.*\n?)+)/m.exec(fm)?.[1] ?? '').matchAll(/-\s+"?([^"\n]+)"?/g)].map((x) => x[1]);
    const body = n.text.slice(fm ? fm.length + 8 : 0);
    const hashes = [...body.matchAll(/(?:^|\s)#([\p{L}\p{N}_-]+)/gu)].map((x) => x[1]);
    for (const t of [...inline, ...listed, ...hashes].map((x) => x.trim().replace(/^"|"$/g, '').toLowerCase().normalize('NFC')).filter(Boolean)) {
      const key = `tag:${t}`;
      leaves.add(key);
      add(n.path, key);
    }
  }
  return { adj, leaves };
}
/** The depth-2 total (centre included) of `centre` in the estimated graph: the centre is always expanded, leaves never. */
export function depthTwoTotal(g: ReturnType<typeof textGraph>, centre: string): number {
  const seen = new Set([centre]);
  const d1 = [...(g.adj.get(centre) ?? [])];
  for (const n of d1) seen.add(n);
  for (const n of d1) if (!g.leaves.has(n)) for (const m of g.adj.get(n) ?? []) seen.add(m);
  return seen.size;
}
/** NFR-PERF-11 AC-3: the object (a note path) with the highest vault-wide degree whose depth-2 total is at most `cap`. */
export function panelCentre(vault: string, cap = 60): { path: string; degree: number; total: number } | null {
  const g = textGraph(vault);
  const objects = [...g.adj.entries()].filter(([k]) => !k.startsWith('tag:')).sort((a, b) => b[1].size - a[1].size || (a[0] < b[0] ? -1 : 1));
  for (const [path, nb] of objects) {
    const total = depthTwoTotal(g, path);
    if (total <= cap) return { path, degree: nb.size, total };
  }
  return null;
}
