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

**Part three** (§23…§32, at the end) is slice Q2-T, Tasks on saved queries (D-1776…D-1780, D-1890…D-1913; ACs
`docs/acceptance/views.md` part three, R201…R208). §23.3 lists every place of parts one and two, and of
`docs/contracts/ms5-tasks.md`, that it supersedes; those places aren't marked inline.

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

Public interfaces of slice **Q2.1** (feedback `docs/feedback/q2-v040.md`; released with Q2's fixes as 0.4.1, D-1837, D-1878),
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
- **Fence-only patch** (D-1885; `packages/editor/src/sourceDoc.ts` `queryBodyPatch`): when the save's `reconcile`
  finds a top-level container (a callout, a quote, a list) whose only change from the opened file is the text of nested
  `query` fences, it writes that container by patching its original source: only the fence body lines that changed are
  replaced (head and tail lines that match are kept), new lines get the prefix of the fence's opening line (`> `, list
  indentation, a list marker's width in spaces). Every other byte of the container is kept: other paragraphs, the
  callout title, an NFD `saved:` value, the EOLs (the patch is written with the note's EOL and is **not** NFC-normalized;
  the new lines are NFC because `withUsage` writes them so). A top-level fence (`rawBlock`) keeps its bytes as before.
- **Fail, never re-render** (D-1885, QA review of Q2.1): when such a container can't be patched (its fences don't match
  the parsed blocks, a body line without the expected prefix), the write fails instead of re-rendering the container:
  `setSource` returns false and changes nothing (the editor refuses the transaction; `queryWritesFit`), so nothing is
  written and the block shows `query.saveFailed`; a save of such a change that didn't come through `setSource` throws
  `VerifyError` (the autosave's failed state) and writes nothing. A container that also has other edits is rendered as
  before (FR-EDT-08).

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
  `Change…` (the R130 Columns menu) calls the opener's `UsageWriter.columns` at once on a tab and in a block (CP-18,
  D-1860). On the query page (`query/<name>`) it changes the editor's draft and applies with the editor's `Done`, as in
  Q2 (D-1884 amends D-1860).
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
  Columns menu of tabs, blocks and the page (D-1873: no block `⋯`), the card menu and its `Move to` / `Also add
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

### 22.3 Red-test decisions (RT-12…RT-21 → D-1865…D-1874, accepted by the owner 2026-11-19)

| RT | Decision |
| --- | --- |
| RT-12 → D-1865 | `notes/seznam-knih-new.md` holds the body only; tests check that the new note ends with it (its id and dates come from other rules) |
| RT-13 → D-1866 | Its name-key field is `nameKey` |
| RT-14 → D-1867 | A submenu taller than the window gets a `maxHeight` like a menu (D-1848) |
| RT-15 → D-1868 | A re-emitted `views:` item is written NFC throughout (rule 9); unchanged items keep their bytes, NFD included; tests check the NFD `by` only when read |
| RT-16 → D-1869 | `x-barva` and a comment inside the item after `name:`; ⇧-click `Finished` on `Výborné knihy`, then a click on `Finished` on `Přečtené 2026`; the three `xbarva` expected files approved; (e) gives the plain `"Čtu, až bude čas"` item an own `title ↑` |
| RT-17 → D-1870 | `notes/knihy-na-cesty-b5-click-finished.md` starts from the overlay |
| RT-18 → D-1871 | A small L6 test `fr_qry_07_ac19_view_menus_stay_in_the_window` (800 × 500, toolbar `⋯` and the sort popover) besides the bug twin |
| RT-19 → D-1872 | Choosing Number is the combobox `Type`, option `Number`, then the button `Add` |
| RT-20 → D-1873 | A query block in a note has no `Query actions` menu; contract §20's placed popups for blocks are the sort popover and Columns |
| RT-21 → D-1874 | Its bytes are Q2's `query_apply` bytes, already covered; L5 checks the query page |

---

# Part three: slice Q2-T, Tasks on saved queries (D-1890…D-1913)

Public interfaces of slice **Q2-T** (plan `docs/plans/q2-views-plan.md` §7; feedback `docs/feedback/q2-v041.md`; released
as 0.5.0), for the test author (D-61) and the build. ACs: `docs/acceptance/views.md` **part three** (R201…R208;
FR-TSK-04 AC-22…AC-29, FR-TSK-05 AC-19…AC-22, FR-TSK-10 AC-13, FR-QRY-07 AC-27…AC-31, FR-TYP-01 AC-11, FR-QRY-01
AC-17…AC-20, FR-QRY-02 AC-9, FR-QRY-05 AC-28, AC-29, FR-QRY-08 AC-3, FR-TYP-09 AC-36, FR-FMT-07 AC-35, FR-FMT-12 AC-14,
FR-SYN-02 AC-13, FR-SYN-03 AC-32, FR-SYN-06 AC-50, FR-STO-07 AC-12, NFR-PERF-07 AC-5, FR-UX-03 AC-53, FR-UX-05 AC-25,
FR-UX-08 AC-25, NFR-OTH-02 AC-23; the F3 bug test) and the table "Existing criteria this slice changes (part three)".
Decisions D-1776…D-1780 (plan), D-1890…D-1895 (feedback) and AP-1533…AP-1550 = D-1896…D-1913 (BRD v1.212). Fixtures: the
base `tests/fixtures/vaults/tasks/` (+ `new-empty/.tegg/`), the overlay `tests/fixtures/vaults/views-tasks/` (README
there), `tests/fixtures/vaults/views/` and `views-usage/` for the Book criteria. Boards `TasksQSpec` (A, B, C),
`TasksQSchedule`, `TasksQKanban` and their Dark variants.

**Status: approved, 2026-11-20.** Contract points CP-22…CP-31 decided by the owner as proposed (option (a) each):
D-1914…D-1923 (§32.2); each place they settle is marked **(CP-n, D-19xx)**. The AC fixes of D-1922 (and the AC text of
D-1917, D-1920, D-1923) are made in `docs/acceptance/views.md` part three. Where this part and the ACs disagree, the ACs
win and this contract is corrected before the red tests.

Parts one and two hold unless a section below changes them. This part also **supersedes parts of**
[ms5-tasks.md](ms5-tasks.md) (§23.3): the Tasks page stops being its own page and becomes `type/task` with view tabs.

## 23. What Q2-T changes

### 23.1 Words

- A **period board** is a board whose `group_by` is a period mapping `{ <key>: period }` (R201). Its lanes are the
  **period lanes** `today`, `week`, `later`, the **no-value lane** `none`, and with a valid `done_lane` the **done lane**
  `done`. The `week` lane holds one **day group** per day from tomorrow to the week's last day (R203).
- A **date key** of a period board is the grouping key when it is an attribute of kind Date; a **date-time key** is an
  attribute of kind Date-time, or `created` / `modified`. Only date keys write on a drop (CP-25, D-1917).
- **States**: an attribute **carries states** when it is a Select and at least one of its options has a `state` of
  `open`, `in-progress`, `done` or `cancelled` (`OptionDef.extra`, ms5-tasks §2.2); an object's **state** for such an
  attribute is tasks.md R44's (missing value, unknown value or an option without a known state → `open`).
- The **default task views** are the saved queries `Schedule` and `Kanban` with R202's bytes. The **migration** writes
  them and `task.yml`'s `views:` once (R202); **Restore default views** brings back a missing one (R202, AP-1539).
- **Bounds** of a run: `today` = `QueryEnv.today`; the week's first day = `today` minus `(today − week_start) mod 7` days;
  its last day = first + 6; **after the week** = last + 1 (D-329; `QueryEnv.week_start`).

### 23.2 What Q2-T writes

| Action | Writes | Through |
| --- | --- | --- |
| Migration (vault open, vault create) | `.tegg/queries/Schedule.yml`, `Kanban.yml` (exclusive creates, each only when the name is free), then `task.yml`'s `views:` | `Core::task_views_migrate` (§25.2) |
| `Restore default views` | the missing default files (exclusive), then `views:` | `task_views_restore` (§25.3) |
| its Undo | `views:` back to its exact bytes, then the created files to the trash | `type_patch` `viewsSource`, `query_trash` |
| Period drag, `Move to ›`, `Move card to next / previous lane` on a period board | one object: the date key's line (set, replace or remove) and `modified:` | `applyPeriodMove` + `note_write` (§26) |
| Drop onto / out of the done lane | one object: `status`, `completed` (set or removed) and, out of it, the date key; `modified:` | §26 |
| Status move on a board grouped by a `status` that carries states | one object: `status`, `completed` per D-472, `modified:` | `applyTaskChange` + `note_write` (§26) |
| Task checkbox, status / priority / due from a Task card's menu on a board | one object, tasks.md bytes | §26 |
| Editor: `Group by` period choice, done-lane checkbox, state operators | the query file (shared keys) | `query_apply` (§24.3) |
| Sort on a tab (Tasks views included) | the `views:` item (part two, unchanged) | `type_patch` `viewSort` |
| Sort on `All <plural>` | `ui-state.json` `typeSort[<type>]` (a list) | `ui_state_set` (§30.3) |
| Tag filter on a tab or `All <plural>` | `ui-state.json` `tagFilter[<key>]` | `ui_state_set` |
| Lane drag, `Reset lane order` on Kanban | `Kanban.yml` `lane_order` (never `task.yml`) | `query_apply` (part one) |
| `New Task`, ⌘N › Task, palette `New Task`, a lane's tile | nothing until the draft's first change (D-520, D-522) | the draft route `new/task` |

Nothing else: opening `type/task`, switching tabs, folding, filtering, opening menus and popovers, following a card and
Back, visiting `type-settings/task` and relaunching write no vault file (FR-SYN-06 AC-50). Q2-T adds no job and no
restore point (R202).

### 23.3 What this part supersedes

| Place | Now |
| --- | --- |
| ms5-tasks §4 (`schedule`, `kanban`, `counts`, `ViewInput`) | removed: the core's `group` (§24.4) draws Schedule and Kanban. `isOverdue`, `dueLabel`, `shortDate`, `weekOf`, `completedDate`, `matches` stay (used by Daily, embeds, tags, chips); `summaryWeek` is added (§28) |
| ms5-tasks §6.1 (routes `tasks`, `tasks/kanban` built; R45 commands; `tasks.sort` placeholder; `route-ready:tasks*` marks) | the routes are aliases of `type/task` (§29.1); commands per §30.4; the R3 placeholder `tasks.sort` goes; the board marks of part one §4.8 replace `route-ready:tasks*` (NFR-PERF-07 AC-5) |
| ms5-tasks §6.2 (`TasksPage`, `Schedule`, `Kanban`, `QuickAddRow`) | removed (§28.3); `TaskCard`, `CardMenu`, `TagFilter`, `write.ts`, `useTasks`, `sourceNav`, `header.ts`, `quickAdd.ts` stay |
| ms5-tasks §6.3 (`UiStateDto.tasks`) | read once by `adoptTasksUi` (§30.3), never written again; kept in `UiStateDto` |
| ms5-tasks §5 last bullet (quick-add create with `values`) | `newObject` `values` stay (the capture window uses them); the quick-add row goes |
| ms5-tasks §6.4 (`parseQuickAdd`) | unchanged; its only user is the capture window (D-1906) |
| ms5-tasks §10a.4 ("Schedule stays put") | gone: a board re-runs and moves the card (FR-TSK-04 AC-24) |
| ms5-tasks §10a.5, §12.1 (`AllTasks`, `TasksHeader`, `Task views` tablist, `TasksUiDto.view`) | `type/task` is `TypePage` with `TypeViews` like every type (§29.1) |
| ms5-tasks §12.2 (the Task exception: `New Task` → quick add) | gone: Task opens `new/task` (D-1906) |
| ms5-tasks §13 first three bullets (search on `tasks` / `tasks/kanban`) | the view tabs' `Filter Tasks…` (part one §4.4 per-tab text); `tasks.search` kept (§30.4). The date picker bullets stay |
| ms5-tasks §14 (Kanban column moves write `task.yml` `moveOption`) | superseded: lane drags write `Kanban.yml` `lane_order` (part one §4.4); `moveOption` stays for Type settings |
| Part one §1.1 `QueryDef`, `Lane`, `LaneKind`, `GroupKind`, `QueryRow`, `QueryResult` | additions §24.1 |
| Part one §1.4 create (`columns` always written) | a Board with empty `columns` writes none (§24.3, D-1910) |
| Part one §1.6 sort (a Date attribute's key from any instant) | a Date attribute sorts by its valid `YYYY-MM-DD` only (§24.4, CP-31, D-1923) |
| Part one §4.2 `hasViews` (Task excluded, D-1787) | Task has views (§28.2) |
| Part one §4.2 `newViewDef` Board `columns` = `preview` minus the grouping key | Board `columns: []` (D-1910) |
| Part one §4.3 card pills "in `columns` order"; §4.3 editor `On cards`; part two §16.1 `On cards` › `Change…`, §19.4 `columns.useQuery` on a board | cards follow the card's type's `preview` (D-1891, §29.5); no `On cards` row; `columns.useQuery` not listed for a board usage |
| Part one §4.4 per-tab filter text and tags "leaving the route clears it" | the text still clears; the **tags** are machine-local per tab (D-1893, §30.3) |
| Part one §4.4 "On `All <plural>` ⇧-click is a plain click" | `All <plural>` has multi-level sort (D-1892, §29.7) |
| Part one §4.4 wide pages (`max-width: none`) | at most 1,600 px content, centred (D-1890, §29.8) |
| Part one §4.7 `typeSort` "stays the `All` tab's" (one value) | a list of levels (§30.3) |
| Part two §15 (trash from a view menu) | unchanged; `SetViewsSource` gains "empty source removes the key" (§25.3) |

## 24. Query files (`tegg-core::queries_q`, R201; AR-03)

### 24.1 Types (additions to part one §1.1)

```rust
pub enum Op { /* … */ StateIs, StateIsNot }            // YAML `state_is`, `state_is_not`; OPS gains both (23)

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct DoneLane { pub within_days: u32, pub folded: bool }   // R201: 1…366; `folded` missing = false

