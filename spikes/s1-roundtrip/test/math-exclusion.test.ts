import { describe, expect, test } from 'vitest'
import { parse } from '../src/parse.js'
import { tags, wikilinks } from '../src/links.js'

// Dialect §5: "Not links: anything inside … math". Found in spike S4: the reference counted them.
// Tags in math: excluded as a proposal, pending the owner (AP-15).
describe('math is neither links nor tags', () => {
  test('fr_fmt_03_wikilink_inside_inline_math_is_not_a_link', () => {
    expect(wikilinks(parse('Before $a [[Hidden]] b$ after [[Shown]]')).map((l) => l.target)).toEqual(['Shown'])
  })
  test('fr_fmt_03_wikilink_inside_display_math_is_not_a_link', () => {
    expect(wikilinks(parse('$$\n[[Hidden]]\n$$\n\n[[Shown]]')).map((l) => l.target)).toEqual(['Shown'])
  })
  test('fr_fmt_10_tag_inside_inline_math_is_not_a_tag_ap15', () => {
    expect(tags(parse('$a #hidden b$ and #shown')).map((t) => t.key)).toEqual(['shown'])
  })
  test('fr_fmt_10_tag_inside_display_math_is_not_a_tag_ap15', () => {
    expect(tags(parse('$$\n#hidden\n$$\n\n#shown')).map((t) => t.key)).toEqual(['shown'])
  })
  test('fr_fmt_03_currency_is_text_so_links_and_tags_still_count', () => {
    const d = parse('Paid $5 for [[Lunch]] #food and $3')
    expect(wikilinks(d).map((l) => l.target)).toEqual(['Lunch'])
    expect(tags(d).map((t) => t.key)).toEqual(['food'])
  })
})
