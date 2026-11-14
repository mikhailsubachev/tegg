// Fake core data, slice REL (docs/contracts/v1-related.md §6): the expected `index_related` answers of
// tests/fixtures/vaults/related, hand-written from its README ("Expected lists", "Expected excerpts", the cluster tables
// for `shared`). Per NFC path: the entries with linked hidden and shown, in the README's order (sets in a fixed order),
// `linked`, `shared`, a synthetic `score` (strictly descending except the README's ties, which share a score) and the
// README's excerpt where it lists one (else the fake takes the candidate's first body sentence as written). Chip fields
// (`title`, `type`, `review`, `status`, `due`, `completed`) are read by the fake from each file's current frontmatter.
// Rows the README doesn't assert (Hvězda 01…12, Včelaření) are absent: the fake answers them with no entries. Test data,
// not product code.

export type ExpectedEntry = { path: string; linked: boolean; shared: number; score: number; excerpt?: string };
export type ExpectedRow = { hidden: ExpectedEntry[]; shown: ExpectedEntry[]; reason: 'short' | null };

const n = (s: string) => s.normalize('NFC');
export const R = {
  souhvezdi: n('Pages/Souhvězdí.md'),
  hvezda: (k: number) => n(`Pages/Hvězda ${String(k).padStart(2, '0')}.md`),
  rozpocet: n('Pages/Rozpočet na offsite 2027.md'),
  den: 'Daily/2026-09-30.md',
  ukol: n('Tasks/Poslat návrh rozpočtu financím.md'),
  terminyA: n('Pages/Důležité termíny školení.md'),
  terminyB: 'Pages/Dulezite terminy skoleni.md',
  skoleni: n('Quick Notes/Školení a dodavatel.md'),
  kniha: n('Pages/Kniha vzpomínek.md'),
  poznamky: 'Quick Notes/Poznamky ke knize.md',
  zahrada: n('Pages/Zahrada na jaře.md'),
  zahon: n('Pages/Záhon s rajčaty.md'),
  seminka: n('Quick Notes/Semínka na jaro.md'),
  vcelstvo: n('Pages/Včelstvo na zimu.md'),
  prohlidka: n('Pages/Jarní prohlídka úlu.md'),
  vcelareni: n('Tags/Včelaření.md'),
  ul: n('Images/Úl u lesa.md'),
  navod: n('PDFs/Návod ke krmení.md'),
  sablona: n('_templates/Page/Včelí deník.md'),
  stary: n('.trash/Pages/Starý úl.md'),
  hiking: 'Pages/Hiking in the mountains.md',
  trail: 'Pages/Trail notes.md',
  tura: n('Pages/Túra v horách.md'),
  gear: 'Pages/gear list.md',
  mleko: n('Quick Notes/Koupit mléko.md'),
  buben: 'Quick Notes/Buben.md',
  kytara: 'Quick Notes/Kytara.md',
  krouzek: n('Pages/Hudební kroužek.md'),
  svatba: 'Pages/Svatba Petra a Lucie.md',
  prazdna: n('Pages/Prázdná.md'),
} as const;

/** README "Expected excerpts": (list of, entry) → excerpt. */
export const EXCERPTS: Record<string, string> = {
  [`${R.rozpocet}|${R.den}`]: n('Zítra: projít rozpocet s Janou a poslat naklady na offsite financim.'),
  [`${R.rozpocet}|${R.ukol}`]: n('Do pá 27. 11. musí návrh rozpočtu na offsite projít přes finance, Jana ho podepíše.'),
  [`${R.terminyA}|${R.terminyB}`]: 'Dodavatel zasle prihlasky a termin schuzky s vedenim potvrdi ve ctvrtek.',
  [`${R.terminyA}|${R.skoleni}`]: n('Školení pro vedení: dodavatel zašle přihlášky, termín schůzky ve čtvrtek.'),
  [`${R.terminyB}|${R.terminyA}`]: n('Dodavatel zašle přihlášky a termín schůzky s vedením potvrdí ve čtvrtek.'),
  [`${R.poznamky}|${R.kniha}`]: n('Praha je daleko, ale ta kniha je blízko.'),
  [`${R.kniha}|${R.poznamky}`]: 'V Praze, v malem domku, matce rikala o knize.',
  [`${R.hiking}|${R.trail}`]: 'Notes from the trail: the boots held up, the lake was cold, and the mountain hut was full.',
  [`${R.hiking}|${R.gear}`]: 'Pack the boots, a rain jacket, the map of the trail and water for the hike.',
  [`${R.zahrada}|${R.seminka}`]: n('Koupit semínka rajčat a paprik, na jaře do záhonu.'),
  [`${R.zahrada}|${R.zahon}`]: n('Rajčata potřebují slunce a kompost.'),
  [`${R.souhvezdi}|${R.hvezda(2)}`]: n('Pozorování: teleskopem, kometou, meteory.'),
  [`${R.vcelstvo}|${R.prohlidka}`]: n('Včelstva jsou silná, rámky plné plodu, dělnic přibývá a pylu je dost.'),
};

