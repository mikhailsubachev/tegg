//! The type file's `views:` items (docs/contracts/v1-views.md §14, §36; R196, R220, R221; D-1840, D-1843, D-1852,
//! D-1857, D-1868, D-2200, D-2204): the ops `SetViews`, `SetViewSort`, `SetViewColumns`, `SetViewsSource`, Q3's
//! `SetViewDisplay`, `SetViewGroup`, `SetViewLanes`, `SetViewLaneOrder`, `SetViewWidths`, `CopyViewSettings`, the exact
//! text of the key (`views_source`), the query rename's patch (`rename_view`) and the 4C rename's lane-order patch
//! (`relink_view_lane_orders`, §38). Every write replaces only the `views` key's lines. An item whose value didn't change
//! keeps its lines byte for byte (a comment after it included, D-2204); in a changed item every field the op didn't touch
//! keeps its lines (old words, comments on those lines, style; CP-35, D-2200), the changed key's lines are replaced
//! (keeping a one-line key's trailing comment) or inserted at its R221 place, and full-line comments inside it go. The
//! key is one flow line while every item is a plain name.

use super::*;

/// R221's key order inside an item; unknown keys stay where they are.
const KEY_ORDER: [&str; 8] = ["name", "view", "group_by", "lanes", "lane_order", "sort", "columns", "widths"];
/// The own keys `CopyViewSettings` copies (CP-35, D-2200; unknown keys aren't copied, D-1863).
const OWN_KEYS: [&str; 7] = ["view", "group_by", "lanes", "lane_order", "sort", "columns", "widths"];

/// One item while a views op runs.
#[derive(Debug, Clone)]
struct Item {
    name: String,
    sort: UsageValue<Vec<UsageSort>>,
    columns: UsageValue<Vec<String>>,
    view: UsageValue<UsageView>,
    group_by: UsageValue<UsageGroupBy>,
    lanes: UsageValue<UsageLanes>,
    lane_order: UsageValue<Vec<String>>,
    widths: UsageValue<Vec<(String, u32)>>,
    /// The item's fields as (key, lines relative to the field indent, without EOL), `name` included, in file order.
    fields: Vec<(String, Vec<String>)>,
    /// The field indent relative to the item indent's dash (`- ` = 2).
    gap: usize,
    /// The item's lines as written (block style), EOLs as in the file; None for a new item or a flow list.
    lines: Option<Vec<String>>,
    changed: bool,
}

impl Item {
    fn plain(&self) -> bool {
        self.fields.iter().all(|(k, _)| k == "name")
    }
    fn new_plain(name: &str) -> Item {
        let name = nfc(name);
        Item {
            fields: vec![("name".into(), vec![format!("name: {}", scalar(&name, true))])],
            name,
            sort: UsageValue::Absent,
            columns: UsageValue::Absent,
            view: UsageValue::Absent,
            group_by: UsageValue::Absent,
            lanes: UsageValue::Absent,
            lane_order: UsageValue::Absent,
            widths: UsageValue::Absent,
            gap: 2,
            lines: None,
            changed: true,
        }
    }
    fn has(&self, key: &str) -> bool {
        self.fields.iter().any(|(k, _)| k == key)
    }
    /// Sets (Some) or removes (None) a field's lines: replaced in place (a one-line key keeps its trailing comment),
    /// else inserted right after the nearest earlier key of R221's order.
    fn set_field(&mut self, key: &str, new: Option<Vec<String>>) {
        let at = self.fields.iter().position(|(k, _)| k == key);
        match (at, new) {
            (Some(i), None) => {
                self.fields.remove(i);
            }
            (Some(i), Some(mut l)) => {
                let old = &self.fields[i].1;
                if old.len() == 1 && l.len() == 1 {
                    if let Some(c) = trailing_comment(&old[0]) {
                        l[0].push_str(&c);
                    }
                }
                self.fields[i].1 = l;
            }
            (None, None) => return,
            (None, Some(l)) => {
                let rank = KEY_ORDER.iter().position(|k| *k == key).unwrap_or(KEY_ORDER.len());
                // Right after the nearest earlier key of R221's order that is present (else after the name).
                let after = KEY_ORDER[..rank.min(KEY_ORDER.len())].iter().rev().find_map(|k| self.fields.iter().position(|(x, _)| x == k));
                let pos = after.map(|j| j + 1).unwrap_or(0);
                self.fields.insert(pos, (key.to_string(), l));
            }
        }
        self.changed = true;
    }
}

