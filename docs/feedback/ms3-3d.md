# Feedback: MS3 preview (owner, 2026-10-14)

Triage: **bug** = contradicts an existing AC/decision, fixed with a `bug_*` test first; **change** = new behaviour, needs an AP point and a D-xx before work.

| # | Finding | Triage |
|---|---|---|
| F1 | Global search (⌘⇧F) does not match file names | D-246 |
| F2 | Search does not rank an exact multi-word phrase ("in word") above single-word hits | D-246 |
| F3 | Opening search does not focus the search input | fixed (bug_3d_fr_src_01) |
| F4 | Opening a page for editing should focus the first editable element | D-247 |
| F5 | Type settings show icons as text, not pictures | fixed (bug_3d_fr_typ_01_icon_picker…) |
| F6 | Changing a type's icon does not work | fixed for system types (D-237; bug_3d_fr_typ_06…) |
| F7 | Changing a type's icon colour does not work | works as designed (owner, 2026-10-15) |
| F8 | Page: `source` must be a free-text field | D-248 |
| F9 | Free-text properties (e.g. `description`) should accept links to other notes | D-249 |
| F10 | `@name` should create a link with search, like `[[` | D-250 |
| F11 | On a type page, "Add column" must add a view column, not a property to the type | D-252 |
| F12 | Non-system types: properties cannot be edited | D-251 (the values had no type definition) |
