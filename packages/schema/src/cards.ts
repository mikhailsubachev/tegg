// The card list of a type and the empty-value rule (docs/contracts/v1-cards.md §2.2, §3.2, §6.1; cards.md R209, R210,
// R212; D-2059, D-2076, D-2079). The TypeScript twin of `tegg-schema`'s `card.rs` and `tegg-core`'s `is_empty_value`,
// for the fake core and L1 tests; tied to the Rust crates by tests/fixtures/types/card-lists.json and card-empty.json.
// Pure TypeScript, platform-neutral (AR-03).

/** R209: the built-in keys a card list may hold besides attribute keys, in the order `Add property` offers them. */
export const CARD_BUILT_INS: readonly string[] = ['tags', 'body', 'description', 'source', 'aliases', 'created', 'modified'];
/** R210: undefined types, invalid type files. */
export const CARD_FALLBACK: readonly string[] = ['tags', 'body', 'modified'];
const TAG_CARD = ['body', 'modified'];
const PREVIEW_BUILT_INS = ['tags', 'source', 'aliases', 'created'];
/** R210 (D-2079): the system types' default lists. */
const SYSTEM_DEFAULTS: Readonly<Record<string, readonly string[]>> = {
  page: ['tags', 'body', 'modified'],
  task: ['tags', 'body', 'status', 'due', 'priority', 'recurrence', 'source'],
  'quick-note': ['body', 'created'],
  'daily-note': ['body', 'modified'],
  image: ['width', 'height', 'size', 'created'],
  pdf: ['tags', 'pages', 'size', 'created'],
  tag: TAG_CARD,
};

const nfc = (s: string) => s.normalize('NFC');

/** What `cardList` and `defaultCard` read of a type: its key, `preview` and attributes (key and kind). */
export type CardTypeInput = {
  key: string;
  preview?: readonly string[] | null;
  attributes?: readonly { key: string; type: string }[] | null;
};

export type CardListInput = CardTypeInput & {
  /** `ok`, `newer` or `invalid` (a TypeDto's `state`). */
  state?: string;
  /** `card:` as written when it is a list of strings; null when absent. */
  card?: readonly string[] | null;
  cardUnreadable?: boolean;
  /** A `type` value without a definition (D-121). */
  undefined?: boolean;
};

export type CardList = { list: string[]; default: boolean; keys: string[] };

/** R210 for a defined type: the system table for system keys (whatever their `preview` says); a user type `tags`, `body`,
 *  then each `preview` key that is an attribute key or one of `tags`, `source`, `aliases`, `created`, then `modified`;
 *  a repeated key counts once. */
export function defaultCard(type: CardTypeInput): string[] {
  const key = nfc(type.key);
  const sys = SYSTEM_DEFAULTS[key];
  if (sys) return [...sys];
  const attrs = (type.attributes ?? []).map((a) => nfc(a.key));
  const out = ['tags', 'body'];
  for (const p of (type.preview ?? []).map(nfc)) {
    if ((attrs.includes(p) || PREVIEW_BUILT_INS.includes(p)) && !out.includes(p)) out.push(p);
  }
  if (!out.includes('modified')) out.push('modified');
  return out;
}

type Entry = { kind: 'attribute' | 'builtIn' | 'skipped' | 'unknown'; key: string };

/** §2.2 matching: NFC-equal to an attribute key (its own spelling, NFC); built-ins NFC-exact, lower case only; `title`,
 *  `review` and `file`-kind attributes are skipped silently. */
function entry(type: CardTypeInput, e: string): Entry {
  const n = nfc(e);
  if (n === 'title' || n === 'review') return { kind: 'skipped', key: n };
  const a = (type.attributes ?? []).find((x) => nfc(x.key) === n);
  if (a) return a.type === 'file' ? { kind: 'skipped', key: n } : { kind: 'attribute', key: nfc(a.key) };
  if (CARD_BUILT_INS.includes(n)) return { kind: 'builtIn', key: n };
  return { kind: 'unknown', key: n };
}

/** The effective keys of a list: without unknown keys, repeats (first kept), `title`, `review`, `file`-kind keys. */
export function cardKeys(type: CardTypeInput, list: readonly string[]): string[] {
  const out: string[] = [];
  for (const e of list) {
    const x = entry(type, e);
    if ((x.kind === 'attribute' || x.kind === 'builtIn') && !out.includes(x.key)) out.push(x.key);
  }
  return out;
}

/** `card` entries that are neither an attribute key nor a built-in (NFC), each once, in file order (D-2076). */
export function cardIgnored(type: CardTypeInput, card: readonly string[]): string[] {
  if (nfc(type.key) === 'tag') return [];
  const out: string[] = [];
  for (const e of card) {
    const x = entry(type, e);
    if (x.kind === 'unknown' && !out.includes(x.key)) out.push(x.key);
  }
  return out;
}

/** R209 + R210: invalid or undefined → CARD_FALLBACK; `tag` → `[body, modified]` whatever the file says; otherwise
 *  `card` when present and readable, else `defaultCard`. Newer files are read. */
export function cardList(type: CardListInput): CardList {
  if (type.undefined || type.state === 'invalid') return { list: [...CARD_FALLBACK], default: true, keys: [...CARD_FALLBACK] };
  let list: string[];
  let def: boolean;
  if (nfc(type.key) === 'tag') [list, def] = [[...TAG_CARD], true];
  else if (type.card && !type.cardUnreadable) [list, def] = [[...type.card], false];
  else [list, def] = [defaultCard(type), true];
  return { list, default: def, keys: cardKeys(type, list) };
}

/** R212's last row: missing, `null`, `""`, `[]`, a string that is only U+2014 (or nothing) after trimming spaces, a list
 *  whose items are all empty by this rule. */
export function isEmpty(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === 'string') {
    const t = value.trim();
    return t === '' || t === '—';
  }
  if (Array.isArray(value)) return value.every(isEmpty);
  return false;
}
