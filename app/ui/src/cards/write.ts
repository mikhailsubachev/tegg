// The lists the `Card` section sends with `type_patch` `card` (docs/contracts/v1-cards.md §6.1, §7.5; cards.md R214;
// FR-TYP-11 AC-21…AC-24, AC-26; D-1964, D-1985, D-2002). Pure. Each starts from `type.cardList` (R210's default when
// `cardDefault`: the first write seeds the list, D-1964) and keeps unknown and hand-written entries at their places
// (the type-columns §3 rules); every entry is sent in NFC (FR-FMT-12).
import { CARD_BUILT_INS } from '@tegg/schema';
import type { TypeDto } from '../ipc/types';

type CardType = Pick<TypeDto, 'cardList' | 'cardKeys'> & { attributes: readonly { key: string; type: string }[] };

const nfc = (s: string) => s.normalize('NFC');
const start = (type: CardType): string[] => type.cardList.map(nfc);
const effective = (type: CardType): string[] => type.cardKeys.map(nfc);

/** Every NFC-equal entry of `key` removed (AC-26 (a), (b)). */
export function cardRemove(type: CardType, key: string): string[] {
  const k = nfc(key);
  return start(type).filter((e) => e !== k);
}

/** `key` appended (AC-22). */
export function cardAdd(type: CardType, key: string): string[] {
  return [...start(type), nfc(key)];
}

/** `key` placed right before `beforeKey`'s first entry (null: at the end); every other copy of `key` goes. */
function placeBefore(list: string[], key: string, beforeKey: string | null): string[] {
  const rest = list.filter((e) => e !== key);
  const i = beforeKey === null ? -1 : rest.indexOf(beforeKey);
  return i < 0 ? [...rest, key] : [...rest.slice(0, i), key, ...rest.slice(i)];
}

/** ⌥↑ / ⌥↓ (AC-23): one place among the effective rows; null when `key` is the first (up) or last (down) row. An
 *  unknown entry keeps its place after its predecessor. */
export function cardMove(type: CardType, key: string, delta: -1 | 1 | number): string[] | null {
  const k = nfc(key);
  const rows = effective(type);
  const i = rows.indexOf(k);
  const j = i + (delta < 0 ? -1 : 1);
  if (i < 0 || j < 0 || j >= rows.length) return null;
  const list = start(type);
  if (delta < 0) return placeBefore(list, k, rows[j]);
  // Down: right after the next row's entry.
  const rest = list.filter((e) => e !== k);
  const at = rest.indexOf(rows[j]);
  return [...rest.slice(0, at + 1), k, ...rest.slice(at + 1)];
}

/** A drag (AC-23): `key` dropped before `beforeKey` (null: after the last row). Nothing drops above `Title`. */
export function cardDrop(type: CardType, key: string, beforeKey: string | null): string[] {
  return placeBefore(start(type), nfc(key), beforeKey === null ? null : nfc(beforeKey));
}

/** `Add property`'s choices (AC-22; AP-1592, D-1985): the type's attributes not on the card in schema order (no
 *  `file`-kind attribute, never `review` or `title`), then the built-ins not on it. */
export function addChoices(type: CardType): { attributes: string[]; builtIns: string[] } {
  const on = new Set(effective(type));
  const attributes = type.attributes
    .filter((a) => a.type !== 'file' && !['review', 'title'].includes(nfc(a.key)) && !on.has(nfc(a.key)) && !CARD_BUILT_INS.includes(nfc(a.key)))
    .map((a) => nfc(a.key));
  const builtIns = CARD_BUILT_INS.filter((b) => !on.has(b));
  return { attributes, builtIns };
}
