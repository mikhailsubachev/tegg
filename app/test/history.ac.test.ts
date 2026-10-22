// MS3 slice 3B.1, L1: history semantics of Back and Forward (FR-NAV-03 AC-1, AC-2, AC-4, AC-7; D-165).
// Written from docs/acceptance/app-shell.md (FR-NAV-03) and docs/contracts/ms3-shell.md §4.1, §11.2, §12.1 only (D-61).
// Modules are imported dynamically inside each test so a missing module fails an assertion, not the file (TS-I1).
// Routes are built with the public `parseRoute` and compared with `routeString` (§4.1), so the tests don't depend on
// the internal shape of a route object.
import { test } from 'vitest';
import assert from 'node:assert/strict';

type Mod = Record<string, any>;
async function load(path: string): Promise<Mod | null> {
  try {
    return (await import(/* @vite-ignore */ path)) as Mod;
  } catch {
    return null;
  }
}

type Hist = {
  push(r: unknown): void;
  back(): { route: unknown; scrollTop: number } | null;
  forward(): { route: unknown; scrollTop: number } | null;
  canBack(): boolean;
  canForward(): boolean;
  saveScroll(n: number): void;
  clear(): void;
};

async function setup() {
  const h = await load('../ui/src/shell/history.ts');
  const r = await load('../ui/src/shell/routes.ts');
  assert.ok(h && typeof h.createHistory === 'function', 'ui/src/shell/history.ts does not export createHistory');
  assert.ok(r && typeof r.parseRoute === 'function' && typeof r.routeString === 'function', 'ui/src/shell/routes.ts');
  const route = (s: string) => {
    const x = r.parseRoute(s);
    assert.ok(x, `parseRoute(${JSON.stringify(s)})`);
    return x;
  };
  const str = (e: { route: unknown } | null) => (e ? (r.routeString(e.route) as string).normalize('NFC') : null);
  const hist = h.createHistory() as Hist;
  for (const m of ['push', 'back', 'forward', 'canBack', 'canForward', 'saveScroll', 'clear']) {
    assert.equal(typeof (hist as any)[m], 'function', `history.${m} is missing`);
  }
  return { hist, route, str };
}

/** The first sample route. 6A (D-609, D-628): `home` is gone (it parses like an unknown route); `tasks` takes its place. */
const HOME = 'tasks';
const PORADA = 'note/Schůzky/2026-10-07 Porada.md';
const SCHUZKA = 'type/schůzka';
const SEARCH = 'search';
const CIL = 'note/Pages/Cíl.md';
const ODKAZY = 'note/Pages/Odkazy.md';

test('fr_nav_03_ac1_back_and_forward_walk_the_visited_routes', async () => {
  const { hist, route, str } = await setup();
  for (const s of [HOME, PORADA, SCHUZKA, SEARCH]) hist.push(route(s));
  assert.equal(str(hist.back()), SCHUZKA, 'Back from search shows type/schůzka');
  assert.equal(str(hist.back()), PORADA, 'Back again shows Porada');
  assert.equal(str(hist.back()), HOME, 'Back again shows home');
  assert.equal(hist.canBack(), false, 'nothing before home');
  assert.equal(hist.back(), null, 'Back at the start returns null');
  assert.equal(str(hist.forward()), PORADA, 'Forward shows Porada');
  assert.equal(str(hist.forward()), SCHUZKA, 'Forward again shows type/schůzka');
  assert.equal(str(hist.forward()), SEARCH, 'Forward again shows search');
  assert.equal(hist.canForward(), false, 'nothing after search');
  assert.equal(hist.forward(), null, 'Forward at the end returns null');
});

test('fr_nav_03_ac1_new_navigation_after_back_drops_forward_entries', async () => {
  const { hist, route, str } = await setup();
  for (const s of [HOME, PORADA, SCHUZKA, SEARCH]) hist.push(route(s));
  assert.equal(str(hist.back()), SCHUZKA);
  assert.equal(str(hist.back()), PORADA);
  assert.equal(hist.canForward(), true, 'two forward entries before the new navigation');
  hist.push(route('inbox'));
  assert.equal(hist.canForward(), false, 'the new navigation dropped every forward entry');
  assert.equal(hist.forward(), null, 'Forward does nothing');
  assert.equal(str(hist.back()), PORADA, 'Back from inbox shows Porada');
  assert.equal(str(hist.back()), HOME, 'then home');
  assert.equal(hist.canBack(), false);
});

