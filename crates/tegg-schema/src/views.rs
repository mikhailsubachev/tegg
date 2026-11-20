//! The type file's `views:` items (docs/contracts/v1-views.md §14, R196; D-1840, D-1843, D-1852, D-1857, D-1868): the
//! ops `SetViews`, `SetViewSort`, `SetViewColumns`, `SetViewsSource`, the exact text of the key (`views_source`) and the
//! query rename's patch (`rename_view`). Every write replaces only the `views` key's lines; in a block list an item whose
//! value didn't change keeps its lines byte for byte, a changed item is re-emitted in NFC (name, `sort`, `columns`, then
//! its unknown keys); the key is one flow line while every item is a plain name.

use super::*;

/// One item while a views op runs.
#[derive(Debug, Clone)]
struct Item {
    name: String,
    sort: UsageValue<Vec<UsageSort>>,
    columns: UsageValue<Vec<String>>,
    /// Lines of a broken `sort` / `columns` and of the unknown keys, relative to the field indent, without EOL.
    sort_raw: Vec<String>,
    columns_raw: Vec<String>,
    unknown: Vec<String>,
    /// The item's lines as written (block style), EOLs as in the file; None for a new item or a flow list.
    lines: Option<Vec<String>>,
    changed: bool,
}

impl Item {
    fn plain(&self) -> bool {
        self.sort == UsageValue::Absent && self.columns == UsageValue::Absent && self.unknown.is_empty()
    }
    fn new_plain(name: &str) -> Item {
        Item { name: nfc(name), sort: UsageValue::Absent, columns: UsageValue::Absent, sort_raw: Vec::new(), columns_raw: Vec::new(), unknown: Vec::new(), lines: None, changed: true }
    }
}

/// The `views` key as it is: its span, style and items. None: the key is absent (or `views:` null with no items).
struct Model {
    span: Option<(usize, usize)>,
    block: bool,
    ind: usize,
    items: Vec<Item>,
}

fn strip_cr(l: &str) -> &str {
    l.strip_suffix('\r').unwrap_or(l)
}

/// The fields of a block-mapping item's lines: (key, lines relative to the field indent, without EOL). The first field
/// sits on the `- ` line; full-line comments at the field indent belong to no field; deeper comments are dropped.
fn block_fields(lines: &[String], ind: usize) -> Option<Vec<(String, Vec<String>)>> {
    let first = strip_cr(lines.first()?);
    let after = first.get(ind..)?.strip_prefix('-')?;
    let fi = ind + 1 + (after.len() - after.trim_start_matches(' ').len());
    let body = first.get(fi..)?;
    if body.starts_with('{') {
        return None;
    }
    let mut out: Vec<(String, Vec<String>)> = vec![(map_key(body)?, vec![body.to_string()])];
    for l in &lines[1..] {
        let l = strip_cr(l);
        if l.trim().is_empty() {
            continue;
        }
        let i = indent_of(l);
        if l.trim_start().starts_with('#') {
            continue;
        }
        if i == fi && !is_dash(l) {
            out.push((map_key(&l[fi..])?, vec![l[fi..].to_string()]));
        } else if i >= fi {
            let last = out.last_mut()?;
            last.1.push(format!("{}{}", " ".repeat(i - fi), &l[i..]));
        } else {
            return None;
        }
    }
    Some(out)
}

/// A value's lines as `key: value` (one flow line), for items read from a flow collection.
fn json_lines(key: &str, v: &Value) -> Vec<String> {
    vec![format!("{}: {}", scalar(key, false), value_text(v, true))]
}

