// The card model (docs/contracts/v1-cards.md §6.1, §7.1…§7.3; cards.md R211, R212; D-1942…D-1953, D-1971…D-1977):
// what one ObjectCard draws, from its type's definition and the core's card data (raw values of the effective keys).
// Pure: the date, zone, region and Date & time setting come in the input, so L1 runs it without the app.
import { isEmpty } from '@tegg/schema';
import { catalogLocale, t } from '../i18n/catalog';
import type { AttributeDto, CardDataDto, DateTimeUiDto, LinkTargetDto, ResolvedIconDto, TaskRowDto, TypeDto } from '../ipc/types';
import { sizeText } from '../media/format';
import { dueLabel } from '../tasks/views';
import { taskRules, type TaskRules } from './task';

const nfc = (s: string) => s.normalize('NFC');
/** Built-ins with a Name from the catalog (R214). */
const BUILT_IN_NAMES: Record<string, string> = { tags: 'attr.tags', body: 'attr.body', description: 'attr.description', source: 'attr.source', aliases: 'attr.aliases', created: 'attr.created', modified: 'attr.modified' };

export type CardLink =
  | { kind: 'note'; key: string; target: string; text: string; info: LinkTargetDto; more: string[] }
  | { kind: 'broken'; key: string; target: string; text: string; info: LinkTargetDto | null; more: string[] }
  | { kind: 'external'; key: string; url: string; text: string; more: string[] }
  | { kind: 'local'; key: string; url: string; text: string; path: string; more: string[] };

export type PillItem = {
  kind: 'pill'; key: string; name: string; icon: ResolvedIconDto | null; dataIcon: string | null; value: string; dot: string | null; invalid: boolean;
  title: string; label: string; index: number;
  /** FR-EDT-07 AC-7's warning text of an invalid value (`Not an option` for a choice). */
  warn?: string | null;
  /** D-1904: a Task card's status, priority and due pills keep their roles (and the due label's tone). */
  task?: { role: 'status' | 'priority' | 'due'; raw: string; tone?: string };
};
export type CardItem =
  | { kind: 'unreviewed' }
  | PillItem
  | { kind: 'link'; key: string; link: CardLink; index: number; /** The preview strip's footer link (D-1981). */ footer?: boolean }
  | { kind: 'local'; key: string; text: string; path: string; url: string; index: number };

export type CardLead = { kind: 'icon'; icon: ResolvedIconDto | null; dataIcon: string } | { kind: 'checkbox' };

export type CardParts = {
  lead: CardLead;
  strip: 'image' | 'pdf' | null;
  tags: { shown: string[]; more: number };
  text: { from: 'body' | 'description'; text: string } | null;
  items: CardItem[];
  footer: { link: CardLink | null; date: { key: 'created' | 'modified'; text: string; iso: string } | null;
    /** D-1769: a relation grouping key with two or more values on this card shows them all at its place, the footer. */
    more?: CardLink[] };
};

export type CardInput = {
  type: TypeDto | null | undefined;
  card: CardDataDto;
  task?: TaskRowDto | null;
  /** The board's grouping key (hidden from the card, views.md R187, D-1793); null for none or a period key. */
  hideKey?: string | null;
  /** The row's values of the grouping key (D-1769: two or more show on the card). */
  groupValues?: unknown;
  now: number;
  zone: string;
  region: string;
  dateSetting?: DateTimeUiDto | null;
};

// ------------------------------------------------------------------------------------------------ values

/** The link a wikilink value names, from the card's own links (F3: every value, whatever lane the card is drawn in). */
export function linkOf(links: readonly LinkTargetDto[], v: string): LinkTargetDto | undefined {
  const w = wiki(v);
  const names = new Set([v, ...(w ? [w.target, w.inner] : [])].map((x) => nfc(String(x)).trim()));
  const lower = new Set([...names].map((x) => x.toLowerCase()));
  return links.find((l) => names.has(nfc(l.target).trim())) ?? links.find((l) => lower.has(nfc(l.target).trim().toLowerCase()));
}

function wiki(v: unknown): { target: string; alias: string | null; inner: string } | null {
  if (typeof v !== 'string') return null;
  const m = /^\[\[([^\n]+)\]\]$/.exec(v.trim());
  if (!m) return null;
  const inner = m[1];
  const bar = inner.search(/\\?\|/);
  const head = bar >= 0 ? inner.slice(0, bar) : inner;
  const alias = bar >= 0 ? inner.slice(bar).replace(/^\\?\|/, '').trim() : '';
  return { target: head.split('#')[0].trim(), alias: alias || null, inner };
}

