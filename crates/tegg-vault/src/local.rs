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
    /// Folder listings by folder, with the folder's mtime when listed (a create, rename or removal in it changes the
    /// mtime): `abs` resolves non-ASCII names against them off APFS without listing a folder per file (D-2029, D-2048).
    /// The mtime is coarse on Linux, so a name a listing lacks is looked up again in a fresh listing (QA AND-1).
    listings: std::sync::Mutex<std::collections::HashMap<PathBuf, (i128, std::sync::Arc<Listing>)>>,
    /// Resolve non-ASCII names through the listings: off macOS, and in host tests of that path.
    resolve_names: bool,
}

impl LocalFs {
    pub fn new(root: &Path) -> LocalFs {
        LocalFs { root: root.to_path_buf(), listings: Default::default(), resolve_names: !cfg!(target_os = "macos") }
    }

    /// A `LocalFs` that resolves names as on Android, for host tests (D-2048).
    #[cfg(test)]
    fn resolving(root: &Path) -> LocalFs {
        LocalFs { resolve_names: true, ..LocalFs::new(root) }
    }

    /// `dir`'s entries as stored on disk, from the cache while the folder's mtime is unchanged, unless `fresh`. The
    /// folder is read without holding the cache's lock.
    fn listing(&self, dir: &Path, fresh: bool) -> std::sync::Arc<Listing> {
        let mtime = fs::metadata(dir).map(|m| mtime_ns(&m)).unwrap_or(-1);
        if !fresh {
            let cache = self.listings.lock().unwrap_or_else(|p| p.into_inner());
            if let Some((t, l)) = cache.get(dir) {
                if *t == mtime && mtime >= 0 {
                    return l.clone();
                }
            }
        }
        let l = std::sync::Arc::new(Listing::new(listing_of(dir).unwrap_or_default()));
        self.listings.lock().unwrap_or_else(|p| p.into_inner()).insert(dir.to_path_buf(), (mtime, l.clone()));
        l
    }

    /// The file's path on disk (D-2029): as given on APFS or for an ASCII path; else each component as listed.
    /// Android's shared storage treats the NFC and NFD spellings as one name, but caches each spelling apart, so a file
    /// is always reached through the spelling it is stored under; a new file keeps the NFC name.
    fn abs(&self, path: &str) -> io::Result<PathBuf> {
        let p = self.root.join(path);
        if !self.resolve_names || path.is_ascii() {
            return Ok(p);
        }
        let rel = on_disk_path_under(&self.root, path, &|d, fresh| self.listing(d, fresh))?;
        Ok(self.root.join(rel))
    }

