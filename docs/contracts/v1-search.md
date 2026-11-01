# Contract: the redesigned Search page (preview v0.94 feedback)

Public interfaces of the Search page redesign, for the test author (D-61) and the build. ACs:
`docs/acceptance/search-navigation.md` § "Search page redesign" (FR-SRC-01 AC-18…AC-22, FR-SRC-02 AC-13…AC-18,
FR-SRC-03 AC-8…AC-21, FR-NAV-01 AC-19). Decisions: D-1200…D-1222 (BRD v1.120; AP-1100…AP-1122). Board:
`design/edit-note-page/Search.dc.html` (states via the `state` prop; `SearchNoMatch`, `SearchNoResults` are the same
file). Builds on ms2-core §2.1 (search), ms3-shell §15.1 (tiers, file names), ms4-tags §1.5 (tag filter, D-706) and
D-760 (`Go to`). Where this contract and the ACs disagree, the ACs win and this file is corrected before the red tests.

The page writes nothing to the vault and nothing to `ui-state` (FR-SRC-03 AC-20, D-1217). The only write it can start
is the `Go to` create (FR-NAV-01 AC-17, unchanged).

## 1. Core: `tegg-index` `SearchResult` (FR-SRC-01 AC-18…AC-21)

Additive to ms2-core §2.1 and ms3-shell §15.1 (ranges: bytes in the core, UTF-16 code units over IPC, D-1223):

```rust
pub struct SearchResult {
    // … path, r#type, title, matched_in, tier, typo, snippet, file_name as before …
    /// Frontmatter `modified` exactly as written, when it parses as an ISO 8601 date-time with offset (or `Z`);
    /// None when missing or invalid. Never a file-system date (D-103, D-1206).
    pub modified: Option<String>,
    /// Tag keys (frontmatter and inline), NFC, lower case, de-duplicated, sorted by key (the UI orders by D-122).
    pub tags: Vec<String>,
    /// Matches in `title`, byte ranges into `title`, on the original text; typo-matched words included (D-1210).
    /// Empty when the title doesn't match.
    pub title_highlights: Vec<(usize, usize)>,
    /// Some only when `matched_in == Alias`: the matched alias as written, its highlights, `line` 0 (D-1209).
    pub alias: Option<Snippet>,
    /// Some only when `matched_in == Attribute` (D-1208).
    pub attribute: Option<AttributeHit>,
}
pub struct AttributeHit {
    /// The frontmatter key as written (not folded): `priority`, `místo`.
    pub key: String,
    /// The matched value as written; a list → the matched item; > 160 chars → ≤ 160 around the first match.
    /// `line` 0, `byte_in_line` 0.
    pub value: Snippet,
}
```

- **Attribute candidates.** Every frontmatter key except the reserved `id, type, title, aliases, tags, created,
  modified` (FR-SRC-01 AC-6, AC-19); the first matching key in frontmatter order wins. Scalars are matched as their YAML
  text value; list items one by one.
- **Snippet (D-1207).** As before when the body has a match. Otherwise (title, file name, alias, attribute, filter only)
  the body's lead: the first ≤ 160 characters of the body (no frontmatter, no block markers, D-107) with no highlights;
  `None` when the body is empty. This replaces "`snippet` only for body matches" in ms2-core §2.1.
- **Order of a search without text (D-1205).** When the query has no positive term (filters only), results are ordered
  by the `modified` instant (`DateTime<FixedOffset>` compared as UTC), newest first; results whose `modified` is None
  last; ties by path. With text, ms3-shell §15.1's order is unchanged; filters never change it.
- **Paging.** `offset`/`limit` slice one ordered list: offset 0 / 50 + offset 50 / 50 = offset 0 / 100 (FR-SRC-03 AC-12).
- The new fields come from the index's in-memory note data and the stored raw text; deleting and rebuilding the index
  gives identical results (AR-01). External edits update them within 2 s (NFR-PERF-08). No index schema change is
  required; if one is, the schema version bumps and the index rebuilds (never a vault write).
- **Performance.** NFR-PERF-04 holds for the first 50 results with every field, for a text query and for `types: [page]`
  without text (FR-SRC-01 AC-22).

