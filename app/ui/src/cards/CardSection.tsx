// Type settings' `Card` section (docs/contracts/v1-cards.md §7.5, §8.2; cards.md R214; FR-TYP-11 AC-20…AC-27;
// D-2054, D-2076, D-2097, D-2103…D-2105). The ordered card list (Title first and fixed), `Add property`, `Reset to
// default`, the live example card and the fixed note. Each change is one `type_patch` `card` through the page's serial
// writer, built by `cards/write.ts` from the list as shown (the first write seeds R210's default, D-2076).
import { cardKeys, defaultCard } from '@tegg/schema';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { t } from '../i18n/catalog';
import { typeCardExample } from '../ipc/cards';
import type { CardDataDto, CardExampleDto, TypeDto, TypeOpDto } from '../ipc/types';
import { LucideIcon } from '../icons/LucideIcon';
import { ObjectCard } from './ObjectCard';
import { addChoices, cardAdd, cardDrop, cardMove, cardRemove } from './write';
import './cards.css';

const nfc = (s: string) => s.normalize('NFC');
const fold = (s: string) => s.normalize('NFC').toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').normalize('NFC').trim();
const BUILT_IN_LABEL: Record<string, string> = {
  tags: 'attr.tags', body: 'attr.body', description: 'attr.description', source: 'attr.source', aliases: 'attr.aliases', created: 'attr.created', modified: 'attr.modified',
};

