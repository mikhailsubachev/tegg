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
}

#[derive(Debug, Clone, Serialize, TS)]
pub struct NoteDto {
    pub path: String,
    /// Decoded with U+FFFD for invalid bytes, for display only (D-180).
    pub text: String,
    pub version: VersionDto,
    pub utf8: bool,
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
    AddAttribute { attribute: AttributeInputDto },
    UpdateAttribute { key: String, change: AttributeChangeDto },
    RemoveAttribute { key: String },
    MoveAttribute { key: String, to: u32 },
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
}

fn yes() -> bool {
    true
}

impl Default for UiStateDto {
    fn default() -> Self {
        UiStateDto { version: 1, theme: "system".into(), sidebar_open: true, right_panel: RightPanelDto { open: false, tab: "backlinks".into() }, properties_open: true, type_sort: Default::default(), other_properties_open: false }
    }
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
