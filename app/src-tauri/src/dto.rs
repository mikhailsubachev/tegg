//! IPC payloads (docs/contracts/ms2-shell.md §2, ms3-shell.md §2). TypeScript types are generated from these by `ts-rs` into
//! `app/ui/src/ipc/types.ts`; the `types_file_is_current` test fails when the checked-in file is stale.
//! Text offsets sent to the UI are UTF-16 code units (JavaScript strings), not Rust bytes.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Debug, Clone, Serialize, TS)]
pub struct VaultInfo {
    pub name: String,
    pub path: String,
    pub placeholders: u32,
    /// ms4-jobs §8 (D-387): renames a crash interrupted, offered as Finish or Undo; absent when there are none.
    #[ts(optional)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub interrupted: Option<Vec<InterruptedDto>>,
    /// Slice PW (page-width.md §2, AP-754): the vault's default page width (`normal` | `wide`), read with the vault so
    /// opening it sends no extra command; the UI reads `vault_settings` again when `.tegg/vault.yml` changes.
    #[ts(optional, rename = "pageWidth")]
    #[serde(rename = "pageWidth", skip_serializing_if = "Option::is_none")]
    pub page_width: Option<String>,
}

#[derive(Debug, Clone, Deserialize, TS)]
pub struct DateRangeDto {
    /// `YYYY-MM-DD`, inclusive.
    pub from: String,
    pub to: String,
}

#[derive(Debug, Clone, Deserialize, TS)]
pub struct SearchQueryDto {
    pub text: String,
    #[serde(default)]
    pub types: Vec<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    #[ts(optional)]
    pub created: Option<DateRangeDto>,
    #[ts(optional)]
    pub modified: Option<DateRangeDto>,
    #[ts(optional)]
    pub review: Option<String>,
    #[serde(default)]
    pub offset: u32,
    #[serde(default)]
    pub limit: u32,
}

#[derive(Debug, Clone, Serialize, TS)]
pub struct SnippetDto {
    pub text: String,
    /// `[start, end)` in UTF-16 code units of `text`.
    pub highlights: Vec<(u32, u32)>,
    /// 1-based line in the file of the first body match.
    pub line: u32,
}

#[derive(Debug, Clone, Serialize, TS)]
pub struct SearchResultDto {
    pub path: String,
    #[serde(rename = "type")]
    #[ts(rename = "type")]
    pub type_key: String,
    pub title: String,
    /// `title`, `fileName`, `alias`, `attribute` or `body`.
    pub matched_in: String,
    /// `phrase`, `allWords` or `anyWord` (D-253).
    pub tier: String,
    pub typo: bool,
    pub snippet: Option<SnippetDto>,
    /// The file stem with its matches, only for a `fileName` match (D-254).
    pub file_name: Option<SnippetDto>,
}

#[derive(Debug, Clone, Serialize, TS)]
pub struct SearchPageDto {
    pub results: Vec<SearchResultDto>,
    pub total: u32,
}

#[derive(Debug, Clone, Serialize, TS)]
pub struct SwitcherItemDto {
    /// `object` or `create`.
    pub kind: String,
    pub path: Option<String>,
    pub title: String,
    #[serde(rename = "type")]
    #[ts(rename = "type")]
    pub type_key: String,
    pub folder: String,
    pub matched_alias: Option<String>,
    /// `created:` of the object, for telling duplicate titles apart in link suggestions (D-203).
    pub created: Option<String>,
    /// FR-LNK-14 AC-6 (D-289): set when another object shares the title.
    pub duplicate: Option<DuplicateDetailsDto>,
}

#[derive(Debug, Clone, Serialize, TS)]
pub struct NoteDto {
    pub path: String,
    /// Decoded with U+FFFD for invalid bytes, for display only (D-180).
    pub text: String,
    pub version: VersionDto,
    pub utf8: bool,
}

/// One embedded file as `embed_load` returns it (ms4-embeds §4, D-429).
#[derive(Debug, Clone, Serialize, TS)]
pub struct EmbedNoteDto {
    pub path: String,
    /// `ok`, `missing` or `io`.
    pub state: String,
    /// Decoded with U+FFFD for invalid bytes (D-180).
    pub text: Option<String>,
    pub version: Option<VersionDto>,
    pub utf8: bool,
    /// Resolution of the file's link targets from its own path, in `linkTargets` order.
    pub links: Vec<LinkTargetDto>,
}

/// A file version (ms3-shell §13.2): equality is `size` + `hash` (D-175).
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct VersionDto {
    /// i128 as a decimal string.
    pub mtime_ns: String,
    pub size: u64,
    /// BLAKE3, hex.
    pub hash: String,
}

#[derive(Debug, Clone, Serialize, TS)]
pub struct WriteResultDto {
    /// `written` or `unchanged`.
    pub outcome: String,
    pub version: VersionDto,
}

#[derive(Debug, Clone, Serialize, TS)]
pub struct TagDto {
    pub key: String,
    pub spelling: String,
    pub count: u32,
}

#[derive(Debug, Clone, Serialize, TS)]
pub struct ConflictRowDto {
    /// `duplicateId`, `possibleCopy` or `nameNormalization`.
    pub kind: String,
    pub primary: String,
    pub others: Vec<String>,
    pub versions: std::collections::BTreeMap<String, VersionDto>,
}

#[derive(Debug, Clone, Serialize, TS)]
pub struct ProgressDto {
    pub done: u32,
    pub total: u32,
    /// `running`, `done` or `cancelled`.
    pub state: String,
}

