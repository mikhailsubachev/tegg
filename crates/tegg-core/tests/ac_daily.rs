//! MS4 slice 4B AC tests at the core (L4): FR-DLY-01 AC-4, AC-5 (refusal), AC-6, AC-7 (duplicates), AC-8 (grouping),
//! AC-11 (title, bytes); FR-DLY-02 AC-2, AC-5 (fault injection), AC-6, AC-7, AC-8; FR-DLY-03 AC-3, AC-4; FR-DLY-04
//! AC-2, AC-3, AC-4; FR-DLY-05 AC-1, AC-2 (bytes); FR-DLY-06 AC-1, AC-3…AC-6; FR-DLY-08 AC-5, AC-7; FR-FMT-09
//! AC-3…AC-5. docs/acceptance/daily-notes.md; interface docs/contracts/ms4-daily.md §1–§5. Written from the ACs and
//! the contract only (D-61).
//!
//! Fixture: tests/fixtures/vaults/daily + new-empty/.tegg in a temporary directory on APFS (its README.md isn't a
//! vault file). Bytes, mtime and inode are compared with `common::snapshot`. The core has no clock and no zone
//! (§1): "now" is a value the test writes into the bytes, and day windows are built here with chrono-tz for
//! Europe/Prague and America/Los_Angeles, local midnight to the next local midnight. The fault-injection points of
//! FR-DLY-02 AC-5 use a `VaultFs` wrapper defined in this file (the contract's "existing test-hooks wrapper" doesn't
//! exist yet; see the red-commit report).

mod common;

use std::collections::{BTreeMap, BTreeSet};
use std::io;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, SystemTime};

use chrono::{NaiveDate, TimeZone};
use common::*;
use tegg_core::{Core, CoreError, CoreOptions, DayWindow, LinkKind, RSeg};
use tegg_format::nfc;
use tegg_vault::{FileVersion, FsEntry, LocalFs, VaultFs};

macro_rules! ok {
    ($e:expr, $what:expr) => {
        match $e {
            Ok(v) => v,
            Err(e) => {
                assert!(false, "{} failed: {:?}", $what, e);
                unreachable!()
            }
        }
    };
}

const D01: &str = "Daily/2026-10-01.md";
const D07: &str = "Daily/2026-10-07.md";
const PATEK: &str = "Daily/2026-10-09.md";
const ARCHIV: &str = "Archiv/10.10.2026.md";
const D12: &str = "Daily/2026-10-12.md";
const D12B: &str = "Daily/2026-10-12 (2).md";
const KOLIZE: &str = "Daily/2026-10-16.md";
const SMAZANY: &str = ".trash/Daily/2026-10-05.md";
const NAPAD: &str = "Quick Notes/Nápad z rána.md";
const POZDNI: &str = "Quick Notes/Pozdní nápad.md";
const BEZ_DATA: &str = "Quick Notes/Bez data.md";
const NOVA: &str = "Pages/Nová stránka dne.md";
const UPRAVENA: &str = "Pages/Upravená stránka.md";
const ZMINKY: &str = "Pages/Zmínky.md";
const TEMPLATE: &str = "_templates/Daily Note/Daily Note.md";
const NEW14: &str = "Daily/2026-10-14.md";

const PRAGUE: chrono_tz::Tz = chrono_tz::Europe::Prague;
const LA: chrono_tz::Tz = chrono_tz::America::Los_Angeles;
const NOW_PRAGUE: &str = "2026-10-14T12:00:00+02:00";
const NOW_LA: &str = "2026-10-14T03:00:00-07:00";
const ID: &str = "01JB4B0000000000000000N010";

// ------------------------------------------------------------------------------------------------ setup (no AC assertions)

fn copy_dir(from: &Path, to: &Path, skip: &[&str]) {
    std::fs::create_dir_all(to).expect("setup: create dir");
    for e in std::fs::read_dir(from).expect("setup: read_dir") {
        let e = e.expect("setup: entry");
        if skip.iter().any(|s| e.file_name() == std::ffi::OsStr::new(s)) {
            continue;
        }
        if e.file_type().expect("setup: type").is_dir() {
            copy_dir(&e.path(), &to.join(e.file_name()), &[]);
        } else {
            std::fs::copy(e.path(), to.join(e.file_name())).expect("setup: copy");
        }
    }
}
/// `tests/fixtures/vaults/daily/` (without its README.md) plus `new-empty/.tegg/` in `<sandbox>/<name>`.
fn daily_vault_named(sb: &Sandbox, name: &str) -> PathBuf {
    let root = sb.base.join(name);
    let fx = repo_root().join("tests/fixtures/vaults");
    copy_dir(&fx.join("daily"), &root, &["README.md"]);
    copy_dir(&fx.join("new-empty/.tegg"), &root.join(".tegg"), &[]);
    root
}
fn daily_vault(sb: &Sandbox) -> PathBuf {
    daily_vault_named(sb, "Deník")
}
fn open_dirs(root: &Path, dirs: &tegg_vault::AppDirs, watch: bool) -> Core {
    let core = ok!(Core::open(root, dirs, CoreOptions { watch, sync: None }), "Core::open");
    assert!(core.wait_idle(Duration::from_secs(60)), "indexing did not become idle within 60 s");
    core
}
fn open(root: &Path, sb: &Sandbox, watch: bool) -> Core {
    open_dirs(root, &sb.dirs, watch)
}
fn read(root: &Path, rel: &str) -> String {
    std::fs::read_to_string(root.join(rel)).expect("setup: read")
}
fn swap(text: &str, from: &str, to: &str) -> String {
    assert!(text.contains(from), "fixture no longer contains {from:?}");
    text.replacen(from, to, 1)
}
/// An external change the core is told about (watch: false): write, then `notify_changed`, then idle.
fn ext_write(core: &Core, root: &Path, rel: &str, text: &str) {
    write_raw(root, rel, text.as_bytes());
    core.notify_changed(&[rel.to_string()]);
    assert!(core.wait_idle(Duration::from_secs(10)), "idle after an external write");
}
fn ext_delete(core: &Core, root: &Path, rel: &str) {
    std::fs::remove_file(root.join(rel)).expect("setup: delete");
    core.notify_changed(&[rel.to_string()]);
    assert!(core.wait_idle(Duration::from_secs(10)), "idle after an external delete");
}
fn day(s: &str) -> NaiveDate {
    NaiveDate::parse_from_str(s, "%Y-%m-%d").expect("setup: date")
}
/// §1: local midnight to the next local midnight in `tz`, each with its own offset.
fn window(date: &str, tz: chrono_tz::Tz) -> DayWindow {
    let d = day(date);
    let at = |x: NaiveDate| tz.from_local_datetime(&x.and_hms_opt(0, 0, 0).expect("setup: midnight")).earliest().expect("setup: local midnight").fixed_offset();
    DayWindow { date: d, start: at(d), end: at(d.succ_opt().expect("setup: next day")) }
}
fn changed(a: &BTreeMap<String, Entry>, b: &BTreeMap<String, Entry>) -> Vec<String> {
    let keys: BTreeSet<&String> = a.keys().chain(b.keys()).collect();
    keys.into_iter().filter(|k| a.get(*k) != b.get(*k)).map(|k| nfc(k)).collect()
}
fn paths(v: &[tegg_core::ContextRow]) -> Vec<String> {
    v.iter().map(|r| nfc(&r.path)).collect()
}
fn some(p: &str) -> Option<String> {
    Some(p.to_string())
}
fn view_path(core: &Core, date: &str) -> Option<String> {
    core.daily_view(day(date)).path.map(|p| nfc(&p))
}
fn dates(core: &Core, y: i32, m: u32) -> Vec<String> {
    core.daily_dates(y, m).into_iter().map(|d| d.format("%Y-%m-%d").to_string()).collect()
}
fn strs(v: &[&str]) -> Vec<String> {
    v.iter().map(|s| s.to_string()).collect()
}

