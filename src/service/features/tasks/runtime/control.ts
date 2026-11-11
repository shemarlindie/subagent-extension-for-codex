import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { dirname, join } from "node:path";

import type { EventPayloadMap } from "../../../../shared/events/event-contract.js";
import type { EventType } from "../../../../shared/events/event-types.js";
import { eventPayload } from "../../../../shared/events/payload.js";
import { providerMetadata } from "../../../../shared/providers/metadata.js";
import { withEffectiveOptions } from "../../../../shared/providers/options.js";
import {
  type BudgetRaise,
  type InputAuthority,
  pendingInputKind,
  roles,
  type Sender,
  type Task,
  type TaskMessage,
} from "../../../../shared/tasks/model.js";
import { now } from "../../../../shared/time.js";
import { logError } from "../../../platform/logging/logger.js";
import { Attachments } from "../../attachments/attachments.js";
import { Changes } from "../../changes/changes.js";
import { Projects } from "../../projects/projects.js";
import { RunError } from "../../providers/run-error.js";
import { type Provider, type RunContext } from "../../providers/types.js";
import { Settings } from "../../settings/settings.js";
import { Workspaces } from "../../workspaces/workspace.js";
import { Drafts } from "../conversation/drafts.js";
import { SessionPrompts } from "../conversation/session-prompts.js";
import { PendingInput } from "../input/pending-input.js";
import { ActivityPages } from "../storage/activity-pages.js";
import { ArchiveStore } from "../storage/archive-store.js";
import { ParentSeenStore } from "../storage/parent-seen-store.js";
import { Store } from "../storage/store.js";
import { taskExists } from "../storage/task-rows.js";
import {
  raiseBudget,
  raisedBudget,
  remainingRuntime,
  validateBudgets,
} from "./budget.js";
import { observeExecution } from "./execution-logging.js";
import { ProjectGuard } from "./project-guard.js";
import {
  clearQueuedMessages,
  commitQueue,
  deliverQueued,
  editQueuedMessage,
  leaveOver,
  moveQueuedMessage,
  type QueuePlacement,
  queueSnapshot,
  recordMessage,
  recordQueueChange,
  removeQueuedMessage,
  requeue,
  restoreQueuedMessages,
  steerQueuedMessage,
} from "./queue.js";
import { type QueueCause, QueueWaits } from "./queue-wait.js";
import { commitSend } from "./send-acceptance.js";
import {
  type RecordSend,
  type SendOptions,
  SendRequests,
  type SentMessage,
} from "./send-requests.js";
import {
  confirmedTaskDeletion,
  type DeletionVersions,
  projectDeletionTasks,
  taskDeletionPreview,
} from "./task-deletion.js";
import { startTask } from "./task-start.js";
import { measureTaskWait, recordTaskTiming, sendRef } from "./timing.js";
import { type Active, recordStatusEvent } from "./turn-outcome.js";
import {
  startTurn,
  turnPrompt,
  type TurnStartupContext,
} from "./turn-startup.js";
import { workerStatus } from "./worker-status.js";

/** Statuses in which a task has a turn running, starting or about to. */
const BUSY: Task["status"][] = ["queued", "starting", "running", "waiting"];

export class Control {
  changes: Changes;
  /** Which tasks the user archived from the panel's lists. */
  archive: ArchiveStore;
  /** Which worker updates the parent agent has seen. */
  parentSeen: ParentSeenStore;
  active = new Map<string, Active>();
  private deleting = new Set<string>();
  private sendRequests: SendRequests;
  /** Observes queue waits for the timing log. */
  private queueWaits = new QueueWaits();
  scheduling = false;
  stopped = false;
  ownerWorker = hostname();
  private prompts: SessionPrompts;
  settings: Settings;
  /** Running tasks' unfinished messages, kept in memory. */
  drafts: Drafts;
  /** The panel's activity pages, with each task's tally of older events. */
  activity: ActivityPages;
  projects?: Projects;
  /** Snapshots of start_task attachments, beside the worktrees. */
  attachments: Attachments;
  private projectGuard = new ProjectGuard();
  constructor(
    public store: Store,
    public workspaces: Workspaces,
    public providers: Map<string, Provider>,
    public concurrency = 3,
  ) {
    this.changes = new Changes(store);
    this.archive = new ArchiveStore(store);
    this.parentSeen = new ParentSeenStore(store);
    this.sendRequests = new SendRequests(store);

    this.settings = new Settings(
      store.database,
      () => [...providers.keys()],
      (id) => providerMetadata(id, providers.get(id)?.metadata),
    );

    this.attachments = new Attachments(
      store,
      join(dirname(workspaces.root), "attachments"),
    );

    this.prompts = new SessionPrompts(store, this.attachments);
    this.drafts = new Drafts(store.bus);
    this.activity = new ActivityPages(store);
  }

