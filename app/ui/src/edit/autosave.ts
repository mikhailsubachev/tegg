// Autosave for one open note (docs/contracts/ms3-shell.md §13.3, D-179): a debounce with a 1 s maximum wait, one
// `note_write` in flight per note with the last known version as base (FR-EDT-08 AC-4…AC-6), paused while a
// composition is open (AC-12), a retry every 5 s after an Io failure (AC-11), and a flush that the page awaits before
// leaving (AC-7). A Conflict or Gone result stops saving until the user chooses (FR-SYN-03 AC-13, AC-17).
import { VerifyError, type TeggEditor } from '@tegg/editor';
import { ipc } from '../ipc/client';
import type { VersionDto } from '../ipc/types';

export type SaveState = 'saved' | 'saving' | 'failed' | 'conflict' | 'readOnly';
export type Failure = 'io' | 'verify' | null;
export type ConflictInfo = { mine: string; theirs: string; theirsVersion: VersionDto };

const IDLE_MS = 300;
const MAX_WAIT_MS = 1000;
const RETRY_MS = 5000;

export class Saver {
  private changes = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private retry: ReturnType<typeof setTimeout> | null = null;
  private firstAt: number | null = null;
  private running: Promise<void> | null = null;
  private blocked = false;
  private disposed = false;
  state: SaveState = 'saved';
  failure: Failure = null;
  /** 4B (ms4-daily §4.1): while a Daily Note is virtual, its first save is this call instead of `note_write`;
   *  it returns the new path and version, and is cleared once it succeeds. */
  create: ((text: string) => Promise<{ path: string; version: VersionDto }>) | null = null;
  /** 4B (D-334): a last change to the saved text (a Daily Note's title fix), applied in the editor too. */
  transform: ((text: string) => string) | null = null;
  /** The document as opened (a virtual note's first write needs a changed document, D-323). */
  private openedDoc: TeggEditor['editor']['state']['doc'];

  constructor(
    public path: string,
    private ed: TeggEditor,
    public base: VersionDto | null,
    private on: {
      state: (s: SaveState, f: Failure) => void;
      conflict: (c: ConflictInfo) => void;
      gone: () => void;
      written: (text: string, v: VersionDto) => void;
    },
    /** True while a typed command is still open (the slash menu's `/query`): not saved until it closes. */
    private paused: () => boolean = () => false,
  ) {
    this.openedDoc = ed.editor.state.doc;
  }

  private set(s: SaveState, f: Failure = null) {
    this.state = s;
    this.failure = f;
    if (!this.disposed) this.on.state(s, f);
  }

  /** The editor content or title changed. */
  changed() {
    this.changes++;
    if (this.blocked) return;
    // A first write that failed is retried on the next keystroke (FR-DLY-02 AC-8).
    if (this.create && this.retry) { clearTimeout(this.retry); this.retry = null; }
    if (this.state !== 'failed') this.set('saving');
    this.schedule();
  }

  get pending(): boolean {
    return this.timer !== null || this.running !== null || this.retry !== null || this.state === 'saving' || this.state === 'failed';
  }

  private schedule() {
    if (this.disposed || this.blocked || this.retry) return;
    const now = Date.now();
    if (this.firstAt === null) this.firstAt = now;
    const wait = Math.max(0, Math.min(IDLE_MS, this.firstAt + MAX_WAIT_MS - now));
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.run();
    }, wait);
  }

  /** Saves now and waits for every write (⌘S, leaving the note, the source toggle). */
  async flush(): Promise<void> {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    if (this.retry) { clearTimeout(this.retry); this.retry = null; }
    if (this.blocked) return;
    await this.run();
    // A change made while the last write was running.
    if (!this.blocked && this.state === 'saving') await this.run();
  }

  private run(): Promise<void> {
    if (this.running) {
      const r = this.running;
      return r.then(() => (this.timer === null && this.state === 'saving' && !this.blocked ? this.run() : undefined));
    }
    this.running = this.writeOnce().finally(() => { this.running = null; });
    return this.running;
  }

  private async writeOnce(): Promise<void> {
    if (this.blocked || this.disposed) return;
    // A composition (dead keys, IME) isn't text yet: wait until it ends (FR-EDT-08 AC-12). The same for an open
    // slash menu, whose `/query` is a command being typed (FR-EDT-03 AC-5).
    if (this.ed.view.composing || this.paused()) {
      this.timer = setTimeout(() => { this.timer = null; void this.run(); }, 150);
      return;
    }
    this.firstAt = null;
    const mark = this.changes;
    let text: string | null;
    try {
      text = await this.ed.save();
    } catch (e) {
      if (e instanceof VerifyError) this.set('failed', 'verify');
      else this.set('failed', 'io');
      return;
    }
    // FR-DLY-02 AC-3: on a virtual Daily Note any change of the document counts (Enter adds an empty block that
    // serializes to the same bytes); a change undone before the save leaves the editor clean and writes nothing (D-323).
    if (text === null && this.create && !this.ed.editor.state.doc.eq(this.openedDoc)) text = this.ed.text();
    if (text === null) {
      if (this.changes === mark) this.set('saved');
      return;
    }
    if (this.transform) {
      const fixed = this.transform(text);
      if (fixed !== text) { this.ed.applyFrontmatter(fixed); text = fixed; }
    }
    const path = this.path;
    try {
      let r: { version: VersionDto };
      if (this.create) {
        const made = await this.create(text);
        this.create = null;
        this.path = made.path;
        r = made;
      } else {
        r = await ipc.noteWrite(path, text, this.base);
      }
      this.base = r.version;
      this.ed.markSaved(text);
      this.on.written(text, r.version);
      if (this.changes === mark) this.set('saved');
      else this.schedule();
    } catch (err) {
      const e = err as { kind?: string; theirs?: string; theirsVersion?: VersionDto };
      if (e.kind === 'Conflict' && e.theirsVersion) {
        this.blocked = true;
        this.set('conflict');
        this.on.conflict({ mine: text, theirs: e.theirs ?? '', theirsVersion: e.theirsVersion });
      } else if (e.kind === 'Gone' || e.kind === 'NotFound') {
        this.blocked = true;
        this.set('conflict');
        this.on.gone();
      } else {
        this.set('failed', 'io');
        if (!this.retry && !this.disposed) {
          this.retry = setTimeout(() => {
            this.retry = null;
            void this.run();
          }, RETRY_MS);
        }
      }
    }
  }

  /** Try again now (the alert's button). */
  retryNow() {
    if (this.retry) { clearTimeout(this.retry); this.retry = null; }
    void this.run();
  }

  /** The user resolved a conflict or a deleted file: saving goes on from `base`. */
  resume(base: VersionDto | null, state: SaveState = 'saved') {
    this.blocked = false;
    this.base = base;
    this.set(state);
  }

  /** Stop saving while the merge dialog or the deleted alert is open (FR-SYN-03 AC-13, AC-17). */
  block() {
    this.blocked = true;
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    if (this.retry) { clearTimeout(this.retry); this.retry = null; }
    this.set('conflict');
  }

  isBlocked() {
    return this.blocked;
  }

  dispose() {
    this.disposed = true;
    if (this.timer) clearTimeout(this.timer);
    if (this.retry) clearTimeout(this.retry);
  }
}
