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
  for (const [command, script] of [['click', 'macos: click'], ['doubleClick', 'macos: doubleClick']] as const) {
    d.overwriteCommand(command, async function (this: any) {
      await d.execute(script, centre(await rect(this.elementId)));
    } as any, { attachToElement: true });
  }
  d.overwriteCommand('execute', async function (orig: any, script: any, ...rest: any[]) {
    const a = rest[0];
    if (typeof script === 'string' && a && typeof a === 'object') {
      if (/^macos: (click|doubleClick|rightClick|hover|scroll)$/.test(script) && typeof a.elementId === 'string') {
        const { elementId, ...other } = a;
        return orig(script, { ...other, ...centre(await rect(elementId)) });
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
