// MS1 extra AC tests: FR-SYN-06 AC-4, NFR-POR-01 AC-2, AR-03 AC-4, AR-06 AC-3.
// Written from docs/acceptance/*.md and docs/contracts/ms1-core.md §4 only (D-61).
import { describe, test, expect } from 'vitest'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseDocument } from 'yaml'
import { micromark } from 'micromark'

const REPO = fileURLToPath(new URL('../../../', import.meta.url))
const ROUNDTRIP = join(REPO, 'tests/fixtures/format/roundtrip')
const SELF = fileURLToPath(import.meta.url)
const NOW1 = '2026-10-09T14:30:00+02:00'
const NOW2 = '2026-10-11T09:15:00+02:00'

async function doc() { return await import('../src/index.js') }

function walk(dir: string, accept: (p: string) => boolean, skipDirs = new Set(['node_modules', 'target', '.git'])): string[] {
  const out: string[] = []
  if (!existsSync(dir)) return out
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) { if (!skipDirs.has(name)) out.push(...walk(p, accept, skipDirs)) }
    else if (accept(p)) out.push(p)
  }
  return out
}

function fmField(text: string, key: string): string | null {
  const m = text.match(/^﻿?---\r?\n([\s\S]*?)\r?\n---/)
  if (!m) return null
  const line = m[1].split(/\r?\n/).find((l) => l.startsWith(key + ':'))
  return line === undefined ? null : line.slice(key.length + 1).trim().replace(/^["']|["']$/g, '')
}

// ---------------------------------------------------------------- FR-SYN-06 AC-4

describe('FR-SYN-06 AC-4', () => {
  const base = async () => {
    const d = await doc()
    let n = 0
    const text = d.newNote({ type: 'Page', title: 'Čeština', attributes: [['stav', 'rozpracováno']],
      body: 'Příliš žluťoučký kůň.\n', now: NOW1, newId: () => '01JA0000000000000000000' + String(n++).padStart(3, '0') })
    return { d, text }
  }

  test('fr_syn_06_ac4_identical_attribute_value_leaves_modified_untouched', async () => {
    const { d, text } = await base()
    const after = d.setAttribute(d.parse(text), 'stav', 'rozpracováno')
    const touched = d.touchModified(text, after, NOW2)
    expect(touched).toBe(text)
    expect(fmField(touched, 'modified')).toBe(NOW1)
  })

  test('fr_syn_06_ac4_identical_block_edit_leaves_modified_untouched', async () => {
    const { d, text } = await base()
    const p = d.parse(text)
    const idx = p.blocks.findIndex((b) => b.kind === 'paragraph')
    expect(idx).toBeGreaterThanOrEqual(0)
    const after = d.editBlock(p, idx, p.blocks[idx].raw)
    expect(after).toBe(text)
    expect(d.touchModified(text, after, NOW2)).toBe(text)
  })

  test('fr_syn_06_ac4_real_change_updates_modified_and_keeps_created', async () => {
    const { d, text } = await base()
    const created = fmField(text, 'created')
    expect(created).toBe(NOW1)
    const p = d.parse(text)
    const idx = p.blocks.findIndex((b) => b.kind === 'paragraph')
    const edited = d.touchModified(text, d.editBlock(p, idx, 'Úplně nový text.'), NOW2)
    expect(fmField(edited, 'modified')).toBe(NOW2)
    expect(fmField(edited, 'created')).toBe(created)
    expect(edited).toContain('Úplně nový text.')
    const attr = d.touchModified(text, d.setAttribute(d.parse(text), 'stav', 'hotovo'), NOW2)
    expect(fmField(attr, 'modified')).toBe(NOW2)
    expect(fmField(attr, 'created')).toBe(created)
    expect(fmField(attr, 'stav')).toBe('hotovo')
  })
})

// ---------------------------------------------------------------- NFR-POR-01 AC-2

function assertStrictlyParses(text: string, label: string): void {
  const t = text.replace(/^﻿/, '')
  const m = t.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)
  if (m) {
    const y = parseDocument(m[1], { strict: true, uniqueKeys: true, prettyErrors: false })
    expect({ label, errors: y.errors.map((e) => e.message), warnings: y.warnings.map((w) => w.message) })
      .toEqual({ label, errors: [], warnings: [] })
  }
  const body = m ? t.slice(m[0].length) : t
  let err: string | null = null
  try { micromark(body) } catch (e) { err = String(e) }
  expect({ label, err }).toEqual({ label, err: null })
}

function originalYamlIsClean(text: string): boolean {
  const m = text.replace(/^﻿/, '').match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)
  if (!m) return true
  const y = parseDocument(m[1], { strict: true, uniqueKeys: true })
  return y.errors.length === 0 && y.warnings.length === 0
}

