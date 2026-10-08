# Business Requirements: Tegg, a Local-First Object Note-Taking App

|                     |                                                                     |
| ------------------- | ------------------------------------------------------------------- |
| **Document status** | Draft v1.6, for review                                              |
| **Date**            | 2026-10-07                                                          |
| **Source**          | `initial requirements.md` + clarification session (decisions in §3) |
| **Working name**    | **Tegg**                                                   |

> **How to read this document.** Every requirement has an ID (e.g. `FR-TSK-04`) and a priority:
> **M** = Must (v1), **S** = Should (v1 if possible), **C** = Could (later), **W** = Won't (explicitly out of scope for now).
> Items marked ❓ depend on an open question in §13. Each open question carries a recommendation that I will assume if nobody answers it.

### Change log

| Version | Date | Changes |
| --- | --- | --- |
| v1.0 | 2026-10-07 | Initial draft from the clarification session |
| v1.1 | 2026-10-07 | Owner comments: link/embed visual distinction, hover previews, graph type filter, icons and smart preview. Owner's answers to OQ-01…OQ-27 applied (D-21…D-36): new Tags section (FR-TAG), vault setup choice, per-vault default type, review workflow per type, global hotkeys, task status model, recurrence, deletion behaviour, tabs, distribution. |
| v1.2 | 2026-10-07 | OQ-28…OQ-32 resolved (D-37…D-40): click to preview / double-click to open (global setting), content-first previews, object icon & cover (FR-TYP-14), no nested tags, New Task hotkey confirmed. |
| v1.3 | 2026-10-08 | Analysis of real Capacities and Notion exports (§15): import requirements FR-IMP-07…23; Date range attribute; date-only storage; Unicode normalization; description/aliases; reserved keys; duplicate titles; date mentions; scheduled date for tasks; media objects; weblinks; lossless vault export; open questions OQ-33…40. |
| v1.4 | 2026-10-08 | Capacities importer moved into the MVP (D-41): MVP scope extended (PDF storage, date range, scheduled date, date mentions, backup before import); new §11.1; OQ-33/34/35/37/40 marked as blocking the MVP. |
| v1.5 | 2026-10-08 | OQ-33…37, 39, 40 answered (D-42…D-48): Image and PDF are system object types; no Weblink type and no metadata fetching; one Capacities space per import; no page hierarchy; tasks have only `due`; Notion people as plain text; no collections in the MVP. OQ-38 (re-import) rewritten with options. |
| v1.6 | 2026-10-08 | OQ-38 answered (D-49): one-time Capacities import in the MVP, with a duplicate warning; re-import later. No open questions remain. |

---

## 1. Vision & Goals

### 1.1 Vision

A fast, clean, modern **object-based** note-taking app for people who work with hundreds to thousands of notes of different kinds: reading notes, Zettelkasten, working and meeting notes, planning (e.g. trips). It has the structured "everything is an object" experience of Anytype and Capacities, while every note stays a **plain Markdown file on the user's disk**. No vendor lock-in and no proprietary cloud.

### 1.2 Business goals

| ID  | Goal                              | Measure of success                                                                                                                      |
| --- | --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| G-1 | Vendor independence               | 100% of user content is readable without the app (Markdown + YAML + image/PDF files), and the vault opens in Obsidian with no data loss |
| G-2 | Speed                             | Any note reachable in < 1 s via keyboard; UI never blocks while typing (see NFR-PERF)                                                   |
| G-3 | Structure without friction        | Converting a paragraph into a typed object (e.g. a Task) takes ≤ 2 actions                                                              |
| G-4 | Trustworthy capture → review loop | Every captured item has a visible review state; the inbox can be emptied                                                                |
| G-5 | Growth path                       | The architecture allows iOS/Android clients, API sync and AI features later without a rewrite                                           |

### 1.3 Non-goals (for v1)

- No proprietary cloud, server or account system.
- No real-time multi-user collaboration.
- No AI features in v1 (the architecture must not block them; see §11).
- No mobile apps in v1 (the architecture must allow them).

---

## 2. Users & Personas

| Persona                     | Description                                                                                                                                                                                                    | Priority                                      |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| **P1: The owner (primary)** | Knowledge worker on an Apple Silicon Mac. Keeps reading notes, a Zettelkasten, meeting/working notes and plans. Wants keyboard speed, structure and data ownership. Uses Dropbox/Google Drive desktop clients. | v1 target                                     |
| **P2: Future public user**  | Similar profile, possibly migrating from Obsidian, Anytype, Capacities or Notion. Needs onboarding, import, and a polished, documented product.                                                                | Design must not block it; not built for in v1 |

**Implication of "me first, maybe others later":** v1 can skip licensing, payments, accounts, auto-update infrastructure and support tooling. It still must meet code-signing/notarization, data-safety and import requirements so that a later public release is possible without a rewrite.

---

## 3. Decision Log (confirmed with the owner)

| #    | Topic                      | Decision                                                                                                                                                     |
| ---- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| D-01 | Audience                   | Me first, possibly a public product later                                                                                                                    |
| D-02 | Mobile                     | iOS **and** Android planned (future phase)                                                                                                                   |
| D-03 | Sync                       | Phase 1: rely on the Dropbox/Google Drive **desktop clients** syncing the vault folder. Phase 2: built-in API sync (needed for mobile)                       |
| D-04 | Editor                     | Block-based object editor in the style of **Anytype / Capacities**                                                                                           |
| D-05 | File format                | **Obsidian-compatible**: YAML frontmatter for attributes, `[[wikilinks]]`, `![[embeds]]`, plain attachment files. Mindmaps stored as **Mermaid** code blocks |
| D-06 | Scale                      | Up to ~5,000 notes (plus attachments) within 3 years                                                                                                         |
| D-07 | Tasks                      | Status, due date, priority, recurrence, board view and calendar view. Tasks must keep a link to their **source note** and be manageable from Task views      |
| D-08 | Block conversion           | A converted block becomes its **own .md file**; the source note keeps an **embed** in its place; the new object records its source                           |
| D-09 | Queries                    | **Visual query builder** (no text query language required)                                                                                                   |
| D-10 | Import                     | Obsidian vault; Anytype / Capacities / Notion exports                                                                                                        |
| D-11 | Export                     | PDF, HTML, DOCX, Markdown bundle (zip)                                                                                                                       |
| D-12 | AI                         | Later phase; don't block it architecturally                                                                                                                  |
| D-13 | Folders                    | **App manages folders by object type**; users navigate by type/query, not folder tree                                                                        |
| D-14 | Quick Capture entry points | **Menu bar icon**, **macOS Share sheet**, and **global hotkeys** for Quick Capture and New Task (OQ-24). Web clipper out of scope |
| D-15 | Quick notes vs daily notes | **Both exist with distinct roles.** Quick Note = inbox item; Daily Note = dated hub. **Both have a review status** and can be marked reviewed                |
| D-16 | Templates                  | Attribute defaults, body structure, variables, note-scoped queries, multiple templates per type, applied at creation only                                    |
| D-17 | v1 extras                  | Daily notes, templates per type, version history + trash                                                                                                     |
| D-18 | Attachments                | **Images + PDF** in v1                                                                                                                                       |
| D-19 | Tech stack | **Tauri 2 + React/TypeScript + ProseMirror/TipTap + SQLite**, confirmed (OQ-16; see §8.1) |
| D-20 | Platform v1                | macOS on Apple Silicon (ARM64)                                                                                                                               |
| D-21 | Working name | **Tegg** (OQ-01) |
| D-22 | System types | **Page**, **Task**, **Quick Note**, **Daily Note**, **Tag**. Users may **add** attributes to system types but cannot change or remove built-in ones (OQ-02, OQ-04, OQ-17) |
| D-23 | New vault setup | User chooses an **empty vault** (system types only) or a **starter vault** with Book, Reading Note/Highlight, Zettel (Idea), Meeting, Person, Project, Trip, all editable (OQ-03) |
| D-24 | Object typing | Exactly one type per object, changeable. **Default type for new notes is set per vault; default = Quick Note** (OQ-25) |
| D-25 | Task status & priority | Configurable labels and colors; each status maps to a fixed semantic state: open / in progress / done / cancelled (OQ-05) |
| D-26 | Recurring tasks | Completing a recurring task creates the next occurrence as a **new file**; the done one stays as history (OQ-06) |
| D-27 | Embed / object deletion | Removing an embed doesn't delete the object (ask once, "don't ask again"). A trashed object shows a "moved to trash" placeholder with Restore (OQ-07) |
| D-28 | Checklists vs tasks | Only Task objects appear in Task views; checklist items can be converted in one action (OQ-08) |
| D-29 | Tags | Tag is a **system object**; the user can change its name and color (OQ-17) |
| D-30 | Review status | **Mandatory** on Quick Notes and Daily Notes; **opt-in per type** for all other types (OQ-18) |
| D-31 | Version history | Stored **locally** (not synced), kept **90 days**; the sync provider's file versioning is the cross-device backup (OQ-19) |
| D-32 | Platform & distribution | English UI, prepared for localization (OQ-20); direct-download notarized DMG, **macOS 14+** (OQ-21); no encryption, rely on FileVault (OQ-22) |
| D-33 | Reading notes | No built-in reading-specific features; the user defines reading types as needed (OQ-23) |
| D-34 | Out of v1 | Web clipper (OQ-24); task reminders/notifications (OQ-26) |
| D-35 | Later (v1.x) | Multiple vaults (OQ-09); customizable Home (OQ-10); split view (OQ-11); global graph (OQ-14). In v1: single vault, fixed Home, **tabs**, local graph |
| D-36 | Files & locations | Obsidian vault: open in place **or** copy (OQ-12); file name = sanitized title (OQ-13); mindmap visual editor saving to Mermaid (OQ-15); iCloud Drive supported as a folder location now, API in Phase 2 (OQ-27) |
| D-37 | Object previews | **Click previews, double-click opens**, everywhere (editor, embeds, lists, graph). The trigger is a global app setting (OQ-28) |
| D-38 | Preview content | Previews are **content-first**: they must show what the object is about (its content), with attributes secondary (OQ-30) |
| D-39 | Object icon & cover | Each object can have its **own icon/emoji and cover image**, falling back to the type icon (OQ-29) |
| D-40 | Tags & hotkeys | **No nested tags** (OQ-31); separate global **New Task** hotkey confirmed (OQ-32) |
| D-41 | Capacities import in MVP | The **Capacities importer is part of the MVP** (v0.1), so the owner can move their existing Capacities data into Tegg from day one. Notion and Anytype import stay in v1.x, Obsidian in v1.0 (see §11.1) |
| D-42 | Images & PDFs | **Every image and PDF is an object** (system types Image and PDF) with title, description, tags and links (OQ-33) |
| D-43 | Weblinks | **No Weblink object type** and no fetching of link metadata. Imported Capacities weblinks become ordinary objects with a `url` attribute (OQ-34) |
| D-44 | Capacities spaces | The user **selects one Capacities space per import**; other spaces can be imported in separate runs (OQ-35) |
| D-45 | Page hierarchy | **No parent/child page support** (OQ-36) |
| D-46 | Task dates | Tasks have **only a due date** (OQ-37) |
| D-47 | Notion people | Imported as **plain text** (OQ-39) |
| D-48 | Collections | No tag groups/collections in the MVP. Possibly later as a new **Collection** system object (OQ-40) |
| D-49 | Re-import | MVP: **one-time import**; importing a newer export again is treated as a new import. Add-new-only or update re-import may come in v1.x, using the stored `import-id` (OQ-38) |

---

## 4. Glossary

