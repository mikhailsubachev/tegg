//! A usage's own `sort` / `columns` (docs/contracts/v1-views.md §13.2, R195, R196; D-1838, D-1840): the shape rules shared
//! by the query fence reader and tegg-schema's `views:` items.
//! Red-test stub (Q2.1): nothing is read yet.

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

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UsageRaw {
    pub sort: UsageValue<Vec<UsageSort>>,
    pub columns: UsageValue<Vec<String>>,
}

/// `sort` / `columns` of a YAML mapping (a fence body or a `views:` item); other keys ignored.
/// Red-test stub (Q2.1): always absent.
pub fn usage_of(_map: &yaml_rust2::yaml::Hash) -> UsageRaw {
    UsageRaw { sort: UsageValue::Absent, columns: UsageValue::Absent }
}
