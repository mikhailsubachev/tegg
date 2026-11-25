# Acceptance Criteria: New objects from `/` and `+` (the slash menu as reviewed)

See [README](README.md) for conventions. Editor, FR-EDT-03 (the slash menu) with its FR-VLT-05 (default type and create paths), FR-CNV-01, FR-FMT-07, FR-FMT-12, FR-SYN-06, FR-UX-03, FR-UX-05 and NFR-OTH-02 parts. Built with slice MM3 (`docs/plans/mm3-map-navigation-and-plus-menu.md`). Decisions: **D-2602, D-2603, D-2609, D-2610** (BRD v1.323) and **D-2611** (BRD v1.324), which amends D-2609 where they differ: the menu's groups are Blocks, Objects (without a `Task` row), Media, Advanced, then **New object**; `Mindmap` moves into Blocks; `+` opens the same menu scrolled to New object; `/task` finds `New Task`. Boards: `design/edit-note-page/ObjectMenu.dc.html` A–H (and `Main`).

**Status: approved, 2026-11-25.** AP-2124…AP-2133 are D-2625…D-2634, each as proposed (BRD v1.325).

**Scope.** The slash menu's order and rows (R234); the **New object** group: one `New <type>` row per creatable type of the vault; filtering; the `+` trigger (D-2610); the `New <type>` dialog (D-2609); the link it inserts (D-2603); the bytes written (the new object as every create path writes it, the source note gains only the link); conversion staying as it is (`Turn into object…`, ⇧⌘T, ⇧⌘O put an embed, FR-CNV-03). **Out of scope:** attributes in the dialog (the new object gets its type's defaults and template); choosing an existing object (that is `[[` / `@`, FR-EDT-06); the bug "converting an empty block shows an error" of the plan (its regression test `bug_<issue>_fr_cnv_03_…` waits for the owner's error text and path); Android (no editor on the phone, D-2006).

**Interfaces.** `@tegg/editor` `slashItems()` and the app's `SLASH_ITEMS` (ms3-shell §13.4) hold the static rows; the New object rows are built from the vault's type definitions (the list the `New object` picker uses, capture.md FR-VLT-05 AC-8); the object is created through the one creation path (`createObject` → `note_create`, create-exclusive, types.md FR-TYP-03 AC-12) and the link is inserted as one editor transaction. The red-test author names the exact functions and test hooks in the contract before the red tests (D-61).

**Test layers** as in [editor.md](editor.md) and [conversion.md](conversion.md): L1 (Vitest: `@tegg/editor` with real ProseMirror transactions, the menu model, React components, the catalog), L2 (fast-check property, fixed seed plus one per push, 10 × 1,000 runs nightly), L4 (Rust core on a temporary copy on APFS), L5 (Playwright on WebKit with the fake core; it records every call), L6 (Appium `mac2` on the built app with `TEGG_TEST=1`, a temporary Application Support and a temporary copy of the fixture; vault checks by bytes, mtime and inode).

**Test clock** (L4, L5, L6): `2026-10-14T12:00:00+02:00` (Wednesday), Europe/Prague, region `cs`, unless a criterion says otherwise (the clock of tasks.md and conversion.md).

**Fixture:** `tests/fixtures/vaults/tasks/` with its conversion notes (README "Conversion notes") plus `tests/fixtures/vaults/new-empty/.tegg/` copied in (default type Quick Note; types Page, Task, Quick Note, Daily Note, Tag, Image, PDF) and the fixture's user type **Projekt** (`Projekty/`). Short names are those of conversion.md: Bloky, Zasedačka, Lepidlo (`Pages/Koupit lepidlo.md`), NFD host, CRLF host, Bez hlavičky host, Dvojník ×2, Šablona stránky (`_templates/Page/Page.md`). No new fixture file is needed. One criterion uses the mindmap fixture's Výjezd (`tests/fixtures/vaults/mindmap/`, the map's text field).

**Created at runtime by the tests:** two extra type files for the order check, `.tegg/types/cviceni.yml` (name `Cvičení`, plural `Cvičení`, folder `Cvičení`) and `.tegg/types/caj.yml` (name `Čaj`, plural `Čaje`, folder `Čaje`), both `version: 1`, `system: false`, no attributes; an unparsable `.tegg/types/rozbity.yml` (`name: [`); a Text attribute `poznámka` (`name: Poznámka`) appended to `projekt.yml` for the attribute-field check; appended to Bloky for the trigger checks: a paragraph `` Text `kód` a dál ``, a paragraph `[sál](https://example.com)` and a 2 × 2 table; external edits named in the criteria.

**Shared definitions.**
- **The menu** = the `listbox` `Insert block` of FR-EDT-03, opened by `/` or by `+`.
- **Trigger and query** = the `/` or `+` the user typed and the text typed after it while the menu is open.
- **Creatable types** = Page, Task, Quick Note, then the vault's user types in D-122 order (`Intl.Collator`, region locale); never Daily Note, Tag, Image, PDF, nor a type whose file doesn't parse (capture.md FR-VLT-05 AC-8; D-2609).
- **D-184 link** = `[[<target>]]`, target = the new file's stem when it resolves from the note holding the link, else its vault path without `.md`; `|<title>` is added when the title differs from the target (D-184, ms3-shell §11.1), in NFC.
- **Untouched** = bytes, mtime and inode unchanged.

---

## Reference tables

### R234. The menu's groups and rows (D-2611; replaces editor.md R6's order)

Rows in this order under their group headers. "Writes" and "Status" of the static rows are R6's (editor.md), unchanged.

| Group (header) | Row (catalog label) | Notes |
| --- | --- | --- |
| Blocks | Text | |
| Blocks | Heading 1, Heading 2, Heading 3 | icons showing `H1`, `H2`, `H3` (`aria-hidden`) |
| Blocks | Bulleted list, Numbered list, Checklist | |
| Blocks | Mindmap | moved from Advanced (D-2611); writes mindmap.md W1; its description `Edit as a list, shown as a map` stays (R94; AP-2127) |
| Blocks | Quote, Callout, Code block, Divider, Table | |
| Objects | Turn into object… | the shortcut `⇧⌘O` shown at the row's end (D-2611, D-126); opens R50 (conversion.md) |
| Objects | Embed object | as R6 (FR-EMB-01) |
| Media | Image, PDF | as R6 (trash-media.md R75) |
| Advanced | Query | as R6 (queries.md R144), description kept (AP-2127) |
| Advanced | Block embed | disabled, `Coming in v1.0` (R6) |
| New object | `New <type>` for each creatable type, in that order | the type's icon; opens R236 (D-2609). With the fixture: `New Page`, `New Task`, `New Quick Note`, `New Projekt` |

- The `Task` row of R6 is gone (D-2611). The menu has a fixed maximum height of 420 px and scrolls inside (AP-2126); the selected row is always scrolled into view.
- The static rows are the registry rows of R6 (FR-UX-02 AC-13's milestone check covers `Block embed` as before); the New object rows are computed per vault and are never in the registry.

### R235. When `+` opens the menu (D-2610)

`+` behaves as `/` (FR-EDT-03 AC-1) unless this table says otherwise.

| Typed (`␣` = space; caret after the last character) | Where | Menu |
| --- | --- | --- |
| `+` at the start of an empty block, or of a block's text | editable body text | opens, scrolled so every New object row is visible, `New Page` selected (AP-2126) |
| `␣+` | after a space or a line start inside text | opens, as above |
| `a+`, `C++`, `1+1`, `a+b` | inside a word | doesn't open; `+` is text |
| `(+`, `.+`, `,+` | after punctuation | doesn't open (AP-2124; `/` does open after these) |
| `+␣` | at the start of an empty paragraph | the menu closes on the space; R7's `+ ` shortcut makes a bulleted list (`- `) |
| `␣+␣` | inside text | the menu closes on the space; `␣+␣` stays as text |
| `+pa` then Esc | anywhere it opened | the menu closes; `+pa` stays as typed text (FR-EDT-03 AC-3's rule) |
| `+` then ⌫ | | the menu closes with the `+` |
| `+1` or `+420` then ⏎ (no matching row) | | the menu closes and ⏎ does what it does without a menu (a new paragraph); `+1` stays (AP-2124) |
| `+` in a code block, inline code, a link's text, a source block, the `Title` field, the map's `Edit node` field (R95a), an attribute field, the capture window | | doesn't open (D-2610; AP-2125) |

### R236. The `New <type>` dialog (D-2609; board `ObjectMenu` E)

| Element | Role | Accessible name / content |
| --- | --- | --- |
| Dialog | `dialog` (modal to the editor, non-modal to the window), anchored below the trigger like R50 (AP-2129) | `New <type name>` (e.g. `New Projekt`) |
| Title | `textbox` `Title`, focused, empty | the new object's title; trimmed and NFC when used (AP-2129) |
| Hint | text | `Creates <folder>/<stem>.md and links it here.` with the planned file name (FR-FMT-08, the free stem); not shown while the title is empty (AP-2129) |
| Buttons | `button` | `Cancel`, then `Create` (default); `Create` is `aria-disabled` with the description `Add a title` while the title is empty or spaces |

Keys: ⏎ = `Create` (does nothing while it is disabled); Esc, `Cancel` and a click outside close the dialog and remove the trigger and query (D-2609; AP-2129); Tab and ⇧Tab cycle Title → Cancel → Create inside the dialog. After `Create`: the dialog closes, the trigger and query are replaced by the link (R237), the caret is right after the link, the note stays on its route (no navigation, no history entry).

### R237. What is written (FR-VLT-05, FR-FMT-07, FR-SYN-06; D-2603, D-2609)

Host lines are Bloky's body lines (1 = `Úvodní odstavec.`). "New file" bytes are those of R238's rule.

| # | In the host | Row, title | New file | Host after (other bytes unchanged; frontmatter only `modified`) |
| --- | --- | --- | --- | --- |
| N1 | Bloky, ` +pa` typed at the end of line 1 | New Page, `Nový plán` | `Pages/Nový plán.md` | line 1 `Úvodní odstavec. [[Nový plán]]` |
| N2 | Bloky, `Add block below` on line 1, `/task` | New Task, `Zavolat Petrovi` | `Tasks/Zavolat Petrovi.md` | a paragraph `[[Zavolat Petrovi]]` between `Úvodní odstavec.` and `Zavolat do servisu kvůli kolu`, one blank line on each side |
| N3 | Bloky, ` +pa` at the end of line 1 | New Page, `Koupit lepidlo` (Lepidlo has that stem) | `Pages/Koupit lepidlo (2).md` | `Úvodní odstavec. [[Koupit lepidlo (2)\|Koupit lepidlo]]` |
| N4 | the same | New Page, `Q4: plán/rozpočet` | `Pages/Q4 plán rozpočet.md`, `title: "Q4: plán/rozpočet"` | `… [[Q4 plán rozpočet\|Q4: plán/rozpočet]]` |
| N5 | the same | New Page, `C# poznámky` | `Pages/C poznámky.md` | `… [[C poznámky\|C# poznámky]]` |
| N6 | the same | New Page, `Dvojník` (stem used twice) | `Pages/Dvojník (2).md` | `… [[Dvojník (2)\|Dvojník]]` |
| N7 | the same | New Page, `Čtení knih` typed in **NFD** | `Pages/Čtení knih.md` (NFC name) | `… [[Čtení knih]]` (NFC bytes) |
| N8 | Bloky, ` +pro` at the end of line 1 | New Projekt, `Spuštění webu` | `Projekty/Spuštění webu.md`, `type: projekt` | `… [[Spuštění webu]]` |
| N9 | CRLF host, ` +pa` at the end of `Úkol s CRLF` | New Page, `Nový plán` | `Pages/Nový plán.md` (`\n` line endings) | `Úkol s CRLF [[Nový plán]]`; CRLF on every line, still no final newline |
| N10 | Bez hlavičky host, ` +pa` at the end of `Úkol bez hlavičky` | New Page, `Nový plán` | `Pages/Nový plán.md` | the first-edit frontmatter of editor.md FR-FMT-02 AC-5 (`id`, `type: page`, `modified`) and `Úkol bez hlavičky [[Nový plán]]` |
| N11 | virtual `daily/2026-10-14`, `/quick` in its empty body | New Quick Note, `Nápad na víkend` | `Quick Notes/Nápad na víkend.md` | the Daily Note's first write (FR-DLY-02 AC-2, `Daily/2026-10-14.md`, create-exclusive) with the body `[[Nápad na víkend]]` |

### R238. The new file, strings and commands (FR-VLT-05, NFR-OTH-02, FR-UX-03)

- **The new file** is exactly what the existing create path writes for that type and title: the bytes of `Create "<title>" as…` › `<type>` (capture.md FR-VLT-05 AC-3 (b); one creation path, types.md FR-TYP-03 AC-12), with no `source` key (AP-2128) and the type's default template's body. With the fixture: a Page `Nový plán` is `---\nid: <new ULID>\ntype: page\ntitle: Nový plán\ncreated: 2026-10-14T12:00:00+02:00\nmodified: 2026-10-14T12:00:00+02:00\n---\n`; a Task `Zavolat Petrovi` is the same with `type: task` and `status: To do` after `title` (AP-400's first open status, conversion.md FR-CNV-03 AC-1 without `source` and with an empty body); a Quick Note gets `review: unreviewed` (FR-TYP-03 AC-12).
- **Catalog keys (English text):** `slash.group.newObject` `New object` · `slash.newObject` `New {type}` · `newObject.dialog` `New {type}` · `newObject.title` `Title` · `newObject.hint` `Creates {path} and links it here.` · `newObject.create` `Create` · `newObject.cancel` `Cancel` · `newObject.needTitle` `Add a title` · `newObject.failed` `Couldn’t create "{title}". Nothing was changed.` (AP-2131). Kept: `slash.label` `Insert block`, `slash.empty` `No matching blocks`, the group and row labels of R6. Removed: `slash.task`. Final key names are the contract's.
- **Commands:** the dialog's `Create` and `Cancel` carry commands (`newObject.create`, `newObject.cancel`; app-shell FR-UX-03 AC-8, as R50's buttons do). No palette command creates and links an object (AP-2133).

---

### FR-EDT-03 Slash menu: the reviewed order, the New object group and `+` (adds to AC-1…AC-5)

- **AC-18** **The order of R234 (D-2611).** In Bloky, `/` at the start of an empty paragraph (after `Add block below` on line 1) opens `Insert block` with the group headers `Blocks`, `Objects`, `Media`, `Advanced`, `New object` in that order and the options, in order: `Text`, `Heading 1`, `Heading 2`, `Heading 3`, `Bulleted list`, `Numbered list`, `Checklist`, `Mindmap`, `Quote`, `Callout`, `Code block`, `Divider`, `Table`, `Turn into object…`, `Embed object`, `Image`, `PDF`, `Query`, `Block embed`, `New Page`, `New Task`, `New Quick Note`, `New Projekt` (23 options). No option is named `Task`. `Turn into object…` shows `⇧⌘O`; the heading rows show `H1`, `H2`, `H3`; each New row shows its type's icon (`data-icon` = the type file's `icon`); `Mindmap` and `Query` keep their descriptions (AP-2127). `Block embed` is `aria-disabled` with `Coming in v1.0` (FR-EDT-03 AC-5). Every other row is enabled. *(L5; L1 for the model)*
- **AC-7** **New rows come from the vault's types (D-2609; T2).** With the runtime types `Cvičení`, `Čaj` and the unparsable `rozbity.yml` added, the New object group lists `New Page`, `New Task`, `New Quick Note`, `New Cvičení`, `New Čaj`, `New Projekt` with region `cs`, and `New Page`, `New Task`, `New Quick Note`, `New Čaj`, `New Cvičení`, `New Projekt` with region `en-US` (D-122); there is never a row for Daily Note, Tag, Image, PDF or the unparsable file, also when the vault's default type is Daily Note. A type file added or renamed by another program (`name: Projekt` → `name: Záměr`, key unchanged, with `vault:changed`) shows in the next menu opened 2 s later (`New Záměr`); a deleted one is gone. Opening the menu writes nothing. *(L5; L1 for the list)*
- **AC-8** **Filtering finds New rows (D-2602, D-2611).** Text after `/` or `+` filters every group as FR-EDT-03 AC-2 does (folded case and diacritics, NFC/NFD, letters in order): `/task`, `/TASK` and `+task` list exactly `New Task`; `/new` lists `New Page`, `New Task`, `New Quick Note`, `New Projekt` in that order; `+pro` lists exactly `New Projekt`; `/quick` lists `New Quick Note` first; `+caj` and `+čaj` (runtime types) list `New Čaj` first; `/tab` still lists `Table` first and `/hea2` `Heading 2`. While filtering, the header of each group that has a match is shown above its rows (boards B, D; AP-2126). With `+`, matching New rows come before the other matches, so `+ta` selects `New Task` (and `Table` is below it), while `/ta` selects `Table` first (AP-2126). `/xyz` and `+xyz` show `No matching blocks`. *(L5; L1 for the ranking)*
- **AC-9** **Where `+` opens (R235; D-2610).** In Bloky's editor: `+` in an empty paragraph and ` +` at the end of line 1 each open `Insert block` with all 23 options and `New Page` selected, every New row inside the listbox's visible area (AP-2126); the same in a list item (`Koupit lepidlo`), the quote, a table cell of a runtime table, and a mindmap item in the List view (Výjezd, mindmap fixture). Typing ` C++ 1+1 a+b` at the end of line 1 never opens it and saves `Úvodní odstavec. C++ 1+1 a+b`; `(+pa` and `.+pa` don't open it (AP-2124). *(L5; L1 for the trigger rule)*
- **AC-10** **`+` stays text when wanted (R235; D-2610).** In an empty paragraph, `+ ` then `Řádek` saves `- Řádek` (editor.md R7, a bulleted list); ` a + b` typed at the end of line 1 saves `Úvodní odstavec. a + b`; ` +pa` then Esc closes the menu and saves `Úvodní odstavec. +pa`, which reads back as that text (no link, no list); `+` then ⌫ closes the menu and saves nothing new; ` +1` then ⏎ closes the menu, keeps `+1` and starts a new paragraph (AP-2124); ` +420 777` saves `+420 777` as typed. *(L5)*
- **AC-11** **Where `+` doesn't open (R235; D-2610; AP-2125).** No menu opens for `+` typed: in `kód();` (the js fence) of Bloky; inside the inline code of the runtime `` Text `kód` a dál `` (caret between `k` and `ód`); inside the text of the runtime link `[sál](https://example.com)`; in the `Title` field (`C++` there saves `title: C++`); in Výjezd's map field `Edit node` (mindmap fixture: F2 on `Doprava`, ` +pa` typed, ⏎ saves `>   - Doprava +pa`); in the runtime Text attribute `poznámka` of Web; in the capture window. In each case the `+` and the following text are saved as typed. *(L5; L6 for the capture window)*
- **AC-12** **A fixed height that scrolls (D-2611; AP-2126).** The open menu's listbox is 420 px high (± 1 px) when its content is taller, and scrolls inside; the page doesn't scroll. With `/`, ↓ moved to `New Projekt` scrolls it into view; with `+`, ↑ from `New Page` selects the row above it in the menu and scrolls it into view. *(L5)*
- **AC-13** **The dialog (R236; D-2609).** ⏎ on `New Projekt` (after ` +pro`) opens the `dialog` `New Projekt` with an empty, focused `Title`, `Cancel` and `Create` (`aria-disabled`, description `Add a title`); typing spaces keeps `Create` disabled and ⏎ then does nothing; typing `Spuštění webu` enables it and shows `Creates Projekty/Spuštění webu.md and links it here.` (AP-2129). Clicking a New row with the mouse opens the same dialog. Esc closes the dialog and removes `+pro`; the space typed before it stays in the editor (D-533's rule) but, as a paragraph's trailing space, is not saved, so Bloky's bytes are unchanged (D-2657). `Cancel` and a click outside the dialog do the same as Esc (AP-2129). Opening, typing in and cancelling the dialog never calls `note_create`. *(L5)*
- **AC-14** **`Create` inserts a link, not an embed (R237; D-2603).** Each of N1…N8 (from a fresh copy) creates exactly its "New file" and replaces the trigger and query by the link of its row; the link is a link chip (not an embed card, not `![[…]]`); the caret is right after the link and the next typed `X` lands after it; the route stays `note/Pages/Bloky.md` with no navigation and no history entry; `link_resolve` from Bloky returns the new file for the written target (FR-LNK-14). *(L5; L1 for the link text; L4 for the resolution)*
- **AC-15** **One undo step; the object stays (board F; AP-2130).** After N1, ⌘Z removes the link in one step and leaves line 1 as `Úvodní odstavec.` as saved (the trigger and query don't come back; the trailing space isn't saved, D-2657); `Pages/Nový plán.md` stays (undo never deletes a file, editor.md FR-EDT-06 AC-6); ⇧⌘Z puts the same link back without a second `note_create`. While the menu or the dialog is open, autosave doesn't write the trigger and query (the host's only write after N1 contains the link). *(L5; L1 for the transaction)*
- **AC-16** **Unusual hosts (R237).** N9 (CRLF host), N10 (Bez hlavičky host) and N11 (virtual Daily Note) save exactly their rows; N11 writes exactly two files, the Quick Note first, then the Daily Note's first write. In a Task card's body (Porada's `![[Zavolat Janě]]`, embeds.md FR-EMB-03) ` +pa` › `Nový plán` writes the link into `Tasks/Zavolat Janě.md` only; in `_templates/Page/Page.md` (Šablona stránky) the New rows work and its body gains the link (AP-2125). In the read view and in a note opened read-only (NFR-REL-03), `+` and `/` open nothing. *(L5; L4 for the daily create)*
- **AC-17** **Failures and races (T1; AP-2131).** When `note_create` fails (`Io`, a read-only `Pages/` in the fake core), nothing is inserted and nothing is written, the dialog closes, the alert `Couldn’t create "Nový plán". Nothing was changed.` appears and ` +pa` stays as typed text. Pressing ⏎ twice within 50 ms in the dialog creates exactly one file and one link. When another program creates `Pages/Nový plán.md` after the dialog opened and before `Create`, the core picks the next free stem and the link names the file actually created (`[[Nový plán (2)|Nový plán]]`), never the planned one (conversion.md FR-CNV-03 AC-5's rule). *(L5; L4 for the stem)*

### FR-VLT-05 New objects from the menu (adds to AC-1…AC-15)

- **AC-18** **The same bytes as every create path (D-2609; R238).** Each `New <type>` row writes the file R238 says for its type and title: `New Page` › `Nový plán` and `New Task` › `Zavolat Petrovi` byte-equal to R238's text (with `id` a ULID); `New Quick Note` › `Nápad na víkend` and `New Projekt` › `Spuštění webu` byte-equal to what `Create "<title>" as…` › that type writes in a fresh copy (types.md FR-TYP-03 AC-12, capture.md FR-VLT-05 AC-3 (b)). No file gets `source` (AP-2128). The row ignores the vault's default type (`default-type: task` in `vault.yml` still gives `type: page` for `New Page`), and nothing asks for a type: the row is the type. *(L1 for the bytes; L4 for the write; L5)*

### FR-CNV-01 Conversion is still conversion (adds to AC-1…AC-8; changes AC-2)

- **AC-9** **`/task` no longer converts; ⇧⌘T, ⇧⌘O and `Turn into object…` do (D-2609, D-2611).** In Bloky, ` /task` typed at the end of `Úvodní odstavec.` and ⏎ opens the `New Task` dialog (R236) with an empty title, never R50, and the paragraph's text is not taken as a title; `X` ⏎ gives `Úvodní odstavec. [[X]]`. With the caret in `Úvodní odstavec.`: ⇧⌘T ⏎ converts it into a Task and puts `![[Úvodní odstavec]]` in its place (FR-CNV-03 AC-1, AC-2 rules); ⇧⌘O and ` /turn` ⏎ open R50 as FR-CNV-01 AC-2 and AC-3 say. A `New <type>` row never converts the caret's block, whatever its content. *(L5)*

### FR-FMT-07 Round-trip of the host (adds to AC-1…AC-37)

- **AC-41** **The host gains only the link (T1).** For N1…N10, the saved host equals the original with the trigger and query replaced by the link and `modified` changed (N10: plus the first-edit keys); every other byte, the line endings, a BOM and the final-newline state are unchanged. Property (L2): for random host paragraphs (Czech words in NFC and NFD, marks, links, tags, CRLF and LF, with and without a final newline), inserting a New object link at a random allowed caret position changes only the bytes between the trigger's start and the caret, and the saved file parses to the same blocks with that one paragraph changed. *(L1; L2)*

### FR-FMT-12 NFC (adds to AC-1…AC-17)

- **AC-19** **Titles and links in NFC.** N7's title typed in NFD gives the file name, `title:` and the link in NFC bytes; the same title typed in NFC afterwards gives `Pages/Čtení knih (2).md` (the stems compare equal, FR-FMT-12); ` +pa` typed in NFD host after `Úkol v NFD` (NFD bytes) inserts an NFC link and leaves the NFD bytes of `Úkol v NFD` unchanged. *(L1; L4 for the stem)*

### FR-SYN-06 What the menu writes (adds to AC-1…AC-55)

- **AC-59** **Two files per object, nothing else (T2).** Opening the menu with `/` and `+`, filtering, scrolling, Esc, ⌫ over the trigger, opening the dialog, typing a title, `Cancel`, a click outside, and a failed create write nothing (L5: zero `note_create` and `note_write` beyond the text the user typed, e.g. AC-10's `+pa`). Each create writes exactly two files: the new object (create-exclusive, first) and the host at its save (for N11, the host's save is the Daily Note's first write). On the built app (L6), N1 on a copy of the fixture changes exactly `Pages/Nový plán.md` (new) and `Pages/Bloky.md` (temp file renamed, new inode); every other vault file is untouched. *(L5; L6)*

### FR-UX-03 Keyboard (adds to AC-1…AC-59)

- **AC-61** **Keyboard only (FR-UX-03).** With no pointer events: in Bloky, End on line 1, ` +pro`, ⏎ (dialog), `Spuštění webu`, ⏎ saves N8; ` /new`, ↓ ↓ (to `New Quick Note`), Tab (chooses, FR-EDT-03 AC-3), `Nápad`, Tab, Tab (to `Create`), Space creates `Quick Notes/Nápad.md` and inserts `[[Nápad]]`. app-shell FR-UX-03 AC-8 passes with the dialog open (`Create`, `Cancel` carry commands, R238). Esc in the dialog returns the caret to where the trigger was. *(L5)*

### FR-UX-05 Themes (adds to AC-1…AC-28)

- **AC-30** **The menu and the dialog in both themes.** In light and dark, with the menu open by `/` and by `+`, filtered to `New Projekt`, and with the dialog open (empty and with a title): axe reports no violation (`color-contrast` included); the group headers, the shortcut `⇧⌘O`, the `H1`…`H3` icons, the hint and the disabled `Create` use tokens only (FR-UX-05 AC-2); text on the selected row ≥ 4.5:1. *(L5)*

### NFR-OTH-02 Strings (adds to AC-1…AC-26)

- **AC-28** **Catalog only.** Every R238 text is a catalog key, `slash.task` is gone from the catalog, and with the pseudo-locale every visible text and accessible name of the menu, its headers, the New rows' `New ⟦…⟧` frame, the dialog, the hint and the alert is inside `⟦ ⟧`, except user content (type names, the typed title, folder and file names). *(L1; L5)*

---

## What changes in earlier criteria, tests and fixtures

Made in the red-test commit; test changes carry `AC-Test-Change: the reviewed slash menu, New object rows and the + trigger (D-2602, D-2603, D-2609…D-2611); approved-by: owner`.

| Criterion / test | Change | Reason |
| --- | --- | --- |
| editor.md R6 | the order and groups of R234: Objects after Blocks, `Task` row removed, `Mindmap` in Blocks after `Checklist`, Advanced `Query` then `Block embed`, the computed New object group last; the note "Objects first as on the Main board" goes | D-2611 |
| FR-EDT-03 AC-1 (`app/webkit/editor.ac.test.ts` `fr_edt_03_ac1_slash_opens_only_where_it_should`) | "listing the items of R6 in that order" means R234; the first four options become `Text`, `Heading 1`, `Heading 2`, `Heading 3` | D-2611 |
| FR-EDT-03 AC-5 (`app/test/editor_registry.ac.test.ts` `fr_edt_03_ac5_slash_registry_matches_r6_and_is_overdue_checked`; `packages/editor/test/links.ac.test.ts` `fr_edt_03_ac5_slash_items_are_r6_with_milestones`) | their R6 tables follow R234's static rows: 19 rows (no `Task`; `Mindmap` in `blocks`; `Query` before `Block embed`); "R6 has 20 items" becomes 19; the group order assertion "Objects first" becomes Blocks first; the New object rows are not registry rows | D-2611 |
| FR-EDT-03 AC-2 (`fr_edt_03_ac2_filter`) | unchanged (`/hea2`, `/tab`, `/CHECK` keep their first rows); group headers now show while filtering (AP-2126), which this test doesn't check | AP-2126 |
| conversion.md FR-CNV-01 AC-2 | "`/task` lists `Task`: in a paragraph with text it opens R50 … in an empty paragraph … Convert creates a new empty Task … its embed" is replaced by FR-CNV-01 AC-9 here (`/task` finds `New Task`, a link); the `/turn` half stays | D-2609, D-2611 |
| `app/webkit/convert.ac.test.ts` `fr_cnv_01_ac2_slash_task_preselects_task_for_a_paragraph_with_text`, `fr_cnv_01_ac2_slash_task_in_an_empty_paragraph_creates_an_empty_task` | removed; replaced by `fr_cnv_01_ac9_…` and FR-EDT-03 AC-14 (N2) | D-2609 |
| conversion.md R53 first bullet | "`Task` and `Turn into object…` become built … `/task` … list them" becomes "`Turn into object…` is built; `/task` lists `New Task` (R234)" | D-2611 |
| conversion.md FR-CNV-01 AC-5 ("slash items") | applies to `Turn into object…` only (there is no `Task` row) | D-2611 |
| mindmap.md R94 first bullet, FR-MMP-01 AC-1 | "the row `Advanced › Mindmap`" becomes `Blocks › Mindmap`; `/mind` still lists `Mindmap` first with its description (AP-2127) | D-2611 |
| editor.md FR-EDT-01 AC-6 | "the built Blocks items of R6, plus `Mindmap` from slice MM" reads "the built Blocks items of R234" (Mindmap is one of them) | D-2611 |
| editor.md R7 row `- `, `* `, `+ ` | unchanged; D-2610 keeps `+ ` working (R235) | D-2610 |
| `app/ui/src/edit/EditorPane.tsx` `CONVERT_ITEMS` and `openConvert('task')` from the slash menu; catalog `slash.task` | gone with the `Task` row (implementation, not a test) | D-2611 |
| `docs/contracts/ms3-shell.md` §13.4 (`SLASH_ITEMS`), `docs/contracts/ms5-tasks.md` (the `/task` path) | the contract states R234 and the computed group | D-2611 |

No fixture changes.

---

## Points raised by these criteria (AP-2124…AP-2133, decided as D-2625…D-2634)

Numbering continues after AP-2123 (mindmap.md, slice MM3). Each has a proposal and an alternative; nothing here is decided.

| # | Issue | Proposal | Alternative | Affects |
| --- | --- | --- | --- | --- |
| AP-2124 → D-2625 | **`+` after punctuation, and ⏎ with no match.** `/` opens after `. , ; : ! ? )` too (the current trigger rule); D-2610 says "at the start of a block or after a space". `+` is common in plain text (`+420 777 123 456`, `+1`, `(+5 %)`), and today ⏎ with `No matching blocks` closes the menu and swallows the key, so `+1⏎` would not start a new line. | `+` opens only at a block start or after whitespace (not after punctuation); with no matching row, ⏎ and Tab close the `+` menu and then do their normal action. `/` keeps its rule. | Same rule as `/` for both (after punctuation too; ⏎ with no match is swallowed). | R235, FR-EDT-03 AC-9, AC-10 |
| AP-2125 → D-2626 | **Where `+` and the New rows work.** D-2610 lists code, inline code, the title and the map field. Not covered: attribute text fields (where `[[` and `@` work, FR-EDT-06 AC-11), the capture window, nested full-embed editors and Task card bodies (conversion is disabled there, FR-CNV-01 AC-5), and `_templates/` notes (conversion is disabled there). | Not in attribute fields or the capture window (only where `/` opens); in nested editors the New rows work and write the embedded note; in templates they work (it is only a link; FR-TPL-07 still keeps the template out of search). | Disable the New rows wherever conversion is disabled (nested editors, templates), with the same reasons. | R235, FR-EDT-03 AC-11, AC-16 |
| AP-2126 → D-2627 | **Filtering with `+`, headers and the menu's height.** D-2602's own example `+ta` → `Task` now ranks `Table` first (a prefix beats a word prefix), so ⏎ would insert a table; boards B and D show group headers while filtering, today they're hidden; D-2611 says "about 420 px"; which row `+` selects isn't said. | With `+`, matching New rows rank first, then the other matches in `/`'s order; with `/`, unchanged. Headers are shown above each group with matches. Maximum height 420 px. `+` with no query selects `New Page`. | Same ranking for both (`+ta` ⏎ inserts a table); headers hidden while filtering. | R234, R235, FR-EDT-03 AC-8, AC-9, AC-12 |
| AP-2127 → D-2628 | **Row details the board drops or adds.** The board draws `Mindmap` and `Query` without their second-line descriptions (mindmap.md R94, queries.md R144 require them), shows `H1`…`H3` icons, a shortcut only on `Turn into object…` (written `⌘⇧O`; D-126 orders it `⇧⌘O`), and icons on New rows. | Keep both descriptions (as `aria-description` and second line); `H1`…`H3` icons; `⇧⌘O` on `Turn into object…` only; each New row shows its type's icon. | Follow the board: drop the descriptions (FR-MMP-01 AC-1 and the query AC change). | R234, FR-EDT-03 AC-18 |
| AP-2128 → D-2629 | **`source` on an object created from the menu.** Conversion writes `source: "[[<host>]]"` (FR-CNV-04); D-2609 says "FR-VLT-05 bytes", which have no `source`; the host's link already makes a backlink. | No `source`: the bytes of every other create path (the object isn't made from the host's content). | Write `source: "[[<host>]]"` as conversion does. | R238, FR-VLT-05 AC-18 |
| AP-2129 → D-2630 | **Dialog details.** D-2609 names the dialog, `Title`, ⏎ / `Create` and Esc. Not said: `Cancel` and a click outside; how `Create` is disabled; trimming, NFC and `#tags` in the title; the board's hint `Creates People/Jana Nováková.md and links it here.`; where it appears; Tab order. | `Cancel` and a click outside = Esc (trigger and query removed); `Create` `aria-disabled` with `Add a title`; the title trimmed and NFC, `#words` kept as typed (no tag extraction, as `[[` Create); the hint shows the planned folder and free stem, hidden while empty; anchored below the trigger and modal to the editor like R50; Tab cycles Title → Cancel → Create. | Esc returns to the menu instead of removing the trigger; no hint line. | R236, FR-EDT-03 AC-13 |
| AP-2130 → D-2631 | **Undo and autosave around the trigger.** Board F says one undo step removes the link; not said whether ⌘Z brings `+pe` back, whether redo can create a second file, or whether autosave writes the half-typed `+pe` while the dialog is open. | ⌘Z removes the link and leaves the text as it was before the trigger (no `+pe`); ⇧⌘Z re-inserts the same link without creating anything; the trigger and query are never autosaved while the menu or dialog is open (as `/query` today). | ⌘Z restores `+pe` as text (as `[[` undo restores `[[<query>`, FR-EDT-06 AC-6). | FR-EDT-03 AC-15, FR-SYN-06 AC-59 |
| AP-2131 → D-2632 | **A failed create.** D-2609 doesn't say what happens when `note_create` fails (read-only folder, disk full). | Nothing inserted or written; the dialog closes; the alert `Couldn’t create "<title>". Nothing was changed.` (conversion's text, its own key); `+<query>` stays as typed text. | Keep the dialog open with the error under the title, so the user can retry. | R238, FR-EDT-03 AC-17 |
| AP-2132 → D-2633 | **Titles that can't be a link alias.** D-184 adds `\|<title>` when the title differs from the stem. A title containing `\|`, `[[` or `]]` (`A \| B`, `pole [[x]]`) makes an alias that ends or breaks the wikilink; `\|` is replaced in the file name (D-52) so the alias is needed. | When the title contains `\|`, `[[` or `]]`, write the link as `[[<stem>]]` without an alias (the chip shows the object's title anyway); the title stays in `title:`. The same rule for `[[` Create (FR-EDT-06 AC-4). | Refuse such titles in the dialog (`Create` disabled with a reason). | R237, FR-EDT-03 AC-14 |
| AP-2133 → D-2634 | **A palette command for "new linked object".** FR-UX-03 asks every new action to be reachable from the palette. The menu is keyboard-reachable (`/`, `+`), but the palette has only `New <Type>` commands, which open a draft and navigate (FR-VLT-05 AC-13). | No new palette command: `/` and `+` are the keyboard path; the dialog's buttons carry commands (FR-UX-03 AC-8). | Add `Insert link to a new object…` (palette only): the `New object` type picker, then R236, then the link at the caret. | R238, FR-UX-03 AC-61 |
