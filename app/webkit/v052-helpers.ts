// Helpers for the v0.52 feedback WebKit tests (L5; docs/feedback/ms5-v052.md, D-598…D-608): computed-style probes and
// the shared scenarios of the AC tests and their `bug_v052_*` regressions. No AC assertions here except `must`
// (re-exported through the other helpers), which turns a missing element into an AssertionError (TS-I1). Written from
// the ACs and the contracts only (D-61).
import type { Locator, Page } from '@playwright/test';

/** `rgb(…)` / `rgba(…)` → [r, g, b, a]; null for anything else. */
export function rgba(c: string | null | undefined): [number, number, number, number] | null {
  const m = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+))?\s*\)/.exec(c ?? '');
  return m ? [Number(m[1]), Number(m[2]), Number(m[3]), m[4] === undefined ? 1 : Number(m[4])] : null;
}
export const transparent = (c: string | null | undefined) => { const v = rgba(c); return !v || v[3] === 0; };
/** WCAG relative luminance of a computed colour (0…1); 0 when it isn't a colour. */
export function luminance(c: string | null | undefined): number {
  const v = rgba(c);
  if (!v) return 0;
  const f = (x: number) => { const s = x / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(v[0]) + 0.7152 * f(v[1]) + 0.0722 * f(v[2]);
}
/** Whether a computed colour is warm amber/orange: red high, blue clearly lower, green between. */
export function amber(c: string | null | undefined): boolean {
  const v = rgba(c);
  return !!v && v[3] > 0 && v[0] >= 120 && v[0] - v[2] >= 60 && v[1] >= v[2] && v[0] >= v[1];
}

/** The computed colour of a CSS custom property (`--name`) resolved in the page, or null when it isn't defined. */
export async function cssVarColour(page: Page, name: string): Promise<string | null> {
  return page.evaluate((n) => {
    const raw = getComputedStyle(document.documentElement).getPropertyValue(n).trim();
    if (!raw) return null;
    const p = document.createElement('div');
    p.style.color = `var(${n})`;
    document.body.appendChild(p);
    const c = getComputedStyle(p).color;
    p.remove();
    return c;
  }, name);
}

/** The first non-transparent background colour of the element or its ancestors (what the element is drawn on). */
export async function effectiveBg(loc: Locator): Promise<string> {
  return loc.first().evaluate((el) => {
    for (let e: Element | null = el; e; e = e.parentElement) {
      const b = getComputedStyle(e).backgroundColor;
      if (b && b !== 'transparent' && !/rgba\([^)]*,\s*0\)$/.test(b)) return b;
    }
    return getComputedStyle(document.body).backgroundColor;
  });
}
/** The background colour of the nearest ancestor of `loc` (not `loc` itself) that has one: the page behind a control. */
export async function bgBehind(loc: Locator): Promise<string> {
  return loc.first().evaluate((el) => {
    for (let e: Element | null = el.parentElement; e; e = e.parentElement) {
      const b = getComputedStyle(e).backgroundColor;
      if (b && b !== 'transparent' && !/rgba\([^)]*,\s*0\)$/.test(b)) return b;
    }
    return getComputedStyle(document.body).backgroundColor;
  });
}

/** Selected computed styles of an element. */
export async function styleOf(loc: Locator): Promise<{ cursor: string; bg: string; color: string; weight: number; border: string; borderColor: string; borderWidth: string; shadow: string; decoration: string; whiteSpace: string; overflow: string; textOverflow: string }> {
  return loc.first().evaluate((e) => {
    const s = getComputedStyle(e);
    return {
      cursor: s.cursor, bg: s.backgroundColor, color: s.color, weight: Number(s.fontWeight) || 400, border: s.borderStyle,
      borderColor: s.borderTopColor, borderWidth: s.borderTopWidth, shadow: s.boxShadow, decoration: s.textDecorationLine,
      whiteSpace: s.whiteSpace, overflow: s.overflow, textOverflow: s.textOverflow,
    };
  });
}

/** Small round-ish elements (dots) inside `loc` with a non-transparent background, as [width, height, background]. */
export async function dots(loc: Locator): Promise<[number, number, string][]> {
  return loc.first().evaluate((root) => [...root.querySelectorAll('*')].map((e) => {
    const r = (e as HTMLElement).getBoundingClientRect();
    const s = getComputedStyle(e);
    return [Math.round(r.width * 10) / 10, Math.round(r.height * 10) / 10, s.backgroundColor, s.borderRadius] as [number, number, string, string];
  }).filter(([w, h, bg, rad]) => w > 0 && w <= 10 && Math.abs(w - h) <= 1 && bg && bg !== 'transparent' && !/rgba\([^)]*,\s*0\)$/.test(bg) && rad !== '0px')
    .map(([w, h, bg]) => [w, h, bg] as [number, number, string]));
}

// ------------------------------------------------------------------------------------------------ the capture title (FR-CAP-01 AC-20)

