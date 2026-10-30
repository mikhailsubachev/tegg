// Shared data of the slice G1 L1 tests (docs/acceptance/graph.md; docs/contracts/v1-graph.md §1, §2): the graph
// fixture as an in-memory vault (tests/fixtures/vaults/graph without README.md and make-hub.*, plus new-empty/.tegg;
// the two runtime attachments as binary paths), and the hand-made golden (tests/fixtures/vaults/graph-golden/
// expected.json) expanded to GraphResultDto. No assertions about the criteria here.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import type { GraphEdgeDto, GraphNodeDto, GraphRequestDto, GraphResultDto } from '../ui/src/graph/types';

export const REPO = resolve(import.meta.dirname, '../..');
const FX = resolve(REPO, 'tests/fixtures/vaults');

export function graphFiles(): Record<string, string> {
  const files: Record<string, string> = {};
  const walk = (root: string, d: string, prefix: string) => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) { walk(root, p, prefix); continue; }
      const rel = (prefix + relative(root, p)).normalize('NFC');
      if (rel === 'README.md' || rel.startsWith('make-hub.')) continue;
      files[rel] = readFileSync(p, 'utf8');
    }
  };
  walk(join(FX, 'graph'), join(FX, 'graph'), '');
  walk(join(FX, 'new-empty/.tegg'), join(FX, 'new-empty/.tegg'), '.tegg/');
  return files;
}
/** The README's runtime attachments (binary vault files). */
export const BIN = ['_attachments/graf.png', '_attachments/Smlouva.pdf'];

type Scenario = { name: string; req: GraphRequestDto; nodes: [string, number][]; edges: string[]; styles: Record<string, string>; total: number; unfiltered: number; hidden: number; truncated: boolean; typeCounts: number[] };
export type Golden = { typeOrder: string[]; nodes: Record<string, Omit<GraphNodeDto, 'depth'>>; edges: Record<string, GraphEdgeDto>; edgeOrder: string[]; scenarios: Scenario[] };

export function golden(): Golden {
  return JSON.parse(readFileSync(join(FX, 'graph-golden/expected.json'), 'utf8')) as Golden;
}
/** A scenario as the GraphResultDto it stands for (graph-golden/README.md). */
export function expand(g: Golden, s: Scenario): GraphResultDto {
  return {
    nodes: s.nodes.map(([k, depth]) => ({ ...g.nodes[k], depth }) as GraphNodeDto),
    edges: s.edges.map((id) => ({ ...g.edges[id], ...(s.styles[id] ? { style: s.styles[id] as GraphEdgeDto['style'] } : {}) })),
    total: s.total, unfiltered: s.unfiltered, hidden: s.hidden, truncated: s.truncated,
    typeCounts: g.typeOrder.map((k, i) => [k, s.typeCounts[i]] as [string, number]),
  };
}
export function scenario(name: string): GraphResultDto {
  const g = golden();
  const s = g.scenarios.find((x) => x.name === name);
  if (!s) throw new Error(`setup: golden scenario ${name}`);
  return expand(g, s);
}

/** The type definitions of the fixture that name relations (D-971): projekt and schůzka. */
export const RELATION_NAMES = [
  { key: 'projekt', attributes: [{ key: 'vlastník', name: 'Vlastník' }, { key: 'podklady', name: 'Podklady' }, { key: 'termín', name: 'Termín' }, { key: 'poznámka', name: 'Poznámka' }] },
  { key: 'schůzka', attributes: [{ key: 'datum', name: 'Datum' }, { key: 'účastníci', name: 'Účastníci' }, { key: 'projekt', name: 'Projekt' }] },
  { key: 'osoba', attributes: [{ key: 'firma', name: 'Firma' }] },
  { key: 'task', attributes: [] },
  { key: 'page', attributes: [] },
];

export const PLAN = 'Pages/Plán čtvrtletí.md';
export const node = (r: GraphResultDto, key: string) =>
  r.nodes.find((n) => ('path' in n.id ? n.id.path : `tag:${n.id.tag}`) === key.normalize('NFC'));

/** A synthetic result shaped like the hub's Rozcestník at depth 2 (150 kept nodes, 149 edges; fixture README). */
export function hubLike(): GraphResultDto {
  const two = (n: number) => String(n).padStart(2, '0');
  const mk = (title: string, depth: number, degree: number, n: number): GraphNodeDto => ({
    id: { path: `Pages/Hub/${title}.md` }, objectId: `01JBGR000000000000000H${String(n).padStart(4, '0')}`, path: `Pages/Hub/${title}.md`,
    title, typeKey: 'page', depth, degree, tagKey: null, color: null,
  });
  const nodes: GraphNodeDto[] = [mk('Rozcestník', 0, 40, 1)];
  const edges: GraphEdgeDto[] = [];
  const link = (a: GraphNodeDto, b: GraphNodeDto) => edges.push({ a: a.id, b: b.id, style: 'link', ways: [{ kind: 'link', from: a.id, key: null }] });
  const spokes: GraphNodeDto[] = [];
  for (let n = 1; n <= 40; n++) { const s = mk(`Paprsek ${two(n)}`, 1, 4, 1 + n); spokes.push(s); nodes.push(s); link(nodes[0], s); }
  for (let n = 1; n <= 40; n++) for (const [i, x] of ['a', 'b', 'c'].entries()) {
    if (x === 'c' && n > 29) continue;
    const u = mk(`Uzel ${two(n)}-${x}`, 2, x === 'c' ? 1 : 16, 41 + 3 * (n - 1) + i + 1);
    nodes.push(u); link(spokes[n - 1], u);
  }
  return { nodes, edges, total: 161, unfiltered: 161, hidden: 0, truncated: true, typeCounts: [['page', 161]] };
}
