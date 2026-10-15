# Type definition fixtures (MS3 slice 3D)

Expected bytes of type files Tegg writes, used by `docs/acceptance/types.md`. Synthetic (D-50). Byte-exact: LF, UTF-8 without BOM, NFC file names and content; don't re-save them in an editor.

| File | Used by | What it is |
| --- | --- | --- |
| `expected/čajovna.yml` | FR-TYP-01 AC-2, AR-07 AC-1 | The exact file a new user type gets when created with Name `Čajovna` and Plural `Čajovny` and nothing else changed: same layout as `vaults/new-empty/` (D-99), default icon `file-text`, colour `gray`, folder = plural, review off, no preview, no attributes, no `description` or `template` key (AP-175, AP-176) |
| `expected/recept.yml` | FR-TYP-01 AC-10 (D-251) | The exact file `Create type "recept"` writes on the shell fixture's undefined type `recept` when the user types Plural `Recepty` and changes nothing else: same layout as `čajovna.yml`, Name `Recept` from the value (AP-191), folder following the plural, no attributes. Draft until AP-191 is decided |

Status: draft with AP-161…AP-184 (`docs/acceptance/types.md`), pending owner review.