| Term            | Definition                                                                                                                                                                  |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Vault**       | The root folder that holds all notes, attachments and the app's portable configuration.                                                                                     |
| **Object**      | Any note. One `.md` file = one object. Every object has exactly one **Object Type**.                                                                                        |
| **Object Type** | A definition (e.g. *Book*, *Meeting*, *Person*, *Trip*) with a name, icon, color, attribute schema, folder, templates and default views.                                    |
| **System Type** | A built-in type with behavior coded into the app; it cannot be deleted and its built-in attributes are locked, but users can add attributes (Page, Task, Quick Note, Daily Note, Tag). |
| **Attribute**   | A typed field of an object (stored in YAML frontmatter).                                                                                                                    |
| **Block**       | A unit of content in the editor (paragraph, heading, list item, image, embed, query, mindmap, …).                                                                           |
| **Link**        | A reference from one object to another (`[[…]]` in text or a *relation* attribute).                                                                                         |
| **Backlink**    | The reverse view of a link: all objects that link **to** the current one.                                                                                                   |
| **Embed**       | Showing another object (or a block of it) inside a note (`![[…]]`).                                                                                                         |
| **Query**       | A saved filter/sort/group definition over objects, shown as a **View** (table, list, board, calendar).                                                                      |
| **Inbox**       | The list of objects with review status *Unreviewed*.                                                                                                                        |
| **Template**    | A predefined starting state (attributes + body) for a new object of a type.                                                                                                 |
| **Tag** | A system object with a name and color used to label objects. Stored on objects Obsidian-style (`tags:` / `#tag`). |
| **Default type** | The type preselected for new notes, set per vault (default: Quick Note). |

---

## 5. Information & Storage Requirements

### 5.1 Vault structure (FR-STO)

| ID        | Requirement                                                                                                                                                                                                                    | Pri |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --- |
| FR-STO-01 | All user content lives in **one vault folder** chosen by the user; the app may create sub-folders.                                                                                                                             | M   |
| FR-STO-02 | Each object is stored as **one `.md` file** (UTF-8, LF line endings).                                                                                                                                                          | M   |
| FR-STO-03 | The app places each object in a **folder named after its type** (D-13), e.g. `Pages/`, `Books/`, `Tasks/`, `Meetings/`, `Quick Notes/`, `Daily/`, `Tags/`, `Images/`, `PDFs/`. The folder for each type is configurable in the type definition. | M |
| FR-STO-04 | When an object's type changes, the app **moves the file** to the new type's folder and keeps all links working.                                                                                                                | M   |
| FR-STO-05 | Attachments (images, PDFs) are stored in a vault attachments folder (default `_attachments/`, configurable). Name collisions are resolved by suffixing.                                                                        | M   |
| FR-STO-06 | Type definitions, templates, saved queries and vault settings are stored **inside the vault** as human-readable files (YAML/Markdown) so they sync between devices: `.tegg/types/*.yml`, `.tegg/queries/*.yml`, `.tegg/vault.yml`, `_templates/<Type>/*.md`. | M |
| FR-STO-07 | Machine-local data (search index, cache, window state, recent list, version history) is stored **outside the vault** (`~/Library/Application Support/Tegg/`), so it never causes sync conflicts. Everything except version history can be rebuilt from the files at any time. | M |
| FR-STO-08 | Deleted objects go to an in-vault trash folder (`.trash/`, Obsidian-compatible). See FR-HIS.                                                                                                                                   | M   |
| FR-STO-09 | Files that are not Markdown and not recognized attachments are left untouched and ignored.                                                                                                                                     | M   |
| FR-STO-10 | Opening a folder that is already an Obsidian vault works **in place**, with no conversion needed (D-36, FR-IMP-01). | M |

### 5.2 File format (FR-FMT), Obsidian-compatible (D-05)

| ID        | Requirement                                                                                                                                                                                                                                          | Pri |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- |
| FR-FMT-01 | Attributes are stored as **YAML frontmatter** using Obsidian "Properties" conventions (text, number, checkbox, date, datetime, list).                                                                                                                | M   |
| FR-FMT-02 | Every object has a stable **`id`** in frontmatter (e.g. ULID), so identity survives renames and external edits. The `type` attribute stores the object type. `created` and `modified` timestamps are kept.                                           | M   |
| FR-FMT-03 | Links are `[[Note Name]]`, `[[Note Name\|alias]]`, `[[Note Name#Heading]]` and `[[Note Name#^blockid]]`. Relation attributes store links as quoted strings: `"[[Note Name]]"`.                                                                       | M   |
| FR-FMT-04 | Embeds are `![[Note Name]]`, `![[Note Name#^blockid]]`, `![[image.png\|400]]` and `![[file.pdf#page=3]]`.                                                                                                                                            | M   |
| FR-FMT-05 | Mindmaps are stored as fenced ` ```mermaid ` blocks using Mermaid `mindmap` syntax.                                                                                                                                                                  | M   |
| FR-FMT-06 | Embedded queries are stored as a fenced code block (e.g. ` ```query `) with a readable YAML definition. In other tools they appear as a code block, and no data is lost.                                                                             | M   |
| FR-FMT-07 | **Round-trip safety:** opening and saving a file without edits must not change it, byte for byte. Markdown the editor doesn't understand (HTML, footnotes, unknown code blocks, unknown frontmatter keys) is **preserved** and shown as a raw block. | M   |
| FR-FMT-08 | The **file name** is the object title, sanitized to be valid on macOS/Windows/iOS/Android (D-36). If the title contains characters not allowed in file names (e.g. `/`, `:`), the full title is kept in `title:` frontmatter and shown everywhere in the UI. Renaming the title renames the file and **updates all links** across the vault. | M |
| FR-FMT-09 | Daily note file names follow a configurable date format (default `YYYY-MM-DD.md`).                                                                                                                                                                   | M   |
| FR-FMT-10 | Tags are stored Obsidian-compatibly on the tagged object: a `tags:` list in frontmatter and/or inline `#tag` in the body (both count as the same tag). A tag's name, color and other attributes live in its **Tag object** (FR-TAG). | M |
| FR-FMT-11 | **Dates without time are stored as `YYYY-MM-DD`** (no time, no timezone), so they never shift a day across timezones. Date-times are stored as ISO 8601 with offset. Date ranges per FR-TYP-02. | M |
| FR-FMT-12 | **Unicode normalization:** file names and link targets are written and compared in Unicode NFC, so names with diacritics or emoji (e.g. Czech `č`, `ř`) match regardless of how macOS, a zip tool or a sync provider encoded them (NFD vs NFC). | M |

**Example: a task converted from a meeting note**

```markdown
---
id: 01J9ZK4M7Q2R8F3V6X1T0B5N9C
type: task
title: Send budget draft to finance
status: todo
priority: high
due: 2026-10-10
recurrence:
source: "[[2026-10-07 Weekly Sync]]"
review: reviewed
created: 2026-10-07T10:31:00+02:00
modified: 2026-10-07T10:31:00+02:00
---
Include Q4 travel costs from the trip plan.
```

In `Meetings/2026-10-07 Weekly Sync.md` the original paragraph becomes `![[Send budget draft to finance]]`.

---

## 6. Functional Requirements

### 6.1 Vault & first run (FR-VLT)

| ID        | Requirement                                                                                                                                                                                | Pri |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --- |
| FR-VLT-01 | On first launch the user can **create a new vault** or **open an existing folder** (including one inside Dropbox/Google Drive).                                                            | M   |
| FR-VLT-02 | When creating a new vault the user chooses: **Empty vault** (system types only: Page, Task, Quick Note, Daily Note, Tag) or **Starter vault**, which adds the editable user types *Book, Reading Note/Highlight, Zettel (Idea), Meeting, Person, Project, Trip*, each with a default template (D-23). Starter types can be added to any vault later from Settings. | M |
| FR-VLT-03 | The app warns if the vault folder contains **online-only / cloud placeholder files** (Dropbox Smart Sync, Google Drive streaming, iCloud "Optimize Mac Storage"), and asks the user to make the folder available offline. | M |
| FR-VLT-04 | Multiple vaults: single vault in v1; multiple vaults in v1.x (D-35). | C |
| FR-VLT-05 | **Default type for new notes**, set per vault (default: *Quick Note*, D-24). It is preselected for ⌘N, in Quick Capture, and when a `[[link]]` to a non-existing note creates a new object. The user can always pick another type. | M |

### 6.2 Object types & attributes (FR-TYP)

