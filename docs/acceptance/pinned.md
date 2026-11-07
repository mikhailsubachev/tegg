# Acceptance Criteria: Pinned items in the left sidebar (v1.0 slice PIN)

See [README](README.md) for conventions. Release v1.0 (D-376, D-800; the owner asked for it now, ahead of saved queries). FR-HOM-02 "Pinned objects and saved queries can be added to the sidebar" (M) and the `Pinned` part of FR-NAV-04, from the boards `design/edit-note-page/SidebarPinned.dc.html` and `SidebarPinnedDark.dc.html` (commit a0fb7dc): a **Pinned** section in the left sidebar. Any object, a tag or a type page can be pinned and unpinned, rows are reordered by pointer or keyboard, things are dragged in to pin them, and the section has an empty state and can be collapsed. Where the board and a decision differ, the decision wins. Where neither decides, the criterion follows the proposal of an AP point at the end of this file and names it.

**Status: accepted, 2026-11-07.** AP-1227…AP-1248 (end of this file) were decided as proposed: D-1370…D-1391 (BRD v1.151); contract point D-1392; red-test decisions D-1393…D-1404 (AP-1250…AP-1261, BRD v1.152). Each criterion that depends on one names it. Contract: `docs/contracts/v1-pinned.md`, to be written from these criteria after the APs are decided. The IPC names used here (`pins_get`, `pins_apply`) are the proposal it starts from.