## 2. IPC (`app/src-tauri/src/dto.rs`, generated `app/ui/src/ipc/types.ts`)

`index_search(query: SearchQueryDto) → SearchPageDto` keeps its name and query shape. `SearchResultDto` gains:

```ts
type SearchResultDto = {
  // … path, type, title, matched_in, tier, typo, snippet, file_name as before …
  modified: string | null;                    // as written (ISO 8601 with offset), else null
  tags: string[];                             // tag keys, NFC lower case
  title_highlights: Array<[number, number]>;  // [start, end) in UTF-16 code units of `title`
  alias: SnippetDto | null;                   // matched_in = 'alias' only; line 0
  attribute: AttributeHitDto | null;          // matched_in = 'attribute' only
};
type AttributeHitDto = { key: string; value: SnippetDto };  // value.line 0; highlights in UTF-16 code units
```

- The UI sends the Type filter as `types: [<key>]` or `types: []` (`All types`, D-1203); `tags` as today (D-706).
- The Type menu's options and counts come from the existing `index_type_counts` (the sidebar's vault-wide counts:
  templates and `.trash/` excluded, untyped files counted as `page`). Names come from `vault_types` (singular `name`;
  a key without a definition shows the raw key, after the defined types, D-121); order D-122 on the name.
- Attribute labels come from the type definitions (`vault_types`): the attribute's `name` for that key in the
  result's type, else the key as written (D-1208).
- Tag display names and colours come from the tags store (`useTags`, `index_tags`): display name D-711, colour
  FR-TAG-05; a key with no entry shows the key.
