//! MS6 slice 6A (docs/contracts/ms6-trash-media.md §3): media metadata from the bytes (§3.1), names and titles of a
//! new Image or PDF object (§3.3, D-617), the object's bytes (§3.5; twin of `@tegg/doc` `media.ts`) and adding a file
//! with its object (§3.4).

use std::hash::{BuildHasher, Hasher};
use std::time::{SystemTime, UNIX_EPOCH};

use tegg_format::{nfc, sanitize_file_stem, unique_file_name};
use tegg_vault::VaultError;

use crate::{Core, CoreError, CoreEvent, FileVersion};

/// D-621 (§11, AP-554): 200 MiB.
pub const MAX_MEDIA_BYTES: usize = 200 * 1024 * 1024;

/// §3.1: what the bytes are (R72's types only).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MediaInfo {
    pub media_type: &'static str,
    /// The usual extension without the dot (`png`, `jpg`, `gif`, `webp`, `heic`, `svg`, `pdf`).
    pub ext: &'static str,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub pages: Option<u32>,
}

/// §3.1: by magic bytes only; `None` = refused (`media.refused`).
pub fn media_info(b: &[u8]) -> Option<MediaInfo> {
    let info = |media_type, ext, wh: Option<(u32, u32)>| MediaInfo { media_type, ext, width: wh.map(|x| x.0), height: wh.map(|x| x.1), pages: None };
    if b.starts_with(&[0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a]) {
        let wh = (b.len() >= 24 && &b[12..16] == b"IHDR").then(|| (be32(&b[16..20]), be32(&b[20..24])));
        return Some(info("image/png", "png", wh));
    }
    if b.starts_with(&[0xff, 0xd8, 0xff]) {
        return Some(info("image/jpeg", "jpg", jpeg_size(b)));
    }
    if b.starts_with(b"GIF87a") || b.starts_with(b"GIF89a") {
        let wh = (b.len() >= 10).then(|| (u16::from_le_bytes([b[6], b[7]]) as u32, u16::from_le_bytes([b[8], b[9]]) as u32));
        return Some(info("image/gif", "gif", wh));
    }
    if b.len() >= 12 && &b[0..4] == b"RIFF" && &b[8..12] == b"WEBP" {
        return Some(info("image/webp", "webp", webp_size(b)));
    }
    if b.len() >= 12 && &b[4..8] == b"ftyp" && is_heic(b) {
        return Some(info("image/heic", "heic", find(b, b"ispe").and_then(|i| (b.len() >= i + 16).then(|| (be32(&b[i + 8..i + 12]), be32(&b[i + 12..i + 16]))))));
    }
    if b.starts_with(b"%PDF-") {
        return Some(MediaInfo { media_type: "application/pdf", ext: "pdf", width: None, height: None, pages: pdf_pages(b) });
    }
    if let Some(wh) = svg_root(b) {
        return Some(info("image/svg+xml", "svg", wh));
    }
    None
}

fn be32(b: &[u8]) -> u32 {
    u32::from_be_bytes([b[0], b[1], b[2], b[3]])
}

fn find(hay: &[u8], needle: &[u8]) -> Option<usize> {
    hay.windows(needle.len()).position(|w| w == needle)
}

fn is_heic(b: &[u8]) -> bool {
    let size = (be32(&b[0..4]) as usize).min(b.len());
    let brands = |x: &[u8]| matches!(x, b"heic" | b"heix" | b"mif1" | b"msf1");
    (8..size.saturating_sub(3)).step_by(4).any(|i| i != 12 && i + 4 <= size && brands(&b[i..i + 4])) || brands(&b[8..12])
}

/// SOFn's height and width; swapped when the EXIF orientation is 5…8.
fn jpeg_size(b: &[u8]) -> Option<(u32, u32)> {
    let mut i = 2;
    let mut orientation = 1;
    while i + 4 <= b.len() {
        if b[i] != 0xff {
            return None;
        }
        let m = b[i + 1];
        if m == 0xd8 || (0xd0..=0xd7).contains(&m) || m == 0x01 {
            i += 2;
            continue;
        }
        let len = u16::from_be_bytes([b[i + 2], b[i + 3]]) as usize;
        let seg = &b[(i + 4).min(b.len())..(i + 2 + len).min(b.len())];
        if m == 0xe1 && seg.starts_with(b"Exif\0\0") {
            orientation = exif_orientation(&seg[6..]).unwrap_or(1);
        }
        if matches!(m, 0xc0..=0xcf) && !matches!(m, 0xc4 | 0xc8 | 0xcc) && seg.len() >= 5 {
            let (h, w) = (u16::from_be_bytes([seg[1], seg[2]]) as u32, u16::from_be_bytes([seg[3], seg[4]]) as u32);
            return Some(if (5..=8).contains(&orientation) { (h, w) } else { (w, h) });
        }
        if m == 0xda {
            return None;
        }
        i += 2 + len;
    }
    None
}

