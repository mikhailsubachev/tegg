// Searching the icon set (docs/contracts/v1-cards.md §7.7; FR-TYP-01 AC-14, AC-15; AP-1597, D-1990, D-1991). Pure:
// the picker's results for a typed query and its Suggested group for a property's or type's Name.
import type { IconSet } from './resolve';

export type IconResult = { name: string; bold: [number, number] | null };

/** §7.7: NFC, lower case, diacritics removed, trimmed; spaces become `-`. */
export function foldIconQuery(s: string): string {
  return s.normalize('NFC').toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').normalize('NFC').trim().replace(/\s+/g, '-');
}

const startsSegment = (n: string, q: string) => n.startsWith(q) || n.includes(`-${q}`);

function keywordMatch(set: IconSet, n: string, q: string): boolean {
  return (set.icons[n]?.k ?? []).some((k) => {
    const f = foldIconQuery(k);
    return f.startsWith(q) || f.split('-').some((w) => w.startsWith(q));
  });
}

/** Group 1 (a segment starts with `q`) and group 3 (a keyword only) of §7.7, each by name. */
function groups(set: IconSet, q: string): { g1: string[]; g2: string[]; g3: string[] } {
  const g1: string[] = [];
  const g2: string[] = [];
  const g3: string[] = [];
  for (const n of set.names) {
    if (startsSegment(n, q)) g1.push(n);
    else if (n.includes(q)) g2.push(n);
    else if (keywordMatch(set, n, q)) g3.push(n);
  }
  return { g1, g2, g3 };
}

/** §7.7 Results: names where the query starts a segment, then names containing it, then keyword-only matches; an alias
 *  equal to or starting with the query puts its target first. `bold` is the first occurrence in the name. */
export function searchIcons(set: IconSet, query: string): IconResult[] {
  const q = foldIconQuery(query);
  if (!q) return [];
  const { g1, g2, g3 } = groups(set, q);
  const first = [...new Set(Object.entries(set.aliases).filter(([a]) => a === q || a.startsWith(q)).map(([, t]) => t).filter((t) => Object.hasOwn(set.icons, t)))];
  const kwOnly = new Set(g3);
  const bold = (n: string): [number, number] | null => {
    const i = n.indexOf(q);
    return i < 0 ? null : [i, i + q.length];
  };
  const group1 = [...first, ...g1.filter((n) => !first.includes(n))];
  const rest = [...g2, ...g3].filter((n) => !first.includes(n));
  return [...group1.map((name) => ({ name, bold: bold(name) })), ...rest.map((name) => ({ name, bold: kwOnly.has(name) ? null : bold(name) }))];
}

export const SUGGESTED_MAX = 12;

/** §7.7 Suggested: each word of `name` (split on spaces and `-`), folded, with 3 or more letters, matched as groups 1
 *  and 3; their union in that order without repeats, at most 12. */
export function suggestIcons(set: IconSet, name: string): string[] {
  const out: string[] = [];
  const words = foldIconQuery(name).split('-').filter((w) => (w.match(/\p{L}/gu) ?? []).length >= 3);
  for (const w of words) {
    const { g1, g3 } = groups(set, w);
    for (const n of [...g1, ...g3]) {
      if (out.length >= SUGGESTED_MAX) return out;
      if (!out.includes(n)) out.push(n);
    }
  }
  return out;
}
