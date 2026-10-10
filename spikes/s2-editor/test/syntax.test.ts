// Obsidian syntax survives editing in the real editor; autocomplete inserts real nodes; paste is clean.
import { describe, expect, test } from 'vitest'
import { insertLink } from '../src/ui/suggest'
import { endOfBlock, open } from './helpers'

const lines = [
  ['wikilinks and embeds', 'See [[Note|alias]], [[Note#Heading]], [[Note#^b1]] and ![[img.png|400]]'],
  ['tags', '#start and #Čtení and #area/work'],
  ['highlight', 'Some ==highlighted *text*== here'],
  ['inline comment', 'Visible %%hidden [[x]] #y%% text'],
  ['inline math', 'Euler $e^{i\\pi}+1=0$ here'],
  ['block id', 'A linkable paragraph ^para-1'],
  ['footnote reference', 'Claim[^1] here'],
  ['inline html', 'A<br>break and <kbd>Ctrl</kbd>'],
  ['markdown image', 'Media: ![Image](./Media/Mapa%20%C5%99eky.jpeg)'],
  ['emphasis styles', 'Keep _underscore_ and __strong__ and *star*'],
] as const

describe('Obsidian syntax survives typing in the editor', () => {
  test.each(lines)('s2_qa_ac2_editor_typing_keeps_%s', (_, line) => {
    const text = `${line}\n\n[^1]: Footnote.\n`
    const s = open(text)
    // Insert an unformatted text node (typing right after *star* would continue the italic).
    const pos = endOfBlock(s.editor, 0)!
    s.editor.chain().command(({ tr, state }) => { tr.insert(pos, state.schema.text(' edited')); return true }).run()
    const out = s.save()
    expect(out.endsWith('\n\n[^1]: Footnote.\n')).toBe(true)
    const first = out.split('\n\n')[0]
    // Links, tags, highlight, comment, math, ids, refs, html and images are kept as written.
    // Emphasis markers may be canonicalized (`_x_` → `*x*`) only inside the edited block.
    const canonical = (t: string) => t.replace(/__(.+?)__/g, '**$1**').replace(/(?<![\w\\])_(.+?)_(?!\w)/g, '*$1*')
    expect(canonical(first)).toBe(canonical(`${line} edited`))
  })
})

describe('inserting Obsidian nodes', () => {
  test('fr_edt_06_wikilink_autocomplete_inserts_wikiLink_node', () => {
    const s = open('Start.\n')
    s.editor.chain().setTextSelection(endOfBlock(s.editor, 0)!).insertContent([
      { type: 'text', text: ' see ' },
      { type: 'wikiLink', attrs: { value: 'Trip to Lisbon', embed: false } },
      { type: 'text', text: ' and ' },
      { type: 'wikiLink', attrs: { value: 'photo.png|400', embed: true } },
    ]).run()
    expect(s.save()).toBe('Start. see [[Trip to Lisbon]] and ![[photo.png|400]]\n')
  })

  test('fr_edt_15_tag_autocomplete_inserts_tag_node', () => {
    const s = open('Start.\n')
    s.editor.chain().setTextSelection(endOfBlock(s.editor, 0)!).insertContent([
      { type: 'text', text: ' ' },
      { type: 'tag', attrs: { value: 'čtení' } },
    ]).run()
    expect(s.save()).toBe('Start. #čtení\n')
  })

  test('a typed [[ or # stays literal text and is escaped, never a broken link', () => {
    const s = open('Start.\n')
    s.editor.chain().setTextSelection(endOfBlock(s.editor, 0)!).insertContent(' [[not a link]] #1').run()
    expect(s.save()).toBe('Start. \\[\\[not a link]] #1\n')
  })
})

describe('FR-EDT-14 paste', () => {
  test('fr_edt_14_paste_html_becomes_clean_blocks', () => {
    const s = open('Before.\n')
    s.editor.chain().setTextSelection(endOfBlock(s.editor, 0)!).insertContent(
      '<h2 style="color:red">Pasted</h2><p>Hello <strong>world</strong> and <a href="https://example.com">a link</a></p><ul><li>one</li><li>two</li></ul><script>alert(1)</script>',
    ).run()
    expect(s.save()).toBe('Before.\n\n## Pasted\n\nHello **world** and [a link](https://example.com)\n\n- one\n- two\n')
  })
})

