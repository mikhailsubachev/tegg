// Slice 5A-1: the Tasks page, routes `tasks` (Schedule) and `tasks/kanban` (docs/acceptance/tasks.md R40…R46;
// docs/contracts/ms5-tasks.md §6; D-378, D-379, D-470…D-489). Every change is one task write through `write.ts`
// (or one create through the creation path); browsing writes nothing (FR-SYN-06). View, grouping, filters and Done's
// state are remembered per machine (D-481).
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import type { Value } from '@tegg/doc';
import { t } from '../i18n/catalog';
import { ipc } from '../ipc/client';
import type { TaskRowDto, UiStateDto } from '../ipc/types';
import { createObject } from '../types/create';
import { CardMenu, type MenuTarget } from './CardMenu';
import { KanbanView } from './Kanban';
import { QuickAdd } from './QuickAddRow';
import { ScheduleView } from './Schedule';
import { TagFilter } from './TagFilter';
import { TaskCard, type TaskNav } from './TaskCard';
import { TasksHeader, tasksSummary, type TasksView } from './TasksHeader';
import { useTasks } from './useTasks';
import { counts as countsOf, kanban, schedule, tagSpellings, type KanbanColumn, type ViewInput } from './views';
import { writeTask, type TaskAction } from './write';
import type { TaskChange } from '@tegg/doc';

export type TasksUi = NonNullable<UiStateDto['tasks']>;
export const DEFAULT_TASKS_UI: TasksUi = { view: 'schedule', groupBy: 'status', dateFilter: 'all', tags: [], doneExpanded: false };

type Alert = { id: number; text: string; retry?: () => void };

/** A task completed or changed on the Schedule stays where it was shown until the page is left. */
type Stay = { section: 'today' | 'week' | 'later' | 'none'; group: string; index: number };

