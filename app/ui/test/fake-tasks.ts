// Fake core twin of the 5A-1 task queries (docs/contracts/ms5-tasks.md §2, §7): `task_list` and `daily_tasks` over the
// in-memory files, in Node with the real @tegg/doc and @tegg/schema. Test code, not product code. The rules mirror
// crates/tegg-core/src/tasks5a.rs (R44, D-471, D-484, D-485).
import * as D from '@tegg/doc';
import * as S from '@tegg/schema';
import { inWindow, objectsWith, resolver, type Obj } from './fake-links';
import { listTypes, type Answer, type VersionDto } from './fake-schema';

export type Files = Record<string, string>;

const nfc = (s: string) => s.normalize('NFC');
const STATES = ['open', 'in-progress', 'done', 'cancelled'];
const NO_VERSION: VersionDto = { mtimeNs: '0', size: 0, hash: '' } as unknown as VersionDto;


const scalar = (v: unknown): string | null => (typeof v === 'string' ? nfc(v) : typeof v === 'number' || typeof v === 'boolean' ? String(v) : null);
function isDate(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  return mo >= 1 && mo <= 12 && d >= 1 && d <= new Date(Date.UTC(y, mo, 0)).getUTCDate();
}

/** The Rust `tegg_index::text::excerpt` rule: body start as plain text, ≤ 300 characters. */
export function excerpt(body: string): string {
  const out: string[] = [];
  let fence = false;
  let len = 0;
  for (const raw of body.split('\n')) {
    const line = raw.replace(/\r$/, '');
    const t = line.trimStart();
    if (t.startsWith('```') || t.startsWith('~~~')) { fence = !fence; continue; }
    if (fence || /^#+[ \t]/.test(t) || t.startsWith('|') || t.startsWith('<!--')) continue;
    let s = t.replace(/^(?:(?:> |[-*+] |\[[ xX]\] |\d+[.)] ))+/, '');
    if (/^!\[\[[^\]]*\]\]$/.test(s.trim())) continue;
    s = s.replace(/!?\[\[([^\]|]*)(?:\|([^\]]*))?\]\]/g, (m, a, b) => (m.startsWith('!') ? '' : (b ?? a)));
    s = s.replace(/!?\[([^\]]*)\]\([^)]*\)/g, (m, a) => (m.startsWith('!') ? '' : a));
    s = s.replace(/(\*\*|__|~~|==|`)/g, '').replace(/\s\^[A-Za-z0-9-]+\s*$/, '').trim();
    if (!s) continue;
    out.push(s);
    len += s.length + 1;
    if (len >= 300) break;
  }
  return [...out.join(' ')].slice(0, 300).join('');
}

type Ctx = { vers?: Record<string, VersionDto>; readOnly?: string[] };

function defsOf(files: Files) {
  const s = S as any;
  const task = (listTypes(files, {}) as any[]).find((t) => t.key === 'task');
  const attr = (k: string) => (task?.attributes ?? []).find((a: any) => a.key === k);
  const unknownStates: { label: string; state: string | null }[] = [];
  const statuses = (attr('status')?.options ?? []).map((o: any) => {
    const raw = o.state ?? null;
    if (!raw || !STATES.includes(raw)) unknownStates.push({ label: o.label, state: raw });
    return { label: o.label, color: o.color ?? null, state: s.taskState(o), stateRaw: raw };
  });
  const priorities = (attr('priority')?.options ?? []).map((o: any) => ({ label: o.label, color: o.color ?? null, state: o.state ?? null }));
  return { statuses, priorities, unknownStates };
}

function row(o: Obj, files: Files, defs: ReturnType<typeof defsOf>, resolve: ReturnType<typeof resolver>, all: Map<string, Obj>, ctx: Ctx) {
  const fm = o.attributes;
  const status = scalar(fm.status);
  const opt = status === null ? undefined : defs.statuses.find((x: any) => x.label === status);
  const priority = scalar(fm.priority);
  const rank = priority === null ? -1 : defs.priorities.findIndex((x: any) => x.label === priority);
  const dueRaw = scalar(fm.due);
  const due = dueRaw !== null && isDate(dueRaw.trim()) ? dueRaw.trim() : null;
  const fmTags = Array.isArray(fm.tags) ? fm.tags.map(scalar).filter((x: string | null): x is string => x !== null) : scalar(fm.tags) !== null ? [scalar(fm.tags)!] : [];
  const tags = [...new Set([...fmTags.map((t) => t.replace(/^#/, '')), ...(o.tags ?? [])].map((t) => nfc(t).toLowerCase()).filter(Boolean))].sort();
  const src = typeof fm.source === 'string' ? /^\[\[(.*)\]\]$/.exec(fm.source.trim())?.[1] ?? null : null;
  const r = src ? resolve(o.path, src) : null;
  const target = r && r.path ? all.get(r.path) : undefined;
  const text = files[o.path] ?? '';
  const bodyAt = /^---\r?\n[\s\S]*?\r?\n---\r?\n/.exec(text)?.[0].length ?? 0;
  return {
    path: o.path, id: o.id, title: o.title, status, state: opt?.state ?? 'open', statusKnown: status === null || opt !== undefined,
    priority, priorityRank: rank < 0 ? defs.priorities.length : rank, dueRaw, due, completed: scalar(fm.completed), tags, fmTags,
    source: src ? { target: src, kind: r!.kind === 'ignored' ? 'unresolved' : r!.kind, path: r!.path, title: target?.title ?? null, type: target?.type ?? null } : null,
    excerpt: excerpt(text.slice(bodyAt)), created: scalar(fm.created), modified: scalar(fm.modified),
    version: ctx.vers?.[o.path] ?? NO_VERSION, readOnly: (ctx.readOnly ?? []).includes(o.path),
  };
}

/** `task_list`: `{ tasks, defs }` (TaskListDto). */
export function taskList(files: Files, ctx: Ctx = {}) {
  const defs = defsOf(files);
  const objs = objectsWith(files, D, S);
  const resolve = resolver(objs);
  const all = new Map(objs.map((o) => [o.path, o]));
  return { tasks: objs.filter((o) => o.type === 'task').map((o) => row(o, files, defs, resolve, all, ctx)), defs };
}

/** `daily_tasks` (DailyTasksDto, D-485). */
export function dailyTasks(files: Files, a: { date: string; start: string; end: string; today: string; limit: number }, ctx: Ctx = {}) {
  const { tasks } = taskList(files, ctx);
  const open = (t: any) => t.state === 'open' || t.state === 'in-progress';
  const title = (x: any, y: any) => x.title.toLowerCase().localeCompare(y.title.toLowerCase()) || (x.path < y.path ? -1 : 1);
  const overdue = a.date === a.today ? tasks.filter((t) => open(t) && t.due !== null && t.due < a.today) : [];
  overdue.sort((x, y) => x.due!.localeCompare(y.due!) || x.priorityRank - y.priorityRank || title(x, y));
  const due = tasks.filter((t) => open(t) && t.due === a.date).sort((x, y) => x.priorityRank - y.priorityRank || title(x, y));
  const start = Date.parse(a.start), end = Date.parse(a.end);
  const completed = tasks
    .filter((t) => t.state === 'done' && t.completed)
    .map((t) => [inWindow(t.completed, a.date, start, end), t] as const)
    .filter((x) => x[0] !== null)
    .sort((x, y) => (y[0] as number) - (x[0] as number) || title(x[1], y[1]))
    .map((x) => x[1]);
  const total = overdue.length + due.length + completed.length;
  let left = Number(a.limit ?? 50);
  const take = (v: any[]) => { const n = Math.min(v.length, left); left -= n; return v.slice(0, n); };
  return { overdue: take(overdue), due: take(due), completed: take(completed), total };
}

export async function handle(cmd: string, a: any, files: Files, vers?: Record<string, VersionDto>, readOnly?: string[]): Promise<Answer> {
  const ctx = { vers, readOnly };
  switch (cmd) {
    case 'task_list':
      return { result: taskList(files, ctx) };
    case 'daily_tasks':
      return { result: dailyTasks(files, a, ctx) };
    default:
      return { error: { kind: 'Io', message: `fake-tasks: unknown command ${cmd}` } };
  }
}
