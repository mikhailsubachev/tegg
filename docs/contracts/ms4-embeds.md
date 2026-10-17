# MS4 Embeds Interface Contract (slice 4F)

- **Status:** draft, 2026-10-17. Written per D-430 before the 4F red tests, as ms4-links.md was for 4A (D-295). Follows D-415…D-432 (BRD v1.63).
- **ACs:** [docs/acceptance/embeds.md](../acceptance/embeds.md) (FR-EMB-01 AC-1…AC-14, FR-EMB-02 AC-1…AC-15, FR-EMB-03 AC-1…AC-14, FR-EMB-04 AC-1…AC-9, FR-LNK-07 AC-4…AC-8, FR-FMT-07 AC-13…AC-15, FR-SYN-06 AC-10) and its tables R30…R33. Where this contract and the ACs disagree, the ACs win and this contract is corrected before the red tests.
- **Builds on** [ms4-links.md](ms4-links.md) (§1 resolution, §5.2 chips, §5.3 Create offer, §6 fake core), [ms4-daily.md](ms4-daily.md) (§4.1 virtual Daily Note), [ms3-shell.md](ms3-shell.md) (§5 fake core, §11 read view, §13 editor and autosave, §14 types and type files), [ms2-core.md](ms2-core.md) and [ms1-core.md](ms1-core.md). Everything there stays valid unless this contract changes it.
- **Not relied on:** slice 4C (`tegg-jobs`, renames; PR #45). Numbers D-383…D-414 and AP-288…AP-317 belong to it.

Until a part is implemented it exists as a stub that compiles and returns a deliberately wrong result (an empty list, `null`, `'card'`, `false` or an `Io` error), so a test fails on its assertion, never on a build or import error (TS-I1).

---

## 1. Model

- **Embed.** A wikilink with `!` whose target isn't an attachment (dialect §5; attachments keep their R5 placeholders, D-144). Its inner text `value` is `target[#subpath][|rest]`.
- **Position** (D-419). A **block embed** is a body paragraph whose only content is the embed (`@tegg/doc` block kind `embed`, today's `rawBlock` with `kind: 'embed'` in the editor) at the top level of a body: the host's, or an embedded note's. Every other embed (inside text, list items, quotes, callouts, headings, table cells) is an **inline embed** and always shows in link mode.
- **Mode** (D-416, D-417). `full | card | link`. For a block embed: the keyword after `|` if it is one (case-insensitive, trimmed), else the target type's effective `embed` default (R31). Inline embeds: `link`.
- **Depth** (D-420). The open note is depth 0; an embed in it is depth 1; an embed in a full embed at depth *d* is depth *d + 1*. Only full embeds at depth ≤ 3 expand. An embed at depth 4 is `too-deep` (link mode). A full embed whose target **path** equals the open note's path or the path of any ancestor frame is `circular`, whatever its subpath. Card and link embeds never expand, so they are never circular.
- **State** (R30a): `ok`, `broken`, `missing-section`, `date-missing`, `circular`, `too-deep`, `read-only`. `read-only` is an `ok` full embed whose body can't be edited (D-421, D-424); in the data it is `ok` with `readOnly` set, and the frame has `data-embed-state="read-only"`.
- **Editable** (D-421): a depth-1 full embed of a whole note or a `#Heading` section, in the editor (not the read view), whose file is UTF-8 with valid or absent frontmatter. Everything else is read-only.

## 2. `@tegg/doc` (`packages/doc/src/embed.ts`, exported from the index)

```ts
export type EmbedMode = 'full' | 'card' | 'link';

/** D-416: the mode keyword of an embed's inner text, and the inner text without `|…`. */
export function embedParts(value: string): { target: string; subpath: string | null; mode: EmbedMode | null; rest: string | null };
//  'Cíl|card'      → { target: 'Cíl', subpath: null, mode: 'card', rest: 'card' }
//  'Cíl|jiný text' → { target: 'Cíl', subpath: null, mode: null, rest: 'jiný text' }
//  'Cíl#Úvod'      → { target: 'Cíl', subpath: 'Úvod', mode: null, rest: null }
//  The table-cell form `\|` is accepted like `|`. target is trimmed, not normalized (the caller compares NFC).

/** D-416: the inner text with the mode set; `null` removes the `|…` part. Replaces any other text after `|`.
 *  Keeps the target and subpath bytes as written (NFD stays NFD) and the `\|` form if the value used it. */
export function withEmbedMode(value: string, mode: EmbedMode | null): string;

/** D-422, D-420 (block ids): the part of a note's body an embed shows. Offsets are UTF-16 indexes into `text`
 *  (the whole file). `whole`: the body after the frontmatter (and after a leading `# ` title line only if the note
 *  page hides it today, ms3-shell §13.3), to the end. `heading`: from the start of the line after the first heading
 *  whose text matches `subpath` (NFC, trimmed, case-insensitive) to the start of the next heading of the same or a
 *  higher level, or the end of the file. `block`: the block whose last line ends with ` ^<id>` (id compared exactly).
 *  `missing`: no such heading or block. */
export type Section =
  | { kind: 'whole'; from: number; to: number }
  | { kind: 'heading'; from: number; to: number; heading: { level: number; text: string; line: number } }
  | { kind: 'block'; from: number; to: number; id: string }
  | { kind: 'missing'; subpath: string; block: boolean };
export function embedSection(text: string, subpath: string | null): Section;

/** The block embeds of a body in file order (D-419): one entry per sole-embed paragraph at the top level, with the
 *  1-based line of the paragraph and its inner text; and the inline embeds (non-attachment `![[…]]` elsewhere). Code,
 *  comments and frontmatter never contain embeds (FR-EMB-01 AC-4). `from`/`to` limit the scan to a section. */
export function embedsIn(text: string, from?: number, to?: number): { block: { value: string; line: number }[]; inline: { value: string; line: number }[] };
```

L1 tests: `packages/doc/test/embeds.ac.test.ts` (FR-EMB-02 AC-3 sections, AC-1 mode keyword, AC-8 line text). The section rules are UI-only; there is no Rust twin.

## 3. Types and the type file (`tegg-schema`, `tegg-core`)

- `TypeDef` gains `embed: Option<String>`: the raw value of the top-level key `embed` (trimmed), `None` when absent.
- `pub enum EmbedMode { Full, Card, Link }` with `EmbedMode::parse(&str) -> Option<EmbedMode>` (case-insensitive, trimmed) and `as_str()` (`full`, `card`, `link`).
- `pub fn default_embed(key: &str) -> EmbedMode`: R31 (`page`, `quick-note`, `daily-note` → `Full`; everything else `Card`).
- `TypeDef::effective_embed(&self) -> EmbedMode`: `parse(raw)` else `default_embed(key)`. A type key without a definition (D-121) uses `default_embed(key)`, which is `Card` for every non-system key.
- `TypeOp::SetEmbed(EmbedMode)` writes `embed: <mode>` (lower case). Placement by `TOP_ORDER`, which gains `"embed"` after `"hidden"` (so after `hidden` when present, else after `preview`, D-417). The key is replaced in place when present (also when its value was unknown). Setting the value the file already has (same lower-case text) is no write (`TypeOp` returns unchanged, the core's `type_patch` returns the type without writing). A system type without a file is materialised from its built-in text first (D-90), as for every other `TypeOp`.
- Reading never rewrites a file (D-417). An unknown value isn't an error: the file's `state` stays `ok`.
- **DTO:** `TypeDto` gains `embed: string` (the effective mode) and `embedRaw: string | null` (the raw value). `TypeOpDto` gains `{ "op": "embed", mode: "full" | "card" | "link" }`.
- L4: `crates/tegg-schema/tests/ac_embed_mode.rs` (FR-EMB-02 AC-6 values, AC-7 bytes: `osoba.yml` line insertion, `task.yml` creation, no-op on the same value, unknown value kept on read).

## 4. Loading embedded notes (`tegg-core`, IPC)

```rust
impl Core {
    /// D-429: one call per nesting level. Reads every path once (duplicates in `paths` are read once and returned
    /// once, first-seen order), from the files (AR-01), records no recency (D-138) and changes no index state.
    /// For each file, resolves its own link targets from its own path (ms3-shell §11.1), so a nested level needs
    /// no extra `link_resolve` call.
    pub fn embed_load(&self, paths: &[String]) -> Vec<EmbedNote>;
}
pub struct EmbedNote {
    pub path: String,
    pub state: EmbedLoadState,          // Ok | Missing (no such file, in `.trash/` or `_templates/`) | Io
    pub text: Option<String>,           // decoded with U+FFFD for invalid bytes (D-180)
    pub version: Option<FileVersion>,   // base for the embed's autosave
    pub utf8: bool,
    pub links: Vec<LinkTarget>,         // resolution of every target `@tegg/doc` `linkTargets(text)` lists, same order
}
```

| Command | Arguments | Returns | Notes |
| --- | --- | --- | --- |
| `embed_load` | `paths: string[]` | `EmbedNoteDto[]` (deduplicated, first-seen order) | `Core::embed_load`. Read-only; records no recency; never calls `read_note`. Errors per file are in `state`, never a rejected call. |
| `note_write` | unchanged | | Embedded files are saved with it, each with its own base (D-421). |
| `vault_types`, `type_get`, `type_patch` | unchanged | `TypeDto` with `embed`, `embedRaw` | `type_patch` accepts the `embed` op (§3). |

```ts
type EmbedNoteDto = {
  path: string;
  state: 'ok' | 'missing' | 'io';
  text: string | null;
  version: VersionDto | null;
  utf8: boolean;
  links: LinkTargetDto[];     // same order as linkTargets(text)
};
```

The link targets are those of `@tegg/doc` `linkTargets` (ms3-shell §11.3, app `read/ReadView.tsx`); the Rust side uses `tegg_format::extract` links (wikilinks and embeds without attachments, Markdown links, frontmatter relations), NFC, deduplicated in first-seen order. A target the UI can't find in `links` is shown as unresolved until the next load (never a crash).

L4: `crates/tegg-core/tests/ac_embeds.rs` (FR-EMB-01 AC-2 resolution through `embed_load` links and `resolve_links`, FR-EMB-02 AC-6 types, AC-11 no recency, AC-10 events for created/changed/deleted targets, FR-EMB-03 AC-3 base check).

## 5. The embed tree (`app/ui/src/embeds/tree.ts`)

Pure functions, no IPC; the loader is passed in. They are the L1 and L2 surface for FR-EMB-02 AC-1, FR-EMB-04.

```ts
import type { EmbedMode } from '@tegg/doc';
export type EmbedState = 'ok' | 'broken' | 'missing-section' | 'date-missing' | 'circular' | 'too-deep';
export type EmbedNode = {
  value: string;                 // inner text as written
  line: number;                  // 1-based line in the note that contains it
  inline: boolean;               // D-419
  depth: number;                 // 1…4
  mode: EmbedMode;               // after D-419 (inline → link) and D-420 (too-deep → link)
  state: EmbedState;
  target: LinkTargetDto;         // resolution from the note that contains it
  subpath: string | null;
  note: EmbedNoteDto | null;     // loaded file (full and card, state ok / missing-section / circular use the header only)
  section: Section | null;       // full mode, state ok
  readOnly: boolean;             // D-421 (depth > 1, block subpath, invalid frontmatter, !utf8); the read view sets all
  children: EmbedNode[];         // full mode, state ok, depth < 4: the embeds inside the shown section
};
export type EmbedTree = { path: string; embeds: EmbedNode[]; loads: number /* embed_load calls made */ };

/** The mode of one embed (D-416, D-417, D-419). `types` are the vault's types; a type key without a definition → R31. */
export function embedModeFor(value: string, targetType: string | null, types: TypeDto[], inline: boolean): EmbedMode;

/** Builds the tree level by level: one `load` call per depth with every path of that depth that must be read
 *  (full ok embeds and cards), deduplicated against everything already loaded (D-429). `host` is the open note
 *  with its `link_resolve` result. Terminates for any vault (FR-EMB-04 AC-7). */
export function buildEmbedTree(
  host: { path: string; text: string; links: Map<string, LinkTargetDto> },
  types: TypeDto[],
  load: (paths: string[]) => Promise<EmbedNoteDto[]>,
  opts?: { readOnly?: boolean /* read view */; maxDepth?: 3 },
): Promise<EmbedTree>;
```

- Card values: the frontmatter of `note.text` read with `@tegg/doc` and formatted with `@tegg/schema` `formatValue` as on the type page (D-427). Relation values become chips through the card note's `links`.
- Unresolved, alias-only, template and trash targets are `broken` (D-424 (1)). A `daily` target loads like a note; `date-missing` loads nothing (D-424 (3)). `missing` from `embed_load` (deleted between resolve and load) is `broken`.
- `missing-section`: `embedSection` returned `missing` (header + message, D-424 (2)).

## 6. Rendering (`app/ui/src/embeds/`)

| Module | What it is | Notes |
| --- | --- | --- |
| `embeds/Embed.tsx` | One embed of R30 for an `EmbedNode` | Props `{ node, host: string, editable: boolean, onOpen(path, fragment?), onMode?(mode), onEnter?(), onCreate?(el) }`. Frame: `section[role=group]` with R30's name and data attributes; header; body (full: read-only `ReadView` body of the section, or the slot for a nested editor; card: the `Properties` list; states: message). Link mode: `a`-like `role=link` span. Every string from R33 keys. |
| `embeds/EmbedEditor.tsx` | The nested editor of an editable full embed (D-421) | Creates a `@tegg/editor` editor on the embedded file's whole text with `section` set (§7), its own `Saver` (autosave.ts) with the base from `embed_load`, the conflict and deleted dialogs of the note page naming the embedded note, and its own undo history. Registers with the page's save-state aggregate. |
| `embeds/useEmbeds.ts` | Loads and keeps the tree for an open note | Calls `buildEmbedTree` with `ipc.embedLoad`; rebuilds on `vault:changed` when a changed path is loaded, is a type file, or isn't indexed yet (a created target, AC-10); keeps scroll and focus. Writes `perf_mark('embeds-painted')` once all depth-1 content has painted (D-429). |
| `embeds/EmbedPicker.tsx` | The `combobox` `Embed object` (R30) | Uses `index_switcher` items and matching (FR-NAV-01), templates and trash excluded, duplicate details (D-289), last row `Create "<query>"` (D-106, through `createObject`'s one creation path, no navigation). Returns the D-184 target text (`linkText`) of the choice. |
| `embeds/pageSave.ts` | The note toolbar's save state over every file of the page (D-421) | `saving` while any saver is saving, `failed` if any failed, `saved` only when all are saved; ⌘Q / close / navigation await every saver's flush (FR-EMB-03 AC-7, AC-13). |

- **Read view** (`read/ReadView.tsx`): `ReadViewProps` gains `embeds?: EmbedTree` and `renderEmbed?: (value: string, line: number, inline: boolean) => ReactNode`. With `renderEmbed`, every non-attachment embed calls it instead of `InNotePlaceholder id="embed-note"`; attachment embeds keep their R5 placeholders. Without it (L1 tests of 3B) the old behaviour is kept, minus the `embed-note` row: a note embed without a renderer renders as a link-mode embed of the resolution in `links`.
- **Editor**: the note page's `EditorPane` passes `EditorUi.embed` (§7) which mounts `Embed` (and, when editable, `EmbedEditor`) into the node view's DOM with a React root.
- **Tokens** (`theme/tokens.ts`, both themes): `embed-border`, `embed-bg`; `danger` and `muted` reused. Contrast ≥ 4.5:1 for text tokens on `embed-bg` (FR-LNK-07 AC-8).
- **Broken frame** (D-424): `border-style: dashed` in `danger`, transparent background, header = the existing unresolved `Chip` with `requestOffer` (ms4-links §5.3) — the D-310 path, now inside the frame. After Create, the next tree build shows the new note.

## 7. `@tegg/editor` additions

```ts
export interface EditorUi {
  // …existing
  /** 4F: renders a block embed (`rawBlock` kind `embed`). Returning null keeps the 3C placeholder. `getPos` follows
   *  edits. The handle's `update` gets the new source after an undo or a mode change; `selected` reflects the block
   *  selection; `destroy` unmounts. */
  embed?(source: string, dom: HTMLElement, getPos: () => number | undefined): EmbedHandle | null;
  /** 4F: an inline embed (`wikiLink` with `embed: true`) as a link-mode embed (D-419): its title, type icon key,
   *  state and accessible description. Undefined while unknown. */
  embedChip?(value: string): { title: string; type: string | null; state: 'ok' | 'broken' | 'too-deep'; description: string } | undefined;
}
export interface EmbedHandle { update(source: string): void; selected(on: boolean): void; destroy(): void }

export interface EditorOptions {
  // …existing
  /** 4F (D-421, D-422): show and edit only this part of the body: `null` = whole body (frontmatter and title hidden
   *  as today), a heading text = that section without its heading line, recomputed after each `markSaved`.
   *  Transactions that would change text outside the part are rejected; saves write the whole file (source-preserving). */
  section?: string | null;
  /** 4F (D-428): ↑ on the first line / ↓ on the last line of a nested editor, and Esc. Return true when handled. */
  onLeave?(how: 'up' | 'down' | 'escape'): boolean;
  /** 4F (D-428): ⏎ / ⌘↩ / `Display embed as…` on a selected block embed at `pos`. Return true when handled. */
  onEmbedKey?(pos: number, key: 'enter' | 'open' | 'displayAs'): boolean;
}

export interface TeggEditor {
  // …existing
  /** The block embed at the selection (block selection of one embed, or a node selection), or null. */
  selectedEmbed(): { pos: number; index: number; source: string } | null;
  commands: {
    // …existing
    /** D-416: rewrites the block embed at `pos` with `withEmbedMode`, as one undo step. */
    setEmbedMode(pos: number, mode: EmbedMode | null): boolean;
    /** D-426: replaces `from…to` (the typed `/emb` or the caret's empty paragraph) with a block embed `![[linkText]]`,
     *  after the caret's block when it has other text (FR-EDT-03 AC-4), as one undo step. */
    insertEmbed(from: number, to: number, linkText: string): boolean;
    /** D-428: selects the top-level block at `index` as a block (used by Esc from a nested editor). */
    selectBlockAt(index: number): boolean;
  }
}
```

- A paragraph whose only content becomes a `wikiLink` with `embed: true` (typed `![[Cíl]]`, or chosen from `![[` suggestions) is turned into a `rawBlock` kind `embed` in the same transaction (FR-EMB-01 AC-9); the source text is `![[<value>]]` byte for byte. Attachments stay `rawBlock` placeholders (R5).
- Keys on a selected block embed (D-428): ⏎ calls `onEmbedKey(pos, 'enter')` and the app enters the nested editor; ⌘↩ calls `onEmbedKey(pos, 'open')`. Arrow keys select an embed block as today (FR-EDT-13).
- Embed blocks keep their bytes through moves, duplicates and deletes (FR-EDT-01 AC-8, FR-FMT-07 AC-14).
- L1: `packages/editor/test/embeds.ac.test.ts` (sole-embed conversion, `setEmbedMode` line text and undo, `insertEmbed` bytes, `section` editing writes only the section, heading typed inside ends it after `markSaved`, `onLeave`).

## 7.1 Slash menu, palette, registry, strings

- `slash.ts`: `embedObject` built (no `due`); `blockEmbed` `due: { milestone: 'v1.0' }`. `registry.ts` R6: `embedObject` built with `FR-EMB-01`; `blockEmbed` due `v1.0`, requirements `FR-EMB-01, FR-LNK-06` (R32). `IN_NOTE_PLACEHOLDERS` loses `embed-note` (R5).
- Commands (R4, section `edit`, `needsVault: true`, no shortcut): `edit.embedObject` (`Embed object…`), `edit.openEmbed` (`Open embedded note`), `edit.displayEmbedAs` (`Display embed as…`). The last two are unavailable (not run, no error) without a selected embed.
- Type settings (R12): section `Embeds` between `Hidden properties` and `Review workflow`: `radiogroup` `Default embed mode`, hint, unknown-value `status`; a choice sends `type_patch` with `[{ op: 'embed', mode }]` and the type's version as base; choosing the checked value sends nothing.
- i18n keys: R33, in `app/ui/src/i18n/en.json`.
- Marks: `embeds-painted` (D-429, report-only in MS4, enforced from MS8).

## 8. Fake core additions (ms3-shell §5, ms4-links §6)

- `embed_load` over the in-memory files: `linkTargets` from the app module and the §11.1 resolution from each file's path; `missing` for absent paths and for `_templates/` / `.trash/`; recorded in `calls()`; never touches recency, `writes()` or `vault_last`.
- `TypeDto.embed` / `embedRaw` and the `embed` op through `@tegg/schema` (the fake core's type path, ms3-shell §14.8). `@tegg/schema` gains the same `effectiveEmbed(def)` / `defaultEmbed(key)` rules and the `embed` op, with the Rust bytes (shared corpus `tests/fixtures/types/embed/cases.json`).
- `writeControl` gains `path?: string`: when set, `delayMs`, `fail` and `hold` apply only to writes (`note_write`, `note_create`, `note_create_exact`, `link_create`, `daily_create`, `type_patch`) whose path is that path; without it they apply to every write as before. `FakeCoreHandle.writeControl({ path, ... })` — same method, new optional field (FR-EMB-03 AC-3, AC-13).
- `calls()` records `embed_load` with its `paths` (FR-EMB-02 AC-12 counts).

## 9. Test hooks (only with `TEGG_TEST=1`, and in the L5 build)

- `window.__TEGG_TEST__.embeds()`: `{ path: string; depth: number; editable: boolean; text(): string; dirty(): boolean; historyDepth(): number }[]` for the nested editors of the open page, in document order (FR-EMB-03 AC-6, AC-8, AC-9). Read-only.
- `window.__TEGG_TEST__.editor` stays the host editor.

## 10. Test layout

- **L1** `packages/doc/test/embeds.ac.test.ts` (§2), `packages/editor/test/embeds.ac.test.ts` (§7), `app/test/embeds_tree.ac.test.ts` (§5: modes, states, depth, circularity, AC-1, FR-EMB-04 AC-1, AC-5), `app/test/embeds_render.ac.test.ts` (R30 roles, names, attributes; FR-EMB-02 AC-2, AC-4; FR-LNK-07 AC-6 L1 part), `app/test/embeds_registry.ac.test.ts` (R32, R33, FR-EMB-01 AC-1 registry part, AC-11 registry part, FR-EMB-02 AC-15 L1 part), `app/test/embeds_theme.ac.test.ts` (FR-LNK-07 AC-8 tokens). New tests go in new files, never into existing AC test files (TS-I3).
- **L2** `app/test/embeds_property.ac.test.ts` (FR-EMB-04 AC-7 on `buildEmbedTree` with an in-memory loader), `packages/editor/test/embeds_property.ac.test.ts` (FR-FMT-07 AC-15).
- **L4** `crates/tegg-schema/tests/ac_embed_mode.rs` (§3), `crates/tegg-core/tests/ac_embeds.rs` (§4).
- **L5** `app/webkit/embeds.ac.test.ts` (FR-EMB-01, FR-EMB-02 AC-1…AC-12, AC-14, AC-15), `app/webkit/embeds_edit.ac.test.ts` (FR-EMB-03), `app/webkit/embeds_cycles.ac.test.ts` (FR-EMB-04), `app/webkit/embeds_style.ac.test.ts` (FR-LNK-07 AC-4…AC-8), `app/webkit/embeds_writes.ac.test.ts` (FR-FMT-07 AC-13, AC-14, FR-SYN-06 AC-10 L5 part), with `app/webkit/embeds-helpers.ts`.
- **L6** `app/e2e/ms4_embeds.ac.test.ts`: FR-EMB-01 AC-1 (once), AC-7 (once), AC-12, AC-13 (once, ⌫); FR-EMB-02 AC-7 (once); FR-EMB-03 AC-2, AC-3 (once), AC-7 (close, ⌘Q), AC-9 (3 rounds), AC-14 (nightly); FR-EMB-04 AC-8; FR-FMT-07 AC-13; FR-SYN-06 AC-10. Benchmark `app/e2e/perf_embeds.ts` (FR-EMB-02 AC-13, report only).
- **Fixture:** `tests/fixtures/vaults/embeds/` written byte-exact from its README in its own commit before the tests (NFD spots as listed there).
- **AC-Test-Change** in the 4F build commit (D-431): read-view R5 / FR-EDT-02 AC-13, editor FR-EDT-02 AC-21 and R6, backlinks FR-LNK-04 AC-6 wording and R16, types R12, app-shell R4 tests, with `AC-Test-Change: 4F replaces the embed-note placeholder (D-144, D-310); approved-by: owner`.

## 11. Contract choices (no owner decision needed)

1. One IPC call per nesting level (`embed_load`) both reads the files and resolves their links, so nested levels need no per-note `link_resolve` (D-429, FR-EMB-02 AC-12). The host still uses its one `link_resolve` (read-view NFR-PERF-05 AC-3).
2. Section embeds are edited by a nested editor on the **whole file** limited to the section (§7 `section`), not by an editor on a text slice, so frontmatter handling (D-54, D-55) and source preservation are the note editor's own.
3. The embed tree is built in TypeScript (one implementation, used by the read view, the editor and the fake core); the core only reads and resolves. FR-EMB-04 AC-7's "Rust twin" clause doesn't apply.
4. `embed_load` never uses `read_note` because that records recency (ms3-shell §11.1, D-138).
5. Live updates rebuild the whole tree on a relevant `vault:changed`; editable embeds with unsaved edits follow the note editor's conflict rules instead of reloading (FR-EMB-03 AC-3, AC-4).
