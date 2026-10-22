// 5A-1 (D-486): opening a task's source note at the task's embed, from any surface (the Tasks page, the Daily Note's
// Tasks due rows). The shell sets the handler, as it does for date links (daily/open.ts).
let handler: ((source: string, task: string) => void) | null = null;

export function setSourceHandler(h: ((source: string, task: string) => void) | null) {
  handler = h;
}

export function openSourceAt(source: string, task: string): void {
  handler?.(source, task);
}
