# Slice OC: object cards, Object settings and the Settings layout (2026-11-22)

Status: **accepted by the owner on 2026-11-22 ("Accept all"): AP-1551…AP-1570 are D-2054…D-2073 in order (BRD v1.238; FR-TYP-11 reworded, FR-TYP-01 names property icons).** AP-1569 was then changed by the owner: the boards are committed as drawn (D-2074, BRD v1.239), and where their notes differ from the decisions the decisions win. Next: the ACs. Requirements touched: FR-TYP-01, FR-TYP-11, FR-EMB-02, FR-QRY-07 (board cards), FR-SET-01…07 (layout only).

Boards (owner, 2026-11-22): `TypeCards`, `TypeCardsDark`, `CardSettings`, `CardSettingsDark`, `IconSet`, `IconSetDark`, `Settings`, `SettingsDark`, `SettingsApp`, `SettingsAppDark`. They are **not in git yet**: they sit uncommitted in the main checkout and are committed as drawn (D-2074).

## 1. What is built

1. **One card for every type.** The Tasks Schedule card becomes the card of every object: the type's icon (the checkbox for Task), the title with `⋯`, grey `#tags`, the body clamped to 2 lines, property pills, and a footer with one link chip and a date. Empty parts take no space. Image and PDF add a file preview strip on top. Types with the review workflow show the `Unreviewed` pill (FR-TYP-12).
2. **A `Card` section in type settings** replaces `Preview properties`. Title is always shown; the user adds any properties and orders them. Each property is drawn by its kind: tags as chips, Body or Description as text, relations as link chips, Created or Modified as the footer date, everything else as a pill.
3. **Property icons.** Every property can have an icon. A pill shows the icon in place of the property name (the name on hover); tables and the property panel show it before the name.
4. **An icon picker** holding the whole Lucide set (1,539 icons), searched by name and keyword, with Suggested, Recent and None. The same picker sets the type's icon.
5. **Type settings redrawn** in the Settings style, and its `Views` section lists the type's real views (reorder, Edit, Add view) in place of the disabled buttons.
6. **Settings redrawn** in the same style: a section list on the left, one label column, one control column, notes under the control. No setting is added, removed or changed.

Not in this slice: Templates, Font / Font size / Accent color, Trash and history, shortcut editing (all stay `Coming in v1.0`); a card setup per view (AP-1552); property icons in the read view's properties strip (`PropertiesStrip`, D-2153).

## 2. Where we are

- **Type file.** `preview: [keys]` exists (`crates/tegg-schema`, `TypeDef.preview`); the settings section allows at most 4 keys. There is no `card:` key and attributes have no `icon:`.
- **Index.** `preview: Vec<(String, Value)>` carries "up to 2 set preview values" per object (`crates/tegg-index/src/lib.rs`). A plain-text excerpt exists (`text::excerpt`, `NoteState.excerpt`) and is used by the Inbox and task cards.
- **Cards today**, each with its own layout:
  - `tasks/TaskCard.tsx`: the design this slice generalizes; its rules are D-1904.
  - `queries/board/BoardCard.tsx`: board cards from `preview` (D-1891).
  - `embeds/Embed.tsx`, `embeds/strip.tsx`: the card embed and its property strip.
  - `preview/PreviewPopover.tsx`, `links/DuplicateDetails.tsx`: the strip in previews and the duplicate dialog.
- **Icons.** 24 type icons (`ICONS` in `packages/schema`, `TYPE_ICONS` in `shell/Icon.tsx`), drawn by hand as SVG paths. No Lucide dependency.
- **Type settings.** `pages/TypeSettingsPage.tsx` has the same ten sections as the board and already has a section list on the left (`.ts-layout`).
- **Settings.** `pages/SettingsPage.tsx` shows its eight sections as a wrapping row of links above the content; labels have a minimum width of 80 px.

## 3. File format

```yaml
# .tegg/types/book.yml
columns: [author, rating, status, modified]
card: [tags, body, status, rating, author, modified]   # title is always shown; order = order on the card
attributes:
  - key: status
    name: Status
    type: select
    icon: circle-dot                                    # a Lucide name; no key = the name is shown
```

- `card:` is one list of keys: the type's attribute keys plus the built-in ones `tags`, `body`, `description`, `source`, `aliases`, `created`, `modified`.
- A type file without `card:` uses a default list (AP-1556). **No type file is rewritten until the user changes the Card section** (FR-SYN-06).
- `preview:` is kept byte for byte and no longer read once the slice ships (the rule D-1910 used for `columns` on boards). The Card section writes `card:` only.
- An unknown key in `card:`, or an unknown icon name, is kept in the file and ignored when drawing (FR-FMT-07).
- Whether the type file's `version:` changes is AP-1557.

