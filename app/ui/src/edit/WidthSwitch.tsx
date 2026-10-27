// Slice PW (docs/acceptance/page-width.md, boards LayoutNormal / LayoutWide; AP-756): the `Page width` radiogroup, in
// the note toolbar and on Settings › Vault. Two radios `Normal` / `Wide` with a roving tabindex: Tab lands on the
// checked one, ←/→ (↑/↓) move the focus and choose, Space or ⏎ choose (FR-SET-02 AC-9, FR-UX-03).
import { useRef } from 'react';
import { t } from '../i18n/catalog';
import { Icon } from '../shell/Icon';

export type PageWidth = 'normal' | 'wide';
export const PAGE_WIDTHS: PageWidth[] = ['normal', 'wide'];
/** AP-754: only the exact value `wide` reads as wide. */
export const pageWidthOf = (v: unknown): PageWidth => (v === 'wide' ? 'wide' : 'normal');

export function WidthSwitch({ value, onChange, commands, label, describedBy, keepFocus = false }: {
  value: PageWidth;
  onChange: (w: PageWidth) => void;
  /** `data-command` prefix: `note.width` or `settings.pageWidth`. */
  commands: string;
  label?: string;
  describedBy?: string;
  /** In the note toolbar a pointer click leaves the focus where it is (the editor's selection stays, FR-SET-02 AC-7). */
  keepFocus?: boolean;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const move = (from: number, delta: number) => {
    const i = (from + delta + PAGE_WIDTHS.length) % PAGE_WIDTHS.length;
    refs.current[i]?.focus();
    onChange(PAGE_WIDTHS[i]);
  };
  return (
    <div role="radiogroup" aria-label={label ?? t('note.width')} aria-describedby={describedBy} className="segmented width-switch">
      {PAGE_WIDTHS.map((w, i) => (
        <button
          key={w}
          ref={(el) => { refs.current[i] = el; }}
          type="button"
          role="radio"
          aria-checked={value === w}
          tabIndex={value === w ? 0 : -1}
          data-command={`${commands}.${w}`}
          onMouseDown={keepFocus ? (e) => e.preventDefault() : undefined}
          onClick={() => onChange(w)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); move(i, 1); }
            else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); move(i, -1); }
            else if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); onChange(w); }
          }}
        >
          <Icon name={`width-${w}`} size={14} />
          <span>{t(`note.width.${w}`)}</span>
        </button>
      ))}
    </div>
  );
}
