# Proposal: the shortest path to a daily-use build (MS4 rest, MS5–MS7)

Status: **accepted by the owner on 2026-10-16: AP-a…AP-h are D-370…D-377 (BRD v1.56; AP-a D-370, AP-b D-371, AP-c D-372, AP-d D-373, AP-e D-374, AP-f D-375, AP-g D-376, AP-h D-377).** Written 2026-10-16 while the 4B preview fixes (D-367…D-369) are in progress. Owner brief: *"I want an MVP version I can use for my daily operations, starting from an empty vault. Skip Obsidian import, tag colouring and object type changes."* Decisions needed are listed as AP points in §5.

Update 2026-10-17 (owner, D-515): **Home is not part of the MVP.** FR-HOM-01 moves to v1.0 with FR-HOM-02; slice 5B is capture and Inbox only. Until v1.0 the Home sidebar entry and the D-132 launch fallback keep the TBD placeholder. Update 2026-10-22 (owner, D-613, D-614): slice 6A removes the Home entry and route; launch falls back to the Inbox.

## 1. Where we are

| Done | In flight | Not started |
| --- | --- | --- |
| MS1 vault core, MS2 index/search/switcher, MS3 shell + read view + editor + types + settings (3A–3E), **4A backlinks**, **4B daily notes** | 4B preview fixes (chips-only backlinks, type chip link, caret on create) | 4C rename engine, 4D tags, 4E schema/type moves, 4F embeds, MS5 tasks/capture/inbox/home, MS6 images/PDFs/trash, MS7 importers, MS8 hardening |

What still shows a placeholder in the app: Inbox, Tasks, Home, Tags, Trash, the tasks section of a daily note (`Coming in MS5`), embeds (R5, 4F), title rename (writes only `title:`, 4C), `Move existing objects` / `Remove values from n notes` / type delete (4E).

Pace so far: one slice ≈ one working day (3C 10-14, 3D 10-15, 4A 10-15, 4B 10-16), preview feedback included.

## 2. What "daily operations from an empty vault" needs

Starting empty removes the two biggest items from the MVP critical path: the Capacities importer (MS7, 19 requirements) and anything that reshapes existing data (4E). It leaves a short list of things you cannot work around by hand:

| Need | Why it can't wait | Slice |
| --- | --- | --- |
| Rename a note, links follow | Every renamed note otherwise leaves broken links; the only alternative is never renaming | 4C |
| Tasks: create, list, status, due date, overdue | The core of "daily operations"; the Daily Note's tasks section is a placeholder until this lands | 5A |
| Turn a block into an object (`/turn into`) | How meeting notes become tasks without retyping (FR-CNV) | 5A (needs 4F) |
| Embeds | Conversion leaves an embed in the source note (FR-CNV-03); the Task card (D-74) is an embed | 4F |
| Capture from anywhere + Inbox | Quick Note capture when the window is closed; Inbox is where Daily Notes and captured items land (`review: unreviewed` is already written by 4B) | 5B |
| Delete and restore | Today an object can't be deleted from the app at all; `.trash/` exists since MS1, the view doesn't | 6A |
| Paste a screenshot | Hard to work around by hand (an Image object + file + embed, D-42) | 6A |
| Tags you can open | Writing `#tag`/`tags:` already works (3D, D-185); a tag page and a sidebar list make them useful. No colour. | 4D-lite |
| Mindmaps in any note | Owner request (2026-10-16). Storage is done (FR-FMT-05, MS1); the read view shows the Mermaid source as code and the editor keeps it as a read-only source block. Rendering plus a keyboard outline editor makes the block usable; the full visual editor stays v1.0. | MM |

## 3. Proposed order

