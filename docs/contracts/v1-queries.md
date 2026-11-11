# Contract: Saved queries and the query block (v1.0 slice Q)

Public interfaces of slice Q, for the test author (D-61) and the build. ACs: `docs/acceptance/queries.md` (R138…R146;
FR-QRY-01 AC-1…AC-7, FR-QRY-02 AC-1…AC-8, FR-QRY-03 AC-1…AC-6, FR-QRY-05 AC-1…AC-9, FR-QRY-06 AC-1…AC-21, FR-QRY-08
AC-1, FR-QRY-09 AC-1…AC-5, FR-FMT-06 AC-4…AC-6, FR-TPL-04 AC-1, AC-2, FR-EDT-02 AC-24, AC-25, FR-STO-06 AC-3, FR-NAV-04
AC-12, FR-HOM-02 AC-28…AC-31, FR-LNK-03 AC-23, FR-SYN-02 AC-10, FR-SYN-03 AC-28, AC-29, FR-SYN-06 AC-44, FR-FMT-07
AC-29, AC-30, FR-FMT-12 AC-9, NFR-POR-01 AC-5, NFR-PERF-05 AC-5, NFR-PERF-07 AC-2, NFR-PERF-08 AC-2, FR-UX-03 AC-41,
AC-42, FR-UX-08 AC-18, FR-UX-05 AC-20, NFR-OTH-02 AC-17). Decisions: AP-1290…AP-1304 = D-1433…D-1447 (BRD v1.155);
this contract's own choices are §8 (proposed D-1448…D-1490). Boards: `design/edit-note-page/QueriesAll.dc.html`,
`QueryPage.dc.html`, `QueryBlock.dc.html` (A–G) and their `Dark` variants. Fixtures: `tests/fixtures/vaults/queries/`
and `tests/fixtures/queries-files/` (each with its README). Precedents followed wherever the ACs leave room: the pins
file ([v1-pinned.md](v1-pinned.md) §1), graph presets ([v1-graph.md](v1-graph.md) §16), type columns
([type-columns.md](type-columns.md)), the jobs ([ms4-jobs.md](ms4-jobs.md) §2–§8, §14.5) and tags
([ms4-tags.md](ms4-tags.md)). Where this contract and the ACs disagree, the ACs win and this contract is corrected
before the red tests; §9 lists the ACs that can't hold as written.

