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

**Part two** (§12…§22, at the end) is slice Q2.1 (D-1835…D-1851; ACs `docs/acceptance/views.md` part two, R194…R200).
Where Q2.1 supersedes a rule of part one, the place is marked **(changed by Q2.1, D-…)** and points to the part-two
section that now holds; the rest of part one stands.

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
folding, resizing, switching tabs and opening menus write no vault file (FR-SYN-06 AC-48). **(changed by Q2.1, D-1836,
D-1835)**: a tab's sort and columns write its `views:` item, a block's its fence in the note, only `query/<name>` writes
the query file's `sort` and `columns`; `Move to trash` from a view menu also writes `views:`; widths and folds are per
usage (`usageColumnWidths`, `usageFolded`). See §12 (what Q2.1 writes) and §16 (R197's routing).

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
  **(changed by Q2.1, D-1840)**: an item may also be a mapping with a non-blank string `name`; `views` keeps the names
  and `Parsed.view_items` the items with their own settings; only a non-string item that isn't such a mapping makes
  `views` unreadable (§14.1).
- `TOP_ORDER` gains `views` right after `columns`: `… preview, hidden, columns, views, embed, template, attributes`
  (R184 as fixed by D-1812, `embed` included). New, starter and built-in type files have no `views` (`serialize` writes it
  only when the definition has one). `CURRENT_VERSION` stays 1.
- `TypeOp::SetViews(Vec<String>)`: writes only the `views` line(s) as one flow list (`render_top`, D-230 quoting via
  `yaml_text::scalar`, NFC), inserted at its TOP place when absent; a hand-written block list is replaced by the one flow
  line; `views: []` when empty (the key stays, D-1782). No-op (no write) when the list equals the file's and the key
  exists. Refused with `RuleError::ViewsUnreadable` when `views_unreadable`, and as every op on a Newer / invalid file.
  A missing system type file is created from its built-in default plus the line (D-90), as `SetColumns`.
  **(changed by Q2.1, D-1840)**: `SetViews` sets the list of **names**; each kept name keeps its item (own settings,
  unknown keys, lines) and the result is written in R196's style (a flow line only while every item is a plain name);
  new ops `SetViewSort`, `SetViewColumns`, `SetViewsSource` (§14.2).
- Every other `TypeOp` leaves the `views` line or block byte-identical, a malformed value included (AR-07 AC-9).
- `pub fn rename_view(text: &str, from: &str, to: &str) -> Option<String>`: the rename job's patch: every list entry
  whose `name_key` equals `from`'s (queries_q `name_key` rule) gets `to` (D-230 quoting) in place, flow or block style
  kept, every other byte kept; None when nothing matches or `views` is unreadable / absent, or the file is Newer or invalid.
  **(changed by Q2.1, D-1843)**: also a mapping item's `name:` value (block `  - name: X` or flow `- { name: X, … }`),
  only that value token; the item's `sort`, `columns`, unknown keys and comments keep their bytes (§14.3).

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
**(changed by Q2.1, D-1835, D-1847)**: `Move to trash` **from a view's menu** first writes the type file's `views:`
without the name, then trashes the query; its Undo restores both (§15). Trashing from the Queries page, from
`query/<name>`, or outside Tegg still never writes a type file (FR-QRY-07 AC-22), and `Restore` never brings a tab back.

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
  `views:` lines (direct rows: `Written { direct: true }`, byte rows in the undo record; no journal, as slice Q's query rename, D-1829), last the
  pins. Undo restores every byte. Report `written` lists the type files.
- **Link patches** (4C `note-rename`, 4E-1 moves): `QueryPatch::ObjectMoved` also rewrites `lane_order` entries that
  are links resolving to `from` (D-1467 text; `|alias` / `#sub` kept; `modified:` untouched), in `patch_job_text`.
- Machine-local keys (D-1797) are moved by the UI, not the job: on the `query-rename` job's report `done` (and on its
  Undo), `app/ui/src/views/uiState.ts` `moveQueryState(from, to)` renames `queryColumnWidths[from]`, `boardFolded[from]`
  and every `typeViews.lastTab[*] == from` to `to`, in one `ui_state_set`. An external rename moves nothing.
  **(changed by Q2.1, D-1845)**: `moveQueryState` moves R198's usage keys of `usageColumnWidths` and `usageFolded` (and
  `typeViews.lastTab`); `queryColumnWidths` and `boardFolded` are no longer read, written or moved (§19.3). The job
  also patches mapping items' `name:` (§14.3).

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
| Rename… / Move to trash / Restore | `query_rename` / `query_trash` / `query_restore` (v1-queries). **(changed by Q2.1, D-1847)**: `Move to trash` from a view menu is `type_patch` then `query_trash` (§15) |
| Sort popover, header click, lanes switch, lane drag, Reset lane order, Columns, header drag | one `query_apply` with only that key changed. **(changed by Q2.1, D-1836)**: sort popover, header click / ⇧-click, Columns and header drag write the usage (tab: `type_patch` `viewSort` / `viewColumns`; block: the fence through `QueryCtl.setSource`; `query/<name>`: `query_apply`), §16; lanes switch, lane drag and Reset lane order stay `query_apply` |
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
  **(changed by Q2.1, D-1838, D-1839)**: a block's sort, Columns, header drag and `On cards` › `Change…` write its own
  fence (`sort:` / `columns:` lines) through `QueryCtl.setSource` (§13). Card drags, the lanes switch, lane drags and
  folds still never write the host note.

## 4. UI

### 4.1 Routes

No new route. `type/<key>` stays the route on every tab (D-1790); a tab switch changes only component state (no route
change, no history entry). A pinned type page opens its remembered tab. `query/<name>` draws a board query as a board (D-1773).

### 4.2 Modules

