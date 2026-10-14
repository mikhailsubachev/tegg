// MS3 slice 3D, L1: the attribute panel's row model (`types/panel.ts` `panelRows`, docs/contracts/ms3-shell.md §14.7.1).
// FR-EDT-07 AC-1 (rows, order, hidden keys, Empty), AC-2 (Other properties), FR-TYP-13 AC-2 (type warning), FR-TYP-02
// AC-4/AC-5 (read-only rows), FR-TYP-08 AC-11 (Review row condition), FR-TYP-06 AC-5 (Page). Rendering is L5
// (app/webkit/attribute_panel.ac.test.ts). Written from docs/acceptance/types.md and the contract only (D-61). The
// module is imported inside each test so a missing module fails an assertion (TS-I1).
import { beforeEach, test } from 'vitest';
import assert from 'node:assert/strict';
import { parse } from '@tegg/doc';
import { need, catalog } from './read-helpers';
import { typeDto, typesNote } from './types-helpers';

const PANEL = '../ui/src/types/panel.ts';
beforeEach(async () => { await catalog().catch(() => {}); });

type Rows = { subtitle: string | null; rows: { key: string; label: string; attr: any; raw: unknown; validity: any; editable: boolean; required: boolean }[]; other: { key: string; value: unknown }[]; typeWarning: boolean };
async function rows(note: string, type: string, text?: string): Promise<Rows> {
  const m = await need(PANEL, 'panelRows');
  return m.panelRows(parse(text ?? typesNote(note)), typeDto(type)) as Rows;
}
const UNIVERSAL = ['tags', 'aliases', 'source', 'created', 'modified'];

test('fr_edt_07_ac1_schema_rows_in_order_then_universal_rows', async () => {
  const r = await rows('Schůzky/2026-10-07 Porada.md', 'schůzka');
  assert.deepEqual(r.rows.map((x) => x.key), ['datum', 'začátek', 'účastníci', 'projekt', 'místo', ...UNIVERSAL]);
  assert.deepEqual(r.rows.map((x) => x.label), ['Datum', 'Začátek', 'Účastníci', 'Projekt', 'Místo', 'Tags', 'Aliases', 'Source', 'Created', 'Modified'], 'Names and catalog labels');
  assert.equal(r.subtitle, null, 'no description on Porada');
  assert.deepEqual(r.rows.filter((x) => !x.editable).map((x) => x.key), ['created', 'modified'], 'Created and Modified read-only');
  assert.deepEqual(r.rows.find((x) => x.key === 'účastníci')?.raw, ['[[Jana Nováková]]', '[[Petr Dvořák]]']);
  assert.equal(r.typeWarning, false);
});

test('fr_edt_07_ac1_empty_schema_rows_on_prazdna_schuzka', async () => {
  const r = await rows('Schůzky/Prázdná schůzka.md', 'schůzka');
  const schema = r.rows.filter((x) => x.attr);
  assert.deepEqual(schema.map((x) => x.key), ['datum', 'začátek', 'účastníci', 'projekt', 'místo']);
  for (const x of schema) assert.deepEqual(x.validity, { state: 'empty' }, `${x.key} is Empty`);
  assert.deepEqual(r.other, []);
});

test('fr_edt_07_ac1_date_range_is_one_row_and_required_is_marked', async () => {
  const r = await rows('Projekty/Rozpočet 2027.md', 'projekt');
  assert.deepEqual(r.rows.map((x) => x.key), ['stav', 'období', 'rozpočet', 'aktivní', 'oblasti', 'web', 'poznámka', ...UNIVERSAL]);
  assert.deepEqual(r.rows.find((x) => x.key === 'období')?.raw, { start: '2027-01-01', end: '2027-12-31' });
  assert.equal(r.rows.find((x) => x.key === 'stav')?.required, true);
  assert.deepEqual(r.rows.filter((x) => x.attr).map((x) => x.validity.state), ['valid', 'valid', 'valid', 'valid', 'valid', 'valid', 'valid']);
});

test('fr_edt_07_ac1_hidden_keys_and_subtitle', async () => {
  const text = '---\nid: 01JB0T0000000000000000P001\ntype: page\ntitle: Skryté\ndescription: Krátký popis\nicon: star\ncover: x.png\nimport-id: abc\nprevious: "[[Starší]]"\nmísto: Praha\n---\nTělo.\n';
  const r = await rows('', 'page', text);
  assert.equal(r.subtitle, 'Krátký popis', 'description is the subtitle');
  const keys = [...r.rows.map((x) => x.key), ...r.other.map((x) => x.key)];
  for (const k of ['id', 'type', 'title', 'description', 'icon', 'cover', 'import-id', 'previous']) assert.ok(!keys.includes(k), `${k} hidden`);
  assert.deepEqual(r.other.map((x) => x.key), ['místo']);
});

