//! QA review of slice REL, QA-3 (D-1761; FR-LNK-15, AR-01; docs/contracts/v1-related.md §1.4, §1.8): every stem
//! written to `rel` is exactly one token of SQLite's `unicode61` tokenizer, so the document-frequency map kept in memory
//! by `Index::apply` / `remove` (D-1757) always equals the map a reopened index reads from `rel_vocab`.
//!
//! 1. Every code point `stemming::is_rel_token_char` accepts is tokenized by the bundled SQLite as exactly itself.
//! 2. Property: random notes of arbitrary Unicode (symbols with Other_Alphabetic such as `Ⓐ`, CJK, emoji, combining
//!    marks, letters SQLite folds such as `ς` and `ſ`, recent letters, unassigned and private-use code points), after a
//!    random sequence of upserts and removes: the kept df map equals a fresh read of `rel_vocab`, and each note's stored
//!    stems equal what SQLite's tokenizer yields for its `rel` columns.
//!
//! Seeds (TS-L2): a fixed seed plus one random seed per run (`QA_SEED` when set, else the clock); with
//! `QA_PROPERTY_SCALE` ≥ 100 (nightly) 10 seeds × 1,000 steps. Every seed is printed (`seed = N`).

use tegg_index::stemming::{is_rel_token_char, stems, Lang};
use tegg_index::{Index, RelatedParams};
use tegg_vault::FileVersion;

const FIXED_SEED: u64 = 20_261_114;

struct Rng(u64);
impl Rng {
    fn new(seed: u64) -> Rng {
        Rng(seed.wrapping_mul(0x9E37_79B9_7F4A_7C15) | 1)
    }
    fn next(&mut self) -> u64 {
        let mut x = self.0;
        x ^= x >> 12;
        x ^= x << 25;
        x ^= x >> 27;
        self.0 = x;
        x.wrapping_mul(0x2545_F491_4F6C_DD1D)
    }
    fn below(&mut self, n: usize) -> usize {
        (self.next() % n.max(1) as u64) as usize
    }
}
fn scale() -> u64 {
    std::env::var("QA_PROPERTY_SCALE").ok().and_then(|s| s.parse().ok()).unwrap_or(1)
}
fn seeds() -> Vec<u64> {
    let r = std::env::var("QA_SEED").ok().and_then(|s| s.parse().ok()).unwrap_or_else(|| {
        std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos() as u64).unwrap_or(7)
    });
    if scale() >= 100 {
        (0..10).map(|i| if i == 0 { FIXED_SEED } else { r.wrapping_add(i) }).collect()
    } else {
        vec![FIXED_SEED, r]
    }
}
fn steps() -> usize {
    if scale() >= 100 {
        1000
    } else {
        150
    }
}

/// SQLite's `unicode61 remove_diacritics 0` tokens of each text, in order (the same tokenizer as `rel`).
struct Tokenizer(rusqlite::Connection);
impl Tokenizer {
    fn new() -> Tokenizer {
        let c = rusqlite::Connection::open_in_memory().expect("setup: SQLite");
        c.execute_batch(
            "CREATE VIRTUAL TABLE t USING fts5(x, tokenize = 'unicode61 remove_diacritics 0');
             CREATE VIRTUAL TABLE v USING fts5vocab(t, 'instance');",
        )
        .expect("setup: fts5");
        Tokenizer(c)
    }
    fn tokens_of_many(&self, texts: &[String]) -> Vec<Vec<String>> {
        let tx = self.0.unchecked_transaction().expect("setup: tx");
        tx.execute("DELETE FROM t", []).expect("setup: delete");
        for (i, t) in texts.iter().enumerate() {
            tx.execute("INSERT INTO t (rowid, x) VALUES (?1, ?2)", rusqlite::params![i as i64 + 1, t]).expect("setup: insert");
        }
        let mut out = vec![Vec::<(i64, String)>::new(); texts.len()];
        {
            let mut st = tx.prepare("SELECT doc, offset, term FROM v").expect("setup: vocab");
            let rows = st.query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1)?, r.get::<_, String>(2)?))).expect("setup: vocab rows");
            for row in rows {
                let (doc, off, term) = row.expect("setup: vocab row");
                out[(doc - 1) as usize].push((off, term));
            }
        }
        tx.commit().expect("setup: commit");
        out.into_iter()
            .map(|mut v| {
                v.sort();
                v.into_iter().map(|(_, t)| t).collect()
            })
            .collect()
    }
}

