//! MS6 slice 6A (docs/contracts/ms6-trash-media.md §1, §2, §3.2): the trash in the core. Listing `.trash/` from the
//! file system only (AR-01, FR-HIS-01 AC-10), moving objects and their unshared pairs into `.trash/` and back (renames
//! only), removing trash entries through the platform's `SystemTrash` (D-619: never an unlink), and resolving links to
//! media files and to objects that are only in the trash (D-615).

use std::collections::{BTreeSet, HashMap};
use std::sync::Arc;

use serde_json::Value;
use tegg_format::nfc;
use tegg_index::ObjectInfo;
use tegg_vault::{FsEntry, SystemTrash, VaultError};

use crate::{lock, Core, CoreError, CoreEvent, FileVersion, LinkFields, LinkKind, LinkTarget, Resolver, Shared};

const TRASH: &str = ".trash";
/// Folders that are never a folder row: their files are rows of their own (§1.2).
const SYSTEM_FOLDERS: [&str; 8] = ["Pages", "Tasks", "Quick Notes", "Daily", "Tags", "Images", "PDFs", "_attachments"];

/// What a trash row is (ms6-trash-media §1.2, R70 `data-kind`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TrashKind {
    Object,
    File,
    Folder,
}

/// One row of the Trash page (ms6-trash-media §1.2).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TrashEntry {
    /// The row's main entry under `.trash/` (object file, bare file or folder), NFC.
    pub path: String,
    pub kind: TrashKind,
    /// `path` without the `.trash/` prefix.
    pub original: String,
    /// The original's parent folder (`Pages`, `_attachments`, `` for the root), or the folder itself for a folder row.
    pub folder: String,
    /// Object title (title, else stem); file name for a file; folder name for a folder.
    pub title: String,
    /// The object's type key; `None` for a file or folder row.
    pub type_key: Option<String>,
    /// Every vault path the row moves (the object and its paired file; all files of a folder).
    pub files: Vec<String>,
    /// Folder: number of `.md` files inside; else 1.
    pub count: u32,
    /// `changed_ns` of `path` (R71).
    pub trashed_ns: i128,
}

/// One rename done by a trash operation (ms6-trash-media §1.4).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Moved {
    pub from: String,
    pub to: String,
}

/// The outcome of `trash_delete` / `trash_empty` (ms6-trash-media §1.4).
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct TrashRemoval {
    pub removed: Vec<String>,
    /// (path, reason)
    pub failed: Vec<(String, String)>,
}

fn fold(s: &str) -> String {
    nfc(s).to_lowercase()
}

fn parent(p: &str) -> &str {
    p.rsplit_once('/').map(|(d, _)| d).unwrap_or("")
}

fn name(p: &str) -> &str {
    p.rsplit('/').next().unwrap_or(p)
}

fn is_md(p: &str) -> bool {
    p.to_ascii_lowercase().ends_with(".md")
}

fn hidden(p: &str) -> bool {
    p.split('/').any(|c| c.starts_with('.'))
}

/// §3.2: a target whose last segment has an extension other than `.md` (short, no spaces) names a media file.
pub(crate) fn is_media_target(t: &str) -> bool {
    match name(t).rsplit_once('.') {
        Some((stem, ext)) if !stem.is_empty() => {
            !ext.is_empty() && ext.len() <= 5 && ext.chars().all(|c| c.is_ascii_alphanumeric()) && !ext.eq_ignore_ascii_case("md")
        }
        _ => false,
    }
}

/// §3.2: `image` / `pdf` by the extension class, else none.
pub(crate) fn type_of_ext(file: &str) -> Option<String> {
    let ext = name(file).rsplit_once('.').map(|(_, e)| e.to_ascii_lowercase()).unwrap_or_default();
    match ext.as_str() {
        "png" | "jpg" | "jpeg" | "gif" | "webp" | "heic" | "svg" => Some("image".into()),
        "pdf" => Some("pdf".into()),
        _ => None,
    }
}

