//! MS4 slice 4D-lite (docs/contracts/ms4-tags.md §1): tags in the index — Tag files, display names, colours, counts
//! and Last used (D-640, D-647, D-653, D-657, D-665, D-667). Everything is derived from the index's objects, which are
//! rebuilt from the files (AR-01); only `tag_usage` reads templates from disk (they aren't indexed, D-660).

use std::collections::{BTreeMap, HashMap, HashSet};

use serde_json::Value;
use tegg_format::{extract, nfc};

use crate::{lock, Core, FileVersion};

/// The eight type colour tokens (types.md R14, D-236).
pub const TAG_COLORS: [&str; 8] = ["gray", "blue", "green", "orange", "purple", "red", "teal", "yellow"];

fn instant_ns(v: Option<&Value>) -> Option<i128> {
    let s = v?.as_str()?.trim();
    chrono::DateTime::parse_from_rfc3339(s).ok().and_then(|d| d.timestamp_nanos_opt()).map(|n| n as i128)
}
fn text(v: Option<&Value>) -> Option<String> {
    v.and_then(Value::as_str).map(str::trim).filter(|s| !s.is_empty()).map(str::to_string)
}
fn stem(path: &str) -> String {
    let base = path.rsplit('/').next().unwrap_or(path);
    base.strip_suffix(".md").or_else(|| base.strip_suffix(".MD")).unwrap_or(base).to_string()
}

/// The winning Tag file of a key (§1.1).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TagFileRef {
    pub path: String,
    pub version: FileVersion,
}

/// One tag (§1.2, R79).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TagRow {
    /// `tag_key`: NFC, lower case.
    pub key: String,
    /// Display name (D-657): the winner's title (stem when missing), else the most frequent spelling (D-185).
    pub name: String,
    /// The winning Tag file.
    pub file: Option<TagFileRef>,
    /// Other Tag files of the key, in winner order.
    pub losers: Vec<String>,
    /// One of the eight R14 tokens, else None (unknown, empty, missing, virtual; D-653).
    pub color: Option<String>,
    /// The winner's raw `color` (D-669).
    pub color_raw: Option<String>,
    /// Objects with an occurrence, one per object (D-647).
    pub count: usize,
    /// Newest valid `modified` among them, as written (D-667).
    pub last_used: Option<String>,
    /// The same instant (ns since the epoch) for sorting.
    pub last_used_ns: Option<i128>,
}

/// One object of a tag page (§1.3).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TagObjectRow {
    pub path: String,
    pub id: Option<String>,
    pub title: String,
    /// Type key; "" untyped reads as page (D-103).
    pub r#type: String,
    pub modified: Option<String>,
    pub modified_ns: Option<i128>,
    /// The object's other tag keys (all occurrences, deduplicated, without the page's key).
    pub tags: Vec<String>,
    pub review: Option<String>,
    pub status: Option<String>,
    pub due: Option<String>,
    pub completed: Option<String>,
}

/// What a rename or delete of a tag touches (§1.4).
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct TagUsage {
    pub notes: usize,
    pub templates: usize,
    pub file: Option<String>,
    pub losers: Vec<String>,
}

/// §1.2 over the shared state (the core and the job host).
pub(crate) fn rows(shared: &crate::Shared) -> Vec<TagRow> {
    rows_with(shared).0
}

/// The tag planners' view (ms4-tags §4.1): every tag with the objects carrying it.
pub(crate) fn host_tags(shared: &crate::Shared) -> Vec<tegg_jobs::host::HostTag> {
    let (rows, holders) = rows_with(shared);
    rows.into_iter()
        .map(|r| tegg_jobs::host::HostTag {
            holders: holders.get(&r.key).cloned().unwrap_or_default(),
            key: r.key,
            name: r.name,
            file: r.file.map(|f| f.path),
            losers: r.losers,
        })
        .collect()
}

pub(crate) fn tag_folder_of(shared: &crate::Shared) -> String {
    let _ = shared;
    "Tags".into()
}

