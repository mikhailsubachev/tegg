// Slice MM3 (R233, mm-mindmap §7.5; D-2504): the palette's `Fold or unfold mindmap node` and `Add child to mindmap
// node` act on the focused node of the map that holds the focus, and do nothing elsewhere (no error). A map registers
// itself when its tree takes the focus; the registration ends when the focus goes anywhere but a map or a dialog (the
// palette, which gives the focus back to the map when it closes, D-139).
export type MapCommand = 'toggleFold' | 'addChild';
type Entry = { el: HTMLElement; run: (c: MapCommand) => void };

let active: Entry | null = null;
let listening = false;

function listen() {
  if (listening || typeof document === 'undefined') return;
  listening = true;
  document.addEventListener('focusin', (e) => {
    const t = e.target as Element | null;
    if (!active || !t?.closest) return;
    if (active.el.contains(t)) return;
    if (t.closest('[role="dialog"], [role="alertdialog"]')) return;
    active = null;
  }, true);
}

export function setActiveMap(el: HTMLElement, run: (c: MapCommand) => void): void {
  listen();
  active = { el, run };
}
export function clearActiveMap(el: HTMLElement): void {
  if (active?.el === el) active = null;
}
/** Runs `c` on the focused map, after the palette has given the focus back (D-139); nothing when no map has it. */
export function runMapCommand(c: MapCommand): void {
  setTimeout(() => {
    const a = active;
    if (a && a.el.isConnected) a.run(c);
  }, 0);
}
