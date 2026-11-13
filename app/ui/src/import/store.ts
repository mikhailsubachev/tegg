// Slice I2 (docs/contracts/v1-import-window.md §3.1, §3.5, §4.2, §6): the one Import window state, module-level so it
// outlives a vault switch, the chooser and a closed window. The IPC calls in order: one `import_plan` answer counts (the
// newest), `import:progress` and `import:done` are followed from app mount. Only `import_start` writes.
import { useSyncExternalStore } from 'react';
import { en, rawMessage, t } from '../i18n/catalog';
import { errorKind, events, ipc } from '../ipc/client';
import type {
  ImportErrorDto, ImportIpcError, ImportProgressDto, ImportResultDto, ImportStatusDto, Mapping, NewVaultDto, PlanResultDto, ScanInfo, TargetArg,
  TypeTarget, WhereDto,
} from '../ipc/import';
import { tn } from './format';
import { codeOf, decideRows, doneCard, dropEntry, linksCount, nextStep, backStep, objectsNumbers, writtenObjects, type Step } from './model';

export type Destination = 'new' | 'existing';
export type RunView = Omit<ImportStatusDto, 'progress' | 'result'> & {
  progress: ImportProgressDto | null; result: ImportResultDto | null;
  attachments: number; sawBackup: boolean; cancelling: boolean;
  /** A refusal of `import_start` or a failed run: R153's alert on step 6. */
  failure: ImportErrorDto | null;
};
export type ImportState = {
  open: boolean; step: Step;
  /** 4b's row (a source type, or `media`), 4c's lists. */
  sub: { attrs?: string; list?: 'case' | 'ambiguous' };
  source: { path: string; name: string } | null;
  reading: { done: number; total: number } | null;
  scan: ScanInfo | null;
  /** Step 1's alert: a scan refusal's kind, or `SourceChanged` from planning (with `Read again`). */
  scanAlert: string | null;
  space: string | null;
  destination: Destination;
  where: WhereDto | null;
  whereSpace: string | null;
  newVault: NewVaultDto | null;
  nameText: string;
  checkPending: boolean;
  given: Mapping;
  /** Each type's default target (with `{}`), for 4a's menu (D-1527 (6), D-1577). */
  defaults: Record<string, TypeTarget>;
  planResult: PlanResultDto | null;
  planFor: string | null;
  planBusy: boolean;
  planSlow: boolean;
  /** The current step's alert text (§5.3), announced once. */
  alert: string | null;
  /** The source attribute whose choice the engine refused (4b's alert and the rename field). */
  refused: { sourceType: string; attribute: string | null } | null;
  run: RunView | null;
  /** The window was hidden while a run exists (the status element shows then). */
  hidden: boolean;
  quitAsk: boolean;
};

const initial = (): ImportState => ({
  open: false, step: '0', sub: {}, source: null, reading: null, scan: null, scanAlert: null, space: null, destination: 'new', where: null,
  whereSpace: null, newVault: null, nameText: '', checkPending: false, given: {}, defaults: {}, planResult: null, planFor: null, planBusy: false,
  planSlow: false, alert: null, refused: null, run: null, hidden: false, quitAsk: false,
});

let state: ImportState = initial();
const listeners = new Set<() => void>();
function set(patch: Partial<ImportState> | ((s: ImportState) => Partial<ImportState>)) {
  const prev = state;
  state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) };
  // §8: `import-step:<step>` once per step change of the shown window, wherever the step or the open state changes
  // (opening, bringing the run forward, a step change, a move by an error or a run's answer).
  if (state.open && (!prev.open || state.step !== prev.step)) void ipc.perfMark(`import-step:${state.step}`).catch(() => {});
  for (const f of listeners) f();
}
export const getImport = () => state;
export function useImport(): ImportState {
  return useSyncExternalStore((f) => { listeners.add(f); return () => listeners.delete(f); }, () => state);
}
/** True while the window is shown: the editor and the capture paths ignore drops, the app's keys don't act (§3.1). */
export const importOpen = () => state.open || state.quitAsk;
/** True while a run is live (started, not final): the frame throttles its re-reads on `vault:changed` (App.tsx). */
export const importRunning = () => !!state.run && state.run.job >= 0 && !state.run.result;

