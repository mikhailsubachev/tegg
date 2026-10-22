// Slice 5A-1: quick-add parsing (docs/contracts/ms5-tasks.md §6.4; D-380, D-483). Pure. Tokens are read only at the
// end of the text, scanning back while the last word is one: at most one date word and one priority, any number of
// tags. A word that would be a second date or priority ends the scan and stays in the title.
import { addDays } from '@tegg/doc';

export type QuickAddToken = { kind: 'due' | 'priority' | 'tag'; word: string };
export type QuickAdd = { title: string; due: string | null; priority: string | null; tags: string[]; tokens: QuickAddToken[] };

const WEEKDAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

/** English date words (D-483), plus the UI language's words mapped to the English ones. */
function dateOf(word: string, today: string, extra: Record<string, string>): string | null {
  const w0 = word.toLocaleLowerCase();
  const w = extra[w0] ?? w0;
  if (w === 'today') return today;
  if (w === 'tomorrow') return addDays(today, 1);
  const day = WEEKDAYS.indexOf(w);
  if (day < 0) return null;
  const [y, m, d] = today.split('-').map(Number);
  const iso = ((new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7) + 1;
  const ahead = ((day + 1 - iso + 7) % 7) || 7; // the next such day after today
  return addDays(today, ahead);
}

const fold = (s: string) => s.normalize('NFC').toLocaleLowerCase();

export function parseQuickAdd(text: string, ctx: { today: string; priorities: string[]; dateWords?: Record<string, string> }): QuickAdd {
  const src = text.normalize('NFC');
  const words = [...src.matchAll(/\S+/g)];
  const r: QuickAdd = { title: '', due: null, priority: null, tags: [], tokens: [] };
  let cut = src.length;
  for (let k = words.length - 1; k >= 0; k--) {
    const word = words[k][0];
    let tok: QuickAddToken | null = null;
    if (/^#[^\s#]+$/.test(word)) {
      r.tags.unshift(word.slice(1));
      tok = { kind: 'tag', word };
    } else if (word.startsWith('!') && r.priority === null) {
      const p = ctx.priorities.find((l) => !/\s/.test(l) && fold(l) === fold(word.slice(1)));
      if (p !== undefined) {
        r.priority = p;
        tok = { kind: 'priority', word };
      }
    } else if (r.due === null) {
      const d = dateOf(word, ctx.today, ctx.dateWords ?? {});
      if (d !== null) {
        r.due = d;
        tok = { kind: 'due', word };
      }
    }
    if (!tok) break;
    r.tokens.unshift(tok);
    cut = words[k].index!;
  }
  r.title = src.slice(0, cut).trim();
  return r;
}
