import { test } from 'vitest'
import fc from 'fast-check'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { extract } from '../src/extract.js'

// S4-QA AC-4, differential part: random documents built from the constructs where link and
// tag extraction is tricky. Writes them with the reference results for the Rust extractor
// (spikes/s4-index, test `s4_qa_ac4_differential_corpus`). Runs only with EXTRACT_DIFF_OUT set.
const OUT = process.env.EXTRACT_DIFF_OUT

const piece = fc.constantFrom(
  '[[Note]]', '![[img.png]]', '[[Note#Head|alias]]', '[[a\\|b]]', '[[Žluťoučký kůň]]', '[[x#^blk]]',
  '#tag', '#Čtení', '#123', '#a/b-c_d', '#čaj', '(#paren)', 'a#notag', '#',
  '`[[code]] #c`', '``x ` [[y]]``', '<span>[[html]] #h</span>', '<!-- [[c]] #c -->', '%%[[hidden]] #h%%',
  '[text #t](https://x.cz/#a)', '[ref #r][1]', '<https://x.cz/#y>', 'https://x.cz/ #z', '![img #i](p.png)',
  '$a #m$', '$5 and $3 #price', '$5 [[Cost]] $6', '$$\n#mm\n$$', '==hl #t==', '\\#esc', '**#b**', '_#i_', ' ', ' ', '\n', '\n\n', 'word', 'čeština',
)
const block = fc.oneof(
  fc.array(piece, { maxLength: 8 }).map((p) => p.join(' ')),
  fc.array(piece, { maxLength: 4 }).map((p) => '```\n' + p.join(' ') + '\n```'),
  fc.array(piece, { maxLength: 4 }).map((p) => '    ' + p.join(' ')),
  fc.array(piece, { maxLength: 4 }).map((p) => '<div>\n' + p.join(' ') + '\n</div>'),
  fc.array(piece, { maxLength: 4 }).map((p) => '> ' + p.join(' ')),
  fc.array(piece, { maxLength: 4 }).map((p) => '- ' + p.join(' ')),
  fc.array(piece, { maxLength: 4 }).map((p) => '| a | b |\n| - | - |\n| ' + p.join(' ') + ' | x |'),
  fc.constant('[1]: https://x.cz/#r'),
  fc.array(piece, { maxLength: 3 }).map((p) => '# ' + p.join(' ')),
)
const front = fc.oneof(
  fc.constant(''),
  fc.constant('---\ntitle: Nadpis\ntags: [a, Čtení]\n---\n'),
  fc.constant('---\ntags: solo\nrel: "[[Linked]]"\nlist: ["[[A]]", "[[B|b]]"]\n---\n'),
  fc.constant('---\ntitle: 42\nid: abc\ntype: Book\nn: 1.50\nhex: 0x1f\nnul: Null\nyes: yes\n---\n'),
  fc.constant('---\na: 1\na: 2\n---\n'),
  fc.constant('---\nbad: [unclosed\n---\n'),
  fc.constant('---\n- a\n- b\n---\n'),
  fc.constant('---\n---\n'),
  fc.constant('---\nnot closed\n'),
  fc.constant('﻿---\ntitle: BOM\n---\n'),
)
const doc = fc.tuple(front, fc.array(block, { maxLength: 6 }), fc.constantFrom('\n', '\r\n')).map(
  ([f, bs, eol]) => (f + bs.join('\n\n')).replace(/\r?\n/g, eol),
)

test.runIf(OUT)('write differential extraction corpus', () => {
  const docs = fc.sample(doc, { numRuns: 2000, seed: Number(process.env.EXTRACT_DIFF_SEED ?? 42) })
  mkdirSync(OUT!, { recursive: true })
  const crashes: string[] = []
  const out = docs.flatMap((text, i) => {
    try {
      return [{ name: `doc-${i}`, text, expected: extract(text, `doc-${i}`) }]
    } catch {
      crashes.push(text)
      return []
    }
  })
  writeFileSync(join(OUT!, 'crashes.json'), JSON.stringify(crashes, null, 1))
  // Documents the reference parser can't parse (S1 bug, see S4 FINDINGS P1) are not in the corpus.
  console.log(`differential corpus: ${docs.length - crashes.length} documents, ${crashes.length} dropped (reference parser crash, P1)`)
  writeFileSync(join(OUT!, 'corpus.json'), JSON.stringify(out))
})
