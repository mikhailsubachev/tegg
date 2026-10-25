// Slice 5A-1: the card's `More` menu (R43, D-482, D-479): Open, Status ›, Priority ›, Due date…, Move to trash (built in 6A);
// on the Kanban `Move to ›` and, grouped by tag, `Also add to ›`. A submenu replaces the list in place, so one menu is
// open at a time; Esc closes and gives the focus back to what had it.
import { useState } from 'react';
import { moveToTrash } from '../trash/moveToTrash';
import { t } from '../i18n/catalog';
import type { TaskDefsDto, TaskRowDto } from '../ipc/types';
import { PopupMenu, type MenuEntry } from '../shell/Menu';
import { PickDate } from '../dates/PickDate';
import { localDate } from '../zone';
import type { KanbanColumn } from './views';

export type MenuTarget = { row: TaskRowDto; anchor: HTMLElement; opener: HTMLElement | null; column?: string };

export type MenuActions = {
  open: (row: TaskRowDto) => void;
  status: (row: TaskRowDto, label: string) => void;
  priority: (row: TaskRowDto, label: string | null) => void;
  due: (row: TaskRowDto, date: string | null) => void;
  moveTo?: (row: TaskRowDto, from: string, to: KanbanColumn, alsoAdd: boolean) => void;
};

export function CardMenu({ target, defs, columns, tagMode, region, actions, onClose }: {
  target: MenuTarget;
  defs: TaskDefsDto;
  columns?: KanbanColumn[];
  tagMode?: boolean;
  region: string;
  actions: MenuActions;
  onClose: () => void;
}) {
  const [level, setLevel] = useState<'root' | 'status' | 'priority' | 'move' | 'also' | 'due'>('root');
  const { row } = target;
  const close = () => { onClose(); (target.opener ?? target.anchor)?.focus(); };
  const run = (f: () => void) => () => { close(); f(); };
  const disabled = row.readOnly;
  const why = disabled ? t('task.readOnly') : undefined;
  const real = (columns ?? []).filter((c) => c.dropTarget && c.id !== target.column);

  if (level === 'due') {
    // D-763 (date-picker.md FR-TSK-09 AC-5): `Due date…` opens the app's date picker; `No date` removes `due:`.
    return (
      <PickDate label={t('date.pick')} today={localDate(Date.now())} value={row.due} anchor={target.anchor}
        onPick={(d) => { close(); actions.due(row, d); }}
        onClear={() => { close(); actions.due(row, null); }}
        onClose={close} />
    );
  }

  let entries: MenuEntry[];
  if (level === 'status') {
    entries = defs.statuses.map((s) => ({ kind: 'radio', key: `s-${s.label}`, checked: row.status === s.label, disabled, description: why,
      content: <span data-user-content>{s.label}</span>, label: s.label, onChoose: run(() => actions.status(row, s.label)) }));
  } else if (level === 'priority') {
    entries = [
      ...defs.priorities.map((p): MenuEntry => ({ kind: 'radio', key: `p-${p.label}`, checked: row.priority === p.label, disabled, description: why,
        content: <span data-user-content>{p.label}</span>, label: p.label, onChoose: run(() => actions.priority(row, p.label)) })),
      { kind: 'radio', key: 'p-none', checked: row.priority === null, disabled, description: why, content: t('task.noPriority'), onChoose: run(() => actions.priority(row, null)) },
    ];
  } else if (level === 'move' || level === 'also') {
    entries = real.map((c) => ({ kind: 'item', key: `m-${c.id}`, disabled, description: why, content: <span data-user-content>{c.label}</span>, label: c.label,
      onChoose: run(() => actions.moveTo?.(row, target.column ?? '', c, level === 'also')) }));
  } else {
    entries = [
      { kind: 'item', key: 'open', content: t('task.open'), onChoose: run(() => actions.open(row)) },
      { kind: 'item', key: 'status', content: t('task.status'), disabled, description: why, onChoose: () => setLevel('status') },
      { kind: 'item', key: 'priority', content: t('task.priority'), disabled, description: why, onChoose: () => setLevel('priority') },
      { kind: 'item', key: 'due', content: t('task.dueDate'), disabled, description: why, onChoose: () => setLevel('due') },
      ...(columns ? [{ kind: 'item', key: 'move', content: t('task.moveTo'), disabled, description: why, onChoose: () => setLevel('move') } as MenuEntry] : []),
      ...(columns && tagMode ? [{ kind: 'item', key: 'also', content: t('task.alsoAddTo'), disabled, description: why, onChoose: () => setLevel('also') } as MenuEntry] : []),
      // 6A (R75, FR-HIS-01 AC-3): built.
      { kind: 'item', key: 'trash', content: t('task.trash'), disabled, description: why, onChoose: run(() => { void moveToTrash([{ path: row.path, base: row.version, title: row.title }]); }) },
    ];
  }
  return <PopupMenu key={level} label={t('task.more', { title: row.title })} anchor={target.anchor} entries={entries} onClose={onClose} />;
}
