// Slice 4C (docs/contracts/ms4-jobs.md §10, FR-UX-07 AC-9): the non-modal status element of a running rename
// (`role="status"`): `Updating links in {count} notes`, then `Updated links in {count} notes` with `Undo` for 5 s.
// Nothing is shown when no other file is rewritten.
import { t } from '../i18n/catalog';
import { useEffect } from 'react';
import { cancelStatusJob, clearStatus, showList, undoLast, undoMove, useJobs } from './jobs';

export function JobStatus() {
  const { status } = useJobs();
  const hide = status?.hideAfter;
  const id = status?.jobId;
  useEffect(() => {
    if (!hide || id === undefined) return;
    const h = setTimeout(() => clearStatus(id), hide);
    return () => clearTimeout(h);
  }, [hide, id]);
  if (!status) return null;
  if (status.text && status.alert) return <span className="job-status warning-text" role="alert">{status.text}</span>;
  if (status.text) {
    return (
      <span className="job-status" role="status">
        {status.text}
        {status.cancel && <button type="button" tabIndex={0} className="link-button" onClick={cancelStatusJob}>{t('job.rename.cancel')}</button>}
        {status.show && <button type="button" tabIndex={0} className="link-button" onClick={() => showList(true)}>{t('job.folderMove.show')}</button>}
        {status.undo !== undefined && <button type="button" tabIndex={0} className="link-button" onClick={() => void undoMove(status.undo!)}>{t('job.undo')}</button>}
      </span>
    );
  }
  if (status.phase === 'running') {
    return <span className="job-status" role="status">{t('job.rename.running', { count: status.count })}</span>;
  }
  return (
    <span className="job-status" role="status">
      {t('job.rename.done', { count: status.count })}
      <button type="button" tabIndex={0} className="link-button" onClick={() => void undoLast()}>{t('job.undo')}</button>
    </span>
  );
}