const e = (path: string, shared: number, score: number, linked = false): ExpectedEntry => ({ path, linked, shared, score });
const same = (list: ExpectedEntry[], reason: 'short' | null = null): ExpectedRow => ({ hidden: list, shown: list, reason });
const none = (reason: 'short' | null): ExpectedRow => ({ hidden: [], shown: [], reason });

export const EXPECTED: Record<string, ExpectedRow> = {
  [R.souhvezdi]: {
    hidden: [3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((k) => e(R.hvezda(k), 3, 9.0)),
    shown: [e(R.hvezda(2), 4, 12.0, true), e(R.hvezda(1), 3, 9.0, true), ...[3, 4, 5, 6, 7, 8, 9, 10].map((k) => e(R.hvezda(k), 3, 9.0))],
    reason: null,
  },
  [R.rozpocet]: same([e(R.den, 7, 14.0), e(R.ukol, 5, 9.5)]),
  [R.den]: same([e(R.ukol, 7, 13.0), e(R.rozpocet, 7, 12.0)]),
  [R.ukol]: same([e(R.den, 7, 13.0), e(R.rozpocet, 5, 9.0)]),
  [R.terminyA]: same([e(R.terminyB, 12, 30.0), e(R.skoleni, 8, 18.0)]),
  [R.terminyB]: same([e(R.terminyA, 12, 30.0), e(R.skoleni, 8, 18.0)]),
  [R.skoleni]: same([e(R.terminyB, 8, 17.0), e(R.terminyA, 8, 17.0)]),
  [R.kniha]: same([e(R.poznamky, 8, 20.0)]),
  [R.poznamky]: same([e(R.kniha, 8, 20.0)]),
  [R.zahrada]: { hidden: [], shown: [e(R.seminka, 6, 11.0, true), e(R.zahon, 5, 10.0, true)], reason: null },
  [R.zahon]: { hidden: [e(R.seminka, 4, 8.0)], shown: [e(R.zahrada, 5, 10.0, true), e(R.seminka, 4, 8.0)], reason: null },
  [R.seminka]: { hidden: [e(R.zahon, 4, 8.0)], shown: [e(R.zahrada, 6, 11.0, true), e(R.zahon, 4, 8.0)], reason: null },
  [R.vcelstvo]: same([e(R.prohlidka, 5, 11.0)]),
  [R.prohlidka]: same([e(R.vcelstvo, 5, 11.0)]),
  [R.ul]: same([e(R.vcelstvo, 3, 6.0)]),
  [R.navod]: same([e(R.vcelstvo, 3, 6.0)]),
  [R.hiking]: same([e(R.trail, 6, 15.0), e(R.gear, 3, 7.0)]),
  [R.trail]: same([e(R.hiking, 6, 15.0), e(R.gear, 3, 7.0)]),
  [R.gear]: same([e(R.hiking, 3, 7.0), e(R.trail, 3, 6.5)]),
  [R.tura]: none(null),
  [R.mleko]: none('short'),
  [R.buben]: none('short'),
  [R.kytara]: same([e(R.krouzek, 5, 10.0), e(R.buben, 4, 8.0)]),
  [R.krouzek]: same([e(R.kytara, 5, 10.0), e(R.buben, 4, 8.0)]),
  [R.svatba]: none(null),
  [R.prazdna]: none('short'),
};
