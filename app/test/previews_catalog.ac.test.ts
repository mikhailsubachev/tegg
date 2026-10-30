// v1.0 slice P (object previews), L1: the strings, registry and commands of docs/acceptance/previews.md R106, R107
// (docs/contracts/v1-previews.md §6). NFR-OTH-02 AC-11 (L1: exactly the R107 keys with their English texts, the commands'
// titles are these keys, `preview.tag.count` has plural forms, D-133: the Czech test catalog shows 1, 3, 5; the
// pseudo-locale wraps each), FR-UX-03 AC-19 (L1 for the registry: `settings/previews` built with the purpose text of
// D-944; the R106 palette commands with their ids, titles, section, ⌥Space the only new shortcut, `needsVault`; no
// shortcut conflicts, FR-UX-03 AC-7; `Show preview`, `Edit link`, `Remove link` don't fail without a reference),
// FR-SET-07 AC-5 (L1: every text of the section is an R107 key, pseudo-locale). The pairs are read from the approved
// criteria. Written from the ACs and the contract only (D-61). Modules load inside the tests (TS-I1).
import { beforeEach, test } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { R4, RESERVED, expandReqs } from './shell-tables';

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

const REPO = resolve(import.meta.dirname, '../..');
/** R107's `key` `text` pairs, read from the approved criteria (the `Reused:` keys have no text there). */
function r107(): [string, string][] {
  const md = readFileSync(resolve(REPO, 'docs/acceptance/previews.md'), 'utf8');
  const line = md.split('\n').find((l) => l.startsWith('`preview.name`'));
  assert.ok(line, 'the R107 line in docs/acceptance/previews.md');
  return [...line!.matchAll(/`([a-z][A-Za-z.]*)` `([^`]+)`/g)].map((m) => [m[1], m[2]]);
}
const PLURAL = 'preview.tag.count';

const T = (key: string, name: string, plural: string, system = true) => ({ key, name, plural, folder: plural, icon: 'file-text', color: 'gray', system, invalid: false });
const TYPES = [T('page', 'Page', 'Pages'), T('task', 'Task', 'Tasks'), T('quick-note', 'Quick Note', 'Quick Notes'), T('daily-note', 'Daily Note', 'Daily Notes'),
  T('tag', 'Tag', 'Tags'), T('image', 'Image', 'Images'), T('pdf', 'PDF', 'PDFs'), T('osoba', 'Osoba', 'Osoby', false), T('projekt', 'Projekt', 'Projekty', false)];
const CTX = { vault: { name: 'Náhledy', path: '/tmp/Náhledy', placeholders: 0 }, types: TYPES, counts: { page: 12, osoba: 2, projekt: 1, task: 1 } };
const ON_NOTE = { ...CTX, route: { id: 'note/<path>', path: 'Pages/Odkazy.md', type: 'page' } };
const ON_INBOX = { ...CTX, route: { id: 'inbox' } };
const ON_SETTINGS = { ...CTX, route: { id: 'settings/previews' } };
type Cmd = { id: string; title: string; section?: string; shortcut?: string | null; due?: unknown; needsVault?: boolean; run?: (c: unknown) => unknown };

/** R106 R4 (contract §6): id, title key, English title, shortcut (null: none of its own). */
const R106: [string, string, string, string | null][] = [
  ['preview.show', 'cmd.preview.show', 'Show preview', '⌥Space'],
  ['preview.mode.click', 'cmd.preview.mode.click', 'Object preview: Click to preview', null],
  ['preview.mode.hover', 'cmd.preview.mode.hover', 'Object preview: Hover to preview', null],
  ['preview.mode.off', 'cmd.preview.mode.off', 'Object preview: Off', null],
  ['link.edit', 'cmd.link.edit', 'Edit link', '⇧⌘K'],
  ['link.remove', 'linkField.remove', 'Remove link', null],
];

// ------------------------------------------------------------------------------------------------ NFR-OTH-02 AC-11

test('nfr_oth_02_ac11_r107_keys_with_their_exact_english_texts', async () => {
  const { cat } = await mods();
  const list = r107();
  assert.equal(list.length, 38, `R107 has ${list.length} keys with a text`); // 37 + preview.resizeHint (D-945)
  const en = cat.en as Record<string, unknown>;
  const bad: string[] = [];
  for (const [key, want0] of list) {
    if (!(key in en)) { bad.push(`${key}: missing`); continue; }
    if (key === PLURAL) continue;
    const vars: Record<string, string> = {};
    for (const m of want0.matchAll(/\{(\w+)\}/g)) vars[m[1]] = `«${m[1]}»`;
    const want = want0.replace(/\{(\w+)\}/g, (_, k: string) => vars[k]);
    const got = cat.t(key, vars);
    if (got !== want) bad.push(`${key}: want ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
  }
  assert.deepEqual(bad, [], 'every R107 key with its English text');
  assert.equal(cat.t('preview.name', { title: 'Rozpočet 2027' }), 'Preview: Rozpočet 2027');
  assert.equal(cat.t('preview.back', { title: 'Rozpočet 2027' }), 'Back to Rozpočet 2027');
  assert.equal(cat.t('settings.preview.delayValue', { ms: 400 }), '400 ms');
});