## 4. The card

### 4.1 Layout rules

| Part | Rule |
| --- | --- |
| Lead | The type's icon; Task shows its checkbox, and ticking it sets Status to Done (as today) |
| Title | Always shown, with the `⋯` menu |
| Tags | `#chips` under the title when `tags` is in the list |
| Text | 2 lines, clamped, when `body` or `description` is in the list (AP-1559) |
| Pills | The other values in list order; a Select shows its option's colour dot; a pill shows the property's icon, or its name when it has none |
| Footer | The first relation or `source` in the list as one link chip, left; `created` or `modified` as the date, right |
| Preview strip | Image and PDF only, on top |
| `Unreviewed` | Shown by the review workflow, never picked in the list |

A picked property with no value draws nothing.

### 4.2 One component

`ObjectCard` replaces the layouts in `BoardCard`, the card embed and its strip, the preview popover's strip and `DuplicateDetails`. `TaskCard` becomes `ObjectCard` with the Task rules of D-1904 (overdue-aware due label, the source chip always).

### 4.3 Data

- The index returns, per card, the values of the type's `card` keys (no longer "up to 2"), the tags, the excerpt and the dates, **in the read that already lists the cards** (D-784: never one read per card).
- Rows no card draws keep using the read without the excerpt (v1-views §24.4).
- The board keeps its virtualization (D-586); the pill limit of AP-1558 keeps a card's height bounded.
- Performance: the Q2-T board targets stay as they are; the ACs name them.

## 5. Type settings

- **Layout:** the existing ten sections, restyled with the shared Settings styles (§7).
- **General:** the Icon control opens the icon picker.
- **Properties:** one property open at a time; an icon button before each name.
- **Card:** replaces `Preview properties` (`PreviewSection`): the ordered list, `Add property` with search, `Reset to default`, and a live example card.
- **Embeds:** unchanged; its note says Card mode uses the Card section.
- **Views:** the type's `views:` list (slice Q2): `All <plural>` first and fixed, drag to reorder, `Edit` opens the query editor, `Add view`.
- **Tag type:** still no Properties, Card or Hidden sections (D-693, D-728).
- Every new action is in the command palette (FR-UX-03); all text is in the catalog (NFR-OTH-02).

## 6. The icon picker

- **Set:** Lucide 0.460 (ISC licence), the version on the `IconSet` board, pinned. Icon paths and keywords are bundled with the app as one data file loaded when the picker first opens (NFR-SEC-01: nothing is fetched). The licence notice is added to the app's notices.
- **Search:** filters while typing over icon names and Lucide keywords; the first result is selected, arrows move through the grid, ⏎ chooses, esc closes; the typed part is bold in each name.
- **Suggested:** icons whose keywords match the property's or type's name. **Recent:** the last icons chosen (AP-1563). **None** removes the icon.
- **Existing names:** the 24 names stored in type files today must keep drawing. Any that Lucide 0.460 names differently get an alias (AP-1564). Not yet checked against the set.

## 7. Settings

- One set of styles for Settings and type settings: section list on the left, a label column, a control column, notes under the control.
- All eight sections keep their controls, labels, defaults, storage and commands. Existing Settings ACs keep passing unchanged; where a test depends on the old markup it changes with an `AC-Test-Change` trailer.
- The settings routes get their `design:` entry in the route registry.

## 8. Points for the owner

All decided: the Proposal column is the decision (D-2054…D-2073), except AP-1569, superseded by D-2074.

### 8.1 From the boards' "To decide"

| AP | Point | Proposal | Alternative |
| --- | --- | --- | --- |
| AP-1551 | **Card replaces Preview properties** | Yes. FR-TYP-11 is reworded: each type defines its card (Title plus any properties, in order, no limit); previews and card embeds use it | Keep the limit of ~4 |
| AP-1552 | **A card setup per view** | No. The card is the same everywhere (D-1891 removed `On cards` on 2026-11-20) | A board view overrides the type's list |
| AP-1553 | **Type icon on a page or board of one type** | Always shown | Hidden where every card has the same type |
| AP-1554 | **The `CardAnatomy` board** | Moved to `_Archive` | Kept |
| AP-1555 | **Columns in type settings** | Not listed; they stay on the type page (FR-TYP-09) | A Columns section |

### 8.2 File format

| AP | Point | Proposal | Alternative |
| --- | --- | --- | --- |
| AP-1556 | **A type without `card:`** | It shows `tags, body, <its preview keys>, modified`; the system types use the lists on board `CardSettings` B. Nothing is written until the user edits the Card section | Write `card:` into every type file on first open |
| AP-1557 | **Type file `version:`** | Unchanged: `card:` and `icon:` are new optional keys an older build keeps and ignores | Raise the version |

