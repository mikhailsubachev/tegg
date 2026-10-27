# MS4 implementation plan: Links, tags, renames, daily notes

- **Status:** accepted, 2026-10-15. AP-195…AP-203 (§6) were accepted by the owner as D-267…D-275 (BRD v1.44). **Changed 2026-10-16 (D-370…D-377, `docs/plans/mvp-daily-use-plan.md`):** 4E moved to v1.0 (D-372) and **returned to the MVP as the next slice on 2026-10-27 (D-803; it takes the MS7 row of BRD §11.2)**; 4D ships without colour (D-370); the order after 4B is 4C, 4F, then the MS5/MS6 daily-use slices, then 4D-lite (D-375). The MS4 gate runs after 4D-lite on the kept requirements.
- **Scope:** BRD §11.2 MS4 (30 requirements), architecture §12 (`tegg-jobs`, backup zips, daily notes, embeds), `docs/requirements-coverage.md` § MS4, and every `[MS4]` criterion already written in earlier slices (§2.2).
- **Start conditions:** MS3 done: 3D follow-up (D-253…D-265) merged, 3E built, `./verify milestone --milestone MS3` green.

---

## 1. All at once or in slices

| | All at once | Slices (recommended) |
| --- | --- | --- |
| ACs and red tests | One pass for 30 requirements before any code | Per slice, just before it starts (as D-115 did for MS3) |
| First usable build | At the end of MS4 | After 4A, then after every slice |
| Owner feedback | One big round at the end | Six small rounds; MS3 showed each preview produces decisions (D-217, D-218, D-246…D-265), cheaper to take early |
| Data-loss risk (T1) | Rename, tag, schema and move rewrites land together; a bug in the shared engine shows up in four features at once | The engine ships with one client (note rename) and is proven on it before tags and schema ops reuse it |
| Engine design | All four clients known when `tegg-jobs` is designed | Same, if 4C's contract covers all four clients up front (§3, 4C) even though only rename ships in 4C |
| Overhead | One preview note, one explorer run | Six of each (≈ half a day per slice) |
| Gate | `./verify milestone --milestone MS4` once | Unchanged: once, at the end of the last slice |

All at once only wins on overhead. Its one real advantage, designing the job engine with every client in view, is kept by writing the full `tegg-jobs` contract in 4C. Recommendation: **six slices, 4A–4F**, with the same per-slice loop as MS3 (plan `ms3-implementation-plan.md` §3, §5): ACs (ac-author) → red tests (test-author) → implementation → `./verify push` → explorer on a generated vault → preview build and charter.

---

## 2. What MS3 already built for MS4

### 2.1 Infrastructure in place

- Link records in the index with the attribute key (`backlinks_detailed`, contract §15.4, D-257), `resolve_links` with date links first (D-162), the broken-link style and description (D-142).
- `@` trigger rules (D-258), waiting for date rows; `#` tag autocomplete from the index (D-185).
- Fixed-definition `tegg-query` list views (3D type pages), reusable for tag pages and daily-note context sections.
- Review flag (FR-TYP-12, 3D), title editing that writes only `title:` (D-173), type change that writes only `type:` (D-224).
- TBD routes and disabled `Coming in MS4` controls, all listed in the route registry test (FR-UX-02 AC-13), so each slice must replace its own.

### 2.2 `[MS4]` criteria already written

links.md: FR-FMT-08/FR-LNK-03 AC-1, -2, -4, -5, -6; FR-STO-04/FR-TYP-07 AC-1, -2; FR-TYP-04/FR-TAG-04 AC-1…AC-3. types.md: FR-TYP-05 AC-4 and the MS4 markers of D-224…D-228. data-safety.md: FR-SYN-06 AC-3, FR-STO-01/-03/… AC-7 (folder move, D-226). search-navigation.md: FR-UX-07 AC-4 (`job:progress`). file-format.md: FR-FMT-10 AC-2 (inline `#tag` = `tags:`). Also unmarked ACs in links.md that MS4 is the first to satisfy: FR-LNK-04 AC-1…3, FR-DLY-08 AC-1…3, FR-LNK-14 AC-3…4.

Missing entirely: FR-DLY-01…06, FR-EMB-01, -02, -04, FR-LNK-01, -07, FR-TAG-01…03, -05…08.

