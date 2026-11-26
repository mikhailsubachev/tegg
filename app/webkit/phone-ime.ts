// Slice AND-3, the L5p keyboard-input helper (docs/contracts/android-edit.md §17.1; docs/acceptance/android-edit.md
// RA16, test layers "L5p (keyboard input)"; CP-14 → D-2540): `ime(page, steps)` sends what Android keyboards send.
//
// - Chromium (authoritative, the WebView's engine): CDP `Input.imeSetComposition` (after a `rawKeyDown` with
//   `key: 'Unidentified'`, `windowsVirtualKeyCode: 229`), `Input.insertText` and `Input.dispatchKeyEvent`.
// - WebKit: the same event sequence dispatched from script (`keydown` 229, `compositionstart` / `compositionupdate` /
//   `compositionend`, a cancelable `beforeinput` with RA16's `inputType` and `data`), the default action through
//   `document.execCommand` when the `beforeinput` isn't prevented, then `input`. A step WebKit can't reproduce is
//   skipped on WebKit by the test itself (`test.skip(browserName === 'webkit', …)`), as D-2471 allows.
//
// The steps act on the focused element (the `Note body`, a draft's `Title`, a field). The helper keeps the composing
// text between calls for one page (`compose` steps replace it), so a later `commit`, `finish`, `enter` or `backspace`
// ends it. No AC outcome is asserted here (TS-I1); a step that can't be sent is an AssertionError.
// Written from the ACs and the contract only (D-61).
import type { CDPSession, Page } from '@playwright/test';
import assert from 'node:assert/strict';

export type ImeStep =
  | { compose: string; cursor?: number }
  | { commit: string }
  | { finish: true }
  | { text: string }
  | { replace: string; over: number }
  | { enter: true; via?: 'key' | '229' }
  | { backspace: true; via?: 'key' | '229' }
  | { deleteSurrounding: { before: number; after: number } }
  | { paste: { 'text/plain'?: string; 'text/html'?: string; 'image/png'?: true }; via?: 'menu' | 'keyboard' };

const composing = new WeakMap<Page, string>();
const sessions = new WeakMap<Page, CDPSession>();

export const engineOf = (page: Page) => page.context().browser()?.browserType().name() ?? 'webkit';

async function cdp(page: Page): Promise<CDPSession> {
  let s = sessions.get(page);
  if (!s) {
    s = await page.context().newCDPSession(page);
    sessions.set(page, s);
  }
  return s;
}

/** A 1×1 PNG (the clipboard image of FR-EDT-14 AC-8). */
const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

/** In-page: selects `before` characters before the caret and `after` characters after it (deleteSurroundingText, a
 *  replacement over the last word). */
async function selectAround(page: Page, before: number, after: number) {
  await page.evaluate(([b, a]) => {
    const s = getSelection();
    if (!s || s.rangeCount === 0) return;
    s.collapseToEnd();
    for (let i = 0; i < a; i++) s.modify('move', 'forward', 'character');
    for (let i = 0; i < b + a; i++) s.modify('extend', 'backward', 'character');
  }, [before, after] as const);
}

/** The number of user-perceived characters (graphemes): `selection.modify('extend', 'backward', 'character')` moves by
 *  grapheme, so a replacement over the composing text counts graphemes, not code points (D-2555). */
const graphemes = (s: string) => [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(s)].length;

type Synth = { kind: 'composeStart' | 'composeUpdate' | 'composeEnd' | 'input' | 'paste'; inputType?: string; data?: string | null; replaceLen?: number; key?: string; code?: number; clip?: Record<string, string> };