#[test]
fn bug_qarel_fr_lnk_15_every_rel_token_char_is_its_own_unicode61_token() {
    let accepted: Vec<char> = (0u32..=0x10FFFF).filter_map(char::from_u32).filter(|&c| is_rel_token_char(c)).collect();
    let tok = Tokenizer::new();
    let got = tok.tokens_of_many(&accepted.iter().map(|c| c.to_string()).collect::<Vec<_>>());
    let bad: Vec<String> = accepted
        .iter()
        .zip(&got)
        .filter(|(c, t)| **t != vec![c.to_string()])
        .map(|(c, t)| format!("U+{:04X} → {t:?}", *c as u32))
        .take(20)
        .collect();
    assert_eq!(bad, Vec::<String>::new(), "every accepted character is one unicode61 token, itself");
    // Folded Czech and English are unaffected: ASCII lower-case letters and digits, and every stem of the golden list.
    for c in ('a'..='z').chain('0'..='9') {
        assert!(is_rel_token_char(c), "{c} is a rel token character");
    }
    let golden = std::fs::read_to_string(std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../tests/fixtures/format/stem/cs.tsv")).expect("setup: cs.tsv");
    for l in golden.lines().skip(1) {
        let stem = l.split('\t').nth(1).unwrap_or("");
        assert!(stem.chars().all(is_rel_token_char), "the golden stem {stem:?} keeps every character");
    }
    // The symbols QA-3 named are not accepted.
    for c in ['Ⓐ', 'ⓐ', 'ς', 'ſ', 'µ', '🄰'] {
        assert!(!is_rel_token_char(c), "U+{:04X} is not a rel token character", c as u32);
    }
}

/// Pieces of words: ASCII, Czech (upper and lower case, NFD), symbols with Other_Alphabetic (`Ⓐ`, `🄰`), letters SQLite
/// folds (`ς`, `ſ`, `µ`, `ϐ`), CJK, emoji, combining marks, Devanagari (spacing marks), Cherokee, letters of recent
/// Unicode versions (Kawi, Garay, Toto, Tangsa), unassigned and private-use code points, numbers of every kind.
const PIECES: &[&str] = &[
    "kniha", "les", "hory", "tree", "book", "skal", "řeka", "ŘEKA", "žluť", "Čas", "ú", "ě", "e\u{301}", "a\u{30C}", "Ⓐ", "ⓐ", "ⓑⓒ", "🄰", "🅐",
    "ς", "σ", "λόγος", "ſ", "µ", "ϐ", "ϑ", "ẛ", "日本", "語", "中文", "😀", "🎉", "\u{19B0}", "\u{19C8}", "\u{1CF2}", "नमस्ते", "\u{13A0}", "\u{AB70}",
    "\u{11F04}", "\u{10D50}", "\u{1E290}", "\u{16A70}", "\u{0378}", "\u{2FFFE}", "\u{E000}", "\u{F0000}", "①", "²", "Ⅻ", "ⅻ", "İ", "ß", "ø", "æ", "ŉ",
    "ǅ", "ﬁ", "ｗ", "Ｗ", "ꞵ", "\u{1E921}", "\u{0345}", "ᾳ",
];

fn word(r: &mut Rng) -> String {
    (0..1 + r.below(4)).map(|_| PIECES[r.below(PIECES.len())]).collect()
}
fn note(r: &mut Rng, title: &str) -> String {
    let body: Vec<String> = (0..5 + r.below(25)).map(|_| word(r)).collect();
    let heading = if r.below(3) == 0 { format!("# {}\n", word(r)) } else { String::new() };
    format!("---\ntitle: {title} {}\ntags: [{}]\n---\n{heading}{}\n", word(r), word(r).replace(['[', ']', ',', ':'], ""), body.join(" "))
}
fn version(n: u64) -> FileVersion {
    let mut hash = [0u8; 32];
    hash[..8].copy_from_slice(&n.to_le_bytes());
    FileVersion { mtime_ns: n as i128, size: n, hash }
}

#[test]
fn bug_qarel_fr_lnk_15_df_map_equals_rebuild() {
    let tok = Tokenizer::new();
    let mut bad: Vec<String> = Vec::new();
    let (mut kept_exotic, mut dropped_exotic) = (false, false);
    for seed in seeds() {
        println!("seed = {seed}");
        let mut r = Rng::new(seed);
        let dir = tempfile::tempdir().expect("setup: tempdir");
        let mut idx = Index::open(&dir.path().join("index.sqlite")).expect("setup: Index::open");
        let mut live: Vec<String> = Vec::new();
        let mut n = 0u64;
        for i in 0..20 {
            let p = format!("Pages/N{i}.md");
            n += 1;
            idx.upsert(&p, note(&mut r, &format!("N{i}")).as_bytes(), &version(n)).expect("upsert");
            live.push(p);
        }
        // Build the kept map now (a short note's ask doesn't need it), so every later check compares the incrementally
        // kept map (D-1757).
        for p in &live {
            let _ = idx.related(p, false, &RelatedParams::default(), &[], &|a: &str, b: &str| a.cmp(b));
            if idx.rel_df_maps().0.is_some() {
                break;
            }
        }
        assert!(idx.rel_df_maps().0.is_some(), "setup: an ask built the df map");
        for step in 0..steps() {
            match r.below(4) {
                0 if live.len() > 5 => {
                    let p = live.swap_remove(r.below(live.len()));
                    idx.remove(&p).expect("remove");
                }
                _ => {
                    let p = if r.below(2) == 0 && !live.is_empty() {
                        live[r.below(live.len())].clone()
                    } else {
                        let p = format!("Pages/M{step}.md");
                        live.push(p.clone());
                        p
                    };
                    n += 1;
                    let title = p.trim_start_matches("Pages/").trim_end_matches(".md").to_string();
                    idx.upsert(&p, note(&mut r, &title).as_bytes(), &version(n)).expect("upsert");
                }
            }
            if step % 10 != 9 && step + 1 != steps() {
                continue;
            }
            let (kept, fresh) = idx.rel_df_maps();
            match kept {
                None => bad.push(format!("seed {seed} step {step}: the df map was not kept")),
                Some(k) if k != fresh => {
                    let mut diff: Vec<String> = k.iter().filter(|(s, d)| fresh.get(*s) != Some(d)).map(|(s, d)| format!("{s:?}: kept {d}, rebuilt {:?}", fresh.get(s))).collect();
                    diff.extend(fresh.iter().filter(|(s, _)| !k.contains_key(*s)).map(|(s, d)| format!("{s:?}: kept none, rebuilt {d}")));
                    diff.truncate(5);
                    bad.push(format!("seed {seed} step {step}: kept df map ≠ rebuilt: {diff:?}"));
                }
                Some(_) => {}
            }
            let rows: Vec<(String, Vec<String>, Vec<String>)> = live
                .iter()
                .map(|p| {
                    let t = idx.rel_terms(p).expect("an indexed note has a rel row");
                    (p.clone(), t.title, t.body)
                })
                .collect();
            let texts: Vec<String> = rows.iter().flat_map(|(_, t, b)| [t.join(" "), b.join(" ")]).collect();
            let toks = tok.tokens_of_many(&texts);
            for (i, (p, t, b)) in rows.iter().enumerate() {
                if &toks[2 * i] != t || &toks[2 * i + 1] != b {
                    bad.push(format!("seed {seed} step {step}: {p}: stems {t:?} {b:?} ≠ SQLite tokens {:?} {:?}", toks[2 * i], toks[2 * i + 1]));
                }
                kept_exotic |= t.iter().chain(b).any(|s| !s.is_ascii());
            }
            if !bad.is_empty() {
                break;
            }
        }
        // Non-vacuous: some word of exotic characters loses its stem.
        dropped_exotic |= (0..50).any(|_| {
            let w = word(&mut r);
            let words = tegg_index::fold(&w);
            stems(&w, Lang::Cs).is_empty() && words.chars().count() >= 3 && !words.chars().all(is_rel_token_char)
        });
        if !bad.is_empty() {
            break;
        }
    }
    assert_eq!(bad, Vec::<String>::new(), "the kept df map equals a rebuild, and stored stems are SQLite's tokens");
    assert!(kept_exotic, "some non-ASCII stem is kept (the property is not only ASCII)");
    assert!(dropped_exotic, "some stem with a non-token character is dropped");
}
