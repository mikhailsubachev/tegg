// The header of the three Tasks views (D-516, D-517; tasks.md R40): the heading and its summary line on the left; on
// the right the `Task views` tablist, `Type settings` (D-519) and, on `All tasks`, `New Task`.
import type { ReactNode, RefObject } from 'react';
import { t } from '../i18n/catalog';
import { TypeSettingsButton } from '../shell/TypeSettingsButton';

export type TasksView = 'schedule' | 'kanban' | 'all';

const TABS: { view: TasksView; label: string; command: string }[] = [
  { view: 'schedule', label: 'tasks.view.schedule', command: 'tasks.schedule' },
  { view: 'kanban', label: 'tasks.view.kanban', command: 'tasks.kanban' },
  { view: 'all', label: 'tasks.view.all', command: 'goto.type:task' },
];

export function TasksHeader({ view, heading, summary, go, onSettings, children }: {
  view: TasksView;
  heading: RefObject<HTMLHeadingElement | null>;
  summary: string | null;
  go: (view: TasksView) => void;
  onSettings: () => void;
  children?: ReactNode;
}) {
  return (
    <header className="page-header tasks-header">
      <div className="tasks-heading">
        <h1 ref={heading} tabIndex={-1}>{t('tasks.title')}</h1>
        {summary !== null && <p className="tasks-summary">{summary}</p>}
      </div>
      <div className="page-actions">
        <div role="tablist" aria-label={t('tasks.views')} className="tabs">
          {TABS.map((x) => (
            <button key={x.view} type="button" role="tab" data-command={x.command} aria-selected={view === x.view} tabIndex={view === x.view ? 0 : -1}
              onClick={() => { if (view !== x.view) go(x.view); }}>
              {t(x.label)}
            </button>
          ))}
        </div>
        <TypeSettingsButton onClick={onSettings} />
        {children}
      </div>
    </header>
  );
}

/** The summary line (R40): all open tasks, filters ignored (AP-411). */
export function tasksSummary(c: { open: number; overdue: number; dueToday: number }): string {
  return t('tasks.summary', {
    open: t('tasks.summary.open', { count: c.open }), overdue: t('tasks.summary.overdue', { count: c.overdue }), today: t('tasks.summary.today', { count: c.dueToday }),
  });
}
