// Slice Q (docs/contracts/v1-queries.md §4.2 `store.ts`, §2.2): the vault's saved queries (`queries_list`), read when a
// vault opens and again on `vault:changed` with a `.tegg/queries/` or `.trash/.tegg/queries/` path (debounced 300 ms),
// as tags/store.ts keeps the tags; and the Queries page's sort (§4.6, machine-local).
import { useEffect, useState } from 'react';
import { events, ipc } from '../ipc/client';
import type { QuerySummaryDto } from '../ipc/queries';

let list: QuerySummaryDto[] | null = null;
const subs = new Set<(l: QuerySummaryDto[] | null) => void>();
let listening = false;
let timer: ReturnType<typeof setTimeout> | null = null;
let loads = 0;
let vaultKey: string | null = null;

function publish(next: QuerySummaryDto[] | null) {
  list = next;
  for (const f of subs) f(next);
}

/** Reads the list again; an answer equal to the drawn one changes nothing. */
export function refreshQueries(): Promise<QuerySummaryDto[] | null> {
  const n = ++loads;
  return ipc.queriesList().then((r) => {
    if (n === loads && JSON.stringify(r) !== JSON.stringify(list)) publish(r);
    return r;
  }, () => list);
}

/** A path that changes the list (§2.2). */
export const isQueryPath = (p: string) => p.normalize('NFC').startsWith('.tegg/queries/') || p.normalize('NFC').startsWith('.trash/.tegg/queries/');

function listen() {
  if (listening) return;
  listening = true;
  void events.changed((c) => {
    if (!(c.paths ?? []).some(isQueryPath)) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { timer = null; void refreshQueries(); }, 300);
  }).catch(() => {});
}

/** The open vault (NFC path or null): a switch forgets the last vault's queries and reads the new ones. */
export function queriesForVault(path: string | null) {
  if (path === vaultKey) return;
  vaultKey = path;
  loads++;
  publish(null);
  if (path) { listen(); void refreshQueries(); }
}

export function queriesNow(): QuerySummaryDto[] | null {
  return list;
}

/** The vault's queries (null until the first answer). */
export function useQueries(): QuerySummaryDto[] | null {
  const [l, setL] = useState(list);
  useEffect(() => {
    subs.add(setL);
    listen();
    setL(list);
    return () => { subs.delete(setL); };
  }, []);
  return l;
}

export type QueriesSort = 'created-desc' | 'created-asc' | 'updated-desc' | 'updated-asc' | 'title';
export const SORTS: QueriesSort[] = ['created-desc', 'created-asc', 'updated-desc', 'updated-asc', 'title'];
export const SORT_LABEL: Record<QueriesSort, string> = {
  'created-desc': 'queries.sort.createdDesc', 'created-asc': 'queries.sort.createdAsc', 'updated-desc': 'queries.sort.updatedDesc',
  'updated-asc': 'queries.sort.updatedAsc', title: 'queries.sort.title',
};
