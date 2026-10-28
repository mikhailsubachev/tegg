# Contract: object previews (v1.0 slice P)

Public interfaces of slice P, for the test author (D-61) and the build. ACs: `docs/acceptance/previews.md` (R102…R107,
FR-LNK-08…13, FR-NAV-08, FR-SET-07, FR-TSK-08 AC-4…AC-6). Decisions: D-37, D-38, D-217, D-917, D-919, D-921…D-944
(BRD v1.110). Board: `design/edit-note-page/ObjectPreview.dc.html` (D-921, drawn before the red tests; until then the
layout values of R102 are the only ones tests check). The graph (G1, G2) mounts the same preview (§7).

Slice P adds **no vault write** except the two link edits of §5.3, which go through the open note's autosave
(`note_write`, D-184). Every other part reads.

## 1. Machine-local state (ms3-shell §3; FR-STO-07, D-922, D-923)

```ts
type UiStateDto = {
  // … as before (version stays 1) …
  /** Slice P (D-923, D-922): the Object preview setting and the last popover size; missing reads as the defaults. */
  preview?: PreviewUiDto;
};
type PreviewUiDto = {
  mode?: 'click' | 'hover' | 'off';   // missing or unknown → 'click'
  hoverDelay?: number;                // ms, 200…1500 in steps of 100; missing → 400; out of range → clamped, off-step → nearest step
  width?: number;                     // px, 300…720; missing → 380
  height?: number;                    // px, 200…800; missing → content height up to 480
};
```

- Written by `ui_state_set` (atomic, as the theme and `dateTime`), once per committed change: a mode or delay change
  in Settings › Previews or the palette, and a resize **on pointer-up / key-up** (not while dragging). A double-click on
  the resize handle removes `width` and `height`.
- Read at start from `window.__TEGG_UI_STATE__`, else `ui_state_get`. The capture window doesn't read it (it has no
  references).
- The Rust `UiState` struct gains `preview: Option<PreviewUi>` with `#[serde(default)]`; unknown fields inside are kept
  on write, as for the other sub-objects.
- Tegg Preview builds use their own Application Support (D-118), so their setting is separate.

## 2. Reading what a preview shows (core, IPC)

No new command for content. A preview reads only through:

| Need | Command | Notes |
| --- | --- | --- |
| The previewed note (text, version, links resolved from its own path) | `embed_load([path])` (ms4-embeds §4) | read-only, no recency (D-138, D-943), never `note_read` |
| The targets of its cards (D-933) | one `embed_load(paths)` with every card target, after the first | at most two calls per preview (previews.md FR-LNK-10 AC-4) |
| Link targets in the host → paths | the host's existing resolution (`LinkTargetDto` from `note_read` / `embed_load` / `link_resolve`) | a broken target never opens a preview (D-939) |
| Type, preview attributes, icon | `vault_types` (already in the UI store) | strip per FR-TYP-11, at most 4 |
| Tag preview (D-937) | `tag_objects(key)` (ms4-tags §3) | the UI sorts by `modifiedNs` descending and keeps 10; the count is the row count |
| Image / PDF (D-938) | the Image/PDF object's `.md` through `embed_load`; the file through the shell asset path, as `MediaFigure` | no network (NFR-SEC-01) |
| Virtual Daily Note | none: `No note for this day yet.` (`embed.noDay`) | `daily_draft` is **not** called (nothing is written, FR-DLY-02) |
| Rename follow (D-935) | **new** `index_path_by_id` (below) | |

```rust
impl Core {
    /// Slice P (D-935): the vault path of the indexed object whose frontmatter `id` equals `id` (NFC, exact), outside
    /// `.trash/` and `_templates/`. `None` when there is none; when several files share the id (FR-LNK-14 duplicates),
    /// the one `resolve_links` would pick. Reads the index only; no recency.
    pub fn path_by_id(&self, id: &str) -> Option<String>;
}
```

| Command | Arguments | Returns |
| --- | --- | --- |
| `index_path_by_id` | `id: string` | `string \| null` |

