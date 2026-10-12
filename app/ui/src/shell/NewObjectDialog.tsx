// New object (⌘N) before the type picker (D-131): a title and the vault's default type; it creates through the
// same path as the switcher's create item (FR-NAV-01 AC-7, D-106). An empty title can't be created.
import { useEffect, useRef, useState } from 'react';
import { t } from '../i18n/catalog';
import { ipc } from '../ipc/client';
import type { SwitcherItemDto, TypeDefDto } from '../ipc/types';
import { Disabled } from './Disabled';

export function NewObjectDialog({ types, onCreate, onClose }: {
  types: TypeDefDto[];
  onCreate: (item: SwitcherItemDto) => void;
  onClose: () => void;
}) {
  const [title, setTitle] = useState('');
  const [typeKey, setTypeKey] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);
  useEffect(() => {
    // The core's default type is the type of its create item (D-106); limit 0 returns only that item.
    ipc.switcher('?', 0).then((items) => setTypeKey(items.find((i) => i.kind === 'create')?.type ?? null), () => {});
  }, []);
  const typeName = types.find((x) => x.key === typeKey)?.name ?? typeKey ?? '';
  const clean = title.normalize('NFC').trim();

  const create = async () => {
    if (!clean) return;
    const items = await ipc.switcher(clean, 0).catch(() => []);
    const item = items.find((i) => i.kind === 'create');
    if (item) onCreate({ ...item, title: clean });
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
