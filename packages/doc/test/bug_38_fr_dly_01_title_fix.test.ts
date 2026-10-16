// Regression for the PR #38 QA review (D-334, FR-FMT-07): the Daily Note title fix must never break the frontmatter.
// A title that isn't one plain single-line value (block scalar, continued or multi-line quoted value, trailing
// comment) is left alone; CRLF files keep CRLF.
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { fixDailyTitle, parse } from '../src/index.js'

const fm = (title: string, nl = '\n') => ['---', 'id: 01JB4B0000000000000000B001', 'type: daily-note', title, 'date: 2026-10-09', '---', 'Text.', ''].join(nl)

test('bug_38_fr_dly_01_multi_line_titles_are_left_alone', () => {
  for (const title of ['title: >-\n  Pátek', 'title: |\n  Pátek', 'title: Pátek\n  dlouhý', 'title: "Pátek\n  dlouhý"', 'title: Pátek # komentář']) {
    const t = fm(title)
    assert.equal(fixDailyTitle(t), t, `left alone: ${JSON.stringify(title)}`)
    assert.ok(parse(fixDailyTitle(t)).frontmatter?.data, 'the frontmatter still parses')
  }
})

test('bug_38_fr_dly_01_crlf_is_kept', () => {
  const t = fm('title: Pátek', '\r\n')
  assert.equal(fixDailyTitle(t), t.replace('title: Pátek', 'title: "2026-10-09"'))
  const missing = ['---', 'type: daily-note', 'date: 2026-10-09', '---', 'Text.', ''].join('\r\n')
  assert.equal(fixDailyTitle(missing), ['---', 'type: daily-note', 'title: "2026-10-09"', 'date: 2026-10-09', '---', 'Text.', ''].join('\r\n'))
})

// QA re-review of PR #38: an empty `title:` may be followed by a column-0 sequence (`- Pátek`), its YAML value.
// Replacing the key line would orphan the list line, so an empty `title:` value is left alone.
test('bug_38_fr_dly_01_empty_title_value_is_left_alone', () => {
  for (const title of ['title:\n- Pátek', 'title:', 'title:   ']) {
    const t = fm(title)
    assert.equal(fixDailyTitle(t), t, `left alone: ${JSON.stringify(title)}`)
    assert.ok(parse(fixDailyTitle(t)).frontmatter?.data, 'the frontmatter still parses')
  }
})
