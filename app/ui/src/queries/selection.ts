// Slice Q (v1-queries §4.6): the note's selected query block, for `Edit query` in the palette (`queryStatus`) and ⌘↩.
export type SelectedBlock = { name: string | null; editable: boolean; edit: () => void };
let selected: SelectedBlock | null = null;
export function setSelectedQueryBlock(b: SelectedBlock | null) { selected = b; }
export function clearSelectedQueryBlock(b: SelectedBlock) { if (selected === b) selected = null; }
export function selectedQueryBlock(): SelectedBlock | null { return selected; }
