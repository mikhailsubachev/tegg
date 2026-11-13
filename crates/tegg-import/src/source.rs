//! §3: the source of an import, a zip read in place or a folder, as a directory of entries. No file content is kept:
//! entries are read on demand through `tegg-vault`'s read-only access (AR-04). Rewritten from the S5 spike's
//! `source.rs`, which held every entry's bytes in memory.

use std::io::{self, Read};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use tegg_vault::{ExternalFolder, ExternalRead, ReadSeek};

use crate::layout::{self, Layout};
use crate::note;
use crate::{Control, EntryStamp, FileStamp, ImportError, ImportPhase, ImportProgress, ScanInfo, SourceKind, SourceStamp, SpaceInfo, TypeCount, Unreadable, UnreadableReason};

type Archive = zip::ZipArchive<Box<dyn ReadSeek>>;

/// One file of the source with a usable name.
#[derive(Clone, Debug)]
pub(crate) struct Entry {
    /// NFC, `/`-separated, no leading `./`.
    pub path: String,
    /// A folder: the name as the file system stores it. A zip: unused.
    raw: String,
    /// A zip: the entry's index in the directory.
    index: usize,
    pub size: u64,
    pub mtime_ns: Option<i128>,
    pub crc32: Option<u32>,
    /// `Read` or `Encrypted`: the entry can't be read (a note: found while scanning; a zip entry: its flag).
    pub fail: Option<UnreadableReason>,
    /// A note (`.md`, not a dotfile) that could be read: what the scan keeps of it.
    pub meta: Option<NoteMeta>,
}

/// What the scan keeps of a note: its `type:` value and its title (to name links into other spaces), never its text.
#[derive(Clone, Debug, Default)]
pub(crate) struct NoteMeta {
    pub ctype: Option<String>,
    pub title: Option<String>,
}

/// Why an entry couldn't be read now.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum ReadFail {
    /// The source or the entry isn't there any more.
    Gone,
    /// Its size, modification time or checksum differs from the scan's.
    Changed,
    Read,
    Encrypted,
}

/// §3: the opaque handle of a scanned source.
pub struct Source {
    pub(crate) kind: SourceKind,
    pub(crate) path: PathBuf,
    #[allow(dead_code)]
    pub(crate) name: String,
    /// A zip: the file's size and modification time.
    pub(crate) container: Option<(u64, i128)>,
    /// In path order (NFC, by code point).
    pub(crate) entries: Vec<Entry>,
    /// Entries with no usable name (`BadName`, `Traversal`).
    pub(crate) bad: Vec<Unreadable>,
    pub(crate) layout: Layout,
    zip: Mutex<Option<Archive>>,
}

fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

/// A zip entry's name as §3 reads it: UTF-8 also without the flag, `\` as `/`, a leading `./` dropped, NFC.
/// `Err`: the reason and the name to report.
pub(crate) fn decode_name(raw: &[u8]) -> Result<String, (UnreadableReason, String)> {
    let Ok(name) = std::str::from_utf8(raw) else { return Err((UnreadableReason::BadName, String::from_utf8_lossy(raw).into_owned())) };
    let mut name = name.replace('\\', "/");
    let b = name.as_bytes();
    let drive = b.len() >= 2 && b[0].is_ascii_alphabetic() && b[1] == b':';
    if name.starts_with('/') || drive || name.split('/').any(|p| p == "..") || name.contains('\0') {
        return Err((UnreadableReason::Traversal, name));
    }
    while let Some(rest) = name.strip_prefix("./") {
        name = rest.to_string();
    }
    Ok(tegg_format::nfc(&name))
}