/// The fixture template's body expanded for `date` (FR-DLY-06 AC-1, D-325).
fn template_body(date: &str) -> String {
    let d = day(date);
    let y = d.pred_opt().expect("setup").format("%Y-%m-%d");
    let t = d.succ_opt().expect("setup").format("%Y-%m-%d");
    use chrono::Datelike;
    format!("# Deník {}. {}. {}\n\nVčera: [[{y}]] · Zítra: [[{t}]] · Dnes: {date} · {{{{time}}}}\n\n## Poznámky\n", d.day(), d.month(), d.year())
}
/// D-324: the first-write bytes for an empty edit, with the §4 placeholders `{{id}}` / `{{now}}`.
fn draft_text(date: &str, keys: &str, body: &str) -> String {
    format!("---\nid: {{{{id}}}}\ntype: daily-note\ntitle: \"{date}\"\ndate: {date}\n{keys}review: unreviewed\ncreated: {{{{now}}}}\nmodified: {{{{now}}}}\n---\n{body}")
}
fn fill(draft: &str, id: &str, now: &str) -> String {
    draft.replacen("{{id}}", id, 1).replacen("{{now}}", now, 2)
}
/// The bytes the UI would send on a first keystroke: the fixture-template draft plus a typed paragraph.
fn first_bytes(date: &str, now: &str, typed: &str) -> String {
    format!("{}\n{typed}\n", fill(&draft_text(date, "tags: [deník]\n", &template_body(date)), ID, now))
}
fn plain_bytes(date: &str, now: &str, body: &str) -> String {
    fill(&draft_text(date, "", body), ID, now)
}

// ------------------------------------------------------------------------------------------------ FR-DLY-01

#[test]
fn fr_dly_01_ac4_each_date_opens_its_one_note() {
    let sb = sandbox();
    let root = daily_vault(&sb);
    let core = open(&root, &sb, false);
    let want: [(&str, Option<&str>); 8] = [
        ("2026-10-01", Some(D01)),
        ("2026-10-07", Some(D07)),
        ("2026-10-09", Some(PATEK)),
        ("2026-10-10", Some(ARCHIV)),
        ("2026-10-12", Some(D12B)),
        ("2026-10-05", None),
        ("2026-10-14", None),
        ("2026-10-16", None),
    ];
    for (d, p) in want {
        assert_eq!(view_path(&core, d), p.map(str::to_string), "daily_view({d}).path (D-318, D-319, D-102)");
        assert_eq!(core.daily_note(day(d)).map(|x| nfc(&x)), p.map(str::to_string), "Index::daily_note({d}) uses the same winner rule");
    }
}

#[test]
fn fr_dly_01_ac4_a_template_with_a_date_is_never_returned() {
    let sb = sandbox();
    let root = daily_vault(&sb);
    write_raw(&root, "_templates/Daily Note/Jiný den.md", "---\ntype: daily-note\ntitle: \"2026-10-18\"\ndate: 2026-10-18\n---\nŠablona s datem.\n".as_bytes());
    let core = open(&root, &sb, false);
    assert_eq!(view_path(&core, "2026-10-18"), None, "a template is never a Daily Note (FR-TPL-07)");
    assert_eq!(core.daily_note(day("2026-10-18")), None);
    assert_eq!(dates(&core, 2026, 10), strs(&["2026-10-01", "2026-10-07", "2026-10-09", "2026-10-10", "2026-10-12"]), "October marks without the template");
}

#[test]
fn fr_dly_01_ac5_create_object_refuses_daily_note() {
    let sb = sandbox();
    let root = daily_vault(&sb);
    let core = open(&root, &sb, false);
    let before = snapshot(&root);
    let bytes = plain_bytes("2026-10-14", NOW_PRAGUE, "Dnes\n");
    let r = core.create_object("daily-note", "2026-10-14", bytes.as_bytes());
    assert!(matches!(r, Err(CoreError::UseDailyNote)), "create_object(daily-note) → UseDailyNote (D-318), got {r:?}");
    assert_eq!(changed(&before, &snapshot(&root)), Vec::<String>::new(), "nothing written");
}

#[test]
fn fr_dly_01_ac6_latest_created_instant_wins() {
    let sb = sandbox();
    let root = daily_vault(&sb);
    let core = open(&root, &sb, false);
    assert_eq!(view_path(&core, "2026-10-12"), some(D12B), "(2) has the later created (21:00 vs 08:00)");
    let t = read(&root, D12);
    // 21:30+03:00 = 18:30Z, older than (2)'s 19:00Z although its text sorts later.
    ext_write(&core, &root, D12, &swap(&t, "created: 2026-10-12T08:00:00+02:00", "created: 2026-10-12T21:30:00+03:00"));
    assert_eq!(view_path(&core, "2026-10-12"), some(D12B), "ordering is by instant, not by text");
    ext_write(&core, &root, D12, &swap(&t, "created: 2026-10-12T08:00:00+02:00", "created: 2026-10-12T22:00:00+02:00"));
    assert_eq!(view_path(&core, "2026-10-12"), some(D12), "12 Oct is now the newest (22:00 > 21:00)");
    assert_eq!(core.daily_view(day("2026-10-12")).duplicates.iter().map(|p| nfc(p)).collect::<Vec<_>>(), strs(&[D12B]), "the loser is the duplicate");
}

fn tie_vault(sb: &Sandbox, files: &[(&str, &str)]) -> PathBuf {
    let root = sb.base.join("Remíza");
    copy_dir(&repo_root().join("tests/fixtures/vaults/new-empty/.tegg"), &root.join(".tegg"), &[]);
    for (p, t) in files {
        write_raw(&root, p, t.as_bytes());
    }
    root
}
fn note(id: &str, date: &str, created: Option<&str>, modified: Option<&str>) -> String {
    let mut s = format!("---\nid: {id}\ntype: daily-note\ntitle: \"{date}\"\ndate: {date}\n");
    if let Some(c) = created {
        s += &format!("created: {c}\n");
    }
    if let Some(m) = modified {
        s += &format!("modified: {m}\n");
    }
    s + "---\nŽluťoučký kůň.\n"
}

#[test]
fn fr_dly_01_ac6_ties_by_modified_then_nfc_path_and_missing_is_oldest() {
    let sb = sandbox();
    let c = "2026-10-18T08:00:00+02:00";
    let root = tie_vault(
        &sb,
        &[
            ("Daily/b.md", &note("01JB4B0000000000000000T001", "2026-10-18", Some(c), Some("2026-10-18T09:00:00+02:00"))),
            ("Daily/a.md", &note("01JB4B0000000000000000T002", "2026-10-18", Some(c), Some("2026-10-18T08:30:00+02:00"))),
            ("Daily/c.md", &note("01JB4B0000000000000000T003", "2026-10-18", None, Some("2026-10-19T09:00:00+02:00"))),
            // Equal created and modified: the NFC path that sorts first by bytes wins ("Á…" > "Z…" in bytes).
            ("Daily/Ábel.md", &note("01JB4B0000000000000000T004", "2026-10-19", Some(c), Some(c))),
            ("Daily/Zeta.md", &note("01JB4B0000000000000000T005", "2026-10-19", Some(c), Some(c))),
            // Without created at all: older than any note that has one.
            ("Daily/x.md", &note("01JB4B0000000000000000T006", "2026-10-20", None, None)),
            ("Daily/y.md", &note("01JB4B0000000000000000T007", "2026-10-20", Some("2026-10-01T00:00:00+02:00"), None)),
        ],
    );
    let core = open(&root, &sb, false);
    let v18 = core.daily_view(day("2026-10-18"));
    assert_eq!(v18.path.map(|p| nfc(&p)), some("Daily/b.md"), "equal created: the later modified wins; c.md has no created");
    assert_eq!(v18.duplicates.iter().map(|p| nfc(p)).collect::<Vec<_>>(), strs(&["Daily/a.md", "Daily/c.md"]), "losers in winner order");
    assert_eq!(view_path(&core, "2026-10-19"), some("Daily/Zeta.md"), "both equal: byte order of the NFC path, ascending (Z < Á)");
    assert_eq!(view_path(&core, "2026-10-20"), some("Daily/y.md"), "a note without created is older than one with it (D-335)");
}

