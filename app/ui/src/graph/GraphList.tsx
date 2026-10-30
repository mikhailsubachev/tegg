// Slice G3 (docs/contracts/v1-graph.md §16.3; R122; AP-938…AP-940): the List view, a `tree` `Local graph as a list`
// in the canvas's place: the same drawn nodes as the canvas, each under its first neighbour one step closer
// (`graphModel.listTree`), fully expanded at first, collapsible in memory only. One tab stop (roving, the centre row
// first); the WAI-ARIA tree keys move between visible rows; every other key, a click and hover go to the page, which
// handles them as on nodes (R120, AP-939). Rows show no hover ring. Slice "G3 in the panel" (v1-graph §17.1, AP-967 =
// D-1137): the `panel` variant indents 12 px per level, cuts the title with `…` and wraps the phrase and the count under
// it, and scrolls inside its own box.
import { useMemo, useState } from 'react';
import { t } from '../i18n/catalog';
import { chipIcon, typeNameOf } from '../links/icons';
import { Icon } from '../shell/Icon';
import { connectionPhrase, displayTitle, listTree, nodeDescription, type GraphModel, type ModelNode, type NodeKey, type RelationNames } from './graphModel';
import type { GraphResultDto } from './types';

export type GraphListProps = {
  result: GraphResultDto;
  model: GraphModel;
  types: RelationNames;
  selected: NodeKey | null;
  /** The row with the tab stop (null: the centre). */
  focusKey: NodeKey | null;
  onFocusKey: (k: NodeKey | null) => void;
  onClick: (n: ModelNode, el: HTMLElement, e: React.MouseEvent) => void;
  onDoubleClick: (n: ModelNode) => void;
  /** A key the tree doesn't take itself (⏎, ⌥Space, `C`, Esc, …). */
  onKey: (e: React.KeyboardEvent, n: ModelNode, el: HTMLElement) => void;
  onPointer: (n: ModelNode, over: boolean) => void;
  /** The tree keys moved the focus. */
  onMove: () => void;
  /** `panel`: the right panel's row layout and scroll container (AP-967). */
  variant?: 'full' | 'panel';
};

