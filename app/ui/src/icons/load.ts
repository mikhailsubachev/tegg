// Loading the icon set (docs/contracts/v1-cards.md §5.5): memoised, through a dynamic import so the set is its own
// chunk, loaded on the first picker open of a window. A failure is retried on the next call.
import type { IconSet } from './resolve';

let pending: Promise<IconSet> | null = null;

export function loadIconSet(): Promise<IconSet> {
  if (!pending) {
    pending = import('./lucide-icons').then((m) => m.ICON_SET);
    pending.catch(() => {
      pending = null;
    });
  }
  return pending;
}
