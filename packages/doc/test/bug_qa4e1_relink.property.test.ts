// Property tests for the second QA review of slice 4E-1 (qa/reviews/4e-1-type-moves-2.md, N3, N9; FR-FMT-07 AC-26,
// AR-06). `relink` (the one link op of a type or folder move, D-810, D-838): for random vaults with duplicate stems, a
// random set of moves (the source note possibly among them) and random link forms (names, paths, `#heading`, aliases,
// `\|` aliases in tables, embeds, frontmatter links, relative Markdown links with and without encoding, NFD names),
// every link resolves after the moves (from the note's own new place) to the file it resolved to before, mapped by the
// moves; code spans are never touched; no byte outside a link changes. `map-properties`: numeric-looking scalars
// (`0123`, `1.50`, `0x1F`, big integers) reach the Content line as written (D-813).
//
// Seeds (TS-L2): a fixed seed plus one random seed per run (`QA_SEED` when set, else the clock); with
// `QA_PROPERTY_SCALE` ≥ 100 (nightly) 10 seeds × 1,000 cases. Every seed is in the failure message.
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { resolveFrom, transform } from '../src/index.js'

const FIXED_SEED = 20261028
const scale = Number(process.env.QA_PROPERTY_SCALE ?? '1') || 1
const randomSeed = Number(process.env.QA_SEED ?? '') || Date.now() % 2 ** 31
const seeds = scale >= 100 ? Array.from({ length: 10 }, (_, i) => (i === 0 ? FIXED_SEED : randomSeed + i)) : [FIXED_SEED, randomSeed]
const runs = scale >= 100 ? 1000 : 150
const timeout = scale >= 100 ? 600_000 : 30_000

function rng(seed: number) {
  let x = (seed >>> 0) || 1
  const next = () => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x }
  return { below: (n: number) => next() % n, pick<T>(a: readonly T[]): T { return a[next() % a.length] }, chance: (pct: number) => next() % 100 < pct }
}
type R = ReturnType<typeof rng>
const nfc = (s: string) => s.normalize('NFC')
const key = (s: string) => nfc(s).toLowerCase()
const STEMS = ['Řeka', 'Plán cesty', 'Úvod', 'Žába', 'Beta']
const FOLDERS = ['Pages', 'Knihy', 'Osoby', 'Quick Notes']