fn model(lines: &[String]) -> Result<Model, RuleError> {
    let span = top_span(lines, "views");
    let mut m = Model { span, block: false, ind: ITEM_INDENT, items: Vec::new() };
    let Some((s, e)) = span else { return Ok(m) };
    // The `views` key's own lines read as the same value as in the whole file (they are one top-level key); the whole
    // file is read only when they don't parse alone (an alias of an anchor elsewhere). A tab's write reads less.
    let alone = match tegg_format::parse_yaml_value(&join_lines(&lines[s..e], true)) {
        Ok(Some(Value::Object(t))) if t.len() == 1 && t.contains_key("views") => Some(t),
        _ => None,
    };
    let top = match alone {
        Some(t) => t,
        None => match tegg_format::parse_yaml_value(&join_lines(lines, true)) {
            Ok(Some(Value::Object(t))) => t,
            _ => return Err(RuleError::ViewsUnreadable),
        },
    };
    let raw: Vec<Value> = match top.get("views") {
        None | Some(Value::Null) => Vec::new(),
        Some(Value::Array(a)) => a.clone(),
        Some(_) => return Err(RuleError::ViewsUnreadable),
    };
    let head = strip_cr(&lines[s]);
    let rest = head.split_once(':').map(|(_, r)| r).unwrap_or("");
    m.block = { let r = rest.trim(); r.is_empty() || r.starts_with('#') };
    let spans: Option<Vec<Vec<String>>> = if m.block {
        let (ind, sp) = item_spans(lines, (s, e));
        m.ind = ind;
        (sp.len() == raw.len()).then(|| {
            sp.iter()
                .map(|&(a, b)| {
                    // Trailing blank lines and comments at the item indent sit between items: not the item's.
                    let mut end = b;
                    while end > a + 1 && (lines[end - 1].trim().is_empty() || (strip_cr(&lines[end - 1]).trim_start().starts_with('#') && indent_of(&lines[end - 1]) <= ind)) {
                        end -= 1;
                    }
                    lines[a..end].to_vec()
                })
                .collect()
        })
    } else {
        None
    };
    for (n, v) in raw.iter().enumerate() {
        let vi = view_item(v).ok_or(RuleError::ViewsUnreadable)?;
        let own = spans.as_ref().map(|sp| sp[n].clone());
        let mut it = Item { name: vi.name, sort: vi.sort, columns: vi.columns, sort_raw: Vec::new(), columns_raw: Vec::new(), unknown: Vec::new(), lines: own.clone(), changed: false };
        if let Value::Object(map) = v {
            let fields = own.as_ref().and_then(|l| block_fields(l, m.ind));
            let field = |k: &str| -> Vec<String> {
                match fields.as_ref().and_then(|f| f.iter().find(|(fk, _)| fk == k)) {
                    Some((_, l)) => l.iter().map(|x| nfc(x)).collect(),
                    None => map.get(k).map(|v| json_lines(k, v)).unwrap_or_default(),
                }
            };
            if it.sort == UsageValue::Broken {
                it.sort_raw = field("sort");
            }
            if it.columns == UsageValue::Broken {
                it.columns_raw = field("columns");
            }
            let mut unknown_keys: Vec<String> = match &fields {
                Some(f) => f.iter().map(|(k, _)| k.clone()).filter(|k| map.contains_key(k)).collect(),
                None => Vec::new(),
            };
            for k in map.keys() {
                if !unknown_keys.contains(k) {
                    unknown_keys.push(k.clone());
                }
            }
            for k in unknown_keys.iter().filter(|k| !matches!(k.as_str(), "name" | "sort" | "columns")) {
                it.unknown.extend(field(k));
            }
        }
        m.items.push(it);
    }
    Ok(m)
}

fn sort_level_text(l: &UsageSort) -> String {
    format!("{{ by: {}, order: {} }}", scalar(&l.by, true), if l.order == UsageOrder::Asc { "asc" } else { "desc" })
}

/// R196's write style of a re-emitted item, without EOLs.
fn emit(it: &Item, ind: usize) -> Vec<String> {
    let sp = " ".repeat(ind);
    if it.plain() {
        return vec![format!("{sp}- {}", scalar(&it.name, true))];
    }
    let fi = " ".repeat(ind + 2);
    let mut out = vec![format!("{sp}- name: {}", scalar(&it.name, true))];
    match &it.sort {
        UsageValue::Set(l) if l.is_empty() => out.push(format!("{fi}sort: []")),
        UsageValue::Set(l) if l.len() == 1 => out.push(format!("{fi}sort: {}", sort_level_text(&l[0]))),
        UsageValue::Set(l) => {
            out.push(format!("{fi}sort:"));
            out.extend(l.iter().map(|x| format!("{fi}  - {}", sort_level_text(x))));
        }
        UsageValue::Broken => out.extend(it.sort_raw.iter().map(|x| format!("{fi}{x}"))),
        UsageValue::Absent => {}
    }
    match &it.columns {
        UsageValue::Set(c) => out.push(format!("{fi}columns: {}", flow_list(c))),
        UsageValue::Broken => out.extend(it.columns_raw.iter().map(|x| format!("{fi}{x}"))),
        UsageValue::Absent => {}
    }
    out.extend(it.unknown.iter().map(|x| format!("{fi}{x}")));
    out
}

