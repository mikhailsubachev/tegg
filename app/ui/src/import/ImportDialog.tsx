// Slice I2 (docs/contracts/v1-import-window.md §3.2…§3.11, §6.3): the Import window, a modal dialog over the frame or
// the chooser (R151). The stepper, the footer, the focus on the heading after every step change with one polite
// announcement, Tab kept inside, Esc per step; the steps 0–3 and 5–7 here, 4a–4c in MappingSteps.tsx.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { t } from '../i18n/catalog';
import { Icon } from '../shell/Icon';
import './import.css';
import { num, plainNum, size, tn } from './format';
import { AttributesStep, DecideStep, TypesStep, attrsRow } from './MappingSteps';
import {
  STEP_LABELS, phaseRows, preview, scanErrorText, spaceCounts, stepNumber, stoppedText, writingStarted, type Step,
} from './model';
import {
  cancelImport, cancelRun, changePlace, chooseDestination, chooseSpace, closeImport, closeList, editName, getImport, go, goBack, goNext, hideImport,
  isOpenVault, keepImporting, openTarget, pickSource, planAgain, quitAnyway, readAgain, setDropArea, setHeadingFocus, startRun, stopReading,
  useImport, type ImportState,
} from './store';

const HEADING = 'import-heading';

function liveHost(): HTMLElement {
  let el = document.getElementById('import-live-host');
  if (!el) {
    el = document.createElement('div');
    el.id = 'import-live-host';
    document.body.prepend(el);
  }
  return el;
}

function headingText(s: ImportState): string {
  if (s.step === '0') return t('import.title');
  if (s.step === '7') return t('import.titleDone');
  if (s.step === '4b') {
    const a = attrsRow();
    return a ? t('import.attrs.title', a.title) : t('import.titleCapacities');
  }
  return t('import.titleCapacities');
}

/** A footer button: unusable ones stay focusable with `aria-disabled` and do nothing (D-130). */
function Btn({ command, label, primary, disabled, busy, description, onClick }: { command: string; label: string; primary?: boolean; disabled?: boolean; busy?: boolean; description?: string; onClick: () => void }) {
  return (
    <button type="button" tabIndex={0} className={primary ? 'primary' : undefined} data-command={command} aria-disabled={disabled || undefined}
      aria-busy={busy || undefined} aria-description={description} onClick={() => { if (!disabled) onClick(); }}>{label}</button>
  );
}