export function TasksPage({ view, refresh, heading, ui, onUi, nav, go, onSettings, commandRef }: {
  view: 'schedule' | 'kanban';
  refresh: number;
  heading: RefObject<HTMLHeadingElement | null>;
  ui: TasksUi;
  onUi: (f: (u: TasksUi) => TasksUi) => void;
  nav: TaskNav;
  go: (view: TasksView) => void;
  /** `Type settings` in the header (D-517, D-519). */
  onSettings: () => void;
  commandRef: { current: ((id: string) => void) | null };
}) {
  const data = useTasks(refresh);
  const { tasks, defs, today, zone, region, firstWeekday, reload, loaded } = data;
  const [menu, setMenu] = useState<MenuTarget | null>(null);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [live, setLive] = useState('');
  const [note, setNote] = useState('');
  const [stay, setStay] = useState<Map<string, Stay>>(new Map());
  const focusAfter = useRef<{ path: string; column: string } | null>(null);
  /** The card that had the focus last, for palette commands run after the palette took it (R45). */
  const lastCard = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const on = (e: FocusEvent) => {
      const a = (e.target as HTMLElement | null)?.closest?.<HTMLElement>('main article[data-path]');
      if (a) lastCard.current = a;
    };
    window.addEventListener('focusin', on);
    return () => window.removeEventListener('focusin', on);
  }, []);
  const alertSeq = useRef(0);
  const collator = useMemo(() => new Intl.Collator(region), [region]);
  const tagMode = view === 'kanban' && ui.groupBy === 'tag';
  const input: ViewInput = { tasks, defs, today, firstWeekday, collator, dateFilter: ui.dateFilter as ViewInput['dateFilter'], tagFilter: ui.tags, timeZone: zone };
  const c = countsOf(input);
  const spell = useMemo(() => tagSpellings(tasks), [tasks]);
  const sched = useMemo(() => (view === 'schedule' ? withStay(schedule(input), stay, tasks) : null), [view, tasks, defs, today, firstWeekday, ui.dateFilter, ui.tags.join('\n'), stay, zone, collator]);
  const board = useMemo(() => (view === 'kanban' ? kanban(input, tagMode ? 'tag' : 'status', spell).columns : []), [view, tasks, defs, today, firstWeekday, ui.dateFilter, ui.tags.join('\n'), tagMode, spell, zone, collator]);

  // route-ready after the first paint of the cards (FR-TSK-04 AC-14).
  const marked = useRef(false);
  useEffect(() => {
    if (!loaded || marked.current) return;
    marked.current = true;
    requestAnimationFrame(() => setTimeout(() => void ipc.perfMark(`route-ready:${view === 'kanban' ? 'tasks/kanban' : 'tasks'}`).catch(() => {}), 0));
  }, [loaded]);
  useEffect(() => { onUi((u) => (u.view === view ? u : { ...u, view })); }, [view]);

  // The moved card keeps the focus in its new column (FR-TSK-05 AC-8).
  useLayoutEffect(() => {
    const f = focusAfter.current;
    if (!f) return;
    const el = document.querySelector<HTMLElement>(`main [data-column="${cssEsc(f.column)}"] [data-path="${cssEsc(f.path)}"]`);
    if (el) { focusAfter.current = null; el.focus(); el.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }
  });

  const alert = useCallback((text: string, retry?: () => void) => {
    const id = ++alertSeq.current;
    setAlerts((a) => [...a.filter((x) => x.text !== text), { id, text, retry }]);
  }, []);
  const dismiss = (id: number) => setAlerts((a) => a.filter((x) => x.id !== id));

  /** One write and what follows it: the live message, the alerts, a fresh read. */
  const act = useCallback(async (row: TaskRowDto, action: TaskAction, o: { moved?: string; base?: 'row' | 'current' } = {}): Promise<boolean> => {
    const r = await writeTask(row, defs, action, o.base ?? 'row');
    if (r.outcome === 'written') {
      if (o.moved) setLive(t('tasks.moved', { title: row.title, column: o.moved }));
      else if (action.kind === 'complete' && action.done) setLive(t('task.completed', { title: row.title }));
      if (r.inlineKept && action.kind === 'change' && action.change.kind === 'moveTag' && action.change.from) setNote(t('task.inlineTag', { tag: action.change.from, title: row.title }));
    } else if (r.outcome === 'conflict') alert(t('task.changedOutside', { title: row.title }));
    else if (r.outcome === 'failed') {
      const retry = () => { void act(row, action, { ...o, base: 'current' }); };
      alert(t('task.saveFailed', { title: row.title }), retry);
    }
    await reload();
    return r.outcome === 'written' || r.outcome === 'unchanged';
  }, [defs, reload, alert]);

  const keepInPlace = (row: TaskRowDto) => {
    if (view !== 'schedule' || !sched) return;
    const at = locate(sched, row.path);
    if (at) setStay((m) => new Map(m).set(row.path, at));
  };
  const toggle = (row: TaskRowDto, done: boolean) => { keepInPlace(row); void act(row, { kind: 'complete', done }); };
  const change = (row: TaskRowDto, ch: TaskChange, moved?: string) => act(row, { kind: 'change', change: ch }, { moved });
  const stateOf = (label: string | null) => defs.statuses.find((s) => s.label === label)?.state ?? 'open';
  const setStatus = (row: TaskRowDto, label: string, moved?: string) => {
    if (row.statusKnown && row.status === label) return Promise.resolve(true);
    keepInPlace(row);
    const firstOpen = defs.statuses.find((s) => s.state === 'open')?.label ?? label;
    return change(row, { kind: 'status', to: label, toState: stateOf(label) as never, fromState: stateOf(row.status) as never, firstOpen, now: '' }, moved);
  };

  const drop = (row: TaskRowDto, from: string, to: KanbanColumn, alt: boolean) => {
    if (!tagMode) { void setStatus(row, to.id, to.label).then(() => { focusAfter.current = { path: row.path.normalize('NFC'), column: to.id }; }); return; }
    const fromKey = !alt && from.startsWith('#') ? from.slice(1) : null;
    void change(row, { kind: 'moveTag', from: fromKey, to: to.label.replace(/^#/, '') }, to.label).then(() => { focusAfter.current = { path: row.path.normalize('NFC'), column: to.id }; });
  };
  const moveBy = (row: TaskRowDto, column: string, dir: 1 | -1) => {
    const real = board.filter((x) => x.dropTarget);
    const i = real.findIndex((x) => x.id === column);
    const to = i < 0 ? undefined : real[i + dir];
    if (!to) return;
    focusAfter.current = { path: row.path.normalize('NFC'), column: to.id };
    drop(row, column, to, false);
  };

  const create = useCallback(async (title: string, values: [string, Value][]) => {
    try {
      await createObject('task', title, values);
      setLive(t('tasks.created', { title }));
      await reload();
      return true;
    } catch {
      const retry = () => { void create(title, values); };
      alert(t('task.saveFailed', { title }), retry);
      return false;
    }
  }, [reload, alert]);

  // Card keyboard (D-479, FR-TSK-04 AC-10): arrows move between cards, ⏎ opens, Space completes, ⇧F10 the menu,
  // ⌥←/⌥→ move a card on the Kanban.
  const onKey = (column?: KanbanColumn) => (e: React.KeyboardEvent<HTMLElement>, row: TaskRowDto) => {
    const card = e.currentTarget;
    const target = e.target as HTMLElement;
    if (target.tagName === 'INPUT') return;
    if (e.altKey && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
      if (column) { e.preventDefault(); moveBy(row, column.id, e.key === 'ArrowRight' ? 1 : -1); }
      return;
    }
    if (['ArrowDown', 'ArrowUp', 'ArrowRight', 'ArrowLeft'].includes(e.key)) {
      e.preventDefault();
      const all = [...document.querySelectorAll<HTMLElement>('main article[data-path]')];
      const i = all.indexOf(card);
      const next = all[i + (e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : -1)];
      next?.focus();
      return;
    }
    if (target !== card) return;
    if (e.key === 'Enter') { e.preventDefault(); nav.openNote(row.path); }
    else if (e.key === ' ') { e.preventDefault(); if (!row.readOnly) toggle(row, row.state !== 'done'); }
    else if (e.key === 'F10' && e.shiftKey) { e.preventDefault(); setMenu({ row, anchor: card, opener: card, column: column?.id }); }
  };

  // Palette commands (R45): page commands, and card commands for the focused card.
  commandRef.current = (id: string) => {
    const active = (document.activeElement as HTMLElement | null)?.closest<HTMLElement>('main article[data-path]');
    const focused = active ?? (lastCard.current && document.contains(lastCard.current) ? lastCard.current : null);
    const row = focused ? tasks.find((x) => x.path.normalize('NFC') === focused.getAttribute('data-path')) : undefined;
    const column = focused?.closest('[data-column]')?.getAttribute('data-column') ?? undefined;
    switch (id) {
      case 'tasks.groupStatus': if (view === 'kanban') onUi((u) => ({ ...u, groupBy: 'status' })); break;
      case 'tasks.groupTag': if (view === 'kanban') onUi((u) => ({ ...u, groupBy: 'tag' })); break;
      case 'tasks.filterAll': onUi((u) => ({ ...u, dateFilter: 'all' })); break;
      case 'tasks.filterToday': onUi((u) => ({ ...u, dateFilter: 'today' })); break;
      case 'tasks.filterWeek': onUi((u) => ({ ...u, dateFilter: 'week' })); break;
      case 'tasks.add': document.querySelector<HTMLInputElement>('main [data-quick-add] input')?.focus(); break;
      case 'task.complete': if (row && !row.readOnly) toggle(row, true); break;
      case 'task.setStatus': if (row && focused) setMenu({ row, anchor: focused, opener: focused, column }); break;
      case 'task.moveNext': if (row && column && view === 'kanban') moveBy(row, column, 1); break;
      case 'task.movePrevious': if (row && column && view === 'kanban') moveBy(row, column, -1); break;
    }
  };
  useEffect(() => () => { commandRef.current = null; }, []);

  const card = (row: TaskRowDto, column?: KanbanColumn, drag?: Record<string, unknown>) => (
    <TaskCard key={`${column?.id ?? ''}:${row.path}`} row={row} defs={defs} today={today} region={region} zone={zone} nav={nav}
      alsoIn={column && tagMode ? row.tags.filter((k) => `#${k}` !== column.id).map((k) => spell.get(k) ?? k) : undefined}
      onToggle={toggle} onMenu={(r, anchor, opener) => setMenu({ row: r, anchor, opener: anchor ?? opener, column: column?.id })}
      onKey={onKey(column)} dragProps={drag} />
  );

  const filterButton = (id: 'all' | 'today' | 'week', label: string, count: number) => (
    <button key={id} type="button" className="toggle" data-command={id === 'all' ? 'tasks.filterAll' : id === 'today' ? 'tasks.filterToday' : 'tasks.filterWeek'} aria-pressed={ui.dateFilter === id} aria-label={label} aria-describedby={`tf-${id}`}
      onClick={() => onUi((u) => ({ ...u, dateFilter: id }))}>
      {label} <span id={`tf-${id}`} className="count">{count}</span>
    </button>
  );

  return (
    <div className="page-column tasks-page">
      <TasksHeader view={view} heading={heading} summary={tasksSummary(c)} go={go} onSettings={onSettings} />
      <QuickAdd hint presets={{ due: view === 'schedule' ? today : null }} today={today} region={region} priorities={defs.priorities.map((p) => p.label)} onCreate={create} />
      <div className="tasks-toolbar">
        {view === 'kanban' && (
          <div role="tablist" aria-label={t('tasks.groupBy')} className="tabs">
            {(['status', 'tag'] as const).map((g) => (
              <button key={g} type="button" role="tab" data-command={g === 'status' ? 'tasks.groupStatus' : 'tasks.groupTag'} aria-selected={ui.groupBy === g} tabIndex={ui.groupBy === g ? 0 : -1} onClick={() => onUi((u) => ({ ...u, groupBy: g }))}>
                {t(g === 'status' ? 'tasks.group.status' : 'tasks.group.tag')}
              </button>
            ))}
          </div>
        )}
        <div role="group" aria-label={t('tasks.filter')} className="tasks-filter">
          {filterButton('all', t('tasks.filter.all'), c.all)}
          {filterButton('today', t('tasks.filter.today'), c.today)}
          {filterButton('week', t('tasks.filter.week'), c.week)}
        </div>
        <TagFilter tags={c.tags.map((x) => ({ key: x.key, label: x.label, count: x.count }))} selected={ui.tags} onChange={(tags) => onUi((u) => ({ ...u, tags }))} />
        <button type="button" className="toggle tasks-sort" aria-disabled="true" aria-description={t('due.comingIn', { due: 'v1.0' })} data-command="tasks.sort">
          {t(view === 'schedule' ? 'tasks.sort.schedule' : 'tasks.sort.kanban')}
        </button>
      </div>
      {view === 'kanban' && <p className="hint">{t(tagMode ? 'tasks.board.hintTag' : 'tasks.board.hintStatus')}</p>}
      {alerts.length > 0 && (
        <div className="task-alerts">
          {alerts.map((a) => (
            <div key={a.id} role="alert" className="task-alert">
              <span>{a.text}</span>
              {a.retry && <button type="button" data-command="task.tryAgain" onClick={() => { dismiss(a.id); a.retry!(); }}>{t('task.tryAgain')}</button>}
              <button type="button" className="icon-button" data-command="task.dismissAlert" aria-label={t('dialog.close')} onClick={() => dismiss(a.id)}>×</button>
            </div>
          ))}
        </div>
      )}
      {view === 'schedule' && sched && (
        <ScheduleView s={sched} filter={ui.dateFilter as 'all' | 'today' | 'week'} today={today} region={region} firstWeekday={firstWeekday}
          priorities={defs.priorities.map((p) => p.label)} renderCard={(r) => card(r)} doneExpanded={ui.doneExpanded}
          onToggleDone={() => onUi((u) => ({ ...u, doneExpanded: !u.doneExpanded }))} onCreate={create} />
      )}
      {view === 'kanban' && (
        <KanbanView columns={board} tagMode={tagMode} today={today} region={region} priorities={defs.priorities.map((p) => p.label)}
          renderCard={(r, col, d) => card(r, col, d)} onDrop={drop} onCreate={create} />
      )}
      <div role="status" className="sr-live" aria-live="polite">{live}</div>
      {note && <div role="status" className="task-note">{note}</div>}
      {menu && (
        <CardMenu target={menu} defs={defs} region={region} columns={view === 'kanban' ? board : undefined} tagMode={tagMode} onClose={() => setMenu(null)}
          actions={{
            open: (r) => nav.openNote(r.path),
            status: (r, label) => { void setStatus(r, label); },
            priority: (r, label) => { void change(r, { kind: 'priority', to: label }); },
            due: (r, date) => { void change(r, { kind: 'due', to: date }); },
            moveTo: (r, from, to, also) => drop(r, from, to, also),
          }} />
      )}
    </div>
  );
}

function cssEsc(s: string): string {
  return s.replace(/["\\]/g, '\\$&');
}

/** Where a row is shown on the Schedule now. */
function locate(s: ReturnType<typeof schedule>, path: string): Stay | null {
  const find = (rows: TaskRowDto[]) => rows.findIndex((r) => r.path === path);
  for (const [section, group, rows] of [
    ['today', 'overdue', s.today.overdue], ['today', 'today', s.today.today], ...s.week.map((g) => ['week', g.date, g.tasks] as const),
    ['later', 'later', s.later], ['none', 'none', s.none],
  ] as const) {
    const i = find(rows as TaskRowDto[]);
    if (i >= 0) return { section: section as Stay['section'], group, index: i };
  }
  return null;
}

/** Puts every stayed row back where it was shown (with its fresh values). */
function withStay(s: ReturnType<typeof schedule>, stay: Map<string, Stay>, tasks: TaskRowDto[]): ReturnType<typeof schedule> {
  if (!stay.size) return s;
  const out = { ...s, today: { overdue: [...s.today.overdue], today: [...s.today.today] }, week: s.week.map((g) => ({ ...g, tasks: [...g.tasks] })), later: [...s.later], none: [...s.none], done: [...s.done] };
  const lists = (): TaskRowDto[][] => [out.today.overdue, out.today.today, ...out.week.map((g) => g.tasks), out.later, out.none, out.done];
  for (const [path, at] of stay) {
    const row = tasks.find((r) => r.path === path);
    for (const l of lists()) { const i = l.findIndex((r) => r.path === path); if (i >= 0) l.splice(i, 1); }
    if (!row) continue;
    let list: TaskRowDto[] | undefined;
    if (at.section === 'today') list = at.group === 'overdue' ? out.today.overdue : out.today.today;
    else if (at.section === 'week') {
      let g = out.week.find((x) => x.date === at.group);
      if (!g) { g = { date: at.group, tasks: [] }; out.week.push(g); out.week.sort((a, b) => (a.date < b.date ? -1 : 1)); }
      list = g.tasks;
    } else list = at.section === 'later' ? out.later : out.none;
    list.splice(Math.min(at.index, list.length), 0, row);
  }
  return out;
}
