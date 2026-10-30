// The note editors' link actions for the palette (R106: `Show preview`, `Edit link`, `Remove link`; D-927, D-928): the
// editor with the focus (the note's, or an embedded note's, FR-LNK-13 AC-8) registers what it can do with the chip at
// its caret. Nothing happens without a chip there (FR-UX-03 AC-19).
import { setEditorProbe } from './store';

export type EditorLinks = {
  /** Whether the caret is directly before or after a chip (or a chip is selected). */
  atChip(): boolean;
  preview(): void;
  edit(): void;
  remove(): void;
  /** The editor's element (`data-link-host`). */
  host?: HTMLElement;
};

const editors = new Set<EditorLinks>();
let last: EditorLinks | null = null;

/** Registers an editor; `focused` marks it as the one the palette acts on. Returns the unregister function. */
export function registerEditorLinks(e: EditorLinks): { focused(): void; dispose(): void } {
  editors.add(e);
  return {
    focused: () => { last = e; },
    dispose: () => { editors.delete(e); if (last === e) last = null; },
  };
}

function active(): EditorLinks | null {
  const el = typeof document !== 'undefined' ? document.activeElement : null;
  // The innermost editor holding the focus (an editor can take it before it registers, e.g. on open), else the last.
  const holding = [...editors].filter((e) => e.host && el && e.host.contains(el));
  const inner = holding.find((e) => !holding.some((o) => o !== e && e.host!.contains(o.host!)));
  const e = inner ?? (last && editors.has(last) ? last : null);
  return e && e.atChip() ? e : null;
}

/** Runs the action on the focused editor's chip at the caret; false when there is none. */
export function editorLinkAction(kind: 'edit' | 'remove' | 'preview'): boolean {
  const e = active();
  if (!e) return false;
  if (kind === 'edit') e.edit();
  else if (kind === 'remove') e.remove();
  else e.preview();
  return true;
}

setEditorProbe(() => {
  const e = active();
  return e ? () => e.preview() : null;
});
