// Slice Q, L1: the pure query model (app/ui/src/queries/model.ts, docs/contracts/v1-queries.md §4.2) for
// docs/acceptance/queries.md FR-QRY-01 AC-2 (the attribute list by types, R139), AC-3 (and / or on two levels: the
// model's validity of groups and connectors), AC-4 (the Limit field, 1…1000), FR-QRY-02 AC-1 (operators per kind in
// R139's order and labels; each written and read back as R139's YAML), FR-QRY-05 AC-3 (Columns: appended / removed),
// AC-4 (the mixed table's menu), AC-5 (one type → several drops type columns, `type` appended), FR-QRY-08 AC-1
// (`prefill` of the new-object footer, D-1439). Types are the fixture's (`tests/fixtures/vaults/queries/.tegg/types/` +
// new-empty's), read as `TypeDto`s by the fake core's type reader. Written from the ACs and the contract only (D-61). The
// model loads inside the tests (TS-I1).
//
// Red-test points: §4.2 names the functions but not every shape. The tests read `attributeGroups` as a list of groups
// with a label (catalog key or text) and items with `key` and `kind`, `operatorsFor` entries as `QueryOp` strings or
// objects with `op` (+ `value` for the checkbox pair) and a label key, `columnChoices` as keys or `{ key }`, `prefill`'s
// `host` as the host note's vault path and its `values` as `[key, value]` pairs.
import { afterEach, test } from 'vitest';
import assert from 'node:assert/strict';
import { listTypes } from '../ui/test/fake-schema';
import { queryCreateText, queryRead, type FilterItemDto, type QueryDefDto } from '../ui/test/fake-queries';
import { NOW, P, qfile, queriesVault } from './queries-data';

type Mod = Record<string, any>;
async function load(path: string): Promise<Mod | null> {
  try { return (await import(/* @vite-ignore */ path)) as Mod; } catch { return null; }
}
async function model(): Promise<Mod> {
  const m = await load('../ui/src/queries/model.ts');
  assert.ok(m, 'ui/src/queries/model.ts loads (contract §4.2)');
  for (const k of ['attributeGroups', 'operatorsFor', 'isValidRow', 'columnsAfterTypes', 'columnChoices', 'toggleColumn', 'prefill', 'parseLimit', 'defEquals']) {
    assert.equal(typeof m![k], 'function', `model.ts exports ${k}`);
  }
  return m!;
}
async function catalog(): Promise<Mod> {
  const c = await load('../ui/src/i18n/catalog.ts');
  assert.ok(c, 'catalog loads');
  return c!;
}
afterEach(async () => {
  const c = await load('../ui/src/i18n/catalog.ts');
  c?.setCatalog?.(c.en, 'en');
});

const files = queriesVault();
const TYPES = listTypes(files, {});
const typesOf = (...keys: string[]) => keys.map((k) => TYPES.find((t: any) => t.key === k)).filter(Boolean);
const def = (o: Partial<QueryDefDto>): QueryDefDto => ({ title: 'Dotaz', types: [], match: 'all', filters: [], sort: { by: 'modified', order: 'desc' }, limit: 50, view: 'list', columns: ['type', 'modified'], ...o });
const read = (name: string) => queryRead(files[qfile(name)], true, name).def;

/** A label as text: a catalog key through `t`, else the text itself. */
function text(cat: Mod, v: unknown): string {
  const s = String(v ?? '');
  return s in (cat.en as Record<string, unknown>) ? cat.t(s) : s;
}
type Group = { label: string; items: { key: string; kind: string; label: string }[] };
function groups(m: Mod, cat: Mod, chosen: string[]): Group[] {
  const g = m.attributeGroups(TYPES, chosen) as any[];
  assert.ok(Array.isArray(g), 'attributeGroups returns a list');
  return g.map((x) => ({
    label: text(cat, x.label ?? x.name ?? x.title ?? x.id),
    items: ((x.items ?? x.attributes ?? x.options ?? []) as any[]).map((i) => ({ key: String(i.key), kind: String(i.kind ?? ''), label: text(cat, i.label ?? i.name ?? i.key) })),
  }));
}
type OpEntry = { op: string; value?: unknown; label: string };
function ops(m: Mod, cat: Mod, kind: string): OpEntry[] {
  const l = m.operatorsFor(kind) as any[];
  assert.ok(Array.isArray(l), `operatorsFor(${kind}) returns a list`);
  return l.map((e) => (typeof e === 'string' ? { op: e, label: text(cat, `query.op.${e}`) } : { op: String(e.op ?? e.value ?? e.id), value: e.flag ?? e.checked ?? e.arg, label: text(cat, e.label ?? e.labelKey ?? e.title ?? `query.op.${e.op}`) }));
}

