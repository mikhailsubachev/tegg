// Slice G3, L1: the preset model of a graph view (app/ui/src/graph/presets.ts; docs/contracts/v1-graph.md §16.3) and
// the fake core's TypeScript twin of the `graph.yml` parser and patcher (app/ui/test/fake-presets.ts, §16.6) against
// tests/fixtures/graph-presets/ and expected/ (the same files crates/tegg-core/tests/ac_graph_presets.rs reads):
// docs/acceptance/graph.md part two, R118, R119; FR-GRP-02 AC-13 (`· modified` as NFC sets, AP-929), AC-14 (name
// validation, AP-928; the created file), AC-15, AC-16, AC-17 (Default is never stored), AC-20, AC-21, AC-22 (the stored
// name matches NFC and case-insensitively; a dangling name reads as Default, AP-930), FR-FMT-07 AC-27, FR-FMT-12 AC-7
// (matching doesn't depend on the region). Written from the ACs, the fixtures and the contract only (D-61). Modules load
// inside the tests and every call goes through `run`, so a missing or throwing stub is an AssertionError (TS-I1).
import { afterEach, test } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { GraphPresetDto, GraphViewStateDto, PresetOpDto } from '../ui/src/graph/types';

type Mod = Record<string, any>;
async function load(path: string): Promise<Mod | null> {
  try {
    return (await import(/* @vite-ignore */ path)) as Mod;
  } catch {
    return null;
  }
}
async function presets(): Promise<Mod> {
  const m = await load('../ui/src/graph/presets.ts');
  assert.ok(m, 'ui/src/graph/presets.ts loads');
  return m!;
}
async function twin(): Promise<Mod> {
  const m = await load('../ui/test/fake-presets.ts');
  assert.ok(m, 'ui/test/fake-presets.ts loads');
  return m!;
}
/** Calls `f` and turns a throw into an AssertionError naming `what`. */
function run<T>(what: string, f: () => T): T {
  try {
    return f();
  } catch (e) {
    assert.fail(`${what} threw: ${(e as Error)?.message ?? e}`);
  }
}
afterEach(async () => {
  const c = await load('../ui/src/i18n/collate.ts');
  c?.setCollationLocale?.('en-US');
});

const FX = resolve(import.meta.dirname, '../../tests/fixtures/graph-presets');
const fx = (name: string) => readFileSync(join(FX, name), 'utf8');
const nfc = (s: string) => s.normalize('NFC');
const nfd = (s: string) => s.normalize('NFD');
const crlf = (s: string) => s.replace(/\n/g, '\r\n');
/** The graph vault's D-977 type order (fixture README). */
const ORDER = ['page', 'task', 'quick-note', 'daily-note', 'cesta', 'osoba', 'projekt', 'schůzka', 'image', 'pdf', 'tag', 'recept'];
const P = (name: string, hiddenTypes: string[] = [], hiddenKinds: string[] = []): GraphPresetDto => ({ name: nfc(name), hiddenTypes, hiddenKinds });
const VALID: GraphPresetDto[] = [
  P('Bez štítků', ['tag', 'kniha']),
  P('Jen vztahy', [], ['link', 'embed', 'tag']),
  P('Lidé a schůzky', ['page', 'task', 'quick-note', 'daily-note', 'cesta', 'projekt', 'image', 'pdf', 'tag', 'recept']),
];
const lines = (s: string) => s.split('\n');
const setLine = (s: string, n: number, v: string | null) => { const l = lines(s); if (v === null) l.splice(n - 1, 1); else l[n - 1] = v; return l.join('\n'); };
const cut = (s: string, from: number, to: number) => { const l = lines(s); l.splice(from - 1, to - from + 1); return l.join('\n'); };

/** The twin's next text after `op`, asserting it isn't a refusal. */
async function patched(text: string | null, op: PresetOpDto): Promise<string> {
  const t = await twin();
  const r = run(`presetsPatch ${JSON.stringify(op)}`, () => t.presetsPatch(text, op, ORDER));
  assert.ok(r && typeof r.text === 'string', `presetsPatch ${JSON.stringify(op)} gives a text: ${JSON.stringify(r)}`);
  return r.text as string;
}
async function refusal(text: string | null, op: PresetOpDto): Promise<unknown> {
  const t = await twin();
  const r = run(`presetsPatch ${JSON.stringify(op)}`, () => t.presetsPatch(text, op, ORDER));
  assert.ok(r && r.error, `presetsPatch ${JSON.stringify(op)} is refused: ${JSON.stringify(r)}`);
  return { kind: r.error.kind, ...(r.error.existing ? { existing: r.error.existing } : {}) };
}

