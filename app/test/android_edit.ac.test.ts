// @vitest-environment jsdom
// Slice AND-3, L1 and L0 (Vitest, jsdom): docs/acceptance/android-edit.md through docs/contracts/android-edit.md
// §2, §4, §13, §14, §19:
// - FR-UX-03 AC-60 (L1): `PHONE_HIDDEN_COMMANDS` loses exactly the seven ids of §13.2; `phoneCommands` keeps the
//   exceptions (`task.complete`, `edit.undo`, `edit.redo`, `edit.bold`, `edit.italic`, `edit.link` and the phone's own
//   `edit.*`, with their `:` forms) and no longer overrides `object.new`; `PAGE_COMMAND_PREFIXES` gains §13.3's prefixes;
// - AR-03 AC-15 (L0, L1): RA2 group O without `trash_restore` (`ANDROID_EXCLUDED`), the shell's lists in
//   `commands.json` (ANDROID with `trash_restore` after `object_trash`, ANDROID_ONLY with §2.2's four), `READ_COMMANDS`
//   classifies them, `PHONE_NOT_OFFERED` without `new/<type>`, and no phone module imports `@tauri-apps/*`;
// - NFR-OTH-02 AC-27 (L0, L1): §14's keys and texts, the three removed keys, no UI literal in `app/ui/src/phone/`;
// - FR-EDT-01 AC-17 (L1): `contextmenuAllowed` (§4.3); FR-UX-04 AC-9 (L1): `caretBand`, `caretScroll` (§4.2);
//   FR-EDT-03 AC-6 (L1): `phoneSlashItems` (§4.4); FR-EDT-08 AC-17 (L1): `recoveryKey` (§4.5, the same table as the Rust
//   twin app/src-tauri/tests/ac_android_edit.rs) and the client's four calls (§2.2).
// Red-test readings (reported): the recovery keys of the table were computed outside the code under test (Node's
// SHA-256 of `vault + "\0" + NFC(path)`); `commands.json` is written by the Rust AR-03 AC-9 test (CP-3 of AND-1).
// Written from the ACs and the contract only (D-61). Modules load inside the tests (TS-I1).
import { afterEach, test } from 'vitest';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import ts from 'typescript';

type Mod = Record<string, any>;
async function load(path: string): Promise<Mod | null> {
  try { return (await import(/* @vite-ignore */ path)) as Mod; } catch { return null; }
}
const SRC = resolve(import.meta.dirname, '../ui/src');
const COMMANDS_JSON = resolve(import.meta.dirname, '../src-tauri/target/commands.json');
const w = window as any;
afterEach(() => { delete w.__TEGG_PLATFORM__; delete w.__TAURI_INTERNALS__; });
const sorted = (xs: Iterable<string>) => [...xs].sort();

// ------------------------------------------------------------------------------------------------ FR-UX-03 AC-60 (L1)

