# Requirements coverage by phase

- **Generated:** 2026-10-11 from BRD v1.19 (§5–§9 requirement tables, §11 phasing, §11.2 milestones) and `qa/coverage/ac-matrix.md`.
- **Implementation status:** the product is **pre-code**: no requirement is implemented in product code yet. "Proven in a spike" means a spike test is recorded as passing by `./verify coverage` for some of the requirement's ACs; under D-83 and TS-I6 that is evidence the approach works, not product coverage. ACs are written per milestone, just before it starts (D-61), so missing ACs for later milestones are expected.
- **Method:** milestone lists expanded with the `./verify` range rules (tools/qa/CONTRACT.md §9.4); every requirement outside MS1–MS8 classified by hand against BRD §11, §11.1 and its priority. Requirement IDs: 279. In an MVP milestone: 179. Outside: 100 (after D-370…D-378, 2026-10-16: 14 moved to v1.0, 3 moved in). D-515 (2026-10-17) moved FR-HOM-01 to v1.0: now 178 in, 101 outside.

## Summary

| Where | Requirements |
| --- | ---: |
| MVP milestones MS1–MS8 | 178 |
| **MVP gap: Must (or NFR/AR) with no milestone** | 0 |
| MVP gap: Should, needed by an MVP requirement | 0 |
| v1.0 "complete desktop" (§11) | 73 |
| v1.x (§11) | 9 |
| v2 mobile / Phase 2 sync | 3 |
| Public release track | 1 |
| Architecture seam only (by design) | 1 |
| Satisfied by design | 1 |
| Won't (W): deliberately not built | 8 |
| Backlog: Could, unscheduled by decision (D-87) | 5 |
| **Total** | **279** |

**Verdict:** every requirement now has a phase. The first run of this check found 46 requirements that needed a decision; the owner decided them on 2026-10-11 (AP-32…AP-34 → D-85…D-87): 32 moved into MVP milestones, 9 Should requirements to v1.0, 5 Could requirements to an explicit backlog.

## 1. MVP milestones → requirements

Requirements in several milestones are built in the first and gated again later (NFR-PERF targets are measured where the code lands and again at MS8 on the reference machine).

### MS1: Vault core & file format

35 requirements · 35 with ACs · 10 with spike evidence · 0 implemented

