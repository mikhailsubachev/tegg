// Slice 6A (docs/contracts/ms6-trash-media.md §6.2; FR-HIS-01 AC-1, AC-2, AC-3, D-620): `object_trash` for each item,
// the `trash.moved` / `trash.movedMany` toast with `Undo` (restores what moved), and the `trash.conflict` alert for a
// file that changed outside Tegg. The caller flushes the autosave of an open note first (D-196) and navigates.
import { ipc } from '../ipc/client';
import type { MovedDto, VersionDto } from '../ipc/types';
import { t } from '../i18n/catalog';
import { showAlert, showToast } from './toast';

export type TrashItem = { path: string; base: VersionDto; title: string };

/** The global Move to trash of the current page (a note page, a focused card or row); set by App. */
export const trashRequest: { current: (() => void) | null } = { current: null };

export type TrashResult = { moved: MovedDto[][]; conflicts: TrashItem[]; failed: TrashItem[] };

export async function moveToTrash(items: TrashItem[], o: { onUndone?: () => void } = {}): Promise<TrashResult> {
  const out: TrashResult = { moved: [], conflicts: [], failed: [] };
  for (const it of items) {
    try {
      out.moved.push(await ipc.objectTrash(it.path, it.base));
    } catch (e) {
      const kind = (e as { kind?: string })?.kind;
      if (kind === 'Conflict') out.conflicts.push(it);
      else out.failed.push(it);
    }
  }
  for (const c of out.conflicts) showAlert(t('trash.conflict', { title: c.title }));
  if (out.failed.length) showAlert(t('trash.removeFailed', { count: out.failed.length }));
  if (out.moved.length) {
    const done = items.filter((it) => !out.conflicts.includes(it) && !out.failed.includes(it));
    const text = done.length === 1 ? t('trash.moved', { title: done[0].title }) : t('trash.movedMany', { count: done.length });
    const moved = out.moved;
    showToast(text, () => {
      void (async () => {
        for (const m of moved) {
          const first = m[0];
          if (first) await ipc.trashRestore(first.to).catch(() => {});
        }
        o.onUndone?.();
      })();
    });
  }
  return out;
}