---

## 3. Slices

| Slice | What you get | Requirements | Exit build lets you… |
| --- | --- | --- | --- |
| **4A Backlinks and link states** | Backlinks tab in the right panel (grouped by type, surrounding text, attribute name for property links); link vs embed styles (link part); broken link → `Create` with the default type; duplicate titles: distinguishing details in autocomplete and switcher, "Duplicate titles" check | FR-LNK-01, -02, -04, -07 (links), -14 (AC-3, AC-4) | see what links to a note, fix broken links by creating the note |
| **4B Daily notes** | Today (⌘D) replaces its placeholder; virtual note until the first keystroke; previous/next day and calendar with marked days; context sections; `review: unreviewed` on first write; daily template; `@today`, `@tomorrow`, `@<date>` and a date picker in the `@` list; date links open the virtual note | FR-DLY-01…06, -08 | **use daily notes every day**, link dates from any note |
| **4C Rename engine** | `tegg-jobs`: Rust selects files, checks base versions, makes the backup zip, writes atomically; `@tegg/doc` in a Web Worker produces the bytes (D-82); progress and cancel; "link not updated" list with retry. First client: renaming a title renames the file and rewrites every link form, undoable as one action | FR-FMT-08, FR-LNK-03, FR-HIS-04, NFR-REL-04; FR-UX-07 AC-4, FR-SYN-06 AC-3 | rename notes freely; links follow |
| **4D-lite Tags** (D-370) | Tag objects (`Tags/<name>.md`, virtual until edited); tag page with description and objects grouped by type; sidebar Tags section with counts; rename (a 4C job) and delete with its two choices. ~~Colour~~ → v1.0 | FR-TAG-01…04, -06…08 (no colour) | organise with tags, rename them safely |
| **4E Schema and type moves** (→ v1.0 by D-372; back as the MS7 slice by D-803, 2026-10-27) | Type change moves the file to the new type's folder (duplicate suffix if needed); the folder move of existing objects in the background (D-805); delete a type with objects; ~~attribute key rename~~ (W, D-806); `Remove values from <n> notes`; value conversion on retype (D-227). All as 4C jobs with backup first | FR-TYP-04, -07, FR-STO-04; types FR-TYP-05 AC-4, data-safety AC-7 | reshape your types without hand-editing files |
| **4F Embeds** | `![[Note]]`, `![[Note#Heading]]` rendered as full, card or link; per-type default mode; insert via slash menu and drag from sidebar or search; circular-embed stop, depth 3; embed placeholders from 3B (R5) replaced | FR-EMB-01, -02, -04, FR-LNK-07 (embeds) | compose notes from other notes |

**Order rationale.** 4A first: it is mostly read-only on top of index data that exists, and 4B needs backlinks (FR-DLY-08 AC-3). 4B second: highest daily value and no bulk writes (it writes one file, on the first keystroke). 4C is the riskiest slice and is kept to one client so the engine is proven before 4D and 4E reuse it; if the missing file rename hurts more than missing daily notes in daily use, 4B and 4C can swap. 4F touches the editor and not the job engine, so it can be built in parallel with 4C–4E by a second session in its own worktree.

**4C contract covers all clients.** `docs/contracts/ms4-jobs.md` is written in 4C for note rename, tag rename and delete, key rename and value removal, type move and folder move, type delete, and merging duplicate titles (D-290), with one job model: plan (affected files, counts) → confirm → backup → write → report. 4D and 4E then only add planners.

**Quality bar from MS4.** Mutation thresholds rise to 80% (T1) / 70% (T2) (D-61). Every rewrite job needs a property test: random vault + random rename sequence + undo gives the original bytes; only files containing the target change (links.md FR-LNK-03 AC-2, AC-5). The sync simulator's "external edit during a job" case (AC-6) runs for every job type, not only rename.

---

## 4. Placeholders replaced