/// Files of one area (live or trashed, trashed ones without the `.trash/` prefix), indexed by Obsidian's lookups.
#[derive(Default)]
pub(crate) struct FileSet {
    pub paths: Vec<String>,
    by_path: HashMap<String, usize>,
    by_name: HashMap<String, Vec<usize>>,
}

impl FileSet {
    fn new(mut paths: Vec<String>) -> FileSet {
        paths.sort();
        let mut by_path = HashMap::new();
        let mut by_name: HashMap<String, Vec<usize>> = HashMap::new();
        for (i, p) in paths.iter().enumerate() {
            by_path.insert(fold(p), i);
            by_name.entry(fold(name(p))).or_default().push(i);
        }
        FileSet { paths, by_path, by_name }
    }

    /// §3.2: the exact path (case-insensitive, NFC), then the name in `from_dir`, then the unique name anywhere
    /// (several: the shortest path, then path order).
    pub fn resolve(&self, from_dir: &str, target: &str) -> Option<&str> {
        let t = fold(target.trim().trim_start_matches('/'));
        if let Some(&i) = self.by_path.get(&t) {
            return Some(&self.paths[i]);
        }
        if t.contains('/') {
            return None;
        }
        let c = self.by_name.get(&t)?;
        let dir = fold(from_dir);
        c.iter()
            .copied()
            .find(|&i| fold(parent(&self.paths[i])) == dir)
            .or_else(|| c.iter().copied().min_by(|&a, &b| (self.paths[a].chars().count(), &self.paths[a]).cmp(&(self.paths[b].chars().count(), &self.paths[b]))))
            .map(|i| self.paths[i].as_str())
    }
}

/// The vault's non-note files and the trash, read from the file system (ms6-trash-media §2, §3.2).
#[derive(Default)]
pub(crate) struct FileCache {
    /// Live non-`.md` files outside `_templates/` and hidden folders.
    pub live: FileSet,
    /// Trashed non-`.md` files, without the `.trash/` prefix.
    pub trashed_files: FileSet,
    /// Trashed objects with their original paths (`.trash/` removed).
    pub trashed: Vec<ObjectInfo>,
}

/// A trashed object's `ObjectInfo` from its bytes (the index's title and type rules).
pub(crate) fn info_of(path: &str, bytes: &[u8]) -> ObjectInfo {
    let stem = name(path).strip_suffix(".md").or_else(|| name(path).strip_suffix(".MD")).unwrap_or(name(path));
    let ex = tegg_format::extract(bytes, stem);
    let attributes = match ex.attributes {
        Some(Value::Object(m)) => Value::Object(m),
        _ => Value::Object(Default::default()),
    };
    let (r#type, type_single, type_raw) = match attributes.get("type") {
        None => ("page".to_string(), true, None),
        Some(Value::String(t)) if !t.trim().is_empty() => (tegg_format::type_key(t), true, Some(nfc(t.trim()))),
        Some(_) => ("page".to_string(), false, None),
    };
    let aliases = match attributes.get("aliases") {
        Some(Value::Array(a)) => a.iter().filter_map(|v| v.as_str()).map(nfc).collect(),
        Some(Value::String(a)) => vec![nfc(a)],
        _ => Vec::new(),
    };
    ObjectInfo {
        path: path.to_string(),
        id: ex.id,
        r#type,
        type_single,
        type_raw,
        title: ex.title,
        aliases,
        tags: ex.tags,
        attributes,
        folder: parent(path).to_string(),
        stored_title: None,
    }
}

/// The link text of a `file:` value (`"[[záhon.png]]"`, `[[x|alias]]`, or a plain name).
fn file_target(o: &ObjectInfo) -> Option<String> {
    let v = o.attributes.get("file")?.as_str()?.trim().to_string();
    let inner = v.strip_prefix("![[").or_else(|| v.strip_prefix("[[")).and_then(|r| r.strip_suffix("]]")).unwrap_or(&v);
    let inner = inner.split('|').next().unwrap_or(inner).split('#').next().unwrap_or(inner).trim();
    (!inner.is_empty()).then(|| nfc(inner))
}

