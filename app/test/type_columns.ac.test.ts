// Configurable type-page columns, L1: the column model (app/ui/src/types/columns.ts; docs/contracts/type-columns.md §3)
// and the strings and palette commands (§4, catalog). docs/acceptance/type-columns.md R130, FR-TYP-09 AC-18 (model),
// AC-19 (choices), AC-20 (seeding, toggles), AC-21 (no limit), AC-22 (default sort rule), AC-23 (moves), AC-25
// (hand-written entries), AC-27 (e) (undefined types), AC-30 (clamping), AC-31 / AC-34 (palette, catalog); FR-TYP-11
// AC-4 (c) (fallback follows preview). BRD D-1240…D-1252. Inputs are `TypeDto`s of the synthetic types fixture
// (test/types-helpers.ts) with the new fields `columns`, `columnsIgnored`, `columnsUnreadable` (§2). Written from the ACs
// and the contract only (D-61). Modules load inside the tests, so a missing module is an assertion failure (TS-I1).
import { afterEach, test } from 'vitest';
import assert from 'node:assert/strict';
import { typeDto } from './types-helpers';

type Mod = Record<string, any>;
async function load(path: string): Promise<Mod | null> {
  try {
    return (await import(/* @vite-ignore */ path)) as Mod;
  } catch {
    return null;
  }
}
async function model(): Promise<Mod> {
  const m = await load('../ui/src/types/columns.ts');
  assert.ok(m, 'ui/src/types/columns.ts loads (contract §3)');
  for (const f of ['columnChoices', 'effectiveColumns', 'toggleColumn', 'moveColumn', 'dropColumn', 'defaultSort', 'clampWidth']) {
    assert.equal(typeof m![f], 'function', `columns.ts exports ${f}()`);
  }
  return m!;
}
afterEach(async () => {
  const cat = await load('../ui/src/i18n/catalog.ts');
  cat?.setCatalog?.(cat.en, 'en');
});

/** A fixture TypeDto with the §2 fields; `columns` null = the key is absent. */
function dto(key: string, o: { columns?: string[] | null; preview?: string[]; review?: 'off' | 'on' | 'locked'; ignored?: string[]; unreadable?: boolean } = {}): any {
  const t = typeDto(key);
  return {
    ...t,
    ...(o.preview ? { preview: o.preview } : {}),
    ...(o.review ? { review: o.review } : {}),
    columns: o.columns === undefined ? null : o.columns,
    columnsIgnored: o.ignored ?? [],
    columnsUnreadable: o.unreadable ?? false,
  };
}
const NFD_MISTO = 'místo';

// ------------------------------------------------------------------------------------------------ R130, FR-TYP-09 AC-18

test('fr_typ_09_ac18_effective_columns_come_from_columns_else_the_preview_fallback', async () => {
  const m = await model();
  assert.deepEqual(m.effectiveColumns(dto('schůzka', { columns: ['místo', 'datum'] })), ['místo', 'datum'], '(a) columns as written; no modified, no účastníci');
  assert.deepEqual(m.effectiveColumns(dto('schůzka')), ['datum', 'účastníci', 'modified'], '(b) no columns key: preview keys, then modified (FR-TYP-09 AC-2 today)');
  assert.deepEqual(m.effectiveColumns(dto('schůzka', { preview: ['účastníci'] })), ['účastníci', 'modified'], '(b) and FR-TYP-11 AC-4 (c): the fallback follows preview');
  assert.deepEqual(m.effectiveColumns(dto('schůzka', { columns: [] })), [], '(c) columns: [] is Title only');
  assert.deepEqual(m.effectiveColumns(dto('schůzka', { preview: ['datum', 'neznámý'] })), ['datum', 'modified'], 'R130: unknown preview keys are not shown columns');
  assert.deepEqual(m.effectiveColumns(dto('nápad', { preview: ['review', 'hodnocení', 'modified', 'created'] })), ['hodnocení', 'created', 'modified'],
    'R130: the fallback skips review and modified in preview, then appends modified');
  assert.deepEqual(m.effectiveColumns(null), ['modified'], 'AC-27 (e): an undefined type shows Title and Modified (§3)');
  assert.deepEqual(m.effectiveColumns(dto('projekt', { columns: ['web', 'tags', 'source', 'aliases', 'created', 'modified'] })), ['web', 'tags', 'source', 'aliases', 'created', 'modified'],
    'universal choices are columns too');
});

// ------------------------------------------------------------------------------------------------ FR-TYP-09 AC-19

