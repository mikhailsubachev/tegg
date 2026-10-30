# Contract: configurable type-page columns (v0.94 feedback; D-1240…D-1252)

ACs: [docs/acceptance/type-columns.md](../acceptance/type-columns.md) (FR-TYP-09 AC-18…AC-34, FR-TYP-11 AC-4, AR-07 AC-8) and its table R130. Where this contract and the ACs disagree, the ACs win and this contract is corrected before the red tests. Extends [ms3-shell.md](ms3-shell.md) §14 (types) and replaces §15.7's link to `preview`. Approved criteria, 2026-10-30.

## 1. `tegg-schema` (`crates/tegg-schema`)

- `TypeFile` gains `pub columns: Option<Vec<String>>` (None = key absent; `Some(vec![])` = `columns: []`), read from a flow or block list of strings, keys as written (NFC matching is the reader's job). `CURRENT_VERSION` stays 1 (D-1251).
- A `columns` value that is neither a list nor absent (scalar, mapping, a list holding a non-string) does not make the file invalid: `columns` reads as None and `Parsed` gains `columns_unreadable: bool` (AC-25 (d)). `Parsed` also gains `columns_ignored: Vec<String>`: entries that are neither an attribute key, a universal key of R130 (`tags`, `source`, `aliases`, `review`, `created`, `modified`) nor anything else readable; `title` is skipped without a warning (D-1245).
- `TOP_ORDER` gains `columns` after `hidden`: `… preview, hidden, columns, embed, template, attributes` (D-1243). Whole-file writers (new type, starter, built-in) never write `columns` (AR-07 AC-8).
- `TypeOp::SetColumns(Vec<String>)`: writes only the `columns` line(s) as one flow list (`render_top`), inserting the line at its TOP place when absent; a block list is replaced by the one flow line; keys written NFC; no limit; refused (`RuleError::ColumnsUnreadable`) when `columns_unreadable`. A no-op when the list is unchanged and the key exists.
- `TypeOp::RemoveAttribute(key)` also removes every entry of the key from `columns` (NFC-compared, repeats included) in the same write, as it does for `preview` and `hidden` (D-807, AC-26). The 4E delete-property job's type-file change uses the same op.
- `SetPreview` keeps its 4-limit (`PreviewFull`).

## 2. Core and IPC (`tegg-core`, `app/src-tauri`, `app/ui/src/ipc/types.ts`)

- `TypeDto` gains `columns: string[] | null` (null = key absent), `columnsIgnored: string[]` and `columnsUnreadable: boolean`.
- `TypeOpDto` gains `{ op: 'columns', keys: string[] }` → `TypeOp::SetColumns`. `type_patch` is unchanged otherwise: one atomic write per call, base `version`, `Conflict` on an external change (FR-TYP-01 AC-7). A missing system type file is created from its built-in default plus the change (D-90).
- `New property…` sends `[addAttribute, columns]` in one `type_patch` (AC-24); `alsoPreview` is removed from that path. Type settings' `Add property` sends `addAttribute` alone.
- `type_rows(key)` (`index_type_rows`) fills `values` for every **effective column key** (§3), not only `preview`; date ranges as `<key>-start` / `<key>-end`, relation and `source` link targets resolved as today. Rows still come from the index only (D-241).
- `UiStateDto` gains `typeColumnWidths?: Record<string, Record<string, number>>` (type key → column key → width in px, `title` included; missing reads as empty; `version` stays 1, ms3-shell §14.10 item 12). The Rust `UiState` field has `#[serde(default)]`. Written through the existing `ui_state_set`, never to the vault (D-1241).

## 3. Column model (`app/ui/src/types/columns.ts`, L1)

```ts
export const UNIVERSAL_COLUMNS = ['tags', 'source', 'aliases', 'review', 'created', 'modified'] as const;
/** R130 menu choices in order (Title excluded): attributes in schema order, then the universal keys; `review` only when the workflow is on or locked. */
export function columnChoices(type: TypeDto): string[];
/** Effective columns after Title: `columns` when present (unknown keys, `title` and repeats dropped, NFC-matched) else `preview`'s known keys + `modified` (D-1240); `review` dropped while the workflow is off. */
export function effectiveColumns(type: TypeDto | null): string[];
/** The list to write for a toggle: seeds from the effective columns when `columns` is null (D-1243), appends a checked key at the end, removes every entry of an unchecked one, keeps hand-written entries in place (D-1245). */
export function toggleColumn(type: TypeDto, key: string, on: boolean): string[];
/** The list to write when moving `key` by `delta` places among the effective columns (D-1244); null when it can't move. Hand-written entries keep their positions relative to their neighbours. */
export function moveColumn(type: TypeDto, key: string, delta: number): string[] | null;
/** The list to write when dropping `key` before `beforeKey` (null = at the end). */
export function dropColumn(type: TypeDto, key: string, beforeKey: string | null): string[] | null;
/** Default sort (D-1246): `modified`/`desc` when `modified` is effective, else `title`/`asc`. */
export function defaultSort(cols: string[]): { column: string; dir: 'asc' | 'desc' };
export const WIDTH = { default: 160, min: 80, max: 960, titleMin: 160, titleFill: 240 } as const; // R130, D-1248
/** Clamp a width for a column (`title` uses `titleMin`). */
export function clampWidth(key: string, px: number): number;
```

Undefined types: effective columns are `['modified']` and there is no menu (AC-27 (e)).

## 4. UI (`app/ui/src/pages/TypePage.tsx`, `app/ui/src/types/cell.tsx`)

- **Header row:** `columnheader` per column, `Title` first; each header except Title is `draggable` for reordering (pointer moved > 4 px; a shorter press is a click that sorts). ⌥←/⌥→ on a focused header move it (one `type_patch`, focus stays). Each header, Title included, is followed by a resize handle: `role="separator"`, `aria-orientation="vertical"`, name `Resize {column}` (`typePage.resize`), `tabIndex=0`, `aria-valuenow`/`aria-valuemin`/`aria-valuemax`, hit area ≥ 8 px, cursor `col-resize`. Keys: ←/→ ±10, ⇧ ±50, Home/End min/max, ⌫/Delete reset; double-click resets; Esc during a drag restores.
- **Widths:** `table-layout: fixed` with a `<colgroup>`; Title without a stored width takes the rest (≥ 240 px). The UI state is written once on pointer release, and debounced (≤ 1 s) after keyboard changes. Cells: `white-space: nowrap`, `text-overflow: ellipsis`, the full text in the cell's `title`.
- **Horizontal scroll:** `.table-scroll` has `overflow-x: auto` inside the page column (max 960 px, D-1247); the page never scrolls sideways; Title cells and header are `position: sticky; left: 0` with an opaque token background (light and dark). A focused header scrolls into view right of the Title column.
- **Columns menu:** items per R130: `Title` (checked, aria-disabled, description `Always shown`, `typePage.alwaysShown`), the choices as `menuitemcheckbox`, separator, `New property…`, separator, `Reset column widths` (`typePage.resetWidths`). The warning `typePage.columnsIgnored` = `Not a property of {type}, kept in the file: {keys}` when `columnsIgnored` is not empty. `Columns` is aria-disabled with `typePage.columnsUnreadable` = `The columns setting in {file} can't be read. Fix it in the file to change columns.` when `columnsUnreadable`, besides the newer/invalid reasons of §15.7. The menu scrolls when taller than the window. `typePage.columnLimit` and `typePage.columnLimitAdded` are removed from the catalog.
- **Sort:** `typeSort[key]` is used only while its column is effective; otherwise `defaultSort` (the stored value is kept). `review` sorts by its label.
- **Palette** (R13 additions, section `navigate`, on `type` routes): `Choose columns…` id `typePage.chooseColumns` (defined types only; opens the menu), `Reset column widths` id `typePage.resetWidths` (all type routes, undefined types included).

## 5. Fake core (L5)

`app/ui/test/fake-core.ts` / `fake-schema.ts`: the line patch learns `columns` (flow list, TOP place, block list replaced, NFC), `TypeDto` carries the new fields, `type_rows` fills values for the effective keys, `RemoveAttribute` removes `columns` entries, and `ui_state_set` stores `typeColumnWidths`.

## 6. Test layout

- L1: `app/test/type_columns.ac.test.ts` (§3 model, R130, AC-22 rule, AC-34 catalog).
- L4: `crates/tegg-schema/tests/ac_type_columns.rs` (SetColumns bytes, TOP place, block list, NFC, unreadable, RemoveAttribute, AR-07 AC-8); `crates/tegg-core/tests/ac_type_columns.rs` (type_patch writes and Conflict, missing `task.yml`, `type_rows` values, the 4E delete job's `columns` line and its Undo, watcher).
- L5: `app/webkit/type_columns.ac.test.ts`.
- L6: `app/e2e/type_columns.ac.test.ts` (real drag, relaunch, second Application Support).
