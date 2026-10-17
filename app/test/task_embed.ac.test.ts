// @vitest-environment jsdom
// MS5 slice 5A-2, L1: the Task card (D-74, D-497; docs/acceptance/conversion.md R52; docs/contracts/ms5-tasks.md §11.5).
// `taskHeader` (app/ui/src/tasks/header.ts) gives the §2.1 header fields from the file text by the same rules as the
// task query (checked against the fake core's twin, app/ui/test/fake-tasks.ts, over every fixture task); `Embed.tsx`
// renders a card-mode Task embed as the R52 card (FR-CNV-05 AC-1: roles, names, no preview strip, `|full` / `|link`
// keep the 4F frames; R52 read-only at depth 2); and the bytes of the header controls' writes (FR-CNV-05 AC-3, through
// the §5 `applyTaskChange` + `touchModified` path the card uses). Fixture: tests/fixtures/vaults/tasks (read only).
// Written from the ACs and the contract only (D-61). Modules load dynamically; `.tsx` can't be imported statically
// (tsconfig.test.json has no `jsx`). IPC is mocked with `@tauri-apps/api/mocks` (`task_list` from the fake core's twin).
//
// Test clock: 2026-10-14T12:00:00+02:00, Europe/Prague (tasks.md); only `Date` is faked.
process.env.TZ = 'Europe/Prague';
import { afterEach, beforeEach, test, vi } from 'vitest';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { createElement } from 'react';
import { cleanup, render } from '@testing-library/react';
import { clearMocks, mockIPC } from '@tauri-apps/api/mocks';
import { parse } from '@tegg/doc';
import { computeAccessibleDescription, computeAccessibleName } from 'dom-accessibility-api';
import { catalog, need } from './read-helpers';
import { TYPES } from './embeds-helpers';

const REPO = resolve(import.meta.dirname, '../..');
const NOW = '2026-10-14T12:00:00+02:00';
const T01 = 'Tasks/Zavolat Janě.md';
const nfc = (s: string) => s.normalize('NFC');
const name = (e: Element) => nfc(computeAccessibleName(e).trim());
const desc = (e: Element) => nfc(computeAccessibleDescription(e).trim());
const text = (e: Element | null) => nfc(e?.textContent ?? '');

/** The tasks fixture plus new-empty/.tegg as one in-memory vault (vault-relative NFC path → text). */
function vaultFiles(): Record<string, string> {
  const files: Record<string, string> = {};
  const walk = (root: string, prefix: string) => {
    const go = (d: string) => {
      for (const n of readdirSync(d)) {
        const p = join(d, n);
        if (statSync(p).isDirectory()) go(p);
        else if (n !== 'README.md') files[nfc(prefix + relative(root, p))] = readFileSync(p, 'utf8');
      }
    };
    go(root);
  };
  walk(resolve(REPO, 'tests/fixtures/vaults/tasks'), '');
  walk(resolve(REPO, 'tests/fixtures/vaults/new-empty/.tegg'), '.tegg/');
  return files;
}

async function fake() {
  return need('../ui/test/fake-tasks.ts', 'taskList');
}
async function header() {
  return need('../ui/src/tasks/header.ts', 'taskHeader');
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'], now: new Date(NOW) });
  await catalog().catch(() => {});
  const icons = await need('../ui/src/links/icons.ts', 'setChipTypes');
  icons.setChipTypes(TYPES());
});
afterEach(() => {
  cleanup();
  clearMocks();
  vi.useRealTimers();
});

// ------------------------------------------------------------------------------------------------ taskHeader

test('fr_cnv_05_ac1_task_header_of_t01', async () => {
  const files = vaultFiles();
  const { defs } = (await fake()).taskList(files);
  const h = (await header()).taskHeader(files[nfc(T01)], defs);
  assert.deepEqual(h, {
    title: 'Zavolat Janě', status: 'To do', state: 'open', statusKnown: true, priority: 'High', dueRaw: '2026-10-09', due: '2026-10-09', completed: null,
  });
});

test('fr_cnv_05_ac1_task_header_follows_the_task_query_rules_for_every_fixture_task', async () => {
  const files = vaultFiles();
  const { tasks, defs } = (await fake()).taskList(files);
  assert.equal(tasks.length, 19, 'fixture guard: T01…T19');
  const { taskHeader } = await header();
  const pick = (r: any) => ({ title: nfc(r.title), status: r.status, state: r.state, statusKnown: r.statusKnown, priority: r.priority, dueRaw: r.dueRaw, due: r.due, completed: r.completed });
  const bad: string[] = [];
  for (const r of tasks) {
    const h = taskHeader(files[nfc(r.path)], defs);
    const got = JSON.stringify({ ...pick(h), title: nfc(h.title) });
    const want = JSON.stringify(pick(r));
    if (got !== want) bad.push(`${r.path}\n  want ${want}\n  got  ${got}`);
  }
  assert.deepEqual(bad, [], 'taskHeader equals the task row fields (R44, D-471, D-484)');
});

