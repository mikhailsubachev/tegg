// Slice AND-3 (docs/contracts/android-edit.md §4.1, §5.1): the phone's access to the editor package's `formatState`.
// Issue 185: imported directly (the by-name lookup was a red-test shim); the bar calls `TeggEditor.commands` itself.
import { formatState, type FormatState, type TeggEditor } from '@tegg/editor';

export type { FormatState };

/** `formatState(ed.view.state)` (§4.1). */
export function formatStateOf(ed: TeggEditor): FormatState {
  return formatState(ed.view.state);
}
