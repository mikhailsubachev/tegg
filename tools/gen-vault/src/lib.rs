//! Deterministic reference vault (docs/acceptance/performance.md "Reference vault", D-59).
//!
//! Same seed and options → byte-identical files (S4-QA AC-1). The generator uses its own
//! PRNG (SplitMix64) and no hash-ordered collections, so output can't drift with a
//! dependency upgrade. All text is synthetic (D-62).

use std::fs;
use std::io;
use std::path::Path;

/// SplitMix64: tiny, fast, stable forever.
pub struct Rng(u64);

impl Rng {
    pub fn new(seed: u64) -> Self {
        Rng(seed ^ 0x5445_4747_5f56_4c54) // "TEGG_VLT"
    }
    pub fn next_u64(&mut self) -> u64 {
        self.0 = self.0.wrapping_add(0x9e37_79b9_7f4a_7c15);
        let mut z = self.0;
        z = (z ^ (z >> 30)).wrapping_mul(0xbf58_476d_1ce4_e5b9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94d0_49bb_1331_11eb);
        z ^ (z >> 31)
    }
    /// Uniform in `lo..=hi`.
    pub fn range(&mut self, lo: usize, hi: usize) -> usize {
        lo + (self.next_u64() % (hi - lo + 1) as u64) as usize
    }
    /// True with probability `p` percent.
    pub fn pct(&mut self, p: u64) -> bool {
        self.next_u64() % 100 < p
    }
    pub fn pick<'a, T>(&mut self, xs: &'a [T]) -> &'a T {
        &xs[self.range(0, xs.len() - 1)]
    }
    pub fn fill(&mut self, buf: &mut [u8]) {
        for chunk in buf.chunks_mut(8) {
            let v = self.next_u64().to_le_bytes();
            chunk.copy_from_slice(&v[..chunk.len()]);
        }
    }
}

pub struct Options {
    pub seed: u64,
    pub notes: usize,
    pub images: usize,
    pub tags: usize,
    /// Real image sizes (100 KB–3 MB). Off = 1 KB images, for fast tests; Markdown is unchanged.
    pub full_images: bool,
}

impl Options {
    /// The reference vault from performance.md.
    pub fn reference(seed: u64) -> Self {
        Options { seed, notes: 5000, images: 2000, tags: 200, full_images: true }
    }
}

const CS: &[&str] = &[
    "příliš", "žluťoučký", "kůň", "úpěl", "ďábelské", "ódy", "řeka", "město", "schůzka", "úkol",
    "rozpočet", "plán", "čtení", "kniha", "nápad", "cesta", "léto", "zima", "práce", "domov",
    "přítel", "kolega", "návrh", "zpráva", "otázka", "odpověď", "důvod", "výsledek", "změna", "systém",
    "zpětná", "vazba", "smyčka", "učení", "paměť", "poznámka", "škola", "hřiště", "jídlo", "večeře",
    "snídaně", "počítač", "telefon", "dopis", "cíl", "krok", "týden", "měsíc", "rok", "ráno",
    "večer", "noc", "den", "hodina", "chvíle", "čas", "prostor", "světlo", "tma", "voda",
    "oheň", "země", "vzduch", "strom", "les", "hora", "údolí", "most", "silnice", "vlak",
    "letadlo", "loď", "moře", "pláž", "písek", "kámen", "zlato", "stříbro", "železo", "dřevo",
    "a", "v", "na", "s", "že", "je", "to", "se", "do", "pro", "jako", "ale", "nebo", "když", "který",
    "velký", "malý", "nový", "starý", "dobrý", "špatný", "rychlý", "pomalý", "důležitý", "jednoduchý",
];
const EN: &[&str] = &[
    "budget", "review", "meeting", "notes", "project", "plan", "draft", "idea", "feedback", "loop",
    "system", "thinking", "reading", "book", "chapter", "summary", "question", "answer", "reason", "result",
    "change", "design", "process", "team", "week", "month", "quarter", "goal", "step", "task",
    "river", "city", "trip", "summer", "winter", "work", "home", "friend", "colleague", "report",
    "memory", "learning", "school", "dinner", "breakfast", "computer", "phone", "letter", "morning", "evening",
    "the", "a", "of", "and", "to", "in", "is", "for", "with", "on", "that", "this", "it", "as", "by",
    "big", "small", "new", "old", "good", "bad", "fast", "slow", "important", "simple",
    "café", "naïve", "résumé", "Zürich", "Kraków", "Málaga", "São", "Paulo", "Ångström", "façade",
];

