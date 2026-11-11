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
    const win = await d.$('//XCUIElementTypeWindow').then((w: any) => d.getElementRect(w.elementId)).catch(() => null);
    if (!win) return c;
    const top = win.y + 80, bottom = win.y + win.height - 40;
    const mid = { x: Math.round(win.x + win.width / 2), y: Math.round(win.y + win.height / 2) };
    let sign = -1;
    for (let i = 0; i < 40 && (c.y < top || c.y > bottom); i++) {
      const off = c.y - mid.y;
      await d.execute('macos: scroll', { ...mid, deltaX: 0, deltaY: sign * Math.sign(off) * Math.min(Math.abs(off), 400) });
      await new Promise((r) => setTimeout(r, 150));
      const next = centre(await rect(id));
      if (Math.abs(next.y - mid.y) > Math.abs(off)) sign = -sign;
      c = next;
    }
    return c;
  };
  for (const [command, script] of [['click', 'macos: click'], ['doubleClick', 'macos: doubleClick']] as const) {
    d.overwriteCommand(command, async function (this: any) {
      await d.execute(script, await inView(this.elementId));
    } as any, { attachToElement: true });
  }
  d.overwriteCommand('execute', async function (orig: any, script: any, ...rest: any[]) {
    const a = rest[0];
    if (typeof script === 'string' && a && typeof a === 'object') {
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
