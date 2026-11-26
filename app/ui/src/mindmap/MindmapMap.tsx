// Slice MM (docs/acceptance/mindmap.md R91, R92; D-681…D-684, D-770, D-774, D-775): the map of a mindmap block. Nodes
// are placed by `layoutMindmap` and drawn as boxes over SVG elbow connectors; their content is rendered by the caller
// (the read view's inline rendering, so chips look as everywhere else). A `tree` with one Tab stop and arrow keys.
// Slice MM2 (R95, R95a, R96; D-786…D-790, D-794, D-795): the `spider` layout with its sides, editing on the map through
// the editor's `MindmapEdit` (⏎ sibling, Tab child, Space / F2 the text field, ⌫ a leaf, ⌥ + arrows move and nest,
// ⌘Z / ⇧⌘Z), a click focuses, a double-click edits; a new node is pending (never in the file) until its first non-empty
// commit.
// Slice MM3 (R229…R233; D-2600…D-2608, D-2612…D-2624; mm-mindmap §7): ↑ / ↓ among siblings and cousins and the other
// keys through `navigateMindmap`; Space folds, F2 edits; the fold control and the `+` inside each treeitem; folds are
// view state (the editor's `MindmapFolds`, or the map's own set in the read view); drag and drop of branches.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { MindItem, MindmapTree } from '@tegg/doc';
import type { MindmapEdit, MindmapFolds } from '@tegg/editor';
import { t } from '../i18n/catalog';
import { ipc } from '../ipc/client';
import { isPhone } from '../phone/layout';
import { clearActiveMap, setActiveMap, type MapCommand } from './active';
import { layoutCount, layoutMindmap, PALETTE, type ChipExtra, type MindLayout, type Measure, type MindLayoutNode } from './layout';
import { navigateMindmap, type MindNavKey } from './nav';

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
/** The parent id of a layout node id (`'0.1'` → `'0'`, a top-level item → `'root'`); null for a root. */
const parentId = (id: string, info: Map<string, Info>) => info.get(id)?.parent ?? null;

/** R231: a drag starts after a move of ≥ 4 px with the button held (D-2608). */
const DRAG_PX = 4;
/** R231: resting this long over a folded node unfolds it (D-2608). */
const UNFOLD_MS = 600;
type Zone = 'before' | 'after' | 'child';
type Drag = { id: string; path: number[]; target: string | null; zone: Zone | null };
const NAV_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End']);

/** The field of R95a, or the pending node of D-795. */
export type MindmapEditing =
  | { kind: 'text'; id: string; value: string; original: string }
  | { kind: 'pending'; anchor: string; where: 'sibling' | 'child'; at: number[] | null; level: number; value: string; afterId: string; parent: string; index: number; tone: string };

