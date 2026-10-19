// MS5 slice 5B, L1: the Inbox rows, order, groups and card parts (docs/acceptance/inbox.md R60, R61; docs/contracts/
// ms5-capture.md §7.1, §7.2, §11.2). FR-INB-01 AC-1 (the fake core's TS twin of `inbox_list` lists exactly the 13
// members; the Inbox instant of each), AC-2 (order and groups in Prague `cs`, `en-US` (W) and Los Angeles (TZ); a
// card's group follows the clock), AC-3 (card tags, footer and text). The twin (app/ui/test/fake-inbox.ts) is test code;
// `inbox/bucket.ts` and `inbox/card.ts` are the UI modules under test. Written from the ACs and the contract only
// (D-61). Modules load inside the tests (TS-I1).
import { afterEach, test } from 'vitest';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

type Mod = Record<string, any>;
type Row = { path: string; id: string | null; title: string; type: string; reviewRaw: string | null; captured: string | null; created: string | null; modified: string | null; tags: string[]; excerpt: string; readOnly: boolean };
async function load(path: string): Promise<Mod | null> {
  try {
    return (await import(/* @vite-ignore */ path)) as Mod;
  } catch {
    return null;
  }
}
async function bucket(): Promise<Mod> {
  const m = await load('../ui/src/inbox/bucket.ts');
  assert.ok(m && ['inboxInstant', 'inboxOrder', 'inboxGroups'].every((k) => typeof m[k] === 'function'), 'ui/src/inbox/bucket.ts exports inboxInstant, inboxOrder, inboxGroups (§7.2)');
  return m!;
}
async function twin(): Promise<Mod> {
  const m = await load('../ui/test/fake-inbox.ts');
  assert.ok(m && typeof m.inboxList === 'function', 'app/ui/test/fake-inbox.ts exports inboxList (§11.2)');
  return m!;
}
afterEach(async () => {
  const c = await load('../ui/src/i18n/collate.ts');
  c?.setCollationLocale?.('cs');
});

const REPO = resolve(import.meta.dirname, '../..');
function inboxFiles(): Record<string, string> {
  const files: Record<string, string> = {};
  for (const [dir, prefix] of [['tests/fixtures/vaults/inbox', ''], ['tests/fixtures/vaults/new-empty/.tegg', '.tegg/']] as const) {
    const abs = resolve(REPO, dir);
    const walk = (d: string) => { for (const n of readdirSync(d)) { const p = join(d, n); if (statSync(p).isDirectory()) walk(p); else files[(prefix + relative(abs, p)).normalize('NFC')] = readFileSync(p, 'utf8'); } };
    walk(abs);
  }
  delete files['README.md'];
  return files;
}

const P = {
  Q1: 'Quick Notes/Koupit mléko.md', Q2: 'Quick Notes/Nápad na článek.md', Q3: 'Quick Notes/Přečteno.md', Q4: 'Quick Notes/Bez stavu.md',
  Q5: 'Quick Notes/Divná hodnota.md', Q6: 'Quick Notes/Žluťoučký kůň.md', Q7: 'Quick Notes/Bez offsetu.md', Q8: 'Quick Notes/Bez data.md',
  Holy: 'Quick Notes/Holý text.md', D1: 'Daily/2026-10-13.md', D2: 'Daily/2026-10-12.md', D3: 'Daily/2026-10-07.md',
  N1: 'Nápady/Aplikace na čaj.md', N2: 'Nápady/Starý nápad.md', P1: 'Pages/Zachycená stránka.md', P2: 'Pages/Plán webu.md',
  T1: 'Tasks/Zavolat instalatérovi.md', S1: 'Schůzky/Porada týmu.md', DQ: 'Quick Notes/Dvojník.md', DP: 'Pages/Dvojník.md',
} as const;
type K = keyof typeof P;
const MEMBERS: K[] = ['Q1', 'Q2', 'Q4', 'Q5', 'Q6', 'Q7', 'Q8', 'D1', 'D3', 'N1', 'P1', 'T1', 'S1'];
const nfc = (s: string) => s.normalize('NFC');
const ps = (...k: K[]) => k.map((x) => nfc(P[x]));

async function rows(edit?: (f: Record<string, string>) => void): Promise<Row[]> {
  const t = await twin();
  const files = inboxFiles();
  edit?.(files);
  return t.inboxList(files) as Promise<Row[]>;
}
const groups = (g: Record<string, Row[]>) => ({ today: g.today.map((r) => r.path), yesterday: g.yesterday.map((r) => r.path), week: g.week.map((r) => r.path), older: g.older.map((r) => r.path) });

// ------------------------------------------------------------------------------------------------ FR-INB-01 AC-1

