// Slice I2 (docs/contracts/v1-import-window.md §3.6…§3.8): steps 4a (types), 4b (attributes and values) and 4c (things
// to decide). Every choice edits the given mapping and plans again (§3.5); the controls show the newest plan.
import { useState } from 'react';
import { t } from '../i18n/catalog';
import type { PlannedAttr, PlannedType } from '../ipc/import';
import { ImportMenu, type ImportMenuEntry } from './ImportMenu';
import { num, tn } from './format';
import {
  attrMenu, attrTargetText, attrsSummary, decideRows, isTaskStatus, newTypeNameOk, setAttrTarget, setCaseLink, setMerge, setSplit,
  setStatusValue, setTypeTarget, stateKey, statusText, titleOf, toggleTagLike, typeMenu, typeRows, typesHint, valuesCount, type MenuItemModel,
  type TypeRowModel,
} from './model';
import { editMapping, getImport, openAttrs, openList, useImport } from './store';

type MenuState = { id: string; anchor: HTMLElement } | null;

function toEntries(items: MenuItemModel[], choose: (c: MenuItemModel & { kind: 'radio' }) => void, rename?: { field: string; value: string; valid: (n: string) => boolean; commit: (n: string) => void }): ImportMenuEntry[] {
  return items.map((m): ImportMenuEntry => {
    if (m.kind === 'note') return { kind: 'note', key: 'note', text: m.text };
    if (m.kind === 'rename') return { kind: 'rename', key: m.id, field: rename!.field, value: rename!.value, valid: rename!.valid, onCommit: rename!.commit };
    return { kind: 'radio', key: m.id, text: m.text, checked: m.checked, description: m.description, label: m.description ? m.text : undefined, group: m.group, onChoose: () => choose(m) };
  });
}

// ------------------------------------------------------------------ 4a

export function TypesStep({ headingId, focusRow }: { headingId: string; focusRow: React.MutableRefObject<string | null> }) {
  const s = useImport();
  const [menu, setMenu] = useState<MenuState>(null);
  const r = s.planResult;
  if (!r) return null;
  const tt = r.targetTypes;
  const rows = typeRows(r.plan, tt);
  const hint = typesHint(rows);
  const menuRow = menu ? rows.find((x) => x.id === menu.id) : undefined;
  const ty = menuRow?.types[0];
  return (
    <>
      <table className="import-types" aria-labelledby={headingId}>
        <thead>
          <tr><th scope="col">{t('import.types.colSource')}</th><th scope="col">{t('import.types.colTarget')}</th><th scope="col">{t('import.types.colAttributes')}</th></tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} data-row={row.id}>
              <td><span className="import-folder">{row.folder}</span> <span className="import-count">{num(row.count)}</span></td>
              <td>{row.menu ? (
                <button type="button" tabIndex={0} className="import-target" aria-haspopup="menu" aria-expanded={menu?.id === row.id}
                  onClick={(e) => setMenu(menu?.id === row.id ? null : { id: row.id, anchor: e.currentTarget })}>{row.target}</button>
              ) : <span className="import-target-text">{row.target}</span>}</td>
              <td><StatusCell row={row} focusRow={focusRow} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      {hint && <p className="import-hint">{hint}</p>}
      {menu && ty && menuRow && (
        <ImportMenu label={t('import.types.menu', { source: ty.sourceFolder })} anchor={menu.anchor} onClose={() => setMenu(null)}
          entries={toEntries(typeMenu(ty, s.defaults[ty.sourceType], tt), (m) => editMapping(setTypeTarget(getImport().given, ty.sourceType, m.choose as never), { sourceType: ty.sourceType, attribute: null }), {
            field: t('import.types.renameLabel'),
            value: ty.target.kind === 'new' ? ty.target.name : (s.defaults[ty.sourceType] as { name?: string } | undefined)?.name ?? ty.sourceType,
            valid: (n) => newTypeNameOk(n, r.plan, ty.sourceType, tt),
            commit: (n) => editMapping(setTypeTarget(getImport().given, ty.sourceType, { kind: 'new', name: n.normalize('NFC') }), { sourceType: ty.sourceType, attribute: null }),
          })} />
      )}
    </>
  );
}

