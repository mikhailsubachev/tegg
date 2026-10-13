// Name sorting with the macOS region locale, never by code point (D-122, docs/contracts/ms3-shell.md §3.6, §10).
// The shell's initialization script sets `window.__TEGG_REGION__`; tests override it with `setCollationLocale`.

let override: string | null = null;
let cache: { locale: string | null; collator: Intl.Collator | null } = { locale: null, collator: null };

export function setCollationLocale(locale: string): void {
  override = locale;
}

/** The macOS region locale (also for date formats, D-160), or null. */
export function region(): string | null {
  if (override) return override;
  const w = typeof window !== 'undefined' ? (window as { __TEGG_REGION__?: unknown }) : {};
  return typeof w.__TEGG_REGION__ === 'string' && w.__TEGG_REGION__ ? w.__TEGG_REGION__ : null;
}

/** The collator for name-sorted lists; without a region locale, the UI language's (D-122: never code point). */
export function collator(): Intl.Collator {
  const locale = region() ?? (typeof navigator !== 'undefined' ? navigator.language : 'en');
  if (cache.locale !== locale || !cache.collator) cache = { locale, collator: new Intl.Collator(locale, { sensitivity: 'base', numeric: true }) };
  return cache.collator!;
}
