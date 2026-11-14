// Fake core, slice REL (docs/contracts/v1-related.md §6): `index_related` over the fake's files, answered from the
// fixture README's expected lists (related-expected.ts), or from a test's override (`relatedAnswer`). Runs in Node
// (installFakeCore exposes it to the page as `__teggRelated`); the delay, `NotReady` and the overrides live in the page.
// Against the fake's current files: the open path missing or under `.trash/` answers `{ entries: [], reason: null }`;
// entries of a data row whose file is missing, under `.trash/`, or whose `type` is now `tag`, `image` or `pdf` are
// dropped; `title`, `type`, `review`, `status`, `due`, `completed` come from each file's current frontmatter (an
// external `title:` change relabels the chip). An override's entries are kept as given (they may name objects that are
// only in the answer, e.g. a 120-character title), with the chip fields refreshed when their file exists. Test code,
// not product code.
import { EXCERPTS, EXPECTED } from './related-expected';

export type RelatedEntryDto = {
  path: string; title: string; type: string;
  review: string | null; status: string | null; due: string | null; completed: string | null;
  linked: boolean; excerpt: string | null; score: number; shared: number;
};
export type RelatedDto = { entries: RelatedEntryDto[]; reason: 'short' | null };

const nfc = (s: string) => s.normalize('NFC');
const trashed = (p: string) => p.startsWith('.trash/');

/** The flat `key: value` lines of a file's frontmatter (quotes removed), or null without one. */
function frontmatter(text: string): Record<string, string> | null {
  if (!text.startsWith('---\n')) return null;
  const end = text.indexOf('\n---', 4);
  if (end < 0) return null;
  const out: Record<string, string> = {};
  for (const line of text.slice(4, end).split('\n')) {
    const m = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (!m) continue;
    out[m[1]] = m[2].trim().replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
  }
  return out;
}
function bodyOf(text: string): string {
  if (!text.startsWith('---\n')) return text;
  const end = text.indexOf('\n---', 4);
  return end < 0 ? text : text.slice(text.indexOf('\n', end + 1) + 1);
}
/** The first sentence of the first non-empty paragraph, as written (R182 rule 3, simplified for the fixture). */
function firstSentence(text: string): string | null {
  const para = bodyOf(text).split(/\n\s*\n/).map((p) => p.replace(/\s+/g, ' ').trim()).find((p) => p && !p.startsWith('![['));
  if (!para) return null;
  const m = /^(.*?[.!?…]+["”’»)\]]?)\s+(?=\p{Lu})/u.exec(para);
  return nfc(m ? m[1] : para);
}
function fileOf(files: Record<string, string>, path: string): string | undefined {
  return files[path] ?? Object.entries(files).find(([k]) => nfc(k) === path)?.[1];
}
function fields(path: string, text: string): Pick<RelatedEntryDto, 'title' | 'type' | 'review' | 'status' | 'due' | 'completed'> {
  const fm = frontmatter(text) ?? {};
  const stem = path.split('/').pop()!.replace(/\.md$/, '');
  const v = (k: string) => (fm[k] !== undefined && fm[k] !== '' ? nfc(fm[k]) : null);
  return { title: v('title') ?? nfc(stem), type: v('type') ?? 'page', review: v('review'), status: v('status'), due: v('due'), completed: v('completed') };
}

export function handle(cmd: string, args: any, files: Record<string, string>): { result?: unknown; error?: unknown } {
  if (cmd !== 'index_related') return { error: { kind: 'Io', message: `fake-related: unknown command ${cmd}` } };
  const path = nfc(String(args?.path ?? ''));
  const show = !!args?.showLinked;
  const override = args?.override as RelatedDto | null | undefined;
  const open = fileOf(files, path);
  if (open === undefined || trashed(path)) return { result: { entries: [], reason: null } satisfies RelatedDto };
  if (override) {
    const entries = override.entries.map((en) => {
      const t = fileOf(files, nfc(en.path));
      return t === undefined ? { ...en } : { ...en, ...fields(nfc(en.path), t) };
    });
    return { result: { entries, reason: override.reason } satisfies RelatedDto };
  }
  const row = EXPECTED[path];
  if (!row) return { result: { entries: [], reason: null } satisfies RelatedDto };
  const entries: RelatedEntryDto[] = [];
  for (const en of show ? row.shown : row.hidden) {
    const t = fileOf(files, en.path);
    if (t === undefined || trashed(en.path)) continue;
    const f = fields(en.path, t);
    if (['tag', 'image', 'pdf'].includes(f.type)) continue;
    entries.push({ path: en.path, ...f, linked: show && en.linked, excerpt: en.excerpt ?? EXCERPTS[`${path}|${en.path}`] ?? firstSentence(t), score: en.score, shared: en.shared });
  }
  return { result: { entries, reason: row.reason } satisfies RelatedDto };
}
