// Slice 4C (docs/contracts/ms4-jobs.md §10, FR-UX-07 AC-9): the non-modal status element of a running rename
// (`role="status"`): `Updating links in {count} notes`, then `Updated links in {count} notes` with `Undo` for 5 s.
// Nothing is shown when no other file is rewritten.
import { t } from '../i18n/catalog';
import { cancelStatusJob, undoLast, useJobs } from './jobs';

export function JobStatus() {
  const { status } = useJobs();
  if (!status) return null;
  if (status.text && status.alert) return <span className="job-status warning-text" role="alert">{status.text}</span>;
  if (status.text) {
    return (
      <span className="job-status" role="status">
        {status.text}
        {status.cancel && <button type="button" className="link-button" onClick={cancelStatusJob}>{t('job.rename.cancel')}</button>}
      </span>
    );
  }
  if (status.phase === 'running') {
    return <span className="job-status" role="status">{t('job.rename.running', { count: status.count })}</span>;
  }
  return (
    <span className="job-status" role="status">
      {t('job.rename.done', { count: status.count })}
      <button type="button" className="link-button" onClick={() => void undoLast()}>{t('job.undo')}</button>
    </span>
  );
}
