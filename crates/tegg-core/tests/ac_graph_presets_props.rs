//! Slice G3 L2 property test of the `graph.yml` patcher (docs/acceptance/graph.md FR-FMT-07 AC-27; R118 write rules,
//! AP-921; docs/contracts/v1-graph.md §16.1): for random files (comments at the dash's indent and at column 0, unknown
//! keys at both levels, flow and block lists, plain / single- / double-quoted names, NFD names, CRLF, no final newline)
//! and a random operation, the result lists the expected presets, and every line outside the operated item (and outside
//! the `presets: []` line when the list is emptied) is byte-identical; reading changes no byte. Seeded (no network, no
//! clock). Written from the AC and the contract only (D-61); every check is an assertion in this file.

mod common;
mod graph_presets_setup;
mod graph_setup;

use std::collections::BTreeSet;
use std::time::Duration;

use common::*;
use graph_presets_setup::*;
use tegg_core::{GraphPresets, PresetOp};
use tegg_format::nfc;

const CASES: usize = 300;

struct Rng(u64);
impl Rng {
    fn next(&mut self) -> u64 {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 7;
        self.0 ^= self.0 << 17;
        self.0
    }
    fn below(&mut self, n: usize) -> usize {
        (self.next() % n as u64) as usize
    }
    fn chance(&mut self, pct: u64) -> bool {
        self.next() % 100 < pct
    }
    fn subset(&mut self, pool: &[&str]) -> Vec<String> {
        pool.iter().filter(|_| self.chance(35)).map(|s| s.to_string()).collect()
    }
}

const NAMES: &[&str] = &[
    "Lidé", "Schůzky", "Bez štítků", "Čtení", "Řešení", "Úkoly na týden", "Projekty", "Jen vztahy", "Lidé: schůzky", "Ano #ne", "Žluťoučký kůň",
    "Plán", "Výdaje 2026", "Zdraví", "Cestování", "Náhled",
];
const TYPES: &[&str] = &["page", "task", "quick-note", "daily-note", "image", "pdf", "tag", "kniha"];
const KINDS: &[&str] = &["link", "relation", "embed", "tag"];

#[derive(Clone)]
struct Item {
    name: String,
    types: Vec<String>,
    kinds: Vec<String>,
    lines: Vec<String>, // without line endings
}

fn needs_quotes(n: &str) -> bool {
    n.contains(": ") || n.contains(" #") || n.starts_with(|c: char| "-[]{}#&*!|>'\"%@`".contains(c))
}

fn gen_item(rng: &mut Rng, name: &str) -> Item {
    let types = rng.subset(TYPES);
    let kinds = rng.subset(KINDS);
    let written = if rng.chance(20) { nfd(name) } else { name.to_string() };
    let quoted = match rng.below(3) {
        _ if needs_quotes(name) => format!("\"{written}\""),
        0 => written.clone(),
        1 => format!("'{written}'"),
        _ => format!("\"{written}\""),
    };
    let mut lines = vec![format!("  - name: {quoted}")];
    if rng.chance(20) {
        lines.push("    poznámka: ruční".to_string());
    }
    let list = |rng: &mut Rng, key: &str, v: &[String], lines: &mut Vec<String>| {
        if !v.is_empty() && rng.chance(40) {
            lines.push(format!("    {key}:"));
            for x in v {
                lines.push(format!("      - {x}"));
            }
        } else {
            let tail = if rng.chance(25) { "   # pozn." } else { "" };
            lines.push(format!("    {key}: [{}]{tail}", v.join(", ")));
        }
    };
    list(rng, "hidden-types", &types, &mut lines);
    list(rng, "hidden-kinds", &kinds, &mut lines);
    if rng.chance(15) {
        lines.push("    barva: modrá".to_string());
    }
    Item { name: nfc(name), types, kinds, lines }
}

struct File {
    head: Vec<String>,
    /// Per item: comment lines (at the dash's indent) before it, then the item.
    items: Vec<(Vec<String>, Item)>,
    tail: Vec<String>,
    crlf: bool,
    final_newline: bool,
}
impl File {
    fn lines(&self) -> Vec<String> {
        let mut v = self.head.clone();
        for (c, it) in &self.items {
            v.extend(c.iter().cloned());
            v.extend(it.lines.iter().cloned());
        }
        v.extend(self.tail.iter().cloned());
        v
    }
    fn text(&self) -> String {
        join(&self.lines(), self.crlf, self.final_newline)
    }
    /// (first, last) line index of item `i` in `lines()`.
    fn range(&self, i: usize) -> (usize, usize) {
        let mut at = self.head.len();
        for (k, (c, it)) in self.items.iter().enumerate() {
            at += c.len();
            if k == i {
                return (at, at + it.lines.len() - 1);
            }
            at += it.lines.len();
        }
        unreachable!()
    }
}
fn join(lines: &[String], crlf: bool, final_newline: bool) -> String {
    let eol = if crlf { "\r\n" } else { "\n" };
    let mut s = lines.join(eol);
    if final_newline {
        s.push_str(eol);
    }
    s
}
fn split(text: &str) -> Vec<String> {
    let t = text.replace("\r\n", "\n");
    let t = t.strip_suffix('\n').unwrap_or(&t);
    t.split('\n').map(String::from).collect()
}