  async recover() {
    try {
      await this.attachments.sweep((id) =>
        taskExists(this.store.database.orm, id),
      );
    } catch (error) {
      logError("attachments.sweep_failed", error);
    }

    for (const t of this.store.withStatus(BUSY)) {
      if (["starting", "running", "waiting"].includes(t.status)) {
        t.status = "interrupted";
        delete t.pending_input;
        delete t.waiting_reason;

        t.error = "Service restarted; send a message to continue.";
        delete t.error_code;
        t.completed_at = now();
        // Steers still inside the provider were lost with it, so they wait
        // at the front of the queue, which pauses as after any interrupt.
        const queue = queueSnapshot(t);
        leaveOver(t);
        if (t.queue.length) t.queue_paused = true;

        commitQueue(this.store, t, queue, () =>
          this.store.event(t, "task.interrupted", {
            reason: "service_restart",
          }),
        );
      } else {
        this.queueWaits.queued(t.id, "recovery");
      }
    }

    void this.schedule();
  }

  /**
   * Whether no task is running, starting, queued or waiting, so stopping
   * interrupts nothing.
   */
  idle() {
    return (
      !this.scheduling &&
      !this.active.size &&
      !this.store.withStatus(BUSY).length
    );
  }

  workers() {
    return [...this.providers.values()].map((p) => ({
      provider: p.id,
      capabilities: p.capabilities,
      metadata: p.metadata,
      profiles: [...roles],
    }));
  }

  async availableWorkers(owner: string) {
    return Promise.all(
      this.workers().map((worker) =>
        workerStatus(
          worker,
          this.providers.get(worker.provider)!,
          this.settings.values(owner),
        ),
      ),
    );
  }

  async start(
    owner: string,
    input: unknown,
    authority: InputAuthority = "user",
  ) {
    const t = await startTask(this, this.projectGuard, owner, input, authority);
    this.queueWaits.queued(t.id, "start");
    void this.schedule();

    return t;
  }

  async schedule() {
    if (this.scheduling || this.stopped) return;
    this.scheduling = true;
    const scanStarted = performance.now();
    let taskCount = 0;
    let scannedCount = 0;

    try {
      const tasks = this.store.withStatus(["queued"]);
      taskCount = tasks.length;

      for (const t of tasks) {
        scannedCount++;
        if (this.active.size >= this.concurrency) break;
        if (this.deleting.has(t.id)) continue;

        t.status = "starting";
        t.turn++;
        this.store.save(t);
        const abort = new AbortController();

        const active: Active = {
          task: t,
          abort,
          done: Promise.resolve(),
          input: new PendingInput(
            t,
            this.store,
            this.providers.get(t.provider)!.taskPolicy,
            abort.signal,
          ),
        };

        this.active.set(t.id, active);
        this.queueWaits.ended(t.id, "success", t.turn);
        this.queueWaits.capacity(this.active.size >= this.concurrency);
        active.done = this.execute(t, active);
      }
    } finally {
      this.scheduling = false;

      recordTaskTiming({
        phase: "scheduler_scan",
        duration_ms: performance.now() - scanStarted,
        task_count: taskCount,
        scanned_count: scannedCount,
      });
    }
  }

  execute(t: Task, a: Active) {
    return observeExecution(t, () => this.executeTurn(t, a));
  }

