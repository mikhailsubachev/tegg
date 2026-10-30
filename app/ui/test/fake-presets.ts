// Fake core, slice G3 (docs/contracts/v1-graph.md §16.6): `graph_presets_get` and `graph_presets_apply` over the fake's
// `.tegg/graph.yml`, a TypeScript twin of §16.1's parser and patcher (R118 read and write rules), checked against the
// Rust module on every tests/fixtures/graph-presets/ input and expected/ output (app/test/graph_presets.ac.test.ts and
// crates/tegg-core/tests/ac_graph_presets.rs read the same files). Runs in Node (installFakeCore exposes it to the page
// as `__teggPresets`). Test code, not product code.
//
// Red-test stub (TS-I1): every entry point answers NotImplemented until slice G3 is built.
import type { GraphPresetDto, GraphPresetsDto, PresetOpDto } from '../src/graph/types';

export type PresetsErr = {
  kind: 'Conflict' | 'Gone' | 'NameEmpty' | 'NameTaken' | 'NameTooLong' | 'NameControl' | 'NoSuchPreset' | 'NewerVersion' | 'Unreadable' | 'NotUtf8' | 'Io' | 'NotImplemented';
  message: string;
  existing?: string;
};
/** The file as read: `GraphPresetsDto` without the version (the fake adds it). */
export type PresetsRead = Omit<GraphPresetsDto, 'version'>;

/** R118 read rules. `text` null: no file; `utf8` false: the bytes weren't valid UTF-8. */
export function presetsRead(text: string | null, utf8 = true): PresetsRead {
  void text; void utf8;
  throw new Error('fake-presets.presetsRead: not implemented (G3)');
}
/** R118 write rules: the file's next text after `op` (`text` null: no file), or the refusal. `typeOrder` is the
 *  vault's D-977 type order (§16.1). An operation that leaves the bytes equal returns the same text. */
export function presetsPatch(text: string | null, op: PresetOpDto, typeOrder: string[], utf8 = true): { text: string; presets: GraphPresetDto[] } | { error: PresetsErr } {
  void text; void op; void typeOrder; void utf8;
  throw new Error('fake-presets.presetsPatch: not implemented (G3)');
}

/** The fake core's entry: `files` the vault texts, `invalid` the paths whose bytes aren't UTF-8. `writes` maps a path to
 *  its new text. */
export async function handle(cmd: string, a: any, files: Record<string, string>, invalid: string[]): Promise<{ result?: unknown; error?: PresetsErr; writes?: Record<string, string> }> {
  void cmd; void a; void files; void invalid;
  return { error: { kind: 'NotImplemented', message: `fake-presets: ${cmd} is not implemented (G3)` } };
}