test('fr_inb_01_ac1_the_fake_core_twin_lists_the_13_members_with_their_instants', async () => {
  const b = await bucket();
  const got = await rows();
  assert.deepEqual(got.map((r) => r.path), [...ps(...MEMBERS)].sort((x, y) => Buffer.compare(Buffer.from(x), Buffer.from(y))), 'exactly the 13 items of R61, in path order');
  const by = new Map(got.map((r) => [r.path, r]));
  const q1 = by.get(nfc(P.Q1))!;
  assert.deepEqual([q1.type, q1.reviewRaw, q1.captured, q1.tags, q1.excerpt], ['quick-note', 'unreviewed', '2026-10-14T08:15:00+02:00', ['nákup'], 'Polotučné, 2 litry.'], 'Q1 row');
  assert.equal(by.get(nfc(P.N1))!.reviewRaw, 'unreviewed', 'N1: the quoted value as a string');
  assert.equal(by.get(nfc(P.Q5))!.reviewRaw, 'maybe', 'Q5: raw value');
  assert.equal(by.get(nfc(P.Q4))!.reviewRaw, null, 'Q4: missing');
  // The Inbox instant (R61) of each member, Prague.
  const want: Record<string, string | null> = {
    Q1: '2026-10-14T08:15:00+02:00', Q2: '2026-10-13T21:40:00+02:00', Q4: '2026-10-10T10:00:00+02:00', Q5: '2026-10-09T16:45:00+02:00',
    Q6: '2026-10-14T10:00:00+02:00', Q7: '2026-10-14T06:30:00+02:00', Q8: null, D1: '2026-10-13T07:30:00+02:00', D3: '2026-10-07T08:00:00+02:00',
    N1: '2026-10-14T09:00:00+02:00', P1: '2026-10-11T18:20:00+02:00', T1: '2026-10-14T07:50:00+02:00', S1: '2026-10-12T14:00:00+02:00',
  };
  for (const k of MEMBERS) {
    const r = by.get(nfc(P[k]))!;
    const w = want[k];
    assert.equal(b.inboxInstant(r, 'Europe/Prague'), w === null ? null : Date.parse(w), `${k}: instant`);
  }
  assert.equal(b.inboxInstant(by.get(nfc(P.Q7))!, 'America/Los_Angeles'), Date.parse('2026-10-14T06:30:00-07:00'), 'Q7: an offset-less value is read in the zone (D-365)');
  assert.equal(b.inboxInstant({ captured: null, created: '2026-10-12', modified: null }, 'Europe/Prague'), Date.parse('2026-10-12T00:00:00+02:00'), 'a date alone is local 00:00');
  assert.equal(b.inboxInstant({ captured: 'zítra', created: '2026-10-12T08:00:00+02:00', modified: null }, 'Europe/Prague'), Date.parse('2026-10-12T08:00:00+02:00'), 'an invalid captured falls back to created');
});

test('fr_inb_01_ac1_unreviewed_with_a_capital_u', async () => {
  const b = await bucket();
  const got = await rows((f) => {
    f['Pages/Velké U.md'] = '---\nid: 01JB5B0000000000000000R101\ntype: page\ntitle: Velké U\nreview: Unreviewed\ncreated: 2026-10-14T11:00:00+02:00\nmodified: 2026-10-14T11:00:00+02:00\n---\n';
    f['Quick Notes/Velké U.md'] = '---\nid: 01JB5B0000000000000000R102\ntype: quick-note\ntitle: Velké U\nreview: Unreviewed\ncreated: 2026-10-14T11:00:00+02:00\nmodified: 2026-10-14T11:00:00+02:00\n---\n';
  });
  const paths = got.map((r) => r.path);
  assert.ok(!paths.includes('Pages/Velké U.md'), 'a Page with review: Unreviewed is not listed');
  assert.ok(paths.includes('Quick Notes/Velké U.md'), 'a Quick Note with an unknown value is listed');
  const qn = got.find((r) => r.path === 'Quick Notes/Velké U.md')!;
  assert.equal(b.inboxInstant(qn, 'Europe/Prague'), Date.parse('2026-10-14T11:00:00+02:00'), 'its instant');
});

// ------------------------------------------------------------------------------------------------ FR-INB-01 AC-2

async function grouped(zone: string, region: string, today: string) {
  const b = await bucket();
  const all = await rows();
  const ordered = b.inboxOrder(all, zone, new Intl.Collator(region, { sensitivity: 'base', numeric: true })) as Row[];
  return groups(b.inboxGroups(ordered, today, region === 'en-US' ? 7 : 1, zone));
}

