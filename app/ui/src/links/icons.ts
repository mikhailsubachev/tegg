// The icon a link chip shows for its target's type (FR-LNK-07 AC-1, D-73, D-217): the type definition's icon name
// as `data-icon`, drawn with the shell's glyph. The app keeps the vault's types here when it loads them.
import type { TypeDefDto } from '../ipc/types';
import { SYSTEM_DEFAULT, typeIconName } from '../shell/Icon';

let defs = new Map<string, string>();
let names = new Map<string, string>();
let all: TypeDefDto[] = [];
let allSig = '[]';

/** The vault's types as last loaded (embed cards and modes read them, ms4-embeds §6). */
export function chipTypes(): TypeDefDto[] {
  return all;
}

const typeListeners = new Set<() => void>();
/** Called after the app loaded the vault's types again (a type file changed); returns the unsubscribe. */
export function onChipTypes(f: () => void): () => void {
  typeListeners.add(f);
  return () => { typeListeners.delete(f); };
}

export function setChipTypes(types: TypeDefDto[]): void {
  // The app hands a new array on every reload; listeners hear only of definitions that differ.
  const sig = JSON.stringify(types);
  const changed = sig !== allSig;
  allSig = sig;
  all = types;
  defs = new Map(types.map((t) => [t.key.normalize('NFC'), t.icon]));
  names = new Map(types.map((t) => [t.key.normalize('NFC'), t.name]));
  if (changed) for (const f of typeListeners) f();
}

/** `glyph` for `Icon name`, `def` for `data-icon`. */
export function chipIcon(typeKey: string | null | undefined): { glyph: string; def: string } {
  const key = (typeKey ?? 'page').normalize('NFC');
  const icon = defs.get(key) || SYSTEM_DEFAULT[key] || 'file-text';
  return { glyph: typeIconName(key, defs.get(key)), def: icon };
}

const SYSTEM_NAMES: Record<string, string> = { page: 'Page', task: 'Task', 'quick-note': 'Quick Note', 'daily-note': 'Daily Note', tag: 'Tag', image: 'Image', pdf: 'PDF' };

/** The type's Name for details lines (FR-LNK-14 AC-6). */
export function typeNameOf(typeKey: string): string {
  const k = typeKey.normalize('NFC');
  return names.get(k) ?? SYSTEM_NAMES[k] ?? typeKey;
}
