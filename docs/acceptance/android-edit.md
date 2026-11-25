# Acceptance Criteria: Editing and creating on the phone (slice AND-3)

See [README](README.md) for conventions. Slice **AND-3 "Editing and creating"** of the Android MVP (D-2000…D-2012; plan `docs/plans/android-mvp-plan.md` §3.7, §3.8, §4, §6, §8). AND-1 ([android-shell.md](android-shell.md)) and AND-2 ([android-phone.md](android-phone.md), contract `docs/contracts/android-phone.md`) are built. AND-2's phone layout writes nothing (D-2414) and shows notes in the read view (D-2415). AND-3 replaces the read view with the editor and brings the writes back one by one (RA17):
- the editor `@tegg/editor` on `note/<path>` and daily routes, with a formatting bar above the on-screen keyboard;
- typing with Android keyboards: composition, suggestions, autocorrect, Czech diacritics, Enter and Backspace;
- `[[`, `@`, `#` and `/` panels sized for touch;
- saving under the desktop's rules (round trip, atomic and minimal writes, base checks) and a flush whenever Android may stop the app;
- external changes and the merge of the open note; resolving conflict copies (D-2410);
- creating: `New` with the type picker (D-1431), the Search create buttons (D-2412), `[[` create, the Create offer of a broken link, today's Daily Note;
- task and checklist checkboxes (D-2407), `Reviewed` (D-2403), property values in the Properties sheet (D-2413);
- pinning and moving one note to the trash (D-2406, AP-2079);
- the first released APK (D-2042, D-2043).

**Status: approved, 2026-11-24** (owner: "Accept all proposals"). AP-2065…AP-2090 (end of this file) are decided as proposed (D-2500…D-2525, BRD v1.320). A criterion that names an AP follows its **proposal**. The names used here (`phone-edit/`, the `edit.*` ids, the `phone.edit.*` keys, the test IME, the recovery folder) are proposals for the contract `docs/contracts/android-edit.md`, written after approval.

**Sources of the screens.** The owner's board `Mobile`, section 3 (E1 editing with the bar, E2 link completion, E3 New object, E4 changed on another device) and its "to decide" list ("Properties … editable there in AND-3?", "Merge on the phone: a banner … or the Conflicts page?"). The proposal board `Mobile2` is not available; D-2410 and D-2413 name its E9 and E10, so nothing here relies on them. Board text is design input only.

## Prerequisites

Found while writing these criteria. Each one blocks a later step, not the approval of this file.
- **OC-2 never ran (AP-2065).** Plan §7: if typing with Android keyboards fails, the plan stops. Spike AND-0 left item 3 open (`spikes/android/FINDINGS.md`: injected key events only), and AND-1's OC-2 (`qa/manual/and-1-checklist.md`) is unchecked. Since AND-2, the phone shows no editor (D-2415), so OC-2 can only run on a test APK forced to the desktop layout (`TEGG_LAYOUT=desktop` in `test-env.json`, contract `android-phone.md` §12.1).
- **OC-3 never ran (AP-2066).** The sync app's conflict-copy name is unknown. FR-SYN-04 AC-16 and the merge criteria need it, and so does D-2048's open question (does the sync app upload a rewritten NFD-named file?).
- **OC-1 never ran.** No phone timings exist for D-2010, so AND-3's speed criteria are report-only bounds (AP-2085).
- **No signing keystore yet.** The first APK release (AR-08 AC-7) needs the owner's keystore and its properties file (D-2021, `qa/manual/and-1-checklist.md` step 1).
- **AND-2's owner checks (OC-5…OC-7, FR-UX-01 AC-9) aren't recorded:** there is no `qa/manual/and-2.md`. AND-3's design review (FR-UX-01 AC-10) builds on them.

