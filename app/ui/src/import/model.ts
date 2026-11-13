// Slice I2 (docs/contracts/v1-import-window.md §3): the Import window's pure model. The step machine and the stepper,
// the given-mapping edits, the 4a / 4b / 4c rows, the preview numbers, the phase list, the Done card and the error
// table. No IPC here: the store (store.ts) calls these with the latest plan.
import { t } from '../i18n/catalog';
import { collator } from '../i18n/collate';
import type {
  AttrMapping, AttrTarget, DoneCard, ImportErrorDto, ImportProgressDto, Mapping, Merge, Plan, PlannedAttr, PlannedType, ScanInfo, Split,
  TargetTypeDto, TypeMapping, TypeTarget,
} from '../ipc/import';
import { listJoin, num, tn } from './format';

export type Step = '0' | '1' | '2' | '3' | '4a' | '4b' | '4c' | '5' | '6' | '7';

// ------------------------------------------------------------------ steps (§3.3)

/** The stepper's number (1–6), or null on 0 and 7 (D-1542: `Step 3 of 6` also when the Space step was skipped). */
export function stepNumber(s: Step): number | null {
  return ({ '1': 1, '2': 2, '3': 3, '4a': 4, '4b': 4, '4c': 4, '5': 5, '6': 6 } as Record<string, number>)[s] ?? null;
}
export const STEP_LABELS = ['import.steps.source', 'import.steps.space', 'import.steps.where', 'import.steps.mapping', 'import.steps.preview', 'import.steps.import'];

/** `Continue` from `s` (§3.3). */
export function nextStep(s: Step, o: { spaces: number; decide: boolean }): Step | null {
  switch (s) {
    case '0': return '1';
    case '1': return o.spaces > 1 ? '2' : '3';
    case '2': return '3';
    case '3': return '4a';
    case '4a': return o.decide ? '4c' : '5';
    case '4c': return '5';
    default: return null;
  }
}
/** `Back` from `s` (§3.3). */
export function backStep(s: Step, o: { spaces: number; decide: boolean }): Step | null {
  switch (s) {
    case '2': return '1';
    case '3': return o.spaces > 1 ? '2' : '1';
    case '4a': return '3';
    case '4b': return '4a';
    case '4c': return '4a';
    case '5': return o.decide ? '4c' : '4a';
    default: return null;
  }
}

// ------------------------------------------------------------------ the given mapping (§3.5)