struct TypeDef {
    name: &'static str,
    folder: &'static str,
    attrs: &'static [&'static str],
}

/// 12 types (performance.md): the system types plus seven user types.
const TYPES: &[TypeDef] = &[
    TypeDef { name: "Page", folder: "Pages", attrs: &["status", "source", "rating"] },
    TypeDef { name: "Task", folder: "Tasks", attrs: &["status", "priority", "due", "project", "done"] },
    TypeDef { name: "Quick Note", folder: "Quick Notes", attrs: &["source"] },
    TypeDef { name: "Daily Note", folder: "Daily", attrs: &["mood", "rating"] },
    TypeDef { name: "Person", folder: "People", attrs: &["company", "role", "birthday", "city"] },
    TypeDef { name: "Book", folder: "Books", attrs: &["author", "rating", "started", "finished", "status", "pages"] },
    TypeDef { name: "Meeting", folder: "Meetings", attrs: &["date", "people", "project", "location"] },
    TypeDef { name: "Project", folder: "Projects", attrs: &["status", "priority", "due", "budget", "people", "stage"] },
    TypeDef { name: "Idea", folder: "Ideas", attrs: &["stage", "rating", "source"] },
    TypeDef { name: "Trip", folder: "Trips", attrs: &["start", "end", "city", "people", "budget"] },
    TypeDef { name: "Article", folder: "Articles", attrs: &["author", "source", "rating", "status"] },
    TypeDef { name: "Recipe", folder: "Recipes", attrs: &["cuisine", "time", "rating", "servings"] },
];
/// Share of notes per type, in percent (sums to 100).
const TYPE_WEIGHTS: &[u64] = &[18, 15, 10, 8, 8, 6, 9, 5, 7, 4, 6, 4];

struct Note {
    ty: usize,
    title: String,
    file: String,
}

fn words(rng: &mut Rng, cs: bool, n: usize) -> Vec<&'static str> {
    (0..n).map(|_| *rng.pick(if cs { CS } else { EN })).collect()
}

fn words_n(rng: &mut Rng, cs: bool, lo: usize, hi: usize) -> Vec<&'static str> {
    let n = rng.range(lo, hi);
    words(rng, cs, n)
}

fn capitalize(s: &str) -> String {
    let mut c = s.chars();
    match c.next() {
        Some(f) => f.to_uppercase().chain(c).collect(),
        None => String::new(),
    }
}

/// `2026-01-01` + `day` days, as YYYY-MM-DD (FR-FMT-11). Civil-from-days, no dependencies.
pub fn date(day: i64) -> String {
    let z = 20454 + day + 719468; // 20454 = days from 1970-01-01 to 2026-01-01
    let era = z.div_euclid(146097);
    let doe = z - era * 146097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + if m <= 2 { 1 } else { 0 };
    format!("{y:04}-{m:02}-{d:02}")
}

fn id(rng: &mut Rng) -> String {
    let (a, b) = (rng.next_u64(), rng.next_u64());
    format!(
        "{:08x}-{:04x}-4{:03x}-{:04x}-{:012x}",
        a >> 32,
        (a >> 16) & 0xffff,
        a & 0xfff,
        0x8000 | (b >> 48) & 0x3fff,
        b & 0xffff_ffff_ffff
    )
}

fn yaml_str(s: &str) -> String {
    let mut o = String::from("\"");
    for c in s.chars() {
        match c {
            '"' => o.push_str("\\\""),
            '\\' => o.push_str("\\\\"),
            _ => o.push(c),
        }
    }
    o.push('"');
    o
}

