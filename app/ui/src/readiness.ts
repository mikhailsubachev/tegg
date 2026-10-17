// In-UI note-ready signal, so marks that must follow it (ms4-daily §7 `daily-ready:<date>`) can wait for the open
// note's editor. NotePage calls noteReady() wherever it writes the `note-ready` mark.
let count = 0;
let waiters: Array<() => void> = [];

export const noteReadyCount = (): number => count;

export function noteReady(): void {
  count += 1;
  const w = waiters;
  waiters = [];
  for (const f of w) f();
}

/** Resolves once note-ready has fired more than `since` times. */
export function afterNoteReady(since: number): Promise<void> {
  return count > since ? Promise.resolve() : new Promise((r) => waiters.push(() => (count > since ? r() : void afterNoteReady(since).then(r))));
}
