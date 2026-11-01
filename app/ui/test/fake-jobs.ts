// Fake core, MS4 slice 4C rename (docs/contracts/ms4-jobs.md §11). Test code, not product code. Runs in Node so the
// plan and every byte change come from the real `@tegg/doc` (`resolveFrom`, `transform`, D-82); the in-page part of
// fake-core.ts runs the job (progress, hold, skips, live editors, undo).
type Files = Record<string, string>;

const nfc = (s: string) => s.normalize('NFC');
const low = (s: string) => nfc(s).toLowerCase();
let docMod: any = null;
const doc = async () => (docMod ??= await import('@tegg/doc'));

const stemOf = (p: string) => p.split('/').pop()!.replace(/\.md$/i, '');
const folderOf = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
const join = (folder: string, stem: string) => (folder ? `${folder}/${stem}.md` : `${stem}.md`);
const indexed = (p: string) => p.endsWith('.md') && !p.split('/').some((seg, i, a) => i < a.length - 1 && (seg.startsWith('.') || seg === '_templates'));
/** As the fake's `note_create` (FR-FMT-08 rules, simplified). */
const sanitize = (t: string) => nfc(t).replace(/[\\/:*?"<>|#^[\]]/g, ' ').replace(/ {2,}/g, ' ').trim();

export async function handle(cmd: string, args: any, files: Files): Promise<any> {
  const d = await doc();
  if (cmd === 'transform') {
    const r = d.transform(args.source, args.text, args.ops);
    return r.kind === 'bytes' ? r.text : null;
  }
  // One round trip for a whole job's files (a call per file paced the job by the page↔Node latency under load).
  if (cmd === 'transformAll') {
    return (args.items as { source: string; text?: string; ops: unknown[] }[]).map((x) => {
      if (typeof x.text !== 'string') return null;
      const r = d.transform(x.source, x.text, x.ops);
      return r.kind === 'bytes' ? r.text : null;
    });
  }
  if (cmd === 'plan_rename') {
    const path = nfc(args.path);
    const text = files[path];
    if (text === undefined) return { error: 'NotFound' };
    const x = d.extract(text, stemOf(path));
    if (/^type:\s*daily-note\s*$/m.test(text) || path.startsWith('_templates/') || path.startsWith('.trash/')) return { error: 'NotRenamable' };
    const title = nfc(String(args.title).trim());
    const stored = nfc(String(x.title ?? stemOf(path)).trim());
    const fromTitle = nfc(String(args.fromTitle ?? stored).trim()) || stored;
    if (!title || (title === stored && title === fromTitle)) return { noop: true }; // D-394: the autosave may have written it
    const wanted = sanitize(title);
    const own = stemOf(path);
    let stem = wanted;
    if (low(wanted) !== low(own)) {
      const taken = new Set(Object.keys(files).filter((p) => indexed(p) || folderOf(p) === folderOf(path)).map((p) => low(stemOf(p))));
      for (let n = 2; taken.has(low(stem)); n++) stem = `${wanted} (${n})`;
    }
    const toPath = join(folderOf(path), stem);
    const paths = Object.keys(files).filter((p) => p.endsWith('.md') && !p.split('/').some((s) => s.startsWith('.')));
    const op = { op: 'retarget-links', fromPath: path, fromStem: own, fromTitle, toPath, toStem: stem, toTitle: title, paths };
    const linking = paths.filter((p) => p !== path && !p.startsWith('.trash/') && d.transform(p, files[p], [op]).kind === 'bytes').sort();
    return { toPath, op, title, linking };
  }
  return { error: `unknown ${cmd}` };
}
