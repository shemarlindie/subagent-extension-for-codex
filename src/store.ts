import { DatabaseSync } from "node:sqlite";
import { EventEmitter } from "node:events";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { type Task, type Event, type Artifact, now } from "./model.js";
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
    CREATE TABLE IF NOT EXISTS artifacts(id TEXT PRIMARY KEY,task_id TEXT NOT NULL REFERENCES tasks(id),body TEXT NOT NULL);
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
  all(owner?: string): Task[] {
    return (
      owner
        ? this.db.prepare("SELECT body FROM tasks WHERE owner=?").all(owner)
        : this.db.prepare("SELECT body FROM tasks").all()
    )
      .map((r) => JSON.parse(String(r.body)))
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  }
  get(id: string, owner: string): Task {
    const row = this.db
      .prepare("SELECT body FROM tasks WHERE id=? AND owner=?")
      .get(id, owner);
    if (!row) throw new Error("Task not found");
    return JSON.parse(String(row.body));
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
  artifact(
    t: Task,
    type: string,
    title: string,
    content: string,
    mime_type = "text/plain",
  ): Artifact {
    const a = {
      id: `art_${randomUUID()}`,
      task_id: t.id,
      type,
      title,
      content,
      mime_type,
      created_at: now(),
    };
    this.db
      .prepare("INSERT INTO artifacts VALUES(?,?,?)")
      .run(a.id, t.id, JSON.stringify(a));
    this.event(t, "artifact.created", { artifact_id: a.id, type, title });
    return a;
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
  artifacts(id: string, owner: string): Artifact[] {
    this.get(id, owner);
    return this.db
      .prepare("SELECT body FROM artifacts WHERE task_id=?")
      .all(id)
      .map((r) => JSON.parse(String(r.body)));
  }
  close() {
    this.db.close();
  }
}
