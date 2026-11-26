// Slice AND-3 (docs/contracts/android-edit.md §10.5; FR-EDT-07 AC-24…AC-26, D-2413, D-2509): the note's properties on the
// phone: the strip of values under the title (the review checkbox first where the note has the review workflow) and
// the `Properties` sheet. A read-only note's sheet shows values; an editable note's sheet holds the attribute panel,
// whose commits go through the editor's save path (one `note_write` with a body edit in the same second).
// Build point: the strip and sheet rendering stays in `read/PropertiesStrip.tsx` (it shares the value cells with the
// desktop's read-only strip); this module is the phone's entry.
export { PhonePropertiesView as PhoneProperties } from '../read/PropertiesStrip';