| ID        | Requirement                                                                                                                                                                                                                                                                                                  | Pri |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --- |
| FR-TYP-01 | The user can **create, edit, and delete user-defined object types**. Each type has: name, plural name, icon, color, folder, attribute schema, default template, other templates, and default view(s).                                                                                                        | M   |
| FR-TYP-02 | Supported attribute types: **Text, Long text, Number, Checkbox, Date, Date-time, Date range** (start + end, e.g. trip dates, project time frame), **Select, Multi-select, URL, Email, Relation** (link to objects, optionally restricted to given types, single or multiple), **Rating** (C), **Currency** (number + currency code, C), **File/attachment** (C). Date range is stored Obsidian-readably as two date properties `<key>-start` and `<key>-end` and shown as one field. | M |
| FR-TYP-03 | Each attribute can have: name, key (frontmatter key), type, default value, required flag, options (for selects, with colors), and a description.                                                                                                                                                             | M   |
| FR-TYP-04 | **Schema changes propagate:** renaming an attribute key rewrites the frontmatter of all objects of that type (with a confirmation dialog and a progress indicator). Deleting an attribute asks whether to remove the values from the files or leave them as orphaned (still shown under "Other properties"). | M   |
| FR-TYP-05 | Deleting a type requires choosing a target type for its existing objects (or moving them to trash).                                                                                                                                                                                                          | M   |
| FR-TYP-06 | **System types** (cannot be deleted; built-in attributes cannot be renamed, retyped or removed): **Page** (generic note, also used for untyped files), **Task**, **Quick Note**, **Daily Note**, **Tag**, **Image**, **PDF** (D-22, D-42). Users **can add** their own attributes to system types (e.g. *Context* on Task), and can change a system type's icon and color. | M |
| FR-TYP-07 | Every object can have its **type changed** after creation. Matching attributes are kept, and non-matching ones are kept as orphaned properties.                                                                                                                                                              | M   |
| FR-TYP-08 | Universal attributes available on all types: title, **description** (short summary), **aliases** (alternative names used by link autocomplete, quick switcher and link resolution), created, modified, tags (FR-TAG), source (relation), icon & cover (FR-TYP-14), and review status (when the type's review workflow is on, FR-TYP-12). | M |
| FR-TYP-09 | Each type has an automatically generated **Type page** (like Capacities): a list/table of all objects of that type, using the type's default view, with create button and filters.                                                                                                                           | M   |
| FR-TYP-10 | A file in the vault with no `type` frontmatter (e.g. from Obsidian) is treated as type **Page** and is **not rewritten** until the user edits it. | M |
| FR-TYP-11 | Each type defines its **preview attributes** (up to ~4 attributes shown as a compact strip in previews and embed cards; see FR-LNK-10, FR-GRP-06). | M |
| FR-TYP-12 | **Review workflow** setting per type (on/off, D-30). When on, new objects of that type get `review: unreviewed` and appear in the Inbox. It is always on (locked) for Quick Note and Daily Note, and off by default for all other types. | M |
| FR-TYP-13 | Every object has **exactly one type** (D-24); the type can be changed at any time (FR-TYP-07). | M |
| FR-TYP-14 | **Object icon & cover** (D-39): any object can have its own **icon** (emoji or small image) and **cover image**, stored in frontmatter as `icon:` (emoji, or `"[[file.png]]"`) and `cover:` (`"[[file.jpg]]"`). The object icon replaces the type icon wherever the object appears (links, embeds, previews, graph, sidebar, quick switcher, query views); without one, the type icon is used. The cover is shown as a banner at the top of the note, in previews and in gallery views. | M |
| FR-TYP-15 | **Reserved attribute keys**: `id, type, title, description, aliases, tags, created, modified, source, review, icon, cover, previous, file, import-id`. User-defined and imported attributes cannot use them; on import a colliding attribute is renamed (e.g. a plain-text `source` → `source-text`) and the rename is listed in the import report. | M |
| FR-TYP-16 | Page hierarchy (parent/child pages): **not supported** (D-45). Links between pages cover the need. | W |

### 6.2.1 Tags, system type (FR-TAG) (D-29)

| ID | Requirement | Pri |
| --- | --- | --- |
| FR-TAG-01 | **Tag** is a system type. Each tag is an object with an editable **name** and **color**, an optional description, and any attributes the user adds (FR-TYP-06). | M |
| FR-TAG-02 | Storage: applying a tag writes its name to the object's `tags:` frontmatter list (inline `#tag` in the body counts as the same tag), which keeps Obsidian compatibility. The Tag object itself is a file `Tags/<name>.md` holding color, description and attributes. | M |
| FR-TAG-03 | A Tag object file is created when the user creates the tag in the app or edits its color/description. Tags that only come from existing files (e.g. an Obsidian vault) are **virtual** until edited, so imports don't create hundreds of files. | M |
| FR-TAG-04 | **Rename** a tag: renames the Tag file and rewrites the `tags:` values and inline `#tags` in every object that uses it (confirmation, progress, restore point per FR-HIS-04). | M |
| FR-TAG-05 | The tag **color** is used wherever the tag appears: tag chips in the attribute panel, inline `#tags`, query views, search filters and graph nodes. | M |
| FR-TAG-06 | **Tag page**: opening a tag shows its description and all objects with that tag (a query view, groupable by type). | M |
| FR-TAG-07 | Tags appear in the sidebar (with colors and counts), in search filters (FR-SRC-02) and in the query builder ("has tag / any of / all of"). | M |
| FR-TAG-08 | **Delete** a tag: asks whether to remove it from all objects (rewrite, with restore point) or only delete the Tag object (the tag text stays and the tag becomes virtual, without color). | M |
| FR-TAG-09 | **Merge** two tags into one. | S |
| FR-TAG-10 | Nested tags (`#parent/child`) are **not supported** (D-40). A tag containing `/` is treated as one plain tag name. | W |
| FR-TAG-11 | **Collections** (grouping objects or tags, e.g. PARA areas, Status): not in the MVP; possibly later as a new **Collection** system object (D-48). | C |

### 6.3 Editor (FR-EDT), Anytype/Capacities-style block editor (D-04)

| ID        | Requirement                                                                                                                                                                                                                                                                    | Pri |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --- |
| FR-EDT-01 | Block-based WYSIWYG editor. Each block has a drag handle, can be reordered by drag & drop or keyboard, and has a block menu (convert, duplicate, delete, copy link to block, turn into object).                                                                                | M   |
| FR-EDT-02 | Block types: paragraph, heading 1–3, bulleted list, numbered list, checklist item (plain checkbox; see FR-TSK-11), quote, callout (Obsidian `> [!note]` syntax), code block, divider, table (Markdown table), image, PDF, note embed, block embed, query block, mindmap block. | M   |
| FR-EDT-03 | **Slash menu** (`/`) to insert any block type, object embed, or query.                                                                                                                                                                                                         | M   |
| FR-EDT-04 | **Markdown shortcuts** while typing (`#`, `-`, `1.`, `[]`, `>`, ```` ``` ````, `**bold**`, etc.).                                                                                                                                                                              | M   |
| FR-EDT-05 | Inline formatting: bold, italic, strikethrough, inline code, highlight, link; a floating toolbar on text selection.                                                                                                                                                            | M   |
| FR-EDT-06 | Typing `[[` opens link autocomplete across all objects (fuzzy match, type icon shown). Choosing a name that doesn't exist creates a new object, with a type picker (the vault's default type preselected, FR-VLT-05). | M |
| FR-EDT-07 | Attribute panel at the top of each object, showing the type's attributes as editable fields (not raw YAML). Missing values are shown as empty placeholders.                                                                                                                    | M   |
| FR-EDT-08 | **Autosave** (debounced, ≤ 1 s after the last keystroke) using atomic writes (FR-SYN-02). No "Save" button.                                                                                                                                                                    | M   |
| FR-EDT-09 | Undo/redo across block operations, including block-to-object conversion (FR-CNV-06).                                                                                                                                                                                           | M   |
| FR-EDT-10 | Raw Markdown **source view toggle** per note, for power users and debugging.                                                                                                                                                                                                   | S   |
| FR-EDT-11 | Outline (table of contents) of the current note's headings in the side panel.                                                                                                                                                                                                  | S   |
| FR-EDT-12 | Toggle/collapsible blocks. *(Note: there is no standard Markdown equivalent. Proposed storage: a heading or callout with a fold marker.)*                                                                                                                                      | C   |
| FR-EDT-13 | Multi-block selection (Shift+click, Shift+arrows) for move, delete, convert, and copy.                                                                                                                                                                                         | M   |
| FR-EDT-14 | Paste handling: rich text/HTML from the web → clean blocks; images from the clipboard → saved attachment; URL on a selection → link.                                                                                                                                           | M   |
| FR-EDT-15 | Typing `#` opens **tag autocomplete** (existing tags shown with their color). Choosing a new name creates a new tag (FR-TAG-03). | M |

### 6.4 Block → Object conversion (FR-CNV) (D-08)

| ID        | Requirement                                                                                                                                                                     | Pri |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- |
| FR-CNV-01 | Any block, or selection of blocks, can be **converted into an object of any type** via the block menu, the slash command `/turn into`, or a keyboard shortcut.                  | M   |
| FR-CNV-02 | The **first line** becomes the new object's title (editable in the conversion popover). The remaining selected blocks become its body.                                          | M   |
| FR-CNV-03 | The new object is saved as its own `.md` file in its type folder. The original blocks are replaced in the source note by an **embed** (`![[New Object]]`) at the same position. | M   |
| FR-CNV-04 | The new object automatically gets `source: "[[Source Note]]"`. From the object, the user can jump back to the exact position in the source.                                     | M   |
| FR-CNV-05 | The embed in the source is **editable in place**: editing it edits the object's file, and changing a task's status from the meeting note updates the task.                      | M   |
| FR-CNV-06 | Conversion is a single undoable action that restores the original blocks and deletes the new file.                                                                              | M   |
| FR-CNV-07 | The conversion popover lets the user set key attributes at once (e.g. for a Task: due date, priority) without leaving the source note.                                          | S   |
| FR-CNV-08 | Removing the embed from the source note **does not delete** the object (D-27). The first time, the app asks for confirmation with a "Don't ask again" option, and the object keeps its `source` link. If the object is trashed, the embed in the source shows a "moved to trash" placeholder with a **Restore** action. | M |
| FR-CNV-09 | **Bulk conversion**: convert each selected list item into a separate object (e.g. 5 bullet points → 5 tasks).                                                                   | S   |

### 6.5 Tasks, system type (FR-TSK) (D-07)

| ID        | Requirement                                                                                                                                                                                                   | Pri |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- |
| FR-TSK-01 | Task attributes: **title, status, priority, due date, recurrence, source** (relation), completed date (auto), plus optional relation to a project/any object.                                                 | M   |
| FR-TSK-02 | **Status**: each status has a user-editable **label and color** and maps to one fixed **semantic state**: *Open*, *In progress*, *Done*, *Cancelled* (D-25). Defaults: To do → Open, In progress → In progress, Waiting → Open, Done → Done, Cancelled → Cancelled. Users can add, rename, recolor and reorder statuses (choosing the semantic state for new ones). App logic (overdue, recurrence, "All open") uses only the semantic state. | M |
| FR-TSK-03 | **Priority**: an ordered list with user-editable labels and colors (default: High, Medium, Low, None). The order defines sorting. | M |
| FR-TSK-04 | **Task views** (from the sidebar): *Today* (due today + overdue), *Upcoming*, *All open*, *By source*, *Done*. Each is a saved query that the user can edit or duplicate.                                     | M   |
| FR-TSK-05 | **Board view** (Kanban) grouped by status (or by any select attribute). Dragging a card between columns changes the attribute.                                                                                | M   |
| FR-TSK-06 | **Calendar view** (month/week) by due date. Dragging a task to another day changes its due date. Tasks without a date are shown in a side list.                                                               | M   |
| FR-TSK-07 | **Recurrence**: daily, weekdays, weekly (on chosen days), monthly (day of month / nth weekday), yearly, every N days/weeks/months; "from due date" or "from completion date". When a recurring task is completed, the done instance stays as history and the **next occurrence is created as a new Task file** (D-26). The new file copies the title, body, attributes and `source`, gets the new due date and a `previous` link to the completed instance, and the recurrence rule moves to it. The embed in the source note keeps pointing to the original instance and shows a "next: <date>" indicator linking to the open occurrence. | M |
| FR-TSK-08 | Every task in any view shows its **source note** as a clickable chip. Click previews the source; double-click opens it scrolled to the embed (FR-LNK-11). | M |
| FR-TSK-09 | Overdue tasks are visually highlighted.                                                                                                                                                                       | M   |
| FR-TSK-10 | Tasks can be created directly in Task views (quick-add row) without a source note, or from any app via the **global New Task hotkey** (FR-CAP-05, D-40). The hotkey opens the capture window with type = Task and due date / priority fields. | M |
| FR-TSK-11 | A plain Markdown checklist item (`- [ ]`) is **not** a Task object and does **not** appear in Task views (D-28). The user can convert it to a Task in one action (FR-CNV). | M |
| FR-TSK-12 | System notifications/reminders: out of v1 (D-34); later (C). | W |
| FR-TSK-13 | A separate scheduled/"do" date: **not supported**, tasks have only `due` (D-46). The Capacities importer maps `deadline` → `due`, falling back to the Capacities `date` when there's no deadline (adjustable in the import mapping). | W |

### 6.6 Quick Capture & Inbox (FR-CAP / FR-INB) (D-14, D-15)

| ID        | Requirement                                                                                                                                                                                                                      | Pri |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- |
| FR-CAP-01 | **Menu bar icon** opens a small capture window: a text field (Markdown supported), a type selector (preselected: the vault's default type, FR-VLT-05), tag field, and an optional image/PDF drop zone. Enter/⌘↩ saves and closes. | M |
| FR-CAP-02 | **macOS Share sheet extension** accepts text, URLs, images and PDFs from any app and creates an object of the vault's default type (Quick Note unless changed). The source URL and app are stored as attributes; the title is the page title or the first line. | M |
| FR-CAP-03 | Capture must work when the main window is closed, and must take **< 300 ms** from click to typing.                                                                                                                               | M   |
| FR-CAP-04 | Captured objects are always created with `review: unreviewed` and a `captured` timestamp, so they land in the Inbox whatever their type. | M |
| FR-CAP-05 | **Global hotkeys** (work from any app; configurable; D-14): *Quick Capture* (default ⌃⌥Space) opens the capture window with the vault's default type; *New Task* (default ⌃⌥T) opens it with type = Task. | M |
| FR-CAP-06 | Browser web clipper: out of scope (D-34). | W |
| FR-CAP-07 | Weblink object type and fetching link metadata (title, preview image) from the internet: **not needed** (D-43). A captured URL is stored as text/link in the object (and in a `url` attribute where the type has one); NFR-SEC-01 (no network calls) stays intact. | W |
| FR-INB-01 | **Inbox view** lists all objects with `review: unreviewed`: Quick Notes, Daily Notes, captured items, and objects of any type with the review workflow on (FR-TYP-12). Newest first, filterable by type, with a count badge in the sidebar. | M |
| FR-INB-02 | Inbox actions per item (keyboard-first): **mark reviewed**, **convert to type** (changes the type and moves the file), **merge into / append to** another object, **link to** object, **trash**, open. Bulk selection supported. | M   |
| FR-INB-03 | Review status is an attribute (`review: unreviewed \| reviewed`). It is **mandatory** on Quick Notes and Daily Notes and **opt-in per type** for all other types (D-30, FR-TYP-12). | M |
| FR-INB-04 | Converting a Quick Note to another type keeps its content, `id`, and links.                                                                                                                                                      | M   |
| FR-INB-05 | "Triage mode": step through unreviewed items one by one with single-key actions.                                                                                                                                                 | S   |

### 6.7 Daily Notes, system type (FR-DLY) (D-15)

| ID        | Requirement                                                                                                                                                                                                                  | Pri |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- |
| FR-DLY-01 | One Daily Note per calendar date; open "Today" with one click/shortcut.                                                                                                                                                      | M   |
| FR-DLY-02 | The Daily Note is **virtual until the user types in it**. No empty files are created.                                                                                                                                        | M   |
| FR-DLY-03 | Navigation: previous/next day and a calendar date picker (days with notes are marked).                                                                                                                                       | M   |
| FR-DLY-04 | The Daily Note shows auto-generated **context sections** (live queries, not saved into the body unless the template includes them): Quick Notes captured that day, tasks due/overdue, objects created and modified that day. | M   |
| FR-DLY-05 | Daily notes have a review status (`unreviewed` by default once created) and appear in the Inbox until reviewed.                                                                                                              | M   |
| FR-DLY-06 | A daily-note template is applied when the note is first written.                                                                                                                                                             | M   |
| FR-DLY-07 | Weekly/monthly review notes.                                                                                                                                                                                                 | C   |
| FR-DLY-08 | **Date mentions:** typing `@` + a date (or picking one from a date picker; `@today`, `@tomorrow`) inserts a link to that day's Daily Note (`[[YYYY-MM-DD]]`). A link to a date whose Daily Note doesn't exist yet opens the virtual Daily Note and is **not** shown as broken. Date mentions appear in that Daily Note's backlinks. | M |
| FR-DLY-09 | **Time-stamped entries:** a shortcut inserts the current time as a small heading or line (e.g. `21:30`) for log-style daily notes. | S |

### 6.8 Home / Recent view (FR-HOM)

| ID        | Requirement                                                                                                                                                                     | Pri |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- |
| FR-HOM-01 | Home is the default start screen and shows: **Today** (daily note link + tasks due/overdue), **Inbox count**, **Recently opened**, **Recently edited**, and **Pinned** objects. | M   |
| FR-HOM-02 | Pinned objects and saved queries can be added to Home and the sidebar.                                                                                                          | M   |
| FR-HOM-03 | Home sections can be reordered, hidden, or added (any saved query as a widget). Fixed sections in v1; customizable in v1.x (D-35). | C |
| FR-HOM-04 | The app restores the last open note/tabs on launch (configurable: Home vs last state).                                                                                          | S   |

### 6.9 Navigation & fast switching (FR-NAV)

| ID        | Requirement                                                                                                                                                                                      | Pri |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --- |
| FR-NAV-01 | **Quick switcher** (⌘O): fuzzy search over titles and aliases, ranked by recency + match quality, results in < 100 ms, with type icon and folder shown. Creates a new object if nothing matches. | M   |
| FR-NAV-02 | **Command palette** (⌘K / ⌘⇧P): every app action is searchable and runnable by keyboard.                                                                                                         | M   |
| FR-NAV-03 | Back/forward navigation history (⌘[ / ⌘]).                                                                                                                                                       | M   |
| FR-NAV-04 | Left sidebar: Home, Inbox, Today, Tasks, Search, **Types** (list of all types → Type pages), Pinned, Saved queries. Collapsible.                                                                 | M   |
| FR-NAV-05 | Right side panel (toggleable): Attributes, Backlinks, Local graph, Outline.                                                                                                                      | M   |
| FR-NAV-06 | **Tabs** in v1: ⌘T new tab, ⌘W close, ⌘-click opens a link in a new tab, tabs are restored on launch. **Split view** in v1.x (D-35). | M |
| FR-NAV-07 | All primary actions have keyboard shortcuts; shortcuts are customizable.                                                                                                                         | S   |
| FR-NAV-08 | Previews of linked and embedded objects anywhere in the app: click to preview, double-click to open by default (FR-LNK-08…13). | M |

### 6.10 Universal search (FR-SRC)

| ID        | Requirement                                                                                                           | Pri |
| --------- | --------------------------------------------------------------------------------------------------------------------- | --- |
| FR-SRC-01 | Full-text search across titles, body text and attribute values of all objects, with results < 200 ms for 5,000 notes. | M   |
| FR-SRC-02 | Filters: object type, tags, date created/modified, attribute values, review status.                                   | M   |
| FR-SRC-03 | Results show the type icon, title, and a highlighted snippet. Opening a result scrolls to the match.                  | M   |
| FR-SRC-04 | Supports phrase ("…") and exclusion (-word) operators; tolerant of diacritics (e.g. *č* matches *c*) and typos.       | S   |
| FR-SRC-05 | Search inside PDF text.                                                                                               | C   |
| FR-SRC-06 | A search can be saved as a query (FR-QRY).                                                                            | S   |

### 6.11 Links & backlinks (FR-LNK)

| ID        | Requirement                                                                                                             | Pri |
| --------- | ----------------------------------------------------------------------------------------------------------------------- | --- |
| FR-LNK-01 | Backlinks panel for each object: every object linking to it, with the surrounding text, grouped by type.                | M   |
| FR-LNK-02 | Links from relation attributes and embeds count as links (shown with their attribute name).                             | M   |
| FR-LNK-03 | Renaming or moving an object updates all links (FR-FMT-08).                                                             | M   |
| FR-LNK-04 | Broken links are visually marked; clicking one offers to create the object.                                             | M   |
| FR-LNK-05 | **Unlinked mentions**: text matching this object's title that is not yet linked, with one-click "link".                 | S   |
| FR-LNK-06 | Links to a specific heading or block (`#^id`). Block IDs are generated automatically when the user copies a block link. | S   |
| FR-LNK-07 | **Links and embeds look clearly different.** A *link* is an inline text chip (object/type icon + title, link color, no frame). An *embed* is a framed block (subtle border/background tint, a header with icon + title, and an "open" button), so it's obvious the content comes from another object. Broken links and embeds have their own style (FR-LNK-04). | M |
| FR-LNK-08 | **Click to preview** (D-37): a single click on a link shows a preview popover of the linked object. This works everywhere objects are referenced: editor text, attribute fields, backlinks panel, query views, search results, Task views, and graph nodes (FR-GRP-03). The trigger mode is a global setting (FR-LNK-12). | M |
| FR-LNK-09 | **Preview of embeds:** a single click on an embed in *card* or *link* mode (FR-EMB-02), or on the header of a *full* embed, shows the full content of the embedded object in the same popover. (Clicking inside a full embed's content edits it in place, FR-EMB-03.) | M |
| FR-LNK-10 | **Preview content is content-first** (D-38), so the user can see what the object is about: a header (own icon or type icon, cover, title, type name), the type's preview attributes as a compact one-line strip (FR-TYP-11), then the object's **rendered content**: the full body, scrollable, with headings, images and nested embeds shown as cards. If the body is empty (e.g. a Person with only attributes), all attributes are shown instead. For a heading or block link (`#Heading`, `#^id`) only that section or block is shown. An AI-generated "what it's about" summary at the top of the preview is planned for the AI phase (C). | M |
| FR-LNK-11 | **Preview behaviour:** the popover opens in < 100 ms, stays open until the user clicks outside it or presses Esc, and can be scrolled and resized. **Double-click** on a link, embed or node **opens** the object; so does the "Open" button or Enter in the popover. ⌘-click (or ⌘-double-click) opens the object in a new tab. The popover is read-only in v1 (editing inside it: C). | M |
| FR-LNK-12 | **Global setting "Object preview"** (D-37): *Click to preview, double-click to open* (default) · *Hover to preview (adjustable delay), click to open* · *Off: click opens*. The setting applies everywhere, including the graph. | M |
| FR-LNK-13 | **Editor interplay:** because double-click on a link opens it, link text is edited via the keyboard (moving the cursor into the link) or the context menu ("Edit link" / "Remove link"). With the cursor on a link, ⌘↩ opens it and ⌥Space shows its preview. | M |
| FR-LNK-14 | **Duplicate titles are allowed** (even within one type, e.g. several job applications called "Senior Product Manager"). The second file gets a suffix (`Title (2).md`) while `title:` keeps the real title. A link to a duplicate is written unambiguously (`[[Title (2)\|Title]]`), and it resolves by file, never by title alone. Link autocomplete and the quick switcher show distinguishing details for duplicates (type, key attributes, created date). A "Duplicate titles" check lists them and offers merge. | M |

### 6.12 Graph (FR-GRP)

| ID        | Requirement                                                                                                                                     | Pri |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | --- |
| FR-GRP-01 | **Local graph** per object in the side panel and as a full view: the current object + linked objects up to depth N (default 1, adjustable 1–3). | M   |
| FR-GRP-02 | **Filter by object type:** a filter panel with a checkbox per type, "all / none", and saved filter presets shows or hides nodes of the selected types. Additional toggles for backlinks / outgoing links / attribute relations / embeds. The filter state is remembered per graph view (side panel vs full view). | M   |
| FR-GRP-03 | **Click a node** selects it, highlights its neighbours and shows the preview (FR-GRP-06); **double-click opens** the object; ⌘-double-click opens it in a new tab. Follows the global "Object preview" setting (FR-LNK-12). | M |
| FR-GRP-04 | Global vault graph in v1.x (D-35), with the same type filters, icons and previews as the local graph. | C |
| FR-GRP-05 | **Object icons in nodes:** each node shows the object's own icon (FR-TYP-14), otherwise its type icon, with the node colored by type. The title label sits below the node; labels fade at low zoom to avoid clutter. A legend lists the visible types. | M |
| FR-GRP-06 | **Smart preview in the graph:** clicking a node shows the same content-first preview as FR-LNK-10, so the user can see what the object is about without leaving the graph: icon/cover, title, a compact strip of the type's preview attributes, then the rendered content. Moving to another node replaces the preview. | M |
| FR-GRP-07 | Node size can optionally reflect the number of links (more connected = bigger). | S |
| FR-GRP-08 | Tags appear as nodes in their tag color (type *Tag*) and can be shown or hidden with the type filter (FR-GRP-02). | M |

### 6.13 Embeds (FR-EMB)

| ID        | Requirement                                                                                                                                                                                                     | Pri |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- |
| FR-EMB-01 | Any object (or block of it) can be embedded in any note via `![[ ]]`, the slash menu, or drag from the sidebar/search.                                                                                          | M   |
| FR-EMB-02 | Embed display modes: **full** (inline editable content), **card** (title + key attributes), **link** (inline chip). Default per type is configurable (e.g. Task = compact row with checkbox, status, due date). Every mode is visually distinct from a plain link (FR-LNK-07) and supports preview (FR-LNK-09). | M   |
| FR-EMB-03 | Embedded content is editable in place (FR-CNV-05).                                                                                                                                                              | M   |
| FR-EMB-04 | Recursive embeds are detected and stopped (show "circular embed"). Maximum nesting depth is 3.                                                                                                                  | M   |
| FR-EMB-05 | Images and PDFs are embedded with resize; PDF embeds show an inline viewer with page navigation.                                                                                                                | M   |

### 6.14 Queries & views (FR-QRY) (D-09)

| ID        | Requirement                                                                                                                                                                                                                   | Pri      |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| FR-QRY-01 | **Visual query builder**: choose source **type(s)** (one, several, or all), then add **filters** (attribute + operator + value), **sort**, **group by**, and **limit**.                                                       | M        |
| FR-QRY-02 | Operators per attribute type: is/is not, contains, is empty/not empty, before/after/between, relative dates (today, this week, next N days, overdue), any-of/all-of for multi-select, *links to / linked from* for relations. | M        |
| FR-QRY-03 | **Context-aware filters**: "links to *this note*", "source is *this note*", "created on *this daily note's date*". This makes queries useful in templates.                                                                    | M        |
| FR-QRY-04 | **Cross-type queries** through relations, one level deep: e.g. *Tasks whose source is a Meeting where attendees contains [[Petra]]*.                                                                                          | M        |
| FR-QRY-05 | Views: **Table** (editable cells write to frontmatter), **List**, **Board** (group by select), **Calendar** (by any date attribute). Gallery/cards: S.                                                                        | M        |
| FR-QRY-06 | Queries can be **embedded in any note** as a block (FR-FMT-06), or **saved** as a named query shown in the sidebar/Home.                                                                                                      | M        |
| FR-QRY-07 | Each type has default views (FR-TYP-09); users can add more views per type (e.g. Books: "Currently reading" board, "Read in 2026" table).                                                                                     | M        |
| FR-QRY-08 | Creating an object from within a query view pre-fills the attributes that match the filters (e.g. a new card in the "In progress" column gets status = In progress).                                                          | S        |
| FR-QRY-09 | Query results update live when files change (including external edits).                                                                                                                                                       | M        |
| FR-QRY-10 | Text query language.                                                                                                                                                                                                          | W (D-09) |

### 6.15 Mindmap block (FR-MMP) (D-05)

| ID        | Requirement                                                                                                                                                 | Pri      |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| FR-MMP-01 | A mindmap block can be inserted into any note; it is stored as a Mermaid `mindmap` code block.                                                              | M        |
| FR-MMP-02 | **Visual editing** (D-36): add child/sibling node with Tab/Enter, edit text inline, drag to re-parent, collapse branches, zoom/pan. Changes write back to Mermaid. A "source" toggle shows the Mermaid code. | M |
| FR-MMP-03 | Mindmap nodes may contain `[[links]]`. A node can be converted into an object (like FR-CNV).                                                                | S        |
| FR-MMP-04 | Per object type, the mindmap block can be included by default via the template ("optional per type"). | M |
| FR-MMP-05 | Exports render the mindmap as an image (FR-EXP).                                                                                                            | M        |

### 6.16 Images & PDFs (FR-ATT) (D-18)

| ID        | Requirement                                                                                                                                              | Pri |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | --- |
| FR-ATT-01 | Add images via paste, drag & drop, file picker, capture/share sheet. Formats: PNG, JPG, GIF, WebP, HEIC (converted to JPG on import, configurable), SVG. | M   |
| FR-ATT-02 | Add PDFs the same way; display as an inline viewer or a link card.                                                                                       | M   |
| FR-ATT-03 | Image resize (stored as `\|width`), alignment, caption (stored as alt text), click to open full-size.                                                    | M   |
| FR-ATT-04 | Deleting the last reference to an attachment does not delete the file; an "Unused attachments" tool lists orphans for cleanup.                           | S   |
| FR-ATT-05 | Warn on files > 20 MB (configurable).                                                                                                                    | S   |
| FR-ATT-06 | Link to a PDF page; PDF annotation/highlight extraction.                                                                                                 | C   |
| FR-ATT-07 | **Images and PDFs are objects** (D-42). Adding an image or PDF (paste, drag & drop, picker, capture, share sheet, import) creates an **Image** or **PDF** object: a small `.md` in `Images/` or `PDFs/` with title, description, tags, `source`, `file: "[[photo.png]]"` and technical metadata (type, size, width/height or page count). The file itself is stored in `_attachments/` (FR-STO-05). Notes embed the **file** (`![[photo.png]]`) so they still render in Obsidian; Tegg resolves that embed to the object, so previews show its metadata and the object's backlinks show every note that uses it. Image and PDF objects appear in search, queries and the graph (filterable by type). | M |
| FR-ATT-08 | The Image/PDF object's title defaults to the file name (or the owning note's title + number for generic names like `image.png`) and can be edited. Renaming the object does not have to rename the file. | M |
| FR-ATT-09 | Deleting a note never deletes the Image/PDF objects it uses. The "Unused attachments" tool (FR-ATT-04) lists Image/PDF objects that no note references, for clean-up. | M |

### 6.17 Templates (FR-TPL) (D-16)

| ID        | Requirement                                                                                                                          | Pri |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------ | --- |
| FR-TPL-01 | Each type can have **multiple templates**, one marked default. A template is a `.md` file in `_templates/<Type>/`.                   | M   |
| FR-TPL-02 | A template defines **attribute default values** and **body structure** (any blocks, including mindmap and query blocks).             | M   |
| FR-TPL-03 | **Variables**: `{{title}}`, `{{date}}`, `{{time}}`, `{{date:FORMAT}}`, `{{yesterday}}`, `{{tomorrow}}`.                              | M   |
| FR-TPL-04 | Query blocks in templates may use **"this note" context** (FR-QRY-03), e.g. the Meeting template contains "Tasks from this meeting". | M   |
| FR-TPL-05 | Templates are applied **only at creation**. Editing a template does not change existing notes.                                       | M   |
| FR-TPL-06 | When creating an object, the user can pick a non-default template (picker shown when > 1 template).                                  | M   |
| FR-TPL-07 | Template files are excluded from search, queries and graph.                                                                          | M   |
| FR-TPL-08 | Prompting for values in a form at creation.                                                                                          | C   |

### 6.18 Version history & trash (FR-HIS) (D-17)

| ID        | Requirement                                                                                                                                                                                                                                           | Pri |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- |
| FR-HIS-01 | Deleting an object moves it to `.trash/` (with its original path remembered). The Trash view allows restore (back to original location) or permanent delete.                                                                                          | M   |
| FR-HIS-02 | Trash is auto-emptied after N days (default 30, configurable).                                                                                                                                                                                        | S   |
| FR-HIS-03 | **Version history**: snapshots of each note are taken automatically (at most every 5 minutes while editing, plus before any bulk/schema operation). The user can view, diff and restore earlier versions. Snapshots are stored **locally** in Application Support (not synced) and kept **90 days**, configurable (D-31). The sync provider's own file versioning is the cross-device backup. | M |
| FR-HIS-04 | Bulk operations (schema rename, import, type change of many objects) create a **restore point** first.                                                                                                                                                | M   |

### 6.19 Import (FR-IMP) (D-10)

| ID        | Requirement                                                                                                                                                                                                                      | Pri              |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| FR-IMP-01 | **Obsidian vault**: the user chooses to **open it in place** (files aren't rewritten until edited; untyped notes are treated as *Page*) or **copy it into a new vault** with type mapping applied (D-36). Frontmatter, wikilinks, embeds, attachments and tags are preserved; Obsidian tags become (virtual) Tag objects (FR-TAG-03). A mapping wizard lets the user assign types by folder, tag or existing frontmatter key. | M |
| FR-IMP-02 | **Notion** export (Markdown & CSV): pages → objects; databases → object types with attributes taken from the database CSV; relations → relation attributes; links rewritten to wikilinks. Details: FR-IMP-07…20; Notion-specific: FR-IMP-12, FR-IMP-13. | M |
| FR-IMP-03 | **Capacities** export (Markdown): one folder per object type with a `type:` key and typed frontmatter → types and attributes. Details: FR-IMP-07…21. **In the MVP** (D-41, §11.1). | M |
| FR-IMP-04 | **Anytype** export (Markdown export; JSON/Protobuf ❓ see Risk R-06): types, relations → attributes.                                                                                                                              | M                |
| FR-IMP-05 | Every import shows a **preview** (counts per type, unresolved links, unsupported content) before writing, creates a restore point (FR-HIS-04), and produces an **import report**.                                                | M                |
| FR-IMP-06 | Kindle / Readwise highlights import: out of scope (D-33). | W |
| FR-IMP-07 | **Input:** a zip archive or an extracted folder. Zips with non-ASCII file names (Czech diacritics, emoji, `?` in titles) are extracted correctly (FR-FMT-12). Large archives (≥ 100 MB) import with progress and can be cancelled. | M |
| FR-IMP-08 | **Type, attribute and value mapping** (in the import preview): source types map to existing types, system types (Task, Daily Note, Page, Tag) or new types; same-named types from different sources/spaces can be merged. Each source attribute maps to a target attribute (with type conversion), a new attribute, or is dropped. Select/status values can be merged (case and typo variants such as "HIgh"/"High") and statuses mapped to semantic states (FR-TSK-02). Comma-separated text holding several people/values can be split into a multi-value field. | M |
| FR-IMP-09 | **Date parsing:** ISO date-times; UTC-midnight date-times converted to date-only (FR-FMT-11); localized strings ("June 9, 2026 4:06 PM"); dates without a year ("Jun 26"), which are flagged and resolved with a year chosen by the user; ranges (`start -> end`) → Date range. | M |
| FR-IMP-10 | **Link rewriting:** all link forms become wikilinks resolved by **source file/ID**, not title alone: `[[Title]]`; Markdown links to URL-encoded relative `.md` paths with Notion 32-hex IDs; Capacities date mentions `[[Date/YYYY-MM-DD]]` → Daily Note links (FR-DLY-08). Unresolvable links (e.g. `[[NOTE/<uuid>]]` to objects that weren't exported) are kept as unresolved links with a marker and listed in the report. | M |
| FR-IMP-11 | **Titles:** the title comes from the source's `title:` (Capacities) or the H1 heading (Notion), never from the file name, which may be truncated, sanitized (e.g. `:` removed) or carry an ID. Notion IDs are stripped. Duplicate titles are handled per FR-LNK-14. | M |
| FR-IMP-12 | **Notion properties:** properties of database rows are read from the database **CSV** (UTF-8 with BOM) and matched to pages by Notion ID. The `Key: value` lines under the H1 are then removed from the body, since they're properties, not content. Duplicate CSVs exported for linked views (`Untitled …_all.csv`) are deduplicated by ID. Relations (`Name (path.md), …`) → relation links. Notion workspace users (e.g. Assignee) → **plain text** (D-47). | M |
| FR-IMP-13 | **Notion structure:** each database → a type (single-column databases such as a glossary become simple types). Child pages are imported **flat** (no hierarchy, D-45); links between parent and child pages are kept as ordinary links. Inline/linked database views inside pages → an embedded query placeholder naming the original view, because view filters aren't in the export. | M |
| FR-IMP-14 | **Media:** Capacities media objects (`Images/*.md` + `Images/Media/*`, `PDFs/*.md` + `PDFs/Media/*`) become Tegg **Image/PDF objects** (D-42) with their title, description, tags and source; the files move to `_attachments/`. Notion images (in sub-folders named after the page) become Image objects too. Generic names (`Untitled (44).png`, `image.png`) are renamed to unique names derived from the owning note. All references are rewritten to `![[…]]`; references to missing files (e.g. PDF preview images) are dropped and reported. | M |
| FR-IMP-15 | **Preserved metadata:** original created/modified timestamps (`createdAt`, `lastUpdated`, `Created on`), not the import time; `reviewed: true` → `review: reviewed`; task `completed` → completed date; `icon`/`coverImage` → icon/cover (FR-TYP-14); `aliases`, `description`. | M |
| FR-IMP-16 | **Queries and views:** Capacities Query objects and Notion database views are exported **without** their definitions. The importer creates saved-query stubs (title, description, "needs rebuilding" flag) and lists them so the user can rebuild them in the visual builder. | M |
| FR-IMP-17 | **Clean-up:** remove invisible characters (zero-width spaces U+200B, BOMs), normalize Unicode (NFC) and line endings, decode `%20`-style paths. | M |
| FR-IMP-18 | Option to convert imported checklist items (`- [ ]`) into Task objects (default: keep them as checklists, D-28), with the source note as `source`. | S |
| FR-IMP-19 | **Import report** saved as a Page in the vault: counts per type, unresolved links with their location, renamed attributes, merged values, assumed years, dropped files, and features the source didn't export (query definitions, tag colors, view filters, comments). The preview shows these losses **before** the import starts. | M |
| FR-IMP-20 | **Re-import:** in the MVP an import is **one-time** (D-49). If the vault already contains objects with the same `import-id`, the preview warns that the import will create duplicates and recommends importing into a new vault. The importer stores the source ID as `import-id` on every object so that "add new only" or "update" re-import can be added in v1.x without importing everything again. | M |
| FR-IMP-21 | **Capacities tags:** tag collections (exported as header-only CSVs) → tags (colors aren't in the export and must be set afterwards). Attributes whose values are links to tag-like objects (e.g. status `[[in progress]]`) → select values. | M |
| FR-IMP-22 | **Capacities spaces:** the user **selects one space** per import run (D-44). Other spaces in the same export can be imported in separate runs, where their types are mapped onto the vault's existing types in the mapping step. | M |
| FR-IMP-24 | **Capacities weblinks** (no Weblink type in Tegg, D-43) → objects of a type chosen in the mapping (default: Page) with `url` and `description` attributes; the stored preview image becomes an Image object used as the cover. | M |
| FR-IMP-23 | **Test corpus:** anonymized copies of real Notion and Capacities exports become part of the import and round-trip test suite (AR-06). The original exports contain personal and work data and must not be committed to a code repository. | M |

### 6.20 Export (FR-EXP) (D-11)

| ID        | Requirement                                                                                                                                                                           | Pri |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- |
| FR-EXP-01 | Export a **single note**, a **selection**, a **query result**, or a **note with its embeds/links up to depth N**.                                                                     | M   |
| FR-EXP-02 | Formats: **PDF**, **HTML** (single file, or a static linked site for multi-note export), **DOCX**, **Markdown bundle (.zip)** with attachments and links rewritten to relative paths. | M   |
| FR-EXP-03 | On export, embeds are inlined, Mermaid mindmaps rendered as images, and query blocks rendered as static tables/lists (snapshot).                                                      | M   |
| FR-EXP-04 | Option to include/exclude the attribute block in exports.                                                                                                                             | S   |
| FR-EXP-05 | PDF: page size (A4/Letter), light theme, page breaks before H1 (optional).                                                                                                            | S   |
| FR-EXP-06 | **Whole-vault export is lossless:** a Markdown bundle of the whole vault includes type definitions, saved-query definitions, tag colors and templates (`.tegg/`, `_templates/`), so nothing is lost the way query definitions and tag colors are lost in Capacities exports. | M |

### 6.21 Sync (FR-SYN) (D-03)

**Phase 1: folder sync via Dropbox / Google Drive desktop clients**
| ID | Requirement | Pri |
|---|---|---|
| FR-SYN-01 | The app works on a vault placed in any synced folder, including **Dropbox, Google Drive and iCloud Drive** (D-36), and makes **no assumptions** about the sync provider. | M |
| FR-SYN-02 | All writes are **atomic** (write temp file → rename), so a sync client never picks up a half-written file. | M |
| FR-SYN-03 | A **file watcher** detects external changes (sync, other editors, Obsidian) and reloads the index within 2 s. If the open note changes externally while it has no unsaved edits, it reloads silently. If both changed, a merge dialog is shown. | M |
| FR-SYN-04 | Detects provider **conflict copies** (e.g. `Note (conflicted copy 2026-10-07).md`, `Note (1).md`), lists them in a "Conflicts" view, and offers side-by-side compare / keep one / merge. | M |
| FR-SYN-05 | Duplicate `id`s (e.g. from conflict copies) are detected and resolved without corrupting links. | M |
| FR-SYN-06 | Writes are minimized (no rewrite of untouched files, no timestamp churn) to reduce sync traffic and conflicts. | M |
| FR-SYN-07 | The app works **fully offline**. | M |

**Phase 2: built-in API sync (prerequisite for mobile)**
| ID | Requirement | Pri |
|---|---|---|
| FR-SYN-20 | Direct Dropbox and Google Drive API sync (OAuth), incremental, with the same conflict rules. | C (Phase 2) |
| FR-SYN-21 | Desktop can use either folder sync or API sync. Mixing both on the same vault on one device is prevented. | C (Phase 2) |
| FR-SYN-22 | iCloud Drive API/CloudKit sync for mobile. As a plain folder location it's already supported in v1 (FR-SYN-01). | C (Phase 2) |

### 6.22 Settings (FR-SET)

| ID        | Requirement                                                                                            | Pri |
| --------- | ------------------------------------------------------------------------------------------------------ | --- |
| FR-SET-01 | Vault location; attachments folder; daily note folder & date format; **default type for new notes** (FR-VLT-05). | M |
| FR-SET-02 | Appearance: light / dark / system theme, font family & size, editor width (narrow/wide), accent color. | M   |
| FR-SET-03 | Date/time format, first day of week. UI language: English in v1 (NFR-OTH-02). | M |
| FR-SET-04 | Keyboard shortcuts customization, including the global hotkeys (FR-CAP-05). | S |
| FR-SET-05 | Menu bar icon on/off; launch at login.                                                                 | M   |
| FR-SET-06 | Trash retention (default 30 days), version history retention (default 90 days). | S |
| FR-SET-07 | Object preview mode: click / hover / off (FR-LNK-12). | M |

---

## 7. UX & Design Requirements (FR-UX)

| ID       | Requirement                                                                                                                                                                                   | Pri                           |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| FR-UX-01 | Visual style: **modern, minimal, spacious**. Generous whitespace, one readable content column, restrained color (type colors as accents only), native-feeling macOS window chrome.            | M                             |
| FR-UX-02 | Layout: left sidebar (navigation), center editor, optional right panel (attributes/backlinks/graph/outline). Both side panels are collapsible; there is a "focus mode" that hides all chrome. | M                             |
| FR-UX-03 | **Keyboard-first**: every action is reachable without the mouse (command palette + shortcuts).                                                                                                | M                             |
| FR-UX-04 | Responsive layout that scales down to tablet/phone widths (prepares for mobile, D-02). Touch targets ≥ 44 pt in components that will be shared with mobile.                                   | M                             |
| FR-UX-05 | Light and dark themes with equal quality.                                                                                                                                                     | M                             |
| FR-UX-06 | Empty states that guide the user (empty inbox, new type with no objects, no backlinks).                                                                                                       | M                             |
| FR-UX-07 | Non-blocking progress for long operations (indexing, import, schema change) with cancel where safe.                                                                                           | M                             |
| FR-UX-08 | Accessibility: VoiceOver labels on controls, sufficient contrast (WCAG AA), respects "Reduce motion".                                                                                         | S                             |
| FR-UX-09 | Onboarding: a short first-run tour + sample vault content.                                                                                                                                    | C (needed for public release) |

**Default keyboard shortcuts (proposal)**
| Action | Shortcut |
|---|---|
| Quick switcher | ⌘O |
| Command palette | ⌘K |
| Search | ⌘⇧F |
| New object (type picker) | ⌘N |
| Today's daily note | ⌘D |
| Inbox | ⌘⇧I |
| Convert block to object | ⌘⇧T (Task), ⌘⇧O (pick type) |
| New tab | ⌘T |
| Quick Capture (global, any app) | ⌃⌥Space |
| New Task (global, any app) | ⌃⌥T |
| Toggle right panel | ⌘\ |
| Open link under cursor / preview it | ⌘↩ / ⌥Space |
| Back / Forward | ⌘[ / ⌘] |

---

## 8. Architecture & Technical Requirements

### 8.1 Technology stack (confirmed, D-19)

| Layer             | Recommendation                                                                                          | Why                                                                                                                                               |
| ----------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| App shell         | **Tauri 2** (Rust core + web UI)                                                                        | Native ARM64 macOS build; small footprint (~10–20 MB vs ~150 MB for Electron); the same codebase targets **iOS and Android** (D-02).              |
| UI                | **TypeScript + React**                                                                                  | Claude Code is very productive in it; largest component ecosystem.                                                                                |
| Block editor      | **ProseMirror-based** (TipTap or BlockNote)                                                             | The most mature foundation for Notion/Anytype-style block editing, with drag handles, slash menus, custom node views (embeds, queries, mindmaps). |
| Markdown ↔ blocks | **unified/remark** (mdast) with custom plugins for wikilinks, embeds, callouts, block IDs, query blocks | Required for Obsidian compatibility and the round-trip guarantee (FR-FMT-07).                                                                     |
| Index             | **SQLite + FTS5** in the Rust core (outside the vault)                                                  | Fast full-text search and attribute queries for 5k+ notes; rebuildable from the files.                                                            |
| File watching     | Rust `notify` crate                                                                                     | Reliable FSEvents on macOS.                                                                                                                       |
| Mindmap           | Mermaid for rendering + a custom visual editor that serializes to Mermaid                               | Satisfies D-05.                                                                                                                                   |
| Export            | Rendered HTML → PDF (WebView print); DOCX via a docx library / Pandoc ❓                                 |                                                                                                                                                   |

**Alternatives considered:** *Native Swift*: best Mac feel, but no Android path (conflicts with D-02). *Electron*: proven (Obsidian), but heavy and no mobile. *Flutter*: cross-platform, but weak rich block-editor ecosystem.

### 8.2 Architectural requirements

| ID    | Requirement                                                                                                                                                            | Pri |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- |
| AR-01 | **Files are the source of truth.** The index is a disposable cache; deleting it and rebuilding it gives the same state.                                                | M   |
| AR-02 | Native **Apple Silicon (arm64)** build. Universal binary for Intel: ❓ (C).                                                                                             | M   |
| AR-03 | Clear separation: **core** (vault I/O, parsing, index, query engine, sync adapters), **UI**, **platform** (menu bar, share extension). The core is reusable on mobile. | M   |
| AR-04 | **Sync adapter interface**, so Phase 2 API sync (FR-SYN-20) plugs in without changing the core.                                                                        | M   |
| AR-05 | **Extension points for AI** (D-12): content access API over the index, an embedding store slot, and a command-palette integration point. Nothing implemented in v1.    | S   |
| AR-06 | Markdown parsing/serialization is covered by a **round-trip test suite** (corpus incl. Obsidian, Notion, Capacities and Anytype exports).                              | M   |
| AR-07 | Schema/type definitions are versioned so future migrations are possible.                                                                                               | M   |
| AR-08 | Code-signed and notarized macOS build, distributed as a **direct-download DMG** (not the Mac App Store in v1; D-32). | M |

---

## 9. Non-Functional Requirements

### 9.1 Performance (NFR-PERF) for a reference vault of 5,000 notes + 2,000 images, on an M1 or newer

| ID          | Metric                            | Target                                          |
| ----------- | --------------------------------- | ----------------------------------------------- |
| NFR-PERF-01 | Cold start to usable UI           | < 2 s                                           |
| NFR-PERF-02 | Initial full index of a new vault | < 30 s, non-blocking (UI usable while indexing) |
| NFR-PERF-03 | Quick switcher results            | < 100 ms per keystroke                          |
| NFR-PERF-04 | Full-text search                  | < 200 ms                                        |
| NFR-PERF-05 | Open a note (typical, < 5k words) | < 150 ms                                        |
| NFR-PERF-06 | Typing latency                    | < 16 ms (60 fps)                                |
| NFR-PERF-07 | Query view with 1,000 results     | < 300 ms; virtualized scrolling                 |
| NFR-PERF-08 | External file change reflected    | < 2 s                                           |
| NFR-PERF-09 | Memory use (idle, vault open)     | < 400 MB                                        |
| NFR-PERF-10 | Quick Capture window open         | < 300 ms                                        |

### 9.2 Reliability & data safety (NFR-REL)

| ID         | Requirement                                                                                                           |
| ---------- | --------------------------------------------------------------------------------------------------------------------- |
| NFR-REL-01 | **Zero data loss**: crash, force quit or power loss must never corrupt or truncate a note (atomic writes; FR-SYN-02). |
| NFR-REL-02 | The app never silently overwrites changes made outside the app (FR-SYN-03).                                           |
| NFR-REL-03 | Corrupt/invalid frontmatter in a file does not crash the app. The file opens in source mode with a warning.           |
| NFR-REL-04 | All destructive bulk operations are preceded by a restore point (FR-HIS-04).                                          |

### 9.3 Portability (NFR-POR)

| ID         | Requirement                                                                                                                        |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| NFR-POR-01 | A vault created by the app opens in **Obsidian** with content, links, embeds, images, attributes and mindmaps (as Mermaid) intact. |
| NFR-POR-02 | File names are valid on macOS, Windows, iOS and Android (no `: \ / * ? " < > \|`, length ≤ 200 chars).                             |
| NFR-POR-03 | No information required to understand a note is stored only in the index.                                                          |

### 9.4 Privacy & security (NFR-SEC)

| ID         | Requirement                                                                                                 |
| ---------- | ----------------------------------------------------------------------------------------------------------- |
| NFR-SEC-01 | No telemetry, analytics or network calls in v1, except optional update checks (opt-in).                     |
| NFR-SEC-02 | Files are stored unencrypted (plain Markdown). Vault/note encryption is out of scope; users rely on macOS FileVault (D-32). |
| NFR-SEC-03 | The share extension and capture window only write to the vault; they never read content back to other apps. |

### 9.5 Other

| ID         | Requirement                                                                                                    |
| ---------- | -------------------------------------------------------------------------------------------------------------- |
| NFR-OTH-01 | Minimum macOS version: **macOS 14 Sonoma** (D-32). |
| NFR-OTH-02 | UI language: **English** in v1, with all UI strings externalized so other languages (e.g. Czech) can be added later. Content in any language/Unicode, including Czech diacritics, works in search and sorting. |

---

## 10. Traceability: initial requirements → this document

| Initial requirement                                                         | Covered by                                                                                                                                                                      |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fast, clean, easy to navigate                                               | FR-NAV, FR-UX, NFR-PERF                                                                                                                                                         |
| Hundreds of notes for various purposes (reading, Zettelkasten, work, trips) | FR-TYP (user types), FR-VLT-02 (sample types), D-06                                                                                                                             |
| Vendor independence, local storage, synced via Dropbox/Drive                | FR-STO, FR-FMT, FR-SYN, NFR-POR                                                                                                                                                 |
| Every note type is an object with customizable attributes                   | FR-TYP-01…05                                                                                                                                                                    |
| User-defined objects                                                        | FR-TYP-01                                                                                                                                                                       |
| System objects: tasks, quick notes                                          | FR-TYP-06, FR-TSK, FR-CAP/INB (+ Daily Note, D-15)                                                                                                                              |
| .md files in one folder with sub-folders                                    | FR-STO-01…03                                                                                                                                                                    |
| macOS ARM                                                                   | AR-02                                                                                                                                                                           |
| Mindmap as optional block per type                                          | FR-MMP                                                                                                                                                                          |
| Blocks convertible to objects                                               | FR-CNV                                                                                                                                                                          |
| Fast switching                                                              | FR-NAV-01…03                                                                                                                                                                    |
| Recent/Home view                                                            | FR-HOM                                                                                                                                                                          |
| Universal search                                                            | FR-SRC                                                                                                                                                                          |
| Embed notes                                                                 | FR-EMB                                                                                                                                                                          |
| Quick Capture inbox with reviewed/unreviewed                                | FR-CAP, FR-INB                                                                                                                                                                  |
| Backlinks                                                                   | FR-LNK                                                                                                                                                                          |
| Graph per note                                                              | FR-GRP                                                                                                                                                                          |
| Pictures                                                                    | FR-ATT (+ PDF)                                                                                                                                                                  |
| Export to common formats                                                    | FR-EXP                                                                                                                                                                          |
| Embedded queries in notes                                                   | FR-QRY-06, FR-FMT-06                                                                                                                                                            |
| Queries per type / across types                                             | FR-QRY-01…04, FR-QRY-07                                                                                                                                                         |
| Modern, minimal, spacious; desktop + future mobile                          | FR-UX, AR-03, §8.1                                                                                                                                                              |
| **Not in the initial requirements; added**                                  | Version history & trash, templates, daily notes, import, conflict handling, external edits, rename/link integrity, settings, performance targets, data safety, file-format spec, tags, hover previews, global hotkeys |

---

## 11. Release Phasing (proposal)

| Phase                          | Scope                                                                                                                                                                                                                                                       |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **MVP (v0.1): "usable daily"** | Vault + file format + index; type system with attributes (incl. **Date range**, description, aliases); block editor; links/backlinks (incl. duplicate titles, date mentions); quick switcher; search; Tasks (list/board) + conversion; Tags; Quick Note + menu bar capture + global hotkeys + Inbox; Daily notes; vault setup (empty/starter) and default type; **Image and PDF objects** (PDFs shown as link card; inline viewer in v1.0); trash; folder sync robustness (FR-SYN-01…07); **Capacities importer** (§11.1). |
| **v1.0: "complete desktop"**   | Visual query builder with all views; embedded queries; calendar view; recurrence; mindmap editor; local graph; templates; version history; PDF inline viewer; share-sheet extension; export (all 4 formats); Obsidian import; rebuilding imported query stubs as real queries; tabs; object previews (click to preview).                                 |
| **v1.x**                       | Notion and Anytype import; Capacities re-import (FR-IMP-20); unlinked mentions; split view; customizable Home; multiple vaults; triage mode; global graph.                                                                                                                                         |
| **v2: mobile**                 | Phase 2 API sync; iOS app; Android app.                                                                                                                                                                                                                     |
| **v3: AI**                     | Summaries, auto-tagging, semantic search, chat with notes (provider TBD).                                                                                                                                                                                   |
| **Public release track**       | Onboarding, licensing/payments, auto-update, website/docs, support.                                                                                                                                                                                         |

### 11.1 Capacities importer in the MVP (D-41)

Everything the importer needs must exist in the MVP, so some items move forward from v1.0:

| Area | In MVP | Deferred |
| --- | --- | --- |
| Import flow | Zip/folder input, **choice of one Capacities space**, preview with type/attribute/value mapping, import report, `import-id` on every object (FR-IMP-05, -07, -08, -19, -20, -22) | Add-new-only / update re-import (v1.x, D-49) |
| Content conversion | Titles, dates, links, date mentions, media, metadata, clean-up, tag collections, spaces (FR-IMP-09…11, -14, -15, -17, -21, -22) | Checklist → Task conversion option (FR-IMP-18, v1.0) |
| Data model | Date range attribute, date-only storage, NFC names, description/aliases, reserved keys, duplicate titles, Image/PDF system types (FR-TYP-02, -06, -08, -15, FR-FMT-11, -12, FR-LNK-14, FR-ATT-07) | — |
| Daily notes | Date mentions so `[[Date/…]]` links resolve (FR-DLY-08) | Time-stamped entries (FR-DLY-09, v1.0) |
| Media | Images and PDFs imported as **Image/PDF objects** (D-42); PDFs shown as link cards | PDF inline viewer (v1.0) |
| Weblinks | Imported as objects of a mapped type (default Page) with `url`, description and cover image (FR-IMP-24) | — (no Weblink type, no metadata fetching, D-43) |
| Queries | Capacities queries imported as **stubs**: Pages flagged "needs rebuilding" with title and description (FR-IMP-16) | Rebuilding them as real queries once the query builder exists (v1.0) |
| Safety | Before importing into a non-empty vault, a **full backup zip** of the vault is created (stands in for restore points, FR-HIS-04, until version history ships in v1.0). Importing into a new vault is the recommended path | Restore points via version history (v1.0) |
| Quality | Import test suite with an anonymized copy of the real Capacities export (FR-IMP-23); acceptance: every object, attachment and link in the export is either imported or listed in the report | — |

**MVP-blocking questions:** all answered (D-42…D-48). OQ-38 (re-import) doesn't block the MVP, because the MVP already stores `import-id`.

---

## 12. Risks & Assumptions

| ID   | Risk / Assumption                                                                                                                                                                      | Mitigation                                                                                |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| R-01 | **Block editor ↔ Markdown round-trip** is the hardest technical part. A rich block model (embeds, toggles, mindmaps, queries) must serialize losslessly to Obsidian-flavored Markdown. | Define the Markdown dialect first; build a round-trip test corpus before UI work (AR-06). |
| R-02 | **Folder-sync conflicts**: Dropbox/Drive have no merge logic, and editing the same note on two devices creates conflict copies.                                                        | FR-SYN-02…06; Phase 2 API sync with proper conflict handling.                             |
| R-03 | **Online-only files** from Dropbox Smart Sync / Google Drive streaming are invisible or slow to the indexer.                                                                           | FR-VLT-03 detection and warning.                                                          |
| R-04 | Renaming a note rewrites links in many files, which means many sync uploads and more conflict risk.                                                                                    | Batch writes; restore point; touch only files that change.                                |
| R-05 | Mac App Store sandboxing limits free folder access (security-scoped bookmarks needed). The share extension needs an App Group. | Direct DMG distribution chosen (D-32); revisit the App Store for a public release. |
| R-06 | Anytype's export formats are partly proprietary (Protobuf/JSON); Markdown export may lose relations.                                                                                   | Start with Markdown export; evaluate JSON import later.                                   |
| R-07 | Tauri mobile (iOS/Android) is newer than its desktop side.                                                                                                                             | Keep the core in Rust/TS with no desktop-only assumptions; spike mobile before v2.        |
| R-08 | Visual Mermaid mindmap editing: Mermaid `mindmap` syntax is indentation-based and limited (no positions or colors per node).                                                           | Accept layout = auto; store extra styling only if Mermaid supports it (OQ-15).            |
| R-09 | Source exports are **lossy** (Capacities: query definitions and tag colors; Notion: view filters, properties in body text, truncated names). Users may blame the importer. | Show the losses in the import preview and report (FR-IMP-19); create stubs to rebuild (FR-IMP-16). |
| R-10 | Real exports used for testing contain **personal and work data**. | Use anonymized copies in the test corpus; never commit originals (FR-IMP-23). |
| A-01 | Assumption: single user, one device editing at a time in most cases.                                                                                                                   |                                                                                           |
| A-02 | Assumption: the user keeps Dropbox/Drive desktop clients running and the vault folder available offline.                                                                               |                                                                                           |

---

## 13. Questions

### 13.1 Open questions

None at the moment. All questions are resolved (D-21…D-49).

### 13.2 Resolved questions (answers applied in v1.1–v1.6, see D-21…D-49)

| ID    | Question                                                                                                                                                                                                                                 | Answer                                                                                                                                                                                 |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OQ-01 | What is the product/working name? (The folder is called "Tegg notes".)                                                                                                                                                                   | Use "Tegg" as the working name                                                                                                                                                         |
| OQ-02 | Is there a generic default type (e.g. *Page/Note*) for notes that are none of the defined types, and for imported plain Markdown? Is it a system type?                                                                                   | Yes, a system type **Page**                                                                                                                                                            |
| OQ-03 | Which user types should a new vault ship with?                                                                                                                                                                                           | Ask user, if they want an empty Vault (will contain only system types) or Default one with Book, Reading Note/Highlight, Zettel (Idea) , Meeting, Person, Project, Trip (all editable) |
| OQ-04 | Can users **add** custom attributes to system types (e.g. add "Context" to Task), while not changing or removing the built-in ones?                                                                                                      | Yes, add only; built-ins are locked                                                                                                                                                    |
| OQ-05 | Are task status and priority values fixed, or user-configurable?                                                                                                                                                                         | Configurable labels/colors; the **semantic** states (open/in-progress/done/cancelled) are fixed so recurrence and "overdue" logic keep working                                         |
| OQ-06 | Recurring tasks: when completed, (a) create the next occurrence as a **new file** and keep the done one as history, or (b) reuse the same file and move the due date?                                                                    | (a) new file; gives history and works with the source embed                                                                                                                            |
| OQ-07 | If the embed of a converted object is deleted from the source note, should the object be deleted too? And if the object is deleted, what does the source show?                                                                           | Removing the embed **does not** delete the object (ask once with "don't ask again"). A deleted object shows as "moved to trash" with a restore option                                  |
| OQ-08 | Should plain checklist items (`- [ ]`) inside notes also appear in Task views (like the Obsidian Tasks plugin), or only Task objects?                                                                                                    | Only Task objects; offer one-click conversion. Keeps one model                                                                                                                         |
| OQ-09 | Do you need **multiple vaults** (e.g. work vs personal)?                                                                                                                                                                                 | Single vault in v1; multiple vaults later                                                                                                                                              |
| OQ-10 | Should Home be fixed or customizable with widgets?                                                                                                                                                                                       | Fixed sections in MVP; customizable in v1.x                                                                                                                                            |
| OQ-11 | Tabs, split view, or both?                                                                                                                                                                                                               | Tabs in v1, split view in v1.x                                                                                                                                                         |
| OQ-12 | Obsidian import: open the existing vault **in place**, or copy and convert into a new vault?                                                                                                                                             | Offer both. In place never rewrites files until edited                                                                                                                                 |
| OQ-13 | Should the file name always equal the title, or should the title be independent (e.g. allowing `/` or `:` in titles)?                                                                                                                    | File name = sanitized title; the full title is in `title:` frontmatter when they differ                                                                                                |
| OQ-14 | Do you need a **global graph** of the whole vault, or is the per-note local graph enough?                                                                                                                                                | Local graph in v1; global in v1.x                                                                                                                                                      |
| OQ-15 | "Mindmap as a specific block for each type (optional)": does this mean (a) any note can insert a mindmap block, plus (b) a type can include one by default via its template? Should editing be visual (node UI) or Mermaid code is fine? | (a)+(b), with a visual node editor that saves to Mermaid                                                                                                                               |
| OQ-16 | Do you accept the recommended stack (Tauri 2 + React/TypeScript + ProseMirror/TipTap + SQLite)?                                                                                                                                          | Yes                                                                                                                                                                                    |
| OQ-17 | Are **tags** a separate concept, or should everything be done with attributes/relations (Capacities-style)?                                                                                                                              | let's treat tag as a system object, for which user can change name and color.                                                                                                          |
| OQ-18 | Should review status (reviewed/unreviewed) be available on **any** type as an opt-in (e.g. Reading notes to review), or only Quick and Daily notes?                                                                                      | for daily notes and quick notes - must for everything else pt-in                                                                                                                       |
| OQ-19 | Version history: store snapshots **inside the vault** (synced across devices, but more Dropbox traffic and storage) or **locally** in Application Support (not synced)? Retention?                                                       | Locally, 90 days; Dropbox/Drive's own file versioning is the cross-device backup                                                                                                       |
| OQ-20 | UI language(s): English only, or also Czech (or others)?                                                                                                                                                                                 | English UI, prepared for localization                                                                                                                                                  |
| OQ-21 | Distribution: Mac App Store, or direct download (notarized DMG)? Minimum macOS version?                                                                                                                                                  | Direct DMG for "me first" (fewer sandbox limits); macOS 14+                                                                                                                            |
| OQ-22 | Is encryption of the vault or specific notes needed?                                                                                                                                                                                     | No (conflicts with plain-Markdown portability); rely on FileVault                                                                                                                      |
| OQ-23 | Reading notes: do you need specific features (Book object with cover image lookup by ISBN, highlights linked to page numbers)? Kindle/Readwise import was not selected. Confirm it's out of scope.                                       | user will define the object as they need it.                                                                                                                                           |
| OQ-24 | Should a global capture **hotkey** and a **web clipper** be confirmed as out of scope? (Not selected.)                                                                                                                                   | Hotkey: add in v1 (cheap). Web clipper: out                                                                                                                                            |
| OQ-25 | Should an object be allowed to have **more than one type**?                                                                                                                                                                              | No, exactly one type, changeable. User can set per Vault the default type for new notes (quick note be default)                                                                        |
| OQ-26 | Reminders/notifications for tasks were not selected. Confirm they're out of v1.                                                                                                                                                          | Out of v1; C                                                                                                                                                                           |
| OQ-27 | Should the app also offer an **iCloud Drive** option (Apple-native, works well with iOS later)?                                                                                                                                          | Yes as a folder location now; API option in Phase 2                                                                                                                                    |
| OQ-28 | How should previews of links and embeds open? | Click to preview, double-click to open; trigger is a global app setting |
| OQ-29 | Should individual objects have their own icon/emoji or cover image, shown instead of the type icon? | Yes |
| OQ-30 | What should the "smart preview" in the graph show? | I need to see what the object is about (its content) |
| OQ-31 | Should tags be nested (`#parent/child`)? | No |
| OQ-32 | Is "create tasks via a global app hotkey" a separate global New Task hotkey? | Yes |
| OQ-33 | **Images & PDFs as objects?** In Capacities every image and PDF is an object with title, description and tags (~110 images, 5 PDFs in your export). Should Tegg do the same, or keep images/PDFs as plain attachments? | Objects |
| OQ-34 | **Weblinks:** you have ~70 Weblink objects. Should Tegg have a *Weblink* system type, and may it fetch title/description/preview image from the internet (an exception to "no network calls")? | No need for a Weblink object |
| OQ-35 | **Capacities spaces** (IDC, PKM, Work) in one export, while v1 has a single vault. How should they be imported? | The user has to select a Capacities space to import |
| OQ-36 | **Sub-pages:** Notion pages are nested (parent → child). Should Tegg support a page hierarchy in general, or only keep it on import? | No need for parent/child support |
| OQ-38 | **Re-import after the first import?** Will you keep working in Capacities for a while after the first import and then import a newer export of the same space? The options are: **(a) One-time move:** import once and stop using Capacities; a second import is treated as a new import. **(b) Add new only:** later imports add objects created in Capacities since the last import and skip objects already imported (matched by `import-id`); changes made in Capacities to already-imported objects are ignored. **(c) Update:** like (b), and objects changed in Capacities are updated in Tegg too. If an object was changed in **both** tools, you choose per object: keep Tegg's version, take Capacities', or compare side by side. Objects deleted in Capacities are flagged, not deleted. | Option (a), one-time move, for the MVP |
| OQ-37 | **Two task dates:** your Capacities tasks use both a date (scheduled) and a deadline. Add `scheduled` to the Task type? | Just due |
| OQ-39 | **Notion people** (e.g. Assignee = a workspace user): import as Person objects or plain text? | Plain text |
| OQ-40 | **Tag groups:** Capacities has tag collections (e.g. PARA, Status). Do you need grouped tags, or are flat tags enough? | No need for collections support; maybe later as a new system object for creating collections, not in the MVP |

---

## 14. Explicitly Out of Scope (v1)

- Mobile apps (iOS/Android); built-in API sync (Phase 2)
- AI features (Phase 3)
- Real-time collaboration, sharing, publishing to web
- Text-based query language
- Task reminders/notifications
- Web clipper; Kindle/Readwise import; built-in reading-specific features (users define their own reading types)
- Non-image/non-PDF attachments (audio, video, office files)
- Encryption (rely on macOS FileVault)
- In v1.x rather than v1: multiple vaults, split view, global graph, customizable Home
- Licensing, payments, accounts, auto-update infrastructure (public-release track)

---

## 15. Appendix: Findings from the Capacities and Notion test exports (2026-10-08)

**Source:** `test exports/`. A Capacities export (94 MB zip, 3 spaces, 696 Markdown files, 108 images, 5 PDFs) and a Notion export (6 MB zip, 226 pages, 8 database CSVs, 11 images). The exports contain personal and work data. They were analysed locally only, and no content is quoted here.

### 15.1 Capacities

| # | Finding | Evidence | Requirement |
| --- | --- | --- | --- |
| C1 | Several **spaces** in one export, with overlapping type names (Tasks, Pages, Images, Queries) | 3 spaces | FR-IMP-22, OQ-35 |
| C2 | Folder per type; every object has `type:` and typed YAML frontmatter, valid in 100% of files | 696 / 696 | FR-IMP-03, FR-IMP-08 |
| C3 | **Date-only values exported as UTC-midnight date-times** (would shift a day in some timezones) | 214 values | FR-FMT-11, FR-IMP-09 |
| C4 | **Date ranges** as `start -> end` text (trip dates, project time frame) | Trips, Projects | FR-TYP-02 |
| C5 | **Images and PDFs are objects**: a metadata `.md` (title, description, tags, size, dimensions) plus the file in `Media/` | 108 images, 5 PDFs | FR-ATT-07, FR-IMP-14, OQ-33 |
| C6 | **Weblinks** are objects (url, domain, description, preview image) | 69 objects | FR-CAP-07, OQ-34 |
| C7 | **Queries exported as empty shells**: title only, definition lost | 11 queries | FR-IMP-16 |
| C8 | **Tag collections exported as header-only CSVs**: tag colors and icons lost | 2 collections | FR-IMP-21, OQ-40 |
| C9 | ~10% of wikilinks don't resolve: date mentions `[[Date/YYYY-MM-DD]]`, `[[NOTE/<uuid>]]` to objects not in the export, select values exported as links (`[[in progress]]`) | 58 of 557 | FR-IMP-10, FR-IMP-21, FR-DLY-08 |
| C10 | **Duplicate titles** within one space | 15 titles | FR-LNK-14 |
| C11 | File names differ from titles (e.g. `:` stripped); generic names `Untitled (n)`, `image (n)` | many | FR-IMP-11, FR-IMP-14 |
| C12 | Tasks have **two dates** (`date` = scheduled, `deadline`) plus a `completed` timestamp | 88 tasks | FR-TSK-13, OQ-37 |
| C13 | Daily notes use **time-stamped entries** and a `reviewed` flag | 146 timestamps, 63 notes | FR-DLY-09, FR-IMP-15 |
| C14 | Attribute names collide with Tegg's reserved keys (`source` as plain text) | 250+ objects | FR-TYP-15 |
| C15 | Common attributes: `description`, `aliases`, `icon`, `coverImage`, `createdAt`, `lastUpdated` | most types | FR-TYP-08, FR-IMP-15 |
| C16 | Several people stored as comma-separated text | 9 values | FR-IMP-08 |
| C17 | Invisible characters (zero-width spaces) in content | 53 | FR-IMP-17 |
| C18 | Inline checklists used heavily | 218 items in 56 notes | FR-IMP-18 |
| C19 | AI chat objects | 1 | Imported as Page (AI phase later) |

### 15.2 Notion

| # | Finding | Evidence | Requirement |
| --- | --- | --- | --- |
| N1 | **Properties aren't in frontmatter**: they're `Key: value` lines under the H1; empty properties omitted | 16 property names | FR-IMP-12 |
| N2 | Database CSVs carry a UTF-8 BOM; linked views exported again as `Untitled …_all.csv` duplicates | 8 CSVs, 2 duplicates | FR-IMP-12 |
| N3 | File and folder names carry 32-hex IDs; links are URL-encoded relative paths | 102 IDs, 441 `%20` | FR-IMP-10 |
| N4 | File names truncated or different from the H1 title | 25 of 226 | FR-IMP-11 |
| N5 | **Localized date strings**, sometimes without a year ("Jun 26") | Timeline, Created on | FR-IMP-09 |
| N6 | Relations as `Name (path.md)` lists; workspace users as usernames | Tasks ↔ Projects, Assignee | FR-IMP-12, OQ-39 |
| N7 | Inconsistent select values (case/typos) | Priority | FR-IMP-08 |
| N8 | **Page hierarchy**: child pages and images in sub-folders named after the parent (depth 3) | Docs | FR-TYP-16, FR-IMP-13, OQ-36 |
| N9 | Broken relative links | 6 of 108 | FR-IMP-10 |
| N10 | No page icons, covers, view filters or comments present in the export | n/a | FR-IMP-16, FR-IMP-19 |

### 15.3 General

| # | Finding | Requirement |
| --- | --- | --- |
| X1 | A standard `unzip` tool failed on non-ASCII file names in the Notion zip; macOS `ditto` worked | FR-IMP-07, FR-FMT-12 |
| X2 | Both exports are lossy; the user must see what's lost before importing | FR-IMP-19, R-09 |
| X3 | Exports contain personal data, so they need anonymizing before they become test fixtures | FR-IMP-23, R-10 |
| X4 | Tegg's own whole-vault export must not repeat these losses | FR-EXP-06 |