const clone = (m: Mapping): Mapping => JSON.parse(JSON.stringify(m)) as Mapping;
function typeEntry(m: Mapping, type: string): TypeMapping {
  m.types ??= {};
  return (m.types[type] ??= {});
}
function attrEntry(m: Mapping, type: string, key: string): AttrMapping {
  const t0 = typeEntry(m, type);
  t0.attributes ??= {};
  return (t0.attributes[key] ??= {});
}
/** Drops empty entries, so a mapping with nothing chosen is `{}`. */
function tidy(m: Mapping): Mapping {
  for (const [ty, tm] of Object.entries(m.types ?? {})) {
    for (const [k, a] of Object.entries(tm.attributes ?? {})) {
      if (a.values && Object.keys(a.values).length === 0) delete a.values;
      for (const f of ['to', 'merge', 'split'] as const) if (a[f] === undefined || a[f] === null) delete a[f];
      if (Object.keys(a).length === 0) delete tm.attributes![k];
    }
    if (tm.attributes && Object.keys(tm.attributes).length === 0) delete tm.attributes;
    if (tm.to === undefined || tm.to === null) delete tm.to;
    if (Object.keys(tm).length === 0) delete m.types![ty];
  }
  if (m.types && Object.keys(m.types).length === 0) delete m.types;
  if (m.caseLinks && m.caseLinks.length === 0) delete m.caseLinks;
  return m;
}
export function setTypeTarget(m: Mapping, type: string, to: TypeTarget): Mapping {
  const n = clone(m);
  typeEntry(n, type).to = to;
  return tidy(n);
}
export const renameNewType = (m: Mapping, type: string, name: string): Mapping => setTypeTarget(m, type, { kind: 'new', name });
export function setAttrTarget(m: Mapping, type: string, key: string, to: AttrTarget | null): Mapping {
  const n = clone(m);
  const a = attrEntry(n, type, key);
  if (to) a.to = to; else delete a.to;
  return tidy(n);
}
export function setMerge(m: Mapping, type: string, key: string, merge: Merge | null): Mapping {
  const n = clone(m);
  const a = attrEntry(n, type, key);
  if (merge) a.merge = merge; else delete a.merge;
  return tidy(n);
}
export function setSplit(m: Mapping, type: string, key: string, split: Split | null): Mapping {
  const n = clone(m);
  const a = attrEntry(n, type, key);
  if (split) a.split = split; else delete a.split;
  return tidy(n);
}
export function setStatusValue(m: Mapping, type: string, key: string, value: string, label: string): Mapping {
  const n = clone(m);
  const a = attrEntry(n, type, key);
  a.values = { ...(a.values ?? {}), [value]: label };
  return tidy(n);
}
export function setCaseLink(m: Mapping, note: string, target: string, use: boolean): Mapping {
  const n = clone(m);
  const list = (n.caseLinks ?? []).filter((c) => !(c.note === note && c.target === target));
  list.push({ note, target, use });
  n.caseLinks = list;
  return tidy(n);
}
/** 4c's `Select` (FR-IMP-21 AC-5): every listed tag-like attribute becomes a new select, or (off) loses that entry. */
export function toggleTagLike(m: Mapping, plan: Plan, on: boolean): Mapping {
  let n = clone(m);
  for (const tl of plan.decisions.tagLike) {
    if (on) {
      const pa = plannedType(plan, tl.sourceType)?.attributes.find((a) => a.sourceKey === tl.sourceKey);
      n = setAttrTarget(n, tl.sourceType, tl.sourceKey, { kind: 'new', name: pa?.name ?? tl.sourceKey, type: 'select' });
    } else n = setAttrTarget(n, tl.sourceType, tl.sourceKey, null);
  }
  return n;
}
/** Removes the entry an `InvalidMapping` names (§3.5). */
export function dropEntry(m: Mapping, entry: { sourceType: string; attribute?: string | null }): Mapping {
  const n = clone(m);
  const tm = n.types?.[entry.sourceType];
  if (!tm) return n;
  if (entry.attribute) delete tm.attributes?.[entry.attribute];
  else delete tm.to;
  return tidy(n);
}
export const isEmptyMapping = (m: Mapping) => Object.keys(tidy(clone(m))).length === 0;

// ------------------------------------------------------------------ 4a (§3.6)

const FIXED = new Set(['Page', 'Task', 'DailyNote', 'Image', 'PDF', 'Weblink', 'AIChat', 'Query']);
const MEDIA = new Set(['Image', 'PDF']);
export const plannedType = (plan: Plan, source: string) => plan.types.find((x) => x.sourceType === source);

/** A type row: one source type, or the media row (`Image` and `PDF` together), or the tag collections. */
export type TypeRowModel = {
  id: string; kind: 'type' | 'media' | 'tags'; types: PlannedType[];
  folder: string; count: number; target: string; menu: boolean;
  listed: { type: PlannedType; attr: PlannedAttr }[]; mapped: number; total: number; status: boolean;
};

const nameOfType = (key: string | null, fallback: string | null, targetTypes: TargetTypeDto[]) =>
  (key ? targetTypes.find((x) => x.key === key)?.name : undefined) ?? fallback ?? key ?? '';

/** 4b's listed attributes (D-1573): every planned attribute but `type` and `title`. */
export const listedAttrs = (ty: PlannedType) => ty.attributes.filter((a) => a.sourceKey !== 'type' && a.sourceKey !== 'title');

export function targetText(ty: PlannedType, targetTypes: TargetTypeDto[]): string {
  const tg = ty.target;
  if (tg.kind === 'skip') return t('import.types.skip');
  let s = tg.kind === 'new' ? `${tg.name} · ${t('import.types.new')}` : nameOfType(tg.key, ty.name, targetTypes);
  if (ty.sourceType === 'Weblink') s += ' · url';
  if (ty.sourceType === 'Query') s += ` · ${t('import.types.stub')}`;
  return s;
}

