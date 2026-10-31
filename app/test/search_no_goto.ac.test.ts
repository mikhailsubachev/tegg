// Search without `Go to` (preview v0.109 feedback; D-1340, D-1343), L1: the catalog part of docs/acceptance/
// search-navigation.md FR-NAV-01 AC-23 (NFR-OTH-02): `Create “{query}”`, `as…` and `No matches. Create “{query}”?` are
// catalog keys, and the `Go to` list's strings are gone. Keys from docs/contracts/v1-search.md §9.2 (`search.create`,
// `search.createAs`, `search.noMatchCreate`; removed: the `Go to` list's keys, the palette's `cmd.goto.*` stay).
// Written from the AC and the contract only (D-61). Modules load inside the tests (TS-I1).
import { afterEach, test } from 'vitest';
import assert from 'node:assert/strict';

type Mod = Record<string, any>;
async function load(path: string): Promise<Mod | null> {
  try {
    return (await import(/* @vite-ignore */ path)) as Mod;
  } catch {
    return null;
  }
}
async function catalog(): Promise<Mod> {
  const cat = await load('../ui/src/i18n/catalog.ts');
  assert.ok(cat && typeof cat.t === 'function' && typeof cat.setCatalog === 'function' && cat.en, 'ui/src/i18n/catalog.ts');
  return cat!;
}
afterEach(async () => {
  const cat = await load('../ui/src/i18n/catalog.ts');
  cat?.setCatalog?.(cat.en, 'en');
});

const STRINGS: [string, Record<string, string>, string][] = [
  ['search.create', { q: 'cteni' }, 'Create “cteni”'],
  ['search.createAs', {}, 'as…'],
  ['search.noMatchCreate', { q: 'borůvkový koláč' }, 'No matches. Create “borůvkový koláč”?'],
];

test('fr_nav_01_ac23_create_strings_are_catalog_keys', async () => {
  const cat = await catalog();
  const bad: string[] = [];
  for (const [key, vars, want] of STRINGS) {
    if (!(key in cat.en)) { bad.push(`${key}: missing`); continue; }
    const got = cat.t(key, vars);
    if (got !== want) bad.push(`${key}: want ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
  }
  assert.deepEqual(bad, [], 'v1-search §9.2 keys with the AC texts');
});

test('fr_nav_01_ac23_create_strings_follow_the_catalog', async () => {
  const cat = await catalog();
  assert.ok(typeof cat.pseudo === 'function', 'the pseudo-locale helper of the catalog');
  cat.setCatalog(cat.pseudo(cat.en), 'en');
  const got = STRINGS.map(([key, vars]) => [key, String(cat.t(key, vars))]);
  const bad = got.filter(([, v]) => !/^⟦.*⟧$/.test(v));
  assert.deepEqual(bad, [], 'the create strings come from the catalog (pseudo-locale wraps them in ⟦⟧)');
  const q = got.map(([, v]) => v);
  assert.ok(q[0].includes('cteni') && q[2].includes('borůvkový koláč'), `the query is a variable, not part of the text: ${q.join(' | ')}`);
});

test('fr_nav_01_ac23_the_go_to_strings_are_gone', async () => {
  const cat = await catalog();
  const keys = Object.keys(cat.en);
  assert.deepEqual(keys.filter((k) => /^goto\./.test(k)), [], 'no `goto.*` keys (the Search page\'s Go to list) in the catalog');
  assert.deepEqual(keys.filter((k) => String(cat.en[k]).trim() === 'Go to'), [], 'no catalog string `Go to`');
  assert.ok(keys.some((k) => /^cmd\.goto\./.test(k)), 'the palette\'s cmd.goto.* commands stay');
});