export function ImportDialog() {
  const s = useImport();
  const dialog = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const focusRow = useRef<string | null>(null);
  const [announce, setAnnounce] = useState<{ n: number; text: string } | null>(null);
  const viewKey = `${s.open}|${s.step}|${s.sub.list ?? ''}|${s.sub.attrs ?? ''}`;
  const title = headingText(s);
  const prevStep = useRef<Step | null>(null);

  useEffect(() => {
    setHeadingFocus(() => heading.current?.focus());
    return () => setHeadingFocus(null);
  }, []);
  // The page behind is inert while the window is open (FR-UX-03 AC-44).
  useLayoutEffect(() => {
    const root = document.getElementById('root') as (HTMLElement & { inert?: boolean }) | null;
    if (!root) return;
    root.inert = s.open || s.quitAsk;
    return () => { root.inert = false; };
  }, [s.open, s.quitAsk]);
  // After every step change: the focus on the heading and one announcement; back from 4b on the row's status button.
  useEffect(() => {
    if (!s.open) { prevStep.current = null; return; }
    const from = prevStep.current;
    prevStep.current = s.step;
    if (from === '4b' && s.step === '4a' && focusRow.current) {
      const id = focusRow.current;
      (dialog.current?.querySelector<HTMLElement>(`button[data-command="import.mapAttributes"][data-row="${CSS.escape(id)}"]`) ?? heading.current)?.focus();
    } else heading.current?.focus();
    setAnnounce((a) => ({ n: (a?.n ?? 0) + 1, text: title }));
  }, [viewKey]);
  useEffect(() => { setDropArea(() => dialog.current?.querySelector<HTMLElement>('div.import-drop') ?? null); return () => setDropArea(null); }, []);
  // A key whose focus left the dialog (WebKit doesn't focus a checkbox or a button on a click, so the focus can sit on
  // the body) still acts on the window: Esc and Tab as inside it (FR-UX-03 AC-44).
  const keyRef = useRef<(e: KeyboardEvent) => void>(() => {});
  useEffect(() => {
    const f = (e: KeyboardEvent) => {
      if (e.defaultPrevented || !getImport().open) return;
      const tg = e.target as Element | null;
      if (tg && (tg.closest?.('[data-import-step]') || tg.closest?.('[role="menu"]') || tg.closest?.('[role="dialog"]'))) return;
      keyRef.current(e);
    };
    window.addEventListener('keydown', f);
    return () => window.removeEventListener('keydown', f);
  }, []);

  const live = createPortal(<div className="sr-live" role="status" aria-live="polite">{announce ? <span key={announce.n}>{announce.text}</span> : null}</div>, liveHost());
  if (!s.open) return <>{live}{s.quitAsk && <QuitQuestion />}</>;

  const n = stepNumber(s.step);
  const onKeyDown = (e: React.KeyboardEvent | KeyboardEvent) => {
    if (e.defaultPrevented) return;
    if (e.key === 'Tab') {
      const list = [...(dialog.current?.querySelectorAll<HTMLElement>('button, input, [tabindex="0"]') ?? [])]
        .filter((el) => el.tabIndex >= 0 && !(el as HTMLButtonElement).disabled && el.getClientRects().length > 0 && !el.closest('[role="menu"]'));
      if (!list.length) return;
      e.preventDefault();
      const i = list.indexOf(document.activeElement as HTMLElement);
      const next = e.shiftKey ? (i <= 0 ? list.length - 1 : i - 1) : (i < 0 || i === list.length - 1 ? 0 : i + 1);
      list[next].focus();
      return;
    }
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    const st = getImport();
    if (st.step === '4b') go('4a');
    else if (st.step === '4c' && st.sub.list) closeList();
    else if (st.step === '6') { if (st.run?.failure) closeImport(); else hideImport(); }
    else if (st.step === '7') closeImport();
    else cancelImport();
  };

  keyRef.current = onKeyDown;
  return (
    <>
      {live}
      {createPortal(
        <div className="dialog-backdrop import-backdrop">
          <div ref={dialog} role="dialog" aria-modal="true" aria-labelledby={HEADING} data-import-step={s.step} className="dialog import-dialog" onKeyDown={onKeyDown}>
            <h2 id={HEADING} ref={heading} tabIndex={-1}>{title}</h2>
            {n !== null && (
              <div className="import-stepper" role="group" aria-label={t('import.step', { n, total: 6 })}>
                {STEP_LABELS.map((k, i) => (
                  <span key={k} aria-hidden="true" data-current={i + 1 === n ? '' : undefined} data-done={i + 1 < n ? '' : undefined}>{t(k)}</span>
                ))}
              </div>
            )}
            <div className="import-body" aria-busy={s.planSlow || undefined}>
              <Body s={s} focusRow={focusRow} />
            </div>
            <Footer s={s} />
          </div>
        </div>, document.body)}
    </>
  );
}

function Body({ s, focusRow }: { s: ImportState; focusRow: React.MutableRefObject<string | null> }) {
  switch (s.step) {
    case '0': return <StartStep />;
    case '1': return <SourceStep s={s} />;
    case '2': return <SpaceStep s={s} />;
    case '3': return <WhereStep s={s} />;
    case '4a': return <TypesStep headingId={HEADING} focusRow={focusRow} />;
    case '4b': return <AttributesStep />;
    case '4c': return <DecideStep />;
    case '5': return <PreviewStep s={s} />;
    case '6': return <RunStep s={s} />;
    case '7': return <DoneStep s={s} />;
  }
}

// ------------------------------------------------------------------ radio groups (roving tabindex, ↑/↓ move and check)