test('fr_typ_09_ac19_column_choices_follow_r130', async () => {
  const m = await model();
  assert.deepEqual([...(m.UNIVERSAL_COLUMNS ?? [])], ['tags', 'source', 'aliases', 'review', 'created', 'modified'], 'UNIVERSAL_COLUMNS (§3)');
  assert.deepEqual(m.columnChoices(dto('schůzka')), ['datum', 'začátek', 'účastníci', 'projekt', 'místo', 'tags', 'source', 'aliases', 'created', 'modified'],
    'schůzka (review off): attributes in schema order, then Tags, Source, Aliases, Created, Modified; no Review');
  assert.deepEqual(m.columnChoices(dto('nápad')), ['hodnocení', 'tags', 'source', 'aliases', 'review', 'created', 'modified'], 'nápad (review on): Review between Aliases and Created');
  assert.ok((m.columnChoices(dto('quick-note')) as string[]).includes('review'), 'quick-note (locked): Review listed');
  assert.deepEqual(m.columnChoices(dto('task')), ['status', 'priority', 'due', 'completed', 'recurrence', 'tags', 'source', 'aliases', 'created', 'modified'],
    'task: the built-in attributes in schema order');
  for (const k of ['title', 'description', 'id', 'type', 'icon', 'cover', 'previous', 'file', 'import-id', 'captured']) {
    assert.ok(!(m.columnChoices(dto('schůzka')) as string[]).includes(k), `${k} is not a choice (AP-1140)`);
  }
});

// ------------------------------------------------------------------------------------------------ FR-TYP-09 AC-20, AC-21

test('fr_typ_09_ac20_toggles_seed_from_the_shown_columns_and_append', async () => {
  const m = await model();
  const s = dto('schůzka');
  assert.deepEqual(m.toggleColumn(s, 'místo', true), ['datum', 'účastníci', 'modified', 'místo'], '(a) seeded from the effective columns, the new key at the end (AP-1142)');
  const seeded = dto('schůzka', { columns: ['datum', 'účastníci', 'modified', 'místo'] });
  assert.deepEqual(m.toggleColumn(seeded, 'modified', false), ['datum', 'účastníci', 'místo'], '(b) unchecking Modified');
  const b = dto('schůzka', { columns: ['datum', 'účastníci', 'místo'] });
  const off = m.toggleColumn(b, 'místo', false);
  assert.deepEqual(off, ['datum', 'účastníci'], '(c) unchecking Místo');
  assert.deepEqual(m.toggleColumn(dto('schůzka', { columns: off }), 'místo', true), ['datum', 'účastníci', 'místo'], '(c) checking it again appends it');
  let all = dto('schůzka', { columns: ['datum', 'účastníci', 'místo'] });
  for (const k of ['datum', 'účastníci', 'místo']) all = dto('schůzka', { columns: m.toggleColumn(all, k, false) });
  assert.deepEqual(all.columns, [], '(c) unchecking every item gives []');
  assert.deepEqual(m.toggleColumn(dto('schůzka', { preview: ['datum', 'neznámý'] }), 'místo', true), ['datum', 'modified', 'místo'], '(e) unknown preview keys are not seeded');
  assert.deepEqual(m.toggleColumn(dto('nápad'), 'review', true), ['hodnocení', 'modified', 'review'], '(d) nápad: checking Review');
  assert.deepEqual(m.toggleColumn(dto('osoba'), 'firma', false), ['modified'], '(d) osoba: unchecking Firma');
});

test('fr_typ_09_ac21_checking_every_item_has_no_limit', async () => {
  const m = await model();
  let t = dto('projekt');
  let writes = 0;
  for (const k of m.columnChoices(t) as string[]) {
    if ((m.effectiveColumns(t) as string[]).includes(k)) continue;
    t = dto('projekt', { columns: m.toggleColumn(t, k, true) });
    writes++;
  }
  assert.equal(writes, 9, 'nine unchecked items in menu order');
  assert.deepEqual(t.columns, ['stav', 'období', 'modified', 'rozpočet', 'aktivní', 'oblasti', 'web', 'poznámka', 'tags', 'source', 'aliases', 'created'], '12 columns, no limit');
});

// ------------------------------------------------------------------------------------------------ FR-TYP-09 AC-22

test('fr_typ_09_ac22_default_sort_is_modified_descending_only_when_modified_is_shown', async () => {
  const m = await model();
  assert.deepEqual(m.defaultSort(['datum', 'účastníci', 'modified']), { column: 'modified', dir: 'desc' }, 'Modified shown: Modified descending');
  assert.deepEqual(m.defaultSort(['modified', 'datum']), { column: 'modified', dir: 'desc' }, 'wherever Modified is');
  assert.deepEqual(m.defaultSort(['datum', 'účastníci']), { column: 'title', dir: 'asc' }, 'Modified hidden: Title ascending (D-1246)');
  assert.deepEqual(m.defaultSort([]), { column: 'title', dir: 'asc' }, 'Title only');
});