| Slice | Placeholder or disabled control |
| --- | --- |
| 4A | Right panel Backlinks tab; broken link "does nothing" (D-142) |
| 4B | Sidebar Today and route; date link `Coming in MS4` (D-142); `@` date rows (D-258) |
| 4C | Title edit writes only `title:` (D-173) becomes a rename |
| 4D | Sidebar Tags section, Tags route (D-218), tag colour default (D-185) |
| 4E | `Move existing objects` (D-226), `Remove values from <n> notes` (D-228), type delete with objects (D-225), key rename (D-223), value conversion (D-227); type change keeps the file in place (D-224) |
| 4F | Embed placeholders in R5 (D-144), slash-menu "Object embed" |

Still TBD after MS4: Inbox (MS5), tasks due in daily notes (MS5), Task embed card (D-74, MS5), previews (v1.0), query builder tag filters (v1.0), graph tag colours (v1.0), the 4E controls and tag colour (v1.0, D-370, D-372; relabelled when 4C ships).

---

## 5. Data safety while dogfooding

- 4A and 4B write only notes you create or type into.
- **From 4C the app rewrites files you didn't open.** Before 4C reaches the owner: the property tests and the explorer run on the generated 5,000-note vault must pass, and the preview note says to keep a backup (Time Machine or sync file versions, D-119). The backup zip (D-57) is a second net, not the first.
- Every job writes only files whose bytes change and never touches a file changed on disk since it was planned.

---

## 6. Decided points (AP-195…AP-203 → D-267…D-275, accepted 2026-10-15)

| # | Point | Proposal |
| --- | --- | --- |
| AP-195 | **MS4 in slices.** | Slices 4A–4F (§3), ACs and red tests per slice, preview build after each, one MS4 gate at the end. Same as D-115. **Accepted: D-267.** |
| AP-196 | **When a title edit renames the file.** Renaming on every keystroke would churn files and links (FR-SYN-06, R-04). | Rename when the title is committed (↩, Tab, or focus leaves the title), not while typing. A rename that rewrites more than 0 other files shows a non-blocking "Updating links in n notes" progress, no confirmation. **Accepted: D-268.** |
| AP-197 | **Backup zip for a note rename.** D-57 lists import, attribute rename, tag rename and bulk type change, not a single note rename, which can still rewrite many files. | No zip for a note rename: undo as one action (AC-5) is its restore. Zip for every other job. **Accepted: D-269.** |
| AP-198 | **Daily-note template before templates (FR-TPL, v1.0).** FR-DLY-06 is MS4. | One file `_templates/Daily Note/Daily Note.md`, applied on the first keystroke, with only `{{date}}`, `{{date:FORMAT}}`, `{{yesterday}}`, `{{tomorrow}}` (a subset of FR-TPL-03). Starter vaults get it; without it the note starts empty. Multiple templates and other variables stay v1.0. **Accepted: D-270.** |
| AP-199 | **Context sections before tasks and capture (MS5).** FR-DLY-04 lists Quick Notes captured that day, tasks due/overdue, objects created and modified that day. | MS4 shows Quick Notes created that day and objects created / modified that day (by `created` / `modified`); the tasks section is an in-note placeholder `Coming in MS5`. **Accepted: D-271.** |
| AP-200 | **Review and Inbox (FR-DLY-05).** The Inbox is MS5. | 4B writes `review: unreviewed` on the first write and shows the review control; the Inbox listing stays TBD until MS5. **Accepted: D-272.** |
| AP-201 | **Embed modes before tasks (FR-EMB-02, D-74).** | 4F builds full, card and link with a per-type default in type settings; Task defaults to card with a generic header until MS5 adds the checkbox/status/due row. Full mode is editable in place (a nested editor on the embedded file, with the same autosave and conflict rules). **Accepted: D-273.** |
| AP-202 | **Restoring a backup zip.** D-57 creates them; nothing says how one is used. | Settings → Backups lists the last 10 with date, operation and size, and `Reveal in Finder`. Restoring is manual in the MVP (unzip over a copy); one-click restore comes with version history (v1.0). **Accepted: D-274.** |
| AP-203 | **Tags in the MVP views.** FR-TAG-07 includes the query builder (v1.0); FR-TAG-05 includes graph nodes (v1.0). | MS4 covers the sidebar, search filters, chips, inline `#tags`, tag page and type-page lists; the query builder and graph parts move to the coverage doc under v1.0. **Accepted: D-275.** |

Next: ac-author drafts slice 4A's ACs (`docs/acceptance/links.md` additions, backlinks), then test-author commits them red.
