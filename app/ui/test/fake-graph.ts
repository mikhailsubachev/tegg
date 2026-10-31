// Fake core, slice G1 (docs/contracts/v1-graph.md §8): `graph_neighbourhood` as a TypeScript reference walk of §1 over
// the fake's files, with the real `@tegg/doc` extraction and the ms3-shell §11.1 resolution rules; tag keys and
// colours as fake-tags.ts. Runs in Node (installFakeCore exposes it to the page as `__teggGraph`). Checked against the
// Rust query on the graph fixture through tests/fixtures/vaults/graph-golden/expected.json
// (app/test/graph_reference.ac.test.ts). The rules mirror crates/tegg-index/src/graph.rs. Test code, not product code.
import * as doc from '@tegg/doc';
import type { EdgeKindDto, GraphEdgeDto, GraphNodeDto, GraphRequestDto, GraphResultDto, GraphWayDto, NodeIdDto } from '../src/graph/types';

export type GraphErr = { kind: 'CentreNotFound' | 'CentreInTrash' | 'InvalidDepth' | 'Cancelled' | 'NotReady'; message: string; title?: string };

const nfc = (s: string) => s.normalize('NFC');
const low = (s: string) => nfc(s).toLowerCase();
const byCode = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const TAG_COLORS = ['gray', 'blue', 'green', 'orange', 'purple', 'red', 'teal', 'yellow'];
const NOT_EDGE_KEYS = ['file', 'icon', 'cover'];
const MAX_DRAWN = 1000;
const STRENGTH: Record<EdgeKindDto, number> = { embed: 0, relation: 1, link: 2, tag: 3 };
/** D-121: system types before and after the user types (§1.7). */
const FIRST = ['page', 'task', 'quick-note', 'daily-note'];
const LAST = ['image', 'pdf'];

const indexed = (p: string) => /\.md$/.test(p) && !p.split('/').some((seg, i, a) => i < a.length - 1 && (seg.startsWith('.') || seg === '_templates')) && !p.startsWith('.');
const stemOf = (p: string) => nfc((p.split('/').pop() ?? p).replace(/\.md$/, ''));
const sortKey = (id: NodeIdDto) => ('path' in id ? id.path : `tag:${id.tag}`);
const same = (a: NodeIdDto, b: NodeIdDto) => sortKey(a) === sortKey(b) && ('path' in a) === ('path' in b);
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? nfc(v.trim()) : null);
// RFC 3339 with seconds, as the Rust index's `parse_from_rfc3339` (twin parity, v1-graph §8).
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
const instant = (v: unknown): number | null => (typeof v === 'string' && ISO.test(v.trim()) ? Date.parse(v.trim()) : null);
const fileNameKey = (t: string) => low(t.split('|')[0].split('#')[0].trim().split('/').pop() ?? '');

function isNoteTarget(t: string): boolean {
  const name = nfc(t).trim().split('/').pop() ?? '';
  if (!name) return false;
  const dot = name.lastIndexOf('.');
  if (dot < 0) return true;
  const ext = name.slice(dot + 1);
  return ext.toLowerCase() === 'md' || ext.includes(' ') || ext.length > 5;
}

type Obj = {
  path: string; stem: string; folder: string; id: string | null; title: string; type: string; single: boolean;
  attributes: Record<string, unknown>; frontmatterError: boolean; links: doc.Extracted['links']; tags: string[]; spellings: string[];
};

function objectsOf(files: Record<string, string>): Obj[] {
  return Object.keys(files).filter(indexed).map((path) => {
    const text = files[path];
    const stem = stemOf(path);
    const x = doc.extract(text, stem);
    const attributes = (x.attributes ?? {}) as Record<string, unknown>;
    const m = doc.typeMatch(x.attributes && 'type' in attributes ? attributes.type : undefined);
    const date = m.key === 'daily-note' && attributes.date != null ? doc.parseDate(String(attributes.date).trim().slice(0, 10)) : null;
    const spellings = (doc.tags(doc.parse(text)) as { name: string }[]).map((t) => nfc(t.name));
    return {
      path: nfc(path), stem, folder: path.includes('/') ? nfc(path.slice(0, path.lastIndexOf('/'))) : '', id: x.id ? nfc(x.id) : null,
      title: nfc(date ?? x.title), type: nfc(m.key), single: m.single, attributes, frontmatterError: x.frontmatterError,
      links: x.links, tags: x.tags.map(nfc), spellings,
    };
  }).sort((a, b) => byCode(a.path, b.path));
}

