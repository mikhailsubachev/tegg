// Slice 6A (docs/contracts/ms6-trash-media.md §6.2; FR-HIS-01 AC-1, AC-3, D-616): flushes the autosave of open notes
// among `items` (D-196), `object_trash` for each, the `trash.moved` / `trash.movedMany` toast with `Undo` through the
// jobs toast, and the navigation of AC-1. 6A stub (ms6-trash-media §6.2): does nothing.
import type { VersionDto } from '../ipc/types'

export type TrashItem = { path: string; base: VersionDto; title: string }

export async function moveToTrash(_items: TrashItem[]): Promise<void> {}