describe('NFR-POR-01 AC-2', () => {
  test('nfr_por_01_ac2_new_notes_with_every_value_type_parse_as_yaml_and_commonmark', async () => {
    const d = await doc()
    let n = 0
    const newId = () => '01JA0000000000000000000' + String(n++).padStart(3, '0')
    const notes: string[] = []
    for (const type of ['Page', 'Task', 'Quick Note', 'Daily Note', 'Kniha čtení']) {
      const text = d.newNote({
        type, title: 'Žluťoučký kůň: "úpěl" # ďábelské ódy [1]', newId, now: NOW1,
        attributes: [
          ['text', 'Příliš žluťoučký kůň'], ['číslo', 42.5], ['hotovo', true], ['prázdné', null],
          ['datum', { date: '2026-10-09' }], ['čas', { datetime: '2026-10-09T14:30:00+02:00' }],
          ['autor', { link: 'Karel Čapek' }], ['štítky', ['česky', 'ěščřžýáíé', 'a: b', '#x']],
          ['vztahy', [{ link: 'Čtení' }, { link: 'Kniha (2)' }]], ['víceřádkový', 'řádek 1\nřádek 2'],
        ],
        body: '# Nadpis ěščř\n\nOdstavec s [[Odkaz|alias]] a #štítek.\n\n- [ ] úkol\n- [x] hotovo\n\n> [!note] Poznámka\n> text\n',
      })
      assertStrictlyParses(text, `newNote ${type}`)
      let ranged: string | null = null
      let err: string | null = null
      try { ranged = d.setDateRange(d.parse(text), 'cesta', '2026-07-01', '2026-07-14') } catch (e) { err = String(e) }
      expect({ type, err }).toEqual({ type, err: null })
      assertStrictlyParses(ranged!, `newNote ${type} + setDateRange`)
      notes.push(text)
    }
    expect(notes.length).toBe(5)
  })

  test('nfr_por_01_ac2_edited_roundtrip_fixtures_parse_as_yaml_and_commonmark', async () => {
    const d = await doc()
    const files = walk(ROUNDTRIP, (p) => p.endsWith('.md') && !p.endsWith('README.md'))
    expect(files.length).toBeGreaterThanOrEqual(30)
    let checked = 0
    for (const f of files) {
      const text = d.decode(new Uint8Array(readFileSync(f)))
      if (!originalYamlIsClean(text)) continue // input not written by Tegg
      const label = relative(ROUNDTRIP, f)
      const p = d.parse(text)
      const outs = [
        d.setAttribute(p, 'stav', 'přečteno'),
        d.setAttribute(p, 'datum', { date: '2026-10-09' }),
        d.setAttribute(p, 'odkazy', [{ link: 'Čtení' }, 'ěšč']),
      ]
      const idx = p.blocks.findIndex((b) => b.kind === 'paragraph')
      if (idx >= 0) outs.push(d.editBlock(p, idx, 'Nový odstavec s [[Čtení]] a #štítek.'))
      outs.forEach((o, k) => assertStrictlyParses(o, `${label} edit ${k}`))
      checked++
    }
    expect(checked).toBeGreaterThanOrEqual(20)
  })
})

// ---------------------------------------------------------------- AR-03 AC-4

