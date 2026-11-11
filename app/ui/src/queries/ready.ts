// Slice Q (D-1503, NFR-PERF-05 AC-5): the performance mark `query-ready`, written once when every query block of the
// opened note has painted its first rows (or its state). Blocks register per host; when the last pending one paints,
// the mark is written; once all of a host's blocks unmount, opening the note again marks again.
import { ipc } from '../ipc/client';

type Host = { pending: Set<object>; all: Set<object>; marked: boolean };
const hosts = new Map<string, Host>();

export function blockMounted(host: string): { painted: () => void; unmount: () => void } {
  const h = hosts.get(host) ?? { pending: new Set<object>(), all: new Set<object>(), marked: false };
  hosts.set(host, h);
  const me = {};
  h.all.add(me);
  h.pending.add(me);
  const check = () => {
    if (h.marked || h.pending.size) return;
    // Siblings mount in the same frame: wait one frame so a block that is still mounting counts.
    requestAnimationFrame(() => {
      if (h.marked || h.pending.size) return;
      h.marked = true;
      void ipc.perfMark('query-ready').catch(() => {});
    });
  };
  return {
    painted: () => { if (h.pending.delete(me)) check(); },
    unmount: () => {
      h.pending.delete(me);
      h.all.delete(me);
      if (!h.all.size) hosts.delete(host);
      else check();
    },
  };
}