fn rows_with(shared: &crate::Shared) -> (Vec<TagRow>, HashMap<String, Vec<String>>) {
    {
        let idx = lock(&shared.index);
        let objs = idx.objects();
        let infos = idx.tags();
        // Tag files per key (§1.1): the oldest valid `created`, then path order.
        let mut files: BTreeMap<String, Vec<(Option<i128>, String)>> = BTreeMap::new();
        for o in objs.iter().filter(|o| o.r#type == "tag" && o.type_single) {
            let title = o.attributes.get("title").and_then(Value::as_str).map(str::trim).filter(|t| !t.is_empty()).map(str::to_string);
            let key = tegg_format::tag_key(&title.unwrap_or_else(|| stem(&o.path)));
            files.entry(key).or_default().push((instant_ns(o.attributes.get("created")), nfc(&o.path)));
        }
        for v in files.values_mut() {
            v.sort_by(|a, b| match (a.0, b.0) {
                (Some(x), Some(y)) => x.cmp(&y).then_with(|| a.1.cmp(&b.1)),
                (Some(_), None) => std::cmp::Ordering::Less,
                (None, Some(_)) => std::cmp::Ordering::Greater,
                (None, None) => a.1.cmp(&b.1),
            });
        }
        let by_path: HashMap<&str, &tegg_index::ObjectInfo> = objs.iter().map(|o| (o.path.as_str(), o)).collect();
        // Last used per key: the newest valid `modified` among the objects carrying it (D-667).
        let mut last: HashMap<&str, (i128, String)> = HashMap::new();
        for o in &objs {
            let Some(ns) = instant_ns(o.attributes.get("modified")) else { continue };
            let raw = text(o.attributes.get("modified")).unwrap_or_default();
            let mut seen = HashSet::new();
            for k in &o.tags {
                if !seen.insert(k.as_str()) {
                    continue;
                }
                let e = last.entry(k.as_str()).or_insert((ns, raw.clone()));
                if ns > e.0 {
                    *e = (ns, raw.clone());
                }
            }
        }
        let counted: HashMap<&str, &tegg_index::TagInfo> = infos.iter().map(|t| (t.key.as_str(), t)).collect();
        let mut keys: Vec<String> = infos.iter().map(|t| t.key.clone()).collect();
        keys.extend(files.keys().cloned());
        keys.sort();
        keys.dedup();
        let rows: Vec<TagRow> = keys
            .into_iter()
            .map(|key| {
                let tf = files.get(&key);
                let winner = tf.and_then(|v| v.first()).and_then(|(_, p)| by_path.get(p.as_str()).copied());
                let losers = tf.map(|v| v.iter().skip(1).map(|(_, p)| p.clone()).collect()).unwrap_or_default();
                let color_raw = winner.and_then(|w| text(w.attributes.get("color")));
                let color = color_raw.as_ref().map(|c| c.to_lowercase()).filter(|c| TAG_COLORS.contains(&c.as_str()));
                let name = match winner {
                    Some(w) => w.attributes.get("title").and_then(Value::as_str).map(str::trim).filter(|t| !t.is_empty()).map(nfc).unwrap_or_else(|| stem(&w.path)),
                    None => counted.get(key.as_str()).map(|t| t.spelling.clone()).unwrap_or_else(|| key.clone()),
                };
                let file = winner.and_then(|w| idx.note_state(&w.path).map(|st| TagFileRef { path: w.path.clone(), version: st.version }));
                let count = counted.get(key.as_str()).map_or(0, |t| t.count);
                let (last_used, last_used_ns) = match last.get(key.as_str()) {
                    Some((ns, raw)) if count > 0 => (Some(raw.clone()), Some(*ns)),
                    _ => (None, None),
                };
                TagRow { key, name, file, losers, color, color_raw, count, last_used, last_used_ns }
            })
            .collect();
        let mut holders: HashMap<String, Vec<String>> = HashMap::new();
        for o in &objs {
            let mut seen = HashSet::new();
            for k in &o.tags {
                if seen.insert(k.clone()) {
                    holders.entry(k.clone()).or_default().push(o.path.clone());
                }
            }
        }
        (rows, holders)
    }
}

impl Core {
    /// §1.2: rows for every key with count ≥ 1 and every winning Tag file, in key order.
    pub fn tag_rows(&self) -> Vec<TagRow> {
        rows(&self.shared)
    }

    /// §1.3: one row per object with an occurrence of `key`, in path order.
    pub fn tag_objects(&self, key: &str) -> Vec<TagObjectRow> {
        let key = tegg_format::tag_key(key);
        let objs = lock(&self.shared.index).objects();
        objs.into_iter()
            .filter(|o| o.tags.iter().any(|t| *t == key))
            .map(|o| {
                let mut tags = Vec::new();
                for t in &o.tags {
                    if *t != key && !tags.contains(t) {
                        tags.push(t.clone());
                    }
                }
                let a = &o.attributes;
                TagObjectRow {
                    id: o.id.clone(),
                    title: o.title.clone(),
                    r#type: o.r#type.clone(),
                    modified: text(a.get("modified")),
                    modified_ns: instant_ns(a.get("modified")),
                    tags,
                    review: text(a.get("review")),
                    status: text(a.get("status")),
                    due: text(a.get("due")),
                    completed: text(a.get("completed")),
                    path: o.path,
                }
            })
            .collect()
    }

    /// §1.4: counts for the rename and delete dialogs; templates are read from disk (D-660).
    pub fn tag_usage(&self, key: &str) -> TagUsage {
        let key = tegg_format::tag_key(key);
        let row = self.tag_rows().into_iter().find(|r| r.key == key);
        let templates = self
            .shared
            .vault
            .list_files()
            .unwrap_or_default()
            .into_iter()
            .filter(|p| p.starts_with("_templates/") && p.to_lowercase().ends_with(".md"))
            .filter(|p| self.shared.vault.read(p).is_ok_and(|(b, _)| extract(&b, &stem(p)).tags.contains(&key)))
            .count();
        match row {
            Some(r) => TagUsage { notes: r.count, templates, file: r.file.map(|f| f.path), losers: r.losers },
            None => TagUsage { templates, ..TagUsage::default() },
        }
    }

    /// The Tag type's folder (D-665), where new Tag files go.
    pub fn tag_folder(&self) -> String {
        self.types().into_iter().find(|t| t.key == "tag").map(|t| t.folder).filter(|f| !f.is_empty()).unwrap_or_else(|| "Tags".into())
    }
}