type Res = { kind: 'note' | 'unresolved' | 'other'; path: string | null };

/** ms3-shell §11.1 from the linking note (the rules of `resolve_from` in the Rust index). */
function resolver(objs: Obj[]) {
  const byPath = new Map<string, Obj>();
  const byStem = new Map<string, Obj[]>();
  const sorted = [...objs].sort((a, b) => [...a.path].length - [...b.path].length || byCode(a.path, b.path));
  for (const o of sorted) {
    byPath.set(low(o.path).replace(/\.md$/, ''), o);
    byStem.set(low(o.stem), [...(byStem.get(low(o.stem)) ?? []), o]);
  }
  // FR-SYN-05: one object per id, the D-53 primary: the file named like its title, else the older `created`, else the
  // shorter path.
  const byId = new Map<string, Obj>();
  const groups = new Map<string, Obj[]>();
  for (const o of objs) if (o.id) groups.set(o.id, [...(groups.get(o.id) ?? []), o]);
  for (const [id, g] of groups) {
    const named = g.filter((o) => low(o.stem) === low(o.title));
    const pool = named.length ? named : g;
    const created = (o: Obj) => instant(o.attributes.created) ?? Number.MAX_SAFE_INTEGER;
    byId.set(id, [...pool].sort((a, b) => created(a) - created(b) || [...a.path].length - [...b.path].length || byCode(a.path, b.path))[0]);
  }
  const daily = new Map<string, Obj>();
  const order = (a: Obj, b: Obj) => doc.dailyOrder({ path: a.path, created: a.attributes.created, modified: a.attributes.modified }, { path: b.path, created: b.attributes.created, modified: b.attributes.modified });
  for (const o of [...objs].filter((x) => x.type === 'daily-note').sort(order)) {
    const d = o.attributes.date != null ? doc.parseDate(String(o.attributes.date).trim().slice(0, 10)) : null;
    if (d && !daily.has(d)) daily.set(d, o);
  }
  return (from: string, target: string): Res => {
    let t = nfc(target.trim());
    const cut = t.search(/[|#]/);
    if (cut >= 0) t = t.slice(0, cut);
    t = t.trim();
    if (!t) return { kind: 'unresolved', path: null };
    if (doc.parseDate(t)) {
      const o = daily.get(t);
      return o ? { kind: 'note', path: o.path } : { kind: 'other', path: null };
    }
    const fromDir = from.includes('/') ? low(from.slice(0, from.lastIndexOf('/'))) : '';
    const key = low(t).replace(/\.md$/, '');
    const hit = (fromDir ? byPath.get(`${fromDir}/${key}`) : undefined) ?? byPath.get(key) ?? byId.get(t)
      ?? (!key.includes('/') ? ((byStem.get(key) ?? []).find((o) => low(o.folder) === fromDir) ?? (byStem.get(key) ?? [])[0]) : undefined);
    return hit ? { kind: 'note', path: hit.path } : { kind: 'unresolved', path: null };
  };
}

type Info = Omit<GraphNodeDto, 'depth' | 'degree'> & { leaf: boolean };
type Graph = { nodes: Map<string, Info>; adj: Map<string, NodeIdDto[]>; pairs: Map<string, GraphWayDto[]>; byPath: Map<string, NodeIdDto> };

const pairKey = (a: NodeIdDto, b: NodeIdDto) => (sortKey(a) <= sortKey(b) ? `${sortKey(a)}\u0000${sortKey(b)}` : `${sortKey(b)}\u0000${sortKey(a)}`);

/** The vault-wide graph of §1.1 (`GraphData::build` in the Rust index). */
function build(objs: Obj[]): Graph {
  const tagFiles = new Map<string, { path: string; created: number | null }[]>();
  for (const o of objs.filter((x) => x.type === 'tag' && x.single)) {
    const key = doc.tagKey(str(o.attributes.title) ?? o.stem);
    tagFiles.set(key, [...(tagFiles.get(key) ?? []), { path: o.path, created: instant(o.attributes.created) }]);
  }
  for (const v of tagFiles.values()) {
    v.sort((a, b) => (a.created === null ? 1 : 0) - (b.created === null ? 1 : 0) || (a.created !== null && b.created !== null ? a.created - b.created : 0) || byCode(a.path, b.path));
  }
  const winners = new Set([...tagFiles.values()].map((v) => v[0].path));
  const losers = new Set([...tagFiles.values()].flatMap((v) => v.slice(1).map((x) => x.path)));
  const byObjPath = new Map(objs.map((o) => [o.path, o]));
  const g: Graph = { nodes: new Map(), adj: new Map(), pairs: new Map(), byPath: new Map() };
  for (const o of objs) {
    if (losers.has(o.path) || winners.has(o.path)) continue;
    const id = { path: o.path };
    g.byPath.set(o.path, id);
    g.nodes.set(sortKey(id), { id, objectId: o.id, path: o.path, title: o.title, typeKey: o.type, tagKey: null, color: null, leaf: o.type === 'daily-note' });
  }
  // Tag nodes: every key with an occurrence or a Tag file; a virtual tag is named by its most frequent spelling.
  const spellings = new Map<string, Map<string, number>>();
  for (const o of objs) o.tags.forEach((k, i) => {
    const m = spellings.get(k) ?? spellings.set(k, new Map()).get(k)!;
    const s = o.spellings[i] ?? k;
    m.set(s, (m.get(s) ?? 0) + 1);
  });
  for (const key of [...new Set([...spellings.keys(), ...tagFiles.keys()])].sort(byCode)) {
    const w = tagFiles.get(key)?.[0];
    const wo = w ? byObjPath.get(w.path) : undefined;
    const id = { tag: key };
    const best = [...(spellings.get(key) ?? new Map()).entries()].sort((a, b) => b[1] - a[1] || byCode(a[0], b[0]))[0]?.[0] ?? key;
    const color = wo ? str(wo.attributes.color)?.toLowerCase() ?? null : null;
    if (wo) g.byPath.set(wo.path, id);
    g.nodes.set(sortKey(id), {
      id, objectId: wo?.id ?? null, path: wo?.path ?? null, title: wo ? str(wo.attributes.title) ?? wo.stem : nfc(best), typeKey: 'tag', tagKey: key,
      color: color && TAG_COLORS.includes(color) ? color : null, leaf: true,
    });
  }
  // FR-ATT-07: Image and PDF objects by the file their `file:` names.
  const media = new Map<string, NodeIdDto>();
  for (const o of objs.filter((x) => x.type === 'image' || x.type === 'pdf')) {
    const id = g.byPath.get(o.path);
    if (!id) continue;
    for (const l of o.links) if (l.inFrontmatter && l.attribute === 'file' && !media.has(fileNameKey(l.target))) media.set(fileNameKey(l.target), id);
  }
  const ways = new Map<string, { a: NodeIdDto; b: NodeIdDto; set: Map<string, GraphWayDto> }>();
  const add = (from: NodeIdDto, to: NodeIdDto, kind: EdgeKindDto, key: string | null) => {
    if (same(from, to)) return;
    const k = pairKey(from, to);
    const e = ways.get(k) ?? ways.set(k, { a: sortKey(from) <= sortKey(to) ? from : to, b: sortKey(from) <= sortKey(to) ? to : from, set: new Map() }).get(k)!;
    e.set.set(`${kind}\u0000${sortKey(from)}\u0000${key ?? ''}`, { kind, from, key });
  };
  const resolve = resolver(objs);
  for (const o of objs) {
    const from = g.byPath.get(o.path);
    if (!from) continue;
    for (const l of o.links) {
      if (o.frontmatterError && l.inFrontmatter) continue;
      let kind: EdgeKindDto, key: string | null = null;
      if (l.inFrontmatter) {
        const attr = nfc(l.attribute ?? '');
        if (NOT_EDGE_KEYS.includes(attr)) continue;
        kind = 'relation';
        key = attr;
      } else kind = l.embed ? 'embed' : 'link';
      const r = resolve(o.path, l.target);
      const to = r.kind === 'note' ? g.byPath.get(r.path!) : r.kind === 'unresolved' && !isNoteTarget(l.target) ? media.get(fileNameKey(l.target)) : undefined;
      if (to) add(from, to, kind, key);
    }
    for (const k of new Set(o.tags)) if (g.nodes.has(`tag:${k}`)) add(from, { tag: k }, 'tag', null);
  }
  const wayOrder = (x: GraphWayDto, y: GraphWayDto) => STRENGTH[x.kind] - STRENGTH[y.kind] || byCode(sortKey(x.from), sortKey(y.from)) || (x.key === null ? (y.key === null ? 0 : -1) : y.key === null ? 1 : byCode(x.key, y.key));
  for (const [k, e] of ways) {
    g.pairs.set(k, [...e.set.values()].sort(wayOrder));
    g.adj.set(sortKey(e.a), [...(g.adj.get(sortKey(e.a)) ?? []), e.b]);
    g.adj.set(sortKey(e.b), [...(g.adj.get(sortKey(e.b)) ?? []), e.a]);
  }
  for (const v of g.adj.values()) v.sort((x, y) => byCode(sortKey(x), sortKey(y)));
  return g;
}

type Walked = { id: NodeIdDto; depth: number }[];

function walk(g: Graph, centre: NodeIdDto, depth: number, filter: { types: Set<string>; kinds: Set<string> } | null): Walked {
  const seen = new Set([sortKey(centre)]);
  const out: Walked = [{ id: centre, depth: 0 }];
  let frontier = [centre];
  for (let level = 1; level <= depth; level++) {
    const next: NodeIdDto[] = [];
    for (const n of frontier) {
      if (sortKey(n) !== sortKey(centre) && g.nodes.get(sortKey(n))?.leaf) continue;
      for (const m of g.adj.get(sortKey(n)) ?? []) {
        if (seen.has(sortKey(m))) continue;
        if (filter) {
          if (filter.types.has(g.nodes.get(sortKey(m))!.typeKey)) continue;
          if ((g.pairs.get(pairKey(n, m)) ?? []).every((w) => filter.kinds.has(w.kind))) continue;
        }
        seen.add(sortKey(m));
        out.push({ id: m, depth: level });
        next.push(m);
      }
    }
    frontier = next;
  }
  return out;
}

/** The D-977 type list of the vault (§1.7): defined types in D-121 order, `tag`, then undefined values. */
function typeOrder(files: Record<string, string>, objs: Obj[]): string[] {
  const defs = Object.keys(files).filter((p) => /^\.tegg\/types\/[^/]+\.yml$/.test(p)).map((p) => {
    const y = files[p];
    const field = (k: string) => { const m = new RegExp(`^${k}:\\s*(.+?)\\s*$`, 'm').exec(y); return m ? nfc(m[1].replace(/^["']|["']$/g, '')) : null; };
    return { key: nfc(p.slice('.tegg/types/'.length, -'.yml'.length)), name: field('name') ?? '', system: field('system') === 'true' };
  });
  const defined = new Set([...defs.map((d) => d.key), ...FIRST, ...LAST, 'tag']);
  const user = defs.filter((d) => !d.system && !FIRST.includes(d.key) && !LAST.includes(d.key) && d.key !== 'tag')
    .sort((a, b) => byCode(a.name, b.name) || byCode(a.key, b.key)).map((d) => d.key);
  const undefinedKeys = [...new Set(objs.map((o) => o.type))].filter((k) => !defined.has(k)).sort(byCode);
  return [...FIRST, ...user, ...LAST, 'tag', ...undefinedKeys];
}

/** §1 with `depthTotals` (D-999), as the IPC answers it. */
function query(files: Record<string, string>, req: GraphRequestDto): GraphResultDto & { depthTotals: number[] } {
  if (![1, 2, 3].includes(req.depth)) throw { kind: 'InvalidDepth', message: 'depth must be 1, 2 or 3' } satisfies GraphErr;
  const objs = objectsOf(files);
  const g = build(objs);
  const centre = g.byPath.get(nfc(req.centre));
  if (!centre) {
    const trashed = files[`.trash/${nfc(req.centre)}`];
    if (trashed !== undefined) throw { kind: 'CentreInTrash', message: 'in the trash', title: nfc(doc.extract(trashed, stemOf(req.centre)).title) } satisfies GraphErr;
    throw { kind: 'CentreNotFound', message: 'the centre doesn\'t exist' } satisfies GraphErr;
  }
  const types = new Set(req.hiddenTypes.map(nfc));
  const kinds = new Set<string>(req.hiddenKinds);
  const filtered = walk(g, centre, req.depth, { types, kinds });
  const unfiltered = walk(g, centre, req.depth, null);
  const degree = (id: NodeIdDto) => (g.adj.get(sortKey(id)) ?? []).length;
  const visible = (a: NodeIdDto, b: NodeIdDto) => (g.pairs.get(pairKey(a, b)) ?? []).some((w) => !kinds.has(w.kind));
  const depthOf = new Map(filtered.map((x) => [sortKey(x.id), x.depth]));
  const ranked = [...filtered].sort((a, b) => a.depth - b.depth || degree(b.id) - degree(a.id) || byCode(sortKey(a.id), sortKey(b.id)));
  const total = filtered.length;
  let kept: Walked;
  if (total <= req.cap || (req.showAll && total <= MAX_DRAWN)) kept = ranked;
  else {
    kept = [...ranked.filter((x) => x.depth === 0), ...ranked.filter((x) => x.depth === 1).slice(0, MAX_DRAWN)];
    const keptSet = new Set(kept.map((x) => sortKey(x.id)));
    for (let d = 2; d <= req.depth; d++) {
      for (const x of ranked.filter((y) => y.depth === d)) {
        if (kept.length >= req.cap) break;
        const near = (g.adj.get(sortKey(x.id)) ?? []).some((m) => depthOf.get(sortKey(m)) === d - 1 && keptSet.has(sortKey(m)) && visible(x.id, m));
        if (near) { keptSet.add(sortKey(x.id)); kept.push(x); }
      }
    }
  }
  const keptSet = new Set(kept.map((x) => sortKey(x.id)));
  const nodes: GraphNodeDto[] = kept.map(({ id, depth }) => {
    const { leaf: _leaf, ...i } = g.nodes.get(sortKey(id))!;
    return { id: i.id, objectId: i.objectId, path: i.path, title: i.title, typeKey: i.typeKey, depth, degree: degree(id), tagKey: i.tagKey, color: i.color };
  });
  const edges: GraphEdgeDto[] = [];
  for (const { id: a } of kept) {
    for (const b of g.adj.get(sortKey(a)) ?? []) {
      if (!keptSet.has(sortKey(b)) || sortKey(a) >= sortKey(b)) continue;
      const ways = g.pairs.get(pairKey(a, b)) ?? [];
      const vis = ways.filter((w) => !kinds.has(w.kind)).sort((x, y) => STRENGTH[x.kind] - STRENGTH[y.kind]);
      if (!vis.length) continue;
      edges.push({ a, b, style: vis[0].kind, ways });
    }
  }
  edges.sort((x, y) => byCode(sortKey(x.a), sortKey(y.a)) || byCode(sortKey(x.b), sortKey(y.b)));
  const counts = new Map<string, number>();
  for (const { id } of unfiltered) { const t = g.nodes.get(sortKey(id))!.typeKey; counts.set(t, (counts.get(t) ?? 0) + 1); }
  const order = typeOrder(files, objs);
  const typeCounts: [string, number][] = order.map((k) => [k, counts.get(k) ?? 0]);
  for (const [k, n] of [...counts.entries()].sort((a, b) => byCode(a[0], b[0]))) if (!order.includes(k)) typeCounts.push([k, n]);
  const depthTotals = Array.from({ length: req.depth }, (_, i) => filtered.filter((x) => x.depth <= i + 1).length);
  return { nodes, edges, total, unfiltered: unfiltered.length, hidden: unfiltered.length - total, truncated: kept.length < total, typeCounts, depthTotals };
}

/** The reference walk: `files` vault path → text (`.tegg/types/*.yml` included), `bin` the binary vault paths
 *  (attachments). Throws a `GraphErr`. Returns the §1 fields the golden holds; the IPC answer adds `depthTotals`. */
export function graphNeighbourhood(files: Record<string, string>, req: GraphRequestDto, bin: string[] = []): GraphResultDto {
  void bin;
  const { depthTotals: _totals, ...r } = query(files, req);
  return r;
}

export async function handle(cmd: string, a: any, files: Record<string, string>, bin: string[]): Promise<{ result?: unknown; error?: GraphErr }> {
  void bin;
  try {
    switch (cmd) {
      case 'graph_neighbourhood': return { result: query(files, a.req as GraphRequestDto) };
      default: return { error: { kind: 'CentreNotFound', message: `fake-graph: unknown command ${cmd}` } };
    }
  } catch (e) {
    return { error: e as GraphErr };
  }
}

/** G3 (v1-graph §16.1): the vault's D-977 type order for the presets twin's `hidden-types` (fake-presets.ts). */
export function vaultTypeOrder(files: Record<string, string>): string[] {
  return typeOrder(files, objectsOf(files));
}
