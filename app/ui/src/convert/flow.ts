// Slice 5A-2: block → object conversion (docs/contracts/ms5-tasks.md §11.2, §11.4; D-490…D-498, D-524…D-527).
// Create first (one creation path, create-exclusive), then the source's editor replaces the blocks by the embed as one
// undo step and its save is flushed at once; undo saves the source, then deletes (or trashes) the new file; redo
// recreates it before the embed comes back (D-498: a crash never leaves an embed of a missing file).
import { embedTarget, linkText, type ConversionRecord, type TeggEditor } from '@tegg/editor';
import { objectFromUnit, parse, type ConvertUnit, type Value } from '@tegg/doc';
import { t } from '../i18n/catalog';
import { ipc } from '../ipc/client';
import type { TypeDefDto } from '../ipc/types';
import { localIso } from '../newNote';
import { prepareObject } from '../types/create';
import { pushAlert } from './alerts';
import { setConvertPrefs } from './prefs';

const nfc = (s: string) => s.normalize('NFC');
const stemOf = (path: string) => nfc(path).replace(/\.md$/i, '').split('/').pop()!;

export type ConvertHost = {
  ed: TeggEditor;
  /** The source note's vault path (a virtual Daily Note's planned path). */
  source: string;
  /** The source's date when it is a Daily Note (its link is the date, D-162). */
  daily: string | null;
  /** The title of a wikilink target as resolved from the source, or null. */
  linkTitle: (target: string) => string | null;
  /** Flushes the source's save now (not after the 1 s autosave, FR-CNV-03 AC-6). */
  flush: () => Promise<void>;
};

/** FR-CNV-04 AC-1 (D-184, D-527): the `source` link text from the new file's folder. */
async function sourceLink(host: ConvertHost, folder: string): Promise<string> {
  if (host.daily) return host.daily;
  const from = `${folder ? `${folder}/` : ''}x.md`;
  const stem = stemOf(host.source);
  const r = await ipc.linkResolve(from, [stem]).catch(() => []);
  const stemResolves = !!r[0]?.path && nfc(r[0].path) === nfc(host.source);
  const fm = parse(host.ed.text()).frontmatter?.data;
  const title = typeof fm?.title === 'string' && fm.title.trim() ? nfc(fm.title.trim()) : stem;
  return linkText({ path: host.source, title, fromPath: from, stemResolves });
}

/** FR-CNV-03 AC-5, AC-11: the embed target of the file actually created, from the source (never the planned name). */
export async function embedTargetFor(source: string, path: string, title: string): Promise<string> {
  const r = await ipc.linkResolve(source, [stemOf(path)]).catch(() => []);
  const stemResolves = !!r[0]?.path && nfc(r[0].path) === nfc(path);
  return embedTarget({ path, title, fromPath: source, stemResolves });
}

/** Converts `unit` (null: the caret's empty paragraph, `/task` there) into a new object of `type` titled `title`. */
export async function convert(host: ConvertHost, unit: ConvertUnit | null, title: string, type: TypeDefDto): Promise<boolean> {
  const text = host.ed.text();
  const obj = unit ? objectFromUnit(text, unit, host.linkTitle) : { title: '', tags: [], body: '', checked: null };
  let made: { path: string; text: string };
  let key: string;
  try {
    const prepared = await prepareObject(type.key);
    key = prepared.key;
    const values: [string, Value][] = [];
    if (key === 'task' && obj.checked === true) {
      // D-495: a checked item becomes Done (the first Done-state status) with `completed` now.
      const def = await ipc.typeGet('task');
      const done = def?.attributes.find((a) => a.key === 'status')?.options?.find((o) => o.state === 'done')?.label;
      if (done) values.push(['status', done], ['completed', { datetime: localIso(new Date(Date.now())) }]);
    }
    if (obj.tags.length) values.push(['tags', obj.tags]);
    values.push(['source', { link: await sourceLink(host, prepared.folder) }]);
    made = await prepared.createWithBody(title, values, obj.body);
  } catch {
    pushAlert(t('convert.failed', { title }));
    return false;
  }
  const target = await embedTargetFor(host.source, made.path, title);
  const record: ConversionRecord = { path: made.path, created: made.text, type: key, title };
  if (unit) host.ed.commands.convertUnit(unit, target, record);
  else {
    const at = host.ed.view.state.selection.from;
    host.ed.commands.insertEmbed(at, at, target);
  }
  setConvertPrefs({ lastType: type.key });
  await host.flush();
  return true;
}

/** D-492: the editor's conversion hooks. */
export function conversionHooks(host: () => ConvertHost | null) {
  return {
    afterUndo(r: ConversionRecord) {
      void (async () => {
        const h = host();
        if (h) await h.flush(); // the source first: it never names a missing file
        let note;
        try {
          note = await ipc.noteRead(r.path);
        } catch {
          return; // FR-CNV-06 AC-5: already gone
        }
        if (note.utf8 && note.text === r.created) {
          try {
            await ipc.noteDiscard(r.path, note.version);
            return;
          } catch (e) {
            if ((e as { kind?: string })?.kind === 'NotFound') return;
          }
        }
        // FR-CNV-06 AC-3: changed since its creation: never deleted, moved to the trash.
        try {
          const now = await ipc.noteRead(r.path);
          await ipc.noteTrash(r.path, now.version);
          pushAlert(t('convert.trashedOnUndo', { title: r.title }));
        } catch { /* gone meanwhile */ }
      })();
    },
    async beforeRedo(r: ConversionRecord): Promise<string | false> {
      const h = host();
      if (!h) return false;
      let path = r.path;
      try {
        await ipc.noteCreateExact(r.path, r.created);
      } catch {
        // FR-CNV-06 AC-2: the path is taken now: the next free stem, the same bytes and `id`.
        try {
          path = await ipc.noteCreate(r.type, r.title, r.created);
        } catch {
          pushAlert(t('convert.failed', { title: r.title }));
          return false;
        }
      }
      return embedTargetFor(h.source, path, r.title);
    },
  };
}
