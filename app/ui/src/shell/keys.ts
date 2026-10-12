// Shortcut strings in Apple's modifier order ⌃ ⌥ ⇧ ⌘ (D-126), matched against keyboard events by key code.

const CODES: Record<string, string> = { Backslash: '\\', Comma: ',', BracketLeft: '[', BracketRight: ']', Period: '.', Slash: '/', Space: 'Space' };

/** The shortcut string of a keydown event, e.g. `⇧⌘F`; null without ⌘ or ⌃. */
export function eventKeys(e: KeyboardEvent): string | null {
  if (!e.metaKey && !e.ctrlKey) return null;
  let key: string | undefined;
  if (/^Key[A-Z]$/.test(e.code)) key = e.code.slice(3);
  else if (/^Digit\d$/.test(e.code)) key = e.code.slice(5);
  else key = CODES[e.code];
  if (!key) return null;
  return `${e.ctrlKey ? '⌃' : ''}${e.altKey ? '⌥' : ''}${e.shiftKey ? '⇧' : ''}${e.metaKey ? '⌘' : ''}${key}`;
}
