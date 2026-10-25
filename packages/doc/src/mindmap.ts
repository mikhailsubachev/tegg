// Slice MM (docs/contracts/mm-mindmap.md §1): a mindmap is a `> [!mindmap]` callout holding one list (D-679, D-680).
// Stubs until the build: they compile and return deliberately wrong results (contract preamble).

export type MindInline =
  | { k: 'text'; text: string; marks: ('strong' | 'emphasis' | 'code' | 'mark' | 'delete')[] }
  | { k: 'link'; target: string; alias: string | null; embed: boolean }
  | { k: 'tag'; value: string }
  | { k: 'break' }
  | { k: 'url'; href: string; text: string }
export type MindItem = { inline: MindInline[]; checked: boolean | null; more: boolean; path: number[]; children: MindItem[] }
export type MindRoot = { kind: 'item'; item: MindItem } | { kind: 'synthesized'; text: string } | { kind: 'empty' }
export type MindmapTree = { title: string | null; typeSpelling: string; fold: '' | '+' | '-'; ordered: boolean; items: MindItem[]; root: MindRoot }

/** The tree of a `mindmap` block's source, or null when the block isn't one (§1.2). */
export function mindmapTree(_raw: string, _noteTitle: string): MindmapTree | null {
  return null
}

/** D-767: the given blocks wrapped in `> [!mindmap]` (§1.3). */
export function wrapMindmap(blocksRaw: string[], _gaps: string[]): string {
  return blocksRaw.join('\n\n')
}

/** D-767: the mindmap callout removed (§1.3). */
export function unwrapMindmap(raw: string, _to: 'bulletList' | 'orderedList' | 'checklist' | 'keep'): string {
  return raw
}
