// Slice OL (docs/contracts/v1-outline.md §3.4; outline.md R172, D-1609, D-1610): the jump to a heading from the tab,
// the rail, the card or the keyboard: the Back entry, the flash's timers, closing the card. Writes nothing.
import type { Caret } from '../shell/history';
import { FLASH_FADE_MS, FLASH_MS } from './model';
import { closeCard, getOutline } from './store';

export type JumpHost = {
  /** The centre pane's scroller. */
  main(): HTMLElement | null;
  /** The editor's selection (with `follow`), or null outside the editor. */
  caret(): Caret | null;
  /** History (ms3-shell §12.1 amended, §4): the jump's entry on the current route. */
  pushPlace(from: { scrollTop: number; caret: Caret | null }, to: { scrollTop: number; caret: Caret | null }): void;
};
let host: JumpHost | null = null;
export function setJumpHost(h: JumpHost | null): void { host = h; }

const sameCaret = (a: Caret | null, b: Caret | null) => (a?.anchor ?? null) === (b?.anchor ?? null) && (a?.head ?? null) === (b?.head ?? null);

/** Jumps to heading `index` of the current source (§3.4 steps 1–7). */
export function jump(index: number, via: 'tab' | 'rail' | 'card' | 'key'): void {
  void via;
  const src = getOutline();
  if (!src || !src.tree[index]) return;
  const main = host?.main() ?? null;
  const before = { scrollTop: main?.scrollTop ?? 0, caret: host?.caret() ?? null };
  if (src.jump(index, src.version) === 'stale') {
    // Step 2 (D-1644): nothing moves; the outline is refreshed at once, even while a test holds it.
    src.refresh();
    return;
  }
  closeCard();
  const after = { scrollTop: main?.scrollTop ?? 0, caret: host?.caret() ?? null };
  if (Math.abs(after.scrollTop - before.scrollTop) > 1 || !sameCaret(before.caret, after.caret)) host?.pushPlace(before, after);
}

// ------------------------------------------------------------------------------------------------ the flash (step 5)

let timers: ReturnType<typeof setTimeout>[] = [];
let off: (() => void) | null = null;
const reduce = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** `data-outline-flash` for FLASH_MS, then `data-outline-fade` for FLASH_FADE_MS (none under Reduce motion), then
 *  nothing. A second flash clears the first at once. */
export function startFlash(apply: (phase: 'on' | 'fade' | 'off') => void): void {
  stopFlash();
  apply('on');
  off = () => apply('off');
  timers.push(setTimeout(() => {
    if (reduce()) { stopFlash(); return; }
    apply('fade');
    timers.push(setTimeout(stopFlash, FLASH_FADE_MS));
  }, FLASH_MS));
}
export function stopFlash(): void {
  for (const t of timers) clearTimeout(t);
  timers = [];
  const f = off;
  off = null;
  f?.();
}
