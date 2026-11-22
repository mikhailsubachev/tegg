//! Slice Q2-T L2 (docs/acceptance/views.md FR-QRY-01 AC-18 the oracle part, FR-FMT-07 AC-35 the property part;
//! docs/contracts/v1-views.md §24.2…§24.4): (1) random period groupings over a Date attribute, a Date-time attribute and
//! `created`, with random clocks, zones, regions (week starts) and invalid values: `QueryResult.group` equals the
//! brute-force lanes and day groups of R203 (computed here with chrono, independently of the product); (2) random query
//! files with the Q2-T keys (`group_by` mappings with trailing comments, `done_lane` in flow and block style, state
//! filters, `lane_order`, LF / CRLF / no final newline) and one random change through `Core::query_apply`: every line
//! outside the changed key's line(s) and `modified:` is byte-identical, a removed `done_lane` takes its continuation
//! lines with it, an inserted one lands at R201's place, the file reads back as intended, a no-op writes nothing. Seeds as
//! TS-L2: a fixed seed plus `QA_SEED` when set, printed; `QA_PROPERTY_SCALE` ≥ 100 runs 10×. Compiles against the
//! contract's Q2-T interface (stubs first, as D-1813). Written from the ACs and the contract only (D-61).

mod common;
mod views_setup;
mod views_tasks_setup;

use chrono::{DateTime, Datelike, Duration as Days, NaiveDate, Weekday};
use serde_json::{json, Value};

use common::sandbox;
use tegg_core::queries_q::{DoneLane, Lanes, QueryEnv, QueryResult, QuerySource};
use views_setup::{copy_dir, disk_s, open, reread, write};
use views_tasks_setup::*;

const FIXED_SEED: u64 = 20261120;
struct Rng(u64);
impl Rng {
    fn next(&mut self) -> u64 {
        let mut x = self.0.max(1);
        x ^= x << 13;
        x ^= x >> 7;
        x ^= x << 17;
        self.0 = x;
        x
    }
    fn int(&mut self, n: usize) -> usize {
        (self.next() % n as u64) as usize
    }
    fn bool(&mut self) -> bool {
        self.int(2) == 1
    }
}
fn seeds() -> Vec<u64> {
    let mut s = vec![FIXED_SEED];
    if let Some(x) = std::env::var("QA_SEED").ok().and_then(|v| v.parse().ok()) {
        s.push(x);
    }
    println!("seeds: {s:?}");
    s
}
fn scale() -> usize {
    match std::env::var("QA_PROPERTY_SCALE").ok().and_then(|v| v.parse::<usize>().ok()) {
        Some(n) if n >= 100 => 10,
        _ => 1,
    }
}

// ------------------------------------------------------------------------------------------------ FR-QRY-01 AC-18 (oracle)

const ZONES: [&str; 4] = ["Europe/Prague", "America/Los_Angeles", "Asia/Tokyo", "UTC"];
const UDALOST: &str = "# Tegg type definition (FR-TYP-01, FR-STO-06, D-90). Edit it in Tegg's type settings.\nversion: 1\nname: Událost\nplural: Události\nsystem: false\nfolder: Události\nicon: calendar\ncolor: blue\nreview: false\npreview: [den]\nattributes:\n  - key: den\n    name: Den\n    type: date\n  - key: kdy\n    name: Kdy\n    type: date-time\n";

