// Slice G1, L2: the fast-check twin of crates/tegg-index/tests/ac_graph_props.rs for the fake core's TypeScript
// reference walk (app/ui/test/fake-graph.ts; docs/contracts/v1-graph.md §1.1…§1.3, §8): FR-GRP-01 AC-2 (templates,
// trash, self-links and unresolved links are never in a result), AC-4 (depth = the shortest distance where tag nodes and
// Daily Notes other than the centre have no onward step; a node at depth ≥ 2 has a neighbour one step closer that is the
// centre or not a leaf), AC-6 (every edge among drawn nodes with a visible kind, none with an end outside), FR-GRP-02
// AC-2 (hidden types aren't entered; every drawn node is joined to the centre through drawn nodes; hidden = unfiltered −
// total). Random vaults are synthetic (Czech titles, D-50), small (never above the cap), with unique titles, so the test
// knows every reference it wrote (the model). Written from the ACs and the contract only (D-61).
//
// Seeds (TS-L2): a fixed seed plus one random seed per run (`QA_SEED` when set, else the clock), printed as `seed = N`;
// `QA_PROPERTY_SCALE` ≥ 100 (nightly) runs 10 seeds × 1,000 cases.
import { test } from 'vitest';
import assert from 'node:assert/strict';
import fc from 'fast-check';

const FIXED_SEED = 20261029;
const scale = Number(process.env.QA_PROPERTY_SCALE ?? '1') || 1;
const random = Number(process.env.QA_SEED ?? '') || Date.now() % 2 ** 31;
const SEEDS = scale >= 100 ? Array.from({ length: 10 }, (_, i) => (i === 0 ? FIXED_SEED : random + i)) : [FIXED_SEED, random];
const RUNS = scale >= 100 ? 1000 : 20;
console.log(`graph property: ${SEEDS.map((s) => `seed = ${s}`).join(', ')}`);

type Mod = Record<string, any>;
async function load(path: string): Promise<Mod | null> {
  try {
    return (await import(/* @vite-ignore */ path)) as Mod;
  } catch {
    return null;
  }
}

type Kind = 'link' | 'relation' | 'embed' | 'tag';
type Obj = { path: string; title: string; type: string; daily: boolean };
type World = { objs: Obj[]; files: Record<string, string>; refs: { from: number; to: string; kind: Kind }[] };
const STEMS = ['Čtení', 'Řeka', 'Žába', 'Úkol', 'Šnek', 'Ďábel', 'Kůň', 'Ťuk', 'Měsíc', 'Níže', 'Dům', 'Píseň'];
const TAGS = ['účty', 'zdraví', 'výlet'];
const NEW_EMPTY_TYPES: Record<string, string> = {}; // the walk doesn't need type files for these checks

const objArb = fc.record({ kind: fc.integer({ min: 0, max: 4 }), stem: fc.integer({ min: 0, max: STEMS.length - 1 }) });
const linkArb = fc.record({ to: fc.nat(), embed: fc.boolean() });
const noteArb = fc.record({
  tags: fc.subarray(TAGS), inline: fc.option(fc.constantFrom(...TAGS), { nil: null }), rel: fc.option(fc.nat(), { nil: null }),
  links: fc.array(linkArb, { maxLength: 3 }), self: fc.boolean(), broken: fc.boolean(),
});
const worldArb = fc.array(fc.tuple(objArb, noteArb), { minLength: 4, maxLength: 15 }).map((spec): World => {
  const objs: Obj[] = spec.map(([o], i) => {
    const [type, daily] = o.kind === 0 ? ['daily-note', true] : o.kind === 1 ? ['task', false] : o.kind === 2 ? ['projekt', false] : ['page', false];
    const title = daily ? `2026-10-${String(1 + i).padStart(2, '0')}` : `${STEMS[o.stem]} ${i}`;
    const folder = { 'daily-note': 'Daily', task: 'Tasks', projekt: 'Projekty', page: 'Pages' }[type as string];
    return { path: `${folder}/${title}.md`, title, type: type as string, daily: daily as boolean };
  });
  const files: Record<string, string> = { ...NEW_EMPTY_TYPES };
  const refs: World['refs'] = [];
  spec.forEach(([, n], i) => {
    let front = `---\nid: 01JBGP${String(i).padStart(20, '0')}\ntype: ${objs[i].type}\ntitle: ${objs[i].title}\n`;
    if (objs[i].daily) front += `date: ${objs[i].title}\n`;
    if (n.tags.length) { front += `tags: [${n.tags.join(', ')}]\n`; for (const t of n.tags) refs.push({ from: i, to: `tag:${t}`, kind: 'tag' }); }
    if (n.rel !== null) {
      const j = n.rel % objs.length;
      front += `vztah: "[[${objs[j].title}]]"\n`;
      if (j !== i) refs.push({ from: i, to: objs[j].path, kind: 'relation' });
    }
    front += '---\n';
    let body = '';
    for (const l of n.links) {
      const j = l.to % objs.length;
      body += `${l.embed ? '!' : ''}[[${objs[j].title}]] text. `;
      if (j !== i) refs.push({ from: i, to: objs[j].path, kind: l.embed ? 'embed' : 'link' });
    }
    if (n.self) body += `[[${objs[i].title}]] `;
    if (n.broken) body += '[[Nikde nic]] [[2026-12-31]] ';
    if (n.inline) { body += `#${n.inline} `; refs.push({ from: i, to: `tag:${n.inline}`, kind: 'tag' }); }
    files[objs[i].path] = `${front}${body}\n`;
  });
  const all = objs.map((o) => `[[${o.title}]]`).join(' ');
  files['_templates/Page/Šablona.md'] = `---\ntype: page\ntags: [účty, zdraví]\n---\n${all}\n`;
  files['.trash/Pages/Smazaná.md'] = `---\ntype: page\ntags: [výlet]\n---\n${all} #účty\n`;
  return { objs, files, refs };
});
const caseArb = fc.record({
  centre: fc.nat(), depth: fc.integer({ min: 1, max: 3 }),
  hiddenTypes: fc.subarray(['page', 'task', 'projekt', 'daily-note', 'tag']), hiddenKinds: fc.subarray(['link', 'relation', 'embed', 'tag'] as Kind[]),
});

