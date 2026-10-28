# Acceptance Criteria: Type moves and schema rewrites (slice 4E, MVP, MS7 row)

See [README](README.md) for conventions. Slice **4E** (D-803; plan [docs/plans/4e-type-moves-and-schema-rewrites.md](../plans/4e-type-moves-and-schema-rewrites.md); board `design/edit-note-page/TypeJobs.dc.html`, sections A–G). A type change maps the object's properties and moves the file to the new type's folder (D-804); objects move to their type's folder when the folder changes and by a tidy job (D-805); deleting a property removes its values (D-807); deleting a type trashes its objects (D-809). Keys are never renamed (D-806) and a retype only widens (D-808). Every multi-file change is a `tegg-jobs` job (`docs/contracts/ms4-jobs.md` §14): plan, confirm, backup zip, write, report, Undo.

**Status: approved, 2026-10-27.** Written from D-803…D-809 and the board. The points those decisions left open, AP-765…AP-773 (end of this file), were accepted by the owner as proposed: D-810…D-818 (BRD v1.103). A criterion that names an AP follows that decision. Red-test decisions: D-819…D-833 (BRD v1.104; contract ms4-jobs §14).

**Scope.** Part one (4E-1, moves): FR-STO-04, FR-TYP-07 (D-804 mapping and file move), FR-INB-02's convert (D-803), data-safety FR-STO-01/-03/… AC-7 (D-805 folder move and tidy job), Undo of 4E jobs. Part two (4E-2, deletes): FR-TYP-04 delete property (D-807), FR-TYP-05 delete type (D-809, types.md AC-4), restoring an object of a deleted type. Both parts: FR-HIS-04 / NFR-REL-04, FR-UX-07, FR-UX-03, NFR-OTH-02, FR-UX-05, the 4E parts of FR-FMT-07 and FR-SYN-06. The D-808 widen-only `Type` menu is a type-settings change without a job; it is built in 4E-2 and verified by types.md FR-TYP-03 AC-11 as amended by D-808 (AC-14 below). **Out of scope:** key rename (W, D-806); value conversion (D-808); renaming used options (AP-771); bulk type change from a type page selection (FR-QRY, v1.0); moving attachments or Daily Notes (D-551); version history (FR-HIS-03).

**Existing criteria this slice verifies** (not repeated here): links.md FR-STO-04 / FR-TYP-07 AC-1 (as amended by AP-772), AC-2; data-safety FR-STO-01/-03/… AC-6 (non-Markdown files never moved), AC-7 (D-805 wording); types.md FR-TYP-05 AC-4 (D-809 wording), FR-TYP-04 AC-4 and FR-TYP-03 AC-4, AC-11 in their D-806…D-808 form; rename.md FR-HIS-04 AC-5; tags.md FR-HIS-04 AC-8, AC-9 (restore); trash-media.md FR-HIS-01 (trash and restore).

**Test layers** as in [tags.md](tags.md):

| Tag | Layer |
| --- | --- |
| L1 | Vitest: UI modules and React components in a DOM environment; the new `@tegg/doc` ops (`map-properties`, `remove-key`, `keep-targets`) through the real `@tegg/doc` (never mocked) |
| L2 | Property test (proptest / fast-check): fixed seed plus one random seed per push, 10 × 1,000 runs nightly (TS-L2) |
| L4 | Rust: `tegg-jobs` planners (`type-move`, `folder-move`, `value-remove`, `type-delete`) and their undo on a temporary copy of the fixture on APFS; the transform is the real `@tegg/doc` through `NodeTransformer` (ms4-jobs §2.2); the sync simulator injects external writes at the job points (ms4-jobs §5.1); the watcher's quiet period is injected; clock, time zone and region injected |
| L5 | Playwright on WebKit with the fake core over mocked IPC (real `@tegg/doc`; ms4-jobs §11 job controls; records every call with its path) |
| L6 | Appium `mac2` on the built app with `TEGG_TEST=1`, a temporary Application Support and a temporary copy of the fixture; vault checks by bytes, mtime and inode. Every AC whose layer names L6 has an `app/e2e/` test in the red-test commit (D-382) |
| manual | Owner or explorer session, recorded in `qa/manual/` or `qa/sessions/` |

**Test clock** (L4, L5, L6 with `TEGG_TEST=1`): `2026-10-27T10:00:00+01:00` (a Tuesday, CET), Europe/Prague, region `cs`. The tidy job's quiet period (AP-766) is 30 s; tests inject it.

**Fixture:** `tests/fixtures/vaults/type-moves/` (synthetic, D-50; written byte-exact in its own commit from its `README.md`, which the test author drafts from these tables and maps to the criteria) plus `tests/fixtures/vaults/new-empty/.tegg/` copied in. Ids `01JB4E0000000000000000E0nn`. Key order of every object: `id, type, title, <attributes>, tags, review, created, modified` (keys it lacks left out); `created: 2026-09-01T09:00:00+02:00`, `modified: 2026-10-01T09:00:00+02:00` unless given. "NFD" means the bytes are written decomposed.

