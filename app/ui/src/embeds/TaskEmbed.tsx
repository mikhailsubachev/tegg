// Slice 5A-2: the Task card (D-74, D-497; conversion.md R52; docs/contracts/ms5-tasks.md §11.5): the 4F card frame of a
// Task embed with a header row (checkbox, title, Status, Priority, Due, Open, Display as) and the task's body below,
// editable in place. The header is computed from the text the embed already loaded (`taskHeader`); every control
// writes the task file only, through the one task write path (tasks/write.ts, §5).
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { parse } from '@tegg/doc';
import { t } from '../i18n/catalog';
import { events, ipc } from '../ipc/client';
import type { TaskDefsDto, TaskRowDto } from '../ipc/types';
import { pushAlert } from '../convert/alerts';
import { PopupMenu, type MenuEntry } from '../shell/Menu';
import { Icon } from '../shell/Icon';
import { DateControl } from '../types/controls/DateControls';
import { taskHeader, type TaskHeader } from '../tasks/header';
import { currentRegion, useToday } from '../tasks/useTasks';
import { dueLabel } from '../tasks/views';
import { writeTask, type TaskAction } from '../tasks/write';
import { Checkbox } from '../tasks/TaskCard';
import type { EmbedNode } from './tree';

// ------------------------------------------------------------------------------------------------ writes

/** A card wrote its task (`text` and `version`), or found it changed on disk (`null`): the page's other views of the
 *  file (its embed tree, the nested editors of the same file) follow (FR-CNV-05 AC-7, AC-8). */
export type TaskWritten = (path: string, written: { text: string; version: unknown } | null) => void;
export const taskWrites = new Set<TaskWritten>();

// ------------------------------------------------------------------------------------------------ the type's options

const EMPTY: TaskDefsDto = { statuses: [], priorities: [], unknownStates: [] };
let defs: TaskDefsDto | null = null;
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();

function loadDefs() {
  loading ??= ipc.taskList().then((d) => { defs = d.defs; }, () => {}).finally(() => {
    loading = null;
    for (const l of listeners) l();
  });
}
let watching = false;
function watch() {
  if (watching) return;
  watching = true;
  // A changed Task type file changes the options (statuses, priorities).
  void events.changed((c) => { if (c.paths.some((p) => p.startsWith('.tegg/types/'))) { defs = null; loadDefs(); } }).catch(() => {});
}

/** The Task type's options, from `task_list` (D-531), cached for every card on the page. */
function useTaskDefs(): TaskDefsDto {
  const d = useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => defs);
  useEffect(() => {
    watch();
    if (!defs) loadDefs();
  }, []);
  return d ?? EMPTY;
}

/** A Task embed in card mode (`![[Task]]` with the Task default, or `|card`): the D-74 card. */
export function isTaskCard(node: EmbedNode): boolean {
  return !node.inline && node.mode === 'card' && node.state === 'ok' && node.target.type === 'task' && !!node.note;
}

// ------------------------------------------------------------------------------------------------ the card

function badFrontmatter(text: string): boolean {
  const d = parse(text);
  return !!d.frontmatterError || (!!d.frontmatter && d.frontmatter.data === null);
}

type Props = {
  node: EmbedNode;
  /** The host editor (not the read view) at depth 1 (D-421). */
  editable: boolean;
  title: string;
  body?: ReactNode;
  onOpen: () => void;
  modeMenu: ReactNode;
  openButton: ReactNode;
};

