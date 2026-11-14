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

// Every ending is ASCII, so a matched ending is removed by its byte length; lengths are compared in characters.

fn remove_case(w: &mut String, len: usize) -> usize {
    for (min, endings, n) in CASES {
        if len > min && endings.iter().any(|e| w.ends_with(e)) {
            w.truncate(w.len() - n);
            return len - n;
        }
    }
    if len > 3 && w.ends_with(['a', 'e', 'i', 'o', 'u', 'y']) {
        w.pop();
        return len - 1;
    }
    len
}

fn remove_possessive(w: &mut String, len: usize) -> usize {
    if len > 5 && ["ov", "in", "uv"].iter().any(|e| w.ends_with(e)) {
        w.truncate(w.len() - 2);
        return len - 2;
    }
    len
}

/// Rules 3.1 and 3.2: `ct` → `ck`, `st` → `sk`. True when one ran.
fn ct_st(w: &mut String) -> bool {
    if w.ends_with("ct") || w.ends_with("st") {
        w.pop();
        w.push('k');
        return true;
    }
    false
}

fn normalize(w: &mut String, len: usize) {
    if len == 0 || ct_st(w) {
        return;
    }
    if w.ends_with('c') {
        w.pop();
        w.push('k');
        return;
    }
    if w.ends_with('z') {
        w.pop();
        w.push('h');
        return;
    }
    let mut it = w.char_indices().rev();
    let (Some(_), Some((i, prev))) = (it.next(), it.next()) else { return };
    if prev == 'e' {
        w.remove(i);
        // Rule 3.5 (AP-1468 → D-1715): `rozpocet` → `rozpoct` → `rozpock`.
        ct_st(w);
    }
}

/// R180: the stem of one folded word.
pub fn stem(word: &str) -> String {
    let mut w = word.to_string();
    let len = w.chars().count();
    let len = remove_case(&mut w, len);
    let len = remove_possessive(&mut w, len);
    normalize(&mut w, len);
    w
}
