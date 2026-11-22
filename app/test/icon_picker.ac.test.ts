// Slice OC, L0 and L1: the icon data and the picker's pure parts (docs/contracts/v1-cards.md §5, §6.1, §7.7, §7.8):
// the bundled data file `packages/schema/data/lucide-0.460.0.json` and its generator, the aliases file, `Credits.rtf`
// (FR-TYP-01 AC-20 (a), L0), `icons/resolve.ts` (FR-TYP-01 AC-19), `icons/search.ts` (`searchIcons` against an oracle of
// AP-1597 written here over all 1,539 entries for 50 queries, FR-TYP-01 AC-15; `suggestIcons`, AC-14) and
// `icons/recent.ts` (`pushRecent`, FR-TYP-01 AC-18). Written from the ACs and the contract only (D-61). Modules and
// data load inside the tests (TS-I1).
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { REPO } from './cards-data';

type Mod = Record<string, any>;
async function load(path: string, what: string): Promise<Mod> {
  let m: Mod | null = null;
  try { m = (await import(/* @vite-ignore */ path)) as Mod; } catch { m = null; }
  assert.ok(m, `${what} loads (v1-cards §6.1)`);
  return m!;
}
const DATA = join(REPO, 'packages/schema/data/lucide-0.460.0.json');
const ALIASES = join(REPO, 'packages/schema/data/icon-aliases.json');
type IconData = { lucide: string; package: string; integrity: string; count: number; icons: Record<string, { n: [string, Record<string, string>][]; k: string[] }> };
function data(): IconData {
  assert.ok(existsSync(DATA), 'the bundled data file packages/schema/data/lucide-0.460.0.json exists (§5.1)');
  return JSON.parse(readFileSync(DATA, 'utf8'));
}
function aliases(): Record<string, string> {
  assert.ok(existsSync(ALIASES), 'packages/schema/data/icon-aliases.json exists (§5.3)');
  return JSON.parse(readFileSync(ALIASES, 'utf8'));
}
const R14 = ['file-text', 'check-square', 'zap', 'calendar', 'hash', 'image', 'file', 'book', 'book-open', 'lightbulb', 'users', 'user', 'folder', 'map', 'star', 'flag', 'bookmark',
  'briefcase', 'coffee', 'globe', 'graduation-cap', 'pen-line', 'utensils', 'plane'];

/** The IconSet the UI loads (`icons/load.ts` `loadIconSet`), or null. */
async function iconSet(): Promise<any> {
  const l = await load('../ui/src/icons/load.ts', 'ui/src/icons/load.ts');
  assert.equal(typeof l.loadIconSet, 'function', 'icons/load.ts exports loadIconSet (§5.5)');
  const set = await l.loadIconSet();
  assert.ok(set, 'loadIconSet resolves to the set');
  return set;
}

// ------------------------------------------------------------------------------------------------ the oracle (AP-1597, §7.7)

const fold = (s: string) => s.normalize('NFC').toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').normalize('NFC').trim().replace(/\s+/g, '-');
function oracle(d: IconData, al: Record<string, string>, query: string): { name: string; bold: [number, number] | null }[] {
  const q = fold(query);
  if (!q) return [];
  const names = Object.keys(d.icons).sort();
  const startsSegment = (n: string) => n.startsWith(q) || n.includes(`-${q}`);
  const g1 = names.filter(startsSegment);
  const g2 = names.filter((n) => !startsSegment(n) && n.includes(q));
  const kw = (n: string) => d.icons[n].k.some((k) => { const f = fold(k); return f.startsWith(q) || f.split('-').some((w) => w.startsWith(q)); });
  const g3 = names.filter((n) => !n.includes(q) && kw(n));
  const front = Object.entries(al).filter(([a]) => a === q || a.startsWith(q)).map(([, t]) => t).filter((t) => d.icons[t]);
  const first = [...new Set(front)];
  const group1 = [...first, ...g1.filter((n) => !first.includes(n))];
  const rest = [...g2, ...g3].filter((n) => !first.includes(n));
  const bold = (n: string): [number, number] | null => { const i = n.indexOf(q); return i < 0 ? null : [i, i + q.length]; };
  return [...group1.map((n) => ({ name: n, bold: bold(n) })), ...rest.map((n) => ({ name: n, bold: g3.includes(n) ? null : bold(n) }))];
}

// ------------------------------------------------------------------------------------------------ FR-TYP-01 AC-14