/** In-page (WebKit): one input step as script events, `execCommand` being the default action. */
async function synth(page: Page, o: Synth) {
  await page.evaluate((x) => {
    const t = (document.activeElement ?? document.body) as HTMLElement;
    // An `<input>` or `<textarea>` (a draft's `Title`, a field): `getSelection().modify` and `execCommand` don't edit
    // its value, so the default action sets it with `setRangeText` and dispatches `input` itself (D-2555).
    const field = t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement ? t : null;
    const seg = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
    const fieldEdit = (f: HTMLInputElement | HTMLTextAreaElement, inputType: string, data: string | null, back: number) => {
      const v = f.value;
      const end = f.selectionEnd ?? v.length;
      let start = f.selectionStart ?? end;
      const graphemeStart = (n: number) => {
        const g = [...seg.segment(v.slice(0, end))];
        const k = Math.max(0, g.length - n);
        return k < g.length ? g[k].index : end;
      };
      if (back > 0) start = graphemeStart(back);
      if (inputType === 'insertParagraph' || inputType === 'insertLineBreak') {
        if (f instanceof HTMLInputElement) return; // no line in a one-line field; the keydown carries the Enter
        data = '\n';
      }
      if (inputType === 'deleteContentBackward') {
        if (start === end) start = graphemeStart(1);
        data = '';
      }
      f.setRangeText(data ?? '', start, end, 'end');
      f.dispatchEvent(new InputEvent('input', { inputType, data, bubbles: true, composed: true, isComposing: inputType === 'insertCompositionText' }));
    };
    const kd = (key: string, code: number) => {
      const e = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, composed: true });
      Object.defineProperty(e, 'keyCode', { value: code });
      Object.defineProperty(e, 'which', { value: code });
      return t.dispatchEvent(e);
    };
    const selectBack = (n: number) => {
      const s = getSelection();
      if (!s) return;
      s.collapseToEnd();
      for (let i = 0; i < n; i++) s.modify('extend', 'backward', 'character');
    };
    const before = (inputType: string, data: string | null, dt?: DataTransfer) =>
      t.dispatchEvent(new InputEvent('beforeinput', { inputType, data, bubbles: true, cancelable: true, composed: true, ...(dt ? { dataTransfer: dt } : {}) } as InputEventInit));
    const exec = (inputType: string, data: string | null) => {
      if (inputType === 'insertParagraph') document.execCommand('insertParagraph');
      else if (inputType === 'insertLineBreak') document.execCommand('insertLineBreak');
      else if (inputType === 'deleteContentBackward') document.execCommand('delete');
      else document.execCommand('insertText', false, data ?? '');
    };
    if (x.kind === 'composeStart') {
      kd('Unidentified', 229);
      t.dispatchEvent(new CompositionEvent('compositionstart', { data: '', bubbles: true }));
      return;
    }
    if (x.kind === 'composeUpdate' || x.kind === 'composeEnd') {
      kd('Unidentified', 229);
      t.dispatchEvent(new CompositionEvent('compositionupdate', { data: x.data ?? '', bubbles: true }));
      if (before('insertCompositionText', x.data ?? '')) {
        if (field) fieldEdit(field, 'insertCompositionText', x.data ?? '', x.replaceLen ?? 0);
        else {
          selectBack(x.replaceLen ?? 0);
          document.execCommand('insertText', false, x.data ?? '');
        }
      }
      if (x.kind === 'composeEnd') t.dispatchEvent(new CompositionEvent('compositionend', { data: x.data ?? '', bubbles: true }));
      return;
    }
    if (x.kind === 'paste') {
      const dt = new DataTransfer();
      for (const [k, v] of Object.entries(x.clip ?? {})) {
        if (k === 'image/png') dt.items.add(new File([Uint8Array.from(atob(v), (c) => c.charCodeAt(0))], 'obrazek.png', { type: 'image/png' }));
        else dt.setData(k, v);
      }
      const e = new Event('paste', { bubbles: true, cancelable: true });
      Object.defineProperty(e, 'clipboardData', { value: dt });
      if (t.dispatchEvent(e) && before('insertFromPaste', null, dt) && dt.getData('text/plain')) {
        if (field) fieldEdit(field, 'insertFromPaste', dt.getData('text/plain'), 0);
        else document.execCommand('insertText', false, dt.getData('text/plain'));
      }
      return;
    }
    kd(x.key ?? 'Unidentified', x.code ?? 229);
    if (before(x.inputType ?? 'insertText', x.data ?? null)) {
      if (field) fieldEdit(field, x.inputType ?? 'insertText', x.data ?? null, 0);
      else exec(x.inputType ?? 'insertText', x.data ?? null);
    }
  }, o);
}

/** Commits the composing text, if any (Enter and Backspace do this first, RA16). */
async function commitPending(page: Page) {
  const c = composing.get(page);
  if (c === undefined) return;
  composing.delete(page);
  if (engineOf(page) === 'chromium') await (await cdp(page)).send('Input.insertText', { text: c });
  else await synth(page, { kind: 'composeEnd', data: c, replaceLen: graphemes(c) });
}

async function key(page: Page, k: 'Enter' | 'Backspace') {
  const s = await cdp(page);
  const code = k === 'Enter' ? 13 : 8;
  await s.send('Input.dispatchKeyEvent', { type: k === 'Enter' ? 'keyDown' : 'rawKeyDown', key: k, code: k, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code, ...(k === 'Enter' ? { text: '\r', unmodifiedText: '\r' } : {}) });
  await s.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code: k, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code });
}
async function key229(page: Page, inputType: string) {
  await (await cdp(page)).send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Unidentified', windowsVirtualKeyCode: 229, nativeVirtualKeyCode: 229 });
  await page.evaluate((it) => {
    const t = (document.activeElement ?? document.body) as HTMLElement;
    t.dispatchEvent(new InputEvent('beforeinput', { inputType: it, bubbles: true, cancelable: true, composed: true }));
  }, inputType);
}