Type files (besides the seven system types):

| Type (key) | Plural, folder | Properties in schema order (key: type) | Other |
| --- | --- | --- | --- |
| Kniha (`kniha`) | Knihy, `Knihy` | `autor` Autor: Text; `vydáno` Vydáno: Date; `stav` Stav: Select Rozečtená / Dočtená; `hodnocení` Hodnocení: Number; `související` Související: Relation to `kniha`, multiple; `poznámka` Poznámka: Text; `isbn` ISBN: Text (no object has a value) | preview `[autor, stav]`; templates `_templates/Kniha/Kniha.md` and `_templates/Kniha/Recenze.md` |
| Schůzka (`schůzka`) | Schůzky, `Schůzky` | `datum` Datum: Date; `stav` Stav: Select Plánovaná / Proběhla; `místo` Místo: Text; `účastníci` Účastníci: Relation to `osoba`, multiple | template `_templates/Schůzka/Schůzka.md` |
| Osoba (`osoba`) | Osoby, `Osoby` | `e-mail` E-mail: Email | — |

Objects:

| Short | Path | Type | What it holds |
| --- | --- | --- | --- |
| Duna | `Knihy/Duna.md` | kniha | `autor: Frank Herbert`, `vydáno: 1965-08-01`, `stav: Dočtená`, `hodnocení: 5`, `související: ["[[Babička]]"]`, `poznámka: Půjčená od Petra` with a full-line comment `# od koho` above it, `nálada: dobrá` (not in the schema), `tags: [čtení]`; body `Skvělá kniha.` / `## Dojmy` / `Písek.` |
| Babička | `Knihy/Babička.md` | kniha | `autor: 'Božena Němcová'`, `stav: Rozečtená`; **CRLF** line endings, no final newline; no `poznámka` |
| Starý zápis | `Knihy/2025/Starý zápis.md` | kniha | in a subfolder of the type's folder; `autor: Neznámý` |
| Bez autora | `Knihy/Bez autora.md` | kniha | `autor:` empty, `poznámka:` empty |
| Kniha jinde | `Pages/Kniha jinde.md` | kniha | outside its type's folder (a stray for the tidy job); `autor: Karel Čapek` |
| Sešit (K) | `Knihy/Sešit.md` | kniha | no properties |
| Článek | `Pages/Článek.md` | page | `autor: Někdo`, `poznámka: cizí` (same keys, other type: never touched by Kniha jobs) |
| Plán | `Quick Notes/Plán.md` | quick-note, `review: unreviewed` | body `Viz [[Plán cesty]].` / `[Rozpis](<Plán cesty.md>)` / `[[Duna]]` / `## Cíl` / `Dojet do Brna.` |
| Plán cesty (QN) | `Quick Notes/Plán cesty.md` | quick-note | body `Trasa A.` (same stem as the next row, as Obsidian allows) |
| Plán cesty (P) | `Pages/Plán cesty.md` | page | body `Trasa B.` |
| Sešit (QN) | `Quick Notes/Sešit.md` | quick-note | same stem as Sešit (K) in Kniha's folder |
| Odkaz na sešit | `Quick Notes/Odkaz na sešit.md` | quick-note | `[[Sešit]]` (resolves to Sešit (QN), same folder first, D-291) |
| Odkazy | `Pages/Odkazy.md` | page | `[[Plán]]`, `[[Plán#Cíl]]`, `[[Plán\|můj plán]]`, `![[Plán]]`, `[[Quick Notes/Plán]]`, `[text](../Quick%20Notes/Plán.md)`, `` `[[Quick Notes/Plán]]` `` (code span), `[[Porada]]`, `[[Retro]]`, `[[Duna]]`; frontmatter `viz: "[[Quick Notes/Plán]]"` |
| Porada | `Schůzky/Porada.md` | schůzka | `datum: 2026-10-20`, `místo: Brno` |
| Retro | `Schůzky/Retro.md` | schůzka | body `[[Porada]]` |
| Schůzka jinde | `Pages/Schůzka jinde.md` | schůzka | a stray |
| Jana | `Osoby/Jana.md` | osoba | — |
| Volná | `Volné/Volná poznámka.md` | — | no frontmatter (Page by FR-TYP-10; never moved, AP-766) |
| Neznámý typ | `Volné/Recept.md` | `type: recept` | no definition (D-121; never moved, AP-766) |
| Nápad NFD | `Quick Notes/Nápad.md` | quick-note | file name and `title` in **NFD** |
| Docx | `Knihy/seznam.docx` | — | not Markdown (`PK\x03\x04` + 60 bytes); never moved |
| Výplň ×10 | `Pages/Výplň 01.md` … `Výplň 10.md` | page | no link to any object above (must stay untouched) |

**Created at runtime by the tests:** a Latin-1 (not UTF-8) copy of Babička; a reference vault from `tools/gen-vault` with a type of 500 objects and 500 linking notes for the progress, crash and benchmark criteria.

