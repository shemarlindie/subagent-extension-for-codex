import type { Task } from "../core/model.js";
import type { CodexSessionRef } from "./codex-session.js";
import type { ExecutorHandle } from "./mac-executor.js";

export interface ExecutorStarter {
  start(task: Task, ref: CodexSessionRef): Promise<ExecutorHandle>;
  recover?(task: Task): Promise<void>;
}

interface Entry {
  identity: string;
  ready: Promise<ExecutorHandle>;
  leases: number;
  exited: boolean;
  stopping?: Promise<void>;
}

/** One executor per task/session. Idle events never trigger shutdown. */
export class CodexExecutors {
  private entries = new Map<string, Entry>();
  private writers = new Set<string>();
  private closing?: Promise<void>;
  constructor(private starter: ExecutorStarter) {}
  async recover(task: Task) {
    if (this.entries.has(task.id))
      throw new Error("Executor is still owned by this service");
    if (!this.starter.recover)
      throw new Error("Executor has no durable recovery implementation");
    await this.starter.recover(task);
  }

  /** Native session streams require a single input writer for coordinator selection. */
  async run<T>(
    task: Task,
    ref: CodexSessionRef,
    work: (executor: { exited: ExecutorHandle["exited"] }) => Promise<T>,
  ): Promise<T> {
    if (this.writers.has(task.id))
      throw new Error("This task already has an active Codex turn");
    this.writers.add(task.id);

    try {
      const lease = await this.acquire(task, ref);

      try {
        return await work({ exited: lease.exited });
      } finally {
        lease.release();
      }
    } finally {
      this.writers.delete(task.id);
    }
  }

  private identity(task: Task, ref: CodexSessionRef) {
    if (!task.workspace || task.session_id !== ref.session_id)
      throw new Error(
        "Persist the task session and workspace before executor startup",
      );

    return JSON.stringify([
      task.owner,
      task.workspace,
      task.worker_profile,
      ref.session_id,
      ref.environment_id,
      ref.remote_url,
      ref.state_ref,
    ]);
  }

  async acquire(task: Task, ref: CodexSessionRef) {
    if (this.closing) throw new Error("Executor service is shutting down");
    const identity = this.identity(task, ref);
    let entry = this.entries.get(task.id);
    if (entry && entry.identity !== identity)
      throw new Error("Executor identity changed for this task");
    if (entry?.stopping || entry?.exited)
      throw new Error("Executor is stopping or has exited");

    if (!entry) {
      const snapshot = structuredClone(task);
      const session = structuredClone(ref);

      entry = {
        identity,
        leases: 0,
        exited: false,
        ready: Promise.resolve().then(() =>
          this.starter.start(snapshot, session),
        ),
      };

      this.entries.set(task.id, entry);
      const current = entry;

      void current.ready
        .then((handle) => handle.exited)
        .then(
          () => this.exited(task.id, current),
          () => this.exited(task.id, current),
        );
    }

    const current = entry;
    current.leases++;
    let released = false;

    const release = () => {
      if (released) return;
      released = true;
      current.leases--;
      if (
        current.exited &&
        !current.leases &&
        this.entries.get(task.id) === current
      )
        this.entries.delete(task.id);
    };

    try {
      const handle = await current.ready;
      if (this.closing || current.stopping || current.exited)
        throw new Error("Executor became unavailable during startup");

      return { exited: handle.exited, release };
    } catch (error) {
      release();
      throw error;
    }
  }

  private exited(id: string, entry: Entry) {
    entry.exited = true;
    if (!entry.leases && this.entries.get(id) === entry)
      this.entries.delete(id);
  }

  /** Caller must coordinate pending input and terminal turn state first. */
  async stop(task: Task, ref: CodexSessionRef) {
    const identity = this.identity(task, ref);
    const entry = this.entries.get(task.id);
    if (!entry) return;
    if (entry.identity !== identity)
      throw new Error("Executor identity changed for this task");
    if (entry.leases) throw new Error("Executor is still in use");
    await this.stopEntry(task.id, entry);
  }

  private stopEntry(id: string, entry: Entry) {
    return (entry.stopping ??= (async () => {
      const handle = await entry.ready;
      await handle.stop();
      if (this.entries.get(id) === entry) this.entries.delete(id);
    })());
  }

  /** Explicit service shutdown also stops leased executors; API cancellation is separate. */
  close() {
    return (this.closing ??= Promise.resolve().then(async () => {
      const outcomes = await Promise.allSettled(
        [...this.entries].map(([id, entry]) => this.stopEntry(id, entry)),
      );

      const errors = outcomes.flatMap((result) =>
        result.status === "rejected" ? [result.reason] : [],
      );

      if (errors.length)
        throw new AggregateError(errors, "Executor shutdown incomplete");
    }));
  }
}