    /// `abs` for a write, rename or removal. A path that resolves to an on-disk spelling other than its NFC form is
    /// refused (`PermissionDenied`) and nothing changes: until AND-3, Tegg doesn't write a file stored under an NFD
    /// name, because Android's FUSE layer would show other apps the old file after the replace (D-2048). The desktop
    /// doesn't resolve names, so it is unchanged.
    fn abs_write(&self, path: &str) -> io::Result<PathBuf> {
        let p = self.abs(path)?;
        if self.resolve_names && p != self.root.join(tegg_format::nfc(path)) {
            return Err(io::Error::new(io::ErrorKind::PermissionDenied, format!("{path}: stored under another spelling; read-only on this device (D-2048)")));
        }
        Ok(p)
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
            let entries: Vec<fs::DirEntry> = fs::read_dir(dir)?.collect::<io::Result<_>>()?;
            // Where a folder holds two spellings of one name (possible off APFS), both keep their on-disk bytes, so the
            // index lists them as a name conflict (FR-FMT-12 AC-3, D-2029) instead of folding them into one path.
            let mut seen: std::collections::HashMap<String, usize> = std::collections::HashMap::new();
            for e in &entries {
                *seen.entry(tegg_format::nfc(&e.file_name().to_string_lossy())).or_default() += 1;
            }
            for e in entries {
                let p = e.path();
                let raw = p.strip_prefix(root).expect("under root").to_string_lossy().into_owned();
                let twin = seen.get(&tegg_format::nfc(&e.file_name().to_string_lossy())).copied().unwrap_or(0) > 1;
                let rel = if twin { raw } else { tegg_format::nfc(&raw) };
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
        let rd = match fs::read_dir(self.abs(dir)?) {
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
        let abs = self.abs(path)?;
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
        let abs = self.abs_write(path)?;
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
        let abs = self.abs_write(path)?;
        let tmp = Self::write_temp(&abs, bytes)?;
        if let Err(e) = rename_no_clobber(&tmp, &abs) {
            let _ = fs::remove_file(&tmp);
            return Err(e);
        }
        Self::sync_dir(&abs);
        self.version_at(&abs, bytes)
    }

    fn rename_no_replace(&self, from: &str, to: &str) -> io::Result<()> {
        let to_abs = self.abs_write(to)?;
        rename_no_clobber(&self.abs_write(from)?, &to_abs)?;
        Self::sync_dir(&to_abs);
        Ok(())
    }

    /// APFS is case-insensitive: renaming a file to another spelling of its own name is a plain rename of that file.
    fn rename_case(&self, from: &str, to: &str) -> io::Result<()> {
        let (f, t) = (self.abs_write(from)?, self.abs_write(to)?);
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
        fs::create_dir_all(self.abs_write(path)?)
    }

    fn write_temp_new(&self, path: &str, tag: &str, src: &mut dyn io::Read) -> io::Result<(String, FileVersion, u64)> {
        let temp = crate::temp_path(path, Some(tag))?;
        let (v, id) = Self::stream_new(&self.abs_write(&temp)?, src)?;
        Ok((temp, v, id))
    }

    fn file_id(&self, path: &str) -> io::Result<Option<u64>> {
        match fs::symlink_metadata(self.abs(path)?) {
            Ok(md) => Ok(Some(inode(&md))),
            Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(None),
            Err(e) => Err(e),
        }
    }

    /// As `replace`, with the caller's hook between the temp file and the rename; `BEFORE_RENAME` is not called.
    fn replace_with(&self, path: &str, bytes: &[u8], before_rename: &dyn Fn() -> io::Result<()>) -> io::Result<FileVersion> {
        let abs = self.abs_write(path)?;
        let tmp = Self::write_temp(&abs, bytes)?;
        if let Err(e) = before_rename().and_then(|_| fs::rename(&tmp, &abs)) {
            let _ = fs::remove_file(&tmp);
            return Err(e);
        }
        Self::sync_dir(&abs);
        self.version_at(&abs, bytes)
    }

    fn create_dir_new(&self, path: &str) -> io::Result<()> {
        let abs = self.abs_write(path)?;
        fs::create_dir(&abs)?;
        Self::sync_dir(&abs);
        Ok(())
    }

    fn is_dir(&self, path: &str) -> io::Result<bool> {
        match fs::symlink_metadata(self.abs(path)?) {
            Ok(md) => Ok(md.is_dir()),
            Err(e) if e.kind() == io::ErrorKind::NotFound || e.kind() == io::ErrorKind::NotADirectory => Ok(false),
            Err(e) => Err(e),
        }
    }

    fn remove_file(&self, path: &str) -> io::Result<()> {
        fs::remove_file(self.abs_write(path)?)
    }

    fn remove_empty_dir(&self, path: &str) -> io::Result<()> {
        fs::remove_dir(self.abs_write(path)?)
    }

    /// ms6-trash-media §1.1: `st_ctime` (a rename sets it on APFS).
    fn changed_ns(&self, path: &str) -> io::Result<Option<i128>> {
        use std::os::unix::fs::MetadataExt;
        match fs::symlink_metadata(self.abs(path)?) {
            Ok(md) => Ok(Some(md.ctime() as i128 * 1_000_000_000 + md.ctime_nsec() as i128)),
            Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(None),
            Err(e) => Err(e),
        }
    }

    fn stat(&self, path: &str) -> io::Result<Option<(i128, u64)>> {
        match fs::metadata(self.abs(path)?) {
            Ok(md) if md.is_dir() => Err(io::Error::other(format!("{path}: is a directory"))),
            Ok(md) => Ok(Some((mtime_ns(&md), md.len()))),
            Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(None),
            Err(e) => Err(e),
        }
    }

    fn is_placeholder(&self, path: &str) -> io::Result<bool> {
        is_dataless(&fs::symlink_metadata(self.abs(path)?)?)
    }

    /// FSEvents (macOS) or inotify (Linux, Android) through `notify` (spike S4): `fs_change_of` decides each event.
    fn watch(&self, sink: ChangeSink) -> io::Result<Option<WatchGuard>> {
        use notify::{RecursiveMode, Watcher};
        let root = self.root.canonicalize()?;
        let base = root.clone();
        let mut w = notify::recommended_watcher(move |res: notify::Result<notify::Event>| match res {
            Ok(ev) => {
                if let Some(change) = fs_change_of(&ev, &base) {
                    sink(change);
                }
            }
            Err(_) => sink(FsChange::Rescan),
        })
        .map_err(io::Error::other)?;
        w.watch(&root, RecursiveMode::Recursive).map_err(io::Error::other)?;
        Ok(Some(Box::new(w)))
    }
}

/// docs/contracts/android-shell.md §3.1 (FR-SYN-03 AC-37, D-2028): what one `notify` event means for the vault.
/// inotify (Linux, Android) also reports reads; the index's own reads would come back as changes and the index would
/// never go idle (spike AND-0, F1). Every read event is dropped except a close after writing, which marks the end of
/// another program's write. Other kinds are never trusted (`FsChange`'s doc): they all give the paths.
pub fn fs_change_of(ev: &notify::Event, base: &Path) -> Option<FsChange> {
    use notify::event::{AccessKind, AccessMode, EventKind};
    if ev.need_rescan() {
        return Some(FsChange::Rescan);
    }
    if let EventKind::Access(kind) = ev.kind {
        if kind != AccessKind::Close(AccessMode::Write) {
            return None;
        }
    }
    let paths: Vec<String> = ev
        .paths
        .iter()
        .filter_map(|p| p.strip_prefix(base).ok())
        .map(|r| tegg_format::nfc(&r.to_string_lossy()))
        .filter(|r| !r.is_empty())
        .collect();
    (!paths.is_empty()).then_some(FsChange::Paths(paths))
}

/// docs/contracts/android-shell.md §3.2 (FR-FMT-12 AC-17, D-2029): the on-disk entry of a folder listing for one NFC
/// path component.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum OnDiskName {
    Found(String),
    Missing,
    Ambiguous,
}

/// docs/contracts/android-shell.md §3.2: the one listed entry whose NFC form is `nfc_name`. APFS treats the spellings
/// as one name; Android's storage keeps them apart, so an NFD name from a Mac or a sync app must be found by its NFC
/// form. Two entries with one NFC form are a name conflict (FR-FMT-12 AC-3): `Ambiguous`.
pub fn on_disk_name(listing: &[String], nfc_name: &str) -> OnDiskName {
    let target = tegg_format::nfc(nfc_name);
    let mut found: Option<&String> = None;
    for entry in listing {
        if tegg_format::nfc(entry) == target {
            if found.is_some() {
                return OnDiskName::Ambiguous;
            }
            found = Some(entry);
        }
    }
    found.map_or(OnDiskName::Missing, |e| OnDiskName::Found(e.clone()))
}

/// One folder's entry names, as stored on disk.
fn listing_of(dir: &Path) -> io::Result<Vec<String>> {
    let mut out = Vec::new();
    for e in fs::read_dir(dir)? {
        if let Ok(name) = e?.file_name().into_string() {
            out.push(name);
        }
    }
    Ok(out)
}

/// `path` with each existing component spelled as on disk (D-2029). An exact match of the whole path is taken as it
/// is (APFS, or a name already in its on-disk form), so the desktop does no extra listing. A missing component and
/// everything after it stay as given (NFC); `Ambiguous` is `InvalidData`.
pub fn on_disk_path(path: &Path) -> io::Result<PathBuf> {
    use std::path::Component;
    if fs::symlink_metadata(path).is_ok() && !needs_listing(path) {
        return Ok(path.to_path_buf());
    }
    let mut out = PathBuf::new();
    let mut found = true;
    for c in path.components() {
        match c {
            Component::Normal(name) if found => {
                let name = name.to_string_lossy();
                let exact = out.join(name.as_ref());
                match on_disk_name(&listing_of(&out).unwrap_or_default(), &name) {
                    OnDiskName::Found(n) => out.push(n),
                    OnDiskName::Missing => {
                        found = fs::symlink_metadata(&exact).is_ok();
                        out = exact;
                    }
                    // Two spellings in one folder: the exact one if it is listed, else a name conflict.
                    OnDiskName::Ambiguous if listing_of(&out).unwrap_or_default().iter().any(|e| e.as_str() == name) => out = exact,
                    OnDiskName::Ambiguous => {
                        return Err(io::Error::new(io::ErrorKind::InvalidData, format!("{}: two names with one NFC form", exact.display())));
                    }
                }
            }
            other => out.push(other.as_os_str()),
        }
    }
    Ok(out)
}

/// One folder's entries by their NFC form, so a lookup costs one map access (QA AND-1).
pub(crate) struct Listing {
    by_nfc: std::collections::HashMap<String, Vec<String>>,
}

impl Listing {
    fn new(names: Vec<String>) -> Listing {
        let mut by_nfc: std::collections::HashMap<String, Vec<String>> = std::collections::HashMap::new();
        for n in names {
            by_nfc.entry(tegg_format::nfc(&n)).or_default().push(n);
        }
        Listing { by_nfc }
    }

