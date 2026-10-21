// D-608 (FR-UX-03 AC-14): the groups of `help/shortcuts`, by command id. Every registry shortcut is in exactly one.
import { SHORTCUTS, type ShortcutDef } from './registry';

export type ShortcutGroup = 'general' | 'navigation' | 'editor' | 'daily' | 'tasks' | 'inbox';
export const GROUPS: ShortcutGroup[] = ['general', 'navigation', 'editor', 'daily', 'tasks', 'inbox'];

export function groupOf(command: string): ShortcutGroup {
  if (command.startsWith('edit.') || command.startsWith('note.')) return 'editor';
  if (command.startsWith('daily.')) return 'daily';
  if (command.startsWith('task')) return 'tasks';
  if (command.startsWith('inbox.') || command === 'goto.inbox') return 'inbox';
  if (command === 'app.switcher' || command.startsWith('nav.') || command.startsWith('vault.recent.') || (command.startsWith('goto.') && !command.startsWith('goto.settings'))) return 'navigation';
  return 'general';
}

export function grouped(list: ShortcutDef[] = SHORTCUTS): Map<ShortcutGroup, ShortcutDef[]> {
  const out = new Map<ShortcutGroup, ShortcutDef[]>(GROUPS.map((g) => [g, []]));
  for (const s of list) out.get(groupOf(s.command))!.push(s);
  return out;
}

/** Titles of commands that exist only on some routes (the palette lists them there), by catalog key. */
export const ROUTE_TITLES: Record<string, string> = { 'daily.previous': 'daily.previous', 'daily.next': 'daily.next' };

/** Inbox keys on a focused card (D-561), not in the registry: they act only inside the Inbox list. */
export const INBOX_KEYS: [string, string][] = [['R', 'cmd.markReviewed'], ['C', 'cmd.inbox.convert'], ['A', 'cmd.inbox.append'], ['L', 'cmd.inbox.link'], ['#', 'cmd.inbox.tags'], ['Space', 'help.inbox.select'], ['↩', 'help.inbox.open']];
/** Typing triggers of the editor (FR-EDT-03, FR-LNK-01, FR-EMB-01, FR-TAG). */
export const TRIGGERS: [string, string][] = [['[[', 'help.trigger.link'], ['@', 'help.trigger.mention'], ['/', 'help.trigger.slash'], ['#', 'help.trigger.tag'], ['![[', 'help.trigger.embed'], ['# ␣', 'help.trigger.heading'], ['- ␣', 'help.trigger.list'], ['[ ] ␣', 'help.trigger.checklist'], ['> ␣', 'help.trigger.quote']];
