// MS3 slice 3A static rule (L0, D-95): NFR-OTH-02 AC-1, no UI string literals outside the catalog.
// docs/acceptance/app-shell.md, docs/contracts/ms3-shell.md §3.1.
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import ts from 'typescript';

const SRC = resolve(import.meta.dirname, '../ui/src');
const CATALOG = 'i18n/catalog.ts';

function files(dir: string, exts: RegExp): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...files(p, exts));
    else if (exts.test(name)) out.push(p);
  }
  return out.sort();
}

const ATTRS = new Set(['aria-label', 'aria-description', 'title', 'placeholder', 'alt', 'label']);
const exempt = (s: string) => /^[\s\p{P}\p{S}\d]*$/u.test(s);

/** The NFR-OTH-02 AC-1 rule: string literals in JSX text or in the listed attributes. Returns `line: text`. */
export function uiLiterals(fileName: string, source: string): string[] {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, fileName.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const found: string[] = [];
  const at = (n: ts.Node, text: string) => found.push(`${sf.getLineAndCharacterOfPosition(n.getStart()).line + 1}: ${text.trim()}`);
  const literalIn = (e: ts.Expression | undefined): ts.Node[] => {
    if (!e) return [];
    if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) return exempt(e.text) ? [] : [e];
    if (ts.isTemplateExpression(e)) return [e.head, ...e.templateSpans.map((s) => s.literal)].some((p) => !exempt(p.text)) ? [e] : [];
    if (ts.isConditionalExpression(e)) return [...literalIn(e.whenTrue), ...literalIn(e.whenFalse)];
    if (ts.isBinaryExpression(e)) {
      const k = e.operatorToken.kind;
      if (k === ts.SyntaxKind.PlusToken || k === ts.SyntaxKind.BarBarToken || k === ts.SyntaxKind.QuestionQuestionToken) return [...literalIn(e.left), ...literalIn(e.right)];
      if (k === ts.SyntaxKind.AmpersandAmpersandToken) return literalIn(e.right);
      return []; // comparisons: the literal is a value, not shown text
    }
    if (ts.isParenthesizedExpression(e)) return literalIn(e.expression);
    return [];
  };
  const visit = (n: ts.Node) => {
    if (ts.isJsxText(n) && !exempt(n.text)) at(n, n.text);
    if (ts.isJsxExpression(n) && n.parent && (ts.isJsxElement(n.parent) || ts.isJsxFragment(n.parent))) {
      for (const l of literalIn(n.expression)) at(l, l.getText());
    }
    if (ts.isJsxAttribute(n) && ATTRS.has(n.name.getText())) {
      const init = n.initializer;
      if (init && ts.isStringLiteral(init) && !exempt(init.text)) at(init, init.text);
      if (init && ts.isJsxExpression(init)) for (const l of literalIn(init.expression)) at(l, l.getText());
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return found;
}

test('nfr_oth_02_ac1_rule_fires_on_sample_file', () => {
  const sample = 'export const S = () => (<div><button>Save</button><button aria-label="Close">×</button></div>);\n';
  const hits = uiLiterals('sample.tsx', sample);
  assert.deepEqual(hits, ['1: Save', '1: Close']);
  assert.deepEqual(uiLiterals('ok.tsx', 'export const O = () => <span className="x" data-id="y" key="k">{" · "} 42</span>;'), []);
});

test('nfr_oth_02_ac1_no_string_literals_in_ui_code', () => {
  const offenders: string[] = [];
  for (const f of files(SRC, /\.(tsx?|jsx?)$/)) {
    const rel = relative(SRC, f);
    if (rel === CATALOG) continue;
    for (const hit of uiLiterals(f, readFileSync(f, 'utf8'))) offenders.push(`${rel}:${hit}`);
  }
  assert.deepEqual(offenders, [], 'UI string literals outside the catalog (NFR-OTH-02 AC-1)');
});

