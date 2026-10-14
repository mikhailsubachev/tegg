// The Conflicts view (FR-SYN-04, FR-SYN-05; D-177): sync copies and duplicate ids from `index_conflicts`, a read-only
// compare, and the resolutions composed from `note_write` and `note_trash` with version checks (ms3-shell §13.2). The
// file that links resolve to always survives; a stale version never wins (FR-SYN-04 AC-11).
import { useCallback, useEffect, useRef, useState } from 'react';
import { setAttribute, parse } from '@tegg/doc';
import { t } from '../i18n/catalog';
import { events, ipc } from '../ipc/client';
import type { ConflictRowDto, VersionDto } from '../ipc/types';
import { Compare } from '../edit/Compare';
import { ulid } from '../newNote';

type Open = { row: ConflictRowDto; other: string; left: { text: string; v: VersionDto }; right: { text: string; v: VersionDto } };
type Confirm = { title: string; body: string; ok: string; run: () => Promise<void> } | null;

export function ConflictsPage({ heading, onCount }: { heading: React.RefObject<HTMLHeadingElement | null>; onCount?: (n: number) => void }) {
  const [rows, setRows] = useState<ConflictRowDto[] | null>(null);
  const [open, setOpen] = useState<Open | null>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const live = useRef(open);
  live.current = open;

  const reload = useCallback(async () => {
    const r = await ipc.conflicts().catch(() => [] as ConflictRowDto[]);
    setRows(r);
    onCount?.(r.length);
    const o = live.current;
    if (o) {
      const still = r.find((x) => x.primary === o.row.primary && x.others.includes(o.other));
      if (!still) { setOpen(null); setDraft(null); return; }
      await show(still, o.other);
    }
  }, []);

  const show = async (row: ConflictRowDto, other: string) => {
    try {
      const [l, r] = await Promise.all([ipc.noteRead(row.primary), ipc.noteRead(other)]);
      setOpen({ row, other, left: { text: l.text, v: l.version }, right: { text: r.text, v: r.version } });
    } catch {
      setOpen(null);
    }
  };

  useEffect(() => {
    void reload();
    const un = events.changed(() => void reload());
    return () => void un.then((f) => f());
  }, []);

  /** Runs a resolution; a Conflict at any step stops it and reloads the row (FR-SYN-04 AC-11). */
  const resolve = async (f: () => Promise<void>) => {
    try { await f(); } catch { /* the row reloads below */ }
    setOpen(null);
    setDraft(null);
    await reload();
  };

  const keepLeft = (o: Open) => setConfirm({
    title: t('conflicts.trashConfirmTitle'), body: t('conflicts.trashConfirm', { path: o.other }), ok: t('conflicts.move'),
    run: () => resolve(async () => { await ipc.noteTrash(o.other, o.right.v); }),
  });
  const keepRight = (o: Open) => setConfirm({
    title: t('conflicts.trashConfirmTitle'), body: t('conflicts.trashConfirm', { path: o.other }), ok: t('conflicts.move'),
    run: () => resolve(async () => { await ipc.noteWrite(o.row.primary, o.right.text, o.left.v); await ipc.noteTrash(o.other, o.right.v); }),
  });
  const newId = (o: Open) => setConfirm({
    title: t('conflicts.newIdConfirmTitle'), body: t('conflicts.newIdConfirm', { path: o.other }), ok: t('conflicts.newIdOk'),
    run: () => resolve(async () => { await ipc.noteWrite(o.other, setAttribute(parse(o.right.text), 'id', ulid()), o.right.v); }),
  });
  const done = (o: Open) => resolve(async () => {
    await ipc.noteWrite(o.row.primary, draft ?? o.left.text, o.left.v);
    await ipc.noteTrash(o.other, o.right.v);
  });

  const kindText = (k: string) => t(`conflicts.kind.${k}`);
  const base = (p: string) => p.split('/').pop()!;

  return (
    <div className="page-column conflicts-page">
      <h1 ref={heading} tabIndex={-1}>{t('route.conflicts')}</h1>
      {rows !== null && rows.length === 0 && <p className="empty-state">{t('conflicts.empty')}</p>}
      {rows !== null && rows.length > 0 && (
        <ul aria-label={t('conflicts.list')} className="conflict-list">
          {rows.flatMap((r) => r.others.map((o) => (
            <li key={`${r.primary}|${o}`}>
              <a href="#" className={open?.row.primary === r.primary && open.other === o ? 'current' : ''}
                onClick={(e) => { e.preventDefault(); setDraft(null); void show(r, o); }}>
                <span className="kind">{kindText(r.kind)}</span>
                <span data-user-content>{base(r.primary)}</span>
                <span aria-hidden="true">·</span>
                <span data-user-content>{base(o)}</span>
              </a>
            </li>
          )))}
        </ul>
      )}
      {open && draft === null && (
        <div className="conflict-detail">
          <Compare left={open.left.text} right={open.right.text} leftLabel={open.row.primary} rightLabel={open.other} />
          <div className="dialog-buttons">
            <button type="button" onClick={() => keepLeft(open)}>{t('conflicts.keepLeft')}</button>
            <button type="button" onClick={() => keepRight(open)}>{t('conflicts.keepRight')}</button>
            <button type="button" onClick={() => setDraft(open.left.text)}>{t('conflicts.merge')}</button>
            {open.row.kind === 'duplicateId' && <button type="button" onClick={() => newId(open)}>{t('conflicts.newId')}</button>}
          </div>
        </div>
      )}
      {open && draft !== null && (
        <div className="conflict-detail">
          <MergeDraft initial={draft} onChange={setDraft} />
          <div className="dialog-buttons">
            <button type="button" onClick={() => void done(open)}>{t('conflicts.done')}</button>
            <button type="button" onClick={() => setDraft(null)}>{t('conflicts.cancel')}</button>
          </div>
        </div>
      )}
      {confirm && (
        <div className="dialog-backdrop">
          <div role="dialog" aria-modal="true" aria-label={confirm.title} className="dialog"
            onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setConfirm(null); } }}>
            <h2>{confirm.title}</h2>
            <p data-user-content>{confirm.body}</p>
            <div className="dialog-buttons">
              <button type="button" autoFocus onClick={() => setConfirm(null)}>{t('conflicts.cancel')}</button>
              <button type="button" onClick={() => { const c = confirm; setConfirm(null); void c.run(); }}>{confirm.ok}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** The merge draft: plain text, edited in place, written only on Done (D-177). */
function MergeDraft({ initial, onChange }: { initial: string; onChange: (s: string) => void }) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (ref.current) ref.current.textContent = initial;
  }, []);
  return (
    <div ref={ref} role="textbox" aria-multiline="true" aria-label={t('conflicts.draft')} className="merge-draft" data-user-content
      contentEditable="plaintext-only" suppressContentEditableWarning spellCheck={false}
      onInput={(e) => onChange((e.currentTarget as HTMLElement).innerText)} />
  );
}