| Requirement | Summary | ACs / evidence |
| --- | --- | --- |
| AR-03 | Clear separation: core (vault I/O, parsing, index, query engine, sync adapters), UI, platform (menu bar, share… | 5 ACs |
| AR-04 | Sync adapter interface, so Phase 2 API sync (FR-SYN-20) plugs in without changing the core. | 4 ACs |
| AR-06 | Markdown parsing/serialization is covered by a round-trip test suite (corpus incl. Obsidian, Notion, Capacitie… | 3 ACs, 1 proven in a spike |
| FR-FMT-01 | Attributes are stored as YAML frontmatter using Obsidian "Properties" conventions (text, number, checkbox, dat… | 3 ACs |
| FR-FMT-02 | Every object has a stable `id` in frontmatter (e.g. ULID), so identity survives renames and external edits. Th… | 4 ACs |
| FR-FMT-03 | Links are `[[Note Name]]`, `[[Note Name\|alias]]`, `[[Note Name#Heading]]` and `[[Note Name#^blockid]]`. Relat… | 4 ACs, 4 proven in a spike |
| FR-FMT-04 | Embeds are `![[Note Name]]`, `![[Note Name#^blockid]]`, `![[image.png\|400]]` and `![[file.pdf#page=3]]`. | 4 ACs, 4 proven in a spike |
| FR-FMT-05 | Mindmaps are stored as fenced ` ```mermaid ` blocks using Mermaid `mindmap` syntax. | 3 ACs |
| FR-FMT-06 | Embedded queries are stored as a fenced code block (e.g. ` ```query `) with a readable YAML definition. In oth… | 3 ACs |
| FR-FMT-07 | Round-trip safety: opening and saving a file without edits must not change it, byte for byte. Markdown the edi… | 7 ACs, 5 proven in a spike |
| FR-FMT-08 | The file name is the object title, sanitized to be valid on macOS/Windows/iOS/Android (D-36). If the title con… | 6 ACs, 1 proven in a spike |
| FR-FMT-09 | Daily note file names follow a configurable date format (default `YYYY-MM-DD.md`). | 2 ACs |
| FR-FMT-10 | Tags are stored Obsidian-compatibly on the tagged object: a `tags:` list in frontmatter and/or inline `#tag` i… | 4 ACs, 3 proven in a spike |
| FR-FMT-11 | Dates without time are stored as `YYYY-MM-DD` (no time, no timezone), so they never shift a day across timezon… | 4 ACs, 3 proven in a spike |
| FR-FMT-12 | Unicode normalization: file names and link targets are written and compared in Unicode NFC, so names with diac… | 4 ACs, 2 proven in a spike |
| FR-STO-01 | All user content lives in one vault folder chosen by the user; the app may create sub-folders. | 6 ACs |
| FR-STO-02 | Each object is stored as one `.md` file (UTF-8, LF line endings). | 2 ACs, 2 proven in a spike |
| FR-STO-03 | The app places each object in a folder named after its type (D-13), e.g. `Pages/`, `Books/`, `Tasks/`, `Meetin… | 6 ACs |
| FR-STO-04 | When an object's type changes, the app moves the file to the new type's folder and keeps all links working. | 3 ACs |
| FR-STO-05 | Attachments (images, PDFs) are stored in a vault attachments folder (default `_attachments/`, configurable). N… | 6 ACs |
| FR-STO-06 | Type definitions, templates, saved queries and vault settings are stored inside the vault as human-readable fi… | 6 ACs |
| FR-STO-07 | Machine-local data (search index, cache, window state, recent list, version history) is stored outside the vau… | 3 ACs |
| FR-STO-08 | Deleted objects go to an in-vault trash folder (`.trash/`, Obsidian-compatible). See FR-HIS. | 6 ACs |
| FR-STO-09 | Files that are not Markdown and not recognized attachments are left untouched and ignored. | 6 ACs |
| FR-SYN-02 | All writes are atomic (write temp file → rename), so a sync client never picks up a half-written file. | 5 ACs |
| FR-SYN-06 | Writes are minimized (no rewrite of untouched files, no timestamp churn) to reduce sync traffic and conflicts. | 4 ACs |
| FR-TYP-10 | A file in the vault with no `type` frontmatter (e.g. from Obsidian) is treated as type Page and is not rewritt… | 2 ACs |
| FR-TYP-15 | Reserved attribute keys: `id, type, title, description, aliases, tags, created, modified, source, review, icon… | 3 ACs |
| FR-VLT-01 | On first launch the user can create a new vault or open an existing folder (including one inside Dropbox/Googl… | 8 ACs |
| FR-VLT-02 | When creating a new vault the user chooses: Empty vault (system types only: Page, Task, Quick Note, Daily Note… | 5 ACs |
| NFR-POR-01 | A vault created by the app opens in Obsidian with content, links, embeds, images, attributes and mindmaps (as … | 2 ACs |
| NFR-POR-02 | File names are valid on macOS, Windows, iOS and Android (no `: \ / * ? " < > \|`, length ≤ 200 UTF-8 bytes, D-… | 3 ACs |
| NFR-POR-03 | No information required to understand a note is stored only in the index. | 1 ACs |
| NFR-REL-01 | Zero data loss: crash, force quit or power loss must never corrupt or truncate a note (atomic writes; FR-SYN-0… | 5 ACs |
| NFR-REL-03 | Corrupt/invalid frontmatter in a file does not crash the app. The file opens in source mode with a warning. | 2 ACs, 1 proven in a spike |

### MS2: Index, watcher, search, switcher

18 requirements · 12 with ACs · 0 with spike evidence · 0 implemented

| Requirement | Summary | ACs / evidence |
| --- | --- | --- |
| AR-01 | Files are the source of truth. The index is a disposable cache; deleting it and rebuilding it gives the same s… | 3 ACs |
| FR-NAV-01 | Quick switcher (⌘O): fuzzy search over titles and aliases, ranked by recency + match quality, results in < 100… | no ACs yet |
| FR-SRC-01 | Full-text search across titles, body text and attribute values of all objects, with results < 200 ms for 5,000… | no ACs yet |
| FR-SRC-02 | Filters: object type, tags, date created/modified, attribute values, review status. | no ACs yet |
| FR-SRC-03 | Results show the type icon, title, and a highlighted snippet. Opening a result scrolls to the match. | no ACs yet |
| FR-SRC-04 | Supports phrase ("…") and exclusion (-word) operators; tolerant of diacritics (e.g. *č* matches *c*) and typos… | no ACs yet |
| FR-SYN-03 | A file watcher detects external changes (sync, other editors, Obsidian) and reloads the index within 2 s. If t… | 7 ACs |
| FR-SYN-04 | Detects provider conflict copies (e.g. `Note (conflicted copy 2026-10-07).md`, `Note (1).md`), lists them in a… | 4 ACs |
| FR-SYN-05 | Duplicate `id`s (e.g. from conflict copies) are detected and resolved without corrupting links. | 4 ACs |
| FR-SYN-07 | The app works fully offline. | 3 ACs |
| FR-UX-07 | Non-blocking progress for long operations (indexing, import, schema change) with cancel where safe. | no ACs yet |
| FR-VLT-03 | The app warns if the vault folder contains online-only / cloud placeholder files (Dropbox Smart Sync, Google D… | 2 ACs |
| NFR-PERF-01 | Cold start to usable UI | 1 ACs |
| NFR-PERF-02 | Initial full index of a new vault | 2 ACs |
| NFR-PERF-03 | Quick switcher results | 2 ACs |
| NFR-PERF-04 | Full-text search | 1 ACs |
| NFR-PERF-08 | External file change reflected | 1 ACs |
| NFR-REL-02 | The app never silently overwrites changes made outside the app (FR-SYN-03). | 7 ACs |

### MS3: Types, attributes, editor

Delivered in slices 3A–3E (D-115); the requirement for each slice is in `docs/plans/ms3-implementation-plan.md` §3.

37 requirements · 6 with ACs · 0 with spike evidence · 0 implemented

| Requirement | Summary | ACs / evidence |
| --- | --- | --- |
| AR-07 | Schema/type definitions are versioned so future migrations are possible. | no ACs yet |
| FR-EDT-01 | Block-based WYSIWYG editor. Each block has a drag handle, can be reordered by drag & drop or keyboard, and has… | no ACs yet |
| FR-EDT-02 | Block types: paragraph, heading 1–3, bulleted list, numbered list, checklist item (plain checkbox; see FR-TSK-… | no ACs yet |
| FR-EDT-03 | Slash menu (`/`) to insert any block type, object embed, or query. | no ACs yet |
| FR-EDT-04 | Markdown shortcuts while typing (`#`, `-`, `1.`, `[]`, `>`, ```` ``` ````, `bold`, etc.). | no ACs yet |
| FR-EDT-05 | Inline formatting: bold, italic, strikethrough, inline code, highlight, link; a floating toolbar on text selec… | no ACs yet |
| FR-EDT-06 | Typing `[[` opens link autocomplete across all objects (fuzzy match, type icon shown). Choosing a name that do… | no ACs yet |
| FR-EDT-07 | Attribute panel at the top of each object, showing the type's attributes as editable fields (not raw YAML). Mi… | no ACs yet |
| FR-EDT-08 | Autosave (debounced, ≤ 1 s after the last keystroke) using atomic writes (FR-SYN-02). No "Save" button. | 3 ACs |
| FR-EDT-09 | Undo/redo across block operations, including block-to-object conversion (FR-CNV-06). | no ACs yet |
| FR-EDT-10 | Raw Markdown source view toggle per note, for power users and debugging. | no ACs yet |
| FR-NAV-03 | Back/forward navigation history (⌘[ / ⌘]). | ACs in app-shell.md (3B.1, D-165) |
| FR-EDT-13 | Multi-block selection (Shift+click, Shift+arrows) for move, delete, convert, and copy. | no ACs yet |
| FR-EDT-14 | Paste handling: rich text/HTML from the web → clean blocks; images from the clipboard → saved attachment; URL … | no ACs yet |
| FR-EDT-15 | Typing `#` opens tag autocomplete (existing tags shown with their color). Choosing a new name creates a new ta… | no ACs yet |
| FR-SET-02 | Appearance: light / dark / system theme, font family & size, editor width (narrow/wide), accent color. | no ACs yet |
| FR-SET-03 | Date/time format, first day of week. UI language: English in v1 (NFR-OTH-02). | no ACs yet |
| FR-TYP-01 | The user can create, edit, and delete user-defined object types. Each type has: name, plural name, icon, color… | no ACs yet |
| FR-TYP-02 | Supported attribute types: Text, Long text, Number, Checkbox, Date, Date-time, Date range (start + end, e.g. t… | no ACs yet |
| FR-TYP-03 | Each attribute can have: name, key (frontmatter key), type, default value, required flag, options (for selects… | no ACs yet |
| FR-TYP-04 | Schema changes propagate: renaming an attribute key rewrites the frontmatter of all objects of that type (with… | 3 ACs |
| FR-TYP-05 | Deleting a type requires choosing a target type for its existing objects (or moving them to trash). | no ACs yet |
| FR-TYP-06 | System types (cannot be deleted; built-in attributes cannot be renamed, retyped or removed): Page (generic not… | no ACs yet |
| FR-TYP-07 | Every object can have its type changed after creation. Matching attributes are kept, and non-matching ones are… | 3 ACs |
| FR-TYP-08 | Universal attributes available on all types: title, description (short summary), aliases (alternative names us… | no ACs yet |
| FR-TYP-09 | Each type has an automatically generated Type page (like Capacities): a list/table of all objects of that type… | no ACs yet |
| FR-TYP-11 | Each type defines its preview attributes (up to ~4 attributes shown as a compact strip in previews and embed c… | no ACs yet |
| FR-TYP-12 | Review workflow setting per type (on/off, D-30). When on, new objects of that type get `review: unreviewed` an… | no ACs yet |
| FR-TYP-13 | Every object has exactly one type (D-24); the type can be changed at any time (FR-TYP-07). | no ACs yet |
| FR-TYP-17 | Hidden properties: per type, chosen properties are moved off the attribute panel into Other properties (D-316). | ACs in types.md (D-316) |
| FR-TYP-14 | Removed (D-217): no object icon or cover; the type icon is shown | not in scope (W) |
| FR-UX-01 | Visual style: modern, minimal, spacious. Generous whitespace, one readable content column, restrained color (t… | no ACs yet |
| FR-UX-02 | Layout: left sidebar (navigation), center editor, optional right panel (attributes/backlinks/graph/outline). B… | no ACs yet |
| FR-UX-03 | Keyboard-first: every action is reachable without the mouse (command palette + shortcuts). | no ACs yet |
| FR-UX-05 | Light and dark themes with equal quality. | no ACs yet |
| FR-VLT-02 | When creating a new vault the user chooses: Empty vault (system types only: Page, Task, Quick Note, Daily Note… | 5 ACs |
| NFR-OTH-02 | UI language: English in v1, with all UI strings externalized so other languages (e.g. Czech) can be added late… | no ACs yet |
| NFR-PERF-05 | Open a note (typical, < 5k words) | 1 ACs |
| NFR-PERF-06 | Typing latency | 2 ACs |

### MS4: Links, tags, renames, daily notes

26 requirements (D-370, D-372 moved 4 to v1.0) · 8 with ACs · 2 with spike evidence · 0 implemented

| Requirement | Summary | ACs / evidence |
| --- | --- | --- |
| FR-DLY-01 | One Daily Note per calendar date; open "Today" with one click/shortcut. | no ACs yet |
| FR-DLY-02 | The Daily Note is virtual until the user types in it. No empty files are created. | no ACs yet |
| FR-DLY-03 | Navigation: previous/next day and a calendar date picker (days with notes are marked). | no ACs yet |
| FR-DLY-04 | The Daily Note shows auto-generated context sections (live queries, not saved into the body unless the templat… | no ACs yet |
| FR-DLY-05 | Daily notes have a review status (`unreviewed` by default once created) and appear in the Inbox until reviewed… | no ACs yet |
| FR-DLY-06 | A daily-note template is applied when the note is first written. | no ACs yet |
| FR-DLY-08 | Date mentions: typing `@` + a date (or picking one from a date picker; `@today`, `@tomorrow`) inserts a link t… | 3 ACs |
| FR-EMB-01 | Any object (or block of it) can be embedded in any note via `![[ ]]`, the slash menu, or drag from the sidebar… | no ACs yet |
| FR-EMB-02 | Embed display modes: full (inline editable content), card (title + key attributes), link (inline chip). Defaul… | no ACs yet |
| FR-EMB-04 | Recursive embeds are detected and stopped (show "circular embed"). Maximum nesting depth is 3. | no ACs yet |
| FR-FMT-08 | The file name is the object title, sanitized to be valid on macOS/Windows/iOS/Android (D-36). If the title con… | 6 ACs, 1 proven in a spike |
| FR-HIS-04 | Bulk operations (schema rename, import, type change of many objects) create a restore point first. | 1 ACs |
| FR-LNK-01 | Backlinks panel for each object: every object linking to it, with the surrounding text, grouped by type. | no ACs yet |
| FR-LNK-02 | Links from relation attributes and embeds count as links (shown with their attribute name). | no ACs yet |
| FR-LNK-03 | Renaming or moving an object updates all links (FR-FMT-08). | 6 ACs, 1 proven in a spike |
| FR-LNK-04 | Broken links are visually marked; clicking one offers to create the object. | 3 ACs |
| FR-LNK-07 | Links and embeds look clearly different. A *link* is an inline text chip (object/type icon + title, link color… | no ACs yet |
| FR-LNK-14 | Duplicate titles are allowed (even within one type, e.g. several job applications called "Senior Product Manag… | 5 ACs |
| FR-TAG-01 | Tag is a system type. Each tag is an object with an editable name and color, an optional description, and any … | no ACs yet |
| FR-TAG-02 | Storage: applying a tag writes its name to the object's `tags:` frontmatter list (inline `#tag` in the body co… | no ACs yet |
| FR-TAG-03 | A Tag object file is created when the user creates the tag in the app or edits its color/description. Tags tha… | no ACs yet |
| FR-TAG-04 | Rename a tag: renames the Tag file and rewrites the `tags:` values and inline `#tags` in every object that use… | 3 ACs |
| FR-TAG-06 | Tag page: opening a tag shows its description and all objects with that tag (a query view, groupable by type). | no ACs yet |
| FR-TAG-07 | Tags appear in the sidebar (with colors and counts), in search filters (FR-SRC-02) and in the query builder ("… | no ACs yet; query-builder part v1.0 (D-275) |
| FR-TAG-08 | Delete a tag: asks whether to remove it from all objects (rewrite, with restore point) or only delete the Tag … | no ACs yet |
| NFR-REL-04 | All destructive bulk operations are preceded by a restore point (FR-HIS-04). | 3 ACs |

### MS5: Tasks, capture, inbox, mindmaps

37 requirements (D-371, D-376 moved 4 to v1.0; D-515 moved FR-HOM-01; D-377 added FR-MMP-01, -02, -04; D-378 kept FR-TSK-05) · 1 with ACs · 0 with spike evidence · 0 implemented

| Requirement | Summary | ACs / evidence |
| --- | --- | --- |
| FR-CAP-01 | Menu bar icon opens a small capture window: a text field (Markdown supported), a type selector (preselected: t… | no ACs yet |
| FR-CAP-03 | Capture must work when the main window is closed, and must take < 300 ms from click to typing. | no ACs yet |
| FR-CAP-04 | Captured objects are always created with `review: unreviewed` and a `captured` timestamp, so they land in the … | no ACs yet |
| FR-CAP-05 | Global hotkeys (work from any app; configurable; D-14): *Quick Capture* (default ⌃⌥Space) opens the capture wi… | no ACs yet |
| FR-CNV-01 | Any block, or selection of blocks, can be converted into an object of any type via the block menu, the slash c… | no ACs yet |
| FR-CNV-02 | The first line becomes the new object's title (editable in the conversion popover). The remaining selected blo… | no ACs yet |
| FR-CNV-03 | The new object is saved as its own `.md` file in its type folder. The original blocks are replaced in the sour… | no ACs yet |
| FR-CNV-04 | The new object automatically gets `source: "[[Source Note]]"`. From the object, the user can jump back to the … | no ACs yet |
| FR-CNV-05 | The embed in the source is editable in place: editing it edits the object's file, and changing a task's status… | no ACs yet |
| FR-CNV-06 | Conversion is a single undoable action that restores the original blocks and deletes the new file. | no ACs yet |
| FR-CNV-08 | Removing the embed from the source note does not delete the object (D-27). The first time, the app asks for co… | no ACs yet |
| FR-EMB-03 | Embedded content is editable in place (FR-CNV-05). | no ACs yet |
| FR-INB-01 | Inbox view lists all objects with `review: unreviewed`: Quick Notes, Daily Notes, captured items, and objects … | no ACs yet |
| FR-INB-02 | Inbox actions per item (keyboard-first): mark reviewed, convert to type (changes the type and moves the file),… | no ACs yet |
| FR-INB-03 | Review status is an attribute (`review: unreviewed \| reviewed`). It is mandatory on Quick Notes and Daily Not… | no ACs yet |
| FR-INB-04 | Converting a Quick Note to another type keeps its content, `id`, and links. | no ACs yet |
| FR-NAV-02 | Command palette (⌘K / ⌘⇧P): every app action is searchable and runnable by keyboard. | no ACs yet |
| FR-NAV-04 | Left sidebar: Home, Inbox, Today, Tasks, Search, Types (list of all types → Type pages), Pinned, Saved queries… | no ACs yet |
| FR-NAV-05 | Right side panel (toggleable): Attributes, Backlinks, Local graph, Outline. | no ACs yet |
| FR-SET-01 | Vault location; attachments folder; daily note folder & date format; default type for new notes (FR-VLT-05). | no ACs yet |
| FR-SET-05 | Menu bar icon on/off; launch at login. | no ACs yet |
| FR-TSK-01 | Task attributes: title, status, priority, due date, recurrence, source (relation), completed date (auto), plus… | no ACs yet |
| FR-TSK-02 | Status: each status has a user-editable label and color and maps to one fixed semantic state: *Open*, *In prog… | no ACs yet |
| FR-TSK-03 | Priority: an ordered list with user-editable labels and colors (default: High, Medium, Low, None). The order d… | no ACs yet |
| FR-TSK-04 | Task views (from the sidebar): *Today* (due today + overdue), *Upcoming*, *All open*, *By source*, *Done*. Eac… | no ACs yet |
| FR-TSK-05 | Board view (Kanban) grouped by status (or by any select attribute). Dragging a card between columns changes th… | no ACs yet; back in MS5 by D-378 (status or tag columns) |
| FR-TSK-08 | Every task in any view shows its source note as a clickable chip. Click previews the source; double-click open… | no ACs yet |
| FR-TSK-09 | Overdue tasks are visually highlighted. | no ACs yet |
| FR-TSK-10 | Tasks can be created directly in Task views (quick-add row) without a source note, or from any app via the glo… | no ACs yet |
| FR-TSK-11 | A plain Markdown checklist item (`- [ ]`) is not a Task object and does not appear in Task views (D-28). The u… | no ACs yet |
| FR-VLT-05 | Default type for new notes, set per vault (default: *Quick Note*, D-24). It is preselected for ⌘N, in Quick Ca… | no ACs yet |
| NFR-PERF-10 | Quick Capture window open | 1 ACs |
| NFR-SEC-03 | The share extension and capture window only write to the vault; they never read content back to other apps. | no ACs yet |
| FR-MMP-01 | A mindmap block can be inserted into any note; it is stored as a Mermaid `mindmap` code block. | no ACs yet (slice MM, D-377) |
| FR-MMP-02 | Visual editing (D-36): add child/sibling node with Tab/Enter, edit text inline, drag to re-parent, collapse br… | no ACs yet; render + outline editing in the MVP, drag/collapse/zoom/pan v1.0 (D-377) |
| FR-MMP-04 | Per object type, the mindmap block can be included by default via the template ("optional per type"). | no ACs yet (slice MM, D-377) |

### MS6: Images, PDFs, trash

7 requirements (D-376 moved 3 to v1.0) · 3 with ACs · 0 with spike evidence · 0 implemented

| Requirement | Summary | ACs / evidence |
| --- | --- | --- |
| FR-ATT-01 | Add images via paste, drag & drop, file picker, capture/share sheet. Formats: PNG, JPG, GIF, WebP, HEIC (conve… | no ACs yet |
| FR-ATT-02 | Add PDFs the same way; display as an inline viewer or a link card. | no ACs yet |
| FR-ATT-07 | Images and PDFs are objects (D-42). Adding an image or PDF (paste, drag & drop, picker, capture, share sheet, … | 4 ACs |
| FR-ATT-08 | The Image/PDF object's title defaults to the file name (or the owning note's title + number for generic names … | no ACs yet |
| FR-HIS-01 | Deleting an object moves it to `.trash/` (with its original path remembered). The Trash view allows restore (b… | no ACs yet |
| FR-STO-05 | Attachments (images, PDFs) are stored in a vault attachments folder (default `_attachments/`, configurable). N… | 6 ACs |
| FR-STO-08 | Deleted objects go to an in-vault trash folder (`.trash/`, Obsidian-compatible). See FR-HIS. | 6 ACs |

### MS7: Capacities importer

17 requirements (D-373 moved 2 to v1.0; starts after the daily-use point, D-375) · 15 with ACs · 0 with spike evidence · 0 implemented

| Requirement | Summary | ACs / evidence |
| --- | --- | --- |
| FR-IMP-03 | Capacities export (Markdown): one folder per object type with a `type:` key and typed frontmatter → types and … | no ACs yet |
| FR-IMP-05 | Every import shows a preview (counts per type, unresolved links, unsupported content) before writing, creates … | 4 ACs |
| FR-IMP-07 | Input: a zip archive or an extracted folder. Zips with non-ASCII file names (Czech diacritics, emoji, `?` in t… | 4 ACs |
| FR-IMP-08 | Type, attribute and value mapping (in the import preview): source types map to existing types, system types (T… | 5 ACs |
| FR-IMP-09 | Date parsing: ISO date-times; UTC-midnight date-times converted to date-only (FR-FMT-11); localized strings ("… | 4 ACs |
| FR-IMP-10 | Link rewriting: all link forms become wikilinks resolved by source file/ID, not title alone: `[[Title]]`; Mark… | 6 ACs |
| FR-IMP-11 | Titles: the title comes from the source's `title:` (Capacities) or the H1 heading (Notion), never from the fil… | 3 ACs |
| FR-IMP-14 | Media: Capacities media objects (`Images/*.md` + `Images/Media/*`, `PDFs/*.md` + `PDFs/Media/*`) become Tegg I… | 6 ACs |
| FR-IMP-15 | Preserved metadata: original created/modified timestamps (`createdAt`, `lastUpdated`, `Created on`), not the i… | 5 ACs |
| FR-IMP-16 | Queries and views: Capacities Query objects and Notion database views are exported without their definitions. … | 2 ACs |
| FR-IMP-17 | Clean-up: remove invisible characters (zero-width spaces U+200B, BOMs), normalize Unicode (NFC) and line endin… | 3 ACs |
| FR-IMP-19 | Import report saved as a Page in the vault: counts per type, unresolved links with their location, renamed att… | 4 ACs |
| FR-IMP-20 | Re-import: in the MVP an import is one-time (D-49). If the vault already contains objects with the same `impor… | 1 ACs |
| FR-IMP-21 | Capacities tags: tag collections (exported as header-only CSVs) → tags (colors aren't in the export and must b… | 3 ACs |
| FR-IMP-22 | Capacities spaces: the user selects one space per import run (D-44). Other spaces in the same export can be im… | 3 ACs |
| FR-IMP-23 | Test data (D-50): (1) synthetic fixtures: small hand-written Capacities and Notion exports, committed to the r… | no ACs yet |
| FR-IMP-24 | Capacities weblinks (no Weblink type in Tegg, D-43) → objects of a type chosen in the mapping (default: Page) … | 2 ACs |

### MS8: MVP hardening & release

16 requirements (D-374 moved 1 to v1.0) · 11 with ACs · 0 with spike evidence · 0 implemented

| Requirement | Summary | ACs / evidence |
| --- | --- | --- |
| AR-02 | Native Apple Silicon (arm64) build. Universal binary for Intel: ❓ (C). | no ACs yet |
| AR-08 | Code-signed and notarized macOS build, distributed as a direct-download DMG (not the Mac App Store in v1; D-32… | no ACs yet |
| FR-SYN-01 | The app works on a vault placed in any synced folder, including Dropbox, Google Drive and iCloud Drive (D-36),… | 3 ACs |
| FR-UX-06 | Empty states that guide the user (empty inbox, new type with no objects, no backlinks). | no ACs yet |
| NFR-OTH-01 | Minimum macOS version: macOS 14 Sonoma (D-32). | no ACs yet |
| NFR-PERF-01 | Cold start to usable UI | 1 ACs |
| NFR-PERF-02 | Initial full index of a new vault | 2 ACs |
| NFR-PERF-03 | Quick switcher results | 2 ACs |
| NFR-PERF-04 | Full-text search | 1 ACs |
| NFR-PERF-05 | Open a note (typical, < 5k words) | 1 ACs |
| NFR-PERF-06 | Typing latency | 2 ACs |
| NFR-PERF-07 | Query view with 1,000 results | 1 ACs |
| NFR-PERF-08 | External file change reflected | 1 ACs |
| NFR-PERF-09 | Memory use (idle, vault open) | 1 ACs |
| NFR-PERF-10 | Quick Capture window open | 1 ACs |
| NFR-SEC-01 | No telemetry, analytics or network calls in v1, except optional update checks (opt-in). | no ACs yet |

## 2. Requirements added to MVP milestones by D-85 and D-86

Found by the first run of this check: needed by the MVP but owned by no milestone. Now in §11.2 and listed in the milestone tables above.

| Requirement | Pri | Summary | Reason | Milestone |
| --- | --- | --- | --- | --- |
| FR-VLT-05 | M | Default type for new notes, set per vault (default: *Quick Note*, D-24). It is preselected for ⌘N, in Quick Ca… | §11 MVP lists "default type"; capture (MS5) and ⌘N need it | MS5 |
| FR-EMB-01 | M | Any object (or block of it) can be embedded in any note via `![[ ]]`, the slash menu, or drag from the sidebar… | Converted blocks become embeds (FR-CNV-05, MS5) and images are embedded (FR-ATT-07, MS6); §11 doesn't name embeds | MS4 |
| FR-EMB-02 | M | Embed display modes: full (inline editable content), card (title + key attributes), link (inline chip). Defaul… | as FR-EMB-01 | MS4 |
| FR-EMB-03 | M | Embedded content is editable in place (FR-CNV-05). | Full mode is editable in place (D-273); note embeds in MS4 (D-415), FR-CNV-05 stays MS5 | MS4 |
| FR-EMB-04 | M | Recursive embeds are detected and stopped (show "circular embed"). Maximum nesting depth is 3. | as FR-EMB-01 | MS4 |
| FR-SET-01 | M | Vault location; attachments folder; daily note folder & date format; default type for new notes (FR-VLT-05). | Default type and folders must be settable in the MVP | MS5 |
| FR-SET-02 | M | Appearance: light / dark / system theme, font family & size, editor width (narrow/wide), accent color. | Theme (FR-UX-05); font, size, width and accent → v1.0 (D-565) | MS3 |
| FR-SET-03 | M | Date/time format, first day of week. UI language: English in v1 (NFR-OTH-02). | Date formats are shown from MS3 | MS3 |
| FR-SET-05 | M | Menu bar icon on/off; launch at login. | Menu bar on/off, launch at login | MS5 |
| FR-UX-01 | M | Visual style: modern, minimal, spacious. Generous whitespace, one readable content column, restrained color (t… | Cross-cutting UI rule; no milestone checks it | MS3 |
| FR-UX-02 | M | Layout: left sidebar (navigation), center editor, optional right panel (attributes/backlinks/graph/outline). B… | App layout (sidebar, editor, right panel) | MS3 |
| FR-UX-03 | M | Keyboard-first: every action is reachable without the mouse (command palette + shortcuts). | Command palette: CLAUDE.md requires every action in it, but no milestone builds it | MS3 |
| FR-UX-04 | M | Responsive layout that scales down to tablet/phone widths (prepares for mobile, D-02). Touch targets ≥ 44 pt i… | Responsive layout | MS8 → v1.0 (D-374) |
| FR-UX-05 | M | Light and dark themes with equal quality. | Light/dark | MS3 |
| FR-UX-06 | M | Empty states that guide the user (empty inbox, new type with no objects, no backlinks). | Empty states | MS8 |
| FR-UX-07 | M | Non-blocking progress for long operations (indexing, import, schema change) with cancel where safe. | Progress + cancel: indexing (MS2), bulk ops (MS4), import (MS7) | MS2 |
| AR-02 | M | Native Apple Silicon (arm64) build. Universal binary for Intel: ❓ (C). | arm64 build | MS8 |
| AR-03 | M | Clear separation: core (vault I/O, parsing, index, query engine, sync adapters), UI, platform (menu bar, share… | Core/UI/platform separation, L0 dependency check | MS1 |
| AR-04 | M | Sync adapter interface, so Phase 2 API sync (FR-SYN-20) plugs in without changing the core. | Sync adapter seam | MS1 |
| AR-06 | M | Markdown parsing/serialization is covered by a round-trip test suite (corpus incl. Obsidian, Notion, Capacitie… | Round-trip suite (exists from S1) | MS1 |
| AR-07 | M | Schema/type definitions are versioned so future migrations are possible. | Versioned type definitions | MS3 |
| NFR-REL-02 | NFR | The app never silently overwrites changes made outside the app (FR-SYN-03). | Same rule as FR-SYN-03 (MS2) | MS2 |
| NFR-REL-04 | NFR | All destructive bulk operations are preceded by a restore point (FR-HIS-04). | Same rule as FR-HIS-04 (MS4) | MS4 |
| NFR-SEC-03 | NFR | The share extension and capture window only write to the vault; they never read content back to other apps. | Capture window part | MS5 |
| NFR-OTH-01 | NFR | Minimum macOS version: macOS 14 Sonoma (D-32). | macOS 14 minimum | MS8 |
| NFR-OTH-02 | NFR | UI language: English in v1, with all UI strings externalized so other languages (e.g. Czech) can be added late… | Externalized strings, L0 check | MS3 |
| FR-IMP-23 | M | Test data (D-50): (1) synthetic fixtures: small hand-written Capacities and Notion exports, committed to the r… | Importer test data (built in S5) | MS7 |
| FR-EDT-10 | S | Raw Markdown source view toggle per note, for power users and debugging. | NFR-REL-03 (MS1) opens invalid files "in source mode"; that needs at least a read-only source view | MS3 |
| FR-SET-04 | S | Keyboard shortcuts customization, including the global hotkeys (FR-CAP-05). | D-71: hotkey registration failures are shown in Settings (FR-CAP-05, MS5) | MS5 → v1.0 (D-376) |
| FR-SRC-04 | S | Supports phrase ("…") and exclusion (-word) operators; tolerant of diacritics (e.g. *č* matches *c*) and typos… | Diacritic folding already exists (S4); phrase/exclusion are cheap in FTS5 | MS2 |
| FR-HIS-02 | S | Trash is auto-emptied after N days (default 30, configurable). | Trash auto-empty belongs with trash (FR-HIS-01, MS6) | MS6 → v1.0 (D-376) |
| FR-EDT-11 | S | Outline (table of contents) of the current note's headings in the side panel. | FR-NAV-05 (MS5) puts the outline in the right panel | MS5 → v1.0 (D-376) |

## 3. Later phases

### v1.0 "complete desktop" (73)

| Requirement | Pri | Summary | Note |
| --- | --- | --- | --- |
| FR-TAG-09 | S | Merge two tags into one. | D-87 (AP-34) |
| FR-CNV-07 | S | The conversion popover lets the user set key attributes at once (e.g. for a Task: due date, priority) without … | D-87 (AP-34) |
| FR-CNV-09 | S | Bulk conversion: convert each selected list item into a separate object (e.g. 5 bullet points → 5 tasks). | D-87 (AP-34) |
| FR-TSK-07 | M | Recurrence: daily, weekdays, weekly (on chosen days), monthly (day of month / nth weekday), yearly, every N da… | Recurrence (§11) |
| FR-CAP-02 | M | macOS Share sheet extension accepts text, URLs, images and PDFs from any app and creates an object of the vaul… | Share-sheet extension (§11); needs its own small spike (S3 FINDINGS) |
| FR-DLY-09 | S | Time-stamped entries: a shortcut inserts the current time as a small heading or line (e.g. `21:30`) for log-st… | §11.1 table: time-stamped entries in v1.0 |
| FR-HOM-04 | S | The app restores the last open note/tabs on launch (configurable: Home vs last state). | D-87 (AP-34) |
| FR-NAV-06 | M | Tabs in v1: ⌘T new tab, ⌘W close, ⌘-click opens a link in a new tab, tabs are restored on launch. Split view i… | Tabs (§11); split view part v1.x |
| FR-NAV-07 | S | All primary actions have keyboard shortcuts; shortcuts are customizable. | D-87 (AP-34) |
| FR-NAV-08 | M | Previews of linked and embedded objects anywhere in the app: click to preview, double-click to open by default… | Object previews (§11) |
| FR-SRC-06 | S | A search can be saved as a query (FR-QRY). | Query builder and views (§11) |
| FR-LNK-06 | S | Links to a specific heading or block (`#^id`). Block IDs are generated automatically when the user copies a bl… | D-87 (AP-34) |
| FR-LNK-08 | M | Click to preview (D-37): a single click on a link shows a preview popover of the linked object. This works eve… | Object previews (§11) |
| FR-LNK-09 | M | Preview of embeds: a single click on an embed in *card* or *link* mode (FR-EMB-02), or on the header of a *ful… | Object previews (§11) |
| FR-LNK-10 | M | Preview content is content-first (D-38), so the user can see what the object is about: a header (own icon or t… | Object previews (§11) |
| FR-LNK-11 | M | Preview behaviour: the popover opens in < 100 ms, stays open until the user clicks outside it or presses Esc, … | Object previews (§11) |
| FR-LNK-12 | M | Global setting "Object preview" (D-37): *Click to preview, double-click to open* (default) · *Hover to preview… | Object previews (§11) |
| FR-LNK-13 | M | Editor interplay: because double-click on a link opens it, link text is edited via the keyboard (moving the cu… | Object previews (§11) |
| FR-GRP-01 | M | Local graph per object in the side panel and as a full view: the current object + linked objects up to depth N… | Local graph (§11) |
| FR-GRP-02 | M | Filter by object type: a filter panel with a checkbox per type, "all / none", and saved filter presets shows o… | Local graph (§11) |
| FR-GRP-03 | M | Click a node selects it, highlights its neighbours and shows the preview (FR-GRP-06); double-click opens the o… | Local graph (§11) |
| FR-GRP-05 | M | Object icons in nodes: each node shows the object's own icon (FR-TYP-14), otherwise its type icon, with the no… | Local graph (§11) |
| FR-GRP-06 | M | Smart preview in the graph: clicking a node shows the same content-first preview as FR-LNK-10, so the user can… | Local graph (§11) |
| FR-GRP-07 | S | Node size can optionally reflect the number of links (more connected = bigger). | Local graph (§11) |
| FR-GRP-08 | M | Tags appear as nodes in their tag color (type *Tag*) and can be shown or hidden with the type filter (FR-GRP-0… | Local graph (§11) |
| FR-EMB-05 | M | Images and PDFs are embedded with resize; PDF embeds show an inline viewer with page navigation. | PDF inline viewer (§11); image resize part could be MVP (FR-ATT, MS6) |
| FR-QRY-01 | M | Visual query builder: choose source type(s) (one, several, or all), then add filters (attribute + operator + v… | Query builder and views (§11) |
| FR-QRY-02 | M | Operators per attribute type: is/is not, contains, is empty/not empty, before/after/between, relative dates (t… | Query builder and views (§11) |
| FR-QRY-03 | M | Context-aware filters: "links to *this note*", "source is *this note*", "created on *this daily note's date*".… | Query builder and views (§11) |
| FR-QRY-04 | M | Cross-type queries through relations, one level deep: e.g. *Tasks whose source is a Meeting where attendees co… | Query builder and views (§11) |
| FR-QRY-05 | M | Views: Table (editable cells write to frontmatter), List, Board (group by select), Calendar (by any date attri… | Query builder and views (§11) |
| FR-QRY-06 | M | Queries can be embedded in any note as a block (FR-FMT-06), or saved as a named query shown in the sidebar/Hom… | Query builder and views (§11) |
| FR-QRY-07 | M | Each type has default views (FR-TYP-09); users can add more views per type (e.g. Books: "Currently reading" bo… | Query builder and views (§11) |
| FR-QRY-08 | S | Creating an object from within a query view pre-fills the attributes that match the filters (e.g. a new card i… | Query builder and views (§11) |
| FR-QRY-09 | M | Query results update live when files change (including external edits). | Query builder and views (§11) |
| FR-MMP-03 | S | Mindmap nodes may contain `[[links]]`. A node can be converted into an object (like FR-CNV). | Mindmap editor (§11) |
| FR-MMP-05 | M | Exports render the mindmap as an image (FR-EXP). | Mindmap editor (§11) |
| FR-ATT-04 | S | Deleting the last reference to an attachment does not delete the file; an "Unused attachments" tool lists orph… | D-87 (AP-34) |
| FR-ATT-05 | S | Warn on files > 20 MB (configurable). | D-87 (AP-34) |
| FR-TPL-01 | M | Each type can have multiple templates, one marked default. A template is a `.md` file in `_templates/<Type>/`. | Templates (§11) |
| FR-TPL-02 | M | A template defines attribute default values and body structure (any blocks, including mindmap and query blocks… | Templates (§11) |
| FR-TPL-03 | M | Variables: `{{title}}`, `{{date}}`, `{{time}}`, `{{date:FORMAT}}`, `{{yesterday}}`, `{{tomorrow}}`. | Templates (§11) |
| FR-TPL-04 | M | Query blocks in templates may use "this note" context (FR-QRY-03), e.g. the Meeting template contains "Tasks f… | Templates (§11) |
| FR-TPL-05 | M | Templates are applied only at creation. Editing a template does not change existing notes. | Templates (§11) |
| FR-TPL-06 | M | When creating an object, the user can pick a non-default template (picker shown when > 1 template). | Templates (§11) |
| FR-TPL-07 | M | Template files are excluded from search, queries and graph. | Templates (§11) |
| FR-TPL-08 | C | Prompting for values in a form at creation. | Templates (§11) |
| FR-HIS-03 | M | Version history: snapshots of each note are taken automatically (at most every 5 minutes while editing, plus b… | Version history (§11) |
| FR-IMP-18 | S | Option to convert imported checklist items (`- [ ]`) into Task objects (default: keep them as checklists, D-28… | §11.1 table: checklist → Task option in v1.0 |
| FR-EXP-01 | M | Export a single note, a selection, a query result, or a note with its embeds/links up to depth N. | Export, all 4 formats (§11) |
| FR-EXP-02 | M | Formats: PDF, HTML (single file, or a static linked site for multi-note export), DOCX, Markdown bundle (.zip) … | Export, all 4 formats (§11) |
| FR-EXP-03 | M | On export, embeds are inlined, Mermaid mindmaps rendered as images, and query blocks rendered as static tables… | Export, all 4 formats (§11) |
| FR-EXP-04 | S | Option to include/exclude the attribute block in exports. | Export, all 4 formats (§11) |
| FR-EXP-05 | S | PDF: page size (A4/Letter), light theme, page breaks before H1 (optional). | Export, all 4 formats (§11) |
| FR-EXP-06 | M | Whole-vault export is lossless: a Markdown bundle of the whole vault includes type definitions, saved-query de… | Export, all 4 formats (§11) |
| FR-SET-06 | S | Trash retention (default 30 days), version history retention (default 90 days). | Retention settings, with version history |
| FR-SET-07 | M | Object preview mode: click / hover / off (FR-LNK-12). | Object previews (§11) |
| FR-UX-08 | S | Accessibility: VoiceOver labels on controls, sufficient contrast (WCAG AA), respects "Reduce motion". | D-87 (AP-34) |
| FR-TAG-05 | M | The tag color is used wherever the tag appears: tag chips in the attribute panel, inline `#tags`, query views,… | D-370: tag colour to v1.0 |
| FR-STO-04 | M | When an object's type changes, the app moves the file to the new type's folder and keeps all links working. | D-372: type moves to v1.0 |
| FR-TYP-04 | M | Schema changes propagate: renaming an attribute key rewrites the frontmatter of all objects of that type (with… | D-372: schema rewrites to v1.0 |
| FR-TYP-07 | M | Every object can have its type changed after creation. Matching attributes are kept, and non-matching ones are… | D-372: the file-move part to v1.0; the type change itself stays MS3 (D-224) |
| FR-TSK-06 | M | Calendar view (month/week) by due date. Dragging a task to another day changes its due date. Tasks without a d… | D-371: calendar after the daily-use point (5C or v1.0) |
| FR-HOM-02 | M | Pinned objects and saved queries can be added to Home and the sidebar. | D-376: with saved queries |
| FR-HOM-01 | M | Home is the default start screen and shows: Today (daily note link + tasks due/overdue), Inbox count, Recently… | D-515: Home out of the MVP |
| FR-EDT-11 | S | Outline (table of contents) of the current note's headings in the side panel. | D-376 |
| FR-SET-04 | S | Keyboard shortcuts customization, including the global hotkeys (FR-CAP-05). | D-376: the D-71 hotkey-failure display stays in MS5 with FR-CAP-05 |
| FR-ATT-03 | M | Image resize (stored as `\|width`), alignment, caption (stored as alt text), click to open full-size. | D-376 |
| FR-ATT-09 | M | Deleting a note never deletes the Image/PDF objects it uses. The "Unused attachments" tool (FR-ATT-04) lists I… | D-376 |
| FR-HIS-02 | S | Trash is auto-emptied after N days (default 30, configurable). | D-376 |
| FR-IMP-01 | M | Obsidian vault: the user chooses to open it in place (files aren't rewritten until edited; untyped notes are t… | D-373: Obsidian import to v1.0 |
| FR-STO-10 | M | Opening a folder that is already an Obsidian vault works in place, with no conversion needed (D-36, FR-IMP-01)… | D-373: Obsidian import to v1.0 |
| FR-UX-04 | M | Responsive layout that scales down to tablet/phone widths (prepares for mobile, D-02). Touch targets ≥ 44 pt i… | D-374 |

### v1.x (9)

| Requirement | Pri | Summary | Note |
| --- | --- | --- | --- |
| FR-VLT-04 | C | Multiple vaults: single vault in v1; multiple vaults in v1.x (D-35). | Multiple vaults (§11) |
| FR-INB-05 | S | "Triage mode": step through unreviewed items one by one with single-key actions. | Triage mode (§11) |
| FR-HOM-03 | C | Home sections can be reordered, hidden, or added (any saved query as a widget). Fixed sections in v1; customiz… | Customizable Home (§11) |
| FR-LNK-05 | S | Unlinked mentions: text matching this object's title that is not yet linked, with one-click "link". | Unlinked mentions (§11) |
| FR-GRP-04 | C | Global vault graph in v1.x (D-35), with the same type filters, icons and previews as the local graph. | Global graph (§11) |
| FR-IMP-02 | — | Notion export (Markdown & CSV): pages → objects; databases → object types with attributes taken from the datab… | Notion import (§11) |
| FR-IMP-04 | — | Anytype export (Markdown export first; JSON/Protobuf evaluated later, see Risk R-06): types, relations → attri… | Anytype import (§11) |
| FR-IMP-12 | — | Notion properties: properties of database rows are read from the database CSV (UTF-8 with BOM) and matched to … | Notion detail. Priority says M, but its parent FR-IMP-02 is C (v1.x): inconsistent |
| FR-IMP-13 | — | Notion structure: each database → a type (single-column databases such as a glossary become simple types). Chi… | as FR-IMP-12 |

### v2: mobile and Phase 2 sync (3)

| Requirement | Pri | Summary | Note |
| --- | --- | --- | --- |
| FR-SYN-20 | — | Direct Dropbox and Google Drive API sync (OAuth), incremental, with the same conflict rules. | Phase 2 API sync |
| FR-SYN-21 | — | Desktop can use either folder sync or API sync. Mixing both on the same vault on one device is prevented. | Phase 2 API sync |
| FR-SYN-22 | — | iCloud Drive API/CloudKit sync for mobile. As a plain folder location it's already supported in v1 (FR-SYN-01)… | Phase 2 API sync |

### Public release track (1)

| Requirement | Pri | Summary | Note |
| --- | --- | --- | --- |
| FR-UX-09 | — | Onboarding: a short first-run tour + sample vault content. | Onboarding (public release track) |

### Architecture seams (built as interfaces in the MVP, no feature) (1)

| Requirement | Pri | Summary | Note |
| --- | --- | --- | --- |
| AR-05 | S | Extension points for AI (D-12): content access API over the index, an embedding store slot, and a command-pale… | AI extension points: seams only, built into the architecture (§10); "nothing implemented in v1" |

### Satisfied by design (1)

| Requirement | Pri | Summary | Note |
| --- | --- | --- | --- |
| NFR-SEC-02 | — | Files are stored unencrypted (plain Markdown). Vault/note encryption is out of scope; users rely on macOS File… | Satisfied by design: plain unencrypted files (MS1 file format) |

## 4. Won't (W)

| Requirement | Summary | Note |
| --- | --- | --- |
| FR-TYP-16 | Page hierarchy (parent/child pages): not supported (D-45). Links between pages cover the need. |  |
| FR-TAG-10 | Nested tags (`#parent/child`) are not supported (D-40). A tag containing `/` is treated as one plain tag name. |  |
| FR-TSK-12 | System notifications/reminders: out of v1 (D-34); later (C). |  |
| FR-TSK-13 | A separate scheduled/"do" date: not supported, tasks have only `due` (D-46). The Capacities importer maps `dea… | Not built, but the importer mapping rule in it is covered by FR-IMP-15 (MS7) |
| FR-CAP-06 | Browser web clipper: out of scope (D-34). |  |
| FR-CAP-07 | Weblink object type and fetching link metadata (title, preview image) from the internet: not needed (D-43). A … |  |
| FR-QRY-10 | Text query language. |  |
| FR-IMP-06 | Kindle / Readwise highlights import: out of scope (D-33). |  |

## 5. Backlog (unscheduled by decision, D-87)

Could requirements listed in BRD §11 as an explicit backlog.

| Requirement | Pri | Summary |
| --- | --- | --- |
| FR-TAG-11 | C | Collections (grouping objects or tags, e.g. PARA areas, Status): not in the MVP; possibly later as a new Colle… |
| FR-EDT-12 | C | Toggle/collapsible blocks. *(Note: there is no standard Markdown equivalent. Proposed storage: a heading or ca… |
| FR-DLY-07 | C | Weekly/monthly review notes. |
| FR-SRC-05 | C | Search inside PDF text. |
| FR-ATT-06 | C | Link to a PDF page; PDF annotation/highlight extraction. |

## 6. Daily-use re-plan (owner, 2026-10-16, D-370…D-377)

The owner starts daily use from an empty vault, so the Capacities importer and everything that reshapes existing data left the critical path. Moved from MVP milestones to v1.0: FR-TAG-05 (D-370), FR-STO-04, FR-TYP-04, the file-move part of FR-TYP-07 (D-372), FR-TSK-06 (D-371; the board FR-TSK-05 stays, D-378), FR-HOM-02, FR-EDT-11, FR-SET-04, FR-ATT-03, -09, FR-HIS-02 (D-376), FR-IMP-01, FR-STO-10 (D-373), FR-UX-04 (D-374), FR-HOM-01 (D-515, 2026-10-17). Moved in: FR-MMP-01, -02 (render + outline editing), -04 (D-377). Order of the remaining slices: `docs/plans/mvp-daily-use-plan.md` (D-375). The MS1–MS3 tables are unchanged; FR-TYP-07 stays in MS3 for the type change that writes only `type:`.

## 7. Other findings

- **Priority inconsistency:** FR-IMP-12 and FR-IMP-13 (Notion details) are priority M, while their parent FR-IMP-02 (Notion import) is C, v1.x (D-41). Proposed: mark them "M within FR-IMP-02 (v1.x)".
- **The MVP needs a basic query engine although the query builder is v1.0:** type pages with default views (FR-TYP-09, MS3), the task list and board (FR-TSK, MS5), Inbox and Home sections (MS5) all show filtered, sorted lists. `tegg-query` therefore starts in MS3/MS5 with fixed definitions; the visual builder and saved queries stay v1.0. NFR-PERF-07 (query view, MS8) measures that engine.
- **Architecture doc:** its milestone table (§12) labelled MS3, MS4 and MS6 differently from BRD §11.2; corrected together with this report.
- **Still open, not part of AP-32…AP-34:** the FR-IMP-12/-13 priority inconsistency above.
- **ACs for the remaining milestones:** MS3–MS6 have ACs for only 6/37, 11/30, 1/39, 3/10 of their requirements. That is the D-61 plan (ACs just before each milestone), and **MS1 has ACs for all 35 of its requirements** (FR-VLT-01, -02, AR-03, -04 added 2026-10-11; decisions D-89…D-92; AP-39 pending).

## 8. Decided points (accepted 2026-10-11, BRD v1.16)

| # | Issue | Decision |
| --- | --- | --- |
| AP-32 | 27 Must/NFR/AR requirements the MVP needs had no milestone | **D-85:** assigned in §11.2 (see §2) |
| AP-33 | 5 Should requirements are needed by MVP requirements | **D-86:** moved into MVP milestones (§2) |
| AP-34 | 14 Should/Could requirements were in no phase | **D-87:** Should → v1.0, Could → explicit backlog in §11 |