  private async executeTurn(t: Task, a: Active) {
    const finishStorage = this.store.beginEventStorage(t.id, t.turn);
    const begin = Date.now();
    let timer: NodeJS.Timeout | undefined;
    const costBefore = t.cost_usd ?? 0;

    const { signal } = a.abort;

    try {
      validateBudgets(this.providers.get(t.provider), t);
      const provider = this.providers.get(t.provider)!;
      const startup = this.turnStartup();
      const newSession = await startTurn(startup, t, provider, begin, signal);
      const remaining = remainingRuntime(t);

      if (remaining !== Infinity) {
        timer = setTimeout(() => {
          t.status = "failed";
          t.error_code = "runtime_budget_exhausted";
          a.abort.abort(new RunError(t.error_code));
        }, remaining);
      }

      const prompt = await turnPrompt(startup, t, newSession, signal);
      const sentBefore = t.instructions_sent;
      // The session holds these from now on, so a resumed turn gets only later ones.
      t.instructions_sent = this.store.messages.count(t.id);
      this.store.save(t);

      const output = await measureTaskWait(
        "provider_run",
        { task_id: t.id, turn: t.turn },
        () => provider.run(this.runContext(t, a, sentBefore), prompt),
        { signal, end: () => ({ input_wait_ms: a.input.waitedMs }) },
      );

      signal.throwIfAborted();
      this.recordReply(t, output.reply, signal);
      t.status = "completed";
    } catch (caught) {
      const error: unknown = signal.aborted ? signal.reason : caught;

      if (!a.stopStatus && !signal.aborted) {
        logError("task.execution_failed", error, { turn: t.turn });
      }

      if (!a.stopStatus && t.status !== "interrupted") {
        t.status = "failed";

        t.error ??=
          (error instanceof Error ? error.message : String(error)) || undefined;

        if (error instanceof RunError) t.error_code ??= error.code;
      }
    } finally {
      clearTimeout(timer);

      await this.finishTurn(t, a, {
        runtime: Date.now() - begin,
        costBefore,
        finishStorage,
      });
    }
  }

  private turnStartup(): TurnStartupContext {
    return {
      store: this.store,
      workspaces: this.workspaces,
      changes: this.changes,
      prompts: this.prompts,
      projects: this.projects,
      ownerWorker: this.ownerWorker,
      settings: (owner) => this.settings.values(owner),
      branchPrefix: (owner) =>
        this.settings.values(owner).task.worktree_branch_prefix,
    };
  }

  /** What the provider calls back into while the turn runs. */
  private runContext(t: Task, a: Active, sentBefore: number): RunContext {
    return {
      task: t,
      ...(this.attachments.list(t.id).length
        ? { attachments: this.attachments.folder(t.id) }
        : {}),
      fileChanged: (edit) => this.changes.record(t, edit),
      editUnrecorded: (path, source) =>
        this.changes.unrecorded(t, path, source),
      signal: a.abort.signal,
      promptHeld: () => {
        t.instructions_sent = sentBefore;
      },
      acceptSteers: (sink) => {
        a.sink = sink;

        // Steers sent before the provider was ready go now.
        for (const steer of [...t.pending_steers]) {
          this.deliver(t, a, steer);
        }
      },
      steerTaken: (id) => {
        const taken = t.pending_steers.find((m) => m.id === id);
        if (!taken) return;
        t.pending_steers.splice(t.pending_steers.indexOf(taken), 1);

        this.store.transaction(() => {
          // The session has it now, like the turn's prompt.
          this.store.messages.add(t.id, taken);
          t.instructions_sent = this.store.messages.count(t.id);
          this.store.save(t);
          this.store.event(t, "task.steer_taken", { message_id: id });
        });
      },
      delta: (messageId, text) =>
        this.drafts.append(t.owner, t.id, messageId, text),
      emit: <K extends EventType, D extends EventPayloadMap[K]>(
        type: K,
        data: D,
      ) => {
        const event = this.store.transaction(() => {
          const event = this.store.event(t, type, data);

          const completed =
            event.view.kind === "known" && event.view.type === "agent.completed"
              ? event.view.data
              : undefined;

          if (typeof completed?.cost_usd === "number") {
            // The provider reports the session's cumulative cost, which
            // includes the turns a resumed session already ran. One lower
            // than before started counting again.
            const before = t.session_cost_usd ?? 0;

            t.cost_usd =
              (t.cost_usd ?? 0) +
              (completed.cost_usd >= before
                ? completed.cost_usd - before
                : completed.cost_usd);

            t.session_cost_usd = completed.cost_usd;
            this.store.save(t);
          }

          return event;
        });

        // The stored message replaces its draft.
        if (type === "agent.message") {
          this.drafts.clear(
            t.id,
            eventPayload(event, "agent.message")?.message_id ??
              event.presentation?.messageId,
          );
        }
      },
      emitOpaque: (type, data) => {
        this.store.transaction(() => {
          this.store.eventOpaque(t, type, data);
        });
      },
      session: (id, ref) => {
        if (t.session_id !== id) delete t.session_state_ref;
        t.session_id = id;
        if (ref) t.session_state_ref = ref;
        t.session_owner = this.ownerWorker;
        this.store.save(t);
      },
      effectiveOptions: (effective) => {
        t.provider_options = withEffectiveOptions(t, effective);
        this.store.save(t);
      },
      input: a.input.request,
    };
  }

