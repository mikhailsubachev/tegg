//! Read-only access outside a vault for the import (v1-import §12.2): the probes behind the target refusals and the
//! source of an import (a folder, or a zip file opened for reading). Nothing here creates, changes or removes anything
//! (AR-04 AC-1: file access lives in this crate; FR-SYN-02 AC-1: the writing code stays in `local.rs`).

use std::fs;
use std::io;
use std::path::{Component, Path, PathBuf};

use crate::local::mtime_ns;
use crate::IMPORT_MARKER;

/// What `probe_new_vault` read about `<parent>/<name>` (v1-import §5, §9.5).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NewVaultProbe {
    /// `parent` with its symbolic links resolved (`resolve_existing`).
    pub parent: PathBuf,
    pub parent_is_dir: bool,
    /// The process may create entries in `parent` (`access(W_OK | X_OK)`; also false on a read-only volume).
    pub writable: bool,
    /// An entry (a file or a folder) is at `<parent>/<name>`.
    pub final_exists: bool,
    /// An entry is at `<parent>/<name>.tegg-importing`.
    pub temp_exists: bool,
    /// The text of `<name>.tegg-importing/.tegg-import` when that is a regular file (lossy UTF-8, so a marker that
    /// can't be parsed is still a marker).
    pub marker: Option<String>,
    /// `parent` or a folder above it holds a `.tegg` entry.
    pub inside_vault: bool,
}

/// Reads everything the target refusals of a new vault need. Creates nothing, not even a probe file.
pub fn probe_new_vault(parent: &Path, name: &str) -> io::Result<NewVaultProbe> {
    let resolved = resolve_existing(parent)?;
    let parent_is_dir = fs::metadata(&resolved).is_ok_and(|m| m.is_dir());
    let temp = resolved.join(format!("{name}.tegg-importing"));
    let marker_path = temp.join(IMPORT_MARKER);
    let marker = match fs::symlink_metadata(&marker_path) {
        Ok(md) if md.is_file() => fs::read(&marker_path).ok().map(|b| String::from_utf8_lossy(&b).into_owned()),
        _ => None,
    };
    Ok(NewVaultProbe {
        parent_is_dir,
        writable: parent_is_dir && may_create_in(&resolved),
        final_exists: fs::symlink_metadata(resolved.join(name)).is_ok(),
        temp_exists: fs::symlink_metadata(&temp).is_ok(),
        marker,
        inside_vault: has_entry_at_or_above(&resolved, ".tegg")?,
        parent: resolved,
    })
}

/// `access(W_OK | X_OK)`: the process may create entries in the folder; creates nothing.
#[cfg(unix)]
fn may_create_in(dir: &Path) -> bool {
    use std::os::unix::ffi::OsStrExt;
    let Ok(c) = std::ffi::CString::new(dir.as_os_str().as_bytes()) else { return false };
    // SAFETY: `c` is a valid NUL-terminated path for the duration of the call; `access` only reads it.
    unsafe { libc::access(c.as_ptr(), libc::W_OK | libc::X_OK) == 0 }
}

/// Portable fallback: the folder's read-only flag.
#[cfg(not(unix))]
fn may_create_in(dir: &Path) -> bool {
    fs::metadata(dir).is_ok_and(|m| !m.permissions().readonly())
}

/// The path with the symbolic links of its nearest existing ancestor resolved and the rest appended. A relative path
/// is taken from the current directory.
pub fn resolve_existing(path: &Path) -> io::Result<PathBuf> {
    let abs = if path.is_absolute() { path.to_path_buf() } else { std::env::current_dir()?.join(path) };
    let mut rest: Vec<std::ffi::OsString> = Vec::new();
    let mut cur = abs.as_path();
    loop {
        match fs::canonicalize(cur) {
            Ok(mut base) => {
                for part in rest.iter().rev() {
                    base.push(part);
                }
                return Ok(base);
            }
            Err(e) => match (cur.parent(), cur.file_name()) {
                (Some(parent), Some(name)) => {
                    rest.push(name.to_os_string());
                    cur = parent;
                }
                // `..` or the root itself can't be resolved: the error says why.
                _ => return Err(e),
            },
        }
    }
}

/// Whether an entry `name` (a file or a folder, e.g. `.tegg` or `.git`) is at `path` or at a folder above it, after
/// `resolve_existing`.
pub fn has_entry_at_or_above(path: &Path, name: &str) -> io::Result<bool> {
    let resolved = resolve_existing(path)?;
    Ok(resolved.ancestors().any(|dir| fs::symlink_metadata(dir.join(name)).is_ok()))
}

/// Whether `path` is `dir` or lies inside it (both resolved).
pub fn is_inside(path: &Path, dir: &Path) -> io::Result<bool> {
    Ok(resolve_existing(path)?.starts_with(resolve_existing(dir)?))
}

/// A readable, seekable source file.
pub trait ReadSeek: io::Read + io::Seek + Send {}
impl<T: io::Read + io::Seek + Send> ReadSeek for T {}

/// Read-only access to an import's source. `rel` is a path relative to the source, `/`-separated.
pub trait ExternalRead: Send + Sync {
    /// `(size, mtime_ns)`; `None` when there is no such file.
    fn stat(&self, rel: &str) -> io::Result<Option<(u64, i128)>>;
    /// Every file below the source: `(rel, size, mtime_ns)`, in path order. Names are as the file system stores them
    /// (not normalized), so each can be passed back to `stat` and `open`.
    fn list(&self) -> io::Result<Vec<(String, u64, i128)>>;
    fn open(&self, rel: &str) -> io::Result<Box<dyn ReadSeek>>;
}