**Scope.** FR-HOM-02 (objects, tags, type pages; saved-query pins are only stored and kept, AP-1233), FR-NAV-04 (the section's place, and the `Pinned` entry and route it replaces), FR-UX-03 (menus, palette, ⌥⌘↑/⌥⌘↓, ⇧F10), FR-UX-08 (VoiceOver, Reduce motion), and this slice's checks of FR-SYN-02, FR-SYN-03 / NFR-REL-02, FR-SYN-06, FR-FMT-07, FR-FMT-12, NFR-POR-01, FR-STO-06 / AR-01, FR-LNK-03, FR-UX-05 and NFR-OTH-02. **Out of scope:** saved queries themselves (FR-QRY-06, v1.0); tabs and "Open in new tab" (FR-NAV-06, AP-1235); pins on a Home page (Home dropped, D-800); collapsing the Types section (the board draws a chevron on it; AP-1248); previews on pinned rows (AP-1246).

**Risk tiers** (test-strategy §3). This slice **writes a vault file**, `.tegg/pinned.yml` (AP-1227), and it adds drag sources inside the editor. So its top risk is **T1, data loss**. That covers four cases: an external or synced change to the pins file overwritten; a file that can't be read being rewritten; comments, unknown keys or entries Tegg skipped being dropped; and a note changed by dragging a link chip out of it, or by pinning it (no `id` added, nothing touched). Those criteria are marked **(T1)** and check bytes. Next is **T2, silently wrong data**: a pin that opens another object than the one pinned (duplicate titles, a reused path, a stale path), a row that wrongly says `Not found` while the index is loading, or a wrong position read by VoiceOver.

**Test layers** (as in [graph.md](graph.md) part two):

| Tag | Layer |
| --- | --- |
| L1 | Vitest: UI modules and React components in a DOM environment (the pins model, the row renderer, menus, the move rule), real `@tegg/doc` where Markdown is involved (never mocked) |
| L2 | Property test (proptest / fast-check): a fixed seed plus one random seed per push, 10 × 1,000 runs nightly (TS-L2) |
| L4 | **Core.** Rust: `tegg-core` (the `pinned.yml` parser, resolver and patcher; the rename, move and tag-rename jobs' pin patch) on a temporary copy of the fixture on APFS (`crates/*/tests/ac_*.rs`); the sync simulator injects external writes; clock, time zone and region injected |
| L5 | **WebKit.** Playwright on WebKit with the fake core over mocked IPC (real `@tegg/doc`). It records every call with its path, can hold, delay or fail writes per path, and can change files with or without `vault:changed`. `app/ui/test/fake-pins.ts` is a TypeScript twin of the core's parser and patcher, checked against the same fixture files |
| L6 | **Real app.** Appium `mac2` on the built app with `TEGG_TEST=1`, a temporary Application Support and a temporary copy of the fixture. Vault checks use bytes, mtime and inode. Every AC whose layer names L6 has an `app/e2e/` test in the red-test commit (D-382), and keys go only to Tegg (D-799) |
| manual | Owner or explorer session, recorded in `qa/manual/` or `qa/sessions/` |

**Test clock** (L4, L5, L6 with `TEGG_TEST=1`): `2026-11-07T10:00:00+01:00` (a Saturday), Europe/Prague, region `cs`, unless a criterion says otherwise. Criteria marked **(C)** also run with region `en` (collation, D-122).

**Fixture** (synthetic, D-50; to be written byte-exact in its own commit by the test author, with `tests/fixtures/vaults/pinned/README.md` mapping each file to these criteria). The vault is `tests/fixtures/vaults/pinned/` with `tests/fixtures/vaults/new-empty/.tegg/` copied in and **no** `.tegg/pinned.yml`. The sample pins files and the expected bytes after each write are kept outside the vault, in `tests/fixtures/pinned-files/` (as `tests/fixtures/graph-presets/`). "With `valid`" means `tests/fixtures/pinned-files/valid.yml` copied to `.tegg/pinned.yml` before the app opens the vault (likewise `unknown-keys`, `entries`, `stale`, …). Ids are `01JB5P000000000000000000nn`. Key order of every object is `id, type, title, <attributes>, tags, created, modified`, with `created: 2026-10-01T09:00:00+02:00` and `modified: 2026-10-01T09:00:00+02:00` unless given.

| Short | Path | id `nn` | Type, notes |
| --- | --- | --- | --- |
| Rozpočet | `Projekty/Rozpočet 2027.md` | 01 | projekt; `tags: [účty]`; body `Plán výdajů.` |
| Lisabon | `Projekty/Výjezd Lisabon 2026.md` | 02 | projekt; `tags: [offsite]` |
| Porada | `Schůzky/2026-10-07 Týdenní porada.md` | 03 | schůzka |
| Čajovna | `Pages/Čajovna.md` | 04 | page; the **file name is written in NFD**, `title: Čajovna` in NFC |
| Úkol | `Tasks/Poslat návrh rozpočtu.md` | 05 | task, `status: To do`, `due: 2026-11-09` (on the Kanban and the Schedule) |
| Den | `Daily/2026-10-07.md` | 06 | daily-note |
| Graf | `Images/Graf.md` | 07 | image, `file: "[[graf.png]]"`; `_attachments/graf.png` (a 1 × 1 PNG) |
| Koš | `.trash/Pages/Starý plán.md` | 08 | page, in the trash (D-102) |
| Odkazy | `Pages/Odkazy.md` | 09 | page; body, one per line: `[[Rozpočet 2027]]`, `[[Čajovna]]`, `[[Plán (2)]]`, `Štítek #offsite.`, `[[Neexistuje]]` (broken) |
| Plán | `Pages/Plán.md` | 10 | page, `title: Plán` |
| Plán 2 | `Pages/Plán (2).md` | 11 | page, `title: Plán` (duplicate title, FR-LNK-14) |
| Štítek | `Tags/Offsite.md` | 12 | tag, `title: offsite`, `color: teal` |
| Bez hlavičky | `Pages/Bez hlavičky.md` | — | **no frontmatter** (no `id`, AP-4); body `Jen text.` |
| Výplň ×10 | `Pages/Výplň 01.md` … `Výplň 10.md` | 20…29 | page; never pinned, must stay untouched |

Type files: `.tegg/types/projekt.yml` (Projekt / Projekty, folder `Projekty`, `icon: folder`, `color: orange`) and `.tegg/types/schůzka.yml` (Schůzka / Schůzky, folder `Schůzky`, `icon: users`, `color: teal`). `účty` is a **virtual** tag (no Tag file). `offsite` has the Tag file Štítek.

**Sample pins files** (`tests/fixtures/pinned-files/`; the README gives each line):

| File | What it holds |
| --- | --- |
| `valid.yml` | R131's example: Rozpočet, Lisabon, Porada (each `id` + `path`), `tag: offsite`, `type: projekt`, `query: Otevřené úkoly tento týden` (12 lines, LF, final newline) |
| `unknown-keys.yml` | comments above, between and inside items, the top-level key `x-sidebar: wide`, an item key `x-note: z Macu`, one item in flow style `- {tag: účty}`, and paths quoted in single and double quotes; plus `unknown-keys-crlf.yml` (CRLF) and `unknown-keys-no-newline.yml` (no final newline) |
| `entries.yml` | skipped entries kept byte for byte (R131 read rules): a second pin of Rozpočet by `path`, `tag: "#offsite"` after `tag: Offsite`, an item with both `tag` and `type`, `type: ""`, `path: /etc/hosts`, `path: ../mimo.md`, `path: .tegg/vault.yml`, `id: 42`, `x-route: inbox`, the plain string item `jen text`. Listed are only Rozpočet, `#offsite` and `Schůzky`; a `query:` item is kept, not listed |
| `stale.yml` | Rozpočet's `id` with the stale path `Projekty/Starý název.md`; `path: Pages/Bez hlavičky.md`; Koš's `id` and its old path `Pages/Starý plán.md`; an unknown `id` `…ZZ` with `path: Pages/Smazaný.md`; an unknown `id` `…ZY` with `path: Pages/Plán.md` (a path now used by Plán, id 10); `tag: zrušený` (no occurrence, no file); `type: kniha` (no definition, no objects) |
| `nfd.yml` | `valid.yml` with every path and the tag written in NFD |
| `invalid-yaml.yml` | a YAML syntax error on line 5 |
| `newer-version.yml` | `valid.yml` with `version: 2` |
| `expected/*.yml` | the bytes after each write named in the criteria: `created.yml`, `created-idless.yml`, `valid-after-unpin-porada.yml`, `valid-after-move.yml`, `valid-after-pin-at-2.yml`, `valid-after-unpin-all.yml`, `unknown-keys-after-{pin,unpin,move}.yml` (and the CRLF and no-newline variants), `entries-after-{pin,unpin,move}.yml`, `valid-after-rename.yml`, `stale-after-rename-bez-hlavicky.yml`, `valid-after-tag-rename.yml` |

**Created at runtime by the tests:** external edits, creates, renames and deletes named in the criteria, done by a helper process (L6) or the fake core (L5); random pins files for the L2 criteria; a generated vault with 200 pins for FR-HOM-02 AC-25.

**Shared definitions.** **Untouched** means bytes, mtime and inode unchanged. **Listed pin** means an entry of `pinned.yml` that R131 doesn't skip and that isn't a `query` entry (AP-1233). **Row** means a listed pin as drawn in the section, in file order. **Target** means what a pin refers to: an object, a tag key or a type key.

**Existing criteria this slice changes** (test changes carry `AC-Test-Change: slice PIN builds the Pinned section (FR-HOM-02); approved-by: owner`, AP-1247):

- tags.md FR-NAV-04 AC-8 (the order, AP-1232) and inbox.md FR-NAV-04 AC-1 / trash-media.md AC-6 (already superseded by it).
- app-shell R1: the `pinned` route is removed. R4: `Go to Pinned` is removed, R136's commands and shortcuts are added.
- FR-UX-02 AC-2, AC-11, AC-13: the registry tables lose `pinned`.

The tests that assert the old `Pinned` entry are `app/e2e/ms6_v068.ac.test.ts`, `app/e2e/ms3_shell.ac.test.ts` (the `GOTO` list), `app/webkit/sidebar_5b.ac.test.ts`, `sidebar_6a.ac.test.ts`, `sidebar_v068.ac.test.ts`, `layout.ac.test.ts`, `keyboard.ac.test.ts`, `vault.ac.test.ts`, `app/test/registry.ac.test.ts`, `registry_5b.ac.test.ts` and `shell-tables.ts`. **Verified, not changed:** previews.md FR-LNK-09 (sidebar rows aren't references, AP-1246), D-925 (⌘-click opens in the current view until tabs).

---

## Reference tables

### R131. `.tegg/pinned.yml` (FR-HOM-02, FR-STO-06; AP-1227…AP-1230, AP-1233, AP-1236, AP-1245)

**Format** (`tests/fixtures/pinned-files/valid.yml`; versioned like `.tegg/types/*.yml` and `.tegg/graph.yml`, AR-07):

```yaml
# Tegg sidebar pins (FR-HOM-02). Pin, unpin and reorder them in the sidebar.
version: 1
pins:
  - id: 01JB5P00000000000000000001
    path: Projekty/Rozpočet 2027.md
  - id: 01JB5P00000000000000000002
    path: Projekty/Výjezd Lisabon 2026.md
  - id: 01JB5P00000000000000000003
    path: Schůzky/2026-10-07 Týdenní porada.md
  - tag: offsite
  - type: projekt
  - query: Otevřené úkoly tento týden
```

| Key | Rule |
| --- | --- |
| `version` | a positive integer; missing reads as 1; 1 is current; > 1 means **read-only**; `0`, a string or a fraction makes the file **unreadable** |
| `pins` | a list; missing reads as no pins; anything else makes the file unreadable |
| object pin | `id` (a non-empty string) and/or `path` (vault-relative, `/`-separated, ends in `.md`, NFC when written). Both are written when the object has an `id`; only `path` when it has none (AP-4). Pinning never writes an `id` into the note (AP-1229) |
| `tag` | a tag key (`tag_key`: NFC, lower case); a leading `#` is ignored when reading and never written |
| `type` | a type key, as the `type/<type>` route |
| `query` | reserved for saved queries (FR-QRY-06): kept byte for byte, not listed, not counted, never written by this slice (AP-1233) |
| anything else | top-level and per-item unknown keys and every comment are kept byte for byte (FR-FMT-07) |

**Read rules** (AP-1245). The file is read as UTF-8 YAML. Invalid YAML, invalid UTF-8, a top level that isn't a mapping, or a bad `version` or `pins` makes it **unreadable**. An item is **skipped** (not listed, kept byte for byte) when:

- it isn't a mapping;
- it has no kind or more than one (`id`/`path` together are one kind, object);
- `id` isn't a non-empty string;
- `path` isn't a string, is absolute, has a `..` segment, doesn't end in `.md`, or lies in `.tegg/`, `.trash/` or `_templates/`;
- `tag` or `type` is blank;
- it pins the same target as an earlier listed item (AP-1236): the same `id`; for path-only items, the same NFC path; the same tag key; the same type key.

Only the exact path `.tegg/pinned.yml` is read. Sync conflict copies (`pinned 2.yml`, `pinned (conflicted copy …).yml`) are never read, written or deleted.

**Resolution** (AP-1229, AP-1231), done by the core in one `pins_get` (never one call per row), in this order:

- **Object pin.**
  1. An `id` that the index has outside `.trash/` resolves to that object, whatever its path now (the stored path may be stale).
  2. Otherwise an `id` found in `.trash/` gives the state **trashed**.
  3. Otherwise, if `path` exists outside `.trash/` and that file has no `id` or the same `id`, the pin resolves to that file. A file at that path with a **different** `id` is never adopted.
  4. Otherwise `.trash/<path>` existing gives **trashed**.
  5. Otherwise the state is **missing**.
- **Tag pin.** **ok** when the key is a tag (tags.md R79); **no objects** otherwise.
- **Type pin.** **ok** when the key has a type definition or at least one object (the Types list's entries, D-121); **missing** otherwise.

Until the index has finished its first scan after the vault opens, unresolved pins are **pending**, never **missing** (FR-HOM-02 AC-20).

**Write rules** (AP-1228). There is one atomic write per user action (FR-SYN-02), with the version last read as base (FR-SYN-03).

- **`pin` at position k** inserts the item's lines right before the first line of the k-th listed item, or after the last line of the `pins` list for the end. Skipped items keep their places. If the list is `pins: []`, that line is replaced; if there is no `pins:` key, it is added at the end. The new lines use the existing items' indentation (else 2 / 4 spaces), as `- id: <id>` then `path: <path>`, `- path: <path>`, `- tag: <key>` or `- type: <key>`.
- **`unpin`** removes the item's lines: from its `- ` line to the line before the next line indented at most as far as the dash.
- **`move` to position k** removes those lines and inserts the same bytes at the `pin` place for k.
- Values are written plain when YAML reads them back unchanged, else double-quoted (the `vault.yml` rule, D-230). Paths and keys are written NFC.
- On the first write, a missing `version` is written as `version: 1` after the header comment lines.
- Line endings follow the file (CRLF stays CRLF). A missing final newline stays missing.
- A new file is the header comment line, `version: 1`, `pins:` and the item (`expected/created.yml`). It is created exclusively: an existing file is never replaced by a create.
- Unpinning the last item leaves `pins: []`. The file is **never deleted**.
- Only `pin`, `unpin`, `move` and the job patches of FR-LNK-03 AC-22 and FR-HOM-02 AC-21 write the file. An operation that leaves the bytes equal writes nothing.

### R132. The section (FR-HOM-02, FR-NAV-04; boards A, B, F, G; AP-1232, AP-1240, AP-1241)

| Part | Role / element | Name, content and rules |
| --- | --- | --- |
| Place | in `nav` `Sidebar` | after the `Inbox`, `Today`, `Tasks` group (and `Conflicts` while shown) and before the `Types` section (AP-1232) |
| Header | `button` with `aria-expanded`, chevron | visible text `PINNED` (catalog `Pinned`, upper-cased by CSS) and, when ≥ 1 row, the count in `--faint`; name `Pinned`; description `<n> pinned items` (plural forms, D-133; none at 0) |
| List | `list` `Pinned`, below the header | one `listitem` per row; absent when collapsed |
| Row | a `link` inside the `listitem` (30 px, the sidebar entry style) | R133's icon, colour and label. No count (board A). The tooltip (`title`) is the full label, and for an object also its vault path. `aria-current="page"` when the centre pane shows the target |
| Grip | decorative handle at the row's left, shown on hover and while the row or its Unpin button has the focus | `aria-hidden`; tooltip `Drag to reorder`; a pointer drag works from anywhere on the row (R135) |
| Unpin button | `button` at the row's right, shown on hover and on focus-within | name `Unpin <label>`, tooltip `Unpin`; in the Tab order right after its row's link |
| Empty area | when there are 0 rows and the section is expanded | a dashed box (`1.5px dashed --border`) with the text `Drag things here, or use ⋯ › Pin to sidebar.` (`⋯ › Pin to sidebar` in `--text`, weight 600); it is the drop target while dragging (AP-1241) |
| Alert | `role="alert"` under the list | R133's missing-target text with a `button` `Unpin`, `Pins changed outside Tegg. Your change wasn't saved.` or `Couldn't save the pins. Try again.`; it stays until the next pin action or 10 s |
| File notice | muted line in place of the rows | `The pins file can't be read (line <n>).` (or without the line), or nothing extra for a newer version (rows shown) |
| Collapsed | header only | the chevron points right; the count stays; rows, empty area and alert are hidden; stored per vault in `ui-state.json` as `vaults[<path>].sidebar.pinnedCollapsed` (AP-1240), default expanded |

### R133. Rows by kind and state (FR-HOM-02; board A; AP-1229, AP-1231, AP-1239)

| Kind | Icon and colour | Label | Accessible description | Click / ⏎ |
| --- | --- | --- | --- | --- |
| Object | its type's icon and colour, as the Types list draws them (`typeIconName`, `--type-<color>`); Daily Note, Image, PDF with their system icons | the title (file stem when untitled, D-103) | the type name (`Projekt`) | opens the object exactly as a click on its link chip does (`note/<path>`; a Daily Note on `daily/<date>`) |
| Tag | the tag icon in the tag's colour (D-707; no colour → the default tag chip colour) | `#<display name>` (tags.md R79) | `Tag` | opens `tag/<key>` |
| Type page | the type's icon and colour | the type's plural (`Projekty`) | `Type page` | opens `type/<key>` |

| State | Drawn as | Description added | Click / ⏎ |
| --- | --- | --- | --- |
| pending | icon `file` in `--muted`, label = the stored path's file stem (object) or `#<key>` / `<key>` | `Loading` | nothing; the row becomes ok or another state once resolved |
| trashed | the label in `--muted` with the type icon in `--muted` | `In the trash` | opens `trash` |
| missing | icon `file` (object) or `type` (type page) in `--muted`; label = the stored path's file stem, or the key | `Not found` | shows the alert `“<label>” can't be found. It was deleted, or moved outside Tegg.` with `Unpin`; no navigation |
| no objects (tag) | as a tag row, label `#<key>` | `No objects` | opens `tag/<key>` (tags.md D-720's empty tag page) |

A pin is never removed because its target is trashed, missing or empty (AP-1231). Only Unpin removes it.

### R134. Menus (FR-HOM-02, FR-UX-03; board E; AP-1235, AP-1242)

Every pinnable thing uses the same two words: `Pin to sidebar` / `Unpin from sidebar`. Only one of the two is shown, depending on whether the target is pinned.

| Where | Menu | Items (in order) |
| --- | --- | --- |
| Note header `More` (`note.more`) on `note/<path>` and `daily/<date>` | `More` | `Pin to sidebar` / `Unpin from sidebar`, `Change type…`, separator, `Move to trash` (⌘⌫) |
| Task card `More actions for "<title>"` (Tasks page, Kanban) | as today | `Pin to sidebar` / `Unpin from sidebar` added first |
| `Tag actions` on `tag/<key>` | `Tag actions` | `Pin to sidebar` / `Unpin from sidebar` added first, then `Rename tag…`, `Colour…`, separator, `Delete tag…` |
| Right-click or ⇧F10 on a pinned row | `Pinned item` | `Open`, `Unpin from sidebar`, separator, `Move up`, `Move down`. `Move up` is `aria-disabled` on the first row and `Move down` on the last. No `Open in new tab` (AP-1235) |
| Right-click or ⇧F10 on a Types list entry, an All tags row, a Search result row, a type-page row | `<Type> actions` / `Tag` / `Search result` / the existing `typePage.rowMenu` | `Open`, `Pin to sidebar` / `Unpin from sidebar`; the type-page row keeps its `Move to trash` after a separator |
| `new/<type>` (unsaved, D-520) and a virtual daily note (D-321) | note `More` | `Pin to sidebar` is `aria-disabled` with `Available once the object is saved.` (AP-1239) |

### R135. Dragging (FR-HOM-02; boards C, D; AP-1238)

- **A drag starts** when the pointer, pressed on a source, moves at least 5 px (|dx| + |dy|, the Kanban rule). A press and release without that is a click.
- **Reorder** (board C). The row lifts and follows the pointer (`--shadow`, tilted −1.5°, no tilt under Reduce motion). Its old slot shows a dashed placeholder. A 2 px `--focus` line with a ring at its left shows where it will land.
- **Drag in** (board D). Over the section, the section gets `--link-bg` with an inset 1.5 px `--focus` ring. The dragged item is drawn as a chip with the target's icon and label and a `Pin` badge, and the line shows the position. Over the empty area, the area is the target (position 1).
- **Drop** inside the section writes once (R131 `move` or `pin`). A drop at the row's own place writes nothing. **Esc** during a drag cancels: the row goes back and nothing is written.
- **Dropping outside the section** does nothing: a pinned row returns to its place, and a dragged-in item changes nothing anywhere (board D: "dragging a pinned row out does nothing").
- **Drag sources in this slice** (AP-1238): Types list entries (a type page), type-page rows (the object), Search result rows (the object), All tags rows (the tag), tag-page rows (the object), Backlinks panel entries (the linking object), and resolved link chips, `#tag` chips and embed chips in a note (the target). The sidebar's `Tags` entry and the `Inbox`, `Today`, `Tasks`, `Search`, `Trash` entries aren't sources. A broken link chip, a Tag chip of a deleted tag and a chip in `.trash/` aren't sources.

### R136. Commands and shortcuts (FR-UX-03; added to app-shell R4; AP-1242, AP-1243)

| Id | Title | Section | Listed on | Does |
| --- | --- | --- | --- | --- |
| `sidebar.pin` | `Pin to sidebar` | `edit` | `note/<path>` and `daily/<date>` with a file, `tag/<key>`, `type/<type>`, while the target isn't pinned | pins at the end |
| `sidebar.unpin` | `Unpin from sidebar` | `edit` | the same routes, while the target is pinned | unpins |

On `new/<type>` and a virtual daily note, `sidebar.pin` is listed `aria-disabled` with `Available once the object is saved.` Elsewhere neither command is listed. `Go to Pinned` is removed with the `pinned` route (AP-1232).

| Keys | Command | Active |
| --- | --- | --- |
| ⌥⌘↑ | `sidebar.pinned.moveUp` | only while a pinned row (its link or Unpin button) has the focus |
| ⌥⌘↓ | `sidebar.pinned.moveDown` | same |
| ⇧F10 | opens the focused row's or source's context menu (the existing Tasks convention, D-479) | on R134's rows and sources |

### R137. Strings (catalog keys, English text)

`pinned.section` `Pinned` · `pinned.countA11y` `{count} pinned items` (plural) · `pinned.empty` `Drag things here, or use {path}.` with `pinned.emptyPath` `⋯ › Pin to sidebar` · `pinned.grip` `Drag to reorder` · `pinned.unpinNamed` `Unpin {label}` · `pinned.unpin` `Unpin` · `pinned.menu` `Pinned item` · `pinned.open` `Open` · `pinned.moveUp` `Move up` · `pinned.moveDown` `Move down` · `pinned.kind.tag` `Tag` · `pinned.kind.type` `Type page` · `pinned.state.pending` `Loading` · `pinned.state.trashed` `In the trash` · `pinned.state.missing` `Not found` · `pinned.state.empty` `No objects` · `pinned.missingAlert` `“{label}” can't be found. It was deleted, or moved outside Tegg.` · `pinned.moved` `Moved to position {position} of {total}` · `pinned.pinnedAnnounce` `Pinned {label}` · `pinned.unpinnedAnnounce` `Unpinned {label}` · `pinned.badge` `Pin` · `pinned.notSaved` `Available once the object is saved.` · `pinned.unreadable` `The pins file can't be read.` · `pinned.unreadableLine` `The pins file can't be read (line {line}).` · `pinned.fixFile` `Fix .tegg/pinned.yml to change pins.` · `pinned.newer` `Made by a newer version of Tegg. Read-only.` · `pinned.changedOutside` `Pins changed outside Tegg. Your change wasn't saved.` · `pinned.saveFailed` `Couldn't save the pins. Try again.` · `cmd.pin` `Pin to sidebar` · `cmd.unpin` `Unpin from sidebar` · `searchResult.menu` `Search result` · `tagsAll.rowMenu` `Tag`. The header comment of a new `pinned.yml` is file content, not a catalog string. · `typeEntry.menu` `{name} actions` (the Types entry's context menu, R134; D-1392)

---

### FR-HOM-02 Pinned objects in the sidebar

**Showing and opening**

- **AC-1** **The section (R132; board A).** With `valid`, the sidebar shows, top to bottom: the `New object` / `Search` row, `Inbox`, `Today`, `Tasks`, the header `button` `Pinned` (`aria-expanded="true"`, visible count `5`, description `5 pinned items`), the `list` `Pinned` with five rows `Rozpočet 2027`, `Výjezd Lisabon 2026`, `2026-10-07 Týdenní porada`, `#offsite`, `Projekty` in file order, then the `Types` section. The `query:` item is neither drawn nor counted. *(L5; L6 once)* Test: `fr_hom_02_ac1_section_place_and_rows`
- **AC-2** **Each kind keeps its own icon and colour (R133; T2).** With `valid`:
  - Rozpočet and Lisabon have the `folder` icon in `--type-orange`, with description `Projekt`.
  - Porada has `users` in `--type-teal`, with description `Schůzka`.
  - `#offsite` has the tag icon in the teal tag colour, with description `Tag`.
  - `Projekty` has `folder` in `--type-orange`, with description `Type page`.
  - No row shows a count.
  - A label longer than the row is cut with an ellipsis, and the tooltip holds the full label (for objects followed by the path, e.g. `Projekty/Rozpočet 2027.md`).
  - Changing `projekt.yml`'s `color` to `blue` at runtime recolours the three projekt rows within 2 s, with no pins write.

  *(L5)* Test: `fr_hom_02_ac2_rows_keep_type_icon_and_colour`
- **AC-3** **Opening (R133; D-925; AP-1246).** A click and ⏎ on each row of `valid` open, respectively, `note/Projekty/Rozpočet 2027.md`, `note/Projekty/Výjezd Lisabon 2026.md`, `note/Schůzky/2026-10-07 Týdenní porada.md`, `tag/offsite` and `type/projekt`. Each pushes one history entry (Back returns), moves the focus to the page heading (D-130), and gives the row `aria-current="page"` while that route is shown. Pinned Den opens `daily/2026-10-07`, and pinned Graf opens its Image object page. ⌘-click opens in the current view as a click does (until tabs, D-925). Hovering or resting on a row for 1,000 ms shows no preview. *(L5)* Test: `fr_hom_02_ac3_rows_open_their_targets`
- **AC-4** **Duplicate titles open the pinned one (FR-LNK-14; T2).** With Plán and Plán 2 both pinned (by `id` 10 and 11), both rows read `Plán`, their tooltips read `Pages/Plán.md` and `Pages/Plán (2).md`, and each opens its own file. Renaming Plán 2's title to `Plán B` in Tegg relabels only the second row. *(L5; L4 for the resolver)* Test: `fr_hom_02_ac4_duplicate_titles_resolve_by_id`

**Pinning and unpinning**

- **AC-5** **Pin from the note's More menu, and the first pin creates the file (R131, R134; T1).** With no `.tegg/pinned.yml`, on Rozpočet:
  - `More` lists `Pin to sidebar` first.
  - Choosing it creates `.tegg/pinned.yml` byte-identical to `expected/created.yml` (an atomic exclusive create).
  - The empty area is replaced by the row `Rozpočet 2027`.
  - VoiceOver hears `Pinned Rozpočet 2027`.
  - `More` now lists `Unpin from sidebar`.

  Pinning Bez hlavičky (no `id`) appends `  - path: Pages/Bez hlavičky.md` (`expected/created-idless.yml`), and Bez hlavičky stays untouched: no `id`, no `type` (AP-4, AP-1229). Opening `More` and closing it with Esc writes nothing. Before the first pin, no `.tegg/pinned.yml` exists at any point: launching, opening notes, collapsing the section and relaunching create nothing. *(L4 for the bytes; L5; L6 once)* Test: `fr_hom_02_ac5_pin_from_more_creates_the_file_once`
- **AC-6** **Pin from context menus (R134; AP-1242).** Each pin below appends one item at the end, in one write:
  - Right-click on the Types entry `Schůzky` gives a menu with `Open` and `Pin to sidebar`; `Pin to sidebar` appends `- type: schůzka`.
  - Right-click on the All tags row `#účty` and `Pin to sidebar` appends `- tag: účty` (a virtual tag).
  - A Search result row for Čajovna appends `- id: 01JB5P00000000000000000004` / `path: Pages/Čajovna.md` (NFC, though the file name is NFD).
  - A type-page row for Úkol on `type/task` appends Úkol's item. That menu still ends with `Move to trash` after a separator.

  On a pinned target, each of these menus shows `Unpin from sidebar` instead. ⇧F10 on a focused source opens the same menu. *(L5)* Test: `fr_hom_02_ac6_pin_from_context_menus`
- **AC-7** **Palette commands (R136).** On Rozpočet with `valid`, the palette lists `Unpin from sidebar` and not `Pin to sidebar`; on Čajovna the reverse. Running each changes the pins and closes the palette, and the focus returns where it was. They are listed on `tag/účty` and `type/schůzka` too. On `new/page` and on the virtual `daily/2026-11-07`, `Pin to sidebar` is listed `aria-disabled` with `Available once the object is saved.`, doesn't run, and writes nothing. Neither command is listed on `inbox`, `tasks`, `search`, `tags`, `trash`, `graph/<path>` or a Settings route. *(L1 for the registry; L5)* Test: `fr_hom_02_ac7_pin_and_unpin_from_the_palette`
- **AC-8** **Unpin removes only the shortcut (R131; T1).** With `valid`, each of the four ways to unpin Porada gives `.tegg/pinned.yml` byte-identical to `expected/valid-after-unpin-porada.yml`, which has lines 8–9 removed and every other byte equal. The four ways are: its Unpin button, its context menu `Unpin from sidebar`, Porada's `More` › `Unpin from sidebar`, and the palette on Porada. In every case the note file `Schůzky/2026-10-07 Týdenní porada.md` and every other vault file stay untouched, and VoiceOver hears `Unpinned 2026-10-07 Týdenní porada`. After an Unpin from the row, the focus moves to the next row's link, or to the previous one on the last row, or to the header when none is left. Unpinning all five rows in turn leaves `expected/valid-after-unpin-all.yml` (`pins:` holding only the `query:` item, which is kept; `pins: []` only when no item at all remains, D-1396; the file not deleted). *(L4 for the bytes; L5)* Test: `fr_hom_02_ac8_unpin_removes_only_the_entry`
- **AC-9** **Hover and focus show the grip and Unpin (board B).** With `valid`, hovering `Výjezd Lisabon 2026` gives the row `--hover` and shows the grip (tooltip `Drag to reorder`) and the `Unpin Výjezd Lisabon 2026` button, and no other row shows them. With the keyboard, Tab from the header reaches each row's link, then that row's Unpin button, then the next row. The grip and button show while the row or its button has the focus. *(L5)* Test: `fr_hom_02_ac9_grip_and_unpin_on_hover_and_focus`

**Reordering**

- **AC-10** **Reorder by pointer (R135; board C; T1).** With `valid`, dragging `Výjezd Lisabon 2026` below `#offsite` lifts the row and leaves a dashed placeholder. During the drag, the drop line sits between `#offsite` and `Projekty`. Dropping writes `.tegg/pinned.yml` once, byte-identical to `expected/valid-after-move.yml` (lines 6–7 moved after line 10, bytes unchanged). The rows then read Rozpočet, Porada, `#offsite`, Lisabon, `Projekty`. Each of the following writes nothing and leaves the order as it was:
  - a drop at the row's own place;
  - Esc during the drag (the row goes back);
  - a drop on the Types list, the centre pane or outside the window;
  - a press-and-release that moves less than 5 px, which opens the row instead.

  *(L5; L6 once for the file)* Test: `fr_hom_02_ac10_reorder_by_pointer`
- **AC-11** **Reorder by keyboard (R136; board C; AP-1243).** With `valid` and the focus on `Výjezd Lisabon 2026`:
  - ⌥⌘↓ twice moves it to position 4. Each press writes once (the second press's result equals `expected/valid-after-move.yml`), the focus stays on the moved row, and the polite live region says `Moved to position 3 of 5`, then `Moved to position 4 of 5`.
  - ⌥⌘↑ on the first row and ⌥⌘↓ on the last do nothing and write nothing.
  - The row menu's `Move up` / `Move down` do the same as the keys, and are `aria-disabled` at the ends.
  - With the focus outside the section, ⌥⌘↑/↓ do nothing.

  *(L5)* Test: `fr_hom_02_ac11_reorder_by_keyboard`

**Dragging in**

- **AC-12** **Drag in to pin at the line (R135; board D; AP-1238).** With `valid`, dragging the Search result Čajovna over the section highlights it, and the line appears between rows 1 and 2. Dropping it there writes `expected/valid-after-pin-at-2.yml`: Čajovna's two lines before line 6. Each of the following pins its target at the drop position, in one write:
  - the Types entry `Schůzky`;
  - the type-page row Úkol;
  - the All tags row `#účty`;
  - the Backlinks entry Odkazy (on Rozpočet);
  - the link chip `[[Čajovna]]` in Odkazy (the editor shows Odkazy);
  - the Kanban card Úkol, dragged by its title link (a drag elsewhere on the card stays a status drag, AP-1238).

  Dropping an already pinned target moves its row to the line instead of adding a second one (AP-1236). Esc during the drag, or a drop outside the section, writes nothing. Dragging the sidebar `Tags` entry or `Inbox` over the section shows no highlight, and dropping does nothing. *(L5)* Test: `fr_hom_02_ac12_drag_in_pins_at_the_line`
- **AC-13** **Dragging a chip out of a note never changes the note (T1).** In the built app on Odkazy, a pointer drag of each of the chips `[[Rozpočet 2027]]`, `[[Plán (2)]]` and `#offsite` is done three times: once dropped on the section, once on the Types list, once at another line of the same note. Each pins the target or does nothing, and `Pages/Odkazy.md` stays untouched afterwards: bytes, mtime and inode, with no autosave triggered (L5: zero `note_write` calls). The editor's undo history gets no entry. A drag of the broken chip `[[Neexistuje]]` shows no `Pin` badge and pins nothing. Text selection by pointer inside a paragraph (not starting on a chip) still selects text. *(L6; L5)* Test: `fr_hom_02_ac13_dragging_a_chip_never_edits_the_note`

**Empty and collapsed**

- **AC-14** **Empty state (board F; AP-1241).** With no `pinned.yml`, and again with `expected/valid-after-unpin-all.yml`, the section shows the header `Pinned` with no count and no description, and the dashed area `Drag things here, or use ⋯ › Pin to sidebar.` Dropping the Search result Čajovna on the area pins it at position 1. The first pin replaces the area with the row, and unpinning the last row brings the area back. The area isn't focusable and has no role. A file holding only `query:` items or skipped items shows the area too. *(L5)* Test: `fr_hom_02_ac14_empty_area_until_something_is_pinned`
- **AC-15** **Collapse (board G; AP-1240).** With `valid`, a click or ⏎/Space on the header collapses the section: `aria-expanded="false"`, the chevron points right, the count `5` stays, and the rows are gone. One `ui_state_set` stores `vaults[<vault>].sidebar.pinnedCollapsed: true`, and no vault file is written. While collapsed, pinning from a menu updates the count to `6` and stays collapsed. After a relaunch the section is still collapsed. Another vault opened in the same app starts expanded. ⌃⌘S (the whole sidebar) doesn't change the stored value. *(L5; L6 for the relaunch)* Test: `fr_hom_02_ac15_collapse_is_remembered_per_vault`

**Targets that change**

- **AC-16** **External renames and moves (R131 resolution; T2).** With `valid` open, a helper process renames `Projekty/Rozpočet 2027.md` to `Projekty/Rozpočet 2028.md` and changes its title to `Rozpočet 2028`. Within 2 s the row reads `Rozpočet 2028` and opens the new path. `.tegg/pinned.yml` is untouched: the stale path stays until a Tegg write touches that item (AP-1230). With `stale`:
  - the first row is `Rozpočet 2027` (resolved by `id`, despite the stale path);
  - `Bez hlavičky` resolves by path;
  - `Starý plán` is trashed;
  - `Smazaný` is missing;
  - the item with id `…ZY` and path `Pages/Plán.md` is **missing**, not Plán: a path held by another `id` is never adopted;
  - `#zrušený` has no objects;
  - `kniha` is missing.

  A helper renaming `Pages/Bez hlavičky.md` to `Pages/Jen text.md` makes that row missing within 2 s; renaming it back restores it. No row ever opens another object than the one pinned. *(L4 for the resolver; L5)* Test: `fr_hom_02_ac16_external_renames_resolve_by_id_never_by_reused_path`
- **AC-17** **Trashed and restored (R133; AP-1231).** With `valid`, moving Lisabon to the trash (`More` › `Move to trash`) keeps its row, drawn muted with the description `In the trash`. A click opens `trash`. Restoring it from the Trash view makes the row normal again within 1 s. Neither step writes `.tegg/pinned.yml`. A helper process moving `Schůzky/2026-10-07 Týdenní porada.md` to `.trash/Schůzky/` gives the same trashed state within 2 s. *(L5; L4)* Test: `fr_hom_02_ac17_trashed_targets_stay_pinned`
- **AC-18** **Deleted for good, or gone (R133; AP-1231; T1).** With `valid`, deleting trashed Lisabon to the macOS Trash from the Trash view, or a helper process deleting Porada's file, turns the row into `Not found`, labelled with the stored path's stem (`Výjezd Lisabon 2026`). A click shows the alert `“Výjezd Lisabon 2026” can't be found. It was deleted, or moved outside Tegg.`, whose `Unpin` removes the item's lines in one write. The item is never removed by Tegg on its own. A file that comes back (the helper writes it again with the same `id`) restores the row within 2 s. *(L5; L6 once with the helper)* Test: `fr_hom_02_ac18_missing_targets_are_never_unpinned_silently`
- **AC-19** **Daily notes and media (AP-1239).** Den can be pinned from `More` on `daily/2026-10-07`, as `- id: …06` / `path: Daily/2026-10-07.md`, and its row has the Daily Note icon. On today's virtual note (`daily/2026-11-07`, no file), `Pin to sidebar` is `aria-disabled` with `Available once the object is saved.`. After the first keystroke writes the file, it becomes enabled within 1 s. Graf is pinned from its Image page and opens it. *(L5)* Test: `fr_hom_02_ac19_daily_notes_and_media`
- **AC-20** **No false `Not found` while the index loads (R131; T2).** In the built app with `valid` and an empty index directory (first open), the rows show `pending` (stored-path stems, description `Loading`) until the first scan ends. Then they show their titles, and no row shows `Not found` at any time. The same holds in L5 with the fake core holding `pins_get`'s index answer for 3 s. A click on a pending row does nothing. *(L6; L5)* Test: `fr_hom_02_ac20_pending_never_shows_missing`
- **AC-21** **Tags and types (R133; AP-1230).**
  - With `valid` plus `- tag: účty`, renaming `účty` to `finance` with `Rename tag…` rewrites only that item's value to `finance`, inside the rename job (the job's backup zip includes `pinned.yml`), giving `expected/valid-after-tag-rename.yml`. The row reads `#finance`.
  - Deleting the tag `offsite` with `Delete tag…` keeps the row as `#offsite` with `No objects` (it opens the empty tag page, D-720), and the pins file is untouched.
  - Changing `projekt.yml`'s plural to `Projektíky` relabels the type row within 2 s, with no pins write.
  - A helper deleting `.tegg/types/projekt.yml` while projekt objects remain keeps `Projekty` ok (D-121: undefined type entry). Deleting the objects too makes it `Not found`.

  *(L4 for the job; L5)* Test: `fr_hom_02_ac21_tag_and_type_pins_follow_their_keys`

**The file**

- **AC-22** **Unreadable files are never rewritten (R131; T1; AP-1245).** With `invalid-yaml`, and with each runtime variant (`version: 0`, `"1"`, `1.5`, invalid UTF-8, a top-level list, `pins` not a list):
  - the section shows the header without a count and the notice `The pins file can't be read (line 5).` (no line when the parser gives none);
  - every `Pin to sidebar`, `Unpin from sidebar`, `Move up`, `Move down` and the palette commands are `aria-disabled` with `Fix .tegg/pinned.yml to change pins.`;
  - dragging in shows no highlight, and drops do nothing;
  - tag and rename jobs leave the file alone (the jobs still succeed).

  At the end the file has its original bytes, mtime and inode. When another program fixes it, the rows appear within 2 s. *(L4; L5; L6 once)* Test: `fr_hom_02_ac22_unreadable_pins_file_is_never_rewritten`
- **AC-23** **A newer version is read-only (AR-07; AP-1245).** With `newer-version`, the five rows are listed and open normally, and every editing action is `aria-disabled` with `Made by a newer version of Tegg. Read-only.` The core refuses a write with `NewerVersion`, and the file keeps its bytes. With `valid` without its `version` line, the rows are listed as version 1, nothing is written on open, and the first pin adds `version: 1` as line 2 and nothing else beyond the new item. *(L4; L5)* Test: `fr_hom_02_ac23_newer_and_missing_versions`
- **AC-24** **Skipped entries and duplicates are kept (R131; T1; AP-1236).** With `entries`, the rows are `Rozpočet 2027`, `#offsite` and `Schůzky` only (count 3). Pinning Čajovna at position 2, unpinning `#offsite` and moving `Schůzky` to position 1 each give the matching `expected/entries-after-*.yml`, changing only their own lines. Every skipped item and the `query:` item stay byte for byte. *(L4; L5)* Test: `fr_hom_02_ac24_skipped_entries_are_kept`
- **AC-25** **No limit, and one read (AP-1237).** A generated vault (5,000 notes, `tools/gen-vault --seed 1 --small-images`) with 200 pins of mixed kinds lists all 200 rows in file order, with the section scrolling inside the sidebar and no cap or `Show more`. `pins_get` resolves all of them in one call with p95 ≤ 50 ms on the reference machine (report-only until MS8, D-152). Opening the sidebar makes exactly one `pins_get` (L5 counts calls); no per-row index call is made. *(L4 benchmark; L5)* Test: `fr_hom_02_ac25_many_pins_one_read`
- **AC-26** **Saved-query entries wait for saved queries (AP-1233).** With `valid`, the `query: Otevřené úkoly tento týden` item is not drawn or counted, and no menu offers to pin a query. Every write of AC-5…AC-24 keeps it byte for byte and in its place relative to its neighbours. *(L4; L5)* Test: `fr_hom_02_ac26_query_entries_are_kept_not_shown`
- **AC-27** [manual] **Design review.** The owner compares the following with the boards `SidebarPinned` and `SidebarPinnedDark` A–G, in light and dark, and records each deviation as an issue or accepts it:
  - the section with five rows of each kind;
  - hover;
  - a pointer reorder in progress;
  - a drag-in in progress;
  - the empty area;
  - collapsed;
  - each menu of R134;
  - a trashed and a missing row.

  *(manual)*

### FR-NAV-04 The sidebar with the Pinned section (changes tags.md AC-8; AP-1232)

- **AC-9** **Order.** Top to bottom: the `New object` / `Search` row (D-759), `Inbox`, `Today`, `Tasks` (and `Conflicts` while shown), the `Pinned` section, the `Types` section, the `Tags` entry (D-761), `Saved queries` (`Coming in v1.0`), `Trash`. There is no `Pinned` entry with `Coming in v1.0` any more. *(L5; L6 once)* Test: `fr_nav_04_ac9_order_with_pinned_section`
- **AC-10** **The placeholder route is gone (R1, R4).** The route registry has no `pinned`, the palette has no `Go to Pinned`, and `__TEGG_ROUTE__="pinned"` lands like an unknown route (FR-UX-02's not-found rule). `Saved queries` stays TBD v1.0. FR-UX-02 AC-11 holds with these changes. *(L1; L5)* Test: `fr_nav_04_ac10_pinned_route_removed`

### FR-LNK-03 Renames reach pins (adds to rename.md, mindmap.md AC-21; AP-1230)

- **AC-22** **Tegg's renames and moves patch the pin (T1).**
  - With `valid`, committing Rozpočet's title as `Rozpočet 2028` runs the rename job. Besides the note and its links, it rewrites only line 5 of `.tegg/pinned.yml` to `    path: Projekty/Rozpočet 2028.md` (`expected/valid-after-rename.yml`), once, with the job's base check.
  - Pinning Bez hlavičky, then editing it (the editor's first-edit save writes its `id`, AP-4, D-174) and committing its title `Bez hlavičky 2`: the rename job patches the pin item to `- id: <that id>` / `path: Pages/Bez hlavičky 2.md` (`expected/stale-after-rename-bez-hlavicky.yml`). The rename itself never adds an `id` (4C unchanged; AP-1272).
  - A type change that moves Lisabon to another folder (4E) patches its `path:` line the same way.
  - An unreadable or newer pins file is skipped by the job, which still succeeds; the pin still resolves by `id`.
  - Undoing the rename restores the pins file's previous bytes.
  - A rename of an object that isn't pinned leaves `pinned.yml` untouched.

  *(L4; L5)* Test: `fr_lnk_03_ac22_renames_patch_pins`

### FR-SYN-03 / NFR-REL-02 External changes to `pinned.yml` (adds to data-safety AC-1…AC-9, graph.md AC-22…AC-24)

- **AC-26** **Never overwrite a version Tegg didn't read (T1).** Every write passes the version of the last `pins_get` as base. With `valid` read, and then changed on disk without `vault:changed` (L4: other bytes on disk; L5: the fake core), each of `pin`, `unpin` and `move` is refused with `Conflict`. Nothing is written (the disk bytes stay), the rows reload from disk, and the alert `Pins changed outside Tegg. Your change wasn't saved.` appears. A dragged row goes back. A disk change to the same bytes (only the mtime) is not a conflict (D-175). A base given while the file is gone gives `Gone`, shown the same way, and nothing is created. *(L4; L5)* Test: `fr_syn_03_ac26_pins_writes_check_the_base`
- **AC-27** **Changes from outside reload the rows (T1).** With `valid` open, another program does each of the following, and the change shows within 2 s with no Tegg write:
  - replacing the file atomically with a version that reorders and adds `- tag: účty` shows the new order and row;
  - deleting the file shows the empty area, and nothing is created until the next pin;
  - creating a file while none was read (base none) before Tegg's first pin makes that pin `Conflict` (no file is replaced: `RENAME_EXCL`, ms3-shell §13), and the other file's rows show.

  The conflict copies `.tegg/pinned (conflicted copy 2026-11-07).yml` and `.tegg/pinned 2.yml` are never listed, read, written or deleted: bytes, mtime and inode are unchanged after a tour of AC-5…AC-12. *(L6 once with the helper; L4; L5)* Test: `fr_syn_03_ac27_external_and_synced_pins_changes`

### FR-SYN-02 Atomic writes of `pinned.yml` (adds to data-safety AC-1…AC-5, graph.md AC-8)

- **AC-9** **Atomic, in `.tegg/` (T1).** Every `pinned.yml` write goes through the vault's one write function: a `.pinned.yml.<…>.tegg-tmp` file in `.tegg/`, flushed, then renamed over the target (a new inode each time). The data-safety AC-3 harness kills the process at random points during 200 alternating `move`s of Lisabon. Every time, `pinned.yml` equals the complete old bytes or the complete new bytes, and a leftover temp file is never read as pins. *(L4)* Test: `fr_syn_02_ac9_pinned_yml_atomic_writes`

### FR-SYN-06 Minimal writes (slice PIN; adds to graph.md AC-40)

- **AC-43** **Only pin actions write, once each, only that file (T1).** In the built app with `valid`, a tour leaves every vault file byte-, mtime- and inode-identical, and creates nothing. The tour covers:
  - opening each row;
  - hovering;
  - collapsing and expanding;
  - opening and closing every R134 menu;
  - a cancelled drag;
  - a drop at the same place;
  - ⌥⌘↑ on the first row;
  - trashing and restoring a pinned object (its own trash and restore writes aside);
  - a relaunch.

  Then each `pin`, `unpin` and `move` writes exactly one file, `.tegg/pinned.yml`, exactly once, and changes only R131's lines. Pinning never writes the pinned note, a Tag file or a type file. Collapsing writes only `ui-state.json` in Application Support. *(L6; L5 counts `pins_apply` calls and fake vault writes)* Test: `fr_syn_06_ac43_only_pin_actions_write_pinned_yml`

### FR-FMT-07 Round-trip of `pinned.yml` (adds to graph.md AC-27)

- **AC-28** **Comments, unknown keys, order and style survive (T1; AP-1228).** Starting from `unknown-keys`, a `pin` at position 2, an `unpin` of the flow item `{tag: účty}` and a `move` of the commented item each give exactly the matching `expected/unknown-keys-after-*.yml`. The CRLF copy keeps CRLF on every line, new lines included, and the no-newline copy keeps it missing. Property test: random `pinned.yml` files are generated (comments anywhere, unknown keys at both levels, flow and block items, single- and double-quoted and plain values, CRLF, NFD paths and keys, no final newline, skipped items) together with a random operation. For each, the result parses to the expected listed pins, and every line outside the operated item (and outside the `pins: []` line when emptied) is byte-identical. Reading and writing nothing changes no byte. *(L4; L2)* Test: `fr_fmt_07_ac28_pinned_yml_minimal_patches`

### FR-FMT-12 NFC in pins (adds to graph.md AC-7)

- **AC-8** **Paths and keys compare and are written NFC (T2).** With `nfd`, all five rows resolve and open. Pinning Lisabon again from its `More` menu isn't offered: `Unpin from sidebar` is shown, because the NFD path matches as NFC. Pinning Čajovna (NFD file name) writes its path in NFC. A `move` keeps the NFD bytes of the moved item and of every other item. Matching never depends on the region (`cs`, `en-US`). *(L4; L5)* Test: `fr_fmt_12_ac8_pins_are_nfc`

### NFR-POR-01 Obsidian and other tools (adds to graph.md AC-3)

- **AC-4** **`pinned.yml` is plain YAML in a dot folder.** Every `pinned.yml` written in the slice's suite parses with a standard YAML 1.2 parser (the `yaml` npm package) to the same listed pins Tegg shows. The file sits in `.tegg/`, which Obsidian doesn't index, and no pin action writes outside `.tegg/pinned.yml` (no note, no `.obsidian/` file such as `bookmarks.json`, AP-1227). *(L4)* Test: `nfr_por_01_ac4_pinned_yml_is_standard_yaml`

### FR-STO-06 Pins live in the vault (AR-01, AR-03; AP-1227)

- **AC-2** **Portable, and never only in the index (T2).** With `valid`, a copy of the vault folder opened in a second, empty Application Support lists the same five rows in the same order (collapsed state aside, which is machine-local). Deleting the index directory and reopening gives the same rows. The index database holds no pin: a byte search of the SQLite files for `Otevřené úkoly` finds nothing. The parser, resolver and patcher live in a platform-neutral core module (no Tauri or desktop dependency; architecture-rules AR-03 check). *(L4; L0)* Test: `fr_sto_06_ac2_pins_are_a_vault_file_only`

### FR-UX-03 Pins by keyboard (adds to app-shell.md; AP-1242, AP-1243)

- **AC-39** **Commands and shortcuts in the registry (R136).** The registry has `sidebar.pin` and `sidebar.unpin` with R137's titles, and the shortcuts ⌥⌘↑ / ⌥⌘↓ bound only to a focused pinned row. FR-UX-03 AC-7 passes with them added: no conflict with R4 (⇧⌘↑/↓ move blocks, ⌥⌘←/→ move days) or macOS-reserved shortcuts. FR-UX-03 AC-8 (every control is a command or keyboard-reachable) passes on Rozpočet with the section expanded, collapsed and empty. *(L1 for the registry; L5)* Test: `fr_ux_03_ac39_pin_commands_and_shortcuts`
- **AC-40** **Everything without the pointer.** Using only the keyboard from the vault's first screen, the user can do all of the following, each verified by its effect and file bytes: pin Čajovna (palette), pin `Schůzky` (Tab to the Types entry, ⇧F10, `Pin to sidebar`), move it to position 1 (⌥⌘↑), open a row (⏎), unpin a row (Tab to `Unpin …`, Space), collapse and expand the section (header, Space), and open each row's context menu (⇧F10, ↑/↓, ⏎, Esc returns the focus to the row). *(L5)* Test: `fr_ux_03_ac40_pins_without_the_pointer`

### FR-UX-08 Accessibility of the section (adds to graph.md, graph-panel-g3.md AC-1…AC-15)

- **AC-16** **What VoiceOver reads (R132, R133).** The header reads `Pinned, collapsed` / `expanded`, with the description `5 pinned items`. The list reads `Pinned, list, 5 items`, and each row reads its label, link, its R133 description and its state (`Výjezd Lisabon 2026, link, Projekt`; `Starý plán, link, Page, In the trash`). The live region announces `Pinned <label>`, `Unpinned <label>` and `Moved to position <i> of <n>` once per action, and nothing on load or reload. The grip is hidden from the accessibility tree. In the built app, the macOS accessibility tree has the same names (L6 reads them through Appium). *(L5; L6 once)* Test: `fr_ux_08_ac16_pins_for_voiceover`
- **AC-17** **Reduce motion.** With Reduce motion on, the lifted row and the drag-in chip aren't tilted, and nothing animates (rows jump to their places). The drop line and the section highlight are still drawn. *(L5)* Test: `fr_ux_08_ac17_pins_reduce_motion`

### FR-UX-05 Themes (adds to app-shell.md)

- **AC-19** **Both themes.** FR-UX-05 AC-4 and AC-5 and axe `color-contrast` (zero violations) pass in light and dark, in each of these states:
  - the section with `valid`;
  - a hovered row;
  - a focused Unpin button (`focus` outline, D-594);
  - a reorder drag mid-way (placeholder, line, lifted row);
  - a drag-in over the section (highlight and `Pin` badge, whose text uses a token, no literal);
  - the empty area;
  - collapsed;
  - each R134 menu;
  - a trashed and a missing row;
  - the alert.

  `--faint` is used only for the count (decorative, D-129) and the grip. *(L5)* Test: `fr_ux_05_ac19_pins_in_both_themes`

### NFR-OTH-02 Strings (adds to app-shell.md)

- **AC-16** **Catalog only.** The catalog has exactly R137's keys added by this slice, with the texts given, and the commands' titles are these keys. Plural forms use `Intl.PluralRules`: the Czech test catalog shows `pinned.countA11y` for 1, 3 and 5. With the pseudo-locale, every visible text and accessible name of the section, its menus, the alert and the notice is inside `⟦ ⟧`, except labels (titles, tag names, type names, type plurals, paths; AP-1271). The kind and state words of a row description stay wrapped. *(L1; L5)* Test: `nfr_oth_02_ac16_pins_strings`

---

## Points for the owner (AP-1227…AP-1248, pending)

| # | Issue | Proposal | Alternatives | Affects |
| --- | --- | --- | --- | --- |
| AP-1227 | **Where pins are stored.** The BRD says pins can be added (FR-HOM-02) but not where they live. Portable config goes in `.tegg/` and machine-local state in Application Support (FR-STO-07). The board says only that collapse is per window. | A vault file `.tegg/pinned.yml`: the pins sync with the vault and show the same on a second Mac and later on mobile (AR-03). It is versioned like `graph.yml` (D-906). The collapsed state stays machine-local (AP-1240). | (b) Machine-local in Application Support per vault: no vault writes, no sync conflicts, but pins differ per Mac and are lost with Application Support. (c) A `pinned:` key in `.tegg/vault.yml`: one file fewer, but every pin rewrites the settings file. (d) Also write Obsidian's `.obsidian/bookmarks.json`: Obsidian would show the same pins, but Tegg would write into Obsidian's config. | R131, FR-STO-06 AC-2, NFR-POR-01 AC-4, all writes |
| AP-1228 | **File format and patch rules.** | R131: `version: 1` and `pins:` with one item per pin, patched line by line like `graph.yml` (D-1081: minimal patch, quoting, CRLF, final newline, comments and unknown keys kept, never deleted, last unpin leaves `pins: []`, a conflict refuses and reloads with no automatic retry). | (b) A JSON file (simpler to patch, worse to hand-edit and diff). (c) Rewrite the whole file on every change (simpler, loses comments and order of unknown keys). | R131, FR-FMT-07 AC-28, FR-SYN-03 AC-26 |
| AP-1229 | **What a pin refers to.** Links resolve by file or `id`, never by title (FR-LNK-14), and a file gets its `id` only on its first edit (AP-4). | An object is stored as `id` + `path` (`path` only when the file has no `id`), resolved by `id` first and `path` second. A path whose file now has another `id` is never adopted. Pinning never writes the note. A tag is stored as its key, a type page as its type key. | (b) `id` only: id-less files (Obsidian imports) couldn't be pinned without writing an `id` into them. (c) Store a wikilink (`"[[Projekty/Rozpočet 2027]]"`): readable, but it resolves by name and breaks on rename. | R131 resolution, AC-4, AC-5, AC-16 |
| AP-1230 | **Renames, moves and tag renames.** | Tegg's rename job (4C), its 4E moves and type changes patch the pin's `path:` line, and add `id:` when the rename wrote one. The tag-rename job patches `tag:` lines. All of these happen inside the job, with the job's base check, backup and Undo. External renames are followed by `id` with no write: the stale path is a hint and stays until Tegg patches that item. | (b) Never patch: resolve by `id` only. Fewer writes, but a pin of an id-less file breaks on any rename, and a renamed tag's pin goes empty. (c) Also rewrite stale paths on the next pins write: touches lines the user didn't change. | FR-LNK-03 AC-22, AC-16, AC-21, ms4-jobs contract |
| AP-1231 | **Trashed, deleted and missing targets.** | The row stays, with the state `In the trash` (it opens `trash`) or `Not found` (an alert with `Unpin`). It comes back by itself on restore or when the file reappears. A tag with no objects reads `No objects` and opens D-720's page. A pin is **never removed automatically**, not even by Tegg's own "delete to the macOS Trash": a sync client may remove and re-add files, and an automatic removal would be a silent write. | (b) Hide trashed and missing pins until they come back. (c) Remove the pin when Tegg itself deletes the object permanently or deletes the tag. | R133, AC-17, AC-18, AC-21 |
| AP-1232 | **Sidebar order conflicts with D-761.** D-761 puts `Tags` after the Types list and *before* `Pinned`. The board puts Pinned between `Tasks` and `Types`. The current sidebar also has a TBD `Pinned` entry and route (D-125, D-563) and a `Go to Pinned` command. | Follow the board: New object/Search, Inbox, Today, Tasks, (Conflicts), **Pinned**, Types, Tags, Saved queries (TBD), Trash. The `Pinned` entry, the `pinned` route and `Go to Pinned` are removed (amends D-761, D-125, D-563). | (b) Keep D-761: the Pinned section after Tags. (c) Keep a `Go to Pinned` command that moves the focus to the section's header. | FR-NAV-04 AC-9, AC-10, tags.md AC-8, R1, R4 |
| AP-1233 | **Saved queries don't exist yet.** FR-HOM-02 names them, and D-376 says FR-HOM-02 depends on them, but FR-QRY-06 isn't built (`saved-queries` is TBD v1.0). The board shows a pinned query. | Build object, tag and type-page pins now. Reserve `query: <name>` items: kept byte for byte, not shown or counted, never written. The saved-queries slice adds pinning queries (and how a query is named or identified) with its own ACs. FR-HOM-02 stays open until then. | (b) Show `query:` items now as disabled rows `Coming in v1.0`. (c) Wait with the whole slice until saved queries exist (D-376's original order). | R131, AC-26, FR-QRY-06 |
| AP-1234 | **Phasing.** D-376 and D-800 put FR-HOM-02 in v1.0 together with saved queries. The owner wants pins now. | Treat this as v1.0 slice PIN, built now ahead of saved queries (AP-1233). Its ACs count at the v1.0 milestone gate (no `[MSn]` marker), and `docs/requirements-coverage.md` marks FR-HOM-02 as partly done. | (b) Move FR-HOM-02's object part into the MVP (MS8) as a new decision. | §11, D-376, D-800, coverage |
| AP-1235 | **"Open in new tab".** The board's row menu has it, but the app has no tabs (FR-NAV-06, v1.0; `New tab` is aria-disabled). D-925, D-970 and D-1093 make ⌘-click and "new tab" actions open in the current view until tabs exist. | Leave `Open in new tab` out of the row menu until the tabs slice, which adds it with its own AC-test change. ⌘-click opens in the current view (D-925). | (b) Show it `aria-disabled` with `Coming in v1.0` (D-130). (c) Show it and open in the current view, as ⌘-click does. | R134, AC-3 |
| AP-1236 | **Duplicates.** | One pin per target. Menus toggle between Pin and Unpin. Dropping an already pinned target moves its row to the drop line. A hand-written duplicate is skipped (shown once) and kept in the file. | (b) Allow the same target twice (e.g. as a separator workaround). (c) Refuse the drop with a message. | R131, AC-12, AC-24 |
| AP-1237 | **Maximum number of pins.** The BRD has none. | No limit. The section scrolls with the sidebar. Performance is checked with 200 pins (one `pins_get`, p95 ≤ 50 ms, report-only until MS8). | (b) A cap (e.g. 50) with a message `You can pin up to 50 items.` (c) Show the first 10 with `Show all`. | AC-25 |
| AP-1238 | **Drag sources.** No list, chip or row in the app is draggable today. The Kanban uses its own pointer drags, and Tauri's file-drop handling (6A) can block HTML5 drag and drop. Link chips live in the editor, where a drag normally moves text (T1 risk). | Pointer drags (as the Kanban) from: Types entries, type-page rows, Search result rows, All tags rows, tag-page rows, Backlinks entries, and resolved link, tag and embed chips in notes. A chip drag never edits the note (AC-13), and broken chips aren't sources. The sidebar's `Tags` entry (All tags is not pinnable) and the Inbox, Today, Tasks, Search and Trash entries aren't sources. A Kanban card can be dragged in only from its title link, since the card itself is a status drag. | (b) Leave editor chips out of this slice (menus and palette cover pinning; no T1 risk in the editor). (c) Make the `Tags` entry pin the All tags page (a route pin). | R135, AC-12, AC-13 |
| AP-1239 | **What can be pinned.** The board says "any object, a tag, a type page or a saved query". | Any live object, including Daily Notes, Images, PDFs and Tasks. A Tag file pins as its tag. Also any tag (virtual ones too) and any type page (also an undefined type with objects). Not pinnable: routes (Inbox, Today, Tasks, Search, All tags, graph views, Settings), objects in `.trash/`, templates, and unsaved objects (`new/<type>`, a virtual daily note), where `Pin to sidebar` is aria-disabled `Available once the object is saved.` | (b) Allow route pins (Inbox, All tags, a graph). (c) For a virtual daily note, pin by date (`daily: 2026-11-07`) without writing the note. | R133, R134, R136, AC-7, AC-19 |
| AP-1240 | **"Collapsed is remembered per window".** Tegg has one main window (plus the capture window), and window state is machine-local (FR-STO-07). | Store it machine-local per vault in `ui-state.json` (`vaults[<path>].sidebar.pinnedCollapsed`), default expanded, surviving relaunch. It is never written to the vault. | (b) Per machine for all vaults. (c) In `.tegg/pinned.yml` (would sync and conflict across Macs). | R132, AC-15 |
| AP-1241 | **Empty state.** The board says the area "stays until the first pin". It doesn't say what happens after the last unpin. | Show the area whenever there are no rows, first pin or not. No count at 0. The area is a drop target and isn't focusable. | (b) Only until the first pin ever (needs a remembered flag); afterwards an empty header only. (c) Hide the whole section at 0. | R132, AC-14 |
| AP-1242 | **Which menus get the items, and their order.** The board says "the object ⋯ menu, the same menu everywhere", and lists the note header and right-click on Types entries, tags, search results and type-page rows. | R134: first item of the note `More` menu and of the task card's `More actions`, first item of `Tag actions` on the tag page, and `Open` + `Pin to sidebar` context menus on Types entries, All tags rows, Search result rows and type-page rows (keeping their `Move to trash`). ⇧F10 opens context menus by keyboard (the Tasks convention). The board's `Convert to…` is today's `Change type…`. | (b) Also the Inbox cards' menu and Backlinks entries' menu. (c) Only the note `More` menu and the palette. | R134, AC-6, FR-UX-03 AC-40 |
| AP-1243 | **Reorder keys.** The board uses ⌥⌘↑ / ⌥⌘↓. Type settings uses ⌥↑ / ⌥↓ for options, and the Kanban columns and type-page columns use ⌥← / ⌥→ (D-1244, D-1357). | Use the board's ⌥⌘↑ / ⌥⌘↓, active only with the focus on a pinned row (no conflict: ⇧⌘↑/↓ move blocks, ⌥⌘←/→ move days). | (b) ⌥↑ / ⌥↓, consistent with Type settings. (c) Accept both. | R136, AC-11, FR-UX-03 AC-39 |
| AP-1244 | **Feedback and undo.** The board shows no confirmation or undo for Unpin. | No toast and no undo (re-pinning is one action). VoiceOver announces `Pinned …`, `Unpinned …` and `Moved to position i of n`. | (b) A 5 s notice `Unpinned <label> · Undo`. (c) ⌘Z undoes the last pin action while the focus is in the sidebar. | R137, AC-5, AC-8, FR-UX-08 AC-16 |
| AP-1245 | **Unreadable, newer and conflicting copies of the pins file.** | As `graph.yml` (D-1082…D-1085): an unreadable file shows a notice and no rows, its actions are disabled, and it is never rewritten (jobs skip it). A newer version is listed read-only. Sync conflict copies are ignored. Invalid items are skipped and kept. | (b) Show the readable items of a partly broken file. (c) Offer `Reset pins` that renames the broken file aside and starts empty. | R131, AC-22, AC-23, AC-24, FR-SYN-03 AC-27 |
| AP-1246 | **Previews on pinned rows.** Slice P shows previews "on every surface except graph nodes" (D-919). Sidebar entries are navigation, not references. | No preview on pinned rows (like the Types list). A click opens. The tooltip shows the label and path. | (b) Follow the global preview setting (hover shows a preview). | AC-3, previews.md |
| AP-1247 | **Changed AC tests.** The removal of the `Pinned` entry, the `pinned` route and `Go to Pinned`, and the new order, break existing tests. | Approve the changes listed under "Existing criteria this slice changes", committed by the test author with `AC-Test-Change: slice PIN builds the Pinned section (FR-HOM-02); approved-by: owner`. | (b) Keep the TBD `Pinned` entry as well (two "Pinned" things in the sidebar). | tags.md AC-8, app-shell R1/R4, FR-UX-02 AC-2/11/13 |
| AP-1248 | **Types section collapse.** The board draws a chevron on the `Types` header too. FR-NAV-04 says "Collapsible" for the whole sidebar, which already works with ⌃⌘S. | Out of this slice: the chevron on `Types` is a board detail. Decide it separately. | (b) Make the Types section collapsible in this slice too, with the same per-vault state. | R132, FR-NAV-04 |

## Build points (build 5c273f8, Rust 2abebb8…5becba6)

Decided 2026-11-08: AP-1262…AP-1275 accepted as proposed → D-1405…D-1418 (BRD v1.153).

Defects found in the red tests and gaps the build hit. Every test change carries `AC-Test-Change: …; approved-by: owner`.

| AP | Point | Proposal | Affects |
|---|---|---|---|
| AP-1262 | The Search field is an `<input type="search">` (role `searchbox`); nine L5 tests look for a `textbox` and time out. | Use `getByRole('searchbox', { name: 'Search query' })`. | pinned.ac, pinned_drag, pinned_file, pinned_targets |
| AP-1263 | `rowNamed` matches `title` by prefix, so `2026-10-07` finds `2026-10-07 Týdenní porada` first. | Match the label exactly (the `title` equals it, or starts with it plus a newline). | FR-HOM-02 AC-3, AC-19 |
| AP-1264 | AC-11 moves the focus "outside" to the Inbox entry's text `span`, which can't take the focus, so ⌥⌘↑/↓ still act on the row. | Focus the Inbox link (`inboxEntry`) or the page heading. | FR-HOM-02 AC-11 |
| AP-1265 | Existing screens differ from what the tests assume: the `Rename tag…` item also shows `updates n notes`; the Delete tag confirmation has no `dialog` button `Delete…`; Trash rows are `listitem`s, not `row`s; Backlinks entries aren't `article`s. | Compare the menu item's first line; find the Delete confirmation and the Trash and Backlinks entries by their real roles. | FR-HOM-02 AC-12, AC-17, AC-21 |
| AP-1266 | The chip of `[[Plán (2)]]` shows its title `Plán` (D-73), so the `chip(page, 'Plán (2)')` helper finds nothing. | Find chips by `data-wikilink` (the link text). | FR-HOM-02 AC-13 |
| AP-1267 | AC-12's Esc check drags `Plán` from Search while the query is still `Čajovna`. | Search for `Plán` first. | FR-HOM-02 AC-12 |
| AP-1268 | FR-SYN-06 AC-43 counts `ui_state_set` after `page.reload()`, which clears the fake core's call log. | Count the two writes before the reload. | FR-SYN-06 AC-43 |
| AP-1269 | AC-25 counts every `note_read` since start; the Inbox page itself reads the daily note for its card. | Start on a route that reads no notes (`tags`), or count calls only from the section's first draw. | FR-HOM-02 AC-25 |
| AP-1270 | `nonReadCalls` (app/webkit/helpers.ts) and the fake's read-only list don't include `pins_get`, so FR-UX-03 AC-6 and AC-9 report it as a write on every route. | Add `pins_get` to the read-only lists. | keyboard.ac (FR-UX-03 AC-6, AC-9) |
| AP-1271 | NFR-OTH-02 AC-16 wants every row description in `⟦ ⟧`, but an object row's description is its type's Name from the vault (`Projekt`), not a catalog string. | Type names are user content like plurals: AC-16's exception list gains "type names"; the kind and state words stay wrapped. | NFR-OTH-02 AC-16 |
| AP-1272 | FR-LNK-03 AC-22's id-less case expects the rename to write an `id`. `set-title` never writes one; in the app the `id` comes from the editor's first-edit save (D-174), before the rename. | The tests save an `id` into Bez hlavičky first, as the editor would; renames keep not adding ids (4C unchanged). | FR-LNK-03 AC-22 (L4, L5) |
| AP-1273 | The L4 tag test deletes Tags/Offsite.md and Lisabon but leaves `Štítek #offsite.` in Odkazy, so the tag still exists (R79). | Run the `TagDelete` job, as the AC says, before asserting `noObjects`. | FR-HOM-02 AC-21 (L4) |
| AP-1274 | The SIGKILL harness starts each child with the same move, so after a kill at an odd write a cycle produces a third valid order and the test calls it torn. | Restore `valid.yml` before each cycle (or accept any byte-exact permutation that lists five pins). | FR-SYN-02 AC-9 (L4) |
| AP-1275 | The build's choices the contract didn't fix: a `PinPatch::Merged` variant for D-1402 (the kept object has another `id`); D-1394's duplicate rule applied both ways in the core (the TS twin misses an id+path item after a path-only one); `.trash/<path>` checked as §1.3 says (the twin differs); `pin_lookup` also returns tag keys, type keys and daily dates (one index lock); a job's pins read-back allows a renamed tag to land on a pinned key (§8 13). | Accept as built; align the TS twin with the core on the duplicate and `.trash/` rules. | contract §1, fake-pins.ts |
| AP-1276 | The pseudo-locale test finds the note's `More` button by the exact name `More`; under the pseudo-locale it is `⟦More⟧`. | Accept both, as the header lookup does. Decided 2026-11-08: approved → D-1419. | NFR-OTH-02 AC-16 |

## Push-gate points (build 1cc004d)

| AP | Point | Proposal | Affects |
|---|---|---|---|
| AP-1277 | `read_view.ac.test.ts` FR-EDT-02 AC-13 allows a fixed list of IPC commands while placeholders render; the vault's first `pins_get` (one read, D-1374) isn't on it. | Add `pins_get` to that test's allowed read commands. | FR-EDT-02 AC-13 |
| AP-1278 | `type_moves.ac.test.ts` FR-UX-03 AC-18 opens the note's `More` menu by keyboard and takes its first item as `Change type…`; R134 (D-1385) puts `Pin to sidebar` first. | Choose `Change type…` by name (or one ↓ more). | FR-UX-03 AC-18 (type moves) |
| AP-1279 | NFR-OTH-02 AC-3's pseudo-locale check strips `⟦…⟧` in one pass, so a translated string inside another (R132's empty area: `Drag things here, or use ⟦⋯ › Pin to sidebar⟧.`) reads as unmarked. | Strip `⟦…⟧` repeatedly until nothing changes (nested strings count as marked). | NFR-OTH-02 AC-3 |
| AP-1280 | FR-HOM-02 AC-3 checks the focus on the heading at the moment the page name changes; the heading takes the focus a frame later, so the check is flaky (fails about 1 in 3). | Wait for the focus (`eventually`, up to 1 s). | FR-HOM-02 AC-3 |
