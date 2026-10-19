// MS5 slice 5B, L2 property tests of the Inbox text changes (docs/acceptance/inbox.md FR-FMT-07 AC-21, FR-INB-04 AC-3;
// docs/contracts/ms5-capture.md §7.3): `applyInboxChange` on notes of the round-trip corpus (tests/fixtures/format/
// roundtrip, the notes whose frontmatter parses) and on generated notes with comments, flow and block lists, quoted
// scalars, CRLF, NFD, a BOM and no final newline.
//  - AC-21: random sequences of mark reviewed, mark unreviewed, add tags and link to change no byte outside the
//    `review`, `tags` and `modified` lines (keys that were missing are appended) and the appended link paragraphs; line
//    endings, BOM and final-newline state are kept; reviewed then unreviewed gives the original bytes except `modified`
//    (and the keys now present).
//  - FR-INB-04 AC-3: converting to a random capture target changes no byte outside the `type`, `review` and `modified`
//    lines, keeps `id`, and leaves every link (target, alias, position in the body) unchanged — the path is unchanged,
//    so resolution and backlinks are too.
// Seeds (TS-L2): a fixed seed plus `QA_SEED` (else the clock); `QA_PROPERTY_SCALE` ≥ 100 runs 10 seeds × 500 notes.
// Every seed is printed. Written from the ACs and the contract only (D-61). The module loads inside the test (TS-I1).
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

const REPO = resolve(import.meta.dirname, '../../..')
const FIXED_SEED = 20261019
const scale = Number(process.env.QA_PROPERTY_SCALE ?? '1') || 1
const randomSeed = Number(process.env.QA_SEED ?? '') || Date.now() % 2 ** 31
const seeds = scale >= 100 ? Array.from({ length: 10 }, (_, i) => (i === 0 ? FIXED_SEED : randomSeed + i)) : [FIXED_SEED, randomSeed]
const runs = scale >= 100 ? 500 : 60

type Mod = Record<string, any>
async function doc(): Promise<Mod> {
  const m = (await import(/* @vite-ignore */ String('../src/index.ts'))) as Mod
  for (const k of ['applyInboxChange', 'parse', 'wikilinks']) assert.equal(typeof m[k], 'function', `@tegg/doc exports ${k}`)
  return m
}

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

function corpus(m: Mod): string[] {
  const out: string[] = []
  const walk = (d: string) => {
    for (const n of readdirSync(d)) {
      const p = join(d, n)
      if (statSync(p).isDirectory()) walk(p)
      else if (n.endsWith('.md') && n !== 'README.md') {
        const t = readFileSync(p, 'utf8')
        const fm = m.parse(t).frontmatter
        if (fm && !fm.error) out.push(t)
      }
    }
  }
  walk(resolve(REPO, 'tests/fixtures/format/roundtrip'))
  return out
}

const WORDS = ['Čaj', 'ěščřžýáíé', 'odstavec', 'Žluťoučký kůň', 'konec', 'viz']
/** A generated note: a frontmatter with a random subset of features and a body with links. */
function gen(r: R): string {
  const lines: string[] = ['---', 'id: 01JB5B0000000000000000P' + String(r.below(1000)).padStart(3, '0'), `type: ${r.pick(['quick-note', 'page', 'nápad', 'task'])}`]
  const title = r.pick(WORDS)
  lines.push(r.chance(30) ? `title: "${title}"` : `title: ${r.chance(20) ? title.normalize('NFD') : title}`)
  if (r.chance(40)) lines.push('# komentář: ručně')
  if (r.chance(40)) lines.push(r.chance(50) ? 'aliases: [Jiný, "S: dvojtečkou"]' : 'aliases:\n  - Jiný\n  - Druhý')
  if (r.chance(50)) lines.push(r.chance(50) ? `tags: [${r.pick(['nákup', 'práce'])}]` : 'tags:\n  - nákup\n  - práce')
  if (r.chance(60)) lines.push(`review: ${r.pick(['unreviewed', '"unreviewed"', "'reviewed'", 'maybe', 'reviewed'])}`)
  if (r.chance(30)) lines.push('místnost: A2')
  if (r.chance(70)) lines.push('created: 2026-10-01T09:00:00+02:00')
  if (r.chance(70)) lines.push('modified: 2026-10-01T09:00:00+02:00')
  lines.push('---')
  const body: string[] = []
  for (let i = 0, n = r.below(4); i < n; i++) {
    const k = r.below(4)
    if (k === 0) body.push(`## ${r.pick(WORDS)}`)
    else if (k === 1) body.push(`- ${r.pick(WORDS)} [[Plán webu]]\n- [[Dvojník|jiný text]]`)
    else if (k === 2) body.push('```\n[[V kódu]]\n```')
    else body.push(`${r.pick(WORDS)} [[${r.pick(['Plán webu', 'Nápad na článek'])}]] #${r.pick(['nákup', 'doma'])}`)
  }
  return lines.join('\n') + '\n' + body.join('\n\n') + (body.length ? '\n' : '')
}
/** The envelope variants of AC-21: CRLF, BOM, no final newline. */
function envelope(r: R, t: string): string {
  let out = t
  if (r.chance(30)) out = out.replace(/\r?\n/g, '\r\n')
  if (r.chance(20) && !out.startsWith('﻿')) out = '﻿' + out // one BOM at most, as in a real file
  if (r.chance(25)) out = out.replace(/(\r?\n)+$/, '')
  return out
}

