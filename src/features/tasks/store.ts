import { EventEmitter } from "node:events";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { type Event, now, type Task } from "../../shared/contracts.js";

export class Store {
  db: DatabaseSync;
  bus = new EventEmitter();
  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path);

    this.db
      .exec(`PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS tasks(id TEXT PRIMARY KEY, owner TEXT NOT NULL, body TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY AUTOINCREMENT,task_id TEXT NOT NULL REFERENCES tasks(id),type TEXT NOT NULL,timestamp TEXT NOT NULL,data TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS events_task ON events(task_id,id);`);
  }

  save(t: Task) {
    t.updated_at = now();

    this.db
      .prepare(
        "INSERT INTO tasks VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body",
      )
      .run(t.id, t.owner, JSON.stringify(t));
  }

  /**
   * Deletes a task with its events and everything else stored under its id:
   * the executor record, pending forms and queued webhook deliveries.
   */
  delete(id: string, owner: string) {
    this.get(id, owner);

    const tables = new Set(
      this.db
        .prepare("SELECT name FROM sqlite_master WHERE type='table'")
        .all()
        .map((row) => String(row.name)),
    );

    this.db.exec("BEGIN IMMEDIATE");

    try {
      if (tables.has("codex_executors"))
        this.db.prepare("DELETE FROM codex_executors WHERE task_id=?").run(id);

      if (tables.has("form_requests"))
        this.db
          .prepare(
            "DELETE FROM form_requests WHERE json_extract(body,'$.task_id')=?",
          )
          .run(id);

      // Outbox event ids are `evt_<task id>_<event id>`.
      if (tables.has("event_outbox"))
        this.db
          .prepare(
            "DELETE FROM event_outbox WHERE substr(event_id,1,?)=? AND substr(event_id,?) GLOB '[0-9]*' AND substr(event_id,?) NOT GLOB '*[^0-9]*'",
          )
          .run(
            `evt_${id}_`.length,
            `evt_${id}_`,
            `evt_${id}_`.length + 1,
            `evt_${id}_`.length + 1,
          );

      this.db.prepare("DELETE FROM events WHERE task_id=?").run(id);

      this.db
        .prepare("DELETE FROM tasks WHERE id=? AND owner=?")
        .run(id, owner);

      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
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

    this.bus.emit("event", e, t.owner);

    return e;
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
    this.db.close();
  }
}