**What Q writes.** Query files `.tegg/queries/<name>.yml` (create, commit, header sort, Columns, duplicate, rename, the
4C / 4E-1 link patch), moves of query files into and out of `.trash/.tegg/queries/`, the notes whose fence a user action
changes (insert, `Choose a query…`, `Save as query…`, the rename job's `saved:` patch, delete by the user), and
`.tegg/pinned.yml` (pin, unpin, move, the rename job's `query:` patch). Machine-local: `ui-state.json` (`queries.sort`,
§4.6). Nothing else, and never a note's bytes when a block is only shown, run, or its query edited (FR-SYN-06 AC-44).

## 1. The queries module (`tegg-core`, AR-03)

A new module `crates/tegg-core/src/queries_q.rs`, `pub mod queries_q` in `lib.rs` (as `pinned`), platform-neutral: no
Tauri or desktop dependency, files through `Vault`, the index through the core's lock. No query definition is stored in
the index (AR-01, FR-STO-06 AC-3); the index stores only the `saved:` names of each note's fences (§1.3), rebuilt from
files. Values and the first YAML document come from `yaml_rust2` and `crate::yaml_text` (`top`, `scalar`); the line
scanner, `open_flow_line`, `split` / `join` / `file_eol` come from `graph_presets.rs` (made `pub(crate)` where needed).

### 1.1 Types

```rust
pub const QUERIES_DIR: &str = ".tegg/queries";
pub const TRASHED_QUERIES_DIR: &str = ".trash/.tegg/queries";
pub const QUERY_VERSION: u32 = 1;
/// The first line of a file Tegg creates: HEADER + title + ".".
pub const HEADER: &str = "# Tegg saved query (FR-QRY-06). Edit it in Tegg: Queries › ";

pub enum Match { All, Any }
pub enum View { List, Table }
pub enum Order { Asc, Desc }
pub struct Sort { pub by: String, pub order: Order }          // `by`: title | created | modified | an attribute key

/// R139 operators; `as_str()` / `parse()` use the YAML names.
pub enum Op {
    Is, IsNot, Contains, IsEmpty, IsNotEmpty, IsAnyOf,           // is, is_not, contains, is_empty, is_not_empty, is_any_of
    HasAnyOf, HasAllOf, HasNoneOf,                               // has_any_of, has_all_of, has_none_of
    Before, After, Between, Today, ThisWeek, WithinNextDays, Overdue, // before, after, between, today, this_week, within_next_days, overdue
    Eq, Ne, Lt, Gt,                                              // eq, ne, lt, gt
    LinksTo,                                                     // links_to (relation and `source` attributes)
}

/// `src`: where the item came from in the file (top-level index, then the index inside its group), so a commit can keep
/// an unchanged item's lines (§1.4). None for an item made in the editor.
pub enum FilterItem {
    /// `key`: an attribute key, `links_to` or `linked_from` (NFC). `value`: the YAML value as JSON (scalars, lists);
    /// `true` for the flag operators (`is_empty`, `today`, `this_week`, `overdue`, …). A scalar item is `Op::Is`.
    Filter { key: String, op: Op, value: serde_json::Value, src: Option<Vec<usize>> },
    Group { r#match: Match, filters: Vec<FilterItem>, src: Option<Vec<usize>> },
    /// An item the model can't express (R139 broken shape: not a mapping, an unknown operator, an operator mapping with
    /// ≠ 1 key, a nested group): kept verbatim, by `src`, never re-emitted.
    Raw { src: Vec<usize> },
}

/// The effective definition: every key with R138's default applied (a broken key reads as its default).
pub struct QueryDef {
    pub title: String, pub types: Vec<String>, pub r#match: Match, pub filters: Vec<FilterItem>,
    pub sort: Sort, pub limit: u32, pub view: View, pub columns: Vec<String>,
}

pub enum FileState { Ok, Newer { version: u64 }, Unreadable { line: Option<u32>, reason: String } }

pub enum BrokenReason {
    BadValue,        // a top-level key whose value isn't R138's shape (`limit: many`, `view: board`, …): key broken
    Shape, Operator, NestedGroup,  // syntactic filter problems (parse time)
    NotAttribute,    // run time: not an attribute of every chosen type (or of any type, for all types)
    OperatorKind,    // run time: the operator isn't valid for the attribute's kind (R139)
    Value,           // run time: the value has the wrong shape for the kind / operator (incl. `this` where it can't be)
    NoType,          // run time: a `types` key with no definition and no objects (whole query: no results)
}
/// `at`: the filter's `src` path, None for a key or a type. `key`: the top-level key, the filter's attribute key or the
/// type key. `r#type`: for NotAttribute, the first chosen type lacking the attribute (Name shown by the UI).
pub struct Broken { pub reason: BrokenReason, pub at: Option<Vec<usize>>, pub key: String, pub r#type: Option<String> }

/// The pure parse of a query file's bytes (no schema, no index, no disk).
pub struct QueryFile {
    pub state: FileState,
    pub def: QueryDef,                 // defaults when Unreadable
    pub broken: Vec<Broken>,           // syntactic only (BadValue, Shape, Operator, NestedGroup)
    pub uses_this: bool,               // a non-broken filter has the value `this`
    pub created: Option<String>, pub modified: Option<String>,   // as written, when ISO 8601 with offset
    pub(crate) layout: Layout,         // line ranges of top-level keys and filter items (private)
}

/// A fence body as written (R140).
pub enum FenceRead { Empty, Reference { name: String /* NFC, trimmed */ }, Inline(QueryFile), Unreadable { line: u32 } }

/// The run environment, always given by the caller (the UI's clock, D-504; the core never reads the system clock,
/// zone or region for a query).
pub struct QueryEnv { pub today: NaiveDate, pub tz: chrono_tz::Tz, pub week_start: chrono::Weekday, pub locale: String }

pub enum QuerySource { Saved(String), Fence(String), Def { def: QueryDef, name: Option<String> } }

pub enum Form { Reference, Inline, Unreadable, Empty, Def }
pub enum Lookup { Ok, Newer, Unreadable, Missing, Trashed }
pub enum RunState { Ok, NoType, NeedsHost, NeedsContext }

pub struct TaskBits { pub status: Option<String>, pub state: TaskState, pub due: Option<NaiveDate> }
/// One result. `values` as `type_rows` fills them for the same keys (type-columns.md §2), for the effective columns,
/// plus `type` (the matched type key) and `tags` (frontmatter and inline tags, as written).
pub struct QueryRow {
    pub path: String, pub id: Option<String>, pub title: String, pub r#type: String,
    pub created: Option<String>, pub modified: Option<String>,
    pub values: serde_json::Map<String, serde_json::Value>, pub links: Vec<LinkTarget>, pub task: Option<TaskBits>,
}

pub struct QueryResult {
    pub form: Form,
    pub name: Option<String>,          // Reference: the file's name when found, else the name as written; Def: as given
    pub lookup: Option<Lookup>,        // Reference / Saved only
    pub line: Option<u32>,             // unreadable file (in the file) or fence (in the fence body), 1-based
    pub version: Option<FileVersion>,  // the query file's, when read
    pub def: Option<QueryDef>,         // None for Empty, Unreadable, Missing, Trashed
    pub state: RunState,
    pub broken: Vec<Broken>,           // syntactic + run-time, file order
    pub targets: Vec<String>,          // resolved paths of `"[[…]]"` values and of the host when `this` is used (§2.3)
    pub uses_relative: bool,           // today / this_week / within_next_days / overdue / a date `this`
    pub rows: Vec<QueryRow>,           // every result, sorted; the page size `limit` is the UI's (D-1443)
    pub index_ready: bool,             // the first index build after open has ended (`shared.graph_ready`)
}

pub struct QuerySummary {
    pub name: String, pub title: String, pub path: String, pub lookup: Lookup /* Ok | Newer | Unreadable */,
    pub line: Option<u32>, pub created: Option<String>, pub modified: Option<String>, pub uses_this: bool,
    pub version: FileVersion,
}
pub struct QueryRead {
    pub name: String, pub path: String, pub lookup: Lookup, pub line: Option<u32>, pub reason: Option<String>,
    pub version: Option<FileVersion>, pub text: Option<String>, pub def: Option<QueryDef>, pub broken: Vec<Broken>,
    pub uses_this: bool, pub created: Option<String>, pub modified: Option<String>, pub trashed_path: Option<String>,
}
pub struct QueryUsage { pub path: String, pub title: String, pub r#type: Option<String>, pub template: bool }

pub enum QueryError { NewerVersion, Unreadable, NameTaken, EmptyName, NotFound, Limit, NothingToDo }
```

`CoreError` gains `Query(queries_q::QueryError)` (as `Pin(PinError)`).

### 1.2 Read rules (R138, R139; pure)

```rust
pub fn read(bytes: &[u8]) -> QueryFile;
pub fn read_fence(body: &str) -> FenceRead;
/// D-1434: names compare trimmed, NFC, case-insensitively (no locale), as graph presets (D-907).
pub fn name_key(s: &str) -> String;
```

- **Unreadable** (never rewritten): invalid UTF-8 (`line: None`), invalid YAML, a top level that isn't a mapping, or a
  `version` that is 0, negative, a string or a fraction. `line` is `yaml_rust2`'s 1-based line, moved by D-1120's rule
  (`open_flow_line`) for an unclosed `[` / `{` (`Nečitelný.yml` → 5; the inline fence `title: [rozbitý` → 1); for a bad
  `version`, the line of the `version` key. `reason` is the parser's message (English, not shown).
- **Newer**: an integer `version` > 1. The definition is read and runs; every write is refused (§1.5).
- **Broken keys** (`BadValue`): `title` not a string or blank (the name is used), `types` not a list of strings,
  `match` not `all`/`any`, `filters` not a list, `sort` not a mapping with a string `by` (and `order` `asc`/`desc` or
  missing = `asc`), `limit` not an integer 1…1000, `view` not `list`/`table`, `columns` not a list of strings. Each
  reads as its default. `created`/`modified` that aren't ISO 8601 with offset read as missing, without a notice.
- **Filter items**: the item's **first** key is the filter (`links_to`, `linked_from`, `group` or an attribute key);
  further keys of the item (`x-poznámka`) are kept and ignored. A scalar value is `is`; a one-key mapping is
  `{ <op>: <value> }`. `group` holds `{ match, filters }`; a group inside a group is `NestedGroup` (a `Raw` item).
  Other shapes are `Shape` / `Operator` (`Raw`). Keys and string values are NFC.
- `uses_this`: any non-`Raw` filter whose value is the string `this`.
- `read_fence`: blank or comment-only body → `Empty`; invalid YAML or a non-mapping → `Unreadable { line }` (1-based in
  the body); a mapping with the key `saved`: a non-blank string → `Reference`, anything else → `Unreadable` (that key's
  line); a mapping without `saved` → `Inline` (read as a file; its other lines, `version` included, as R138).

### 1.3 Fences in notes and the usage index (R140, FR-QRY-06 AC-16)

```rust
// crates/tegg-format/src/query_fence.rs, `pub mod query_fence` and re-exported
pub struct QueryFence {
    pub range: std::ops::Range<usize>,  // byte range of the whole fence in the file (opening to closing line, EOLs incl.)
    pub body: String,                   // the body without container prefixes (`> `, list indentation), as CommonMark reads it
    pub saved: Option<String>,          // `read_fence(body)`'s Reference name (NFC), else None
    pub nested: bool,                   // inside a list, quote or callout
    pub info: String,                   // the whole info string as written (`query`, `query meta`)
}
pub fn query_fences(text: &str) -> Vec<QueryFence>;   // every fenced code block whose info string's first word is exactly `query`
```

- `pulldown-cmark` (already a dependency), body only (frontmatter skipped); ```` ``` ```` and `~~~` fences, at any
  depth. The info's first word is compared case-sensitively (`Query` is an ordinary code block; R140); the rest of the
  info string is ignored and kept.
- `@tegg/doc` has the same rule (§3.1); both read `tests/fixtures/queries-files/expected.json` `fences` (L3).
- `tegg-index`: `Stored` gains `#[serde(default)] queries: Vec<String>` (the `saved` names of the note's fences, file
  order, repeats kept), filled by `prepare`. `Index::query_usages(name_key: &str) -> Vec<String>` returns indexed note
  paths with a matching name (path order). `.trash/` notes aren't indexed, so they are never usages (R140); templates
  aren't indexed, so `Core::query_usages` adds a scan of `_templates/**/*.md` with `query_fences` (one read per
  template; FR-TPL-04 AC-2).

### 1.4 Writing (R138 write rules, D-1436; pure)

```rust
/// A commit: the new text, or None when it equals `text` (no write). `def.title` is ignored (a title change is the
/// rename job). Err for Newer / Unreadable files.
pub fn patch(text: &str, file: &QueryFile, def: &QueryDef, now: &str) -> Result<Option<String>, QueryError>;
/// A new file (R138 create order). `tail`: lines copied verbatim after `modified` (Save as query…, §1.5).
pub fn create_text(def: &QueryDef, now: &str, tail: Option<&str>) -> String;
/// `Save as query…`: the inline fence's definition and its unknown keys and comments, as `create_text` inputs.
pub fn from_inline(file: &QueryFile, body: &str) -> (QueryDef, Option<String>);
/// Duplicate: `text` with only the `title:`, `created:`, `modified:` lines replaced (inserted at the R138 place when missing).
pub fn duplicate_text(text: &str, file: &QueryFile, title: &str, now: &str) -> String;
/// Rename: `text` with only the `title:` line replaced (inserted after `version`, else first after the header comment
/// lines, when missing). No `modified` change (FR-QRY-06 AC-6).
pub fn retitle_text(text: &str, file: &QueryFile, title: &str) -> String;
/// The job patches of §1.8: value tokens replaced in place; None when nothing matches or the file is Newer / Unreadable.
pub fn patch_job_text(text: &str, file: &QueryFile, patches: &[QueryPatch]) -> Option<String>;
```

- **Commit.** A top-level key is replaced only when its **effective** value changed (a broken key whose default is kept
  stays as written: `view: board` survives a commit that doesn't touch View, FR-QRY-05 AC-8). Its range is its line to
  the line before the next top-level key, or before the comment / blank lines directly above that key (those stay). A
  missing key that changed is inserted at its R138 create-order place (after the nearest earlier known key present,
  else before the nearest later one). `modified:` is replaced (or inserted) with `now` when any other key changed.
  Keys are never removed; `version` is never added.
- **One-line keys** keep their trailing comment: the bytes from the whitespace before ` #` to the end of the line stay
  as they were (`view: table            # list nebo table`).
- **`filters:`** is re-emitted as a block list (`filters: []` when empty). Inside it, an item equal to an item of the
  file (same key, operator and value, or the same group content; found by `src`) keeps its own lines, its extra keys
  included; full-line comments inside the block are dropped (D-1436). A changed item's first line is re-emitted and its
  extra-key lines are kept; a `Raw` item keeps its lines.
- **Style** (R138): `title: <scalar>`; flow lists `types: [a, b]`, `columns: [a, b]`; `match: all`; `sort: { by: due,
  order: asc }`; `limit: 50`; `view: list`; items `  - <key>: <value>` for `is`, `  - <key>: { <op>: <value> }`
  otherwise, flags as `{ is_empty: true }`, lists in flow style; a group as `  - group:` / `      match: any` /
  `      filters:` / `        - …`. Strings through `yaml_text::scalar` (plain when YAML reads them back unchanged, else
  double-quoted: `"[[Výjezd Lisabon 2026]]"`, `"A/B: plán?"`); integers plainly, other numbers in their shortest
  form; NFC everywhere.
- **Create** (`create_text`): `HEADER` + title + `.`, then `version: 1`, `title`, `types`, `match`, `filters`, `sort`,
  `limit`, `view`, `columns`, `created: <now>`, `modified: <now>`, every key written, LF, final newline.
  `columns` default: the single type's effective type-page columns (`effectiveColumns`, type-columns.md §3, from its
  `columns:` or `preview` + `modified`), else `[type, modified]`.
- **Bytes kept.** Every other line, comment and unknown key byte for byte; a leading BOM stays first; the line ending
  of the file's first line is used for new lines (`file_eol`); a missing final newline stays missing.
- **Read-back check** (as D-1129): the new text is parsed again and must give exactly `def` (and the same unknown keys);
  otherwise the write is refused with `Unreadable` and nothing is written.
- Expected bytes: `tests/fixtures/queries-files/expected/*.yml` (README there).

### 1.5 Core API

```rust
impl Core {
    /// Every readable or unreadable `.tegg/queries/*.yml` (direct children, not dot files), in name order. Reads the files
    /// every call (no cache, as `pins()`).
    pub fn queries(&self) -> Vec<QuerySummary>;
    /// One query by name (`name_key`): live first (exact NFC stem, else the first match in NFC byte order), else the
    /// newest trashed one (`.trash/.tegg/queries/<stem>.yml`, also `<stem> (n).yml`) → `Trashed`, else `Missing`.
    pub fn query(&self, name: &str) -> QueryRead;
    pub fn query_run(&self, src: QuerySource, host: Option<&str>, env: &QueryEnv) -> QueryResult;
    /// A commit (one atomic write). Base check as `pins_apply` (D-175): Vault(Conflict { disk }) / Vault(Gone).
    pub fn query_apply(&self, name: &str, base: &FileVersion, def: QueryDef, now: &str) -> Result<QueryRead, CoreError>;
    /// Undo of a commit (§2): writes `text` if the file is still `base`.
    pub fn query_revert(&self, name: &str, base: &FileVersion, text: &str) -> Result<QueryRead, CoreError>;
    pub fn query_create(&self, req: QueryCreate, now: &str) -> Result<QueryRead, CoreError>;
    pub fn query_duplicate(&self, name: &str, now: &str) -> Result<QueryRead, CoreError>;
    /// Moves the file to `.trash/.tegg/queries/<stem>.yml` (a free ` (n)` stem when taken), bytes unchanged. No base.
    pub fn query_trash(&self, name: &str) -> Result<String, CoreError>;
    /// Moves the newest trashed file of `name` back (a free ` (n)` stem when taken), bytes unchanged.
    pub fn query_restore(&self, name: &str) -> Result<QueryRead, CoreError>;
    pub fn query_usages(&self, name: &str) -> Vec<QueryUsage>;
}
pub struct QueryCreate {
    pub title: String,                 // trimmed, NFC; the name is `sanitize_file_stem(title)` (D-52, ≤ 200 bytes)
    pub def: Option<QueryDef>,         // None: defaults
    pub fence: Option<String>,         // Save as query…: the inline fence body (`from_inline`), instead of `def`
    pub free: bool,                    // true: a taken name gets ` (2)`, ` (3)`… (title too); false: NameTaken
}
```

- **Writes** go through `Vault::write(path, bytes, base)` (a `.<name>.yml.<…>.tegg-tmp` in `.tegg/queries/`, flushed,
  renamed; FR-SYN-02 AC-10); a create is exclusive (`Vault::create`, RENAME_EXCL): an existing file of that name, or one
  created meanwhile, gives `Query(NameTaken)`. Moves are `Vault::rename` (same bytes).
- **Refusals** (nothing written): `Newer` → `Query(NewerVersion)`, `Unreadable` → `Query(Unreadable)` for apply,
  revert and duplicate (trash works on any file); `limit` outside 1…1000 → `Query(Limit)`; a blank title →
  `Query(EmptyName)`; no live file → `Query(NotFound)` (restore: no trashed file).
- `query_duplicate`: name `<stem> (2)` (next free), `duplicate_text` (FR-QRY-06 AC-8). `query_create` with `fence`:
  `from_inline` + `create_text(…, tail)`; the note isn't written by the core (§3.3 does it).
- `query_usages`: indexed notes (`Index::query_usages`) then templates, each with its title and type (`template:
  true` for `_templates/`), path order; the UI sorts (D-122).
- `query_run`: one file read (Saved / Fence reference), then **one** index lock for the whole evaluation (§1.6).

### 1.6 The evaluator (R139, R146; D-1440…D-1445)

- **Candidates.** Indexed objects (never `.trash/` or `_templates/`, D-102, FR-TPL-07), minus the host path. `types`
  empty = all; else objects whose matched type key (D-239; no `type` = `page`, D-103) is listed. A listed key with no
  definition (`Core::types`) and no indexed object → `Broken { NoType }`, `state: NoType`, no rows (D-1442).
- **Schema checks** (run time, R139): an attribute filter is valid when its key is an attribute of every chosen type
  (schema attributes, plus `title`, `tags`, `created`, `modified`, `review`, `source`, `aliases` for every type; with
  no types, only those) with the same kind; else `NotAttribute`. Then the operator must fit the kind (R139 table) →
  `OperatorKind`, and the value its shape → `Value`. `links_to` / `linked_from` keys are always attributes.
  `recurrence`, `file`, `cover`, `icon` → `OperatorKind`. Broken items count **as if absent**; a group whose items are
  all absent is absent (D-1442); an empty tree matches every candidate.
- **this.** Host None and any valid filter uses `this` → `NeedsHost`, no rows (R143). A **date** filter with `this` on
  a host that isn't a Daily Note (`daily_date_of`) → `NeedsContext`, no rows (D-1441). In a link filter, `this` is the
  host path (embeds: the embedded note, FR-QRY-03 AC-6).
- **Comparisons** (D-1445): text, select, `review`, multi-select labels and titles compare `tegg_index::fold`ed (NFC,
  case and diacritics folded, D-109); `contains` is a folded substring test. Multi-valued attributes (lists, aliases)
  match `is` / `contains` when any value does. **Every operator except `is_empty` / `is_not_empty` needs a value**:
  `is_not`, `ne` and the date operators never match an empty value. `is_empty`: missing, null, blank or `[]`.
  Tags: `has_*` by tag key (tags.md R79: NFC, lower case, `#` dropped; frontmatter and inline tags; the values are
  tag-keyed too). Numbers: YAML numbers only (a string never matches, FR-QRY-02 AC-5). Checkbox: `is: true` matches
  `true`; `is: false` matches anything else, missing included.
- **Dates** (D-1440): a date-time by its local date in `env.tz` (D-104), a date as written; date ranges by
  `<key>-start` / `<key>-end`. `today` = `env.today`; `this_week` = the 7 days from the last `env.week_start` on or
  before today; `within_next_days: N` (integer 0…3650) = today ≤ d ≤ today + N; `overdue` = d < today, and for objects
  of type `task` only while the status's state is open or in progress (`tegg_schema::option_state`, D-379);
  `between: [a, b]` inclusive (`a > b` → `Value`); `is: this` = the host Daily Note's date.
- **Links** (R139): `links_to: X` — the candidate is in X's Backlinks list (`Index::backlinks`, FR-LNK-01); `linked_from:
  X` — the candidate is a resolved target of X's links (`note_links`: body, embeds, relation values, links in attribute
  text; not tags). A relation attribute's `{ links_to: X }` uses that attribute's own link values, resolved from the
  candidate's path (D-291). `"[[t]]"` resolves from the vault root as `Core::resolve_link` (file or `id`, FR-LNK-14);
  an unresolved value matches nothing (not broken).
- **Sort** (R138): by kind — numbers numerically, dates and date-times by instant (a date at its local midnight in
  `env.tz`), Select / `review` by option order then unknown values (by collation) after the last option (D-477),
  checkbox false before true, the rest by the collation of the first value. Empty values last in both orders. Ties:
  title by collation, then path (NFC bytes). A `by` that isn't `title`, `created`, `modified` or a valid attribute key
  is a broken `sort` (`BadValue`, default applies). **Collation**: ICU4X `icu_collator` (compiled data) for
  `env.locale`, strength primary, numeric on — the core's twin of the UI's `Intl.Collator(locale, { sensitivity:
  'base', numeric: true })` (D-122; FR-QRY-01 AC-4 (C), R146 `Projekty v běhu`).
- Results never depend on the region except for collation and `this_week` (FR-FMT-12 AC-9); names, keys and paths
  compare NFC.

### 1.7 Watcher and events (FR-QRY-09)

- `apply_paths` reports in `vault:changed` every `.tegg/queries/<file>.yml` path (direct children, not dot or temp
  files; sync conflict copies included, they are queries, R138) and, as today, every `.trash/` path and `.tegg/types/`
  path; `_templates/**/*.md` paths are reported too. No query cache: every call reads the files.
- New `CoreEvent::QueryStale { types: Vec<String>, paths: Vec<String> }`, emitted after every `VaultChanged` that holds
  `.md` paths (index batches and the core's own writes): `paths` the changed `.md` paths, `types` the matched type keys
  of those objects before and after the change (removed and trashed ones included), sorted, deduplicated. Tauri event
  `query:stale`. The UI's re-run rule is §2.3.

### 1.8 Jobs (`tegg-jobs`; FR-QRY-06 AC-6, FR-LNK-03 AC-23, FR-HOM-02 AC-30)

```rust
// crates/tegg-jobs/src/lib.rs
JobKind::QueryRename                 // "query-rename": needs_confirm false, backup true, undoable true, cancellable [Planning, Backup]
JobOp::QueryRename { name: String, title: String }   // name as listed; title as typed (trimmed, NFC by the core)
TextOp::RenameSavedQuery { from: String, to: String } // @tegg/doc `{ op: 'rename-saved-query', from, to }` (§3.1)
JobError::QueryExists { name: String }, JobError::QueryUnreadable  // + NotFound, NothingToDo (existing)

// crates/tegg-jobs/src/host.rs (default bodies: nothing found, nothing written)
fn query_files(&self) -> Vec<String> { Vec::new() }                         // `.tegg/queries/*.yml`
fn query_usage_paths(&self, name: &str) -> Vec<String> { let _ = name; Vec::new() } // notes + templates, no `.trash/`
/// Patches every query file a patch matches (§1.4 `patch_job_text`), each base-checked against the version it just read.
fn patch_queries(&self, patches: &[QueryPatch]) -> Vec<(String, Result<Option<FileWrite>, WriteError>)> { let _ = patches; Vec::new() }

pub enum QueryPatch {
    /// A note moved (4C rename, 4E-1 type and folder moves): `"[[…]]"` filter values resolving to `from` (D-291 rules
    /// from the vault root, with `paths` = the note paths before the job) get `to`'s D-184 text (its stem when the stem
    /// is unique in the vault after the job, else its path without `.md`); a `|alias` / `#sub` suffix is kept.
    ObjectMoved { from: String, to: String, paths: Arc<Vec<String>> },
    /// D-1434's FR-TYP-04 patches; no job emits them in this slice (§9 problem 1).
    OptionRenamed { r#type: String, key: String, from: String, to: String },
    KeyRenamed { r#type: String, from: String, to: String },
    TypeKeyRenamed { from: String, to: String },
}
pub struct FileWrite { pub path: String, pub pre: Vec<u8>, pub pre_v: FileVersion, pub post: Vec<u8>, pub post_v: FileVersion }
// PinPatch gains: QueryRenamed { from: String, to: String }   (names; v1-pinned §1.6)
```

- **`query-rename`** (D-1434): `query_rename` (§2) refuses before the job: `NotFound`, `Unreadable` / `NewerVersion`
  (FR-SYN-03 AC-29), `NameTaken` (another query's name key, the own name excluded), `EmptyName`, `NothingToDo` (same
  NFC text). The plan: the rename `(.tegg/queries/<old>.yml, .tegg/queries/<new>.yml)` with `retitle_text` (Rust, a
  direct row, D-82 allows YAML); every usage (`query_usage_paths`: notes and templates, never `.trash/`) with
  `TextOp::RenameSavedQuery { from: old name, to: new name }` through the transformer (open notes through their
  editor, `JobTransform` `live`, as 4C); last, `patch_pins(&[PinPatch::QueryRenamed])`. Each row base-checked (a usage
  changed since the scan → skipped `changed`, ms4-jobs §5); a changed query file stops the job before any write. Backup
  zip first (FR-HIS-04), undo record as ms4-jobs §7 (bytes and the rename), report `renamed` = the file rename.
- **Link patches** (FR-LNK-03 AC-23): `note-rename` hands `ObjectMoved` to `patch_queries` after its linking files and
  before its pins; `type-move` and `folder-move` hand one per move that happened (D-1466). Rows like the pins row of
  v1-pinned §1.6: listed in `written`, byte rows in undo, journal entries, a conflict → skipped, never a job failure,
  not counted in `done` / `total`. `modified` is never touched; `this` is never a link value.
- **Not patched:** tag renames and merges (no AC), type and attribute deletes (broken parts, D-1434), external renames.

### 1.9 Pins (FR-HOM-02 AC-28…AC-31; changes v1-pinned §1)

`PinTarget::Query { name }` and `PinRequest::Query { name }` (NFC); a `query:` item with a non-blank string is now a
**listed** pin (R131's read rules otherwise unchanged). `PinRow` for a query: `state` `Ok` (a live file, readable or
not), `Trashed` (`query()` → Trashed; `path` = the trashed file) or `Missing`; never `Pending`; `title` = the query's
title, `path` = its file. `pins_apply` `Pin { Query { name } }` → `NotPinnable` unless a live query has that name; the
stored value is the file's name. A target already listed (same `name_key`) moves (D-1379). `patch_text` with
`QueryRenamed { from, to }` replaces the value token of every listed `query:` item whose `name_key` is `from`'s.
Trash, restore and final delete never write pins (D-1435).

### 1.10 Trash (D-1435; changes ms6-trash-media §1.2)

`TrashKind::Query`: one row per `.trash/.tegg/queries/*.yml` (`kind: 'query'`, `original` = `.tegg/queries/<file>`,
`folder` = `.tegg/queries`, `title` = the file's title or stem, `type_key: None`, `files: [path]`, `count: 1`).
`trash_restore(path)` of such a row is `query_restore`'s move; `trash_delete` / `trash_empty` send it to the system
trash as other rows. No other `.trash/.tegg/` file is listed.

## 2. IPC

New Tauri module `app/src-tauri/src/shellq.rs`, registered next to `shellpin`. TS types hand-written in
`app/ui/src/ipc/queries.ts`; `ipc/client.ts` gains one function per command (camelCase of the name).

| Command | Arguments | Returns | Notes |
| --- | --- | --- | --- |
| `queries_list` | — | `QuerySummaryDto[]` | `Core::queries`. Read-only. |
| `query_get` | `name` | `QueryDto` | `Core::query`. Read-only; `missing` / `trashed` are states, not errors. |
| `query_run` | `source: QuerySourceDto`, `host: string \| null`, `env: QueryEnvDto` | `QueryResultDto` | `Core::query_run`. Read-only. One call per block render (NFR-PERF-05, -07). |
| `query_apply` | `name`, `base: VersionDto`, `def: QueryDefDto`, `now` | `{ query: QueryDto; undo: string \| null }` | One write or none; `undo` = the bytes before (null: nothing written). |
| `query_revert` | `name`, `base: VersionDto`, `text` | `QueryDto` | Undo of the last commit (§4.4). |
| `query_create` | `title`, `def: QueryDefDto \| null`, `fence: string \| null`, `free: boolean`, `now` | `QueryDto` | Exclusive create. |
| `query_duplicate` | `name`, `now` | `QueryDto` | |
| `query_rename` | `name`, `title` | `{ jobId: number }` | Starts `query-rename`; refusals before the job as errors. Progress and report as every job (`job:progress`, `job_report`, `job_undo`). |
| `query_trash` | `name` | `{ trashed: string }` | |
| `query_restore` | `name` | `QueryDto` | Also the Undo of a trash. |
| `query_usages` | `name` | `QueryUsageDto[]` | |

Existing commands changed: `pins_get` / `pins_apply` (query targets, §1.9), `trash_list` / `trash_restore` /
`trash_delete` (`kind: 'query'`, §1.10), `ui_state_get` / `ui_state_set` (`queries`, §4.6).

```ts
type QueryOp = 'is' | 'is_not' | 'contains' | 'is_empty' | 'is_not_empty' | 'is_any_of' | 'has_any_of' | 'has_all_of'
  | 'has_none_of' | 'before' | 'after' | 'between' | 'today' | 'this_week' | 'within_next_days' | 'overdue'
  | 'eq' | 'ne' | 'lt' | 'gt' | 'links_to';
type FilterItemDto =
  | { kind: 'filter'; key: string; op: QueryOp; value: unknown; src: number[] | null }
  | { kind: 'group'; match: 'all' | 'any'; filters: FilterItemDto[]; src: number[] | null }
  | { kind: 'raw'; src: number[] };
type QueryDefDto = {
  title: string; types: string[]; match: 'all' | 'any'; filters: FilterItemDto[];
  sort: { by: string; order: 'asc' | 'desc' }; limit: number; view: 'list' | 'table'; columns: string[];
};
type BrokenDto = {
  reason: 'badValue' | 'shape' | 'operator' | 'nestedGroup' | 'notAttribute' | 'operatorKind' | 'value' | 'noType';
  at: number[] | null; key: string; type: string | null;
};
type LookupDto = 'ok' | 'newer' | 'unreadable' | 'missing' | 'trashed';
type QuerySummaryDto = {
  name: string; title: string; path: string; state: 'ok' | 'newer' | 'unreadable'; line: number | null;
  created: string | null; modified: string | null; usesThis: boolean; version: VersionDto;
};
type QueryDto = {
  name: string; path: string; state: LookupDto; line: number | null; reason: string | null;
  version: VersionDto | null; text: string | null; def: QueryDefDto | null; broken: BrokenDto[]; usesThis: boolean;
  created: string | null; modified: string | null; trashedPath: string | null;
};
type QuerySourceDto =
  | { kind: 'saved'; name: string }
  | { kind: 'fence'; body: string }                              // a block: the fence body as written
  | { kind: 'def'; def: QueryDefDto; name: string | null };      // the editor's in-memory state (live results)
type QueryEnvDto = { today: string; zone: string; weekStart: number /* ISO 1…7 */; locale: string };
type QueryRowDto = {
  path: string; id: string | null; title: string; type: string; created: string | null; modified: string | null;
  values: Record<string, unknown>; links: LinkTargetDto[];
  task: { status: string | null; state: 'open' | 'in-progress' | 'done' | 'cancelled'; due: string | null } | null;
};
type QueryResultDto = {
  form: 'reference' | 'inline' | 'unreadable' | 'empty' | 'def'; name: string | null; lookup: LookupDto | null;
  line: number | null; version: VersionDto | null; def: QueryDefDto | null;
  state: 'ok' | 'noType' | 'needsHost' | 'needsContext'; broken: BrokenDto[]; targets: string[];
  usesRelative: boolean; total: number; rows: QueryRowDto[]; indexReady: boolean;
};
type QueryUsageDto = { path: string; title: string; type: string | null; template: boolean };
// IpcError.kind: 'Conflict' (payload `disk: QueryDto`), 'Gone', 'NewerVersion', 'Unreadable', 'NameTaken',
// 'EmptyName', 'NotFound', 'Limit', 'NothingToDo', 'Io', 'NoVault'.
```

`IpcError` gains a flattened `query` extra (as `pins`): `Conflict` carries `disk`, the query as on disk now.
`query_run` never fails for file states (they are `lookup` / `form`); `Io` only for a vault error.

### 2.1 UI error handling

`Conflict` / `Gone` on a commit, header sort or Columns change (FR-SYN-03 AC-28): nothing is written, the editor
closes, the block and the query page draw `disk` (or `query_get`), and an alert shows `query.editor.changedOutside`.
`NewerVersion` / `Unreadable` → `query_get`, the read-only or unreadable state follows. `NameTaken` in the New query,
Save as and rename dialogs → `query.newQuery.taken` under the field. `Io` → `query.saveFailed`, nothing changes. No
automatic retry.

### 2.2 Who calls what

| Surface | Calls |
| --- | --- |
| Sidebar `Queries` entry, `queries` page, `/query` picker | `queries_list` (on mount, on `vault:changed` with a `.tegg/queries/` or `.trash/.tegg/queries/` path, debounced 300 ms) |
| `query/<name>` | `query_get`, `query_run({ kind: 'saved' }, null)`, `query_usages` |
| A block (read view, editor, embed) | `query_run({ kind: 'fence', body }, host)`; `query_get` when its editor opens |
| The editor while open | `query_run({ kind: 'def', def, name }, host)` per change (no write); one `query_apply` on commit |
| Pinned section | `pins_get` (re-read on `vault:changed`, as today) |

### 2.3 Live results (FR-QRY-09)

A shown result list (block, query page, open editor) calls `query_run` again, debounced 300 ms and coalesced, when:
(a) `vault:changed` has its query file's path (by `name_key` of the stem), any `.tegg/queries/` path while it is
`missing` / `trashed` / `unreadable`, any `.trash/.tegg/queries/` path while `trashed` or `missing`, or a
`.tegg/types/` path; (b) `query:stale` has a type of the query's `types`, or the query has no types, or a path in
`targets`, in its rows or equal to the host; (c) the local date changes (checked every 30 s, D-327) and `usesRelative`.
A block on a note being typed in waits for that note's autosave (never re-runs while typing; FR-QRY-09 AC-5). An answer
equal to the drawn one redraws nothing.

## 3. Doc and editor

### 3.1 `@tegg/doc` (`packages/doc/src/queryfence.ts`, exported from `index.ts`)

```ts
export type QueryFence = { range: [number, number]; body: string; saved: string | null; nested: boolean; info: string };
export function queryFences(text: string): QueryFence[];          // §1.3 rule; L3 twin of `tegg_format::query_fences`
/** The `saved:` value of a reference body (trimmed, NFC), else null (no YAML parse: the line `saved: <scalar>` at column 0). */
export function savedName(body: string): string | null;
/** A fence's source with only its `saved:` value replaced (`Choose a query…`); null when it has no `saved:` line. */
export function withSavedName(fenceSource: string, name: string): string | null;
/** `Save as query…`: the fence's source with its body replaced by `saved: <name>` (fence markers, info and container prefixes kept). */
export function referenceFence(fenceSource: string, name: string): string;
/** A new reference fence: "```query\nsaved: <name>\n```". */
export function newQueryFence(name: string): string;
```

- `parse.ts` classifies a top-level `code` node whose `lang` is exactly `query` as `query` (unchanged); `ReadView`'s
  case-insensitive check becomes case-sensitive (R140).
- `transform.ts` gains `{ op: 'rename-saved-query'; from: string; to: string }`: in every query fence of the file (any
  depth), each `saved:` line whose value has `from`'s name key gets `to` (`formatScalar`; container prefixes and every
  other byte kept); no `modified` change.
- Values are written with `formatScalar` (the D-230 rule shared with the core's `yaml_text::scalar`).

### 3.2 `@tegg/editor`

- **Node.** A top-level fence stays `rawBlock` with `kind: 'query'` (attrs `source`, `kind`, plus new `draft: boolean`,
  default false): one atom, selectable, draggable (FR-EDT-02 AC-24). A fence **inside** a list, quote or callout
  stays a `codeBlock` with `language: 'query'`; a new `codeBlock` node view renders it through the same hook with no
  content DOM, so the caret never enters it and typing never edits it (D-1470). Other code blocks render as today.
  Both serialize as today: untouched blocks keep their bytes (`srcIndex`); a `draft` rawBlock is **never serialized**
  (it lives only in the editor, as D-1428), so a draft changes no byte.
- **`EditorUi`** gains `query?(source: string, dom: HTMLElement, ctl: QueryCtl): EmbedHandle | null` (null: the R5
  placeholder) and `onQueryKey?(pos: number, key: 'open'): boolean` (⌘↩ on a selected query block, R144).
  `type QueryCtl = { getPos(): number | undefined; nested: boolean; draft: boolean; setSource(source: string): boolean;
  select(): void }` — `setSource` replaces the fence's text (the rawBlock `source` / the codeBlock content) as one
  transaction and one undo step and clears `draft`.
- **Commands** (`EditorHandle`): `insertQuery(from: number, to: number, name: string | null): boolean` — deletes
  `from…to` (the typed `/quer`) and inserts after the caret's block a query rawBlock (`newQueryFence(name)`), or with
  `name: null` an empty `draft` rawBlock, selected; one undo step. `dropQueryDraft(pos: number): boolean` removes a
  draft without a history entry.
- **Slash** (`slash.ts`): `{ id: 'query', group: 'advanced', label: 'Query' }` (no `due`); `SLASH_BLOCK` has no entry
  (the app opens the picker, R144). The `+` handle's `Query` item and `Insert query` do the same.
- `window.__TEGG_TEST__.queryBlocks()`: `{ pos: number; source: string; nested: boolean; draft: boolean }[]` of the
  open editor, document order (L5).

### 3.3 Note writes by blocks

`Choose a query…` (`withSavedName`) and `Save as query…` (`referenceFence`, after `query_create` succeeds) call
`QueryCtl.setSource`: one editor transaction, one autosave (FR-EDT-08), no other byte. In the read view (no editor)
these two buttons are absent; the note page switches to editing as today. `Create it` and `Restore` write no note.

## 4. UI

### 4.1 Routes and registry (FR-NAV-04 AC-12; app-shell R1)

`ROUTES` loses `saved-queries` (it then parses as unknown) and gains `{ id: 'queries', name: 'route.queries', purpose:
'purpose.queries', status: built v1.0, reqs: ['FR-QRY-06', 'FR-NAV-04'], design: 'QueriesAll' }` and `{ id:
'query/<name>', name: 'route.query', purpose: 'purpose.query', …, design: 'QueryPage' }`. `parseRoute('query/<rest>')`
→ `{ id: 'query/<name>', param: rest.normalize('NFC') }` (no encoding, no fragment; an empty rest → null);
`routeString` gives `query/<name>`. Icons: `queries`, `query` → `query` (the funnel, `--link`).

### 4.2 Modules (`app/ui/src/queries/`)

| Module | Owns |
| --- | --- |
| `model.ts` | Pure, L1. `attributeGroups(types: TypeDto[], chosen: string[])` → R139's listbox groups; `operatorsFor(kind)` → `QueryOp`s in R139 order with their label keys; `isValidRow(row, types)` → null or `BrokenDto['reason']`; `columnsAfterTypes(columns, before, after, types)` (one type → several: keep the universal keys in order, then append `type`, FR-QRY-05 AC-5; several → one: unchanged); `columnChoices(def, types)` (R130 rows for one type, the universal rows plus `type` when mixed, AP-1294); `toggleColumn(def, key, on)` (appended / removed, as type-columns.md); `prefill(def, host)` → `{ type, values } \| null` (D-1439); `parseLimit(text)` → 1…1000 or null; `defEquals(a, b)`. |
| `env.ts` | `queryEnv(nowMs)` → `QueryEnvDto`: `today` = `localDate(now, appZone())`, `zone` = `appZone()` or `Intl` zone, `weekStart` = `firstDay(dateTimeSetting(), region())`, `locale` = the collation locale (`collate.ts`). |
| `store.ts` | The vault's `QuerySummaryDto[]` (`useQueries()`, `refreshQueries()`), §2.2's refresh, the sort of §4.6. |
| `useQueryRun.ts` | One result list: `useQueryRun(source, host)` → `{ result, loading }` with §2.3's rules. |
| `QueriesPage.tsx` | R143 `queries`. |
| `QueryPage.tsx` | R143 `query/<name>`. |
| `QueryBlock.tsx` | R141: the frame, every state, List / Table bodies (virtualized), `Show more`, Columns menu, the new-object footer. Used by `ReadView` (`code` nodes with `lang === 'query'`, any depth, host = the view's path), by `EditorPane` (`EditorUi.query`) and inside embeds. |
| `QueryEditor.tsx` | R142's dialog: a working copy of the def, `query_run` `def` per change, one `query_apply` on commit, the rename job when the title changed. |
| `QueryPicker.tsx` | R144's `Choose a query` picker (also `Choose a query…`). |
| `QueryDialogs.tsx` | `New query` (and Save as, Create it), `Rename query`. |
| `QueryMenu.tsx` | `Query actions` (`PopupMenu`): `pinMenuEntry({ kind: 'query', name })`, `Rename…`, `Duplicate`, separator, `Move to trash`; an unreadable query: `Move to trash` only. |

Pinned (`app/ui/src/pinned/`): `rowView` handles `{ kind: 'query' }` (icon `query` in `--link`, label = title,
description `pinned.kind.query`, route `query/<name>`; trashed → `trash`; missing → alert); `targetOfRoute` handles
`query/<name>`; `PinRequestDto` / `PinStoredDto` gain `{ kind: 'query'; name: string }`; `queries` rows are drag
sources (`pinDragSource`).

### 4.3 DOM (roles, names, attributes the tests use)

| Part | Element | Name and attributes |
| --- | --- | --- |
| Sidebar entry | `a.entry` | visible `Queries` + count; `aria-label` `queries.title`; `aria-description` `queries.count`; `data-command="queries.go"`; `aria-current="page"` on `queries` and `query/<name>`; between the Tags entry and Trash |
| Queries page | `h1` | `queries.title`; then `p` `queries.count` |
| Find | `input[type=search]` | `aria-label` `queries.find` |
| Sort | `button` | visible current sort (`queries.sort.*`), `aria-haspopup="menu"`; menu `queries.sortLabel` |
| New query | `button` | `queries.new` |
| Table | `table` | `aria-label` `queries.title`; `columnheader`s `Query`, `Created`, `Updated` (`aria-sort`), a fourth without name |
| Row | `tr` | `data-query-row="<name>"`, `data-query-state="ok\|newer\|unreadable"`, `tabIndex=0`; first cell: icon and title (`Can't be read` for unreadable); `⋯` `button` `aria-label` `queries.rowMenu`, `aria-haspopup="menu"` |
| Query page | `a` | `query.back` (visible `‹ All queries`); `h1` = title; `p` `query.created`; `button` `query.edit` (`aria-haspopup="dialog"`); `⋯` as the row's |
| Needs page | `section` | `data-query-state="needsHost"`, `h2` `query.needsPage`, `p` `query.needsPageBody` |
| Used on | `section` | `h2` `query.usedOn`; `ul` `aria-label` `query.usedOn`; chips `a[data-usage="<path>"]` (templates with a `span` `query.template`); `p` `query.notUsed` |
| Block | `figure` | `aria-label` `query.block.label`; `aria-description` `query.editor.results` (total); `data-query-block`, `data-query-form`, `data-query-name`, `data-query-state` = `loading\|ok\|noResults\|draft\|notFound\|trashed\|unreadable\|needsContext\|needsHost\|noType`, `data-query-broken` (count, when > 0), `data-query-readonly` (newer) |
| Header | `div.query-header` | funnel icon (`data-icon="query"`), title, count (`aria-hidden`); `button` `query.block.columns` (Table only, `aria-haspopup="menu"`); `button` `query.edit` (`title` the same, `aria-haspopup="dialog"`; `aria-disabled` + `aria-description` `query.block.readOnly` when newer); inline: `button` `query.block.saveAs` instead of both |
| List | `ul` | `aria-label` = title; `li` per shown row with the Backlinks chip `a[data-query-result="<path>"]` (D-368: type icon, title; Task: divider, due date, status) |
| Table | `table` | `aria-label` = title; `columnheader`s (`tabIndex=0`, `aria-sort`, click / ⏎ / Space sorts); `tr[data-query-result="<path>"]`; Task title cell `[role=checkbox][aria-disabled=true]` with `aria-description` `query.block.taskReadOnly`; empty cells `—`; at most 60 `tr` in the DOM (window around the visible part, first and last rows carrying the height of the rows left out) |
| Notice | `p.query-notice` | the first broken part's text (§4.5), `button` `query.block.fixFilter` |
| Message | `p.query-message` | the state's text; buttons `query.block.chooseQuery`, `query.block.createIt`, `query.block.restore`, `query.block.openQuery`, `query.edit` per R141 |
| Show more | `button` | `query.block.showMore` |
| New object | `button` | `query.block.newObject` (`New Task`), `aria-description` `query.block.linksHere` |
| Live region | `div.sr-live` | `role="status"`, `aria-live="polite"`: `query.editor.results` once per commit |
| Editor | `div[role=dialog]` | `aria-label` `query.editor.dialog`, not modal, 640 px; `textbox` `query.editor.titleField`; `p` `query.editor.usedOn`; type chips with `button` `query.editor.removeType`; `button` `query.editor.type` (`aria-haspopup="listbox"`) |
| Filter row | `div[role=group]` | `data-filter="<src path, e.g. 0 or 2.1>"`; `combobox` `query.editor.attribute`, `combobox` `query.editor.operator`, the value control `query.editor.value`, `button` `query.editor.removeFilter`; broken: `data-broken="<reason>"`, `aria-description` `query.editor.ignored.*` |
| Connector | `button` | `aria-label` `query.editor.combine`, `aria-haspopup="listbox"` (options `and`, `or`); rows 3+ a `span` in `--faint` |
| Group | `div[role=group]` | `aria-label` `query.editor.groupAny` / `groupAll`; `button` `query.editor.addToGroup`, `button` `query.editor.removeGroup` |
| Editor footer | `p` / `button`s | `query.editor.results`; `button` `query.editor.source` (opens a `dialog` `query.editor.source` with the path and a read-only `pre`); `button` `query.editor.done` |
| Picker | `div[role=dialog]` | `aria-label` `query.picker.title`; `searchbox` `queries.find`; `listbox` of `option`s: `query.picker.new` first, then readable queries by title |
| New query | `div[role=dialog]` | `aria-label` `query.newQuery.dialog`; `textbox` `query.newQuery.field`; `button`s `query.newQuery.create`, `query.newQuery.cancel`; error `query.newQuery.taken` (`aria-describedby`) |

### 4.4 Behaviour the contract fixes

- **Editor commit** (D-1446): changes run `query_run` `def` only; on Done / Esc / click outside with a change: one
  `query_apply` (title excluded), then, when the title changed, `query_rename`. Esc with no change writes nothing.
  **Undo**: ⌘Z while the committed block (or the query page's `Edit query`) still has the focus and nothing else was
  edited → `query_revert` with the `undo` bytes (one write).
- **Draft** (`/query` › `New query`): `insertQuery(…, null)` + the editor with `query.editor.untitled` selected; the
  first commit with a type, a filter or a changed title calls `query_create({ title, def, free: true })` and then
  `setSource(newQueryFence(<created name>))` (one autosave). Esc with nothing chosen, or leaving the note →
  `dropQueryDraft`.
- **Create it** (not found): `query_create({ title: <written name>, def: null, free: false })`, then the editor opens
  on the block (§9 problem 2).
- **Header sort** (D-1444): `query_apply` with only `sort` changed; **Columns**: with only `columns` changed;
  `New property…`: `type_patch` (addAttribute) then `query_apply` (columns).
- **New-object footer** (D-1439): opens the draft route `new/<type>` (ms5-tasks §12.2; also for Task, whose other
  entry points go to `tasks`) with `Route.prefill = prefill(def, host)` (`[["source", "[[<host D-184 text>]]"], …
  top-level Select `is` values]`): a new `Route` field like `selectEmbedOf`, not part of the route string, that the
  draft writes with its first write (its attribute panel shows the values before it).
- **Show more**: pages of `def.limit`, in memory (D-1443); reset when the host note is opened again.

### 4.5 Strings (R145; NFR-OTH-02 AC-17)

Every R145 key in `app/ui/src/i18n/catalog.ts`, plurals per D-133, **except** that R145's `block.*`, `editor.*`,
`picker.*` and `newQuery.*` keys get the prefix `query.` (`query.block.label`, `query.editor.dialog`,
`query.picker.title`, `query.newQuery.field`): `picker.title` (`Choose {name}`) and the `editor.*` namespace already
exist. Removed: `route.savedQueries`, `purpose.savedQueries`, `cmd.goto.savedQueries`. The contract adds the keys the
ACs need and R145 lacks (§9 problem 3):

`route.queries` `Queries` · `route.query` `Query` · `purpose.queries` `Saved queries you can use as blocks in any note.` · `purpose.query` `A saved query, its results and where it is used.` · `slash.query.description` `A live list of objects` · `queries.sortLabel` `Sort queries` · `queries.sort.createdDesc` `Created ↓` · `queries.sort.createdAsc` `Created ↑` · `queries.sort.updatedDesc` `Updated ↓` · `queries.sort.updatedAsc` `Updated ↑` · `queries.sort.title` `Title A–Z` · `queries.renameDialog` `Rename query` · `queries.trashed` `Moved “{name}” to the trash` · `query.saveFailed` `The query couldn't be saved.` · `query.block.readOnly` `Made by a newer version of Tegg. Read-only.` · `query.block.brokenFilter` `The filter {attribute} can't be used as written, so it is ignored.` · `query.block.taskReadOnly` `Edit the task to change it.` · `query.block.newObject` `New {type}` · `query.block.linksHere` `· links to this note` · `query.columns.mixed` `Mixed types: only columns every object has.` · `query.editor.untitled` `Untitled query` · `query.editor.removeType` `Remove {type}` · `query.editor.attribute` `Attribute` · `query.editor.operator` `Condition` · `query.editor.value` `Value` · `query.editor.limitError` `Enter a number from 1 to 1000.` · `query.editor.linksTo` `Links to` · `query.editor.linkedFrom` `Linked from` · `query.editor.ignored.notAttribute` `Ignored: not an attribute of {type}` · `query.editor.ignored.operator` `Ignored: this condition doesn't fit {attribute}` · `query.editor.ignored.value` `Ignored: the value can't be read` · `query.editor.ignored.nestedGroup` `Ignored: groups cannot hold groups` · `query.newQuery.create` `Create` · `query.newQuery.cancel` `Cancel` · `query.op.<op>` for each `QueryOp` with R139's board label (`is`, `is not`, `contains`, `is empty`, `is not empty`, `is any of`, `has any of`, `has all of`, `has none of`, `before`, `after`, `between`, `today`, `this week`, `within next N days`, `overdue`, `=`, `≠`, `<`, `>`, `links to`), plus `query.op.checked` `is checked` and `query.op.notChecked` `is not checked`.

Notice choice (R141): the first broken part in file order — `noType` → `query.block.noType`; `badValue` →
`query.block.brokenKey`; `notAttribute` → `query.block.brokenAttr` (`{type}` = the type's Name); other filter reasons
→ `query.block.brokenFilter`. The Every-object attribute names, kind names and the Columns menu rows reuse the type
page's existing keys. The Trash view's kind label is `pinned.kind.query`.

### 4.6 Commands, shortcuts, UI state

| Id | Title key | Section | Listed |
| --- | --- | --- | --- |
| `queries.go` | `cmd.goQueries` | `navigate` | with a vault |
| `queries.new` | `cmd.newQuery` | `create` | with a vault |
| `editor.insertQuery` | `cmd.insertQuery` | `edit` | `note/<path>`, `daily/YYYY-MM-DD` with the editor focused |
| `query.edit` | `query.edit` | `edit` | `query/<name>`; a note with a selected query block |
| `query.rename` | `cmd.renameQuery` | `edit` | `query/<name>` (disabled for unreadable / newer) |
| `query.trash` | `cmd.trashQuery` | `edit` | `query/<name>` |

`ShellActions` gains `queryStatus?(): { name: string; editable: boolean } | null`, `editQuery?()`, `renameQuery?()`,
`trashQuery?()`, `insertQuery?()`; `pinStatus` is non-null on `query/<name>`. No new shortcut; ⇧F10 on rows (D-479).
`UiStateDto` gains `queries?: { sort?: 'created-desc' | 'created-asc' | 'updated-desc' | 'updated-asc' | 'title' }`
(missing → `created-desc`; Rust `#[serde(default)]`), written by `ui_state_set` only (FR-QRY-06 AC-2).

## 5. Fake core and test hooks

- `app/ui/test/fake-queries.ts`, installed by `installFakeCore` (as `fake-pins.ts`), the TypeScript twin of §1.2–§1.6
  over the fake's files (values from the `yaml` package, positions from the graph-presets twin's line scanner):
  `queryRead(text: string | null, utf8 = true): QueryReadTwin` (state, line, def, broken, usesThis, layout);
  `fenceRead(body): { form; name?; line?; read? }`; `queryPatch(text, read, def: QueryDefDto, now) → { text: string |
  null } | { error }`; `queryCreateText(def, now, tail?)`; `queryDuplicateText(text, read, title, now)`;
  `queryRetitleText(text, read, title)`; `queriesJobPatch(text, patches: QueryPatchDto[]) → string | null`;
  `queryRun(source, host, env, files, types) → QueryResultDto` (the evaluator over the fake's files: frontmatter,
  links resolved as `fake-links.ts`, tags as `fake-tags.ts`, types as `fake-schema.ts`, `Intl.Collator` for `env.locale`);
  `handle(cmd, args, files, invalid)` for every §2 command. Checked against the Rust module on every
  `tests/fixtures/queries-files/` file and on `expected.json` (L3).
- The fake's `note-rename`, `type-move`, `folder-move` jobs call `queriesJobPatch` (§1.8); its `query-rename` job
  patches usages with `@tegg/doc` `transform` (`rename-saved-query`) and pins with `pinsJobPatch`; `pins_*` and
  `trash_*` learn queries (§1.9, §1.10); the fake emits `query:stale` after every `vault:changed` with `.md` paths.
- Handle additions: `queryCalls()` (the writing calls `query_apply`, `query_revert`, `query_create`,
  `query_duplicate`, `query_rename`, `query_trash`, `query_restore` in order, each with its arguments); `queryRuns()`
  (the `query_run` calls: `{ source, host, at }`); `queriesFail(cmd, kind)` (the next `cmd` fails with `kind` without
  writing); `queriesNotReady(on)` (`indexReady: false` while on; off emits `index:progress` `done`). Existing hooks
  cover the rest: `setFile('.tegg/queries/…', text, { silent: true })` makes a base stale without `vault:changed`
  (FR-SYN-03 AC-28), `sameBytesTouch` an mtime-only change, `renameFile`, `writeControl({ path })`, `delayCommand`,
  `writes()` / `writesTo()` (query-file writes count as vault writes), `calls()`, `uiState()`, `jobs()`, `moves()`.
- L6 (`TEGG_TEST=1`): `TEGG_NOW` fixes the UI clock (D-504) and the UI sends it in `QueryEnvDto`; `TZ` sets the zone
  (the `(Z)` runs); the helper `app/e2e/helpers/external.ts` creates, edits, renames, copies and deletes query files
  and notes; `TEGG_TEST_HOLD=first-index:<ms>` shows the loading state; the kill harness runs at L4 (D-1113's way) with
  alternating Table ↔ List commits of `Projekty v běhu` (FR-SYN-02 AC-10).

## 6. Test layout and fixtures

### 6.1 Files

| Layer | Files |
| --- | --- |
| L0 | The AR-03 check covers `queries_q.rs` and `tegg-format/src/query_fence.rs` (FR-STO-06 AC-3) |
| L1 | `app/test/queries_model.ac.test.ts` (`model.ts`, R139 lists, columns rules, FR-QRY-02 AC-1), `app/test/queries_twin.ac.test.ts` (the twin against `queries-files/` and `expected.json`; the `yaml`-package and `micromark` parse of FR-FMT-06 AC-4), `app/test/queries_registry.ac.test.ts` (FR-UX-03 AC-41, FR-NAV-04 AC-12), `app/test/queries_catalog.ac.test.ts` (NFR-OTH-02 AC-17); `packages/doc/test/queryfence.ac.test.ts` (§3.1, FR-FMT-07 AC-30 with real `@tegg/doc`); `packages/editor/test/query_block.ac.test.ts` (§3.2 node, draft, serialization) |
| L2 | `crates/tegg-core/tests/ac_queries_props.rs` (FR-QRY-02 AC-8 oracle in three zones; FR-FMT-07 AC-29 patch invariants), fast-check twins `app/test/queries_props.ac.test.ts` and `packages/doc/test/queryfence_props.ac.test.ts` (FR-FMT-07 AC-30) |
| L3 | `tests/fixtures/queries-files/expected.json`, read by `ac_queries.rs` and `queries_twin.ac.test.ts` |
| L4 | `crates/tegg-core/tests/ac_queries.rs` (read rules, R146 rows, every operator, `this`, zones and regions, writes and every `expected/` file, `Conflict` / `Gone` / RENAME_EXCL / refusals, trash and restore, usages, pins, the watcher's paths and `QueryStale`, NFC, the kill harness, FR-STO-06 AC-3), `crates/tegg-core/tests/ac_queries_perf.rs` (`nfr_perf_*`: NFR-PERF-05 AC-5, -07 AC-2 on `tools/gen-vault --seed 1 --small-images`; skipped at push by `--skip nfr_perf_`), `crates/tegg-format/tests/ac_query_fence.rs`, `crates/tegg-jobs/tests/ac_queries_jobs.rs` (FR-QRY-06 AC-6, FR-LNK-03 AC-23, FR-HOM-02 AC-30; real `Core` host and `NodeTransformer`) |
| L5 | `app/webkit/queries_page.ac.test.ts` (FR-QRY-06 AC-1…AC-8, AC-20, FR-HOM-02 AC-28…AC-31), `queries_block.ac.test.ts` (FR-QRY-05, FR-QRY-06 AC-9…AC-19, FR-QRY-08, FR-EDT-02 AC-24, AC-25), `queries_editor.ac.test.ts` (FR-QRY-01, -02 AC-4, AC-6, -03), `queries_live.ac.test.ts` (FR-QRY-09, FR-SYN-03 AC-28, AC-29, FR-SYN-06 AC-44 write counts), `queries_a11y.ac.test.ts` (FR-UX-03 AC-41, AC-42, FR-UX-08 AC-18, FR-UX-05 AC-20, NFR-OTH-02 AC-17, FR-NAV-04 AC-12); helpers `app/webkit/queries-helpers.ts` |
| L6 | `app/e2e/queries.ac.test.ts` (every AC whose layer names L6), in the red-test commit (D-382); keys only to Tegg (D-799) |
| manual | FR-QRY-06 AC-21, FR-FMT-06 AC-6 (`qa/manual/`) |

No new `qa.config.json` step: every file lives in a package that already has one.

### 6.2 Fixtures

- `tests/fixtures/vaults/queries/` (drafted with the ACs) with `tests/fixtures/vaults/new-empty/.tegg/` copied in.
- `tests/fixtures/queries-files/expected/` (written with this contract; README there): `created.yml`,
  `created-a-b-plan.yml`, `komentare-after-view.yml`, `komentare-after-filter.yml` and their `-crlf` / `-no-newline`
  variants, `saved-rucni-dotaz.yml`, `duplicate-projekty-v-behu-2.yml`, `renamed-otevrene-ukoly-porady.yml`. The
  FR-FMT-07 AC-29 "adds a filter" commit is **`rozpočet` `>` `5000`, appended** (D-1478).
- `tests/fixtures/queries-files/expected.json` (L3; the test author writes it with the red tests):
  `{ "reads": { "<vault-relative query file>": { "state", "line", "def", "broken", "usesThis" } }, "fences": { "<note
  path>": [ { "range", "saved", "nested", "form", "line" } ] }, "results": [ { "query", "host", "env", "paths",
  "state", "broken" } ] }` — `def` / `broken` as the §2 DTOs, `results` R146's rows (and the `(C)` / `(Z)` variants).
- **AC-Test-Change** (D-1447) with `AC-Test-Change: slice Q builds saved queries (FR-QRY-06); approved-by: owner`: the
  files the ACs list (app-shell, read-view, editor, pinned, tags, trash-media, rename and type tests touching
  `saved-queries`, the `query` row, `Advanced › Query`, `query:` pins and the Trash view), found by the test author.

## 7. Owner decision

None needed for the interface. §9 lists the ACs to correct before the red tests (owner approval of AC text).

## 8. Contract decisions (D-1448…D-1490, accepted by the owner 2026-11-10)

1. **D-1448** The module is `tegg-core::queries_q` plus `tegg-format::query_fence`; the evaluator runs in the core over one index lock, never in the UI.
2. **D-1449** The core never reads the clock, zone or region for a query: the UI sends `QueryEnvDto { today, zone, weekStart, locale }` and `now` for writes.
3. **D-1450** Collation in the core is ICU4X `icu_collator` (compiled data, primary strength, numeric), the twin of the UI's `Intl.Collator` (new dependency of `tegg-core`).
4. **D-1451** `query_run` returns every result sorted; `limit` paging (`Show more`) is done in the UI over that list.
5. **D-1452** A block makes one `query_run({ kind: 'fence', body }, host)`; the core classifies the fence (reference / inline / unreadable / empty) and resolves the file, so file states are data, not errors.
6. **D-1453** The editor's live results use `query_run({ kind: 'def' })` on the in-memory definition; nothing is written until the commit.
7. **D-1454** A commit sends the whole definition (`query_apply`); the core diffs effective values per top-level key and writes only changed keys; the title is never part of a commit.
8. **D-1455** Filter items carry `src` (their position in the file) so unchanged items keep their lines; unexpressible items travel as `raw` and are never re-emitted.
9. **D-1456** An item's first key is the filter; further keys are extras, kept verbatim also when the item's filter changes.
10. **D-1457** A replaced one-line key keeps the bytes from the whitespace before ` #` to the line end; a missing changed key is inserted at its R138 create-order place; `version` is never added and keys are never removed.
11. **D-1458** Every query write is parsed back and refused with `Unreadable` unless it reads as the intended definition (as D-1129).
12. **D-1459** Every comparison except `is_empty` / `is_not_empty` needs a value: `is_not`, `ne` and date operators never match empty values.
13. **D-1460** Numbers match only YAML numbers; checkbox `is: false` matches anything but `true`.
14. **D-1461** `within_next_days` takes an integer 0…3650; `between` with `a > b` is a broken value; `limit` outside 1…1000 in a file is a broken key.
15. **D-1462** A `sort.by` that isn't `title`, `created`, `modified` or a valid attribute is a broken `sort`; a missing `order` is `asc`.
16. **D-1463** A `this` in any valid filter on a host-less run gives `needsHost`; a date `this` on a non-daily host gives `needsContext`; both return no rows.
17. **D-1464** The fence's info string's first word must be exactly `query` (meta allowed), in Rust and TS; `ReadView` becomes case-sensitive.
18. **D-1465** The index stores each note's `saved:` names (`Stored.queries`) for usages; templates are scanned per call.
19. **D-1466** `type-move` and `folder-move` patch query-file link values like `note-rename` (`QueryPatch::ObjectMoved`), so path-form links keep their targets.
20. **D-1467** Link patches write the D-184 text of the moved note (stem when unique, else path), keep `|alias` / `#sub`, and never touch `modified` or `this`.
21. **D-1468** `query-rename` is a job with backup and Undo; the query file's `title:` patch is Rust, the usages' `saved:` patch is the `@tegg/doc` op `rename-saved-query`, pins via `PinPatch::QueryRenamed`, last.
22. **D-1469** The FR-TYP-04 patch shapes (`OptionRenamed`, `KeyRenamed`, `TypeKeyRenamed`) are defined now with no emitter.
23. **D-1470** Top-level fences stay `rawBlock` `kind: 'query'`; nested ones stay `codeBlock` `language: 'query'` drawn by a content-less node view through the same `EditorUi.query` hook.
24. **D-1471** A draft block is a `rawBlock` with `draft: true` that is never serialized; `dropQueryDraft` removes it without history.
25. **D-1472** `vault:changed` now carries `.tegg/queries/*.yml` and `_templates/**/*.md` paths; a new `query:stale { types, paths }` event carries the changed objects' types before and after.
26. **D-1473** The UI's re-run rule is §2.3 (query file, types, targets, rows, host, date change), debounced 300 ms, never while the host is being typed in.
27. **D-1474** Trash moves a query to `.trash/.tegg/queries/` with a free ` (n)` stem when taken; restore uses a free stem too; bytes never change; trash takes no base.
28. **D-1475** Lookup by name: live exact NFC stem first, else the first `name_key` match in NFC byte order; trashed: the newest file whose stem (minus a ` (n)` suffix) matches.
29. **D-1476** Undo of a commit is `query_revert` with the bytes `query_apply` returned, only while the block or page still has the focus.
30. **D-1477** `query_create { free: true }` (draft, Duplicate) takes ` (2)`… in the name and title; `free: false` (dialog, Save as, Create it) answers `NameTaken`.
31. **D-1478** FR-FMT-07 AC-29's added filter is `- rozpočet: { gt: 5000 }`, appended; `Save as query…` writes the fence's unknown keys and comments after `modified`.
32. **D-1479** Commands are `queries_list`, `query_get`, `query_run`, `query_apply`, `query_revert`, `query_create`, `query_duplicate`, `query_rename`, `query_trash`, `query_restore`, `query_usages` in `shellq.rs`; errors as §2.
33. **D-1480** Route `query/<name>` carries the NFC name unencoded (names never hold `/` or `#`).
34. **D-1481** R145's `block.*`, `editor.*`, `picker.*`, `newQuery.*` keys are prefixed `query.` in the catalog (`picker.title` exists).
35. **D-1482** The block's DOM contract is §4.3 (`figure[data-query-block]` with `data-query-state`, `data-query-result` rows, `data-filter` rows); a query table keeps at most 60 rows in the DOM.
36. **D-1483** The block's results count is its `aria-description` (`{count} results`), the visible count `aria-hidden`.
37. **D-1484** Pins list `query:` items as rows (`ok`, `trashed`, `missing`, never `pending`); an unreadable query is pinnable.
38. **D-1485** `queries.sort` is a global machine-local UI-state key (`UiStateDto.queries.sort`), default `created-desc`.
39. **D-1486** `Create it` creates the default file (`free: false`) and opens the editor on the block, which shows the default's results (§9 problem 2).
40. **D-1487** Query rows carry `type_rows`-style `values` for the effective columns plus `type`, `tags` and task bits; the UI formats them.
41. **D-1488** The fake twin is `app/ui/test/fake-queries.ts` with the §5 entry points and hooks `queryCalls`, `queryRuns`, `queriesFail`, `queriesNotReady`.
42. **D-1489** Trashed query rows in the Trash view use `pinned.kind.query` as their kind label.
43. **D-1490** The new-object footer passes its pre-filled values as `Route.prefill` on `new/<type>` (not in the route string), written with the draft's first write.

## 9. AC problems (fixed in the ACs as D-1491…D-1495, owner 2026-11-10)

1. **FR-QRY-09 AC-3 names jobs that don't exist.** Renaming a **used** option is refused (`Renaming used options comes
   in v1.0`, D-227, D-473; AP-771 kept it out of 4E), renaming an attribute key is W (D-806), and type keys are fixed
   (D-221). So "rename `Aktivní` to `Běží` … rewrites `Projekty v běhu.yml`" and "rename `stav` to `fáze`" can't be run;
   D-1434's list of type jobs has the same gap. Testable now: the attribute-delete part and the external-edit part.
   Proposal: mark those two sentences `[later]` (the option-rename / key-rename slice), keep the rest; §1.8 defines the
   patch shapes for it.
2. **FR-QRY-06 AC-12 `Create it` → "the block shows the draft text"** contradicts FR-QRY-01 AC-1 and FR-QRY-06 AC-13: a
   saved query with no types and no filters lists every object (21 / 20), and R141's empty-draft state exists only for
   an unsaved draft. Proposal (D-1486): `Create it` creates the default file and opens the editor on the block; the
   block shows the default's results.
3. **NFR-OTH-02 AC-17 "exactly R145's keys".** R145 lacks texts the ACs require (`Untitled query`, `A live list of
   objects`, `Mixed types: only columns every object has.`, `Edit the task to change it.`, `Ignored: …`, `New <type>`,
   `· links to this note`, the read-only description, the sort labels `Created ↓` …, the operator labels, `Create` /
   `Cancel`, route names and purposes, and labels for `Remove <type>`, the attribute / operator / value controls), and
   its `picker.title` collides with the existing `picker.title` (`Choose {name}`). Proposal: R145 adds §4.5's keys and
   takes the `query.` prefix of D-1481.
4. **FR-QRY-05 AC-6 "the list on Porada 14 follows within 1 s"**: the table is `Úkoly z této schůzky`, used only on
   Porada 7; Porada 14 uses `Otevřené úkoly z této schůzky` (a List). Proposal: check a runtime second fence of
   `Úkoly z této schůzky` (e.g. in Porada 14) instead.
5. **FR-QRY-06 AC-10 "creates `Untitled query (2).yml` … and writes the fence `saved: Untitled query`"**: when the name
   is taken, the fence must name the created query, `saved: Untitled query (2)`. Proposal: read it so (§4.4).


## 10. Red-test decisions (D-1496…D-1504, owner 2026-11-10)

These override the sections above where they differ.

- **D-1496** A usage changed after the rename job's scan: The `query-rename` job stops before any write when a usage note changed since its scan (FR-QRY-06 AC-6 as approved); contract §1.8's "skip as `changed`" is replaced. Nothing is written; the dialog says which note changed.
- **D-1497** FR-QRY-06 AC-9's count: The block inserted in Lisabon shows three results (the host is never its own result, D-1441); the AC said four.
- **D-1498** Query pins while the index loads: pinned.md FR-HOM-02 AC-20 covers object pins only: a `query:` pin is resolved without the index and a missing one shows `Not found` at once (D-1484). The AC-20 tests run without the query item.
- **D-1499** The read view's placeholder list: The `query` row leaves read-view R5 (`IN_NOTE_PLACEHOLDERS` empty), as note embeds did in 4F; contract §3.2's "null: the R5 placeholder" is dropped.
- **D-1500** The twin's own tests: The fake twin's conformance tests live in `app/test/fake_queries.contract.test.ts` (as `fake_pins.contract`), not in an AC file; `queries_twin.ac.test.ts` keeps FR-FMT-06 AC-4 only. Contract §6.1 is read so.
- **D-1501** Query pins in the pins fake: The build adds `query:` pins to `app/ui/test/fake-pins.ts` (§1.9); it is test infrastructure, not an AC test, so no trailer.
- **D-1502** Slice Q speed tests: As slice PIN: the `nfr_perf_*` timings of slice Q are reported and enforced only with `TEGG_PERF_STRICT` / `TEGG_PERF_REF=1` at the release gate, so debug builds don't fail a push.
- **D-1503** The `query-ready` mark: A performance mark `query-ready` is written once when every query block of the opened note has painted its first rows (NFR-PERF-05 AC-5).
- **D-1504** A byte copy of a query file: A copy made outside Tegg keeps its `title:`, so its row shows that title (two rows may share it; names stay unique by file stem); FR-QRY-06 AC-17 checks counts and that the copy is untouched.

## 11. QA decision D-1510 (owner 2026-11-11)

- `Jobs::start(JobOp::QueryRename …)` refuses at once (before any plan, job or backup; it checks `index_ready` without waiting for the index lock) with `QueryError::IndexNotReady` while `index_ready` is false (the first index build after open hasn't ended); nothing is written, no job, no backup. IPC: `query_rename` answers error kind `IndexNotReady`. UI: the rename dialog shows the catalog string `query.rename.notReady` = `Queries can be renamed once the vault has finished loading.` and keeps the typed name. The fake core refuses the same way while `queriesNotReady(true)`. FR-QRY-06 AC-22.
