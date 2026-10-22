// FR-NAV-04 AC-2 (D-554): the sidebar's Inbox count follows the Inbox query (not the page's filter): read on open and
// on every vault change, and pushed by the shell's `inbox:count` event (§7.1).
import { useEffect, useState } from 'react';
import { events, ipc } from '../ipc/client';

export function useInboxCount(refresh: number, on: boolean): number {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!on) { setN(0); return; }
    let live = true;
    ipc.inboxCount().then((c) => { if (live) setN(c); }, () => {});
    return () => { live = false; };
  }, [refresh, on]);
  useEffect(() => {
    const off = events.inboxCount(setN);
    return () => { void off.then((f) => f()); };
  }, []);
  return n;
}
