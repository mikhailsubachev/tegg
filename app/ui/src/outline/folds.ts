// Slice OL (docs/contracts/v1-outline.md §5; outline.md R176, D-1611): the Outline's fold state in `ui-state.json`,
// `vaults[<vault path, NFC>].outline.collapsed[<note key>]`. Pure: every function returns a new UI state.
export const OUTLINE_NOTES_MAX = 200;

type Collapsed = Record<string, string[]>;
type VaultEntry = Record<string, unknown> & { outline?: { collapsed?: Collapsed } & Record<string, unknown> };
type Ui = { vaults?: Record<string, unknown> } & Record<string, unknown>;

/** The note's `id` (NFC), else its vault path in NFC (as page width's key). */
export function noteKey(id: string | null | undefined, path: string): string {
  return id && id.trim() !== '' ? id.normalize('NFC') : path.normalize('NFC');
}

const vaultOf = <U extends Ui>(ui: U, vault: string): VaultEntry => (ui.vaults?.[vault.normalize('NFC')] ?? {}) as VaultEntry;

/** The collapsed keys stored for a note; undefined when none. */
export function foldsOf(ui: Ui | null | undefined, vault: string, key: string): string[] | undefined {
  if (!ui) return undefined;
  const v = vaultOf(ui, vault).outline?.collapsed?.[key.normalize('NFC')];
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : undefined;
}

function withCollapsed<U extends Ui>(ui: U, vault: string, collapsed: Collapsed): U {
  const vk = vault.normalize('NFC');
  const entry = vaultOf(ui, vault);
  return { ...ui, vaults: { ...(ui.vaults ?? {}), [vk]: { ...entry, outline: { ...(entry.outline ?? {}), collapsed } } } };
}

/** A user's fold change of one note: keys not in `valid` are dropped; none left → the note's entry is deleted;
 *  otherwise it moves last (the order of the last change); above `OUTLINE_NOTES_MAX` the first entries go. */
export function withFolds<U extends Ui>(ui: U, vault: string, key: string, keys: readonly string[], valid: readonly string[]): U {
  const k = key.normalize('NFC');
  const order = new Map(valid.map((x, i) => [x.normalize('NFC'), i]));
  const kept = [...new Set(keys.map((x) => x.normalize('NFC')))].filter((x) => order.has(x)).sort((a, b) => order.get(a)! - order.get(b)!);
  const old = vaultOf(ui, vault).outline?.collapsed ?? {};
  const next: Collapsed = {};
  for (const [n, v] of Object.entries(old)) if (n !== k) next[n] = v;
  if (kept.length) next[k] = kept;
  const names = Object.keys(next);
  for (let i = 0; i < names.length - OUTLINE_NOTES_MAX; i++) delete next[names[i]];
  return withCollapsed(ui, vault, next);
}

/** Moves a note's entry from its path key to its new `id` key (last place) when the `id` has none; null when there is
 *  nothing to move. */
export function rekeyFolds<U extends Ui>(ui: U, vault: string, from: string, to: string): U | null {
  const f = from.normalize('NFC');
  const tk = to.normalize('NFC');
  if (f === tk) return null;
  const old = vaultOf(ui, vault).outline?.collapsed ?? {};
  if (!Array.isArray(old[f]) || old[tk] !== undefined) return null;
  const next: Collapsed = {};
  for (const [n, v] of Object.entries(old)) if (n !== f) next[n] = v;
  next[tk] = old[f];
  return withCollapsed(ui, vault, next);
}
