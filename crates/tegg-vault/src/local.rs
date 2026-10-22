//! The local-folder `VaultFs` and the only code in Tegg that writes files (FR-SYN-02 AC-1).
//! Every write goes to `.<name>.tegg-tmp` in the same folder, is flushed, then renamed over the
//! target; creates use `RENAME_EXCL`, so an existing file is never replaced (ported from spike S3).

use std::fs;
use std::io::{self, Write};
use std::path::{Path, PathBuf};

use crate::{version_of, ChangeSink, FileVersion, FsChange, FsEntry, VaultFs, WatchGuard};

/// Test hook (ms5-tasks §11.6, FR-CNV-03 AC-7): called with the vault path after a replacing write's temp file is
/// written and before the rename. Only the app's test build installs it (`TEGG_TEST=1`); it may block forever.
pub static BEFORE_RENAME: std::sync::OnceLock<Box<dyn Fn(&str) + Send + Sync>> = std::sync::OnceLock::new();

pub struct LocalFs {
    root: PathBuf,
}

impl LocalFs {
    pub fn new(root: &Path) -> LocalFs {
        LocalFs { root: root.to_path_buf() }
    }

    fn abs(&self, path: &str) -> PathBuf {
        self.root.join(path)
    }

    fn version_at(&self, abs: &Path, bytes: &[u8]) -> io::Result<FileVersion> {
        Ok(version_of(bytes, mtime_ns(&fs::metadata(abs)?)))
    }

    /// Writes `bytes` to the temporary file next to `abs` and flushes it; returns its path.
    fn write_temp(abs: &Path, bytes: &[u8]) -> io::Result<PathBuf> {
        let name = abs.file_name().ok_or_else(|| io::Error::other("no file name"))?.to_string_lossy();
        let tmp = abs.with_file_name(format!(".{name}.tegg-tmp")); // FR-SYN-02 AC-2
        // Fixed name + truncate is safe only because Vault serializes writes and the app is single-instance
        // (D-71); don't remove Vault's lock without changing this.
        let mut f = fs::OpenOptions::new().write(true).create(true).truncate(true).open(&tmp)?;
        if let Err(e) = f.write_all(bytes).and_then(|_| f.sync_all()) {
            drop(f);
            let _ = fs::remove_file(&tmp); // never leave a partial temp file behind (e.g. disk full)
            return Err(e);
        }
        Ok(tmp)
    }

    fn sync_dir(abs: &Path) {
        if let Some(dir) = abs.parent() {
            if let Ok(d) = fs::File::open(dir) {
                let _ = d.sync_all(); // make the rename durable; best effort
            }
        }
    }
}

pub(crate) fn mtime_ns(md: &fs::Metadata) -> i128 {
    use std::os::unix::fs::MetadataExt;
    md.mtime() as i128 * 1_000_000_000 + md.mtime_nsec() as i128
}

impl VaultFs for LocalFs {
    fn list(&self) -> io::Result<Vec<FsEntry>> {
        fn walk(root: &Path, dir: &Path, out: &mut Vec<FsEntry>) -> io::Result<()> {
            for e in fs::read_dir(dir)? {
                let e = e?;
                let p = e.path();
                let rel = tegg_format::nfc(&p.strip_prefix(root).expect("under root").to_string_lossy());
                if e.file_type()?.is_dir() {
                    out.push(FsEntry::Dir { path: rel });
                    walk(root, &p, out)?;
                } else {
                    out.push(FsEntry::File { path: rel });
                }
            }
            Ok(())
        }
        let mut out = Vec::new();
        walk(&self.root, &self.root, &mut out)?;
        Ok(out)
    }

    fn read(&self, path: &str) -> io::Result<(Vec<u8>, FileVersion)> {
        let abs = self.abs(path);
        let bytes = fs::read(&abs)?;
        let v = self.version_at(&abs, &bytes)?;
        Ok((bytes, v))
    }

    fn version(&self, path: &str) -> io::Result<Option<FileVersion>> {
        match self.read(path) {
            Ok((_, v)) => Ok(Some(v)),
            Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(None),
            Err(e) => Err(e),
        }
    }

    fn replace(&self, path: &str, bytes: &[u8]) -> io::Result<FileVersion> {
        let abs = self.abs(path);
        let tmp = Self::write_temp(&abs, bytes)?;
        if let Some(hook) = BEFORE_RENAME.get() {
            hook(path);
        }
        if let Err(e) = fs::rename(&tmp, &abs) {
            let _ = fs::remove_file(&tmp);
            return Err(e);
        }
        Self::sync_dir(&abs);
        self.version_at(&abs, bytes)
    }

    fn create_new(&self, path: &str, bytes: &[u8]) -> io::Result<FileVersion> {
        let abs = self.abs(path);
        let tmp = Self::write_temp(&abs, bytes)?;
        if let Err(e) = rename_no_clobber(&tmp, &abs) {
            let _ = fs::remove_file(&tmp);
            return Err(e);
        }
        Self::sync_dir(&abs);
        self.version_at(&abs, bytes)
    }

    fn rename_no_replace(&self, from: &str, to: &str) -> io::Result<()> {
        let to_abs = self.abs(to);
        rename_no_clobber(&self.abs(from), &to_abs)?;
        Self::sync_dir(&to_abs);
        Ok(())
    }

    /// APFS is case-insensitive: renaming a file to another spelling of its own name is a plain rename of that file.
    fn rename_case(&self, from: &str, to: &str) -> io::Result<()> {
        let (f, t) = (self.abs(from), self.abs(to));
        use std::os::unix::fs::MetadataExt;
        let ino = fs::metadata(&f)?.ino();
        if fs::metadata(&t).map(|m| m.ino()).unwrap_or(ino) != ino {
            return Err(io::Error::new(io::ErrorKind::AlreadyExists, to.to_string()));
        }
        fs::rename(&f, &t)?;
        Self::sync_dir(&t);
        Ok(())
    }

