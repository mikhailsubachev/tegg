//! The dry run: everything the import preview needs (FR-IMP-05, FR-IMP-19), computed without writing anything.

use crate::convert::{is_windows_reserved, is_generic_media_name, parse_date, sanitize_file_name, DateValue, NameAllocator};
use crate::scan::{self, LinkKind};
use crate::source::{Entry, ReadStats, Source};
use chrono_tz::Tz;
use regex::Regex;
use serde::Serialize;
use std::collections::{BTreeMap, HashMap, HashSet};
use std::sync::LazyLock;
use unicode_normalization::UnicodeNormalization;
use yaml_rust2::{Yaml, YamlLoader};

// ---------- spaces (FR-IMP-22) ----------

#[derive(Debug, Clone, Serialize)]
pub struct SpaceSummary { pub name: String, pub files: usize, pub objects: usize }

/// Where the spaces start inside the export and how deep they are.
struct Layout { prefix: String, flat: bool }

pub const FLAT_SPACE: &str = "(export)";

fn has_type_key(e: &Entry) -> bool {
    e.path.ends_with(".md") && split_frontmatter(&String::from_utf8_lossy(&e.bytes)).0
        .is_some_and(|fm| fm.lines().any(|l| l.starts_with("type:")))
}

/// Typed notes sit at `<space>/<Type folder>/<note>.md`. A single-space export may have no space folder
/// (`<Type folder>/<note>.md`), and a zip may wrap everything in one extra root folder.
fn layout(entries: &[Entry]) -> Layout {
    let mut prefix = String::new();
    loop {
        let depths: Vec<usize> = entries.iter().filter(|e| e.path.starts_with(&prefix) && has_type_key(e))
            .map(|e| e.path[prefix.len()..].split('/').count()).collect();
        let Some(&min) = depths.iter().min() else { return Layout { prefix, flat: true } };
        if min <= 2 { return Layout { prefix, flat: true } }
        if min == 3 { return Layout { prefix, flat: false } }
        let firsts: HashSet<&str> = entries.iter().filter(|e| e.path.starts_with(&prefix))
            .map(|e| e.path[prefix.len()..].split('/').next().unwrap()).collect();
        if firsts.len() != 1 { return Layout { prefix, flat: false } }
        prefix = format!("{prefix}{}/", firsts.into_iter().next().unwrap());
    }
}

/// Space name and the path inside the space, or None for files outside any space.
fn space_of<'a>(l: &Layout, path: &'a str) -> Option<(String, &'a str)> {
    let rest = path.strip_prefix(&l.prefix)?;
    if l.flat { return Some((FLAT_SPACE.into(), rest)) }
    let (space, inner) = rest.split_once('/')?;
    Some((space.to_string(), inner))
}

/// The files of one space as (path inside the space, entry).
pub fn space_files<'a>(src: &'a Source, space: &str) -> Vec<(&'a str, &'a Entry)> {
    let l = layout(&src.entries);
    src.entries.iter().filter_map(|e| space_of(&l, &e.path).filter(|(s, _)| s == space).map(|(_, inner)| (inner, e))).collect()
}

pub fn spaces(src: &Source) -> Vec<SpaceSummary> {
    let l = layout(&src.entries);
    let mut m: BTreeMap<String, SpaceSummary> = BTreeMap::new();
    for e in &src.entries {
        if let Some((s, _)) = space_of(&l, &e.path) {
            let row = m.entry(s.clone()).or_insert(SpaceSummary { name: s, files: 0, objects: 0 });
            row.files += 1;
            if e.path.ends_with(".md") { row.objects += 1 }
        }
    }
    m.into_values().collect()
}

// ---------- report ----------

#[derive(Debug, Default, Clone, Serialize, PartialEq, Eq)]
pub struct Tally { pub total: usize, pub imported: usize, pub reported: usize }

