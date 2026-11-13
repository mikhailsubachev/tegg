//! The status item's menu strings (ms5-capture §9, D-575): the menu is built in Rust before any webview loads, so its
//! texts live here, keyed like the UI catalog; `app/test/catalog_5b.ac.test.ts` checks they equal the catalog's
//! English values (NFR-OTH-02).

const MENUBAR: [(&str, &str); 8] = [
    ("menubar.title", "Tegg"),
    ("menubar.help", "Quick Capture"),
    ("menubar.capture", "Quick Capture"),
    ("menubar.task", "New Task"),
    ("menubar.open", "Open Tegg"),
    ("menubar.settings", "Settings…"),
    ("menubar.quit", "Quit Tegg"),
    // D-608: the app menu's Help › Keyboard Shortcuts.
    ("menubar.shortcuts", "Keyboard Shortcuts"),
];

/// `menubar.<key>`'s English text.
pub fn menubar(key: &str) -> &'static str {
    let full = format!("menubar.{key}");
    MENUBAR.iter().find(|(k, _)| *k == full).map(|(_, v)| *v).unwrap_or("")
}

/// Commands of the app menu (v1-import-window §4.1), keyed like the UI catalog; `app/test/import_catalog.ac.test.ts`
/// checks `cmd.import` equals the catalog's English value.
const COMMANDS: [(&str, &str); 1] = [("cmd.import", "Import…")];

/// A command's English text by its full catalog key.
pub fn command(key: &str) -> &'static str {
    COMMANDS.iter().find(|(k, _)| *k == key).map(|(_, v)| *v).unwrap_or("")
}
