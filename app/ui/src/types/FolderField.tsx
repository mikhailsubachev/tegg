// Slice 4E-1 placeholder (docs/contracts/ms4-jobs.md §14.8, board TypeJobs B1): type settings' `Folder in the vault`
// field with the `Saving moves <n> …` help text from `folder_move_preview`. Stub until 4E-1 is built: renders nothing
// (TS-I1); type settings keep their current folder field until then.
export function FolderField(props: { typeKey: string; folder: string; plural: string; onSave: (folder: string) => void }) {
  void props;
  return null;
}
