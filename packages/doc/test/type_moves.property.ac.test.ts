// Slice 4E-1, L2 property test: docs/acceptance/type-moves.md FR-FMT-07 AC-26 (4E-1 ops). For random frontmatter
// (block and flow lists, comments, quoting, CRLF, NFD keys, no final newline) and random bodies, `map-properties`
// changes only its own lines and the body's start; for a random move, `keep-targets` keeps every link's resolution
// (`resolveFrom` before and after, the D-291 rule `link_resolve` uses) and changes no byte outside link targets.
// Interface docs/contracts/ms4-jobs.md §14.4. Every generated case holds at least one mapped value (map-properties)
// and at least one link whose target would change from the new folder (keep-targets), so an op that does nothing fails.
//
// Seeds (TS-L2): a fixed seed plus one random seed per run (`QA_SEED` when set, else the clock); with
// `QA_PROPERTY_SCALE` ≥ 100 (nightly) 10 seeds × 1,000 cases. Every seed is in the failure message. Synthetic Czech
// text (D-50). Written from the AC and the contract only (D-61).
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { resolveFrom, transform, type TextOp } from '../src/index.js'

const FIXED_SEED = 20261027
const scale = Number(process.env.QA_PROPERTY_SCALE ?? '1') || 1
const randomSeed = Number(process.env.QA_SEED ?? '') || Date.now() % 2 ** 31
const seeds = scale >= 100 ? Array.from({ length: 10 }, (_, i) => (i === 0 ? FIXED_SEED : randomSeed + i)) : [FIXED_SEED, randomSeed]
const runs = scale >= 100 ? 1000 : 100
const timeout = scale >= 100 ? 600_000 : 20_000

function rng(seed: number) {
  let x = (seed >>> 0) || 1
  const next = () => {
    x ^= x << 13; x >>>= 0
    x ^= x >>> 17
    x ^= x << 5; x >>>= 0
    return x
  }
  return {
    below: (n: number) => next() % n,
    pick<T>(a: readonly T[]): T { return a[next() % a.length] },
    chance: (pct: number) => next() % 100 < pct,
  }
}
type R = ReturnType<typeof rng>
const nfd = (s: string) => s.normalize('NFD')
const WORDS = ['Žluťoučký', 'kůň', 'úpěl', 'ďábelské', 'ódy', 'řeka', 'Čtení', 'schůzka', 'příští', 'týden']
const words = (r: R, n: number) => Array.from({ length: 1 + r.below(n) }, () => r.pick(WORDS)).join(' ')

// ------------------------------------------------------------------------------------------------ map-properties

type Entry = { key: string; lines: string[]; shown: string | null; comment: string | null }
/** One frontmatter entry: its lines (without EOL), the Content value it should give (null when empty). */
function entry(r: R, key: string): Entry {
  const written = r.chance(25) ? nfd(key) : key
  const comment = r.chance(20) ? `# ${words(r, 2)}` : null
  const a = words(r, 2), b = words(r, 2)
  switch (r.below(6)) {
    case 0: return { key, lines: [`${written}: ${a}`], shown: a, comment }
    case 1: return { key, lines: [`${written}: '${a}'`], shown: a, comment }
    case 2: return { key, lines: [`${written}: "${a}"`], shown: a, comment }
    case 3: return { key, lines: [`${written}: [${a}, ${b}]`], shown: `${a}, ${b}`, comment }
    case 4: return { key, lines: [`${written}:`, `  - ${a}`, `  - ${b}`], shown: `${a}, ${b}`, comment }
    default: return { key, lines: [`${written}:`], shown: null, comment }
  }
}
const KEYS = ['autor', 'poznámka', 'místo', 'hodnocení', 'účel', 'štítek', 'vydáno', 'nálada']

type MapCase = { text: string; eol: string; final: boolean; body: string; map: { from: string; to: string }[]; labels: Record<string, string>; entries: Entry[]; tags: string }
function genMap(r: R): MapCase {
  const eol = r.chance(30) ? '\r\n' : '\n'
  const final = r.chance(75)
  const keys = KEYS.filter(() => r.chance(70))
  if (keys.length === 0) keys.push('autor')
  const entries = keys.map((k) => entry(r, k))
  // At least one non-empty value goes to Content.
  const filled = entries.find((e) => e.shown !== null) ?? Object.assign(entries[0], { lines: [`${entries[0].key}: ${words(r, 2)}`], shown: null as string | null })
  if (filled.shown === null) filled.shown = filled.lines[0].slice(filled.lines[0].indexOf(': ') + 2)
  const map: { from: string; to: string }[] = []
  for (const e of entries) {
    if (e === filled) map.push({ from: e.key, to: 'content' })
    else if (r.chance(40)) map.push({ from: e.key, to: 'content' })
    else if (r.chance(40)) map.push({ from: e.key, to: `${e.key}-nový` })
  }
  if (r.chance(30)) map.push({ from: 'chybějící', to: 'content' }) // a schema key the note lacks
  map.sort((x, y) => KEYS.indexOf(x.from) - KEYS.indexOf(y.from))
  const labels = Object.fromEntries([...KEYS, 'chybějící'].map((k) => [k, k[0].toUpperCase() + k.slice(1)]))
  const fm: string[] = ['id: 01JB4E0000000000000000E0P1', 'type: kniha', 'title: Náhodná']
  for (const e of entries) {
    // A comment line only above entries that stay or are renamed (a comment above a Content entry goes with it, L1).
    const toContent = map.some((m) => m.from === e.key && m.to === 'content')
    if (e.comment && !toContent) fm.push(e.comment)
    fm.push(...e.lines)
  }
  const tags = `tags: [${r.pick(WORDS).toLowerCase()}]`
  fm.push(tags)
  const paras = Array.from({ length: 1 + r.below(3) }, () => (r.chance(30) ? `## ${words(r, 2)}` : `${words(r, 5)}.`))
  let body = paras.join(eol + eol)
  if (final) body += eol
  const text = ['---', ...fm, '---'].join(eol) + eol + body
  return { text, eol, final, body, map, labels, entries, tags }
}

