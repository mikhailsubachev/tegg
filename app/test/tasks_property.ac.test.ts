// MS5 slice 5A-1, L2 property test: docs/acceptance/tasks.md FR-SYN-06 AC-22 (T2). For random vaults of 1…40 tasks
// with random statuses (options, missing, unknown), priorities, `due` values (valid dates around month, year and DST
// boundaries, impossible dates, date-times, absent), `completed` values and tags, random clocks and both regions:
// every open task is in exactly one of Today & overdue, This week, Later, Not scheduled; every Done-state task is in
// Done and no other section; no Cancelled-state task is in any section; the Kanban by status shows every task at most
// once and every open task exactly once (Q2-T: the Schedule through `queries/board/period.ts`, the Kanban through the
// fake core's grouping; D-1929). And for random sequences of checkbox, status-drag and tag-drag actions on a
// fake vault, each action changes exactly one file, only in the lines R44 / FR-TSK-02 AC-10 name, and leaves every
// other file byte-identical. Interfaces: docs/contracts/ms5-tasks.md §4 (views.ts) and §5 (@tegg/doc).
//
// Seeds (TS-L2): a fixed seed plus one random seed per run (`QA_SEED` when set, else the clock); with
// `QA_PROPERTY_SCALE` ≥ 100 (nightly) 10 seeds × 1,000 vaults. Every seed is printed; a failing vault becomes a fixture.
// Synthetic Czech text (D-50). Written from the AC and the contract only (D-61).
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { STATUS_OPTIONS, defs, row } from './tasks-data';

const FIXED_SEED = 20261017;
const scale = Number(process.env.QA_PROPERTY_SCALE ?? '1') || 1;
const randomSeed = Number(process.env.QA_SEED ?? '') || Date.now() % 2 ** 31;
const seeds = scale >= 100 ? Array.from({ length: 10 }, (_, i) => (i === 0 ? FIXED_SEED : randomSeed + i)) : [FIXED_SEED, randomSeed];
const runs = scale >= 100 ? 1000 : 100;
// D-749: at scale ≥ 100 the 10 seeds outrun Vitest's 5 s default.
const timeout = scale >= 100 ? 600_000 : 5_000;

function rng(seed: number) {
  let x = (seed >>> 0) || 1;
  const next = () => {
    x ^= x << 13; x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5; x >>>= 0;
    return x;
  };
  return {
    below: (n: number) => next() % n,
    pick<T>(a: readonly T[]): T { return a[next() % a.length]; },
    chance: (pct: number) => next() % 100 < pct,
  };
}
type R = ReturnType<typeof rng>;

type Mod = Record<string, any>;
async function load(path: string): Promise<Mod | null> {
  try {
    return (await import(/* @vite-ignore */ path)) as Mod;
  } catch {
    return null;
  }
}

const STATUSES = [...STATUS_OPTIONS.map((s) => s.label), null, 'Rozpracováno', 'odloženo'];
const PRIORITIES = ['High', 'Medium', 'Low', 'None', null, 'Urgentní'];
const DUES = [
  '2026-10-24', '2026-10-25', '2026-10-26', '2026-10-31', '2026-11-01', '2026-11-02', '2026-12-31', '2027-01-01', '2026-02-28', '2028-02-29',
  '2026-02-30', '2026-13-01', '2026-10-15T09:00:00+02:00', 'zítra', null, null,
];
const TODAYS = ['2026-10-24', '2026-10-25', '2026-10-26', '2026-10-31', '2026-11-01', '2026-12-31', '2027-01-01', '2026-03-01'];
const TAGS = ['práce', 'doma', 'Doma', 'čtení', 'finance', 'zahrada'];
const WORDS = ['Zavolat', 'Janě', 'koupit', 'žluťoučký', 'kůň', 'úkol', 'schůzka', 'účet'];
const stateOf = (s: string | null) => STATUS_OPTIONS.find((o) => o.label === s)?.state ?? 'open';

type Spec = { path: string; title: string; status: string | null; priority: string | null; due: string | null; completed: string | null; tags: string[]; body: string };
function genTasks(r: R): Spec[] {
  const n = 1 + r.below(40);
  return Array.from({ length: n }, (_, i) => {
    const title = `${r.pick(WORDS)} ${r.pick(WORDS)} ${i}`;
    const status = r.pick(STATUSES);
    return {
      path: `Tasks/${title}.md`, title, status, priority: r.pick(PRIORITIES), due: r.pick(DUES),
      completed: stateOf(status) === 'done' && r.chance(70) ? `2026-10-${String(1 + r.below(28)).padStart(2, '0')}T${String(r.below(24)).padStart(2, '0')}:15:00+02:00` : null,
      tags: [...new Set(Array.from({ length: r.below(3) }, () => r.pick(TAGS)))],
      body: r.chance(30) ? `Poznámka ${r.pick(WORDS)} #${r.pick(TAGS)}.\n` : '',
    };
  });
}
function textOf(s: Spec, n: number): string {
  const lines = [`id: 01JB5A0000000000000000P${String(n).padStart(3, '0')}`, 'type: task', `title: ${s.title}`];
  if (s.status !== null) lines.push(`status: ${s.status}`);
  if (s.priority !== null) lines.push(`priority: ${s.priority}`);
  if (s.due !== null) lines.push(`due: ${s.due}`);
  if (s.completed !== null) lines.push(`completed: ${s.completed}`);
  if (s.tags.length) lines.push(`tags: [${s.tags.join(', ')}]`);
  lines.push('created: 2026-10-01T09:00:00+02:00', 'modified: 2026-10-01T09:00:00+02:00');
  return `---\n${lines.join('\n')}\n---\n${s.body}`;
}