fn cr_of(lines: &[String], m: &Model) -> bool {
    match m.span {
        Some((s, _)) => lines[s].ends_with('\r'),
        None => lines.first().is_some_and(|l| l.ends_with('\r')),
    }
}

/// Writes the model's items in place of the key (or at its TOP place when absent).
fn write(lines: &mut Vec<String>, m: &Model) {
    let cr = cr_of(lines, m);
    let eol = |l: String| if cr { format!("{l}\r") } else { l };
    let new: Vec<String> = if m.items.iter().all(Item::plain) {
        let names: Vec<String> = m.items.iter().map(|i| i.name.clone()).collect();
        vec![eol(format!("views: {}", flow_list(&names)))]
    } else {
        let ind = if m.block { m.ind } else { ITEM_INDENT };
        let mut out = vec![match (m.block, m.span) {
            (true, Some((s, _))) => lines[s].clone(),
            _ => eol("views:".into()),
        }];
        for it in &m.items {
            match (&it.lines, it.changed) {
                (Some(l), false) => out.extend(l.iter().cloned()),
                _ => out.extend(emit(it, ind).into_iter().map(eol)),
            }
        }
        out
    };
    match m.span {
        Some((s, e)) => {
            lines.splice(s..e, new);
        }
        None => set_top(lines, "views", Some(new)),
    }
}

fn find(m: &Model, name: &str) -> Result<usize, RuleError> {
    let want = view_name_key(name);
    m.items.iter().position(|i| view_name_key(&i.name) == want).ok_or(RuleError::ViewNotListed)
}

/// Applies one views op to the lines; `def.views` follows. Unchanged values leave the lines alone (FR-SYN-06).
pub(crate) fn apply_views(def: &mut TypeFile, lines: &mut Vec<String>, op: &TypeOp) -> Result<(), SchemaError> {
    match op {
        TypeOp::SetViewsSource(source) => {
            let body = source.strip_suffix('\n').unwrap_or(source);
            let new: Vec<String> = if source.is_empty() { Vec::new() } else { body.split('\n').map(str::to_string).collect() };
            let mut out = lines.clone();
            match top_span(&out, "views") {
                Some((s, e)) => {
                    out.splice(s..e, new.clone());
                }
                None if new.is_empty() => {}
                None => set_top(&mut out, "views", Some(new.clone())),
            }
            // The source must be exactly the `views` key's lines and read back.
            let span_ok = match top_span(&out, "views") {
                Some((s, e)) => out[s..e] == new[..],
                None => new.is_empty(),
            };
            let back = parse(&def.key, &join_lines(&out, true));
            if !span_ok || back.views_unreadable || back.readability != Readability::Ok {
                return Err(RuleError::ViewsUnreadable.into());
            }
            def.views = back.def.views;
            *lines = out;
            Ok(())
        }
        TypeOp::SetViews(names) => {
            let mut m = model(lines)?;
            let names: Vec<String> = names.iter().map(|n| nfc(n)).collect();
            let old: Vec<String> = m.items.iter().map(|i| i.name.clone()).collect();
            if m.span.is_some() && old == names {
                return Ok(());
            }
            // §14.2: a kept name takes the first existing item with its name key; a name listed again (same name key)
            // is dropped, never written as a copy of that item (bug_q21qa_fr_qry_07_set_views_drops_later_repeats).
            let mut seen: Vec<String> = Vec::new();
            let names: Vec<String> = names
                .into_iter()
                .filter(|n| {
                    let k = view_name_key(n);
                    if seen.contains(&k) {
                        return false;
                    }
                    seen.push(k);
                    true
                })
                .collect();
            let items: Vec<Item> = names
                .iter()
                .map(|n| match find(&m, n) {
                    Ok(i) => {
                        let mut it = m.items[i].clone();
                        if it.name != *n {
                            it.changed = true;
                        }
                        it.name = n.clone();
                        it
                    }
                    Err(_) => Item::new_plain(n),
                })
                .collect();
            m.items = items;
            write(lines, &m);
            def.views = Some(names);
            Ok(())
        }
        TypeOp::SetViewSort { name, sort } => {
            let mut m = model(lines)?;
            let i = find(&m, name)?;
            let v = match sort {
                Some(l) => UsageValue::Set(l.iter().map(|x| UsageSort { by: nfc(x.by.trim_matches(char::is_whitespace)), order: x.order }).collect()),
                None => UsageValue::Absent,
            };
            if m.items[i].sort == v {
                return Ok(());
            }
            m.items[i].sort = v;
            m.items[i].sort_raw.clear();
            m.items[i].changed = true;
            write(lines, &m);
            Ok(())
        }
        TypeOp::SetViewColumns { name, columns } => {
            let mut m = model(lines)?;
            let i = find(&m, name)?;
            let v = match columns {
                Some(c) => UsageValue::Set(c.iter().map(|x| nfc(x)).collect()),
                None => UsageValue::Absent,
            };
            if m.items[i].columns == v {
                return Ok(());
            }
            m.items[i].columns = v;
            m.items[i].columns_raw.clear();
            m.items[i].changed = true;
            write(lines, &m);
            Ok(())
        }
        _ => Ok(()),
    }
}

