// MS3 slice 3D, L1: @tegg/schema against the shared corpora tests/fixtures/types/{values,rules}.json, the same files the
// Rust crate tegg-schema is tested with (crates/tegg-schema/tests/ac_schema.rs), so the two can't drift (D-241).
// FR-TYP-02 AC-2; FR-TYP-01 AC-3, AC-5; FR-TYP-03 AC-1, AC-2; FR-TYP-13 AC-1, AC-2; FR-EDT-07 AC-7 (rules).
// Written from docs/acceptance/types.md and docs/contracts/ms3-shell.md §14.1–§14.4 only (D-61).
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { parse } from '@tegg/doc';
import { attributeDto, corpus, read, ruleMatches, schema, typeDto } from './helpers';

const fm = (text: string) => (parse(text.startsWith('---\n') ? text : `---\n${text}---\n`).frontmatter?.data ?? {}) as Record<string, unknown>;

test('fr_typ_02_ac2_validity_corpus_matches_tegg_schema', async () => {
  const s = await schema();
  const bad: string[] = [];
  for (const c of corpus('values.json').cases) {
    const got = s.validate(attributeDto(c.attr), fm(c.yaml));
    if (JSON.stringify(got) !== JSON.stringify(c.expect)) bad.push(`${c.name}: got ${JSON.stringify(got)}, want ${JSON.stringify(c.expect)}`);
  }
  assert.deepEqual(bad, [], 'validity (R10, D-231)');
});

const PROJEKT = [
  { key: 'stav', name: 'Stav', type: 'select', required: true, options: [{ label: 'Plánovaný' }, { label: 'Běží' }, { label: 'Hotovo' }] },
  { key: 'období', name: 'Období', type: 'date-range' }, { key: 'rozpočet', name: 'Rozpočet', type: 'number' },
  { key: 'aktivní', name: 'Aktivní', type: 'checkbox' },
  { key: 'oblasti', name: 'Oblasti', type: 'multi-select', options: [{ label: 'Práce' }, { label: 'Rodina' }, { label: 'Zdraví' }] },
  { key: 'web', name: 'Web', type: 'url' }, { key: 'poznámka', name: 'Poznámka', type: 'long-text' },
].map(attributeDto);
const SCHUZKA = [
  { key: 'datum', name: 'Datum', type: 'date' }, { key: 'začátek', name: 'Začátek', type: 'date-time' },
  { key: 'účastníci', name: 'Účastníci', type: 'relation', to: ['osoba'], multiple: true },
  { key: 'projekt', name: 'Projekt', type: 'relation', to: ['projekt'] }, { key: 'místo', name: 'Místo', type: 'text' },
].map(attributeDto);
const OSOBA = [{ key: 'e-mail', name: 'E-mail', type: 'email' }, { key: 'firma', name: 'Firma', type: 'text' }, { key: 'telefon', name: 'Telefon', type: 'text' }, { key: 'hodnocení', name: 'Hodnocení', type: 'rating' }].map(attributeDto);

async function invalidKeys(attrs: any[], note: string) {
  const s = await schema();
  const data = fm(read(`tests/fixtures/vaults/types/${note}`));
  return attrs.filter((a) => s.validate(a, data).state === 'invalid').map((a) => a.key);
}

test('fr_typ_02_ac2_validity_on_the_fixture_objects', async () => {
  assert.deepEqual(await invalidKeys(PROJEKT, 'Projekty/Rozpočet 2027.md'), [], 'Rozpočet: every value valid');
  assert.deepEqual(await invalidKeys(PROJEKT, 'Projekty/Chybné hodnoty.md'), ['stav', 'období', 'rozpočet', 'aktivní', 'oblasti', 'web'], 'Chybné');
  const ve = await invalidKeys(SCHUZKA, 'Pages/Schůzka ve stránkách.md');
  assert.ok(ve.includes('datum') && ve.includes('účastníci'), `Ve stránkách: datum and účastníci invalid, got ${ve}`);
  assert.deepEqual(await invalidKeys(OSOBA, 'Osoby/Petr Dvořák.md'), ['e-mail'], 'Petr');
});

test('fr_edt_07_ac7_invalid_items_are_marked_per_position', async () => {
  const s = await schema();
  const data = fm(read('tests/fixtures/vaults/types/Projekty/Chybné hodnoty.md'));
  const oblasti = PROJEKT.find((a) => a.key === 'oblasti');
  assert.deepEqual(s.validate(oblasti, data), { state: 'invalid', items: [1] }, '`Koníčky` not an option, `Práce` shown normally');
  assert.deepEqual(s.validate(PROJEKT.find((a) => a.key === 'stav'), data), { state: 'invalid', items: [] }, 'stav: the whole value');
  const empty = fm(read('tests/fixtures/vaults/types/Schůzky/Prázdná schůzka.md'));
  for (const a of SCHUZKA) assert.deepEqual(s.validate(a, empty), { state: 'empty' }, `${a.key}: empty is never invalid (D-231)`);
  const porada = fm(read('tests/fixtures/vaults/types/Schůzky/2026-10-07 Porada.md'));
  assert.deepEqual(s.validate(SCHUZKA.find((a) => a.key === 'místo'), porada), { state: 'empty' }, 'místo: key without value is empty');
});

