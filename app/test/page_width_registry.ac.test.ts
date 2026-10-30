// Slice PW (page width, Normal / Wide), L1: docs/acceptance/page-width.md FR-UX-03 AC-17 (the two palette commands in
// the registry: section `view`, no shortcut, R4 unchanged, registry integrity), NFR-OTH-02 AC-9 (the seven catalog keys
// and their English texts; the two commands' titles are these keys), FR-STO-07 AC-4 L1 part (`UiStateDto.noteWidth` is
// an optional record, so a DTO without it reads as empty: no exported default/merge function is public, so the check is
// on the public DTO types: the generated `ipc/types.ts` and the fake core's `UiStateDto`), FR-UX-05 AC-12 L1 part (the
// two icons render with `currentColor` and no colour literal, and the `focus` / `accent` / `hover` tokens the radios
// draw with exist in both themes). Interface: docs/contracts/page-width.md §1, §3; ms3-shell §3.1–§3.3, §3.5.
// Modules load dynamically so a missing module fails an assertion, not the file (TS-I1). Written from the ACs and the
// contracts only (D-61).
import { beforeEach, test } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { R4, R4_P, shortcutClashes } from './shell-tables';

type Mod = Record<string, any>;
async function load(path: string): Promise<Mod | null> {
  try {
    return (await import(/* @vite-ignore */ path)) as Mod;
  } catch {
    return null;
  }
}
async function mods() {
  const reg = await load('../ui/src/shell/registry.ts');
  const cat = await load('../ui/src/i18n/catalog.ts');
  const cmd = await load('../ui/src/shell/commands.ts');
  assert.ok(reg && cat && cmd, 'registry, catalog and commands modules load');
  return { reg: reg!, cat: cat!, cmd: cmd! };
}
beforeEach(async () => {
  const cat = await load('../ui/src/i18n/catalog.ts');
  cat?.setCatalog?.(cat.en, 'en');
});

const T = (key: string, name: string, plural: string, system = true) => ({ key, name, plural, folder: plural, icon: 'file-text', color: 'gray', system, invalid: false });
const TYPES = [T('page', 'Page', 'Pages'), T('task', 'Task', 'Tasks'), T('quick-note', 'Quick Note', 'Quick Notes'), T('daily-note', 'Daily Note', 'Daily Notes'), T('schůzka', 'Schůzka', 'Schůzky', false)];
const CTX = { vault: { name: 'Trezor', path: '/tmp/Trezor', placeholders: 0 }, types: TYPES, counts: { page: 2, 'quick-note': 2, task: 1, 'schůzka': 1 } };
const ON_NOTE = { ...CTX, route: { id: 'note/<path>', path: 'Schůzky/2026-10-07 Porada.md' } };
const ON_DAILY = { ...CTX, route: { id: 'daily/YYYY-MM-DD', param: '2026-10-27', date: '2026-10-27' } };
const ON_NEW = { ...CTX, route: { id: 'new/<type>', param: 'quick-note', type: 'quick-note' } };

type Cmd = { id: string; title: string; section?: string; shortcut?: string; due?: unknown; needsVault?: boolean };

/** The contract's catalog keys with their English texts (page-width.md NFR-OTH-02 AC-9; contract §3). */
const KEYS: [string, string][] = [
  ['note.width', 'Page width'],
  ['note.width.normal', 'Normal'],
  ['note.width.wide', 'Wide'],
  ['cmd.width.normal', 'Page width: Normal'],
  ['cmd.width.wide', 'Page width: Wide'],
  ['settings.vault.pageWidth', 'Page width'],
  ['settings.vault.pageWidthNote', 'For notes without their own choice.'],
];

// ------------------------------------------------------------------------------------------------ FR-UX-03 AC-17

