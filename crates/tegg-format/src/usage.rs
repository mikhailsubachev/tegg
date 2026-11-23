//! A usage's own `sort` / `columns` (docs/contracts/v1-views.md §13.2, R195, R196; D-1838, D-1840): the shape rules shared
//! by the query fence reader and tegg-schema's `views:` items. R185's read rules (v1-views §1.2): `sort` is one mapping
//! `{ by, order }` or a list of them (`[]`: zero levels), every `by` a non-blank string and every `order` `asc`, `desc` or
//! missing (= `asc`); `columns` a list of strings. Any other shape is `Broken`. Whether a `by` or a column key exists is
//! the core's run-time check (§17.2). Values are NFC (FR-FMT-12); `by` is trimmed.

use serde_json::Value;
use yaml_rust2::Yaml;

use crate::extract::nfc;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UsageOrder {
    Asc,
    Desc,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UsageSort {
    pub by: String,
    pub order: UsageOrder,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum UsageValue<T> {
    Absent,
    Set(T),
    Broken,
}

impl<T> Default for UsageValue<T> {
    fn default() -> Self {
        UsageValue::Absent
    }
}

/// v1-views §35 (slice Q3, D-2172): a usage's own display. `board` reads as `Wall` (D-2179).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UsageView {
    List,
    Table,
    Wall,
}
/// v1-views §35: a usage's own lanes. `vertical` / `horizontal` read as `Columns` / `Rows` (D-2179).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UsageLanes {
    Columns,
    Rows,
}
/// v1-views §35: a usage's own grouping; `None` is the word `none` (not grouped).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum UsageGroupBy {
    None,
    Key(String),
    Period(String),
}

/// Default: every key Absent (v1-views §35).
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct UsageRaw {
    pub sort: UsageValue<Vec<UsageSort>>,
    pub columns: UsageValue<Vec<String>>,
    /// Slice Q3 (v1-views §35).
    pub view: UsageValue<UsageView>,
    pub group_by: UsageValue<UsageGroupBy>,
    pub lanes: UsageValue<UsageLanes>,
    pub lane_order: UsageValue<Vec<String>>,
    pub widths: UsageValue<Vec<(String, u32)>>,
}

/// v1-views §35: `view` — `list`, `table`, `wall`, and `board` (→ Wall, D-2179); case-sensitive; anything else Broken.
pub fn view_value(v: &Value) -> UsageValue<UsageView> {
    match v.as_str() {
        Some("list") => UsageValue::Set(UsageView::List),
        Some("table") => UsageValue::Set(UsageView::Table),
        Some("wall") | Some("board") => UsageValue::Set(UsageView::Wall),
        _ => UsageValue::Broken,
    }
}
/// v1-views §35: `group_by` — the exact string `none` → None (D-2191); another non-blank string → Key; a one-entry
/// mapping `<non-blank key>: period` → Period (R201); anything else (a blank string, `month`, D-2180, more entries, a
/// list, a number) Broken.
pub fn group_by_value(v: &Value) -> UsageValue<UsageGroupBy> {
    match v {
        Value::String(s) if s == "none" => UsageValue::Set(UsageGroupBy::None),
        Value::String(s) => {
            let t = s.trim_matches(char::is_whitespace);
            if t.is_empty() { UsageValue::Broken } else { UsageValue::Set(UsageGroupBy::Key(nfc(t))) }
        }
        Value::Object(m) if m.len() == 1 => {
            let (k, x) = m.iter().next().expect("one entry");
            let k = k.trim_matches(char::is_whitespace);
            if !k.is_empty() && x.as_str() == Some("period") { UsageValue::Set(UsageGroupBy::Period(nfc(k))) } else { UsageValue::Broken }
        }
        _ => UsageValue::Broken,
    }
}
/// v1-views §35: `lanes` — `columns`, `rows`, `vertical` (→ Columns), `horizontal` (→ Rows); anything else Broken.
pub fn lanes_value(v: &Value) -> UsageValue<UsageLanes> {
    match v.as_str() {
        Some("columns") | Some("vertical") => UsageValue::Set(UsageLanes::Columns),
        Some("rows") | Some("horizontal") => UsageValue::Set(UsageLanes::Rows),
        _ => UsageValue::Broken,
    }
}
/// v1-views §35: `lane_order` — a list of strings (NFC), `[]` included; anything else Broken.
pub fn lane_order_value(v: &Value) -> UsageValue<Vec<String>> {
    columns_value(v)
}
/// v1-views §35: one `widths` value — a YAML integer 0…100,000 (a float, a string or a negative value is broken).
fn width_of(v: &Value) -> Option<u32> {
    match v {
        Value::Number(n) if !n.is_f64() => n.as_u64().filter(|x| *x <= 100_000).map(|x| x as u32),
        _ => None,
    }
}
/// v1-views §35: `widths` — a mapping of string keys (NFC) to integers 0…100,000. A JSON mapping has no file order;
/// the YAML readers (`usage_of`, `widths_orders`) keep it.
pub fn widths_value(v: &Value) -> UsageValue<Vec<(String, u32)>> {
    match v {
        Value::Object(m) => m.iter().map(|(k, x)| width_of(x).map(|w| (nfc(k), w))).collect::<Option<Vec<_>>>().map(UsageValue::Set).unwrap_or(UsageValue::Broken),
        _ => UsageValue::Broken,
    }
}
/// `widths` of a YAML node, in file order.
fn widths_yaml(y: &Yaml) -> UsageValue<Vec<(String, u32)>> {
    match y {
        Yaml::Hash(h) => h
            .iter()
            .map(|(k, x)| match (k, x) {
                (Yaml::String(k), Yaml::Integer(n)) if (0..=100_000).contains(n) => Some((nfc(k), *n as u32)),
                _ => None,
            })
            .collect::<Option<Vec<_>>>()
            .map(UsageValue::Set)
            .unwrap_or(UsageValue::Broken),
        _ => UsageValue::Broken,
    }
}

