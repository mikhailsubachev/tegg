// Slice 6A (docs/contracts/ms6-trash-media.md §4, §6.2): the Trash page's rows from `trash_list`, re-read on
// `trash:changed` (FR-HIS-01 AC-4). 6A stub (ms6-trash-media §6.2): no rows.
import type { TrashEntryDto } from '../ipc/types'

export function useTrash(): { entries: TrashEntryDto[]; loading: boolean } {
  return { entries: [], loading: false }
}