#[derive(Debug, Clone, Serialize)]
pub struct TypeRow { pub source: String, pub target: String, pub folder: String, pub count: usize }

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(tag = "action", content = "to", rename_all = "kebab-case")]
pub enum AttrAction { Keep, Rename(String), Drop, Consumed }

#[derive(Debug, Clone, Serialize)]
pub struct AttrRow {
    pub source_type: String,
    pub key: String,
    pub action: AttrAction,
    /// date, date-time, date-range, number, checkbox, select, relation, link-select, list, text
    pub inferred: String,
    pub values: usize,
    pub nulls: usize,
}

#[derive(Debug, Clone, Serialize)]
pub struct ValueMerge { pub source_type: String, pub key: String, pub variants: Vec<String>, pub canonical: String }

#[derive(Debug, Clone, Serialize)]
pub struct StatusMapping { pub value: String, pub state: String, pub count: usize }

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum LinkOutcome {
    /// Rewritten to a wikilink to the imported object (FR-IMP-10 AC-1, AC-2, AC-5).
    Resolved,
    /// `[[Date/YYYY-MM-DD]]` → `[[YYYY-MM-DD]]` (FR-IMP-10 AC-3).
    DateMention,
    /// Reference to a media file that is imported (FR-IMP-14 AC-2).
    Attachment,
    /// Reported: `[[NOTE/<uuid>]]` or a title that isn't in the export (FR-IMP-10 AC-4).
    Unresolved,
    /// Reported: the target is in another space (FR-IMP-22 AC-2).
    OtherSpace(String),
    /// Reported: several objects have this title; the link is pointed at the first and listed (FR-LNK-14).
    Ambiguous,
    /// Reported: a link-valued attribute whose target isn't an object becomes a select value (FR-IMP-21 AC-3).
    SelectValue,
    /// Reported and dropped: a media reference to a file that isn't in the export (FR-IMP-14 AC-4).
    MissingFile,
    /// Reported: only a title differing in case matches; the user confirms it in the preview (FR-LNK-14).
    CaseMismatch,
    /// Reported: the link is inside a note that can't be imported (listed in `skipped_objects`).
    InSkippedNote,
}

impl LinkOutcome {
    pub fn imported(&self) -> bool { matches!(self, Self::Resolved | Self::DateMention | Self::Attachment) }
}

#[derive(Debug, Clone, Serialize)]
pub struct LinkRow { pub note: String, pub line: usize, pub target: String, pub outcome: LinkOutcome }

#[derive(Debug, Clone, Serialize)]
pub struct FileRow { pub path: String, pub kind: DropKind, pub reason: String }

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum DropKind {
    /// A file in the export that is neither an object nor an attachment (counted in `other_files`).
    File,
    /// A media reference whose file isn't in the export (counted in `links` as `MissingFile`).
    MissingReference,
}

#[derive(Debug, Clone, Serialize)]
pub struct Planned { pub source: String, pub target: String, pub title: String, pub import_id: String }

#[derive(Debug, Clone, Serialize)]
pub struct DuplicateTitle { pub title: String, pub targets: Vec<String> }

#[derive(Debug, Default, Clone, Serialize)]
pub struct DateCounts { pub date_only: usize, pub date_times: usize, pub ranges: usize, pub unparsed: usize }

