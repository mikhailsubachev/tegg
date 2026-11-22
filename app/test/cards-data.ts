// Data for the slice OC L1 tests (docs/acceptance/cards.md; docs/contracts/v1-cards.md §4.2, §6.1): type files of the
// fixtures as `TypeDto`s (cards.md R209, R210, with the contract's OC fields), the corpora tests/fixtures/types/
// card-lists.json and card-empty.json, and the card data of tests/fixtures/vaults/cards/expected-card-data.json. No
// assertions here. The icon nodes are left empty: the model passes `resolvedIcon` through (§5.4).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse as yamlParse } from 'yaml';

export const REPO = resolve(import.meta.dirname, '../..');
export const read = (rel: string) => readFileSync(resolve(REPO, rel), 'utf8');
export const nfc = (s: string) => s.normalize('NFC');
export const NFD = (s: string) => s.normalize('NFD');
/** The test clock (cards.md): Thursday 19 Nov 2026, 10:00 in Prague. */
export const NOW = Date.parse('2026-11-19T10:00:00+01:00');
export const PRAGUE = 'Europe/Prague';
export const LA = 'America/Los_Angeles';
export const REGION_DATES = { date: 'region', time: 'region', week: 'region' };
export const ISO_DATES = { date: 'iso', time: '24', week: 'region' };

/** Lucide 0.460 names the fixtures use; `check-square` is the alias of `square-check-big` (D-1955). */
const KNOWN = new Set(['map', 'map-pin', 'circle-dot', 'backpack', 'calendar', 'link', 'newspaper', 'square-check-big', 'zap', 'image', 'file', 'file-text', 'book', 'user',
  'mountain', 'tent', 'folder', 'hash', 'check']);
export function resolvedIcon(name: string | null | undefined): { name: string; node: [string, Record<string, string>][] } | null {
  if (!name) return null;
  const canonical = name === 'check-square' ? 'square-check-big' : name;
  return KNOWN.has(canonical) ? { name: canonical, node: [] } : null;
}

export type Corpus = { name: string; key: string; state: 'ok' | 'invalid' | 'newer' | 'undefined'; file: string | null; expected: { list: string[]; default: boolean; keys: string[]; ignored: string[]; unreadable: boolean } };
export const CARD_LISTS: Corpus[] = JSON.parse(read('tests/fixtures/types/card-lists.json'));
export const CARD_EMPTY: { value: unknown; empty: boolean }[] = JSON.parse(read('tests/fixtures/types/card-empty.json'));
export const CARD_DATA: Record<string, any> = JSON.parse(read('tests/fixtures/vaults/cards/expected-card-data.json')).cards;

const AREADONLY: Record<string, string> = { file: 'file', color: 'color', recurrence: 'recurrence' };
/** A type file's text as the twin's input (§6.1 `cardList`) and as a `TypeDto` with OC's fields. */
export function typeDto(key: string, text: string | null, state: Corpus['state'] = 'ok', expected?: Corpus['expected']): any {
  let doc: any = {};
  try { doc = text ? yamlParse(text) ?? {} : {}; } catch { doc = {}; }
  const hasCard = doc && typeof doc === 'object' && 'card' in doc;
  const cardOk = hasCard && Array.isArray(doc.card) && doc.card.every((x: unknown) => typeof x === 'string');
  const attributes = (Array.isArray(doc.attributes) ? doc.attributes : []).map((a: any) => ({
    key: String(a.key), name: String(a.name ?? a.key), type: String(a.type ?? 'text'), supported: true, readOnlyReason: AREADONLY[a.type] ?? null, default: a.default ?? null,
    required: false, options: (a.options ?? []).map((o: any) => ({ label: String(o.label), color: o.color ?? null, state: o.state ?? null })), to: a.to ?? null, multiple: !!a.multiple,
    description: null, builtIn: false, icon: typeof a.icon === 'string' ? a.icon : null, resolvedIcon: resolvedIcon(typeof a.icon === 'string' ? a.icon : null),
  }));
  const review = doc.review === true ? 'on' : doc.review === 'locked' ? 'locked' : 'off';
  return {
    key, name: doc.name ?? key, plural: doc.plural ?? key, folder: doc.folder ?? key, icon: doc.icon ?? 'file-text', color: doc.color ?? 'gray', system: !!doc.system,
    invalid: state === 'invalid', exists: text !== null, version: null, state: state === 'undefined' ? 'ok' : state, error: null, declaredVersion: doc.version ?? null,
    description: doc.description ?? null, review, preview: Array.isArray(doc.preview) ? doc.preview : [], previewIgnored: [], template: null, attributes,
    hidden: [], columns: null, columnsIgnored: [], columnsUnreadable: false, embed: 'card', embedRaw: null, views: doc.views ?? null, viewsUnreadable: false,
    card: cardOk ? doc.card : null, cardUnreadable: hasCard && !cardOk,
    cardList: expected?.list ?? [], cardDefault: expected?.default ?? true, cardKeys: expected?.keys ?? [], cardIgnored: expected?.ignored ?? [],
    resolvedIcon: resolvedIcon(doc.icon ?? null),
  };
}
const corpusOf = (key: string, name?: string) => CARD_LISTS.find((c) => c.key === key && (!name || c.name.startsWith(name)))!;
/** The fixture types with their R209/R210 card lists (from the corpus's first entry for the key). */
export function fixtureType(key: string): any {
  const c = corpusOf(key);
  return typeDto(key, c.file, c.state, c.expected);
}
/** A runtime variant: `text` with the card fields of the corpus entry named `name`. */
export function variantType(key: string, name: string): any {
  const c = corpusOf(key, name);
  return typeDto(key, c.file, c.state, c.expected);
}
export const TYPES = () => ['výlet', 'článek', 'kontrola', 'book', 'autor', 'page', 'task', 'quick-note', 'daily-note', 'image', 'pdf', 'tag'].map(fixtureType);

export const P = {
  snezka: 'Výlety/Sněžka z Pece.md', machovo: 'Výlety/Okolo Máchova jezera.md', palava: 'Výlety/Pálava na kole.md', magistrala: 'Výlety/Krkonošská magistrála.md',
  chaty: 'Články/Horské chaty.md', podklady: 'Články/Podklady k výletům.md', bez: 'Články/Bez zdroje.md', textovy: 'Články/Textový zdroj.md', odkaz: 'Články/Odkaz na výlet.md',
  kontrola: 'Kontroly/Kontrola kola.md', napad: 'Quick Notes/Nápad na výlet.md', vyhlidka: 'Images/Vyhlídka na Pálavě.md', pravidla: 'PDFs/Pravidla tábora.md',
  ucetni: 'Books/Účetní ze Žižkova.md', karty: 'Pages/Karty.md',
} as const;
export const card = (path: string): any => structuredClone(CARD_DATA[nfc(path)]);
