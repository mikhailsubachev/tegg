// The embeds of one open note page (docs/contracts/ms4-embeds.md §6): the tree, the nested editors and their save
// states. A small external store, because block embeds in the editor render in their own React roots (node views).
import type { EmbedMode } from '@tegg/doc';
import { ipc } from '../ipc/client';
import type { LinkTargetDto, TypeDefDto, TypeDto } from '../ipc/types';
import type { SaveState } from '../edit/autosave';
import { buildEmbedTree, type EmbedNode, type EmbedTree } from './tree';

/** A nested editor of an editable full embed (FR-EMB-03), as the page and the test hook see it. */
export type NestedEditor = {
  id: number;
  path: string;
  depth: number;
  editable: boolean;
  text(): string;
  dirty(): boolean;
  historyDepth(): number;
  state(): SaveState;
  flush(): Promise<void>;
  /** Another instance of the same file wrote `text` (or a clean external change): reload unless edited. */
  peerWrote(text: string, version: unknown): void;
  focusStart(): void;
  el(): HTMLElement | null;
  /** D-605: a formatting action of the selection menu on this editor (`bold`, `italic`, `strike`, `code`, `highlight`). */
  mark?(m: 'bold' | 'italic' | 'strike' | 'code' | 'highlight'): void;
};

export type EmbedHost = {
  /** Host editor commands (the page's editor; null in the read view). */
  setMode(pos: number, mode: EmbedMode | null): void;
  /** The host block index of the embed at `pos`, for Esc and arrows (D-428). */
  leave(pos: number, how: 'up' | 'down' | 'escape'): void;
  onOpen(path: string, fragment?: string): void;
  onTag(key: string): void;
  onExternal(url: string): void;
};

type Snapshot = { tree: EmbedTree | null; version: number };

export class EmbedStore {
  path: string;
  editable: boolean;
  types: TypeDefDto[] = [];
  host: EmbedHost | null = null;
  /** Re-resolves the embed targets and rebuilds the tree (set by the editor; null in the read view). */
  refresh: (() => void) | null = null;
  private snap: Snapshot = { tree: null, version: 0 };
  private listeners = new Set<() => void>();
  private editors = new Map<number, NestedEditor>();
  private nextId = 1;
  private building = 0;
  private painted = false;
  private stateListeners = new Set<() => void>();

  constructor(path: string, editable: boolean) {
    this.path = path;
    this.editable = editable;
  }

  subscribe = (f: () => void): (() => void) => {
    this.listeners.add(f);
    return () => this.listeners.delete(f);
  };
  getSnapshot = (): Snapshot => this.snap;

  private emit() {
    this.snap = { ...this.snap, version: this.snap.version + 1 };
    for (const f of [...this.listeners]) f();
  }

  /** Builds the tree from the host's text and its `link_resolve` result (D-429: one load per level). */
  async build(text: string, links: Map<string, LinkTargetDto>): Promise<void> {
    const gen = ++this.building;
    const load = (paths: string[]) => ipc.embedLoad(paths);
    let tree: EmbedTree;
    try {
      tree = await buildEmbedTree({ path: this.path, text, links }, this.types as TypeDto[], load, { readOnly: !this.editable });
    } catch {
      return;
    }
    if (gen !== this.building) return;
    // D-456: what is on screen stays put while the embeds above it change size.
    const keep = keepOnScreen();
    this.snap = { tree, version: this.snap.version + 1 };
    for (const f of [...this.listeners]) f();
    keep();
    // D-442: with TEGG_TEST=1 the real-app tests count the open note's embeds through this mark.
    if ((window as { __TEGG_TEST_MODE__?: boolean }).__TEGG_TEST_MODE__) {
      requestAnimationFrame(() => void ipc.perfMark(`embeds-rendered:${tree.embeds.length}`).catch(() => {}));
    }
    if (!this.painted) {
      this.painted = true;
      // D-429: every depth-1 embed's content has painted (report-only in MS4).
      requestAnimationFrame(() => requestAnimationFrame(() => void ipc.perfMark('embeds-painted').catch(() => {})));
    }
  }

  /** Paths whose content is shown (for `vault:changed`). */
  loadedPaths(): Set<string> {
    const out = new Set<string>();
    const walk = (ns: EmbedNode[]) => {
      for (const n of ns) {
        if (n.target.path) out.add(n.target.path.normalize('NFC'));
        walk(n.children);
      }
    };
    walk(this.snap.tree?.embeds ?? []);
    return out;
  }