/// v1-views §14.1 (D-1852): the exact text of the `views` key's lines (key line through its last line, EOLs as in the
/// file); None when the key is absent.
pub fn views_source(text: &str) -> Option<String> {
    let (lines, final_nl) = split_lines(text);
    let (s, e) = top_span(&lines, "views")?;
    let mut out = lines[s..e].join("\n");
    if e < lines.len() || final_nl {
        out.push('\n');
    }
    Some(out)
}

// ------------------------------------------------------------------------------------------------ rename (§14.3)

/// Byte spans `[start, end)` of the comma-separated entries of a flow collection whose opening bracket is at `open`,
/// trimmed; nested collections and quotes are skipped. None when it doesn't close on the line.
fn flow_entries(l: &str, open: usize) -> Option<Vec<(usize, usize)>> {
    let b = l.as_bytes();
    let close = match b.get(open)? {
        b'[' => b']',
        b'{' => b'}',
        _ => return None,
    };
    let mut out = Vec::new();
    let mut depth = 0usize;
    let mut start = open + 1;
    let mut i = open + 1;
    let push = |out: &mut Vec<(usize, usize)>, a: usize, z: usize| {
        let (mut a, mut z) = (a, z);
        while a < z && (b[a] == b' ' || b[a] == b'\t') {
            a += 1;
        }
        while z > a && (b[z - 1] == b' ' || b[z - 1] == b'\t') {
            z -= 1;
        }
        if z > a {
            out.push((a, z));
        }
    };
    while i < b.len() {
        match b[i] {
            b'"' => {
                i += 1;
                while i < b.len() && b[i] != b'"' {
                    if b[i] == b'\\' {
                        i += 1;
                    }
                    i += 1;
                }
            }
            b'\'' => {
                i += 1;
                while i < b.len() {
                    if b[i] == b'\'' {
                        if b.get(i + 1) == Some(&b'\'') {
                            i += 1;
                        } else {
                            break;
                        }
                    }
                    i += 1;
                }
            }
            b'[' | b'{' => depth += 1,
            b']' | b'}' if depth > 0 => depth -= 1,
            c if c == close && depth == 0 => {
                push(&mut out, start, i);
                return Some(out);
            }
            b',' if depth == 0 => {
                push(&mut out, start, i);
                start = i + 1;
            }
            _ => {}
        }
        i += 1;
    }
    None
}

/// The value span of a `name: <value>` pair in a flow mapping whose `{` is at `open`.
fn flow_name_value(l: &str, open: usize) -> Option<(usize, usize)> {
    for (a, z) in flow_entries(l, open)? {
        let pair = &l[a..z];
        if map_key(pair).as_deref() == Some("name") {
            let colon = pair.find(':')?;
            let v = &pair[colon + 1..];
            let lead = v.len() - v.trim_start().len();
            return Some((a + colon + 1 + lead, z));
        }
    }
    None
}

/// The text a block-context YAML scalar token reads as, None when it isn't a string.
fn block_token_text(tok: &str) -> Option<String> {
    match tegg_format::parse_yaml_value(&format!("k: {tok}\n")) {
        Ok(Some(Value::Object(m))) => m.get("k").and_then(Value::as_str).map(nfc),
        _ => None,
    }
}

/// The value span of a `key: value  # comment` text starting at `at` in `line` (key `name`), comment and CR excluded.
fn block_value(line: &str, at: usize) -> Option<(usize, usize)> {
    let body = strip_cr(line);
    let t = &body[at..];
    let colon = t.find(':')?;
    let v = &t[colon + 1..];
    let lead = v.len() - v.trim_start().len();
    let vstart = at + colon + 1 + lead;
    let rest = &body[vstart..];
    let end = comment_start(rest).unwrap_or(rest.len());
    let tok = rest[..end].trim_end();
    (!tok.is_empty()).then_some((vstart, vstart + tok.len()))
}