// ------------------------------------------------------------------ the app's side (opening vaults, the focus)

export type ImportHost = {
  /** Opens a vault as the switcher does; with `report`, its report Page afterwards (§3.11). */
  openVault: (path: string, report: string | null) => Promise<void>;
  /** The open vault's path, or null on the chooser. */
  vaultPath: () => string | null;
  /** Goes to a route in the open vault. */
  goNote: (path: string) => void;
  /** Continues the app's quit flow (flush, `app_quit`). */
  quit: () => void;
};
let host: ImportHost | null = null;
export function setImportHost(h: ImportHost | null) { host = h; }
let opener: HTMLElement | null = null;
let headingFocus: (() => void) | null = null;
export function setHeadingFocus(f: (() => void) | null) { headingFocus = f; }
function restoreFocus() {
  const o = opener;
  opener = null;
  if (o && o.isConnected) setTimeout(() => { if (o.isConnected) o.focus(); }, 0);
}

// ------------------------------------------------------------------ opening and closing (§3.2, §4.2)

const runFinal = (r: RunView | null) => !!r?.result;

/** `Import…`: brings the window forward, or a new window at step 0 (§4.2, D-1579). */
export function openImport(from?: HTMLElement | null): void {
  if (state.open) { headingFocus?.(); return; }
  opener = from ?? (document.activeElement as HTMLElement | null);
  if (state.run && !runFinal(state.run) && !state.run.cancelling) {
    set({ open: true, hidden: false, step: '6', sub: {} });
    return;
  }
  if (state.run) void ipc.importDiscard().catch(() => {});
  set({ ...initial(), open: true, step: '0' });
}
/** The status button: the window at the run's step (6 or 7). */
export function showRun(from?: HTMLElement | null): void {
  if (!state.run) { openImport(from); return; }
  opener = from ?? (document.activeElement as HTMLElement | null);
  set({ open: true, hidden: false, sub: {}, step: runFinal(state.run) && state.run.result?.phase === 'done' ? '7' : '6' });
}
/** Cancel or Esc on steps 0–5 (FR-IMP-05 AC-10): nothing written, the session dropped. */
export function cancelImport(): void {
  if (state.reading || state.planBusy) void ipc.importCancel().catch(() => {});
  void ipc.importDiscard().catch(() => {});
  planSeq++;
  scanSeq++;
  set({ ...initial() });
  restoreFocus();
}
/** `Hide` (step 6): the run goes on, the status element follows it. */
export function hideImport(): void {
  set({ open: false, hidden: true, sub: {} });
  restoreFocus();
}
/** Step 7's close, a failed run's `Close`, `Dismiss` (§3.11, §6.1). */
export function closeImport(): void {
  void ipc.importDiscard().catch(() => {});
  planSeq++;
  set({ ...initial() });
  restoreFocus();
}
export const dismissStatus = () => { void ipc.importDiscard().catch(() => {}); set({ ...initial() }); };

// ------------------------------------------------------------------ step 1: the source (§3.3)