---

## Reference tables

### R99. Texts and controls (board `TypeJobs`)

| Where | Control (accessible name) | Text |
| --- | --- | --- |
| `Change type` dialog (A, D-804) | `combobox` `New type`; one `combobox` `<Name> maps to` per property (fixed ones disabled); `Cancel`, `Change type` | heading `Change type?`; group `Property mapping <Old> → <New>`; help `Properties mapped to Content are written at the top of the note as Property: value, one line each.` |
| Status after a type change (A) | `Undo` | `Now a <Type>` |
| Type settings › General, folder field while edited (B1, D-805) | `Folder in the vault` | `Saving moves <n> <plural> from <old>/ here (backup first; undo in the status strip).` |
| Status, moves (B2) | `Undo`, `Show` | `Moving <plural> · <done> of <n>`; `Moved <n> <plural> · updated links in <m> notes`; `Moved <n> <plural> and <k> <plural₂> to their folders` (tidy); `Moved <n> <plural> · <k> not moved (changed meanwhile, tried again later)` |
| `Key in frontmatter` (C, D-806) | read-only | `The key can't be changed after creation.` |
| `Delete property` dialog (D, D-807) | `Cancel` (default), `Delete from <n> notes` / `Delete property` | `Delete property "<Name>"?`; `Removes the <key> line from <n> <plural>; <m> have no value and are not touched.` (the clause after `;` only when m > 0, D-845); `A backup of the vault is made first (Settings › Backups). Undo restores the values and the property.`; with no values: `No <singular> has a value. Only the type definition changes.` |
| Status, delete property (D3) | `Cancel`, `Undo`, `Show` | `Deleting <Name> · <done> of <n>`; `Deleted <Name> · removed values from <n> notes`; with skips `… · <k> not changed (changed meanwhile)` with `Show` (the not-updated list with `Retry <title>`, D-844); notes left for an anchored entry `… · <k> left as written (a value other properties use)`, without `Retry` (D-858, D-859); a job that failed after writing and put everything back: alert `Couldn't delete <Name>. Nothing was changed.` (D-857, D-859) |
| `Type` menu of a property (E, D-808) | wider types only | footer `Only a more general type; values stay as written.` |
| `Delete type` dialog (F1, D-809) | `Cancel` (default), `Delete type and trash <n> <plural>` | `Delete type "<Name>"?`; `<n> <plural> go to the trash with the type, and the <k> <Name> templates. Notes that link to them show moved to trash.` (the templates clause only when k > 0, D-845); `A backup of the vault is made first (Settings › Backups). Undo brings the <plural> and the type back.` |
| Type settings › Delete type (F3) | `Delete <Name> type…` | `Deleting <Name> moves its <n> <plural> to the trash. To keep them, change their type first. A backup is made first.` |
| Status and route after delete type (F2) | `Cancel`, `Undo`, `Open Trash` | `Deleting <Name> · <done> of <n>`; `Deleted <Name> · <n> <plural> in the trash`; on `type-settings/<key>`: `This type no longer exists.` / `<Name> was deleted. Its <n> objects are in the trash.` |
| Settings › Backups labels (tags.md R85) | as today | `Change type of <n> objects to <Name>`, `Move <plural> to <folder>`, `Tidy folders`, `Delete property <Name>`, `Delete type <Name>` |

`<plural>` is the type's Name for a count of 1 and its plural name otherwise, in lower case (`1 kniha`, `6 knihy`; board: `1 meeting`, `10 ideas`); other counted words use D-133 plural forms (`1 note`, `7 notes`; `1 has no value`, `3 have no value`).

### R100. Commands (FR-UX-03; added to app-shell R4)

| Command | Section | Where it runs |
| --- | --- | --- |
| `Undo <operation>` (`Undo type change`, `Undo move`, `Undo delete property`, `Undo delete type`) | `edit` | the last undoable 4E job, while undoable (AP-767) |
| `Change type…` | as today | opens the dialog of R99 when the property sets differ, else changes at once (D-804) |

### R101. Default mapping (board A3, D-804, D-808)

| Case | Default | Offered in the menu |
| --- | --- | --- |
| Title, Tags, Description | the same (fixed) | — |
| Same key, same value type | that property (fixed) | — |
| Same key, wider target type | that property | Content and every other offered target |
| Same key, narrower target type, or a different key | Content | each target property of the same or a wider value type (Relation: same or wider allowed types) not already taken |
| No target | Content | — |
| Empty value | row shown greyed, nothing written | — |
| Every property has the same key and a same-or-wider type in the new type | no dialog: the type changes at once | — |

---

## Part one: moves (4E-1)

### FR-STO-04 / FR-TYP-07 Change type: map, move, keep links