test('fr_nav_03_ac1_same_route_adds_no_entry', async () => {
  const { hist, route, str } = await setup();
  hist.push(route(HOME));
  hist.push(route(SCHUZKA));
  hist.push(route(SCHUZKA));
  hist.push(route(SCHUZKA.normalize('NFD'))); // the same route string after NFC (§4.1)
  assert.equal(hist.canBack(), true, 'home is behind type/schůzka');
  assert.equal(str(hist.back()), HOME, 'one Back reaches home: the repeated route added no entry');
  assert.equal(hist.canBack(), false, 'nothing before home');
  assert.equal(str(hist.forward()), SCHUZKA);
  assert.equal(hist.canForward(), false, 'only one type/schůzka entry');
});

test('fr_nav_03_ac2_can_back_and_can_forward_follow_the_position', async () => {
  const { hist, route } = await setup();
  assert.deepEqual([hist.canBack(), hist.canForward()], [false, false], 'empty history');
  hist.push(route(HOME));
  assert.deepEqual([hist.canBack(), hist.canForward()], [false, false], 'one entry');
  hist.push(route(PORADA));
  assert.deepEqual([hist.canBack(), hist.canForward()], [true, false], 'two entries, at the end');
  hist.back();
  assert.deepEqual([hist.canBack(), hist.canForward()], [false, true], 'at the start');
  hist.forward();
  assert.deepEqual([hist.canBack(), hist.canForward()], [true, false], 'at the end again');
});

test('fr_nav_03_ac4_scroll_position_kept_per_entry', async () => {
  const { hist, route, str } = await setup();
  hist.push(route(CIL));
  hist.saveScroll(1234);
  hist.push(route(ODKAZY));
  hist.saveScroll(56);
  const b = hist.back();
  assert.equal(str(b), CIL);
  assert.equal(b!.scrollTop, 1234, 'Cíl comes back with the scroll position it had when it was left');
  hist.saveScroll(400); // scrolled again before going forward
  const f = hist.forward();
  assert.equal(str(f), ODKAZY);
  assert.equal(f!.scrollTop, 56, 'Odkazy keeps its own position');
  const b2 = hist.back();
  assert.equal(b2!.scrollTop, 400, 'the position saved when Cíl was left the second time');
});

test('fr_nav_03_ac4_fragment_entry_restored_to_saved_scroll_not_fragment', async () => {
  const { hist, route, str } = await setup();
  const withFragment = `${CIL}#^blok1`;
  hist.push(route(ODKAZY));
  hist.push(route(withFragment));
  hist.saveScroll(77); // the user scrolled away from the block before leaving
  hist.push(route(HOME));
  const b = hist.back();
  assert.ok(b, 'Back returns the Cíl entry');
  assert.equal(str(b), withFragment, 'the entry keeps its route, fragment included');
  assert.equal(b!.scrollTop, 77, 'restored to the position at the time it was left');
});

test('fr_nav_03_ac7_clear_empties_the_history', async () => {
  const { hist, route } = await setup();
  for (const s of [HOME, PORADA, SEARCH]) hist.push(route(s));
  hist.back();
  assert.deepEqual([hist.canBack(), hist.canForward()], [true, true], 'setup: entries in both directions');
  hist.clear();
  assert.deepEqual([hist.canBack(), hist.canForward()], [false, false], 'another vault: both directions empty');
  assert.equal(hist.back(), null);
  assert.equal(hist.forward(), null);
});

test('fr_nav_03_ac7_back_and_forward_add_no_entries', async () => {
  const { hist, route, str } = await setup();
  for (const s of [HOME, PORADA, SEARCH]) hist.push(route(s));
  for (let i = 0; i < 3; i++) { hist.back(); hist.forward(); }
  assert.equal(str(hist.back()), PORADA, 'still three entries');
  assert.equal(str(hist.back()), HOME);
  assert.equal(hist.canBack(), false);
});

