// Fake core, Search page redesign (docs/contracts/v1-search.md §2 "Fake core (L5)"): `index_search` over the fake's
// in-memory vault, in Node so tags, types and titles come from the real `@tegg/doc` (as fake-tags.ts). Test code, not
// product code. It keeps the behaviour of the in-page fake it replaces (ms3-shell §15.8: words in tiers (D-253), quoted
// phrases strict, `-word` excluded, file stems searched (D-254), no typos; ms4-tags §1.5: `tags` all of) and adds the
// v1-search fields and rules:
// - `modified` as written when it is a valid ISO date-time with offset, else null (D-1206);
// - `tags`: the object's tag keys (frontmatter and inline), NFC lower case, de-duplicated, sorted by key;
// - `title_highlights`, `alias` (alias matches are searched), `attribute` (first matching non-reserved key in
//   frontmatter order; a list → the matched item; > 160 characters → a window), all in UTF-16 code units (D-1208…D-1210);
// - `snippet`: the matched body line, else the body's lead (≤ 160 characters, no block markers, no highlight; null for
//   an empty body, D-1207);
// - `types` filters (one key, D-1203); without text the results are ordered by the `modified` instant, newest first,
//   missing or invalid last, ties by path (D-1205);
// - `offset` / `limit` slice the one ordered list; `total` counts it (FR-SRC-03 AC-12).
import { byBytes, objectsOf, type TagObj } from './fake-tags';

type Files = Record<string, string>;
type Snip = { text: string; highlights: [number, number][]; line: number };

let docMod: any = null;
const doc = async () => (docMod ??= await import('@tegg/doc'));

const fold = (s: string) => s.normalize('NFC').toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').normalize('NFC');
const words = (t: string) => [...t.normalize('NFC').matchAll(/[\p{L}\p{M}\p{N}]+/gu)].map((m) => ({ at: m.index!, end: m.index! + m[0].length, w: fold(m[0]) }));
const toks = (t: string) => words(t).map((x) => x.w);
const RESERVED = ['id', 'type', 'title', 'aliases', 'tags', 'created', 'modified'];

