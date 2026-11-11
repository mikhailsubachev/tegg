// Generated from app/src-tauri/src/dto.rs by ts-rs. Do not edit: run
// `UPDATE_TYPES=1 cargo test --manifest-path app/src-tauri/Cargo.toml types_file_is_current`.

export type VaultInfo = { name: string, path: string, placeholders: number, 
/**
 * ms4-jobs §8 (D-387): renames a crash interrupted, offered as Finish or Undo; absent when there are none.
 */
interrupted?: Array<InterruptedDto>, 
/**
 * Slice PW (page-width.md §2, AP-754): the vault's default page width (`normal` | `wide`), read with the vault so
 * opening it sends no extra command; the UI reads `vault_settings` again when `.tegg/vault.yml` changes.
 */
pageWidth?: string, };
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
file_name: SnippetDto | null, 
/**
 * Frontmatter `modified` as written (ISO 8601 with offset), else null (D-1206).
 */
modified: string | null, 
/**
 * Tag keys, NFC lower case (D-1211).
 */
tags: Array<string>, 
/**
 * `[start, end)` in UTF-16 code units of `title` (D-1210, D-1223).
 */
title_highlights: Array<[number, number]>, 
/**
 * The matched alias, only for an `alias` match; `line` 0 (D-1209).
 */
alias: SnippetDto | null, 
/**
 * The matched attribute, only for an `attribute` match (D-1208).
 */
attribute: AttributeHitDto | null, };
export type AttributeHitDto = { 
/**
 * The frontmatter key as written.
 */
key: string, 
/**
 * The matched value as written; `line` 0.
 */
value: SnippetDto, };
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
now?: LinkCreatePlanDto, 
/**
 * With `InvalidName` (ms4-tags §4.1): `empty`, `space`, `digits` or `char`.
 */
error?: string, 
/**
 * With `InvalidName` `char`: the first refused character.
 */
char?: string, 
/**
 * With `TagExists`: the existing tag's display name.
 */
name?: string, };
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
 * The type page's columns after Title as written; null when the key is absent (D-1240, type-columns §2).
 */
columns: Array<string> | null, 
/**
 * `columns` entries that are neither properties nor universal keys (D-1245).
 */
columnsIgnored: Array<string>, 
/**
 * `columns` is present but not a list of strings: the Columns menu is disabled (D-1245).
 */
columnsUnreadable: boolean, 
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
export type TypeOpDto = { "op": "set", field: string, value: string | null, } | { "op": "review", on: boolean, } | { "op": "preview", keys: Array<string>, } | { "op": "columns", keys: Array<string>, } | { "op": "hidden", keys: Array<string>, } | { "op": "embed", mode: string, } | { "op": "addAttribute", attribute: AttributeInputDto, } | { "op": "updateAttribute", key: string, change: AttributeChangeDto, } | { "op": "removeAttribute", key: string, } | { "op": "moveAttribute", key: string, to: number, } | { "op": "setOptionState", attr: string, label: string, state: string, } | { "op": "addOption", attr: string, option: OptionDto, } | { "op": "setOptionColor", attr: string, label: string, color: string, } | { "op": "moveOption", attr: string, label: string, to: number, } | { "op": "removeOption", attr: string, label: string, } | { "op": "renameOption", attr: string, from: string, to: string, };
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
tab: string, 
/**
 * D-634: the panel's width in px (240…480); absent until the user resizes it, read as 288.
 */
width?: number, };
export type TypeSortDto = { column: string, 
/**
 * `asc` or `desc`.
 */
dir: string, };
export type QueriesUiDto = { sort?: string, };
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
 * Slice PW (docs/contracts/page-width.md §1, AP-753): the chosen page width per note (`normal` | `wide`), keyed by
 * the object's `id`, else by its NFC vault-relative path; missing reads as empty.
 */
noteWidth?: { [key in string]?: string }, 
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
inbox?: InboxUiDto, 
/**
 * ms4-tags §6.1 (D-703): the tag page's sort, Type filter and grouping, shared by all tags.
 */
tagPage?: TagPageUiDto, 
/**
 * ms4-tags §6.1 (D-703): the All tags sort.
 */
