// The frame (FR-UX-02, docs/contracts/ms3-shell.md §3.7): title bar with one tab, sidebar, context panel.
import logoDark from '../assets/logo-dark.svg';
import logoLight from '../assets/logo-light.svg';
import { PopupMenu, type MenuEntry } from './Menu';
import { vaultColor } from './vaultColor';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { t } from '../i18n/catalog';
import { ipc } from '../ipc/client';
import type { ProgressDto, RecentVaultDto, VaultInfo } from '../ipc/types';
import { Disabled } from './Disabled';
import { Icon, typeIconName } from './Icon';
import { Placeholder } from './Placeholder';
import { PANEL_TABS, SHORTCUTS } from './registry';

const keysOf = (command: string) => t('shortcut.keys', { keys: SHORTCUTS.find((s) => s.command === command)?.keys ?? '' });
import type { Route } from './routes';
import type { TypeEntry } from './types';

/** The resolved theme (`data-theme` on the root, ms3-shell §3.5), following live changes. */
function useResolvedTheme(): 'light' | 'dark' {
  const read = () => (document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');
  const [theme, setTheme] = useState<'light' | 'dark'>(read);
  useEffect(() => {
    const o = new MutationObserver(() => setTheme(read()));
    o.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => o.disconnect();
  }, []);
  return theme;
}

/** D-219: the open vault in the title bar; its menu lists the recent vaults and the vault actions (FR-VLT-01 AC-16). */
export type VaultSwitcherProps = {
  vault: VaultInfo;
  onOpenPath: (path: string) => void;
  onOpenFolder: () => void;
  onCreate: () => void;
  onSettings: () => void;
};

function VaultSwitcher({ vault, onOpenPath, onOpenFolder, onCreate, onSettings }: VaultSwitcherProps) {
  const button = useRef<HTMLButtonElement>(null);
  const [recent, setRecent] = useState<RecentVaultDto[] | null>(null);
  const open = recent !== null;
  const toggle = () => {
    if (open) { setRecent(null); return; }
    ipc.vaultRecent().then((r) => setRecent(r), () => setRecent([]));
  };
  const close = () => setRecent(null);
  const here = vault.path.normalize('NFC');
  const entries: MenuEntry[] = [];
  for (const [i, r] of (recent ?? []).slice(0, 9).entries()) {
    const current = r.path.normalize('NFC') === here;
    entries.push({
      kind: 'radio',
      key: r.path,
      checked: current,
      disabled: !r.exists,
      content: (
        <>
          <span className="vault-dot" aria-hidden="true" style={{ background: `var(--type-${vaultColor(r.path)})` }} />
          <span className="menu-text">
            <span className="menu-title" data-user-content>{r.name}</span>
            <span className="menu-sub" data-user-content>{r.path}</span>
          </span>
          {!r.exists && <span className="menu-note">{t('vault.notFound')}</span>}
          <kbd>{`⌃⌘${i + 1}`}</kbd>
        </>
      ),
      onChoose: () => { close(); if (current) { button.current?.focus(); return; } onOpenPath(r.path); },
    });
  }
  entries.push(
    { kind: 'separator' },
    { kind: 'item', key: 'open', content: <span className="menu-title">{t('cmd.openFolderAsVault')}</span>, onChoose: () => { close(); onOpenFolder(); } },
    { kind: 'item', key: 'create', content: <span className="menu-title">{t('cmd.createVault')}</span>, onChoose: () => { close(); onCreate(); } },
    { kind: 'item', key: 'settings', content: <span className="menu-title">{t('vault.settings')}</span>, onChoose: () => { close(); onSettings(); } },
  );
  return (
    <>
      <button ref={button} tabIndex={0} type="button" className="vault-switcher" aria-label={t('vault.switch', { name: vault.name })}
        aria-haspopup="menu" aria-expanded={open} data-command="vault.switch" onClick={toggle}>
        <span className="vault-dot" aria-hidden="true" style={{ background: `var(--type-${vaultColor(vault.path)})` }} />
        <span className="vault-name" data-user-content>{vault.name}</span>
      </button>
      {open && <PopupMenu label={t('vault.menu')} anchor={button.current} entries={entries} onClose={close} />}
    </>
  );
}

export function TitleBar({ name, icon, progress, onToggleSidebar, canBack, canForward, onBack, onForward, switcher }: {
  switcher?: VaultSwitcherProps;
  name: React.ReactNode;
  icon: string;
  progress: ProgressDto | null;
  onToggleSidebar: () => void;
  canBack: boolean;
  canForward: boolean;
  onBack: () => void;
  onForward: () => void;
}) {
  return (
    <header className="titlebar" data-tauri-drag-region>
      <div className="titlebar-controls">
        <button tabIndex={0} type="button" className="icon-button" aria-label={t('cmd.toggleSidebar')} data-command="view.toggleSidebar" onClick={onToggleSidebar}>
          <Icon name="sidebar" />
        </button>
        {switcher && <VaultSwitcher {...switcher} />}
        {/* FR-NAV-03 (D-165): without history in a direction the button is aria-disabled, with no "Coming in" note. */}
        <button tabIndex={0} type="button" className="icon-button" aria-label={t('ctl.back')} aria-disabled={!canBack || undefined} data-command="nav.back" onClick={() => canBack && onBack()}>
          <Icon name="back" />
        </button>
        <button tabIndex={0} type="button" className="icon-button" aria-label={t('ctl.forward')} aria-disabled={!canForward || undefined} data-command="nav.forward" onClick={() => canForward && onForward()}>
          <Icon name="forward" />
        </button>
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

/** D-220: the logo at the bottom left opens About and Settings (FR-UX-01 AC-5). */
function LogoMenu({ onAbout, onSettings }: { onAbout: () => void; onSettings: () => void }) {
  const button = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const theme = useResolvedTheme();
  return (
    <div className="sidebar-foot">
      <button ref={button} tabIndex={0} type="button" className="logo" aria-label={t('logo.button')} aria-haspopup="menu" aria-expanded={open}
        data-command="app.logoMenu" onClick={() => setOpen((o) => !o)}>
        {/* D-164: the board's mark and wordmark as one image per theme; the button keeps its label. */}
        <img className="logo-img" src={theme === 'dark' ? logoDark : logoLight} alt="" />
      </button>
      {open && (
        <PopupMenu label={t('logo.menu')} anchor={button.current} placement="above" onClose={() => setOpen(false)} entries={[
          { kind: 'item', key: 'about', content: <span className="menu-title">{t('cmd.about')}</span>, onChoose: () => { setOpen(false); button.current?.focus(); onAbout(); } },
          { kind: 'item', key: 'settings', content: <span className="menu-title">{t('logo.settings')}</span>, onChoose: () => { setOpen(false); onSettings(); } },
        ]} />
      )}
    </div>
  );
}

export function Sidebar({ route, types, onGo, onSwitcher, onNewObject, onNewType, onAbout, conflicts = 0 }: {
  onAbout: () => void;
  /** 3D: the New type dialog (FR-TYP-01 AC-1). */
  onNewType: () => void;
  route: Route;
  types: TypeEntry[];
  onGo: (r: Route) => void;
  onSwitcher: () => void;
  onNewObject: () => void;
  /** Open conflicts; the entry shows only while there are some (FR-SYN-04 AC-6, D-177). */
  conflicts?: number;
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
        <div className="sidebar-group">
          {TOP.map(link)}
          {conflicts > 0 && (
            <a tabIndex={0} href="#" className={`entry conflicts-entry ${route.id === 'conflicts' ? 'current' : ''}`} aria-current={route.id === 'conflicts' ? 'page' : undefined}
              data-command="goto.conflicts" onClick={(ev) => { ev.preventDefault(); onGo({ id: 'conflicts' }); }}>
              <Icon name="conflict" />
              <span className="entry-label">{t('route.conflicts')}</span>
              <span className="count">{conflicts}</span>
            </a>
          )}
        </div>
        <div className="section-head">
          <span>{t('frame.types')}</span>
          <button tabIndex={0} type="button" className="icon-button small" aria-label={t('frame.newType')} title={t('frame.newType')} data-command="type.new"
            onClick={(e) => { e.currentTarget.focus(); onNewType(); }}>
            <Icon name="plus" size={14} />
          </button>
        </div>
        <ul className="types" aria-label={t('frame.types')}>
          {types.map((e) => {
            const current = route.id === 'type/<type>' && route.param === e.key;
            return (
              <li key={e.key} aria-description={!e.defined ? t('frame.noTypeDefinition') : e.invalid ? t('frame.invalidType') : undefined}>
                <a
                  href="#"
                  tabIndex={0}
                  className={`entry type-entry ${current ? 'current' : ''}`}
                  aria-current={current ? 'page' : undefined}
                  aria-label={t('frame.typeEntry', { plural: e.plural, count: e.count })}
                  aria-description={!e.defined ? t('frame.noTypeDefinition') : e.invalid ? t('frame.invalidType') : undefined}
                  data-command={`goto.type:${e.key}`}
                  style={{ ['--type' as string]: `var(--type-${e.color || 'gray'})` }}
                  onClick={(ev) => { ev.preventDefault(); onGo({ id: 'type/<type>', param: e.key }); }}
                >
                  <span className="type-icon"><Icon name={typeIconName(e.key, e.icon)} /></span>
                  <span className="entry-label" data-user-content title={e.plural}>
                    {e.plural}
                    {!e.defined && <span className="undefined-mark" aria-hidden="true" title={t('frame.noTypeDefinition')} />}
                    <span className="count">{"\u00a0"}{e.count}</span>
                  </span>
                </a>
              </li>
            );
          })}
        </ul>
        <div className="sidebar-group">{BOTTOM.map(link)}</div>
      </div>
      <LogoMenu onAbout={onAbout} onSettings={() => onGo({ id: 'settings/appearance' })} />
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