/// v1-views §1.3, §14.3 (D-1762, D-1843): the query rename job's patch of `views:`: every item whose name key equals
/// `from`'s gets `to` (D-230 quoting) in its name token only: a plain entry's token, a block mapping's `name:` value, a
/// flow mapping's `name:` value; flow or block style, own values, unknown keys and comments kept. None when nothing
/// matches, `views` is absent or unreadable, or the file is Newer or invalid.
pub fn rename_view(text: &str, from: &str, to: &str) -> Option<String> {
    let parsed = parse("", text);
    if parsed.readability != Readability::Ok || parsed.views_unreadable {
        return None;
    }
    let want = view_name_key(from);
    if !parsed.def.views.as_ref()?.iter().any(|v| view_name_key(v) == want) {
        return None;
    }
    let new = scalar(to, true);
    let (mut lines, final_nl) = split_lines(text);
    let (s, e) = top_span(&lines, "views")?;
    // Edits as (line, start, end); applied from the end of each line.
    let mut edits: Vec<(usize, usize, usize)> = Vec::new();
    let flow_item = |l: &str, a: usize, z: usize, edits: &mut Vec<(usize, usize, usize)>, j: usize| {
        let tok = &l[a..z];
        if tok.starts_with('{') {
            if let Some((va, vz)) = flow_name_value(l, a) {
                if token_text(&l[va..vz]).is_some_and(|t| view_name_key(&t) == want) {
                    edits.push((j, va, vz));
                }
            }
        } else if token_text(tok).is_some_and(|t| view_name_key(&t) == want) {
            edits.push((j, a, z));
        }
    };
    let head = strip_cr(&lines[s]).to_string();
    let colon = head.find(':')?;
    let rest = &head[colon + 1..];
    let lead = rest.len() - rest.trim_start().len();
    if rest.trim_start().starts_with('[') {
        for (a, z) in flow_entries(&head, colon + 1 + lead)? {
            flow_item(&head, a, z, &mut edits, s);
        }
    } else {
        let (ind, items) = item_spans(&lines, (s, e));
        for (a, z) in items {
            let first = strip_cr(&lines[a]).to_string();
            let Some(after) = first.get(ind..).and_then(|x| x.strip_prefix('-')) else { continue };
            let fi = ind + 1 + (after.len() - after.trim_start_matches(' ').len());
            let body = &first[fi.min(first.len())..];
            if body.starts_with('{') {
                flow_item(&first, fi, first.len(), &mut edits, a);
                continue;
            }
            if map_key(body).is_some() {
                // A block mapping: its `name:` field, on the dash line or at the field indent.
                let at = std::iter::once((a, fi)).chain((a + 1..z).filter(|&j| indent_of(&lines[j]) == fi && !is_dash(&lines[j])).map(|j| (j, fi)));
                for (j, col) in at {
                    let l = strip_cr(&lines[j]).to_string();
                    if map_key(&l[col..]).as_deref() == Some("name") {
                        if let Some((va, vz)) = block_value(&l, col) {
                            if block_token_text(&l[va..vz]).is_some_and(|t| view_name_key(&t) == want) {
                                edits.push((j, va, vz));
                            }
                        }
                        break;
                    }
                }
                continue;
            }
            // A plain entry: the token ends before a ` #` outside quotes (`- "Čtu # 2"` is one name).
            let tok_end = comment_start(body).unwrap_or(body.len());
            let tok = body[..tok_end].trim_end();
            if !tok.is_empty() && token_text(tok).is_some_and(|t| view_name_key(&t) == want) {
                edits.push((a, fi, fi + tok.len()));
            }
        }
    }
    if edits.is_empty() {
        return None;
    }
    edits.sort_by(|x, y| y.cmp(x));
    for (j, a, z) in edits {
        lines[j].replace_range(a..z, &new);
    }
    let out = join_lines(&lines, final_nl);
    // Read back: the file stays readable and its views are the old list with exactly the renamed entries changed.
    let after = parse("", &out);
    let expect: Vec<String> = parsed.def.views.as_ref()?.iter().map(|v| if view_name_key(v) == want { nfc(to) } else { v.clone() }).collect();
    (after.readability == Readability::Ok && after.def.views.as_ref() == Some(&expect)).then_some(out)
}
