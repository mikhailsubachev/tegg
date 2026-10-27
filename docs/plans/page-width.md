# Slice PW: page width (Normal / Wide) on the note page (2026-10-27)

Status: **proposed; built under the recommendations below, pending the owner's answers (AP-753…AP-760).** Owner brief
(2026-10-27, before slice 4E): *a wide / narrow layout switcher for the note page, as drawn on the design canvas (page
`Page width`, boards `LayoutNormal`, `LayoutNormalPanel`, `LayoutWide`, `LayoutWidePanel`, copied to
`design/edit-note-page/`); (1) the selected layout is persisted per note; (2) if it is cheap, a per-vault setting for the
preferred (default) layout; if not, the current layout stays the default and nothing is added to settings.*

## 1. What the BRD says

- **FR-SET-02** (M): "Appearance: … editor width (narrow/wide) …". Theme shipped in 3A (D-128); the rest moved to v1.0
  by D-565, and R3 of `docs/acceptance/app-shell.md` shows `Editor width` as a disabled control on Settings ›
  Appearance (`Coming in v1.0`). The BRD places the width among *machine* Appearance settings; it says nothing about a
  per-note choice.
- **FR-UX-01 AC-1** (app-shell.md): "the note column is at most 760 px wide and horizontally centred".
- **FR-STO-07**, D-128, D-634: display state is machine-local (`ui-state.json`), never in the vault; the panel width
  (D-634) is the closest precedent. D-791 put the *mindmap* layout into the file because Obsidian draws the map
  differently otherwise; a page width has no such reading in Obsidian.
- **FR-SET-01**, D-551: vault settings are one line each in `.tegg/vault.yml`, patched with a base version.
- Nothing in the BRD covers where a per-note choice lives, a per-vault default, or the control's place and names.
  Those are the points below.

## 2. Points for the owner (AP-753…AP-760)

