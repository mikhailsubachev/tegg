// Slice 6A (docs/contracts/ms6-trash-media.md §6.2; FR-ATT-01 AC-1…AC-3, AC-6, AC-7): paste (bytes → `media_add`),
// drop and picker (`media_add_paths`), then `insertEmbeds` at the caret or drop point as one undo step; refused files
// as `media.refused`, failures as `media.failed` with `Try again`.
import { insertEmbeds } from '@tegg/editor';
import { pastedImageName } from '@tegg/doc';
type EditorView = Parameters<typeof insertEmbeds>[0];
import { t } from '../i18n/catalog';
import { ipc } from '../ipc/client';
import { showAlert } from '../trash/toast';
import { localIso } from '../zone';

export type MediaSource = { kind: 'paste'; files: File[] } | { kind: 'paths'; paths: string[] }
export type MediaTarget = { view: EditorView; owner: { path: string; title: string } | null }

const EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/heic': 'heic', 'image/svg+xml': 'svg', 'application/pdf': 'pdf' };
const baseName = (p: string) => p.replace(/\/+$/, '').split('/').pop() ?? p;

/** Adds the files and inserts their embeds; returns the embed texts inserted. */
export async function addMedia(target: MediaTarget, source: MediaSource, pos?: number): Promise<string[]> {
  const now = localIso(Date.now());
  const date = now.slice(0, 10);
  const embeds: string[] = [];
  const refused = (name: string) => showAlert(t('media.refused', { name }));
  const failed = (name: string, retry: () => void) => showAlert(t('media.failed', { name }), { label: t('save.tryAgain'), run: retry });
  if (source.kind === 'paste') {
    let n = 0;
    for (const f of source.files) {
      const bytes = new Uint8Array(await f.arrayBuffer());
      // R72: a pasted image has no name of its own: `Pasted image <local time>.<ext>`.
      const name = f.type.startsWith('image/') ? pastedImageName(now.slice(0, 19), EXT[f.type] ?? 'png') : f.name || `Pasted file ${n++}`;
      try {
        embeds.push((await ipc.mediaAdd(bytes, name, target.owner, date)).embed);
      } catch (e) {
        const kind = (e as { kind?: string })?.kind;
        if (kind === 'Refused' || kind === 'TooLarge') refused(f.name || name);
        else failed(f.name || name, () => void addMedia(target, { kind: 'paste', files: [f] }, pos));
      }
    }
  } else {
    const results = await ipc.mediaAddPaths(source.paths, target.owner, date).catch(() => source.paths.map((p) => ({ error: 'Io', name: baseName(p) })));
    results.forEach((r, i) => {
      if ('ok' in r) embeds.push(r.ok.embed);
      else if (r.error === 'Refused' || r.error === 'TooLarge') refused(r.name || baseName(source.paths[i]));
      else failed(r.name || baseName(source.paths[i]), () => void addMedia(target, { kind: 'paths', paths: [source.paths[i]] }, pos));
    });
  }
  if (embeds.length) insertEmbeds(target.view, embeds, pos);
  return embeds;
}

/** The system file dialog, then `addMedia` at the caret (FR-ATT-01 AC-3). */
export async function pickMedia(target: MediaTarget, kind: 'any' | 'image' | 'pdf'): Promise<void> {
  const at = target.view.state.selection.from;
  const paths = await ipc.mediaPick(kind).catch(() => [] as string[]);
  if (paths.length) await addMedia(target, { kind: 'paths', paths }, at);
}
