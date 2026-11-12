// Slice I1, L2 property at @tegg/doc (docs/contracts/v1-import.md §16.1, §7.1): FR-FMT-07 on `importNote` output.
// Random Capacities-style notes (titles from a pool with Czech diacritics, emoji and forbidden characters; wikilinks,
// Markdown links with encoded and unencoded destinations, images, code spans and fences holding link text and
// invisible characters; LF and CRLF; NFC and NFD): for every note, `importNote` with an edit for every non-external
// scanned link gives a text that (1) parses with no frontmatter error, (2) survives open → save with 0 bytes changed,
// (3) is LF only, (4) keeps every code span and fenced block byte for byte apart from CRLF → LF, (5) holds none of
// the removed invisible characters outside code, and (6) scans again to exactly the links that were written.
// `importScan` and the independent line counter of the contract's §6.5 agree in Rust (ac_import_property.rs); here
// the scan must find exactly the links the generator wrote. Seeds as the package's other property tests (TS-L2): a
// fixed seed plus one random seed per run (`QA_SEED` when set), printed as `seed = N`; `QA_PROPERTY_SCALE` ≥ 100
// runs 10 seeds × 1,000 cases. Written from the criteria and the contract only (D-61).
import { test } from 'vitest'
import assert from 'node:assert/strict'
import * as doc from '../src/index.js'

const D = doc as unknown as Record<string, any>
const FIXED_SEED = 20261112
const scale = Number(process.env.QA_PROPERTY_SCALE ?? '1') || 1
const randomSeed = Number(process.env.QA_SEED ?? '') || Date.now() % 2 ** 31
const SEEDS = scale >= 100 ? Array.from({ length: 10 }, (_, i) => (i === 0 ? FIXED_SEED : randomSeed + i)) : [FIXED_SEED, randomSeed]
const RUNS = scale >= 100 ? 1000 : 150
console.log(`import note property: ${SEEDS.map((s) => `seed = ${s}`).join(', ')}`)

function rng(seed: number) {
  let x = (seed >>> 0) || 1
  const next = () => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x }
  return { int: (n: number) => next() % n, pick: <T>(a: readonly T[]) => a[next() % a.length], bool: () => (next() & 1) === 1 }
}
const TITLES = ['Žluťoučký kůň', 'Tomáš : Eva', 'Plán 2026', 'Cíl', 'Úkol č. 1', 'Řeka 🌊', 'CON', 'Poznámka (2)']
const WORDS = ['Úvod.', 'Žluťoučký kůň úpěl ďábelské ódy.', 'Text​ s mezerou.', 'Kodér 👩‍💻 zůstává.', '- [ ] pas', '- [x] lístky', '> citace']
const CODE = ['`[[Cíl]]`', '`[x](../Pages/C%C3%ADl.md)`', '`a​b`', '```\n[[Cíl]]\n[x](../Pages/C%C3%ADl.md)\n​kód\n```', '~~~\n![o](./Media/o.png)\n~~~']

type Made = { text: string; links: { written: string; external: boolean }[]; code: string[]; nl: string }
function gen(seed: number): Made {
  const r = rng(seed)
  const nl = r.bool() ? '\r\n' : '\n'
  const nfd = r.int(4) === 0
  const form = (s: string) => (nfd ? s.normalize('NFD') : s)
  const links: Made['links'] = []
  const code: string[] = []
  const paras: string[] = []
  const n = 1 + r.int(7)
  for (let i = 0; i < n; i++) {
    const kind = r.int(8)
    const t = form(r.pick(TITLES))
    if (kind === 0) { const w = `[[${t}]]`; links.push({ written: w, external: false }); paras.push(`Viz ${w}.`) }
    else if (kind === 1) { const w = `[[${t}|jinak]]`; links.push({ written: w, external: false }); paras.push(`Viz ${w}.`) }
    else if (kind === 2) { const w = `[odkaz](../Pages/${encodeURIComponent(t).replace(/%20/g, r.bool() ? '%20' : '%20')}.md)`; links.push({ written: w, external: false }); paras.push(`A ${w} dál.`) }
    else if (kind === 3) { const w = '[příklad](https://example.com/a)'; links.push({ written: w, external: true }); paras.push(`Web ${w}.`) }
    else if (kind === 4) { const w = `![Obrázek](./Media/${encodeURIComponent(t)}.png)`; links.push({ written: w, external: false }); paras.push(w) }
    else if (kind === 5) { const c = r.pick(CODE); code.push(c); paras.push(c.includes('\n') ? c : `V kódu ${c} a dál.`) }
    else paras.push(r.pick(WORDS))
  }
  const title = form(r.pick(TITLES)) + (r.int(5) === 0 ? '​' : '')
  const text = ['---', `type: 'Page'`, `title: '${title}'`, 'tags: []', '---', '', paras.join('\n\n'), ''].join('\n').replace(/\n/g, nl)
  return { text: (r.int(6) === 0 ? '﻿' : '') + text, links, code: code.map((c) => c.replace(/\n/g, nl)), nl }
}