/** AND-2's PHONE_HIDDEN_COMMANDS (android-phone.md §10) minus §13.2's seven. */
const HIDDEN_AFTER = [
  'app.palette', 'help.shortcuts', 'nav.forward', 'view.toggleSidebar', 'view.toggleRightPanel', 'view.toggleFocus', 'note.toggleProperties', 'note.width.*', 'edit.*',
  'editor.insertQuery', 'mindmap.layoutRight', 'mindmap.layoutSpider', 'preview.*', 'link.edit', 'link.remove', 'outline.*', 'panel.*', 'related.toggleLinked', 'graph.*',
  'sidebar.pinned.moveUp', 'sidebar.pinned.moveDown', 'tags.new', 'tag.*', 'queries.new', 'query.edit', 'query.rename', 'query.trash',
  'query.saveAs', 'query.columns', 'views.new', 'views.menu', 'views.remove', 'views.edit', 'views.moveLeft', 'views.moveRight', 'board.*', 'sort.*', 'columns.*',
  'typePage.*', 'type.*', 'task.*', 'tasks.schedule', 'tasks.kanban', 'tasks.search', 'types.restoreDefaultViews',
  'note.changeType', 'note.editProperties', 'media.add', 'trash.*', 'goto.trash', 'goto.brokenLinks',
  'goto.duplicateTitles', 'goto.settings/shortcuts', 'goto.settings/menu-bar', 'goto.settings/trash-history', 'goto.settings/previews', 'settings.backups', 'job.*',
  'capture.*', 'import.open', 'inbox.*', 'duplicates.merge', 'vault.open', 'vault.addStarterTypes', 'app.about', 'nav.newTab', 'edit.copyBlockLink', 'typeSettings.*',
  'panel.editRecurrence', 'settings.font', 'settings.fontSize', 'settings.accentColor', 'settings.changeShortcut', 'card.edit', 'mindmap.toggleFold', 'mindmap.addChild',
];
const UNHIDDEN = ['note.markReviewed', 'note.markUnreviewed', 'daily.markReviewed', 'daily.markUnreviewed', 'object.trash', 'sidebar.pin', 'sidebar.unpin'];
/** §13.2's exceptions inside hidden prefixes: kept by `phoneCommands`. */
const KEPT = [
  'inbox.open', 'task.complete', 'task.complete:Tasks/Zalít květiny.md', 'edit.undo', 'edit.redo', 'edit.bold', 'edit.italic', 'edit.link', 'edit.blockType', 'edit.blockType:heading2',
  'edit.tag', 'edit.bulletList', 'edit.checklist', 'edit.indent', 'edit.outdent',
];
/** Every other desktop edit.* and task.* id stays hidden (§13.2). */
const STILL_HIDDEN = [
  'edit.strike', 'edit.code', 'edit.highlight', 'edit.moveBlockUp', 'edit.moveBlockDown', 'edit.blockMenu', 'edit.selectBlock', 'edit.openOrToggle', 'edit.pastePlain', 'edit.saveNow',
  'edit.embedObject', 'edit.openEmbed', 'edit.displayEmbedAs', 'edit.turnIntoObject', 'edit.copyBlockLink', 'task.setStatus', 'task.setPriority', 'task.setDue', 'inbox.markReviewed',
  'link.remove', 'trash.restore', 'trash.delete',
];
const PREFIXES = ['task.complete:', 'note.markReviewed:', 'note.markUnreviewed:', 'phone.prop:', 'phone.prop.show:', 'phone.conflict.keep:', 'edit.blockType:'];

test('fr_ux_03_ac60_commands_after_and3', async () => {
  const pc = await load('../ui/src/phone/commands.ts');
  assert.ok(pc, 'app/ui/src/phone/commands.ts loads (contract §1)');
  const hidden = (pc!.PHONE_HIDDEN_COMMANDS ?? []) as string[];
  for (const id of UNHIDDEN) assert.ok(!hidden.includes(id), `PHONE_HIDDEN_COMMANDS no longer lists ${id} (§13.2)`);
  assert.deepEqual(sorted(hidden), sorted(HIDDEN_AFTER), 'PHONE_HIDDEN_COMMANDS keeps every other entry and loses exactly the seven of §13.2');
  assert.equal(typeof pc!.phoneCommands, 'function', 'phoneCommands(list) is exported');
  const run = () => undefined;
  const all = [...KEPT, ...STILL_HIDDEN, ...UNHIDDEN, 'object.new'].map((id) => ({ id, title: id, run }));
  const out = (pc!.phoneCommands(all) as { id: string; run: unknown; disabled?: () => unknown }[]);
  const ids = new Set(out.map((c) => c.id));
  assert.deepEqual(KEPT.filter((id) => !ids.has(id)), [], 'the exceptions of §13.2 are kept (with their `:` forms)');
  assert.deepEqual(UNHIDDEN.filter((id) => !ids.has(id)), [], 'the seven ids AND-3 shows are kept');
  assert.deepEqual(STILL_HIDDEN.filter((id) => ids.has(id)), [], 'every other desktop edit.* and task.* id (and inbox.markReviewed, link.remove, trash.*) stays hidden');
  const nw = out.find((c) => c.id === 'object.new');
  assert.ok(nw, 'object.new is listed');
  assert.equal(nw!.run, run, 'phoneCommands no longer overrides object.new (no phone.newLater)');
  assert.equal(typeof nw!.disabled === 'function' ? nw!.disabled() : null, null, 'object.new is not disabled');
  const cc = await load('../ui/src/phone/contentCommands.ts');
  assert.ok(cc, 'app/ui/src/phone/contentCommands.ts loads (contract §1)');
  const prefixes = (cc!.PAGE_COMMAND_PREFIXES ?? []) as string[];
  assert.deepEqual(PREFIXES.filter((p) => !prefixes.includes(p)), [], `PAGE_COMMAND_PREFIXES gains §13.3's prefixes: ${JSON.stringify(prefixes)}`);
});

