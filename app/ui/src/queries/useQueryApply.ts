// Slice Q2: one `query_apply` per change from a view or a block (docs/contracts/v1-views.md §2.2, §2.1; D-1444, D-1784):
// the sort popover, a header click, the lanes switch, a lane drag, Reset lane order, Columns and a header drag. Changes go
// one after another, each based on the version the previous one wrote (so quick steps never refuse each other); a file
// changed outside Tegg is refused (`Conflict`) with `query.editor.changedOutside`, never overwritten (NFR-REL-02).
import { useEffect, useRef } from 'react';
import { errorKind, ipc } from '../ipc/client';
import type { QueryDefDto, QueryResultDto } from '../ipc/queries';
import type { VersionDto } from '../ipc/types';
import { t } from '../i18n/catalog';
import { queryAlert } from './editorHost';
import { nowIso } from './env';

export type QueryPatch = (def: QueryDefDto) => Partial<QueryDefDto> | null;

export function useQueryApply(name: string | null, result: QueryResultDto | null, rerun: () => void): {
  apply: (patch: QueryPatch | Partial<QueryDefDto>) => void;
  /** The definition as last written by this surface, or as read (what the next change builds on). */
  current: () => QueryDefDto | null;
} {
  const res = useRef(result);
  res.current = result;
  const disk = useRef<{ version: VersionDto | null; def: QueryDefDto } | null>(null);
  const pending = useRef(0);
  const queue = useRef<Promise<void>>(Promise.resolve());
  useEffect(() => { if (pending.current === 0) disk.current = null; }, [result]);
  const current = () => disk.current?.def ?? res.current?.def ?? null;
  const apply = (patch: QueryPatch | Partial<QueryDefDto>) => {
    if (!name) return;
    pending.current++;
    queue.current = queue.current.then(async () => {
      try {
        const base = disk.current ?? (res.current?.def ? { version: res.current.version, def: res.current.def } : null);
        if (!base) return;
        const p = typeof patch === 'function' ? patch(base.def) : patch;
        if (!p) return;
        const def = { ...base.def, ...p };
        const out = await ipc.queryApply(name, base.version, def, nowIso(Date.now()));
        disk.current = { version: out.query.version, def: out.query.def ?? def };
      } catch (e) {
        disk.current = null;
        const k = errorKind(e);
        // Only a changed or deleted file is "changed outside"; anything else (Io, a read-back failure) didn't save (§2.1).
        queryAlert(k === 'Conflict' || k === 'Gone' ? t('query.editor.changedOutside') : t('query.saveFailed'));
      } finally {
        pending.current--;
        rerun();
      }
    });
  };
  return { apply, current };
}
