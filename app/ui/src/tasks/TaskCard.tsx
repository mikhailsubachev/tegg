// Slice 5A-1: the parts of the task card (tasks.md R43; D-482): the checkbox, the due chip (R44, FR-TSK-09) and the
// source chip (FR-TSK-08, D-486). Slice OC (v1-cards §6.2; D-1904, D-2054): the card itself is `cards/ObjectCard.tsx`
// with `cards/task.ts`'s rules; these parts stay (ObjectCard, TaskEmbed, the Daily Note's rows).
import { RefElement } from '../preview/useReference';
import type { PreviewTarget } from '../preview/types';
import { t } from '../i18n/catalog';
import type { TaskRowDto } from '../ipc/types';
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

export function Checkbox({ row, onToggle, tabIndex = 0 }: { row: TaskRowDto; onToggle: (done: boolean) => void; tabIndex?: number }) {
  const done = isDone(row);
  const name = done ? t('task.uncomplete', { title: row.title }) : t('task.complete', { title: row.title });
  return (
    <button
      type="button"
      role="checkbox"
      tabIndex={tabIndex}
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

export function SourceChip({ row, nav, tabIndex = 0, footer }: { row: TaskRowDto; nav: TaskNav; tabIndex?: number; /** Slice OC: the card's footer link (D-1904). */ footer?: boolean }) {
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
  // Slice P (FR-TSK-08 AC-4…AC-6, D-939): a click previews the source scrolled to the task's embed; a double-click and
  // ⌘↩ open it there (D-486); a date source previews the Daily Note; an unresolved one offers Create.
  const target: PreviewTarget | null = s.kind === 'date-missing' ? { path: '', fragment: null, kind: 'day', key: s.target.trim() }
    : ok ? { path: s.path!.normalize('NFC'), fragment: null, kind: 'note', ...(s.kind === 'note' ? { scrollToEmbedOf: row.path.normalize('NFC') } : {}) } : null;
  return (
    <RefElement
      as="a"
      reference={{ target, kind: 'chip', open: () => open(document.activeElement as HTMLElement), createOffer: (el) => open(el) }}
      href="#"
      tabIndex={tabIndex}
      data-command="task.openSource"
      className={`chip link-chip kind-${kind} task-source`}
      data-link-kind={kind}
      data-attribute={footer ? 'source' : undefined}
      data-footer-link={footer ? '' : undefined}
      aria-description={ok ? t('task.source', { title: text }) : t('link.noNote', { target: text })}
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
      onDoubleClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
    >
      {icon && <Icon name={icon.glyph} dataIcon={icon.def} size={12} />}
      <span data-user-content>{text}</span>
    </RefElement>
  );
}
