// 5A-1: the Daily Note's `Tasks due` section (FR-DLY-04 AC-8…AC-14, D-485, D-328), in place of the D-271
// placeholder: on today's note overdue, due today and completed today; on other dates due that day and completed that
// day. Rows: checkbox, type icon and title, due chip, source chip. Completing writes only the task (never the Daily
// Note, which stays virtual if it is).
import { addDays, localDate } from '@tegg/doc';
import { useEffect, useState } from 'react';
import { t } from '../i18n/catalog';
import { events, ipc } from '../ipc/client';
import type { DailyTasksDto, TaskDefsDto, TaskRowDto } from '../ipc/types';
import { chipIcon } from '../links/icons';
import { Icon } from '../shell/Icon';
import { Checkbox, DueChip, SourceChip, type TaskNav } from '../tasks/TaskCard';
import { currentRegion, useToday } from '../tasks/useTasks';
import { openSourceAt } from '../tasks/sourceNav';
import { writeTask } from '../tasks/write';
import { localMidnight } from '../zone';
import { openDate } from './open';

const LIMIT = 50;

export function DailyTasks({ date, onOpen }: { date: string; onOpen: (path: string) => void }) {
  const [rows, setRows] = useState<DailyTasksDto | null>(null);
  const [defs, setDefs] = useState<TaskDefsDto | null>(null);
  const [all, setAll] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const { today, zone } = useToday();
  const region = currentRegion();
  useEffect(() => {
    const un = events.changed(() => setRefresh((n) => n + 1));
    return () => void un.then((f) => f());
  }, []);
  const load = () => {
    let live = true;
    ipc.dailyTasks(date, localMidnight(date), localMidnight(addDays(date, 1)), localDate(Date.now(), zone), all ? 100_000 : LIMIT)
      .then((d) => { if (live) setRows(d); }, () => {});
    ipc.taskList().then((l) => { if (live) setDefs(l.defs); }, () => {});
    return () => { live = false; };
  };
  useEffect(load, [date, refresh, all, today, zone]);
  const nav: TaskNav = { openNote: onOpen, openSource: openSourceAt, openDay: (d) => { openDate(d); } };
  const list = rows ? [...rows.overdue, ...rows.due, ...rows.completed] : [];
  const [alerts, setAlerts] = useState<{ id: number; text: string; retry?: () => void }[]>([]);
  const alert = (text: string, retry?: () => void) => setAlerts((a) => [...a.filter((x) => x.text !== text), { id: Date.now() + Math.random(), text, retry }]);
  /** FR-TSK-02 AC-10…AC-12 (PR #47 review): a refused or failed write is shown, never silent (NFR-REL-02). */
  const toggle = (row: TaskRowDto, done: boolean, base: 'row' | 'current' = 'row') => {
    if (!defs) return;
    void writeTask(row, defs, { kind: 'complete', done }, base).then((r) => {
      if (r.outcome === 'conflict') alert(t('task.changedOutside', { title: row.title }));
      else if (r.outcome === 'failed') alert(t('task.saveFailed', { title: row.title }), () => toggle(row, done, 'current'));
      setRefresh((n) => n + 1);
    });
  };
  return (
    <section role="region" aria-label={t('daily.section.tasks')} className="daily-section">
      <h2 className="daily-section-title">{t('daily.section.tasks')}</h2>
      {alerts.map((a) => (
        <div key={a.id} role="alert" className="task-alert">
          <span>{a.text}</span>
          {a.retry && <button type="button" tabIndex={0} data-command="task.tryAgain" onClick={() => { setAlerts((x) => x.filter((y) => y.id !== a.id)); a.retry!(); }}>{t('task.tryAgain')}</button>}
          <button type="button" tabIndex={0} className="icon-button" data-command="task.dismissAlert" aria-label={t('dialog.close')} onClick={() => setAlerts((x) => x.filter((y) => y.id !== a.id))}>×</button>
        </div>
      ))}
      {list.length === 0 ? <p className="daily-empty">{t('daily.section.empty')}</p> : (
        <ul className="daily-rows daily-tasks">
          {list.map((r) => {
            const icon = chipIcon('task');
            return (
              <li key={r.path} data-path={r.path.normalize('NFC')} className={`daily-task${r.state === 'done' ? ' done' : ''}`}>
                <Checkbox row={r} onToggle={(d) => toggle(r, d)} />
                <a href="#" tabIndex={0} className="daily-row" data-command="daily.openRow" onClick={(e) => { e.preventDefault(); onOpen(r.path); }}>
                  <Icon name={icon.glyph} dataIcon={icon.def} size={14} /><span data-user-content>{r.title}</span>
                </a>
                <DueChip row={r} today={today} region={region} zone={zone} />
                <SourceChip row={r} nav={nav} />
              </li>
            );
          })}
        </ul>
      )}
      {rows && !all && rows.total > list.length && (
        <button type="button" tabIndex={0} className="show-more" data-command="daily.showMore" onClick={() => setAll(true)}>{t('daily.section.more', { count: rows.total - list.length })}</button>
      )}
    </section>
  );
}
