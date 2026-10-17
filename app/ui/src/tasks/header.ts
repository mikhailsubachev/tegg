// Slice 5A-2 (ms5-tasks §11.5, D-497): the Task card's header fields from the task file's text, by the R44 rules of
// the task query (§2.1). Pure; the card computes it from the text the embed already loaded (§11.9 item 4).
// STUB (TS-I1): not built; returns deliberately wrong (empty) fields until 5A-2 is built.
import type { TaskDefsDto } from '../ipc/types';
import type { TaskState } from './views';

export type TaskHeader = {
  title: string;
  status: string | null;
  state: TaskState;
  statusKnown: boolean;
  priority: string | null;
  dueRaw: string | null;
  due: string | null;
  completed: string | null;
};

export function taskHeader(_text: string, _defs: TaskDefsDto): TaskHeader {
  return { title: '', status: null, state: 'cancelled', statusKnown: false, priority: null, dueRaw: null, due: null, completed: null };
}