**Scope.**
- **The editor on the phone:** FR-EDT-01 (the note is the editor, keyboard input, the title), FR-UX-04 (the bar, the keyboard, the caret), FR-EDT-02, FR-EDT-03, FR-EDT-04, FR-EDT-05, FR-EDT-06, FR-EDT-09, FR-EDT-14, FR-EDT-15, FR-EDT-10 (the read view only where the phone can't write), FR-MMP-02 (maps stay read-only).
- **Saving:** FR-EDT-08, FR-FMT-07, FR-FMT-08, FR-FMT-12, FR-SYN-02, FR-SYN-06.
- **External changes and conflicts:** FR-SYN-03 / NFR-REL-02, FR-SYN-04.
- **Creating:** FR-VLT-05, FR-NAV-01, FR-LNK-04, FR-DLY-02.
- **Other writes:** FR-EDT-07, FR-TSK-02, FR-TSK-11, FR-INB-02, FR-HOM-02, FR-HIS-01.
- **Quality and platform:** FR-UX-03, AR-03, FR-UX-08, FR-UX-05, NFR-OTH-02, FR-UX-01, NFR-SEC-01, NFR-PERF-05, NFR-PERF-06, AR-08.

Reference tables RA14…RA19 continue AND-2's RA8…RA13.

**Out of scope.**
- **Still not on the phone (D-2007, D-2006, plan §8):** title rename, type change and `Convert to` (both move the file, D-834), tag rename, delete and merge, schema and type settings, the tidy job, editing views and queries, the Trash page (restore list, empty), version history, capture, import, mindmap editing, the graph, Related notes, the Backlinks panel, previews, the outline rail, the tablet layout.
- **Not in AND-3 (proposed):** block handles, drag and the block menu (AP-2070), block → object conversion (FR-CNV, AP-2069), adding images or PDFs (AP-2083), `Mark all reviewed` and every bulk action (`inbox_bulk` is in RA2's group J), recurrence (v1.0, D-381).
- **AND-4:** built-in Drive sync.
- **Phone performance targets** (D-2010): AND-3 reports numbers and bounds defects only (AP-2085).

**Risk tiers** (test-strategy §3).
- **T1, data loss.** Every write path of RA17 on a partly synced vault: autosave, flush and kill, the first write of drafts and Daily Notes, creates on shared storage, property values, checkboxes, `Reviewed`, pins, the trash, the merge and conflict resolution, NFD-named files. A word doubled or lost by a keyboard's input events is data loss too (FR-EDT-01 AC-19).
- **T2, silently wrong data.** Text saved in NFD, a link written to the wrong target or retargeted by a later arrival, a caret that hides what is typed, a task shown done when its file isn't.

These criteria are marked **(T1)** or **(T2)**. The rest is T3/T4.

**Test layers.** As in [android-phone.md](android-phone.md) (L0, L1, L4, L5, L5p on WebKit and Chromium at 412 × 915 and 360 × 800, LA on the emulator, manual), with these additions:

| Tag | Layer |
| --- | --- |
| L5p (keyboard input) | The helper `ime(page, steps)` (`app/webkit/phone-helpers.ts`) sends RA16's input the way Android keyboards do. On Chromium it uses CDP `Input.imeSetComposition`, `Input.insertText` and `Input.dispatchKeyEvent` with `key: 'Unidentified'`, `windowsVirtualKeyCode: 229`. On WebKit it synthesizes `keydown` (229), `beforeinput` and `input` with RA16's `inputType`s, and `compositionstart` / `compositionupdate` / `compositionend`. The keyboard is emulated as in AND-2 (`__TEGG_TEST__.keyboard(true)` and a 412 × 520 viewport) |
| LA (keyboard input) | The test input method of AP-2084, installed on the emulator only. It calls `setComposingText`, `commitText`, `finishComposingText`, `deleteSurroundingText` and `sendKeyEvent` on the focused field when an `adb shell am broadcast` asks, so a keyboard's calls are repeatable. Gboard itself is the owner's check (OC-8) |
| manual | The owner, on the owner's phone, recorded in `qa/manual/and-3.md` |

**Untouched** and **zero writes** are AND-2's definitions (android-phone.md, test layers). **Writes exactly X** means: the fake core (L5p) or the IPC log (LA) records exactly the write commands listed, each once, on the paths listed, and every other vault file is untouched.

**Fixtures.** Existing fixtures are reused; one small overlay is new (described here, written byte-exact with the red tests, D-50, D-62):
- `editor/` + `new-empty/.tegg/`: Deset bloků, Cíl, Úkoly (`Koupit mléko`, `Velké X`), Prázdná, Bez hlavičky, Seznamy, Chyba uvozovky, Dvojník (both), Štítky (tags `projekt`, `rozpočet`, `čeština`); the runtime files of editor.md (`Pages/Neplatné UTF-8.md`, the edge copies, the 5,000-word note from `tools/gen-vault --perf-note`).
- **New overlay `tests/fixtures/vaults/phone-edit/`**, copied on top of `editor/` + `new-empty/.tegg/` (no names clash). Ids `01JBAN3…E0nn`; LF, NFC, UTF-8 without BOM; `created` and `modified` `2026-10-14T09:00:00+02:00`.
  - `Pages/Psaní.md` (`type: page`, `title: Psaní`), blocks separated by one blank line: `# Nákup`; `- mléko` / `- chléb`; `- [ ] Zavolat` / `- [x] Hotovo`; `1. první` / `2. druhý`; `Text s [[Cíl]] a #projekt.`; `Konec.`
  - `Pages/Mapa v textu.md`: `Před mapou.`; `> [!mindmap] Plán` holding `> - Cesta`, `>   - Vlak`, `>   - [ ] Jízdenky`; `Po mapě.`
  - `Pages/Tabulka.md`: a table `| A | B |` / `| --- | --- |` / `| 1 | 2 |`.
- `conflicts/`, `types/` (Porada, Rozpočet, Prázdná schůzka, Jana Nováková), `backlinks/` (Rozbité odkazy), `tasks/` + `views-tasks/` (T03 `Tasks/Zalít květiny.md`), `inbox/` (Q1…Q8), `daily/` (Kolize), `search/` + `search-page/`, `views/` + `phone/` (Dlouhá poznámka, Mapa výletu, `pinned.yml`), `type-moves/` (Kniha jinde), `shell/` + the NFD-named Poznámka of FR-FMT-12 AC-17, `tests/fixtures/format/roundtrip/`, `tests/fixtures/editor/paste/web.html`, and the generated vault `tools/gen-vault --seed 1 --small-images`.
- **Clock:** `2026-10-14T12:00:00+02:00`, Europe/Prague, region `cs` (each fixture's own clock where its file says so).

---

## Reference tables

### RA14. The note on the phone (FR-EDT-01, FR-EDT-10; D-2415; AP-2067, AP-2068, AP-2070, AP-2071)

| Part | On the phone in AND-3 |
| --- | --- |
| Body | `@tegg/editor`: `textbox` `Note body` (`contenteditable="true"`, `aria-multiline="true"`), the desktop's blocks and inline types. Read-only inside the editor, as on the desktop: source blocks, R5 placeholders, query blocks (D-2006), lossy tables (FR-EDT-02 AC-22). Embeds: as AND-2 (D-2474: no `Display as`, task embeds show status, priority and due as text). Mindmap blocks: protected (FR-MMP-02 AC-37). Tables: cells editable, no row or column actions |
| Title | The app bar's `h1` (AND-2), never editable after the file exists (D-2007). On an unwritten draft (`new/<type>`), `main` starts with the `textbox` `Title` (FR-EDT-01 AC-18) |
| Save state | `status` `Save state` (polite) in the app bar, left of `More actions`, with editor.md R9's texts: `Saved` and `Saving…` as an icon with the text visually hidden, `Not saved`, `Changed outside Tegg` and `Read-only` as visible text |
| Properties | The strip (AND-2) and the sheet `Properties`, now with controls (FR-EDT-07 AC-24…AC-26) |
| `More actions` | `Properties`, `Show Markdown source` / `Show formatted note`, `Pin` / `Unpin`, `Move to trash` (AP-2079) |
| Formatting bar | RA15, only while the body has the focus and the keyboard is shown |
| Panels | RA18: `[[` and `@` (`Link suggestions`), `#` (`Tag suggestions`), `/` (`Insert block`) |
| Read view instead of the editor | The files of editor.md NFR-REL-03 AC-6…AC-8 (invalid frontmatter, invalid UTF-8, the editor failing to load), a file whose on-disk name isn't its NFC form (AP-2077), a path under `.trash/`. `Save state` is `Read-only`; every write control there is `aria-disabled` with its reason |
| Hidden | Block handles (`Add block below`, `Drag to move, click for block menu`), block drag, the menu `Block actions`, block selection (Esc, ⇧-click, ⇧↑/↓), the floating `toolbar` `Formatting` on a selection, the menu `Selection` (editor FR-EDT-05 AC-7), `Turn into object`, `Copy link to block`, `Page width`, focus mode, the outline rail, the command palette (D-2405) |
| Long press | In the body's text: the system's selection (handles and the system menu with `Cut`, `Copy`, `Paste`, `Select all`). On a link chip, a tag, a row, a card and the frame: nothing, as AND-2 (AP-2071) |

### RA15. The formatting bar (FR-EDT-05, FR-EDT-02, FR-EDT-09; board E1; AP-2069)

`toolbar` `Formatting`, 48 px high, directly above the keyboard, padded by the side insets. One row of 48 × 48 px buttons, in this order, scrolling sideways when wider than the viewport (buttons 1…8 fit at 412 px):

| # | Button (name) | Does | Command (proposal) | State |
| --- | --- | --- | --- | --- |
| 1 | `Heading` | Replaces the bar's row with a `radiogroup` `Block type`: `Text`, `Heading 1`, `Heading 2`, `Heading 3`, and `Close`. A choice turns the caret's block into it (R6's written form) and brings the row back | `edit.blockType` | `aria-pressed="true"` in a heading |
| 2 | `Bold` | The mark `**` on the selection, or on what is typed next at a collapsed caret | `edit.bold` | `aria-pressed` |
| 3 | `Italic` | The mark `*` | `edit.italic` | `aria-pressed` |
| 4 | `Link` | With a selection: the link panel with the field `Link` (FR-EDT-05 AC-9). Without: inserts `[[` and opens `Link suggestions` | `edit.link` | — |
| 5 | `Tag` | Inserts `#` (with a space before it when the caret follows a non-space) and opens `Tag suggestions` | `edit.tag` | — |
| 6 | `Bulleted list` | Turns the block into a `- ` list item, or a list item back into a paragraph | `edit.bulletList` | `aria-pressed` in a bulleted item |
| 7 | `Checklist` | Turns the block into a `- [ ] ` item, or back into a paragraph. A checklist item, never a Task object (FR-TSK-11) | `edit.checklist` | `aria-pressed` in a checklist item |
| 8 | `Indent` | Nests a list item one level (Tab of editor FR-EDT-02 AC-17) | `edit.indent` | `aria-disabled` outside list items and on a list's first item |
| 9 | `Outdent` | Un-nests it (⇧Tab) | `edit.outdent` | `aria-disabled` outside list items |
| 10 | `Undo` | editor FR-EDT-09 | `edit.undo` | `aria-disabled` with an empty history |
| 11 | `Redo` | editor FR-EDT-09 | `edit.redo` | `aria-disabled` with nothing to redo |

A tap on a button never takes the focus from the body, never hides the keyboard and keeps the selection (FR-UX-04 AC-10). The bar isn't shown for `Title`, the Properties sheet's fields, `Search query`, the type picker's field or the link panel's field.

### RA16. What Android keyboards send (FR-EDT-01 AC-19; T1)

The expected result is always what the desktop editor does with real key presses on the same document and caret (compared in the same test, `macos` at 1440 × 900).

| On the keyboard | What the WebView gets | Expected result |
| --- | --- | --- |
| Typing a word with suggestions on | `keydown` `Unidentified` / 229, a composition (`compositionstart`, `compositionupdate` per letter, `compositionend` on a space, punctuation, a suggestion or Enter), `beforeinput` `insertCompositionText` | The word once. Nothing uncommitted is saved (FR-EDT-08 AC-15) |
| A suggestion chip | The composition replaced and committed, or `insertReplacementText` over the last word | The suggestion replaces that word only |
| Autocorrect on space | `insertReplacementText` over the previous word, then `insertText` ` ` | The corrected word and one space |
| Long-press accent, symbols, emoji | `insertText` | That text, in NFC (FR-EDT-01 AC-20) |
| Glide typing, voice typing | One composition per word or phrase | As typing it |
| Enter | `beforeinput` `insertParagraph` (`keydown` 229 or `Enter`); during a composition the composition is committed first | ⏎: the block splits; in a list a new item; on an empty item the list ends; in a code block a new line (editor FR-EDT-02 AC-23); in `Title` the title is committed |
| Backspace | `beforeinput` `deleteContentBackward` (`keydown` 229 or `Backspace`), or `deleteSurroundingText` (a one-character selection replaced by nothing) | ⌫: at a block start, the desktop's join or lift; after a link chip or a tag, the whole node in one step (editor FR-EDT-05 AC-5) |
| Paste from the keyboard's clipboard | `insertText`, or `insertFromPaste` with clipboard data | editor FR-EDT-14's rules (FR-EDT-14 AC-8) |

### RA17. What AND-3 writes (D-2414: "AND-3 brings the writes back one by one")

Every row checks its base (the version the view was loaded with) or creates exclusively; a refused write changes nothing.

| # | Action | Where | Commands | Files | Criterion |
| --- | --- | --- | --- | --- | --- |
| 1 | Autosave of the body | editor | `note_write` | the note | FR-EDT-08 AC-15…AC-18, FR-FMT-07 AC-39 |
| 2 | A property value | Properties sheet | `note_write` | the note | FR-EDT-07 AC-24…AC-26 |
| 3 | A checklist item | editor | `note_write` | the note | FR-TSK-11 AC-5 |
| 4 | A task checkbox | task rows, cards, `Tasks due`, task embeds | `note_write` | the task | FR-TSK-02 AC-14 |
| 5 | `Reviewed` | Inbox row, the note's strip | `note_write` | the item | FR-INB-02 AC-18 |
| 6 | A draft's first write | `New` › type picker › draft | `note_create` | one new file | FR-VLT-05 AC-17, FR-EDT-01 AC-18 |
| 7 | `Create “<q>”` | Search | `note_create` | one new file | FR-NAV-01 AC-25 |
| 8 | Create from `[[`, `@` or a relation picker | panels, Properties sheet | `note_create`, then the edited note's `note_write` | one new file and the note | FR-EDT-06 AC-13 |
| 9 | The Create offer | a broken link | `link_create` (and the note's `note_write` when the link is rewritten) | one new file (and the note) | FR-LNK-04 AC-14 |
| 10 | Today's first keystroke | a virtual Daily Note | `daily_create` | one new file | FR-DLY-02 AC-11 |
| 11 | `Keep mine` / `Keep both` | the merge banner | `note_write` / `note_create_exact` | the note / one new file | FR-SYN-03 AC-41 |
| 12 | `Restore file` | the deleted alert | `note_create_exact` | the note's old path | FR-SYN-03 AC-43 |
| 13 | Resolving a conflict pair | `conflicts` | `note_write`, `note_trash` (D-177) | the pair | FR-SYN-04 AC-14, AC-15 |
| 14 | `Pin`, `Unpin` | `More actions` | `pins_apply` | `.tegg/pinned.yml` | FR-HOM-02 AC-33 |
| 15 | `Move to trash`, its `Undo` | `More actions` | `object_trash` (the desktop's `moveToTrash`, D-2527), `trash_restore` | one rename each | FR-HIS-01 AC-16 |

**Machine-local only:** `ui-state.json` as in AND-2, and the recovery copies of AP-2076 (private storage). **Never on the phone:** RA2's groups J and V, `note_rename`, `type_patch`, `vault_settings_patch`, `media_add`, `media_add_paths` (AP-2083), `trash_delete`, `trash_empty`.

### RA18. Panels and sheets (FR-EDT-06, FR-EDT-15, FR-EDT-03, FR-VLT-05, FR-EDT-07; AP-2072, AP-2073, AP-2075)

| Surface | Role / name | Rules |
| --- | --- | --- |
| Suggestion panel | `listbox` `Link suggestions`, `Tag suggestions` or `Insert block` | Docked directly above the keyboard in the formatting bar's place; at most 4 rows in view, each ≥ 56 px, the rest by scrolling inside the panel; the caret's line stays visible above it; a tap on a row keeps the focus in the body and the keyboard shown; it closes as Esc does (the typed trigger stays as text) when the keyboard hides or the caret leaves the trigger |
| Link panel with a field | `dialog` `Link` (non-modal), the field `Link` (`enterkeyhint="done"`) above `Link suggestions` | Opened by the bar's `Link` with a selection; the field has the focus |
| Type sheet | `dialog` `New object` (bottom sheet, `aria-modal`) | The combobox `Choose a type` (not focused at opening, so the keyboard stays hidden until it's tapped) and the `listbox` `Types` of FR-VLT-05 AC-8; also used by `as…` and the Create offer's `Type` |
| Create offer | `dialog` `Create note` (bottom sheet) | backlinks.md FR-LNK-04 AC-4's content |
| Properties sheet | `dialog` `Properties` (AND-2) | Rows with controls (FR-EDT-07 AC-24); a date opens the one date picker (D-763) as a `dialog` within the viewport |
| Merge banner | `alert` `Changed outside Tegg`, directly below the app bar | FR-SYN-03 AC-41 |
| Compare | `dialog` `Compare versions` (full screen within the insets) | `Your version` above `Version on disk`, differing lines `data-diff="changed"`, the banner's choices |
| Merge dialog | `dialog` `Merge versions` (full screen) | FR-SYN-04 AC-15 |

Every sheet closes on its scrim, `Close` and system Back (RA12), and returns the focus to the control that opened it.

### RA19. Strings (catalog keys, English text; NFR-OTH-02)

Proposals for the contract:
- `phone.edit.bar` `Formatting` · `phone.edit.heading` `Heading` · `phone.edit.blockType` `Block type` · `phone.edit.text` `Text` · `phone.edit.bold` `Bold` · `phone.edit.italic` `Italic` · `phone.edit.link` `Link` · `phone.edit.tag` `Tag` · `phone.edit.bulletList` `Bulleted list` · `phone.edit.checklist` `Checklist` · `phone.edit.indent` `Indent` · `phone.edit.outdent` `Outdent` · `phone.edit.undo` `Undo` · `phone.edit.redo` `Redo` (Heading 1…3 reuse the slash menu's keys)
- `phone.title.fixed` `Rename this note on the Mac.`
- `phone.nfdReadOnly` `This note's file name uses a Unicode form the phone can't save safely. Edit it on the Mac.`
- `phone.conflict.title` `Changed outside Tegg` · `phone.conflict.text` `This note changed on disk while you were editing. Nothing is saved until you choose.`
- `phone.recovered` `Tegg kept your unsaved changes to “{title}” on this phone.`
- `phone.keepThis` `Keep this version` · `phone.trashCopy` `Move “{name}” to the trash?`
- `phone.imagesLater` `Adding images comes later on the phone.`

Removed (used nowhere after AND-3): `phone.newLater`, `phone.noNote`, `phone.search.noMatch`. Reused unchanged: editor.md R9 and its alerts, the slash menu, link and tag suggestion keys, capture.md's picker keys (`New object`, `Choose a type…`, `Default`), backlinks.md's offer keys, tasks.md R46, inbox.md R63, trash-media.md R78, `Create “{query}”`, `as…`, `No matches. Create “{query}”?`. `{title}` and `{name}` are user content.

---

### FR-EDT-01 The editor on the phone (adds to AC-1…AC-14)

- **AC-15** **A note is the editor (D-2415; RA14).** With `'android'` at 412 × 915 on `editor/` + `new-empty/.tegg/` + `phone-edit/`:
  - `note/Pages/Psaní.md` has the `textbox` `Note body` (`contenteditable="true"`) holding the body, and the app bar's `h1` `Psaní`.
  - Psaní's and Deset bloků's bodies have the same block structure and text as the desktop editor's (`macos` at 1440 × 900, compared in the same test).
  - The read view (no `contenteditable`) with `Save state` `Read-only` is shown for Chyba uvozovky, the runtime `Pages/Neplatné UTF-8.md`, the editor-load-failure hook (editor.md NFR-REL-03 AC-6…AC-8) and the NFD-named note of FR-FMT-12 AC-18.
  - Opening each note of the fixture and leaving it sends zero writes.

  *(L5p)* Test: `fr_edt_01_ac15_note_is_the_editor_on_the_phone`
- **AC-16** **Opening shows no keyboard; a tap places the caret (AP-2067).**
  - Opening Psaní from a list row, a link, a pin, Back or a cold start puts no caret in it: the focus is on the app bar's `h1` (D-130), and on the device `mInputShown=false` 1 s after `note-ready`.
  - A tap on the word `chléb` puts the caret inside that word and shows the keyboard within 500 ms (`mInputShown=true`) with RA15's bar. Typing `X` saves `X` at the caret, and nothing else changes but `modified`.
  - `Today`, a virtual day and a day with a file alike, opens without a caret or keyboard; a tap in its body places the caret (FR-DLY-02 AC-11).
  - A draft from `New` opens with the caret in `Title` and the keyboard shown (FR-VLT-05 AC-17).
  - Placing the caret and showing the keyboard write nothing.

  *(L5p; LA for the keyboard)* Test: `fr_edt_01_ac16_open_without_keyboard_tap_to_edit`
- **AC-17** **What the phone's editor leaves out (RA14; AP-2070, AP-2071).** On Deset bloků, with the caret in block 5, and then with `blok` selected:
  - none of RA14's hidden parts is in the DOM, no block is `draggable`, and Esc, ⇧-tap and ⇧↓ (a hardware keyboard emulated by Playwright) make no block selection;
  - a long press on `blok` selects it with the system's handles: on the device `actionModeShown()` is true and the system menu lists `Cut`, `Copy`, `Paste` and `Select all`; at L5p the `contextmenu` event in the body isn't prevented, while on a link chip, a tag, a list row and the app bar it still is (contract `android-phone.md` §8.5);
  - a tap on the `[[Cíl]]` chip in Psaní opens Cíl (D-140), and a long press on it does nothing.

  *(L5p; LA for the system menu)* Test: `fr_edt_01_ac17_what_the_phone_editor_leaves_out`
- **AC-18** **The title is fixed once the file exists (D-2007; AP-2068; T1).**
  - On Psaní the title is only the app bar's `h1`, with the description `Rename this note on the Mac.` There is no `textbox` `Title`, and a tap on the `h1` shows no keyboard.
  - On the draft `new/page`, typing `Výlet` into `Title` writes nothing. Enter (`insertParagraph`, RA16) commits it: one `note_create` writes `Pages/Výlet.md` with `title: Výlet` (D-522); the route becomes `note/Pages/Výlet.md`; the caret moves to the start of the body; the title becomes the fixed `h1`.
  - A draft first written by a body change with an empty title is `Pages/Untitled.md` with `title: Untitled` (D-523), and its title is fixed too.
  - No phone surface sends `note_rename`, and no phone action writes `title:` to an existing file (the Properties sheet's `Title` row is read-only, FR-EDT-07 AC-25).

  *(L5p)* Test: `fr_edt_01_ac18_title_fixed_once_the_file_exists`
- **AC-19** **Keyboard input gives the desktop's result (RA16; T1).** On Psaní, each case sent the Android way (L5p on both engines; LA with the test IME, AP-2084) leaves the editor and the saved file equal to what the desktop gets from real key presses on the same document and caret:
  - (a) `Ahoj světe`, each word composed and committed by a space: `Ahoj světe ` once, no letter doubled or lost;
  - (b) the composing `zari` replaced by the suggestion `září`: `září`;
  - (c) autocorrect of `pirvní` to `první` on space: only that word changes;
  - (d) Enter at the end of `chléb` while `chléb` is still composing: `chléb` once and a new empty item after it; Enter on that empty item ends the list; Enter in the middle of `Konec.` splits it;
  - (e) Enter at the end of `Zavolat`: a new `- [ ] ` item;
  - (f) Backspace at the start of `Konec.`, of `chléb`, of `Nákup` and of `první`, and right after the `[[Cíl]]` chip; the same through `deleteSurroundingText`;
  - (g) `[[`, `@`, `#p` and `/` sent by `insertText` and inside a composition open their panels (RA18) as typed keys do.

  In each case the saved file differs from the original only inside the edited blocks and `modified` (FR-FMT-07 AC-9's rule). *(L5p; LA)* Test: `fr_edt_01_ac19_keyboard_input_matches_the_desktop`
- **AC-20** **Czech from the keyboard is saved in NFC (FR-FMT-12; T2).** Through RA16's paths into Psaní:
  - `č` from a long press, `ř` sent in NFD (`r` + U+030C) by `insertText`, and a composition committing `Žluťoučký` in NFD are saved in NFC, with the caret after the inserted text;
  - `👍🏽` (an emoji with a skin-tone modifier) is saved unchanged, and one Backspace after it removes the whole emoji;
  - blocks not edited keep their bytes, NFD included (FR-FMT-12 AC-5);
  - within 2 s of the save, Search for `zlutoucky` lists Psaní.

  *(L5p; LA once with the test IME)* Test: `fr_edt_01_ac20_czech_from_the_keyboard_is_nfc`

### FR-UX-04 Editing on a phone screen (adds to AC-1…AC-7)

- **AC-8** **The bar sits on the keyboard (RA15; AP-2069).**
  - **LA.** On Psaní, a tap in the body shows the keyboard. Within 500 ms of the plugin's `keyboard: true` push, the `toolbar` `Formatting` is shown with its bottom edge at the keyboard window's top (± 2 device px, IME frame from `dumpsys window`), and the bottom bar isn't rendered. Hiding the keyboard (system Back) removes the bar and brings the bottom bar back within 500 ms.
  - **Landscape.** At 915 × 412 (L5p) and with `user_rotation 1` (LA), the bar is above the keyboard, and no button lies under a side cutout or bar (`--inset-left`, `--inset-right`).
  - **Not shown** with the focus in a draft's `Title`, a Properties sheet field, `Search query`, the type picker's field or the link panel's field.
  - **L5p.** With `__TEGG_TEST__.keyboard(true)` and a 412 × 520 viewport, the bar's bottom equals the viewport's bottom (± 1 px).

  *(LA; L5p)* Test: `fr_ux_04_ac8_formatting_bar_on_the_keyboard`
- **AC-9** **The caret stays in view (T2).** On Dlouhá poznámka (`phone/` overlay) with the keyboard emulated:
  - typing 30 new lines at the end of its last paragraph (each `insertParagraph` then `insertText` `Řádek <n>`), after each step the caret's rectangle lies between the app bar's bottom and the bar's top minus 8 px;
  - a tap on a word in the lowest visible line, followed by the keyboard showing, scrolls `main` so that the caret is in that band within 500 ms of the resize;
  - with `Link suggestions` open, the caret's line stays above the panel.

  The tap case runs once on the device. *(L5p; LA once)* Test: `fr_ux_04_ac9_caret_stays_in_view`
- **AC-10** **Taps on the bar and panels keep the keyboard and the selection.** For each RA15 button and for a row of `Link suggestions`:
  - `document.activeElement` is still `Note body` after the tap;
  - on the device the keyboard stays shown (`mInputShown=true` after `Bold`, `Heading` › `Heading 2`, `Undo` and a link row);
  - the selection afterwards is the button's result: after `Bold` on `blok`, `blok` is still selected.

  *(L5p; LA)* Test: `fr_ux_04_ac10_bar_taps_keep_keyboard_and_selection`
- **AC-11** **Touch targets while editing (D-2418).** At 360 × 800, with the bar, the `Block type` row, each panel, the type sheet, the Properties sheet with a field and a date picker open, the Create offer, the merge banner, `Compare versions`, the conflict confirmation and `Merge versions` shown in turn, FR-UX-04 AC-5's rule holds. Checklist and task checkboxes, which AND-2 drew disabled, now have hit areas of at least 48 × 48 px. *(L5p)* Test: `fr_ux_04_ac11_touch_targets_while_editing`

### FR-EDT-02 Blocks from the bar (adds to AC-1…AC-26)

- **AC-27** **The bar's block buttons write R6's forms (RA15).** In Prázdná, from the empty paragraph:
  - `Heading` › `Heading 2`, then `Řádek`, saves `## Řádek`; `Heading` is `aria-pressed` there; `Heading` › `Text` makes it the paragraph `Řádek` again;
  - `Bulleted list`, `jedna`, Enter, `dvě` saves `- jedna` / `- dvě`; `Indent` on `dvě` nests it as editor FR-EDT-02 AC-17 does, and `Outdent` un-nests it; `Bulleted list` pressed in an item makes it a paragraph;
  - `Checklist`, then `úkol`, saves `- [ ] úkol`; `Checklist` again makes it a paragraph;
  - `Indent` is `aria-disabled` in a paragraph and on a list's first item; `Outdent` is `aria-disabled` in a paragraph.

  Each step is one undo step (editor FR-EDT-09 AC-2), and every other block keeps its bytes. *(L5p; L1 for the commands)* Test: `fr_edt_02_ac27_block_buttons_on_the_bar`

### FR-EDT-03 The slash panel on the phone (adds to AC-1…AC-5)

- **AC-6** **Fewer items, same rules (AP-2070).** `/` at a block start opens `Insert block` as RA18's panel, listing exactly `Text`, `Heading 1`, `Heading 2`, `Heading 3`, `Bulleted list`, `Numbered list`, `Checklist`, `Quote`, `Callout`, `Code block` and `Divider`. Not listed: `Table`, `Mindmap`, `Query`, `Embed object`, `Block embed`, `Image`, `PDF`, `Task`, `Turn into object`. Filtering and choosing follow editor FR-EDT-03 AC-2 and AC-4; a tap on a row chooses it. When the panel closes without a choice, `/<query>` stays as text (AC-3). *(L5p)* Test: `fr_edt_03_ac6_slash_panel_on_the_phone`

### FR-EDT-04 Markdown shortcuts from a phone keyboard (adds to AC-1…AC-4)

- **AC-5** **Triggers work without key events.** R7's triggers `- `, `1. `, `[] `, `> `, `## `, `**tučné**`, `==zvýraznění==` and `` `kód` ``, sent by `insertText` and as compositions committed by their space or closing character (RA16), convert as typed keys do (AC-1, AC-2) and save R7's written forms. Mid-paragraph triggers don't convert. The bar's `Undo` right after a conversion restores the literal text in one step (AC-3). *(L5p)* Test: `fr_edt_04_ac5_shortcuts_from_a_phone_keyboard`

### FR-EDT-05 Marks and links from the bar (adds to AC-1…AC-7)

- **AC-8** **Bold and Italic.** With `blok` selected in block 5 of Deset bloků:
  - `Bold` saves `Pátý **blok**, který test upraví.`, and `Italic` saves `*blok*`; pressing the same button again removes the mark;
  - with a collapsed caret after `Pátý `, `Bold` then typing `nové` saves `**nové**`, and `Bold` is `aria-pressed` while the caret is inside it.

  Only block 5 and `modified` change. *(L5p)* Test: `fr_edt_05_ac8_bold_and_italic_from_the_bar`
- **AC-9** **Link (D-145).** With `blok` selected, `Link` opens RA18's link panel with the field `Link` focused:
  - choosing Cíl from its suggestions saves `[[Cíl|blok]]`;
  - `https://example.com/a?b=c` and the keyboard's Done save `[blok](https://example.com/a?b=c)`;
  - `javascript:alert(1)` and `file:///etc/hosts` are refused with editor FR-EDT-05 AC-4's message, and nothing changes;
  - with the caret in a link, `Link` offers `Remove link` (AC-5).

  Without a selection, `Link` inserts `[[` and opens `Link suggestions` (FR-EDT-06 AC-12). *(L5p)* Test: `fr_edt_05_ac9_link_from_the_bar`

### FR-EDT-06 Link completion on the phone (adds to AC-1…AC-11)

- **AC-12** **The panel (RA18; AP-2072).** `[[`, sent as RA16 sends it in Psaní, opens `Link suggestions` in the bar's place, its bottom edge at the keyboard's top (± 2 device px on the device). Each row (≥ 56 px) shows the type icon, the title and, for duplicate titles, backlinks.md FR-LNK-14 AC-6's details. The matching is editor FR-EDT-06 AC-1 and AC-2's: `[[cil`, `[[CÍL` and an NFD `[[cíl` list Cíl first; `[[Dvojník` lists both Dvojník objects; Šablona and Smazaná are never listed. *(L5p; LA once)* Test: `fr_edt_06_ac12_link_panel_on_the_phone`
- **AC-13** **Choosing and creating (AP-2072; T2).**
  - A tap on a row saves editor FR-EDT-06 AC-3 (a)…(e)'s bytes, closes the panel, leaves the caret after the chip and keeps the keyboard.
  - The last two rows are `Create “<q>”` (the default type) and `Create “<q>” as…` (the type sheet), not the board's `New Page “<q>”`. `Create “Nová stránka”` writes exactly `Quick Notes/Nová stránka.md` (`note_create`) and then the edited note with `[[Nová stránka]]`, and doesn't navigate; `as…` › `Page` creates `Pages/Nová stránka.md`.
  - `@` opens the same panel with editor FR-EDT-06 AC-8…AC-10's rules.
  - A note created here has a fixed title (FR-EDT-01 AC-18).

  *(L5p; LA once for the files)* Test: `fr_edt_06_ac13_choose_and_create_on_the_phone`
- **AC-14** **Closing.** The panel closes and leaves `[[<q>` as literal text that reads back as text (editor FR-EDT-06 AC-5): when the keyboard hides (system Back, RA12's first row), and when a tap moves the caret out of the trigger. Typing `]]` closes it and makes a chip (AC-5). Opening and closing write nothing. *(L5p)* Test: `fr_edt_06_ac14_closing_the_link_panel`

### FR-EDT-15 Tag completion on the phone (adds to AC-1…AC-6)

- **AC-7** **The tag panel.** `#` followed by a letter, or the bar's `Tag`, opens `Tag suggestions` as RA18's panel, with tags.md FR-EDT-15 AC-5 and AC-6's spellings, colours and order. On the editor fixture the rows are `#projekt`, `#rozpočet` and `#čeština`:
  - a tap saves `#projekt`;
  - `Create tag “nový-štítek”` saves `#nový-štítek` in NFC and writes no file in `Tags/`;
  - `# ` at a block start still makes a heading and opens no panel.

  *(L5p)* Test: `fr_edt_15_ac7_tag_panel_on_the_phone`

### FR-EDT-09 Undo on the phone (adds to AC-1…AC-6)

- **AC-7** **The bar's `Undo` and `Redo`.** They do what ⌘Z and ⇧⌘Z do, with AC-2's steps; a word composed and committed with the text around it is one typing burst.
  - After AC-3's sequence on Deset bloků, two `Undo`s save the original body; two `Redo`s save the second save's body.
  - With an empty history each is `aria-disabled` and sends nothing.
  - After Back and reopening the note, `Undo` is `aria-disabled` (AC-5).

  *(L5p)* Test: `fr_edt_09_ac7_undo_and_redo_on_the_bar`

### FR-EDT-14 Paste on the phone (adds to AC-1…AC-7)

- **AC-8** **Text pastes, images don't (AP-2083).** In Prázdná:
  - paste from the system menu (`insertFromPaste` with editor FR-EDT-14 AC-1's `text/plain`, then with `web.html` as `text/html`) and from the keyboard's clipboard (`insertText`) give AC-1, AC-3 and AC-6's results;
  - a clipboard holding only `image/png` inserts nothing and shows the notice `Adding images comes later on the phone.`; there are zero writes, and no `media_add` or `media_add_paths` call.

  *(L5p)* Test: `fr_edt_14_ac8_paste_on_the_phone`

### FR-EDT-08 Saving on the phone (adds to AC-1…AC-14)

- **AC-15** **A composition is never saved half-done (T1).**
  - While a word is composing (RA16), no `note_write` contains its uncommitted text, even when the 1 s debounce ends during the composition. After the commit the word is saved, in NFC, within 1 s.
  - When the app goes to the background during a composition, the flush of android-shell.md FR-EDT-08 AC-14 saves the text as shown, the composing word included.
  - **LA.** The test IME composes `zářijo` without committing, the test presses HOME, waits 2 s and runs `am force-stop`: the file contains `zářijo`, and no `.tegg-tmp` file is left.

  *(L5p; LA)* Test: `fr_edt_08_ac15_composition_never_saved_half_done`
- **AC-16** **Android may stop the app at any time (T1).** On the device, each case presses HOME within 300 ms of the last input, then runs `am kill` (a background kill), then starts the app again:
  - (a) `Ahoj` typed at the end of Psaní: the file contains `Ahoj`; the start lands on `note/Pages/Psaní.md` (D-2421) showing it, with no dialog and no further write;
  - (b) a `new/quick-note` draft with `Nákup` typed into `Title` and not committed: the flush is the first write (D-522), `Quick Notes/Nákup.md` with `title: Nákup`, written once;
  - (c) Porada (`types/`) with `Sál B` typed into the Properties sheet's `místo` field and not committed: the flush commits it, one write;
  - (d) Psaní removed from Recents (the task swiped away) instead of HOME: as (a).

  No `.tegg-tmp` file is left (data-safety FR-SYN-02 AC-1). *(LA; L5p for the flush calls)* Test: `fr_edt_08_ac16_android_may_stop_the_app`
- **AC-17** **Edits that can't be written are kept on the phone (AP-2076; T1).** When the app goes to the background while the open note's edits can't be written (the merge banner of FR-SYN-03 AC-41 is shown, or `Save state` is `Not saved` after an `Io` failure):
  - within 100 ms of `hidden`, the editor's content is written to the private files dir (`recovery/`), never into the vault (the vault stays as it was);
  - after `am kill` and a new start, the note opens with the banner `Tegg kept your unsaved changes to “Psaní” on this phone.` and FR-SYN-03 AC-41's choices, `Your version` being the kept text;
  - any choice removes the recovery copy, and `Keep mine` writes it with the disk version as base;
  - with nothing pending, `recovery/` holds no file for the note.

  *(LA; L5p for the hooks)* Test: `fr_edt_08_ac17_unwritable_edits_kept_on_the_phone`
- **AC-18** **The WebView's renderer dies (AP-2086; T1).** On Psaní, with one edit saved 2 s earlier and one typed 100 ms earlier, the test kills the WebView's renderer process (`kill -9` of the app's sandboxed renderer pid):
  - the app process keeps running, and within 5 s the page reloads on `note/Pages/Psaní.md`, showing the file;
  - the file is complete (it parses, its frontmatter is valid) and holds the saved edit; at most the text typed in the last 1 s is missing;
  - no `.tegg-tmp` file is left after the next open.

  *(LA)* Test: `fr_edt_08_ac18_renderer_death_loses_at_most_one_second`

### FR-EDT-07 Editing properties on the phone (adds to AC-1…AC-23)

- **AC-24** **The sheet edits values (D-2413; AP-2074; T1).** On `types/`, the `Properties` sheet of Porada, Rozpočet and Prázdná schůzka has one control per editable row, the desktop panel's R10 control adapted to touch (rows ≥ 48 px; a Select or Multi-select as a list of options; a Date or Date-time through the one date picker, D-763). For each value of types.md FR-EDT-07 AC-5 (a)…(i), AC-6 (relations, with the picker's `Create`), AC-9 (clearing) and AC-18 (links in text):
  - committing it (Done, leaving the field, or the choice itself) writes the same bytes as the desktop panel does for that value (compared in the same test);
  - the write is one `note_write` through the editor's save path with the note's version as base (types.md FR-EDT-07 AC-4).

  The universal rows `Tags`, `Aliases`, `Description` and `Source` are edited as on the desktop (types.md FR-TYP-08 AC-7…AC-10). *(L5p; L1 for the bytes)* Test: `fr_edt_07_ac24_properties_sheet_edits_values`
- **AC-25** **What stays read-only (D-2007, D-834; AP-2074).**
  - In the sheet, `Type` (the type's icon and name, a link to `type/<key>`), `Title`, `Created` and `Modified` have no control. There is no `Change type…`, `Add property` or `Delete property` (D-72).
  - The strip under the app bar shows values only; a tap on a strip value opens the sheet with that row in view.
  - The review control is the strip's checkbox (FR-INB-02 AC-18).

  *(L5p)* Test: `fr_edt_07_ac25_read_only_rows_on_the_phone`
- **AC-26** **Property writes are safe (NFR-REL-02; T1).**
  - Changing `místo` when Porada changed on disk without `vault:changed` is refused with `Conflict`: nothing is written, and the merge banner (FR-SYN-03 AC-41) appears with the new value kept as `Your version`, as for a body edit (D-2528).
  - Closing the sheet (`Close`, the scrim, system Back) with a field typed but not committed commits it first, in one write.
  - A property change and a body edit made within 1 s are saved in one `note_write`.

  *(L5p; L4 for the base check)* Test: `fr_edt_07_ac26_property_writes_are_safe`

### FR-EDT-10 The read view after AND-3 (adds to AC-1…AC-11)

- **AC-12** **Only for files the phone can't write.** AND-2's FR-EDT-10 AC-10 (no `contenteditable`, no keyboard) now holds only for RA14's read-only cases.
  - In those, every checkbox is `aria-disabled` with its reason, a tap writes nothing, and `More actions` lists `Properties` and `Show Markdown source` only.
  - On every other note, `Show Markdown source` saves pending edits first (editor FR-EDT-10 AC-9) and shows the file's text read-only; `Show formatted note` returns to the editor with the caret where it was.

  *(L5p)* Test: `fr_edt_10_ac12_read_view_only_where_the_phone_cant_write`

### FR-FMT-07 Round trip on the device (adds to AC-1…AC-37)

- **AC-38** **Opening in the phone's editor writes nothing (T1).** On the emulator, every file of `tests/fixtures/format/roundtrip/`, in a vault with `new-empty/.tegg/` in shared storage, is opened in the editor. For each, the test taps into three blocks (keyboard shown), scrolls to the end, hides the keyboard, sends the app to the background and back, and leaves with Back. The IPC log has no write command, and every file's SHA-256, size, inode and mtime are unchanged. The same tour at L5p Chromium sends zero writes. *(LA; L5p)* Test: `fr_fmt_07_ac38_opening_on_the_phone_writes_nothing`
- **AC-39** **One edit changes one block, through a phone keyboard (T1).**
  - On the device, ` Doplněno.` typed with the test IME at the end of block 5 of Deset bloků saves a file that differs from the original only inside block 5 and the `modified` line, with editor FR-FMT-07 AC-9's byte list.
  - In test-written copies of `edge/CRLF line endings.md`, `edge/BOM.md` and `edge/No final newline.md`, one typed word keeps the CRLF line ends, the BOM and the missing final newline (editor FR-FMT-07 AC-12).

  *(LA; L5p)* Test: `fr_fmt_07_ac39_one_edit_one_block_on_the_phone`

### FR-FMT-12 NFD names after AND-3 (adds to AC-1…AC-17)

- **AC-18** **A note stored under an NFD name stays read-only on the phone (D-2048; AP-2077; T1).** With android-shell.md FR-FMT-12 AC-17's NFD-named Poznámka on the device:
  - it opens in the read view with the `alert` `This note's file name uses a Unicode form the phone can't save safely. Edit it on the Mac.` and `Save state` `Read-only`;
  - its checkboxes, `Reviewed`, the Properties sheet's controls and `Move to trash` are `aria-disabled` with that text, and no write command names its path (`Pin` stays, since it writes only `pinned.yml`);
  - `[[Poznámka]]` in Úvodní still opens it, and a `[[Poznámka` create from another note writes `Quick Notes/Poznámka (2).md` (vault-wide NFC stems, backlinks.md FR-LNK-14 AC-10);
  - after 10 s, its bytes, name bytes, inode and mtime are unchanged.

  *(LA; L4 for the refusal on the host)* Test: `fr_fmt_12_ac18_nfd_named_note_read_only_on_the_phone`

### FR-FMT-08 File names of objects made on the phone (adds to AC-1…AC-10)

- **AC-11** **Named from the title once, never renamed (D-2007; T2).** Through a draft, Search's `Create “…”` and a `[[` create:
  - the stem is the sanitised title (D-51, D-52, D-68, D-80): the draft title `Q3: plán? #1` is written as `Quick Notes/Q3 plán 1.md` with `title: "Q3: plán? #1"`;
  - a Czech title of 250 UTF-8 bytes gets a stem cut at a character boundary to ≤ 200 bytes, and the full title in `title:`;
  - a stem already used anywhere in the vault (NFC, case-insensitive) gets ` (2)` (backlinks.md FR-LNK-14 AC-10);
  - names are NFC;
  - no later phone action changes the file name or `title:` (FR-EDT-01 AC-18).

  *(L5p; L4 for the names)* Test: `fr_fmt_08_ac11_names_of_objects_made_on_the_phone`

### FR-SYN-02 Atomic writes on the device (adds to AC-1…AC-15)

- **AC-16** **Killed while typing (T1).** Nightly on the emulator:
  - **20 cycles:** the test IME types into block 5 of Deset bloků, one key every 50 ms, and the test sends `kill -9` to the app's process at a random moment 2–10 s after the first key. After each kill, the file parses, its frontmatter is valid, its body is the original with a prefix of the typed text in block 5, and the missing characters are at most those typed in the last 1.2 s.
  - **5 cycles each** during the first write of a draft and of virtual `daily/2026-10-14`: afterwards there is either no file or a complete one.
  - After the next start (with `.tegg-tmp` files older than 1 minute, data-safety FR-SYN-02 AC-4), no temp file is left and none is listed as a note.

  *(LA nightly)* Test: `nightly_fr_syn_02_ac16_killed_while_typing_on_the_phone`
- **AC-17** **A create never replaces a file (D-2047; AP-2078; T1).**
  - Every create of RA17 (rows 6…12) writes and syncs its temp file completely, then checks that the target name is free (NFC and case-insensitively, as shared storage compares names), then renames. With `Quick Notes/Nákup.md` pushed by `adb shell` (temp file, then `mv`) before a draft's first write, the draft becomes `Quick Notes/Nákup (2).md`, and the pushed file keeps its bytes, inode and mtime.
  - At L4, on a fake file system without `RENAME_NOREPLACE` or hard links, no code path renames onto a name that exists at the time of the check.

  *(LA; L4)* Test: `fr_syn_02_ac17_create_never_replaces_a_file`

### FR-SYN-03 / NFR-REL-02 External changes while editing on the phone (adds to AC-1…AC-39)

- **AC-40** **A clean note reloads in place (T2).** On the device, Psaní is open with the caret in `Konec.` at offset 3, the keyboard shown and nothing unsaved. The test replaces `Text s [[Cíl]] a #projekt.` with `Text s [[Cíl]].` through `adb shell` (temp file, then `mv`):
  - within 2 s the editor shows the new text;
  - the caret is still in `Konec.` at offset 3, the keyboard is still shown, and the scroll position holds (± one line);
  - no banner appears and nothing is written;
  - `Undo` is `aria-disabled` (editor FR-EDT-09 AC-5).

  *(LA; L5p)* Test: `fr_syn_03_ac40_clean_note_reloads_in_place_on_the_phone`
- **AC-41** **Both changed: the banner (AP-2075; T1).** Psaní has an unsaved edit in `Konec.` (L5p: the fake core holds writes; LA: `X` typed, then the external `mv` within 200 ms, inside the 1 s debounce), and the file changes on disk:
  - no `note_write` of the editor's version succeeds;
  - within 2 s the `alert` `Changed outside Tegg` appears below the app bar, with `Compare`, `Keep mine`, `Keep theirs` and `Keep both`, and the body stops accepting input (`contenteditable="false"`, the keyboard hides);
  - system Back and the app bar's `Back` don't leave the note while the banner is shown; they move the focus to it;
  - the file keeps the external bytes for as long as the banner is shown (checked again after 10 s);
  - `Compare` opens `Compare versions` (RA18) with `Your version` above `Version on disk`, the differing lines marked, and the same choices;
  - `Keep theirs` shows the disk version and writes nothing. `Keep mine` sends one `note_write` with the disk version as base. `Keep both` creates `Pages/Psaní (conflict 2026-10-14 12-00).md` beside it with the same `id` (`note_create_exact`), the note shows the disk version, and the drawer shows `Conflicts` within 2 s;
  - no text names a device or a time of the other change.

  *(L5p; LA once for `Keep both`)* Test: `fr_syn_03_ac41_both_changed_banner_on_the_phone`
- **AC-42** **Every phone write checks its base (T1).** For each RA17 row that writes an existing file (rows 1…5, 11, 13…15), when the file changed on disk without `vault:changed` (L5p: the fake core; L4: other bytes on disk between the read and the write):
  - the write is refused with `Conflict`, and nothing is written;
  - the view reloads within 2 s and shows that surface's desktop alert (editor.md, types.md, tasks.md, inbox.md, pinned.md, trash-media.md); rows 1 and 2 (the body and a property value) show the merge banner instead (FR-SYN-03 AC-41, D-2528);
  - the file keeps the external bytes.

  *(L5p; L4)* Test: `fr_syn_03_ac42_every_phone_write_checks_its_base`
- **AC-43** **Deleted or renamed while open with unsaved edits (T1).** Psaní has an unsaved edit:
  - the test deletes it (`adb shell rm`), or moves it to `.trash/Pages/`: the editor keeps the content and shows the `alert` `This note was deleted outside Tegg` with `Restore file` and `Discard` (editor FR-SYN-03 AC-17). `Restore file` creates `Pages/Psaní.md` with the editor's content, exclusively; if a file has appeared there meanwhile, AC-41's banner shows instead. `Discard` writes nothing;
  - the sync app renames it to `Pages/Psaní nové.md` (same `id`): the next save goes to the new path, and no file appears at the old one (editor FR-SYN-03 AC-18);
  - without unsaved edits, a delete shows `This note was moved or deleted` at once (android-phone.md FR-SYN-03 AC-38).

  *(L5p; LA once for the delete)* Test: `fr_syn_03_ac43_deleted_or_renamed_while_editing_on_the_phone`
- **AC-44** **New files on a partly synced vault (plan §7; AP-2088; T1, T2).**
  - (a) On virtual `daily/2026-10-14`, `Dnes` is typed and the test pushes another device's `Daily/2026-10-14.md` (another `id`) before the first write (daily FR-DLY-02 AC-7, D-326). The phone's note is written as `Daily/2026-10-14 (2).md`, the pushed file keeps its bytes, and the duplicate notice (D-319) shows without the `Duplicate titles` link (D-2437).
  - (b) After a `[[Lisabon` create made `Quick Notes/Lisabon.md`, the test pushes another device's `Pages/Lisabon.md`. No file is renamed, merged or rewritten. `[[Lisabon]]` in Psaní resolves to the file the desktop's resolution gives for the same vault (dialect §6, compared in the same test), and the `[[` panel lists both Lisabon objects with their details.

  *(LA; L4; L5p)* Test: `fr_syn_03_ac44_new_files_on_a_partly_synced_vault`

### FR-SYN-04 Resolving conflicts on the phone (adds to AC-1…AC-13)

- **AC-14** **Keep one, or give the copy a new id (D-2410; AP-2089; T1).** On `conflicts/`, opening Plán's pair shows AND-2's stacked compare, with `Keep this version` under each version (its path as the button's description) and `Merge…`:
  - each `Keep this version` first asks `Move “<other file>” to the trash?` (`Move to trash`, `Cancel`); `Cancel` writes nothing;
  - keeping `Pages/Plán.md` calls `note_trash` on the copy only; keeping the copy calls `note_write` of its bytes into `Pages/Plán.md` (base: its version), then `note_trash` on the copy (D-177);
  - afterwards `[[Plán]]` and `zdroj: "[[Plán]]"` in Odkazuje resolve to `Pages/Plán.md` with `id` `01JB0K0000000000000000K001`, the pair leaves the list, and the drawer's count drops within 2 s;
  - Rozpočet + Rozpočet kopie also offers `Give the copy a new id`, which writes only the copy's `id` line (editor FR-SYN-04 AC-10);
  - a version changed on disk meanwhile is refused as editor FR-SYN-04 AC-11 says.

  *(L5p; L4 for the vault result; LA once)* Test: `fr_syn_04_ac14_keep_one_on_the_phone`
- **AC-15** **Merge on the phone (D-2410; AP-2089).** `Merge…` opens `Merge versions` (RA18): the version links resolve to as an editable draft (the phone editor, with RA15's bar) above the other version, read-only. Nothing is written until `Done`, which writes the draft into that file (base check) and moves the other to `.trash/`. `Cancel` and system Back write nothing. *(L5p)* Test: `fr_syn_04_ac15_merge_on_the_phone`
- **AC-16** **The sync app's copies are found (AP-2066; T2).** A copy named as OC-3 records (until then, Google Drive's `Plán (1).md`, data-safety FR-SYN-04 AC-2) with Plán's `id`, pushed by `adb shell` (temp file, then `mv`), is listed in `conflicts` within 2 s and resolves by AC-14. A file with that name pattern, its own `id` and fewer than 90 % equal lines isn't listed. *(LA; L4 for the pattern)* Test: `fr_syn_04_ac16_sync_app_copies_are_found`

### FR-SYN-06 Editing writes only what the user changed (adds to AC-1…AC-55)

- **AC-56** **An editing tour (T1).** On `editor/` + `new-empty/.tegg/` + `phone-edit/` on the device:
  - (a) This tour sends zero writes and leaves the vault untouched: opening every note; tapping into three blocks of each; showing and hiding the keyboard; opening and closing every panel without choosing; opening the Properties sheet without changing anything; the type sheet and `Cancel`; `Show Markdown source` and back; `Bold` twice at a collapsed caret; `x` typed and undone within 500 ms; a rotation and back; background and back; a cold start.
  - (b) Then each action writes exactly its RA17 files, once: typing in Psaní for 10 s (Psaní only, at most 10 writes, data-safety FR-EDT-08 AC-2), a checklist toggle in Úkoly, a `[[` create (the new file and Psaní), a draft's first write (one file).

  *(LA; L5p counting writes per path)* Test: `fr_syn_06_ac56_editing_tour_on_the_phone`
- **AC-57** **Still no bulk job and no file move (D-2007, D-2025; AP-2082; T1).**
  - In AC-56's tour and in every L5p test of this file, the fake core or the IPC log records none of `note_rename`, `type_move`, `type_move_plan`, `folder_move_preview`, `tidy_now`, `merge_start`, `tag_rename`, `tag_delete`, `inbox_bulk`, `type_patch`, `vault_settings_patch`, `media_add`, `media_add_paths`, any `query_*` write or any `job_*` command.
  - On `type-moves/`, editing and saving Kniha jinde (a `kniha` outside `Knihy/`) leaves it at its path.
  - android-shell.md FR-SYN-06 AC-53 still holds.

  *(L5p; LA; L4)* Test: `fr_syn_06_ac57_still_no_bulk_job_or_move_on_the_phone`

### FR-VLT-05 New object on the phone (adds to AC-1…AC-15)

- **AC-16** **`New` opens the type sheet (D-1431, D-1432; AP-2073).** On `inbox/`:
  - the bottom bar's `New` is enabled (no `aria-disabled`, no `phone.newLater`);
  - it opens RA18's `New object` sheet: `Choose a type` isn't focused and the keyboard stays hidden, and `Types` lists `Page`, `Task`, `Quick Note`, `Nápad`, `Schůzka` (FR-VLT-05 AC-8's order) with `Quick Note` selected and marked `Default`; with `default-type: nápad`, `Nápad` is;
  - after a tap on the field, typing filters as AC-11;
  - the scrim, `Close` and system Back close it, write nothing and keep the route; the command `object.new` opens it too.

  *(L5p)* Test: `fr_vlt_05_ac16_new_opens_the_type_sheet`
- **AC-17** **A choice opens an unsaved draft (D-520…D-523, D-2007; AP-2073; T1).**
  - A tap on `Nápad` opens `new/nápad`: `Title` in edit mode with the keyboard, the app bar's `h1` `New Nápad`, and `Not saved yet…`. Nothing is written until D-522's first write, which creates `Nápady/<title>.md` with `hodnocení: 3`, `oblast: osobní` and `review: unreviewed` (AC-2).
  - Leaving the draft untouched (Back) writes nothing and drops its history entry (D-521).
  - `Task` opens `new/task`, as on the desktop since D-1906; its first write holds `status: To do` (D-470).
  - With `default-type: Daily Note`, the default row opens today's Daily Note (D-353).

  *(L5p; LA once for the first write)* Test: `fr_vlt_05_ac17_choice_opens_an_unsaved_draft`

### FR-NAV-01 Creating from Search on the phone (adds to AC-1…AC-24)

- **AC-25** **D-1343's buttons (D-2412).** On `search/` + `search-page/`:
  - with `cteni`, the count line ends with `Create “cteni”` and `as…`. `Create “cteni”` writes exactly `Quick Notes/cteni.md` (`note_create`) and opens it with its title fixed and no keyboard (FR-EDT-01 AC-16, AC-18). `as…` opens the type sheet;
  - with `borůvkový koláč`, the empty state says `No matches. Create “borůvkový koláč”?` with both buttons (AND-2's `Nothing matches …` is gone);
  - the keyboard's search key opens the first result (FR-NAV-01 AC-24) and never creates;
  - with no text there are no create buttons.

  *(L5p)* Test: `fr_nav_01_ac25_create_from_search_on_the_phone`

### FR-LNK-04 Broken links on the phone (adds to AC-1…AC-13)

- **AC-14** **The Create offer as a sheet (AP-2090; T1).** On `backlinks/`, a tap on `[[Neexistuje]]` in Rozbité odkazy opens RA18's `Create note` sheet with `No note named "Neexistuje"`, `Type: Quick Note` (FR-VLT-05 AC-3 (a)) and `Create "Neexistuje"`:
  - `Create` writes exactly `Quick Notes/Neexistuje.md` (AC-5) and opens it with its title fixed (FR-EDT-01 AC-18);
  - `[[Q3: plán?]]` is created as AC-7 says, with the clicked link rewritten in the source (one more `note_write`);
  - AC-11's re-check holds; in a read view (RA14) `Create` is `aria-disabled` for AC-7's rewrite case only;
  - AND-2's notice `No note named …` is no longer shown.

  *(L5p)* Test: `fr_lnk_04_ac14_create_offer_on_the_phone`

### FR-DLY-02 Today on the phone (adds to AC-1…AC-10)

- **AC-11** **Virtual until a keystroke (T1).** At the daily fixture's clock, `Today` opens virtual `daily/2026-10-14` in the editor, with `Not saved yet…` and no keyboard (FR-EDT-01 AC-16).
  - Opening it, tapping into the body (keyboard shown), opening panels without choosing and leaving send zero writes (AC-1).
  - Typing `Dnes` writes exactly `Daily/2026-10-14.md` once, through `daily_create`, with AC-2's frontmatter; the marker goes.
  - HOME within 50 ms of the keystroke flushes it (AC-4).

  *(L5p; LA once)* Test: `fr_dly_02_ac11_today_virtual_until_a_keystroke_on_the_phone`

### FR-TSK-02 Task checkboxes on the phone (adds to AC-1…AC-13)

- **AC-14** **Checkboxes complete tasks (D-2407; T1).** On `tasks/` + `views-tasks/` at the tasks clock, the checkboxes of `type/task`'s `All Tasks` rows, the `Schedule` and `Kanban` cards, the Daily Note's `Tasks due` rows and a task embed are enabled. Each is named `Complete "<title>"` or `Mark "<title>" not done` (R43) and carries `task.complete:<path>`.
  - Checking T03 on each surface writes `Tasks/Zalít květiny.md` once with AC-10's bytes; unchecking writes `status: To do` and removes `completed`. Within 1 s the card shows its new state (on `Kanban`, in `Done`).
  - A changed file gives AC-11's alert; a task that would open read-only stays `aria-disabled` (AC-12).
  - On virtual `daily/2026-10-14`, checking writes only the task (FR-DLY-04 AC-12).
  - Status, priority and due controls and card drags stay off (D-2006, D-2474).

  *(L5p; LA once)* Test: `fr_tsk_02_ac14_checkboxes_complete_tasks_on_the_phone`

### FR-TSK-11 Checklist items on the phone (adds to AC-1…AC-4)

- **AC-5** **A tap toggles an item (T1).** In Úkoly, a tap on `Koupit mléko`'s checkbox checks it: the saved file differs from the original only in that item's ` ` → `x` and in `modified` (editor FR-EDT-02 AC-18). The tap doesn't move the caret or show the keyboard, and no Task file is created. In Mapa v textu, `Jízdenky` inside the mindmap doesn't toggle (FR-MMP-02 AC-37). *(L5p)* Test: `fr_tsk_11_ac5_tap_toggles_a_checklist_item`

### FR-INB-02 Reviewing on the phone (adds to AC-1…AC-17)

- **AC-18** **`Reviewed` in the row and on the note (D-2403; AP-2080; T1).** On `inbox/`:
  - every Inbox row has a `checkbox` `Reviewed` after its title (48 × 48 px hit area). Checking Q1's writes it as AC-1 and AC-2 say (Q5's CRLF, Q4's appended key, Q8). The row stays in place, dimmed and checked, until the user leaves `inbox`; the summary and the drawer count drop within 1 s. Unchecking writes `review: unreviewed`;
  - on a Quick Note's page and a Daily Note's page with a file, the strip starts with the checkbox `Mark reviewed` / `Reviewed` (AC-16);
  - a changed file gives AC-3's alert, a write failure AC-4's, and a read-only item stays `aria-disabled` (FR-INB-01 AC-9);
  - there is no `Mark all reviewed`, selection, swipe or `Convert to` (D-2403).

  *(L5p; LA once)* Test: `fr_inb_02_ac18_reviewed_on_the_phone`

### FR-HOM-02 Pinning on the phone (adds to AC-1…AC-32)

- **AC-33** **Pin and unpin from the note (D-2406; AP-2079; T1).** On `views/` + `phone/`:
  - Dlouhá poznámka's `More actions` has `Pin`, which writes `.tegg/pinned.yml` once (`pins_apply`, its version as base), adding Dlouhá poznámka by `id` after `Rozečtené` as pinned.md's `Pin` does; the drawer's `Pinned` shows it last;
  - on a pinned note the item is `Unpin`, which removes only that entry;
  - a `pinned.yml` changed on disk refuses the write with pinned.md's alert and reloads the section;
  - there is still no reorder, drag or row menu in the drawer.

  *(L5p)* Test: `fr_hom_02_ac33_pin_and_unpin_on_the_phone`

### FR-HIS-01 Move to trash on the phone (adds to AC-1…AC-15)

- **AC-16** **One note to the trash (D-2406; AP-2079; T1).** `More actions` › `Move to trash` on Psaní saves pending edits first (D-196), then calls `object_trash(path, base)` through the desktop's `moveToTrash` (D-2527):
  - `Pages/Psaní.md` becomes `.trash/Pages/Psaní.md`, its bytes and mtime unchanged, and nothing else is written;
  - the app goes Back (to `inbox` without history), and the notice `Moved "Psaní" to the trash` shows `Undo` for 4 s. `Undo` calls `trash_restore` and returns to the note;
  - a file changed on disk gives AC-2's alert, and nothing moves;
  - on a draft or a virtual day the item is `aria-disabled` with `Nothing to delete yet.`;
  - there is no Trash page or drawer entry (plan §8).

  *(L5p; LA once)* Test: `fr_his_01_ac16_move_one_note_to_the_trash_on_the_phone`

### FR-MMP-02 Mindmaps in the phone's editor (adds to AC-1…AC-36)

- **AC-37** **The map stays read-only while the note is edited (owner, 2026-11-22; AP-2081; T1).** In Mapa v textu:
  - the mindmap block is drawn as AND-2 draws it (AC-32…AC-35: `Map` / `List`, zoom, full screen) inside the editor, with `contenteditable="false"`;
  - a tap on it never puts a caret in its list or shows the keyboard; in `List`, the items aren't editable and `Jízdenky` doesn't toggle;
  - Backspace at the start of `Po mapě.`, a selection from `Před` to `Po` replaced by typed `x`, cut or pasted over, and the bar's block buttons with the caret next to the block leave the callout's lines byte for byte: those edits change only the paragraphs;
  - `Mindmap` isn't in the slash panel (FR-EDT-03 AC-6).

  *(L5p; L1 for the rule)* Test: `fr_mmp_02_ac37_map_stays_read_only_in_the_phone_editor`

### FR-UX-03 Commands after AND-3 (adds to AC-1…AC-59)

- **AC-60** **Every new control is a command (D-2405).** FR-UX-03 AC-58's rule holds on every AND-3 surface: the bar and its `Block type` row, the panels, the type sheet, the Properties sheet's controls, the merge banner, `Compare versions`, the Create offer, the conflict actions and `Merge versions`, `More actions`' new items, the Inbox's `Reviewed`, and every task checkbox. Text inputs, rows of object lists and links in a note's text stay exempt.
  - The hidden commands AND-3 shows are exactly RA15's `edit.*` ids, `object.new`, `task.complete`, `note.markReviewed`, `note.markUnreviewed`, `daily.markReviewed`, `daily.markUnreviewed`, `object.trash`, `sidebar.pin` and `sidebar.unpin`; `PHONE_HIDDEN_COMMANDS` keeps the rest.
  - Running each by id (`__TEGG_TEST__.run`) has the tap's effect.

  *(L5p; L1)* Test: `fr_ux_03_ac60_commands_after_and3`

### AR-03 The platform layer after AND-3 (adds to AC-1…AC-14)

- **AC-15** **No excluded action; the desktop unchanged.**
  - AR-03 AC-13's DOM walk passes on AND-3's surfaces.
  - The Android command set is RA2's plus `trash_restore` (AP-2079: group O loses it; AR-03 AC-9's test changes under `AC-Test-Change`).
  - No phone module imports `@tauri-apps/*` (AR-03 AC-14's L0 rule).
  - With `'macos'`, the L5 suites pass unchanged and none of RA15's bar, RA18's panels or the merge banner renders.

  *(L0; L1; L5; L5p)* Test: `ar_03_ac15_platform_layer_after_and3`

### FR-UX-08 TalkBack while editing (adds to AC-1…AC-29)

- **AC-30** **The editing surfaces are named.**
  - At L5p, the bar is `toolbar` `Formatting` with RA15's names and states, the body is `textbox` `Note body` with the note's title as its description, the merge banner is an `alert`, and the sheets are `aria-modal` dialogs with the page behind them `inert`.
  - On the device, with the keyboard shown, `uiautomator dump` lists the bar's buttons by name and `Note body` as editable.

  *(L5p; LA)* Test: `fr_ux_08_ac30_talkback_while_editing`

### FR-UX-05 Themes while editing (adds to AC-1…AC-28)

- **AC-29** **Contrast on the editing surfaces.** The axe `color-contrast` rule reports zero violations, and FR-UX-05 AC-5 holds, at 412 × 915 in light and dark on: the bar with pressed and disabled buttons, the `Block type` row, each panel, the type sheet, the Properties sheet with a field and the date picker open, the Create offer, the merge banner, `Compare versions`, the conflict confirmation, `Merge versions`, and a text selection in the body. *(L5p)* Test: `fr_ux_05_ac29_contrast_while_editing`

### NFR-OTH-02 Strings of AND-3 (adds to AC-1…AC-26)

- **AC-27** **Catalog and pseudo-locale.**
  - Every string of RA19 is a catalog key, with no literal in the phone components (AC-1's L0 rule).
  - With the pseudo-locale, every visible text of AND-3's surfaces is inside `⟦ ⟧`, except user content.
  - `phone.newLater`, `phone.noNote` and `phone.search.noMatch` are gone from the catalog.

  *(L0; L1; L5p)* Test: `nfr_oth_02_ac27_strings_of_and3`

### AR-08 The first released APK (adds to AC-1…AC-6)

- **AC-7** **Every release builds the APK again (D-2042, D-2043; AP-2087).**
  - From AND-3's merge, `npm run app:release -- <v>` builds the APK by default; `--no-apk` skips it; `--apk` is accepted and changes nothing. Checked at L1 with the build calls stubbed, as AC-1.
  - AR-08 AC-1…AC-6 pass in AND-3's merge gate (`./verify merge`), with android-shell.md's "read `--apk` adds it" note removed.
  - The release command's plan for GitHub attaches `Tegg-<v>.apk` to the release `Tegg <v>` with the DMG and the zip (D-2022), checked at L1 with the upload stubbed.

  *(L1; APK)* Test: `ar_08_ac7_every_release_builds_the_apk`

### NFR-PERF-06 Typing on the emulator, report-only (adds to AC-1…AC-7)

- **AC-8** **Bounds a defect, not a target (D-2010; AP-2085).** On the emulator, the latency probe (editor NFR-PERF-06 AC-3) records 200 keystrokes, sent by the test IME one every 80 ms into the middle of the 5,000-word note while autosave runs. The run reports p50, p95 and max in frames, and fails only when fewer than 90 % are painted within 2 frames or any is painted after frame 6. *(LA nightly)* Test: `nightly_nfr_perf_06_ac8_typing_on_the_emulator`

### NFR-PERF-05 Opening for editing on the emulator, report-only (adds to AC-1…AC-6)

- **AC-7** **Bounds a defect, not a target (D-2010; AP-2085).** On the emulator with `tools/gen-vault --seed 1 --small-images`, after `index-idle`, the perf log reports:
  - `note-ready` (the editor mounted and editable, no caret) for 20 opens of notes under 5,000 words, p95 ≤ 1,000 ms;
  - `first-write` (from a draft's title commit to `note_create`'s answer) for 10 drafts, p95 ≤ 500 ms.

  The run fails only above these bounds. *(LA nightly)* Test: `nightly_nfr_perf_05_ac7_opening_for_editing_on_the_emulator`

### NFR-SEC-01 Editing makes no connection (adds to AC-1…AC-4)

- **AC-5** **No socket while editing.** During AND-3's LA run, NFR-SEC-01 AC-3's monitor sees no socket of the app's uid while the test pastes `web.html` (which holds `<img src="https://example.org/x.png">`), types `https://example.org/a` and makes it a link, and opens the link panel. The release APK still has no `INTERNET` permission (AC-1). *(LA; APK)* Test: `nfr_sec_01_ac5_editing_makes_no_connection`

### FR-UX-01 The editing screens' design (adds to AC-1…AC-9)

- **AC-10** [manual] **Design review on the owner's phone.** The owner compares editing with the bar, the link panel, the type sheet, the merge banner with `Compare versions`, and the Properties sheet in edit with board `Mobile`'s E1…E4, in light and dark, with gesture and three-button navigation. Each deviation is recorded in `qa/manual/and-3.md` as an issue or as accepted. *(manual)*

---

## Owner checks (manual)

These need the owner's phone, Google account or sync app. They are recorded in `qa/manual/and-3.md` and are not criteria (except FR-UX-01 AC-10). They run on the first release APK (D-2042), except OC-2, which comes first (AP-2065).
- **OC-8** [manual] **Gboard and the owner's own keyboard** in notes of a copy of a generated vault (never the real vault, D-62): Czech layout, diacritics by long press and by suggestions, autocorrect, glide and voice typing, Enter in lists, Backspace at block starts and after a link chip, `[[`, `#` and `/`, the formatting bar, typing in `Title` and in the Properties sheet. The file's diff on the Mac shows only the typed text and `modified` (FR-EDT-01 AC-19, AC-20).
- **OC-9** [manual] **Edits reach the Mac, and back.** With the sync app: an edit on the phone shows on the Mac after the sync; a note edited on both before the sync shows the merge banner on the phone (FR-SYN-03 AC-41) or a conflict copy in Conflicts; the copy's name is recorded (AP-2066).
- **OC-10** [manual] **AND-1's OC-1…OC-3** on the release APK: install and access, the index time, the sync app's dot folders, temp files and copy names.

---

## Real-app tests (D-382)

`app/e2e-android/` (test APK on the emulator, a fresh vault copy in shared storage per test, the test IME of AP-2084):
- `android_edit.ac.test.ts`: FR-EDT-01 AC-16, AC-17, AC-19, AC-20; FR-UX-04 AC-8…AC-10; FR-EDT-06 AC-12, AC-13; FR-EDT-08 AC-15…AC-18; FR-FMT-07 AC-38, AC-39; FR-FMT-12 AC-18; FR-VLT-05 AC-17; FR-DLY-02 AC-11; FR-TSK-02 AC-14; FR-INB-02 AC-18; FR-HIS-01 AC-16; FR-UX-08 AC-30; NFR-SEC-01 AC-5.
- `android_edit_sync.ac.test.ts`: FR-SYN-03 AC-40, AC-41, AC-43, AC-44; FR-SYN-04 AC-14, AC-16; FR-SYN-06 AC-56, AC-57; FR-SYN-02 AC-17.
- `nightly_android_edit.ac.test.ts`: FR-SYN-02 AC-16; NFR-PERF-06 AC-8; NFR-PERF-05 AC-7.

The L5p tests are `app/webkit/phone_edit_*.ac.test.ts`, run on WebKit and on Chromium (D-2009). AR-08 AC-7 is in `app/test/release_plan.ac.test.ts` with the release script's L1 tests (D-2541).

---

## Trace: requirement → criteria

| Requirement / rule | Criteria | Decisions and points |
| --- | --- | --- |
| FR-EDT-01 | AC-15…AC-20 (6) | D-2007, D-2415, D-522, D-523; AP-2067, AP-2068, AP-2070, AP-2071, AP-2084 |
| FR-UX-04 | AC-8…AC-11 (4) | D-2401, D-2418, D-2429; AP-2069 |
| FR-EDT-02, FR-EDT-03, FR-EDT-04 | AC-27; AC-6; AC-5 (3) | AP-2069, AP-2070 |
| FR-EDT-05 | AC-8, AC-9 (2) | D-145; AP-2069 |
| FR-EDT-06 | AC-12…AC-14 (3) | D-184, D-1343; AP-2072 |
| FR-EDT-15, FR-EDT-09, FR-EDT-14 | AC-7; AC-7; AC-8 (3) | D-185; AP-2083 |
| FR-EDT-08 | AC-15…AC-18 (4) | D-2027; AP-2076, AP-2086 |
| FR-EDT-07 | AC-24…AC-26 (3) | D-2413, D-72; AP-2074 |
| FR-EDT-10 | AC-12 (1) | D-2415 |
| FR-FMT-07 | AC-38, AC-39 (2) | plan §5 |
| FR-FMT-12 | AC-18 (1) | D-2029, D-2048; AP-2077 |
| FR-FMT-08 | AC-11 (1) | D-2007, D-51, D-52, D-68 |
| FR-SYN-02 | AC-16, AC-17 (2) | D-2047; AP-2078 |
| FR-SYN-03 / NFR-REL-02 | AC-40…AC-44 (5) | D-176, D-326; AP-2075, AP-2088 |
| FR-SYN-04 | AC-14…AC-16 (3) | D-2410, D-177; AP-2066, AP-2089 |
| FR-SYN-06 | AC-56, AC-57 (2) | D-2007, D-2025, D-2414; AP-2082 |
| FR-VLT-05 | AC-16, AC-17 (2) | D-1431, D-1432, D-520…D-523; AP-2073 |
| FR-NAV-01 | AC-25 (1) | D-1343, D-2412 |
| FR-LNK-04 | AC-14 (1) | AP-2090 |
| FR-DLY-02 | AC-11 (1) | D-323, D-326 |
| FR-TSK-02, FR-TSK-11 | AC-14; AC-5 (2) | D-2407, D-472 |
| FR-INB-02 | AC-18 (1) | D-2403; AP-2080 |
| FR-HOM-02, FR-HIS-01 | AC-33; AC-16 (2) | D-2406; AP-2079 |
| FR-MMP-02 | AC-37 (1) | owner 2026-11-22; AP-2081 |
| FR-UX-03, AR-03 | AC-60; AC-15 (2) | D-2405; AP-2079 |
| FR-UX-08, FR-UX-05, NFR-OTH-02 | AC-30; AC-29; AC-27 (3) | — |
| AR-08 | AC-7 (1) | D-2042, D-2043, D-2022; AP-2087 |
| NFR-PERF-06, NFR-PERF-05 | AC-8; AC-7 (2) | D-2010; AP-2085 |
| NFR-SEC-01 | AC-5 (1) | D-2002 |
| FR-UX-01 | AC-10 [manual] (1) | D-2008 |

**66 new criteria, 65 automated, 1 [manual].** Three owner checks (manual) are not criteria.

**Changes when these criteria are approved** (not made by this draft):
- **README:** a row for this file in `docs/acceptance/README.md`.
- **BRD:** the decisions of AP-2065…AP-2090. D-2047 (the create window) and D-2048 (NFD names) are revisited by AP-2078 and AP-2077. Plan §3.7's "in the read view too" is read as RA14 (the phone's read view only holds files it can't write).
- **android-phone.md (`AC-Test-Change`):** FR-UX-04 AC-2 (`New` enabled), RA8, RA9 (`new/<type>` is offered), RA11 (the note's editor, task checkboxes, `Reviewed`, the Create offer, the search create buttons, `Pin`, `Move to trash`), RA13 (removed keys), FR-EDT-10 AC-10 and AC-11 (the editor; the broken-link notice), FR-EDT-07 AC-23 ("No input" now applies to the read-only rows only), FR-TSK-04 AC-31, FR-INB-01 AC-14, FR-SRC-03 AC-22, FR-SYN-04 AC-13, FR-SYN-06 AC-54 (taps on checkboxes and `New` now write), FR-UX-03 AC-58 and AC-59 (task checkboxes carry `task.complete:<path>`, D-2475's exemption ends).
- **Contract `docs/contracts/android-phone.md`:** §2.3's lists, §8.5 (long press in the editor), §9.1 (the note), §10 (`PHONE_HIDDEN_COMMANDS`).
- **android-shell.md:** RA2 group O loses `trash_restore` (AP-2079); AR-08's "Moved to AND-3's gate" paragraph is closed by AR-08 AC-7.
- **test-strategy:** the L5p keyboard-input helper and the LA test IME (AP-2084).
- **Contract:** `docs/contracts/android-edit.md`: the bar's commands, the panels, the keyboard-input helper and the test IME, the recovery folder, the renderer reload, the write list, the `first-write` mark.

---

## Points for the owner (AP-2065…AP-2090 → D-2500…D-2525, accepted as proposed)

Raised while writing these criteria. Each criterion that depends on one names it and follows its **proposal**. AP-2065 and AP-2066 are prerequisites; AP-2069…AP-2075 answer the board's "to decide" list and the plan's §3.7; the rest are gaps.

| AP | Point | Proposal | Alternative | Affects |
| --- | --- | --- | --- | --- |
| AP-2065 | **Typing was never checked on a phone (prerequisite).** Plan §7: if typing with Android keyboards fails, the plan stops. AND-0 left item 3 open, AND-1's OC-2 hasn't run, and since AND-2 the phone shows no editor. | Run OC-2 now, before the contract and the red tests: the AND-2 test APK, installed by hand with `TEGG_LAYOUT=desktop` in `test-env.json`, gives the desktop editor on the phone. The owner records the results in `qa/manual/and-1-checklist.md`. If a case fails, AND-3 stops after the ACs and the options go to the owner (a typing-fix spike, or a plain Markdown text field on the phone). | Write the contract and red tests meanwhile, and make OC-8 on the first AND-3 build the go/no-go | FR-EDT-01 AC-19, AC-20, FR-EDT-08 AC-15, OC-8 |
| AP-2066 | **The sync app's conflict copies (prerequisite).** OC-3 hasn't run, so the copy name is unknown. data-safety FR-SYN-04 AC-2 knows Dropbox, Google Drive's `Name (1).md` and iCloud's `Name 2.md`. | Run OC-3 before the contract. If the sync app uses a name the list doesn't know, add it to FR-SYN-04 AC-2's patterns for every platform, still only as a hint next to the same `id` or 90 % equal lines (AP-3). | Rely on the same-`id` rule only, whatever the name | FR-SYN-04 AC-16, OC-9 |
| AP-2067 | **Does opening a note show the keyboard?** The desktop puts the caret in the body on open (D-247, editor FR-EDT-01 AC-11). On a phone that raises the keyboard over half the screen on every open, Today included. | Opening an existing note, a Daily Note or a note just created with a known title (Search, the Create offer) puts no caret and shows no keyboard; a tap on the text places the caret there and shows the keyboard. A draft from `New` opens with the caret in `Title` and the keyboard shown. | The desktop's rule: the caret in the body and the keyboard on every open | FR-EDT-01 AC-16, FR-NAV-01 AC-25, FR-LNK-04 AC-14, FR-DLY-02 AC-11 |
| AP-2068 | **When the title freezes on the phone (D-2007).** Plan §3.8: "a new object still gets its file name from its title … changing the title afterwards is done on the Mac". D-522 writes a draft first on the title's commit, a body change or a flush; D-523 names a draft without a title `Untitled`. A mistyped title can't be fixed on the phone. | The title is editable only on an unwritten draft. The first write (D-522) fixes it; afterwards the title is the app bar's heading with `Rename this note on the Mac.` D-523's `Untitled` stays. No rename command is added on Android. | Allow renaming a note made on this phone as long as nothing links to it (a single-file rename without link updates, a new Android-only command) | FR-EDT-01 AC-18, FR-FMT-08 AC-11, FR-EDT-07 AC-25 |
| AP-2069 | **The formatting bar's buttons.** Plan §3.7: heading, list, task, bold, italic, link, undo. Board E1 adds tag. Open: is "task" a checklist item or a Task object; which heading levels; Gboard has no Tab for nesting lists; redo. | RA15: `Heading` (a row of Text, Heading 1…3), `Bold`, `Italic`, `Link`, `Tag`, `Bulleted list`, `Checklist` (a checklist item; block → Task conversion is not on the phone in AND-3), `Indent`, `Outdent`, `Undo`, `Redo`, in one row that scrolls sideways (the first eight fit at 412 px). Shown only while the body has the focus and the keyboard is shown. | The plan's seven buttons only; or "task" converts the block into a Task object (a second file, FR-CNV) | RA15, FR-UX-04 AC-8, FR-EDT-02 AC-27, FR-EDT-05 AC-8, AC-9 |
| AP-2070 | **Editor parts that need hover, a pointer or ⌘ keys.** Block handles appear on hover, drag needs a pointer, the block menu has ⌘/, block selection needs ⇧, the floating toolbar sits where Android's selection menu goes. Also open: where `Save state` goes and which slash items fit a phone. | Not on the phone in AND-3: block handles, drag, the block menu, block selection, the floating toolbar, the `Selection` menu, table row and column actions. Kept: the slash menu as a panel with RA18's text and list items only (no table, mindmap, query, embeds, media or conversion), Markdown shortcuts, typing in table cells. `Save state` sits in the app bar. | A block menu on a long press at a block's start (move up or down, duplicate, delete, turn into) | RA14, FR-EDT-01 AC-17, FR-EDT-03 AC-6 |
| AP-2071 | **Long press and taps in the editor.** AND-2 prevents the WebView's `contextmenu` everywhere, and a long press does nothing (D-2404, contract §8.5). Editing needs text selection and paste. A tap on a link chip could either open it or place the caret. | In the body's text, a long press selects with the system's handles and shows the system menu (Cut, Copy, Paste, Select all); the prevention stays on links, chips, rows, cards and the frame. A tap on a link chip opens it (D-140, as AND-2 and the desktop); the caret goes beside a chip by a tap next to it. | A tap on a chip places the caret, and the chip opens on a second tap | RA14, FR-EDT-01 AC-17, contract §8.5 |
| AP-2072 | **Link and tag panels (board E2).** Where they sit, and the create row: E2 shows `New Page “lis”`, while the desktop offers `Create "<q>"` with the default type (Quick Note) and `Create "<q>" as…` (D-106, FR-VLT-05 AC-3). | RA18: docked above the keyboard in the bar's place, up to 4 rows of 56 px, the caret's line kept visible. The create rows as on the desktop, so the phone and the Mac create the same way (the reasoning of D-2412). | E2's fixed `New Page “<q>”` row | RA18, FR-EDT-06 AC-12…AC-14, FR-EDT-15 AC-7 |
| AP-2073 | **The type sheet (board E3).** E3 lists Quick Note first with "Default · goes to the Inbox", then Page, Task and user types; the desktop picker (D-1431, D-550) lists Page, Task, Quick Note, then user types A–Z, the default preselected and marked `Default`. On the desktop, Task opens the Tasks page's quick-add row (D-520), which the phone doesn't have. Focusing the filter at opening would raise the keyboard over the list. | The desktop's order and marking (one picker), as a bottom sheet whose filter isn't focused until tapped. `Task` opens a `new/task` draft like any other type. No extra description line. | The default type first, with E3's description line | FR-VLT-05 AC-16, AC-17, RA18 |
| AP-2074 | **What the Properties sheet edits (D-2413 made values editable).** Open: the Type row (a type change moves the file, D-834), the Title (D-2007), the relation picker's `Create` (a new file), the strip. | Editable: every schema attribute with the desktop's controls adapted to touch, Tags, Aliases, Description, Source; the review checkbox sits in the strip (AP-2080). Read-only: Type, Title, Created, Modified. The relation picker's `Create` works as `[[`'s. The strip shows values only; a tap opens the sheet at that row. Each commit is one write. | Values editable in the strip too; or no relation `Create` on the phone | FR-EDT-07 AC-24…AC-26 |
| AP-2075 | **The merge of the open note (board E4, its "to decide").** E4 shows a banner with both versions inline per block, and only `Compare` and `Keep mine`; it names "the Mac" and "2 min ago", which Tegg can't know. The desktop has a modal dialog with four choices (D-176). | A banner (`alert` `Changed outside Tegg`) below the app bar; the body takes no input and Back doesn't leave the note until a choice; the desktop's four choices; `Compare` as a full-screen sheet with the versions stacked; neutral wording, no device name or time. | E4 as drawn (two buttons, versions inline per changed block); or send the user to the Conflicts page | FR-SYN-03 AC-41, RA18, RA19 |
| AP-2076 | **Edits Android may throw away.** Android stops a background app without asking. When the open note's edits can't be written (a merge pending, or `Not saved` after a failure), backgrounding loses them. The desktop's quit rule writes `Keep both` (editor FR-SYN-03 AC-19), but backgrounding happens all the time on a phone. | On `hidden` with such edits, keep the editor's content in the app's private storage (`recovery/`, machine-local, FR-STO-07), never in the vault; on the next start or return, the note offers it through the merge banner, and the copy is deleted once the user chooses. | Write `Keep both` into the vault on `hidden`, as the desktop's quit does (a conflict copy that syncs) | FR-EDT-08 AC-17 |
| AP-2077 | **NFD-named notes (D-2048: read-only until AND-3).** After Tegg replaces a file stored under NFD bytes, other apps reading through Android's storage layer may see the old file for a while. Whether the sync app then uploads stale content is OC-3's open question. | They stay read-only on the phone: the read view with a message to edit on the Mac, every write to them refused, links to them working. Such names are rare (Tegg and the Mac write NFC). Revisit once OC-3 shows how the sync app behaves. | Allow writing, relying on OC-3 | FR-FMT-12 AC-18, RA14 |
| AP-2078 | **Creating a file on shared storage (D-2047, "revisited in AND-3").** No hard links and no `RENAME_NOREPLACE`, so a create checks the name and then renames. Another program could create the same name in between. | Keep check-then-rename, with the temp file complete and synced before the check, so the window is only the check and the rename. Accept that window, and add no placeholder file (an empty file would sync). | Reserve the name with an empty `O_EXCL` file first (the sync app may upload the empty file) | FR-SYN-02 AC-17 |
| AP-2079 | **Pin and Move to trash on the phone (D-2406: "decided with AND-3").** Each is one write. Undo of a trash needs `trash_restore`, which RA2 excludes (group O). | Both in the note's `More actions`. `Pin` / `Unpin` write `.tegg/pinned.yml` (base-checked, appended at the end, no reorder). `Move to trash` is one base-checked rename, with `Undo` in the notice through `trash_restore` for that note only (RA2 group O loses it). No Trash page. | Neither on the phone; or Move to trash without `Undo` | FR-HOM-02 AC-33, FR-HIS-01 AC-16, AR-03 AC-15, RA14 |
| AP-2080 | **Review controls (D-2403: a checkbox in the Inbox row in AND-3).** The desktop also has the review control on the note (inbox.md FR-INB-02 AC-16). | Both: the Inbox row's `Reviewed` checkbox, and the note's control as the first item of the Properties strip, on Quick Notes, Daily Notes with a file, and types with the review workflow. | The Inbox row only | FR-INB-02 AC-18, FR-EDT-07 AC-25 |
| AP-2081 | **Mindmaps inside the phone's editor.** Owner, 2026-11-22: "the map's list in the note isn't editable there either". In the editor, a Backspace or a selection next to the block could still change or remove it. | The block is protected: drawn as in AND-2, no caret inside it, and no edit in the editor (Backspace from the next block, a selection across it, cut, paste, the bar) changes or removes its lines. `Mindmap` isn't in the slash panel. | Deletable as a whole block, never edited inside (as desktop source blocks) | FR-MMP-02 AC-37, FR-TSK-11 AC-5 |
| AP-2082 | **"The per-save move of a note to its type's folder" (D-2025, left to AND-3).** The 4E criteria have no per-save move. Files move on a type change (FR-TYP-07, D-834), on a type-folder change saved in type settings, and in the tidy job. | Read D-2025 as the type change: no phone action moves a file. Type changes and type settings aren't offered (D-2007), the tidy job doesn't run (D-2025), and a note sitting outside its type's folder stays there when edited on the phone. | A move on save of a single note on the phone (one rename, no backup) | FR-SYN-06 AC-57 |
| AP-2083 | **Images and PDFs on the phone.** RA2 left media picking to "AND-3 if at all". Pasting an image would create a file in `_attachments/` and an Image object (two creates, FR-ATT-07). | Not in AND-3: pasting an image shows a notice and writes nothing; `media_add` and `media_add_paths` are never called. | Pasted images saved as on the desktop | FR-EDT-14 AC-8, FR-SYN-06 AC-57 |
| AP-2084 | **How the real-app tests type.** `adb shell input` sends key events, not a keyboard's composition, so LA can't reproduce Gboard's input. | A test input method (`tools/android/test-ime/`, a small Kotlin app installed on the emulator only, never in the product's APKs) that runs `setComposingText`, `commitText`, `finishComposingText`, `deleteSurroundingText` and `sendKeyEvent` on adb broadcasts. Gboard stays the owner's check (OC-8). | L5p only (CDP's `Input.imeSetComposition`), with no keyboard-input criteria on the device | test-strategy, every LA keyboard-input criterion |
| AP-2085 | **Speed while editing on the phone (gap; D-2010).** No phone target exists yet (OC-1 hasn't run). | Report-only bounds on the emulator, failing only above them: typing ≥ 90 % within 2 frames and none after frame 6; `note-ready` with the editor p95 ≤ 1,000 ms; a draft's first write p95 ≤ 500 ms (a new mark `first-write`). | No bounds until D-2010's targets | NFR-PERF-06 AC-8, NFR-PERF-05 AC-7 |
| AP-2086 | **Android kills the WebView's renderer (gap).** Under memory pressure Android may kill only the renderer; the WebView then shows nothing, and the editor's pending text is gone. | The plugin handles the renderer's death by reloading the page on the last route (the core and the vault stay open); at most the last 1 s of typing is lost, as on a desktop crash (data-safety FR-SYN-02 AC-5). | Let the app close and rely on the next start | FR-EDT-08 AC-18 |
| AP-2087 | **The first APK release (D-2042, D-2043).** Open: the `--apk` flag after AND-3, where AR-08 AC-1…AC-6 are checked, and the GitHub asset. | From AND-3's merge, `app:release` builds the APK by default, `--no-apk` skips it, and `--apk` is accepted as a no-op. AR-08 AC-1…AC-6 run in AND-3's merge gate. The first APK release is the next MINOR release after AND-3, with the APK attached to the GitHub release; the owner's keystore must exist first. | Remove `--apk` (a usage error); or release the APK separately from the Mac app | AR-08 AC-7, OC-10 |
| AP-2088 | **Creating while the vault is partly synced.** Tegg can't know which files haven't arrived. A `[[` create on the phone can make `Quick Notes/X.md` while the Mac's `Pages/X.md` is still on its way, and a link `[[X]]` may then resolve differently (FR-LNK-14's rules). | Accept it: no detection and no automatic rewrite. Both files are listed with their details in the `[[` panel, the Mac's Duplicate titles page shows the pair, and resolution is the desktop's for the same files. | Write links from the phone with their folder (`[[Quick Notes/X\|X]]`), so a later arrival can't retarget them (the bytes differ from the desktop's) | FR-SYN-03 AC-44 |
| AP-2089 | **Resolving conflicts in a stacked layout (D-2410 adds keep one and merge).** The desktop's `Keep left` / `Keep right` and side-by-side merge assume two columns; AND-2 stacks the versions. | `Keep this version` under each version (its path as the description), a confirmation naming the file that goes to the trash, `Give the copy a new id` where the desktop offers it, and `Merge…` as a full-screen dialog with the editable draft above the other version. | `Keep top` / `Keep bottom`; or no merge on the phone | FR-SYN-04 AC-14, AC-15 |
| AP-2090 | **The Create offer of a broken link.** AND-2 left it to AND-3, but plan §4 lists only `New` and today's note under creating. | The desktop's offer as a sheet, with its type picker and its link rewrite for names that need one (backlinks.md FR-LNK-04 AC-4…AC-13). | Keep AND-2's notice and create through `[[` or `New` only | FR-LNK-04 AC-14 |
