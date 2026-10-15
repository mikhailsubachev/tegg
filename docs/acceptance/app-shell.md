# Acceptance Criteria: App frame and page flow (MS3 slice 3A)

See [README](README.md) for conventions. Milestone MS3 (BRD §11.2), slice **3A "Frame and page flow"** (D-115, D-116, D-120; plan `docs/plans/ms3-implementation-plan.md` §3, §4). Later slices (3B…3E) add their own criteria to the same requirements; FR-NAV-02, -04 and -05 stay MS5 and get no criteria here (D-120).

**Decided points.** Writing these criteria raised AP-65…AP-82 ([README](README.md#points-from-writing-the-ms3-slice-3a-acs-accepted-2026-10-12-ap-65ap-82--d-121d-138)), all accepted as D-121…D-138 (BRD v1.26). A criterion that cites an AP follows its decision.

**Test layers** (test-strategy §4), named at the end of each criterion:

| Tag | Layer |
| --- | --- |
| L0 | Static rule (lint or custom check over the source tree), every commit |
| L1 | Vitest unit or component test (registry, catalog, theme tokens, React components in a DOM environment) |
| L4 | Rust integration test of the core on a temporary copy of the fixture (`tests/ac_*.rs`) |
| L5 | Playwright on **WebKit** with the fake core over mocked IPC (`@tauri-apps/api/mocks`, as in `spikes/s2-editor`); the fake core loads the fixture into its in-memory vault |
| L6 | Appium `mac2` on the built `.app` with `TEGG_TEST=1`, `TEGG_APP_SUPPORT=<temp dir>` and a temporary copy of the fixture (contract `docs/contracts/ms2-shell.md` §1, extended by AP-79) |
| manual | Owner or explorer session, recorded in `qa/manual/` or `qa/sessions/` |

**Fixture:** `tests/fixtures/vaults/shell/` (synthetic, D-50) plus `tests/fixtures/vaults/new-empty/.tegg/` copied into it, unless stated otherwise. Its objects:

| Short name | Path | Type |
| --- | --- | --- |
| Úvodní | `Pages/Úvodní stránka.md` | page |
| Bez hlavičky | `Pages/Bez hlavičky.md` | none (no frontmatter → Page, D-103) |
| Čtvrtek | `Quick Notes/Nápad na čtvrtek.md` | quick-note |
| Druhý | `Quick Notes/Druhý nápad.md` | quick-note |
| Eva | `Tasks/Zavolat Evě.md` | task |
| Porada | `Schůzky/2026-10-07 Porada.md` | schůzka (user type, plural `Schůzky`) |
| Svíčková | `Recepty/Svíčková.md` | recept (no definition in `.tegg/types/`) |
| Šablona | `_templates/Page/Šablona.md` | template, never counted or listed (FR-TPL-07) |
| Smazaná | `.trash/Pages/Smazaná stránka.md` | trashed, never counted or listed (D-102) |

User types without objects: `Cesta` (plural `Cesty`), `Čajovna` (plural `Čajovny`). Default type: Quick Note (`vault.yml`).

---

## Reference tables

These tables are the expected content of the app's **route registry**, **panel registry**, **disabled-control list** and **shortcut table** at the end of slice 3A. Tests compare the registries against them (FR-UX-02 AC-11, AC-12, FR-UX-03 AC-7). Each later slice or milestone changes a row from TBD to built in the same commit that builds it.

### R1. Routes (page map, plan §4.2, D-116)

| Route id | Page | Status after 3A | Milestone | Requirements shown on the placeholder | Design board | Reached by |
| --- | --- | --- | --- | --- | --- | --- |
| `chooser` | Vault chooser, New vault | built | MS3 | FR-VLT-01, FR-VLT-02 | — | launch with no vault; palette "Open vault…", "Create new vault…" |
| `home` | Home | TBD | MS5 | FR-HOM-01, FR-HOM-02 | Home | sidebar Home, sidebar logo, palette |
| `inbox` | Inbox | TBD | MS5 | FR-INB-01…04 | Home | sidebar, ⌘⇧I (AP-70), palette |
| `today` | Today | TBD | MS4 | FR-DLY-01…06 | Home | sidebar, ⌘D, palette |
| `tasks` | Tasks | TBD | MS5 | FR-TSK-04…06 | Home | sidebar, palette |
| `search` | Search | built (MS2 content) | MS2 | FR-SRC-01…04 | — | ⌘⇧F, palette (AP-69) |
| `type/<type>` | Type page | built, minimal list (AP-67) | MS3 | FR-TYP-09 | Ideas | sidebar Types list, note breadcrumb, palette "Go to type: <plural>" |
| `type-settings/<type>` | Type settings | TBD | MS3 (3D) | FR-TYP-01…03, -05, -11, -12 | TypeSettings | type page "Type settings" control, palette |
| `tags` | Tags | TBD | MS4 | FR-TAG-06, FR-TAG-07 | Main | sidebar Tags section, palette |
| `pinned` | Pinned | TBD | MS5 | FR-HOM-02 | — | sidebar, palette (AP-69) |
| `saved-queries` | Saved queries | TBD | v1.0 | FR-QRY-06 | — | sidebar, palette |
| `note/<path>` | Edit note | built, read view (3B, D-150) | MS3 | — | Main | switcher, search result, type page row, New object, launch landing |
| `graph` | Graph | TBD | v1.0 | FR-GRP-01…08 | Graph | palette, right-panel Graph tab |
| `trash` | Trash | TBD | MS6 | FR-HIS-01, FR-HIS-02 | — | palette |
| `import` | Import | TBD | MS7 | FR-IMP-01, -03, -05, FR-STO-10 | — | palette |
| `conflicts` | Conflicts | TBD | MS3 (3C) | FR-SYN-04, FR-SYN-05 | — | palette (AP-69) |
| `capture` | Quick capture | TBD | MS5 | FR-CAP-01…05 | Home | palette |
| `settings/appearance` | Settings: Appearance | built (theme only, 3A) | MS3 | FR-SET-02 | — | ⌘, (AP-70), palette |
| `settings/date-time` | Settings: Date & time | TBD | MS3 (3E) | FR-SET-03 | — | Settings section list, palette |
| `settings/vault` | Settings: Vault | TBD | MS5 | FR-SET-01 | — | Settings section list, palette |
| `settings/shortcuts` | Settings: Shortcuts | TBD | MS5 | FR-SET-04 | — | Settings section list, palette |
| `settings/menu-bar` | Settings: Menu bar and startup | TBD | MS5 | FR-SET-05 | — | Settings section list, palette |
| `settings/trash-history` | Settings: Trash and history | TBD | v1.0 | FR-SET-06 | — | Settings section list, palette |
| `settings/previews` | Settings: Previews | TBD | v1.0 | FR-SET-07 | — | Settings section list, palette |

### R2. Right-panel tabs (AP-71)

| Tab id | Tab | Status after 3A | Milestone | Requirements |
| --- | --- | --- | --- | --- |
| `backlinks` | Backlinks | TBD | MS4 | FR-LNK-01…04 |
| `outline` | Outline | TBD | MS5 | FR-EDT-11 |
| `graph` | Graph | TBD | v1.0 | FR-GRP-01 |

No Attributes tab: attributes stay at the top of the note (D-127, settles AP-20).

### R3. Disabled controls for later features inside built pages (D-116)

| Control (accessibility label) | Where | Milestone | Requirement |
| --- | --- | --- | --- |
| New tab (+), ⌘T | title bar | v1.0 | FR-NAV-06 |
| New type | sidebar, Types header | MS3 (3D) | FR-TYP-01 |
| Starter vault | chooser, New vault form | MS3 (3D) | FR-VLT-02 |
| Edit | note toolbar | MS3 (3C) | FR-EDT-01 |
| Filter, Sort, Views, New <Type> | type page | MS3 (3D) | FR-TYP-09 |
| Font, Font size, Editor width, Accent color | Settings: Appearance | MS3 (3E) | FR-SET-02 |
| Type picker | New object dialog | MS5 | FR-VLT-05 |

### R4. Shortcuts (main window)

| Shortcut | Command | Source |
| --- | --- | --- |
| ⌘K and ⌘⇧P | Open command palette | FR-NAV-02 |
| ⌘O | Open quick switcher | FR-NAV-01 |
| ⌘N | New object | design boards |
| ⌘⇧F | Go to Search | MS2 shell |
| ⌘D | Go to Today (TBD) | design Home |
| ⌘⇧I | Go to Inbox (TBD) | design Home (AP-70) |
| ⌘\ | Toggle right panel | design Main |
| ⌃⌘S | Toggle sidebar | proposed, AP-70 |
| ⌘⇧\ | Toggle focus mode (Esc also leaves it) | proposed, AP-70 |
| ⌘, | Go to Settings | proposed, AP-70 |
| ⌥⌘U | Toggle Markdown source | D-146 (slice 3B) |
| ⌘T | New tab (disabled, v1.0) | FR-NAV-06 |
| ⌘[ and ⌘] | Go back, Go forward | FR-NAV-03 (3B.1, D-165, D-166) |
| ⌃⌘1 … ⌃⌘9 | Open recent vault 1 … 9 | D-219 (FR-VLT-01 AC-17) |

Shortcut labels are displayed with modifiers in Apple's order ⌃ ⌥ ⇧ ⌘ (e.g. `⇧⌘P`), AP-70.

---

### FR-UX-02 Layout: sidebar, centre pane, right panel, page map

- **AC-1** **Regions.** Given the fixture vault is open in a 1440 × 900 window on any route except `chooser`, the window contains a title bar 44 px high with the tab strip, a `nav` element labelled `Sidebar` 232 px wide, a `main` centre pane, and, when open, an `aside` labelled `Context panel` 288 px wide (sizes from the Main board, ±1 px). No region overlaps another. *(L5)*
- **AC-2** **Sidebar content and order.** The sidebar shows, top to bottom: the field `Search or jump to…` with `⌘O`, the button `New object` with `⌘N`, the entries Home, Inbox, Today (`⌘D`), Tasks, the `Types` section with the `New type` control (R3) and the Types list (AC-4), the `Tags` section with one entry leading to `tags`, and the entries Pinned and Saved queries; below the scrolling list, at the bottom left and always in view, the logo button `Tegg: About and Settings` (D-220, AC-5). Entries of TBD routes show no count. *(L5)*
- **AC-3** **Type counts from the core (AP-65).** On the fixture, the core's type-count command returns exactly `page: 2, quick-note: 2, task: 1, schůzka: 1, recept: 1`: the untyped file counts as Page (D-103); the template and the trashed page are not counted; types without objects are absent from the result (the UI shows them as 0). Calling it causes zero vault writes. *(L4)*
- **AC-4** **Types list (AP-65, AP-66).** With the UI collation locale `cs`, the Types list shows exactly, in this order: Pages 2, Tasks 1, Quick Notes 2, Daily Notes 0, Cesty 0, Čajovny 0, Schůzky 1, Images 0, PDFs 0, then `recept` 1 marked as having no type definition. With locale `en`, the user types are ordered Čajovny, Cesty, Schůzky; no locale gives the code-point order Cesty, Schůzky, Čajovny. Tag is not in the list. Each entry leads to its `type/<type>` route. *(L5)*
- **AC-5** **Counts follow external changes.** Given the app shows the fixture, when another program creates `Quick Notes/Třetí nápad.md` (`type: quick-note`), Quick Notes shows 3 within 2 s (NFR-PERF-08); when it then moves that file to `.trash/Quick Notes/`, Quick Notes shows 2 within 2 s; when it deletes `Schůzky/2026-10-07 Porada.md`, Schůzky shows 0 and the entry stays. *(L4 for the counts and the `vault:changed` event; L5 for the UI update on the event)*
- **AC-6** **Type file names in NFD.** Given the test renames `.tegg/types/čajovna.yml` to its NFD form at runtime, the core lists the type exactly once, as `Čajovna` / `Čajovny` in NFC, and `type/čajovna` resolves to it (FR-FMT-12). *(L4)*
- **AC-7** **Right panel toggle (AP-71).** On a `note/<path>` route, `⌘\` and the toolbar button `Toggle right panel` open and close the `Context panel`; when it opens, the centre pane narrows by the panel's width and when it closes it widens by the same amount; the panel shows the tabs of R2 in that order, and each TBD tab shows its placeholder (AC-11) inside the panel. On routes without an object, the toggle control is absent and `⌘\` does nothing. *(L5)*
- **AC-8** **Collapsible sidebar.** `⌃⌘S` (AP-70) and the sidebar's collapse control hide the `Sidebar` (it leaves the accessibility tree) and widen the centre pane by 232 px; repeating restores it with the same selected entry and scroll position. *(L5)*
- **AC-9** **Focus mode.** On a `note/<path>` route, `⌘⇧\` (AP-70) or the toolbar button `Focus mode` hides the title bar's tab strip, the sidebar, the right panel and the note toolbar; only the note column remains. `⌘⇧\` again or Esc leaves focus mode and restores exactly the previous sidebar and panel states, for all four combinations (sidebar open/collapsed × panel open/closed). Focus stays in the centre pane. *(L5)*
- **AC-10** **Layout state is machine-local.** Given the sidebar is collapsed, the right panel open on the Outline tab, and the app is quit and relaunched, the same states are restored. They are stored under the Application Support root (`TEGG_APP_SUPPORT`, FR-STO-07); the vault's files are byte-identical with unchanged mtimes before and after. *(L6)*
- **AC-11** **Route registry (D-116 flow criterion).** The app's route registry equals table R1 exactly (ids, status, milestone, requirement IDs, design board); a route the router knows that isn't in the registry, or a registry entry the router can't render, fails the test. For every TBD route, rendering it shows the page name, a one-line purpose, the milestone (`MS5`, `v1.0`, `MS3 (3D)` …), the requirement IDs, and `View design: <board>` (or `No design board yet` when the board is —), all from the string catalog. For every route, each means in the "Reached by" column leads to it. *(L1 for the registry comparison; L5 for rendering and reachability)*
- **AC-12** **Disabled later-feature controls (AP-74).** Every control of table R3 is rendered with `aria-disabled="true"`, stays focusable by keyboard, and has the accessible description `Coming in <milestone>`, shown as a tooltip both on pointer hover and on keyboard focus. Activating it by click, ⏎, Space or its shortcut changes nothing: the route stays, no IPC command other than reads is sent, and nothing is written. *(L5)*
- **AC-13** **Placeholders can't outlive their milestone (AP-68).** Given `VERIFY_MILESTONE=MS<n>`, the registry test fails, listing each one, if any route of R1, tab of R2 or control of R3 is still TBD or disabled with a milestone at or before `MS<n>` (`MS3 (3D)` counts as MS3). Without the variable, the test only checks that every entry has a milestone and requirement IDs. *(L1)*
- **AC-14** **Note page in 3A.** Opening Porada shows the breadcrumb `Schůzky / 2026-10-07 Porada` whose first part leads to `type/schůzka`, the title `2026-10-07 Porada`, and the note body in the formatted read view of [read-view.md](read-view.md), not the raw file (D-150). Opening Bez hlavičky shows the breadcrumb `Pages / Bez hlavičky`. Opening Svíčková shows `recept / Svíčková`. Opening a note sends no write command. *(L5)*
- **AC-15** **Title bar tab.** The single tab shows the current page's name (route name, type plural or note title) and its icon and changes on every navigation; there is exactly one tab. *(L5)*
- **AC-16** **Launch landing (plan §4.3, AP-76).** With the remembered vault set to a copy of the fixture: (a) after Eva was the last note opened and the app was quit, a relaunch shows `note/Tasks/Zavolat Evě.md`; (b) with no note ever opened, the launch shows the `home` placeholder; (c) after another program renamed Eva's file to `Tasks/Zavolat Evě a Petrovi.md` while the app was closed, the relaunch shows the renamed note (same `id`); (d) after another program deleted it, or moved it into `.trash/`, the relaunch shows the `home` placeholder with no error dialog. In all four cases the vault is byte-identical before and after launch. *(L6; L5 for the UI branch on each core answer)*
- **AC-17** **Type page lists the type's objects (AP-67; changed by D-242, D-233).** `type/quick-note` is a table whose rows are exactly Druhý and Čtvrtek, sorted by `Modified` descending by default (objects without `modified` last, by title with the collation of AP-66; sorting rules in types.md FR-TYP-09 AC-3); `type/page` lists exactly Bez hlavičky and Úvodní; `type/cesta` shows an empty table with a guiding message; no list contains Šablona or Smazaná. Activating a row (click or ⏎) opens the note. `Type settings` leads to `type-settings/<type>` (built in 3D); the type page's later controls are those of R3. *(L5)*
- **AC-18** **Minimum window size (AP-80).** The main window can't be resized below 800 × 500 pt. At that size, with the sidebar open and the right panel open, every sidebar entry's label is visible or ellipsized with its full text as tooltip, and the centre pane is at least 400 px wide (the right panel closes by itself below the width at which this would fail, and reopens when the window is widened again). *(L5 for the reflow; L6 for the window's minimum size)*

### FR-UX-01 Visual style

- **AC-1** **One readable content column.** On a `note/<path>` route the note column is at most 760 px wide and horizontally centred in the centre pane (equal left and right margins ±1 px), at window widths 1024, 1440 and 2560 px, with the right panel open and closed. *(L5)*
- **AC-2** **Native window chrome.** In the built app, the macOS close, minimize and zoom buttons lie inside the 44 px title bar, no web control's frame intersects theirs, and dragging an empty area of the title bar moves the window. *(L6)*
- **AC-3** **Typography.** UI text uses the system font stack (`-apple-system`, SF Pro); sidebar entries are 13 px, UI body text 14 px with line height 1.5, page headings as on the boards (Home and type page 30 px, note title 34 px). *(L5, computed styles)*
- **AC-5** **Logo (D-164, D-220).** The sidebar's bottom-left button `Tegg: About and Settings` shows the logo of the Main board as one image: the light asset in the light theme and the dark asset in the dark theme, switching with the theme without a reload. The button contains no visible text node (the wordmark is part of the image) and showing it makes no network request (NFR-SEC-01). It stays in view when the sidebar list scrolls. Activating it opens the menu `About and Settings` with the items `About Tegg` (calls the IPC `app_about`, which shows the standard macOS About panel) and `Settings…` (→ `settings/appearance`); Esc closes the menu and returns focus to the button. *(L5; L1 for the assets: both are SVG files with no `<text>` element, no `@font-face` and no external reference)*
- **AC-4** [manual] **Design review.** The owner compares every built page of R1 and one TBD placeholder with its design board in light and dark: spacing, typography, restrained colour (type colours only as accents: icons, badges, tints), native-feeling chrome. Each deviation is recorded as an issue or accepted in the record. *(manual)*

### FR-UX-03 Keyboard-first: command palette and shortcuts

- **AC-1** **Palette opens everywhere.** `⌘K` and `⌘⇧P` open the dialog `Command palette` with the cursor in its input `Command query`, from every route of R1 including TBD placeholders, with the focus on the body, on a sidebar entry, on a disabled control or in a text field. Opened over the quick switcher or the New object dialog, the palette replaces it. *(L5; L6 for one route)*
- **AC-2** **Every command is runnable.** For every command in the command registry, typing its full title into `Command query` ranks it first, and ⏎ runs it and closes the palette; the test checks each command's effect (the route it opens, or the state it toggles). *(L5, data-driven over the registry)*
- **AC-3** **Navigation targets are commands.** The registry contains `Go to <Page>` for every route of R1 except `note/<path>` and `type/<type>`, `Go to type: <plural>` for every entry of the Types list (on the fixture: Pages, Tasks, Quick Notes, Daily Notes, Cesty, Čajovny, Schůzky, Images, PDFs, recept), `Open vault…`, `Create new vault…`, `Open quick switcher`, `New object`, `Toggle sidebar`, `Toggle right panel`, `Toggle focus mode`, `Theme: System`, `Theme: Light`, `Theme: Dark`. Type commands follow external type changes (a test-added `.tegg/types/kniha.yml` adds `Go to type: Knihy` within 2 s). *(L1 for the static part; L5 for type commands)*
- **AC-4** **Palette matching.** Matching is case-, diacritic- and NFC/NFD-insensitive and accepts letters in order: `cajovny`, `ČAJOVNY`, the NFD input `čajovny` and `gtcaj` each rank `Go to type: Čajovny` first. *(L5)*
- **AC-5** **Keyboard inside the palette.** ↑ and ↓ move the selection, ⏎ runs the selected command, Esc closes the palette and returns the focus to the element that had it before the palette opened. No step needs the pointer. *(L5)*
- **AC-6** **Shortcut display.** Each palette row of a command with a shortcut shows the binding of R4 rendered from the registry (not a literal), with modifiers in the order ⌃ ⌥ ⇧ ⌘ (`⇧⌘F`, `⌃⌘S`) (AP-70). Disabled commands (R3) show `Coming in <milestone>` instead of running (AP-74). *(L5)*
- **AC-7** **Registry integrity.** Command ids are unique; no two enabled commands share a shortcut; every shortcut of R4 is registered to the command named there; every title is a catalog key (NFR-OTH-02); no command uses a shortcut macOS reserves (⌘Q, ⌘H, ⌥⌘H, ⌘M, ⌘Tab, ⌘Space, ⌘`). *(L1)*
- **AC-8** **Every control is a command.** On every route of R1, with the right panel open and closed, every button, link, tab, menu item, checkbox, radio and switch in the frame carries a reference to a registered command, except text inputs and the rows of object lists (opened with ⏎). *(L5, DOM walk)*
- **AC-9** **Global shortcuts.** Each enabled shortcut of R4 runs its command from every route of R1 with the focus anywhere in the main window, except while a dialog (palette, switcher, New object) is open, where only that dialog's keys act. `⌘T` does nothing and writes nothing (D-167; ⌘[ / ⌘] navigate, FR-NAV-03). *(L5)*
- **AC-10** **Keyboard-only tour.** Using only Tab, ⇧Tab, arrows, ⏎, Space, Esc and R4 shortcuts (no pointer events), the test opens every sidebar entry, every Types entry, toggles sidebar, right panel and focus mode, sets each theme in Settings, opens a note from the switcher and creates an object with New object. Every element that receives focus shows a visible focus indicator: its computed `outline` or `box-shadow` differs from the unfocused state and is at least 2 px wide. *(L5)*
- **AC-11** **Focus after navigation (AP-74).** After a route change by sidebar, palette or shortcut, the focus is on the new page's heading in the centre pane (not on `body`, not left in the sidebar), so the next Tab starts in the page. *(L5)*
- **AC-12** **Keys work at launch.** In the built app, right after launch on the fixture and without any click, `⌘K` opens `Command palette` and Esc closes it; then `⌘O` opens `Quick switcher`. *(L6)*

### FR-UX-05 Light and dark themes with equal quality

- **AC-1** **One token set.** The light and dark themes define exactly the same set of colour tokens; a token defined in only one theme fails the test. *(L1)*
- **AC-2** **No colour outside the tokens.** No file in `app/ui/src/` other than the theme token module contains a colour literal (`#rgb`, `#rrggbb`, `#rrggbbaa`, `rgb(`, `rgba(`, `hsl(`, `hsla(`, named colours in style values); the logo asset is the only listed exception. *(L0)*
- **AC-3** **Contrast of token pairs (AP-73).** Every text token (`text`, `muted`, `link`, `accent`, `danger` and the type-colour foregrounds) has a contrast ratio of at least 4.5:1 against every surface token it is used on (`bg`, `side`, `panel`, `pop`, `row`, `hover`, and its own `*-bg` tint), in both themes. `faint` is exempt only where AP-73 allows it (disabled controls, decorative icons). *(L1, computed from the tokens)*
- **AC-4** **Rendered contrast (AP-73).** The axe-core `color-contrast` rule reports zero violations on every built route of R1, one TBD placeholder, the palette, the switcher and the New object dialog, in light and in dark. *(L5)*
- **AC-5** **No light colour leaks into dark.** On every built route of R1 and one TBD placeholder, in each theme, every computed `color`, `background-color` and `border-color` of every visible element is a token value of that theme, `transparent`, or inherited from such a value. *(L5)*
- **AC-6** **No flash of the wrong theme.** Given the stored theme is Dark and the system appearance is Light, the first rendered frame of the main window already uses the dark tokens (an init script records the theme of the first non-empty paint). *(L5)*
- **AC-7** [manual] **Equal quality in both themes.** The owner reviews every built route, one placeholder, the palette, the switcher and the chooser in light and in dark: nothing is unreadable, invisible or styled only in one theme. *(manual, with FR-UX-01 AC-4)*

### FR-SET-02 Appearance: theme switch (the part used by 3A)

- **AC-1** **Three choices.** `settings/appearance` has a `Theme` control with exactly the options System, Light and Dark; with an empty Application Support, System is selected. *(L5)*
- **AC-2** **Applies at once.** Choosing Light or Dark changes the main window's theme tokens within 100 ms, without a reload, and keeps the current route and the focused element; run from the palette (`Theme: Light`), the palette closes and the focus returns to the element that had it (D-139). *(L5)*
- **AC-3** **System follows macOS live.** With System selected, a change of the system appearance (emulated `prefers-color-scheme`) switches the theme within 100 ms; with Light or Dark selected, the system change is ignored. *(L5)*
- **AC-4** **Stored per machine (AP-72).** After choosing Dark and relaunching, the window opens in Dark. The choice is stored under the Application Support root; the vault's files, including `.tegg/vault.yml`, are byte-identical before and after. *(L6)*
- **AC-5** **Palette.** The commands `Theme: System`, `Theme: Light` and `Theme: Dark` set the same value as the Settings control and update it. *(L5)*

### NFR-OTH-02 Externalized UI strings

- **AC-1** **No literals in the UI code.** A static rule fails on any string literal in JSX text or in the attributes `aria-label`, `aria-description`, `title`, `placeholder`, `alt` and `label` in `app/ui/src/**`, outside the string catalog module. Strings of only whitespace, punctuation or digits, `className`, `data-*`, `key` and route or command ids are exempt. The rule's own test proves it fires on a sample file with `<button>Save</button>` and `aria-label="Close"`. *(L0)*
- **AC-2** **Everything shown comes from the catalog.** Command titles, placeholder names and purposes, `Coming in <milestone>`, tooltips, chooser and dialog texts, and the messages for core error kinds (`Conflict`, `Gone`, `NotFound`, `NameTaken`, `Io`, `NoVault`, `NotEmpty`, `Placeholder`, `InvalidFrontmatter`) are catalog keys; a core error's own `message` text is never displayed. *(L1)*
- **AC-3** **Pseudo-locale.** With a pseudo-locale catalog that wraps every message in `⟦ ⟧`, every route of R1, every R2 tab, the palette, the switcher, the New object dialog, the chooser and the placeholder banner render with every visible text node inside the markers, except text inside elements marked as user content (titles, file names, type names from the vault, note text). *(L5)*
- **AC-4** **Plural forms (AP-77).** Count messages select their form with the locale's plural rules: with a Czech test catalog, the placeholder warning for 1, 3 and 5 files uses the `one`, `few` and `other` forms; in English, 1 and 3 give `1 file …` and `3 files …`. No message is built by concatenating a number with a word. *(L1)*
- **AC-5** **Sorting of content (AP-66).** Every name-sorted list in 3A (Types list, type page list) uses the collation of AP-66; the fixture's user-type plurals sort as `Cesty, Čajovny, Schůzky` with `cs` and `Čajovny, Cesty, Schůzky` with `en`. *(L1 for the sort function; L5 via FR-UX-02 AC-4)*

### FR-VLT-01 Vault chooser and New vault (UI part, slice 3A)

FR-VLT-01 AC-1, AC-5, AC-7 and AC-8 in [data-safety.md](data-safety.md) are already marked `[MS3]` and are verified with this slice (AC-8's flush part needs the editor, 3C). The criteria below add the UI behaviour; they don't repeat those.

- **AC-9** [MS3] **Chooser.** Given no vault is remembered, the window shows only the chooser: the buttons `Create new vault` and `Open existing folder`, with the focus on the first; ⏎ activates it. No sidebar is shown. *(L5; L6 with an empty Application Support and no `TEGG_VAULT`)*
- **AC-10** [MS3] **New vault form.** `Create new vault` shows a form with a `Vault name` field, a `Location` row with the chosen parent folder and a `Choose…` button that opens the folder dialog, and a `Kind` choice with `Empty vault` selected and `Starter vault` disabled (R3). `Create` is disabled until the name has at least one non-space character and a location is chosen. `Create` sends one create command with kind Empty (FR-VLT-01 AC-2); on success the vault opens on the `home` placeholder and the Types list shows Pages, Tasks, Quick Notes, Daily Notes, Images and PDFs, each with 0 (AP-65). *(L5)*
- **AC-11** [MS3] **New vault in the real app.** With the folder dialog answered by the test hook (AP-79) with an empty temporary parent, and the name `Můj trezor` typed in NFD, the app creates `<parent>/Můj trezor/` (NFC) whose files equal `tests/fixtures/vaults/new-empty/` byte for byte apart from generated ids and timestamps (FR-VLT-02 AC-3), and nothing else in `<parent>`; a relaunch opens it. *(L6)*
- **AC-12** [MS3] **Errors stay in the chooser.** When the core refuses the create because the target folder exists and isn't empty (FR-VLT-01 AC-3), the form shows a catalog message naming the folder and an `Open it instead` action, and nothing else happens; any other core error shows its catalog message (NFR-OTH-02 AC-2) and the form keeps its input. *(L5)*
- **AC-13** [MS3] **Cancel writes nothing.** Cancelling the folder dialog, pressing Esc in the form, or choosing `Cancel` returns to the chooser; the parent folder and the Application Support root have the same file listing and bytes as before. *(L6)*
- **AC-14** [MS3] **Open existing folder.** Choosing a Tegg vault opens it with the landing of FR-UX-02 AC-16; choosing a folder without `.tegg/` shows `Import isn't available yet` (FR-VLT-01 AC-5) and stays in the chooser. *(L5)*
- **AC-15** [MS3] **Changing vault from the frame.** With a vault open, the palette commands `Open vault…` and `Create new vault…` show the chooser; Esc or Cancel returns to the previous route unchanged; opening another vault replaces the Types list and lands per FR-UX-02 AC-16. *(L5)*
- **AC-16** [MS3] **Vault switcher (D-219).** With a vault open, the title bar shows, before Back and Forward, the button `Vault: <name>. Switch vault` (`aria-haspopup="menu"`) with a colour dot and the vault's name as visible text; the dot's colour is the same for the same folder path in every session and comes from the fixed palette of ms3-shell §12.5. It is hidden with the tab strip in focus mode (FR-UX-02 AC-9). Activating it opens the menu `Vaults`: first one `menuitemradio` per recent vault (IPC `vault_recent`, at most 9, most recent first) showing its name, folder path and `⌃⌘<n>`, the open vault `aria-checked="true"`; a vault whose folder is missing is `aria-disabled` and shows `Not found`. Then, after a separator, the `menuitem`s `Open folder as vault…` (the folder picker of the chooser's Open; Cancel changes nothing), `Create new vault…` (the chooser's New vault form, as AC-15) and `Vault settings…` (→ `settings/vault`). Choosing another vault opens it as AC-15 does; choosing the open one only closes the menu. Esc or a click outside closes the menu and returns focus to the button. *(L5)*
- **AC-17** [MS3] **Recent vaults (D-219).** Every successfully opened or created vault is recorded first in a machine-local list in Application Support (never in a vault, FR-STO-07), without duplicates (folder paths compared after NFC normalization, FR-FMT-12), keeping the 9 most recent. `vault_recent` returns them with `exists` set by checking the folder at call time. `⌃⌘1…9` open the n-th entry of the list from any route with a vault open; on a missing or the open vault they do nothing. The commands are in the palette as `Open recent vault <n>` with their shortcuts (FR-UX-03). *(L4 for the list; L5 for the menu and shortcuts)*

### FR-VLT-03 Placeholder warning in the frame (slice 3A)

FR-VLT-03 AC-1 in [data-safety.md](data-safety.md) is already marked `[MS3]`; these criteria verify it in the new frame.

- **AC-4** [MS3] **Banner.** When the open vault reports 3 placeholder files, the frame shows a non-modal banner with the catalog message naming 3 files and how to make the folder available offline; with 1 it uses the singular form; with 0 there is no banner. While it is shown, the palette, the switcher and every sidebar entry work. *(L5)*
- **AC-5** [MS3] **Real app.** Given a copy of the fixture with a test-created iCloud stub `Pages/.Odložená poznámka.md.icloud`, opening it in the built app shows the banner naming 1 file, and the stub is unchanged afterwards (D-113). *(L6)*

### FR-UX-07 Progress in the frame (slice 3A)

FR-UX-07 AC-6 ([search-navigation.md](search-navigation.md), `[MS3] [manual]`) needs typing in an open note and is recorded after slice 3C (AP-78).

- **AC-7** [MS3] **No modal while indexing.** While the fake core emits `index:progress` with state `running`, the frame shows the status element `Indexing progress` with `Indexing <done> of <total>`; no element with `role="dialog"` or `aria-modal="true"` appears because of it; the palette, the switcher, sidebar navigation and New object keep working; after the `done` event the indicator disappears within 1 s; a `cancelled` event shows `Indexing paused`. *(L5)*

### FR-NAV-01 Switcher and New object in the frame (slice 3A)

- **AC-12** [MS3] **Sidebar search field.** Clicking `Search or jump to…`, or ⏎ when it has the focus, opens the same `Quick switcher` dialog as `⌘O`, with the cursor in `Switcher query`; `⌘O` works from every route of R1; choosing a result opens its `note/<path>` route; Esc closes it and returns the focus. *(L5)*
- **AC-13** [MS3] **New object (AP-75).** `⌘N` and the sidebar button `New object` open the dialog `New object` with the cursor in `Title` and the type shown as the vault's default type (Quick Note on the fixture) with the type picker disabled (R3). Then: (a) ⏎ with the title `Nový nápad` typed in NFD creates exactly one file, `Quick Notes/Nový nápad.md` (NFC), whose bytes equal those the switcher's create item writes for the same title and type (FR-NAV-01 AC-7) apart from the generated `id` and timestamps, and opens it; (b) the title `Nápad na čtvrtek` creates `Quick Notes/Nápad na čtvrtek (2).md` and leaves Čtvrtek byte-identical (FR-LNK-14); (c) with an empty or whitespace-only title, `Create` is disabled and ⏎ does nothing; (d) Esc closes the dialog and nothing is written. *(L5 for the dialog; L6 for (a) and (b) on the real core)*

### FR-SYN-06 No writes from the frame (slice 3A)

- **AC-5** [MS3] **Zero vault writes outside New object.** In the built app on a copy of the fixture, a scripted keyboard tour (every route of R1 through the palette, every Types entry, sidebar, right panel and focus mode toggled, all three themes, three notes opened from the switcher, two searches, quit and relaunch) leaves every vault file's bytes, mtime and inode unchanged and creates no file or folder in the vault, including `.tegg/` (plan §6, D-119). Only the Application Support root may change. *(L6; L5 counts zero write or create commands to the fake core during the same tour)*

### FR-NAV-03 Back and forward (slice 3B.1, D-165)

History is in memory only: one list of visited routes per window, with the note fragment and the centre pane's scroll position of each entry. In these criteria "navigation" is any route change by the sidebar, the palette, a shortcut, the switcher, New object, a search result, a type-page row, the breadcrumb, a link, a tag or a note embed chip.

- **AC-1** [MS3] **Back and Forward.** Given the fixture opened on `home` and the navigations Porada (switcher) → `type/schůzka` (breadcrumb) → `search` (⌘⇧F): Back shows `search`'s predecessor `type/schůzka`, Back again Porada, Back again `home`; Forward then shows Porada, then `type/schůzka`. A new navigation after a Back drops every forward entry. Navigating to the route that is already shown (same route string) adds no entry. *(L5)*
- **AC-2** [MS3] **Every trigger.** Each of these goes back, and its counterpart forward, with the same result as AC-1: the title-bar buttons `Back` / `Forward`, ⌘[ / ⌘], the palette commands `Go back` / `Go forward`, and the mouse back / forward buttons (DOM `mouseup` with `button` 3 / 4). The title-bar buttons are `aria-disabled="true"` with no "Coming in" description while there is nothing in their direction, and enabled otherwise; activating a disabled one, or the shortcut, does nothing. *(L5)*
- **AC-3** [manual] [MS3] **Mouse and trackpad in the real app.** In the built app, the mouse's back and forward buttons and a two-finger horizontal swipe on the trackpad go back and forward as in AC-1. *(manual, owner)*
- **AC-4** [MS3] **Scroll position and fragments.** Given Cíl of the read-view fixture was scrolled so that `Druhá kapitola` is the first visible block and the user then followed a link, Back shows Cíl with `Druhá kapitola` again the first visible block (± one line). An entry reached with a fragment (`[[Cíl#^blok1]]`) is restored to its scroll position at the time it was left, not re-scrolled to the fragment. *(L5)*
- **AC-5** [MS3] **Gone and renamed notes.** Going back to a note that was moved to `.trash/` or deleted in the meantime shows `This note was moved or deleted` (read-view FR-SYN-03 AC-11) and keeps the history; going back to a note renamed in the meantime shows it at its new path (same `id`). *(L5)*
- **AC-6** [MS3] **Dialogs and focus.** While the palette, the switcher or New object is open, ⌘[ / ⌘] and the mouse buttons don't navigate (FR-UX-03 AC-9). After Back or Forward the focus is on the page heading (D-130). *(L5)*
- **AC-7** [MS3] **Not kept, no writes.** After a relaunch the history is empty (both title-bar buttons disabled). Opening or creating another vault clears it. Back and Forward write nothing to the vault and nothing to `ui-state.json`; a note shown again by Back or Forward is recorded with `nav_opened` like any open (D-138). *(L5; L6 for the relaunch)*
