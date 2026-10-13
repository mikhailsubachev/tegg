# Tegg Preview: MS3 slice 3B "Read view"

Build: `main` at the merge of PR #24, installed as `~/Applications/Tegg Preview.app` (`cd app && npm run app:preview`).
Its data (index, UI state, last opened note) is in `~/Library/Application Support/Tegg Preview/`, separate from test runs (D-118).

**Safe on a real vault:** 3B writes nothing to the vault except notes you create with ⌘N or the switcher (D-119).

## What's new

- Notes open **formatted and read-only**: headings, lists, checklists, quotes, Obsidian callouts (foldable), code, tables, highlights.
- `[[links]]` are chips: click or ⏎ opens the note; `[[Note#Heading]]` and `[[Note#^block]]` scroll to the target. Links that don't resolve are red with a dashed underline and do nothing.
- `#tags` open Search filtered by that tag.
- Web links open in your browser; Tegg itself never fetches anything.
- The **Properties** strip shows the note's attributes (dates in your region's format); collapse it with its header.
- **Source view**: `⌥⌘U` or the `</>` button shows the exact file text, read-only, with line numbers.
- Files with broken frontmatter open in the source view with a warning naming the line; they are never rewritten.
- Notes edited, renamed or deleted in another app (Obsidian, Finder) update in place.

## Still TBD (placeholders)

- Editing (3C), embeds of notes (MS4), images and PDFs (MS6), query blocks and mindmaps (v1.0): shown as framed placeholders.
- Date links to a day without a Daily Note: "Coming in MS4".
- Backlinks, Outline, Graph tabs; Home, Inbox, Today, Tasks, Tags pages: as in 3A.

## 15-minute charter

Use a generated vault (`cargo run --release --manifest-path tools/gen-vault/Cargo.toml -- --seed 1 --small-images --out ~/TeggTest`) or a new vault with a few notes copied in.

1. Open a long note from ⌘O. Does it read well in light and dark (⌘, → Theme)?
2. Follow 3–4 links in a row, including one to a heading. Do you land where you expect?
3. Click a tag. Is the Search result what you wanted?
4. Toggle `⌥⌘U` halfway down a note and back. Do you keep your place?
5. Collapse Properties, open another note, relaunch. Is it still collapsed?
6. In Obsidian or a text editor, change a paragraph of the open note. Does Tegg update within 2 s, without moving you?
7. Break a note's frontmatter in a text editor (e.g. remove a closing quote). Is the warning clear?
8. Write down anything that looks wrong or confusing.

Feedback: `docs/feedback/ms3-3b.md` or a GitHub issue labelled `dogfood`.
