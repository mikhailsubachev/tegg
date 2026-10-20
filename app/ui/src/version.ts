// D-597 (FR-UX-01 AC-5): the app shows its version instead of a logo: `v0.<N>`, N being the number of the last merged
// pull request in the built commit's history (`Merge pull request #N …`), else `v0.dev`. Read at build time from the
// commit subjects, newest first (vite.config.ts → `__TEGG_VERSION__`).

const MERGE = /^Merge pull request #(\d+)\b/;

export function versionLabel(subjects: readonly string[]): string {
  for (const s of subjects) {
    const m = MERGE.exec(s.trim());
    if (m) return `v0.${Number(m[1])}`;
  }
  return 'v0.dev';
}
