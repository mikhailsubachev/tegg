// The `New <type>` dialog's commands (new-object-menu.md R238; contract §4; D-2515): `newObject.create` and
// `newObject.cancel` exist only while a dialog is open, so the palette never lists them elsewhere. The open dialog
// registers its handlers here; the shell's registry reads them and re-lists its commands when they change.
export type NewObjectHandlers = { create(): void; cancel(): void };

let current: NewObjectHandlers | null = null;
const subs = new Set<() => void>();

export function setNewObjectDialog(h: NewObjectHandlers | null): void {
  if (current === h) return;
  current = h;
  for (const f of subs) f();
}

export function newObjectDialog(): NewObjectHandlers | null {
  return current;
}

export function onNewObjectDialog(f: () => void): () => void {
  subs.add(f);
  return () => { subs.delete(f); };
}