  /**
   * Records a turn's end whatever its outcome: its runtime,
   * the turn-ended and status events, and what follows it. The task is
   * released for scheduling even if recording fails.
   */
  private async finishTurn(
    t: Task,
    a: Active,
    turn: {
      runtime: number;
      costBefore: number;
      finishStorage: (status: string) => void;
    },
  ) {
    t.runtime_ms += turn.runtime;
    delete t.run_started_at;
    delete a.sink;

    if (a.stopStatus) {
      t.status = a.stopStatus;
      delete t.error;
      delete t.error_code;
    }

    delete t.pending_input;
    delete t.waiting_reason;
    t.completed_at = now();

    const outcome = t.status as "completed" | "failed" | "interrupted";

    try {
      this.drafts.clear(t.id);

      // The turn's end, what follows it and the task's new status commit together.
      this.store.transaction(() => {
        this.store.event(t, "task.turn_ended", {
          turn: t.turn,
          outcome,
          runtime_ms: turn.runtime,
          cost_usd: (t.cost_usd ?? 0) - turn.costBefore,
        });

        this.endTurn(t, outcome, a.sendPending);
        this.store.save(t);
        recordStatusEvent(this.store, t);
      });
    } finally {
      // Settle diagnostics before queued work can start and replace its counters.
      turn.finishStorage(outcome);
      // A failed write must not leave the task held as running.
      this.active.delete(t.id);
      this.queueWaits.capacity(this.active.size >= this.concurrency);
      if (!this.stopped) queueMicrotask(() => void this.schedule());
    }
  }

  /**
   * What follows a turn. Interrupt and send now starts the next turn with
   * the pending steers. Otherwise steers the turn didn't take move to the
   * front of the queue; an interrupted or failed turn pauses the queue, and
   * a completed one goes straight on to the next queued message, so the task
   * never shows as completed in between.
   */
  private endTurn(
    t: Task,
    outcome: "completed" | "failed" | "interrupted",
    sendPending?: boolean,
  ) {
    const before = queueSnapshot(t);

    if (sendPending && t.pending_steers.length) {
      this.store.messages.add(t.id, ...t.pending_steers);
      t.pending_steers = [];
      requeue(t);
      this.queuedAfterCommit(t, "interrupt_send");
    } else {
      leaveOver(t);

      if (outcome !== "completed") {
        if (t.queue.length) t.queue_paused = true;
      } else if (t.queue.length && !t.queue_paused) {
        deliverQueued(this.store, t, t.queue.shift()!);
        requeue(t);
        this.queuedAfterCommit(t, "queued_message");
      }
    }

    recordQueueChange(this.store, t, before);
  }

  /** Starts observing a queue wait once the turn's end commits. */
  private queuedAfterCommit(t: Task, cause: QueueCause) {
    this.store.database.afterCommit(() => this.queueWaits.queued(t.id, cause));
  }

  /**
   * Sends a pending steer to the provider. One the turn can't take any more
   * waits at the front of the queue instead.
   */
  private deliver(t: Task, a: Active, steer: TaskMessage) {
    if (!a.sink || a.sink({ id: steer.id, text: steer.message })) return true;
    const before = queueSnapshot(t);
    t.pending_steers = t.pending_steers.filter((m) => m.id !== steer.id);
    t.queue.unshift({ ...steer, delivery: "steer", recorded: true });
    commitQueue(this.store, t, before);

    return false;
  }

  /** Records the successful turn's final reply. */
  private recordReply(t: Task, text: string, signal: AbortSignal) {
    signal.throwIfAborted();
    this.drafts.clear(t.id);
    this.store.event(t, "agent.reply", { text, turn: t.turn });
  }

  /** Holds execution controls while asynchronous deletion removes task resources. */
  private mutableTask(owner: string, id: string) {
    const task = this.store.get(id, owner);
    if (this.deleting.has(id)) throw new Error("Task is being deleted");

    return task;
  }

  /** Changes the display title, including the task held by an active turn. */
  rename(owner: string, id: string, title: string) {
    const current = this.mutableTask(owner, id);
    const normalized = title.trim();

    if (!normalized || normalized.length > 200) {
      throw new Error("Task title must contain 1 to 200 characters");
    }

    const task = this.active.get(id)?.task ?? current;
    task.title = normalized;
    this.store.save(task);

    return task;
  }

