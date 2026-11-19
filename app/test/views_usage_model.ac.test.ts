// Slice Q2.1, L1: the pure usage model (docs/contracts/v1-views.md §18 `app/ui/src/views/usage.ts`, §19.3): docs/
// acceptance/views.md R194 (effective values: a usage's own valid value, else the query file's; an own value replaces
// the query's whole value), R197's routing as pure decisions (`scopeOf`, `canUseQuery` per D-1856), R198 (usage keys,
// NFC, `parseUsageKey`, `blockOrdinal`, the rename's `movedUsageState`). Criteria: FR-QRY-07 AC-23 (the model: a first
// change starts from the effective value and is written whole, D-1864), FR-QRY-05 AC-25 (the keys), FR-FMT-12 AC-13 (NFC
// keys), FR-QRY-01 AC-16 (broken own values fall back), FR-LNK-03 AC-25 (the rename moves R198's keys). Written from the
// ACs and the contract only (D-61). Modules load inside the tests (TS-I1).
import { test } from 'vitest';
import assert from 'node:assert/strict';

type Mod = Record<string, any>;
async function load(path: string): Promise<Mod | null> {
  try { return (await import(/* @vite-ignore */ path)) as Mod; } catch { return null; }
}
async function usage(): Promise<Mod> {
  const m = await load('../ui/src/views/usage.ts');
  assert.ok(m, 'ui/src/views/usage.ts loads (v1-views §18)');
  return m!;
}
type L = { by: string; order: 'asc' | 'desc' };
const S = (...xs: [string, 'asc' | 'desc'][]): L[] => xs.map(([by, order]) => ({ by, order }));
const NFD = (s: string) => s.normalize('NFD');
const CESTY_ID = '01JB5V00000000000000000030';
/** A QueryResultDto with the query file's def and an optional usage (§17.3). */
function result(def: { sort: L[]; columns: string[] }, u: null | { kind: 'tab' | 'block'; own: { sort: L[] | null; columns: string[] | null }; broken?: { key: string; reason: string }[]; sort: L[]; columns: string[] }) {
  return {
    def: { title: 'Přečtené 2026', types: ['book'], match: 'all', filters: [], limit: 50, view: 'table', groupBy: null, lanes: 'vertical', laneOrder: null, ...def },
    usage: u ? { ...u, broken: (u.broken ?? []).map((b) => ({ at: null, type: null, ...b })) } : null,
  };
}
const P26_DEF = { sort: S(['finished', 'desc'], ['rating', 'asc'], ['title', 'asc']), columns: ['author', 'rating', 'finished'] };

// ------------------------------------------------------------------------------------------------ FR-QRY-07 AC-23 (model)

test('fr_qry_07_ac23_tab_sort_is_its_own', async () => {
  const m = await usage();
  const sortMod = await load('../ui/src/queries/sort.ts');
  assert.ok(sortMod, 'setup: ui/src/queries/sort.ts loads');
  // Výborné knihy's tab without its own sort: the effective sort is the query's.
  const vyb = result({ sort: S(['title', 'asc']), columns: ['author', 'status', 'finished'] }, { kind: 'tab', own: { sort: null, columns: null }, sort: S(['title', 'asc']), columns: ['author', 'status', 'finished'] });
  assert.deepEqual(m.effectiveSort(vyb), S(['title', 'asc']), 'no own sort: the query\'s');
  // (a) ⇧-click on Finished starts from the effective value and is the whole own value.
  assert.deepEqual(sortMod!.headerClick(m.effectiveSort(vyb), 'finished', true), S(['title', 'asc'], ['finished', 'asc']), '(a) the own sort to write: title ↑, finished ↑');
  // The overlay's Přečtené 2026 tab: its own two levels replace the query's three (never merged).
  const p26 = result(P26_DEF, { kind: 'tab', own: { sort: S(['rating', 'asc'], ['title', 'asc']), columns: ['author', 'rating', 'finished', 'genres'] }, sort: S(['rating', 'asc'], ['title', 'asc']), columns: ['author', 'rating', 'finished', 'genres'] });
  assert.deepEqual(m.effectiveSort(p26), S(['rating', 'asc'], ['title', 'asc']), 'own sort first');
  assert.deepEqual(m.effectiveColumns(p26), ['author', 'rating', 'finished', 'genres'], 'own columns first');
  assert.deepEqual(sortMod!.headerClick(m.effectiveSort(p26), 'finished', false), S(['finished', 'asc']), 'a click on Finished: `sort: { by: finished, order: asc }`');
  // The query page has no usage: the def's values, scope `default`, no `Use the query's …`.
  const page = result(P26_DEF, null);
  assert.deepEqual([m.effectiveSort(page), m.effectiveColumns(page)], [P26_DEF.sort, P26_DEF.columns], 'query/<name>: the def');
  assert.deepEqual([m.scopeOf({ kind: 'tab', typeKey: 'book', name: 'Výborné knihy' }), m.scopeOf({ kind: 'block', note: { id: CESTY_ID, path: 'Pages/Knihy na cesty.md' }, name: 'Přečtené 2026', n: 1, editable: true }), m.scopeOf({ kind: 'page', name: 'Přečtené 2026' })],
    ['tab', 'block', 'default'], 'scopeOf: tab, block, default (R197 scope lines)');
  // `Use the query's …` is offered when the usage has the key, valid or broken (D-1856), never on the page.
  assert.deepEqual([m.canUseQuery(p26, 'sort'), m.canUseQuery(p26, 'columns')], [true, true], 'own sort and columns: both offered');
  assert.deepEqual([m.canUseQuery(vyb, 'sort'), m.canUseQuery(vyb, 'columns')], [false, false], 'none: neither');
  const broken = result(P26_DEF, { kind: 'tab', own: { sort: null, columns: null }, broken: [{ key: 'sort', reason: 'badValue' }], sort: P26_DEF.sort, columns: P26_DEF.columns });
  assert.deepEqual([m.canUseQuery(broken, 'sort'), m.canUseQuery(broken, 'columns')], [true, false], 'a broken own sort: `Use the query\'s sort` is offered (D-1856)');
  assert.equal(m.canUseQuery(page, 'sort'), false, 'never on query/<name>');
  // An own value equal to the query's stays own (AP-1522): ownOf reports it.
  const equal = result({ sort: S(['title', 'asc']), columns: ['author'] }, { kind: 'tab', own: { sort: S(['title', 'asc']), columns: null }, sort: S(['title', 'asc']), columns: ['author'] });
  assert.deepEqual(m.ownOf(equal)?.sort ?? null, S(['title', 'asc']), 'an own sort equal to the query\'s is still own');
  assert.equal(m.ownOf(page) ?? null, null, 'query/<name>: no own values');
});

