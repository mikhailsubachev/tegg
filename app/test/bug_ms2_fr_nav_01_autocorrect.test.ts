// bug_ms2_fr_nav_01: the macOS autocorrect bubble swallowed ↑/↓ and Esc in the ⌘O switcher (explorer, 2026-10-12;
// FR-NAV-01 AC-11, FR-UX-03). Every text field that takes keyboard commands must turn autocorrect, spellcheck and
// autocapitalize off. The app has no UI test layer yet, so this checks the sources (TS-D2 regression guard).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// D-760: the Switcher is removed; the Search page's field takes ↑/↓ and Esc for its `Go to` list.
for (const file of ['Search.tsx']) {
  test(`bug_ms2_fr_nav_01_${file.replace('.tsx', '').toLowerCase()}_input_has_no_autocorrect`, () => {
    const src = readFileSync(resolve(import.meta.dirname, '../ui/src', file), 'utf8');
    const input = src.slice(src.indexOf('<input'), src.indexOf('/>', src.indexOf('<input')));
    for (const attr of ['autoCorrect="off"', 'autoCapitalize="off"', 'autoComplete="off"', 'spellCheck={false}']) {
      assert.ok(input.includes(attr), `${file}: input lacks ${attr}`);
    }
  });
}
