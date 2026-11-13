// Slice I2 (docs/contracts/v1-import-window.md §7): the fake core's Import window session. The canned scans and plans
// of tests/fixtures/import/window/ (made by the real engine, or hand-written) are read here in Node, and a plan is
// passed through `applyMapping`, a TypeScript twin of the parts of the engine the window reads. The in-page part
// (`fakeImportMain`) answers the §2.1 commands, paces and holds the progress events and runs the import against the
// fake vault (an existing target) or a fake new vault added to the folders `vault_open` can open.
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';

const REPO = resolve(import.meta.dirname, '../../..');
const WINDOW = resolve(REPO, 'tests/fixtures/import/window');
const NEW_EMPTY = resolve(REPO, 'tests/fixtures/vaults/new-empty/.tegg/types');

export type TargetTypeDto = {
  key: string; name: string; plural: string; system: boolean;
  attributes: { key: string; name: string; type: string }[];
  statuses: { label: string; state: 'open' | 'in progress' | 'done' | 'cancelled' }[] | null;
};
export type FakeImportOptions = {
  sources?: Record<string, { scan: string } | { error: 'NotCapacities' | 'UnreadableArchive' | 'EncryptedArchive' | 'Empty' | 'SourceGone' }>;
  plans?: Record<string, string>;
  where?: string | Record<string, unknown>;
  targetTypes?: TargetTypeDto[];
  pickFile?: string | null;
  pickSourceDir?: string | null;
  taken?: string[];
  free?: number | null;
};
export type ImportErrorDto = { code: string; [k: string]: unknown };
export type FakeImportHandle = {
  importCalls(): Promise<{ cmd: string; args: unknown }[]>;
  importPace(ms: number): Promise<void>;
  importHold(at: 'reading' | 'planning' | 'queued' | 'backup' | 'writing' | null): Promise<void>;
  importRelease(): Promise<void>;
  importFail(f: { at: 'scan' | 'plan' | 'start' | 'backup' | 'writing'; error: ImportErrorDto } | null): Promise<void>;
  importQueued(on: boolean): Promise<void>;
};

// ------------------------------------------------------------------ canned data (§7.1)

const cache = new Map<string, unknown>();
/** A canned file of tests/fixtures/import/window/ (named with its extension). */
export function loadImportFixture<T = any>(name: string): T {
  if (!cache.has(name)) {
    const p = join(WINDOW, name);
    if (!existsSync(p)) throw new Error(`fake import: no canned file ${name}`);
    cache.set(name, JSON.parse(readFileSync(p, 'utf8')));
  }
  return JSON.parse(JSON.stringify(cache.get(name))) as T;
}

const stateOf = (s: unknown): TargetTypeDto['statuses'] extends (infer X)[] | null ? X extends { state: infer S } ? S : never : never =>
  (s === 'in-progress' || s === 'in progress' ? 'in progress' : s === 'done' ? 'done' : s === 'cancelled' ? 'cancelled' : 'open') as never;
/** The target types of type files (`.tegg/types/<key>.yml` → text), as `type_get` reads them. */
export function typesOfFiles(files: Record<string, string>): TargetTypeDto[] {
  const out: TargetTypeDto[] = [];
  for (const [p, text] of Object.entries(files)) {
    const m = /^\.tegg\/types\/([^/]+)\.yml$/.exec(p);
    if (!m) continue;
    let y: any;
    try { y = parseYaml(text); } catch { continue; }
    if (!y || typeof y.name !== 'string' || typeof y.plural !== 'string') continue;
    const attrs = Array.isArray(y.attributes) ? y.attributes : [];
    const status = m[1] === 'task' ? attrs.find((a: any) => a?.key === 'status') : null;
    out.push({
      key: m[1].normalize('NFC'), name: y.name, plural: y.plural, system: y.system === true,
      attributes: attrs.filter((a: any) => a && typeof a.key === 'string').map((a: any) => ({ key: a.key, name: String(a.name ?? a.key), type: String(a.type ?? 'text') })),
      statuses: status ? (status.options ?? []).map((o: any) => ({ label: String(o.label), state: stateOf(o.state) })) : null,
    });
  }
  return out.sort((a, b) => a.key.localeCompare(b.key));
}
/** The seven system types a new vault gets (`Vault::create` writes new-empty's `.tegg/`). */
export function systemTypes(): TargetTypeDto[] {
  const files: Record<string, string> = {};
  for (const k of ['page', 'task', 'quick-note', 'daily-note', 'tag', 'image', 'pdf']) files[`.tegg/types/${k}.yml`] = readFileSync(join(NEW_EMPTY, `${k}.yml`), 'utf8');
  return typesOfFiles(files);
}