function StatusCell({ row, focusRow }: { row: TypeRowModel; focusRow: React.MutableRefObject<string | null> }) {
  if (!row.status) return <span className="import-none">{t('import.types.none')}</span>;
  const open = row.mapped < row.total;
  return (
    <button type="button" tabIndex={0} className="import-status-button" data-command="import.mapAttributes" data-row={row.id}
      aria-label={tn('import.types.statusA11y', { mapped: row.mapped, total: row.total })}
      aria-description={open ? t('import.types.needsLook') : undefined}
      onClick={() => { focusRow.current = row.id; openAttrs(row.id); }}>
      {open && <span className="import-dot" aria-hidden="true" />}
      {statusText(row)}
      <span className="import-chevron" aria-hidden="true"> ›</span>
    </button>
  );
}

// ------------------------------------------------------------------ 4b

export function attrsRow(): { row: TypeRowModel; title: { source: string; target: string } } | null {
  const s = getImport();
  const r = s.planResult;
  if (!r || !s.sub.attrs) return null;
  const row = typeRows(r.plan, r.targetTypes).find((x) => x.id === s.sub.attrs);
  if (!row) return null;
  const names = row.types.map((x) => (x.target.kind === 'new' ? x.target.name : (x.key ? r.targetTypes.find((y) => y.key === x.key)?.name : null) ?? x.name ?? ''));
  return { row, title: { source: row.folder, target: names.join(' · ') } };
}

