//! S5-QA AC-1…AC-3: the dry-run report for each synthetic fixture in `tests/fixtures/import/capacities/`
//! (one per BRD §15.1 finding) is asserted, and every report passes the "imported + reported = total" rule.

use s5_capacities_import::accounting::{assert_accounted, check, totals};
use s5_capacities_import::convert::{parse_date, sanitize_file_name, DateValue};
use s5_capacities_import::plan::{self, AttrAction, LinkOutcome, Options, Report};
use s5_capacities_import::report;
use s5_capacities_import::source::{self, Source};
use std::io::Write;
use std::path::{Path, PathBuf};

fn fixtures() -> PathBuf { Path::new(env!("CARGO_MANIFEST_DIR")).join("../../tests/fixtures/import/capacities") }

fn load(name: &str) -> (Source, Report) {
    let src = source::read(&fixtures().join(name)).unwrap();
    let r = plan::dry_run(&src, "PKM", &Options::default());
    assert_accounted(&src, &r);
    (src, r)
}

fn attr<'a>(r: &'a Report, t: &str, k: &str) -> &'a plan::AttrRow {
    r.attributes.iter().find(|a| a.source_type == t && a.key == k).unwrap_or_else(|| panic!("no attribute {t}.{k}"))
}

fn outcomes(r: &Report) -> Vec<(&str, &LinkOutcome)> { r.link_rows.iter().map(|l| (l.target.as_str(), &l.outcome)).collect() }

fn planned<'a>(r: &'a Report, source: &str) -> &'a plan::Planned {
    r.planned.iter().find(|p| p.source == source).unwrap_or_else(|| panic!("not planned: {source}"))
}

#[test]
fn s5_qa_ac1_every_finding_has_a_fixture_and_readme_row() {
    let readme = std::fs::read_to_string(fixtures().join("README.md")).unwrap();
    for n in 1..=19 {
        let prefix = format!("c{n:02}-");
        let dir = std::fs::read_dir(fixtures()).unwrap().filter_map(|e| e.ok())
            .find(|e| e.file_name().to_string_lossy().starts_with(&prefix))
            .unwrap_or_else(|| panic!("no fixture for C{n}"));
        let name = dir.file_name().to_string_lossy().into_owned();
        assert!(readme.contains(&format!("`{name}/`")), "README has no row for {name}");
    }
}

#[test]
fn s5_qa_ac3_all_fixtures_imported_plus_reported_equals_total() {
    for e in std::fs::read_dir(fixtures()).unwrap().filter_map(|e| e.ok()).filter(|e| e.path().is_dir()) {
        let src = source::read(&e.path()).unwrap();
        for s in plan::spaces(&src) {
            let r = plan::dry_run(&src, &s.name, &Options::default());
            assert_eq!(check(&src, &r), Vec::<String>::new(), "{:?} space {}", e.file_name(), s.name);
        }
    }
}

#[test]
fn s5_qa_ac3_accounting_detects_a_lost_link() {
    let (src, mut r) = load("c09-unresolved-links");
    r.link_rows.pop();
    r.links.reported -= 1;
    r.links.total -= 1;
    let errs = check(&src, &r);
    assert!(errs.iter().any(|e| e.starts_with("links: total = export")), "{errs:?}");
    let v = s5_capacities_import::accounting::violation_counts("space.0", &errs);
    assert!(report::is_counts_only(&v), "{v}");
    assert!(v.contains("space.0.violation.links_total_export.left:"), "{v}");
    let t = totals(&src, "PKM");
    assert_eq!(t.links, r.links.total + 1);
}

#[test]
fn fr_imp_22_ac1_c01_spaces_are_listed_with_counts() {
    let src = source::read(&fixtures().join("c01-spaces")).unwrap();
    let s: Vec<(String, usize)> = plan::spaces(&src).into_iter().map(|s| (s.name, s.objects)).collect();
    assert_eq!(s, vec![("IDC".into(), 2), ("PKM".into(), 3), ("Work".into(), 3)]);
}

