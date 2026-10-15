# Tegg Preview: MS3 slice 3C "Editor and autosave"

Build: `main` at the merge of PR #29, installed as `~/Applications/Tegg Preview.app` (`cd app && npm run app:preview`).
Its data (index, UI state, recent vaults) is in `~/Library/Application Support/Tegg Preview/`, separate from test runs (D-118).

**This build edits files.** Every save is atomic, is checked by reading it back before it is written, and never overwrites a change made by another app (FR-SYN-02, NFR-REL-02). Version history is v1.0, so until then use a vault with a backup (Time Machine, or a sync service with file versions), and start with notes you write in Tegg (plan §6).

## What's new

- **Notes are editable** in a block editor: headings, lists, checklists, quotes, callouts, code, tables, dividers. Markdown shortcuts work as you type (`# `, `- `, `[] `, `> `, `**bold**`, `` `code` ``, `[[link]]`, ` ``` ` + ⏎, `---` + ⏎).
- **`/` menu** inserts blocks; **⌘↑ / ⌘↓** move blocks; the block handle (`⋮⋮`) offers Turn into, Duplicate, Delete.
- **Links**: type `[[` to pick a note, or create `Create "<name>"` as a new Quick Note. Links show the target's type icon.
- **Checklists**: click the box to tick it; only that character changes in the file. ⏎ continues the checklist.
- **The title is editable**; it changes the `title:` line only. The file name and links follow renames in MS4 (D-173).
- **Autosave** within about a second; the note toolbar shows `Saving…` / `Saved` / `Not saved`. ⌘S saves at once.
- **Only what you change is written**: unedited blocks keep their exact bytes, so Obsidian and git diffs stay small.
- **Changes from other apps**: a clean note reloads in place; if you have unsaved edits, a dialog offers Keep mine, Keep theirs, Keep both, or Compare. A deleted file shows an alert instead of being recreated.
- **⌘Q and closing the window** save first.
- **Vault switcher** in the title bar (D-219): recent vaults with ⌃⌘1…9, Open folder as vault…, Create new vault…. The logo at the bottom left opens About and Settings (D-220).
- Objects show their type's icon; there is no per-note icon or cover (D-217). Clicking a tag opens the Tags page (D-218).

## Still TBD

- **Editing properties** (dates, tags, attributes in the strip): slice 3D (FR-EDT-07). In 3C they are read-only.
- Embeds, images and PDFs (MS4, MS6), query blocks and mindmaps (v1.0): placeholders, never rewritten.
- Tag pages (MS4): a tag opens the Tags placeholder. Backlinks, Outline, Graph; Home, Inbox, Today, Tasks: as in 3A.
- Renaming the file when the title changes, and updating links (MS4).
- Version history (v1.0).

## Known limits

- An empty checklist item is written as `- [ ]` (Markdown has no box without text); Tegg and Obsidian both show it as an empty checkbox.
- The recent-vaults list starts with the vaults you open in this build.

## 15-minute charter

Use a generated vault (`cargo run --release --manifest-path tools/gen-vault/Cargo.toml -- --seed 1 --small-images --out ~/TeggTest`) or a new vault, opened with the vault switcher's `Open folder as vault…`.

1. Create a note with ⌘N and write a page with a heading, a list, a checklist, a table and a code block, using only Markdown shortcuts and `/`. Does it feel natural?
2. Link two notes with `[[`, including one that doesn't exist yet (Create). Follow the link.
3. Tick and untick checklist items, add one with ⏎, leave the last one empty. Does `Saved` appear each time?
4. Open the same note in Obsidian or a text editor. Is the Markdown what you'd expect? Change a paragraph there: does Tegg reload within 2 s?
5. Type in Tegg, then change the same note in the other app before it saves. Is the conflict dialog clear? Try Compare.
6. Edit a note's title. Does the new title show in the switcher (⌘O) and in links to it?
7. Switch vaults with ⌃⌘1 / ⌃⌘2 while a note has unsaved text. Is the text saved before switching?
8. Quit with ⌘Q right after typing. Is the last edit in the file?
9. Write down anything that looks wrong, confusing, or slow.

Feedback: `docs/feedback/ms3-3c.md` or a GitHub issue labelled `dogfood`.