#[derive(Debug, Default, Clone, Serialize)]
pub struct Report {
    pub space: String,
    pub time_zone: String,
    pub read: ReadStats,
    pub objects: Tally,
    pub attachments: Tally,
    pub links: Tally,
    /// Files that are neither objects nor attachments (tag-collection CSVs, dotfiles): all reported.
    pub other_files: Tally,
    pub types: Vec<TypeRow>,
    pub attributes: Vec<AttrRow>,
    pub value_merges: Vec<ValueMerge>,
    pub task_statuses: Vec<StatusMapping>,
    /// (type, key, values) where comma-separated text could be split into a list (FR-IMP-08 AC-5, C16).
    pub split_candidates: Vec<(String, String, usize)>,
    pub dates: DateCounts,
    pub link_rows: Vec<LinkRow>,
    pub skipped_objects: Vec<FileRow>,
    pub dropped_files: Vec<FileRow>,
    pub orphan_attachments: Vec<String>,
    pub renamed_media: Vec<(String, String)>,
    pub duplicate_titles: Vec<DuplicateTitle>,
    pub planned: Vec<Planned>,
    /// Titles whose file name needs a decision (AP-27): Windows-reserved stem, or nothing left after sanitizing.
    pub name_issues: Vec<FileRow>,
    pub query_stubs: Vec<String>,
    pub tag_collections: Vec<String>,
    pub losses: Vec<String>,
    pub invisible_chars: usize,
    pub crlf_files: usize,
    pub checklist_items: usize,
    pub daily_timestamps: usize,
    /// coverImage / previewImage values that are neither null nor a recognizable link (format unknown).
    pub unknown_cover_values: usize,
    /// FR-IMP-20: planned objects whose `import-id` already exists in the target vault.
    pub already_imported: usize,
}

// ---------- notes ----------

pub fn split_frontmatter(text: &str) -> (Option<&str>, &str) {
    let t = text.strip_prefix('\u{FEFF}').unwrap_or(text);
    let Some(rest) = t.strip_prefix("---\n").or_else(|| t.strip_prefix("---\r\n")) else { return (None, t) };
    let mut pos = 0;
    for line in rest.split_inclusive('\n') {
        if line.trim_end() == "---" { return (Some(&rest[..pos]), &rest[pos + line.len()..]) }
        pos += line.len();
    }
    (None, t)
}

struct Note<'a> {
    inner: &'a str,
    text: String,
    fm: yaml_rust2::yaml::Hash,
    ctype: String,
    title: String,
    folder: String,
}

fn yaml_str(y: &Yaml) -> Option<String> {
    match y {
        Yaml::String(s) | Yaml::Real(s) => Some(s.clone()),
        Yaml::Integer(i) => Some(i.to_string()),
        Yaml::Boolean(b) => Some(b.to_string()),
        _ => None,
    }
}

fn parse_note<'a>(inner: &'a str, bytes: &[u8]) -> Result<Note<'a>, String> {
    let text = std::str::from_utf8(bytes).map_err(|_| "not UTF-8".to_string())?.to_string();
    let (fm, _) = split_frontmatter(&text);
    let fm = fm.ok_or("no frontmatter")?;
    let docs = YamlLoader::load_from_str(fm).map_err(|_| "invalid YAML frontmatter".to_string())?;
    let Some(Yaml::Hash(h)) = docs.into_iter().next() else { return Err("frontmatter is not a mapping".into()) };
    let ctype = h.get(&Yaml::from_str("type")).and_then(yaml_str).ok_or("no `type:` key")?;
    let folder = inner.rsplit_once('/').map(|(d, _)| d.split('/').next().unwrap().to_string()).unwrap_or_default();
    let stem = inner.rsplit('/').next().unwrap().trim_end_matches(".md");
    let title = h.get(&Yaml::from_str("title")).and_then(yaml_str).unwrap_or_else(|| stem.to_string());
    let title: String = strip_invisible(&title).trim().nfc().collect(); // FR-IMP-11 AC-2, FR-IMP-17
    Ok(Note { inner, text, fm: h, ctype, title, folder })
}

fn strip_invisible(s: &str) -> String { s.chars().filter(|c| !matches!(c, '\u{200B}' | '\u{FEFF}')).collect() }

/// FR-IMP-08 AC-1: default type mapping. Returns (target type, target folder).
fn map_type(ctype: &str, source_folder: &str) -> (String, String) {
    let (t, f) = match ctype {
        "Page" | "RootPage" => ("Page", "Pages"),
        "Task" => ("Task", "Tasks"),
        "DailyNote" => ("Daily Note", "Daily"),
        "Image" => ("Image", "Images"),
        "PDF" | "Pdf" => ("PDF", "PDFs"),
        "Query" | "Weblink" | "AIChat" | "Chat" => ("Page", "Pages"), // FR-IMP-16, FR-IMP-24, C19
        "Tag" => ("Tag", "Tags"),
        other => return (other.to_string(), if source_folder.is_empty() { other.to_string() } else { source_folder.to_string() }),
    };
    (t.into(), f.into())
}

