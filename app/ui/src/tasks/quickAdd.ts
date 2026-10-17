// Slice 5A-1: quick-add parsing (docs/contracts/ms5-tasks.md §6.4; D-380, D-483). Pure. Stub until 5A-1 is built: a
// deliberately wrong result (empty title, no tokens) so the red tests fail on their assertions (TS-I1).

export type QuickAddToken = { kind: 'due' | 'priority' | 'tag'; word: string };
export type QuickAdd = { title: string; due: string | null; priority: string | null; tags: string[]; tokens: QuickAddToken[] };

export function parseQuickAdd(_text: string, _ctx: { today: string; priorities: string[]; dateWords?: Record<string, string> }): QuickAdd {
  return { title: '', due: null, priority: null, tags: [], tokens: [] };
}
