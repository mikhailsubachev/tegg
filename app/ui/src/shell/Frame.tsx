// The frame (FR-UX-02, docs/contracts/ms3-shell.md §3.7): title bar with one tab, sidebar, context panel.
import { useLayoutEffect, useRef } from 'react';
import { t } from '../i18n/catalog';
import type { ProgressDto } from '../ipc/types';
import { Disabled } from './Disabled';
import { Icon, typeIconName } from './Icon';
import { Placeholder } from './Placeholder';
import { PANEL_TABS, SHORTCUTS } from './registry';

const keysOf = (command: string) => t('shortcut.keys', { keys: SHORTCUTS.find((s) => s.command === command)?.keys ?? '' });
import type { Route } from './routes';
import type { TypeEntry } from './types';

export function TitleBar({ name, icon, progress, onToggleSidebar }: {
  name: React.ReactNode;
  icon: string;
  progress: ProgressDto | null;
  onToggleSidebar: () => void;
}) {
  return (
    <header className="titlebar" data-tauri-drag-region>
      <div className="titlebar-controls">
        <button tabIndex={0} type="button" className="icon-button" aria-label={t('cmd.toggleSidebar')} data-command="view.toggleSidebar" onClick={onToggleSidebar}>
          <Icon name="sidebar" />
        </button>
        <Disabled control="ctl.back" ariaLabel={t('ctl.back')} className="icon-button"><Icon name="back" /></Disabled>
        <Disabled control="ctl.forward" ariaLabel={t('ctl.forward')} className="icon-button"><Icon name="forward" /></Disabled>
      </div>
      <div className="tabs" role="tablist" aria-label={t('frame.tabs')} data-tauri-drag-region>
        <span className="tab" role="tab" aria-selected="true" tabIndex={0} data-command="tab.current">
          <Icon name={icon} />
          <span className="tab-name">{name}</span>
        </span>
        <Disabled control="ctl.newTab" ariaLabel={t('ctl.newTab')} className="icon-button"><Icon name="plus" /></Disabled>
      </div>
      <div className="titlebar-status" data-tauri-drag-region>
        {progress && progress.state === 'running' && (
          <span className="progress" role="status" aria-label={t('progress.label')}>
            <progress max={progress.total || 1} value={progress.done} />
            {t('progress.running', { done: progress.done, total: progress.total })}
          </span>
        )}
        {progress && progress.state === 'cancelled' && (
          <span className="progress" role="status" aria-label={t('progress.label')}>{t('progress.cancelled')}</span>
        )}
      </div>
    </header>
  );
}

type Entry = { id: string; label: string; icon: string; kbd?: string };
// `kbd` holds a command id; its keys are rendered through the catalog at render time.
const TOP: Entry[] = [
  { id: 'home', label: 'route.home', icon: 'home' },
  { id: 'inbox', label: 'route.inbox', icon: 'inbox' },
  { id: 'today', label: 'route.today', icon: 'calendar', kbd: 'goto.today' },
  { id: 'tasks', label: 'route.tasks', icon: 'task' },
];
const BOTTOM: Entry[] = [
  { id: 'tags', label: 'frame.tags', icon: 'tag' },
  { id: 'pinned', label: 'route.pinned', icon: 'pin' },
  { id: 'saved-queries', label: 'route.savedQueries', icon: 'query' },
];

let savedScroll = 0;