tagsSort?: SortUiDto, 
/**
 * Slice P (v1-previews §1, D-922, D-923): the Object preview setting and the last popover size; missing reads as
 * the defaults.
 */
preview?: PreviewUiDto, 
/**
 * Type-page column widths in px per type key, then column key (`title` included); machine-local, never in the
 * vault (D-1241, type-columns §2); missing reads as empty.
 */
typeColumnWidths?: { [key in string]?: { [key in string]?: number } }, 
/**
 * Per-vault state by the vault's NFC path, kept as the UI wrote it: the graph views (v1-graph §5) and the Pinned
 * section's collapse (v1-pinned §4, D-1383). Machine-local, never in the vault.
 */
vaults?: Record<string, unknown>, 
/**
 * Slice Q (v1-queries §4.6, D-1485): the Queries page's sort (`created-desc` | `created-asc` | `updated-desc` |
 * `updated-asc` | `title`); missing reads as `created-desc`.
 */
queries?: QueriesUiDto, };
export type LinkTargetDto = { target: string, 
/**
 * `note`, `daily`, `date-missing` or `unresolved`.
 */
kind: string, path: string | null, title: string | null, type: string | null, 
/**
 * D-601: the target's `review`, `status`, `due` and `completed` (trimmed strings), for its chip. Only
 * `link_resolve` fills them; other payloads send null.
 */
review?: string | null, status?: string | null, due?: string | null, completed?: string | null, 
/**
 * ms6-trash-media §2, §3.2 (6A): with kind `media`, the live Image or PDF object of the file, else null.
 */
object?: string | null, };
export type AtDto = { line: number, byte: number, };
export type ExcerptSegDto = { "kind": "text", text: string, marks: Array<string>, } | { "kind": "link", text: string, target: LinkTargetDto, here: boolean, marks: Array<string>, };
export type ExcerptDto = { segments: Array<ExcerptSegDto>, cutStart: boolean, cutEnd: boolean, };
export type OccurrenceDto = { 
/**
 * `body`, `attribute` or `embed`.
 */
kind: string, attribute: string | null, attributeName: string | null, at: AtDto, excerpt: ExcerptDto, };
export type BacklinkEntryDto = { source: string, title: string, type: string, modified: string | null, readOnly: boolean, occurrences: Array<OccurrenceDto>, 
/**
 * D-633: the source's trimmed `review`, `status`, `due`, `completed` (D-601), for the panel's chip.
 */
review: string | null, status: string | null, due: string | null, completed: string | null, };
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
phase: string, renamed?: RenamedDto, written: Array<string>, unchanged: Array<string>, skipped: Array<SkippedDto>, error?: string, 
/**
 * ms4-jobs §14.7: the moves of a `type-move` or `folder-move` job.
 */
moved: Array<RenamedDto>, 
/**
 * ms4-jobs §14.9.6 (4E-2): a `type-delete` that skipped an object kept the type (FR-TYP-05 AC-9).
 */
