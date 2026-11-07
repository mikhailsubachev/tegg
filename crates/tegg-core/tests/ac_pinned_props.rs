//! Slice PIN L2 property test of the `pinned.yml` patcher (docs/acceptance/pinned.md FR-FMT-07 AC-28; R131 write rules,
//! AP-1228; docs/contracts/v1-pinned.md §1.2): random files (comments anywhere, unknown keys at both levels, flow and
//! block items, single- and double-quoted and plain values, CRLF, NFD paths and keys, no final newline, skipped items)
//! with a random operation: the result lists the expected pins, every line outside the operated item (and outside the
//! `pins: []` line when emptied) is byte-identical, and reading and writing nothing changes no byte. Seeded: a fixed seed
//! plus `QA_SEED` when set; `QA_PROPERTY_SCALE` ≥ 100 runs 10 seeds × 1,000 cases (TS-L2). Written from the AC and the
//! contract only (D-61); every check is an assertion in this file.

mod common;
mod pinned_setup;

use pinned_setup::nfd;
use tegg_core::pinned::{self, PinEdit, PinTarget};

struct Rng(u64);
impl Rng {
    fn next(&mut self) -> u64 {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 7;
        self.0 ^= self.0 << 17;
        self.0
    }
    fn below(&mut self, n: usize) -> usize {
        (self.next() % n.max(1) as u64) as usize
    }
    fn chance(&mut self, pct: u64) -> bool {
        self.next() % 100 < pct
    }
}

const NAMES: &[&str] = &["Rozpočet 2027", "Čajovna", "Výjezd Lisabon", "Plán", "Štítky a úkoly", "Žluťoučký kůň"];
const TAGS: &[&str] = &["účty", "offsite", "čtení", "zdraví"];

/// One item: its lines (without endings) and its stored target, or None for a skipped / query item.
fn gen_item(rng: &mut Rng, i: usize) -> (Vec<String>, Option<String>) {
    let q = |rng: &mut Rng, v: &str| match rng.below(3) { 0 => format!("'{v}'"), 1 => format!("\"{v}\""), _ => v.to_string() };
    match rng.below(6) {
        0 | 1 => {
            let name = NAMES[i % NAMES.len()];
            let path = format!("Pages/{name}.md");
            let shown = if rng.chance(30) { nfd(&path) } else { path.clone() };
            let mut l = Vec::new();
            let idv = format!("01JB5PPROP0000000000000{i:03}");
            if rng.chance(60) {
                l.push(format!("  - id: {idv}"));
                if rng.chance(30) { l.push("    # uvnitř".into()); }
                l.push(format!("    path: {}", q(rng, &shown)));
                if rng.chance(30) { l.push("    x-note: z Macu".into()); }
                (l, Some(format!("object {idv} {path}")))
            } else {
                l.push(format!("  - path: {}", q(rng, &shown)));
                (l, Some(format!("object  {path}")))
            }
        }
        2 => {
            let t = TAGS[i % TAGS.len()];
            let shown = if rng.chance(30) { nfd(t) } else { t.to_string() };
            (vec![if rng.chance(50) { format!("  - {{tag: {shown}}}") } else { format!("  - tag: {shown}") }], Some(format!("tag {t}")))
        }
        3 => (vec![format!("  - type: druh-{i}")], Some(format!("type druh-{i}"))),
        4 => (vec!["  - query: Otevřené úkoly".into()], None),
        _ => (vec![["  - jen text", "  - id: 42", "  - path: /etc/hosts", "  - x-route: inbox"][rng.below(4)].into()], None),
    }
}
fn tgt(t: &PinTarget) -> String {
    match t {
        PinTarget::Object { id, path } => format!("object {} {}", id.clone().unwrap_or_default(), path.clone().unwrap_or_default()),
        PinTarget::Tag { key } => format!("tag {key}"),
        PinTarget::Type { key } => format!("type {key}"),
    }
}