| Module | Owns |
| --- | --- |
| `app/ui/src/views/model.ts` | Pure, L1. `hasViews(typeKey, type)` (D-1787: defined types except `task` and `tag`); `viewTabs(type, summaries)` → `{ name, key: nameKey, summary }[]` (dedupe by `nameKey`, first place wins, NFC/NFD and case); `viewsAfterDrop(names, name, before: string \| null)`, `viewsAfterMove(names, name, delta)`, `viewsAfterRemove(names, name)` (every copy), `viewsAfterInsert(names, name, after: string \| null)` → `string[] \| null` (null: unchanged); `savedOffers(typeKey, summaries, tabs)` → `{ enabled: QuerySummaryDto[]; greyed: { summary; reason: 'otherType' \| 'severalTypes' \| 'allTypes' \| 'needsNote' \| 'unreadable' }[] }` (D-1763 order and reasons, type reason first); `pageMarks(types, summaries)` → `Map<nameKey, plural[]>` (`nameKey` = the query name NFC and lower-cased, queries_q's `name_key`, D-1818); `newViewDef(type, kind, typesAll)` (D-1783: Table/List `columns` = `effectiveColumns(type)`, Board `groupBy` = `defaultGroupBy(type)`, `lanes: 'vertical'`, `laneOrder: null`, `columns` = `preview` minus the grouping key; `sort [modified desc]`, `limit 50`, `filters []`, `match all`); `defaultGroupBy(type)` (first Select in schema order, else first multi-select, else `tags`); `groupByChoices(type)` → `string[]` of keys (D-1818) (Select, multi-select, relation attributes in schema order, then `tags`; FR-QRY-01 AC-13) |
| `app/ui/src/views/uiState.ts` | `lastTab(typeKey)`, `setLastTab(typeKey, name \| null)` (one `ui_state_set` per switch), `moveQueryState(from, to)` (§1.10). **(changed by Q2.1, D-1845)**: `foldedOf` / `setFolded` take a usage key (§19.3) |
| `app/ui/src/views/TypeViews.tsx` | the tablist, `Add view` menu, view menu, tab drag, the remembered tab, per-tab filter text (D-1796), the panel of the selected view (`ViewPanel`) |
| `app/ui/src/views/ViewPanel.tsx` | a view tab's toolbar and body: `useQueryRun({ kind: 'saved' })`, the state messages (R141 texts), `ViewTable` / `ViewList` / `QueryBoard`, the `brokenTypes` notice |
| `app/ui/src/queries/sort.ts` | Pure, L1 (R188, D-1784): `levels(sort)` (repeats dropped), `headerClick(sort, key, shift)`, `addLevel(sort, choices)` (first unused, asc), `removeLevel(sort, i)` (the last → `[modified desc]`), `moveLevel(sort, from, to)`, `clearSort()` → `[modified desc]`, `sortChoices(type)` → `string[]` of keys (D-1818) (`title`, `created`, `modified`, then attributes in schema order), `orderLabels(key, type)` → `{ asc, desc }` catalog texts per kind (AP-1502), `markers(sort)` → `Map<key, { arrow: '↑' \| '↓'; n: number \| null }>` (n only with ≥ 2 levels), `buttonText(sort, nameOf)` → `{ text: 'Finished ↓'; more: number }`, `sameSort(a, b)` |
| `app/ui/src/queries/SortPopover.tsx` | `dialog` `Sort` (R188), one `query_apply` per change; used by `ViewPanel`, `QueryBlock`, `QueryPage`. **(changed by Q2.1, D-1836, D-1841)**: one write of the usage per change (§16), a scope line, `Use the query's sort` (§19.1) |
| `app/ui/src/queries/board/model.ts` | Pure, L1: `cardMove(group, row, fromLaneId, toLaneId, alt)` → `BoardMove \| null` (D-1769 rules: Select / single relation set; list kinds remove `raw`, add unless the row is already in the target lane; Alt: `remove: []`; onto a non-drop-target or the same lane: null); `laneOrderAfterDrop(group, laneId, beforeId \| null)` → `string[] \| null` (every lane's `value` except `none`, in the new order); `neighbourDropLane(group, laneId, dir: 1 | -1)` (+1 next, −1 previous, D-1817; skips non-drop-targets, excluded lanes included as targets; null at the ends); `prefillFor(def, group, laneId, type)` (§4.5); `excludedValues(group)` (labels of the non-excluded option lanes, for `board.excludedLong`) |
| `app/ui/src/board/Board.tsx` | The generic board (lanes vertical or horizontal, pointer drag of cards and lanes, folds, sideways scroll, lane virtualisation ≤ 150 card elements, the drop label, keyboard focus moves), no data access; extracted so Q2-T reuses it. `tasks/Kanban.tsx` is **not** moved onto it in Q2: the Tasks page's DOM and tests stay as they are (plan §6) |
| `app/ui/src/queries/board/QueryBoard.tsx` | `Board` bound to a `QueryResultDto` with `group`: the universal card (`BoardCard.tsx`), the lanes switch, lane drag → `query_apply({ laneOrder })`, card move → `writeCardMove`, folds (§4.7), `New <Type> in <lane>`; used by `ViewPanel`, `QueryBlock`, `QueryPage` |
| `app/ui/src/queries/board/BoardCard.tsx` | the card (R187, D-1793), generalised from `tasks/TaskCard.tsx` (no checkbox); `CardMenu` items `Open`, `Move to ›`, `Also add to ›` |
| `app/ui/src/queries/board/write.ts` | `writeCardMove(row, move)` (§1.9) |
| `app/ui/src/tables/widths.ts` | The shared width helper (D-1767): `WIDTH`, `clampWidth` move here from `types/columns.ts` (which re-exports them unchanged); `useColumnWidths(scope: { kind: 'type'; key: string } \| { kind: 'query'; name: string })` → `{ widths, set(key, px, save), reset() }` reading and writing `typeColumnWidths[key]` or `queryColumnWidths[name]` (one `ui_state_set` on release, debounced ≤ 1 s after keys); every mounted table of the same scope updates at once. **(changed by Q2.1, D-1845)**: the `query` scope is replaced by `{ kind: 'usage'; key: string }` reading and writing `usageColumnWidths[key]` (§19.3) |
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
| View rows | Table `tr` / List item | each result row of a view tab's Table or List (and of `All <plural>`) carries `data-query-result="<path NFC>"`, as the query block's rows (D-1819) |
| Type page count | text below the header | `typePage.countPlural` `{count} {plural}` with the plural as written (`17 Books`), the same on every tab (D-1816) |
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
  **(changed by Q2.1, D-1843)**: the same `type_patch` also copies the original tab's own `sort` and `columns` (§14.4).
- **Remove** (`views.remove`): `type_patch` without every copy; the previous tab is selected (`All` when none).
- **Move to trash / Restore**: `query_trash` / `query_restore`; the tab stays; its state follows the re-run.
  **(changed by Q2.1, D-1835, D-1847)**: `Move to trash` from the view menu removes the tab (§15); `Restore` (Trash
  view, a block, a trashed tab of a query trashed elsewhere) stays as written here.
- **Rename…**: the `Rename query` dialog of slice Q → `query_rename`; a taken name is refused before the job
  (`query.newQuery.taken`); while the index loads, `query.rename.notReady` (D-1510).
- **Per-tab filter text** (D-1796): a `Map<tabName, { text, tags }>` in `TypeViews`' state; leaving the route clears it.
  The text filter narrows rows by folded title (D-109); the tag filter keeps rows with every chosen tag key; neither
  writes nor changes `query_run`. On a board both narrow cards; lane counts show the narrowed numbers.
- **Header click / ⇧-click** (D-1784): `sort.headerClick(levels, key, shift)`; when the result differs from the file's
  sort (`sameSort`), one `query_apply` with only `sort` changed **(changed by Q2.1, D-1836: from the usage's effective
  sort, one write of the usage, §16)**; ⏎ / Space act as a click, ⇧⏎ as ⇧-click. A press that
  moved > 4 px is a column drag (D-1798, writes `columns` once), never a sort. On `All <plural>` ⇧-click is a plain
  click (machine-local `typeSort`).
- **Sort popover**: each add, remove, reorder, column or order change, and Clear is one `query_apply` **(changed by
  Q2.1, D-1836: one write of the usage, §16)**; Esc closes and writes nothing more. `Add sort level` opens it with a new level appended and its column combobox focused (the level
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
  blocks fold in memory only. **(changed by Q2.1, D-1845)**: `usageFolded[<usage key>]` (§19.3).
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
`views.brokenAllTypes`, and no `views.notReady`. D-1816 adds `typePage.countPlural` `{count} {plural}` (the type page's
header count with the plural as written, `17 Books`; R192). Sort order labels: `sort.order.optionFirst` with
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
selected `QueryBlock`. `typePage.resetWidths` on a view tab resets `queryColumnWidths[name]` **(changed by Q2.1,
D-1845: the usage's `usageColumnWidths[<usage key>]`, §19.3)**.

`UiStateDto` gains (Rust `#[serde(default, skip_serializing_if = "Option::is_none")]`, `version` stays 1):

```ts
typeViews?: { lastTab?: Record<string /* type key */, string | null /* tab name; null = All */> };
queryColumnWidths?: Record<string /* query name (file stem, NFC) */, Record<string /* column key */, number>>;
boardFolded?: Record<string /* query name */, string[] /* lane ids */>;
```

`typeColumnWidths` and `typeSort` stay the `All` tab's. A remembered name not in `views:` opens `All` (and isn't rewritten
until the next switch).

**(changed by Q2.1, D-1845)**: `queryColumnWidths` and `boardFolded` are no longer read or written (they stay in the file
and in `UiStateDto` so a `ui_state_set` keeps them); the per-usage `usageColumnWidths` and `usageFolded` replace them
(§19.3).

### 4.8 Performance marks (D-1800; NFR-PERF-07 AC-3, AC-4)

Through `ipc.perfMark` (as `query-ready`): `board-request` when a board tab is chosen (before its `query_run`),
`board-ready` once when the cards visible in the viewport have painted (two animation frames after the answer is
committed), `board-card-moved` once per drop when the card is in the target lane's DOM (before the write settles). The
`board-card-moved` mark's `ms` is the time from the drop event to the card being in the target lane's DOM (D-1820);
NFR-PERF-07 AC-4 reads it.

## 5. Fake core and test hooks

- `app/ui/test/fake-queries.ts` learns §1.2 (the new keys and both `sort` forms), §1.4 (`ORDER`, styles, comment rules,
  `lane_order` removal, create), §1.6 (multi-key sort, `group` with lanes, cards, `raw`, exclusion, `lane_order`, NFC) and
  `QueryRowDto.version` / `excerpt` / `readOnly`; `queries_list` fills `view`, `types`; new `query_view_usages`. Checked
  against the Rust module on `tests/fixtures/queries-files/` and `expected-views.json` (L3; `app/test/fake_queries.contract.test.ts`).
- The fake core's Q2 behaviour (this section) is built with the slice, not in the red-test commits (D-1815); the red L5
  tests fail on the missing UI before they depend on it.
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
| L3 | `tests/fixtures/queries-files/expected-views.json` (D-1814: a separate file, so slice Q's readers of `expected.json` and its twelve `reads` stay unchanged): `reads` for every `tests/fixtures/vaults/views/.tegg/queries/*.yml` and the trashed one (the §2 `QueryDefDto` with `sort` as a list), `groups`: `[ { "query", "env", "key", "kind", "lanes": [ { "id", "label", "excluded", "dropTarget", "paths" } ] } ]` (R193's boards) and `results` (R193's orders, `cs` and `en-US`); read by `ac_views.rs` and `fake_queries.contract.test.ts` |
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

## 11. Red-test decisions (RT-1…RT-11 → D-1813…D-1823, accepted by the owner 2026-11-19)

| # | Decision |
| --- | --- |
| RT-1 → D-1813 | The Rust L4 / L2 tests that need Q2's new types come in a second red commit, after compile-only stubs of §1.1, §1.3, §1.5, §1.10 and the type-only edits of slice Q's Rust tests (`sort` a list of levels, the new `QueryDef` fields), under D-1802's trailer. |
| RT-2 → D-1814 | The L3 corpus of Q2 is `tests/fixtures/queries-files/expected-views.json`, separate from `expected.json` (§6.1). |
| RT-3 → D-1815 | The fake core's Q2 behaviour (§5) is built with the slice; the red L5 tests fail on the missing UI first. |
| RT-4 → D-1816 | The type page's header count reads `<n> <plural>` with the plural as written (`17 Books`), new key `typePage.countPlural` `{count} {plural}` (R192, §4.3, §4.6). |
| RT-5 → D-1817 | `neighbourDropLane(group, laneId, dir: 1 \| -1)`. |
| RT-6 → D-1818 | `groupByChoices` and `sortChoices` return `string[]` keys; `pageMarks` is keyed by the lower-cased NFC `name_key`. |
| RT-7 → D-1819 | Rows of a view tab's Table and List carry `data-query-result="<path>"` (§4.3). |
| RT-8 → D-1820 | The `board-card-moved` mark's `ms` runs from the drop event to the card in the target lane's DOM (§4.8). |
| RT-9 → D-1821 | FR-QRY-01 AC-8 has no L1 layer (no TS comparator; L4 and L2 cover it). |
| RT-10 → D-1822 | The step order of the expected bytes in `tests/fixtures/queries-files/expected/views/README.md` is approved (sequential steps of FR-QRY-01 AC-9, AC-11, AC-12; FR-QRY-07 AC-12 (c) is `Remove` on `Přečtené 2026`; FR-LNK-03 AC-24 (b)'s runtime `lane_order` follows `group_by:`). |
| RT-11 → D-1823 | FR-FMT-12 AC-12's NFD Select value is a runtime option with diacritics, `Čtu`, added to `book.yml`. |

---

# Part two: slice Q2.1 (D-1835…D-1851)

Public interfaces of slice **Q2.1** (feedback `docs/feedback/q2-v040.md`; released with Q2's fixes as 0.5.0, D-1837),
for the test author (D-61) and the build. ACs: `docs/acceptance/views.md` **part two** (R194…R200; FR-QRY-07
AC-19…AC-26, FR-QRY-01 AC-14…AC-16, FR-QRY-05 AC-24…AC-27, FR-QRY-09 AC-8, FR-FMT-06 AC-7, FR-FMT-07 AC-34, FR-FMT-12
AC-13, AR-07 AC-10, FR-LNK-03 AC-25, FR-SYN-02 AC-12, FR-SYN-03 AC-31, FR-SYN-06 AC-49, FR-STO-07 AC-11, FR-TPL-04 AC-3,
FR-UX-03 AC-52, NFR-OTH-02 AC-22) and the "Existing criteria this slice changes (part two)" table. Decisions D-1835…D-1837
(feedback) and AP-1519…AP-1532 = D-1838…D-1851 (BRD v1.199). Fixture: the overlay `tests/fixtures/vaults/views-usage/`
(README there) on the base `tests/fixtures/vaults/views/`.

**Status: approved, 2026-11-19.** Contract points CP-10…CP-21 accepted by the owner as D-1852…D-1863 (§22.1); the AC
problems of §22.2 fixed in `docs/acceptance/views.md` part two as D-1864.
Part one's rules hold unless a section below changes them; part one marks each superseded place **(changed by Q2.1,
D-…)**.

## 12. What Q2.1 changes

### 12.1 Words

- A **usage** (R194) is a **tab** (one item of a type file's `views:`) or a **block** (one reference fence `saved: <name>`
  in a note, a template included). `query/<name>` is **not** a usage: it shows and sets the **defaults** (D-1842).
  `All <plural>` and inline fences are not usages (D-1762, D-1810, unchanged).
- A usage's **own** `sort` / `columns` are the values stored in its item or fence; its **effective** value is its own
  valid value, else the query file's effective value (R138, R185). An own value replaces the query's whole value.
- **Shared** by every usage (D-1836, D-1849): `title`, `types`, `match`, `filters`, `limit`, `view`, `group_by`,
  `lanes`, `lane_order`.

### 12.2 What Q2.1 writes (replaces part one's "What Q2 writes" for these actions)

| Action | Tab | Block | `query/<name>` |
| --- | --- | --- | --- |
| sort (header click, ⇧-click, keys, popover, `Clear`, `Use the query's sort`) | the type file's `views:` item (`type_patch` `viewSort`) | the note's fence (`QueryCtl.setSource`) | the query file (`query_apply`, as Q2) |
| columns (`Columns`, header drag, `On cards` › `Change…`, `Use the query's columns`) | the item (`type_patch` `viewColumns`) | the fence | the query file |
| `New property…` in `Columns` | the type file (attribute), then the item: two `type_patch` | the type file, then the fence | the type file, then the query file |
| widths, folds | `ui-state.json` `usageColumnWidths`, `usageFolded` (§19.3) | same | same |
| `Move to trash` from a view menu | the type file's `views:`, then `query_trash` (§15) | — | — (as Q2) |
| editor `Done`, lanes switch, lane drag, `Reset lane order` | the query file (shared) | the query file | the query file |

Every write is one minimal write of one file, base-checked (FR-SYN-03), and none when the result equals the disk
(R197). Showing, running, opening menus, resizing and folding write no vault file (FR-SYN-06 AC-49).

## 13. Usage settings in a fence (R195; D-1838, D-1839)

### 13.1 `@tegg/doc` (`packages/doc/src/queryfence.ts`, exported from `index.ts`; D-82: TS owns note text)

```ts
export type UsageSort = { by: string; order: 'asc' | 'desc' };
/** A reference body's own values (R195 with R185's read rules, NFC). `'broken'`: the key is present but its value has
 *  a shape R185 calls broken (a non-list `columns`, a non-mapping `sort` item, an `order` other than asc/desc, …).
 *  `null`: the key is absent. Both null for a non-reference body (inline, empty, unreadable). */
export type FenceUsage = { sort: UsageSort[] | 'broken' | null; columns: string[] | 'broken' | null };
export function fenceUsage(body: string): FenceUsage;

/** `undefined`: leave the key; `null`: remove it (`Use the query's …`); a value: set it. */
export type UsageChange = { sort?: UsageSort[] | null; columns?: string[] | null };
/** The fence's source (opening line through closing line, as `QueryCtl` holds it) with R195's rules applied. null when
 *  the source has no `saved:` line (not a reference) or the result equals the source. */
export function withUsage(fenceSource: string, change: UsageChange): string | null;
/** The same change on a whole note, on the fence whose byte range `queryFences(text)` returned (L1 tests, the
 *  FR-SYN-02 AC-12 harness). null as `withUsage`. Never touches `modified:` (the editor's autosave does, D-55). */
export function applyFenceUsage(text: string, range: [number, number], change: UsageChange): string | null;
```

- **Keys.** `sort` and `columns` are top-level keys of the body: a line whose text after the container prefix (the
  fence's prefix, `fenceLines` rule) starts at column 0 with `sort:` / `columns:`. A key's **range** is its line plus
  the following lines that are indented or start with `- ` (continuation lines), as queries_q's `Layout` ranges
  (v1-queries §1.4). Duplicate keys: the first is read and written (YAML would refuse the body; the core then reads the
  fence as unreadable, R141, and every control is absent).
- **Write style** (R185 / part one §1.4): one level `sort: { by: <by>, order: <asc|desc> }`; two or more: `sort:` then
  one line `  - { by: <by>, order: <order> }` per level; zero levels `sort: []` (D-1806); `columns: [a, b]` one flow
  line. Values with `formatScalar` (D-230) in flow context; NFC. A changed one-line key keeps its trailing comment as
  §1.4 does (D-1457).
- **Place** (D-1838): a present key is replaced in its range; a missing `sort` is inserted right after the `saved:` line;
  a missing `columns` right after the `sort` range when `sort` is present, else right after `saved:`. Removal removes the
  key's range. New lines get the `saved:` line's prefix (`> `, list indentation) and the fence's EOL (CRLF kept).
- **Kept**: the markers (```` ``` ```` / `~~~` and their length), the info string (`query meta`), the `saved:` line (an
  NFD value too), comments, unknown keys (`x-poznámka`), `view:`/`filters:` lines, every byte outside the changed range.
- `fenceUsage` follows R194's read rules for shapes only; whether a `by` or a column key exists is the core's run-time
  check (§17.2).

### 13.2 Rust reader (`tegg-format`, AR-03)

```rust
// crates/tegg-format/src/usage.rs (new, `pub mod usage`, re-exported): R185's shape rules for a usage's own values,
// shared by the fence reader and tegg-schema's `views:` items (§14.1).
pub enum UsageOrder { Asc, Desc }
pub struct UsageSort { pub by: String, pub order: UsageOrder }          // `by` NFC, trimmed
pub enum UsageValue<T> { Absent, Set(T), Broken }
pub struct UsageRaw { pub sort: UsageValue<Vec<UsageSort>>, pub columns: UsageValue<Vec<String>> }
/// `sort` / `columns` of a YAML mapping (a fence body or a `views:` item); other keys ignored.
pub fn usage_of(map: &yaml_rust2::yaml::Hash) -> UsageRaw;

// crates/tegg-format/src/query_fence.rs
/// A reference body's own values (R195); `Absent`/`Absent` for inline, empty and unreadable bodies.
pub fn fence_usage(body: &str) -> UsageRaw;
```

- `QueryFence` and `query_fences` are **unchanged** (no new field: the L3 twin `expected.json` `fences` stays as is);
  callers that need the values call `fence_usage(&fence.body)`.
- The usage index is unchanged: `Stored.queries` keeps the `saved` names only (AR-01: settings are read from the note
  when a block runs, never indexed). `query_usages` / `Used on` are unchanged.
- `queries_q::read_fence` and `FenceRead` are unchanged (`FenceRead::Reference { name }`, slice Q's test at
  `ac_queries.rs` stands); the run reads the own values with `fence_usage` (§17.2).

### 13.3 The editor write (D-1839)

- A block's sort or columns change is `ctl.setSource(withUsage(fenceSource, change))` (v1-queries §3.2 `QueryCtl`):
  one transaction, one undo step, one autosave (FR-EDT-08) whose `modified:` follows D-55; `withUsage` returning null
  writes nothing. Top-level (`rawBlock`) and nested (`codeBlock` `query`) fences alike.
- **⌘Z / ⇧⌘Z** (FR-QRY-01 AC-14 (b)): the query node views (`rawBlock` `query`, `codeBlock` `query`) let ⌘Z and ⇧⌘Z
  reach the editor's history (`stopEvent` false for them), so ⌘Z with the focus in the block's header undoes the last
  block write (CP-20, D-1862). `packages/editor` changes only there.
- **No editor** (D-1839): a `QueryBlock` without `ctl` (the read view `ReadView.tsx`, a note in the Trash view, a block
  inside an embedded note) is a usage that **can't be written**: its sort button, header click / ⇧-click / keys, header
  drag, `Columns` and `On cards` › `Change…` are `aria-disabled` with `query.block.usageNotEditable`; resizing and
  folding work (machine-local). `Choose a query…` / `Save as query…` stay absent there (v1-queries §3.3).
- A draft block (`ctl.draft`) and an inline fence have no usage (D-1810, unchanged).

## 14. Usage settings in `views:` (R196; D-1840, D-1843; AR-07 AC-10)

### 14.1 Reading (`tegg-schema`)

```rust
// crates/tegg-schema/src/lib.rs
pub use tegg_format::usage::{UsageOrder, UsageSort, UsageValue};
/// One item of `views:` (R196): a plain name, or a mapping with a non-blank string `name`.
pub struct ViewItem {
    pub name: String,                           // NFC, trimmed
    pub sort: UsageValue<Vec<UsageSort>>,       // the item's own `sort` (Absent for a plain name)
    pub columns: UsageValue<Vec<String>>,       // the item's own `columns`, keys NFC as written
    pub plain: bool,                            // a string item, or a mapping with only `name`
}
pub struct Parsed { /* … */ pub view_items: Option<Vec<ViewItem>> }   // same order and length as `def.views`, repeats kept
```

- `TypeFile.views: Option<Vec<String>>` stays (the **names**, so slice Q2's tests and `TypeDto.views` stand, CP-13, D-1855).
  `Parsed.view_items` holds the items; `TypeInfo` (`tegg-core` `types3d.rs`) gains `view_items: Option<Vec<ViewItem>>`
  and `views_source: Option<String>` (the exact text of the `views` key's lines, key line through its last line with
  EOLs; None when absent; CP-10, D-1852).
- An item is a string, or a mapping (block or flow style) with a non-blank string `name`; its `sort` / `columns` read by
  `usage_of`; other keys are kept in the file and ignored. Any other item (a mapping without a string `name`, a number,
  a list) makes the whole `views` unreadable: `views: None`, `view_items: None`, `views_unreadable: true` (AC-25 (a)).
  A file with mapping items and `version: 1` is `Ok`, never `Newer`; `CURRENT_VERSION` stays 1 (AR-07 AC-10).
- Repeats (any case, NFD): every item is kept in `view_items`; the UI and the run use the **first** (R196).

### 14.2 Writing: ops

```rust
pub enum TypeOp {
    // …
    /// (changed by Q2.1) The list of names; each kept name keeps its first item (own values, unknown keys, lines).
    SetViews(Vec<String>),
    /// Q2.1: the first item named `name` (name key) gets `sort` as its own value; None removes its own `sort`.
    SetViewSort { name: String, sort: Option<Vec<UsageSort>> },
    /// Q2.1: the same for `columns`.
    SetViewColumns { name: String, columns: Option<Vec<String>> },
    /// Q2.1 (CP-10, D-1852): the `views` key's lines replaced by `source` byte for byte (the Undo of a trash, the revert of a
    /// failed one). Refused with `RuleError::ViewsUnreadable` when the result's `views` can't be read.
    SetViewsSource(String),
}
pub enum RuleError { /* … */ ViewNotListed }   // SetViewSort / SetViewColumns on a name not in `views`
```

Rules of every views op (R196):

- **Plain vs block.** After the change, when every item is plain the key is written as R184's one flow line
  (`views: [Rozečtené, Přečtené 2026]`); otherwise as a block list: `views:` then per item `  - <name>` (plain) or
  `  - name: <name>`, `    sort: …` (one level) or `    sort:` + `      - { by: …, order: … }` lines, `    columns: […]`,
  in that order, then the item's unknown-key lines as written. Names, `by` values and column keys NFC, D-230 quoting
  (`  - name: "Čtu, až bude čas"`).
- **Minimal rewrite.** The key's range is replaced. In a block list, an item whose value (name, own values, unknown keys)
  didn't change keeps its own lines byte for byte (comments inside it included); a changed item is re-emitted (its
  unknown-key lines kept after the known ones, its inside comments dropped); full-line comments between items go
  (D-1840). A flow-style `views` that holds a mapping item is re-emitted in block style on any write.
- **No-op**: the same items and style → no write (the key exists).
- `SetViews(names)`: a kept name takes the **first** existing item with its name key (later repeats go); a new name is a
  plain item. Remove (every copy), drags, Move view, Show a saved query, New view and trash all use it; removing the
  last item with own settings turns the list back into the flow line (AC-20 overlay, AC-26 (c)).
- `SetViewSort` / `SetViewColumns`: change the first matching item only; an item left with only `name` becomes plain
  (R197). The schema doesn't compare with the query (an own value equal to the query's is written, D-1841).
- Refusals as part one (`ViewsUnreadable`, Newer, invalid, base `Conflict`); D-90 create of a missing system file as
  `SetViews`. Every other `TypeOp` leaves the `views` range byte-identical (AR-07 AC-10, FR-FMT-07 AC-34).
- Several views ops in one `type_patch` are applied in order and written once (Duplicate, §14.4).

### 14.3 The query rename (D-1843; FR-LNK-03 AC-25)

`tegg_schema::rename_view(text, from, to)` patches, in every item whose name key equals `from`'s: a plain entry's token
(as Q2), a block mapping's `name:` value token, a flow mapping's `name:` value token; nothing else (own values,
unknown keys, comments, style kept). `tegg-jobs` `query-rename` is otherwise unchanged (part one §1.10: base check,
direct rows, Undo, no journal, D-1829); `@tegg/doc` `renameSavedQueryPatches` already patches only `saved:` lines, so
a fence's `sort:` / `columns:` lines keep their bytes. The UI moves R198's keys after `done` and after its Undo (§19.3).

### 14.4 Duplicate, Remove, Show a saved query (D-1843)

- **Duplicate** on a tab: `query_duplicate(name)` → the copy's name; then one `type_patch(key, version, [views(names
  with the copy right after the original), viewSort(copy, own) if the original has an own sort, viewColumns(copy, own)
  if it has own columns])`: one write; widths aren't copied; unknown item keys aren't copied (CP-21, D-1863). On the overlay the
  copy's lines equal lines 15…19 with the new name (AC-26 (b)).
- **Remove**: `views` without every copy (the items and their settings go). **Show a saved query**: a plain name.

## 15. Move to trash from a view menu (D-1835, D-1847; FR-QRY-07 AC-20…AC-22)

No new IPC: `type_patch` (with `views` and, for the revert and Undo, `viewsSource`), `query_trash`, `query_restore`.
UI: `app/ui/src/views/trashView.ts` `trashView(type: TypeDto, name: string, title: string): Promise<void>`, called by
the view menu's `views.trash` (chevron, right-click, ⇧F10, toolbar `⋯`). Trashing from the Queries page,
`query/<name>`'s `⋯`, the Trash view or outside Tegg keeps v1-queries' path and never writes a type file (AC-22).

1. **Enabled** only when the type file can be written (`state === 'ok'`, not `viewsUnreadable`, `version` known or
   `exists: false`); else `aria-disabled` with the reason `Remove` has (FR-QRY-07 AC-12 (e)); no call.
2. `before = type.viewsSource`; `t1 = type_patch(type.key, type.version, [{ op: 'views', names:
   viewsAfterRemove(type.views, name) }])`. `Conflict` / version mismatch: nothing trashed, the types store reloads,
   alert `views.changedOutside` (AC-21 (c)). Another error: alert `query.saveFailed`, nothing trashed.
3. `query_trash(name)`. On any error: `type_patch(type.key, t1.version, [{ op: 'viewsSource', source: before }])` (the
   type file back to its exact bytes, AC-21 (d)), the tab back and selected, alert `views.trashFailed`; if that revert is
   refused, alert `views.changedOutside` instead (the tab stays gone).
4. Success: the previous tab is selected (`setLastTab`; `All` when none), the toast `queries.trashed` with `Undo` (8 s,
   `trash/toast.tsx` `showToast`), the live region `queries.trashed`. ⌘Z while the toast shows and the focus is on the
   page (not in a text field) is the same Undo.
5. **Undo**: `query_restore(name)`; then `type_patch(type.key, t1.version, [{ op: 'viewsSource', source: before }])`;
   the tab back at its place and selected. Restore failing: alert `trash.removeFailed` (count 1), `views:` untouched.
   The type patch refused (`book.yml` changed since, AC-21 (e)): the query stays restored, alert `views.changedOutside`.
   Writes: one move, one type-file write.
6. Only this type page's entry goes; other type files listing the query keep a trashed tab (D-1835, AC-22).

## 16. What each action writes (R197; D-1841, D-1842, D-1844)

### 16.1 The usage writer

```ts
// app/ui/src/views/usage.ts (pure, L1) – see §18 for the rest of the module
export type Usage =
  | { kind: 'tab'; typeKey: string; name: string }
  | { kind: 'block'; note: { id: string | null; path: string }; name: string; n: number; editable: boolean }
  | { kind: 'page'; name: string };