/// v1-views §36.1: the file order of each `views:` item's `widths` keys (NFC), None for an item without a `widths`
/// mapping; None when the text doesn't load or has no `views` list. tegg-schema reads items as JSON (sorted keys) and
/// takes the order from here.
pub fn widths_orders(text: &str) -> Option<Vec<Option<Vec<String>>>> {
    let doc = yaml_rust2::YamlLoader::load_from_str(text).ok()?.into_iter().next()?;
    let Yaml::Array(items) = &doc["views"] else { return None };
    Some(
        items
            .iter()
            .map(|i| match &i["widths"] {
                Yaml::Hash(h) => Some(h.keys().map(|k| nfc(&key_text(k))).collect()),
                _ => None,
            })
            .collect(),
    )
}

/// A YAML node as JSON (the shapes the rules look at; other scalars as strings or null).
fn json_of(y: &Yaml) -> Value {
    match y {
        Yaml::String(s) => Value::String(s.clone()),
        Yaml::Integer(n) => Value::from(*n),
        Yaml::Real(r) => r.parse::<f64>().ok().map(Value::from).unwrap_or(Value::Null),
        Yaml::Boolean(b) => Value::Bool(*b),
        Yaml::Array(a) => Value::Array(a.iter().map(json_of).collect()),
        Yaml::Hash(h) => Value::Object(h.iter().map(|(k, v)| (key_text(k), json_of(v))).collect()),
        _ => Value::Null,
    }
}

fn key_text(k: &Yaml) -> String {
    match k {
        Yaml::String(s) => s.clone(),
        Yaml::Integer(n) => n.to_string(),
        Yaml::Boolean(b) => b.to_string(),
        Yaml::Real(r) => r.clone(),
        _ => String::new(),
    }
}

/// One level: a mapping with a non-blank string `by` and an `order` of asc / desc / missing (null = missing).
fn level(v: &Value) -> Option<UsageSort> {
    let Value::Object(m) = v else { return None };
    let Some(Value::String(by)) = m.get("by") else { return None };
    let by = by.trim_matches(char::is_whitespace);
    if by.is_empty() {
        return None;
    }
    let order = match m.get("order") {
        None | Some(Value::Null) => UsageOrder::Asc,
        Some(Value::String(s)) if s == "asc" => UsageOrder::Asc,
        Some(Value::String(s)) if s == "desc" => UsageOrder::Desc,
        _ => return None,
    };
    Some(UsageSort { by: nfc(by), order })
}

/// R185's `sort` shape of a present value.
pub fn sort_value(v: &Value) -> UsageValue<Vec<UsageSort>> {
    let levels = match v {
        Value::Object(_) => level(v).map(|l| vec![l]),
        Value::Array(a) => a.iter().map(level).collect::<Option<Vec<_>>>(),
        _ => None,
    };
    levels.map(UsageValue::Set).unwrap_or(UsageValue::Broken)
}

/// R185's `columns` shape of a present value: a list of strings, NFC.
pub fn columns_value(v: &Value) -> UsageValue<Vec<String>> {
    match v {
        Value::Array(a) => a.iter().map(|x| x.as_str().map(nfc)).collect::<Option<Vec<_>>>().map(UsageValue::Set).unwrap_or(UsageValue::Broken),
        _ => UsageValue::Broken,
    }
}

/// The seven usage keys of a mapping read as JSON (tegg-schema's `views:` items); other keys ignored. `widths` comes in
/// key order (see `widths_orders`).
pub fn usage_of_json(map: &serde_json::Map<String, Value>) -> UsageRaw {
    UsageRaw {
        sort: map.get("sort").map(sort_value).unwrap_or(UsageValue::Absent),
        columns: map.get("columns").map(columns_value).unwrap_or(UsageValue::Absent),
        view: map.get("view").map(view_value).unwrap_or(UsageValue::Absent),
        group_by: map.get("group_by").map(group_by_value).unwrap_or(UsageValue::Absent),
        lanes: map.get("lanes").map(lanes_value).unwrap_or(UsageValue::Absent),
        lane_order: map.get("lane_order").map(lane_order_value).unwrap_or(UsageValue::Absent),
        widths: map.get("widths").map(widths_value).unwrap_or(UsageValue::Absent),
    }
}

/// The seven usage keys of a YAML mapping (a fence body or a `views:` item); other keys ignored.
pub fn usage_of(map: &yaml_rust2::yaml::Hash) -> UsageRaw {
    let raw = |k: &str| map.get(&Yaml::String(k.into()));
    let get = |k: &str| raw(k).map(json_of);
    UsageRaw {
        sort: get("sort").map(|v| sort_value(&v)).unwrap_or(UsageValue::Absent),
        columns: get("columns").map(|v| columns_value(&v)).unwrap_or(UsageValue::Absent),
        view: get("view").map(|v| view_value(&v)).unwrap_or(UsageValue::Absent),
        group_by: get("group_by").map(|v| group_by_value(&v)).unwrap_or(UsageValue::Absent),
        lanes: get("lanes").map(|v| lanes_value(&v)).unwrap_or(UsageValue::Absent),
        lane_order: get("lane_order").map(|v| lane_order_value(&v)).unwrap_or(UsageValue::Absent),
        widths: raw("widths").map(widths_yaml).unwrap_or(UsageValue::Absent),
    }
}