#[test]
fn fr_imp_22_ac2_c01_only_selected_space_links_to_others_reported() {
    let (_, r) = load("c01-spaces");
    assert_eq!(r.objects.total, 3, "only PKM files");
    assert!(r.planned.iter().all(|p| p.import_id.starts_with("capacities:PKM/")));
    let o = outcomes(&r);
    assert!(o.contains(&("PKM task", &LinkOutcome::Resolved)));
    assert!(o.contains(&("Quarterly plan", &LinkOutcome::OtherSpace("Work".into()))));
    assert!(o.contains(&("../../Work/Pages/Work home.md", &LinkOutcome::Unresolved)), "{o:?}");
}

#[test]
fn fr_imp_22_c01_flat_and_wrapped_layouts_detect_the_same_space() {
    let tmp = tempfile::tempdir().unwrap();
    let pkm = fixtures().join("c01-spaces/PKM");
    for (dir, expect) in [(tmp.path().join("flat"), plan::FLAT_SPACE), (tmp.path().join("wrapped/Export/PKM"), "PKM")] {
        copy_dir(&pkm, &dir);
        let root = if expect == "PKM" { tmp.path().join("wrapped") } else { dir.clone() };
        let src = source::read(&root).unwrap();
        let s = plan::spaces(&src);
        assert_eq!(s.len(), 1, "{s:?}");
        assert_eq!(s[0].name, expect);
        assert_eq!(s[0].objects, 3);
    }
}

#[test]
fn fr_imp_08_ac3_c02_typed_attributes_and_select_merges() {
    let (_, r) = load("c02-typed-frontmatter");
    assert_eq!(r.objects.imported, 5);
    assert_eq!(r.skipped_objects.len(), 1);
    assert_eq!(r.skipped_objects[0].path, "Pages/Broken frontmatter.md");
    assert_eq!(attr(&r, "Book", "pages").inferred, "number");
    assert_eq!(attr(&r, "Book", "finished").inferred, "checkbox");
    assert_eq!(attr(&r, "Book", "medium").inferred, "select");
    let m = r.value_merges.iter().find(|m| m.key == "language").unwrap();
    assert_eq!((m.variants.clone(), m.canonical.as_str()), (vec!["ENG".to_string(), "eng".into()], "ENG"));
    assert!(!r.link_rows.iter().any(|l| l.target.contains("not a link")), "links in code are ignored");
    assert!(r.link_rows.iter().any(|l| l.outcome == LinkOutcome::InSkippedNote && l.target == "Idea"));
    let t: Vec<_> = r.types.iter().map(|t| (t.source.as_str(), t.target.as_str(), t.folder.as_str())).collect();
    assert!(t.contains(&("Book", "Book", "Books")), "new user type named after the source");
}

#[test]
fn fr_imp_09_ac1_c03_utc_midnight_becomes_date_only() {
    let (_, r) = load("c03-utc-midnight-dates");
    assert_eq!(attr(&r, "Meeting", "date").inferred, "date");
    assert_eq!(r.dates.date_only, 2);
    assert_eq!(r.dates.date_times, 1);
}

#[test]
fn fr_imp_09_ac4_c03_null_is_omitted_not_a_value() {
    let (_, r) = load("c03-utc-midnight-dates");
    let a = attr(&r, "Meeting", "followUp");
    assert_eq!((a.values, a.nulls), (1, 1));
    assert_eq!(attr(&r, "Meeting", "date").nulls, 0);
}

#[test]
fn fr_imp_09_ac1_date_only_in_three_time_zones() {
    for tz in [chrono_tz::America::Los_Angeles, chrono_tz::Europe::Prague, chrono_tz::Asia::Tokyo] {
        assert_eq!(parse_date("2026-03-19T00:00:00.000Z", tz), Some(DateValue::DateOnly("2026-03-19".into())));
    }
}

