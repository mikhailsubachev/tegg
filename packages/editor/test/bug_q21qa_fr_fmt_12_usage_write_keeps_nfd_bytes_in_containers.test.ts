// QA review of slice Q2.1 (T1): a block's sort or columns write inside a callout or a list item was written through
// `fit()`, which normalizes the whole container to NFC, so every NFD byte in that container changed: other paragraphs,
// the callout title and an NFD `saved:` value. A usage write changes only the fence's `sort:` / `columns:` lines (D-1885,
// R195 "Bytes kept"; FR-FMT-12 AC-12, AC-13; FR-FMT-06 AC-7; CLAUDE.md rule 2), in LF and CRLF notes alike.
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { applyFenceUsage, queryFences, withUsage } from '@tegg/doc'
import { editorModule, NOW, newId } from './helpers'

const D = (s: string) => s.normalize('NFD')

const NOTE = [
  '---',
  'id: 01JB0Z00000000000000000777',
  'type: page',
  'title: Čtení',
  'created: 2026-11-20T09:00:00+01:00',
  'modified: 2026-11-20T09:00:00+01:00',
  '---',
  D('Úvodní řádek s háčky.'),
  '',
  D('> [!note] Výběr knížek'),
  D('> Odstavec před dotazem: žluťoučký kůň.'),
  '>',
  '> ```query',
  D('> saved: Výborné knihy'),
  '> ```',
  '>',
  D('> Odstavec za dotazem: Šťastná cesta.'),
  '',
  D('- Položka seznamu: Řeka'),
  '',
  '  ```query',
  D('  saved: Přečtené knihy'),
  '  ```',
  '',
  D('  Konec položky: ďábelské účty.'),
  '',
].join('\n')

type Ctl = { getPos(): number | undefined; nested: boolean; setSource(source: string): boolean }

async function openWith(text: string, ctls: { source: string; ctl: Ctl }[]) {
  const m = await editorModule()
  return (m.createEditor as any)({
    text, now: () => NOW, newId,
    ui: {
      resolve: () => null, unresolved: (t: string) => t, sourceBlock: 'Source block', hint: '',
      placeholder: (_k: string, v: string) => ({ name: v, text: v }), onLink: () => {}, onTag: () => {}, onExternal: () => {},
      query: (source: string, _dom: HTMLElement, ctl: Ctl) => { ctls.push({ source, ctl }); return { update: () => {}, selected: () => {}, destroy: () => {} } },
    },
  })
}

const withoutModified = (s: string) => s.replace(/^modified:.*$/m, 'modified: -')

for (const eol of ['\n', '\r\n'] as const) {
  test(`bug_q21qa_fr_fmt_12_usage_write_keeps_nfd_bytes_in_containers (${eol === '\n' ? 'LF' : 'CRLF'})`, async () => {
    const text = NOTE.replace(/\n/g, eol)
    const ctls: { source: string; ctl: Ctl }[] = []
    const ed = await openWith(text, ctls)
    // A CRLF callout opens as a source block (no usage to write there); the list item's block is a query block in both.
    const want = eol === '\n' ? 2 : 1
    assert.equal(ctls.filter((c) => c.ctl.nested).length, want, `${want} nested query block(s): the list item's${want === 2 ? ' and the callout\'s' : ''}`)
    const fences = queryFences(text).filter((f) => f.nested)
    assert.equal(fences.length, 2)

    // A sort write on the callout's block, a columns write on the list item's block, as useUsageWrite does.
    const sort = { sort: [{ by: D('hodnocení'), order: 'desc' as const }] }
    const columns = { columns: [D('autor'), D('hodnocení')] }
    let expected = text
    for (let i = fences.length - 1; i >= 0; i--) {
      const f = fences[i]!
      const change = f.body.includes(D('Výborné')) ? sort : columns
      const c = ctls.find((x) => x.source.includes(f.body.includes(D('Výborné')) ? D('Výborné') : D('Přečtené')))
      if (!c) continue
      assert.equal(c.ctl.setSource(withUsage(c.source, change)!), true, 'the usage write applies')
      // The same write on the file's bytes: only the `sort:` / `columns:` lines are new.
      expected = applyFenceUsage(expected, f.range, change)!
    }
    assert.ok(expected.includes('  columns:') && expected.includes(D('  saved: Přečtené knihy')), 'the expected text has the list item\'s write')
    const out = await ed.save()
    assert.ok(out, 'the note is written')
    assert.equal(withoutModified(out!), withoutModified(expected), 'every byte outside the fences\' sort / columns lines is kept (NFD, EOL)')
    ed.destroy()
  })
}

// A container whose fence lines can't be patched (here a tab-indented body line in a list item) is never re-rendered
// in their place: the block's write is refused (setSource false, nothing written; the app shows `query.saveFailed`),
// and a save of such a change without setSource throws instead of writing (D-1885, v1-views §13.3).
test('bug_q21qa_fr_fmt_12_unpatchable_container_write_fails', async () => {
  const text = D('Úvod\n\n- Položka: Řeka\n\n  ```query\n\tsaved: Výborné knihy\n  ```\n')
  const ctls: { source: string; ctl: Ctl }[] = []
  const ed = await openWith(text, ctls)
  assert.equal(ctls.length, 1, 'the list item\'s fence is a query block')
  const before = ed.view.state.doc
  assert.equal(ctls[0]!.ctl.setSource('```query\nsaved: x\nsort: { by: a, order: asc }\n```'), false, 'setSource refuses the write')
  assert.equal(ed.view.state.doc, before, 'the editor document is unchanged')
  assert.equal(await ed.save(), null, 'nothing is written')
  // The same change dispatched without setSource: the save throws, it doesn't re-render the list item.
  let code = -1
  ed.view.state.doc.descendants((n: any, pos: number) => { if (code < 0 && n.type.name === 'codeBlock') code = pos; return code < 0 })
  const node = ed.view.state.doc.nodeAt(code)
  ed.view.dispatch(ed.view.state.tr.replaceWith(code + 1, code + node.nodeSize - 1, ed.view.state.schema.text('saved: x')))
  const m = await editorModule()
  await assert.rejects(() => ed.save(), (e: unknown) => e instanceof m.VerifyError, 'the save throws a VerifyError, no write')
  ed.destroy()
})