export function Sidebar({ route, types, onGo, onSwitcher, onNewObject }: {
  route: Route;
  types: TypeEntry[];
  onGo: (r: Route) => void;
  onSwitcher: () => void;
  onNewObject: () => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    el.scrollTop = savedScroll;
    const save = () => { savedScroll = el.scrollTop; };
    el.addEventListener('scroll', save);
    return () => el.removeEventListener('scroll', save);
  }, []);
  const link = (e: Entry) => {
    const current = route.id === e.id;
    const go = (ev: React.MouseEvent) => { ev.preventDefault(); onGo({ id: e.id }); };
    return (
      <a tabIndex={0} key={e.id} href="#" className={`entry ${current ? 'current' : ''}`} aria-current={current ? 'page' : undefined} data-command={`goto.${e.id}`} onClick={go}>
        <Icon name={e.icon} />
        {e.kbd ? (
          <>
            <span className="entry-label">{t(e.label)}</span>
            <kbd>{keysOf(e.kbd)}</kbd>
          </>
        ) : (
          t(e.label)
        )}
      </a>
    );
  };
  return (
    <nav className="sidebar" aria-label={t('frame.sidebar')}>
      <div className="sidebar-scroll" ref={scroller}>
        <a href="#" tabIndex={0} className="logo" aria-label={t('app.home')} data-command="goto.home" onClick={(e) => { e.preventDefault(); onGo({ id: 'home' }); }}>
          {t('app.name')}
        </a>
        <button tabIndex={0} type="button" className="jump" aria-label={t('frame.searchOrJump')} data-command="app.switcher" onClick={(e) => { e.currentTarget.focus(); onSwitcher(); }}>
          <Icon name="search" />
          <span className="entry-label">{t('frame.searchOrJump')}</span>
          <kbd>{keysOf('app.switcher')}</kbd>
        </button>
        <button tabIndex={0} type="button" className="jump" aria-label={t('cmd.newObject')} data-command="object.new" onClick={(e) => { e.currentTarget.focus(); onNewObject(); }}>
          <Icon name="plus" />
          <span className="entry-label">{t('cmd.newObject')}</span>
          <kbd>{keysOf('object.new')}</kbd>
        </button>
        <div className="sidebar-group">{TOP.map(link)}</div>
        <div className="section-head">
          <span>{t('frame.types')}</span>
          <Disabled control="ctl.newType" ariaLabel={t('ctl.newType')} className="icon-button small"><Icon name="plus" size={14} /></Disabled>
        </div>
        <ul className="types" aria-label={t('frame.types')}>
          {types.map((e) => {
            const current = route.id === 'type/<type>' && route.param === e.key;
            return (
              <li key={e.key}>
                <a
                  href="#"
                  tabIndex={0}
                  className={`entry type-entry ${current ? 'current' : ''}`}
                  aria-current={current ? 'page' : undefined}
                  aria-label={t('frame.typeEntry', { plural: e.plural, count: e.count })}
                  aria-description={e.defined ? undefined : t('frame.noTypeDefinition')}
                  data-command={`goto.type:${e.key}`}
                  style={{ ['--type' as string]: `var(--type-${e.color || 'gray'})` }}
                  onClick={(ev) => { ev.preventDefault(); onGo({ id: 'type/<type>', param: e.key }); }}
                >
                  <span className="type-icon"><Icon name={typeIconName(e.key)} /></span>
                  <span className="entry-label" data-user-content title={e.plural}>
                    {e.plural}
                    {!e.defined && <span className="undefined-mark" aria-hidden="true" title={t('frame.noTypeDefinition')}>?</span>}
                    <span className="count"> {e.count}</span>
                  </span>
                </a>
              </li>
            );
          })}
        </ul>
        <div className="sidebar-group">{BOTTOM.map(link)}</div>
      </div>
    </nav>
  );
}

export function ContextPanel({ tab, onTab }: { tab: string; onTab: (t: 'backlinks' | 'outline' | 'graph') => void }) {
  const current = PANEL_TABS.find((p) => p.id === tab) ?? PANEL_TABS[0];
  return (
    <aside className="context-panel" aria-label={t('frame.contextPanel')}>
      <div className="panel-tabs" role="tablist">
        {PANEL_TABS.map((p) => (
          <button tabIndex={0}
            key={p.id}
            type="button"
            role="tab"
            aria-selected={p.id === current.id}
            className={p.id === current.id ? 'on' : ''}
            data-command={`panel.${p.id}`}
            onClick={(e) => { e.currentTarget.focus(); onTab(p.id); }}
          >
            {t(p.name)}
          </button>
        ))}
      </div>
      <Placeholder def={current} compact />
    </aside>
  );
}
