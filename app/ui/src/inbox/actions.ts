// Slice 5B (docs/contracts/ms5-capture.md §7.3; D-557…D-561, D-572, D-573): the writes of the Inbox actions. One item:
// note_read → `@tegg/doc` applyInboxChange → note_write with the version the page loaded (never an overwrite of a change
// made outside Tegg, NFR-REL-02). Append to: the target first (its index version as base, or the first write of a
// virtual today's note), then the item. Several items: one `inbox` job.
import { appendSection, applyInboxChange, parse, wikilinks, type InboxChange } from '@tegg/doc';
import { linkText } from '@tegg/editor';
import { ipc } from '../ipc/client';
import type { InboxRowDto, VersionDto } from '../ipc/types';
import { ulid } from '../newNote';

export type Outcome = { ok: true; text: string; version: VersionDto } | { ok: true; unchanged: true } | { ok: false; reason: 'conflict' | 'failed' | 'readOnly' };

/** Frontmatter the text engine can't parse is never rewritten (`applyInboxChange` leaves it unchanged), so the action
 *  is reported as not possible instead of a success that wrote nothing. */
const editable = (text: string) => { const d = parse(text); return !(d.frontmatter?.error || d.frontmatterError); };
const same = (a: VersionDto | null | undefined, b: VersionDto | null | undefined) => !!a && !!b && a.size === b.size && a.hash === b.hash;
const nfc = (s: string) => s.normalize('NFC');
const stemOf = (p: string) => nfc(p).replace(/\.md$/i, '').split('/').pop()!;

/** One change of one item, based on `base` (the version the page loaded; `'current'` for Try again). */
export async function changeItem(path: string, base: VersionDto | 'current', change: InboxChange): Promise<Outcome> {
  let note;
  try {
    note = await ipc.noteRead(path);
  } catch {
    return { ok: false, reason: 'failed' };
  }
  if (!note.utf8 || !editable(note.text)) return { ok: false, reason: 'readOnly' };
  if (base !== 'current' && !same(note.version, base)) return { ok: false, reason: 'conflict' };
  const r = applyInboxChange(note.text, change);
  if (r.kind === 'unchanged') return { ok: true, unchanged: true };
  try {
    const w = await ipc.noteWrite(path, r.text, note.version);
    return { ok: true, text: r.text, version: w.version };
  } catch (e) {
    return { ok: false, reason: (e as { kind?: string })?.kind === 'Conflict' ? 'conflict' : 'failed' };
  }
}

/** D-184: the link text of `target` written in a note at `from`. */
export async function linkTextFrom(from: string, target: { path: string; title: string }): Promise<string> {
  const r = await ipc.linkResolve(from, [stemOf(target.path)]).catch(() => []);
  const stemResolves = !!r[0]?.path && nfc(r[0].path) === nfc(target.path);
  return linkText({ path: target.path, title: target.title, fromPath: from, stemResolves });
}

/** D-558, D-572: the links of the item's body whose resolution from `targetPath` differs from the item's, with their
 *  D-184 text from the target's folder. */
async function retargets(itemPath: string, body: string, targetPath: string): Promise<(link: string) => string | null> {
  const links = [...new Set(wikilinks(parse(body)).filter((l) => !l.inFrontmatter).map((l) => l.target))];
  if (links.length === 0) return () => null;
  const [here, there] = await Promise.all([ipc.linkResolve(itemPath, links).catch(() => []), ipc.linkResolve(targetPath, links).catch(() => [])]);
  const map = new Map<string, string>();
  for (let i = 0; i < links.length; i++) {
    const a = here[i];
    const b = there[i];
    if (!a?.path || (b?.path && nfc(b.path) === nfc(a.path))) continue;
    map.set(links[i], await linkTextFrom(targetPath, { path: a.path, title: a.title ?? stemOf(a.path) }));
  }
  return (link) => map.get(link) ?? null;
}

export type AppendTarget = { kind: 'note'; path: string; title: string } | { kind: 'today'; date: string };
export type AppendOutcome = { ok: true; target: string } | { ok: false; reason: 'targetConflict' | 'targetFailed'; target: string } | { ok: false; reason: 'itemFailed' | 'itemConflict'; target: string };

/** D-558: appends `## <title>` and the item's body to the target, then marks the item reviewed. */
export async function appendItem(item: InboxRowDto, target: AppendTarget, now: string): Promise<AppendOutcome> {
  let note;
  try {
    note = await ipc.noteRead(item.path);
  } catch {
    return { ok: false, reason: 'itemFailed', target: target.kind === 'note' ? target.title : target.date };
  }
  const body = note.text.slice(parse(note.text).bodyStart);
  if (!note.utf8 || !editable(note.text)) return { ok: false, reason: 'itemFailed', target: target.kind === 'note' ? target.title : target.date };
  if (target.kind === 'today') {
    let draft, view;
    try {
      [draft, view] = await Promise.all([ipc.dailyDraft(target.date), ipc.dailyView(target.date)]);
    } catch {
      return { ok: false, reason: 'targetFailed', target: target.date };
    }
    if (view.path) return appendItem(item, { kind: 'note', path: view.path, title: target.date }, now);
    const text = draft.text.replace('{{id}}', ulid(Date.now())).split('{{now}}').join(now);
    const re = await retargets(item.path, body, draft.path);
    try {
      await ipc.dailyCreate(target.date, appendSection(text, item.title, body, re, now));
    } catch {
      return { ok: false, reason: 'targetFailed', target: target.date };
    }
  } else {
    const [indexed] = await ipc.indexVersions([target.path]).catch(() => [null]);
    let t;
    try {
      t = await ipc.noteRead(target.path);
    } catch {
      return { ok: false, reason: 'targetFailed', target: target.title };
    }
    if (!t.utf8 || (indexed && !same(indexed, t.version))) return { ok: false, reason: 'targetConflict', target: target.title };
    const re = await retargets(item.path, body, target.path);
    try {
      await ipc.noteWrite(target.path, appendSection(t.text, item.title, body, re, now), t.version);
    } catch (e) {
      return { ok: false, reason: (e as { kind?: string })?.kind === 'Conflict' ? 'targetConflict' : 'targetFailed', target: target.title };
    }
  }
  const name = target.kind === 'note' ? target.title : target.date;
  const r = await changeItem(item.path, item.version, { op: 'set-review', value: 'reviewed', now });
  if (!r.ok) return { ok: false, reason: r.reason === 'conflict' ? 'itemConflict' : 'itemFailed', target: name };
  return { ok: true, target: name };
}