let scanSeq = 0;
/** A drop or a pick: `import_scan`. A drop that isn't a source changes nothing (`NotASource`, FR-IMP-07 AC-10). */
export async function readSource(path: string, o: { keepMapping?: boolean } = {}): Promise<void> {
  const seq = ++scanSeq;
  let applied = false;
  const apply = () => {
    if (applied || seq !== scanSeq) return;
    applied = true;
    const name = path.replace(/\/+$/, '').split('/').pop() ?? path;
    set((s) => ({
      source: { path, name }, scan: null, scanAlert: null, alert: null, reading: { done: 0, total: 0 }, planResult: null, planFor: null, where: null, whereSpace: null,
      ...(o.keepMapping ? {} : { space: null, destination: 'new' as Destination, given: {}, defaults: {}, newVault: null, nameText: '' }),
      ...(s.step !== '1' ? {} : {}),
    }));
  };
  pendingRead = { seq, apply };
  try {
    const scan = await ipc.importScan(path);
    if (seq !== scanSeq) return;
    apply();
    const keepSpace = o.keepMapping && state.space && scan.spaces.some((x) => x.name === state.space) ? state.space : null;
    set({ scan, reading: null, source: { path, name: scan.name }, space: keepSpace ?? scan.spaces[0]?.name ?? null });
  } catch (e) {
    if (seq !== scanSeq) return;
    const kind = errorKind(e);
    if (kind === 'NotASource') { pendingRead = null; return; }
    if (kind === 'Cancelled') { set({ source: null, scan: null, reading: null }); return; }
    apply();
    set({ scan: null, reading: null, scanAlert: kind });
  } finally {
    if (pendingRead?.seq === seq) pendingRead = null;
  }
}
let pendingRead: { seq: number; apply: () => void } | null = null;
export async function pickSource(kind: 'zip' | 'folder'): Promise<void> {
  const p = await ipc.importPickSource(kind).catch(() => null);
  if (p) await readSource(p);
}
/** `Stop` while reading: back to the empty drop area. */
export function stopReading(): void {
  void ipc.importCancel().catch(() => {});
  scanSeq++;
  set({ source: null, scan: null, reading: null, scanAlert: null });
}
/** `Read again` (D-1576): the same source, the mapping kept. */
export async function readAgain(): Promise<void> {
  const p = state.source?.path;
  if (!p) return;
  // A run `import_start` refused (job -1, its failure, no result) or a final one is gone; only a live run stays.
  const live = state.run && !runFinal(state.run) && state.run.job >= 0 && !state.run.failure ? state.run : null;
  set({ step: '1', sub: {}, alert: null, run: live });
  await readSource(p, { keepMapping: true });
}

// ------------------------------------------------------------------ steps (§3.3)

export function chooseSpace(name: string): void {
  if (state.space === name) return;
  set({ space: name, given: {}, defaults: {}, where: null, whereSpace: null, planResult: null, planFor: null, newVault: null, nameText: '' });
}
export function goNext(): void {
  const s = state.step;
  const decide = decideRows(state.planResult?.plan ?? null).length > 0;
  const n = nextStep(s, { spaces: state.scan?.spaces.length ?? 0, decide });
  if (!n) return;
  if (s === '1' && state.scan && state.scan.spaces.length === 1) set({ space: state.scan.spaces[0].name });
  go(n);
}
export function goBack(): void {
  const decide = decideRows(state.planResult?.plan ?? null).length > 0;
  const b = backStep(state.step, { spaces: state.scan?.spaces.length ?? 0, decide });
  if (b) go(b);
}
export function go(step: Step, sub: ImportState['sub'] = {}): void {
  set({ step, sub, alert: step === state.step ? state.alert : null });
  if (step === '3') void enterWhere();
}
export const openAttrs = (row: string) => set({ step: '4b', sub: { attrs: row }, refused: null, alert: null });
export const openList = (list: 'case' | 'ambiguous') => set({ sub: { list } });
export const closeList = () => set({ sub: {} });

// ------------------------------------------------------------------ step 3: where (§3.4)

async function enterWhere(): Promise<void> {
  const space = state.space;
  if (!space) return;
  if (!state.where || state.whereSpace !== space) {
    try {
      const w = await ipc.importWhere(space);
      if (state.space !== space) return;
      set({ where: w, whereSpace: space, newVault: w.newVault, nameText: w.newVault.name, destination: w.current ? state.destination : 'new' });
    } catch (e) {
      handlePlanError(e, 'where');
      return;
    }
  }
  if (!planCurrent()) void requestPlan();
}
const targetKey = (): string | null => {
  if (state.destination === 'existing') return 'existing';
  const nv = state.newVault;
  return nv ? `new:${nv.parent}/${nv.name}` : null;
};
const planCurrent = () => !!state.planResult && state.planFor === targetKey() && !state.planBusy;

