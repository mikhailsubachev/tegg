# MS4 Links Interface Contract (slice 4A)

- **Status:** draft, 2026-10-15. Written per D-295 before the 4A red tests. Follows D-276…D-295 (BRD v1.45).
- **ACs:** [docs/acceptance/backlinks.md](../acceptance/backlinks.md) (FR-LNK-01 AC-1…AC-16, FR-LNK-02 AC-4…AC-6, FR-LNK-04 AC-4…AC-12, FR-LNK-07 AC-1…AC-3, FR-LNK-14 AC-6…AC-10, FR-SYN-06 AC-9) and its tables R15, R16. Where this contract and the ACs disagree, the ACs win and this contract is corrected before the red tests.
- **Builds on** [ms3-shell.md](ms3-shell.md) (§3 registries, §5 fake core, §11.1 resolution rules, §13 editor, §14 creation path, §15 follow-up), [ms2-core.md](ms2-core.md), [ms2-shell.md](ms2-shell.md) and [ms1-core.md](ms1-core.md). Everything there stays valid unless this contract changes it.
- **Later slices** of MS4 get their own contracts: 4C `ms4-jobs.md` (D-267), 4B, 4D, 4E and 4F sections or files as their ACs need.

Until a part is implemented it exists as a stub that compiles and returns a deliberately wrong result (an empty list, `null` or an `Io` error), so a test fails on its assertion, never on a build or import error (TS-I1).

---

## 1. One resolution rule (D-291 part 1)