impl Item {
    /// Part two's re-emit of an item whose `sort` or `columns` changed (R196; D-1840, FR-FMT-12 AC-13): the name in NFC,
    /// the known keys in R221's order (`sort` and `columns` from their values, a broken one as written), then the unknown
    /// keys in NFC. The Q3 keys keep their lines.
    fn canonicalize(&mut self) {
        let mut out: Vec<(String, Vec<String>)> = vec![("name".into(), vec![format!("name: {}", scalar(&self.name, true))])];
        for k in &KEY_ORDER[1..] {
            let Some((_, l)) = self.fields.iter().find(|(x, _)| x == k) else { continue };
            let l = match (*k, &self.sort, &self.columns) {
                ("sort", UsageValue::Set(v), _) => sort_lines(v),
                ("columns", _, UsageValue::Set(c)) => vec![format!("columns: {}", flow_list(c))],
                ("sort", _, _) | ("columns", _, _) => l.iter().map(|x| nfc(x)).collect(),
                _ => l.clone(),
            };
            out.push((k.to_string(), l));
        }
        for (k, l) in &self.fields {
            if !KEY_ORDER.contains(&k.as_str()) {
                out.push((k.clone(), l.iter().map(|x| nfc(x)).collect()));
            }
        }
        self.fields = out;
        self.changed = true;
    }
}

