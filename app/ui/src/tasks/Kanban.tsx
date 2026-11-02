// Slice 5A-1: the Kanban (FR-TSK-05, R42; D-378, D-478, D-479): columns by status or by tag; a pointer drag onto
// another real column changes the status or moves the tag (Alt adds only); `No status` and `No tag` aren't targets.
// Each column has `New task in <column>`. The board scrolls sideways; cards keep their width. By status, each status
// column's heading has a handle that drags the column, or moves it with ⌥← / ⌥→ (D-1357, FR-TSK-05 AC-17, AC-18).
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Value } from '@tegg/doc';
import { t } from '../i18n/catalog';
import type { TaskRowDto } from '../ipc/types';
import { QuickAdd } from './QuickAddRow';
import type { KanbanColumn } from './views';

export type DragState = { row: TaskRowDto; from: string; over: string | null; alt: boolean } | null;
/** Where a dragged column goes: before or after the status column `target`. */
export type ColumnDrop = { target: string; side: 'before' | 'after' };

export function KanbanView({ columns, tagMode, today, region, priorities, renderCard, onDrop, onCreate, onColumnStart, onColumnDrop, onColumnKey }: {
  columns: KanbanColumn[];
  tagMode: boolean;
  today: string;
  region: string;
  priorities: string[];
  renderCard: (row: TaskRowDto, column: KanbanColumn, drag: Record<string, unknown>) => ReactNode;
  onDrop: (row: TaskRowDto, from: string, to: KanbanColumn, alt: boolean) => void;
  onCreate: (title: string, values: [string, Value][]) => Promise<boolean>;
  /** D-1357: a column drag started (the page reads the Task type's version now, so an outside change cancels it). */
  onColumnStart: (column: string) => void;
  onColumnDrop: (column: string, to: ColumnDrop) => void;
  onColumnKey: (column: string, dir: 1 | -1) => void;
}) {
  const [drag, setDrag] = useState<DragState>(null);
  const [adding, setAdding] = useState<string | null>(null);
  const dragRef = useRef<DragState>(null);
  dragRef.current = drag;
  const cols = useRef(columns);
  cols.current = columns;

  useEffect(() => () => { dragRef.current = null; }, []);
  const [colDrag, setColDrag] = useState<{ from: string; over: ColumnDrop | null } | null>(null);
  const movable = (id: string) => !tagMode && id !== 'no-status';

  const startColumnDrag = (from: string) => (e: React.MouseEvent<HTMLElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const x0 = e.clientX, y0 = e.clientY;
    let started = false;
    const dropAt = (x: number, y: number): ColumnDrop | null => {
      const sec = (document.elementFromPoint(x, y) as HTMLElement | null)?.closest<HTMLElement>('[data-column]');
      const id = sec?.getAttribute('data-column');
      if (!sec || !id || !movable(id)) return null;
      const r = sec.getBoundingClientRect();
      return { target: id, side: x < r.left + r.width / 2 ? 'before' : 'after' };
    };
    const move = (m: MouseEvent) => {
      if (!started && Math.abs(m.clientX - x0) + Math.abs(m.clientY - y0) < 5) return;
      m.preventDefault();
      if (!started) onColumnStart(from);
      started = true;
      setColDrag({ from, over: dropAt(m.clientX, m.clientY) });
    };
    const up = (u: MouseEvent) => {
      window.removeEventListener('mousemove', move, true);
      window.removeEventListener('mouseup', up, true);
      setColDrag(null);
      if (!started) return;
      const to = dropAt(u.clientX, u.clientY);
      if (to) onColumnDrop(from, to);
    };
    window.addEventListener('mousemove', move, true);
    window.addEventListener('mouseup', up, true);
  };

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
        const colOver = colDrag?.over?.target === c.id && colDrag.from !== c.id ? colDrag.over.side : null;
        const label = c.label;
        return (
          <section key={c.id} className={`task-column${over ? ' drop-over' : ''}${colOver ? ` column-drop-${colOver}` : ''}${colDrag?.from === c.id ? ' column-dragging' : ''}`} data-column={c.id} role="region" aria-label={label}>
            <header className="task-column-head">
              {movable(c.id) && (
                <span role="button" tabIndex={0} draggable className="column-handle" data-command="tasks.columnDrag" data-column-handle={c.id} aria-label={t('tasks.column.drag')} aria-describedby={`col-name-${cssId(c.id)}`}
                  title={t('tasks.column.drag')} onMouseDown={startColumnDrag(c.id)} onDragStart={(ev) => ev.preventDefault()}
                  onKeyDown={(ev) => {
                    if (!ev.altKey || (ev.key !== 'ArrowLeft' && ev.key !== 'ArrowRight')) return;
                    ev.preventDefault();
                    onColumnKey(c.id, ev.key === 'ArrowRight' ? 1 : -1);
                  }}>⋮⋮</span>
              )}
              <h2>
                {c.color !== null || c.state !== null ? <span className="dot" data-color={c.color ?? ''} style={c.color ? { background: `var(--type-${c.color})` } : undefined} /> : null}
                <span id={`col-name-${cssId(c.id)}`} data-user-content={c.id !== 'no-status' && c.id !== 'no-tag' ? '' : undefined}>{label}</span> <span className="count">{c.tasks.length}</span>
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

/** An `id` attribute for a column name (labels may hold spaces and diacritics). */
function cssId(id: string): string {
  return Array.from(id.normalize('NFC')).map((ch) => (/[A-Za-z0-9_-]/.test(ch) ? ch : `_${ch.codePointAt(0)!.toString(16)}`)).join('');
}