// ------------------------------------------------------------------------------------------------ FR-QRY-01 AC-2

test('fr_qry_01_ac2_attribute_list_by_types', async () => {
  const m = await model();
  const cat = await catalog();
  const task = groups(m, cat, ['task']);
  assert.deepEqual(task.map((g) => g.label), ['Links', 'Every object', 'Task'], 'Show Task: Links, Every object, Task');
  assert.deepEqual(task[0].items.map((i) => i.key), ['links_to', 'linked_from'], 'Links: Links to, Linked from');
  assert.deepEqual(task[0].items.map((i) => i.label), ['Links to', 'Linked from'], 'their labels');
  assert.deepEqual(task[1].items.map((i) => i.key), ['title', 'tags', 'created', 'modified', 'review', 'source', 'aliases'], 'Every object: Title, Tags, Created, Modified, Review, Source, Aliases');
  assert.deepEqual(task[2].items.map((i) => i.key), ['status', 'priority', 'due', 'completed'], 'Task: Status, Priority, Due date, Completed (schema order; recurrence isn\'t offered)');
  assert.deepEqual(task[2].items.map((i) => i.label), ['Status', 'Priority', 'Due date', 'Completed'], 'the attributes\' names');
  for (const g of task) for (const i of g.items) assert.ok(i.kind !== '', `${i.key} has its kind`);
  const kinds = Object.fromEntries(task.flatMap((g) => g.items).map((i) => [i.key, i.kind]));
  assert.notEqual(kinds.status, kinds.due, 'Status (select) and Due date (date) differ in kind');
  assert.notEqual(kinds.due, kinds.completed, 'Due date (date) and Completed (date-time) differ in kind');
  assert.equal(kinds.created, kinds.completed, 'Created and Completed are both date-time');
  assert.deepEqual(groups(m, cat, ['projekt', 'schůzka']).map((g) => g.label), ['Links', 'Every object'], 'Projekt and Schůzka share no attribute: no third group');
  assert.deepEqual(groups(m, cat, []).map((g) => g.label), ['Links', 'Every object'], 'no type: only the first two groups');
  const proj = groups(m, cat, ['projekt']);
  assert.deepEqual(proj[2]?.items.map((i) => i.key), ['stav', 'rozpočet', 'vlastník'], 'Projekt: its attributes in schema order');
  // A filter on an attribute that isn't one of every chosen type is broken (R139).
  const hod: FilterItemDto = { kind: 'filter', key: 'hodnocení', op: 'gt', value: 3, src: [0] };
  assert.equal(m.isValidRow(hod, typesOf('kniha')), 'notAttribute', 'hodnocení on Kniha: notAttribute');
  assert.equal(m.isValidRow({ kind: 'filter', key: 'přečteno', op: 'is', value: true, src: [1] }, typesOf('kniha')), null, 'přečteno is checked on Kniha: valid');
  assert.equal(m.isValidRow({ kind: 'filter', key: 'stav', op: 'is', value: 'Aktivní', src: null }, typesOf('projekt', 'schůzka')), 'notAttribute', 'stav with Projekt and Schůzka: not an attribute of every chosen type');
  assert.equal(m.isValidRow({ kind: 'filter', key: 'title', op: 'contains', value: 'mlok', src: null }, []), null, 'title with all types: valid');
});

// ------------------------------------------------------------------------------------------------ FR-QRY-02 AC-1