export function typeRows(plan: Plan, targetTypes: TargetTypeDto[]): TypeRowModel[] {
  const order = (s: string) => ({ Page: 0, Task: 1, DailyNote: 2 } as Record<string, number>)[s] ?? 3;
  const late = ['Weblink', 'AIChat', 'Query'];
  const users = plan.types.filter((x) => !MEDIA.has(x.sourceType) && !late.includes(x.sourceType));
  users.sort((a, b) => order(a.sourceType) - order(b.sourceType) || (order(a.sourceType) === 3 ? collator().compare(a.sourceType, b.sourceType) : 0));
  const row = (types: PlannedType[], kind: TypeRowModel['kind'], id: string): TypeRowModel => {
    const skip = types.every((x) => x.target.kind === 'skip');
    const listed = skip ? [] : types.flatMap((x) => listedAttrs(x).map((attr) => ({ type: x, attr })));
    const mapped = listed.filter((l) => !l.attr.needsLook).length;
    return {
      id, kind, types, folder: types.map((x) => x.sourceFolder).join(' · '), count: types.reduce((n, x) => n + x.objects, 0),
      target: kind === 'media' ? types.map((x) => nameOfType(x.key, x.name, targetTypes)).join(' · ') : targetText(types[0], targetTypes),
      menu: kind === 'type', listed, mapped, total: listed.length, status: listed.length > 0,
    };
  };
  const rows = users.map((x) => row([x], 'type', x.sourceType));
  const media = plan.types.filter((x) => MEDIA.has(x.sourceType));
  if (media.length) rows.push(row(media, 'media', 'media'));
  for (const s of late) { const x = plannedType(plan, s); if (x) rows.push(row([x], 'type', x.sourceType)); }
  const tags = plan.otherFiles.filter((f) => f.kind === 'tagCollection').length;
  if (tags > 0) {
    rows.push({ id: 'tags', kind: 'tags', types: [], folder: t('import.types.tagCollections'), count: tags, target: t('import.types.notExported'), menu: false, listed: [], mapped: 0, total: 0, status: false });
  }
  return rows;
}
export const statusText = (r: { mapped: number; total: number }) => tn('import.types.status', { mapped: r.mapped, total: r.total });

/** The hint under the table (§3.6), or null at 0. */
export function typesHint(rows: TypeRowModel[]): string | null {
  const open = rows.filter((r) => r.status && r.mapped < r.total);
  if (!open.length) return null;
  // A catalog text inside another one: in the pseudo-locale the outer ⟦ ⟧ covers it (NFR-OTH-02 AC-18).
  return tn('import.types.hint', { count: open.length, example: `${statusText(open[0]).replace(/[⟦⟧]/g, '')} ›` });
}

export type MenuItemModel =
  | { kind: 'note'; text: string }
  | { kind: 'radio'; id: string; text: string; checked: boolean; description?: string; group?: string; choose: TypeTarget | AttrTarget | null }
  | { kind: 'rename'; id: string };

/** The `<Source> becomes` menu (§3.6, D-1527 (6), D-1577). `deflt` is the type's default target (with `{}`). */
export function typeMenu(ty: PlannedType, deflt: TypeTarget | undefined, targetTypes: TargetTypeDto[]): MenuItemModel[] {
  const out: MenuItemModel[] = [];
  const cur = ty.target;
  const defaultNew = deflt?.kind === 'new';
  if (defaultNew) out.push({ kind: 'note', text: t('import.types.noMatch', { source: ty.sourceFolder }) });
  if (defaultNew && !FIXED.has(ty.sourceType)) {
    const name = cur.kind === 'new' ? cur.name : deflt.kind === 'new' ? deflt.name : ty.sourceType;
    out.push({ kind: 'radio', id: 'new', text: t('import.types.newType', { name }), checked: cur.kind === 'new', choose: { kind: 'new', name } });
    out.push({ kind: 'rename', id: 'rename' });
  }
  const system = new Set(['task', 'daily-note', 'image', 'pdf', 'quick-note', 'tag']);
  const defaultKey = deflt?.kind === 'existing' ? deflt.key : null;
  const allowed = targetTypes.filter((x) => x.key === 'page' || (!x.system && !system.has(x.key)) || x.key === defaultKey);
  allowed.sort((a, b) => collator().compare(a.name, b.name));
  const group = t('import.types.useExisting');
  for (const x of allowed) out.push({ kind: 'radio', id: `existing:${x.key}`, text: x.name, checked: cur.kind === 'existing' && cur.key === x.key, group, choose: { kind: 'existing', key: x.key } });
  const skipped = tn('import.types.skipped', { count: ty.objects });
  out.push({ kind: 'radio', id: 'skip', text: t('import.types.skip'), checked: cur.kind === 'skip', description: skipped, choose: { kind: 'skip' } });
  return out;
}

