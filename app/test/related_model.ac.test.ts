// Slice REL, L1: the pure model of the Related tab (docs/contracts/v1-related.md §3.1 `app/ui/src/related/model.ts`),
// supporting docs/acceptance/related.md FR-LNK-15 AC-25 (`showLinkedOf` / `withShowLinked`: a missing or invalid value
// reads as off and other keys are kept, D-1695, D-634), AC-26 (`openRouteOf`: a Daily Note opens `daily/<date>`), AC-28
// (`focusAfter`: keep, next, previous, the switch; AP-1472) and AC-31 (`centrePath`: no request for `new/<type>` or a
// virtual day, NFC paths). Written from the ACs and the contract only (D-61). The module loads inside the tests (TS-I1).
import { test } from 'vitest';
import assert from 'node:assert/strict';

type Mod = Record<string, any>;
async function model(): Promise<Mod> {
  const path = '../ui/src/related/model.ts';
  let m: Mod | null = null;
  try { m = (await import(/* @vite-ignore */ path)) as Mod; } catch { m = null; }
  assert.ok(m, 'ui/src/related/model.ts loads');
  return m!;
}
const UI = { version: 1, theme: 'light', sidebarOpen: true, rightPanel: { open: true, tab: 'related', width: 288 } };

test('fr_lnk_15_ac25_show_linked_notes_switch_model', async () => {
  const m = await model();
  assert.equal(m.showLinkedOf(UI), false, 'no related key: off');
  for (const bad of ['yes', 1, null, 'true', {}]) assert.equal(m.showLinkedOf({ ...UI, related: { showLinked: bad } }), false, `showLinked ${JSON.stringify(bad)}: off`);
  assert.equal(m.showLinkedOf({ ...UI, related: { showLinked: true } }), true, 'showLinked true: on');
  const on = m.withShowLinked({ ...UI, related: { showLinked: 'yes', other: 7 } }, true);
  assert.deepEqual(on.related, { showLinked: true, other: 7 }, 'withShowLinked keeps the related object\'s other keys');
  assert.deepEqual(on.rightPanel, UI.rightPanel, 'and the rest of the UI state');
  assert.deepEqual(m.withShowLinked(UI, false).related, { showLinked: false }, 'turning it off stores false');
});

test('fr_lnk_15_ac26_chips_preview_and_open_as_backlinks_route', async () => {
  const m = await model();
  const entry = (path: string, type: string, title: string) => ({ path, type, title, review: null, status: null, due: null, completed: null, linked: false, excerpt: null, score: 1, shared: 3 });
  assert.equal(m.openRouteOf(entry('Daily/2026-09-30.md', 'daily-note', '2026-09-30')), 'daily/2026-09-30', 'a Daily Note opens daily/<date>');
  assert.equal(m.openRouteOf(entry('Tasks/Poslat návrh rozpočtu financím.md', 'task', 'Poslat návrh rozpočtu financím')), 'note/Tasks/Poslat návrh rozpočtu financím.md', 'a task opens note/<path>');
  assert.equal(m.openRouteOf(entry('Daily/Výlet.md', 'daily-note', 'Výlet')), 'note/Daily/Výlet.md', 'a daily-note without an ISO title opens note/<path>');
});

test('fr_lnk_15_ac28_live_updates_keep_focus_model', async () => {
  const m = await model();
  const [a, b, c] = ['Daily/2026-09-30.md', 'Tasks/Poslat návrh rozpočtu financím.md', 'Pages/Hiking in the mountains.md'];
  assert.equal(m.focusAfter([a, b], b, [a, b]), 'keep', 'the focused entry stays: keep');
  assert.deepEqual(m.focusAfter([a, b, c], b, [a, c]), { path: c }, 'removed: the entry now at its former index (the next)');
  assert.deepEqual(m.focusAfter([a, b], b, [a]), { path: a }, 'removed, nothing after it: the previous one');
  assert.equal(m.focusAfter([b], b, []), 'switch', 'no entry left: the switch');
  assert.equal(m.focusAfter([a, b], null, [a]), 'keep', 'focus not in the list: keep');
  assert.equal(m.focusAfter([a, b], b, [b, a]), 'keep', 'moved but still listed: keep');
});

test('fr_lnk_15_ac31_routes_with_the_related_tab_model', async () => {
  const m = await model();
  const nfdPath = 'Pages/Důležité termíny školení.md'.normalize('NFD');
  assert.equal(m.centrePath({ id: 'note/<path>', param: nfdPath }, null), 'Pages/Důležité termíny školení.md'.normalize('NFC'), 'note/<path>: the NFC path');
  assert.equal(m.centrePath({ id: 'note/<path>', param: 'Images/Úl u lesa.md' }, null), 'Images/Úl u lesa.md', 'an Image object\'s page asks like any object');
  assert.equal(m.centrePath({ id: 'daily/YYYY-MM-DD', param: '2026-09-30' }, 'Daily/2026-09-30.md'), 'Daily/2026-09-30.md', 'daily/<date> with a file: its path');
  assert.equal(m.centrePath({ id: 'daily/YYYY-MM-DD', param: '2026-11-14' }, null), null, 'a virtual day: no request');
  assert.equal(m.centrePath({ id: 'new/<type>', param: 'page' }, null), null, 'new/<type>: no request');
});
