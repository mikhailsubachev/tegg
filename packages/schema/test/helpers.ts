// Helpers for the @tegg/schema L1 AC tests (docs/contracts/ms3-shell.md §14.4, §14.9). Test data and module loading
// only: no AC assertions here except `schema`, which turns a missing module into an AssertionError (TS-I1).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export const REPO = resolve(import.meta.dirname, '../../..');
export const read = (rel: string) => readFileSync(resolve(REPO, rel), 'utf8');
export const corpus = (name: 'values.json' | 'rules.json') => JSON.parse(read(`tests/fixtures/types/${name}`));

export type Mod = Record<string, any>;
export async function schema(): Promise<Mod> {
  let m: Mod | null = null;
  try {
    m = (await import(/* @vite-ignore */ String('../src/index.ts'))) as Mod;
  } catch (e) {
    assert.fail(`@tegg/schema doesn't load: ${String((e as Error)?.message ?? e).split('\n')[0]}`);
  }
  return m!;
}

/** A corpus attribute item as an `AttributeDto` (§14.3). */
export function attributeDto(a: any): any {
  const t = String(a.type);
  const r10 = ['text', 'long-text', 'number', 'checkbox', 'date', 'date-time', 'date-range', 'select', 'multi-select', 'url', 'email', 'relation'];
  return {
    key: a.key, name: a.name ?? a.key, type: t, supported: r10.includes(t),
    readOnlyReason: r10.includes(t) ? null : (['file', 'color', 'recurrence'].includes(t) ? t : 'unsupported'),
    default: a.default ?? null, required: !!a.required, options: (a.options ?? []).map((o: any) => ({ label: o.label, color: o.color ?? null })),
    to: a.to ?? null, multiple: !!a.multiple, description: a.description ?? null, builtIn: false,
  };
}

/** A minimal `TypeDto` (§14.3) from `{ key, name?, folder?, attributes? }`. */
export function typeDto(t: any): any {
  const key = String(t.key);
  return {
    key, name: t.name ?? key, plural: t.plural ?? t.folder ?? key, folder: t.folder ?? key, icon: 'file-text', color: 'gray',
    system: ['page', 'task', 'quick-note', 'daily-note', 'tag', 'image', 'pdf'].includes(key), invalid: false, exists: true,
    version: null, state: 'ok', error: null, declaredVersion: 1, description: null, review: 'off', preview: [], previewIgnored: [],
    template: null, attributes: (t.attributes ?? []).map(attributeDto),
  };
}

/** `{ reason, field?, key? }` matches an expectation when every given field is equal (null = allowed). */
export function ruleMatches(got: any, want: any): boolean {
  if (want === null) return got === null;
  if (!got) return false;
  return got.reason === want.reason && (want.field === undefined || got.field === want.field) && (want.key === undefined || got.key === want.key);
}