- `tegg-index` resolves every stored link with the rules of ms3-shell §11.1 (`Core::resolve_links`) **from its source note**: date first (D-162), relative Markdown path from the source's folder (D-155), vault path, `id`, then stem with same-folder preference, shortest path, code-point order; never by title or alias; never to `_templates/` or `.trash/`. The single-stem map `by_stem` is no longer used for backlinks, broken links or any query of this contract.
- **Re-resolution.** The index keeps each link's resolved path. When a file is added, removed, moved or renamed (watcher, own write, own create), every link whose target key (NFC, lower case, without subpath and alias) equals the old or new stem, path or `id` of that file is re-resolved before `CoreEvent::VaultChanged` is sent, and before an own `note_write` / `note_create` / `link_create` returns (FR-LNK-01 AC-10, FR-LNK-04 AC-5).
- `Core::backlinks(path)` and `Index::backlinks_detailed(path)` use these rules and the D-278 exclusions (self-links, sources in `_templates/` and `.trash/`; inline tags aren't links). Return shapes are unchanged. `Index::resolve_link(target)` (no source) keeps its MS2 behaviour for the MS2 tests only; nothing in the UI calls it.
- The invariant checked by FR-LNK-01 AC-8: for every note T, `backlinks(T) = { S ≠ T | S outside _templates/ and .trash/, some link of S resolves to T }`.
- If an MS2 or MS3 AC test relied on the stem map or on a self-link being a backlink, it changes with `AC-Test-Change: one resolution rule (D-291); approved-by: owner` in the 4A red-test commit.

## 2. Positions and excerpts

### 2.1 Extraction (`tegg-format` and `@tegg/doc`, kept equal by a shared corpus)

Each link record (ms1-core §2 `Link`, `@tegg/doc` `extract()`) gains:

```rust
pub struct Link {
    // existing: target, subpath, alias, embed, in_frontmatter, attribute (D-257)
    pub at: At,                 // where the link starts: 1-based line, byte offset in that line (as `?at=`, ms3-shell §15.2)
    pub block: Option<u32>,     // index into Extracted::blocks for body links; None in frontmatter
}
pub struct At { pub line: u32, pub byte: u32 }
```

`Extracted` gains `blocks: Vec<BlockText>`, one entry per body block that contains at least one link, in file order:

```rust
pub struct BlockText {
    pub kind: BlockKind,                // Paragraph | Heading | ListItem | TableRow | Quote | Callout
    pub segments: Vec<Segment>,         // the block's own inline content, capped at 2,000 characters
}
pub enum Segment {
    Text { text: String, marks: Vec<Mark> },                    // Mark: Strong | Em | Code | Strike | Highlight
    Link { link: u32, marks: Vec<Mark> },                       // index into Extracted::links; text is resolved at query time
}
```

Rules (D-277): a list item's own text without its child items; a table row's cells joined with ` · ` as Text; Markdown markers, `%%comments%%`, block ids and HTML comments dropped; `#tags` kept as plain Text; code spans are `Text` with `Code` (links inside aren't links, dialect §5); math kept as its source text. A Markdown link `[text](Cíl.md)` is a `Link` segment whose display text is its link text.

Frontmatter links need no block: their excerpt is built from the attribute's value at query time (§2.2).

**Parity:** `tests/fixtures/format/excerpt/cases.json` (Markdown → expected `blocks` and link `at`), read by `crates/tegg-format/tests/ac_excerpt.rs` and `packages/doc/test/excerpt.ac.test.ts`.

### 2.2 Excerpt window (query time)

```rust
// tegg-format::excerpt, twin in @tegg/doc `excerptWindow`
pub fn window(rendered: &[RSeg], here: &[usize], max: usize /*160*/, before: usize /*60*/) -> Excerpt;
pub struct Excerpt { pub segments: Vec<RSeg>, pub cut_start: bool, pub cut_end: bool }
pub enum RSeg { Text { text: String, marks: Vec<Mark> }, Link { text: String, target: LinkTargetInfo, here: bool, marks: Vec<Mark> } }
```

- `rendered` is the block's segments with each link's chip text filled in (alias, else the resolved title, `Cíl › Úvod` for a subpath, D-156; unresolved: the target as written). Characters are counted on the rendered text, chips included; a chip is never cut.
- The window starts at most `before` characters before the first `here` chip, at a whitespace boundary, and holds at most `max` characters, ending at whitespace. `cut_start` / `cut_end` tell the UI to show `…`.
- **Attribute excerpts:** the value's text (relation lists joined with `, `, each value a `Link` segment when it is a link; text values with their `[[…]]` as `Link` segments, D-257) through the same window. The label is added by the UI (§5.2).
- `LinkTargetInfo` is the Rust form of `LinkTargetDto` (ms3-shell §11.1).

### 2.3 Index storage (D-285, AR-01)

`SCHEMA_VERSION` becomes 4 ("link positions and block texts, 4A"): the link table stores `at`, `block`, the resolved path (§1) and the block texts. A version change rebuilds the index (as before). Nothing here is read from vault files when a panel opens. FR-LNK-01 AC-12 compares query results after a rebuild, not stored bytes.

## 3. Core API (`tegg-core`)

```rust
impl Core {
    /// FR-LNK-01, -02 (D-276…D-282): one query per opened note, answered from the index.
    pub fn backlinks_panel(&self, path: &str) -> BacklinksPanel;
    /// FR-LNK-04 (D-284).
    pub fn broken_links(&self) -> BrokenLinks;
    /// FR-LNK-14 (D-284, D-290).
    pub fn duplicate_titles(&self) -> Vec<DuplicateGroup>;
    /// FR-LNK-04 (D-286…D-288): read-only plan for the Create offer.
    pub fn link_create_plan(&self, from: &str, target: &str, relation_to: Option<&[String]>) -> LinkCreatePlan;
    /// Writes the planned note if the plan still holds; re-plans first (FR-LNK-04 AC-11).
    pub fn link_create(&self, from: &str, target: &str, expect: &LinkCreatePlan, bytes: &[u8]) -> Result<LinkCreated, CoreError>;
}

pub struct BacklinksPanel { pub objects: usize, pub groups: Vec<BacklinkGroup> }
pub struct BacklinkGroup { pub type_key: String, pub defined: bool, pub raw: String, pub entries: Vec<BacklinkEntry> }
pub struct BacklinkEntry {
    pub source: String, pub title: String, pub type_key: String,
    pub modified: Option<String>,                // as written; ordering uses the instant
    pub read_only: bool,                         // the editor can't open it (NFR-REL-03): open in the source view
    pub occurrences: Vec<Occurrence>,            // all of them, file order, frontmatter first (the UI shows 3, D-278)
}
pub struct Occurrence {
    pub kind: OccurrenceKind,                    // Body | Attribute | Embed
    pub attribute: Option<String>,               // the frontmatter key
    pub attribute_name: Option<String>,          // the Name from the source's type schema, if the key is defined there
    pub at: At,                                  // the first link of this occurrence that points here
    pub excerpt: Excerpt,
}

pub struct BrokenLinks { pub occurrences: usize, pub objects: usize, pub groups: Vec<BrokenGroup> }
pub struct BrokenGroup {
    pub key: String,                             // NFC, lower case, without subpath and alias
    pub label: String,                           // most frequent spelling, ties by code point
    pub count: usize,                            // occurrences
    pub create: LinkCreatePlan,                  // planned from the first source; type per D-284 / FR-LNK-04 AC-10
    pub sources: Vec<BacklinkEntry>,             // same shape as the panel, here = the broken chips
}

pub struct DuplicateGroup { pub key: String, pub label: String, pub objects: Vec<DuplicateObject> }
pub struct DuplicateObject {
    pub path: String, pub title: String, pub type_key: String, pub folder: String,
    pub details: DuplicateDetails, pub backlinks: usize,
}
pub struct DuplicateDetails {
    pub created: Option<String>,                 // as written; the UI formats it (D-160, machine zone)
    pub preview: Vec<(String, serde_json::Value)>, // up to 2 set preview values, in preview order
    pub stem: Option<String>,                    // when it differs from the title (NFC compare)
}

pub enum LinkCreatePlan {
    Create { path: String, title: String, type_key: String, rewrite: Option<String> }, // rewrite: the new link text (D-287)
    Exists { path: String },                     // the target resolves now
    Forbidden { reason: CreateRefusal },         // Folder (D-288, D-222) | NeedsEdit (D-287 from a read-only view: UI decides)
}
pub struct LinkCreated { pub path: String, pub rewrite: Option<String> }
```

- **Ordering in the core:** groups in D-121 order for system types, then user types, then undefined types, then by the instant of `modified` descending inside a group. Name-sorted parts (user-type groups, entries without `modified`, broken-link labels at equal counts, duplicate labels at equal size) are sorted in the UI with the region collator (§5.1, D-122).
- **Duplicate key** (D-290): NFC, trimmed, Unicode case folding, no diacritic folding; one object per `id` (the conflict primary); `_templates/` and `.trash/` ignored; untyped files use their stem (D-103).
- **Plan rules:** title = the target as written, NFC, without subpath and alias. A target with folders → that exact path; type = the type whose `folder` equals the folder, else the default type (D-288); a forbidden folder → `Forbidden(Folder)`. Without folders → the type's folder; type = `relation_to[0]` if given (D-243), else the default type. Stem = `sanitize_file_stem(title)`; when it differs from the title (D-51, D-52, D-80) → `rewrite = Some(linkText)` with `[[<stem>|<target>]]` (D-287). The stem is free vault-wide (§3.1) or the plan says `Exists`.
- **`link_create`:** re-plans; a different plan → `CoreError::PlanChanged { now }` and no write; `Exists` → `CoreError::Exists { path }`. Writes create-exclusive (`RENAME_EXCL`, FR-SYN-02), never over an existing path, indexes and re-resolves before returning. Bytes come from `@tegg/doc` `newObject` (D-82) with the plan's title and type.

### 3.1 Free stems vault-wide (D-291 part 2)

`Core::create_object` (ms3-shell §14.2.3) and `link_create` pick the first of `<stem>`, `<stem> (2)`, … that no indexed file outside `_templates/` and `.trash/` has as its stem anywhere in the vault, compared NFC and case-insensitively, and that is free in the target folder. Existing same-stem files are left as they are. `Core::create_note` (MS2, tests only), `note_create_exact` (Keep both, D-176) and the starter (D-92) are unchanged. 4E's type moves use the same function: `Core::free_stem(folder: &str, stem: &str) -> String`.

## 4. IPC added or changed in 4A

| Command | Arguments | Returns | Notes |
| --- | --- | --- | --- |
| `index_backlinks` | `path` | `BacklinksPanelDto` | `Core::backlinks_panel`. Read-only, records no recency. Re-queried on every `vault:changed` while the panel is shown. |
| `index_broken_links` | — | `BrokenLinksDto` | Read-only. |
| `index_duplicate_titles` | — | `DuplicateGroupDto[]` | Read-only. |
| `link_create_plan` | `from`, `target`, `relationTo: string[] \| null` | `LinkCreatePlanDto` | Read-only; called when the offer opens. |
| `link_create` | `from`, `target`, `expect: LinkCreatePlanDto`, `text` | `{ path, rewrite: string \| null }` | Errors `PlanChanged` (payload: the new plan), `Exists` (payload `{ path }`), `Io`. The one write of the offer. |
| `index_switcher` | unchanged | `SwitcherItemDto[]` | Gains `duplicate: DuplicateDetailsDto \| null` (non-null only when another indexed object shares the title key, D-289). Every picker that lists objects (switcher, `[[` / `@` suggestions, relation pickers) uses these items. |
| `backlinks` | unchanged | | Uses §1. |

```ts
type At = { line: number; byte: number };
type Mark = 'strong' | 'em' | 'code' | 'strike' | 'highlight';
type ExcerptSegDto =
  | { kind: 'text'; text: string; marks: Mark[] }
  | { kind: 'link'; text: string; target: LinkTargetDto; here: boolean; marks: Mark[] };
type ExcerptDto = { segments: ExcerptSegDto[]; cutStart: boolean; cutEnd: boolean };
type OccurrenceDto = { kind: 'body' | 'attribute' | 'embed'; attribute: string | null; attributeName: string | null; at: At; excerpt: ExcerptDto };
type BacklinkEntryDto = { source: string; title: string; type: string; modified: string | null; readOnly: boolean; occurrences: OccurrenceDto[] };
type BacklinkGroupDto = { type: string; defined: boolean; raw: string; entries: BacklinkEntryDto[] };
type BacklinksPanelDto = { objects: number; groups: BacklinkGroupDto[] };

type LinkCreatePlanDto =
  | { state: 'create'; path: string; title: string; type: string; rewrite: string | null }
  | { state: 'exists'; path: string }
  | { state: 'forbidden'; reason: 'folder' };
type BrokenGroupDto = { key: string; label: string; count: number; create: LinkCreatePlanDto; sources: BacklinkEntryDto[] };
type BrokenLinksDto = { occurrences: number; objects: number; groups: BrokenGroupDto[] };

type DuplicateDetailsDto = { created: string | null; preview: [string, unknown][]; stem: string | null };
type DuplicateObjectDto = { path: string; title: string; type: string; folder: string; details: DuplicateDetailsDto; backlinks: number };
type DuplicateGroupDto = { key: string; label: string; objects: DuplicateObjectDto[] };
```

DTOs are generated by `ts-rs` as before (ms2-shell §2). New error kinds `PlanChanged`, `Exists` get catalog messages (`createLink.planChanged`, `createLink.exists` = `"{title}" exists now.`).

## 5. UI

### 5.1 Ordering helper (D-122, D-276, D-284, D-290)

`app/ui/src/links/order.ts`:

```ts
export function orderBacklinks(panel: BacklinksPanelDto, types: TypeDto[], collator: Intl.Collator): BacklinksPanelDto;
export function orderBroken(groups: BrokenGroupDto[], collator: Intl.Collator): BrokenGroupDto[];       // count desc, then label
export function orderDuplicates(groups: DuplicateGroupDto[], collator: Intl.Collator): DuplicateGroupDto[]; // size desc, label; objects by created asc, missing last
```

They keep the core's order for system types and instants, and sort only the name-ordered parts with the collator, so FR-LNK-01 AC-3 and FR-LNK-04 AC-10 hold for `cs` and `en`. L1: `app/test/links_order.ac.test.ts`.

### 5.2 Components

| Module | What it is | Notes |
| --- | --- | --- |
| `links/BacklinksPanel.tsx` | The `backlinks` tab content (R15) | Props `{ path }`. Calls `index_backlinks` on mount, on route change and on `vault:changed`; keeps scroll and focus (FR-LNK-01 AC-9). Virtualized list: at most 100 entry elements in the DOM (AC-16). Collapsed groups in component state only (D-281). |
| `links/Excerpt.tsx` | One excerpt `link` | Props `{ occurrence, source, readOnly }`. Renders segments with marks; chips via the existing chip component with `data-link-kind` and `data-link-here` when `here`; chips aren't separate links (`tabindex=-1`, no role link, D-280); `data-occurrence` = kind. Label prefix: `attributeName`, else the catalog label of a universal key (`attr.description`, `attr.source`, …), else the raw key, then `: `. Embed marker `backlinks.embed` = `Embed`. |
| `links/CreateLinkOffer.tsx` | The non-modal `dialog` `Create note` (D-286) | Props `{ from, target, relationTo, anchor, editor?: TeggEditor, chipPos?: number }`. Calls `link_create_plan` on open; Create → `createObjectForLink` (§5.3). Focus returns to the chip on close. |
| `links/BrokenLinksPage.tsx` | Route `broken-links` | `index_broken_links`, `orderBroken`; entries reuse `Excerpt`. |
| `links/DuplicateTitlesPage.tsx` | Route `duplicate-titles` | `index_duplicate_titles`, `orderDuplicates`; `Merge…` wrapped in `ui/Disabled.tsx` with `Due { milestone: 'MS4', slice: '4C' }`. |
| `links/DuplicateDetails.tsx` | The details line in every picker (D-289) | Formats type name · created (D-160) · preview values (`@tegg/schema` `formatValue`, cut to 40 characters) · stem, joined with ` · `. |

### 5.3 Creating from a link (D-245 path kept)

```ts
// types/create.ts, next to createObject
export function createObjectForLink(from: string, target: string, plan: Extract<LinkCreatePlanDto, { state: 'create' }>,
  opts: { editor?: TeggEditor; chipPos?: number }): Promise<string /* path */>;
```

Builds the bytes with `@tegg/doc` `newObject(type, title, template)` exactly like `createObject`, calls `link_create`, and when the result has `rewrite` and an editor is given, calls `editor.commands.replaceLink(chipPos, rewrite)` before navigating, so the change is one undo step in the source and is saved by the normal autosave (D-287). Without an editor (read view), the offer shows `createLink.needsEdit` and Create stays aria-disabled; the UI never calls `link_create` with a `rewrite` plan then. Then the route becomes `note/<path>` with the caret in the empty body (D-286; ms3-shell §15.2's new-note rule is not used here: the title already comes from the link).

`@tegg/editor` `commands` gains `replaceLink(pos: number, linkText: string): boolean`: replaces the wikilink node at `pos` with `[[linkText]]` (D-184 bytes) as one transaction.

### 5.4 Routes, commands, registry

- Routes `broken-links` and `duplicate-titles` (R16). `note/<path>?attr=<key>` (new): after `note-ready`, the `Properties` region scrolls into view and the value control of `<key>` gets the focus, not in edit mode (FR-LNK-01 AC-6). `?at=` is unchanged (ms3-shell §15.2).
- Commands: `panel.backlinks` (`Show backlinks`), `goto.brokenLinks`, `goto.duplicateTitles` (`needsVault: true`, no shortcut, D-281). ⌘↩ (`Open link or toggle checklist item`, D-209) on a broken link opens the offer.
- `registry.ts`: `Slice` becomes `'3A' | … | '3E' | '4A' | '4B' | '4C' | '4D' | '4E' | '4F'`; a Due with an MS4 slice displays `MS4 (4C)` (D-292). `overdue('MS4')` treats every `MS4 (4x)` as MS4. The R1…R5 changes of R16 are made in the commit that builds 4A.
- i18n keys (all in `app/ui/src/i18n/en.json`, plural forms per D-133): `backlinks.count` (`{n} objects link here`), `backlinks.empty`, `backlinks.emptyHint`, `backlinks.more` (`Show {n} more`), `backlinks.embed`, `backlinks.unlinked`, `brokenLinks.title`, `brokenLinks.summary` (`{n} broken links in {m} objects`), `brokenLinks.create` (`Create "{label}"`), `duplicates.title`, `duplicates.summary` (`{n} titles shared by {m} objects`), `duplicates.backlinks` (`{n} backlinks`), `duplicates.merge`, `createLink.title` (`Create note`), `createLink.noNote` (`No note named "{target}"`), `createLink.type` (`Type: {type}`), `createLink.create`, `createLink.rewrite`, `createLink.needsEdit`, `createLink.folder`, `createLink.exists`, `createLink.planChanged`, `commands.showBacklinks`, `commands.gotoBrokenLinks`, `commands.gotoDuplicateTitles`. Exact English texts are those of the ACs.
- **Marks:** `backlinks-painted:<path>` when the first group has painted (FR-LNK-01 AC-16 benchmark, report only in MS4, D-152).

## 6. Fake core additions (ms3-shell §5, §13.7, §14.8, §15.8)

`installFakeCore` implements `index_backlinks`, `index_broken_links`, `index_duplicate_titles`, `link_create_plan`, `link_create` and the `duplicate` field of `index_switcher` over its in-memory files, with the real `@tegg/doc` extraction and `excerptWindow` (§2), the §11.1 resolution rules and §1's exclusions, and types from `@tegg/schema`. `link_create` counts in `writes()`. `setFile` triggers re-resolution and `vault:changed` as before. No new `FakeCoreHandle` method; the "fake handles exactly the registered commands" test covers the new commands.

## 7. Test layout

- **L4** `crates/tegg-core/tests/ac_backlinks.rs`: FR-LNK-01 AC-2, AC-3 (instant order), AC-7, AC-9 (index), AC-11, AC-12; FR-LNK-02 AC-4 (keys), AC-5 (embed flag); FR-LNK-04 AC-5 (write, re-resolution), AC-7…AC-9, AC-10 (grouping, counts), AC-11; FR-LNK-14 AC-6 (data), AC-7, AC-8 (groups, counts), AC-10.
- **L2** `crates/tegg-core/tests/ac_property_backlinks.rs`: FR-LNK-01 AC-8 (fixed seed + one random seed per push; nightly 10 × 1,000).
- **L1** `crates/tegg-format/tests/ac_excerpt.rs` + `packages/doc/test/excerpt.ac.test.ts` (shared corpus, FR-LNK-01 AC-4 building), `app/test/links_order.ac.test.ts`, `app/test/excerpt.ac.test.ts` (labels, marks, embed marker), `app/test/create_link.ac.test.ts` (FR-LNK-04 AC-6, AC-7 names and link text), `app/test/catalog.ac.test.ts` (FR-LNK-01 AC-15 plural forms), `app/test/registry.ac.test.ts` (R16).
- **L5** `app/webkit/backlinks.ac.test.ts` (FR-LNK-01 AC-1, AC-3…AC-6, AC-9, AC-10, AC-11 one case, AC-13…AC-15; FR-LNK-02 AC-4…AC-6), `app/webkit/broken_links.ac.test.ts` (FR-LNK-04 AC-4…AC-8, AC-10…AC-12), `app/webkit/link_style.ac.test.ts` (FR-LNK-07 AC-1…AC-3), `app/webkit/duplicates.ac.test.ts` (FR-LNK-14 AC-6, AC-8, AC-9, AC-10 one entry point).
- **L6** `app/e2e/ms4_links.ac.test.ts`: FR-SYN-06 AC-9, FR-LNK-04 AC-5 and AC-12 once, FR-LNK-01 AC-10 once; benchmark `app/e2e/perf_backlinks.ts` (FR-LNK-01 AC-16).
- **Fixture:** `tests/fixtures/vaults/backlinks/` as described in its README, written byte-exact in its own commit before the tests (two NFD spots).
- **AC-Test-Change** in the 4A build commit: read-view FR-EDT-02 AC-8 and editor FR-EDT-02 AC-16 (D-293); any MS2/MS3 test affected by §1 (D-291).

## 8. Contract choices (no owner decision needed)

1. Excerpts are built in Rust from block texts stored in the index, with a TypeScript twin for the fake core and L1, kept equal by one shared corpus (the D-241 pattern). The window is cut at query time because it depends on which chip points at the opened note.
2. The core orders by type order and instants; the UI applies the region collator to name-ordered parts (D-122 needs `Intl.Collator`). FR-LNK-01 AC-3's "L4 for the order" therefore covers the instant order and the group order; the collation part is L1 (`links_order.ac.test.ts`) and L5.
3. The Create offer is a plan/commit pair (`link_create_plan`, `link_create`) so the offer can show the D-287 message before anything is written, and the write re-checks the plan (FR-LNK-04 AC-11).
4. `?attr=<key>` is a new route parameter, parallel to `?at=`, for property occurrences.
5. The broken-links group's Create plan is computed from its first source; `relationTo` comes from the relation's `to` only when every occurrence in the group is a relation value with `to` (FR-LNK-04 AC-10).