// ------------------------------------------------------------------------------------------------ FR-TYP-09 AC-23

test('fr_typ_09_ac23_moving_and_dropping_columns', async () => {
  const m = await model();
  const t = dto('schůzka', { columns: ['datum', 'účastníci', 'modified', 'místo'] });
  assert.deepEqual(m.dropColumn(t, 'místo', 'datum'), ['místo', 'datum', 'účastníci', 'modified'], 'dropping Místo before Datum');
  assert.deepEqual(m.moveColumn(t, 'místo', -1), ['datum', 'účastníci', 'místo', 'modified'], '⌥← moves one place left');
  assert.deepEqual(m.moveColumn(t, 'datum', 1), ['účastníci', 'datum', 'modified', 'místo'], '⌥→ moves one place right');
  assert.equal(m.moveColumn(t, 'datum', -1), null, '⌥← on the first column after Title: nothing to write');
  assert.equal(m.moveColumn(t, 'místo', 1), null, '⌥→ on the last column: nothing to write');
  assert.equal(m.dropColumn(t, 'místo', 'title'), null, 'nothing can be dropped before Title');
  assert.equal(m.moveColumn(t, 'title', 1), null, 'Title can\'t be moved');
  assert.deepEqual(m.dropColumn(t, 'datum', null), ['účastníci', 'modified', 'místo', 'datum'], 'dropping at the end');
  assert.deepEqual(m.moveColumn(dto('schůzka'), 'modified', -1), ['datum', 'modified', 'účastníci'], 'on a type without columns, the first move seeds the key (AC-20)');
});

// ------------------------------------------------------------------------------------------------ FR-TYP-09 AC-25

test('fr_typ_09_ac25_hand_written_columns_in_the_model', async () => {
  const m = await model();
  const h = dto('schůzka', { columns: ['datum', 'neznámý', 'datum', 'title', 'místo'], ignored: ['neznámý'] });
  assert.deepEqual(m.effectiveColumns(h), ['datum', 'místo'], '(a) unknown key and title skipped, a repeat shown once at its first place');
  const withCreated = m.toggleColumn(h, 'created', true);
  assert.deepEqual(withCreated, ['datum', 'neznámý', 'datum', 'title', 'místo', 'created'], '(a) checking Created keeps every hand-written entry in place');
  assert.deepEqual(m.toggleColumn(dto('schůzka', { columns: withCreated, ignored: ['neznámý'] }), 'datum', false), ['neznámý', 'title', 'místo', 'created'],
    '(a) unchecking Datum removes every datum entry');
  assert.deepEqual(m.effectiveColumns(dto('schůzka', { columns: ['datum', NFD_MISTO] })), ['datum', 'místo'], '(b) an NFD entry matches Místo (NFC)');
  assert.deepEqual(m.effectiveColumns(dto('schůzka', { columns: null, unreadable: true })), ['datum', 'účastníci', 'modified'], '(d) an unreadable value shows the fallback columns');
  assert.deepEqual(m.effectiveColumns(dto('nápad', { columns: ['hodnocení', 'review'], review: 'off' })), ['hodnocení'], 'AC-26 (d): review is hidden while the workflow is off');
  assert.deepEqual(m.effectiveColumns(dto('nápad', { columns: ['hodnocení', 'review'], review: 'on' })), ['hodnocení', 'review'], 'and comes back when it is on');
});

// ------------------------------------------------------------------------------------------------ FR-TYP-09 AC-30

test('fr_typ_09_ac30_widths_are_clamped_per_r130', async () => {
  const m = await model();
  assert.deepEqual({ ...(m.WIDTH ?? {}) }, { default: 160, min: 80, max: 960, titleMin: 160, titleFill: 240 }, 'WIDTH (R130, D-1248)');
  const cases: [string, number, number][] = [
    ['datum', 260, 260], ['datum', 50, 80], ['datum', 80, 80], ['datum', 2000, 960], ['datum', 960, 960],
    ['title', 100, 160], ['title', 160, 160], ['title', 1200, 960], ['title', 400, 400],
  ];
  for (const [k, px, want] of cases) assert.equal(m.clampWidth(k, px), want, `clampWidth(${k}, ${px}) = ${want}`);
});

// ------------------------------------------------------------------------------------------------ FR-TYP-09 AC-31, AC-34