// app/ui/src/views/useUsageWrite.ts
export type UsageWriter = {
  /** null: `Use the query's sort` (tab, block only). Resolves true when written or nothing to write. */
  sort(next: SortDto[] | null): Promise<boolean>;
  columns(next: string[] | null): Promise<boolean>;
  /** Why the usage can't be written (a catalog text), else null. */
  disabled: string | null;
};
export function useUsageWrite(usage: Usage | null, result: QueryResultDto | null, o: {
  type: TypeDto | null;              // tab: the page's type (base, items)
  ctl: BlockCtl | null;              // block: the editor's QueryCtl; null = no editor
  fenceSource: string | null;        // block: the fence's source as the editor holds it
  rerun(): void;
}): UsageWriter;
```

| Usage | `sort` / `columns` call | Refusals |
| --- | --- | --- |
| tab | `type_patch(typeKey, type.version, [{ op: 'viewSort', name, sort }])` / `viewColumns` | `Conflict`, `Rule(viewNotListed)`: types store reloads, alert `views.changedOutside` (FR-SYN-03 AC-31); `Io`: `query.saveFailed` |
| block | `ctl.setSource(withUsage(fenceSource, { sort }))` | external change: the editor's rule (FR-SYN-03 AC-31) |
| page | Q2's `useQueryApply` (`query_apply` with only `sort` / `columns` changed) | v1-queries §2.1 |

- **From the effective value** (R194 "First change"): every header click, ⇧-click, popover change and Columns change
  is computed by part one's pure helpers (`sort.headerClick`, `addLevel`, …, `columnsAfterDrop`) from the usage's
  **effective** value (`usage.sort` / `usage.columns` of the run, §17.2), and the **whole** result is written as the
  usage's own value; no write when it equals the effective value and the usage already has that own value.
- **`Clear`** writes `[modified desc]` as an own value (D-1841). **`Use the query's sort` / `columns`** call
  `sort(null)` / `columns(null)`; offered when the usage has the key (valid or broken, CP-14, D-1856), never on the page.
