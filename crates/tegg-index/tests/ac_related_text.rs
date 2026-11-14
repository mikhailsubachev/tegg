//! Slice REL L1 tests of the text pipeline and the ranking functions (docs/acceptance/related.md R179…R182;
//! docs/contracts/v1-related.md §1.2–§1.9): FR-LNK-15 AC-1 (folded words give one stem), AC-2 (the golden list
//! tests/fixtures/format/stem/cs.tsv), AC-4 (stop words, numbers, short stems), AC-6 (the English stemmer and the language
//! of the runtime text `Budgets about meetings.`), AC-13 (`cut_off`), AC-18 (`signature`), AC-20 (`sentences`,
//! `tegg_format::plain::plain_blocks`). Written from the ACs and the contract only (D-61); every check is an assertion in
//! this file (tools/qa CONTRACT §5.2). Czech text is synthetic (D-50).

use std::collections::{BTreeMap, BTreeSet};

use tegg_index::related::{cut_off, sentences, signature, TermCounts};
use tegg_index::stemming::{is_stop_word, language_of, rel_row, stem_cs, stem_en, stems, stop_words, Lang};
use tegg_index::{fold, RelatedParams};
use unicode_normalization::UnicodeNormalization;

fn nfd(s: &str) -> String {
    s.nfd().collect()
}
fn nfc(s: &str) -> String {
    s.nfc().collect()
}
fn v(xs: &[&str]) -> Vec<String> {
    xs.iter().map(|s| s.to_string()).collect()
}

// ------------------------------------------------------------------------------------------------ FR-LNK-15 AC-1

#[test]
fn fr_lnk_15_ac1_folded_words_give_one_stem() {
    let mut bad = Vec::new();
    let cases: [(&[&str], &str); 3] = [
        (&["důležité", "dulezite", "Důležité", "DULEZITE", "DŮLEŽITÉ", "dulezité", "důlezite"], "dulezit"),
        (&["Praha", "praze", "PRAZE"], "prah"),
        (&["rozpočtu", "rozpoctu", "ROZPOČTU"], "rozpock"),
    ];
    for (words, want) in cases {
        for w in words {
            for (form, text) in [("NFC", nfc(w)), ("NFD", nfd(w))] {
                let got = stems(&text, Lang::Cs);
                if got != vec![want.to_string()] {
                    bad.push(format!("{w} ({form}): {got:?}, want [{want}]"));
                }
            }
        }
    }
    assert_eq!(bad, Vec::<String>::new(), "R179 rules 2–6 give exactly one stem per spelling");
}

// ------------------------------------------------------------------------------------------------ FR-LNK-15 AC-2

#[test]
fn fr_lnk_15_ac2_czech_stemmer_golden_list() {
    let path = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../tests/fixtures/format/stem/cs.tsv");
    let text = std::fs::read_to_string(&path).unwrap_or_default();
    assert!(!text.is_empty(), "tests/fixtures/format/stem/cs.tsv is readable");
    let mut lines = text.lines();
    assert_eq!(lines.next(), Some("word\tstem\tnote"), "the first line is the header word<TAB>stem<TAB>note");
    let mut rows = 0usize;
    let mut bad = Vec::new();
    for (i, line) in lines.enumerate() {
        let n = i + 2;
        let cols: Vec<&str> = line.split('\t').collect();
        assert!(
            (cols.len() == 2 || cols.len() == 3) && !cols[0].is_empty() && !cols[1].is_empty(),
            "row {n} is word<TAB>stem or word<TAB>stem<TAB>note: {line:?}"
        );
        rows += 1;
        let (word, want) = (cols[0], cols[1]);
        let a = stem_cs(&fold(word));
        let b = stem_cs(&fold(&nfd(word)));
        if a != want || b != want {
            bad.push(format!("row {n} {word}: stem_cs(fold) = {a:?}, stem_cs(fold(nfd)) = {b:?}, want {want:?}"));
        }
    }
    assert!(rows >= 300, "the golden list has at least 300 rows (got {rows})");
    assert_eq!(bad, Vec::<String>::new(), "every golden row passes (D-1691; AP-1467, AP-1468 rows as decided)");
}

// ------------------------------------------------------------------------------------------------ FR-LNK-15 AC-4

/// Snowball's English stop-word list without the entries holding an apostrophe (contract §1.3).
const SNOWBALL_EN: &str = "i me my myself we our ours ourselves you your yours yourself yourselves he him his himself she her hers herself \
it its itself they them their theirs themselves what which who whom this that these those am is are was were be been being have has had \
having do does did doing would should could ought cannot a an the and but if or because as until while of at by for with about against \
between into through during before after above below to from up down in out on off over under again further then once here there when \
where why how all any both each few more most other some such no nor not only own same so than too very";