test('fr_fmt_07_ac26_map_properties_changes_only_its_own_lines_and_the_body_start', { timeout }, () => {
  for (const seed of seeds) {
    const r = rng(seed)
    for (let i = 0; i < runs; i++) {
      const c = genMap(r)
      const where = `seed = ${seed}, case ${i}:\n${JSON.stringify(c.text)}\nmap ${JSON.stringify(c.map)}`
      const res = transform('Knihy/Náhodná.md', c.text, [{ op: 'map-properties', map: c.map, labels: c.labels }])
      const out = res.kind === 'bytes' ? res.text : c.text
      const close = out.indexOf(`${c.eol}---${c.eol}`, 3)
      assert.ok(close > 0, `the frontmatter stays closed: ${where}`)
      const fmOut = out.slice(0, close + c.eol.length).split(c.eol).slice(1, -1)
      const bodyOut = out.slice(close + c.eol.length + 3 + c.eol.length)
      // Frontmatter: every line not owned by a mapped entry stays, in order; renamed keys keep their value bytes.
      const want: string[] = ['id: 01JB4E0000000000000000E0P1', 'type: kniha', 'title: Náhodná']
      const content: string[] = []
      for (const e of c.entries) {
        const m = c.map.find((x) => x.from === e.key)
        if (!m) { if (e.comment) want.push(e.comment); want.push(...e.lines); continue }
        if (m.to === 'content') { if (e.shown !== null) content.push(`**${c.labels[e.key]}:** ${e.shown}`); continue }
        if (e.comment) want.push(e.comment)
        const [first, ...rest] = e.lines
        want.push(`${m.to}${first.slice(first.indexOf(':'))}`, ...rest)
      }
      want.push(c.tags)
      assert.deepEqual(fmOut, want, `only the mapped lines change: ${where}`)
      // Body: the Content lines in map order, one blank line, then the old body byte for byte.
      const prefix = content.length ? content.join(c.eol) + c.eol + c.eol : ''
      assert.equal(bodyOut, prefix + c.body, `the body's start only: ${where}`)
      assert.equal(out.endsWith(c.eol), c.final || c.body === '', `final newline state kept: ${where}`)
      if (c.eol === '\r\n') assert.ok(!/[^\r]\n/.test(out), `CRLF everywhere: ${where}`)
    }
  }
})

// ------------------------------------------------------------------------------------------------ keep-targets

const STEMS = ['Řeka', 'Čaj o páté', 'Úvod', 'Plán cesty', 'Žába', 'Beta']
type Link = { line: string; markdown: boolean }