- **`New property…`** (R197): `type_patch` adding the attribute (FR-TYP-03), then the usage write with the new key
  appended to the effective columns; on a tab the second `type_patch` uses the version the first returned.
- **Disabled** (`disabled` non-null, every sort and column control `aria-disabled` with it, R194): a block without an
  editor → `query.block.usageNotEditable`; a query `version` > 1 → `query.block.readOnly` (own values still apply); a
  tab whose type file can't be written (Newer, invalid) → the reason `Remove` has (R194 as fixed by D-1864). An unreadable
  query has no controls (R141).
- **`On cards` › `Change…`** (D-1844): the editor's `On cards` row shows the opener's **effective** `columns`;
  `Change…` (the R130 Columns menu) calls the opener's `UsageWriter.columns` at once, on a tab, in a block and on the
  page (CP-18, D-1860).
- **The editor** opened from any usage (`Edit view`, `Edit query`) commits the shared keys to the query file; its
  commit's `sort` and `columns` are always the **query file's** (`result.def`), never the usage's, so `patch` writes
  neither (D-1842). Its preview run (`query_run({ kind: 'def' })`) substitutes the opener's effective `sort` and
  `columns` (CP-17, D-1859). Under the usage notice, `p` `query.editor.perUsage` when the query has ≥ 2 usages (type pages
  from `query_view_usages` plus notes from `query_usages`, templates included; FR-QRY-01 AC-15).