#[test]
fn fr_imp_09_ac2_utc_date_time_gets_local_offset() {
    assert_eq!(parse_date("2026-04-07T19:46:20.601Z", chrono_tz::Europe::Prague), Some(DateValue::DateTime("2026-04-07T21:46:20+02:00".into())));
    assert_eq!(parse_date("2026-01-07T19:46:20Z", chrono_tz::Europe::Prague), Some(DateValue::DateTime("2026-01-07T20:46:20+01:00".into())));
}

#[test]
fn fr_imp_09_ac3_c04_ranges() {
    let (_, r) = load("c04-date-ranges");
    assert_eq!(attr(&r, "Trip", "dates").inferred, "date-range");
    assert_eq!(attr(&r, "Project", "timeFrame").inferred, "date-range");
    assert_eq!(r.dates.ranges, 2);
    assert_eq!(parse_date("2026-03-01T00:00:00.000Z -> 2026-05-31T00:00:00.000Z", chrono_tz::Europe::Prague),
               Some(DateValue::Range("2026-03-01".into(), "2026-05-31".into())));
}

#[test]
fn fr_imp_14_c05_media_objects() {
    let (_, r) = load("c05-media-objects");
    assert_eq!(r.attachments, plan::Tally { total: 4, imported: 4, reported: 0 });
    assert_eq!(planned(&r, "Images/Mapa řeky.md").target, "Images/Mapa řeky.md");
    let o = outcomes(&r);
    assert!(o.contains(&("./Media/Mapa řeky.jpeg", &LinkOutcome::Attachment)), "AC-2 decoded %C5%99");
    assert!(o.contains(&("../Images/Media/Mapa řeky.jpeg", &LinkOutcome::Attachment)));
    // AC-3: generic name renamed after the owning Image object
    assert_eq!(r.renamed_media, vec![("Images/Media/image (3).png".to_string(), "_attachments/Whiteboard sketch 1.png".to_string())]);
    // AC-4: the missing PDF preview is dropped and reported
    assert!(o.contains(&("./Media/Manual preview.png", &LinkOutcome::MissingFile)));
    assert!(r.dropped_files.iter().any(|f| f.path == "./Media/Manual preview.png"));
    assert_eq!(r.orphan_attachments, vec!["Images/Media/Untitled (44).png".to_string()]);
    for k in ["mimeType", "fileSize", "width", "height", "colors"] { assert_eq!(attr(&r, "Image", k).action, AttrAction::Drop) }
}

#[test]
fn fr_imp_24_ac1_c06_weblinks_become_pages() {
    let (_, r) = load("c06-weblinks");
    assert_eq!(planned(&r, "Weblinks/Rust book.md").target, "Pages/Rust book.md");
    assert_eq!(attr(&r, "Weblink", "url").action, AttrAction::Keep);
    assert_eq!(attr(&r, "Weblink", "domain").action, AttrAction::Drop);
    assert_eq!(attr(&r, "Weblink", "previewImage").action, AttrAction::Rename("cover".into()));
    assert_eq!(r.links, plan::Tally { total: 2, imported: 2, reported: 0 });
}

#[test]
fn fr_imp_16_c07_query_stubs_and_loss() {
    let (_, r) = load("c07-query-shells");
    assert_eq!(r.query_stubs, vec!["All Books where ...".to_string(), "Open tasks".into()]);
    assert!(r.planned.iter().all(|p| p.target.starts_with("Pages/")));
    assert!(r.losses.iter().any(|l| l.starts_with("Query definitions: 2")));
}

#[test]
fn fr_imp_21_ac2_c08_tag_collections_reported() {
    let (_, r) = load("c08-tag-collections");
    assert_eq!(r.tag_collections.len(), 2);
    assert_eq!(r.other_files, plan::Tally { total: 2, imported: 0, reported: 2 });
    assert!(r.losses.iter().any(|l| l.starts_with("Tag colors")));
    assert_eq!(attr(&r, "Page", "tags").inferred, "list");
}

