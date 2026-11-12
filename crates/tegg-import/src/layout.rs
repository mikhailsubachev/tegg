//! §3 "Layout" and "Classes" (ported from the S5 spike, `plan.rs`): where the spaces start inside an export and which
//! class a file of a space has (D-79, R147). Pure: paths only.

/// Where the spaces start and whether the export has space folders at all.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub(crate) struct Layout {
    /// The wrapper folders around the spaces, with a trailing `/` (or empty).
    pub prefix: String,
    /// No space folder: the whole export is one space named `flat_name`.
    pub flat: bool,
    /// The source's file or folder name without `.zip`.
    pub flat_name: String,
}

/// Typed notes sit at `<space>/<Type folder>/<note>.md`. A single-space export may have no space folder
/// (`<Type folder>/<note>.md`), and one wrapper folder (or several, one inside the other) may hold everything.
/// `entries`: every usable path with "is a typed note". `None`: no typed note anywhere (not a Capacities export).
pub(crate) fn detect(entries: &[(&str, bool)], flat_name: &str) -> Option<Layout> {
    let mut prefix = String::new();
    let layout = |prefix: String, flat: bool| Some(Layout { prefix, flat, flat_name: flat_name.to_string() });
    loop {
        let min = entries.iter().filter(|(p, typed)| *typed && p.starts_with(&prefix)).map(|(p, _)| p[prefix.len()..].split('/').count()).min()?;
        if min <= 2 {
            return layout(prefix, true);
        }
        if min == 3 {
            return layout(prefix, false);
        }
        let mut firsts: Vec<&str> = entries.iter().filter(|(p, _)| p.starts_with(&prefix)).map(|(p, _)| p[prefix.len()..].split('/').next().unwrap_or("")).collect();
        firsts.sort_unstable();
        firsts.dedup();
        if firsts.len() != 1 {
            return layout(prefix, false);
        }
        prefix = format!("{prefix}{}/", firsts[0]);
    }
}

impl Layout {
    /// The space of a path and the path inside the space; `None` for a file in no space.
    pub fn space_of<'a>(&'a self, path: &'a str) -> Option<(&'a str, &'a str)> {
        let rest = path.strip_prefix(self.prefix.as_str())?;
        if self.flat {
            return Some((self.flat_name.as_str(), rest));
        }
        rest.split_once('/')
    }

    /// The path a file in no space is reported under: without the wrapper folders.
    pub fn outside_name<'a>(&self, path: &'a str) -> &'a str {
        path.strip_prefix(self.prefix.as_str()).unwrap_or(path)
    }
}

/// A dotfile, or a file in a dot folder.
pub(crate) fn is_hidden(inner: &str) -> bool {
    inner.split('/').any(|p| p.starts_with('.'))
}
/// D-79: an object is a `.md` that isn't a dotfile.
pub(crate) fn is_object(inner: &str) -> bool {
    inner.ends_with(".md") && !is_hidden(inner)
}
pub(crate) fn is_csv(inner: &str) -> bool {
    inner.to_ascii_lowercase().ends_with(".csv")
}
/// D-79: every other file of a space except `.csv` and dotfiles.
pub(crate) fn is_attachment(inner: &str) -> bool {
    !is_hidden(inner) && !inner.ends_with(".md") && !is_csv(inner)
}

/// The source's name as a space name and in reports: without a final `.zip` (ASCII case-insensitive).
pub(crate) fn without_zip(name: &str) -> &str {
    let n = name.len();
    if n > 4 && name.is_char_boundary(n - 4) && name[n - 4..].eq_ignore_ascii_case(".zip") {
        &name[..n - 4]
    } else {
        name
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn spaces_wrapper_and_flat_layouts() {
        let spaced = [("PKM/Pages/a.md", true), ("Work/Tasks/b.md", true), ("PKM/Tags/x.csv", false)];
        let l = detect(&spaced, "export").unwrap();
        assert_eq!((l.prefix.as_str(), l.flat), ("", false));
        assert_eq!(l.space_of("PKM/Pages/a.md"), Some(("PKM", "Pages/a.md")));
        assert_eq!(l.space_of("Readme.txt"), None);

        let wrapped = [("export/PKM/Pages/a.md", true), ("export/Čti mě.txt", false)];
        let l = detect(&wrapped, "x").unwrap();
        assert_eq!((l.prefix.as_str(), l.flat), ("export/", false));
        assert_eq!(l.space_of("export/Čti mě.txt"), None);
        assert_eq!(l.outside_name("export/Čti mě.txt"), "Čti mě.txt");

        let flat = [("DailyNotes/2026-02-02.md", true)];
        let l = detect(&flat, "Deník 2026").unwrap();
        assert!(l.flat);
        assert_eq!(l.space_of("DailyNotes/2026-02-02.md"), Some(("Deník 2026", "DailyNotes/2026-02-02.md")));
        assert_eq!(detect(&[("Poznámky/a.md", false)], "x"), None);
    }

    #[test]
    fn classes() {
        assert!(is_object("Pages/a.md") && !is_object("Pages/.a.md") && !is_object(".x/a.md"));
        assert!(is_attachment("Images/Media/a.png") && !is_attachment("Tags/a.csv") && !is_attachment(".DS_Store") && !is_attachment("a.md"));
        assert_eq!((without_zip("c10.zip"), without_zip("c10.ZIP"), without_zip("c10"), without_zip(".zip")), ("c10", "c10", "c10", ".zip"));
    }
}