export function chooseDestination(d: Destination): void {
  if (state.destination === d) return;
  set({ destination: d, given: {}, defaults: {}, planResult: null, planFor: null, alert: null });
  void requestPlan();
}
let checkTimer: ReturnType<typeof setTimeout> | null = null;
let checkSeq = 0;
/** The name field: `import_check_target` 200 ms after the last edit. */
export function editName(text: string): void {
  set({ nameText: text, checkPending: true });
  if (checkTimer) clearTimeout(checkTimer);
  checkTimer = setTimeout(() => { checkTimer = null; void checkTarget(state.newVault?.parent ?? '', text); }, 200);
}
async function checkTarget(parent: string, name: string): Promise<void> {
  const seq = ++checkSeq;
  try {
    const nv = await ipc.importCheckTarget(parent, name);
    if (seq !== checkSeq) return;
    set({ newVault: nv, checkPending: false });
    if (!nv.problem && state.destination === 'new') void requestPlan();
  } catch {
    if (seq === checkSeq) set({ checkPending: false });
  }
}
/** `Change…`: the folder dialog, then the check with the field's name. */
export async function changePlace(): Promise<void> {
  const dir = await ipc.vaultPickDir().catch(() => null);
  if (!dir) return;
  set({ checkPending: true });
  await checkTarget(dir, state.nameText);
}

// ------------------------------------------------------------------ plans (§2.3, §3.5)

let planSeq = 0;
let slowTimer: ReturnType<typeof setTimeout> | null = null;
let lastGood: Mapping = {};
function targetArg(): TargetArg | null {
  if (state.destination === 'existing') return { kind: 'existing' };
  const nv = state.newVault;
  return nv ? { kind: 'newVault', parent: nv.parent, name: nv.name } : null;
}
/** Plans the checked destination with the given mapping; the newest answer wins. */
export async function requestPlan(): Promise<void> {
  const space = state.space;
  const target = targetArg();
  if (!space || !target) return;
  const seq = ++planSeq;
  const given = state.given;
  const key = targetKey();
  set({ planBusy: true });
  if (slowTimer) clearTimeout(slowTimer);
  slowTimer = setTimeout(() => { if (seq === planSeq && state.planBusy) set({ planSlow: true }); }, 300);
  try {
    const r = await ipc.importPlan(space, target, given);
    if (seq !== planSeq) return;
    const defaults = { ...state.defaults };
    for (const ty of r.plan.types) if (!given.types?.[ty.sourceType]?.to && !(ty.sourceType in defaults)) defaults[ty.sourceType] = ty.target;
    lastGood = given;
    set({ planResult: r, planFor: key, planBusy: false, planSlow: false, defaults });
  } catch (e) {
    if (seq !== planSeq) return;
    set({ planBusy: false, planSlow: false });
    handlePlanError(e, 'plan');
  }
}
/** A choice on 4a–4c: the given mapping changes and is planned again. */
export function editMapping(m: Mapping, entry: { sourceType: string; attribute: string | null } | null = null): void {
  set({ given: m, refused: null, alert: entry && state.step === '4b' ? null : state.alert });
  lastEntry = entry;
  void requestPlan();
}
let lastEntry: { sourceType: string; attribute: string | null } | null = null;

