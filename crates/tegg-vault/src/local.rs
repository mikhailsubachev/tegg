//! The local-folder `VaultFs` and the only code in Tegg that writes files (FR-SYN-02 AC-1).
//! Every write goes to `.<name>.tegg-tmp` in the same folder, is flushed, then renamed over the
//! target; creates use `RENAME_EXCL`, so an existing file is never replaced (ported from spike S3).

use std::fs;
use std::io::{self, Write};
use std::path::{Path, PathBuf};

use crate::{version_of, ChangeSink, FileVersion, FsChange, FsEntry, SystemTrash, VaultFs, WatchGuard, IMPORT_MARKER};

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

    /// v1-import §12.2: streams `src` into the new file `tmp` (create-new: an existing file is an error and is not
    /// touched), syncs it and returns its size, BLAKE3, mtime and file id. A failed copy removes the file it created.
    fn stream_new(tmp: &Path, src: &mut dyn io::Read) -> io::Result<(FileVersion, u64)> {
        let mut f = fs::OpenOptions::new().write(true).create_new(true).open(tmp)?;
        let mut copy = || -> io::Result<(FileVersion, u64)> {
            let mut hasher = blake3::Hasher::new();
            let mut size = 0u64;
            let mut buf = vec![0u8; 64 * 1024];
            loop {
                let n = match src.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => n,
                    Err(e) if e.kind() == io::ErrorKind::Interrupted => continue,
                    Err(e) => return Err(e),
                };
                f.write_all(&buf[..n])?;
                hasher.update(&buf[..n]);
                size += n as u64;
            }
            f.sync_all()?;
            let md = f.metadata()?;
            Ok((FileVersion { mtime_ns: mtime_ns(&md), size, hash: *hasher.finalize().as_bytes() }, inode(&md)))
        };
        let r = copy();
        if r.is_err() {
            drop(f);
            let _ = fs::remove_file(tmp); // the file this call created; never leave a partial temp file behind
        }
        r
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

    fn list_dir(&self, dir: &str) -> io::Result<Vec<FsEntry>> {
        let dir = dir.trim_matches('/');
        let rd = match fs::read_dir(self.abs(dir)) {
            Ok(rd) => rd,
            Err(e) if e.kind() == io::ErrorKind::NotFound || e.kind() == io::ErrorKind::NotADirectory => return Ok(Vec::new()),
            Err(e) => return Err(e),
        };
        let mut out = Vec::new();
        for e in rd {
            let e = e?;
            let path = tegg_format::nfc(&format!("{dir}/{}", e.file_name().to_string_lossy()));
            out.push(if e.file_type()?.is_dir() { FsEntry::Dir { path } } else { FsEntry::File { path } });
        }
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

    fn write_temp_new(&self, path: &str, tag: &str, src: &mut dyn io::Read) -> io::Result<(String, FileVersion, u64)> {
        let temp = crate::temp_path(path, Some(tag))?;
        let (v, id) = Self::stream_new(&self.abs(&temp), src)?;
        Ok((temp, v, id))
    }

    fn file_id(&self, path: &str) -> io::Result<Option<u64>> {
        match fs::symlink_metadata(self.abs(path)) {
            Ok(md) => Ok(Some(inode(&md))),
            Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(None),
            Err(e) => Err(e),
        }
    }

    /// As `replace`, with the caller's hook between the temp file and the rename; `BEFORE_RENAME` is not called.
    fn replace_with(&self, path: &str, bytes: &[u8], before_rename: &dyn Fn() -> io::Result<()>) -> io::Result<FileVersion> {
        let abs = self.abs(path);
        let tmp = Self::write_temp(&abs, bytes)?;
        if let Err(e) = before_rename().and_then(|_| fs::rename(&tmp, &abs)) {
            let _ = fs::remove_file(&tmp);
            return Err(e);
        }
        Self::sync_dir(&abs);
        self.version_at(&abs, bytes)
    }

    fn create_dir_new(&self, path: &str) -> io::Result<()> {
        let abs = self.abs(path);
        fs::create_dir(&abs)?;
        Self::sync_dir(&abs);
        Ok(())
    }

    fn is_dir(&self, path: &str) -> io::Result<bool> {
        match fs::symlink_metadata(self.abs(path)) {
            Ok(md) => Ok(md.is_dir()),
            Err(e) if e.kind() == io::ErrorKind::NotFound || e.kind() == io::ErrorKind::NotADirectory => Ok(false),
            Err(e) => Err(e),
        }
    }

    fn remove_file(&self, path: &str) -> io::Result<()> {
        fs::remove_file(self.abs(path))
    }

    fn remove_empty_dir(&self, path: &str) -> io::Result<()> {
        fs::remove_dir(self.abs(path))
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

/// The file id of an entry on its volume (v1-import §12.2): the inode.
#[cfg(unix)]
fn inode(md: &fs::Metadata) -> u64 {
    use std::os::unix::fs::MetadataExt;
    md.ino()
}

/// Portable fallback: no file ids (a roll-back then never takes a file for the run's by its id).
#[cfg(not(unix))]
fn inode(_md: &fs::Metadata) -> u64 {
    0
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

// ---------------------------------------------------------------- the import's folders and log (v1-import §9.5, §9.6, §12.2)

/// A synced append for a write-ahead log in Application Support (v1-import §9.6): opens `path` with append (creating
/// it, and then syncing its folder), writes `line` and a newline in one write and calls `sync_all` before it returns.
pub fn append_local_file(path: &Path, line: &[u8]) -> io::Result<()> {
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir)?;
    }
    let existed = fs::symlink_metadata(path).is_ok();
    let mut f = fs::OpenOptions::new().append(true).create(true).open(path)?;
    let mut buf = Vec::with_capacity(line.len() + 1);
    buf.extend_from_slice(line);
    buf.push(b'\n');
    f.write_all(&buf)?;
    f.sync_all()?;
    if !existed {
        LocalFs::sync_dir(path);
    }
    Ok(())
}

/// Creates the one folder `path` outside a vault (`<parent>/<name>.tegg-importing`); `AlreadyExists` when an entry has
/// that name. Its parent must exist.
pub fn create_external_dir_new(path: &Path) -> io::Result<()> {
    fs::create_dir(path)?;
    LocalFs::sync_dir(path);
    Ok(())
}

/// Renames the folder `from` to `to` and never replaces or merges: `AlreadyExists` when an entry is at `to`
/// (v1-import §9.5 step 4). The same primitive as a file's exclusive create.
pub fn rename_dir_no_replace(from: &Path, to: &Path) -> io::Result<()> {
    if !fs::symlink_metadata(from)?.is_dir() {
        return Err(io::Error::new(io::ErrorKind::InvalidInput, "not a folder"));
    }
    rename_dir_excl(from, to)?;
    LocalFs::sync_dir(to);
    Ok(())
}

/// macOS: `renamex_np(RENAME_EXCL)` works for folders too.
#[cfg(target_os = "macos")]
fn rename_dir_excl(from: &Path, to: &Path) -> io::Result<()> {
    rename_no_clobber(from, to)
}

/// Portable fallback (a folder can't be hard-linked): creating `to` fails when an entry has that name; `rename` then
/// replaces only that new, empty folder, and fails when something was put into it meanwhile.
#[cfg(not(target_os = "macos"))]
fn rename_dir_excl(from: &Path, to: &Path) -> io::Result<()> {
    fs::create_dir(to)?;
    fs::rename(from, to).inspect_err(|_| {
        let _ = fs::remove_dir(to);
    })
}

/// Whether `dir` is a real folder (not a symbolic link) holding the import marker as a regular file.
fn has_import_marker(dir: &Path) -> bool {
    fs::symlink_metadata(dir).is_ok_and(|m| m.is_dir()) && fs::symlink_metadata(dir.join(IMPORT_MARKER)).is_ok_and(|m| m.is_file())
}

fn no_marker(dir: &Path) -> io::Error {
    io::Error::new(io::ErrorKind::PermissionDenied, format!("{}: not an import's temporary folder (no {IMPORT_MARKER})", dir.display()))
}

/// Removes the folder `path` with everything in it (v1-import §9.5 step 6: the run's own temporary folder after a
/// failure). **Refuses a folder without the marker `.tegg-import`**: nothing is removed then.
pub fn remove_dir_tree(path: &Path) -> io::Result<()> {
    if !has_import_marker(path) {
        return Err(no_marker(path));
    }
    fs::remove_dir_all(path)
}

/// D-1559 (v1-import §9.5 step 1): moves a dead run's leftover folder whole to the system Trash through `sink`.
/// Refuses a folder without the marker `.tegg-import` (nothing is moved); an error when the sink fails or `dir` is
/// still there afterwards. Unlinks nothing itself.
pub fn trash_import_leftover(dir: &Path, sink: &dyn SystemTrash) -> io::Result<()> {
    if !has_import_marker(dir) {
        return Err(no_marker(dir));
    }
    sink.trash(dir)?;
    if fs::symlink_metadata(dir).is_ok() {
        return Err(io::Error::other(format!("{}: still there after the move to the Trash", dir.display())));
    }
    Ok(())
}