- Card drags, lanes switch, lane drags, `Reset lane order`, `New <Type> in <lane>`: unchanged (part one).

### 16.2 Scope lines (R197, R199)

The sort popover's first line and the Columns menu's first line name what a change writes: `sort.scope.tab` /
`sort.scope.block` / `sort.scope.default` and `columns.scope.tab` / `columns.scope.block` / `columns.scope.default`
(tab, block, `query/<name>`). `All <plural>` has neither (no popover; its Columns menu is unchanged).

## 17. Core and IPC

### 17.1 Types (`tegg-core::queries_q`)

```rust
pub enum QuerySource {
    Saved(String),                                   // query/<name>: no usage (the defaults)
    /// (changed by Q2.1) A reference body's own `sort:` / `columns:` apply: a block usage.
    Fence(String),
    Def { def: QueryDef, name: Option<String> },     // unchanged (the editor's preview; no usage)
    /// Q2.1 (CP-11, D-1853): a view tab: the first `views:` item named `name` (name key) of type `type_key`.
    View { type_key: String, name: String },
}
pub enum UsageKind { Tab, Block }
/// A usage's own values as read (R194): None = absent, or present with a broken shape (then in `UsageRun.broken`).
pub struct UsageSettings { pub sort: Option<Vec<Sort>>, pub columns: Option<Vec<String>> }
pub struct UsageRun {
    pub kind: UsageKind,
    pub own: UsageSettings,
    /// `Broken { reason: BadValue, key: "sort" | "columns" }` for an own value R185 calls broken (shape or run-time:
    /// a `by` not valid for the query's types). At most one per key.
    pub broken: Vec<Broken>,
    /// Effective (R194): the own valid value, else the query file's effective value.
    pub sort: Vec<Sort>,
    pub columns: Vec<String>,
}
pub struct QueryResult { /* … */ pub usage: Option<UsageRun> }
```

### 17.2 The run

- `View { type_key, name }`: the query is resolved as `Saved(name)`; the own values come from
  `TypeInfo.view_items` of `type_key` (first item by name key; none → no own values). `Fence(body)` with a reference:
  `fence_usage(body)`. `Saved`, `Def`, inline, empty and unreadable fences: `usage: None`.
- `usage` is Some whenever the query has a `def` (`Ok` or `Newer`); None for missing, trashed and unreadable queries.
- A `UsageValue::Broken` value, or a `sort` level whose `by` isn't valid for the query's types (part one §1.6 checks),
  gives a `broken` entry and the query's effective value. An own `columns` keeps unknown keys (the UI shows only real
  columns, as R138); `sort: []` is valid (D-1806).
- `rows` are ordered by `usage.sort` (when Some) and `group` cards inside lanes follow that order; `limit` and grouping
  stay the query's. `result.def` stays the **query file's** def, unchanged (CP-12, D-1854): the editor, the page and every
  query-file writer read it; rendering reads `usage` first (`effectiveSort` / `effectiveColumns`, §18).
- Nothing in the run writes; one index lock as part one.

### 17.3 IPC and DTOs

| Command | Change |
| --- | --- |
| `query_run` | `QuerySourceDto` gains `{ kind: 'view'; type: string; name: string }`; result gains `usage: UsageRunDto \| null` |
| `type_patch` | ops `{ op: 'viewSort'; name; sort: SortDto[] \| null }`, `{ op: 'viewColumns'; name; columns: string[] \| null }`, `{ op: 'viewsSource'; source: string }`; refusal reason `viewNotListed` (`Rule`) |
| `type_get`, types list | `TypeDto` gains `viewItems: ViewItemDto[] \| null`, `viewsSource: string \| null`; `views` stays the names |
| `ui_state_get` / `_set` | `UiStateDto` gains `usageColumnWidths`, `usageFolded` (§19.3) |
| `query_trash`, `query_restore`, `query_rename`, `query_apply`, `query_view_usages`, `query_usages` | unchanged |

```ts
type QuerySourceDto = /* Q, Q2 */ | { kind: 'view'; type: string; name: string };
type UsageRunDto = {
  kind: 'tab' | 'block';
  own: { sort: SortDto[] | null; columns: string[] | null };
  broken: BrokenDto[];               // key 'sort' | 'columns', reason 'badValue'
  sort: SortDto[];                   // effective
  columns: string[];                 // effective (unknown keys kept)
};
type QueryResultDto = { /* Q, Q2 */ usage: UsageRunDto | null };
type ViewItemDto = { name: string; sort: SortDto[] | null; sortBroken: boolean; columns: string[] | null; columnsBroken: boolean; plain: boolean };
// TypeDto: viewItems: ViewItemDto[] | null; viewsSource: string | null.
// TypeOpDto: | { op: 'viewSort'; name: string; sort: SortDto[] | null } | { op: 'viewColumns'; name: string; columns: string[] | null } | { op: 'viewsSource'; source: string }
```

Rust: `app/src-tauri/src/shellq.rs` (`QuerySourceDto::View`, `UsageRunDto`, `result_dto`), `dto.rs` (`TypeDto`,
`TypeOpDto::{ViewSort, ViewColumns, ViewsSource}`, `ViewItemDto`, `UiStateDto`), `lib.rs` `type_op`; TS
`app/ui/src/ipc/queries.ts`, `ipc/types.ts` (ts-rs bindings regenerated).

### 17.4 Live updates (FR-QRY-09 AC-8)

