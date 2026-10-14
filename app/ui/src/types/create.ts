// The one creation path of every entry point (D-232, D-245; FR-TYP-03 AC-12; ms3-shell §14.7.1): ⌘N New object, the
// switcher's create item, `[[` create in the editor, the type page's `New <Name>` and the relation picker's `Create`.
// type_get → type_template → @tegg/doc newObject → note_create(type, title, text). The bytes come from @tegg/doc
// (D-82); the core picks the folder (re-read at the call, FR-TYP-01 AC-5), the file name and indexes it.
import { newObject } from '@tegg/doc';
import { ipc } from '../ipc/client';
import { localIso, ulid } from '../newNote';

/** A type read for creating objects: `create(title)` renders the bytes and sends `note_create` at once. */
export type Prepared = { key: string; create: (title: string) => Promise<string /* path */> };

/** The first two steps of the path (type_get, type_template), for an entry point that knows its type in advance. */
export async function prepareObject(typeKey: string): Promise<Prepared> {
  const key = typeKey.normalize('NFC');
  const type = await ipc.typeGet(key);
  const tpl = await ipc.typeTemplate(key).catch(() => null);
  const review = (type?.review === 'on' || type?.review === 'locked' ? type.review : 'off') as 'off' | 'on' | 'locked';
  const k = type?.key ?? key;
  return {
    key: k,
    create: (title: string) => {
      const clean = title.normalize('NFC').trim();
      const text = newObject({
        type: { key: k, attributes: (type?.attributes ?? []).map((a) => ({ key: a.key, type: a.type, default: a.default ?? undefined })), review },
        title: clean,
        template: tpl ? tpl.text : null,
        now: localIso(new Date(Date.now())),
        newId: () => ulid(Date.now()),
      });
      return ipc.noteCreate(k, clean, text);
    },
  };
}

export async function createObject(typeKey: string, title: string): Promise<string /* path */> {
  return (await prepareObject(typeKey)).create(title);
}
