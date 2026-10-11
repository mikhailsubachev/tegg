//! Tegg core: file names, dates, NFC and read-only extraction. Interface: docs/contracts/ms1-core.md §2.
//! MS1 skeleton: every function is a stub returning a deliberately wrong value until it is implemented.

use chrono::{DateTime, FixedOffset, NaiveDate};

/// D-51, D-52, D-68, D-80, FR-FMT-08, NFR-POR-02.
pub fn sanitize_file_stem(_title: &str) -> String { String::new() }

/// FR-LNK-14, FR-STO-05.
pub fn unique_file_name(_stem: &str, _ext: &str, _taken: &dyn Fn(&str) -> bool) -> String { String::new() }

/// FR-FMT-09.
pub fn daily_note_file_name(_date: NaiveDate, _format: &str) -> String { String::new() }

/// FR-FMT-12.
pub fn nfc(_s: &str) -> String { String::new() }
pub fn same_name(_a: &str, _b: &str) -> bool { false }

/// FR-FMT-11.
pub fn format_date(_d: NaiveDate) -> String { String::new() }
pub fn format_date_time(_t: DateTime<FixedOffset>) -> String { String::new() }
pub fn parse_date(_value: &str) -> Option<NaiveDate> { None }

/// FR-TYP-15.
pub const RESERVED_KEYS: &[&str] = &[];
pub fn is_reserved_key(_key: &str) -> bool { false }

#[derive(Debug, Clone, PartialEq, Default)]
pub struct Extracted {
    pub title: String,
    pub id: Option<String>,
    pub r#type: Option<String>,
    pub attributes: Option<serde_json::Value>,
    pub frontmatter_error: Option<FrontmatterError>,
    pub links: Vec<Link>,
    pub tags: Vec<String>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct FrontmatterError { pub message: String, pub line: usize }

#[derive(Debug, Clone, PartialEq)]
pub struct Link { pub target: String, pub subpath: Option<String>, pub alias: Option<String>, pub embed: bool, pub in_frontmatter: bool }

pub fn extract(_bytes: &[u8], _stem: &str) -> Extracted { Extracted::default() }
