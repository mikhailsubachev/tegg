// Slice OC, L0 and L1: the card's pure models (docs/contracts/v1-cards.md §6.1, §7.1…§7.3): `@tegg/schema` `cardList`,
// `isEmpty`, `defaultCard` (the TS twin of `tegg-schema`'s card list, tied by tests/fixtures/types/card-lists.json and
// card-empty.json), `cards/model.ts` (`cardParts`, `urlChipText`, `localItem`, `footerDateText`, `moreHint`),
// `cards/task.ts` (D-1904's Task rules), `cards/write.ts` (the lists `type_patch` `card` sends, `addChoices`) and the L0
// rule of FR-TYP-11 AC-17 (one component). Criteria: docs/acceptance/cards.md FR-TYP-11 AC-5…AC-14, AC-16, AC-17,
// AC-22, AC-23, AC-26, FR-FMT-12 AC-15; views.md FR-QRY-05 AC-30, AC-31 (the parts); embeds.md FR-EMB-02 AC-19 (the
// renderer's list); previews.md FR-LNK-10 AC-17 (the strip's items). Expected cards: cards.md R218 at the test clock
// (`2026-11-19T10:00:00+01:00`, Europe/Prague, `en-US`, Date & time `Region`). Written from the ACs and the contract only
// (D-61). Modules load inside the tests (TS-I1).
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { CARD_EMPTY, CARD_LISTS, ISO_DATES, LA, NFD, NOW, P, PRAGUE, REGION_DATES, REPO, card, fixtureType, nfc, read, typeDto, variantType } from './cards-data';

type Mod = Record<string, any>;
async function load(path: string, what: string): Promise<Mod> {
  let m: Mod | null = null;
  try { m = (await import(/* @vite-ignore */ path)) as Mod; } catch { m = null; }
  assert.ok(m, `${what} loads (v1-cards §6.1)`);
  return m!;
}
function has(m: Mod, names: string[], what: string): Mod {
  for (const n of names) assert.equal(typeof m[n], 'function', `${what} exports ${n} (v1-cards §6.1)`);
  return m;
}
const schema = async () => has(await load('@tegg/schema', '@tegg/schema'), ['cardList', 'isEmpty', 'defaultCard'], '@tegg/schema');
const model = async () => has(await load('../ui/src/cards/model.ts', 'ui/src/cards/model.ts'), ['cardParts', 'urlChipText', 'localItem', 'footerDateText', 'moreHint'], 'cards/model.ts');
const write = async () => has(await load('../ui/src/cards/write.ts', 'ui/src/cards/write.ts'), ['cardRemove', 'cardAdd', 'cardMove', 'cardDrop', 'addChoices'], 'cards/write.ts');

const at = (o: Record<string, unknown> = {}) => ({ now: NOW, zone: PRAGUE, region: 'en-US', dateSetting: REGION_DATES, ...o });
async function parts(path: string, o: Record<string, unknown> = {}, type?: any, data?: any): Promise<any> {
  const m = await model();
  const c = data ?? card(path);
  assert.ok(c, `setup: ${path} is in expected-card-data.json`);
  return m.cardParts({ type: type ?? fixtureType(c.type), card: c, ...at(o) });
}
/** An item as `[kind, key, value]` (pills), `[kind, key]` (links, local items) or `[kind]`. */
const proj = (i: any): unknown[] => (i.kind === 'pill' ? ['pill', i.key, i.value] : i.kind === 'unreviewed' ? ['unreviewed'] : [i.kind, i.key]);
const text = (x: unknown) => JSON.stringify(x ?? null).normalize('NFC');
const colour = (d: unknown) => (d === null || d === undefined ? null : String(d).replace(/^var\(/, '').replace(/\)$/, '').replace(/^--type-/, ''));

// ------------------------------------------------------------------------------------------------ FR-TYP-11 AC-5, AC-6

test('fr_typ_11_ac5_default_card_lists', async () => {
  const s = await schema();
  const bad: string[] = [];
  for (const c of CARD_LISTS) {
    const t = typeDto(c.key, c.file, c.state);
    const got = s.cardList({ key: c.key, state: c.state === 'undefined' ? 'ok' : c.state, card: c.state === 'undefined' ? null : t.card, cardUnreadable: t.cardUnreadable, preview: t.preview, attributes: t.attributes, undefined: c.state === 'undefined' });
    const want = { list: c.expected.list, default: c.expected.default, keys: c.expected.keys };
    if (JSON.stringify({ list: got?.list, default: got?.default, keys: got?.keys }) !== JSON.stringify(want)) bad.push(`${c.name}: ${JSON.stringify(got)}`);
  }
  assert.deepEqual(bad, [], '@tegg/schema cardList equals the corpus (contract §2.2)');
  assert.deepEqual(s.defaultCard(typeDto('book', read('tests/fixtures/vaults/views/.tegg/types/book.yml'))), ['tags', 'body', 'author', 'status', 'modified'], 'defaultCard(Book)');
  assert.deepEqual([s.CARD_BUILT_INS, s.CARD_FALLBACK], [['tags', 'body', 'description', 'source', 'aliases', 'created', 'modified'], ['tags', 'body', 'modified']], 'the constants');
});

