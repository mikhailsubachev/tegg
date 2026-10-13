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
 * `title`, `alias`, `attribute` or `body`.
 */
matched_in: string, typo: boolean, snippet: SnippetDto | null, };
export type SearchPageDto = { results: Array<SearchResultDto>, total: number, };
export type SwitcherItemDto = { 
/**
 * `object` or `create`.
 */
kind: string, path: string | null, title: string, type: string, folder: string, matched_alias: string | null, };
export type NoteDto = { path: string, text: string, };
export type ProgressDto = { done: number, total: number, 
/**
 * `running`, `done` or `cancelled`.
 */
state: string, };
export type ChangedDto = { paths: Array<string>, };
export type ConflictDto = { path: string, };
export type IpcError = { 
/**
 * `Conflict`, `Gone`, `NotFound`, `NameTaken`, `Io`, `NoVault`, `NotEmpty`, `NotATeggVault` or `Unsupported`.
 */
kind: string, message: string, };
export type TypeDefDto = { key: string, name: string, plural: string, folder: string, icon: string, color: string, system: boolean, invalid: boolean, };
export type ObjectRowDto = { path: string, id: string | null, title: string, type: string, modified: string | null, };
export type LastOpenedDto = { path: string, id: string | null, };
export type RightPanelDto = { open: boolean, 
/**
 * `backlinks`, `outline` or `graph`.
 */
tab: string, };
export type UiStateDto = { version: number, 
/**
 * `system`, `light` or `dark`.
 */
theme: string, sidebarOpen: boolean, rightPanel: RightPanelDto, 
/**
 * Attribute strip expanded (FR-TYP-08 AC-5, D-147); a missing field reads as `true`.
 */
propertiesOpen: boolean, };
export type LinkTargetDto = { target: string, 
/**
 * `note`, `daily`, `date-missing` or `unresolved`.
 */
kind: string, path: string | null, title: string | null, type: string | null, };