/// The trailing comment of a one-line field (the blanks before ` #` included), outside quotes.
fn trailing_comment(line: &str) -> Option<String> {
    let colon = line.find(':')?;
    let rest = &line[colon + 1..];
    let c = comment_start(rest)?;
    let mut s = colon + 1 + c;
    while s > 0 && matches!(line.as_bytes()[s - 1], b' ' | b'\t') {
        s -= 1;
    }
    Some(line[s..].to_string())
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

/// The fields of a block-mapping item's lines: (field indent, [(key, lines relative to the field indent, without
/// EOL)]). The first field sits on the `- ` line; full-line comments and blank lines belong to no field.
fn block_fields(lines: &[String], ind: usize) -> Option<(usize, Vec<(String, Vec<String>)>)> {
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
    Some((fi, out))
}

/// A value's lines as `key: value` (one flow line), for items read from a flow collection.
fn json_lines(key: &str, v: &Value) -> Vec<String> {
    vec![format!("{}: {}", scalar(key, false), value_text(v, true))]
}

/// The fields of an item read from JSON: `name`, the known keys in R221's order, then the unknown keys.
fn json_fields(v: &Value) -> Vec<(String, Vec<String>)> {
    match v {
        Value::String(s) => vec![("name".into(), vec![format!("name: {}", scalar(s, true))])],
        Value::Object(map) => {
            let mut out: Vec<(String, Vec<String>)> = Vec::new();
            for k in KEY_ORDER {
                if let Some(x) = map.get(k) {
                    out.push((k.to_string(), json_lines(k, x)));
                }
            }
            for (k, x) in map {
                if !KEY_ORDER.contains(&k.as_str()) {
                    out.push((k.clone(), json_lines(k, x)));
                }
            }
            out
        }
        _ => Vec::new(),
    }
}

fn model(lines: &[String]) -> Result<Model, RuleError> {
    let span = top_span(lines, "views");
    let mut m = Model { span, block: false, ind: ITEM_INDENT, items: Vec::new() };
    let Some((s, e)) = span else { return Ok(m) };
    // The `views` key's own lines read as the same value as in the whole file (they are one top-level key); the whole
    // file is read only when they don't parse alone (an alias of an anchor elsewhere). A tab's write reads less.
    let own_text = join_lines(&lines[s..e], true);
    let alone = match tegg_format::parse_yaml_value(&own_text) {
        Ok(Some(Value::Object(t))) if t.len() == 1 && t.contains_key("views") => Some(t),
        _ => None,
    };
    let (top, text) = match alone {
        Some(t) => (t, own_text),
        None => {
            let all = join_lines(lines, true);
            match tegg_format::parse_yaml_value(&all) {
                Ok(Some(Value::Object(t))) => (t, all),
                _ => return Err(RuleError::ViewsUnreadable),
            }
        }
    };
    let raw: Vec<Value> = match top.get("views") {
        None | Some(Value::Null) => Vec::new(),
        Some(Value::Array(a)) => a.clone(),
        Some(_) => return Err(RuleError::ViewsUnreadable),
    };
    let head = strip_cr(&lines[s]);
    let rest = head.split_once(':').map(|(_, r)| r).unwrap_or("");
    m.block = {
        let r = rest.trim();
        r.is_empty() || r.starts_with('#')
    };
    let spans: Option<Vec<Vec<String>>> = if m.block {
        let (ind, sp) = item_spans(lines, (s, e));
        m.ind = ind;
        // An item's span runs to the next item: a comment after it belongs to it (D-2204).
        (sp.len() == raw.len()).then(|| sp.iter().map(|&(a, b)| lines[a..b].to_vec()).collect())
    } else {
        None
    };
    let mut parsed: Option<Vec<ViewItem>> = raw.iter().map(view_item).collect();
    order_widths(&mut parsed, &text);
    let parsed = parsed.ok_or(RuleError::ViewsUnreadable)?;
    for (n, (v, vi)) in raw.iter().zip(parsed).enumerate() {
        let own = spans.as_ref().map(|sp| sp[n].clone());
        let (gap, fields) = match own.as_ref().and_then(|l| block_fields(l, m.ind)) {
            Some((fi, f)) => (fi - m.ind, f),
            None => (2, json_fields(v)),
        };
        m.items.push(Item {
            name: vi.name,
            sort: vi.sort,
            columns: vi.columns,
            view: vi.view,
            group_by: vi.group_by,
            lanes: vi.lanes,
            lane_order: vi.lane_order,
            widths: vi.widths,
            fields,
            gap,
            lines: own,
            changed: false,
        });
    }
    Ok(m)
}

fn sort_level_text(l: &UsageSort) -> String {
    format!("{{ by: {}, order: {} }}", scalar(&l.by, true), if l.order == UsageOrder::Asc { "asc" } else { "desc" })
}

fn sort_lines(l: &[UsageSort]) -> Vec<String> {
    match l.len() {
        0 => vec!["sort: []".into()],
        1 => vec![format!("sort: {}", sort_level_text(&l[0]))],
        _ => std::iter::once("sort:".to_string()).chain(l.iter().map(|x| format!("  - {}", sort_level_text(x)))).collect(),
    }
}

fn view_word(v: UsageView) -> &'static str {
    match v {
        UsageView::List => "list",
        UsageView::Table => "table",
        UsageView::Wall => "wall",
    }
}

fn lanes_word(l: UsageLanes) -> &'static str {
    match l {
        UsageLanes::Columns => "columns",
        UsageLanes::Rows => "rows",
    }
}

fn group_line(g: &UsageGroupBy) -> String {
    match g {
        UsageGroupBy::None => "group_by: none".into(),
        UsageGroupBy::Key(k) => format!("group_by: {}", scalar(k, false)),
        UsageGroupBy::Period(k) => format!("group_by: {{ {}: period }}", scalar(k, true)),
    }
}

fn widths_line(w: &[(String, u32)]) -> String {
    format!("widths: {{ {} }}", w.iter().map(|(k, v)| format!("{}: {v}", scalar(k, true))).collect::<Vec<_>>().join(", "))
}

fn nfc_group(g: &UsageGroupBy) -> UsageGroupBy {
    match g {
        UsageGroupBy::None => UsageGroupBy::None,
        UsageGroupBy::Key(k) => UsageGroupBy::Key(nfc(k.trim_matches(char::is_whitespace))),
        UsageGroupBy::Period(k) => UsageGroupBy::Period(nfc(k.trim_matches(char::is_whitespace))),
    }
}

fn same_widths(a: &[(String, u32)], b: &[(String, u32)]) -> bool {
    let mut x = a.to_vec();
    let mut y = b.to_vec();
    x.sort();
    y.sort();
    x == y
}