test('fr_typ_01_ac14_the_picker', async () => {
  const s = await load('../ui/src/icons/search.ts', 'ui/src/icons/search.ts');
  assert.equal(typeof s.suggestIcons, 'function', 'search.ts exports suggestIcons');
  const set = await iconSet();
  const map = s.suggestIcons(set, 'Map') as string[];
  assert.ok(map.includes('map') && map.includes('map-pin') && map.length <= 12, `Suggested for “Map” lists map and map-pin among at most 12: ${map}`);
  assert.deepEqual(s.suggestIcons(set, 'Náročnost'), [], 'no Suggested group for Náročnost (no name or keyword starts with it)');
  assert.deepEqual(s.suggestIcons(set, 'Výlet a ty'), [...new Set(s.suggestIcons(set, 'Výlet a ty') as string[])], 'no repeats; words under 3 letters ignored');
});

// ------------------------------------------------------------------------------------------------ FR-TYP-01 AC-15

const QUERIES = ['pin', 'MAP', ' map ', 'arrow-up', 'arrow up', 'čtverec', 'check-square', 'check', 'square', 'cal', 'calendar', 'book', 'user', 'users', 'file', 'file-text', 'folder',
  'star', 'heart', 'home', 'house', 'mail', 'phone', 'camera', 'image', 'music', 'cloud', 'sun', 'moon', 'tree', 'mountain', 'tent', 'map-pin', 'link', 'globe', 'flag',
  'bookmark', 'coffee', 'plane', 'car', 'bike', 'train', 'ship', 'zap', 'hash', 'tag', 'lock', 'key', 'search'];

test('fr_typ_01_ac15_search', async () => {
  const d = data();
  const al = aliases();
  // A keyword-only term: the first keyword (folded) that no name contains.
  const names = Object.keys(d.icons);
  const kwOnly = Object.values(d.icons).flatMap((x) => x.k).map(fold).find((k) => k.length >= 4 && !names.some((n) => n.includes(k)));
  assert.ok(kwOnly, 'the data has a keyword-only term');
  const queries = [...QUERIES, kwOnly!];
  assert.equal(queries.length, 50, '50 queries');
  const s = await load('../ui/src/icons/search.ts', 'ui/src/icons/search.ts');
  assert.equal(typeof s.searchIcons, 'function', 'search.ts exports searchIcons');
  const set = await iconSet();
  const bad: string[] = [];
  for (const q of queries) {
    const got = JSON.stringify(s.searchIcons(set, q));
    const want = JSON.stringify(oracle(d, al, q));
    if (got !== want) bad.push(`${JSON.stringify(q)}: got ${got.slice(0, 300)}\n want ${want.slice(0, 300)}`);
  }
  assert.deepEqual(bad, [], 'searchIcons equals AP-1597\'s rule over the bundled data');
  const pin = s.searchIcons(set, 'pin') as { name: string; bold: [number, number] | null }[];
  assert.deepEqual(pin.find((r) => r.name === 'map-pin')?.bold, [4, 7], 'map-<b>pin</b>');
  assert.equal(s.searchIcons(set, 'check-square')[0]?.name, 'square-check-big', 'an alias puts its target first');
  assert.deepEqual(s.searchIcons(set, 'čtverec'), [], 'čtverec: no match');
  assert.ok((s.searchIcons(set, kwOnly!) as any[]).every((r) => r.bold === null), 'a keyword-only result has nothing bold');
});

// ------------------------------------------------------------------------------------------------ FR-TYP-01 AC-18

test('fr_typ_01_ac18_recent_icons', async () => {
  const r = await load('../ui/src/icons/recent.ts', 'ui/src/icons/recent.ts');
  assert.equal(r.RECENT_MAX, 12, 'RECENT_MAX = 12');
  let list: string[] = [];
  for (const n of ['mountain', 'tent', 'mountain']) list = r.pushRecent(list, n);
  assert.deepEqual(list, ['mountain', 'tent'], 'newest first, no repeats');
  const many = Array.from({ length: 13 }, (_, i) => `icon-${i}`).reduce((l: string[], n) => r.pushRecent(l, n), []);
  assert.deepEqual(many, Array.from({ length: 12 }, (_, i) => `icon-${12 - i}`), 'the last 12, newest first');
});

// ------------------------------------------------------------------------------------------------ FR-TYP-01 AC-19

test('fr_typ_01_ac19_old_names_keep_drawing', async () => {
  const d = data();
  assert.deepEqual(aliases(), { 'check-square': 'square-check-big' }, 'the aliases file: check-square → square-check-big');
  const r = await load('../ui/src/icons/resolve.ts', 'ui/src/icons/resolve.ts');
  const set = await iconSet();
  const got = R14.map((n) => [n, r.resolveIcon(set, n)]);
  assert.deepEqual(got, R14.map((n) => [n, n === 'check-square' ? 'square-check-big' : n]), 'every R14 name resolves: 23 by name, check-square by the alias');
  assert.ok(R14.every((n) => (n === 'check-square' ? d.icons['square-check-big'] : d.icons[n])?.n.length > 0), 'each has paths in the data file');
  assert.equal(d.icons['check-square'], undefined, 'check-square isn\'t a Lucide 0.460 name');
  assert.equal(r.resolveIcon(set, 'neexistuje'), null, 'an unknown name: null');
});

