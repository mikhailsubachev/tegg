//! File watcher → incremental index updates (NFR-PERF-08, FR-SYN-03).
//!
//! `notify` (FSEvents on macOS) reports paths; we don't trust event kinds (sync clients produce
//! odd sequences: temp file + rename, delete + create, coalesced events), only paths. For each
//! path the file system is the truth: exists → re-index, gone → remove (AR-01).

use std::collections::BTreeSet;
use std::path::PathBuf;
use std::sync::mpsc::{channel, Receiver, RecvTimeoutError, Sender};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use notify::{RecursiveMode, Watcher as _};

use crate::index::{is_note, Index, Result};

/// One batch of applied changes, for UI refresh and for latency measurements.
#[derive(Debug, Clone)]
pub struct Applied {
    pub paths: Vec<PathBuf>,
    pub first_event: Instant,
    pub done: Instant,
}

pub struct Watching {
    _watcher: notify::RecommendedWatcher,
    stop: Sender<()>,
    thread: Option<JoinHandle<()>>,
}

impl Drop for Watching {
    fn drop(&mut self) {
        let _ = self.stop.send(());
        if let Some(t) = self.thread.take() {
            let _ = t.join();
        }
    }
}

/// Coalescing window: events arriving within this time of each other are applied together.
pub const SETTLE: Duration = Duration::from_millis(30);

pub fn watch(index: Arc<Mutex<Index>>, on_applied: Sender<Applied>) -> Result<Watching> {
    let vault = index.lock().unwrap().vault.canonicalize()?;
    let (tx, rx) = channel::<notify::Result<notify::Event>>();
    let mut watcher = notify::recommended_watcher(tx)?;
    watcher.watch(&vault, RecursiveMode::Recursive)?;
    let (stop_tx, stop_rx) = channel::<()>();
    let thread = std::thread::spawn(move || run(index, vault, rx, stop_rx, on_applied));
    Ok(Watching { _watcher: watcher, stop: stop_tx, thread: Some(thread) })
}

fn run(
    index: Arc<Mutex<Index>>,
    vault: PathBuf,
    rx: Receiver<notify::Result<notify::Event>>,
    stop: Receiver<()>,
    on_applied: Sender<Applied>,
) {
    loop {
        if stop.try_recv().is_ok() {
            return;
        }
        let first = match rx.recv_timeout(Duration::from_millis(100)) {
            Ok(ev) => ev,
            Err(RecvTimeoutError::Timeout) => continue,
            Err(RecvTimeoutError::Disconnected) => return,
        };
        let first_event = Instant::now();
        let mut paths = BTreeSet::new();
        let mut rescan = false;
        let mut add = |ev: notify::Result<notify::Event>| match ev {
            // FSEvents dropped events (MustScanSubDirs) or the watcher failed: trust nothing.
            Ok(ev) if ev.need_rescan() => rescan = true,
            Ok(ev) => paths.extend(ev.paths),
            Err(_) => rescan = true,
        };
        add(first);
        while let Ok(ev) = rx.recv_timeout(SETTLE) {
            add(ev);
        }
        let mut ix = index.lock().unwrap();
        if rescan {
            if let Err(e) = ix.sync() {
                eprintln!("[s4] rescan failed: {e}");
            }
        }
        // FSEvents reports /private/var/… for /var/…; map back to the index's vault path.
        let ix_vault = ix.vault.clone();
        let mut applied = Vec::new();
        for p in paths {
            let Ok(r) = p.strip_prefix(&vault) else { continue };
            let abs = ix_vault.join(r);
            let res = if abs.is_dir() {
                ix.update_path(&abs)
            } else if abs.exists() || is_note(&ix_vault, &abs) {
                ix.update_path(&abs)
            } else {
                // A vanished non-.md path may be a folder renamed away.
                ix.remove_prefix(&abs)
            };
            if let Err(e) = res {
                eprintln!("[s4] index update failed for {}: {e}", abs.display());
            }
            applied.push(abs);
        }
        drop(ix);
        let _ = on_applied.send(Applied { paths: applied, first_event, done: Instant::now() });
    }
}
