//! Quick switcher (NFR-PERF-03): in-memory, diacritics- and case-insensitive matching on titles,
//! aliases and file names. 5,000–20,000 entries fit in a few MB; a linear scan per keystroke is
//! simpler than an index and fast enough (measured in FINDINGS.md).

use std::collections::BTreeMap;

use unicode_normalization::char::is_combining_mark;
use unicode_normalization::UnicodeNormalization;

/// "Žluťoučký Kůň" → "zlutoucky kun": NFD, marks dropped, lower case.
pub fn fold(s: &str) -> String {
    s.nfd().filter(|c| !is_combining_mark(*c)).flat_map(char::to_lowercase).collect()
}

#[derive(Default)]
pub struct Switcher {
    /// path → (title, folded names: title, aliases, file stem)
    entries: BTreeMap<String, (String, Vec<String>)>,
}

impl Switcher {
    pub fn upsert(&mut self, path: &str, title: &str, aliases: &[String]) {
        let stem = path.rsplit('/').next().unwrap_or(path).trim_end_matches(".md");
        let mut names = vec![fold(title)];
        names.extend(aliases.iter().map(|a| fold(a)));
        let s = fold(stem);
        if !names.contains(&s) {
            names.push(s);
        }
        self.entries.insert(path.to_string(), (title.to_string(), names));
    }

    pub fn remove(&mut self, path: &str) {
        self.entries.remove(path);
    }

    pub fn len(&self) -> usize {
        self.entries.len()
    }

    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    pub fn entries(&self) -> Vec<(&String, &String)> {
        self.entries.iter().map(|(p, (t, _))| (p, t)).collect()
    }

    /// Best `limit` matches: exact > prefix > word prefix > substring > in-order letters
    /// (fuzzy), then shorter names, then path. Returns paths.
    pub fn query(&self, q: &str, limit: usize) -> Vec<&str> {
        let q = fold(q.trim());
        if q.is_empty() {
            return vec![];
        }
        let mut scored: Vec<(u32, usize, &str)> = Vec::new();
        for (path, (_, names)) in &self.entries {
            let best = names.iter().filter_map(|n| score(n, &q).map(|s| (s, n.len()))).min();
            if let Some((s, len)) = best {
                scored.push((s, len, path));
            }
        }
        if scored.len() > limit {
            scored.select_nth_unstable(limit);
            scored.truncate(limit);
        }
        scored.sort_unstable();
        scored.into_iter().map(|(_, _, p)| p).collect()
    }
}

fn score(name: &str, q: &str) -> Option<u32> {
    if name == q {
        return Some(0);
    }
    if name.starts_with(q) {
        return Some(1);
    }
    if let Some(i) = name.find(q) {
        let word_start = name[..i].ends_with([' ', '-', '_', '/', '(']);
        return Some(if word_start { 2 } else { 3 });
    }
    // In-order letters: "qtpl" matches "q3 plan". Penalty grows with gaps.
    let mut gaps = 0u32;
    let mut it = name.chars();
    for qc in q.chars() {
        let mut skipped = 0;
        loop {
            match it.next() {
                Some(c) if c == qc => break,
                Some(_) => skipped += 1,
                None => return None,
            }
        }
        gaps += skipped.min(20);
    }
    Some(10 + gaps)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nfr_perf_03_matches_without_diacritics_and_case() {
        let mut s = Switcher::default();
        s.upsert("Books/Žluťoučký kůň.md", "Žluťoučký kůň", &[]);
        s.upsert("Pages/Kun a vuz.md", "Kun a vuz", &["Koník".into()]);
        assert_eq!(s.query("kun", 10), vec!["Pages/Kun a vuz.md", "Books/Žluťoučký kůň.md"]);
        assert_eq!(s.query("ZLUT", 10), vec!["Books/Žluťoučký kůň.md"]);
        assert_eq!(s.query("koni", 10), vec!["Pages/Kun a vuz.md"]);
        assert_eq!(s.query("zk", 10), vec!["Books/Žluťoučký kůň.md"]);
    }
}
