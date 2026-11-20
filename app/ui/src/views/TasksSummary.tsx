// Slice Q2-T: the header line of `type/task` (docs/contracts/v1-views.md §28.1, §29.1; R204, CP-29, D-1921): `15 open ·
// 2 overdue · 1 done this week`, from `task_list` (the filters don't change it), following `vault:changed` (the page's
// refresh), the app's own task writes and the 30 s day check.
import { useEffect } from 'react';
import { t } from '../i18n/catalog';
import { summaryWeek } from '../tasks/views';
import { useTasks } from '../tasks/useTasks';
import { TASKS_WRITTEN } from '../tasks/write';

export function TasksSummary({ refresh }: { refresh: number }) {
  const data = useTasks(refresh);
  const { reload } = data;
  useEffect(() => {
    const f = () => { void reload(); };
    window.addEventListener(TASKS_WRITTEN, f);
    return () => window.removeEventListener(TASKS_WRITTEN, f);
  }, [reload]);
  // Until `task_list` answers, an empty line of the same height (the board below doesn't move, §29.1 Back).
  if (!data.loaded) return <p className="type-count type-page-count" aria-hidden="true">{'\u00a0'}</p>;
  const s = summaryWeek(data.tasks, data.today, data.firstWeekday, data.zone);
  return (
    <p className="type-count type-page-count" data-tasks-summary="">
      {t('tasks.summaryWeek', {
        open: t('tasks.summary.open', { count: s.open }),
        overdue: t('tasks.summary.overdue', { count: s.overdue }),
        done: t('tasks.summary.doneWeek', { count: s.doneWeek }),
      })}
    </p>
  );
}