pub struct QueryDef {
    // …part one, part two…
    /// The grouping key (NFC, trimmed). For `group_by: { due: period }` it is `due` with `group_period: true`.
    pub group_by: Option<String>,
    /// Q2-T (CP-23, D-1915): `group_by` was the mapping `{ <key>: period }`. Always false when `group_by` is None.
    pub group_period: bool,
    /// Q2-T: None = key absent, or present and broken (then in `broken`). A commit with None removes the key (§24.3).
    pub done_lane: Option<DoneLane>,
}

pub enum LaneKind { Option, Unknown, Tag, Relation, Unresolved, None, /* Q2-T */ Period, Done }
pub struct DayGroup { pub date: NaiveDate, pub cards: Vec<LaneCard> }
pub struct Lane {
    // …part one…
    /// Q2-T: the `week` lane's day groups, every day from tomorrow to the week's last day (empty ones included);
    /// empty for every other lane. The `week` lane's `cards` are its days' cards in day order.
    pub days: Vec<DayGroup>,
    /// Q2-T: Some(n) on the done lane and on each Done-state option lane that `done_lane` limits (R201); else None.
    pub done_within: Option<u32>,
}
pub enum GroupKind { Select, MultiSelect, Tags, Relation { multiple: bool }, /* Q2-T */ Period { date_time: bool } }