test('nfr_oth_02_ac11_reused_keys_and_the_previews_purpose_text', async () => {
  const { cat } = await mods();
  const en = cat.en as Record<string, unknown>;
  assert.equal(cat.t('purpose.settings.previews'), 'How links and embeds show a preview.', 'the purpose text of settings/previews (D-944)');
  const reused: [string, Record<string, string>, string][] = [
    ['embed.empty', {}, 'Empty note'],
    ['embed.noDay', {}, 'No note for this day yet.'],
    ['embed.noHeading', { heading: 'Neexistující nadpis', title: 'Rozpočet 2027' }, 'No heading "Neexistující nadpis" in Rozpočet 2027.'],
    ['embed.noBlock', { id: 'otazka9', title: 'Rozpočet 2027' }, 'No block "^otazka9" in Rozpočet 2027.'],
    ['linkField.remove', {}, 'Remove link'],
    ['settings.previews', {}, 'Previews'],
  ];
  const bad = reused.filter(([k, v, w]) => !(k in en) || cat.t(k, v) !== w).map(([k, v, w]) => `${k}: want ${w}, got ${k in en ? cat.t(k, v) : 'missing'}`);
  assert.deepEqual(bad, [], 'the reused keys keep their texts');
  assert.ok('link.noNote' in en, 'link.noNote is reused');
});

test('nfr_oth_02_ac11_tag_count_has_plural_forms', async () => {
  const { cat } = await mods();
  const en = cat.en as Record<string, unknown>;
  assert.ok(PLURAL in en, `catalog key ${PLURAL}`);
  assert.equal(typeof en[PLURAL], 'object', `${PLURAL} is a plural message (D-133)`);
  // The placeholder is `{n}` in R107; the count is passed as `n` and `count` (the catalog picks the form by `count`).
  const v = (n: number) => ({ n, count: n });
  assert.equal(cat.t(PLURAL, v(2)), '2 objects', 'FR-LNK-10 AC-10: `2 objects`');
  assert.equal(cat.t(PLURAL, v(1)), '1 object', 'the `one` form: `1 object`');
  assert.equal(cat.t(PLURAL, v(0)), '0 objects');
  cat.setCatalog({ ...(cat.en as object), [PLURAL]: { one: '{n} objekt', few: '{n} objekty', other: '{n} objektů' } }, 'cs');
  assert.deepEqual([1, 3, 5].map((n) => cat.t(PLURAL, v(n))), ['1 objekt', '3 objekty', '5 objektů'], 'the Czech test catalog picks one / few / other');
});

test('nfr_oth_02_ac11_pseudo_locale_wraps_every_r107_text', async () => {
  const { cat } = await mods();
  const pseudo = cat.pseudo?.(cat.en) as Record<string, unknown> | undefined;
  assert.ok(pseudo, 'the pseudo-locale exists');
  const bad: string[] = [];
  for (const [k] of r107()) {
    const m = pseudo![k];
    const texts = m === undefined ? [] : typeof m === 'string' ? [m] : Object.values(m as Record<string, string>);
    if (texts.length === 0 || !texts.every((s) => /^⟦.*⟧$/s.test(s))) bad.push(k);
  }
  assert.deepEqual(bad, [], 'every R107 key is wrapped by the pseudo-locale');
  // One key per string: no other key carries a text only slice P introduces.
  const en = cat.en as Record<string, unknown>;
  const own = ['Close preview', 'Resize preview', 'Preview properties', 'This object was moved or deleted.', "Couldn't read this note.", 'Off: click opens', 'Used with Hover to preview.'];
  const keys = new Set(r107().map(([k]) => k));
  const stray = Object.entries(en).filter(([k, v]) => !keys.has(k) && typeof v === 'string' && own.includes(v)).map(([k]) => k);
  assert.deepEqual(stray, [], 'no second key carries a slice P string');
});

