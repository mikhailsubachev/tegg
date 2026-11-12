//! §6. STUB.
use std::path::Path;

use crate::{Plan, RawTotals, Source};

pub fn check_plan(source: &Source, plan: &Plan) -> Vec<Violation> {
    vec![Violation { class: Class::Objects, code: ViolationCode::TotalMismatch, detail: "stub".into() }]
}
pub fn check_vault(source: &Source, plan: &Plan, root: &Path) -> Vec<Violation> {
    vec![Violation { class: Class::Objects, code: ViolationCode::TotalMismatch, detail: "stub".into() }]
}
pub fn totals(source: &Source, space: &str) -> RawTotals {
    RawTotals { objects: 0, attachments: 0, links: 0, other_files: 0 }
}
pub fn count_links(text: &str) -> usize {
    usize::MAX
}
#[derive(Clone, Debug, PartialEq)]
pub struct Violation {
    pub class: Class,
    pub code: ViolationCode,
    pub detail: String,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Class {
    Objects,
    Attachments,
    Links,
    OtherFiles,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ViolationCode {
    TotalMismatch,
    SumMismatch,
    MissingRow,
    ForeignItem,
    DuplicateItem,
    NotWritten,
    WrittenNotPlanned,
}
