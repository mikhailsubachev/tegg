// Static AC checks for AR-03 (core, UI and platform are separate), TypeScript side.
// These read source files and imports, so they already pass on the skeleton (they cannot be red).
import { test, expect } from 'vitest'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = fileURLToPath(new URL('../../../', import.meta.url))
const PACKAGES = join(REPO, 'packages')

function sources(dir: string): string[] {
  const out: string[] = []
  if (!existsSync(dir)) return out
  for (const name of readdirSync(dir).sort()) {
    if (name === 'node_modules' || name === 'dist') continue
    const p = join(dir, name)
    if (statSync(p).isDirectory()) out.push(...sources(p))
    else if (/\.(ts|tsx|js|mjs)$/.test(name)) out.push(p)
  }
  return out
}

const packageSources = () =>
  readdirSync(PACKAGES).flatMap((pkg) => sources(join(PACKAGES, pkg, 'src')))

function importSpecifiers(text: string): string[] {
  const re = /(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)|require\(\s*['"]([^'"]+)['"]\s*\)|^\s*import\s*['"]([^'"]+)['"]/gm
  return [...text.matchAll(re)].map((m) => m[1] ?? m[2] ?? m[3] ?? m[4]!)
}

test('ar_03_ac2_packages_do_not_import_tauri_app_or_dom_only_apis', () => {
  const files = packageSources()
  expect(files.length).toBeGreaterThan(0)
  const problems: string[] = []
  for (const f of files) {
    const text = readFileSync(f, 'utf8')
    const rel = relative(REPO, f)
    for (const spec of importSpecifiers(text)) {
      if (spec.startsWith('@tauri-apps/')) problems.push(`${rel}: imports ${spec}`)
      if (/(^|\/)app\//.test(spec) || spec.includes('src-tauri')) problems.push(`${rel}: imports ${spec}`)
      if (spec.includes('spikes/')) problems.push(`${rel}: imports ${spec}`)
    }
    // D-214: packages/editor is a UI package (TipTap needs the DOM); the DOM clause covers the platform-neutral ones.
    if (!rel.startsWith('packages/editor/') && /\b(window|document)\s*\.|\blocalStorage\b|\bsessionStorage\b|\bHTMLElement\b/.test(text)) {
      problems.push(`${rel}: uses a DOM-only API`)
    }
  }
  expect(problems).toEqual([])
})

test('ar_03_ac5_packages_reference_no_menu_bar_or_hotkey_symbols', () => {
  const problems: string[] = []
  for (const f of packageSources()) {
    const text = readFileSync(f, 'utf8')
    if (/globalShortcut|global-shortcut|TrayIcon|NSStatusItem|NSStatusBar|menuBar|ShareExtension/i.test(text)) {
      problems.push(relative(REPO, f))
    }
  }
  expect(problems).toEqual([])
})