/** Sends RA16's keyboard input to the focused element, step by step (contract §17.1). */
export async function ime(page: Page, steps: ImeStep[]): Promise<void> {
  const chromium = engineOf(page) === 'chromium';
  for (const step of steps) {
    if ('compose' in step) {
      const prev = composing.get(page);
      composing.set(page, step.compose);
      if (chromium) {
        const s = await cdp(page);
        await s.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Unidentified', windowsVirtualKeyCode: 229, nativeVirtualKeyCode: 229 });
        const cur = step.cursor ?? step.compose.length;
        await s.send('Input.imeSetComposition', { text: step.compose, selectionStart: cur, selectionEnd: cur });
      } else {
        if (prev === undefined) await synth(page, { kind: 'composeStart' });
        await synth(page, { kind: 'composeUpdate', data: step.compose, replaceLen: prev === undefined ? 0 : graphemes(prev) });
      }
    } else if ('commit' in step) {
      const prev = composing.get(page);
      composing.delete(page);
      if (chromium) {
        const s = await cdp(page);
        await s.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Unidentified', windowsVirtualKeyCode: 229, nativeVirtualKeyCode: 229 });
        await s.send('Input.insertText', { text: step.commit });
      } else if (prev !== undefined) await synth(page, { kind: 'composeEnd', data: step.commit, replaceLen: graphemes(prev) });
      else await synth(page, { kind: 'input', inputType: 'insertText', data: step.commit });
    } else if ('finish' in step) {
      await commitPending(page);
    } else if ('text' in step) {
      assert.equal(composing.get(page), undefined, 'ime: `text` is sent outside a composition (commit or finish it first)');
      if (chromium) await (await cdp(page)).send('Input.insertText', { text: step.text });
      else await synth(page, { kind: 'input', inputType: 'insertText', data: step.text });
    } else if ('replace' in step) {
      await commitPending(page);
      await selectAround(page, step.over, 0);
      if (chromium) await (await cdp(page)).send('Input.insertText', { text: step.replace });
      else await synth(page, { kind: 'input', inputType: 'insertReplacementText', data: step.replace });
    } else if ('enter' in step) {
      await commitPending(page);
      if (chromium) await (step.via === '229' ? key229(page, 'insertParagraph') : key(page, 'Enter'));
      else await synth(page, { kind: 'input', inputType: 'insertParagraph', data: null, key: step.via === '229' ? 'Unidentified' : 'Enter', code: step.via === '229' ? 229 : 13 });
    } else if ('backspace' in step) {
      await commitPending(page);
      if (chromium) await (step.via === '229' ? key229(page, 'deleteContentBackward') : key(page, 'Backspace'));
      else await synth(page, { kind: 'input', inputType: 'deleteContentBackward', data: null, key: step.via === '229' ? 'Unidentified' : 'Backspace', code: step.via === '229' ? 229 : 8 });
    } else if ('deleteSurrounding' in step) {
      await commitPending(page);
      await selectAround(page, step.deleteSurrounding.before, step.deleteSurrounding.after);
      if (chromium) await key(page, 'Backspace');
      else await synth(page, { kind: 'input', inputType: 'deleteContentBackward', data: null });
    } else if ('paste' in step) {
      await commitPending(page);
      const clip: Record<string, string> = {};
      if (step.paste['text/plain'] !== undefined) clip['text/plain'] = step.paste['text/plain'];
      if (step.paste['text/html'] !== undefined) clip['text/html'] = step.paste['text/html'];
      if (step.paste['image/png']) clip['image/png'] = PNG_B64;
      if (step.via === 'keyboard') {
        const text = clip['text/plain'] ?? '';
        if (chromium) await (await cdp(page)).send('Input.insertText', { text });
        else await synth(page, { kind: 'input', inputType: 'insertText', data: text });
      } else await synth(page, { kind: 'paste', clip });
    }
    // Let the editor read the DOM change (ProseMirror's observer, input rules) before the next step.
    await page.waitForTimeout(30);
  }
}

/** Forgets the page's composing state (a test that leaves a composition open on purpose, FR-EDT-08 AC-15). */
export function imeReset(page: Page) {
  composing.delete(page);
}
/** Whether the page has a composition this helper started and hasn't ended. */
export const imeComposing = (page: Page) => composing.has(page);