const T = (key: string, name: string, plural: string, system: boolean) => ({ key, name, plural, folder: plural, icon: 'file-text', color: 'gray', system, invalid: false });
const TYPES = [T('page', 'Page', 'Pages', true), T('task', 'Task', 'Tasks', true), T('schůzka', 'Schůzka', 'Schůzky', false)];
const VAULT = { name: 'Typy', path: '/tmp/Typy', placeholders: 0 };
const ctx = (route: Record<string, unknown> | null) => ({ vault: VAULT, types: TYPES, counts: { 'schůzka': 3, page: 5 }, ...(route ? { route } : {}) });
// The route shape for type routes isn't fixed by the contract; both field names are given (as types_registry.ac.test.ts).
const ROUTES = {
  type: { id: 'type/<type>', type: 'schůzka', key: 'schůzka', param: 'schůzka' },
  undefinedType: { id: 'type/<type>', type: 'recept', key: 'recept', param: 'recept' },
  note: { id: 'note/<path>', path: 'Schůzky/2026-10-07 Porada.md' },
  typeSettings: { id: 'type-settings/<type>', type: 'schůzka', key: 'schůzka', param: 'schůzka' },
};

test('fr_typ_09_ac31_palette_commands_on_type_routes', async () => {
  const cat = await load('../ui/src/i18n/catalog.ts');
  const cmd = await load('../ui/src/shell/commands.ts');
  assert.ok(cat && cmd, 'catalog and commands modules load');
  const ids = (route: Record<string, unknown>) => (cmd!.commands(ctx(route)) as any[]);
  const onType = ids(ROUTES.type);
  const choose = onType.find((c) => c.id === 'typePage.chooseColumns');
  const reset = onType.find((c) => c.id === 'typePage.resetWidths');
  assert.ok(choose, '`Choose columns…` (typePage.chooseColumns) on type/<key> of a defined type');
  assert.ok(reset, '`Reset column widths` (typePage.resetWidths) on type/<key>');
  assert.deepEqual([cat!.t(choose.title, choose.vars ?? {}), choose.section, choose.needsVault], ['Choose columns…', 'navigate', true], 'Choose columns…: section navigate');
  assert.deepEqual([cat!.t(reset.title, reset.vars ?? {}), reset.section, reset.needsVault], ['Reset column widths', 'navigate', true], 'Reset column widths: section navigate');
  const onUndefined = ids(ROUTES.undefinedType).map((c) => c.id);
  assert.ok(onUndefined.includes('typePage.resetWidths') && !onUndefined.includes('typePage.chooseColumns'), `undefined type: only Reset column widths (${onUndefined.filter((i) => i.startsWith('typePage.')).join(', ')})`);
  for (const r of [ROUTES.note, ROUTES.typeSettings]) {
    const list = ids(r).map((c) => c.id);
    assert.ok(!list.includes('typePage.chooseColumns') && !list.includes('typePage.resetWidths'), `not listed on ${r.id}`);
  }
});

const STRINGS: [string, string][] = [
  ['typePage.alwaysShown', 'Always shown'],
  ['typePage.resize', 'Resize {column}'],
  ['typePage.resetWidths', 'Reset column widths'],
  ['typePage.chooseColumns', 'Choose columns…'],
  ['typePage.columnsIgnored', 'Not a property of {type}, kept in the file: {keys}'],
  ['typePage.columnsUnreadable', 'The columns setting in {file} can\'t be read. Fix it in the file to change columns.'],
];

test('fr_typ_09_ac34_new_strings_come_from_the_catalog', async () => {
  const cat = await load('../ui/src/i18n/catalog.ts');
  assert.ok(cat, 'catalog loads');
  const en = cat!.en as Record<string, unknown>;
  const bad: string[] = [];
  for (const [key, text] of STRINGS) {
    if (!(key in en)) { bad.push(`${key}: missing`); continue; }
    const vars: Record<string, string> = {};
    for (const mm of text.matchAll(/\{(\w+)\}/g)) vars[mm[1]] = `«${mm[1]}»`;
    const want = text.replace(/\{(\w+)\}/g, (_, k: string) => vars[k]);
    const got = cat!.t(key, vars);
    if (got !== want) bad.push(`${key}: want ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
  }
  assert.deepEqual(bad, [], 'every new type-page string with its English text (§4)');
  for (const gone of ['typePage.columnLimit', 'typePage.columnLimitAdded']) assert.ok(!(gone in en), `${gone} is removed from the catalog (AC-21)`);
  const texts = Object.values(en).map((v) => (typeof v === 'string' ? v : JSON.stringify(v)));
  assert.ok(!texts.some((v) => v.includes('Up to 4 columns')), '`Up to 4 columns` appears nowhere in the catalog');
  assert.ok(texts.includes('Review'), 'the `Review` menu item text is a catalog string');
});
