import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { decode } from '../src/parse.js'

export const FIXTURE_ROOT = join(import.meta.dirname, '../../../tests/fixtures/format/roundtrip')

export interface Fixture {
  rel: string // path relative to the fixture root, as stored on disk (may be NFD)
  bytes: Uint8Array
  text: string
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name)
    return statSync(p).isDirectory() ? walk(p) : [p]
  })
}

export const fixtures: Fixture[] = walk(FIXTURE_ROOT)
  .filter((p) => p.endsWith('.md') && !p.endsWith('README.md'))
  .sort()
  .map((p) => {
    const bytes = new Uint8Array(readFileSync(p))
    return { rel: relative(FIXTURE_ROOT, p), bytes, text: decode(bytes) }
  })

export const byName = (suffix: string): Fixture => {
  const f = fixtures.find((x) => x.rel.normalize('NFC').endsWith(suffix.normalize('NFC')))
  if (!f) throw new Error(`No fixture ${suffix}`)
  return f
}

// ---------------------------------------------------------------- simulated editor edit

import type { Nodes, Parent, RootContent } from 'mdast'
import { renderBlock } from '../src/edit.js'

/**
 * Simulate a user typing at the end of a block: append " edited" as a new text node to the
 * block's last paragraph/heading/table cell, or a line to a code block. Like a real edit, it
 * never touches the block's leading syntax (callout marker, `mindmap` line, list markers).
 * Returns the re-rendered block, or null if the block has nothing editable (e.g. a divider).
 */
export function simulateEdit(node: RootContent, originalRaw: string): string | null {
  // An embed block is one unit in the editor (no text to type into); it is replaced, not edited.
  if (/^!\[\[[^\]\n]+\]\]$/.test(originalRaw.trim())) return null
  const clone = structuredClone(node) as Nodes
  if (clone.type === 'code') {
    clone.value += '\n    edited'
    return renderBlock(clone, originalRaw)
  }
  let target: Parent | null = null
  const walk = (n: Nodes): void => {
    if (n.type === 'paragraph' || n.type === 'heading' || n.type === 'tableCell') target = n
    if ('children' in n) for (const c of n.children) walk(c as Nodes)
  }
  walk(clone)
  if (!target) return null
  ;(target as Parent).children.push({ type: 'text', value: ' edited' } as never)
  return renderBlock(clone as RootContent, originalRaw)
}
