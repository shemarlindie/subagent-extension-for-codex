import { logEvent, withLogContext } from "../../../platform/logging/logger.js";

type ReadOperation =
  "task_list" | "chat" | "activity_latest" | "activity_turn" | "view";

export interface ReadWork {
  rows: number;
  tally_rows: number;
  cache?: "hit" | "miss" | "none";
}

const WINDOW_MS = 60_000;
const SLOW_MS = 50;

interface Summary {
  count: number;
  total_ms: number;
  max_ms: number;
  rows: number;
  tally_rows: number;
  slow_count: number;
  error_count: number;
}

/** One active window per store, with constant space per fixed operation. */
export class ReadMetrics {
  private summaries = new Map<ReadOperation, Summary>();
  private timer?: ReturnType<typeof setTimeout>;
  private started = 0;

  measure<T>(operation: ReadOperation, run: (work: ReadWork) => T): T {
    const started = performance.now();
    const work: ReadWork = { rows: 0, tally_rows: 0 };
    let outcome = "error";

    try {
      const result = run(work);
      outcome = "success";

      return result;
    } finally {
      const duration = performance.now() - started;

      try {
        logEvent("debug", "storage.read", {
          operation,
          duration_ms: duration,
          outcome,
          ...work,
        });
      } catch {
        /* Diagnostics must preserve the read result or error. */
      }

      const summary = this.summaries.get(operation) ?? {
        count: 0,
        total_ms: 0,
        max_ms: 0,
        rows: 0,
        tally_rows: 0,
        slow_count: 0,
        error_count: 0,
      };

      summary.count++;
      summary.total_ms += duration;
      summary.max_ms = Math.max(summary.max_ms, duration);
      summary.rows += work.rows;
      summary.tally_rows += work.tally_rows;
      summary.slow_count += Number(duration >= SLOW_MS);
      summary.error_count += Number(outcome === "error");
      this.summaries.set(operation, summary);

      if (!this.timer) {
        this.started = performance.now();
        this.timer = setTimeout(() => this.flush(), WINDOW_MS);
        this.timer.unref();
      }
    }
  }

  rows<T>(operation: ReadOperation, run: () => T[]): T[] {
    return this.measure(operation, (work) => {
      const rows = run();
      work.rows = rows.length;

      return rows;
    });
  }

  flush() {
    clearTimeout(this.timer);
    this.timer = undefined;

    // Aggregates belong to the store, never to the request that opened a window.
    try {
      withLogContext(
        {},
        () => {
          for (const [operation, summary] of this.summaries) {
            logEvent("info", "storage.read_summary", {
              operation,
              ...summary,
              window_ms: performance.now() - this.started,
              slow_threshold_ms: SLOW_MS,
            });
          }
        },
        { inherit: false },
      );
    } catch {
      /* Summary delivery is best effort, including at shutdown. */
    } finally {
      this.summaries.clear();
    }
  }
}
