// STUB (MS3 slice 3A red tests, D-61 / TS-I1): docs/contracts/ms3-shell.md §3.1. Compiles and returns deliberately
// wrong results so the AC tests fail on assertions. Replace with the real string catalog (NFR-OTH-02).
export type Message = string | { one?: string; few?: string; many?: string; other: string };
export type Catalog = Record<string, Message>;

export const en: Catalog = {};

export function setCatalog(_c: Catalog, _locale: string): void {}

export function t(key: string, _vars?: Record<string, string | number>): string {
  return key;
}

export function pseudo(_c: Catalog): Catalog {
  return {};
}
