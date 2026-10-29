// @vitest-environment jsdom
// v1.0 slice P (object previews), L1: the popover (docs/contracts/v1-previews.md §3.3, §7; docs/acceptance/previews.md
// R102) mounted through the public `PreviewProvider` / `usePreview().show`. FR-LNK-10 AC-1 (the R102 parts: dialog,
// header, article, footer, Open, Close, resize handle, with their roles and catalog names), FR-LNK-11 AC-13 (`click` and
// `key` origins focus the dialog, `tabindex="-1"`; `hover` never moves the focus), AC-2 (Esc and `Close preview` close and
// return the focus to the anchor), AC-4 (default 380 px wide, up to 480 px tall; the resize handle's arrow keys in 16 px
// steps, clamped to 300…720 × 200…800 and to the window minus 16 px), AC-9 (read-only: nothing editable), AC-10 (a link
// inside replaces the content, `Back to <title>`; Back returns), FR-LNK-08 AC-11 (one popover at a time), FR-LNK-10
// AC-16 (the graph's extra line: shown under the type name and in the description when given, no empty element when not;
// the `column` host renders the same component; every R104 surface uses the one implementation). The IPC is faked with
// `@tauri-apps/api/mocks` over the previews fixture (previews-helpers.ts). Written from the ACs and the contract only
// (D-61). Modules load inside each test (TS-I1).
//
// Test clock: 2026-10-28T10:00:00+01:00, Europe/Prague, en-US (previews.md); only `Date` is faked.
process.env.TZ = 'Europe/Prague';
import { afterEach, beforeEach, test, vi } from 'vitest';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { act, cleanup, fireEvent } from '@testing-library/react';
import { computeAccessibleDescription } from 'dom-accessibility-api';
import { catalog } from './read-helpers';
import {
  NOW, P, REPO, ZONE, byRole, installIpc, mountProvider, name, nfc, note, previewDialogs, setTypes, settle, show, text, theDialog, uninstallIpc,
} from './previews-helpers';

(globalThis as any).__TEGG_TZ__ = ZONE;
const desc = (e: Element) => nfc(computeAccessibleDescription(e).trim());

function setWindow(w: number, h: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: w });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: h });
  window.dispatchEvent(new Event('resize'));
}
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'], now: new Date(NOW) });
  setWindow(1600, 1200);
  await catalog().catch(() => {});
  await setTypes().catch(() => {});
});
afterEach(() => {
  cleanup();
  uninstallIpc();
  vi.useRealTimers();
});

function button(root: ParentNode, n: string): HTMLElement | null {
  return byRole(root, 'button', n)[0] ?? null;
}
function px(v: string): number | null {
  const m = /^(-?\d+(?:\.\d+)?)px$/.exec(v.trim());
  return m ? Number(m[1]) : null;
}
/** The popover's width and height as styled (jsdom has no layout: inline or computed style). */
function size(d: HTMLElement): { width: number | null; height: number | null; maxHeight: number | null } {
  const cs = getComputedStyle(d);
  return { width: px(d.style.width || cs.width), height: px(d.style.height || cs.height), maxHeight: px(d.style.maxHeight || cs.maxHeight) };
}
function handle(d: HTMLElement): HTMLElement {
  const h = d.querySelector('[data-preview-resize]') as HTMLElement | null;
  assert.ok(h, 'the resize handle [data-preview-resize]');
  return h!;
}
async function press(el: HTMLElement, key: string, times = 1) {
  for (let i = 0; i < times; i++) {
    await act(async () => {
      fireEvent.keyDown(el, { key, code: key });
      fireEvent.keyUp(el, { key, code: key });
    });
  }
}

// ------------------------------------------------------------------------------------------------ FR-LNK-10 AC-1: R102 parts