test('fr_ux_03_ac17_width_commands_are_registered_in_view_without_a_shortcut', async () => {
  const { reg, cat, cmd } = await mods();
  const want: [string, string, string][] = [
    ['note.width.normal', 'cmd.width.normal', 'Page width: Normal'],
    ['note.width.wide', 'cmd.width.wide', 'Page width: Wide'],
  ];
  const bad: string[] = [];
  for (const [label, ctx] of [['note/<path>', ON_NOTE], ['daily/<date>', ON_DAILY], ['new/<type>', ON_NEW]] as const) {
    const list = cmd.commands(ctx) as Cmd[];
    for (const [id, key, text] of want) {
      const c = list.find((x) => x.id === id);
      if (!c) { bad.push(`${label}: ${id} is not registered (contract §3)`); continue; }
      if (c.title !== key) bad.push(`${label}: ${id} title ${JSON.stringify(c.title)} ≠ ${key}`);
      if (cat.t(c.title) !== text) bad.push(`${label}: ${id} text ${JSON.stringify(cat.t(c.title))} ≠ ${JSON.stringify(text)}`);
      if (c.section !== 'view') bad.push(`${label}: ${id} section ${JSON.stringify(c.section)} ≠ view`);
      if ((c.shortcut ?? null) !== null) bad.push(`${label}: ${id} has the shortcut ${c.shortcut} (none)`);
      if ((c.due ?? null) !== null) bad.push(`${label}: ${id} is TBD (${JSON.stringify(c.due)}), it is built`);
    }
    const titles = list.map((c) => cat.t(c.title));
    if (titles.filter((t) => /^Page width: /.test(t)).length !== 2) bad.push(`${label}: ${titles.filter((t) => /^Page width/.test(t)).length} "Page width: …" commands, want exactly 2`);
  }
  assert.deepEqual(bad, [], 'the two width commands on the note, daily and new routes');
  // R4 is unchanged: the shortcut table has no row for the width commands and still equals R4.
  const shortcuts = reg.SHORTCUTS as { keys: string; command: string }[];
  assert.deepEqual(shortcuts.filter((s) => /^note\.width\./.test(s.command)), [], 'no R4 row for a width command');
  // Slice P (previews.md R106, D-943): R4 gained ⌥Space only; the width commands still add nothing.
  assert.deepEqual(shortcuts.map((s) => s.keys).sort(), [...R4, ...R4_P].map((r) => r.keys).sort(), 'R4 unchanged');
});

test('fr_ux_03_ac17_registry_integrity_holds_with_the_width_commands', async () => {
  const { cat, cmd } = await mods();
  const list = cmd.commands(ON_NOTE) as Cmd[];
  assert.ok(list.some((c) => c.id === 'note.width.wide'), 'note.width.wide is registered on note/<path>');
  const ids = list.map((c) => c.id);
  assert.deepEqual(ids.filter((id, i) => ids.indexOf(id) !== i), [], 'duplicate command ids');
  // D-943 (previews.md R106): `link.edit` shows R4's ⇧⌘K beside `edit.link`; that pair is the only one exempt.
  assert.deepEqual(shortcutClashes(list), [], 'two enabled commands share a shortcut');
  const notKeys = list.filter((c) => !(c.title in cat.en)).map((c) => `${c.id}: ${c.title}`);
  assert.deepEqual(notKeys, [], 'every command title is a catalog key (FR-UX-03 AC-7)');
});

// ------------------------------------------------------------------------------------------------ NFR-OTH-02 AC-9

test('nfr_oth_02_ac9_catalog_has_the_width_keys_with_their_texts', async () => {
  const { cat } = await mods();
  const en = cat.en as Record<string, string>;
  const bad = KEYS.filter(([k, v]) => en[k] !== v).map(([k, v]) => `${k}: ${JSON.stringify(en[k])} ≠ ${JSON.stringify(v)}`);
  assert.deepEqual(bad, [], 'every key of page-width.md NFR-OTH-02 AC-9 with its English text');
  const pseudo = cat.pseudo?.(cat.en) as Record<string, string> | undefined;
  assert.ok(pseudo, 'the pseudo-locale exists');
  for (const [k] of KEYS) assert.match(pseudo![k] ?? '', /^⟦.*⟧$/s, `${k} is wrapped by the pseudo-locale`);
  // One key per string: no second key carries a text that only this slice introduces.
  const own = ['Page width: Normal', 'Page width: Wide', 'For notes without their own choice.'];
  const stray = Object.entries(en).filter(([k, v]) => !KEYS.some(([rk]) => rk === k) && own.includes(v as string));
  assert.deepEqual(stray, [], 'no second key carries a width string');
});

