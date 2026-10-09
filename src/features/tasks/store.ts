import { EventEmitter } from "node:events";

import { and, desc, eq, gt, inArray, max, or, sql } from "drizzle-orm";

import {
  type Database,
  openDatabase,
} from "../../platform/database/database.js";
import { type Event, now, type Task } from "../../shared/contracts.js";
import { events, tasks } from "./schema.js";
import { decodeEvent, decodeTask } from "./stored.js";

/** The 1,000-event page that event reads return at most. */
const PAGE = 1000;

const toTask = (row: { id: string; body: string }) =>
  decodeTask(row.id, row.body);

/**
 * Task and event persistence, and the bus that announces committed events.
 * Methods taking an owner are the public, owner-checked reads; the others
 * are internal reads for code that already holds the task.
 */
export class Store {
  /** The shared connection, which other features' storage also uses. */
  readonly database: Database;
  /** The tasks saved in the open transaction, with the `updated_at` to restore on rollback. */
  private saved?: [Task, string][];
  // Long-poll reads each listen while they wait, so there can be many.
  bus = new EventEmitter().setMaxListeners(0);
  constructor(path: string) {
    this.database = openDatabase(path);
  }

  private get orm() {
    return this.database.orm;
  }

  /**
   * Runs `fn` in one transaction, so the task state and events it writes
   * commit together. Listeners hear its events only after the commit; on a
   * rollback they hear nothing, and saved tasks get back their `updated_at`.
   */
  transaction<T>(fn: () => T): T {
    if (this.saved)
      throw new Error("A transaction is already open; run this work inside it");

    const saved: [Task, string][] = [];
    this.saved = saved;

    try {
      return this.database.transaction(() => {
        try {
          return fn();
        } finally {
          // Closed before the commit's listeners run, so they can open their own.
          this.saved = undefined;
        }
      });
    } catch (error) {
      for (const [t, updated] of saved.reverse()) t.updated_at = updated;
      throw error;
    }
  }

  save(t: Task) {
    const updated = t.updated_at;
    t.updated_at = now();
    const body = JSON.stringify(t);

    try {
      this.orm
        .insert(tasks)
        .values({ id: t.id, owner: t.owner, body })
        .onConflictDoUpdate({ target: tasks.id, set: { body } })
        .run();
    } catch (error) {
      t.updated_at = updated;
      throw error;
    }

    this.saved?.push([t, updated]);
  }

  /**
   * Deletes a task. Its events, pending forms and queued webhook deliveries
   * reference it and are deleted with it.
   */
  delete(id: string, owner: string) {
    this.get(id, owner);

    this.orm
      .delete(tasks)
      .where(and(eq(tasks.id, id), eq(tasks.owner, owner)))
      .run();
  }

  /** An owner's tasks, or every task without one, newest first. */
  all(owner?: string): Task[] {
    return this.orm
      .select({ id: tasks.id, body: tasks.body })
      .from(tasks)
      .where(owner ? eq(tasks.owner, owner) : undefined)
      .all()
      .map(toTask)
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  }

  get(id: string, owner: string): Task {
    const row = this.orm
      .select({ id: tasks.id, body: tasks.body })
      .from(tasks)
      .where(and(eq(tasks.id, id), eq(tasks.owner, owner)))
      .get();

    if (!row) throw new Error("Task not found");

    return toTask(row);
  }

  event(t: Task, type: string, data: Record<string, unknown> = {}): Event {
    const timestamp = now();

    const { id } = this.orm
      .insert(events)
      .values({ task_id: t.id, type, timestamp, data: JSON.stringify(data) })
      .returning({ id: events.id })
      .get()!;

    const e = { id, task_id: t.id, type, timestamp, data };
    this.database.afterCommit(() => this.notify(e, t.owner));

    return e;
  }

  /**
   * Tells each event listener about a committed event. A notification is a
   * hint that rows exist, so a failing listener is logged and the others
   * still run; consumers catch up on what they missed from the database.
   */
  private notify(e: Event, owner: string) {
    for (const listener of this.bus.listeners("event"))
      try {
        listener(e, owner);
      } catch (error) {
        console.error("Event listener failed", error);
      }
  }

  events(id: string, owner: string, after = 0): Event[] {
    this.get(id, owner);

    return this.orm
      .select()
      .from(events)
      .where(and(eq(events.task_id, id), gt(events.id, after)))
      .orderBy(events.id)
      .limit(PAGE)
      .all()
      .map(decodeEvent);
  }

  recentEvents(id: string, owner: string): Event[] {
    this.get(id, owner);

    return this.orm
      .select()
      .from(events)
      .where(eq(events.task_id, id))
      .orderBy(desc(events.id))
      .limit(200)
      .all()
      .reverse()
      .map(decodeEvent);
  }

  /** An owner's events across tasks, after a cursor, a page at a time. */
  streamEvents(owner: string, after: number): Event[] {
    return this.orm
      .select({
        id: events.id,
        task_id: events.task_id,
        type: events.type,
        timestamp: events.timestamp,
        data: events.data,
      })
      .from(events)
      .innerJoin(tasks, eq(tasks.id, events.task_id))
      .where(and(eq(tasks.owner, owner), gt(events.id, after)))
      .orderBy(events.id)
      .limit(PAGE)
      .all()
      .map(decodeEvent);
  }

  /** Every task's events after a cursor, a page at a time, for webhook capture. */
  eventsAfter(after: number): Event[] {
    return this.orm
      .select()
      .from(events)
      .where(gt(events.id, after))
      .orderBy(events.id)
      .limit(PAGE)
      .all()
      .map(decodeEvent);
  }

  /** The id of the latest event, or of a task's latest one; 0 before any. */
  lastEventId(id?: string): number {
    const row = this.orm
      .select({ id: max(events.id) })
      .from(events)
      .where(id === undefined ? undefined : eq(events.task_id, id))
      .get();

    return row?.id ?? 0;
  }

  /** A task's latest event of a type, such as its latest `agent.reply`. */
  latestEvent(id: string, type: string): Event | undefined {
    const row = this.orm
      .select()
      .from(events)
      .where(and(eq(events.task_id, id), eq(events.type, type)))
      .orderBy(desc(events.id))
      .limit(1)
      .get();

    return row && decodeEvent(row);
  }

  /** Every event of the given types for a task, in order, with no page limit. */
  eventsOfTypes(id: string, types: string[]): Event[] {
    return this.orm
      .select()
      .from(events)
      .where(and(eq(events.task_id, id), inArray(events.type, types)))
      .orderBy(events.id)
      .all()
      .map(decodeEvent);
  }

  /**
   * The events Chat is built from: those of the given types, and context
   * compactions, which Claude reports among its other system messages.
   */
  chatEvents(id: string, types: string[]): Event[] {
    const compaction = and(
      eq(events.type, "claude.activity"),
      sql`(json_extract(${events.data},'$.raw_response.subtype')='compact_boundary' OR json_extract(${events.data},'$.raw_response.compact_result')='failed')`,
    );

    return this.orm
      .select()
      .from(events)
      .where(
        and(
          eq(events.task_id, id),
          or(inArray(events.type, types), compaction),
        ),
      )
      .orderBy(events.id)
      .all()
      .map(decodeEvent);
  }

  close() {
    this.database.close();
  }
}