test('fr_fmt_07_ac1_import_note_output_round_trips_and_keeps_code', () => {
  assert.equal(typeof D.importScan, 'function', '@tegg/doc exports importScan (v1-import §7.1)')
  assert.equal(typeof D.importNote, 'function', '@tegg/doc exports importNote (v1-import §7.1)')
  for (const seed of SEEDS) {
    for (let i = 0; i < RUNS; i++) {
      const g = gen(seed * 7919 + i)
      const at = `seed = ${seed}, case ${i}:\n${JSON.stringify(g.text)}`
      const s = D.importScan(g.text)
      assert.deepEqual(s.links.map((l: any) => [l.written, l.external]), g.links.map((l) => [l.written.replace(/\r\n/g, '\n').replace(/\n/g, g.nl), l.external]), `the scan finds exactly the generated links, in order. ${at}`)
      assert.equal(s.crlf, g.nl === '\r\n', `crlf. ${at}`)
      const edits = s.links.filter((l: any) => !l.external).map((l: any) => (l.form === 'image' ? { n: l.n, do: 'embed', file: 'Obrázek.png' } : { n: l.n, do: 'link', toPath: 'Pages/Cíl.md', shown: l.text }))
      const out: string = D.importNote('Pages/Zdroj.md', g.text, {
        frontmatter: [['id', '01JB5V00000000000000000001'], ['type', 'page'], ['title', 'Zdroj'], ['tags', []], ['import-id', 'capacities:PKM/Pages/Zdroj.md'], ['created', { datetime: '2026-11-12T10:00:00+01:00' }], ['modified', { datetime: '2026-11-12T10:00:00+01:00' }]],
        links: edits, paths: ['Pages/Cíl.md', 'Pages/Zdroj.md'],
      })
      const parsed = D.parse(out)
      assert.ok(parsed.frontmatter && !parsed.frontmatter.error, `the output parses with no frontmatter error. ${at}`)
      assert.equal(D.serialize(parsed), out, `open and save changes 0 bytes (FR-FMT-07). ${at}`)
      assert.ok(!out.includes('\r'), `LF only. ${at}`)
      assert.ok(out.endsWith('\n') && !out.startsWith('﻿'), `a final newline and no BOM. ${at}`)
      let rest = out
      for (const c of g.code) {
        const lf = c.replace(/\r\n/g, '\n')
        assert.ok(rest.includes(lf), `the code ${JSON.stringify(lf)} is byte-identical apart from CRLF → LF. ${at}`)
        rest = rest.replace(lf, '')
      }
      assert.ok(!rest.includes('​') && !rest.includes('﻿'), `no U+200B or U+FEFF outside code. ${at}`)
      assert.ok(rest.includes('👩‍💻') === g.text.includes('👩‍💻'), `the emoji sequence keeps its ZWJ. ${at}`)
      const again = D.importScan(out)
      const wantLinks = s.links.map((l: any) => (l.external ? l.written : l.form === 'image' ? '![[Obrázek.png]]' : null))
      assert.equal(again.links.length, s.links.length, `the output has as many links as the source. ${at}`)
      again.links.forEach((l: any, k: number) => {
        if (wantLinks[k] !== null) assert.equal(l.written, wantLinks[k], `link ${k}. ${at}`)
        else assert.ok(l.form === 'wikilink' && l.target === 'Cíl', `link ${k} is a wikilink to Cíl: ${l.written}. ${at}`)
      })
    }
  }
})
