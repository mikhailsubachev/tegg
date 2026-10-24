// MS5 slice 5B, L2 property test: docs/acceptance/inbox.md FR-SYN-06 AC-28 (R61, D-554, D-555). For random vaults of
// 1…40 objects with random types, `review` values (missing, `unreviewed`, `reviewed`, quoted, other), `captured` /
// `created` / `modified` values (with and without offset, date only, invalid, absent), random clocks, zones and
// regions: every member is listed exactly once by the fake core's `inbox_list` twin (app/ui/test/fake-inbox.ts) and no
// non-member is; `inboxOrder` and `inboxGroups` (app/ui/src/inbox/bucket.ts) follow R61 as computed here independently
// (with the existing `@tegg/doc` `parseInstant`, `localDate`, `addDays`); the per-type filter counts sum to the total;
// the count equals the total. Seeds (TS-L2): a fixed seed plus `QA_SEED`; `QA_PROPERTY_SCALE` ≥ 100 → 10 seeds × 300
// vaults. Every seed is printed. Written from the AC and the contract only (D-61). Modules load inside the test (TS-I1).
import { test } from 'vitest';
import assert from 'node:assert/strict';

type Mod = Record<string, any>;
type Row = { path: string; title: string; type: string; captured: string | null; created: string | null; modified: string | null };
async function load(path: string): Promise<Mod | null> {
  try {
    return (await import(/* @vite-ignore */ path)) as Mod;
  } catch {
    return null;
  }
}

const FIXED_SEED = 20261019;
const scale = Number(process.env.QA_PROPERTY_SCALE ?? '1') || 1;
const randomSeed = Number(process.env.QA_SEED ?? '') || Date.now() % 2 ** 31;
const seeds = scale >= 100 ? Array.from({ length: 10 }, (_, i) => (i === 0 ? FIXED_SEED : randomSeed + i)) : [FIXED_SEED, randomSeed];
const runs = scale >= 100 ? 300 : 40;
// D-749: at scale ≥ 100 the 10 seeds outrun Vitest's 5 s default.
const timeout = scale >= 100 ? 600_000 : 5_000;

function rng(seed: number) {
  let x = (seed >>> 0) || 1;
  const next = () => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x; };
  return { below: (n: number) => next() % n, pick<T>(a: readonly T[]): T { return a[next() % a.length]; }, chance: (p: number) => next() % 100 < p };
}
type R = ReturnType<typeof rng>;

const TYPES = [['page', 'Pages'], ['task', 'Tasks'], ['quick-note', 'Quick Notes'], ['daily-note', 'Daily'], ['nápad', 'Nápady'], ['schůzka', 'Schůzky']] as const;
const TYPE_SPELLINGS: Record<string, string[]> = { page: ['page', 'Page'], task: ['task'], 'quick-note': ['quick-note', 'Quick Note'], 'daily-note': ['daily-note'], 'nápad': ['nápad', 'Nápad'.normalize('NFD')], 'schůzka': ['schůzka'] };
const REVIEWS = [null, 'unreviewed', 'reviewed', '"unreviewed"', "'reviewed'", 'Unreviewed', 'maybe', '[a, b]', ' unreviewed '];
const TITLES = ['Čaj', 'Cesta', 'Alfa', 'Žluťoučký kůň', 'Řeka', 'Beta', 'čajovna', 'Úvod'];
const ZONES = ['Europe/Prague', 'America/Los_Angeles', 'Asia/Tokyo', 'UTC'];
const REGIONS = ['cs', 'en-US'];

