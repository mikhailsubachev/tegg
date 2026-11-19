# Contract: Views on type pages (v1.0 slice Q2)

Public interfaces of slice Q2, for the test author (D-61) and the build. ACs: `docs/acceptance/views.md` (R184…R193;
FR-QRY-07 AC-1…AC-18, FR-QRY-05 AC-10…AC-23, FR-QRY-01 AC-8…AC-13, FR-QRY-08 AC-2, FR-QRY-09 AC-6, AC-7, FR-QRY-06
AC-23…AC-25, FR-TYP-09 AC-35, AR-07 AC-9, FR-LNK-03 AC-24, FR-SYN-02 AC-11, FR-SYN-03 AC-30, FR-SYN-06 AC-48, FR-FMT-07
AC-32, AC-33, FR-FMT-12 AC-12, FR-STO-07 AC-10, NFR-POR-01 AC-6, NFR-PERF-07 AC-3, AC-4, FR-UX-03 AC-50, AC-51, FR-UX-08
AC-24, FR-UX-05 AC-24, NFR-OTH-02 AC-21). Decisions: D-1762…D-1780 (plan, BRD v1.190) and AP-1497…AP-1518 = D-1781…D-1802
(BRD v1.191). Plan: `docs/plans/q2-views-plan.md`. Boards: `design/edit-note-page/Views.dc.html` (A–G), `ViewsDark`,
`ViewsApp`, `ViewsAppDark`. Fixtures: `tests/fixtures/vaults/views/` (README there) and `tests/fixtures/queries-files/`.

**Status: approved, 2026-11-19.** Contract decisions CP-1…CP-9 accepted by the owner as D-1803…D-1811 (§9); the AC
problems of §10 fixed in `docs/acceptance/views.md` as D-1812.

This contract **extends** [v1-queries.md](v1-queries.md) (slice Q): every rule there holds unless a section here
changes it, and section numbers here mirror it. Precedents followed where the ACs leave room: type columns
([type-columns.md](type-columns.md): `columns` in the type file, widths, the resize handle), the Tasks Kanban
([ms5-tasks.md](ms5-tasks.md) §5 the write path, §14 column moves, D-513 the `task-moved` mark) and the jobs
([ms4-jobs.md](ms4-jobs.md)). Where this contract and the ACs disagree, the ACs win and this contract is corrected before
the red tests. §9 records the interface questions the ACs left open (CP-1…CP-9, decided as D-1803…D-1811), §10
the AC fixes (D-1812).

**What Q2 writes.** (1) A type file's `views:` line (tab add, drag, remove, Move view left / right; the query rename job).
(2) Query files: `sort`, `view`, `group_by`, `lanes`, `lane_order`, `columns` (sort popover, header click and ⇧-click,
lanes switch, lane drag, Reset lane order, Columns, header drag, the editor), `query_create` for New view, `query_duplicate`.
(3) One object's frontmatter on a card move. (4) A new object from a lane (the slice Q draft route). Machine-local:
`ui-state.json` (`typeViews`, `queryColumnWidths`, `boardFolded`, §4.7). Nothing else: showing, running, scrolling,
folding, resizing, switching tabs and opening menus write no vault file (FR-SYN-06 AC-48).

## 1. The queries module (`tegg-core::queries_q`, AR-03) and the type file (`tegg-schema`)

Everything stays platform-neutral (AR-03): no Tauri, files through `Vault`, the index through the core's lock. No view,
lane or card state is stored in the index (AR-01).

### 1.1 Types (changes to v1-queries §1.1)

```rust
pub enum View { List, Table, Board }                          // `board` is valid now (R185; was BadValue)
pub enum Lanes { Vertical, Horizontal }                       // R185; missing = Vertical
pub enum Order { Asc, Desc }
pub struct Sort { pub by: String, pub order: Order }          // one level

pub struct QueryDef {
    pub title: String, pub types: Vec<String>, pub r#match: Match, pub filters: Vec<FilterItem>,
    /// The levels as written, in file order (repeats kept, §1.2); never empty: a missing or broken `sort` reads as
    /// `[Sort { by: "modified", order: Desc }]`. A file `sort: []` reads as `[]` (D-1806).
    pub sort: Vec<Sort>,
    pub limit: u32,
    pub view: View,
    /// `group_by` as written (NFC, trimmed); None = key absent or not a string (then BadValue). Validity against the
    /// schema is a run-time check (§1.6).
    pub group_by: Option<String>,
    pub lanes: Lanes,
    /// None = key absent (the default order). Some(vec![]) = `lane_order: []`.
    pub lane_order: Option<Vec<String>>,
    pub columns: Vec<String>,
}

/// One lane of a board (R187). `id` is stable across runs and is what the UI keys DOM, folds and drags by:
/// `option:<label>`, `unknown:<value>`, `tag:<tag key>`, `relation:<target path>`, `unresolved:<link text>`, `none`
/// (every part NFC).
pub enum LaneKind { Option, Unknown, Tag, Relation, Unresolved, None }
pub struct Lane {
    pub id: String,
    pub kind: LaneKind,
    /// What a drop writes and `lane_order` lists (AP-1508, D-1792): the option label, the unknown value as written, the
    /// tag key, the relation's D-184 link text `[[<stem or path>]]` (no quotes; YAML quoting is the writer's). None for `none`.
    pub value: Option<String>,
    /// The shown name: option label, unknown value, the tag's spelling (D-185), the linked object's title, the
    /// unresolved link's text. Empty for `none` (the UI shows `board.none` with the attribute's Name).
    pub label: String,
    pub color: Option<String>,          // the option's colour name (Select / multi-select option lanes), else None
    pub target: Option<String>,         // Relation: the resolved path
    pub excluded: bool,                 // R187 excluded lane (§1.6); always false outside Option lanes
    pub drop_target: bool,              // Option, Tag, Relation lanes (excluded ones included); false for Unknown, Unresolved, None (D-1805)
    pub cards: Vec<LaneCard>,           // in the view's order (rows' order)
}
/// `row`: index into `QueryResult.rows`. `raw`: the frontmatter values of the grouping key, exactly as written (NFC),
/// that put the row in this lane (Select: the scalar; multi-select / multiple relation: the matching list entries;
/// tags: the frontmatter `tags` entries with this key, empty when the tag is only inline; none: empty). A card move
/// removes `raw` (§1.9).
pub struct LaneCard { pub row: usize, pub raw: Vec<String> }

pub enum GroupKind { Select, MultiSelect, Tags, Relation { multiple: bool } }
pub struct Grouping {
    pub key: String,                    // the grouping key as resolved (attribute key, or `tags`)
    pub kind: GroupKind,
    pub name: String,                   // the attribute's Name as written (`Status`, `Genres`, `Tags` for tags via the UI key `attr.tags`)
    pub lanes: Vec<Lane>,               // R187 order, `lane_order` applied, `none` last when it has cards
}

pub struct QueryRow {                   // v1-queries §1.1 plus:
    // …existing fields…
    pub version: FileVersion,           // the index's version of the file (the card move's base, FR-SYN-03)
    pub excerpt: String,                // the index excerpt (the card's body lines, `text::excerpt`)
    pub read_only: bool,                // not UTF-8 (as TaskRow.readOnly): no card drag, no Move to
}
// `values` also holds the grouping key when `group` is Some (D-1769: a multi-value card shows all its values).

pub struct QueryResult {                // v1-queries §1.1 plus:
    // …existing fields…
    /// Some only when `def.view == Board` and `group_by` is valid (§1.6); None otherwise (a broken `group_by` is in
    /// `broken` and the UI draws a List, R185).
    pub group: Option<Grouping>,
}

pub struct QuerySummary {               // v1-queries §1.1 plus (for tab icons, D-1763 offers, page marks):
    // …existing fields…
    pub view: Option<View>,             // None when Unreadable
    pub types: Option<Vec<String>>,     // None when Unreadable
}

/// A type file that lists a query in `views:` (FR-QRY-06 AC-24, the rename job, D-1804).
pub struct ViewUsage { pub type_key: String, pub path: String }
```

`QueryError` is unchanged. `CoreError` unchanged.

### 1.2 Read rules (R185; changes to v1-queries §1.2)

- **`view`**: `list`, `table`, `board`; other values `BadValue` (default `list`).
- **`sort`** (D-1768, amends D-1462): (a) R138's single mapping `{ by, order }` → one level; (b) a YAML sequence whose
  every item is a mapping with a non-blank string `by` and an `order` of `asc` / `desc` / missing (= `asc`) → one level
  per item, in order. Any other shape (a scalar item, a mapping without `by`, an `order` other than `asc` / `desc`) →
  `BadValue` for `sort`, default `[modified desc]`, the file not rewritten (FR-QRY-01 AC-8). `by` NFC, trimmed. A `by`
  that isn't `title`, `created`, `modified` or an attribute is still found at run time (v1-queries §1.6) and makes the
  **whole** `sort` broken (R185). A key used at two levels is kept in `def.sort` as written; the evaluator and the UI
  use its first level only (§1.6, §4.4).
- **`group_by`**: a non-blank string → `Some(nfc(trim))`; other values `BadValue` (None). Read with every `view`; only
  used when `view: board` (R185: kept and ignored with `list` / `table`, no notice).
- **`lanes`**: `vertical` / `horizontal`; other values `BadValue` (default `Vertical`).
- **`lane_order`**: a sequence of strings (flow or block) → `Some(list)` (NFC, as written otherwise); other values
  `BadValue` (None).
