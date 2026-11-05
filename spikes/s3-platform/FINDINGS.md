# Spike S3 Findings: Tauri Platform (menu bar, global hotkeys, capture window, DMG)

**Date:** 2026-10-10 · **Branch:** `spike/s3-platform` · **Stack:** Tauri 2.x (D-19), `tauri-plugin-global-shortcut` 2, macOS 26, arm64

## Verdict: GO on the platform; only the signed DMG (AC-5) waits for a Developer ID

**Update 2026-10-11:** the Appium `mac2` suite ran on the built app (Xcode 27, mac2 driver 4.3.6): **7 / 7 pass**, covering AC-1 to AC-4. Results: `results/s3-capture-timing.json`, `results/s3-network.json` (machine-local).

Tauri 2 does what Quick Capture needs: a menu bar icon, two global hotkeys and a capture window that work with the main window closed, well under the 300 ms target. The S3-QA exit criteria aren't all met yet. Two of the blockers are setup on the owner's side, not technical problems:

| Check (S3-QA, `docs/acceptance/qa-infrastructure.md`) | Result |
| --- | --- |
| AC-1: capture through ⌃⌥Space, ⌃⌥T and the menu bar icon, main window closed; file appears | **Pass (Appium, 2026-10-11):** main window closed, app keeps running; both hotkeys and the menu bar icon create the file with the right type and `review: unreviewed`. Earlier: **shown manually** (hotkeys posted by System Events from another app → typed → ⌘↩ → file in `Quick Notes/` and `Tasks/` with `review: unreviewed`, `captured:`). **Appium run pending**: `e2e-appium/s3_qa.test.ts` is written and typechecks; Appium `mac2` needs full Xcode, which isn't installed |
| AC-2: interaction inside the WKWebView, read back | **Pass (Appium, 2026-10-11).** The suite clicks Save on an empty field, reads the `role=status` text back, then enters Czech text and reads the field value back |
| AC-3: open time over ≥ 20 runs, p95 | **Pass (Appium, 20 runs per hotkey, 2026-10-11): internal p95 72 ms (⌃⌥Space) and 68 ms (⌃⌥T)**, target 300 ms. External upper bound (osascript + WebDriver round trips included) p95 442 / 611 ms: it measures the automation, not the app. Earlier: **2 manual runs: 47 ms and 39 ms** (hotkey handler → field focused + 2 frames painted). The 20-run p95, plus an external accessibility-based upper bound, is in the suite |
| AC-4: `lsof` shows no non-IPC sockets | **Pass (Appium, 2026-10-11): 0 internet sockets** across 5 watched processes for the whole suite. Earlier: **0 internet sockets** in a manual check while hotkey captures were saved. The suite watches throughout the run (`netmon.ts`) |
| AC-5: [manual] signed and notarized DMG installs on the second Mac | **Pending a Developer ID certificate.** The DMG builds, ad-hoc signed with hardened runtime and no entitlements (Gatekeeper rejects it, as expected). `scripts/sign-notarize.sh` does sign → notarize → staple → `spctl` once the owner has the certificate |

Other numbers: `.app` 6.0 MB, DMG 2.3 MB. Idle memory: app process 106 MB RSS plus WebKit helpers (GPU, Networking, 2× WebContent) 103 MB, with two webviews (main + capture).

## How it works

- **Pre-warmed capture window** (FR-CAP-03): the `capture` window and its page are created hidden at startup. A trigger emits `capture:open`, then centers, shows and focuses the window. The page resets the form, focuses the field, waits two animation frames and reports `capture_ready`. The Rust side logs trigger → ready to `~/Library/Application Support/Tegg/spike-s3/capture-timings.jsonl` (machine-local, FR-STO-07).
- **Closing hides** every window; the app keeps running in the menu bar. A Dock click reopens the main window.
- **Menu bar**: left click opens a Quick Note capture straight away (FR-CAP-01); right click shows Quick Capture / New Task / Open / Quit.
- **Writes** (`src-tauri/src/vault.rs`, std + libc only, AR-03): temp file in the target folder, `fsync`, then **`renamex_np(…, RENAME_EXCL)`**: an atomic rename that fails instead of replacing an existing file. A taken name gets ` (2)`, ` (3)` … (FR-SYN-02, FR-LNK-14, NFR-REL-02). Other platforms use a hard link + unlink, which also fails on an existing name.
- **No network** (NFR-SEC-01): no HTTP plugin, CSP allows only `self` and IPC, empty entitlements.

## What the spike found