#[test]
fn fr_dly_01_ac7_duplicates_in_the_view() {
    let sb = sandbox();
    let root = daily_vault(&sb);
    let core = open(&root, &sb, false);
    let before = snapshot(&root);
    let v = core.daily_view(day("2026-10-12"));
    assert_eq!(v.path.map(|p| nfc(&p)), some(D12B));
    assert_eq!(v.duplicates.iter().map(|p| nfc(p)).collect::<Vec<_>>(), strs(&[D12]), "the D-319 notice names the older note");
    assert!(core.daily_view(day("2026-10-07")).duplicates.is_empty(), "no duplicates for 7 Oct");
    let _ = core.read_note(D12, SystemTime::now());
    let _ = core.read_note(D12B, SystemTime::now());
    assert_eq!(changed(&before, &snapshot(&root)), Vec::<String>::new(), "reading writes nothing; nothing merged, renamed or deleted");
}

#[test]
fn fr_dly_01_ac8_duplicate_titles_group_daily_notes_by_date() {
    let sb = sandbox();
    let root = daily_vault(&sb);
    let core = open(&root, &sb, false);
    let groups = core.duplicate_titles();
    let g = groups.iter().find(|g| g.key == "2026-10-12");
    assert!(g.is_some(), "a group 2026-10-12: {groups:?}");
    let g = g.cloned().unwrap_or_else(|| unreachable!());
    assert_eq!(g.label, "2026-10-12", "label is the date (D-334)");
    let members: BTreeSet<String> = g.objects.iter().map(|o| nfc(&o.path)).collect();
    assert_eq!(members, [D12, D12B].iter().map(|s| s.to_string()).collect(), "both 12 Oct notes");
    assert!(g.objects.iter().all(|o| o.type_key == "daily-note" && o.title == "2026-10-12"), "type Daily Note, title the date");
    assert!(g.objects.iter().all(|o| o.details.created.is_some()), "each with its created");
    assert!(!groups.iter().any(|g| g.objects.iter().any(|o| nfc(&o.path) == PATEK)), "Pátek is a duplicate of nothing");
    assert!(!groups.iter().any(|g| g.key.to_lowercase() == "pátek"), "no group keyed by Pátek's stored title");
    // A third note for 12 Oct, then the newest one removed.
    ext_write(&core, &root, "Jinde/třetí.md", &note("01JB4B0000000000000000T010", "2026-10-12", Some("2026-10-12T23:00:00+02:00"), None));
    let g3 = core.duplicate_titles().into_iter().find(|g| g.key == "2026-10-12").map(|g| g.objects.len());
    assert_eq!(g3, Some(3), "the group grows to 3");
    assert_eq!(view_path(&core, "2026-10-12"), some("Jinde/třetí.md"), "the newest created opens");
    assert_eq!(core.daily_view(day("2026-10-12")).duplicates.len(), 2, "2 other notes have this date");
    ext_delete(&core, &root, "Jinde/třetí.md");
    ext_delete(&core, &root, D12B);
    assert!(!core.duplicate_titles().iter().any(|g| g.key == "2026-10-12"), "the group is gone");
    assert_eq!(view_path(&core, "2026-10-12"), some(D12), "12 Oct opens the remaining note");
}

#[test]
fn fr_dly_01_ac11_mismatched_title_shows_the_date_and_stays_searchable() {
    let sb = sandbox();
    let root = daily_vault(&sb);
    let core = open(&root, &sb, false);
    let before = snapshot(&root);
    let o = core.object(PATEK);
    assert!(o.is_some(), "Pátek indexed");
    let o = o.unwrap_or_else(|| unreachable!());
    assert_eq!(o.title, "2026-10-09", "the displayed title is the date (D-320)");
    assert_eq!(o.stored_title.as_deref(), Some("Pátek"), "stored_title keeps the written title (D-334)");
    assert_eq!(core.object(D07).and_then(|x| x.stored_title), None, "stored_title is None when it equals the date");
    let hits = core.switcher("Pátek", 20);
    let hit = hits.iter().find(|i| i.path.as_deref().map(nfc).as_deref() == Some(PATEK));
    assert!(hit.is_some(), "the switcher still finds Pátek by its stored title: {hits:?}");
    assert_eq!(hit.map(|i| i.title.clone()), some("2026-10-09"), "listed as 2026-10-09");
    let _ = core.read_note(PATEK, SystemTime::now());
    assert_eq!(changed(&before, &snapshot(&root)), Vec::<String>::new(), "opening and reading write nothing");
}

#[test]
fn fr_dly_01_ac11_first_edit_writes_the_line_modified_and_title() {
    let sb = sandbox();
    let root = daily_vault(&sb);
    let core = open(&root, &sb, false);
    let (bytes, v) = ok!(core.read_note(PATEK, SystemTime::now()), "read Pátek");
    let orig = String::from_utf8(bytes).unwrap_or_default();
    // The UI's save path (@tegg/doc fixDailyTitle + the edit + touchModified, §6.3).
    let edited = swap(
        &swap(&swap(&orig, "title: Pátek\n", "title: \"2026-10-09\"\n"), "modified: 2026-10-09T08:00:00+02:00", "modified: 2026-10-14T12:00:00+02:00"),
        "Název se liší od data.",
        "Název se liší od data. Doplněno.",
    );
    ok!(core.write_note(PATEK, edited.as_bytes(), Some(&v)), "write Pátek");
    let now = read(&root, PATEK);
    let diff: Vec<(&str, &str)> = orig.lines().zip(now.lines()).filter(|(a, b)| a != b).collect();
    assert_eq!(diff.len(), 3, "exactly the title, modified and the edited line change: {diff:?}");
    assert_eq!(orig.lines().count(), now.lines().count(), "no line added or removed");
    assert_eq!(core.object(PATEK).and_then(|o| o.stored_title), None, "after the fix the stored title equals the date");
    assert_eq!(view_path(&core, "2026-10-09"), some(PATEK));
}

// ------------------------------------------------------------------------------------------------ FR-DLY-02

