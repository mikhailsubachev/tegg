//! Spike S4: Rust index for a Tegg vault. SQLite + FTS5 as a disposable cache of the files
//! (AR-01), updated incrementally from a file watcher. Throwaway code; see FINDINGS.md.

pub mod extract;
pub mod index;
pub mod switcher;
pub mod watch;