- `limit`: unchanged (1…1000); on a board it is kept and not applied (§1.6).
- `version` stays 1 (`QUERY_VERSION`); a file with Q2 keys and `version: 1` is `Ok`.
- The `Layout` learns the new keys' line ranges (one-line or block, as `filters` and `sort`), including a block-list
  `sort:` and `lane_order:`.

### 1.3 The type file's `views:` (`tegg-schema`; R184, D-1782, AR-07 AC-9)

- `TypeFile` gains `pub views: Option<Vec<String>>` (None = key absent; `Some(vec![])` = `views: []`), read from a flow
  or block list of strings, NFC; names as written otherwise (deduplication is the UI's, §4.4). `Parsed` gains
  `views_unreadable: bool`: a `views` that is present but not a list of strings (scalar, mapping, a non-string item)
  reads as None with `views_unreadable: true`; the file stays `Ok` (as `columns_unreadable`, type-columns §1).
- `TOP_ORDER` gains `views` right after `columns`: `… preview, hidden, columns, views, embed, template, attributes`
  (R184 as fixed by D-1812, `embed` included). New, starter and built-in type files have no `views` (`serialize` writes it
  only when the definition has one). `CURRENT_VERSION` stays 1.
- `TypeOp::SetViews(Vec<String>)`: writes only the `views` line(s) as one flow list (`render_top`, D-230 quoting via
  `yaml_text::scalar`, NFC), inserted at its TOP place when absent; a hand-written block list is replaced by the one flow
  line; `views: []` when empty (the key stays, D-1782). No-op (no write) when the list equals the file's and the key
  exists. Refused with `RuleError::ViewsUnreadable` when `views_unreadable`, and as every op on a Newer / invalid file.
  A missing system type file is created from its built-in default plus the line (D-90), as `SetColumns`.
- Every other `TypeOp` leaves the `views` line or block byte-identical, a malformed value included (AR-07 AC-9).
- `pub fn rename_view(text: &str, from: &str, to: &str) -> Option<String>`: the rename job's patch: every list entry
  whose `name_key` equals `from`'s (queries_q `name_key` rule) gets `to` (D-230 quoting) in place, flow or block style
  kept, every other byte kept; None when nothing matches or `views` is unreadable / absent, or the file is Newer or invalid.

### 1.4 Writing query files (R185 write style; changes to v1-queries §1.4)

- `ORDER` (create order, D-1783): `version, title, types, match, filters, sort, limit, view, group_by, lanes,
  lane_order, columns, created, modified`. `COMMIT_KEYS` gains `group_by`, `lanes`, `lane_order`.
- **Effective values** decide what a commit replaces (D-1457): `sort` compares as the list of levels; `lanes` by its
  effective value (a missing key and `Vertical` are equal, so a commit with `Vertical` writes nothing there);
  `group_by: None` in `def` means "unchanged" (never removed by a commit); `lane_order` compares as written (None vs Some).
- **`sort` style** (D-1768, AP-1499): one level → `sort: { by: <by>, order: <asc|desc> }` (one line); two or more → the
  line `sort:` then one line per level `  - { by: <by>, order: <order> }` (two spaces, flow mapping). When the shape
  changes, the old line's trailing comment (from the whitespace before ` #` to the line end, D-1457) stays on the
  `sort:` line (`sort:   # jedna úroveň`) and, list → one level, on the single line. A list is never written for one
  level, so one-level files never churn.
- `view`, `group_by`, `lanes`: plain scalars (`yaml_text::scalar`), trailing comment kept (`lanes: vertical            #
  vertical nebo horizontal`). `lane_order`, `columns`: one flow line (`lane_order: ["[[Tomáš Rybář]]", "[[Eva
  Lindová]]"]`), D-230 quoting; a block list is replaced by one flow line.
- **`lane_order` removal** (`def.lane_order == None` while the file has the key; `Reset lane order`, D-1792): the key's
  line or block is removed (its range per v1-queries §1.4, the comment / blank lines above it kept): the one explicit
  exception to "keys are never removed".
- A missing changed key is inserted at its `ORDER` place (after the nearest earlier key present, else before the
  nearest later one): `lanes: horizontal` right after `group_by: author` (FR-QRY-05 AC-17), `lane_order:` right after
  `lanes:` (AC-19).
- **Create** (`create_text`, D-1783): `HEADER` + title + `.`, then every `ORDER` key with these rules: `group_by` and
  `lanes` are written only when `view == Board` (`lanes: vertical`), `lane_order` only when `Some`; `sort` in the one- or
  multi-level style above. Defaults of a new view are the UI's (§4.4 `newViewDef`).
- `retitle_text`, `duplicate_text`: unchanged (they touch only `title:`, `created:`, `modified:`).
- `patch_job_text` (§1.10): also patches `lane_order` entries.
- Read-back check (D-1458): unchanged; it compares the new keys too.
- Expected bytes: `tests/fixtures/queries-files/expected/views/` (§6.2).

### 1.5 Core API (additions)

```rust
impl Core {
    /// Type files (`.tegg/types/*.yml`, readable, not Newer) whose `views` lists `name` (name_key), type-key order.
    pub fn query_view_usages(&self, name: &str) -> Vec<ViewUsage>;
}
```

- `queries()` fills `view` and `types` from the parse. `query_apply`, `query_create`, `query_duplicate`, `query_trash`,
  `query_restore`, `query_usages` keep their signatures and rules (v1-queries §1.5); they carry the new `QueryDef` fields.
- The `views:` write is `type_patch(key, base, &[TypeOp::SetViews(names)])` (ms3-shell §14; base check `Conflict`,
  D-90 create, Newer / invalid refusals), D-1803.
- The card move writes through the existing `note_read` / `note_write` (§1.9). No new core write function.

### 1.6 The evaluator (R185, R187; changes to v1-queries §1.6)

- **Multi-key sort** (D-1768, FR-QRY-01 AC-8). Levels are `def.sort` with repeats of a `by` dropped after its first
  level (D-1806 for `[]`). Each level is checked as today's single `sort` (title / created / modified / an attribute of
  every chosen type with one kind); any invalid level → the whole `sort` `BadValue`, the default `[modified desc]`
  applies. Compare level by level with the v1-queries §1.6 rules per kind (numbers, instants, Select / `review` by
  option order then unknown values by collation after the last option, checkbox false < true, the rest by collation of
  the first value), **empty values last at every level in both orders**; `Desc` reverses only the non-empty comparison of
  that level. Ties after the last level: title by collation, then path (NFC bytes). The sort is stable.
- **Grouping** (`group`, D-1769, D-1770, D-1791). Only when `def.view == Board`:
  - `group_by` resolves when it is `tags`, or an attribute key of **every** chosen type with the same groupable kind:
    Select (incl. `status`), multi-select, relation (single or multiple). Anything else (missing key, an unknown key,
    another kind such as Date or Text, a relation with differing `multiple`, no types) → `Broken { BadValue, key:
    "group_by" }` and `group: None` (R185: drawn as a List with `query.block.brokenKey`). D-1807 (missing key, several
    types).
  - Membership. Select: the value's NFC text equals an option label (exact, case-sensitive) → that option lane, else an
    `Unknown` lane per distinct NFC value; empty → `none`. Multi-select: each distinct entry as Select. Tags: one lane
    per tag key of the object (frontmatter and inline, tags.md R79 keys). Relation: each link value resolved as
    `Core::resolve_link` from the object's path (D-291) → a `Relation` lane per target path; an unresolved value → an
    `Unresolved` lane per link text; empty → `none`. Lane matching: D-1808.
  - Lane order: Select / multi-select: every option in the type file's order (empty lanes included), then `Unknown`
    lanes by collation of the value; tags: by collation of the key; relation: `Relation` lanes by collation of the
    target's title, then `Unresolved` lanes by collation of the text; then `lane_order` moves its listed lanes to the
    front in its order (entries matched by the lane's `value`: option labels and unknown values NFC-exact, tag keys by
    tag key, relation entries resolved as links from the vault root to a target path; an entry matching no lane is
    ignored and kept in the file). `none` is last, present only when it has a card.
  - Excluded option lanes (R187, D-1791). Under `match: all`, each top-level valid (non-broken) filter on the grouping
    key excludes option lanes as follows (values compared `fold`ed, as filters): Select `is a` → every lane ≠ a;
    `is_not a` → a; `is_any_of L` → every lane ∉ L; `is_empty` → every option lane; multi-select `has_none_of L` → every
    lane ∈ L; `is_empty` → every option lane. Other operators (`has_any_of`, `has_all_of`, multi-select `is` /
    `is_any_of` / `is_not`) exclude nothing (another value of the same object may match). With `match: any`, or a
    filter on another key, nothing is excluded. Excluded lanes keep `drop_target: true` and have no cards.
  - Cards: each matching row once per lane it belongs to (FR-QRY-05 AC-11: 20 cards for 17 books), in `rows` order.
- **No paging on a board** (plan §3): `rows` already holds every result (D-1451); the UI applies `limit` to List and
  Table only.
- `query_run` takes one index lock for evaluation and grouping (unchanged rule).

### 1.7 Watcher and events

No new event (plan §3: a board is one more shape of the same results). `vault:changed` already carries `.tegg/types/`,
`.tegg/queries/`, `.trash/.tegg/queries/` and `.md` paths, and `query:stale` the changed objects' types (v1-queries
§1.7). A type file change re-reads `TypeDto.views` through the existing types store.

### 1.8 Trash

Unchanged (v1-queries §1.10). Trashing or restoring a view's query never writes the type file (D-1435, FR-QRY-07 AC-11).

### 1.9 Card move (`@tegg/doc`, D-82; FR-QRY-05 AC-13, AC-14, AC-16; FR-FMT-12 AC-12)

Rust never edits note text (ADR 0003). The card move is a `@tegg/doc` text change sent with `note_write`, as the Tasks
Kanban (ms5-tasks §5).

```ts
// packages/doc/src/board.ts, exported from index.ts
export type BoardMove = {
  key: string;                       // the grouping key (frontmatter key, NFC)
  shape: 'scalar' | 'list';          // Select, single relation: scalar; multi-select, multiple relation, tags: list
  remove: string[];                  // the source lane card's `raw` values (empty from `No <attribute>`, and for Alt)
  add: string | null;                // the target lane's `value` (relation: the `[[…]]` link text); null: nothing added
};
/** null: nothing to write. `inlineKept`: key `tags` and `remove`'s tag also occurs inline in the body (the D-478 note). */
export function applyBoardMove(text: string, move: BoardMove): { text: string; inlineKept: boolean } | null;
```

- `scalar`: the key's value token is replaced by `add` (`formatScalar`, D-230: `status: Reading`, `author: "[[Marek
  Sova]]"`), the line's other bytes kept; a missing key is appended after the last frontmatter entry (D-230, as
  FR-TSK-05 AC-2). An existing NFD value is replaced by the NFC `add`.
