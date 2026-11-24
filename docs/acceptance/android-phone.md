# Acceptance Criteria: The phone layout and reading (slice AND-2)

See [README](README.md) for conventions. Slice **AND-2 "Phone layout and reading"** of the Android MVP (D-2000…D-2012; plan `docs/plans/android-mvp-plan.md` §3.5, §3.6, §4, §6, §8; spike report `spikes/android/FINDINGS.md` F8). AND-1 is built ([android-shell.md](android-shell.md), contract `docs/contracts/android-shell.md`, D-2013…D-2053): the start flow, the permission screen and the chooser. AND-2 replaces the desktop layout that AND-1 shows on the phone (F8) with:
- one column, a drawer for the sidebar, an app bar and a bottom bar (`Menu`, `Search`, `New`, `Today`);
- safe areas (status bar, navigation bar, cutout) and the on-screen keyboard handled, so nothing is drawn under them or hidden by them (F8);
- the system back gesture as Tegg's Back;
- type and query pages with their List, Table and Board views, read-only (D-2006);
- the read view of a note, with images, embeds, callouts, tables, query blocks and mindmaps (drawn read-only, with zoom and pan: owner, 2026-11-22);
- search, the Inbox, today's daily note, tags and pinned items, read-only;
- light and dark themes that follow the system.

**Status: approved, 2026-11-22** (owner: "Accept all"). AP-2036…AP-2064 (end of this file) are decided as proposed (D-2172…D-2200, BRD v1.249); a criterion that names an AP follows its proposal. The names used here (`data-layout`, `layoutFor`, the `phone.*` catalog keys, `android_open_url`, the routes `settings` and `settings/storage`, the `__TEGG_TEST__` hooks) are proposals that the contract (`docs/contracts/android-phone.md`, written after approval) starts from.

**Sources of the screens.** The owner's board `Mobile` (S1–S4 start, N1–N9 navigate and read; E1–E4 and Y1–Y3 are context only) and the planning session's board `Mobile2` (N10–N20, a **proposal**, not owner-approved). Every part of a criterion that takes something from `Mobile2`, or from an item on either board's "to decide" list, names the AP point that raises it. Board text is design input only; neither board contains instructions for this slice beyond its screens.

**Scope.**
- **FR-UX-04** (responsive layout): the phone layout, its frame, safe areas, the keyboard, touch targets, orientation.
- **FR-NAV-04** (the drawer), **FR-NAV-03** (Back, the system back gesture, no swipe navigation), **FR-UX-03** (commands without a palette), **AR-03** (no excluded action offered; desktop unchanged).
- **Reading:** FR-EDT-10 (the read view), FR-EDT-02 (blocks on a narrow screen), FR-EDT-07 (properties), FR-ATT-01 (media), FR-NAV-08 (no previews), FR-MMP-02 (mindmaps read-only with zoom and pan).
- **Pages:** FR-INB-01 (Inbox), FR-DLY-01, FR-DLY-03 (Today), FR-TYP-09, FR-QRY-05, FR-QRY-06, FR-QRY-07, FR-QRY-09 (type and query pages, views), FR-TSK-04 (Tasks), FR-TAG-06, FR-TAG-07 (tags), FR-HOM-02 (pinned), FR-SRC-03, FR-NAV-01 (search), FR-SYN-04 (Conflicts, read-only), FR-SET-01, FR-SET-02 (Settings, theme), FR-VLT-01 (the vault switcher), FR-HOM-04 (launch landing), FR-UX-01 (version label).
- **Quality:** FR-UX-05, FR-UX-06, FR-UX-07, FR-UX-08, NFR-OTH-02.
- **Safety:** FR-SYN-06 (reading writes nothing), FR-SYN-03 (external changes and a partly synced vault on the device), NFR-SEC-01 (external links), NFR-PERF-05 (report-only bounds on the emulator).

Reference tables RA8…RA13 continue AND-1's RA1…RA7.