struct Ticker<'a> {
    ctl: &'a Control,
    phase: ImportPhase,
    total: u64,
    last: Option<Instant>,
}
impl<'a> Ticker<'a> {
    pub fn new(ctl: &'a Control, phase: ImportPhase, total: u64) -> Ticker<'a> {
        Ticker { ctl, phase, total, last: None }
    }
    fn emit(&self, phase: ImportPhase, done: u64) {
        if let Some(sink) = &self.ctl.progress {
            sink(&ImportProgress { phase, step: None, done, total: self.total, step_done: 0, step_total: 0, counts: None, job: None });
        }
    }
    /// One step done. `Err(Cancelled)` after a final `Cancelled` event when the caller cancelled.
    pub fn step(&mut self, done: u64) -> Result<(), ImportError> {
        if self.ctl.cancel.is_cancelled() {
            self.emit(ImportPhase::Cancelled, done);
            return Err(ImportError::Cancelled);
        }
        if self.last.is_none_or(|t| t.elapsed() >= Duration::from_millis(100)) || done == self.total {
            // The interval counts from an event's start, not its end: a sink that takes 100 ms or more (the shell's
            // `TEGG_TEST_IMPORT_PACE` sleep, v1-import-window §8) then sees every step as an event.
            self.last = Some(Instant::now());
            self.emit(self.phase.clone(), done);
        }
        Ok(())
    }
}
/// Progress and cancel of `scan` and `plan` (§10.2).
pub(crate) struct Progress<'a>(Ticker<'a>);
impl<'a> Progress<'a> {
    pub fn new(ctl: &'a Control, phase: ImportPhase, total: usize) -> Progress<'a> {
        Progress(Ticker::new(ctl, phase, total as u64))
    }
    pub fn step(&mut self, done: usize) -> Result<(), ImportError> {
        self.0.step(done as u64)
    }
}

fn io_gone(e: &io::Error) -> bool {
    matches!(e.kind(), io::ErrorKind::NotFound | io::ErrorKind::NotADirectory)
}

fn open_archive(path: &Path) -> Result<Archive, ImportError> {
    let file = tegg_vault::open_external_file(path).map_err(|e| if io_gone(&e) { ImportError::SourceGone { entry: None } } else { ImportError::UnreadableArchive })?;
    zip::ZipArchive::new(file).map_err(|_| ImportError::UnreadableArchive)
}

fn read_all(r: &mut dyn Read, size: u64) -> io::Result<Vec<u8>> {
    let mut out = Vec::with_capacity(size.min(1 << 20) as usize);
    r.read_to_end(&mut out)?;
    Ok(out)
}

/// §3 `scan`.
pub(crate) fn scan(path: &Path, ctl: &Control) -> Result<(Source, ScanInfo), ImportError> {
    let gone = || ImportError::SourceGone { entry: None };
    let name = tegg_format::nfc(&path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default());
    let stat = tegg_vault::stat_external(path).map_err(|e| ImportError::Io { reason: e.to_string() })?.ok_or_else(gone)?;
    let is_folder = tegg_vault::list_external_dir(path).is_ok();
    let mut src = Source {
        kind: if is_folder { SourceKind::Folder } else { SourceKind::Zip },
        path: path.to_path_buf(),
        name: name.clone(),
        container: (!is_folder).then_some(stat),
        entries: Vec::new(),
        bad: Vec::new(),
        layout: Layout::default(),
        zip: Mutex::new(None),
    };
    if is_folder {
        let listed = ExternalFolder::new(path).list().map_err(|e| if io_gone(&e) { gone() } else { ImportError::Io { reason: e.to_string() } })?;
        for (raw, size, mtime) in listed {
            src.entries.push(Entry { path: tegg_format::nfc(&raw), raw, index: 0, size, mtime_ns: Some(mtime), crc32: None, fail: None, meta: None });
        }
    } else {
        let mut archive = open_archive(path)?;
        let mut files = 0usize;
        let mut encrypted = 0usize;
        for i in 0..archive.len() {
            let Ok(f) = archive.by_index_raw(i) else {
                src.bad.push(Unreadable { entry: format!("#{i}"), reason: UnreadableReason::Read });
                continue;
            };
            let raw_name = f.name_raw().to_vec();
            if raw_name.ends_with(b"/") || raw_name.ends_with(b"\\") {
                continue;
            }
            files += 1;
            encrypted += f.encrypted() as usize;
            match decode_name(&raw_name) {
                Ok(p) if p.is_empty() => src.bad.push(Unreadable { entry: format!("#{i}"), reason: UnreadableReason::BadName }),
                Ok(p) => src.entries.push(Entry { path: p, raw: String::new(), index: i, size: f.size(), mtime_ns: None, crc32: Some(f.crc32()), fail: f.encrypted().then_some(UnreadableReason::Encrypted), meta: None }),
                Err((reason, shown)) => src.bad.push(Unreadable { entry: if shown.is_empty() { format!("#{i}") } else { shown }, reason }),
            }
        }
        if files > 0 && encrypted == files {
            return Err(ImportError::EncryptedArchive);
        }
        *lock(&src.zip) = Some(archive);
    }
    src.entries.sort_by(|a, b| a.path.cmp(&b.path));
    src.entries.dedup_by(|b, a| a.path == b.path);

    // Every note is read once: its `type:` value decides the layout and the counts.
    let total = src.entries.len();
    let mut progress = Progress::new(ctl, ImportPhase::Reading, total);
    for i in 0..total {
        progress.step(i)?;
        let e = &src.entries[i];
        if !layout::is_object(&e.path) || e.fail.is_some() {
            continue;
        }
        match src.read(e) {
            Ok(bytes) => {
                let meta = std::str::from_utf8(&bytes).ok().map(note_meta).unwrap_or_default();
                src.entries[i].meta = Some(meta);
            }
            Err(ReadFail::Gone) => return Err(gone()),
            Err(ReadFail::Encrypted) => src.entries[i].fail = Some(UnreadableReason::Encrypted),
            Err(_) => src.entries[i].fail = Some(UnreadableReason::Read),
        }
    }
    let flat_name = layout::without_zip(&name).to_string();
    let typed: Vec<(&str, bool)> = src.entries.iter().map(|e| (e.path.as_str(), e.meta.as_ref().is_some_and(|m| m.ctype.is_some()))).collect();
    src.layout = layout::detect(&typed, &flat_name).ok_or(ImportError::NotCapacities)?;

    let mut spaces: Vec<SpaceInfo> = Vec::new();
    let mut outside = 0usize;
    for e in &src.entries {
        let Some((space, inner)) = src.layout.space_of(&e.path) else {
            outside += 1;
            continue;
        };
        let at = match spaces.iter().position(|s| s.name == space) {
            Some(i) => i,
            None => {
                spaces.push(SpaceInfo { name: space.to_string(), objects: 0, attachments: 0, types: Vec::new() });
                spaces.len() - 1
            }
        };
        let s = &mut spaces[at];
        if layout::is_object(inner) {
            s.objects += 1;
            if let Some(t) = e.meta.as_ref().and_then(|m| m.ctype.clone()) {
                match s.types.iter_mut().find(|x| x.source_type == t) {
                    Some(x) => x.objects += 1,
                    None => s.types.push(TypeCount { source_type: t, objects: 1 }),
                }
            }
        } else if layout::is_attachment(inner) {
            s.attachments += 1;
        }
    }
    for s in &mut spaces {
        s.types.sort_by(|a, b| a.source_type.cmp(&b.source_type));
    }
    spaces.retain(|s| s.objects > 0);
    if spaces.is_empty() {
        return Err(ImportError::Empty);
    }
    spaces.sort_by(|a, b| b.objects.cmp(&a.objects).then_with(|| a.name.cmp(&b.name)));
    let mut unreadable = src.bad.clone();
    unreadable.extend(src.entries.iter().filter_map(|e| e.fail.clone().map(|reason| Unreadable { entry: e.path.clone(), reason })));
    progress.step(total)?;
    let info = ScanInfo { kind: src.kind.clone(), name, size: src.container.map(|c| c.0), files: src.entries.len() + src.bad.len(), unreadable, outside_spaces: outside, spaces };
    Ok((src, info))
}

/// The `type:` value and the title of a note, as far as its frontmatter can be read.
fn note_meta(text: &str) -> NoteMeta {
    match note::frontmatter(text, None) {
        Ok(fm) => {
            let get = |k: &str| fm.iter().find(|(key, _)| key == k).and_then(|(_, v)| v.scalar());
            NoteMeta { ctype: get("type").map(|t| t.trim().to_string()).filter(|t| !t.is_empty()), title: get("title").map(|t| note::clean_title(&t)) }
        }
        Err(_) => NoteMeta { ctype: note::type_line(text), title: None },
    }
}

impl Source {
    /// The entries of a space with their paths inside it, in path order.
    pub(crate) fn space_entries<'a>(&'a self, space: &'a str) -> impl Iterator<Item = (&'a str, &'a Entry)> + 'a {
        self.entries.iter().filter_map(move |e| self.layout.space_of(&e.path).filter(|(s, _)| *s == space).map(|(_, inner)| (inner, e)))
    }

