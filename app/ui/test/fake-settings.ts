// Fake core twin of the 5B vault settings (docs/contracts/ms5-capture.md §5.1, §11.2): `vault_settings` and
// `vault_settings_patch` over the in-memory `.tegg/vault.yml`, in Node. Test code, not product code. The rules mirror
// the contract: `default-type` matched by D-239 against the defined types (missing, empty, not a string or no such type
// → `quick-note`, not valid; `Daily Note` is valid); a patch writes only that key's line (or appends the key after the
// last entry), keeps comments and the other lines byte for byte, needs the file's current version as base (D-235),
// refuses a D-336 format or a D-222 folder with `Invalid { reason }`, and writes nothing for an equal value.
import { parse as parseYaml } from 'yaml';
import { listTypes, type Answer, type Files, type VersionDto } from './fake-schema';

const nfc = (s: string) => s.normalize('NFC');
const VAULT_YML = '.tegg/vault.yml';
let docMod: any = null;
const doc = async () => (docMod ??= await import('@tegg/doc'));

export type DefaultTypeDto = { raw: string | null; key: string; valid: boolean };
export type VaultSettingsDto = { version: VersionDto | null; defaultType: DefaultTypeDto; dailyFormat: string; attachments: string };
export type VaultKeyDto = 'default-type' | 'daily-format' | 'attachments';

/** D-239: NFC, trimmed, lower case, whitespace runs as `-`. */
export const matchKey = (raw: string) => nfc(raw).trim().toLowerCase().replace(/\s+/g, '-');

