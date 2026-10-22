// Slice 6A (docs/contracts/ms6-trash-media.md §4, §6.2): the Trash page's rows from `trash_list`, re-read on
// `trash:changed` and after each action (FR-HIS-01 AC-4).
import { useCallback, useEffect, useState } from 'react';
import { events, ipc } from '../ipc/client';
import type { TrashEntryDto } from '../ipc/types';

export function useTrash(): { entries: TrashEntryDto[]; loading: boolean; reload: () => Promise<void> } {
  const [entries, setEntries] = useState<TrashEntryDto[]>([]);
  const [loading, setLoading] = useState(true);
  const reload = useCallback(async () => {
    try {
      setEntries(await ipc.trashList());
    } catch {
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void reload();
    const un = events.trashChanged(() => void reload());
    return () => void un.then((f) => f());
  }, [reload]);
  return { entries, loading, reload };
}
