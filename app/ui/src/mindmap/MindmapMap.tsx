// Slice MM (docs/acceptance/mindmap.md R91, R92; D-681…D-684, D-770, D-774, D-775): the map of a mindmap block. Nodes
// are placed by `layoutMindmap` and drawn as boxes over SVG elbow connectors; their content is rendered by the caller
// (the read view's inline rendering, so chips look as everywhere else). A `tree` with one Tab stop and arrow keys.
// Slice MM2 (R95, R95a, R96; D-786…D-790, D-794, D-795): the `spider` layout with its sides, editing on the map through
// the editor's `MindmapEdit` (⏎ sibling, Tab child, Space / F2 the text field, ⌫ a leaf, ⌥ + arrows move and nest,
// ⌘Z / ⇧⌘Z), a click focuses, a double-click edits; a new node is pending (never in the file) until its first non-empty
// commit.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { MindItem, MindmapTree } from '@tegg/doc';
import type { MindmapEdit } from '@tegg/editor';
import { t } from '../i18n/catalog';
import { ipc } from '../ipc/client';
import { layoutCount, layoutMindmap, PALETTE, type ChipExtra, type Measure, type MindLayoutNode } from './layout';

/** Map-area padding (R92): 12 px top and bottom, 16 px left and right. */
const PAD_X = 16;
const PAD_Y = 12;
/** What a chip adds to its text's width: icon, gap and padding (link chips, D-600). */
const CHIP_EXTRA = 30;
/** The pending node (D-795) is laid out as a placeholder item of this width (32 px high, one line), so the map makes
 *  room for it: the nodes after it move down instead of being covered (D-797). */
const PENDING_W = 120;
const PENDING_TEXT = '\u0000pending';
const PENDING_ID = '-1';

let canvas: HTMLCanvasElement | null = null;
/** The real measurer: the node font (13 px, the document's family) on a canvas, at the node's weight (R92). */
function realMeasure(): Measure {
  canvas ??= document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const family = getComputedStyle(document.body).fontFamily || 'system-ui';
  if (!ctx) return (s) => s.length * 7;
  const font = (depth = 2) => `${depth === 0 ? 650 : depth === 1 ? 600 : 400} 13px ${family}`;
  return (s, depth) => { ctx.font = font(depth); return ctx.measureText(s.normalize('NFC')).width; };
}

/** The measurer and chip widths of a map; the pending placeholder measures `PENDING_W` with its padding. */
function measurers(chipSuffix?: (target: string) => string | null): { m: Measure; extra: ChipExtra } {
  const real = realMeasure();
  const m: Measure = (s, depth) => (s === PENDING_TEXT ? PENDING_W - 20 : real(s, depth));
  const extra: ChipExtra = (r) => {
    const s = r.k === 'link' ? chipSuffix?.(r.target) : null;
    return CHIP_EXTRA + (s ? m(s) + 16 : 0);
  };
  return { m, extra };
}

/** The tree with the pending placeholder at `index` among the children of the node `parent`. */
function withPending(tree: MindmapTree, parent: string, index: number): MindmapTree {
  const ph: MindItem = { inline: [{ k: 'text', text: PENDING_TEXT, marks: [] }], checked: null, more: false, path: [Number(PENDING_ID)], children: [] };
  const put = (kids: MindItem[]) => [...kids.slice(0, index), ph, ...kids.slice(index)];
  const walk = (it: MindItem): MindItem => {
    const children = it.children.map(walk);
    return { ...it, children: it.path.join('.') === parent ? put(children) : children };
  };
  if (tree.root.kind === 'synthesized') return { ...tree, items: parent === 'root' ? put(tree.items) : tree.items.map(walk) };
  const items = tree.items.map(walk);
  return { ...tree, items, root: tree.root.kind === 'item' ? { kind: 'item', item: items[0] } : tree.root };
}

type Info = { item: MindItem | null; parent: string | null; index: number; size: number; path: number[] | null };