// ------------------------------------------------------------------ applyMapping (§7.3)

const fold = (s: string) => s.normalize('NFC').trim().toLowerCase();
const slug = (s: string) => s.normalize('NFC').trim().toLowerCase().replace(/\s+/g, '-');
type Refusal = { kind: string; message: string; import: ImportErrorDto };
const refuse = (reason: string, sourceType: string, attribute: string | null): Refusal =>
  ({ kind: 'InvalidMapping', message: `fake: ${reason}`, import: { code: 'invalidMapping', entry: { sourceType, attribute }, reason } });

/** The engine's `deny_unknown_fields` on `Mapping`, `TypeMapping`, `AttrMapping`, `Split`, `CaseLinkChoice`
 *  (crates/tegg-import/src/dto.rs §4): the shell refuses such an argument before the command runs (Tauri's
 *  `invalid args` string, no `kind`). Required fields of `Split` (`on`) and `CaseLinkChoice` (all three) likewise. */
function mappingShapeError(m: any): string | null {
  const bad = (where: string, o: any, allowed: string[], required: string[] = []): string | null => {
    if (o === null || o === undefined) return null;
    if (typeof o !== 'object' || Array.isArray(o)) return `invalid type for ${where}`;
    for (const k of Object.keys(o)) if (!allowed.includes(k)) return `unknown field \`${k}\` in ${where}, expected one of ${allowed.map((x) => `\`${x}\``).join(', ')}`;
    for (const k of required) if (!(k in o)) return `missing field \`${k}\` in ${where}`;
    return null;
  };
  const e = bad('Mapping', m, ['version', 'types', 'caseLinks']);
  if (e || !m) return e;
  for (const tm of Object.values((m.types ?? {}) as Record<string, any>)) {
    const t = bad('TypeMapping', tm, ['to', 'attributes']);
    if (t) return t;
    for (const am of Object.values((tm?.attributes ?? {}) as Record<string, any>)) {
      const a = bad('AttrMapping', am, ['to', 'merge', 'split', 'values']) ?? bad('Split', am?.split, ['on', 'to'], ['on']);
      if (a) return a;
    }
  }
  for (const c of (Array.isArray(m.caseLinks) ? m.caseLinks : [])) {
    const x = bad('CaseLinkChoice', c, ['note', 'target', 'use'], ['note', 'target', 'use']);
    if (x) return x;
  }
  return null;
}

/** The canned plan with the given mapping applied: targets, attribute actions, merges, splits, statuses, `needsLook`
 *  (v1-import §5.1's four rules), the decisions and the effective mapping; or the refusal. */