/** A new type name the window may send (§3.5): non-empty, and no type's name or plural nor another new type's name. */
export function newTypeNameOk(name: string, plan: Plan, source: string, targetTypes: TargetTypeDto[]): boolean {
  const n = name.normalize('NFC').trim().toLowerCase();
  if (!n) return false;
  for (const x of targetTypes) if (x.name.normalize('NFC').toLowerCase() === n || x.plural.normalize('NFC').toLowerCase() === n) return false;
  for (const x of plan.types) if (x.sourceType !== source && x.target.kind === 'new' && x.target.name.normalize('NFC').toLowerCase() === n) return false;
  return true;
}

// ------------------------------------------------------------------ 4b (§3.7)

export const KINDS = ['text', 'number', 'checkbox', 'date', 'date-time', 'date-range', 'select', 'relation'];
export const stateKey = (state: string) => (state === 'in progress' || state === 'in-progress' ? 'import.state.inProgress' : `import.state.${state}`);

/** The target control's text of an attribute row; null for a consumed key (text, no menu). */
export function attrTargetText(ty: PlannedType, a: PlannedAttr, targetTypes: TargetTypeDto[]): string {
  switch (a.action) {
    case 'consumed': return a.key ?? a.sourceKey;
    case 'keep': case 'rename': {
      const tt = targetTypes.find((x) => x.key === ty.key);
      return tt?.attributes.find((x) => x.key === a.key)?.name ?? a.name ?? a.key ?? a.sourceKey;
    }
    case 'new': return `${a.name ?? a.sourceKey} · ${t(`import.attrs.kind.${a.type ?? 'text'}`)}`;
    case 'drop': return t('import.attrs.skip');
    default: return t('import.types.none');
  }
}

export function attrsSummary(listed: { attr: PlannedAttr }[]): string {
  const total = listed.length;
  const mapped = listed.filter((l) => !l.attr.needsLook).length;
  if (mapped === total) return tn('import.types.status', { mapped, total });
  return tn('import.attrs.summary', { mapped, total, keys: listJoin(listed.filter((l) => l.attr.needsLook).map((l) => l.attr.sourceKey)) });
}

/** The `<key> becomes` menu of a non-consumed attribute (§3.7, D-1574). */
export function attrMenu(ty: PlannedType, a: PlannedAttr, targetTypes: TargetTypeDto[]): MenuItemModel[] {
  const out: MenuItemModel[] = [];
  const name = a.action === 'new' ? a.name ?? a.sourceKey : a.sourceKey;
  const kind = a.action === 'new' ? a.type ?? 'text' : null;
  out.push({ kind: 'radio', id: 'new', text: t('import.attrs.newAttr', { name }), checked: a.action === 'new', choose: { kind: 'new', name, type: kind ?? undefined } as AttrTarget });
  out.push({ kind: 'rename', id: 'rename' });
  const kg = t('import.attrs.kindGroup');
  for (const k of KINDS) out.push({ kind: 'radio', id: `kind:${k}`, text: t(`import.attrs.kind.${k}`), checked: a.action === 'new' && kind === k, group: kg, choose: { kind: 'new', name, type: k } });
  const tt = targetTypes.find((x) => x.key === ty.key);
  const ug = t('import.attrs.useExisting', { type: tt?.name ?? ty.name ?? '' });
  for (const x of tt?.attributes ?? []) {
    out.push({ kind: 'radio', id: `existing:${x.key}`, text: x.name, checked: (a.action === 'keep' || a.action === 'rename') && a.key === x.key, group: ug, choose: { kind: 'existing', key: x.key } });
  }
  out.push({ kind: 'radio', id: 'drop', text: t('import.attrs.skip'), checked: a.action === 'drop', choose: { kind: 'drop' } });
  return out;
}

