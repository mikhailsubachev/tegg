// All UI strings in one place for later localization (NFR-OTH-02).
export const strings = {
  'kind.quick-note': 'Quick Note',
  'kind.task': 'Task',
  'capture.saved': 'Saved',
  'capture.empty': 'Nothing to save',
  'capture.error': 'Could not save: {0}',
  'main.none': 'Nothing captured yet.',
} as const;

export const t = (key: keyof typeof strings, ...args: string[]) =>
  args.reduce<string>((s, a, i) => s.replace(`{${i}}`, a), strings[key]);
