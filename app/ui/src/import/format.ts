// Slice I2 (docs/contracts/v1-import-window.md §3.1): sizes, counts and list joins of the Import window, in the macOS
// region's formats (D-133). The catalog's texts take these as `{var}` values; content stays content.
import { catalogLocale, t } from '../i18n/catalog';
import { region } from '../i18n/collate';

const loc = () => region() ?? 'en-US';

/** A count in the region's grouping (`1 180` in cs). */
export const num = (n: number): string => new Intl.NumberFormat(loc()).format(n);

/** A count without grouping (the progress bar's `aria-valuetext` and its visible twin read as one number). */
export const plainNum = (n: number): string => new Intl.NumberFormat(loc(), { useGrouping: false }).format(n);

/** A size: MB (one decimal under 10, none above), GB from 1,000 MB. Under 1 MB it is still shown in MB. */
export function size(bytes: number): string {
  const mb = bytes / 1_000_000;
  if (mb >= 1000) {
    const gb = mb / 1000;
    return new Intl.NumberFormat(loc(), { style: 'unit', unit: 'gigabyte', maximumFractionDigits: gb < 10 ? 1 : 0 }).format(gb);
  }
  return new Intl.NumberFormat(loc(), { style: 'unit', unit: 'megabyte', maximumFractionDigits: mb < 10 ? 1 : 0, minimumFractionDigits: mb < 1 ? 1 : 0 }).format(mb);
}

/** `t` with every number shown in the region's grouping; the plural form follows the number. */
export const tn = (key: string, vars: Record<string, string | number> = {}): string => t(key, vars, num);

/** 4b's `{keys}`: `status and priority` (the UI language's conjunction, D-1214). */
export function listJoin(items: string[]): string {
  try {
    return new Intl.ListFormat(catalogLocale(), { type: 'conjunction' }).format(items);
  } catch {
    return items.join(', ');
  }
}
