# Design review for the daily-use MVP (2026-10-16)

Status: **M1–M11 fixed on the boards on 2026-10-16 as proposed in §3 (M12–M14 needed no change); `TypeCards.dc.html` is registered in `canvas.json`. §2 (missing designs) is still open.** Checked `design/edit-note-page/` (11 boards in `canvas.json` plus `TypeCards.dc.html`, which is not registered in the canvas) against BRD v1.56 and the order in `mvp-daily-use-plan.md` (D-370…D-377). The three newest boards (Inbox, TypeCards, CardAnatomy, plus FolderLogos) are uncommitted.

## 1. What exists

| Board | Covers | Phase of its content | State |
| --- | --- | --- | --- |
| Main (Edit note · Meeting) | shell, sidebar, note header, attribute panel, editor, slash menu, toolbar, embed preview card, task blocks, mindmap block, right panel (Backlinks, Outline, Graph) | MS3 built; embeds 4F; tasks 5A; mindmap MM; Outline and Graph v1.0 | 2026-10-14, partly out of date (§3) |
| Ideas (Type page) | list view, filter, sort, `By status` | MS3 built; grouped view v1.0 | current |
| TypeSettings | general, properties, options, preview properties, review, templates, views, delete | MS3 built; the rewrite texts are now v1.0 (§3) | out of date |
| Home | Today, Inbox count, tasks, recent | 5B | current, two small points (§3) |
| Inbox (new) | list, filters, bulk bar, Convert-to menu, keyboard hints, Inbox zero | 5B | current |
| TypeCards (new) | one card per system type + Idea | 4F card embeds, 5A/5B, 6A | matches except icon/cover and tag colour (§3) |
| CardAnatomy (new, proposal) | one universal card: title, tags, content, optional properties, card / embed / row sizes | 4F, type pages | consistent with FR-TYP-08/-11; cites the removed FR-TYP-14 |
| Graph | local graph | v1.0 (FR-GRP) | out of MVP |
| VaultSwitcher | option C applied (D-219) | built | current |
| Logos, FolderLogos | brand | MS8 packaging | not pages |

## 2. Missing designs for the daily-use slices

Ordered as the slices run. "Small" means a dialog or a strip inside an existing page; "page" means a new route.

| Slice | Missing | Size | Requirement |
| --- | --- | --- | --- |
| 4C | `Updating links in n notes` progress (non-blocking, D-268) and the `links not updated` list with retry; Settings → Backups list (D-274) | small | FR-LNK-03, FR-UX-07, FR-HIS-04 |
| 4F | per-type default embed mode in Type settings; the `circular embed` stop (FR-EMB-04); full-mode embed (nested editor) inside a note. Main shows the card and the link chip only | small | FR-EMB-02, -04 |
| 5A | **Task views page** (Today / Upcoming / All open / By source / Done, quick-add row, overdue highlight) | page | FR-TSK-04, -09, -10 |
| 5A | **Conversion popover** (`Turn into object` ⌘⇧O is in the toolbar; the popover with editable title and type choice is not drawn) and the first-time `Removing the embed keeps the object` confirmation (FR-CNV-08) | small | FR-CNV-01, -02, -08 |
| 5A | Task type settings: editable status labels and semantic state, priority order (TypeSettings is drawn for Idea only) | small | FR-TSK-02, -03 |
| 5A | Daily Note tasks section (the `Coming in MS5` placeholder); the Daily Note page itself was built in 4B from ACs without a board | page | FR-DLY-04, D-271 |
| 5B | **Quick capture window** (menu bar; text, type selector, default type) and the menu bar menu | page | FR-CAP-01, -03, -05, FR-VLT-05 |
| 5B | Settings: Vault (location, attachments folder, daily folder and date format, default type), Menu bar and launch at login, hotkey-registration failure (D-71) | small | FR-SET-01, -05, FR-CAP-05 |
| 6A | **Trash view** (restore, delete permanently) and the `moved to trash` placeholder in notes (D-27) | page | FR-HIS-01, FR-STO-08 |
| 6A | Image and PDF **object pages** (a note whose body is the file; the card exists in TypeCards) and the paste-image flow (object + file + embed) | page | FR-ATT-01, -02, -07, -08 |
| 4D-lite | **Tag page** (description, objects grouped by type, no colour); tag rename/delete dialogs with the D-? two choices (FR-TAG-08) | page | FR-TAG-06, -08 |
| MM | the mindmap block is drawn in Main; nothing missing for the MVP subset | — | FR-MMP-01, -02 |
| any | Empty states beyond Inbox zero (empty type page, no backlinks, empty Tasks, empty vault Home) | small | FR-UX-06 (MS8) |

