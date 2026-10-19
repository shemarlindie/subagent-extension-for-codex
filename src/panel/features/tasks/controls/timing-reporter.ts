interface TimingReporterContext {
  closed(): boolean;
  tool<T>(name: string, args: Record<string, unknown>): Promise<T>;
}

/** How long records wait for company before they're sent. */
const FLUSH_DELAY_MS = 5000;
/** Sends at once when this many records wait. The service accepts up to 50. */
const MAX_BATCH = 20;

/**
 * Sends the panel's call durations to the service timing log in background
 * batches. Delivery is best effort: a failed send or a closed panel drops its
 * records, and the reporter never times its own sends.
 */
export class TimingReporter {
  private queue: { operation: string; duration_ms: number }[] = [];
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(private context: TimingReporterContext) {}

  record(operation: string, durationMs: number) {
    if (this.context.closed()) return;
    this.queue.push({ operation, duration_ms: durationMs });

    if (this.queue.length >= MAX_BATCH) this.flush();
    else this.timer ??= setTimeout(() => this.flush(), FLUSH_DELAY_MS);
  }

  private flush() {
    clearTimeout(this.timer);
    this.timer = undefined;
    const records = this.queue.splice(0);
    if (!records.length || this.context.closed()) return;

    this.context.tool("app_record_timing", { records }).catch(() => {});
  }
}
