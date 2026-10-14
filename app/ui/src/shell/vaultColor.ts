// The vault switcher's colour dot (D-219, docs/contracts/ms3-shell.md §12.5): a type colour picked by hashing the
// folder path, so the same folder always gets the same colour and nothing is stored.
import { light } from '../theme/tokens';

/** The type colour names of the theme tokens (`blue`, `green`, …); the dot uses `var(--type-<name>)`. */
export const VAULT_COLORS: readonly string[] = Object.keys(light)
  .map((k) => /^type-([a-z]+)$/.exec(k)?.[1])
  .filter((n): n is string => !!n);

/** FNV-1a (32 bit) over the UTF-8 bytes of the NFC path (FR-FMT-12). */
function fnv1a32(s: string): number {
  let h = 0x811c9dc5;
  for (const b of new TextEncoder().encode(s)) {
    h ^= b;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export function vaultColor(path: string): string {
  return VAULT_COLORS[fnv1a32(path.normalize('NFC')) % VAULT_COLORS.length];
}