Lives in `tegg-index` (platform-neutral, AR-03); rebuilding the index gives the same answer (AR-01). L4:
`crates/tegg-core/tests/ac_previews.rs`.

## 3. The preview module (`app/ui/src/preview/`)

One provider per window, mounted in `App.tsx` above the routes; one popover at a time (D-924).

```ts
// preview/types.ts
type PreviewTarget = {
  path: string;                       // vault path, NFC
  fragment: string | null;            // '#Heading' text or '^id' (D-140 parsing, ms3-shell §11)
  kind: 'note' | 'tag' | 'day';       // 'tag': key; 'day': YYYY-MM-DD of a date link without a note
  key?: string;                       // tag key (kind 'tag'), date (kind 'day')
  scrollToEmbedOf?: string;           // D-939: the task path whose first embed the source preview scrolls to
};
type PreviewAnchor = { el: HTMLElement } | { rect: DOMRect };
type PreviewHost = { placement: 'popover' } | { placement: 'column'; container: HTMLElement }; // §7
type PreviewOrigin = 'click' | 'hover' | 'key';  // 'key' = ⌥Space or ⏎ per D-929

// preview/PreviewProvider.tsx
export function PreviewProvider(props: { children: React.ReactNode }): JSX.Element;
export function usePreview(): {
  mode: 'click' | 'hover' | 'off';
  hoverDelay: number;
  show(target: PreviewTarget, anchor: PreviewAnchor, origin: PreviewOrigin, host?: PreviewHost, extraLine?: string): void;
  close(reason: 'esc' | 'outside' | 'button' | 'tab' | 'open' | 'route'): void;
  current: { target: PreviewTarget; origin: PreviewOrigin } | null;
};
```

### 3.1 Input resolution (pure, L1)

```ts
// preview/input.ts
type RefKind = 'chip' | 'row' | 'card' | 'figure';
type RefInput = 'click' | 'dblclick' | 'modClick' | 'modDblclick' | 'enter' | 'modEnter' | 'altSpace' | 'hoverRest' | 'contextmenu';
type RefAction = 'preview' | 'open' | 'menu' | 'createOffer' | 'none' | 'default';
export function resolveRefInput(mode: 'click' | 'hover' | 'off', kind: RefKind, input: RefInput, broken: boolean): RefAction;
```

Exactly R103 with D-925 (⌘ inputs → `open`), D-928 (`altSpace` → `preview` in every mode; broken → `none`), D-929
(`enter` on `chip` → the mode's click action; on `row` / `card` → `open`), D-938 (`figure`: `click` → `default`,
i.e. D-622 selection; `altSpace` → `preview`), D-939 (broken: `altSpace` → `none`, everything else → `createOffer`),
`contextmenu` on a `chip` in an editable note → `menu`, elsewhere `default`. `default` means the element's existing
behaviour. Tests: `app/test/previews_input.ac.test.ts` table-driven over all combinations.

### 3.2 References: one hook for every surface (R104)

```ts
// preview/useReference.ts
export function useReference(opts: {
  target: PreviewTarget | null;       // null = broken (D-939)
  kind: RefKind;
  open(): void;                       // the surface's existing open (route + nav_opened), unchanged
  createOffer?(anchor: HTMLElement): void; // broken links (FR-LNK-04)
}): {
  /** Spread on the element: onClick, onDoubleClick, onKeyDown, onPointerEnter/Move/Leave, aria-describedby. */
  props: React.HTMLAttributes<HTMLElement> & { 'data-preview-ref': '' };
};
```

- A single click in click mode waits for no double-click timer: the preview opens on the first click and a second
  click within the system double-click interval opens and closes the preview (D-37; previews.md R103 row 2).