/** Each layout node's item, parent and position among its siblings. */
function infos(tree: MindmapTree): Map<string, Info> {
  const out = new Map<string, Info>();
  const walk = (it: MindItem, parent: string | null, index: number, size: number) => {
    const id = it.path.join('.');
    out.set(id, { item: it, parent, index, size, path: it.path });
    it.children.forEach((c, i) => walk(c, id, i, it.children.length));
  };
  if (tree.root.kind === 'item') walk(tree.root.item, null, 0, 1);
  else if (tree.root.kind === 'synthesized') {
    out.set('root', { item: null, parent: null, index: 0, size: 1, path: null });
    tree.items.forEach((c, i) => walk(c, 'root', i, tree.items.length));
  }
  return out;
}

/** The last layouts by content (the tree and its chips' suffixes); the measurer and the font don't change. */
const LAYOUTS = new Map<string, ReturnType<typeof layoutMindmap>>();
function layoutKey(tree: MindmapTree, chipSuffix?: (target: string) => string | null): string {
  const suffixes: (string | null)[] = [];
  if (chipSuffix) {
    const walk = (it: MindmapTree['items'][number]) => {
      for (const r of it.inline) if (r.k === 'link') suffixes.push(chipSuffix(r.target));
      it.children.forEach(walk);
    };
    tree.items.forEach(walk);
  }
  return JSON.stringify([tree, suffixes]);
}

const idOf = (path: number[] | null) => (path === null || path.length === 0 ? 'root' : path.join('.'));

/** The field of R95a, or the pending node of D-795. */
export type MindmapEditing =
  | { kind: 'text'; id: string; value: string; original: string }
  | { kind: 'pending'; anchor: string; where: 'sibling' | 'child'; at: number[] | null; level: number; value: string; afterId: string; parent: string; index: number; tone: string };