const RESERVED: &[&str] = &["id", "type", "title", "description", "aliases", "tags", "created", "modified", "source",
    "review", "icon", "cover", "previous", "file", "import-id", "captured"];

/// FR-IMP-15, FR-TYP-15, FR-IMP-24: default attribute mapping.
fn map_attr(ctype: &str, key: &str, sample: Option<&Yaml>) -> AttrAction {
    use AttrAction::*;
    let is_link = sample.and_then(yaml_str).is_some_and(|s| s.trim_start().starts_with("[["));
    match (ctype, key) {
        (_, "type" | "title") => Consumed,
        (_, "tags" | "aliases" | "description" | "icon") => Keep,
        (_, "createdAt") => Rename("created".into()),
        (_, "lastUpdated") => Rename("modified".into()),
        (_, "reviewed") => Rename("review".into()),
        (_, "coverImage") => Rename("cover".into()),
        ("Weblink", "previewImage") => Rename("cover".into()),
        ("Task", "deadline") => Rename("due".into()),
        ("Task", "date") => Rename("due".into()), // fallback when deadline is empty (FR-TSK-13)
        ("Task", "completed" | "status" | "priority") => Keep,
        ("DailyNote", "date") => Consumed, // the date is the file name
        ("Image" | "PDF", "mimeType" | "fileSize" | "width" | "height" | "colors") => Drop,
        ("Weblink", "iframeUrl" | "domain") => Drop,
        (_, "source") if is_link => Keep,
        (_, k) if RESERVED.contains(&k) => Rename(format!("{k}-text")),
        _ => Keep,
    }
}

static TIMESTAMP_LINE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^\d{1,2}:\d{2}\s*$").unwrap());
static CHECKLIST: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^\s*[-*+] \[[ xX]\] ").unwrap());
static DATE_MENTION: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^Date/\d{4}-\d{2}-\d{2}$").unwrap());
static UUID_LINK: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^[A-Z_]+/[0-9a-fA-F-]{36}$").unwrap());

fn status_state(v: &str) -> &'static str {
    match v.trim().to_lowercase().as_str() {
        "" | "not started" | "todo" | "to do" | "open" => "open",
        "in progress" | "doing" | "started" => "in progress",
        "done" | "completed" | "complete" => "done",
        _ => "needs decision",
    }
}

pub struct Options { pub tz: Tz, pub existing_import_ids: HashSet<String> }

impl Default for Options {
    fn default() -> Self { Self { tz: chrono_tz::Europe::Prague, existing_import_ids: HashSet::new() } }
}

/// Lookup of objects by title and by file path, per space.
#[derive(Default)]
struct Directory { by_title: HashMap<String, Vec<String>>, by_title_ci: HashMap<String, Vec<String>>, by_stem: HashMap<String, Vec<String>>, paths: HashSet<String> }

impl Directory {
    fn add(&mut self, inner: &str, title: &str) {
        self.by_title.entry(title.to_string()).or_default().push(inner.into());
        self.by_title_ci.entry(title.to_lowercase()).or_default().push(inner.into());
        let stem = inner.rsplit('/').next().unwrap().trim_end_matches(".md");
        self.by_stem.entry(stem.to_string()).or_default().push(inner.into());
        self.paths.insert(inner.into());
    }
    /// Exact title or file-stem match (NFC on both sides, FR-FMT-12).
    fn find(&self, t: &str) -> Option<&Vec<String>> { self.by_title.get(t).or_else(|| self.by_stem.get(t)) }
    /// Case-insensitive title match: never resolved silently (FR-LNK-14), reported for the user to confirm.
    fn find_ci(&self, t: &str) -> Option<&Vec<String>> { self.by_title_ci.get(&t.to_lowercase()) }
}

