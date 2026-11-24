// Slice AND-2 (docs/contracts/android-phone.md §2.3, D-2414; CP-13 → D-2441): the contract's two command lists for
// "zero writes", shared by the L5p tests (app/webkit/phone-*.ts) and the LA tests (app/e2e-android/). A call of a
// `WRITE_COMMANDS` entry is a write whether or not it succeeds. `READ_COMMANDS` is every other command of
// `commands::DESKTOP ∪ ANDROID_ONLY`; the private-storage writers among them (`ui_state_set`, `nav_opened`, `vault_open`,
// `perf_mark`, `shell_settings_set`, `capture_draft_set`) are allowed. The L1 test `ar_03_ac13_…` (app/test/
// android_phone.ac.test.ts) checks that the two lists are disjoint and cover the shell's commands, so a new command
// must be classified here.

export const WRITE_COMMANDS: readonly string[] = [
  'note_write', 'note_create', 'note_create_exact', 'note_trash', 'note_discard', 'note_rename', 'vault_create', 'vault_settings_patch',
  'link_create', 'daily_create', 'object_trash', 'trash_restore', 'trash_delete', 'trash_empty', 'media_add', 'media_add_paths',
  'capture_create', 'capture_media_add', 'pins_apply', 'query_apply', 'query_revert', 'query_create', 'query_duplicate', 'query_rename',
  'query_trash', 'query_restore', 'task_views_restore', 'type_create', 'type_patch', 'type_delete', 'starter_add', 'tag_rename',
  'tag_delete', 'merge_start', 'type_move', 'tidy_now', 'value_remove_start', 'type_delete_start', 'inbox_bulk', 'backup_restore',
  'job_undo', 'job_redo', 'job_confirm', 'job_retry', 'job_cancel', 'job_resolve_interrupted', 'job_transform_result', 'import_start',
  'graph_presets_apply',
];

export const READ_COMMANDS: readonly string[] = [
  // the shell's desktop commands that are not writes, in commands::DESKTOP order
  'vault_current', 'vault_open', 'index_search', 'index_switcher', 'note_read', 'perf_mark', 'vault_pick_dir', 'vault_last', 'vault_recent',
  'app_about', 'vault_types', 'index_type_counts', 'index_list', 'nav_opened', 'nav_swipe_scroll', 'ui_state_get', 'ui_state_set',
  'link_resolve', 'embed_load', 'index_path_by_id', 'open_external', 'index_tags', 'index_conflicts', 'app_quit', 'type_get', 'type_template',
  'type_usage', 'index_type_rows', 'starter_plan', 'index_backlinks', 'index_broken_links', 'index_duplicate_titles', 'link_create_plan',
  'daily_view', 'daily_dates', 'daily_draft', 'daily_context', 'daily_backlinks', 'job_report', 'job_interrupted', 'backups_list',
  'editor_open', 'editor_close', 'task_list', 'daily_tasks', 'capture_context', 'capture_ready', 'capture_hide', 'capture_resize',
  'capture_open_main', 'capture_draft_get', 'capture_draft_set', 'capture_saved_show', 'capture_saved_hover', 'capture_suggest',
  'vault_settings', 'vault_reveal', 'shell_settings', 'shell_settings_set', 'hotkeys', 'hotkeys_retry', 'inbox_list', 'inbox_count',
  'capture_open', 'index_versions', 'trash_list', 'media_pick', 'media_open', 'media_reveal', 'tag_objects', 'index_tagged_objects',
  'tag_usage', 'tag_new_path', 'type_move_plan', 'folder_move_preview', 'jobs_ready', 'job_plan', 'backup_reveal', 'graph_neighbourhood',
  'graph_presets_get', 'pins_get', 'index_related', 'queries_list', 'query_get', 'query_run', 'query_usages', 'query_view_usages',
  'import_pick_source', 'import_scan', 'import_cancel', 'import_where', 'import_check_target', 'import_plan', 'import_status',
  'import_discard', 'import_transform_result',
  // commands::ANDROID_ONLY (AND-1 §2.1, AND-2 §2.1)
  'vault_start', 'vault_find', 'storage_access', 'storage_access_settings', 'android_open_url', 'android_window',
];

export const isWrite = (cmd: string) => WRITE_COMMANDS.includes(cmd);
