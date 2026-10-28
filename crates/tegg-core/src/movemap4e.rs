//! ms4-jobs §14.7 (D-804, D-808, D-833): R101, the default property mapping of a type change, computed once here; the
//! IPC `type_move_plan` and the fake core's twin follow it, and the `Change type?` dialog only renders it.

use serde_json::Value;
use tegg_format::{nfc, type_key};
use tegg_schema::{AttrDef, AttrType};

use crate::Core;

/// One R101 row: a schema property of the old type.
#[derive(Debug, Clone, PartialEq)]
pub struct MapRow {
    pub from: String,
    pub name: String,
    pub kind: String,
    /// The value as stored (first non-empty among the notes), `None` when empty everywhere.
    pub value: Option<String>,
    /// A target key, or `content`.
    pub default: String,
    /// Target keys and names of the same or a wider value type (D-808, D-821).
    pub offered: Vec<(String, String)>,
    pub fixed: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub struct TypeMovePlan {
    pub rows: Vec<MapRow>,
    pub needs_dialog: bool,
}

/// Board E2: whether every value of `from` stays valid as written under `to` (D-808).
pub fn widens(from: &AttrDef, to: &AttrDef) -> bool {
    use AttrType::*;
    let (a, b) = (&from.r#type, &to.r#type);
    if a == b {
        return match a {
            // A relation widens to one that allows at least the same types (`None` = any type).
            Relation => match (&from.to, &to.to) {
                (_, None) => true,
                (None, Some(_)) => false,
                (Some(f), Some(t)) => f.iter().all(|k| t.iter().any(|x| type_key(x) == type_key(k))),
            },
            _ => true,
        };
    }
    matches!(
        (a, b),
        (Number | Checkbox | Date | DateTime | Url | Email | Select | MultiSelect | Relation | Text, LongText)
            | (Number | Checkbox | Date | DateTime | Url | Email | Select | MultiSelect | Relation | LongText, Text)
            | (Date, DateTime)
            | (Select, MultiSelect)
    )
}

fn shown(v: &Value) -> Option<String> {
    match v {
        Value::Null => None,
        Value::String(s) if s.trim().is_empty() => None,
        Value::String(s) => Some(s.clone()),
        Value::Array(a) if a.is_empty() => None,
        Value::Array(a) => Some(a.iter().filter_map(shown).collect::<Vec<_>>().join(", ")),
        other => Some(other.to_string()),
    }
}

impl Core {
    /// R101 for changing `paths` (one type pair) to `to_type`.
    pub fn type_move_plan(&self, paths: &[String], to_type: &str) -> TypeMovePlan {
        let defs = self.shared.type_defs();
        let objects: Vec<_> = paths.iter().filter_map(|p| self.object(&nfc(p))).collect();
        let from_key = objects.first().map(|o| o.r#type.clone()).unwrap_or_default();
        let old = defs.get(&from_key).map(|d| d.attributes.clone()).unwrap_or_default();
        let new = defs.get(&type_key(to_type)).map(|d| d.attributes.clone()).unwrap_or_default();
        let mut rows = Vec::new();
        let mut needs_dialog = false;
        for a in &old {
            let value = objects.iter().find_map(|o| o.attributes.get(&a.key).and_then(shown));
            let same = new.iter().find(|n| nfc(&n.key) == nfc(&a.key));
            let offered: Vec<(String, String)> = new.iter().filter(|n| widens(a, n)).map(|n| (n.key.clone(), n.name.clone())).collect();
            let (default, fixed) = match same {
                Some(n) if n.r#type == a.r#type && widens(a, n) => (n.key.clone(), true),
                Some(n) if widens(a, n) => (n.key.clone(), false),
                _ => ("content".to_string(), false),
            };
            // A row needs an answer when its value would go into the content or could go elsewhere (R101).
            needs_dialog |= value.is_some() && !fixed;
            // A fixed row keeps its target in `offered`, so the dialog can name it (D-821).
            rows.push(MapRow { from: a.key.clone(), name: a.name.clone(), kind: a.r#type.as_str().to_string(), value, default, offered, fixed });
        }
        // R101's last row: every property keeps its key at the same or a wider type: no dialog.
        if rows.iter().all(|r| r.default != "content") {
            needs_dialog = false;
        }
        TypeMovePlan { rows, needs_dialog }
    }
}

impl Core {
    /// `folder_move_preview` (R99 B1): how many objects of `r#type` saving `folder` would move (outside the folder and
    /// its subfolders; no templates, no `.trash/`, only objects whose `type` is written).
    pub fn folder_move_count(&self, r#type: &str, folder: &str) -> usize {
        let k = type_key(r#type);
        // Board G: Daily Note, Tag, Image and PDF objects never move; their folder applies to new objects (D-551).
        if ["daily-note", "tag", "image", "pdf"].contains(&k.as_str()) {
            return 0;
        }
        let f = nfc(folder.trim_matches('/')).to_lowercase();
        self.objects()
            .into_iter()
            .filter(|o| o.r#type == k && o.type_raw.is_some())
            .filter(|o| {
                let p = nfc(&o.path).to_lowercase();
                !p.starts_with("_templates/") && !p.starts_with(".trash/") && !(f.is_empty() || p.starts_with(&format!("{f}/")))
            })
            .count()
    }
}