impl Shared {
    fn build_file_cache(&self) -> FileCache {
        let Ok(entries) = self.vault.entries() else { return FileCache::default() };
        let (mut live, mut tfiles, mut tmd) = (Vec::new(), Vec::new(), Vec::new());
        for e in entries {
            let FsEntry::File { path } = e else { continue };
            let path = nfc(&path);
            if let Some(rest) = path.strip_prefix(".trash/") {
                if hidden(rest) {
                    continue;
                }
                if is_md(rest) {
                    tmd.push(path.clone());
                } else {
                    tfiles.push(rest.to_string());
                }
            } else if !hidden(&path) && !is_md(&path) && !path.starts_with("_templates/") {
                live.push(path);
            }
        }
        let trashed = tmd
            .iter()
            .filter_map(|p| {
                let (bytes, _) = self.vault.read(p).ok()?;
                Some(info_of(p.strip_prefix(".trash/").unwrap_or(p), &bytes))
            })
            .collect();
        FileCache { live: FileSet::new(live), trashed_files: FileSet::new(tfiles), trashed }
    }
}

impl Core {
    pub(crate) fn file_cache(&self) -> Arc<FileCache> {
        let mut c = lock(&self.shared.files);
        if let Some(f) = c.as_ref() {
            return f.clone();
        }
        let f = Arc::new(self.shared.build_file_cache());
        *c = Some(f.clone());
        f
    }

    fn drop_file_cache(&self) {
        *lock(&self.shared.files) = None;
    }
}

/// The live object whose `file:` resolves to `file` (path order), from `objs`.
fn object_of<'a>(cache: &FileCache, objs: &'a [ObjectInfo], file: &str) -> Option<&'a ObjectInfo> {
    let mut found: Vec<&ObjectInfo> = objs
        .iter()
        .filter(|o| !o.path.starts_with("_templates/"))
        .filter(|o| file_target(o).and_then(|t| cache.live.resolve(&o.folder, &t).map(|f| f == file)).unwrap_or(false))
        .collect();
    found.sort_by(|a, b| a.path.cmp(&b.path));
    found.into_iter().next()
}