export function TaskEmbed({ node, editable, title, body, openButton, modeMenu }: Props) {
  const d = useTaskDefs();
  const { today, zone } = useToday();
  const region = currentRegion();
  const note = node.note!;
  const text = note.text ?? '';
  const h = taskHeader(text, d);
  // R52: read-only in the read view, at depth 2 and 3, and for files the editor opens read-only (NFR-REL-03).
  const readOnly = !editable || node.depth > 1 || !note.utf8 || badFrontmatter(text);
  const why = readOnly ? t('task.readOnly') : undefined;
  const name = h.title || title;
  const done = h.state === 'done';
  const row = {
    path: note.path, id: null, title: name, status: h.status, state: h.state, statusKnown: h.statusKnown, priority: h.priority, priorityRank: 0,
    dueRaw: h.dueRaw, due: h.due, completed: h.completed, tags: [], fmTags: [], source: null, excerpt: '', created: null, modified: null,
    version: note.version, readOnly,
  } as unknown as TaskRowDto;
  const [menu, setMenu] = useState<null | 'status' | 'priority' | 'due'>(null);
  const statusBtn = useRef<HTMLButtonElement | null>(null);
  const priorityBtn = useRef<HTMLButtonElement | null>(null);
  const dueBtn = useRef<HTMLButtonElement | null>(null);

  const act = async (action: TaskAction) => {
    if (readOnly) return;
    const r = await writeTask(row, d, action);
    if (r.outcome === 'written' && r.text !== undefined) for (const f of taskWrites) f(note.path, { text: r.text, version: r.version });
    if (r.outcome === 'conflict' || r.outcome === 'gone') for (const f of taskWrites) f(note.path, null);
    if (r.outcome === 'conflict') pushAlert(t('task.changedOutside', { title: name }));
    else if (r.outcome === 'failed') pushAlert(t('task.saveFailed', { title: name }), () => void writeTask(row, d, action, 'current'));
  };
  const firstOpen = d.statuses.find((s) => s.state === 'open')?.label ?? d.statuses[0]?.label ?? '';
  const setStatus = (label: string) => {
    const to = d.statuses.find((s) => s.label === label);
    void act({ kind: 'change', change: { kind: 'status', to: label, toState: (to?.state ?? 'open') as TaskHeader['state'], fromState: h.state, firstOpen, now: '' } });
  };
  const close = (back: HTMLElement | null) => { setMenu(null); back?.focus(); };

  const due = dueLabel(row, today, region, zone);
  const overdue = due.tone === 'overdue';
  const dueName = t('task.dueButton', { label: due.text || t('task.none') }) + (overdue ? `, ${t('task.overdueWord')}` : '');
  const statusColor = d.statuses.find((s) => s.label === h.status)?.color ?? null;
  const button = (o: { ref: React.MutableRefObject<HTMLButtonElement | null>; which: 'status' | 'priority' | 'due'; name: string; command: string; attrs?: Record<string, string>; children: ReactNode }) => (
    <button
      ref={o.ref}
      type="button"
      tabIndex={0}
      className="task-card-btn"
      data-command={o.command}
      aria-haspopup={o.which === 'due' ? 'dialog' : 'menu'}
      aria-expanded={menu === o.which}
      aria-label={o.name}
      aria-disabled={readOnly || undefined}
      aria-description={why}
      onMouseDown={(e) => e.preventDefault()}
      onClick={(e) => { e.stopPropagation(); if (!readOnly) setMenu(menu === o.which ? null : o.which); }}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') e.stopPropagation(); }}
      {...o.attrs}
    >
      {o.children}
    </button>
  );

  let popup: ReactNode = null;
  if (menu === 'status' || menu === 'priority') {
    const entries: MenuEntry[] = menu === 'status'
      ? d.statuses.map((s) => ({ kind: 'radio', key: `s-${s.label}`, checked: h.status === s.label, content: <span data-user-content>{s.label}</span>, label: s.label,
        onChoose: () => { close(statusBtn.current); if (s.label !== h.status) setStatus(s.label); } }))
      : [
        ...d.priorities.map((p): MenuEntry => ({ kind: 'radio', key: `p-${p.label}`, checked: h.priority === p.label, content: <span data-user-content>{p.label}</span>, label: p.label,
          onChoose: () => { close(priorityBtn.current); if (p.label !== h.priority) void act({ kind: 'change', change: { kind: 'priority', to: p.label } }); } })),
        { kind: 'radio', key: 'p-none', checked: h.priority === null, content: t('task.noPriority'),
          onChoose: () => { close(priorityBtn.current); if (h.priority !== null) void act({ kind: 'change', change: { kind: 'priority', to: null } }); } },
      ];
    const anchor = menu === 'status' ? statusBtn.current : priorityBtn.current;
    // Above the button when there's no room below it (a card near the bottom of the window).
    const below = !anchor || anchor.getBoundingClientRect().bottom + 240 < window.innerHeight;
    popup = <PopupMenu label={menu === 'status' ? t('task.status') : t('task.priority')} anchor={anchor} entries={entries} onClose={() => close(anchor)} placement={below ? 'below' : 'above'} />;
  } else if (menu === 'due') {
    popup = <DuePopover anchor={dueBtn.current} raw={h.dueRaw}
      onClose={() => close(dueBtn.current)}
      onDue={(v) => { close(dueBtn.current); if (v !== h.due) void act({ kind: 'change', change: { kind: 'due', to: v } }); }} />;
  }

  return (
    <>
      <div className="embed-header task-embed-header" onClick={(e) => e.stopPropagation()}>
        <Checkbox row={row} onToggle={(v) => void act({ kind: 'complete', done: v })} />
        <span className={`embed-title task-embed-title${done ? ' done' : ''}`} data-user-content>{name}</span>
        {button({ ref: statusBtn, which: 'status', name: t('task.statusButton', { label: h.status ?? t('task.none') }), command: 'task.setStatus', attrs: { 'data-status': h.status ?? '' },
          children: <><span className="dot" data-color={statusColor ?? ''} style={statusColor ? { background: `var(--type-${statusColor})` } : undefined} /><span data-user-content>{h.status ?? t('task.none')}</span></> })}
        {button({ ref: priorityBtn, which: 'priority', name: t('task.priorityButton', { label: h.priority ?? t('task.none') }), command: 'task.setPriority', attrs: { 'data-priority': h.priority ?? '' },
          children: <><Icon name="flag" size={12} /><span data-user-content>{h.priority ?? t('task.none')}</span></> })}
        {button({ ref: dueBtn, which: 'due', name: dueName, command: 'task.setDue', attrs: { 'data-due': h.dueRaw ?? '', 'data-tone': due.tone },
          children: <><Icon name="calendar" size={12} /><span>{due.text || t('task.none')}</span></> })}
        {openButton}
        {modeMenu}
      </div>
      {popup}
      <div className="embed-body task-embed-body" data-embed-body data-embed-editable={!readOnly && body ? 'true' : 'false'}>
        {!readOnly && body ? body : <TaskBodyText text={text} />}
      </div>
    </>
  );
}