- `aria-describedby` points to one hidden element per mode with `link.hint.click` / `link.hint.hover`; none when Off.
- Surfaces wired (R104): `read/ReadView.tsx` and the read-view chips (`links/ChipParts.tsx`), `embeds/Embed.tsx`
  (card, link mode, a full embed's header title), `types/AttributePanel.tsx` and `read/PropertiesStrip.tsx`
  (relation chips, `TextWithLinks`), `links/BacklinksPanel.tsx`, `tasks/TaskCard.tsx` (title: `card`; source chip:
  `chip` with `scrollToEmbedOf`), `pages/SearchPage.tsx` full-text rows (`row`), `pages/TypePage.tsx`,
  `tags/TagPage.tsx`, `tags/AllTagsPage.tsx`, `links/DuplicateTitlesPage.tsx`, `daily/ContextSections.tsx` (`row`),
  `inbox/InboxPage.tsx` card titles (`card`), `mindmap/MindmapMap.tsx` node chips (`chip`, D-941), tag chips
  everywhere (`tags/chip.ts`, kind `tag`). Not wired (D-931): `GoTo.tsx`, `shell/Palette.tsx`, the sidebar, title bar,
  breadcrumbs, recent vaults, `links/BrokenLinksPage.tsx` excerpts, the Trash page, `media/MediaFigure.tsx` except
  ⌥Space on a selected figure.

### 3.3 The popover (`preview/PreviewPopover.tsx`)

DOM per R102: `div[role=dialog][aria-modal=false][data-preview-path][tabindex=-1]`, header, `region` strip, `article`
body (its own scroll container), footer, `Close preview`, resize handle `[data-preview-resize][role=button]`.

- **Position:** below the anchor with an 8 px gap, above it when there is less room below, kept 8 px inside the
  window; it never covers the anchor. Recomputed on window resize; closed on route change (`close('route')`).
- **Size** (D-922): §1; resizing clamps to 300…720 × 200…800 and to the window minus 16 px.
- **Focus** (D-924): `click` and `key` origins focus the dialog; `hover` never does. Esc and `Close preview` return
  the focus to the anchor (in the editor: the caret after the chip, §5). Tab past the last control closes it
  (`close('tab')`) and lets the focus move on.
- **Outside click:** a `pointerdown` listener in the capture phase closes the popover and does **not** stop the event.
- **History** (D-932): a stack inside the popover; a click on a reference in the body pushes and replaces the
  content; `Back to <title>` pops; the stack is dropped on close.
- **Hover** (D-942): the provider starts the delay on `pointermove` over a reference and restarts it on each move;
  `keydown`, `wheel`, `scroll`, and a held button cancel it; leaving both the reference and the popover starts the
  300 ms grace (D-917); a click inside a hover popover turns its origin into `click` and focuses it.
- **Reduce motion** (FR-UX-08): no open/close transition.

### 3.4 Content (`preview/load.ts`, `preview/PreviewBody.tsx`)

```ts
type PreviewModel =
  | { state: 'ok'; path: string; id: string | null; title: string; type: string; details: string | null;
      strip: StripItem[]; body: 'blocks' | 'properties' | 'empty'; text: string; links: LinkTargetDto[];
      notice: 'noHeading' | 'noBlock' | 'readError' | null; version: VersionDto }
  | { state: 'tag'; key: string; name: string; color: string | null; count: number; objects: TagObjectRowDto[] }
  | { state: 'day'; date: string }
  | { state: 'gone' }                 // D-935
  | { state: 'error' };               // `preview.loadFailed`
export function loadPreview(target: PreviewTarget, signal: AbortSignal): Promise<PreviewModel>;
```

- Body rendering reuses the read view's block renderer (`read/ReadView.tsx` internals, through `@tegg/doc`), with:
  headings shifted below the popover's `h2`, embeds always cards (D-933), comments and block ids hidden, links
  resolved from the previewed file's own path (`EmbedNoteDto.links`).
- `#Heading` / `#^id` cut the blocks with `@tegg/doc`'s section extraction of ms4-embeds §2 (the rule of
  embeds.md FR-EMB-02 AC-3); a miss sets `notice` and renders the whole body (D-936 b).