/// Resolve `../Tasks/x.md` relative to the note's folder; `None` if it leaves the space.
fn join_relative(note_inner: &str, rel: &str) -> Option<String> {
    let mut parts: Vec<&str> = note_inner.split('/').collect();
    parts.pop();
    for p in rel.split('/') {
        match p { "" | "." => {}, ".." => { parts.pop()?; }, p => parts.push(p) }
    }
    Some(parts.join("/"))
}

// File classes (AP-26): `.md` = object (FR-IMP-03), `.csv` = tag collection or other (FR-IMP-21),
// dotfiles (`.DS_Store`) = ignored and reported, everything else = attachment (FR-IMP-14, §11.1 "every attachment").
pub fn is_object_file(inner: &str) -> bool { inner.ends_with(".md") && !is_hidden(inner) }
fn is_hidden(inner: &str) -> bool { inner.split('/').any(|p| p.starts_with('.')) }
pub fn is_attachment_file(inner: &str) -> bool { !is_object_file(inner) && !inner.ends_with(".csv") && !is_hidden(inner) }

pub fn dry_run(src: &Source, space: &str, opts: &Options) -> Report {
    let l = layout(&src.entries);
    let mut r = Report { space: space.into(), time_zone: opts.tz.name().into(), read: src.stats.clone(), ..Default::default() };

    // Partition the export: this space's files, and directories of the other spaces for link reporting.
    let mut files: Vec<(&str, &Entry)> = Vec::new();
    let mut others: BTreeMap<String, Directory> = BTreeMap::new();
    for e in &src.entries {
        let Some((s, inner)) = space_of(&l, &e.path) else { continue };
        if s == space { files.push((inner, e)); continue }
        if is_object_file(inner) {
            if let Ok(n) = parse_note(inner, &e.bytes) { others.entry(s).or_default().add(inner, &n.title) }
        }
    }

    let attachment_paths: HashSet<&str> = files.iter().map(|(p, _)| *p).filter(|p| is_attachment_file(p)).collect();
    let mut notes: Vec<Note> = Vec::new();
    for (inner, e) in &files {
        if is_object_file(inner) {
            r.objects.total += 1;
            match parse_note(inner, &e.bytes) {
                Ok(n) => { r.objects.imported += 1; notes.push(n) }
                Err(reason) => {
                    r.objects.reported += 1;
                    r.skipped_objects.push(FileRow { path: inner.to_string(), kind: DropKind::File, reason });
                    for raw in scan::links(&String::from_utf8_lossy(&e.bytes)) {
                        r.links.total += 1;
                        r.links.reported += 1;
                        r.link_rows.push(LinkRow { note: inner.to_string(), line: raw.line, target: raw.target, outcome: LinkOutcome::InSkippedNote });
                    }
                }
            }
        } else if is_attachment_file(inner) {
            r.attachments.total += 1;
        } else {
            r.other_files.total += 1;
            r.other_files.reported += 1;
            let text = String::from_utf8_lossy(&e.bytes);
            let rows = text.trim_start_matches('\u{FEFF}').lines().filter(|l| !l.trim().is_empty()).count();
            if inner.ends_with(".csv") && rows <= 1 {
                r.tag_collections.push(inner.to_string());
                r.dropped_files.push(FileRow { path: inner.to_string(), kind: DropKind::File, reason: "tag collection (header-only CSV): tags kept, colors and icons not exported".into() });
            } else {
                r.dropped_files.push(FileRow { path: inner.to_string(), kind: DropKind::File, reason: "not an object or attachment".into() });
            }
        }
    }

    let mut dir = Directory::default();
    for n in &notes { dir.add(n.inner, &n.title) }

    // Types and planned file names (FR-IMP-08 AC-1, FR-IMP-11, FR-LNK-14).
    let mut type_rows: BTreeMap<(String, String), TypeRow> = BTreeMap::new();
    let mut allocators: HashMap<String, NameAllocator> = HashMap::new();
    let mut by_target_title: BTreeMap<(String, String), Vec<String>> = BTreeMap::new();
    for n in &notes {
        let (target, folder) = map_type(&n.ctype, &n.folder);
        let row = type_rows.entry((n.ctype.clone(), target.clone()))
            .or_insert(TypeRow { source: n.ctype.clone(), target: target.clone(), folder: folder.clone(), count: 0 });
        row.count += 1;
        let stem = if n.ctype == "DailyNote" {
            match n.fm.get(&Yaml::from_str("date")).and_then(yaml_str).and_then(|d| parse_date(&d, opts.tz)) {
                Some(DateValue::DateOnly(d)) => d,
                _ => sanitize_file_name(&n.title),
            }
        } else { sanitize_file_name(&n.title) };
        if is_windows_reserved(&stem) {
            r.name_issues.push(FileRow { path: n.inner.into(), kind: DropKind::File, reason: "file name is reserved on Windows (AP-27)".into() });
        } else if stem == "Untitled" && sanitize_file_name(&n.title) == "Untitled" && n.title != "Untitled" {
            r.name_issues.push(FileRow { path: n.inner.into(), kind: DropKind::File, reason: "title has no characters valid in a file name; named Untitled (AP-27)".into() });
        }
        let file = allocators.entry(folder.clone()).or_default().allocate(&stem, ".md");
        let target_path = format!("{folder}/{file}");
        by_target_title.entry((folder.clone(), n.title.clone())).or_default().push(target_path.clone());
        let import_id = format!("capacities:{space}/{}", n.inner);
        if opts.existing_import_ids.contains(&import_id) { r.already_imported += 1 }
        r.planned.push(Planned { source: n.inner.into(), target: target_path, title: n.title.clone(), import_id });
        if n.ctype == "Query" { r.query_stubs.push(n.title.clone()) }
    }
    r.types = type_rows.into_values().collect();
    r.duplicate_titles = by_target_title.into_iter().filter(|(_, v)| v.len() > 1)
        .map(|((_, title), targets)| DuplicateTitle { title, targets }).collect();

    // Attributes, dates, values (FR-IMP-08, FR-IMP-09, FR-IMP-15, FR-TYP-15).
    let mut attrs: BTreeMap<(String, String), (AttrRow, Vec<Yaml>)> = BTreeMap::new();
    for n in &notes {
        for (k, v) in &n.fm {
            let Some(key) = yaml_str(k) else { continue };
            let e = attrs.entry((n.ctype.clone(), key.clone())).or_insert_with(|| (AttrRow {
                source_type: n.ctype.clone(), key: key.clone(), action: AttrAction::Keep, inferred: String::new(), values: 0, nulls: 0,
            }, Vec::new()));
            if v.is_null() { e.0.nulls += 1 } else { e.0.values += 1; e.1.push(v.clone()) }
        }
    }
    for ((ctype, key), (row, values)) in attrs.iter_mut() {
        row.action = map_attr(ctype, key, values.first());
        if row.action == AttrAction::Consumed && key != "date" { row.inferred = "-".into(); continue }
        row.inferred = infer(values, &dir, opts.tz, &mut r.dates);
        if matches!(row.inferred.as_str(), "select" | "text") {
            let strs: Vec<String> = values.iter().filter_map(yaml_str).collect();
            let mut groups: BTreeMap<String, BTreeMap<String, usize>> = BTreeMap::new();
            for s in &strs { *groups.entry(s.trim().to_lowercase()).or_default().entry(s.trim().to_string()).or_default() += 1 }
            for variants in groups.values().filter(|g| g.len() > 1) {
                let canonical = variants.iter().max_by(|a, b| a.1.cmp(b.1).then(b.0.cmp(a.0))).unwrap().0.clone();
                r.value_merges.push(ValueMerge { source_type: ctype.clone(), key: key.clone(), variants: variants.keys().cloned().collect(), canonical });
            }
            let split = strs.iter().filter(|s| is_people_list(s)).count();
            if split > 0 { r.split_candidates.push((ctype.clone(), key.clone(), split)) }
        }
        if ctype == "Task" && key == "status" {
            let mut m: BTreeMap<String, usize> = BTreeMap::new();
            for v in values.iter().filter_map(yaml_str) { *m.entry(v).or_default() += 1 }
            if row.nulls > 0 { *m.entry(String::new()).or_default() += row.nulls }
            r.task_statuses = m.into_iter().map(|(value, count)| StatusMapping { state: status_state(&value).into(), value, count }).collect();
        }
        if matches!(key.as_str(), "coverImage" | "previewImage") {
            r.unknown_cover_values += values.iter().filter_map(yaml_str).filter(|s| !s.contains('[') && !s.contains('(')).count();
        }
    }
    r.attributes = attrs.into_values().map(|(row, _)| row).collect();

    // Links and media references (FR-IMP-10, FR-IMP-14, FR-IMP-21, FR-IMP-22).
    let mut referenced: HashMap<String, String> = HashMap::new(); // attachment → first owning note title
    for n in &notes {
        let (fm_text, _) = split_frontmatter(&n.text);
        let fm_lines = fm_text.map(|f| f.lines().count() + 1).unwrap_or(0);
        for raw in scan::links(&n.text) {
            let in_frontmatter = raw.line <= fm_lines;
            let outcome = match raw.kind {
                LinkKind::Wiki if DATE_MENTION.is_match(&raw.target) => LinkOutcome::DateMention,
                LinkKind::Wiki if UUID_LINK.is_match(&raw.target) => LinkOutcome::Unresolved,
                LinkKind::Wiki => match dir.find(&raw.target) {
                    Some(v) if v.len() == 1 => LinkOutcome::Resolved,
                    Some(_) => LinkOutcome::Ambiguous,
                    None if dir.find_ci(&raw.target).is_some() => LinkOutcome::CaseMismatch,
                    None => match others.iter().find(|(_, d)| d.find(&raw.target).is_some()) {
                        Some((s, _)) => LinkOutcome::OtherSpace(s.clone()),
                        None if in_frontmatter => LinkOutcome::SelectValue,
                        None => LinkOutcome::Unresolved,
                    },
                },
                LinkKind::Markdown => match join_relative(n.inner, &raw.target) {
                    Some(p) if dir.paths.contains(&p) => LinkOutcome::Resolved,
                    Some(p) => match others.iter().find(|(_, d)| d.paths.contains(&p)) {
                        Some((s, _)) => LinkOutcome::OtherSpace(s.clone()),
                        None => LinkOutcome::Unresolved,
                    },
                    None => LinkOutcome::Unresolved,
                },
                LinkKind::Image => match join_relative(n.inner, &raw.target) {
                    Some(p) if attachment_paths.contains(p.as_str()) => {
                        referenced.entry(p).or_insert_with(|| n.title.clone());
                        LinkOutcome::Attachment
                    }
                    _ => LinkOutcome::MissingFile,
                },
            };
            r.links.total += 1;
            if outcome.imported() { r.links.imported += 1 } else { r.links.reported += 1 }
            if outcome == LinkOutcome::MissingFile {
                r.dropped_files.push(FileRow { path: raw.target.clone(), kind: DropKind::MissingReference, reason: format!("referenced from {} but not in the export", n.inner) });
            }
            r.link_rows.push(LinkRow { note: n.inner.into(), line: raw.line, target: raw.target, outcome });
        }
        r.invisible_chars += scan::invisible_chars(&n.text);
        if n.text.contains("\r\n") { r.crlf_files += 1 }
        r.checklist_items += n.text.lines().filter(|l| CHECKLIST.is_match(l)).count();
        if n.ctype == "DailyNote" { r.daily_timestamps += n.text.lines().filter(|l| TIMESTAMP_LINE.is_match(l)).count() }
    }

    // Attachments: every media file is imported into `_attachments/`; generic names are renamed (FR-IMP-14 AC-3).
    let mut att_names = NameAllocator::default();
    let mut owner_counter: HashMap<String, usize> = HashMap::new();
    let mut sorted: Vec<&&str> = attachment_paths.iter().collect();
    sorted.sort();
    for p in sorted {
        r.attachments.imported += 1;
        let file = p.rsplit('/').next().unwrap();
        let (stem, ext) = file.rsplit_once('.').map(|(s, e)| (s, format!(".{e}"))).unwrap_or((file, String::new()));
        match referenced.get(*p) {
            Some(owner) if is_generic_media_name(stem) => {
                let base = sanitize_file_name(owner);
                let n = owner_counter.entry(base.clone()).or_default();
                *n += 1;
                let to = att_names.allocate(&format!("{base} {n}"), &ext);
                r.renamed_media.push((p.to_string(), format!("_attachments/{to}")));
            }
            Some(_) => { att_names.allocate(&sanitize_file_name(stem), &ext); }
            None => {
                att_names.allocate(&sanitize_file_name(stem), &ext);
                r.orphan_attachments.push(p.to_string());
            }
        }
    }

    // Losses the source didn't export (FR-IMP-19, R-09).
    if !r.query_stubs.is_empty() { r.losses.push(format!("Query definitions: {} queries imported as stubs to rebuild (FR-IMP-16)", r.query_stubs.len())) }
    if !r.tag_collections.is_empty() { r.losses.push(format!("Tag colors, icons and collections: {} tag collections (FR-IMP-21)", r.tag_collections.len())) }
    r
}