No new event. A tab's `query_run({ kind: 'view' })` re-runs on `.tegg/types/` paths (part one §2.3) and on its query
file; a block re-runs when its fence source changes (`mountQueryBlock`'s `update`, a new body) and on its query file;
an external note change while open follows the editor's reload rule, then the block's new body runs.

## 18. UI modules

| Module | Owns |
| --- | --- |
| `app/ui/src/views/usage.ts` (new, pure, L1) | `Usage` (§16.1); `usageKey(u)` (R198, §19.3); `parseUsageKey(key)` → `{ kind; name key; … } \| null`; `blockOrdinal(names: (string \| null)[], index)` (1-based among fences with the same name key, document order, nested included; `null` = inline / draft); `effectiveSort(result)`, `effectiveColumns(result)` (`usage` first, else `def`); `ownOf(result)`; `scopeOf(u)` → `'tab' \| 'block' \| 'default'`; `canUseQuery(result, key)` (CP-14, D-1856); `movedUsageState(ui, from, to)` (R198 rename, pure) |
| `app/ui/src/views/useUsageWrite.ts` (new) | §16.1 |
| `app/ui/src/views/trashView.ts` (new) | §15 |
| `app/ui/src/views/model.ts` | `viewTabs` gains `item: ViewItemDto \| null` per tab (the first item) |
| `app/ui/src/views/uiState.ts` | `foldedOf(usageKey)`, `setFolded(usageKey, ids)` (`usageFolded`); `moveQueryState(from, to)` moves R198's keys and `typeViews.lastTab` (§19.3); `queryColumnWidths` / `boardFolded` untouched |
| `app/ui/src/tables/widths.ts` | `WidthScope = { kind: 'type'; key } \| { kind: 'usage'; key: string }` (`usageColumnWidths[key]`); the `query` scope goes |
| `app/ui/src/views/ViewPanel.tsx` | `useQueryRun({ kind: 'view', type, name })`; `Usage` tab; `useUsageWrite`; the usage's broken notices; widths and folds by its usage key; `trashView` from the toolbar `⋯` |
| `app/ui/src/views/TypeViews.tsx` | the view menu's `views.trash` → `trashView`; Duplicate per §14.4; the menus through §20's placement |
| `app/ui/src/queries/QueryBlock.tsx` | `usage?: Usage \| null` prop (block from the mount and `ReadView`, page from `QueryPage`); rendering from `effectiveSort` / `effectiveColumns`; writes through `useUsageWrite`; the usage's broken notices |
| `app/ui/src/queries/mount.tsx` | `QueryMountHost` gains `note(): { id: string \| null; path: string }` and `ordinal(pos: number): number` (from `EditorHandle.queryBlocks()` and `savedName`, CP-16, D-1858); `refreshQueryBlocks()` also runs after a doc change that adds, removes or moves a query block |
| `app/ui/src/read/ReadView.tsx` | passes `usage: { kind: 'block', …, editable: false }` with the ordinal from its render walk (embeds: the embedded note's key) |
| `app/ui/src/queries/QueryPage.tsx` | `usage: { kind: 'page', name }` |
| `app/ui/src/queries/SortPopover.tsx` | `scope: 'tab' \| 'block' \| 'default'`, `onUseQuery?: () => void` (the button, when offered) |
| `app/ui/src/queries/ResultsTable.tsx` | `columns` from the effective value; `onColumns` / `onSort` go to the writer; the Columns menu's scope line and `Use the query's columns` |
| `app/ui/src/queries/board/QueryBoard.tsx`, `BoardCard.tsx` | pills from the effective `columns` (On cards per usage, D-1844); folds by usage key; the card menu and `Move to` submenu through §20 |
| `app/ui/src/queries/QueryEditor.tsx` | `usage?: { usage: Usage; writer: UsageWriter; result: QueryResultDto }`; `On cards` from the effective columns, `Change…` through `writer.columns`; commit keeps the file's `sort` / `columns`; preview substitution (CP-17, D-1859); `query.editor.perUsage` |
| `app/ui/src/shell/placement.ts`, `usePopupPlacement.ts` (new) | §20 |
| `app/ui/src/shell/Menu.tsx` | `PopupMenu` gains `fit?: boolean` (§20); also a `submenu` opener kind |
| `packages/editor` | §13.3 only (⌘Z / ⇧⌘Z through the query node views) |

## 19. DOM, strings, UI state, commands

### 19.1 DOM (additions to §4.3)

| Part | Element | Name and attributes |
| --- | --- | --- |
| Usage root | the tab's `div[role=tabpanel]`, the block's root, the page's block root | `data-usage-key="<R198 key>"`, `data-usage-kind="tab\|block\|page"`; `data-own-sort` / `data-own-columns` present when the usage has the key (`="broken"` when broken, else `""`) |
| Usage notice | `p.query-notice[data-usage-broken="sort\|columns"]` | `query.block.brokenKey` (`The setting sort can't be read, so its default is used.`), above the results, one per broken key |
| Sort popover | `div[role=dialog]` | first child `p.sort-scope[data-scope="tab\|block\|default"]` (`sort.scope.*`), `aria-describedby` it; after `sort.clear`, when offered, `button` `sort.useQuery` `data-command="sort.useQuery"` |
| Columns menu | `[role=menu]` | first child `div.menu-scope[role=presentation][data-scope]` (`columns.scope.*`), `aria-describedby` it; when offered, last a separator and `menuitem` `columns.useQuery` `data-command="columns.useQuery"` |
| Disabled usage controls | sort button, header cells, `Columns`, `On cards` `Change…` | `aria-disabled="true"`, `aria-description` = `UsageWriter.disabled`; header cells lose `draggable`; clicks and keys do nothing; resize separators stay |
| Editor | `p[data-per-usage]` | `query.editor.perUsage`, right after the usage notice (`query.editor.usedOnPage` / slice Q's notice) |
| Trash failure | the app alert | `views.trashFailed` |
| Popups | every §20 popup | `data-popup="<id>"`, `data-placement="below-start\|below-end\|above-start\|above-end\|right\|left"`, `data-popup-scroll` when its height is limited |

### 19.2 Strings (R199; NFR-OTH-02 AC-22)

R199's keys with R199's texts in `app/ui/src/i18n/catalog.ts`: `sort.scope.tab`, `sort.scope.block`,
`sort.scope.default`, `sort.useQuery`, `columns.scope.tab`, `columns.scope.block`, `columns.scope.default`,
`columns.useQuery`, `query.block.usageNotEditable`, `query.editor.perUsage`, `views.trashFailed` (`{name}`),
`cmd.useQuerySort`, `cmd.useQueryColumns`. Reused: `queries.trashed`, `views.changedOutside`, `query.block.brokenKey`,
`query.block.readOnly`, `query.saveFailed`, `trash.removeFailed`. No key is removed.

### 19.3 UI state (R198; D-1845; FR-STO-07 AC-11)

`UiStateDto` gains (Rust `#[serde(default, skip_serializing_if = "Option::is_none")]`, `version` stays 1):

```ts
usageColumnWidths?: Record<string /* usage key */, Record<string /* column key */, number>>;
usageFolded?: Record<string /* usage key */, string[] /* lane ids */>;
```

- **Usage keys** (`usageKey`, all parts NFC; the name key is part one's `nameKey`, NFC trimmed lower case):
  `tab:<type key>/<name key>`; `block:<note key>/<name key>#<n>` with note key `id:<frontmatter id>` or
  `path:<vault path>`; `page:<name key>`. `parseUsageKey` reads a block key's name key between the last `/` and the
  final `#<digits>`.
- Widths: one `ui_state_set` on release (keys: debounced, as part one); `Reset column widths` deletes only that key.
  Folds: one `ui_state_set` per toggle; an empty list deletes the key.
- `queryColumnWidths` and `boardFolded` stay in `UiStateDto` and in the file untouched; nothing reads them (AC-11).
- **Rename** (`moveQueryState(from, to)`, after the job's `done` and after its Undo): every usage key whose name key is
  `from`'s gets `to`'s name key (other parts kept), in `usageColumnWidths` and `usageFolded`, plus `typeViews.lastTab`;
  one `ui_state_set`. External renames, a note without `id` renamed, and moved blocks leave keys as they are (R198).

### 19.4 Commands (R199; FR-UX-03 AC-52)

| Id | Title key | Listed when |
| --- | --- | --- |
| `sort.useQuery` | `cmd.useQuerySort` | a view tab, or a selected saved-query block, whose usage has the `sort` key (CP-14, D-1856) and can be written |
| `columns.useQuery` | `cmd.useQueryColumns` | likewise for `columns` |

Section `view`, `needsVault: true`, no shortcut. `ViewsStatus` (part one §4.7) gains `usage: { kind: 'tab' | 'block';
ownSort: boolean; ownColumns: boolean } | null` (null on `query/<name>`, `All <plural>`, inline blocks); `views.run(id)`
runs them. `sort.addLevel` and the other part-one commands now act on the usage.

## 20. Popups stay in the window (D-1848; FR-QRY-07 AC-19)

```ts
// app/ui/src/shell/placement.ts (pure, L1)
export const POPUP_MARGIN = 8;                           // as previews R104
export type Box = { left: number; top: number; right: number; bottom: number };
export type Placed = { left: number; top: number; maxHeight: number | null; placement: 'below-start' | 'below-end' | 'above-start' | 'above-end' | 'right' | 'left' };
export function placePopup(o: {
  opener: Box | { x: number; y: number };                // an element's rect, or the pointer (context menu)
  size: { width: number; height: number };               // the popup's natural size
  viewport: { width: number; height: number };
  kind: 'menu' | 'context' | 'submenu';
  gap?: number;                                          // 4 px (as PopupMenu)
}): Placed;
// app/ui/src/shell/usePopupPlacement.ts
export function usePopupPlacement(ref: RefObject<HTMLElement>, opener: Box | { x: number; y: number } | HTMLElement | null, kind: 'menu' | 'context' | 'submenu'): CSSProperties;
```

- **Rule** (AC-19): below the opener, left-aligned; if its right edge would pass `width − 8`, right-aligned with the
  opener's right edge; then clamped to the 8 px margins. If it doesn't fit below, above; if neither, the side with more
  room with `maxHeight` = that room and scrolling inside. `context`: the same from the pointer. `submenu`: right of its
  item, else left, top aligned with the item, then clamped.
- Placed popups render in a portal on `document.body` with `position: fixed` (no ancestor clips them, `div.board-scroll`
  included). They are placed in a layout effect before paint, again when their size changes (`ResizeObserver`) and
  after a window `resize` (next animation frame), so none stays outside once a resize ends.
- **Users** (D-1848, CP-19, D-1861): `PopupMenu` with `fit` (the tab menu, the toolbar `⋯` `views.menu`, `Add view`, the
  Columns menu of tabs, blocks and the page, the block's `⋯` `QueryMenu`, the card menu and its `Move to` / `Also add
  to` submenus), `SortPopover`, and `QueryEditor` when anchored (from a tab, a block, the page). Other menus of the app
  keep their placement.
- `data-popup` ids: `views.tabMenu`, `views.menu`, `views.addMenu`, `columns`, `sort`, `query.menu`, `card.menu`,
  `card.moveTo`, `card.alsoAdd`, `query.editor`.

## 21. Fake core, test hooks, tests and expected bytes

### 21.1 Fake core and hooks

- `app/ui/test/fake-queries.ts`: `query_run` `{ kind: 'view' }` (the fake's type file items) and reference fences' own
  values (`fenceUsage` from `@tegg/doc`), `usage` per §17.2 (effective order, broken entries). Checked against Rust on
  `expected-views-usage.json` (L3, `app/test/fake_views_usage.contract.test.ts`).
- `app/ui/test/fake-schema.ts`: `viewItems`, `viewsSource`, the ops `viewSort`, `viewColumns`, `viewsSource` and the
  new `SetViews` rules (§14.2), mapping items valid, `viewNotListed`.
- The fake `query-rename` job patches mapping items' `name:` (§14.3).
- `ui_state_set` stores `usageColumnWidths`, `usageFolded`, keeps `queryColumnWidths`, `boardFolded`.
- Existing hooks cover the trash failure (`queriesFail('query_trash', 'Io')`), the conflicts (`setFile(…, { silent:
  true })`), the order of calls (`calls()`), writes (`writes()`, `writesTo()`), moves (`moves()`), runs (`queryRuns()`).
  New: `typeCalls(): Promise<{ key: string; base: VersionDto | null; ops: TypeOpDto[]; ok: boolean }[]>` (the
  `type_patch` calls in order).
- `window.__TEGG_TEST__.usages()` (L5, L6 with `TEGG_TEST=1`): `{ key: string; kind: 'tab' | 'block' | 'page'; name:
  string; ownSort: boolean | 'broken'; ownColumns: boolean | 'broken'; editable: boolean }[]` of every mounted usage,
  document order.
- L6 window sizes: `osa` System Events `set size of window 1` (as `app/e2e/ms3_shell.ac.test.ts`); 800 × 500 is the
  native minimum (D-136).
- The FR-SYN-02 AC-12 kill harness (L4): alternating `Core::type_patch(…, [TypeOp::SetViewSort { name: "Přečtené 2026",
  sort }])` between the overlay item's two levels and one level, and alternating `Core::note_write` of Cesty's two
  texts (`expected/views-usage/notes/knihy-na-cesty-b1-click-author.md` and the overlay's file).

### 21.2 Files

| Layer | Files |
| --- | --- |
| L0 | AR-03 check covers `tegg-format` `usage.rs` and the new `tegg-schema` code |
| L1 | `packages/doc/test/query_usage.ac.test.ts` (`fenceUsage`, `withUsage`, `applyFenceUsage`: FR-FMT-06 AC-7, the fence bytes of FR-QRY-01 AC-14, AC-16, FR-QRY-05 AC-24, AC-26, FR-FMT-12 AC-13 fence part); `app/test/views_usage_model.ac.test.ts` (`views/usage.ts`: R194 effective values, R197's routing as pure decisions, R198 keys and rename, FR-QRY-07 AC-23 model, FR-QRY-05 AC-25 keys); `app/test/views_placement.ac.test.ts` (`shell/placement.ts`: FR-QRY-07 AC-19's rule); `app/test/views_usage_registry.ac.test.ts` (FR-UX-03 AC-52, NFR-OTH-02 AC-22) |
| L2 | `packages/doc/test/query_usage_props.ac.test.ts` and `crates/tegg-schema/tests/ac_views_usage_props.rs` (FR-FMT-07 AC-34) |
| L3 | `tests/fixtures/queries-files/expected-views-usage.json`: `fences` (`{ file, fence: n, saved, sort, columns }` for every reference fence of the overlay and of `expected/views-usage/fences/*.md`, `sort` / `columns` as `null`, `"broken"` or the value), `items` (the overlay `book.yml` items), `results` (R200, `cs` and `en-US`); read by `crates/tegg-core/tests/ac_views_usage.rs`, `packages/doc/test/query_usage.ac.test.ts` and `app/test/fake_views_usage.contract.test.ts` |
| L4 | `crates/tegg-schema/tests/ac_views_usage_type_file.rs` (AR-07 AC-10, R196 bytes of every op, FR-QRY-07 AC-23…AC-26 type-file bytes, FR-FMT-12 AC-13 items, `rename_view` on items); `crates/tegg-core/tests/ac_views_usage.rs` (§17 runs: R200, FR-QRY-01 AC-16, FR-QRY-07 AC-20 (bytes, order through `type_patch` + `query_trash`), AC-21 (a), (c), AC-22, FR-QRY-09 AC-8 watcher, FR-SYN-02 AC-12, FR-SYN-03 AC-31, FR-TPL-04 AC-3 copy); `crates/tegg-jobs/tests/ac_views_usage_jobs.rs` (FR-LNK-03 AC-25, FR-QRY-07 AC-26 (a)) |
| L5 | `app/webkit/views_usage.ac.test.ts` (FR-QRY-07 AC-20…AC-26, FR-QRY-01 AC-14…AC-16, FR-QRY-05 AC-24…AC-27, FR-QRY-09 AC-8, FR-FMT-12 AC-13, FR-SYN-03 AC-31, FR-SYN-06 AC-49 counts, FR-STO-07 AC-11, FR-TPL-04 AC-3, FR-UX-03 AC-52, NFR-OTH-02 AC-22); `app/webkit/views_menus.ac.test.ts` (FR-QRY-07 AC-19 and `bug_q21_fr_qry_07_view_menu_stays_in_the_window`, committed red first); helpers `app/webkit/views-usage-helpers.ts` (overlay copy, usage keys) |
| L6 | `app/e2e/views_usage.ac.test.ts` (views.md part two "Real-app tests", the bug test's twin); keys only to Tegg (D-799) |

No new `qa.config.json` step. The changed Q2 / Q tests (D-1851) change in the build commits, not in the red ones.

### 21.3 Expected bytes (`tests/fixtures/queries-files/expected/views-usage/`, README there)

Written with the red tests by the test author. Clock `2026-11-19T10:00:00+01:00`; inputs the base fixture or the
overlay as named. `types/` and `notes/` hold whole files after the action (`notes/` with the autosave's `modified:`,
D-55); `fences/` hold `applyFenceUsage` results (no `modified:` change) next to their `-input.md`. Byte rules as
`expected/` (LF, final newline; `-crlf` / `-no-newline` variants).

| File | Input → action | Criteria |
| --- | --- | --- |
| `types/book-vyborne-shift-finished.yml` | base; ⇧-click `Finished` on `Výborné knihy` | FR-QRY-07 AC-23 (a) |
| `types/book-vyborne-sort-title-only.yml` | then popover `Remove` on `Finished` | AC-23 (b) |
| (the base `book.yml`) | then `Use the query's sort` | AC-23 (c) |
| `types/book-overlay-prectene-click-finished.yml` (+ `-crlf`) | overlay; click `Finished` on `Přečtené 2026` | AC-23, FR-FMT-07 AC-34 |
| `types/book-rozectene-sort-add.yml` | base; `+ Add sort` in the `Rozečtené` board tab's popover (D-1864) | AC-23 |
| `types/book-new-property-stran-1.yml`, `types/book-new-property-stran-2.yml` | base; `New property…` Number `Stran` on the `Přečtené 2026` tab: the attribute, then the item's `columns` | AC-24 (D-1864) |
| `types/book-prectene-columns-genres.yml` | base; `Columns` › `Genres` on `Přečtené 2026` | AC-24 |
| `types/book-prectene-columns-reordered.yml` | then `Finished` before `Author` | AC-24 |
| `types/book-overlay-prectene-no-genres.yml` | overlay; uncheck `Genres` | AC-24 |
| `types/book-trash-vyborne.yml` | base; `Move to trash` on `Výborné knihy` | AC-20 |
| `types/book-overlay-without-prectene.yml` | overlay; `Move to trash` / `Remove from Books page` on `Přečtené 2026` | AC-20, AC-26 (c) |
| `types/book-overlay-readded-prectene.yml` | then `Show a saved query` `Přečtené 2026` | AC-26 (c) |
| `types/book-overlay-renamed.yml` | overlay; rename → `Přečtené letos` | AC-26 (a), FR-LNK-03 AC-25 |
| `types/book-overlay-duplicate.yml` | overlay; `Duplicate` on `Přečtené 2026` | AC-26 (b) |
| `types/book-overlay-xbarva-input.yml`, `-xbarva-after-vyborne.yml`, `-xbarva-after-prectene.yml` | the `x-barva` + comment variant; sort change on `Výborné knihy`, then on `Přečtené 2026` | AC-25 (c) |
| `types/book-overlay-quoted-name.yml`, `types/book-overlay-nfd-after-change.yml` | the runtime variants (e), (f) after one change | AC-25 (e), (f), FR-FMT-12 AC-13 |
| `notes/cteni-2026-click-rating.md`, `notes/cteni-2026-shift-finished.md` | base Čtení; click `Rating`; then ⇧-click `Finished` | FR-QRY-01 AC-14 (a), (c) |
| `notes/knihy-na-cesty-b1-click-author.md`, `notes/knihy-na-cesty-b5-click-finished.md` | overlay Cesty; block 1 `Author`; block 5 `Finished` | AC-14 |
| `notes/knihy-na-cesty-b4-click-title.md` | overlay; block 4 `Title` | FR-QRY-01 AC-16 |
| `notes/cteni-2026-columns-genres.md`, `notes/cteni-2026-columns-reordered.md` | base Čtení; `Columns` › `Genres`; from the fixture, `Finished` before `Author` | FR-QRY-05 AC-24 |
| `notes/knihy-na-cesty-b1-columns-rating.md`, `notes/knihy-na-cesty-b1-columns-reset.md` | overlay; block 1 `Columns` › `Rating`; then `Use the query's columns` | AC-24 |
| `notes/knihy-na-cesty-b3-on-cards-author.md` | overlay; block 3 `On cards` › `Change…` › `Author` | FR-QRY-05 AC-26 |
| `notes/knihy-na-cesty-renamed.md` | overlay; the rename job (no `modified:` change) | FR-QRY-07 AC-26 (a) |
| `fences/<case>-input.md` → `fences/<case>.md`, cases `insert-plain`, `one-to-list`, `list-to-one`, `remove`, `tilde`, `info-meta`, `list-item`, `callout`, `comment-kept`, `crlf`, `nfd-saved` | `applyFenceUsage` | FR-FMT-06 AC-7 |
| `templates/seznam-knih.md`, `notes/seznam-knih-new.md` | the runtime template; a new Page from it | FR-TPL-04 AC-3 |

The query-page steps reuse `expected/views/` (`prectene-2026-sort-*.yml`, `-click-*.yml`, `-columns-*.yml`; AC-15).

## 22. Owner decisions

### 22.1 Contract decisions (CP-10…CP-21 → D-1852…D-1863, accepted by the owner 2026-11-19)

Each point was decided as proposed; the alternatives are kept for the record.

| # | Question | Decision | Alternatives (not chosen) |
| --- | --- | --- | --- |
| CP-10 → D-1852 | **How the Undo of a trash (and the revert of a failed move) gets `book.yml`'s exact bytes back** (AC-21 (a), (d)). `type_patch` ops rebuild `views:` canonically, which loses comments and unknown keys; the UI has no file text. | `TypeDto.viewsSource` (the `views` key's lines as written) and `TypeOp::SetViewsSource(source)` replacing exactly that range, base-checked, read back. Only the `views` lines can be restored. | (b) `type_revert(key, base, text)` with the whole text in `TypeDto` (heavier, can restore any line). (c) One core command `view_trash(type, base, name)` + `view_trash_undo`, ordering and revert in Rust (AC-21 (d)'s fake-core failure of `query_trash` then needs a core hook). |
| CP-11 → D-1853 | **How a tab's run gets its own values.** | `QuerySourceDto` `{ kind: 'view'; type; name }`: the core reads the item from the type file (shape-broken values and run-time checks in one place). | (b) `{ kind: 'saved', name, usage: { sort, columns } }` from `TypeDto.viewItems` (the UI can't pass a broken shape; R194's notice then needs UI logic). |
| CP-12 → D-1854 | **What `QueryResult.def` holds for a usage.** | The query file's def unchanged; `usage` carries the own and effective values; rendering reads `usage` first. The editor's commit can't leak an own value into the query file. | (b) `def` with the effective `sort` / `columns` and `usage.defaults` for the query's (every query-file writer must then swap them back). |
| CP-13 → D-1855 | **The `views:` items in Rust and TS without breaking Q2's tests.** `TypeFile.views: Option<Vec<String>>` and `TypeDto.views: string[]` are asserted by Q2's tests (`ac_views_writes.rs`, `ac_schema.rs` literals, L5). | Keep `views` as the names; add `Parsed.view_items` / `TypeInfo.view_items` and `TypeDto.viewItems`. `SetViews(names)` keeps its signature. | (b) `views: Option<Vec<ViewItem>>` (type-only AC-test changes under D-1851). |
| CP-14 → D-1856 | **`Use the query's …` with a broken own value.** R197 offers it "only when there is an own sort". | Offered whenever the usage has the key, valid or broken, so a broken value can be dropped in the UI. | (b) Only for a valid own value (a broken one is fixed by any change, R194). |
| CP-15 → D-1857 | **The item ops.** | Two ops `SetViewSort { name, sort: Option<…> }`, `SetViewColumns { name, columns: Option<…> }` (None removes); a name not listed → `Rule(ViewNotListed)`, shown as `views.changedOutside`. | (b) One `SetViewSettings { name, sort: Option<Option<…>>, columns: Option<Option<…>> }` (needs double-option serde). |
| CP-16 → D-1858 | **A block's `n` (R198) in the editor.** | `QueryMountHost.ordinal(pos)` from `EditorHandle.queryBlocks()` (document order, nested included, by `savedName` key), recomputed when a doc change adds, removes or moves a query block; the read view counts in its render walk. | (b) Fixed at mount (a moved block keeps a stale key until the note reopens). |
| CP-17 → D-1859 | **The editor's preview from a usage.** | The preview `query_run({ kind: 'def' })` uses the def with the opener's effective `sort` and `columns`, so it looks like the usage; the commit keeps the file's. | (b) The preview shows the query's defaults. |
| CP-18 → D-1860 | **When `On cards` › `Change…` writes.** AP-1525 says "at once as the Columns menu does"; on the query page Q2 committed it with `Done`. | At once from every opener (tab, block, page), one write per change; `Done` never writes `columns`. | (b) At once on usages, on `Done` on the page. |
| CP-19 → D-1861 | **Which popups get the placement rule.** D-1848 lists the views and query-block popups; AP-1529 (c), app-wide, wasn't chosen. | `PopupMenu` gains `fit` (opt-in) and every views / query-block popup of §20 uses it, rendered in a body portal. Other menus unchanged. | (b) Make it `PopupMenu`'s default now (every menu of the app changes, more tests touched). |
| CP-20 → D-1862 | **⌘Z after a block write** (FR-QRY-01 AC-14 (b)): the focus is in the block's header, inside a node view whose events the editor may stop. | The query node views pass ⌘Z / ⇧⌘Z to the editor's history (§13.3). | (b) `QueryBlock` keeps its own undo (a second `setSource` with the previous source; a second undo stack). |
| CP-21 → D-1863 | **What Duplicate copies.** D-1843: "copies the tab's own settings". | Own `sort` and `columns` only (one `type_patch` with three ops); unknown item keys and comments aren't copied; widths aren't. | (b) The item's lines verbatim with the name replaced (a `DuplicateView` op). |

### 22.2 AC problems (fixed in `docs/acceptance/views.md` part two as D-1864, owner 2026-11-19)

1. **Two trailer texts.** Part two's change table said `AC-Test-Change: slice Q2.1 makes sort, columns and widths per
   usage and trash remove a view's tab (D-1835, D-1836); approved-by: owner`; D-1851 says `… slice Q2.1 builds
   per-usage settings and trash (D-1835, D-1836) …`. Fixed: the ACs use D-1851's wording.
2. **The overlay README read "Draft"** (`tests/fixtures/vaults/views-usage/README.md`). Fixed: "Draft" dropped (the
   shapes are D-1838, D-1840), with a `Fixture-Change:` trailer; the test author adds `expected/views-usage/README.md`
   with §21.3's table.
3. **A tab of a type file that can't be written.** R194 / R197 said nothing about a tab's sort and column controls when
   `book.yml` is Newer or invalid. Fixed: R194's row "Type file that can't be written": sort, Columns, header drag,
   `Use the query's …` and `On cards` › `Change…` are `aria-disabled` with the reason `Remove` has (FR-QRY-07 AC-12
   (e)); own values still apply; resize and folds work.
4. **FR-QRY-07 AC-23's board-tab step named no change.** Fixed: `+ Add sort` on the `Rozečtené` tab (the first unused
   column ascending appended to the query's levels), expected `types/book-rozectene-sort-add.yml`.
5. **FR-QRY-07 AC-24's `New property…` named no property.** Fixed: the Number property `Stran` (key `stran`), expected
   `types/book-new-property-stran-1.yml`, `-2.yml`.
6. **FR-QRY-01 AC-14 (b) "with the focus still in the note".** Fixed: "with the focus still on the block's header (or in
   the note's text)", per D-1862.
7. **FR-QRY-07 AC-19 named "the editor `Edit query` from a tab".** Fixed: "the editor (`Edit view` from a tab, `Edit
   query` from a block)".
8. **R199 and FR-UX-03 AC-52 said "own value".** Fixed per D-1856: the commands (and R197's `Use the query's …` rows) are
   offered when the usage has the key in its item or fence, valid or broken.

### 22.3 Contract choices (no owner decision needed)

1. One shared shape reader (`tegg_format::usage`) for fences and `views:` items; `@tegg/doc` is the only writer of
   fences (D-82), `tegg-schema` the only writer of type files.
2. `QueryFence`, `FenceRead`, `TypeFile.views`, `SetViews`' signature and `TypeDto.views` keep their shapes, so slice
   Q / Q2 tests change only where D-1851's table says.
3. The usage index stays names only; own values are never indexed (AR-01).
4. The trash of a view is orchestrated by the UI through existing commands (AC-21 (d) uses the fake core's
   `query_trash` failure).
5. Usage keys are plain strings built and parsed by one pure module (`views/usage.ts`).
6. A view tab is run with `{ kind: 'view' }`; `query/<name>` keeps `{ kind: 'saved' }` (the defaults).
