// @tegg/schema: the TypeScript twin of tegg-schema's reading rules (docs/contracts/ms3-shell.md §14.4, D-241).
//
// RED-PHASE STUB (D-61): the contract's exports with placeholder bodies that return wrong values, so the AC tests
// compile and fail on assertions. Pure TypeScript, platform-neutral (AR-03). Slice 3D replaces every body.

/** @tegg/doc `Value`, redeclared structurally (no package dependency for a type). */
export type Value =
  | string | number | boolean | null
  | { date: string }
  | { datetime: string }
  | { link: string }
  | Value[];

/** Structural copies of the IPC shapes (`app/ui/src/ipc/types.ts`, §14.3). */
export type OptionDto = { label: string; color: string | null };
export type AttributeDto = {
  key: string; name: string; type: string; supported: boolean;
  readOnlyReason: 'file' | 'color' | 'recurrence' | 'unsupported' | null;
  default: unknown | null; required: boolean; options: OptionDto[];
  to: string[] | null; multiple: boolean; description: string | null; builtIn: boolean;
};
export type TypeDto = {
  key: string; name: string; plural: string; folder: string; icon: string; color: string; system: boolean; invalid: boolean;
  exists: boolean; version: unknown | null; state: 'ok' | 'newer' | 'invalid'; error: { message: string; line: number } | null;
  declaredVersion: number | null; description: string | null; review: 'off' | 'on' | 'locked'; preview: string[];
  previewIgnored: string[]; template: string | null; attributes: AttributeDto[];
};

export const CURRENT_VERSION: number = 0; // stub (contract: 1)
export const ATTR_TYPES: readonly { type: string; label: string }[] = [];
export const COLORS: readonly string[] = [];
export const ICONS: readonly string[] = [];

export function typeKey(_name: string): string {
  return '';
}
export function deriveAttrKey(_name: string): string {
  return '';
}
export function typeMatch(_value: unknown): { key: string; single: boolean } {
  return { key: '', single: false };
}

export type RuleError = { reason: string; field?: string; key?: string };
const NOT_IMPLEMENTED: RuleError = { reason: 'notImplemented' };
export function checkTypeName(_name: string, _plural: string, _types: TypeDto[], _undefinedKeys: string[]): RuleError | null {
  return NOT_IMPLEMENTED;
}
export function checkFolder(_folder: string, _types: TypeDto[], _selfKey?: string): RuleError | null {
  return NOT_IMPLEMENTED;
}
export function checkAttrKey(_key: string, _type: TypeDto, _attrType: string): RuleError | null {
  return NOT_IMPLEMENTED;
}

export type Validity = { state: 'empty' | 'valid' } | { state: 'invalid'; items: number[] };
export function validate(_attr: AttributeDto, _data: Record<string, unknown>): Validity {
  return { state: 'invalid', items: [-1] };
}

export type Parsed = { ok: true; value: Value } | { ok: false; error: string };
const NOPE: Parsed = { ok: false, error: 'notImplemented' };
export function parseNumber(_text: string, _region: string): Parsed {
  return NOPE;
}
export function parseDate(_text: string, _region: string): Parsed {
  return NOPE;
}
export function parseDateTime(_date: string, _time: string, _zone?: string): Parsed {
  return NOPE;
}
export function parseUrl(_text: string): Parsed {
  return NOPE;
}
export function parseEmail(_text: string): Parsed {
  return NOPE;
}
export function parseDateRange(_start: string | null, _end: string | null): Parsed {
  return NOPE;
}
