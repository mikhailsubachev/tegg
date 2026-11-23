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
    /// Slice Q3 (v1-views §35). Red-test stubs: not read yet (always Absent).
    pub view: UsageValue<UsageView>,
    pub group_by: UsageValue<UsageGroupBy>,
    pub lanes: UsageValue<UsageLanes>,
    pub lane_order: UsageValue<Vec<String>>,
    pub widths: UsageValue<Vec<(String, u32)>>,
}

/// v1-views §35 shape readers. Red-test stubs (Q3): always Absent.
pub fn view_value(_v: &Value) -> UsageValue<UsageView> {
    UsageValue::Absent
}
pub fn group_by_value(_v: &Value) -> UsageValue<UsageGroupBy> {
    UsageValue::Absent
}
pub fn lanes_value(_v: &Value) -> UsageValue<UsageLanes> {
    UsageValue::Absent
}
pub fn lane_order_value(_v: &Value) -> UsageValue<Vec<String>> {
    UsageValue::Absent
}
pub fn widths_value(_v: &Value) -> UsageValue<Vec<(String, u32)>> {
    UsageValue::Absent
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

/// `sort` / `columns` of a mapping read as JSON (tegg-schema's `views:` items); other keys ignored.
pub fn usage_of_json(map: &serde_json::Map<String, Value>) -> UsageRaw {
    UsageRaw {
        sort: map.get("sort").map(sort_value).unwrap_or(UsageValue::Absent),
        columns: map.get("columns").map(columns_value).unwrap_or(UsageValue::Absent),
        ..Default::default()
    }
}

/// `sort` / `columns` of a YAML mapping (a fence body or a `views:` item); other keys ignored.
pub fn usage_of(map: &yaml_rust2::yaml::Hash) -> UsageRaw {
    let get = |k: &str| map.get(&Yaml::String(k.into())).map(json_of);
    UsageRaw {
        sort: get("sort").map(|v| sort_value(&v)).unwrap_or(UsageValue::Absent),
        columns: get("columns").map(|v| columns_value(&v)).unwrap_or(UsageValue::Absent),
        ..Default::default()
    }
}