    /// The container (a zip) is still the file that was scanned; a folder is still there.
    pub(crate) fn check_container(&self) -> Result<(), ImportError> {
        let now = tegg_vault::stat_external(&self.path).ok().flatten();
        match (self.container, now) {
            (_, None) => Err(ImportError::SourceGone { entry: None }),
            (Some(was), Some(is)) if was != is => Err(ImportError::SourceChanged { entry: None }),
            _ => Ok(()),
        }
    }

    /// §9.2 step 1: the zip file's size and modification time, or every entry's of the space in a folder.
    pub(crate) fn check_space(&self, space: &str) -> Result<(), ImportError> {
        self.check_container()?;
        if self.kind == SourceKind::Folder {
            let folder = ExternalFolder::new(&self.path);
            for (inner, e) in self.space_entries(space) {
                match folder.stat(&e.raw) {
                    Ok(Some((size, mtime))) if size == e.size && Some(mtime) == e.mtime_ns => {}
                    Ok(Some(_)) => return Err(ImportError::SourceChanged { entry: Some(inner.to_string()) }),
                    _ => return Err(ImportError::SourceGone { entry: Some(inner.to_string()) }),
                }
            }
        }
        Ok(())
    }

    /// The stamp of a space (§5.1 `Stamps.source`).
    pub(crate) fn stamp(&self, space: &str) -> SourceStamp {
        SourceStamp {
            container: self.container.map(|(size, mtime)| FileStamp { size, mtime_ns: mtime.to_string() }),
            entries: self.space_entries(space).map(|(inner, e)| EntryStamp { entry: inner.to_string(), size: e.size, mtime_ns: e.mtime_ns.map(|m| m.to_string()), crc32: e.crc32 }).collect(),
        }
    }