const sk = (id: any) => ('path' in id ? String(id.path) : `tag:${id.tag}`).normalize('NFC');
function pairs(w: World): Map<string, Set<Kind>> {
  const out = new Map<string, Set<Kind>>();
  for (const r of w.refs) {
    const a = w.objs[r.from].path.normalize('NFC'), b = r.to.normalize('NFC');
    const k = a <= b ? `${a}\u0000${b}` : `${b}\u0000${a}`;
    out.set(k, (out.get(k) ?? new Set()).add(r.kind));
  }
  return out;
}
const isLeaf = (w: World, k: string) => k.startsWith('tag:') || w.objs.some((o) => o.daily && o.path.normalize('NFC') === k);
const typeOf = (w: World, k: string) => (k.startsWith('tag:') ? 'tag' : w.objs.find((o) => o.path.normalize('NFC') === k)?.type ?? '');
function modelWalk(w: World, centre: string, depth: number, hiddenTypes: string[], hiddenKinds: Kind[]): Map<string, number> {
  const adj = new Map<string, Set<string>>();
  for (const [k, kinds] of pairs(w)) {
    if (![...kinds].some((x) => !hiddenKinds.includes(x))) continue;
    const [a, b] = k.split('\u0000');
    adj.set(a, (adj.get(a) ?? new Set()).add(b));
    adj.set(b, (adj.get(b) ?? new Set()).add(a));
  }
  const out = new Map([[centre, 0]]);
  const q = [centre];
  while (q.length) {
    const k = q.shift()!;
    const d = out.get(k)!;
    if (d >= depth || (k !== centre && isLeaf(w, k))) continue;
    for (const n of [...(adj.get(k) ?? [])].sort()) {
      if (out.has(n) || hiddenTypes.includes(typeOf(w, n))) continue;
      out.set(n, d + 1);
      q.push(n);
    }
  }
  return out;
}

type Check = (w: World, c: { centre: string; depth: number; hiddenTypes: string[]; hiddenKinds: Kind[] }, r: any) => string | null;
async function property(check: Check) {
  const m = await load('../ui/test/fake-graph.ts');
  assert.ok(m && typeof m.graphNeighbourhood === 'function', 'fake-graph.ts exports graphNeighbourhood');
  for (const seed of SEEDS) {
    // fast-check's own error wraps the first AssertionError; rethrown as one so the report names it.
    try {
      fc.assert(
      fc.property(worldArb, caseArb, (w, c0) => {
        const c = { centre: w.objs[c0.centre % w.objs.length].path.normalize('NFC'), depth: c0.depth, hiddenTypes: c0.hiddenTypes, hiddenKinds: c0.hiddenKinds };
        let r: any;
        try {
          r = m!.graphNeighbourhood(w.files, { ...c, cap: 150, showAll: false }, []);
        } catch (e) {
          assert.fail(`seed ${seed}: no answer for ${c.centre} d${c.depth}: ${JSON.stringify(e)}`);
        }
        const why = check(w, c, r);
        assert.equal(why, null, `seed ${seed}: ${c.centre} d${c.depth} hidden ${JSON.stringify(c.hiddenTypes)} ${JSON.stringify(c.hiddenKinds)}: ${why}`);
      }),
      { seed, numRuns: RUNS, endOnFailure: true },
    );
    } catch (e) {
      assert.fail(`seed = ${seed}: ${(e as Error).message}`);
    }
  }
}

