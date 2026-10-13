// Helpers for the @tegg/editor L1/L2 AC tests (docs/acceptance/editor.md, docs/contracts/ms3-shell.md §13.3).
// No AC assertions here except `editorModule`, which turns a missing package entry into an AssertionError (TS-I1).
// The types below are transcribed from the contract; the module is loaded dynamically so the files typecheck before
// the package exists.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

export const REPO = resolve(import.meta.dirname, '../../..');
export const NOW = '2026-10-13T14:00:00+02:00';

export type LinkChoice = { path: string; title: string; viaAlias?: string; fromPath: string; stemResolves: boolean };
export type Due = { milestone: string; slice?: string };
export interface PMView {
  state: any;
  dispatch(tr: any): void;
  someProp(name: string, f: (v: any) => any): any;
  dom: HTMLElement;
}
export interface TeggEditor {
  view: PMView;
  save(): Promise<string | null>;
  markSaved(text: string): void;
  reload(text: string): void;
  readonlyBlocks(): number[];
  commands: {
    turnInto(kind: string, opts?: { level?: number; calloutType?: string }): boolean;
    toggleMark(mark: 'bold' | 'italic' | 'strike' | 'code' | 'highlight'): boolean;
    moveBlock(dir: 'up' | 'down'): boolean;
    duplicateBlock(): boolean;
    deleteBlocks(): boolean;
    selectBlock(): boolean;
    extendBlockSelection(dir: 'up' | 'down'): boolean;
    toggleChecklist(): boolean;
    insertLink(target: LinkChoice): boolean;
    insertTag(spelling: string): boolean;
    pasteText(text: string, plain?: boolean): boolean;
    pasteHtml(html: string): boolean;
    tableAction(a: 'addRowBelow' | 'addColumnRight' | 'deleteRow' | 'deleteColumn'): boolean;
    undo(): boolean;
    redo(): boolean;
  };
  destroy(): void;
}
export interface EditorModule {
  createEditor(opts: { text: string; element?: HTMLElement; now: () => string; newId: () => string; onChange?: (d: boolean) => void }): TeggEditor;
  linkText(c: LinkChoice): string;
  slashItems(): { id: string; group: 'objects' | 'blocks' | 'media' | 'advanced'; label: string; due?: Due }[];
  VerifyError: new (...a: any[]) => Error;
  OPERATIONS: readonly string[];
  applyOperation(ed: TeggEditor, op: string, block: number): boolean;
}

export async function editorModule(): Promise<EditorModule> {
  let m: any = null;
  let why = '';
  try {
    m = await import(/* @vite-ignore */ String('../src/index.ts'));
  } catch (e) {
    why = String((e as Error)?.message ?? e).split('\n')[0];
  }
  assert.ok(m, `@tegg/editor (packages/editor/src/index.ts) can't be loaded: ${why}`);
  for (const k of ['createEditor', 'linkText', 'slashItems', 'VerifyError', 'OPERATIONS', 'applyOperation']) {
    assert.ok(k in m, `@tegg/editor doesn't export ${k} (ms3-shell §13.3)`);
  }
  return m as EditorModule;
}

let idn = 0;
export const newId = () => `01JB0Z${String(++idn).padStart(20, '0')}`;

export async function open(text: string): Promise<TeggEditor> {
  const m = await editorModule();
  return m.createEditor({ text, now: () => NOW, newId });
}

export function readFixture(rel: string): string {
  return readFileSync(resolve(REPO, rel), 'utf8');
}
export const editorNote = (name: string) => readFixture(`tests/fixtures/vaults/editor/Pages/${name}.md`);

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (n.endsWith('.md') && n !== 'README.md') out.push(p);
  }
  return out.sort();
}
/** Every file of the round-trip corpus as [repo-relative path, text]. */
export function corpus(): [string, string][] {
  const root = resolve(REPO, 'tests/fixtures/format/roundtrip');
  return walk(root).map((p) => [relative(REPO, p), readFileSync(p, 'utf8')]);
}
/** Every note of the editor fixture (templates and trash included: they are notes of the fixture too). */
export function editorFixture(): [string, string][] {
  const root = resolve(REPO, 'tests/fixtures/vaults/editor');
  const out: [string, string][] = [];
  const all = (d: string) => {
    for (const n of readdirSync(d)) {
      const p = join(d, n);
      if (statSync(p).isDirectory()) all(p);
      else if (n.endsWith('.md')) out.push([relative(REPO, p), readFileSync(p, 'utf8')]);
    }
  };
  all(root);
  return out.sort();
}