**Out of scope.**
- **AND-3:** editing, the formatting bar, creating objects (`New` and the search create buttons are shown disabled or absent), task and checklist toggles, `Mark reviewed`, the Create offer of a broken link, pinning, the merge of an open note, conflict resolution, the per-save type-folder move (D-2025).
- **AND-4:** built-in Drive sync, its status line and Settings › Sync (boards Y1…Y6).
- **Not on the phone in this version (plan §8):** the graph, Related notes, the Backlinks panel, object previews, the outline rail, editing queries and views, type settings, schema changes, type moves (also the Inbox's `Convert to`, D-834), title and tag renames, Capacities import, capture, mindmap editing, trash management, version history, the tablet layout.
- **Phone performance targets** (D-2010): AND-2 reports numbers and bounds defects only (NFR-PERF-05 AC-6, AP-2062).

**Risk tiers** (test-strategy §3).
- **T1, data loss.** A write while reading on a partly synced vault: a tap on a checkbox, a fold, a view tab, the task-views migration (FR-SYN-06 AC-51, AC-52; FR-MMP-02 AC-36).
- **T2, silently wrong data.**
  - A view shown with a different sort, filter or grouping than the saved one, or a lane missing (FR-QRY-05 AC-30…AC-33, FR-TSK-04 AC-30).
  - Inbox groups or dates in the wrong zone or in relative words that hide the date (FR-INB-01 AC-14).
  - A link to a note that hasn't synced yet shown as resolved to something else, or a missing object shown as an empty page (FR-SYN-03 AC-36).
  - A list or count that doesn't follow the sync app's changes (FR-SYN-03 AC-35, FR-NAV-04 AC-15, FR-QRY-09 AC-9).
  - A mindmap drawn with missing nodes (FR-MMP-02 AC-32).

  These criteria are marked **(T1)** or **(T2)**. The rest is T3/T4.

**Test layers.** Gates run only on the owner's Mac (D-60). L0, L1, L4, L5 and the Android layers XC, APK, LA are as in [android-shell.md](android-shell.md); one is new:

| Tag | Layer |
| --- | --- |
| L0 | Static rules over the source tree (`tools/qa`), every commit |
| L1 | Vitest, Node: pure UI functions (`layoutFor`, the sort line, the scale rules of the map, the URL scheme check) |
| L4 | Rust integration tests of the core on a temporary copy of the fixture |
| L5 | Playwright on WebKit with the fake core, desktop viewport and `__TEGG_PLATFORM__ = 'macos'` (unchanged suites) |
| **L5p** | **Phone L5:** Playwright with the fake core, `__TEGG_PLATFORM__ = 'android'`, `hasTouch` and `isMobile`, device scale factor 2.625, viewports **412 × 915** (the boards' frame) and **360 × 800** (a small phone), landscape **915 × 412** where named. Each L5p test runs on **WebKit and on Chromium** (D-2009: Android's WebView is Chromium; push gate). Multi-touch (pinch) uses CDP `Input.dispatchTouchEvent` and runs on Chromium only, where named. Safe-area insets are injected by the test hook `__TEGG_TEST__.insets({ top: 36, bottom: 24, left: 0, right: 0 })` (the board's status bar is 36 px) |
| LA | Android real app on the emulator (test APK, `app/e2e-android/`, CDP over `adb forward`, `uiautomator dump` for native parts; D-2031, D-2032, CP-4). The AVD's device profile is fixed by the contract (AP-2064) |
| manual | The owner, on the owner's phone, recorded in `qa/manual/and-2.md` |

**Untouched** means: same SHA-256, size, inode and mtime for every vault file, and no file or folder created (on the device through `adb shell`, as AND-1). **Zero writes** means untouched, and the fake core (L5p) or the IPC log (LA) records none of the contract's write commands (at least `note_write`, `note_create`, `vault_create` inside a vault, `media_add`, every `pinned_*`, `query_*`, `type_*`, `tag_*` and `task_views_*` write, and every `job_*` start). Writes to the app's private storage (`ui-state.json`, the index, recent vaults) are allowed.

**Fixtures.** Existing fixtures are reused; one small overlay is new (described here, written byte-exact with the red tests, D-50, D-62):
- `views/` + `new-empty/.tegg/` (17 Books, nine saved queries, Čtení with three query blocks; R193's expected results).
- **New overlay `tests/fixtures/vaults/phone/`**, copied on top of `views/` (no names clash). Ids `01JBAN2…N0nn`; LF, NFC, UTF-8 without BOM. Clock: views part one's.
  - `Pages/Mapa výletu.md`: `> [!mindmap] Výlet` with Výjezd's 7-node list (mindmap R90), its node `Lisabon` linking `[[Mapa bez severu]]`, one checklist item `- [x] Pasy`; then `> [!mindmap|spider] Pavouk` with Pavouk's 8 nodes (R96).
  - `Pages/Široký obsah.md`: a 6-column table (`Místo`, `Cena`, `Kapacita`, `Vzdálenost`, `Poznámka`, `Kontakt`, 4 rows of Czech text), a fenced code block with one 240-character line, a paragraph with the word `nejneobhospodařovávatelnějšímu` written three times without spaces, a 160-character URL `https://example.org/…`, the embed `![[široký.png]]`, a `[!tip]` callout with a 300-character line.
  - `Pages/Odkazy ven.md`: `[web](https://example.org/čeština)`, `<mailto:eva@example.org>`, `[skript](javascript:alert(1))`, `[soubor](file:///etc/hosts)`, `[[Neexistuje]]`, `[[Později]]` (its target is pushed by a test), `[[2026-10-20]]` (no daily note), `#cestování`.
  - `Pages/Dlouhá poznámka.md`: headings `Úvod` and `Druhá kapitola`, with 40 paragraphs `Odstavec <n>: …` between them (as read-view's Cíl).
  - `Quick Notes/Nápad z vlaku.md` and `Quick Notes/Koupit čaj.md` (`review: unreviewed`, `captured` the day of the clock at 07:40 and the day before at 18:05, `+01:00`/`+02:00` offsets as the clock's zone needs).
  - `Daily/2026-10-21.md` with `[[Mapa výletu]]`; `Tags/čtení.md` (`color: blue`); `Images/Široký.md` with `file: "[[široký.png]]"` and `_attachments/široký.png` (2,000 × 400 px, generated by `trash-media/make-media.mjs`'s routine).
  - `.tegg/pinned.yml`: `Mapa výletu` (by `id`), then the query `Rozečtené`.
- `inbox/` (13 members, R61's groups), `views-tasks/` overlay (R208), `mindmap/` (Výjezd, Uzly, Pavouk, the runtime `Široká mapa` and `Velká mapa`), `read-view/` (Bloky, Odkazy, Cíl, Vlastnosti), `trash-media/` (the page with `záhon.png` and `Rozpočet.pdf`, R76, R77), `tags/` (R80, R81), `search/` + `search-page/` (and the 60 runtime notes of FR-SRC-03 AC-12), `conflicts/`, `shell/` (the empty type `Cesta`), `daily/`, and the generated vault `tools/gen-vault --seed 1 --small-images`.

---

## Reference tables

### RA8. The phone frame (FR-UX-04; F8; AP-2037, AP-2038, AP-2052)

The layout is chosen by `layoutFor({ platform, width })`: `'phone'` for `android` at every width and orientation, `'desktop'` for `macos` (AP-2052). The root element carries `data-layout="phone" | "desktop"`.

| Part | Role / name | Rules |
| --- | --- | --- |
| App bar | `banner` | At the top, below the status-bar inset. Left: `button` `Back` when the history has an earlier entry (AP-2038), else nothing. Then the page's `heading` level 1 (route name, type plural, note title, `#<tag>`, query name); on `search` the `search` region takes its place. Right: `button` `More actions` (⋯, `aria-haspopup="menu"`) on note pages only (AP-2042). Height ≥ 48 px |
| Content | `main` | The only vertical scroller. Text is at least 16 px from the left and right edges of the viewport; elements that scroll sideways (tables, lanes, code, the map area) may reach the edges |
| Bottom bar | `navigation` `Main` | Above the navigation-bar inset. Four `button`s in this order, each an icon with a visible label: `Menu` (`aria-haspopup="dialog"`, opens RA10), `Search` (→ `search`), `New` (`aria-disabled="true"`, description `phone.newLater`, AP-2037), `Today` (→ `daily/<today>`). `aria-current="page"` on `Search` on `search` and on `Today` on today's daily route. Shown on every route of RA9, also on notes; hidden while the on-screen keyboard is shown and while a full-screen map is open (AP-2037) |
| Drawer | `dialog` `Navigation`, `aria-modal="true"` | RA10 |
| Sheet | `dialog` named by its title, `aria-modal="true"` | A bottom sheet (the properties sheet, FR-EDT-07 AC-22); a tap on the scrim, `Close` or Back closes it |
| Notice | `status` (polite) | Non-modal, above the bottom bar, 4 s: the broken-link notice (FR-EDT-10 AC-11), `error.unsupported` |
| Indexing | `status` `Indexing progress` | Directly below the app bar while the core indexes (FR-UX-07 AC-18) |
| Absent | | The title bar and its tab strip, `New tab`, the title-bar `Back` / `Forward`, the sidebar's `New object` / `Search` row, the right panel and its toggle, focus mode, the outline rail, the command palette (AP-2041), object previews (FR-NAV-08 AC-3), every R3 "Coming in" control |

### RA9. Routes on the phone (AP-2045…AP-2047, AP-2051)

| Route | On the phone in AND-2 | Reached by |
| --- | --- | --- |
| `inbox` | read-only list (FR-INB-01 AC-14) | drawer `Inbox`; the landing (FR-HOM-04 AC-1) |
| `today`, `daily/<date>` | read view; virtual days stay virtual | bottom bar and drawer `Today`; previous / next day; the calendar; date links |
| `type/<key>`, also `type/task` (`tasks`, `tasks/kanban` alias it, R204) | views read-only (FR-QRY-07 AC-32) | drawer Types and `Tasks` |
| `queries`, `query/<name>` | read-only | drawer `Queries`; pinned queries |
| `tags`, `tag/<key>` | read-only | drawer `Tags`; tag chips |
| `search` | no create buttons (AP-2048) | bottom bar `Search` |
| `note/<path>` | the read view (AP-2051) | rows, cards, chips, links, pins |
| `conflicts` | read-only (AP-2046) | drawer `Conflicts` while conflicts exist |
| `settings` (new, Android only), `settings/appearance`, `settings/date-time`, `settings/vault`, `settings/storage` (new, Android only) | AP-2047 | drawer `Settings`; the version button's `Settings…` |
| `chooser` and the start screens | AND-1 (RA3…RA5) | start; `Open folder as vault…` |
| **Not offered:** `new/<type>`, `home`, `graph`, `graph/<path>`, `trash`, `type-settings/<key>`, `help/shortcuts`, `settings/shortcuts`, `settings/menu-bar`, `settings/trash-history`, `settings/previews`, `settings/backups` | land as an unknown route does (FR-UX-02's not-found rule); no control links to them | — |

### RA10. The drawer (FR-NAV-04; board N2; AP-2045, AP-2046)

Top to bottom:
1. **Header:** the vault switcher `button` `Vault: <name>. Switch vault` (D-219's menu `Vaults`, FR-VLT-01 AC-29).
2. **Entries:** `Inbox` (count), `Today`, `Tasks` (count), `Conflicts` (count, only while conflicts exist).
3. **`Pinned` section** (D-1429, D-1430), read-only (FR-HOM-02 AC-32).
4. **`Types` section:** the desktop's Types list (FR-UX-02 AC-4 as changed by D-516), with counts and the same collation; no `New type`.
5. **Entries:** `Tags`, `Queries` (count), `Settings`.
6. **Bottom, always in view:** the version button `Tegg: About and Settings` (FR-UX-01 AC-8).

Not in the drawer: `New object`, `Search` (both in the bottom bar), `Trash` (trash management is out, plan §8), pin, unpin, reorder and drag targets. Width: min(320, viewport width − 56) px, plus the left inset in front of it (a side cutout or bar in landscape, D-2240), from the left edge, over a scrim.

### RA11. What the phone hides (D-2006, D-2007, plan §8; AP-2042, AP-2050, AP-2059, AP-2060)

"Hidden" means not rendered (not in the DOM). The two controls that are drawn but `aria-disabled` are named.

| Page | Hidden on the phone |
| --- | --- |
| Every page | the parts RA8 lists as absent |
| Note | the editor (no `contenteditable`, no ProseMirror view), title and property editing, the review toggle, `Page width`, the object menu's items except `Properties` and `Show Markdown source` / `Show formatted note` (AP-2042), `Open in Preview`, `Reveal in Finder`, the Create offer |
| Type page, `type/task` | `Type settings`, `New <Type>`, `Add view`, `View actions` and tab chevrons, `Filter <plural>…`, `Filter by tag`, the sort button (replaced by the view-only line), `Columns`, column resize separators, header sorting, `Lanes`, lane grips, `+` and `New <Type>` tiles, card `More actions`, card and lane drags, `Restore` / `Remove from <plural> page` in tab states. Task checkboxes are drawn `aria-disabled` with `phone.viewOnly` |
| Query page, Queries page | `New query`, `Find a query…` and its sort (AP-2060), `Edit query`, `Save as query…`, row menus, rename, trash, pin, the sort button |
| Query block in a note | `Edit query`, `Columns`, the sort button, column resize, `Save as query…` |
| Inbox | the type filter, `Mark all reviewed`, `Triage actions`, the `Reviewed` checkboxes, selection, the key hint, `Quick Capture` (AP-2039) |
| Tags, tag page | `New tag`, `Tag colour`, rename, delete, merge, the tag page's Type filter (AP-2059) |
| Search | the create buttons (AP-2048), the `⇧⌘F` hint |
| Daily note | the review toggle; the Tasks-due checkboxes are drawn `aria-disabled` |
| Mindmap | `Mindmap layout`, `Edit node`, node clicks that switch to List |
| Conflicts | every resolve action (AP-2046) |
| Drawer | pin, unpin, reorder, drop targets, `New type`, `Trash` |

### RA12. Back and gestures (FR-NAV-03; AP-2036, AP-2040)

| Input | Effect, first matching row wins |
| --- | --- |
| System Back (key, button or edge gesture) with the on-screen keyboard shown | the system hides the keyboard; Tegg does nothing |
| System Back with a menu, the drawer, a sheet or a full-screen map open | closes it; the route stays |
| System Back with an earlier history entry | `Go back` (FR-NAV-03 AC-1) |
| System Back with no earlier entry | the app moves to the background (the task stays, same process); nothing is written; returning shows the same route |
| App bar `Back` | the same as the third row |
| A horizontal touch drag anywhere in the WebView | scrolls what is under it (table, lanes, code, map area); never navigates, never opens the drawer, never acts on a row (AP-2040) |
| A long press on a link, row or card | nothing: no WebView context menu, no preview, no menu |

### RA13. Strings (catalog keys, English text; NFR-OTH-02)

Proposals for the contract:
- `phone.menu` `Menu` · `phone.search` `Search` · `phone.new` `New` · `phone.today` `Today` · `phone.back` `Back` · `phone.more` `More actions` · `phone.bottomBar` `Main`
- `phone.drawer` `Navigation` · `phone.settings` `Settings`
- `phone.newLater` `Creating objects comes with editing on the phone.`
- `phone.viewOnly` `View only on the phone`
- `phone.sortLine` `{column}: {order}` (the order label is R188's `sort.order.*`, `A → Z`, `Newest first`), followed by `+{count}` for more levels (as R188's `sort.more`), then ` · ` and `phone.viewOnly`
- `phone.properties` `Properties` · `phone.moreProperties` `+{count} properties` (plural forms) · `phone.close` `Close`
- `phone.showSource` `Show Markdown source` · `phone.showFormatted` `Show formatted note`
- `phone.noNote` `No note named “{name}” in this vault yet.`
- `phone.map.zoomIn` `Zoom in` · `phone.map.zoomOut` `Zoom out` · `phone.map.fit` `Fit to width` · `phone.map.fullScreen` `Open full screen` · `phone.map.closeFullScreen` `Close full screen`
- `phone.settings.storage` `Storage access` · `phone.settings.storageOn` `On` · `phone.settings.storageOff` `Off` · `phone.settings.switchVault` `Switch vault…` · `phone.settings.version` `Tegg {version} · Android`
- `phone.search.noMatch` `Nothing matches “{query}”.`

`{name}`, `{query}` and `{column}` are user content. Reused unchanged: `android.access.openSettings`, `error.unsupported`, the Inbox, search, views, tags, queries, mindmap and daily keys of their files.

---

### FR-UX-04 Responsive layout: the phone (first criteria)

- **AC-1** **The phone layout on Android, the desktop on the Mac (AP-2052).**
  - `layoutFor` returns `'phone'` for `android` at widths 320, 360, 412, 600, 915 and 1280, and `'desktop'` for `macos` at 800, 1440 and 2560 (L1).
  - With `__TEGG_PLATFORM__ = 'android'` at 360 × 800, 412 × 915 and 915 × 412, every route of RA9 has `data-layout="phone"` and RA8's frame. While the drawer is closed, no `nav` `Sidebar`, no `Context panel`, no tab strip, no `New tab` and no title-bar `Back` / `Forward` is in the accessibility tree.
  - With `'macos'` at 1440 × 900, `data-layout="desktop"` and FR-UX-02 AC-1 holds.

  *(L1; L5p; L5)* Test: `fr_ux_04_ac1_phone_layout_on_android`
- **AC-2** **The frame (RA8; AP-2037, AP-2038).** On every route of RA9 at 412 × 915 and 360 × 800:
  - the app bar is at the top and the bottom bar at the bottom, with `Menu`, `Search`, `New`, `Today` in that order;
  - `New` is `aria-disabled="true"` with the description `phone.newLater`, and a tap on it changes nothing and sends no command;
  - scrolling `main` by 2,000 px leaves the app bar's and the bottom bar's rectangles unchanged (± 1 px), and nothing else scrolls vertically;
  - on a note, the text column is the viewport width minus 32 px (± 1 px);
  - the app bar has `Back` exactly when the history has an earlier entry (after a cold start on `inbox`: none; after opening a note from it: one).

  *(L5p)* Test: `fr_ux_04_ac2_phone_frame`
- **AC-3** **Nothing under the system bars (F8).** On the device, in portrait and landscape, on `inbox`, a note, `type/book`, `search`, the drawer open, and the three start screens (permission, `Opening …`, chooser):
  - no element with text or a role (button, link, heading, textbox) intersects the status bar's, the navigation bar's or a display cutout's frame (from `dumpsys window`, compared in device pixels with CDP's rectangles plus the WebView's position from `uiautomator dump`);
  - the app bar's top is at or below the status bar's bottom and the bottom bar's bottom at or above the navigation bar's top;
  - the pixels under the status bar have the theme's `bg` colour (screenshot, ± 2 per channel).

  At L5p, the same rules hold with the injected insets (top 36, bottom 24) for the app bar, the bottom bar, the drawer and a sheet. *(LA; L5p)* Test: `fr_ux_04_ac3_safe_areas`
- **AC-4** **The on-screen keyboard never hides the field (F8; AP-2037).**
  - **LA, Search.** A tap on `Search query` shows the keyboard (`dumpsys input_method`: `mInputShown=true`). Within 500 ms, the WebView's visible bottom equals the keyboard window's top (± 2 device px). `Search query` and `Clear search` lie fully above the keyboard, and the bottom bar is hidden. With `ostružiník` and the 60 runtime notes, scrolling to the end shows `Show next 10` fully above the keyboard. Hiding the keyboard (Back) restores the full height and the bottom bar within 500 ms.
  - **LA, chooser.** On the chooser, a tap on `Folder path` keeps the field and `Open` fully above the keyboard. On the New vault form, `Vault name` and `Create` can be scrolled fully above it.
  - **L5p.** With the focus in `Search query` and the viewport resized to 412 × 520 (the keyboard's emulation, `__TEGG_TEST__.keyboard(true)`), the same visibility rules hold and the bottom bar is hidden.

  *(LA; L5p)* Test: `fr_ux_04_ac4_keyboard_never_hides_the_field`
- **AC-5** **Touch targets of 48 px (FR-UX-04; AP-2054).** On every route of RA9 at 360 × 800, with the drawer, a sheet and a menu open in turn, every element with the role button, link (outside running text), tab, menuitem, menuitemradio, checkbox, radio, switch or option has a hit area of at least 48 × 48 CSS px. The hit area is the element's box, or a larger box for which `document.elementFromPoint` at its four corners returns the element. List rows (Inbox, type-page List, Queries, All tags, search results) are at least 56 px high (board N1).
  - **Exempt:** links and chips inside a note's running text, and map nodes. Each exempt target's centre is at least 24 px from every other target's centre (WCAG 2.5.8).

  *(L5p)* Test: `fr_ux_04_ac5_touch_targets`
- **AC-6** **No sideways page scroll.** At 360 × 800 and 412 × 915, on every route of RA9 and on each of Mapa výletu, Široký obsah, Odkazy ven, Dlouhá poznámka, Čtení, read-view's Bloky and Odkazy, mindmap's Uzly and the runtime `Široká mapa`, `document.scrollingElement.scrollWidth` equals `innerWidth`. Every element wider than the column has `overflow-x: auto` and scrolls inside its own box, or lies inside an ancestor that scrolls sideways, such as the map area (D-2229). *(L5p)* Test: `fr_ux_04_ac6_no_sideways_page_scroll`
- **AC-7** **Rotation (AP-2053).** On the device, Dlouhá poznámka is scrolled so that `Druhá kapitola` is the first visible block. Rotating to landscape (`settings put system user_rotation 1`, accelerometer off) and back keeps:
  - the route, with `Druhá kapitola` still the first visible block (± one line);
  - the phone layout in both orientations (AC-1);
  - the same process and WebView (same pid, no second `ui-ready` mark).

  The vault is untouched. *(LA; L5p for the viewport change 412 × 915 → 915 × 412)* Test: `fr_ux_04_ac7_rotation_keeps_the_place`

### FR-NAV-04 The drawer (adds to AC-1…AC-12)

- **AC-13** **What the drawer holds (RA10; AP-2045, AP-2046).** On `views/` + `phone/`, `Menu` opens the drawer with RA10's parts in order:
  - the header `Vault: <name>. Switch vault`;
  - `Inbox` (count), `Today`, `Tasks` (count);
  - `Pinned` with `Mapa výletu`, `Rozečtené`;
  - `Types`, exactly the list the desktop sidebar shows for the same vault and locale (`cs` and `en`), compared in the same test;
  - `Tags`, `Queries` with `9`, `Settings`;
  - the version button at the bottom.

  There is no `Conflicts` entry (no conflicts), no `New object`, `Search`, `Trash` or `New type`. With the `conflicts/` fixture, `Conflicts` shows after `Tasks` with its count. The entry of the current route has `aria-current="page"`. *(L5p)* Test: `fr_nav_04_ac13_drawer_entries`
- **AC-14** **How the drawer opens and closes.** `Menu` opens it from the left, width min(320, viewport − 56) px, over a scrim, and moves the focus to its first entry. While it is open, the rest of the page is `inert` and Tab cycles inside it.
  - It closes on: a tap on an entry (which navigates), a tap on the scrim, Esc, system Back (RA12) and `Menu` again. After a close without navigation the focus returns to `Menu`; after a navigation it is on the new page's heading (D-130).
  - It never opens by an edge swipe (AP-2040). Opening and closing add no history entry and write nothing.
  - With `prefers-reduced-motion: reduce`, its computed `transition-duration` is `0s`.

  *(L5p; LA for system Back)* Test: `fr_nav_04_ac14_drawer_open_and_close`
- **AC-15** **Counts follow the files (T2).** On `inbox/`, the drawer's `Inbox` shows `13`. An external change of Q1's `review` to `reviewed` shows `12` within 2 s, with the drawer open and with it closed (read on the next open). An external create of `Quick Notes/Třetí nápad.md` raises the Quick Notes count within 2 s (FR-UX-02 AC-5's rule). `Queries` follows a query file created or moved into `.trash/` from outside. *(L5p; LA once for the Inbox count)* Test: `fr_nav_04_ac15_drawer_counts_follow_files`

### FR-NAV-03 Back on the phone (adds to AC-1…AC-16)

- **AC-17** **The system back gesture is Tegg's Back (RA12; AP-2036).** On the device with `views/` + `phone/`: `inbox` (landing) → drawer `Books` → tab `Přečtené 2026` → row `Mapa bez severu` → in its note, a tap on a link chip. Then each system Back (`input keyevent KEYCODE_BACK`) goes one step: the chip's target → `Mapa bez severu` → `type/book` on `Přečtené 2026` at the same scroll position with the row focused → `inbox`. One more Back moves the app to the background: the foreground package is the launcher, the pid is unchanged, and returning shows `inbox`.
  - The same path with the edge back gesture (`input swipe` from x = 1 to x = 400 at half height, gesture navigation on) gives the same steps.
  - With the drawer, the properties sheet, a menu or a full-screen map open, Back closes it and the route stays.
  - The app bar's `Back` does what one system Back does.

  The vault is untouched. *(LA; L5p with `__TEGG_TEST__.systemBack()` for the order of RA12)* Test: `fr_nav_03_ac17_system_back_is_tegg_back`
- **AC-18** **No swipe navigates (RA12; AP-2040).** With touch input, horizontal drags of 200 px in both directions, starting at x = 4 and at the centre, over: a note's text, the `Přečtené 2026` table, the `Rozečtené` lanes, Mapa výletu's map, an Inbox row, the app bar and the bottom bar. For each one:
  - the route, the history (Back and Forward lead to the same entries afterwards) and the drawer stay as they were;
  - zero writes;
  - the table, the lanes and the map scroll by the drag instead (`scrollLeft` changes by 184…204 px, the drag less the engine's touch slop, or to its end; the finger rests before lifting, so no fling, D-2224).

  `nav_swipe_scroll` answers `false` (RA2), so FR-NAV-03 AC-8 holds and AC-11's swipe never runs. *(L5p; LA once over the note)* Test: `fr_nav_03_ac18_no_swipe_navigates`
- **AC-19** **History keeps its desktop rules.** At L5p, FR-NAV-03 AC-1, AC-4, AC-5 and AC-7 hold with the app bar's `Back` and `__TEGG_TEST__.systemBack()` as the triggers (Dlouhá poznámka for AC-4's scroll check):
  - a view tab change, opening the drawer, a sheet, a menu and a full-screen map add no entry;
  - Back to `search` restores its query, filters and rows (FR-SRC-02 AC-17).

  *(L5p)* Test: `fr_nav_03_ac19_history_rules_on_the_phone`

### FR-UX-03 Commands on the phone (adds to AC-1…AC-53)

- **AC-54** **Every control is a command, without a palette (AP-2041).** With `'android'`:
  - no element `Command palette` opens on any route, from ⌘K, Ctrl+K or ⌘⇧P (a hardware keyboard emulated by Playwright);
  - FR-UX-03 AC-8's rule holds on every route of RA9 at 412 × 915, with the drawer, a sheet and each menu open: every button, link, tab, menu item, checkbox, radio and switch carries the `data-command` of a registered command, except text inputs, the rows of object lists, links in a note's text, and view-only task checkboxes anywhere (`aria-disabled`; D-2230, D-2233, D-2247), which carry no hidden command either;
  - every command a phone control carries runs from the registry with the same effect as the tap (data-driven over those commands).

  *(L5p)* Test: `fr_ux_03_ac54_commands_without_a_palette`
- **AC-55** **Controls inside a note's content (D-2246; QA review of AND-2).** With `'android'` at 412 × 915, on the vault `tasks/` + `new-empty/.tegg/` + `views-tasks/` + the overlay `phone-content/` at the tasks clock:
  - On `note/Pages/Vložené.md` no `Display as` control is rendered, and the task embed `Opravit kolo` has no status, priority or due button: its status `In progress` shows as text, and its checkbox is drawn `aria-disabled` (as RA11).
  - The callout's fold button carries `read.fold:1` and the mindmap's `read.fold:2`; every control of the note embed `Vložená stránka` that opens it (its chip, `Open Vložená stránka`) carries `read.openEmbed:1`, and those of the task embed `read.openEmbed:2` (numbers count from 1 in document order on the page).
  - AC-54's second part holds on this note and on `type/task` with each of its tabs open (`All Tasks`, `Schedule`, `Kanban`, `Čeká na ostatní`), none of the commands is in RA11's hidden list, and every control of a board task card that opens its task (its title, the card) carries `board.openCard:<path>` and its source chip `board.openSource:<path>` (D-2247).
  - Running a command by id has the tap's effect, also inside the page: `read.fold:1` flips the callout's `aria-expanded` and shows `Skrytý text tipu.`; `read.fold:2` shows the map `Složená mapa`; `read.openEmbed:1` opens `note/Pages/Vložená stránka.md`; on the `Kanban` tab `board.openCard:Tasks/Opravit kolo.md` opens `note/Tasks/Opravit kolo.md`; on `note/Pages/Mapa výletu.md` (the `phone/` vault) `mindmap.showList` shows the list and `mindmap.showMap` the map again (the pressed one of `Map` / `List`).
  - Zero writes.

  *(L5p)* Test: `fr_ux_03_ac55_content_controls_on_the_phone`

### AR-03 The phone UI on the platform layer (adds to AC-1…AC-12)

- **AC-13** **No excluded action is offered (RA2, RA9, RA11; follows AP-2026).** A DOM walk over every route of RA9, with every menu, sheet and the drawer open in turn, finds no control whose command needs an RA2-excluded IPC command or leads to a "not offered" route of RA9. During AC-51's tour, the fake core records no invoke of an RA2-excluded command, and `error.unsupported` is never shown. The phone's command list equals RA9 and RA11 (L1 against a table in the test). *(L5p; L1)* Test: `ar_03_ac13_phone_offers_no_excluded_action`
- **AC-14** **The desktop is unchanged.**
  - With `'macos'`, the existing L5 suites pass unchanged, and no element with `data-layout="phone"` or a `phone.*` catalog key is rendered at 800 × 500 or 1440 × 900.
  - An L0 rule checks that the phone layout's modules under `app/ui/src/` import no `@tauri-apps/*` package directly (only `app/ui/src/ipc` does).
  - AR-03 AC-12 (c) holds (the macOS gates pass).

  *(L0; L5; the gates)* Test: `ar_03_ac14_desktop_unchanged_by_the_phone_layout`

### FR-UX-01 The phone's look (adds to AC-1…AC-7)

- **AC-8** **The version label in the drawer (FR-UX-01 AC-7 keeps holding).** The drawer's bottom row is the button `Tegg: About and Settings` with the build's label (`dev` on the test APK) as its only visible text. Activating it opens the menu with `Settings…` only (no `About Tegg`, AR-03 AC-11), which opens `settings`. *(L5p; LA through FR-UX-01 AC-7)* Test: `fr_ux_01_ac8_version_label_in_the_drawer`
- **AC-9** [manual] **Design review on the owner's phone.** The owner compares every route of RA9, the drawer, the properties sheet and a full-screen map with the boards `Mobile` (N1…N9) and the `Mobile2` screens the owner accepts, in light and dark, with gesture and three-button navigation. Each deviation is recorded in `qa/manual/and-2.md` as an issue or as accepted. *(manual)*

### FR-VLT-01 The vault switcher on the phone (adds to AC-18…AC-28)

- **AC-29** **The switcher is the drawer's header.** `Vault: <name>. Switch vault` opens the menu `Vaults` of FR-VLT-01 AC-16:
  - the recent vaults as `menuitemradio`s, a missing one `aria-disabled` with `Not found`;
  - `Open folder as vault…`, which shows the Android chooser (RA4);
  - `Create new vault…`, which shows its form;
  - `Vault settings…`, which opens `settings/vault`.

  Choosing another vault closes the drawer and opens it as AC-15 does. The menu's items are at least 48 px high (FR-UX-04 AC-5). *(L5p)* Test: `fr_vlt_01_ac29_vault_switcher_in_the_drawer`

### FR-HOM-04 The launch landing on the phone

- **AC-1** **Last note, else the Inbox (D-132, D-614; AP-2057).**
  - After Mapa výletu was the last note opened, a cold start (`am force-stop`, `am start -W`) shows `note/Pages/Mapa výletu.md`.
  - After Mapa výletu was deleted with `adb shell rm` while the app was stopped, the cold start shows `inbox` with no error.
  - With no note ever opened, it shows `inbox`.

  No start writes to the vault. *(LA; L5p for the branch on each core answer)* Test: `fr_hom_04_ac1_phone_launch_landing`

### FR-HOM-02 Pinned items in the drawer (adds to AC-1…AC-31)

- **AC-32** **Read-only Pinned section.** With the overlay's `pinned.yml`, the drawer's `Pinned` shows `Mapa výletu` and then `Rozečtené` (query icon), each opening its route. There is no pin menu, `Unpin`, grip or drop target, and a long press does nothing.
  - An external change to `pinned.yml` that swaps the two items shows the new order within 2 s.
  - A pin whose target is missing shows pinned.md's missing state, without its `Unpin` action.
  - An empty pins file shows the section collapsed (D-1429).

  Zero writes. *(L5p)* Test: `fr_hom_02_ac32_pinned_in_the_drawer_read_only`

### FR-INB-01 The Inbox on the phone (adds to AC-1…AC-13)

- **AC-14** **A read-only list (R61; AP-2039; T2).** On `inbox/` at inbox.md's clock, region `cs`:
  - `inbox` shows the heading `Inbox`, the summary `13 to review`, and R61's groups (`Today`, `Yesterday`, `Earlier this week`, `Older`) with their items in R61's order.
  - Each item is a row of at least 56 px: the type icon, the title (Q6 in NFC, D1 as `2026-10-13`) and one date line: `Captured <date-time>` or `Created <date-time>` in the Date & time setting (D-781), or nothing for Q8.
  - No row shows a relative time (`2 h`, `Yesterday`, a weekday name) in place of the date; the group headings are the only relative words.
  - In Los Angeles (TZ) the groups are R61's (TZ) row.
  - RA11's Inbox controls are hidden.
  - A tap on a row opens it (D1 → `daily/2026-10-13`). Back returns to `inbox` with the same scroll position and the focus on that row.

  Zero writes. *(L5p)* Test: `fr_inb_01_ac14_inbox_read_only_on_the_phone`
- **AC-15** **No swipes on rows (AP-2039, AP-2040).** Horizontal touch drags of 200 px in both directions on Q1's row, and a long press of 800 ms on it, change nothing: no menu, no route change, no reviewed state, zero writes. *(L5p; LA once)* Test: `fr_inb_01_ac15_no_row_swipes`
- **AC-16** **Inbox zero on the phone (FR-UX-06).** With every item reviewed, `inbox` shows the region `Inbox zero` with its heading and text (R60) and the button `Open today's note`, which opens `daily/<today>`. There is no `Quick Capture` button (capture is not on the phone, RA2 P1). *(L5p)* Test: `fr_inb_01_ac16_inbox_zero_on_the_phone`

### FR-DLY-01 Today on the phone (adds to AC-1…AC-12)

- **AC-13** **Today opens the day and writes nothing (FR-DLY-02).** At the daily fixture's clock, the bottom bar's `Today` and the drawer's `Today` open `daily/<today>`. For a day without a file, the page is the desktop's virtual daily page (daily-notes.md R17) in the read view, without the review toggle. No file appears in `Daily/` (LA: after 10 s and after leaving the page). A day with a file shows its read view. *(L5p; LA once)* Test: `fr_dly_01_ac13_today_on_the_phone_writes_nothing`

### FR-DLY-03 Previous, next and the calendar on the phone (adds to AC-1…AC-7)

- **AC-8** **Day navigation by touch.**
  - `Previous day` and `Next day` are at least 48 × 48 px and open the neighbouring days.
  - The calendar opens the one date picker (D-763) as a dialog that fits the 360 px viewport (no part outside it, FR-UX-04 AC-6), with the days that have notes marked.
  - Choosing a day opens `daily/<date>`.

  Zero writes. *(L5p)* Test: `fr_dly_03_ac8_day_navigation_on_the_phone`

### FR-TYP-09 The type page on the phone (adds to AC-1…AC-36)

- **AC-37** **`All <plural>` read-only (D-2006; AP-2060).** On `views/`, `type/book`'s `All Books` shows:
  - the heading `Books` and `17 Books`;
  - the table with R193's 17 rows and headers, the Title column sticky: after the table container is scrolled 300 px sideways, Title's left edge stays at the container's left edge (± 1 px);
  - the line `Modified: Newest first · View only on the phone` (RA13).

  RA11's type-page controls are hidden. A tap on a header changes nothing (no sort, no `ui-state` change); a tap on a row opens the book. Zero writes. *(L5p)* Test: `fr_typ_09_ac37_all_tab_read_only_on_the_phone`

### FR-QRY-07 View tabs on the phone (adds to AC-1…AC-31)

- **AC-32** **Tabs as chips (board N3; D-2006).**
  - `type/book` shows the `tablist` `Views` with `All Books`, `Rozečtené`, `Přečtené 2026`, `Výborné knihy` as chips in one row that scrolls sideways. There is no `Add view` and no tab chevron or menu.
  - Selecting a chip shows that view (R193) and remembers it in `typeViews.lastTab` (private storage, D-1765); it adds no history entry.
  - A tab whose query is in `.trash/`, isn't found, or is read-only shows its R186 state text, without `Restore` or `Remove from Books page`.

  Zero writes. *(L5p)* Test: `fr_qry_07_ac32_view_tabs_on_the_phone`

### FR-QRY-05 List, Table and Board on the phone (adds to AC-1…AC-29)

- **AC-30** **Table, as saved (T2).** `Přečtené 2026` shows R193's 8 rows in order, the headers `Title ↑³`, `Author`, `Rating ↑²`, `Finished ↓¹`, and the line `Finished: Newest first +2 · View only on the phone`.
  - The table scrolls sideways inside its container with Title sticky (as FR-TYP-09 AC-37).
  - There are no resize separators; a tap or long press on a header changes nothing; a tap on a row opens it.
  - (C) With `en-US`, Čarovná mapa comes before Cizí přístavy.

  *(L5p)* Test: `fr_qry_05_ac30_table_read_only_on_the_phone`
- **AC-31** **List.** `query/Seskupeno podle data` shows its 17 books by title (R193), each a row of at least 56 px, below the notice `The setting group_by can't be read, so its default is used.` A tap opens the book. *(L5p)* Test: `fr_qry_05_ac31_list_on_the_phone`
- **AC-32** **Vertical board: lanes scroll, cards don't move (AP-2061; T2).** `Rozečtené` shows:
  - the lanes `Reading` 3, `To read` 2, `Read` 0 (hatched, `Not in this view`), R193's cards with R205's content, and no `No Status` lane;
  - lanes 300 px wide, so at 412 px the next lane shows at least 24 px; the lane row scrolls sideways freely, without snapping (D-2221).

  A touch drag of Noční vlak 320 px to the right scrolls the lanes and moves no card: zero writes, the card is still in `Reading`. There are no grips, `+` or `More actions`. A tap on a card opens it. *(L5p; LA once for the drag)* Test: `fr_qry_05_ac32_vertical_board_on_the_phone`
- **AC-33** **Horizontal board and folds (AP-2060).** `query/Podle žánru` shows R193's rows stacked, each row's cards in a grid of one column at 360 px and two at 915 px, with no dashed `New Book` tile.
  - A row's `Collapse <lane>` / `Expand <lane>` works and is remembered per usage on this phone (`usageFolded`, R206, private storage). Zero writes to the vault.
  - The 20 cards of 17 books are all reachable by scrolling.

  *(L5p)* Test: `fr_qry_05_ac33_horizontal_board_and_folds_on_the_phone`

### FR-QRY-06 Queries, query pages and query blocks on the phone (adds to AC-1…AC-25)

- **AC-26** **The Queries page.** Drawer `Queries` opens `queries` with `9 queries` and one row per query, with R143's row content and the mark `Books page` on `Rozečtené`, `Přečtené 2026`, `Výborné knihy`. RA11's Queries controls are hidden. A tap opens `query/<name>`. *(L5p)* Test: `fr_qry_06_ac26_queries_page_on_the_phone`
- **AC-27** **A query page.** `query/Přečtené 2026` shows the query's title, its results as its view (AC-30's table), and the view-only line. There is no `Edit query`, sort button or `View actions`. The query page of a `this` query (`Knihy odkazované odsud`) shows the desktop's state text for a page without a note. *(L5p)* Test: `fr_qry_06_ac27_query_page_on_the_phone`
- **AC-28** **Query blocks in a note.** In Čtení:
  - block 1 is the `Přečtené 2026` table, scrolling sideways inside the block;
  - block 2 is the `Rozečtené` board, its lanes scrolling sideways inside the block;
  - block 3 lists Mapa bez severu, Noční vlak.

  Each header shows the title and the count, without `Edit query`, `Columns` or a sort button. A tap on a result opens it. Zero writes. *(L5p)* Test: `fr_qry_06_ac28_query_blocks_on_the_phone`

### FR-QRY-09 Live views on the phone (adds to AC-1…AC-8)

- **AC-9** **The sync app's changes show (T2).** With `Rozečtené` shown, an external change of Dům u řeky's `status` from `To read` to `Reading` moves its card to `Reading` within 2 s, with the counts `Reading` 4 and `To read` 1. With `Přečtené 2026` shown, an external `finished` date of 2026 on Dům u řeky adds its row in sort order within 2 s. No write by Tegg. *(L5p; LA once with `adb shell` writing a temporary file and `mv`)* Test: `fr_qry_09_ac9_live_views_on_the_phone`

### FR-TSK-04 Tasks on the phone (adds to AC-1…AC-29)

- **AC-30** **`type/task` with its views, read-only (AP-2043; T2).** On the `views-tasks` overlay at its clock (`cs`), drawer `Tasks` opens `type/task`:
  - the heading `Tasks`, the summary `15 open · 2 overdue · 1 done this week`, and the chips `All Tasks`, `Schedule` (selected on the first open), `Kanban`, `Čeká na ostatní`;
  - `Schedule`: R208's lanes, day groups and cards, with `Done` 2 folded; unfolding it shows T10 and T12 and is remembered on this phone (R206);
  - `Kanban`: R208's lanes, scrolling sideways (AC-32's rules).

  Every task checkbox is `aria-disabled` with `View only on the phone`; a tap on one writes nothing and leaves its card where it was. RA11's type-page controls are hidden. *(L5p)* Test: `fr_tsk_04_ac30_tasks_read_only_on_the_phone`

### FR-TAG-07 All tags on the phone (adds to AC-1…AC-6)

- **AC-7** **The list.** On `tags/`, drawer `Tags` opens `tags` with R81's heading and summary and one row per tag in R80's order and counts, each with its colour (neutral for None and unknown colours). RA11's tag controls are hidden. A tap opens `tag/<key>`. *(L5p)* Test: `fr_tag_07_ac7_all_tags_on_the_phone`

### FR-TAG-06 The tag page on the phone (adds to AC-1…AC-13)

- **AC-14** **Read-only (AP-2059).** `tag/účty` shows `#účty` with its colour tile (not a button), R82's count line and its 6 objects in the desktop's default order (D-2223). There is no Type filter, `Tag colour` popover, rename, delete or merge. A tap on a row opens it; a tag chip in a row opens its tag page. Zero writes. *(L5p)* Test: `fr_tag_06_ac14_tag_page_on_the_phone`

### FR-EDT-10 The read view on the phone (adds to AC-1…AC-9)

- **AC-10** **A note is the read view (AP-2051, AP-2042).**
  - `note/<path>` on the phone has no element with `contenteditable` and no `.ProseMirror` element. A tap on the text never shows the keyboard (LA: `mInputShown=false`).
  - Bloky's body has the same text and block structure as the desktop's read view of Bloky (`__TEGG_TEST__.readView`, D-215), compared in the same test.
  - The app bar's `More actions` lists exactly `Properties` and `Show Markdown source`. The source view shows the file's bytes as FR-EDT-10 AC-1 says and offers `Show formatted note` to return.

  Zero writes. *(L5p; LA for the keyboard)* Test: `fr_edt_10_ac10_note_is_the_read_view_on_the_phone`
- **AC-11** **Links by tap (AP-2050).** In read-view's Odkazy:
  - a tap on the NFD-target `[[Cíl]]` opens Cíl; a heading link scrolls Cíl to the heading; a tag opens `tag/<key>`; a date link without a note opens the virtual `daily/<date>` (no write);
  - a tap on `[[Neexistuje]]` shows the notice `No note named “Neexistuje” in this vault yet.` (RA13) for 4 s, with no Create offer, no route change and no write.

  *(L5p)* Test: `fr_edt_10_ac11_links_by_tap`

### FR-EDT-02 Blocks on a narrow screen (adds to AC-1…AC-25)

- **AC-26** **Wide content scrolls in its own box.** At 360 × 800 in Široký obsah and read-view's Bloky:
  - each table and code block has `overflow-x: auto` and `scrollWidth > clientWidth`, while the page has none (FR-UX-04 AC-6);
  - the paragraph with the long word and the one with the 160-character URL have `scrollWidth ≤ clientWidth` (they wrap);
  - `široký.png` is drawn at the column's width (± 1 px) with its 5 : 1 ratio;
  - callouts and note embeds stay within the column, and the 300-character callout line wraps.

  *(L5p)* Test: `fr_edt_02_ac26_wide_blocks_on_the_phone`

### FR-EDT-07 Properties on the phone (adds to AC-1…AC-21)

- **AC-22** **The strip and the sheet (board N6, N15; AP-2049).**
  - Mapa bez severu (Book, `preview: [author, status]`) shows below its title a strip with the author chip `Eva Lindová` and the `Status` value, then the button `+<n> properties`. Here n is the number of the attribute panel's rows not in the strip, with plural forms (`+1 property`).
  - The button opens the sheet `Properties`: every row the desktop's attribute panel shows for that note, in the same order and with the same displayed values (compared with the desktop rendering in the same test), with `Created` and `Modified`. No input, `contenteditable` or option list is in the sheet.
  - A relation chip in the sheet opens its target and closes the sheet. Back, the scrim and `Close` close the sheet.
  - read-view's Vlastnosti (every universal attribute) is the second case.

  Zero writes. *(L5p)* Test: `fr_edt_07_ac22_properties_strip_and_sheet`

### FR-ATT-01 Media on the phone (adds to AC-1…AC-16)

- **AC-17** **Images show, files don't open elsewhere (AP-2056).**
  - In the trash-media page, `záhon.png`'s `img` has `naturalWidth > 0` on the device (the media protocol works in Android's WebView) and is drawn at most at the column's width.
  - A tap on the image opens `note/Images/Záhon.md` (R76), which shows the image and its attribute rows but no `Open in Preview` or `Reveal in Finder`.
  - A tap on the `Rozpočet.pdf` card opens its PDF object page, with no way to open the file in another app.
  - `![[missing.png]]` shows R77's broken-media placeholder.

  Zero writes. *(LA for the image load; L5p)* Test: `fr_att_01_ac17_media_on_the_phone`

### FR-NAV-08 No previews on the phone (adds to AC-1, AC-2)

- **AC-3** **A tap opens (plan §8).** With `preview.mode` set to `click`, `hover` and `off` in turn in the test's `ui-state.json`:
  - a tap on a link in Odkazy, a search result, a card and a pinned item opens its target at once, with no `dialog` `Preview: …`;
  - a long press of 800 ms shows no preview and no WebView context menu (LA: no floating toolbar or `ActionMode` window in `dumpsys window`).

  Settings on the phone has no `Previews` section. *(L5p; LA for the context menu)* Test: `fr_nav_08_ac3_no_previews_on_the_phone`

### FR-MMP-02 Mindmaps on the phone, read-only (adds to AC-1…AC-31)

- **AC-32** **Drawn as on the desktop, never edited (owner, 2026-11-22; T2).**
  - Mapa výletu shows `figure` `Mindmap: Výlet` with the `tree` of 7 `treeitem`s in mindmap AC-1's order.
  - `Pavouk` is drawn `spider` (`data-layout="spider"`), its boxes at scale 1 equal to R96's golden values (± 1 px).
  - The `Mindmap layout` radiogroup and `Edit node` are absent.
  - A tap on a node changes nothing: no route change, no List, no keyboard.
  - A tap on the chip `Mapa bez severu` opens it.
  - The `Pasy` checkbox is drawn checked and a tap never toggles it.

  Zero writes. *(L5p)* Test: `fr_mmp_02_ac32_mindmap_read_only_on_the_phone`
- **AC-33** **Zoom (AP-2055).** The header has `Zoom out`, `Zoom in` and `Fit to width`.
  - **Opening scale:** 1 when the layout fits the map area, else max(0.5, area width ÷ layout width). `Fit to width` returns to it.
  - **Buttons:** `Zoom in` multiplies the scale by 1.25 up to 2.5, `Zoom out` divides it by 1.25 down to 0.5, each `aria-disabled` at its limit.
  - **Pinch:** a two-finger pinch from 100 to 200 px apart doubles the scale (clamped), around its centre: the node under the pinch centre moves at most 8 px.
  - **Height:** the block's height is layout height × scale + 24 px.
  - **Not kept:** the scale is per block and per session (D-776), and is never written to the vault or `ui-state.json`.

  *(L1 for the scale rules; L5p; L5p Chromium for the pinch; LA once)* Test: `fr_mmp_02_ac33_mindmap_zoom_on_the_phone`
- **AC-34** **Pan, page scroll and full screen (AP-2055).**
  - In the note, on the runtime `Široká mapa`, a one-finger horizontal drag scrolls the map area (`scrollLeft` changes by the drag − 16 … + 4 px; the finger rests before lifting, D-2224), and a vertical drag scrolls the page, not the map.
  - `Open full screen` opens the `dialog` `Mindmap: <title>` covering the viewport within the safe areas, without the app bar and the bottom bar. There, one-finger drags pan in both directions and a pinch zooms.
  - `Close full screen` and system Back close it, back at the note's scroll position when it was opened (D-2232).

  *(L5p; LA for Back)* Test: `fr_mmp_02_ac34_mindmap_pan_and_full_screen`
- **AC-35** **Map and List (AP-2055).** The header has the group `Mindmap view` with `Map` and `List`. `List` shows the callout's list in the read view's list style, with the same items and nesting and disabled checkboxes, and no editor. The choice is session state as D-776 says. *(L5p)* Test: `fr_mmp_02_ac35_map_and_list_read_only`
- **AC-36** **Zoom and views write nothing (T1).** Ten zooms, five pans, full screen opened and closed, and `Map` / `List` switched ten times on Mapa výletu send zero writes and leave the vault untouched and `ui-state.json` unchanged. On the runtime `Velká mapa` (500 nodes), each zoom step is reported as the perf mark `mindmap-zoom` (report-only). *(L5p; LA in FR-SYN-06 AC-51's tour)* Test: `fr_mmp_02_ac36_mindmap_on_the_phone_writes_nothing`

### FR-SRC-03 Search on the phone (adds to AC-1…AC-21)

- **AC-22** **The Search page, without create buttons (AP-2048).** On `search/` + `search-page/`, `search` shows:
  - the `search` region with `Search query` across the viewport and `Clear search`, and no `⇧⌘F` hint;
  - the `Filters` group (`Type: all`, `Filter by tag`), the count line and the results.

  Then:
  - `rozpočet` shows `5 results`, with FR-SRC-03 AC-10's row content and no `Create “rozpočet”` or `as…`.
  - `borůvkový koláč` shows the title `No results for “borůvkový koláč”` and the body `Nothing matches “borůvkový koláč”.`, with no create question or button.
  - With the 60 runtime notes, `ostružiník` shows `Show next 10`.
  - A tap on a row's tag chip adds the tag filter (FR-SRC-02 AC-18).
  - A tap on a row opens it, and Back restores the page (FR-SRC-02 AC-17).

  Zero writes. *(L5p)* Test: `fr_src_03_ac22_search_page_on_the_phone`

### FR-NAV-01 Searching from the bottom bar (adds to AC-1…AC-23)

- **AC-24** **Search opens with the keyboard.** On the device, the bottom bar's `Search` opens `search` with the caret in `Search query` and the keyboard shown (`mInputShown=true`). The field has `enterkeyhint="search"`.
  - Typing `cteni` (CDP `Input.insertText`) and the keyboard's search key opens Čtení, as ⏎ does (FR-NAV-01 AC-21). With no results the key does nothing.
  - Czech typed as `čtení` in NFD gives the same first row.

  *(LA; L5p for `enterkeyhint` and the key)* Test: `fr_nav_01_ac24_search_from_the_bottom_bar`

### FR-SYN-04 Conflicts on the phone, read-only (adds to AC-1…AC-12)

- **AC-13** **Listed, not resolved (AP-2046; T2).** On `conflicts/`:
  - the drawer shows `Conflicts` with the count of FR-SYN-04 AC-5's list, and `conflicts` lists the same pairs with the same texts;
  - opening a pair shows both versions one above the other, read-only, with the differing lines marked, and no resolve action (RA11).

  An external removal of `Pages/Plán (conflicted copy 2026-10-07).md` removes its pair within 2 s, and the drawer entry disappears with the last pair. Zero writes. *(L5p)* Test: `fr_syn_04_ac13_conflicts_read_only_on_the_phone`

### FR-SET-01 Settings on the phone (adds to AC-1…AC-13)

- **AC-14** **The phone's Settings (AP-2047).** Drawer `Settings` opens `settings`: the rows `Appearance`, `Date & time`, `Vault`, `Storage access`, and the footer `Tegg dev · Android`.
  - **Vault:** the vault's name and path (user content), the default type as text (no control), and `Switch vault…` (→ the menu of FR-VLT-01 AC-29).
  - **Storage access:** `On` and `Open settings`, which calls `storage_access_settings` (LA: the foreground package becomes `com.android.settings`).
  - **Date & time:** changing `Date format` to `Long` changes the Inbox's dates within 1 s, stored per machine (D-566).
  - **Not listed:** `Shortcuts`, `Menu bar and startup`, `Trash and history`, `Previews`, `Backups`, `Page width`, outline, Sync.

  `.tegg/vault.yml` and every other vault file stay untouched. *(L5p; LA for `Open settings`)* Test: `fr_set_01_ac14_settings_on_the_phone`

### FR-SET-02 The theme on the phone (adds to AC-1…AC-10)

- **AC-11** **Follows the system by default (plan §3.5).**
  - Settings › Appearance has `Theme` with System, Light and Dark; System is selected on a fresh install.
  - On the device, `cmd uimode night yes` turns the page dark within 1 s: the computed `--bg` equals the dark token's value. `night no` turns it light.
  - With Light chosen, `night yes` leaves it light, and the choice survives a cold start (stored in private storage).

  *(LA; L5p for the control)* Test: `fr_set_02_ac11_theme_follows_android`
- **AC-12** **System bars match, no forced darkening.**
  - In the light theme the status and navigation bars use dark icons (`APPEARANCE_LIGHT_STATUS_BARS` and `APPEARANCE_LIGHT_NAVIGATION_BARS` set, `dumpsys window`); in the dark theme they are not set. A theme change updates them within 1 s.
  - With Light chosen and the system in night mode, every computed `color` and `background-color` equals a light token (no algorithmic darkening by the WebView).

  *(LA)* Test: `fr_set_02_ac12_system_bars_follow_the_theme`

### FR-UX-05 Themes on the phone (adds to AC-1…AC-25)

- **AC-26** **Contrast on every phone surface.** The axe-core `color-contrast` rule reports zero violations, and FR-UX-05 AC-5 (no light colour in dark) holds, on every route of RA9, with the drawer open, the properties sheet open and a full-screen map, in light and dark, at 412 × 915. *(L5p)* Test: `fr_ux_05_ac26_contrast_on_phone_surfaces`

### FR-UX-08 Accessibility on the phone (adds to AC-1…AC-25)

- **AC-26** **TalkBack reads the frame.**
  - On the device, `uiautomator dump` on `inbox` lists the nodes `Menu`, `Search`, `New` (not enabled) and `Today` in the bottom bar, and `Back` in the app bar after one navigation.
  - With the drawer open, the elements behind it are not in the dump.
  - At L5p the drawer and the sheet are `aria-modal`, the page behind them is `inert`, and their names are RA13's.

  *(LA; L5p)* Test: `fr_ux_08_ac26_talkback_reads_the_frame`
- **AC-27** **The system font size (AP-2054).** On the device with `settings put system font_scale 1.3` and then `2.0`:
  - the computed body font size grows by that factor (± 0.5 px, the WebView's text zoom);
  - `inbox`, a note, and `type/book`'s `All Books` have no sideways page scroll (the table scrolls in its container);
  - each bottom-bar label is shown whole: `scrollWidth ≤ clientWidth`, in at most two lines.

  The page itself can't be pinch-zoomed (`user-scalable=no`); only the map and nothing else zooms. *(LA)* Test: `fr_ux_08_ac27_system_font_size`

### NFR-OTH-02 Strings on the phone (adds to AC-1…AC-23)

- **AC-24** **Catalog and pseudo-locale.**
  - Every string of RA13 is a catalog key, with no literal in the phone components (AC-1's L0 rule covers them).
  - With the pseudo-locale, every route of RA9, the drawer, the sheet, the map controls and the bottom bar show every visible text inside `⟦ ⟧`, except user content.
  - With the Czech test catalog, `+{count} properties` picks three forms for 1, 3 and 5.

  *(L0; L1; L5p)* Test: `nfr_oth_02_ac24_phone_strings`

### FR-UX-06 Empty states on the phone

- **AC-1** **Guiding, without actions the phone doesn't have.**
  - `type/cesta` (shell fixture) shows the desktop's empty-type message without `New Cesta`.
  - `search` with nothing typed shows FR-SRC-03 AC-14's empty state.
  - A tag page whose objects were removed from outside shows the desktop's empty text.
  - Inbox zero is FR-INB-01 AC-16.

  No empty state has a button that creates or writes. *(L5p)* Test: `fr_ux_06_ac1_empty_states_on_the_phone`

### FR-UX-07 Indexing progress on the phone (adds to AC-1…AC-17)

- **AC-18** **A status line under the app bar (AP-2058).**
  - While the fake core emits `index:progress` `running`, the `status` `Indexing progress` with `Indexing <done> of <total>` sits directly below the app bar. It is not modal, and the drawer, the bottom bar and rows work. It disappears within 1 s of `done`.
  - **LA (nightly):** the generated vault's first open shows the line until `index-idle`.

  *(L5p; LA nightly)* Test: `fr_ux_07_ac18_indexing_status_on_the_phone`

### FR-SYN-06 Reading on the phone writes nothing (adds to AC-50)

- **AC-51** **A reading tour leaves the vault untouched (AP-2050; T1).** On `views/` + `phone/` the tour does:
  - every route of RA9 through the drawer and the bottom bar, every view tab, the `Rozečtené` lanes scrolled to their end, `Podle žánru` folded and unfolded;
  - five notes opened, their properties sheets and source views;
  - Mapa výletu zoomed, panned, full screen and List;
  - three searches with a type and a tag filter;
  - `Today`, previous and next day, the calendar;
  - in Settings the theme and the date format changed;
  - taps on every disabled task checkbox, on `New`, on `[[Neexistuje]]`, and the gestures of FR-NAV-03 AC-18;
  - (LA) the app sent to the background and back, and a cold start.

  Throughout, the vault is untouched and there are zero writes. Only the private files dir changes. *(L5p; LA)* Test: `fr_syn_06_ac51_reading_on_the_phone_writes_nothing`
- **AC-52** **No task-views migration on Android (AP-2044; T1).** The `views-tasks` base fixture has a `task.yml` without `views` (the migration's input, R202).
  - Opened on the device, and with the desktop's migration hook `TEGG_TEST_TASK_VIEWS=1` in `test-env.json`, nothing is written: no `Schedule.yml` or `Kanban.yml`, and `task.yml` untouched. `type/task` shows only `All Tasks`.
  - When the test then pushes the Mac's result (the two query files, then `task.yml` with `views: [Schedule, Kanban]`, each by temporary file and `mv`), the chips `Schedule` and `Kanban` appear within 2 s.
  - The same vault opened with the desktop's options does migrate (positive control, R202).

  *(L4 or L5p, wherever the contract puts the migration; LA)* Test: `fr_syn_06_ac52_no_task_views_migration_on_android`

### FR-SYN-03 / NFR-REL-02 External changes on the phone (adds to AC-32…AC-34)

- **AC-35** **The sync app's changes reach every page (T2).** On the device with `views/` + `phone/`, each change is made with `adb shell` (a temporary file, then `mv`):
  - a paragraph appended to the open Dlouhá poznámka shows in the read view within 2 s, with the first visible block unchanged (± one line);
  - a new unreviewed Quick Note adds its Inbox row and raises the drawer count within 2 s;
  - the open note deleted shows `This note was moved or deleted` (read-view FR-SYN-03 AC-11).

  Tegg writes nothing. These bound a defect; they are not phone targets (D-2010). *(LA)* Test: `fr_syn_03_ac35_external_changes_on_the_phone`
- **AC-36** **A partly synced vault (plan §7; T2).**
  - `[[Později]]` in Odkazy ven shows the broken-link style, and a tap shows AC-11's notice. When the test pushes `Pages/Později.md`, the link resolves within 2 s and opens it.
  - A view whose query file isn't there yet (a runtime `views:` entry `Chybí` in `book.yml`) shows the not-found state without `Remove from Books page`, and shows its results within 2 s of the file's arrival.
  - A pin whose target hasn't arrived shows the missing state and resolves when it arrives.

  No file is created or rewritten to "fix" anything. *(LA; L5p)* Test: `fr_syn_03_ac36_partly_synced_vault_on_the_phone`

### NFR-SEC-01 External links on the phone (adds to AC-1…AC-3)

- **AC-4** **The system opens web links; Tegg makes no connection (AP-2056).** In Odkazy ven on the device:
  - a tap on `web` starts an `android.intent.action.VIEW` for `https://example.org/%C4%8De%C5%A1tina` (logcat `ActivityTaskManager: START u0 {act=android.intent.action.VIEW dat=https://example.org/…}`), through the proposed Android-only command `android_open_url`;
  - the WebView's `location.href` and the route are unchanged;
  - `mailto:eva@example.org` starts a `VIEW` intent for it;
  - `javascript:` and `file:` links start no intent, navigate nothing and run nothing.

  NFR-SEC-01 AC-3's monitor sees no socket of Tegg's uid, and AC-1 still holds (no `INTERNET`). `android_open_url`'s scheme check accepts exactly `http`, `https`, `mailto` and `tel` (L1). RA2 gains the command, so AR-03 AC-9's test changes (`AC-Test-Change`). *(LA; L1)* Test: `nfr_sec_01_ac4_external_links_leave_through_the_system`

### NFR-PERF-05 Reading speed on the emulator, report-only (adds to AC-1…AC-5)

- **AC-6** **Bounds a defect, not a target (D-2010; AP-2062).** On the emulator with `tools/gen-vault --seed 1 --small-images` in shared storage, after `index-idle`, the perf log reports:
  - `note-ready` for 20 opens of notes under 5,000 words, p95 ≤ 1,000 ms;
  - `route-ready:search` for the first page of 10 queries, p95 ≤ 1,000 ms;
  - `route-ready:type/page` for `type/page`, ≤ 1,500 ms (the mark's real name; D-2212).

  The run fails only above these bounds. The numbers go to D-2010's targets with the owner's OC-1. *(LA nightly)* Test: `nightly_nfr_perf_05_ac6_reading_speed_on_the_emulator`

---

## Owner checks (manual)

These need the owner's phone. They are recorded in `qa/manual/and-2.md` and are not criteria (except FR-UX-01 AC-9). Each runs on an AND-2 test build (D-2042: unversioned, `dev`).
- **OC-5** [manual] **Gestures on a real phone:** the back gesture from both edges, three-button navigation, the drawer, sideways scrolling of a table, lanes and a map, and pinch on a map (FR-NAV-03 AC-17, AC-18, FR-MMP-02 AC-33, AC-34).
- **OC-6** [manual] **Gboard in Search:** Czech diacritics, suggestions, the search key (FR-NAV-01 AC-24), and the field never hidden by the keyboard (FR-UX-04 AC-4).
- **OC-7** [manual] **The owner's synced copy:** with the sync app on a copy of a generated vault (never the real vault, D-62), the owner edits a note on the Mac and records how long the phone takes to show it (input for FR-SYN-03 AC-35 and D-2010).

---

## Real-app tests (D-382)

`app/e2e-android/` (test APK on the emulator, a fresh vault copy in shared storage per test):
- `android_phone.ac.test.ts`: FR-UX-04 AC-3, AC-4, AC-7; FR-NAV-04 AC-14, AC-15; FR-NAV-03 AC-17, AC-18; FR-HOM-04 AC-1; FR-INB-01 AC-15; FR-DLY-01 AC-13; FR-QRY-05 AC-32; FR-QRY-09 AC-9; FR-EDT-10 AC-10; FR-ATT-01 AC-17; FR-NAV-08 AC-3; FR-MMP-02 AC-33, AC-34; FR-NAV-01 AC-24; FR-SET-01 AC-14; FR-SET-02 AC-11, AC-12; FR-UX-08 AC-26, AC-27; NFR-SEC-01 AC-4.
- `android_phone_sync.ac.test.ts`: FR-SYN-06 AC-51, AC-52; FR-SYN-03 AC-35, AC-36.
- `nightly_android_phone.ac.test.ts`: NFR-PERF-05 AC-6; FR-UX-07 AC-18 (LA part).

The L5p tests are `app/webkit/phone_*.ac.test.ts`, run on WebKit and on Chromium (D-2009).

---

## Trace: requirement → criteria

| Requirement / rule | Criteria | Decisions and points |
| --- | --- | --- |
| FR-UX-04 | AC-1…AC-7 (7) | D-2000, plan §3.5; F8; AP-2037, AP-2038, AP-2052…AP-2054 |
| FR-NAV-04 | AC-13…AC-15 (3) | D-219, D-1429, D-1430; AP-2045, AP-2046 |
| FR-NAV-03 | AC-17…AC-19 (3) | D-165, D-1168, D-1511, D-2027; AP-2036, AP-2040 |
| FR-UX-03 | AC-54 (1) | AP-2041 |
| AR-03 | AC-13, AC-14 (2) | D-2026; AP-2050 |
| FR-UX-01 | AC-8, AC-9 [manual] (2) | D-1512 |
| FR-VLT-01 | AC-29 (1) | D-219 |
| FR-HOM-04 | AC-1 (1) | D-132, D-614; AP-2057 |
| FR-HOM-02 | AC-32 (1) | D-2006; AP-2050 |
| FR-INB-01 | AC-14…AC-16 (3) | D-781, D-834, D-2007; AP-2039 |
| FR-DLY-01, FR-DLY-03 | AC-13; AC-8 (2) | D-763 |
| FR-TYP-09 | AC-37 (1) | D-2006; AP-2060 |
| FR-QRY-07 | AC-32 (1) | D-1765, D-2006 |
| FR-QRY-05 | AC-30…AC-33 (4) | D-2006; AP-2060, AP-2061 |
| FR-QRY-06 | AC-26…AC-28 (3) | D-2006, plan §8 |
| FR-QRY-09 | AC-9 (1) | — |
| FR-TSK-04 | AC-30 (1) | D-1790; AP-2043 |
| FR-TAG-07, FR-TAG-06 | AC-7; AC-14 (2) | D-2007; AP-2059 |
| FR-EDT-10 | AC-10, AC-11 (2) | D-117, D-215; AP-2042, AP-2051 |
| FR-EDT-02 | AC-26 (1) | — |
| FR-EDT-07 | AC-22 (1) | AP-2049 |
| FR-ATT-01 | AC-17 (1) | AP-2056 |
| FR-NAV-08 | AC-3 (1) | plan §8 |
| FR-MMP-02 | AC-32…AC-36 (5) | owner 2026-11-22, D-776; AP-2055 |
| FR-SRC-03, FR-NAV-01 | AC-22; AC-24 (2) | D-1343; AP-2048 |
| FR-SYN-04 | AC-13 (1) | AP-2046 |
| FR-SET-01, FR-SET-02 | AC-14; AC-11, AC-12 (3) | D-128, D-566; AP-2047 |
| FR-UX-05, FR-UX-08 | AC-26; AC-26, AC-27 (3) | D-129; AP-2054 |
| NFR-OTH-02 | AC-24 (1) | D-133 |
| FR-UX-06, FR-UX-07 | AC-1; AC-18 (2) | AP-2058 |
| FR-SYN-06 | AC-51, AC-52 (2) | D-2007, D-2025, D-1777; AP-2044, AP-2050 |
| FR-SYN-03 / NFR-REL-02 | AC-35, AC-36 (2) | plan §7 |
| NFR-SEC-01 | AC-4 (1) | D-2002; AP-2056 |
| NFR-PERF-05 | AC-6 (1) | D-2010; AP-2062 |

**68 new criteria, 67 automated, 1 [manual].** Three owner checks (manual) are not criteria.

**Changes when these criteria are approved** (not made by this draft):
- **README:** the row for this file in `docs/acceptance/README.md` gets the approval and the decisions.
- **BRD:** the decisions of AP-2036…AP-2064, from D-2172. FR-UX-03 and FR-NAV-02 gain the phone exception if AP-2041 is accepted. FR-NAV-06 notes no tabs on the phone (AP-2036).
- **Earlier criteria:** AR-03 AC-9 and RA2 gain `android_open_url` (AP-2056, `AC-Test-Change`). FR-MMP-02 AC-1's "no `Zoom in` … `Open full screen`" holds for `macos` only. FR-MMP-02 AC-8's "read view: no `Mindmap view` group" holds for `macos` only (AP-2055). Mark FR-NAV-04 AC-1's and FR-INB-01 AC-7's `Quick Capture` as desktop-only.
- **test-strategy:** the L5p layer (WebKit and Chromium at phone viewports, D-2009) and the AVD's device profile (AP-2064).
- **Contract:** `docs/contracts/android-phone.md`: `layoutFor`, `data-layout`, the inset and keyboard handling (native padding or CSS variables), the system back hook, `android_open_url`, the routes `settings` and `settings/storage`, the write-command list for "zero writes", the test hooks `__TEGG_TEST__.insets`, `.keyboard`, `.systemBack`, and where the task-views migration runs (AP-2044).

---

## Points for the owner (AP-2036…AP-2064 → D-2172…D-2200, accepted as proposed)

Raised while writing these criteria from the boards' "to decide" lists and from gaps. Each criterion that depends on one names it and follows its **proposal**. AP-2036…AP-2049 answer the boards' lists; the rest are gaps found while writing.

| AP | Point | Proposal | Alternative | Affects |
| --- | --- | --- | --- | --- |
| AP-2036 | **Open notes as tabs, or Back through pages?** Plan §3.5 leaves it to the boards. FR-NAV-06 has tabs on the desktop (v1.0); Android apps use Back. Also open: what Back does at the first page. | No tabs on the phone. System Back and the app bar's `Back` go back through Tegg's history (FR-NAV-03, in memory). At the first entry, Back moves the app to the background, as Android apps do (the process stays and nothing is written). FR-NAV-06 is noted as desktop-only. | A `Recent` row in the drawer listing the last 10 opened notes; or tabs in a switcher sheet | FR-NAV-03 AC-17, AC-19, FR-UX-04 AC-1, FR-NAV-06 |
| AP-2037 | **The bottom bar: items, and on which pages.** Board N1 says it stays on top-level pages, but N6 and N9 draw it on notes. Creating is AND-3, so `New` has nothing to do in AND-2. The bar also takes room above the keyboard. | `Menu`, `Search`, `New`, `Today`, as the plan says, on every page, notes included. Hidden while the keyboard is shown and while a full-screen map is open. In AND-2, `New` is drawn `aria-disabled` with `Creating objects comes with editing on the phone.` (D-116's "coming" pattern). The Inbox stays the drawer's first entry and the landing (AP-2057). | Only on top-level pages; or `New` hidden until AND-3 | RA8, FR-UX-04 AC-2, AC-4 |
| AP-2038 | **The app bar's left button.** Board N12 says a top-level page shows the sidebar button and not Back, but "top-level" is undefined: a daily route is the same route however it is reached. A left-edge drawer button also sits where the back gesture starts. | The app bar shows `Back` whenever the history has an earlier entry, else nothing. The drawer opens only from the bottom bar's `Menu`. No page needs to be classified as top-level. | The board's split: a list of top-level routes that show a drawer button, other routes show Back | RA8, FR-UX-04 AC-2, FR-NAV-03 AC-17 |
| AP-2039 | **Inbox swipes, converting, and dates.** Board N1 swipes right to mark reviewed and left to move to a type. Moving to a type is a type move that moves the file (D-834, FR-INB-02 AC-5), which D-2007 turns off on the phone. Swipes need a tap alternative and clash with sideways scrolling (AP-2040). N1 also shows relative times (`2 h`, `Mon`), which D-781 rules out. | AND-2's Inbox is a read-only list: R61's groups and order, rows with the type icon, the title and the date in the Date & time setting, no type filter and no actions. No swipes in any slice. AND-3 adds `Reviewed` as a tap on a checkbox in the row. `Convert to` is not offered on the phone, including for one note, because it is a type move. | Swipes with a tap alternative in AND-3; or a single-note `Convert to` allowed on the phone (no backup is made for one note today, FR-INB-02 AC-14) | FR-INB-01 AC-14…AC-16, RA11 |
| AP-2040 | **Sideways swipes.** Row swipes (N1), sideways scrolling of tables, lanes and maps (N4, N5, N9), a drawer swipe (N2) and Android's back gesture all use the same direction. FR-NAV-03 AC-8 says a horizontal scroll never navigates. | Inside the WebView no horizontal touch gesture navigates, opens the drawer or acts on a row; it only scrolls what is under it. Only the system back gesture or key goes back. `nav_swipe_scroll` stays `false` on Android, so D-1511's swipe never runs. | A drawer swipe from the left edge, with an exclusion zone against the back gesture | RA12, FR-NAV-03 AC-18, FR-INB-01 AC-15, FR-NAV-04 AC-14 |
| AP-2041 | **FR-UX-03 (every action in the palette) on a phone without a palette.** FR-NAV-02 and FR-UX-03 assume a keyboard. | An exception for the phone layout: no palette UI. Every action is reachable by touch and TalkBack (FR-UX-08), and every control still carries a registered `data-command` (FR-UX-03 AC-8 holds), so the registry stays the one list. A hardware keyboard gets nothing extra in AND-2. | A `Commands` row in the drawer that opens the palette; or Ctrl+K with a hardware keyboard | FR-UX-03 AC-54, FR-NAV-02, RA8 |
| AP-2042 | **What the ⋯ menus hold (N3, N6).** D-2007 removes rename, type settings and moves; AND-2 writes nothing (AP-2050). | The note's ⋯ holds `Properties` and `Show Markdown source` / `Show formatted note` (FR-EDT-10). Type, query and tag pages have no ⋯ in AND-2. `Pin` and `Move to trash` (one file each, no bulk) are decided with AND-3. | `Pin` / `Unpin` in AND-2 (one write to `.tegg/pinned.yml`); or `Move to trash` in AND-2 | RA8, RA11, FR-EDT-10 AC-10 |
| AP-2043 | **Tasks: Schedule and Kanban beyond the plan's "All tasks".** Plan §4 lists All tasks (read) only, while the board draws Kanban and Schedule (N5, N8). Since slice Q2-T, Schedule and Kanban are saved views of `type/task` (D-1776, D-1777, D-1790). | `type/task` on the phone is a type page like any other: `All Tasks` plus every tab of `task.yml`'s `views:`, read-only (D-2006). Task checkboxes are drawn `aria-disabled` until AND-3. Q2-T is on main (PR #150), so this holds from the start of AND-2. | `All Tasks` only, as the plan lists | FR-TSK-04 AC-30, RA9, RA11 |
| AP-2044 | **The task-views migration on Android (gap).** Opening a vault whose `task.yml` has no `views` key creates `Schedule.yml` and `Kanban.yml` and writes `task.yml` (R202, D-1936). On the phone that is a write on open, against FR-SYN-06 AC-53 (AND-1; was AC-50) and D-2007. On a partly synced vault the phone could create the files before the Mac's arrive; the bytes are identical (D-1936), but the sync app may still make conflict copies. | The migration never runs on Android. `type/task` shows the tabs that `views:` lists, so only `All Tasks` until the Mac's migration syncs. In the core it is gated by the same `bulk_jobs: false` the Android shell passes, or by a new flag; the contract decides. | Run it on the phone too, relying on identical bytes | FR-SYN-06 AC-52, FR-TSK-04 AC-30 |
| AP-2045 | **Drawer rows: Queries, Conflicts, Settings, Trash.** The owner's N2 has no Queries row and a Settings row; Mobile2 adds Queries always and Conflicts while there are some. The desktop sidebar has Queries, Conflicts (while shown) and Trash (FR-NAV-04 AC-12). | RA10: the desktop's entries in the desktop's order, minus `New object` and `Search` (in the bottom bar) and `Trash` (trash management is out, plan §8). `Queries` is always shown with its count, `Conflicts` only while conflicts exist, and `Settings` is the last entry before the version button. | No Queries row (as N2), with queries reached only through pins; or `Trash` as a read-only list | RA10, FR-NAV-04 AC-13 |
| AP-2046 | **Conflicts before AND-4.** The sync app makes conflict copies from the first APK (Mobile2 E10). Resolving writes, and AND-2 writes nothing. | AND-2 shows the `Conflicts` entry while conflicts exist and lists them read-only: both versions one above the other with the differing lines marked, and no resolve action. AND-3 adds resolving (keep one, merge) under FR-SYN-04's rules. | Hide Conflicts until AND-3; or resolve on the phone already in AND-2 | FR-SYN-04 AC-13, RA10, RA11 |
| AP-2047 | **The Settings list on the phone (N20).** The desktop has Appearance, Date & time, Vault, Shortcuts, Menu bar, Trash and history, Previews and Backups. Vault settings write `vault.yml`. | `settings`, a new Android-only list: `Appearance` (Theme only), `Date & time` (per machine, D-566), `Vault` (name, path, default type as text, `Switch vault…`), `Storage access` (state and `Open settings`, a new route `settings/storage`), and the footer `Tegg <version> · Android`. Nothing in it writes the vault. Sync is added with AND-4; Conflicts stays in the drawer. | N20 as drawn, with `Sync: from AND-4, Off` and `Conflicts` rows; or the default type editable on the phone (one write to `vault.yml`) | FR-SET-01 AC-14, RA9 |
| AP-2048 | **Search create buttons on the phone (N19, D-1343).** N19 draws `Create Page` and `Create Quick Note`. D-1343 has `Create “<q>”` with the default type and `as…`. Creating is AND-3. | None in AND-2: the no-match state says `Nothing matches “<q>”.`. In AND-3, D-1343's two buttons unchanged (default type and `as…`), so the phone and the Mac create the same way. | N19's two fixed buttons (Page and Quick Note) on the phone | FR-SRC-03 AC-22, RA11 |
| AP-2049 | **The properties strip and sheet (N6, N15).** The desktop shows the attribute panel at the top of the note (FR-EDT-07). N6 shows three properties inline and `+3 properties`; N15 shows a sheet. Which three, and editable or not? | The strip shows the type's `preview` keys (D-1240, at most 3), else the first three non-empty rows of the attribute panel, then `+<n> properties` (plural forms). The sheet lists every row of the attribute panel in its order, including Created and Modified, read-only in AND-2. AND-3 makes values editable there (N15, E9). | The desktop's collapsible attribute panel at the top of the note | FR-EDT-07 AC-22 |
| AP-2050 | **What AND-2 writes (gap).** AND-1's build shows the desktop editor, so it can write. AND-2 is "reading" (plan §6), but the plan doesn't say whether the phone layout keeps any write. | AND-2's phone layout writes nothing to the vault. Every write control is hidden, or drawn `aria-disabled` where RA11 says (task checkboxes, `New`): editing, review toggles, checklist and task toggles, the Create offer, pinning, tag colour, view and type changes. Machine-local writes stay: theme, date format, last tab, folds, recent vaults, `nav_opened`. AND-3 brings the writes back one by one under its own criteria. | Keep AND-1's single-note writes (the desktop editor in the phone frame) until AND-3 | FR-SYN-06 AC-51, RA11, every "zero writes" |
| AP-2051 | **The note in AND-2: the read view or the editor (gap).** The read view (3B, D-117) is the editor's fallback and writes nothing. The editor brings ProseMirror and Gboard issues that are AND-3's work (plan §3.7). | AND-2 shows notes in the read view, with no editor loaded. AND-3 switches the note to the editor. | The editor with `editable: false` from AND-2 on, so that AND-3 only turns editing on | FR-EDT-10 AC-10, RA11 |
| AP-2052 | **How the layout is chosen (gap).** Plan §3.5 says "chosen by window width so the same build also serves a narrow desktop window later". The Mac's minimum window is 800 × 500 pt (D-136), so a width rule never triggers there, and a phone in landscape (915 px) would get the desktop layout. The tablet layout is out (plan §8). | By platform: `android` always gets the phone layout, at every width and orientation; `macos` always gets the desktop layout. `layoutFor(platform, width)` keeps the width parameter for the later narrow-window case, and a test hook forces either layout. | By width (< 600 CSS px) on both platforms, as the plan words it | RA8, FR-UX-04 AC-1 |
| AP-2053 | **Orientation (gap).** | Both orientations, with the phone layout in both. Rotation keeps the route and the reading position, and the activity is not recreated. | Portrait only | FR-UX-04 AC-7 |
| AP-2054 | **Touch targets, page zoom, font size (gap).** FR-UX-04 says ≥ 44 pt; the owner's board says 48 dp. Pinch-zooming the page would fight the map's pinch, and the system font size isn't mentioned anywhere. | 48 × 48 CSS px (CSS px are dp in the WebView), with inline text links, chips and map nodes exempt but spaced (WCAG 2.5.8); list rows ≥ 56 px (N1). The page can't be pinch-zoomed; the map has its own zoom. The system font size is followed (the WebView's text zoom) up to 200 % without sideways page scroll. | 44 px, FR-UX-04's minimum; or page zoom allowed | FR-UX-04 AC-5, FR-UX-08 AC-27 |
| AP-2055 | **Mindmap zoom and pan details, Map / List, full screen, collapse (N9).** The owner decided "drawn, zoom and pan, no node editing" on 2026-11-22. Open: the numbers; how one-finger drags share the page's vertical scroll; N9's `Map \| List` (the desktop read view shows Map only, FR-MMP-02 AC-8); N9's `⤢` full screen; and N9's `+3` collapsed branch, which the desktop doesn't have (D-785). | (1) The opening scale fits the width, 0.5 at least; zoom range 0.5…2.5 in steps of 1.25; pinch around its centre; `Fit to width` resets. (2) In the note, the block grows with the scale, a horizontal drag scrolls the map and a vertical drag scrolls the page. (3) `Open full screen` shows the map alone, where a drag pans both ways; Back closes it. (4) `Map \| List` is kept; List is the read-only list. (5) No collapse: the drawing is the desktop's. The scale and the view are session state (D-776). | Fit to width only, with no zoom buttons; no List on the phone (as the desktop read view); no full screen | FR-MMP-02 AC-33…AC-35 |
| AP-2056 | **External links and media actions (gap).** On the desktop `open_external` and `media_open` open the browser or the default app; RA2 removes both on Android. A tapped `https` link in the WebView could otherwise navigate the WebView itself. | A new Android-only command `android_open_url` sends `http`, `https`, `mailto` and `tel` links to Android (`ACTION_VIEW`), so Tegg opens no connection itself (NFR-SEC-01). `javascript:`, `file:` and `data:` never open, as on the desktop. The WebView never navigates away. A tap on an image opens its Image object page. PDFs show their card and object page, with no open-in-another-app in AND-2. No WebView context menu on long press. | External links not opened at all in AND-2 (the URL shown with `Copy`); or PDFs opened through a `FileProvider` intent | NFR-SEC-01 AC-4, FR-ATT-01 AC-17, FR-NAV-08 AC-3, RA2 |
| AP-2057 | **The landing on the phone (gap).** Board N1 calls the Inbox the "start page"; the desktop opens the last note, else the Inbox (D-132, D-614), and FR-HOM-04 asks for the last state. | As the desktop: the last opened note, else `inbox`, never writing. | Always `inbox` on the phone; or always today's daily note | FR-HOM-04 AC-1 |
| AP-2058 | **The other Mobile2 screens (proposal board).** S5 (a first-indexing count screen), N12 (today's daily note), N13 and N14 (tags), N17 (Find in note), N18 (empty Inbox) and N20 (Settings) are not owner-approved. | S5: no separate screen; the indexing status line under the app bar (FR-UX-07 AC-7's message). N12, N13, N14: the desktop pages read-only (FR-DLY-01 AC-13, FR-TAG-06 AC-14, FR-TAG-07 AC-7). N17 Find in note: not in AND-2 (not in plan §4). N18: the desktop's `Inbox zero` copy, without `Quick Capture`. N20: AP-2047. | S5 as drawn; Find in note in AND-2 | FR-UX-07 AC-18, FR-INB-01 AC-16, FR-UX-06 AC-1 |
| AP-2059 | **Tag pages on the phone (gap).** The tag page has a Type filter remembered per machine (D-703), and the tag colour popover writes a Tag file. | All tags and the tag page read-only: no `New tag`, colour change, rename, delete or merge (D-2007 for rename), and no Type filter. | Keep the tag page's Type filter (machine-local, writes nothing to the vault) | FR-TAG-06 AC-14, FR-TAG-07 AC-7 |
| AP-2060 | **Page-level filters, folds and the "view only" line (gap).** D-2006 says sort, columns, grouping and filters can't be changed. The type page's `Filter <plural>…` and `Filter by tag` narrow the shown results without saving them (D-1796, D-1893). Folding a row is machine-local (R190, R206). The board shows a line describing the sort (`Author A→Z · view only on the phone`). | Hide the page's text and tag filters on the phone, and the Queries page's find field and sort. Folds work and are kept per phone. The line is `<column>: <order>` of the first sort level, `+<n>` for more levels, then `· View only on the phone`; `All <plural>` uses its machine-local sort. | Keep the text and tag filters (they change no saved view) | FR-TYP-09 AC-37, FR-QRY-05 AC-30, AC-33, FR-QRY-06 AC-26, RA11, RA13 |
| AP-2061 | **Board lanes on the phone (gap).** The desktop's vertical lanes are 236 px; the owner's board N5 says 300 dp and "swipe sideways for more lanes". | 300 px lanes, so the next lane shows at 412 px, scroll-snapping to lane starts. Card drags are off (D-2006). | The desktop's 236 px; or one lane per screen width | FR-QRY-05 AC-32 |
| AP-2062 | **Phone performance in AND-2 (gap).** D-2010 sets phone targets from AND-0 and the owner's OC-1. AND-2 adds the first reading pages, but no target exists yet. | Report-only marks on the emulator with defect bounds: `note-ready` p95 ≤ 1,000 ms, the first search page ≤ 1,000 ms, `type/page` ≤ 1,500 ms on the generated vault (nightly). Targets follow D-2010. | No bounds until D-2010's targets | NFR-PERF-05 AC-6 |
| AP-2063 | **Duplicate AC numbers (housekeeping found while numbering).** views.md part three (Q2-T) and android-shell.md (AND-1) both have FR-SYN-06 AC-50, FR-SYN-03 AC-32 and FR-STO-07 AC-12, with different tests (`fr_syn_06_ac50_tasks_views_write_only_what_the_user_changes` and `fr_syn_06_ac50_no_writes_and_no_jobs_on_android`, and so on). This file starts after the highest number of either. Another session (Q2-T) may still add numbers while this file is reviewed. | Renumber AND-1's three to the next free numbers when this file is approved (its tests are in Android-only files), under one `AC-Test-Change`. Add a `tools/qa` check that fails on a criterion ID defined twice. Recheck this file's numbers at approval. | Renumber Q2-T's three instead | android-shell.md, views.md, `tools/qa` coverage |
| AP-2064 | **The phone test layer and the emulator (gap).** D-2009 adds a Chromium run of the phone-layout tests, but nothing fixes their viewports or the emulator's screen. The AVD `tegg-and-35` has no device profile, so LA pixel checks could change with the SDK. | L5p: 412 × 915 (the boards' frame) and 360 × 800, device scale factor 2.625, touch on, WebKit and Chromium in the push gate. The AVD uses the `pixel_7` profile (1080 × 2400, 420 dpi, gesture navigation), fixed in `tools/android/avd.sh`. | One viewport (412 × 915); the AVD left at its default | test-strategy, every L5p and LA criterion |