test('fr_lnk_10_ac1_popover_parts_roles_and_names_of_r102', async () => {
  const ipc = await installIpc();
  const p = await mountProvider();
  await show(p.api(), note(P.rozpocet), p.anchor, 'click');
  const d = theDialog();
  assert.equal(d.getAttribute('role') ?? (d.tagName === 'DIALOG' ? 'dialog' : null), 'dialog', 'role dialog');
  assert.equal(d.getAttribute('aria-modal'), 'false', 'non-modal (AP-806)');
  assert.equal(nfc(d.getAttribute('data-preview-path') ?? ''), P.rozpocet, 'data-preview-path');
  assert.equal(d.getAttribute('tabindex'), '-1', 'the dialog is focusable (tabindex -1)');
  assert.equal(name(d), 'Preview: Rozpočet 2027', 'name `Preview: <title>` (preview.name)');
  assert.ok(desc(d).includes('Page'), `the description is the type name: ${desc(d)}`);
  const h = d.querySelector('header');
  assert.ok(h, 'a header');
  assert.ok(h!.querySelector('[data-icon="file-text"]'), 'the Page icon');
  assert.equal(text(h!.querySelector('h2')), 'Rozpočet 2027', 'the title as an h2');
  assert.equal(byRole(d, 'article', 'Content of Rozpočet 2027').length, 1, 'article `Content of <title>`');
  assert.equal(button(d, 'Back to Rozpočet 2027'), null, 'no Back before following a link (AP-814)');
  assert.ok(text(d).includes('Double-click or ⌘↩ to open'), 'the footer hint of click mode (preview.hint.click)');
  const open = button(d, 'Open Rozpočet 2027');
  assert.ok(open, 'button `Open <title>`');
  assert.ok(text(open).includes('Open') && text(open).includes('↩'), 'visible text Open and the key hint ↩');
  assert.ok(button(d, 'Close preview'), 'button Close preview (AP-806)');
  const r = handle(d);
  assert.equal(r.getAttribute('role'), 'button', 'the resize handle has role button');
  assert.equal(name(r), 'Resize preview', 'name Resize preview');
  assert.equal(desc(r), 'Use the arrow keys to resize.', 'its description (R102)');
  assert.notEqual(r.getAttribute('tabindex'), null, 'the handle is focusable');
  assert.equal(ipc.count('note_read'), 0, 'never note_read');
  assert.equal(ipc.count('nav_opened'), 0, 'showing isn\'t opening (D-138)');
});

// ------------------------------------------------------------------------------------------------ focus (FR-LNK-11 AC-13, AC-2)

test('fr_lnk_11_ac13_click_and_key_origins_focus_the_dialog_hover_does_not', async () => {
  await installIpc();
  const p = await mountProvider();
  for (const origin of ['click', 'key'] as const) {
    p.anchor.focus();
    await show(p.api(), note(P.rozpocet), p.anchor, origin);
    const d = theDialog();
    assert.equal(document.activeElement, d, `${origin}: the focus is on the dialog element`);
    assert.equal(p.api().current?.origin, origin, `${origin}: current.origin`);
    await act(async () => p.api().close('button'));
    await settle(2);
    assert.equal(previewDialogs().length, 0, 'closed');
  }
  p.elsewhere.focus();
  await show(p.api(), note(P.rozpocet), p.anchor, 'hover');
  theDialog();
  assert.equal(document.activeElement, p.elsewhere, 'hover never moves the focus (FR-LNK-12 AC-2)');
});

test('fr_lnk_11_ac2_esc_and_close_preview_return_the_focus_to_the_anchor', async () => {
  await installIpc();
  const p = await mountProvider();
  await show(p.api(), note(P.rozpocet), p.anchor, 'click');
  const d = theDialog();
  await act(async () => { fireEvent.keyDown(d, { key: 'Escape', code: 'Escape' }); });
  await settle(2);
  assert.equal(previewDialogs().length, 0, 'Esc closes the popover');
  assert.equal(document.activeElement, p.anchor, 'the focus is back on the reference');
  assert.equal(p.api().current, null, 'nothing is shown');
  await show(p.api(), note(P.rozpocet), p.anchor, 'click');
  await act(async () => { fireEvent.click(button(theDialog(), 'Close preview')!); });
  await settle(2);
  assert.equal(previewDialogs().length, 0, 'Close preview closes it');
  assert.equal(document.activeElement, p.anchor, 'and returns the focus as Esc does');
});

// ------------------------------------------------------------------------------------------------ one at a time (FR-LNK-08 AC-11)