/// Generates the vault into `out` (must be empty or missing). Returns the number of files.
pub fn generate(out: &Path, o: &Options) -> io::Result<usize> {
    let mut rng = Rng::new(o.seed);
    let mut count = 0;

    // 1. Tags and titles first, so links can point at any note.
    let tags: Vec<String> = (0..o.tags)
        .map(|i| {
            let cs = i % 2 == 0;
            let w = words(&mut rng, cs, 2);
            format!("{}-{}{}", w[0], w[1], i).to_lowercase()
        })
        .collect();

    let mut taken = std::collections::BTreeSet::new();
    let mut notes: Vec<Note> = Vec::with_capacity(o.notes);
    let mut daily = 0i64;
    for _ in 0..o.notes {
        let mut r = rng.range(0, 99) as u64;
        let ty = TYPE_WEIGHTS.iter().position(|w| if r < *w { true } else { r -= w; false }).unwrap();
        let mut title = if TYPES[ty].name == "Daily Note" {
            daily += 1;
            date(daily - 1)
        } else {
            let cs = rng.pct(50);
            let n = rng.range(2, 5);
            let w = words(&mut rng, cs, n);
            capitalize(&w.join(" "))
        };
        // Same title twice → " (2)" … (FR-LNK-14); links use the file name to stay unambiguous.
        let base = title.clone();
        let mut k = 2;
        while !taken.insert(title.to_lowercase()) {
            title = format!("{base} ({k})");
            k += 1;
        }
        let file = format!("{}/{}.md", TYPES[ty].folder, title);
        notes.push(Note { ty, title, file });
    }

    // 2. Images: attachment + Image object (FR-ATT-07).
    fs::create_dir_all(out.join("_attachments"))?;
    fs::create_dir_all(out.join("Images"))?;
    for i in 1..=o.images {
        let size = if o.full_images { rng.range(100_000, 3_000_000) } else { 1024 };
        fs::write(out.join(format!("_attachments/img-{i:04}.png")), png(&mut rng, size))?;
        let md = format!(
            "---\nid: {}\ntype: Image\ntitle: \"Image {i:04}\"\nfile: \"[[img-{i:04}.png]]\"\ncreated: {}T09:00:00+01:00\n---\n",
            id(&mut rng),
            date((i % 280) as i64)
        );
        fs::write(out.join(format!("Images/Image {i:04}.md")), md)?;
        count += 2;
    }

    // 3. Tag objects.
    fs::create_dir_all(out.join("Tags"))?;
    for t in &tags {
        fs::write(out.join(format!("Tags/{t}.md")), format!("---\nid: {}\ntype: Tag\ntitle: {t}\n---\n", id(&mut rng)))?;
        count += 1;
    }

    // 4. Notes.
    for t in TYPES {
        fs::create_dir_all(out.join(t.folder))?;
    }
    for i in 0..notes.len() {
        let md = note(&mut rng, o, &notes, &tags, i);
        fs::write(out.join(&notes[i].file), md)?;
        count += 1;
    }

    fs::create_dir_all(out.join(".tegg"))?;
    fs::write(out.join(".tegg/vault.yml"), format!("# generated by tools/gen-vault --seed {}\ndefault-type: Page\n", o.seed))?;
    Ok(count + 1)
}

fn attr_value(rng: &mut Rng, key: &str, notes: &[Note]) -> String {
    let person = |rng: &mut Rng| {
        let p = notes.iter().filter(|n| TYPES[n.ty].name == "Person").count();
        if p == 0 {
            return "\"[[Nobody]]\"".to_string();
        }
        let k = rng.range(0, p - 1);
        let n = notes.iter().filter(|n| TYPES[n.ty].name == "Person").nth(k).unwrap();
        yaml_str(&format!("[[{}]]", n.title))
    };
    match key {
        "status" => rng.pick(&["To do", "In progress", "Waiting", "Done", "Cancelled"]).to_string(),
        "priority" => rng.pick(&["High", "Medium", "Low", "None"]).to_string(),
        "stage" => rng.pick(&["seed", "draft", "review", "final"]).to_string(),
        "mood" => rng.pick(&["😀", "🙂", "😐", "🙁"]).to_string(),
        "due" | "date" | "started" | "finished" | "start" | "end" | "birthday" => date(rng.range(0, 400) as i64),
        "rating" | "servings" => rng.range(1, 5).to_string(),
        "pages" | "time" => rng.range(10, 900).to_string(),
        "budget" => format!("{}.{:02}", rng.range(100, 99_999), rng.range(0, 99)),
        "done" => rng.pick(&["true", "false"]).to_string(),
        "author" => person(rng),
        "people" => {
            let n = rng.range(1, 3);
            let ps: Vec<String> = (0..n).map(|_| person(rng)).collect();
            format!("[{}]", ps.join(", "))
        }
        "project" => {
            let ps: Vec<&Note> = notes.iter().filter(|n| TYPES[n.ty].name == "Project").collect();
            if ps.is_empty() { "\"\"".into() } else { yaml_str(&format!("[[{}]]", rng.pick(&ps).title)) }
        }
        "city" | "location" => rng.pick(&["Praha", "Brno", "Lisboa", "Zürich", "Kraków", "Ostrava", "Plzeň"]).to_string(),
        "cuisine" => rng.pick(&["česká", "italian", "thai", "mexican"]).to_string(),
        "company" | "role" | "source" => {
            let cs = rng.pct(50);
            let n = rng.range(1, 3);
            yaml_str(&words(rng, cs, n).join(" "))
        }
        _ => "\"\"".into(),
    }
}

