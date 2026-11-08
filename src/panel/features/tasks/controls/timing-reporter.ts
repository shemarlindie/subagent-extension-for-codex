import type {
  PanelCallTimingRecord,
  PanelLoadOperation,
  PanelLoadPhase,
  PanelLoadTimingRecord,
  PanelTimingWork,
} from "../../../../shared/tasks/panel-timing";
import {
  PANEL_TIMING_MAX_COUNT,
  PANEL_TIMING_MAX_DURATION_MS,
} from "../../../../shared/tasks/panel-timing";

interface TimingReporterContext {
  closed(): boolean;
  tool<T>(name: string, args: Record<string, unknown>): Promise<T>;
}

const FLUSH_DELAY_MS = 5000;
const MAX_BATCH = 20;

const bounded = (value: number) =>
  Math.min(PANEL_TIMING_MAX_COUNT, Math.max(0, value));

/** Fixed aggregates and one bounded queue share a single best-effort flight. */
export class TimingReporter {
  private queue: PanelCallTimingRecord[] = [];
  private aggregates = new Map<string, PanelLoadTimingRecord>();
  private timer?: ReturnType<typeof setTimeout>;
  private inFlight = false;
  private disposed = false;
  private dropped = 0;
  constructor(private context: TimingReporterContext) {}

  record(record: PanelCallTimingRecord) {
    if (this.closed()) return;
    if (this.queue.length < MAX_BATCH) this.queue.push(record);
    else this.dropped = bounded(this.dropped + 1);
    if (this.queue.length >= MAX_BATCH && !this.inFlight) this.flush();
    else this.schedule();
  }

  observe(
    operation: PanelLoadOperation,
    phase: PanelLoadPhase,
    duration: number,
    work: PanelTimingWork = {},
  ) {
    if (this.closed()) return;
    if (!Number.isFinite(duration) || duration < 0) return;
    const key = `${operation}:${phase}`;

    const record = this.aggregates.get(key) ?? {
      operation,
      phase,
      count: 0,
      total_ms: 0,
      max_ms: 0,
      rows: 0,
      groups: 0,
      stale_count: 0,
      error_count: 0,
    };

    record.count = bounded(record.count + 1);

    record.total_ms = Math.min(
      PANEL_TIMING_MAX_DURATION_MS,
      record.total_ms + duration,
    );

    record.max_ms = Math.min(
      PANEL_TIMING_MAX_DURATION_MS,
      Math.max(record.max_ms, duration),
    );

    record.rows = bounded(record.rows + (work.rows ?? 0));
    record.groups = bounded(record.groups + (work.groups ?? 0));
    record.stale_count = bounded(record.stale_count + (work.stale_count ?? 0));

    record.error_count = bounded(
      record.error_count + Number(work.outcome === "error"),
    );

    this.aggregates.set(key, record);
    this.schedule();
  }

  /** Times a call, when it has an `operation` to report under. */
  async fetch<T>(
    operation: PanelLoadOperation | undefined,
    call: () => Promise<T>,
  ): Promise<T> {
    if (!operation) return call();
    const started = performance.now();
    let outcome: "success" | "error" = "error";

    try {
      const result = await call();
      outcome = "success";

      return result;
    } finally {
      this.observe(operation, "fetch", performance.now() - started, {
        outcome,
      });
    }
  }

  merge<T>(operation: PanelLoadOperation, rows: number, run: () => T): T {
    const started = performance.now();
    let outcome: "success" | "error" = "error";

    try {
      const result = run();
      outcome = "success";

      return result;
    } finally {
      this.observe(operation, "merge", performance.now() - started, {
        rows,
        outcome,
      });
    }
  }

  private closed() {
    if (this.context.closed()) this.dispose();

    return this.disposed;
  }

  private schedule() {
    if (!this.inFlight && !this.timer) {
      this.timer = setTimeout(() => this.flush(), FLUSH_DELAY_MS);
    }
  }

  private flush() {
    clearTimeout(this.timer);
    this.timer = undefined;
    if (this.closed() || this.inFlight) return;
    const records = [...this.queue.splice(0), ...this.aggregates.values()];
    this.aggregates.clear();
    if (!records.length) return;
    const dropped = this.dropped;
    this.dropped = 0;
    this.inFlight = true;

    // Synchronous transport errors also belong only to diagnostics.
    Promise.resolve()
      .then(() => {
        if (this.closed()) return;

        return this.context.tool("app_record_timing", {
          records,
          ...(dropped ? { dropped_count: dropped } : {}),
        });
      })
      .catch(() => {
        if (!this.disposed) {
          this.dropped = bounded(this.dropped + dropped + records.length);
        }
      })
      .finally(() => {
        this.inFlight = false;

        if (!this.closed() && (this.queue.length || this.aggregates.size)) {
          this.schedule();
        }
      });
  }

  dispose() {
    this.disposed = true;
    clearTimeout(this.timer);
    this.timer = undefined;
    this.queue = [];
    this.aggregates.clear();
    this.dropped = 0;
  }
}