export function AttributesStep() {
  const s = useImport();
  const [menu, setMenu] = useState<MenuState>(null);
  const [shown, setShown] = useState<Record<string, boolean>>({});
  const r = s.planResult;
  const a = attrsRow();
  if (!r || !a) return null;
  const tt = r.targetTypes;
  const listed = a.row.listed;
  const find = (id: string) => listed.find((l) => `${l.type.sourceType}:${l.attr.sourceKey}` === id.split('|')[0]);
  const m = menu ? find(menu.id) : undefined;
  const entry = (ty: PlannedType, at: PlannedAttr) => ({ sourceType: ty.sourceType, attribute: at.sourceKey });
  const given = () => getImport().given;
  let menuEl: React.ReactNode = null;
  if (menu && m) {
    const [, what, arg] = menu.id.split('|');
    const { type: ty, attr: at } = m;
    if (what === 'target') {
      menuEl = <ImportMenu label={t('import.attrs.menu', { key: at.sourceKey })} anchor={menu.anchor} onClose={() => setMenu(null)}
        entries={toEntries(attrMenu(ty, at, tt), (c) => editMapping(setAttrTarget(given(), ty.sourceType, at.sourceKey, c.choose as never), entry(ty, at)), {
          field: t('import.attrs.renameLabel'), value: at.action === 'new' ? at.name ?? at.sourceKey : at.sourceKey,
          valid: (n) => n.trim() !== '',
          commit: (n) => editMapping(setAttrTarget(given(), ty.sourceType, at.sourceKey, { kind: 'new', name: n.normalize('NFC'), type: at.action === 'new' ? at.type ?? undefined : undefined }), entry(ty, at)),
        })} />;
    } else if (what === 'value') {
      const st = at.statuses.find((x) => x.value === arg);
      const statuses = tt.find((x) => x.key === 'task')?.statuses ?? [];
      menuEl = <ImportMenu label={t('import.attrs.valueMenu', { value: arg === '' ? t('import.attrs.empty') : arg })} anchor={menu.anchor} onClose={() => setMenu(null)}
        entries={statuses.map((x) => ({ kind: 'radio' as const, key: x.label, text: x.label, checked: !!st && st.to === x.label && !st.fallback, onChoose: () => editMapping(setStatusValue(given(), ty.sourceType, at.sourceKey, arg, x.label), entry(ty, at)) }))} />;
    } else if (what === 'keep') {
      const mg = at.merges[Number(arg)];
      menuEl = <ImportMenu label={t('import.attrs.keepMenu')} anchor={menu.anchor} onClose={() => setMenu(null)}
        entries={mg.variants.map((v) => ({ kind: 'radio' as const, key: v, text: v, checked: mg.kept === v, onChoose: () => editMapping(setMerge(given(), ty.sourceType, at.sourceKey, { kind: 'keep', spellings: { [mg.variants[0].trim().toLowerCase()]: v } }), entry(ty, at)) }))} />;
    } else if (what === 'split') {
      const sources = [...r.plan.types.map((x) => x.sourceType)].sort();
      menuEl = <ImportMenu label={t('import.attrs.linksTo', { type: at.split?.to ?? t('import.types.none') })} anchor={menu.anchor} onClose={() => setMenu(null)}
        entries={sources.map((x) => ({ kind: 'radio' as const, key: x, text: x, checked: at.split?.to === x, onChoose: () => editMapping(setSplit(given(), ty.sourceType, at.sourceKey, { on: true, to: x }), entry(ty, at)) }))} />;
    }
  }
  return (
    <>
      <p className="import-summary" aria-live="polite">{attrsSummary(listed)}</p>
      {s.alert && <div role="alert" className="import-alert">{s.alert}</div>}
      <ul className="import-attrs">
        {listed.map(({ type: ty, attr: at }) => {
          const id = `${ty.sourceType}:${at.sourceKey}`;
          const given0 = getImport().given.types?.[ty.sourceType]?.attributes?.[at.sourceKey];
          const count = valuesCount(ty, at);
          const merged = at.merges.length > 0;
          const split = at.split ?? given0?.split ?? null;
          const open = !!shown[id];
          const refused = s.refused?.sourceType === ty.sourceType && s.refused.attribute === at.sourceKey;
          return (
            <li key={id} data-attr={at.sourceKey} className={at.needsLook ? 'needs-look' : ''}>
              <div className="import-attr-line">
                <span className="import-attr-key">{at.sourceKey}</span>
                {at.action === 'consumed' ? <span className="import-attr-target">{attrTargetText(ty, at, tt)}</span> : (
                  <button type="button" tabIndex={0} className="import-target" aria-haspopup="menu" aria-expanded={menu?.id === `${id}|target`} aria-invalid={refused || undefined}
                    onClick={(e) => setMenu({ id: `${id}|target`, anchor: e.currentTarget })}>{attrTargetText(ty, at, tt)}</button>
                )}
                <span className="import-chips">
                  {count > 0 && <button type="button" tabIndex={0} className="import-chip" aria-expanded={open} onClick={() => setShown((x) => ({ ...x, [id]: !open }))}>{tn('import.attrs.values', { count })}</button>}
                  {merged && <button type="button" tabIndex={0} className="import-chip" aria-pressed={given0?.merge?.kind !== 'off'}
                    onClick={() => editMapping(setMerge(getImport().given, ty.sourceType, at.sourceKey, given0?.merge?.kind === 'off' ? null : { kind: 'off' }), entry(ty, at))}>{t('import.attrs.merge')}</button>}
                  {split && <button type="button" tabIndex={0} className="import-chip" aria-pressed={!!split.on}
                    onClick={() => editMapping(setSplit(getImport().given, ty.sourceType, at.sourceKey, { on: !split.on, to: split.to ?? null }), entry(ty, at))}>{t('import.attrs.split')}</button>}
                </span>
              </div>
              {at.merges.map((mg, i) => {
                if (mg.variants.length < 2 || !mg.applied) return null;
                return (
                  <p key={i} className="import-merge-note"><button type="button" tabIndex={0} className="link-button" aria-expanded={menu?.id === `${id}|keep|${i}`}
                    onClick={(e) => setMenu({ id: `${id}|keep|${i}`, anchor: e.currentTarget })}>{t('import.attrs.mergeNote', { a: mg.variants[0], b: mg.variants[1], kept: mg.kept })}</button></p>
                );
              })}
              {split?.on && at.type === 'relation' && (
                <p className="import-split"><button type="button" tabIndex={0} className="link-button" aria-haspopup="menu"
                  onClick={(e) => setMenu({ id: `${id}|split`, anchor: e.currentTarget })}>{t('import.attrs.linksTo', { type: split.to ?? t('import.types.none') })}</button></p>
              )}
              {open && count > 0 && (
                <section className="import-values" aria-labelledby={`values-${id}`}>
                  <h3 id={`values-${id}`}>{t('import.attrs.valuesOf', { key: at.sourceKey })}</h3>
                  <ul>
                    {isTaskStatus(ty, at) ? at.statuses.map((st) => (
                      <li key={st.value}>
                        <span>{`${st.value === '' ? t('import.attrs.empty') : st.value} · ${num(st.count)}`}</span>
                        <button type="button" tabIndex={0} className="import-target" aria-haspopup="menu" aria-expanded={menu?.id === `${id}|value|${st.value}`}
                          onClick={(e) => setMenu({ id: `${id}|value|${st.value}`, anchor: e.currentTarget })}>{`${st.to} · ${t(stateKey(st.state))}`}</button>
                      </li>
                    )) : at.options.map((o) => <li key={o}><span>{o}</span></li>)}
                  </ul>
                </section>
              )}
            </li>
          );
        })}
      </ul>
      {menuEl}
    </>
  );
}

