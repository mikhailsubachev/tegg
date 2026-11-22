// D-1939 (FR-NAV-03 AC-11, D-1511): after a swipe goes Back or Forward, the time the app spends busy (drawing the new
// page, loading its data) is never a pause between that swipe's wheel events. The flaky nav_swipe gate run: the new
// page kept the main thread busy for 200–400 ms under load, which delayed the rest of the same swipe past the 200 ms
// gesture gap, so its remaining events counted as a new gesture and went Back again.
import { test } from 'vitest';
import assert from 'node:assert/strict';

type Listener = (e: WheelEvent) => void;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Keeps the main thread busy for `ms`, as drawing a page does. */
const busy = (ms: number) => { const end = performance.now() + ms; while (performance.now() < end) { /* busy */ } };

async function setup() {
  let onWheel: Listener | null = null;
  (globalThis as any).Element ??= class {};
  (globalThis as any).window = {
    innerWidth: 1440,
    addEventListener: (type: string, fn: Listener) => { if (type === 'wheel') onWheel = fn; },
    removeEventListener: () => { onWheel = null; },
  };
  const mod = await import('../../ui/src/shell/navSwipe.ts');
  const steps: string[] = [];
  const off = mod.installNavSwipe({ enabled: () => true, blocked: () => false, step: (d) => steps.push(d) });
  /** A wheel event stamped now, as the browser stamps it when it is delivered. */
  const wheel = (deltaX: number) => onWheel!({ timeStamp: performance.now(), deltaX, deltaY: 0, deltaMode: 0, ctrlKey: false, metaKey: false, target: null } as unknown as WheelEvent);
  return { steps, wheel, off };
}

test('bug_d1939_fr_nav_03_render_time_is_not_a_pause', async () => {
  const { steps, wheel, off } = await setup();
  // One swipe right: 40 px events 10 ms apart; the 3rd reaches 120 px and goes Back.
  for (let i = 0; i < 3; i++) { wheel(-40); await sleep(10); }
  assert.deepEqual(steps, ['back'], 'the swipe goes Back once it reaches 120 px');
  // The new page keeps the main thread busy for 300 ms; the rest of the swipe's events are delivered after it.
  busy(300);
  for (let i = 0; i < 9; i++) { wheel(-40); await sleep(10); }
  wheel(-400);
  assert.deepEqual(steps, ['back'], 'the rest of the same swipe is its momentum: still one step (busy time is not a pause)');
  // A real pause, with the app idle, starts a new gesture, which navigates again.
  await sleep(260);
  for (let i = 0; i < 3; i++) { wheel(-40); await sleep(10); }
  assert.deepEqual(steps, ['back', 'back'], 'a swipe after a 200 ms idle pause is a new gesture');
  off();
});
