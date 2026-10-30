// Slice G1 (docs/contracts/v1-graph.md §4; graph.md R109; D-910, D-977): the filter list, which is also the legend:
// Types (`All`, `None`, one checkbox per type in the D-977 order with its swatch, plural name and count), Connections
// (the four kinds with their R108 line sample) and `Size nodes by links`. G3 puts the preset select above Types.
import { t } from '../i18n/catalog';
import { chipIcon, chipTypes } from '../links/icons';
import { Icon } from '../shell/Icon';
import type { EdgeKindDto } from './types';

export const KINDS: [EdgeKindDto, string][] = [['link', 'graph.kind.links'], ['relation', 'graph.kind.relations'], ['embed', 'graph.kind.embeds'], ['tag', 'graph.kind.tags']];
const SAMPLE: Record<EdgeKindDto, { width: number; dash?: string }> = {
  embed: { width: 3 }, relation: { width: 1.5, dash: '5 4' }, link: { width: 1.5 }, tag: { width: 1, dash: '1 3' },
};
const COLORS = new Set(['gray', 'blue', 'green', 'orange', 'purple', 'red', 'teal', 'yellow']);
const SYSTEM_COLOR: Record<string, string> = { page: 'gray', task: 'blue', 'quick-note': 'yellow', 'daily-note': 'purple', image: 'teal', pdf: 'red' };

export type FilterProps = {
  typeCounts: [string, number][];
  hiddenTypes: string[];
  hiddenKinds: EdgeKindDto[];
  sizeByLinks: boolean;
  disabled: boolean;
  onType: (key: string, visible: boolean) => void;
  onAll: (visible: boolean) => void;
  onKind: (kind: EdgeKindDto, visible: boolean) => void;
  onSize: (on: boolean) => void;
  allRef?: React.RefObject<HTMLButtonElement | null>;
};

function pluralOf(key: string): string {
  const def = chipTypes().find((x) => x.key.normalize('NFC') === key.normalize('NFC'));
  return def?.plural ?? key;
}
function colourOf(key: string): string {
  const def = chipTypes().find((x) => x.key.normalize('NFC') === key.normalize('NFC'));
  const c = def?.color ?? SYSTEM_COLOR[key];
  return c && COLORS.has(c) ? c : 'gray';
}

export function GraphFilters(p: FilterProps) {
  const off = p.disabled ? 'true' : undefined;
  return (
    <>
      <fieldset className="graph-fieldset">
        <legend>{t('graph.types')}</legend>
        <div className="graph-all-none">
          <button type="button" ref={p.allRef} className="link-button" aria-disabled={off} onClick={() => { if (!p.disabled) p.onAll(true); }}>{t('graph.types.all')}</button>
          <button type="button" className="link-button" aria-disabled={off} onClick={() => { if (!p.disabled) p.onAll(false); }}>{t('graph.types.none')}</button>
        </div>
        {p.typeCounts.map(([key, count]) => {
          const tag = key === 'tag';
          const colour = tag ? 'gray' : colourOf(key);
          const icon = chipIcon(key);
          return (
            <label key={key} className="graph-type-row" data-user-content>
              <input type="checkbox" checked={!p.hiddenTypes.includes(key)} aria-disabled={off}
                onChange={(e) => { if (p.disabled) { e.preventDefault(); return; } p.onType(key, e.currentTarget.checked); }} />
              {tag
                ? <span className="graph-swatch pill" data-swatch="pill" aria-hidden="true" />
                : <span className="graph-swatch" aria-hidden="true" style={{ background: `var(--type-${colour}-bg)`, color: `var(--type-${colour})`, borderColor: `var(--type-${colour})` }}><Icon name={icon.glyph} dataIcon={icon.def} size={12} /></span>}
              <span className="graph-type-name">{pluralOf(key)}</span>
              <span className={`graph-type-count${count === 0 ? ' zero' : ''}`}>{count}</span>
            </label>
          );
        })}
      </fieldset>
      <fieldset className="graph-fieldset">
        <legend>{t('graph.connections')}</legend>
        {KINDS.map(([kind, label]) => (
          <label key={kind} className="graph-kind-row">
            <input type="checkbox" checked={!p.hiddenKinds.includes(kind)} aria-disabled={off}
              onChange={(e) => { if (p.disabled) { e.preventDefault(); return; } p.onKind(kind, e.currentTarget.checked); }} />
            <svg className="graph-line-sample" width="24" height="8" aria-hidden="true">
              <line x1="1" y1="4" x2="23" y2="4" style={{ strokeWidth: SAMPLE[kind].width, strokeDasharray: SAMPLE[kind].dash ?? 'none' }} />
            </svg>
            <span>{t(label)}</span>
          </label>
        ))}
      </fieldset>
      <label className="graph-size-row">
        <input type="checkbox" checked={p.sizeByLinks} aria-disabled={off}
          onChange={(e) => { if (p.disabled) { e.preventDefault(); return; } p.onSize(e.currentTarget.checked); }} />
        <span>{t('graph.sizeByLinks')}</span>
      </label>
    </>
  );
}
