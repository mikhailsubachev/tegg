// Found by the 3D follow-up red tests (2026-10-15): typing an e-mail address into a paragraph left the note
// unsaved (VerifyError: the written block read back as a GFM e-mail autolink). Data-loss (T1, D-62). FR-EDT-08
// (autosave), FR-FMT-07 (round trip).
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { body, editorNote, open, type } from './helpers'

for (const text of ['eva@example.com', 'Napiš na eva@example.com a a@b', 'a@b', 'jana.novakova+tegg@příklad.cz.']) {
  test(`bug_3d_fr_edt_08_email_in_body_saves: ${text}`, async () => {
    const ed = await open(editorNote('Prázdná'))
    ;(ed as any).editor.commands.focus('end')
    type(ed, text)
    let out: string | null = null
    let err: unknown = null
    try { out = await ed.save() } catch (e) { err = e }
    assert.equal(err, null, `the save is verified, not refused: ${String(err)}`)
    assert.ok(out !== null, 'saved')
    assert.equal(await body(out!), `${text}\n`, 'written as typed, no escapes')
    const again = await open(out!)
    assert.equal((again as any).editor.state.doc.textContent, text, 'reads back as the same text')
  })
}
