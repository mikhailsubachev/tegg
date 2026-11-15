# Tegg

**A local-first note-taking app for macOS. Every note is a typed object, and every object is a plain Markdown file on your disk.**

I have used most of the note apps out there: Notion, Obsidian, Capacities, Anytype, Joplin, Google Keep, OneNote, AFFiNE, MarkText. Most of them lock your notes into their own format or upload them to their cloud. As a contractor I can't keep client data outside approved places. I also wanted my notes to work with Claude Code. So I built my own app.

Tegg keeps everything in a folder you choose (a *vault*), as Markdown that Obsidian can open. Claude Code, scripts and sync tools work on the same files. I have used it for my daily work for two weeks.

> **Status:** an early, single-user app, built for my own workflow. Version 0.3.0 is in [Releases](https://github.com/mikhailsubachev/tegg/releases). The app isn't signed with an Apple Developer ID or notarized yet.

## Features

### Your files, not a database
- **Plain Markdown files** with YAML frontmatter, `[[wikilinks]]`, `![[embeds]]` and callouts. A Tegg vault opens in Obsidian without losing anything.
- **Opening and saving a note without edits doesn't change a byte.** Markdown, HTML and frontmatter keys Tegg doesn't know are kept as they are.
- **Safe writes.** Every file is written atomically (a temporary file, then a rename), and only files that actually changed are written.
- **Changes made outside the app show up within 2 seconds.** Tegg never silently overwrites them. Sync conflicts get their own **Conflicts** page, with both versions side by side.
- **Backups before bulk changes.** Renames, imports and type changes make a restore point first and can be undone. Deleted objects go to **Trash**, a `.trash/` folder in the vault.
- **No network calls and no telemetry.** The search index lives outside the vault and can be rebuilt from the files at any time.

### Objects and types
- **Every note is an object of a type:** Page, Task, Quick Note, Daily Note, Tag, Image, PDF, and your own types such as Meeting, Person, Decision or Project (`Add starter types…` gives you a few).
- **Types define their own properties** (text, long text, number, checkbox, date, date and time, date range, select, multi-select, URL, and relations to other objects), an icon, columns for the type's table, and whether new objects need review. Types are YAML files in `.tegg/types/`.
- **Change type, move and rename** without breaking links. Moving objects between types, deleting a property or deleting a type runs as a job with a backup and an **Undo**.
- **A type page** for each type: a table of its objects with sortable, resizable columns.

### Writing
- **A block editor on Markdown:** headings, lists, checklists, quotes, code blocks, tables, callouts and embeds, with a block menu and ⇧⌘↑ / ⇧⌘↓ to move blocks. `Toggle Markdown source` shows the raw file.
- **Links and backlinks.** Type `[[` to link to any object. The **Backlinks** tab shows who links here.
- **Embeds** of other notes, images and PDFs (`![[…]]`). Images and PDFs are objects too.
- **Object previews.** Hover a link to see the object without leaving the page.
- **Outline.** A rail of short lines on the note's edge shows its headings; hover it or press ⌘J to jump.
- **Mindmaps.** A list in a `> [!mindmap]` callout is drawn as a map, which you can edit from the keyboard in `right` or `spider` layout. It's still a plain list in Obsidian.
- **Daily notes** with `Go to Today` and a date picker.
- **Turn into task / Turn into object** for a selected line or block.

### Tasks
- **Tasks are objects** with a status, a due date and tags.
- **Kanban** grouped by status or tag. Drag cards, or move them with the keyboard, and reorder the status columns.
- **Schedule** view: overdue and today first, then this week, then later.
- **Filter tasks** by text on both views. A new task is one global shortcut away (⌃⌥T).

### Capture and the Inbox
- **Quick Capture from anywhere in macOS** with ⌃⌥Space: a small window opens in under 300 ms. Type a thought and pick a type and a due date. The app also lives in the menu bar.
- **Review workflow.** For each type you choose whether new objects start as *Unreviewed*. Unreviewed objects land in the **Inbox**, ready for triage: convert, append to another note, link, tag, or mark reviewed, one at a time or in bulk.
- **Built for working with Claude Code.** Claude writes decision logs, meeting notes and daily updates as Markdown files straight into the vault. They show up in the Inbox for review, with no app switching and no import step.

### Finding things
- **Search with typo tolerance.** Results are ranked by title first, then aliases, properties and text. The last word matches as a prefix, and words with a similar spelling are found and marked. Matching ignores diacritics, so `dulezite` finds `důležité`.
- **Graph.** A full graph view and a local graph in the right panel show how notes connect, with depth 1–3, filters and saved presets (`.tegg/graph.yml`). The graph can be read as a list and works with VoiceOver.
- **Related notes.** A `Related` tab lists notes that share the most distinctive words with the open one. Czech and English words are compared by stem, so related notes show up even when nothing links them.
- **Saved queries.** Saved queries (`.tegg/queries/*.yml`) are shown as a list or a table, on their own page or as a block inside a note.
- **Tags** with colours, a page per tag, and rename and delete across the vault.
- **Pinned items** in the sidebar.

### Mac app
- **A native macOS app** (Tauri 2, Apple Silicon, macOS 14+), with a menu bar icon, global shortcuts and two-finger swipe for back and forward.
- **Keyboard first.** Every action is in the command palette (⌘K), and shortcuts are listed under `Keyboard shortcuts`.
- **Light and dark themes**, or follow the system. Normal or wide page width, and a focus mode.
- **Several vaults**, with a vault switcher and recent vaults.

### Import
- **Capacities import.** `Import…` takes a Capacities export (a .zip or a folder) through Source, Space, Where, Mapping, Preview and Import steps. Nothing is written before the last step, an existing vault is backed up first, and a failed import is rolled back.

### Performance
Tegg is built against strict performance targets. They are checked by automated benchmarks on generated vaults of 5,000 to 20,000 notes, on an M2 Pro.

| What | Target |
|---|---|
| Cold start to a usable window | < 2 s |
| Open a note | < 150 ms |
| Full-text search | < 200 ms |
| Typing | ≥ 95 % of keystrokes drawn in the next frame |
| Quick Capture window | < 300 ms |
| Local graph, depth 2 | < 300 ms p95 |
| Related notes on 20,000 notes | < 100 ms p95 |
| Initial index of a new vault | < 30 s, with the app usable meanwhile |

## Install

1. Download `Tegg-<version>.dmg` from [Releases](https://github.com/mikhailsubachev/tegg/releases) and drag Tegg to Applications.
2. The app isn't notarized yet, so macOS blocks the first launch. Right-click Tegg.app › **Open** and confirm. You only need to do this once.
3. Choose `Create new vault…` or `Open folder as vault…`. An existing Obsidian folder works too.

Requires macOS 14 or later on Apple Silicon.

## Vault layout

```
<vault>/
  Pages/ Tasks/ Quick Notes/ Daily/ Tags/ Images/ PDFs/ <your types>/   one folder per type
  _attachments/        image and PDF files
  _templates/<Type>/   templates
  .tegg/vault.yml      vault settings
  .tegg/types/*.yml    type definitions
  .tegg/queries/*.yml  saved queries
  .tegg/graph.yml      graph presets
  .trash/              deleted objects
```

A note is an ordinary Markdown file:

```markdown
---
id: 01JD3K…
type: decision
title: Use SQLite for the index
created: 2026-11-14T09:12:00+01:00
review: unreviewed
tags: [architecture]
---

We keep the index in SQLite FTS5 outside the vault, so it can always be rebuilt from the files.
Related: [[Index design]]
```

## Build from source

You need Node.js, Rust and the Xcode command line tools.

```bash
for d in packages/* app tools/qa; do (cd "$d" && npm ci); done
cd app
npm run app:dev                  # run in development
npm run app:release -- 0.3.0     # build Tegg.app and a DMG
```

## How it's built

- **Stack:** Tauri 2 with a Rust core, a React and TypeScript UI, a TipTap/ProseMirror editor working on source blocks, unified/remark for Markdown, and SQLite FTS5 with a `notify` file watcher for the index.
- **Specification first:**
  - The requirements are in [`docs/Business Requirements.md`](docs/Business%20Requirements.md).
  - Acceptance criteria are in [`docs/acceptance/`](docs/acceptance/), and each one is an automated test.
  - The architecture is in [`docs/architecture.md`](docs/architecture.md).
- **Tested locally:** one `./verify` script runs the commit, push, merge and release gates: unit, WebKit and real-app tests, plus performance benchmarks.
- **Built with Claude Code.** Separate Claude agents write the acceptance criteria, write the tests before the code, and review each change against the requirements.
