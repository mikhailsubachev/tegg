# New objects from `/` and `+`: Interface Contract

- **Status:** draft, 2026-11-25. Written by the red-test author before the red tests (D-61), from `docs/acceptance/new-object-menu.md` (R234…R238, D-2602, D-2603, D-2609…D-2611, D-2625…D-2634). Points marked *RT-n* are the red-test author's proposals, listed in the red-test report for the owner.
- **Builds on** [ms3-shell.md](ms3-shell.md) §13 (the editor, `SLASH_ITEMS`, `linkText`, D-184), §14.3 (`note_create(type, title, text)`, create-exclusive, the free stem), [ms5-capture.md](ms5-capture.md) (the create path and its bytes), [ms5-tasks.md](ms5-tasks.md) §11 (conversion, R50, which stays).
- **Writes.** The new object through the one creation path (`note_create`, create-exclusive, first); then the host through the editor's ordinary save (D-82). Opening, filtering and cancelling write nothing.

Until a part is implemented it exists as a stub that compiles and returns a deliberately wrong result (an empty row list, `false`), so a test fails on its assertion, not on an import.

## 1. Static rows (changes ms3-shell §13.3, §13.4)

- `slashItems()` (`@tegg/editor`) and `SLASH_ITEMS` (`shell/registry.ts`) are R234's 19 static rows in R234's order: Blocks (with `mindmap` after `checklist`), Objects (`turnIntoObject`, `embedObject`), Media, Advanced (`query`, then `blockEmbed`). The `task` row is gone, and the catalog key `slash.task` with it.
- The New object rows are never in `slashItems()` or `SLASH_ITEMS` (FR-UX-02 AC-13 is unchanged).

## 2. The menu model (`app/ui/src/edit/slashMenu.ts`, new; RT-4)

```ts
import type { TypeDefDto } from '../ipc/types';    // key, name, plural, folder, icon, color, system, invalid (§2)
export type MenuRow = {
  id: string                                       // the static row's id, or `new:<type key>`
  group: 'blocks' | 'objects' | 'media' | 'advanced' | 'newObject'
  label: string                                    // the shown text: the catalog text, `New <type name>` for a New row
  disabled: boolean                                // `Block embed` (Coming in v1.0)
  type?: string                                    // New rows: the type key
  icon?: string                                    // New rows: the type file's `icon`
}
export function creatableTypes(types: TypeDefDto[]): TypeDefDto[]
export function menuRows(o: { types: TypeDefDto[]; query: string; trigger: '/' | '+' }): MenuRow[]
export function plusOpens(before: string): boolean
```

- `creatableTypes`: Page, Task, Quick Note, then the user types in `collator()` order (D-122, region locale); never Daily Note, Tag, Image, PDF or an `invalid` type (D-2609). The same list as the `New object` picker's targets.
- `menuRows`: the rows the menu shows for that query, in display order. Empty query: R234 in order. With a query: FR-EDT-03 AC-2's matching (folded case and diacritics, NFC/NFD, letters in order) over every group; with `/` the ranking of AC-2; with `+` the matching New rows first, then the other matches in `/`'s order (D-2627).
- `plusOpens(before)`: `before` is the block's text before the `+` (the caret's text block); true at the block start and after whitespace, false after a letter, digit or punctuation (R235, D-2625). Where `+` never opens (code, links, fields) is the editor's context, not this function's.

## 3. The editor (`@tegg/editor`; RT-5)

- `TeggEditor.commands.insertObjectLink(from: number, to: number, c: LinkChoice): boolean` — replaces the document range `from..to` (the trigger and its query, inside one text block) with the link chip for `c` (D-184's text, `linkText`), as one transaction; the caret goes right after the chip. On undo the range comes back as it was before the trigger was typed: the trigger and the query are not restored (D-2631). False when the range is not inside one text block.
- `linkText(c)` (D-2633): when `c.title` contains `|`, `[[` or `]]`, the result has no `|<title>` alias. Every text is NFC (FR-FMT-12).

## 4. The UI

- **The menu** (`listbox` `Insert block`): each group is a `group` element inside the listbox named by its header text (`Blocks`, `Objects`, `Media`, `Advanced`, `New object`), shown also while filtering (D-2627); options as before, New rows with `data-icon` = the type's icon; `Turn into object…` shows `⇧⌘O` (a `kbd`); the heading rows' `H1`…`H3` icons are `aria-hidden`. The listbox has a maximum height of 420 px and scrolls; `+` with no query selects `New Page` and scrolls so every New row is visible.
- **The dialog** (R236): `dialog` `New <type name>`, `textbox` `Title`, `button`s `Cancel` (`data-command="newObject.cancel"`) and `Create` (`data-command="newObject.create"`, `aria-disabled` with the description `Add a title` while the title is empty or spaces); the hint `Creates <folder>/<stem>.md and links it here.` as text inside the dialog.
- **Create:** `note_create(type, title, text)` with the type's new-object bytes (FR-VLT-05, no `source`), then `insertObjectLink` with the path the core returned (never the planned one, FR-CNV-03 AC-5's rule). A failed create inserts and writes nothing, closes the dialog and shows the alert of R238 (`newObject.failed`); the trigger and query stay as typed text.
- **Commands:** `newObject.create`, `newObject.cancel` (section `edit`, `needsVault: true`, no shortcut, not listed in the palette outside the dialog); no palette command creates and links an object (D-2634).
- **Catalog keys** (R238): `slash.group.newObject`, `slash.newObject` (`New {type}`), `newObject.dialog`, `newObject.title`, `newObject.hint`, `newObject.create`, `newObject.cancel`, `newObject.needTitle`, `newObject.failed`.
- **Test hooks:** none new (the fake core records `note_create` and `note_write`; `writeControl({ fail: 'Io', path })` fails the create of that path).
