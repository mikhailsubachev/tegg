// Slice 5A-1: the universal task card (tasks.md R43, CardAnatomy; D-482) and its chips: checkbox, title, More, tags,
// body start, status, due (R44, FR-TSK-09), priority, source (FR-TSK-08, D-486), and "also in" on the Kanban by tag.
import type { ReactNode } from 'react';
import { t } from '../i18n/catalog';
import type { TaskDefsDto, TaskRowDto } from '../ipc/types';
import { chipIcon } from '../links/icons';
import { requestOffer } from '../links/offer';
import { Icon } from '../shell/Icon';
import { dueLabel, shortDate } from './views';

export type TaskNav = {
  openNote: (path: string) => void;
  /** D-486: the source note with the task's first embed selected at the top. */
  openSource: (sourcePath: string, taskPath: string) => void;
  openDay: (date: string) => void;
};

export const isDone = (r: TaskRowDto) => r.state === 'done';

export function Checkbox({ row, onToggle }: { row: TaskRowDto; onToggle: (done: boolean) => void }) {
  const done = isDone(row);
  const name = done ? t('task.uncomplete', { title: row.title }) : t('task.complete', { title: row.title });
  return (
    <button
      type="button"
      role="checkbox"
      tabIndex={0}
      data-command="task.complete"
      className={`task-check${done ? ' checked' : ''}`}
      aria-checked={done}
      aria-label={name}
      aria-disabled={row.readOnly || undefined}
      aria-description={row.readOnly ? t('task.readOnly') : undefined}
      onClick={(e) => { e.stopPropagation(); if (!row.readOnly) onToggle(!done); }}
      onKeyDown={(e) => { if (e.key === ' ' || e.key === 'Enter') e.stopPropagation(); }}
    >
      {done && <Icon name="check" size={12} />}
    </button>
  );
}

export function DueChip({ row, today, region, zone }: { row: TaskRowDto; today: string; region: string; zone?: string }) {
  const d = dueLabel(row, today, region, zone);
  if (!d.text) return null;
  const overdue = d.tone === 'overdue';
  return (
    <span className={`task-chip due tone-${d.tone}`} data-due={row.dueRaw ?? ''} data-tone={d.tone} aria-label={overdue ? `${d.text}, ${t('task.overdueWord')}` : undefined}>
      {/* A date alone is the region's format (Intl), not catalog text (NFR-OTH-02). */}
      {d.tone === 'plain' && row.due && d.text === shortDate(row.due, region) ? <span data-user-content>{d.text}</span> : d.text}
    </span>
  );
}

export function SourceChip({ row, nav }: { row: TaskRowDto; nav: TaskNav }) {
  const s = row.source;
  if (!s) return null;
  const ok = (s.kind === 'note' || s.kind === 'daily') && !!s.path;
  const kind = ok ? s.kind : 'unresolved';
  const text = s.kind === 'daily' ? s.target : ok ? (s.title ?? s.target) : s.target.split(/[|#]/)[0];
  const icon = ok ? chipIcon(s.kind === 'daily' ? 'daily-note' : s.type) : null;
  const open = (el: HTMLElement) => {
    if (s.kind === 'daily') nav.openDay(s.target.split(/[|#]/)[0].trim());
    else if (ok) nav.openSource(s.path!, row.path);
    else if (s.kind === 'date-missing') nav.openDay(s.target);
    else requestOffer({ from: row.path, target: s.target, relationTo: null, anchor: el });
  };
  return (
    <a
      href="#"
      tabIndex={0}
      data-command="task.openSource"
      className={`chip link-chip kind-${kind} task-source`}
      data-link-kind={kind}
      aria-description={ok ? t('task.source', { title: text }) : t('link.noNote', { target: text })}
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); open(e.currentTarget); }}
      onDoubleClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); open(e.currentTarget); } }}
    >
      {icon && <Icon name={icon.glyph} dataIcon={icon.def} size={12} />}
      <span data-user-content>{text}</span>
    </a>
  );
}

function optionColor(defs: TaskDefsDto, kind: 'status' | 'priority', label: string | null): string | null {
  const list = kind === 'status' ? defs.statuses : defs.priorities;
  return list.find((o) => o.label === label)?.color ?? null;
}

