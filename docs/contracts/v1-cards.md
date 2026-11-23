# Contract: Object cards, property icons and the icon picker (v1.0 slice OC)

Public interfaces of slice **OC**, for the test author (D-61) and the build. ACs: `docs/acceptance/cards.md` (R209…R218;
FR-TYP-11 AC-5…AC-29, FR-TYP-01 AC-12…AC-21, FR-TYP-12 AC-4, FR-LNK-14 AC-15, AR-07 AC-11, FR-FMT-07 AC-36, FR-FMT-12
AC-15, FR-SYN-02 AC-14, FR-SYN-03 AC-35, FR-SYN-06 AC-51, FR-STO-07 AC-15, NFR-POR-01 AC-7, NFR-PERF-07 AC-6, FR-UX-03
AC-54, AC-55, FR-UX-08 AC-26, FR-UX-05 AC-26, NFR-OTH-02 AC-24) and the table "Existing criteria this slice changes";
`types.md` slice OC part (R12 after OC, FR-TYP-01 AC-22…AC-28, FR-EDT-07 AC-22); `views.md` part four (FR-QRY-05 AC-30,
AC-31); `embeds.md` FR-EMB-02 AC-19…AC-21; `previews.md` part four (FR-LNK-10 AC-17…AC-19); `app-shell.md` R219, R1
changes, FR-UX-02 AC-22…AC-26. Decisions D-2054…D-2074 (plan `docs/plans/oc-object-cards-and-settings-plan.md`, BRD
v1.238, v1.239), D-2075 (2 MiB commit limit), AP-1571…AP-1604 = D-2076…D-2109 (BRD v1.241). Boards
`design/edit-note-page/TypeCards`, `CardSettings` (A, B, D, E; **the content of sections C and D is never copied**, D-2074, D-2171), `IconSet`,
`Settings`, `SettingsApp` and their Dark variants. Fixtures: `tests/fixtures/vaults/views/` + `new-empty/.tegg/` + the
overlay `tests/fixtures/vaults/cards/` (README there); `views-tasks/` for Task criteria; `previews/` for FR-LNK-10.

**Status: approved, 2026-11-22.** CP-1 (§16) is D-2110 (as proposed); the AC problems of §17 are fixed in the ACs as
D-2111; `Credits.rtf` also carries `d3-force`'s licence (D-2112). BRD v1.242. Where this contract and the ACs disagree, the ACs win and this contract is corrected
before the red tests.