    /// Runs `f` on the entry's bytes as a stream, after the stamp check (§9.2 step 5, §9.4). The reader fails when
    /// the bytes aren't the scanned ones (a zip: the checksum; a folder: the length is checked here afterwards).
    pub(crate) fn with_reader<T>(&self, e: &Entry, f: &mut dyn FnMut(&mut dyn Read) -> io::Result<T>) -> Result<io::Result<T>, ReadFail> {
        match e.fail {
            Some(UnreadableReason::Encrypted) => return Err(ReadFail::Encrypted),
            Some(_) => return Err(ReadFail::Read),
            None => {}
        }
        if self.kind == SourceKind::Folder {
            let folder = ExternalFolder::new(&self.path);
            match folder.stat(&e.raw) {
                Ok(Some((size, mtime))) if size == e.size && Some(mtime) == e.mtime_ns => {}
                Ok(Some(_)) => return Err(ReadFail::Changed),
                Ok(None) => return Err(ReadFail::Gone),
                Err(err) => return Err(if io_gone(&err) { ReadFail::Gone } else { ReadFail::Read }),
            }
            let file = folder.open(&e.raw).map_err(|err| if io_gone(&err) { ReadFail::Gone } else { ReadFail::Read })?;
            let mut counted = Counted { inner: file, read: 0, failed: false };
            let out = f(&mut counted);
            if counted.failed {
                return Err(ReadFail::Read);
            }
            if out.is_ok() && counted.read != e.size {
                return Err(ReadFail::Changed);
            }
            return Ok(out);
        }
        match tegg_vault::stat_external(&self.path).ok().flatten() {
            None => return Err(ReadFail::Gone),
            Some(is) if Some(is) != self.container => return Err(ReadFail::Changed),
            Some(_) => {}
        }
        let mut guard = lock(&self.zip);
        if guard.is_none() {
            *guard = Some(open_archive(&self.path).map_err(|err| if matches!(err, ImportError::SourceGone { .. }) { ReadFail::Gone } else { ReadFail::Read })?);
        }
        let Some(archive) = guard.as_mut() else { return Err(ReadFail::Read) };
        let file = match archive.by_index(e.index) {
            Ok(f) => f,
            Err(zip::result::ZipError::UnsupportedArchive(m)) if m == zip::result::ZipError::PASSWORD_REQUIRED => return Err(ReadFail::Encrypted),
            Err(_) => return Err(ReadFail::Read),
        };
        if file.size() != e.size || Some(file.crc32()) != e.crc32 {
            return Err(ReadFail::Changed);
        }
        let mut counted = Counted { inner: file, read: 0, failed: false };
        let out = f(&mut counted);
        if counted.failed {
            return Err(ReadFail::Read);
        }
        Ok(out)
    }

