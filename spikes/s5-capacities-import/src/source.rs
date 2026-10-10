//! FR-IMP-07: read a Capacities export from a zip or an extracted folder into the same entry list.
//! Names are decoded as UTF-8 (even without the zip UTF-8 flag) and normalized to NFC (FR-FMT-12).
//! The system `unzip` is never used.

use std::fs;
use std::io::Read;
use std::path::Path;
use unicode_normalization::UnicodeNormalization;

#[derive(Debug, Clone)]
pub struct Entry {
    /// `/`-separated path inside the export, NFC.
    pub path: String,
    pub bytes: Vec<u8>,
}

#[derive(Debug, Default, Clone, serde::Serialize)]
pub struct ReadStats {
    pub entries: usize,
    /// Entries that could not be read (corrupt data, unsupported compression). S5-QA AC-4: must be 0.
    pub unreadable: usize,
    /// Names that were not valid UTF-8 and fell back to the zip's CP437 decoding.
    pub non_utf8_names: usize,
    /// Names that were not NFC in the source.
    pub non_nfc_names: usize,
}

pub struct Source {
    pub entries: Vec<Entry>,
    pub stats: ReadStats,
}

pub fn read(path: &Path) -> std::io::Result<Source> {
    if path.is_dir() { read_dir(path) } else { read_zip(path) }
}

fn nfc(name: &str, stats: &mut ReadStats) -> String {
    let n: String = name.nfc().collect();
    if n != name { stats.non_nfc_names += 1 }
    n
}

pub fn read_zip(path: &Path) -> std::io::Result<Source> {
    let mut zip = zip::ZipArchive::new(fs::File::open(path)?).map_err(std::io::Error::other)?;
    let mut stats = ReadStats::default();
    let mut entries = Vec::new();
    for i in 0..zip.len() {
        let mut f = match zip.by_index(i) {
            Ok(f) => f,
            Err(_) => { stats.entries += 1; stats.unreadable += 1; continue }
        };
        if f.is_dir() { continue }
        stats.entries += 1;
        let raw = f.name_raw().to_vec();
        let name = match String::from_utf8(raw) {
            Ok(s) => s,
            Err(_) => { stats.non_utf8_names += 1; f.name().to_string() }
        };
        let mut bytes = Vec::with_capacity(f.size() as usize);
        if f.read_to_end(&mut bytes).is_err() { stats.unreadable += 1; continue }
        let name = name.replace('\\', "/");
        let path = nfc(name.trim_start_matches("./").trim_start_matches('/'), &mut stats);
        entries.push(Entry { path, bytes });
    }
    entries.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(Source { entries, stats })
}

pub fn read_dir(root: &Path) -> std::io::Result<Source> {
    let mut stats = ReadStats::default();
    let mut entries = Vec::new();
    fn walk(root: &Path, dir: &Path, out: &mut Vec<(String, std::path::PathBuf)>) -> std::io::Result<()> {
        for e in fs::read_dir(dir)? {
            let e = e?;
            let p = e.path();
            if e.file_type()?.is_dir() { walk(root, &p, out)? } else {
                let rel = p.strip_prefix(root).unwrap().to_string_lossy().replace('\\', "/");
                out.push((rel, p));
            }
        }
        Ok(())
    }
    let mut files = Vec::new();
    walk(root, root, &mut files)?;
    for (rel, p) in files {
        stats.entries += 1;
        match fs::read(&p) {
            Ok(bytes) => entries.push(Entry { path: nfc(&rel, &mut stats), bytes }),
            Err(_) => stats.unreadable += 1,
        }
    }
    entries.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(Source { entries, stats })
}