This contract **extends** [ms3-shell.md](ms3-shell.md) §14 (type DTO, `type_patch`, `@tegg/schema`),
[type-columns.md](type-columns.md) (the closest precedent: a list key in the type file, its unreadable and ignored
forms, the seed on first write, the pure write helpers), [v1-views.md](v1-views.md) (part one §1.6, §4.3, §4.8; part three
§24.4, §27, §29.5, §30), [ms4-embeds.md](ms4-embeds.md) (`embed_load`, the card mode), [v1-previews.md](v1-previews.md)
(the preview's `Preview properties` region) and [ms4-links.md](ms4-links.md) (duplicate details, D-289). Every rule
there holds unless a section here changes it; §1.3 lists what this contract supersedes.

Words: **card list**, **effective keys**, **ObjectCard**, **pill area**, **pill**, **empty value**, **Inbox member** as
in cards.md "Shared definitions". A **card data** is what one card needs from the core (§3.2). An **old icon name** is
one of the 24 names of types.md R14. **Canonical** icon name: the Lucide 0.460 name an icon name resolves to (itself,
or the alias target, §5.3).

## 1. What OC writes and reads

### 1.1 Writes

| Action | Writes | Through |
| --- | --- | --- |
| Card section: remove, add, reorder (drag, ⌥↑/⌥↓, palette `Add property to card…`) | the type file's `card:` line (inserted, replaced; a block list becomes one flow line) | `type_patch` `{ op: 'card', keys }` → `TypeOp::SetCard(Some(keys))` |
| `Reset to default` (button, palette `Reset card to default`) | removes the `card:` lines | `type_patch` `{ op: 'card', keys: null }` → `TypeOp::SetCard(None)` |
| Property icon from the picker; `None (show the name)` | the attribute item's `icon:` line (inserted after `type:`, replaced, removed) | `type_patch` `{ op: 'attributeIcon', key, icon }` → `TypeOp::SetAttributeIcon` |
| Type icon from the picker (General's `Change icon`, palette `Change type icon…`) | the top-level `icon:` line | `type_patch` `{ op: 'set', field: 'icon', value }` (existing) |
| Delete property (no-value path, and the 4E job) | the item, and the key's entries in `preview`, `card`, `hidden`, `columns` in the same change | `TypeOp::RemoveAttribute` (extended, §2.3) |
| Views section: reorder, remove, `Add view`, `Edit`, Task's `Restore default views` | as on the type page (v1-views part one §1.3, part two §14, part three §25.3) | the same calls as the type page |
| An icon choice (any picker) | `ui-state.json` `recentIcons` (Application Support) | `ui_state_set` (existing, §10) |

Nothing else. Opening the vault (also the first launch of 0.6.0 on a 0.5.x vault), drawing any card, opening any
`type-settings/<key>`, `Add property` and Esc, any picker and Esc, the example card and every `settings/*` route write no
vault file (FR-SYN-06 AC-51). New, starter and built-in type files are written without `card` and attribute `icon`
(D-2059, AR-07 AC-11). No job and no restore point is added (a Card or icon change is one type-file line, as `columns`).

### 1.2 Reads

| Surface | Calls | Card data from |
| --- | --- | --- |
| Board views (type-page tabs, `query/<name>`, board blocks) | one `query_run` per board (unchanged) | `QueryRowDto.card` (§3.3) |
| Tasks `Schedule`, `Kanban`, board views over Task | one `query_run` | `QueryRowDto.card` + `taskRow` |
| A Daily Note's `Tasks due` | `daily_tasks` (unchanged) | `TaskRowDto.card` |
| Card embeds (editor, read view), previews, link hovers, the graph's preview | one `link_resolve` and one `embed_load` per level (unchanged, D-429) | `EmbedNoteDto.card` |
| Switcher-style lists, link suggestions, relation picker, `duplicate-titles` | unchanged | `DuplicateDetailsDto.preview` (now from the card list, §3.5) |
| `type-settings/<key>` `Example card` | `type_card_example(key)` once when the section mounts | `CardExampleDto.card` |
| Type, property and lead icons everywhere | `vault_types` / `type_get` (unchanged calls) | `TypeDto.resolvedIcon`, `AttributeDto.resolvedIcon` (§5.4) |
| The icon picker | the lazily loaded data chunk (§5.5), once per window | — |

No surface sends a read per card (D-784, FR-TYP-11 AC-18, FR-EMB-02 AC-21).

### 1.3 What this contract supersedes

| Place | Now |
| --- | --- |
| ms3-shell §14.3 `TypeOpDto` `preview` op used by Type settings and `Add column` | no UI sends it any more (D-2054); the op and `TypeOp::SetPreview` (with its 4-limit) stay for tests and the core |
| ms3-shell §14.7 `PreviewSection`, R14's `Icon` listbox | the `Card` section (§7.5) and the icon picker (§7.7) |
| type-columns §1 last bullet (`SetPreview` keeps its 4-limit) | unchanged; R130's fallback columns still read `preview` (D-2077) |
| v1-views §29.5, §28.2 rows `BoardCard.tsx`, `tasks/TaskCard.tsx` | every board card is `ObjectCard` from the row's `card` (§6, §7.4); `BoardCard.tsx` goes, `TaskCard` the component goes (its parts stay) |
| v1-views §4.3 / §30.1 rows `Card`, `Board card` (pills in `preview` order, the empty `No <Name>` pill) | §8.1 |
| ms4-embeds §6 card mode (header + `StripList`), v1-previews §3.4 strip | `ObjectCard` in the frame (D-2092); the preview's region holds the card's pills and link chip (D-2093) |
| ms4-links duplicate details "up to 2 preview values" (D-289) | the first two set pill values of the card list (D-2094, §3.5) |
| `shell/Icon.tsx` `TYPE_ICONS`, `typeIconName` for type icons | type icons are drawn from `resolvedIcon` (§5.4; CP-1); the hand-drawn `PATHS` stay for app chrome |

## 2. `tegg-schema` (`crates/tegg-schema`)

### 2.1 Model (additions)

```rust
pub struct AttrDef {
    // …ms3-shell §14.1.1…
    /// D-2070 (R209): the item's `icon:` value as written (trimmed); None = no `icon:` line or not a string.
    pub icon: Option<String>,
}
pub struct TypeFile {
    // …
    /// D-2059 (R209): the `card:` keys as written (NFD kept), flow or block list; None = key absent, or present and
    /// unreadable (then `Parsed.card_unreadable`).
    pub card: Option<Vec<String>>,
}
pub struct Parsed {
    // …
    /// D-2076 (AP-1571): `card` is present but not a list of strings (scalar, mapping, a list holding a non-string).
    pub card_unreadable: bool,
    /// D-2076: `card` entries (NFC) that are neither an attribute key nor a card built-in (§2.2), each once, in file
    /// order; `title`, `review` and `file`-kind attribute keys are skipped silently (not listed).
    pub card_ignored: Vec<String>,
}
```

Reading: as `columns` (type-columns §1): a `card` value that isn't a list of strings doesn't make the file invalid
(AR-07 AC-4 unchanged); an attribute `icon` that isn't a string reads as None and its line is kept. `CURRENT_VERSION`
stays 1 (D-2060).

### 2.2 The card list (the one place, `crates/tegg-schema/src/card.rs`, re-exported)

```rust
/// R209: the built-in keys a card list may hold besides attribute keys, in the order `Add property` offers them.
pub const CARD_BUILT_INS: [&str; 7] = ["tags", "body", "description", "source", "aliases", "created", "modified"];
/// R210: undefined types, invalid type files.
pub const CARD_FALLBACK: [&str; 3] = ["tags", "body", "modified"];

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CardList {
    /// R209 "card list": `card:` as written when present and readable (unknown keys, repeats and `title` included),
    /// else R210's default.
    pub list: Vec<String>,
    /// True when `list` is R210's default (no readable `card:`, or Tag).
    pub default: bool,
    /// "Effective keys" (NFC, the attribute's own spelling): `list` without unknown keys, repeats (first kept),
    /// `title`, `review` and `file`-kind attribute keys.
    pub keys: Vec<String>,
}
/// R210 for a defined type (system table, Tag fixed, user types from `preview`).
pub fn default_card(def: &TypeFile) -> Vec<String>;
/// R209 + R210 for a parsed file: Invalid → CARD_FALLBACK; `tag` → `[body, modified]` whatever the file says;
/// otherwise `card` when Some, else `default_card`. Newer files are read (FR-TYP-11 AC-27 (d)).
pub fn card_list(parsed: &Parsed) -> CardList;
/// A `type` value without a definition (D-121).
pub fn card_list_undefined() -> CardList;
```

- **Defaults** (R210, D-2079): `page` `tags, body, modified`; `task` `tags, body, status, due, priority, recurrence,
  source`; `quick-note` `body, created`; `daily-note` `body, modified`; `image` `width, height, size, created`; `pdf`
  `tags, pages, size, created`; `tag` `body, modified`. A user type: `tags`, `body`, then each `preview` key (NFC) that is
  an attribute key or one of `tags`, `source`, `aliases`, `created` (others skipped), then `modified`; a repeated key
  counts once (first place). System keys use the table whatever their `preview` says.
- **Matching** (FR-FMT-12 AC-15): a list entry matches an attribute when their NFC forms are equal; `keys` holds the
  attribute's key as the file spells it, NFC-normalised. Built-ins match NFC-exact, lower case only (`Tags` is unknown).
- **Corpus:** `tests/fixtures/types/card-lists.json` (new, written by the test author from R209, R210 and FR-TYP-11 AC-5,
  AC-6, AC-26): `[{ "name", "key", "file": "<type file text>" | null, "expected": { "list", "default", "keys",
  "ignored", "unreadable" } }]`; `null` = undefined type. Read by `crates/tegg-schema/tests/ac_card_type_file.rs` and by
  the TS twin's L1 test (§6.1, `cardList` in `@tegg/schema`).

### 2.3 Writing (changes to ms3-shell §14.1.4)

- **Order.** `TOP_ORDER` gains `card` after `preview`: `version, name, plural, system, folder, icon, color, description,
  review, preview, card, hidden, columns, views, embed, template, attributes` (D-2076: "after `preview`, else after
  `review`" is the nearest-preceding-key rule). `ITEM_ORDER` gains `icon` after `type`: `key, name, type, icon, default,
  required, options, to, multiple, description`. `serialize` writes `card` only when `def.card` is Some and an item's
  `icon` only when Some, so new, starter and built-in files are byte-identical to their fixtures (AR-07 AC-11).
- **`TypeOp::SetCard(Option<Vec<String>>)`.** `Some(keys)`: writes only the `card` line(s) as one flow list
  (`render_top`), keys NFC, in the given order, repeats as given (the UI's helpers decide them, §6.1); inserted at its
  TOP place when absent; a block list is replaced by the one flow line; `card: []` is a valid value. A no-op when the key
  exists, is readable and equals `keys` after NFC. `None`: removes the `card` key's lines (a no-op when absent).
  Refused with `RuleError::CardUnreadable` when `card_unreadable` (D-2076: fixed in the file first), both forms.
- **`TypeOp::SetAttributeIcon { key: String, icon: Option<String> }`.** `Some(name)`: the item's `icon:` line written
  `    icon: <name>` (plain scalar, NFC, trimmed), inserted right after the item's `type:` line (ITEM_ORDER), replaced in
  place when present. `None`: removes the item's `icon:` line. A key with no attribute item (universal keys) is a
  no-op. **Never `BuiltInChanged`** (D-2099): it is the one item change allowed on a `built_in` attribute. A no-op when
  the current value equals the new one byte for byte **or both resolve to the same canonical name** (§2.4; so choosing
  `square-check-big` where `check-square` is written writes nothing, D-2103).
- **`TypeOp::SetIcon`** gains the same canonical equality (D-2103); otherwise unchanged (no validation of the name; the
  picker offers only Lucide names).
- **`TypeOp::RemoveAttribute(key)`** also removes every `card` entry NFC-equal to the key (repeats included) in the same
  write, as it does for `preview`, `hidden` and `columns` (D-2077; FR-TYP-11 AC-28). When `card_unreadable` the `card`
  lines are left as they are. The 4E delete-property job's type-file change uses the same op, so its Undo restores the
  exact bytes as today.
- **Every other op** leaves the `card` lines and every item's `icon:` line byte-identical (they are untouched lines:
  `UpdateAttribute` rewrites only the fields of its own list, `MoveAttribute` moves the item's lines unchanged).
- **`RuleError::CardUnreadable`** (new) → IPC reason `cardUnreadable`. `SchemaError` is unchanged.

### 2.4 Icons (`crates/tegg-schema/src/icons.rs`, re-exported as `tegg_schema::icons`)

```rust
pub const LUCIDE_VERSION: &str = "0.460.0";
/// One element of a Lucide icon node: the SVG tag (`path`, `circle`, `rect`, `polyline`, `line`, `polygon`,
/// `ellipse`) and its attributes in file order.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IconEl { pub tag: String, pub attrs: Vec<(String, String)> }
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ResolvedIcon { pub name: &'static str, pub node: &'static [IconEl] }
/// D-2067: the name itself when it is a Lucide 0.460 name, else its alias target (§5.3); None for anything else
/// (unknown, empty, any non-ASCII character: FR-FMT-12 AC-15).
pub fn resolve_icon(name: &str) -> Option<ResolvedIcon>;
/// types.md R14's 24 names (the list `ICONS` held), kept only to test D-2067.
pub const OLD_ICON_NAMES: [&str; 24];
```

The data comes from the committed files of §5 through `include_str!` (as `builtin()` does with the new-empty files),
parsed once on first use (`LazyLock`). No file system, no network (AR-03, NFR-SEC-01).

## 3. Core and index (`tegg-core`, `tegg-index`)

### 3.1 `TypeInfo` (additions, `crates/tegg-core/src/types3d.rs`)

```rust
pub struct TypeInfo {
    // …
    /// §2.2 `card_list(&parsed)`.
    pub card: tegg_schema::CardList,
    pub card_ignored: Vec<String>,
    pub card_unreadable: bool,
}
```

The core keeps a `card` per type key in the definitions every run reads (`Defs` in `queries_q.rs`, the maps of
`links4a.rs`, `tasks5a.rs`, `embeds4f.rs`), taken from `TypeInfo.card`, never recomputed from `TypeFile`. A matched key
without a definition uses `card_list_undefined()`.

### 3.2 Card data (`crates/tegg-core/src/cards.rs`, new)

```rust
/// Everything one ObjectCard draws besides its type's definition (plan §4.3; FR-TYP-11 AC-18).
#[derive(Debug, Clone, PartialEq)]
pub struct CardData {
    /// The matched type key (D-239) and the title (falls back to the stem, ObjectInfo rule).
    pub r#type: String,
    pub title: String,
    /// The effective keys the values were taken for (`CardList.keys` of the type), in order.
    pub keys: Vec<String>,
    /// One entry per key of `keys` except `body`, the frontmatter value as written (JSON; `null` when absent). Special
    /// keys: `tags` → the object's tags as the index has them (frontmatter then inline, D-185 spelling, one per key, NFC)
    /// as a JSON list of strings; a `date-range` attribute `k` → the two entries `k-start`, `k-end` (no `k`).
    pub values: serde_json::Map<String, Value>,
    /// `text::excerpt` of the body (D-482) when `body` is in `keys`, else None (no note text read).
    pub excerpt: Option<String>,
    /// Resolution (from the object's own path) of every wikilink in the values of `relation` keys and of `source`, in
    /// key order then value order, unresolved ones included (`LinkTarget.target` = the text inside `[[…]]`).
    pub links: Vec<LinkTarget>,
    /// D-600 / R61: an Inbox member (`inbox5b::member`, made `pub(crate)`).
    pub unreviewed: bool,
    /// Image and PDF objects: the resolution of their first `file`-kind attribute's value (kind `media` when the file
    /// exists, `unresolved` when it doesn't); None for other types or no value.
    pub file: Option<LinkTarget>,
}
impl Core {
    /// D-2096 (AP-1591): the type's most recently modified object (its `modified` instant, newest first; a missing or
    /// unreadable `modified` last, D-1927; then path) as card data whose `keys` are **every candidate key**: the
    /// attribute keys in schema order (no `file`-kind) then `CARD_BUILT_INS`; `excerpt` always read. None: no object.
    pub fn type_card_example(&self, key: &str) -> Option<CardExample>;
}
pub struct CardExample { pub path: String, pub card: CardData }
```

- **One builder**, `cards::card_data(o: &QueryObject, objs, by_path, keys: &[String], state: Option<&NoteState>)`, used
  by every surface under the read's one index lock; the excerpt comes from `Index::note_state` (body as indexed) only
  when `body` is in `keys`, else `note_version` (v1-views §24.4).
- **Values are raw.** The core never applies R212's drawing rules (empty, `—`, formatting); the UI does (§6.1). The one
  exception is §3.5, which needs the empty rule in Rust: `cards::is_empty_value(&Value) -> bool` (R212 last row: missing,
  `null`, `""`, `[]`, a string that is only U+2014 after trimming spaces, a list whose items are all empty by that rule),
  tied to the TS `isEmpty` by `tests/fixtures/types/card-empty.json` (new: `[{ "value", "empty" }]`).

### 3.3 Where card data is filled

- **`query_run`** (v1-views part one §1.6, part three §24.4): `QueryRow` gains `pub card: Option<CardData>`, Some on
  **board runs only** (`group.is_some()`), for every row, with the row's own type's keys. List and Table runs: None and
  `note_version` only (no excerpt, v1-views §24.4; `Přečtené 2026` asks for none, FR-TYP-11 AC-18). `QueryRow.excerpt`
  keeps its type and becomes `card.excerpt.unwrap_or_default()` on board runs (one read per row only where `body` is
  effective). The grouping key stays in `QueryRow.values` as today (D-1769, the hidden key and the multi-value case).
- **Task rows** (`tasks5a.rs`): `TaskRow` (ms5-tasks §2.1) gains `pub card: CardData` with Task's keys, built from the
  same entry and the excerpt it already reads; so `daily_tasks`, `task_list` and `QueryRow.task_row` carry it.
- **`embed_load` / `embed_load_with`** (`embeds4f.rs`): `EmbedNote` gains `pub card: Option<CardData>`, Some for state
  `Ok` when the index holds the path (else None: the UI draws the lead and title only, and the next `vault:changed`
  refreshes it). Built under one index lock per call, for every path of the batch. Previews, link hovers and the graph's
  preview use the same field (they read through `embed_load`, v1-previews §3.4).
- **Nothing else changes** in those reads: same commands, same counts (FR-EMB-02 AC-21, FR-TYP-11 AC-18).

### 3.4 Live updates

A change under `.tegg/types/` already re-runs every mounted board, embed batch and preview (`vault:changed`, D-1891's
path); a card list or icon change therefore redraws within NFR-PERF-08's 2 s (FR-TYP-11 AC-19, FR-TYP-01 AC-13). The
type store refreshes `vault_types` on the same event (ms3-shell §14.3).

### 3.5 Duplicate details (`links4a.rs` `details`; FR-LNK-14 AC-15, D-2094)

`DuplicateDetails.preview` keeps its name and shape (`Vec<(String, Value)>`) and now holds the **first two set pill
values** of the object's card list: walk `keys` in order, skip `tags`, `body`, `description`, `created`, `modified`,
every `relation` key, `source` when its value is a wikilink or an `http(s)`/`file` URL, and every `url` key (link chips,
R212); a `multi-select` or `aliases` value contributes one entry per non-empty item (`(key, item)`), any other key one
entry; `checkbox` only when `true`; empty values (§3.2) skipped; stop at two. The UI formats them as today (40
characters each). Still one read per list (the same call as today).

## 4. IPC

### 4.1 Commands

| Command | Change |
| --- | --- |
| `vault_types`, `type_get` | `TypeDto`, `AttributeDto` additions (§4.2) |
| `type_patch` | `TypeOpDto` gains `card` and `attributeIcon`; error reason `cardUnreadable` |
| `query_run` | `QueryRowDto.card: CardDataDto \| null` |
| `embed_load` | `EmbedNoteDto.card: CardDataDto \| null` |
| `daily_tasks`, `task_list` | `TaskRowDto.card: CardDataDto` |
| `type_card_example` (new) | `key: string` → `CardExampleDto \| null` (`Core::type_card_example`); read-only, one index read |
| `ui_state_get` / `ui_state_set` | `UiStateDto.recentIcons` (§10) |
| link suggestions, switcher, relation picker, `duplicate_titles` | unchanged shape; `preview` per §3.5 |

No command is removed. No command fetches or returns the icon set (§5).

### 4.2 DTOs

```ts
/** Lucide's icon-node format: [tag, attributes]. */
type IconNodeDto = [string, Record<string, string>][];
/** §2.4: the canonical Lucide name and its drawing. */
type ResolvedIconDto = { name: string; node: IconNodeDto };

type TypeDto = { /* ms3-shell §14.3, type-columns, v1-views */
  cardList: string[];            // R209 card list (§2.2 `list`): `card:` as written, else R210's default
  cardDefault: boolean;          // FR-TYP-11 AC-5 "whether it is the default"
  cardKeys: string[];            // effective keys (§2.2 `keys`)
  cardIgnored: string[];         // the section's warning (R214)
  cardUnreadable: boolean;       // section read-only with `typeSettings.cardUnreadable` (FR-TYP-11 AC-26 (d))
  resolvedIcon: ResolvedIconDto | null;   // the type's `icon` resolved (§5.4); null = unknown → R14's generic icon
};
type AttributeDto = { /* … */
  icon: string | null;           // as written (FR-TYP-01 AC-12)
  resolvedIcon: ResolvedIconDto | null;   // null: no icon, or an unknown name ("known" = icon !== null && resolvedIcon !== null)
};
type AttributeInputDto = Omit<AttributeDto, 'supported' | 'readOnlyReason' | 'builtIn' | 'resolvedIcon'>;  // `icon` is sent as null; addAttribute never writes one
type TypeOpDto = /* … */
  | { op: 'card'; keys: string[] | null }                    // null: Reset to default (removes the line)
  | { op: 'attributeIcon'; key: string; icon: string | null }; // null: None

type CardDataDto = {
  type: string; title: string;
  keys: string[];
  values: Record<string, unknown>;
  excerpt: string | null;
  links: LinkTargetDto[];        // review/status/due/completed null, as in query rows
  unreviewed: boolean;
  file: LinkTargetDto | null;
};
type QueryRowDto = { /* Q, Q2, Q2-T */ card: CardDataDto | null };
type EmbedNoteDto = { /* 4F */ card: CardDataDto | null };
type TaskRowDto = { /* 5A */ card: CardDataDto };
type CardExampleDto = { path: string; card: CardDataDto };
type UiStateDto = { /* … */ recentIcons?: string[] };
```

Unchanged: `type`, `preview`, `previewIgnored` (still sent; read by R130's fallback columns and the Tag page).

### 4.3 Rust and TS files

`app/src-tauri/src/shellcards.rs` (new: `CardDataDto`, `CardExampleDto`, `ResolvedIconDto`, `fn card_dto`,
`fn icon_dto`, the command `type_card_example`); `dto.rs` (`TypeDto` / `AttributeDto` fields, filled by `icon_dto` from
`tegg_schema::icons::resolve_icon` at DTO build; `TypeOpDto::Card`, `TypeOpDto::AttributeIcon`; `EmbedNoteDto.card`;
`UiStateDto.recent_icons` with `#[serde(default, skip_serializing_if = "Option::is_none")]`); `shellq.rs`
(`QueryRowDto.card`), the task row DTO (`card`); `lib.rs` (`invoke_handler`), `build.rs` (`"type_card_example"`),
`capabilities/default.json` (`"allow-type-card-example"`), the generated
`permissions/autogenerated/type_card_example.toml`. TS: `app/ui/src/ipc/cards.ts` (`typeCardExample(key)`),
`ipc/types.ts` (ts-rs bindings regenerated), `ipc/queries.ts` (`QueryRowDto.card`), `packages/schema/src/index.ts`
(the structural `TypeDto` / `AttributeDto` copies gain the fields).

### 4.4 UI error handling

As every `type_patch` (ms3-shell §14.3, FR-TYP-01 AC-7): `Conflict` → the types store takes `disk`, the section shows
the disk state, alert `ts.conflict` with `{field}` = `Card` (`typeSettings.card`) or `Icon` (`ts.icon`);
`NewerVersion` / `InvalidType` never reach the server (controls aria-disabled, §7.5); `Rule` `cardUnreadable` → the
section's reason text. `type_card_example` failing → the example shows the empty form of AC-25 (no alert).

## 5. The icon data

### 5.1 The data file

- **Path:** `packages/schema/data/lucide-0.460.0.json` (generated, committed; ~441 KB minified, under D-2075's 2 MiB).
- **Shape** (minified JSON, one line, keys of `icons` in code-point order):
  `{ "lucide": "0.460.0", "package": "lucide-static@0.460.0", "integrity": "sha512-X6pIdg7jVxv7YQ/uR241hwhNiztcAfmj181TbcX7HCxxk/3mGaRtAc6b2ftUvQBufbJE6ehgyzO2uVsa604tWg==", "count": 1539, "icons": { "<name>": { "n": IconNode, "k": ["<keyword>", …] } } }`
  where `n` is the package's `icon-nodes.json` entry as is and `k` its `tags.json` entry (empty list when absent).
- Read by the Rust core (`include_str!("../../../packages/schema/data/lucide-0.460.0.json")`, §2.4), by the UI's lazy
  module (§5.5), by the fake core (§13) and by L0/L1 tests. Never edited by hand.

### 5.2 The generator and its pin

- `tools/icons/gen-lucide.mjs` (Node ≥ 22, no dependencies), run by hand at dev time: `node tools/icons/gen-lucide.mjs`.
  Pinned constants: `VERSION = '0.460.0'`, `TARBALL = 'https://registry.npmjs.org/lucide-static/-/lucide-static-0.460.0.tgz'`,
  `INTEGRITY = 'sha512-X6pIdg7jVxv7YQ/uR241hwhNiztcAfmj181TbcX7HCxxk/3mGaRtAc6b2ftUvQBufbJE6ehgyzO2uVsa604tWg=='`.
- Steps: download the tarball into a temporary directory outside the repo; refuse unless its SHA-512 (base64) equals
  `INTEGRITY`; read `package/icon-nodes.json`, `package/tags.json`, `package/LICENSE` (gunzip + a minimal tar reader);
  refuse unless there are exactly 1,539 names, every alias target of §5.3 exists, and every old icon name resolves
  (by name or alias); write the data file (§5.1) and `app/src-tauri/Credits.rtf` (§5.6); print both sizes.
- `--check` (offline, run by `./verify commit` when either output or the script changes): re-derives nothing from the
  network; checks the data file's `lucide`, `package`, `integrity` against the script's constants, `count` = 1,539 =
  the number of names, names unique and ASCII, each with a non-empty `n` of known tags and a `k` list, and that
  `Credits.rtf` holds the LICENSE text (FR-TYP-01 AC-20 (a), L0).
- `lucide-static` is **not** a dependency of any package (no lockfile entry); AC-20 (a)'s "or" branch: the committed
  script records the version and integrity.

### 5.3 Aliases (D-2067, D-2103)

`packages/schema/data/icon-aliases.json`, hand-written: `{ "check-square": "square-check-big" }`. Read by the Rust core
(`include_str!`, `resolve_icon`), the UI resolver (§6.1 `icons/resolve.ts`) and the fake core. An alias is never written
to a file and never shown in the picker as its own option; searching an alias name lists its target first (§7.7).

### 5.4 Icons in use, without the set

The core resolves names: every `TypeDto` carries `resolvedIcon` and every `AttributeDto` its `resolvedIcon` (one icon
node each, a few hundred bytes). Everything that draws a type or property icon (cards, the sidebar, type pages and their
headers, tables, the attribute panel, chips, search rows, the capture window, the graph, the Card list, the picker's
`Current` mark) draws from these through `LucideIcon` (§6.1); `data-icon` is the name **as written** (D-2103). An
undefined type, or `resolvedIcon: null`, draws the existing generic `type` glyph (R14). So no surface loads the set
(FR-TYP-01 AC-20 (b)). Which surfaces switch from the hand-drawn system glyphs is CP-1.

### 5.5 Loading the set in the picker

`app/ui/src/icons/lucide-icons.ts` is the only module that imports the data file (`import data from
'../../../../packages/schema/data/lucide-0.460.0.json'`); `icons/load.ts` exposes `loadIconSet(): Promise<IconSet>`,
memoised, that does `import('./lucide-icons')`. Vite emits it as its own chunk, served as `assets/lucide-icons-<hash>.js`
(a JS chunk, not a `fetch`: the CSP's `connect-src` allows only IPC). It is requested on the first picker open of a
window and never again (FR-TYP-01 AC-20 (b)); nothing imports it statically (L0: no static import of `lucide-icons` or of
the JSON outside `icons/lucide-icons.ts`). A load failure shows `iconPicker.loadFailed` in the picker's status (§9) and
retries on the next open.

### 5.6 The licence (D-2105)

`app/src-tauri/Credits.rtf` (generated by §5.2): a plain RTF with the heading `Lucide 0.460.0` and the package's
`LICENSE` text verbatim (the ISC licence with its copyright line, which also names the Feather (MIT) portions).
`tauri.conf.json` `bundle.macOS.files` gains `"Resources/Credits.rtf": "./Credits.rtf"` (and the preview config inherits
it), so the built bundle has `Contents/Resources/Credits.rtf`, which the standard About panel (`About Tegg`, D-220) shows.
L6 reads it from the built `.app` (FR-TYP-01 AC-20 (d)). After Lucide's text it carries the heading `d3-force` and the `LICENSE` text of the installed `d3-force`
package (ISC), read by the generator from `app/node_modules/d3-force/LICENSE` (D-2112).

### 5.7 Offline (NFR-SEC-01)

Nothing is fetched at runtime: the set is in the bundle (UI chunk) and in the binary (core). The CSP is unchanged. Only
`tools/icons/gen-lucide.mjs` touches the network, at dev time, by hand.

## 6. UI modules

### 6.1 New

| Module | Owns |
| --- | --- |
| `packages/schema/src/cards.ts` (exported from `index.ts`; pure, the TS twin of §2.2 for the fake core and L1) | `CARD_BUILT_INS`, `CARD_FALLBACK`, `defaultCard(type)`, `cardList(type: { key; state; card: string[] \| null; cardUnreadable; preview; attributes }) → { list; default; keys }` (corpus §2.2), `isEmpty(value)` (corpus §3.2) |
| `app/ui/src/cards/model.ts` (pure, L1) | `cardParts(input: { type: TypeDto \| null; card: CardDataDto; task?: TaskRowDto \| null; hideKey?: string \| null; groupValues?: unknown; now: number; zone: string; region: string; dateSetting }) → CardParts`: `{ lead; strip: 'image' \| 'pdf' \| null; tags: { shown: string[]; more: number }; text: { from: 'body' \| 'description'; text: string } \| null; items: CardItem[]; footer: { link: CardLink \| null; date: { key: 'created' \| 'modified'; text: string; iso: string } \| null } }`; `CardItem = { kind: 'unreviewed' } \| { kind: 'pill'; key; name; icon: ResolvedIconDto \| null; value: string; dot: string \| null; invalid: boolean; title: string; label: string } \| { kind: 'link'; key; link: CardLink } \| { kind: 'local'; key; text; path }`; `urlChipText(url)`, `localItem(fileUrl)`, `footerDateText(key, value, typeKey, now, zone, region, setting)`, `moreHint(hidden: CardItem[])` (R211, R212, §7.1…§7.3) |
| `app/ui/src/cards/task.ts` (pure, L1) | D-1904's Task rules over `cardParts` (status hidden for the first option and as the grouping key, priority hidden for the last option / absent / Done, `due` as R44's label with `tone`, the source chip in the footer always, no text on Done) |
| `app/ui/src/cards/write.ts` (pure, L1) | the lists `type_patch` `card` sends: `cardRemove(type, key)` (every NFC-equal entry), `cardAdd(type, key)` (appends), `cardMove(type, key, delta)` (null when it can't move), `cardDrop(type, key, beforeKey)`; each starts from `type.cardList` (the default when `cardDefault`, D-2076's seed) and keeps unknown and hand-written entries at their places (type-columns §3 rules); `addChoices(type) → { attributes: string[]; builtIns: string[] }` (D-2097) |
| `app/ui/src/cards/ObjectCard.tsx` | the one card component (R211): props `{ path; card: CardDataDto; type: TypeDto \| null; surface: 'board' \| 'embed' \| 'example' \| 'tasks'; task?: TaskRowDto; hideKey?; groupValues?; head?: ReactNode /* embed: Open + Display as */; menu?; slot? /* board focus and drag props */; onOpen }`; `inert` for `example` |
| `app/ui/src/cards/CardPill.tsx` | one pill, one link chip, one local item, `+N more`, `Unreviewed`; also used by the preview's `Preview properties` region (D-2093) |
| `app/ui/src/cards/overflow.ts` | `useTwoRows(ref, items)`: measures the pill area's items (`offsetTop`), hides the ones after row 2 and places `+N more` (§7.2) |
| `app/ui/src/cards/CardSection.tsx` | type settings' `Card` section (R214, §7.5) |
| `app/ui/src/cards/cards.css` | card and section styles (tokens only, FR-UX-05 AC-2) |
| `app/ui/src/icons/LucideIcon.tsx` | `<LucideIcon icon={ResolvedIconDto \| null} dataIcon={string} size />`: `svg` `viewBox="0 0 24 24"`, `fill="none"`, `stroke="currentColor"`, `stroke-width="2"`, round caps and joins, `aria-hidden="true"`, children from the node; `null` → the generic glyph; `lucideElement(icon, dataIcon, size)` for DOM code (editor chips) |
| `app/ui/src/icons/resolve.ts` (pure, L1) | `resolveIcon(set: IconSet, name: string) → string \| null` (canonical name, via the aliases file), `typeIcon(types, key)`, `attrIcon(attr)` (from the DTOs) |
| `app/ui/src/icons/lucide-icons.ts`, `icons/load.ts` | §5.5 |
| `app/ui/src/icons/search.ts` (pure, L1; the oracle's subject) | `searchIcons(set, query) → { name: string; bold: [number, number] \| null }[]`, `suggestIcons(set, name: string) → string[]` (§7.7) |
| `app/ui/src/icons/recent.ts` | `RECENT_MAX = 12`, `pushRecent(list, canonical) → string[]` (pure), `recentIcons()` / `rememberIcon(name)` over the UI-state store (one `ui_state_set` per choice) |
| `app/ui/src/icons/IconPicker.tsx` | the picker (R215, §7.7), opened by `openIconPicker({ anchor, title, current, allowNone, onChoose })` |
| `app/ui/src/settings/SettingsLayout.tsx`, `settings/layout.css` | R219's shared layout (§7.10): `SettingsLayout`, `SettingsRow { label; labelFor \| labelId; note?; children }` |
| `app/ui/src/views/ViewsSection.tsx` | type settings' `Views` section (types.md FR-TYP-01 AC-25…AC-27, §7.9) |

### 6.2 Changed

| Module | Change |
| --- | --- |
| `queries/board/QueryBoard.tsx` | renders `ObjectCard` (surface `board`) from `row.card`, with `task` = `row.taskRow`, `hideKey` = the grouping key (except a period key), `groupValues` for D-1769 |
| `daily/DailyTasks.tsx` | `ObjectCard` (surface `tasks`) from `TaskRowDto.card` |
| `embeds/Embed.tsx` | card mode: the frame holds `ObjectCard` (surface `embed`) with `head` = `Open <title>` + `Display as` (no `⋯`, D-2092); `embeds/TaskEmbed.tsx` (R52) unchanged |
| `preview/PreviewContent.tsx` | the `Preview properties` region renders the card's items without tags, text and date (D-2093) through `CardPill` |
| `links/DuplicateDetails.tsx` | unchanged code; the values it gets follow §3.5 |
| `pages/TypeSettingsPage.tsx` | R12 after OC's ten sections in `SettingsLayout`; `PreviewSection` → `CardSection`; `DefaultViewsSection` → `ViewsSection`; Properties: one row expanded at a time, `Icon for <Name>` buttons; General: `Change icon` opens the picker |
| `pages/SettingsPage.tsx`, `pages/settings5b.tsx`, `pages/BackupsPage.tsx`, `pages/ShortcutsPage.tsx` | the same controls inside `SettingsLayout` / `SettingsRow` (no control added, removed or changed, FR-UX-02 AC-24) |
| `tables/HeaderCell.tsx` (type page and `queries/ResultsTable.tsx` headers), `types/AttributePanel.tsx` | property icons before header and label text (FR-TYP-01 AC-13, FR-EDT-07 AC-22); a header's icon is that of the attribute its Name comes from. The read view's `read/PropertiesStrip.tsx` shows no property icons in slice OC (D-2153) |
| `shell/Icon.tsx` | `TYPE_ICONS`, `SYSTEM_DEFAULT`, `typeIconName` removed for type icons (callers use `icons/resolve.ts` + `LucideIcon`; CP-1); `PATHS` / `Icon` stay for app chrome |
| `links/icons.ts` (`chipIcon`) | from `TypeDto.resolvedIcon` |
| `shell/commands.ts`, `shell/registry.ts` | §11; R1's `design` of `settings/*` → `'Settings'`, `type-settings/<type>` → `'CardSettings'` (D-2106) |
| `packages/schema/src/index.ts` | `ICONS` stays, documented as the old names (D-2067); `cards.ts` exports |
| `tasks/TaskCard.tsx` | the `TaskCard` component and `CardProps` go; `Checkbox`, `DueChip`, `SourceChip`, `isDone`, `TaskNav` stay (used by `cards/task.ts`, `ObjectCard`, `TaskEmbed`) |

### 6.3 Removed

`queries/board/BoardCard.tsx` (its `linkOf` moves to `cards/model.ts`), `embeds/strip.tsx` (`stripColumns`, `StripList`;
AC-17's L0 rule), `Embed.tsx`'s own strip helper, the `TaskCard` component. Catalog keys per §9.

## 7. Behaviour the contract fixes

### 7.1 The card model (R211, R212; `cards/model.ts`)

- **Keys drawn** = `card.keys` (the core's), except the example card, which draws `type.cardKeys` over its all-keys
  data (§3.2) so a list change redraws without a read (FR-TYP-11 AC-25).
- **Kinds** come from the type's `AttributeDto` of the key; built-ins: `tags`, `body`, `description`, `created`,
  `modified` by R212; `source` as R212's `source` rows; `aliases` as a `multi-select` of text.
- **Values** are formatted as the type page's cells (FR-TYP-09 AC-2, D-781; `cell.tsx`'s formatter). `size` on Image
  and PDF uses trash-media R76's byte format (D-2080). Empty values (R212 last row, `isEmpty`) draw nothing.
- **Pills:** accessible name `card.pill` (`{name}: {value}`); `title` = Name, or `card.pill` when the value is cut; the
  icon (`LucideIcon`, `data-icon` as written, `aria-hidden`) or the visible Name; Select: dot `--type-<colour>` and the
  label; an unknown option: no dot, raw value, FR-EDT-07 AC-7's warning icon with `Not an option`.
- **Link items** (`relation`, `source`, `url`): the footer link is the first key in list order of kind `relation` or
  `source` whose value is set and is a wikilink, an `http(s)` URL or a `file://` URL (R218's `↗ <name>`, not a link, D-2113); a multi-value relation shows its first value and
  `+<n>` (`span.card-link-more`, `title` = the other targets joined by `Intl.ListFormat(locale, { type: 'unit', style:
  'short' })`). Other relation and source links and every `url` value are link items in the pill area at their place
  (D-2084). Wikilinks resolve through `card.links` by target text (`linkOf`); resolved → the D-73 chip (a reference,
  previews.md R104); unresolved → the D-73 broken chip with the Create offer. Every link chip (pill area and footer)
  keeps its visible text and is named `card.pill` (`<Name>: <target title>`, `source`: `Source: …`), so `+N more`'s
  hint lists it so too (D-2139); a Task's source chip keeps R43's form, no name.
- **URL text** (D-2085): `urlChipText` = host without a leading `www.` + `/` + the last non-empty path segment,
  percent-decoded (raw on a decoding error), NFC; query and fragment dropped; the host alone when the path is empty or
  `/`. Only `http:` / `https:` values are links (`open_external` with the value as written). A `file:` value is a
  **local item** `↗ <last segment>` (`card.localLink`), `title` = the decoded path, not a link: activating it acts on the
  card. `source` text that is neither → the `Source` pill (`card.source`); a `url` value that isn't an absolute `http(s)`
  URL → a pill with the invalid-value icon (AC-13).
- **Text:** the first of `body` / `description` in list order that has text (D-2087): `description` from `values`
  (trimmed, not empty), `body` from `excerpt` (not empty); clamped to 2 lines with `…` (CSS line clamp); Task: none on
  Done.
- **Tags:** `values.tags` in order, the first 3 as `#<tag>`, then `+<n>` (R43, D-2088).
- **Grouping key:** hidden as v1-views §29.5 says; a multi-value grouping key with ≥ 2 values on this card shows every
  value as pills, at the key's place when it is an effective key, else after the other pills (D-1769 kept).
- **`Unreviewed`:** first item of the pill area when `card.unreviewed`; never hidden or counted (D-2089).
- **Strip source:** the image strip's `src` is the media URL of the attachment, `tegg-media://…/_attachments/<file>` in
  the app; under the fake core in WebKit, which can't route a custom scheme, it is the fake's media base
  `http://localhost:<port>/__media/_attachments/<file>` (ms6-trash-media §3.6), and FR-TYP-11 AC-15 accepts either
  (D-2129, as D-2113 for `file://`).

### 7.2 Two rows, then `+N more` (D-2061, D-2089)

`useTwoRows` renders **every** item of the pill area, measures their `offsetTop` after layout (a `ResizeObserver` on
the card and on `document.fonts.ready`), and gives the items after the second row the `hidden` attribute and
`data-overflow` (they stay in the DOM, so AC-7's item list holds; AC-11 counts visible items). `+N more`
(`span.card-more`, text `card.more`) is then placed as the last visible item of row 2; if it doesn't fit, the last visible
item before it is hidden too. N = the hidden items (never `Unreviewed`). Its `title` and `aria-description` are
`card.moreHint` with the hidden items' `card.pill` texts joined as above; it is not focusable and a click on it bubbles to
the card. Recomputed within one animation frame of a size change.

### 7.3 The footer date (D-2083)

The first of `created` / `modified` in list order whose value is a valid date-time or date. Text by the local day in the
machine's zone (D-104) against today: `card.editedToday` / `card.editedYesterday` / `card.editedOn` with the region's
short weekday for 2…6 days ago (`Intl.DateTimeFormat(region, { weekday: 'short' })`), else the medium date of the Date &
time setting (D-160, D-781); `created` uses the `card.created*` keys, and `card.added*` on Image and PDF. Future dates:
the medium date. A missing or unreadable value draws no date (D-1927's rule; never the file's times). `time` element
with `datetime` = the value as written.

### 7.4 Surfaces (R213)

- **Boards:** `ObjectCard` keeps part one's board hooks (`data-board-card`, `data-lane`, roving `tabIndex`, drags) on
  the same `article`; a click on the card outside its links and buttons opens the object (as the title link).
- **Task:** `ObjectCard` with `task` set adds `data-task-card` and R43's checkbox (`Complete "<title>"`) as the lead,
  applies `cards/task.ts`, keeps R43's menu items (and `Move to ›`, `Also add to ›` on boards).
- **Card embeds:** the frame of FR-EMB-02 (group `Embedded: <title>`, `data-embed-mode="card"`) holds `ObjectCard`;
  the card's head is the lead, the title, `Open <title>`, `Display as` (no `⋯`); a click outside its buttons and links,
  or ⏎ on the frame, opens the object; ⌥Space previews it.
- **Previews:** region `Preview properties` (`preview.properties`, kept) = the card's pill-area items then the footer
  link, two rows then `+N more`; absent when it would be empty and when the body is empty (FR-LNK-10 AC-5's
  `Properties` region instead).
- **Example card:** `inert`, no link, no `⋯`, no drag; with no object, a card titled with the type's Name and the line
  `typeSettings.cardExampleEmpty`.

### 7.5 The `Card` section (R214)

- Shown on every defined type but Tag. Rows: `Title` (`typeSettings.cardTitle`, description `typeSettings.cardAlways`),
  then one row per `type.cardKeys` entry: handle, icon (`resolvedIcon`, none for built-ins), Name (attribute Name, or
  `attr.<key>` for built-ins incl. `attr.body`), kind (`typeSettings.cardKind.*`: `tags` → `tags`, `body` /
  `description` → `text`, relations and `source` → `link`, `url` → `link`, `created` / `modified` → `date`, others →
  `pill`), remove button.
- Writes go through the page's existing serial writer (`useTypeWriter`, one `type_patch` per change, each on the
  previous result's version), so AC-21 (e)'s five quick changes are five ordered writes. ⌥↑/⌥↓ on a handle: `cardMove`;
  a drag: `cardDrop` (pointer moved > 4 px; nothing drops above `Title`); after a move the focus stays on the moved
  row's handle and the live region says `typeSettings.cardMoved` once.
- `Add property`: a popover (`role=dialog`, not modal) with the combobox and a listbox; matching folds case and
  diacritics on NFC Names; ⏎ or click appends (`cardAdd`), closes, and returns the focus to `Add property`.
- Read-only states (controls `aria-disabled` with `aria-description` = the reason; no write sent): newer file (AR-07
  AC-3's reason), invalid file (AR-07 AC-4's), `cardUnreadable` (`typeSettings.cardUnreadable` with `{file}` =
  `.tegg/types/<key>.yml`).
- Missing system file: `type_patch` with `base: null` creates it from `builtin` plus the line (D-90).

### 7.6 Properties and General (types.md FR-TYP-01 AC-23, AC-24)

- Every property row starts with `Icon for <Name>` (`typeSettings.propertyIcon`) showing `LucideIcon`, or a placeholder
  glyph with `aria-description` `typeSettings.noIcon` when the attribute has no known icon. One row expanded at a time;
  collapsing commits an unsaved field first (as on blur).
- General's `Change icon` (`ts.changeIcon`) shows the type's icon and opens the picker for the type icon (no `None`).

### 7.7 The icon picker (R215; D-2102, D-2103, D-2104)

- **Open:** anchored to its opener (below, flipped to stay in the window, v1-views §20's rule); one at a time; focus in
  the search field. First open in a window awaits `loadIconSet()` (the dialog shows at once with an empty grid, then the
  groups; marks §12).
- **Folding:** `fold(s)` = NFC, lower case, diacritics removed, trimmed; spaces in the query become `-`.
- **Results** (query not empty): (1) names where the folded query starts a segment (segments split by `-`; the match may
  span segments, so `arrow-up` matches at `arrow-up-down`'s first segment), (2) other names containing it, (3) names
  matched only by a keyword (a keyword, or a word of a multi-word keyword, that starts with the query); within each
  group by name (code point). An alias name equal to or starting with the query puts its target first in group 1.
  `bold` = the first occurrence of the query in the name (none for group 3), shown as `<b>` with the name's own case.
- **Suggested** (nothing typed): each word of the property's or type's Name (split on spaces and `-`), folded, with 3
  or more letters, matched like group 1 and group 3 above; union in that order, by name, without repeats, at most 12;
  the group is absent when empty.
- **Groups** with nothing typed: `Suggested for “<Name>”`, `Recent` (canonical names, newest first; absent when empty),
  `All icons` (the 1,539 names by code point). Typing replaces them with one results group (`All icons` label not shown).
- **Grid:** `ICON_COLUMNS = 6` options per row in every group, exposed as `data-columns` on the listbox. Keys: → / ←
  ±1, ↓ / ↑ ±`ICON_COLUMNS` in the flattened option order (across groups; clamped to the last option), ⏎ chooses, Esc
  closes and returns the focus to the opener, Tab cycles inside the dialog (search, `None`). The first option is
  selected after each keystroke; with nothing typed the current icon's option (canonical) is selected when shown, else
  the first.
- **Virtualisation:** at most 200 `option` elements in the DOM; the selected option is always rendered (its `id` is the
  combobox's `aria-activedescendant`); rows outside the window keep their height through the grid's padding.
- **Current:** the option whose name equals the opener's canonical current icon has `aria-description`
  `iconPicker.current`; choosing it writes no type file but still updates Recent (D-2101).
- **Choosing** sends the op (§1.1) with the canonical name, closes, returns the focus to the opener, then
  `rememberIcon`. `None (show the name)` (properties only) sends `icon: null` and adds nothing to Recent.
- **Announcements:** the result count (`iconPicker.results`, plural) politely once typing pauses 500 ms.

### 7.8 Recent icons (R216; D-2066, D-2101)

`recentIcons` in the app's UI-state store: canonical names, newest first, unique, at most 12. Every choice that sets an
icon (also the current one) moves the name to the front with one `ui_state_set`; `None` adds nothing. Read from the
store when the picker opens (no extra call).

### 7.9 The `Views` section (types.md FR-TYP-01 AC-25…AC-27; D-2100)

A list `typeSettings.viewsList` (`Views of {plural}`): `All <plural>` (`views.all`) with `typeSettings.viewDefault`;
then each `views:` name as the type page's tab shows it (trashed, missing and unreadable states included), with its
kind (`views.kind.table`, `views.kind.list`, or `typeSettings.viewBoardBy` `Board · by {attribute}`), a handle
`typeSettings.viewDrag` (`Drag to reorder {name}`), `Edit` (`typeSettings.viewEdit`; opens views.md R189's editor
exactly as `Edit view`), `Remove from {plural} page` (`views.remove`); then `Add view` (`views.add`, the type page's
menu); on Task, last, `Restore default views` (v1-views §29.10's button, moved). Reorder writes the `views:` line as
the type page's tab drag (`type_patch` `views`, one write per move, FR-QRY-07 AC-6's bytes). Read-only on a newer or
invalid file and on `viewsUnreadable`, with the reasons of the type page.

### 7.10 The shared settings layout (R219; D-2071, D-2106)

`SettingsLayout`: the `h1` above; a CSS grid `168px` section list (`nav.settings-sections`, `frame.settingsSections`) +
24 px gap + the content; the whole at most `940px`, left-aligned in the pane after its padding. `SettingsRow`: a grid
`170px` label + `1fr` control; the label is `<label for>` (or `id` + the control's `aria-labelledby`), top-aligned with
the control's first line; notes (`.settings-note`, `--muted`) inside the control column below the control. Tokens:
`--settings-nav-width: 168px`, `--settings-label-width: 170px`, `--settings-max: 940px` in `settings/layout.css`.
Below 1,024 px of pane the control column shrinks (`minmax(0, 1fr)`), nothing scrolls sideways. Settings' links are
routes (`aria-current="page"`); type settings' links scroll their `section` to the top and carry `aria-current="location"`
for the section at the top (an `IntersectionObserver` on the `h2`s).

## 8. DOM (roles, names and attributes the tests use)

### 8.1 ObjectCard

| Part | Element | Name and attributes |
| --- | --- | --- |
| Card | `article` | `aria-label` `board.card` (`Výlet: Sněžka z Pece`); `data-object-card`; `data-path` (NFC); `data-type` (type key); on boards also part one's `data-board-card`, `data-lane`; Task: `data-task-card`; example: `inert`, `data-example` |
| Strip | `div.card-strip` first child | `data-strip="image\|pdf"`; image: `img` (`alt` = title, `src` `tegg-media://…`); PDF: trash-media R77's link card; missing file: R77's missing state (`data-missing`) |
| Lead | `span.card-lead` | `svg[data-icon]` (the type's `icon` as written); Task: R43's checkbox `task.complete` instead |
| Title | `a[data-card-title]` | the title (`data-user-content`), 2 lines then `…`; then `button` `task.more` (`More actions for "<title>"`, `aria-haspopup="menu"`); embed: `Open <title>`, `Display as` instead |
| Tags | `div.card-tags` | `span.card-tag[data-tag="<key>"]` (`#<spelling>`), `span.card-tag-more` (`+<n>`) |
| Text | `p.card-text` | `data-text-from="body\|description"` |
| Pill area | `div.card-pills` | items in order; overflow items `[hidden][data-overflow]` |
| Unreviewed | `span.card-unreviewed` | `data-review="unreviewed"`; first item |
| Pill | `span.card-pill` | `data-attribute="<key>"` (one per value of a multi-value key, `data-value-index`); `aria-label` `card.pill`; `title`; children: `svg[data-icon][aria-hidden=true]` or `span.card-pill-name`, `span.card-dot[data-color]`, `span.card-pill-value`; invalid: `data-invalid` with the warning icon; never editable, `white-space: nowrap` |
| Link item | `a.chip` | `data-attribute="<key>"`; `aria-label` `card.pill` with the property's Name and the chip's text (`Vlastník: Jana Nováková`, D-2139; a Task's source chip has none); URL: `data-link-kind="external"`; wikilinks: the D-73 chip attributes (`data-link-kind="note\|broken"`) |
| Local item | `span.card-local` | `data-attribute`, `title` = decoded path; not focusable |
| More | `span.card-more` | text `card.more`; `title` and `aria-description` `card.moreHint` |
| Footer | `footer.card-footer` | link `a.chip[data-footer-link]` (+ `span.card-link-more`), date `time.card-date[data-date-key="created\|modified"][datetime]` |

`data-object-card` and `card-pill` are rendered only by `cards/ObjectCard.tsx` and `cards/CardPill.tsx` (AC-17, L0).

### 8.2 Type settings

| Part | Element | Name and attributes |
| --- | --- | --- |
| Layout | `div.settings-layout` | `nav.settings-sections` (`frame.settingsSections`) with links `a[href="#ts-<id>"]`, `aria-current="location"` on the shown one; sections `section#ts-general`, `#ts-properties`, `#ts-builtIn`, `#ts-card`, `#ts-hidden`, `#ts-embeds`, `#ts-review`, `#ts-templates`, `#ts-views`, `#ts-delete`, each `aria-labelledby` its `h2` |
| Card list | `ul[role=list]` | `aria-label` `typeSettings.cardList`; `li[data-card-key="title"]` first, then `li[data-card-key="<key>"]`; handle `span[role=button][tabIndex=0]` `typeSettings.cardDrag`, `data-command="card.move"`; kind `span.card-kind`; `button` `typeSettings.cardRemove` |
| Warning | `p[role=status]` | `typeSettings.cardUnknown` |
| Add property | `button` | `typeSettings.cardAdd`, `aria-haspopup="dialog"`, `data-command="card.add"`; disabled: `aria-disabled` + `aria-description` `typeSettings.cardAllAdded` |
| Add popover | `div[role=dialog]` | `aria-label` `typeSettings.cardAdd`; `input[role=combobox]` `typeSettings.cardFind`; `div[role=listbox]` with `div[role=group]` `typeSettings.cardGroupType` / `typeSettings.cardGroupBuiltIn`, `div[role=option][data-card-key]`; no match `p[role=status]` `typeSettings.cardNoMatch` |
| Reset | `button` | `typeSettings.cardReset`, `data-command="card.reset"`; disabled with `typeSettings.cardIsDefault` |
| Example | `div[role=region]` | `typeSettings.cardExample`; holds one `article[data-object-card][data-example]` |
| Fixed note | `p.card-fixed` | `typeSettings.cardFixed` |
| Property icon | `button` | `typeSettings.propertyIcon`, `aria-haspopup="dialog"`, `data-command="property.icon"`; placeholder `aria-description` `typeSettings.noIcon` |
| Property row | `div.ts-prop[data-attribute]` | the toggle `button` stays `Edit <Name>` with `aria-expanded` (`true` while open); a separate `button` `Collapse <Name>` sits in the open row (D-2152) |
| Views list | `ul[role=list]` | `typeSettings.viewsList`; `li[data-view-row="<name NFC>"]` (`""` for `All`); handle `typeSettings.viewDrag`; `button` `typeSettings.viewEdit`; `button` `views.remove`; `button` `views.add` (`data-command="views.new"`); Task: `button` `typeSettings.restoreViews` (`data-command="types.restoreDefaultViews"`) |
| Live region | `div.sr-live` | `typeSettings.cardMoved`, `views.moved` |

### 8.3 The picker

| Part | Element | Name and attributes |
| --- | --- | --- |
| Dialog | `div[role=dialog][data-icon-picker]` | `aria-label` `iconPicker.title`, `aria-modal="false"` |
| Search | `input[role=combobox]` | `aria-label` `iconPicker.search`, `aria-controls` the listbox `id`, `aria-activedescendant`, `aria-expanded="true"` |
| Grid | `div[role=listbox]` | `data-columns="6"`; groups `div[role=group]` (`iconPicker.suggested`, `iconPicker.recent`, `iconPicker.all`; results: `iconPicker.resultsGroup`) with `data-group="suggested\|recent\|all\|results"` |
| Option | `div[role=option]` | `id`, `data-icon="<name>"`, `aria-selected`; `LucideIcon` + `span.icon-name` (with `<b>`); current: `aria-description` `iconPicker.current` |
| None | `button[data-icon-none]` | `iconPicker.none`; absent for the type icon |
| Status | `p[role=status]` | `iconPicker.noMatch`, `iconPicker.loadFailed`; the polite count `iconPicker.results` in `div.sr-live` |

### 8.4 Settings

`div.settings-layout` > `nav.settings-sections` (links `a[aria-current="page"]`) + `div.settings-content`; rows
`div.settings-row` > `.settings-label` + `.settings-control` (> control) + `.settings-note`: the row note is a
sibling of `.settings-control`, drawn in the control column under the control, so the control's box ends above it
(D-2157). Every `settings/*` route and
`type-settings/<key>` use them (FR-UX-02 AC-22 measures these boxes). `tests/fixtures/settings/controls-0.5.json` (FR-UX-02
AC-24) is recorded by `app/webkit/settings-helpers.ts` `settingsControls(page)` on the 0.5 UI and committed with the red
tests, before the restyle.

## 9. Strings (R217; NFR-OTH-02 AC-24)

New keys in `app/ui/src/i18n/catalog.ts`: R217's list with its texts, plus (types.md AC-28, this contract):
`typeSettings.viewsList` `Views of {plural}` · `typeSettings.viewDefault` `Default · always first` ·
`typeSettings.viewBoardBy` `Board · by {attribute}` · `typeSettings.viewEdit` `Edit` · `typeSettings.viewDrag` `Drag to
reorder {name}` · `typeSettings.noIcon` `No icon` · `typeSettings.cardMoved` `Moved {name} to position {position}` ·
`iconPicker.resultsGroup` `Results` · `iconPicker.results` (plural) `{count} icon` / `{count} icons` ·
`iconPicker.loadFailed` `Icons couldn't be loaded. Try again.` · `ts.section.card` (the section list's link, `Card`),
`ts.section.views` (`Views`). `card.more`, `typeSettings.cardExampleEmpty`, `iconPicker.results` use `Intl.PluralRules`
(D-133). Messages carry their values (`{name}: {value}`, `Edited {date}`); nothing is concatenated.

**Removed:** `ts.addPreview`, `ts.addPreviewMenu`, `ts.previewFull`, `ts.previewIgnored`, `ts.removePreview`,
`typeRule.previewFull`, and the 24 `icon.<name>` labels. **Kept:** `preview.properties` (the previews' region keeps
its name; §17 item 1), `board.card`, `board.none` (lanes), `task.more`, `task.complete`, `panel.checked`,
`link.unreviewed` (the `Unreviewed` text), `ts.conflict`, `ts.newer`, `ts.icon`, `ts.changeIcon`, `attr.*`, `views.*`.

## 10. UI state (R216; FR-STO-07 AC-15)

```ts
type UiStateDto = { /* … */ recentIcons?: string[] };   // canonical Lucide names, newest first, ≤ 12, unique
```

Rust: `#[serde(default, skip_serializing_if = "Option::is_none")] #[ts(optional)] pub recent_icons: Option<Vec<String>>`;
`version` stays 1. Written through the existing `ui_state_set` (atomic, Application Support), never to the vault. A
0.5.x file without the key reads as no Recent; its other keys are kept as `ui_state_set` keeps them.

## 11. Commands (R217; FR-UX-03 AC-54)

Palette only, no shortcut, `needsVault: true`, section `navigate`:

| Id | Title key | Listed when | Does |
| --- | --- | --- | --- |
| `card.edit` | `cmd.card.edit` | `type/<key>`, `note/<path>` (its type), `type-settings/<key>`: a defined type other than `tag` | `go({ id: 'type-settings/<key>', section: 'card', focus: 'card.add' })` (new `Route.section` / `Route.focus` options: scroll the section's `h2` to the top, then focus) |
| `card.add` | `cmd.card.add` | `type-settings/<key>` (not `tag`) | opens `Add property`; `disabled` with `typeSettings.cardAllAdded` or the read-only reason |
| `card.reset` | `cmd.card.reset` | `type-settings/<key>` whose type has a readable `card:` | the reset write |
| `type.changeIcon` | `cmd.type.changeIcon` | `type/<key>`, `type-settings/<key>` (defined types) | opens the picker for the type icon, anchored to `Change icon` (type settings) or the type page header's icon (`[data-type-icon]`) |

Controls inside the section and the picker are reached by Tab from these (D-2107). FR-UX-03 AC-8's control map gains
`card.move`, `property.icon`, `card.add`, `card.reset` (`data-command` values above).

## 12. Performance marks (NFR-PERF-07 AC-6, FR-TYP-01 AC-21; D-2108)

Through `ipc.perfMark` (v1-views §4.8's mechanism):

- Boards: `board-request` → `board-ready` unchanged (NFR-PERF-07 AC-6 reads them); `__TEGG_TEST__.board()`'s
  `domCards` counts `article[data-object-card]`.
- Picker: `icon-picker-open` when an opener is activated (before `loadIconSet`); `icon-picker-ready` once the groups
  have painted (two animation frames after the commit that shows them); `icon-picker-input` on each `input` event of
  the search field; `icon-picker-results` once that input's results have painted. The benchmark pairs them in order.
- L4: `crates/tegg-core/tests/ac_cards_perf.rs` (`query_run` with the nine card values and the excerpt ≤ 100 ms p95),
  in the nightly `core-perf-ac` step (as D-1927's `ac_views_tasks_perf.rs`).

## 13. Fake core and test hooks

- **`app/ui/test/fake-schema.ts`:** the `card` op (flow line at the TOP place after `preview`, else the nearest
  preceding key; block list replaced; `null` removes the key's lines; `cardUnreadable` refusal; NFC), the
  `attributeIcon` op (line after `type:`, replace, remove, canonical no-op, allowed on built-ins), `removeAttribute`
  removes `card` entries, `set icon` canonical no-op; every other op keeps the `card` and `icon:` lines;
  `TypeDto.cardList` / `cardDefault` / `cardKeys` from `@tegg/schema` `cardList`, `cardIgnored`, `cardUnreadable`,
  `resolvedIcon`; `AttributeDto.icon` / `resolvedIcon`.
- **Icon data in the fake:** `fake-core.ts` reads `packages/schema/data/lucide-0.460.0.json` and `icon-aliases.json`
  once in Node and passes the nodes (not the keywords) to `fakeMain` in the init arguments (no page request, so
  FR-TYP-01 AC-20 (b)'s request log is unaffected).
- **`fake-queries.ts`:** board runs fill `card` per row (§3.2, §3.3) using `fake-tasks.ts`'s `excerpt` twin, reading it
  only when `body` is a key; `QueryRow.excerpt` per §3.3; Table / List runs no card.
- **`fake-tasks.ts`:** `TaskRowDto.card`. **`fake-links.ts`:** `embed_load` fills `card`; duplicate details per §3.5.
  **New:** `type_card_example`.
- **`ui_state_set`** stores `recentIcons`; `uiState()` returns it.
- **Contract test (L3, not an AC test):** `app/test/fake_cards.contract.test.ts` compares the fake's `card` data for
  every object of the base + `cards/` overlay against `tests/fixtures/vaults/cards/expected-card-data.json`, which
  `crates/tegg-core/tests/ac_cards.rs` checks the real core against (written by the test author from R218).
- **Hooks:** the existing `calls()`, `writes()`, `writesTo()`, `typeCalls()`, `queryRuns()`, `setFile(…, { silent })`,
  `perfMarks()`, `delayCommand` cover OC. The request log of `serve-built.ts` (FR-TYP-01 AC-20 (b)) is read through the
  existing WebKit request listing; the chunk is matched by `/assets/lucide-icons-`.
- **L6:** `TEGG_TEST=1`, `TEGG_NOW`, `TZ`, a temporary Application Support; keys only to Tegg (D-799).
- **L4 kill harness** (FR-SYN-02 AC-14): re-runs the test binary as a child (`TEGG_CARDS_KILL_CHILD`,
  `TEGG_CARDS_KILL_KIND` = `card` (200 alternating `Core::type_patch` `SetCard` on `book.yml`: inserted ↔ changed) or
  `icon` (200 alternating `SetAttributeIcon` on `výlet.yml`: inserted ↔ removed)), as `ac_views_writes.rs`.

## 14. Test layout per criterion

| Criteria | L0 / L1 / L2 | L4 | L5 | L6 |
| --- | --- | --- | --- | --- |
| FR-TYP-11 AC-5, AC-6, AC-26, AR-07 AC-11, FR-FMT-07 AC-36, FR-FMT-12 AC-15, NFR-POR-01 AC-7 | `app/test/cards_model.ac.test.ts` (corpus §2.2, `isEmpty`) | `crates/tegg-schema/tests/ac_card_type_file.rs` (bytes, TOP place, corpus, L2 proptest), `crates/tegg-core/tests/ac_cards.rs` | `app/webkit/cards_type_file.ac.test.ts` | |
| FR-TYP-11 AC-7…AC-17, FR-TYP-12 AC-4 | `cards_model.ac.test.ts` (parts, values, URL text, dates, Task) | `ac_cards.rs` (card data) | `app/webkit/cards_parts.ac.test.ts`, `cards_surfaces.ac.test.ts` | |
| FR-TYP-11 AC-18, AC-19, FR-LNK-14 AC-15 | | `ac_cards.rs` | `app/webkit/cards_reads.ac.test.ts` | |
| FR-TYP-11 AC-20…AC-25, AC-27, AC-28 | `cards_model.ac.test.ts` (`write.ts`) | `ac_card_type_file.rs`, `ac_cards.rs` (Conflict, missing `task.yml`, delete job) | `app/webkit/type_settings_oc.ac.test.ts` | `app/e2e/cards.ac.test.ts` (AC-21) |
| FR-TYP-01 AC-12, AC-17, AC-19, FR-SYN-02 AC-14, FR-SYN-03 AC-35 | `app/test/icon_picker.ac.test.ts` (resolver) | `ac_card_type_file.rs` (icon bytes, kill harness) | `app/webkit/icon_picker.ac.test.ts` | `cards.ac.test.ts` (AC-17) |
| FR-TYP-01 AC-13, FR-EDT-07 AC-22 | | | `cards_surfaces.ac.test.ts` | |
| FR-TYP-01 AC-14…AC-16, AC-18, AC-20, FR-STO-07 AC-15 | `icon_picker.ac.test.ts` (search oracle, suggested, L0 data file and imports) | | `icon_picker.ac.test.ts` | `cards.ac.test.ts` (relaunch, sockets, `Credits.rtf`) |
| types.md FR-TYP-01 AC-22…AC-28, views.md FR-QRY-05 AC-30, AC-31, embeds.md FR-EMB-02 AC-19…AC-21, previews.md FR-LNK-10 AC-17…AC-19 | | | `type_settings_oc.ac.test.ts`, the views / embeds / previews test files named in the change table | |
| app-shell FR-UX-02 AC-22…AC-26 | `app/test/registry.ac.test.ts` (AC-26) | | `app/webkit/settings_layout.ac.test.ts` | |
| FR-SYN-06 AC-51, FR-UX-08 AC-26 | | | `cards_surfaces.ac.test.ts` (counts) | `cards.ac.test.ts` |
| FR-UX-03 AC-54, AC-55, FR-UX-05 AC-26, NFR-OTH-02 AC-24 | `app/test/cards_catalog.ac.test.ts` | | `app/webkit/cards_keyboard.ac.test.ts`, `cards_themes.ac.test.ts` | |
| NFR-PERF-07 AC-6, FR-TYP-01 AC-21 | | `ac_cards_perf.rs` | | `app/e2e/nfr_perf_07_cards.ac.test.ts`, `app/e2e/nfr_perf_icon_picker.ac.test.ts` |

`qa.config.json` needs no new step (the files sit in existing packages); `tools/icons/gen-lucide.mjs --check` is added to
the commit gate's L0 checks when the data, aliases, `Credits.rtf` or the script are staged.

## 15. Contract choices (no owner decision needed; follow the ACs and precedents)

1. The card list is computed once, in `tegg-schema` (`card_list`), carried in `TypeDto` (`cardList`, `cardDefault`,
   `cardKeys`) and in every card data (`keys`); the TS twin in `@tegg/schema` serves only the fake core and L1, tied by a
   shared corpus (the §14.4 precedent: `@tegg/schema` mirrors `tegg-schema`).
2. `card:` reads and writes exactly as `columns` (D-1240, D-1243, D-1245): unreadable flag, ignored list, one flow line,
   TOP place, NFC; the first write seeds from `cardList` (the default), D-2076.
3. Tag's card is fixed: a hand-written `card:` in `tag.yml` is kept and not read (R210 "fixed").
4. `review`, `title` and `file`-kind keys in `card:` are skipped silently, not named in the warning (they are known
   properties a card never draws as entries).
5. Attribute icons have their own op (`attributeIcon`), not a field of `updateAttribute`: it is the one change allowed
   on built-ins (D-2099) and needs no `AttrChange` churn in existing tests.
6. Icon equality for "the current icon writes nothing" is canonical (alias-aware) in the schema and the fake, so the
   UI's check isn't the only guard (D-2103).
7. Icons in use are resolved by the core and sent as nodes in the type DTOs; the picker alone loads the full set as a
   lazy JS chunk (plan §11's risk; CSP forbids `fetch` of a JSON asset).
8. One data file (names, nodes, keywords) generated by a pinned, integrity-checked script; aliases in a separate
   hand-written file so regenerating never touches them.
9. Card data is one DTO (`CardDataDto`) on every surface; values are raw and the drawing rules live in the UI's pure
   `cards/model.ts` (L1), except the empty rule, mirrored in Rust for §3.5 and tied by a corpus.
10. Board rows carry `card` only on board runs; `excerpt` is read only where `body` is an effective key; Table / List runs
    keep the no-excerpt read (v1-views §24.4). `QueryRow.excerpt` keeps its type (board-run tests of Q2 unchanged).
11. Embeds and previews get card data through `embed_load` (`EmbedNote.card`), so Karty's five card embeds stay one
    batch (D-429, FR-EMB-02 AC-21).
12. The example card has its own read (`type_card_example`, all candidate keys), as D-1804 added `query_view_usages`.
13. All tags are sent; the UI shows 3 and `+<n>`.
14. Footer dates use only the frontmatter (D-1927: a missing date is never the file's time).
15. Overflowed pills stay in the DOM with `hidden` (AC-7's item list and AC-11's visible count both hold).
16. `DuplicateDetails.preview` keeps its name; its values follow the card list; a multi-value key gives one value per
    item (R212's pills).
17. The picker grid has a fixed 6 columns, exposed as `data-columns`; ↑/↓ move ±6 in the flattened order.
18. `Edit card…` navigates with new `Route.section` / `Route.focus` options rather than a type-settings-only event.
19. Recent is read from the in-memory UI-state store; two windows follow `ui_state_set`'s existing last-writer rule.
20. `Credits.rtf` is generated with the data file so the notice can't drift from the set.

## 16. Contract points for the owner

| CP → D | Point | Proposal | Alternative |
| --- | --- | --- | --- |
| CP-1 → D-2110 | **System type icons everywhere.** D-237 kept hand-drawn system glyphs (`task`, `bolt`, `file`, …) wherever a system type has its default icon; OC draws every type icon from Lucide on cards (Nápad's lead is `zap`, Vyhlídka's `image`), and a user type's new icon (`newspaper`, `tent`) must show in the sidebar, type page header and chips (FR-TYP-01 AC-17), which the hand-drawn set can't. The ACs don't say whether the sidebar, chips, search rows, the capture window and the graph keep D-237's glyphs for system types. | Every type icon on every surface is drawn from Lucide through `resolvedIcon` (one resolver; D-237's system glyphs retired for type icons; Task cards keep R43's checkbox; app chrome such as `Home`, `Inbox`, `Settings` keeps its hand-drawn icons) | Keep D-237's hand-drawn glyph on surfaces other than cards while a system type has its default icon; Lucide for every other type icon and on cards |

## 17. AC problems (fixed in the ACs as D-2111, owner 2026-11-22)

1. **R217's removed keys include the `Preview properties` heading, but its key `preview.properties` also names the
   previews' region**, which previews.md part four keeps (`The region keeps its name Preview properties`). Fix: R217
   removes the section's own keys only (`ts.addPreview`, `ts.addPreviewMenu`, `ts.previewFull`, `ts.previewIgnored`,
   `ts.removePreview`, `typeRule.previewFull`) and keeps `preview.properties`.
2. **FR-TYP-11 AC-7 vs AC-11.** AC-7 expects each card's pills to be "exactly R218's … pills" (Sněžka: 16 items,
   15 on the board), while AC-11 hides the items after row 2 behind `+N more`. Both hold only if hidden items stay in the
   DOM (§7.2). Fix: AC-7 reads "pills (shown or hidden by `+N more`, `[data-overflow]`)".
3. **FR-TYP-11 AC-18's L4 wording** ("`query_run` … returns for Sněžka 11 values, `excerpt: null`, `links` holding
   `Eva Lindová`") names fields of the row. In this contract they are `QueryRow.card.values` (11 entries: `tags`,
   `description`, `stav`, `náročnost`, `kraj`, `vybavení`, `délka`, `termín`, `odkaz`, `průvodce`, `modified`),
   `card.excerpt` and `card.links`; `QueryRow.excerpt` stays a string (`""`). Fix: AC-18 names `card.*`.
4. **FR-TYP-01 AC-20 (b) "the data file isn't requested"**: in the page the set is a JS chunk
   (`assets/lucide-icons-<hash>.js`), not the JSON (the CSP's `connect-src` allows only IPC, so a JSON `fetch` can't
   work). Fix: AC-20 (b) reads "the icon data chunk".
5. **FR-TYP-01 AC-16 "↓ / ↑ one row (the grid's column count), across group boundaries"** is ambiguous where groups
   end in a partial row. This contract moves ±6 in the flattened option order, clamped to the last option (§7.7). Fix:
   AC-16 states that rule.
6. **R211 `Lead` and AC-16 use `data-icon` = the name as written, while R215 options use `data-icon` = the Lucide
   name**; both are intended (D-2103), but tests that select `[data-icon="square-check-big"]` on a card will find none.
   No fix needed if the test author keeps the two apart; noted so they do.
7. **FR-TYP-11 AC-12 "the link chip at the left edge (± 1 px of the card's content box)"** holds only when the footer has
   a link; with a date alone (Máchovo) the date sits at the right edge and nothing is at the left. No contradiction;
   AC-12 could say "when present".

Not an AC problem but worth a line: `d3-force` (ISC) is already in the bundle without a notice; `Credits.rtf` could carry
its licence too when it is created (outside OC's ACs).