- `list`: entries whose NFC text equals one of `remove` are removed; `add` is appended unless an entry with the same
  NFC text (for `tags`: the same tag key) is present; the flow or block style is kept (`genres: [Román, Eseje]` →
  `genres: [Román, Poezie]`; block lines `  - Cestopis` / `  - Román` → `  - Román` / `  - Eseje`); other NFD entries
  keep their bytes; a missing key is appended as one flow line (`genres: [Poezie]`, `tags: [doporučené]`). For `tags`
  the rules are D-478's `moveTag` (the body is never touched).
- `modified:` is set by `touchModified(text, now)` (the caller, as tasks). No other byte changes.
- The UI's write path (`app/ui/src/queries/board/write.ts`, `writeCardMove(row, move)`): `note_read(row.path)`; a
  version different from `row.version` → conflict (no write); else `applyBoardMove` + `touchModified` + `note_write(path,
  text, row.version)`. `Conflict` / version mismatch → the card goes back to its disk state's lane when the run
  re-runs, and the alert `task.changedOutside`-style text of FR-TSK-02 AC-11 (key `board.changedOutside`, R192)
  names the object; `NotFound` (deleted) → nothing written, the card disappears on the next run; `Io` → the card goes
  back, `query.saveFailed`. One write per object in flight (as `writeTask`). `read_only` rows are never written.

### 1.10 Jobs (`tegg-jobs`; FR-QRY-07 AC-8, FR-LNK-03 AC-24, D-1797)

- **`query-rename`** also patches type files (D-1762): `QueryRenamePlan` gains `views: Vec<ViewsRow>` with
  `pub struct ViewsRow { pub path: String, pub pre: Vec<u8>, pub pre_v: FileVersion, pub post: Vec<u8> }`, filled by
  `Host::query_rename_plan` from `Core::query_view_usages(name)` and `tegg_schema::rename_view(text, old name, new
  name)` (rows with `None` are left out). Base check: a type file whose version changed since the scan stops the job
  before any write (as the usages, D-1496). Write order: the file rename, the usages' `saved:` lines, the type files'
  `views:` lines (direct rows: `Written { direct: true }`, byte rows in the undo record, journal entries), last the
  pins. Undo restores every byte. Report `written` lists the type files.
- **Link patches** (4C `note-rename`, 4E-1 moves): `QueryPatch::ObjectMoved` also rewrites `lane_order` entries that
  are links resolving to `from` (D-1467 text; `|alias` / `#sub` kept; `modified:` untouched), in `patch_job_text`.
- Machine-local keys (D-1797) are moved by the UI, not the job: on the `query-rename` job's report `done` (and on its
  Undo), `app/ui/src/views/uiState.ts` `moveQueryState(from, to)` renames `queryColumnWidths[from]`, `boardFolded[from]`
  and every `typeViews.lastTab[*] == from` to `to`, in one `ui_state_set`. An external rename moves nothing.

## 2. IPC

New Tauri module: none. `app/src-tauri/src/shellq.rs` and `lib.rs` change; TS in `app/ui/src/ipc/queries.ts` and
`ipc/types.ts` (`TypeDto`, `TypeOpDto`, `UiStateDto`).

| Command | Change |
| --- | --- |
| `type_patch` | accepts `{ op: 'views'; names: string[] }` → `TypeOp::SetViews`; refusal reason `viewsUnreadable` (`Rule`). `Conflict` carries `disk` as today. |
| `type_get`, types list | `TypeDto` gains `views: string[] \| null` and `viewsUnreadable: boolean` |
| `queries_list` | `QuerySummaryDto` gains `view: 'list' \| 'table' \| 'board' \| null`, `types: string[] \| null` |
| `query_run` | result gains `group: GroupingDto \| null`; rows gain `version`, `excerpt`, `readOnly` |
| `query_apply`, `query_create`, `query_get` | carry the new `QueryDefDto` |
| `query_view_usages` (new) | `name` → `ViewUsageDto[]` (`Core::query_view_usages`; read-only) |
| `query_rename` | unchanged signature; the job also writes type files (§1.10) |
| `note_read` / `note_write` | unchanged; used by the card move (§1.9) |
| `ui_state_get` / `ui_state_set` | `UiStateDto` additions §4.7 |
| `perf_mark` | new marks §4.8 |

```ts
type SortDto = { by: string; order: 'asc' | 'desc' };
type QueryDefDto = {
  title: string; types: string[]; match: 'all' | 'any'; filters: FilterItemDto[];
  sort: SortDto[];                                   // was one mapping (type-only AC-test change, D-1802 / D-1812)
  limit: number; view: 'list' | 'table' | 'board';
  groupBy: string | null; lanes: 'vertical' | 'horizontal'; laneOrder: string[] | null;
  columns: string[];
};
type LaneCardDto = { row: number; raw: string[] };
type LaneDto = {
  id: string; kind: 'option' | 'unknown' | 'tag' | 'relation' | 'unresolved' | 'none';
  value: string | null; label: string; color: string | null; target: string | null;
  excluded: boolean; dropTarget: boolean; cards: LaneCardDto[];
};
type GroupingDto = { key: string; kind: 'select' | 'multiSelect' | 'tags' | 'relation'; multiple: boolean; name: string; lanes: LaneDto[] };
type QueryRowDto = { /* v1-queries */ version: VersionDto; excerpt: string; readOnly: boolean };
type QueryResultDto = { /* v1-queries */ group: GroupingDto | null };
type QuerySummaryDto = { /* v1-queries */ view: 'list' | 'table' | 'board' | null; types: string[] | null };
type ViewUsageDto = { type: string; path: string };
// TypeDto: views: string[] | null; viewsUnreadable: boolean.   TypeOpDto: | { op: 'views'; names: string[] }
```

### 2.1 UI error handling

- `type_patch` `views` refused with `Conflict` / version mismatch (FR-SYN-03 AC-30): nothing written, the page reloads
  the type (`disk`), the tabs go back, alert `views.changedOutside` (`"Books" changed outside Tegg. The views weren't
  changed.`). After a **query create** (New view, Duplicate) the same refusal gives `views.addFailed` instead (FR-QRY-07
  AC-4 (d), D-1812), the query stays.
- `viewsUnreadable`, Newer, invalid: the controls were already `aria-disabled` (R184, AR-07 AC-3); no call is made.
- Query-file writes from a view (sort, lanes, lane order, columns, editor): as v1-queries §2.1 (`query.editor.changedOutside`).
- Card move: §1.9.

### 2.2 Who calls what

| Surface | Calls |
| --- | --- |
| `type/<key>` with views | types store (as today), `queries_list` (tab icons, offers; refreshed as v1-queries §2.2), one `query_run({ kind: 'saved', name }, null)` for the selected view tab per open and per §2.3 re-run; `All <plural>` keeps `index_type_rows` |
| Tab add / drag / remove, Move view left / right | one `type_patch(key, version, [{ op: 'views', names }])` |
| New view | `query_run({ kind: 'def' })` while the editor is open; on Done `query_create({ title: 'New view', def, free: true })`, then `type_patch` |
| Duplicate | `query_duplicate(name)`, then `type_patch` (the copy after the original) |
| Rename… / Move to trash / Restore | `query_rename` / `query_trash` / `query_restore` (v1-queries) |
| Sort popover, header click, lanes switch, lane drag, Reset lane order, Columns, header drag | one `query_apply` with only that key changed |
| Card drag, Move to, Also add to, Move card to next / previous lane | `note_read`, `note_write` (§1.9) |
| `New <Type> in <lane>` | the draft route `new/<type>` with `Route.prefill` (§4.5); the draft's first write as slice Q |
| `query/<name>` `Used on` | `query_usages` and `query_view_usages` |

### 2.3 Live results

Unchanged rules (v1-queries §2.3). A view tab is one more result list: its `query_run` re-runs on its query file's path,
`.tegg/types/` paths, `query:stale` with its types, and the 30 s date check. The tabs follow `TypeDto.views` from the types
store. A card optimistically moved (§4.6) keeps its new lane until the next answer.

## 3. Doc and editor

- `@tegg/doc` gains `packages/doc/src/board.ts` (§1.9), exported from `index.ts`. `formatScalar` is the quoting.
- The editor is unchanged: a board block is the same `rawBlock` `kind: 'query'` drawn through `EditorUi.query`
  (v1-queries §3.2); a card drag or a board control in a block never writes the host note (FR-FMT-07 AC-33).