fn gen_file(rng: &mut Rng) -> File {
    let mut head = vec!["# Tegg graph filter presets (FR-GRP-02, D-906, D-907). Edit them in the graph's Preset menu.".to_string()];
    if rng.chance(40) {
        head.push("# Ruční poznámka.".into());
    }
    head.push("version: 1".into());
    if rng.chance(40) {
        head.push("výchozí-pohled: seznam".into());
    }
    head.push("presets:".into());
    let n = 1 + rng.below(4);
    let mut used = BTreeSet::new();
    let mut items = Vec::new();
    while items.len() < n {
        let name = NAMES[rng.below(NAMES.len())];
        if !used.insert(nfc(name).to_lowercase()) {
            continue;
        }
        let comments = if rng.chance(25) { vec!["  # oddíl".to_string()] } else { vec![] };
        items.push((comments, gen_item(rng, name)));
    }
    let final_newline = rng.chance(80);
    let tail = if rng.chance(40) || !final_newline { vec!["# konec".to_string()] } else { vec![] };
    File { head, items, tail, crlf: rng.chance(30), final_newline }
}

fn listed(p: &GraphPresets) -> Vec<(String, BTreeSet<String>, BTreeSet<String>)> {
    p.presets.iter().map(|x| (x.name.clone(), x.hidden_types.iter().cloned().collect(), x.hidden_kinds.iter().cloned().collect())).collect()
}
fn model(items: &[Item]) -> Vec<(String, BTreeSet<String>, BTreeSet<String>)> {
    items.iter().map(|x| (x.name.clone(), x.types.iter().cloned().collect(), x.kinds.iter().cloned().collect())).collect()
}

#[test]
fn fr_fmt_07_ac27_graph_yml_minimal_patches_property() {
    let sb = sandbox();
    let root = sb.base.join("Vlastnosti");
    std::fs::create_dir_all(&root).expect("setup: vault");
    graph_setup::copy_dir(&repo_root().join("tests/fixtures/vaults/new-empty/.tegg"), &root.join(".tegg"), &[]);
    std::fs::write(root.join(YML), fx("valid.yml")).expect("setup: graph.yml");
    let core = graph_setup::open(&root, &sb.dirs);
    let mut rng = Rng(0x0067_3302_6103_0001);
    let mut bad: Vec<String> = Vec::new();
    for case in 0..CASES {
        let file = gen_file(&mut rng);
        let text = file.text();
        std::fs::write(root.join(YML), text.as_bytes()).expect("setup: write case");
        core.notify_changed(&[YML.to_string()]);
        let _ = core.wait_idle(Duration::from_secs(10));
        let read = core.graph_presets();
        let items: Vec<Item> = file.items.iter().map(|(_, it)| it.clone()).collect();
        if listed(&read) != model(&items) {
            bad.push(format!("case {case}: read {:?}, want {:?}\n{text}", listed(&read), model(&items)));
            break;
        }
        if std::fs::read(root.join(YML)).ok().as_deref() != Some(text.as_bytes()) {
            bad.push(format!("case {case}: reading changed bytes"));
            break;
        }
        let orig = file.lines();
        let i = rng.below(items.len());
        let (from, to) = file.range(i);
        let mut want_items = items.clone();
        let op = match rng.below(4) {
            0 => {
                let (t, k) = (rng.subset(TYPES), rng.subset(KINDS));
                want_items[i].types = t.clone();
                want_items[i].kinds = k.clone();
                PresetOp::Update { name: items[i].name.clone(), hidden_types: t, hidden_kinds: k }
            }
            1 => {
                let to_name = format!("{} {}", items[i].name, 2 + rng.below(90));
                want_items[i].name = nfc(&to_name);
                PresetOp::Rename { from: items[i].name.clone(), to: to_name }
            }
            2 => {
                want_items.remove(i);
                PresetOp::Delete { name: items[i].name.clone() }
            }
            _ => {
                let name = format!("Nová {case}");
                let (t, k) = (rng.subset(TYPES), rng.subset(KINDS));
                want_items.push(Item { name: nfc(&name), types: t.clone(), kinds: k.clone(), lines: vec![] });
                PresetOp::Save { name, hidden_types: t, hidden_kinds: k }
            }
        };
        let r = core.graph_presets_apply(read.version.clone(), op.clone());
        let Ok(r) = r else {
            bad.push(format!("case {case}: {op:?} answered {r:?}\n{text}"));
            break;
        };
        if listed(&r) != model(&want_items) {
            bad.push(format!("case {case}: after {op:?}: {:?}, want {:?}", listed(&r), model(&want_items)));
        }
        let out_text = String::from_utf8(std::fs::read(root.join(YML)).unwrap_or_default()).unwrap_or_default();
        if file.crlf && out_text.replace("\r\n", "").contains('\n') {
            bad.push(format!("case {case}: a bare LF in a CRLF file after {op:?}"));
        }
        if out_text.ends_with('\n') != file.final_newline {
            bad.push(format!("case {case}: the final newline changed after {op:?}"));
        }
        let out = split(&out_text);
        let ok_lines = match &op {
            PresetOp::Update { .. } | PresetOp::Rename { .. } => {
                let suffix = orig.len() - 1 - to;
                out.len() >= from + suffix && out[..from] == orig[..from] && out[out.len() - suffix..] == orig[to + 1..]
            }
            PresetOp::Delete { .. } => {
                let mut want: Vec<String> = orig[..from].to_vec();
                want.extend(orig[to + 1..].iter().cloned());
                if want_items.is_empty() {
                    if let Some(l) = want.iter_mut().find(|l| l.as_str() == "presets:") {
                        *l = "presets: []".into();
                    }
                }
                out == want
            }
            PresetOp::Save { .. } => {
                let (_, last) = file.range(items.len() - 1);
                out.len() == orig.len() + 3 && out[..=last] == orig[..=last] && out[last + 4..] == orig[last + 1..]
            }
        };
        if !ok_lines {
            bad.push(format!("case {case}: lines outside the item changed after {op:?}\n--- before\n{text}\n--- after\n{out_text}"));
        }
        if bad.len() >= 3 {
            break;
        }
    }
    assert_eq!(bad, Vec::<String>::new(), "minimal patches on random graph.yml files (R118)");
}