    /// The entry's bytes, whole (notes and small files only; attachments are streamed).
    pub(crate) fn read(&self, e: &Entry) -> Result<Vec<u8>, ReadFail> {
        let size = e.size;
        match self.with_reader(e, &mut |r| read_all(r, size))? {
            Ok(bytes) => Ok(bytes),
            Err(_) => Err(ReadFail::Read),
        }
    }

    /// What the accounting may see (§6.1): raw paths and the space names, no class and no layout.
    pub(crate) fn raw(&self) -> RawView<'_> {
        let mut spaces: Vec<String> = Vec::new();
        if !self.layout.flat {
            for e in &self.entries {
                if let Some((s, _)) = self.layout.space_of(&e.path) {
                    if !spaces.iter().any(|x| x == s) {
                        spaces.push(s.to_string());
                    }
                }
            }
        }
        RawView { source: self, spaces, single: self.layout.flat.then(|| self.layout.flat_name.clone()), nameless: self.bad.len() }
    }
}

/// A reader that counts its bytes and remembers a failed read (so a source error is told from a target error).
struct Counted<R> {
    inner: R,
    read: u64,
    failed: bool,
}
impl<R: Read> Read for Counted<R> {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        match self.inner.read(buf) {
            Ok(n) => {
                self.read += n as u64;
                Ok(n)
            }
            Err(e) => {
                self.failed = true;
                Err(e)
            }
        }
    }
}

