# MS4 Tags Interface Contract (slice 4D-lite)

- **Status:** draft, 2026-10-22. Written before the 4D-lite red tests (as D-430, D-552). Follows D-636…D-686 (BRD v1.84).
- **ACs:** [docs/acceptance/tags.md](../acceptance/tags.md) (FR-TAG-01…08, -10; FR-SRC-02 AC-10…AC-12; FR-EDT-15 AC-5, AC-6; FR-HIS-04 AC-7…AC-10; FR-LNK-14 AC-11…AC-14; FR-NAV-04 AC-8; FR-FMT-07 AC-23; FR-SYN-06 AC-31, AC-32) and the earlier criteria it changes (D-675). Where this contract and the ACs disagree, the ACs win and this contract is corrected before the red tests.
- **Builds on** [ms4-jobs.md](ms4-jobs.md) (the job engine, text ops, backups, the not-updated list), [ms4-links.md](ms4-links.md) (§1 resolution, §3.1 free stems), [ms3-shell.md](ms3-shell.md) (§5 fake core, §13 `note_read` / `note_write` / `note_create_exact`, §14 types), [ms5-tasks.md](ms5-tasks.md) (the tag filter control, quick-add), [ms5-capture.md](ms5-capture.md) (capture ACL), [ms6-trash-media.md](ms6-trash-media.md) (§1.4 trash moves). Everything there stays valid unless this contract changes it.
- **Writes.** `New tag` and a colour choice are single note writes from the UI with `@tegg/doc` bytes (one text engine, D-82). Rename, `Remove from…`, merge and restore are jobs with a backup zip first. `Delete only the tag` is one trash move (ms6-trash-media §1.4). Viewing anything writes nothing (FR-SYN-06 AC-31).

Until a part is implemented, it exists as a stub that compiles and returns a deliberately wrong result (an empty list, `None`, the input unchanged, or `NotImplemented`). A test then fails on its assertion, never on a build or import error (TS-I1).

---

## 1. Tags in the index (`tegg-index`, `tegg-core` module `tags4d.rs`)

### 1.1 Tag files (D-640, D-665)

- The index already holds every object's tag keys and spellings (`NoteMeta.s.tags`, `tag_spellings`; templates and `.trash/` are not indexed). It gains, per object with `type: tag` (FR-TYP-13 matching, any folder outside `_templates/` and `.trash/`): `tag_title_key` = `tag_key(title)`, or `tag_key(stem)` when `title` is missing or not a string; and `tag_color_raw` = the trimmed string value of `color`, or none.
- **Winner per key:** the oldest valid `created` (ISO instant, D-60 parse rules), then path order (NFC, byte order). Losers are kept in `TagRow.losers` and are already on Duplicate titles by the same-title rule (D-290). A Tag file whose key has no occurrence is still a tag (count 0).
- All of it is derived from the files on every index build; nothing new is stored outside the index cache (AR-01, FR-TAG-02 AC-2).

### 1.2 `Core::tag_rows() -> Vec<TagRow>`

```rust
pub struct TagRow {
    pub key: String,                 // tag_key: NFC, lower case
    pub name: String,                // display name (D-657): the winner's title (stem when missing), else the most frequent spelling (D-185)
    pub file: Option<TagFileRef>,    // the winning Tag file
    pub losers: Vec<String>,         // other Tag files of the key, in winner order
    pub color: Option<String>,       // one of the eight R14 tokens, else None (unknown, empty, missing, virtual; D-653)
    pub color_raw: Option<String>,   // the winner's raw `color` (for `Unknown colour "magenta"`, D-669)
    pub count: usize,                // objects with an occurrence, one per object (D-647)
    pub last_used: Option<String>,   // newest valid `modified` among them, as written (D-667)
    pub last_used_ns: Option<i128>,  // the same instant for sorting
}
pub struct TagFileRef { pub path: String, pub version: FileVersion }
```

- Rows for every key with count ≥ 1 and every winning Tag file. Order: key order (the UI sorts, R81).
- `Core::tags()` (D-185, used by autocomplete and the tasks filter) stays and is defined as `tag_rows()` mapped to `{ key, spelling: name, count }`, so count-0 tags are offered too (FR-EDT-15 AC-6; D-668 (f) filters count ≥ 1 in Search and the Tasks filter in the UI).

### 1.3 `Core::tag_objects(key) -> Vec<TagObjectRow>`

One row per object with an occurrence of `key` (no templates, no trash), in path order; the UI filters, sorts and groups (R82, D-668).