#[derive(Debug, Clone, Serialize, TS)]
pub struct ChangedDto {
    pub paths: Vec<String>,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct ConflictDto {
    pub path: String,
    pub mine: String,
    pub theirs: String,
    pub theirs_version: VersionDto,
}

#[derive(Debug, Clone, Serialize, TS)]
pub struct IpcError {
    /// `Conflict`, `Gone`, `NotFound`, `NameTaken`, `NotUtf8`, `Io`, `NoVault`, `NotEmpty`, `NotATeggVault`, `Unsupported`;
    /// 3D (ms3-shell §14.3): `Rule`, `NewerVersion`, `InvalidType`, `BuiltInChanged`, `ReviewLocked`, `SystemType`,
    /// `HasObjects`, `UnknownType`.
    pub kind: String,
    pub message: String,
    /// With `Conflict` from `note_write`: both versions (D-202).
    #[serde(flatten, skip_serializing_if = "Option::is_none")]
    #[ts(skip)]
    pub conflict: Option<ConflictDto>,
    /// With `Rule`: `empty`, `forbiddenChar`, `keyTaken`, `keyTooLong`, `folderTaken`, `folderInvalid`, `reservedKey`,
    /// `attrKeyTaken`, `attrKeyInvalid`, `rangeCollision`, `optionEmpty`, `optionDuplicate`, `optionUsed`, `previewFull`.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub reason: Option<String>,
    /// With `Rule`: `name`, `plural`, `folder`, `attrKey`, `attrName` or `optionLabel`.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub field: Option<String>,
    /// With `Rule` `reservedKey`: the key.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub key: Option<String>,
    /// With `Rule` `optionUsed`: the label.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub label: Option<String>,
    /// With `HasObjects`: the number of objects.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub count: Option<u32>,
    /// With `Conflict` from `type_patch` / `type_delete`: the type as on disk now.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub disk: Option<Box<TypeDto>>,
    /// With `Exists` from `link_create` (ms4-links §4): the note the target resolves to now.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub path: Option<String>,
    /// With `PlanChanged` from `link_create`: the plan as the core makes it now.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub now: Option<Box<LinkCreatePlanDto>>,
    /// With `InvalidName` (ms4-tags §4.1): `empty`, `space`, `digits` or `char`.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub error: Option<String>,
    /// With `InvalidName` `char`: the first refused character.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub char: Option<String>,
    /// With `TagExists`: the existing tag's display name.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub name: Option<String>,
}

/// A type as `vault_types` / `type_get` return it (ms3-shell §14.3): the 3A `TypeDefDto` fields (§2) plus the
/// definition. `TypeDefDto` is an alias of it.
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct TypeDto {
    pub key: String,
    pub name: String,
    pub plural: String,
    pub folder: String,
    pub icon: String,
    pub color: String,
    pub system: bool,
    pub invalid: bool,
    /// False: a system type with built-in defaults, no file (D-90).
    pub exists: bool,
    /// Base for `type_patch` / `type_delete`.
    pub version: Option<VersionDto>,
    /// `ok`, `newer` or `invalid`.
    pub state: String,
    pub error: Option<TypeFileErrorDto>,
    pub declared_version: Option<i64>,
    pub description: Option<String>,
    /// `off`, `on` or `locked`.
    pub review: String,
    pub preview: Vec<String>,
    pub preview_ignored: Vec<String>,
    /// Properties left out of the attribute panel's rows (FR-TYP-17, D-316).
    pub hidden: Vec<String>,
    /// The effective default embed mode: `full`, `card` or `link` (D-417, ms4-embeds §3).
    pub embed: String,
    /// The raw `embed` value of the type file, or null when absent.
    pub embed_raw: Option<String>,
    pub template: Option<String>,
    pub attributes: Vec<AttributeDto>,
}

/// Why a type file is invalid (AR-07 AC-4): message and 1-based line.
#[derive(Debug, Clone, Serialize, TS)]
pub struct TypeFileErrorDto {
    pub message: String,
    pub line: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct OptionDto {
    pub label: String,
    #[serde(default)]
    pub color: Option<String>,
    /// ms5-tasks §2.2 (D-473): a Task status option's `state` as written; null when absent.
    #[serde(default)]
    pub state: Option<String>,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct AttributeDto {
    pub key: String,
    pub name: String,
    /// R10 string, or the raw string of another type.
    #[serde(rename = "type")]
    #[ts(rename = "type")]
    pub type_key: String,
    /// One of the 12 R10 types.
    pub supported: bool,
    /// `file`, `color`, `recurrence` or `unsupported` (FR-TYP-02 AC-4, AC-5).
    pub read_only_reason: Option<String>,
    #[ts(type = "unknown | null")]
    pub default: Option<serde_json::Value>,
    pub required: bool,
    pub options: Vec<OptionDto>,
    pub to: Option<Vec<String>>,
    pub multiple: bool,
    pub description: Option<String>,
    pub built_in: bool,
}

/// A new property (`addAttribute`) or the shape `type_misfits` checks against.
#[derive(Debug, Clone, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct AttributeInputDto {
    pub key: String,
    pub name: String,
    #[serde(rename = "type")]
    #[ts(rename = "type")]
    pub type_key: String,
    #[serde(default)]
    #[ts(type = "unknown | null")]
    pub default: Option<serde_json::Value>,
    #[serde(default)]
    pub required: bool,
    #[serde(default)]
    pub options: Vec<OptionDto>,
    #[serde(default)]
    pub to: Option<Vec<String>>,
    #[serde(default)]
    pub multiple: bool,
    #[serde(default)]
    pub description: Option<String>,
}

/// Absent = unchanged, `null` = cleared (for `default`, `to`, `description`).
fn present<'de, D: serde::Deserializer<'de>, T: Deserialize<'de>>(d: D) -> Result<Option<Option<T>>, D::Error> {
    Ok(Some(Option::deserialize(d)?))
}

#[derive(Debug, Clone, Default, Deserialize, TS)]
pub struct AttributeChangeDto {
    #[serde(default)]
    #[ts(optional)]
    pub name: Option<String>,
    #[serde(default, rename = "type")]
    #[ts(optional, rename = "type")]
    pub type_key: Option<String>,
    #[serde(default, deserialize_with = "present")]
    #[ts(optional, type = "unknown | null")]
    pub default: Option<Option<serde_json::Value>>,
    #[serde(default)]
    #[ts(optional)]
    pub required: Option<bool>,
    #[serde(default)]
    #[ts(optional)]
    pub options: Option<Vec<OptionDto>>,
    #[serde(default, deserialize_with = "present")]
    #[ts(optional, type = "string[] | null")]
    pub to: Option<Option<Vec<String>>>,
    #[serde(default)]
    #[ts(optional)]
    pub multiple: Option<bool>,
    #[serde(default, deserialize_with = "present")]
    #[ts(optional, type = "string | null")]
    pub description: Option<Option<String>>,
}

/// One change of a type file (ms3-shell §14.3); one `type_patch` call = at most one write.
#[derive(Debug, Clone, Deserialize, TS)]
#[serde(tag = "op", rename_all = "camelCase")]
#[ts(tag = "op", rename_all = "camelCase")]
pub enum TypeOpDto {
    /// `field`: `name`, `plural`, `folder`, `icon`, `color` or `description`.
    Set { field: String, value: Option<String> },
    Review { on: bool },
    Preview { keys: Vec<String> },
    /// FR-TYP-17, D-316.
    Hidden { keys: Vec<String> },
    /// D-417 (ms4-embeds §3): `full`, `card` or `link`.
    Embed { mode: String },
    AddAttribute { attribute: AttributeInputDto },
    UpdateAttribute { key: String, change: AttributeChangeDto },
    RemoveAttribute { key: String },
    MoveAttribute { key: String, to: u32 },
    // ms5-tasks §2.2, §3 (D-473): option ops, one line each.
    SetOptionState { attr: String, label: String, state: String },
    AddOption { attr: String, option: OptionDto },
    SetOptionColor { attr: String, label: String, color: String },
    MoveOption { attr: String, label: String, to: u32 },
    RemoveOption { attr: String, label: String },
    RenameOption { attr: String, from: String, to: String },
}

#[derive(Debug, Clone, Serialize, TS)]
pub struct TypeUsageDto {
    pub objects: u32,
    pub values: std::collections::BTreeMap<String, u32>,
    pub options: std::collections::BTreeMap<String, std::collections::BTreeMap<String, u32>>,
}

/// One type-page row (FR-TYP-09 AC-2, D-233).
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct TypeRowDto {
    pub path: String,
    pub id: Option<String>,
    pub title: String,
    pub created: Option<String>,
    pub modified: Option<String>,
    #[ts(type = "Record<string, unknown>")]
    pub values: serde_json::Map<String, serde_json::Value>,
    pub links: Vec<LinkTargetDto>,
    pub type_single: bool,
}

#[derive(Debug, Clone, Serialize, TS)]
pub struct TypeTemplateDto {
    pub path: String,
    pub text: String,
}

#[derive(Debug, Clone, Serialize, TS)]
pub struct StarterSkipDto {
    pub key: String,
    /// `nameExists` or `folderUsed`.
    pub reason: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub folder: Option<String>,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct StarterPlanDto {
    pub add: Vec<String>,
    pub skip: Vec<StarterSkipDto>,
    pub skip_templates: Vec<String>,
}

#[derive(Debug, Clone, Serialize, TS)]
pub struct ObjectRowDto {
    pub path: String,
    pub id: Option<String>,
    pub title: String,
    #[serde(rename = "type")]
    #[ts(rename = "type")]
    pub type_key: String,
    pub modified: Option<String>,
}

/// D-219: one recent vault for the title-bar switcher (ms3-shell §12.5).
#[derive(Debug, Clone, Serialize, TS)]
pub struct RecentVaultDto {
    pub name: String,
    pub path: String,
    pub exists: bool,
}

#[derive(Debug, Clone, Serialize, TS)]
pub struct LastOpenedDto {
    pub path: String,
    pub id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct RightPanelDto {
    pub open: bool,
    /// `backlinks`, `outline` or `graph`.
    pub tab: String,
    /// D-634: the panel's width in px (240…480); absent until the user resizes it, read as 288.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub width: Option<u32>,
}

/// Machine-local display state (D-128), `<Application Support>/ui-state.json`.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct UiStateDto {
    pub version: u32,
    /// `system`, `light` or `dark`.
    pub theme: String,
    pub sidebar_open: bool,
    pub right_panel: RightPanelDto,
    /// Attribute strip expanded (FR-TYP-08 AC-5, D-147); a missing field reads as `true`.
    #[serde(default = "yes")]
    pub properties_open: bool,
    /// Type page sort per type key (FR-TYP-09 AC-3, D-233, ms3-shell §14.7.1); missing reads as empty.
    #[serde(default)]
    pub type_sort: std::collections::BTreeMap<String, TypeSortDto>,
    /// "Other properties" in the attribute panel expanded (D-229); missing reads as collapsed.
    #[serde(default)]
    pub other_properties_open: bool,
    /// Slice PW (docs/contracts/page-width.md §1, AP-753): the chosen page width per note (`normal` | `wide`), keyed by
    /// the object's `id`, else by its NFC vault-relative path; missing reads as empty.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub note_width: Option<std::collections::BTreeMap<String, String>>,
    /// ms5-tasks §6.3 (D-481): the Tasks page's remembered state; missing reads as the defaults.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub tasks: Option<TasksUiDto>,
    /// ms5-tasks §11.4 (D-493, D-496): the last conversion type and "Don't ask again"; missing reads as the defaults.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub convert: Option<ConvertUiDto>,
    /// ms5-capture §5.2 (5B, FR-SET-03, D-566): Date & time display choices; missing reads as all `region`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub date_time: Option<DateTimeUiDto>,
    /// ms5-capture §7.4 (5B, D-555): the Inbox's remembered type filter.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub inbox: Option<InboxUiDto>,
    /// ms4-tags §6.1 (D-703): the tag page's sort, Type filter and grouping, shared by all tags.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub tag_page: Option<TagPageUiDto>,
    /// ms4-tags §6.1 (D-703): the All tags sort.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub tags_sort: Option<SortUiDto>,
}

/// `column` and `dir` (`asc` | `desc`) of a remembered sort.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct SortUiDto {
    pub column: String,
    pub dir: String,
}

/// ms4-tags §6.1: `type` is a type key or null (all types); `grouping` `none` | `type`.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct TagPageUiDto {
    pub sort: SortUiDto,
    pub r#type: Option<String>,
    pub grouping: String,
}

