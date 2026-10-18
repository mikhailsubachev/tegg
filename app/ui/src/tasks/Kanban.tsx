// Slice 5A-1: the Kanban (FR-TSK-05, R42; D-378, D-478, D-479): columns by status or by tag; a pointer drag onto
// another real column changes the status or moves the tag (Alt adds only); `No status` and `No tag` aren't targets.
// Each column has `New task in <column>`. The board scrolls sideways; cards keep their width.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Value } from '@tegg/doc';
import { t } from '../i18n/catalog';
import type { TaskRowDto } from '../ipc/types';
import { QuickAdd } from './QuickAddRow';
import type { KanbanColumn } from './views';

export type DragState = { row: TaskRowDto; from: string; over: string | null; alt: boolean } | null;

export function KanbanView({ columns, tagMode, today, region, priorities, renderCard, onDrop, onCreate }: {
  columns: KanbanColumn[];
  tagMode: boolean;
  today: string;
  region: string;
  priorities: string[];
  renderCard: (row: TaskRowDto, column: KanbanColumn, drag: Record<string, unknown>) => ReactNode;
  onDrop: (row: TaskRowDto, from: string, to: KanbanColumn, alt: boolean) => void;
  onCreate: (title: string, values: [string, Value][]) => Promise<boolean>;
}) {
  const [drag, setDrag] = useState<DragState>(null);
  const [adding, setAdding] = useState<string | null>(null);
  const dragRef = useRef<DragState>(null);
  dragRef.current = drag;
  const cols = useRef(columns);
  cols.current = columns;

  useEffect(() => () => { dragRef.current = null; }, []);

  const startDrag = (row: TaskRowDto, from: string) => (e: React.MouseEvent<HTMLElement>) => {
    if (e.button !== 0 || row.readOnly) return;
    const el = e.target as HTMLElement;
    if (el.closest('button, input, [role="checkbox"]')) return;
    e.preventDefault(); // no native link drag or text selection (it would swallow the moves)
    const x0 = e.clientX, y0 = e.clientY;
    let started = false;
    const columnAt = (x: number, y: number) => (document.elementFromPoint(x, y) as HTMLElement | null)?.closest<HTMLElement>('[data-column]')?.getAttribute('data-column') ?? null;
    const move = (m: MouseEvent) => {
      if (!started && Math.abs(m.clientX - x0) + Math.abs(m.clientY - y0) < 5) return;
      m.preventDefault();
      started = true;
      setDrag({ row, from, over: columnAt(m.clientX, m.clientY), alt: m.altKey });
    };
    const up = (u: MouseEvent) => {
      window.removeEventListener('mousemove', move, true);
      window.removeEventListener('mouseup', up, true);
      if (!started) return;
      const swallow = (c: MouseEvent) => { c.stopPropagation(); c.preventDefault(); window.removeEventListener('click', swallow, true); };
      window.addEventListener('click', swallow, true);
      setTimeout(() => window.removeEventListener('click', swallow, true), 0);
      const over = columnAt(u.clientX, u.clientY);
      setDrag(null);
      const to = cols.current.find((c) => c.id === over);
      if (to && to.dropTarget && to.id !== from) onDrop(row, from, to, u.altKey);
    };
    window.addEventListener('mousemove', move, true);
    window.addEventListener('mouseup', up, true);
  };

  return (
    <div className={`task-board${drag ? ' dragging' : ''}`} role="presentation">
      {columns.map((c) => {
        const over = drag && drag.over === c.id && c.dropTarget && c.id !== drag.from;
        const label = c.label;
        return (
          <section key={c.id} className={`task-column${over ? ' drop-over' : ''}`} data-column={c.id} role="region" aria-label={label}>
            <header className="task-column-head">
              <h2>
                {c.color !== null || c.state !== null ? <span className="dot" data-color={c.color ?? ''} style={c.color ? { background: `var(--type-${c.color})` } : undefined} /> : null}
                <span data-user-content={c.id !== 'no-status' && c.id !== 'no-tag' ? '' : undefined}>{label}</span> <span className="count">{c.tasks.length}</span>
              </h2>
              {c.dropTarget && (
                <button type="button" className="icon-button" data-command="tasks.add" aria-label={t('tasks.column.add', { column: label })} onClick={() => setAdding(c.id)}>+</button>
              )}
            </header>
            {over && <p className="drop-label">{tagMode ? t('tasks.drop.tag', { tag: label.replace(/^#/, '') }) : t('tasks.drop.status', { label })}</p>}
            {adding === c.id && (
              <QuickAdd inline autoFocus today={today} region={region} priorities={priorities} label={t('tasks.column.add', { column: label })}
                presets={tagMode ? { due: null, tag: label.replace(/^#/, '') } : { due: null, status: c.id }}
                onClose={() => setAdding(null)} onCreate={async (title, values) => { const ok = await onCreate(title, values); if (ok) setAdding(null); return ok; }} />
            )}
            <div className="task-list">
              {c.tasks.length === 0 && <p className="empty">{t('tasks.column.empty')}</p>}
              {c.tasks.map((r) => renderCard(r, c, { onMouseDown: startDrag(r, c.id), onDragStart: (ev: React.DragEvent) => ev.preventDefault(), draggable: false }))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
