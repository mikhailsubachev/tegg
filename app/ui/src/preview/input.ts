// What an input on a reference does (previews.md R103; docs/contracts/v1-previews.md §3.1): the one source of the
// table, so surfaces never branch on the preview mode themselves (contract §11.4).
import type { PreviewMode } from './types';

export type RefKind = 'chip' | 'row' | 'card' | 'figure';
export type RefInput = 'click' | 'dblclick' | 'modClick' | 'modDblclick' | 'enter' | 'modEnter' | 'altSpace' | 'hoverRest' | 'contextmenu';
export type RefAction = 'preview' | 'open' | 'menu' | 'createOffer' | 'none' | 'default';

function resolved(mode: PreviewMode, kind: RefKind, input: RefInput): RefAction {
  const click: RefAction = mode === 'click' ? 'preview' : 'open';
  if (kind === 'figure') {
    // D-938: a figure keeps D-622 (a click selects it; ⏎ and the right-click are its own); ⌘ inputs and a
    // double-click open the object; ⌥Space on the selected figure previews; no hover preview.
    if (input === 'altSpace') return 'preview';
    if (input === 'hoverRest') return 'none';
    if (input === 'click' || input === 'enter' || input === 'contextmenu') return 'default';
    return 'open';
  }
  switch (input) {
    case 'click': return click;
    case 'enter': return kind === 'chip' ? click : 'open'; // D-929
    case 'hoverRest': return mode === 'hover' ? 'preview' : 'none';
    case 'altSpace': return 'preview'; // D-928: in every mode
    case 'contextmenu': return kind === 'chip' ? 'menu' : 'default'; // FR-LNK-13 AC-5
    default: return 'open'; // double-click and the ⌘ inputs (D-925)
  }
}

export function resolveRefInput(mode: PreviewMode, kind: RefKind, input: RefInput, broken: boolean): RefAction {
  const a = resolved(mode, kind, input);
  if (!broken) return a;
  // D-939: a broken reference never previews; what would preview or open offers Create; ⌥Space does nothing.
  if (input === 'altSpace') return 'none';
  return a === 'preview' || a === 'open' ? 'createOffer' : a;
}
