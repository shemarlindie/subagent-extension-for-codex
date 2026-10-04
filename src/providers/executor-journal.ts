import { randomUUID, createHash } from "node:crypto";
import { z } from "zod";
import type { Store } from "../core/store.js";
import type { Task } from "../core/model.js";
import { UnconfirmedTerminationError } from "../core/model.js";
import type { CodexSessionRef } from "./codex-session.js";

const recordSchema = z.strictObject({
  launch_id: z.string().uuid(),
  identity: z.string().regex(/^[a-f0-9]{64}$/),
  session_id: z.string().min(1),
  environment_id: z.string().min(1),
  phase: z.enum(["starting", "running", "stopped", "uncertain"]),
  pid: z.number().int().positive().optional(),
  process: z
    .strictObject({
      pgid: z.number().int().min(2),
      uid: z.number().int().nonnegative(),
      started: z.string().min(1),
    })
    .optional(),
});

export type ExecutorRecord = z.infer<typeof recordSchema>;

/** Persist outside the worker sandbox. A stale launch is never silently replaced. */
export class ExecutorJournal {
  constructor(private store: Store) {
    store.db.exec(
      "CREATE TABLE IF NOT EXISTS codex_executors(task_id TEXT PRIMARY KEY REFERENCES tasks(id), owner TEXT NOT NULL, body TEXT NOT NULL)",
    );
  }

  private identity(task: Task, ref: CodexSessionRef) {
    const persisted = this.store.get(task.id, task.owner);
    if (
      !task.workspace ||
      persisted.workspace !== task.workspace ||
      persisted.session_id !== ref.session_id ||
      task.session_id !== ref.session_id ||
      persisted.worker_profile !== task.worker_profile
    )
      throw new Error("Executor task identity has not been persisted");

    return createHash("sha256")
      .update(
        JSON.stringify([
          task.owner,
          task.workspace,
          task.worker_profile,
          ref.session_id,
          ref.environment_id,
          ref.remote_url,
          ref.state_ref,
        ]),
      )
      .digest("hex");
  }

  read(task: Task): ExecutorRecord | undefined {
    this.store.get(task.id, task.owner);

    const row = this.store.db
      .prepare("SELECT body FROM codex_executors WHERE task_id=? AND owner=?")
      .get(task.id, task.owner);

    return row ? recordSchema.parse(JSON.parse(String(row.body))) : undefined;
  }

  reserve(task: Task, ref: CodexSessionRef): ExecutorRecord {
    const identity = this.identity(task, ref);
    const existing = this.read(task);
    if (existing?.identity !== undefined && existing.identity !== identity)
      throw new Error("Persisted executor identity changed");
    if (existing && existing.phase !== "stopped")
      throw new UnconfirmedTerminationError(
        [],
        "Prior executor launch remains unconfirmed; refusing duplicate compute",
      );

    const record = recordSchema.parse({
      launch_id: randomUUID(),
      identity,
      session_id: ref.session_id,
      environment_id: ref.environment_id,
      phase: "starting",
    });

    // Synchronous reservation precedes spawn; the service's exclusive data lease owns this database.
    this.store.db
      .prepare(
        "INSERT INTO codex_executors VALUES(?,?,?) ON CONFLICT(task_id) DO UPDATE SET body=excluded.body",
      )
      .run(task.id, task.owner, JSON.stringify(record));

    return record;
  }

  private change(task: Task, launch: string, update: Partial<ExecutorRecord>) {
    const record = this.read(task);
    if (!record || record.launch_id !== launch)
      throw new Error("Stale executor launch update");
    const next = recordSchema.parse({ ...record, ...update });

    this.store.db
      .prepare("UPDATE codex_executors SET body=? WHERE task_id=? AND owner=?")
      .run(JSON.stringify(next), task.id, task.owner);
  }

  running(
    task: Task,
    launch: string,
    pid: number,
    process?: ExecutorRecord["process"],
  ) {
    const record = this.read(task);
    if (record?.phase !== "starting")
      throw new Error("Executor is not awaiting startup");
    if (process && process.pgid !== pid)
      throw new Error("Executor must own its process group");

    this.change(task, launch, {
      phase: "running",
      pid,
      ...(process ? { process } : {}),
    });
  }

  uncertain(task: Task, launch: string) {
    const record = this.read(task);
    if (record?.launch_id === launch && record.phase !== "stopped")
      this.change(task, launch, { phase: "uncertain" });
  }

  stopped(task: Task, launch: string) {
    this.change(task, launch, { phase: "stopped" });
  }
}
