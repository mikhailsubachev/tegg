// Helpers for the slice OC Settings-layout WebKit tests (L5; docs/acceptance/app-shell.md R219, FR-UX-02 AC-22…AC-26;
// docs/contracts/v1-cards.md §7.10, §8.4): starting on a `settings/*` route with the inbox vault (capture.md R58) at its
// clock, and `settingsControls(page)`, which lists every control of the shown route in DOM order (role, accessible name,
// accessible description, value or state, disabled state). The same function recorded
// tests/fixtures/settings/controls-0.5.json from the 0.5.x UI before the restyle (FR-UX-02 AC-24). No AC assertions here.
import type { Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { startMain, type FakeCoreHandle } from './capture-helpers';

export const SETTINGS_ROUTES = ['settings/appearance', 'settings/date-time', 'settings/vault', 'settings/shortcuts', 'settings/menu-bar', 'settings/backups', 'settings/trash-history', 'settings/previews'];
export const SECTION_NAMES = ['Appearance', 'Date & time', 'Vault', 'Shortcuts', 'Menu bar and startup', 'Backups', 'Trash and history', 'Previews'];
export const CONTROLS_05 = resolve(import.meta.dirname, '../../tests/fixtures/settings/controls-0.5.json');

/** Starts the main window on `route` (inbox vault, its clock, region `cs`, 1,440 × 900). */
export async function startSettings(page: Page, route: string, o: { width?: number; height?: number; theme?: 'light' | 'dark' } = {}): Promise<FakeCoreHandle> {
  await page.setViewportSize({ width: o.width ?? 1440, height: o.height ?? 900 });
  await page.addInitScript((r) => { (window as any).__TEGG_ROUTE__ = r; }, route);
  const core = await startMain(page, { theme: o.theme });
  await page.getByRole('main').getByRole('heading', { level: 1 }).first().waitFor({ state: 'visible', timeout: 8000 }).catch(() => undefined);
  return core;
}

export type Control = { role: string; name: string; description: string; value: string | null; disabled: boolean };
/** Every control of the main pane in DOM order (FR-UX-02 AC-24). */
export async function settingsControls(page: Page): Promise<Control[]> {
  return page.getByRole('main').evaluate((root) => {
    const SEL = 'button, a[href], input, select, textarea, [role="button"], [role="link"], [role="switch"], [role="checkbox"], [role="radio"], [role="combobox"], [role="slider"], [role="spinbutton"], [role="tab"], [role="option"], [role="menuitem"], [role="textbox"]';
    const n = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim().normalize('NFC');
    const byIds = (ids: string | null) => n((ids ?? '').split(/\s+/).filter(Boolean).map((id) => document.getElementById(id)?.textContent ?? '').join(' '));
    const roleOf = (e: HTMLElement): string => {
      const r = e.getAttribute('role');
      if (r) return r;
      const t = e.tagName.toLowerCase();
      if (t === 'a') return 'link';
      if (t === 'select') return 'combobox';
      if (t === 'textarea') return 'textbox';
      if (t === 'input') {
        const ty = (e as HTMLInputElement).type;
        return ty === 'checkbox' ? 'checkbox' : ty === 'radio' ? 'radio' : ty === 'range' ? 'slider' : ty === 'number' ? 'spinbutton' : ty === 'button' || ty === 'submit' ? 'button' : 'textbox';
      }
      return t;
    };
    const nameOf = (e: HTMLElement): string => {
      const al = e.getAttribute('aria-label');
      if (al) return n(al);
      const lb = e.getAttribute('aria-labelledby');
      if (lb) return byIds(lb);
      if (e.id) { const l = document.querySelector(`label[for="${CSS.escape(e.id)}"]`); if (l) return n(l.textContent); }
      const wrap = e.closest('label');
      if (wrap) return n(wrap.textContent);
      return n(e.textContent);
    };
    const descOf = (e: HTMLElement) => n(e.getAttribute('aria-description')) || byIds(e.getAttribute('aria-describedby'));
    const valueOf = (e: HTMLElement): string | null => {
      const checked = e.getAttribute('aria-checked') ?? e.getAttribute('aria-pressed') ?? e.getAttribute('aria-selected');
      if (checked !== null) return checked;
      if (e instanceof HTMLInputElement && (e.type === 'checkbox' || e.type === 'radio')) return String(e.checked);
      if (e instanceof HTMLInputElement || e instanceof HTMLSelectElement || e instanceof HTMLTextAreaElement) return e.value;
      const v = e.getAttribute('aria-valuetext') ?? e.getAttribute('aria-valuenow');
      return v;
    };
    const out: { role: string; name: string; description: string; value: string | null; disabled: boolean }[] = [];
    for (const el of root.querySelectorAll(SEL)) {
      const e = el as HTMLElement;
      if (e.getClientRects().length === 0 || e.closest('nav.settings-sections, [aria-hidden="true"]')) continue;
      if (e.matches('input[type="radio"], input[type="checkbox"]') && e.closest('[role="radio"], [role="checkbox"], [role="switch"]')) continue;
      out.push({ role: roleOf(e), name: nameOf(e), description: descOf(e), value: valueOf(e), disabled: (e as HTMLButtonElement).disabled === true || e.getAttribute('aria-disabled') === 'true' });
    }
    return out;
  });
}
export function snapshot05(): Record<string, Control[]> | null {
  try { return JSON.parse(readFileSync(CONTROLS_05, 'utf8')).routes; } catch { return null; }
}