fn first_write_in(tz_now: &str) {
    let sb = sandbox();
    let root = daily_vault(&sb);
    let core = open(&root, &sb, false);
    let draft = ok!(core.daily_draft(day("2026-10-14")), "daily_draft(14)");
    assert_eq!(draft.body, draft_text("2026-10-14", "tags: [deník]\n", &template_body("2026-10-14")), "draft bytes (D-324, D-322)");
    assert_eq!(nfc(&draft.path), NEW14, "draft path");
    assert!(!draft.format_fallback && draft.template_invalid.is_none());
    let before = snapshot(&root);
    let bytes = first_bytes("2026-10-14", tz_now, "Dnes");
    let made = ok!(core.daily_create(day("2026-10-14"), bytes.as_bytes()), "daily_create(14)");
    assert_eq!(nfc(&made.path), NEW14);
    assert!(made.duplicates.is_empty(), "no other note shares 14 Oct");
    assert_eq!(read(&root, NEW14), bytes, "the file holds exactly the bytes sent");
    let after = snapshot(&root);
    assert_eq!(changed(&before, &after), strs(&[NEW14]), "exactly one file, no temp file left, no other file touched");
    assert_eq!(view_path(&core, "2026-10-14"), some(NEW14), "indexed before returning");
    let text = read(&root, NEW14);
    let fm: Vec<&str> = text.lines().skip(1).take_while(|l| *l != "---").map(|l| l.split(':').next().unwrap_or("")).collect();
    assert_eq!(fm, ["id", "type", "title", "date", "tags", "review", "created", "modified"], "D-324 key order");
    assert!(text.contains(&format!("created: {tz_now}\nmodified: {tz_now}\n")), "the instants as given, with the zone's offset");
}

#[test]
fn fr_dly_02_ac2_first_write_creates_one_exact_file_europe_prague() {
    first_write_in(NOW_PRAGUE);
}

#[test]
fn fr_dly_02_ac2_first_write_creates_one_exact_file_america_los_angeles() {
    first_write_in(NOW_LA);
}

#[test]
fn fr_dly_02_ac2_daily_create_refuses_bytes_of_another_date_or_type() {
    let sb = sandbox();
    let root = daily_vault(&sb);
    let core = open(&root, &sb, false);
    let before = snapshot(&root);
    let good = first_bytes("2026-10-14", NOW_PRAGUE, "Dnes");
    for (what, bad) in [
        ("another date", good.replace("date: 2026-10-14", "date: 2026-10-15")),
        ("another title", good.replace("title: \"2026-10-14\"", "title: Dnes")),
        ("another type", good.replace("type: daily-note", "type: page")),
    ] {
        let r = core.daily_create(day("2026-10-14"), bad.as_bytes());
        assert!(matches!(r, Err(CoreError::DailyMismatch)), "{what}: DailyMismatch, got {r:?}");
    }
    assert_eq!(changed(&before, &snapshot(&root)), Vec::<String>::new(), "nothing written");
    // Red guard and positive case: the right bytes are accepted.
    ok!(core.daily_create(day("2026-10-14"), good.as_bytes()), "daily_create with matching bytes");
}

/// FR-DLY-02 AC-5: a kill at one point of the first write. `Before`: the exclusive create/rename never happens;
/// `Between`: it happens, then the process "dies" before the index update; `After`: the write and the index update
/// complete, then the process dies.
#[derive(Clone, Copy, Debug, PartialEq)]
enum Kill {
    Before,
    Between,
    After,
}
struct FaultFs {
    inner: LocalFs,
    point: Kill,
    dead: AtomicBool,
}
impl FaultFs {
    fn hit(&self, path: &str) -> bool {
        nfc(path).contains("2026-10-14")
    }
    fn gate(&self) -> io::Result<()> {
        if self.dead.load(Ordering::SeqCst) {
            Err(io::Error::other("killed (test)"))
        } else {
            Ok(())
        }
    }
}
impl VaultFs for FaultFs {
    fn list(&self) -> io::Result<Vec<FsEntry>> {
        self.inner.list()
    }
    fn read(&self, path: &str) -> io::Result<(Vec<u8>, FileVersion)> {
        self.inner.read(path)
    }
    fn version(&self, path: &str) -> io::Result<Option<FileVersion>> {
        self.inner.version(path)
    }
    fn replace(&self, path: &str, bytes: &[u8]) -> io::Result<FileVersion> {
        self.gate()?;
        self.inner.replace(path, bytes)
    }
    fn create_new(&self, path: &str, bytes: &[u8]) -> io::Result<FileVersion> {
        self.gate()?;
        if self.hit(path) && self.point == Kill::Before {
            self.dead.store(true, Ordering::SeqCst);
            return Err(io::Error::other("killed before rename (test)"));
        }
        let v = self.inner.create_new(path, bytes)?;
        if self.hit(path) && self.point == Kill::Between {
            self.dead.store(true, Ordering::SeqCst);
            return Err(io::Error::other("killed between rename and index (test)"));
        }
        Ok(v)
    }
    fn rename_no_replace(&self, from: &str, to: &str) -> io::Result<()> {
        self.gate()?;
        if self.hit(to) && self.point == Kill::Before {
            self.dead.store(true, Ordering::SeqCst);
            return Err(io::Error::other("killed before rename (test)"));
        }
        self.inner.rename_no_replace(from, to)?;
        if self.hit(to) && self.point == Kill::Between {
            self.dead.store(true, Ordering::SeqCst);
            return Err(io::Error::other("killed between rename and index (test)"));
        }
        Ok(())
    }
    fn create_dir_all(&self, path: &str) -> io::Result<()> {
        self.gate()?;
        self.inner.create_dir_all(path)
    }
    fn remove_file(&self, path: &str) -> io::Result<()> {
        self.gate()?;
        self.inner.remove_file(path)
    }
    fn is_placeholder(&self, path: &str) -> io::Result<bool> {
        self.inner.is_placeholder(path)
    }
}

#[test]
fn fr_dly_02_ac5_kill_points_leave_no_partial_or_orphan_file() {
    for point in [Kill::Before, Kill::Between, Kill::After] {
        let sb = sandbox();
        let root = daily_vault(&sb);
        let before = snapshot(&root);
        let bytes = first_bytes("2026-10-14", NOW_PRAGUE, "Dnes");
        {
            let fs = Arc::new(FaultFs { inner: LocalFs::new(&root), point, dead: AtomicBool::new(false) });
            let core = ok!(Core::open_with(fs as Arc<dyn VaultFs>, &sb.dirs, CoreOptions { watch: false, sync: None }), "Core::open_with");
            assert!(core.wait_idle(Duration::from_secs(60)), "idle");
            let r = core.daily_create(day("2026-10-14"), bytes.as_bytes());
            if point == Kill::After {
                assert!(r.is_ok(), "{point:?}: the write completes: {r:?}");
            }
        }
        // Next start on the plain file system.
        let core = open(&root, &sb, false);
        let added = changed(&before, &snapshot(&root));
        match point {
            Kill::Before => assert_eq!(added, Vec::<String>::new(), "{point:?}: no file, no orphaned temp file after the next start"),
            _ => {
                assert_eq!(added, strs(&[NEW14]), "{point:?}: only the complete file, no temp file");
                assert_eq!(read(&root, NEW14), bytes, "{point:?}: never a partial file");
            }
        }
        let want = if point == Kill::Before { None } else { some(NEW14) };
        assert_eq!(view_path(&core, "2026-10-14"), want, "{point:?}: after restart daily_view shows the file or the virtual note");
    }
}

#[test]
fn fr_dly_02_ac6_a_taken_name_gets_a_suffix_and_wins_date_first() {
    let sb = sandbox();
    let root = daily_vault(&sb);
    let core = open(&root, &sb, false);
    let draft = ok!(core.daily_draft(day("2026-10-16")), "daily_draft(16)");
    assert_eq!(nfc(&draft.path), "Daily/2026-10-16 (2).md", "Kolize holds the name (FR-FMT-08)");
    let before = snapshot(&root);
    let made = ok!(core.daily_create(day("2026-10-16"), first_bytes("2026-10-16", NOW_PRAGUE, "Kolize").as_bytes()), "daily_create(16)");
    assert_eq!(nfc(&made.path), "Daily/2026-10-16 (2).md");
    let text = read(&root, "Daily/2026-10-16 (2).md");
    assert!(text.contains("\ndate: 2026-10-16\n") && text.contains("\ntitle: \"2026-10-16\"\n"), "date and title");
    assert_eq!(before.get(KOLIZE), snapshot(&root).get(KOLIZE), "Kolize keeps bytes, mtime and inode");
    let t = core.resolve_links(ZMINKY, &["2026-10-16".to_string()]);
    assert_eq!(t.first().map(|x| (x.kind, x.path.as_deref().map(nfc))), Some((LinkKind::Daily, some("Daily/2026-10-16 (2).md"))), "[[2026-10-16]] resolves to the new note, date first (D-162)");
}