fn exif_orientation(t: &[u8]) -> Option<u16> {
    let le = match t.get(0..2)? {
        b"II" => true,
        b"MM" => false,
        _ => return None,
    };
    let u16_at = |o: usize| t.get(o..o + 2).map(|x| if le { u16::from_le_bytes([x[0], x[1]]) } else { u16::from_be_bytes([x[0], x[1]]) });
    let u32_at = |o: usize| t.get(o..o + 4).map(|x| if le { u32::from_le_bytes([x[0], x[1], x[2], x[3]]) } else { u32::from_be_bytes([x[0], x[1], x[2], x[3]]) });
    let ifd = u32_at(4)? as usize;
    let n = u16_at(ifd)? as usize;
    (0..n).map(|k| ifd + 2 + k * 12).find(|&e| u16_at(e) == Some(0x0112)).and_then(|e| u16_at(e + 8))
}

fn webp_size(b: &[u8]) -> Option<(u32, u32)> {
    let c = b.get(12..16)?;
    let d = b.get(20..)?;
    match c {
        b"VP8L" if d.len() >= 5 && d[0] == 0x2f => {
            let bits = u32::from_le_bytes([d[1], d[2], d[3], d[4]]);
            Some(((bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1))
        }
        b"VP8 " if d.len() >= 10 => Some(((u16::from_le_bytes([d[6], d[7]]) & 0x3fff) as u32, (u16::from_le_bytes([d[8], d[9]]) & 0x3fff) as u32)),
        b"VP8X" if d.len() >= 10 => {
            let w = u32::from_le_bytes([d[4], d[5], d[6], 0]) + 1;
            let h = u32::from_le_bytes([d[7], d[8], d[9], 0]) + 1;
            Some((w, h))
        }
        _ => None,
    }
}

/// The root `/Pages` object's `/Count`, else the number of `/Type /Page` objects.
fn pdf_pages(b: &[u8]) -> Option<u32> {
    let t = String::from_utf8_lossy(b);
    let squash = |s: &str| s.split_whitespace().collect::<Vec<_>>().join(" ");
    let text = squash(&t);
    if let Some(i) = text.find("/Type /Pages") {
        let obj_start = text[..i].rfind("<<").unwrap_or(0);
        let rest = &text[obj_start..];
        let end = rest.find(">>").map(|e| e + obj_start).unwrap_or(text.len());
        let o = &text[obj_start..end];
        if let Some(c) = o.find("/Count ") {
            let n: String = o[c + 7..].chars().take_while(|c| c.is_ascii_digit()).collect();
            if let Ok(n) = n.parse() {
                return Some(n);
            }
        }
    }
    let n = text.match_indices("/Type /Page").filter(|(i, _)| !text[i + 11..].starts_with('s')).count();
    (n > 0).then_some(n as u32)
}

/// SVG: the first element after the XML declaration, comments and doctype is `<svg`; its size from plain or `px`
/// `width`/`height`, else `viewBox`.
fn svg_root(b: &[u8]) -> Option<Option<(u32, u32)>> {
    let t = std::str::from_utf8(b).ok()?;
    let mut s = t.trim_start_matches('\u{feff}').trim_start();
    loop {
        if let Some(r) = s.strip_prefix("<?") {
            s = r.split_once("?>")?.1.trim_start();
        } else if let Some(r) = s.strip_prefix("<!--") {
            s = r.split_once("-->")?.1.trim_start();
        } else if s.starts_with("<!") {
            s = s.split_once('>')?.1.trim_start();
        } else {
            break;
        }
    }
    let rest = s.strip_prefix("<svg")?;
    if !rest.starts_with(|c: char| c.is_whitespace() || c == '>' || c == '/') {
        return None;
    }
    let tag = rest.split_once('>').map(|(a, _)| a).unwrap_or(rest);
    let attr = |name: &str| -> Option<String> {
        let mut from = 0;
        while let Some(i) = tag[from..].find(name) {
            let at = from + i;
            let before = tag[..at].chars().last();
            let after = tag[at + name.len()..].trim_start();
            if before.is_some_and(|c| c.is_whitespace()) && after.starts_with('=') {
                let v = after[1..].trim_start();
                let q = v.chars().next()?;
                if q == '"' || q == '\'' {
                    return v[1..].split_once(q).map(|(x, _)| x.to_string());
                }
            }
            from = at + name.len();
        }
        None
    };
    let num = |v: Option<String>| -> Option<u32> {
        let v = v?;
        let v = v.trim();
        let v = v.strip_suffix("px").unwrap_or(v).trim();
        v.parse::<f64>().ok().filter(|n| *n > 0.0).map(|n| n.round() as u32)
    };
    if let (Some(w), Some(h)) = (num(attr("width")), num(attr("height"))) {
        return Some(Some((w, h)));
    }
    let vb = attr("viewBox").map(|v| v.split(|c: char| c.is_whitespace() || c == ',').filter(|x| !x.is_empty()).filter_map(|x| x.parse::<f64>().ok()).collect::<Vec<_>>());
    Some(match vb {
        Some(v) if v.len() == 4 && v[2] > 0.0 && v[3] > 0.0 => Some((v[2].round() as u32, v[3].round() as u32)),
        _ => None,
    })
}

/// §3.3: the input of `media_names`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NameRequest {
    /// The file name from the drop or picker path, or the UI's `Pasted image <yyyyMMddHHmmss>` for a paste.
    pub name: String,
    pub info: MediaInfo,
    /// The owning note's title (title, else stem); `None` from the capture window without a title.
    pub owner_title: Option<String>,
    /// The UI's local date `yyyy-MM-dd` (capture titles `Capture <date> <n>`).
    pub date: String,
    /// The attachments folder (vault setting `attachments`, D-551).
    pub attachments: String,
    /// The type folder of the new object (`Images`, `PDFs`).
    pub folder: String,
}