export function MindmapMap({ tree, label, content, onNode, readOnly, chipSuffix, edit = null, onFocusedNode, folds = null, underList = false }: {
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
  /** Slice MM3 (mm-mindmap §7.3): the editor's folds of this block; without them (the read view) the map keeps its own. */
  folds?: MindmapFolds | null;
  /** The live map below the List view: no folds, `+` or drag there (D-2621). */
  underList?: boolean;
}) {
  const info = useMemo(() => infos(tree), [tree]);
  // Slice MM3 (D-2601, D-2622): folds; none on the phone yet.
  const noFolds = isPhone() || underList;
  const [localFolds, setLocalFolds] = useState<ReadonlySet<string>>(() => new Set());
  const [, setTick] = useState(0);
  const foldedIds: ReadonlySet<string> = noFolds ? new Set() : folds ? new Set(folds.folded().map(idOf)) : localFolds;
  const foldKey = [...foldedIds].sort().join('\u0001');
  const lastFoldKey = useRef(foldKey);
  const layout = useMemo(() => {
    // A re-created node view (a save redraws the document) or a re-render with the same content reuses the layout,
    // so only a change lays the map out again (FR-MMP-02 AC-6); a fold or an unfold always lays it out (AC-53).
    const key = `${layoutKey(tree, chipSuffix)}\u0002${foldKey}`;
    const foldChanged = lastFoldKey.current !== foldKey;
    lastFoldKey.current = foldKey;
    const hit = foldChanged ? undefined : LAYOUTS.get(key);
    if (hit) return hit;
    const t0 = performance.now();
    const { m, extra } = measurers(chipSuffix);
    const l = layoutMindmap(tree, m, { chipExtra: extra, folded: foldedIds });
    (window as unknown as { __TEGG_MINDMAP_LAYOUTS__?: number }).__TEGG_MINDMAP_LAYOUTS__ = layoutCount();
    if (info.size >= 100) void ipc.perfTimed('mindmap-layout', performance.now() - t0).catch(() => {}); // FR-MMP-02 AC-14, AC-53 (mm-mindmap §4, §7.5)
    LAYOUTS.set(key, l);
    if (LAYOUTS.size > 32) LAYOUTS.delete(LAYOUTS.keys().next().value!);
    return l;
  }, [tree, chipSuffix, foldKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const [focus, setFocus] = useState(layout.nodes[0]?.id ?? '');
  const [editing, setEditingState] = useState<MindmapEditing | null>(null);
  // The field's blur on unmount must not commit a second time: commit and cancel read this ref, not the state.
  const editRef = useRef<MindmapEditing | null>(null);
  const setEditing = (e: MindmapEditing | null) => { editRef.current = e; setEditingState(e); };
  const box = useRef<HTMLDivElement | null>(null);
  const field = useRef<HTMLInputElement | null>(null);
  const moved = useRef(false);
  // Slice MM3: an unfold keeps the scroll (the subtree opens where the folded node was); every other move scrolls the
  // node into view.
  const scrollOnMove = useRef(true);
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
  // The roving tab stop: the focused node, else its nearest shown ancestor (a fold hid it, D-2616), else the root (a map
  // that was empty or lost its node).
  const shownAncestor = (id: string): string | undefined => {
    for (let a: string | null = id; a !== null; a = parentId(a, info)) if (ids.has(a)) return a;
    return undefined;
  };
  const stop = ids.has(focus) ? focus : shownAncestor(focus) ?? order[0];
  // What is drawn: the layout, or while a node is pending the layout with its placeholder (never cached or counted as
  // the map's own layout; navigation keeps using `layout`).
  const pendingAt = editing?.kind === 'pending' ? `${editing.parent}\u0000${editing.index}` : null;
  const shown = useMemo(() => {
    if (editing?.kind !== 'pending') return layout;
    const { m, extra } = measurers(chipSuffix);
    return layoutMindmap(withPending(tree, editing.parent, editing.index), m, { chipExtra: extra, folded: foldedIds });
  }, [layout, pendingAt]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- drag and drop (R231, D-2608, D-2620, D-2621)
  const [drag, setDragState] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const setDrag = (d: Drag | null) => { dragRef.current = d; setDragState(d); };
  const press = useRef<{ id: string; x: number; y: number; dx: number; dy: number } | null>(null);
  const ghost = useRef<HTMLDivElement | null>(null);
  /** The copy's place in the canvas (it follows the pointer without a re-render). */
  const ghostAt = useRef('none');
  const suppressClick = useRef(false);
  const unfoldTimer = useRef<{ id: string; timer: ReturnType<typeof setTimeout> } | null>(null);
  const listeners = useRef<(() => void) | null>(null);
  // What the window listeners read: this render's layout and actions.
  const live = useRef<{ layout: MindLayout; drop: (d: Drag) => void; unfold: (id: string) => void; folded: ReadonlySet<string>; go: (id: string) => void }>(null!);
  const treeSig = useMemo(() => JSON.stringify(tree), [tree]);
  const commandRun = useRef<(c: MapCommand) => void>(() => {});
  const stopUnfoldTimer = () => { if (unfoldTimer.current) { clearTimeout(unfoldTimer.current.timer); unfoldTimer.current = null; } };
  const endDrag = (dropIt: boolean) => {
    const d = dragRef.current;
    press.current = null;
    stopUnfoldTimer();
    listeners.current?.();
    listeners.current = null;
    if (!d) return;
    suppressClick.current = true;
    setTimeout(() => { suppressClick.current = false; }, 0);
    setDrag(null);
    if (dropIt && d.target && d.zone) live.current.drop(d);
    else live.current.go(d.id);
  };
  // FR-SYN-03 AC-45 (D-2621): a reload of the block (another program changed the file) cancels a running drag.
  const sigRef = useRef(treeSig);
  useEffect(() => {
    if (sigRef.current !== treeSig && dragRef.current) endDrag(false);
    sigRef.current = treeSig;
  }, [treeSig]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { listeners.current?.(); stopUnfoldTimer(); if (box.current) clearActiveMap(box.current); }, []);
  // The drag-state hook (mm-mindmap §7.5): the figure says which node is being dragged.
  useLayoutEffect(() => {
    const fig = box.current?.closest('figure');
    if (!fig || !drag) return;
    fig.setAttribute('data-dragging', drag.id);
    return () => fig.removeAttribute('data-dragging');
  }, [drag?.id]); // eslint-disable-line react-hooks/exhaustive-deps

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
    if (scrollOnMove.current) el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    scrollOnMove.current = true;
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
  const go = (id: string | null | undefined, scroll = true) => { if (id && ids.has(id)) { moved.current = true; scrollOnMove.current = scroll; wanted.current = info.get(id)?.path ?? null; setFocus(id); } };
  const goPath = (path: number[] | null | undefined) => { if (path !== undefined) { moved.current = true; wanted.current = path; setFocus(idOf(path)); } };
  /** ⌘↩ opens and ⌥Space previews the node's first link (FR-MMP-02 AC-8, D-941): the key goes to its chip, whose
   *  reference does what R103 says. */
  const linkKey = (el: HTMLElement, init: KeyboardEventInit) => {
    const chip = el.querySelector<HTMLElement>('[data-preview-ref], .chip, .embed-chip, a[href]');
    chip?.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));
  };
  const openLink = (el: HTMLElement) => linkKey(el, { key: 'Enter', code: 'Enter', metaKey: true });
  const nodeOf = (id: string) => layout.nodes.find((n) => n.id === id);
  /** The last shown node of `id`'s subtree, with `folded` as the folds (the pending node is drawn after it). */
  const lastShown = (id: string, folded: ReadonlySet<string>): string => {
    let cur = id;
    for (;;) {
      if (folded.has(cur)) return cur;
      const kids = cur === 'root' ? tree.items : info.get(cur)?.item?.children ?? [];
      if (!kids.length) return cur;
      cur = idOf(kids[kids.length - 1].path);
    }
  };

  // ---- folds (R229, R230; D-2605, D-2606, D-2616)
  /** Returns whether the node is folded afterwards. */
  const setFold = (id: string, f: boolean | null): boolean => {
    const now = foldedIds.has(id);
    if (noFolds) return now;
    const want = f ?? !now;
    if (want === now) return now;
    if (folds) { folds.set(id === 'root' ? null : info.get(id)?.path ?? null, want); setTick((x) => x + 1); }
    else setLocalFolds((prev) => { const s = new Set(prev); if (want) s.add(id); else s.delete(id); return s; });
    return want;
  };
  /** Space, the fold control and the command: the node keeps (or takes) the focus (D-2616). */
  const toggleFold = (id: string) => { if (nodeOf(id)?.fold) go(id, setFold(id, null)); };
  /** Tab, the `+` and `Add child to mindmap node` (D-2605, D-2607): a folded node unfolds first. */
  const addChild = (id: string) => {
    if (!edit || editRef.current) return;
    const unfolding = foldedIds.has(id);
    if (unfolding) setFold(id, false);
    startPending(id, 'child', unfolding);
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
  const startPending = (id: string, where: 'sibling' | 'child', unfolding = false) => {
    if (!edit) return;
    const n = nodeOf(id);
    const inf = info.get(id);
    if (!n || !inf) return;
    const rootItem = tree.root.kind === 'item' && id === order[0];
    const asChild = where === 'child' || inf.path === null || rootItem;
    // A new child of a folded node must be seen: the node unfolds (⏎ on a folded root item adds its first child).
    if (asChild && !unfolding && foldedIds.has(id)) { setFold(id, false); unfolding = true; }
    const at = inf.path;
    const level = asChild ? n.depth + 2 : n.depth + 1;
    const first = asChild && rootItem && where === 'sibling';
    const shownFolds = unfolding ? new Set([...foldedIds].filter((x) => x !== id)) : foldedIds;
    const afterId = first ? id : lastShown(id, shownFolds);
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
    const inf = info.get(n.id);
    const k = e.key;
    const meta = e.metaKey || e.ctrlKey;
    if (dragRef.current) { e.preventDefault(); e.stopPropagation(); return; }
    // R229 (D-2600, D-2604, D-2605): ↑ ↓ siblings then cousins, ← → as R95, Home / End; the key towards a folded
    // node's children unfolds it.
    if (NAV_KEYS.has(k) && !e.altKey) {
      const r = navigateMindmap(layout, n.id, k as MindNavKey);
      if (r && 'focus' in r) go(r.focus);
      else if (r && 'unfold' in r) setFold(r.unfold, false);
    }
    else if (k === 'Enter' && meta) openLink(e.currentTarget as HTMLElement);
    else if (k === ' ' && e.altKey && !meta) { e.preventDefault(); e.stopPropagation(); linkKey(e.currentTarget as HTMLElement, { key: ' ', code: 'Space', altKey: true }); }
    // Space folds or unfolds (also in the read view and a read-only note; nothing on a leaf, D-2605).
    else if (k === ' ' && !meta) toggleFold(n.id);
    else if (!edit) { if (k === 'Enter' || k === 'F2' || k === 'Backspace' || k === 'Delete') { /* navigation only (D-786): swallowed, nothing happens */ } else return; }
    else if (k === 'z' && meta) {
      if (e.shiftKey) { if (edit.redo() && stepAt.current < steps.current.length) goPath(steps.current[stepAt.current++].after); else moved.current = true; }
      else if (edit.undo() && stepAt.current > 0) goPath(steps.current[--stepAt.current].before); else moved.current = true;
    }
    else if (k === 'Enter') startPending(n.id, 'sibling');
    else if (k === 'Tab' && !e.shiftKey) addChild(n.id);
    // E edits as F2 (D-2675): `e` / `E` without ⌘, ⌃ or ⌥; consumed, so no `e` reaches the field.
    else if (k === 'F2' || ((k === 'e' || k === 'E') && !meta && !e.altKey)) startText(n.id);
    else if (k === 'Backspace' || k === 'Delete') { const p = inf?.path; if (p) { const to = edit.remove(p); if (to) { recordStep(p, to); goPath(to); } } }
    else if (e.altKey && (k === 'ArrowUp' || k === 'ArrowDown' || k === 'ArrowLeft' || k === 'ArrowRight')) {
      const p = inf?.path;
      if (p) { const to = edit.move(p, k === 'ArrowUp' ? 'up' : k === 'ArrowDown' ? 'down' : k === 'ArrowRight' ? 'in' : 'out'); if (to) { recordStep(p, to); goPath(to); } }
    } else return;
    e.preventDefault();
    e.stopPropagation();
  };

  // ---- drag and drop (R231, D-2608)
  /** The drop zone under a client point: a shown node other than the dragged one and its subtree, inside this map. */
  const zoneAt = (cx: number, cy: number, from: string): { target: string; zone: Zone } | null => {
    const canvas = box.current;
    if (!canvas) return null;
    const area = (canvas.closest('[data-map-area]') as HTMLElement | null) ?? canvas;
    const a = area.getBoundingClientRect();
    if (cx < a.left || cx > a.right || cy < a.top || cy > a.bottom) return null;
    const r = canvas.getBoundingClientRect();
    const x = cx - r.left - PAD_X, y = cy - r.top - PAD_Y;
    const l = live.current.layout;
    const tn = l.nodes.find((m) => x >= m.x && x <= m.x + m.w && y >= m.y && y <= m.y + m.h);
    if (!tn || tn.id === from || tn.id.startsWith(`${from}.`)) return null;
    // AP-2119: a root has the child zone only; elsewhere the outer third wins over the halves.
    if (tn.depth === 0) return { target: tn.id, zone: 'child' };
    const outer = tn.side === 'left' ? x <= tn.x + tn.w / 3 : x >= tn.x + (2 * tn.w) / 3;
    return { target: tn.id, zone: outer ? 'child' : y < tn.y + tn.h / 2 ? 'before' : 'after' };
  };
  const onPointerDown = (e: React.PointerEvent, n: MindLayoutNode) => {
    // Not draggable: the root, a node being edited, anything in the read view or a read-only note (D-2608).
    if (e.button !== 0 || !edit || n.depth === 0 || editRef.current || noFolds) return;
    if ((e.target as HTMLElement).closest('button, input, a, .chip, .embed-chip, .tag-chip')) return;
    const path = info.get(n.id)?.path;
    if (!path) return;
    const el = e.currentTarget as HTMLElement;
    const rect = el.getBoundingClientRect();
    press.current = { id: n.id, x: e.clientX, y: e.clientY, dx: e.clientX - rect.left, dy: e.clientY - rect.top };
    listeners.current?.();
    const big = info.size >= 100;
    const move = (ev: PointerEvent) => {
      const p = press.current;
      if (!p) return;
      let d = dragRef.current;
      if (!d) {
        if (Math.hypot(ev.clientX - p.x, ev.clientY - p.y) < DRAG_PX) return;
        d = { id: p.id, path, target: null, zone: null };
        setDrag(d);
        live.current.go(p.id);
      }
      const canvas = box.current;
      if (canvas) {
        const r = canvas.getBoundingClientRect();
        ghostAt.current = `translate(${ev.clientX - r.left - p.dx}px, ${ev.clientY - r.top - p.dy}px) rotate(-2deg)`;
        if (ghost.current) ghost.current.style.transform = ghostAt.current;
      }
      const z = zoneAt(ev.clientX, ev.clientY, d.id);
      // R231: resting 600 ms over a folded node unfolds it; leaving earlier doesn't.
      const over = z?.target ?? null;
      if (unfoldTimer.current?.id !== over) {
        stopUnfoldTimer();
        if (over && live.current.folded.has(over)) unfoldTimer.current = { id: over, timer: setTimeout(() => { unfoldTimer.current = null; if (dragRef.current) live.current.unfold(over); }, UNFOLD_MS) };
      }
      if (z?.target !== d.target || z?.zone !== d.zone) setDrag({ ...d, target: z?.target ?? null, zone: z?.zone ?? null });
      // mm-mindmap §7.5 (FR-MMP-02 AC-53): pointer event to the painted indicator, on big maps.
      if (big) { const t0 = ev.timeStamp; requestAnimationFrame(() => { void ipc.perfTimed('mindmap-drag', Math.max(0, performance.now() - t0)).catch(() => {}); }); }
    };
    const up = () => endDrag(true);
    const key = (ev: KeyboardEvent) => { if (ev.key === 'Escape' && dragRef.current) { ev.preventDefault(); ev.stopPropagation(); endDrag(false); } };
    window.addEventListener('pointermove', move, true);
    window.addEventListener('pointerup', up, true);
    window.addEventListener('pointercancel', up, true);
    window.addEventListener('keydown', key, true);
    listeners.current = () => {
      window.removeEventListener('pointermove', move, true);
      window.removeEventListener('pointerup', up, true);
      window.removeEventListener('pointercancel', up, true);
      window.removeEventListener('keydown', key, true);
    };
  };
  /** One list edit (R232); a drop into a folded node's child zone unfolds it; the moved node keeps the focus. */
  const drop = (d: Drag) => {
    if (!edit?.moveMindmapItem || !d.target || !d.zone) { go(d.id); return; }
    const tp = d.target === 'root' ? null : info.get(d.target)?.path ?? null;
    if (d.zone === 'child' && foldedIds.has(d.target)) setFold(d.target, false);
    const to = edit.moveMindmapItem(d.path, tp, d.zone);
    if (to && to.join('.') !== d.path.join('.')) { recordStep(d.path, to); goPath(to); } else go(d.id);
  };
  live.current = { layout, drop, unfold: (id) => setFold(id, false), folded: foldedIds, go };
  // R233 (D-2623): the palette's commands act on this map's focused node while it has the focus.
  commandRun.current = (c) => {
    if (editRef.current) return;
    if (c === 'toggleFold') toggleFold(stop);
    else addChild(stop);
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
    <div ref={box} className={`mindmap-canvas${drag ? ' dragging' : ''}`} style={{ width, height, minWidth: '100%' }}
      onFocus={() => { if (box.current) setActiveMap(box.current, (c) => commandRun.current(c)); }}
      onMouseDown={(e) => { if (!(e.target as HTMLElement).closest('[role="treeitem"]')) e.preventDefault(); }}
      onClick={(e) => {
        if (suppressClick.current) { suppressClick.current = false; return; }
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
          // R230 (D-2606, D-2607, D-2617…D-2619): the fold control on the elbow point and the `+` on the outer edge, both
          // inside the treeitem, out of the Tab order; the treeitem's name stays its text (aria-label).
          const fold = noFolds ? undefined : n.fold;
          const control = (c: { x: number; y: number }): React.CSSProperties => ({ left: `calc(${c.x - n.x}px - var(--mm-bw, 0px))`, top: `calc(${c.y - n.y}px - var(--mm-bw, 0px))` });
          const foldBtn = fold && (
            <button type="button" tabIndex={-1} data-fold-control="" data-command="mindmap.toggleFold" className={`mindmap-fold-control${fold.folded ? ' folded' : ''}`}
              aria-label={fold.folded ? t('mindmap.expandNode', { node: name, count: fold.hidden }) : t('mindmap.collapseNode', { node: name })} style={control(fold)}
              onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); }} onPointerDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); if (editRef.current) commit(); toggleFold(n.id); }}>
              {/* The name is the aria-label; the shown text stays out of the treeitem's name from content (axe). */}
              <span aria-hidden="true">{fold.folded ? t('mindmap.hiddenCount', { count: fold.hidden }) : '−'}</span>
            </button>
          );
          const plusBtn = edit && !underList && !editing && !drag && (
            <button type="button" tabIndex={-1} data-add-child="" data-command="mindmap.addChild" className="mindmap-add-child"
              aria-label={t('mindmap.addChild', { node: name })} style={control(n.plus)}
              onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); }} onPointerDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); addChild(n.id); }}>
              <span aria-hidden="true">+</span>
            </button>
          );
          const el = (
            <div key={n.id} role="treeitem" data-node={n.id} data-tone={tone} {...(n.side ? { 'data-side': n.side } : {})} aria-level={n.depth + 1} aria-setsize={it?.size ?? 1} aria-posinset={(it?.index ?? 0) + 1}
              aria-label={name} aria-description={desc} aria-selected={stop === n.id} tabIndex={stop === n.id ? 0 : -1} aria-expanded={fold ? !fold.folded : undefined}
              className={`mindmap-node tone-${tone}${n.lines.length === 1 ? ' one-line' : ''}${isEditing ? ' editing' : ''}${drag?.id === n.id ? ' drag-source' : ''}`}
              style={{ left: n.x + PAD_X, top: n.y + PAD_Y, width: isEditing ? undefined : n.w, minWidth: isEditing ? n.w : undefined, maxWidth: 200, height: isEditing ? undefined : n.h, minHeight: n.h }}
              onFocus={() => { if (programmatic.current) return; wanted.current = it?.path ?? null; setFocus(n.id); }}
              onPointerDown={(e) => onPointerDown(e, n)}
              onMouseDown={(e) => { if (!(e.target as HTMLElement).closest('a, .chip, .embed-chip, input')) e.preventDefault(); }}
              onClick={(e) => { if (suppressClick.current) { suppressClick.current = false; return; } if (!(e.target as HTMLElement).closest('a, .chip, .embed-chip, .tag-chip, input')) { if (editing && !isEditing) commit(); go(n.id); } }}
              onDoubleClick={(e) => { if (!(e.target as HTMLElement).closest('a, .chip, .embed-chip, .tag-chip, input')) { e.preventDefault(); startText(n.id); } }}
              onKeyDown={(e) => { if (!isEditing) onKey(e, n); }}>
              {isEditing ? renderField() : (
                <>
                  {item && item.checked !== null && <span className={`mindmap-box${item.checked ? ' checked' : ''}`} data-checkbox="" data-checked={item.checked ? 'true' : 'false'} aria-hidden="true">{item.checked ? '✓' : ''}</span>}
                  <span className="mindmap-text">{content(n.id)}{item?.more ? <span className="mindmap-more"> …</span> : null}</span>
                </>
              )}
              {foldBtn}
              {!isEditing && plusBtn}
            </div>
          );
          return pending && pending.afterId === n.id ? [el, pendingNode] : [el];
        })}
      </div>
      {drag && (() => {
        // mm-mindmap §7.5: the old place (a dashed `muted` outline), the copy under the pointer, the drop indicator.
        const src = layout.nodes.find((m) => m.id === drag.id);
        const tn = drag.target ? layout.nodes.find((m) => m.id === drag.target) : undefined;
        return (
          <>
            {src && <div data-drag-origin="" aria-hidden="true" className="mindmap-drag-origin" style={{ left: src.x + PAD_X, top: src.y + PAD_Y, width: src.w, height: src.h }} />}
            {src && <div ref={ghost} data-drag-ghost="" aria-hidden="true" className={`mindmap-node mindmap-drag-ghost tone-${src.tone}${src.lines.length === 1 ? ' one-line' : ''}`}
              style={{ left: 0, top: 0, width: src.w, height: src.h, transform: ghostAt.current }}>
              <span className="mindmap-text">{content(src.id)}</span>
            </div>}
            {tn && drag.zone && (drag.zone === 'child'
              ? <div data-drop-indicator="child" data-drop-target={tn.id} aria-hidden="true" className="mindmap-drop-ring" style={{ left: tn.x + PAD_X - 3, top: tn.y + PAD_Y - 3, width: tn.w + 6, height: tn.h + 6 }} />
              : <div data-drop-indicator={drag.zone} data-drop-target={tn.id} aria-hidden="true" className="mindmap-drop-line" style={{ left: tn.x + PAD_X, top: (drag.zone === 'before' ? tn.y : tn.y + tn.h) + PAD_Y - 1, width: tn.w, height: 2 }} />)}
          </>
        );
      })()}
    </div>
  );
}