export type CaretProbe = {
  /** The mirror's title element was found (aria-hidden, beside the textarea). */
  mirror: boolean;
  /** Per caret offset 0…length of the title line: |x(textarea caret) − x(same offset in the mirror)| in px. */
  dx: number[];
  /** The mirror rect of `word` vs the textarea caret x at its start and end. */
  word: { left: number; right: number } | null;
  /** Title vs body drawing: font weight and text-stroke width of the mirror's title and of the body line. */
  title: { weight: number; stroke: number } | null;
  body: { weight: number; stroke: number } | null;
};

/** Measures the capture text's caret against the mirror's bold title (D-592; contract ms5-capture §16.4): the textarea
 *  caret x for each offset of the first line comes from a copy of the textarea with its computed text styles (the
 *  glyphs the caret and selection are drawn from), the mirror x from a DOM range at the same offset of the mirror text. */
export async function caretProbe(textarea: Locator, title: string, word: string): Promise<CaretProbe> {
  return textarea.evaluate((ta, [t, w]) => {
    const area = ta as HTMLTextAreaElement;
    const host = area.parentElement!;
    const mirrorRoot = ([...host.querySelectorAll('[aria-hidden="true"]')] as HTMLElement[]).find((m) => (m.textContent ?? '').includes(t as string)) ?? null;
    const titleEl = (mirrorRoot?.querySelector('.capture-mirror-title') as HTMLElement | null)
      ?? (mirrorRoot ? ([...mirrorRoot.querySelectorAll('*')] as HTMLElement[]).find((e) => (e.textContent ?? '') === t) ?? null : null);
    const out: any = { mirror: !!titleEl, dx: [], word: null, title: null, body: null };
    if (!mirrorRoot || !titleEl) return out;
    const s = getComputedStyle(area);
    const copy = document.createElement('div');
    for (const p of ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'fontVariant', 'fontStretch', 'letterSpacing', 'wordSpacing', 'lineHeight', 'textTransform', 'textIndent',
      'paddingLeft', 'paddingRight', 'paddingTop', 'paddingBottom', 'borderLeftWidth', 'borderRightWidth', 'borderTopWidth', 'borderBottomWidth', 'boxSizing', 'tabSize', 'fontKerning', 'fontFeatureSettings', 'textRendering']) {
      (copy.style as any)[p] = (s as any)[p];
    }
    copy.style.borderStyle = 'solid';
    copy.style.borderColor = 'transparent';
    copy.style.position = 'fixed';
    copy.style.visibility = 'hidden';
    copy.style.whiteSpace = 'pre-wrap';
    copy.style.overflowWrap = 'break-word';
    const r0 = area.getBoundingClientRect();
    copy.style.left = `${r0.left}px`;
    copy.style.top = `${r0.top}px`;
    copy.style.width = `${r0.width}px`;
    document.body.appendChild(copy);
    const caretX = (off: number) => {
      copy.textContent = '';
      copy.appendChild(document.createTextNode((t as string).slice(0, off)));
      const mark = document.createElement('span');
      mark.textContent = '​';
      copy.appendChild(mark);
      return mark.getBoundingClientRect().left - area.scrollLeft;
    };
    const texts: Text[] = [];
    const walker = document.createTreeWalker(titleEl, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) texts.push(n as Text);
    const mirrorX = (off: number) => {
      let left = off;
      for (const n of texts) {
        if (left <= n.data.length) {
          const r = document.createRange();
          r.setStart(n, left);
          r.setEnd(n, left);
          const rect = r.getClientRects()[0] ?? r.getBoundingClientRect();
          return rect.left;
        }
        left -= n.data.length;
      }
      return NaN;
    };
    for (let i = 0; i <= (t as string).length; i++) out.dx.push(Math.round(Math.abs(caretX(i) - mirrorX(i)) * 100) / 100);
    const at = (t as string).indexOf(w as string);
    if (at >= 0) {
      let left = at;
      let node: Text | null = null;
      for (const n of texts) { if (left < n.data.length) { node = n; break; } left -= n.data.length; }
      if (node) {
        const r = document.createRange();
        r.setStart(node, left);
        r.setEnd(node, left + (w as string).length);
        const rect = r.getBoundingClientRect();
        out.word = { left: Math.round(Math.abs(rect.left - caretX(at)) * 100) / 100, right: Math.round(Math.abs(rect.right - caretX(at + (w as string).length)) * 100) / 100 };
      }
    }
    copy.remove();
    const look = (e: Element) => { const cs = getComputedStyle(e); return { weight: Number(cs.fontWeight) || 400, stroke: parseFloat((cs as any).webkitTextStrokeWidth ?? '0') || 0 }; };
    out.title = look(titleEl);
    const bodyEl = [...mirrorRoot.querySelectorAll('*')].find((e) => e !== titleEl && !titleEl.contains(e) && !e.contains(titleEl) && (e.textContent ?? '').trim() !== '');
    out.body = look(bodyEl ?? mirrorRoot);
    return out;
  }, [title, word] as const);
}