/// §3.3: vault paths of the new file and object, and the object's title.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MediaNames {
    pub file: String,
    pub object: String,
    pub title: String,
}

/// R73: whether a file stem is generic (FR-ATT-08).
pub fn is_generic_name(stem: &str) -> bool {
    let s = nfc(stem).trim().to_lowercase();
    const WORDS: [&str; 10] = ["image", "img", "photo", "picture", "screenshot", "untitled", "scan", "document", "file", "download"];
    if WORDS.contains(&s.as_str()) || s.starts_with("pasted image") {
        return true;
    }
    const PREFIXES: [&str; 9] = ["img", "dsc", "dscn", "pxl", "photo", "screenshot", "screen shot", "snímek obrazovky", "bildschirmfoto"];
    if PREFIXES.iter().any(|p| s.starts_with(p)) {
        return true;
    }
    !s.is_empty() && s.chars().all(|c| c.is_ascii_digit() || c.is_ascii_punctuation() || c.is_whitespace())
}

/// The name's extension when it has one (short, alphanumeric).
fn split_ext(name: &str) -> (&str, Option<&str>) {
    match name.rsplit_once('.') {
        Some((stem, ext)) if !stem.is_empty() && !ext.is_empty() && ext.len() <= 5 && ext.chars().all(|c| c.is_ascii_alphanumeric()) => (stem, Some(ext)),
        _ => (name, None),
    }
}

/// D-51 sanitizing with the whole file name ≤ 200 UTF-8 bytes (§11, AP-555).
fn file_stem(stem: &str, ext: &str) -> String {
    let mut s = sanitize_file_stem(stem);
    let max = 200usize.saturating_sub(ext.len() + 1);
    if s.len() > max {
        let mut end = max;
        while !s.is_char_boundary(end) {
            end -= 1;
        }
        s = s[..end].trim_end_matches([' ', '.']).to_string();
    }
    s
}

fn join(dir: &str, name: &str) -> String {
    let dir = dir.trim_matches('/');
    if dir.is_empty() { name.to_string() } else { format!("{dir}/{name}") }
}

