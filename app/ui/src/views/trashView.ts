// Slice Q2.1: `Move to trash` from a view's menu (docs/contracts/v1-views.md §15; D-1835, D-1847; FR-QRY-07 AC-20…AC-22).
// The tab goes first (one `type_patch` of `views`), then the query file moves to the trash; a failed move puts the
// `views` lines back byte for byte (`viewsSource`). One Undo (the toast, or ⌘Z on the page while it shows) restores
// the query, then the `views` lines. Trashing a query anywhere else keeps v1-queries' path and never writes a type file.
import { t } from '../i18n/catalog';
import { errorKind, ipc } from '../ipc/client';
import type { TypeDto } from '../ipc/types';
import { refreshQueries } from '../queries/store';
import { hideToast, showAlert, showToast } from '../trash/toast';
import { announceView } from './live';
import { viewsAfterRemove } from './model';

export type TrashViewHost = {
  /** The `views` write of the type page's queue; rejects with the core's error. */
  patch: (ops: Parameters<typeof ipc.typePatch>[2], base?: TypeDto | null) => Promise<TypeDto>;
  /** The tab after the trash (the previous one; null: `All`) and after a revert or Undo (the view itself). */
  select: (name: string | null) => void;
  /** Reloads the type from disk (a refusal). */
  reload: () => void;
  plural: string;
};

let undoKey: ((e: KeyboardEvent) => void) | null = null;
function clearUndoKey() {
  if (undoKey) window.removeEventListener('keydown', undoKey, true);
  undoKey = null;
}

/** §15: `type` as the page shows it, `name` the view, `title` its query's title, `previous` the tab selected after. */
export async function trashView(type: TypeDto, name: string, title: string, host: TrashViewHost & { previous: string | null }): Promise<void> {
  // 1. Only when the type file can be written.
  if (!(type.state === 'ok' && !type.viewsUnreadable)) return;
  const before = type.viewsSource ?? null;
  const next = viewsAfterRemove(type.views ?? [], name);
  if (!next) return;
  // 2. The tab first.
  let t1: TypeDto;
  host.select(host.previous);
  try {
    t1 = await host.patch([{ op: 'views', names: next.map((x) => x.normalize('NFC')) }], type);
  } catch (e) {
    const k = errorKind(e);
    host.select(name);
    host.reload();
    showAlert(k === 'Conflict' || k === 'Rule' || k === 'Gone' ? t('views.changedOutside', { plural: host.plural }) : t('query.saveFailed'));
    return;
  }
  // 3. Then the move; a failure puts the views lines back.
  try {
    await ipc.queryTrash(name);
  } catch {
    if (before !== null) {
      try {
        await host.patch([{ op: 'viewsSource', source: before }], t1);
        host.select(name);
        showAlert(t('views.trashFailed', { name: title }));
      } catch {
        host.reload();
        showAlert(t('views.changedOutside', { plural: host.plural }));
      }
    } else {
      host.reload();
      showAlert(t('views.trashFailed', { name: title }));
    }
    return;
  }
  // 4. Done: the toast with Undo (8 s), the live region.
  void refreshQueries();
  announceView(t('queries.trashed', { name: title }));
  let done = false;
  const undo = async () => {
    if (done) return;
    done = true;
    clearUndoKey();
    hideToast();
    try {
      await ipc.queryRestore(name);
    } catch {
      showAlert(t('trash.removeFailed', { count: 1 }));
      return;
    }
    void refreshQueries();
    if (before === null) return;
    try {
      await host.patch([{ op: 'viewsSource', source: before }], t1);
      host.select(name);
    } catch {
      host.reload();
      showAlert(t('views.changedOutside', { plural: host.plural }));
    }
  };
  showToast(t('queries.trashed', { name: title }), () => { void undo(); });
  // ⌘Z while the toast shows, with the focus on the page (not in a text field).
  clearUndoKey();
  undoKey = (e: KeyboardEvent) => {
    if (!(e.metaKey && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'z')) return;
    const el = e.target as HTMLElement | null;
    if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
    if (document.querySelector('[role="dialog"]')) return;
    e.preventDefault();
    e.stopPropagation();
    void undo();
  };
  window.addEventListener('keydown', undoKey, true);
  setTimeout(() => { if (!done) clearUndoKey(); }, 8000);
}