/** The body as plain paragraphs where it can't be edited (read view, depth ≥ 2, read-only files). */
function TaskBodyText({ text }: { text: string }) {
  const body = text.slice(parse(text).bodyStart).trim();
  if (!body) return null;
  return <div className="task-embed-text" data-user-content>{body.split(/\r?\n\r?\n/).map((p, i) => <p key={i}>{p}</p>)}</div>;
}

/** The attribute panel's date control in a small dialog, with `Clear` (D-537). */
function DuePopover({ anchor, raw, onDue, onClose }: { anchor: HTMLElement | null; raw: string | null; onDue: (v: string | null) => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const r = anchor?.getBoundingClientRect();
  const below = !r || r.bottom + 120 < window.innerHeight;
  useEffect(() => {
    ref.current?.querySelector<HTMLInputElement>('input')?.focus();
    const away = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node) && !anchor?.contains(e.target as Node)) onClose(); };
    document.addEventListener('mousedown', away, true);
    return () => document.removeEventListener('mousedown', away, true);
  }, []);
  return (
    <div ref={ref} role="dialog" aria-label={t('task.dueTitle')} className="popup-menu task-due-pop" style={{ position: 'fixed', left: r?.left ?? 0, ...(below ? { top: (r?.bottom ?? 0) + 4 } : { bottom: window.innerHeight - (r?.top ?? 0) + 4 }) }}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); } }}>
      <DateControl name={t('task.dueTitle')} raw={raw} onValue={(v) => {
        if (v === null) onDue(null);
        else if (typeof v === 'object' && v && 'date' in v) onDue((v as { date: string }).date);
        else return false;
      }} />
      <button type="button" data-command="task.clearDue" onClick={() => onDue(null)}>{t('panel.clear')}</button>
    </div>
  );
}