test('nfr_oth_02_ac11_command_titles_are_the_r107_keys', async () => {
  const { cat, cmd } = await mods();
  const list = cmd.commands(ON_NOTE) as Cmd[];
  const bad: string[] = [];
  for (const [id, key, text] of R106) {
    const c = list.find((x) => x.id === id);
    if (!c) { bad.push(`${id}: not registered`); continue; }
    if (c.title !== key) bad.push(`${id}: title key ${c.title} ≠ ${key}`);
    if (cat.t(c.title) !== text) bad.push(`${id}: ${JSON.stringify(cat.t(c.title))} ≠ ${JSON.stringify(text)}`);
  }
  assert.deepEqual(bad, [], 'R106 commands carry the R107 title keys');
});

// ------------------------------------------------------------------------------------------------ FR-UX-03 AC-19

test('fr_ux_03_ac19_settings_previews_is_built_with_its_purpose', async () => {
  const { reg, cat, cmd } = await mods();
  const r = (reg.ROUTES as any[]).find((x) => x.id === 'settings/previews');
  assert.ok(r, 'route settings/previews');
  assert.equal(r.status.built, true, 'settings/previews is built (R106 R1)');
  assert.equal(r.status.due ?? null, null, 'no `Coming in` milestone');
  assert.deepEqual(expandReqs(r.reqs), ['FR-SET-07'], 'FR-SET-07');
  assert.equal(cat.t(r.purpose), 'How links and embeds show a preview.', 'purpose text (D-944)');
  const ms = (reg.overdue('v1.0') as string[]).join('\n');
  assert.ok(!/settings\/previews/.test(ms), `overdue('v1.0') doesn't list settings/previews:\n${ms}`);
  const go = (cmd.commands(ON_INBOX) as Cmd[]).find((c) => cat.t(c.title) === 'Go to Settings: Previews');
  assert.ok(go, 'Go to Settings: Previews exists');
  assert.equal(go!.due ?? null, null, 'and runs');
});

test('fr_ux_03_ac19_preview_commands_ids_titles_section_and_shortcuts', async () => {
  const { cat, cmd } = await mods();
  const bad: string[] = [];
  for (const [label, ctx] of [['note', ON_NOTE], ['inbox', ON_INBOX], ['settings/previews', ON_SETTINGS]] as const) {
    const list = cmd.commands(ctx) as Cmd[];
    for (const [id, key, text, sc] of R106) {
      const c = list.find((x) => x.id === id);
      if (!c) { bad.push(`${label}: ${id} not registered`); continue; }
      if (cat.t(c.title) !== text) bad.push(`${label}: ${id} title ${cat.t(c.title)} ≠ ${text}`);
      if (c.title !== key) bad.push(`${label}: ${id} title key ${c.title}`);
      if (c.needsVault !== true) bad.push(`${label}: ${id} needsVault ${String(c.needsVault)}`);
      if ((c.due ?? null) !== null) bad.push(`${label}: ${id} is TBD`);
      if (id === 'preview.show') {
        if (c.shortcut !== '⌥Space') bad.push(`${label}: preview.show shortcut ${c.shortcut}`);
        if (c.section !== 'navigate') bad.push(`${label}: preview.show section ${c.section}`);
      } else if (sc === null && (c.shortcut ?? null) !== null) bad.push(`${label}: ${id} has the shortcut ${c.shortcut} (none)`);
      else if (id === 'link.edit' && ![undefined, null, '⇧⌘K'].includes(c.shortcut as any)) bad.push(`${label}: link.edit shortcut ${c.shortcut} (⇧⌘K at a chip, FR-LNK-13 AC-6)`);
    }
  }
  assert.deepEqual(bad, [], 'the R106 commands on every route with a vault');
});

