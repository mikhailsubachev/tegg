// Fake core, slice Q2-T (docs/contracts/v1-views.md §25, §31.1): the default task views (R202), the migration
// (`Core::task_views_migrate`, §25.2) and `task_views_restore` (§25.3) over the fake's in-memory files, in Node. The
// default files' bytes are fake-queries.ts's `queryCreateText` of `defaultTaskView(name)`; the `views:` write is
// fake-schema.ts's `type_patch` (the same minimal write as the core's `SetViews`). Test code, not product code.
import { handle as schemaHandle, listTypes, type VersionDto } from './fake-schema';
import { QUERIES_DIR, findLive, nameKey, queryCreateText, type QueryDefDto } from './fake-queries';

type Files = Record<string, string>;
const TASK_YML = '.tegg/types/task.yml';
export const TASK_VIEW_NAMES = ['Schedule', 'Kanban'] as const;

/** §25.1: R202's def of `Schedule` or `Kanban` (null for any other name). */
export function defaultTaskView(name: string): QueryDefDto | null {
  if (name !== 'Schedule' && name !== 'Kanban') return null;
  const schedule = name === 'Schedule';
  return {
    title: name, types: ['task'], match: 'all',
    filters: [{ kind: 'filter', key: 'status', op: 'state_is_not', value: 'cancelled', src: null }],
    sort: [{ by: 'due', order: 'asc' }, { by: 'priority', order: 'asc' }], limit: 50, view: 'board',
    groupBy: schedule ? 'due' : 'status', groupPeriod: schedule, lanes: schedule ? 'horizontal' : 'vertical', laneOrder: null,
    doneLane: { withinDays: 7, folded: schedule }, columns: [],
  };
}

type Answer = { result?: unknown; error?: Record<string, unknown>; writes?: Record<string, string | null> };
const err = (kind: string, message: string, extra: Record<string, unknown> = {}) => ({ kind, message: `fake: ${message}`, ...extra });
const taskType = (files: Files, vers: Record<string, VersionDto>) => listTypes(files, vers).find((t) => t.key === 'task') as any;

/** The default files missing as live queries (§25.2 step 2): `{ path: text }` in R202 order. */
function creates(files: Files, now: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of TASK_VIEW_NAMES) {
    if (findLive(files, name)) continue;
    out[`${QUERIES_DIR}/${name}.yml`] = queryCreateText(defaultTaskView(name)!, now);
  }
  return out;
}

async function setViews(files: Files, vers: Record<string, VersionDto>, base: VersionDto | null, names: string[]): Promise<Answer> {
  return (await schemaHandle('type_patch', { key: 'task', base, ops: [{ op: 'views', names }] }, files, vers)) as Answer;
}

/** §25.2: `NotNeeded` (a `views` key), `Skipped` (Newer, invalid, unreadable `views`), `Done`, or `Stopped`. */
export async function migrate(files: Files, vers: Record<string, VersionDto>, now: string): Promise<Answer> {
  const t = taskType(files, vers);
  const exists = files[TASK_YML] !== undefined;
  if (exists && (!t || t.state === 'newer' || t.state === 'invalid' || t.invalid || t.viewsUnreadable)) return { result: { kind: 'Skipped' } };
  if (exists && t.views !== null) return { result: { kind: 'NotNeeded' } };
  const made = creates(files, now);
  const after = { ...files, ...made };
  const r = await setViews(after, vers, exists ? vers[TASK_YML] ?? null : null, [...TASK_VIEW_NAMES]);
  if (r.error) return { result: { kind: 'Stopped', created: Object.keys(made), reason: String(r.error.kind) }, writes: made };
  return { result: { kind: 'Done', created: Object.keys(made), views: [...TASK_VIEW_NAMES] }, writes: { ...made, ...(r.writes ?? {}) } };
}

/** §25.3: the missing default files, then `views:` (Schedule first, Kanban right after it). */
export async function restore(files: Files, vers: Record<string, VersionDto>, base: VersionDto | null, now: string): Promise<Answer> {
  const t = taskType(files, vers);
  if (!t) return { error: err('UnknownType', 'no type task') };
  if (t.state === 'newer') return { error: err('NewerVersion', 'made by a newer version') };
  if (t.state === 'invalid' || t.invalid) return { error: err('InvalidType', 'invalid type definition') };
  if (t.viewsUnreadable) return { error: err('Rule', 'rule: viewsUnreadable', { reason: 'viewsUnreadable' }) };
  const names: string[] = Array.isArray(t.views) ? [...t.views] : [];
  const listed = (n: string) => names.some((x) => nameKey(x) === nameKey(n));
  if (TASK_VIEW_NAMES.every((n) => listed(n) && findLive(files, n))) return { error: err('NothingToDo', 'both default views are there') };
  const made = creates(files, now);
  const after = { ...files, ...made };
  const out = [...names];
  if (!listed('Schedule')) out.unshift('Schedule');
  if (!listed('Kanban')) out.splice(out.findIndex((x) => nameKey(x) === nameKey('Schedule')) + 1, 0, 'Kanban');
  const changed = out.length !== names.length;
  let writes: Record<string, string | null> = { ...made };
  let type = t;
  if (changed) {
    const r = await setViews(after, vers, base, out);
    if (r.error) return { error: r.error, writes: made };
    writes = { ...writes, ...(r.writes ?? {}) };
    type = r.result ?? t;
  }
  return { result: { created: Object.keys(made), names: changed ? out : null, before: t.viewsSource ?? null, type }, writes };
}

export async function handle(cmd: string, a: any, files: Files, vers: Record<string, VersionDto>): Promise<Answer> {
  switch (cmd) {
    case 'task_views_migrate': return migrate(files, vers, String(a.now));
    case 'task_views_restore': return restore(files, vers, a.base ?? null, String(a.now));
    default: return { error: err('Io', `unknown command ${cmd}`) };
  }
}