- Invalid frontmatter (`@tegg/doc` reports it): title = the file stem, `notice: 'readError'` (D-936 c).
- Empty body: `body: 'properties'` when the object has any attribute, else `'empty'`; `strip` empty in both (D-936 a).
- **Windowing** (D-934): the body mounts blocks as the user scrolls, never more than 300 block elements; the first
  screen is mounted before `preview-ready` (§8).
- A new `show` aborts the running load (`AbortSignal`); a late answer for an old target is dropped.

### 3.5 Live updates (D-935, NFR-PERF-08)

The provider listens to `vault:changed`. When it names the previewed path, or a type file of the previewed object's
type: debounce 150 ms, `loadPreview` again, keep `scrollTop` relative to the first visible block. When the path is
gone: `index_path_by_id(id)`; a path → follow it (`data-preview-path` updated); `null` → `{ state: 'gone' }`,
`Open` `aria-disabled="true"`, the popover stays until closed.

## 4. Settings › Previews (`settings/previews`, FR-SET-07)

`pages/SettingsPage.tsx` gets the built section (registry R1 `status: built`, purpose text
`How links and embeds show a preview.`, D-944):

| Element | Role | Name / value |
| --- | --- | --- |
| Mode | `radiogroup` `Object preview` | three `radio`s with `settings.preview.click` / `.hover` / `.off` |
| Delay | `slider` `Hover delay` | `aria-valuemin=200`, `max=1500`, step 100, `aria-valuetext` `<n> ms`; `aria-disabled` unless the mode is Hover; description `Used with Hover to preview.` |

A change applies at once in every open window (the provider re-reads the store), with one `ui_state_set` (§1).

## 5. `@tegg/editor` additions

### 5.1 Link gestures

`PresentUi.onLink` keeps its signature for existing callers and gains an optional gesture:

```ts
onLink(target: string, fragment: string | null,
       chip?: { pos: number; dom: HTMLElement | null },
       gesture?: 'click' | 'dblclick' | 'modClick' | 'enter' | 'modEnter' | 'altSpace'): void
/** Slice P (D-942): pointer rests on / leaves a chip, for hover mode. */
onLinkHover?(target: string, fragment: string | null, chip: { pos: number; dom: HTMLElement }, phase: 'enter' | 'move' | 'leave'): void
/** Slice P (D-927): right-click on a chip. Return true when the host showed its menu. */
onLinkMenu?(target: string | null, chip: { pos: number; dom: HTMLElement }, event: MouseEvent): boolean
```

- `handleClickOn` on a `wikiLink` (and a Markdown link to a note) reports `click`, `dblclick` (from
  `handleDoubleClickOn`) or `modClick`; for `click` it sets a collapsed `TextSelection` right after the chip, never a
  `NodeSelection` (D-926). The app maps the gesture with `resolveRefInput` (§3.1).
- Keys: ⌘↩ at a chip → `modEnter` (D-209, unchanged behaviour: open); ⌥Space at a chip (caret directly before or
  after it, or the chip selected) → `altSpace` and the key is consumed; ⌥Space elsewhere is not handled, so the
  no-break space is typed (D-928). ⏎ in the editor stays a text key (D-929).

### 5.2 Return of focus

```ts
/** Slice P (D-924): put the caret right after the chip at `pos` and focus the editor. */
focusAfterChip(pos: number): void
```

### 5.3 Link editing (D-927)

Commands on the editor handle, each one transaction and one undo step, serialized by the D-184 minimal-diff rules
(only the link's source text changes):

```ts
editLink(pos: number, next: { target: string; alias: string | null }): boolean  // rewrites [[target|alias]] / [[target]]
removeLink(): boolean      // existing (editor.ts): the chip selected or at the caret becomes its visible text
linkAt(pos: number): { target: string; fragment: string | null; alias: string | null } | null
```

The app's `Link` menu (`shell/Menu.tsx`, name `Link`; it first puts the caret at the chip, so `removeLink()` acts on it) and the `Edit link` dialog (`preview/EditLinkDialog.tsx`,
non-modal, fields `Link to` with the `[[` suggestions, `Link text`) call them. ⇧⌘K with the caret at a chip opens the
dialog. The chip's `Create "<target>"` item reuses the Create offer (ms4-links).

