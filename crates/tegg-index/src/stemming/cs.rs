//! R180 (D-1680, D-1682, D-1691, D-1714, D-1715): Dolamic and Savoy's light Czech stemmer (Lucene's `CzechStemmer`)
//! on folded text. The rule set is exactly `tests/fixtures/format/stem/README.md` §"The rule set": three steps in
//! order, the first matching rule of a step wins; rule 3.5 (D-1715) included, Lucene's `ů → o` excluded (D-1714).
//! Lengths are Unicode scalar values. Pure, total, never panics.

/// Step 1, by condition: (minimum length exclusive, endings, characters removed).
const CASES: [(usize, &[&str], usize); 4] = [
    (7, &["atech"], 5),
    (6, &["etem", "atum"], 4),
    (
        5,
        &["ech", "ich", "eho", "emi", "emu", "ete", "eti", "iho", "imi", "imu", "ach", "ata", "aty", "ych", "ama", "ami", "ove", "ovi", "ymi"],
        3,
    ),
    (4, &["em", "es", "im", "um", "at", "am", "os", "us", "ym", "mi", "ou"], 2),
];

fn ends_with(w: &[char], suffix: &str) -> bool {
    let s: Vec<char> = suffix.chars().collect();
    w.len() >= s.len() && w[w.len() - s.len()..] == s[..]
}

fn remove_case(w: &mut Vec<char>) {
    let len = w.len();
    for (min, endings, n) in CASES {
        if len > min && endings.iter().any(|e| ends_with(w, e)) {
            w.truncate(len - n);
            return;
        }
    }
    if len > 3 && matches!(w[len - 1], 'a' | 'e' | 'i' | 'o' | 'u' | 'y') {
        w.truncate(len - 1);
    }
}

fn remove_possessive(w: &mut Vec<char>) {
    if w.len() > 5 && ["ov", "in", "uv"].iter().any(|e| ends_with(w, e)) {
        w.truncate(w.len() - 2);
    }
}

/// Rules 3.1 and 3.2: `ct` → `ck`, `st` → `sk`. True when one ran.
fn ct_st(w: &mut [char]) -> bool {
    let len = w.len();
    if ends_with(w, "ct") || ends_with(w, "st") {
        w[len - 1] = 'k';
        return true;
    }
    false
}

fn normalize(w: &mut Vec<char>) {
    if w.is_empty() || ct_st(w) {
        return;
    }
    let len = w.len();
    match w[len - 1] {
        'c' => {
            w[len - 1] = 'k';
            return;
        }
        'z' => {
            w[len - 1] = 'h';
            return;
        }
        _ => {}
    }
    if len > 1 && w[len - 2] == 'e' {
        w.remove(len - 2);
        // Rule 3.5 (AP-1468 → D-1715): `rozpocet` → `rozpoct` → `rozpock`.
        ct_st(w);
    }
}

/// R180: the stem of one folded word.
pub fn stem(word: &str) -> String {
    let mut w: Vec<char> = word.chars().collect();
    remove_case(&mut w);
    remove_possessive(&mut w);
    normalize(&mut w);
    w.into_iter().collect()
}
