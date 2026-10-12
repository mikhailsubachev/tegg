// The minimal type page of slice 3A (D-123, FR-TYP-09): the type's objects sorted by title (D-122); rows open the
// note; filter, sort, views and New <Type> wait for 3D; Type settings leads to its placeholder.
import { useEffect, useState } from 'react';
import { t } from '../i18n/catalog';
import { collator } from '../i18n/collate';
import { ipc } from '../ipc/client';
import type { ObjectRowDto } from '../ipc/types';
import { Disabled } from '../shell/Disabled';
import { Icon, typeIconName } from '../shell/Icon';

export function TypePage({ typeKey, plural, name, refresh, heading, onOpen, onSettings }: {
  typeKey: string;
  plural: string;
  name: string;
  refresh: number;
  heading: React.RefObject<HTMLHeadingElement | null>;
  onOpen: (path: string) => void;
  onSettings: () => void;
}) {
  const [rows, setRows] = useState<ObjectRowDto[] | null>(null);
  useEffect(() => {
    let live = true;
    ipc.list(typeKey).then((r) => {
      if (!live) return;
      const c = collator();
      setRows([...r].sort((a, b) => c.compare(a.title, b.title)));
    }, () => live && setRows([]));
    return () => {
      live = false;
    };
  }, [typeKey, refresh]);
  return (
    <div className="page-column">
      <header className="page-header">
        <h1 ref={heading} tabIndex={-1}>
          <span data-user-content>{plural}</span>
        </h1>
        <div className="page-actions">
          <button tabIndex={0} type="button" className="text-button" data-command="typePage.settings" onClick={onSettings}>
            {t('cmd.typeSettings')}
          </button>
          <Disabled control="ctl.newOfType" vars={{ type: name }}>
            {t('ctl.newOfType', { type: '\u0000' }).split('\u0000')[0]}
            <span data-user-content>{name}</span>
            {t('ctl.newOfType', { type: '\u0000' }).split('\u0000')[1]}
          </Disabled>
        </div>
      </header>
      <div className="page-toolbar">
        <Disabled control="ctl.filter" />
        <Disabled control="ctl.sort" />
        <Disabled control="ctl.views" />
      </div>
      {rows && rows.length === 0 && <p className="empty">{t('typePage.empty')}</p>}
      <ul className="object-list" aria-label={t('typePage.list')}>
        {rows?.map((r) => (
          <li
            key={r.path}
            tabIndex={0}
            className="object-row"
            onClick={() => onOpen(r.path)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                onOpen(r.path);
              }
            }}
          >
            <Icon name={typeIconName(typeKey)} />
            <span className="object-title" data-user-content>{r.title}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
