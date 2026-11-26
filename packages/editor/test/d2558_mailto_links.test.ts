// D-2558 (1), NFR-SEC-01, FR-FMT-07: the editor draws a `mailto:` link like a web link, as a link, instead of keeping
// its block as a read-only source block; `javascript:` and `file:` links stay drawn without a target. The round trip
// stays byte-exact: an untouched note saves nothing, an edit writes only the item or paragraph it changed, and an
// edited block keeps its `<mailto:…>` autolinks and `[…](mailto:…)` links as they were.
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { body, open, press, readFixture, type } from './helpers'

const FM = '---\nid: 01JB0Z00000000000000000099\ntype: page\ntitle: Pošta\ncreated: 2026-10-13T09:00:00+02:00\nmodified: 2026-10-13T09:00:00+02:00\n---\n'

const SOURCES: [string, string][] = [
  ['autolink in a paragraph', 'Napiš na <mailto:eva@example.org> zítra.\n'],
  ['inline link in a paragraph', 'Napiš [Evě](mailto:eva@example.org?subject=Ahoj) zítra.\n'],
  ['both forms with web links in a paragraph', 'Web https://example.org, [stránka](https://example.org/čeština), <mailto:eva@example.org> a [pošta](mailto:jana@example.cz).\n'],
  ['autolink in a list', '- Web: [web](https://example.org/čeština)\n- Pošta: <mailto:eva@example.org>\n- Konec\n'],
  ['inline link in a list', '- Web: <https://example.org>\n- Pošta: [Eva](mailto:eva@example.org)\n- Konec\n'],
  ['both forms in a checklist', '- [ ] Napsat <mailto:eva@example.org>\n- [x] Napsat [Janě](MAILTO:jana@example.cz)\n- [ ] Konec\n'],
]

function caretIn(ed: any, word: string, offset: number | 'end') {
  let pos = -1
  ed.view.state.doc.descendants((n: any, p: number) => {
    if (pos < 0 && n.isText && n.text.includes(word)) pos = p + n.text.indexOf(word) + (offset === 'end' ? word.length : offset)
    return pos < 0
  })
  assert.ok(pos >= 0, `${word} found`)
  const Sel = ed.view.state.selection.constructor as any
  ed.view.dispatch(ed.view.state.tr.setSelection(Sel.near(ed.view.state.doc.resolve(pos))))
}

for (const [name, src] of SOURCES) {
  test(`d2558_fr_fmt_07_mailto_block_is_editable_and_round_trips: ${name}`, async () => {
    const text = FM + src
    const ed = await open(text)
    assert.deepEqual(ed.readonlyBlocks(), [], 'no read-only source block')
    const hrefs = [...ed.view.dom.querySelectorAll('a')].map((a) => a.getAttribute('href') ?? '')
    assert.ok(hrefs.some((h) => /^mailto:/i.test(h)), `a mailto link is drawn as a link: ${JSON.stringify(hrefs)}`)
    const untouched = await ed.save()
    assert.ok(untouched === null || untouched === text, 'an untouched note saves its own bytes')
    // An edit in the block itself rewrites the block: its links keep their bytes.
    const word = src.includes('Konec') ? 'Konec' : src.includes('zítra') ? 'zítra' : 'Web'
    caretIn(ed, word, 'end')
    type(ed, 'X')
    const out = await ed.save()
    assert.ok(out, 'saved')
    assert.equal(await body(out!), src.replace(word, `${word}X`), 'only the typed character changes')
    ed.destroy()
  })
}

test('d2558_fr_fmt_07_mixed_paragraph_edit_keeps_every_link', async () => {
  const src = SOURCES[2][1]
  const ed = await open(FM + src)
  caretIn(ed, 'Web', 'end')
  type(ed, 'X')
  const out = await ed.save()
  assert.ok(out, 'saved')
  assert.equal(await body(out!), src.replace('Web', 'WebX'), 'the paragraph is rewritten with its autolinks and links as they were')
  ed.destroy()
})

test('d2558_fr_fmt_07_editing_an_unrelated_item_writes_only_that_item', async () => {
  const src = '- Web: [web](https://example.org/čeština)\n- Pošta: <mailto:eva@example.org>\n- Kontakt: [Jana](mailto:jana@example.cz)\n- Nákup\n'
  const ed = await open(FM + src)
  assert.deepEqual(ed.readonlyBlocks(), [])
  caretIn(ed, 'Nákup', 'end')
  type(ed, ' chleba')
  let out = await ed.save()
  assert.ok(out, 'saved')
  assert.equal(await body(out!), src.replace('Nákup', 'Nákup chleba'))
  // A new item (the list's item count changes) keeps the other items' bytes too.
  press(ed, 'Enter')
  type(ed, 'Mléko')
  out = await ed.save()
  assert.ok(out, 'saved')
  assert.equal(await body(out!), src.replace('Nákup', 'Nákup chleba\n- Mléko'))
  ed.destroy()
})

test('d2558_nfr_sec_01_javascript_and_file_links_stay_without_a_target', async () => {
  const ed = await open(readFixture('tests/fixtures/vaults/phone/Pages/Odkazy ven.md'))
  assert.deepEqual(ed.readonlyBlocks(), [], 'the web + mailto list is editable')
  const links = [...ed.view.dom.querySelectorAll('a')].map((a) => [a.textContent, a.getAttribute('href')])
  const href = (t: string) => links.find(([x]) => x === t)?.[1] ?? null
  assert.equal(href('mailto:eva@example.org'), 'mailto:eva@example.org')
  assert.equal(href('web'), 'https://example.org/čeština')
  for (const t of ['skript', 'soubor']) {
    const h = href(t)
    assert.ok(!h || !/^(javascript|file):/i.test(h), `${t} is not navigable: ${h}`)
  }
  ed.destroy()
})
