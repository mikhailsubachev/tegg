// The table header cell shared by the type page's `All <plural>` table, a view tab's table and a query block's table
// (docs/contracts/v1-views.md §4.2 `tables/HeaderCell.tsx`; type-columns §4; R188; D-1244, D-1248, D-1784, D-1785,
// D-1798). It sorts on click / ⏎ / Space (⇧ adds a level where `levels` sorting is on), is dragged to reorder (a press
// that moved more than 4 px is a drag, never a sort), moves with ⌥←/⌥→ where `keys` is on (only `All <plural>`), and
// ends with its resize handle, a WAI-ARIA window splitter.
import { useRef, useState } from 'react';
import { t } from '../i18n/catalog';
import { WIDTH, clampWidth } from './widths';
import { isPhone } from '../phone/layout';
import type { AttributeDto } from '../ipc/types';
import { LucideIcon } from '../shell/Icon';

/** Slice OC (FR-TYP-01 AC-13, D-2070): `attr`, the attribute the header's Name comes from; its icon goes before the text. */
export type HeaderColumn = { key: string; label: string; userNamed: boolean; attr?: AttributeDto | null };
export type SortMarker = { arrow: '↑' | '↓'; n: number | null };

const SUP: Record<string, string> = { 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹' };
const sup = (n: number) => String(n).split('').map((d) => SUP[d] ?? d).join('');

type HeaderCellProps = Parameters<typeof HeaderCellImpl>[0];

/** Slice AND-2 (android-phone §9.5, RA11): on the phone a header cell is read-only: no sort on tap, no drag, no resize
 *  separator. The desktop is unchanged (AR-03 AC-14). */
export function HeaderCell(props: HeaderCellProps) {
  return isPhone() ? <HeaderCellImpl {...props} sortable={false} movable={false} resizable={false} /> : <HeaderCellImpl {...props} />;
}

function HeaderCellImpl({ col, first, width, sortable = true, ariaSort, marker, description, disabled, movable, keys = false, resizable = true,
  plain = false, scroller, titleWidth = 0, onSort, onMove, onDrop, onWidth, onCancelWidth }: {
  col: HeaderColumn;
  /** The Title column: sticky, its own minimum width, never dragged (D-1798). */
  first: boolean;
  width: number;
  sortable?: boolean;
  /** `aria-sort`; undefined leaves the attribute out (a view's levels after the first, D-1785). */
  ariaSort?: 'ascending' | 'descending' | 'none';
  /** The visible marker (`↑`, `↓`, with the level number when there are several, AP-1500, AP-1501). */
  marker?: SortMarker | null;
  description?: string;
  /** Write controls refused (a read-only view): sorting and dragging do nothing; the reason is the description. */
  disabled?: boolean;
  /** Reorder by pointer drag (and by ⌥←/⌥→ when `keys`). */
  movable: boolean;
  keys?: boolean;
  resizable?: boolean;
  /** A query block's header (slice Q): the implicit `columnheader` role and the name from its text. */
  plain?: boolean;
  scroller?: React.RefObject<HTMLElement | null>;
  titleWidth?: number;
  onSort: (shift: boolean) => void;
  onMove?: (delta: number) => void;
  onDrop?: (before: string | null) => void;
  onWidth?: (px: number | null, save: 'now' | 'later' | 'no') => void;
  onCancelWidth?: () => void;
}) {
  const press = useRef<{ x: number; moved: boolean; moves: number } | null>(null);
  const dragged = useRef(false);
  const resize = useRef<{ x: number; w: number; last: number } | null>(null);
  const resetByPress = useRef(false);
  const [reordering, setReordering] = useState(false);
  /** The column a header dropped at `x` goes before (null = at the end; never before Title). */
  const dropTarget = (th: HTMLElement, x: number): string | null => {
    const hs = [...(th.parentElement?.children ?? [])] as HTMLElement[];
    for (const h of hs.slice(1)) {
      const r = h.getBoundingClientRect();
      if (x < r.left + r.width / 2) return h.dataset.key ?? null;
    }
    return null;
  };
  /** A focused header is scrolled fully into view right of the sticky Title column (type-columns AC-29). */
  const reveal = (el: HTMLElement) => {
    const box = scroller?.current;
    if (!box || first) return;
    const r = el.getBoundingClientRect(), b = box.getBoundingClientRect();
    if (r.left < b.left + titleWidth) box.scrollLeft -= b.left + titleWidth - r.left;
    else if (r.right > b.left + box.clientWidth) box.scrollLeft += r.right - (b.left + box.clientWidth);
  };
  const min = first ? WIDTH.titleMin : WIDTH.min;
  const canDrag = movable && !first && !disabled;
  return (
    <th role={plain ? undefined : 'columnheader'} scope={plain ? 'col' : undefined} tabIndex={0} data-key={col.key} aria-label={plain ? undefined : col.label} aria-sort={ariaSort}
      aria-description={description} aria-disabled={disabled ? 'true' : undefined}
      className={[ariaSort && ariaSort !== 'none' ? 'sorted' : '', marker ? 'marked' : '', first ? 'col-title' : '', reordering ? 'reordering' : '', sortable ? 'sortable' : ''].filter(Boolean).join(' ') || undefined}
      onFocus={(e) => { if (e.target === e.currentTarget) reveal(e.currentTarget); }}
      onClick={(e) => { if (dragged.current) { dragged.current = false; return; } if (sortable && !disabled) onSort(e.shiftKey); }}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); if (sortable && !disabled) onSort(e.shiftKey); }
        else if (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
          e.preventDefault(); e.stopPropagation();
          if (keys && movable && !first && !disabled) onMove?.(e.key === 'ArrowLeft' ? -1 : 1);
        }
      }}
      // Inside a note's editor a press would start the block's native drag (which cancels the pointer): not for a header.
      onMouseDown={(e) => { if (canDrag && e.button === 0 && e.currentTarget.closest('[contenteditable]')) { e.preventDefault(); e.currentTarget.focus({ preventScroll: true }); } }}
      onPointerDown={(e) => { dragged.current = false; if (canDrag && e.button === 0) { press.current = { x: e.clientX, moved: false, moves: 0 }; e.currentTarget.setPointerCapture(e.pointerId); } }}
      onPointerMove={(e) => {
        const p = press.current;
        if (p) p.moves++;
        if (p && !p.moved && Math.abs(e.clientX - p.x) > 4) { p.moved = true; setReordering(true); }
      }}
      onPointerUp={(e) => {
        const p = press.current;
        press.current = null;
        setReordering(false);
        if (p?.moved) { dragged.current = true; onDrop?.(dropTarget(e.currentTarget, e.clientX)); }
        // A drag that came back to its place (the pointer kept moving while pressed) is a drop there: no sort, no write.
        else if (p && p.moves >= 3) dragged.current = true;
      }}
      onPointerCancel={() => { press.current = null; setReordering(false); }}>
      {col.attr?.resolvedIcon && <LucideIcon icon={col.attr.resolvedIcon} dataIcon={col.attr.icon ?? col.attr.resolvedIcon.name} size={13} className="th-icon" />}
      <span className="th-label" data-user-content={col.userNamed ? '' : undefined}>{col.label}</span>
      {marker && <span className="sort-marker" aria-hidden="true">{' '}{marker.arrow}{marker.n !== null && <sup>{sup(marker.n)}</sup>}</span>}
      {resizable && (
        <span role="separator" aria-orientation="vertical" aria-label={t('typePage.resize', { column: col.label })} tabIndex={0} className="col-resize"
          aria-valuenow={Math.round(width)} aria-valuemin={min} aria-valuemax={WIDTH.max}
          onFocus={(e) => reveal(e.currentTarget.parentElement as HTMLElement)}
          onClick={(e) => e.stopPropagation()}
          onDoubleClick={(e) => { e.stopPropagation(); if (resetByPress.current) { resetByPress.current = false; return; } onWidth?.(null, 'now'); }}
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            e.stopPropagation();
            e.preventDefault();
            // The second press of a double-click resets the width (D-1248); the click events after it may be held back
            // (the multi-click guard of D-1674 after a route change), the press never is.
            if (e.detail === 2) { resetByPress.current = true; onWidth?.(null, 'now'); return; }
            e.currentTarget.setPointerCapture(e.pointerId);
            resize.current = { x: e.clientX, w: width, last: width };
            const esc = (k: KeyboardEvent) => {
              if (k.key !== 'Escape' || !resize.current) return;
              k.preventDefault(); k.stopPropagation();
              resize.current = null;
              onCancelWidth?.();
            };
            window.addEventListener('keydown', esc, { capture: true });
            const end = () => { window.removeEventListener('keydown', esc, { capture: true }); window.removeEventListener('pointerup', end, true); };
            window.addEventListener('pointerup', end, true);
          }}
          onPointerMove={(e) => {
            const r = resize.current;
            if (!r) return;
            r.last = clampWidth(col.key, r.w + e.clientX - r.x);
            onWidth?.(r.last, 'no');
          }}
          onPointerUp={(e) => {
            e.stopPropagation();
            const r = resize.current;
            resize.current = null;
            if (r && r.last !== r.w) onWidth?.(r.last, 'now'); // a press without a move stores nothing
          }}
          onKeyDown={(e) => {
            const step = e.shiftKey ? 50 : 10;
            const next = e.key === 'ArrowRight' ? width + step : e.key === 'ArrowLeft' ? width - step : e.key === 'Home' ? min : e.key === 'End' ? WIDTH.max
              : e.key === 'Backspace' || e.key === 'Delete' ? null : undefined;
            if (next === undefined) return;
            e.preventDefault();
            e.stopPropagation();
            onWidth?.(next, 'later');
          }} />
      )}
    </th>
  );
}