// ------------------------------------------------------------------------------------------------ FR-GRP-02 AC-13

test('fr_grp_02_ac13_modified_update_and_revert', async () => {
  const m = await presets();
  const bez = VALID[0];
  const applied = run('applyPreset', () => m.applyPreset({ depth: 1, sizeByLinks: true }, bez)) as GraphViewStateDto;
  assert.deepEqual(applied, { depth: 1, sizeByLinks: true, hiddenTypes: ['tag', 'kniha'], hiddenKinds: [], preset: 'Bez štítků' }, 'applying sets this view\'s filters and its preset; depth and size stay');
  const mod = (v: GraphViewStateDto, p: GraphPresetDto | null) => run('isModified', () => m.isModified(v, p)) as boolean;
  assert.equal(mod(applied, bez), false, 'just applied: not modified');
  assert.equal(mod({ ...applied, hiddenTypes: ['kniha'] }, bez), true, 'ticking Tags: modified');
  assert.equal(mod({ ...applied, hiddenTypes: ['kniha', 'tag'] }, bez), false, 'sets: the order doesn\'t matter');
  assert.equal(mod({ ...applied, hiddenTypes: ['tag'] }, bez), true, 'the unknown key `kniha` counts (D-907)');
  assert.equal(mod({ hiddenTypes: [nfd('schůzka')], hiddenKinds: [] }, P('X', ['schůzka'])), false, 'keys compare as NFC');
  assert.equal(mod({ ...applied, depth: 3, sizeByLinks: false, view: 'list' }, bez), false, 'depth, size and the view never count');
  assert.equal(mod({ hiddenTypes: ['tag'], hiddenKinds: [] }, null), true, 'Default with Tags hidden: modified');
  assert.equal(mod({}, null), false, 'Default with nothing hidden: not modified');
  assert.equal(mod({ hiddenKinds: ['backlink'] as any }, null), true, 'unknown kinds count too');
  assert.equal(await patched(fx('valid.yml'), { op: 'update', name: 'Bez štítků', hiddenTypes: ['kniha'], hiddenKinds: [] }), fx('expected/valid-after-update.yml'),
    'the twin\'s Update gives expected/valid-after-update.yml');
});

// ------------------------------------------------------------------------------------------------ FR-GRP-02 AC-14

test('fr_grp_02_ac14_save_as_new_creates_the_file_once', async () => {
  const m = await presets();
  const v = (name: string, renaming?: string) => run(`validateName(${JSON.stringify(name)})`, () => m.validateName(name, VALID, renaming));
  const taken = { kind: 'NameTaken', existing: 'Bez štítků' };
  assert.deepEqual(v('bez ŠTÍTKŮ'), taken, 'case-insensitive');
  assert.deepEqual(v(' Bez štítků '), taken, 'trimmed');
  assert.deepEqual(v('Default'), { kind: 'NameTaken', existing: 'Default' }, 'Default is taken');
  assert.deepEqual(v('default'), { kind: 'NameTaken', existing: 'Default' }, 'in any case');
  assert.deepEqual(v(''), { kind: 'NameEmpty' }, 'empty');
  assert.deepEqual(v('   '), { kind: 'NameEmpty' }, 'blank after trimming');
  assert.deepEqual(v('ř'.repeat(101)), { kind: 'NameTooLong' }, '101 characters');
  assert.equal(v('ř'.repeat(100)), null, '100 characters (Unicode scalar values, not bytes) are allowed');
  assert.deepEqual(v('Lidé\tporady'), { kind: 'NameControl' }, 'a pasted tab');
  assert.deepEqual(v('A\u0085B'), { kind: 'NameControl' }, 'any Cc character');
  assert.equal(v('Lidé: #1'), null, '`Lidé: #1` is a valid name');
  assert.equal(await patched(null, { op: 'save', name: 'Bez štítků', hiddenTypes: ['tag'], hiddenKinds: [] }), fx('expected/created.yml'), 'the first save: expected/created.yml');
  const text = await patched(fx('valid.yml'), { op: 'save', name: 'Lidé: #1', hiddenTypes: [], hiddenKinds: [] });
  assert.ok(text.includes('\n  - name: "Lidé: #1"\n'), `quoted: ${text}`);
  const t = await twin();
  const read = run('presetsRead', () => t.presetsRead(text));
  assert.equal(read.presets.at(-1)?.name, 'Lidé: #1', 'reads back as `Lidé: #1`');
});