describe('whitespace while typing', () => {
  test('bug_s2_trailing_space_is_not_written_as_character_reference', () => {
    // Found in manual testing: autosave after typing "word " wrote "word&#x20;".
    const s = open('Start.\n\n# Head\n')
    const e = s.editor
    e.chain().command(({ tr, state }) => { tr.insert(endOfBlock(e, 0)!, state.schema.text(' more ')); return true }).run()
    e.chain().command(({ tr, state }) => { tr.insert(endOfBlock(e, 1)!, state.schema.text('ing ')); return true }).run()
    expect(s.save()).toBe('Start. more\n\n# Heading\n')
  })
})

describe('hard breaks at the edge of a block (QA review finding 3)', () => {
  test('bug_s2_trailing_hard_break_does_not_write_a_backslash', () => {
    const s = open('Line\n\n# Head\n')
    const e = s.editor
    e.chain().setTextSelection(endOfBlock(e, 0)!).setHardBreak().run() // Shift+Enter at the end
    e.chain().setTextSelection(endOfBlock(e, 1)!).setHardBreak().run()
    expect(s.save()).toBe('Line\n\n# Head\n')
  })

  test('a hard break inside a paragraph is kept', () => {
    const s = open('One\n')
    const e = s.editor
    e.chain().setTextSelection(endOfBlock(e, 0)!).setHardBreak().insertContent('two').run()
    const out = s.save()
    expect(out).toBe('One\\\ntwo\n')
  })
})

describe('tags in the editor follow Obsidian tag rules (S2 read-back finding)', () => {
  const tagsOf = (s: ReturnType<typeof open>) => {
    const out: string[] = []
    s.editor.state.doc.descendants((n) => { if (n.type.name === 'tag') out.push(n.attrs.value) })
    return out
  }
  const typeAt = (s: ReturnType<typeof open>, k: number, text: string) =>
    s.editor.chain().command(({ tr, state }) => { tr.insert(endOfBlock(s.editor, k)!, state.schema.text(text)); return true }).run()

  test('typing #word as text makes it a tag, as in Obsidian', () => {
    const s = open('Start.\n')
    typeAt(s, 0, ' #word')
    expect(tagsOf(s)).toEqual(['word'])
    expect(s.save()).toBe('Start. #word\n')
  })

  test('typing right after a tag extends the tag', () => {
    const s = open('See #start\n')
    typeAt(s, 0, 'more')
    expect(tagsOf(s)).toEqual(['startmore'])
    expect(s.save()).toBe('See #startmore\n')
  })

  test('a # right after a letter is text, not a tag', () => {
    const s = open('abc\n')
    typeAt(s, 0, '#x')
    expect(tagsOf(s)).toEqual([])
    expect(s.save()).toBe('abc#x\n') // no escape needed: # after a letter never starts a tag
  })
})

describe('[[ autocomplete', () => {
  // E6, found in manual testing: for the two-character trigger `[[` the suggestion range can start
  // at the second bracket, which left a stray `[` (`\[[[Trip]]`).
  test.each([['range from the first bracket', 0], ['range from the second bracket', 1]] as const)('bug_s2_e6_link_autocomplete_leaves_no_stray_bracket: %s', (_, offset) => {
    const s = open('See x\n')
    const e = s.editor
    const end = endOfBlock(e, 0)!
    e.chain().command(({ tr, state }) => { tr.delete(end - 1, end); tr.insert(end - 1, state.schema.text('[[Tri')); return true }).run()
    const typedEnd = endOfBlock(e, 0)!
    const bracket = typedEnd - '[[Tri'.length
    insertLink(e, { from: bracket + offset, to: typedEnd }, 'Trip to Lisbon')
    expect(s.save()).toBe('See [[Trip to Lisbon]]\n')
  })
})
