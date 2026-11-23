# Contract: The phone layout and reading (slice AND-2)

**Status: accepted, 2026-11-22** (owner: "Accept all"; CP-1…CP-16 → D-2083…D-2098).

Public interfaces of slice AND-2, for the test author (D-61) and the build. ACs: `docs/acceptance/android-phone.md`
(approved; RA8…RA13; FR-UX-04 AC-1…AC-7, FR-NAV-04 AC-13…AC-15, FR-NAV-03 AC-17…AC-19, FR-UX-03 AC-54, AR-03 AC-13,
AC-14, FR-UX-01 AC-8, FR-VLT-01 AC-29, FR-HOM-04 AC-1, FR-HOM-02 AC-32, FR-INB-01 AC-14…AC-16, FR-DLY-01 AC-13, FR-DLY-03
AC-8, FR-TYP-09 AC-37, FR-QRY-07 AC-32, FR-QRY-05 AC-30…AC-33, FR-QRY-06 AC-26…AC-28, FR-QRY-09 AC-9, FR-TSK-04 AC-30,
FR-TAG-07 AC-7, FR-TAG-06 AC-14, FR-EDT-10 AC-10, AC-11, FR-EDT-02 AC-26, FR-EDT-07 AC-22, FR-ATT-01 AC-17, FR-NAV-08 AC-3,
FR-MMP-02 AC-32…AC-36, FR-SRC-03 AC-22, FR-NAV-01 AC-24, FR-SYN-04 AC-13, FR-SET-01 AC-14, FR-SET-02 AC-11, AC-12, FR-UX-05
AC-26, FR-UX-08 AC-26, AC-27, NFR-OTH-02 AC-24, FR-UX-06 AC-1, FR-UX-07 AC-18, FR-SYN-06 AC-51, AC-52, FR-SYN-03 AC-35,
AC-36, NFR-SEC-01 AC-4, NFR-PERF-05 AC-6). Decisions: D-2000…D-2012 (plan `docs/plans/android-mvp-plan.md`), D-2054…D-2082
(the ACs' AP-2036…AP-2064, in order). Builds on [android-shell.md](android-shell.md) (AND-1: start flow, RA2, the plugin,
`test-env.json`, the LA harness). Precedents: [ms3-shell.md](ms3-shell.md) (frame, history, test environment),
[v1-views.md](v1-views.md) (views, usages), [mm-mindmap.md](mm-mindmap.md) (the map).

The desktop does not change (AR-03 AC-14): every item below is Android-only, chosen by `currentLayout() === 'phone'`
(§4.1), or a pure function both platforms share with unchanged desktop results. The phone layout writes nothing to the
vault (D-2068). §15 lists the points for the owner (CP-1…CP-16), accepted as proposed (D-2083…D-2098, BRD v1.239; owner, 2026-11-22).

## 1. Files

| Path | Owns |
| --- | --- |
| `app/ui/src/phone/layout.ts` | `layoutFor`, `currentLayout`, `isPhone` (§4.1) |
| `app/ui/src/phone/native.ts` | the page side of the native bridge: `nativeState`, `onNative`, `setBackHandler` (§6) |
| `app/ui/src/phone/back.ts` | `systemBack()`: RA12's order (§8.5) |
| `app/ui/src/phone/PhoneFrame.tsx` | the frame: app bar, `main`, bottom bar, notice, indexing line (§8.2) |
| `app/ui/src/phone/Drawer.tsx` | RA10 (§8.3) |
| `app/ui/src/phone/Sheet.tsx` | the bottom sheet, the Properties sheet (§8.4, §9.2) |
| `app/ui/src/phone/strip.ts` | `stripRows` (§4.5) |
| `app/ui/src/phone/sortLine.ts` | `phoneSortLine` (§4.3) |
| `app/ui/src/phone/links.ts` | `openUrlAllowed`, `openUrl` (§4.4, §9.3) |
| `app/ui/src/phone/commands.ts` | `PHONE_FRAME_COMMANDS`, `PHONE_HIDDEN_COMMANDS`, `phoneCommands` (§10) |
| `app/ui/src/phone/routes.ts` | `PHONE_ROUTES`, `PHONE_NOT_OFFERED`, `phoneRouteOffered` (§7) |
| `app/ui/src/phone/PhoneSettings.tsx` | `settings`, `settings/vault`, `settings/storage` on the phone (§9.10) |
| `app/ui/src/phone/phone.css` | every phone rule, scoped under `html[data-layout="phone"]` |
| `app/ui/src/mindmap/zoom.ts` | the map's scale rules (§4.2) |
| `app/ui/src/mindmap/MapViewport.tsx` | zoom, pan, full screen around `MindmapMap` (§9.4) |
| `app/ui/src/ipc/client.ts` | `ipc.androidOpenUrl`, `ipc.androidWindow`; `openExternal` on Android (§2.2) |
| `app/ui/index.html` | the viewport meta (§8.1) |
| `app/src-tauri/src/commands.rs` | `ANDROID_ONLY` and `ANDROID` gain the two commands (§2.1) |
| `app/src-tauri/src/phone.rs` | `open_url_allowed` (§4.4); pure, compiled on every target |
| `app/src-tauri/src/mobile.rs` | `android_open_url`, `android_window` (§2.2); the IPC log (§12.1) |
| `app/src-tauri/src/lib.rs` | `init_script` on Android (§6.1); no task-views migration on mobile (§3) |
| `app/src-tauri/capabilities/android.json` | gains `allow-android-open-url`, `allow-android-window` |
| `crates/tegg-core/src/taskviews.rs` | `TaskViewsMigration::Off` (§3) |
| `app/src-tauri/tegg-android/` (Kotlin `TeggStoragePlugin`) | insets, keyboard, Back, system bars, night mode, text zoom, `openUrl` (§5) |
| `app/src-tauri/gen/android/app/src/main/AndroidManifest.xml` | `configChanges` gains `fontScale\|density` (§5.6) |
| `app/playwright.config.ts` | the L5p projects (§13.2) |
| `tools/android/avd.sh` | the `pixel_7` profile, gesture navigation (§13.3) |
| `app/ui/test/phone-writes.ts` | `WRITE_COMMANDS`, `READ_COMMANDS` (§2.3), shared by L5p and LA tests |
| `app/webkit/phone-helpers.ts`, `app/e2e-android/helpers/phone.ts` | the test harnesses (§13.4, §14) |

## 2. Commands

### 2.1 The lists (AR-03 AC-9, AC-13; RA2)

`ANDROID_ONLY` becomes `vault_start`, `vault_find`, `storage_access`, `storage_access_settings`, `android_open_url`,
`android_window`; `ANDROID` ends with the same six. `DESKTOP` and `ANDROID_EXCLUDED` (`app/ui/src/ipc/android.ts`) do not
change. `build.rs`, the Android `generate_handler!` and `capabilities/android.json` list both new commands; the AND-1
host test that ties them together changes under `AC-Test-Change` (CP-4).

### 2.2 New Android-only commands

`Result<T, IpcError>`, camelCase DTOs (`ts-rs`, `app/ui/src/ipc/types.ts`).

| Command | Arguments | Returns |
| --- | --- | --- |
| `android_open_url` | `{ url: string }` | `()`. Refuses with kind `Unsupported` unless `open_url_allowed(url)` (§4.4); else calls the plugin's `openUrl` (§5.5), which starts `ACTION_VIEW`; kind `NoHandler` when no app takes it. Opens no connection itself (NFR-SEC-01) |
| `android_window` | `{ dark: boolean }` | `WindowStateDto`. Sets the status and navigation bar icon appearance for the resolved theme (`dark: false` → `APPEARANCE_LIGHT_STATUS_BARS` and `APPEARANCE_LIGHT_NAVIGATION_BARS` set; `true` → cleared), then answers the current window state (§5.2) |

