# Expected outputs of the Capacities importer (slice I1; docs/contracts/v1-import.md §16.2)

Hand-written by the test author from `docs/acceptance/import-capacities.md` (R148…R150), the contract's rules (§4.1, §5.2,
§7.1, §7.3, §8) and the input fixtures in `../capacities/`. Synthetic. **Byte-exact: don't open and re-save these files
in an editor.** A change needs a `Fixture-Change:` trailer. The owner approves them before the implementation (as D-99).

Each folder is what an import of the fixture's space `PKM` writes into a **new vault** with the default mapping, the test
clock `2026-11-12T10:00:00+01:00` in Europe/Prague and the ids `01JB5V000000000000000000nn` in write order (objects in
source-path order; the report Page takes the last id).

| Folder | Files | Used by |
| --- | --- | --- |
| `c02-typed-frontmatter/` | `Books/Book 1…6.md`, `Ideas/Idea.md` | FR-IMP-08 AC-8, FR-IMP-03 AC-2 |
| `c09-unresolved-links/` | `Daily/2026-02-01.md`, `Trips/Lisbon.md`, `Trips/Oslo.md` | FR-IMP-19 AC-8, FR-IMP-10 AC-11 |
| `c12-task-dates/` | three of the four Tasks | FR-IMP-15 AC-6 |
| `c14-reserved-keys/` | `Ideas/Feedback loops.md` | FR-IMP-19 AC-8, FR-TYP-15 AC-1 |
| `c15-common-attributes/` | `Pages/Garden plan.md` | FR-IMP-15 AC-6 |
| `c22-link-shapes/` | `Pages/Cíl.md`, `Pages/Tvary odkazů.md` | FR-IMP-10 AC-9 |

## What is deliberately not here (the tests assert the stated facts instead)

- **`plan.json`.** The normalized plan can't be written by hand from the criteria and the contract alone: the effective
  mapping's entries for R148's on-purpose rows (`consumed`), `needsLook`, and the attribute rows of system types aren't
  fixed by a rule. To be generated from the first implementation and approved by the owner.
- **The report Pages.** Their own words marked † in contract §5.3 are not decided, and the blank lines between sections
  aren't fixed. The tests check sections, order and rows with catalog keys.
- **Type files** (`.tegg/types/book.yml`, …): their bytes are `tegg_schema::serialize`'s; the tests check the parsed file.
- **`c12-task-dates/Tasks/Plan the release.md`**: the source has both `date` and `deadline`; no rule says what the
  source `date` becomes when `deadline` gives `due`.
- **`c05-media-objects/`, `c10-duplicate-titles/`**: the system attributes of an Image / PDF object made from a source
  note (`media-type`, `size`, …) and the stem of `Tomáš : Eva` (spaces after sanitizing) come from code, not from a rule.

Assumption in every file here: a source body is kept byte for byte, including the empty line after the frontmatter
(R149 "Body"), so a note with an empty body ends `---\n\n`.