- **AC-4** **No dialog when nothing needs mapping.** Plán (Quick Note, no schema properties) `Change type…` › Kniha changes at once: one `type-move` job, no confirmation, no zip (board G); `Quick Notes/Plán.md` becomes `Knihy/Plán.md` with `type: kniha` and a new `modified`, no Kniha property added (D-224: no defaults, no `review` change); the `id` is unchanged; the index sees one rename. The page stays open; its route is replaced with `note/Knihy/Plán.md` (no new history entry); the status says `Now a Kniha` with `Undo` for 5 s; no path or folder is shown (D-804). Within 2 s the sidebar counts show Quick Notes −1, Knihy +1. *(L4 bytes; L5; L6 once)*
- **AC-5** **The mapping dialog (R101).** Duna `Change type…` › Schůzka opens `Change type?` with `Property mapping Kniha → Schůzka`: Title and Tags fixed; `Stav maps to` Stav (same key, both Select; fixed); `Vydáno maps to` Content with `Datum` (Date → Date) and `Místo` (Date → Text widens) offered; `Autor maps to` Content with `Místo` offered (Text → Text); `Hodnocení maps to` Content with `Místo` offered (Number → Text widens); `Související maps to` Content with `Místo` offered (Relation → Text widens), `Účastníci` not offered (Relation to Osoba is narrower than to Kniha, D-808); `Poznámka maps to` Content with `Místo` offered; `ISBN` (empty) greyed; a target taken by one row is not offered in another. `Cancel` writes nothing. *(L5; L1 for R101)*
- **AC-6** **What the file looks like (board A2, AP-768).** Confirming AC-5 with Vydáno → Datum and the rest at their defaults writes `Schůzky/Duna.md`: frontmatter `id, type: schůzka, title, datum: 1965-08-01, stav: Dočtená, nálada: dobrá, tags: [čtení], created, modified` (the `vydáno` line renamed in place to `datum`; the Content properties' lines removed, `# od koho` with them; `nálada`, not in Kniha's schema, stays where it was); the body starts with `**Autor:** Frank Herbert` / `**Hodnocení:** 5` / `**Související:** [[Babička]]` / `**Poznámka:** Půjčená od Petra` (old schema order), one blank line, then the old body byte-identical. `stav: Dočtená` is kept as written although it isn't a Schůzka option (shown invalid, D-231). *(L4; L1)*
- **AC-7** **Incoming links keep resolving (AP-765).** After AC-4, Odkazy's `[[Plán]]`, `[[Plán#Cíl]]`, `[[Plán|můj plán]]`, `![[Plán]]` and the code span are byte-unchanged; `[[Quick Notes/Plán]]` becomes `[[Knihy/Plán]]`, `[text](../Quick%20Notes/Plán.md)` becomes `[text](../Knihy/Plán.md)`, `viz: "[[Quick Notes/Plán]]"` becomes `"[[Knihy/Plán]]"`; Odkazy is written once; the Výplň files keep bytes, mtime and inode. Plán's backlinks list Odkazy before and after. *(L4; L1)*
- **AC-8** **The moved note's own links keep their targets (AP-765).** In the moved Plán, `[[Plán cesty]]` (resolved to `Quick Notes/Plán cesty.md`, same folder first) becomes `[[Quick Notes/Plán cesty|Plán cesty]]`; `[Rozpis](<Plán cesty.md>)` becomes `[Rozpis](<../Quick Notes/Plán cesty.md>)`; `[[Duna]]` is unchanged. Every link in Plán resolves to the same file before and after (`link_resolve`). *(L4; L1)*
- **AC-9** **A taken name (verifies links.md FR-STO-04 AC-2).** Sešit (QN) › Kniha moves to `Knihy/Sešit (2).md` (`title: Sešit` unchanged, vault-wide free stem, D-291); Odkaz na sešit's `[[Sešit]]` becomes `[[Sešit (2)|Sešit]]` and resolves to the moved note; nothing tells the user about the suffix (D-804); Sešit (K) is not written. *(L4; L5)*
- **AC-10** **Every object goes to its new type's folder (D-804, AP-766).** Starý zápis (`Knihy/2025/`) › Osoba moves to `Osoby/Starý zápis.md`; Kniha jinde (`Pages/`) › Osoba moves to `Osoby/Kniha jinde.md`. A file in `_templates/` changing type writes only `type:` and never moves. *(L4; L5)*
- **AC-11** **Undo as one step (D-804, AP-767).** ⌘Z in the moved note right after AC-6 (before any other edit), the status `Undo` or the palette `Undo type change` restores `Knihy/Duna.md` with its exact pre-change bytes and every linking note's pre-change bytes; ⇧⌘Z re-applies it. A file changed since is not touched and is listed (ms4-jobs §7). *(L4; L5)*
- **AC-12** **Not movable.** The `Change type` rules of types.md FR-TYP-07 AC-12 stand (board G: Daily Note, Tag, Image, PDF are neither sources nor targets); the core refuses a `type-move` of those objects and of a file that is not UTF-8 (`NotMovable`), writing nothing. *(L4)*
- **AC-13** **NFD names (FR-FMT-12).** Nápad NFD › Kniha writes `Knihy/Nápad.md` with an NFC name; its `title` bytes are unchanged; links to it keep resolving. *(L4)*
- **AC-14** **Crash during a single move.** `SIGKILL` between the note's rename and Odkazy's rewrite: the next open shows the ms4-jobs §8 banner `Changing the type of "Plán" was interrupted: 0 of 1 links updated` with `Finish` and `Undo`; Finish rewrites Odkazy as AC-7, Undo moves the note back with its old bytes. Every file is its pre-job or post-job version (FR-SYN-02 AC-3). *(L4 with job points; L6 nightly)*