// ------------------------------------------------------------------------------------------------ D-521 (5A-1 feedback)
// types.md FR-TYP-09 AC-17 (e), docs/contracts/ms5-tasks.md §12.2 "History": a `new/<type>` draft is a history entry only
// while it is shown. Leaving it by a navigation (`push`) or by Back drops its entry; `replace` (its first write) turns
// it into `note/<path>`. Forward can't leave a draft (a draft is reached by a push, which drops every forward entry),
// so Back and Forward afterwards must never return `new/<type>`.

const NAPADY = 'type/nápad';
const DRAFT = 'new/nápad';
const PLANOVANI = 'note/Nápady/Plánování.md';

async function setupDraft() {
  const s = await setup();
  assert.equal(typeof (s.hist as any).replace, 'function', 'history.replace is missing (ms5-tasks §12.2)');
  s.route(DRAFT); // parseRoute must know the draft route `new/<type>` (R1)
  return { ...s, replace: (r: unknown) => (s.hist as any).replace(r) as void };
}
/** Walks every entry with Back to the start and then Forward to the end; returns the routes seen, in order. */
function walk(hist: Hist, str: (e: { route: unknown } | null) => string | null): string[] {
  const seen: string[] = [];
  for (let e = hist.back(); e; e = hist.back()) seen.push(str(e)!);
  for (let e = hist.forward(); e; e = hist.forward()) seen.push(str(e)!);
  return seen;
}

test('fr_typ_09_ac17_history_back_from_an_unwritten_draft_drops_it', async () => {
  const { hist, route, str } = await setupDraft();
  for (const s of [HOME, NAPADY, DRAFT]) hist.push(route(s));
  assert.equal(str(hist.back()), NAPADY, 'Back from the draft shows type/nápad');
  assert.equal(hist.canForward(), false, 'Forward is disabled: the draft entry is gone');
  assert.equal(hist.forward(), null, 'Forward returns nothing');
  assert.equal(str(hist.back()), HOME);
  assert.equal(hist.canBack(), false);
  assert.ok(!walk(hist, str).includes(DRAFT), 'new/nápad is never shown again by Back or Forward');
});

test('fr_typ_09_ac17_history_a_navigation_away_from_an_unwritten_draft_drops_it', async () => {
  const { hist, route, str } = await setupDraft();
  for (const s of [HOME, NAPADY, DRAFT, 'inbox']) hist.push(route(s));
  assert.equal(str(hist.back()), NAPADY, 'Back from inbox skips the left draft and shows type/nápad');
  assert.equal(str(hist.back()), HOME);
  assert.equal(hist.canBack(), false, 'nothing before home');
  assert.equal(str(hist.forward()), NAPADY);
  assert.equal(str(hist.forward()), 'inbox', 'Forward from type/nápad shows inbox, not the draft');
  assert.equal(hist.canForward(), false);
  assert.ok(!walk(hist, str).includes(DRAFT), 'new/nápad is never shown again by Back or Forward');
});

test('fr_typ_09_ac17_history_replace_turns_the_draft_into_the_note', async () => {
  const { hist, route, str, replace } = await setupDraft();
  for (const s of [HOME, NAPADY, DRAFT]) hist.push(route(s));
  replace(route(PLANOVANI)); // the first write (D-521)
  assert.deepEqual([hist.canBack(), hist.canForward()], [true, false], 'replace adds no entry and drops nothing behind');
  assert.equal(str(hist.back()), NAPADY, 'Back from the written note shows type/nápad');
  assert.equal(str(hist.forward()), PLANOVANI, 'Forward shows the new note');
  assert.equal(hist.canForward(), false, 'the note is the last entry');
  hist.push(route('inbox'));
  assert.equal(str(hist.back()), PLANOVANI, 'a written note is kept when left (it is no draft any more)');
  assert.equal(str(hist.back()), NAPADY);
  assert.equal(str(hist.back()), HOME);
  assert.ok(!walk(hist, str).includes(DRAFT), 'new/nápad is never shown again by Back or Forward');
});