function handlePlanError(e: unknown, from: 'plan' | 'where' | 'start'): void {
  const kind = errorKind(e);
  const imp = (e as ImportIpcError | null)?.import ?? null;
  switch (kind) {
    case 'Cancelled': case 'NotCancellable': return;
    case 'InvalidMapping': {
      const entry = (imp?.entry as { sourceType: string; attribute: string | null } | undefined) ?? lastEntry;
      const back = entry ? dropEntry(state.given, entry) : lastGood;
      set({ given: back, refused: entry ?? null, alert: state.step === '4b' && entry?.attribute ? t('import.attrs.refused', { key: entry.attribute }) : null });
      void requestPlan();
      return;
    }
    case 'SourceChanged': case 'SourceGone':
      if (from === 'start') { failRunStart(imp ?? { code: codeOf(kind) }); return; }
      set({ step: '1', sub: {}, scanAlert: 'SourceChanged', alert: null });
      return;
    case 'TargetExists': case 'TargetNotWritable': case 'TargetInsideVault': case 'TargetInsideSource': {
      const problem = codeOf(kind) as NewVaultDto['problem'];
      set((s) => ({ step: '3', sub: {}, newVault: s.newVault ? { ...s.newVault, problem } : s.newVault, planResult: null, planFor: null }));
      return;
    }
    case 'UnknownSpace': {
      const multi = (state.scan?.spaces.length ?? 0) > 1;
      set({ step: multi ? '2' : '3', given: {}, defaults: {}, space: state.scan?.spaces[0]?.name ?? null, where: null, whereSpace: null, planResult: null, planFor: null });
      if (!multi) void enterWhere();
      return;
    }
    case 'IndexNotReady':
      setTimeout(() => { if (state.open) void (from === 'where' ? enterWhere() : requestPlan()); }, 1000);
      return;
    case 'NoSpace':
      set({ alert: t('import.error.noSpace', { needed: String(imp?.needed ?? ''), free: String(imp?.free ?? '') }) });
      return;
    case 'LeftoverNotTrashed':
      set({ alert: t('import.error.leftover', { name: state.newVault?.name ?? '' }) });
      return;
    case 'TargetChanged': case 'BackupFailed':
      if (from === 'start') { failRunStart(imp ?? { code: codeOf(kind) }); return; }
      set({ alert: t('import.error.generic') });
      return;
    case 'Busy':
      if (state.run) showRun();
      return;
    default:
      set({ alert: t('import.error.generic') });
  }
}

// ------------------------------------------------------------------ 4a…4c edits (§3.6…§3.8) are made by the steps with model.ts

// ------------------------------------------------------------------ step 5 → 6: `import_start` (§2.5, §3.9)

/** Every `import.report.*` entry in the current UI language, plural forms resolved to `other` (§2.5). */
export function reportStrings(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of Object.keys(en)) {
    if (!k.startsWith('import.report.')) continue;
    const m = rawMessage(k);
    out[k] = typeof m === 'string' ? m : 'text' in (m as object) ? String((m as { text: string }).text) : String((m as { other: string }).other);
  }
  return out;
}
let starting = false;
export async function startRun(): Promise<void> {
  const r = state.planResult;
  if (!r || state.planBusy || r.noSpace || starting) return;
  starting = true;
  const plan = r.plan;
  const existing = state.destination === 'existing';
  const base: RunView = {
    job: -1, space: plan.space, target: existing ? 'existing' : 'newVault',
    vaultName: existing ? state.where?.current?.name ?? (plan.target.kind === 'existing' ? plan.target.name : '') : state.newVault?.name ?? '',
    vault: existing ? state.where?.current?.path ?? host?.vaultPath() ?? null : state.newVault ? `${state.newVault.parent}/${state.newVault.name}` : null,
    files: plan.source.files, backup: existing && !!plan.backup, objects: writtenObjects(plan), links: linksCount(plan), card: doneCard(plan),
    reportDate: plan.report.summary.date, progress: null, result: null, attachments: plan.totals.attachments.imported, sawBackup: false,
    cancelling: false, failure: null,
  };
  try {
    early = { progress: null, result: null, sawBackup: false };
    const { job } = await ipc.importStart(r.token, reportStrings());
    const e0 = early;
    early = null;
    set({ run: { ...base, job, progress: e0.progress, sawBackup: e0.sawBackup }, step: '6', sub: {}, alert: null });
    if (e0.result) onDone(e0.result);
  } catch (e) {
    const kind = errorKind(e);
    if (['TargetExists', 'TargetNotWritable', 'TargetInsideVault', 'TargetInsideSource', 'NoSpace', 'LeftoverNotTrashed', 'SourceChanged', 'SourceGone', 'TargetChanged', 'BackupFailed', 'Busy'].includes(kind)) {
      if (['SourceChanged', 'SourceGone', 'TargetChanged', 'BackupFailed'].includes(kind)) set({ run: base });
      handlePlanError(e, 'start');
    } else set({ alert: t('import.error.generic') });
  } finally {
    starting = false;
    early = null;
  }
}
/** Events of the run that arrive before `import_start` answered with its job id (§2.4). */
let early: { progress: ImportProgressDto | null; result: ImportResultDto | null; sawBackup: boolean } | null = null;
function failRunStart(err: ImportErrorDto) {
  set((s) => ({ step: '6', sub: {}, run: s.run ? { ...s.run, failure: err } : s.run }));
}
/** Step 6's `Cancel` (before the first write): the run is cancelled, the window closes, nothing else shows. The window
 *  waits for `import_cancel`'s answer: `NotCancellable` (the run reached `writing` meanwhile, §5.3) is ignored and the
 *  run goes on, step 6 shown as it was. */
