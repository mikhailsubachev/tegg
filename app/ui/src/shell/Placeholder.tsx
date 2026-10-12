// A TBD page or panel tab (D-116): name, purpose, milestone, requirement IDs and design board. Sends no IPC.
import { t } from '../i18n/catalog';
import { showDue, type RouteDef, type TabDef } from './registry';

export function Placeholder({ def, compact }: { def: RouteDef | TabDef; compact?: boolean }) {
  if (def.status.built) return null;
  const name = t(def.name);
  const route = 'purpose' in def ? def : null;
  return (
    <section className={`placeholder ${compact ? 'compact' : ''}`} role="region" aria-label={name} tabIndex={0}>
      {!compact && <p className="placeholder-name">{name}</p>}
      {route && <p className="placeholder-purpose">{t(route.purpose)}</p>}
      <p className="placeholder-due">{t('due.comingIn', { due: showDue(def.status.due) })}</p>
      <p className="placeholder-reqs">{t('placeholder.reqs', { reqs: def.reqs.join(', ') })}</p>
      {route && <p className="placeholder-design">{route.design ? t('placeholder.design', { board: route.design }) : t('placeholder.noDesign')}</p>}
    </section>
  );
}