export function GraphList(p: GraphListProps) {
  const panel = p.variant === 'panel';
  const rows = useMemo(() => listTree(p.result), [p.result]);
  const byKey = useMemo(() => new Map(p.model.nodes.map((n) => [n.key, n])), [p.model]);
  const [collapsed, setCollapsed] = useState<Set<NodeKey>>(new Set());
  const centre = rows[0]?.key ?? null;
  const rowOf = useMemo(() => new Map(rows.map((r) => [r.key, r])), [rows]);

  /** The rows a user can reach: none below a collapsed row. */
  const visible = useMemo(() => {
    const out: NodeKey[] = [];
    const walk = (k: NodeKey) => {
      out.push(k);
      if (collapsed.has(k)) return;
      for (const c of rowOf.get(k)?.children ?? []) walk(c);
    };
    for (const r of rows) if (r.parentKey === null) walk(r.key);
    return out;
  }, [rows, rowOf, collapsed]);
  // The roving tab stop: the focused row, else the centre; a row hidden under a collapsed one (a pointer click on a
  // twisty) hands it to its nearest visible ancestor, so the tree keeps a reachable tab stop (QA G3).
  const stop = useMemo(() => {
    let k: NodeKey | null = p.focusKey && byKey.has(p.focusKey) ? p.focusKey : centre;
    const shown = new Set(visible);
    while (k !== null && !shown.has(k)) k = rowOf.get(k)?.parentKey ?? null;
    return k ?? centre;
  }, [p.focusKey, byKey, centre, visible, rowOf]);

  const focusRow = (k: NodeKey) => {
    p.onFocusKey(k);
    const el = document.querySelector<HTMLElement>(`[data-graph-row="${CSS.escape(k)}"]`);
    el?.focus();
    if (panel) el?.querySelector('.graph-row')?.scrollIntoView({ block: 'nearest' });
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[role="treeitem"]');
    const k = el?.getAttribute('data-graph-row');
    const n = k ? byKey.get(k) : undefined;
    if (!el || !k || !n) return;
    const plain = !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey;
    const i = visible.indexOf(k);
    const row = rowOf.get(k);
    const kids = row?.children ?? [];
    if (plain && (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Home' || e.key === 'End' || e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
      e.preventDefault();
      e.stopPropagation();
      p.onMove(); // a key in the graph hides a hover preview (D-942)
      if (e.key === 'ArrowDown' && i < visible.length - 1) focusRow(visible[i + 1]);
      else if (e.key === 'ArrowUp' && i > 0) focusRow(visible[i - 1]);
      else if (e.key === 'Home') focusRow(visible[0]);
      else if (e.key === 'End') focusRow(visible[visible.length - 1]);
      else if (e.key === 'ArrowRight' && kids.length) {
        if (collapsed.has(k)) setCollapsed((s) => { const x = new Set(s); x.delete(k); return x; });
        else focusRow(kids[0]);
      } else if (e.key === 'ArrowLeft') {
        if (kids.length && !collapsed.has(k)) setCollapsed((s) => new Set(s).add(k));
        else if (row?.parentKey) focusRow(row.parentKey);
      }
      return;
    }
    p.onKey(e, n, el);
  };

  const render = (k: NodeKey): React.ReactNode => {
    const n = byKey.get(k);
    const r = rowOf.get(k);
    if (!n || !r) return null;
    const isTag = n.node.typeKey === 'tag';
    const icon = chipIcon(n.node.typeKey);
    const phrase = n.centre ? null : connectionPhrase(n.node, p.result, p.types);
    const open = !collapsed.has(k);
    return (
      <div key={k} role="treeitem" data-graph-row={k} aria-level={r.level + 1} aria-selected={p.selected === k ? 'true' : 'false'}
        aria-expanded={r.children.length ? open : undefined} tabIndex={k === stop ? 0 : -1}
        aria-label={`${displayTitle(n.node)}, ${typeNameOf(n.node.typeKey)}`} aria-description={nodeDescription(n.node, p.result, p.types, null)}
        className="graph-row-item" data-user-content=""
        onFocus={(e) => { if (e.target === e.currentTarget) p.onFocusKey(k); }}>
        <div className={`graph-row${p.selected === k ? ' selected' : ''}`} style={{ paddingLeft: panel ? r.level * 12 : 8 + r.level * 20 }}
          onClick={(e) => { e.stopPropagation(); p.onClick(n, e.currentTarget.parentElement as HTMLElement, e); }}
          onDoubleClick={(e) => { e.stopPropagation(); p.onDoubleClick(n); }}
          onPointerEnter={() => p.onPointer(n, true)} onPointerMove={() => p.onPointer(n, true)} onPointerLeave={() => p.onPointer(n, false)}>
          {r.children.length
            ? <span className={`graph-row-twisty${open ? ' open' : ''}`} aria-hidden="true" onClick={(e) => { e.stopPropagation(); setCollapsed((s) => { const x = new Set(s); if (x.has(k)) x.delete(k); else x.add(k); return x; }); }} />
            : <span className="graph-row-twisty none" aria-hidden="true" />}
          {isTag
            ? <span className="graph-swatch pill" data-swatch="pill" aria-hidden="true" />
            : <span className="graph-row-icon" aria-hidden="true"><Icon name={icon.glyph} dataIcon={icon.def} size={14} /></span>}
          <span className="graph-row-title" data-user-content="">{displayTitle(n.node)}</span>
          {panel ? (
            <span className="graph-row-lines">
              {phrase && <span className="graph-row-meta"><span className="graph-row-sep">{' · '}</span>{phrase}</span>}
              <span className="graph-row-meta"><span className="graph-row-sep">{' · '}</span>{t('graph.connectionsCount', { count: n.node.degree })}</span>
            </span>
          ) : (
            <>
              {phrase && <span className="graph-row-meta">{' · '}{phrase}</span>}
              <span className="graph-row-meta">{' · '}{t('graph.connectionsCount', { count: n.node.degree })}</span>
            </>
          )}
        </div>
        {r.children.length > 0 && <div role="group" hidden={!open}>{r.children.map(render)}</div>}
      </div>
    );
  };

  return (
    <div role="tree" aria-label={t('graph.list')} className={`graph-list${panel ? ' panel' : ''}`} onKeyDown={onKeyDown}
      onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null) && e.relatedTarget) p.onFocusKey(null); }}>
      {rows.filter((r) => r.parentKey === null).map((r) => render(r.key))}
    </div>
  );
}