    fn create_dir_all(&self, path: &str) -> io::Result<()> {
        fs::create_dir_all(self.abs(path))
    }

    fn remove_file(&self, path: &str) -> io::Result<()> {
        fs::remove_file(self.abs(path))
    }

    /// ms6-trash-media §1.1: `st_ctime` (a rename sets it on APFS).
    fn changed_ns(&self, path: &str) -> io::Result<Option<i128>> {
        use std::os::unix::fs::MetadataExt;
        match fs::symlink_metadata(self.abs(path)) {
            Ok(md) => Ok(Some(md.ctime() as i128 * 1_000_000_000 + md.ctime_nsec() as i128)),
            Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(None),
            Err(e) => Err(e),
        }
    }

    fn stat(&self, path: &str) -> io::Result<Option<(i128, u64)>> {
        match fs::metadata(self.abs(path)) {
            Ok(md) if md.is_dir() => Err(io::Error::other(format!("{path}: is a directory"))),
            Ok(md) => Ok(Some((mtime_ns(&md), md.len()))),
            Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(None),
            Err(e) => Err(e),
        }
    }

    fn is_placeholder(&self, path: &str) -> io::Result<bool> {
        is_dataless(&fs::symlink_metadata(self.abs(path))?)
    }

    /// FSEvents through `notify` (spike S4): every reported path, made vault-relative and NFC.
    fn watch(&self, sink: ChangeSink) -> io::Result<Option<WatchGuard>> {
        use notify::{RecursiveMode, Watcher};
        let root = self.root.canonicalize()?;
        let base = root.clone();
        let mut w = notify::recommended_watcher(move |res: notify::Result<notify::Event>| match res {
            Ok(ev) if ev.need_rescan() => sink(FsChange::Rescan),
            Ok(ev) => {
                let paths: Vec<String> = ev
                    .paths
                    .iter()
                    .filter_map(|p| p.strip_prefix(&base).ok())
                    .map(|r| tegg_format::nfc(&r.to_string_lossy()))
                    .filter(|r| !r.is_empty())
                    .collect();
                if !paths.is_empty() {
                    sink(FsChange::Paths(paths));
                }
            }
            Err(_) => sink(FsChange::Rescan),
        })
        .map_err(io::Error::other)?;
        w.watch(&root, RecursiveMode::Recursive).map_err(io::Error::other)?;
        Ok(Some(Box::new(w)))
    }
}

/// D-112: APFS marks files whose content is only in the cloud with `SF_DATALESS`.
#[cfg(target_os = "macos")]
fn is_dataless(md: &fs::Metadata) -> io::Result<bool> {
    use std::os::macos::fs::MetadataExt;
    const SF_DATALESS: u32 = 0x4000_0000;
    Ok(md.st_flags() & SF_DATALESS != 0)
}

/// Portable fallback: no dataless files elsewhere.
#[cfg(not(target_os = "macos"))]
fn is_dataless(_md: &fs::Metadata) -> io::Result<bool> {
    Ok(false)
}

/// Atomic rename that fails with `AlreadyExists` instead of replacing the target (FR-SYN-02, NFR-REL-02).
#[cfg(target_os = "macos")]
fn rename_no_clobber(from: &Path, to: &Path) -> io::Result<()> {
    use std::ffi::CString;
    use std::os::unix::ffi::OsStrExt;
    let a = CString::new(from.as_os_str().as_bytes())?;
    let b = CString::new(to.as_os_str().as_bytes())?;
    // SAFETY: both are valid NUL-terminated paths for the duration of the call.
    let r = unsafe { libc::renamex_np(a.as_ptr(), b.as_ptr(), libc::RENAME_EXCL) };
    if r == 0 { Ok(()) } else { Err(io::Error::last_os_error()) }
}

/// Portable fallback: a hard link fails if the target exists; then drop the old name.
#[cfg(not(target_os = "macos"))]
fn rename_no_clobber(from: &Path, to: &Path) -> io::Result<()> {
    fs::hard_link(from, to)?;
    fs::remove_file(from)
}

// ---------------------------------------------------------------- Application Support (FR-STO-07)

/// Machine-local files outside the vault (e.g. the remembered vault path). Atomic like vault writes.
/// Used by the index and recency store too, so no other crate touches the file system (AR-04 AC-1).
pub fn write_local_file(path: &Path, bytes: &[u8]) -> io::Result<()> {
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir)?;
    }
    let tmp = LocalFs::write_temp(path, bytes)?;
    fs::rename(&tmp, path).inspect_err(|_| {
        let _ = fs::remove_file(&tmp);
    })
}

pub fn read_local_file(path: &Path) -> Option<Vec<u8>> {
    fs::read(path).ok()
}

/// Deletes a machine-local file or folder (e.g. a corrupt index, AR-01); missing is fine.
/// Never used on vault paths.
pub fn remove_local_path(path: &Path) -> io::Result<()> {
    match fs::symlink_metadata(path) {
        Ok(md) if md.is_dir() => fs::remove_dir_all(path),
        Ok(_) => fs::remove_file(path),
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e),
    }
}

/// The entries of a machine-local folder (Application Support), sorted; empty when it doesn't exist.
pub fn list_local_dir(path: &Path) -> Vec<std::path::PathBuf> {
    let mut v: Vec<std::path::PathBuf> = fs::read_dir(path).map(|rd| rd.flatten().map(|e| e.path()).collect()).unwrap_or_default();
    v.sort();
    v
}

/// Creates a machine-local folder (Application Support).
pub fn create_local_dir(path: &Path) -> io::Result<()> {
    fs::create_dir_all(path)
}
