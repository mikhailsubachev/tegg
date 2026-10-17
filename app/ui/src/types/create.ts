// The one creation path of every entry point (D-232, D-245; FR-TYP-03 AC-12; ms3-shell §14.7.1): ⌘N New object, the
// switcher's create item, `[[` create in the editor, the type page's `New <Name>` and the relation picker's `Create`.
// type_get → type_template → @tegg/doc newObject → note_create(type, title, text). The bytes come from @tegg/doc
// (D-82); the core picks the folder (re-read at the call, FR-TYP-01 AC-5), the file name and indexes it.
import { newObject, type Value } from '@tegg/doc';
import { ipc } from '../ipc/client';
import { localIso, ulid } from '../newNote';

/** A type read for creating objects: `create(title)` renders the bytes and sends `note_create` at once. */
export type Prepared = { key: string; create: (title: string, values?: [string, Value][]) => Promise<string /* path */> };

/** The first two steps of the path (type_get, type_template), for an entry point that knows its type in advance. */
export async function prepareObject(typeKey: string): Promise<Prepared> {
  const key = typeKey.normalize('NFC');
  const type = await ipc.typeGet(key);
  const tpl = await ipc.typeTemplate(key).catch(() => null);
  const review = (type?.review === 'on' || type?.review === 'locked' ? type.review : 'off') as 'off' | 'on' | 'locked';
  const k = type?.key ?? key;
  return {
    key: k,
    create: (title: string, values?: [string, Value][]) => {
      const clean = title.normalize('NFC').trim();
      const text = newObject({
        type: { key: k, attributes: (type?.attributes ?? []).map((a) => ({ key: a.key, type: a.type, default: a.default ?? undefined, options: a.options })), review },
        title: clean,
        template: tpl ? tpl.text : null,
        now: localIso(new Date(Date.now())),
        newId: () => ulid(Date.now()),
        values,
      });
      return ipc.noteCreate(k, clean, text);
    },
  };
}

export async function createObject(typeKey: string, title: string, values?: [string, Value][]): Promise<string /* path */> {
  return (await prepareObject(typeKey)).create(title, values);
}

/** ms4-links §5.3 (D-286, D-287): creates the note a broken link names, by the plan the Create offer showed. Bytes as
 *  `createObject` (D-82); `link_create` re-plans and writes create-exclusive. A plan with a `rewrite` changes the
 *  clicked link through the editor (one undo step); without an editor such a plan is refused and nothing is sent. */
export async function createObjectForLink(
  from: string,
  target: string,
  plan: { state: 'create'; path: string; title: string; type: string; rewrite: string | null },
  opts: { editor?: { commands: { replaceLink(pos: number, linkText: string): boolean } }; chipPos?: number },
): Promise<string> {
  if (plan.rewrite && (!opts.editor || opts.chipPos === undefined)) throw new Error('createLink.needsEdit');
  const key = plan.type.normalize('NFC');
  const type = await ipc.typeGet(key);
  const tpl = await ipc.typeTemplate(key).catch(() => null);
  const review = (type?.review === 'on' || type?.review === 'locked' ? type.review : 'off') as 'off' | 'on' | 'locked';
  const text = newObject({
    type: { key: type?.key ?? key, attributes: (type?.attributes ?? []).map((a) => ({ key: a.key, type: a.type, default: a.default ?? undefined })), review },
    title: plan.title.normalize('NFC').trim(),
    template: tpl ? tpl.text : null,
    now: localIso(new Date(Date.now())),
    newId: () => ulid(Date.now()),
  });
  const made = await ipc.linkCreate(from, target, plan, text);
  if (made.rewrite && opts.editor && opts.chipPos !== undefined && !opts.editor.commands.replaceLink(opts.chipPos, made.rewrite)) {
    // The note exists now, but its link couldn't be changed (D-287): say so instead of leaving it broken silently.
    throw Object.assign(new Error('createLink.rewriteFailed'), { kind: 'RewriteFailed', path: made.path });
  }
  return made.path;
}