/** Start position of top-level node `k` of the editor document (ADR 0002: one node per body block). */
export function blockStart(ed: TeggEditor, k: number): number {
  const doc = ed.view.state.doc;
  assert.ok(k < doc.childCount, `editor document has ${doc.childCount} top-level blocks, wanted block index ${k}`);
  let pos = 0;
  for (let i = 0; i < k; i++) pos += doc.child(i).nodeSize;
  return pos;
}

/** Puts a collapsed caret at text offset `offset` of the first textblock inside top-level node `k` (or its end). */
export function caret(ed: TeggEditor, k: number, offset: number | 'end' = 'end') {
  const start = blockStart(ed, k);
  const node = ed.view.state.doc.child(k);
  let target: number | null = null;
  node.descendants((n: any, p: number) => {
    if (target !== null) return false;
    if (n.isTextblock) {
      const base = start + 1 + p + 1;
      target = offset === 'end' ? base + n.content.size : base + Math.min(offset, n.content.size);
      return false;
    }
    return true;
  });
  if (node.isTextblock) target = offset === 'end' ? start + node.nodeSize - 1 : start + 1 + offset;
  assert.ok(target !== null, `block ${k} has no text position`);
  const Sel = ed.view.state.selection.constructor as any;
  ed.view.dispatch(ed.view.state.tr.setSelection(Sel.near(ed.view.state.doc.resolve(target))));
}

/** Selects `text` inside top-level node `k` (first occurrence) as a text selection. */
export function selectText(ed: TeggEditor, k: number, text: string) {
  const start = blockStart(ed, k);
  const node = ed.view.state.doc.child(k);
  let from = -1;
  node.descendants((n: any, p: number) => {
    if (from >= 0) return false;
    if (n.isText) {
      const i = (n.text as string).indexOf(text);
      if (i >= 0) from = start + 1 + p + i;
    }
    return true;
  });
  assert.ok(from >= 0, `"${text}" not found in block ${k}`);
  const TextSel = Object.getPrototypeOf(ed.view.state.selection).constructor as any;
  const Sel = typeof TextSel.create === 'function' ? TextSel : null;
  assert.ok(Sel, 'TextSelection.create not reachable from the editor state');
  ed.view.dispatch(ed.view.state.tr.setSelection(Sel.create(ed.view.state.doc, from, from + text.length)));
}

/** Types `text` one character at a time through the view's `handleTextInput` (input rules), as a user would. */
export function type(ed: TeggEditor, text: string) {
  for (const ch of text) {
    const { from, to } = ed.view.state.selection;
    const handled = ed.view.someProp('handleTextInput', (f: any) => f(ed.view, from, to, ch));
    if (!handled) ed.view.dispatch(ed.view.state.tr.insertText(ch, from, to));
  }
}

/** Presses a key through the view's `handleKeyDown` (keymaps), e.g. 'Enter', 'Backspace'. */
export function press(ed: TeggEditor, key: string, mods: { shift?: boolean; meta?: boolean } = {}) {
  const ev = new KeyboardEvent('keydown', { key, shiftKey: !!mods.shift, metaKey: !!mods.meta, bubbles: true, cancelable: true });
  ed.view.someProp('handleKeyDown', (f: any) => f(ed.view, ev));
}

/** The body after the frontmatter, using @tegg/doc. */
export async function body(text: string): Promise<string> {
  const { parse } = await import('@tegg/doc');
  return text.slice(parse(text).bodyStart);
}
export async function blocksRaw(text: string): Promise<string[]> {
  const { parse } = await import('@tegg/doc');
  return parse(text).blocks.map((b) => b.raw);
}
/** Frontmatter lines other than `modified:`. */
export async function frontWithoutModified(text: string): Promise<string> {
  const { parse } = await import('@tegg/doc');
  const d = parse(text);
  const fm = d.frontmatter ? text.slice(d.frontmatter.range[0], d.frontmatter.range[1]) : '';
  return fm.split(/\r?\n/).filter((l) => !/^modified:/.test(l)).join('\n');
}