// ------------------------------------------------------------------------------------------------ FR-QRY-01 AC-16 (model)

test('fr_qry_01_ac16_effective_and_broken_usage_values', async () => {
  const m = await usage();
  // Block 4: a broken own sort; the run gives the query's sort as effective and a broken entry.
  const b4 = result({ sort: S(['title', 'asc']), columns: ['author', 'status', 'finished'] }, { kind: 'block', own: { sort: null, columns: null }, broken: [{ key: 'sort', reason: 'badValue' }], sort: S(['title', 'asc']), columns: ['author', 'status', 'finished'] });
  assert.deepEqual(m.effectiveSort(b4), S(['title', 'asc']), 'block 4: the query\'s sort');
  // `sort: []` is a valid own value (zero levels, D-1806), not "absent".
  const empty = result(P26_DEF, { kind: 'block', own: { sort: [], columns: null }, sort: [], columns: P26_DEF.columns });
  assert.deepEqual(m.effectiveSort(empty), [], '`sort: []`: zero levels');
  assert.equal(m.canUseQuery(empty, 'sort'), true, 'and it is an own value');
  // Unknown own column keys stay in the effective list (the UI shows only real columns, R138).
  const unk = result(P26_DEF, { kind: 'block', own: { sort: null, columns: ['neznámý', 'author'] }, sort: P26_DEF.sort, columns: ['neznámý', 'author'] });
  assert.deepEqual(m.effectiveColumns(unk), ['neznámý', 'author'], 'own columns as the run gives them');
});

// ------------------------------------------------------------------------------------------------ FR-QRY-05 AC-25 (keys)

test('fr_qry_05_ac25_widths_per_usage', async () => {
  const m = await usage();
  const block = (n: number, id: string | null = CESTY_ID, path = 'Pages/Knihy na cesty.md', name = 'Přečtené 2026') => ({ kind: 'block', note: { id, path }, name, n, editable: true });
  assert.equal(m.usageKey({ kind: 'tab', typeKey: 'book', name: 'Přečtené 2026' }), 'tab:book/přečtené 2026', 'a tab');
  assert.equal(m.usageKey(block(2)), `block:id:${CESTY_ID}/přečtené 2026#2`, 'a block of a note with id');
  assert.equal(m.usageKey(block(1, null, 'Pages/Čtení 2026.md')), 'block:path:Pages/Čtení 2026.md/přečtené 2026#1', 'a note without id: its path');
  assert.equal(m.usageKey({ kind: 'page', name: 'Přečtené 2026' }), 'page:přečtené 2026', 'the query page');
  // parseUsageKey reads the kind and the name key (a block's between the last `/` and the final `#<digits>`).
  for (const [key, kind, nameKey] of [
    ['tab:book/přečtené 2026', 'tab', 'přečtené 2026'], [`block:id:${CESTY_ID}/přečtené 2026#2`, 'block', 'přečtené 2026'],
    ['block:path:Pages/Cesty/Knihy na cesty.md/výborné knihy#12', 'block', 'výborné knihy'], ['page:podle žánru', 'page', 'podle žánru'],
  ] as const) {
    const p = m.parseUsageKey(key);
    assert.equal(p?.kind ?? null, kind, `parseUsageKey(${key}).kind`);
    assert.equal(p?.nameKey ?? p?.name ?? null, nameKey, `parseUsageKey(${key}): the name key`);
  }
  for (const bad of ['Přečtené 2026', 'tab:book', 'block:id:x/přečtené 2026', 'other:x']) assert.equal(m.parseUsageKey(bad), null, `parseUsageKey(${JSON.stringify(bad)}) = null`);
  // n: the 1-based place among the note's fences of the same query (name key), document order; null = inline / draft.
  const names = ['Přečtené 2026', 'Přečtené 2026', 'Rozečtené', 'Výborné knihy', null, 'výborné knihy'];
  assert.deepEqual([0, 1, 2, 3, 5].map((i) => m.blockOrdinal(names, i)), [1, 2, 1, 1, 2], 'blockOrdinal per name key');
  // Moving block 3 (another query) above block 1 keeps block 2's ordinal.
  assert.equal(m.blockOrdinal(['Rozečtené', 'Přečtené 2026', 'Přečtené 2026'], 2), 2, 'a block of another query moved above: same n');
});