test('fr_edt_07_ac2_other_properties_are_the_rest_in_file_order', async () => {
  const p = await rows('Schůzky/2026-10-07 Porada.md', 'schůzka');
  assert.deepEqual(p.other, [{ key: 'nálada', value: 'dobrá' }], 'Porada: 1 (nálada)');
  const o = await rows('Pages/Obyčejná stránka.md', 'page');
  assert.deepEqual(o.other.map((x) => x.key), ['místo', 'nálada'], 'file order');
  const e = await rows('', 'page', '---\nid: 01JB0T0000000000000000P002\ntype: page\nprázdné:\nnull-hodnota: null\nseznam: []\nplné: ano\n---\n');
  assert.deepEqual(e.other.map((x) => x.key), ['plné'], 'empty values are not counted');
  const s = await rows('Pages/Obyčejná stránka.md', 'schůzka');
  assert.equal(s.rows.find((x) => x.key === 'místo')?.raw, 'Praha', 'a schema key is adopted (FR-TYP-03 AC-3, FR-TYP-07 AC-5)');
  assert.deepEqual(s.other.map((x) => x.key), ['nálada']);
});

test('fr_edt_07_ac1_review_row_only_when_on_locked_or_present', async () => {
  const n = await rows('Nápady/Nápad k ověření.md', 'nápad');
  assert.deepEqual(n.rows.map((x) => x.key), ['hodnocení', 'tags', 'aliases', 'source', 'review', 'created', 'modified']);
  const q = await rows('', 'quick-note', '---\nid: 01JB0T0000000000000000P003\ntype: quick-note\ntitle: Q\n---\n');
  assert.ok(q.rows.some((x) => x.key === 'review'), 'locked → Review row');
  const d = await rows('Daily/2026-10-07.md', 'daily-note');
  assert.ok(d.rows.some((x) => x.key === 'review'), 'present → Review row');
  const o = await rows('Pages/Obyčejná stránka.md', 'page');
  assert.ok(!o.rows.some((x) => x.key === 'review'), 'off and absent → no Review row');
  const bad = await rows('', 'page', '---\nid: 01JB0T0000000000000000P004\ntype: page\nreview: možná\n---\n');
  assert.equal(bad.rows.find((x) => x.key === 'review')?.validity.state, 'invalid', 'other values invalid (FR-TYP-08 AC-11)');
});

test('fr_edt_07_ac7_invalid_values_marked_in_the_row_model', async () => {
  const r = await rows('Projekty/Chybné hodnoty.md', 'projekt');
  const inv = r.rows.filter((x) => x.validity.state === 'invalid').map((x) => x.key);
  assert.deepEqual(inv, ['stav', 'období', 'rozpočet', 'aktivní', 'oblasti', 'web']);
  assert.deepEqual(r.rows.find((x) => x.key === 'oblasti')?.validity, { state: 'invalid', items: [1] });
  const s = await rows('Pages/Obyčejná stránka.md', 'page', typesNote('Pages/Obyčejná stránka.md').replace('místo: Praha', 'source: Praha'));
  assert.equal(s.rows.find((x) => x.key === 'source')?.validity.state, 'invalid', 'plain-text source is invalid (FR-TYP-08 AC-10)');
});

test('fr_typ_02_ac4_system_only_types_are_read_only_rows', async () => {
  const task = '---\nid: 01JB0T0000000000000000P005\ntype: task\ntitle: Úkol\nrecurrence: every week\n---\n';
  const r = await rows('', 'task', task);
  const rec = r.rows.find((x) => x.key === 'recurrence');
  assert.equal(rec?.editable, false, 'recurrence read-only');
  assert.equal(rec?.raw, 'every week');
  const img = await rows('', 'image', '---\nid: 01JB0T0000000000000000P006\ntype: image\nfile: "[[photo.png]]"\n---\n');
  assert.equal(img.rows.find((x) => x.key === 'file')?.editable, false);
});

test('fr_typ_02_ac5_unsupported_type_row_is_read_only', async () => {
  const r = await rows('Osoby/Petr Dvořák.md', 'osoba');
  assert.equal(r.rows.find((x) => x.key === 'hodnocení')?.editable, false);
  assert.equal(r.rows.find((x) => x.key === 'e-mail')?.validity.state, 'invalid', 'Petr\'s e-mail');
});

test('fr_typ_13_ac2_type_warning_for_values_that_are_not_one_type', async () => {
  const r = await rows('Pages/Dva typy.md', 'page');
  assert.equal(r.typeWarning, true);
  const b = await rows('Pages/Bez hlavičky.md', 'page');
  assert.equal(b.typeWarning, false, 'a missing type is no warning (D-103)');
});

test('fr_typ_06_ac5_untyped_file_shows_the_page_schema_and_universal_rows', async () => {
  const r = await rows('Pages/Bez hlavičky.md', 'page');
  assert.deepEqual(r.rows.map((x) => x.key), UNIVERSAL, 'Page has no attributes');
  assert.equal(r.subtitle, null);
  assert.deepEqual(r.other, []);
});