#[test]
fn fr_imp_10_c09_unresolved_links() {
    let (_, r) = load("c09-unresolved-links");
    let o = outcomes(&r);
    assert!(o.contains(&("Date/2026-02-03", &LinkOutcome::DateMention)), "AC-3");
    assert!(o.contains(&("NOTE/3f2c9a1e-0000-4000-8000-000000000001", &LinkOutcome::Unresolved)), "AC-4");
    assert!(o.contains(&("Never exported", &LinkOutcome::Unresolved)));
    assert!(o.contains(&("Lisbon", &LinkOutcome::Resolved)));
    assert!(o.contains(&("in progress", &LinkOutcome::SelectValue)), "FR-IMP-21 AC-3");
    assert!(o.contains(&("../Pages/Gone.md", &LinkOutcome::Unresolved)));
    assert_eq!(attr(&r, "Trip", "status").inferred, "link-select");
    assert_eq!(r.links, plan::Tally { total: 7, imported: 2, reported: 5 });
}

#[test]
fn fr_lnk_14_c10_duplicate_titles() {
    let (_, r) = load("c10-duplicate-titles");
    let d: Vec<_> = r.duplicate_titles.iter().map(|d| (d.title.as_str(), d.targets.clone())).collect();
    assert!(d.contains(&("Tomáš : Eva", vec!["Meetings/Tomáš Eva.md".into(), "Meetings/Tomáš Eva (2).md".into()])), "{d:?}");
    assert!(d.contains(&("Article", vec!["Pages/Article.md".into(), "Pages/Article (2).md".into(), "Pages/Article (3).md".into()])));
    let o = outcomes(&r);
    assert!(o.contains(&("../Meetings/Tomáš  Eva (1).md", &LinkOutcome::Resolved)), "path link with unencoded parentheses");
    assert!(o.contains(&("Tomáš : Eva", &LinkOutcome::Ambiguous)));
}

#[test]
fn fr_imp_11_c11_titles_and_file_names() {
    let (_, r) = load("c11-file-names");
    let p = planned(&r, "Meetings/11 2026-03-19 Jana.md");
    assert_eq!((p.title.as_str(), p.target.as_str()), ("1:1 2026-03-19 Jana", "Meetings/1 1 2026-03-19 Jana.md"));
    assert_eq!(planned(&r, "People/Jana.md").title, "Jana", "AC-2 trailing space trimmed");
    assert_eq!(planned(&r, "Pages/Heading  and brackets.md").target, "Pages/Heading 1 and brackets.md", "D-68");
    let long = &planned(&r, "Pages/Long title.md").target;
    assert!(long.trim_start_matches("Pages/").trim_end_matches(".md").len() <= 200, "D-51");
    assert_eq!(attr(&r, "Meeting", "peopleInvolved").inferred, "relation", "FR-IMP-10 AC-5");
    assert!(outcomes(&r).contains(&("1:1 2026-03-19 Jana", &LinkOutcome::Resolved)));
}

#[test]
fn fr_imp_15_ac3_c12_task_dates_and_statuses() {
    let (_, r) = load("c12-task-dates");
    assert_eq!(attr(&r, "Task", "deadline").action, AttrAction::Rename("due".into()));
    assert_eq!(attr(&r, "Task", "date").action, AttrAction::Rename("due".into()));
    assert_eq!(attr(&r, "Task", "completed").inferred, "date-time");
    let s: Vec<_> = r.task_statuses.iter().map(|s| (s.value.as_str(), s.state.as_str())).collect();
    assert_eq!(s, vec![("", "open"), ("Done", "done"), ("In Progress", "in progress"), ("Not Started", "open")], "FR-IMP-08 AC-4");
}

#[test]
fn fr_imp_15_ac2_c13_daily_notes() {
    let (_, r) = load("c13-daily-notes");
    assert_eq!(attr(&r, "DailyNote", "reviewed").action, AttrAction::Rename("review".into()));
    assert_eq!(attr(&r, "DailyNote", "date").action, AttrAction::Consumed);
    assert_eq!(r.daily_timestamps, 3);
    assert_eq!(planned(&r, "DailyNotes/2026-02-02.md").target, "Daily/2026-02-02.md");
}

