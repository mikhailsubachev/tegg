# AND-3 owner checks (editing and creating on the phone)

slice: AND-3
checked by: owner (OC-2 and OC-3 passed, D-2542; the rest not yet run)

These need the owner's phone, Google account or sync app, so Claude could not run them (D-62: Claude uses generated
vaults only and never the owner's accounts). They come from `docs/acceptance/android-edit.md` § "Owner checks" and
FR-UX-01 AC-10, and run on the first release APK (D-2042). Use a copy of a generated vault, never the real vault. Record
the results below each item: pass, or each deviation as an issue number or "accepted".

## FR-UX-01 AC-10: design review on the phone

Compare with board `Mobile`'s E1…E4, in light and in dark, with gesture navigation and with three-button navigation:

- [ ] Editing with the formatting bar over the keyboard (E1)
- [ ] The link panel (`[[`, `@`) docked above the keyboard (E2)
- [ ] The type sheet for `New` and a draft's `Title` (E3)
- [ ] The merge banner `Changed outside Tegg` and `Compare versions` (E4)
- [ ] The Properties sheet in edit (E4)

Deviations:

## OC-8: Gboard and your own keyboard

Czech layout, diacritics by long press and by suggestions, autocorrect, glide and voice typing, Enter in lists,
Backspace at block starts and after a link chip, `[[`, `#` and `/`, the formatting bar, typing in `Title` and in the
Properties sheet. The file's diff on the Mac shows only the typed text and `modified` (FR-EDT-01 AC-19, AC-20).

Result:

## OC-9: edits reach the Mac, and back

With the sync app: an edit on the phone shows on the Mac after the sync; a note edited on both before the sync shows
the merge banner on the phone (FR-SYN-03 AC-41) or a conflict copy in Conflicts. Record the copy's name.

Result:

## OC-10: AND-1's OC-1…OC-3 on the release APK

Install and storage access, the index time, the sync app's dot folders, temp files and copy names
(`qa/manual/and-1-checklist.md`).

Result:
