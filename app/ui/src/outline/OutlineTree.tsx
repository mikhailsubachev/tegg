// Slice OL (docs/contracts/v1-outline.md §3.1, §3.7, §3.8; outline.md R170, R174; D-1675): the `tree` of the rail's
// card. Rows are keyed by their heading key, so a relabel replaces one row and the others keep their DOM nodes
// (FR-EDT-11 AC-7). Roving focus, the WAI-ARIA tree keys, chevrons, the current bar and hover.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { OutlineNode } from '@tegg/doc';
import { t } from '../i18n/catalog';
import { INDENT } from './model';

export type FoldOp = 'toggle' | 'branch' | 'expand' | 'collapse';

export function OutlineTree({ tree, rows, current, ancestors, chevrons, tempOpen, hoverRow, onHoverRow, onJump, onFold, onEscape, onLeave, focusReq }: {
  tree: readonly OutlineNode[];
  /** The rows drawn, in note order. */
  rows: readonly number[];
  /** The row with `aria-current` and the bar. */
  current: number | null;
  /** Card: the current section's ancestors (weight 600, V8). */
  ancestors?: ReadonlySet<number>;
  /** Rows that show a chevron. */
  chevrons: ReadonlySet<number>;
  /** Card: rows opened in this card (D-1616). */
  tempOpen?: ReadonlySet<number>;
  hoverRow?: number | null;
  onHoverRow?: (i: number | null) => void;
  onJump: (i: number) => void;
  onFold: (i: number, op: FoldOp) => void;
  /** Esc (R174): the focus back to the body. */
  onEscape: () => void;
  /** Card: Tab or ⌘J close it (R174). */
  onLeave?: () => void;
  /** A request to focus a row (the current one, else the first): its counter changes per request. */
  focusReq?: { n: number; index: number | null } | null;
}) {
  const els = useRef(new Map<number, HTMLDivElement>());
  const [focusIdx, setFocusIdx] = useState<number | null>(null);
  const [tip, setTip] = useState<number | null>(null);
  const byKey = useRef(false);
  const shown = new Set(rows);
  const roving = focusIdx !== null && shown.has(focusIdx) ? focusIdx : current !== null && shown.has(current) ? current : rows[0] ?? null;

  const focusRow = (i: number | undefined | null, key = true) => {
    if (i === null || i === undefined) return;
    byKey.current = key;
    setFocusIdx(i);
    els.current.get(i)?.focus({ preventScroll: false });
  };
  useLayoutEffect(() => {
    if (!focusReq) return;
    const i = focusReq.index !== null && shown.has(focusReq.index) ? focusReq.index : rows[0];
    focusRow(i, true);
  }, [focusReq?.n]); // eslint-disable-line react-hooks/exhaustive-deps
  // A row that went away (collapsed, refreshed) takes the focus with it: keep it on a row that is there.
  useEffect(() => {
    if (focusIdx === null || shown.has(focusIdx)) return;
    const a = document.activeElement;
    if (a && a.closest?.('[role="tree"]') === null) return;
    let p: number | null = tree[focusIdx]?.parent ?? null;
    while (p !== null && !shown.has(p)) p = tree[p]?.parent ?? null;
    setFocusIdx(p ?? rows[0] ?? null);
  });

  const kidsShown = (i: number) => !!tree[i] && tree[i].children.length > 0 && tree[i].children.every((c) => shown.has(c));
  const isCollapsed = (i: number) => !kidsShown(i);

  const onKey = (e: React.KeyboardEvent, i: number) => {
    const at = rows.indexOf(i);
    const stop = () => { e.preventDefault(); e.stopPropagation(); };
    const parentShown = () => { const p = tree[i]?.parent ?? null; return p !== null && shown.has(p) ? p : null; };
    if (e.key === 'ArrowDown' && !e.metaKey) { stop(); focusRow(rows[Math.min(rows.length - 1, at + 1)]); return; }
    if (e.key === 'ArrowUp' && !e.metaKey) { stop(); focusRow(rows[Math.max(0, at - 1)]); return; }
    if (e.key === 'Home') { stop(); focusRow(rows[0]); return; }
    if (e.key === 'End') { stop(); focusRow(rows[rows.length - 1]); return; }
    if (e.key === 'Enter') { stop(); onJump(i); return; }
    if (e.key === 'Escape') { stop(); onEscape(); return; }
    if ((e.key === 'Tab' || (e.key.toLowerCase() === 'j' && e.metaKey))) { stop(); onLeave?.(); return; }
    if (e.key === 'ArrowRight') {
      stop();
      if (chevrons.has(i) && !kidsShown(i)) { onFold(i, 'expand'); return; }
      if (kidsShown(i)) focusRow(tree[i].children[0]);
      return;
    }
    if (e.key === 'ArrowLeft') {
      stop();
      if (tempOpen?.has(i)) { onFold(i, 'collapse'); return; }
      const p = parentShown();
      if (p !== null) focusRow(p);
    }
  };

  // Siblings among the tree (aria-setsize / aria-posinset, FR-UX-08 AC-21).
  const siblingsOf = (n: OutlineNode) => (n.parent === null ? tree.filter((x) => x.parent === null).map((x) => x.index) : tree[n.parent].children);

  return (
    <div role="tree" aria-label={t('outline.tree')} className="outline-tree outline-tree-card">
      {rows.map((i) => {
        const n = tree[i];
        if (!n) return null;
        const kids = n.children.length > 0;
        const coll = kids && isCollapsed(i);
        const sib = siblingsOf(n);
        const chev = chevrons.has(i);
        return (
          <div
            key={n.key}
            ref={(el) => { if (el) els.current.set(i, el); else els.current.delete(i); }}
            role="treeitem"
            data-outline-row={i}
            aria-label={n.text.normalize('NFC')}
            aria-level={n.depth}
            aria-setsize={sib.length}
            aria-posinset={sib.indexOf(i) + 1}
            aria-expanded={kids ? !coll : undefined}
            aria-current={current === i ? 'location' : undefined}
            tabIndex={roving === i ? 0 : -1}
            data-level={n.level}
            data-top={n.depth === 1 && n.level === 1 ? '' : undefined}
            data-ancestor={ancestors?.has(i) ? '' : undefined}
            data-hover={hoverRow === i ? '' : undefined}
            title={n.text}
            className="outline-row"
            style={{ paddingLeft: INDENT * (n.depth - 1) }}
            onMouseDown={(e) => e.preventDefault()}
            onMouseEnter={() => onHoverRow?.(i)}
            onMouseLeave={() => onHoverRow?.(null)}
            onClick={(e) => {
              if ((e.target as HTMLElement).closest('[data-outline-chevron]')) { if (chev) onFold(i, e.altKey ? 'branch' : 'toggle'); return; }
              onJump(i);
            }}
            onKeyDown={(e) => onKey(e, i)}
            onFocus={(e) => {
              setFocusIdx(i);
              const txt = e.currentTarget.querySelector<HTMLElement>('.outline-text');
              const keyboard = byKey.current || e.currentTarget.matches(':focus-visible');
              byKey.current = false;
              setTip(keyboard && !!txt && txt.scrollWidth > txt.clientWidth ? i : null);
            }}
            onBlur={() => setTip((x) => (x === i ? null : x))}
          >
            <span className="outline-chevron-slot">
              {chev && (
                <span className="outline-chevron" aria-hidden="true" data-outline-chevron="" data-open={coll ? undefined : ''}
                  title={t(coll ? 'outline.expand' : 'outline.collapse')}>
                  <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M3.5 2l3 3-3 3" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
                </span>
              )}
            </span>
            <span className="outline-text" data-user-content>{n.text}</span>
            {tip === i && <span role="tooltip" className="outline-tip" data-user-content>{n.text}</span>}
          </div>
        );
      })}
    </div>
  );
}
