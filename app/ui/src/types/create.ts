// The one creation path of every entry point (D-232, D-245; FR-TYP-03 AC-12; ms3-shell §14.7.1): ⌘N New object, the
// switcher's create item, `[[` create in the editor, the type page's `New <Name>` and the relation picker's `Create`.
// type_get → type_template → @tegg/doc newObject → note_create(type, title, text). The bytes come from @tegg/doc
// (D-82); the core picks the folder (re-read at the call, FR-TYP-01 AC-5), the file name and indexes it.
import { newObject, type Value } from '@tegg/doc';
import { ipc } from '../ipc/client';
import { localIso, ulid } from '../newNote';

/** A type read for creating objects: `create(title)` renders the bytes and sends `note_create` at once. */
export type Prepared = {
  key: string;
  /** The type's folder when it was read (the planned folder of a draft, D-520). */
  folder: string;
  create: (title: string, values?: [string, Value][]) => Promise<string /* path */>;
  /** The bytes `create` would send, stamped `now` (a draft's text, D-520; ms5-tasks §12.2). */
  render: (title: string, now: string, values?: [string, Value][]) => string;
  /** 5A-2 (ms5-tasks §11.2, D-524): the conversion's create: `body` replaces the template's body; returns the bytes
   *  written too (the conversion's undo deletes the file only while it still has them, D-492). */
  createWithBody: (title: string, values: [string, Value][], body: string) => Promise<{ path: string; text: string }>;
};

/** The first two steps of the path (type_get, type_template), for an entry point that knows its type in advance. */
export async function prepareObject(typeKey: string): Promise<Prepared> {
  const key = typeKey.normalize('NFC');
  const type = await ipc.typeGet(key);
  const tpl = await ipc.typeTemplate(key).catch(() => null);
  const review = (type?.review === 'on' || type?.review === 'locked' ? type.review : 'off') as 'off' | 'on' | 'locked';
  const k = type?.key ?? key;
  const render = (title: string, now: string, values?: [string, Value][], body?: string) => newObject({
    type: { key: k, attributes: (type?.attributes ?? []).map((a) => ({ key: a.key, type: a.type, default: a.default ?? undefined, options: a.options })), review },
    title: title.normalize('NFC').trim(),
    template: tpl ? tpl.text : null,
    now,
    newId: () => ulid(Date.now()),
    values,
    body,
  });
  return {
    key: k,
    folder: type?.folder ?? '',
    create: (title: string, values?: [string, Value][]) => {
      const clean = title.normalize('NFC').trim();
      return ipc.noteCreate(k, clean, render(clean, localIso(new Date(Date.now())), values));
    },
    render: (title: string, now: string, values?: [string, Value][]) => render(title, now, values),
    createWithBody: async (title: string, values: [string, Value][], body: string) => {
      const clean = title.normalize('NFC').trim();
      const text = render(clean, localIso(new Date(Date.now())), values, body);
      return { path: await ipc.noteCreate(k, clean, text), text };
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
  opts: { editor?: { commands: { replaceLink(pos: number, linkText: string): boolean } }; chipPos?: number; picked?: boolean },
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
  const made = await ipc.linkCreate(from, target, plan, text, opts.picked ? key : undefined);
  if (made.rewrite && opts.editor && opts.chipPos !== undefined && !opts.editor.commands.replaceLink(opts.chipPos, made.rewrite)) {
    // The note exists now, but its link couldn't be changed (D-287): say so instead of leaving it broken silently.
    throw Object.assign(new Error('createLink.rewriteFailed'), { kind: 'RewriteFailed', path: made.path });
  }
  return made.path;
}
