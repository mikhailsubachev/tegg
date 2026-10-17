// MS4 slice 4F, L2 property (T2): FR-EMB-04 AC-7. For random vaults of 2…12 notes whose bodies hold 0…4 sole-embed
// paragraphs to random notes (self, missing targets, `#Heading` subpaths that exist or not, `|card`, `|link`, `|full`),
// building the embed tree of every note terminates and equals a reference expansion of the contract's rules
// (ms4-embeds §1, §5; D-420): only full embeds expand, at depth ≤ 3, never into the open note or an ancestor frame
// (whatever the subpath); an embed at depth 4 is `too-deep`; at most one load per level and each file once; the
// number of expanded frames is bounded by the product of embeds per level; the same vault gives the same tree after a
// rebuild (AR-01). The tree is built in TypeScript only (contract §11.3), so there is no Rust twin.
// docs/acceptance/embeds.md FR-EMB-04 AC-7. Written from the ACs and the contract only (D-61). Seeds: a fixed seed
// plus QA_SEED (TS-L2); more runs with EMBEDS_PROPERTY_RUNS. The app package has no fast-check, so cases come from a
// seeded PRNG (mulberry32); a failure reports its seed and case number.
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { memLoader, resolveIn, hostOf, treeModule, typeDto } from './embeds-helpers';

type E = { t: number; sub: 0 | 1 | 2; mode: 0 | 1 | 2 | 3; after: boolean };
type N = { osoba: boolean; heading: boolean; embeds: E[] };
const MODES = [null, 'card', 'link', 'full'] as const;
const SUBS = [null, 'Část', 'Nenalezeno'] as const;

const title = (i: number) => `Poznámka ${i}`;
const pathOf = (i: number) => `Pages/${title(i)}.md`;
const valueOf = (e: E, n: number) => {
  const target = e.t >= n ? 'Nic' : title(e.t);
  const sub = SUBS[e.sub];
  const mode = MODES[e.mode];
  return `${target}${sub ? `#${sub}` : ''}${mode ? `|${mode}` : ''}`;
};
/** The note's embeds in document order: those before the heading, then those after it. */
const docOrder = (note: N): E[] => (note.heading ? [...note.embeds.filter((e) => !e.after), ...note.embeds.filter((e) => e.after)] : note.embeds);
function textOf(notes: N[], i: number): string {
  const n = notes.length;
  const note = notes[i];
  const before = note.embeds.filter((e) => !(note.heading && e.after)).map((e) => `![[${valueOf(e, n)}]]`);
  const after = note.embeds.filter((e) => note.heading && e.after).map((e) => `![[${valueOf(e, n)}]]`);
  const blocks = [`Text ${i}.`, ...before, ...(note.heading ? ['## Část', `Pod nadpisem ${i}.`, ...after] : [])];
  const id = `01JB4F0000000000000000P${String(i).padStart(3, '0')}`;
  return `---\nid: ${id}\ntype: ${note.osoba ? 'osoba' : 'page'}\ntitle: ${title(i)}\n---\n${blocks.join('\n\n')}\n`;
}

/** Reference expansion: rows [depth, value, mode, state] in document order. */
function expected(notes: N[], host: number): [number, string, string, string][] {
  const n = notes.length;
  const out: [number, string, string, string][] = [];
  const shownEmbeds = (i: number, sub: string | null): E[] => {
    const note = notes[i];
    if (sub === 'Část') return note.embeds.filter((e) => e.after);
    return docOrder(note);
  };
  const walk = (embeds: E[], depth: number, ancestors: number[]) => {
    for (const e of embeds) {
      const value = valueOf(e, n);
      const resolved = e.t < n;
      const def = resolved && notes[e.t].osoba ? 'card' : 'full';
      const mode = MODES[e.mode] ?? def;
      if (depth === 4) { out.push([4, value, resolved ? 'link' : '*', resolved ? 'too-deep' : 'too-deep|broken']); continue; }
      if (!resolved) { out.push([depth, value, '*', 'broken']); continue; }
      // A card or link-mode embed never expands; with a subpath its state isn't fixed by the contract (question Q).
      if (mode !== 'full') { out.push([depth, value, mode, SUBS[e.sub] ? '*' : 'ok']); continue; }
      if (ancestors.includes(e.t)) { out.push([depth, value, 'full', 'circular']); continue; }
      const sub = SUBS[e.sub];
      if (sub === 'Nenalezeno' || (sub === 'Část' && !notes[e.t].heading)) { out.push([depth, value, 'full', 'missing-section']); continue; }
      out.push([depth, value, 'full', 'ok']);
      walk(shownEmbeds(e.t, sub), depth + 1, [...ancestors, e.t]);
    }
  };
  walk(docOrder(notes[host]), 1, [host]);
  return out;
}