keptType: boolean, };
export type RetryDto = { outcome: string, reason?: string, };
export type EditDto = { start: number, end: number, };
export type TransformedDto = { kind?: string, text?: string, edits?: Array<EditDto>, error?: string, };
export type InterruptedDto = { jobId: number, 
/**
 * `rename` or `type-move` (ms4-jobs §14.6).
 */
kind: string, title: string | null, from: string, to: string, done: number, total: number, };
export type BackupLabelDto = { key: string, args: Record<string, string | number>, };
export type BackupDto = { name: string, kind: string, 
/**
 * ISO 8601 with offset.
 */
time: string, 
/**
 * ms4-tags §5.2 (D-724): the catalog key and arguments of the operation label.
 */
label: BackupLabelDto, files: number, };
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
export type SortUiDto = { column: string, dir: string, };
export type TagPageUiDto = { sort: SortUiDto, type: string | null, grouping: string, };
export type PreviewUiDto = { mode?: string, hoverDelay?: number, width?: number, height?: number, };
export type CaptureVaultDto = { id: string, name: string, color: string | null, };
export type CaptureTypeDto = { key: string, name: string, icon: string, color: string, folder: string, 
/**
 * `off`, `on` or `locked`.
 */
review: string, attributes: Array<AttributeDto>, 
/**
 * D-567: the default template's frontmatter block only, `---` lines included, no body.
 */
templateHead: string | null, 
/**
 * D-604: the type's plural, for `Saves to <plural>` on types without the review workflow.
 */
plural?: string, };
export type CaptureContextDto = { vault: CaptureVaultDto | null, types: Array<CaptureTypeDto>, defaultType: string, tags: Array<CaptureTagDto>, };
export type CaptureSuggestDto = { 
/**
 * The link text to insert (the stem when it is unique in the vault, else the path without `.md`).
 */
link: string, title: string, type: string, 
/**
 * The matched alias, if the match was by alias.
 */
alias: string | null, };
export type CapturedDto = { path: string, title: string, typeName: string, };
export type CaptureDraftDto = { text: string, type: string, tags: Array<string>, due: string | null, priority: string | null, savedAt: string, };
export type DefaultTypeDto = { raw: string | null, key: string, valid: boolean, };
export type VaultSettingsDto = { version: VersionDto | null, defaultType: DefaultTypeDto, dailyFormat: string, attachments: string, 
/**
 * Slice PW (docs/contracts/page-width.md §2, AP-754): `normal` or `wide`; missing or unknown reads as `normal`.
 */
pageWidth: string, };
export type ShellSettingsDto = { showStatusItem: boolean, openAtLogin: boolean, };
export type HotkeyStateDto = { id: string, keys: string, state: string, };
export type InboxRowDto = { path: string, id: string | null, title: string, type: string, reviewRaw: string | null, captured: string | null, created: string | null, modified: string | null, tags: Array<string>, excerpt: string, readOnly: boolean, 
/**
 * The base of a single Inbox action (ms5-capture §7.3).
 */
version: VersionDto, };
export type TrashEntryDto = { path: string, 
/**
 * `object`, `file` or `folder`.
 */
kind: string, original: string, folder: string, title: string, type: string | null, files: Array<string>, count: number, 
/**
 * ISO instant with the vault zone's offset of the entry's `ctime` (R71).
 */
trashedAt: string, };
export type MovedDto = { from: string, to: string, };
export type TrashFailedDto = { path: string, reason: string, };
export type TrashRemovalDto = { removed: Array<string>, failed: Array<TrashFailedDto>, };
export type MediaAddedDto = { file: string, object: string, title: string, embed: string, mediaType: string, 
/**
 * Bytes (at most 200 MB, D-625).
 */
size: number, width: number | null, height: number | null, pages: number | null, };
export type MediaAddResultDto = { ok: MediaAddedDto, } | { error: string, name: string, };
export type StagedMediaDto = { token: string, name: string, mediaType: string, 
/**
 * Bytes (at most 200 MB, D-625).
 */
size: number, width: number | null, height: number | null, pages: number | null, };
export type StagedMediaResultDto = { ok: StagedMediaDto, } | { error: string, name: string, };
export type TagFileDto = { path: string, version: VersionDto, };
export type TagRowDto = { key: string, name: string, file: TagFileDto | null, losers: Array<string>, color: string | null, colorRaw: string | null, count: number, lastUsed: string | null, 
/**
 * i128 as a decimal string.
 */
lastUsedNs: string | null, };
export type TagObjectRowDto = { path: string, id: string | null, title: string, type: string, modified: string | null, modifiedNs: string | null, tags: Array<string>, review: string | null, status: string | null, due: string | null, completed: string | null, };
export type TagUsageDto = { notes: number, templates: number, file: string | null, losers: Array<string>, };
export type TagNewPathDto = { path: string, };
export type CaptureTagDto = { name: string, color: string | null, };
export type JobStartDto = { jobId: number | null, };
export type RenamePairDto = { from: string, to: string, };
export type PlanWarningDto = { kind: string, path: string, };
export type MergeConflictDto = { key: string, kept: string, others: Array<string>, };
export type JobPlanDto = { jobId: number, kind: string, files: number, templates: number, 
/**
 * ms4-jobs §14.9.2 (4E-2): objects of the type with the key but no value (FR-TYP-04 AC-6).
 */
empty: number, renames: Array<RenamePairDto>, trashes: Array<string>, warnings: Array<PlanWarningDto>, conflicts: Array<MergeConflictDto>, };
export type TypeDefDto = TypeDto;