test('fr_lnk_08_ac11_one_popover_at_a_time', async () => {
  await installIpc();
  const p = await mountProvider();
  await show(p.api(), note(P.rozpocet), p.anchor, 'click');
  assert.equal(name(theDialog()), 'Preview: Rozpočet 2027');
  await show(p.api(), note(P.jana), p.elsewhere, 'click');
  const ds = previewDialogs();
  assert.equal(ds.length, 1, 'one dialog named Preview: … in the DOM');
  assert.equal(name(ds[0]), 'Preview: Jana Nováková', 'the second replaces the first');
  assert.equal(nfc(p.api().current?.target?.path ?? ''), P.jana);
});

// ------------------------------------------------------------------------------------------------ sizes (FR-LNK-11 AC-4)

test('fr_lnk_11_ac4_default_size_is_380_wide_and_up_to_480_tall', async () => {
  await installIpc();
  const p = await mountProvider();
  await show(p.api(), note(P.rozpocet), p.anchor, 'click');
  const s = size(theDialog());
  assert.equal(s.width, 380, `default width 380 px (got ${JSON.stringify(s)})`);
  assert.ok(s.maxHeight === 480 || (s.height !== null && s.height <= 480), `as tall as its content up to 480 px (got ${JSON.stringify(s)})`);
});

test('fr_lnk_11_ac4_arrow_keys_resize_by_16_px_within_300_to_720_by_200_to_800', async () => {
  await installIpc();
  const p = await mountProvider();
  await show(p.api(), note(P.rozpocet), p.anchor, 'click');
  const d = theDialog();
  const h = handle(d);
  h.focus();
  await press(h, 'ArrowRight');
  assert.equal(size(theDialog()).width, 396, '→ widens by 16 px');
  await press(h, 'ArrowLeft', 2);
  assert.equal(size(theDialog()).width, 364, '← narrows by 16 px');
  await press(h, 'ArrowLeft', 20);
  assert.equal(size(theDialog()).width, 300, 'never below 300 px');
  await press(h, 'ArrowRight', 40);
  assert.equal(size(theDialog()).width, 720, 'never above 720 px');
  await press(h, 'ArrowDown', 60);
  assert.equal(size(theDialog()).height, 800, 'never taller than 800 px');
  await press(h, 'ArrowUp', 60);
  assert.equal(size(theDialog()).height, 200, 'never lower than 200 px');
  await press(h, 'ArrowDown');
  assert.equal(size(theDialog()).height, 216, '↓ by 16 px');
});

test('fr_lnk_11_ac4_resizing_stops_at_the_window_minus_16_px', async () => {
  await installIpc();
  setWindow(700, 600);
  const p = await mountProvider();
  await show(p.api(), note(P.rozpocet), p.anchor, 'click');
  const h = handle(theDialog());
  h.focus();
  await press(h, 'ArrowRight', 40);
  assert.equal(size(theDialog()).width, 684, 'width ≤ window − 16 px (700 − 16)');
  await press(h, 'ArrowDown', 60);
  assert.equal(size(theDialog()).height, 584, 'height ≤ window − 16 px (600 − 16)');
});

// ------------------------------------------------------------------------------------------------ read-only (FR-LNK-11 AC-9)

test('fr_lnk_11_ac9_nothing_in_the_popover_is_editable', async () => {
  const ipc = await installIpc();
  const p = await mountProvider();
  for (const target of [note(P.rozpocet), note(P.ukol), note(P.jana), note(P.alfa)]) {
    await show(p.api(), target, p.anchor, 'click');
    const d = theDialog();
    assert.equal(d.querySelectorAll('[contenteditable="true"], [contenteditable=""], [contenteditable="plaintext-only"]').length, 0, `${target.path}: no contenteditable`);
    const fields = [...d.querySelectorAll('input, textarea, select, [role="textbox"], [role="combobox"], [role="spinbutton"]')]
      .filter((i) => !(((i as HTMLInputElement).type === 'checkbox' || i.getAttribute('role') === 'checkbox') && i.getAttribute('aria-readonly') === 'true'));
    assert.deepEqual(fields.map((f) => f.outerHTML.slice(0, 80)), [], `${target.path}: no text input; checkboxes are aria-readonly`);
    const boxes = [...d.querySelectorAll('input[type="checkbox"], [role="checkbox"]')] as HTMLElement[];
    for (const b of boxes) {
      await act(async () => { fireEvent.click(b); });
    }
    await act(async () => {
      fireEvent.keyDown(d, { key: 'x', code: 'KeyX' });
      fireEvent.keyDown(d, { key: 'Backspace', code: 'Backspace' });
      fireEvent.keyDown(d, { key: 'z', code: 'KeyZ', metaKey: true });
    });
  }
  const writes = ipc.calls.filter((c) => /^(note_write|note_create|note_create_exact|link_create|daily_create|note_trash|object_trash|type_patch|inbox_bulk)$/.test(c.cmd));
  assert.deepEqual(writes.map((c) => c.cmd), [], 'typing, ⌫, ⌘Z and clicking checkboxes send no write command');
});