## 6. Registry, palette, strings (R106, R107)

- `shell/registry.ts`: `settings/previews` built; no new route.
- `shell/commands.ts`: `preview.show` (⌥Space, section `navigate`, enabled only when `usePreview` reports a focused
  reference or the editor reports the caret at a chip), `preview.mode.click`, `preview.mode.hover`, `preview.mode.off`,
  `link.edit` (⇧⌘K), `link.remove` (the existing `linkField.remove` action), all `needsVault: true`.
- `i18n`: every key of R107, in the English catalog; `preview.tag.count` with plural categories (D-133).

## 7. The graph seam (D-917; G1, G2)

The graph calls `show(target, anchor, 'click' | 'hover' | 'key', host, extraLine)`:

- `host.placement: 'column'` renders the same `PreviewPopover` content without position, resize handle or outside-click
  closing, inside the given container (the full view's right column); `'popover'` is the panel case.
- `extraLine` is the D-917 line (`<Type> · <n> connections`), rendered after the type name (previews.md
  FR-LNK-10 AC-16). Slice P ships the slot and its L1 test only.

## 8. Speed (NFR-PERF-12, D-940)

The popover calls `perfMark('preview-ready')` when the header, strip and the first screen of the body are painted
(after the next animation frame); the reference input's `pointerup` calls `perfMark('preview-click')`. The L6
benchmark (`app/e2e/nfr_perf_12_previews.ac.test.ts`, outside the push run like the other `nfr_perf_` files) reports
p95 of 20 runs on the reference vault's 5,000-word note; it is report-only until the v1.0 release gate, enforced there.

## 9. Fake core and test hooks

- `app/ui/test/fake-core.ts`: `ui_state_get/set` keep `preview`; `index_path_by_id` from the fake index; `embed_load`
  as in ms4-embeds §8; every call recorded with its path (previews.md FR-LNK-08 AC-12 counts them). An injectable
  delay per command (for abort tests). A helper `setPreviewMode(mode)` writes `preview.mode` before the page loads, so
  the changed older tests (D-943) can keep their steps under `off`.
- L6 (`TEGG_TEST=1`): no new hook; the mode is set by writing `ui-state.json` in the temporary Application Support
  before launch.

## 10. Test layout

| Layer | Files |
| --- | --- |
| L1 | `app/test/previews_input.ac.test.ts` (§3.1), `previews_model.ac.test.ts` (§3.4 content rules on the fixture), `previews_popover.ac.test.ts` (roles, focus, sizes, history), `previews_catalog.ac.test.ts`, `packages/editor/test/previews.ac.test.ts` (§5) |
| L4 | `crates/tegg-core/tests/ac_previews.rs` (`path_by_id`, no recency from `embed_load`, no writes) |
| L5 | `app/webkit/previews.ac.test.ts` (surfaces, modes, live updates), `previews_editor.ac.test.ts` (click in text, menu, `Edit link`, ⌥Space), `previews_settings.ac.test.ts` |
| L6 | `app/e2e/previews.ac.test.ts` (FR-NAV-08 AC-2, FR-SYN-06 AC-37), `app/e2e/nfr_perf_12_previews.ac.test.ts` (NFR-PERF-12) |

Fixture: `tests/fixtures/vaults/previews/` (its README); binaries and `Pages/Dlouhá.md` are made at runtime.

## 11. Contract choices (no owner decision needed)

1. `index_path_by_id` is the only new command; content comes from `embed_load` so previews never record recency.
2. The click-mode preview opens on the first click without a double-click timer; the double-click then opens and
   closes it. A timer would add the system double-click interval (up to 500 ms) to every preview, against FR-LNK-11.
3. The preview setting has no vault file and no event: windows share it through the UI store, as the theme does.
4. `resolveRefInput` is the single source of the R103 table; surfaces never branch on the mode themselves.
5. The older tests that D-943 changes get `setPreviewMode('off')` for their existing steps in the build commit, with
   the `AC-Test-Change` trailer naming D-943.