| # | Slice | Scope (kept) | Dropped or deferred from the current plan |
| --- | --- | --- | --- |
| 1 | **4C Rename** | `tegg-jobs` engine, note rename rewrites every link form, undo as one action (D-268, D-269); `docs/contracts/ms4-jobs.md` still written for all clients, so tag rename and the deferred 4E planners can be added later without redesign | nothing in 4C itself |
| 2 | **4F Embeds** (can run in parallel with 4C in its own worktree, as the MS4 plan already allows) | `![[Note]]`, `![[Note#Heading]]`, full / card / link, per-type default, slash menu, circular stop | drag from sidebar/search (FR-EMB-01, part): v1.0 |
| 3 | **5A Tasks and conversion**, split by D-500 into **5A-1 Tasks** (ACs `docs/acceptance/tasks.md`, D-470…D-489) and **5A-2 Conversion** (ACs `docs/acceptance/conversion.md`, D-490…D-499; starts once 4F is on `main`); contract `docs/contracts/ms5-tasks.md` | FR-TSK-01…05, -08…11 (attributes, status/priority definitions, Schedule view and Kanban by status or tag per the owner's designs (D-378), source chip, overdue, quick-add, checklist ≠ task); FR-CNV-01…06, -08; Task card header (D-74); Daily Note tasks section replaces its placeholder (D-271) | FR-TSK-06 calendar → later slice or v1.0 (§5, AP-b; the board came back by D-378); FR-TSK-07 recurrence is already v1.0 |
| 4 | **5B Capture and Inbox** | FR-CAP-01, -03…05 (menu bar window, < 300 ms, hotkeys), FR-VLT-05 default type, FR-INB-01…04, FR-NAV-04 sidebar final (Home entry stays TBD), FR-SET-01, -05, NFR-SEC-03, NFR-PERF-10 | **Home** FR-HOM-01 → v1.0 (D-515; the sidebar entry and the D-132 launch fallback keep the TBD placeholder); FR-HOM-02 pinned/saved queries → v1.0 with saved queries; FR-EDT-11 outline, FR-SET-04 shortcut editing (both S) → v1.0; Inbox "convert to type" keeps the file where it is (D-224 behaviour) since type moves are dropped (AP-c) |
| 5 | **6A Trash and images** | FR-HIS-01 trash view (restore, delete permanently, "moved to trash" placeholder, D-27), FR-ATT-01 paste/drop/picker, FR-ATT-07 Image/PDF objects, FR-ATT-08 titles, PDFs as link card | FR-ATT-03 resize/caption, FR-ATT-09 unused-attachments tool, FR-HIS-02 auto-empty (S) → v1.0 |
| 6 | **4D-lite Tags** | Tag page (flat list of objects, groupable by type, D-690), All tags, sidebar Tags with the 5 recent tags and counts, `New tag`, tag colour (back in the MVP, D-707…D-710), rename and delete as 4C jobs, Search tag filter, Settings › Backups and note merge UI (D-705); decisions D-690…D-710 | Tag description and Tag attributes (D-691, D-693), tag merge (FR-TAG-09), Cards view (D-704): v1.0 |
| 6b | **MM Mindmap block** (editor-only, no file rewrites: can run in parallel with 5A–6A in its own worktree) | FR-MMP-01 insert from the slash menu; render with Mermaid bundled in the app (no network, NFR-SEC-01); edit as an indented outline in place (Tab/Shift-Tab nest, Enter sibling, inline text), live re-render, `source` toggle; `[[links]]` in nodes are links (FR-MMP-03 part); FR-MMP-04 via a verbatim template block (D-92, D-270) | FR-MMP-02 drag to re-parent, collapse, zoom/pan → v1.0; FR-MMP-03 node → object → v1.0 with FR-CNV on blocks; FR-MMP-05 export is v1.0 with FR-EXP (AP-h) |
| — | **Daily-use point.** `./verify milestone --milestone MS4` and a trimmed MS5/MS6 gate; preview build; you start the empty vault. | |
| 7 | **MS7 Capacities importer** | FR-IMP-03, -05, -07…11, -14…17, -19…22, -24, -23 (S5 code ported, D-83) | **Obsidian import** FR-IMP-01, FR-STO-10 (D-93) → v1.0 (AP-d) |
| 8 | **MS8 Hardening & release** | perf on the reference machine, FR-SYN-01 two-Mac sync if the vault sits in a synced folder, signed DMG (AR-08), empty states (FR-UX-06) | FR-UX-04 responsive layout → with mobile prep, v1.0 (AP-e) |
| — | **4E Schema and type moves** | — | whole slice → v1.0 (AP-f): FR-STO-04, FR-TYP-04, FR-TYP-07 file move, type delete with objects, key rename, value removal, value conversion. Type change itself keeps working as in 3D (writes `type:` only, D-224) |

Seven slices to the daily-use point (1–6b) at the current pace is roughly two weeks (MM and 4F run beside the others); 7 and 8 follow while you already use the app.

Why this order: 4C first because it is the riskiest slice (first bulk rewrite of files you didn't open, MS4 plan §5) and everything after it reuses the engine; 4F in parallel because conversion (5A) needs embeds; 5A before 5B because tasks are the daily-operations core and capture is only valuable once what you capture has somewhere to go; trash before tags because not being able to delete hurts sooner than not having a tag page.

## 4. What does not change

- The per-slice loop (ACs → red tests → implementation → `./verify push` → explorer → preview) and the D-61 rules.
- The MS4 quality bar (80/70 % mutation thresholds, property test "random vault + random rename sequence + undo = original bytes", sync-simulator "external edit during a job" for every job type).
- Data safety before 4C reaches you: property tests and the explorer run on the 5,000-note vault pass first; the preview note says to keep a backup (D-119). Starting empty makes this cheaper, not optional.
- The MS4 gate still runs once, after the last MS4 slice that ships (4D-lite); it is gated on the kept requirements only.

## 5. Decisions needed (AP points)

| # | Point | Proposal |
| --- | --- | --- |
| AP-a | **Tag colour out of the MVP.** FR-TAG-01 (colour), FR-TAG-05 and the colour part of FR-TAG-07 are M. | Move them to v1.0; `color:` in `Tags/<name>.md` stays reserved and preserved. MVP tags are name + description + page + sidebar count + rename/delete. |
| AP-b | **Task board and calendar.** FR-TSK-05, -06 are M in MS5. | List views only at the daily-use point; board and calendar come as a later slice (5C) or with FR-QRY views in v1.0. Owner picks. **D-371; the board part was superseded by D-378 the same day: the owner designed the kanban and wants it in 5A.** |
| AP-c | **Type changes out of the MVP.** 4E (FR-STO-04, FR-TYP-04, FR-TYP-07 file move, D-223, D-225…D-228) is M. | Move 4E to v1.0. Consequences to accept: a type change leaves the file in its old folder (D-224); Inbox "convert to type" (FR-INB-02) does the same; attribute key renames edit only the type definition (existing notes keep the old key as an orphan property, FR-TYP-07 rule). `tegg-jobs` (4C) still defines the planners' contract so 4E is additive later. |
| AP-d | **Obsidian import out of the MVP.** D-93 put FR-IMP-01, FR-STO-10 in MS7. | Move to v1.0. Opening an arbitrary folder still works mechanically (FR-VLT-01), but untyped notes are not promised to behave until then. |
| AP-e | **Responsive layout (FR-UX-04) to v1.0.** | Mobile prep without a mobile build has no daily-use value; keep the 44 pt rule for shared components as a lint, not a milestone item. |
| AP-f | **Importer after the daily-use point.** D-41 keeps the Capacities importer in the MVP; D-63 orders the milestones. | Keep it in the MVP (D-41 stands), but MS7 starts only after slices 1–6 ship. Nothing in 1–6 depends on it. |
| AP-h | **Mindmaps move into the MVP.** FR-MMP is v1.0 in §11; the owner wants mindmaps in any note for daily use. | FR-MMP-01 and -04 into the MVP (slice MM); FR-MMP-02 split: keyboard outline editing with live render in the MVP, drag/collapse/zoom/pan in v1.0; -03 and -05 stay v1.0. Mermaid is bundled (its mindmap renderer lazy-loads a layout library, so the bundle must be checked for no runtime fetch). R-08 stands: layout is Mermaid's, no node positions or colours stored. |
| AP-g | **Deferred Should items:** FR-EDT-11 outline, FR-SET-04 shortcuts, FR-HIS-02 trash auto-empty, FR-ATT-03 resize, FR-ATT-09 unused attachments, FR-HOM-02 pinned. | All to v1.0. None blocks daily use; FR-HOM-02 depends on saved queries, which are v1.0 anyway. |

Accepting these means: BRD §11.2 rows for MS4–MS8 change, new D-xx for each AP, `docs/requirements-coverage.md` §1 regenerated (≈ 25 requirements move from MVP milestones to v1.0, FR-MMP-01, -02 part, -04 move in), the R5 placeholder row for `mindmap` in `read-view.md` and the editor block table change from v1.0 to MM, the MS4 plan's 4D/4E rows marked as changed, and `qa.config.json` range rules for the milestone gates follow.

## 6. Not proposed

- Skipping ACs or red tests for the daily-use slices to go faster: the D-343 gate is now ~5 min, the loop is not the bottleneck.
- Merging 5A and 5B into one slice: 4B showed each preview produces decisions; capture and tasks have different UI and risks.
- Dropping 4C: a rename that doesn't update links would be the first data-integrity gap in daily use, and R-04 is the reason the engine exists.
