// Slice G1 (docs/contracts/v1-graph.md §4; graph.md R109; D-910, D-977): the filter list, which is also the legend:
// Types (`All`, `None`, one checkbox per type in the D-977 order with its swatch, plural name and count), Connections
// (the four kinds with their R108 line sample) and `Size nodes by links`. G3's preset control sits above Types (R119).
// Slice G2 (v1-graph §15.2): the `popover` variant (the right panel's `Depth and filters`) starts with the `Depth`
// radiogroup and ends with the note `graph.panel.filtersNote`; G3's preset row goes after `Depth`.
import { t } from '../i18n/catalog';
import { chipIcon, chipTypes } from '../links/icons';
import { Icon } from '../shell/Icon';
import { typeColour } from './graphModel';
import { region } from '../i18n/collate';
import type { EdgeKindDto } from './types';

export const KINDS: [EdgeKindDto, string][] = [['link', 'graph.kind.links'], ['relation', 'graph.kind.relations'], ['embed', 'graph.kind.embeds'], ['tag', 'graph.kind.tags']];
const SAMPLE: Record<EdgeKindDto, { width: number; dash?: string }> = {
  embed: { width: 3 }, relation: { width: 1.5, dash: '5 4' }, link: { width: 1.5 }, tag: { width: 1, dash: '1 3' },
};

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
  /** G3 (R119): the preset control, first in the column. */
  preset?: React.ReactNode;
  /** Slice G2: `popover` adds the `Depth` radiogroup first and the note last. */
  variant?: 'column' | 'popover';
  depth?: 1 | 2 | 3;
  onDepth?: (d: 1 | 2 | 3) => void;
  /** The popover variant: the checked radio, which takes the focus when the popover opens (FR-GRP-02 AC-7). */
  radioRef?: React.RefObject<HTMLButtonElement | null>;
};

const DEPTHS = [1, 2, 3] as const;
/** R114: the popover's `Depth` radiogroup, arrows moving within it and applying at once (FR-GRP-02 AC-7). */
function DepthRadios(p: { depth: 1 | 2 | 3; onDepth: (d: 1 | 2 | 3) => void; radioRef?: React.RefObject<HTMLButtonElement | null> }) {
  const onKey = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    const step = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = DEPTHS[(DEPTHS.indexOf(p.depth) + step + DEPTHS.length) % DEPTHS.length];
    const group = e.currentTarget.parentElement;
    p.onDepth(next);
    requestAnimationFrame(() => group?.querySelector<HTMLButtonElement>(`[data-depth="${next}"]`)?.focus());
  };
  return (
    <div role="radiogroup" aria-label={t('graph.depth')} className="graph-depth graph-depth-radios">
      {DEPTHS.map((d) => (
        <button key={d} type="button" role="radio" data-depth={d} data-command={`graph.depth${d}`} aria-checked={p.depth === d}
          tabIndex={p.depth === d ? 0 : -1} ref={p.depth === d ? p.radioRef : undefined}
          onKeyDown={onKey} onClick={() => p.onDepth(d)}>{d}</button>
      ))}
    </div>
  );
}

function pluralOf(key: string): string {
  const def = chipTypes().find((x) => x.key.normalize('NFC') === key.normalize('NFC'));
  return def?.plural ?? key;
}
const colourOf = (key: string) => typeColour(key, chipTypes());

export function GraphFilters(p: FilterProps) {
  const off = p.disabled ? 'true' : undefined;
  const popover = p.variant === 'popover';
  return (
    <>
      {popover && p.depth && p.onDepth && (
        <div className="graph-popover-depth">
          <span className="graph-popover-label" aria-hidden="true">{t('graph.depth')}</span>
          <DepthRadios depth={p.depth} onDepth={p.onDepth} radioRef={p.radioRef} />
        </div>
      )}
      {p.preset}
      <fieldset className="graph-fieldset" role="group" aria-label={t('graph.types')}>
        <legend>{t('graph.types')}</legend>
        <div className="graph-all-none">
          <button type="button" ref={p.allRef} data-command="graph.types.all" className="link-button" aria-disabled={off} onClick={() => { if (!p.disabled) p.onAll(true); }}>{t('graph.types.all')}</button>
          <button type="button" data-command="graph.types.none" className="link-button" aria-disabled={off} onClick={() => { if (!p.disabled) p.onAll(false); }}>{t('graph.types.none')}</button>
        </div>
        {p.typeCounts.map(([key, count]) => {
          const tag = key === 'tag';
          const colour = tag ? 'gray' : colourOf(key);
          const icon = chipIcon(key);
          return (
            <label key={key} className="graph-type-row" data-user-content>
              <input type="checkbox" data-command="graph.type" checked={!p.hiddenTypes.includes(key)} aria-disabled={off}
                aria-label={`${pluralOf(key)} ${new Intl.NumberFormat(region() ?? 'en-US').format(count)}`}
                onChange={(e) => { if (p.disabled) { e.preventDefault(); return; } p.onType(key, e.currentTarget.checked); }} />
              {tag
                ? <span className="graph-swatch pill" data-swatch="pill" aria-hidden="true" />
                : <span className="graph-swatch" aria-hidden="true" style={{ background: `var(--type-${colour}-bg)`, color: `var(--type-${colour})`, borderColor: `var(--type-${colour})` }}><Icon name={icon.glyph} dataIcon={icon.def} size={12} /></span>}
              <span className="graph-type-name">{pluralOf(key)}</span>
              <span className={`graph-type-count${count === 0 ? ' zero' : ''}`}>{new Intl.NumberFormat(region() ?? 'en-US').format(count)}</span>
            </label>
          );
        })}
      </fieldset>
      <fieldset className="graph-fieldset">
        <legend>{t('graph.connections')}</legend>
        {KINDS.map(([kind, label]) => (
          <label key={kind} className="graph-kind-row">
            <input type="checkbox" data-command={`graph.kind.${kind}`} checked={!p.hiddenKinds.includes(kind)} aria-disabled={off}
              onChange={(e) => { if (p.disabled) { e.preventDefault(); return; } p.onKind(kind, e.currentTarget.checked); }} />
            <svg className="graph-line-sample" width="24" height="8" aria-hidden="true">
              <line x1="1" y1="4" x2="23" y2="4" style={{ strokeWidth: SAMPLE[kind].width, strokeDasharray: SAMPLE[kind].dash ?? 'none' }} />
            </svg>
            <span>{t(label)}</span>
          </label>
        ))}
      </fieldset>
      <label className="graph-size-row">
        <input type="checkbox" data-command="graph.sizeByLinks" checked={p.sizeByLinks} aria-disabled={off}
          onChange={(e) => { if (p.disabled) { e.preventDefault(); return; } p.onSize(e.currentTarget.checked); }} />
        <span>{t('graph.sizeByLinks')}</span>
      </label>
      {popover && <p className="graph-popover-note">{t('graph.panel.filtersNote')}</p>}
    </>
  );
}
