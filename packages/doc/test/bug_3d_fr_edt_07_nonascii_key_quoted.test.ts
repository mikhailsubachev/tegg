// Regression (ms3-shell §14.5 "Key quoting fix", AP-170/D-230; FR-EDT-07, FR-FMT-07, AR-06): keys Tegg writes fresh
// were double-quoted whenever they had a non-ASCII character (`"účastníci":`), so a value set on a Czech key changed
// how the key is written. New rule: plain when the key is Unicode letters, digits, `-`, `_` and spaces, doesn't start
// with `-` or a space, and YAML reads it back as the same string; else double-quoted.
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { newNote, parse, setAttribute } from '../src/index.js'

const NOW = '2026-10-14T10:00:00+02:00'

test('bug_3d_fr_edt_07_nonascii_key_quoted_new_note', () => {
  const text = newNote({ type: 'Schůzka', title: 'Porada', attributes: [['účastníci', 'Jana'], ['místo', 'Praha'], ['klíč s mezerou', 'x']], now: NOW, newId: () => '01JB0T0000000000000000B001' })
  assert.match(text, /\núčastníci: Jana\n/, 'unquoted non-ASCII key')
  assert.match(text, /\nmísto: Praha\n/, 'unquoted non-ASCII key')
  assert.match(text, /\nklíč s mezerou: x\n/, 'letters and spaces stay plain')
})

test('bug_3d_fr_edt_07_nonascii_key_quoted_set_attribute', () => {
  const doc = parse('---\nid: 01JB0T0000000000000000B002\ntype: page\n---\nTělo.\n')
  assert.equal(setAttribute(doc, 'účastníci', 'Jana'), '---\nid: 01JB0T0000000000000000B002\ntype: page\núčastníci: Jana\n---\nTělo.\n')
  assert.equal(setAttribute(doc, 'a: b', 'x'), '---\nid: 01JB0T0000000000000000B002\ntype: page\n"a: b": x\n---\nTělo.\n', 'a key YAML would misread is quoted')
  assert.equal(setAttribute(doc, '-x', 'y'), '---\nid: 01JB0T0000000000000000B002\ntype: page\n"-x": y\n---\nTělo.\n', 'a leading dash is quoted')
})