#[test]
fn fr_typ_15_ac1_c14_reserved_keys_renamed() {
    let (_, r) = load("c14-reserved-keys");
    assert_eq!(attr(&r, "Idea", "source").action, AttrAction::Rename("source-text".into()));
    assert_eq!(attr(&r, "Idea", "file").action, AttrAction::Rename("file-text".into()));
}

#[test]
fn fr_imp_15_c15_common_attributes() {
    let (_, r) = load("c15-common-attributes");
    assert_eq!(attr(&r, "Page", "createdAt").action, AttrAction::Rename("created".into()));
    assert_eq!(attr(&r, "Page", "lastUpdated").action, AttrAction::Rename("modified".into()));
    assert_eq!(attr(&r, "Page", "coverImage").action, AttrAction::Rename("cover".into()));
    for k in ["description", "aliases", "icon"] { assert_eq!(attr(&r, "Page", k).action, AttrAction::Keep) }
    assert_eq!(planned(&r, "Pages/Garden plan.md").import_id, "capacities:PKM/Pages/Garden plan.md", "FR-IMP-15 AC-5");
}

#[test]
fn fr_imp_08_ac5_c16_comma_people_split_candidate() {
    let (_, r) = load("c16-comma-people");
    assert_eq!(r.split_candidates, vec![("Project".to_string(), "people".to_string(), 2)]);
}

#[test]
fn fr_imp_17_ac1_c17_invisible_chars_counted_emoji_kept() {
    let (_, r) = load("c17-invisible-chars");
    assert_eq!(r.invisible_chars, 4, "BOM + ZWSP in title + 2 in body; ZWJ in 👩‍💻 kept");
    assert_eq!(r.planned[0].title, "Plan");
}

#[test]
fn fr_imp_18_c18_checklists_counted() {
    let (_, r) = load("c18-checklists");
    assert_eq!(r.checklist_items, 4);
}

#[test]
fn fr_imp_08_ac1_c19_ai_chat_imported_as_page() {
    let (_, r) = load("c19-ai-chat");
    assert_eq!((r.types[0].source.as_str(), r.types[0].target.as_str()), ("AIChat", "Page"));
}

#[test]
fn fr_imp_20_ac1_repeat_import_warning() {
    let src = source::read(&fixtures().join("c12-task-dates")).unwrap();
    let mut opts = Options::default();
    opts.existing_import_ids.insert("capacities:PKM/Tasks/Write report.md".into());
    let r = plan::dry_run(&src, "PKM", &opts);
    assert_eq!(r.already_imported, 1);
    assert!(report::markdown(&r).contains("1 objects were already imported"));
}

#[test]
fn fr_imp_05_ac1_preview_lists_everything() {
    let (_, r) = load("c09-unresolved-links");
    let md = report::markdown(&r);
    for s in ["## Types", "## Attributes", "## Links that need attention", "NOTE/3f2c9a1e", "Date mentions → Daily Note links: 1"] {
        assert!(md.contains(s), "missing {s}");
    }
}

#[test]
fn ts_p2_counts_only_output_has_no_names() {
    for e in std::fs::read_dir(fixtures()).unwrap().filter_map(|e| e.ok()).filter(|e| e.path().is_dir()) {
        let src = source::read(&e.path()).unwrap();
        for (i, s) in plan::spaces(&src).iter().enumerate() {
            let out = report::counts_only(i, &plan::dry_run(&src, &s.name, &Options::default()));
            assert!(report::is_counts_only(&out), "{out}");
        }
    }
    assert!(!report::is_counts_only("space.0.type.Book: 3"));
    assert!(!report::is_counts_only("Mapa řeky: 1"));
}

#[test]
fn fr_fmt_08_ac_d52_d68_sanitize_forbidden_characters() {
    assert_eq!(sanitize_file_name("1:1 2026-03-19 Jana"), "1 1 2026-03-19 Jana");
    assert_eq!(sanitize_file_name(" ..a/b?  c.. "), "a b c");
    assert_eq!(sanitize_file_name("Heading #1 ^x [a]"), "Heading 1 x a", "D-68");
    assert_eq!(sanitize_file_name("???"), "Untitled", "AP-27");
}