  /** The tree's block embeds of the host with this inner value, in document order. */
  blockNodes(value: string): EmbedNode[] {
    const v = value.normalize('NFC');
    return (this.snap.tree?.embeds ?? []).filter((n) => !n.inline && n.value.normalize('NFC') === v);
  }
  inlineNode(value: string): EmbedNode | undefined {
    const v = value.normalize('NFC');
    return (this.snap.tree?.embeds ?? []).find((n) => n.inline && n.value.normalize('NFC') === v);
  }

  // ------------------------------------------------------------------ nested editors (FR-EMB-03)
  register(e: Omit<NestedEditor, 'id'>): NestedEditor {
    const ed = { ...e, id: this.nextId++ } as NestedEditor;
    this.editors.set(ed.id, ed);
    this.stateChanged();
    return ed;
  }
  unregister(id: number) {
    this.editors.delete(id);
    this.stateChanged();
  }
  /** Nested editors in document order (test hook §9, flush). */
  nested(): NestedEditor[] {
    const list = [...this.editors.values()];
    return list.sort((a, b) => {
      const x = a.el(), y = b.el();
      if (!x || !y) return a.id - b.id;
      return x.compareDocumentPosition(y) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
    });
  }
  /** A nested editor wrote `path`: the others on the same file reload (FR-EMB-03 AC-8). */
  wrote(from: number, path: string, text: string, version: unknown) {
    for (const e of this.editors.values()) if (e.id !== from && e.path.normalize('NFC') === path.normalize('NFC')) e.peerWrote(text, version);
  }
  async flush(): Promise<void> {
    await Promise.all([...this.editors.values()].map((e) => e.flush().catch(() => {})));
  }
  /** The worst save state of the nested editors (D-421: the page's Save state covers every file). */
  saveState(): SaveState {
    const states = [...this.editors.values()].map((e) => e.state());
    if (states.includes('conflict')) return 'conflict';
    if (states.includes('failed')) return 'failed';
    if (states.includes('saving')) return 'saving';
    return 'saved';
  }
  /** A nested editor of `path` has unsaved edits. */
  dirtyAt(path: string): boolean {
    return [...this.editors.values()].some((e) => e.path.normalize('NFC') === path.normalize('NFC') && e.dirty());
  }
  pending(): boolean {
    return [...this.editors.values()].some((e) => e.state() !== 'saved' || e.dirty());
  }
  onState = (f: () => void): (() => void) => {
    this.stateListeners.add(f);
    return () => this.stateListeners.delete(f);
  };
  stateChanged() {
    for (const f of [...this.stateListeners]) f();
  }
}

/** The scroll position the last correction set: overlapping corrections (two builds, nested stores) know each other's. */
let lastFix: number | null = null;

/** Notes the first body block on screen and, once the change has painted, scrolls so it is where it was (D-456). */
function keepOnScreen(): () => void {
  const main = typeof document !== 'undefined' ? document.querySelector('main') : null;
  if (!main || main.scrollTop === 0) return () => {};
  const top = main.getBoundingClientRect().top;
  const blocks = [...main.querySelectorAll<HTMLElement>('.editor-host .ProseMirror > *, article.read-view > *')];
  // The first block that starts on screen: a block cut by the top edge may itself be the one changing size.
  const anchor = blocks.find((b) => b.getBoundingClientRect().top >= top - 1) ?? blocks.find((b) => b.getBoundingClientRect().bottom > top + 1);
  if (!anchor) return () => {};
  const before = anchor.getBoundingClientRect().top;
  // D-689: only this correction may move the scroll; a scroll made meanwhile (the caret moved, the user scrolled)
  // wins, and the correction stops.
  let expected = main.scrollTop;
  let stopped = false;
  return () => {
    const fix = () => {
      if (stopped || !anchor.isConnected) return;
      const now = main.scrollTop;
      if (Math.abs(now - expected) > 1 && (lastFix === null || Math.abs(now - lastFix) > 1)) { stopped = true; return; }
      const d = anchor.getBoundingClientRect().top - before;
      if (Math.abs(d) > 1) main.scrollTop += d;
      expected = lastFix = main.scrollTop;
    };
    requestAnimationFrame(() => { fix(); requestAnimationFrame(fix); setTimeout(fix, 150); });
  };
}