// ------------------------------------------------------------------------------------------------ FR-GRP-02 AC-15

test('fr_grp_02_ac15_rename_in_place', async () => {
  const m = await presets();
  assert.equal(run('validateName', () => m.validateName('jen VZTAHY', VALID, 'Jen vztahy')), null, 'a case-only rename of the same preset is allowed');
  assert.deepEqual(run('validateName', () => m.validateName('Bez štítků', VALID, 'Jen vztahy')), { kind: 'NameTaken', existing: 'Bez štítků' }, 'another preset\'s name is taken');
  const valid = fx('valid.yml');
  assert.equal(await patched(valid, { op: 'rename', from: 'Jen vztahy', to: 'Vztahy' }), setLine(valid, 7, '  - name: Vztahy'), 'only line 7 changes');
  assert.equal(await patched(valid, { op: 'rename', from: 'Jen vztahy', to: 'jen VZTAHY' }), setLine(valid, 7, '  - name: jen VZTAHY'), 'a case-only rename is written');
  assert.equal(await patched(valid, { op: 'rename', from: 'Jen vztahy', to: 'Jen vztahy' }), valid, 'the same name: the same bytes');
  assert.deepEqual(await refusal(valid, { op: 'rename', from: 'Jen vztahy', to: 'Bez štítků' }), { kind: 'NameTaken', existing: 'Bez štítků' }, 'a taken name is refused');
});

// ------------------------------------------------------------------------------------------------ FR-GRP-02 AC-16

test('fr_grp_02_ac16_delete_keeps_the_file_and_the_filters', async () => {
  const valid = fx('valid.yml');
  const one = await patched(valid, { op: 'delete', name: 'Jen vztahy' });
  assert.equal(one, cut(valid, 7, 9), 'exactly lines 7–9 removed');
  const two = await patched(one, { op: 'delete', name: 'Bez štítků' });
  assert.equal(await patched(two, { op: 'delete', name: 'Lidé a schůzky' }), fx('expected/valid-after-deleting-all.yml'), 'presets: [] (AP-926)');
  assert.equal(await patched(fx('unknown-keys.yml'), { op: 'delete', name: 'Lidé: schůzky' }), fx('expected/unknown-keys-after-delete.yml'), 'unknown-keys: delete');
  assert.deepEqual(await refusal(one, { op: 'delete', name: 'Jen vztahy' }), { kind: 'NoSuchPreset' }, 'a preset not listed');
});

// ------------------------------------------------------------------------------------------------ FR-GRP-02 AC-17

test('fr_grp_02_ac17_default_is_never_stored', async () => {
  const m = await presets();
  const view: GraphViewStateDto = { depth: 2, sizeByLinks: true, view: 'list', hiddenTypes: ['tag', 'kniha'], hiddenKinds: ['link'], preset: 'Bez štítků' };
  const d = run('applyPreset(Default)', () => m.applyPreset(view, null)) as GraphViewStateDto;
  assert.deepEqual(d, { depth: 2, sizeByLinks: true, view: 'list', hiddenTypes: [], hiddenKinds: [] }, 'Default: every type and kind on, `preset` removed');
  assert.ok(!('preset' in d), 'no `preset` key for Default');
  assert.equal(run('currentPreset', () => m.currentPreset({ preset: 'Default' }, VALID)), null, 'a stored `Default` is Default (never a listed preset)');
  for (const name of ['Default', 'DEFAULT', ' default ']) {
    assert.deepEqual(run('validateName', () => m.validateName(name, VALID)), { kind: 'NameTaken', existing: 'Default' }, `${JSON.stringify(name)} is taken by Default`);
  }
  const t = await twin();
  const read = run('presetsRead', () => t.presetsRead(fx('entries.yml')));
  assert.ok(!read.presets.some((p: GraphPresetDto) => p.name.toLowerCase() === 'default'), 'a `Default` entry in the file is skipped');
  assert.deepEqual(await refusal(fx('valid.yml'), { op: 'save', name: 'default', hiddenTypes: [], hiddenKinds: [] }), { kind: 'NameTaken', existing: 'Default' }, 'the twin refuses it too');
});

// ------------------------------------------------------------------------------------------------ FR-GRP-02 AC-18

