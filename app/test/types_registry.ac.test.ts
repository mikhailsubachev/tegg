// MS3 slice 3D, L1: registries and catalog for types (R1/R3 changes, R13 commands, R10/R14 labels, plural counts).
// FR-TYP-01 AC-9 (catalog strings, plural messages, R13 in the palette registry), FR-UX-03 (every new action has a
// command), FR-TYP-02 AC-1 (R10 labels), FR-TYP-01 AC-4 (R14), FR-EDT-07 AC-5 (value error messages).
// Written from docs/acceptance/types.md (R1, R3, R4, R10, R13, R14) and docs/contracts/ms3-shell.md §14.3, §14.7 only
// (D-61). Modules load inside the tests (TS-I1).
import { beforeEach, test } from 'vitest';
import assert from 'node:assert/strict';
import { R1, R10, R13, R14_COLORS, R14_ICONS, RESERVED } from './shell-tables';

type Mod = Record<string, any>;
async function load(path: string): Promise<Mod | null> {
  try {
    return (await import(/* @vite-ignore */ path)) as Mod;
  } catch {
    return null;
  }
}
async function mods() {
  const reg = await load('../ui/src/shell/registry.ts');
  const cat = await load('../ui/src/i18n/catalog.ts');
  const cmd = await load('../ui/src/shell/commands.ts');
  assert.ok(reg && cat && cmd, 'shell registry, catalog and commands modules load');
  return { reg: reg!, cat: cat!, cmd: cmd! };
}
beforeEach(async () => {
  const cat = await load('../ui/src/i18n/catalog.ts');
  cat?.setCatalog?.(cat.en, 'en');
});

const T = (key: string, name: string, plural: string, system: boolean) => ({ key, name, plural, folder: plural, icon: 'file-text', color: 'gray', system, invalid: false });
const TYPES = [
  T('page', 'Page', 'Pages', true), T('task', 'Task', 'Tasks', true), T('quick-note', 'Quick Note', 'Quick Notes', true),
  T('daily-note', 'Daily Note', 'Daily Notes', true), T('tag', 'Tag', 'Tags', true), T('image', 'Image', 'Images', true), T('pdf', 'PDF', 'PDFs', true),
  T('schůzka', 'Schůzka', 'Schůzky', false), T('osoba', 'Osoba', 'Osoby', false),
];
const VAULT = { name: 'Typy', path: '/tmp/Typy', placeholders: 0 };
const ctx = (route: Record<string, unknown> | null) => ({ vault: VAULT, types: TYPES, counts: { 'schůzka': 3, osoba: 2, page: 5 }, ...(route ? { route } : {}) });
// The route shape for type routes isn't fixed by the contract (§14.7.1); both field names are given.
const ROUTES = {
  type: { id: 'type/<type>', type: 'schůzka', key: 'schůzka' },
  undefinedType: { id: 'type/<type>', type: 'recept', key: 'recept' },
  note: { id: 'note/<path>', path: 'Schůzky/2026-10-07 Porada.md' },
  search: { id: 'search' },
  typeSettings: { id: 'type-settings/<type>', type: 'schůzka', key: 'schůzka' },
};

test('fr_typ_01_ac9_r13_commands_are_registered_where_they_run', async () => {
  const { cat, cmd } = await mods();
  const present = (route: Record<string, unknown>) => new Set((cmd.commands(ctx(route)) as any[]).map((c) => c.id));
  const on: Record<string, Set<string>> = { type: present(ROUTES.type), undefinedType: present(ROUTES.undefinedType), note: present(ROUTES.note), search: present(ROUTES.search), typeSettings: present(ROUTES.typeSettings) };
  for (const row of R13) {
    const want: Record<string, boolean> = {
      type: row.on !== 'note', note: row.on === 'vault' || row.on === 'type+note' || row.on === 'note', search: row.on === 'vault',
      undefinedType: row.on === 'vault', typeSettings: row.on === 'vault',
    };
    for (const [where, should] of Object.entries(want)) assert.equal(on[where].has(row.id), should, `${row.id} on ${where}: ${should ? 'present' : 'absent'}`);
  }
  const list = cmd.commands(ctx(ROUTES.type)) as any[];
  for (const row of R13.filter((r) => r.on !== 'note')) {
    const c = list.find((x) => x.id === row.id);
    assert.ok(c, `${row.id} registered`);
    assert.equal(c.section, row.section, `${row.id}: section`);
    assert.equal(c.needsVault, true, `${row.id}: needsVault`);
    assert.ok(!c.shortcut, `${row.id}: no shortcut (D-234)`);
    assert.ok(c.title in cat.en, `${row.id}: title is a catalog key`);
    const shown = cat.t(c.title, c.vars ?? {});
    assert.equal(shown, row.id === 'type.newObject' ? 'New Schůzka' : row.title, `${row.id}: palette title`);
  }
  const note = cmd.commands(ctx(ROUTES.note)) as any[];
  for (const id of ['note.changeType', 'note.editProperties']) {
    const c = note.find((x) => x.id === id);
    assert.ok(c && !c.shortcut && c.needsVault === true && c.section === 'edit', `${id}`);
    assert.equal(cat.t(c.title), R13.find((r) => r.id === id)!.title);
  }
  const shortcuts = (list.filter((c) => c.shortcut).map((c) => c.shortcut) as string[]);
  for (const k of shortcuts) assert.ok(!RESERVED.includes(k));
});