test('fr_typ_11_ac6_card_key_is_read', async () => {
  const s = await schema();
  const v = typeDto('výlet', read('tests/fixtures/vaults/cards/.tegg/types/výlet.yml'));
  const got = s.cardList({ key: 'výlet', state: 'ok', card: v.card, cardUnreadable: false, preview: v.preview, attributes: v.attributes });
  assert.deepEqual(got.keys, ['tags', 'description', 'stav', 'náročnost', 'kraj', 'vybavení', 'délka', 'termín', 'odkaz', 'průvodce', 'modified'], 'Výlet\'s effective keys');
  assert.deepEqual(s.cardList({ key: 'výlet', state: 'ok', card: v.card, cardUnreadable: false, preview: [], attributes: v.attributes }), got, 'preview doesn\'t matter while card: exists');
  // card: [] gives Sněžka a card with only its lead, title and ⋯.
  const p = await parts(P.snezka, {}, variantType('výlet', 'výlet card: []'), { ...card(P.snezka), keys: [], values: {} });
  assert.deepEqual([p.items, p.tags.shown, p.text, p.footer.link, p.footer.date], [[], [], null, null, null], 'card: [] draws no part but lead and title');
});

// ------------------------------------------------------------------------------------------------ FR-TYP-11 AC-7 (R218)

const SNEZKA_ITEMS: unknown[][] = [
  ['pill', 'stav', 'Hotový'], ['pill', 'náročnost', 'Střední'], ['pill', 'kraj', 'Královéhradecký'],
  ...['Mapa', 'Čelovka', 'Pláštěnka', 'Termoska', 'Lékárnička', 'Hůlky', 'Rukavice', 'Čepice', 'Svačina', 'Nabíječka'].map((v) => ['pill', 'vybavení', v]),
  ['pill', 'délka', '12'], ['pill', 'termín', 'Feb 14, 2026'], ['link', 'odkaz'],
];
/** R218: [path, lead (data-icon as written), tags shown, more, text, items, footer link text or null, footer date]. */
const R218: [string, string, string[], number, string | null, unknown[][], string | null, string][] = [
  [P.snezka, 'map', ['hory', 'zima', 'rodina'], 1, 'Zimní výstup s rodinou, vrchol v mlze.', SNEZKA_ITEMS, 'Eva Lindová', 'Edited today'],
  [P.machovo, 'map', [], 0, null, [], null, 'Edited Nov 12, 2026'],
  [P.palava, 'map', ['kolo'], 0, null, [['pill', 'stav', 'Rozpracovaný'], ['pill', 'náročnost', 'Lehká'], ['pill', 'kraj', 'Jihomoravský'], ['link', 'odkaz']], 'Neexistující průvodce', 'Edited yesterday'],
  [P.magistrala, 'map', ['hory'], 0, null, [['pill', 'stav', 'Plánovaný'], ['pill', 'náročnost', 'Těžká'], ['pill', 'termín', 'Jan 15, 2027']], null, 'Edited Mon'],
  [P.chaty, 'newspaper', [], 0, 'Přehled chat na hřebenech, kde se dá přespat i v zimě.', [['unreviewed'], ['pill', 'rubrika', 'Cestování']], 'example.org/horske-chaty', 'Created yesterday'],
  [P.podklady, 'newspaper', [], 0, null, [['pill', 'rubrika', 'Příroda']], '↗ Podklady k výletům', 'Created Fri'],
  [P.bez, 'newspaper', [], 0, null, [['unreviewed']], null, 'Created today'],
  [P.textovy, 'newspaper', [], 0, 'první bod seznamu Odstavec za seznamem.', [['pill', 'rubrika', 'Cestování'], ['pill', 'source', 'Kniha Krkonoše a Jizerky']], null, 'Created Nov 10, 2026'],
  [P.odkaz, 'newspaper', [], 0, 'Trasa je popsaná v samostatné poznámce.', [], 'Sněžka z Pece', 'Created Tue'],
  [P.kontrola, 'check-square', ['kolo'], 0, 'Brzdy seřízené, řetěz namazaný.', [], null, 'Edited Tue'],
  [P.napad, 'zap', [], 0, 'Zkusit Jizerky na běžkách, až napadne sníh.', [['unreviewed']], null, 'Created today'],
  [P.vyhlidka, 'image', [], 0, null, [['pill', 'width', '64'], ['pill', 'height', '48'], ['pill', 'size', '1.2 KB']], null, 'Added Mon'],
  [P.pravidla, 'file', ['tábor'], 0, null, [['pill', 'pages', '2'], ['pill', 'size', '844 bytes']], null, 'Added Nov 2, 2026'],
  [P.ucetni, 'book', [], 0, 'Kriminálka z kanceláře nad hospodou.', [['pill', 'status', 'Reading']], 'Jana Brázdová', 'Edited Mon'],
];