/** A random stamp at most 10 days before `now`, in one of the R61 forms (never in the future). */
function stamp(r: R, doc: Mod, now: number, zone: string): string | null {
  const ms = now - r.below(10 * 24 * 60) * 60_000 - 60_000;
  const form = r.below(8);
  if (form === 0) return null;
  if (form === 1) return doc.localIso(ms, 'Europe/Prague');
  if (form === 2) return doc.localIso(ms, 'America/Los_Angeles');
  if (form === 3) return new Date(ms).toISOString().replace(/\.\d+Z$/, 'Z');
  if (form === 4) return String(doc.localIso(ms, zone)).slice(0, 19); // no offset: read in the machine zone (D-365)
  if (form === 5) return doc.localDate(ms, zone); // a date alone: local 00:00
  return r.pick(['zítra', '2026-13-45T25:00:00']);
}
type Gen = { files: Record<string, string>; members: Set<string> };
function vault(r: R, doc: Mod, now: number, zone: string): Gen {
  const files: Record<string, string> = {};
  const members = new Set<string>();
  const n = 1 + r.below(40);
  for (let i = 0; i < n; i++) {
    const [type, folder] = r.pick(TYPES);
    const title = r.pick(TITLES);
    const where = r.chance(8) ? `_templates/${folder}` : r.chance(8) ? `.trash/${folder}` : folder;
    const path = `${where}/${title} ${i}.md`.normalize('NFC');
    if (r.chance(6)) { files[path] = `Jen text ${i}.\n`; continue; } // no frontmatter: Page, never listed
    const review = r.pick(REVIEWS);
    const lines = ['---', `id: 01JB5B00000000000000PR${String(i).padStart(4, '0')}`, `type: ${r.pick(TYPE_SPELLINGS[type])}`, `title: ${title}`];
    if (review !== null) lines.push(`review: ${review}`);
    for (const k of ['captured', 'created', 'modified']) { const v = stamp(r, doc, now, zone); if (v !== null) lines.push(`${k}: ${v}`); }
    lines.push('---');
    files[path] = lines.join('\n') + '\n';
    const raw = review === null ? null : review.startsWith('[') ? null : review.replace(/^["']|["']$/g, '').trim();
    const member = !where.startsWith('_templates') && !where.startsWith('.trash') && (raw === 'unreviewed' || ((type === 'quick-note' || type === 'daily-note') && raw !== 'reviewed'));
    if (member) members.add(path);
  }
  return { files, members };
}

test('fr_syn_06_ac28_members_order_groups_and_counts_follow_r61', { timeout }, async () => {
  const doc = await load('@tegg/doc');
  const twin = await load('../ui/test/fake-inbox.ts');
  const b = await load('../ui/src/inbox/bucket.ts');
  assert.ok(doc && twin && b, '@tegg/doc, the fake-inbox twin and ui/src/inbox/bucket.ts load');
  for (const k of ['inboxInstant', 'inboxOrder', 'inboxGroups']) assert.equal(typeof b![k], 'function', `bucket.ts exports ${k}`);
  for (const seed of seeds) {
    console.log(`fr_syn_06_ac28 seed = ${seed}`);
    const r = rng(seed);
    for (let i = 0; i < runs; i++) {
      const zone = r.pick(ZONES);
      const region = r.pick(REGIONS);
      const now = Date.parse(`2026-10-${String(5 + r.below(16)).padStart(2, '0')}T${String(r.below(24)).padStart(2, '0')}:${String(r.below(60)).padStart(2, '0')}:00Z`);
      const g = vault(r, doc!, now, zone);
      const where = `seed ${seed} vault ${i} (${zone}, ${region}, ${new Date(now).toISOString()})`;
      const rows = (await twin!.inboxList(g.files)) as Row[];
      const listed = rows.map((x) => x.path);
      assert.deepEqual([...listed].sort(), [...g.members].sort(), `${where}: exactly the members, once each`);
      // R61 instant, order and groups, computed independently.
      const instant = (x: Row): number | null => {
        for (const v of [x.captured, x.created, x.modified]) {
          if (v === null) continue;
          const ms = doc!.parseInstant(v, zone) as number | null;
          if (ms !== null && !Number.isNaN(ms)) return ms;
        }
        return null;
      };
      const coll = new Intl.Collator(region, { sensitivity: 'base', numeric: true });
      const bytes = (s: string) => Buffer.from(s.normalize('NFC'));
      const want = [...rows].sort((x, y) => {
        const a = instant(x), c = instant(y);
        if (a !== null && c !== null && a !== c) return c - a;
        if (a === null && c !== null) return 1;
        if (a !== null && c === null) return -1;
        return coll.compare(x.title, y.title) || Buffer.compare(bytes(x.path), bytes(y.path));
      }).map((x) => x.path);
      for (const x of rows) assert.equal(b!.inboxInstant(x, zone), instant(x), `${where}: instant of ${x.path}`);
      const ordered = b!.inboxOrder(rows, zone, coll) as Row[];
      assert.deepEqual(ordered.map((x) => x.path), want, `${where}: order`);
      const today = doc!.localDate(now, zone) as string;
      const first = region === 'en-US' ? 7 : 1;
      const [y, m, d] = today.split('-').map(Number);
      const iso = ((new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7) + 1;
      const weekStart = doc!.addDays(today, -((iso - first + 7) % 7)) as string;
      const yesterday = doc!.addDays(today, -1) as string;
      const groupOf = (x: Row) => {
        const ms = instant(x);
        if (ms === null) return 'older';
        const day = doc!.localDate(ms, zone) as string;
        if (day === today) return 'today';
        if (day === yesterday) return 'yesterday';
        if (day >= weekStart && day < yesterday) return 'week';
        return 'older';
      };
      const got = b!.inboxGroups(ordered, today, first, zone) as Record<string, Row[]>;
      for (const k of ['today', 'yesterday', 'week', 'older']) {
        assert.deepEqual((got[k] ?? []).map((x) => x.path), want.filter((p) => groupOf(rows.find((x) => x.path === p)!) === k), `${where}: group ${k}`);
      }
      const counts: Record<string, number> = {};
      for (const x of rows) counts[x.type] = (counts[x.type] ?? 0) + 1;
      assert.equal(Object.values(counts).reduce((s, c) => s + c, 0), rows.length, `${where}: filter counts sum to the total`);
      const count = (await twin!.handle('inbox_count', {}, g.files, {}, [])) as { result: number };
      assert.equal(count.result, g.members.size, `${where}: the sidebar count equals the total`);
    }
  }
});