#[test]
fn fr_fmt_08_ac_d51_cut_at_200_bytes_on_a_character_boundary() {
    let title = format!("a{}", "ž".repeat(150)); // 1 + 300 bytes; byte 200 falls inside a `ž`
    let name = sanitize_file_name(&title);
    assert!(name.len() <= 200);
    assert_eq!(name.len(), 199);
    assert!(name.chars().skip(1).all(|c| c == 'ž'));
}

#[test]
fn fr_fmt_12_sanitize_outputs_nfc() {
    use unicode_normalization::UnicodeNormalization;
    let nfd: String = "Tomáš".nfd().collect();
    assert_ne!(nfd, "Tomáš");
    assert_eq!(sanitize_file_name(&nfd), "Tomáš");
}

#[test]
fn ap_27_windows_reserved_names_are_listed() {
    use s5_capacities_import::convert::is_windows_reserved;
    for n in ["CON", "con", "Nul", "COM1", "lpt9", "AUX.txt"] { assert!(is_windows_reserved(n), "{n}") }
    for n in ["Console", "COM0", "COM", "Concert"] { assert!(!is_windows_reserved(n), "{n}") }
    let tmp = tempfile::tempdir().unwrap();
    std::fs::create_dir_all(tmp.path().join("PKM/Pages")).unwrap();
    std::fs::write(tmp.path().join("PKM/Pages/CON.md"), "---\ntype: 'Page'\ntitle: CON\n---\n").unwrap();
    std::fs::write(tmp.path().join("PKM/Pages/Q.md"), "---\ntype: 'Page'\ntitle: '???'\n---\n").unwrap();
    let src = source::read(tmp.path()).unwrap();
    let r = plan::dry_run(&src, "PKM", &Options::default());
    assert_eq!(r.name_issues.len(), 2, "{:?}", r.name_issues);
    assert_accounted(&src, &r);
}

#[test]
fn fr_fmt_12_nfd_link_targets_resolve() {
    use unicode_normalization::UnicodeNormalization;
    let tmp = tempfile::tempdir().unwrap();
    copy_dir(&fixtures().join("c10-duplicate-titles"), tmp.path());
    let nfd: String = "Tomáš".nfd().collect();
    std::fs::create_dir_all(tmp.path().join("PKM/Pages")).unwrap();
    std::fs::write(tmp.path().join("PKM/Pages/NFD.md"), format!("---\ntype: 'Page'\ntitle: N\n---\n[[{nfd}]]\n")).unwrap();
    let src = source::read(tmp.path()).unwrap();
    let r = plan::dry_run(&src, "PKM", &Options::default());
    assert!(outcomes(&r).contains(&("Tomáš", &LinkOutcome::Resolved)), "{:?}", outcomes(&r));
    assert_accounted(&src, &r);
}

#[test]
fn fr_lnk_14_case_mismatch_is_reported_not_resolved() {
    let tmp = tempfile::tempdir().unwrap();
    copy_dir(&fixtures().join("c06-weblinks"), tmp.path());
    std::fs::write(tmp.path().join("PKM/Pages/Case.md"), "---\ntype: 'Page'\ntitle: Case\n---\n[[reading LIST]]\n").unwrap();
    let src = source::read(tmp.path()).unwrap();
    let r = plan::dry_run(&src, "PKM", &Options::default());
    assert!(outcomes(&r).contains(&("reading LIST", &LinkOutcome::CaseMismatch)));
    assert_accounted(&src, &r);
}

#[test]
fn fr_imp_09_ac3_mixed_range_is_not_parsed() {
    assert_eq!(parse_date("2026-03-01 -> 2026-03-05T10:00:00.000Z", chrono_tz::Europe::Prague), None);
}

