// Generated from app/src-tauri/src/dto.rs by ts-rs. Do not edit: run
// `UPDATE_TYPES=1 cargo test --manifest-path app/src-tauri/Cargo.toml types_file_is_current`.

export type VaultInfo = { name: string, path: string, placeholders: number, 
/**
 * ms4-jobs §8 (D-387): renames a crash interrupted, offered as Finish or Undo; absent when there are none.
 */
interrupted?: Array<InterruptedDto>, };
export type DateRangeDto = { 
/**
 * `YYYY-MM-DD`, inclusive.
 */
from: string, to: string, };
export type SearchQueryDto = { text: string, types: Array<string>, tags: Array<string>, created?: DateRangeDto, modified?: DateRangeDto, review?: string, offset: number, limit: number, };
export type SnippetDto = { text: string, 
/**
 * `[start, end)` in UTF-16 code units of `text`.
 */
highlights: Array<[number, number]>, 
/**
 * 1-based line in the file of the first body match.
 */
line: number, };
export type SearchResultDto = { path: string, type: string, title: string, 
/**
 * `title`, `fileName`, `alias`, `attribute` or `body`.
 */
matched_in: string, 
/**
 * `phrase`, `allWords` or `anyWord` (D-253).
 */
tier: string, typo: boolean, snippet: SnippetDto | null, 
/**
 * The file stem with its matches, only for a `fileName` match (D-254).
 */
file_name: SnippetDto | null, };
export type SearchPageDto = { results: Array<SearchResultDto>, total: number, };
export type SwitcherItemDto = { 
/**
 * `object` or `create`.
 */
kind: string, path: string | null, title: string, type: string, folder: string, matched_alias: string | null, 
/**
 * `created:` of the object, for telling duplicate titles apart in link suggestions (D-203).
 */
created: string | null, 
/**
 * FR-LNK-14 AC-6 (D-289): set when another object shares the title.
 */
duplicate: DuplicateDetailsDto | null, };
export type NoteDto = { path: string, 
/**
 * Decoded with U+FFFD for invalid bytes, for display only (D-180).
 */
text: string, version: VersionDto, utf8: boolean, };
export type ProgressDto = { done: number, total: number, 
/**
 * `running`, `done` or `cancelled`.
 */
state: string, };
export type ChangedDto = { paths: Array<string>, };
export type VersionDto = { 
/**
 * i128 as a decimal string.
 */
mtimeNs: string, size: bigint, 
/**
 * BLAKE3, hex.
 */
hash: string, };
export type WriteResultDto = { 
/**
 * `written` or `unchanged`.
 */
outcome: string, version: VersionDto, };
export type TagDto = { key: string, spelling: string, count: number, };
export type ConflictRowDto = { 
/**
 * `duplicateId`, `possibleCopy` or `nameNormalization`.
 */
kind: string, primary: string, others: Array<string>, versions: { [key in string]?: VersionDto }, };
export type ConflictDto = { path: string, mine: string, theirs: string, theirsVersion: VersionDto, };
export type IpcError = { 
/**
 * `Conflict`, `Gone`, `NotFound`, `NameTaken`, `NotUtf8`, `Io`, `NoVault`, `NotEmpty`, `NotATeggVault`, `Unsupported`;
 * 3D (ms3-shell §14.3): `Rule`, `NewerVersion`, `InvalidType`, `BuiltInChanged`, `ReviewLocked`, `SystemType`,
 * `HasObjects`, `UnknownType`.
 */
kind: string, message: string, 
/**
 * With `Rule`: `empty`, `forbiddenChar`, `keyTaken`, `keyTooLong`, `folderTaken`, `folderInvalid`, `reservedKey`,
 * `attrKeyTaken`, `attrKeyInvalid`, `rangeCollision`, `optionEmpty`, `optionDuplicate`, `optionUsed`, `previewFull`.
 */
reason?: string, 
/**
 * With `Rule`: `name`, `plural`, `folder`, `attrKey`, `attrName` or `optionLabel`.
 */
field?: string, 
/**
 * With `Rule` `reservedKey`: the key.
 */
key?: string, 
/**
 * With `Rule` `optionUsed`: the label.
 */
label?: string, 
/**
 * With `HasObjects`: the number of objects.
 */
count?: number, 
/**
 * With `Conflict` from `type_patch` / `type_delete`: the type as on disk now.
 */
disk?: TypeDto, 
/**
 * With `Exists` from `link_create` (ms4-links §4): the note the target resolves to now.
 */
path?: string, 
/**
 * With `PlanChanged` from `link_create`: the plan as the core makes it now.
 */
now?: LinkCreatePlanDto, };
export type TypeDto = { key: string, name: string, plural: string, folder: string, icon: string, color: string, system: boolean, invalid: boolean, 
/**
 * False: a system type with built-in defaults, no file (D-90).
 */
exists: boolean, 
/**
 * Base for `type_patch` / `type_delete`.
 */
version: VersionDto | null, 
/**
 * `ok`, `newer` or `invalid`.
 */
state: string, error: TypeFileErrorDto | null, declaredVersion: bigint | null, description: string | null, 
/**
 * `off`, `on` or `locked`.
 */
review: string, preview: Array<string>, previewIgnored: Array<string>, 
/**
 * Properties left out of the attribute panel's rows (FR-TYP-17, D-316).
 */
hidden: Array<string>, 
/**
 * The effective default embed mode: `full`, `card` or `link` (D-417, ms4-embeds §3).
 */
embed: string, 
/**
 * The raw `embed` value of the type file, or null when absent.
 */
embedRaw: string | null, template: string | null, attributes: Array<AttributeDto>, };
export type TypeFileErrorDto = { message: string, line: number, };
export type OptionDto = { label: string, color: string | null, 
/**
 * ms5-tasks §2.2 (D-473): a Task status option's `state` as written; null when absent.
 */
state: string | null, };
export type AttributeDto = { key: string, name: string, 
/**
 * R10 string, or the raw string of another type.
 */
type: string, 
/**
 * One of the 12 R10 types.
 */
supported: boolean, 
/**
 * `file`, `color`, `recurrence` or `unsupported` (FR-TYP-02 AC-4, AC-5).
 */
readOnlyReason: string | null, default: unknown | null, required: boolean, options: Array<OptionDto>, to: Array<string> | null, multiple: boolean, description: string | null, builtIn: boolean, };
export type AttributeInputDto = { key: string, name: string, type: string, default: unknown | null, required: boolean, options: Array<OptionDto>, to: Array<string> | null, multiple: boolean, description: string | null, };
export type AttributeChangeDto = { name?: string, type?: string, default?: unknown | null, required?: boolean, options?: Array<OptionDto>, to?: string[] | null, multiple?: boolean, description?: string | null, };
export type TypeOpDto = { "op": "set", field: string, value: string | null, } | { "op": "review", on: boolean, } | { "op": "preview", keys: Array<string>, } | { "op": "hidden", keys: Array<string>, } | { "op": "embed", mode: string, } | { "op": "addAttribute", attribute: AttributeInputDto, } | { "op": "updateAttribute", key: string, change: AttributeChangeDto, } | { "op": "removeAttribute", key: string, } | { "op": "moveAttribute", key: string, to: number, } | { "op": "setOptionState", attr: string, label: string, state: string, } | { "op": "addOption", attr: string, option: OptionDto, } | { "op": "setOptionColor", attr: string, label: string, color: string, } | { "op": "moveOption", attr: string, label: string, to: number, } | { "op": "removeOption", attr: string, label: string, } | { "op": "renameOption", attr: string, from: string, to: string, };
export type TypeUsageDto = { objects: number, values: { [key in string]?: number }, options: { [key in string]?: { [key in string]?: number } }, };
export type TypeRowDto = { path: string, id: string | null, title: string, created: string | null, modified: string | null, values: Record<string, unknown>, links: Array<LinkTargetDto>, typeSingle: boolean, };
export type TypeTemplateDto = { path: string, text: string, };
export type StarterSkipDto = { key: string, 
/**
 * `nameExists` or `folderUsed`.
 */
reason: string, folder?: string, };
export type StarterPlanDto = { add: Array<string>, skip: Array<StarterSkipDto>, skipTemplates: Array<string>, };
export type ObjectRowDto = { path: string, id: string | null, title: string, type: string, modified: string | null, };
export type LastOpenedDto = { path: string, id: string | null, };
export type RecentVaultDto = { name: string, path: string, exists: boolean, };
export type RightPanelDto = { open: boolean, 
/**
 * `backlinks`, `outline` or `graph`.
 */
tab: string, };
export type TypeSortDto = { column: string, 
/**
 * `asc` or `desc`.
 */
dir: string, };
export type UiStateDto = { version: number, 
/**
 * `system`, `light` or `dark`.
 */
theme: string, sidebarOpen: boolean, rightPanel: RightPanelDto, 
/**
 * Attribute strip expanded (FR-TYP-08 AC-5, D-147); a missing field reads as `true`.
 */
propertiesOpen: boolean, 
/**
 * Type page sort per type key (FR-TYP-09 AC-3, D-233, ms3-shell §14.7.1); missing reads as empty.
 */
typeSort: { [key in string]?: TypeSortDto }, 
/**
 * "Other properties" in the attribute panel expanded (D-229); missing reads as collapsed.
 */
otherPropertiesOpen: boolean, 
/**
 * ms5-tasks §6.3 (D-481): the Tasks page's remembered state; missing reads as the defaults.
 */
tasks?: TasksUiDto, 
/**
 * ms5-tasks §11.4 (D-493, D-496): the last conversion type and "Don't ask again"; missing reads as the defaults.
 */
convert?: ConvertUiDto, 
/**
 * ms5-capture §5.2 (5B, FR-SET-03, D-566): Date & time display choices; missing reads as all `region`.
 */
dateTime?: DateTimeUiDto, 
/**
 * ms5-capture §7.4 (5B, D-555): the Inbox's remembered type filter.
 */
inbox?: InboxUiDto, };
export type LinkTargetDto = { target: string, 
/**
 * `note`, `daily`, `date-missing` or `unresolved`.
 */
kind: string, path: string | null, title: string | null, type: string | null, };
export type AtDto = { line: number, byte: number, };
export type ExcerptSegDto = { "kind": "text", text: string, marks: Array<string>, } | { "kind": "link", text: string, target: LinkTargetDto, here: boolean, marks: Array<string>, };
export type ExcerptDto = { segments: Array<ExcerptSegDto>, cutStart: boolean, cutEnd: boolean, };
export type OccurrenceDto = { 
/**
 * `body`, `attribute` or `embed`.
 */
kind: string, attribute: string | null, attributeName: string | null, at: AtDto, excerpt: ExcerptDto, };
export type BacklinkEntryDto = { source: string, title: string, type: string, modified: string | null, readOnly: boolean, occurrences: Array<OccurrenceDto>, };
export type BacklinkGroupDto = { type: string, defined: boolean, raw: string, entries: Array<BacklinkEntryDto>, };
export type BacklinksPanelDto = { objects: number, groups: Array<BacklinkGroupDto>, };
export type LinkCreatePlanDto = { "state": "create", path: string, title: string, type: string, rewrite: string | null, } | { "state": "exists", path: string, } | { "state": "forbidden", reason: string, };
export type BrokenGroupDto = { key: string, label: string, count: number, create: LinkCreatePlanDto, sources: Array<BacklinkEntryDto>, };
export type BrokenLinksDto = { occurrences: number, objects: number, groups: Array<BrokenGroupDto>, };
export type DuplicateDetailsDto = { created: string | null, preview: Array<[string, unknown]>, stem: string | null, };
export type DuplicateObjectDto = { path: string, title: string, type: string, folder: string, details: DuplicateDetailsDto, backlinks: number, };
export type DuplicateGroupDto = { key: string, label: string, objects: Array<DuplicateObjectDto>, };
export type LinkCreatedDto = { path: string, rewrite: string | null, };
export type DailyViewDto = { 
/**
 * `YYYY-MM-DD`.
 */
date: string, 
/**
 * The winner's path, or null: the note is virtual.
 */
path: string | null, duplicates: Array<string>, 
/**
 * `unreviewed` | `reviewed` | null.
 */
review: string | null, };
export type DailyDraftDto = { 
/**
 * The complete first-write bytes for an empty edit, with `{{id}}` / `{{now}}` placeholders.
 */
text: string, 
/**
 * The part after the frontmatter: the editor's virtual content.
 */
body: string, templateInvalid: string | null, path: string, formatFallback: boolean, };
export type ContextRowDto = { path: string, title: string, type: string, at: string, };
export type DailyContextDto = { quickNotes: Array<ContextRowDto>, created: Array<ContextRowDto>, modified: Array<ContextRowDto>, totals: [number, number, number], };
export type DailyCreatedDto = { path: string, version: VersionDto, duplicates: Array<string>, };
export type EmbedNoteDto = { path: string, 
/**
 * `ok`, `missing` or `io`.
 */
state: string, 
/**
 * Decoded with U+FFFD for invalid bytes (D-180).
 */
text: string | null, version: VersionDto | null, utf8: boolean, 
/**
 * Resolution of the file's link targets from its own path, in `linkTargets` order.
 */
links: Array<LinkTargetDto>, };
export type NoteRenameDto = { jobId: number, 
/**
 * The planned path; the final one is in the report.
 */
toPath: string, };
export type JobIdDto = { jobId: number, };
export type JobCountsDto = { written: number, unchanged: number, skipped: number, };
export type JobProgressDto = { jobId: number, kind: string, phase: string, done: number, total: number, counts?: JobCountsDto, };
export type RenamedDto = { from: string, to: string, };
export type SkippedDto = { path: string, reason: string, };
export type JobReportDto = { jobId: number, kind: string, 
/**
 * `done` | `cancelled` | `failed`.
 */
phase: string, renamed?: RenamedDto, written: Array<string>, unchanged: Array<string>, skipped: Array<SkippedDto>, error?: string, };
export type RetryDto = { outcome: string, reason?: string, };
export type EditDto = { start: number, end: number, };
export type TransformedDto = { kind?: string, text?: string, edits?: Array<EditDto>, error?: string, };
export type InterruptedDto = { jobId: number, from: string, to: string, done: number, total: number, };
export type BackupDto = { name: string, kind: string, 
/**
 * ISO 8601 with offset.
 */
time: string, };
export type TasksUiDto = { 
/**
 * `schedule` or `kanban`.
 */
view: string, 
/**
 * `status` or `tag`.
 */
groupBy: string, 
/**
 * `all`, `today` or `week`.
 */
dateFilter: string, tags: Array<string>, doneExpanded: boolean, };
export type ConvertUiDto = { 
/**
 * Type key of the last conversion on this machine; null before the first (preselection Task, D-493).
 */
lastType: string | null, 
/**
 * FR-CNV-08 AC-2 `Don't ask again`.
 */
skipRemoveConfirm: boolean, };
export type TaskRowDto = { path: string, id: string | null, title: string, status: string | null, state: string, statusKnown: boolean, priority: string | null, priorityRank: number, dueRaw: string | null, 
/**
 * `YYYY-MM-DD` when valid (D-484).
 */
due: string | null, completed: string | null, tags: Array<string>, fmTags: Array<string>, source: LinkTargetDto | null, excerpt: string, created: string | null, modified: string | null, version: VersionDto, readOnly: boolean, };
export type StatusOptionDto = { label: string, color: string | null, state: string, stateRaw: string | null, };
export type UnknownStateDto = { label: string, state: string | null, };
export type TaskDefsDto = { statuses: Array<StatusOptionDto>, priorities: Array<OptionDto>, unknownStates: Array<UnknownStateDto>, };
export type TaskListDto = { tasks: Array<TaskRowDto>, defs: TaskDefsDto, };
export type DailyTasksDto = { overdue: Array<TaskRowDto>, due: Array<TaskRowDto>, completed: Array<TaskRowDto>, total: number, };
export type DateTimeUiDto = { date: string, time: string, week: string, };
export type InboxUiDto = { filter: string, };
export type CaptureVaultDto = { id: string, name: string, color: string | null, };
export type CaptureTypeDto = { key: string, name: string, icon: string, color: string, folder: string, 
/**
 * `off`, `on` or `locked`.
 */
review: string, attributes: Array<AttributeDto>, 
/**
 * D-567: the default template's frontmatter block only, `---` lines included, no body.
 */
templateHead: string | null, };
export type CaptureContextDto = { vault: CaptureVaultDto | null, types: Array<CaptureTypeDto>, defaultType: string, tags: Array<string>, };
export type CapturedDto = { path: string, title: string, typeName: string, };
export type CaptureDraftDto = { text: string, type: string, tags: Array<string>, due: string | null, priority: string | null, savedAt: string, };
export type DefaultTypeDto = { raw: string | null, key: string, valid: boolean, };
export type VaultSettingsDto = { version: VersionDto | null, defaultType: DefaultTypeDto, dailyFormat: string, attachments: string, };
export type ShellSettingsDto = { showStatusItem: boolean, openAtLogin: boolean, };
export type HotkeyStateDto = { id: string, keys: string, state: string, };
export type InboxRowDto = { path: string, id: string | null, title: string, type: string, reviewRaw: string | null, captured: string | null, created: string | null, modified: string | null, tags: Array<string>, excerpt: string, readOnly: boolean, };
export type TypeDefDto = TypeDto;