pub struct QueryRow {
    // …part one…
    /// Q2-T: the object's tag keys (frontmatter and inline, tags.md R79: NFC, case-folded), sorted, unique. The tag
    /// filter's options and matching (FR-QRY-07 AC-30; T18's inline `#rodina` counts).
    pub tags: Vec<String>,
    /// Q2-T (CP-24, D-1916): for an object of type `task`, ms5-tasks §2.1's `TaskRow`, from the same index read.
    pub task_row: Option<TaskRow>,
}
pub struct QueryResult {
    // …part one, part two…
    /// Q2-T (CP-24, D-1916): `Core::task_defs()` when any row has `task_row`; else None.
    pub task_defs: Option<TaskDefs>,
}
```

- **Lane ids and values** (part one §1.1's list grows): period lanes `period:today`, `period:week`, `period:later`
  (`value` `today` / `week` / `later`, the `lane_order` ids, AP-1536); the no-value lane `none` (`value` None); the done
  lane `done` (`value` None). Day groups are keyed `day:<YYYY-MM-DD>` in the DOM and in drops (§29.3). `label` is empty
  for `period:*`, `none` and `done` (the UI names them, §30.2).
- `color`: the done lane takes the colour of the first type's first Done-state `status` option (FR-UX-05 AC-25); period
  lanes and `none` have None.
- `drop_target`: period lanes, `none` and `done` are drop targets on a period board whose key is a **date key**; with a
  date-time key only `done` is (CP-25, D-1917). `excluded` is always false on a period board (never hatched, R203).
- `QueryRow.task` (`TaskBits`, slice Q) stays as it is.

### 24.2 Read rules (R201; additions to part one §1.2)

- **`group_by`**: a non-blank string → as Q2 (`group_period: false`). A YAML mapping with **exactly one** entry whose
  key is a non-blank string and whose value is the string `period` → `group_by = Some(nfc(trim(key)))`,
  `group_period: true`. Every other value (two entries, a value other than `period`, a non-string key, a sequence) →
  `BadValue` for `group_by` (None, false). A plain `group_by: due` stays the Q2 grouping by `due` (a Date, so broken at
  run time, D-1770).
- **`done_lane`**: a mapping with `within_days` an integer 1…366 and an optional `folded` boolean, no other entry →
  `Some(DoneLane)`; anything else (a scalar, `within_days: 0` / `tři`, a non-boolean `folded`, an unknown entry) →
  `BadValue` for `done_lane`, None. Read with every `view`; used only with `view: board` (kept and ignored with `list` /
  `table`, no notice, AP-1535).
- **`lane_order`**: unchanged shape rule. On a period board only the exact strings `today`, `week`, `later` match a
  lane; other entries are kept in the file and ignored (`[Later, zítra]` orders nothing, FR-QRY-01 AC-18).
- **State operators** in `filters`: `{ <key>: { state_is: <s> } }` / `state_is_not`, `<s>` a scalar string. Shape as
  every operator item (v1-queries §1.2).
- **`columns` absent** (D-1927, RT-5): reads as `[]` with `view: board` (a board never uses it, D-1891) and as part one's create default for `list` / `table` (the single type's effective columns, else `[type, modified]`); no notice, the file isn't rewritten. The L3 corpus lists `columns` only for files that have the key.
- `version` stays 1. The `Layout` learns `done_lane` (one line, or a block mapping replaced by one line on write).

### 24.3 Write rules (additions to part one §1.4)

- `ORDER` (create order, R201): `version, title, types, match, filters, sort, limit, view, group_by, lanes, lane_order,
  done_lane, columns, created, modified`. `COMMIT_KEYS` gains `done_lane`.
- **`group_by`**: `group_period: false` → the scalar line as Q2; `true` → one flow mapping `group_by: { <key>: period }`
  (the key D-230 quoted in flow context). Effective value = `(group_by, group_period)`; `group_by: None` in a commit
  still means "unchanged". A replaced line keeps its trailing comment (`group_by: { created: period }   # podle
  termínu`, FR-QRY-01 AC-17, D-1457).
- **`done_lane`**: one flow line, both keys always written: `done_lane: { within_days: 7, folded: true }`. Compared as
  read: a commit whose `done_lane` equals the file's read value (a broken key reads None) writes nothing there. A commit
  with **None while the file read Some** removes the key's line or block (its range per v1-queries §1.4): the second
  explicit exception to "keys are never removed", after `lane_order` (D-1898 (e)). A missing key is inserted at its
  `ORDER` place (right after `lane_order`, else `lanes`).
- **State filters** are written as every operator item: `  - status: { state_is_not: cancelled }`.
- **`columns` on create** (D-1910): `create_text` omits `columns` when `view == Board` **and** `columns` is empty;
  otherwise as part one (an inline board fence saved with its own `columns` keeps them). `New view` › Board passes
  `columns: []` (§28.2), so it writes none. Commits never add, remove or rewrite `columns` on a board unless the def
  changes it (the editor's commit carries the file's, D-1842).
- `create_text` writes `done_lane` when Some (any `view`).
- `patch_job_text`: period `lane_order` ids aren't links and are never patched.
- Read-back check (D-1458) compares the new keys too. Expected bytes: §31.4.

### 24.4 The evaluator (additions to part one §1.6)

- **State operators** (AP-1533, FR-QRY-02 AC-9). Valid when `key` is, in **every** chosen type, a Select that carries
  states (§23.1) and the value is one of `open`, `in-progress`, `done`, `cancelled`. Otherwise broken: a key that isn't
  such an attribute → `Broken { reason: OperatorKind, … }` (R139's red row and notice); a bad value →
  `Broken { reason: Value, … }`. `state_is s` holds when the object's state for `key` is `s`; `state_is_not s` when it
  isn't. Option labels match NFC-exact (D-1808); a renamed option keeps its state, so `Cancelled` → `Zrušeno` changes no
  result.
- **Hidden lanes** (AP-1533). Under `match: all`, a top-level valid `state_is` / `state_is_not` filter on the grouping
  key **removes** the option lanes whose option state it excludes (they are not in `lanes`, not hatched, not offered by
  `laneOrderAfterDrop`, not counted). Unknown-value lanes count as state `open`. Part one's hatching of `is` / `is_not`
  filters stays for those operators.
- **Strict dates in sorts** (CP-31, D-1923; R208's orders need it). A sort level on an attribute of kind **Date** keys
  each object by its valid `YYYY-MM-DD` value only (`tegg_format::date::parse_date`, quoted or not; tasks.md AP-414); an
  impossible date, a date-time or text is an **empty** value (last in both orders). Date-time, `created`, `modified`
  keep the instant rule. This holds in every view, not only boards. Filters are unchanged.
- **Period grouping** (D-1776, AP-1536). Only when `view == Board` and `group_period`:
  - Valid when the key is `created` or `modified`, or an attribute of kind Date or Date-time of **every** chosen type
    with the same kind (D-1807's rule). Otherwise `Broken { BadValue, key: "group_by" }` and `group: None` (drawn as a
    List with `query.block.brokenKey`, FR-QRY-01 AC-18).
  - A value's **date**: Date: `parse_date` of the scalar (else none); Date-time, `created`, `modified`: the instant
    (`instant_ms`) as a local date in `QueryEnv.tz` (D-104). No valid date → `none`. A missing or unreadable
    `created` / `modified` value has no date (never the file's birth or change time; D-1927, RT-11).
  - Lanes: `today` (date ≤ today), `week` (today < date ≤ the week's last day; absent when today **is** the week's last
    day), `later` (date > the week's last day), `none`. Order: `lane_order` (ids above) moves its listed period lanes
    to the front in its order, the others follow in `today, week, later` order; then `none`, then `done`. All shown,
    empty ones too; `none` is always present on a period board (an exception to part one's "only when it has a card").
  - Cards: each row once, in `rows` order (the effective sort, D-1895); in `week`, in its day's group.
  - `GroupKind::Period { date_time }`, `Grouping.name` = the attribute's Name (`Due date`, `Created`, `Modified`).
- **The done lane** (D-1898; R201). When `view == Board` and `done_lane` is Some:
  - Valid when every chosen type's `status` attribute carries states and has at least one option of state `done`;
    otherwise `Broken { BadValue, key: "done_lane" }` and no done-lane behaviour (Projekt, Book).
  - A row is **done** when its `status` state is `done`. Its **completed day** is the local date (in `tz`) of
    `completed`, else of `modified` (tasks.md R44). It is **within** when `today − (within_days − 1) ≤ day ≤ today`.
  - Done rows that aren't within are **removed from `rows`** before grouping (not shown, not counted, not offered by the
    tag filter).
  - Period board: done rows leave the period lanes and form the lane `done` (last, `done_within: Some(n)`), present
    even with no card. Board grouped by `status`: no extra lane; each Done-state option lane gets `done_within`. Any
    other grouping: done rows within stay in their lanes.
- **Re-runs**: `uses_relative` is true for a valid period grouping or a valid done lane (the UI's 30 s date check then
  re-runs at midnight and on a zone change, R203 Live; §27.6).
- **Task rows** (CP-24, D-1916): a row whose type is `task` gets `task_row` from the `tasks5a` row builder over the
  same index entry; `task_defs` is filled once per result. No file read.
- `query_run` still takes one index lock; nothing in a run writes.

## 25. Default task views (R202; D-1777, D-1897, D-1901, D-1902, D-1913)

### 25.1 The default files

```rust
// crates/tegg-core/src/taskviews.rs (new, `pub mod taskviews`, re-exported; AR-03)
pub const TASK_VIEW_NAMES: [&str; 2] = ["Schedule", "Kanban"];
/// R202's def of `Schedule` or `Kanban` (None for any other name). `create_text(&def, now, None)` gives R202's bytes.
pub fn default_task_view(name: &str) -> Option<QueryDef>;
```

- `Schedule`: `types [task]`, `match all`, `filters [status state_is_not cancelled]`, `sort [due asc, priority asc]`,
  `limit 50`, `view Board`, `group_by due` with `group_period: true`, `lanes Horizontal`, `lane_order None`,
  `done_lane { 7, folded: true }`, `columns []`. `Kanban`: the same with `group_by status` (`group_period: false`),
  `lanes Vertical`, `done_lane { 7, folded: false }`. Titles and names are English (D-1897).
- `now` is the instant of the write, `YYYY-MM-DDTHH:MM:SS±HH:MM` in the local zone (the format of `created` /
  `modified`); with `TEGG_TEST=1` and `TEGG_NOW` it is that instant in the process zone (`TZ`, D-504).

### 25.2 The migration (AP-1538, AP-1550)

```rust
pub enum TaskViewsMigration {
    NotNeeded,                                              // Task has a `views` key, any value (`views: []` included)
    Skipped,                                                // task.yml Newer, invalid, or `views` unreadable: nothing written
    Done { created: Vec<String>, views: Vec<String> },      // created: vault paths; views: the names written
    Stopped { created: Vec<String>, reason: String },       // a create or the views write failed; `reason` = the error kind
}
impl Core {
    /// R202. Never alerts; the caller ignores the outcome except for logging.
    pub fn task_views_migrate(&self, now: &str) -> TaskViewsMigration;
}
```

1. Read the Task type: `.tegg/types/task.yml` absent → the built-in definition (D-90), base None. Present: `Newer`,
   invalid, or `views_unreadable` → `Skipped`; `views` Some (any list) → `NotNeeded`; None → go on, base = its version.
2. For `Schedule`, then `Kanban`: when a **live** query resolves to the name (D-1434: NFC, case-insensitive; `.trash/`
   copies don't count; `QCore::taken`) it is left alone, neither read for content nor written. Otherwise
   `create_query_file(name, create_text(default_task_view(name), now, None))` (exclusive `create_exact`, `free: false`).
   `NameTaken` from the create (a race) counts as taken. Any other error → `Stopped` (files already created stay).
3. `type_patch("task", base, [TypeOp::SetViews(["Schedule", "Kanban"])])`: one minimal write inserting the line at R184's
   place (line 11 of new-empty's file); without `task.yml`, the built-in file plus the line, created exclusively (as
   part one §1.3). `Conflict` (the file changed since step 1, FR-QRY-07 AC-29) or any error → `Stopped`; the next open
   retries on the new bytes.
4. `Done`. No restore point. The writes emit `VaultChanged` as every core write.

**Where it runs (CP-27, D-1919).** `app/src-tauri/src/lib.rs` `open_vault`, right after a **new** `Core` is opened and
before `VaultInfo` is returned (not on a reattach of a held core, so it runs at most once per session per vault), when
`task_views_enabled()`: `TEGG_TEST` isn't `1`, or `TEGG_TEST_TASK_VIEWS=1` (D-1913). `vault_create` reaches it through
`open_vault`, so a new vault gets the same files and line (FR-QRY-07 AC-27). `Core::open` stays zero-write. L4 tests call
`Core::task_views_migrate` directly ("migrations on").

**Old UI state** (AP-1538): `adoptTasksUi` (§30.3), in the UI, independent of the vault migration.

### 25.3 Restore default views (AP-1539, CP-26, D-1918)

```rust
pub struct TaskViewsRestore {
    pub created: Vec<String>,          // vault paths of the default files created, in R202 order
    pub names: Option<Vec<String>>,    // the `views` names written; None when `views:` was already complete
    pub before: Option<String>,        // TypeInfo.views_source before the write (None: no `views` key)
    pub info: TypeInfo,                // after
}
impl Core {
    /// R202 `Restore default views`. `Err(Query(NothingToDo))` when both names are listed and resolve to live queries.
    pub fn task_views_restore(&self, base: Option<&FileVersion>, now: &str) -> Result<TaskViewsRestore, CoreError>;
}
```

- Refusals before any write: a `Newer` or invalid `task.yml` and `views_unreadable` → the same errors `type_patch` gives
  for them (part one §1.3, `Rule(ViewsUnreadable)` included); nothing to restore → `Query(NothingToDo)`.
- Then, for `Schedule` then `Kanban`, step 2 of §25.2 (a changed existing file is never touched; a trashed copy stays in
  `.trash/.tegg/queries/`). Then the names: `views` (names) with `Schedule` inserted first when missing and `Kanban`
  inserted right after `Schedule` (first when `Schedule` isn't listed); other names keep their order; a name is
  "missing" when no entry has its name key. Written with `type_patch("task", base, [SetViews(names)])` only when the
  list changed. A refused type write (`Conflict`, FR-SYN-03 AC-32) returns that error; files already created stay and are
  listed on Queries.
- **Undo** (UI, `views/defaultViews.ts`, 8 s toast, one action): (1) `type_patch("task", info.version, [{ op:
  'viewsSource', source: before ?? '' }])`; (2) then `query_trash(name)` for each created file (`Kanban (2).yml` in the
  trash when a copy is there, v1-queries trash naming). A refused step 1 → alert `views.changedOutside`, nothing
  trashed. A failed `query_trash` → alert `trash.removeFailed`.
- `TypeOp::SetViewsSource(source)` (part two §14.2) gains: an **empty** `source` removes the `views` key's lines
  (no-op when absent). Used only by this Undo when Task had no `views` key before.
- IPC `task_views_restore` (§27.1). Disabled state is the UI's (§29.10).

## 26. Board writes of Q2-T (`@tegg/doc`, D-82; FR-TSK-04 AC-25, FR-TSK-05 AC-20, FR-QRY-01 AC-17)

```ts
// packages/doc/src/board.ts (additions), exported from index.ts
export type PeriodMove =
  | { kind: 'set'; key: string; date: string | null }                       // a period lane / day group / the no-value lane
  | { kind: 'done'; status: string; now: string }                           // onto the done lane
  | { kind: 'reopen'; status: string; key: string; date: string | null };   // out of the done lane onto a period / no-value lane
/** null: nothing to write. Never touches `modified:` (the caller's `touchModified`, as part one §1.9). */
export function applyPeriodMove(text: string, move: PeriodMove): string | null;
```

- `set` with a date: the key's value token (any form: quoted, NFD, an impossible date, a date-time, a block value) is
  replaced by `YYYY-MM-DD` unquoted, the line's other bytes kept; a missing key is appended after the last frontmatter
  entry (D-230; T08's `due: 2026-10-16`). `set` with `null` removes the key's line (and its block lines); a missing key →
  null. The same valid date already there → null.
- `done` = `completeTask`'s check bytes (ms5-tasks §5; FR-TSK-02 AC-10): `status: <status>` (the card's type's first
  Done-state option), `completed: <now>` appended unless present; the date key untouched.
- `reopen` = `applyTaskChange({ kind: 'status', to: <first Open-state option>, toState: 'open', fromState: 'done', … })`
  (removes `completed`) then `set` on the result: one text, one write (T12: `status: To do`, `due: 2026-10-14` appended).
- A **status move** on a board whose grouping key is `status` and whose card's type's `status` carries states uses
  `applyTaskChange({ kind: 'status', … })` instead of `applyBoardMove` (D-472: into a Done state appends `completed`, out
  of it removes it; FR-TSK-05 AC-20). Other status boards (Book) keep `applyBoardMove`.
- Dates are `YYYY-MM-DD` from the bounds of the result the board shows (§29.3); never shifted by a zone (FR-FMT-11).
- **Write path** (`app/ui/src/queries/board/write.ts`): `writeCardChange(row, change: (text: string) => { text: string;
  inlineKept: boolean } | null)` is part one's `doWrite` with the change as a parameter (note_read, version check,
  change, `touchModified`, `note_write(path, text, row.version)`, one write per object in flight, `readOnly` never
  written). `writeCardMove(row, move)` and the new `writePeriodMove(row, move)` call it. On a board, the Task card's
  checkbox and its menu's status, priority and due actions also go through `writeCardChange` with ms5-tasks §5's
  functions, so every write to one object from a board shares one queue. Outcomes and alerts as part one §1.9
  (`board.changedOutside`, `query.saveFailed`).

## 27. IPC

### 27.1 Commands

| Command | Change |
| --- | --- |
| `query_run`, `query_get`, `query_apply`, `query_create` | `QueryDefDto` gains `groupPeriod`, `doneLane`; filter ops gain `state_is`, `state_is_not`; `GroupingDto`, `LaneDto`, `QueryRowDto`, `QueryResultDto` additions below |
| `task_views_restore` (new) | `base: VersionDto \| null`, `now: string` → `TaskViewsRestoreDto` (`Core::task_views_restore`); errors as `type_patch` plus `NothingToDo` (`Query`) |
| `type_patch` | `{ op: 'viewsSource'; source: '' }` removes the key (§25.3) |
| `index_type_rows` | `TypeRowDto` gains `tags: string[]` (tag keys, frontmatter and inline, as §24.1) |
| `ui_state_get` / `ui_state_set` | `UiStateDto` gains `tagFilter`; `typeSort` values become a list (§30.3) |
| `task_list`, `daily_tasks`, `note_read`, `note_write`, `note_create`, `query_trash`, `query_restore` | unchanged (`task_list` still feeds the Daily Note, Task embeds, the sidebar count and the Tasks summary) |

No IPC is removed. No command runs the migration (§25.2).

### 27.2 DTOs

```ts
type DoneLaneDto = { withinDays: number; folded: boolean };
type QueryDefDto = { /* Q, Q2 */ groupPeriod: boolean; doneLane: DoneLaneDto | null };
type FilterOp = /* … */ | 'state_is' | 'state_is_not';
type DayGroupDto = { date: string /* YYYY-MM-DD */; cards: LaneCardDto[] };
type LaneDto = {
  /* Q2 */
  kind: 'option' | 'unknown' | 'tag' | 'relation' | 'unresolved' | 'none' | 'period' | 'done';
  days: DayGroupDto[];                 // `period:week` only; [] otherwise
  doneWithin: number | null;
};
type GroupingDto = { /* Q2 */ kind: 'select' | 'multiSelect' | 'tags' | 'relation' | 'period'; dateTime: boolean };
type QueryRowDto = { /* Q, Q2 */ tags: string[]; taskRow: TaskRowDto | null };
type QueryResultDto = { /* Q, Q2, Q2.1 */ taskDefs: TaskDefsDto | null };
type TypeRowDto = { /* 3D */ tags: string[] };
type TaskViewsRestoreDto = { created: string[]; names: string[] | null; before: string | null; type: TypeDto /* `info` */ };
```

`TaskRowDto`, `TaskDefsDto`: ms5-tasks §3, unchanged.

### 27.3 Rust and TS files

`app/src-tauri/src/shellq.rs` (`QueryDefDto`, `DoneLaneDto`, `LaneDto.days` / `doneWithin`, `DayGroupDto`,
`GroupingDto.dateTime`, `QueryRowDto.tags` / `taskRow` (the existing `task_row_dto`), `QueryResultDto.taskDefs`,
`task_views_restore`), `dto.rs` (`TypeRowDto.tags`, `UiStateDto.tag_filter`, `TypeSortValue`), `lib.rs` (`open_vault`'s
migration call, `task_views_enabled()`, `clock::now_iso()` honouring `TEGG_NOW`; the command in `invoke_handler`),
`build.rs` (`"task_views_restore"` in the command list), `capabilities/default.json` (`"allow-task-views-restore"`), the
generated `permissions/autogenerated/task_views_restore.toml`. TS: `app/ui/src/ipc/queries.ts` (the DTOs,
`taskViewsRestore(base, now)`), `ipc/types.ts` (ts-rs bindings regenerated).

### 27.4 UI error handling

- `task_views_restore`: `Conflict` / version mismatch → the types store reloads, alert `views.changedOutside` (`"Tasks"
  changed outside Tegg. The views weren't changed.`); created files stay. `NothingToDo` → nothing (the button was
  already disabled). `Io` → `query.saveFailed`.