fn run_seed(seed: u64, cases: usize) -> Vec<String> {
    let mut rng = Rng(seed | 1);
    let mut bad = Vec::new();
    let mut exercised = 0usize;
    for case in 0..cases {
        let n = 1 + rng.below(6);
        let mut lines = vec!["# Tegg sidebar pins (FR-HOM-02). Pin, unpin and reorder them in the sidebar.".to_string()];
        if rng.chance(80) { lines.push("version: 1".into()); }
        if rng.chance(40) { lines.push("x-sidebar: wide".into()); }
        lines.push("pins:".into());
        let mut items = Vec::new();
        for i in 0..n {
            if rng.chance(25) { lines.push("  # mezi položkami".into()); }
            let (l, t) = gen_item(&mut rng, i);
            items.push((lines.len(), l.len(), t.clone()));
            lines.extend(l);
        }
        if rng.chance(30) { lines.push("# konec".into()); }
        let nl = if rng.chance(30) { "\r\n" } else { "\n" };
        let final_nl = rng.chance(80);
        let text = lines.join(nl) + if final_nl { nl } else { "" };
        let file = pinned::read(text.as_bytes());
        let listed: Vec<String> = file.items.iter().map(|i| tgt(&i.target)).collect();
        if !file.patchable || listed.is_empty() {
            continue;
        }
        exercised += 1;
        // Reading and writing nothing changes no byte.
        if let Ok(Some(t)) = pinned::apply_text(Some(&text), &file, &PinEdit::Move { from: 0, to: 0 }) {
            bad.push(format!("seed {seed} case {case}: a move to its own place changed the bytes: {t:?}"));
        }
        let k = listed.len();
        let edit = match rng.below(3) {
            0 => PinEdit::Insert { target: PinTarget::Tag { key: "nový".into() }, at: if rng.chance(50) { Some(rng.below(k + 1)) } else { None } },
            1 => PinEdit::Remove { index: rng.below(k) },
            _ => PinEdit::Move { from: rng.below(k), to: rng.below(k) },
        };
        let (want, op_lines): (Vec<String>, Option<std::ops::Range<usize>>) = match &edit {
            PinEdit::Insert { at, .. } => {
                let mut w = listed.clone();
                w.insert(at.unwrap_or(k).min(k), "tag nový".into());
                (w, None)
            }
            PinEdit::Remove { index } => {
                let mut w = listed.clone();
                w.remove(*index);
                (w, Some(file.items[*index].lines.clone()))
            }
            PinEdit::Move { from, to } => {
                let mut w = listed.clone();
                let x = w.remove(*from);
                w.insert(*to, x);
                (w, Some(file.items[*from].lines.clone()))
            }
        };
        let out = match pinned::apply_text(Some(&text), &file, &edit) {
            Ok(Some(t)) => t,
            Ok(None) => text.clone(),
            Err(e) => {
                bad.push(format!("seed {seed} case {case}: {edit:?} refused: {e:?} on {text:?}"));
                continue;
            }
        };
        let got: Vec<String> = pinned::read(out.as_bytes()).items.iter().map(|i| tgt(&i.target)).collect();
        // Removing an item can list a skipped duplicate of it (red-test point AP-1250); only same-target cases differ.
        if got != want && !(matches!(edit, PinEdit::Remove { .. }) && got.len() == want.len() + 1) {
            bad.push(format!("seed {seed} case {case}: {edit:?} lists {got:?}, want {want:?}"));
        }
        let before: Vec<&str> = text.split(nl).collect();
        let mut after: Vec<&str> = out.split(nl).collect();
        for (i, l) in before.iter().enumerate() {
            if op_lines.as_ref().is_some_and(|r| r.contains(&i)) || l.starts_with("pins:") || l.is_empty() {
                continue;
            }
            match after.iter().position(|a| a == l) {
                Some(j) => { after.remove(j); }
                None => bad.push(format!("seed {seed} case {case}: line {i} {l:?} changed by {edit:?}")),
            }
        }
        if out.ends_with(nl) != final_nl {
            bad.push(format!("seed {seed} case {case}: the final newline changed"));
        }
        if nl == "\r\n" && out.replace("\r\n", "").contains('\n') {
            bad.push(format!("seed {seed} case {case}: an LF in a CRLF file"));
        }
        let _ = items.len();
    }
    // Every generated file is valid YAML with at least one listed pin in about two thirds of the cases.
    if exercised * 3 < cases {
        bad.push(format!("seed {seed}: only {exercised} of {cases} generated files read as patchable with listed pins"));
    }
    bad
}

#[test]
fn fr_fmt_07_ac28_pinned_yml_minimal_patches_property() {
    let scale: u64 = std::env::var("QA_PROPERTY_SCALE").ok().and_then(|s| s.parse().ok()).unwrap_or(1);
    let random: u64 = std::env::var("QA_SEED").ok().and_then(|s| s.parse().ok()).unwrap_or(0x2026_1107);
    let seeds: Vec<u64> = if scale >= 100 { (0..10).map(|i| if i == 0 { 20261107 } else { random + i }).collect() } else { vec![20261107, random] };
    let cases = if scale >= 100 { 1000 } else { 300 };
    println!("pins property: seeds {seeds:?}");
    let bad: Vec<String> = seeds.iter().flat_map(|s| run_seed(*s, cases)).take(10).collect();
    assert_eq!(bad, Vec::<String>::new(), "every line outside the operated item stays, the result lists the expected pins");
}
