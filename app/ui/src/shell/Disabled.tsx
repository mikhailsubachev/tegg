// A later-feature control (D-116, D-130): aria-disabled so it stays focusable, described "Coming in <due>" with a
// tooltip on hover and focus; activating it does nothing.
import { useId, useState, type ReactNode } from 'react';
import { t } from '../i18n/catalog';
import { CONTROL_COMMANDS } from './commands';
import { DISABLED_CONTROLS, showDue } from './registry';

export function Disabled({ control, vars, children, className, role, ariaLabel }: {
  /** The R3 catalog key of the control. */
  control: string;
  vars?: Record<string, string>;
  children?: ReactNode;
  className?: string;
  role?: string;
  ariaLabel?: string;
}) {
  const def = DISABLED_CONTROLS.find((c) => c.label === control)!;
  const [tip, setTip] = useState(false);
  const id = useId();
  const desc = t('due.comingIn', { due: showDue(def.due) });
  const swallow = (e: React.SyntheticEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };
  return (
    <span className="disabled-wrap" onMouseEnter={() => setTip(true)} onMouseLeave={() => setTip(false)}>
      <button tabIndex={0}
        type="button"
        role={role}
        className={`disabled ${className ?? ''}`}
        aria-disabled="true"
        aria-checked={role === 'radio' ? false : undefined}
        aria-label={ariaLabel}
        aria-description={desc}
        data-command={CONTROL_COMMANDS[control]}
        onFocus={() => setTip(true)}
        onBlur={() => setTip(false)}
        onClick={swallow}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') swallow(e);
        }}
      >
        {children ?? t(control, vars)}
      </button>
      {tip && (
        <span role="tooltip" id={id} className="tooltip">
          {desc}
        </span>
      )}
    </span>
  );
}