export type CardProps = {
  row: TaskRowDto;
  defs: TaskDefsDto;
  today: string;
  region: string;
  zone?: string;
  nav: TaskNav;
  alsoIn?: string[];
  onToggle: (row: TaskRowDto, done: boolean) => void;
  onMenu: (row: TaskRowDto, anchor: HTMLElement, opener: HTMLElement | null) => void;
  onKey?: (e: React.KeyboardEvent<HTMLElement>, row: TaskRowDto) => void;
  dragProps?: Record<string, unknown>;
  /** The Kanban by status (D-589). */
  hideStatus?: boolean;
  children?: ReactNode;
};

export function TaskCard({ row, defs, today, region, zone, nav, alsoIn, hideStatus, onToggle, onMenu, onKey, dragProps }: CardProps) {
  const done = isDone(row);
  const firstStatus = defs.statuses[0]?.label ?? null;
  // D-589: the Kanban by status names the status in its column; a value that isn't a status still shows (`No status`).
  const showStatus = row.status !== null && (hideStatus ? !row.statusKnown : row.status !== firstStatus || !row.statusKnown);
  const lastPriority = defs.priorities[defs.priorities.length - 1]?.label ?? null;
  const showPriority = !done && row.priority !== null && row.priorityRank < defs.priorities.length && row.priority !== lastPriority;
  const statusColor = optionColor(defs, 'status', row.status);
  const priorityColor = optionColor(defs, 'priority', row.priority);
  const overdue = row.state !== 'done' && row.state !== 'cancelled' && row.due !== null && row.due < today;
  const tags = row.fmTags.length ? row.fmTags : row.tags;
  const shownTags = [...new Set([...tags.map((x) => x.normalize('NFC').replace(/^#/, '')), ...row.tags.filter((k) => !tags.some((x) => x.normalize('NFC').toLowerCase() === k))])];
  return (
    <article
      className={`task-card${done ? ' done' : ''}`}
      aria-label={t('task.card', { title: row.title })}
      data-path={row.path.normalize('NFC')}
      data-state={row.state}
      data-overdue={overdue ? 'true' : 'false'}
      tabIndex={0}
      onKeyDown={(e) => onKey?.(e, row)}
      {...dragProps}
    >
      <div className="task-card-head">
        <Checkbox row={row} onToggle={(d) => onToggle(row, d)} />
        <a href="#" tabIndex={0} draggable={false} data-command="task.open" className="task-title" onClick={(e) => { e.preventDefault(); e.stopPropagation(); nav.openNote(row.path); }}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); nav.openNote(row.path); } }}>
          <span data-user-content>{row.title}</span>
        </a>
        <button type="button" tabIndex={0} data-command="task.setStatus" className="task-more icon-button" aria-label={t('task.more', { title: row.title })} aria-haspopup="menu"
          onClick={(e) => { e.stopPropagation(); onMenu(row, e.currentTarget, e.currentTarget.closest('article')); }}>
          <Icon name="more-horizontal" size={14} />
        </button>
      </div>
      {shownTags.length > 0 && (
        <div className="task-tags">
          {shownTags.slice(0, 3).map((x) => <span key={x} className="task-chip tag" data-user-content>#{x}</span>)}
          {shownTags.length > 3 && <span className="task-chip tag">+{shownTags.length - 3}</span>}
        </div>
      )}
      {!done && row.excerpt && <p className="task-body" data-user-content>{row.excerpt}</p>}
      <div className="task-chips">
        {showStatus && (
          <span className="task-chip status" data-status={row.status ?? ''} aria-description={row.statusKnown ? undefined : t('task.notStatus')}>
            <span className="dot" data-color={statusColor ?? ''} style={statusColor ? { background: `var(--type-${statusColor})` } : undefined} />
            <span data-user-content>{row.status}</span>
          </span>
        )}
        <DueChip row={row} today={today} region={region} zone={zone} />
        {showPriority && (
          <span className="task-chip priority" data-priority={row.priority ?? ''}>
            <span data-flag style={priorityColor ? { color: `var(--type-${priorityColor})` } : undefined}><Icon name="flag" size={12} /></span>
            <span data-user-content>{row.priority}</span>
          </span>
        )}
        <SourceChip row={row} nav={nav} />
      </div>
      {alsoIn && alsoIn.length > 0 && <p className="task-also">{t('task.alsoIn', { tags: alsoIn.map((x) => `#${x}`).join(', ') })}</p>}
    </article>
  );
}
