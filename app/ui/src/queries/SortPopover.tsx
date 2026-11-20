// Slice Q2: the `Sort` popover (docs/contracts/v1-views.md §4.2, §4.3, §4.4; R188; D-1766, D-1768, D-1786; board A):
// one row per level (`Sort by` / `then by`), each with a grip `Drag to change the order`, a column combobox (a key used at
// another level isn't offered), an order combobox with the kind's labels and `Remove`; then `+ Add sort` and `Clear`.
// Each change is one write (`onChange`, the caller's one `query_apply`); Esc closes and writes nothing more. Not modal.
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { t } from '../i18n/catalog';
import type { SortDto } from '../ipc/queries';
import type { TypeDto } from '../ipc/types';
import { Icon } from '../shell/Icon';
import { usePopupPlacement } from '../shell/usePopupPlacement';
import { Chooser } from './Listbox';
import { addLevel, clearSort, levels, moveLevel, orderLabels, removeLevel, sameSort, sortChoices } from './sort';

const nfc = (s: string) => s.normalize('NFC');

/** A sort key's column name (Title, Created, Modified, an attribute's Name). */
export function sortKeyName(key: string, type: TypeDto | null | undefined): { label: string; user: boolean } {
  const k = nfc(key);
  if (k === 'title') return { label: t('typePage.title'), user: false };
  if (k === 'created') return { label: t('attr.created'), user: false };
  if (k === 'modified') return { label: t('typePage.modified'), user: false };
  const a = type?.attributes.find((x) => nfc(x.key) === k);
  if (a) return { label: a.name, user: true };
  if (k === 'tags') return { label: t('attr.tags'), user: false };
  return { label: k, user: true };
}

