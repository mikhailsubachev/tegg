// FR-LNK-14 AC-11, AC-12 (D-290, D-392, D-727): `Merge…` of a duplicate-title group. The dialog starts a `merge` job,
// which waits in `confirm`; its plan's conflicts (`job_plan`) are listed; `Merge <n> objects` confirms it, Cancel and
// Esc cancel it (nothing written). Changing the kept object restarts the job with it. No Undo (D-395).
import { useEffect, useRef, useState } from 'react';
import { t } from '../i18n/catalog';
import { ipc } from '../ipc/client';
import type { DuplicateGroupDto, JobPlanDto } from '../ipc/types';
import { runConfirmed } from '../jobs/jobs';
import { Dialog } from '../pages/TypeSettingsPage';
import { showAlert } from '../trash/toast';

export function MergeDialog({ group, onClose, onDone }: { group: DuplicateGroupDto; onClose: () => void; onDone: () => void }) {
  const [keep, setKeep] = useState(group.objects[0]?.path ?? '');
  const [job, setJob] = useState<number | null>(null);
  const [plan, setPlan] = useState<JobPlanDto | null>(null);
  const jobRef = useRef<number | null>(null);
  const confirmed = useRef(false);
  const kept = group.objects.find((o) => o.path === keep) ?? group.objects[0];
  const others = group.objects.filter((o) => o.path !== keep).map((o) => o.path);

  useEffect(() => {
    let live = true;
    setPlan(null);
    void (async () => {
      const r = await ipc.mergeStart(keep, others).catch(() => null);
      if (!live || !r || r.jobId === null) return;
      jobRef.current = r.jobId;
      setJob(r.jobId);
      for (let i = 0; i < 200 && live; i++) {
        const p = await ipc.jobPlan(r.jobId).catch(() => null);
        if (p) { setPlan(p); return; }
        await new Promise((res) => setTimeout(res, 25));
      }
    })();
    return () => {
      live = false;
      const j = jobRef.current;
      if (j !== null && !confirmed.current) void ipc.jobCancel(j).catch(() => {});
      jobRef.current = null;
    };
  }, [keep]);

  const merge = async () => {
    if (job === null) return;
    confirmed.current = true;
    const title = kept.title;
    onClose();
    await runConfirmed(() => Promise.resolve({ jobId: job }), {
      done: () => t('merge.done', { title }),
      finished: () => onDone(),
    }).catch(() => showAlert(t('error.io')));
  };
  return (
    <Dialog label={t('merge.title', { title: kept.title })} onCancel={onClose} className="tag-dialog merge-objects">
      <h2>{t('merge.title', { title: kept.title })}</h2>
      <div role="radiogroup" aria-label={t('merge.keep')} className="merge-keep">
        {group.objects.map((o, i) => (
          <button data-command="merge.c3" key={o.path} tabIndex={o.path === keep ? 0 : -1} type="button" role="radio" aria-checked={o.path === keep} className="merge-option"
            aria-label={`${o.title}, ${o.path}`} autoFocus={i === 0}
            onClick={() => setKeep(o.path)}>
            <span data-user-content>{o.title}</span> <span className="meta" data-user-content>{o.path}</span>
          </button>
        ))}
      </div>
      {plan && plan.conflicts.length > 0 && (
        <div className="merge-conflicts">
          <p>{t('merge.conflicts')}</p>
          <ul>
            {plan.conflicts.map((c) => (
              <li key={c.key}><code data-user-content>{c.key}</code>: <span data-user-content>{c.kept}</span> / <span data-user-content>{c.others.join(', ')}</span></li>
            ))}
          </ul>
        </div>
      )}
      <p className="hint">{t('merge.line', { count: others.length })}</p>
      <div className="dialog-buttons">
        <button data-command="merge.c2" tabIndex={0} type="button" className="text-button" onClick={onClose}>{t('ts.cancel')}</button>
        <button data-command="merge.c1" tabIndex={0} type="button" className="text-button primary" aria-disabled={plan ? undefined : 'true'} onClick={() => void merge()}>{t('merge.ok', { count: group.objects.length })}</button>
      </div>
    </Dialog>
  );
}