| AP | Point | Proposal (built) | Alternative |
| --- | --- | --- | --- |
| AP-753 | **Where the per-note choice lives** (FR-STO-07, FR-FMT-07, NFR-POR-01) | Machine-local, in `ui-state.json`: `noteWidth: { "<id>": "normal" \| "wide" }`, keyed by the object's `id` (survives renames and the 4E type moves); a file without an `id` (D-54) is keyed by its vault-relative path and re-keyed when its first edit assigns the id. Nothing is written to the vault: a switch is one `ui_state_set`, no `note_write`, the file's bytes, mtime and inode are unchanged (FR-SYN-06; T2). On another machine a note follows the vault default (AP-754) until chosen there. Entries are not pruned in this slice (a few bytes each; pruning on trash deletion is a v1.0 follow-up) | A frontmatter key (`width: wide`): a new reserved key (FR-TYP-15), one write and sync upload per switch, a visible property in Obsidian; follows the note across machines |
| AP-754 | **A per-vault default** (FR-SET-01; the owner's "if it is cheap") | Yes: `page-width: normal \| wide` in `.tegg/vault.yml` (a missing or unknown value reads as `normal`), set on Settings › Vault by a `radiogroup` `Page width` (`Normal`, `Wide`), one line patched with the base version like the other 5B keys (D-551). It applies to every note without its own choice, on every machine. Cost: one key in the 5B settings module, its DTO field, the fake core's twin and one settings row | No setting; `normal` stays the fixed default |
| AP-755 | **FR-SET-02's "editor width" and the disabled `Editor width` on Settings › Appearance** (D-565, R3) | This slice delivers FR-SET-02's width as the per-note switch plus the per-vault default; the BRD row and the coverage table say so. The disabled Appearance control is left as it is (a machine-level preference stays v1.0, D-565): retiring it changes R3 and `app/test/shell-tables.ts` (an `AC-Test-Change` the owner approves), so it waits for this answer | Retire the R3 row now (as D-635 did for `Unlinked mentions`) |
| AP-756 | **The control, its names and the palette** (boards `Layout*`, FR-UX-03) | In the note toolbar after the save state, before `Focus mode`: a `radiogroup` `Page width` with two radios `Normal` and `Wide` (icon + text; the accessible name is the visible text; the board's `Normal width` tooltip is dropped so the name is one word), drawn like the Type settings segmented control. Shown in the edit, read-only and source views, on daily notes and unsaved drafts; it leaves with the toolbar in focus mode (the chosen width still applies). Palette: `Page width: Normal` and `Page width: Wide` (section `view`, no shortcut; on note routes only, elsewhere they do nothing, as R45). No menu-bar item, R4 unchanged | A single toggle `Toggle wide page` (⌥⌘W) |
| AP-757 | **What the widths are** (FR-UX-01 AC-1) | `normal` is today's column: at most 760 px, centred, 40 px side padding. `wide`: no maximum, 56 px side padding, so the column fills the centre pane and narrows with the right panel (D-634); tables, embeds and mindmaps get the room. FR-UX-01 AC-1 is amended to "in the Normal width" (wording; its test runs on the default). Both themes unchanged (FR-UX-05) | A fixed wide maximum (1200 px) |
| AP-758 | **Drafts and virtual notes** (D-520, D-322) | An unsaved draft (`new/<type>`) has no id: its choice is kept for the page and stored under the id its first write assigns; a discarded draft stores nothing. A virtual daily note is keyed by its path (known before the first write) and re-keyed by its id after it | No switch on drafts until the first write |
| AP-759 | **Does a change of the vault default re-lay an open note?** (raised by the ACs) | Live: an open note without its own choice follows the new default within 2 s of the Settings change or of `vault:changed`, no reload, no write (FR-SET-01 AC-13) | On the note's next open only |
| AP-760 | **Is a choice equal to the default stored; can a note follow the default again?** (raised by the ACs) | A click always stores the clicked value unless the note's entry already equals it (nothing sent then): a click pins the note. No `Use vault default` control in this slice (a v1.0 follow-up if wanted) | Store only values that differ from the current default |

## 3. Interfaces (for the test author; `docs/contracts/page-width.md`)

- `UiStateDto.noteWidth?: Record<string, 'normal' | 'wide'>` (missing reads as empty; `version` stays 1), stored by
  `ui_state_set` as the other display state (ms3-shell §3).
- `VaultSettingsDto.pageWidth: 'normal' | 'wide'`; `vault_settings_patch` takes `key: 'page-width'` with `normal` or
  `wide` (`Invalid` for any other value); `tegg_core::VaultKey::PageWidth`, `VaultSettings.page_width`.
- Toolbar: `role="toolbar"` `Note toolbar` › `role="radiogroup"` `Page width` › two `role="radio"` buttons `Normal`,
  `Wide` with `aria-checked`, `data-command="note.width.normal"` / `note.width.wide`.
- The column: `.note-column` gets `data-width="normal" | "wide"`.
- Commands `note.width.normal`, `note.width.wide` (titles `Page width: Normal`, `Page width: Wide`).
- Settings › Vault: `radiogroup` `Page width` with radios `Normal`, `Wide` (`data-command="settings.pageWidth.normal"`
  / `.wide`), after `Attachments folder`.

## 4. Steps

1. ACs: `docs/acceptance/page-width.md` (ac-author), test layers L1 (registry, catalog), L4 (the vault.yml key),
   L5 (WebKit, fake core), one L6 (relaunch keeps the choice, vault bytes unchanged).
2. Red tests (test-author): `app/test/page_width_registry.ac.test.ts`, `app/webkit/page_width.ac.test.ts`,
   `crates/tegg-core/tests/ac_page_width.rs`, `app/e2e/page_width.ac.test.ts`; `./verify check-red`.
3. Implementation: core key, DTOs, fake core twin, `NotePage` toolbar + column, commands, catalog, icons, Settings › Vault
   row, both themes; boards copied to `design/edit-note-page/`.
4. `./verify push`, QA review, PR against `main`.

## 5. What changes once decided

- **BRD**: one D-xx per AP (FR-SET-02 row and D-565 wording, FR-UX-01 AC-1 wording, FR-STO-07 example, §11 rows);
  `docs/requirements-coverage.md` FR-SET-02.
- **R3** (app-shell.md, `app/test/shell-tables.ts`): only if AP-755's alternative is chosen.