/** A small glyph without `data-icon` (the row's `svg[data-icon]` is the property's own icon only). */
function Glyph({ d }: { d: string }) {
  return (
    <svg className="icon" width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}
const GRIP = 'M9 6h.01M9 12h.01M9 18h.01M15 6h.01M15 12h.01M15 18h.01';
const CROSS = 'M6 6l12 12M18 6L6 18';

export type CardSectionApi = { openAdd(): void; reset(): void; addDisabled(): string | null; resetDisabled(): string | null };

export function CardSection({ type: given, ro, send, apiRef }: {
  type: TypeDto;
  /** A newer or invalid type file (AR-07 AC-3, AC-4). */
  ro: boolean;
  send: (ops: TypeOpDto[], field: string, fieldId?: string) => Promise<boolean>;
  /** The palette's `card.add`, `card.reset` (v1-cards §11). */
  apiRef?: React.MutableRefObject<CardSectionApi | null>;
}) {
  // The list as last changed here while writes are pending (each write builds on it), then the type as written.
  const [local, setLocal] = useState<{ list: string[]; keys: string[]; def: boolean } | null>(null);
  const pending = useRef(0);
  const type: TypeDto = local ? { ...given, cardList: local.list, cardKeys: local.keys, cardDefault: local.def } : given;
  const attrs = type.attributes;
  const nameOf = (k: string) => {
    const a = attrs.find((x) => nfc(x.key) === nfc(k));
    return a ? a.name : BUILT_IN_LABEL[k] ? t(BUILT_IN_LABEL[k]) : k;
  };
  const kindOf = (k: string) => {
    if (k === 'tags') return 'tags';
    if (k === 'body' || k === 'description') return 'text';
    if (k === 'created' || k === 'modified') return 'date';
    if (k === 'source') return 'link';
    const a = attrs.find((x) => nfc(x.key) === nfc(k));
    return a && (a.type === 'relation' || a.type === 'url') ? 'link' : 'pill';
  };
  const reason = type.state === 'newer' ? t('ts.newer') : ro ? t('typePage.columnsInvalid')
    : type.cardUnreadable ? t('typeSettings.cardUnreadable', { file: `.tegg/types/${type.key}.yml` }) : null;
  const off = reason !== null;
  const choices = addChoices(type);
  const allAdded = choices.attributes.length + choices.builtIns.length === 0;
  const addReason = reason ?? (allAdded ? t('typeSettings.cardAllAdded') : null);
  const resetReason = reason ?? (type.cardDefault ? t('typeSettings.cardIsDefault') : null);

  const [adding, setAdding] = useState(false);
  const addBtn = useRef<HTMLButtonElement | null>(null);
  const focusKey = useRef<string | null>(null);
  const [live, setLive] = useState<{ text: string; seq: number } | null>(null);
  useLayoutEffect(() => {
    const k = focusKey.current;
    if (!k) return;
    focusKey.current = null;
    (document.querySelector(`[data-card-handle="${CSS.escape(k)}"]`) as HTMLElement | null)?.focus();
  });

  /** One write of `list` (optimistic: the list, its keys and the example follow at once). */
  const write = (list: string[] | null) => {
    if (off) return;
    const shown = list ?? defaultCard(type);
    setLocal({ list: shown, keys: cardKeys(type, shown), def: list === null });
    pending.current++;
    void send([{ op: 'card', keys: list === null ? null : list.map(nfc) }], t('typeSettings.card'), 'card')
      .finally(() => { if (--pending.current === 0) setLocal(null); });
  };
  const move = (key: string, delta: -1 | 1) => {
    const next = cardMove(type, key, delta);
    if (!next || off) return;
    focusKey.current = key;
    write(next);
    const pos = cardKeys(type, next).indexOf(nfc(key)) + 1;
    setLive((l) => ({ text: t('typeSettings.cardMoved', { name: nameOf(key), position: pos }), seq: (l?.seq ?? 0) + 1 }));
  };
  const reset = () => { if (!resetReason) write(null); };
  const openAdd = () => { if (!addReason) setAdding(true); };
  if (apiRef) apiRef.current = { openAdd: () => { addBtn.current?.focus(); openAdd(); }, reset, addDisabled: () => addReason, resetDisabled: () => resetReason };

  // ---- drag (> 4 px moves; nothing drops above Title)
  const listRef = useRef<HTMLUListElement | null>(null);
  const [drag, setDrag] = useState<{ key: string; before: string | null } | null>(null);
  const startDrag = (key: string) => (e: React.MouseEvent) => {
    if (off || e.button !== 0) return;
    const y0 = e.clientY;
    let started = false;
    let before: string | null = null;
    const beforeAt = (y: number): string | null => {
      const rows = [...(listRef.current?.querySelectorAll<HTMLElement>('li[data-card-key]') ?? [])].filter((r) => r.dataset.cardKey !== 'title' && r.dataset.cardKey !== key);
      for (const r of rows) {
        const b = r.getBoundingClientRect();
        if (y < b.top + b.height / 2) return r.dataset.cardKey ?? null;
      }
      return null;
    };
    const onMove = (ev: MouseEvent) => {
      if (!started && Math.abs(ev.clientY - y0) <= 4) return;
      started = true;
      before = beforeAt(ev.clientY);
      setDrag({ key, before });
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove, true);
      window.removeEventListener('mouseup', onUp, true);
      window.removeEventListener('keydown', onEsc, true);
      setDrag(null);
      if (!started) return;
      const next = cardDrop(type, key, before);
      if (next.join('\n') !== type.cardList.map(nfc).join('\n')) { focusKey.current = key; write(next); }
    };
    const onEsc = (ev: KeyboardEvent) => {
      if (ev.key !== 'Escape') return;
      started = false;
      onUp();
    };
    window.addEventListener('mousemove', onMove, true);
    window.addEventListener('mouseup', onUp, true);
    window.addEventListener('keydown', onEsc, true);
  };

  const rows = type.cardKeys.map(nfc);
  return (
    <section id="ts-card" aria-labelledby="ts-card-h" className="ts-section card-section">
      <h2 id="ts-card-h">{t('typeSettings.card')}</h2>
      <p className="hint">{t('typeSettings.cardHint')}</p>
      <div className="card-section-body">
        <div className="card-section-list">
          <div className="card-section-actions">
            <span className="card-add-wrap">
              <button ref={addBtn} type="button" tabIndex={0} className="text-button" data-command="card.add" aria-haspopup="dialog" aria-expanded={adding}
                aria-disabled={addReason ? 'true' : undefined} aria-description={addReason ?? undefined}
                onClick={() => { if (adding) setAdding(false); else openAdd(); }}>
                {t('typeSettings.cardAdd')}
              </button>
              {adding && (
                <AddPopover type={type} choices={choices} nameOf={nameOf} anchor={addBtn}
                  onClose={(refocus) => { setAdding(false); if (refocus) addBtn.current?.focus(); }}
                  onChoose={(k) => { setAdding(false); addBtn.current?.focus(); write(cardAdd(type, k)); }} />
              )}
            </span>
            <button type="button" tabIndex={0} className="text-button" data-command="card.reset" aria-disabled={resetReason ? 'true' : undefined} aria-description={resetReason ?? undefined}
              onClick={reset}>
              {t('typeSettings.cardReset')}
            </button>
          </div>
          <ul ref={listRef} role="list" aria-label={t('typeSettings.cardList')} className="card-list">
            <li data-card-key="title" className="card-row fixed">
              <span className="card-row-handle placeholder" aria-hidden="true" />
              <span className="card-row-title">{t('typeSettings.cardTitle')}</span>
              <span className="card-kind">{t('typeSettings.cardAlways')}</span>
            </li>
            {rows.map((k) => {
              const a = attrs.find((x) => nfc(x.key) === k);
              const kind = kindOf(k);
              const dropBefore = drag && drag.before === k && drag.key !== k;
              return (
                <li key={k} data-card-key={k} className={`card-row${drag?.key === k ? ' dragging' : ''}${dropBefore ? ' drop-before' : ''}`}>
                  <span role="button" tabIndex={0} className="card-row-handle" data-card-handle={k} data-command="card.move" aria-label={t('typeSettings.cardDrag', { name: nameOf(k) })}
                    aria-disabled={off || undefined} aria-description={reason ?? undefined}
                    onMouseDown={startDrag(k)}
                    onKeyDown={(e) => {
                      if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
                      e.preventDefault();
                      e.stopPropagation();
                      move(k, e.key === 'ArrowUp' ? -1 : 1);
                    }}>
                    <Glyph d={GRIP} />
                  </span>
                  <span className="card-row-icon">{a?.resolvedIcon ? <LucideIcon icon={a.resolvedIcon} dataIcon={a.icon ?? a.resolvedIcon.name} size={14} /> : null}</span>
                  <span className="card-name" data-user-content={a ? '' : undefined}>{nameOf(k)}</span>
                  <span className="card-kind">{t(`typeSettings.cardKind.${kind}`)}</span>
                  <button type="button" tabIndex={0} className="icon-button small card-row-remove" data-command="card.remove" aria-label={t('typeSettings.cardRemove', { name: nameOf(k) })}
                    aria-disabled={off || undefined} aria-description={reason ?? undefined}
                    onClick={() => { if (!off) write(cardRemove(type, k)); }}>
                    <Glyph d={CROSS} />
                  </button>
                </li>
              );
            })}
            {drag && drag.before === null && <li className="card-drop-end" aria-hidden="true" />}
          </ul>
          {type.cardIgnored.length > 0 && (
            <p role="status" className="hint warn card-unknown">{t('typeSettings.cardUnknown', { type: type.name, keys: type.cardIgnored.join(', ') })}</p>
          )}
          <p className="hint card-fixed">{t('typeSettings.cardFixed')}</p>
        </div>
        <Example type={type} />
      </div>
      <div className="sr-live" role="status" aria-live="polite">{live ? <span key={live.seq}>{live.text}</span> : null}</div>
    </section>
  );
}