| # | Finding | Consequence |
| --- | --- | --- |
| P1 | **Synthesized keystrokes can't type diacritics.** `System Events keystroke "mléko čaj"` arrived as `mlako aaj`. This is the automation layer, not the app | Real-app tests enter non-ASCII text through the pasteboard (⌘V). Czech typing tests stay at the Playwright layer (L5) or are typed by a human |
| P2 | **WebKit's helper processes belong to launchd**, not the app, so the process tree can't attribute their sockets without root | `netmon.ts` takes a snapshot of WebKit helpers before launch and counts new ones as the app's. Run the suite with no other WebKit apps starting at the same time. Note this on test-strategy L6 / AC-4 |
| P3 | **Atomic no-clobber create** is a single syscall on macOS (`RENAME_EXCL`) | Proposed for the product core's "create" path. "Replace" (editing an existing note) still uses plain rename after the external-change check |
| P4 | **Two copies of the app can run at once** (the owner's `/Applications` copy and the build ran side by side); only one gets the hotkeys | Product needs a single-instance guard. **AP-14** |
| P5 | A hotkey already owned by another app fails at registration; the spike only logs it | Must be shown in Settings (FR-SET-04). **AP-14** |
| P6 | **Obsidian can't link to file names with `# ^ [ ] \|`**; D-52 doesn't replace `#^[]` | **AP-11** (spike follows D-52 as written) |
| P7 | FR-CAP-01's "Enter saves" conflicts with a multi-line Markdown field | Spike: ⌘↩ saves, Enter = new line. **AP-12** |
| P8 | `captured`, `due` (and the other Task keys) aren't defined in the reserved keys or the dialect | Written provisionally. **AP-13** |
| P10 | **Three test-side bugs found on the first real run** (the app was right each time): WebKit exposes `aria-label` as an element's text, so the status message must be read from its value or its static-text child; a synthetic ⌘V goes to whatever has focus (a button after clicking Save), so the field is clicked first; `pbcopy` needs `LANG=en_US.UTF-8` or it mangles diacritics | Fixed in `e2e-appium/s3_qa.test.ts`. Rule for L6 tests: read accessibility values, not labels; focus explicitly before pasting |
| P11 | Automation Mode asks for the user's password when WebDriverAgent starts (`appium driver doctor mac2`) | Fine for owner-started runs. An unattended nightly L6 run needs `automationmodetool enable-automationmode-without-authentication`, a security setting the owner decides on |
| P9 | Tauri 3 is in alpha (crates.io `3.0.0-alpha.4`) | Stay on Tauri 2 (D-19); review at MS8 |

## Not covered (deliberately)

- **Share sheet extension (FR-CAP-02)**: not part of S3's exit criteria. It needs an App Extension target (Xcode project, App Group, R-05), which Tauri doesn't generate. Plan it as its own small spike before MS5.
- Cold start (NFR-PERF-01): an S4 / MS2 measurement.
- Configurable hotkeys, type selector, tags and drop zone in the capture window: product work in MS5.

## How to finish the exit criteria (owner)

1. Install Xcode, then run `sudo xcode-select -s /Applications/Xcode.app` once.
2. `cd spikes/s3-platform && npm run app:build`, then `cd e2e-appium && npm install && npm run setup`.
3. Give the terminal **Accessibility** and **Automation → System Events** permission (System Settings → Privacy & Security); WebDriverAgentMac needs Accessibility too.
4. Quit any other copy of Tegg S3, then `npm test`. Results go to `results/s3-capture-timing.json` and `results/s3-network.json`.
5. For AC-5: install a Developer ID Application certificate and run `xcrun notarytool store-credentials tegg-notary …` once, then `scripts/sign-notarize.sh "Developer ID Application: … (TEAMID)"`, and install the DMG on the second Mac.

## Commands

- `npm run app:build`: `.app` + DMG in `src-tauri/target/release/bundle/`
- `npm run app:dev`: dev build with Vite on :5175
- `npm run test:rust`: vault write tests (`fr_cap_04_*`, `fr_fmt_08/11/12_*`, `fr_lnk_14_*`, `fr_syn_02_*`)
- `node e2e-appium/netmon.ts`: standalone network monitor (start it before launching the app, Ctrl-C prints the report)
- Spike vault: `$TEGG_S3_VAULT`, default `$TMPDIR/tegg-s3-vault` (synthetic, D-62)

## Spike code removed (D-1366)

The spike's code was removed from the repository on 2026-11-04; only this report stays. The last commit with the code is `75b3382` (`git show 75b3382:spikes/<name>/…`). The commands above refer to that commit.


`scripts/sign-notarize.sh` moved to `app/scripts/sign-notarize.sh` (D-1367).
