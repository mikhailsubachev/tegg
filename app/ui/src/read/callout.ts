// Callout types (FR-EDT-02 AC-3; ms3-shell §11.3, D-157). Obsidian's 13 types and their aliases; an unknown type
// is shown as `note` with its raw type as the label.
import { t } from '../i18n/catalog';

export const CALLOUT_TYPES: readonly string[] = ['note', 'abstract', 'info', 'todo', 'tip', 'success', 'question', 'warning', 'failure', 'danger', 'bug', 'example', 'quote'];

const ALIASES: Record<string, string> = {
  summary: 'abstract', tldr: 'abstract', hint: 'tip', important: 'tip', check: 'success', done: 'success',
  help: 'question', faq: 'question', caution: 'warning', attention: 'warning', fail: 'failure', missing: 'failure',
  error: 'danger', cite: 'quote',
};

/** D-791: `[!type|metadata]`: the type is the text before `|`; the metadata is not shown. */
const FIRST_LINE = /^\s*(?:>\s*)?\[!([^\]|\s]+)(?:\|[^\]]*)?\]([+-]?)[ \t]*(.*)$/;

/** `raw` is the callout's first line, `> [!type]± Title` (D-157); the leading `>` is optional. */
export function calloutType(raw: string): { type: string; label: string; fold: '+' | '-' | null; title: string | null } {
  const m = FIRST_LINE.exec(raw.split(/\r?\n/)[0]);
  if (!m) return { type: 'note', label: t('callout.note'), fold: null, title: null };
  const given = m[1].normalize('NFC');
  const lower = given.toLowerCase();
  const known = CALLOUT_TYPES.includes(lower) ? lower : ALIASES[lower];
  const type = known ?? 'note';
  const label = known && CALLOUT_TYPES.includes(lower) ? t(`callout.${type}`) : known ? t(`callout.${type}`) : given;
  const title = m[3].trim();
  return { type, label, fold: m[2] === '+' || m[2] === '-' ? m[2] : null, title: title === '' ? null : title };
}