test('fr_grp_01_ac2_templates_trash_unresolved_and_self_links_are_not_edges_property', { timeout: 120_000 }, async () => {
  await property((_, __, r) => {
    for (const n of r.nodes) {
      const p = String(n.path ?? '');
      if (p.startsWith('_templates/') || p.startsWith('.trash/')) return `node ${p}`;
      if (n.title === 'Nikde nic' || n.title === '2026-12-31') return `ghost node ${n.title}`;
    }
    const self = r.edges.find((e: any) => sk(e.a) === sk(e.b));
    return self ? `self-edge ${sk(self.a)}` : null;
  });
});

test('fr_grp_01_ac4_breadth_first_with_tags_and_daily_notes_as_leaves_property', { timeout: 120_000 }, async () => {
  await property((w, c, r) => {
    const got = new Map<string, number>(r.nodes.map((n: any) => [sk(n.id), n.depth]));
    const want = modelWalk(w, c.centre, c.depth, c.hiddenTypes, c.hiddenKinds);
    const s = (x: Map<string, number>) => JSON.stringify([...x].sort());
    if (s(got) !== s(want)) return `nodes and depths ${s(got)}, want ${s(want)}`;
    const adj = new Set(r.edges.flatMap((e: any) => [`${sk(e.a)}\u0000${sk(e.b)}`, `${sk(e.b)}\u0000${sk(e.a)}`]));
    for (const [k, d] of got) {
      if (d < 2) continue;
      if (![...got].some(([m, dm]) => dm === d - 1 && adj.has(`${k}\u0000${m}`) && (m === c.centre || !isLeaf(w, m)))) return `${k} at depth ${d} has no neighbour one step closer that is the centre or not a leaf`;
    }
    return null;
  });
});

test('fr_grp_01_ac6_all_edges_among_drawn_nodes_property', { timeout: 120_000 }, async () => {
  await property((w, c, r) => {
    const keys = new Set(r.nodes.map((n: any) => sk(n.id)));
    const got = r.edges.map((e: any) => `${sk(e.a)}\u0000${sk(e.b)}`).sort();
    const model = pairs(w);
    const want = [...model].filter(([k, kinds]) => { const [a, b] = k.split('\u0000'); return keys.has(a) && keys.has(b) && [...kinds].some((x) => !c.hiddenKinds.includes(x)); }).map(([k]) => k).sort();
    if (JSON.stringify(got) !== JSON.stringify(want)) return `edges ${JSON.stringify(got)}, want ${JSON.stringify(want)}`;
    for (const e of r.edges) {
      const kinds = [...new Set(e.ways.map((x: any) => x.kind))].sort();
      const m = [...(model.get(`${sk(e.a)}\u0000${sk(e.b)}`) ?? [])].sort();
      if (JSON.stringify(kinds) !== JSON.stringify(m)) return `${sk(e.a)}–${sk(e.b)} kinds ${kinds}, want ${m}`;
    }
    return null;
  });
});

test('fr_grp_02_ac2_hidden_types_are_not_walked_property', { timeout: 120_000 }, async () => {
  await property((w, c, r) => {
    if (!r.nodes.length || sk(r.nodes[0].id) !== c.centre) return 'the first node is not the centre';
    for (const n of r.nodes.slice(1)) if (c.hiddenTypes.includes(typeOf(w, sk(n.id)))) return `${sk(n.id)} of a hidden type is drawn`;
    const seen = new Set([c.centre]);
    for (let grew = true; grew;) {
      grew = false;
      for (const e of r.edges) {
        const [a, b] = [sk(e.a), sk(e.b)];
        if (seen.has(a) && !seen.has(b)) { seen.add(b); grew = true; }
        if (seen.has(b) && !seen.has(a)) { seen.add(a); grew = true; }
      }
    }
    if (seen.size !== r.nodes.length) return 'a drawn node is not joined to the centre through drawn nodes';
    const unfiltered = modelWalk(w, c.centre, c.depth, [], []).size;
    if (r.total !== r.nodes.length || r.unfiltered !== unfiltered || r.hidden !== unfiltered - r.nodes.length) {
      return `total ${r.total} unfiltered ${r.unfiltered} hidden ${r.hidden}; want ${r.nodes.length}, ${unfiltered}, ${unfiltered - r.nodes.length}`;
    }
    return null;
  });
});