export function applyMapping(plan0: any, mapping: any, targetTypes: TargetTypeDto[]): { plan: any } | { error: Refusal | string } {
  const shape = mappingShapeError(mapping);
  if (shape) return { error: `invalid args \`mapping\` for command \`import_plan\`: ${shape}` };
  const plan = JSON.parse(JSON.stringify(plan0));
  const given = mapping ?? {};
  const gt = (given.types ?? {}) as Record<string, any>;
  // Validation (v1-import §4.2), the parts the window can reach.
  const newNames: string[] = [];
  for (const [st, tm] of Object.entries(gt).sort(([a], [b]) => (a < b ? -1 : 1))) {
    if (!plan.types.some((x: any) => x.sourceType === st)) return { error: refuse('unknownSourceType', st, null) };
    if (tm?.to?.kind === 'new') {
      const n = fold(String(tm.to.name ?? ''));
      if (!n) return { error: refuse('emptyName', st, null) };
      if (targetTypes.some((x) => fold(x.name) === n || fold(x.plural) === n) || newNames.includes(n)) return { error: refuse('nameTaken', st, null) };
      newNames.push(n);
    }
    for (const [k, am] of Object.entries((tm?.attributes ?? {}) as Record<string, any>)) {
      if (am?.to?.kind === 'existing' && am.to.key === 'rating') return { error: refuse('kindMismatch', st, k) };
    }
  }
  const taskStatuses = targetTypes.find((x) => x.key === 'task')?.statuses ?? [];
  for (const ty of plan.types) {
    const tm = gt[ty.sourceType];
    if (tm?.to) {
      const to = tm.to;
      ty.target = to;
      if (to.kind === 'skip') Object.assign(ty, { key: null, name: null, plural: null, folder: null, new: false });
      else if (to.kind === 'existing') {
        const tt = targetTypes.find((x) => x.key === to.key);
        Object.assign(ty, { key: to.key, name: tt?.name ?? to.key, plural: tt?.plural ?? to.key, folder: tt?.plural ?? to.key, new: false });
      } else Object.assign(ty, { key: slug(to.name), name: to.name, plural: ty.sourceFolder, folder: ty.sourceFolder, new: true });
      for (const o of plan.objects) {
        if (o.sourceType !== ty.sourceType) continue;
        if (to.kind === 'skip') { if (o.outcome === 'imported') o.outcome = 'skipped'; o.path = null; }
        else o.type = ty.key;
      }
    }
    const tt = targetTypes.find((x) => x.key === ty.key);
    for (const a of ty.attributes) {
      const am = tm?.attributes?.[a.sourceKey];
      const before = { r1: a.action === 'new', r2: a.merges.length > 0, r3: a.statuses.some((s: any) => s.fallback) };
      const r4orig = a.needsLook && !before.r1 && !before.r2 && !before.r3;
      if (am?.to && a.action !== 'consumed') {
        const to = am.to;
        if (to.kind === 'existing') {
          const ta = tt?.attributes.find((x) => x.key === to.key);
          Object.assign(a, { action: to.key === a.sourceKey ? 'keep' : 'rename', key: to.key, name: ta?.name ?? to.key, type: ta?.type ?? a.type });
        } else if (to.kind === 'new') Object.assign(a, { action: 'new', key: slug(to.name), name: to.name, type: to.type ?? a.type ?? 'text' });
        else Object.assign(a, { action: 'drop', key: null, name: null, type: null });
      }
      if (am?.merge) {
        for (const mg of a.merges) {
          if (am.merge.kind === 'off') mg.applied = false;
          else { mg.applied = true; mg.kept = am.merge.spellings?.[fold(mg.variants[0])] ?? mg.kept; }
        }
      }
      if (am?.split) a.split = am.split;
      if (am?.values) {
        for (const st of a.statuses) {
          const label = am.values[st.value];
          if (label === undefined) continue;
          st.to = label;
          st.state = taskStatuses.find((x) => x.label === label)?.state ?? st.state;
          st.fallback = false;
        }
      }
      a.needsLook = (a.action === 'new' && !am?.to) || (a.merges.length > 0 && !am?.merge) || a.statuses.some((s: any) => s.fallback) || (r4orig && !am?.split);
    }
  }
  for (const c of plan.decisions.caseLinks) c.confirmed = !!(given.caseLinks ?? []).find((x: any) => x.note === c.note && x.target === c.target)?.use;
  for (const tl of plan.decisions.tagLike) {
    const to = gt[tl.sourceType]?.attributes?.[tl.sourceKey]?.to;
    tl.selected = to?.kind === 'new' && to.type === 'select';
  }
  // Totals follow skipped types.
  const notes = plan.objects.filter((o: any) => o.kind !== 'orphanMedia');
  plan.totals.objects.imported = notes.filter((o: any) => o.outcome === 'imported').length;
  plan.totals.objects.reported = plan.totals.objects.total - plan.totals.objects.imported;
  // The effective mapping (v1-import §4): every type and attribute with its `to`; merge, split and values echoed.
  const eff: any = { version: 1, types: {}, caseLinks: given.caseLinks ?? [] };
  for (const ty of plan.types) {
    const attrs: any = {};
    for (const a of ty.attributes) {
      const am = gt[ty.sourceType]?.attributes?.[a.sourceKey] ?? {};
      const to = a.action === 'drop' ? { kind: 'drop' } : a.action === 'new' ? { kind: 'new', name: a.name, type: a.type } : a.action === 'notCreated' ? { kind: 'new', name: a.sourceKey, type: null } : { kind: 'existing', key: a.key };
      attrs[a.sourceKey] = { to, merge: am.merge ?? null, split: am.split ?? null, values: am.values ?? {} };
    }
    eff.types[ty.sourceType] = { to: ty.target, attributes: attrs };
  }
  plan.mapping = eff;
  return { plan };
}