/** The `{count}` of the `Values` chip: a Task status's values, else a select's options. */
export function valuesCount(ty: PlannedType, a: PlannedAttr): number {
  if (a.statuses.length) return a.statuses.length;
  return a.type === 'select' || a.action === 'consumed' ? a.options.length : 0;
}
export const isTaskStatus = (ty: PlannedType, a: PlannedAttr) => ty.key === 'task' && a.sourceKey === 'status' && a.statuses.length > 0;

// ------------------------------------------------------------------ 4c (§3.8)

export type DecideRow = 'case' | 'ambiguous' | 'tagLike';
export function decideRows(plan: Plan | null): DecideRow[] {
  if (!plan) return [];
  const d = plan.decisions;
  return [...(d.caseLinks.length ? ['case' as const] : []), ...(d.ambiguous.length ? ['ambiguous' as const] : []), ...(d.tagLike.length ? ['tagLike' as const] : [])];
}
export const titleOf = (plan: Plan, source: string) => plan.objects.find((o) => o.source === source)?.title ?? source.split('/').pop()!.replace(/\.md$/i, '');

// ------------------------------------------------------------------ 5 (§3.9)

export type PreviewModel = {
  objects: number; types: number; newTypes: number; attachments: number; links: number; unresolved: number; stubs: number;
  technical: string[]; missing: number;
};
export const linksCount = (plan: Plan) => plan.links.filter((l) => ['resolved', 'date-mention', 'attachment'].includes(l.outcome.kind)).length;
export function preview(plan: Plan, given: Mapping): PreviewModel {
  const imported = plan.objects.filter((o) => o.outcome === 'imported' && o.kind !== 'orphanMedia');
  const keys = new Set(imported.map((o) => o.type).filter((x): x is string => !!x));
  const technical: string[] = [];
  for (const ty of plan.types) {
    for (const a of ty.attributes) {
      if (a.action !== 'drop' || technical.includes(a.sourceKey)) continue;
      if (given.types?.[ty.sourceType]?.attributes?.[a.sourceKey]?.to) continue; // the user's own `Don't import` (D-1578)
      technical.push(a.sourceKey);
    }
  }
  return {
    objects: plan.totals.objects.imported, types: keys.size, newTypes: [...keys].filter((k) => plan.types.some((x) => x.key === k && x.new)).length,
    attachments: plan.totals.attachments.imported, links: linksCount(plan), unresolved: plan.report.unresolved.length, stubs: plan.report.stubs.length,
    technical, missing: plan.report.files.filter((f) => f.change.kind === 'droppedReference').length,
  };
}
/** Objects the run writes (step 6's `objects` row before its step, §3.10): imported plus made media objects. */
export const writtenObjects = (plan: Plan) => plan.objects.filter((o) => o.outcome === 'imported').length;

export function doneCard(plan: Plan): DoneCard {
  const m = plan.report.merged;
  return {
    unresolved: plan.report.unresolved.length, stubs: plan.report.stubs.length, ambiguous: plan.report.ambiguous.length, merged: m.length,
    mergedExample: m.length ? [m[0].variants[0], m[0].kept] : null,
    dropped: plan.report.files.filter((f) => f.change.kind === 'droppedReference').length,
  };
}

// ------------------------------------------------------------------ 6 (§3.10)

export type PhaseId = 'read' | 'create' | 'backup' | 'objects' | 'attachments' | 'report';
export type PhaseState = 'pending' | 'running' | 'done';
export type PhaseRow = { id: PhaseId; label: string; count: string | null; state: PhaseState };