// ------------------------------------------------------------------------------------------------ history (FR-LNK-11 AC-10)

test('fr_lnk_11_ac10_a_link_inside_replaces_the_content_and_back_returns', async () => {
  const ipc = await installIpc();
  const p = await mountProvider();
  await show(p.api(), note(P.rozpocet), p.anchor, 'click');
  const d0 = theDialog();
  const width0 = size(d0).width;
  const jana = [...byRole(d0, 'article', 'Content of Rozpočet 2027')[0].querySelectorAll('a, [role="link"]')].find((e) => name(e) === 'Jana Nováková') as HTMLElement | undefined;
  assert.ok(jana, 'the chip Jana Nováková in the body');
  await act(async () => { fireEvent.click(jana!); });
  await settle();
  const d1 = theDialog();
  assert.equal(name(d1), 'Preview: Jana Nováková', 'the same popover now shows Jana (one dialog)');
  assert.equal(nfc(d1.getAttribute('data-preview-path') ?? ''), P.jana);
  assert.equal(size(d1).width, width0, 'same size');
  const back = button(d1, 'Back to Rozpočet 2027');
  assert.ok(back, 'button Back to Rozpočet 2027 (preview.back)');
  assert.equal(ipc.count('nav_opened'), 0, 'following a link inside opens nothing');
  await act(async () => { fireEvent.click(back!); });
  await settle();
  const d2 = theDialog();
  assert.equal(name(d2), 'Preview: Rozpočet 2027', 'Back restores Rozpočet\'s preview');
  assert.equal(button(d2, 'Back to Rozpočet 2027'), null, 'no Back at the start of the history');
  // The stack is dropped on close.
  await act(async () => p.api().close('esc'));
  await settle(2);
  await show(p.api(), note(P.alfa), p.anchor, 'click');
  assert.equal(byRole(theDialog(), 'button').filter((b) => name(b).startsWith('Back to ')).length, 0, 'a new preview starts without history');
});

test('fr_lnk_11_ac10_the_card_inside_behaves_as_a_chip', async () => {
  await installIpc();
  const p = await mountProvider();
  await show(p.api(), note(P.rozpocet), p.anchor, 'click');
  const card = [...theDialog().querySelectorAll('[data-embed-mode="card"]')].find((e) => text(e).includes('Projekt Alfa')) as HTMLElement | undefined;
  assert.ok(card, 'the card Projekt Alfa');
  const title = ([...card!.querySelectorAll('a, [role="link"], h1, h2, h3, h4, h5, h6, [data-embed-title]')] as HTMLElement[]).find((e) => text(e) === 'Projekt Alfa') ?? card!;
  await act(async () => { fireEvent.click(title); });
  await settle();
  assert.equal(name(theDialog()), 'Preview: Projekt Alfa', 'a click on the card replaces the content');
  assert.ok(button(theDialog(), 'Back to Rozpočet 2027'), 'with Back');
});

// ------------------------------------------------------------------------------------------------ the graph line (FR-LNK-10 AC-16)

test('fr_lnk_10_ac16_extra_line_under_the_type_name_and_in_the_description', async () => {
  await installIpc();
  const p = await mountProvider();
  await show(p.api(), note(P.alfa), p.anchor, 'click', { placement: 'popover' }, 'Projekt · 4 connections');
  const d = theDialog();
  const h = d.querySelector('header')!;
  assert.ok(h, 'a header');
  const lines = ([...h.querySelectorAll('*')] as HTMLElement[]).filter((e) => text(e) === 'Projekt · 4 connections');
  assert.ok(lines.length >= 1, 'the header holds the line `Projekt · 4 connections`');
  const all = text(h);
  assert.ok(all.indexOf('Projekt Alfa') < all.lastIndexOf('Projekt · 4 connections'), 'after the title, under the type name');
  assert.ok(desc(d).includes('Projekt · 4 connections'), `the dialog's description includes it: ${desc(d)}`);
});

