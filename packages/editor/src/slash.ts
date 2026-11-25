// The slash menu (table R6 of docs/acceptance/editor.md as reordered by new-object-menu.md R234, D-2492): Blocks
// (with Mindmap after Checklist), Objects, Media, Advanced; items of later milestones are listed disabled with their
// milestone (FR-EDT-03 AC-5). The New object rows are computed per vault by the app and are never in this list.

export type Due = { milestone: string; slice?: string }
export type SlashItem = { id: string; group: 'objects' | 'blocks' | 'media' | 'advanced'; label: string; due?: Due; aliases?: string[] }

const ITEMS: SlashItem[] = [
  { id: 'text', group: 'blocks', label: 'Text', aliases: ['paragraph'] },
  { id: 'heading1', group: 'blocks', label: 'Heading 1', aliases: ['h1'] },
  { id: 'heading2', group: 'blocks', label: 'Heading 2', aliases: ['h2'] },
  { id: 'heading3', group: 'blocks', label: 'Heading 3', aliases: ['h3'] },
  { id: 'bulletList', group: 'blocks', label: 'Bulleted list', aliases: ['ul'] },
  { id: 'orderedList', group: 'blocks', label: 'Numbered list', aliases: ['ol'] },
  { id: 'checklist', group: 'blocks', label: 'Checklist', aliases: ['todo'] },
  { id: 'mindmap', group: 'blocks', label: 'Mindmap' }, // moved from Advanced (D-2492)
  { id: 'quote', group: 'blocks', label: 'Quote', aliases: ['blockquote'] },
  { id: 'callout', group: 'blocks', label: 'Callout' },
  { id: 'codeBlock', group: 'blocks', label: 'Code block' },
  { id: 'divider', group: 'blocks', label: 'Divider', aliases: ['hr'] },
  { id: 'table', group: 'blocks', label: 'Table' },
  { id: 'turnIntoObject', group: 'objects', label: 'Turn into object…' },
  { id: 'embedObject', group: 'objects', label: 'Embed object', aliases: ['embed'] },
  { id: 'image', group: 'media', label: 'Image' },
  { id: 'pdf', group: 'media', label: 'PDF' },
  // Slice Q (D-1447, v1-queries §3.2): built; no SLASH_BLOCK entry, the app opens the query picker (R144).
  { id: 'query', group: 'advanced', label: 'Query' },
  { id: 'blockEmbed', group: 'advanced', label: 'Block embed', due: { milestone: 'v1.0' } },
]

export function slashItems(): SlashItem[] {
  return ITEMS.map((i) => ({ ...i }))
}

/** The editor block each built item inserts (`insertBlock` kind and options). */
export const SLASH_BLOCK: Record<string, { kind: string; level?: number }> = {
  text: { kind: 'paragraph' }, heading1: { kind: 'heading', level: 1 }, heading2: { kind: 'heading', level: 2 },
  heading3: { kind: 'heading', level: 3 }, bulletList: { kind: 'bulletList' }, orderedList: { kind: 'orderedList' },
  checklist: { kind: 'checklist' }, quote: { kind: 'blockquote' }, callout: { kind: 'callout' }, codeBlock: { kind: 'codeBlock' },
  divider: { kind: 'divider' }, table: { kind: 'table' },
}
