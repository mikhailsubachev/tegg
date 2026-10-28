// Slice 4C (docs/contracts/ms4-jobs.md §10, FR-LNK-03 AC-16, D-398): the status entry `{count} links not updated` and
// the non-modal list `Links not updated` (title, path, reason, `Open`, `Retry`; `Retry all`). In memory per vault
// until quit.
import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { t } from '../i18n/catalog';
import { retry, retryAll, showList, useJobs } from './jobs';

export function NotUpdatedEntry() {
  const { rows, listOpen } = useJobs();
  if (rows.length === 0) return null;
  return (
    <button type="button" className="link-button not-updated-entry" aria-expanded={listOpen} onClick={() => showList(!listOpen)}>
      {t('job.notUpdated.count', { count: rows.length })}
    </button>
  );
}

const REASONS: Record<string, string> = {
  changed: 'job.skip.changed', missing: 'job.skip.missing', placeholder: 'job.skip.placeholder', readOnly: 'job.skip.readOnly', io: 'job.skip.io',
};

export function NotUpdatedList({ onOpen }: { onOpen: (path: string) => void }) {
  const { rows, listOpen } = useJobs();
  const ref = useRef<HTMLElement>(null);
  useEffect(() => { if (listOpen && rows.length === 0) showList(false); }, [listOpen, rows.length]);
  useEffect(() => {
    if (!listOpen) return;
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') showList(false); };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [listOpen]);
  if (!listOpen || rows.length === 0) return null;
  // A popover at the body level: fixed over the page, and shallow in the accessibility tree.
  return createPortal(
    <section ref={ref} className="not-updated popover" aria-label={t('job.notUpdated.title')}>
      <header>
        <h2>{t('job.notUpdated.title')}</h2>
        <button type="button" onClick={() => void retryAll()}>{t('job.retryAll')}</button>
        <button type="button" className="icon-button" aria-label={t('job.close')} onClick={() => showList(false)}>×</button>
      </header>
      <ul>
        {rows.map((r) => (
          <li key={r.path}>
            <span className="title" data-user-content>{r.title}</span>
            <span className="path" title={r.path} data-user-content>{r.path}</span>
            <span className="reason">{t(REASONS[r.reason] ?? 'job.skip.io')}</span>
            <button type="button" onClick={() => { showList(false); onOpen(r.path); }}>{t('job.open')}</button>
            {r.retry !== false && <button type="button" aria-label={t('job.retryOne', { title: r.title })} disabled={r.reason === 'missing'} onClick={() => void retry(r.path)}>{t('job.retry')}</button>}
          </li>
        ))}
      </ul>
    </section>,
    document.body,
  );
}