export function phaseRows(o: { target: 'newVault' | 'existing'; backup: boolean; files: number; objects: number; attachments: number; progress: ImportProgressDto | null; sawBackup: boolean; final: boolean }): PhaseRow[] {
  const p = o.progress;
  const ph = o.final ? 'done' : p?.queued ? 'queued' : p?.phase ?? 'queued';
  const step = p?.phase === 'writing' ? p.step : null;
  const order: (string | null)[] = ['vault', 'types', 'attachments', 'objects', 'report'];
  const at = ph === 'done' ? 99 : ph === 'writing' ? order.indexOf(step) : ph === 'backup' ? -1 : -2;
  const second: PhaseId | null = o.target === 'newVault' ? 'create' : o.backup || o.sawBackup ? 'backup' : null;
  const rows: PhaseRow[] = [];
  const state = (running: boolean, done: boolean): PhaseState => (done ? 'done' : running ? 'running' : 'pending');
  rows.push({ id: 'read', label: t('import.run.read'), count: tn('import.run.files', { count: o.files }), state: state(ph === 'planning', ph === 'backup' || ph === 'writing' || ph === 'done') });
  if (second === 'create') rows.push({ id: 'create', label: t('import.run.create'), count: null, state: state(at === 0 || at === 1, at >= 2) });
  if (second === 'backup') rows.push({ id: 'backup', label: t('import.run.backup'), count: null, state: state(ph === 'backup', ph === 'writing' || ph === 'done') });
  const of = (s: 'objects' | 'attachments', total: number) => {
    const i = order.indexOf(s);
    if (at === i && p) return tn('import.run.of', { done: p.stepDone, total: p.stepTotal || total });
    return tn('import.run.of', { done: at > i ? total : 0, total });
  };
  rows.push({ id: 'objects', label: t('import.run.objects'), count: of('objects', o.objects), state: state(at === 3, at >= 4) });
  rows.push({ id: 'attachments', label: t('import.run.attachments'), count: of('attachments', o.attachments), state: state(at === 2, at >= 3) });
  rows.push({ id: 'report', label: t('import.run.report'), count: null, state: state(at === 4, at >= 99) });
  return rows;
}
/** The `objects` row's numbers (the status element's `{done}`, `{total}`, §6.1). */
export function objectsNumbers(o: { objects: number; progress: ImportProgressDto | null; final: boolean }): [number, number] {
  const p = o.progress;
  if (o.final) return [o.objects, o.objects];
  if (p?.phase === 'writing' && p.step === 'objects') return [p.stepDone, p.stepTotal || o.objects];
  if (p?.phase === 'writing' && p.step === 'report') return [o.objects, o.objects];
  return [0, o.objects];
}
export const writingStarted = (p: ImportProgressDto | null) => !!p && (p.phase === 'writing' || p.phase === 'done');

// ------------------------------------------------------------------ errors (§5.3)

/** R153's text of a run's failure or a refusal at `import_start` (step 6). */
export function stoppedText(e: ImportErrorDto | null | undefined): string {
  const code = e?.code ?? '';
  switch (code) {
    case 'sourceChanged': case 'sourceGone': return t('import.error.sourceChanged');
    case 'targetChanged': return t('import.error.targetChanged');
    case 'backupFailed': return t('import.error.backupFailed');
    case 'fileAppeared': return t('import.error.stopped', { reason: t('import.error.reason.fileAppeared', { path: String(e?.path ?? '') }) });
    case 'write': return t('import.error.stopped', { reason: t('import.error.reason.write', { path: String(e?.path ?? '') }) });
    case 'transform': return t('import.error.stopped', { reason: t('import.error.reason.engine') });
    default: return t('import.error.generic');
  }
}
/** Step 1's alert for a scan refusal. */
export function scanErrorText(kind: string): string {
  return ({
    NotCapacities: t('import.error.notCapacities'), UnreadableArchive: t('import.error.unreadableArchive'), EncryptedArchive: t('import.error.encrypted'),
    Empty: t('import.error.empty'), SourceGone: t('import.error.sourceGone'),
  } as Record<string, string>)[kind] ?? t('import.error.generic');
}
/** The engine error's code from an IPC error's kind (`TargetExists` → `targetExists`). */
export const codeOf = (kind: string) => kind.charAt(0).toLowerCase() + kind.slice(1);

/** The space's numbers for step 2's description. */
export const spaceCounts = (s: ScanInfo['spaces'][number]) => t('import.space.counts', { objects: s.objects, types: s.types.length }, num);