/** Node side of the in-page fake (`__teggImport`). */
export function handleImport(op: string, a: any): unknown {
  switch (op) {
    case 'load': return loadImportFixture(String(a.name));
    case 'plan': {
      const plan = loadImportFixture(String(a.name));
      const types: TargetTypeDto[] = a.targetTypes ?? (a.existing ? typesOfFiles(a.files ?? {}) : systemTypes());
      const r = applyMapping(plan, a.mapping, types);
      return 'error' in r ? { error: r.error } : { plan: r.plan, targetTypes: types };
    }
    default: return null;
  }
}

// ------------------------------------------------------------------ in-page part (serialized: no imports, no outer names)

export function fakeImportMain(init: { opts: FakeImportOptions; empty: Record<string, string> }) {
  const w = window as any;
  const f = w.__teggFake;
  if (!f || !f.handlers) return;
  const o = init.opts ?? {};
  const nfc = (s: string) => String(s).normalize('NFC');
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const err = (kind: string, code?: string, extra: Record<string, unknown> = {}) => ({ kind, message: `fake import: ${kind}`, ...(code ? { import: { code, ...extra } } : {}) });
  const pascal = (code: string) => code.charAt(0).toUpperCase() + code.slice(1);
  const s = {
    pace: 20,
    hold: null as string | null,
    waiters: [] as (() => void)[],
    released: false,
    fail: null as null | { at: string; error: { code: string; [k: string]: unknown } },
    queued: false,
    scanTok: null as null | { cancelled: boolean },
    planTok: null as null | { cancelled: boolean },
    scanName: null as string | null,
    tokens: 0,
    plans: {} as Record<number, any>,
    jobs: 1000,
    run: null as any,
  };
  f.importState = s;
  const pass = async (phase: string) => {
    if (s.hold !== phase) return;
    if (s.released) { s.released = false; return; }
    await new Promise<void>((r) => s.waiters.push(r));
  };
  f.importRelease = () => { const ws = s.waiters.splice(0); if (!ws.length) s.released = true; for (const r of ws) r(); };
  const failAt = (at: string) => {
    if (s.fail?.at !== at) return null;
    const e = s.fail.error;
    s.fail = null;
    return e;
  };
  const emit = (p: Record<string, unknown>) => f.emit('import:progress', { step: null, done: 0, total: 0, stepDone: 0, stepTotal: 0, counts: null, job: null, queued: false, ...p });
  const node = (op: string, a: unknown) => w.__teggImport(op, a);
  const display = (p: string) => p.replace(/^\/fake\/home(?=\/|$)/, '~');
  const sanitize = (t: string) => nfc(t).replace(/[\\/:*?"<>|#^[\]]/g, ' ').replace(/ {2,}/g, ' ').trim();
  const dirs = () => (f.opts.dirs ??= {}) as Record<string, any>;
  const taken = (p: string) => (o.taken ?? []).map(nfc).includes(nfc(p)) || nfc(p) in dirs();
  const newVault = (parent: string, name: string) => {
    const n = sanitize(name);
    const path = `${parent}/${n}`;
    return { parent, name: n, path, display: display(path), problem: !n ? 'invalidName' : taken(path) ? 'targetExists' : null };
  };
  const notes = () => Object.keys(f.vault?.files ?? {}).filter((p) => p.endsWith('.md') && !p.split('/').some((x: string) => x.startsWith('.') || x === '_templates')).length;

  const H = f.handlers as Record<string, (a: any) => unknown>;
  for (const c of ['import_pick_source', 'import_scan', 'import_cancel', 'import_where', 'import_check_target', 'import_plan', 'import_status', 'import_discard', 'import_transform_result']) f.reads.add(c);

  H.import_pick_source = (a) => (a?.kind === 'zip' ? o.pickFile ?? null : o.pickSourceDir ?? null);
  H.import_scan = async (a) => {
    const path = nfc(a?.path ?? '');
    const src = (o.sources ?? {})[path] ?? Object.entries(o.sources ?? {}).find(([k]) => nfc(k) === path)?.[1];
    if (!src) throw err('NotASource');
    if (s.run && !s.run.result) throw err('Busy'); // the shell: no scan while a run is live (§2.1)
    if (s.scanTok) s.scanTok.cancelled = true;
    if (s.planTok) s.planTok.cancelled = true;
    const tok = { cancelled: false };
    s.scanTok = tok;
    s.scanName = null;
    s.plans = {};
    const failed = failAt('scan');
    if (failed) throw err(pascal(failed.code), failed.code, failed);
    if ('error' in src) throw err(src.error, src.error.charAt(0).toLowerCase() + src.error.slice(1));
    const scan = await node('load', { name: src.scan });
    await pass('reading');
    const total = scan.files as number;
    const stepBy = Math.max(1, Math.ceil(total / 10));
    for (let done = 0; ; done = Math.min(total, done + stepBy)) {
      if (tok.cancelled) throw err('Cancelled');
      await emit({ phase: 'reading', done, total });
      if (done >= total) break;
      await sleep(s.pace);
    }
    if (tok.cancelled) throw err('Cancelled');
    s.scanTok = null;
    s.scanName = src.scan;
    return scan;
  };
  H.import_cancel = () => {
    if (s.scanTok) { s.scanTok.cancelled = true; s.scanTok = null; return { stopped: 'scan' }; }
    if (s.planTok) { s.planTok.cancelled = true; s.planTok = null; return { stopped: 'plan' }; }
    const r = s.run;
    if (r && !r.result) {
      if (r.writing) throw err('NotCancellable', 'notCancellable');
      r.cancel = true;
      for (const w0 of s.waiters.splice(0)) w0(); // a held run notices the cancel (within 1 s, v1-import §10)
      return { stopped: 'run' };
    }
    return { stopped: 'nothing' };
  };
  H.import_where = async (a) => {
    const space = nfc(a?.space ?? '');
    if (typeof o.where === 'string') return node('load', { name: o.where });
    if (o.where) return JSON.parse(JSON.stringify(o.where));
    // D-1575, D-1581 (as the shell's `proposed_parent`): the open vault's parent; with none, the parent of the first
    // recent vault that still exists; else `~/Documents/Tegg`.
    const parentOf = (p: string) => p.slice(0, p.lastIndexOf('/')) || '/';
    const recent = ((f.recent ?? []) as { path: string; exists: boolean }[]).find((r) => r.exists);
    const parent = f.vault && f.path ? parentOf(f.path) : recent ? parentOf(nfc(recent.path)) : '/fake/home/Documents/Tegg';
    let name = `Capacities · ${space}`;
    for (let i = 2; taken(`${parent}/${name}`); i++) name = `Capacities · ${space} (${i})`;
    const file = (o.plans ?? {})[`${space}|existing`];
    const already = file && f.vault ? ((await node('load', { name: file }))?.alreadyImported ?? 0) : 0;
    return { newVault: newVault(parent, name), current: f.vault ? { name: f.vault.name, path: f.path, notes: notes(), alreadyImported: already } : null };
  };
  H.import_check_target = (a) => newVault(String(a?.parent ?? ''), String(a?.name ?? ''));
  H.import_plan = async (a) => {
    const space = nfc(a?.space ?? '');
    const target = a?.target ?? { kind: 'newVault' };
    if (target.kind === 'existing' && !f.vault) throw err('NoVault');
    if (s.run && !s.run.result) throw err('Busy'); // the shell: no plan while a run is live (§2.1)
    const failed = failAt('plan');
    if (failed) throw err(pascal(failed.code), failed.code, failed);
    const file = (o.plans ?? {})[`${space}|${target.kind}`];
    if (!file) throw err('UnknownSpace', 'unknownSpace', { space });
    if (s.planTok) s.planTok.cancelled = true;
    const tok = { cancelled: false };
    s.planTok = tok;
    await pass('planning');
    for (let i = 0; i <= 10; i += 5) {
      if (tok.cancelled) throw err('Cancelled');
      await emit({ phase: 'planning', done: i, total: 10 });
      if (i < 10) await sleep(s.pace);
    }
    const r = await node('plan', { name: file, mapping: a?.mapping ?? {}, existing: target.kind === 'existing', targetTypes: o.targetTypes ?? null, files: f.vault?.files ?? {} });
    if (tok.cancelled) throw err('Cancelled');
    if (s.planTok === tok) s.planTok = null;
    if (r.error) throw r.error;
    const plan = r.plan;
    plan.target = target.kind === 'existing' ? { kind: 'existing', name: f.vault.name, notes: notes() } : { kind: 'newVault', parent: target.parent, name: target.name };
    const noSpace = o.free !== undefined && o.free !== null && plan.neededBytes > o.free ? { needed: plan.neededBytes, free: o.free } : null;
    const token = ++s.tokens;
    s.plans = { [token]: { plan, target, noSpace, vault: f.vault, path: f.path } };
    return { token, plan, noSpace, targetTypes: r.targetTypes };
  };
  H.import_start = async (a) => {
    const stored = s.plans[Number(a?.token)];
    if (!stored) throw err('UnknownPlan');
    if (s.run && !s.run.result) throw err('Busy');
    if (stored.noSpace) throw err('NoSpace', 'noSpace', stored.noSpace);
    const failed = failAt('start');
    if (failed) throw err(pascal(failed.code), failed.code, failed);
    s.plans = {};
    const job = ++s.jobs;
    const plan = stored.plan;
    const existing = stored.target.kind === 'existing';
    const vaultPath = existing ? stored.path : `${stored.target.parent}/${stored.target.name}`;
    const run: any = { job, plan, existing, vault: existing ? stored.vault : null, vaultPath, vaultName: existing ? stored.vault.name : stored.target.name, progress: null, result: null, writing: false, cancel: false };
    s.run = run;
    setTimeout(() => { void runJob(run); }, 0);
    return { job };
  };
  const progress = async (run: any, p: Record<string, unknown>) => {
    run.progress = { step: null, done: 0, total: 0, stepDone: 0, stepTotal: 0, counts: null, queued: false, ...p, job: run.job };
    await emit(run.progress);
  };
  const finish = async (run: any, phase: 'done' | 'cancelled' | 'failed', error: unknown = null) => {
    const plan = run.plan;
    run.result = {
      job: run.job, phase, error, target: run.existing ? 'existing' : 'newVault', vault: run.vaultPath, vaultName: run.vaultName,
      reportPath: phase === 'done' ? plan.reportPath : null, renamed: [], backup: run.existing && plan.backup ? `import-${run.job}.zip` : null, kept: [], totals: plan.totals,
    };
    await f.emit('import:done', run.result);
  };
  const front = (o2: any) => `---\nimport-id: "${o2.importId}"\n---\n`;
  const runJob = async (run: any) => {
    const plan = run.plan;
    const written = (plan.objects as any[]).filter((x) => x.outcome === 'imported' && x.path);
    const atts = (plan.attachments as any[]).filter((x) => x.outcome === 'imported').length;
    if (run.existing && s.queued) {
      await pass('queued');
      await progress(run, { phase: 'planning', queued: true });
      while (s.queued && !run.cancel) await sleep(20);
    }
    if (run.cancel) return finish(run, 'cancelled');
    await pass('planning');
    if (run.cancel) return finish(run, 'cancelled');
    await progress(run, { phase: 'planning', total: written.length + atts });
    await sleep(s.pace);
    if (run.cancel) return finish(run, 'cancelled');
    if (run.existing && plan.backup) {
      await pass('backup');
      if (run.cancel) return finish(run, 'cancelled');
      await progress(run, { phase: 'backup', total: plan.backup.files });
      const bf = failAt('backup');
      if (bf) return finish(run, 'failed', bf);
      await sleep(s.pace);
      if (run.cancel) return finish(run, 'cancelled');
    }
    await pass('writing');
    if (run.cancel) return finish(run, 'cancelled');
    run.writing = true;
    const total = written.length + atts + 2;
    let done = 0;
    const files: Record<string, string> = {};
    const steps: [string, number][] = [...(run.existing ? [] : [['vault', 1] as [string, number]]), ['types', 1], ['attachments', atts], ['objects', written.length], ['report', 1]];
    for (const [step, n] of steps) {
      const by = Math.max(1, Math.ceil(n / 20));
      for (let k = 0; ; k = Math.min(n, k + by)) {
        await progress(run, { phase: 'writing', step, done, total, stepDone: k, stepTotal: n });
        const wf = failAt('writing');
        if (wf) return finish(run, 'failed', wf);
        if (k >= n) break;
        await sleep(s.pace);
        if (step === 'objects') {
          const batch = written.slice(k, Math.min(n, k + by));
          for (const x of batch) files[x.path] = front(x);
          if (run.existing && run.vault) {
            for (const x of batch) run.vault.files[x.path] = front(x);
            if (f.vault === run.vault) await f.emit('vault:changed', { paths: batch.map((x: any) => x.path) });
          }
        }
        done += Math.min(by, n - k);
      }
    }
    const title = String(plan.reportPath).split('/').pop()!.replace(/\.md$/, '');
    const report = `---\ntype: page\ntitle: ${title}\n---\n# ${title}\n`;
    files[plan.reportPath] = report;
    if (run.existing && run.vault) {
      run.vault.files[plan.reportPath] = report;
      if (f.vault === run.vault) await f.emit('vault:changed', { paths: [plan.reportPath] });
      dirs()[run.vaultPath] = run.vault;
    } else {
      dirs()[run.vaultPath] = { name: run.vaultName, files: { ...init.empty, ...files } };
    }
    return finish(run, 'done');
  };
  H.import_status = () => {
    const r = s.run;
    if (!r) return null;
    const plan = r.plan;
    return {
      job: r.job, space: plan.space, target: r.existing ? 'existing' : 'newVault', vaultName: r.vaultName, vault: r.vaultPath, files: plan.source.files,
      backup: r.existing && !!plan.backup, objects: (plan.objects as any[]).filter((x) => x.outcome === 'imported' && !!x.path).length,
      links: (plan.links as any[]).filter((l) => ['resolved', 'date-mention', 'attachment'].includes(l.outcome.kind)).length,
      card: { unresolved: plan.report.unresolved.length, stubs: plan.report.stubs.length, ambiguous: plan.report.ambiguous.length, merged: plan.report.merged.length,
        mergedExample: plan.report.merged.length ? [plan.report.merged[0].variants[0], plan.report.merged[0].kept] : null,
        dropped: (plan.report.files as any[]).filter((x) => x.change.kind === 'droppedReference').length },
      reportDate: plan.report.summary.date, progress: r.progress, result: r.result,
    };
  };
  H.import_discard = () => {
    if (s.run && !s.run.result) throw err('Busy');
    s.run = null;
    s.plans = {};
    s.scanName = null;
    return null;
  };
  H.import_transform_result = () => null;
}
