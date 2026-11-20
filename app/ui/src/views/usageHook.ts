// Slice Q2.1: the test hook `window.__TEGG_TEST__.usages()` (docs/contracts/v1-views.md §21.1; L5, L6 with TEGG_TEST=1):
// every mounted usage (a view tab's panel, a block, the query page's block), in document order. The tab panel, the
// query block and the query page register what they show; the hook reads them when asked.

export type MountedUsage = {
  key: string; kind: 'tab' | 'block' | 'page'; name: string;
  ownSort: boolean | 'broken'; ownColumns: boolean | 'broken'; editable: boolean;
};

const mounted = new Set<{ el: () => HTMLElement | null; info: () => MountedUsage }>();

/** Registers a mounted usage (its root element and its current state); the returned function unregisters it. */
export function registerUsage(el: () => HTMLElement | null, info: () => MountedUsage): () => void {
  const entry = { el, info };
  mounted.add(entry);
  return () => { mounted.delete(entry); };
}

/** The mounted usages in document order. */
export function mountedUsages(): MountedUsage[] {
  const live = [...mounted].map((m) => ({ el: m.el(), info: m.info() })).filter((m): m is { el: HTMLElement; info: MountedUsage } => !!m.el && m.el.isConnected);
  live.sort((a, b) => (a.el === b.el ? 0 : a.el.compareDocumentPosition(b.el) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
  return live.map((m) => m.info);
}

function installHook(): void {
  if (typeof window === 'undefined') return;
  const w = window as { __TEGG_TEST__?: Record<string, unknown> };
  w.__TEGG_TEST__ = { ...(w.__TEGG_TEST__ ?? {}), usages: mountedUsages };
}
installHook();
