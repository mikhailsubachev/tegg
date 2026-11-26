# QA review: slice AND-3 (editing and creating on the phone)

- Branch: `claude/and-3-android-edit`, head `03e97eee` (tree `031b924e`).
- Verify: **mismatch**. The last `./verify push` pass was on tree `254c4b12`, not HEAD's `031b924e`.
- Reviewer: `qa-reviewer` agent, 2026-11-26. Read from the diff against local `main` 130aaff7, the ACs, the contract, BRD D-2542…D-2569 and the changed files. No shell: the `AC-Test-Change` trailers were checked against the BRD decisions only; the gate's `ac-test-protection` check confirms the trailers themselves.
- Verdict: **NOT READY** (1 blocker, 5 major, 9 minor; no confirmed data loss).

## Findings

1. **[blocker] The push gate didn't run on HEAD's tree** (D-60). The commits after the pass change an LA test (`app/e2e-android/android_edit.ac.test.ts`) and the BRD. *Fix:* run `./verify push` (or `./verify merge`) on HEAD.

2. **[major] The phone's slash panel and the keyboard's Enter use different row lists; MM3's `+` and `New <type>` rows reach the phone** (FR-EDT-03 AC-6, contract §4.4, §2.4, FR-SYN-06 AC-57).
   - The panel draws `phoneSlashItems(slashRows(…))` (`app/ui/src/edit/EditorPane.tsx:1782`), but `slash.sel` is set from the unfiltered rows (`:748`) and the keyboard handler picks from them (`:1499`).
   - On the phone, Enter arrives as `insertParagraph`, which `phoneInput` turns into a keydown on the body. So `/tab`, `/mind`, `/que`, `/ima`, `/turn` + Enter run rows §4.4 drops; Image / PDF lead to `media_add*`, which no phone surface may send (D-2518).
   - The `+` trigger (`:741`) isn't gated on the phone: `+` then Enter selects `New Page` and opens the desktop `NewObjectDialog`, a `note_create` §2.4 doesn't list.
   - The highlighted row and the row Enter runs differ.
   - `fr_edt_03_ac6_slash_panel_on_the_phone` only taps rows. No decision covers `+` or New-object rows on the phone.
   - *Fix:* filter once in `slashRows` when `phone`; don't open on `+` on the phone (owner point 2); add Enter and `+` cases to `fr_edt_03_ac6`.

3. **[major] The background flush neither writes nor keeps edits while a typed command is open** (FR-EDT-08 AC-16, AC-17, contract §11.1, §11.2; T1 risk). `Saver.writeOnce` returns without writing while `paused()` (the `/` or `+` panel is open) or `holding` (`app/ui/src/edit/autosave.ts:129`); `flushHidden` (`app/ui/src/pages/NotePage.tsx:518–544`) keeps a recovery copy only when the Saver is blocked or failed. A note backgrounded with the slash panel open loses its last debounced edits if Android stops the app. *Fix:* after the flush, `keep()` whenever edits are still pending; add an L5p case with `/` open at `hidden`.

4. **[major] A changed list item is no longer written in NFC** (FR-FMT-12, CLAUDE.md rule 9; desktop and phone; from `b31de686`, `2a058f32`, `eb3cc59c`). `listItemPatch` renders each changed item (`packages/editor/src/sourceDoc.ts:402`) and writes it through `fitEol` (`:135`) without NFC; before, every changed list went through `fit()` (NFC). `paragraphPatch` normalises its changed span. No test covers an edited NFD item. *Fix:* normalise the rendered item (or its changed span); add a test with an NFD item holding `[[Café]]`.

5. **[major] A checklist tap still toggles while the merge banner holds the note** (contract §10.6, FR-SYN-03 AC-41). The banner sets the editor non-editable (`NotePage.tsx:788`), but the phone's box handler (`EditorPane.tsx:653–686`) and the node view's `toggle` (`packages/editor/src/present.ts:683`) don't check `isEditable`. `keepMine` then writes toggles the user never saw in `Compare`. *Fix:* ignore taps when `!view.editable`; add the case to `fr_syn_03_ac41`.

6. **[major] Build decisions D-2561…D-2567 change the contract and add behaviour without the owner's word** (CLAUDE.md "stop and ask"; as AND-2 finding 4). They rewrite contract §4.1/§8 (`editable` beside a map), §5.1 (`setBlock` scope), §5.2 (typing over or deleting next to a map), §7.7/§8/§10.1 (`mousedown`), and add: a bare `#` opens the tag list (FR-EDT-15 AC-7 says `#` and a letter, or the bar's `Tag`); a checklist tap saves at once; `Give the copy a new id` without a confirmation; NFC create-row echo, shared with the desktop. *Fix:* owner point 1.

7. [minor] **LA FR-EDT-01 AC-19 (e) accepts a blank line** (TS-I5): `/[-*] \[ \] Zavolat\n\n?[-*] \[ \] Nové\n/` (`app/e2e-android/android_edit.ac.test.ts:198`). D-2559 approved either marker, not optional spacing; the regex accepts bug #176's output. *Fix:* `\n[-*] \[ \] Nové\n`, or record the blank line.

