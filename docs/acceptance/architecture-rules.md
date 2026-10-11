# Acceptance Criteria: Architecture Rules

See [README](README.md) for conventions. The rules come from BRD §8.2 and `docs/architecture.md`; most are enforced as L0 static checks (`docs/test-strategy.md` TS-L0), so they hold for every change, not only when they are first built.

---

### AR-03 Core, UI and platform are separate

- **AC-1** An L0 check reads the Cargo dependency graph: no crate under `crates/` depends, directly or transitively, on `tauri`, `tauri-*`, `objc2*`/`cocoa`/AppKit bindings, or on `app/src-tauri`. Adding such a dependency fails `./verify commit`.
- **AC-2** An L0 check reads the TypeScript imports: nothing under `packages/` imports `@tauri-apps/*`, `app/`, or DOM-only window APIs beyond what a Web Worker provides; in `app/ui`, only the single IPC client module imports `@tauri-apps/api`.
- **AC-3** The core crates build for iOS: `cargo check --target aarch64-apple-ios` on every crate under `crates/` passes (nightly gate), so the core stays reusable on mobile (D-02).
- **AC-4** The core's tests run without the desktop shell or a webview: `cargo test` in `crates/` and the `packages/` test suites run headless (L1–L4), and no core test starts the app.
- **AC-5** The menu bar, global hotkeys, windows and share extension live only in `app/src-tauri` (platform); a menu-bar or hotkey symbol referenced from `crates/` or `packages/` fails the AC-1/AC-2 checks.

### AR-04 Sync adapter interface

- **AC-1** All vault file access in the core goes through the `VaultFs` trait in `tegg-vault` (list, read, write, create, delete, watch). An L0 check fails on `std::fs`, `tokio::fs` or `notify` use in `crates/` outside the local-folder implementation of `VaultFs`.
- **AC-2** An in-memory `VaultFs` implementation exists for tests, and the L4 integration suite for writes, external changes, renames and bulk jobs passes against both it and the local-folder implementation with identical results.
- **AC-3** A `SyncAdapter` trait exists with a folder-sync implementation that does nothing beyond the watcher (Phase 1, FR-SYN-01). A test adapter that injects remote changes (create, modify, delete, conflict) through the trait drives index and conflict detection with no change to `tegg-index`, `tegg-jobs` or the editor (FR-SYN-20 plugs in later the same way).
- **AC-4** Conflict rules are the same whatever the source of a change: the sync-simulator scenarios of FR-SYN-03/-04/-05 give the same outcomes whether the change arrives through the watcher or through the test adapter.