const rules = () => corpus('rules.json');
const ctxTypes = () => rules().types.map(typeDto);

test('fr_typ_01_ac3_type_name_rules_from_the_corpus', async () => {
  const s = await schema();
  const r = rules();
  const bad: string[] = [];
  for (const c of r.typeNames) {
    const got = s.checkTypeName(c.name, c.plural, ctxTypes(), r.undefinedKeys);
    if (!ruleMatches(got, c.expect)) bad.push(`${JSON.stringify(c.name)} / ${JSON.stringify(c.plural)}: got ${JSON.stringify(got)}, want ${JSON.stringify(c.expect)}`);
  }
  assert.deepEqual(bad, [], 'type name rules (D-222)');
});

test('fr_typ_01_ac3_type_key_from_the_corpus_equals_tegg_doc', async () => {
  const s = await schema();
  const doc = await import('@tegg/doc');
  const bad: string[] = [];
  for (const [input, want] of rules().typeKey) {
    if (s.typeKey(input) !== want) bad.push(`${JSON.stringify(input)} → ${JSON.stringify(s.typeKey(input))}, want ${JSON.stringify(want)}`);
    if (doc.typeKey(input) !== want) bad.push(`@tegg/doc typeKey(${JSON.stringify(input)}) → ${JSON.stringify(doc.typeKey(input))}`);
  }
  assert.deepEqual(bad, [], 'typeKey (D-96)');
});

test('fr_typ_01_ac5_folder_rules_from_the_corpus', async () => {
  const s = await schema();
  const bad: string[] = [];
  for (const c of rules().folders) {
    const got = s.checkFolder(c.folder, ctxTypes(), c.self ?? undefined);
    if (!ruleMatches(got, c.expect)) bad.push(`${JSON.stringify(c.folder)} (self ${c.self}): got ${JSON.stringify(got)}, want ${JSON.stringify(c.expect)}`);
  }
  assert.deepEqual(bad, [], 'folder rules (D-222)');
});

test('fr_typ_03_ac1_key_derivation_from_the_corpus', async () => {
  const s = await schema();
  const bad: string[] = [];
  for (const [input, want] of rules().deriveAttrKey) {
    if (s.deriveAttrKey(input) !== want) bad.push(`${JSON.stringify(input)} → ${JSON.stringify(s.deriveAttrKey(input))}, want ${JSON.stringify(want)}`);
  }
  assert.deepEqual(bad, [], 'deriveAttrKey (D-223)');
});

test('fr_typ_03_ac2_attribute_key_rules_from_the_corpus', async () => {
  const s = await schema();
  const bad: string[] = [];
  for (const c of rules().attrKeys) {
    const got = s.checkAttrKey(c.key, typeDto(c.type), c.attrType);
    if (!ruleMatches(got, c.expect)) bad.push(`${c.type.key} / ${JSON.stringify(c.key)} as ${c.attrType}: got ${JSON.stringify(got)}, want ${JSON.stringify(c.expect)}`);
  }
  assert.deepEqual(bad, [], 'attribute key rules (D-223, FR-TYP-15)');
});

test('fr_typ_13_ac1_type_values_match_by_key', async () => {
  const s = await schema();
  assert.deepEqual(s.typeMatch('Projekt'), { key: 'projekt', single: true });
  assert.deepEqual(s.typeMatch('Quick Note'), { key: 'quick-note', single: true });
  assert.deepEqual(s.typeMatch('schůzka'), { key: 'schůzka', single: true }, 'NFD value');
  assert.deepEqual(s.typeMatch(undefined), { key: 'page', single: true }, 'missing type: Page (D-103)');
});

test('fr_typ_13_ac2_values_that_are_not_one_type_are_page', async () => {
  const s = await schema();
  const doc = (await import('@tegg/doc')) as any;
  for (const v of [['projekt', 'osoba'], 5, null, '', '   ']) {
    assert.deepEqual(s.typeMatch(v), { key: 'page', single: false }, `${JSON.stringify(v)}`);
  }
  assert.equal(typeof doc.typeMatch, 'function', '@tegg/doc exports typeMatch (§14.5), re-exported by @tegg/schema');
  for (const v of ['Projekt', ['projekt', 'osoba'], 5, null, '', undefined]) {
    assert.deepEqual(s.typeMatch(v), doc.typeMatch(v), `same as @tegg/doc for ${JSON.stringify(v)}`);
  }
});
