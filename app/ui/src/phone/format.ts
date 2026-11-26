// Slice AND-3 (docs/contracts/android-edit.md §4.1, §5.1): the phone's access to the editor package's `formatState` and
// the bar's commands. The package gains them in the same slice; until a build has them this reads them by name and
// reports null / false instead of failing to load.
import * as editorPkg from '@tegg/editor';
import type { TeggEditor } from '@tegg/editor';

export type FormatState = {
  block: 'paragraph' | 'heading' | 'bulletList' | 'orderedList' | 'checklist' | 'other';
  level: 1 | 2 | 3 | 4 | 5 | 6 | null;
  bold: boolean; italic: boolean; link: boolean;
  canIndent: boolean; canOutdent: boolean; canUndo: boolean; canRedo: boolean;
  editable: boolean;
};

const pkg = editorPkg as unknown as Record<string, unknown>;

/** `formatState(ed.view.state)` (§4.1), or null when the package doesn't have it. */
export function formatStateOf(ed: TeggEditor): FormatState | null {
  const f = pkg.formatState as ((s: unknown) => FormatState) | undefined;
  return typeof f === 'function' ? f(ed.view.state) : null;
}

type Commands = Record<string, ((...a: unknown[]) => boolean) | undefined>;

/** Runs one of `TeggEditor.commands` (§5.1) by name; false when it is missing or had no effect. */
export function runCommand(ed: TeggEditor, name: string, ...args: unknown[]): boolean {
  const c = (ed.commands as unknown as Commands)[name];
  return typeof c === 'function' ? !!c.apply(ed.commands, args) : false;
}