## 4. UI

### 4.1 Routes

No new route. `type/<key>` stays the route on every tab (D-1790); a tab switch changes only component state (no route
change, no history entry). A pinned type page opens its remembered tab. `query/<name>` draws a board query as a board (D-1773).

### 4.2 Modules

| Module | Owns |
| --- | --- |
| `app/ui/src/views/model.ts` | Pure, L1. `hasViews(typeKey, type)` (D-1787: defined types except `task` and `tag`); `viewTabs(type, summaries)` → `{ name, key: nameKey, summary }[]` (dedupe by `nameKey`, first place wins, NFC/NFD and case); `viewsAfterDrop(names, name, before: string \| null)`, `viewsAfterMove(names, name, delta)`, `viewsAfterRemove(names, name)` (every copy), `viewsAfterInsert(names, name, after: string \| null)` → `string[] \| null` (null: unchanged); `savedOffers(typeKey, summaries, tabs)` → `{ enabled: QuerySummaryDto[]; greyed: { summary; reason: 'otherType' \| 'severalTypes' \| 'allTypes' \| 'needsNote' \| 'unreadable' }[] }` (D-1763 order and reasons, type reason first); `pageMarks(types, summaries)` → `Map<nameKey, plural[]>`; `newViewDef(type, kind, typesAll)` (D-1783: Table/List `columns` = `effectiveColumns(type)`, Board `groupBy` = `defaultGroupBy(type)`, `lanes: 'vertical'`, `laneOrder: null`, `columns` = `preview` minus the grouping key; `sort [modified desc]`, `limit 50`, `filters []`, `match all`); `defaultGroupBy(type)` (first Select in schema order, else first multi-select, else `tags`); `groupByChoices(type)` (Select, multi-select, relation attributes in schema order, then `tags`; FR-QRY-01 AC-13) |
| `app/ui/src/views/uiState.ts` | `lastTab(typeKey)`, `setLastTab(typeKey, name \| null)` (one `ui_state_set` per switch), `moveQueryState(from, to)` (§1.10) |
| `app/ui/src/views/TypeViews.tsx` | the tablist, `Add view` menu, view menu, tab drag, the remembered tab, per-tab filter text (D-1796), the panel of the selected view (`ViewPanel`) |
| `app/ui/src/views/ViewPanel.tsx` | a view tab's toolbar and body: `useQueryRun({ kind: 'saved' })`, the state messages (R141 texts), `ViewTable` / `ViewList` / `QueryBoard`, the `brokenTypes` notice |
| `app/ui/src/queries/sort.ts` | Pure, L1 (R188, D-1784): `levels(sort)` (repeats dropped), `headerClick(sort, key, shift)`, `addLevel(sort, choices)` (first unused, asc), `removeLevel(sort, i)` (the last → `[modified desc]`), `moveLevel(sort, from, to)`, `clearSort()` → `[modified desc]`, `sortChoices(type)` (`title`, `created`, `modified`, then attributes in schema order), `orderLabels(key, type)` → `{ asc, desc }` catalog texts per kind (AP-1502), `markers(sort)` → `Map<key, { arrow: '↑' \| '↓'; n: number \| null }>` (n only with ≥ 2 levels), `buttonText(sort, nameOf)` → `{ text: 'Finished ↓'; more: number }`, `sameSort(a, b)` |
| `app/ui/src/queries/SortPopover.tsx` | `dialog` `Sort` (R188), one `query_apply` per change; used by `ViewPanel`, `QueryBlock`, `QueryPage` |
| `app/ui/src/queries/board/model.ts` | Pure, L1: `cardMove(group, row, fromLaneId, toLaneId, alt)` → `BoardMove \| null` (D-1769 rules: Select / single relation set; list kinds remove `raw`, add unless the row is already in the target lane; Alt: `remove: []`; onto a non-drop-target or the same lane: null); `laneOrderAfterDrop(group, laneId, beforeId \| null)` → `string[] \| null` (every lane's `value` except `none`, in the new order); `neighbourDropLane(group, laneId, dir)` (skips non-drop-targets, excluded lanes included as targets; null at the ends); `prefillFor(def, group, laneId, type)` (§4.5); `excludedValues(group)` (labels of the non-excluded option lanes, for `board.excludedLong`) |
| `app/ui/src/board/Board.tsx` | The generic board (lanes vertical or horizontal, pointer drag of cards and lanes, folds, sideways scroll, lane virtualisation ≤ 150 card elements, the drop label, keyboard focus moves), no data access; extracted so Q2-T reuses it. `tasks/Kanban.tsx` is **not** moved onto it in Q2: the Tasks page's DOM and tests stay as they are (plan §6) |
| `app/ui/src/queries/board/QueryBoard.tsx` | `Board` bound to a `QueryResultDto` with `group`: the universal card (`BoardCard.tsx`), the lanes switch, lane drag → `query_apply({ laneOrder })`, card move → `writeCardMove`, folds (§4.7), `New <Type> in <lane>`; used by `ViewPanel`, `QueryBlock`, `QueryPage` |
| `app/ui/src/queries/board/BoardCard.tsx` | the card (R187, D-1793), generalised from `tasks/TaskCard.tsx` (no checkbox); `CardMenu` items `Open`, `Move to ›`, `Also add to ›` |
| `app/ui/src/queries/board/write.ts` | `writeCardMove(row, move)` (§1.9) |
| `app/ui/src/tables/widths.ts` | The shared width helper (D-1767): `WIDTH`, `clampWidth` move here from `types/columns.ts` (which re-exports them unchanged); `useColumnWidths(scope: { kind: 'type'; key: string } \| { kind: 'query'; name: string })` → `{ widths, set(key, px, save), reset() }` reading and writing `typeColumnWidths[key]` or `queryColumnWidths[name]` (one `ui_state_set` on release, debounced ≤ 1 s after keys); every mounted table of the same scope updates at once |
| `app/ui/src/tables/HeaderCell.tsx` | The header cell with its resize handle (type-columns §4), extracted from `TypePage.tsx`; props select the sort behaviour (`single`: the type page's machine-local sort; `levels`: R188 click / ⇧-click) and the reorder behaviour (`keys: true` only on `All <plural>`, D-1798) |
| `app/ui/src/queries/QueryBlock.tsx` | gains the header sort button (icon + level count), header click / ⇧-click, resize handles, header drag (writes `columns`), the board body (`QueryBoard`) when `group` is set |
| `app/ui/src/queries/QueryEditor.tsx` | R189: `fixedType?: { key: string; plural: string }` (opened from a tab), `View` gains `Board`, rows `Group by`, `Lanes`, `On cards`, no `Sort` row (D-1795), `Limit` hidden with Board, the usage notice counting type pages (`query_view_usages`) |
| `app/ui/src/queries/QueriesPage.tsx` | the `<plural> page` mark per row (`pageMarks`) |
| `app/ui/src/queries/QueryPage.tsx` | `Used on`: `ViewUsageDto` chips first (`views.pageMark`, open `type/<key>` on that tab), then notes |
| `app/ui/src/pages/TypePage.tsx` | renders `TypeViews` (tab 0 is today's table, unchanged), the wide layout, loses `Filter`, `Group`, `Add view` placeholders (D-1801) |
| `app/ui/src/types/…` Type settings | loses the Views section (D-1801) |

### 4.3 DOM (roles, names, attributes the tests use)

| Part | Element | Name and attributes |
| --- | --- | --- |
| Tablist | `div[role=tablist]` | `aria-label` `typePage.views` (`Views`); `data-views-tablist`; the `Add view` button is its next sibling inside `div.view-tabs-wrap` (a tablist holds only tabs) |
| `All` tab | `[role=tab]` | text `views.all` (`All Books`, `data-user-content` on the plural); `data-view-tab=""`; `data-view-kind="table"`; `id` `view-tab-all`; no `aria-haspopup`, not draggable |
| View tab | `[role=tab]` | text = the name as written in `views:` (`data-user-content`); `data-view-tab="<name NFC>"`; `data-view-kind="table\|list\|board"` (from `QuerySummaryDto.view`; absent when unknown); `data-view-state="ok\|trashed\|missing\|unreadable\|newer\|types"` (once run; only the selected tab is run); `aria-selected`; `aria-haspopup="menu"`; `aria-posinset` / `aria-setsize` as the order (VoiceOver `1 of 4`); `tabIndex` 0 on the selected, −1 on the others; icon `span[data-icon]` (`table`, `list`, `board`); on the selected tab the chevron `span.view-chevron[data-view-chevron][aria-hidden=true]` (a click opens `View actions`); draggable by pointer (> 4 px moves) |
| Tab panel | `div[role=tabpanel]` | `aria-labelledby` the selected tab's `id`; `data-view-panel="<name>"` (`""` for `All`) |
| Add view | `button` | `aria-label` `views.add`, `aria-haspopup="menu"`, `data-command="views.new"`; `aria-disabled` + `aria-description` (`views.unreadableSetting`, AR-07 AC-3's newer reason) when it can't write |
| Add view menu | `[role=menu]` | `aria-label` `views.addMenu`; `[role=group]` `views.newGroup` with `menuitem`s `views.kind.table`, `views.kind.list`, `views.kind.board` (the last with `aria-description` `views.kind.boardBy`); separator; `[role=group]` `views.savedGroup` with one `menuitem` per query (`data-query="<name>"`, `data-user-content`), greyed ones `aria-disabled="true"` with `aria-description` = the reason text |
| View menu | `[role=menu]` | `aria-label` `views.menu`; `menuitem`s `views.edit`, `views.rename`, `views.duplicate`, `views.openAsQuery` (`aria-description` `views.openAsQueryHint`), separator, `views.remove` (`aria-description` `views.removeHint`), `views.trash`; from the toolbar also `board.resetOrder` when the board has `lane_order` |
| View toolbar | `div.view-toolbar` | `input[type=search]` `aria-label` `typePage.filter`; the tag filter of `tasks/TagFilter.tsx` (button `tasks.tagFilter`); sort button; `Columns` (Table: `button` `typePage.columns`, `data-command="view.columns"`, `aria-haspopup="menu"`) or the lanes `radiogroup` (Board); `button` `aria-label` `views.menu`, visible `⋯`, `aria-haspopup="menu"`, `data-command="views.menu"` |
| Sort button | `button` | `aria-label` `sort.button` (`Sort`), `aria-haspopup="dialog"`, `aria-expanded`, `data-command="sort.open"`; visible `span.sort-first` (`Finished ↓`, from `sort.buttonText`) and `span.sort-more` (`sort.more`, `+2`) when > 1 level; in a block header: an icon and `span.sort-count` (`3`), same name |
| Sort popover | `div[role=dialog]` | `aria-label` `sort.dialog`, not modal; one `div[role=group][data-sort-level="<i>"]` per level with `aria-label` `<sort.by \| sort.then> <column>, <order label>`; inside: grip `span[role=button][tabIndex=0]` `sort.drag`; `combobox` (`aria-label` `sort.by` / `sort.then`) whose `option`s are `sortChoices` minus keys used at other levels; `combobox` `aria-label` `sort.orderLabel` (R192) with two `option`s from `orderLabels`; `button` `sort.remove`; then `button` `sort.add`, `button` `sort.clear` |
| Sorted header | `[role=columnheader]` | `tabIndex=0`; `aria-sort` on the first level only (`ascending` / `descending`); other levels `aria-description` `sort.level` (`Sort level 2, ascending`); visible marker `span.sort-marker[aria-hidden=true]` (`↑`, `↓`, with `sup` `1`, `2`, `3` when ≥ 2 levels); `draggable` except Title (D-1798); then the resize `separator` of type-columns §4 (`typePage.resize`) |
| Lanes switch | `div[role=radiogroup]` | `aria-label` `board.lanes`; `[role=radio]` `board.vertical` / `board.horizontal` (`title` `board.verticalTitle` / `board.horizontalTitle`), `aria-checked`; `data-command="board.switchLanes"` |
| Board | `div[role=group]` | `aria-label` = the query's title (`data-user-content`); `data-board`; `data-lanes="vertical\|horizontal"`; `data-group-by="<key>"`; `data-board-name="<name>"` (null for inline); the sideways scroller is `div.board-scroll` (its own `scrollLeft`) |
| Lane | `section[role=region]` | `aria-label` `<label>, <board.laneCount>` (`Reading, 3 cards`; `none`: `No Status, 1 card`); excluded: `aria-description` `board.excluded`; `data-lane="<id>"`, `data-lane-kind`, `data-excluded` (present when excluded), `data-drop-target="true\|false"`, `data-folded` (horizontal, when folded) |
| Lane header | `h2` | the label (`data-user-content`; Select option lanes carry `data-color="<colour>"` and use `var(--type-<colour>)`, others `--muted`); count `span.count[aria-hidden=true]`; excluded text `p.lane-excluded` (`board.excluded` vertical, `board.excludedLong` horizontal) |
| Lane grip | `span[role=button]` | `tabIndex=0`, `aria-label` `board.dragColumn` (vertical) / `board.dragRow` (horizontal), `aria-describedby` the heading, `data-command="board.laneDrag"`; absent on `none` |
| Fold chevron | `button` | horizontal only; `aria-label` `board.collapse` / `board.expand` (`{lane}` = label), `aria-expanded`; ⌥-click folds or unfolds every row |
| New in lane | `button` | `aria-label` `board.newIn` (`New Book in Reading`); vertical: `+` at the lane's end; horizontal: the dashed tile, visible `board.newTile`; `data-command="board.newIn"`; absent on `none`, unknown, unresolved and excluded lanes |
| Card | `article` | `aria-label` `board.card` (`Book: Účetní ze Žižkova`); `data-board-card="<path NFC>"`, `data-lane="<id>"`, `tabIndex` roving; title link `a[data-card-title]` (opens `note/<path>`, previews per D-1164); `button` `task.more` (`More actions for "<title>"`, `aria-haspopup="menu"`); tags `span.card-tag` (`#doporučené`); body `p.card-excerpt` (2 lines); pills `span.card-pill[data-attribute="<key>"]` in `columns` order (the grouping key only for a multi-value card with ≥ 2 values, then all its values); an empty value `span.card-pill[data-attribute][data-empty]` with `board.none` in `--faint`; relation values as link chips `a.chip[data-attribute="<key>"]` in `footer` |
| Drop label | `div.board-drop[role=presentation]` | over the target lane during a drag: `board.dropSet` (`Drop to set Status: Reading`) or, with Alt on a list kind, `board.dropAdd`; absent over non-targets |
| Live region | `div.sr-live` | `role="status"`, `aria-live="polite"`: `board.moved`, `board.added`, `board.leftView`, `board.inlineKept`, `board.laneMoved`, `views.moved`, once per action |
| Editor | `div[role=dialog]` `query.editor.dialog` | from a tab: the type chip without `query.editor.removeType`, no `query.editor.type` button, `p` `query.editor.showFixed`; `radiogroup` `query.editor.view` with `query.editor.list`, `query.editor.table`, `query.editor.board`; Board only: `combobox` `query.editor.groupBy` (`aria-description` `query.editor.groupByHint`), `radiogroup` `query.editor.lanes` (`board.vertical`, `board.horizontal`), `div[role=group]` `query.editor.onCards` with the names and `button` `query.editor.onCardsChange` (`aria-haspopup="menu"`, the R130 Columns menu); no Sort row; no Limit with Board; notice `p` `query.editor.usedOnPage` |
| Queries row mark | `span.page-mark` | inside the row's first cell after the title: `views.pageMark` (`Books page`), one per type page; not matched by `Find a query…` |
| Used on chip | `a[data-usage-type="<key>"]` | `views.pageMark`, first in the `Used on` list |

### 4.4 Behaviour the contract fixes

- **Tabs** (R186). `views:` is read from `TypeDto.views`; `viewTabs` dedupes. Selecting a tab: `setLastTab`, no history
  entry, `perfMark('board-request')` when its view is a board. ←/→ on the tablist move and select (as `Task views`).
  Tab drag: pointer down on a view tab, > 4 px moves, a drop indicator between tabs; a drop before `All` lands after it;
  Esc or a drop at its own place writes nothing. `viewsUnreadable`, Newer or invalid type files: `Add view`, drags,
  `Remove` and Move view are `aria-disabled` with the reason; no write.
- **New view** (D-1781). `Add view › Table|List|Board`: a draft tab `New view` (selected, `data-view-state="draft"`) and
  the editor (from the tab, title `New view` selected) with `newViewDef`; results by `query_run({ kind: 'def' })`. Esc
  with no change, or leaving the page: the draft goes, nothing written. `Done` (changed or not) or a change then close:
  `query_create({ title, def, free: true })` (exclusive; ` (2)` when taken, D-1477), then `type_patch` with the created
  name appended. Undo: D-1809.
- **Show a saved query**: `type_patch` with the name appended; the tab is selected; the query file is untouched.
- **Duplicate** (D-1788): `query_duplicate`, then `type_patch` with the copy right after the original; selected.
- **Remove** (`views.remove`): `type_patch` without every copy; the previous tab is selected (`All` when none).
- **Move to trash / Restore**: `query_trash` / `query_restore`; the tab stays; its state follows the re-run.
- **Rename…**: the `Rename query` dialog of slice Q → `query_rename`; a taken name is refused before the job
  (`query.newQuery.taken`); while the index loads, `query.rename.notReady` (D-1510).
- **Per-tab filter text** (D-1796): a `Map<tabName, { text, tags }>` in `TypeViews`' state; leaving the route clears it.
  The text filter narrows rows by folded title (D-109); the tag filter keeps rows with every chosen tag key; neither
  writes nor changes `query_run`. On a board both narrow cards; lane counts show the narrowed numbers.
- **Header click / ⇧-click** (D-1784): `sort.headerClick(levels, key, shift)`; when the result differs from the file's
  sort (`sameSort`), one `query_apply` with only `sort` changed; ⏎ / Space act as a click, ⇧⏎ as ⇧-click. A press that
  moved > 4 px is a column drag (D-1798, writes `columns` once), never a sort. On `All <plural>` ⇧-click is a plain
  click (machine-local `typeSort`).
- **Sort popover**: each add, remove, reorder, column or order change, and Clear is one `query_apply`; Esc closes and
  writes nothing more. `Add sort level` opens it with a new level appended and its column combobox focused (the level
  is written when added).
- **Lanes switch** (`radiogroup` or `Switch lanes`): one `query_apply` with `lanes` flipped; the checked radio writes nothing.
- **Lane drag**: grip pointer drag or `Move lane left/right/up/down`; `laneOrderAfterDrop` → `query_apply({ laneOrder })`;
  `none` can't move and nothing drops after it. `Reset lane order`: `query_apply({ laneOrder: null })`.
- **Card drag**: pointer down on a card, > 4 px starts the drag; Alt at drop time (and while hovering, for the label)
  means add only. Drop targets: lanes with `dropTarget`; a folded row is a target. On drop the card is moved in the
  DOM at once (optimistic, NFR-PERF-07 AC-4) and `perfMark('board-card-moved')` is written when it is in the target
  lane's DOM; then `writeCardMove`. A refused or failed write puts the card back. Live text: `board.moved`
  (`board.added` for Alt / from `none`), `board.leftView` when the target lane is excluded, plus `board.inlineKept` when
  `inlineKept`. Keyboard: `Move card to next / previous lane` (`neighbourDropLane`), focus stays on the moved card or,
  when it leaves the view, on the next card of its old lane. No Undo (D-1794).
- **Focus on a board** (R191, D-1789): roving `tabIndex` over cards; Tab into the board focuses the first card of the
  first lane with cards; vertical ↑/↓ within a lane, ←/→ to the card at the same index of the neighbouring lane (else its
  last card); horizontal ←/→ within a row, ↑/↓ to the neighbouring row; ⏎ opens; Back restores the focus.
- **Folds** (horizontal): toggling writes `boardFolded[name]` (lane ids) with one `ui_state_set`; inline (unnamed)
  blocks fold in memory only.
- **Read-only views** (`version` > 1): every write control `aria-disabled` with `query.block.readOnly` (sort button,
  header click, Columns, lanes switch, lane grips, card drag, `Move to`, New in lane); results shown.
- **Types changed** (D-1763): when the view's `types` isn't exactly `[<page type>]`, the panel shows `views.brokenTypes`
  above the results as written (`views.brokenAllTypes` when `types` is empty; `{types}` = the types' Names joined by `Intl.ListFormat(locale, { type: 'conjunction' })`).
- **Board in a note** (D-1773): `QueryBlock` draws `QueryBoard` inside the note column (`max-width: 100%`), sideways
  scroll inside `div.board-scroll`; drags, `+`, folds and lane drags as on the page; `Switch lanes` from the palette
  with the block selected. Inline fences: D-1810.
- **Wide pages** (D-1772): `type/<key>` (every tab), `queries`, `query/<name>`: the page container drops
  `.page-column`'s `max-width` (computed `max-width: none`) and has 40 px side padding. Notes unchanged.

### 4.5 New object from a lane (FR-QRY-08 AC-2)

`prefillFor(def, group, laneId, type)` = slice Q's `prefill(def, null, types)` (top-level Select `is` values, D-1439)
with the lane's value set on the grouping key (overriding an `is` on the same key): Select `[key, label]`; multi-select
`[key, [label]]`; relation `[key, "[[…]]"]` (the lane's `value`); tags `['tags', [tagKey]]`. Passed as `Route.prefill`
on `new/<type>` (D-1490); nothing written until the draft's first write (D-520).

### 4.6 Strings (R192; NFR-OTH-02 AC-21)

Every R192 key in `app/ui/src/i18n/catalog.ts` with R192's English text, plurals per D-133 (`board.laneCount` `{ one:
'{count} card', other: '{count} cards' }`, `query.editor.usedOnPage` with `one` `… and {count} note.` / `other` `… and
{count} notes.`). `views.all` replaces `typePage.allView` (renamed, same text). Removed (D-1801): `ctl.filter`,
`ctl.group`, `ctl.addView`, `ctl.addViewSettings`, `ctl.editView` and their R3 descriptions, and the Type settings
Views section's keys. Kept: `query.editor.sort`, `query.editor.asc`, `query.editor.desc` (no longer drawn; slice Q's
catalog list stays intact). Reused existing keys (not new): `typePage.views`, `typePage.filter`, `typePage.columns`,
`typePage.resize`, `typePage.resetWidths`, `tasks.tagFilter`, `task.more`, `pinned.open`, `query.block.*` state texts,
`query.block.readOnly`, `queries.renameDialog`, `query.newQuery.taken`, `query.rename.notReady`, `query.saveFailed`,
`attr.tags`. R192 as fixed by D-1812 also has `board.card`, `views.moved`, `sort.orderLabel`, `board.changedOutside`,
`views.brokenAllTypes`, and no `views.notReady`. Sort order labels: `sort.order.optionFirst` with
the first option for ascending and the last for descending (`Excellent first`, `Bad first`); text, title, relation,
multi-select and tags `textAsc` / `textDesc`; dates and date-times `dateAsc` / `dateDesc`; numbers; checkbox.

### 4.7 Commands and UI state

Commands (R191, D-1771, D-1789; `needsVault: true`, no shortcut, section `view` unless noted):

| Id | Title key | Listed when |
| --- | --- | --- |
| `views.new` | `cmd.newView` (section `create`) | `type/<key>` with `hasViews` and `Add view` enabled |
| `views.edit` | `cmd.editView` | a view tab selected (not `All`) |
| `views.next` / `views.previous` | `cmd.nextView` / `cmd.previousView` | `type/<key>` with `hasViews` (no-op at the ends) |
| `views.moveLeft` / `views.moveRight` | `cmd.moveViewLeft` / `cmd.moveViewRight` | a view tab selected and the type file writable |
| `board.switchLanes` | `cmd.switchLanes` | a board tab, a board `query/<name>`, a selected board block (writable) |
| `sort.addLevel` | `cmd.addSortLevel` | a view tab, `query/<name>`, a selected saved-query block (writable) |
| `board.resetLaneOrder` | `cmd.resetLaneOrder` | a board whose def has `laneOrder` |
| `board.cardNext` / `board.cardPrevious` | `cmd.cardNext` / `cmd.cardPrevious` | a card focused |
| `board.laneLeft` / `board.laneRight` | `cmd.laneLeft` / `cmd.laneRight` | a vertical board's lane header or card focused |
| `board.laneUp` / `board.laneDown` | `cmd.laneUp` / `cmd.laneDown` | a horizontal board's lane header or card focused |

`ShellActions` gains `views?: { status(): ViewsStatus | null; run(id: string): void }` with `type ViewsStatus = {
typeKey: string | null; tab: string | null; writable: boolean; board: { lanes: 'vertical' | 'horizontal'; laneOrder:
boolean; cardFocused: boolean; laneFocused: boolean } | null; sortable: boolean }`, set by `TypeViews`, `QueryPage` and a
selected `QueryBlock`. `typePage.resetWidths` on a view tab resets `queryColumnWidths[name]`.

`UiStateDto` gains (Rust `#[serde(default, skip_serializing_if = "Option::is_none")]`, `version` stays 1):

```ts
typeViews?: { lastTab?: Record<string /* type key */, string | null /* tab name; null = All */> };
queryColumnWidths?: Record<string /* query name (file stem, NFC) */, Record<string /* column key */, number>>;
boardFolded?: Record<string /* query name */, string[] /* lane ids */>;
```

`typeColumnWidths` and `typeSort` stay the `All` tab's. A remembered name not in `views:` opens `All` (and isn't rewritten
until the next switch).

### 4.8 Performance marks (D-1800; NFR-PERF-07 AC-3, AC-4)

Through `ipc.perfMark` (as `query-ready`): `board-request` when a board tab is chosen (before its `query_run`),
`board-ready` once when the cards visible in the viewport have painted (two animation frames after the answer is
committed), `board-card-moved` once per drop when the card is in the target lane's DOM (before the write settles).

## 5. Fake core and test hooks

- `app/ui/test/fake-queries.ts` learns §1.2 (the new keys and both `sort` forms), §1.4 (`ORDER`, styles, comment rules,
  `lane_order` removal, create), §1.6 (multi-key sort, `group` with lanes, cards, `raw`, exclusion, `lane_order`, NFC) and
  `QueryRowDto.version` / `excerpt` / `readOnly`; `queries_list` fills `view`, `types`; new `query_view_usages`. Checked
  against the Rust module on `tests/fixtures/queries-files/` and `expected.json` (L3; `app/test/fake_queries.contract.test.ts`).
- `app/ui/test/fake-schema.ts`: the `views` op (flow line, TOP place, block list replaced, `views: []`, NFC,
  `viewsUnreadable`), `TypeDto.views` / `viewsUnreadable`, every other op keeping the `views` bytes.
- The fake `query-rename` job patches `views:` lines of the fake's type files (as §1.10, base-checked) and reports them
  in `written`; `note-rename` patches `lane_order` link entries.
- The card move uses the fake's existing `note_read` / `note_write` (versions, `setFile(…, { silent: true })`,
  `writeControl({ path })`, `delayCommand('note_write', ms)` to hold a write for NFR-PERF-07 AC-4's optimistic check).
- `ui_state_set` stores the §4.7 keys; `uiState()` returns them.
- Handle additions: `perfMarks(): Promise<{ name: string; at: number }[]>` (the `perf_mark` calls in order). Existing
  hooks cover the rest (`calls()`, `writes()`, `writesTo()`, `queryCalls()`, `queryRuns()`, `queriesFail`, `jobs()`,
  `setFile`, `sameBytesTouch`, `renameFile`).
- `window.__TEGG_TEST__.board()` (L5, L6 with `TEGG_TEST=1`): `{ name: string | null; lanes: { id: string; cards:
  string[] /* paths */ }[]; domCards: number }[]` for every mounted board (lane virtualisation check, NFR-PERF-07 AC-3).
- L6: as v1-queries §5 (`TEGG_NOW`, `TZ`, `app/e2e/helpers/external.ts` edits type files, query files and notes,
  relaunch with the same temporary Application Support). The kill harness (FR-SYN-02 AC-11) runs at L4: alternating
  `Switch lanes` commits through `Core::query_apply`, alternating `views` lists through `Core::type_patch`, and
  alternating card-move bytes (the two `expected/views/books/kniha-o-horach-*.md` texts) through `Core::note_write`.

## 6. Test layout and fixtures

### 6.1 Files

| Layer | Files |
| --- | --- |
| L0 | AR-03 check covers the new code in `queries_q.rs` and `tegg-schema` |
| L1 | `app/test/views_model.ac.test.ts` (`views/model.ts`: tabs, offers, marks, new-view defs, group-by choices; FR-QRY-07 AC-1 model, FR-QRY-01 AC-13), `app/test/views_sort.ac.test.ts` (`queries/sort.ts`: FR-QRY-01 AC-11 model, the comparator twin of AC-8), `app/test/views_board.ac.test.ts` (`queries/board/model.ts`: FR-QRY-05 AC-10 lane model, AC-14 change model, AC-22 neighbours, FR-QRY-08 AC-2 prefill), `app/test/views_widths.ac.test.ts` (`tables/widths.ts`), `app/test/views_registry.ac.test.ts` (FR-UX-03 AC-50, FR-QRY-07 AC-17 R3), `app/test/views_catalog.ac.test.ts` (NFR-OTH-02 AC-21); `packages/doc/test/board_move.ac.test.ts` (§1.9 bytes: FR-QRY-05 AC-13, AC-14, AC-16, FR-FMT-12 AC-12 card-move part, against `expected/views/books/`) |
| L2 | `crates/tegg-core/tests/ac_views_props.rs` (FR-QRY-01 AC-8 oracle with 1…4 levels; FR-FMT-07 AC-32 patch invariants), fast-check twins `app/test/views_props.ac.test.ts` and `packages/doc/test/board_move_props.ac.test.ts` |
| L3 | `tests/fixtures/queries-files/expected.json` gains `reads` for every `tests/fixtures/vaults/views/.tegg/queries/*.yml` (the §2 `QueryDefDto` with `sort` as a list) and `groups`: `[ { "query", "env", "lanes": [ { "id", "label", "excluded", "dropTarget", "paths" } ] } ]` (R193's boards); read by `ac_views.rs` and `fake_queries.contract.test.ts` |
| L4 | `crates/tegg-core/tests/ac_views.rs` (§1.2 reads, R193 results and lanes, multi-key sort, query-file writes against `expected/views/`, `Conflict`, the watcher, NFC, `query_view_usages`, the kill harness, `note_write` base check for card moves), `crates/tegg-schema/tests/ac_views_type_file.rs` (AR-07 AC-9, `SetViews` bytes, TOP place, block list, unreadable, other ops keep `views`, `rename_view`), `crates/tegg-jobs/tests/ac_views_jobs.rs` (FR-QRY-07 AC-8, FR-LNK-03 AC-24 with the real `Core` host and `NodeTransformer`), `crates/tegg-core/tests/ac_views_perf.rs` (NFR-PERF-07 AC-3's `query_run` with grouping; `nfr_perf_*`, skipped at push) |
| L5 | `app/webkit/views_tabs.ac.test.ts` (FR-QRY-07 AC-1…AC-15, AC-17, AC-18, FR-QRY-06 AC-23…AC-25, FR-TYP-09 AC-35), `views_board.ac.test.ts` (FR-QRY-05 AC-10…AC-22, FR-QRY-08 AC-2, FR-QRY-09 AC-6, AC-7), `views_sort.ac.test.ts` (FR-QRY-01 AC-8…AC-13, FR-QRY-05 AC-23), `views_writes.ac.test.ts` (FR-SYN-03 AC-30, FR-SYN-06 AC-48 counts, FR-FMT-07 AC-33, FR-FMT-12 AC-12, FR-STO-07 AC-10), `views_a11y.ac.test.ts` (FR-UX-03 AC-50, AC-51, FR-UX-08 AC-24, FR-UX-05 AC-24, NFR-OTH-02 AC-21, NFR-PERF-07 AC-3 DOM count); helpers `app/webkit/views-helpers.ts` |
| L6 | `app/e2e/views.ac.test.ts` (views.md "Real-app tests"), `app/e2e/nfr_perf_07_board.ac.test.ts` (NFR-PERF-07 AC-3, AC-4; nightly), both in the red-test commit (D-382); keys only to Tegg (D-799) |
| manual | FR-QRY-07 AC-16 (`qa/manual/`) |

No new `qa.config.json` step: every file is in a package that already has one.

### 6.2 Expected bytes (`tests/fixtures/queries-files/expected/views/`, README there)

Written with the red tests by the test author from the ACs. Clock `2026-11-19T10:00:00+01:00`; inputs the files of
`tests/fixtures/vaults/views/`. Byte rules as `expected/` (LF, final newline; `-crlf`, `-no-newline` variants).

| File | Input → action | Criteria |
| --- | --- | --- |
| `new-view-autor.yml` | `New view` › Table on `type/autor`, Done | FR-QRY-07 AC-4 (b) |
| `new-view-board-book.yml` | `New view` › Board on `type/book`, Done (`group_by: status`, `lanes: vertical`, `columns: [author]`) | AC-4 (c) |
| `types/autor-views-new-view.yml` | `autor.yml` with `views: [New view]` after line 10 | AC-4 (b) |
| `types/book-views-new-view.yml` | `views: [Rozečtené, Přečtené 2026, Výborné knihy, New view]` | AC-4 (c) |
| `types/book-views-podle-zanru.yml` | Show a saved query `Podle žánru` | AC-5 |
| `types/book-views-dragged.yml` | `Výborné knihy` before `Rozečtené` | AC-6 |
| `types/book-views-move-right.yml` | `Move view right` on `Rozečtené` | AC-6 |
| `types/book-views-renamed.yml` | rename `Přečtené 2026` → `Přečtené letos` | AC-8 |
| `types/book-views-duplicate.yml` | Duplicate `Výborné knihy` | AC-9 |
| `types/book-views-removed.yml`, `types/book-views-empty.yml` | Remove `Přečtené 2026`; then the other two | AC-10 |
| `types/book-views-block-to-flow.yml` | the runtime block-list variant, one tab change | AC-12 (c) |
| `types/book-views-{crlf,no-newline}-dragged.yml` | AC-6's drag on the CRLF / no-newline copies | FR-FMT-07 AC-33 |
| `prectene-letos-renamed.yml`, `cteni-2026-renamed.md` | the rename's query file (title only) and Čtení's `saved:` | AC-8 |
| `prectene-2026-columns-genres.yml` | `Columns` › Genres | AC-3 |
| `prectene-2026-columns-reordered.yml` | `Finished` header before `Author` | AC-18 |
| `rozectene-lanes-horizontal.yml`, `podle-autora-lanes-horizontal.yml`, `podle-zanru-lanes-vertical.yml` (+ `-crlf`, `-no-newline`) | lanes switch | FR-QRY-05 AC-17, FR-FMT-07 AC-32 |
| `rozectene-lane-order-to-read-first.yml`, `podle-zanru-lane-order-cestopis.yml`, `podle-autora-lane-order-tomas.yml`, `rozectene-lane-order-reset.yml` | lane drags, Reset lane order | AC-19 |
| `podle-zanru-sort-add-level.yml`, `podle-zanru-lane-order-reset-after-drag.yml` | `+ Add sort`; drag then Reset | FR-QRY-01 AC-10 (c), FR-FMT-07 AC-32 |
| `vyborne-knihy-sort-two-levels.yml`, `vyborne-knihy-sort-back-to-one.yml` | ⇧-click Finished; Remove it | FR-QRY-01 AC-10 (a), (b) |
| `prectene-2026-sort-rating-desc.yml`, `-sort-title-first.yml`, `-sort-one-level.yml`, `-sort-add-created.yml`, `-sort-cleared.yml` | the popover steps (a)…(e) from the fixture | FR-QRY-01 AC-9 |
| `prectene-2026-click-rating.yml`, `-click-rating-desc.yml`, `-shift-finished.yml`, `-click-author.yml` | header click steps (a)…(d) | FR-QRY-01 AC-11 |
| `rozectene-group-by-genres.yml`, `rozectene-view-table.yml` | the editor commits | FR-QRY-01 AC-12 |
| `podle-autora-lane-order-marek-sovak.yml` | 4C rename of Marek Sova on the runtime `lane_order` variant | FR-LNK-03 AC-24 (b) |
| `books/kniha-o-horach-reading.md` | card drag To read → Reading | FR-QRY-05 AC-13 |
| `books/sto-zimnich-dni-poezie.md`, `books/sto-zimnich-dni-eseje-only.md`, `books/carovna-mapa-eseje.md`, `books/mapa-bez-severu-alt-poezie.md`, `books/ostrov-bez-jmena-poezie.md`, `books/dum-u-reky-marek-sova.md`, `books/svetla-pristavu-doporucene.md` | AC-14 (a)…(e), relation, tags | FR-QRY-05 AC-14 |
| `books/nocni-vlak-read.md` | drop on the excluded `Read` | FR-QRY-05 AC-16 |

## 7. Owner decision

Done (2026-11-19): §9 (D-1803…D-1811) and §10 (D-1812). None open.

## 8. Contract choices (no owner decision needed; follow the ACs and precedents)

1. The query model is extended in place (`QueryDef.sort: Vec<Sort>`, `View::Board`, `group_by`, `lanes`, `lane_order`); no parallel view type.
2. Grouping runs in the core with the evaluation (`QueryResult.group`), cards as row indices with the `raw` values that placed them; the UI never re-groups.
3. Lane ids `option:` / `unknown:` / `tag:` / `relation:` / `unresolved:` / `none` key the DOM, folds and drags; `value` is what `lane_order` and a drop write.
4. Excluded lanes are computed from top-level `match: all` filters by the §1.6 operator table, option lanes only.
5. The card move is `@tegg/doc` `applyBoardMove` plus `note_write` with the row's index version (D-82, as the Tasks Kanban); `QueryRow` gains `version`, `excerpt`, `readOnly`.
6. `views:` is a `tegg-schema` `TypeOp::SetViews` sent through `type_patch` (D-1803), placed right after `columns`.
7. The query rename job patches type files as direct rows after the usages and before the pins; the UI moves machine-local keys after the job.
8. `Board.tsx` is generic and new; the Tasks Kanban keeps its own component until Q2-T.
9. The width helper keys widths by `{ type }` or `{ query name }`; `types/columns.ts` re-exports `WIDTH` / `clampWidth`.
10. Perf marks `board-request`, `board-ready`, `board-card-moved`; hook `__TEGG_TEST__.board()` and `perfMarks()`.

## 9. Contract decisions (CP-1…CP-9 → D-1803…D-1811, accepted by the owner 2026-11-19)

Each point was decided as proposed; the alternatives are kept for the record.

| # | Question | Decision | Alternatives (not chosen) |
| --- | --- | --- | --- |
| CP-1 → D-1803 | **The `views:` write command.** The ACs name `type_views_set(type, names)`. `type_patch` already gives the base check, the D-90 create of a missing system file, Newer / invalid refusals and `Conflict` with `disk`. | No new command: `type_patch(key, base, [{ op: 'views', names }])` → `TypeOp::SetViews`; the AC text's `type_views_set` reads as this op. | (b) A thin `type_views_set(key, base, names)` command that calls the same op (two ways to write one line). |
| CP-2 → D-1804 | **How `query_usages` returns the type page** (FR-QRY-06 AC-24: "separately"). `query_usages` returns `QueryUsage[]` today; adding a kind changes its Rust struct and slice Q's tests. | A new read-only `Core::query_view_usages(name)` / IPC `query_view_usages` → `[{ type, path }]`; `query_usages` unchanged. The rename job uses the same function. | (b) `query_usages` returns `{ pages, notes }` (changes slice Q tests). (c) The UI derives it from `TypeDto.views` (no L4 part). |
| CP-3 → D-1805 | **Unresolved relation lanes.** R187 says unknown-value lanes aren't drop targets; a relation value that resolves to nothing isn't named. | Not a drop target and no `+` (like an unknown value): Tegg never writes a link it can't resolve. | (b) A drop target that writes the link text as written. |
| CP-4 → D-1806 | **`sort: []`.** R185 defines a list of levels and broken items, not an empty list. | Valid, zero levels: order by title, then path; the popover shows no level (Clear still writes R138's default). | (b) Broken (`BadValue`, default Modified ↓). |
| CP-5 → D-1807 | **`group_by` with `view: board` when the key is missing, or the query has several types.** R185 says "an attribute key of the query's single type". | Missing → broken (List with `The setting group_by can't be read, so its default is used.`). Several types → valid when every chosen type has the key with the same groupable kind (the R139 filter rule); `tags` valid for any types, also all types. | (b) Missing → group by `defaultGroupBy` of the single type without a notice. (c) Several types → always broken (R185 literally). |
| CP-6 → D-1808 | **How a value matches its lane.** Filters compare folded (D-1445); the Tasks Kanban matches status labels exactly. | NFC-exact, case-sensitive against option labels (`reading` is an unknown-value lane `reading`), so a lane always writes back an exact label; filters (and so exclusion) still fold. | (b) Folded match (case and diacritics), the lane showing the option label. |
| CP-7 → D-1809 | **"One Undo" for New view** (D-1781). R192 has no Undo string, and FR-QRY-07 AC-4 doesn't test it. | ⌘Z while the new tab still has the focus and nothing else changed: `type_patch` back to the old `views:` (base = the returned version), then `query_trash(name)`, as one step; no message. | (b) No Undo for New view in Q2 (D-1781 amended). (c) Undo deletes the query file for good. |
| CP-8 → D-1810 | **Inline (unsaved) query fences.** Sort, column drag and widths are keyed by a saved query; an inline fence has no name and is written as the note. | Inline blocks keep slice Q's behaviour: no sort popover, no ⇧-click, no resize handle, no column drag; a board inline block draws lanes and folds in memory, and card drags still write the object (the object is not the note). | (b) Resize kept in memory per block; sort writes the fence through the editor. |
| CP-9 → D-1811 | **The excluded row's text** `Not in this view: its filter shows only {values}.` | `{values}` = the labels of the non-excluded option lanes in lane order, joined by `Intl.ListFormat(locale, { type: 'conjunction' })` (`Reading and To read`). | (b) The filter's values as written in the query file. |

## 10. AC problems (fixed in the ACs as D-1812, owner 2026-11-19)

1. **R184 TOP order omits `embed`.** The real `TOP_ORDER` is `… preview, hidden, columns, embed, template, attributes`.
   Fixed: R184 reads `… columns, views, embed, template, attributes` (views right after columns; the fixture's line 13
   and FR-QRY-07 AC-4 (b)'s "after line 10" both hold).
2. **FR-QRY-05 AC-23 sets Title to 150 px.** Title's minimum is 160 px (R130, D-1248; type-columns AC-30: "`Resize
   Title` dragged to 100 px stops at 160 px"), so 150 can't be reached. Fixed: 200 px in the AC (and `title = 200`).
3. **Which alert a refused tab add shows.** FR-QRY-07 AC-4 (d) says `views.addFailed` for a refused type-file write
   after New view; FR-SYN-03 AC-30 lists "a tab drag, add or remove" with `views.changedOutside`. Fixed: after a query
   create (New view, Duplicate) the alert is `views.addFailed`; Show a saved query, drags, Move view and Remove show
   `views.changedOutside` (§2.1); AC-30 names "add (Show a saved query)".
4. **R192 lacks texts the ACs need; duplicates existing keys.** Missing: the card name `<Type>: <title>` (FR-QRY-05
   AC-12, FR-UX-08 AC-24) → `board.card` `{type}: {title}`; the tab-move announcement (FR-UX-08 AC-24) → `views.moved`
   `Moved view {name}`; the order combobox's name in the popover → `sort.orderLabel` `Order`; the card-move conflict
   alert (FR-SYN-03 AC-30 "FR-TSK-02 AC-11's alert names the book") → `board.changedOutside` `"{title}" changed outside
   Tegg. Your change wasn't saved.`; the changed-types notice when the query has no types → `views.brokenAllTypes` `This
   view shows all types, not only {thisType}. Edit view to fix it.`. Duplicates: `views.all` is today's
   `typePage.allView` (renamed to `views.all`); the tablist name is the existing `typePage.views`; `Filter by
   tag`, `More actions for "<title>"`, `Open` reuse `tasks.tagFilter`, `task.more`, `pinned.open`. `views.notReady` has no
   criterion: no Q2 write waits for the index except rename (`query.rename.notReady`, D-1510); dropped. NFR-OTH-02
   AC-21's "exactly R192's keys" then reads "R192's keys plus these, minus `views.notReady`".
5. **"L4 for the bytes" of card moves** (FR-QRY-05 AC-13, AC-14, AC-16, FR-FMT-12 AC-12) **and FR-SYN-02 AC-11's card
   drags.** D-82 / ADR 0003: Rust never edits note text; the move's bytes come from `@tegg/doc` (as the Tasks Kanban,
   whose bytes are L1 `packages/doc/test/task_edit.ac.test.ts`). Fixed: the bytes are L1 (`board_move.ac.test.ts`
   against `expected/views/books/`) plus L5 / L6; L4 checks the one write function, the base check and atomicity with
   the expected texts through `Core::note_write`, and the kill harness alternates those two texts.
6. **AC tests changed by the model change but missing from "Existing criteria this slice changes".** `QueryDef` gains
   fields and `sort` becomes a list, so struct literals and `sort: { by, order }` objects in
   `crates/tegg-core/tests/ac_queries.rs`, `ac_queries_props.rs`, `crates/tegg-jobs/tests/ac_queries_jobs.rs`,
   `app/test/queries_model.ac.test.ts`, `app/test/queries_props.ac.test.ts`, `app/webkit/queries_block.ac.test.ts`,
   `app/webkit/queries_live.ac.test.ts` (and `app/test/fake_queries.contract.test.ts`) change mechanically (no behaviour
   change). Fixed: add one row "type-only changes: `sort` is a list, the def gains `group_by`, `lanes`, `lane_order`"
   under D-1802's trailer.
7. **FR-QRY-07 AC-3 omits `Filter Books…` on the board tab.** R186 puts `Filter <plural>…` and `Filter by tag` on every
   view tab's toolbar; AC-3 lists for `Rozečtené` only `Filter by tag`, the lanes radiogroup, the sort button and `View
   actions`. Fixed: add `Filter Books…` to AC-3's board toolbar (as R186).
8. **FR-UX-05 AC-24 names option colour tokens `--c-*`.** The app's option colours are `--type-<colour>` (the Tasks
   Kanban, the type chips); there is no `--c-*` token. Fixed: read `--type-*`.
9. **FR-QRY-07 AC-1 "reads `book.yml` and the three query files".** The page also lists the vault's queries
   (`queries_list`, for the tab icons and the offers) and runs only the selected tab. Fixed: "calls the types store,
   `queries_list` and one `query_run` for the selected tab, and writes nothing" (reads aren't observable otherwise).
10. **FR-QRY-05 AC-12's `Move to` list.** It follows the sentence about Dům u řeky (`To read`): `Move to` › `Reading`,
    `Read` is right for that card, but for Účetní ze Žižkova (`Reading`) it would be `To read`, `Read`. Fixed: name the
    card: "Dům u řeky's `More actions` lists …".
