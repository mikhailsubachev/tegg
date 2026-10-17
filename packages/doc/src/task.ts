// Slice 5A-1: task value writes (docs/contracts/ms5-tasks.md §5; D-82 one text engine, D-230, D-472, D-478).
// Stubs until 5A-1 is built: they return `null` (nothing to write), a deliberately wrong result, so the red tests fail
// on their assertions (TS-I1).

export type TaskState = 'open' | 'in-progress' | 'done' | 'cancelled'

export type TaskChange =
  | { kind: 'status'; to: string; toState: TaskState; fromState: TaskState; firstOpen: string; now: string }
  | { kind: 'priority'; to: string | null }
  | { kind: 'due'; to: string | null }
  | { kind: 'moveTag'; from: string | null; to: string }

/** The defs `completeTask` needs (the `TaskDefsDto` shape of ms5-tasks §3). */
export type TaskDefsLike = {
  statuses: { label: string; color: string | null; state: TaskState; stateRaw: string | null }[]
  priorities: { label: string; color: string | null }[]
  unknownStates: { label: string; state: string | null }[]
}

/** One change of a task file; `null` when there is nothing to write. Stub: always `null`. */
export function applyTaskChange(_text: string, _change: TaskChange): { text: string; inlineKept: boolean } | null {
  return null
}

/** The checkbox (D-472): check = the first Done-state status, uncheck = the first Open-state status. Stub: `null`. */
export function completeTask(_text: string, _defs: TaskDefsLike, _done: boolean, _now: string): string | null {
  return null
}
