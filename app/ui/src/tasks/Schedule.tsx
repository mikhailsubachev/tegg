// Slice 5A-1: the Schedule view (FR-TSK-04, R41; D-474…D-477): Today & overdue, This week by day, Later, Not
// scheduled, Done (collapsed, 50 at a time). A task completed here stays where it was until the page is left, so the
// focus and the next click stay on it (FR-TSK-02 AC-10, FR-TSK-04 AC-10).
import { useState, type ReactNode } from 'react';
import type { Value } from '@tegg/doc';
import { t } from '../i18n/catalog';
import type { TaskRowDto } from '../ipc/types';
import { QuickAdd } from './QuickAddRow';
import { shortDate, weekOf, type Schedule as Buckets } from './views';

export type SectionId = 'today' | 'week' | 'later' | 'none' | 'done';
type Group = { key: string; heading: string | null; danger?: boolean; date?: boolean; rows: TaskRowDto[] };

export function ScheduleView({ s, filter, today, region, firstWeekday, priorities, renderCard, doneExpanded, searching, onToggleDone, onCreate }: {
  s: Buckets;
  filter: 'all' | 'today' | 'week';
  today: string;
  region: string;
  firstWeekday: number;
  priorities: string[];
  renderCard: (row: TaskRowDto) => ReactNode;
  doneExpanded: boolean;
  /** With a search, sections and groups without a match aren't shown (D-1281). */
  searching: boolean;
  onToggleDone: () => void;
  onCreate: (title: string, values: [string, Value][]) => Promise<boolean>;
}) {
  const [adding, setAdding] = useState<SectionId | null>(null);
  const [doneShown, setDoneShown] = useState(50);
  const { last } = weekOf(today, firstWeekday);
  const date = (d: string) => shortDate(d, region);
  const section = (id: SectionId, label: string, groups: Group[], hint: string | null, add: { label: string; due: string | null } | null) => {
    const count = groups.reduce((n, g) => n + g.rows.length, 0);
    if (searching && !count) return null;
    return (
      <section key={id} className="task-section" data-section={id} role="region" aria-label={label}>
        <header className="task-section-head">
          <h2><span>{label}</span> <span className="count">{count}</span></h2>
          {hint && <p className="hint">{hint}</p>}
          {add && <button type="button" className="text-button" data-command="tasks.add" onClick={() => setAdding(id)}>{add.label}</button>}
        </header>
        {add && adding === id && (
          <QuickAdd inline autoFocus presets={{ due: add.due }} today={today} region={region} priorities={priorities} label={add.label}
            onClose={() => setAdding(null)} onCreate={async (title, values) => { const ok = await onCreate(title, values); if (ok) setAdding(null); return ok; }} />
        )}
        {groups.filter((g) => !searching || g.rows.length).map((g) => (
          <div key={g.key} className="task-group">
            {/* A day group's heading is the region's date (Intl), not catalog text (NFR-OTH-02). */}
            {g.heading && <h3 className={g.danger ? 'danger' : undefined}>{g.date ? <span data-user-content>{g.heading}</span> : g.heading}</h3>}
            <div className="task-list">{g.rows.map(renderCard)}</div>
          </div>
        ))}
      </section>
    );
  };
  const out: ReactNode[] = [];
  const todayGroups: Group[] = [
    ...(s.today.overdue.length ? [{ key: 'overdue', heading: t('tasks.group.overdue'), danger: true, rows: s.today.overdue }] : []),
    { key: 'today', heading: t('tasks.group.today', { date: date(today) }), rows: s.today.today },
  ];
  out.push(section('today', t('tasks.section.today'), todayGroups, t('tasks.hint.today'), { label: t('tasks.add.today'), due: today }));
  if (filter !== 'today' && s.weekRange) {
    out.push(section('week', t('tasks.section.week'), s.week.map((g) => ({ key: g.date, heading: date(g.date), date: true, rows: g.tasks })),
      t('tasks.hint.week', { from: date(s.weekRange.from), to: date(s.weekRange.to) }), { label: t('tasks.add.week'), due: last }));
  }
  if (filter === 'all') {
    out.push(section('later', t('tasks.section.later'), [{ key: 'later', heading: null, rows: s.later }], t('tasks.hint.later', { date: date(last) }), null));
    out.push(section('none', t('tasks.section.none'), [{ key: 'none', heading: null, rows: s.none }], t('tasks.hint.none'), { label: t('tasks.add.none'), due: null }));
  }
  const done = s.done;
  if (!searching || done.length) out.push(
    <section key="done" className="task-section" data-section="done" role="region" aria-label={t('tasks.section.done')}>
      <h2 className="task-done-head">
        <button type="button" data-command="tasks.toggleDone" aria-expanded={doneExpanded} onClick={onToggleDone}>
          <span>{t('tasks.section.done')}</span> <span className="count">{done.length}</span>
        </button>
      </h2>
      {doneExpanded && (
        <>
          <div className="task-list">{done.slice(0, doneShown).map(renderCard)}</div>
          {done.length > doneShown && (
            <button type="button" className="text-button" data-command="tasks.showMore" onClick={() => setDoneShown(done.length)}>{t('tasks.doneMore', { count: done.length - doneShown })}</button>
          )}
        </>
      )}
    </section>,
  );
  return <div className="task-schedule">{out}</div>;
}
