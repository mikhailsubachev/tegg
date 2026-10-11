// Static AC checks for AR-06 (round-trip corpus) and FR-FMT-07 AC-7 (round-trip tests run on every change).
// These check committed files and configuration, so they already pass before the implementation exists
// (they cannot be red, see the test-author report).
import { test, expect } from 'vitest'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = fileURLToPath(new URL('../../../', import.meta.url))
const ROUNDTRIP = join(REPO, 'tests/fixtures/format/roundtrip')

function mdFiles(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) out.push(...mdFiles(p))
    else if (name.endsWith('.md')) out.push(p)
  }
  return out
}
const textOf = (folder: string) => mdFiles(join(ROUNDTRIP, folder)).map((f) => readFileSync(f, 'utf8')).join('\n')

test('ar_06_ac1_corpus_has_the_required_number_of_notes_per_style', () => {
  expect({
    obsidian: mdFiles(join(ROUNDTRIP, 'obsidian')).length >= 10,
    capacities: mdFiles(join(ROUNDTRIP, 'capacities')).length >= 10,
    notion: mdFiles(join(ROUNDTRIP, 'notion')).length >= 5,
    tegg: mdFiles(join(ROUNDTRIP, 'tegg')).length >= 5,
  }).toEqual({ obsidian: true, capacities: true, notion: true, tegg: true })
})

test('ar_06_ac1_obsidian_notes_cover_the_required_features', () => {
  const t = textOf('obsidian')
  const features: Record<string, RegExp> = {
    callout: /^> \[![a-z]+\]/m,
    blockId: / \^[A-Za-z0-9-]+$/m,
    sizedEmbed: /!\[\[[^\]|]+\|\d+(x\d+)?\]\]/,
    headingLink: /\[\[[^\]#]*#[^^\]][^\]]*\]\]/,
    table: /^\|.*\|\s*$\n^\|\s*:?-{3,}/m,
    nestedList: /^[-*+] .*\n(?:.*\n)*?^ {2,}[-*+] /m,
    checklist: /^\s*[-*+] \[[ xX]\] /m,
    inlineTag: /(^|\s)#[\p{L}][\p{L}\p{N}_\/-]*/mu,
    frontmatterTags: /^tags:/m,
  }
  const missing = Object.entries(features).filter(([, re]) => !re.test(t)).map(([k]) => k)
  expect(missing).toEqual([])
})

test('ar_06_ac1_tegg_notes_use_every_mvp_block_type', () => {
  const t = textOf('tegg')
  const blocks: Record<string, RegExp> = {
    heading: /^#{1,3} \S/m,
    bulletList: /^- (?!\[)/m,
    numberedList: /^1\. /m,
    checklist: /^- \[[ x]\] /m,
    quote: /^> (?!\[!)/m,
    callout: /^> \[!note\]/m,
    code: /^```[a-z]+\n/m,
    divider: /\n\n---\n\n/,
    table: /^\| --- \|/m,
    embed: /^!\[\[[^\]]+\]\]$/m,
    mindmap: /^```mermaid\nmindmap$/m,
    query: /^```query\n/m,
  }
  const missing = Object.entries(blocks).filter(([, re]) => !re.test(t)).map(([k]) => k)
  expect(missing).toEqual([])
})

test('ar_06_ac2_every_content_finding_maps_to_an_existing_fixture', () => {
  const readme = readFileSync(join(ROUNDTRIP, 'README.md'), 'utf8')
  const required = ['C2', 'C3', 'C4', 'C5', 'C6', 'C7', 'C9', 'C10', 'C11', 'C12', 'C13', 'C14', 'C15', 'C16', 'C17', 'C18',
    'N1', 'N3', 'N4', 'N5', 'N6', 'N8', 'N9']
  const problems: string[] = []
  for (const id of required) {
    const row = readme.split('\n').find((l) => l.startsWith(`| ${id} `))
    if (!row) { problems.push(`${id}: no README row`); continue }
    const cells = row.split('|').map((c) => c.trim())
    const refs = [...(cells[2] ?? '').matchAll(/`([^`]+)`/g)].map((m) => m[1]!).filter((r) => r.includes('/'))
    if (refs.length === 0) { problems.push(`${id}: no fixture reference`); continue }
    for (const ref of refs) {
      const p = join(ROUNDTRIP, ref)
      if (ref.endsWith('/')) { if (!existsSync(p)) problems.push(`${id}: ${ref}`); continue }
      if (ref.includes('…')) {
        const slash = ref.lastIndexOf('/')
        const dir = join(ROUNDTRIP, ref.slice(0, slash))
        const prefix = ref.slice(slash + 1, ref.indexOf('…')).normalize('NFC')
        const ok = existsSync(dir) && readdirSync(dir).some((n) => n.normalize('NFC').startsWith(prefix) && n.endsWith('.md'))
        if (!ok) problems.push(`${id}: ${ref}`)
        continue
      }
      if (!existsSync(p)) problems.push(`${id}: ${ref}`)
    }
  }
  expect(problems).toEqual([])
})

test('fr_fmt_07_ac7_round_trip_suite_runs_in_the_push_gate', () => {
  const config = JSON.parse(readFileSync(join(REPO, 'qa.config.json'), 'utf8')) as {
    steps: { dir: string; run: string; level: string }[]
  }
  const docSteps = config.steps.filter((s) => s.dir === 'packages/doc' && /vitest run/.test(s.run) && ['commit', 'push'].includes(s.level))
  expect(docSteps.length).toBeGreaterThanOrEqual(1)
  expect(existsSync(join(REPO, 'packages/doc/test/roundtrip.ac.test.ts'))).toBe(true)
})