describe('AR-03 AC-4', () => {
  const FORBIDDEN: [string, RegExp][] = [
    // imports/uses only: the existing L0 checkers name these strings as data, which is not a reference to the shell
    ['tauri import', /(?:from\s+|import\s*\(\s*|require\s*\(\s*)['"`][^'"`]*tauri[^'"`]*['"`]|\buse\s+tauri\w*|\btauri(?:_\w+)?::|extern\s+crate\s+tauri/],
    ['app/ import', /(?:from\s+|import\s*\(\s*|require\s*\(\s*)['"`](?:\.\.\/)*app\//],
    ['webview', /webview/i], ['WKWebView', /WKWebView/], ['launches the app', /\bopen\s+-a\b|\.app\/Contents\/MacOS|tegg\.app/i],
  ]

  test('ar_03_ac4_core_test_files_do_not_reference_desktop_shell_or_webview', () => {
    const files = [
      ...readdirSync(join(REPO, 'crates')).flatMap((c) => walk(join(REPO, 'crates', c, 'tests'), () => true)),
      ...readdirSync(join(REPO, 'packages')).flatMap((p) => walk(join(REPO, 'packages', p, 'test'), () => true)),
    ].filter((f) => f !== SELF && /\.(rs|ts|tsx|js|mjs)$/.test(f))
    expect(files.length).toBeGreaterThan(0)
    const hits: string[] = []
    for (const f of files) {
      const src = readFileSync(f, 'utf8')
      for (const [name, re] of FORBIDDEN) if (re.test(src)) hits.push(`${relative(REPO, f)}: ${name}`)
    }
    expect(hits).toEqual([])
  })

  test('ar_03_ac4_crate_dev_dependencies_contain_no_tauri_crate', () => {
    const hits: string[] = []
    const crates = readdirSync(join(REPO, 'crates')).filter((c) => existsSync(join(REPO, 'crates', c, 'Cargo.toml')))
    expect(crates.length).toBeGreaterThan(0)
    for (const c of crates) {
      const toml = readFileSync(join(REPO, 'crates', c, 'Cargo.toml'), 'utf8')
      const sections = toml.split(/^(?=\[)/m).filter((s) => /^\[(?:target\..*\.)?dev-dependencies/.test(s))
      for (const s of sections) if (/tauri/i.test(s)) hits.push(c)
    }
    expect(hits).toEqual([])
  })
})

// ---------------------------------------------------------------- AR-06 AC-3 [real-export]
// Local only: runs only with TEGG_REAL_EXPORTS=1 and `test exports/` present (D-62), started by the owner.
// PRIVACY (TS-P2): prints counts and file indexes only.

const EXPORTS = join(REPO, 'test exports')
const zips = process.env.TEGG_REAL_EXPORTS === '1' && existsSync(EXPORTS)
  ? readdirSync(EXPORTS).filter((f) => f.endsWith('.zip')) : []

describe.skipIf(zips.length === 0)('AR-06 AC-3 real exports (local only, counts only)', () => {
  test.each(zips.map((z, i) => [`export #${i + 1}`, z] as const))('ar_06_ac3_real_export_roundtrip_failures_are_zero: %s', async (label, zip) => {
    const d = await doc()
    // yauzl is not a devDependency of @tegg/doc yet; a missing module fails here as an assertion.
    let yauzl: any = null
    try { yauzl = (await import('yauzl' as string)).default } catch { yauzl = null }
    expect(yauzl === null ? 'yauzl missing' : 'ok').toBe('ok')
    const entries: Buffer[] = await new Promise((resolve, reject) => {
      yauzl.open(join(EXPORTS, zip), { lazyEntries: true, decodeStrings: true, strictFileNames: false }, (err: any, z: any) => {
        if (err || !z) return reject(err)
        const out: Buffer[] = []
        z.on('entry', (e: any) => {
          if (!e.fileName.endsWith('.md')) return z.readEntry()
          z.openReadStream(e, (err2: any, s: any) => {
            if (err2 || !s) return reject(err2)
            const chunks: Buffer[] = []
            s.on('data', (c: Buffer) => chunks.push(c))
            s.on('end', () => { out.push(Buffer.concat(chunks)); z.readEntry() })
          })
        })
        z.on('end', () => resolve(out)); z.on('error', reject); z.readEntry()
      })
    })
    const failing: number[] = []
    entries.forEach((bytes, i) => {
      try {
        const p = d.parse(d.decode(new Uint8Array(bytes)))
        if (!Buffer.from(d.encode(d.serialize(p))).equals(bytes)) failing.push(i)
      } catch { failing.push(i) }
    })
    console.log(`${label}: markdown=${entries.length} roundtripFailed=${failing.length}`,
      failing.length ? `failing file indexes: ${failing.slice(0, 30).join(',')}` : '')
    expect(failing.length).toBe(0)
  }, 300_000)
})