fn note(rng: &mut Rng, o: &Options, notes: &[Note], tags: &[String], i: usize) -> String {
    let n = &notes[i];
    let t = &TYPES[n.ty];
    let cs = rng.pct(50);

    // Frontmatter.
    let mut fm = vec![
        format!("id: {}", id(rng)),
        format!("type: {}", t.name),
        format!("title: {}", yaml_str(&n.title)),
        format!("created: {}T{:02}:{:02}:00+02:00", date(rng.range(0, 280) as i64), rng.range(7, 22), rng.range(0, 59)),
    ];
    if rng.pct(40) {
        // 3–8 attributes: the type's own first, then generic extras.
        let k = rng.range(3, 8);
        let extras = ["source", "rating", "status", "city", "people", "due", "stage", "priority"];
        let mut keys: Vec<&str> = t.attrs.to_vec();
        for e in extras {
            if !keys.contains(&e) {
                keys.push(e);
            }
        }
        for key in keys.into_iter().take(k) {
            fm.push(format!("{key}: {}", attr_value(rng, key, notes)));
        }
    }
    if rng.pct(50) {
        let k = rng.range(1, 3);
        let ts: Vec<&str> = (0..k).map(|_| rng.pick(tags).as_str()).collect();
        fm.push(format!("tags: [{}]", ts.join(", ")));
    }

    // Body size: 60% short, 35% medium, 5% long.
    let r = rng.range(0, 99);
    let target = if r < 60 { rng.range(50, 300) } else if r < 95 { rng.range(300, 2000) } else { rng.range(2000, 5000) };

    // Links (3–10) and embeds (15% of notes, 1–3), spread over paragraphs.
    let mut inline: Vec<String> = (0..rng.range(3, 10))
        .map(|_| {
            let j = rng.range(0, notes.len() - 1);
            let name = notes[j].file.rsplit('/').next().unwrap().trim_end_matches(".md").to_string();
            match rng.range(0, 9) {
                0 => format!("[[{name}|{}]]", words(rng, cs, 1)[0]),
                1 => format!("[[{name}#{}]]", capitalize(words(rng, cs, 1)[0])),
                _ => format!("[[{name}]]"),
            }
        })
        .collect();
    let mut embeds: Vec<String> = Vec::new();
    if rng.pct(15) && o.images > 0 {
        for _ in 0..rng.range(1, 3) {
            embeds.push(format!("![[img-{:04}.png]]", rng.range(1, o.images)));
        }
    }
    for _ in 0..rng.range(0, 3) {
        inline.push(format!("#{}", rng.pick(tags)));
    }

    let mut body: Vec<String> = Vec::new();
    let mut written = 0;
    let mut block = 0;
    while written < target {
        block += 1;
        let kind = rng.range(0, 9);
        if block % 6 == 1 && block > 1 {
            body.push(format!("## {}", capitalize(&words_n(rng, cs, 1, 4).join(" "))));
            continue;
        }
        if kind == 0 {
            let items: Vec<String> = (0..rng.range(2, 6))
                .map(|_| {
                    let w = words_n(rng, cs, 3, 10);
                    written += w.len();
                    format!("- {}", w.join(" "))
                })
                .collect();
            body.push(items.join("\n"));
        } else if kind == 1 {
            let items: Vec<String> = (0..rng.range(2, 5))
                .map(|_| {
                    let w = words_n(rng, cs, 2, 8);
                    written += w.len();
                    format!("- [{}] {}", if rng.pct(30) { "x" } else { " " }, w.join(" "))
                })
                .collect();
            body.push(items.join("\n"));
        } else {
            let mut w: Vec<String> = words_n(rng, cs, 20, 80).into_iter().map(String::from).collect();
            written += w.len();
            w[0] = capitalize(&w[0]);
            if let Some(l) = inline.pop() {
                let at = rng.range(1, w.len() - 1);
                w.insert(at, l);
            }
            body.push(format!("{}.", w.join(" ")));
        }
        if let Some(e) = embeds.pop() {
            body.push(e);
        }
    }
    // Whatever didn't fit in a short note goes into a last paragraph.
    if !inline.is_empty() || !embeds.is_empty() {
        let mut tail = inline;
        tail.extend(embeds);
        body.push(format!("See {}", tail.join(" ")));
    }

    format!("---\n{}\n---\n\n{}\n", fm.join("\n"), body.join("\n\n"))
}