/// A random value for the Date attribute `den` (None = no key) and what R203 reads from it.
fn den_value(r: &mut Rng, today: NaiveDate) -> (Option<String>, Option<NaiveDate>) {
    let d = today + Days::days(r.int(41) as i64 - 20);
    match r.int(8) {
        0 => (None, None),
        1 => (Some(String::new()), None),
        2 => (Some("2026-02-30".into()), None),
        3 => (Some("zítra".into()), None),
        4 => (Some(format!("{}T09:00:00+02:00", d.format("%Y-%m-%d"))), None),
        5 => (Some(format!("\"{}\"", d.format("%Y-%m-%d"))), Some(d)),
        _ => (Some(d.format("%Y-%m-%d").to_string()), Some(d)),
    }
}
/// A random RFC 3339 instant near `today` (or an invalid value) and its local date in `tz`.
fn instant_value(r: &mut Rng, today: NaiveDate, tz: chrono_tz::Tz) -> (Option<String>, Option<NaiveDate>) {
    let d = today + Days::days(r.int(31) as i64 - 15);
    let offs = ["+02:00", "-07:00", "Z", "+09:00", "+01:00"];
    match r.int(7) {
        0 => (None, None),
        1 => (Some("nikdy".into()), None),
        _ => {
            let s = format!("{}T{:02}:{:02}:00{}", d.format("%Y-%m-%d"), r.int(24), r.int(60), offs[r.int(offs.len())]);
            let local = DateTime::parse_from_rfc3339(&s).ok().map(|x| x.with_timezone(&tz).date_naive());
            (Some(s), local)
        }
    }
}
/// R203's lanes for rows already in result order.
fn oracle(rows: &[(String, Option<NaiveDate>)], env: &QueryEnv, drop: bool) -> Value {
    let today = env.today;
    let back = (today.weekday().num_days_from_monday() + 7 - env.week_start.num_days_from_monday()) % 7;
    let first = today - Days::days(back as i64);
    let last = first + Days::days(6);
    let mut today_l = Vec::new();
    let mut week = Vec::new();
    let mut later = Vec::new();
    let mut none = Vec::new();
    let mut days: Vec<(NaiveDate, Vec<String>)> = Vec::new();
    let mut d = today + Days::days(1);
    while d <= last {
        days.push((d, Vec::new()));
        d += Days::days(1);
    }
    for (p, v) in rows {
        match v {
            None => none.push(p.clone()),
            Some(v) if *v <= today => today_l.push(p.clone()),
            Some(v) if *v <= last => {
                week.push(p.clone());
                if let Some(g) = days.iter_mut().find(|(k, _)| k == v) {
                    g.1.push(p.clone());
                }
            }
            Some(_) => later.push(p.clone()),
        }
    }
    let lane = |id: &str, paths: Vec<String>, days: Vec<Value>| json!({ "id": id, "dropTarget": drop, "doneWithin": null, "paths": paths, "days": days });
    let mut out = vec![lane("period:today", today_l, vec![])];
    if today != last {
        out.push(lane("period:week", week, days.iter().map(|(k, v)| json!({ "date": k.format("%Y-%m-%d").to_string(), "paths": v })).collect()));
    }
    out.push(lane("period:later", later, vec![]));
    out.push(lane("none", none, vec![]));
    Value::Array(out)
}
fn lanes_json(r: &QueryResult) -> Value {
    let Some(g) = r.group.as_ref() else { return Value::Null };
    let p = |row: usize| tegg_format::nfc(&r.rows[row].path);
    Value::Array(
        g.lanes
            .iter()
            .map(|l| {
                json!({
                    "id": l.id, "dropTarget": l.drop_target, "doneWithin": l.done_within,
                    "paths": l.cards.iter().map(|c| p(c.row)).collect::<Vec<_>>(),
                    "days": l.days.iter().map(|d| json!({ "date": d.date.format("%Y-%m-%d").to_string(), "paths": d.cards.iter().map(|c| p(c.row)).collect::<Vec<_>>() })).collect::<Vec<_>>(),
                })
            })
            .collect(),
    )
}

#[test]
fn fr_qry_01_ac18_period_and_done_lane_read_rules() {
    let mut bad: Vec<String> = Vec::new();
    for seed in seeds() {
        let mut r = Rng(seed);
        for case in 0..(12 * scale()) {
            let sb = sandbox();
            let root = sb.base.join("Události");
            copy_dir(&common::repo_root().join("tests/fixtures/vaults/new-empty"), &root, &["README.md"]);
            write(&root, ".tegg/types/udalost.yml", UDALOST.as_bytes());
            let today = NaiveDate::from_ymd_opt(2026, 1, 1).expect("date") + Days::days(r.int(365) as i64);
            let zone = ZONES[r.int(ZONES.len())];
            let tz: chrono_tz::Tz = zone.parse().expect("zone");
            let week_start = [Weekday::Mon, Weekday::Sun, Weekday::Sat][r.int(3)];
            let env = QueryEnv { today, tz, week_start, locale: "cs".into() };
            let key = ["den", "kdy", "created"][r.int(3)];
            let mut rows: Vec<(String, Option<NaiveDate>)> = Vec::new();
            for i in 0..25 {
                let title = format!("U{i:02}");
                let (den, den_d) = den_value(&mut r, today);
                let (kdy, kdy_d) = instant_value(&mut r, today, tz);
                let (created, created_d) = instant_value(&mut r, today, tz);
                let mut fm = format!("---\ntype: udalost\ntitle: {title}\n");
                if let Some(v) = &den {
                    fm.push_str(&format!("den: {v}\n"));
                }
                if let Some(v) = &kdy {
                    fm.push_str(&format!("kdy: {v}\n"));
                }
                if let Some(v) = &created {
                    fm.push_str(&format!("created: {v}\n"));
                }
                fm.push_str("---\nText události.\n");
                let path = format!("Události/{title}.md");
                write(&root, &path, fm.as_bytes());
                // `created` that isn't ISO 8601 with an offset reads as missing (v1-queries §1.2): no date either.
                let d = match key {
                    "den" => den_d,
                    "kdy" => kdy_d,
                    _ => created_d,
                };
                rows.push((tegg_format::nfc(&path), d));
            }
            let q = format!("# Tegg saved query (FR-QRY-06). Edit it in Tegg: Queries › Náhodná období.\nversion: 1\ntitle: Náhodná období\ntypes: [udalost]\nmatch: all\nfilters: []\nsort: {{ by: title, order: asc }}\nlimit: 50\nview: board\ngroup_by: {{ {key}: period }}\nlanes: horizontal\ncreated: 2026-01-01T09:00:00+01:00\nmodified: 2026-01-01T09:00:00+01:00\n");
            write(&root, &qp("Náhodná období"), q.as_bytes());
            let core = open(&root, &sb.dirs, false);
            let res = core.query_run(QuerySource::Saved("Náhodná období".into()), None, &env);
            let want = oracle(&rows, &env, key == "den");
            let got = lanes_json(&res);
            if got != want {
                bad.push(format!("seed {seed} case {case} key {key} today {today} {zone} week {week_start:?}:\n got  {got}\n want {want}"));
            }
            if bad.len() > 3 {
                break;
            }
        }
    }
    assert_eq!(bad, Vec::<String>::new(), "group equals the brute-force lanes and day groups (R203)");
}

