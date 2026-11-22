// Fake core twin of slice OC's card data (docs/contracts/v1-cards.md §3.2, §3.3, §3.5, §13). Test code, not product
// code. Runs in Node with the real @tegg/doc and @tegg/schema, as fake-links.ts and fake-tasks.ts; the rules mirror
// crates/tegg-core/src/cards.rs: raw frontmatter values for the type's effective card keys (`TypeDto.cardKeys`, from
// `@tegg/schema` `cardList`), the tags frontmatter then inline (the spelling as written, one per key, NFC), the excerpt
// only when `body` is a key, relation and `source` links resolved from the object's own path, the Inbox flag (R61) and
// an Image's or PDF's file (kind `media` when the vault has it). Kept honest by app/test/fake_cards.contract.test.ts
// against tests/fixtures/vaults/cards/expected-card-data.json, which crates/tegg-core/tests/ac_cards.rs checks the core
// against.
import * as D from '@tegg/doc';
import * as S from '@tegg/schema';
import { objectsWith, resolver, type Obj } from './fake-links';
import { listTypes, type Files } from './fake-schema';
import { excerpt } from './fake-tasks';

const nfc = (s: string) => s.normalize('NFC');
const low = (s: string) => nfc(s).toLowerCase();
const BUILT_INS: readonly string[] = (S as any).CARD_BUILT_INS;

export type LinkTargetDto = { target: string; kind: string; path: string | null; title: string | null; type: string | null; review?: null; status?: null; due?: null; completed?: null; object?: null };
export type CardDataDto = {
  type: string; title: string; keys: string[]; values: Record<string, unknown>; excerpt: string | null; links: LinkTargetDto[]; unreviewed: boolean;
  file: LinkTargetDto | null;
};
/** `bin`: the vault's binary files (images, PDFs), for an Image's or PDF's `file`. */
export type CardOpts = { bin?: string[] };

