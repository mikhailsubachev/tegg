// Slice 5A-2 (ms5-tasks §11.5, D-497): the Task card's header fields from the task file's text, by the R44 rules of
// the task query (§2.1, crates/tegg-core/src/tasks5a.rs). Pure; the card computes it from the text the embed already
// loaded (§11.9 item 4), so a card needs no extra IPC.
import { parse } from '@tegg/doc';
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

const nfc = (s: string) => s.normalize('NFC');
/** One scalar value as written (NFC); lists, maps and null are no value. */
const scalar = (v: unknown): string | null => (typeof v === 'string' ? nfc(v) : typeof v === 'number' || typeof v === 'boolean' ? String(v) : null);

/** D-484: a valid calendar date `YYYY-MM-DD`, nothing else. */
function isDate(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  return mo >= 1 && mo <= 12 && d >= 1 && d <= new Date(Date.UTC(y, mo, 0)).getUTCDate();
}

export function taskHeader(text: string, defs: TaskDefsDto): TaskHeader {
  const fm = (parse(text).frontmatter?.data ?? {}) as Record<string, unknown>;
  const status = scalar(fm.status);
  const option = status === null ? undefined : defs.statuses.find((o) => o.label === status);
  const dueRaw = scalar(fm.due);
  return {
    title: scalar(fm.title)?.trim() ?? '',
    status,
    state: (option?.state ?? 'open') as TaskState, // D-471: missing or unknown → Open
    statusKnown: status === null || option !== undefined,
    priority: scalar(fm.priority),
    dueRaw,
    due: dueRaw !== null && isDate(dueRaw.trim()) ? dueRaw.trim() : null,
    completed: scalar(fm.completed),
  };
}