test('fr_inb_01_ac2_order_and_groups_prague_cs', async () => {
  assert.deepEqual(await grouped('Europe/Prague', 'cs', '2026-10-14'), {
    today: ps('Q6', 'N1', 'Q1', 'T1', 'Q7'), yesterday: ps('Q2', 'D1'), week: ps('S1'), older: ps('P1', 'Q4', 'Q5', 'D3', 'Q8'),
  });
});

test('fr_inb_01_ac2_week_from_sunday_en_us', async () => {
  assert.deepEqual(await grouped('Europe/Prague', 'en-US', '2026-10-14'), {
    today: ps('Q6', 'N1', 'Q1', 'T1', 'Q7'), yesterday: ps('Q2', 'D1'), week: ps('S1', 'P1'), older: ps('Q4', 'Q5', 'D3', 'Q8'),
  });
});

test('fr_inb_01_ac2_los_angeles', async () => {
  assert.deepEqual(await grouped('America/Los_Angeles', 'cs', '2026-10-14'), {
    today: ps('Q7', 'Q6', 'N1'), yesterday: ps('Q1', 'T1', 'Q2'), week: ps('D1', 'S1'), older: ps('P1', 'Q4', 'Q5', 'D3', 'Q8'),
  });
});

test('fr_inb_01_ac2_after_midnight_q6_is_yesterday', async () => {
  const g = await grouped('Europe/Prague', 'cs', '2026-10-15');
  assert.deepEqual(g.today, [], 'nothing is from 15 Oct');
  assert.deepEqual(g.yesterday, ps('Q6', 'N1', 'Q1', 'T1', 'Q7'), 'the 14 Oct items move to Yesterday');
  assert.deepEqual(g.week, ps('Q2', 'D1', 'S1'), 'Earlier this week from Monday 12 Oct');
});

test('fr_inb_01_ac2_ties_and_items_without_an_instant_by_title_then_path', async () => {
  const b = await bucket();
  const r = (path: string, title: string, created: string | null): Row => ({ path, id: null, title, type: 'quick-note', reviewRaw: 'unreviewed', captured: null, created, modified: null, tags: [], excerpt: '', readOnly: false });
  const at = '2026-10-14T09:00:00+02:00';
  const input = [r('Quick Notes/b.md', 'Čaj', at), r('Quick Notes/a.md', 'Cesta', at), r('Quick Notes/z.md', 'Bez data', null), r('Quick Notes/y.md', 'Alfa', null), r('Pages/x.md', 'Alfa', null)];
  const out = (b.inboxOrder(input, 'Europe/Prague', new Intl.Collator('cs', { sensitivity: 'base', numeric: true })) as Row[]).map((x) => x.path);
  assert.deepEqual(out, ['Quick Notes/a.md', 'Quick Notes/b.md', 'Pages/x.md', 'Quick Notes/y.md', 'Quick Notes/z.md'], 'Cesta before Čaj (cs); no instant last, by title then path');
});

// ------------------------------------------------------------------------------------------------ FR-INB-01 AC-3

test('fr_inb_01_ac3_card_tags_footer_and_text', async () => {
  const card = await load('../ui/src/inbox/card.ts');
  const collate = await load('../ui/src/i18n/collate.ts');
  assert.ok(card && typeof card.cardTags === 'function' && typeof card.cardFooter === 'function', 'ui/src/inbox/card.ts exports cardTags and cardFooter');
  collate!.setCollationLocale('cs-CZ');
  const by = new Map((await rows()).map((r) => [r.path, r]));
  const f = (iso: string) => new Intl.DateTimeFormat('cs-CZ', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Prague' }).format(new Date(iso));
  assert.equal(card!.cardFooter(by.get(nfc(P.Q1))!, 'Europe/Prague'), `Captured ${f('2026-10-14T08:15:00+02:00')}`, 'Q1: Captured <date-time> (D-160)');
  assert.equal(card!.cardFooter(by.get(nfc(P.Q2))!, 'Europe/Prague'), `Created ${f('2026-10-13T21:40:00+02:00')}`, 'Q2: Created');
  assert.equal(card!.cardFooter(by.get(nfc(P.Q8))!, 'Europe/Prague'), null, 'Q8: no footer');
  assert.deepEqual(card!.cardTags(['nákup']), { shown: ['nákup'], more: 0 }, 'Q1: #nákup');
  assert.deepEqual(card!.cardTags(['a', 'b', 'c', 'd', 'e']), { shown: ['a', 'b', 'c'], more: 2 }, 'up to 3, then +2');
  assert.equal(by.get(nfc(P.Q6))!.title, nfc('Žluťoučký kůň'), 'Q6: the title in NFC');
  assert.equal(by.get(nfc(P.D1))!.title, '2026-10-13', 'D1: its date');
  assert.equal(by.get(nfc(P.Q2))!.excerpt, 'O synchronizaci přes Dropbox. Viz Plán webu.', 'Q2: no link brackets');
});