function readYml(text: string | undefined): Record<string, unknown> {
  if (text === undefined) return {};
  try {
    const y = parseYaml(text);
    return y && typeof y === 'object' && !Array.isArray(y) ? (y as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** `vault_settings` (VaultSettingsDto). */
export function vaultSettings(files: Files, vers: Record<string, VersionDto> = {}): VaultSettingsDto {
  const text = files[VAULT_YML];
  const y = readYml(text);
  const rawValue = y['default-type'];
  const raw = typeof rawValue === 'string' ? nfc(rawValue) : null;
  const keys = new Set(listTypes(files, {}).map((t: any) => nfc(t.key)));
  const key = raw === null ? '' : matchKey(raw);
  const valid = raw !== null && key !== '' && keys.has(key);
  const str = (k: string, dflt: string) => (typeof y[k] === 'string' && (y[k] as string) !== '' ? nfc(y[k] as string) : dflt);
  return {
    version: text === undefined ? null : (vers[VAULT_YML] ?? null),
    defaultType: { raw, key: valid ? key : 'quick-note', valid },
    dailyFormat: str('daily-format', 'YYYY-MM-DD'),
    attachments: str('attachments', '_attachments'),
  };
}

/** The type key the capture window preselects (D-541): Daily Note or an invalid value → `quick-note`. */
export function captureDefault(files: Files): string {
  const s = vaultSettings(files);
  return !s.defaultType.valid || s.defaultType.key === 'daily-note' ? 'quick-note' : s.defaultType.key;
}

/** D-222 folder rules (the subset a vault setting can break). */
function folderReason(v: string): string | null {
  const f = nfc(v).trim();
  if (f === '') return 'empty';
  if (f.startsWith('/') || /^[A-Za-z]:/.test(f)) return 'absolute';
  const segs = f.split('/');
  if (segs.some((s) => s === '..' || s === '.')) return 'outside';
  if (segs.some((s) => s.startsWith('.'))) return 'dot';
  if (['_templates', '_attachments', '.trash', '.tegg'].includes(segs[0]) && segs.length > 1) return 'reserved';
  if (['_templates', '.trash', '.tegg'].includes(segs[0])) return 'reserved';
  if (/[\\:*?"<>|]|\p{Cc}/u.test(f)) return 'characters';
  return null;
}

/** YAML-quoted when YAML would read the value as something else (D-230). */
function yamlValue(v: string): string {
  const plain = v !== '' && !/^[\s\-?:,[\]{}#&*!|>'"%@`]/.test(v) && !/: |\s#|\s$/.test(v) && !/^(true|false|null|~|yes|no|on|off|[-+]?\d[\d_.]*([eE][-+]?\d+)?)$/i.test(v);
  return plain ? v : `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/** `vault_settings_patch`. `vers` holds the current version of `.tegg/vault.yml`. */
export async function vaultSettingsPatch(files: Files, vers: Record<string, VersionDto>, a: { base: VersionDto | null; key: VaultKeyDto; value: string }): Promise<Answer> {
  const d = await doc();
  const text = files[VAULT_YML];
  const now = vers[VAULT_YML] ?? null;
  const base = a.base ?? null;
  const same = (x: VersionDto | null, y: VersionDto | null) => (x === null && y === null) || (!!x && !!y && x.size === y.size && x.hash === y.hash);
  if (!same(base, text === undefined ? null : now)) {
    return { error: { kind: 'Conflict', message: 'fake: vault.yml changed on disk', path: VAULT_YML, theirs: text ?? null, theirsVersion: now } };
  }
  let value = nfc(String(a.value));
  if (a.key === 'daily-format') {
    if (value.trim() === '' || !value.includes('DD') || d.dailyFileStem(value, '2026-10-14') === null) return { error: { kind: 'Invalid', message: 'fake: daily-format', reason: 'format' } };
  } else if (a.key === 'attachments') {
    const r = folderReason(value);
    if (r) return { error: { kind: 'Invalid', message: `fake: attachments ${r}`, reason: r } };
    value = value.trim();
  } else if (a.key === 'default-type') {
    value = matchKey(value);
    const keys = new Set(listTypes(files, {}).map((t: any) => nfc(t.key)));
    if (!keys.has(value)) return { error: { kind: 'UnknownType', message: `fake: no type ${value}` } };
  } else {
    return { error: { kind: 'Invalid', message: `fake: unknown key ${String(a.key)}`, reason: 'key' } };
  }
  const y = readYml(text);
  const cur = typeof y[a.key] === 'string' ? nfc(y[a.key] as string) : null;
  if (cur === value) return { result: vaultSettings(files, vers) };
  const line = `${a.key}: ${yamlValue(value)}`;
  const src = text ?? '';
  const eol = /\r\n/.test(src) ? '\r\n' : '\n';
  const lines = src === '' ? [] : src.split(/(?<=\n)/);
  const at = lines.findIndex((l) => new RegExp(`^${a.key.replace(/-/g, '\\-')}\\s*:`).test(l));
  let out: string;
  if (at >= 0) {
    const end = /\r?\n$/.exec(lines[at])?.[0] ?? '';
    lines[at] = line + end;
    out = lines.join('');
  } else {
    out = src === '' ? `${line}${eol}` : `${src}${/\n$/.test(src) ? '' : eol}${line}${eol}`;
  }
  return { writes: { [VAULT_YML]: out }, result: null };
}

export async function handle(cmd: string, a: any, files: Files, vers: Record<string, VersionDto>): Promise<Answer> {
  switch (cmd) {
    case 'vault_settings':
      return { result: vaultSettings(files, vers) };
    case 'vault_settings_patch': {
      const r = await vaultSettingsPatch(files, vers, a);
      if (r.error || !r.writes) return r;
      // The result reads the patched file; its version is filled in by the in-page part after the write.
      return { writes: r.writes, result: vaultSettings({ ...files, ...(r.writes as Files) }, {}) };
    }
    case 'capture_default':
      return { result: captureDefault(files) };
    case 'capture_context':
      return { result: captureContext(files) };
    case 'capture_plan':
      return { result: capturePlan(files, a) };
    default:
      return { error: { kind: 'Io', message: `fake-settings: unknown command ${cmd}` } };
  }
}

// ------------------------------------------------------------------------------------------------ capture window (§2.2, §3.3)

const NOT_CAPTURE_TARGETS = ['daily-note', 'tag', 'image', 'pdf'];
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

export type CaptureTypeDto = {
  key: string; name: string; icon: string; color: string; folder: string; review: 'off' | 'on' | 'locked';
  attributes: unknown[]; templateHead: string | null;
};

/** `capture_context` minus the vault and tags (the in-page part adds them): the capture targets in R55 order (Page, Task,
 *  Quick Note, then user types; the UI sorts user types with its collator) and the capture default (D-541). */
export function captureContext(files: Files): { types: CaptureTypeDto[]; defaultType: string } {
  const all = listTypes(files, {}).filter((t: any) => !NOT_CAPTURE_TARGETS.includes(t.key) && !t.invalid);
  const rank = (k: string) => { const i = ['page', 'task', 'quick-note'].indexOf(k); return i < 0 ? 3 : i; };
  all.sort((a: any, b: any) => rank(a.key) - rank(b.key) || (a.key < b.key ? -1 : 1));
  const types = all.map((t: any) => {
    const tpl = typeof t.template === 'string' ? files[nfc(t.template)] : undefined;
    const head = tpl ? (/^﻿?---\r?\n[\s\S]*?\r?\n---\r?\n/.exec(tpl)?.[0] ?? null) : null;
    return { key: t.key, name: t.name, icon: t.icon, color: t.color, folder: t.folder, review: t.review, attributes: t.attributes ?? [], templateHead: head };
  });
  return { types, defaultType: captureDefault(files) };
}

/** D-51, D-52, D-68, D-80: the file stem of a title (as the core's `sanitize_file_stem`, simplified). */
export function stemOf(title: string): string {
  let s = nfc(title).replace(/[\\/:*?"<>|#^[\]\p{Cc}]/gu, ' ').replace(/ {2,}/g, ' ').trim().replace(/^[ .]+|[ .]+$/g, '');
  if (s === '') s = 'Untitled';
  if (RESERVED.test(s)) s = `${s}_`;
  const enc = new TextEncoder();
  while (enc.encode(s).length > 200) s = [...s].slice(0, -1).join('');
  return s.replace(/[ .]+$/, '');
}

/** `capture_create`'s checks and plan (§3.3): the path it would write, or the error. */
export function capturePlan(files: Files, a: { type: string; title: string; text: string }): { path: string; typeName: string } | { error: { kind: string; message: string } } {
  const key = matchKey(String(a.type));
  const t = listTypes(files, {}).find((x: any) => x.key === key) as any;
  if (!t || NOT_CAPTURE_TARGETS.includes(key)) return { error: { kind: 'UnsupportedType', message: `fake: ${key} can't be captured` } };
  const m = /^﻿?---\r?\n([\s\S]*?)\r?\n---(\r?\n|$)/.exec(String(a.text));
  const y = m ? readYml(m[1]) : {};
  // D-604 (§3.3 step 2): `review: unreviewed` exactly when the type's review workflow is on (locked or on); another type's
  // capture carries no `review` key.
  const reviewType = t.review === 'on' || t.review === 'locked';
  const reviewOk = reviewType ? y.review === 'unreviewed' : !Object.prototype.hasOwnProperty.call(y, 'review');
  const ok = typeof y.type === 'string' && matchKey(y.type) === key && reviewOk && (typeof y.created === 'string' ? y.created !== '' : y.created != null);
  if (!ok) return { error: { kind: 'NotACapture', message: 'fake: not a capture' } };
  const folder = String(t.folder ?? key).replace(/\/+$/, '');
  const stem = stemOf(a.title);
  const taken = new Set(Object.keys(files).filter((p) => p.endsWith('.md')).map((p) => p.split('/').pop()!.replace(/\.md$/, '').toLowerCase()));
  let s = stem;
  for (let n = 2; taken.has(s.toLowerCase()); n++) s = `${stem} (${n})`;
  return { path: `${folder}/${s}.md`, typeName: t.name };
}