/// ms5-capture §5.2 (FR-SET-03, D-566): `date` `region` | `iso` | `long`; `time` `region` | `24` | `12`; `week`
/// `region` | `monday` | `sunday`.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct DateTimeUiDto {
    pub date: String,
    pub time: String,
    pub week: String,
}

/// ms5-capture §7.4 (D-555): `filter` is `all` or a type key.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct InboxUiDto {
    pub filter: String,
}

/// ms5-tasks §11.4: machine-local conversion state (D-128).
#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct ConvertUiDto {
    /// Type key of the last conversion on this machine; null before the first (preselection Task, D-493).
    pub last_type: Option<String>,
    /// FR-CNV-08 AC-2 `Don't ask again`.
    pub skip_remove_confirm: bool,
}

/// ms5-tasks §6.3 (D-481).
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct TasksUiDto {
    /// `schedule` or `kanban`.
    pub view: String,
    /// `status` or `tag`.
    pub group_by: String,
    /// `all`, `today` or `week`.
    pub date_filter: String,
    pub tags: Vec<String>,
    pub done_expanded: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct TypeSortDto {
    pub column: String,
    /// `asc` or `desc`.
    pub dir: String,
}

/// A resolved link target (ms3-shell §11.1, `link_resolve`).
#[derive(Debug, Clone, Serialize, TS)]
pub struct LinkTargetDto {
    pub target: String,
    /// `note`, `daily`, `date-missing` or `unresolved`.
    pub kind: String,
    pub path: Option<String>,
    pub title: Option<String>,
    #[serde(rename = "type")]
    #[ts(rename = "type")]
    pub type_key: Option<String>,
    /// D-601: the target's `review`, `status`, `due` and `completed` (trimmed strings), for its chip. Only
    /// `link_resolve` fills them; other payloads send null.
    #[ts(optional = nullable)]
    pub review: Option<String>,
    #[ts(optional = nullable)]
    pub status: Option<String>,
    #[ts(optional = nullable)]
    pub due: Option<String>,
    #[ts(optional = nullable)]
    pub completed: Option<String>,
    /// ms6-trash-media §2, §3.2 (6A): with kind `media`, the live Image or PDF object of the file, else null.
    #[ts(optional = nullable)]
    pub object: Option<String>,
}

// ---------------------------------------------------------------- MS4 slice 4A (ms4-links §4)

#[derive(Debug, Clone, Serialize, TS)]
pub struct AtDto {
    pub line: u32,
    pub byte: u32,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(tag = "kind", rename_all = "lowercase")]
#[ts(tag = "kind", rename_all = "lowercase")]
pub enum ExcerptSegDto {
    Text { text: String, marks: Vec<String> },
    Link { text: String, target: LinkTargetDto, here: bool, marks: Vec<String> },
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct ExcerptDto {
    pub segments: Vec<ExcerptSegDto>,
    pub cut_start: bool,
    pub cut_end: bool,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct OccurrenceDto {
    /// `body`, `attribute` or `embed`.
    pub kind: String,
    pub attribute: Option<String>,
    pub attribute_name: Option<String>,
    pub at: AtDto,
    pub excerpt: ExcerptDto,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct BacklinkEntryDto {
    pub source: String,
    pub title: String,
    #[serde(rename = "type")]
    #[ts(rename = "type")]
    pub type_key: String,
    pub modified: Option<String>,
    pub read_only: bool,
    pub occurrences: Vec<OccurrenceDto>,
    /// D-633: the source's trimmed `review`, `status`, `due`, `completed` (D-601), for the panel's chip.
    pub review: Option<String>,
    pub status: Option<String>,
    pub due: Option<String>,
    pub completed: Option<String>,
}

#[derive(Debug, Clone, Serialize, TS)]
pub struct BacklinkGroupDto {
    #[serde(rename = "type")]
    #[ts(rename = "type")]
    pub type_key: String,
    pub defined: bool,
    pub raw: String,
    pub entries: Vec<BacklinkEntryDto>,
}

#[derive(Debug, Clone, Serialize, TS)]
pub struct BacklinksPanelDto {
    pub objects: u32,
    pub groups: Vec<BacklinkGroupDto>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(tag = "state", rename_all = "lowercase")]
#[ts(tag = "state", rename_all = "lowercase")]
pub enum LinkCreatePlanDto {
    Create {
        path: String,
        title: String,
        #[serde(rename = "type")]
        #[ts(rename = "type")]
        type_key: String,
        rewrite: Option<String>,
    },
    Exists { path: String },
    /// `folder`.
    Forbidden { reason: String },
}

#[derive(Debug, Clone, Serialize, TS)]
pub struct BrokenGroupDto {
    pub key: String,
    pub label: String,
    pub count: u32,
    pub create: LinkCreatePlanDto,
    pub sources: Vec<BacklinkEntryDto>,
}

#[derive(Debug, Clone, Serialize, TS)]
pub struct BrokenLinksDto {
    pub occurrences: u32,
    pub objects: u32,
    pub groups: Vec<BrokenGroupDto>,
}

#[derive(Debug, Clone, Serialize, TS)]
pub struct DuplicateDetailsDto {
    pub created: Option<String>,
    #[ts(type = "Array<[string, unknown]>")]
    pub preview: Vec<(String, serde_json::Value)>,
    pub stem: Option<String>,
}

#[derive(Debug, Clone, Serialize, TS)]
pub struct DuplicateObjectDto {
    pub path: String,
    pub title: String,
    #[serde(rename = "type")]
    #[ts(rename = "type")]
    pub type_key: String,
    pub folder: String,
    pub details: DuplicateDetailsDto,
    pub backlinks: u32,
}

#[derive(Debug, Clone, Serialize, TS)]
pub struct DuplicateGroupDto {
    pub key: String,
    pub label: String,
    pub objects: Vec<DuplicateObjectDto>,
}

#[derive(Debug, Clone, Serialize, TS)]
pub struct LinkCreatedDto {
    pub path: String,
    pub rewrite: Option<String>,
}

// ---------------------------------------------------------------- slice 4B (ms4-daily §4)

#[derive(Debug, Clone, Serialize, TS)]
pub struct DailyViewDto {
    /// `YYYY-MM-DD`.
    pub date: String,
    /// The winner's path, or null: the note is virtual.
    pub path: Option<String>,
    pub duplicates: Vec<String>,
    /// `unreviewed` | `reviewed` | null.
    pub review: Option<String>,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct DailyDraftDto {
    /// The complete first-write bytes for an empty edit, with `{{id}}` / `{{now}}` placeholders.
    pub text: String,
    /// The part after the frontmatter: the editor's virtual content.
    pub body: String,
    pub template_invalid: Option<String>,
    pub path: String,
    pub format_fallback: bool,
}

#[derive(Debug, Clone, Serialize, TS)]
pub struct ContextRowDto {
    pub path: String,
    pub title: String,
    #[serde(rename = "type")]
    #[ts(rename = "type")]
    pub type_key: String,
    pub at: String,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct DailyContextDto {
    pub quick_notes: Vec<ContextRowDto>,
    pub created: Vec<ContextRowDto>,
    pub modified: Vec<ContextRowDto>,
    pub totals: [u32; 3],
}

#[derive(Debug, Clone, Serialize, TS)]
pub struct DailyCreatedDto {
    pub path: String,
    pub version: VersionDto,
    pub duplicates: Vec<String>,
}

// ---------------------------------------------------------------- slice 4C (ms4-jobs §4)

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct NoteRenameDto {
    pub job_id: u32,
    /// The planned path; the final one is in the report.
    pub to_path: String,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct JobIdDto {
    pub job_id: u32,
}

#[derive(Debug, Clone, Serialize, TS)]
pub struct JobCountsDto {
    pub written: u32,
    pub unchanged: u32,
    pub skipped: u32,
}

/// `job:progress` (FR-UX-07 AC-8). `kind`: `note-rename` | …; `phase`: `queued` | `planning` | `confirm` | `backup` |
/// `writing` | `done` | `cancelled` | `failed`.
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct JobProgressDto {
    pub job_id: u32,
    pub kind: String,
    pub phase: String,
    pub done: u32,
    pub total: u32,
    #[ts(optional)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub counts: Option<JobCountsDto>,
}

#[derive(Debug, Clone, Serialize, TS)]
pub struct RenamedDto {
    pub from: String,
    pub to: String,
}

/// `reason`: `changed` | `missing` | `placeholder` | `readOnly` | `io`.
#[derive(Debug, Clone, Serialize, TS)]
pub struct SkippedDto {
    pub path: String,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct JobReportDto {
    pub job_id: u32,
    pub kind: String,
    /// `done` | `cancelled` | `failed`.
    pub phase: String,
    #[ts(optional)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub renamed: Option<RenamedDto>,
    pub written: Vec<String>,
    pub unchanged: Vec<String>,
    pub skipped: Vec<SkippedDto>,
    #[ts(optional)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// `outcome`: `written` | `unchanged` | `skipped`.
#[derive(Debug, Clone, Serialize, TS)]
pub struct RetryDto {
    pub outcome: String,
    #[ts(optional)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct EditDto {
    pub start: u32,
    pub end: u32,
}

/// Answer to `job:transform`: `{ kind: 'bytes', text, edits }`, `{ kind: 'unchanged' }` or `{ error }`.
#[derive(Debug, Clone, Deserialize, TS)]
pub struct TransformedDto {
    #[ts(optional)]
    pub kind: Option<String>,
    #[ts(optional)]
    pub text: Option<String>,
    #[ts(optional)]
    pub edits: Option<Vec<EditDto>>,
    #[ts(optional)]
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct InterruptedDto {
    pub job_id: u32,
    pub from: String,
    pub to: String,
    pub done: u32,
    pub total: u32,
}

/// Settings › Backups (FR-HIS-04 AC-6; UI with 4D-lite, D-396).
#[derive(Debug, Clone, Serialize, TS)]
pub struct BackupDto {
    pub name: String,
    pub kind: String,
    /// ISO 8601 with offset.
    pub time: String,
    /// ms4-tags §5.2 (D-724): the catalog key and arguments of the operation label.
    pub label: BackupLabelDto,
    pub files: u32,
}

#[derive(Debug, Clone, Serialize, TS)]
pub struct BackupLabelDto {
    pub key: String,
    #[ts(type = "Record<string, string | number>")]
    pub args: serde_json::Value,
}
// ---------------------------------------------------------------- slice 5A-1 (ms5-tasks §3)

/// One task (R44). `state`: `open`, `in-progress`, `done` or `cancelled`.
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct TaskRowDto {
    pub path: String,
    pub id: Option<String>,
    pub title: String,
    pub status: Option<String>,
    pub state: String,
    pub status_known: bool,
    pub priority: Option<String>,
    pub priority_rank: u32,
    pub due_raw: Option<String>,
    /// `YYYY-MM-DD` when valid (D-484).
    pub due: Option<String>,
    pub completed: Option<String>,
    pub tags: Vec<String>,
    pub fm_tags: Vec<String>,
    pub source: Option<LinkTargetDto>,
    pub excerpt: String,
    pub created: Option<String>,
    pub modified: Option<String>,
    pub version: VersionDto,
    pub read_only: bool,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct StatusOptionDto {
    pub label: String,
    pub color: Option<String>,
    pub state: String,
    pub state_raw: Option<String>,
}

#[derive(Debug, Clone, Serialize, TS)]
pub struct UnknownStateDto {
    pub label: String,
    pub state: Option<String>,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct TaskDefsDto {
    pub statuses: Vec<StatusOptionDto>,
    pub priorities: Vec<OptionDto>,
    pub unknown_states: Vec<UnknownStateDto>,
}

#[derive(Debug, Clone, Serialize, TS)]
pub struct TaskListDto {
    pub tasks: Vec<TaskRowDto>,
    pub defs: TaskDefsDto,
}

#[derive(Debug, Clone, Serialize, TS)]
pub struct DailyTasksDto {
    pub overdue: Vec<TaskRowDto>,
    pub due: Vec<TaskRowDto>,
    pub completed: Vec<TaskRowDto>,
    pub total: u32,
}

fn yes() -> bool {
    true
}

impl Default for UiStateDto {
    fn default() -> Self {
        UiStateDto { version: 1, theme: "system".into(), sidebar_open: true, right_panel: RightPanelDto { open: false, tab: "backlinks".into(), width: None }, properties_open: true, type_sort: Default::default(), other_properties_open: false, tasks: None, convert: None, date_time: None, inbox: None, tag_page: None, tags_sort: None, note_width: None }
    }
}

// ---------------------------------------------------------------- slice 5B (ms5-capture §2.2, §5, §7)

/// ms5-capture §2.2: the vault the capture window saves to; `id` is an opaque token that changes when another vault opens.
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct CaptureVaultDto {
    pub id: String,
    pub name: String,
    pub color: Option<String>,
}

/// ms5-capture §2.2: one capture target (R55 order; the UI sorts user types with its collator).
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct CaptureTypeDto {
    pub key: String,
    pub name: String,
    pub icon: String,
    pub color: String,
    pub folder: String,
    /// `off`, `on` or `locked`.
    pub review: String,
    pub attributes: Vec<AttributeDto>,
    /// D-567: the default template's frontmatter block only, `---` lines included, no body.
    pub template_head: Option<String>,
    /// D-604: the type's plural, for `Saves to <plural>` on types without the review workflow.
    #[ts(optional)]
    pub plural: Option<String>,
}

/// ms5-capture §2.2 (D-553): everything the capture window may read.
/// D-603 (amends D-553): one link suggestion of the capture window: never a body, an excerpt or a path field.
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct CaptureSuggestDto {
    /// The link text to insert (the stem when it is unique in the vault, else the path without `.md`).
    pub link: String,
    pub title: String,
    #[serde(rename = "type")]
    #[ts(rename = "type")]
    pub type_key: String,
    /// The matched alias, if the match was by alias.
    pub alias: Option<String>,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct CaptureContextDto {
    pub vault: Option<CaptureVaultDto>,
    pub types: Vec<CaptureTypeDto>,
    pub default_type: String,
    // D-709: name and colour of every tag (count ≥ 1 or a Tag file).
    pub tags: Vec<CaptureTagDto>,
}

/// ms5-capture §2.2: what `capture_create` wrote.
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct CapturedDto {
    pub path: String,
    pub title: String,
    pub type_name: String,
}

/// ms5-capture §2.2 (FR-CAP-01 AC-8): `capture-draft.json` in Application Support.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct CaptureDraftDto {
    pub text: String,
    pub r#type: String,
    pub tags: Vec<String>,
    pub due: Option<String>,
    pub priority: Option<String>,
    pub saved_at: String,
}

/// ms5-capture §5.1 (D-541): `default-type` as stored and matched.
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct DefaultTypeDto {
    pub raw: Option<String>,
    pub key: String,
    pub valid: bool,
}

/// ms5-capture §5.1 (FR-SET-01).
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct VaultSettingsDto {
    pub version: Option<VersionDto>,
    pub default_type: DefaultTypeDto,
    pub daily_format: String,
    pub attachments: String,
    /// Slice PW (docs/contracts/page-width.md §2, AP-754): `normal` or `wide`; missing or unknown reads as `normal`.
    pub page_width: String,
}

/// ms5-capture §5.2 (FR-SET-05, D-547): machine settings owned by the shell (`shell-settings.json`).
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct ShellSettingsDto {
    pub show_status_item: bool,
    pub open_at_login: bool,
}

/// ms5-capture §1.6 (D-71, D-548): `id` `quick-capture` | `new-task`; `state` `active` | `taken`.
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct HotkeyStateDto {
    pub id: String,
    pub keys: String,
    pub state: String,
}

/// ms5-capture §7.1 (R61): one Inbox member, raw values.
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct InboxRowDto {
    pub path: String,
    pub id: Option<String>,
    pub title: String,
    pub r#type: String,
    pub review_raw: Option<String>,
    pub captured: Option<String>,
    pub created: Option<String>,
    pub modified: Option<String>,
    pub tags: Vec<String>,
    pub excerpt: String,
    pub read_only: bool,
    /// The base of a single Inbox action (ms5-capture §7.3).
    pub version: VersionDto,
}

// ---------------------------------------------------------------- MS6 slice 6A (ms6-trash-media §4, §5)

/// One row of the Trash page (ms6-trash-media §1.2, §4).
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct TrashEntryDto {
    pub path: String,
    /// `object`, `file` or `folder`.
    pub kind: String,
    pub original: String,
    pub folder: String,
    pub title: String,
    #[serde(rename = "type")]
    #[ts(rename = "type")]
    pub type_key: Option<String>,
    pub files: Vec<String>,
    pub count: u32,
    /// ISO instant with the vault zone's offset of the entry's `ctime` (R71).
    pub trashed_at: String,
}

/// One rename of a trash operation (ms6-trash-media §4).
#[derive(Debug, Clone, Serialize, TS)]
pub struct MovedDto {
    pub from: String,
    pub to: String,
}

#[derive(Debug, Clone, Serialize, TS)]
pub struct TrashFailedDto {
    pub path: String,
    pub reason: String,
}

/// `trash_delete` / `trash_empty` (ms6-trash-media §4).
#[derive(Debug, Clone, Serialize, TS)]
pub struct TrashRemovalDto {
    pub removed: Vec<String>,
    pub failed: Vec<TrashFailedDto>,
}

/// `media_add` (ms6-trash-media §4).
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct MediaAddedDto {
    pub file: String,
    pub object: String,
    pub title: String,
    pub embed: String,
    pub media_type: String,
    /// Bytes (at most 200 MB, D-625).
    pub size: u32,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub pages: Option<u32>,
}

/// One path of `media_add_paths` (ms6-trash-media §4): `{ ok }` or `{ error, name }` with `Refused`, `TooLarge` or `Io`.
#[derive(Debug, Clone, Serialize, TS)]
#[serde(untagged)]
pub enum MediaAddResultDto {
    Ok { ok: MediaAddedDto },
    Err { error: String, name: String },
}

/// A file staged by the capture window (ms6-trash-media §5).
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct StagedMediaDto {
    pub token: String,
    pub name: String,
    pub media_type: String,
    /// Bytes (at most 200 MB, D-625).
    pub size: u32,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub pages: Option<u32>,
}

/// One staged file or its error (ms6-trash-media §5).
#[derive(Debug, Clone, Serialize, TS)]
#[serde(untagged)]
pub enum StagedMediaResultDto {
    Ok { ok: StagedMediaDto },
    Err { error: String, name: String },
}

// ---------------------------------------------------------------- slice 4D-lite (ms4-tags §3, §4.4)

/// The winning Tag file of a tag (§1.2).
#[derive(Debug, Clone, Serialize, TS)]
pub struct TagFileDto {
    pub path: String,
    pub version: VersionDto,
}

/// One tag (§1.2; `index_tags` returns these once 4D-lite is built).
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct TagRowDto {
    pub key: String,
    pub name: String,
    pub file: Option<TagFileDto>,
    pub losers: Vec<String>,
    pub color: Option<String>,
    pub color_raw: Option<String>,
    pub count: u32,
    pub last_used: Option<String>,
    /// i128 as a decimal string.
    pub last_used_ns: Option<String>,
}

/// One object of a tag page (§1.3).
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct TagObjectRowDto {
    pub path: String,
    pub id: Option<String>,
    pub title: String,
    pub r#type: String,
    pub modified: Option<String>,
    pub modified_ns: Option<String>,
    pub tags: Vec<String>,
    pub review: Option<String>,
    pub status: Option<String>,
    pub due: Option<String>,
    pub completed: Option<String>,
}

/// §1.4.
#[derive(Debug, Clone, Serialize, TS)]
pub struct TagUsageDto {
    pub notes: u32,
    pub templates: u32,
    pub file: Option<String>,
    pub losers: Vec<String>,
}

/// `tag_new_path`.
#[derive(Debug, Clone, Serialize, TS)]
pub struct TagNewPathDto {
    pub path: String,
}

/// `capture_context` tags once 4D-lite is built (D-709): name and colour only.
#[derive(Debug, Clone, Serialize, TS)]
pub struct CaptureTagDto {
    pub name: String,
    pub color: Option<String>,
}

/// `tag_rename`, `tag_delete`, `merge_start`: `null` when no job starts (FR-TAG-04 AC-5).
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct JobStartDto {
    pub job_id: Option<u32>,
}

#[derive(Debug, Clone, Serialize, TS)]
pub struct RenamePairDto {
    pub from: String,
    pub to: String,
}

/// `{ kind: 'duplicateTagFile', path }` (D-718).
#[derive(Debug, Clone, Serialize, TS)]
pub struct PlanWarningDto {
    pub kind: String,
    pub path: String,
}

/// A merge conflict: the kept value and the others' values (D-727).
#[derive(Debug, Clone, Serialize, TS)]
pub struct MergeConflictDto {
    pub key: String,
    pub kept: String,
    pub others: Vec<String>,
}

/// `job_plan` (§4.4): the plan once the job is in `confirm`.
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct JobPlanDto {
    pub job_id: u32,
    pub kind: String,
    pub files: u32,
    pub templates: u32,
    pub renames: Vec<RenamePairDto>,
    pub trashes: Vec<String>,
    pub warnings: Vec<PlanWarningDto>,
    pub conflicts: Vec<MergeConflictDto>,
}

/// The generated `types.ts`, in a fixed order.
pub fn typescript() -> String {
    let decls = [
        VaultInfo::decl(),
        DateRangeDto::decl(),
        SearchQueryDto::decl(),
        SnippetDto::decl(),
        SearchResultDto::decl(),
        SearchPageDto::decl(),
        SwitcherItemDto::decl(),
        NoteDto::decl(),
        ProgressDto::decl(),
        ChangedDto::decl(),
        VersionDto::decl(),
        WriteResultDto::decl(),
        TagDto::decl(),
        ConflictRowDto::decl(),
        ConflictDto::decl(),
        IpcError::decl(),
        TypeDto::decl(),
        TypeFileErrorDto::decl(),
        OptionDto::decl(),
        AttributeDto::decl(),
        AttributeInputDto::decl(),
        AttributeChangeDto::decl(),
        TypeOpDto::decl(),
        TypeUsageDto::decl(),
        TypeRowDto::decl(),
        TypeTemplateDto::decl(),
        StarterSkipDto::decl(),
        StarterPlanDto::decl(),
        ObjectRowDto::decl(),
        LastOpenedDto::decl(),
        RecentVaultDto::decl(),
        RightPanelDto::decl(),
        TypeSortDto::decl(),
        UiStateDto::decl(),
        LinkTargetDto::decl(),
        AtDto::decl(),
        ExcerptSegDto::decl(),
        ExcerptDto::decl(),
        OccurrenceDto::decl(),
        BacklinkEntryDto::decl(),
        BacklinkGroupDto::decl(),
        BacklinksPanelDto::decl(),
        LinkCreatePlanDto::decl(),
        BrokenGroupDto::decl(),
        BrokenLinksDto::decl(),
        DuplicateDetailsDto::decl(),
        DuplicateObjectDto::decl(),
        DuplicateGroupDto::decl(),
        LinkCreatedDto::decl(),
        DailyViewDto::decl(),
        DailyDraftDto::decl(),
        ContextRowDto::decl(),
        DailyContextDto::decl(),
        DailyCreatedDto::decl(),
        EmbedNoteDto::decl(),
        NoteRenameDto::decl(),
        JobIdDto::decl(),
        JobCountsDto::decl(),
        JobProgressDto::decl(),
        RenamedDto::decl(),
        SkippedDto::decl(),
        JobReportDto::decl(),
        RetryDto::decl(),
        EditDto::decl(),
        TransformedDto::decl(),
        InterruptedDto::decl(),
        BackupLabelDto::decl(),
        BackupDto::decl(),
        TasksUiDto::decl(),
        ConvertUiDto::decl(),
        TaskRowDto::decl(),
        StatusOptionDto::decl(),
        UnknownStateDto::decl(),
        TaskDefsDto::decl(),
        TaskListDto::decl(),
        DailyTasksDto::decl(),
        DateTimeUiDto::decl(),
        InboxUiDto::decl(),
        SortUiDto::decl(),
        TagPageUiDto::decl(),
        CaptureVaultDto::decl(),
        CaptureTypeDto::decl(),
        CaptureContextDto::decl(),
        CaptureSuggestDto::decl(),
        CapturedDto::decl(),
        CaptureDraftDto::decl(),
        DefaultTypeDto::decl(),
        VaultSettingsDto::decl(),
        ShellSettingsDto::decl(),
        HotkeyStateDto::decl(),
        InboxRowDto::decl(),
        TrashEntryDto::decl(),
        MovedDto::decl(),
        TrashFailedDto::decl(),
        TrashRemovalDto::decl(),
        MediaAddedDto::decl(),
        MediaAddResultDto::decl(),
        StagedMediaDto::decl(),
        StagedMediaResultDto::decl(),
        TagFileDto::decl(),
        TagRowDto::decl(),
        TagObjectRowDto::decl(),
        TagUsageDto::decl(),
        TagNewPathDto::decl(),
        CaptureTagDto::decl(),
        JobStartDto::decl(),
        RenamePairDto::decl(),
        PlanWarningDto::decl(),
        MergeConflictDto::decl(),
        JobPlanDto::decl(),
    ];
    let mut out = String::from("// Generated from app/src-tauri/src/dto.rs by ts-rs. Do not edit: run\n// `UPDATE_TYPES=1 cargo test --manifest-path app/src-tauri/Cargo.toml types_file_is_current`.\n\n");
    for d in decls {
        out.push_str("export ");
        out.push_str(&d);
        out.push('\n');
    }
    // ms3-shell §14.3: 3A's `TypeDefDto` is now an alias of `TypeDto`.
    out.push_str("export type TypeDefDto = TypeDto;\n");
    out
}

#[cfg(test)]
mod tests {
    #[test]
    fn types_file_is_current() {
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../ui/src/ipc/types.ts");
        let want = super::typescript();
        if std::env::var("UPDATE_TYPES").is_ok() {
            std::fs::write(&path, &want).expect("write types.ts");
        }
        let have = std::fs::read_to_string(&path).unwrap_or_default();
        assert_eq!(have, want, "app/ui/src/ipc/types.ts is stale: regenerate with UPDATE_TYPES=1");
    }
}