const isHttp = (v: string) => {
  if (!/^https?:\/\//i.test(v.trim()) || /\s/.test(v.trim())) return false;
  try { const u = new URL(v.trim()); return (u.protocol === 'http:' || u.protocol === 'https:') && u.hostname !== ''; } catch { return false; }
};
const isFile = (v: string) => /^file:\/\//i.test(v.trim());
const decode = (s: string) => { try { return decodeURIComponent(s); } catch { return s; } };

/** D-1973: `<host without www.>/<last non-empty path segment, decoded, NFC>`; the host alone without a path. */
export function urlChipText(url: string): string {
  let u: URL;
  try { u = new URL(url.trim()); } catch { return url; }
  const host = u.host.replace(/^www\./i, '');
  const last = u.pathname.split('/').filter(Boolean).at(-1);
  return nfc(last ? `${host}/${decode(last)}` : host);
}

/** D-1973: a file: URL value as `↗ <last segment>` with its decoded path; never a link. */
export function localItem(fileUrl: string): { text: string; path: string; title: string } | null {
  if (!isFile(fileUrl)) return null;
  let raw: string;
  try { raw = new URL(fileUrl.trim()).pathname; } catch { raw = fileUrl.trim().replace(/^file:\/\/[^/]*/i, ''); }
  const path = nfc(decode(raw));
  const name = path.split('/').filter(Boolean).at(-1) ?? path;
  return { text: t('card.localLink', { name }), path, title: path };
}

function ymdIn(ms: number, zone: string): string {
  const p = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: zone }).formatToParts(ms);
  const g = (k: string) => p.find((x) => x.type === k)?.value ?? '';
  return `${g('year')}-${g('month')}-${g('day')}`;
}
const utcOf = (ymd: string) => { const [y, m, d] = ymd.split('-').map(Number); return Date.UTC(y, m - 1, d); };

/** `YYYY-MM-DD` by the Date & time setting (D-160, D-781): the region's medium date, ISO, or Long. */
export function mediumDate(ymd: string, region: string, setting?: DateTimeUiDto | null): string {
  const kind = setting?.date ?? 'region';
  if (kind === 'iso') return ymd;
  if (kind === 'long') return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(utcOf(ymd));
  return new Intl.DateTimeFormat(region, { dateStyle: 'medium', timeZone: 'UTC' }).format(utcOf(ymd));
}

