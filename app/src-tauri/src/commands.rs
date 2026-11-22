//! docs/contracts/android-shell.md §2.1 (AR-03 AC-9, RA2): the IPC command lists per platform, in source order of the
//! desktop `generate_handler!`. Compiled on every target; `tests/ac_android_commands.rs` ties them to the two handlers,
//! `build.rs` and the capability files.

/// Every command the desktop registers (unchanged from `7ff0fc0b`).
pub const DESKTOP: &[&str] = &[
    "vault_current", "vault_open", "index_search", "index_switcher", "note_read", "note_create", "perf_mark",
    "vault_create", "vault_pick_dir", "vault_last", "vault_recent", "app_about", "vault_types", "index_type_counts",
    "index_list", "nav_opened", "nav_swipe_scroll", "ui_state_get", "ui_state_set", "link_resolve", "embed_load",
    "index_path_by_id", "open_external", "note_write", "note_create_exact", "note_trash", "note_discard",
    "index_tags", "index_conflicts", "app_quit", "type_get", "type_create", "type_patch", "type_delete",
    "type_template", "type_usage", "index_type_rows", "starter_plan", "starter_add", "index_backlinks",
    "index_broken_links", "index_duplicate_titles", "link_create_plan", "link_create", "daily_view", "daily_dates",
    "daily_draft", "daily_create", "daily_context", "daily_backlinks", "note_rename", "job_cancel", "job_confirm",
    "job_report", "job_retry", "job_undo", "job_redo", "job_transform_result", "job_interrupted",
    "job_resolve_interrupted", "backups_list", "backup_restore", "editor_open", "editor_close", "task_list",
    "daily_tasks", "capture_context", "capture_create", "capture_ready", "capture_hide", "capture_resize",
    "capture_open_main", "capture_draft_get", "capture_draft_set", "capture_saved_show", "capture_saved_hover",
    "capture_suggest", "vault_settings", "vault_settings_patch", "vault_reveal", "shell_settings",
    "shell_settings_set", "hotkeys", "hotkeys_retry", "inbox_list", "inbox_count", "inbox_bulk", "capture_open",
    "index_versions", "trash_list", "object_trash", "trash_restore", "trash_delete", "trash_empty", "media_add",
    "media_add_paths", "media_pick", "media_open", "media_reveal", "capture_media_add", "tag_objects",
    "index_tagged_objects", "tag_usage", "tag_new_path", "tag_rename", "tag_delete", "type_move_plan", "type_move",
    "folder_move_preview", "tidy_now", "jobs_ready", "value_remove_start", "type_delete_start", "merge_start",
    "job_plan", "backup_reveal", "graph_neighbourhood", "graph_presets_get", "graph_presets_apply", "pins_get",
    "pins_apply", "index_related", "queries_list", "query_get", "query_run", "query_apply", "query_revert",
    "query_create", "query_duplicate", "query_rename", "query_trash", "query_restore", "query_usages",
    "query_view_usages", "import_pick_source", "import_scan", "import_cancel", "import_where", "import_check_target",
    "import_plan", "import_start", "import_status", "import_discard", "import_transform_result",
];

/// `DESKTOP` minus RA2's groups P1…P5 (capture, status item and hotkeys, import, dialogs, macOS system), J (bulk jobs and
/// schema, D-2007), V (views and queries, D-2006) and O (not in this version), then `ANDROID_ONLY`.
pub const ANDROID: &[&str] = &[
    "vault_current", "vault_open", "index_search", "index_switcher", "note_read", "note_create", "perf_mark",
    "vault_create", "vault_last", "vault_recent", "vault_types", "index_type_counts", "index_list", "nav_opened",
    "nav_swipe_scroll", "ui_state_get", "ui_state_set", "link_resolve", "embed_load", "index_path_by_id",
    "note_write", "note_create_exact", "note_trash", "note_discard", "index_tags", "index_conflicts", "type_get",
    "type_template", "type_usage", "index_type_rows", "starter_plan", "index_backlinks", "index_broken_links",
    "index_duplicate_titles", "link_create_plan", "link_create", "daily_view", "daily_dates", "daily_draft",
    "daily_create", "daily_context", "daily_backlinks", "job_cancel", "job_confirm", "job_report", "job_retry",
    "job_transform_result", "job_interrupted", "job_resolve_interrupted", "backups_list", "editor_open",
    "editor_close", "task_list", "daily_tasks", "vault_settings", "vault_settings_patch", "inbox_list",
    "inbox_count", "index_versions", "trash_list", "object_trash", "media_add", "media_add_paths", "tag_objects",
    "index_tagged_objects", "tag_usage", "tag_new_path", "jobs_ready", "job_plan", "pins_get", "pins_apply",
    "queries_list", "query_get", "query_run", "query_usages", "query_view_usages", "vault_start", "vault_find",
    "storage_access", "storage_access_settings",
];

/// The four Android-only commands (contract §2.2).
pub const ANDROID_ONLY: &[&str] = &["vault_start", "vault_find", "storage_access", "storage_access_settings"];