// ------------------------------------------------------------------------------------------------ FR-TYP-01 AC-20 (L0)

function files(dir: string, re: RegExp): string[] {
  const out: string[] = [];
  for (const n of readdirSync(dir)) {
    if (n === 'node_modules' || n === 'target' || n === '.git' || n === '.verify' || n === 'test exports') continue;
    const p = join(dir, n);
    if (statSync(p).isDirectory()) out.push(...files(p, re));
    else if (re.test(n)) out.push(p);
  }
  return out;
}

test('fr_typ_01_ac20_bundled_offline_credited', () => {
  // (a) The data file: 1,539 unique ASCII names, each with paths and keywords, the version and the package recorded.
  const d = data();
  assert.deepEqual([d.lucide, d.package, d.count], ['0.460.0', 'lucide-static@0.460.0', 1539], 'version, package and count');
  const names = Object.keys(d.icons);
  assert.equal(names.length, 1539, '1,539 icons');
  assert.deepEqual(names.filter((n) => !/^[a-z0-9-]+$/.test(n)), [], 'names are ASCII');
  const tags = new Set(['path', 'circle', 'rect', 'polyline', 'line', 'polygon', 'ellipse']);
  assert.deepEqual(names.filter((n) => !Array.isArray(d.icons[n].n) || d.icons[n].n.length === 0 || d.icons[n].n.some(([t]) => !tags.has(t)) || !Array.isArray(d.icons[n].k)), [], 'each has a node of known tags and a keyword list');
  assert.ok(statSync(DATA).size < 2 * 1024 * 1024, 'under D-1963\'s 2 MiB');
  // The committed generator records the version and the integrity; lucide-static is no dependency.
  const gen = join(REPO, 'tools/icons/gen-lucide.mjs');
  assert.ok(existsSync(gen), 'tools/icons/gen-lucide.mjs exists (§5.2)');
  const g = readFileSync(gen, 'utf8');
  assert.ok(g.includes("'0.460.0'") && g.includes(d.integrity) && g.includes('lucide-static-0.460.0.tgz'), 'the script pins the version, tarball and integrity');
  const locks = files(REPO, /^(package-lock\.json|package\.json)$/).filter((p) => !p.includes('/test exports/'));
  assert.deepEqual(locks.filter((p) => /"(lucide-static|lucide|lucide-react)"\s*:/.test(readFileSync(p, 'utf8'))).map((p) => relative(REPO, p)), [], 'no Lucide package in any package.json or lockfile');
  // Only icons/lucide-icons.ts imports the data; no Lucide runtime package is imported by the UI; nothing imports the
  // chunk statically.
  const ui = files(join(REPO, 'app/ui/src'), /\.(ts|tsx)$/);
  const rel = (p: string) => relative(join(REPO, 'app/ui/src'), p);
  assert.deepEqual(ui.filter((p) => /lucide-0\.460\.0\.json/.test(readFileSync(p, 'utf8'))).map(rel), ['icons/lucide-icons.ts'], 'only icons/lucide-icons.ts imports the data file');
  assert.deepEqual(ui.filter((p) => /from\s+['"]lucide(-react|-static)?['"]/.test(readFileSync(p, 'utf8'))).map(rel), [], 'no Lucide runtime package');
  assert.deepEqual(ui.filter((p) => rel(p) !== 'icons/load.ts' && /from\s+['"][^'"]*lucide-icons['"]/.test(readFileSync(p, 'utf8'))).map(rel), [], 'nothing imports lucide-icons statically');
  assert.ok(/import\(\s*['"]\.\/lucide-icons(\.ts)?['"]\s*\)/.test(readFileSync(join(REPO, 'app/ui/src/icons/load.ts'), 'utf8')), 'icons/load.ts imports it dynamically');
  // (d) Credits.rtf holds the ISC licence and d3-force's (D-2000), and the bundle ships it.
  const credits = join(REPO, 'app/src-tauri/Credits.rtf');
  assert.ok(existsSync(credits), 'app/src-tauri/Credits.rtf exists (§5.6)');
  const rtf = readFileSync(credits, 'utf8');
  assert.ok(rtf.includes('Lucide 0.460.0') && /ISC License/.test(rtf) && /Copyright \(c\)/.test(rtf) && rtf.includes('d3-force'), 'the heading, the ISC licence text with its copyright line, d3-force');
  const conf = JSON.parse(readFileSync(join(REPO, 'app/src-tauri/tauri.conf.json'), 'utf8'));
  assert.equal(conf?.bundle?.macOS?.files?.['Resources/Credits.rtf'], './Credits.rtf', 'tauri.conf.json bundles Contents/Resources/Credits.rtf');
});
