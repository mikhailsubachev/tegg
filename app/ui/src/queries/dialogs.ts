// Slice Q (docs/contracts/v1-queries.md §4.2 `QueryDialogs.tsx`): the name dialogs, one at a time, rendered once by the
// App. `new`: R144's `New query` (create with `free: false`, then the query page with its editor); `saveAs`: an inline
// fence's `Save as query…` (prefilled, creates from the fence, then the caller rewrites the fence); `rename`: `Rename
// query` (the `query-rename` job).
import { useEffect, useState } from 'react';

export type NameDialogRequest =
  | { kind: 'new'; returnFocus?: HTMLElement | null }
  | { kind: 'saveAs'; initial: string; fence: string; onCreated: (name: string) => void; returnFocus?: HTMLElement | null }
  | { kind: 'rename'; name: string; title: string; returnFocus?: HTMLElement | null; onRenamed?: (name: string) => void };

let current: NameDialogRequest | null = null;
const subs = new Set<(r: NameDialogRequest | null) => void>();
export function openNameDialog(r: NameDialogRequest | null) { current = r; for (const f of subs) f(r); }
export function nameDialogOpen(): boolean { return current !== null; }
export function useNameDialog(): NameDialogRequest | null {
  const [s, setS] = useState(current);
  useEffect(() => { subs.add(setS); setS(current); return () => { subs.delete(setS); }; }, []);
  return s;
}