/// A folder as an import source. Folders reached through a symbolic link are not walked.
pub struct ExternalFolder {
    root: PathBuf,
}

impl ExternalFolder {
    pub fn new(root: &Path) -> ExternalFolder {
        ExternalFolder { root: root.to_path_buf() }
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    /// `rel` under the root; a path that could leave it (absolute, `..`) is refused.
    fn abs(&self, rel: &str) -> io::Result<PathBuf> {
        let p = Path::new(rel);
        if rel.is_empty() || !p.components().all(|c| matches!(c, Component::Normal(_))) {
            return Err(io::Error::new(io::ErrorKind::InvalidInput, format!("{rel}: not a path inside the source")));
        }
        Ok(self.root.join(p))
    }
}

impl ExternalRead for ExternalFolder {
    fn stat(&self, rel: &str) -> io::Result<Option<(u64, i128)>> {
        stat_external(&self.abs(rel)?)
    }

    fn list(&self) -> io::Result<Vec<(String, u64, i128)>> {
        fn walk(dir: &Path, rel: &str, out: &mut Vec<(String, u64, i128)>) -> io::Result<()> {
            for e in fs::read_dir(dir)? {
                let e = e?;
                let name = e.file_name().to_string_lossy().into_owned();
                let rel = if rel.is_empty() { name } else { format!("{rel}/{name}") };
                if e.file_type()?.is_dir() {
                    walk(&e.path(), &rel, out)?;
                } else if let Ok(md) = fs::metadata(e.path()) {
                    // A file, or a symbolic link to one; a link to a folder or to nothing is not listed.
                    if md.is_file() {
                        out.push((rel, md.len(), mtime_ns(&md)));
                    }
                }
            }
            Ok(())
        }
        let mut out = Vec::new();
        walk(&self.root, "", &mut out)?;
        out.sort();
        Ok(out)
    }

    fn open(&self, rel: &str) -> io::Result<Box<dyn ReadSeek>> {
        open_external_file(&self.abs(rel)?)
    }
}

/// Opens a file outside a vault for reading only.
pub fn open_external_file(path: &Path) -> io::Result<Box<dyn ReadSeek>> {
    let f = fs::File::open(path)?;
    if f.metadata()?.is_dir() {
        return Err(io::Error::new(io::ErrorKind::InvalidInput, format!("{}: is a directory", path.display())));
    }
    Ok(Box::new(f))
}

/// `(size, mtime_ns)` of an entry outside a vault; `None` when it doesn't exist.
pub fn stat_external(path: &Path) -> io::Result<Option<(u64, i128)>> {
    match fs::metadata(path) {
        Ok(md) => Ok(Some((md.len(), mtime_ns(&md)))),
        Err(e) if e.kind() == io::ErrorKind::NotFound || e.kind() == io::ErrorKind::NotADirectory => Ok(None),
        Err(e) => Err(e),
    }
}

/// The entries directly in a folder outside a vault: `(name, is a folder)`, names NFC, sorted.
pub fn list_external_dir(path: &Path) -> io::Result<Vec<(String, bool)>> {
    let mut out = Vec::new();
    for e in fs::read_dir(path)? {
        let e = e?;
        out.push((tegg_format::nfc(&e.file_name().to_string_lossy()), e.file_type()?.is_dir()));
    }
    out.sort();
    Ok(out)
}

/// The nearest existing ancestor of `path` (itself when it exists).
fn nearest_existing(path: &Path) -> io::Result<PathBuf> {
    let resolved = resolve_existing(path)?;
    resolved.ancestors().find(|p| fs::symlink_metadata(p).is_ok()).map(Path::to_path_buf).ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, path.display().to_string()))
}

/// Bytes free for this process on the volume holding `path` (or its nearest existing parent).
pub fn free_space(path: &Path) -> io::Result<u64> {
    volume_free(&nearest_existing(path)?)
}

#[cfg(unix)]
fn volume_free(dir: &Path) -> io::Result<u64> {
    use std::os::unix::ffi::OsStrExt;
    let c = std::ffi::CString::new(dir.as_os_str().as_bytes())?;
    let mut st = std::mem::MaybeUninit::<libc::statvfs>::uninit();
    // SAFETY: `c` is a valid NUL-terminated path and `st` is writable memory of the right size; `statvfs` fills it
    // when it returns 0, and only then is it read.
    let st = unsafe {
        if libc::statvfs(c.as_ptr(), st.as_mut_ptr()) != 0 {
            return Err(io::Error::last_os_error());
        }
        st.assume_init()
    };
    Ok((st.f_bavail as u64).saturating_mul(st.f_frsize as u64))
}

/// Portable fallback: unknown.
#[cfg(not(unix))]
fn volume_free(_dir: &Path) -> io::Result<u64> {
    Err(io::Error::new(io::ErrorKind::Unsupported, "free space is not known on this platform"))
}

/// An id equal for two paths on one volume (`st_dev` of the nearest existing parent).
pub fn volume_id(path: &Path) -> io::Result<u64> {
    volume_of(&fs::metadata(nearest_existing(path)?)?)
}

#[cfg(unix)]
fn volume_of(md: &fs::Metadata) -> io::Result<u64> {
    use std::os::unix::fs::MetadataExt;
    Ok(md.dev())
}

/// Portable fallback: unknown.
#[cfg(not(unix))]
fn volume_of(_md: &fs::Metadata) -> io::Result<u64> {
    Err(io::Error::new(io::ErrorKind::Unsupported, "volume ids are not known on this platform"))
}
