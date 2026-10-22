// The only module that talks to the shell (architecture §10: UI ↔ core through one client).
// Commands: docs/contracts/ms2-shell.md §2, ms3-shell.md §2.
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type {
  ChangedDto, ConflictDto, ConflictRowDto, LastOpenedDto, LinkTargetDto, NoteDto, ObjectRowDto, ProgressDto, RecentVaultDto, SearchPageDto,
  SearchQueryDto, StarterPlanDto, SwitcherItemDto, TagDto, TypeDefDto, TypeDto, TypeOpDto, TypeRowDto, TypeTemplateDto, TypeUsageDto,
  AttributeInputDto, UiStateDto, VaultInfo, VersionDto, WriteResultDto, BacklinksPanelDto, BrokenLinksDto, DuplicateGroupDto,
  LinkCreatePlanDto, LinkCreatedDto, DailyViewDto, DailyDraftDto, DailyCreatedDto, DailyContextDto, EmbedNoteDto,
  NoteRenameDto, JobIdDto, JobReportDto, JobProgressDto, RetryDto, InterruptedDto, TaskListDto, DailyTasksDto,
  InboxRowDto, VaultSettingsDto, ShellSettingsDto, HotkeyStateDto,
  TrashEntryDto, MovedDto, TrashRemovalDto, MediaAddedDto, MediaAddResultDto, StagedMediaResultDto,
} from './types';