test('fr_syn_06_ac22_every_task_lands_in_exactly_one_place', { timeout: Math.max(timeout, 120_000) }, async () => {
  // Slice Q2-T (AC-Test-Change, D-1929, D-1935; D-1924: `views.ts` no longer exports `schedule` / `kanban`, v1-views
  // §28.2): the default `Schedule` and `Kanban` (R202) are run by the fake core's grouping (the core's L3 twin, checked
  // against Rust on the corpus) over every generated vault, and the checks are on their lanes: every open task in exactly
  // one place, a Done-state task only in the done lane (within its 7-day window, `period.completedWithin` as the oracle),
  // a Cancelled task nowhere (QA review M1).
  const p = await load('../ui/src/queries/board/period.ts');
  assert.ok(p && typeof p.completedWithin === 'function', 'ui/src/queries/board/period.ts (v1-views §28.1)');
  const fq = await load('../ui/test/fake-queries.ts');
  const tv = await load('../ui/test/fake-taskviews.ts');
  assert.ok(fq && typeof fq.queryRun === 'function' && tv && typeof tv.defaultTaskView === 'function', 'the fake core\'s query run and default views (§31.1)');
  const { readFileSync } = await import('node:fs');
  const { resolve } = await import('node:path');
  const taskYml = readFileSync(resolve(import.meta.dirname, '../../tests/fixtures/vaults/new-empty/.tegg/types/task.yml'), 'utf8');
  const schedule = tv!.defaultTaskView('Schedule');
  const kanban = tv!.defaultTaskView('Kanban');
  let checkedOpen = 0;
  let checkedDone = 0;
  for (const seed of seeds) {
    console.log(`fr_syn_06_ac22 bucketing seed = ${seed}`);
    const r = rng(seed);
    for (let i = 0; i < runs; i++) {
      const specs = genTasks(r);
      const tasks = specs.map((s) => row({ path: s.path, status: s.status, priority: s.priority, due: s.due, completed: s.completed, fmTags: s.tags }));
      const region = r.pick(['cs', 'en-US']);
      const today = r.pick(TODAYS);
      const zone = r.pick(['Europe/Prague', 'America/Los_Angeles']);
      const env = { today, zone, weekStart: region === 'cs' ? 1 : 0, locale: region };
      const files: Record<string, string> = { '.tegg/types/task.yml': taskYml, ...Object.fromEntries(specs.map((sp, n) => [sp.path, textOf(sp, n)])) };
      const ctx = `seed ${seed} run ${i} today ${today} ${region}`;
      // The default Schedule: period lanes, day groups on `period:week` only, the done lane.
      const sres: any = await fq!.queryRun({ kind: 'def', def: schedule, name: null }, null, env, files);
      assert.equal(sres.group?.kind, 'period', `${ctx}: the Schedule groups by period`);
      const where = new Map<string, string[]>();
      for (const lane of sres.group?.lanes ?? []) {
        const paths = lane.cards.map((c: { row: number }) => sres.rows[c.row].path as string);
        for (const path of paths) where.set(path, [...(where.get(path) ?? []), String(lane.id)]);
        if (lane.id === 'period:week') {
          const inDays = (lane.days ?? []).flatMap((d: { cards: { row: number }[] }) => d.cards.map((c) => sres.rows[c.row].path as string));
          assert.deepEqual([...inDays].sort(), [...paths].sort(), `${ctx}: the week's day groups hold exactly its cards, each once`);
        } else assert.deepEqual(lane.days ?? [], [], `${ctx}: ${lane.id} has no day groups`);
      }
      for (const t of tasks) {
        const got = where.get(t.path) ?? [];
        if (t.state === 'open' || t.state === 'in-progress') {
          assert.equal(got.length, 1, `${ctx}: open ${t.path} in exactly one lane: ${got}`);
          assert.notEqual(got[0], 'done', `${ctx}: open ${t.path} not in Done`);
          checkedOpen++;
        } else if (t.state === 'done') {
          const want: string[] = p!.completedWithin({ completed: t.completed, modified: t.modified }, today, 7, zone) ? ['done'] : [];
          assert.deepEqual(got, want, `${ctx}: Done-state ${t.path} only in the done lane, within its window`);
          checkedDone++;
        } else assert.deepEqual(got, [], `${ctx}: Cancelled ${t.path} in no lane`);
      }
      // The default Kanban by status, on every vault.
      const res = await fq!.queryRun({ kind: 'def', def: kanban, name: null }, null, env, files);
      const seen = new Map<string, number>();
      for (const lane of res.group?.lanes ?? []) for (const c of lane.cards) { const path = res.rows[c.row].path; seen.set(path, (seen.get(path) ?? 0) + 1); }
      for (const t of tasks) {
        const n = seen.get(t.path) ?? 0;
        if (t.state === 'cancelled') assert.equal(n, 0, `${ctx}: Cancelled ${t.path} in no column`);
        else assert.ok(n <= 1, `${ctx}: ${t.path} in at most one column`);
        if (t.state === 'open' || t.state === 'in-progress') assert.equal(n, 1, `${ctx}: open ${t.path} in exactly one column`);
      }
    }
  }
  assert.ok(checkedOpen > 0, 'the generator produced open tasks');
  assert.ok(checkedDone > 0, 'the generator produced Done tasks');
});

