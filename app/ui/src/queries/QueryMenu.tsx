// Slice Q (queries.md R143; v1-queries §4.2 `QueryMenu.tsx`): `Query actions` of a Queries page row and of the query
// page's `⋯`: Pin to sidebar / Unpin from sidebar, Rename…, Duplicate, then Move to trash; an unreadable file has only
// Move to trash (AP-1299), a newer one can't be renamed or duplicated (FR-SYN-03 AC-29). The actions themselves are here
// too, so the palette's commands on `query/<name>` run the same code.
import { useEffect } from 'react';
import { t } from '../i18n/catalog';
import { errorKind, ipc } from '../ipc/client';
import { PopupMenu, type MenuEntry } from '../shell/Menu';
import { pinMenuEntry } from '../pinned/PinMenu';
import { usePins } from '../pinned/store';
import { showAlert, showToast } from '../trash/toast';
import { openNameDialog } from './dialogs';
import { queryAlert } from './editorHost';
import { nowIso } from './env';
import { queryNav } from './nav';
import { refreshQueries } from './store';

export type MenuQuery = { name: string; title: string; state: 'ok' | 'newer' | 'unreadable' | string };

/** Duplicate (FR-QRY-06 AC-8): `<name> (2)`, then its page. */
export async function duplicateQuery(name: string): Promise<void> {
  try {
    const q = await ipc.queryDuplicate(name, nowIso(Date.now()));
    void refreshQueries();
    queryNav()?.openQuery(q.name);
  } catch (e) {
    queryAlert(errorKind(e) === 'NewerVersion' ? t('query.block.readOnly') : t('query.saveFailed'));
  }
}

/** Move to trash (AP-1292): the file goes to `.trash/.tegg/queries/`; `Undo` brings it back. */
export async function trashQuery(name: string, title: string, after?: () => void): Promise<boolean> {
  try {
    await ipc.queryTrash(name);
  } catch {
    showAlert(t('trash.removeFailed', { count: 1 }));
    return false;
  }
  void refreshQueries();
  showToast(t('queries.trashed', { name: title }), () => { void ipc.queryRestore(name).then(() => refreshQueries(), () => showAlert(t('trash.removeFailed', { count: 1 }))); });
  after?.();
  return true;
}

/** Rename… (AP-1291): the `query-rename` job, from the `Rename query` dialog. */
export function renameQuery(q: MenuQuery, returnFocus: HTMLElement | null, onRenamed?: (name: string) => void) {
  openNameDialog({ kind: 'rename', name: q.name, title: q.title, returnFocus, onRenamed });
}

// ------------------------------------------------------------------ ⌘Z right after a rename (FR-QRY-06 AC-6)

let lastRename: number | null = null;
/** The last query-rename job this window started; ⌘Z on the Queries pages undoes it once. */
export function setLastQueryRename(jobId: number | null) { lastRename = jobId; }
export function useUndoQueryRename() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (lastRename === null || !(e.metaKey && !e.shiftKey && !e.altKey && (e.key === 'z' || e.key === 'Z'))) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
      if (document.querySelector('[role="dialog"]')) return;
      const id = lastRename;
      lastRename = null;
      e.preventDefault();
      void ipc.jobUndo(id).then(() => setTimeout(() => void refreshQueries(), 300), () => {});
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

export function QueryMenu({ query, anchor, onClose, onRenamed, onTrashed }: {
  query: MenuQuery; anchor: HTMLElement | null; onClose: () => void;
  onRenamed?: (name: string) => void; onTrashed?: () => void;
}) {
  const { pins } = usePins();
  const back = () => { if (anchor?.isConnected) anchor.focus(); };
  const item = (key: string, label: string, run: () => void, disabled = false, description?: string): MenuEntry =>
    ({ kind: 'item', key, label, content: <span className="menu-title">{label}</span>, disabled, description, onChoose: () => { onClose(); run(); } });
  const trash = item('trash', t('queries.trash'), () => { void trashQuery(query.name, query.title, onTrashed); });
  const readOnly = query.state === 'newer';
  const entries: MenuEntry[] = query.state === 'unreadable' ? [trash] : [
    pinMenuEntry({ request: { kind: 'query', name: query.name }, label: query.title }, pins, () => { onClose(); back(); }),
    item('rename', t('queries.rename'), () => renameQuery(query, anchor, onRenamed), readOnly, readOnly ? t('query.block.readOnly') : undefined),
    item('duplicate', t('queries.duplicate'), () => { void duplicateQuery(query.name); }, readOnly, readOnly ? t('query.block.readOnly') : undefined),
    { kind: 'separator' },
    trash,
  ];
  return <PopupMenu label={t('queries.rowMenu')} anchor={anchor} onClose={onClose} disabledFocusable entries={entries} />;
}
