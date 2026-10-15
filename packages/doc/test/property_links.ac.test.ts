// MS3 3D follow-up, L1: links in text property values in @tegg/doc extraction. FR-LNK-02 AC-1, AC-3 (D-249, D-257).
// docs/acceptance/types.md; interface docs/contracts/ms3-shell.md §15.4 (each frontmatter link record gains
// `attribute: string | null`; without a type definition every string value outside the reserved keys except title,
// aliases and tags is scanned). The expectations are the same as in crates/tegg-format/tests/ac_property_links.rs,
// so the TS and Rust outputs are compared through one shared expectation (S4 differential rule).
// Written from the ACs and the contract only (D-61).
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const REPO = resolve(import.meta.dirname, '../../..')
const fixture = (rel: string) => readFileSync(resolve(REPO, 'tests/fixtures/vaults/types', rel), 'utf8')
function swap(text: string, from: string, to: string): string {
  assert.ok(text.includes(from), `fixture contains ${JSON.stringify(from)}`)
  return text.replace(from, to)
}
const porada = (misto: string) => swap(fixture('Schůzky/2026-10-07 Porada.md'), 'místo:\n', `místo: ${misto}\n`)
const obycejna = () => swap(fixture('Pages/Obyčejná stránka.md'), 'místo: Praha\n', 'místo: Praha\ndescription: "Viz [[Rozpočet 2027]]"\nsource: "[[Rozpočet 2027]]"\n')
const rozpocet = () => swap(fixture('Projekty/Rozpočet 2027.md'), '  Druhý řádek s háčky: ěščřžýáíé.\n', '  Druhý řádek s [[Jana Nováková]].\n')

async function extractOf(text: string, stem: string): Promise<any> {
  const m: any = await import('../src/index.js')
  assert.equal(typeof m.extract, 'function', '@tegg/doc exports extract')
  return m.extract(text, stem)
}
/** [target, inFrontmatter] of every link record naming attribute `key`. */
const fromAttr = (x: any, key: string) => (x.links as any[]).filter((l) => l.attribute === key).map((l) => [l.target, l.inFrontmatter])

test('fr_lnk_02_ac1_ts_extract_reports_whole_value_link_with_attribute', async () => {
  const x = await extractOf(porada('"[[Jana Nováková]]"'), '2026-10-07 Porada')
  assert.deepEqual(fromAttr(x, 'místo'), [['Jana Nováková', true]], 'one link from místo, in frontmatter')
})

test('fr_lnk_02_ac1_ts_extract_reports_exactly_one_link_in_mixed_text', async () => {
  const x = await extractOf(porada('"u [[Jana Nováková]] doma"'), '2026-10-07 Porada')
  assert.deepEqual(fromAttr(x, 'místo'), [['Jana Nováková', true]], 'exactly one link from the mixed value')
})

test('fr_lnk_02_ac1_ts_extract_reports_description_and_source_links', async () => {
  const x = await extractOf(obycejna(), 'Obyčejná stránka')
  assert.deepEqual(fromAttr(x, 'description'), [['Rozpočet 2027', true]], 'description')
  assert.deepEqual(fromAttr(x, 'source'), [['Rozpočet 2027', true]], 'source')
})

test('fr_lnk_02_ac1_ts_extract_reports_a_link_in_a_long_text_block', async () => {
  const x = await extractOf(rozpocet(), 'Rozpočet 2027')
  assert.deepEqual(fromAttr(x, 'poznámka'), [['Jana Nováková', true]], "the link inside poznámka's |- block")
})

test('fr_lnk_02_ac1_ts_extract_body_links_have_null_attribute_and_inline_code_is_not_a_link', async () => {
  const x = await extractOf(`${porada('"`[[Ne]]`"')}Viz [[Petr Dvořák]].\n`, '2026-10-07 Porada')
  assert.ok(!(x.links as any[]).some((l) => l.target === 'Ne'), `inline code in a quoted value is not a link: ${JSON.stringify(x.links)}`)
  const body = (x.links as any[]).filter((l) => !l.inFrontmatter)
  assert.equal(body.length, 1, 'one body link')
  assert.equal(body[0].attribute, null, 'body links carry attribute null')
  assert.deepEqual(fromAttr(x, 'účastníci').map((r) => r[0]), ['Jana Nováková', 'Petr Dvořák'], 'relation records name účastníci')
})

test('fr_lnk_02_ac3_an_unclosed_link_stays_text_and_is_not_counted', async () => {
  const x = await extractOf(porada('"[[Jana Nováková"'), '2026-10-07 Porada')
  assert.deepEqual(fromAttr(x, 'místo'), [], '[[ without ]] is not a link')
  const y = await extractOf(porada('"[[Jana Nováková]]"'), '2026-10-07 Porada')
  assert.equal(fromAttr(y, 'místo').length, 1, 'red guard: the closed form is counted with its attribute key')
  // No key, list or marker is added: extraction reads, it never changes the text.
  const text = porada('"u [[Jana Nováková]] doma"')
  const m: any = await import('../src/index.js')
  assert.equal(m.serialize(m.parse(text)), text, 'parse + serialize is byte-identical (the quoted string is the only form)')
})