#[test]
fn fr_dly_02_ac7_a_note_that_arrived_first_is_never_overwritten() {
    let sb = sandbox();
    let root = daily_vault(&sb);
    let core = open(&root, &sb, false);
    // Another device's note for 14 Oct lands at the default name before the user's first write; the core hasn't
    // indexed it (no notification), so only the re-check at creation can see it.
    let other = note("01JB4B0000000000000000T020", "2026-10-14", Some("2026-10-14T11:59:00+02:00"), None);
    write_raw(&root, NEW14, other.as_bytes());
    let made = ok!(core.daily_create(day("2026-10-14"), first_bytes("2026-10-14", NOW_PRAGUE, "Moje").as_bytes()), "daily_create(14)");
    assert_eq!(nfc(&made.path), "Daily/2026-10-14 (2).md", "the user's note is its own file");
    assert_eq!(made.duplicates.iter().map(|p| nfc(p)).collect::<Vec<_>>(), strs(&[NEW14]), "duplicates names the other file");
    assert_eq!(read(&root, NEW14), other, "the other file keeps its bytes");
    assert!(read(&root, "Daily/2026-10-14 (2).md").contains("\nMoje\n"), "the typed text is kept");
    let v = core.daily_view(day("2026-10-14"));
    assert_eq!(v.path.map(|p| nfc(&p)), some("Daily/2026-10-14 (2).md"), "the user's note is newer (12:00 > 11:59) and opens");
    assert_eq!(v.duplicates.iter().map(|p| nfc(p)).collect::<Vec<_>>(), strs(&[NEW14]), "the D-319 notice appears");
}

#[test]
fn fr_dly_02_ac8_a_failed_first_write_leaves_nothing_and_can_retry() {
    use std::os::unix::fs::PermissionsExt;
    let sb = sandbox();
    let root = daily_vault(&sb);
    let core = open(&root, &sb, false);
    let before = snapshot(&root);
    let dir = root.join("Daily");
    std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o555)).expect("setup: read-only Daily/");
    let bytes = first_bytes("2026-10-14", NOW_PRAGUE, "Dnes");
    let r = core.daily_create(day("2026-10-14"), bytes.as_bytes());
    std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o755)).expect("setup: writable again");
    assert!(matches!(r, Err(CoreError::Vault(_))), "an Io (vault) error, got {r:?}");
    assert_eq!(changed(&before, &snapshot(&root)), Vec::<String>::new(), "nothing partial, no temp file");
    assert_eq!(view_path(&core, "2026-10-14"), None, "still virtual");
    let made = ok!(core.daily_create(day("2026-10-14"), bytes.as_bytes()), "the retry");
    assert_eq!(nfc(&made.path), NEW14);
}

// ------------------------------------------------------------------------------------------------ FR-DLY-03

#[test]
fn fr_dly_03_ac3_october_marks_and_the_same_after_a_rebuild() {
    let sb = sandbox();
    let root = daily_vault(&sb);
    let want = strs(&["2026-10-01", "2026-10-07", "2026-10-09", "2026-10-10", "2026-10-12"]);
    {
        let core = open(&root, &sb, false);
        assert_eq!(dates(&core, 2026, 10), want, "1, 7, 9, 10, 12 (not 5 trashed, 16 no date, 14 virtual, 20 linked only)");
        assert_eq!(dates(&core, 2026, 9), Vec::<String>::new(), "September has none");
        assert_eq!(dates(&core, 2026, 11), Vec::<String>::new(), "November has none");
    }
    let fresh = fresh_dirs(&sb, "Nový stroj");
    let core = open_dirs(&root, &fresh, false);
    assert_eq!(dates(&core, 2026, 10), want, "the same marks from a rebuilt index (AR-01)");
}

#[test]
fn fr_dly_03_ac4_marks_follow_writes_and_external_changes() {
    let sb = sandbox();
    let root = daily_vault(&sb);
    let core = open(&root, &sb, true);
    let has = |d: &str| dates(&core, 2026, 10).contains(&d.to_string());
    ok!(core.daily_create(day("2026-10-14"), first_bytes("2026-10-14", NOW_PRAGUE, "Dnes").as_bytes()), "first write of 14");
    assert!(has("2026-10-14"), "14 is marked at once after its write");
    write_raw(&root, "Daily/2026-10-20.md", note("01JB4B0000000000000000T030", "2026-10-20", Some("2026-10-14T12:00:00+02:00"), None).as_bytes());
    assert!(wait_until(Duration::from_secs(2), || has("2026-10-20")).is_some(), "an external 20 Oct is marked within 2 s");
    std::fs::remove_file(root.join(D01)).expect("setup: delete 1 Oct");
    assert!(wait_until(Duration::from_secs(2), || !has("2026-10-01")).is_some(), "deleting 1 Oct unmarks it within 2 s");
    write_raw(&root, ARCHIV, swap(&read(&root, ARCHIV), "date: 2026-10-10", "date: 2026-10-11").as_bytes());
    assert!(wait_until(Duration::from_secs(2), || has("2026-10-11") && !has("2026-10-10")).is_some(), "Archiv's mark moves from 10 to 11 within 2 s");
    std::fs::create_dir_all(root.join(".trash/Daily")).expect("setup");
    std::fs::rename(root.join(D07), root.join(".trash/Daily/2026-10-07.md")).expect("setup: trash 7 Oct");
    assert!(wait_until(Duration::from_secs(2), || !has("2026-10-07")).is_some(), "moving 7 Oct to .trash/ unmarks it within 2 s");
}

// ------------------------------------------------------------------------------------------------ FR-DLY-04