test('fr_typ_11_ac7_the_parts_of_a_card', async () => {
  const bad: string[] = [];
  for (const [path, lead, tags, more, txt, items, link, date] of R218) {
    const p = await parts(path);
    const got = { lead: text(p.lead).includes(`"${lead}"`), tags: p.tags.shown, more: p.tags.more, text: p.text?.text ?? null, items: p.items.map(proj), link: p.footer.link ? text(p.footer.link).includes(link ?? '\u0000') : null, date: p.footer.date?.text ?? null };
    const want = { lead: true, tags, more, text: txt, items, link: link === null ? null : true, date };
    if (JSON.stringify(got) !== JSON.stringify(want)) bad.push(`${path}:\n got  ${JSON.stringify(got)}\n want ${JSON.stringify(want)}`);
  }
  assert.deepEqual(bad, [], 'cardParts equals R218 for every card (parts in R211\'s order)');
  const strips = await Promise.all([P.vyhlidka, P.pravidla, P.snezka].map(async (x) => (await parts(x)).strip));
  assert.deepEqual(strips, ['image', 'pdf', null], 'the strip: Image and PDF only');
  const sn = await parts(P.snezka);
  assert.ok(!text(sn).includes('neznámý-klíč') && !text(sn).includes('poznámka'), 'neither the unknown key nor poznámka appears');
});

// ------------------------------------------------------------------------------------------------ FR-TYP-11 AC-8

test('fr_typ_11_ac8_empty_values_draw_nothing', async () => {
  const s = await schema();
  const bad = CARD_EMPTY.filter((c) => s.isEmpty(c.value) !== c.empty).map((c) => JSON.stringify(c));
  assert.deepEqual(bad, [], 'isEmpty follows R212\'s last row (card-empty.json)');
  const m = (await parts(P.machovo)).items;
  assert.deepEqual(m, [], 'Máchovo: no item');
  const kraj = async (v: unknown) => (await parts(P.machovo, {}, undefined, { ...card(P.machovo), values: { ...card(P.machovo).values, kraj: v } })).items.map(proj);
  assert.deepEqual(await kraj(' — '), [], '" — " draws nothing');
  assert.deepEqual(await kraj('–'), [['pill', 'kraj', '–']], 'the en dash draws a pill');
  assert.deepEqual(await kraj('-'), [['pill', 'kraj', '-']], 'a hyphen draws a pill');
  assert.deepEqual(await kraj('— nic'), [['pill', 'kraj', '— nic']], '"— nic" draws');
  const vyb = async (v: unknown) => (await parts(P.machovo, {}, undefined, { ...card(P.machovo), values: { ...card(P.machovo).values, vybavení: v } })).items.map(proj);
  assert.deepEqual(await vyb(['Mapa', '—']), [['pill', 'vybavení', 'Mapa']], '[Mapa, —]: one pill');
  assert.deepEqual(await vyb(['—']), [], '[—]: nothing');
  const k = variantType('kontrola', 'kontrola card: [výsledek]');
  const res = async (v: boolean) => (await parts(P.kontrola, {}, k, { ...card(P.kontrola), keys: ['výsledek'], values: { výsledek: v }, excerpt: null })).items.map(proj);
  assert.deepEqual([await res(false), await res(true)], [[], [['pill', 'výsledek', 'Yes']]], 'false draws nothing, true draws Yes (AP-1585)');
});

// ------------------------------------------------------------------------------------------------ FR-TYP-11 AC-9

test('fr_typ_11_ac9_the_card_text', async () => {
  const sn = await parts(P.snezka);
  assert.deepEqual(sn.text, { from: 'description', text: 'Zimní výstup s rodinou, vrchol v mlze.' }, 'Sněžka: its description');
  const noDesc = await parts(P.snezka, {}, undefined, { ...card(P.snezka), values: { ...card(P.snezka).values, description: null } });
  assert.equal(noDesc.text, null, 'without a description: no text (body isn\'t on Výlet\'s card)');
  const both = variantType('výlet', 'výlet card: [description, body, stav]');
  const data = (p: string, excerpt: string) => ({ ...card(p), keys: ['description', 'body', 'stav'], excerpt });
  assert.deepEqual((await parts(P.snezka, {}, both, data(P.snezka, 'Z Pece přes Obří důl na vrchol a zpět lanovkou.'))).text?.from, 'description', '[description, body, …]: Sněžka its description');
  assert.deepEqual((await parts(P.magistrala, {}, both, data(P.magistrala, 'Celý hřeben za tři dny.'))).text, { from: 'body', text: 'Celý hřeben za tři dny.' }, 'Magistrála (no description): its body');
  const rev = { ...both, cardList: ['body', 'description'], cardKeys: ['body', 'description'] };
  const d2 = (p: string, excerpt: string) => ({ ...card(p), keys: ['body', 'description'], excerpt });
  assert.deepEqual((await parts(P.snezka, {}, rev, d2(P.snezka, 'Z Pece přes Obří důl na vrchol a zpět lanovkou.'))).text, { from: 'body', text: 'Z Pece přes Obří důl na vrchol a zpět lanovkou.' }, '[body, description]: the first in list order that has text');
  assert.equal((await parts(P.chaty)).text?.text, 'Přehled chat na hřebenech, kde se dá přespat i v zimě.', 'Chaty: the heading is not shown');
});

// ------------------------------------------------------------------------------------------------ FR-TYP-11 AC-10