let cancelSent = false;
export async function cancelRun(): Promise<void> {
  const r0 = state.run;
  if (!r0 || r0.result || cancelSent) return;
  cancelSent = true;
  set((s) => ({ run: s.run ? { ...s.run, cancelling: true } : s.run }));
  let refused = false;
  try {
    await ipc.importCancel();
  } catch (e) {
    refused = true;
    if (errorKind(e) !== 'NotCancellable') console.warn('import_cancel', e);
  } finally {
    cancelSent = false;
  }
  const r = state.run;
  // `import:done` came first: cancelled (the window is closed already) or final (shown as `import:done` left it).
  if (!r || r.job !== r0.job || r.result) return;
  if (refused) {
    set({ run: { ...r, cancelling: false } });
    return;
  }
  set({ open: false, hidden: false });
  restoreFocus();
}
/** `Plan again` (R153 `TargetChanged`): 4a with a new plan, the mapping kept. */
export function planAgain(): void {
  set({ run: null, step: '4a', sub: {}, alert: null, planResult: null, planFor: null });
  void requestPlan();
}

// ------------------------------------------------------------------ events (§2.4)

function onProgress(p: ImportProgressDto) {
  if (p.phase === 'reading') {
    if (pendingRead) pendingRead.apply();
    if (state.reading || state.source) set({ reading: { done: p.done, total: p.total } });
    return;
  }
  if (early) { early.progress = p; early.sawBackup ||= p.phase === 'backup'; return; }
  const r = state.run;
  if (!r && !starting && p.job !== null && p.job !== undefined) { adopt(); return; }
  if (!r || r.result) return;
  if (p.job !== null && p.job !== undefined && p.job !== r.job) return;
  set({ run: { ...r, progress: p, sawBackup: r.sawBackup || p.phase === 'backup' } });
}
function onDone(res: ImportResultDto) {
  if (early) { early.result = res; return; }
  const r = state.run;
  if (!r || res.job !== r.job) return;
  void ipc.perfMark('import-done').catch(() => {});
  if (res.phase === 'cancelled') {
    void ipc.importDiscard().catch(() => {});
    set({ ...initial() });
    return;
  }
  // A cancel that came too late (the run ended or failed first): the run's end is shown as usual.
  const run: RunView = { ...r, cancelling: false, result: res, failure: res.phase === 'failed' ? res.error ?? { code: 'unknown' } : null, vault: res.vault ?? r.vault, vaultName: res.vaultName || r.vaultName };
  if (state.open && res.phase === 'done') {
    set({ run, step: '7', sub: {} });
  } else set({ run });
}