```ts
type InsetsDto = { top: number; bottom: number; left: number; right: number };   // CSS px
type WindowStateDto = { insets: InsetsDto; keyboard: boolean; systemDark: boolean; fontScale: number };
```

`ipc.androidOpenUrl(url)` and `ipc.androidWindow(dark)` are the client calls. On Android, `ipc.openExternal(url)` does
`if (openUrlAllowed(url)) invoke('android_open_url', { url: new URL(url).href })` and never invokes `open_external`
(which stays in `ANDROID_EXCLUDED`), so every existing external-link path (read view, Properties strip `mailto:`) leaves
through the system. `new URL(…).href` percent-encodes: `https://example.org/čeština` is sent as
`https://example.org/%C4%8De%C5%A1tina` (NFR-SEC-01 AC-4).

### 2.3 Writes and reads ("zero writes", D-2068)

`app/ui/test/phone-writes.ts` exports two `readonly string[]`, the contract's lists. An L1 test (in AR-03 AC-13's file)
checks that `WRITE_COMMANDS ∪ READ_COMMANDS` equals `commands::DESKTOP ∪ ANDROID_ONLY` (from AND-1's `commands.json`),
disjoint, so a new command must be classified.

- **`WRITE_COMMANDS`** (a call is a write, whether or not it succeeds): `note_write`, `note_create`, `note_create_exact`,
  `note_trash`, `note_discard`, `note_rename`, `vault_create`, `vault_settings_patch`, `link_create`, `daily_create`,
  `object_trash`, `trash_restore`, `trash_delete`, `trash_empty`, `media_add`, `media_add_paths`, `capture_create`,
  `capture_media_add`, `pins_apply`, `query_apply`, `query_revert`, `query_create`, `query_duplicate`, `query_rename`,
  `query_trash`, `query_restore`, `task_views_restore`, `type_create`, `type_patch`, `type_delete`, `starter_add`,
  `tag_rename`, `tag_delete`, `merge_start`, `type_move`, `tidy_now`, `value_remove_start`, `type_delete_start`,
  `inbox_bulk`, `backup_restore`, `job_undo`, `job_redo`, `job_confirm`, `job_retry`, `job_cancel`,
  `job_resolve_interrupted`, `job_transform_result`, `import_start`, `graph_presets_apply`.
- **`READ_COMMANDS`**: every other command. The private-storage writers among them are allowed: `ui_state_set`,
  `nav_opened`, `vault_open` (recent vaults), `perf_mark`, `shell_settings_set`, `capture_draft_set`.

"Zero writes" at L5p: the fake core's `calls()` contain no command of `WRITE_COMMANDS`, `writesTo()` is empty, and its
files are unchanged. At LA: the IPC log (§12.1) has no `WRITE_COMMANDS` entry and the vault is untouched (AND-1's rule).
There is no client-side guard: a phone control that tries a write is seen by the tests (CP-13).

## 3. Core: no task-views migration on Android (FR-SYN-06 AC-52, D-2062; CP-5)

```rust
pub enum TaskViewsMigration { NotNeeded, Skipped, Done { .. }, Stopped { .. }, Off }
```

`Core::task_views_migrate` returns `Off` before reading anything when the core was opened with
`OpenExtras { bulk_jobs: false }`; the desktop's default extras keep R202's behaviour. The shell calls it only under
`#[cfg(desktop)]` (`open_vault`'s call and `task_views_enabled()` are desktop-only), so `TEGG_TEST_TASK_VIEWS=1` in
`test-env.json` changes nothing on the phone. The L4 test is `crates/tegg-core/tests/ac_android_task_views.rs`
(`fr_syn_06_ac52_no_task_views_migration_on_android`): on a copy of `views-tasks`' base fixture, `open_ext` with
`bulk_jobs: false` → `Off`, no `Schedule.yml` / `Kanban.yml`, `task.yml` byte-equal; `Core::open` → `Done` (positive
control). `type/task` lists the tabs `views:` lists (only `All Tasks` before the Mac's migration arrives).

## 4. Pure functions (L1, Vitest in Node; Rust host test for §4.4)

### 4.1 `layoutFor` (FR-UX-04 AC-1, D-2070)

```ts
export type Layout = 'phone' | 'desktop';
export function layoutFor(o: { platform: 'android' | 'macos'; width: number }): Layout;  // android → 'phone' at every width; macos → 'desktop'
export function currentLayout(): Layout;  // window.__TEGG_LAYOUT__ ('phone' | 'desktop') when set, else layoutFor({ platform: platform(), width: innerWidth })
export const isPhone = () => currentLayout() === 'phone';
```

`width` is kept for a later narrow-window rule and ignored now. `__TEGG_LAYOUT__` is the test hook that forces a layout
(D-2070); it is read once at start.

### 4.2 The map's scale (FR-MMP-02 AC-33, D-2073)

`app/ui/src/mindmap/zoom.ts`:

```ts
export const MAP_MIN = 0.5, MAP_MAX = 2.5, MAP_STEP = 1.25, MAP_PAD = 24;
export function openingScale(areaWidth: number, layoutWidth: number): number;  // layoutWidth <= areaWidth ? 1 : max(MAP_MIN, areaWidth / layoutWidth)
export function zoomIn(s: number): number;     // min(MAP_MAX, s * MAP_STEP)
export function zoomOut(s: number): number;    // max(MAP_MIN, s / MAP_STEP)
export function canZoomIn(s: number): boolean; // s < MAP_MAX - 1e-9
export function canZoomOut(s: number): boolean;// s > MAP_MIN + 1e-9
export function pinchScale(s: number, fromDist: number, toDist: number): number; // clamp(s * toDist / fromDist)
export function blockHeight(layoutHeight: number, s: number): number;            // layoutHeight * s + MAP_PAD
/** The scroll that keeps the layout point under `centre` (area coordinates) in place from scale s0 to s1. */
export function scrollAfterZoom(scroll: { left: number; top: number }, centre: { x: number; y: number }, s0: number, s1: number): { left: number; top: number };
```

### 4.3 The view-only line (FR-TYP-09 AC-37, FR-QRY-05 AC-30, D-2078)

```ts
export function phoneSortLine(sort: readonly SortDto[], type: TypeDto | null | undefined): string;
```

With levels: `t('phone.sortLineJoin', { sort: <first>, viewOnly: t('phone.viewOnly') })`, where `<first>` is
`t('phone.sortLine', { column: sortKeyName(by, type).label, order })` (order: `orderLabels(by, type)` `.asc` / `.desc`),
followed by `' ' + t('sort.more', { count: n - 1 })` when there are more levels. Without levels: `t('phone.viewOnly')`.
`All <plural>` passes its machine-local sort (`levelsOf(typeSort)`, default Modified ↓). Examples (en):
`Modified: Newest first · View only on the phone`, `Finished: Newest first +2 · View only on the phone`.

### 4.4 The URL check (NFR-SEC-01 AC-4, D-2074)

```ts
export function openUrlAllowed(url: string): boolean;   // app/ui/src/phone/links.ts
```
```rust
pub fn open_url_allowed(url: &str) -> bool              // app/src-tauri/src/phone.rs
```

True exactly when the trimmed URL parses and its scheme, case-insensitive, is `http`, `https`, `mailto` or `tel`
(`javascript:`, `file:`, `data:`, `content:`, `intent:`, relative and empty → false). Both have the same table test.

### 4.5 The Properties strip (FR-EDT-07 AC-22, D-2067)

```ts
export function stripRows(rows: readonly PanelRow[], preview: readonly string[]): { strip: PanelRow[]; more: number };
```

`rows` are `panelRows(doc, type).rows` (the attribute panel's model, `types/panel.ts`). `strip`: the rows whose key is
in `preview` (NFC, in `preview`'s order, at most 3) and whose value is not empty (`null`, `''`, `[]`); when `preview` is
empty, the first three non-empty rows. `more = rows.length − strip.length`. The button reads
`t('phone.moreProperties', { count: more })`, absent at 0.

### 4.6 Commands and routes

§7 and §10: `phoneRouteOffered(id)`, `phoneCommands(list)`. Both are pure over their inputs.

## 5. The plugin `tauri-plugin-tegg-android` (Kotlin, D-2018)

`TeggStoragePlugin` keeps `access`, `filesDir`, `openSettings` and gains the following. The Rust side `TeggAndroid`
gains `open_url(url)` and `window(dark) -> WindowState`; still no Tauri commands of the plugin's own.

### 5.1 Insets and the keyboard (FR-UX-04 AC-3, AC-4; CP-1)

In `load(webView)` the plugin sets `ViewCompat.setOnApplyWindowInsetsListener` on the activity's content view
(`android.R.id.content`; the activity is edge to edge, `enableEdgeToEdge()`):

- `bars` = `insets.getInsets(systemBars() or displayCutout())`, `imeShown` = `insets.isVisible(ime())`.
- The content view's bottom padding is `ime().bottom` while `imeShown`, else 0: the WebView ends at the keyboard's top,
  so the page's layout viewport shrinks (as Chromium on a phone does).
- The page gets `{ top, bottom: imeShown ? 0 : bars.bottom, left, right }` in CSS px (device px ÷ density, rounded
  up; a bottom or right bar's inset also covers the up to 1 CSS px by which the WebView's layout viewport, rounded up
  to whole CSS px, reaches past the screen, D-2118) and `keyboard: imeShown`, through §6.
- A `WindowInsetsAnimationCompat` callback (`DISPATCH_MODE_STOP`) on the content view makes the keyboard's end state
  arrive when its animation starts, so the WebView is resized at once (D-2121).

The system bars are never padded natively: the page draws its own background under them and keeps text out with the
insets (CSS variables, §8.1).

### 5.2 `window(dark)`

On the UI thread: `WindowInsetsControllerCompat(window, decorView)` `.isAppearanceLightStatusBars = !dark` and
`.isAppearanceLightNavigationBars = !dark`; answers `{ insets, keyboard, systemDark, fontScale }` from the current
root insets and configuration (`uiMode and UI_MODE_NIGHT_MASK == UI_MODE_NIGHT_YES`). Algorithmic darkening stays off
(the default for `targetSdk 35`; nothing enables it), so a light theme in night mode keeps its colours (FR-SET-02 AC-12).

### 5.3 System Back (FR-NAV-03 AC-17, RA12; CP-3)

The plugin adds an `OnBackPressedCallback(true)` to the activity's dispatcher in `load` (after Tauri's `AppPlugin`, so
it runs first). On Back it calls `webView.evaluateJavascript("window.__TEGG_NATIVE__ ? window.__TEGG_NATIVE__.back() : false")`;
a result other than `true` calls `activity.moveTaskToBack(true)` (same process, nothing written). The keyboard's own Back
is consumed by the IME window before the dispatcher (RA12's first row).

### 5.4 Night mode and the system font size (FR-SET-02 AC-11, FR-UX-08 AC-27)

`onConfigurationChanged` (and once in `load`) sets `webView.settings.textZoom = round(fontScale × 100)` and sends
`{ systemDark, fontScale }` through §6. The page's theme follows `systemDark` on Android (§8.7), never the WebView's
`prefers-color-scheme`, which doesn't follow a configuration change without an activity restart.

### 5.5 `openUrl(url)`

`startActivity(Intent(ACTION_VIEW, Uri.parse(url)).addFlags(FLAG_ACTIVITY_NEW_TASK))` when the scheme is one of §4.4's
four (checked again); `ActivityNotFoundException` rejects with `NoHandler`. No `FileProvider` intent (PDFs don't open
elsewhere in AND-2).

### 5.6 Manifest

`MainActivity`'s `configChanges` gains `fontScale|density` (it has `orientation|…|screenSize|…|uiMode`): rotation, night
mode and the font size never recreate the activity or the WebView (FR-UX-04 AC-7, D-2071).

## 6. The native bridge in the page (CP-2)

### 6.1 `init_script` on Android

`init_script` adds, only under `cfg(target_os = "android")` (the macOS script is byte-identical to today's):

- `window.__TEGG_MEDIA_BASE__ = location.protocol + '//tegg-media.localhost/'`: Android's WebView reaches custom
  schemes as `<http|https>://<scheme>.localhost/` (FR-ATT-01 AC-17); the desktop keeps `tegg-media://localhost/`.
- `window.__TEGG_NATIVE__ = { state: { insets: { top: 0, bottom: 0, left: 0, right: 0 }, keyboard: false, systemDark: null, fontScale: 1 }, receive(kind, payload), back() }`:
  `receive('window', partialState)` merges into `state` and dispatches `window` event `tegg:native`; `back()` returns
  `false` until the page installs its handler.

### 6.2 `app/ui/src/phone/native.ts`

```ts
export type NativeState = { insets: InsetsDto; keyboard: boolean; systemDark: boolean | null; fontScale: number };
export function nativeState(): NativeState;                              // window.__TEGG_NATIVE__.state, or the defaults off Android
export function onNative(f: (s: NativeState) => void): () => void;       // `tegg:native` events
export function setBackHandler(f: () => boolean): void;                  // installs window.__TEGG_NATIVE__.back
export function syncWindow(dark: boolean): Promise<void>;                // ipc.androidWindow(dark), merges the answer; errors ignored
```

The phone frame calls `syncWindow` at start and on every resolved-theme change (so the first state is pulled even if a
push came before the page loaded). On `macos` none of this runs.

## 7. Routes on the phone (RA9; D-2063…D-2065)

`PHONE_ROUTES: RouteDef[]` adds two Android-only routes: `settings` (name `phone.settings`) and `settings/storage`
(name `phone.settings.storage`). On the phone `parseRoute` accepts them (it reads `ROUTES` plus `PHONE_ROUTES`);
`ROUTES`, `__TEGG_TEST__.routes()` and every desktop result are unchanged.

`PHONE_NOT_OFFERED`: `new/<type>`, `home`, `graph/<path>`, `trash`, `type-settings/<type>`, `help/shortcuts`,
`settings/shortcuts`, `settings/menu-bar`, `settings/trash-history`, `settings/previews`, `settings/backups`,
`broken-links`, `duplicate-titles` (CP-9). `phoneRouteOffered(id)` is false for them. Navigating to one (a stored last
route, `TEGG_ROUTE`, a `go`) lands as an unknown route does (FR-UX-02's not-found rule); no phone control links to one.
`tasks` and `tasks/kanban` resolve to `type/task` as on the desktop. The landing (FR-HOM-04 AC-1, D-2075) is the
desktop's: `vault_last`'s note when it exists, else `inbox`.

## 8. The frame (RA8, RA10, RA12)

### 8.1 Root, viewport, insets

- `<html data-layout="phone">` on the phone, `data-layout="desktop"` otherwise, set before the first render. (A
  mindmap's `figure[data-layout="right"|"spider"]` is unrelated.) No `phone.*` key and no `[data-layout="phone"]` render
  on `macos` (AR-03 AC-14).
- `index.html`'s viewport meta becomes `width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no,
  viewport-fit=cover`; WKWebView on macOS ignores it.
- CSS custom properties on `<html>`: `--inset-top`, `--inset-bottom`, `--inset-left`, `--inset-right` (px, default
  `0px`) from `nativeState().insets`; `html[data-keyboard="shown"]` while `keyboard`.
- `body` and every full-height layer use the theme's `--bg`, also under the status bar.

### 8.2 The phone frame (`PhoneFrame`)

Rendered instead of `TitleBar`, `Sidebar`, `ContextPanel`, the outline rail, focus mode and the palette when `isPhone()`
and a vault is open. The start screens (`AccessScreen`, `OpeningScreen`, `AndroidChooser`) are AND-1's and only gain the
insets (padding by the CSS variables, on the theme's `bg`, D-2122) and the keyboard rules (§8.6).

| Part | DOM |
| --- | --- |
| App bar | `header[role="banner"].phone-appbar`, `padding-top: var(--inset-top)`, content row ≥ 48 px. Left: `button[aria-label="Back"][data-command="nav.back"]` only while `history.canBack()`. Then the page's only `h1` (`tabIndex=-1`, the shared heading ref of D-130): every page renders its heading through `PageHeading`, which portals into the app bar. On `search` the `div[role="search"]` (field `Search query`, `enterkeyhint="search"`, `Clear search`) is portalled there instead and the page's `h1 Search` stays in `main`, visually hidden. Right: `button[aria-label="More actions"][aria-haspopup="menu"][data-command="phone.more"]` on `note/<path>` and on a daily route that has a file (CP-10) |
| Indexing | `div[role="status"][aria-label="Indexing progress"]` directly below the app bar while `index:progress` is `running` (`progress.running` text, a `progress` element); gone within 1 s of `done` |
| Content | the existing `main[aria-label=<page name>]`, the only vertical scroller (`overflow-y: auto`; `html`, `body` and the frame don't scroll). `.page-column` padding 16 px left and right (plus the side insets) |
| Bottom bar | `nav[aria-label="Main"].phone-bottombar`, `padding-bottom: var(--inset-bottom)`; four `button`s, each an icon and a visible label `span.phone-tab-label`: `Menu` (`data-command="phone.menu"`, `aria-haspopup="dialog"`, `aria-expanded`), `Search` (`goto.search`), `New` (`object.new`, `aria-disabled="true"`, `aria-description` = `phone.newLater`; a tap does nothing), `Today` (`daily.today`). `aria-current="page"` on `Search` on `search` and on `Today` on `daily/<today>`. Not rendered while `keyboard` or a full-screen map is open |
| Notice | `div[role="status"][aria-live="polite"].phone-notice` above the bottom bar, non-modal; one text at a time, removed after 4,000 ms: `phone.noNote` (§9.3), `error.unsupported` (on the phone it replaces AND-1's `role="alert"`, which stays on the desktop layout) |

Absent on the phone (not in the DOM): `.titlebar` and its `tablist "Tabs"`, `New tab`, the title-bar `Back` /
`Forward`, `nav[aria-label="Sidebar"]` while the drawer is closed, `aside "Context panel"`, the outline rail,
`dialog "Command palette"`, object previews (`PreviewProvider` is off), and every R3 "Coming in" control.

### 8.3 The drawer (`Drawer`, RA10; CP-7, CP-8)

`div[role="dialog"][aria-modal="true"][aria-label="Navigation"].phone-drawer` from the left edge, width
`min(320px, 100vw − 56px)`, from `var(--inset-top)` to `var(--inset-bottom)`, over a scrim `div.phone-scrim` (no role; from `var(--inset-top)` down, so the status bar's area keeps `bg`, D-2121;
the drawer's width grows by `--inset-left`, which pads its content, D-2122)
that covers the rest of the viewport, the bottom bar included. Mounted when opened; removed from the DOM when its close
transition ends (`transition-duration` 200 ms, `0s` under `prefers-reduced-motion: reduce`). While open, every other
child of the app root has `inert`; Tab and Shift+Tab cycle inside the drawer.

Content, top to bottom: `VaultSwitcher` (`button "Vault: <name>. Switch vault"`, `data-command="vault.switch"`, menu
`Vaults`, FR-VLT-01 AC-29); the `Sidebar` component in `variant="drawer"` (its `nav[aria-label="Sidebar"]` lives inside
the dialog) with `Inbox` (`goto.inbox`, count), `Today` (`daily.today`), `Tasks` (`tasks.go`, count), `Conflicts`
(`goto.conflicts`, count, only while conflicts exist), `PinnedSection` with `readOnly` (§9.8), the `Types` list exactly as
the desktop (`goto.type:<key>`), `Tags` (`tags.go`), `Queries` (`queries.go`, count), `Settings` (`goto.settings`); then,
fixed at the bottom, the version button `Tegg: About and Settings` (`app.logoMenu`), whose menu `About and Settings`
holds `Settings…` only, opening `settings`. The `drawer` variant renders no `New object`, `Search`, `New type`, `Trash`,
type context menus, drag sources or drop targets. Every entry is ≥ 48 px high.

Opening: `Menu` (command `phone.menu`); focus moves to the `Inbox` entry. Closing: an entry (navigates; focus on the new
page's `h1`), the scrim (a tap anywhere on it, including where `Menu` is), Esc, system Back, `phone.menu` again; after a
close without navigation focus returns to `Menu`. Neither adds a history entry or writes; no edge swipe opens it.

### 8.4 Sheets and menus

`Sheet`: `div[role="dialog"][aria-modal="true"][aria-label=<title>].phone-sheet` anchored to the bottom (above
`--inset-bottom`, at most 85 % of the viewport height, its own scroller), over a scrim; `button "Close"`
(`phone.close`, `data-command="phone.sheet.close"`). Scrim, `Close`, Esc and system Back close it; focus returns to the
control that opened it. Menus (`PopupMenu`) are placed inside the viewport and the insets, items ≥ 48 px high.

### 8.5 Back and gestures (RA12; FR-NAV-03 AC-17…AC-19)

`systemBack(): boolean` (`app/ui/src/phone/back.ts`, installed with `setBackHandler`), first match wins:
1. a menu, the drawer, a sheet, the calendar dialog or a full-screen map is open → close the topmost, return `true`;
2. `history.canBack()` → the frame's `actions.back()` (FR-NAV-03's Back, scroll and focus restore), return `true`;
3. else return `false` (the plugin moves the task to the back; at L5p `__TEGG_TEST__.systemBack()` reports it).

The app bar's `Back` runs step 2. There is no Forward control on the phone; history keeps its desktop rules (view tabs,
the drawer, sheets, menus and full-screen maps add no entry; `search` restores its state, D-1217).

No touch gesture navigates: `installNavSwipe` is never installed on the phone, `nav_swipe_scroll` is not asked, and no
`touchstart` / `pointerdown` handler of the frame or a row reacts to horizontal movement. Horizontal drags scroll what is
under them (`overflow-x: auto` boxes, `touch-action: pan-x pan-y` on the map area). The phone sets
`-webkit-touch-callout: none` and `user-select: none` on links, chips, rows, cards and buttons and prevents
`contextmenu` on the document: a long press does nothing (no WebView context menu, no preview, no menu). Running text
stays selectable.

### 8.6 The keyboard (FR-UX-04 AC-4, FR-NAV-01 AC-24)

While `keyboard` is true the bottom bar is not rendered and the focused field is scrolled into view (`scrollIntoView({
block: 'nearest' })` after each viewport resize). The chooser's and the New vault form's fields work the same way.

### 8.7 Theme (FR-SET-02 AC-11, AC-12; FR-UX-05 AC-26)

`theme/apply.ts` gains `setSystemDark(dark: boolean | null)`. On Android the frame feeds it `nativeState().systemDark`;
with choice `system` the theme is dark exactly when it is `true` (with `null`, the media query as today). After every
resolved change the frame calls `syncWindow(dark)`. The choice is stored in `ui-state.json` as today. Settings ›
Appearance on the phone has `Theme` only (System, Light, Dark).

## 9. Pages (RA11: hidden means not in the DOM)

### 9.1 The note: the read view (FR-EDT-10 AC-10, AC-11; D-2069)

On the phone `NotePage` always takes the `readView` mode (as `__TEGG_TEST__.readView` does, D-215) for `note/<path>`
and daily routes: no `contenteditable`, no `.ProseMirror`, no `editor_open`. The title is the app bar's `h1`; the body
is `ReadView` as on the desktop. `More actions` opens the menu `More actions` with `Properties`
(`data-command="phone.properties"`) and `Show Markdown source` / `Show formatted note` (`note.toggleSource`); the source
view is the existing `SourceView`. Hidden: title and property editing, the review toggle, `Page width`, `Open in
Preview`, `Reveal in Finder`, the Create offer. `note-ready` is marked once the read view's body has painted.

### 9.2 Properties strip and sheet (FR-EDT-07 AC-22; CP-14)

Below the app bar, first in `main`: `div[role="group"][aria-label="Properties"].phone-strip` with `stripRows`' rows
(each `label` + value) and `button "+<n> properties"` (`phone.properties`). The sheet `Properties` lists every row of
`panelRows(doc, type).rows` in order (Created and Modified included; the hidden and Other groups as the panel shows them
collapsed: not listed), each `div[role="group"][aria-label=<label>]` with the value rendered by the read view's
`PropertyRows` cells (dates per the Date & time setting, select labels, relation and tag chips). No `input`,
`textarea`, `select`, `[contenteditable]`, `[role="listbox"]` or `[role="option"]` in the sheet. A relation chip
navigates and closes the sheet.

### 9.3 Links, media, external links (FR-EDT-10 AC-11, FR-ATT-01 AC-17, NFR-SEC-01 AC-4)

- Links, tags and date links open as on the desktop (a date link without a note opens the virtual day, no write).
- A broken link: on the phone the offer handler (`setOfferHandler`) shows the notice `phone.noNote` with
  `{name}` = the link target as written; no route change, no `link_create_plan`.
- External: `http`, `https`, `mailto` and `tel` links are external in the phone's read view; a tap calls
  `ipc.openExternal` (§2.2). Other schemes render as text and do nothing. The WebView never navigates away
  (`a[href]` targets are `#`; the frame prevents default on every other anchor).
- Images: `img[src]` from `mediaUrl` (§6.1), `max-width: 100%`, `height: auto`. A tap on an image opens its Image
  object (R76). The Image and PDF object pages hide `Open in Preview` and `Reveal in Finder`; the PDF card opens its
  object page only.

### 9.4 Mindmaps (FR-MMP-02 AC-32…AC-36, D-2073)

The read view's `figure.mindmap-block` on the phone has a header with `div[role="group"][aria-label="Mindmap view"]`
(`button[aria-pressed]` `Map` `mindmap.showMap`, `List` `mindmap.showList`), `Zoom out` (`mindmap.zoomOut`), `Zoom in`
(`mindmap.zoomIn`), `Fit to width` (`mindmap.fit`), `Open full screen` (`mindmap.fullScreen`); each zoom button is
`aria-disabled="true"` at its limit. The map area `div[data-map-area]` carries `data-scale="<s>"`, scrolls sideways
(`overflow-x: auto`, `overflow-y: hidden`, `touch-action: pan-x pan-y`), height `blockHeight(layout.height, s)`; the
drawing is scaled by `transform: scale(s)` from the top left. A pinch (two pointers) applies `pinchScale` around its
centre with `scrollAfterZoom`. Full screen: `div[role="dialog"][aria-modal="true"][aria-label="Mindmap: <title>"]`
covering the viewport within the insets, with `Close full screen` (`mindmap.closeFullScreen`) and the zoom buttons; its
area pans both ways; closing returns to the note's scroll position. `List` shows the callout's list in the read view's
list style, checkboxes `disabled`. Scale and view are session state per block (D-776); nothing reaches `ui_state_set`
or the vault. Hidden: `Mindmap layout`, `Edit node`; `MindmapMap` is `readOnly` with no `onNode`. Each zoom step writes
`perf_mark('mindmap-zoom', frame, ms)` (§11).

### 9.5 Type pages and views (FR-TYP-09 AC-37, FR-QRY-07 AC-32, FR-QRY-05 AC-30…AC-33, FR-TSK-04 AC-30, FR-QRY-09 AC-9)

`TypePage`, `TypeViews`, `ViewPanel`, `ResultsTable`, `QueryBoard` take `readOnly` from `isPhone()`:
- The header: `h1 <plural>` (app bar), the count line, and `p.phone-sort-line` with `phoneSortLine` under the tabs.
- `tablist "Views"`: chips in one row, `overflow-x: auto`; tab `data-command="views.tab:<name>"` (`views.tab:` for `All <plural>`; one registered command per tab, which selects it, D-2117); selecting stores
  `typeViews.lastTab` (`ui_state_set`) and adds no history entry. A tab state (R186) shows its text only.
- Table: no resize separators, header cells are not buttons (`th` without `role="button"`, no sort on tap); the table
  container scrolls sideways; the Title column is `position: sticky; left: 0`.
- Board: vertical lanes 300 px wide that scroll freely sideways, without snapping (D-2103); no grips, `+`,
  `New <Type>` tile, card `More actions`, card or lane drags (no drag handlers are attached). Horizontal rows keep
  `Collapse <lane>` / `Expand <lane>` (`usageFolded`, R206, `ui_state_set`); cards in `grid-template-columns:
  repeat(auto-fill, minmax(300px, 1fr))` (one column at 360, two at 915).
- Task checkboxes: `aria-disabled="true"`, `aria-description` = `phone.viewOnly`, a tap does nothing.
- Hidden: RA11's type-page row (`Type settings`, `New <Type>`, `Add view`, `View actions`, chevrons, `Filter
  <plural>…`, `Filter by tag`, the sort button, `Columns`, `Lanes`, `Restore`, `Remove from <plural> page`).
Live updates are the desktop's (`vault:changed` → re-run).

### 9.6 Queries (FR-QRY-06 AC-26…AC-28)

`QueriesPage`, `QueryPage`, `QueryBlock` with `readOnly` on the phone: RA11's controls hidden; a query page shows its
view and the view-only line; a block's header keeps the title and count; tables and lanes scroll inside the block.

### 9.7 Inbox (FR-INB-01 AC-14…AC-16, D-2057)

`InboxPage` with `readOnly`: the heading, the summary, R61's groups (`h2`), rows `li` ≥ 56 px with the type icon, the
title and one date line `Captured <date-time>` / `Created <date-time>` (D-781; never relative). Hidden: the type filter,
`Mark all reviewed`, `Triage actions`, the `Reviewed` checkboxes, selection, the key hint, `Quick Capture`. Inbox zero
keeps `Open today's note` (`daily.today`). Rows have no swipe or long-press handler.

### 9.8 Daily, tags, pinned, search, conflicts

- **Daily** (FR-DLY-01 AC-13, FR-DLY-03 AC-8): the read view of the day or the virtual day (`daily_draft`, never
  `daily_create`); `Previous day`, `Next day`, the calendar button ≥ 48 px; `Calendar` opens as
  `div[role="dialog"][aria-modal="true"]` within the viewport minus 16 px each side. Tasks-due checkboxes are
  `aria-disabled`. No review toggle.
- **Tags** (FR-TAG-07 AC-7, FR-TAG-06 AC-14): read-only; the colour tile is a `span`, not a button. Hidden: `New tag`,
  `Tag colour`, rename, delete, merge, the Type filter.
- **Pinned** (FR-HOM-02 AC-32): `PinnedSection readOnly`: rows open (`sidebar.pinned.open`), the header collapses
  (`sidebar.pinned.toggle`, machine-local); no row menu, `Unpin`, grip, drop target or long-press action; the missing
  state without `Unpin`.
- **Search** (FR-SRC-03 AC-22, FR-NAV-01 AC-24): `Search` with `noCreate`: no create buttons, the no-match body is
  `phone.search.noMatch`, no `⇧⌘F` hint. The bottom bar's `Search` focuses `Search query` (the keyboard shows); the
  field has `enterkeyhint="search"` and Enter opens the first result as ⏎ does.
- **Conflicts** (FR-SYN-04 AC-13): the list as the desktop's; opening a pair shows `Compare` stacked (one version above
  the other), read-only; no resolve action, no merge draft.

### 9.9 Empty states (FR-UX-06 AC-1)

The desktop's texts; a create or write button is never rendered on the phone (`New <Type>`, `Quick Capture`).

### 9.10 Settings (FR-SET-01 AC-14, D-2065)

- `settings`: `h1 Settings`, a list of links `Appearance` (`goto.settings/appearance`), `Date & time`
  (`goto.settings/date-time`), `Vault` (`goto.settings/vault`), `Storage access` (`goto.settings/storage`), and the
  footer `phone.settings.version` (`{version}` = the version button's label: `dev`, `v0.5.0`; CP-11).
- `settings/appearance`: `Theme` only. `settings/date-time`: the desktop's Date & time section (per machine, D-566).
- `settings/vault`: the vault's name and path (`data-user-content`), `Default type for new notes` as text (from
  `vault_settings`), and `button "Switch vault…"` (`vault.switch`, opens `Vaults`).
- `settings/storage`: `Storage access` with `phone.settings.storageOn` / `storageOff` (from `storage_access`, read on
  show and on `visibilitychange: visible`) and `button "Open settings"` (`android.openSettings` →
  `storage_access_settings`).
- No `nav "Settings sections"` of the desktop, no Shortcuts, Menu bar, Trash and history, Previews, Backups, Page
  width, outline or Sync.

## 10. The command registry on the phone (FR-UX-03 AC-54, AR-03 AC-13; D-2059)

On the phone `commands(ctx)` returns `phoneCommands(desktopList)`: the desktop list minus `PHONE_HIDDEN_COMMANDS`,
plus the phone's own commands. Every phone control carries a registered `data-command` (FR-UX-03 AC-8), except text
inputs and rows of object lists; running the command does what the tap does.

`PHONE_FRAME_COMMANDS` (new or kept, frame level): `nav.back`, `object.new` (run: nothing; `disabled()` →
`phone.newLater`), `phone.menu`, `phone.more`, `phone.properties`, `phone.sheet.close`, `note.toggleSource`,
`goto.inbox`, `goto.search`, `goto.conflicts`, `goto.settings`, `goto.settings/appearance`, `goto.settings/date-time`,
`goto.settings/vault`, `goto.settings/storage`, `daily.today`, `daily.previous`, `daily.next`, `daily.pickDate`,
`tasks.go`, `tags.go`, `queries.go`, `goto.type:<key>` (each type entry), `vault.switch`, `vault.recent.1`…`9`,
`vault.openFolder`, `vault.create`, `app.logoMenu`, `theme.system`, `theme.light`, `theme.dark`, `mindmap.showMap`,
`mindmap.showList`, `mindmap.zoomIn`, `mindmap.zoomOut`, `mindmap.fit`, `mindmap.fullScreen`,
`mindmap.closeFullScreen`, `android.openSettings`. Page controls keep their existing ids (view tabs: `views.tab:<name>`, D-2117;
`query.showMore`, `search.*` except `search.create*`, `daily.showMore`, `daily.openRow`, `sidebar.pinned.open`,
`sidebar.pinned.toggle`, board folds). `mindmap.showMap` and `mindmap.showList` are the phone's own (the control's tap;
the desktop's act on the editor, D-2127).

Controls inside a note's content (D-2128, FR-UX-03 AC-55): the edit-only ones are not rendered on the phone (a note
embed's `Display as`; a task embed's status, priority and due buttons, whose values show as text). The others carry
per-control commands, registered while their page is shown, each running its control's tap through `actions.phone(id)`:
- `read.fold:<n>`: the n-th fold button (a foldable callout or mindmap) of the shown note, from 1 in document order;
- `read.openEmbed:<n>`: every control that opens the n-th embed of the shown note (its chip, `Open <title>`);
- `board.openCard:<path>`: every control of a board task card that opens its task (the title, the card; `<path>` NFC,
  as `data-path`), and `board.openSource:<path>`: its source chip (D-2129); both exceptions inside `board.*`.

View-only task checkboxes (`aria-disabled`, on boards, table rows, task embeds) carry no `data-command` on the phone
(no `task.complete`); FR-UX-03 AC-54 and AC-55 exempt them (D-2129).

`PHONE_HIDDEN_COMMANDS` (exact ids; prefixes end in `*`): `app.palette`, `help.shortcuts`, `nav.forward`,
`view.toggleSidebar`, `view.toggleRightPanel`, `view.toggleFocus`, `note.toggleProperties`, `note.width.*`, `edit.*`,
`editor.insertQuery`, `mindmap.layoutRight`, `mindmap.layoutSpider`, `preview.*`, `link.edit`, `link.remove`,
`outline.*`, `panel.*`, `related.toggleLinked`, `graph.*`, `sidebar.pin`, `sidebar.unpin`, `sidebar.pinned.moveUp`,
`sidebar.pinned.moveDown`, `tags.new`, `tag.*`, `queries.new`, `query.edit`, `query.rename`, `query.trash`,
`query.saveAs`, `query.columns`, `views.new`, `views.menu`, `views.remove`, `views.edit`, `views.moveLeft`,
`views.moveRight`, `board.*` except folds, `sort.*`, `columns.*`, `typePage.*`, `type.*`, `task.*`, `tasks.schedule`,
`tasks.kanban`, `tasks.search`, `types.restoreDefaultViews`, `note.markReviewed`, `note.markUnreviewed`,
`daily.markReviewed`, `daily.markUnreviewed`, `note.changeType`, `note.editProperties`, `object.trash`, `media.add`,
`trash.*`, `goto.trash`, `goto.brokenLinks`, `goto.duplicateTitles`, `goto.settings/shortcuts`,
`goto.settings/menu-bar`, `goto.settings/trash-history`, `goto.settings/previews`, `settings.backups`, `job.*`,
`capture.*`, `import.open`, `inbox.*` except `inbox.open`, `duplicates.merge`, `vault.open`, `vault.addStarterTypes`,
`app.about`, and every R3 control command (`nav.newTab`, `edit.copyBlockLink`, `typeSettings.*`,
`panel.editRecurrence`, `settings.font`, `settings.fontSize`, `settings.accentColor`, `settings.changeShortcut`).

The AR-03 AC-13 L1 test: for a context on each RA9 route (Node, `__TEGG_PLATFORM__ = 'android'`), the ids contain every
frame command available there, none of `PHONE_HIDDEN_COMMANDS`, and none whose `run` reaches an `ANDROID_EXCLUDED`
command or a `PHONE_NOT_OFFERED` route. Palette keys (⌘K, Ctrl+K, ⇧⌘P) do nothing on the phone.

## 11. Strings (RA13; NFR-OTH-02 AC-24)

All in `app/ui/src/i18n/catalog.ts`; no literal in `app/ui/src/phone/`. RA13's keys with their texts, plus:
`phone.sortLineJoin` `{sort} · {viewOnly}` (CP-11); `phone.moreProperties` as a plural message
`{ one: '+{count} property', other: '+{count} properties' }`; `phone.settings.storage` doubles as the route name;
`purpose.phone.settings`, `purpose.phone.settingsStorage`; command titles `cmd.goto.settings` `Go to Settings`,
`cmd.goto.settings.storage` `Go to Settings: Storage access`, `cmd.phone.menu` `Open or close navigation`,
`cmd.phone.more` `More actions`, `cmd.phone.properties` `Show properties`, `cmd.phone.closeSheet` `Close sheet`,
`cmd.mindmap.zoomIn` `Zoom in on the mindmap`, `cmd.mindmap.zoomOut` `Zoom out of the mindmap`, `cmd.mindmap.fit`
`Fit the mindmap to the width`, `cmd.mindmap.fullScreen` `Open the mindmap full screen`, `cmd.mindmap.closeFullScreen`
`Close the full-screen mindmap`. The Czech test catalog gives `phone.moreProperties` `one`, `few`, `other` forms.

## 12. Test hooks

### 12.1 On the device

- `test-env.json` (AND-1 §7.1) gains `TEGG_IPC_LOG`: a path inside `files_dir`; the test APK's invoke handler is
  `move |invoke| { ipc_log(invoke.message.command()); handler(invoke) }`, one line `{"cmd":"<name>","ms":<since start>}`
  per call, no arguments. Under `#[cfg(all(mobile, not(feature = "preview")))]` (AR-08 AC-5).
- `TEGG_LAYOUT` (`phone` | `desktop`) in `test-env.json` sets `window.__TEGG_LAYOUT__` through `init_script` (CP-6).

### 12.2 In the page (`window.__TEGG_TEST__`, installed by `phone/native.ts` on Android at start, also on the start screens; in-memory only)

| Hook | Does |
| --- | --- |
| `insets({ top, bottom, left, right })` | `__TEGG_NATIVE__.receive('window', { insets })`: the same path as the plugin's push |
| `keyboard(shown: boolean)` | `receive('window', { keyboard: shown })`; the test resizes the viewport itself (412 × 520) |
| `systemBack(): 'handled' \| 'background'` | runs `__TEGG_NATIVE__.back()`; `'background'` where the plugin would move the task to the back |
| `systemDark(dark: boolean \| null)` | `receive('window', { systemDark: dark })` |
| `run(id: string): Promise<void>` | runs the registered command `id` through the registry, as a phone control does (D-2101); rejects for an id the phone doesn't list |
| `readView` (existing, D-215) | read on the desktop layout to compare Bloky's body with the phone's |

`window.__TEGG_LAYOUT__` set before the app's scripts forces a layout (§4.1).

### 12.3 Perf marks (NFR-PERF-05 AC-6, FR-MMP-02 AC-36; CP-12)

On Android `note-ready`, `route-ready:<route>` and the new `nav-start:<route>` are written on every occurrence
(`repeatable_ui_mark` under `cfg(mobile)`); a duration is the ready mark's `ms` minus the latest `nav-start`'s. The type
page's mark is the existing `route-ready:type/page`. `mindmap-zoom` uses the `frame`/`ms` form: `frame` = the step's
index in the session, `ms` = from the tap to the next painted frame.

## 13. Builds and tools

### 13.1 Test APK

Unchanged (`npm run app:android-test`); its `MainActivity` and plugin are the product's.

### 13.2 L5p projects (D-2009, D-2082)

`app/playwright.config.ts`:

```ts
const PHONE = /(^|\/)(phone_[^/]+\.ac\.test\.ts|bug_[^/]+_phone\.test\.ts)$/;
const phone = { viewport: { width: 412, height: 915 }, deviceScaleFactor: 2.625, isMobile: true, hasTouch: true };
projects: [
  { name: 'webkit', testIgnore: PHONE, use: { ...devices['Desktop Safari'], viewport: { width: 1440, height: 900 } } },
  { name: 'phone-webkit', testMatch: PHONE, use: { browserName: 'webkit', ...phone } },
  { name: 'phone-chromium', testMatch: PHONE, use: { browserName: 'chromium', ...phone } },
]
```

Tests switch to 360 × 800 or 915 × 412 with `page.setViewportSize`. Pinch tests use CDP `Input.dispatchTouchEvent`
and `test.skip(browserName !== 'chromium')` for that part only. Phone regressions are `bug_<issue>_<req-id>_…_phone.test.ts`
(CP-15). The `app-webkit` step runs all three projects (Playwright's Chromium is installed with WebKit); its inputs are
unchanged.

### 13.3 The emulator (D-2082)

`tools/android/avd.sh up` creates `tegg-and-35` with `-d pixel_7` (1080 × 2400, 420 dpi: CSS 411 × 914 at 2.625) and
recreates it when its `config.ini` has another `hw.device.name`; after boot it enables gesture navigation
(`cmd overlay enable com.android.internal.systemui.navbar.gestural`) and turns off auto-rotate
(`settings put system accelerometer_rotation 0`).

## 14. The harnesses

### 14.1 L5p (`app/webkit/phone-helpers.ts`)

`startPhone(page, o)`: AND-1's `startAndroid` with `__TEGG_LAYOUT__` unset (so `'android'` gives the phone), then
`__TEGG_TEST__.insets({ top: 36, bottom: 24, left: 0, right: 0 })` unless `o.insets === null`. The fake core answers on
Android, besides AND-1's four: `android_window` → `{ insets: <last injected>, keyboard: false, systemDark: <the page's
prefers-color-scheme>, fontScale: 1 }` (read-only); `android_open_url` → records the URL when `open_url_allowed`'s table
accepts it, else rejects `{ kind: 'Unsupported' }` (exposed as `openedUrls()`). Helpers: `keyboard(page, shown)`,
`systemBack(page)`, `bottomBar(page)`, `appBar(page)`, `drawer(page)`, `openDrawer(page)`, `sheet(page, name)`,
`touchDrag(page, from, dx, dy)` (CDP touch on Chromium, `page.touchscreen`-based pointer events on WebKit),
`pinch(page, centre, from, to)` (Chromium), `hitArea(locator)`, `writesSeen(core)` (§2.3), `fileStateOf(core)`.

### 14.2 LA (`app/e2e-android/helpers/phone.ts`, on top of AND-1's `device.ts`)

`rotate(quarterTurns)` (`settings put system user_rotation`), `nightMode(on)` (`cmd uimode night yes|no`),
`fontScale(x)`, `systemFrames()` (status bar, navigation bar, cutout and IME frames from `dumpsys window`, device px),
`imeShown()` (`dumpsys input_method` `mInputShown`), `barAppearance()` (`APPEARANCE_LIGHT_STATUS_BARS` /
`_NAVIGATION_BARS` from `dumpsys window`), `webViewRect()` (from `uiautomator dump`), `pixel(x, y)` (`screencap -p`),
`tap(x, y)`, `swipe(x1, y1, x2, y2, ms)`, `edgeBack()` (`input swipe 1 <h/2> 400 <h/2>`), `logcatSince(mark, filter)`,
`ipcLog(id)` (§12.1), `actionModeShown()` (a floating toolbar or `ActionMode` window in `dumpsys window`). Real-app test
files: `android_phone.ac.test.ts`, `android_phone_sync.ac.test.ts`, `nightly_android_phone.ac.test.ts` (ACs' list).

## 15. Points for the owner (CP-1…CP-16 → D-2083…D-2098, accepted as proposed)

| CP | Point | Proposal | Alternative | Affects |
| --- | --- | --- | --- | --- |
| CP-1 | **Insets and the keyboard: native padding or CSS variables.** The activity is edge to edge; Chromium's `env(safe-area-inset-*)` isn't reliable in the WebView. FR-UX-04 AC-3 wants the theme's colour under the status bar. | System bars as CSS variables from the plugin (the page draws under them); the keyboard by native bottom padding of the content view, so the WebView ends at the keyboard (§5.1, §8.1). | All native padding, with the plugin painting the bars in the theme's colour; or `env()` only | §5.1, §8.1, FR-UX-04 AC-3, AC-4 |
| CP-2 | **How the plugin tells the page.** Tauri's `addPluginListener` needs the plugin's `register_listener` permission in `android.json`, which AND-1 fixed to `ANDROID`'s commands. | `evaluateJavascript` into `window.__TEGG_NATIVE__` (defined by `init_script`), plus a pull through `android_window` at start (§6). | Plugin listeners with a capability change | §5, §6 |
| CP-3 | **System Back.** Tauri's `onBackButtonPress` takes over Back but has no "move to background"; `exit` finishes the activity. | The plugin's own `OnBackPressedCallback` asks the page; `false` → `moveTaskToBack(true)` (§5.3). | `onBackButtonPress` plus an Android-only command `android_move_to_back` | §5.3, §8.5, FR-NAV-03 AC-17 |
| CP-4 | **A second new command.** The status-bar icons must follow the chosen theme, which only the page knows (FR-SET-02 AC-12). | `android_window { dark } → WindowStateDto` (§2.2); RA2 and AR-03 AC-9's test gain it with `android_open_url`, under the same `AC-Test-Change`. | Bars follow the system's night mode only (fails AC-12's Light-in-night case) | §2, FR-SET-02 AC-12 |
| CP-5 | **Where the task-views migration is stopped (D-2062).** | The shell calls it only on the desktop, and the core answers `TaskViewsMigration::Off` with `bulk_jobs: false` (L4-testable, §3). | A new `OpenExtras { task_views }` field | §3, FR-SYN-06 AC-52 |
| CP-6 | **AND-1's tests meet the phone layout.** AND-1's L5 tests run `'android'` at 1440 × 900 and expect the desktop frame (sidebar, palette, `Title`, the `alert`); its LA tests wait for `nav[aria-label="Sidebar"]` as "the vault is open" and read the version there. D-2070 gives Android the phone layout. | One `AC-Test-Change`: AND-1's L5 tests set `__TEGG_LAYOUT__ = 'desktop'` (they test the client and the start flow); its LA tests use `nav[aria-label="Main"]` as "the vault is open" and read the version button in the drawer (FR-UX-01 AC-8). | Rewrite AND-1's L5 tests for the phone frame as well | `app/webkit/android_shell.ac.test.ts`, `app/e2e-android/android_shell.ac.test.ts`, `android_watcher.ac.test.ts` |
| CP-7 | **The drawer and the bottom bar.** FR-NAV-04 AC-14 has the page `inert` behind the drawer and also "`Menu` again" closing it. | The drawer and scrim cover the bottom bar; "`Menu` again" is a tap where `Menu` is, which lands on the scrim and closes; the command `phone.menu` toggles (§8.3). | The bottom bar stays above the scrim and active while the drawer is open | §8.3, FR-NAV-04 AC-14, FR-UX-08 AC-26 |
| CP-8 | **The drawer's first focus.** "its first entry": the vault switcher is first in RA10, but RA10 calls the rows below it "Entries". | Focus on `Inbox`. | The vault switcher | §8.3, FR-NAV-04 AC-14 |
| CP-9 | **Routes RA9 doesn't list.** `broken-links` and `duplicate-titles` are palette-only desktop routes (D-284) and appear in neither RA9 list. | Not offered on the phone (`PHONE_NOT_OFFERED`). | Offered read-only, reached from nowhere | §7, AR-03 AC-13 |
| CP-10 | **`More actions` on daily routes.** RA8 says "note pages only"; a day with a file is a note in the read view. | Shown on `note/<path>` and on a daily route with a file; not on a virtual day. | `note/<path>` only | §8.2, §9.1 |
| CP-11 | **Small string choices.** RA13 joins the sort line and the view-only note with a literal ` · `; `Tegg {version} · Android` doesn't say which version text. | A catalog key `phone.sortLineJoin` `{sort} · {viewOnly}`; `{version}` is the version button's label (`dev`, `v0.5.0`). | Literal separator in code; the bare `0.5.0` | §4.3, §9.10, §11 |
| CP-12 | **Repeated reading marks.** `note-ready` and `route-ready:*` are written once per process; AC-6 wants p95 over 20 opens. AC-6 also names `route-ready:type`, while the existing mark is `route-ready:type/page`. | On Android they repeat, with a new `nav-start:<route>` mark for durations; the type mark keeps its name `route-ready:type/page`. | 20 cold starts; or rename the mark | §12.3, NFR-PERF-05 AC-6 |
| CP-13 | **A client-side write guard.** | None: phone controls that write are hidden or disabled, and tests see any attempt in the fake core / IPC log. | The client refuses `WRITE_COMMANDS` on the phone layout (hides attempts from the tests) | §2.3 |
| CP-14 | **What the Properties sheet shows.** FR-EDT-07 AC-22 compares with "the attribute panel", whose read-only mode (`editable: false`) shows raw text without chips, while AC-22 taps a relation chip. | Rows and order from `panelRows`; values rendered by the read view's `PropertyRows` cells (chips); the test compares labels, order and visible value text with the desktop panel (§9.2). | `AttributePanel` with `editable: false` (no chips) | §4.5, §9.2 |
| CP-15 | **Phone regressions in Playwright.** | `bug_<issue>_<req-id>_…_phone.test.ts` run in the two phone projects only (§13.2). | A `phone/` subfolder | §13.2 |
| CP-16 | **The system font size.** `font_scale` isn't in `configChanges`, so a change would recreate the activity and its WebView (Tauri doesn't restore one), and the WebView's text zoom doesn't follow it by itself. | `configChanges` gains `fontScale\|density`; the plugin sets `textZoom` from `fontScale` (§5.4, §5.6). | Let the activity restart (the app reloads) | §5.4, §5.6, FR-UX-08 AC-27 |

## 16. Notes on the ACs (readings, not decisions)

- RA8 writes `layoutFor({ platform, width })`, AP-2052 `layoutFor(platform, width)`: the object form (§4.1).
- "Root element" (RA8) is `<html>` (§8.1); `figure[data-layout]` of FR-MMP-02 AC-32 is the map's own attribute.
- FR-UX-04 AC-4 (L5p) "`__TEGG_TEST__.keyboard(true)`" sets only the state; the viewport resize is the test's.
- FR-NAV-03 AC-18's "`nav_swipe_scroll` answers `false`" holds on the device; on the phone layout the page never asks
  and never installs the swipe (§8.5), so the L5p test checks no navigation rather than the answer.
- FR-INB-01 AC-14's "Back returns … with the focus on that row" relies on FR-NAV-03's focus restore, unchanged.