/** Top-level frontmatter keys in file order with their values as written (a block or flow list → its items). */
export function rawAttributes(text: string): { key: string; values: string[] }[] {
  const m = /^﻿?---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!m) return [];
  const lines = m[1].split(/\r?\n/);
  const out: { key: string; values: string[] }[] = [];
  const unq = (v: string) => v.trim().replace(/^"(.*)"$|^'(.*)'$/, '$1$2');
  for (let i = 0; i < lines.length; i++) {
    const kv = /^([^\s#\-][^:]*?):(?:[ \t]+(.*?))?[ \t]*$/.exec(lines[i]);
    if (!kv) continue;
    const key = kv[1].normalize('NFC');
    const v = kv[2] ?? '';
    if (v === '') {
      const items: string[] = [];
      while (i + 1 < lines.length && /^\s+-\s+/.test(lines[i + 1])) items.push(unq(lines[++i].replace(/^\s+-\s+/, '')));
      out.push({ key, values: items });
    } else if (/^\[.*\]$/.test(v)) {
      out.push({ key, values: v.slice(1, -1).split(',').map(unq).filter(Boolean) });
    } else out.push({ key, values: [unq(v)] });
  }
  return out;
}

/** The body without frontmatter. */
const bodyOf = (text: string) => {
  const fm = /^﻿?---\r?\n[\s\S]*?\r?\n---\r?\n?/.exec(text);
  return fm ? text.slice(fm[0].length) : text;
};
/** D-107, D-1207: the first ≤ 160 characters of the body, block markers removed, lines joined by a space. */
export function lead(body: string): Snip | null {
  const lines = body.split(/\r?\n/);
  const first = lines.findIndex((l) => l.trim());
  if (first < 0) return null;
  const parts = lines.map((l) => l.replace(/^\s*(#{1,6}\s+|>\s*|[-*+]\s+\[[ xX]\]\s+|[-*+]\s+|\d+[.)]\s+)/, '').trim()).filter(Boolean);
  const text = [...parts.join(' ')].slice(0, 160).join('');
  return { text, highlights: [], line: first + 1 };
}

/** > 160 characters: a window of ≤ 160 characters around the first highlight (ranges moved with it). */
function window160(text: string, hl: [number, number][]): Snip {
  const cps = [...text];
  if (cps.length <= 160 || !hl.length) return { text: cps.slice(0, 160).join(''), highlights: hl, line: 0 };
  const at = [...text.slice(0, hl[0][0])].length;
  const start = Math.max(0, Math.min(at - 40, cps.length - 160));
  const pre = cps.slice(0, start).join('').length; // UTF-16 offset of the window
  const t = cps.slice(start, start + 160).join('');
  return { text: t, highlights: hl.map(([a, b]) => [a - pre, b - pre] as [number, number]).filter(([a, b]) => a >= 0 && b <= t.length), line: 0 };
}

const titleOf = (o: TagObj) => {
  if (o.type !== 'daily-note') return o.title;
  const d = o.fm && typeof o.fm.date === 'string' ? o.fm.date.trim().slice(0, 10) : null;
  return d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : o.title;
};
const aliasesOf = (o: TagObj): string[] => {
  const a = o.fm ? o.fm.aliases : undefined;
  if (typeof a === 'string') return [a.normalize('NFC')];
  return Array.isArray(a) ? a.filter((x) => typeof x === 'string').map((x) => (x as string).normalize('NFC')) : [];
};
const tagKeys = (o: TagObj) => [...new Set(o.occ.map((t) => t.key))].sort();

export async function handle(cmd: string, a: any, files: Files): Promise<{ result?: unknown; error?: { kind: string; message: string } }> {
  if (cmd !== 'index_search') return { error: { kind: 'Invalid', message: `fake-search: unknown ${cmd}` } };
  const d = await doc();
  const q = a?.query ?? {};
  const wantTags = ((q.tags ?? []) as unknown[]).map((k) => d.tagKey(String(k)) as string);
  const wantTypes = ((q.types ?? []) as unknown[]).map((t) => String(t).normalize('NFC'));
  const objs = objectsOf(files, d).filter((o) => wantTags.every((k) => o.occ.some((t) => t.key === k)) && (!wantTypes.length || wantTypes.includes(o.type)));

  const items: { toks: string[]; neg: boolean; quoted: boolean }[] = [];
  for (const m of String(q.text ?? '').matchAll(/(-?)(?:["„“]([^"“”]*)["“”]?|(\S+))/g)) {
    const tk = toks(m[2] ?? m[3] ?? '');
    if (tk.length) items.push({ toks: tk, neg: m[1] === '-' && (m[2] !== undefined || (m[3] ?? '').length > 0), quoted: m[2] !== undefined });
  }
  const pos = items.filter((i) => !i.neg);
  const seq = (hay: string[], need: string[]) => hay.some((_, k) => need.every((x, j) => hay[k + j] === x));
  const base = (o: TagObj) => ({
    path: o.path, type: o.type, title: titleOf(o), modified: o.modifiedNs !== null ? o.modified : null, tags: tagKeys(o),
  });
  const page = (all: unknown[]) => {
    const offset = Number.isInteger(q.offset) ? Number(q.offset) : 0;
    const limit = Number.isInteger(q.limit) ? Number(q.limit) : all.length;
    return { result: { results: all.slice(offset, offset + limit), total: all.length } };
  };

  if (!pos.length) {
    if (!wantTags.length && !wantTypes.length) return { result: { results: [], total: 0 } };
    const only = objs
      .filter((o) => !items.some((i) => i.neg && [titleOf(o), o.stem, o.text].some((t) => seq(toks(t), i.toks))))
      .sort((x, y) => (x.modifiedNs === null ? 1 : 0) - (y.modifiedNs === null ? 1 : 0)
        || (x.modifiedNs !== null && y.modifiedNs !== null && x.modifiedNs !== y.modifiedNs ? (x.modifiedNs > y.modifiedNs ? -1 : 1) : 0)
        || byBytes(x.path, y.path))
      .map((o) => ({ ...base(o), matched_in: 'title', tier: 'phrase', typo: false, snippet: lead(bodyOf(o.text)), file_name: null, title_highlights: [], alias: null, attribute: null }));
    return page(only);
  }

  const unq = pos.filter((i) => !i.quoted);
  const rows = objs.flatMap((o) => {
    const title = titleOf(o);
    const body = bodyOf(o.text);
    const stem = o.stem.normalize('NFC');
    const aliases = aliasesOf(o);
    const attrs = rawAttributes(o.text).filter((x) => !RESERVED.includes(x.key));
    const fields = {
      title: toks(title), fileName: toks(stem), alias: toks(aliases.join(' \n ')),
      attribute: toks(attrs.flatMap((x) => x.values).join(' \n ')), body: toks(body),
    };
    const all = Object.values(fields);
    const has = (i: { toks: string[] }) => all.some((h) => seq(h, i.toks));
    if (items.some((i) => i.neg && has(i)) || pos.some((i) => i.quoted && !has(i))) return [];
    const matched = pos.filter(has);
    if (unq.length && !unq.some(has)) return [];
    const tier = unq.length <= 1 ? 'phrase' : !unq.every(has) ? 'anyWord' : all.some((h) => seq(h, unq.flatMap((i) => i.toks))) ? 'phrase' : 'allWords';
    const field = (Object.keys(fields) as (keyof typeof fields)[]).find((k) => matched.some((i) => seq(fields[k], i.toks)))!;
    const mark = (t: string): [number, number][] => {
      const ws = words(t);
      return ws.flatMap((w, k) => matched.filter((i) => i.toks.every((x, j) => ws[k + j]?.w === x)).map((i) => [w.at, ws[k + i.toks.length - 1].end] as [number, number]));
    };
    const lines = body.split(/\r?\n/);
    const hit = lines.findIndex((l) => mark(l).length);
    const snippet = hit >= 0 ? { text: lines[hit], highlights: mark(lines[hit]), line: hit + 1 } : lead(body);
    let alias: Snip | null = null;
    if (field === 'alias') {
      const al = aliases.find((x) => mark(x).length);
      if (al !== undefined) alias = { text: al, highlights: mark(al), line: 0 };
    }
    let attribute: { key: string; value: Snip } | null = null;
    if (field === 'attribute') {
      for (const x of attrs) {
        const v = x.values.find((s) => mark(s).length);
        if (v !== undefined) { attribute = { key: x.key, value: window160(v, mark(v)) }; break; }
      }
    }
    return [{
      rank: [['phrase', 'allWords', 'anyWord'].indexOf(tier), field === 'fileName' ? 0 : ['title', 'alias', 'attribute', 'body'].indexOf(field)],
      r: {
        ...base(o), matched_in: field, tier, typo: false, snippet,
        file_name: field === 'fileName' ? { text: stem, highlights: mark(stem), line: 0 } : null,
        title_highlights: mark(title), alias, attribute,
      },
    }];
  });
  rows.sort((x, y) => x.rank[0] - y.rank[0] || x.rank[1] - y.rank[1] || x.r.path.localeCompare(y.r.path));
  return page(rows.map((x) => x.r));
}