test('fr_grp_02_ac18_presets_store_hidden_keys_and_keep_unknown_ones', async () => {
  const valid = fx('valid.yml');
  const t = await twin();
  assert.deepEqual(run('presetsRead', () => t.presetsRead(valid)).presets, VALID, 'unknown `kniha` and the undefined `recept` are kept in the list');
  const text = await patched(valid, { op: 'update', name: 'Jen vztahy', hiddenTypes: ['recept', 'kniha', 'tag', 'osoba', 'page'], hiddenKinds: ['tag', 'link'] });
  assert.equal(text, setLine(setLine(valid, 8, '    hidden-types: [page, osoba, tag, recept, kniha]'), 9, '    hidden-kinds: [link, tag]'), 'R118 order');
  const m = await presets();
  const v = run('applyPreset', () => m.applyPreset({}, VALID[0])) as GraphViewStateDto;
  assert.deepEqual(v.hiddenTypes, ['tag', 'kniha'], 'applying keeps the unknown key in the view\'s state');
});

// ------------------------------------------------------------------------------------------------ FR-GRP-02 AC-19

test('fr_grp_02_ac19_unreadable_file_is_never_rewritten', async () => {
  const t = await twin();
  const r = run('presetsRead', () => t.presetsRead(fx('invalid-yaml.yml')));
  assert.deepEqual([r.state, r.error?.line, r.presets], ['unreadable', 5, []], 'invalid-yaml: unreadable at line 5, no presets');
  const valid = fx('valid.yml');
  for (const [what, text] of [['version: 0', valid.replace('version: 1\n', 'version: 0\n')], ['version: "1"', valid.replace('version: 1\n', 'version: "1"\n')],
    ['version: 1.5', valid.replace('version: 1\n', 'version: 1.5\n')], ['a list', '- a\n'], ['presets not a list', 'version: 1\npresets: Bez štítků\n']] as const) {
    assert.equal(run('presetsRead', () => t.presetsRead(text)).state, 'unreadable', `${what}: unreadable`);
    assert.deepEqual(await refusal(text, { op: 'save', name: 'Nový', hiddenTypes: [], hiddenKinds: [] }), { kind: 'Unreadable' }, `${what}: never rewritten`);
  }
  assert.equal(run('presetsRead', () => t.presetsRead(valid, false)).state, 'unreadable', 'invalid UTF-8: unreadable');
});

// ------------------------------------------------------------------------------------------------ FR-GRP-02 AC-20

test('fr_grp_02_ac20_invalid_entries_are_skipped_and_kept', async () => {
  const t = await twin();
  const entries = fx('entries.yml');
  assert.deepEqual(run('presetsRead', () => t.presetsRead(entries)).presets, [P('Lidé', ['page']), P('Bez druhů', ['task']), P('Neznámé spoje', [], ['link', 'backlink'])],
    'listed: Lidé, Bez druhů, Neznámé spoje');
  assert.deepEqual(await refusal(entries, { op: 'save', name: 'lidé', hiddenTypes: [], hiddenKinds: [] }), { kind: 'NameTaken', existing: 'Lidé' }, '`lidé` is taken');
  assert.equal(await patched(entries, { op: 'rename', from: 'Lidé', to: 'Lidé 2' }), setLine(entries, 4, '  - name: Lidé 2'), 'rename: line 4 only');
  const l = lines(entries);
  l.splice(24, 1, '    hidden-types: [page, task]', '    hidden-kinds: []');
  assert.equal(await patched(entries, { op: 'update', name: 'Bez druhů', hiddenTypes: ['task', 'page'], hiddenKinds: [] }), l.join('\n'), 'update adds `hidden-kinds: []` after its last line');
  assert.equal(await patched(entries, { op: 'delete', name: 'Neznámé spoje' }), cut(entries, 26, 28), 'delete: its lines only');
});

// ------------------------------------------------------------------------------------------------ FR-GRP-02 AC-21

test('fr_grp_02_ac21_newer_and_missing_versions', async () => {
  const t = await twin();
  const newer = fx('newer-version.yml');
  const r = run('presetsRead', () => t.presetsRead(newer));
  assert.deepEqual([r.state, r.presets], ['newer', [P('Bez štítků', ['tag'])]], 'version 2: listed, read-only');
  assert.deepEqual(await refusal(newer, { op: 'update', name: 'Bez štítků', hiddenTypes: [], hiddenKinds: [] }), { kind: 'NewerVersion' }, 'NewerVersion');
  const noVersion = setLine(fx('valid.yml'), 2, null);
  assert.deepEqual(run('presetsRead', () => t.presetsRead(noVersion)).presets, VALID, 'a missing version reads as 1');
  assert.equal(await patched(noVersion, { op: 'update', name: 'Bez štítků', hiddenTypes: ['kniha'], hiddenKinds: [] }), fx('expected/valid-after-update.yml'), 'the first update adds `version: 1` as line 2');
});