type MoveCase = { text: string; eol: string; paths: string[]; after: string[]; links: Link[]; code: string[] }
function genMove(r: R): MoveCase {
  const eol = r.chance(30) ? '\r\n' : '\n'
  const from = 'Pages/Přesouvaná.md', to = 'Knihy/Přesouvaná.md'
  const set = new Set<string>([from, 'Knihy/Jiná.md'])
  for (const s of STEMS) for (const f of ['Pages', 'Knihy', 'Projekty']) if (r.chance(40)) set.add(`${f}/${s}.md`)
  // At least one stem in both Pages/ and Knihy/: its bare link resolves elsewhere from the new folder.
  const both = r.pick(STEMS)
  set.add(`Pages/${both}.md`).add(`Knihy/${both}.md`)
  const paths = [...set].sort()
  const after = paths.map((p) => (p === from ? to : p))
  const stems = [...new Set(paths.map((p) => p.slice(p.indexOf('/') + 1, -3)))]
  const links: Link[] = []
  const code: string[] = []
  const lines: string[] = []
  const add = (l: Link) => { links.push(l); lines.push(`L${links.length}: ${l.line}`) }
  add({ line: `[[${both}]]`, markdown: false })
  for (let k = 0; k < 2 + r.below(6); k++) {
    const s = r.pick(stems)
    const w = r.chance(20) ? nfd(s) : s
    switch (r.below(8)) {
      case 0: add({ line: `[[${w}]]`, markdown: false }); break
      case 1: add({ line: `[[${w}|${words(r, 2)}]]`, markdown: false }); break
      case 2: add({ line: `[[${w}#Nadpis]]`, markdown: false }); break
      case 3: add({ line: `![[${w}]]`, markdown: false }); break
      case 4: add({ line: `[[Projekty/${w}]]`, markdown: false }); break
      case 5: add({ line: `[odkaz](${w.replace(/ /g, '%20')}.md)`, markdown: true }); break
      case 6: add({ line: `[odkaz](<${w}.md>)`, markdown: true }); break
      default: add({ line: `[odkaz](../Projekty/${w.replace(/ /g, '%20')}.md)`, markdown: true })
    }
    if (r.chance(30)) { const t = `C${code.length + 1}: \`[[${r.pick(stems)}]]\``; code.push(t); lines.push(t) }
    if (r.chance(30)) lines.push(`${words(r, 6)}.`)
  }
  const fm = ['---', 'id: 01JB4E0000000000000000E0P2', 'type: page', `title: ${r.chance(30) ? nfd('Přesouvaná') : 'Přesouvaná'}`, '---']
  const final = r.chance(75)
  const text = fm.join(eol) + eol + lines.join(eol + eol) + (final ? eol : '')
  return { text, eol, paths, after, links, code }
}
const WIKI = /!?\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/
const MD = /\[[^\]]*\]\((<[^>]+>|[^)\s]+)\)/
function targetOf(line: string): { target: string; markdown: boolean } | null {
  const w = WIKI.exec(line)
  if (w) return { target: w[1], markdown: false }
  const m = MD.exec(line)
  if (!m) return null
  const raw = m[1].startsWith('<') ? m[1].slice(1, -1) : m[1]
  let target = raw
  try { target = decodeURIComponent(raw) } catch { /* as written */ }
  return { target, markdown: true }
}
const same = (p: string | null) => (p === 'Pages/Přesouvaná.md' ? 'Knihy/Přesouvaná.md' : p)

test('fr_fmt_07_ac26_keep_targets_keeps_every_resolution_and_changes_only_link_targets', { timeout }, () => {
  for (const seed of seeds) {
    const r = rng(seed)
    for (let i = 0; i < runs; i++) {
      const c = genMove(r)
      const where = `seed = ${seed}, case ${i}:\n${JSON.stringify(c.text)}\npaths ${JSON.stringify(c.paths)}`
      const op: TextOp = { op: 'keep-targets', fromPath: 'Pages/Přesouvaná.md', toPath: 'Knihy/Přesouvaná.md', paths: c.paths }
      const res = transform('Pages/Přesouvaná.md', c.text, [op])
      const out = res.kind === 'bytes' ? res.text : c.text
      const outLines = out.split(c.eol)
      for (let n = 1; n <= c.links.length; n++) {
        const before = targetOf(c.links[n - 1].line)
        const line = outLines.find((l) => l.startsWith(`L${n}: `))
        assert.ok(before && line, `link L${n} is still there: ${where}`)
        const now = targetOf(line!.slice(`L${n}: `.length))
        assert.ok(now, `L${n} is still a link: ${line} — ${where}`)
        const was = same(resolveFrom('Pages/Přesouvaná.md', before!.target, before!.markdown, c.paths))
        const is = resolveFrom('Knihy/Přesouvaná.md', now!.target, now!.markdown, c.after)
        assert.equal(is, was, `L${n} ${c.links[n - 1].line} → ${line}: same file from the new folder — ${where}`)
      }
      for (const t of c.code) assert.ok(outLines.includes(t), `code spans are untouched: ${t} — ${where}`)
      // Bytes outside the reported edits are unchanged, and every edit lies inside one link line.
      if (res.kind === 'bytes') {
        const inB = Buffer.from(c.text, 'utf8')
        const outB = Buffer.from(out, 'utf8')
        let at = 0
        let prev = 0
        for (const e of [...res.edits].sort((a, b) => a.start - b.start)) {
          const seg = inB.subarray(prev, e.start)
          const found = outB.indexOf(seg, at)
          assert.ok(found === at || (prev > 0 && found >= at), `bytes before an edit unchanged: ${where}`)
          at = found + seg.length
          const lineStart = inB.lastIndexOf(Buffer.from(c.eol), e.start) + 1
          assert.ok(/^L\d+: /.test(inB.subarray(lineStart, lineStart + 8).toString('utf8')), `an edit lies in a link line: ${where}`)
          prev = e.end
        }
        assert.ok(outB.subarray(outB.length - (inB.length - prev)).equals(inB.subarray(prev)), `the tail after the last edit is unchanged: ${where}`)
      }
    }
  }
})