const CS_MINIMUM: &str = "a ale aby by do i je jak jeho jen jeste jsem jsou k ke ktera ktere ktery na ne o od po pro protoze s se si ta to u uz v ve z za ze";

#[test]
fn fr_lnk_15_ac4_stop_words_numbers_and_short_stems() {
    for lang in [Lang::Cs, Lang::En] {
        for text in ["který ktery KTERÝ protože protoze ještě jeste", "the and with from", "10 2027 27. 11.", "den", "řeka"] {
            assert_eq!(stems(text, lang), Vec::<String>::new(), "{lang:?}: no stem for {text:?}");
            assert_eq!(stems(&nfd(text), lang), Vec::<String>::new(), "{lang:?}: no stem for {text:?} in NFD bytes");
        }
    }
    // `den` → `dn` and `řeka` → `rk` are the stemmer's answers; the pipeline drops them for being under 3 characters.
    assert_eq!((stem_cs("den"), stem_cs("reka")), ("dn".to_string(), "rk".to_string()), "the golden list's short stems");
    assert_eq!(stems("Koupit mléko a chleba.", Lang::Cs), v(&["koupit", "mlk", "chlb"]), "Koupit mléko a chleba. gives exactly koupit, mlk, chlb");
    let cs: BTreeSet<&str> = stop_words(Lang::Cs).iter().copied().collect();
    let missing: Vec<&str> = CS_MINIMUM.split(' ').filter(|w| !cs.contains(w) || !is_stop_word(w)).collect();
    assert_eq!(missing, Vec::<&str>::new(), "the Czech list holds AC-4's minimum, folded");
    let en: BTreeSet<&str> = stop_words(Lang::En).iter().copied().collect();
    let want: BTreeSet<&str> = SNOWBALL_EN.split_whitespace().collect();
    assert_eq!(en, want, "the English list is Snowball's English list (without apostrophe entries)");
    for lang in [Lang::Cs, Lang::En] {
        let l = stop_words(lang);
        assert!(l.windows(2).all(|w| w[0] < w[1]), "{lang:?}: sorted, no duplicates");
        assert!(l.iter().all(|w| fold(w) == *w), "{lang:?}: every word folded");
    }
}

// ------------------------------------------------------------------------------------------------ FR-LNK-15 AC-6 (L1)

#[test]
fn fr_lnk_15_ac6_language_per_note_and_english_stems() {
    let pairs = [
        ("hiking", "hike"), ("planning", "plan"), ("planned", "plan"), ("mountains", "mountain"), ("boots", "boot"), ("trails", "trail"),
        ("meetings", "meet"), ("budgets", "budget"), ("budgeting", "budget"),
    ];
    let bad: Vec<String> = pairs.iter().filter(|(w, s)| stem_en(w) != *s).map(|(w, s)| format!("{w} → {:?}, want {s}", stem_en(w))).collect();
    assert_eq!(bad, Vec::<String>::new(), "the Snowball English stemmer");
    // The runtime text `Budgets about meetings.`: 1 English stop word, so Czech, and `budgets` stays `budgets`.
    let words: Vec<String> = fold("Budgets about meetings.").split(|c: char| !c.is_alphanumeric()).filter(|w| !w.is_empty()).map(str::to_string).collect();
    assert_eq!(language_of(&words), Lang::Cs, "Budgets about meetings. is Czech (1 English stop word)");
    let row = rel_row("", &[], "Budgets about meetings.", &[]);
    assert_eq!(row.lang, Lang::Cs, "its rel row is Czech");
    assert!(row.body.contains(&"budgets".to_string()) && !row.body.contains(&"budget".to_string()), "budgets stays budgets: {:?}", row.body);
    // Three English stop words, more than Czech ones: English.
    let en: Vec<String> = fold("Notes from the trail with the boots").split(' ').map(str::to_string).collect();
    assert_eq!(language_of(&en), Lang::En, "≥ 3 English-only stop words and more than Czech ones: English");
    // Words in both lists are ignored by the count (`a`, `to`, `do`, `on`).
    let both: Vec<String> = v(&["a", "to", "do", "on", "kytara"]);
    assert_eq!(language_of(&both), Lang::Cs, "words in both lists don't count");
}

// ------------------------------------------------------------------------------------------------ FR-LNK-15 AC-13 (L1)