// ------------------------------------------------------------------------------------------------ AR-03 AC-15 (L0, L1)

const ONLY = ['vault_start', 'vault_find', 'storage_access', 'storage_access_settings', 'android_open_url', 'android_window', 'android_recovery_put', 'android_recovery_get', 'android_recovery_drop', 'android_ime'];
const PHONE_MODULES = [
  'phone/FormatBar.tsx', 'phone/caret.ts', 'phone/press.ts', 'phone/MergeBanner.tsx', 'phone/recovery.ts', 'phone/PhoneProperties.tsx', 'phone/ConflictResolve.tsx', 'phone/commands.ts',
  'phone/routes.ts', 'phone/contentCommands.ts', 'phone/back.ts', 'edit/phoneInput.ts',
];
function files(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((n) => { const p = join(dir, n); return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(n) ? [p] : []; });
}

test('ar_03_ac15_platform_layer_after_and3', async () => {
  const a = await load('../ui/src/ipc/android.ts');
  assert.ok(a, 'app/ui/src/ipc/android.ts loads');
  const excluded = (a!.ANDROID_EXCLUDED ?? []) as string[];
  assert.ok(!excluded.includes('trash_restore'), 'ANDROID_EXCLUDED loses trash_restore (RA2 group O, AP-2079)');
  for (const c of ['trash_delete', 'trash_empty', 'note_rename', 'type_patch', 'tag_rename', 'inbox_bulk']) assert.ok(excluded.includes(c), `${c} stays excluded`);
  for (const c of ONLY) assert.ok(!excluded.includes(c), `${c} is not refused on Android`);
  assert.ok(existsSync(COMMANDS_JSON), `${COMMANDS_JSON} exists (the Rust AR-03 AC-9 test writes it)`);
  const lists = JSON.parse(readFileSync(COMMANDS_JSON, 'utf8')) as { DESKTOP: string[]; ANDROID: string[]; ANDROID_ONLY: string[] };
  assert.deepEqual(lists.ANDROID_ONLY, ONLY, 'ANDROID_ONLY is AND-2\'s six plus §2.2\'s four, in order');
  const at = lists.ANDROID.indexOf('trash_restore');
  assert.ok(at > 0 && lists.ANDROID[at - 1] === 'object_trash', `ANDROID has trash_restore right after object_trash: ${lists.ANDROID.slice(Math.max(0, at - 2), at + 2).join(', ')}`);
  assert.deepEqual(lists.ANDROID.slice(-ONLY.length), ONLY, 'ANDROID ends with the ten ANDROID_ONLY commands');
  const pw = await load('../ui/test/phone-writes.ts');
  const R = (pw?.READ_COMMANDS ?? []) as string[];
  for (const c of ['android_recovery_put', 'android_recovery_get', 'android_recovery_drop', 'android_ime']) assert.ok(R.includes(c), `READ_COMMANDS lists ${c} (§2.5)`);
  const pr = await load('../ui/src/phone/routes.ts');
  assert.ok(pr, 'app/ui/src/phone/routes.ts loads');
  assert.ok(!(pr!.PHONE_NOT_OFFERED ?? []).includes('new/<type>'), 'PHONE_NOT_OFFERED loses new/<type> (§13.1)');
  assert.equal(pr!.phoneRouteOffered('new/<type>'), true, 'phoneRouteOffered(new/<type>) is true');
  // L0: the new phone modules exist and none imports @tauri-apps/* (AR-03 AC-14's rule)
  assert.deepEqual(PHONE_MODULES.filter((f) => !existsSync(join(SRC, f))), [], 'AND-3\'s phone modules exist (contract §1)');
  const mods = [...files(join(SRC, 'phone')), join(SRC, 'edit/phoneInput.ts')].filter((f) => existsSync(f));
  const direct = mods.flatMap((f) => [...readFileSync(f, 'utf8').matchAll(/(?:from\s+|import\s*\(\s*|require\s*\(\s*)['"](@tauri-apps\/[^'"]+)['"]/g)].map((m) => `${f.slice(SRC.length + 1)}: ${m[1]}`));
  assert.deepEqual(direct, [], 'no phone module imports @tauri-apps/* directly');
});

// ------------------------------------------------------------------------------------------------ NFR-OTH-02 AC-27 (L0, L1)

/** §14's new keys and texts. */
const KEYS: Record<string, string> = {
  'phone.edit.heading': 'Heading', 'phone.edit.blockType': 'Block type', 'phone.edit.tag': 'Tag', 'phone.edit.indent': 'Indent', 'phone.edit.outdent': 'Outdent',
  'phone.edit.undo': 'Undo', 'phone.edit.redo': 'Redo', 'phone.title.fixed': 'Rename this note on the Mac.',
  'phone.nfdReadOnly': 'This note\'s file name uses a Unicode form the phone can\'t save safely. Edit it on the Mac.',
  'phone.conflict.title': 'Changed outside Tegg', 'phone.conflict.text': 'This note changed on disk while you were editing. Nothing is saved until you choose.',
  'phone.recovered': 'Tegg kept your unsaved changes to “{title}” on this phone.', 'phone.keepThis': 'Keep this version', 'phone.trashCopy': 'Move “{name}” to the trash?',
  'phone.mergeVersions': 'Merge versions', 'phone.pin': 'Pin', 'phone.imagesLater': 'Adding images comes later on the phone.',
  'cmd.edit.blockType': 'Change block type', 'cmd.edit.tag': 'Insert tag', 'cmd.edit.bulletList': 'Bulleted list', 'cmd.edit.checklist': 'Checklist',
  'cmd.edit.indent': 'Indent list item', 'cmd.edit.outdent': 'Outdent list item', 'cmd.phone.editProperty': 'Edit property',
};
/** Reused keys (CP-9) whose texts RA19 names. */
const REUSED: Record<string, string> = { 'toolbar.label': 'Formatting', 'toolbar.bold': 'Bold', 'toolbar.italic': 'Italic', 'toolbar.link': 'Link' };
const ATTRS = new Set(['aria-label', 'aria-description', 'title', 'placeholder', 'alt', 'label']);
function literals(file: string, source: string): string[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const out: string[] = [];
  const shown = (s: string) => /\p{L}/u.test(s);
  const visit = (n: ts.Node) => {
    if (ts.isJsxText(n) && shown(n.getText().trim())) out.push(`${file}:${sf.getLineAndCharacterOfPosition(n.getStart()).line + 1}: ${n.getText().trim()}`);
    if (ts.isJsxAttribute(n) && ATTRS.has(n.name.getText()) && n.initializer) {
      const i = n.initializer;
      const lit = ts.isStringLiteral(i) ? i.text : ts.isJsxExpression(i) && i.expression && (ts.isStringLiteral(i.expression) || ts.isNoSubstitutionTemplateLiteral(i.expression)) ? i.expression.text : null;
      if (lit && shown(lit)) out.push(`${file}:${sf.getLineAndCharacterOfPosition(n.getStart()).line + 1}: ${n.name.getText()}="${lit}"`);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

test('nfr_oth_02_ac27_strings_of_and3', async () => {
  const cat = await load('../ui/src/i18n/catalog.ts');
  assert.ok(cat, 'the catalog loads');
  const en = cat!.en as Record<string, unknown>;
  const wrong = Object.entries({ ...KEYS, ...REUSED }).filter(([k, v]) => en[k] !== v).map(([k, v]) => `${k}: ${JSON.stringify(en[k])} ≠ ${JSON.stringify(v)}`);
  assert.deepEqual(wrong, [], 'every string of RA19 / §14 is a catalog key with its English text');
  for (const k of ['phone.newLater', 'phone.noNote', 'phone.search.noMatch']) assert.ok(!(k in en), `${k} is gone from the catalog`);
  const found = [...files(join(SRC, 'phone')), join(SRC, 'edit/phoneInput.ts')].filter((f) => existsSync(f)).flatMap((f) => literals(f.slice(SRC.length + 1), readFileSync(f, 'utf8')));
  assert.ok(existsSync(join(SRC, 'phone/FormatBar.tsx')) && existsSync(join(SRC, 'phone/MergeBanner.tsx')), 'the AND-3 phone components exist (contract §1)');
  assert.deepEqual(found, [], 'no UI string literal in app/ui/src/phone/ (NFR-OTH-02 AC-1\'s rule)');
});

// ------------------------------------------------------------------------------------------------ FR-EDT-01 AC-17 (L1)

test('fr_edt_01_ac17_long_press_rule', async () => {
  const m = await load('../ui/src/phone/press.ts');
  assert.ok(m && typeof m.contextmenuAllowed === 'function', 'app/ui/src/phone/press.ts exports contextmenuAllowed (§4.3)');
  document.body.innerHTML = `
    <main>
      <div role="textbox" aria-label="Note body" contenteditable="true">
        <p id="text">Pátý <strong id="strong">blok</strong>, který test upraví.</p>
        <p>Odkaz na <span class="chip" data-wikilink="Cíl" contenteditable="false"><span id="chip">Cíl</span></span> a <span class="tag" id="tag">#projekt</span>.</p>
        <ul><li class="checklist-item"><span class="check" id="check"></span><span id="item">Koupit mléko</span></li></ul>
        <div contenteditable="false" id="map"><span id="node">Cesta</span></div>
        <p><a href="#x" id="a">odkaz</a></p>
      </div>
      <div role="textbox" aria-label="Title" contenteditable="true" id="title">Výlet</div>
      <input id="input" aria-label="Search query"><textarea id="ta"></textarea>
      <ul><li><a role="link" id="row">Řádek seznamu</a></li></ul>
      <button id="btn">Bold</button><div role="button" id="rb">Karta</div>
      <p id="plain">Mimo editor</p>
    </main>`;
  const at = (id: string) => document.getElementById(id);
  const allowed: [string, boolean][] = [
    ['text', true], ['strong', true], ['item', true], ['title', true], ['input', true], ['ta', true],
    ['chip', false], ['tag', false], ['check', false], ['node', false], ['map', false], ['a', false], ['row', false], ['btn', false], ['rb', false], ['plain', false],
  ];
  const got = allowed.map(([id]) => [id, m!.contextmenuAllowed(at(id))] as [string, boolean]);
  assert.deepEqual(got, allowed, 'contextmenuAllowed: the body\'s and Title\'s text and inputs yes; chips, tags, checkboxes, maps, links, rows, buttons and the frame no');
  assert.equal(m!.contextmenuAllowed(null), false, 'null target: not allowed');
});

// ------------------------------------------------------------------------------------------------ FR-UX-04 AC-9 (L1)

test('fr_ux_04_ac9_caret_band_and_scroll', async () => {
  const m = await load('../ui/src/phone/caret.ts');
  assert.ok(m && typeof m.caretBand === 'function' && typeof m.caretScroll === 'function', 'app/ui/src/phone/caret.ts exports caretBand and caretScroll (§4.2)');
  assert.deepEqual(m!.caretBand(92, 472), { top: 92, bottom: 464 }, 'caretBand: from the app bar\'s bottom to the cover\'s top minus 8 px');
  const band = { top: 92, bottom: 464 };
  assert.equal(m!.caretScroll({ top: 200, bottom: 220 }, band, 300, 2000), 300, 'inside the band: unchanged');
  assert.equal(m!.caretScroll({ top: 500, bottom: 520 }, band, 300, 2000), 356, 'below: the smallest change that brings the caret\'s bottom to the band\'s bottom');
  assert.equal(m!.caretScroll({ top: 50, bottom: 70 }, band, 300, 2000), 258, 'above: the smallest change that brings the caret\'s top to the band\'s top');
  assert.equal(m!.caretScroll({ top: 50, bottom: 70 }, band, 10, 2000), 0, 'clamped to 0');
  assert.equal(m!.caretScroll({ top: 900, bottom: 920 }, band, 1900, 2000), 2000, 'clamped to maxScroll');
});

// ------------------------------------------------------------------------------------------------ FR-EDT-03 AC-6 (L1)

test('fr_edt_03_ac6_phone_slash_items', async () => {
  const m = await load('../ui/src/phone/commands.ts');
  assert.ok(m && typeof m.phoneSlashItems === 'function', 'phone/commands.ts exports phoneSlashItems (§4.4)');
  assert.deepEqual([...(m!.PHONE_SLASH ?? [])], ['text', 'heading1', 'heading2', 'heading3', 'bulletList', 'orderedList', 'checklist', 'quote', 'callout', 'codeBlock', 'divider'], 'PHONE_SLASH');
  const reg = await load('../ui/src/shell/registry.ts');
  assert.ok(reg && Array.isArray(reg.SLASH_ITEMS), 'shell/registry.ts exports SLASH_ITEMS');
  const all = reg!.SLASH_ITEMS as { id: string }[];
  const got = (m!.phoneSlashItems(all) as { id: string }[]).map((i) => i.id);
  const want = all.map((i) => i.id).filter((id) => (m!.PHONE_SLASH as string[]).includes(id));
  assert.deepEqual(got, want, 'phoneSlashItems keeps PHONE_SLASH\'s ids in SLASH_ITEMS\' order');
  assert.deepEqual(sorted(got), sorted(m!.PHONE_SLASH as string[]), 'every PHONE_SLASH id is a registry slash item');
  for (const id of ['table', 'mindmap', 'query', 'task']) assert.ok(!got.includes(id), `${id} is dropped`);
});

// ------------------------------------------------------------------------------------------------ FR-EDT-08 AC-17 (L1)

/** [vault, path, key]: Node's SHA-256 of `vault + "\0" + NFC(path)` (the Rust twin has the same rows). */
const KEY_TABLE: [string, string, string][] = [
  ['/storage/emulated/0/Documents/Editor', 'Pages/Psaní.md', '655e2a827b9370ea38a2ab82674199966207f31a5433ccad1d30335025366f11'],
  ['/storage/emulated/0/Documents/Editor', 'Pages/Psaní.md', '655e2a827b9370ea38a2ab82674199966207f31a5433ccad1d30335025366f11'],
  ['/storage/emulated/0/Documents/Knihovna', 'Quick Notes/Nákup.md', '41b825973694c5caff136049046eb901b512b3be9e6361660804be7b8a8ae024'],
  ['/storage/emulated/0/Documents/Editor', 'Daily/2026-10-14.md', 'c4bad6a080873f1aa3ad53958f490892235598a92a4f153cab7ec7642ebe73f5'],
];

test('fr_edt_08_ac17_recovery_key_and_calls', async () => {
  const m = await load('../ui/src/phone/recovery.ts');
  assert.ok(m && typeof m.recoveryKey === 'function', 'app/ui/src/phone/recovery.ts exports recoveryKey (§4.5)');
  for (const [v, p, k] of KEY_TABLE) assert.equal(await m!.recoveryKey(v, p), k, `recoveryKey(${v}, ${JSON.stringify(p)})`);
  for (const f of ['keepForRecovery', 'takeRecovery']) assert.equal(typeof m![f], 'function', `recovery.ts exports ${f} (§1)`);
  // the client's four calls (§2.2)
  const calls: { cmd: string; args: unknown }[] = [];
  w.__TEGG_PLATFORM__ = 'android';
  w.__TAURI_INTERNALS__ = { invoke: async (cmd: string, args: unknown) => { calls.push({ cmd, args }); return null; }, transformCallback: () => 0 };
  const c = await load('../ui/src/ipc/client.ts');
  assert.ok(c && c.ipc, 'ipc client loads');
  for (const f of ['androidRecoveryPut', 'androidRecoveryGet', 'androidRecoveryDrop', 'androidIme']) assert.equal(typeof c!.ipc[f], 'function', `ipc.${f} exists (§2.2)`);
  const copy = { vault: '/storage/emulated/0/Documents/Editor', path: 'Pages/Psaní.md', id: '01JBAN3000000000000000E001', title: 'Psaní', text: 'Konec.X\n', base: null, savedAt: '2026-10-14T12:00:00+02:00' };
  await c!.ipc.androidRecoveryPut(copy);
  await c!.ipc.androidRecoveryGet('Pages/Psaní.md');
  await c!.ipc.androidRecoveryDrop('Pages/Psaní.md');
  await c!.ipc.androidIme(true);
  assert.deepEqual(calls.filter((x) => x.cmd.startsWith('android_')), [
    { cmd: 'android_recovery_put', args: { copy } }, { cmd: 'android_recovery_get', args: { path: 'Pages/Psaní.md' } },
    { cmd: 'android_recovery_drop', args: { path: 'Pages/Psaní.md' } }, { cmd: 'android_ime', args: { show: true } },
  ], 'the four commands with §2.2\'s arguments');
});