/// §3.2 then §2 for a target the live objects don't resolve; `None` = still unresolved.
pub(crate) fn resolve_more(cache: &FileCache, objs: &[ObjectInfo], shared: &Shared, from: &str, target: &str) -> Option<(LinkTarget, LinkFields)> {
    let mut t = nfc(target.trim());
    if let Some(i) = t.find('|') {
        t.truncate(i);
    }
    if let Some(i) = t.find('#') {
        t.truncate(i);
    }
    let t = t.trim().to_string();
    let from_dir = parent(from);
    let out = |kind, path: String, title: String, ty: Option<String>, object: Option<String>| {
        Some((LinkTarget { target: target.to_string(), kind, path: Some(path), title: Some(title), r#type: ty }, LinkFields { object, ..Default::default() }))
    };
    if is_media_target(&t) {
        if let Some(file) = cache.live.resolve(from_dir, &t) {
            return match object_of(cache, objs, file) {
                Some(o) => out(LinkKind::Media, file.to_string(), o.title.clone(), Some(o.r#type.clone()), Some(o.path.clone())),
                None => out(LinkKind::Media, file.to_string(), name(file).to_string(), type_of_ext(file), None),
            };
        }
        if let Some(file) = cache.trashed_files.resolve(from_dir, &t) {
            let pair = cache.trashed.iter().find(|o| file_target(o).and_then(|ft| cache.trashed_files.resolve(&o.folder, &ft).map(|f| f == file)).unwrap_or(false));
            return match pair {
                Some(o) => out(LinkKind::Trashed, format!("{TRASH}/{}", o.path), o.title.clone(), Some(o.r#type.clone()), None),
                None => out(LinkKind::Trashed, format!("{TRASH}/{file}"), name(file).to_string(), type_of_ext(file), None),
            };
        }
        return None;
    }
    if cache.trashed.is_empty() {
        return None;
    }
    let r = Resolver::new(&cache.trashed, shared).resolve(from, &[target.to_string()]).into_iter().next()?;
    match (r.kind, r.path) {
        (LinkKind::Note, Some(p)) => out(LinkKind::Trashed, format!("{TRASH}/{p}"), r.title.unwrap_or_default(), r.r#type, None),
        _ => None,
    }
}

impl Core {
    /// §1.2: the rows of the Trash page, newest first (R71).
    pub fn trash_list(&self) -> Vec<TrashEntry> {
        let vault = &self.shared.vault;
        let Ok(entries) = vault.entries() else { return Vec::new() };
        let live_folders: BTreeSet<String> = SYSTEM_FOLDERS
            .iter()
            .map(|s| fold(s))
            .chain(self.types().into_iter().map(|t| fold(&t.folder)))
            .chain(std::iter::once(fold(&self.vault_settings().attachments)))
            .collect();
        let (mut dirs, mut files) = (Vec::new(), Vec::new());
        for e in entries {
            match e {
                FsEntry::Dir { path } => {
                    let path = nfc(&path);
                    if let Some(rest) = path.strip_prefix(".trash/") {
                        if !rest.contains('/') && !rest.starts_with('.') && !live_folders.contains(&fold(rest)) {
                            dirs.push(path);
                        }
                    }
                }
                FsEntry::File { path } => {
                    let path = nfc(&path);
                    if let Some(rest) = path.strip_prefix(".trash/") {
                        if !hidden(rest) {
                            files.push(path);
                        }
                    }
                }
            }
        }
        files.sort();
        let in_folder = |f: &str| dirs.iter().any(|d| f.starts_with(&format!("{d}/")));
        let ns = |p: &str| vault.changed_ns(p).ok().flatten().unwrap_or(0);
        let mut rows = Vec::new();
        for d in &dirs {
            let inside: Vec<String> = files.iter().filter(|f| f.starts_with(&format!("{d}/"))).cloned().collect();
            let rest = d.strip_prefix(".trash/").unwrap_or(d).to_string();
            rows.push(TrashEntry {
                path: d.clone(),
                kind: TrashKind::Folder,
                original: rest.clone(),
                folder: rest.clone(),
                title: rest,
                type_key: None,
                count: inside.iter().filter(|f| is_md(f)).count() as u32,
                // A file system that can't stat folders: the newest of its files.
                trashed_ns: vault.changed_ns(d).ok().flatten().unwrap_or_else(|| inside.iter().map(|f| ns(f)).max().unwrap_or(0)),
                files: inside,
            });
        }
        let mut paired: BTreeSet<String> = BTreeSet::new();
        let mut objects = Vec::new();
        for f in files.iter().filter(|f| is_md(f) && !in_folder(f)) {
            let Ok((bytes, _)) = vault.read(f) else { continue };
            let rest = f.strip_prefix(".trash/").unwrap_or(f);
            let info = info_of(rest, &bytes);
            let mut row_files = vec![f.clone()];
            if let Some(p) = self.pair_of(f).filter(|p| p.starts_with(".trash/") && !paired.contains(p)) {
                paired.insert(p.clone());
                row_files.push(p);
            }
            objects.push(TrashEntry {
                path: f.clone(),
                kind: TrashKind::Object,
                original: rest.to_string(),
                folder: parent(rest).to_string(),
                title: info.title.clone(),
                type_key: Some(info.r#type.clone()),
                files: row_files,
                count: 1,
                trashed_ns: ns(f),
            });
        }
        rows.extend(objects);
        for f in files.iter().filter(|f| !is_md(f) && !in_folder(f) && !paired.contains(*f)) {
            let rest = f.strip_prefix(".trash/").unwrap_or(f);
            rows.push(TrashEntry {
                path: f.clone(),
                kind: TrashKind::File,
                original: rest.to_string(),
                folder: parent(rest).to_string(),
                title: name(rest).to_string(),
                type_key: None,
                files: vec![f.clone()],
                count: 1,
                trashed_ns: ns(f),
            });
        }
        rows.sort_by(|a, b| b.trashed_ns.cmp(&a.trashed_ns).then_with(|| fold(&a.path).cmp(&fold(&b.path))));
        rows
    }

    /// §1.3 (D-616): the vault path of the file an Image or PDF object's `file:` links to (a trashed object: inside
    /// `.trash/` first, then live).
    pub fn pair_of(&self, object_path: &str) -> Option<String> {
        let path = nfc(object_path);
        let cache = self.file_cache();
        if let Some(rest) = path.strip_prefix(".trash/") {
            let o = cache.trashed.iter().find(|o| o.path == rest)?;
            let t = file_target(o)?;
            if let Some(f) = cache.trashed_files.resolve(&o.folder, &t) {
                return Some(format!("{TRASH}/{f}"));
            }
            return cache.live.resolve(&o.folder, &t).map(str::to_string);
        }
        let o = self.object(&path)?;
        cache.live.resolve(&o.folder, &file_target(&o)?).map(str::to_string)
    }

    /// FR-ATT-07 (§3.2): the notes whose links resolve to the live file paired with `object_path`, with those targets.
    pub(crate) fn media_sources(&self, object_path: &str) -> Vec<(String, Vec<String>)> {
        let Some(file) = self.pair_of(object_path).filter(|f| !f.starts_with(".trash/")) else { return Vec::new() };
        let cache = self.file_cache();
        let candidates = self.index().sources_linking_name(name(&file));
        candidates
            .into_iter()
            .filter(|(src, _)| nfc(src) != nfc(object_path))
            .filter_map(|(src, targets)| {
                let hits: Vec<String> = targets
                    .into_iter()
                    .filter(|t| {
                        let t = t.split('|').next().unwrap_or(t).split('#').next().unwrap_or(t).trim();
                        cache.live.resolve(parent(&src), t) == Some(file.as_str())
                    })
                    .collect();
                (!hits.is_empty()).then_some((src, hits))
            })
            .collect()
    }

    /// §1.3: whether another live object (not templates or the trash) links the same file.
    fn pair_shared(&self, object_path: &str, file: &str) -> bool {
        let cache = self.file_cache();
        self.objects()
            .iter()
            .filter(|o| o.path != object_path && !o.path.starts_with("_templates/"))
            .any(|o| file_target(o).and_then(|t| cache.live.resolve(&o.folder, &t).map(|f| f == file)).unwrap_or(false))
    }

    fn reindex(&self, path: &str) {
        if !is_md(path) || path.starts_with(".trash/") || hidden(path) {
            return;
        }
        if let Ok((bytes, v)) = self.shared.vault.read(path) {
            let _ = self.index().upsert(path, &bytes, &v);
        }
    }

    fn changed(&self, moved: &[Moved]) {
        self.drop_file_cache();
        let paths = moved.iter().flat_map(|m| [m.from.clone(), m.to.clone()]).collect();
        self.shared.emit(CoreEvent::VaultChanged { paths });
    }

    /// §1.4: the version check of `trash_checked`, the object's rename, then its unshared pair's rename; a failed
    /// second rename moves the object back.
    pub fn trash_object(&self, path: &str, base: &FileVersion) -> Result<Vec<Moved>, CoreError> {
        let path = nfc(path);
        if path.starts_with(".trash/") || path.starts_with(".tegg/") || path == ".tegg" {
            return Err(CoreError::Invalid { reason: "can't be moved to the trash".into() });
        }
        let pair = self.pair_of(&path).filter(|f| !f.starts_with(".trash/") && !self.pair_shared(&path, f));
        let vault = &self.shared.vault;
        let to = vault.trash_checked(&path, base)?;
        let mut moved = vec![Moved { from: path.clone(), to: to.clone() }];
        if let Some(f) = pair {
            match vault.trash(&f) {
                Ok(t) => moved.push(Moved { from: f, to: t }),
                Err(e) => {
                    let _ = vault.move_back(&to, &path);
                    self.drop_file_cache();
                    return Err(e.into());
                }
            }
        }
        let _ = self.index().remove(&path);
        self.changed(&moved);
        Ok(moved)
    }

    /// §1.4: restores a row (object with its pair, file, or folder).
    pub fn trash_restore(&self, path: &str) -> Result<Vec<Moved>, CoreError> {
        let path = nfc(path.trim_end_matches('/'));
        if !path.starts_with(".trash/") {
            return Err(CoreError::Invalid { reason: "not in the trash".into() });
        }
        let vault = &self.shared.vault;
        let is_dir = vault.entries()?.into_iter().any(|e| matches!(e, FsEntry::Dir { path: p } if nfc(&p) == path));
        let mut moved = Vec::new();
        if is_dir {
            let to = vault.restore_dir(&path)?;
            for e in vault.entries()? {
                if let FsEntry::File { path: f } = e {
                    if nfc(&f).starts_with(&format!("{to}/")) {
                        self.reindex(&nfc(&f));
                    }
                }
            }
            moved.push(Moved { from: path, to });
        } else {
            let pair = if is_md(&path) { self.pair_of(&path).filter(|f| f.starts_with(".trash/")) } else { None };
            let to = vault.restore(&path)?;
            self.reindex(&to);
            moved.push(Moved { from: path, to });
            if let Some(f) = pair {
                let t = vault.restore(&f)?;
                moved.push(Moved { from: f, to: t });
            }
        }
        self.changed(&moved);
        Ok(moved)
    }

    /// The vault paths a row moves, for a row path (or the path itself when it is no row).
    fn row_files(&self, path: &str) -> Vec<String> {
        match self.trash_list().into_iter().find(|r| r.path == path) {
            Some(r) if r.kind == TrashKind::Folder => vec![r.path],
            Some(r) => r.files,
            None => vec![path.to_string()],
        }
    }

    /// §1.4 (D-619): every file of each row through `sink`.
    pub fn trash_delete(&self, paths: &[String], sink: &dyn SystemTrash) -> TrashRemoval {
        let mut out = TrashRemoval::default();
        for p in paths {
            let p = nfc(p.trim_end_matches('/'));
            if !p.starts_with(".trash/") {
                out.failed.push((p, "not in the trash".into()));
                continue;
            }
            for f in self.row_files(&p) {
                match self.shared.vault.remove_to(&f, sink) {
                    Ok(()) => out.removed.push(f),
                    Err(e) => out.failed.push((f, reason(&e))),
                }
            }
        }
        self.after_removal(&out);
        out
    }

    /// §1.4 (D-619): every top-level entry of `.trash/` through `sink`; `.trash/` itself stays.
    pub fn trash_empty(&self, sink: &dyn SystemTrash) -> TrashRemoval {
        let mut out = TrashRemoval::default();
        let Ok(entries) = self.shared.vault.entries() else { return out };
        let mut top: Vec<String> = entries
            .into_iter()
            .map(|e| match e {
                FsEntry::File { path } | FsEntry::Dir { path } => nfc(&path),
            })
            .filter(|p| p.strip_prefix(".trash/").is_some_and(|r| !r.is_empty() && !r.contains('/')))
            .collect();
        top.sort();
        for p in top {
            match self.shared.vault.remove_to(&p, sink) {
                Ok(()) => out.removed.push(p),
                Err(e) => out.failed.push((p, reason(&e))),
            }
        }
        self.after_removal(&out);
        out
    }

    fn after_removal(&self, r: &TrashRemoval) {
        self.drop_file_cache();
        if !r.removed.is_empty() {
            self.shared.emit(CoreEvent::VaultChanged { paths: r.removed.clone() });
        }
    }
}

fn reason(e: &VaultError) -> String {
    match e {
        VaultError::Io(e) => e.to_string(),
        other => format!("{other:?}"),
    }
}