#[test]
fn fr_lnk_15_ac13_floor_shared_stems_and_relative_score() {
    let p = RelatedParams::default();
    assert_eq!(
        (p.min_stems, p.min_shared, p.min_relative, p.max_entries, p.signature_size, p.df_ceiling, p.df_floor),
        (5, 3, 0.35, 10, 25, 0.10, 2),
        "RelatedParams' numbers (R181 rule 8, D-1731)"
    );
    assert_eq!(cut_off(&[(3.6, 3)], 10.0, &p), vec![0], "best 10.0: (3.6, 3 shared) is kept");
    assert_eq!(cut_off(&[(3.4, 6)], 10.0, &p), Vec::<usize>::new(), "(3.4, 6 shared) is dropped (under 35 %)");
    assert_eq!(cut_off(&[(9.0, 2)], 10.0, &p), Vec::<usize>::new(), "(9.0, 2 shared) is dropped (under 3 shared)");
    assert_eq!(cut_off(&[(9.0, 2), (3.6, 3), (3.4, 6)], 10.0, &p), vec![1], "mixed: only the second is kept");
    let eleven: Vec<(f64, usize)> = (0..11).map(|i| (10.0 - i as f64 * 0.1, 3)).collect();
    assert_eq!(cut_off(&eleven, 10.0, &p), (0..10).collect::<Vec<usize>>(), "11 qualifying entries: the first 10 are kept");
}

// ------------------------------------------------------------------------------------------------ FR-LNK-15 AC-18

fn tc(title: u32, heading: u32, body: u32) -> TermCounts {
    TermCounts { title, heading, body }
}

#[test]
fn fr_lnk_15_ac18_signature_weights_skips_and_ties() {
    let p = RelatedParams::default();
    let n = 40; // the ceiling is df > max(4, 2) = 4
    // (1) 30 eligible stems, two tied at the 25th place: the smaller stem in code-point order is kept.
    let mut terms = BTreeMap::new();
    for i in 0..24u32 {
        terms.insert(format!("x{i:02}"), tc(0, 0, 50 - i));
    }
    terms.insert("tie_b".to_string(), tc(0, 0, 10));
    terms.insert("tie_a".to_string(), tc(0, 0, 10));
    for i in 0..4u32 {
        terms.insert(format!("y{i}"), tc(0, 0, 1 + i));
    }
    let sig = signature(&terms, &|_s: &str| 2, n, &p);
    let mut want: Vec<String> = (0..24).map(|i| format!("x{i:02}")).collect();
    want.push("tie_a".to_string());
    assert_eq!(sig.iter().map(|(s, _)| s.clone()).collect::<Vec<_>>(), want, "the 25 highest by tf·idf; the tie at the cut keeps tie_a");
    let w0 = sig.first().map(|x| x.1).unwrap_or(0.0);
    assert!((w0 - 50.0 * (20.0f64).ln()).abs() < 1e-9, "weight = tf × ln(N / df): {w0}");
    // (2) Title occurrences count 3, headings 2, body 1.
    let mut t2 = BTreeMap::new();
    t2.insert("tstem".to_string(), tc(1, 0, 0));
    t2.insert("bstem".to_string(), tc(0, 0, 2));
    t2.insert("hstem".to_string(), tc(0, 1, 0));
    t2.insert("cstem".to_string(), tc(0, 0, 1));
    let s2: Vec<String> = signature(&t2, &|_s: &str| 3, n, &p).into_iter().map(|x| x.0).collect();
    let pos = |s: &str| s2.iter().position(|x| x == s).unwrap_or(usize::MAX);
    assert_eq!(s2.len(), 4, "all four stems are in the signature: {s2:?}");
    assert!(pos("tstem") < pos("bstem"), "a stem once in the title (tf 3) outranks one twice in the body (tf 2): {s2:?}");
    assert!(pos("hstem") < pos("cstem"), "a heading stem (tf 2) outranks a body stem with tf 1: {s2:?}");
    // (3) df 4 kept, df 5 and df 1 skipped; skipped stems never take a place among the 25.
    let mut t3 = BTreeMap::new();
    for i in 0..24u32 {
        t3.insert(format!("k{i:02}"), tc(0, 0, 1));
    }
    t3.insert("d4".to_string(), tc(0, 0, 1));
    t3.insert("d5".to_string(), tc(5, 5, 100));
    t3.insert("d1".to_string(), tc(5, 5, 100));
    let df = |s: &str| match s {
        "d4" => 4,
        "d5" => 5,
        "d1" => 1,
        _ => 2,
    };
    let s3 = signature(&t3, &df, n, &p);
    let got: BTreeSet<String> = s3.iter().map(|x| x.0.clone()).collect();
    let mut want3: BTreeSet<String> = (0..24).map(|i| format!("k{i:02}")).collect();
    want3.insert("d4".to_string());
    assert_eq!(got, want3, "df 4 kept; df 5 and df 1 skipped before the top 25 are taken");
    let d4 = s3.iter().find(|x| x.0 == "d4").map(|x| x.1).unwrap_or(0.0);
    assert!((d4 - (10.0f64).ln()).abs() < 1e-9, "d4's weight is 1 × ln(40 / 4): {d4}");
    // D-1731: in a small vault the ceiling never goes below 2 objects.
    let mut t4 = BTreeMap::new();
    t4.insert("maly".to_string(), tc(0, 0, 1));
    assert_eq!(signature(&t4, &|_s: &str| 2, 8, &p).len(), 1, "N = 8: a stem in 2 objects is kept (max(0.8, 2) = 2)");
    assert_eq!(signature(&t4, &|_s: &str| 3, 8, &p).len(), 0, "N = 8: a stem in 3 objects is skipped");
}