let started = false;
/** At app mount: the run's events, the menu's `import:open`, and a run that outlived a reload (§12 (13)). */
export function startImportEvents(): void {
  if (started) return;
  started = true;
  void events.importProgress(onProgress);
  void events.importDone(onDone);
  void events.importOpen(() => openImport());
  void events.dragDrop((d) => onDrop(d.paths, d.position));
}
let adopting = false;
/** A run this UI didn't start (the window was reloaded while it ran, §12 (13)): rebuilt from `import_status` on its
 *  first event, so an app start without a run asks nothing. */
function adopt() {
  if (adopting) return;
  adopting = true;
  void ipc.importStatus().then((st) => {
    adopting = false;
    if (!st || state.run) return;
    set({ run: { ...st, attachments: 0, sawBackup: false, cancelling: false, failure: st.result?.phase === 'failed' ? st.result.error : null }, hidden: !state.open });
  }, () => { adopting = false; });
}

// ------------------------------------------------------------------ drops (§3.3, contract choice §12 (8))

let dropArea: (() => HTMLElement | null) | null = null;
export function setDropArea(f: (() => HTMLElement | null) | null) { dropArea = f; }
function onDrop(paths: string[], pos: { x: number; y: number }) {
  if (!state.open || state.step !== '1' || !paths?.length) return;
  const el = dropArea?.();
  if (!el) return;
  const r = el.getBoundingClientRect();
  const inside = (x: number, y: number) => x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
  const dpr = window.devicePixelRatio || 1;
  if (!inside(pos.x, pos.y) && !inside(pos.x / dpr, pos.y / dpr)) return;
  void readSource(paths[0].normalize('NFC'));
}

// ------------------------------------------------------------------ quitting (§6.3)

/** `app:quit-requested`: true when the import handled it (a question or a cancel first). */
export function quitRequested(): boolean {
  const r = state.run;
  if (!r || r.result || r.cancelling) return false;
  const p = r.progress;
  if (p && (p.phase === 'writing')) {
    set({ quitAsk: true });
    return true;
  }
  // Queued, planning, backup: cancel, wait for `import:done` (at most 1 s), then quit. A cancel answered
  // `NotCancellable` (the run reached `writing` meanwhile, §5.3) asks the question instead.
  const t0 = Date.now();
  const wait = () => { if (state.run?.result || !state.run || Date.now() - t0 > 1000) host?.quit(); else setTimeout(wait, 50); };
  ipc.importCancel().then(() => setTimeout(wait, 50), (e) => {
    if (errorKind(e) === 'NotCancellable' && state.run && !state.run.result) set({ quitAsk: true });
    else setTimeout(wait, 50);
  });
  return true;
}
export const keepImporting = () => set({ quitAsk: false });
export function quitAnyway(): void {
  set({ quitAsk: false });
  host?.quit();
}

// ------------------------------------------------------------------ step 7 (§3.11)

export function isOpenVault(): boolean {
  const r = state.run;
  const cur = host?.vaultPath() ?? null;
  return !!r && r.target === 'existing' && !!r.vault && !!cur && r.vault.normalize('NFC') === cur.normalize('NFC');
}
export async function openTarget(report: boolean): Promise<void> {
  const r = state.run;
  if (!r?.vault || !host) return;
  const reportPath = r.result?.reportPath ?? null;
  if (isOpenVault()) {
    closeAfterOpen();
    if (report && reportPath) host.goNote(reportPath);
    return;
  }
  await host.openVault(r.vault, report ? reportPath : null).catch(() => {});
  closeAfterOpen();
}
function closeAfterOpen() {
  void ipc.importDiscard().catch(() => {});
  opener = null;
  set({ ...initial() });
}

// ------------------------------------------------------------------ the status element (§6.1)

export function statusText(s: ImportState): string | null {
  const r = s.run;
  if (!r || s.open || r.cancelling) return null;
  if (r.result?.phase === 'done') return t('import.status.done');
  if (r.result?.phase === 'failed' || r.failure) return t('import.status.failed');
  if (r.progress?.queued) return t('import.run.waiting');
  const [done, total] = objectsNumbers({ objects: r.objects, progress: r.progress, final: false });
  return tn('import.status.running', { done, total });
}