// ------------------------------------------------------------------------------------------------ FR-FMT-07 AC-35 (property)

#[derive(Clone, Copy, Debug)]
enum Change {
    Lanes,
    DoneLaneOff,
    DoneLaneOn,
    DoneLaneDays,
    Noop,
}
struct Case {
    name: String,
    text: String,
    nl: &'static str,
    has_done: bool,
    has_lanes: bool,
    has_lane_order: bool,
}
fn gen(r: &mut Rng, seed: u64, i: usize) -> Case {
    let nl = if r.int(4) == 0 { "\r\n" } else { "\n" };
    let name = format!("Úkoly náhodně {seed} {i}");
    let mut s = format!("# Tegg saved query (FR-QRY-06). Edit it in Tegg: Queries › {name}.{nl}");
    if r.bool() {
        s.push_str(&format!("# ručně psaný soubor{nl}"));
    }
    s.push_str(&format!("version: 1{nl}title: {name}{nl}types: [task]{nl}match: all{nl}"));
    let filters = ["  - status: { state_is_not: cancelled }", "  - status: { state_is: open }", "  - priority: High   # jen důležité"];
    let n = r.int(3);
    if n == 0 {
        s.push_str(&format!("filters: []{nl}"));
    } else {
        s.push_str(&format!("filters:{nl}"));
        for f in filters.iter().take(n) {
            s.push_str(&format!("{f}{nl}"));
        }
    }
    s.push_str(&format!("sort:{nl}  - {{ by: due, order: asc }}{nl}  - {{ by: priority, order: asc }}{nl}limit: 50{nl}view: board{nl}"));
    let period = r.bool();
    let comment = if r.bool() { "   # podle termínu" } else { "" };
    s.push_str(&if period { format!("group_by: {{ due: period }}{comment}{nl}") } else { format!("group_by: status{comment}{nl}") });
    let has_lanes = r.int(3) > 0;
    if has_lanes {
        s.push_str(&format!("lanes: {}{nl}", if r.bool() { "horizontal" } else { "vertical" }));
    }
    let has_lane_order = r.int(3) == 0;
    if has_lane_order {
        s.push_str(&if period { format!("lane_order: [later, today]{nl}") } else { format!("lane_order: [Waiting, To do]{nl}") });
    }
    let has_done = r.int(3) > 0;
    if has_done {
        match r.int(3) {
            0 => s.push_str(&format!("done_lane: {{ within_days: 7, folded: true }}{nl}")),
            1 => s.push_str(&format!("done_lane: {{ within_days: 3 }}   # krátce{nl}")),
            _ => s.push_str(&format!("done_lane:{nl}  within_days: 5{nl}  folded: false{nl}")),
        }
    }
    if r.int(4) == 0 {
        s.push_str(&format!("columns: [due]{nl}"));
    }
    s.push_str(&format!("created: 2026-10-13T08:00:00+02:00{nl}modified: 2026-10-13T08:00:00+02:00{nl}"));
    if r.int(5) == 0 {
        s.truncate(s.len() - nl.len());
    }
    Case { name, text: s, nl, has_done, has_lanes, has_lane_order }
}
/// The file's lines without those of `key` (its line and indented continuation lines) and without `modified:`.
fn outside(text: &str, key: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut in_key = false;
    for l in text.split_inclusive('\n') {
        let l = l.trim_end_matches(['\r', '\n']);
        if l.starts_with(&format!("{key}:")) {
            in_key = true;
            continue;
        }
        if in_key && l.starts_with("  ") {
            continue;
        }
        in_key = false;
        if l.starts_with("modified:") {
            continue;
        }
        out.push(l.to_string());
    }
    out
}

