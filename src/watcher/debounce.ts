/**
 * Debounce file change events.
 * Batches events over a time window, then calls the handler with all unique paths.
 */
export class ChangeDebouncer {
  private pending = new Set<string>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private handler: (paths: string[]) => void;
  private delayMs: number;

  constructor(handler: (paths: string[]) => void, delayMs: number = 200) {
    this.handler = handler;
    this.delayMs = delayMs;
  }

  add(filePath: string): void {
    this.pending.add(filePath);

    if (this.timer) {
      clearTimeout(this.timer);
    }

    this.timer = setTimeout(() => {
      const paths = Array.from(this.pending);
      this.pending.clear();
      this.timer = null;
      this.handler(paths);
    }, this.delayMs);
  }

  /**
   * Flush any pending changes immediately.
   */
  flush(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.pending.size > 0) {
      const paths = Array.from(this.pending);
      this.pending.clear();
      this.handler(paths);
    }
  }

  /**
   * Cancel pending changes without firing.
   */
  cancel(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.pending.clear();
  }
}
