//! docs/contracts/android-shell.md §4.2, §4.3 (FR-VLT-01 AC-24…AC-26, RA4, RA6): finding vaults in shared storage and
//! reading a typed path. Compiled on every target; pure over the file system.

use std::path::{Component, Path, PathBuf};

/// One vault `find_vaults` found: the NFC folder name and the on-disk path.
pub struct FoundVault {
    pub name: String,
    pub path: PathBuf,
}

/// Why `resolve_typed_path` refuses a path (RA4; the `IpcError` kinds `FullPath`, `OutsideShared`, `NotFound`,
/// `NotATeggVault`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PathRefusal {
    FullPath,
    OutsideShared,
    NotFound,
    NotAVault,
}

const MAX_FOUND: usize = 50;
const MAX_DEPTH: usize = 3;

fn is_vault(dir: &Path) -> bool {
    std::fs::symlink_metadata(dir.join(".tegg/vault.yml")).map(|m| m.is_file()).unwrap_or(false)
}

/// RA6: folders holding `.tegg/vault.yml` (a file) 1–3 levels below `root`; not under `Android/` at depth 1, hidden
/// folders, symbolic links or inside a found vault; unreadable folders are skipped. By name (folded, D-122's primary
/// strength), then path bytes; at most 50.
pub fn find_vaults(root: &Path) -> Vec<FoundVault> {
    fn walk(dir: &Path, depth: usize, out: &mut Vec<FoundVault>) {
        let Ok(rd) = std::fs::read_dir(dir) else { return };
        for e in rd.flatten() {
            let Ok(ft) = e.file_type() else { continue };
            if !ft.is_dir() {
                continue; // symbolic links are not dirs here (file_type doesn't follow them)
            }
            let name = e.file_name().to_string_lossy().into_owned();
            if name.starts_with('.') || (depth == 1 && name == "Android") {
                continue;
            }
            let p = e.path();
            if is_vault(&p) {
                out.push(FoundVault { name: tegg_format::nfc(&name), path: p });
            } else if depth < MAX_DEPTH {
                walk(&p, depth + 1, out);
            }
        }
    }
    let mut out = Vec::new();
    walk(root, 1, &mut out);
    out.sort_by(|a, b| {
        use std::os::unix::ffi::OsStrExt;
        tegg_core::fold(&a.name).cmp(&tegg_core::fold(&b.name)).then_with(|| a.path.as_os_str().as_bytes().cmp(b.path.as_os_str().as_bytes()))
    });
    out.truncate(MAX_FOUND);
    out
}

/// `..` and `.` folded without touching the disk.
fn lexical(p: &Path) -> PathBuf {
    let mut out = PathBuf::new();
    for c in p.components() {
        match c {
            Component::ParentDir => {
                out.pop();
            }
            Component::CurDir => {}
            other => out.push(other.as_os_str()),
        }
    }
    out
}

/// RA4's typed-path rules, in order. The result is the on-disk path (each component matched after NFC, D-2029).
pub fn resolve_typed_path(input: &str, shared_root: &Path, private_root: &Path, need_vault: bool) -> Result<PathBuf, PathRefusal> {
    let mut s = input.trim();
    if s.len() > 1 {
        s = s.strip_suffix('/').unwrap_or(s);
    }
    let mut p = match s.strip_prefix("/sdcard") {
        Some("") => shared_root.to_path_buf(),
        Some(rest) if rest.starts_with('/') => shared_root.join(rest.trim_start_matches('/')),
        _ => PathBuf::from(s),
    };
    if !p.is_absolute() {
        return Err(PathRefusal::FullPath);
    }
    p = lexical(&p);
    let canon = |q: &Path| q.canonicalize().unwrap_or_else(|_| q.to_path_buf());
    let (shared, private) = (canon(shared_root), canon(private_root));
    let resolved = tegg_vault::on_disk_path(&p).unwrap_or(p);
    let real = canon(&resolved);
    // The real path decides: a symbolic link inside shared storage that points elsewhere is outside it (QA AND-1).
    let under = |base: &Path| real.starts_with(base);
    if !under(&shared) || (private.starts_with(&shared) && under(&private)) || under(&private) {
        return Err(PathRefusal::OutsideShared);
    }
    if !real.is_dir() {
        return Err(PathRefusal::NotFound);
    }
    if need_vault && !is_vault(&real) {
        return Err(PathRefusal::NotAVault);
    }
    Ok(resolved)
}
