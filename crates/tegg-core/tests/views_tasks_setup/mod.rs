//! Setup for the slice Q2-T L4 / L2 tests (docs/acceptance/views.md part three; docs/contracts/v1-views.md §24…§26,
//! §31): the base tasks fixture (tests/fixtures/vaults/tasks + new-empty/.tegg), the overlay (+ views-tasks), a new
//! vault (new-empty), the Q2-T test clock (`2026-10-14T12:00:00+02:00`, Europe/Prague, `cs`; `en-US`; Los Angeles), the
//! expected bytes of tests/fixtures/queries-files/expected/views-tasks/ and the L3 corpus
//! tests/fixtures/queries-files/expected-views-tasks.json. No AC assertions here: a panic in this module is a setup
//! failure, never a red test (tools/qa CONTRACT §5.2). Uses only types that exist before the build (no `QueryDef` value).
#![allow(dead_code)]

use std::path::{Path, PathBuf};

use chrono::{NaiveDate, Weekday};
use serde_json::Value;

use crate::common::{repo_root, Sandbox};
use crate::views_setup::copy_dir;
use tegg_core::queries_q::QueryEnv;

pub const NOW: &str = "2026-10-14T12:00:00+02:00";
pub const NOW_LA: &str = "2026-10-14T03:00:00-07:00";
pub const TASK_YML: &str = ".tegg/types/task.yml";
pub const SCHEDULE: &str = ".tegg/queries/Schedule.yml";
pub const KANBAN: &str = ".tegg/queries/Kanban.yml";
pub const CEKA: &str = "Čeká na ostatní";
pub const PROJEKTY: &str = "Projekty podle termínu";

/// T01…T19 of the tasks fixture (README), NFC.
pub const T: [&str; 19] = [
    "Tasks/Zavolat Janě.md",
    "Tasks/Poslat rozpočet.md",
    "Tasks/Zalít květiny.md",
    "Tasks/Koupit dárek.md",
    "Tasks/Úklid garáže.md",
    "Tasks/Příprava prezentace.md",
    "Tasks/Obnovit pas.md",
    "Tasks/Přečíst knihu.md",
    "Tasks/Opravit kolo.md",
    "Tasks/Zaplatit fakturu.md",
    "Tasks/Objednat lístky.md",
    "Tasks/Vrátit knihy.md",
    "Tasks/Zrušená cesta.md",
    "Tasks/Bez stavu.md",
    "Tasks/Cizí stav.md",
    "Tasks/Špatné datum.md",
    "Tasks/S časem.md",
    "Tasks/Štítek v textu.md",
    "Tasks/Nákup.md",
];
/// `t(3)` = T03's path.
pub fn t(n: usize) -> String {
    tegg_format::nfc(T[n - 1])
}
pub fn ts(ns: &[usize]) -> Vec<String> {
    ns.iter().map(|n| t(*n)).collect()
}
pub fn qp(name: &str) -> String {
    format!(".tegg/queries/{name}.yml")
}

