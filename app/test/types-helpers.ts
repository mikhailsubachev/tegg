// Helpers for the MS3 slice 3D L1 tests (docs/contracts/ms3-shell.md §14.3, §14.7). Test data only: TypeDto values
// built from the synthetic fixture's type files with the `yaml` package (transcription of §14.1.1's reading rules for
// valid files; no product code). No AC assertions here.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';

export const REPO = resolve(import.meta.dirname, '../..');
export const typesNote = (rel: string) => readFileSync(resolve(REPO, 'tests/fixtures/vaults/types', rel), 'utf8');

const R10 = ['text', 'long-text', 'number', 'checkbox', 'date', 'date-time', 'date-range', 'select', 'multi-select', 'url', 'email', 'relation'];
const SYSTEM = ['page', 'task', 'quick-note', 'daily-note', 'tag', 'image', 'pdf'];

/** `TypeDto` (§14.3) of a fixture type file (`types/.tegg/types/<key>.yml` or `new-empty/.tegg/types/<key>.yml`). */
export function typeDto(key: string): any {
  const dir = SYSTEM.includes(key) ? 'new-empty' : 'types';
  const y = parseYaml(readFileSync(resolve(REPO, `tests/fixtures/vaults/${dir}/.tegg/types/${key}.yml`), 'utf8')) as any;
  const system = SYSTEM.includes(key);
  return {
    key, name: y.name ?? key, plural: y.plural ?? y.name ?? key, folder: y.folder ?? y.plural ?? key, icon: y.icon ?? 'file-text', color: y.color ?? 'gray',
    system, invalid: false, exists: true, version: { mtimeNs: '1', size: 1, hash: '00000000' }, state: (y.version ?? 1) > 1 ? 'newer' : 'ok', error: null,
    declaredVersion: y.version ?? null, description: y.description ?? null,
    review: y.review === 'locked' ? 'locked' : y.review === true ? 'on' : 'off', preview: y.preview ?? [], previewIgnored: [], hidden: y.hidden ?? [], template: y.template ?? null,
    attributes: (y.attributes ?? []).map((a: any) => ({
      key: a.key, name: a.name ?? a.key, type: a.type, supported: R10.includes(a.type),
      readOnlyReason: R10.includes(a.type) ? null : ['file', 'color', 'recurrence'].includes(a.type) ? a.type : 'unsupported',
      default: a.default ?? null, required: a.required === true,
      options: (a.options ?? []).map((o: any) => ({ label: o.label, color: o.color ?? null })),
      to: a.to ?? null, multiple: a.multiple === true, description: a.description ?? null, builtIn: system && key === 'task',
    })),
  };
}