/** The tree as rows [depth, value, mode, state]. */
function actual(nodes: any[]): [number, string, string, string][] {
  const out: [number, string, string, string][] = [];
  const walk = (ns: any[]) => {
    for (const x of ns) {
      out.push([x.depth, String(x.value), x.mode, x.state]);
      walk(x.children ?? []);
    }
  };
  walk(nodes);
  return out;
}
/** Row-wise match; `*` in `want` matches any mode or state, `a|b` either. */
function matches(got: [number, string, string, string][], want: [number, string, string, string][]): boolean {
  if (got.length !== want.length) return false;
  const ok = (g: string, w: string) => w === '*' || w.split('|').includes(g);
  return got.every((g, i) => g[0] === want[i][0] && g[1] === want[i][1] && ok(g[2], want[i][2]) && ok(g[3], want[i][3]));
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function randomVault(rnd: () => number): N[] {
  const int = (k: number) => Math.floor(rnd() * k);
  const pick = <T,>(xs: readonly T[]) => xs[int(xs.length)];
  const n = 2 + int(11);
  return Array.from({ length: n }, () => ({
    osoba: rnd() < 0.3,
    heading: rnd() < 0.5,
    embeds: Array.from({ length: int(5) }, () => {
      const mode = pick([0, 0, 1, 2, 3] as const);
      const sub = mode === 1 || mode === 2 ? 0 : pick([0, 0, 1, 2] as const);
      return { t: int(n + 1), sub, mode, after: rnd() < 0.5 } as E;
    }),
  }));
}

const RUNS = Number(process.env.EMBEDS_PROPERTY_RUNS ?? 100);
const SEEDS = [20261017, Number(process.env.QA_SEED ?? 0) || 13];

test('fr_emb_04_ac7_property_embed_trees_terminate_and_follow_the_depth_and_cycle_rules', async () => {
  const t = await treeModule();
  const types = [typeDto('page'), typeDto('osoba')];
  const failures: string[] = [];
  for (const seed of SEEDS) {
    const rnd = mulberry32(seed);
    for (let run = 0; run < RUNS && failures.length === 0; run++) {
      const notes = randomVault(rnd);
      const n = notes.length;
      const objs = notes.map((x, i) => ({ path: pathOf(i), id: null, title: title(i), type: x.osoba ? 'osoba' : 'page' }));
      const files = new Map(notes.map((_, i) => [pathOf(i), textOf(notes, i)] as const));
      for (let h = 0; h < n; h++) {
        const build = async () => {
          const loader = await memLoader(files, objs);
          const host = await hostOf(pathOf(h), files.get(pathOf(h))!, (from, ts) => resolveIn(objs, from, ts));
          let timer: ReturnType<typeof setTimeout> | undefined;
          const timeout = new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('buildEmbedTree did not terminate within 5 s')), 5000); });
          try {
            const tree = (await Promise.race([t.buildEmbedTree(host, types, loader.load), timeout])) as any;
            return { tree, calls: loader.calls };
          } finally {
            clearTimeout(timer);
          }
        };
        const problems: string[] = [];
        let one: { tree: any; calls: string[][] } | null = null;
        try { one = await build(); } catch (e) { problems.push(String(e)); }
        if (one) {
          const got = actual(one.tree.embeds);
          const want = expected(notes, h);
          if (!matches(got, want)) problems.push(`tree ${JSON.stringify(got)}\n want ${JSON.stringify(want)}`);
          if (got.some((r) => r[0] > 4)) problems.push('a depth over 4');
          const flat = one.calls.flat();
          if (one.calls.length > 3 || one.tree.loads > 3) problems.push(`${one.calls.length} loads (at most one per level, D-429)`);
          if (new Set(flat).size !== flat.length) problems.push(`a file loaded twice: ${JSON.stringify(flat)}`);
          // Expanded frames ≤ Σ over depths 1…3 of the product of embeds per level.
          const per = Math.max(1, ...notes.map((x) => x.embeds.length));
          const expanded = got.filter((r) => r[2] === 'full' && r[3] === 'ok').length;
          if (expanded > per + per ** 2 + per ** 3) problems.push(`${expanded} expanded frames`);
          const again = await build();
          if (JSON.stringify(actual(again.tree.embeds)) !== JSON.stringify(got)) problems.push('a rebuild gives another tree (AR-01)');
        }
        if (problems.length) {
          failures.push(`seed ${seed} case ${run} host ${h} of ${JSON.stringify(notes.map((_, i) => textOf(notes, i).split('---\n')[2]))}:\n${problems.join('\n')}`);
          break;
        }
      }
    }
  }
  assert.deepEqual(failures.slice(0, 3), [], `${failures.length} failures`);
});