const NOW = '2026-10-14T12:00:00+02:00';
const ALLOWED: Record<string, RegExp> = { status: /^(status|completed|modified):/, tag: /^(tags:|  - |modified:)/ };

/** Lines of `a` and `b` that differ (multiset difference of the frontmatter), and whether the bodies are equal. */
function diff(a: string, b: string): { lines: string[]; bodySame: boolean } {
  const split = (t: string) => {
    const m = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(t);
    return m ? { fm: m[1].split('\n'), body: m[2] } : { fm: [], body: t };
  };
  const x = split(a), y = split(b);
  const count = (l: string[]) => l.reduce((m, s) => m.set(s, (m.get(s) ?? 0) + 1), new Map<string, number>());
  const cx = count(x.fm), cy = count(y.fm);
  const out: string[] = [];
  for (const [l, n] of cx) if ((cy.get(l) ?? 0) !== n) out.push(l);
  for (const [l, n] of cy) if ((cx.get(l) ?? 0) !== n) out.push(l);
  return { lines: out, bodySame: x.body === y.body };
}

test('fr_syn_06_ac22_each_action_changes_one_file_in_its_lines_only', { timeout }, async () => {
  const d = await load('@tegg/doc');
  assert.ok(d && typeof d.applyTaskChange === 'function' && typeof d.completeTask === 'function', '@tegg/doc task writes (§5)');
  const DEFS = defs();
  let changes = 0;
  for (const seed of seeds) {
    console.log(`fr_syn_06_ac22 writes seed = ${seed}`);
    const r = rng(seed + 7);
    for (let i = 0; i < runs; i++) {
      const specs = genTasks(r);
      const files: Record<string, string> = Object.fromEntries(specs.map((s, n) => [s.path, textOf(s, n)]));
      const steps = 1 + r.below(6);
      for (let k = 0; k < steps; k++) {
        const before = { ...files };
        const target = r.pick(specs);
        const text = files[target.path];
        const cur = /^status: (.*)$/m.exec(text)?.[1] ?? null;
        const kind = r.pick(['checkbox', 'status', 'tag'] as const);
        let out: string | null = null;
        let mustWrite = false;
        if (kind === 'checkbox') {
          const done = stateOf(cur) === 'done';
          out = d!.completeTask(text, DEFS, !done, NOW);
          mustWrite = true;
        } else if (kind === 'status') {
          const to = r.pick(STATUS_OPTIONS).label;
          const res = d!.applyTaskChange(text, { kind: 'status', to, toState: stateOf(to), fromState: stateOf(cur), firstOpen: 'To do', now: NOW });
          out = res?.text ?? null;
          mustWrite = to !== cur;
        } else {
          const fm = /^tags: \[(.*)\]$/m.exec(text)?.[1].split(', ').filter(Boolean) ?? [];
          const from = fm.length && r.chance(70) ? r.pick(fm) : null;
          const to = r.pick(TAGS);
          const res = d!.applyTaskChange(text, { kind: 'moveTag', from, to });
          out = res?.text ?? null;
          mustWrite = !fm.some((t) => t.normalize('NFC').toLowerCase() === to.normalize('NFC').toLowerCase());
        }
        const ctx = `seed ${seed} run ${i} step ${k} ${kind} on ${target.path}`;
        if (mustWrite) assert.ok(out !== null, `${ctx}: the action writes`);
        if (out === null) continue;
        const written: string = d!.touchModified(text, out, NOW);
        files[target.path] = written;
        changes++;
        const changed = Object.keys(files).filter((p) => files[p] !== before[p]);
        assert.ok(changed.length <= 1 && (changed.length === 0 || changed[0] === target.path), `${ctx}: one file changed: ${changed}`);
        const df = diff(text, written);
        assert.ok(df.bodySame, `${ctx}: the body is byte-identical`);
        const allowed = kind === 'tag' ? ALLOWED.tag : ALLOWED.status;
        assert.deepEqual(df.lines.filter((l) => !allowed.test(l)), [], `${ctx}: only ${allowed} lines change`);
      }
    }
  }
  assert.ok(changes > 0, 'actions wrote');
});
