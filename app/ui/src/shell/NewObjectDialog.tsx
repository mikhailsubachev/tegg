// New object (⌘N) before the type picker (D-131): a title and the vault's default type, or the type of the type page's
// `New <Name>` (FR-TYP-09 AC-6), shown as text (not changeable until FR-VLT-05). It creates through the one creation
// path (FR-TYP-03 AC-12, D-232). An empty title can't be created.
import { useEffect, useRef, useState } from 'react';
import { t } from '../i18n/catalog';
import { ipc } from '../ipc/client';
import type { TypeDefDto } from '../ipc/types';
import { prepareObject, type Prepared } from '../types/create';
import { Disabled } from './Disabled';

export function NewObjectDialog({ types, typeKey: fixedKey, onCreate, onClose }: {
  types: TypeDefDto[];
  /** The type to create; the vault's default type when absent. */
  typeKey?: string;
  /** `prepared`: the type already read (type_get, type_template), so creating sends note_create at once. */
  onCreate: (typeKey: string, title: string, prepared: Prepared | null) => void;
  onClose: () => void;
}) {
  const [title, setTitle] = useState('');
  const [typeKey, setTypeKey] = useState<string | null>(fixedKey ?? null);
  const input = useRef<HTMLInputElement>(null);
  const prepared = useRef<Prepared | null>(null);
  useEffect(() => input.current?.focus(), []);
  useEffect(() => {
    const ready = (key: string) => { prepareObject(key).then((p) => { prepared.current = p; }, () => {}); };
    if (fixedKey) { ready(fixedKey); return; }
    // The core's default type is the type of its create item (D-106); limit 0 returns only that item.
    ipc.switcher('?', 0).then((items) => {
      const key = items.find((i) => i.kind === 'create')?.type ?? null;
      setTypeKey(key);
      if (key) ready(key);
    }, () => {});
  }, []);
  const typeName = types.find((x) => x.key === typeKey)?.name ?? typeKey ?? '';
  const clean = title.normalize('NFC').trim();

  const create = async () => {
    if (!clean) return;
    if (prepared.current) { onCreate(prepared.current.key, clean, prepared.current); return; }
    let key = typeKey;
    if (!key) key = (await ipc.switcher('?', 0).catch(() => [])).find((i) => i.kind === 'create')?.type ?? 'page';
    onCreate(key, clean, null);
  };

  return (
    <div className="overlay" onMouseDown={onClose}>
      <div className="dialog new-object" role="dialog" aria-label={t('newObject.title')} onMouseDown={(e) => e.stopPropagation()}>
        <h2>{t('newObject.title')}</h2>
        <input
          ref={input}
          type="text"
          aria-label={t('newObject.field')}
          placeholder={t('newObject.placeholder')}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void create();
            } else if (e.key === 'Escape') {
              e.preventDefault();
              onClose();
            }
          }}
        />
        <div className="dialog-row">
          <span className="setting-label">{t('newObject.type')}</span>
          <Disabled control="ctl.typePicker" ariaLabel={t('ctl.typePicker')}>
            <span data-user-content>{typeName}</span>
          </Disabled>
        </div>
        <div className="form-actions">
          <button tabIndex={0} type="button" data-command="dialog.cancel" onClick={onClose}>
            {t('newVault.cancel')}
          </button>
          <button tabIndex={0} type="button" className="primary" disabled={!clean} data-command="object.create" onClick={() => void create()}>
            {t('newObject.create')}
          </button>
        </div>
      </div>
    </div>
  );
}