#[test]
fn fr_fmt_07_ac35_q2t_keys_round_trip() {
    let sb = sandbox();
    let root = overlay_vault(&sb);
    let core = open(&root, &sb.dirs, false);
    let mut bad: Vec<String> = Vec::new();
    for seed in seeds() {
        let mut r = Rng(seed ^ 0x35);
        for i in 0..(40 * scale()) {
            let c = gen(&mut r, seed, i);
            let rel = qp(&c.name);
            write(&root, &rel, c.text.as_bytes());
            reread(&core, &[&rel]);
            let q = core.query(&c.name);
            let (Some(mut d), Some(v)) = (q.def.clone(), q.version.clone()) else {
                bad.push(format!("{}: not read", c.name));
                continue;
            };
            if !q.broken.is_empty() {
                bad.push(format!("{}: broken {:?}\n{}", c.name, q.broken, c.text));
                continue;
            }
            let change = match r.int(5) {
                0 => Change::Lanes,
                1 if c.has_done => Change::DoneLaneOff,
                1 => Change::DoneLaneOn,
                2 if c.has_done => Change::DoneLaneDays,
                2 => Change::DoneLaneOn,
                3 => Change::Noop,
                _ => Change::Lanes,
            };
            let key = match change {
                Change::Lanes => "lanes",
                Change::Noop => "",
                _ => "done_lane",
            };
            match change {
                Change::Lanes => d.lanes = if d.lanes == Lanes::Horizontal { Lanes::Vertical } else { Lanes::Horizontal },
                Change::DoneLaneOff => d.done_lane = None,
                Change::DoneLaneOn => d.done_lane = Some(DoneLane { within_days: 7, folded: true }),
                Change::DoneLaneDays => d.done_lane = d.done_lane.map(|x| DoneLane { within_days: x.within_days + 10, folded: x.folded }),
                Change::Noop => {}
            }
            let intended = d.clone();
            if let Err(e) = core.query_apply(&c.name, &v, d, NOW) {
                bad.push(format!("{} {change:?}: query_apply {e:?}", c.name));
                continue;
            }
            let after = disk_s(&root, &rel).unwrap_or_default();
            if let Change::Noop = change {
                if after != c.text {
                    bad.push(format!("{}: a no-op wrote\n{}\n→\n{after}", c.name, c.text));
                }
                continue;
            }
            if outside(&after, key) != outside(&c.text, key) {
                bad.push(format!("{} {change:?}: lines outside `{key}` changed\n{}\n→\n{after}", c.name, c.text));
            }
            if !after.contains(&format!("modified: {NOW}")) {
                bad.push(format!("{} {change:?}: modified not set", c.name));
            }
            let eol_ok = if c.nl == "\r\n" { !after.replace("\r\n", "").contains('\n') } else { !after.contains('\r') };
            if !eol_ok || after.ends_with(c.nl) != c.text.ends_with(c.nl) {
                bad.push(format!("{} {change:?}: line ends or the final newline changed", c.name));
            }
            match change {
                Change::DoneLaneOff if after.contains("done_lane") || after.contains("within_days") => bad.push(format!("{}: done_lane not removed with its lines\n{after}", c.name)),
                Change::DoneLaneOn | Change::DoneLaneDays => {
                    let lines: Vec<&str> = after.split_inclusive('\n').map(|l| l.trim_end_matches(['\r', '\n'])).collect();
                    let Some(at) = lines.iter().position(|l| l.starts_with("done_lane:")) else {
                        bad.push(format!("{}: no done_lane line\n{after}", c.name));
                        continue;
                    };
                    if !lines[at].starts_with("done_lane: { within_days: ") || !lines[at].contains("folded: ") {
                        bad.push(format!("{}: done_lane not one flow line with both keys: {}", c.name, lines[at]));
                    }
                    if matches!(change, Change::DoneLaneOn) && !c.has_done {
                        let prev = if c.has_lane_order { "lane_order:" } else if c.has_lanes { "lanes:" } else { "group_by:" };
                        if at == 0 || !lines[at - 1].starts_with(prev) {
                            bad.push(format!("{}: done_lane not right after `{prev}` (R201's order)\n{after}", c.name));
                        }
                    }
                }
                _ => {}
            }
            reread(&core, &[&rel]);
            let back = core.query(&c.name).def;
            if back.as_ref().map(|b| (b.lanes, b.done_lane, b.group_by.clone(), b.group_period, b.lane_order.clone())) != Some((intended.lanes, intended.done_lane, intended.group_by.clone(), intended.group_period, intended.lane_order.clone())) {
                bad.push(format!("{} {change:?}: reads back as {back:?}", c.name));
            }
            if bad.len() > 5 {
                break;
            }
        }
    }
    assert_eq!(bad, Vec::<String>::new(), "Q2-T keys round-trip: only the changed key's lines and modified change");
}