export function MindmapMap({ tree, label, content, onNode, readOnly, chipSuffix, edit = null, onFocusedNode }: {
  tree: MindmapTree;
  /** The tree's accessible name (`Map of <title>`). */
  label: string;
  /** A node's content: `root` (a synthesized root) or an item's path id. */
  content: (id: string) => ReactNode;
  /** The empty state's button (D-793): List with the caret in the first item. Not called when `readOnly`. */
  onNode?: (path: number[] | null) => void;
  readOnly: boolean;
  /** A chip's suffix text (a task's `<due> · <status>`, D-600), so the layout leaves room for it. */
  chipSuffix?: (target: string) => string | null;
  /** Slice MM2 (D-786): the editor's edits on the block; null in the read view and in a read-only note. */
  edit?: MindmapEdit | null;
  /** Slice MM2 (D-794): the path of the node that has the focus (null: the synthesized root). */
  onFocusedNode?: (path: number[] | null | undefined) => void;
}) {
  const layout = useMemo(() => {
    // A re-created node view (a save redraws the document) or a re-render with the same content reuses the layout,
    // so only a change lays the map out again (FR-MMP-02 AC-6).
    const key = layoutKey(tree, chipSuffix);
    const hit = LAYOUTS.get(key);
    if (hit) return hit;
    const t0 = performance.now();
    const { m, extra } = measurers(chipSuffix);
    const l = layoutMindmap(tree, m, { chipExtra: extra });
    (window as unknown as { __TEGG_MINDMAP_LAYOUTS__?: number }).__TEGG_MINDMAP_LAYOUTS__ = layoutCount();
    if (l.nodes.length >= 100) void ipc.perfTimed('mindmap-layout', performance.now() - t0).catch(() => {}); // FR-MMP-02 AC-14 (mm-mindmap §4)
    LAYOUTS.set(key, l);
    if (LAYOUTS.size > 32) LAYOUTS.delete(LAYOUTS.keys().next().value!);
    return l;
  }, [tree, chipSuffix]);
  const info = useMemo(() => infos(tree), [tree]);
  const [focus, setFocus] = useState(layout.nodes[0]?.id ?? '');
  const [editing, setEditingState] = useState<MindmapEditing | null>(null);
  // The field's blur on unmount must not commit a second time: commit and cancel read this ref, not the state.
  const editRef = useRef<MindmapEditing | null>(null);
  const setEditing = (e: MindmapEditing | null) => { editRef.current = e; setEditingState(e); };
  const box = useRef<HTMLDivElement | null>(null);
  const field = useRef<HTMLInputElement | null>(null);
  const moved = useRef(false);
  // The node the map wants focused (it may not be drawn yet, or not any more after an undo): what a re-created map
  // starts from, and what `List` follows (D-794).
  const wanted = useRef<number[] | null | undefined>(layout.nodes[0] ? (layout.nodes[0].id === 'root' ? null : layout.nodes[0].id.split('.').map(Number)) : undefined);
  // A focus the map itself moved (never the user's): `onFocus` must not take it as a new choice.
  const programmatic = useRef(false);
  // R95: ⌘Z focuses the node an edit started from, ⇧⌘Z the node it produced (paths change with the list, so each
  // map edit records both). Other undo steps (typing in the list) fall back to the roving node.
  const steps = useRef<{ before: number[] | null; after: number[] | null }[]>([]);
  const stepAt = useRef(0);
  const recordStep = (before: number[] | null, after: number[] | null) => { steps.current.length = stepAt.current; steps.current.push({ before, after }); stepAt.current++; };
  const order = layout.nodes.map((n) => n.id);
  const ids = new Set(order);
  // The roving tab stop: the focused node, else the root (a map that was empty or lost its node).
  const stop = ids.has(focus) ? focus : order[0];
  // What is drawn: the layout, or while a node is pending the layout with its placeholder (never cached or counted as
  // the map's own layout; navigation keeps using `layout`).
  const pendingAt = editing?.kind === 'pending' ? `${editing.parent}\u0000${editing.index}` : null;
  const shown = useMemo(() => {
    if (editing?.kind !== 'pending') return layout;
    const { m, extra } = measurers(chipSuffix);
    return layoutMindmap(withPending(tree, editing.parent, editing.index), m, { chipExtra: extra });
  }, [layout, pendingAt]); // eslint-disable-line react-hooks/exhaustive-deps

  useLayoutEffect(() => {
    if (!moved.current) return;
    const el = box.current?.querySelector<HTMLElement>(`[data-node="${CSS.escape(focus)}"]`)
      ?? (editing?.kind === 'pending' ? null : box.current?.querySelector<HTMLElement>(`[data-node="${CSS.escape(stop)}"]`));
    if (!el) return;
    // The wanted node is back (a redo): the move is done; a fallback keeps waiting for it.
    if (el.getAttribute('data-node') === focus) moved.current = false;
    if (editing) return;
    programmatic.current = true;
    el.focus({ preventScroll: true });
    programmatic.current = false;
    el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [focus, layout, editing, stop]);
  useLayoutEffect(() => {
    if (editing) { field.current?.focus(); field.current?.setSelectionRange(editing.value.length, editing.value.length); }
  }, [editing?.kind, editing?.kind === 'text' ? editing.id : editing?.anchor]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    onFocusedNode?.(wanted.current);
  }, [focus, info]); // eslint-disable-line react-hooks/exhaustive-deps

  if (tree.root.kind === 'empty') {
    return readOnly ? null : (
      <button type="button" className="mindmap-empty" onMouseDown={(e) => e.preventDefault()} onClick={() => onNode?.([0])}>{t('mindmap.empty')}</button>
    );
  }
  const go = (id: string | null | undefined) => { if (id && ids.has(id)) { moved.current = true; wanted.current = info.get(id)?.path ?? null; setFocus(id); } };
  const goPath = (path: number[] | null | undefined) => { if (path !== undefined) { moved.current = true; wanted.current = path; setFocus(idOf(path)); } };
  /** ⌘↩ opens and ⌥Space previews the node's first link (FR-MMP-02 AC-8, D-941): the key goes to its chip, whose
   *  reference does what R103 says. */
  const linkKey = (el: HTMLElement, init: KeyboardEventInit) => {
    const chip = el.querySelector<HTMLElement>('[data-preview-ref], .chip, .embed-chip, a[href]');
    chip?.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));
  };
  const openLink = (el: HTMLElement) => linkKey(el, { key: 'Enter', code: 'Enter', metaKey: true });
  const nodeOf = (id: string) => layout.nodes.find((n) => n.id === id);
  const lastDescendant = (id: string): string => {
    let last = id;
    const i = order.indexOf(id);
    for (let k = i + 1; k < order.length; k++) {
      const n = nodeOf(order[k])!;
      if (n.depth <= nodeOf(id)!.depth) break;
      last = order[k];
    }
    return last;
  };

  // ---- editing (R95a, D-795)
  const startText = (id: string) => {
    if (!edit) return;
    const path = info.get(id)?.path;
    if (!path) return; // the synthesized root has no text to edit
    const src = edit.source(path);
    if (src === null) return;
    setEditing({ kind: 'text', id, value: src, original: src });
  };
  const startPending = (id: string, where: 'sibling' | 'child') => {
    if (!edit) return;
    const n = nodeOf(id);
    const inf = info.get(id);
    if (!n || !inf) return;
    const rootItem = tree.root.kind === 'item' && id === order[0];
    const asChild = where === 'child' || inf.path === null || rootItem;
    const at = inf.path;
    const level = asChild ? n.depth + 2 : n.depth + 1;
    const first = asChild && rootItem && where === 'sibling';
    const afterId = first ? id : lastDescendant(id);
    // Where it is laid out: ⏎ on the root item its first child (D-787), a child last (Tab), a sibling right after it.
    const parent = asChild ? id : inf.parent ?? 'root';
    const index = asChild ? (first ? 0 : inf.item?.children.length ?? tree.items.length) : inf.index + 1;
    const tone = level === 2 ? PALETTE[(asChild ? (inf.item?.children.length ?? tree.items.length) : inf.index + 1) % PALETTE.length] : 'plain';
    // `where` stays as pressed: the editor makes ⏎ on the root item its first child (D-787).
    setEditing({ kind: 'pending', anchor: id, where, at, level, value: '', afterId, parent, index, tone });
  };
  const cancel = () => {
    const cur = editRef.current;
    if (!cur) return;
    const back = cur.kind === 'text' ? cur.id : cur.anchor;
    setEditing(null);
    go(back);
  };
  const commit = (then?: 'child') => {
    const editing = editRef.current;
    if (!editing) return;
    if (!edit) { setEditing(null); return; }
    if (editing.kind === 'text') {
      const path = info.get(editing.id)?.path;
      const id = editing.id;
      setEditing(null);
      if (path && editing.value !== editing.original && edit.setText(path, editing.value)) recordStep(path, path);
      go(id);
      if (then === 'child') startPending(id, 'child');
      return;
    }
    const value = editing.value;
    if (value.trim() === '') { cancel(); return; }
    const where = editing.where;
    const at = editing.at;
    setEditing(null);
    const created = edit.insert(at, where, value);
    if (created) {
      recordStep(info.get(editing.anchor)?.path ?? null, created);
      goPath(created);
      if (then === 'child') queueMicrotask(() => startPending(idOf(created), 'child'));
    } else go(editing.anchor);
  };
  const onFieldKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const k = e.key;
    if (k === 'Enter') { e.preventDefault(); e.stopPropagation(); commit(); }
    else if (k === 'Escape') { e.preventDefault(); e.stopPropagation(); cancel(); }
    else if (k === 'Tab') { e.preventDefault(); e.stopPropagation(); commit(e.shiftKey ? undefined : 'child'); }
    else e.stopPropagation();
  };

  // ---- keys on a node (R95)
  const onKey = (e: React.KeyboardEvent, n: MindLayoutNode) => {
    const i = order.indexOf(n.id);
    const inf = info.get(n.id);
    const firstChild = order.find((id) => info.get(id)?.parent === n.id);
    const parent = inf?.parent;
    const k = e.key;
    const meta = e.metaKey || e.ctrlKey;
    const spider = layout.layout === 'spider';
    // In the spider layout ← and → follow the screen (D-790).
    const toward = (dir: 'left' | 'right'): string | null | undefined => {
      if (!spider) return dir === 'right' ? firstChild : parent;
      if (n.id === order[0]) return order.find((id) => info.get(id)?.parent === n.id && nodeOf(id)?.side === dir);
      return n.side === dir ? firstChild : parent;
    };
    if (k === 'ArrowDown' && !e.altKey) go(order[i + 1]);
    else if (k === 'ArrowUp' && !e.altKey) go(order[i - 1]);
    else if (k === 'ArrowRight' && !e.altKey) go(toward('right'));
    else if (k === 'ArrowLeft' && !e.altKey) go(toward('left'));
    else if (k === 'Home') go(order[0]);
    else if (k === 'End') go(order[order.length - 1]);
    else if (k === 'Enter' && meta) openLink(e.currentTarget as HTMLElement);
    else if (k === ' ' && e.altKey && !meta) { e.preventDefault(); e.stopPropagation(); linkKey(e.currentTarget as HTMLElement, { key: ' ', code: 'Space', altKey: true }); }
    else if (!edit) { if (k === 'Enter' || k === ' ' || k === 'F2' || k === 'Backspace' || k === 'Delete') { /* navigation only (D-786): swallowed, nothing happens */ } else return; }
    else if (k === 'z' && meta) {
      if (e.shiftKey) { if (edit.redo() && stepAt.current < steps.current.length) goPath(steps.current[stepAt.current++].after); else moved.current = true; }
      else if (edit.undo() && stepAt.current > 0) goPath(steps.current[--stepAt.current].before); else moved.current = true;
    }
    else if (k === 'Enter') startPending(n.id, 'sibling');
    else if (k === 'Tab' && !e.shiftKey) startPending(n.id, 'child');
    else if (k === ' ' || k === 'F2') startText(n.id);
    else if (k === 'Backspace' || k === 'Delete') { const p = inf?.path; if (p) { const to = edit.remove(p); if (to) { recordStep(p, to); goPath(to); } } }
    else if (e.altKey && (k === 'ArrowUp' || k === 'ArrowDown' || k === 'ArrowLeft' || k === 'ArrowRight')) {
      const p = inf?.path;
      if (p) { const to = edit.move(p, k === 'ArrowUp' ? 'up' : k === 'ArrowDown' ? 'down' : k === 'ArrowRight' ? 'in' : 'out'); if (to) { recordStep(p, to); goPath(to); } }
    } else return;
    e.preventDefault();
    e.stopPropagation();
  };

  const width = shown.width + 2 * PAD_X;
  const height = shown.height + 2 * PAD_Y;
  const pending = editing?.kind === 'pending' ? editing : null;
  const slot = pending ? shown.nodes.find((n) => n.id === PENDING_ID) : undefined;
  // The colours stay put while a node is pending (the placeholder shifts the branch positions).
  const toneOf = shown === layout ? null : new Map(layout.nodes.map((n) => [n.id, n.tone]));
  const renderField = () => (
    <input ref={field} className="mindmap-field" type="text" aria-label={t('mindmap.editNode')} data-node-editor="" value={editing?.value ?? ''}
      onChange={(e) => { const cur = editRef.current; if (cur) setEditing({ ...cur, value: e.target.value }); }} onKeyDown={onFieldKey} onBlur={() => commit()}
      onMouseDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()} />
  );
  const pendingNode = pending ? (
    <div key="pending" role="treeitem" data-node="pending" aria-level={pending.level} aria-selected="true" tabIndex={-1} className={`mindmap-node pending tone-${pending.tone}`}
      style={{ left: (slot?.x ?? 0) + PAD_X, top: (slot?.y ?? 0) + PAD_Y, width: slot?.w ?? PENDING_W, height: slot?.h ?? 32 }}>
      {renderField()}
    </div>
  ) : null;
  return (
    // D-798: a click on the map's empty area (the canvas fills the map area's width) focuses the map's current node,
    // never the note body; with a field open it commits the field, as a click on another node does.
    <div ref={box} className="mindmap-canvas" style={{ width, height, minWidth: '100%' }}
      onMouseDown={(e) => { if (!(e.target as HTMLElement).closest('[role="treeitem"]')) e.preventDefault(); }}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest('[role="treeitem"]')) return;
        if (editRef.current) { commit(); return; }
        box.current?.querySelector<HTMLElement>(`[data-node="${CSS.escape(stop)}"]`)?.focus({ preventScroll: true });
      }}>
      <svg className="mindmap-lines" width={width} height={height} aria-hidden="true">
        {shown.connectors.map((c) => (
          <path key={`${c.from}>${c.to}`} data-from={c.from} data-to={c.to === PENDING_ID ? 'pending' : c.to}
            d={c.points.map(([x, y], i) => `${i ? 'L' : 'M'}${x + PAD_X} ${y + PAD_Y}`).join(' ') + (c.points.every(([, y]) => y === c.points[0][1]) ? ' l0 0.01' : '')} />
        ))}
      </svg>
      <div role="tree" aria-label={label} className="mindmap-tree">
        {shown.nodes.flatMap((n) => {
          if (n.id === PENDING_ID) return [];
          const tone = toneOf?.get(n.id) ?? n.tone;
          const it = info.get(n.id);
          const item = it?.item ?? null;
          const name = n.lines.join(' ');
          const desc = [item?.more ? t('mindmap.more') : null, item && item.checked !== null ? t(item.checked ? 'mindmap.checked' : 'mindmap.unchecked') : null].filter(Boolean).join(', ') || undefined;
          const isEditing = editing?.kind === 'text' && editing.id === n.id;
          const el = (
            <div key={n.id} role="treeitem" data-node={n.id} data-tone={tone} {...(n.side ? { 'data-side': n.side } : {})} aria-level={n.depth + 1} aria-setsize={it?.size ?? 1} aria-posinset={(it?.index ?? 0) + 1}
              aria-label={name} aria-description={desc} aria-selected={stop === n.id} tabIndex={stop === n.id ? 0 : -1}
              className={`mindmap-node tone-${tone}${n.lines.length === 1 ? ' one-line' : ''}${isEditing ? ' editing' : ''}`}
              style={{ left: n.x + PAD_X, top: n.y + PAD_Y, width: isEditing ? undefined : n.w, minWidth: isEditing ? n.w : undefined, maxWidth: 200, height: isEditing ? undefined : n.h, minHeight: n.h }}
              onFocus={() => { if (programmatic.current) return; wanted.current = it?.path ?? null; setFocus(n.id); }}
              onMouseDown={(e) => { if (!(e.target as HTMLElement).closest('a, .chip, .embed-chip, input')) e.preventDefault(); }}
              onClick={(e) => { if (!(e.target as HTMLElement).closest('a, .chip, .embed-chip, .tag-chip, input')) { if (editing && !isEditing) commit(); go(n.id); } }}
              onDoubleClick={(e) => { if (!(e.target as HTMLElement).closest('a, .chip, .embed-chip, .tag-chip, input')) { e.preventDefault(); startText(n.id); } }}
              onKeyDown={(e) => { if (!isEditing) onKey(e, n); }}>
              {isEditing ? renderField() : (
                <>
                  {item && item.checked !== null && <span className={`mindmap-box${item.checked ? ' checked' : ''}`} data-checkbox="" data-checked={item.checked ? 'true' : 'false'} aria-hidden="true">{item.checked ? '✓' : ''}</span>}
                  <span className="mindmap-text">{content(n.id)}{item?.more ? <span className="mindmap-more"> …</span> : null}</span>
                </>
              )}
            </div>
          );
          return pending && pending.afterId === n.id ? [el, pendingNode] : [el];
        })}
      </div>
    </div>
  );
}