/** R139's rows: an attribute of the fixture per kind, the labels in order and a value for each operator. */
const R139: { what: string; type: string; key: string; labels: string[]; yaml: [string, unknown, string][] }[] = [
  { what: 'Text', type: 'osoba', key: 'firma', labels: ['is', 'is not', 'contains', 'is empty', 'is not empty'],
    yaml: [['is', 'Účetní s.r.o.', 'firma: Účetní s.r.o.'], ['is_not', 'ACME', 'firma: { is_not: ACME }'], ['contains', 'účetní', 'firma: { contains: účetní }'], ['is_empty', true, 'firma: { is_empty: true }'], ['is_not_empty', true, 'firma: { is_not_empty: true }']] },
  { what: 'Select', type: 'projekt', key: 'stav', labels: ['is', 'is not', 'is any of', 'is empty'],
    yaml: [['is', 'Aktivní', 'stav: Aktivní'], ['is_not', 'Hotovo', 'stav: { is_not: Hotovo }'], ['is_any_of', ['Hotovo', 'Pozastaveno'], 'stav: { is_any_of: [Hotovo, Pozastaveno] }'], ['is_empty', true, 'stav: { is_empty: true }']] },
  { what: 'Tags', type: 'task', key: 'tags', labels: ['has any of', 'has all of', 'has none of'],
    yaml: [['has_any_of', ['finance'], 'tags: { has_any_of: [finance] }'], ['has_all_of', ['finance', 'q4'], 'tags: { has_all_of: [finance, q4] }'], ['has_none_of', ['offsite', 'finance'], 'tags: { has_none_of: [offsite, finance] }']] },
  { what: 'Date', type: 'task', key: 'due', labels: ['is', 'before', 'after', 'between', 'today', 'this week', 'within next N days', 'overdue', 'is empty'],
    yaml: [['is', '2026-11-12', 'due: 2026-11-12'], ['before', '2026-11-12', 'due: { before: 2026-11-12 }'], ['after', '2026-11-12', 'due: { after: 2026-11-12 }'],
      ['between', ['2026-11-11', '2026-11-14'], 'due: { between: [2026-11-11, 2026-11-14] }'], ['today', true, 'due: { today: true }'], ['this_week', true, 'due: { this_week: true }'],
      ['within_next_days', 14, 'due: { within_next_days: 14 }'], ['overdue', true, 'due: { overdue: true }'], ['is_empty', true, 'due: { is_empty: true }']] },
  { what: 'Date-time', type: 'task', key: 'created', labels: ['is', 'before', 'after', 'between', 'today', 'this week', 'within next N days', 'overdue', 'is empty'],
    yaml: [['is', 'this', 'created: this'], ['today', true, 'created: { today: true }']] },
  { what: 'Number', type: 'projekt', key: 'rozpočet', labels: ['=', '≠', '<', '>', 'between'],
    yaml: [['eq', 5000, 'rozpočet: { eq: 5000 }'], ['ne', 5000, 'rozpočet: { ne: 5000 }'], ['lt', 5000, 'rozpočet: { lt: 5000 }'], ['gt', 5000, 'rozpočet: { gt: 5000 }'], ['between', [3000, 8000], 'rozpočet: { between: [3000, 8000] }']] },
  { what: 'Checkbox', type: 'kniha', key: 'přečteno', labels: ['is checked', 'is not checked'], yaml: [['is', true, 'přečteno: true'], ['is', false, 'přečteno: false']] },
  { what: 'Relation', type: 'projekt', key: 'vlastník', labels: ['links to', 'is empty', 'is not empty'],
    yaml: [['links_to', '[[Jana Nováková]]', 'vlastník: { links_to: "[[Jana Nováková]]" }'], ['is_empty', true, 'vlastník: { is_empty: true }'], ['is_not_empty', true, 'vlastník: { is_not_empty: true }']] },
  { what: 'source', type: 'task', key: 'source', labels: ['links to', 'is empty', 'is not empty'], yaml: [['links_to', 'this', 'source: { links_to: this }']] },
];