test('fr_lnk_10_ac16_without_an_extra_line_the_header_has_no_empty_element', async () => {
  await installIpc();
  const p = await mountProvider();
  await show(p.api(), note(P.alfa), p.anchor, 'click');
  const h = theDialog().querySelector('header');
  assert.ok(h, 'a header');
  const empty = ([...h!.querySelectorAll('*')] as HTMLElement[]).filter((e) => e.children.length === 0 && text(e) === '' && !e.closest('svg') && !e.hasAttribute('data-icon') && e.tagName !== 'IMG');
  assert.deepEqual(empty.map((e) => e.outerHTML), [], 'no empty element for the missing line');
  assert.ok(!text(h).includes('connections'));
});

test('fr_lnk_10_ac16_the_column_host_renders_the_same_component_in_place', async () => {
  await installIpc();
  const p = await mountProvider();
  await show(p.api(), note(P.alfa), p.anchor, 'click', { placement: 'column', container: p.column }, 'Projekt · 4 connections');
  const inCol = p.column.querySelector('[data-preview-path]') as HTMLElement | null;
  assert.ok(inCol, 'the preview is rendered inside the given container (§7)');
  assert.equal(nfc(inCol!.getAttribute('data-preview-path') ?? ''), P.alfa);
  assert.equal(text(inCol!.querySelector('header h2')), 'Projekt Alfa', 'the same header');
  assert.ok(text(inCol!).includes('Projekt · 4 connections'), 'with the extra line');
  assert.ok(byRole(inCol!, 'region', 'Preview properties').length === 1, 'the same strip');
  assert.equal(inCol!.querySelector('[data-preview-resize]'), null, 'no resize handle in the column');
  assert.equal(document.querySelectorAll('[data-preview-path]').length, 1, 'and no popover besides it');
});

test('fr_lnk_10_ac16_every_surface_uses_the_one_preview_implementation', async () => {
  // One implementation (FR-LNK-10 AC-16, contract §3.2, §11.4): the editor, panel and list surfaces reach the preview
  // through preview/ (useReference / usePreview), and only preview/ renders the popover.
  const src = join(REPO, 'app/ui/src');
  assert.ok(existsSync(join(src, 'preview/PreviewPopover.tsx')), 'preview/PreviewPopover.tsx exists (§3.3)');
  const read = (rel: string) => readFileSync(join(src, rel), 'utf8');
  const usesPreview = (s: string) => /from\s+['"][./]*preview\/(useReference|PreviewProvider)(\.tsx?)?['"]/.test(s);
  const panel = ['links/BacklinksPanel.tsx'];
  const lists = ['pages/SearchPage.tsx', 'pages/TypePage.tsx', 'tags/TagPage.tsx', 'tags/AllTagsPage.tsx', 'links/DuplicateTitlesPage.tsx', 'daily/ContextSections.tsx', 'inbox/InboxPage.tsx', 'tasks/TaskCard.tsx'];
  const chips = ['links/ChipParts.tsx', 'embeds/Embed.tsx'];
  const missing = [...panel, ...lists, ...chips].filter((f) => !existsSync(join(src, f)) || !usesPreview(read(f)));
  assert.deepEqual(missing, [], 'these R104 surfaces use preview/useReference (or usePreview)');
  const files: string[] = [];
  const walk = (d: string) => { for (const n of readdirSync(d)) { const p = join(d, n); if (statSync(p).isDirectory()) walk(p); else if (/\.tsx?$/.test(n)) files.push(relative(src, p)); } };
  walk(src);
  const editorHosts = files.filter((f) => /createEditor\(/.test(read(f)));
  assert.ok(editorHosts.length > 0, 'the app creates editors');
  assert.ok(editorHosts.some((f) => /preview\/(input|PreviewProvider|useReference)/.test(read(f)) || /resolveRefInput|usePreview/.test(read(f))) ||
    files.filter((f) => /onLink\s*[:(]/.test(read(f))).some((f) => /resolveRefInput|usePreview/.test(read(f))), 'the editor\'s onLink goes through the preview module');
  const popovers = files.filter((f) => !f.startsWith('preview/') && /data-preview-path/.test(read(f)));
  assert.deepEqual(popovers, [], 'no popover outside preview/ (one implementation)');
});