#[test]
fn fr_dly_04_ac2_sections_for_14_october_in_europe_prague() {
    let sb = sandbox();
    let root = daily_vault(&sb);
    let core = open(&root, &sb, false);
    let p = core.daily_context(&window("2026-10-14", PRAGUE), 50);
    assert_eq!(paths(&p.sections.quick_notes), strs(&[NAPAD]), "Quick Notes = Nápad z rána");
    assert_eq!(paths(&p.sections.created), strs(&[NOVA]), "Created = Nová stránka dne (Nápad z rána not repeated)");
    assert_eq!(paths(&p.sections.modified), strs(&[UPRAVENA]), "Modified = Upravená stránka (Created objects not repeated)");
    assert_eq!(p.totals, [1, 1, 1], "totals");
    for r in p.sections.quick_notes.iter().chain(&p.sections.created).chain(&p.sections.modified) {
        assert!(![BEZ_DATA, TEMPLATE, SMAZANY].contains(&nfc(&r.path).as_str()), "{} is never listed", r.path);
    }
    let row = &p.sections.quick_notes[0];
    assert_eq!((row.title.as_str(), row.r#type.as_str(), row.at.as_str()), ("Nápad z rána", "quick-note", "2026-10-14T07:30:00+02:00"), "row fields");
}

#[test]
fn fr_dly_04_ac2_15_october_and_7_october_in_europe_prague() {
    let sb = sandbox();
    let root = daily_vault(&sb);
    let core = open(&root, &sb, false);
    let p15 = core.daily_context(&window("2026-10-15", PRAGUE), 50);
    assert_eq!(paths(&p15.sections.quick_notes), strs(&[POZDNI]), "15 Oct: Pozdní nápad");
    let p7 = core.daily_context(&window("2026-10-07", PRAGUE), 50);
    assert_eq!(p7.sections, tegg_core::DailyContext::default(), "7 Oct: the note itself is excluded, every section empty");
    assert_eq!(p7.totals, [0, 0, 0]);
    // Red guard: 14 Oct is not empty.
    assert_eq!(core.daily_context(&window("2026-10-14", PRAGUE), 50).totals, [1, 1, 1]);
}

#[test]
fn fr_dly_04_ac2_other_daily_notes_are_listed_the_note_itself_is_not() {
    let sb = sandbox();
    let root = daily_vault(&sb);
    let core = open(&root, &sb, false);
    let p = core.daily_context(&window("2026-10-12", PRAGUE), 50);
    // 12 Oct opens (2) (D-319); the older 12 Oct note was created and modified that day.
    assert_eq!(paths(&p.sections.created), strs(&[D12]), "the other Daily Note is in Created, the open one is excluded");
    assert_eq!(paths(&p.sections.modified), Vec::<String>::new(), "and not repeated in Modified");
}

#[test]
fn fr_dly_04_ac3_sections_in_america_los_angeles() {
    let sb = sandbox();
    let root = daily_vault(&sb);
    let core = open(&root, &sb, false);
    let p = core.daily_context(&window("2026-10-14", LA), 50);
    assert_eq!(paths(&p.sections.quick_notes), strs(&[POZDNI]), "Pozdní nápad is 15:30 on 14 Oct in Los Angeles");
    assert_eq!(paths(&p.sections.created), strs(&[NOVA]), "Nová stránka dne at exactly 00:00:00 local: the start is inclusive");
    assert_eq!(paths(&p.sections.modified), strs(&[UPRAVENA]), "Upravená stránka at 01:00 local");
    let p13 = core.daily_context(&window("2026-10-13", LA), 50);
    assert_eq!(paths(&p13.sections.quick_notes), strs(&[NAPAD]), "Nápad z rána is 22:30 on 13 Oct in Los Angeles");
}

#[test]
fn fr_dly_04_ac3_an_offset_less_created_is_local_wall_clock_time() {
    let sb = sandbox();
    let root = daily_vault(&sb);
    write_raw(&root, "Quick Notes/Bez zóny.md", "---\nid: 01JB4B0000000000000000T040\ntype: quick-note\ntitle: Bez zóny\ncreated: 2026-10-14T23:30:00\n---\nČas bez posunu.\n".as_bytes());
    let core = open(&root, &sb, false);
    for tz in [PRAGUE, LA] {
        let q = paths(&core.daily_context(&window("2026-10-14", tz), 50).sections.quick_notes);
        assert!(q.contains(&"Quick Notes/Bez zóny.md".to_string()), "{tz}: 23:30 local text is on 14 Oct (D-328, D-339): {q:?}");
        let q15 = paths(&core.daily_context(&window("2026-10-15", tz), 50).sections.quick_notes);
        assert!(!q15.contains(&"Quick Notes/Bez zóny.md".to_string()), "{tz}: not on 15 Oct");
    }
}

#[test]
fn fr_dly_04_ac3_a_dst_day_is_25_hours_long() {
    let sb = sandbox();
    let root = daily_vault(&sb);
    // 2026-10-25 in Prague: 00:00+02:00 … 24:00+01:00. 23:30+01:00 (= 22:30Z) is still that day.
    write_raw(&root, "Quick Notes/Pozdě v neděli.md", "---\nid: 01JB4B0000000000000000T041\ntype: quick-note\ntitle: Pozdě v neděli\ncreated: 2026-10-25T23:30:00+01:00\n---\nDelší den.\n".as_bytes());
    let core = open(&root, &sb, false);
    let w = window("2026-10-25", PRAGUE);
    assert_eq!((w.end - w.start).num_hours(), 25, "setup: the window is 25 h");
    assert_eq!(paths(&core.daily_context(&w, 50).sections.quick_notes), strs(&["Quick Notes/Pozdě v neděli.md"]));
}

#[test]
fn fr_dly_04_ac4_sections_are_live_and_never_written() {
    let sb = sandbox();
    let root = daily_vault(&sb);
    let core = open(&root, &sb, false);
    let w = window("2026-10-14", PRAGUE);
    let before = snapshot(&root);
    let _ = core.daily_context(&w, 50);
    assert_eq!(changed(&before, &snapshot(&root)), Vec::<String>::new(), "querying writes nothing");
    ext_write(&core, &root, "Quick Notes/Jedenáctá.md", "---\nid: 01JB4B0000000000000000T042\ntype: quick-note\ntitle: Jedenáctá\ncreated: 2026-10-14T11:00:00+02:00\nmodified: 2026-10-14T11:00:00+02:00\n---\nV jedenáct.\n");
    assert_eq!(paths(&core.daily_context(&w, 50).sections.quick_notes), strs(&["Quick Notes/Jedenáctá.md", NAPAD]), "the new Quick Note, newest first");
    ext_write(&core, &root, NOVA, &swap(&read(&root, NOVA), "modified: 2026-10-14T09:00:00+02:00", "modified: 2026-10-14T11:30:00+02:00"));
    let p = core.daily_context(&w, 50);
    assert_eq!(paths(&p.sections.created), strs(&[NOVA]), "still in Created");
    assert!(!paths(&p.sections.modified).contains(&NOVA.to_string()), "and only there");
    ext_delete(&core, &root, UPRAVENA);
    assert_eq!(paths(&core.daily_context(&w, 50).sections.modified), Vec::<String>::new(), "a deleted object leaves");
}

#[test]
fn fr_dly_04_ac4_the_daily_file_never_contains_section_text() {
    let sb = sandbox();
    let root = daily_vault(&sb);
    let core = open(&root, &sb, false);
    let bytes = first_bytes("2026-10-14", NOW_PRAGUE, "Dnes");
    ok!(core.daily_create(day("2026-10-14"), bytes.as_bytes()), "first write");
    let _ = core.daily_context(&window("2026-10-14", PRAGUE), 50);
    let t = read(&root, NEW14);
    assert_eq!(t, bytes, "the file holds the user's body and frontmatter only");
    for s in ["Nápad z rána", "Nová stránka dne", "Upravená stránka", "Quick Notes", "Tasks due"] {
        assert!(!t.contains(s), "no section text {s:?} in the file");
    }
}

#[test]
fn fr_dly_04_ac6_limit_and_totals() {
    let sb = sandbox();
    let root = daily_vault(&sb);
    for i in 0..60 {
        let t = format!("---\nid: 01JB4B000000000000000M{i:04}\ntype: page\ntitle: Stránka {i}\ncreated: 2026-09-01T10:00:00+02:00\nmodified: 2026-10-14T10:{:02}:00+02:00\n---\nText.\n", i % 60);
        write_raw(&root, &format!("Pages/Hromada {i}.md"), t.as_bytes());
    }
    let core = open(&root, &sb, false);
    let p = core.daily_context(&window("2026-10-14", PRAGUE), 50);
    assert_eq!(p.sections.modified.len(), 50, "at most `limit` rows per section");
    assert_eq!(p.totals[2], 61, "the total says how many there are (60 + Upravená stránka)");
}

// ------------------------------------------------------------------------------------------------ FR-DLY-05

#[test]
fn fr_dly_05_ac1_first_write_is_unreviewed_even_with_a_review_key_in_the_template() {
    let sb = sandbox();
    let root = daily_vault(&sb);
    write_raw(&root, TEMPLATE, swap(&read(&root, TEMPLATE), "tags: [deník]\n", "tags: [deník]\nreview: reviewed\n").as_bytes());
    let core = open(&root, &sb, false);
    let d = ok!(core.daily_draft(day("2026-10-14")), "daily_draft(14)");
    assert!(d.body.contains("\nreview: unreviewed\n"), "the system value wins (D-325)");
    assert!(!d.body.contains("review: reviewed"), "the template's review is ignored");
    assert_eq!(core.daily_view(day("2026-10-14")).review, None, "a virtual note has no review state");
    assert_eq!(core.daily_view(day("2026-10-07")).review.as_deref(), Some("unreviewed"));
    assert_eq!(core.daily_view(day("2026-10-01")).review.as_deref(), Some("reviewed"));
}

#[test]
fn fr_dly_05_ac2_toggle_changes_only_review_and_modified() {
    let sb = sandbox();
    let root = daily_vault(&sb);
    let core = open(&root, &sb, false);
    let (bytes, v) = ok!(core.read_note(D07, SystemTime::now()), "read 7 Oct");
    let orig = String::from_utf8(bytes).unwrap_or_default();
    let on = swap(&swap(&orig, "review: unreviewed", "review: reviewed"), "modified: 2026-10-07T07:10:00+02:00", "modified: 2026-10-14T12:00:00+02:00");
    ok!(core.write_note(D07, on.as_bytes(), Some(&v)), "Mark reviewed (one atomic write)");
    assert_eq!(read(&root, D07), on);
    assert_eq!(orig.lines().zip(on.lines()).filter(|(a, b)| a != b).count(), 2, "two lines change");
    assert_eq!(core.daily_view(day("2026-10-07")).review.as_deref(), Some("reviewed"), "the view reads reviewed");
    // An unknown value counts as unreviewed but is reported as None (D-330).
    ext_write(&core, &root, ARCHIV, &swap(&read(&root, ARCHIV), "review: reviewed", "review: maybe"));
    assert_eq!(core.daily_view(day("2026-10-10")).review, None, "review: maybe → None");
}

// ------------------------------------------------------------------------------------------------ FR-DLY-06

#[test]
fn fr_dly_06_ac1_draft_body_is_relative_to_the_notes_date() {
    let sb = sandbox();
    let root = daily_vault(&sb);
    let core = open(&root, &sb, false);
    for d in ["2026-10-14", "2026-03-01", "2026-12-31"] {
        let dr = ok!(core.daily_draft(day(d)), "daily_draft");
        assert_eq!(dr.body, draft_text(d, "tags: [deník]\n", &template_body(d)), "{d}: frontmatter + expanded template");
    }
}

#[test]
fn fr_dly_06_ac3_template_keys_after_date_and_reserved_keys_ignored() {
    let sb = sandbox();
    let root = daily_vault(&sb);
    write_raw(
        &root,
        TEMPLATE,
        "---\nid: 01JB4B0000000000000000T050\nnálada: dobrá\ntype: page\ntitle: Šablona\ndate: 2000-01-01\nreview: reviewed\ncreated: 2020-01-01T00:00:00+01:00\nmodified: 2020-01-01T00:00:00+01:00\ntags: [deník]\n---\nDnes {{date}}.\n".as_bytes(),
    );
    let core = open(&root, &sb, false);
    let d = ok!(core.daily_draft(day("2026-10-14")), "daily_draft(14)");
    assert_eq!(d.body, draft_text("2026-10-14", "nálada: dobrá\ntags: [deník]\n", "Dnes 2026-10-14.\n"), "template order, reserved keys ignored (D-325)");
    assert_eq!(d.template_keys, vec![("nálada".to_string(), "nálada: dobrá\n".to_string()), ("tags".to_string(), "tags: [deník]\n".to_string())]);
}

#[test]
fn fr_dly_06_ac4_template_applied_once() {
    let sb = sandbox();
    let root = daily_vault(&sb);
    let core = open(&root, &sb, false);
    let bytes = first_bytes("2026-10-14", NOW_PRAGUE, "Dnes");
    ok!(core.daily_create(day("2026-10-14"), bytes.as_bytes()), "first write of 14");
    ext_write(&core, &root, TEMPLATE, &swap(&read(&root, TEMPLATE), "## Poznámky", "## Úkoly"));
    assert_eq!(read(&root, NEW14), bytes, "a written note doesn't change with the template");
    let d15 = ok!(core.daily_draft(day("2026-10-15")), "daily_draft(15)");
    assert!(d15.body.contains("## Úkoly\n") && !d15.body.contains("## Poznámky"), "the next new Daily Note uses the edited template");
}

#[test]
fn fr_dly_06_ac5_no_template_and_an_invalid_template() {
    let sb = sandbox();
    let root = daily_vault(&sb);
    std::fs::remove_file(root.join(TEMPLATE)).expect("setup: no template");
    let core = open(&root, &sb, false);
    let d = ok!(core.daily_draft(day("2026-10-14")), "daily_draft without a template");
    assert_eq!(d.body, draft_text("2026-10-14", "", ""), "the AC-2 frontmatter without tags, empty body");
    assert_eq!(d.template_invalid, None);
    ext_write(&core, &root, TEMPLATE, "---\ntags: [deník\n---\nText {{date}}.\n");
    let d2 = ok!(core.daily_draft(day("2026-10-14")), "daily_draft with an invalid template");
    assert_eq!(d2.template_invalid.as_deref().map(nfc), some(TEMPLATE), "the message names the template");
    assert_eq!(d2.body, draft_text("2026-10-14", "", "Text 2026-10-14.\n"), "body-only (D-325)");
}

#[test]
fn fr_dly_06_ac6_the_template_is_not_a_daily_note_section_row_or_link_target() {
    let sb = sandbox();
    let root = daily_vault(&sb);
    write_raw(&root, TEMPLATE, swap(&read(&root, TEMPLATE), "tags: [deník]\n", "tags: [deník]\ntype: daily-note\ndate: 2026-10-14\ncreated: 2026-10-14T10:00:00+02:00\n").as_bytes());
    let core = open(&root, &sb, false);
    assert_eq!(view_path(&core, "2026-10-14"), None, "not the Daily Note of its date");
    assert!(!dates(&core, 2026, 10).contains(&"2026-10-14".to_string()), "not marked");
    let p = core.daily_context(&window("2026-10-14", PRAGUE), 50);
    assert!(p.sections.created.iter().all(|r| nfc(&r.path) != TEMPLATE), "not in any section");
    let t = core.resolve_links(ZMINKY, &["Daily Note".to_string(), "2026-10-14".to_string()]);
    assert_eq!(t.iter().map(|x| x.kind).collect::<Vec<_>>(), vec![LinkKind::Unresolved, LinkKind::DateMissing], "not a link target");
    // Red guard: the real marks are there.
    assert_eq!(dates(&core, 2026, 10).len(), 5, "the five fixture marks");
}

// ------------------------------------------------------------------------------------------------ FR-DLY-08

#[test]
fn fr_dly_08_ac5_date_links_in_zminky_are_never_broken() {
    let sb = sandbox();
    let root = daily_vault(&sb);
    let core = open(&root, &sb, false);
    let targets = strs(&["2026-10-07", "2026-10-14", "2026-10-20", "2026-10-12", "2026-02-30", "2026-10-09|pátek", "2026-10-16", "2026-10-14#Ráno"]);
    let got: Vec<(LinkKind, Option<String>)> = core.resolve_links(ZMINKY, &targets).into_iter().map(|t| (t.kind, t.path.map(|p| nfc(&p)))).collect();
    assert_eq!(
        got,
        vec![
            (LinkKind::Daily, some(D07)),
            (LinkKind::DateMissing, None),
            (LinkKind::DateMissing, None),
            (LinkKind::Daily, some(D12B)),
            (LinkKind::Unresolved, None),
            (LinkKind::Daily, some(PATEK)),
            (LinkKind::DateMissing, None),
            (LinkKind::DateMissing, None),
        ],
        "kinds and targets: 12 Oct → (2) (D-319); 2026-02-30 isn't a date (D-332); Kolize isn't 16 Oct's target (D-162)"
    );
    let b = core.broken_links();
    let keys: Vec<String> = b.groups.iter().map(|g| g.key.clone()).collect();
    assert!(keys.contains(&"2026-02-30".to_string()), "[[2026-02-30]] is broken and listed: {keys:?}");
    for d in ["2026-10-14", "2026-10-20", "2026-10-16", "2026-10-07", "2026-10-09", "2026-10-12"] {
        assert!(!keys.contains(&d.to_string()), "{d} is never broken");
    }
}

fn excerpt_texts(core: &Core, target: &str) -> Vec<(String, String)> {
    core.backlinks_panel(target)
        .groups
        .iter()
        .flat_map(|g| g.entries.iter())
        .flat_map(|e| {
            e.occurrences.iter().map(move |o| {
                let t: String = o.excerpt.segments.iter().map(|s| match s {
                    RSeg::Text { text, .. } | RSeg::Link { text, .. } => text.as_str(),
                }).collect();
                (nfc(&e.source), nfc(&t))
            })
        })
        .collect()
}

#[test]
fn fr_dly_08_ac7_backlinks_follow_the_winner_rule() {
    let sb = sandbox();
    let root = daily_vault(&sb);
    let core = open(&root, &sb, false);
    assert!(core.backlinks(D12B).iter().any(|p| nfc(p) == ZMINKY), "Zmínky links 12 Oct (2), the winner");
    assert!(!core.backlinks(D12).iter().any(|p| nfc(p) == ZMINKY), "and not the older 12 Oct");
    assert_eq!(excerpt_texts(&core, PATEK), vec![(ZMINKY.to_string(), "Pátek pátek.".to_string())], "9 Oct: the alias in the excerpt");
}

#[test]
fn fr_dly_08_ac7_a_first_write_keeps_the_backlinks_and_nfd_counts() {
    let sb = sandbox();
    let root = daily_vault(&sb);
    // `Zítra [[2026-10-15]]` written in NFD.
    write_raw(&root, "Pages/Zítra.md", "---\nid: 01JB4B0000000000000000T060\ntype: page\ntitle: Zítra\n---\nZi\u{301}tra [[2026-10-15]].\n".as_bytes());
    let core = open(&root, &sb, false);
    ok!(core.daily_create(day("2026-10-20"), first_bytes("2026-10-20", NOW_PRAGUE, "Budoucnost").as_bytes()), "first write of 20");
    assert_eq!(excerpt_texts(&core, "Daily/2026-10-20.md"), vec![(ZMINKY.to_string(), "Budoucnost 2026-10-20.".to_string())], "the panel of 20 Oct after its first write");
    ok!(core.daily_create(day("2026-10-15"), first_bytes("2026-10-15", NOW_PRAGUE, "Zítra").as_bytes()), "first write of 15");
    assert!(core.backlinks("Daily/2026-10-15.md").iter().any(|p| nfc(p) == "Pages/Zítra.md"), "NFD text links the same");
}

// ------------------------------------------------------------------------------------------------ FR-FMT-09

#[test]
fn fr_fmt_09_ac3_default_name_in_a_czech_named_vault_folder_nfc_and_nfd() {
    for (label, name) in [("NFC", "Deník Šárky".to_string()), ("NFD", "Deník Šárky".chars().flat_map(|c| match c {
        'í' => vec!['i', '\u{301}'],
        'Š' => vec!['S', '\u{30C}'],
        'á' => vec!['a', '\u{301}'],
        c => vec![c],
    }).collect::<String>())] {
        let sb = sandbox();
        let root = sb.base.join(&name);
        copy_dir(&repo_root().join("tests/fixtures/vaults/new-empty/.tegg"), &root.join(".tegg"), &[]);
        let core = open(&root, &sb, false);
        assert!(!root.join("Daily").exists(), "setup: no Daily/ yet");
        let made = ok!(core.daily_create(day("2026-10-14"), plain_bytes("2026-10-14", NOW_PRAGUE, "Dnes\n").as_bytes()), "first write");
        assert_eq!(nfc(&made.path), NEW14, "{label}: Daily/2026-10-14.md");
        let names: Vec<String> = std::fs::read_dir(root.join("Daily")).map(|r| r.filter_map(|e| e.ok()).map(|e| e.file_name().to_string_lossy().to_string()).collect()).unwrap_or_default();
        assert_eq!(names, strs(&["2026-10-14.md"]), "{label}: the folder is created and holds the NFC name");
    }
}

#[test]
fn fr_fmt_09_ac4_another_format_names_the_file_and_resolves_by_date() {
    let sb = sandbox();
    let root = daily_vault(&sb);
    write_raw(&root, ".tegg/vault.yml", swap(&read(&root, ".tegg/vault.yml"), "daily-format: YYYY-MM-DD", "daily-format: DD.MM.YYYY").as_bytes());
    let core = open(&root, &sb, false);
    let before = snapshot(&root);
    let d = ok!(core.daily_draft(day("2026-10-14")), "daily_draft");
    assert_eq!(nfc(&d.path), "Daily/14.10.2026.md");
    assert!(!d.format_fallback);
    let made = ok!(core.daily_create(day("2026-10-14"), first_bytes("2026-10-14", NOW_PRAGUE, "Dnes").as_bytes()), "first write");
    assert_eq!(nfc(&made.path), "Daily/14.10.2026.md");
    let t = read(&root, "Daily/14.10.2026.md");
    assert!(t.contains("\ntitle: \"2026-10-14\"\n") && t.contains("\ndate: 2026-10-14\n"), "title and date stay ISO (D-320)");
    assert_eq!(changed(&before, &snapshot(&root)), strs(&["Daily/14.10.2026.md"]), "existing notes are not renamed");
    let r = core.resolve_links(ZMINKY, &strs(&["2026-10-14"]));
    assert_eq!(r.first().map(|x| (x.kind, x.path.as_deref().map(nfc))), Some((LinkKind::Daily, some("Daily/14.10.2026.md"))), "[[2026-10-14]] resolves to it (D-333)");
    assert_eq!(view_path(&core, "2026-10-07"), some(D07), "old names still found by date");
}

#[test]
fn fr_fmt_09_ac5_invalid_formats_fall_back_to_iso() {
    for f in ["YYYY/MM/DD", "YYYY:MM:DD", "YYYY-MM", "\"\""] {
        let sb = sandbox();
        let root = daily_vault(&sb);
        write_raw(&root, ".tegg/vault.yml", swap(&read(&root, ".tegg/vault.yml"), "daily-format: YYYY-MM-DD", &format!("daily-format: {f}")).as_bytes());
        let core = open(&root, &sb, false);
        let d = ok!(core.daily_draft(day("2026-10-14")), "daily_draft");
        assert_eq!(nfc(&d.path), NEW14, "{f}: falls back to YYYY-MM-DD (D-336)");
        assert!(d.format_fallback, "{f}: format_fallback set for the message");
        let made = ok!(core.daily_create(day("2026-10-14"), first_bytes("2026-10-14", NOW_PRAGUE, "Dnes").as_bytes()), "first write");
        assert_eq!(nfc(&made.path), NEW14, "{f}: no subfolders from the format");
    }
}
