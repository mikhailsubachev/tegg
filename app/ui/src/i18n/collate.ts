// STUB (MS3 slice 3A red tests, D-61 / TS-I1): docs/contracts/ms3-shell.md §3.6. Deliberately wrong: compares by
// code point and ignores the locale. Replace with the region-locale Intl.Collator (AP-66).
export function setCollationLocale(_locale: string): void {}

export function collator(): Intl.Collator {
  const byCodePoint = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  return { compare: byCodePoint, resolvedOptions: () => new Intl.Collator().resolvedOptions() } as Intl.Collator;
}
