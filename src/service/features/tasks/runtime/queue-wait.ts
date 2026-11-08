import { recordTaskTiming, type TimingOutcome } from "./timing.js";

/** What made the task ready for its next turn. */
export type QueueCause =
  | "start"
  | "followup"
  | "queued_message"
  | "interrupt_send"
  | "resume"
  | "recovery";

type Wait = {
  cause: QueueCause;
  since: number;
  /** The capacity clock when the wait began. */
  capacityAtStart: number;
};

/**
 * Observes how long tasks ready for their next turn wait to start it in this
 * process. It reads scheduling decisions and never changes them. Waits
 * before this process started are unknown, and nothing is recorded for
 * waits still open when it stops.
 */
export class QueueWaits {
  private waits = new Map<string, Wait>();
  /** Total time every slot was in use, up to `fullSince`. */
  private fullTotal = 0;
  private fullSince?: number;

  private capacityClock(at: number) {
    const open = this.fullSince === undefined ? 0 : at - this.fullSince;

    return this.fullTotal + open;
  }

  /** Tracks whether every slot is in use. */
  capacity(full: boolean) {
    const at = performance.now();

    if (full) {
      this.fullSince ??= at;
    } else if (this.fullSince !== undefined) {
      this.fullTotal += at - this.fullSince;
      this.fullSince = undefined;
    }
  }

  /** Starts a wait, keeping the earliest when the task is already waiting. */
  queued(taskId: string, cause: QueueCause) {
    if (this.waits.has(taskId)) return;
    const at = performance.now();

    this.waits.set(taskId, {
      cause,
      since: at,
      capacityAtStart: this.capacityClock(at),
    });
  }

  /**
   * Records the wait: `success` when its turn starts and `aborted` when it
   * was interrupted or deleted.
   */
  ended(taskId: string, outcome: TimingOutcome, turn?: number) {
    const wait = this.waits.get(taskId);
    if (!wait) return;
    this.waits.delete(taskId);
    const at = performance.now();

    recordTaskTiming({
      phase: "queue_wait",
      task_id: taskId,
      turn,
      cause: wait.cause,
      outcome,
      duration_ms: at - wait.since,
      capacity_ms: this.capacityClock(at) - wait.capacityAtStart,
    });
  }
}