### FR-INB-02 Convert to type moves the file

- **AC-17** **Convert maps and moves (D-803, D-804).** In the Inbox, converting Plán to Kniha writes `type: kniha`, `review: reviewed` and `modified` and moves it by FR-STO-04 AC-4, AC-7, AC-8 (one job, undoable); the live region says `Converted "Plán" to Kniha`. A convert whose property sets differ opens the mapping dialog first. A bulk convert (inbox.md FR-INB-02 AC-14) shows one mapping for the type pair, applied to each item (AP-768), makes its zip first, then moves each item; its `Undo` restores every item. *(L4; L5)*

### FR-STO-01 / FR-STO-03 Objects move to their type's folder (D-805; details data-safety FR-STO-01/-03/… AC-7)

- **AC-8** **Saving a new folder moves the objects (B1).** On `type-settings/kniha`, typing `Četba` in `Folder in the vault` shows `Saving moves 6 knihy from Knihy/ here (backup first; undo in the status strip).` (Duna, Babička, Bez autora, Sešit (K), Starý zápis in `Knihy/2025/` and the stray Kniha jinde: every Kniha outside `Četba`); saving writes `folder: Četba`, creates the zip (`Move knihy to Četba`), then moves the six to `Četba/` (folder created; `Knihy/2025/Starý zápis.md` → `Četba/Starý zápis.md`), each with AC-7…AC-9's link rules, and reports `Moved 6 knihy` with `Undo` (no link needed a change; with link changes the text adds `· updated links in <m> notes`). `Knihy/seznam.docx` and the emptied folders stay (data-safety AC-6; folders are never removed). A moved file's only change is its links (no `modified`: its type didn't change). No confirmation dialog. *(L4; L5; L6 once)* *(D-824: at L5 and L6 the tidy job at open has already moved Kniha jinde into `Knihy/`; the count of 6 and `from Knihy/` hold either way.)*
- **AC-9** **The tidy job (AP-766).** On vault open, Kniha jinde and Schůzka jinde are moved to `Knihy/` and `Schůzky/` in one job after the zip (`Tidy folders`); the status says `Moved 1 kniha and 1 schůzka to their folders` with `Undo`. Never moved: Volná (no `type`, FR-TYP-10), Neznámý typ (no definition, D-121), files in `_templates/` and `.trash/`, files in a subfolder of their type's folder (Starý zápis stays in `Knihy/2025/`), non-Markdown files. With nothing to move the job writes nothing, makes no zip and shows nothing. *(L4; L5)*
- **AC-10** **After a quiet period.** Another program writing `Pages/Nová kniha.md` with `type: kniha` is moved to `Knihy/` 30 s after the watcher's last event, not before; a stray written while a note is being typed in is not moved until 30 s of quiet. *(L4 with the injected quiet period; L5)*
- **AC-11** **Skips and later retries (D-805).** A stray changed by another program between planning and its write, or with a pending conflict (FR-SYN-04), is skipped: not moved, not written; the status says `Moved 1 kniha · 1 not moved (changed meanwhile, tried again later)` with `Show` (the not-updated list); the next quiet period moves it. A linking note changed meanwhile is skipped and listed the same way (ms4-jobs §5). *(L4 with the sync simulator; L5)*
- **AC-12** **Undo and the tidy job (AP-767).** `Undo` after AC-9 moves both strays back with their pre-job bytes and restores the linking notes; the next tidy runs do not move them again until their type or their type's folder changes. *(L4; L5)*
- **AC-13** **Progress, cancel, restore.** On a reference-vault type with 500 objects, a folder change shows `Moving <plural> · <done> of 500` (FR-UX-07 AC-8); `Cancel` during `planning` or `backup` leaves the vault byte-identical and makes no zip. Restoring the job's zip in Settings › Backups (tags.md FR-HIS-04 AC-8) moves every file back with its pre-job bytes (ms4-tags §5.3). *(L4; L5; L6 once)*
- **AC-14** **Crash during a move (T1).** In 20 nightly cycles on the 500-object type, `SIGKILL` the app during `writing`: every note exists exactly once, at its old or its new path, with its pre-job or fully rewritten bytes; no `.tegg-tmp` survives the next open; the next tidy run finishes the move; restoring the job's zip gives every file its pre-job path and bytes (sha256). *(L6 nightly)*

---

## Part two: deletes (4E-2)

### FR-TYP-04 Delete a property (D-807, board D)

- **AC-6** **The dialog counts what the core planned.** `Delete property…` on Kniha's `poznámka` says `Delete property "Poznámka"?` / `Removes the poznámka line from 1 kniha; 1 has no value and is not touched.` (Duna has a value; Bez autora's line is empty; AP-769) with `Cancel` (default) and `Delete from 1 note`. On `isbn`, which no object has, the dialog says `No kniha has a value. Only the type definition changes.` with `Delete property`, which writes only `kniha.yml` (no job, no zip). *(L5; L4 for the counts)*
- **AC-7** **The job.** `Delete from 1 note` creates the zip (`Delete property Poznámka`), removes Duna's `poznámka` line (its value lines too; the `# od koho` comment above it stays, AP-769), leaves Bez autora, Článek and `_templates/Kniha/` untouched (templates: AP-769), then removes the item and its `preview` key from `kniha.yml` in the same job; the status says `Deleted Poznámka · removed values from 1 note` with `Undo`. *(L4; L1 for the bytes; L5)*
- **AC-8** **Undo.** `Undo` restores Duna's exact bytes and `kniha.yml`'s exact bytes; files changed since are skipped and listed. *(L4; L5)*
- **AC-9** **Skips.** A Kniha changed by another program during the job is skipped `changed`, keeps its line and is listed with `Retry`; the type file is still changed, so that note shows the value under Other properties until a retry removes it. *(L4; L5)*
- **AC-10** **Open notes.** With Duna open with unsaved body text, the line is removed through its editor as one transaction (D-386, ms4-jobs §9); the unsaved text is kept; the file is written once. *(L4 with `editor_open`; D-841: no L5, since `Delete property…` runs only on Type settings, which replaces the note page)*

