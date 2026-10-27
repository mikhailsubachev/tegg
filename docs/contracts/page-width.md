# Contract: page width (slice PW)

Public interfaces of `docs/plans/page-width.md` (AP-753…AP-758), for the test author (D-61). ACs:
`docs/acceptance/page-width.md`. Boards: `design/edit-note-page/LayoutNormal.dc.html`, `LayoutNormalPanel.dc.html`,
`LayoutWide.dc.html`, `LayoutWidePanel.dc.html`.

## 1. Machine-local state (ms3-shell §3; FR-STO-07)

```ts
type UiStateDto = {
  // … as before (version stays 1) …
  /** AP-753: the chosen page width per note, keyed by the object's `id`, else by its vault-relative path (NFC).
   *  Missing reads as empty: every note follows the vault default (§2). */
  noteWidth?: Record<string, 'normal' | 'wide'>;
};
```

- Stored by `ui_state_set` (atomic write of `ui-state.json`, as the other display state); read at start from
  `window.__TEGG_UI_STATE__`, else `ui_state_get`.
- A switch sends one `ui_state_set` and nothing else: no `note_write`, no vault file changes (FR-SYN-06).
- A note that has an `id` is keyed by it; a file without one (D-54) by its path, and the entry moves to the id when the
  first edit assigns one. An unsaved draft (D-520) stores nothing until its first write, then under the new id.

## 2. The vault default (ms5-capture §5.1; FR-SET-01, D-551)

`.tegg/vault.yml`:

```yaml
page-width: wide        # normal | wide; missing or unknown → normal
```

Core (`tegg-core`, `settings5b.rs`):

```rust
pub struct VaultSettings { /* … */ pub page_width: String /* "normal" | "wide" */ }
pub enum VaultKey { DefaultType, DailyFormat, Attachments, PageWidth }
// vault_settings_patch(base, VaultKey::PageWidth, value): `Invalid { reason }` unless value is `normal` or `wide`
// (trimmed, case-sensitive); writes only the `page-width:` line (appended after the last entry when missing),
// everything else byte for byte; an equal value writes nothing; `Conflict` when `base` isn't the current version.
```

IPC (`shell5b.rs`):

| Command | Args | Returns |
| --- | --- | --- |
| `vault_settings` | — | `VaultSettingsDto` with `pageWidth: 'normal' \| 'wide'` |
| `vault_settings_patch` | `base`, `key: 'page-width'`, `value: 'normal' \| 'wide'` | `VaultSettingsDto` |

`VaultInfo` (`vault_open`, `vault_current`) carries `pageWidth: 'normal' | 'wide'` so opening a vault sends no extra
command (read-view.md FR-EDT-02 AC-13); the UI reads `vault_settings` again when a `vault:changed` names
`.tegg/vault.yml` (AP-759). The fake core's twin (`app/ui/test/fake-settings.ts`) follows the same line rules.

The UI writes `ui_state_set` once per committed state change (an effect), never from inside a React state updater.

## 3. The note page (FR-UX-01, FR-UX-03, FR-UX-05, NFR-OTH-02)

| Element | Role | Accessible name / attributes |
| --- | --- | --- |
| Group | `radiogroup` | `Page width`; in the `toolbar` `Note toolbar`, after the save state (`status` `Save state`), before `Focus mode` |
| Normal | `radio` | `Normal`; `aria-checked`; `data-command="note.width.normal"`; icon `data-icon="width-normal"` |
| Wide | `radio` | `Wide`; `aria-checked`; `data-command="note.width.wide"`; icon `data-icon="width-wide"` |
| Column | — | `.note-column[data-width="normal" \| "wide"]`: `normal` is at most 760 px wide, centred, 40 px side padding; `wide` has no maximum and 56 px side padding (it fills the centre pane) |

- Shown on every `note/<path>`, `daily/<date>` and `new/<type>` page in the edit, read-only and source views; absent
  in focus mode with the rest of the toolbar (the width still applies).
- Keyboard: Tab reaches the checked radio; ←/→ move and choose; Space or ⏎ chooses.
- Palette commands (section `view`, no shortcut, R4 unchanged): `note.width.normal` `Page width: Normal`,
  `note.width.wide` `Page width: Wide`; on other routes they do nothing and write nothing.

Catalog keys (`app/ui/src/i18n/catalog.ts`): `note.width` `Page width`, `note.width.normal` `Normal`,
`note.width.wide` `Wide`, `cmd.width.normal` `Page width: Normal`, `cmd.width.wide` `Page width: Wide`,
`settings.vault.pageWidth` `Page width`, `settings.vault.pageWidthNote` `For notes without their own choice.`.

## 4. Settings › Vault (R58)

After `Attachments folder`: `radiogroup` `Page width` (description `For notes without their own choice.`) with radios
`Normal` (`data-command="settings.pageWidth.normal"`) and `Wide` (`settings.pageWidth.wide`); choosing one sends one
`vault_settings_patch` (`page-width`) with the current base version; a `Conflict` shows the R58 alert and reloads.