// ------------------------------------------------------------------------------------------------ FR-STO-07 AC-4 (L1)

test('fr_sto_07_ac4_ui_state_dto_has_an_optional_note_width_record', async () => {
  // No exported default/merge function for the UI state is public (ms3-shell §3; contract §1 names none), so the L1
  // check is on the public DTO types: a missing `noteWidth` must be representable, i.e. the field is optional.
  const types = readFileSync(resolve(import.meta.dirname, '../ui/src/ipc/types.ts'), 'utf8');
  const m = /export type UiStateDto = \{([\s\S]*?)\};/m.exec(types); // ts-rs ends the type with `, };` on the last field's line
  assert.ok(m, 'ipc/types.ts declares UiStateDto');
  const body = m![1];
  const field = /noteWidth\?\s*:\s*([^;]+);/.exec(body);
  assert.ok(field, `UiStateDto has an optional field noteWidth (contract §1); fields: ${body.replace(/\/\*\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ').trim()}`);
  assert.match(field![1], /string/, `noteWidth maps strings (ids or NFC paths) to 'normal' | 'wide'; got ${field![1].trim()}`);
  const fake = readFileSync(resolve(import.meta.dirname, '../ui/test/fake-core.ts'), 'utf8');
  const fm = /export type UiStateDto = \{([\s\S]*?)\n\};/m.exec(fake);
  assert.ok(fm, 'the fake core declares UiStateDto');
  assert.match(fm![1], /noteWidth\?\s*:\s*Record<string,\s*'normal'\s*\|\s*'wide'>/, "the fake core's UiStateDto has noteWidth?: Record<string, 'normal' | 'wide'>");
});

// ------------------------------------------------------------------------------------------------ FR-UX-05 AC-12 (L1)

test('fr_ux_05_ac12_width_icons_use_current_color_and_the_radio_tokens_exist', async () => {
  const tok = await load('../ui/src/theme/tokens.ts');
  assert.ok(tok, 'theme/tokens.ts is missing');
  for (const name of ['light', 'dark'] as const) {
    const t = (tok![name] ?? {}) as Record<string, string>;
    for (const k of ['focus', 'accent', 'hover', 'row', 'text', 'bg']) assert.ok(k in t, `${name}: token ${k} (the radios' outline, checked state and text)`);
  }
  const icon = await load('../ui/src/shell/Icon.tsx');
  const dom = await load('react-dom/server');
  assert.ok(icon && dom, 'shell/Icon.tsx and react-dom/server load');
  // The glyph only: `data-icon` names the icon on every render, the fallback glyph included.
  const render = (name: string) => String(dom!.renderToStaticMarkup(icon!.Icon({ name, size: 16 }))).replace(/\s*data-icon="[^"]*"/g, '');
  const normal = render('width-normal');
  const wide = render('width-wide');
  const unknown = render('no-such-icon-žádná');
  const bad: string[] = [];
  for (const [n, svg] of [['width-normal', normal], ['width-wide', wide]] as const) {
    if (!/<svg[\s>]/.test(svg)) bad.push(`${n}: no <svg> rendered (${svg.slice(0, 80)})`);
    if (svg === unknown) bad.push(`${n}: renders like an unknown icon name (the glyph is missing)`);
    const literals = svg.match(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(|\b(?:black|white|red|blue|gray|grey)\b/gi) ?? [];
    if (literals.length) bad.push(`${n}: colour literals ${JSON.stringify(literals)} (FR-UX-05 AC-2: currentColor only)`);
    if (!/currentColor/.test(svg)) bad.push(`${n}: not drawn with currentColor`);
  }
  if (normal === wide) bad.push('width-normal and width-wide render the same glyph');
  assert.deepEqual(bad, [], 'the two width icons');
});