### 8.3 The card

| AP | Point | Proposal | Alternative |
| --- | --- | --- | --- |
| AP-1558 | **Pill rows** | At most 2 rows, then `+N more` (board C3) | No limit (board C2) |
| AP-1559 | **The card's text** | `description` when picked and set; `body` is the first plain text after the headings. No "generated block" rule | The board's proposal: skip a generated block |
| AP-1560 | **Computed entries** | Daily Note's `Day summary` is left out of this slice (it needs a query per card). Image and PDF show the attributes they have (`width`, `height`, `pages`); `Size` and `Embedded in` only if the index already holds them | All computed entries in this slice |
| AP-1561 | **URL values** | One rule for every host: a link chip with the host and the last path segment; a `file://` folder as `↗` and the folder name. Nothing is fetched (D-43) | A special form per service (the issue key on board C) |
| AP-1562 | **The placeholder `—`** | A value that is only `—` counts as empty and draws nothing | Shown as written |
| AP-1565 | **Previews and link hovers** | They show the card's pills and link chip; tags, body and dates aren't repeated where the preview already shows them | The whole card list |
| AP-1566 | **"Pinned" on board `TypeCards`** | Out of scope: Pinned is a sidebar list and has no card today | The owner says what card is meant |

### 8.4 Icons

| AP | Point | Proposal | Alternative |
| --- | --- | --- | --- |
| AP-1563 | **Recent icons** | Kept on this Mac (Application Support), the last 12 | In the vault (`.tegg/`) |
| AP-1564 | **Old icon names** | An alias table in the core for any of the 24 current names Lucide 0.460 doesn't have; type files aren't rewritten | Rewrite the names once |
| AP-1567 | **Icons in tables and the property panel** | In this slice, as board D says | Cards only now |

### 8.5 Scope and process

| AP | Point | Proposal | Alternative |
| --- | --- | --- | --- |
| AP-1568 | **Settings** | Layout only, all eight sections; released with the rest | A separate small slice first |
| AP-1569 | **The boards** | Committed with this plan after board `CardSettings` section C is redrawn with invented data: it holds data pasted from the owner's vault, which D-62 keeps out of the repo | |
| AP-1570 | **Phase and release** | Built now as slice OC, released as **0.6.0** | After the MS7 importer work |

## 9. What changes

- **BRD (done, v1.238):** D-2054…D-2073; FR-TYP-11 reworded; FR-TYP-01 names property icons; `requirements-coverage.md`; CLAUDE.md status.
- **ACs:** a new `docs/acceptance/cards.md` (the card, the Card section, property icons, the picker); additions to `types.md` (settings layout, Views section), `views.md` (board cards), `embeds.md`, `previews.md`, `app-shell.md` (Settings layout).
- **Changed AC tests** (each with an `AC-Test-Change` trailer): the limit of 4 and the `preview` writes in the types tests, the board card tests of Q2-T, the embed strip, tests that assert the line after `preview:` in a type file.
- **Contract:** `docs/contracts/v1-cards.md`: `card` and attribute `icon` in the type DTO and writer ops, the card values in the list reads, the icon data file, the fake core's twin.
- **Fixtures:** a `tests/fixtures/vaults/cards/` overlay (types with and without `card:`, Czech keys, an unknown key, an unknown icon, empty and `—` values, a URL and a `file://` source).
- **Dependencies:** Lucide's icon data at 0.460, as data only.

## 10. Order inside the slice

1. **OC-a core:** `card:` and attribute `icon:` in `tegg-schema` and the writer; the default list; card values in the index reads; the performance test.
2. **OC-b card:** `ObjectCard` and its use on boards, card embeds, previews and the duplicate dialog; Task rules kept.
3. **OC-c picker and settings:** the icon data and picker; type settings redrawn with Card, Properties and Views; icons in tables and the property panel.
4. **OC-d Settings:** the shared styles applied to the eight Settings sections.

Each step follows the per-slice loop (ACs → contract → red tests → implementation → `./verify push` → explorer → preview) and the D-61 rules. If the slice must be cut, OC-d detaches cleanly; OC-a…OC-c do not.

## 11. Size and risk

- **Size:** larger than Q2-T. The card touches five places that each have AC tests.
- **Risks:**
  - Board performance with more values per card (kept in one read; measured in OC-a).
  - The icon data's size in the bundle (loaded only when the picker opens; type and property icons in use need their paths without it, so the app resolves used icons from the same data at build or first use: settled in the contract).
  - Many changed AC tests in one slice.
