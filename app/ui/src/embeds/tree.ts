// The embed tree of an open note (docs/contracts/ms4-embeds.md §5; FR-EMB-02, FR-EMB-04, D-416…D-421, D-429).
// Pure functions: the loader is passed in, so the note page, the read view, L1 and the property test share them.
import { embedParts, embedSection, embedsIn, parse, type EmbedMode, type Section } from '@tegg/doc';
import type { EmbedNoteDto, LinkTargetDto, TypeDto } from '../ipc/types';

export type EmbedState = 'ok' | 'broken' | 'missing-section' | 'date-missing' | 'circular' | 'too-deep' | 'trashed';
export type EmbedNode = {
  value: string;
  line: number;
  inline: boolean;
  depth: number;
  mode: EmbedMode;
  state: EmbedState;
  target: LinkTargetDto;
  subpath: string | null;
  note: EmbedNoteDto | null;
  section: Section | null;
  readOnly: boolean;
  children: EmbedNode[];
};
export type EmbedTree = { path: string; embeds: EmbedNode[]; loads: number };

const MAX_DEPTH = 3;
const nfc = (s: string) => s.normalize('NFC');

/** R31: the built-in default of a type key (D-417). An untyped note counts as a Page (D-103, AP-339). */
export function defaultEmbed(key: string | null): EmbedMode {
  return key === null || key === 'page' || key === 'quick-note' || key === 'daily-note' ? 'full' : 'card';
}

function typeDefault(targetType: string | null, types: TypeDto[]): EmbedMode {
  if (targetType === null) return defaultEmbed(null);
  const def = types.find((x) => nfc(x.key) === nfc(targetType));
  const m = def?.embed?.toLowerCase();
  return m === 'full' || m === 'card' || m === 'link' ? m : defaultEmbed(nfc(targetType));
}

/** D-416, D-417, D-419: the mode of one embed. */
export function embedModeFor(value: string, targetType: string | null, types: TypeDto[], inline: boolean): EmbedMode {
  if (inline) return 'link';
  return embedParts(value).mode ?? typeDefault(targetType, types);
}

const UNRESOLVED = (target: string): LinkTargetDto => ({ target, kind: 'unresolved', path: null, title: null, type: null });

function lookup(links: Map<string, LinkTargetDto>, target: string): LinkTargetDto {
  return links.get(target) ?? links.get(target.trim()) ?? links.get(nfc(target.trim())) ?? UNRESOLVED(target);
}

function linkMap(note: EmbedNoteDto): Map<string, LinkTargetDto> {
  const m = new Map<string, LinkTargetDto>();
  for (const l of note.links) {
    if (!m.has(l.target)) m.set(l.target, l);
    if (!m.has(nfc(l.target))) m.set(nfc(l.target), l);
  }
  return m;
}

/** The embeds of `text` within `section` (or the body), blocks and inline, in file order. */
function embedsOf(text: string, section: Section | null): { value: string; line: number; inline: boolean }[] {
  const range = section && section.kind !== 'missing' ? [section.from, section.to] as const : [parse(text).bodyStart, text.length] as const;
  const r = embedsIn(text, range[0], range[1]);
  const all = [...r.block.map((b) => ({ ...b, inline: false })), ...r.inline.map((b) => ({ ...b, inline: true }))];
  return all.sort((a, b) => a.line - b.line);
}

/** Invalid frontmatter (NFR-REL-03): an embed of it is read-only. */
function badFrontmatter(text: string): boolean {
  const d = parse(text);
  return !!d.frontmatterError || (!!d.frontmatter && d.frontmatter.data === null);
}

type Pending = { node: EmbedNode; ancestors: string[]; links: Map<string, LinkTargetDto> };

/** D-420, D-429: builds the tree level by level, one `load` call per depth with every path that must be read. */
export async function buildEmbedTree(
  host: { path: string; text: string; links: Map<string, LinkTargetDto> },
  types: TypeDto[],
  load: (paths: string[]) => Promise<EmbedNoteDto[]>,
  opts?: { readOnly?: boolean; maxDepth?: 3 },
): Promise<EmbedTree> {
  const readView = !!opts?.readOnly;
  const cache = new Map<string, EmbedNoteDto>();
  const hostPath = nfc(host.path);
  cache.set(hostPath, { path: hostPath, state: 'ok', text: host.text, version: null, utf8: true, links: [...host.links.values()] });
  let loads = 0;

  const make = (e: { value: string; line: number; inline: boolean }, depth: number, links: Map<string, LinkTargetDto>, ancestors: string[]): EmbedNode => {
    const parts = embedParts(e.value);
    const target = lookup(links, parts.target);
    const node: EmbedNode = {
      value: e.value, line: e.line, inline: e.inline, depth, mode: 'link', state: 'ok', target, subpath: parts.subpath,
      note: null, section: null, readOnly: true, children: [],
    };
    // 6A (R74, D-27): the target is only in the trash: the placeholder with Restore.
    if (target.kind === 'trashed') {
      node.state = 'trashed';
      node.mode = embedModeFor(e.value, target.type, types, e.inline);
      return node;
    }
    if (target.kind === 'unresolved') {
      node.state = 'broken';
      node.mode = embedModeFor(e.value, null, types, e.inline);
      return node;
    }
    if (depth > MAX_DEPTH) {
      node.state = 'too-deep';
      return node;
    }
    node.mode = embedModeFor(e.value, target.type, types, e.inline);
    if (target.kind === 'date-missing') {
      node.state = 'date-missing';
      return node;
    }
    if (node.mode === 'full' && target.path && ancestors.includes(nfc(target.path))) node.state = 'circular';
    return node;
  };

  const top = embedsOf(host.text, null).map((e) => make(e, 1, host.links, [hostPath]));
  let level: Pending[] = top.map((node) => ({ node, ancestors: [hostPath], links: host.links }));

  while (level.length > 0) {
    // Everything of this depth that shows file content: full (ok) and card embeds, read once each.
    const need = level.filter((p) => p.node.state === 'ok' && p.node.mode !== 'link' && p.node.target.path);
    const paths: string[] = [];
    for (const p of need) {
      const path = nfc(p.node.target.path!);
      if (!cache.has(path) && !paths.includes(path)) paths.push(path);
    }
    if (paths.length > 0) {
      loads++;
      for (const n of await load(paths)) cache.set(nfc(n.path), n);
    }
    const next: Pending[] = [];
    for (const p of need) {
      const { node } = p;
      const note = cache.get(nfc(node.target.path!)) ?? null;
      if (!note || note.state !== 'ok' || note.text === null) {
        node.state = 'broken';
        continue;
      }
      node.note = note;
      if (node.mode !== 'full') continue;
      const section = embedSection(note.text, node.subpath);
      node.section = section;
      if (section.kind === 'missing') {
        node.state = 'missing-section';
        continue;
      }
      node.readOnly = readView || node.depth > 1 || section.kind === 'block' || !note.utf8 || badFrontmatter(note.text);
      const ancestors = [...p.ancestors, nfc(note.path)];
      const links = linkMap(note);
      node.children = embedsOf(note.text, section).map((e) => make(e, node.depth + 1, links, ancestors));
      for (const c of node.children) next.push({ node: c, ancestors, links });
    }
    level = next;
  }
  return { path: host.path, embeds: top, loads };
}