```rust
pub struct TagObjectRow {
    pub path: String, pub id: Option<String>, pub title: String, pub r#type: String,  // type key; "" untyped reads as page (D-103)
    pub modified: Option<String>, pub modified_ns: Option<i128>,
    pub tags: Vec<String>,                     // the object's other tag keys (all occurrences, deduplicated, without `key`)
    pub review: Option<String>, pub status: Option<String>, pub due: Option<String>, pub completed: Option<String>, // D-601 fields
}
```

### 1.4 `Core::tag_usage(key) -> TagUsage`

```rust
pub struct TagUsage { pub notes: usize, pub templates: usize, pub file: Option<String>, pub losers: Vec<String> }
```

`notes` = `count`; `templates` = files under `_templates/` with an occurrence (read from disk by the extractor, D-660; the only place the core reads template text for tags). Used by the rename and delete dialogs (`Updates 6 notes and 1 template`, the duplicate warning of D-664).

### 1.5 Search (D-652)

`SearchQuery.tags` already requires every listed key (all must match). No core change; Search's UI adds the filter (§6.4). The route parameter `search/tag:<x>` is no longer produced (FR-SRC-02 AC-12); an old one opens Search with that tag in the filter.

## 2. Names and Tag file bytes (`@tegg/doc` `tags.ts`, Rust twin in `tegg-format`)

```ts
/** D-642, D-658. Drops one leading `#`; NFC; then dialect §5 tag text. */
export function tagName(input: string):
  | { ok: true; name: string; key: string }
  | { ok: false; error: 'empty' | 'space' | 'digits' | 'char'; char?: string };   // `char`: the first refused character

/** D-641, R86. `now` is ISO 8601 with offset (the UI's clock, ms5-tasks §1). Ends with `---\n`. */
export function tagFile(f: { id: string; title: string; color?: string; now: string }): string;

/** D-653: sets or removes `color` and touches `modified` (only those lines change; FR-TAG-01 AC-4). */
export function setTagColor(text: string, color: string | null, now: string): string;
```

- `space` covers every Unicode white space (tab, NBSP); `digits` = only digits after `#`; `char` names the first character outside `[\p{L}\p{M}\p{N}_\-/]`. The same regexes as the micromark tag construct in `packages/doc/src/tag.ts` (one rule).
- `tegg_format::tag_name(input)` returns the same result (shared table test in `tests/fixtures/format/tags/names.json`, both sides).
- `setTagColor` uses `setValue` / `removeAttribute` and `touchModified` (packages/doc `edit.ts`); `null` removes the key. Same bytes in, same bytes out when the value is already that colour (the UI then writes nothing).

## 3. Commands that aren't jobs