fn is_people_list(s: &str) -> bool {
    let parts: Vec<&str> = s.split(',').map(str::trim).collect();
    parts.len() >= 2 && parts.iter().all(|p| !p.is_empty() && p.split_whitespace().count() <= 3
        && p.chars().next().is_some_and(char::is_uppercase))
}

static ONLY_LINKS: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^\s*(\[\[[^\]]+\]\]\s*,?\s*)+$").unwrap());

/// FR-IMP-08 AC-2: infer the target attribute type from the non-null values; counts date conversions.
fn infer(values: &[Yaml], dir: &Directory, tz: Tz, dates: &mut DateCounts) -> String {
    if values.is_empty() { return "text".into() }
    if values.iter().all(|v| matches!(v, Yaml::Boolean(_))) { return "checkbox".into() }
    if values.iter().all(|v| matches!(v, Yaml::Integer(_) | Yaml::Real(_))) { return "number".into() }
    if values.iter().all(|v| matches!(v, Yaml::Array(_))) { return "list".into() }
    let strs: Vec<String> = values.iter().filter_map(yaml_str).collect();
    if strs.len() != values.len() { return "text".into() }
    let parsed: Vec<Option<DateValue>> = strs.iter().map(|s| parse_date(s, tz)).collect();
    if parsed.iter().all(Option::is_some) {
        let mut kind = "date";
        for p in parsed.iter().flatten() {
            match p {
                DateValue::DateOnly(_) => dates.date_only += 1,
                DateValue::DateTime(_) => { dates.date_times += 1; if kind == "date" { kind = "date-time" } }
                DateValue::Range(..) => { dates.ranges += 1; kind = "date-range" }
            }
        }
        return kind.into();
    }
    if parsed.iter().any(Option::is_some) { dates.unparsed += parsed.iter().filter(|p| p.is_none()).count() }
    if strs.iter().all(|s| ONLY_LINKS.is_match(s)) {
        let all_objects = strs.iter().flat_map(|s| scan::links(s)).all(|l| dir.find(&l.target).is_some());
        return if all_objects { "relation" } else { "link-select" }.into();
    }
    let distinct: HashSet<String> = strs.iter().map(|s| s.trim().to_lowercase()).collect();
    if distinct.len() <= 12 && strs.len() > distinct.len() && strs.iter().all(|s| s.len() <= 40 && !s.contains('\n')) {
        return "select".into();
    }
    "text".into()
}