type Case = { text: string; source: string; paths: string[]; moves: { from: string; to: string }[]; lines: { id: string; md: boolean; target: string }[]; code: string[] }
function gen(r: R): Case {
  const set = new Set<string>()
  for (const s of STEMS) for (const f of FOLDERS) if (r.chance(35)) set.add(`${f}/${s}.md`)
  const source = `${r.pick(['Pages', 'Quick Notes'])}/Zdroj.md`
  set.add(source)
  set.add('Pages/Řeka.md')
  const paths = [...set].sort()
  // 1–3 moves into Knihy/ (the source itself sometimes), to a free name there.
  const movable = paths.filter((p) => !p.startsWith('Knihy/'))
  const moves: { from: string; to: string }[] = []
  const taken = new Set(paths.filter((p) => p.startsWith('Knihy/')).map(key))
  for (const p of movable) {
    if (moves.length >= 3 || !(r.chance(30) || (p === source && r.chance(40)))) continue
    let to = `Knihy/${p.slice(p.indexOf('/') + 1)}`
    for (let n = 2; taken.has(key(to)); n++) to = `Knihy/${p.slice(p.indexOf('/') + 1, -3)} (${n}).md`
    taken.add(key(to))
    moves.push({ from: p, to })
  }
  if (!moves.length) moves.push({ from: 'Pages/Řeka.md', to: taken.has(key('Knihy/Řeka.md')) ? 'Knihy/Řeka (2).md' : 'Knihy/Řeka.md' })
  const lines: Case['lines'] = []
  const code: string[] = []
  const body: string[] = []
  const stems = [...new Set(paths.map((p) => p.slice(p.lastIndexOf('/') + 1, -3)))]
  const table = r.chance(30)
  for (let k = 0; k < 2 + r.below(6); k++) {
    const p = r.pick(paths)
    const s = r.chance(70) ? r.pick(stems) : p.slice(p.lastIndexOf('/') + 1, -3)
    const w = r.chance(20) ? s.normalize('NFD') : s
    const id = `L${lines.length + 1}`
    const rel = (to: string) => { const a = source.split('/').slice(0, -1); const b = to.split('/'); return a[0] === b[0] ? b.slice(1).join('/') : `../${to}` }
    switch (r.below(8)) {
      case 0: lines.push({ id, md: false, target: w }); body.push(table ? `| ${id} | [[${w}]] |` : `${id}: [[${w}]]`); break
      case 1: lines.push({ id, md: false, target: w }); body.push(table ? `| ${id} | [[${w}\\|jinak]] |` : `${id}: [[${w}|jinak]]`); break
      case 2: lines.push({ id, md: false, target: w }); body.push(`${id}: [[${w}#Nadpis]]`); break
      case 3: lines.push({ id, md: false, target: w }); body.push(`${id}: ![[${w}]]`); break
      case 4: lines.push({ id, md: false, target: p.slice(0, -3) }); body.push(`${id}: [[${p.slice(0, -3)}]]`); break
      case 5: lines.push({ id, md: true, target: rel(p) }); body.push(`${id}: [odkaz](${rel(p).replace(/ /g, '%20')})`); break
      case 6: lines.push({ id, md: true, target: rel(p) }); body.push(`${id}: [odkaz](<${rel(p)}>)`); break
      default: lines.push({ id, md: false, target: w }); body.push(`${id}: [[${w}]]`)
    }
    if (r.chance(25)) { const c = `C${code.length + 1}: \`[[${r.pick(stems)}]]\``; code.push(c); body.push(c) }
  }
  const fmLink = r.chance(40) ? r.pick(stems) : null
  const fm = ['---', 'id: 01JB4E0000000000000000E0P9', 'type: page', 'title: Zdroj', ...(fmLink ? [`viz: "[[${fmLink}]]"`] : []), '---']
  if (fmLink) lines.unshift({ id: 'viz', md: false, target: fmLink })
  const head = table ? ['| a | b |', '| - | - |'] : []
  const sep = table ? '\n' : '\n\n'
  return { text: fm.join('\n') + '\n' + [...head, ...body].join(sep) + '\n', source, paths, moves, lines, code }
}
const moved = (moves: Case['moves'], p: string | null) => (p === null ? null : moves.find((m) => key(m.from) === key(p))?.to ?? p)
const WIKI = /!?\[\[([^\]|#\\]+)/
const MD = /\]\((<[^>]+>|[^)\s]+)\)/

test('bug_qa4e1_n3_fr_fmt_07_ac26_relink_keeps_every_resolution_and_changes_only_links', { timeout }, () => {
  for (const seed of seeds) {
    const r = rng(seed)
    for (let i = 0; i < runs; i++) {
      const c = gen(r)
      const where = `seed = ${seed}, case ${i}: ${JSON.stringify({ text: c.text, source: c.source, moves: c.moves, paths: c.paths })}`
      const res = transform(c.source, c.text, [{ op: 'relink', moves: c.moves, paths: c.paths }])
      const out = res.kind === 'bytes' ? res.text : c.text
      const now = moved(c.moves, c.source)!
      const after = [...new Set([...c.paths.map((p) => moved(c.moves, p)!), ...c.moves.map((m) => m.to)])]
      const outLines = out.split('\n')
      for (const l of c.lines) {
        const line = l.id === 'viz' ? outLines.find((x) => x.startsWith('viz:')) : outLines.find((x) => x.includes(`${l.id}:`) || x.startsWith(`| ${l.id} |`))
        assert.ok(line, `${l.id} is still there: ${where}`)
        const m = l.md ? MD.exec(line!) : WIKI.exec(line!)
        assert.ok(m, `${l.id} is still a link: ${line} — ${where}`)
        let t = m![1]
        if (l.md) { t = t.startsWith('<') ? t.slice(1, -1) : t; try { t = decodeURIComponent(t) } catch { /* as written */ } }
        const was = moved(c.moves, resolveFrom(c.source, l.target, l.md, c.paths))
        const is = resolveFrom(now, t, l.md, after)
        assert.equal(is && key(is), was && key(was), `${l.id} → ${line}: same file after the moves — ${where}`)
      }
      for (const code of c.code) assert.ok(outLines.includes(code), `code spans untouched: ${code} — ${where}`)
      // Bytes outside the edits are unchanged and every edit lies in a link.
      if (res.kind === 'bytes') {
        const inB = Buffer.from(c.text, 'utf8')
        const outB = Buffer.from(out, 'utf8')
        let at = 0
        let prev = 0
        for (const e of [...res.edits].sort((a, b) => a.start - b.start)) {
          const seg = inB.subarray(prev, e.start)
          const found = outB.indexOf(seg, at)
          assert.ok(prev === 0 ? found === 0 : found >= at, `bytes before an edit unchanged: ${where}`)
          at = found + seg.length
          const piece = inB.subarray(e.start, e.end).toString('utf8')
          assert.ok(/^(!?\[\[[\s\S]*\]\]|<[^>]+>|[^\s<>]+)$/.test(piece), `an edit is a link or a link URL: ${JSON.stringify(piece)} — ${where}`)
          prev = e.end
        }
        assert.ok(outB.subarray(outB.length - (inB.length - prev)).equals(inB.subarray(prev)), `the tail is unchanged: ${where}`)
      }
    }
  }
})

test('bug_qa4e1_n9_fr_fmt_07_ac26_numeric_looking_values_reach_the_content_as_written', { timeout }, () => {
  const VALUES = ['0123', '1.50', '0x1F', '12345678901234567890', '1e3', '-0', '007.10', '+5', '0o17', '.5', '1_000', 'true', 'null', '~']
  for (const seed of seeds) {
    const r = rng(seed)
    for (let i = 0; i < runs; i++) {
      const v = r.pick(VALUES)
      const list = r.chance(30)
      const eol = r.chance(30) ? '\r\n' : '\n'
      const written = list ? `[${v}, ${r.pick(VALUES)}]` : v
      const text = ['---', 'id: x', 'type: kniha', `hodnota: ${written}`, '---', 'Text.', ''].join(eol)
      const res = transform('Knihy/A.md', text, [{ op: 'map-properties', map: [{ from: 'hodnota', to: 'content' }], labels: { hodnota: 'Hodnota' } }])
      const out = res.kind === 'bytes' ? res.text : text
      const where = `seed = ${seed}, case ${i}: ${JSON.stringify(text)}`
      const shown = list ? written.slice(1, -1).split(', ').filter((x) => x !== 'null' && x !== '~').join(', ') : written
      const empty = shown === '' || (!list && (v === 'null' || v === '~'))
      if (empty) assert.ok(!out.includes('**Hodnota:**'), `an empty value writes no line: ${where}`)
      else assert.ok(out.includes(`${eol}**Hodnota:** ${shown}${eol}`), `as written: ${JSON.stringify(out)} — ${where}`)
    }
  }
})
