// Embeds (FR-EMB-01…04, D-416, D-419, D-420, D-422): the mode keyword, the shown section and the embeds of a body.
// Interface: docs/contracts/ms4-embeds.md §2. 4F stubs: every function returns a deliberately wrong result.

export type EmbedMode = 'full' | 'card' | 'link'

/** D-416: the mode keyword of an embed's inner text, and its parts. */
export function embedParts(value: string): { target: string; subpath: string | null; mode: EmbedMode | null; rest: string | null } {
  return { target: value, subpath: null, mode: null, rest: null } // 4F stub
}

/** D-416: the inner text with the mode set; `null` removes the `|…` part. */
export function withEmbedMode(value: string, _mode: EmbedMode | null): string {
  return value // 4F stub
}

/** D-422: the part of a note's body an embed shows; offsets are UTF-16 indexes into the whole file text. */
export type Section =
  | { kind: 'whole'; from: number; to: number }
  | { kind: 'heading'; from: number; to: number; heading: { level: number; text: string; line: number } }
  | { kind: 'block'; from: number; to: number; id: string }
  | { kind: 'missing'; subpath: string; block: boolean }

export function embedSection(_text: string, subpath: string | null): Section {
  return { kind: 'missing', subpath: subpath ?? '', block: false } // 4F stub
}

/** D-419: the block embeds (sole-embed paragraphs at the top level) and the inline embeds of a body, in file order. */
export function embedsIn(_text: string, _from?: number, _to?: number): { block: { value: string; line: number }[]; inline: { value: string; line: number }[] } {
  return { block: [], inline: [] } // 4F stub
}