test('fr_ux_03_ac19_alt_space_is_the_only_new_shortcut_and_nothing_conflicts', async () => {
  const { reg, cat, cmd } = await mods();
  const shortcuts = reg.SHORTCUTS as { keys: string; command: string }[];
  assert.deepEqual(shortcuts.map((s) => s.keys).sort(), [...R4.map((r) => r.keys), '⌥Space', '⇧⌘G'].sort(), 'R4 plus ⌥Space and slice G1\'s ⇧⌘G (D-918), nothing else');
  assert.equal(shortcuts.find((s) => s.keys === '⌥Space')?.command, 'preview.show', '⌥Space → preview.show');
  assert.equal(shortcuts.find((s) => s.keys === '⇧⌘K')?.command, 'edit.link', '⇧⌘K stays Insert link in R4 (at a chip it opens Edit link)');
  assert.ok(!RESERVED.includes('⌥Space'), '⌥Space isn\'t macOS-reserved (⌘Space is)');
  const list = cmd.commands(ON_NOTE) as Cmd[];
  assert.ok(list.some((c) => c.id === 'preview.show'), 'preview.show is registered');
  const ids = list.map((c) => c.id);
  assert.deepEqual(ids.filter((id, i) => ids.indexOf(id) !== i), [], 'command ids are unique');
  const enabled = list.filter((c) => !c.due && c.shortcut);
  const owners = new Map<string, string[]>();
  for (const c of enabled) owners.set(c.shortcut!, [...(owners.get(c.shortcut!) ?? []), c.id]);
  const clashes = [...owners].filter(([k, v]) => v.length > 1 && !(k === '⇧⌘K' && v.every((x) => x === 'edit.link' || x === 'link.edit')));
  assert.deepEqual(clashes, [], 'no two enabled commands share a shortcut (FR-UX-03 AC-7)');
  for (const c of list) assert.ok(!RESERVED.includes(c.shortcut as string), `${c.id} uses the reserved ${c.shortcut}`);
  const notKeys = list.filter((c) => !(c.title in cat.en)).map((c) => `${c.id}: ${c.title}`);
  assert.deepEqual(notKeys, [], 'every command title is a catalog key');
});

test('fr_ux_03_ac19_show_preview_edit_and_remove_link_without_a_reference_do_nothing', async () => {
  const { cmd } = await mods();
  const calls: string[] = [];
  const actions = new Proxy({}, { get: (_t, p) => (..._a: unknown[]) => { calls.push(String(p)); } });
  for (const ctx of [ON_INBOX, ON_NOTE]) {
    const list = cmd.commands({ ...ctx, actions }) as Cmd[];
    for (const id of ['preview.show', 'link.edit', 'link.remove']) {
      const c = list.find((x) => x.id === id);
      assert.ok(c, `${id} is registered on ${(ctx.route as any).id}`);
      let error: unknown = null;
      try { await c!.run?.({ ...ctx, actions }); } catch (e) { error = e; }
      assert.equal(error, null, `${id} without a reference or a chip at the caret shows no error`);
    }
  }
});

// ------------------------------------------------------------------------------------------------ FR-SET-07 AC-5

test('fr_set_07_ac5_settings_section_texts_are_r107_keys', async () => {
  const { cat } = await mods();
  const keys = ['settings.previews', 'settings.preview.mode', 'settings.preview.click', 'settings.preview.hover', 'settings.preview.off',
    'settings.preview.delay', 'settings.preview.delayValue', 'settings.preview.delayNote'];
  const en = cat.en as Record<string, unknown>;
  assert.deepEqual(keys.filter((k) => !(k in en)), [], 'the section\'s catalog keys');
  const pseudo = cat.pseudo(cat.en) as Record<string, string>;
  cat.setCatalog(pseudo, 'en-XA');
  const shown = keys.map((k) => cat.t(k, { ms: 400 }));
  assert.deepEqual(shown.filter((s) => !/^⟦.*⟧$/s.test(s)), [], 'every text of the section is wrapped in the pseudo-locale');
  // The settings page uses the keys (no literal text): its source names each of them.
  const src = readFileSync(resolve(REPO, 'app/ui/src/pages/SettingsPage.tsx'), 'utf8');
  assert.deepEqual(keys.slice(1).filter((k) => !src.includes(`'${k}'`) && !src.includes(`"${k}"`)), [], 'pages/SettingsPage.tsx names every settings.preview.* key');
  for (const lit of ['Hover delay', 'Off: click opens', 'Used with Hover to preview.', 'Object preview']) {
    assert.ok(!src.includes(`'${lit}'`) && !src.includes(`"${lit}"`) && !src.includes(`>${lit}<`), `no literal "${lit}" in SettingsPage.tsx`);
  }
});
