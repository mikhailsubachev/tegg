// MS3 slice 3B.1, L1: the logo assets (FR-UX-01 AC-5, D-164; NFR-SEC-01).
// Written from docs/acceptance/app-shell.md (FR-UX-01 AC-5) and docs/contracts/ms3-shell.md §12.3 only (D-61).
// The assets are read with fs, so a missing file is an assertion failure (TS-I1).
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ASSETS = resolve(import.meta.dirname, '../ui/src/assets');
const LOGOS = { light: 'logo-light.svg', dark: 'logo-dark.svg' } as const;

function svg(name: string): string {
  const p = resolve(ASSETS, name);
  assert.ok(existsSync(p), `app/ui/src/assets/${name} is missing`);
  const text = readFileSync(p, 'utf8');
  assert.match(text.replace(/^﻿/, ''), /^\s*(<\?xml[^>]*\?>\s*)?(<!--[\s\S]*?-->\s*)*<svg[\s>]/, `${name} is not an SVG file`);
  assert.match(text, /<\/svg>\s*$/, `${name} is not a complete SVG file`);
  return text;
}

/** References that leave the file: href/src/url() to anything but a same-document `#id`, or @import. */
function externalRefs(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/\b(?:xlink:)?href\s*=\s*["']([^"']*)["']/g)) if (!m[1].startsWith('#')) out.push(m[0]);
  for (const m of text.matchAll(/\bsrc\s*=\s*["']([^"']*)["']/g)) out.push(m[0]);
  for (const m of text.matchAll(/url\(\s*["']?([^)"']*)["']?\s*\)/g)) if (!m[1].startsWith('#')) out.push(m[0]);
  for (const m of text.matchAll(/@import\b[^;]*/g)) out.push(m[0]);
  for (const m of text.matchAll(/<(image|foreignObject|script|iframe|use)\b[^>]*>/gi)) {
    if (m[1].toLowerCase() !== 'use' || !/href\s*=\s*["']#/.test(m[0])) out.push(m[0]);
  }
  return out;
}

for (const [theme, name] of Object.entries(LOGOS)) {
  test(`fr_ux_01_ac5_logo_${theme}_asset_is_an_svg_without_text_or_fonts`, () => {
    const text = svg(name);
    assert.equal(/<text[\s>]/i.test(text), false, `${name}: the wordmark must be paths, not a <text> element`);
    assert.equal(/<tspan[\s>]/i.test(text), false, `${name}: no <tspan>`);
    assert.equal(/@font-face/i.test(text), false, `${name}: no @font-face`);
    assert.equal(/font-family/i.test(text), false, `${name}: no font-family (text needs no font)`);
    assert.ok(/<path[\s>]/.test(text), `${name}: the mark and wordmark are drawn as paths`);
  });

  test(`fr_ux_01_ac5_logo_${theme}_asset_has_no_external_reference`, () => {
    const text = svg(name);
    assert.deepEqual(externalRefs(text), [], `${name}: external references (NFR-SEC-01)`);
    assert.equal(/https?:\/\/(?!www\.w3\.org\/)/i.test(text), false, `${name}: no URL other than the SVG namespace`);
  });
}

test('fr_ux_01_ac5_logo_assets_differ_per_theme_in_brand_blue', () => {
  const light = svg(LOGOS.light);
  const dark = svg(LOGOS.dark);
  assert.notEqual(light, dark, 'the light and dark assets differ');
  assert.match(light, /#0B44F0/i, 'light asset uses the brand blue #0B44F0 (ms3-shell §12.3)');
  assert.match(dark, /#8FAEFF/i, 'dark asset uses #8FAEFF (ms3-shell §12.3)');
});