// ------------------------------------------------------------------------------------------------ the card

function taskNode(mode: 'card' | 'full' | 'link', depth = 1, value = 'Zavolat Janě') {
  const files = vaultFiles();
  const t = files[nfc(T01)];
  return {
    value, line: 15, inline: false, depth, mode, state: 'ok',
    target: { target: 'Zavolat Janě', kind: 'note', path: T01, title: 'Zavolat Janě', type: 'task' },
    subpath: null,
    note: { path: T01, state: 'ok', text: t, version: { mtimeNs: '1', size: t.length, hash: 'ab' }, utf8: true, links: [] },
    section: { kind: 'whole', from: parse(t).bodyStart, to: t.length },
    readOnly: false, children: [],
  };
}
async function show(n: Record<string, unknown>, editable: boolean) {
  const files = vaultFiles();
  const { taskList } = await fake();
  const calls: string[] = [];
  mockIPC((cmd) => {
    calls.push(cmd);
    if (cmd === 'task_list') return taskList(files);
    return null;
  });
  const { Embed } = await need('../ui/src/embeds/Embed.tsx', 'Embed');
  let error: unknown = null;
  let r: ReturnType<typeof render> | null = null;
  try {
    r = render(createElement(Embed, { node: n, host: 'Pages/Porada.md', editable, onOpen: () => {}, onMode: () => {}, onEnter: () => {}, onCreate: () => {} }));
  } catch (e) { error = e; }
  assert.equal(error, null, `Embed threw: ${String(error)}`);
  return { container: r!.container, calls };
}
async function until(f: () => boolean, ms = 2000) {
  const t0 = performance.now();
  while (!f() && performance.now() - t0 < ms) await new Promise((r) => setTimeout(r, 20));
}
const controls = (c: Element) => [...c.querySelectorAll('button, [role="button"], [role="checkbox"], input[type="checkbox"]')] as HTMLElement[];
const control = (c: Element, n: string) => controls(c).find((b) => name(b) === n) ?? null;

test('fr_cnv_05_ac1_card_mode_task_embed_is_the_d74_card', async () => {
  const { container } = await show(taskNode('card'), true);
  await until(() => container.querySelector('[data-task-card]') !== null && control(container, 'Status: To do') !== null);
  const card = container.querySelector('[data-task-card]') as HTMLElement | null;
  assert.ok(card, 'a frame with data-task-card (R52)');
  assert.equal(card!.getAttribute('data-embed-mode'), 'card', 'the 4F frame in card mode');
  const box = control(card!, 'Complete "Zavolat Janě"');
  assert.ok(box, 'the R43 checkbox Complete "Zavolat Janě"');
  assert.ok(box!.getAttribute('aria-checked') === 'false' || (box as HTMLInputElement).checked === false, 'unchecked');
  for (const [n, menu] of [['Status: To do', true], ['Priority: High', true], ['Open Zavolat Janě', false], ['Display as', false]] as const) {
    const b = control(card!, n);
    assert.ok(b, `button ${n}`);
    if (menu) assert.equal(b!.getAttribute('aria-haspopup'), 'menu', `${n} opens a menu`);
  }
  const due = controls(card!).find((b) => name(b).startsWith('Due: '));
  assert.ok(due, 'a Due: … button');
  assert.ok(name(due!).includes('5 days overdue'), `Due label with the overdue count: ${name(due!)}`);
  const hook = card!.querySelector('[data-due="2026-10-09"]');
  assert.equal(hook?.getAttribute('data-tone'), 'overdue', 'the overdue highlight (D-509 hooks)');
  assert.equal(card!.querySelector('[data-status]')?.getAttribute('data-status'), 'To do', 'data-status');
  assert.equal(card!.querySelector('[data-priority]')?.getAttribute('data-priority'), 'High', 'data-priority');
  const title = [...card!.querySelectorAll('*')].find((e) => e.children.length === 0 && text(e).trim() === 'Zavolat Janě');
  assert.ok(title, 'the title text');
  assert.equal(title!.closest('[contenteditable="true"], input, textarea, [role="textbox"]'), null, 'the title isn’t editable (AP-427)');
  assert.ok(text(card).includes('Domluvit schůzku na příští týden.'), 'the body below the header');
  const strip = ([...card!.querySelectorAll('[role="list"], ul, ol')] as HTMLElement[]).find((l) => name(l) === 'Properties');
  assert.equal(strip, undefined, 'no preview strip on a Task card');
});

test('fr_cnv_05_ac1_full_and_link_modes_keep_the_4f_frames', async () => {
  for (const mode of ['full', 'link'] as const) {
    const { container } = await show(taskNode(mode, 1, `Zavolat Janě|${mode}`), true);
    await until(() => container.querySelector('[data-task-card]') !== null, 300);
    assert.equal(container.querySelector('[data-task-card]'), null, `|${mode}: not the Task card`);
    assert.equal(control(container, 'Status: To do'), null, `|${mode}: no Status button`);
    cleanup();
  }
  // Guard: the same node in card mode is the Task card (so the absence above isn't vacuous).
  const { container } = await show(taskNode('card'), true);
  await until(() => container.querySelector('[data-task-card]') !== null);
  assert.ok(container.querySelector('[data-task-card]'), 'card mode renders the Task card');
});

