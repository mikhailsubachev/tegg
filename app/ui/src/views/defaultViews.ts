// Slice Q2-T: `Restore default views` (docs/contracts/v1-views.md §25.3, §28.1, §29.10; R202, AP-1539, CP-26, D-1918;
// FR-TYP-01 AC-11). The core creates the missing default files (exclusive) and then writes Task's `views:`; one Undo
// (the toast's, 8 s) puts the `views` lines back byte for byte (D-1937: `views: []` when there was no key), then moves
// the created files to the trash.
import { t, catalogLocale } from '../i18n/catalog';
import { errorKind, ipc } from '../ipc/client';
import type { QuerySummaryDto } from '../ipc/queries';
import type { TypeDto } from '../ipc/types';
import { nowIso } from '../queries/env';
import { refreshQueries } from '../queries/store';
import { hideToast, showAlert, showToast } from '../trash/toast';
import { announceView } from './live';
import { nameKey } from './model';

export const DEFAULT_VIEW_NAMES = ['Schedule', 'Kanban'] as const;

/** Whether the button and the palette command are enabled, and the reason when they aren't (R202). */
export function restoreState(type: TypeDto | null | undefined, summaries: readonly QuerySummaryDto[]): { enabled: boolean; reason: string | null } {
  if (!type) return { enabled: true, reason: null };
  if (type.state === 'newer') return { enabled: false, reason: t('ts.newer') };
  if (type.invalid || type.state === 'invalid') return { enabled: false, reason: t('typePage.columnsInvalid') };
  if (type.viewsUnreadable) return { enabled: false, reason: t('views.unreadableSetting', { file: `.tegg/types/${type.key}.yml` }) };
  const listed = new Set((type.views ?? []).map(nameKey));
  const live = new Set(summaries.map((s) => nameKey(s.name)));
  const complete = DEFAULT_VIEW_NAMES.every((n) => listed.has(nameKey(n)) && live.has(nameKey(n)));
  return complete ? { enabled: false, reason: t('typeSettings.restoreViewsNone') } : { enabled: true, reason: null };
}

const list = (xs: string[]) => { try { return new Intl.ListFormat(catalogLocale(), { type: 'conjunction' }).format(xs); } catch { return xs.join(', '); } };
const nameOfPath = (p: string) => (p.split('/').pop() ?? p).replace(/\.yml$/i, '').normalize('NFC');

/** Runs the restore; `reload` brings the types store up to date (the restored tabs appear through it). */
export async function restoreDefaultViews(type: TypeDto | null | undefined, reload: () => unknown): Promise<void> {
  const base = type && type.exists ? type.version : null;
  let r;
  try {
    r = await ipc.taskViewsRestore(base, nowIso(Date.now()));
  } catch (e) {
    const k = errorKind(e);
    if (k === 'NothingToDo') return;
    void reload();
    void refreshQueries();
    showAlert(k === 'Conflict' || k === 'Rule' || k === 'Gone' || k === 'NewerVersion' ? t('views.changedOutside', { plural: type?.plural ?? 'Tasks' }) : t('query.saveFailed'));
    return;
  }
  void reload();
  void refreshQueries();
  const created = r.created.map(nameOfPath);
  const names = [...new Set([...created, ...DEFAULT_VIEW_NAMES.filter((n) => r.names?.some((x) => nameKey(x) === nameKey(n)) && !(type?.views ?? []).some((x) => nameKey(x) === nameKey(n)))])];
  const text = t('typeSettings.restoredViews', { names: list(names.length ? names : created) });
  announceView(text);
  let done = false;
  const undo = async () => {
    if (done) return;
    done = true;
    hideToast();
    try {
      // D-1937: the previous `views:` source when the key existed; else `views: []` (no tabs, and the on-open migration
      // never adds them again), also when Restore created `task.yml`.
      const ops = r.before !== null ? [{ op: 'viewsSource' as const, source: r.before }] : [{ op: 'views' as const, names: [] as string[] }];
      await ipc.typePatch('task', r.type.version, ops);
    } catch {
      void reload();
      showAlert(t('views.changedOutside', { plural: type?.plural ?? r.type.plural }));
      return;
    }
    for (const p of r.created) {
      try { await ipc.queryTrash(nameOfPath(p)); } catch { showAlert(t('trash.removeFailed', { count: 1 })); }
    }
    void reload();
    void refreshQueries();
  };
  showToast(text, () => { void undo(); });
}
