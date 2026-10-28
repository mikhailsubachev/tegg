# Type definition fixtures (MS3 slice 3D)

Expected bytes of type files Tegg writes, used by `docs/acceptance/types.md`. Synthetic (D-50). Byte-exact: LF, UTF-8 without BOM, NFC file names and content; don't re-save them in an editor.

| File | Used by | What it is |
| --- | --- | --- |
| `expected/čajovna.yml` | FR-TYP-01 AC-2, AR-07 AC-1 | The exact file a new user type gets when created with Name `Čajovna` and Plural `Čajovny` and nothing else changed: same layout as `vaults/new-empty/` (D-99), default icon `file-text`, colour `gray`, folder = plural, review off, no preview, no attributes, no `description` or `template` key (AP-175, AP-176) |
| `expected/recept.yml` | FR-TYP-01 AC-10 (D-251) | The exact file `Create type "recept"` writes on the shell fixture's undefined type `recept` when the user types Plural `Recepty` and changes nothing else: same layout as `čajovna.yml`, Name `Recept` from the value (AP-191), folder following the plural, no attributes. Approved with D-259 |
| `ops-5a.json` | FR-TSK-02 AC-2…AC-7, FR-TSK-03 AC-2 (ms5-tasks §2.2, D-473) | Option ops (`setOptionState`, `addOption`, `setOptionColor`, `moveOption`, `removeOption`, `renameOption`) on the shipped `task.yml`: the exact one-line edits, the `needOpen` / `needDone` / `optionUsed` refusals and the no-op. Read by `crates/tegg-schema/tests/ac_task_options.rs` |
| `widen.json` | FR-TYP-03 AC-14 (D-808, D-847) | Board TypeJobs E2: each R10 type's wider targets, in R10 order. One table for both sides: `widerTypes` in `@tegg/schema` and `widens` in tegg-core are each checked against it |

Status: accepted (AP-161…AP-184 decided as D-221…D-245; AP-185…AP-194 as D-253…D-262, `docs/acceptance/types.md`).