test('fr_qry_02_ac1_operators_per_kind', async () => {
  const m = await model();
  const cat = await catalog();
  for (const row of R139) {
    const item = groups(m, cat, [row.type]).flatMap((g) => g.items).find((i) => i.key === row.key);
    assert.ok(item, `${row.what}: ${row.key} is in the attribute list of ${row.type}`);
    assert.deepEqual(ops(m, cat, item!.kind).map((o) => o.label), row.labels, `${row.what} (${row.key}): R139's operators in order`);
    // Written and read back as R139's YAML (the core's create style, through the fake core's twin).
    for (const [op, value, line] of row.yaml) {
      const d = def({ types: [row.type], filters: [{ kind: 'filter', key: row.key, op: op as any, value, src: null }] });
      const t = queryCreateText(d, NOW);
      assert.ok(t.includes(`\n  - ${line}\n`), `${row.what} ${op}: written as \`- ${line}\``);
      const back = queryRead(t, true, 'Dotaz').def.filters[0] as any;
      assert.deepEqual([back.key, back.op, back.value], [row.key, op, value], `${row.what} ${op}: read back`);
    }
  }
  const links = groups(m, cat, ['task'])[0].items[0];
  assert.deepEqual(ops(m, cat, links.kind).map((o) => o.label), ['links to'], 'Links to: `links to`');
});

// ------------------------------------------------------------------------------------------------ FR-QRY-01 AC-3, AC-4

test('fr_qry_01_ac3_and_or_two_levels', async () => {
  const m = await model();
  const base = read('Úkoly z této schůzky');
  const notDone: FilterItemDto = { kind: 'filter', key: 'status', op: 'is_not', value: 'Done', src: null };
  const group: FilterItemDto = { kind: 'group', match: 'any', src: null, filters: [{ kind: 'filter', key: 'due', op: 'within_next_days', value: 14, src: null }, { kind: 'filter', key: 'priority', op: 'is', value: 'High', src: null }] };
  const two = { ...base, filters: [...base.filters, notDone, group] };
  assert.equal(m.defEquals(base, base), true, 'a definition equals itself');
  assert.equal(m.defEquals(base, two), false, 'adding a filter and a group is a change');
  assert.equal(m.defEquals(two, { ...two, match: 'any' }), false, 'switching the top connector to `or` is a change');
  assert.equal(m.defEquals(two, { ...two, filters: [...two.filters.slice(0, 2), { ...group, match: 'all' }] }), false, 'the group\'s own connector is a change');
  assert.equal(m.isValidRow(group, typesOf('task')), null, 'a group of valid rows is valid');
  const nested: FilterItemDto = { kind: 'group', match: 'any', src: null, filters: [group] };
  assert.equal(m.isValidRow(nested, typesOf('task')), 'nestedGroup', 'a group inside a group is broken (`Groups cannot hold groups`)');
  // Committing writes `match: any` and the group in R138's shape (the core's style, through the twin).
  const t = queryCreateText({ ...two, match: 'any' }, NOW);
  assert.ok(t.includes('match: any\nfilters:\n  - links_to: this\n  - status: { is_not: Done }\n  - group:\n      match: any\n      filters:\n        - due: { within_next_days: 14 }\n        - priority: High\n'), 'R138\'s shape for `match` and the group');
});

test('fr_qry_01_ac4_sort_and_limit', async () => {
  const m = await model();
  for (const [s, want] of [['1', 1], ['50', 50], ['1000', 1000], ['0', null], ['1001', null], ['abc', null], ['', null], ['-5', null], ['2.5', null]] as const) {
    assert.equal(m.parseLimit(s), want, `Limit ${JSON.stringify(s)} → ${want}`);
  }
});

// ------------------------------------------------------------------------------------------------ FR-QRY-05 AC-3…AC-5

const keysOf = (l: any[]) => l.map((x) => String(typeof x === 'string' ? x : x.key));

