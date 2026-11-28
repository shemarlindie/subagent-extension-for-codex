import type { Database } from "../../../platform/database/database.js";
import { logEvent } from "../../../platform/logging/logger.js";

interface Counters {
  event_count: number;
  json_bytes: number;
  original_response_event_count: number;
}

/** Execution-local diagnostics. Committed inserts supply their existing JSON. */
export class EventStorageMetrics {
  private active = new Map<string, Counters>();

  begin(taskId: string, turn: number) {
    const counters: Counters = {
      event_count: 0,
      json_bytes: 0,
      original_response_event_count: 0,
    };

    this.active.set(taskId, counters);

    return (status: string) => {
      if (this.active.get(taskId) !== counters) return;
      this.active.delete(taskId);

      try {
        logEvent("info", "task.event_storage", {
          task_id: taskId,
          turn,
          status,
          ...counters,
        });
      } catch {
        /* Diagnostics cannot change execution outcomes. */
      }
    };
  }

  committed(
    database: Database,
    taskId: string,
    serialized: string,
    originalResponse?: string,
  ) {
    const counters = this.active.get(taskId);
    if (!counters) return;

    const bytes =
      Buffer.byteLength(serialized, "utf8") +
      (originalResponse ? Buffer.byteLength(originalResponse, "utf8") : 0);

    database.afterCommit(() => {
      // A callback from an earlier execution cannot charge a later one.
      if (this.active.get(taskId) !== counters) return;
      counters.event_count++;
      counters.json_bytes += bytes;

      counters.original_response_event_count += Number(
        originalResponse !== undefined,
      );
    });
  }
}
