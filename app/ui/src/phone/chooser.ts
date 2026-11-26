// Slice AND-3 (docs/contracts/android-edit.md §10.3): the phone's type sheet in chooser mode. Search's `as…`, the `[[`
// panel's `Create “<q>” as…` and the Create offer's `Type` ask App to open the sheet; a row tap returns the type's key
// instead of navigating. Nothing is written by choosing.

type Handler = (onPick: (key: string) => void) => void;
let handler: Handler | null = null;

export function setTypeChooserHandler(h: Handler | null): void {
  handler = h;
}

/** Opens the type sheet; `onPick` gets the chosen key. False when no frame can show it (the desktop). */
export function chooseType(onPick: (key: string) => void): boolean {
  if (!handler) return false;
  handler(onPick);
  return true;
}