// ------------------------------------------------------------------------------------------------ FR-LNK-15 AC-20 (L1)

#[test]
fn fr_lnk_15_ac20_excerpt_is_the_most_relevant_sentence_as_written() {
    let one = "Do pá 27. 11. musí návrh rozpočtu na offsite projít přes finance, Jana ho podepíše.";
    assert_eq!(sentences(one), vec![one], "Do pá 27. 11. musí … is one sentence");
    let kniha = "Praha je daleko, ale ta kniha je blízko. Domek stojí u silnice a potok teče kolem. Matka drží hrnek, ruka se jí třese. Zelený plot.";
    assert_eq!(
        sentences(kniha),
        vec!["Praha je daleko, ale ta kniha je blízko.", "Domek stojí u silnice a potok teče kolem.", "Matka drží hrnek, ruka se jí třese.", "Zelený plot."],
        "four sentences"
    );
    assert_eq!(sentences("Napsal: \"Hotovo.\" Pak odešel."), vec!["Napsal: \"Hotovo.\"", "Pak odešel."], "a closing quote stays with its sentence");
    assert_eq!(sentences("Uvidíme… Možná zítra!! Proč? Řekni."), vec!["Uvidíme…", "Možná zítra!!", "Proč?", "Řekni."], "… ! ? end sentences");
    assert_eq!(sentences("Viz str. 5 a dál. a pak nic."), vec!["Viz str. 5 a dál. a pak nic."], "no split before a lower-case letter or a digit");
    assert_eq!(sentences("(Pozor.) Další věta."), vec!["(Pozor.)", "Další věta."], "a closing bracket stays with its sentence");

    let body = "# Nadpis **tučně**\n\nOdstavec s *kurzívou*, [[Cíl|aliasem]] a [[Jiný cíl#Oddíl]] a [text](https://example.com). ^blok1\n\n\
- [ ] Úkol v seznamu\n- Druhá položka\n\n> Citace řádek\n\n> [!note] Titulek calloutu\n> Text calloutu.\n\n> [!mindmap]\n> - Uzel mapy\n\n\
| Sloupec A | Sloupec B |\n| --- | --- |\n| jedna | dvě |\n\n```js\nkódový řádek\n```\n\n    odsazený kód\n\n$$\nx^2\n$$\n\n%%komentář%%\n\n\
<div>HTML blok</div>\n\n![[Obrázek.png]]\n\n```query\nsaved: Něco\n```\n";
    let blocks = tegg_format::plain::plain_blocks(body);
    for want in ["Nadpis tučně", "Odstavec s kurzívou, aliasem a Jiný cíl a text.", "Úkol v seznamu", "Druhá položka", "Citace řádek", "Sloupec A · Sloupec B", "jedna · dvě"] {
        assert!(blocks.iter().any(|b| b == want), "plain_blocks has the block {want:?}: {blocks:?}");
    }
    assert!(blocks.iter().any(|b| b.contains("Titulek calloutu")) && blocks.iter().any(|b| b.contains("Text calloutu.")), "callout title and text count: {blocks:?}");
    for gone in ["kódový", "odsazený", "x^2", "komentář", "HTML", "Obrázek", "saved", "Uzel mapy", "^blok1", "**", "[[", "](", "- [ ]"] {
        assert!(blocks.iter().all(|b| !b.contains(gone)), "no block holds {gone:?}: {blocks:?}");
    }
    assert_eq!(tegg_format::plain::plain_blocks(&nfd("Žluťoučký kůň úpěl.\n")), vec![nfc("Žluťoučký kůň úpěl.")], "plain text is NFC");
}
