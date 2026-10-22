//! MS4 slice 4A: backlinks panel, broken links, duplicate titles, create from a link (docs/contracts/ms4-links.md §3;
//! FR-LNK-01, -02, -04, -14; D-276…D-291).

use std::collections::{BTreeMap, HashMap, HashSet};

use chrono::DateTime;
use serde_json::Value;
use tegg_format::excerpt::{window, RSeg, Segment, TargetKind};
use tegg_format::{nfc, sanitize_file_stem, type_key};
use tegg_index::{LinkRecord, NoteLinks};

use crate::{lock, Core, CoreError, SwitcherItem, SwitcherKind, VaultError};
pub use tegg_format::excerpt::{At, Excerpt};

#[derive(Debug, Clone, PartialEq, Default)]
pub struct BacklinksPanel {
    pub objects: usize,
    pub groups: Vec<BacklinkGroup>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct BacklinkGroup {
    pub type_key: String,
    pub defined: bool,
    pub raw: String,
    pub entries: Vec<BacklinkEntry>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct BacklinkEntry {
    pub source: String,
    pub title: String,
    pub type_key: String,
    /// As written; ordering uses the instant.
    pub modified: Option<String>,
    /// The editor can't open it (NFR-REL-03): open in the source view.
    pub read_only: bool,
    /// All of them, file order, frontmatter first (the UI shows 3, D-278).
    pub occurrences: Vec<Occurrence>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OccurrenceKind {
    Body,
    Attribute,
    Embed,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Occurrence {
    pub kind: OccurrenceKind,
    /// The frontmatter key.
    pub attribute: Option<String>,
    /// The Name from the source's type schema, if the key is defined there.
    pub attribute_name: Option<String>,
    /// The first link of this occurrence that points here.
    pub at: At,
    pub excerpt: Excerpt,
}

#[derive(Debug, Clone, PartialEq, Default)]
pub struct BrokenLinks {
    pub occurrences: usize,
    pub objects: usize,
    pub groups: Vec<BrokenGroup>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct BrokenGroup {
    /// NFC, lower case, without subpath and alias.
    pub key: String,
    /// Most frequent spelling, ties by code point.
    pub label: String,
    /// Occurrences.
    pub count: usize,
    pub create: LinkCreatePlan,
    pub sources: Vec<BacklinkEntry>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct DuplicateGroup {
    pub key: String,
    pub label: String,
    pub objects: Vec<DuplicateObject>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct DuplicateObject {
    pub path: String,
    pub title: String,
    pub type_key: String,
    pub folder: String,
    pub details: DuplicateDetails,
    pub backlinks: usize,
}

pub use tegg_index::DuplicateDetails;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CreateRefusal {
    /// D-288, D-222.
    Folder,
    /// D-287 from a read-only view: the UI decides.
    NeedsEdit,
}

#[derive(Debug, Clone, PartialEq)]
pub enum LinkCreatePlan {
    /// `rewrite`: the new link text (D-287).
    Create { path: String, title: String, type_key: String, rewrite: Option<String> },
    /// The target resolves now.
    Exists { path: String },
    Forbidden { reason: CreateRefusal },
}

#[derive(Debug, Clone, PartialEq)]
pub struct LinkCreated {
    pub path: String,
    pub rewrite: Option<String>,
}


const MAX: usize = 160;
const BEFORE: usize = 60;
/// D-121 order of system types before and after the user types.
const FIRST: [&str; 4] = ["page", "task", "quick-note", "daily-note"];
const LAST: [&str; 2] = ["image", "pdf"];

/// The instant of a `modified` / `created` value for ordering; a date alone is its midnight UTC.
fn instant(v: Option<&str>) -> Option<i64> {
    let s = v?.trim();
    if let Ok(t) = DateTime::parse_from_rfc3339(s) {
        return Some(t.timestamp());
    }
    tegg_format::parse_date(s).and_then(|d| d.and_hms_opt(0, 0, 0)).map(|t| t.and_utc().timestamp())
}

fn attr_str(attrs: &Value, key: &str) -> Option<String> {
    attrs.get(key).and_then(|v| v.as_str()).map(|s| s.to_string())
}

/// Most frequent key, ties by code point (BTreeMap order).
fn most_frequent(m: &BTreeMap<String, usize>) -> Option<String> {
    m.iter()
        .fold(None::<(&String, usize)>, |b, (s, n)| match b {
            Some((_, bn)) if bn >= *n => b,
            _ => Some((s, *n)),
        })
        .map(|b| b.0.clone())
}

fn by_instant(x: Option<i64>, y: Option<i64>, newest_first: bool) -> std::cmp::Ordering {
    match (x, y) {
        (Some(x), Some(y)) => {
            if newest_first {
                y.cmp(&x)
            } else {
                x.cmp(&y)
            }
        }
        (Some(_), None) => std::cmp::Ordering::Less,
        (None, Some(_)) => std::cmp::Ordering::Greater,
        (None, None) => std::cmp::Ordering::Equal,
    }
}

/// The chip text of a link (D-73, D-156): alias, else the resolved title, else the target; ` › subpath` without alias.
fn chip_text(l: &LinkRecord) -> String {
    if let Some(a) = l.alias.as_ref().filter(|a| !a.trim().is_empty()) {
        return a.clone();
    }
    let base = l.resolved.title.clone().unwrap_or_else(|| l.target.clone());
    match l.subpath.as_ref().filter(|s| !s.is_empty()) {
        Some(sp) => format!("{base} › {sp}"),
        None => base,
    }
}

fn link_seg(l: &LinkRecord, here: bool, marks: Vec<tegg_format::Mark>) -> RSeg {
    RSeg::Link { text: chip_text(l), target: l.resolved.clone(), here, marks }
}

/// `[[…]]` / `![[…]]` spans in a string value: (start, end, target name).
fn wikilinks_in(s: &str) -> Vec<(usize, usize, String)> {
    let mut out = Vec::new();
    let mut i = 0;
    while let Some(o) = s[i..].find("[[") {
        let open = i + o;
        let Some(c) = s[open + 2..].find("]]") else { break };
        let inner = &s[open + 2..open + 2 + c];
        if inner.contains('[') || inner.contains('\n') || inner.is_empty() {
            i = open + 2;
            continue;
        }
        let start = if open > 0 && s.as_bytes()[open - 1] == b'!' { open - 1 } else { open };
        let name = inner.split(['|', '#']).next().unwrap_or("").trim().to_string();
        out.push((start, open + 2 + c + 2, name));
        i = open + 2 + c + 2;
    }
    out
}

/// The value of attribute `key` as rendered segments: list items joined with `, `; links in strings as chips,
/// matched in order with the attribute's link records (D-257).
fn attribute_segments(nl: &NoteLinks, key: &str, records: &[&LinkRecord], is_here: &dyn Fn(&LinkRecord) -> bool) -> Vec<RSeg> {
    let value = nl.attributes.get(key).cloned().unwrap_or(Value::Null);
    let items: Vec<Value> = match value {
        Value::Array(a) => a,
        v => vec![v],
    };
    let mut next = 0usize;
    let mut out: Vec<RSeg> = Vec::new();
    let text = |out: &mut Vec<RSeg>, t: &str| {
        if t.is_empty() {
            return;
        }
        if let Some(RSeg::Text { text, marks }) = out.last_mut() {
            if marks.is_empty() {
                text.push_str(t);
                return;
            }
        }
        out.push(RSeg::Text { text: t.to_string(), marks: vec![] });
    };
    for (n, item) in items.iter().enumerate() {
        if n > 0 {
            text(&mut out, ", ");
        }
        let s = match item {
            Value::String(s) => s.clone(),
            Value::Null => String::new(),
            other => other.to_string(),
        };
        let mut last = 0;
        for (a, b, name) in wikilinks_in(&s) {
            if let Some(r) = records.get(next).filter(|r| nfc(&r.target) == nfc(&name)) {
                text(&mut out, &s[last..a]);
                out.push(link_seg(r, is_here(r), vec![]));
                next += 1;
                last = b;
            }
        }
        text(&mut out, &s[last..]);
    }
    out
}

fn here_indices(rendered: &[RSeg]) -> Vec<usize> {
    rendered.iter().enumerate().filter(|(_, g)| matches!(g, RSeg::Link { here: true, .. })).map(|(i, _)| i).collect()
}

impl Core {
    fn type_names(&self) -> BTreeMap<String, tegg_schema::TypeFile> {
        lock(&self.shared.type_defs).clone()
    }

    /// One entry of the panel or the Broken links page: the occurrences whose links satisfy `is_here`.
    fn entry_for(&self, nl: &NoteLinks, defs: &BTreeMap<String, tegg_schema::TypeFile>, is_here: &dyn Fn(&LinkRecord) -> bool) -> Option<BacklinkEntry> {
        let mut occurrences = Vec::new();
        let mut seen_attr: HashSet<String> = HashSet::new();
        let mut seen_block: HashSet<u32> = HashSet::new();
        for l in nl.links.iter().filter(|l| is_here(l)) {
            if let Some(key) = &l.attribute {
                if !seen_attr.insert(key.clone()) {
                    continue;
                }
                let records: Vec<&LinkRecord> = nl.links.iter().filter(|x| x.attribute.as_deref() == Some(key.as_str())).collect();
                let rendered = attribute_segments(nl, key, &records, is_here);
                let here = here_indices(&rendered);
                let name = defs.get(&nl.r#type).and_then(|t| t.attributes.iter().find(|a| nfc(&a.key) == nfc(key))).map(|a| a.name.clone());
                occurrences.push(Occurrence { kind: OccurrenceKind::Attribute, attribute: Some(key.clone()), attribute_name: name, at: l.at, excerpt: window(&rendered, &here, MAX, BEFORE) });
            } else if let Some(b) = l.block {
                if !seen_block.insert(b) {
                    continue;
                }
                let Some(block) = nl.blocks.get(b as usize) else { continue };
                let rendered: Vec<RSeg> = block
                    .segments
                    .iter()
                    .map(|g| match g {
                        Segment::Text { text, marks } => RSeg::Text { text: text.clone(), marks: marks.clone() },
                        Segment::Link { link, marks } => match nl.links.iter().find(|r| r.index == *link as usize) {
                            Some(r) => link_seg(r, is_here(r), marks.clone()),
                            None => RSeg::Text { text: String::new(), marks: marks.clone() },
                        },
                    })
                    .collect();
                let here = here_indices(&rendered);
                let kind = if l.embed { OccurrenceKind::Embed } else { OccurrenceKind::Body };
                occurrences.push(Occurrence { kind, attribute: None, attribute_name: None, at: l.at, excerpt: window(&rendered, &here, MAX, BEFORE) });
            }
        }
        if occurrences.is_empty() {
            return None;
        }
        Some(BacklinkEntry {
            source: nl.path.clone(),
            title: nl.title.clone(),
            type_key: nl.r#type.clone(),
            modified: attr_str(&nl.attributes, "modified"),
            read_only: nl.frontmatter_error,
            occurrences,
        })
    }

    /// Groups in D-121 order (user and undefined types by key; the UI collates names), entries by instant.
    fn group(&self, entries: Vec<(BacklinkEntry, Option<String>)>, defs: &BTreeMap<String, tegg_schema::TypeFile>) -> Vec<BacklinkGroup> {
        let mut by: BTreeMap<String, (Vec<BacklinkEntry>, BTreeMap<String, usize>)> = BTreeMap::new();
        for (e, raw) in entries {
            let g = by.entry(e.type_key.clone()).or_default();
            if let Some(r) = raw {
                *g.1.entry(r).or_default() += 1;
            }
            g.0.push(e);
        }
        let system = |k: &str| FIRST.contains(&k) || LAST.contains(&k) || k == "tag";
        let rank = |k: &str| -> (u8, usize) {
            if let Some(i) = FIRST.iter().position(|x| *x == k) {
                (0, i)
            } else if let Some(i) = LAST.iter().position(|x| *x == k) {
                (2, i)
            } else if defs.contains_key(k) {
                (1, 0)
            } else {
                (3, 0)
            }
        };
        let mut groups: Vec<BacklinkGroup> = by
            .into_iter()
            .map(|(key, (mut entries, raws))| {
                entries.sort_by(|a, b| by_instant(instant(a.modified.as_deref()), instant(b.modified.as_deref()), true).then_with(|| a.source.cmp(&b.source)));
                BacklinkGroup { defined: defs.contains_key(&key) || system(&key), raw: most_frequent(&raws).unwrap_or_else(|| key.clone()), type_key: key, entries }
            })
            .collect();
        groups.sort_by(|a, b| rank(&a.type_key).cmp(&rank(&b.type_key)).then_with(|| a.type_key.cmp(&b.type_key)));
        groups
    }

    pub fn backlinks_panel(&self, path: &str) -> BacklinksPanel {
        let target = {
            let idx = self.index();
            let Some(t) = idx.object(path) else { return BacklinksPanel::default() };
            t.path
        };
        // FR-ATT-07 (ms6-trash-media §3.2): notes that embed the object's file count too.
        let media = self.media_sources(&target);
        let media_targets: std::collections::HashSet<String> = media.iter().flat_map(|(_, t)| t.iter().map(|x| nfc(x.trim()))).collect();
        let sources: Vec<NoteLinks> = {
            let idx = self.index();
            let mut paths = idx.backlinks(&target);
            for (src, _) in &media {
                if !paths.contains(src) {
                    paths.push(src.clone());
                }
            }
            paths.sort();
            paths.iter().filter_map(|s| idx.note_links(s)).collect()
        };
        let defs = self.type_names();
        let here = |l: &LinkRecord| l.resolved.path.as_deref() == Some(target.as_str()) || media_targets.contains(&nfc(l.target.trim()));
        let entries: Vec<(BacklinkEntry, Option<String>)> = sources.iter().filter_map(|nl| self.entry_for(nl, &defs, &here).map(|e| (e, nl.type_raw.clone()))).collect();
        BacklinksPanel { objects: entries.len(), groups: self.group(entries, &defs) }
    }

    /// D-348: the panel of a date without a Daily Note: every note whose date links name `date`.
    pub(crate) fn date_backlinks_panel(&self, date: chrono::NaiveDate) -> BacklinksPanel {
        let want = tegg_format::format_date(date);
        let sources: Vec<NoteLinks> = {
            let idx = self.index();
            idx.date_link_sources(date).iter().filter_map(|s| idx.note_links(s)).collect()
        };
        let defs = self.type_names();
        let here = |l: &LinkRecord| {
            l.resolved.kind == TargetKind::DateMissing && nfc(l.target.split(['|', '#']).next().unwrap_or("").trim()) == want
        };
        let entries: Vec<(BacklinkEntry, Option<String>)> = sources.iter().filter_map(|nl| self.entry_for(nl, &defs, &here).map(|e| (e, nl.type_raw.clone()))).collect();
        BacklinksPanel { objects: entries.len(), groups: self.group(entries, &defs) }
    }

    pub fn broken_links(&self) -> BrokenLinks {
        let sources = self.index().broken_sources();
        let defs = self.type_names();
        let key_of = |l: &LinkRecord| nfc(l.target.trim()).to_lowercase();
        // ms6-trash-media §2 (D-611): a target that resolves in `.trash/` isn't broken.
        let trashed: std::collections::HashSet<String> = {
            let unresolved = |l: &LinkRecord| l.resolved.kind == TargetKind::Unresolved && tegg_index::is_note_target(&l.target);
            let mut seen = std::collections::HashSet::new();
            let mut out = std::collections::HashSet::new();
            let (cache, objs) = (self.file_cache(), self.objects());
            for nl in &sources {
                for l in nl.links.iter().filter(|l| unresolved(l)) {
                    let k = key_of(l);
                    if seen.insert(k.clone()) && crate::trash6a::resolve_more(&cache, &objs, &self.shared, &nl.path, &l.target).is_some_and(|(t, _)| t.kind == crate::LinkKind::Trashed) {
                        out.insert(k);
                    }
                }
            }
            out
        };
        let broken = |l: &LinkRecord| l.resolved.kind == TargetKind::Unresolved && tegg_index::is_note_target(&l.target) && !trashed.contains(&key_of(l));
        struct G {
            spellings: BTreeMap<String, usize>,
            count: usize,
            sources: Vec<String>,
            to: Option<Vec<String>>,
            all_relations: bool,
        }
        let mut groups: BTreeMap<String, G> = BTreeMap::new();
        let (mut occurrences, mut objects) = (0, 0);
        for nl in &sources {
            let mut any = false;
            for l in nl.links.iter().filter(|l| broken(l)) {
                any = true;
                occurrences += 1;
                let g = groups.entry(key_of(l)).or_insert_with(|| G { spellings: BTreeMap::new(), count: 0, sources: vec![], to: None, all_relations: true });
                *g.spellings.entry(nfc(l.target.trim())).or_default() += 1;
                g.count += 1;
                if !g.sources.contains(&nl.path) {
                    g.sources.push(nl.path.clone());
                }
                let to = l
                    .attribute
                    .as_ref()
                    .and_then(|k| defs.get(&nl.r#type).and_then(|t| t.attributes.iter().find(|a| nfc(&a.key) == nfc(k))).and_then(|a| a.to.clone()))
                    .filter(|to| !to.is_empty());
                match to {
                    Some(to) => {
                        g.to.get_or_insert(to);
                    }
                    None => g.all_relations = false,
                }
            }
            if any {
                objects += 1;
            }
        }
        let by_path: HashMap<&str, &NoteLinks> = sources.iter().map(|n| (n.path.as_str(), n)).collect();
        let mut out: Vec<BrokenGroup> = groups
            .into_iter()
            .map(|(key, g)| {
                let label = most_frequent(&g.spellings).unwrap_or_else(|| key.clone());
                let here = |l: &LinkRecord| broken(l) && key_of(l) == key;
                let entries: Vec<BacklinkEntry> = g.sources.iter().filter_map(|p| by_path.get(p.as_str())).filter_map(|nl| self.entry_for(nl, &defs, &here)).collect();
                let first = g.sources.first().cloned().unwrap_or_default();
                let rel = if g.all_relations { g.to } else { None };
                let create = self.link_create_plan(&first, &label, rel.as_deref());
                BrokenGroup { key, label, count: g.count, create, sources: entries }
            })
            .collect();
        out.sort_by(|a, b| b.count.cmp(&a.count).then_with(|| a.label.cmp(&b.label)));
        BrokenLinks { occurrences, objects, groups: out }
    }

    fn details(&self, o: &crate::ObjectInfo, defs: &BTreeMap<String, tegg_schema::TypeFile>) -> DuplicateDetails {
        let preview: Vec<(String, Value)> = defs
            .get(&o.r#type)
            .map(|t| t.preview.clone())
            .unwrap_or_default()
            .into_iter()
            .filter_map(|k| {
                let v = o.attributes.get(&k)?.clone();
                let set = match &v {
                    Value::Null => false,
                    Value::String(s) => !s.trim().is_empty(),
                    Value::Array(a) => !a.is_empty(),
                    _ => true,
                };
                set.then_some((k, v))
            })
            .take(2)
            .collect();
        let name = o.path.rsplit('/').next().unwrap_or(&o.path);
        let stem = nfc(name.strip_suffix(".md").unwrap_or(name));
        DuplicateDetails { created: attr_str(&o.attributes, "created"), preview, stem: (stem != nfc(&o.title)).then_some(stem) }
    }

    /// The objects counted for duplicate titles: one per `id` (the conflict primary), by title key (D-290).
    fn title_groups(&self) -> BTreeMap<String, Vec<crate::ObjectInfo>> {
        let (objs, conflicts) = {
            let idx = self.index();
            (idx.objects(), idx.conflicts())
        };
        let copies: HashSet<String> = conflicts.into_iter().filter(|c| c.kind == crate::ConflictKind::DuplicateId).flat_map(|c| c.others).collect();
        let mut g: BTreeMap<String, Vec<crate::ObjectInfo>> = BTreeMap::new();
        for o in objs.into_iter().filter(|o| !copies.contains(&o.path)) {
            g.entry(title_key(&o.title)).or_default().push(o);
        }
        g
    }

    pub(crate) fn add_duplicate_details(&self, items: &mut [SwitcherItem]) {
        if items.iter().all(|i| i.kind != SwitcherKind::Object) {
            return;
        }
        let groups = self.title_groups();
        let defs = self.type_names();
        for it in items.iter_mut().filter(|i| i.kind == SwitcherKind::Object) {
            let Some(g) = groups.get(&title_key(&it.title)).filter(|g| g.len() > 1) else { continue };
            if let Some(o) = it.path.as_deref().and_then(|p| g.iter().find(|o| o.path == p)) {
                it.duplicate = Some(self.details(o, &defs));
            }
        }
    }

    pub fn duplicate_titles(&self) -> Vec<DuplicateGroup> {
        let defs = self.type_names();
        let mut out: Vec<DuplicateGroup> = self
            .title_groups()
            .into_iter()
            .filter(|(_, v)| v.len() > 1)
            .map(|(key, mut objs)| {
                objs.sort_by(|a, b| {
                    by_instant(instant(attr_str(&a.attributes, "created").as_deref()), instant(attr_str(&b.attributes, "created").as_deref()), false).then_with(|| a.path.cmp(&b.path))
                });
                let mut spell: BTreeMap<String, usize> = BTreeMap::new();
                for o in &objs {
                    *spell.entry(nfc(o.title.trim())).or_default() += 1;
                }
                let label = most_frequent(&spell).unwrap_or_else(|| key.clone());
                let objects = objs
                    .iter()
                    .map(|o| DuplicateObject {
                        path: o.path.clone(),
                        title: o.title.clone(),
                        type_key: o.r#type.clone(),
                        folder: o.folder.clone(),
                        details: self.details(o, &defs),
                        backlinks: self.backlinks(&o.path).len(),
                    })
                    .collect();
                DuplicateGroup { key, label, objects }
            })
            .collect();
        out.sort_by(|a, b| b.objects.len().cmp(&a.objects.len()).then_with(|| a.label.cmp(&b.label)));
        out
    }

    pub fn link_create_plan(&self, from: &str, target: &str, relation_to: Option<&[String]>) -> LinkCreatePlan {
        let mut t = nfc(target.trim());
        if let Some(i) = t.find('|') {
            t.truncate(i);
        }
        if let Some(i) = t.find('#') {
            t.truncate(i);
        }
        let t = t.trim().to_string();
        if let Some(r) = self.resolve_links(from, std::slice::from_ref(&t)).into_iter().next() {
            if let (crate::LinkKind::Note | crate::LinkKind::Daily, Some(p)) = (r.kind, r.path) {
                return LinkCreatePlan::Exists { path: p };
            }
        }
        let t = if t.len() > 3 && t.is_char_boundary(t.len() - 3) && t[t.len() - 3..].eq_ignore_ascii_case(".md") { t[..t.len() - 3].to_string() } else { t };
        let (folder_part, title) = match t.rsplit_once('/') {
            Some((f, n)) => (Some(f.to_string()), n.trim().to_string()),
            None => (None, t.clone()),
        };
        let default = lock(&self.shared.default_type).clone();
        let (folder, key) = match folder_part {
            Some(f) => {
                let ok = f.split('/').all(|seg| !seg.trim().is_empty() && !seg.starts_with('.') && !seg.chars().any(|c| "/:\\*?\"<>|#^[]".contains(c) || c.is_control()))
                    && f.split('/').next() != Some("_templates");
                if !ok {
                    return LinkCreatePlan::Forbidden { reason: CreateRefusal::Folder };
                }
                let key = self
                    .shared
                    .read_types()
                    .into_iter()
                    .find(|ty| nfc(ty.folder.trim_matches('/')).to_lowercase() == nfc(&f).to_lowercase())
                    .map(|ty| ty.key)
                    .unwrap_or_else(|| default.key.clone());
                (f, key)
            }
            None => {
                let key = relation_to.and_then(|to| to.first()).map(|k| type_key(k)).filter(|k| self.type_get(k).is_some()).unwrap_or_else(|| default.key.clone());
                let folder = self.type_get(&key).map(|ty| ty.folder.trim_matches('/').to_string()).unwrap_or_else(|| default.folder.clone());
                (folder, key)
            }
        };
        let stem = self.free_stem(&folder, &sanitize_file_stem(&title));
        let rewrite = (nfc(&stem) != nfc(&title)).then(|| format!("{stem}|{title}"));
        let path = if folder.is_empty() { format!("{stem}.md") } else { format!("{folder}/{stem}.md") };
        LinkCreatePlan::Create { path, title, type_key: key, rewrite }
    }

    pub fn link_create(&self, from: &str, target: &str, expect: &LinkCreatePlan, bytes: &[u8]) -> Result<LinkCreated, CoreError> {
        self.link_create_as(from, target, expect, bytes, None)
    }

    /// `link_create` with the type the user picked in the offer's `Type` control (FR-VLT-05 AC-3, D-550): the plan is
    /// made again with that type. Without it, only a relation's type is (D-243).
    pub fn link_create_as(&self, from: &str, target: &str, expect: &LinkCreatePlan, bytes: &[u8], picked: Option<&str>) -> Result<LinkCreated, CoreError> {
        // A file at the planned path appeared after the offer opened (not indexed yet): never written over.
        if let LinkCreatePlan::Create { path, .. } = expect {
            if matches!(self.shared.vault.stat(&nfc(path)), Ok(Some(_))) {
                return Err(CoreError::Exists { path: nfc(path) });
            }
        }
        // The offer may have planned with a relation's first allowed type (D-243), or with the type the user picked in
        // its `Type` control (FR-VLT-05 AC-3, D-550; any type a capture can make).
        let chose = |k: &str| {
            picked.is_some_and(|p| tegg_format::type_key(p) == tegg_format::type_key(k))
                && !matches!(k, "daily-note" | "tag" | "image" | "pdf")
                && self.type_get(k).is_some()
        };
        let typed = match expect {
            LinkCreatePlan::Create { type_key, .. } if self.relation_allows(from, target, type_key) || chose(type_key) => {
                self.link_create_plan(from, target, Some(std::slice::from_ref(type_key)))
            }
            _ => self.link_create_plan(from, target, None),
        };
        let now = if typed == *expect { typed } else { self.link_create_plan(from, target, None) };
        let (path, rewrite) = match &now {
            LinkCreatePlan::Exists { path } => return Err(CoreError::Exists { path: path.clone() }),
            LinkCreatePlan::Create { path, rewrite, .. } if now == *expect => (nfc(path), rewrite.clone()),
            _ => return Err(CoreError::PlanChanged { now }),
        };
        match self.create_exact(&path, bytes) {
            Ok(_) => Ok(LinkCreated { path, rewrite }),
            Err(CoreError::Vault(VaultError::NameTaken)) => Err(CoreError::Exists { path }),
            Err(e) => Err(e),
        }
    }

    /// Whether a relation of `from` holds a link to `target` and allows `type_key` (its `to`).
    fn relation_allows(&self, from: &str, target: &str, type_key_: &str) -> bool {
        let Some(nl) = self.index().note_links(from) else { return false };
        let defs = self.type_names();
        let want = nfc(target.split(['|', '#']).next().unwrap_or("").trim()).to_lowercase();
        nl.links.iter().filter(|l| nfc(l.target.trim()).to_lowercase() == want).any(|l| {
            l.attribute.as_ref().is_some_and(|k| {
                defs.get(&nl.r#type)
                    .and_then(|t| t.attributes.iter().find(|a| nfc(&a.key) == nfc(k)))
                    .and_then(|a| a.to.as_ref())
                    .is_some_and(|to| to.iter().any(|t| type_key(t) == type_key(type_key_)))
            })
        })
    }

    pub fn free_stem(&self, folder: &str, stem: &str) -> String {
        free_stem_in(&self.shared, folder, stem)
    }
}

/// D-290: NFC, trimmed, Unicode case folding, no diacritic folding.
fn title_key(t: &str) -> String {
    nfc(t.trim()).to_lowercase()
}

/// D-291 part 2: a free stem in `folder`, vault-wide (ms4-links §3.1; also the job engine's, D-384).
pub(crate) fn free_stem_in(shared: &crate::Shared, folder: &str, stem: &str) -> String {
    let taken = crate::lock(&shared.index).stem_keys();
    let folder = nfc(folder.trim_matches('/'));
    let in_folder: HashSet<String> = shared
        .vault
        .list_files()
        .unwrap_or_default()
        .into_iter()
        .filter(|p| p.rsplit_once('/').map(|(d, _)| nfc(d) == folder).unwrap_or(folder.is_empty()))
        .filter_map(|p| p.rsplit('/').next().and_then(|n| n.strip_suffix(".md")).map(|n| nfc(n).to_lowercase()))
        .collect();
    tegg_format::unique_file_name(stem, "", &|n: &str| {
        let k = nfc(n).to_lowercase();
        taken.contains(&k) || in_folder.contains(&k)
    })
}