/// §3.3 (R72, R73, D-617): pure; `exists(vault path)` answers whether a path is taken (case-insensitive).
pub fn media_names(exists: &dyn Fn(&str) -> bool, req: &NameRequest) -> MediaNames {
    let name = nfc(req.name.trim());
    let (stem, ext) = split_ext(&name);
    let ext = ext.unwrap_or(req.info.ext).to_string();
    let stem = stem.trim().to_string();
    let fstem = file_stem(&stem, &ext);
    let file = join(&req.attachments, &unique_file_name(&fstem, &ext, &|n: &str| exists(&join(&req.attachments, n))));
    let (object, title) = if is_generic_name(&stem) {
        let base = req.owner_title.as_deref().map(|t| nfc(t.trim())).filter(|t| !t.is_empty()).unwrap_or_else(|| format!("Capture {}", req.date));
        let n = (1..).find(|n| !exists(&join(&req.folder, &format!("{}.md", sanitize_file_stem(&format!("{base} {n}")))))).unwrap_or(1);
        let title = format!("{base} {n}");
        (join(&req.folder, &format!("{}.md", sanitize_file_stem(&title))), title)
    } else {
        let ostem = sanitize_file_stem(&stem);
        (join(&req.folder, &unique_file_name(&ostem, "md", &|n: &str| exists(&join(&req.folder, n)))), stem)
    };
    MediaNames { file, object, title }
}

/// §3.5: the fields of a new Image or PDF object.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MediaObjectFields {
    pub id: String,
    pub title: String,
    /// ISO 8601 with offset (`created` and `modified`).
    pub now: String,
    /// The text inside `![[…]]` (the file name, or its vault path when the name isn't unique).
    pub embed: String,
    pub info: MediaInfo,
    pub size: u64,
    /// D-184 link text of the owning note, if any.
    pub source: Option<String>,
}

/// A YAML scalar as the dialect writes it (D-174, D-230): plain when it reads back as the same string, else
/// double-quoted.
pub(crate) fn yaml_scalar(v: &str) -> String {
    let v = nfc(v);
    let lower = v.to_lowercase();
    let starts = v.chars().next().is_some_and(|c| "-?:,[]{}#&*!|>'\"%@`".contains(c));
    let reserved = matches!(lower.as_str(), "true" | "false" | "yes" | "no" | "on" | "off" | "null" | "~" | "y" | "n");
    let numeric = v.parse::<f64>().is_ok() || v.starts_with("0x") || v.starts_with("0o");
    let date = v.len() >= 8 && v.as_bytes()[..4].iter().all(u8::is_ascii_digit) && v.as_bytes()[4] == b'-';
    let quote = v.is_empty()
        || v != v.trim()
        || starts
        || reserved
        || numeric
        || date
        || v.contains(": ")
        || v.contains(" #")
        || v.ends_with(':')
        || v.contains("[[")
        || v.chars().any(|c| c.is_control());
    if !quote {
        return v;
    }
    let mut out = String::from("\"");
    for c in v.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\t' => out.push_str("\\t"),
            c if c.is_control() => out.push_str(&format!("\\u{:04x}", c as u32)),
            c => out.push(c),
        }
    }
    out.push('"');
    out
}

/// §3.5: the object's bytes (twin of `@tegg/doc` `mediaObject`).
pub fn media_object(f: &MediaObjectFields) -> String {
    let ty = if f.info.media_type == "application/pdf" { "pdf" } else { "image" };
    let mut s = format!("---\nid: {}\ntype: {ty}\ntitle: {}\ncreated: {}\nmodified: {}\n", f.id, yaml_scalar(&f.title), f.now, f.now);
    s.push_str(&format!("file: \"[[{}]]\"\nmedia-type: {}\nsize: {}\n", nfc(&f.embed), f.info.media_type, f.size));
    if let Some(w) = f.info.width {
        s.push_str(&format!("width: {w}\n"));
    }
    if let Some(h) = f.info.height {
        s.push_str(&format!("height: {h}\n"));
    }
    if let Some(p) = f.info.pages {
        s.push_str(&format!("pages: {p}\n"));
    }
    if let Some(src) = &f.source {
        s.push_str(&format!("source: \"[[{}]]\"\n", nfc(src)));
    }
    s.push_str("---\n");
    s
}

/// A ULID (Crockford base 32): 48 bits of milliseconds, 80 random bits.
pub(crate) fn ulid(now: SystemTime) -> String {
    const A: &[u8; 32] = b"0123456789ABCDEFGHJKMNPQRSTVWXYZ";
    let ms = now.duration_since(UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0) as u128 & ((1 << 48) - 1);
    let rnd = |k: u64| {
        let mut h = std::collections::hash_map::RandomState::new().build_hasher();
        h.write_u64(k);
        h.write_u128(SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0));
        h.finish()
    };
    let r = ((rnd(1) as u128) << 16 ^ rnd(2) as u128) & ((1u128 << 80) - 1);
    let v = (ms << 80) | r;
    (0..26).rev().map(|i| A[((v >> (i * 5)) & 31) as usize] as char).collect()
}