// ------------------------------------------------------------------------------------------------ FR-GRP-02 AC-22

test('fr_grp_02_ac22_preset_remembered_per_view_and_vault', async () => {
  const m = await presets();
  const cur = (preset: string | undefined) => run('currentPreset', () => m.currentPreset(preset === undefined ? {} : { preset }, VALID));
  assert.deepEqual(cur('Bez štítků'), VALID[0], 'the stored name');
  assert.deepEqual(cur('bez štítků'), VALID[0], 'case-insensitive');
  assert.deepEqual(cur(nfd('BEZ ŠTÍTKŮ')), VALID[0], 'NFC before comparing');
  assert.equal(cur(undefined), null, 'missing: Default');
  assert.equal(cur('Smazaný'), null, 'a name not listed: Default (AP-930)');
});

// ------------------------------------------------------------------------------------------------ FR-FMT-07 AC-27

test('fr_fmt_07_ac27_graph_yml_minimal_patches', async () => {
  const cases: [PresetOpDto, string][] = [
    [{ op: 'rename', from: 'Bez štítků', to: 'Bez tagů' }, 'unknown-keys-after-rename'],
    [{ op: 'update', name: 'Lidé: schůzky', hiddenTypes: ['page', 'task', 'quick-note', 'tag'], hiddenKinds: ['embed', 'tag'] }, 'unknown-keys-after-update'],
    [{ op: 'delete', name: 'Lidé: schůzky' }, 'unknown-keys-after-delete'],
    [{ op: 'save', name: 'Jen vztahy', hiddenTypes: [], hiddenKinds: ['link', 'embed', 'tag'] }, 'unknown-keys-after-save'],
  ];
  for (const [op, want] of cases) {
    assert.equal(await patched(fx('unknown-keys.yml'), op), fx(`expected/${want}.yml`), `${op.op}: expected/${want}.yml`);
    assert.equal(await patched(crlf(fx('unknown-keys.yml')), op), crlf(fx(`expected/${want}.yml`)), `${op.op}: CRLF stays CRLF`);
  }
  const noNl = fx('valid.yml').replace(/\n$/, '');
  assert.equal(await patched(noNl, { op: 'update', name: 'Bez štítků', hiddenTypes: ['kniha'], hiddenKinds: [] }), fx('expected/valid-after-update.yml').replace(/\n$/, ''),
    'a missing final newline stays missing');
});

// ------------------------------------------------------------------------------------------------ FR-FMT-12 AC-7

test('fr_fmt_12_ac7_preset_names_are_nfc', async () => {
  const m = await presets();
  const c = await load('../ui/src/i18n/collate.ts');
  assert.ok(c?.setCollationLocale, 'the collation locale can be set (i18n/collate.ts)');
  for (const region of ['cs', 'en-US']) {
    c!.setCollationLocale(region);
    assert.deepEqual(run('validateName', () => m.validateName(nfd('Bez štítků'), VALID)), { kind: 'NameTaken', existing: 'Bez štítků' }, `${region}: NFD typed is taken`);
    assert.deepEqual(run('validateName', () => m.validateName('BEZ ŠTÍTKŮ', VALID)), { kind: 'NameTaken', existing: 'Bez štítků' }, `${region}: case-insensitive`);
    assert.deepEqual(run('currentPreset', () => m.currentPreset({ preset: nfd('lidé a schůzky') }, VALID)), VALID[2], `${region}: the stored NFD name matches`);
  }
  const applied = run('applyPreset', () => m.applyPreset({}, P(nfd('Bez štítků'), ['tag']))) as GraphViewStateDto;
  assert.equal(applied.preset, 'Bez štítků', '`preset` is stored in NFC');
  const t = await twin();
  const input = fx('valid.yml').replace(/(- name: )(.*)/g, (_, a: string, b: string) => a + nfd(b));
  assert.deepEqual(run('presetsRead', () => t.presetsRead(input)).presets.map((p: GraphPresetDto) => p.name), ['Bez štítků', 'Jen vztahy', 'Lidé a schůzky'], 'the twin lists NFC names');
  assert.equal(await patched(input, { op: 'rename', from: 'Lidé a schůzky', to: nfd('Lidé a porady') }), setLine(input, 10, '  - name: Lidé a porady'), 'the renamed line in NFC, the other NFD names as they were');
});