export const ipc = {
  vaultCurrent: () => invoke<VaultInfo | null>('vault_current'),
  vaultOpen: (path: string) => invoke<VaultInfo>('vault_open', { path }),
  vaultCreate: (parent: string, name: string, kind: 'empty' | 'starter') => invoke<VaultInfo>('vault_create', { parent, name, kind }),
  vaultPickDir: () => invoke<string | null>('vault_pick_dir'),
  vaultRecent: () => invoke<RecentVaultDto[]>('vault_recent'),
  appAbout: () => invoke<void>('app_about'),
  vaultLast: () => invoke<LastOpenedDto | null>('vault_last'),
  vaultTypes: () => invoke<TypeDefDto[]>('vault_types'),
  typeCounts: () => invoke<Record<string, number>>('index_type_counts'),
  list: (type: string) => invoke<ObjectRowDto[]>('index_list', { type }),
  search: (query: SearchQueryDto) => invoke<SearchPageDto>('index_search', { query }),
  switcher: (q: string, limit = 30) => invoke<SwitcherItemDto[]>('index_switcher', { q, limit }),
  noteRead: (path: string) => invoke<NoteDto>('note_read', { path }),
  /** 3D (ms3-shell §14.3): the one creation path's write; the core picks the type's folder and the file name. */
  noteCreate: (type: string, title: string, text: string) => invoke<string>('note_create', { type, title, text }),
  navOpened: (path: string | null, route?: string) => invoke<void>('nav_opened', route ? { path, route } : { path }),
  uiStateGet: () => invoke<UiStateDto>('ui_state_get'),
  uiStateSet: (state: UiStateDto) => invoke<void>('ui_state_set', { state }),
  perfMark: (name: string) => invoke<void>('perf_mark', { name }),
  /** NFR-PERF-06 AC-3 (D-199): one typing-latency record per keystroke. */
  perfKey: (frame: number, ms: number) => invoke<void>('perf_mark', { name: 'key', mark: 'key', frame, ms }),
  // 3C (ms3-shell §13.2).
  noteWrite: (path: string, text: string, base: VersionDto | null) => invoke<WriteResultDto>('note_write', { path, text, base }),
  noteCreateExact: (path: string, text: string) => invoke<VersionDto>('note_create_exact', { path, text }),
  noteTrash: (path: string, base: VersionDto) => invoke<string>('note_trash', { path, base }),
  // 6A (ms6-trash-media §4).
  trashList: () => invoke<TrashEntryDto[]>('trash_list'),
  objectTrash: (path: string, base: VersionDto) => invoke<MovedDto[]>('object_trash', { path, base }),
  trashRestore: (path: string) => invoke<MovedDto[]>('trash_restore', { path }),
  trashDelete: (paths: string[]) => invoke<TrashRemovalDto>('trash_delete', { paths }),
  trashEmpty: () => invoke<TrashRemovalDto>('trash_empty'),
  mediaAdd: (bytes: Uint8Array, name: string, owner: { path: string; title: string } | null, date: string) =>
    invoke<MediaAddedDto>('media_add', bytes, { headers: { 'x-tegg-name': encodeURIComponent(name), 'x-tegg-date': date, ...(owner ? { 'x-tegg-owner': encodeURIComponent(owner.path), 'x-tegg-owner-title': encodeURIComponent(owner.title) } : {}) } }),
  mediaAddPaths: (paths: string[], owner: { path: string; title: string } | null, date: string) =>
    invoke<MediaAddResultDto[]>('media_add_paths', { paths, owner: owner?.path ?? null, ownerTitle: owner?.title ?? null, date }),
  mediaPick: (kind: 'any' | 'image' | 'pdf') => invoke<string[]>('media_pick', { kind }),
  mediaOpen: (path: string) => invoke<void>('media_open', { path }),
  mediaReveal: (path: string) => invoke<void>('media_reveal', { path }),
  captureMediaBytes: (bytes: Uint8Array, name: string) => invoke<StagedMediaResultDto[]>('capture_media_add', bytes, { headers: { 'x-tegg-name': encodeURIComponent(name) } }),
  captureMediaPaths: (paths: string[]) => invoke<StagedMediaResultDto[]>('capture_media_add', { paths }),
  captureMediaPick: () => invoke<StagedMediaResultDto[]>('capture_media_add', { pick: true }),
  /** ms5-tasks §11.6 (D-492): deletes a note only while it is still `base` (a conversion's undo). */
  noteDiscard: (path: string, base: VersionDto) => invoke<void>('note_discard', { path, base }),
  tags: () => invoke<TagDto[]>('index_tags'),
  conflicts: () => invoke<ConflictRowDto[]>('index_conflicts'),
  /** The open note is saved, or the user chose to quit anyway (D-196). */
  appQuit: () => invoke<void>('app_quit'),
  linkResolve: (from: string, targets: string[]) => invoke<LinkTargetDto[]>('link_resolve', { from, targets }),
  openExternal: (url: string) => invoke<void>('open_external', { url }),
  // 3D (ms3-shell §14.3).
  typeGet: (key: string) => invoke<TypeDto | null>('type_get', { key }),
  typeCreate: (name: string, plural: string, folder?: string) => invoke<TypeDto>('type_create', { name, plural, folder: folder ?? null }),
  typePatch: (key: string, base: VersionDto | null, ops: TypeOpDto[]) => invoke<TypeDto>('type_patch', { key, base, ops }),
  typeDelete: (key: string, base: VersionDto) => invoke<string[]>('type_delete', { key, base }),
  typeTemplate: (key: string) => invoke<TypeTemplateDto | null>('type_template', { key }),
  typeUsage: (type: string) => invoke<TypeUsageDto>('type_usage', { type }),
  typeMisfits: (type: string, attr: string, as: AttributeInputDto) => invoke<number>('type_misfits', { type, attr, as }),
  typeRows: (type: string) => invoke<TypeRowDto[]>('index_type_rows', { type }),
  starterPlan: () => invoke<StarterPlanDto>('starter_plan'),
  starterAdd: () => invoke<StarterPlanDto>('starter_add'),
  // 4A (ms4-links §4).
  backlinks: (path: string) => invoke<BacklinksPanelDto>('index_backlinks', { path }),
  brokenLinks: () => invoke<BrokenLinksDto>('index_broken_links'),
  duplicateTitles: () => invoke<DuplicateGroupDto[]>('index_duplicate_titles'),
  linkCreatePlan: (from: string, target: string, relationTo: string[] | null) => invoke<LinkCreatePlanDto>('link_create_plan', { from, target, relationTo }),
  linkCreate: (from: string, target: string, expect: LinkCreatePlanDto, text: string, asType?: string) => invoke<LinkCreatedDto>('link_create', { from, target, expect, text, ...(asType ? { asType } : {}) }),
  // 4B (ms4-daily §4).
  dailyView: (date: string) => invoke<DailyViewDto>('daily_view', { date }),
  dailyDates: (year: number, month: number) => invoke<string[]>('daily_dates', { year, month }),
  dailyDraft: (date: string) => invoke<DailyDraftDto>('daily_draft', { date }),
  dailyCreate: (date: string, text: string) => invoke<DailyCreatedDto>('daily_create', { date, text }),
  dailyBacklinks: (date: string) => invoke<BacklinksPanelDto>('daily_backlinks', { date }),
  dailyContext: (date: string, start: string, end: string, limit: number) => invoke<DailyContextDto>('daily_context', { date, start, end, limit }),
  // 5A-1 (ms5-tasks §3).
  taskList: () => invoke<TaskListDto>('task_list'),
  dailyTasks: (date: string, start: string, end: string, today: string, limit: number) => invoke<DailyTasksDto>('daily_tasks', { date, start, end, today, limit }),
  // 4C (ms4-jobs §4).
  noteRename: (path: string, title: string, fromTitle: string) => invoke<NoteRenameDto>('note_rename', { path, title, fromTitle }),
  jobReport: (jobId: number) => invoke<JobReportDto | null>('job_report', { jobId }),
  jobRetry: (jobId: number, path: string) => invoke<RetryDto>('job_retry', { jobId, path }),
  jobUndo: (jobId: number) => invoke<JobIdDto>('job_undo', { jobId }),
  jobRedo: (jobId: number) => invoke<JobIdDto>('job_redo', { jobId }),
  jobCancel: (jobId: number) => invoke<void>('job_cancel', { jobId }),
  jobTransformResult: (requestId: number, result: unknown) => invoke<void>('job_transform_result', { requestId, result }),
  jobInterrupted: () => invoke<InterruptedDto[]>('job_interrupted'),
  jobResolveInterrupted: (jobId: number, choice: 'finish' | 'undo') => invoke<JobIdDto>('job_resolve_interrupted', { jobId, choice }),
  editorOpen: (path: string) => invoke<void>('editor_open', { path }),
  editorClose: (path: string) => invoke<void>('editor_close', { path }),
  // 4F (ms4-embeds §4): one call per nesting level; records no recency.
  embedLoad: (paths: string[]) => invoke<EmbedNoteDto[]>('embed_load', { paths }),
  // 5B (ms5-capture §5, §7; D-578).
  inboxList: () => invoke<InboxRowDto[]>('inbox_list'),
  inboxCount: () => invoke<number>('inbox_count'),
  inboxBulk: (paths: string[], change: unknown) => invoke<JobIdDto>('inbox_bulk', { paths, change }),
  indexVersions: (paths: string[]) => invoke<(VersionDto | null)[]>('index_versions', { paths }),
  vaultSettings: () => invoke<VaultSettingsDto>('vault_settings'),
  vaultSettingsPatch: (base: VersionDto | null, key: 'default-type' | 'daily-format' | 'attachments', value: string) =>
    invoke<VaultSettingsDto>('vault_settings_patch', { base, key, value }),
  vaultReveal: () => invoke<void>('vault_reveal'),
  shellSettings: () => invoke<ShellSettingsDto>('shell_settings'),
  shellSettingsSet: (settings: ShellSettingsDto) => invoke<void>('shell_settings_set', { settings }),
  hotkeys: () => invoke<HotkeyStateDto[]>('hotkeys'),
  hotkeysRetry: (id: string) => invoke<HotkeyStateDto[]>('hotkeys_retry', { id }),
  captureOpen: (kind: 'default' | 'task') => invoke<void>('capture_open', { kind }),
};

