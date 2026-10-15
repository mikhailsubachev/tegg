// MS3 3D follow-up, L1: text values with links, `source` as text, and types defined from a value. FR-EDT-07 AC-18
// (formatting, D-249, AP-189), FR-TYP-08 AC-13 (formatting, D-248, AP-188), FR-TYP-01 AC-11 (rules, D-251, D-222,
// AP-191). docs/acceptance/types.md; interface docs/contracts/ms3-shell.md §15.3 (`UNIVERSAL_ATTRS.source.type`),
// §15.4 (`formatText`), §15.6 (`canDefine`, `typeKey`). Written from the ACs and the contract only (D-61).
// Missing exports fail as assertions through `need` (TS-I1).
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { schema, type Mod } from './helpers';

async function need(...names: string[]): Promise<Mod> {
  const s = await schema();
  for (const n of names) assert.ok(n in s, `@tegg/schema exports ${n} (ms3-shell §15)`);
  return s;
}

test('fr_edt_07_ac18_format_text_double_quotes_every_value_with_a_link', async () => {
  const s = await need('formatText');
  assert.equal(s.formatText('[[Jana Nováková]]'), '"[[Jana Nováková]]"', 'whole-value link');
  assert.equal(s.formatText('u [[Jana Nováková]] doma'), '"u [[Jana Nováková]] doma"', 'mixed text (AP-189: quoted although YAML would allow it plain)');
  assert.equal(s.formatText('[[Jana Nováková|Jana]]'), '"[[Jana Nováková|Jana]]"', 'alias form');
  assert.equal(s.formatText('Viz "x" [[Rozpočet 2027]]'), '"Viz \\"x\\" [[Rozpočet 2027]]"', 'YAML 1.2 double-quote escapes');
  assert.equal(s.formatText('Viz [[Rozpočet 2027]]'), '"Viz [[Rozpočet 2027]]"', 'description value of FR-TYP-08 AC-14');
});

test('fr_typ_08_ac13_source_is_a_text_attribute_with_the_text_formatting', async () => {
  const s = await need('UNIVERSAL_ATTRS', 'formatText');
  assert.equal(s.UNIVERSAL_ATTRS?.source?.type, 'text', 'source is text (D-248), not relation');
  assert.equal(s.formatText('Kniha Rychlé šípy'), 'Kniha Rychlé šípy', 'plain text stays plain');
  assert.equal(s.formatText('https://example.com/a?b=c'), 'https://example.com/a?b=c', 'a URL is plain text (AP-188)');
  assert.equal(s.formatText('2026-10-07'), '"2026-10-07"', 'YAML-ambiguous text is double-quoted (D-230)');
  assert.equal(s.formatText('12'), '"12"', 'a number-looking text is quoted');
});

test('fr_typ_01_ac11_can_define_and_the_key_of_a_value', async () => {
  const s = await need('canDefine', 'typeKey');
  assert.deepEqual(s.canDefine('recept'), { ok: true }, 'recept');
  assert.deepEqual(s.canDefine('Recept s mezerou'), { ok: true }, 'a value with spaces');
  assert.equal(s.typeKey('Recept s mezerou'), 'recept-s-mezerou', 'its key');
  const nfd = 'polévka';
  assert.deepEqual(s.canDefine(nfd), { ok: true }, 'NFD polévka');
  assert.equal(s.typeKey(nfd), 'polévka'.normalize('NFC'), 'NFC key');
  assert.deepEqual(s.canDefine('a/b'), { ok: false, reason: 'fileName' }, 'a D-222 character');
  for (const ch of [':', '\\', '*', '?', '"', '<', '>', '|', '#', '^', '[', ']']) {
    assert.deepEqual(s.canDefine(`a${ch}b`), { ok: false, reason: 'fileName' }, `character ${ch}`);
  }
  assert.deepEqual(s.canDefine('č'.repeat(100)), { ok: true }, 'a key of exactly 200 UTF-8 bytes');
  assert.deepEqual(s.canDefine('č'.repeat(101)), { ok: false, reason: 'fileName' }, 'a key over 200 UTF-8 bytes');
});