Already built without a board and working: vault chooser (FR-VLT-01/-02), Search page, Conflicts view, Daily Note page, Broken links page, Type settings for system types.

## 3. Where designs and requirements disagree

| # | Board | Design says | Requirements say | What to do |
| --- | --- | --- | --- | --- |
| M1 | Main | `Add icon`, `Add cover` in the note header | removed: objects show their type's icon (D-217, FR-TYP-14 W) | remove from the board |
| M2 | TypeCards, CardAnatomy | "The object's own icon and cover replace the type defaults (FR-TYP-14)"; the Page card has a cover image | same D-217 | drop the cover band and the sentence; CardAnatomy's "no cover in the MVP" is right but should cite D-217, not FR-TYP-14 |
| M3 | TypeCards | "Tags use their own colour everywhere (FR-TAG-05)"; coloured tag chips | tag colour is v1.0 (D-370) | neutral chips in the MVP; keep the sentence as v1.0 |
| M4 | Main | Backlinks list with `via` and context text; `Unlinked mentions` with `Link` | chips only, grouped by type (D-368); unlinked mentions are v1.x (FR-LNK-05) | redraw the panel as chips, mark unlinked mentions v1.x |
| M5 | Main | Right panel tabs Backlinks, Outline, Graph | Outline is v1.0 (D-376), Graph v1.0 (FR-GRP) | the MVP panel has one tab; keep the others as v1.0 |
| M6 | TypeSettings | "Changing it moves all 10 files and updates their links"; "Renaming the key rewrites the frontmatter of all 10 ideas… restore point"; "Deleting asks whether to remove the values from the files"; "Delete type… move the 10 ideas… restore point"; property retype | all are 4E, now v1.0 (D-372); in the MVP a folder change applies to new objects, a key rename edits only the definition, delete property keeps orphan values, a type with objects can't be deleted | change the helper texts to the MVP behaviour or mark them v1.0; Templates and Views sections are v1.0 already |
| M7 | Main | Mindmap: `⌘. collapse`, `Drag to re-parent`, `turn node into object`, `Mindmap from template…` | MVP is render + outline editing (Tab / Shift-Tab / Enter, inline text, `[[` links, Source toggle); collapse, drag, node → object are v1.0 (D-377); templates are v1.0 (FR-TPL) | mark those four as v1.0 on the board |
| M8 | Home | `Start triage` button | triage mode is v1.x (§11) | drop or mark v1.x |
| M9 | Home | `Pinned` section expected by FR-HOM-01 | FR-HOM-02 pinned objects moved to v1.0 (D-376) | Home in the MVP shows Today, Inbox count, Tasks, Recently opened, Recently edited; Pinned marked v1.0 |
| M10 | TypeCards | Daily Note card with time-stamped entries `09:05`, `13:30` | time-stamped entries are v1.0 (FR-DLY-09) | show the first lines of the note instead, or mark v1.0 |
| M11 | Inbox | `Convert to… keeps content, id, links` | correct (FR-INB-04); with D-372 the file stays in its folder | add that note, since FR-INB-02 says "moves the file" and that part is v1.0 |
| M12 | Ideas | `By status` grouped view, `Links` column | grouped views and computed columns are v1.0 (FR-QRY, AP-19) | already recorded in the MS3 plan; nothing new |
| M13 | Home | `New task ⌃⌥T` | matches FR-CAP-05 | — |
| M14 | Inbox | actions mark reviewed, convert, merge, link, trash, open; bulk selection; keyboard hints | matches FR-INB-02 | — |

Everything else checked matches: the attribute panel with `Other properties (1)` (D-316), the type chip, the embed preview card with up to four preview properties (FR-TYP-11), task blocks as D-74 cards, click previews / double-click opens (D-37), the Quick Note card's `Mark reviewed` / `Convert to…`, the Task card's source chip (FR-TSK-08), the vault in the title bar (D-219), the logo bottom-left (D-220).

## 4. Suggested order for the missing designs

1. Task views page and the conversion popover (5A is next after 4C/4F, and the biggest undesigned page).
2. Quick capture window and the Settings sections (5B).
3. Trash view, Image/PDF object pages (6A).
4. Tag page (4D-lite; can reuse the type-page layout).
5. ~~Fix M1–M11 on the existing boards, and register `TypeCards.dc.html` in `canvas.json`.~~ Done 2026-10-16.

CardAnatomy is a proposal: if accepted, it decides how the type page card view, Home items, embed cards and Inbox rows share one component, which would be worth deciding (as an AP) before 4F draws the embed card.