test('fr_cnv_05_ac9_r52_read_only_at_depth_2_and_in_the_read_view', async () => {
  for (const [depth, editable, what] of [[2, true, 'depth 2'], [1, false, 'the read view']] as const) {
    const { container } = await show(taskNode('card', depth), editable);
    await until(() => control(container, 'Status: To do') !== null);
    const card = container.querySelector('[data-task-card]');
    assert.ok(card, `${what}: the Task card`);
    for (const n of ['Complete "Zavolat Janě"', 'Status: To do', 'Priority: High']) {
      const b = control(card!, n);
      assert.ok(b, `${what}: ${n}`);
      assert.equal(b!.getAttribute('aria-disabled'), 'true', `${what}: ${n} aria-disabled`);
      assert.equal(desc(b!), "This task can't be edited here.", `${what}: ${n} says why`);
    }
    const due = controls(card!).find((b) => name(b).startsWith('Due: '));
    assert.equal(due?.getAttribute('aria-disabled'), 'true', `${what}: Due aria-disabled`);
    assert.equal(card!.querySelector('[data-embed-editable="true"]'), null, `${what}: the body isn’t editable`);
    cleanup();
  }
});

// ------------------------------------------------------------------------------------------------ FR-CNV-05 AC-3 bytes

test('fr_cnv_05_ac3_header_control_writes_change_only_their_lines', async () => {
  const d = (await import('@tegg/doc')) as any;
  const t01 = vaultFiles()[nfc(T01)];
  const stamp = `modified: ${NOW}\n`;
  const old = 'modified: 2026-10-01T09:00:00+02:00\n';
  const write = (change: Record<string, unknown>) => {
    const r = d.applyTaskChange(t01, change);
    return r === null ? null : d.touchModified(t01, r.text, NOW);
  };
  const sw = (s: string, a: string, b: string) => { assert.ok(s.includes(a), `fixture holds ${a}`); return s.replace(a, b); };
  assert.equal(write({ kind: 'status', to: 'Waiting', toState: 'open', fromState: 'open', firstOpen: 'To do', now: NOW }), sw(sw(t01, 'status: To do', 'status: Waiting'), old, stamp), 'Status › Waiting: status and modified only');
  assert.equal(write({ kind: 'priority', to: null }), sw(sw(t01, 'priority: High\n', ''), old, stamp), 'Priority › No priority removes the line');
  assert.equal(write({ kind: 'due', to: '2026-10-20' }), sw(sw(t01, 'due: 2026-10-09', 'due: 2026-10-20'), old, stamp), 'Due › 20 Oct (FR-FMT-11)');
  assert.equal(write({ kind: 'due', to: null }), sw(sw(t01, 'due: 2026-10-09\n', ''), old, stamp), 'Due › Clear removes due');
  assert.equal(write({ kind: 'status', to: 'To do', toState: 'open', fromState: 'open', firstOpen: 'To do', now: NOW }), null, 'an equal value writes nothing');
  assert.equal(write({ kind: 'priority', to: 'High' }), null, 'an equal priority writes nothing');
  // The card's header is re-derived from the written text (§11.5: one version per path, `peerWrote`).
  const { defs } = (await fake()).taskList(vaultFiles());
  const { taskHeader } = await header();
  const after = (change: Record<string, unknown>) => taskHeader(write(change)!, defs);
  assert.deepEqual([after({ kind: 'status', to: 'Waiting', toState: 'open', fromState: 'open', firstOpen: 'To do', now: NOW }).status, after({ kind: 'status', to: 'Waiting', toState: 'open', fromState: 'open', firstOpen: 'To do', now: NOW }).state], ['Waiting', 'open'], 'Status: Waiting');
  assert.equal(after({ kind: 'priority', to: null }).priority, null, 'Priority: None');
  assert.deepEqual([after({ kind: 'due', to: '2026-10-20' }).due, after({ kind: 'due', to: '2026-10-20' }).dueRaw], ['2026-10-20', '2026-10-20'], 'Due: 20 Oct (no longer overdue)');
  assert.deepEqual([after({ kind: 'due', to: null }).due, after({ kind: 'due', to: null }).dueRaw], [null, null], 'Due: None');
  const done = d.completeTask(t01, defs, true, NOW);
  assert.ok(done, 'the checkbox writes');
  const hd = taskHeader(d.touchModified(t01, done, NOW), defs);
  assert.deepEqual([hd.status, hd.state, hd.completed], ['Done', 'done', NOW], 'checked: Status: Done, struck through (FR-CNV-05 AC-2)');
});
