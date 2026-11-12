// Clicks for the real-app tests as mouse events at screen coordinates, loaded by helpers/l6-guard.ts in place of the
// `webdriverio` module every test file imports (`await import('webdriverio')`). Its `remote` is webdriverio's, with every
// session's element clicks changed:
// - `element.click()` and `element.doubleClick()` become `macos: click` / `macos: doubleClick` at the element's centre;
// - `macos: click`, `doubleClick`, `rightClick`, `hover` and `scroll` given an `elementId`, and `clickAndDrag` given
//   `sourceElementId` / `destinationElementId`, get the elements' centres instead.
// Why: with Xcode 27.2 on macOS 26.6, XCTest's element click asserts in SkyLight (`SLSGetDisplaysWithRect`, from
// `XCElementSnapshot displayID`) and kills WebDriverAgent for elements inside Tegg's web content (a mind-map node, a
// note's text, the graph), while its coordinate events work (L6 run of 2026-11-01). D-751's helper already clicks at the
// centre where XCTest's click does nothing; this does it for every click, so the copies of that helper in the test files
// behave the same. A test that needs another point passes coordinates itself, which is left as it is.
import * as wdio from 'webdriverio';
import { execFileSync } from 'node:child_process';

export * from 'webdriverio';

type Rect = { x: number; y: number; width: number; height: number };
const centre = (r: Rect) => ({ x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) });

export async function remote(...args: Parameters<typeof wdio.remote>): ReturnType<typeof wdio.remote> {
  const d = await wdio.remote(...args);
  const rect = (id: string): Promise<Rect> => d.getElementRect(id);
  // An element below or above the window's visible part (a paragraph in the middle of a long note) reports a centre
  // outside the window, and a click there lands on whatever is at that point. XCTest's own click scrolled to the
  // element first; this does the same with wheel events over the window's centre, until the centre is inside.
  const inView = async (id: string): Promise<{ x: number; y: number }> => {
    let c = centre(await rect(id));
    // Menus and the menu bar (menu 53, menu item 54, menu bar 55, menu bar item 56, status item 80) are outside the
    // window by design and never scroll; a wheel event would close an open menu.
    const type = String(await d.getElementAttribute(id, 'elementType').catch(() => ''));
    if (['53', '54', '55', '56', '80'].includes(type)) return c;
    // A switch (40) in Settings reports a frame as tall as its row; the control itself is at the top of it, and a
    // click in the middle of the frame misses it.
    const atTop = async (c0: { x: number; y: number }) => { if (type !== '40') return c0; const r = await rect(id); return r.height > 40 ? { x: c0.x, y: Math.round(r.y + 10) } : c0; };
    const win = await d.$('//XCUIElementTypeWindow').then((w: any) => d.getElementRect(w.elementId)).catch(() => null);
    if (!win) return atTop(c);
    // Only a centre outside the window counts: title-bar and bottom-bar controls are inside it and don't scroll.
    const top = win.y, bottom = win.y + win.height;
    const mid = { x: Math.round(win.x + win.width / 2), y: Math.round(win.y + win.height / 2) };
    let sign = -1, stuck = 0;
    for (let i = 0; i < 40 && stuck < 2 && (c.y < top || c.y > bottom); i++) {
      const off = c.y - mid.y;
      await d.execute('macos: scroll', { ...mid, deltaX: 0, deltaY: sign * Math.sign(off) * Math.min(Math.abs(off), 400) });
      await new Promise((r) => setTimeout(r, 150));
      const next = centre(await rect(id));
      // Moved away, or didn't move: try the other direction once, then give up (the element doesn't scroll).
      if (Math.abs(next.y - mid.y) >= Math.abs(off)) { sign = -sign; stuck++; } else stuck = 0;
      c = next;
    }
    return atTop(c);
  };
  for (const [command, script] of [['click', 'macos: click'], ['doubleClick', 'macos: doubleClick']] as const) {
    d.overwriteCommand(command, async function (this: any) {
      await d.execute(script, await inView(this.elementId));
    } as any, { attachToElement: true });
  }
  d.overwriteCommand('execute', async function (orig: any, script: any, ...rest: any[]) {
    const a = rest[0];
    if (typeof script === 'string' && a && typeof a === 'object') {
      // `macos: hover` brings the app under test to the front, which a pointer moving over a window never does
      // (the capture confirmation panel must not take the focus, FR-CAP-01 AC-13). A hover is plain mouse-moved
      // events from CoreGraphics, a few points apart so the page sees the pointer move.
      if (script === 'macos: hover') {
        const to = typeof a.elementId === 'string' ? await inView(a.elementId) : { x: Number(a.x), y: Number(a.y) };
        if (!Number.isFinite(to.x) || !Number.isFinite(to.y)) throw new Error(`macos: hover needs an element or a point: ${JSON.stringify(a)}`);
        const js = `ObjC.import('CoreGraphics'); for (const dx of [-6, -4, -2, 0]) { const e = $.CGEventCreateMouseEvent(null, $.kCGEventMouseMoved, {x: ${to.x} + dx, y: ${to.y}}, 0); $.CGEventPost($.kCGHIDEventTap, e); delay(0.03); }`;
        execFileSync('osascript', ['-l', 'JavaScript', '-e', js], { timeout: 10_000 });
        return null;
      }
      if (/^macos: (click|doubleClick|rightClick|hover|scroll)$/.test(script) && typeof a.elementId === 'string') {
        const { elementId, ...other } = a;
        return orig(script, { ...other, ...(script === 'macos: scroll' ? centre(await rect(elementId)) : await inView(elementId)) });
      }
      if (script === 'macos: clickAndDrag' && typeof a.sourceElementId === 'string' && typeof a.destinationElementId === 'string') {
        const { sourceElementId, destinationElementId, ...other } = a;
        const s = centre(await rect(sourceElementId)), e = centre(await rect(destinationElementId));
        return orig(script, { ...other, startX: s.x, startY: s.y, endX: e.x, endY: e.y });
      }
    }
    return orig(script, ...rest);
  } as any);
  return d;
}