type RadioDef = { key: string; label: string; ariaLabel?: string; description?: string; disabled?: boolean; id?: string; content: React.ReactNode };
function RadioGroup({ label, items, checked, onCheck, className, after }: { label: string; items: RadioDef[]; checked: string; onCheck: (k: string) => void; className?: string; after?: Record<string, React.ReactNode> }) {
  const ref = useRef<HTMLDivElement>(null);
  const move = (e: React.KeyboardEvent, i: number) => {
    if (!['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight'].includes(e.key)) return;
    e.preventDefault();
    const dir = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : -1;
    const usable = items.map((x, j) => ({ x, j })).filter(({ x }) => !x.disabled);
    if (!usable.length) return;
    const at = usable.findIndex(({ j }) => j === i);
    const to = usable[((at < 0 ? 0 : at) + dir + usable.length) % usable.length];
    ref.current?.querySelectorAll<HTMLElement>('[role="radio"]')[to.j]?.focus();
    onCheck(to.x.key);
  };
  return (
    <div ref={ref} role="radiogroup" aria-label={label} className={className}>
      {items.map((x, i) => (
        <div key={x.key} className={`import-radio-row${x.key === checked ? ' checked' : ''}${x.disabled ? ' disabled' : ''}`}>
          <button type="button" role="radio" id={x.id} aria-checked={x.key === checked} aria-disabled={x.disabled || undefined} aria-label={x.ariaLabel}
            aria-description={x.description} tabIndex={x.key === checked ? 0 : -1} className="import-radio"
            onClick={() => { if (!x.disabled) onCheck(x.key); }} onKeyDown={(e) => move(e, i)}>
            <span className="import-radio-mark" aria-hidden="true" />
            {x.content}
          </button>
          {after?.[x.key]}
        </div>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ 0, 1, 2

function StartStep() {
  const later = t('import.source.laterHelp');
  return (
    <RadioGroup label={t('import.source.group')} checked="capacities" onCheck={() => {}} className="import-sources" items={[
      { key: 'capacities', label: t('import.source.capacities'), description: t('import.source.capacitiesHelp'),
        content: <span className="import-radio-text"><span className="import-radio-label">{t('import.source.capacities')}</span><span className="import-help">{t('import.source.capacitiesHelp')}</span></span> },
      { key: 'obsidian', label: t('import.source.obsidian'), disabled: true, ariaLabel: t('import.source.obsidian'), description: `${t('import.source.obsidianHelp')} ${later}`,
        content: <span className="import-radio-text"><span className="import-radio-label">{t('import.source.obsidian')} <span className="badge">{t('import.source.later')}</span></span><span className="import-help">{t('import.source.obsidianHelp')}</span></span> },
      { key: 'notion', label: t('import.source.notionAnytype'), disabled: true, ariaLabel: t('import.source.notionAnytype'), description: later,
        content: <span className="import-radio-text"><span className="import-radio-label">{t('import.source.notionAnytype')} <span className="badge">{t('import.source.later')}</span></span></span> },
    ]} />
  );
}

function SourceStep({ s }: { s: ImportState }) {
  const reading = s.reading;
  return (
    <>
      <div className="import-drop" role="group" aria-label={t('import.drop')}>
        <p className="import-drop-title">{t('import.drop')}</p>
        <p className="import-help">{t('import.dropHelp')}</p>
        <div className="import-drop-buttons">
          <button type="button" tabIndex={0} data-command="import.chooseZip" onClick={() => void pickSource('zip')}>{t('import.chooseZip')}</button>
          <button type="button" tabIndex={0} data-command="import.chooseFolder" onClick={() => void pickSource('folder')}>{t('import.chooseFolder')}</button>
        </div>
      </div>
      {s.source && (
        <div className="import-source">
          <Icon name={s.scan?.kind === 'folder' ? 'folder' : 'file'} />
          <span className="import-source-name">{s.source.name}</span>
          {s.scan?.kind === 'zip' && s.scan.size !== null && <span className="import-source-size">{size(s.scan.size)}</span>}
        </div>
      )}
      {reading && (
        <div className="import-reading">
          <div role="progressbar" aria-label={t('import.readingName')} aria-valuemin={0} aria-valuemax={reading.total} aria-valuenow={reading.done}
            aria-valuetext={t('import.reading', { done: reading.done, total: reading.total }, plainNum)} className="import-progress">
            <span style={{ width: `${reading.total ? Math.round((reading.done / reading.total) * 100) : 0}%` }} />
          </div>
          <span className="import-reading-text">{t('import.reading', { done: reading.done, total: reading.total }, plainNum)}</span>
          <button type="button" tabIndex={0} data-command="import.stop" onClick={stopReading}>{t('import.stop')}</button>
        </div>
      )}
      {s.scanAlert && (
        <div role="alert" className="import-alert">
          {s.scanAlert === 'SourceChanged' ? t('import.error.sourceChanged') : scanErrorText(s.scanAlert)}
          {s.scanAlert === 'SourceChanged' && <button type="button" tabIndex={0} data-command="import.readAgain" onClick={() => void readAgain()}>{t('import.readAgain')}</button>}
        </div>
      )}
      {s.scan && s.scan.unreadable.length > 0 && <p className="import-help">{tn('import.unreadableCount', { count: s.scan.unreadable.length })}</p>}
      <p className="import-help">{t('import.readSafe')}</p>
    </>
  );
}

function SpaceStep({ s }: { s: ImportState }) {
  const spaces = s.scan?.spaces ?? [];
  return (
    <>
      <p>{tn('import.spaces', { count: spaces.length })}</p>
      <RadioGroup label={t('import.space.group')} checked={s.space ?? spaces[0]?.name ?? ''} onCheck={chooseSpace} className="import-spaces"
        items={spaces.map((x) => ({ key: x.name, label: x.name, ariaLabel: x.name, description: spaceCounts(x),
          content: <span className="import-radio-text"><span className="import-radio-label">{x.name}</span><span className="import-help" aria-hidden="true">{spaceCounts(x)}</span></span> }))} />
      <p className="import-help">{t('import.space.hint')}</p>
    </>
  );
}

// ------------------------------------------------------------------ 3

function problemText(p: string | null, name: string): string | null {
  if (p === 'targetExists') return t('import.error.targetExists', { name });
  if (p === 'targetNotWritable') return t('import.error.targetNotWritable');
  if (p === 'targetInsideVault' || p === 'targetInsideSource') return t('import.error.targetInside');
  return null;
}
function WhereStep({ s }: { s: ImportState }) {
  const nv = s.newVault;
  const cur = s.where?.current ?? null;
  const repeat = cur && cur.alreadyImported > 0 ? tn('import.where.repeat', { count: cur.alreadyImported }) : null;
  const pText = nv ? problemText(nv.problem, nv.name || s.nameText) : null;
  const newHelp = t('import.where.newHelp');
  const curHelp = cur ? tn('import.where.currentHelp', { count: cur.notes }) : '';
  const items: RadioDef[] = [{
    key: 'new', id: 'import-where-new', label: t('import.where.new'), ariaLabel: `${t('import.where.new')}, ${t('import.where.recommended')}`,
    description: [newHelp, nv ? `${nv.name}, ${nv.display}` : ''].filter(Boolean).join(' '),
    content: <span className="import-radio-label">{t('import.where.new')} <span className="badge import-badge-rec">{t('import.where.recommended')}</span></span>,
  }];
  if (cur) {
    items.push({
      key: 'existing', id: 'import-where-current', label: t('import.where.current', { vault: cur.name }), ariaLabel: t('import.where.current', { vault: cur.name }),
      description: [s.where ? curHelp : '', repeat ?? ''].filter(Boolean).join(' '),
      content: <span className="import-radio-label">{t('import.where.current', { vault: cur.name })}</span>,
    });
  }
  const after: Record<string, React.ReactNode> = {
    new: (
      <div className="import-where-detail">
        <p className="import-help">{newHelp}</p>
        {nv && (
          <>
            <input type="text" className="import-name" aria-labelledby="import-where-new" aria-invalid={nv.problem === 'invalidName' || undefined}
              value={s.nameText} spellCheck={false} autoComplete="off" onChange={(e) => editName(e.target.value)} />
            <div className="import-path-line">
              <span className="import-path">{nv.display}</span>
              <button type="button" tabIndex={0} data-command="import.changePlace" onClick={() => void changePlace()}>{t('import.where.change')}</button>
            </div>
            {pText && <p className="import-problem">{pText}</p>}
          </>
        )}
      </div>
    ),
    ...(cur ? {
      existing: (
        <div className="import-where-detail">
          <p className="import-help">{curHelp}</p>
          {repeat && <p className="import-warning">{repeat}</p>}
        </div>
      ),
    } : {}),
  };
  return (
    <>
      <RadioGroup label={t('import.where.group')} checked={s.destination} onCheck={(k) => chooseDestination(k as 'new' | 'existing')} items={items} after={after} className="import-where" />
      {s.alert && <div role="alert" className="import-alert">{s.alert}</div>}
    </>
  );
}

// ------------------------------------------------------------------ 5

function PreviewStep({ s }: { s: ImportState }) {
  const r = s.planResult;
  if (!r) return null;
  const pv = preview(r.plan, s.given);
  const existing = s.destination === 'existing';
  const row = (label: string, count: string, help?: string) => (
    <div role="group" aria-label={label} className="import-preview-row" key={label}>
      <span className="import-preview-label">{label}</span><span className="import-preview-count">{count}</span>{help && <span className="import-help">{help}</span>}
    </div>
  );
  const will = [
    pv.objects > 0 && row(t('import.preview.objects'), num(pv.objects), t('import.preview.objectsHelp', { types: pv.types, new: pv.newTypes }, num)),
    pv.attachments > 0 && row(t('import.preview.attachments'), num(pv.attachments), t('import.preview.attachmentsHelp')),
    pv.links > 0 && row(t('import.preview.links'), num(pv.links), t('import.preview.linksHelp')),
  ].filter(Boolean);
  const attention = [
    pv.unresolved > 0 && row(t('import.preview.unresolved'), num(pv.unresolved), t('import.preview.unresolvedHelp')),
    pv.stubs > 0 && row(t('import.preview.stubs'), num(pv.stubs), t('import.preview.stubsHelp')),
  ].filter(Boolean);
  const keys = pv.technical.slice(0, 2).join(', ') + (pv.technical.length > 2 ? ', …' : '');
  const left = [
    pv.technical.length > 0 && row(t('import.preview.technical'), tn('import.preview.kinds', { count: pv.technical.length }), keys),
    pv.missing > 0 && row(t('import.preview.missing'), num(pv.missing)),
  ].filter(Boolean);
  const repeat = existing && r.plan.alreadyImported > 0 ? tn('import.where.repeat', { count: r.plan.alreadyImported }) : null;
  return (
    <>
      {will.length > 0 && <section className="import-preview"><h3>{t('import.preview.will')}</h3>{will}</section>}
      {attention.length > 0 && <section className="import-preview"><h3>{t('import.preview.attention')}</h3>{attention}</section>}
      <section className="import-preview"><h3>{t('import.preview.notExported')}</h3><p className="import-help">{t('import.preview.notExportedList')}</p></section>
      {left.length > 0 && <section className="import-preview"><h3>{t('import.preview.leftOut')}</h3>{left}</section>}
      <p>{existing ? tn('import.preview.nothingCurrent', { count: pv.objects, vault: s.where?.current?.name ?? (r.plan.target.kind === 'existing' ? r.plan.target.name : '') })
        : t('import.preview.nothingNew', { name: s.newVault?.name ?? '' })}</p>
      {r.noSpace && <div role="alert" className="import-alert">{t('import.error.noSpace', { needed: size(r.noSpace.needed), free: size(r.noSpace.free) })}</div>}
      {s.alert && <div role="alert" className="import-alert">{s.alert}</div>}
      {repeat && <p className="import-warning">{repeat}</p>}
    </>
  );
}

// ------------------------------------------------------------------ 6

function RunStep({ s }: { s: ImportState }) {
  const r = s.run;
  if (!r) return null;
  const rows = phaseRows({ target: r.target, backup: r.backup, files: r.files, objects: r.objects, attachments: r.attachments, progress: r.progress, sawBackup: r.sawBackup, final: r.result?.phase === 'done' });
  const stateWord = (st: string) => t(st === 'done' ? 'import.run.stateDone' : st === 'running' ? 'import.run.stateRunning' : 'import.run.statePending');
  return (
    <>
      <ul className="import-phases" aria-label={t('import.run.list')}>
        {rows.map((p) => (
          <li key={p.id} data-phase={p.id} data-state={p.state} aria-label={[p.label, p.count, stateWord(p.state)].filter(Boolean).join(', ')}>
            <span className="import-phase-mark" aria-hidden={p.state !== 'done' || undefined}>
              {p.state === 'done' ? <span role="img" aria-label={t('import.run.stateDone')}><Icon name="check" size={14} /></span> : <span className={`import-phase-dot ${p.state}`} />}
            </span>
            <span className="import-phase-label">{p.label}</span>
            {p.count && <span className="import-phase-count">{p.count}</span>}
          </li>
        ))}
      </ul>
      {r.failure ? <div role="alert" className="import-alert">{stoppedText(r.failure)}</div>
        : <p className="import-help">{r.progress?.queued ? t('import.run.waiting') : t('import.run.note')}</p>}
    </>
  );
}

// ------------------------------------------------------------------ 7

function DoneStep({ s }: { s: ImportState }) {
  const r = s.run;
  if (!r) return null;
  const totals = r.result?.totals;
  const c = r.card;
  const rows: [string, number, string | null][] = [
    [t('import.done.unresolved'), c.unresolved, t('import.done.unresolvedHelp')], [t('import.done.stubs'), c.stubs, null], [t('import.done.ambiguous'), c.ambiguous, null],
    [t('import.done.merged'), c.merged, c.mergedExample ? `${c.mergedExample[0]} → ${c.mergedExample[1]}` : null], [t('import.done.dropped'), c.dropped, null],
  ];
  return (
    <>
      <p className="import-done-count">{tn('import.done.objects', { count: totals?.objects.imported ?? r.objects })}</p>
      <p>{tn('import.done.summary', { attachments: totals?.attachments.imported ?? r.attachments, links: r.links, vault: r.vaultName })}</p>
      {r.target === 'existing' && (r.backup || !!r.result?.backup) && <p className="import-help">{t('import.done.noUndo')}</p>}
      <section className="import-card" aria-labelledby="import-card-title">
        <h3 id="import-card-title">{t('import.done.report', { date: r.reportDate })}</h3>
        {rows.filter(([, n]) => n > 0).map(([label, n, help]) => (
          <div key={label} className="import-preview-row"><span className="import-preview-label">{label}</span><span className="import-preview-count">{num(n)}</span>{help && <span className="import-help">{help}</span>}</div>
        ))}
      </section>
    </>
  );
}

// ------------------------------------------------------------------ the footer (R151)

function Footer({ s }: { s: ImportState }) {
  const back = <Btn command="import.back" label={t('import.back')} onClick={goBack} />;
  const cancel = <Btn command="import.cancel" label={t('import.cancel')} onClick={cancelImport} />;
  const cont = (disabled: boolean, busy = false) => <Btn command="import.continue" label={t('import.continue')} primary disabled={disabled || busy} busy={busy} description={busy ? t('import.planning') : undefined} onClick={goNext} />;
  let buttons: React.ReactNode;
  switch (s.step) {
    case '0': buttons = <>{cancel}{cont(false)}</>; break;
    case '1': buttons = <>{cancel}{cont(!s.scan || !!s.scanAlert || !!s.reading)}</>; break;
    case '2': buttons = <>{back}{cancel}{cont(!s.space)}</>; break;
    case '3': {
      const ready = !!s.where && !!s.planResult && !s.planBusy && s.planFor === (s.destination === 'existing' ? 'existing' : s.newVault ? `new:${s.newVault.parent}/${s.newVault.name}` : null);
      const problem = s.destination === 'new' && (!!s.newVault?.problem || s.checkPending || !s.nameText.trim());
      buttons = <>{back}{cancel}{cont(problem, !ready && !problem)}</>;
      break;
    }
    case '4a': buttons = <>{back}{cancel}{cont(false, s.planBusy && s.planSlow)}</>; break;
    case '4b': buttons = <>
      <Btn command="import.attrsBack" label={t('import.attrs.back')} onClick={() => go('4a')} />
      <Btn command="import.attrsDone" label={t('import.attrs.done')} primary onClick={() => go('4a')} />
    </>; break;
    case '4c': buttons = s.sub.list ? <Btn command="import.listDone" label={t('import.decide.done')} primary onClick={closeList} /> : <>{back}{cancel}{cont(false)}</>; break;
    case '5': {
      const count = s.planResult?.plan.totals.objects.imported ?? 0;
      const off = !s.planResult || s.planBusy || !!s.planResult.noSpace;
      buttons = <>{back}{cancel}<Btn command="import.start" label={tn('import.preview.go', { count })} primary disabled={off} busy={s.planBusy}
        description={s.planBusy ? t('import.planning') : undefined} onClick={() => void startRun()} /></>;
      break;
    }
    case '6': {
      const r = s.run;
      if (r?.failure) {
        const code = r.failure.code;
        buttons = <>
          {(code === 'sourceChanged' || code === 'sourceGone') && !writingStarted(r.progress) && <Btn command="import.readAgain" label={t('import.readAgain')} onClick={() => void readAgain()} />}
          {code === 'targetChanged' && <Btn command="import.planAgain" label={t('import.planAgain')} onClick={planAgain} />}
          <Btn command="import.close" label={t('import.close')} primary onClick={closeImport} />
        </>;
      } else {
        const locked = writingStarted(r?.progress ?? null);
        buttons = <>
          <Btn command="import.cancel" label={t('import.cancel')} disabled={locked} description={locked ? t('import.run.cantStop') : undefined} onClick={cancelRun} />
          <Btn command="import.hide" label={t('import.hide')} primary onClick={hideImport} />
        </>;
      }
      break;
    }
    case '7': buttons = <>
      <Btn command="import.openReport" label={t('import.done.openReport')} onClick={() => void openTarget(true)} />
      {!isOpenVault() && <Btn command="import.openVault" label={t('import.done.openVault')} primary onClick={() => void openTarget(false)} />}
    </>; break;
  }
  return <div className="import-footer">{buttons}</div>;
}

// ------------------------------------------------------------------ the quit question (§6.3)

function QuitQuestion() {
  const s = useImport();
  const keep = useRef<HTMLButtonElement>(null);
  useEffect(() => { keep.current?.focus(); }, []);
  return createPortal(
    <div className="dialog-backdrop">
      <div role="dialog" aria-modal="true" aria-label={t('import.quit.title')} className="dialog import-quit"
        onKeyDown={(e) => {
          if (e.key === 'Escape' || (e.key === 'Enter' && document.activeElement === keep.current)) { e.preventDefault(); e.stopPropagation(); keepImporting(); }
          else if (e.key === 'Tab') { e.preventDefault(); (document.activeElement === keep.current ? keep.current?.nextElementSibling as HTMLElement | null : keep.current)?.focus(); }
        }}>
        <h2>{t('import.quit.title')}</h2>
        {s.run?.target === 'existing' && <p>{t('import.quit.body')}</p>}
        <div className="dialog-buttons">
          <button ref={keep} type="button" className="primary" onClick={keepImporting}>{t('import.quit.keep')}</button>
          <button type="button" onClick={quitAnyway}>{t('quit.anyway')}</button>
        </div>
      </div>
    </div>, document.body);
}