  /** Worktree actions and deletion wait until the task isn't running or about to. */
  private idleWorktreeTask(
    owner: string,
    id: string,
    action = "changing its worktree",
  ) {
    const t = this.mutableTask(owner, id);

    if (
      this.active.has(id) ||
      ["queued", "starting", "running", "waiting"].includes(t.status)
    ) {
      throw new Error(`Wait until the task stops before ${action}.`);
    }

    return t;
  }

  /**
   * Deletes a task and everything related to it: its events, stored requests
   * and a worktree task's worktree and branch,
   * uncommitted changes included. A running, queued or waiting task is
   * interrupted first, since deleting is the only way to end a task for good.
   * `deleteAgentTask` also deletes the provider's session, which the task
   * could otherwise continue from.
   */
  async delete(
    owner: string,
    ids: string | string[],
    deleteAgentTask = false,
    confirmation?: string,
  ) {
    const doomed = [...new Set([ids].flat())];
    for (const id of doomed) this.mutableTask(owner, id);
    for (const id of doomed) this.deleting.add(id);

    try {
      let versions: Map<string, DeletionVersions> | undefined;

      if (confirmation) {
        await confirmedTaskDeletion(
          this,
          owner,
          doomed,
          deleteAgentTask,
          confirmation,
        );

        // Stop every selected task, then verify the reviewed list again.
        for (const id of doomed) {
          const active = this.active.get(id);
          if (active) await this.interruptActive(owner, id, active);
        }

        const prepared = await confirmedTaskDeletion(
          this,
          owner,
          doomed,
          deleteAgentTask,
          confirmation,
        );

        versions = prepared.versions;
      }

      for (const id of doomed) {
        await this.deleteResources(
          owner,
          id,
          deleteAgentTask,
          versions?.get(id),
        );
      }
    } finally {
      for (const id of doomed) this.deleting.delete(id);
    }

    return { status: "deleted" as const };
  }

  taskDeletionPreview(
    owner: string,
    ids: string[],
    includeSession: boolean,
    project?: string,
  ) {
    return taskDeletionPreview(this, owner, ids, includeSession, project);
  }