8. [minor] **Unrecorded desktop changes:** `PageAlerts`' close glyph `×` became `<Icon name="x">` (`app/ui/src/convert/PageAlerts.tsx:16`); D-2563 lists the NFC create-row echo under the phone although it is shared; the inline-code closer change (`packages/editor/src/rules.ts:113`) is shared (no output change). *Fix:* name them in D-2566.

9. [minor] **The name-blind create check fails open** (contract §3.2, FR-SYN-02 AC-17): `name_taken_at` treats an unreadable listing as "not taken" (`crates/tegg-vault/src/local.rs:831–833`). *Fix:* fail closed.

10. [minor] **`flushHidden` yields before writing** (`NotePage.tsx:537–538`, `setTimeout(0)` after blurring a sheet field), though §11.1 says "within the same task". *Fix:* commit the field synchronously, then flush.

11. [minor] **`Restore file` on the phone fails silently** for errors other than `NameTaken` / `Exists` (`NotePage.tsx:862`). *Fix:* show the desktop's `io` alert.

12. [minor] **Protected-map narrowing can drop the transaction's meta** when a mapped step fails (`packages/editor/src/protect.ts:82`). *Fix:* return `null`, or copy meta, time and selection first.

13. [minor] **Phone NFC and the formatting-state glue don't follow the contract's shape:** `phoneInput` normalises in a `transaction` listener plus a microtask dispatch (`app/ui/src/edit/phoneInput.ts:67, 79`), not an `appendTransaction` (§9.1); `app/ui/src/phone/format.ts` still looks up `formatState` by name (a red-test shim). *Fix:* an `appendTransaction` plugin; import `formatState` directly.

14. [minor] **Missing records:** `qa/manual/and-3.md` (FR-UX-01 AC-10, the owner's design review); CLAUDE.md's Status names AND-3 only up to D-2553.

15. [minor] **The review diff used a stale local `main`** (130aaff7; `origin/main` 09cd5cce is merged into the branch), so the patch carries already-reviewed MM3 changes. *Fix:* update `main` and rerun `./verify merge`.

## Checks that passed

- **Write list (§2.4):** autosave, properties, the checklist, task boxes (`writeTask` with the row's version), Inbox `Reviewed`, creates (`note_create`, `link_create`, `daily_create`), `Keep mine` / `Keep both` follow the desktop paths with their bases; `Restore file` is an exclusive `note_create_exact`; conflict resolution writes then trashes with versions; pins use `pins_apply`; `trash_restore` only for `Undo`; no phone code calls `note_rename`.
- **Recovery copies (CP-4):** `<files_dir>/recovery/<sha256>.json` through `write_local_file`, never the vault; keyed by the native side's vault root and an NFC path (D-2564); dropped after a successful write or any banner choice.
- **NFD names:** `nfdName` on `note_read` / `embed_load`; write controls `aria-disabled` with the reason; Inbox, task and query rows read-only from the core (D-2554); only the vault's own refusal maps to `ReadOnlyName`; no I/O on macOS.
- **Desktop unchanged apart from recorded fixes**, except finding 8.
- **Round trip:** `listItemPatch` re-reads its output and falls back on any mismatch; mailto, #173, #176 and the single-item edits are covered byte for byte (NFC aside, finding 4).
- **No network (NFR-SEC-01):** no fetch or socket code in `phone/`; the test IME is a separate APK with no permissions; `apk-check` refuses test-IME classes and input-method services in product APKs; no `INTERNET` in the release APK.
- **Commands, strings, themes:** every new control carries a registered `data-command`; strings through the catalog; theme tokens only.
- **Test integrity:** the only skips are D-2548's and D-2471's; no `.only`; AND-2 test changes match D-2550/D-2553 and build-time changes match D-2554…D-2560, D-2568, D-2569; red-first exemptions match D-2553 (1).
- **Privacy:** synthetic fixtures only.
- **AC coverage:** every touched AC has its named test; the gaps are findings 2, 3, 5 and the missing manual record (finding 14).

## Points for the owner

1. **Build decisions D-2561…D-2567** (finding 6): approve as written, or say which to change.
2. **`+` and `New <type>` rows on the phone** (finding 2). Proposal: on the phone `+` opens nothing and the slash panel lists only §4.4's rows; a later Android slice can add New object rows with a phone sheet.
3. **NFC of an edited list item** (finding 4). Proposal: write the changed item in NFC, as every rendered block was before.
4. **Taps while the merge banner shows** (finding 5). Proposal: checklist boxes do nothing until a choice is made.
5. **Backgrounding with the `/` or `+` panel open** (finding 3). Proposal: keep a recovery copy whenever edits are still unsaved after the hidden flush.
6. **The create check when a folder listing can't be read** (finding 9). Proposal: refuse the create (fail closed).
