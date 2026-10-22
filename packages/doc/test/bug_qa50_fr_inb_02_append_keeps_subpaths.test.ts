// QA review of PR #50 (FR-INB-02 AC-6, D-558, D-572, T2): Append rewrites a link's file part for the target's folder
// and keeps its heading or block anchor, the user's alias, an embed's size and the table form `\|`.
import { describe, expect, it } from 'vitest'
import { appendSection } from '../src/inbox.js'

const TARGET = '---\ntitle: Plán webu\nmodified: 2026-10-01T09:00:00+02:00\n---\nObsah.\n'
const NOW = '2026-10-14T12:00:00+02:00'
const re = (link: string) => (link === 'Dvojník' ? 'Quick Notes/Dvojník|Dvojník' : null)
const body = (text: string) => appendSection(TARGET, 'Položka', text, re, NOW).split('## Položka\n\n')[1]

describe('bug_qa50_fr_inb_02 append keeps link subpaths and aliases', () => {
  it('a plain link takes the D-184 alias', () => {
    expect(body('Viz [[Dvojník]].\n')).toBe('Viz [[Quick Notes/Dvojník|Dvojník]].\n')
  })
  it('a heading and the user alias are kept', () => {
    expect(body('Viz [[Dvojník#Rozpočet|rozpočet]].\n')).toBe('Viz [[Quick Notes/Dvojník#Rozpočet|rozpočet]].\n')
  })
  it('a heading without an alias gets the D-184 alias', () => {
    expect(body('Viz [[Dvojník#Rozpočet]].\n')).toBe('Viz [[Quick Notes/Dvojník#Rozpočet|Dvojník]].\n')
  })
  it('an embed keeps its block anchor and size and never gets a title alias', () => {
    expect(body('![[Dvojník#^blk1|300]]\n')).toBe('![[Quick Notes/Dvojník#^blk1|300]]\n')
    expect(body('![[Dvojník]]\n')).toBe('![[Quick Notes/Dvojník]]\n')
  })
  it('a table link keeps the escaped pipe', () => {
    expect(body('| a | [[Dvojník\\|D]] |\n')).toBe('| a | [[Quick Notes/Dvojník\\|D]] |\n')
  })
  it('links that resolve the same stay byte-identical', () => {
    expect(body('Viz [[Plán webu#Cíl|cíl]].\n')).toBe('Viz [[Plán webu#Cíl|cíl]].\n')
  })
})