test('fr_qry_05_ac3_columns_menu_per_query', async () => {
  const m = await model();
  const d = read('Úkoly z této schůzky');
  assert.deepEqual(d.columns, ['status', 'priority', 'due', 'modified'], 'fixture columns');
  const choices = keysOf(m.columnChoices(d, TYPES));
  assert.deepEqual(choices.filter((k) => k !== 'title'), ['status', 'priority', 'due', 'completed', 'recurrence', 'tags', 'source', 'aliases', 'created', 'modified'],
    'one type: the type\'s attributes in schema order, Tags, Source, Aliases, Created, Modified (R130; Review only when on)');
  const on = m.toggleColumn(d, 'tags', true);
  assert.deepEqual(on, ['status', 'priority', 'due', 'modified', 'tags'], 'checking Tags appends it');
  const off = m.toggleColumn({ ...d, columns: on }, 'modified', false);
  assert.deepEqual(off, ['status', 'priority', 'due', 'tags'], 'unchecking Modified removes it');
});

test('fr_qry_05_ac4_mixed_types_table', async () => {
  const m = await model();
  const d = read('Vše, co sem odkazuje');
  assert.deepEqual(keysOf(m.columnChoices(d, TYPES)).filter((k) => k !== 'title'), ['type', 'tags', 'source', 'aliases', 'created', 'modified'], 'all types: Type, Tags, Source, Aliases, Created, Modified');
  const mixed = def({ types: ['task', 'schůzka'], view: 'table', columns: ['modified', 'type'] });
  assert.deepEqual(keysOf(m.columnChoices(mixed, TYPES)).filter((k) => k !== 'title'), ['type', 'tags', 'source', 'aliases', 'created', 'modified'], 'Task and Schůzka: the universal rows plus Type');
});

test('fr_qry_05_ac5_mixed_view_drops_type_columns', async () => {
  const m = await model();
  const cols = ['status', 'priority', 'due', 'modified'];
  assert.deepEqual(m.columnsAfterTypes(cols, ['task'], ['task', 'schůzka'], TYPES), ['modified', 'type'], 'one type → two: universal keys kept in order, `type` appended');
  assert.deepEqual(m.columnsAfterTypes(['modified', 'type'], ['task', 'schůzka'], ['task'], TYPES), ['modified', 'type'], 'two → one: unchanged (the dropped columns don\'t come back)');
  assert.deepEqual(m.columnsAfterTypes(['tags', 'due', 'created'], ['task'], [], TYPES), ['tags', 'created', 'type'], 'one type → all types: the same rule');
  assert.deepEqual(m.columnsAfterTypes(['type', 'tags', 'modified'], [], ['task', 'projekt'], TYPES), ['type', 'tags', 'modified'], 'mixed → mixed: unchanged, no second `type`');
});

// ------------------------------------------------------------------------------------------------ FR-QRY-08 AC-1

test('fr_qry_08_ac1_new_object_from_the_block', async () => {
  const m = await model();
  const open = read('Otevřené úkoly z této schůzky');
  const p = m.prefill(open, P.porada7);
  assert.ok(p, 'one type, `match: all`, a top-level `links_to: this`: a footer');
  assert.equal(p.type, 'task', 'its type: task');
  assert.deepEqual(p.values, [['source', '[[2026-10-07 Týdenní porada]]']], '`source` links the host; `status is not Done` and the group\'s `priority` aren\'t pre-filled');
  const withSelect = { ...open, filters: [...open.filters, { kind: 'filter', key: 'priority', op: 'is', value: 'High', src: null } as FilterItemDto] };
  assert.deepEqual(m.prefill(withSelect, P.porada7)?.values, [['source', '[[2026-10-07 Týdenní porada]]'], ['priority', 'High']], 'a top-level Select `is` is pre-filled too');
  assert.equal(m.prefill({ ...open, types: ['task', 'projekt'] }, P.porada7), null, 'several types: no footer');
  assert.equal(m.prefill({ ...open, types: [] }, P.porada7), null, 'no type: no footer');
  assert.equal(m.prefill({ ...open, match: 'any' }, P.porada7), null, '`match: any`: no footer');
  assert.deepEqual(m.prefill(read('Projekty v běhu'), P.prehled), { type: 'projekt', values: [['stav', 'Aktivní']] }, 'one type without `links_to: this`: the Select value only, no `source`');
});