// ------------------------------------------------------------------------------------------------ FR-FMT-12 AC-13 (keys)

test('fr_fmt_12_ac13_usage_settings_are_nfc', async () => {
  const m = await usage();
  const nfc = m.usageKey({ kind: 'block', note: { id: CESTY_ID, path: 'Pages/Knihy na cesty.md' }, name: 'Přečtené 2026', n: 2, editable: true });
  const nfd = m.usageKey({ kind: 'block', note: { id: CESTY_ID, path: 'Pages/Knihy na cesty.md' }, name: NFD('Přečtené 2026'), n: 2, editable: true });
  assert.equal(nfd, nfc, 'an NFD name gives the NFC key (one width entry)');
  assert.equal(nfc, nfc.normalize('NFC'), 'keys are NFC');
  assert.equal(m.usageKey({ kind: 'tab', typeKey: 'book', name: NFD('PŘEČTENÉ 2026') }), 'tab:book/přečtené 2026', 'name key: NFC, lower case');
  assert.equal(m.usageKey({ kind: 'block', note: { id: null, path: NFD('Pages/Čtení 2026.md') }, name: 'Přečtené 2026', n: 1, editable: true }), 'block:path:Pages/Čtení 2026.md/přečtené 2026#1', 'path NFC');
  assert.equal(m.blockOrdinal(['Přečtené 2026', NFD('Přečtené 2026')], 1), 2, 'NFD and NFC spellings are one query');
});

// ------------------------------------------------------------------------------------------------ FR-LNK-03 AC-25 (keys move)

test('fr_lnk_03_ac25_rename_keeps_usage_settings', async () => {
  const m = await usage();
  const ui = {
    version: 1, theme: 'light',
    typeViews: { lastTab: { book: 'Přečtené 2026', autor: null } },
    usageColumnWidths: {
      'tab:book/přečtené 2026': { title: 300 }, [`block:id:${CESTY_ID}/přečtené 2026#1`]: { title: 200 }, 'page:přečtené 2026': { author: 180 },
      'tab:book/výborné knihy': { title: 240 },
    },
    usageFolded: { 'tab:book/přečtené 2026': ['option:Román'], 'page:podle žánru': ['option:Poezie'] },
    queryColumnWidths: { 'Přečtené 2026': { title: 200 } }, boardFolded: { 'Podle žánru': ['option:Román'] },
  };
  const out = m.movedUsageState(ui, 'Přečtené 2026', 'Přečtené letos');
  assert.deepEqual(out.usageColumnWidths, {
    'tab:book/přečtené letos': { title: 300 }, [`block:id:${CESTY_ID}/přečtené letos#1`]: { title: 200 }, 'page:přečtené letos': { author: 180 },
    'tab:book/výborné knihy': { title: 240 },
  }, 'every usage key of the old name moves; others stay');
  assert.deepEqual(out.usageFolded, { 'tab:book/přečtené letos': ['option:Román'], 'page:podle žánru': ['option:Poezie'] }, 'folds too');
  assert.deepEqual(out.typeViews, { lastTab: { book: 'Přečtené letos', autor: null } }, 'typeViews.lastTab follows');
  assert.deepEqual([out.queryColumnWidths, out.boardFolded], [ui.queryColumnWidths, ui.boardFolded], '0.4.0 keys untouched (FR-STO-07 AC-11)');
  assert.deepEqual(m.movedUsageState(out, 'Přečtené letos', 'Přečtené 2026').usageColumnWidths, ui.usageColumnWidths, 'the Undo moves them back');
  assert.deepEqual(m.movedUsageState(ui, NFD('přečtené 2026'), 'Přečtené letos').usageColumnWidths, out.usageColumnWidths, 'by name key: case and NFD');
});