export function SortPopover({ sort, type, anchor, addOnOpen, disabled, onChange, onClose, scope, onUseQuery }: {
  /** The levels as written (the file's `sort`). */
  sort: SortDto[];
  /** The query's one type (column choices and order labels). */
  type: TypeDto | null | undefined;
  anchor: HTMLElement | null;
  /** `Add sort level` (R191): open with a new level appended and its column combobox focused. */
  addOnOpen?: boolean;
  disabled?: string | null;
  onChange: (sort: SortDto[]) => void;
  onClose: () => void;
  /** Slice Q2.1 (R197, §16.2): what a change writes, the popover's first line. */
  scope?: 'tab' | 'block' | 'default';
  /** Slice Q2.1 (R197, D-1856): `Use the query's sort`, when offered. */
  onUseQuery?: (() => void) | null;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [ls, setLs] = useState<SortDto[]>(() => levels(sort));
  const key = JSON.stringify(levels(sort));
  useEffect(() => { setLs(levels(sort)); }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  // Slice Q2.1 (§20): placed inside the window, below its button (above when there is no room).
  const style = usePopupPlacement(ref, anchor, 'menu', 6);
  const [drag, setDrag] = useState<{ from: number; over: number | null } | null>(null);
  const choices = sortChoices(type);
  const change = (next: SortDto[]) => {
    if (disabled || sameSort(next, ls)) return;
    setLs(next);
    onChange(next);
  };
  const focusLevel = (i: number) => requestAnimationFrame(() => ref.current?.querySelector<HTMLElement>(`[data-sort-level="${i}"] [role="combobox"]`)?.focus());
  useEffect(() => {
    if (addOnOpen && !disabled) {
      const next = addLevel(ls, choices);
      if (!sameSort(next, ls)) { change(next); focusLevel(next.length - 1); return; }
    }
    (ref.current?.querySelector<HTMLElement>('[data-sort-level] [role="combobox"], button') ?? ref.current)?.focus({ preventScroll: true });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const outside = (e: MouseEvent) => {
      const tg = e.target as HTMLElement;
      if (ref.current?.contains(tg) || anchor?.contains(tg) || tg.closest?.('[role="listbox"]')) return;
      onClose();
    };
    // Esc closes it also when the focus left it (a row redrawn under the focus): nothing more is written.
    const esc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      const a = document.activeElement;
      if (a && a !== document.body && !ref.current?.contains(a) && a !== anchor) return;
      e.preventDefault();
      onClose();
    };
    document.addEventListener('mousedown', outside, true);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', outside, true); document.removeEventListener('keydown', esc); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const name = (k: string) => sortKeyName(k, type);
  const startDrag = (from: number) => (e: React.MouseEvent<HTMLElement>) => {
    if (e.button !== 0 || disabled) return;
    e.preventDefault();
    const x0 = e.clientX, y0 = e.clientY;
    let started = false;
    const at = (x: number, y: number) => {
      const g = (document.elementFromPoint(x, y) as HTMLElement | null)?.closest<HTMLElement>('[data-sort-level]');
      return g && ref.current?.contains(g) ? Number(g.getAttribute('data-sort-level')) : null;
    };
    const move = (m: MouseEvent) => {
      if (!started && Math.abs(m.clientX - x0) + Math.abs(m.clientY - y0) <= 4) return;
      started = true;
      setDrag({ from, over: at(m.clientX, m.clientY) });
    };
    const up = (u: MouseEvent) => {
      window.removeEventListener('mousemove', move, true);
      window.removeEventListener('mouseup', up, true);
      setDrag(null);
      if (!started) return;
      const to = at(u.clientX, u.clientY);
      if (to !== null && to !== from) change(moveLevel(ls, from, to));
    };
    window.addEventListener('mousemove', move, true);
    window.addEventListener('mouseup', up, true);
  };

  // In the body, not inside the block: a note's editor would take the focus (and the clicks) of a popover in its content.
  return createPortal(
    <div ref={ref} role="dialog" aria-label={t('sort.dialog')} className="sort-popover popover" style={style} tabIndex={-1} data-popup="sort"
      aria-describedby={scope ? 'sort-scope-line' : undefined}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && !e.defaultPrevented) { e.preventDefault(); e.stopPropagation(); onClose(); }
      }}>
      {scope && <p id="sort-scope-line" className="sort-scope" data-scope={scope}>{t(`sort.scope.${scope}`)}</p>}
      {ls.map((l, i) => {
        const nm = name(l.by);
        const labels = orderLabels(l.by, type);
        const used = new Set(ls.filter((_, j) => j !== i).map((x) => nfc(x.by)));
        const opts = choices.filter((c) => !used.has(c)).map((c) => ({ id: c, label: name(c).label, userNamed: name(c).user }));
        const lead = t(i === 0 ? 'sort.by' : 'sort.then');
        return (
          <div key={i} role="group" data-sort-level={i} aria-label={`${lead} ${nm.label}, ${l.order === 'asc' ? labels.asc : labels.desc}`}
            className={`sort-level${drag?.from === i ? ' dragging' : ''}${drag && drag.over === i && drag.from !== i ? ' drop-over' : ''}`}>
            <span role="button" tabIndex={0} className="sort-grip" aria-label={t('sort.drag')} title={t('sort.drag')} onMouseDown={startDrag(i)}
              onKeyDown={(e) => {
                if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
                e.preventDefault();
                const to = i + (e.key === 'ArrowDown' ? 1 : -1);
                if (to >= 0 && to < ls.length) change(moveLevel(ls, i, to));
              }}>
              <Icon name="grip" size={13} />
            </span>
            <span className="sort-lead">{lead}</span>
            <Chooser label={lead} display={<span data-user-content={nm.user ? '' : undefined}>{nm.label}</span>} options={opts} current={nfc(l.by)} disabled={!!disabled}
              onPick={(by) => change(ls.map((x, j) => (j === i ? { by, order: x.order } : x)))} className="sort-column" />
            <Chooser label={t('sort.orderLabel')} display={l.order === 'asc' ? labels.asc : labels.desc} disabled={!!disabled}
              options={[{ id: 'asc', label: labels.asc }, { id: 'desc', label: labels.desc }]} current={l.order}
              onPick={(o) => change(ls.map((x, j) => (j === i ? { by: x.by, order: o as 'asc' | 'desc' } : x)))} className="sort-order" />
            <button type="button" tabIndex={0} className="icon-button small sort-remove" aria-label={t('sort.remove')} title={t('sort.remove')}
              aria-disabled={disabled ? 'true' : undefined} onClick={() => change(removeLevel(ls, i))}>
              <Icon name="x" size={12} />
            </button>
          </div>
        );
      })}
      <div className="sort-actions">
        <button type="button" tabIndex={0} className="qe-add" aria-disabled={disabled ? 'true' : undefined}
          onClick={() => { const next = addLevel(ls, choices); change(next); focusLevel(next.length - 1); }}>{t('sort.add')}</button>
        <button type="button" tabIndex={0} className="qe-add" aria-disabled={disabled ? 'true' : undefined} onClick={() => change(clearSort())}>{t('sort.clear')}</button>
        {onUseQuery && (
          <button type="button" tabIndex={0} className="qe-add" data-command="sort.useQuery" aria-disabled={disabled ? 'true' : undefined}
            onClick={() => { if (!disabled) onUseQuery(); }}>{t('sort.useQuery')}</button>
        )}
      </div>
    </div>,
    document.body,
  );
}
