// Slice 6A (docs/contracts/ms6-trash-media.md §6.2; FR-ATT-01 AC-1…AC-3): paste (bytes → `media_add`), drop and picker
// (`media_add_paths`), then `insertEmbeds`; errors as the `media.refused` / `media.failed` alerts.
// 6A stub (ms6-trash-media §6.2): adds nothing.

export type MediaSource = { kind: 'paste'; files: File[] } | { kind: 'paths'; paths: string[] }

export async function addMedia(_editor: unknown, _source: MediaSource, _pos?: number): Promise<string[]> {
  return []
}