function dateTimeText(v: string, region: string, zone: string, setting?: DateTimeUiDto | null): string {
  const ms = Date.parse(v);
  if (Number.isNaN(ms)) return v;
  const s = setting ?? { date: 'region', time: 'region', week: 'region' };
  const hour12 = s.time === '12' ? true : s.time === '24' ? false : undefined;
  if (s.date === 'region') return new Intl.DateTimeFormat(region, { dateStyle: 'medium', timeStyle: 'short', timeZone: zone, ...(hour12 === undefined ? {} : { hour12 }) }).format(ms);
  const time = new Intl.DateTimeFormat(hour12 === true ? 'en-US' : hour12 === false ? 'en-GB' : region, { hour: hour12 === false ? '2-digit' : 'numeric', minute: '2-digit', timeZone: zone, ...(hour12 === undefined ? {} : { hour12 }) }).format(ms);
  return `${mediumDate(ymdIn(ms, zone), region, s)} ${time}`;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?$/;
const validDate = (s: string) => DATE.test(s) && !Number.isNaN(utcOf(s)) && new Date(utcOf(s)).toISOString().slice(0, 10) === s;

/** D-1971: the footer date's text (`Edited today`, `Created Fri`, `Added Nov 2, 2026`); null when the value isn't a date. */
export function footerDateText(key: string, value: unknown, typeKey: string, now: number, zone: string, region: string, setting?: DateTimeUiDto | null): string | null {
  if (typeof value !== 'string') return null;
  const v = value.trim();
  let day: string;
  if (validDate(v)) day = v;
  else if (DATE_TIME.test(v) && !Number.isNaN(Date.parse(v))) day = ymdIn(Date.parse(v), zone);
  else return null;
  const word = key === 'modified' ? 'edited' : typeKey === 'image' || typeKey === 'pdf' ? 'added' : 'created';
  const n = Math.round((utcOf(ymdIn(now, zone)) - utcOf(day)) / 86_400_000);
  if (n === 0) return t(`card.${word}Today`);
  if (n === 1) return t(`card.${word}Yesterday`);
  const date = n >= 2 && n <= 6 ? new Intl.DateTimeFormat(region, { weekday: 'short', timeZone: 'UTC' }).format(utcOf(day)) : mediumDate(day, region, setting);
  return t(`card.${word}On`, { date });
}

const listText = (xs: string[]) => {
  try { return new Intl.ListFormat(catalogLocale(), { type: 'unit', style: 'short' }).format(xs); } catch { return xs.join(', '); }
};

/** The accessible text of an item (`card.pill` for pills; the shown text for links and local items). */
export function itemLabel(i: CardItem): string | null {
  if (i.kind === 'pill') return i.label;
  if (i.kind === 'link') return i.link.text;
  if (i.kind === 'local') return i.text;
  return null;
}

/** §7.2: `+N more`'s tooltip: the hidden items' accessible names (`Unreviewed` never counts). */
export function moreHint(hidden: CardItem[]): string {
  return t('card.moreHint', { items: listText(hidden.map(itemLabel).filter((x): x is string => !!x)) });
}

// ------------------------------------------------------------------------------------------------ the parts

function attrOf(type: TypeDto | null | undefined, key: string): AttributeDto | undefined {
  return type?.attributes.find((a) => nfc(a.key) === key);
}

function nameOf(type: TypeDto | null | undefined, key: string): string {
  const a = attrOf(type, key);
  if (a) return a.name;
  return BUILT_IN_NAMES[key] ? t(BUILT_IN_NAMES[key]) : key;
}

/** The kind a key is drawn as (R212): its attribute's, or the built-in's. */
function kindOf(type: TypeDto | null | undefined, key: string): string {
  const a = attrOf(type, key);
  if (a) return a.type;
  if (key === 'aliases') return 'multi-select';
  if (key === 'source') return 'source';
  return key;
}

/** FR-EDT-07 AC-7's warning: `Not an option` for a choice, else the kind's invalid-value message. */
export function warnText(kind: string): string {
  if (kind === 'select' || kind === 'multi-select') return t('panel.notOption');
  const k = `attrType.${kind}`;
  const label = t(k) === k ? kind.charAt(0).toUpperCase() + kind.slice(1) : t(k);
  return t('panel.invalid', { type: label });
}

const lines = (s: string) => s.split(/\r?\n/)[0];
const raw = (v: unknown): string => (v === null || v === undefined ? '' : Array.isArray(v) ? v.map(raw).join(', ') : typeof v === 'object' ? JSON.stringify(v) : String(v));

/** One link from a wikilink value (resolved: the D-73 chip; else broken). */
function wikiLink(key: string, v: string, links: readonly LinkTargetDto[]): CardLink | null {
  const w = wiki(v);
  if (!w) return null;
  const info = linkOf(links, v);
  const ok = !!info?.path && (info.kind === 'note' || info.kind === 'daily');
  if (ok) return { kind: 'note', key, target: w.target, text: w.alias ?? info!.title ?? w.target, info: info!, more: [] };
  return { kind: 'broken', key, target: w.target, text: w.alias ?? w.target, info: info ?? null, more: [] };
}

/** A link of a `relation`, `source` or `url` value, or null when the value is none of a wikilink, an http(s) URL and a
 *  file: URL. */
function linkValue(key: string, v: string, links: readonly LinkTargetDto[], allowWiki: boolean): CardLink | null {
  if (allowWiki) { const w = wikiLink(key, v, links); if (w) return w; }
  if (isHttp(v)) return { kind: 'external', key, url: v, text: urlChipText(v), more: [] };
  const l = localItem(v);
  if (l) return { kind: 'local', key, url: v, text: l.text, path: l.path, more: [] };
  return null;
}

export function cardParts(input: CardInput): CardParts {
  const { type, card, task } = input;
  const typeKey = nfc(card.type ?? '');
  const values = new Map<string, unknown>();
  for (const [k, v] of Object.entries(card.values ?? {})) if (!values.has(nfc(k))) values.set(nfc(k), v);
  const keys = (card.keys ?? []).map(nfc).filter((k, i, a) => a.indexOf(k) === i && k !== 'title' && k !== 'review');
  const hide = input.hideKey ? nfc(input.hideKey) : null;
  const rules: TaskRules | null = task ? taskRules(type ?? null, task, input) : null;
  const done = rules?.done ?? false;

  // Lead (D-1944; Task: the checkbox).
  const lead: CardLead = task ? { kind: 'checkbox' } : { kind: 'icon', icon: type?.resolvedIcon ?? null, dataIcon: type?.icon || 'type' };
  const strip = typeKey === 'image' ? 'image' : typeKey === 'pdf' ? 'pdf' : null;

  // Tags (R43's rule on every card, D-1976).
  const allTags = keys.includes('tags') ? (Array.isArray(values.get('tags')) ? (values.get('tags') as unknown[]) : isEmpty(values.get('tags')) ? [] : [values.get('tags')])
    .map((x) => nfc(String(x)).trim().replace(/^#/, '')).filter((x) => x && !isEmpty(x)) : [];
  const tags = { shown: allTags.slice(0, 3), more: Math.max(0, allTags.length - 3) };

  // Text (D-1950, D-1975): the first of body / description in list order that has text; none on a Done task.
  let text: CardParts['text'] = null;
  if (!done) {
    for (const k of keys) {
      if (k === 'description') {
        const d = values.get('description');
        if (typeof d === 'string' && !isEmpty(d)) { text = { from: 'description', text: d.trim() }; break; }
      } else if (k === 'body') {
        const e = card.excerpt ?? '';
        if (e.trim()) { text = { from: 'body', text: e.trim() }; break; }
      }
    }
  }

  // The footer link (D-1972): the first relation or source in list order that is set and is a link.
  let footerLink: CardLink | null = null;
  if (rules?.source) footerLink = rules.source;
  let footerKey: string | null = null;
  let footerMore: CardLink[] = [];
  const group = Array.isArray(input.groupValues) ? (input.groupValues as unknown[]).filter((x) => !isEmpty(x)) : [];
  const showGroup = !!hide && group.length >= 2;
  if (!rules?.source) {
    for (const k of keys) {
      if (k === hide) {
        if (!showGroup || kindOf(type, k) !== 'relation') continue;
        const ls = group.filter((x): x is string => typeof x === 'string').map((x) => wikiLink(k, x, card.links ?? [])).filter((x): x is CardLink => !!x);
        if (ls.length === 0) continue;
        [footerLink, footerMore, footerKey] = [ls[0], ls.slice(1), k];
        break;
      }
      const kind = kindOf(type, k);
      if (kind !== 'relation' && kind !== 'source') continue;
      if (task && k === 'source') continue;
      const vs = (Array.isArray(values.get(k)) ? (values.get(k) as unknown[]) : [values.get(k)]).filter((x): x is string => typeof x === 'string' && !isEmpty(x));
      const ls = vs.map((x) => linkValue(k, x, card.links ?? [], true)).filter((x): x is CardLink => !!x);
      if (ls.length === 0) continue;
      footerLink = { ...ls[0], more: ls.slice(1).map((x) => x.text) };
      footerKey = k;
      break;
    }
  }

  // The footer date (D-1971): the first of created / modified in list order with a valid date.
  let date: CardParts['footer']['date'] = null;
  for (const k of keys) {
    if (k !== 'created' && k !== 'modified') continue;
    const v = values.get(k);
    const s = footerDateText(k, v, typeKey, input.now, input.zone, input.region, input.dateSetting);
    if (s !== null) { date = { key: k, text: s, iso: String(v) }; break; }
  }

  // The pill area (R212).
  const items: CardItem[] = [];
  if (card.unreviewed) items.push({ kind: 'unreviewed' });
  let index = 0;
  const pillsFor = (k: string, v: unknown, override?: Partial<PillItem>) => {
    const a = attrOf(type, k);
    const kind = kindOf(type, k);
    const name = kind === 'source' ? t('card.source') : nameOf(type, k);
    const icon = a?.resolvedIcon ?? null;
    const dataIcon = icon ? (a?.icon ?? icon.name) : null;
    const pill = (value: string, o: { dot?: string | null; invalid?: boolean } = {}): PillItem => ({
      kind: 'pill', key: k, name, icon, dataIcon, value, dot: o.dot ?? null, invalid: !!o.invalid, title: name, label: t('card.pill', { name, value }), index: index++,
      warn: o.invalid ? warnText(kind) : null, ...override,
    });
    const opt = (x: string) => a?.options?.find((o) => nfc(o.label) === nfc(x));
    switch (kind) {
      case 'select': {
        if (typeof v !== 'string') { items.push(pill(raw(v), { invalid: true })); return; }
        const o = opt(v);
        items.push(o ? pill(v, { dot: o.color ?? 'gray' }) : pill(v, { invalid: true }));
        return;
      }
      case 'multi-select': {
        const list = Array.isArray(v) ? v : [v];
        for (const x of list) {
          if (isEmpty(x)) continue;
          if (kind === 'multi-select' && a) {
            const o = typeof x === 'string' ? opt(x) : undefined;
            items.push(o ? pill(String(x), { dot: o.color ?? 'gray' }) : pill(raw(x), { invalid: true }));
          } else items.push(pill(raw(x)));
        }
        return;
      }
      case 'checkbox':
        if (v === true) items.push(pill(t('panel.checked')));
        else if (typeof v !== 'boolean') items.push(pill(raw(v), { invalid: true }));
        return;
      case 'number':
        if (typeof v === 'number') items.push(pill(k === 'size' && (typeKey === 'image' || typeKey === 'pdf') ? sizeText(v) : String(v)));
        else items.push(pill(raw(v), { invalid: true }));
        return;
      case 'date':
        if (k === 'due' && typeKey === 'task' && !task) {
          // A Task's card without its task row (previews, D-1904): the due date as R44's label with its tone (FR-TSK-09).
          const raw0 = typeof v === 'string' ? v.trim() : String(v);
          const st = attrOf(type, 'status')?.options?.find((o) => typeof values.get('status') === 'string' && nfc(o.label) === nfc(values.get('status') as string))?.state ?? 'open';
          const d = dueLabel({ state: st, due: validDate(raw0) ? raw0 : null, dueRaw: raw0, completed: typeof values.get('completed') === 'string' ? values.get('completed') : null } as unknown as TaskRowDto,
            ymdIn(input.now, input.zone), input.region, input.zone);
          if (d.text) items.push({ ...pill(d.text, { invalid: d.tone === 'invalid' }), task: { role: 'due', raw: raw0, tone: d.tone } });
          return;
        }
        if (typeof v === 'string' && validDate(v.trim())) items.push(pill(mediumDate(v.trim(), input.region, input.dateSetting)));
        else items.push(pill(raw(v), { invalid: true }));
        return;
      case 'date-time':
        if (typeof v === 'string' && DATE_TIME.test(v.trim())) items.push(pill(dateTimeText(v.trim(), input.region, input.zone, input.dateSetting)));
        else items.push(pill(raw(v), { invalid: true }));
        return;
      case 'long-text':
        items.push(pill(lines(raw(v))));
        return;
      case 'url': {
        const s = typeof v === 'string' ? v.trim() : '';
        const l = s ? linkValue(k, s, [], false) : null;
        if (l?.kind === 'local') items.push({ kind: 'local', key: k, text: l.text, path: l.path, url: l.url, index: index++ });
        else if (l) items.push({ kind: 'link', key: k, link: l, index: index++ });
        else items.push(pill(raw(v), { invalid: true }));
        return;
      }
      case 'relation':
      case 'source': {
        const list = (Array.isArray(v) ? v : [v]).filter((x) => !isEmpty(x));
        for (const x of list) {
          const s = typeof x === 'string' ? x : raw(x);
          const l = linkValue(k, s, card.links ?? [], true);
          if (l?.kind === 'local') items.push({ kind: 'local', key: k, text: l.text, path: l.path, url: l.url, index: index++ });
          else if (l) items.push({ kind: 'link', key: k, link: l, index: index++ });
          else items.push(pill(s, { invalid: kind === 'relation' }));
        }
        return;
      }
      default:
        items.push(pill(raw(v)));
    }
  };

  for (const k of keys) {
    if (k === 'tags' || k === 'body' || k === 'description' || k === 'created' || k === 'modified') continue;
    const a = attrOf(type, k);
    if (a?.type === 'file') continue;
    if (k === footerKey) {
      continue;
    }
    if (k === hide) {
      if (showGroup) for (const x of group) pillsFor(k, x);
      continue;
    }
    if (rules) {
      const r = rules.item(k);
      if (r === 'skip') continue;
      if (r) { items.push({ ...r, index: index++ }); continue; }
    }
    if (a?.type === 'date-range') {
      const s = values.get(`${k}-start`), e = values.get(`${k}-end`);
      if (isEmpty(s) && isEmpty(e)) continue;
      const fmt = (x: unknown) => (typeof x === 'string' && validDate(x.trim()) ? mediumDate(x.trim(), input.region, input.dateSetting) : raw(x));
      const name = a.name;
      const value = isEmpty(e) ? fmt(s) : `${fmt(s)} – ${fmt(e)}`;
      items.push({ kind: 'pill', key: k, name, icon: a.resolvedIcon ?? null, dataIcon: a.resolvedIcon ? a.icon : null, value, dot: null, invalid: false, title: name, label: t('card.pill', { name, value }), index: index++ });
      continue;
    }
    const v = values.get(k);
    if (isEmpty(v)) continue;
    pillsFor(k, v);
  }
  // D-1769: a multi-value grouping key that isn't on the card shows its values after the other pills.
  if (showGroup && hide && !keys.includes(hide)) for (const x of group) pillsFor(hide, x);

  return { lead, strip, tags, text, items, footer: { link: footerLink, date, ...(footerMore.length ? { more: footerMore } : {}) } };
}
