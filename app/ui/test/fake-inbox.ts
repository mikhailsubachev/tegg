// Fake core twin of the 5B Inbox query (docs/contracts/ms5-capture.md §7.1, §11.2; docs/acceptance/inbox.md R61,
// D-554): `inbox_list` and `inbox_count` over the in-memory files, in Node with the real @tegg/doc. Test code, not
// product code; used by the L5 fake core and the L1/L2 tests. Membership: an object outside `_templates/` and `.trash/`
// with frontmatter whose `review` is exactly `unreviewed` (a string after NFC and trimming), whatever its type; or a
// Quick Note / Daily Note (type matched by D-239) whose `review` is missing or anything but `reviewed`. Rows are in NFC
// path order and carry raw values (the UI computes instants and groups, §7.2). `apply` runs `@tegg/doc`
// `applyInboxChange` for the fake's `inbox_bulk` job.
import { excerpt } from './fake-tasks';
import type { Answer, Files } from './fake-schema';

const nfc = (s: string) => s.normalize('NFC');
let docMod: any = null;
const doc = async () => (docMod ??= await import('@tegg/doc'));

export type InboxRowDto = {
  path: string; id: string | null; title: string; type: string; reviewRaw: string | null;
  captured: string | null; created: string | null; modified: string | null; tags: string[]; excerpt: string; readOnly: boolean;
  version?: unknown;
};

const indexed = (p: string) => p.endsWith('.md') && !p.split('/').some((seg, i, a) => i < a.length - 1 && (seg.startsWith('.') || seg === '_templates'));
const raw = (v: unknown): string | null => (typeof v === 'string' ? nfc(v) : null);
const byteOrder = (a: string, b: string) => {
  const x = Buffer.from(nfc(a)), y = Buffer.from(nfc(b));
  return Buffer.compare(x, y);
};

/** `inbox_list` (InboxRowDto[]): members only, in NFC path byte order. `readOnly`: paths whose last read wasn't UTF-8. */
export async function inboxList(files: Files, readOnly: string[] = [], vers: Record<string, unknown> = {}): Promise<InboxRowDto[]> {
  const d = await doc();
  const ro = new Set(readOnly.map(nfc));
  const out: InboxRowDto[] = [];
  for (const [p0, text] of Object.entries(files)) {
    const path = nfc(p0);
    if (!indexed(path)) continue;
    const parsed = d.parse(text);
    if (!parsed.frontmatter || parsed.frontmatter.error) continue;
    const data = (parsed.frontmatter.data ?? {}) as Record<string, unknown>;
    const type = d.typeMatch('type' in data ? data.type : undefined).key as string;
    const review = typeof data.review === 'string' ? nfc(data.review).trim() : null;
    const member = review === 'unreviewed' || ((type === 'quick-note' || type === 'daily-note') && review !== 'reviewed');
    if (!member) continue;
    const stem = path.split('/').pop()!.replace(/\.md$/, '');
    const seen = new Set<string>();
    const tags: string[] = [];
    for (const t of d.tags(parsed) as { name: string; key: string }[]) {
      if (seen.has(t.key)) continue;
      seen.add(t.key);
      tags.push(nfc(t.name));
    }
    const title = typeof data.title === 'string' && data.title.trim() !== '' ? nfc(data.title) : typeof data.title === 'number' ? String(data.title) : nfc(stem);
    out.push({
      path, id: raw(data.id), title, type, reviewRaw: review,
      captured: raw(data.captured), created: raw(data.created), modified: raw(data.modified),
      tags, excerpt: excerpt(text.slice(parsed.bodyStart)), readOnly: ro.has(path),
      ...(vers[path] !== undefined ? { version: vers[path] } : {}),
    });
  }
  return out.sort((a, b) => byteOrder(a.path, b.path));
}

export async function handle(cmd: string, a: any, files: Files, vers: Record<string, unknown> = {}, ro: string[] = []): Promise<Answer> {
  switch (cmd) {
    case 'inbox_list':
      return { result: await inboxList(files, ro, vers) };
    case 'inbox_count':
      return { result: (await inboxList(files, ro)).length };
    case 'apply': {
      const d = await doc();
      // D-573: the bulk Link to carries the target's path; the text is the D-184 text from this file's folder.
      const change = a.change?.op === 'append-link-to'
        ? { op: 'append-link', target: d.d184Text(String(a.path), String(a.change.path), String(a.change.title), Object.keys(files)), now: a.change.now }
        : a.change;
      const r = d.applyInboxChange(String(a.text), change);
      return { result: r.kind === 'bytes' ? r.text : null };
    }
    default:
      return { error: { kind: 'Io', message: `fake-inbox: unknown command ${cmd}` } };
  }
}
