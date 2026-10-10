import {
  type ActivityPage,
  addDropped,
  type DroppedSummary,
  EVENT_TAIL_SIZE,
} from "../../../../shared/tasks/activity/activity-tail.js";
import type { Store } from "./store.js";

/** How many tasks keep a tally. Each is a few counts, so this stays small. */
const TALLY_CACHE_SIZE = 32;

/** The tally of a task's events up to `through`, the newest one it counted. */
type Tally = { through: number; summary?: DroppedSummary };

/**
 * A task's activity for the panel: the newest events after a cursor, the
 * task's event total, and a tally of the events older than the window. Tallies
 * are kept per task and extended as the log grows, so a poll counts only the
 * events that are new, not the whole history.
 */
export class ActivityPages {
  private tallies = new Map<string, Tally>();

  constructor(private readonly store: Store) {}

  /** A task's page. The caller has checked that the task belongs to its owner. */
  page(taskId: string, after: number): ActivityPage {
    const start = this.store.eventWindowStart(taskId, EVENT_TAIL_SIZE),
      dropped = this.tally(taskId, start);

    return {
      // The window holds at most EVENT_TAIL_SIZE events, so one page covers it.
      events: this.store.taskEvents(taskId, Math.max(after, start - 1)),
      total: this.store.eventCount(taskId),
      ...(dropped ? { dropped } : {}),
    };
  }

  /** Counts the events between the last tallied one and the window's start. */
  private tally(taskId: string, start: number) {
    let { through, summary } = this.tallies.get(taskId) ?? { through: 0 };

    for (;;) {
      const older = this.store.taskEvents(taskId, through, start);
      if (!older.length) break;

      summary = addDropped(summary, older);
      through = older.at(-1)!.id;
    }

    // Re-inserting keeps the map ordered by last use, so the oldest is evicted.
    this.tallies.delete(taskId);
    this.tallies.set(taskId, { through, summary });

    if (this.tallies.size > TALLY_CACHE_SIZE)
      this.tallies.delete(this.tallies.keys().next().value!);

    return summary;
  }
}
