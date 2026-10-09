import { EventEmitter } from "node:events";
import { type DatabaseSync } from "node:sqlite";

import {
  type Database,
  openDatabase,
} from "../../platform/database/database.js";
import { type Event, now, type Task } from "../../shared/contracts.js";

export class Store {
  private database: Database;
  /** The tasks saved in the open transaction, with the `updated_at` to restore on rollback. */
  private saved?: [Task, string][];
  db: DatabaseSync;
  // Long-poll reads each listen while they wait, so there can be many.
  bus = new EventEmitter().setMaxListeners(0);
  constructor(path: string) {
    this.database = openDatabase(path);
    this.db = this.database.client;
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

    try {
      this.db
        .prepare(
          "INSERT INTO tasks VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body",
        )
        .run(t.id, t.owner, JSON.stringify(t));
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
    this.db.prepare("DELETE FROM tasks WHERE id=? AND owner=?").run(id, owner);
  }

  all(owner?: string): Task[] {
    return (
      owner
        ? this.db.prepare("SELECT body FROM tasks WHERE owner=?").all(owner)
        : this.db.prepare("SELECT body FROM tasks").all()
    )
      .map((r) => JSON.parse(String(r.body)) as Task)
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  }

  get(id: string, owner: string): Task {
    const row = this.db
      .prepare("SELECT body FROM tasks WHERE id=? AND owner=?")
      .get(id, owner);

    if (!row) throw new Error("Task not found");

    return JSON.parse(String(row.body)) as Task;
  }

  event(t: Task, type: string, data: Record<string, unknown> = {}): Event {
    const timestamp = now();

    const r = this.db
      .prepare(
        "INSERT INTO events(task_id,type,timestamp,data) VALUES(?,?,?,?)",
      )
      .run(t.id, type, timestamp, JSON.stringify(data));

    const e = {
      id: Number(r.lastInsertRowid),
      task_id: t.id,
      type,
      timestamp,
      data,
    };

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

    return this.db
      .prepare(
        "SELECT * FROM events WHERE task_id=? AND id>? ORDER BY id LIMIT 1000",
      )
      .all(id, after)
      .map(
        (r) => ({ ...r, data: JSON.parse(String(r.data)) }) as unknown as Event,
      );
  }

  /** The id of a task's latest event, or 0 before it has any. */
  lastEventId(id: string): number {
    const row = this.db
      .prepare("SELECT MAX(id) AS id FROM events WHERE task_id=?")
      .get(id);

    return Number(row?.id ?? 0);
  }

  /** A task's latest event of a type, such as its latest `agent.reply`. */
  latestEvent(id: string, type: string): Event | undefined {
    const row = this.db
      .prepare(
        "SELECT * FROM events WHERE task_id=? AND type=? ORDER BY id DESC LIMIT 1",
      )
      .get(id, type);

    return row
      ? ({ ...row, data: JSON.parse(String(row.data)) } as unknown as Event)
      : undefined;
  }

  /** Every event of the given types for a task, in order, with no page limit. */
  eventsOfTypes(id: string, types: string[]): Event[] {
    return this.db
      .prepare(
        `SELECT * FROM events WHERE task_id=? AND type IN (${types.map(() => "?").join(",")}) ORDER BY id`,
      )
      .all(id, ...types)
      .map(
        (r) => ({ ...r, data: JSON.parse(String(r.data)) }) as unknown as Event,
      );
  }

  /**
   * The events Chat is built from: those of the given types, and context
   * compactions, which Claude reports among its other system messages.
   */
  chatEvents(id: string, types: string[]): Event[] {
    return this.db
      .prepare(
        `SELECT * FROM events WHERE task_id=? AND (type IN (${types.map(() => "?").join(",")}) OR (type='claude.activity' AND (json_extract(data,'$.raw_response.subtype')='compact_boundary' OR json_extract(data,'$.raw_response.compact_result')='failed'))) ORDER BY id`,
      )
      .all(id, ...types)
      .map(
        (r) => ({ ...r, data: JSON.parse(String(r.data)) }) as unknown as Event,
      );
  }

  recentEvents(id: string, owner: string): Event[] {
    this.get(id, owner);

    return this.db
      .prepare(
        "SELECT * FROM events WHERE task_id=? ORDER BY id DESC LIMIT 200",
      )
      .all(id)
      .reverse()
      .map(
        (r) => ({ ...r, data: JSON.parse(String(r.data)) }) as unknown as Event,
      );
  }

  streamEvents(owner: string, after: number): Event[] {
    return this.db
      .prepare(
        "SELECT events.* FROM events JOIN tasks ON tasks.id=events.task_id WHERE tasks.owner=? AND events.id>? ORDER BY events.id LIMIT 1000",
      )
      .all(owner, after)
      .map(
        (r) => ({ ...r, data: JSON.parse(String(r.data)) }) as unknown as Event,
      );
  }

  close() {
    this.database.close();
  }
}