/** Text lines with their endings. */
const linesOf = (t: string) => t.match(/[^\r\n]*(\r\n|\n|$)/g)!.filter((l) => l !== '')
/** The frontmatter's line range (inclusive `---` lines), or null. */
function fmRange(lines: string[]): [number, number] | null {
  const first = lines[0]?.replace(/^﻿/, '').replace(/\r?\n$/, '')
  if (first !== '---') return null
  for (let i = 1; i < lines.length; i++) if (lines[i].replace(/\r?\n$/, '') === '---') return [0, i]
  return null
}
/** The text without the frontmatter lines of `keys` (block-list continuation lines included) and without the trailing
 *  appended paragraphs `paras` (each preceded by a blank line). */
function strip(t: string, keys: string[], paras: string[] = []): string {
  const lines = linesOf(t)
  const fm = fmRange(lines)
  const keep: string[] = []
  let drop = false
  for (let i = 0; i < lines.length; i++) {
    if (fm && i > fm[0] && i < fm[1]) {
      const l = lines[i]
      const key = /^([^\s:#][^:]*):/.exec(l)?.[1]
      if (key !== undefined) drop = keys.includes(key.trim())
      else if (!/^\s+-\s/.test(l)) drop = false
      if (drop) continue
    }
    keep.push(lines[i])
  }
  let out = keep.join('')
  if (paras.length === 0) return out
  // Appended paragraphs (each after a blank line) are removed from the end; trailing line breaks are then ignored on
  // both sides of the comparison (the envelope check covers the final-newline state).
  const esc = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  for (const p of [...paras].reverse()) out = out.replace(new RegExp(`(?:\\r?\\n)*${esc(p)}(?:\\r?\\n)*$`), '')
  return out.replace(/(\r?\n)+$/, '')
}
const noTrail = (t: string) => t.replace(/(\r?\n)+$/, '')
const fmValue = (m: Mod, t: string, k: string) => m.parse(t).frontmatter?.data?.[k]
const envelopeOf = (t: string) => ({ bom: t.startsWith('﻿'), crlf: /\r\n/.test(t), lf: /(^|[^\r])\n/.test(t), finalNewline: /\n$/.test(t) })

test('fr_fmt_07_ac21_inbox_changes_touch_only_their_lines', async () => {
  const m = await doc()
  const notes = corpus(m)
  assert.ok(notes.length >= 5, `corpus notes with valid frontmatter: ${notes.length}`)
  for (const seed of seeds) {
    console.log(`fr_fmt_07_ac21 seed = ${seed}`)
    const r = rng(seed)
    for (let i = 0; i < runs; i++) {
      const original = envelope(r, r.chance(40) ? r.pick(notes) : gen(r))
      let text = original
      const paras: string[] = []
      const steps: string[] = []
      for (let s = 0, n = 1 + r.below(4); s < n; s++) {
        const now = `2026-10-14T12:0${s}:00+02:00`
        const k = r.below(4)
        const change = k === 0 ? { op: 'set-review', value: 'reviewed', now } : k === 1 ? { op: 'set-review', value: 'unreviewed', now }
          : k === 2 ? { op: 'add-tags', tags: [r.pick(['doma', 'nákup', 'výlet'])], now } : { op: 'append-link', target: r.pick(['Plán webu', 'Pages/Dvojník|Dvojník']), now }
        steps.push(JSON.stringify(change))
        const res = m.applyInboxChange(text, change)
        const next = res.kind === 'bytes' ? (res.text as string) : text
        const where = `seed ${seed} note ${i} after ${steps.join(' → ')}`
        if (change.op === 'set-review') assert.equal(fmValue(m, next, 'review'), change.value, `${where}: review is ${change.value}`)
        if (change.op === 'add-tags') {
          const tags = fmValue(m, next, 'tags') as unknown
          assert.ok(Array.isArray(tags) && tags.some((x) => m.tagKey(String(x)) === m.tagKey(change.tags![0])), `${where}: tags hold ${change.tags![0]}`)
        }
        if (change.op === 'append-link') {
          paras.push(`[[${change.target}]]`)
          assert.ok(next.replace(/\r?\n$/, '').endsWith(`[[${change.target}]]`), `${where}: the link paragraph is last`)
        }
        if (res.kind === 'bytes') assert.ok(new RegExp(`^modified: ${now.replace(/\+/g, '\\+')}\r?$`, 'm').test(next), `${where}: modified = ${now}`)
        text = next
      }
      const where = `seed ${seed} note ${i} (${steps.join(' → ')})`
      const was = strip(original, ['review', 'tags', 'modified'])
      assert.equal(strip(text, ['review', 'tags', 'modified'], paras), paras.length ? noTrail(was) : was, `${where}: no byte outside review/tags/modified and the link paragraphs`)
      assert.deepEqual(envelopeOf(text), envelopeOf(original), `${where}: BOM, line endings and final newline kept`)
    }
  }
})

test('fr_fmt_07_ac21_reviewed_then_unreviewed_gives_the_original_bytes', async () => {
  const m = await doc()
  const notes = corpus(m)
  for (const seed of seeds) {
    console.log(`fr_fmt_07_ac21 round seed = ${seed}`)
    const r = rng(seed)
    for (let i = 0; i < runs; i++) {
      // Start from an unreviewed note that has `modified` (so only `modified` differs afterwards).
      let original = envelope(r, r.chance(40) ? r.pick(notes) : gen(r))
      const once = m.applyInboxChange(original, { op: 'set-review', value: 'unreviewed', now: '2026-10-01T09:00:00+02:00' })
      if (once.kind === 'bytes') original = once.text
      const a = m.applyInboxChange(original, { op: 'set-review', value: 'reviewed', now: '2026-10-14T12:00:00+02:00' })
      assert.equal(a.kind, 'bytes', `seed ${seed} note ${i}: marking reviewed changes the file`)
      const b = m.applyInboxChange(a.text, { op: 'set-review', value: 'unreviewed', now: '2026-10-14T12:01:00+02:00' })
      assert.equal(b.kind, 'bytes', `seed ${seed} note ${i}: marking unreviewed changes it back`)
      assert.equal(strip(b.text, ['modified']), strip(original, ['modified']), `seed ${seed} note ${i}: the original bytes except modified`)
    }
  }
})

test('fr_inb_04_ac3_convert_changes_only_type_review_modified_and_keeps_links', async () => {
  const m = await doc()
  const notes = corpus(m)
  const TARGETS = ['page', 'task', 'quick-note', 'nápad', 'schůzka']
  for (const seed of seeds) {
    console.log(`fr_inb_04_ac3 seed = ${seed}`)
    const r = rng(seed)
    for (let i = 0; i < runs; i++) {
      const original = envelope(r, r.chance(40) ? r.pick(notes) : gen(r))
      const to = r.pick(TARGETS)
      const res = m.applyInboxChange(original, { op: 'set-type', type: to, now: '2026-10-14T12:00:00+02:00' })
      const where = `seed ${seed} note ${i} → ${to}`
      const after = res.kind === 'bytes' ? (res.text as string) : original
      assert.equal(fmValue(m, after, 'type'), to, `${where}: type is ${to}`)
      assert.equal(fmValue(m, after, 'review'), 'reviewed', `${where}: review is reviewed (D-557)`)
      assert.equal(strip(after, ['type', 'review', 'modified']), strip(original, ['type', 'review', 'modified']), `${where}: no other byte changes`)
      assert.equal(fmValue(m, after, 'id'), fmValue(m, original, 'id'), `${where}: id kept`)
      const links = (t: string) => m.wikilinks(m.parse(t)).filter((l: any) => !l.inFrontmatter).map((l: any) => [l.target, l.alias, l.subpath, l.embed, t.slice(l.range[0], l.range[1])])
      assert.deepEqual(links(after), links(original), `${where}: every body link unchanged`)
      assert.deepEqual(envelopeOf(after), envelopeOf(original), `${where}: envelope kept`)
    }
  }
})
