// Icon names (docs/contracts/v1-cards.md §5.3, §5.4, §6.1; D-1955, D-1991). Pure: the canonical name of a name in a
// loaded set (itself, else its alias target), and the drawings the core resolved into the type DTOs, which everything
// but the picker draws from (no surface loads the set to draw an icon in use).
import type { AttributeDto, ResolvedIconDto, TypeDto } from '../ipc/types';

/** Lucide's icon-node format: `[tag, attributes]`. */
export type IconNode = [string, Record<string, string>][];
/** The data file's shape (§5.1). */
export type IconData = { lucide: string; package: string; integrity: string; count: number; icons: Record<string, { n: IconNode; k: string[] }> };
/** The loaded set: icons by name, the names in code-point order, and the aliases (§5.3). */
export type IconSet = { version: string; icons: Record<string, { n: IconNode; k: string[] }>; names: string[]; aliases: Record<string, string> };

/** D-1955: the canonical Lucide name of `name` (itself, else its alias target); null for an unknown, empty or non-ASCII
 *  name (FR-FMT-12 AC-15). */
export function resolveIcon(set: IconSet, name: string | null | undefined): string | null {
  const n = (name ?? '').trim();
  if (!n || !/^[\x00-\x7f]+$/.test(n)) return null;
  if (Object.hasOwn(set.icons, n)) return n;
  const t = Object.hasOwn(set.aliases, n) ? set.aliases[n] : undefined;
  return t && Object.hasOwn(set.icons, t) ? t : null;
}

/** §5.4: a type's icon as the core resolved it (null: undefined type or unknown name → R14's generic glyph). */
export function typeIcon(types: readonly TypeDto[], key: string | null | undefined): ResolvedIconDto | null {
  const k = (key ?? '').normalize('NFC');
  return types.find((t) => t.key.normalize('NFC') === k)?.resolvedIcon ?? null;
}

/** §5.4: a property's icon as the core resolved it (null: no icon or an unknown name). */
export function attrIcon(attr: AttributeDto | null | undefined): ResolvedIconDto | null {
  return attr?.resolvedIcon ?? null;
}
