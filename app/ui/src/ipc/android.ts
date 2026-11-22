// Slice AND-1 (docs/contracts/android-shell.md §9.1, RA2; D-2024, D-2026): the commands the Android shell doesn't
// register. The client refuses them on Android without calling the shell; app/test/android_platform.ac.test.ts ties this
// list to the shell's `commands::DESKTOP − ANDROID` (CP-3 → D-2038).
import { invoke as tauriInvoke, type InvokeArgs, type InvokeOptions } from '@tauri-apps/api/core';
import { isAndroid } from '../platform';

export const ANDROID_EXCLUDED: readonly string[] = [
  // P1 capture
  'capture_context', 'capture_create', 'capture_ready', 'capture_hide', 'capture_resize', 'capture_open_main', 'capture_draft_get',
  'capture_draft_set', 'capture_saved_show', 'capture_saved_hover', 'capture_suggest', 'capture_open', 'capture_media_add',
  // P2 status item, hotkeys
  'hotkeys', 'hotkeys_retry', 'shell_settings', 'shell_settings_set',
  // P3 import window
  'import_pick_source', 'import_scan', 'import_cancel', 'import_where', 'import_check_target', 'import_plan', 'import_start', 'import_status',
  'import_discard', 'import_transform_result',
  // P4 dialogs
  'vault_pick_dir', 'media_pick',
  // P5 macOS system
  'vault_reveal', 'media_reveal', 'backup_reveal', 'media_open', 'open_external', 'app_about', 'app_quit',
  // J bulk jobs, schema (D-2007)
  'note_rename', 'tag_rename', 'tag_delete', 'merge_start', 'type_move_plan', 'type_move', 'folder_move_preview', 'tidy_now', 'value_remove_start',
  'type_delete_start', 'inbox_bulk', 'starter_add', 'backup_restore', 'job_undo', 'job_redo', 'type_create', 'type_patch', 'type_delete',
  // V views, queries (D-2006)
  'query_apply', 'query_revert', 'query_create', 'query_duplicate', 'query_rename', 'query_trash', 'query_restore',
  // O not in this version
  'graph_neighbourhood', 'graph_presets_get', 'graph_presets_apply', 'index_related', 'trash_restore', 'trash_delete', 'trash_empty',
];

const EXCLUDED = new Set(ANDROID_EXCLUDED);

/** Palette commands whose only action is a refused command: not listed on Android (AR-03 AC-11). */
export const ANDROID_HIDDEN_COMMANDS: ReadonlySet<string> = new Set([
  'import.open', 'capture.quick', 'capture.task', 'app.about',
  'type.new', 'vault.addStarterTypes', 'tag.rename', 'tag.delete', 'duplicates.merge', 'note.changeType',
  'job.undoRename', 'job.undo.typeChange', 'job.undo.move', 'job.undo.valueRemove', 'job.undo.typeDelete', 'settings.backups',
  'queries.new', 'views.new', 'query.edit', 'query.rename', 'query.trash',
  'graph.open', 'graph.view.list', 'graph.view.graph', 'panel.graph', 'panel.related', 'related.toggleLinked',
  'trash.restore', 'trash.delete',
]);

type Listener = () => void;
const listeners = new Set<Listener>();

/** The page shows `error.unsupported` each time a refused command was asked for (D-2026). */
export function onUnsupported(f: Listener): () => void {
  listeners.add(f);
  return () => listeners.delete(f);
}

/** `invoke`, except that on Android an RA2 command is refused here with kind `Unsupported` and never reaches the shell. */
export function invoke<T>(cmd: string, args?: InvokeArgs, options?: InvokeOptions): Promise<T> {
  if (EXCLUDED.has(cmd) && isAndroid()) {
    for (const f of listeners) f();
    return Promise.reject({ kind: 'Unsupported', message: '' });
  }
  return tauriInvoke<T>(cmd, args, options);
}
