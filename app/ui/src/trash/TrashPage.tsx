// Slice 6A (docs/contracts/ms6-trash-media.md §6.2; docs/acceptance/trash-media.md R70, R71, FR-HIS-01 AC-4…AC-9;
// D-614, D-615): the `trash` route. One row per trashed object (a pair and a trashed folder are one row each), newest
// first; Restore, Delete permanently… (to the macOS Trash, after a dialog) and Empty trash….
import { useEffect, useRef, useState } from 'react';
import type { MutableRefObject, RefObject } from 'react';
import { t } from '../i18n/catalog';
import { ipc } from '../ipc/client';
import type { TrashEntryDto } from '../ipc/types';
import { Icon, typeIconName } from '../shell/Icon';
import { currentRegion } from '../tasks/useTasks';
import { showAlert, showToast } from './toast';
import { useTrash } from './useTrash';

type Ask = { kind: 'delete'; row: TrashEntryDto } | { kind: 'empty'; count: number };

const nfc = (s: string) => s.normalize('NFC');

function deletedAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat(currentRegion(), { dateStyle: 'medium', timeStyle: 'short' }).format(d);
}

export function TrashPage({ heading, focus, onOpen, commandRef }: {
  heading: RefObject<HTMLHeadingElement | null>;
  /** A row to focus once listed (a click on a trashed chip, R74). */
  focus?: string | null;
  /** Opens a trashed object read-only (`note/.trash/…`). */
  onOpen: (path: string) => void;
  /** The palette's Restore and Delete permanently… on the focused row. */
  commandRef: MutableRefObject<((id: 'restore' | 'delete') => void) | null>;
}) {
  const { entries, loading, reload } = useTrash();
  const [ask, setAsk] = useState<Ask | null>(null);
  const list = useRef<HTMLUListElement | null>(null);
  const returnTo = useRef<string | null>(null);

  const focusedRow = (): TrashEntryDto | null => {
    const p = (document.activeElement as HTMLElement | null)?.closest<HTMLElement>('[data-path]')?.dataset.path;
    return p ? entries.find((e) => nfc(e.path) === nfc(p)) ?? null : null;
  };
  const rowEl = (path: string) => list.current?.querySelector<HTMLElement>(`[data-path="${CSS.escape(nfc(path))}"]`) ?? null;

  const restore = async (row: TrashEntryDto) => {
    try {
      const moved = await ipc.trashRestore(row.path);
      const to = moved[0]?.to ?? row.original;
      showToast(nfc(to) === nfc(row.original) ? t('trash.restored', { title: row.title }) : t('trash.restoredAs', { title: row.title, path: to }));
    } catch {
      showAlert(t('trash.removeFailed', { count: 1 }));
    }
    await reload();
  };

  const remove = async (row: TrashEntryDto) => {
    const r = await ipc.trashDelete([row.path]).catch(() => ({ removed: [], failed: [{ path: row.path, reason: '' }] }));
    if (r.failed.length) showAlert(t('trash.removeFailed', { count: r.failed.length }));
    await reload();
  };

  const empty = async () => {
    const r = await ipc.trashEmpty().catch(() => ({ removed: [], failed: [{ path: '.trash', reason: '' }] }));
    if (r.failed.length) showAlert(t('trash.removeFailed', { count: r.failed.length }));
    await reload();
  };

  const focused = useRef(false);
  useEffect(() => {
    if (!focus || focused.current || loading) return;
    const row = entries.find((e) => nfc(e.path) === nfc(focus) || e.files.some((f) => nfc(f) === nfc(focus)));
    if (!row) return;
    focused.current = true;
    setTimeout(() => rowEl(row.path)?.focus(), 0);
  }, [focus, entries, loading]);

  commandRef.current = (id) => {
    const row = focusedRow();
    if (!row) return;
    if (id === 'restore') void restore(row);
    else { returnTo.current = row.path; setAsk({ kind: 'delete', row }); }
  };
  useEffect(() => () => { commandRef.current = null; }, [commandRef]);

  const closeAsk = () => {
    setAsk(null);
    const p = returnTo.current;
    returnTo.current = null;
    setTimeout(() => (p ? rowEl(p) : null)?.focus(), 0);
  };

  const onRowKey = (e: React.KeyboardEvent<HTMLLIElement>, row: TrashEntryDto, i: number) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const next = entries[i + (e.key === 'ArrowDown' ? 1 : -1)];
      if (next) rowEl(next.path)?.focus();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      open(row);
    } else if ((e.key === 'r' || e.key === 'R') && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      void restore(row);
    }
  };

  const open = (row: TrashEntryDto) => {
    if (row.kind === 'object') onOpen(row.path);
    else void ipc.mediaReveal(row.path).catch(() => {});
  };

  if (!loading && entries.length === 0) {
    return (
      <div className="page-column trash-page">
        <h1 ref={heading} tabIndex={-1}>{t('trash.title')}</h1>
        <section role="region" aria-label={t('trash.zero')} className="trash-zero">
          <p className="trash-zero-title">{t('trash.zero')}</p>
          <p className="muted">{t('trash.zeroHint')}</p>
        </section>
      </div>
    );
  }

  return (
    <div className="page-column trash-page">
      <div className="trash-head">
        <div>
          <h1 ref={heading} tabIndex={-1}>{t('trash.title')}</h1>
          <p className="muted trash-summary">{t('trash.summary', { count: entries.length })}</p>
        </div>
        {entries.length > 0 && (
          <button type="button" tabIndex={0} className="trash-empty" onClick={() => setAsk({ kind: 'empty', count: entries.length })}>{t('trash.empty')}</button>
        )}
      </div>
      <ul ref={list} role="list" aria-label={t('trash.list')} className="trash-list">
        {entries.map((row, i) => (
          <li key={row.path} role="listitem" tabIndex={0} data-path={nfc(row.path)} data-kind={row.kind} className="trash-row"
            onKeyDown={(e) => onRowKey(e, row, i)}>
            <span className="trash-icon" aria-hidden="true">
              <Icon name={row.kind === 'folder' ? 'folder' : row.kind === 'file' ? 'file' : typeIconName(row.type ?? 'page')} size={16} />
            </span>
            <span className="trash-main">
              <button type="button" tabIndex={0} className="trash-title link-button" onClick={() => open(row)} data-user-content>{row.title}</button>
              <span className="trash-meta muted">
                <span data-user-content>{row.folder}</span>
                {row.kind === 'folder' && <> · <span>{t('trash.folder', { count: row.count })}</span></>}
                {' · '}
                <span>{t('trash.deleted', { date: deletedAt(row.trashedAt) })}</span>
              </span>
            </span>
            <button type="button" tabIndex={0} className="trash-restore" aria-label={t('trash.restore', { title: row.title })} onClick={() => void restore(row)}>
              <Icon name="restore" size={14} />
            </button>
            <button type="button" tabIndex={0} className="trash-delete" aria-label={t('trash.delete', { title: row.title })}
              onClick={() => { returnTo.current = row.path; setAsk({ kind: 'delete', row }); }}>
              <Icon name="trash" size={14} />
            </button>
          </li>
        ))}
      </ul>
      <p className="muted trash-keys">{t('trash.keys')}</p>
      {ask && (
        <div className="modal-backdrop transparent">
          <div role="alertdialog" aria-modal="true" className="dialog"
            aria-label={t(ask.kind === 'delete' ? 'trash.deleteConfirmTitle' : 'trash.emptyConfirmTitle')}
            onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeAsk(); } }}>
            <h2>{t(ask.kind === 'delete' ? 'trash.deleteConfirmTitle' : 'trash.emptyConfirmTitle')}</h2>
            <p>{ask.kind === 'delete' ? t('trash.deleteConfirm', { title: ask.row.title }) : t('trash.emptyConfirm', { count: ask.count })}</p>
            <div className="dialog-buttons">
              <button type="button" className="danger" onClick={() => {
                const a = ask;
                setAsk(null);
                if (a.kind === 'delete') void remove(a.row);
                else void empty();
              }}>{t(ask.kind === 'delete' ? 'trash.deleteOk' : 'trash.emptyOk')}</button>
              <button type="button" autoFocus onClick={closeAsk}>{t('trash.dialogCancel')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