test('fr_typ_11_ac10_pills', async () => {
  const sn = await parts(P.snezka);
  const pill = (key: string, i = 0) => sn.items.filter((x: any) => x.key === key)[i];
  const stav = pill('stav');
  assert.deepEqual([stav?.icon?.name, colour(stav?.dot), stav?.value, stav?.label, stav?.title, stav?.invalid], ['circle-dot', 'green', 'Hotový', 'Stav: Hotový', 'Stav', false], 'stav: icon, green dot, value, accessible name, tooltip');
  const nar = pill('náročnost');
  assert.deepEqual([nar?.icon ?? null, nar?.name, colour(nar?.dot), nar?.value], [null, 'Náročnost', 'yellow', 'Střední'], 'náročnost: no icon, the Name, a yellow dot');
  assert.deepEqual(sn.items.filter((x: any) => x.key === 'vybavení').map((x: any) => [x.icon?.name, x.label]), [
    ['backpack', 'Vybavení: Mapa'], ['backpack', 'Vybavení: Čelovka'], ['backpack', 'Vybavení: Pláštěnka'], ['backpack', 'Vybavení: Termoska'], ['backpack', 'Vybavení: Lékárnička'],
    ['backpack', 'Vybavení: Hůlky'], ['backpack', 'Vybavení: Rukavice'], ['backpack', 'Vybavení: Čepice'], ['backpack', 'Vybavení: Svačina'], ['backpack', 'Vybavení: Nabíječka'],
  ], 'one pill per multi-select value, each with the icon');
  const del = pill('délka');
  assert.deepEqual([del?.icon ?? null, del?.name, del?.value], [null, 'Délka v km', '12'], 'an unknown icon: the Name');
  assert.equal(pill('termín')?.value, 'Feb 14, 2026', 'the date by the region en-US');
  const cs = await parts(P.snezka, { region: 'cs' });
  assert.equal(cs.items.find((x: any) => x.key === 'termín')?.value, new Intl.DateTimeFormat('cs', { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date('2026-02-14T00:00:00Z')), 'region cs: its medium date (D-160)');
  const iso = await parts(P.snezka, { dateSetting: ISO_DATES });
  assert.equal(iso.items.find((x: any) => x.key === 'termín')?.value, '2026-02-14', 'Date & time ISO (D-781)');
  const pal = (await parts(P.palava)).items.find((x: any) => x.key === 'stav');
  assert.deepEqual([pal?.dot ?? null, pal?.invalid, pal?.value], [null, true, 'Rozpracovaný'], 'not an option: no dot, the warning');
});

// ------------------------------------------------------------------------------------------------ FR-TYP-11 AC-11

test('fr_typ_11_ac11_two_rows_then_more', async () => {
  const m = await model();
  const sn = await parts(P.snezka);
  assert.equal(sn.items.length, 16, 'Sněžka: 16 items in the pill area');
  const hidden = sn.items.slice(11); // Svačina is item 11 (D-2126)
  const hint = String(m.moreHint(hidden));
  assert.ok(hint.startsWith('Not shown: Vybavení: Svačina, '), `moreHint lists the hidden items by their accessible names: ${hint}`);
  const board = await parts(P.snezka, { hideKey: 'stav' });
  assert.equal(board.items.length, 15, 'on the board (stav groups): 15 items');
  const chaty = await parts(P.chaty);
  assert.deepEqual(proj(chaty.items[0]), ['unreviewed'], 'Unreviewed is the first item');
  const aliases = Array.from({ length: 12 }, (_, i) => `Alias ${i + 1}`);
  const many = await parts(P.chaty, {}, { ...fixtureType('článek'), cardList: ['rubrika', 'aliases', 'source', 'created'], cardKeys: ['rubrika', 'aliases', 'source', 'created'] }, { ...card(P.chaty), keys: ['rubrika', 'aliases', 'source', 'created'], values: { ...card(P.chaty).values, aliases } });
  assert.deepEqual([proj(many.items[0]), many.items.filter((x: any) => x.key === 'aliases').length], [['unreviewed'], 12], 'aliases: one pill each, Unreviewed still first');
  assert.ok(!String(m.moreHint(many.items.slice(5))).includes('Unreviewed'), 'Unreviewed is never counted among the hidden');
});

// ------------------------------------------------------------------------------------------------ FR-TYP-11 AC-12

test('fr_typ_11_ac12_the_footer', async () => {
  const m = await model();
  const f = (key: string, value: string, type = 'výlet', zone = PRAGUE) => m.footerDateText(key, value, type, NOW, zone, 'en-US', REGION_DATES);
  assert.deepEqual(
    [f('modified', '2026-11-19T08:30:00+01:00'), f('modified', '2026-11-18T19:00:00+01:00'), f('modified', '2026-11-16T20:00:00+01:00'), f('modified', '2026-11-12T10:00:00+01:00'),
      f('created', '2026-11-18T07:45:00+01:00', 'článek'), f('created', '2026-11-13T09:00:00+01:00', 'článek'), f('created', '2026-11-16T12:00:00+01:00', 'image'), f('created', '2026-11-02T09:00:00+01:00', 'pdf')],
    ['Edited today', 'Edited yesterday', 'Edited Mon', 'Edited Nov 12, 2026', 'Created yesterday', 'Created Fri', 'Added Mon', 'Added Nov 2, 2026'],
    'R218\'s footer dates'
  );
  assert.deepEqual([f('modified', '2026-11-18T23:30:00Z'), f('modified', '2026-11-18T23:30:00Z', 'výlet', LA)], ['Edited today', 'Edited yesterday'], '(TZ) the day in the machine\'s zone');
  assert.equal(f('modified', '2027-01-15T10:00:00+01:00'), 'Edited Jan 15, 2027', 'a future date: the medium date');
  // created and modified both on the list: the first in list order.
  const cm = variantType('výlet', 'výlet card: [created, modified]');
  const p = await parts(P.snezka, {}, cm, { ...card(P.snezka), keys: ['created', 'modified'], values: { created: '2026-02-10T18:00:00+01:00', modified: '2026-11-19T08:30:00+01:00' } });
  assert.deepEqual([p.footer.date?.key, p.footer.date?.text], ['created', 'Created Feb 10, 2026'], 'the first of created/modified in list order');
  // A multi-value relation: the first value and +1.
  const multi = { ...card(P.snezka), values: { ...card(P.snezka).values, průvodce: ['[[Eva Lindová]]', '[[Marek Sova]]'] }, links: [...card(P.snezka).links, { target: 'Marek Sova', kind: 'note', path: 'Autoři/Marek Sova.md', title: 'Marek Sova', type: 'autor' }] };
  const mt = fixtureType('výlet');
  mt.attributes = mt.attributes.map((a: any) => (a.key === 'průvodce' ? { ...a, multiple: true } : a));
  const pm = await parts(P.snezka, {}, mt, multi);
  assert.ok(text(pm.footer.link).includes('Eva Lindová') && text(pm.footer.link).includes('Marek Sova'), `the footer chip Eva Lindová with +1 naming Marek Sova: ${text(pm.footer.link)}`);
  const pal = await parts(P.palava);
  assert.ok(text(pal.footer.link).includes('unresolved') || text(pal.footer.link).includes('broken'), `Pálava's chip is broken: ${text(pal.footer.link)}`);
});

// ------------------------------------------------------------------------------------------------ FR-TYP-11 AC-13

test('fr_typ_11_ac13_url_values', async () => {
  const m = await model();
  assert.deepEqual(
    ['https://www.example.com/trasy/snezka-z-pece?zdroj=rss#mapa', 'https://example.org', 'https://www.example.org/clanky/horske-chaty?ref=rss#uvod', 'https://example.cz/m%C3%ADsta/Sn%C4%9B%C5%BEka/', 'http://example.org/'].map((u) => m.urlChipText(u)),
    ['example.com/snezka-z-pece', 'example.org', 'example.org/horske-chaty', 'example.cz/Sněžka', 'example.org'],
    'host without www., last non-empty segment percent-decoded and NFC, no query or fragment'
  );
  assert.equal(nfc(m.urlChipText('https://example.cz/m%C3%ADsta/Sn%C4%9B%C5%BEka/')), m.urlChipText('https://example.cz/m%C3%ADsta/Sn%C4%9B%C5%BEka/'), 'NFC');
  const folder = m.localItem('file:///Users/test/Dokumenty/Podklady%20k%20v%C3%BDlet%C5%AFm/');
  assert.deepEqual([folder?.text, folder?.path ?? folder?.title], ['↗ Podklady k výletům', '/Users/test/Dokumenty/Podklady k výletům/'], 'a file:// folder: ↗ and its name, the decoded path as tooltip');
  assert.equal(m.localItem('file:///Users/test/Dokumenty/mapa-krkonos.pdf')?.text, '↗ mapa-krkonos.pdf', 'a file:// file');
  const src = async (v: string) => (await parts(P.chaty, {}, undefined, { ...card(P.chaty), values: { ...card(P.chaty).values, source: v } }));
  const js = await src('javascript:alert(1)');
  assert.deepEqual([js.footer.link, js.items.map(proj)], [null, [['unreviewed'], ['pill', 'rubrika', 'Cestování'], ['pill', 'source', 'javascript:alert(1)']]], 'javascript: is a Source pill, never a link');
  const odkaz = (await parts(P.snezka, {}, undefined, { ...card(P.snezka), values: { ...card(P.snezka).values, odkaz: 'example.org' } })).items.find((x: any) => x.key === 'odkaz');
  assert.deepEqual([odkaz?.kind, odkaz?.invalid], ['pill', true], 'a url value without a scheme: a pill with the invalid-value icon');
});

// ------------------------------------------------------------------------------------------------ FR-TYP-11 AC-14, FR-QRY-05 AC-31

const TASK_DATA = (o: Record<string, unknown> = {}) => ({
  type: 'task', title: 'Zavolat Janě', keys: ['tags', 'body', 'status', 'due', 'priority', 'recurrence', 'source'],
  values: { tags: ['práce'], status: 'To do', due: '2026-11-20', priority: 'High', recurrence: null, source: '[[Porada]]', ...o },
  excerpt: 'Zeptat se na rozpočet.', links: [{ target: 'Porada', kind: 'note', path: 'Pages/Porada.md', title: 'Porada', type: 'page' }], unreviewed: false, file: null,
});
const TASK_ROW = (o: Record<string, unknown> = {}) => ({ path: 'Tasks/Zavolat Janě.md', title: 'Zavolat Janě', status: 'To do', state: 'open', statusKnown: true, priority: 'High', dueRaw: '2026-11-20', due: '2026-11-20', completed: null, tags: ['práce'], source: { target: 'Porada', kind: 'note', path: 'Pages/Porada.md', title: 'Porada', type: 'page' }, excerpt: 'Zeptat se na rozpočet.', readOnly: false, ...o });

test('fr_typ_11_ac14_task_card_keeps_d1904', async () => {
  const m = await model();
  await load('../ui/src/cards/task.ts', 'ui/src/cards/task.ts');
  const task = fixtureType('task');
  const p = (d: any, row: any, o: Record<string, unknown> = {}) => m.cardParts({ type: task, card: d, task: row, ...at(o) });
  const open = p(TASK_DATA(), TASK_ROW());
  assert.ok(text(open.footer.link).includes('Porada'), 'the source chip is in the footer');
  assert.deepEqual(open.items.map((x: any) => x.key).filter((k: string) => k === 'status' || k === 'source'), [], 'status hidden for the first option; the source chip isn\'t in the pill area');
  assert.ok(open.items.some((x: any) => x.key === 'priority'), 'High priority shown');
  const none = p(TASK_DATA({ priority: 'None' }), TASK_ROW({ priority: 'None' }));
  assert.ok(!none.items.some((x: any) => x.key === 'priority'), 'priority hidden for the last option');
  const done = p(TASK_DATA({ status: 'Done' }), TASK_ROW({ status: 'Done', state: 'done' }));
  assert.deepEqual([done.text, done.items.some((x: any) => x.key === 'priority'), done.items.some((x: any) => x.key === 'status')], [null, false, true], 'Done: no text, no priority, the status shown');
  const short = m.cardParts({ type: { ...task, cardList: ['status', 'due'], cardKeys: ['status', 'due'], cardDefault: false }, card: { ...TASK_DATA(), keys: ['status', 'due'] }, task: TASK_ROW(), ...at() });
  assert.deepEqual([short.tags.shown, short.text, short.items.some((x: any) => x.key === 'priority'), text(short.footer.link).includes('Porada')], [[], null, false, true], 'card: [status, due]: no priority, tags or body; the source chip stays');
});

test('fr_qry_05_ac31_task_card_follows_the_card_list', async () => {
  const m = await model();
  const task = fixtureType('task');
  const proj2 = { ...task, cardList: [...task.cardList, 'projekt'], cardKeys: [...task.cardKeys, 'projekt'], cardDefault: false, attributes: [...task.attributes, { key: 'projekt', name: 'Projekt', type: 'relation', options: [], to: ['projekt'], multiple: false, icon: null, resolvedIcon: null }] };
  const lin = { target: 'Web', kind: 'note', path: 'Projekty/Web.md', title: 'Web', type: 'projekt' };
  const withSource = m.cardParts({ type: proj2, card: { ...TASK_DATA({ projekt: '[[Web]]' }), keys: proj2.cardKeys, links: [...TASK_DATA().links, lin] }, task: TASK_ROW(), ...at() });
  assert.ok(text(withSource.footer.link).includes('Porada') && withSource.items.some((x: any) => x.key === 'projekt' && x.kind === 'link'), 'with a source: projekt is a link chip in the pill area, the source keeps the footer');
  const noSource = m.cardParts({ type: proj2, card: { ...TASK_DATA({ projekt: '[[Web]]', source: null }), keys: proj2.cardKeys, links: [lin] }, task: TASK_ROW({ source: null }), ...at() });
  assert.ok(text(noSource.footer.link).includes('Web'), 'without a source: projekt is the footer chip (AP-1579)');
  const byPriority = m.cardParts({ type: task, card: TASK_DATA(), task: TASK_ROW(), hideKey: 'priority', ...at() });
  assert.ok(!byPriority.items.some((x: any) => x.key === 'priority'), 'the grouping key is hidden');
});

// ------------------------------------------------------------------------------------------------ FR-QRY-05 AC-30

test('fr_qry_05_ac30_board_cards_are_object_cards', async () => {
  const u = await parts(P.ucetni, { hideKey: 'status' });
  assert.deepEqual([u.items.map(proj), u.text?.text, text(u.footer.link).includes('Jana Brázdová'), u.footer.date?.text], [[], 'Kriminálka z kanceláře nad hospodou.', true, 'Edited Mon'], 'Rozečtené: no status pill (grouping key), the text, the author chip and Edited Mon');
  const byAuthor = await parts(P.ucetni, { hideKey: 'author' });
  assert.equal(byAuthor.footer.link, null, 'Podle autora: the author chip is hidden, the footer holds only the date');
  const genres = await parts(P.ucetni, { hideKey: 'genres', groupValues: ['Detektivka', 'Román'] });
  assert.deepEqual(genres.items.filter((x: any) => x.key === 'genres').map((x: any) => x.value), ['Detektivka', 'Román'], 'a book with two genres shows both genre pills (D-1769) though genres isn\'t on the card');
});

// ------------------------------------------------------------------------------------------------ FR-TYP-11 AC-16

test('fr_typ_11_ac16_the_type_icon', async () => {
  const r = has(await load('../ui/src/icons/resolve.ts', 'ui/src/icons/resolve.ts'), ['resolveIcon', 'typeIcon', 'attrIcon'], 'icons/resolve.ts');
  const types = [fixtureType('kontrola'), fixtureType('výlet'), { ...fixtureType('kontrola'), key: 'jiná', icon: 'neexistuje', resolvedIcon: null }];
  assert.ok(text(r.typeIcon(types, 'kontrola')).includes('square-check-big'), 'Kontrola: check-square resolves to square-check-big');
  assert.ok(text(r.typeIcon(types, 'výlet')).includes('"map"'), 'Výlet: map');
  assert.equal(r.typeIcon(types, 'jiná')?.name ?? r.typeIcon(types, 'jiná'), null, 'an unknown name: null (R14\'s generic icon)');
  const k = await parts(P.kontrola);
  assert.ok(text(k.lead).includes('check-square') && text(k.lead).includes('square-check-big'), `the lead keeps the name as written and draws the alias target: ${text(k.lead)}`);
  const sn = await parts(P.snezka, {}, undefined, { ...card(P.snezka), values: { ...card(P.snezka).values, icon: 'rocket', cover: '[[vyhlidka.png]]' } });
  assert.ok(!text(sn).includes('rocket'), 'an object\'s own icon is never drawn (D-217)');
});

// ------------------------------------------------------------------------------------------------ FR-TYP-11 AC-17 (L0, L1)

function uiFiles(dir = join(REPO, 'app/ui/src')): string[] {
  const out: string[] = [];
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) out.push(...uiFiles(p));
    else if (/\.(ts|tsx)$/.test(n)) out.push(relative(join(REPO, 'app/ui/src'), p));
  }
  return out;
}

