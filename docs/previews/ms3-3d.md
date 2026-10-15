# Tegg Preview: MS3 slice 3D "Types and properties"

Build: `main` at the merge of PR #30, installed as `~/Applications/Tegg Preview.app` (`cd app && npm run app:preview`).
Its data (index, UI state, recent vaults) is in `~/Library/Application Support/Tegg Preview/`, separate from test runs (D-118).

**This build edits notes and type files** (`.tegg/types/*.yml`). Every write is atomic, read back before it replaces the file, and never overwrites a change made by another app (FR-SYN-02, NFR-REL-02). Version history comes in v1.0, so use a vault with a backup, or a generated or new vault.

## What's new

- **Properties panel** on every note, between the title and the body: the type's properties in order, then Tags, Aliases, Source, Review, Created, Modified. Each property has its own control: text, long text, number, checkbox, date, date and time, date range, select, multi-select, URL, e-mail, relation. Only the edited line changes in the file. Keys that aren't properties of the type are under **Other properties (n)**, read-only. The **Properties** header collapses the panel, on every note.
- **Description** is the editable line under the title.
- **Invalid values** stay as written, with a warning icon. Tegg never rewrites them unless you enter a new value.
- **Type page** (`Go to type: …`, or a type in the sidebar): a table with Title, the type's preview properties and Modified. Click a header to sort; the sort is remembered per type. There is a title filter. `New <Type>` creates an object.
- **Type settings** (the type page's `Type settings`): name, plural, icon, colour, folder for new objects, description; add, edit, reorder and delete properties; select options with colours; preview properties; review workflow. Delete a type that has no objects.
- **System types** (Page, Task, Quick Note, Daily Note, Tag, Image, PDF) can change icon, colour, folder, description, preview and review, and get their own properties. Their name and built-in properties are fixed (D-237).
- **New type** (palette `New type…`, or `+` next to Types in the sidebar).
- **Change type**: the type chip in the note header. Only the `type:` line changes. Values the new type doesn't use stay in the file. ⌘Z undoes it.
- **New objects** of any type use the type's folder, default template, default values and review setting. They come from one path (D-245), whether you start from ⌘N, the type page or a relation picker.
- **Starter vault**: `Create new vault…` → `Starter vault` adds Books, Ideas, Meetings, People, Projects, Reading Notes and Trips with templates. `Add starter types…` in the palette adds them to an existing vault, skipping names you already use.
- **Search** opens with the cursor in the search field. The icon picker shows the icons.

## Still TBD

- Renaming a property key or a type, and rewriting values in notes: MS4. Moving existing objects when a type's folder or an object's type changes: MS4.
- Deleting a type that still has objects; bulk type changes with a restore point: MS4.
- Templates beyond the default one, saved views, filters, groups, board and calendar views, editable table cells: v1.0.
- Editing Image/PDF files (MS6), tag colours (MS4) and task recurrence (MS5): shown read-only.
- **Decided for the next slice** from your feedback (D-246…D-252): search on file names with exact-phrase ranking first; the caret in the body when a note opens; `source` as free text; links in text properties; `@` to insert a link; `Create type "<value>"` on the page of a type value that has no definition; a `Columns` menu on the type page instead of `Add column`.

## Known limits

- A `type:` value without a definition (for example `idea` in the generated vault) shows its objects on a type page but has no settings and no type-specific properties until D-251.
- `Add column` on a type page still adds a new property (replaced by `Columns`, D-252).
- `source` is a relation; a plain-text source shows as invalid until D-248.
- Other properties are read-only.

## 15-minute charter

Use a new **Starter vault** (title bar → `Create new vault…` → `Starter vault`), or the generated vault from the 3C charter.

1. Create a Meeting with `New Meeting` on the Meetings page. Is the template there? Fill in the date, attendees (relation: pick a Person, or create one), project and tags from the panel using only the keyboard.
2. Open the note in a text editor. Did only the lines you changed appear? Change a value there: does the panel update without a save?
3. In type settings of Meeting, add a Select property with three coloured options, mark it as a preview property, and reorder the properties. Does the Meetings table show the new column?
4. Sort the table by a column, quit, relaunch. Is the sort kept?
5. Change a Page to Meeting with the type chip, then back. Is anything lost? Try ⌘Z.
6. Change Page's icon and colour. Where does the change show?
7. Create your own type with `New type…`, give it two properties, create two objects, then try to delete the type.
8. Collapse the Properties panel. Does it stay collapsed on other notes and after a relaunch?
9. Write down anything that looks wrong, confusing, or slow.

Feedback: `docs/feedback/ms3-3d.md` or a GitHub issue labelled `dogfood`.
