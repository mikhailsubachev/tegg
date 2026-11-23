//! Card data (docs/contracts/v1-cards.md §3.2, §3.5; cards.md R211, R212; D-2054, D-2094, D-2096).
//!
//! One builder (`card_data`) fills what one ObjectCard draws besides its type's definition, from the query evaluator's
//! index read (`Index::with_query_objects`), under the read's one index lock (D-784): raw frontmatter values for the
//! type's effective card keys, the tags as the index has them, the excerpt only when `body` is a key, the resolution of
//! relation and `source` links, the Inbox flag and an Image's or PDF's file. The core never applies R212's drawing
//! rules; the UI does (`cards/model.ts`), except the empty rule (`is_empty_value`), which §3.5's duplicate details need.

use std::collections::{BTreeMap, HashMap};

use chrono::{DateTime, NaiveDate};
use serde_json::{Map, Value};
use tegg_format::nfc;
use tegg_index::{NoteState, QueryObject};
use tegg_schema::{AttrType, CardList, TypeFile, CARD_BUILT_INS};

use crate::tasks5a::{query_link, PathMap};
use crate::types3d::link_inner;
use crate::{lock, Core, LinkKind, LinkTarget, Shared};

/// Everything one ObjectCard draws besides its type's definition (plan §4.3; FR-TYP-11 AC-18).
#[derive(Debug, Clone, PartialEq, Default)]
pub struct CardData {
    /// The matched type key (D-239) and the title (falls back to the stem, ObjectInfo rule).
    pub r#type: String,
    pub title: String,
    /// The effective keys the values were taken for (`CardList.keys` of the type), in order.
    pub keys: Vec<String>,
    /// One entry per key of `keys` except `body`, the frontmatter value as written (`null` when absent); `tags` → the
    /// object's tags as the index has them (D-185 spelling, one per key, NFC); a `date-range` attribute `k` → `k-start`,
    /// `k-end`.
    pub values: Map<String, Value>,
    /// `text::excerpt` of the body (D-482) when `body` is in `keys`, else None (no note text read).
    pub excerpt: Option<String>,
    /// Resolution (from the object's own path) of every wikilink in the values of `relation` keys and of `source`, in
    /// key order then value order, unresolved ones included.
    pub links: Vec<LinkTarget>,
    /// D-600 / R61: an Inbox member.
    pub unreviewed: bool,
    /// Image and PDF objects: their first `file`-kind attribute's value resolved (kind `media` when the file exists,
    /// `unresolved` when it doesn't); None for other types or no value.
    pub file: Option<LinkTarget>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct CardExample {
    pub path: String,
    pub card: CardData,
}

/// R212's last row (§3.2): missing, `null`, `""`, `[]`, a string that is only U+2014 (or nothing) after trimming spaces,
/// a list whose items are all empty by this rule. Tied to `@tegg/schema` `isEmpty` by tests/fixtures/types/card-empty.json.
pub fn is_empty_value(v: &Value) -> bool {
    match v {
        Value::Null => true,
        Value::String(s) => {
            let t = s.trim();
            t.is_empty() || t == "\u{2014}"
        }
        Value::Array(a) => a.iter().all(is_empty_value),
        _ => false,
    }
}

/// The card lists and type definitions a read uses (taken once per read, D-784).
pub(crate) struct CardDefs {
    pub defs: BTreeMap<String, TypeFile>,
    pub cards: BTreeMap<String, CardList>,
}

impl CardDefs {
    /// The effective keys of a matched type key; an undefined type uses `card_list_undefined()` (§3.1).
    pub(crate) fn keys(&self, key: &str) -> Vec<String> {
        match self.cards.get(key) {
            Some(c) => c.keys.clone(),
            None => tegg_schema::card_list_undefined().keys,
        }
    }
    fn def(&self, key: &str) -> Option<&TypeFile> {
        self.defs.get(key)
    }
}

/// R61 (D-554, D-600): an Inbox member, from the object's path, matched type and frontmatter.
pub(crate) fn inbox_member(path: &str, r#type: &str, attributes: &Value) -> bool {
    let p = nfc(path);
    if p.starts_with("_templates/") || p.starts_with(".trash/") {
        return false;
    }
    let Some(fm) = attributes.as_object() else { return false };
    let review = fm.get("review").and_then(Value::as_str).map(|s| nfc(s.trim()));
    review.as_deref() == Some("unreviewed") || (matches!(r#type, "quick-note" | "daily-note") && review.as_deref() != Some("reviewed"))
}

/// A frontmatter value by key: exact, else NFC-equal (FR-FMT-12 AC-15).
fn fm_get<'a>(fm: &'a Map<String, Value>, key: &str) -> Option<&'a Value> {
    fm.get(key).or_else(|| fm.iter().find(|(k, _)| nfc(k) == key).map(|(_, v)| v))
}

/// The strings of a scalar-or-list value, in order.
fn strings(v: Option<&Value>) -> Vec<&str> {
    match v {
        Some(Value::String(s)) => vec![s.as_str()],
        Some(Value::Array(a)) => a.iter().filter_map(Value::as_str).collect(),
        _ => Vec::new(),
    }
}

/// The tags as the index has them: frontmatter then inline, the spelling as written (D-185), one per key, NFC.
fn tags_of(o: &QueryObject) -> Value {
    let mut seen: Vec<&str> = Vec::new();
    let mut out: Vec<Value> = Vec::new();
    for (i, key) in o.tags.iter().enumerate() {
        if key.is_empty() || seen.contains(&key.as_str()) {
            continue;
        }
        seen.push(key);
        let spelled = o.tag_spellings.get(i).unwrap_or(key);
        out.push(Value::String(nfc(spelled)));
    }
    Value::Array(out)
}

/// v1-cards §3.2: one card's data. `keys` are the effective keys to take values for; `excerpt` is the body's excerpt
/// when it was read (only where `body` is a key).
pub(crate) fn card_data(o: &QueryObject, objs: &[QueryObject], by_path: &PathMap, keys: &[String], def: Option<&TypeFile>, excerpt: Option<&str>) -> CardData {
    let empty = Map::new();
    let fm = o.attributes.as_object().unwrap_or(&empty);
    let attr = |k: &str| def.and_then(|d| d.attributes.iter().find(|a| nfc(&a.key) == k));
    let mut values = Map::new();
    let mut links: Vec<LinkTarget> = Vec::new();
    for k in keys {
        match k.as_str() {
            "body" => continue,
            "tags" if attr("tags").is_none() => {
                values.insert(k.clone(), tags_of(o));
                continue;
            }
            _ => {}
        }
        let a = attr(k);
        if a.is_some_and(|a| a.r#type == AttrType::DateRange) {
            for part in ["start", "end"] {
                let pk = format!("{k}-{part}");
                values.insert(pk.clone(), fm_get(fm, &pk).cloned().unwrap_or(Value::Null));
            }
            continue;
        }
        let v = fm_get(fm, k);
        values.insert(k.clone(), v.cloned().unwrap_or(Value::Null));
        // Links: relation values and `source`, in key order then value order (the index's own resolution).
        let is_link_key = a.is_some_and(|a| a.r#type == AttrType::Relation) || (a.is_none() && k == "source");
        if is_link_key {
            let mut resolved = o.attr_links.iter().filter(|(ak, _, _)| nfc(ak) == *k).map(|(_, _, to)| *to);
            for s in strings(v) {
                if let Some(t) = link_inner(&Value::String(s.to_string())) {
                    let to = resolved.next().flatten();
                    links.push(query_link(objs, by_path, t, to));
                }
            }
        }
    }
    // Image and PDF: the first `file`-kind attribute's value (resolved as media after the read, `fill_files`).
    let file = if matches!(o.r#type, "image" | "pdf") {
        def.and_then(|d| d.attributes.iter().find(|a| a.r#type == AttrType::File))
            .and_then(|a| fm_get(fm, &nfc(&a.key)))
            .and_then(link_inner)
            .map(|t| LinkTarget { target: t, kind: LinkKind::Unresolved, path: None, title: None, r#type: None })
    } else {
        None
    };
    CardData {
        r#type: o.r#type.to_string(),
        title: o.title.to_string(),
        keys: keys.to_vec(),
        values,
        excerpt: if keys.iter().any(|k| k == "body") { excerpt.map(str::to_string) } else { None },
        links,
        unreviewed: inbox_member(o.path, o.r#type, o.attributes),
        file,
    }
}

/// A `source` value drawn as a link (R212): a wikilink, or an `http(s)` / `file` URL.
fn source_is_link(v: &Value) -> bool {
    let Some(s) = v.as_str().map(str::trim) else { return false };
    if link_inner(v).is_some() {
        return true;
    }
    let lower = s.to_ascii_lowercase();
    lower.starts_with("http://") || lower.starts_with("https://") || lower.starts_with("file:")
}

/// v1-cards §3.5 (FR-LNK-14 AC-15, D-2094): the first two set pill values of the object's card list: `keys` in order,
/// without `tags`, `body`, `description`, `created`, `modified`, relation keys, a linking `source` and `url` keys; a
/// `multi-select` or `aliases` value gives one entry per non-empty item; `checkbox` only when `true`; empty values
/// skipped.
pub(crate) fn detail_values(o: &crate::ObjectInfo, cd: &CardDefs) -> Vec<(String, Value)> {
    let empty = Map::new();
    let fm = o.attributes.as_object().unwrap_or(&empty);
    let def = cd.def(&o.r#type);
    let mut out: Vec<(String, Value)> = Vec::new();
    for k in cd.keys(&o.r#type) {
        if out.len() >= 2 {
            break;
        }
        if matches!(k.as_str(), "tags" | "body" | "description" | "created" | "modified") {
            continue;
        }
        let a = def.and_then(|d| d.attributes.iter().find(|a| nfc(&a.key) == k));
        let kind = a.map(|a| a.r#type.clone());
        if matches!(kind, Some(AttrType::Relation) | Some(AttrType::Url)) {
            continue;
        }
        if kind == Some(AttrType::DateRange) {
            continue; // drawn from `k-start` / `k-end`, not one value
        }
        let Some(v) = fm_get(fm, &k) else { continue };
        if a.is_none() && k == "source" && source_is_link(v) {
            continue;
        }
        if kind == Some(AttrType::Checkbox) && v != &Value::Bool(true) {
            continue;
        }
        let multi = kind == Some(AttrType::MultiSelect) || (a.is_none() && k == "aliases");
        match v {
            Value::Array(items) if multi => {
                for it in items.iter().filter(|x| !is_empty_value(x)) {
                    if out.len() < 2 {
                        out.push((k.clone(), it.clone()));
                    }
                }
            }
            _ if is_empty_value(v) => {}
            _ => out.push((k.clone(), v.clone())),
        }
    }
    out
}

/// D-1927's order key of a `modified` value: its instant (date-times with offset, plain dates at midnight UTC); None
/// for a missing or unreadable value (sorted last).
fn modified_instant(v: Option<&Value>) -> Option<i64> {
    let s = v?.as_str()?.trim();
    if let Ok(d) = DateTime::parse_from_rfc3339(s) {
        return Some(d.timestamp_millis());
    }
    NaiveDate::parse_from_str(s, "%Y-%m-%d").ok().and_then(|d| d.and_hms_opt(0, 0, 0)).map(|d| d.and_utc().timestamp_millis())
}

impl Shared {
    /// Type definitions and card lists as one read uses them. A `.tegg/types/` change the watcher hasn't reported yet is
    /// read first (its folder's file stamps differ from the last refresh), so a read right after another program's
    /// write already follows it (FR-TYP-11 AC-19).
    pub(crate) fn card_defs(&self) -> CardDefs {
        self.fresh_types();
        CardDefs { defs: self.type_defs(), cards: lock(&self.type_cards).clone() }
    }

    /// Image and PDF cards: their file resolved against the vault's files (kind `media`), outside the index lock.
    pub(crate) fn fill_files<'a>(&self, cards: impl Iterator<Item = (&'a str, &'a mut CardData)>, cache: &mut Option<std::sync::Arc<crate::trash6a::FileCache>>) {
        for (path, c) in cards {
            let Some(f) = c.file.as_mut() else { continue };
            let cache = cache.get_or_insert_with(|| self.file_cache());
            if let Some(t) = crate::trash6a::media_file(cache, path, &f.target) {
                *f = t;
            }
        }
    }
}

impl Core {
    /// D-2096 (AP-1591): the type's most recently modified object (its `modified` instant, newest first; a missing or
    /// unreadable `modified` last, D-1927; then path) as card data whose `keys` are every candidate key: the attribute
    /// keys in schema order (no `file`-kind) then `CARD_BUILT_INS`; `excerpt` always read. None: no object.
    pub fn type_card_example(&self, key: &str) -> Option<CardExample> {
        let key = nfc(key);
        let cd = self.shared.card_defs();
        let def = cd.def(&key);
        let mut keys: Vec<String> = def.map(|d| d.attributes.iter().filter(|a| a.r#type != AttrType::File).map(|a| nfc(&a.key)).collect()).unwrap_or_default();
        for b in CARD_BUILT_INS {
            if !keys.iter().any(|k| k == b) {
                keys.push(b.to_string());
            }
        }
        let mut ex = {
            let idx = lock(&self.shared.index);
            idx.with_query_objects(|objs, _| {
                let best = objs
                    .iter()
                    .enumerate()
                    .filter(|(_, o)| o.r#type == key && !o.path.starts_with("_templates/") && !o.path.starts_with(".trash/"))
                    .min_by(|(_, a), (_, b)| {
                        let (ma, mb) = (modified_instant(a.attributes.get("modified")), modified_instant(b.attributes.get("modified")));
                        match (ma, mb) {
                            (Some(x), Some(y)) => y.cmp(&x),
                            (Some(_), None) => std::cmp::Ordering::Less,
                            (None, Some(_)) => std::cmp::Ordering::Greater,
                            (None, None) => std::cmp::Ordering::Equal,
                        }
                        .then_with(|| nfc(a.path).cmp(&nfc(b.path)))
                    })
                    .map(|(i, _)| i)?;
                let by_path: PathMap = objs.iter().enumerate().map(|(i, o)| (o.path, i)).collect();
                let o = &objs[best];
                let excerpt = idx.note_state(o.path).map(|s| s.excerpt).unwrap_or_default();
                Some(CardExample { path: nfc(o.path), card: card_data(o, objs, &by_path, &keys, def, Some(&excerpt)) })
            })
        }?;
        let mut cache = None;
        let path = ex.path.clone();
        self.shared.fill_files(std::iter::once((path.as_str(), &mut ex.card)), &mut cache);
        Some(ex)
    }

    /// v1-cards §3.3: the card data of every indexed path of `paths` (NFC), from one index read; the excerpt only for
    /// types whose card lists `body`.
    pub(crate) fn cards_for(&self, paths: &[String]) -> HashMap<String, CardData> {
        let cd = self.shared.card_defs();
        let mut out: HashMap<String, CardData> = {
            let idx = lock(&self.shared.index);
            idx.with_query_objects(|objs, _| {
                let by_path: PathMap = objs.iter().enumerate().map(|(i, o)| (o.path, i)).collect();
                let mut out = HashMap::new();
                for p in paths {
                    let p = nfc(p);
                    let Some(&i) = by_path.get(p.as_str()) else { continue };
                    let o = &objs[i];
                    let keys = cd.keys(o.r#type);
                    let st: Option<NoteState> = if keys.iter().any(|k| k == "body") { idx.note_state(o.path) } else { None };
                    out.insert(p, card_data(o, objs, &by_path, &keys, cd.def(o.r#type), st.as_ref().map(|s| s.excerpt.as_str())));
                }
                out
            })
        };
        let mut cache = None;
        self.shared.fill_files(out.iter_mut().map(|(p, c)| (p.as_str(), c)), &mut cache);
        out
    }
}