/// §3.4: the owning note of a new media file.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OwnerRef {
    pub path: String,
    pub title: String,
}

/// §3.4: one file to add.
#[derive(Debug, Clone)]
pub struct MediaAdd {
    pub bytes: Vec<u8>,
    pub name: String,
    pub owner: Option<OwnerRef>,
    pub now: SystemTime,
    /// `yyyy-MM-dd`, for capture titles.
    pub zone_date: String,
}

/// §3.4: what `media_add` wrote.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MediaAdded {
    pub file: String,
    pub object: String,
    pub title: String,
    /// The text inside `![[…]]`.
    pub embed: String,
    pub info: MediaInfo,
    /// The object's version.
    pub version: FileVersion,
}

impl Core {
    /// §3.4: `media_info` (refuse → `Refused`), names, the file create-exclusive in the attachments folder, then the
    /// object create-exclusive; a failed object write removes the file again.
    pub fn media_add(&self, req: MediaAdd) -> Result<MediaAdded, CoreError> {
        if req.bytes.len() > MAX_MEDIA_BYTES {
            return Err(CoreError::TooLarge);
        }
        let info = media_info(&req.bytes).ok_or(CoreError::Refused)?;
        let vault = &self.shared.vault;
        let attachments = self.vault_settings().attachments;
        let key = if info.media_type == "application/pdf" { "pdf" } else { "image" };
        let folder = self.types().into_iter().find(|t| t.key == key).map(|t| t.folder).unwrap_or_else(|| if key == "pdf" { "PDFs".into() } else { "Images".into() });
        let exists = |p: &str| matches!(vault.version(p), Ok(Some(_)));
        let names = media_names(&exists, &NameRequest {
            name: req.name.clone(),
            info: info.clone(),
            owner_title: req.owner.as_ref().map(|o| o.title.clone()),
            date: req.zone_date.clone(),
            attachments: attachments.clone(),
            folder,
        });
        let fname = names.file.rsplit('/').next().unwrap_or(&names.file).to_string();
        let embed = if self.file_cache().live.paths.iter().any(|p| nfc(p.rsplit('/').next().unwrap_or(p)).to_lowercase() == fname.to_lowercase()) { names.file.clone() } else { fname };
        let fail = |step: &str| std::env::var("TEGG_TEST").as_deref() == Ok("1") && std::env::var("TEGG_TEST_FAIL_MEDIA").as_deref() == Ok(step);
        if fail("file") {
            return Err(CoreError::Vault(VaultError::Io(std::io::Error::other("TEGG_TEST_FAIL_MEDIA=file"))));
        }
        let fv = vault.create_exact(&names.file, &req.bytes)?;
        let source = req.owner.as_ref().map(|o| {
            let o_path = nfc(&o.path);
            let stem = o_path.rsplit('/').next().unwrap_or(&o_path).trim_end_matches(".md").to_string();
            let hits = self.resolve_links(&names.object, &[stem.clone()]);
            let target = if hits.first().and_then(|h| h.path.as_deref()).map(nfc) == Some(o_path.clone()) || self.object(&o_path).is_none() { stem } else { o_path.trim_end_matches(".md").to_string() };
            let shown = nfc(o.title.trim());
            if !shown.is_empty() && shown != target { format!("{target}|{shown}") } else { target }
        });
        let now = chrono::DateTime::<chrono::Local>::from(req.now).format("%Y-%m-%dT%H:%M:%S%:z").to_string();
        let bytes = media_object(&MediaObjectFields { id: ulid(req.now), title: names.title.clone(), now, embed: embed.clone(), info: info.clone(), size: req.bytes.len() as u64, source });
        let written = if fail("object") { Err(VaultError::Io(std::io::Error::other("TEGG_TEST_FAIL_MEDIA=object"))) } else { vault.create_exact(&names.object, bytes.as_bytes()) };
        let ov = match written {
            Ok(v) => v,
            Err(e) => {
                let _ = vault.discard_checked(&names.file, &fv);
                *crate::lock(&self.shared.files) = None;
                return Err(e.into());
            }
        };
        let _ = self.index().upsert(&names.object, bytes.as_bytes(), &ov);
        *crate::lock(&self.shared.files) = None;
        self.shared.emit(CoreEvent::VaultChanged { paths: vec![names.file.clone(), names.object.clone()] });
        Ok(MediaAdded { file: names.file, object: names.object, title: names.title, embed, info, version: ov })
    }
}