### FR-TYP-05 Delete a type with objects (D-809, board F; details types.md FR-TYP-05 AC-4)

- **AC-6** **The dialog.** On `type-settings/schůzka` the Delete type section says `Deleting Schůzka moves its 3 schůzky to the trash. To keep them, change their type first. A backup is made first.`; `Delete Schůzka type…` opens `Delete type "Schůzka"?` with `3 schůzky go to the trash with the type, and the Schůzka template. Notes that link to them show moved to trash.`, `Cancel` (default) and `Delete type and trash 3 schůzky`. *(L5)*
- **AC-7** **The job.** Confirming creates the zip (`Delete type Schůzka`), moves Porada, Retro and Schůzka jinde to `.trash/` keeping their relative paths (FR-STO-08 AC-5), then `_templates/Schůzka/` and `.tegg/types/schůzka.yml` (definition last); Odkazy's `[[Porada]]` and `[[Retro]]` show the trashed chip; the status says `Deleted Schůzka · 3 schůzky in the trash` with `Undo`; `type-settings/schůzka` shows `This type no longer exists.` / `Schůzka was deleted. Its 3 objects are in the trash.` with `Undo` and `Open Trash`. *(L4; L5; L6 once)*
- **AC-8** **Undo and cancel.** `Undo` moves the three objects, the templates and the type file back to their paths with their bytes. `Cancel` during the job restores the objects already trashed and keeps the type (board F2); a failed job leaves the type in place. *(L4; L5)*
- **AC-9** **A skipped object keeps the type.** If Retro is changed by another program before it is trashed, it is skipped `changed`; the other two are trashed, the definition and templates are kept, and the status says `1 object was not changed, so the type was kept.` with `Show` (AP-770 follows D-809's "definition removed last"). *(L4; L5)*
- **AC-10** **Restoring an object brings the type back (D-809, AP-770).** Restoring Porada from the Trash view (trash-media.md) after AC-7 restores `Schůzky/Porada.md` and `.tegg/types/schůzka.yml` to their paths; the templates stay in the trash. When a type with the key `schůzka` exists again, only the object is restored. *(L4; L5)*

### FR-TYP-03 A property's type only widens (D-808, board E)

- **AC-14** **The menu.** On Kniha's `hodnocení` (Number) the `Type` menu lists only `Text`, `Long text` and the current `Number`, with the footer `Only a more general type; values stay as written.`; the targets of each type are board E2's; Date range offers none. Choosing `Text` writes only the item's `type:` line of `kniha.yml`; no note is written; no dialog. Verifies types.md FR-TYP-03 AC-11 in its D-808 form. *(L5; L4)*

---

## Both parts

- **FR-HIS-04 AC-11** **Every multi-file 4E job backs up first (board G).** `folder-move` (save and tidy, when it moves something), `value-remove`, `type-delete` and a bulk `type-move` each create their zip before the first vault write, listed in Settings › Backups with R99's label; a failed zip ends the job `BackupFailed` with the vault byte-identical (data-safety AC-1). A single-note `type-move` makes no zip. *(L4; L5)*
- **FR-SYN-06 AC-36** **Only the affected files, once.** For each 4E job on the fixture the written files equal the plan's files; every other vault file keeps bytes, mtime and inode; Undo writes only the files the job wrote. *(L4)*
- **FR-FMT-07 AC-26** **Property test.** For random frontmatter (block and flow lists, comments, quoting, CRLF, NFD keys, no final newline) and random bodies, `remove-key` and `map-properties` change only their own lines and the body's start; a random move with `keep-targets` keeps every link's resolution (`link_resolve` before and after) and changes no byte outside link targets. *(L2)*
- **FR-UX-07 AC-12** **Benchmark.** `app/e2e/perf_type_move.ts` records moving 500 objects with 500 linking notes on the reference Mac; recorded, no target. *(L6, benchmark)*
- **FR-UX-03 AC-18** **Keyboard.** Every R99 control is reachable by Tab, R100's commands run from the palette, and each dialog works with ↑/↓, ⏎ and Esc without the pointer; Esc returns the focus to the control that opened the dialog. *(L5)*
- **NFR-OTH-02 AC-10** **Strings.** Every R99 text is a catalog key with plural forms where it has a count (pseudo-locale check: only titles, type names, keys, folders and values outside `⟦ ⟧`). *(L1; L5)*
- **FR-UX-05 AC-13** **Themes.** FR-UX-05 AC-4, AC-5 and axe `color-contrast` pass with each R99 dialog open and on the status strip, light and dark. *(L5)*

---

## Points for the owner (AP-765…AP-773, accepted as D-810…D-818)

Only what D-803…D-809 and the board left open. Each was accepted as proposed (AP-765 → D-810 … AP-773 → D-818).

| AP | Point | Proposal | Alternatives | Affects |
| --- | --- | --- | --- | --- |
| AP-765 | **Links on a move** beyond the `(2)` case of D-804. D-291 resolves the same folder first and relative Markdown links by path, so a move breaks path-form links to the note and can retarget the note's own links. | Incoming: rewrite only links whose written form would stop resolving (path forms, relative Markdown links, body and frontmatter); `[[Plán]]` stays. Outgoing: a link in the moved note whose target would change from the new folder is rewritten to keep it (relative path for Markdown links; the shortest path form that resolves, with the written text as alias, for wikilinks). New `@tegg/doc` op `keep-targets`. Silent, like the suffix (D-804). | (b) Incoming only; accept that the note's own same-folder links may retarget. | FR-STO-04 AC-7, AC-8; FR-FMT-07 AC-26 |
| AP-766 | **What the tidy job moves, and when.** D-805 says "every object outside its type's folder". Obsidian files without `type`, types without a definition and subfolders aren't settled; "quiet period" has no length; a zip every quiet period would push useful backups out of the 10 kept. | Moves only files whose `type` names a defined type (D-239 matching) and that are not in that type's folder **or a subfolder of it**; never untyped files (FR-TYP-10), undefined types (D-121), `_templates/`, `.trash/`, non-Markdown files. A type change and a folder change move to the folder's root (AC-8, AC-10). Quiet period 30 s with no watcher event; also at vault open after the index is ready. No zip, no write, no message when nothing moves. | (b) Subfolders count as outside (everything goes to the root). (c) Tidy only at vault open. | FR-STO-01 AC-8…AC-11; FR-STO-04 AC-10 |
| AP-767 | **Undo for multi-file jobs.** D-804, D-805, D-807 and D-809 give every job `Undo`; ms4-jobs §1 and §7 make only note rename undoable (D-395: zips). And an undone tidy move would be moved again at the next quiet period. | Every 4E job keeps the ms4-jobs §7 undo record (pre-job bytes, post-job version, renames, trash moves) in memory until quit or a vault switch; `Undo` in the status for 5 s and the palette `Undo <operation>` for the last undoable job; files changed since are skipped and listed. The single type move keeps the D-387 journal; multi-file jobs rely on the zip after a crash (as tags). Files whose tidy move was undone are left alone by later tidy runs until their type or their type's folder changes (machine-local list by `id`, Application Support). | (b) Undo only right after the job (5 s toast), no palette. (c) Undo of a tidy move doesn't exempt the files. | AC-11 of FR-STO-04; FR-STO-01 AC-12; FR-TYP-04 AC-8; FR-TYP-05 AC-8; ms4-jobs §1, §7 |
| AP-768 | **Content lines and bulk convert (D-804 details).** The board says "the value as it would be shown". | Lines use the stored value, not the display format: dates `YYYY-MM-DD` (FR-FMT-11), lists joined with `, `, relations as their `[[links]]`, booleans `true`/`false`, quotes dropped; written after the frontmatter in old schema order, then one blank line, then the body unchanged. Only the old type's schema properties are mapped; keys outside the schema (orphans, hand-written) stay in the frontmatter. Same key but narrower target → Content (not offered). A bulk Inbox convert shows one dialog for the type pair, applied to each item. | (b) The display format of the Date & time setting (D-781) and `Yes`/`No`. (c) Bulk convert without a dialog (all Content). | FR-STO-04 AC-5, AC-6; FR-INB-02 AC-17; R101 |
| AP-769 | **Delete property: empty lines and templates.** D-807 counts "objects that have a value". | An empty line (`poznámka:`) counts as "no value" and stays; templates of the type keep their line (they're not objects; editing them is FR-TPL, v1.0). Removing a line removes its value lines too; full-line comments above it stay. | (b) Remove empty lines too. (c) Remove the line from the type's templates too. | FR-TYP-04 AC-6, AC-7 |
| AP-770 | **Delete type: a skipped object, and restoring.** | A skipped object keeps the type (definition removed last only when every object was trashed). Restoring a trashed object restores the type file when no type with that key exists, never the templates. | (b) Delete the definition anyway; the skipped object is an undefined type. (c) Restore the templates with the type file. | FR-TYP-05 AC-9, AC-10 |
| AP-771 | **Renaming options in use** (D-473 parked it with 4E's v1.0; D-803 doesn't list it). | Out of 4E: D-473 stands (`Renaming used options comes in v1.0`). | (b) In 4E-2 as an `option-rename` job with Undo. | FR-TSK-02; types.md FR-TYP-03 AC-5 |
| AP-772 | **Earlier criteria that 4E changes and D-806…D-809 don't cover** (`AC-Test-Change` approval where tests exist). | types.md FR-TYP-01 AC-5 (help text `New objects go here.` and no `Move existing objects`, D-805), FR-TYP-07 AC-5 (the file moves), AC-6 (Page → Schůzka → Page: `místo` goes into the content, D-804), AC-9 (undo is the job's undo), R12's General row; inbox.md FR-INB-02 AC-5 (the file moves); links.md FR-STO-04 AC-1 ("links unchanged" → "links keep resolving; path forms are rewritten"); app-shell R3 rows of the 4E controls (D-748). Each in the commit that builds the part that changes it. | — | types.md, inbox.md, links.md, app-shell.md |
| AP-773 | **Two parts.** | 4E-1 (type move with mapping, folder move and tidy, Undo of jobs) and 4E-2 (delete property, delete type, the widen-only menu) get one red-test commit each, two build PRs and two previews, in that order. | (b) One red-test commit and one PR for all of 4E. | plan §3 |

## Points for the owner, 4E-2 (AP-789, AP-790, accepted as D-841, D-842)

Found while completing ms4-jobs §14.9 before the 4E-2 red tests. Everything else in §14.9 follows the ACs and D-806…D-815. Both were accepted as proposed (AP-789 → D-841, AP-790 → D-842).

| AP | Point | Proposal | Alternatives | Affects |
| --- | --- | --- | --- | --- |
| AP-789 | **FR-TYP-04 AC-10 can't happen in the app.** `Delete property…` exists only on Type settings, and Type settings replaces the note page in the one main pane; only the note page registers an open editor (`editor_open`). So Duna can't be open with unsaved text while its property is deleted, and an L5 test can't reach it. The same holds for an open object during a type delete. | Keep the engine rule (an open note gets `remove-key` through its editor, D-386) and test it at L4 only (`editor_open` set by the test); drop the AC's `(L5)`. The AC stays for when a second window or pane exists. | (b) Drop AC-10. (c) Make it reachable: a `Delete property…` entry in the note's property panel (new UI, not on the board). | FR-TYP-04 AC-10; ms4-jobs §14.9.2, §14.9.3 |
| AP-790 | **Two wordings for the type-delete dialog.** FR-TYP-05 AC-6 here and R99 use the type's plural: `3 schůzky go to the trash with the type, and the Schůzka template.` / `Delete type and trash 3 schůzky`. types.md FR-TYP-05 AC-4 (rewritten for D-809) says `3 objects go to the trash with the type.` / `Delete type and trash 3 objects`, as D-809's own text does. | R99 and AC-6 win (as for every 4E count, `1 kniha`, `6 knihy`): types.md FR-TYP-05 AC-4's texts follow them, an AC-test change approved with this point where a test asserts the old text. | (b) Generic `objects` everywhere (R99 and AC-6 change instead). | types.md FR-TYP-05 AC-4; FR-TYP-05 AC-6; R99 |

## Red-test points, 4E-2 (AP-791…AP-802, accepted as D-843…D-853)

From the 4E-2 red tests; each accepted as proposed (AP-791 → D-843 … AP-802 → D-853; the extra AC-test change of FR-TYP-17 AC-3 is D-854). Summary: `remove-key` removes any entry it is given, the planner never gives it an empty one (AP-791); a property delete's skipped notes add `· <k> not changed (changed meanwhile)` with `Show` (AP-792); count clauses are dropped at 0 (AP-793, AP-796); the key description ends with a period (AP-794); one widen table `tests/fixtures/types/widen.json` for TS and Rust (AP-795); `AfterRead` per object before its trash move (AP-797); skip reason `taken` (AP-798); flat `job_plan` with `empty` (AP-799); a deleted type's objects stay one Trash row each and `.trash/.tegg/` is never a row (AP-800); the fake's `skipOnWrite` covers trash moves (AP-801); refusals come from `Jobs::start` (AP-802).