/** R214's example (AP-1591): the most recently modified object's card, inert; one read when the section opens. */
function Example({ type }: { type: TypeDto }) {
  const [ex, setEx] = useState<CardExampleDto | null | undefined>(undefined);
  // One read when the section opens (also under StrictMode's second effect run), none per change.
  const read = useRef<Promise<CardExampleDto | null> | null>(null);
  useEffect(() => {
    let live = true;
    read.current ??= typeCardExample(type.key).catch(() => null);
    read.current.then((x) => { if (live) setEx(x ?? null); });
    return () => { live = false; };
  }, [type.key]);
  const card: CardDataDto | null = useMemo(() => {
    if (ex === undefined) return null;
    if (ex) return { ...ex.card, keys: type.cardKeys };
    return { type: type.key, title: type.name, keys: [], values: {}, excerpt: null, links: [], unreviewed: false, file: null };
  }, [ex, type]);
  return (
    <div role="region" aria-label={t('typeSettings.cardExample')} className="card-example">
      {card && (
        <ObjectCard path={ex?.path ?? ''} card={card} type={type} surface="example"
          note={ex ? undefined : t('typeSettings.cardExampleEmpty', { plural: type.plural })} />
      )}
    </div>
  );
}

function AddPopover({ type, choices, nameOf, anchor, onChoose, onClose }: {
  type: TypeDto;
  choices: { attributes: string[]; builtIns: string[] };
  nameOf: (k: string) => string;
  anchor: React.RefObject<HTMLButtonElement | null>;
  onChoose: (key: string) => void;
  onClose: (refocus: boolean) => void;
}) {
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const ref = useRef<HTMLDivElement | null>(null);
  const input = useRef<HTMLInputElement | null>(null);
  useEffect(() => { input.current?.focus(); }, []);
  useEffect(() => {
    const outside = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node) && !anchor.current?.contains(e.target as Node)) onClose(false); };
    document.addEventListener('mousedown', outside, true);
    return () => document.removeEventListener('mousedown', outside, true);
  }, []);
  const f = fold(q);
  const match = (k: string) => !f || fold(nameOf(k)).includes(f);
  const groups = [
    { key: 'type', label: t('typeSettings.cardGroupType', { name: type.name }), keys: choices.attributes.filter(match), user: true },
    { key: 'builtIn', label: t('typeSettings.cardGroupBuiltIn'), keys: choices.builtIns.filter(match), user: false },
  ].filter((g) => g.keys.length > 0);
  const flat = groups.flatMap((g) => g.keys);
  const cur = Math.min(sel, Math.max(0, flat.length - 1));
  const id = (k: string) => `card-add-${[...k].map((c) => c.codePointAt(0)!.toString(36)).join('-')}`;
  return (
    <div ref={ref} role="dialog" aria-label={t('typeSettings.cardAdd')} className="popover card-add-popover"
      onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(true); } }}>
      <input ref={input} type="text" role="combobox" aria-label={t('typeSettings.cardFind')} placeholder={t('typeSettings.cardFind')} aria-expanded="true"
        aria-controls="card-add-list" aria-autocomplete="list" aria-activedescendant={flat[cur] ? id(flat[cur]) : undefined} value={q} spellCheck={false} autoComplete="off"
        className="card-add-find"
        onChange={(e) => { setQ(e.target.value); setSel(0); }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            e.stopPropagation();
            if (flat.length) setSel((cur + (e.key === 'ArrowDown' ? 1 : -1) + flat.length) % flat.length);
          } else if (e.key === 'Enter') {
            e.preventDefault();
            e.stopPropagation();
            if (flat[cur]) onChoose(flat[cur]);
          }
        }} />
      {flat.length > 0 ? (
        <div id="card-add-list" role="listbox" aria-label={t('typeSettings.cardAdd')} className="card-add-list">
          {groups.map((g) => (
            <div key={g.key} role="group" aria-label={g.label}>
              <div className="group-header" aria-hidden="true">{g.label}</div>
              {g.keys.map((k) => (
                <div key={k} id={id(k)} role="option" data-card-key={k} aria-selected={flat[cur] === k} className={`option${flat[cur] === k ? ' selected' : ''}`}
                  onMouseDown={(e) => e.preventDefault()} onMouseEnter={() => setSel(flat.indexOf(k))} onClick={() => onChoose(k)}>
                  <span data-user-content={g.user ? '' : undefined}>{nameOf(k)}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      ) : (
        <p role="status" className="empty">{t('typeSettings.cardNoMatch', { query: q.trim() })}</p>
      )}
    </div>
  );
}