/// A valid PNG (1×1, opaque) padded with a private ancillary chunk to `size` bytes.
fn png(rng: &mut Rng, size: usize) -> Vec<u8> {
    fn chunk(out: &mut Vec<u8>, ty: &[u8; 4], data: &[u8]) {
        out.extend_from_slice(&(data.len() as u32).to_be_bytes());
        let start = out.len();
        out.extend_from_slice(ty);
        out.extend_from_slice(data);
        let crc = crc32(&out[start..]);
        out.extend_from_slice(&crc.to_be_bytes());
    }
    let mut out = vec![137, 80, 78, 71, 13, 10, 26, 10];
    chunk(&mut out, b"IHDR", &[0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0]);
    let mut pad = vec![0u8; size.saturating_sub(8 + 25 + 12 + 27 + 12)];
    rng.fill(&mut pad);
    chunk(&mut out, b"teGg", &pad);
    // zlib stream of one scanline: filter 0 + RGB, stored block.
    chunk(&mut out, b"IDAT", &[0x78, 0x01, 0x01, 0x04, 0x00, 0xfb, 0xff, 0x00, 0x48, 0x5c, 0xdc, 0x02, 0x70, 0x01, 0x81]);
    chunk(&mut out, b"IEND", &[]);
    out
}

fn crc32(data: &[u8]) -> u32 {
    let mut c = !0u32;
    for &b in data {
        c ^= b as u32;
        for _ in 0..8 {
            c = (c >> 1) ^ (0xedb8_8320 & (!(c & 1)).wrapping_add(1));
        }
    }
    !c
}

/// Stable digest of a directory tree (paths + bytes), for the byte-identity check.
pub fn tree_digest(root: &Path) -> io::Result<u64> {
    fn walk(dir: &Path, out: &mut Vec<std::path::PathBuf>) -> io::Result<()> {
        let mut entries: Vec<_> = fs::read_dir(dir)?.collect::<Result<_, _>>()?;
        entries.sort_by_key(|e| e.file_name());
        for e in entries {
            if e.file_type()?.is_dir() {
                walk(&e.path(), out)?;
            } else {
                out.push(e.path());
            }
        }
        Ok(())
    }
    let mut files = Vec::new();
    walk(root, &mut files)?;
    // FNV-1a over "path\0bytes\0" for every file.
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    let mut eat = |bytes: &[u8]| {
        for &b in bytes {
            h ^= b as u64;
            h = h.wrapping_mul(0x0100_0000_01b3);
        }
    };
    for f in files {
        eat(f.strip_prefix(root).unwrap().to_string_lossy().as_bytes());
        eat(&[0]);
        eat(&fs::read(&f)?);
        eat(&[0]);
    }
    Ok(h)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn small(seed: u64) -> Options {
        Options { seed, notes: 300, images: 20, tags: 30, full_images: false }
    }

    #[test]
    fn s4_qa_ac1_same_seed_is_byte_identical() {
        let (a, b) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
        generate(a.path(), &small(7)).unwrap();
        generate(b.path(), &small(7)).unwrap();
        assert_eq!(tree_digest(a.path()).unwrap(), tree_digest(b.path()).unwrap());
    }

    #[test]
    fn s4_qa_ac1_different_seed_differs() {
        let (a, b) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
        generate(a.path(), &small(7)).unwrap();
        generate(b.path(), &small(8)).unwrap();
        assert_ne!(tree_digest(a.path()).unwrap(), tree_digest(b.path()).unwrap());
    }

    #[test]
    fn dates_are_plain_iso() {
        assert_eq!(date(0), "2026-01-01");
        assert_eq!(date(58), "2026-02-28");
        assert_eq!(date(59), "2026-03-01");
        assert_eq!(date(365), "2027-01-01");
    }

    #[test]
    fn png_is_valid_and_sized() {
        let mut r = Rng::new(1);
        let p = png(&mut r, 100_000);
        assert_eq!(p.len(), 100_000);
        assert_eq!(&p[..8], &[137, 80, 78, 71, 13, 10, 26, 10]);
        assert_eq!(crc32(b"IEND"), 0xae42_6082);
    }
}
