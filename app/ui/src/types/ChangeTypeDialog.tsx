// Slice 4E-1 placeholder (docs/contracts/ms4-jobs.md §14.8, board TypeJobs A): the `Change type?` mapping dialog, built
// from `type_move_plan` (the R101 rows; the UI never computes R101 itself). Stub until 4E-1 is built: renders nothing
// (TS-I1), so the AC tests fail on the rendered DOM.
export type MapRowDto = {
  from: string;
  name: string;
  kind: string;
  value: string | null;
  default: string | 'content';
  offered: string[];
  fixed: boolean;
};
export type TypeMovePlanDto = { rows: MapRowDto[]; needsDialog: boolean };

export function ChangeTypeDialog(props: {
  plan: TypeMovePlanDto;
  fromName: string;
  toName: string;
  /** Target property key → its display name in the new type (the menu labels). */
  targetNames: Record<string, string>;
  onConfirm: (mapping: { from: string; to: string }[]) => void;
  onCancel: () => void;
}) {
  void props;
  return null;
}
