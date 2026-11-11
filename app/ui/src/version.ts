// D-597, D-1512 (FR-UX-01 AC-5): the app shows its version instead of a logo. A release build is given its version
// (`MAJOR.MINOR.PATCH`) by `npm run app:release -- <version>` through `TEGG_VERSION`; the label is then `v<version>`.
// Every other build (no version, or not of that form) shows `dev`. Read at build time (vite.config.ts → `__TEGG_VERSION__`).

const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export function versionLabel(version: string | undefined): string {
  return version && SEMVER.test(version) ? `v${version}` : 'dev';
}