  /** Holds the whole batch against scheduling and new tasks before cleanup yields. */
  async removeProject(
    owner: string,
    repository: string,
    deleteTasks = false,
    confirmation?: string,
    deleteAgentTasks = false,
  ) {
    if (!this.projects) {
      throw new Error("Project management is unavailable in this service.");
    }

    if (this.projectGuard.isRemoving(repository)) {
      throw new Error("Project task data is being removed");
    }

    if (!deleteTasks) {
      this.projectGuard.stopStarts(repository);

      return this.projects.remove(repository, true);
    }

    const tasks = projectDeletionTasks(this, owner, repository);

    const ids = new Set(tasks.map((task) => task.id));

    if (tasks.some((task) => this.deleting.has(task.id))) {
      throw new Error(
        "A project task is already being removed. Wait and retry.",
      );
    }

    this.projectGuard.beginRemoval(repository);
    for (const id of ids) this.deleting.add(id);

    try {
      if (confirmation) {
        await confirmedTaskDeletion(
          this,
          owner,
          [...ids],
          deleteAgentTasks,
          confirmation,
          repository,
        );
      }

      // Keep the whole batch locked until every turn has finished stopping.
      const stopped = await Promise.allSettled(
        tasks.map((task) => {
          const active = this.active.get(task.id);

          return active
            ? this.interruptActive(owner, task.id, active)
            : Promise.resolve();
        }),
      );

      const failure = stopped.find((result) => result.status === "rejected");
      if (failure?.status === "rejected") throw failure.reason;

      const prepared = confirmation
        ? await confirmedTaskDeletion(
            this,
            owner,
            [...ids],
            deleteAgentTasks,
            confirmation,
            repository,
          )
        : undefined;

      for (const task of tasks) {
        await this.deleteResources(
          owner,
          task.id,
          deleteAgentTasks,
          prepared?.versions.get(task.id),
        );
      }

      return this.projects.remove(repository, true);
    } catch (error) {
      throw new Error(
        `Project removal stopped; its approval is retained. Some extension task data may already be removed. ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    } finally {
      this.projectGuard.endRemoval(repository);
      for (const id of ids) this.deleting.delete(id);
    }
  }

  private async deleteResources(
    owner: string,
    id: string,
    deleteAgentTask: boolean,
    versions?: DeletionVersions,
  ) {
    try {
      const a = this.active.get(id);
      if (a) await this.interruptActive(owner, id, a);
      const t = this.store.get(id, owner);

      // Keep the local task available to retry if provider cleanup fails.
      if (deleteAgentTask && t.session_id) {
        const provider = this.providers.get(t.provider);

        if (!provider?.deleteSession) {
          throw new Error("Provider session deletion is unavailable");
        }

        await provider.deleteSession(t, versions?.session);
      }

      await this.workspaces.discard(t, versions?.workspace);
      this.store.delete(id, owner);
      this.queueWaits.ended(id, "aborted");

      await this.attachments.discard(id);

      return { status: "deleted" as const };
    } finally {
      this.deleting.delete(id);
    }
  }

  /**
   * Removes a task's worktree and keeps its branch. With uncommitted
   * changes, it removes nothing and lists them, unless `force` is set.
   */
  async removeWorktree(owner: string, id: string, force = false) {
    const t = this.idleWorktreeTask(owner, id);
    const result = await this.workspaces.removeWorktree(t, force);

    if (result.status === "removed") {
      t.workspace_removed = true;
      this.store.save(t);

      this.store.event(t, "task.worktree_removed", {
        path: t.workspace,
        branch: t.branch,
        forced: force,
      });
    }

    return result;
  }

  /** Deletes a task's branch, once its worktree is removed. */
  async deleteBranch(owner: string, id: string) {
    const t = this.idleWorktreeTask(owner, id);
    await this.workspaces.deleteBranch(t);
    t.branch_deleted = true;
    this.store.save(t);
    this.store.event(t, "task.branch_deleted", { branch: t.branch });

    return { status: "deleted" as const };
  }

  /**
   * Interrupts a task's turn, or a queued or waiting task before its turn
   * starts. A plain interrupt pauses the queue and keeps pending steers at
   * its front; `sendPending` (interrupt and send now) starts the next turn
   * with them instead.
   */
  async interrupt(owner: string, id: string, sendPending = false) {
    const t = this.mutableTask(owner, id);
    const a = this.active.get(id);

    if (a) {
      a.sendPending = sendPending;

      return this.interruptActive(owner, id, a);
    }

    if (!BUSY.includes(t.status)) {
      throw new Error(`Cannot interrupt a ${t.status} task`);
    }

    t.status = "interrupted";
    t.completed_at = now();
    delete t.waiting_reason;
    const before = queueSnapshot(t);
    if (t.queue.length) t.queue_paused = true;

    commitQueue(this.store, t, before, () =>
      this.store.event(t, "task.interrupted"),
    );

    this.queueWaits.ended(id, "aborted");
    void this.schedule();

    return t;
  }

  /** Stops a running turn and waits until its end is recorded. */
  private async interruptActive(owner: string, id: string, a: Active) {
    // Mark the execution's object through its abort callback, then await
    // durable finalization.
    a.stopStatus = "interrupted";

    this.store.event(a.task, "task.control_requested", {
      status: "interrupted",
    });

    await measureTaskWait("interrupt_shutdown", { task_id: id }, () => {
      a.abort.abort(new Error("interrupted"));

      return a.done;
    });

    return this.store.get(id, owner);
  }

  /** Applies a budget increase to an idle task without starting a turn. */
  applyBudget(owner: string, id: string, raise: BudgetRaise) {
    const task = this.mutableTask(owner, id);

    if (this.active.has(id) || BUSY.includes(task.status)) {
      throw new Error("A task's budget can only be changed while it is idle.");
    }

    const { budget, raised } = raisedBudget(
      task,
      raise,
      this.providers.get(task.provider),
    );

    task.budget = budget;
    task.budget_raised_for_turn = raised;
    this.store.save(task);

    return task;
  }

  /**
   * Sends a message to a task. On an idle task every delivery starts the
   * next turn (see `followUp`). While a turn runs, a steer goes into it at
   * the next tool boundary, a queued message waits for a turn of its own,
   * and an interrupt stops the turn and starts the next one with it and any
   * pending steers. A worker waiting for input can't be steered. `budget`
   * raises the task's budget first.
   */
  async send(
    owner: string,
    id: string,
    message: string,
    from: Sender,
    options: SendOptions = {},
  ) {
    return this.sendRequests.run(owner, id, from, message, options, (record) =>
      this.sendOnce(owner, id, message, from, options, record),
    );
  }

  private async sendOnce(
    owner: string,
    id: string,
    message: string,
    from: Sender,
    options: SendOptions,
    record: RecordSend,
  ): Promise<SentMessage> {
    const delivery = options.delivery ?? "steer";
    const stored = this.mutableTask(owner, id);
    const a = this.active.get(id);

    if (!a && !BUSY.includes(stored.status)) {
      return this.followUp(owner, id, message, from, options, record);
    }

    const t = a?.task ?? stored;

    if (t.pending_input && delivery === "steer") {
      throw new Error(
        "The worker is waiting for input, so it can't be steered. Answer its request, or queue the message.",
      );
    }

    const m: TaskMessage = { id: `msg_${randomUUID()}`, message, from };

    if (delivery === "queue") {
      const before = queueSnapshot(t);

      commitSend(
        this.store,
        t,
        () => {
          if (options.budget) raiseBudget(t, options.budget);
          t.queue.push({ ...m, delivery });
          this.store.save(t);
          recordQueueChange(this.store, t, before);
          record(m.id, "queued");
        },
        options.request_id,
      );

      return { task: t, message_id: m.id, state: "queued" as const };
    }

    commitSend(
      this.store,
      t,
      () => {
        if (options.budget) raiseBudget(t, options.budget);
        if (!a) this.store.messages.add(t.id, m);
        else t.pending_steers.push(m);
        recordMessage(this.store, t, m, delivery);
        this.store.save(t);

        record(
          m.id,
          !a || delivery === "interrupt" ? "started" : "pending_steer",
        );
      },
      options.request_id,
    );

    if (!a) return { task: t, message_id: m.id, state: "started" as const };

    if (delivery === "interrupt") {
      await this.interrupt(owner, id, true);

      return {
        task: this.store.get(id, owner),
        message_id: m.id,
        state: "started" as const,
      };
    }

    const pending = this.deliver(t, a, m);
    if (!pending) record(m.id, "queued");

    return {
      task: t,
      message_id: m.id,
      state: pending ? ("pending_steer" as const) : ("queued" as const),
    };
  }

  /**
   * Starts an idle task's next turn with a message: it resumes the task's
   * session, or starts a new one when it can't, and recreates a removed
   * worktree. Sending resumes a paused queue, whose messages follow.
   */
  private async followUp(
    owner: string,
    id: string,
    message: string,
    from: Sender,
    options: SendOptions,
    record: RecordSend,
  ): Promise<SentMessage> {
    const t = this.mutableTask(owner, id);

    if (this.active.has(id) || BUSY.includes(t.status)) {
      throw new Error("The task is busy; wait until its turn ends.");
    }

    if (options.budget) raiseBudget(t, options.budget);
    validateBudgets(this.providers.get(t.provider), t);

    if (this.projects) {
      await measureTaskWait(
        "repository_validation",
        { task_id: id, send_ref: sendRef(options.request_id) },
        () => this.projects!.resolve(t.repository),
      );
    }

    // Recheck after the awaits, so deletion can't resurrect a task. A turn
    // that started meanwhile takes the message as a running-task send.
    const current = this.mutableTask(owner, id);

    if (this.active.has(id) || BUSY.includes(current.status)) {
      return this.sendOnce(owner, id, message, from, options, record);
    }

    const m: TaskMessage = { id: `msg_${randomUUID()}`, message, from };
    const before = queueSnapshot(t);

    commitSend(
      this.store,
      t,
      () => {
        this.store.messages.add(t.id, m);
        delete t.queue_paused;
        requeue(t);
        this.store.save(t);
        recordMessage(this.store, t, m, options.delivery ?? "steer");
        recordQueueChange(this.store, t, before);
        this.store.event(t, "task.queued");
        // A task that runs again is back in the user's lists.
        this.archive.unarchive(t);
        record(m.id, "started");
      },
      options.request_id,
    );

    this.queueWaits.queued(id, "followup");
    void this.schedule();

    return { task: t, message_id: m.id, state: "started" };
  }

  /** The task's queue, as Control holds it while a turn runs. */
  private queueTask(owner: string, id: string) {
    const stored = this.mutableTask(owner, id);

    return this.active.get(id)?.task ?? stored;
  }

  /** Sends a queued message into the busy task without changing its identity. */
  steerQueued(owner: string, id: string, messageId: string) {
    const t = this.queueTask(owner, id);
    const a = this.active.get(id);

    if (a?.abort.signal.aborted) throw new Error("Task was interrupted.");

    const m = steerQueuedMessage(this.store, t, messageId, !!a);
    if (a) this.deliver(t, a, m);

    return t;
  }

  /** Changes a queued message's text before it's sent. */
  editQueued(owner: string, id: string, messageId: string, message: string) {
    const t = this.queueTask(owner, id);
    editQueuedMessage(this.store, t, messageId, message);

    return t;
  }

  /** Moves a queued message to `index`, behind steers the worker already has. */
  moveQueued(owner: string, id: string, messageId: string, index: number) {
    const t = this.queueTask(owner, id);
    moveQueuedMessage(this.store, t, messageId, index);

    return t;
  }

  /** Removes a queued message; the parent agent can remove only its own. */
  removeQueued(owner: string, id: string, messageId: string, by: Sender) {
    const t = this.queueTask(owner, id);
    removeQueuedMessage(this.store, t, messageId, by);

    return t;
  }

  /** Removes the listed queued messages, or every one without a list. */
  clearQueue(owner: string, id: string, messageIds?: readonly string[]) {
    const t = this.queueTask(owner, id);
    clearQueuedMessages(this.store, t, messageIds);

    return t;
  }

  /**
   * Puts removed queued messages back, for the user's undo. A task that isn't
   * busy keeps them paused, and an archived task returns to the lists.
   */
  restoreQueued(owner: string, id: string, placements: QueuePlacement[]) {
    const t = this.queueTask(owner, id);
    const busy = this.active.has(id) || BUSY.includes(t.status);

    // A task with messages queued again is back in the user's lists.
    restoreQueuedMessages(this.store, t, placements, busy, () =>
      this.archive.unarchive(t),
    );

    return t;
  }

  /** Resumes a paused queue; an idle task starts its next queued message. */
  resumeQueue(owner: string, id: string) {
    const t = this.queueTask(owner, id);
    const before = queueSnapshot(t);
    delete t.queue_paused;

    if (!this.active.has(id) && !BUSY.includes(t.status) && t.queue.length) {
      const next = t.queue.shift()!;
      requeue(t);

      this.store.transaction(() => {
        deliverQueued(this.store, t, next);
        this.store.save(t);
        recordQueueChange(this.store, t, before);
        this.store.event(t, "task.queued");
      });

      this.queueWaits.queued(id, "resume");
      void this.schedule();

      return t;
    }

    commitQueue(this.store, t, before);

    return t;
  }

  input(
    owner: string,
    id: string,
    requestId: string,
    approved: boolean,
    input?: Record<string, unknown>,
    message?: string,
    authority: InputAuthority = "user",
  ) {
    const t = this.mutableTask(owner, id);

    if (t.pending_input?.id !== requestId) {
      throw new Error("Input request is stale");
    }

    if (
      pendingInputKind(t.pending_input) !== "question" &&
      authority !== "user" &&
      !this.providers.get(t.provider)?.taskPolicy.parentMayApprove(t)
    ) {
      throw new Error(
        "This permission requires user approval; use the approval buttons in the panel",
      );
    }

    const a = this.active.get(id);
    if (!a?.input.waiting) throw new Error("No active input request");

    this.store.event(t, "agent.input_decision", {
      request_id: requestId,
      approved,
      authority,
    });

    a.input.submit({ approved, input, message });

    return this.store.get(id, owner);
  }

  /**
   * Prepares for a newer service to take over: starts no more turns, then
   * waits up to `limit` ms for running ones to end. Queued tasks stay queued
   * for the next service. close() interrupts any turn still running.
   */
  async drain(limit: number) {
    this.stopped = true;
    let timer: NodeJS.Timeout | undefined;

    await Promise.race([
      Promise.allSettled([...this.active.values()].map((a) => a.done)),
      new Promise((resolve) => (timer = setTimeout(resolve, limit))),
    ]);

    clearTimeout(timer);
  }

  async close() {
    this.stopped = true;

    const tasks = await Promise.allSettled(
      [...this.active.keys()].map((id) => {
        const t = this.store.all().find((t) => t.id === id)!;

        return ["completed", "failed"].includes(t.status)
          ? this.active.get(id)!.done
          : this.interrupt(t.owner, id);
      }),
    );

    const providers = await Promise.allSettled(
      [...this.providers.values()].map(async (provider) => provider.close?.()),
    );

    this.store.close();

    const errors = [...tasks, ...providers].flatMap((result) =>
      result.status === "rejected" ? [result.reason] : [],
    );

    if (errors.length) {
      throw new AggregateError(errors, "Worker shutdown incomplete");
    }
  }
}