test('fr_typ_11_ac17_one_component_everywhere', async () => {
  const files = uiFiles();
  const src = (f: string) => readFileSync(join(REPO, 'app/ui/src', f), 'utf8');
  const renders = files.filter((f) => /data-object-card|['"`]card-pill['" `]|className=\{?['"`][^'"`]*\bcard-pill\b/.test(src(f)));
  assert.deepEqual(renders.sort(), ['cards/CardPill.tsx', 'cards/ObjectCard.tsx'], 'only ObjectCard and CardPill render data-object-card or card-pill');
  assert.deepEqual(files.filter((f) => /export\s+(function|const)\s+StripList\b|export\s*\{[^}]*\bStripList\b/.test(src(f))), [], 'no module exports StripList');
  assert.deepEqual(['queries/board/BoardCard.tsx', 'embeds/strip.tsx'].filter((f) => existsSync(join(REPO, 'app/ui/src', f))), [], 'BoardCard.tsx and embeds/strip.tsx are gone');
  for (const f of ['queries/board/QueryBoard.tsx', 'daily/DailyTasks.tsx', 'embeds/Embed.tsx', 'cards/CardSection.tsx']) {
    assert.ok(files.includes(f) && /from ['"][./]*(cards\/)?ObjectCard['"]|ObjectCard/.test(src(f)), `${f} renders ObjectCard`);
  }
  assert.ok(files.includes('preview/PreviewContent.tsx') && /CardPill/.test(src('preview/PreviewContent.tsx')), 'the preview strip uses CardPill');
});

// ------------------------------------------------------------------------------------------------ FR-TYP-11 AC-22, AC-23, AC-26

test('fr_typ_11_ac22_add_property', async () => {
  const w = await write();
  assert.deepEqual(w.addChoices(fixtureType('výlet')), { attributes: ['poznámka'], builtIns: ['body', 'source', 'aliases', 'created'] }, 'Výlet: Poznámka and the built-ins not on the list');
  const img = w.addChoices(fixtureType('image'));
  assert.ok(!img.attributes.includes('file') && img.attributes.includes('media-type'), 'Image: File (file kind) isn\'t offered, Media type is');
  assert.ok(![...img.attributes, ...img.builtIns].includes('review'), 'review is never offered');
  assert.deepEqual(w.cardAdd(fixtureType('výlet'), 'poznámka'), ['tags', 'description', 'stav', 'náročnost', 'kraj', 'vybavení', 'délka', 'termín', 'odkaz', 'průvodce', 'neznámý-klíč', 'modified', 'poznámka'], 'appends, the unknown key kept');
  assert.deepEqual(w.cardRemove(fixtureType('book'), 'tags'), ['body', 'author', 'status', 'modified'], 'the first change seeds from the default (D-2076)');
});

test('fr_typ_11_ac23_reordering', async () => {
  const w = await write();
  const v = fixtureType('výlet');
  assert.deepEqual(w.cardDrop(v, 'kraj', 'stav'), ['tags', 'description', 'kraj', 'stav', 'náročnost', 'vybavení', 'délka', 'termín', 'odkaz', 'průvodce', 'neznámý-klíč', 'modified'], 'drag Kraj above Stav');
  assert.deepEqual(w.cardMove(v, 'kraj', 1), ['tags', 'description', 'stav', 'náročnost', 'vybavení', 'kraj', 'délka', 'termín', 'odkaz', 'průvodce', 'neznámý-klíč', 'modified'], '⌥↓ moves one place among the effective rows');
  assert.equal(w.cardMove(v, 'tags', -1), null, '⌥↑ on the first row: null');
  assert.equal(w.cardMove(v, 'modified', 1), null, '⌥↓ on the last row: null');
  assert.deepEqual(w.cardMove(v, 'průvodce', 1), ['tags', 'description', 'stav', 'náročnost', 'kraj', 'vybavení', 'délka', 'termín', 'odkaz', 'neznámý-klíč', 'modified', 'průvodce'], 'neznámý-klíč keeps its place after its predecessor; průvodce passes modified');
});

test('fr_typ_11_ac26_hand_written_card', async () => {
  const w = await write();
  const a = variantType('výlet', 'výlet card: [tags, tags, title, kraj]');
  assert.deepEqual(w.cardRemove(a, 'tags'), ['title', 'kraj'], '(a) removing Tags removes both copies');
  const b = variantType('výlet', 'výlet card with an NFD kraj');
  assert.deepEqual(w.cardRemove(b, 'kraj').map(nfc), ['náročnost'], '(b) an NFD entry is NFC-equal to kraj');
});

// ------------------------------------------------------------------------------------------------ FR-FMT-12 AC-15

test('fr_fmt_12_ac15_card_keys_and_icon_names_are_nfc', async () => {
  const s = await schema();
  const v = typeDto('výlet', read('tests/fixtures/vaults/cards/.tegg/types/výlet.yml'));
  const got = s.cardList({ key: 'výlet', state: 'ok', card: [NFD('kraj'), NFD('náročnost')], cardUnreadable: false, preview: v.preview, attributes: v.attributes });
  assert.deepEqual(got.keys, ['kraj', 'náročnost'], 'NFD card entries match their attributes; keys NFC');
  const sn = await parts(P.snezka, {}, undefined, { ...card(P.snezka), values: Object.fromEntries(Object.entries(card(P.snezka).values).map(([k, x]) => [NFD(k), x])) });
  assert.ok(sn.items.some((x: any) => nfc(x.key) === 'náročnost' && x.value === 'Střední'), 'NFD value keys draw the pill');
});

// ------------------------------------------------------------------------------------------------ FR-EMB-02 AC-19, FR-LNK-10 AC-17

test('fr_emb_02_ac19_card_mode_is_the_object_card', async () => {
  const s = await schema();
  const osoba = typeDto('osoba', read('tests/fixtures/vaults/embeds/.tegg/types/osoba.yml'));
  const got = s.cardList({ key: 'osoba', state: 'ok', card: osoba.card, cardUnreadable: false, preview: osoba.preview, attributes: osoba.attributes });
  assert.deepEqual(got?.list, ['tags', 'body', 'firma', 'role', 'modified'], 'Osoba\'s default list');
  const k = await parts(P.chaty);
  assert.deepEqual(proj(k.items[0]), ['unreviewed'], 'a card embed\'s Unreviewed is the card\'s first pill (not the header dot)');
});

test('fr_lnk_10_ac17_strip_is_the_cards_pills_and_link_chip', async () => {
  const s = await schema();
  const projekt = typeDto('projekt', read('tests/fixtures/vaults/previews/.tegg/types/projekt.yml'));
  const list = s.cardList({ key: 'projekt', state: 'ok', card: null, cardUnreadable: false, preview: projekt.preview, attributes: projekt.attributes });
  assert.deepEqual(list?.list, ['tags', 'body', 'stav', 'vlastník', 'termín', 'rozpočet', 'modified'], 'Projekt\'s default list (previews.md part four)');
  const m = await model();
  const alfa = {
    type: 'projekt', title: 'Projekt Alfa', keys: list.keys, values: { tags: [], stav: 'Aktivní', vlastník: '[[Jana Nováková]]', termín: '2026-12-31', rozpočet: null, modified: '2026-10-20T09:00:00+02:00' },
    excerpt: 'Hlavní projekt roku. Souvisí s Rozpočet 2027.', links: [{ target: 'Jana Nováková', kind: 'note', path: 'Osoby/Jana Nováková.md', title: 'Jana Nováková', type: 'osoba' }], unreviewed: false, file: null,
  };
  const p = m.cardParts({ type: { ...projekt, cardList: list.list, cardKeys: list.keys, cardDefault: true }, card: alfa, now: Date.parse('2026-10-27T10:00:00+01:00'), zone: PRAGUE, region: 'en-US', dateSetting: REGION_DATES });
  assert.deepEqual(p.items.map(proj), [['pill', 'stav', 'Aktivní'], ['pill', 'termín', 'Dec 31, 2026']], 'the pills: Stav, Termín; nothing for the empty Rozpočet');
  assert.ok(text(p.footer.link).includes('Jana Nováková'), 'then the link chip Jana Nováková');
});
