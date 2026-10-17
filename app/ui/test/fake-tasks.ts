// Fake core twin of the 5A-1 task queries (docs/contracts/ms5-tasks.md §2, §7): `task_list` and `daily_tasks` over the
// in-memory files, in Node with the real @tegg/doc and @tegg/schema. Test code, not product code. Stub until 5A-1 is
// built: empty answers, so the L5 tests fail on their assertions (TS-I1).
import type { Answer } from './fake-schema';

export type Files = Record<string, string>;

/** `task_list`: `{ tasks, defs }` (TaskListDto). Stub: no tasks, no definitions. */
export function taskList(_files: Files): { tasks: unknown[]; defs: { statuses: unknown[]; priorities: unknown[]; unknownStates: unknown[] } } {
  return { tasks: [], defs: { statuses: [], priorities: [], unknownStates: [] } };
}

/** `daily_tasks` (DailyTasksDto). Stub: empty. */
export function dailyTasks(_files: Files, _a: { date: string; start: string; end: string; today: string; limit: number }) {
  return { overdue: [] as unknown[], due: [] as unknown[], completed: [] as unknown[], total: 0 };
}

export async function handle(cmd: string, a: any, files: Files): Promise<Answer> {
  switch (cmd) {
    case 'task_list':
      return { result: taskList(files) };
    case 'daily_tasks':
      return { result: dailyTasks(files, a) };
    default:
      return { error: { kind: 'Io', message: `fake-tasks: unknown command ${cmd}` } };
  }
}
