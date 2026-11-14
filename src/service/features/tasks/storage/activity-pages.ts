import {
  type ActivityPage,
  addDropped,
  type DroppedSummary,
  EVENT_TAIL_SIZE,
  TURN_CLOSE_STOPS,
  TURN_CLOSING_EVENTS,
  type TurnActivityPage,
} from "../../../../shared/tasks/activity/activity-tail.js";
import type { ReadWork } from "./read-metrics.js";
import type { Store } from "./store.js";

/** How many tasks keep a tally. Each is a few counts, so this stays small. */
const TALLY_CACHE_SIZE = 32;

/** The tally of a task's events up to `through`, the newest one it counted. */
type Tally = { through: number; summary?: DroppedSummary };

/**
 * A task's activity for the panel: the newest events after a cursor, and a
 * tally of the events older than the window. Tallies
 * are kept per task and extended as the log grows, so a poll counts only the
 * events that are new, not the whole history.
 */
export class ActivityPages {
  private tallies = new Map<string, Tally>();

  constructor(private readonly store: Store) {}

  /** A task's page. The caller has checked that the task belongs to its owner. */
  page(taskId: string, after: number): ActivityPage {
    return this.store.reads.measure("activity_latest", (work) => {
      const start = this.store.eventWindowStart(taskId, EVENT_TAIL_SIZE);
      const dropped = this.tally(taskId, start, work);

      const page = {
        // The window holds at most EVENT_TAIL_SIZE events, so one page covers it.
        events: this.store.taskEvents(taskId, Math.max(after, start - 1)),
        ...(dropped ? { dropped } : {}),
      };

      work.rows = page.events.length;

      return page;
    });
  }

  /**
   * One turn's activity: the events after the previous turn closed through
   * this turn's close, the newest EVENT_TAIL_SIZE of them with a tally of the
   * rest. A turn that has not ended runs to the newest event.
   */
  turn(taskId: string, turn: number): TurnActivityPage {
    return this.store.reads.measure("activity_turn", (work) => {
      work.cache = "none";

      const after = this.turnClose(taskId, turn - 1) ?? 0;
      const through = this.turnClose(taskId, turn) ?? Number.MAX_SAFE_INTEGER;

      const start = this.store.rangeWindowStart(
        taskId,
        after,
        through,
        EVENT_TAIL_SIZE,
      );

      let dropped: DroppedSummary | undefined;

      for (let cursor = after; ;) {
        const older = this.store.taskEvents(taskId, cursor, start);
        const last = older.at(-1);
        if (!last) break;

        work.tally_rows += older.length;
        dropped = addDropped(dropped, older);
        cursor = last.id;
      }

      const page = {
        turn,
        // The window holds at most EVENT_TAIL_SIZE events, so one page covers it.
        events: this.store.taskEvents(taskId, start - 1, through + 1),
        ...(dropped ? { dropped } : {}),
      };

      work.rows = page.events.length;

      return page;
    });
  }

  /**
   * The id of the event that closes a turn, as `turnCloseIndex` finds it:
   * its closing status event, or its `task.turn_ended` when none follows.
   */
  private turnClose(taskId: string, turn: number) {
    const ended = this.store.turnEnded(taskId, turn);
    if (ended === undefined) return undefined;

    const next = this.store.nextEventOfType(taskId, ended, [
      ...TURN_CLOSING_EVENTS,
      ...TURN_CLOSE_STOPS,
    ]);

    return next && TURN_CLOSING_EVENTS.includes(next.type) ? next.id : ended;
  }

  /** Counts the events between the last tallied one and the window's start. */
  private tally(taskId: string, start: number, work: ReadWork) {
    work.cache = this.tallies.has(taskId) ? "hit" : "miss";
    let { through, summary } = this.tallies.get(taskId) ?? { through: 0 };

    for (;;) {
      const older = this.store.taskEvents(taskId, through, start);
      const last = older.at(-1);
      if (!last) break;

      work.tally_rows += older.length;
      summary = addDropped(summary, older);
      through = last.id;
    }

    // Re-inserting keeps the map ordered by last use, so the oldest is evicted.
    this.tallies.delete(taskId);
    this.tallies.set(taskId, { through, summary });

    const [oldest] = this.tallies.keys();

    if (oldest && this.tallies.size > TALLY_CACHE_SIZE) {
      this.tallies.delete(oldest);
    }

    return summary;
  }
}