/** `job:transform` (ms4-jobs §2.2, §9): a file for the worker, or (`live`) for the editor that has it open. */
export type JobTransformEvent = { requestId: number; source: string; text: string; ops: unknown[]; live: boolean };

export const events = {
  progress: (f: (p: ProgressDto) => void): Promise<UnlistenFn> => listen<ProgressDto>('index:progress', (e) => f(e.payload)),
  changed: (f: (c: ChangedDto) => void): Promise<UnlistenFn> => listen<ChangedDto>('vault:changed', (e) => f(e.payload)),
  trashChanged: (f: () => void): Promise<UnlistenFn> => listen('trash:changed', () => f()),
  conflict: (f: (c: ConflictDto) => void): Promise<UnlistenFn> => listen<ConflictDto>('note:conflict', (e) => f(e.payload)),
  /** The mouse's back/forward buttons, caught natively (WKWebView doesn't pass them to the page, FR-NAV-03). */
  navMouse: (f: (dir: 'back' | 'forward') => void): Promise<UnlistenFn> => listen<'back' | 'forward'>('nav:mouse', (e) => f(e.payload)),
  /** ⌘Q, the Quit Apple Event or closing the window: flush first (FR-EDT-08 AC-7). */
  quitRequested: (f: () => void): Promise<UnlistenFn> => listen('app:quit-requested', () => f()),
  jobProgress: (f: (p: JobProgressDto) => void): Promise<UnlistenFn> => listen<JobProgressDto>('job:progress', (e) => f(e.payload)),
  jobTransform: (f: (t: JobTransformEvent) => void): Promise<UnlistenFn> => listen<JobTransformEvent>('job:transform', (e) => f(e.payload)),
  // 5B (ms5-capture §1.4, §5.2, §7.1).
  inboxCount: (f: (n: number) => void): Promise<UnlistenFn> => listen<{ count: number }>('inbox:count', (e) => f(e.payload.count)),
  hotkeysState: (f: (s: HotkeyStateDto[]) => void): Promise<UnlistenFn> => listen<HotkeyStateDto[]>('hotkeys:state', (e) => f(e.payload)),
  shellRoute: (f: (route: string) => void): Promise<UnlistenFn> => listen<{ route: string }>('shell:route', (e) => f(e.payload.route)),
};

/** A core error's kind, for the catalog message `error.<kind>` (NFR-OTH-02 AC-2); never its message text. */
export function errorKind(e: unknown): string {
  const k = (e as { kind?: unknown } | null)?.kind;
  return typeof k === 'string' ? k : 'Unknown';
}
