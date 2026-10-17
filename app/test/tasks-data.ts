// Test data for the MS5 slice 5A-1 L1/L2 tests: the task rows (`TaskRowDto`, docs/contracts/ms5-tasks.md §3) the core's
// task query returns for tests/fixtures/vaults/tasks, written by hand from the fixture README and R44 (the expected
// query result, not computed by product code), plus the Task type's definitions as shipped (new-empty task.yml).
// No assertions here.
import type { TaskDefsDto, TaskRowDto } from '../ui/src/ipc/types';

export type State = 'open' | 'in-progress' | 'done' | 'cancelled';
const VERSION = { mtimeNs: '1', size: 1, hash: '00000000' };

export const STATUS_OPTIONS: { label: string; color: string; state: State }[] = [
  { label: 'To do', color: 'gray', state: 'open' },
  { label: 'In progress', color: 'blue', state: 'in-progress' },
  { label: 'Waiting', color: 'yellow', state: 'open' },
  { label: 'Done', color: 'green', state: 'done' },
  { label: 'Cancelled', color: 'red', state: 'cancelled' },
];
export const PRIORITY_OPTIONS = [
  { label: 'High', color: 'red' },
  { label: 'Medium', color: 'orange' },
  { label: 'Low', color: 'blue' },
  { label: 'None', color: 'gray' },
];
export function defs(statuses = STATUS_OPTIONS, priorities = PRIORITY_OPTIONS): TaskDefsDto {
  return {
    statuses: statuses.map((s) => ({ label: s.label, color: s.color, state: s.state, stateRaw: s.state })),
    priorities: priorities.map((p) => ({ label: p.label, color: p.color, state: null })),
    unknownStates: [],
  } as unknown as TaskDefsDto;
}

const isDate = (s: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  return mo >= 1 && mo <= 12 && d >= 1 && d <= new Date(Date.UTC(y, mo, 0)).getUTCDate();
};

export type RowSpec = {
  path: string; status?: string | null; priority?: string | null; due?: string | null; completed?: string | null; tags?: string[]; fmTags?: string[];
  source?: string | null; excerpt?: string; modified?: string; created?: string; id?: string;
};
/** A `TaskRowDto` as R44 derives it from the given raw values (state from the shipped options). */
export function row(s: RowSpec, statuses = STATUS_OPTIONS, priorities = PRIORITY_OPTIONS): TaskRowDto {
  const opt = statuses.find((o) => o.label === s.status);
  const rank = priorities.findIndex((p) => p.label === s.priority);
  const title = s.path.split('/').pop()!.replace(/\.md$/, '').normalize('NFC');
  return {
    path: s.path.normalize('NFC'), id: s.id ?? null, title, status: s.status ?? null, state: (opt?.state ?? 'open'), statusKnown: s.status == null || !!opt,
    priority: s.priority ?? null, priorityRank: rank < 0 ? priorities.length : rank, dueRaw: s.due ?? null, due: s.due && isDate(s.due) ? s.due : null,
    completed: s.completed ?? null, tags: s.tags ?? s.fmTags?.map((t) => t.normalize('NFC').toLowerCase()) ?? [], fmTags: s.fmTags ?? [],
    source: s.source ? { target: s.source, kind: 'note', path: `Pages/${s.source}.md`, title: s.source, type: 'page' } : null,
    excerpt: s.excerpt ?? '', created: s.created ?? '2026-10-01T09:00:00+02:00', modified: s.modified ?? '2026-10-01T09:00:00+02:00',
    version: VERSION, readOnly: false,
  } as unknown as TaskRowDto;
}

export const P = {
  T01: 'Tasks/Zavolat Janě.md', T02: 'Tasks/Poslat rozpočet.md', T03: 'Tasks/Zalít květiny.md', T04: 'Tasks/Koupit dárek.md', T05: 'Tasks/Úklid garáže.md',
  T06: 'Tasks/Příprava prezentace.md', T07: 'Tasks/Obnovit pas.md', T08: 'Tasks/Přečíst knihu.md', T09: 'Tasks/Opravit kolo.md', T10: 'Tasks/Zaplatit fakturu.md',
  T11: 'Tasks/Objednat lístky.md', T12: 'Tasks/Vrátit knihy.md', T13: 'Tasks/Zrušená cesta.md', T14: 'Tasks/Bez stavu.md', T15: 'Tasks/Cizí stav.md',
  T16: 'Tasks/Špatné datum.md', T17: 'Tasks/S časem.md', T18: 'Tasks/Štítek v textu.md', T19: 'Tasks/Nákup.md',
} as const;
export type Key = keyof typeof P;

/** The 19 rows of the fixture (R44). */
export function fixtureRows(): TaskRowDto[] {
  return [
    row({ path: P.T01, status: 'To do', priority: 'High', due: '2026-10-09', fmTags: ['práce'], source: 'Porada', excerpt: 'Domluvit schůzku na příští týden.' }),
    row({ path: P.T02, status: 'In progress', priority: 'Medium', due: '2026-10-13', fmTags: ['práce', 'finance'], tags: ['finance', 'práce'] }),
    row({ path: P.T03, status: 'To do', priority: 'Low', due: '2026-10-14', fmTags: ['doma'] }),
    row({ path: P.T04, status: 'Waiting', due: '2026-10-15', fmTags: ['doma'], excerpt: 'Něco k narozeninám.' }),
    row({ path: P.T05, status: 'To do', priority: 'Medium', due: '2026-10-18', fmTags: ['Doma'], tags: ['doma'] }),
    row({ path: P.T06, status: 'To do', priority: 'High', due: '2026-10-19', fmTags: ['práce'] }),
    row({ path: P.T07, status: 'To do', priority: 'None', due: '2026-12-01' }),
    row({ path: P.T08, status: 'To do', priority: 'Medium', fmTags: ['čtení'] }),
    row({ path: P.T09, status: 'In progress' }),
    row({ path: P.T10, status: 'Done', priority: 'High', due: '2026-10-14', completed: '2026-10-14T09:30:00+02:00', fmTags: ['finance'], modified: '2026-10-14T09:30:00+02:00' }),
    row({ path: P.T11, status: 'Done', due: '2026-10-06', completed: '2026-10-05T18:00:00+02:00' }),
    row({ path: P.T12, status: 'Done', modified: '2026-10-10T08:00:00+02:00' }),
    row({ path: P.T13, status: 'Cancelled', due: '2026-10-10' }),
    row({ path: P.T14, due: '2026-10-14' }),
    row({ path: P.T15, status: 'Rozpracováno', due: '2026-10-16' }),
    row({ path: P.T16, status: 'To do', due: '2026-02-30' }),
    row({ path: P.T17, status: 'To do', due: '2026-10-15T09:00:00+02:00' }),
    row({ path: P.T18, status: 'To do', fmTags: ['práce'], tags: ['práce', 'rodina'], excerpt: 'Zeptat se #rodina na termín.' }),
    row({ path: P.T19, status: 'To do', due: '2026-10-15', fmTags: ['doma'.normalize('NFD')], tags: ['doma'] }),
  ];
}
/** Tag key → spelling (D-185) for the fixture's open tasks. */
export const SPELLING = new Map([['čtení', 'čtení'], ['doma', 'doma'], ['finance', 'finance'], ['práce', 'práce'], ['rodina', 'rodina']]);
