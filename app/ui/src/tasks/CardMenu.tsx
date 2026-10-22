// Slice 5A-1: the card's `More` menu (R43, D-482, D-479): Open, Status ›, Priority ›, Due date…, Move to trash (built in 6A);
// on the Kanban `Move to ›` and, grouped by tag, `Also add to ›`. A submenu replaces the list in place, so one menu is
// open at a time; Esc closes and gives the focus back to what had it.
import { useRef, useState } from 'react';
import { parseDate as parseRegionDate } from '@tegg/schema';
import { moveToTrash } from '../trash/moveToTrash';
import { t } from '../i18n/catalog';
import type { TaskDefsDto, TaskRowDto } from '../ipc/types';
import { PopupMenu, type MenuEntry } from '../shell/Menu';
import { Icon } from '../shell/Icon';
import { DatePicker } from '../types/controls/DateControls';
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
  const [dueText, setDueText] = useState('');
  const [dueError, setDueError] = useState(false);
  const [picker, setPicker] = useState(false);
  const pickBtn = useRef<HTMLButtonElement | null>(null);
  const { row } = target;
  const close = () => { onClose(); (target.opener ?? target.anchor)?.focus(); };
  const run = (f: () => void) => () => { close(); f(); };
  const disabled = row.readOnly;
  const why = disabled ? t('task.readOnly') : undefined;
  const real = (columns ?? []).filter((c) => c.dropTarget && c.id !== target.column);

  if (level === 'due') {
    return (
      <div className="popup-menu task-due-pop" role="dialog" aria-label={t('task.dueTitle')} style={{ position: 'fixed', ...pos(target.anchor) }}
        onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } }}>
        <input autoFocus aria-label={t('task.dueTitle')} value={dueText} aria-invalid={dueError || undefined}
          onChange={(e) => { setDueText(e.target.value); setDueError(false); }}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return;
            e.preventDefault();
            if (!dueText.trim()) { close(); actions.due(row, null); return; }
            const p = parseRegionDate(dueText, region);
            if (p.ok && p.value && typeof p.value === 'object' && 'date' in p.value) { close(); actions.due(row, (p.value as { date: string }).date); } else setDueError(true);
          }} />
        {/* D-587: the month grid of a date property, next to the field. */}
        <button ref={pickBtn} type="button" tabIndex={0} className="icon-button" data-command="task.dueDate" aria-label={t('panel.datePicker')} title={t('panel.datePicker')}
          aria-haspopup="dialog" aria-expanded={picker} onClick={() => setPicker((p) => !p)}>
          <Icon name="calendar" size={14} />
        </button>
        {picker && (
          <DatePicker value={row.due} anchor={pickBtn.current}
            onClose={() => { setPicker(false); pickBtn.current?.focus(); }}
            onPick={(d) => { setPicker(false); close(); actions.due(row, d); }} />
        )}
      </div>
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
      { kind: 'item', key: 'due', content: t('task.dueDate'), disabled, description: why, onChoose: () => { setDueText(row.due ?? ''); setLevel('due'); } },
      ...(columns ? [{ kind: 'item', key: 'move', content: t('task.moveTo'), disabled, description: why, onChoose: () => setLevel('move') } as MenuEntry] : []),
      ...(columns && tagMode ? [{ kind: 'item', key: 'also', content: t('task.alsoAddTo'), disabled, description: why, onChoose: () => setLevel('also') } as MenuEntry] : []),
      // 6A (R75, FR-HIS-01 AC-3): built.
      { kind: 'item', key: 'trash', content: t('task.trash'), disabled, description: why, onChoose: run(() => { void moveToTrash([{ path: row.path, base: row.version, title: row.title }]); }) },
    ];
  }
  return <PopupMenu key={level} label={t('task.more', { title: row.title })} anchor={target.anchor} entries={entries} onClose={onClose} />;
}

function pos(anchor: HTMLElement) {
  const r = anchor.getBoundingClientRect();
  return { left: r.left, top: r.bottom + 4 };
}