- Period, done-lane and status writes: part one §1.9 (the card goes back to its disk state's lane on the re-run; alert
  `board.changedOutside` names the object, FR-SYN-03 AC-32).
- `Kanban.yml` lane drags: part one §2.1 (`query.editor.changedOutside`).

### 27.5 Who calls what

| Surface | Calls |
| --- | --- |
| `type/task` (every tab) | types store, `queries_list`, one `query_run({ kind: 'view', type: 'task', name })` for the selected view tab (part two), `task_list` for the header summary (§29.1); `All Tasks`: `index_type_rows('task')` |
| Period drag, done-lane drop, status drag, Task checkbox and card menu on a board | `note_read`, `note_write` (§26) |
| Kanban lane drag, `Reset lane order` | `query_apply` on `Kanban.yml` (part one) |
| Editor `Group by` period, done-lane checkbox, state operators | `query_apply` |
| `Restore default views` / Undo | `task_views_restore`; Undo `type_patch` (`viewsSource`), `query_trash` |
| Tag filter, `All` sort, folds, last tab | `ui_state_set` |
| `New Task` (header, ⌘N, palette), a lane's tile | the draft route `new/task` (`Route.prefill` for tiles) |

### 27.6 Live results

Part one §2.3 and part two §17.4 hold. The UI's 30 s date check (`useQueryRun`) compares `{ today, zone }` and re-runs a
result with `usesRelative` when either changed (R203 Live, FR-TSK-04 AC-27: within 60 s, no write). A board keeps an
optimistically moved card in its target lane or day group until the next answer.

## 28. UI modules

### 28.1 New