- **Fake core (L5).** `app/webkit` fake `index_search` fills the new fields from the fixture files the same way
  (it is the test author's to extend) and orders filter-only results as §1. `index_search` stays in the helpers'
  `READ_COMMANDS`.

## 3. UI: `search` route (FR-SRC-02 AC-13…AC-18, FR-SRC-03 AC-8…AC-21)

Components: `app/ui/src/pages/SearchPage.tsx`, `app/ui/src/Search.tsx` (rewritten), `app/ui/src/GoTo.tsx`
(unchanged behaviour). Elements, roles and names are the AC section's "Page elements" table; in short:

| Element | DOM contract |
| --- | --- |
| Heading | `h1` `Search`, no `Back` link (D-1215) |
| Search region | `role="search"` wrapper holding `input[type=search]` named `Search query` (placeholder `Search for a phrase`), `button` `Clear search` (only with text), `span[aria-hidden]` `⇧⌘F` |
| Filters | `div[role=group]` named `Filters`: `button[aria-haspopup=menu]` `Type: all` / `Type: <Name>` with `data-active` when a type is chosen; menu `role=menu` named `Type` with `menuitemradio`s `All types`, `<Name> <count>`; then tags.md's `combobox` `Filter by tag`; then `button` `Clear filters` (only with a type or tag) |
| Go to | `listbox` `Go to` (D-760, unchanged; between Filters and the count; filters don't apply, D-1220) |
| Count | `div[role=status]` with the count line (D-1204), absent in empty states |
| Results | `ul` named `Search results`; each `li` holds the row `a.result` (link, name = title, `aria-description` = type name and date) and after it the tag chip `button`s `Filter by #<name>` (D-1211) |
| Row parts | `.icon` (`data-icon`), `.title` (`data-user-content`, `mark` elements for highlights), `.typo` `similar spelling`, `.type` singular name, `time.modified[datetime=<modified>]` formatted date, one of `.file-name` / `.alias` / `.attribute` lines with `mark`s, `.snippet` (with or without `mark`s), `.tags` chips |
| Show next | `button` `Show next <k>`, k = min(50, total − loaded) |
| Empty state | `section` (`role=region`) named by its `h2` title; body `p`; optional `button` `Clear filters` |

- **Highlights** are rendered as `<mark>` over the UTF-16 ranges (the existing `Highlighted` component), coloured by
  the token `--sel-hl` (light `#FFE7A3`, dark `#5A4718`, D-129).
- **Date (D-1206).** `formatDate(localDate(modified, machine zone), dateTimeSetting)` from `app/ui/src/i18n/dates.ts`;
  re-rendered when the setting changes, without a new query.
- **State per history entry (D-1217).** `HistoryEntry` (shell/history.ts) gains
  `search?: { text: string; type: string | null; tags: string[]; loaded: number; focusPath: string | null }`; the
  page saves it when leaving and restores it on Back/Forward. Nothing else stores it. A `Go to` jump replaces the entry
  (D-760), so its state is dropped. `search/tag:<x>` is no longer produced (tags.md AC-12).
- **Queries.** One `index_search` per change of text (debounce 120 ms as today), type or tags, with `offset 0`,
  `limit = max(50, loaded)`; `Show next` asks `offset = loaded, limit 50` and appends. A live refresh (the `refresh`
  counter) re-queries `offset 0, limit = loaded + max(0, new total − old total)` (D-1225) and keeps the focused row by path and the scroll (FR-SRC-03 AC-21).
- **Keyboard (D-1218).** As FR-SRC-03 AC-17: Tab order field → `Clear search` → `Type` → `Filter by tag` →
  `Clear filters` → rows (link, chips) → `Show next`; ↓/↑ between row links; the Type menu is the app's `Menu`
  (shell/Menu.tsx) with radio items. No new palette commands.
- **Strings (NFR-OTH-02).** New catalog keys (`app/ui/src/i18n/catalog.ts`), plural ones via `Intl.PluralRules`:
  `search.placeholder` (`Search for a phrase`), `search.clear` (`Clear search`), `search.filters` (`Filters`),
  `search.typeAll` (`Type: all`), `search.typeOne` (`Type: {type}`), `search.allTypes` (`All types`),
  `search.clearFilters` (`Clear filters`), `search.alias` (`Alias: {alias}`), `search.attribute` (`{label}: {value}`),
  `search.showNext` (`Show next {count}`), `search.filterTag` (`Filter by #{tag}`), `search.count` (`{count} results`),
  `search.countTags` (`{count} objects with {tags}`), `search.countType` (`{count} objects of type {type}`),
  `search.countTypeTags` (`{count} objects of type {type} with {tags}`), `search.emptyTitle`, `search.emptyBody`,
  `search.noResultsTitle` (`No results for “{q}”`), `search.noResultsBody`
  (`Nothing matches “{q}” with {filters}. Clear the filters to search everything.`), `search.noObjectsTitle`
  (`No objects with {filters}`), `search.noObjectsBody` (`Clear the filters to search everything.`),
  `search.noMatchBody` (`Nothing in this vault matches “{q}”. Use Create “{q}” above to make it.`),
  `search.filterType` (`Type {type}`). Filter lists use `Intl.ListFormat` (conjunction) in the UI language.
  Existing keys `search.label` (`Search query`), `search.results`, `search.fileName`, `search.typo` keep their text.

## 4. Fixture (D-1222)

`tests/fixtures/vaults/search-page/` (new overlay, three files given byte-exact in the AC section), copied after
`search/` and before `new-empty/.tegg/` by the new tests only. `search/` and its tests are unchanged. A row in
`tests/fixtures/vaults/README.md` describes it.

## 5. Test files (for the test author)

- L4 (Rust): `crates/tegg-core/tests/ac_search_page.rs` — FR-SRC-01 AC-18…AC-22 (AC-22 perf as the existing
  latency ACs: G2 nightly, D-343), FR-SRC-02 AC-14, AC-15, FR-SRC-03 AC-12 (paging), AC-20 (core part).
- L5 (WebKit): `app/webkit/search_page.ac.test.ts` (+ a helper file if needed) — FR-SRC-02 AC-13, AC-14, AC-16…AC-18,
  FR-SRC-03 AC-8…AC-21, FR-NAV-01 AC-19. FR-SRC-02 AC-17's relaunch part is L6 if the real-app suite has a Search
  scenario, else noted as L5 only.
- L1: catalog plural forms and the token contrast (FR-SRC-03 AC-18, AC-19).
- Existing tests (`search_goto`, `search_tags`, `search_ranking`, `search_icons`, `ac_search.rs`) are not modified;
  if one conflicts with an approved AC it needs `AC-Test-Change: …; approved-by: owner`, raised as an AP first.

## 6. Red-test decisions (D-1223…D-1230; red tests 060c0a5)

- **D-1223** Highlights: byte ranges in `tegg-index`, `[start, end)` UTF-16 code units in every `*Dto` (titles, aliases,
  attributes, snippets). AC numbers are UTF-16.
- **D-1224** `crates/tegg-core/tests/search_page_setup/mod.rs` reads the new fields through helpers (Debug form) so the red
  commit compiles; the build may replace them by field reads without an `AC-Test-Change` trailer.
- **D-1225** Live refresh: `limit = loaded + max(0, new total − old total)`; loaded rows never drop (FR-SRC-03 AC-21).
- **D-1226** FR-SRC-03 AC-11: the setting is changed in Settings › Date & time; Back to `search` shows the new format
  within 1 s, its state restored from the history entry.
- **D-1227** FR-SRC-03 AC-20's "nothing under Application Support" excludes SQLite `*-shm`.
- **D-1228** FR-SRC-01 AC-22 runs at G2 nightly (`core-perf-search-ac`); the push step `core-rust-test` skips it (D-343).
- **D-1229** FR-SRC-02 AC-17's relaunch part: `app/e2e/search_page.ac.test.ts` (L6).
- **D-1230** DOM details: the query in empty-state copy is a `data-user-content` element; the `⇧⌘F` hint is `aria-hidden`
  inside the `search` region; `Go to` options are not Tab stops; a cut attribute value is ≤ 160 characters and may carry `…`.

## 7. Build decisions (D-1231, D-1232)

- **D-1231** FR-SRC-01 AC-22's filter-only test doesn't require `modified` values on the reference vault (it has none).
- **D-1232** FR-SRC-03 AC-10's last step waits for the `ostružina` row itself.

## 8. Build notes (no new decision)

- Every page control carries a page-local `data-command` (FR-UX-03 AC-8, as the tag page's `tagPage.cN`; D-1218 keeps them out of the palette): `search.clear`, `search.type`, `search.clearFilters`, `search.open` (row link), `search.filterTag` (row chip), `search.showNext`. The `⇧⌘F` hint is the catalog key `search.shortcut` (NFR-OTH-02 AC-1).
- The history entry's `focusPath` is the focused row's path, or null once focus is anywhere else on the page; on Back, a row that no longer exists gives the focus to the field (D-1217).

## 9. Search without `Go to` (preview v0.109; D-1340…D-1343)

ACs: `docs/acceptance/search-navigation.md` § "Search without `Go to`" (FR-SRC-01 AC-23…AC-25, FR-SRC-04 AC-8…AC-11,
FR-NAV-01 AC-20…AC-23). Feedback: `docs/feedback/ms6-v0109-search.md`. The ACs win over this section.

### 9.1 Core order (D-1341) and the prefix (D-1342), `tegg-index` `Index::search`

- **Query words.** The positive unquoted words, folded (FR-FMT-12, the existing `fold`); quoted phrases and `-word`
  keep ms3-shell §15.1. **Prefix (D-1342):** when the raw query does not end with whitespace and its last item is an
  unquoted, non-negative word of at least 2 characters (digits count, D-1354; the raw last item decides, so a trailing
  `-`, quote or symbol leaves no prefix), that word also matches every index word that starts with it
  (folded). A word matched only through its prefix counts as matched for every tier and group, and ranks as a typo
  match does (after exact); it does **not** set `typo` (the UI's `similar spelling` mark is for D-101 only). Title,
  alias, attribute and snippet highlights cover the matched prefix only (the query's characters, mapped to the
  original text as today).
- **Groups (D-1341), for a query with at least one positive word:**
  1. the title's or the file stem's folded words contain every query word (a word counts when matched exactly, by a
     D-101 typo or by the D-1342 prefix); step 1a the title's (or stem's) folded word sequence equals the query's,
     1b the query words appear as a contiguous sequence in the title or stem, 1c otherwise;
  2. not group 1, and one alias contains every query word, with the same three steps on that alias;
  3. everything else, in ms3-shell §15.1's order (tier, exact before typo, field, bm25).
  Inside a step of groups 1 and 2: exact before typo-or-prefix, then bm25, then path. A query of only quoted phrases
  uses the phrase's words for the groups, after the phrase filter. Filters never change the order; D-1205 (no text)
  is unchanged. `SearchResult` gains no field; `tier` and `matched_in` keep their meaning (a group-1 result has
  `matched_in == Title` or `FileName`, a group-2 result `Alias`).
- **Speed.** The prefix expansion is an FTS5 prefix query (`"word"*`, a range scan of the term index) plus an
  in-memory check of the file-name stems; FR-SRC-04 AC-11 holds the NFR-PERF-04 core target on the reference vault.

### 9.2 UI (D-1340, D-1343)

- `app/ui/src/Search.tsx` no longer renders `GoTo`; `SearchPage`'s and `App`'s `onGoTo` go. `app/ui/src/GoTo.tsx` is
  deleted when nothing else imports it; `index_switcher` and its pickers stay.
- **Field keys.** ↓: focus the first row's `a.result`; ⏎: open the first result through the row's open path (a new
  history entry, D-1217); ⌥⏎: `onCreate(text, defaultType)`; Esc as today. `Search query` loses `aria-controls` and
  `aria-activedescendant`. On a row, ↑ from the first row focuses the field.
- **Create buttons.** In the count line, after the count text: `button.create` `Create “<q>”`
  (`data-command="search.create"`) and `button.create-as` `as…` (`aria-haspopup="menu"`,
  `data-command="search.createAs"`) opening the existing create Type menu (D-550; the same menu the `Go to` row used).
  In the no-match empty state (no filters), the body and the same two buttons. They call the existing `onCreate` (the
  one creation path, D-232).
- **Strings.** New catalog keys: `search.create` (`Create “{q}”`), `search.createAs` (`as…`),
  `search.noMatchCreate` (`No matches. Create “{q}”?`). Removed: `search.noMatchBody` and the `Go to` list's keys once
  unused (the palette's `cmd.goto.*` stay).

### 9.3 Tests (for the test author)

- L4 (Rust): `crates/tegg-core/tests/ac_search_title.rs` — FR-SRC-01 AC-23…AC-25, FR-SRC-04 AC-8…AC-10 (AC-11 perf at
  G2 nightly, as D-1228). Runtime notes of the `search-title/` table are written by the test.
- L5 (WebKit): `app/webkit/search_no_goto.ac.test.ts` — FR-NAV-01 AC-20…AC-23, FR-SRC-01 AC-23's rendered order,
  FR-SRC-04 AC-10's mark. The fake core's `index_search` (`app/webkit`) gets D-1341's groups and D-1342's prefix so the
  L5 order matches the core (the test author extends it).
- L1: the three catalog keys (AC-23).
- L6: `app/e2e/search_page.ac.test.ts` gets FR-NAV-01 AC-22's created file once.
- **Existing tests that contradict the new ACs** (AC-test changes, approved by the owner on 2026-11-01; each
  commit carries `AC-Test-Change: <reason>; approved-by: owner`): `app/webkit/search_goto.ac.test.ts` (FR-NAV-01 AC-15…AC-17, AC-19, superseded: removed);
  `app/webkit/search_page.ac.test.ts` `fr_nav_01_ac19_*`, `fr_src_03_ac8_*` (no `Go to` in the layout),
  `fr_src_03_ac13_*` (no `Go to` to hide), `fr_src_03_ac16_*` (superseded by AC-22), `fr_src_03_ac17_*` (field keys,
  create buttons in the Tab order), `fr_src_03_ac20_*` (the create buttons are the only writes), `fr_src_02_ac17_*` (no
  `Go to` jump); `crates/tegg-core/tests/ac_search_ranking.rs` `fr_src_01_ac17_*` (order per AC-24);
  `fr_nav_01_ac18_*` and `app/test/v068_registry.ac.test.ts` (the palette's `Go to Search`) stay.
