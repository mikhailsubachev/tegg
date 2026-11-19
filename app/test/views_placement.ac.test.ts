// Slice Q2.1, L1: the popup placement rule (docs/contracts/v1-views.md §20 `app/ui/src/shell/placement.ts`
// `placePopup`, `POPUP_MARGIN`; D-1848, D-1861) behind docs/acceptance/views.md FR-QRY-07 AC-19: below the opener,
// left-aligned; right-aligned with the opener's right edge when the right edge would pass width − 8; clamped to the 8 px
// margins; above when it doesn't fit below; on the side with more room with `maxHeight` when it fits on neither; a
// context menu from the pointer; a submenu right of its item, else left, top-aligned with it. The four window sizes of
// AC-19 (800 × 500, 1,024 × 768, 1,440 × 900, 2,560 × 1,440) and random openers keep every popup inside. Written from the
// AC and the contract only (D-61). The module loads inside the tests (TS-I1).
import { test } from 'vitest';
import assert from 'node:assert/strict';

type Mod = Record<string, any>;
async function placement(): Promise<Mod> {
  let m: Mod | null = null;
  const path = '../ui/src/shell/placement.ts';
  try { m = (await import(/* @vite-ignore */ path)) as Mod; } catch { m = null; }
  assert.ok(m, 'ui/src/shell/placement.ts loads (v1-views §20)');
  return m!;
}
type Placed = { left: number; top: number; maxHeight: number | null; placement: string };
const VIEWPORTS = [{ width: 800, height: 500 }, { width: 1024, height: 768 }, { width: 1440, height: 900 }, { width: 2560, height: 1440 }];
const box = (left: number, top: number, w: number, h: number) => ({ left, top, right: left + w, bottom: top + h });
/** Asserts the placed popup lies inside the 8 px margins (± 0.5 px). */
function inside(p: Placed, size: { width: number; height: number }, vp: { width: number; height: number }, what: string) {
  const h = p.maxHeight === null ? size.height : Math.min(size.height, p.maxHeight);
  assert.ok(p.left >= 8 - 0.5 && p.top >= 8 - 0.5, `${what}: left ${p.left} and top ${p.top} ≥ 8`);
  assert.ok(p.left + size.width <= vp.width - 8 + 0.5, `${what}: right ${p.left + size.width} ≤ ${vp.width - 8}`);
  assert.ok(p.top + h <= vp.height - 8 + 0.5, `${what}: bottom ${p.top + h} ≤ ${vp.height - 8}`);
}

test('fr_qry_07_ac19_view_menus_stay_in_the_window', async () => {
  const m = await placement();
  assert.equal(m.POPUP_MARGIN, 8, 'POPUP_MARGIN = 8 (previews R104)');
  const vp = { width: 1440, height: 900 };
  const place = (o: Record<string, unknown>): Placed => m.placePopup({ viewport: vp, kind: 'menu', gap: 4, ...o });
  // Below, left-aligned.
  const a = place({ opener: box(100, 100, 100, 30), size: { width: 220, height: 300 } });
  assert.deepEqual(a, { left: 100, top: 134, maxHeight: null, placement: 'below-start' }, 'below the opener, left-aligned, 4 px gap');
  // The reported case: the toolbar ⋯ at the right edge opens leftwards, right-aligned with the opener.
  const b = place({ opener: box(1380, 50, 40, 30), size: { width: 240, height: 200 } });
  assert.deepEqual(b, { left: 1420 - 240, top: 84, maxHeight: null, placement: 'below-end' }, 'right-aligned with the opener\'s right edge');
  // Clamped to the left margin.
  assert.equal(place({ opener: box(2, 50, 28, 30), size: { width: 200, height: 100 } }).left, 8, 'clamped to 8 px');
  // Above when it doesn't fit below.
  const c = place({ opener: box(100, 820, 100, 30), size: { width: 220, height: 300 } });
  assert.deepEqual(c, { left: 100, top: 820 - 4 - 300, maxHeight: null, placement: 'above-start' }, 'above the opener');
  // Neither side: the side with more room, height limited to that room, scrolling inside.
  const small = { width: 800, height: 500 };
  const d: Placed = m.placePopup({ opener: box(100, 200, 100, 30), size: { width: 220, height: 600 }, viewport: small, kind: 'menu', gap: 4 });
  assert.match(d.placement, /^below-/, 'more room below (258 px) than above (188 px)');
  assert.ok(d.maxHeight !== null && d.maxHeight >= 250 && d.top >= 230, `maxHeight ${d.maxHeight} = the room below, top ${d.top} below the opener`);
  inside(d, { width: 220, height: 600 }, small, 'neither side');
  const e: Placed = m.placePopup({ opener: box(100, 380, 100, 30), size: { width: 220, height: 600 }, viewport: small, kind: 'menu', gap: 4 });
  assert.match(e.placement, /^above-/, 'more room above');
  assert.ok(e.maxHeight !== null && e.maxHeight < 380, 'height limited above');
  inside(e, { width: 220, height: 600 }, small, 'above, limited');
  // A context menu from the pointer.
  const f: Placed = place({ opener: { x: 1400, y: 850 }, size: { width: 240, height: 300 }, kind: 'context' });
  assert.equal(f.placement, 'above-end', 'at the bottom right corner: above, leftwards');
  inside(f, { width: 240, height: 300 }, vp, 'context menu');
  assert.deepEqual(place({ opener: { x: 300, y: 200 }, size: { width: 240, height: 300 }, kind: 'context' }).placement, 'below-start', 'context menu: below the pointer, rightwards');
  // A submenu right of its item, else left, top-aligned with the item.
  const g: Placed = place({ opener: box(200, 300, 220, 30), size: { width: 200, height: 150 }, kind: 'submenu' });
  assert.deepEqual([g.placement, g.top], ['right', 300], 'submenu to the right, top aligned');
  assert.ok(g.left >= 420, 'right of the item');
  const h: Placed = place({ opener: box(1200, 300, 220, 30), size: { width: 200, height: 150 }, kind: 'submenu' });
  assert.deepEqual([h.placement, h.top], ['left', 300], 'no room on the right: to the left');
  assert.ok(h.left + 200 <= 1200, 'left of the item');
  // AC-19's window sizes with random openers and sizes that fit the window: always inside.
  let seed = 20261119;
  const rnd = (n: number) => { seed ^= seed << 13; seed >>>= 0; seed ^= seed >>> 17; seed ^= seed << 5; seed >>>= 0; return seed % n; };
  for (const v of VIEWPORTS) {
    for (let i = 0; i < 300; i++) {
      const kind = (['menu', 'context', 'submenu'] as const)[rnd(3)];
      // A submenu is top-aligned and clamped (no height limit in §20), so its random heights fit the window.
      const size = { width: 120 + rnd(Math.min(400, v.width - 140)), height: 40 + rnd(kind === 'submenu' ? v.height - 60 : v.height + 200) };
      const opener = kind === 'context' ? { x: rnd(v.width), y: rnd(v.height) } : box(rnd(v.width - 40), rnd(v.height - 30), 40, 30);
      const p: Placed = m.placePopup({ opener, size, viewport: v, kind, gap: 4 });
      inside(p, size, v, `${v.width}×${v.height} ${kind} ${JSON.stringify(opener)} ${JSON.stringify(size)}`);
    }
  }
});