const fmGet = (fm: Record<string, unknown>, key: string): unknown => {
  if (key in fm) return fm[key];
  for (const [k, v] of Object.entries(fm)) if (nfc(k) === key) return v;
  return undefined;
};
const linkInner = (v: unknown): string | null => {
  if (typeof v !== 'string') return null;
  const m = /^\[\[([\s\S]*)\]\]$/.exec(v.trim());
  return m && m[1].trim() ? m[1] : null;
};
const strings = (v: unknown): string[] => (typeof v === 'string' ? [v] : Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

/** R61 (D-554, D-600): an Inbox member. */
export function inboxMember(path: string, type: string, fm: Record<string, unknown>): boolean {
  const p = nfc(path);
  if (p.startsWith('_templates/') || p.startsWith('.trash/')) return false;
  const review = typeof fm.review === 'string' ? nfc(fm.review.trim()) : null;
  return review === 'unreviewed' || (['quick-note', 'daily-note'].includes(type) && review !== 'reviewed');
}

/** The tags as the index has them: frontmatter then inline, the spelling as written, one per key, NFC. */
function tagsOf(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  let all: { name: string; key: string }[] = [];
  try { all = (D as any).tags((D as any).parse(text)) as { name: string; key: string }[]; } catch { all = []; }
  for (const t of all) {
    const name = nfc(String(t.name)).trim().replace(/^#/, '');
    const key = low(name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

function bodyExcerpt(text: string): string {
  try { return excerpt(text.slice((D as any).parse(text).bodyStart as number)); } catch { return ''; }
}

/** The vault's media file a target names (exact path, then the name in the object's folder, then the shortest path). */
function mediaFile(bin: string[], from: string, target: string): string | null {
  const t = low(nfc(target).split(/[|#]/)[0].trim().replace(/^\/+/, ''));
  const files = [...bin].map(nfc).sort();
  const exact = files.find((f) => low(f) === t);
  if (exact) return exact;
  if (t.includes('/')) return null;
  const named = files.filter((f) => low(f.split('/').pop()!) === t);
  if (!named.length) return null;
  const dir = from.includes('/') ? low(from.slice(0, from.lastIndexOf('/'))) : '';
  return named.find((f) => low(f.includes('/') ? f.slice(0, f.lastIndexOf('/')) : '') === dir) ?? [...named].sort((a, b) => [...a].length - [...b].length || (a < b ? -1 : 1))[0];
}
const ext = (f: string) => (/\.([^.]+)$/.exec(f)?.[1] ?? '').toLowerCase();
const typeOfExt = (f: string) => (['png', 'jpg', 'jpeg', 'gif', 'webp', 'heic', 'svg'].includes(ext(f)) ? 'image' : ext(f) === 'pdf' ? 'pdf' : null);

type Ctx = { files: Files; objs: Obj[]; byPath: Map<string, Obj>; types: any[]; resolve: ReturnType<typeof resolver>; bin: string[] };

function context(files: Files, opts: CardOpts = {}): Ctx {
  const objs = objectsWith(files, D, S);
  return { files, objs, byPath: new Map(objs.map((o) => [nfc(o.path), o])), types: listTypes(files, {}), resolve: resolver(objs), bin: opts.bin ?? [] };
}

const keysOf = (ctx: Ctx, type: string): string[] => {
  const t = ctx.types.find((x) => x.key === type);
  return t ? [...(t.cardKeys ?? [])] : [...(S as any).CARD_FALLBACK];
};

function card(ctx: Ctx, o: Obj, keys: string[], withExcerpt: boolean): CardDataDto {
  const def = ctx.types.find((x) => x.key === o.type);
  const fm = (o.attributes ?? {}) as Record<string, unknown>;
  const attr = (k: string) => (def?.attributes ?? []).find((a: any) => nfc(a.key) === k);
  const text = ctx.files[o.path] ?? '';
  const values: Record<string, unknown> = {};
  const links: LinkTargetDto[] = [];
  for (const k of keys) {
    if (k === 'body') continue;
    const a = attr(k);
    if (k === 'tags' && !a) { values.tags = tagsOf(text); continue; }
    if (a?.type === 'date-range') {
      for (const part of ['start', 'end']) values[`${k}-${part}`] = fmGet(fm, `${k}-${part}`) ?? null;
      continue;
    }
    const v = fmGet(fm, k);
    values[k] = v === undefined ? null : v;
    if (a?.type === 'relation' || (!a && k === 'source')) {
      for (const s of strings(v)) {
        const t = linkInner(s);
        if (t === null) continue;
        const r = ctx.resolve(o.path, t);
        const hit = r.path ? ctx.byPath.get(nfc(r.path)) : undefined;
        const kind = r.kind === 'ignored' || r.kind === 'trashed' ? 'unresolved' : r.kind;
        links.push(hit && (kind === 'note' || kind === 'daily') ? { target: t, kind, path: hit.path, title: hit.title, type: hit.type } : { target: t, kind: kind === 'note' ? 'unresolved' : kind, path: null, title: null, type: null });
      }
    }
  }
  let file: LinkTargetDto | null = null;
  if (o.type === 'image' || o.type === 'pdf') {
    const fa = (def?.attributes ?? []).find((a: any) => a.type === 'file');
    const t = fa ? linkInner(fmGet(fm, nfc(fa.key))) : null;
    if (t !== null) {
      const f = mediaFile(ctx.bin, o.path, t);
      file = f ? { target: t, kind: 'media', path: f, title: f.split('/').pop()!, type: typeOfExt(f) } : { target: t, kind: 'unresolved', path: null, title: null, type: null };
    }
  }
  return {
    type: o.type, title: o.title, keys, values, excerpt: keys.includes('body') && withExcerpt ? bodyExcerpt(text) : null, links,
    unreviewed: inboxMember(o.path, o.type, fm), file,
  };
}

/** §3.3: the card data of every indexed path of `paths` (NFC). */
export function cardsFor(files: Files, paths: string[], opts: CardOpts = {}): Record<string, CardDataDto> {
  const ctx = context(files, opts);
  const out: Record<string, CardDataDto> = {};
  for (const p0 of paths) {
    const p = nfc(p0);
    const o = ctx.byPath.get(p);
    if (o) out[p] = card(ctx, o, keysOf(ctx, o.type), true);
  }
  return out;
}

/** §3.3 on a query run: one card per row path with its own type's keys; the excerpt only where `body` is a key. */
export function cardsForRows(files: Files, paths: string[], opts: CardOpts = {}): Map<string, CardDataDto> {
  return new Map(Object.entries(cardsFor(files, paths, opts)));
}

/** D-1927's order key of a `modified` value (its instant; a plain date at midnight UTC); null when missing or unreadable. */
function modifiedInstant(v: unknown): number | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) { const t = Date.parse(`${s}T00:00:00Z`); return Number.isNaN(t) ? null : t; }
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/.test(s)) return null;
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : t;
}

/** §3.2 `type_card_example` (D-1984): the type's most recently modified object with every candidate key. */
export function cardExample(files: Files, key: string, opts: CardOpts = {}): { path: string; card: CardDataDto } | null {
  const ctx = context(files, opts);
  const k = nfc(key);
  const def = ctx.types.find((t) => t.key === k);
  const keys: string[] = (def?.attributes ?? []).filter((a: any) => a.type !== 'file').map((a: any) => nfc(a.key));
  for (const b of BUILT_INS) if (!keys.includes(b)) keys.push(b);
  const pick = ctx.objs
    .filter((o) => o.type === k)
    .map((o) => ({ o, at: modifiedInstant(o.attributes?.modified) }))
    .sort((a, b) => (a.at === null ? (b.at === null ? 0 : 1) : b.at === null ? -1 : b.at - a.at) || (nfc(a.o.path) < nfc(b.o.path) ? -1 : 1))[0];
  return pick ? { path: nfc(pick.o.path), card: card(ctx, pick.o, keys, true) } : null;
}

/** §3.5 (FR-LNK-14 AC-15, D-1982): duplicate details' `preview`, the first two set pill values of the card list. */
export function detailValues(o: Obj, types: any[]): [string, unknown][] {
  const def = types.find((t) => t.key === o.type);
  const keys: string[] = def ? def.cardKeys ?? [] : [...(S as any).CARD_FALLBACK];
  const fm = (o.attributes ?? {}) as Record<string, unknown>;
  const empty = (v: unknown) => (S as any).isEmpty(v) as boolean;
  const out: [string, unknown][] = [];
  for (const k of keys) {
    if (out.length >= 2) break;
    if (['tags', 'body', 'description', 'created', 'modified'].includes(k)) continue;
    const a = (def?.attributes ?? []).find((x: any) => nfc(x.key) === k);
    if (a && ['relation', 'url', 'date-range'].includes(a.type)) continue;
    const v = fmGet(fm, k);
    if (v === undefined) continue;
    if (!a && k === 'source' && typeof v === 'string' && (linkInner(v) !== null || /^(https?:\/\/|file:)/i.test(v.trim()))) continue;
    if (a?.type === 'checkbox' && v !== true) continue;
    const multi = a?.type === 'multi-select' || (!a && k === 'aliases');
    if (multi && Array.isArray(v)) {
      for (const it of v) if (!empty(it) && out.length < 2) out.push([k, it]);
    } else if (!empty(v)) out.push([k, v]);
  }
  return out;
}
