// Slice I2 (docs/contracts/v1-import-window.md §2): the Import window's IPC types, hand-written as `pins.ts`, mirroring
// crates/tegg-import/src/dto.rs field by field (camelCase, the serde forms of v1-import §5.1). A `u64` is a JSON number.

export type SourceKind = 'zip' | 'folder';
export type ScanInfo = {
  kind: SourceKind; name: string; size: number | null; files: number;
  unreadable: { entry: string; reason: string }[]; outsideSpaces: number;
  spaces: SpaceInfo[];
};
export type SpaceInfo = { name: string; objects: number; attachments: number; types: { sourceType: string; objects: number }[] };

// ------------------------------------------------------------------ the mapping (v1-import §4)
export type TypeTarget = { kind: 'existing'; key: string } | { kind: 'new'; name: string } | { kind: 'skip' };
export type AttrTarget = { kind: 'existing'; key: string } | { kind: 'new'; name: string; type?: string | null } | { kind: 'drop' };
export type Merge = { kind: 'off' } | { kind: 'keep'; spellings: Record<string, string> };
export type Split = { on: boolean; to?: string | null };
export type AttrMapping = { to?: AttrTarget | null; merge?: Merge | null; split?: Split | null; values?: Record<string, string> };
export type TypeMapping = { to?: TypeTarget | null; attributes?: Record<string, AttrMapping> };
export type CaseLinkChoice = { note: string; target: string; use: boolean };
export type Mapping = { version?: number; types?: Record<string, TypeMapping>; caseLinks?: CaseLinkChoice[] };

// ------------------------------------------------------------------ the plan (v1-import §5.1)
export type AttrAction = 'keep' | 'rename' | 'drop' | 'new' | 'consumed' | 'notCreated';
export type ValueMerge = { variants: string[]; kept: string; applied: boolean };
export type StatusMap = { value: string; to: string; state: string; count: number; fallback: boolean };
export type PlannedAttr = {
  sourceKey: string; action: AttrAction; key: string | null; name: string | null; type: string | null;
  values: number; nulls: number; options: string[]; merges: ValueMerge[]; statuses: StatusMap[]; split: Split | null; needsLook: boolean;
};
export type PlannedType = {
  sourceType: string; sourceFolder: string; objects: number; target: TypeTarget; key: string | null; name: string | null;
  plural: string | null; folder: string | null; new: boolean; attributes: PlannedAttr[];
};
export type PlannedObject = {
  source: string; importId: string; outcome: 'imported' | 'skipped' | { unreadable: { reason: string; line: number | null } };
  sourceType: string | null; type: string | null; title: string | null; path: string | null;
  kind: 'note' | 'media' | 'orphanMedia' | 'queryStub'; frontmatter: [string, unknown][]; nameChanges: string[];
};
export type PlannedAttachment = { source: string; outcome: unknown; path: string | null; object: string | null; bytes: number; renamedFromGeneric: boolean; referenced: boolean };
export type PlannedLink = { note: string; n: number; line: number; place: unknown; form: string; written: string; target: string; outcome: { kind: string; [k: string]: unknown }; to: string | null; simplified: boolean; keptAsMarkdown: boolean };
export type Tally = { total: number; imported: number; reported: number };
export type Totals = { objects: Tally; attachments: Tally; links: Tally; otherFiles: Tally };
export type CaseLinkCandidate = { note: string; n: number; written: string; target: string; candidate: string; candidateTitle: string; confirmed: boolean };
export type AmbiguousLink = { note: string; n: number; written: string; title: string; candidates: string[]; chosen: string };
export type TagLikeAttr = { sourceType: string; sourceKey: string; objects: number; values: string[]; example: string; selected: boolean };
export type Decisions = { caseLinks: CaseLinkCandidate[]; ambiguous: AmbiguousLink[]; tagLike: TagLikeAttr[] };
export type ReportData = {
  summary: { source: string; space: string; date: string; objects: Tally; attachments: Tally; links: Tally; backup: string | null };
  unresolved: unknown[]; ambiguous: unknown[]; stubs: unknown[];
  merged: { sourceType: string; key: string; variants: string[]; kept: string }[];
  files: { source: string; change: { kind: string; [k: string]: unknown } }[];
  [k: string]: unknown;
};
export type PlanTarget = { kind: 'newVault'; parent: string; name: string } | { kind: 'existing'; name: string; notes: number };
export type Plan = {
  version: number; space: string; source: ScanInfo; target: PlanTarget; mapping: Mapping; types: PlannedType[];
  objects: PlannedObject[]; attachments: PlannedAttachment[]; otherFiles: { source: string; kind: string }[]; links: PlannedLink[];
  report: ReportData; totals: Totals; decisions: Decisions; alreadyImported: number; reportPath: string; spaceBytes: number;
  backup: { files: number; bytes: number } | null; neededBytes: number; stamps?: unknown;
};

// ------------------------------------------------------------------ the window's commands (§2.1, §2.3, §2.6)
export type NewVaultProblem = 'targetExists' | 'targetNotWritable' | 'targetInsideVault' | 'targetInsideSource' | 'invalidName';
export type NewVaultDto = { parent: string; name: string; path: string; display: string; problem: NewVaultProblem | null };
export type WhereDto = { newVault: NewVaultDto; current: { name: string; path: string; notes: number; alreadyImported: number } | null };
export type TargetArg = { kind: 'newVault'; parent: string; name: string } | { kind: 'existing' };
export type TaskState = 'open' | 'in progress' | 'done' | 'cancelled';
export type TargetTypeDto = {
  key: string; name: string; plural: string; system: boolean;
  attributes: { key: string; name: string; type: string }[];
  statuses: { label: string; state: TaskState }[] | null;
};
export type PlanResultDto = { token: number; plan: Plan; noSpace: { needed: number; free: number } | null; targetTypes: TargetTypeDto[] };

export type ImportPhase = 'reading' | 'planning' | 'backup' | 'writing' | 'done' | 'cancelled' | 'failed';
export type WriteStep = 'vault' | 'types' | 'attachments' | 'objects' | 'report';
export type ImportProgressDto = {
  phase: ImportPhase; step: WriteStep | null; done: number; total: number; stepDone: number; stepTotal: number;
  counts: Totals | null; job: number | null; queued: boolean;
};
/** The engine's `ImportError` as it serializes (v1-import §11): `{ code, … }`. */
export type ImportErrorDto = { code: string; [k: string]: unknown };
export type ImportResultDto = {
  job: number; phase: 'done' | 'cancelled' | 'failed'; error: ImportErrorDto | null; target: 'newVault' | 'existing';
  vault: string | null; vaultName: string; reportPath: string | null; renamed: [string, string][]; backup: string | null; kept: string[]; totals: Totals;
};
export type DoneCard = { unresolved: number; stubs: number; ambiguous: number; merged: number; mergedExample: [string, string] | null; dropped: number };
export type ImportStatusDto = {
  job: number; space: string; target: 'newVault' | 'existing'; vaultName: string; vault: string | null;
  files: number; backup: boolean; objects: number; links: number; card: DoneCard; reportDate: string;
  progress: ImportProgressDto | null; result: ImportResultDto | null;
};
export type ImportTransformEvent = { requestId: number; source: string; text: string; ops: unknown[] };
/** The shell's `IpcError` with the engine's error flattened in as `import` (§2). */
export type ImportIpcError = { kind: string; message?: string; import?: ImportErrorDto };