// ------------------------------------------------------------------ 4c

export function DecideStep() {
  const s = useImport();
  const r = s.planResult;
  if (!r) return null;
  const plan = r.plan;
  const d = plan.decisions;
  if (s.sub.list === 'case') {
    return (
      <ul className="import-decide-list" aria-label={t('import.decide.case', { count: d.caseLinks.length }, num)}>
        {d.caseLinks.map((c) => (
          <li key={`${c.note}#${c.n}`}>
            <span className="import-note-title">{titleOf(plan, c.note)}</span>
            <span>{t('import.decide.caseExample', { link: c.written, title: c.candidateTitle })}</span>
            <label className="import-check-label">
              <input type="checkbox" checked={s.given.caseLinks?.find((x) => x.note === c.note && x.target === c.target)?.use ?? c.confirmed}
                onChange={(e) => editMapping(setCaseLink(getImport().given, c.note, c.target, e.target.checked))} />
              {t('import.decide.use')}
            </label>
          </li>
        ))}
      </ul>
    );
  }
  if (s.sub.list === 'ambiguous') {
    return (
      <ul className="import-decide-list" aria-label={t('import.decide.ambiguous', { count: d.ambiguous.length }, num)}>
        {d.ambiguous.map((a) => (
          <li key={`${a.note}#${a.n}`}>
            <span className="import-note-title">{titleOf(plan, a.note)}</span>
            <span>{t('import.decide.ambiguousRow', { link: a.written, title: titleOf(plan, a.chosen) })}</span>
          </li>
        ))}
      </ul>
    );
  }
  const rows = decideRows(plan);
  const selected = d.tagLike.length > 0 && d.tagLike[0].selected;
  return (
    <ul className="import-decide">
      {rows.includes('case') && (
        <li>
          <div><p className="import-decide-title">{tn('import.decide.case', { count: d.caseLinks.length })}</p>
            <p className="import-decide-help">{t('import.decide.caseExample', { link: d.caseLinks[0].written, title: d.caseLinks[0].candidateTitle })}</p></div>
          <button type="button" tabIndex={0} className="import-small" onClick={() => openList('case')}>{t('import.decide.review')}</button>
        </li>
      )}
      {rows.includes('ambiguous') && (
        <li>
          <div><p className="import-decide-title">{tn('import.decide.ambiguous', { count: d.ambiguous.length })}</p>
            <p className="import-decide-help">{t('import.decide.ambiguousHelp')}</p></div>
          <button type="button" tabIndex={0} className="import-small" onClick={() => openList('ambiguous')}>{t('import.decide.info')}</button>
        </li>
      )}
      {rows.includes('tagLike') && (
        <li>
          <div><p className="import-decide-title">{tn('import.decide.tagLike', { count: d.tagLike.length })}</p>
            <p className="import-decide-help">{t('import.decide.tagLikeExample', { key: d.tagLike[0].sourceKey, link: d.tagLike[0].example })}</p></div>
          <button type="button" tabIndex={0} className="import-small" aria-pressed={selected}
            onClick={() => editMapping(toggleTagLike(getImport().given, plan, !selected))}>{t('import.decide.select')}</button>
        </li>
      )}
    </ul>
  );
}