/// §6.1: the raw entries for the independent accounting.
pub(crate) struct RawView<'a> {
    source: &'a Source,
    /// The names of the space folders (empty for an export without them).
    pub spaces: Vec<String>,
    /// An export without space folders: its one space's name.
    pub single: Option<String>,
    /// Entries with no usable name.
    pub nameless: usize,
}
impl RawView<'_> {
    pub fn paths(&self) -> impl Iterator<Item = &str> + '_ {
        self.source.entries.iter().map(|e| e.path.as_str())
    }
    /// The text of an entry; `None` when it can't be read or isn't UTF-8.
    pub fn text(&self, path: &str) -> Option<String> {
        let e = self.source.entries.iter().find(|e| e.path == path)?;
        String::from_utf8(self.source.read(e).ok()?).ok()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn zip_names() {
        assert_eq!(decode_name(b"./PKM\\Pages\\a.md"), Ok("PKM/Pages/a.md".to_string()));
        assert_eq!(decode_name("PKM/Toma\u{301}s\u{30c}.md".as_bytes()), Ok("PKM/Tomáš.md".to_string()));
        assert_eq!(decode_name(b"PKM/\xff\xfe.md").map_err(|e| e.0), Err(UnreadableReason::BadName));
        for bad in ["../x.md", "PKM/../../x.md", "/tmp/x.md", "C:\\x.md"] {
            assert_eq!(decode_name(bad.as_bytes()).map_err(|e| e.0), Err(UnreadableReason::Traversal), "{bad}");
        }
    }

    /// A well-formed zip (written by the `zip` crate), read in place: names, classes, stamps and a bad checksum.
    #[test]
    fn a_zip_is_read_in_place() {
        use std::io::Write;
        use zip::write::SimpleFileOptions;
        let dir = tempfile::tempdir().expect("tempdir");
        let build = |wrapper: &str| {
            let mut w = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
            let stored = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored);
            for (name, data, opts) in [
                ("PKM/Pages/Toma\u{301}s\u{30c}.md", "---\ntype: 'Page'\ntitle: Tomáš\n---\n\n[[Druhá]]\n", SimpleFileOptions::default()),
                ("PKM/Pages/Druhá.md", "---\ntype: 'Page'\ntitle: Druhá\n---\n", stored),
                ("PKM/Images/Media/a.png", "obrázek", SimpleFileOptions::default()),
                ("../zlo.md", "---\ntype: 'Page'\n---\n", SimpleFileOptions::default()),
            ] {
                w.start_file(format!("{wrapper}{name}"), opts).expect("start_file");
                w.write_all(data.as_bytes()).expect("write");
            }
            w.finish().expect("finish").into_inner()
        };
        let path = dir.path().join("Export.zip");
        tegg_vault::write_local_file(&path, &build("")).expect("write the zip");
        let (src, info) = scan(&path, &Control::default()).expect("scan");
        assert_eq!((info.kind.clone(), info.name.as_str(), info.files), (SourceKind::Zip, "Export.zip", 4));
        assert_eq!(info.spaces.iter().map(|s| (s.name.as_str(), s.objects, s.attachments)).collect::<Vec<_>>(), [("PKM", 2, 1)]);
        assert_eq!(info.unreadable.iter().map(|u| u.reason.clone()).collect::<Vec<_>>(), [UnreadableReason::Traversal]);
        let names: Vec<&str> = src.space_entries("PKM").map(|(p, _)| p).collect();
        assert_eq!(names, ["Images/Media/a.png", "Pages/Druhá.md", "Pages/Tomáš.md"], "NFC, in path order");
        let (_, e) = src.space_entries("PKM").next().expect("the attachment");
        assert_eq!(src.read(e).as_deref(), Ok("obrázek".as_bytes()));
        assert!(src.check_space("PKM").is_ok() && src.stamp("PKM").container.is_some());
        // A stored entry whose bytes no longer match its checksum can't be read; the others still can.
        let mut bytes = build("");
        let at = bytes.windows(13).position(|w| w == "title: Druhá".as_bytes().get(..13).unwrap_or(b"")).expect("the stored text");
        bytes[at + 7] ^= 0x20;
        let broken = dir.path().join("Vadný.zip");
        tegg_vault::write_local_file(&broken, &bytes).expect("write");
        let (src, info) = scan(&broken, &Control::default()).expect("the scan completes");
        assert!(info.unreadable.iter().any(|u| u.entry == "PKM/Pages/Druhá.md" && u.reason == UnreadableReason::Read), "{:?}", info.unreadable);
        assert_eq!(src.space_entries("PKM").count(), 3);
        // Truncated: refused. A source that isn't there: gone.
        tegg_vault::write_local_file(&broken, &bytes[..bytes.len() / 2]).expect("write");
        assert_eq!(scan(&broken, &Control::default()).err(), Some(ImportError::UnreadableArchive));
        assert_eq!(scan(&dir.path().join("není.zip"), &Control::default()).err(), Some(ImportError::SourceGone { entry: None }));
        // The zip changed since the scan.
        tegg_vault::write_local_file(&path, &build("obal/")).expect("rewrite");
        assert!(matches!(src_changed(&path), Err(ImportError::SourceChanged { .. })), "a zip changed since the scan is refused");
    }

    fn src_changed(path: &std::path::Path) -> Result<(), ImportError> {
        let (src, info) = scan(path, &Control::default())?;
        assert_eq!(info.spaces.len(), 1, "one wrapper folder is skipped");
        tegg_vault::write_local_file(path, b"jiny obsah").map_err(|e| ImportError::Io { reason: e.to_string() })?;
        src.check_space("PKM")
    }
}