#[test]
fn fr_imp_09_ac1_offset_midnight_stays_date_time() {
    assert_eq!(parse_date("2026-03-19T00:00:00+00:00", chrono_tz::Europe::Prague), Some(DateValue::DateTime("2026-03-19T01:00:00+01:00".into())));
}

// ---------- FR-IMP-07 input ----------

fn copy_dir(from: &Path, to: &Path) {
    std::fs::create_dir_all(to).unwrap();
    for e in std::fs::read_dir(from).unwrap() {
        let e = e.unwrap();
        let t = to.join(e.file_name());
        if e.path().is_dir() { copy_dir(&e.path(), &t) } else { std::fs::copy(e.path(), t).unwrap(); }
    }
}

fn zip_dir(dir: &Path, out: &Path, rename: impl Fn(&str) -> String) {
    let src = source::read_dir(dir).unwrap();
    let mut z = zip::ZipWriter::new(std::fs::File::create(out).unwrap());
    for e in &src.entries {
        z.start_file(rename(&e.path), zip::write::SimpleFileOptions::default()).unwrap();
        z.write_all(&e.bytes).unwrap();
    }
    z.finish().unwrap();
}

#[test]
fn fr_imp_07_ac1_zip_and_folder_give_the_same_report() {
    let tmp = tempfile::tempdir().unwrap();
    for fixture in ["c05-media-objects", "c10-duplicate-titles", "c01-spaces"] {
        let zip = tmp.path().join(format!("{fixture}.zip"));
        zip_dir(&fixtures().join(fixture), &zip, |p| p.to_string());
        let a = plan::dry_run(&source::read(&fixtures().join(fixture)).unwrap(), "PKM", &Options::default());
        let zsrc = source::read(&zip).unwrap();
        assert_eq!(zsrc.stats.unreadable, 0);
        let b = plan::dry_run(&zsrc, "PKM", &Options::default());
        let strip = |r: &Report| { let mut j = serde_json::to_value(r).unwrap(); j.as_object_mut().unwrap().remove("read"); j };
        assert_eq!(strip(&a), strip(&b), "{fixture}");
        assert_accounted(&zsrc, &b);
    }
}

#[test]
fn fr_imp_07_ac2_non_ascii_and_nfd_names_in_zip() {
    use unicode_normalization::UnicodeNormalization;
    let tmp = tempfile::tempdir().unwrap();
    let zip = tmp.path().join("nfd.zip");
    // Names written decomposed (NFD), as macOS tools sometimes do, plus emoji, `?` and a long name.
    zip_dir(&fixtures().join("c05-media-objects"), &zip, |p| p.nfd().collect());
    let src = source::read(&zip).unwrap();
    assert_eq!(src.stats.unreadable, 0);
    assert!(src.stats.non_nfc_names > 0);
    assert!(src.entries.iter().any(|e| e.path == "PKM/Images/Media/Mapa řeky.jpeg"), "NFC after reading");
    let r = plan::dry_run(&src, "PKM", &Options::default());
    assert!(outcomes(&r).contains(&("./Media/Mapa řeky.jpeg", &LinkOutcome::Attachment)));
    assert_accounted(&src, &r);

    let odd = tmp.path().join("odd.zip");
    let long = format!("PKM/Pages/{}.md", "ž".repeat(120));
    let mut z = zip::ZipWriter::new(std::fs::File::create(&odd).unwrap());
    for name in ["PKM/Pages/Co dál? 🚀.md", long.as_str()] {
        z.start_file(name, zip::write::SimpleFileOptions::default()).unwrap();
        z.write_all(b"---\ntype: 'Page'\ntitle: X\n---\n").unwrap();
    }
    z.finish().unwrap();
    let src = source::read(&odd).unwrap();
    assert_eq!(src.stats.unreadable, 0);
    assert!(src.entries.iter().any(|e| e.path == "PKM/Pages/Co dál? 🚀.md"));
    assert!(src.entries.iter().any(|e| e.path == long));
}