fn fxv() -> PathBuf {
    repo_root().join("tests/fixtures/vaults")
}
/// The base: tests/fixtures/vaults/tasks (without its README) with new-empty's `.tegg/` copied in (its `task.yml` has
/// no `views`: a vault from before Q2-T).
pub fn base_vault(sb: &Sandbox) -> PathBuf {
    let root = sb.base.join("Úkoly");
    copy_dir(&fxv().join("tasks"), &root, &["README.md"]);
    copy_dir(&fxv().join("new-empty/.tegg"), &root.join(".tegg"), &[]);
    root
}
/// The overlay: the base, then tests/fixtures/vaults/views-tasks (without its README) over it.
pub fn overlay_vault(sb: &Sandbox) -> PathBuf {
    let root = base_vault(sb);
    copy_dir(&fxv().join("views-tasks"), &root, &["README.md"]);
    root
}
/// A vault as `vault_create` makes it: a copy of new-empty.
pub fn new_vault(sb: &Sandbox) -> PathBuf {
    let root = sb.base.join("Nový trezor");
    copy_dir(&fxv().join("new-empty"), &root, &["README.md"]);
    root
}
/// A fixture file: `tasks/<rel>` or, when `overlay`, `views-tasks/<rel>` (falling back to the base and new-empty).
pub fn fx(rel: &str) -> String {
    for dir in ["views-tasks", "tasks", "new-empty"] {
        if let Ok(b) = std::fs::read(fxv().join(dir).join(rel)) {
            return String::from_utf8(b).expect("setup: UTF-8");
        }
    }
    panic!("setup: fixture {rel} not found")
}
pub fn base_fx(rel: &str) -> String {
    for dir in ["tasks", "new-empty"] {
        if let Ok(b) = std::fs::read(fxv().join(dir).join(rel)) {
            return String::from_utf8(b).expect("setup: UTF-8");
        }
    }
    panic!("setup: base fixture {rel} not found")
}
/// tests/fixtures/queries-files/expected/views-tasks/<rel>.
pub fn exp(rel: &str) -> String {
    let p = repo_root().join("tests/fixtures/queries-files/expected/views-tasks").join(rel);
    String::from_utf8(std::fs::read(&p).unwrap_or_else(|e| panic!("setup: expected {rel}: {e}"))).expect("setup: UTF-8")
}
/// The L3 corpus.
pub fn corpus() -> Value {
    let p = repo_root().join("tests/fixtures/queries-files/expected-views-tasks.json");
    serde_json::from_slice(&std::fs::read(&p).expect("setup: corpus")).expect("setup: corpus JSON")
}
/// A `reads` entry of the corpus by name.
pub fn corpus_read(c: &Value, name: &str) -> Value {
    c["reads"].as_array().expect("setup: reads").iter().find(|r| r["name"] == name).cloned().unwrap_or_else(|| panic!("setup: corpus read {name}"))
}
/// The `groups` entries whose `note` contains `needle`.
pub fn corpus_groups(c: &Value, needle: &str) -> Vec<Value> {
    let v: Vec<Value> = c["groups"].as_array().expect("setup: groups").iter().filter(|g| g["note"].as_str().unwrap_or("").contains(needle)).cloned().collect();
    if v.is_empty() {
        panic!("setup: no corpus group with {needle:?}");
    }
    v
}

/// A QueryEnv for a local date, zone and region (`cs`: Monday, `en-US`: Sunday).
pub fn env_at(today: (i32, u32, u32), zone: &str, locale: &str) -> QueryEnv {
    QueryEnv {
        today: NaiveDate::from_ymd_opt(today.0, today.1, today.2).expect("setup: date"),
        tz: zone.parse().expect("setup: zone"),
        week_start: if locale == "en-US" { Weekday::Sun } else { Weekday::Mon },
        locale: locale.into(),
    }
}
/// The Q2-T test clock: Wednesday 2026-10-14, Europe/Prague, `cs`.
pub fn env() -> QueryEnv {
    env_at((2026, 10, 14), "Europe/Prague", "cs")
}
pub fn env_us() -> QueryEnv {
    env_at((2026, 10, 14), "Europe/Prague", "en-US")
}
pub fn env_la() -> QueryEnv {
    env_at((2026, 10, 14), "America/Los_Angeles", "cs")
}
/// A corpus `env` object as a QueryEnv.
pub fn env_of(v: &Value) -> QueryEnv {
    let d = NaiveDate::parse_from_str(v["today"].as_str().expect("setup: today"), "%Y-%m-%d").expect("setup: today date");
    QueryEnv {
        today: d,
        tz: v["zone"].as_str().expect("setup: zone").parse().expect("setup: zone parse"),
        week_start: if v["weekStart"].as_u64() == Some(0) { Weekday::Sun } else { Weekday::Mon },
        locale: v["locale"].as_str().expect("setup: locale").into(),
    }
}

/// Every file of a folder (recursive), as vault-relative `/` paths.
pub fn list_files(root: &Path, dir: &str) -> Vec<String> {
    fn walk(base: &Path, p: &Path, out: &mut Vec<String>) {
        if let Ok(rd) = std::fs::read_dir(p) {
            for e in rd.flatten() {
                let path = e.path();
                if path.is_dir() {
                    walk(base, &path, out);
                } else if let Ok(rel) = path.strip_prefix(base) {
                    out.push(rel.to_string_lossy().replace('\\', "/"));
                }
            }
        }
    }
    let mut out = Vec::new();
    walk(root, &root.join(dir), &mut out);
    out.sort();
    out
}
/// Make a folder read-only (`writable: false`) or writable again.
pub fn set_writable(p: &Path, writable: bool) {
    use std::os::unix::fs::PermissionsExt;
    let mode = if writable { 0o755 } else { 0o555 };
    std::fs::set_permissions(p, std::fs::Permissions::from_mode(mode)).expect("setup: chmod");
}
/// The text with the line `id: <…>` right after the opening `---` removed (a generated id).
pub fn without_id(text: &str) -> String {
    let mut lines: Vec<&str> = text.split_inclusive('\n').collect();
    if lines.len() > 1 && lines[0] == "---\n" && lines[1].starts_with("id: ") {
        lines.remove(1);
    }
    lines.concat()
}