test('fr_typ_01_ac9_r1_type_settings_route_is_built', async () => {
  const { reg } = await mods();
  const r = (reg.ROUTES as any[]).find((x) => x.id === 'type-settings/<type>');
  assert.equal(r?.status?.built, true, 'type-settings/<type> built (R1 changes)');
  assert.equal(R1.find((x) => x.id === 'type-settings/<type>')!.built, true, 'test table follows types.md R1');
  const ms3 = (reg.overdue('MS3') as string[]).join('\n');
  for (const id of ['type-settings/<type>', 'New type', 'Starter vault', 'Sort', 'Views']) assert.ok(!ms3.includes(id), `${id} is no longer TBD at MS3:\n${ms3}`);
});

test('fr_typ_01_ac9_r3_controls_added_in_3d', async () => {
  const { reg, cat } = await mods();
  const labels = (reg.DISABLED_CONTROLS as any[]).map((c) => (c.label in cat.en ? cat.t(c.label) : c.label));
  for (const l of ['Group', 'Add view', 'Move existing objects', 'Renaming keys', 'Change their type to…', 'Move them to the trash', 'New template']) {
    assert.ok(labels.includes(l), `R3 control ${l} registered: ${labels.join(' | ')}`);
  }
  for (const l of ['New type', 'Starter vault', 'Sort', 'Views']) assert.ok(!labels.includes(l), `${l} is built now`);
});

test('fr_typ_01_ac9_object_counts_use_plural_categories', async () => {
  const { cat } = await mods();
  assert.ok('typePage.count' in cat.en, 'catalog key typePage.count (§14.7.3)');
  assert.deepEqual([1, 3, 0].map((n) => cat.t('typePage.count', { count: n })), ['1 object', '3 objects', '0 objects']);
  cat.setCatalog({ ...cat.en, 'typePage.count': { one: '{count} objekt', few: '{count} objekty', other: '{count} objektů' } }, 'cs');
  assert.deepEqual([1, 3, 5].map((n) => cat.t('typePage.count', { count: n })), ['1 objekt', '3 objekty', '5 objektů']);
});

test('fr_typ_01_ac9_rule_and_error_messages_are_catalog_strings', async () => {
  const { cat } = await mods();
  const reasons = ['empty', 'forbiddenChar', 'keyTaken', 'keyTooLong', 'folderTaken', 'folderInvalid', 'reservedKey', 'attrKeyTaken', 'attrKeyInvalid', 'rangeCollision', 'optionEmpty', 'optionDuplicate', 'optionUsed', 'previewFull'];
  const missing = reasons.map((r) => `typeRule.${r}`).filter((k) => !(k in cat.en) || String(cat.t(k, { key: 'x', label: 'x', field: 'x' })).trim() === '');
  assert.deepEqual(missing, [], 'typeRule.<reason> messages');
  const kinds = ['NewerVersion', 'InvalidType', 'BuiltInChanged', 'ReviewLocked', 'SystemType', 'HasObjects', 'UnknownType', 'Rule'];
  assert.deepEqual(kinds.map((k) => `error.${k}`).filter((k) => !(k in cat.en)), [], 'error.<kind> messages');
  assert.equal(cat.t('typeRule.reservedKey', { key: 'source' }), '"source" is a built-in property', 'FR-TYP-03 AC-2 wording');
});

test('fr_edt_07_ac5_value_error_messages', async () => {
  const { cat } = await mods();
  const want: Record<string, string> = {
    'value.notNumber': 'Not a number',
    'value.timeNotExist': "This time doesn't exist in your time zone",
    'value.notUrl': 'Enter a web address starting with https:// or http://',
    'value.endBeforeStart': 'The end is before the start',
  };
  for (const [k, v] of Object.entries(want)) assert.equal(k in cat.en ? cat.t(k) : null, v, k);
  assert.ok('value.notEmail' in cat.en, 'value.notEmail');
});

test('fr_typ_02_ac1_attribute_type_labels_are_r10', async () => {
  const { cat } = await mods();
  const s = await load('../../packages/schema/src/index.ts');
  assert.ok(s, '@tegg/schema loads');
  assert.deepEqual((s!.ATTR_TYPES as any[]).map((t) => [t.type, t.label in cat.en ? cat.t(t.label) : null]), R10);
});

test('fr_typ_01_ac4_r14_colours_and_icons_have_catalog_labels', async () => {
  const { cat } = await mods();
  const s = await load('../../packages/schema/src/index.ts');
  assert.ok(s, '@tegg/schema loads');
  assert.deepEqual(s!.COLORS, R14_COLORS.map(([c]) => c));
  assert.deepEqual(s!.ICONS, R14_ICONS);
  const shown = Object.values(cat.en).map(String);
  for (const [, label] of R14_COLORS) assert.ok(shown.includes(label), `colour label ${label} in the catalog`);
  for (const l of ['Book', 'Open book']) assert.ok(shown.includes(l), `icon label ${l} in the catalog`);
});
