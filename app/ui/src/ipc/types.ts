// Generated from app/src-tauri/src/dto.rs by ts-rs. Do not edit: run
// `UPDATE_TYPES=1 cargo test --manifest-path app/src-tauri/Cargo.toml types_file_is_current`.

export type VaultInfo = { name: string, path: string, placeholders: number, };
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
hidden: Array<string>, template: string | null, attributes: Array<AttributeDto>, };
export type TypeFileErrorDto = { message: string, line: number, };
export type OptionDto = { label: string, color: string | null, };
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
export type TypeOpDto = { "op": "set", field: string, value: string | null, } | { "op": "review", on: boolean, } | { "op": "preview", keys: Array<string>, } | { "op": "hidden", keys: Array<string>, } | { "op": "addAttribute", attribute: AttributeInputDto, } | { "op": "updateAttribute", key: string, change: AttributeChangeDto, } | { "op": "removeAttribute", key: string, } | { "op": "moveAttribute", key: string, to: number, };
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
otherPropertiesOpen: boolean, };
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
export type TypeDefDto = TypeDto;
