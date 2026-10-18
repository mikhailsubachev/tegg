// MS5 slice 5A-1, L1: quick-add parsing (docs/contracts/ms5-tasks.md §6.4, `app/ui/src/tasks/quickAdd.ts`; D-380,
// D-483). FR-TSK-10 AC-2 (the token table, clock Wed 14 Oct), AC-3 (the token words a Clear puts back), AC-5 (titles:
// kept whole, NFC; the file names are L4). Written from docs/acceptance/tasks.md and the contract only (D-61). The
// module loads inside each test (TS-I1).
import { test } from 'vitest';
import assert from 'node:assert/strict';

type Mod = Record<string, any>;
async function parser(): Promise<(text: string, ctx?: Record<string, unknown>) => any> {
  let m: Mod | null = null;
  try {
    m = (await import(/* @vite-ignore */ '../ui/src/tasks/quickAdd.ts')) as Mod;
  } catch {
    m = null;
  }
  assert.ok(m && typeof m.parseQuickAdd === 'function', 'ui/src/tasks/quickAdd.ts exports parseQuickAdd (§6.4)');
  return (text, ctx) => m!.parseQuickAdd(text, { today: '2026-10-14', priorities: ['High', 'Medium', 'Low', 'None'], ...(ctx ?? {}) });
}
type Want = { title: string; due?: string | null; priority?: string | null; tags?: string[] };
async function table(rows: [string, Want][], ctx?: Record<string, unknown>) {
  const parse = await parser();
  const bad: string[] = [];
  for (const [input, w] of rows) {
    const r = parse(input, ctx);
    const got = { title: r.title, due: r.due, priority: r.priority, tags: r.tags };
    const want = { title: w.title, due: w.due ?? null, priority: w.priority ?? null, tags: w.tags ?? [] };
    if (JSON.stringify(got) !== JSON.stringify(want)) bad.push(`${JSON.stringify(input)}: want ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
  }
  assert.deepEqual(bad, [], 'FR-TSK-10 AC-2 table rows');
}

test('fr_tsk_10_ac2_date_words', async () => {
  await table([
    ['A today', { title: 'A', due: '2026-10-14' }],
    ['A Tomorrow', { title: 'A', due: '2026-10-15' }],
    ['A friday', { title: 'A', due: '2026-10-16' }],
    ['A FRIDAY', { title: 'A', due: '2026-10-16' }],
    ['A wednesday', { title: 'A', due: '2026-10-21' }],
    ['A today tomorrow', { title: 'A today', due: '2026-10-15' }],
    ['Tomorrow meeting', { title: 'Tomorrow meeting' }],
    ['A fri', { title: 'A fri' }],
  ]);
});

test('fr_tsk_10_ac2_priorities', async () => {
  await table([
    ['A !low', { title: 'A', priority: 'Low' }],
    ['A !HIGH', { title: 'A', priority: 'High' }],
    ['A !high !low', { title: 'A !high', priority: 'Low' }],
    ['A !urgent', { title: 'A !urgent' }],
  ]);
  await table([
    ['A !vysoká', { title: 'A', priority: 'Vysoká' }],
    ['A !VYSOKÁ', { title: 'A', priority: 'Vysoká' }],
    ['A !vysoka', { title: 'A !vysoka' }],
  ], { priorities: ['Vysoká', 'Nízká'] });
});

test('fr_tsk_10_ac2_tags_and_combinations', async () => {
  await table([
    ['A #x #y', { title: 'A', tags: ['x', 'y'] }],
    ['A tomorrow !high #x', { title: 'A', due: '2026-10-15', priority: 'High', tags: ['x'] }],
    ['A #x tomorrow', { title: 'A', due: '2026-10-15', tags: ['x'] }],
    ['A #x/y', { title: 'A', tags: ['x/y'] }],
    ['Zavolat do servisu tomorrow #auto !high', { title: 'Zavolat do servisu', due: '2026-10-15', priority: 'High', tags: ['auto'] }],
  ]);
});

test('fr_tsk_10_ac2_nfd_input_gives_nfc', async () => {
  const parse = await parser();
  const r = parse('Zalít květiny #zahrádka'.normalize('NFD'));
  assert.equal(r.title, 'Zalít květiny', 'NFC title');
  assert.deepEqual(r.tags, ['zahrádka'], 'NFC tags');
  assert.equal(r.title, r.title.normalize('NFC'));
});

test('fr_tsk_10_ac3_tokens_name_their_words', async () => {
  const parse = await parser();
  const r = parse('Pay rent today');
  assert.equal(r.title, 'Pay rent', 'the date word is parsed');
  assert.deepEqual(r.tokens, [{ kind: 'due', word: 'today' }], 'the token keeps its word, for Clear due date to put back');
  const p = parse('Pay rent !high');
  assert.deepEqual(p.tokens, [{ kind: 'priority', word: '!high' }]);
});

test('fr_tsk_10_ac5_titles_are_kept_whole', async () => {
  const parse = await parser();
  assert.equal(parse('Q3: plán/rozpočet').title, 'Q3: plán/rozpočet', 'the title keeps : and / (only the file name is sanitized)');
  const long = 'Příliš žluťoučký kůň úpěl ďábelské ódy '.repeat(6).trim();
  assert.ok(new TextEncoder().encode(long).length >= 250);
  assert.equal(parse(long).title, long, 'a 250-byte title is not cut (the stem is, at L4)');
  const d = (await import(/* @vite-ignore */ String('@tegg/doc'))) as Mod;
  const bytes: string = d.newObject({ type: { key: 'task', attributes: [], review: 'off' }, title: parse('Q3: plán/rozpočet').title, template: null, now: '2026-10-14T12:00:00+02:00', newId: () => '01JB5A0000000000000000N010' });
  assert.ok(bytes.includes('title: "Q3: plán/rozpočet"\n'), 'written quoted (FR-FMT-08)');
});
