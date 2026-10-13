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
    /// `title`, `alias`, `attribute` or `body`.
    pub matched_in: String,
    pub typo: bool,
    pub snippet: Option<SnippetDto>,
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
}

#[derive(Debug, Clone, Serialize, TS)]
pub struct NoteDto {
    pub path: String,
    pub text: String,
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
pub struct ConflictDto {
    pub path: String,
}

#[derive(Debug, Clone, Serialize, TS)]
pub struct IpcError {
    /// `Conflict`, `Gone`, `NotFound`, `NameTaken`, `Io`, `NoVault`, `NotEmpty`, `NotATeggVault` or `Unsupported`.
    pub kind: String,
    pub message: String,
}

/// A type definition for the sidebar (ms3-shell §2), read-only until `tegg-schema` (3D).
#[derive(Debug, Clone, Serialize, TS)]
pub struct TypeDefDto {
    pub key: String,
    pub name: String,
    pub plural: String,
    pub folder: String,
    pub icon: String,
    pub color: String,
    pub system: bool,
    pub invalid: bool,
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
    /// Attribute strip expanded (FR-TYP-08 AC-5, D-147). STUB (TS-I1): the 3B default (`true`, missing = `true`)
    /// isn't implemented yet.
    #[serde(default)]
    pub properties_open: bool,
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

impl Default for UiStateDto {
    fn default() -> Self {
        UiStateDto { version: 1, theme: "system".into(), sidebar_open: true, right_panel: RightPanelDto { open: false, tab: "backlinks".into() }, properties_open: false }
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
        ConflictDto::decl(),
        IpcError::decl(),
        TypeDefDto::decl(),
        ObjectRowDto::decl(),
        LastOpenedDto::decl(),
        RightPanelDto::decl(),
        UiStateDto::decl(),
        LinkTargetDto::decl(),
    ];
    let mut out = String::from("// Generated from app/src-tauri/src/dto.rs by ts-rs. Do not edit: run\n// `UPDATE_TYPES=1 cargo test --manifest-path app/src-tauri/Cargo.toml types_file_is_current`.\n\n");
    for d in decls {
        out.push_str("export ");
        out.push_str(&d);
        out.push('\n');
    }
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