| Module | Owns |
| --- | --- |
| `app/ui/src/queries/board/period.ts` (pure, L1; CP-22, D-1914) | `bounds(env: { today: string; weekStart: number })` → `{ today; weekFirst; weekLast; afterWeek; days: string[] /* tomorrow…weekLast */ }`; `periodOf(value: unknown, kind: 'date' \| 'dateTime', b, zone?)` → `{ lane: 'today' \| 'week' \| 'later' \| 'none'; day: string \| null }` (R203's table; the fake core and L1 use it); `completedWithin(row: { completed; modified }, today, n, zone?)`; `weekStart` uses `Date.getDay` numbering (0 = Sunday, 1 = Monday, D-1927); `dropFor(laneId, day: string \| null, b)` → the date a drop writes (`period:today` → today, a day group → its date, `period:later` → `afterWeek`, `none` → null); `prefillFor(laneId, b)` → today, `weekLast`, `afterWeek`, null (`none`), and no tile for `done`; `laneLabelKey(laneId, isTaskDue: boolean)` → the §30.2 key; `dayHeading(date, region)` (`Intl.DateTimeFormat(region, { weekday: 'long', day: 'numeric' })`: `středa 15.`, `Thursday 15`); `targets(group)` → the drop targets as `{ lane: string; day: string \| null }` (D-1927) in keyboard order (`period:today`, each day group, `period:later`, `none`, `done`); `neighbourTarget(group, at: { lane: string; day: string \| null }, dir: 1 \| -1)` |
| `app/ui/src/views/tagFilter.ts` (pure, L1) | `tagFilterKey(scope: { kind: 'tab'; typeKey; name } \| { kind: 'all'; typeKey })` (`tab:<type>/<name key>`, `all:<type>`, NFC); `tagOptions(rows: { tags: string[] }[], selected: string[], spelling: (key) => string, collator)` → `{ key; label; count }[]` (AP-1545: tags of the rows the tab shows before the tag and text filters, done lane included; count = rows that would remain with it added to the selection; most first, then collation, then key bytes; every selected key listed, `0` when absent, D-1927); `selected` keys are NFC-normalised and case-folded inside `tagOptions` and `keepRow` (so `práce` typed in NFD is one chip, FR-FMT-12 AC-14); `keepRow(row, selected)` (all-of, D-518) |
| `app/ui/src/views/allSort.ts` (pure, L1) | `sortTypeRows(rows: TypeRowDto[], levels: SortDto[], type: TypeDto, collator)`: part one §1.6's per-kind comparison (option order then unknown values, empty last at every level, strict Date per §24.4), ties by title, then path; `levelsOf(stored: SortDto[] \| TypeSortDto \| undefined)` (0.4.x single value → one level; absent → the page's default) |
| `app/ui/src/views/defaultViews.ts` | `restoreState(type: TypeDto \| null, summaries)` → `{ enabled: boolean; reason: string \| null }` (R202: disabled with `typeSettings.restoreViewsNone` when both names are listed and live; with FR-QRY-07 AC-12 (e)'s reason for a Newer / invalid `task.yml` or an unreadable `views`); `restoreDefaultViews(type)`: `task_views_restore`, the toast `typeSettings.restoredViews` (`{names}` joined by `Intl.ListFormat` conjunction) with `Undo` 8 s, the live region, §25.3's Undo |
| `app/ui/src/views/TasksSummary.tsx` | the header line of `type/task` (§29.1) from `useTasks` and `summaryWeek` |

### 28.2 Changed

| Module | Change |
| --- | --- |
| `views/model.ts` | `hasViews`: every defined type except `tag` (Task included). `newViewDef` Board: `columns: []`, `groupPeriod: false`, `doneLane: null`. New: `periodChoices(type)` → date keys (Date and Date-time attributes in schema order, then `created`, `modified`); `carriesStates(type, key)`; `doneLaneOffered(types: TypeDto[])` (every type's `status` carries states with a Done option); `stateOps(type, key)` → `['state_is', 'state_is_not']` or `[]`. `groupByChoices` unchanged (D-1818) |
| `views/uiState.ts` | `tagFilterOf(key)`, `setTagFilter(key, tags)` (one `ui_state_set` per change; `[]` deletes the key); `foldedOf` / `setFolded` keep `!<lane id>` entries (§30.3); `moveQueryState` also moves `tagFilter` tab keys (R206, D-1797); `adoptTasksUi(ui)` (§30.3) |
| `views/TypeViews.tsx` | Task's first-open rule and `Route.tab` (§29.1); the tag selection per tab from `tagFilterOf` (the text stays in memory, D-1796); `Restore default views` in `View actions` is not added (Type settings and the palette only) |
| `views/ViewPanel.tsx` | `Filter by tag` options from `tagOptions` over the run's rows (board: the rows of every lane card, done lane included); the selection persisted; boards through `QueryBoard` with period lanes and the done lane |
| `pages/TypePage.tsx` | `All <plural>`: `Filter by tag` after `Filter <plural>…` (options from `TypeRowDto.tags`, key `all:<type>`); multi-level sort with `HeaderCell` in `levels` mode (click / ⇧-click / keys, part one §4.4) and the sort button + `SortPopover` with scope `thisMac`, writing `typeSort[<type>]` as a list; on `task` the header shows `TasksSummary` instead of the count; the width of §29.8 |
| `queries/SortPopover.tsx` | `scope: 'tab' \| 'block' \| 'default' \| 'thisMac'`; with `thisMac` no `Use the query's sort` |
| `queries/board/QueryBoard.tsx` | period lanes, day groups, the done lane, `done_within` hints, drops through `period.ts` and §26, the Task card (§29.5), `Move to ›` with day groups, `New <Type> in <lane>` with `period.prefillFor` |
| `queries/board/BoardCard.tsx` | pills and chips from the card's own type's `preview` (D-1891, at most 4, D-1240), not from `columns`; a Task row renders `tasks/TaskCard.tsx` (§29.5); relation chips resolve from `row.links` for every value whatever the lane (F3) |
| `queries/board/model.ts` | `cardMove` returns null for a period grouping (period moves are `period.ts`); `laneOrderAfterDrop` lists only `option` / `unknown` / `tag` / `relation` / `unresolved` / `period` lanes (never `none`, `done`, nor a hidden lane); `prefillFor` delegates period lanes to `period.prefillFor` (date keys only, CP-25) |
| `queries/board/write.ts` | `writeCardChange`, `writePeriodMove` (§26) |
| `board/Board.tsx` | `BoardLaneView` gains `days?: { id: string; date: string; label: string; cards: string[] }[]`, `hint?: string`, `tone?: 'danger' \| 'muted' \| null`, `initiallyFolded?: boolean`; drops report `to` = a lane id or a day id; folds of initially-folded lanes use `!<id>` (§30.3); the done lane has no grip |
| `queries/QueryEditor.tsx` | `Group by` lists `periodChoices` after `groupByChoices` (`query.editor.groupByPeriod`, hint `query.editor.groupByPeriodHint`); a done-lane checkbox when `View` is Board and `doneLaneOffered` (checked = the def has `doneLane`; checking sets `{ withinDays: 7, folded: true }`, unchecking `null`; the label's count is the def's `withinDays`, else 7); filter rows offer `stateOps` with values `state.open`, `state.inProgress`, `state.done`, `state.cancelled` (written `open`, `in-progress`, `done`, `cancelled`); no `On cards` row (D-1891) |
| `tasks/TaskCard.tsx` | props gain `preview?: string[]` (default `['status', 'priority', 'due']`, so Daily and embeds are unchanged), `hideKey?: string \| null` (the grouping key), `pills?: ReactNode` (other `preview` keys, BoardCard's pills), `slot?: CardSlotProps` (the board's focus and drag props); R43's chip rules per key (AP-1541) |
| `tasks/CardMenu.tsx` | `columns: KanbanColumn[]` → `moveTo?: { id: string; label: string }[]`, `alsoAddTo?: …` (from the board's targets); R43's other items unchanged |
| `tasks/views.ts` | removes `schedule`, `kanban`, `counts`, `tagSpellings` and the types `ViewInput`, `Schedule`, `KanbanColumn`, `Counts`; adds `summaryWeek(tasks, today, firstWeekday, zone?)` → `{ open; overdue; doneWeek }` (R204: open and overdue as R44; doneWeek = Done-state tasks whose completed day is in the current week, Monday…Sunday in `cs`; filters ignored) |
| `pages/TypeSettingsPage.tsx` | for `task` only, a section `Default views` (§30.1) |
| `App.tsx` | the alias routes (§29.1); `newObjectOfType('task')` opens `new/task` (D-1906); `adoptTasksUi` once at UI-state load; the Task routes' `TasksPage` / `AllTasks` / `TasksHeader` mounting goes |
| `shell/commands.ts`, `shell/registry.ts` | §30.4; R1 rows `tasks`, `tasks/kanban` get `status: { built: true, alias: 'type/task' }` (no page of their own; app-shell tables follow); the R3 control `tasks.sort` goes |
| `views/views.css` | §29.8 |
| `Search.tsx`, `daily/*`, `embeds/*`, `tags/TagPage.tsx`, `links/chip.ts`, `inbox/*`, `trash/*` | unchanged (they import only kept modules) |

### 28.3 Removed (the 5A Tasks page)

`app/ui/src/tasks/TasksPage.tsx`, `Schedule.tsx`, `Kanban.tsx`, `QuickAddRow.tsx`, `TasksHeader.tsx`, `AllTasks.tsx`,
their CSS (`.tasks-page` and the `tasks-*` page rules not used by `TaskCard`, `CardMenu`, `TagFilter`), and the
command plumbing `ShellActions.taskCommand` / `taskCommandState` for the removed commands. `UiStateDto.tasks` /
`TasksUiDto` stay in the DTO (read by `adoptTasksUi`, kept in the file by `ui_state_set`). In Rust nothing is removed:
`tasks5a.rs` (`tasks`, `task_defs`, `daily_tasks`) stays.

## 29. Behaviour the contract fixes

### 29.1 The Tasks page (R204; D-1903)

- **Route**: `type/task` (TypePage + TypeViews). `tasks` and `tasks/kanban` are **aliases**: resolving one replaces
  the history entry by `type/task` (`history.replace`, no extra entry) with `Route.tab` = `Kanban` for `tasks/kanban`
  when a `views` name has its name key, else the remembered tab. Restored window tabs, pins and the route test hook
  resolve the same way. `route-ready:type/task` replaces `route-ready:tasks*`.
- **`Route.tab?: string`** (new route option, any `type/<key>`): TypeViews selects that view tab when listed (name
  key), and remembers it (`setLastTab`); not listed → the normal rule.
- **First open** (Task only, D-1903): `typeViews.lastTab` has **no** `task` key → the first view tab (`Schedule` on the
  overlay), else `All Tasks`. `lastTab.task === null` means `All Tasks` was chosen. Other types keep D-1765.
- **Header**: heading = the plural; under it `TasksSummary` (`tasks.summaryWeek`, CP-29) instead of
  `typePage.countPlural`; `Type settings` and `New Task` as every type page. The summary ignores the filters and follows
  `vault:changed` and the 30 s day check.
- **Sidebar**: `Tasks` opens `type/task` (the remembered tab) and is `aria-current="page"` there; its count is
  unchanged (`useTaskBadge`).
- **Back** from a card returns to `type/task` on the same tab with its folds, tag selection, the page's `scrollTop` and
  each `div.board-scroll`'s `scrollLeft` (kept in the history entry's state).

### 29.2 Tabs, toolbar, `New Task`

- Tabs and toolbar as part one §4.3 / R186: `Filter Tasks…`, `Filter by tag` (every tab and `All Tasks`), on boards the
  `Lanes` radiogroup, the sort button, `View actions`; on `All Tasks` `Columns`. Gone: `textbox` `Add a task…`, the
  date-filter `group`, the `Group by` and `Task views` tablists, the disabled `Sort`, `Show <n> more`.
- `New Task` (header, ⌘N › Task, palette `task.new`) navigates to `new/task` with no prefill; `status` comes from
  `newObject` (the first Open-state option, D-503). A lane's tile: `new/task` with `Route.prefill` (§29.3, part one
  §4.5). Nothing is written before the draft's first change.

### 29.3 Period boards (R203; D-1899, D-1900)

- **Labels** (AP-1536): `isTaskDue` = the grouping key is `due` and every type of the query is `task`. `period:today` →
  `board.period.today` (`Today & overdue`) when `isTaskDue`, else `board.period.todayEarlier`; `period:week` →
  `board.period.week`; `period:later` → `board.period.later`; `none` → `board.period.none` (`Not scheduled`) when
  `isTaskDue`, else part one's `board.none` with the attribute Name (`No Due date`); `done` → `board.done`, hint
  `board.doneHint` (`Completed in the last {count} days`). Day groups: `dayHeading`.
- **Drops**: on a period board with a date key, a drop target is a lane or a day group; a drop on the `week` lane outside
  its day groups (its heading) targets its first day group. The write is §26 with `dropFor` computed from the **bounds of
  the result the board shows** (the env sent with that run), so a drop just after midnight writes what the shown lanes
  say until the re-run. Same lane or day group, outside every target, Esc → nothing. Alt acts as a plain drag. Drop
  labels: `board.period.dropDate` (`Drop to set Due date: Fri 16 Oct`, the date via `shortDate`), `board.period.dropClear`,
  `board.dropDone`; out of the done lane onto a period target, `board.period.dropDate`.
- **Keyboard**: `Move card to next / previous lane` moves to `neighbourTarget` (`today` → each day group → `later` →
  `none` → `done`); horizontal ↑/↓ move between rows (lanes), ←/→ inside a row (part one §4.4).
- **`Move to ›`** on a period board lists `targets(group)` minus the card's own, day groups by their heading.
- **Date-time keys** (`created`, `modified`, a Date-time attribute; CP-25, D-1917): lanes and day groups aren't drop
  targets, tiles pre-fill nothing; the done lane still takes drops (status only).
- **Live region**: `board.moved` with the lane label or the day heading.
- **The card keeps its date** on a period board (the grouping key isn't hidden; R203 "The card").

### 29.4 The done lane and folds (R201, R206)

- On a horizontal board the done lane's initial fold is `doneLane.folded`; on a board grouped by `status`, `folded`
  applies to the Done-state option lanes. Folding stays horizontal-only (part one §4.4); in vertical mode those lanes
  show unfolded.
- `usageFolded[<usage key>]` holds the ids the user folded; for a lane whose initial fold is folded, `!<id>` records
  that the user unfolded it (`!done`, `!option:Done`). No entry → the initial fold.
- Expanding or folding writes only `ui-state.json` (one `ui_state_set`).

### 29.5 Cards (R205; D-1891, D-1904, D-1910)

- **Every card** shows its own type's `preview` keys in order (at most 4); a type without `preview` shows none. Pills,
  relation footer chips, `#tags`, two body lines, empty `No <Name>` pills as part one §4.3 (D-1793 layout). The grouping
  key is hidden except a multi-value one with ≥ 2 values (D-1769) and a period key (R203). `columns` on a board is never
  read, written or noticed; the board toolbar has no `Columns`; switching the view to Table uses `columns` again.
- **A Task card** (any board: tabs, blocks, `query/<name>`): `TaskCard` with `row.taskRow`, `result.taskDefs`,
  `preview` = Task's `preview`, `hideKey` = the grouping key (except a period key), the source chip always (FR-TSK-08),
  tags, two body lines (not on Done), `More actions` with R43's items plus `Move to ›` (and `Also add to ›` on a
  multi-value board). Task `preview` keys other than `status`, `priority`, `due` are pills (`pills`). The board's
  `article` attributes (part one §4.3) are on its root. Reading `taskRow` null (a Task row the core couldn't build) falls
  back to the generic card.

### 29.6 The tag filter (D-1892…D-1894, D-1908)

On every view tab and `All <plural>` of a type page with views; never on a query block (D-1894), the Queries page,
`query/<name>` or a Tag page. Options and counts by `tagOptions`; rows kept by `keepRow` together with the text filter and
the view's own filters (AND). The selection is stored per `tagFilterKey` (one `ui_state_set` per change), restored on every
mount; the text filter isn't stored. A selected tag no longer on any row stays a chip with `0`. Lanes and day groups
never disappear because of these filters (counts show the narrowed numbers); with nothing left, the `status`
`typePage.noMatch`.

### 29.7 Sort (D-1892, D-1895, D-1907)

- Tabs, Tasks views included: part two unchanged (sort popover, header click / ⇧-click, the usage write). On a board the
  effective sort orders every lane and day group alike, the done lane included (rows order, §24.4).
- `All <plural>`: `levelsOf(typeSort[<type>])`; header click / ⇧-click / ⏎ / ⇧⏎ by `sort.headerClick`; the sort button
  and popover (scope `sort.scope.thisMac`; `Clear` deletes the key → the page's default); each change one `ui_state_set`
  writing the whole list; `aria-sort` on the first level only, `aria-description` `sort.level` on the others; no vault
  write.

### 29.8 Width (D-1890, D-1909)

`.page-column.page-wide` (type pages on every tab, `queries`, `query/<name>`): `box-sizing: border-box; max-width:
1680px; margin-left: auto; margin-right: auto; padding-left: 40px; padding-right: 40px` (content box ≤ 1,600 px, equal
space on both sides). Boards and tables wider than it scroll inside their own scrollers; the page never scrolls
sideways. Notes unchanged.

### 29.9 The editor (R189 changes)

From `Schedule`: `Show` fixed to `Task`; the filter row `Status` `state is not` `Cancelled`; `View` Board; `Group by`
`Due date · by period`; the checkbox `Done in its own lane, last 7 days` checked; `Lanes` `Horizontal`; no `On cards`.
`Done` commits the shared keys through `query_apply` (§24.3). The done-lane checkbox isn't offered for Projekt / Book.

### 29.10 Type settings › Default views (FR-TYP-01 AC-11)

`type-settings/task` only: a section after the existing ones with the `button` `Restore default views`
(`restoreState`), description `typeSettings.restoreViewsHint` or, when disabled, the reason. Activating it (or the
palette) runs `restoreDefaultViews`. Restored tabs appear through the types store.

## 30. DOM, strings, UI state, commands

### 30.1 DOM (additions to part one §4.3 and part two §19.1)

| Part | Element | Name and attributes |
| --- | --- | --- |
| Period lane | `section[role=region]` | `aria-label` `<label>, <count>` (CP-28); `data-lane="period:today\|period:week\|period:later"`, `data-lane-kind="period"`, `data-drop-target`; header `h2` with `data-tone="danger"` on `period:today` when `isTaskDue`, `data-tone="muted"` on `none` |
| Day group | `div[role=group]` inside `period:week` | `aria-label` `<heading>, <count>`; `data-day="<YYYY-MM-DD>"`, `data-drop-target="true\|false"`; heading `h3.day-heading` (region-formatted, not `data-user-content`); an empty day shows only its heading |
| No-value lane | `section[role=region]` | `data-lane="none"`, `data-lane-kind="none"`, `data-drop-target="true"` on a date-key period board |
| Done lane | `section[role=region]` | `data-lane="done"`, `data-lane-kind="done"`, `data-color` (the Done option's colour), `data-folded` when folded; hint `p.lane-hint` (`board.doneHint`); fold `button` `board.expand` / `board.collapse` (`Expand Done`) with `aria-expanded`; no grip, no tile |
| Done-state option lane | `section[role=region]` | `p.lane-hint` `board.doneStatusHint` (`Last 7 days`) |
| Drop label | `div.board-drop` | `board.period.dropDate`, `board.period.dropClear`, `board.dropDone` |
| Board card | `article[data-board-card]` | pills `span.card-pill[data-attribute]` in `preview` order; never one from `columns` |
| Task card on a board | `article[data-board-card][data-task-card]` | `aria-label` `board.card` (`Task: <title>`); ms5-tasks D-509 hooks (`data-status`, `data-priority`, due chip `data-due` / `data-tone`), checkbox `task.complete`, source chip, `button` `task.more` |
| Tasks summary | `p.type-page-count[data-tasks-summary]` | `tasks.summaryWeek` |
| Tag filter | toolbar `button` `tasks.tagFilter` | on `All <plural>` too (`data-command="views.tagFilter"`); chips and options `data-tag="<key>"` (ms5-tasks §12.1) |
| `All` sort | `button` `sort.button` in the `All <plural>` toolbar | part one's sort button; popover `p.sort-scope[data-scope="thisMac"]` |
| Wide page | `div.page-column.page-wide` | §29.8 |
| Editor | `combobox` `query.editor.groupBy` | period `option`s `query.editor.groupByPeriod` with `data-group-by="<key>"` and `data-period`; done-lane `input[type=checkbox][data-done-lane]` named `query.editor.doneLane`; operator options `query.op.state_is`, `query.op.state_is_not` |
| Default views | `section[aria-labelledby]` in `type-settings/task` | heading `h2` `typeSettings.defaultViews`; `button` `typeSettings.restoreViews`, `data-command="types.restoreDefaultViews"`, `aria-description` hint or reason, `aria-disabled` when disabled |
| Live region | `div.sr-live` | `board.moved`, `board.added`, `typeSettings.restoredViews`, once each |

### 30.2 Strings (R207; NFR-OTH-02 AC-23)

New keys in `app/ui/src/i18n/catalog.ts`, R207's English texts unless a CP says otherwise:

`tasks.summaryWeek` `{open} · {overdue} · {done}` with the plural messages `tasks.summary.open`, `tasks.summary.overdue`
(kept) and new `tasks.summary.doneWeek` `{ one: '{count} done this week', other: '{count} done this week' }` (CP-29,
D-1921) · `board.period.today` · `board.period.todayEarlier` · `board.period.week` · `board.period.later` ·
`board.period.none` · `board.period.dropDate` · `board.period.dropClear` · `board.done` · `board.doneHint` (plural) ·
`board.doneStatusHint` (plural) · `board.dropDone` · `board.laneCountOf` `{ one: '{count} {name}', other: '{count}
{plural}' }` (CP-28, D-1920) · `query.editor.groupByPeriod` · `query.editor.groupByPeriodHint` ·
`query.editor.doneLane` (plural) · `query.op.state_is` `state is`, `query.op.state_is_not` `state is not` (CP-30,
D-1922) · `sort.scope.thisMac` · `typeSettings.defaultViews` · `typeSettings.restoreViews` ·
`typeSettings.restoreViewsHint` · `typeSettings.restoreViewsNone` · `typeSettings.restoredViews` ·
`cmd.restoreDefaultViews`.

**Removed** (CP-30, D-1922: R207's list made exact): `tasks.title`, `tasks.summary`, `tasks.summary.today`,
`tasks.views`, `tasks.view.schedule`, `tasks.view.kanban`, `tasks.view.all`, `tasks.groupBy`, `tasks.group.status`,
`tasks.group.tag`, `tasks.group.overdue`, `tasks.group.today`, `tasks.filter`, `tasks.filter.all`, `tasks.filter.today`,
`tasks.filter.week`, `tasks.section.today`, `tasks.section.week`, `tasks.section.later`, `tasks.section.none`,
`tasks.section.done`, `tasks.hint.today`, `tasks.hint.week`, `tasks.hint.later`, `tasks.hint.none`, every `tasks.add`
key (`tasks.add`, `.example`, `.due`, `.noDue`, `.priority`, `.noPriority`, `.clearDue`, `.clearPriority`, `.hotkey`,
`.noTitle`, `.today`, `.week`, `.none`, `.dueToday`; the capture window uses none of them), `tasks.column.add`,
`tasks.column.noTag`, `tasks.column.noStatus`, `tasks.column.empty`, `tasks.column.drag`, `tasks.column.moved`,
`tasks.column.cantMove`, `tasks.drop.status`, `tasks.drop.tag`, `tasks.board.hintStatus`, `tasks.board.hintTag`,
`tasks.moved`, `tasks.created`, `tasks.sort`, `tasks.sort.schedule`, `tasks.sort.kanban`, `tasks.doneMore`,
`tasks.newIn`, `cmd.tasks.groupStatus`, `cmd.tasks.groupTag`, `cmd.tasks.filterAll`, `cmd.tasks.filterToday`,
`cmd.tasks.filterWeek`, `cmd.tasks.add`, `cmd.tasks.columnLeft`, `cmd.tasks.columnRight`, `cmd.task.moveNext`,
`cmd.task.movePrevious`, `query.editor.onCards`, `query.editor.onCardsChange`.

**Kept and reused**: `tasks.tagFilter` and the other `tasks.tag*` keys of D-518, `tasks.summary.open`,
`tasks.summary.overdue`, `cmd.goto.tasks`, `cmd.tasks.schedule`, `cmd.tasks.kanban`, `cmd.tasks.search`,
`cmd.task.complete`, `cmd.task.setStatus`, every `task.*` key, `state.*`, `board.*`, `views.*`, `sort.*`,
`typePage.filter`, `typePage.noMatch`, `queries.trashed`, `views.changedOutside`, `trash.removeFailed`, the route
names. Plurals per D-133 (`Intl.PluralRules`).

### 30.3 UI state (R206; D-1893, D-1907; FR-STO-07 AC-12)

`UiStateDto` (Rust `#[serde(default, skip_serializing_if = …)]`, `version` stays 1):

```ts
tagFilter?: Record<string /* `tab:<type key>/<name key>` | `all:<type key>` */, string[] /* tag keys, NFC, lower case */>;
typeSort: Record<string /* type key */, SortDto[] | TypeSortDto /* 0.4.x: { column, dir }, read as one level */>;
usageFolded?: Record<string, string[]>;   // part two; entries may be `!<lane id>` (§29.4)
```

- Rust: `type_sort: BTreeMap<String, TypeSortValue>` with `#[serde(untagged)] enum TypeSortValue { Levels(Vec<SortDto>),
  One(TypeSortDto) }`; the UI always writes `Levels`. (A 0.4.x build reading a list fails on that key; downgrades are
  out of scope.)
- `tagFilter` keys use part two's usage-key rule for tabs (`tab:task/schedule`, `tab:book/rozečtené`) plus `all:<type>`;
  `moveQueryState(from, to)` renames tab keys whose name key is `from`'s (after the rename job's `done` and its Undo).
- **`adoptTasksUi(ui)`** (pure, `views/uiState.ts`), applied once at UI-state load when `ui.tasks` exists and
  `ui.typeViews?.lastTab` has no `task` key: `lastTab.task` = `Schedule` / `Kanban` / `null` for `tasks.view`
  `schedule` / `kanban` / `all`; `tasks.doneExpanded` true → `!done` in `usageFolded["tab:task/schedule"]`; the grouping,
  date filter and tag selection are dropped; `ui.tasks` stays in the file unchanged. One `ui_state_set`.
- Nothing of this is in the vault (FR-STO-07).

### 30.4 Commands (R207; D-1771, D-1905)

Palette only, no shortcut, `needsVault: true`:

| Id | Title key | Listed when | Does |
| --- | --- | --- | --- |
| `tasks.go` (kept) | `cmd.goto.tasks` | anywhere | `go({ id: 'type/task' })` |
| `tasks.schedule`, `tasks.kanban` (kept ids; CP-30) | `cmd.tasks.schedule`, `cmd.tasks.kanban` | `task.yml`'s `views` has that name key | `go({ id: 'type/task', tab })` |
| `tasks.search` (kept id; CP-30) | `cmd.tasks.search` | anywhere | `type/task` (opened when elsewhere), focus the current tab's `Filter Tasks…` |
| `task.complete`, `task.setStatus` (kept) | `cmd.task.complete`, `cmd.task.setStatus` | a Task card focused on any board | as tasks.md R45, through §26's queue |
| `types.restoreDefaultViews` (new) | `cmd.restoreDefaultViews` | `type/task`, `type-settings/task` | `restoreDefaultViews`; `disabled` = `restoreState().reason` |
| removed | — | — | `tasks.groupStatus`, `tasks.groupTag`, `tasks.filterAll`, `tasks.filterToday`, `tasks.filterWeek`, `tasks.add`, `task.moveNext`, `task.movePrevious`, `tasks.columnLeft`, `tasks.columnRight` (part one's `board.cardNext` / `board.cardPrevious` / `board.lane*` do their work) |

`ViewsStatus.board` (part one §4.7) gains `taskFocused: boolean`. ⌥←/⌥→ do nothing on boards (D-1905).

### 30.5 Performance marks

Part one §4.8 unchanged: `board-request` / `board-ready` per Schedule and Kanban selection, `board-card-moved` when a
period-dragged card is in its target lane's or day group's DOM (NFR-PERF-07 AC-5). `route-ready:tasks*` are no longer
written.

## 31. Fake core, test hooks, tests and expected bytes

### 31.1 Fake core and hooks

- `app/ui/test/fake-queries.ts`: §24 (the group mapping and `done_lane` reads and writes, `ORDER`, removal, `columns` on
  create, state operators, hidden lanes, strict Date sort, period lanes with day groups using `queries/board/period.ts`,
  the done lane, `uses_relative`), `QueryRowDto.tags`, `taskRow` (from `fake-tasks.ts`'s row builder),
  `QueryResultDto.taskDefs`. Checked against Rust on `expected-views-tasks.json` (L3,
  `app/test/fake_views_tasks.contract.test.ts`, not an AC test).
- `fake-schema.ts`: `viewsSource` with `''` removes the key. `index_type_rows` rows gain `tags`.
- `task_views_restore` over the fake's files (§25.3 rules, `default_task_view` bytes from the fake's `create_text`).
- **Migration**: `FakeOptions.taskViews?: boolean` (default false, D-1913): when true the fake runs §25.2 on the launch
  vault before the first command answers, and in `vault_open` / `vault_create`. `FakeVault` copies without it never
  change.
- `ui_state_set` stores `tagFilter` and list `typeSort`, keeps `tasks`.
- Handle: the existing `calls()`, `writes()`, `writesTo()`, `typeCalls()`, `queryRuns()`, `moves()`, `setFile(…, {
  silent: true })`, `writeControl({ path })`, `delayCommand`, `perfMarks()` cover Q2-T. No new clock hook: the clock and
  the zone come from `__TEGG_NOW__` / `__TEGG_TZ__` (D-504, D-509), as in 5A (midnight and zone changes included).
- `window.__TEGG_TEST__.board()`: lanes gain `days: { date: string; cards: string[] }[]` and `folded: boolean`.
- **Rust hooks**: `TEGG_TEST_TASK_VIEWS=1` (with `TEGG_TEST=1`) turns the migration on in the app (D-1913). The L4 kill
  harnesses re-run the test binary as a child (as `ac_views_writes.rs`): `TEGG_TASKS_KILL_CHILD`, `TEGG_TASKS_KILL_READY`,
  `TEGG_TASKS_KILL_KIND` = `migrate` (FR-QRY-07 AC-29: `Core::task_views_migrate` on the base fixture, 200 runs; the "`task.yml` changed
  between the creates and the `views:` write" part is 40 trials with a concurrent writer: never a lost update, the next run
  writes the line on top, D-1927),
  `period` (FR-SYN-02 AC-13: alternating `Core::note_write` of Zalít květiny's fixture bytes and
  `expected/views-tasks/tasks/zalit-kvetiny-no-due.md`), `restore` (alternating `Core::task_views_restore` and its Undo
  through `Core::type_patch` + `Core::query_trash` on the overlay after trashing `Kanban`).
- L6: `TEGG_TEST=1`, `TEGG_NOW`, `TZ`, a temporary Application Support, `TEGG_TEST_TASK_VIEWS=1` only in the migration
  tests; keys only to Tegg (D-799).

### 31.2 Test files per criterion

| Criterion | L1 | L2 / L3 | L4 | L5 | L6 |
| --- | --- | --- | --- | --- | --- |
| FR-TSK-04 AC-22 | | | | `app/webkit/views_tasks_page.ac.test.ts` | `app/e2e/views_tasks.ac.test.ts` |
| AC-23 | `app/test/views_tasks_model.ac.test.ts` (`period.ts` table, both regions and zones) | L3 | `crates/tegg-core/tests/ac_views_tasks.rs` | `app/webkit/views_tasks_schedule.ac.test.ts` | |
| AC-24 | | | `ac_views_tasks.rs` | `views_tasks_schedule` | `views_tasks.ac.test.ts` |
| AC-25 | `packages/doc/test/task_period_move.ac.test.ts` | | `ac_views_tasks.rs` (`note_write` base) | `views_tasks_schedule` | `views_tasks.ac.test.ts` |
| AC-26 | | | `ac_views_tasks.rs` | `app/webkit/views_tasks_queries.ac.test.ts` | |
| AC-27 | | | `ac_views_tasks.rs` (watcher) | `views_tasks_schedule` | |
| AC-28 | `views_tasks_model` (`tagOptions`) | | | `views_tasks_schedule` | `views_tasks.ac.test.ts` |
| AC-29 | | | | `views_tasks_page` | |
| FR-TSK-05 AC-19 | | | `ac_views_tasks.rs` | `app/webkit/views_tasks_kanban.ac.test.ts` | |
| AC-20 | `task_period_move` (status bytes) | | `ac_views_tasks.rs` (`Kanban.yml`) | `views_tasks_kanban` | |
| AC-21, AC-22 | (AC-21 bytes: part one's `board_move`) | | | `views_tasks_kanban` | |
| FR-TSK-10 AC-13 | `app/test/quick_add.ac.test.ts` (unchanged) | | `ac_views_tasks.rs` (first write) | `views_tasks_page` | |
| FR-QRY-07 AC-27, AC-28 | | | `ac_views_tasks.rs` | `views_tasks_page` (fake `taskViews`) | AC-28: `views_tasks.ac.test.ts` |
| AC-29 | | | `ac_views_tasks.rs` (harness `migrate`) | | |
| AC-30 | `views_tasks_model` | | | `app/webkit/views_tag_filter.ac.test.ts` | `views_tasks.ac.test.ts` |
| FR-TYP-01 AC-11 | | | `ac_views_tasks.rs` (`SetViews`, `SetViewsSource('')` bytes through `Core::type_patch`; no `tegg-schema` file, D-1925) | `views_tasks_queries` | |
| FR-QRY-01 AC-17 | `views_tasks_model` (`periodChoices`) | | `ac_views_tasks.rs` | `views_tasks_queries` | |
| AC-18 | | `crates/tegg-core/tests/ac_views_tasks_props.rs` (oracle); L3 | `ac_views_tasks.rs` | | |
| AC-19 | | | (none: the `views:` item bytes are Q2.1's, already green; D-1925) | `views_tasks_queries` | |
| AC-20 | `views_tasks_model` (`allSort`) | | | `views_tag_filter` | |
| FR-QRY-02 AC-9 | `views_tasks_model` (`stateOps`) | | `ac_views_tasks.rs` | | |
| FR-QRY-05 AC-28 | | | `ac_views_tasks.rs` (bytes kept, create) | `app/webkit/views_cards.ac.test.ts` | |
| AC-29 | (none, D-1927) | | | `views_cards` | |
| FR-QRY-08 AC-3 | `views_tasks_model` (`prefillFor`) | | `ac_views_tasks.rs` (first write) | `views_tasks_schedule` | |
| FR-TYP-09 AC-36 | | | | `app/webkit/views_width.ac.test.ts` | |
| FR-FMT-07 AC-35 | | `ac_views_tasks_props.rs` | `ac_views_tasks.rs` | | |
| FR-FMT-12 AC-14 | `task_period_move` | | `ac_views_tasks.rs` | `app/webkit/views_tasks_writes.ac.test.ts` | |
| FR-SYN-02 AC-13 | | | `ac_views_tasks.rs` (harness `period`, `restore`) | | |
| FR-SYN-03 AC-32 | | | `ac_views_tasks.rs` | `views_tasks_writes` | |
| FR-SYN-06 AC-50 | | | | `views_tasks_writes` (counts) | `views_tasks.ac.test.ts` |
| FR-STO-07 AC-12 | `views_tasks_model` (`adoptTasksUi`) | | | `views_tag_filter` | `views_tasks.ac.test.ts` |
| NFR-PERF-07 AC-5 | | | `crates/tegg-core/tests/ac_views_tasks_perf.rs` (`nfr_perf_07_ac5_tasks_boards`, skipped at push; nightly `core-perf-ac`, D-1927) | | `app/e2e/nfr_perf_07_tasks_board.ac.test.ts` (nightly) |
| FR-UX-03 AC-53 | `app/test/views_tasks_registry.ac.test.ts` | | | `app/webkit/views_tasks_a11y.ac.test.ts` | |
| FR-UX-05 AC-25, FR-UX-08 AC-25 | | | | `views_tasks_a11y` | AC-25 (UX-08): `views_tasks.ac.test.ts` |
| NFR-OTH-02 AC-23 | `views_tasks_registry` (catalog) | | | `views_tasks_a11y` (pseudo-locale) | |
| F3 bug | | | | `app/webkit/views_board.ac.test.ts` `bug_q2t_fr_qry_07_multi_lane_card_links_resolve` (red first) | |
| FR-QRY-07 AC-31 | manual (`qa/manual/`) | | | | |

Test names are the ACs' (`fr_tsk_04_ac22_header_tabs_and_toolbar`, …), the same name in each layer's file. Helpers:
`app/webkit/views-tasks-helpers.ts` (base / overlay copies, the clock, regions, zones). No new `qa.config.json` step; the
nightly `core-perf-ac` step gains `ac_views_perf.rs` and `ac_views_tasks_perf.rs` (D-1927). The Rust tests compile against
a compile-only stubs commit made before the red commit (D-1926). The tests of the change table change in a commit right
after the red commit, not in the build commit (D-1928, amends D-1912).

### 31.3 L3 corpus (`tests/fixtures/queries-files/expected-views-tasks.json`)

`reads`: the §2 `QueryDefDto` of the overlay's four query files and of FR-QRY-01 AC-18's runtime variants (each given
as `{ name, text, def, broken }`); `groups`: `[{ query, env: { today, zone, weekStart, locale }, kind, lanes: [{ id,
dropTarget, doneWithin, paths, days: [{ date, paths }] }] }]` for R208's Schedule, Kanban and Projekty boards (`cs` and
`en-US`, Prague and Los Angeles, the Sunday clock of AC-23); `filters`: FR-QRY-02 AC-9's results. Read by
`ac_views_tasks.rs`, `app/test/views_tasks_model.ac.test.ts` (the `period.ts` part) and
`app/test/fake_views_tasks.contract.test.ts`.

### 31.4 Expected bytes (`tests/fixtures/queries-files/expected/views-tasks/`, README there)

Written with the red tests by the test author. Clock `2026-10-14T12:00:00+02:00` (Europe/Prague, `cs`) unless named;
inputs the base fixture (`base`) or the overlay. Byte rules as `expected/` (LF, final newline; `-crlf`, `-no-newline`
variants). `tasks/` hold whole files after the write, `modified:` per the clock.

| File | Input → action | Criteria |
| --- | --- | --- |
| `queries/schedule-default.yml`, `queries/kanban-default.yml` | R202 with `<stamp>` the clock | FR-QRY-07 AC-27, AC-28, FR-TYP-01 AC-11 |
| `types/task-migrated.yml` | base `task.yml` + line 11 `views: [Schedule, Kanban]` | FR-QRY-07 AC-27, AC-28 |
| `types/task-builtin-migrated.yml` | no `task.yml`: the built-in file + the line | AC-28 (a) |
| `types/task-overlay-without-kanban.yml`, `types/task-overlay-without-schedule.yml` | overlay; `Move to trash` on `Kanban`; `Remove from Tasks page` on `Schedule` | FR-TYP-01 AC-11 (the restore of either gives the overlay's `task.yml`) |
| `types/task-overlay-schedule-sort-title.yml` | overlay; `Schedule` one level `Title A → Z` | FR-QRY-01 AC-19 |
| `types/task-overlay-kanban-add-title.yml` | overlay; `+ Add sort` on `Kanban` | AC-19 |
| `queries/schedule-no-done-lane.yml`, `queries/schedule-done-lane-again.yml` | overlay; uncheck, then check the done lane | FR-TSK-04 AC-26 |
| `queries/schedule-lanes-vertical.yml` (+ `-crlf`, `-no-newline`) | `Switch lanes` | FR-FMT-07 AC-35 |
| `queries/kanban-lane-order-waiting.yml`, `queries/kanban-lane-order-reset.yml` | `Waiting` before `To do`; then `Reset lane order` | FR-TSK-05 AC-20 |
| `queries/projekty-group-created.yml` | `Created · by period`, `Done` (comment kept) | FR-QRY-01 AC-17 |
| `../views/new-view-board-book.yml` (part one's file) | its `columns:` line goes (D-1910); changed in the build commit with a `Fixture-Change:` trailer (D-1927; not by the red tests) | FR-QRY-05 AC-28 |
| `tasks/precist-knihu-due-16.md` | T08 onto `pátek 16.` | FR-TSK-04 AC-25 (a) |
| `tasks/obnovit-pas-due-14.md`, `tasks/obnovit-pas-due-14-la.md` | T07 onto `Today & overdue` (Prague; Los Angeles `modified …T03:00:00-07:00`) | (b) |
| `tasks/zalit-kvetiny-due-19.md`, `tasks/zalit-kvetiny-due-18-en-us.md` | T03 onto `Later` | (c) |
| `tasks/koupit-darek-no-due.md` | T04 onto `Not scheduled` | (d) |
| `tasks/poslat-rozpocet-done.md` | T02 onto `Done` | (e) |
| `tasks/vratit-knihy-reopened.md` | T12 from `Done` onto `Today & overdue` | (f) |
| `tasks/spatne-datum-due-15.md` | T16 onto `čtvrtek 15.` | (g) |
| `tasks/zalit-kvetiny-no-due.md` | T03 onto `Not scheduled` (the kill harness's second text) | FR-SYN-02 AC-13 |
| `tasks/nakup-later.md` | T19 (NFD title) onto `Later` | FR-FMT-12 AC-14 |
| `tasks/zavolat-do-servisu-new.md` | `New Task`, title, ⏎: the whole file without its generated `id:` line (tests remove that line and compare; D-1927, RT-6) | FR-TSK-10 AC-13 (a) |
| `projekty/zahrada-later.md`, `projekty/web-no-due.md` | Zahrada onto `Later`; Web onto `No Due date` | FR-QRY-01 AC-17 |

Status-drag bytes on Kanban are tasks.md FR-TSK-05 AC-2's (existing L1 texts); tag-drag bytes part one's `board_move`.

## 32. Owner decisions

### 32.1 Contract choices (no owner decision needed; follow the ACs and precedents)

1. The query model is extended in place again (`group_period`, `done_lane`, `Op::StateIs` / `StateIsNot`, lane kinds
   `Period`, `Done`, `DayGroup`); no Tasks-specific query type.
2. "Carries states" = a Select with at least one option of a known state; the done lane also needs a Done-state option
   (otherwise there is nothing for it to hold and nothing a drop could write).
3. Done rows outside `within_days` leave `rows` in the core, so lanes, counts and tag options agree.
4. Period lanes keep part one's id scheme (`period:<id>`, `none`, `done`; days `day:<date>`); `lane_order` stores the bare
   ids `today`, `week`, `later`.
5. A drop computes its date from the bounds of the result on screen, never from a later clock.
6. A Task card on a board is `tasks/TaskCard.tsx` driven by `preview`; all writes from a board go through one per-object
   queue (`writeCardChange`).
7. Status moves on a `status` that carries states use the D-472 status change (completed set / removed), as the 5A
   Kanban did; other boards keep `applyBoardMove`.
8. The tag filter counts **rows** (objects), not lane cards: a book in two lanes counts once (D-518 counted tasks).
9. Folding stays horizontal-only; an initially folded lane is unfolded by a `!<id>` entry.
10. `typeSort` values become a list (R206, FR-QRY-01 AC-20) through an untagged enum that still reads 0.4.x values.
11. `Route.tab` is a general route option, so commands, aliases and pins open a type page on a named tab.
12. `SetViewsSource('')` removes the `views` key: the only way an Undo can return to "no key".

### 32.2 Contract decisions (CP-22…CP-31 → D-1914…D-1923, decided 2026-11-20)

Each point was decided as recommended (option (a)); the alternatives are kept for the record.

| # | Question | Options | Decision |
| --- | --- | --- | --- |
| CP-22 → D-1914 | **Where period lanes are computed.** Part one groups in the core ("the UI never re-groups"), but FR-TSK-04 AC-23 asks for an L1 test of "the bucketing table", and drops, tiles and day headings need the bounds in the UI. | (a) The core groups (`group` with `QueryEnv`); a pure TS twin `queries/board/period.ts` gives bounds, `periodOf`, drop dates, prefills, headings and keyboard targets; the fake core groups with it; L3 ties both to one corpus. (b) Core only; the UI asks nothing of dates; AC-23's L1 layer becomes the drop / prefill table only. (c) The UI buckets (as 5A's `views.ts`); the core returns rows (query blocks and `query/<name>` would need the UI too). | **(a)**, as recommended |
| CP-23 → D-1915 | **How a period grouping is stored in `QueryDef` / `QueryDefDto`.** Every new field changes struct literals in Q / Q2 tests (type-only, D-1912), but the type of `group_by` itself needn't change. | (a) Flat: `group_by` stays the key, new `group_period: bool` (`groupPeriod`). (b) `group_by: Option<GroupBy>` enum (`Key` / `Period`), DTO `groupBy: string \| { key; period: true }` (every `group_by` literal and `groupBy` reader changes). (c) A string encoding `due:period`. | **(a)**, as recommended |
| CP-24 → D-1916 | **Where a board's Task card gets R43's data** (checkbox state, `statusKnown`, priority rank, due label, source chip, `completed`). `QueryRow` has only `TaskBits { status, state, due }`. | (a) `QueryRowDto.taskRow: TaskRowDto \| null` and `QueryResultDto.taskDefs` from the core's 5A row builder (one index read). (b) The board joins `task_list` by path (a second request and a second source that can disagree for a moment). (c) Grow `TaskBits` to a full row (changes slice Q's tests). | **(a)**, as recommended |
| CP-25 → D-1917 | **Drops on a period board grouped by a Date-time attribute, `created` or `modified`.** R203 says a drop writes `<key>: <date>`; a Date-time needs a time and offset (FR-FMT-11), `modified` is rewritten by every write, and `created` is an identity date. ACs only drag `due` (Date). | (a) Only Date keys accept drops and pre-fill tiles; Date-time keys draw read-only period lanes (no drop target, tiles without pre-fill); the done lane still takes drops. (b) Date-time writes the local midnight with offset (or keeps the old time of day); `created` writable, `modified` not. | **(a)**, as recommended |
| CP-26 → D-1918 | **Who runs `Restore default views`.** R202 needs the default bytes (the migration's, in Rust), exclusive creates, the `views:` insert rule and one Undo. | (a) A core command `task_views_restore(base, now)` (creates, then `views:`), returning what it did; the UI's Undo uses `type_patch` `viewsSource` then `query_trash`. (b) The UI only, through `query_create` + `type_patch`, with a TS copy of the default defs. (c) Core restore and a core undo command. | **(a)**, as recommended |
| CP-27 → D-1919 | **Where the migration runs.** `Core::open` is zero-write today; D-1913 gates it in tests. | (a) `Core::task_views_migrate(now)`, called by the app's `open_vault` for a newly opened core before it returns (so `vault_create` gets it too), gated by `TEGG_TEST` / `TEGG_TEST_TASK_VIEWS`; L4 calls it directly. (b) Inside `Core::open` (every L4 test opening a core would need a gate). (c) The UI calls an IPC after `vault_open` (the page can render before the views exist). | **(a)**, as recommended |
| CP-28 → D-1920 | **Lane counts on Task boards.** FR-UX-08 AC-25 reads `<label>, <n> tasks` "the Task plural as written"; part one's lanes read `Reading, 3 cards` (`board.laneCount`). The plural as written has no singular and is capitalised (`Tasks`). | (a) New `board.laneCountOf` `{ one: '{count} {name}', other: '{count} {plural}' }` with the type's Name / plural as written on single-type boards (`Today & overdue, 4 Tasks`, `1 Task`), `board.laneCount` (`cards`) with several types; day groups the same; AC text reads `Tasks`. (b) `cards` everywhere; AC-25 amended. (c) A Task-only catalog text `{count} tasks` (not user content). | **(a)**, as recommended |
| CP-29 → D-1921 | **The summary string.** R207 gives `tasks.summaryWeek` as one text with three plural counts; one catalog message can't carry three plural forms, and D-505 solved the same for `tasks.summary`. | (a) `tasks.summaryWeek` `{open} · {overdue} · {done}` built from `tasks.summary.open`, `tasks.summary.overdue` (kept) and new `tasks.summary.doneWeek`; NFR-OTH-02 AC-23 checks the composed English. (b) One key with R207's literal text and ICU-style plurals (a new message format in the catalog). | **(a)**, as recommended |
| CP-30 → D-1922 | **R207 / R208 names that don't match the code** (AC fixes). (1) Operator keys: the editor renders `query.op.<yaml op>` (`query.op.is_not`), R207 says `query.op.stateIs`. (2) Command ids "kept" in R207 are `tasks.showSchedule`, `tasks.showKanban`, `tasks.filter`; the existing ids are `tasks.schedule`, `tasks.kanban`, `tasks.search` (D-1284). (3) R207's removed list misses keys that lose their last user (`tasks.title`, `tasks.summary`, `tasks.summary.today`, `tasks.add.dueToday`, `tasks.column.cantMove`, `tasks.sort*`, `tasks.doneMore`, `tasks.newIn`, the removed commands' `cmd.*`). (4) R208 / FR-TSK-04 AC-22 show the sort button as `Due ↑`; the button uses the attribute Name (`Due date ↑`, as AC-19's popover). | (a) Fix the ACs to the code: `query.op.state_is` / `query.op.state_is_not`; keep the three ids; §30.2's explicit removed list; `Due date ↑`. (b) Rename the code to R207's names (catalog op keys stop following the YAML names; three command ids and their tests change). | **(a)**, as recommended |
| CP-31 → D-1923 | **Invalid dates in sorts.** R203 says "an invalid date sorts with the empty values" inside a lane, but R208 also needs it on the Kanban (T17's date-time `due` sorts after T08 in `To do`), which isn't a period board. Today a Date attribute sorts any instant. | (a) A Date attribute's sort key is its valid `YYYY-MM-DD` only, in every query view; filters unchanged. (b) Only on boards. (c) Also make Date filters strict (a wider slice Q change). | **(a)**, as recommended |

### 32.3 Red-test decisions (RT points → D-1924…D-1928, decided by the owner 2026-11-20)

| Decision | |
| --- | --- |
| D-1924 | The change table (views.md part three) also covers the tests that open the Tasks page on a vault without views (route only, the default views added to the vault, `withTaskViews()`), `tasks_type_settings` AC-2…AC-4, `focus_indicator`'s old-blue test, and the L1 tests of removed 5A functions (deleted; their ACs keep their L5 tests) |
| D-1925 (RT-2) | No `crates/tegg-schema/tests/ac_views_tasks_type_file.rs`: its bytes were already right (Q2.1), so it couldn't be red; `ac_views_tasks.rs` `fr_typ_01_ac11_restore_default_views` checks them through `Core::type_patch`. FR-QRY-01 AC-19's item bytes stay checked at L5 |
| D-1926 (RT-1) | The Rust red tests compile against a compile-only stubs commit of §24.1 and §25 (`Op::StateIs` / `StateIsNot`, `DoneLane`, `QueryDef.group_period` / `done_lane`, `LaneKind::Period` / `Done`, `DayGroup`, `Lane.days` / `done_within`, `GroupKind::Period`, `QueryRow.tags` / `task_row`, `QueryResult.task_defs`, `taskviews`, `Core::task_views_migrate` / `task_views_restore`), made before the red commit as D-1813; stubs return wrong values or `NotImplemented`, never panic The stubs' type-only edits of slice Q tests (`crates/tegg-core/tests/queries_setup/mod.rs`, `ac_queries_props.rs`) go with the stubs commit |
| D-1927 (RT-3…RT-11) | NFR-PERF-07 AC-5's L4 benchmark is the new `ac_views_tasks_perf.rs`; it and `ac_views_perf.rs` run in the nightly `core-perf-ac` step. FR-QRY-05 AC-29 has no L1. A missing `columns` reads as §24.2 says. The new task's expected file is the whole file without `id:`. `new-view-board-book.yml` changes in the build commit. `weekStart` is `getDay` numbering; `targets()` / `neighbourTarget()` use `{ lane, day }`. `tagOptions` / `keepRow` NFC-normalise the selection; selected tags with 0 rows stay listed. The migration race is 40 trials with a concurrent writer. A missing `created` / `modified` has no date. Part B's assumptions hold: T15 shows no status chip in its unknown-value lane; "no history entry" is checked by `history.length`; day headings come from `Intl`; tag lanes are named by the tag; the done lane's heading uses `--type-green`; Preview and option changes are made by external `setFile` edits; the fake `vault_create` gives `task-migrated.yml`; alias rows keep the boards `Tasks`, `TasksBoard` |
| D-1928 | The existing tests of the change table (views.md part three) change in a commit right after the red commit, not in the build commit (amends D-1912 and §31.2) |