    /// As `on_disk_name`, for one component.
    fn find(&self, name: &str) -> OnDiskName {
        match self.by_nfc.get(&tegg_format::nfc(name)).map(Vec::as_slice) {
            None | Some([]) => OnDiskName::Missing,
            Some([one]) => OnDiskName::Found(one.clone()),
            Some(_) => OnDiskName::Ambiguous,
        }
    }

    fn has_exact(&self, name: &str) -> bool {
        self.by_nfc.get(&tegg_format::nfc(name)).is_some_and(|v| v.iter().any(|e| e == name))
    }
}

/// `rel` below `root`, each existing component as on disk (`root` itself is taken as given). `listing(dir, fresh)`
/// gives a folder's entries; a component missing from a cached listing is looked up once more in a fresh one.
fn on_disk_path_under(root: &Path, rel: &str, listing: &dyn Fn(&Path, bool) -> std::sync::Arc<Listing>) -> io::Result<PathBuf> {
    let mut dir = root.to_path_buf();
    let mut out = PathBuf::new();
    let mut parts = rel.split('/').filter(|c| !c.is_empty()).peekable();
    while let Some(c) = parts.next() {
        let mut names = listing(&dir, false);
        let mut found = names.find(c);
        if found == OnDiskName::Missing {
            names = listing(&dir, true);
            found = names.find(c);
        }
        let name = match found {
            OnDiskName::Found(n) => n,
            OnDiskName::Missing => {
                out.push(c);
                parts.for_each(|r| out.push(r));
                return Ok(out);
            }
            OnDiskName::Ambiguous if names.has_exact(c) => c.to_string(),
            OnDiskName::Ambiguous => return Err(io::Error::new(io::ErrorKind::InvalidData, format!("{rel}: two names with one NFC form"))),
        };
        dir.push(&name);
        out.push(&name);
    }
    Ok(out)
}

/// APFS and Android's shared storage find every spelling of a name, so an exact hit is the on-disk path only when the
/// listing has those bytes; a non-ASCII path is always checked against the listings.
fn needs_listing(path: &Path) -> bool {
    path.to_string_lossy().chars().any(|c| !c.is_ascii())
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
    no_clobber_via(from, to, &|a: &Path, b: &Path| fs::hard_link(a, b))?;
    // Only the link decides; once it exists, a failure to drop the temp name is reported as such (QA AND-1).
    if fs::symlink_metadata(from).is_ok() {
        fs::remove_file(from)?;
    }
    Ok(())
}

/// A create that never replaces `to`, through `primitive` (a hard link, which fails when `to` exists; the caller drops
/// `from` afterwards when it is still there). Where the file
/// system has no hard links (Android's shared storage: `ENOSYS` for the shell user, `EACCES` for an app; also `EPERM`,
/// `EOPNOTSUPP`, `EXDEV`; bug_and1la), the target is
/// checked and the file renamed: an existing `to` is `AlreadyExists`. A file another program creates between the check
/// and the rename would be replaced: Android's FUSE layer rejects `renameat2(RENAME_NOREPLACE)` (EINVAL, checked on the
/// emulator); the window is accepted for AND-1 and revisited in AND-3 (D-2047).
#[cfg_attr(target_os = "macos", allow(dead_code))]
pub(crate) fn no_clobber_via(from: &Path, to: &Path, primitive: &dyn Fn(&Path, &Path) -> io::Result<()>) -> io::Result<()> {
    match primitive(from, to) {
        Err(e) if matches!(e.raw_os_error(), Some(libc::ENOSYS | libc::EACCES | libc::EPERM | libc::EOPNOTSUPP | libc::EXDEV)) => {
            if fs::symlink_metadata(to).is_ok() {
                return Err(io::Error::new(io::ErrorKind::AlreadyExists, to.display().to_string()));
            }
            fs::rename(from, to)
        }
        other => other,
    }
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

/// Spike AND-0 finding F1 (docs/acceptance/android-shell.md FR-SYN-03 AC-37, D-2028): on Linux-family systems
/// (Android) `notify` reports Tegg's own reads as `Access` events; treated as changes they re-index the read file,
/// which is read again, so the index never settles. Regression test, committed red before the fix (D-61).
#[cfg(test)]
mod bug_and0f1 {
    use super::fs_change_of;
    use crate::FsChange;
    use notify::event::{AccessKind, AccessMode, EventKind, ModifyKind, DataChange};
    use std::path::Path;

    #[test]
    fn bug_and0f1_fr_syn_03_access_events_are_not_changes() {
        let base = Path::new("/storage/emulated/0/Documents/Trezor");
        let file = base.join("Pages/Úvodní stránka.md");
        let ev = |kind: EventKind| notify::Event::new(kind).add_path(file.clone());
        for kind in [
            EventKind::Access(AccessKind::Open(AccessMode::Any)),
            EventKind::Access(AccessKind::Read),
            EventKind::Access(AccessKind::Close(AccessMode::Read)),
        ] {
            assert_eq!(fs_change_of(&ev(kind), base), None, "{kind:?} (Tegg reading its own file) is not a change");
        }
        let changed = fs_change_of(&ev(EventKind::Modify(ModifyKind::Data(DataChange::Content))), base);
        assert_eq!(changed, Some(FsChange::Paths(vec!["Pages/Úvodní stránka.md".to_string()])), "a content change still is");
    }
}

/// Slice AND-1, emulator run: Android's shared storage (FUSE) has no hard links (`ENOSYS`), so every create of a new
/// vault file failed with an error and New vault could not be made (FR-VLT-01 AC-26, FR-SYN-02). A create must still
/// never replace an existing file when the no-replace primitive isn't available.
#[cfg(test)]
mod bug_and1la_fr_syn_02_create_without_hard_links {
    use super::{no_clobber_via, LocalFs};
    use std::io;
    use std::path::Path;

    #[test]
    fn bug_and1la_fr_syn_02_create_without_hard_links() {
        // The shell user gets ENOSYS from Android's FUSE layer, an app EACCES (both seen on the emulator).
        for errno in [libc::ENOSYS, libc::EACCES] {
            check(&move |_: &Path, _: &Path| Err(io::Error::from_raw_os_error(errno)));
        }
    }

    fn check(unsupported: &dyn Fn(&Path, &Path) -> io::Result<()>) {
        let dir = std::env::temp_dir().join(format!("tegg-bug-and1la-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let (tmp, target) = (dir.join(".a.tegg-tmp"), dir.join("a.md"));
        std::fs::write(&tmp, b"new").unwrap();
        no_clobber_via(&tmp, &target, unsupported).expect("a new file is created without hard links");
        assert_eq!(std::fs::read(&target).unwrap(), b"new");
        assert!(!tmp.exists(), "the temporary file is gone");
        // An existing file is never replaced: AlreadyExists, and both files are left as they were.
        std::fs::write(&tmp, b"other").unwrap();
        let e = no_clobber_via(&tmp, &target, unsupported).expect_err("an existing target is refused");
        assert_eq!(e.kind(), io::ErrorKind::AlreadyExists);
        assert_eq!(std::fs::read(&target).unwrap(), b"new", "the existing file is untouched");
        let _ = std::fs::remove_dir_all(&dir);
    }
    /// QA AND-1: a folder listing cached in the same mtime tick as another app's create must not hide the new entry
    /// (D-2048).
    #[test]
    fn bug_and1qa_fr_fmt_12_stale_listing_refuses_nfd_write() {
        let dir = tempfile::tempdir().unwrap();
        let pages = dir.path().join("Pages");
        std::fs::create_dir(&pages).unwrap();
        let fs = LocalFs::resolving(dir.path());
        let nfc = "Pages/Poznámka.md";
        assert!(fs.abs_write(nfc).is_ok(), "a new note may be written");
        let mtime = std::fs::metadata(&pages).unwrap().modified().unwrap();
        // Another app adds the note under its NFD name in the same tick: the folder's mtime looks unchanged.
        std::fs::write(pages.join("Pozna\u{301}mka.md"), b"x").unwrap();
        std::fs::File::open(&pages).unwrap().set_modified(mtime).unwrap();
        let e = fs.abs_write(nfc).expect_err("the NFD-named note is read-only");
        assert_eq!(e.kind(), io::ErrorKind::PermissionDenied);
    }

    /// QA AND-1: a path given in its NFD bytes (a name-conflict twin from `list`) is still a file stored under an NFD
    /// name, so it is refused too (D-2048).
    #[test]
    fn bug_and1qa_fr_fmt_12_nfd_path_given_as_is_refused() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir(dir.path().join("Pages")).unwrap();
        let nfd = "Pages/Pozna\u{301}mka.md";
        std::fs::write(dir.path().join(nfd), b"x").unwrap();
        let fs = LocalFs::resolving(dir.path());
        let e = fs.abs_write(nfd).expect_err("the NFD-named note is read-only");
        assert_eq!(e.kind(), io::ErrorKind::PermissionDenied);
        assert!(fs.abs_write("Pages/Nová.md").is_ok(), "a new NFC note may be written");
    }
}
