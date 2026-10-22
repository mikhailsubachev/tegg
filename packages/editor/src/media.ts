// Slice 6A (docs/contracts/ms6-trash-media.md §6.1; FR-ATT-01 AC-1…AC-3, AC-8): media paragraphs in the editor.
// 6A stub (ms6-trash-media §6.1): inserts nothing.
import type { EditorView } from '@tiptap/pm/view'

/** Inserts one paragraph `![[<embed>]]` per item at `pos` (default: after the caret's block) as one transaction (one
 *  undo step); the caret goes after the last one. Returns whether anything was inserted.
 *  6A stub (ms6-trash-media §6.1): nothing. */
export function insertEmbeds(_view: EditorView, _embeds: string[], _pos?: number): boolean {
  return false
}