/// The lines of a changed item, without EOLs: a plain name, or its fields at the item's field indent.
fn emit(it: &Item, ind: usize) -> Vec<String> {
    let sp = " ".repeat(ind);
    if it.plain() {
        return vec![format!("{sp}- {}", scalar(&it.name, true))];
    }
    let gap = it.gap.max(2);
    let fi = " ".repeat(ind + gap);
    let mut out = Vec::new();
    for (n, (_, l)) in it.fields.iter().enumerate() {
        for (j, x) in l.iter().enumerate() {
            if n == 0 && j == 0 {
                out.push(format!("{sp}-{}{x}", " ".repeat(gap - 1)));
            } else {
                out.push(format!("{fi}{x}"));
            }
        }
    }
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

/// One own key's change on the item `name` (§36.2): None when it equals the current valid value (no write).
fn change_item(lines: &mut Vec<String>, name: &str, f: impl FnOnce(&mut Item) -> bool) -> Result<(), SchemaError> {
    let mut m = model(lines)?;
    let i = find(&m, name)?;
    if f(&mut m.items[i]) {
        write(lines, &m);
    }
    Ok(())
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
                            it.name = n.clone();
                            if it.has("name") {
                                it.set_field("name", Some(vec![format!("name: {}", scalar(n, true))]));
                            }
                            it.changed = true;
                        }
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
            let v = match sort {
                Some(l) => UsageValue::Set(l.iter().map(|x| UsageSort { by: nfc(x.by.trim_matches(char::is_whitespace)), order: x.order }).collect::<Vec<_>>()),
                None => UsageValue::Absent,
            };
            change_item(lines, name, |it| {
                if it.sort == v {
                    return false;
                }
                it.set_field("sort", if let UsageValue::Set(l) = &v { Some(sort_lines(l)) } else { None });
                it.sort = v;
                it.canonicalize();
                true
            })
        }
        TypeOp::SetViewColumns { name, columns } => {
            let v = match columns {
                Some(c) => UsageValue::Set(c.iter().map(|x| nfc(x)).collect::<Vec<_>>()),
                None => UsageValue::Absent,
            };
            change_item(lines, name, |it| {
                if it.columns == v {
                    return false;
                }
                it.set_field("columns", if let UsageValue::Set(c) = &v { Some(vec![format!("columns: {}", flow_list(c))]) } else { None });
                it.columns = v;
                it.canonicalize();
                true
            })
        }
        TypeOp::SetViewDisplay { name, view } => {
            let v = view.map(UsageValue::Set).unwrap_or(UsageValue::Absent);
            change_item(lines, name, |it| {
                if it.view == v || (v == UsageValue::Absent && !it.has("view")) {
                    return false;
                }
                it.set_field("view", view.map(|x| vec![format!("view: {}", view_word(x))]));
                it.view = v;
                true
            })
        }
        TypeOp::SetViewLanes { name, lanes } => {
            let v = lanes.map(UsageValue::Set).unwrap_or(UsageValue::Absent);
            change_item(lines, name, |it| {
                if it.lanes == v || (v == UsageValue::Absent && !it.has("lanes")) {
                    return false;
                }
                it.set_field("lanes", lanes.map(|x| vec![format!("lanes: {}", lanes_word(x))]));
                it.lanes = v;
                true
            })
        }
        TypeOp::SetViewGroup { name, group_by } => change_item(lines, name, |it| match group_by {
            Some(g) => {
                let g = nfc_group(g);
                if it.group_by == UsageValue::Set(g.clone()) {
                    return false;
                }
                it.set_field("group_by", Some(vec![group_line(&g)]));
                it.group_by = UsageValue::Set(g);
                true
            }
            None => {
                // `Use the query's grouping` (D-2192): group_by, lanes and lane_order together.
                if !(it.has("group_by") || it.has("lanes") || it.has("lane_order")) {
                    return false;
                }
                for k in ["group_by", "lanes", "lane_order"] {
                    it.set_field(k, None);
                }
                it.group_by = UsageValue::Absent;
                it.lanes = UsageValue::Absent;
                it.lane_order = UsageValue::Absent;
                true
            }
        }),
        TypeOp::SetViewLaneOrder { name, lane_order } => {
            let v = match lane_order {
                Some(l) => UsageValue::Set(l.iter().map(|x| nfc(x)).collect::<Vec<_>>()),
                None => UsageValue::Absent,
            };
            change_item(lines, name, |it| {
                if it.lane_order == v || (v == UsageValue::Absent && !it.has("lane_order")) {
                    return false;
                }
                it.set_field("lane_order", if let UsageValue::Set(l) = &v { Some(vec![format!("lane_order: {}", flow_list(l))]) } else { None });
                it.lane_order = v;
                true
            })
        }
        TypeOp::SetViewWidths { name, widths } => {
            let v = match widths {
                Some(w) if !w.is_empty() => UsageValue::Set(w.iter().map(|(k, x)| (nfc(k), *x)).collect::<Vec<_>>()),
                _ => UsageValue::Absent,
            };
            change_item(lines, name, |it| {
                let same = match (&it.widths, &v) {
                    (UsageValue::Set(a), UsageValue::Set(b)) => same_widths(a, b),
                    (UsageValue::Absent, UsageValue::Absent) => !it.has("widths"),
                    _ => false,
                };
                if same {
                    return false;
                }
                it.set_field("widths", if let UsageValue::Set(w) = &v { Some(vec![widths_line(w)]) } else { None });
                it.widths = v;
                true
            })
        }
        TypeOp::CopyViewSettings { from, to } => {
            let mut m = model(lines)?;
            let a = find(&m, from)?;
            let b = find(&m, to)?;
            if a == b {
                return Ok(());
            }
            let src = m.items[a].clone();
            let dst = &mut m.items[b];
            let mut any = false;
            for k in OWN_KEYS {
                let new = src.fields.iter().find(|(x, _)| x == k).map(|(_, l)| l.clone());
                let old = dst.fields.iter().find(|(x, _)| x == k).map(|(_, l)| l.clone());
                if new != old {
                    any = true;
                    dst.set_field(k, new);
                }
            }
            if !any {
                return Ok(());
            }
            dst.sort = src.sort.clone();
            dst.columns = src.columns.clone();
            dst.view = src.view;
            dst.group_by = src.group_by.clone();
            dst.lanes = src.lanes;
            dst.lane_order = src.lane_order.clone();
            dst.widths = src.widths.clone();
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

// ------------------------------------------------------------------------------------------------ 4C rename (§38)

/// D-184: a note's link text, its stem unless another note shares the stem (case-insensitively), then its path.
fn link_text(path: &str, paths: &[String]) -> String {
    let stem_of = |p: &str| {
        let n = p.rsplit('/').next().unwrap_or(p);
        n.strip_suffix(".md").unwrap_or(n).to_string()
    };
    let stem = stem_of(path);
    let same = paths.iter().filter(|x| stem_of(x).to_lowercase() == stem.to_lowercase()).count();
    if same <= 1 {
        stem
    } else {
        path.strip_suffix(".md").unwrap_or(path).to_string()
    }
}

/// D-291 from the vault root over `paths`: a path form, else the stem (root first, then the shortest path).
fn resolve_root(target: &str, paths: &[String]) -> Option<String> {
    let t = nfc(target.trim_matches(char::is_whitespace)).to_lowercase();
    let t = t.strip_suffix(".md").unwrap_or(&t).to_string();
    if t.is_empty() {
        return None;
    }
    let no_md = |p: &str| p.strip_suffix(".md").unwrap_or(p).to_lowercase();
    if let Some(hit) = paths.iter().find(|p| no_md(p) == t) {
        return Some(hit.clone());
    }
    if t.contains('/') {
        return None;
    }
    let mut c: Vec<&String> = paths.iter().filter(|p| no_md(p.rsplit('/').next().unwrap_or(p)) == t).collect();
    c.sort_by(|a, b| a.contains('/').cmp(&b.contains('/')).then(a.chars().count().cmp(&b.chars().count())).then(a.as_bytes().cmp(b.as_bytes())));
    c.first().map(|s| (*s).clone())
}

/// Each quoted `"[[inner]]"` / `'[[inner]]'` token of `s` for which `f(inner, quote)` answers, replaced by its answer.
fn replace_links(s: &str, f: impl Fn(&str, char) -> Option<String>) -> (String, bool) {
    let mut out = String::new();
    let mut rest = s;
    let mut hit = false;
    loop {
        let found = ["\"[[", "'[["].iter().filter_map(|p| rest.find(p).map(|i| (i, p.as_bytes()[0] as char))).min_by_key(|x| x.0);
        let Some((i, q)) = found else { break };
        let after = &rest[i + 3..];
        let close = format!("]]{q}");
        match after.find(&close) {
            Some(j) if !after[..j].contains(']') => {
                out.push_str(&rest[..i]);
                match f(&after[..j], q) {
                    Some(r) => {
                        out.push_str(&r);
                        hit = true;
                    }
                    None => out.push_str(&rest[i..i + 3 + j + 3]),
                }
                rest = &after[j + 3..];
            }
            _ => {
                out.push_str(&rest[..i + 1]);
                rest = &rest[i + 1..];
            }
        }
    }
    out.push_str(rest);
    (out, hit)
}

/// v1-views §38 (D-2193; FR-LNK-03 AC-26): the 4C rename's patch of a type file: in every `views:` item's
/// `lane_order` (flow or block), each `"[[…]]"` entry that resolves from the vault root (D-291, over `paths` = the note
/// paths before the job) to `from` gets the D-184 link text of `to` (D-230 quoting), its `|alias` / `#heading` part
/// kept; every other byte kept. None when nothing matches, `views` is absent or unreadable, or the file is Newer or
/// invalid.
pub fn relink_view_lane_orders(text: &str, from: &str, to: &str, paths: &[String]) -> Option<String> {
    let parsed = parse("", text);
    if parsed.readability != Readability::Ok || parsed.views_unreadable || parsed.view_items.is_none() {
        return None;
    }
    let (from, to) = (nfc(from), nfc(to));
    let before: Vec<String> = paths.iter().map(|p| nfc(p)).collect();
    let after: Vec<String> = before.iter().map(|p| if *p == from { to.clone() } else { p.clone() }).collect();
    let to_text = link_text(&to, &after);
    let moved = |inner: &str| -> Option<String> {
        let cut = inner.find(['|', '#']);
        let (target, rest) = match cut {
            Some(i) => (&inner[..i], &inner[i..]),
            None => (inner, ""),
        };
        (resolve_root(target, &before).as_deref() == Some(from.as_str())).then(|| format!("{to_text}{rest}"))
    };
    let (mut lines, final_nl) = split_lines(text);
    let (s, e) = top_span(&lines, "views")?;
    // The `lane_order` key's lines: its own line (`lane_order:` after an optional `- `) and the deeper lines after it.
    let mut key_ind: Option<usize> = None;
    let mut changed = false;
    for line in lines[s + 1..e].iter_mut() {
        let body = strip_cr(line).to_string();
        let ind = indent_of(&body);
        let t = body.trim_start_matches(' ');
        if t.is_empty() || t.starts_with('#') {
            continue;
        }
        let (field, fcol) = match t.strip_prefix("- ") {
            Some(r) => (r.trim_start_matches(' '), body.len() - r.trim_start_matches(' ').len()),
            None => (t, ind),
        };
        let starts = map_key(field).as_deref() == Some("lane_order");
        match key_ind {
            Some(k) if !starts && ind > k => {}
            _ if starts => key_ind = Some(fcol),
            _ => {
                key_ind = None;
                continue;
            }
        }
        let cut = comment_start(&body).unwrap_or(body.len());
        let (code, tail) = body.split_at(cut);
        let (new, hit) = replace_links(code, |inner, q| {
            moved(inner).map(|n| {
                let link = format!("[[{n}]]");
                if q == '\'' {
                    format!("'{}'", link.replace('\'', "''"))
                } else {
                    serde_json::to_string(&link).unwrap_or_default()
                }
            })
        });
        if hit {
            let cr = if line.ends_with('\r') { "\r" } else { "" };
            *line = format!("{new}{tail}{cr}");
            changed = true;
        }
    }
    if !changed {
        return None;
    }
    let out = join_lines(&lines, final_nl);
    // Read back: still readable, the same view names.
    let back = parse("", &out);
    (back.readability == Readability::Ok && !back.views_unreadable && back.def.views == parsed.def.views).then_some(out)
}