| Command | Args | Returns | Notes |
| --- | --- | --- | --- |
| `index_tags` | — | `TagRowDto[]` | §1.2 (was `TagDto[]`; existing callers read `key`, `name` as spelling, `count`). |
| `tag_objects` | `key` | `TagObjectRowDto[]` | §1.3. Unknown key → `[]` (D-666). |
| `tag_usage` | `key` | `TagUsageDto` | §1.4. |
| `tag_new_path` | `name` | `{ path: string }` | `<Tag folder>/<free_stem(sanitize(name))>.md` (D-51, D-52, ms4-links §3.1; the Tag type's folder, D-665). |
| `note_create_exact` | (exists) | | `New tag` and a colour for a virtual tag write `tagFile(...)` bytes here, create-exclusive; `NameTaken` → the UI re-reads `index_tags`: the key now exists → open it (FR-TAG-03 AC-4), else ask `tag_new_path` again. |
| `note_read` / `note_write` | (exist) | | A colour change on a real tag: `note_read(file)`; if its version isn't `same_content` as `TagRowDto.file.version` → `tag.changedOutside`, no write (FR-TAG-05 AC-5); else `note_write(path, setTagColor(...), base)`. |
| `capture_context` | (exists) | `tags: CaptureTagDto[]` | was `string[]`; `{ name, color }` per tag with count ≥ 1 or a Tag file, nothing else (D-655, FR-TAG-05 AC-8). |

```ts
type TagRowDto = { key: string; name: string; file: { path: string; version: VersionDto } | null; losers: string[];
  color: string | null; colorRaw: string | null; count: number; lastUsed: string | null; lastUsedNs: string | null };   // ns as decimal string
type TagObjectRowDto = { path: string; id: string | null; title: string; type: string; modified: string | null; modifiedNs: string | null;
  tags: string[]; review: string | null; status: string | null; due: string | null; completed: string | null };
type TagUsageDto = { notes: number; templates: number; file: string | null; losers: string[] };
type CaptureTagDto = { name: string; color: string | null };
```

**Events.** `vault:changed` as today; the UI re-reads `index_tags` (debounced 200 ms) and the open tag page's `tag_objects` on it (FR-TAG-02 AC-3, FR-TAG-06 AC-9).

## 4. Jobs (`tegg-jobs`)

### 4.1 Ops and planners

`JobOp::TagRename { from, to }`, `JobOp::TagDelete { tag, keep_text: false }` and `JobOp::Merge { keep, others }` get planners (ms4-jobs §2.1 shapes). `keep_text: true` is unused: `Delete only the tag` is `object_trash` (ms6-trash-media §1.4). New kind `restore` (§5.3).

| Kind | `needsConfirm` | `backup` | Undoable | Label (§5.1) |
| --- | --- | --- | --- | --- |
| `tag-rename` | yes | yes | no (D-395) | `backups.label.tagRename` `{from, to}` |
| `tag-delete` | yes | yes | no | `backups.label.tagDelete` `{tag, count}` |
| `merge` | yes | yes | no (D-290) | `backups.label.merge` `{count, title}` |
| `restore` | no (the UI's dialog confirms) | yes (`Before restoring`) | no | `backups.label.restore` `{time}` |

- **Start-time refusals** (synchronous, before queueing; the dialog shows them under its field): `JobError::InvalidName { error, char }` (§2), `JobError::TagExists { name }` when `tag_key(to)` is another existing key (count ≥ 1 or a Tag file, D-645), `JobError::NotFound` for an unknown `from`/`tag`. A rename whose `to` equals the current display name exactly starts no job and returns `{ jobId: null }` (FR-TAG-04 AC-5).
- **Tag rename plan:** files = every indexed object with an occurrence of `from`, every `_templates/` file with one (D-660), and the winning Tag file. Ops per object: `RenameTag { key, to }`; the Tag file gets `SetTitle { title: to, now }` (touches its `modified`, D-659) and is renamed to `free_stem(Tag folder, sanitize(to))` with its own stem treated as free (case-only rename as ms4-jobs §3). Files linking to the Tag file get `RetargetLinks` from the old to the new path (D-660), planned exactly as a note rename (ms4-jobs §2.1), in the same job. Losers are untouched (D-664). `.trash/` is never planned.
- **Tag delete plan:** the same object and template files with `RemoveTag { key }`; the winning Tag file in `trashes` (moved to `.trash/<path>` with its bytes unchanged). Links to the Tag file are left (they become trashed links, D-615).
- **Merge plan (D-673):** `keep` gets `MergeInto { others: [{ path, title, text }], now }` with the others' current text, in the group's order (created ascending); every file linking to an `other` gets `RetargetLinks` to `keep`; the others go to `trashes`. The kept and merged files are read and version-checked first, before any write; a change to any of them stops the job `failed` with `error: "changed:<path>"` and nothing written (FR-LNK-14 AC-13).
- The plan carries `warnings: Vec<PlanWarning>`; `PlanWarning::DuplicateTagFile { path }` per loser (D-664).

### 4.2 Text ops (`@tegg/doc` `transform`; ms4-jobs §2.2)

```ts
| { op: 'rename-tag'; key: string; to: string }          // D-645, D-659: no `modified` change
| { op: 'remove-tag'; key: string }                      // D-644, D-661, D-662
| { op: 'merge-into'; others: { path: string; title: string; text: string }[]; now: string }   // D-290, D-673
| { op: 'replace'; text: string }                        // restore through an open editor (§5.3)
```

- **Occurrences** are exactly what the extractor counts (dialect §5, D-64): `tags:` entries (flow and block lists, a scalar `tags: x`) and body tags; never inside code, math, links, URLs, HTML or other frontmatter values. A key matches by `tag_key` (NFC, lower case), so NFD and case variants match; `#účty/archiv` and `#účty-2026` are other keys.
- **`rename-tag`:** each matching occurrence's name bytes become `to` (NFC); the `#`, the list style, quoting (`formatScalar` when the new value needs quotes), CRLF and every other byte are kept. Duplicates aren't merged (D-663).
- **`remove-tag`:** a list entry is removed with its separator (`, ` in flow lists, the whole `- x` line in block lists); a `tags:` key left with no entry is removed with its line(s) (D-661). A body tag is removed with the following space, else the preceding one (D-662); a line holding only tags and white space after the removal is removed with its line break; nothing else changes. No `modified` change (D-659).
- **`merge-into`:** appends to the kept body, per other with a non-empty body, `\n\n## <title> (merged)\n\n<body>` (the kept text's line ending style; one final newline kept as the kept file had it); adds each attribute the kept object lacks (in the other's key order, after the kept keys, before `tags`… universal keys by D-470's order); `tags` and `aliases` become unions by key, kept order first, and each other's title is added to `aliases` when it differs by more than case; conflicting values keep the kept object's (listed by the dialog from the plan); touches `modified` with `now`.
- Rust twin: none (Rust never edits Markdown, architecture §3); L4 uses `NodeTransformer` (ms4-jobs §2.2).

### 4.3 Host additions (`tegg_jobs::Host`, implemented in `tegg-core` `jobs4c.rs`)

```rust
fn template_paths(&self) -> Vec<String>;                              // `_templates/**/*.md`
fn trash(&self, path: &str, base: &FileVersion) -> Result<String, WriteError>;   // ms6-trash-media §1.4 rename into `.trash/`; returns the new path
fn untrash(&self, trashed: &str, to: &str) -> Result<(), WriteError>;            // restore (§5.3); NameTaken when `to` exists
fn create(&self, path: &str, bytes: &[u8]) -> Result<FileVersion, WriteError>;   // create-exclusive (restore of a file the job renamed away)
fn tag_folder(&self) -> String;                                        // the Tag type's folder (D-665)
```

### 4.4 IPC

| Command | Args | Returns | Notes |
| --- | --- | --- | --- |
| `tag_rename` | `from` (key), `to` (as typed) | `{ jobId: number \| null }` | §4.1; errors `InvalidName { error, char }`, `TagExists { name }`, `NotFound`. |
| `tag_delete` | `key` | `{ jobId }` | `Remove from…`. |
| `merge_start` | `keep`, `others: string[]` | `{ jobId }` | Errors `NotFound` (a path isn't in one same-title group, D-290). |
| `job_plan` | `jobId` | `JobPlanDto \| null` | New: the plan once the job is in `confirm` (counts, warnings, merge conflicts). |
| `job_confirm` | (exists) | | The dialog's `Rename` / `Remove from…` / `Merge` click: the UI starts the job, waits for `confirm`, then confirms (one click, FR-TAG-04 AC-7). |

```ts
type JobPlanDto = { jobId: number; kind: JobKind; files: number; templates: number; renames: { from: string; to: string }[];
  trashes: string[]; warnings: { kind: 'duplicateTagFile'; path: string }[];
  conflicts: { key: string; kept: string; others: string[] }[] };   // merge only
type JobKind = 'note-rename' | 'tag-rename' | 'tag-delete' | 'merge' | 'restore' | 'test-backup';
```

- Progress, skips, `job_retry` and the not-updated list as ms4-jobs §4, §5 for every kind (D-672). Retry re-applies the row's own op to the current bytes. The list's status entry becomes `job.notUpdated.count` `{count} notes not updated` for every kind (the 4C text `links not updated` is retired; rename.md FR-LNK-03 AC-16 changes under D-675).
- **Open notes** (D-386): an object open in an editor is rewritten through `job:transform` with `live: true`, as today.

## 5. Backups (D-57, D-396, D-670, D-671)

### 5.1 The manifest

Every zip's first entry is `tegg-backup.json` (UTF-8 JSON, not a vault file):

```json
{ "version": 1, "kind": "tag-rename", "label": { "key": "backups.label.tagRename", "args": { "from": "Účty", "to": "Výdaje" } },
  "vault": "<vault name>", "time": "2026-10-22T08:00:00Z", "job": 17,
  "planned": { "renames": [["Tags/Účty.md", "Tags/Výdaje.md"]], "creates": [], "trashes": [] },
  "done": null }
```

- Written with the zip before the first vault write (ms4-jobs §6). When the job reaches a final phase, the zip is rewritten atomically with `done` = `{ "renames": [[from, to, sha256]], "creates": [[path, sha256]], "trashes": [[from, to]], "written": [[path, sha256]] }` (the actual outcome, with the hash of each file as written). A crash before that leaves `done: null`; restore then uses `planned`.
- Zips without a manifest (4C `test-backup`, older builds) are listed with the label `backups.label.unknown` `{kind}` and restore without the reversal step.

### 5.2 Listing (`backups_list`)

```ts
type BackupDto = { name: string; kind: string; time: string;             // (exists) ISO 8601 with offset
  label: { key: string; args: Record<string, string | number> }; files: number };
```

Newest first, the open vault's folder only. `backup_reveal(name)` selects the zip in Finder (`NSWorkspace activateFileViewerSelectingURLs`; `TEGG_TEST_REVEAL` records `reveal <path>`, ms6-trash-media §9.1).

### 5.3 Restore (`backup_restore(name) -> { jobId }`, kind `restore`)

1. Backup of the current state (kind `restore`, label `{time}` of the zip being restored). That zip is exempt from this rotation (D-671); the rotation then keeps 10 others.
2. **Reverse the job** using `done` (else `planned`): each rename `(from, to)` whose `to` still has the hash the job wrote and whose `from` is free → renamed back to `from` with the zipped bytes of `from`; each create still at its written hash → moved to `.trash/`; each trash move `(from, to)` → moved back from `to` when `from` is free. Anything that no longer matches is skipped `changed` and listed.
3. **Every other zip entry** (`.md` and `.tegg/` files) whose current bytes differ from the zipped bytes is written with the zipped bytes (base-checked; created when missing; atomic, FR-SYN-02); equal files are untouched (FR-SYN-06). Files not in the zip and not in the manifest are untouched (FR-HIS-04 AC-9).
4. A file open in an editor is restored through it (`replace` op, `live: true`) after the editor's pending save has landed, so step 1 already holds the user's edit.
5. Final status `backups.restored` `{count}` (files written or moved).

## 6. App UI (`app/ui/src/tags/`)

### 6.1 Routes and state

- Routes `tags` (`AllTagsPage.tsx`), `tag/<key>` (`TagPage.tsx`; the parameter is `encodeURIComponent(key)`, so `a/b` is `tag/a%2Fb`, R87), `settings/backups` (`pages/BackupsPage.tsx`). `note/<path>` of a Tag file (FR-TYP-13 type `tag`) is replaced by `tag/<key>` before rendering (D-638); so are switcher, search, link and `type/tag` openings of Tag files.
- `openTag(key)` in `App.tsx` pushes `tag/<key>` (was `tags`).
- `UiStateDto` gains `tagPage: { sort: { column: 'title' | 'type' | 'otherTags' | 'modified'; dir: 'asc' | 'desc' }; type: string | null; grouping: 'none' | 'type' }` and `tagsSort: { column: 'count' | 'name' | 'lastUsed'; dir: 'asc' | 'desc' }`; missing reads as `Modified ↓`, all types, no grouping, `Most used ↓` (D-649).

### 6.2 Modules

| Module | Exports |
| --- | --- |
| `tags/model.ts` | `allTagsRows(rows, sort, find, collator)`, `sidebarTags(rows, collator)` (count ≥ 1, `lastUsedNs` desc, then D-122 name; first 5), `tagPageRows(rows, ui, filter, typeNames, collator)` → `{ groups: { type: string \| null; rows }[] }`, `summary(rows)` → `{ objects, types }` (unfiltered, D-668 (c)), `typeOptions(rows, typeNames, collator)` |
| `tags/chip.ts` | `tagChipStyle(color: string \| null)` → `{ background: var(--type-<c>-bg), color: var(--type-<c>) }` or the neutral chip (`--hover` / `--muted`), the one function every surface uses (D-655) |
| `tags/AllTagsPage.tsx`, `tags/TagPage.tsx`, `tags/SidebarTags.tsx` | R81, R82, R83 |
| `tags/NewTagDialog.tsx`, `tags/RenameTagDialog.tsx`, `tags/DeleteTagDialog.tsx`, `tags/ColourPopover.tsx` | R84 |
| `links/MergeDialog.tsx` | FR-LNK-14 AC-11 (from `job_plan` conflicts) |
| `pages/BackupsPage.tsx` | R85 |

- `New with #tag` (D-643, D-668 (d), (e)): the type menu lists the capture targets (Page, Task, Quick Note, user types); a type opens `new/<type>` with `tags: [<name>]` preset through `newObject` (D-470 key order); Task opens the Tasks quick-add with ` #<name>` at the end and the caret before it.
- Colour on every surface goes through `tagChipStyle` with the colour from `index_tags` (a `useTags()` store shared by the editor's tag mark, the read view, chips, cards, the sidebar and autocomplete). The editor's inline tag mark gets the style through a CSS custom property set per key (`data-tag-key`), so recolouring needs no editor transaction.

### 6.3 Commands (FR-UX-03, R87)

`tags.go` (`Go to Tags`), `tags.new` (`New tag…`), `settings.backups` (`Go to Settings: Backups`), and on `tag/<key>`: `tag.rename`, `tag.delete`, `tag.colour` (`Change tag colour…`), `tag.newWith` (`New with tag…`), `tag.groupType`, `tag.groupNone`; on `duplicate-titles`: `duplicates.merge`. No new shortcut.

### 6.4 Search (D-652)

`Search.tsx` uses `tasks/TagFilter.tsx` (D-518) with the options `index_tags` rows with count ≥ 1, most used first then D-122; selected keys go to `search({ tags })`. Activating a `#tag` chip inside a Search result adds it to the filter; anywhere else it calls `openTag`.

## 7. Strings

R88's keys go into `app/ui/src/i18n/catalog.ts`; plural keys use the existing `{count}` plural rule (D-133). `backups.label.tagRename` `Rename #{from} to #{to}`, `backups.label.tagDelete` `Remove #{tag} from {count} objects`, `backups.label.merge` `Merge {count} objects into "{title}"`, `backups.label.restore` `Before restoring {time}`, `backups.label.unknown` `Backup ({kind})`; `tag.duplicateWarning` `Another Tag file for #{tag} exists: {path}. Merge them on Duplicate titles first.`; `tag.unknownColour` `Unknown colour "{value}"`; `tag.renameTemplates` `Updates {count} notes and {templates} templates. A backup is made first.` (plural forms each).

## 8. Test environment, fake core and layout

### 8.1 Fake core additions (ms3-shell §5)

- `index_tags`, `tag_objects`, `tag_usage`, `tag_new_path` from the in-memory files through a TS twin `app/ui/test/fake-tags.ts` of §1 (using `@tegg/doc` `extract`); L1 checks it against R80 (FR-TAG-01 AC-1's L1 part).
- `tag_rename`, `tag_delete`, `merge_start`, `backup_restore`, `job_plan` over the in-memory files with the real `@tegg/doc` `transform` (ms4-jobs §11), `holdJob` and `skipOnWrite` included; zips are kept in memory (`handle.backups()` returns `{ name, manifest, entries }`); `backups_list` from them; `FakeOptions.backups` seeds listed zips.
- `capture_context` returns `CaptureTagDto[]`.

### 8.2 Test layout

| Layer | Files |
| --- | --- |
| L1 | `packages/doc/test/tags.ac.test.ts` (§2 `tagName` table, `tagFile` R86 bytes, `setTagColor`; FR-TAG-03 AC-1, AC-3, FR-TAG-05 AC-2, AC-3 bytes), `packages/doc/test/tag_ops.ac.test.ts` (`rename-tag`, `remove-tag`, `merge-into` table tests: FR-TAG-04 AC-4, FR-TAG-08 AC-2, FR-LNK-14 AC-12), `app/test/tags_model.ac.test.ts` (§6.2 comparators, sidebar, groups; **(C)**), `app/test/catalog_4d.ac.test.ts` (R88), `app/test/registry_4d.ac.test.ts` (R87), `app/test/tag_contrast.ac.test.ts` (FR-TAG-05 AC-7 tokens) |
| L2 | `packages/doc/test/tag_ops.property.ac.test.ts` (FR-TAG-04 AC-11 (b), (d) and FR-TAG-08 AC-6 on text), `crates/tegg-jobs/tests/ac_property_tags.rs` (FR-TAG-04 AC-11, FR-TAG-08 AC-6 end to end with `NodeTransformer` and an in-memory `VaultFs`) |
| L4 | `crates/tegg-core/tests/ac_tags.rs` (FR-TAG-01 AC-1, AC-4, FR-TAG-02 AC-1…AC-3, FR-TAG-07 AC-4 ordering, AC-5, FR-TAG-10 AC-1, FR-FMT-07 AC-23, FR-SYN-06 AC-32), `crates/tegg-jobs/tests/ac_tag_jobs.rs` (FR-TAG-04 AC-4…AC-9, FR-TAG-08 AC-2…AC-5), `ac_merge.rs` (FR-LNK-14 AC-12…AC-14), `ac_restore.rs` (FR-HIS-04 AC-7…AC-10, §5.1 manifest), `ac_sync_tags.rs` (sync simulator at the job points); `tests/fixtures/format/tags/names.json` shared with L1 |
| L5 | `app/webkit/tags_all.ac.test.ts` (FR-TAG-07 AC-1…AC-4), `tag_page.ac.test.ts` (FR-TAG-06 AC-1…AC-10), `tag_dialogs.ac.test.ts` (FR-TAG-03, FR-TAG-04 AC-6…AC-9, FR-TAG-08 AC-1, AC-3), `tag_colour.ac.test.ts` (FR-TAG-05 AC-1…AC-6), `search_tags.ac.test.ts` (FR-SRC-02 AC-10…AC-12), `autocomplete_tags.ac.test.ts` (FR-EDT-15 AC-5, AC-6), `backups.ac.test.ts` (FR-HIS-04 AC-7, AC-8), `merge.ac.test.ts` (FR-LNK-14 AC-11), `sidebar_4d.ac.test.ts` (FR-NAV-04 AC-8), with `app/webkit/tags-helpers.ts` |
| L6 | `app/e2e/ms4_tags.ac.test.ts` (every L6-marked AC: FR-TAG-02 AC-2, FR-TAG-03 AC-1, FR-TAG-05 AC-1, AC-6 capture window, FR-TAG-06 AC-6 relaunch, AC-8, FR-TAG-07 AC-1 relaunch, FR-HIS-04 AC-8, FR-LNK-14 AC-12, FR-NAV-04 AC-8, FR-SYN-06 AC-31, AC-32), `app/e2e/nightly_tag_crash.ac.test.ts` (FR-TAG-04 AC-10), `app/e2e/perf_tag_page.ts` (FR-TAG-06 AC-11, report-only) |

**Fixture.** `tests/fixtures/vaults/tags/` is written from its `README.md` (drafted by the test author from tags.md's tables) in its own commit with a `Fixture-Change:` trailer, before the red tests; NFD and CRLF files byte-exact.

**`qa.config.json`:** the new test files belong to the existing steps (`packages/doc`, `app`, `crates/tegg-core`, `crates/tegg-jobs`, webkit, e2e); the shared `names.json` is an input of both the doc and the format steps (D-611).

## 9. Contract choices (no owner decision needed)

1. **Colour and `New tag` are UI writes**, not core commands: Rust never edits Markdown (architecture §3), and the attribute panel already writes frontmatter this way with a base version, so FR-TAG-05 AC-5's conflict rule is the existing `note_write` conflict.
2. **The winner and the colour come from the index**, so the tag list costs one query and an index rebuild gives the same tags (AR-01).
3. **The manifest is rewritten after the job** because a job's real renames (a taken stem gets ` (2)`) are known only then; `planned` is the fallback after a crash. The zip stays the single backup file (D-670).
4. **Restore reverses by hash**: a renamed or created file is reversed only while it still has the bytes the job wrote, so newer work is never moved or overwritten without being in the pre-restore zip (NFR-REL-02).
5. **`job_plan` is new and generic**, so the merge dialog's conflict list and the duplicate warning come from the planner, not a second computation in the UI.
6. **Templates are read from disk only for tag jobs and `tag_usage`**; they stay out of the index (D-647), so counts and pages never see them.

## 10. Owner decisions on this contract (D-676…D-678, BRD v1.83)

1. **D-676 (AP-605):** after a `tag-rename` job the UI replaces the old key with the new one in `UiStateDto` Tasks tag selection (D-481); after `tag-delete` it removes the key. Written once, machine-local; nothing in the vault.
2. **D-677 (AP-606):** `job.notUpdated.count` is `{count} notes not updated` for every kind (§4.4); rename.md FR-LNK-03 AC-16's test changes with `AC-Test-Change`.
3. **D-678 (AP-607):** `Delete only the tag` shows the D-620 toast (`Moved to trash`, `Undo`); Undo is `trash_restore` of the Tag file.

## 11. Red-test decisions (D-679…D-686, BRD v1.84)

1. **D-679:** `JobOp::Restore { name }`, `JobKind::Restore`; `Core::backups() -> Vec<BackupInfo { name, kind, time, label: BackupLabel { key, args }, files }>` behind `backups_list` (§5.2).
2. **D-680:** `merge-into` adds missing attributes (`aliases` included) in the other's key order after the kept keys, before `tags`, then `review`, `created`, `modified` (§4.2).
3. **D-681:** the §6.2 `tags/model.ts` shapes: `allTagsRows` and `sidebarTags` → row arrays; `tagPageRows` → `{ groups: { type: string | null; rows }[] }` (one `type: null` group when not grouped); `summary` → `{ objects, types }`; `typeOptions` → `{ type, name?, count }[]`; `typeNames: Record<key, name>`; `collator: Intl.Collator`.
4. **D-682:** `tag/` + `encodeURIComponent(key)` everywhere, `route-ready:` included; test-build mark `tag-rows:<n>`.
5. **D-683:** the list `Notes not updated`, the command `job.showNotUpdated` labelled `Show notes not updated`.
6. **D-684:** `JobError::NothingToDo` from `Jobs::start` for a same-spelling tag rename; IPC `{ jobId: null }`.
7. **D-685:** FR-TAG-05 AC-6 at L6 by element-screenshot pixels against the light tokens.
8. **D-686:** FR-TAG-04 AC-7's dialog text includes the template (`tag.renameTemplates`).

## 12. Points found while building (AP-616 onwards, pending the owner)

Each is a red test that can't pass as written; the build follows the ACs and the contract, and the test needs an
`AC-Test-Change` approved by the owner (or the fake core a fix, which is test code).

| # | Test | Problem | Recommendation |
| --- | --- | --- | --- |
| AP-616 | `crates/tegg-jobs/tests/ac_restore.rs` `fr_his_04_ac8_failed_pre_restore_zip_restores_nothing` | Makes `backups/` read-only after a job already created `backups/<vault>/`, which stays writable (Unix permissions), so the pre-restore zip succeeds. | Make `backups/<vault>/` read-only too (the helper `read_only_backups` takes the vault's folder). |
| AP-617 | `app/webkit/tag_page.ac.test.ts` `fr_syn_06_ac31_browsing_tags_sends_no_write_command` | Reads `vaultWrites(c2)` after `p2.close()`, so it always throws. | Read `c2`'s calls before closing `p2`. |
| AP-618 | `app/webkit/tag_dialogs.ac.test.ts` `fr_tag_08_ac3_delete_only_the_tag` | Looks for a status with the text `Moved to trash`; the D-620 toast reads `Moved "<title>" to the trash` (`trash.moved`). | Match `Moved "Účty" to the trash`. |
| AP-619 | `app/webkit/backups.ac.test.ts` `fr_his_04_ac7_jobs_list_their_zips_with_labels`, `fr_his_04_ac8_restore_dialog_and_restore` | The fake core names two zips of the same (fixed) second by time and kind only, so "newest first" is the kind's name order; the core moves a later zip to the next free second. | The fake core takes the next free second as the core does. |
| AP-620 | `app/webkit/duplicates.ac.test.ts` `fr_lnk_14_ac9_merge_is_enabled_and_opens_its_dialog` vs `app/webkit/merge.ac.test.ts` `fr_lnk_14_ac11_…` | The first counts every non-read command (`merge_start`, `job_plan`, `job_cancel`) as a write; the second requires the dialog to read `job_plan` (so a job must start when it opens). | The first excludes `merge_start`, `job_plan`, `job_cancel` (as `merge.ac` excludes `merge_start`); they write nothing. |
| AP-621 | `app/webkit/search_tags.ac.test.ts` `fr_src_02_ac11_all_selected_tags_must_match` | The fake core's `index_search` returns nothing without text and ignores `tags`; the core answers a tag-only query (`SearchQuery::has_filters`). | The fake core applies `tags` (all must match) and answers a filter-only query. |
| AP-622 | Older tests whose expectations approved decisions overturn, outside D-675's list: `rename.ac` FR-LNK-03 AC-15 (two), AC-16 (the list is `Notes not updated`, D-683); `type_chip_link.ac` FR-TYP-07 AC-11, AC-12 (`Tags/čajovna.md` opens its tag page, D-638); `read_view.ac` FR-EDT-02 AC-13, FR-SYN-06 AC-6 and `attribute_panel.ac` FR-TYP-02 AC-4 (`index_tags` and `tag_objects` are reads: the sidebar's tags and the tag page, D-646, D-649); `keyboard.ac` FR-UX-03 AC-1, AC-8, AC-9 and `i18n.ac` NFR-OTH-02 AC-3 for `tag/<key>` (the route table has no way in to a parameter route). | Update them to the decisions with `AC-Test-Change: …; approved-by: owner` (test-author): the new list name, the tag page for Tag files, `index_tags`/`tag_objects` in the read sets, and `tag/účty` as `tag/<key>`'s example parameter. |