#[test]
fn s5_qa_ac3_accounting_detects_a_planner_that_loses_items() {
    // A planner that silently drops an object, an attachment or a dropped-file row must fail the check.
    let (src, r) = load("c05-media-objects");
    let mut lost_object = r.clone();
    lost_object.planned.pop();
    lost_object.objects.imported -= 1;
    lost_object.objects.total -= 1;
    assert!(check(&src, &lost_object).iter().any(|e| e.starts_with("objects: total = export")));
    let mut lost_attachment = r.clone();
    lost_attachment.attachments.imported -= 1;
    lost_attachment.attachments.total -= 1;
    assert!(check(&src, &lost_attachment).iter().any(|e| e.starts_with("attachments: total = export")));
    let (src8, mut r8) = load("c08-tag-collections");
    r8.dropped_files.pop();
    assert!(check(&src8, &r8).iter().any(|e| e.starts_with("other files reported")));
}

#[test]
fn s5_qa_ac3_accounting_detects_a_space_split_that_drops_files() {
    // The planner reports only PKM's files; checking them against another space's raw files must fail.
    let src = source::read(&fixtures().join("c01-spaces")).unwrap();
    let mut r = plan::dry_run(&src, "PKM", &Options::default());
    r.space = "Work".into();
    assert!(!check(&src, &r).is_empty());
}

#[test]
fn s5_qa_ac3_independent_link_count_matches_the_scanner_on_tricky_text() {
    use s5_capacities_import::{accounting::count_links, scan};
    let text = "---\nrel: '[[A]]'\n---\n[[B|b]] ![[c.png]] [x](../T/Plan%20(1).md) ![i](./Media/i.png)\n\
                `[[code]]` [web](https://e.com) [anchor](#h)\n```\n[[fenced]]\n```\n[[D#h]]\n";
    assert_eq!(count_links(text), 6);
    assert_eq!(scan::links(text).len(), 6);
}

#[test]
fn s5_qa_ac3_hidden_files_are_reported_not_imported() {
    let tmp = tempfile::tempdir().unwrap();
    copy_dir(&fixtures().join("c18-checklists"), tmp.path());
    std::fs::write(tmp.path().join("PKM/Pages/.DS_Store"), b"x").unwrap();
    std::fs::write(tmp.path().join("PKM/Pages/.hidden.md"), b"---\ntype: 'Page'\ntitle: H\n---\n").unwrap();
    let src = source::read(tmp.path()).unwrap();
    let r = plan::dry_run(&src, "PKM", &Options::default());
    assert_eq!((r.objects.total, r.other_files.reported), (1, 2));
    assert_accounted(&src, &r);
}

#[test]
fn bug_s5_real_export_fr_imp_10_links_the_line_scanner_missed() {
    // Real-export run (counts only): the line scanner found 12 fewer links than the independent counter in
    // 12 notes. Synthetic reproductions of the suspected forms; each link must be found and accounted for.
    use s5_capacities_import::{accounting::count_links, scan};
    let tmp = tempfile::tempdir().unwrap();
    copy_dir(&fixtures().join("c05-media-objects"), tmp.path());
    let body = "---\ntype: 'Page'\ntitle: Forms\n---\n\
        [![Map](../Images/Media/Mapa%20%C5%99eky.jpeg)](../Images/Mapa%20%C5%99eky.md)\n\n\
        [Trip\nnotes](Trip%20notes.md)\n\n\
        [see [1] here](Trip%20notes.md)\n";
    std::fs::write(tmp.path().join("PKM/Pages/Forms.md"), body).unwrap();
    let found = scan::links(body);
    assert_eq!(found.len(), 4, "{found:?}");
    assert_eq!(count_links(body), 4);
    let src = source::read(tmp.path()).unwrap();
    let r = plan::dry_run(&src, "PKM", &Options::default());
    let forms = |o: LinkOutcome| r.link_rows.iter().filter(|l| l.note == "Pages/Forms.md" && l.outcome == o).count();
    assert_eq!((forms(LinkOutcome::Attachment), forms(LinkOutcome::Resolved)), (1, 3));
    assert_accounted(&src, &r);
}
