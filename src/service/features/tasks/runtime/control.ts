import { randomUUID } from "node:crypto";
import { hostname } from "node:os";

import { providerMetadata } from "../../../../shared/providers/metadata.js";
import { assertSelectedProviderOptions } from "../../../../shared/providers/options.js";
import { replyExcerpt } from "../../../../shared/tasks/conversation/reply.js";
import {
  type BudgetRaise,
  budgetRaiseSchema,
  type Delivery,
  type InputAuthority,
  pendingInputKind,
  type QueuedMessage,
  type Sender,
  type Start,
  startSchema,
  type Task,
  type TaskMessage,
} from "../../../../shared/tasks/model.js";
import { now } from "../../../../shared/time.js";
import { Projects } from "../../projects/projects.js";
import { type Provider, type Steer } from "../../providers/types.js";
import { Settings } from "../../settings/settings.js";
import { headCommit, Workspaces } from "../../workspaces/workspace.js";
import { Drafts } from "../conversation/drafts.js";
import { SessionPrompts } from "../conversation/session-prompts.js";
import { PendingInput } from "../input/pending-input.js";
import { ActivityPages } from "../storage/activity-pages.js";
import { Store } from "../storage/store.js";
import { generateTaskTitle } from "./task-title.js";

/** Statuses in which a task has a turn running, starting or about to. */
const BUSY = ["queued", "starting", "running", "waiting"];

/** The SDK message id a stored worker message carries, which its draft shares. */
function storedMessageId(data: Record<string, unknown>) {
  const raw = data.raw_response as { message?: { id?: unknown } } | undefined;

  return typeof raw?.message?.id === "string" ? raw.message.id : undefined;
}

interface Active {
  /** The task as the turn holds it; changes while it runs go here. */
  task: Task;
  input: PendingInput;
  stopStatus?: "interrupted";
  /** Interrupt and send now: the pending steers start the next turn. */
  sendPending?: boolean;
  /** Where the provider takes steers, once it registers. */
  sink?: (steer: Steer) => boolean;
  abort: AbortController;
  done: Promise<void>;
}

export class Control {
  active = new Map<string, Active>();
  private deleting = new Set<string>();
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
  private removingProjects = new Set<string>();
  constructor(
    public store: Store,
    public workspaces: Workspaces,
    public providers: Map<string, Provider>,
    public repository: string,
    public concurrency = 3,
  ) {
    this.settings = new Settings(
      store.database,
      () => [...providers.keys()],
      (id) => providerMetadata(id, providers.get(id)?.metadata),
    );

    this.prompts = new SessionPrompts(store, workspaces);
    this.drafts = new Drafts(store.bus);
    this.activity = new ActivityPages(store);
  }

  async recover() {
    for (const t of this.store.all()) {
      if (
        ["starting", "running", "waiting"].includes(t.status) &&
        t.waiting_reason !== "waiting_for_dependency"
      ) {
        t.status = "interrupted";
        delete t.pending_input;
        delete t.waiting_reason;

        t.error = "Service restarted; send a message to continue.";
        t.completed_at = now();
        // Steers still inside the provider were lost with it, so they wait
        // at the front of the queue, which pauses as after any interrupt.
        const queue = this.queueSnapshot(t);
        this.leaveOver(t);
        if (t.queue.length) t.queue_paused = true;

        this.store.transaction(() => {
          this.store.save(t);

          this.store.event(t, "task.interrupted", {
            reason: "service_restart",
          });

          this.queueChanged(t, queue);
        });
      }
    }

    void this.schedule();
  }

  workers() {
    return [...this.providers.values()].map((p) => ({
      provider: p.id,
      capabilities: p.capabilities,
      metadata: p.metadata,
      profiles: [
        "researcher",
        "reviewer",
        "implementer",
        "debugger",
        "test_engineer",
        "refactorer",
        "security_reviewer",
      ],
    }));
  }

  async availableWorkers() {
    return Promise.all(
      this.workers().map(async (worker) => {
        const provider = this.providers.get(worker.provider)!;
        const readiness = await provider.readiness?.();
        const known = readiness ? { ...worker, readiness } : worker;
        // Model discovery launches the runtime, so it waits until that is ready.
        if (!provider.models || readiness?.ready === false) return known;

        try {
          return { ...known, models: await provider.models() };
        } catch {
          return {
            ...known,
            model_discovery_error:
              "Model discovery unavailable; enter a model ID or retry later.",
          };
        }
      }),
    );
  }

  async start(
    owner: string,
    input: unknown,
    authority: InputAuthority = "user",
  ) {
    const parsed = startSchema.parse(this.settings.taskInput(owner, input));
    assertSelectedProviderOptions(parsed.provider, parsed.provider_options);
    const provider = this.providers.get(parsed.provider);
    if (!provider) throw new Error("Provider is not enabled");
    const readiness = await provider.readiness?.();
    if (readiness?.ready === false) throw new Error(readiness.message);
    const policy = provider.taskPolicy;

    const options = policy.prepareStart({
      input: parsed,
      defaults: this.settings.values(owner),
      authority,
    });

    const req = {
      ...parsed,
      ...options,
      title: generateTaskTitle(parsed.description),
      description: parsed.description.trim(),
    };

    if (!req.title) throw new Error("Task title is required");
    if (!req.description) throw new Error("Task description is required");

    if (
      provider?.models &&
      req.reasoning_effort &&
      req.reasoning_effort !== "default"
    ) {
      // Unknown or unavailable metadata leaves final validation to the provider.
      const models = await provider.models().catch(() => []);

      const model = models.find(
        (item) => item.value === (req.model || "default"),
      );

      if (
        model &&
        (model.supportsEffort === false ||
          (model.supportedEffortLevels !== undefined &&
            !model.supportedEffortLevels.includes(req.reasoning_effort)))
      )
        throw new Error(
          `Model ${model.value} does not support reasoning effort ${req.reasoning_effort}`,
        );
    }

    this.validateBudgets(req);
    if (req.workspace_strategy === "current_repo" && req.revision !== "HEAD")
      throw new Error("Current repository workspace requires revision HEAD");
    for (const id of req.depends_on) this.store.get(id, owner);

    const repository = this.projects
      ? await this.projects.resolve(req.repository)
      : await this.workspaces.repository(
          req.repository === "current" ? this.repository : req.repository,
        );

    // Repository resolution can yield while a dependency is being deleted.
    if (this.removingProjects.has(repository))
      throw new Error("Project task data is being deleted");
    for (const id of req.depends_on) this.mutableTask(owner, id);

    const t: Task = {
      ...req,
      repository,
      id: `task_${randomUUID()}`,
      owner,
      created_by: authority,
      status: "queued",
      instructions: [],
      instructions_sent: 0,
      pending_steers: [],
      queue: [],
      created_at: now(),
      updated_at: now(),
      turn: 0,
      runtime_ms: 0,
    };

    this.store.transaction(() => {
      this.store.save(t);
      this.store.event(t, "task.queued");
    });

    void this.schedule();

    return t;
  }

  private validateBudgets(req: Start) {
    const p = this.providers.get(req.provider);
    if (!p) throw new Error("Provider is not enabled");
    if (req.budget.max_cost_usd !== null && !p.capabilities.cost_budget)
      throw new Error(
        "Provider does not support cost budgets; explicitly set max_cost_usd to null to run without a cost limit",
      );
    if (req.budget.max_tokens && !p.capabilities.token_budget)
      throw new Error("Provider does not support token budgets");
    if (!p.capabilities.runtime_budget)
      throw new Error("Provider does not support runtime budgets");
  }

  async schedule() {
    if (this.scheduling || this.stopped) return;
    this.scheduling = true;

    try {
      for (const t of this.store.all().reverse()) {
        if (this.active.size >= this.concurrency) break;
        if (this.deleting.has(t.id)) continue;
        if (
          t.status !== "queued" &&
          !(
            t.status === "waiting" &&
            t.waiting_reason === "waiting_for_dependency"
          )
        )
          continue;
        const deps = t.depends_on.map((id) => this.store.get(id, t.owner));
        const failed = deps.find((d) => d.status === "failed");

        if (failed) {
          t.status = "failed";
          t.error = `Dependency ${failed.id} failed`;
          t.completed_at = now();
          delete t.waiting_reason;
          delete t.waiting_for;

          this.store.transaction(() => {
            this.store.save(t);
            this.store.event(t, "task.failed", { error: t.error });
          });

          continue;
        }

        // A dependent starts once its dependency has completed a turn, and
        // not while the dependency runs another.
        const pending = deps.find(
          (d) =>
            this.active.has(d.id) ||
            BUSY.includes(d.status) ||
            !this.store.latestEvent(d.id, "task.completed"),
        );

        if (pending) {
          if (t.status !== "waiting" || t.waiting_for !== pending.id) {
            t.status = "waiting";
            t.waiting_reason = "waiting_for_dependency";
            t.waiting_for = pending.id;

            this.store.transaction(() => {
              this.store.save(t);

              this.store.event(t, "task.waiting", {
                reason: t.waiting_reason,
                dependency_id: pending.id,
              });
            });
          }

          continue;
        }

        delete t.waiting_reason;
        delete t.waiting_for;
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
            () => this.recordEnd(t),
          ),
        };

        this.active.set(t.id, active);
        active.done = this.execute(t, active);
      }
    } finally {
      this.scheduling = false;
    }
  }

  async execute(t: Task, a: Active) {
    const begin = Date.now();
    let timer: NodeJS.Timeout | undefined;
    let turnStarted = false;
    let reply: string | undefined;
    const costBefore = t.cost_usd ?? 0;

    try {
      this.validateBudgets(t);
      if (this.projects) await this.projects.resolve(t.repository);

      const created = !t.workspace;

      if (created) {
        await this.workspaces.create(
          t,
          this.settings.values(t.owner).worktree_branch_prefix,
        );

        this.store.save(t);
      } else if (await this.workspaces.worktreeMissing(t)) {
        // Remove worktree only frees disk space; the next turn brings it back.
        const from = await this.workspaces.recreateWorktree(t);

        this.store.transaction(() => {
          this.store.save(t);
          this.store.event(t, "task.worktree_recreated", { from });
        });
      }

      // Every turn replaces the turn snapshot. A new current_repo task's
      // start snapshot is the same moment.
      t.turn_start_tree =
        created && t.start_tree
          ? t.start_tree
          : await this.workspaces.snapshot(t.workspace!);

      await this.workspaces.pin(t, "turn-start", t.turn_start_tree);
      // Where the turn's later commits start, for its uncommitted changes.
      t.turn_head = await headCommit(t.workspace!);
      // Changes are live again until this turn ends.
      delete t.end_tree;
      turnStarted = true;
      this.store.save(t);
      if (a.abort.signal.aborted) throw a.abort.signal.reason;
      const provider = this.providers.get(t.provider)!;

      const newSession = await this.prompts.newSessionReason(
        t,
        provider,
        this.ownerWorker,
      );

      if (newSession) {
        // The session can't continue, so this turn starts another.
        delete t.session_id;
        delete t.session_state_ref;
        delete t.session_cost_usd;
      }

      t.status = "running";
      t.started_at ??= now();
      t.run_started_at = new Date(begin).toISOString();
      t.session_owner = this.ownerWorker;

      this.store.transaction(() => {
        if (newSession && t.turn > 1)
          this.store.event(t, "task.session_started", { reason: newSession });

        this.store.save(t);
        this.store.event(t, "task.started", { turn: t.turn });
      });

      const remaining =
        t.budget.max_runtime_minutes === null
          ? Infinity
          : t.budget.max_runtime_minutes * 60000 - t.runtime_ms;

      if (remaining <= 0) throw new Error("Runtime budget exhausted");
      if (
        t.budget.max_cost_usd !== null &&
        (t.cost_usd ?? 0) >= t.budget.max_cost_usd
      )
        throw new Error("Cost budget exhausted");
      if (remaining !== Infinity)
        timer = setTimeout(() => {
          t.status = "failed";
          t.error = "Runtime budget exhausted";
          a.abort.abort(new Error(t.error));
        }, remaining);

      const prompt = newSession
        ? await this.prompts.sessionPrompt(t)
        : this.prompts.resumedPrompt(t);

      // The session holds these from now on, so a resumed turn gets only later ones.
      t.instructions_sent = t.instructions.length;
      this.store.save(t);

      const output = await provider.run(
        {
          task: t,
          signal: a.abort.signal,
          acceptSteers: (sink) => {
            a.sink = sink;
            // Steers sent before the provider was ready go now.
            for (const steer of [...t.pending_steers])
              this.deliver(t, a, steer);
          },
          steerTaken: (id) => {
            const index = t.pending_steers.findIndex((m) => m.id === id);
            if (index < 0) return;
            const [taken] = t.pending_steers.splice(index, 1);
            // The session has it now, like the turn's prompt.
            t.instructions.push(taken);
            t.instructions_sent = t.instructions.length;

            this.store.transaction(() => {
              this.store.save(t);
              this.store.event(t, "task.steer_taken", { message_id: id });
            });
          },
          delta: (messageId, text) =>
            this.drafts.append(t.owner, t.id, messageId, text),
          emit: (type, data) => {
            this.store.transaction(() => {
              if (
                type === "agent.completed" &&
                typeof data.cost_usd === "number"
              ) {
                // The provider reports the session's cumulative cost, which
                // includes the turns a resumed session already ran. One lower
                // than before started counting again.
                const before = t.session_cost_usd ?? 0;

                t.cost_usd =
                  (t.cost_usd ?? 0) +
                  (data.cost_usd >= before
                    ? data.cost_usd - before
                    : data.cost_usd);

                t.session_cost_usd = data.cost_usd;
                this.store.save(t);
              }

              this.store.event(t, type, data);
            });

            // The stored message replaces its draft.
            if (type === "agent.message")
              this.drafts.clear(t.id, storedMessageId(data));
          },
          session: (id, ref) => {
            t.session_id = id;
            t.session_state_ref = ref;
            t.session_owner = this.ownerWorker;
            this.store.save(t);
          },
          messageParent: (text) => {
            if (!t.conversation_id)
              throw new Error("Task has no parent conversation");
            if (a.abort.signal.aborted) throw new Error("Task was interrupted");
            const message = text.trim();
            if (!message || message.length > 20000)
              throw new Error("Invalid parent message");

            return this.store.event(t, "parent.message", { text: message }).id;
          },
          input: a.input.request,
        },
        prompt,
      );

      if (a.abort.signal.aborted) throw a.abort.signal.reason;
      reply = output.reply;
      await this.recordReply(t, reply);
      t.status = "completed";
    } catch (error) {
      if (a.stopStatus) {
        t.status = a.stopStatus;
        delete t.error;
        delete t.pending_input;
        delete t.waiting_reason;
      } else if (t.status !== "interrupted") {
        t.status = "failed";

        t.error =
          t.error ?? (error instanceof Error ? error.message : String(error));
      }
    } finally {
      clearTimeout(timer);
      const runtime = Date.now() - begin;
      t.runtime_ms += runtime;
      delete t.run_started_at;
      delete a.sink;

      if (a.stopStatus) {
        t.status = a.stopStatus;
        delete t.error;
      }

      delete t.pending_input;
      delete t.waiting_reason;
      t.completed_at = now();

      try {
        // One stopped while waiting for input keeps the end from when it
        // began waiting, since it was blocked from then on.
        if (turnStarted && !t.end_tree) await this.recordEnd(t);
        const outcome = t.status as "completed" | "failed" | "interrupted";
        this.drafts.clear(t.id);

        // The turn's end, what follows it and the task's new status commit together.
        this.store.transaction(() => {
          this.store.event(t, "task.turn_ended", {
            turn: t.turn,
            outcome,
            runtime_ms: runtime,
            cost_usd: (t.cost_usd ?? 0) - costBefore,
          });

          this.endTurn(t, outcome, a.sendPending);
          this.store.save(t);

          this.store.event(
            t,
            `task.${t.status}`,
            t.status === "queued"
              ? {}
              : t.status === "completed" && reply !== undefined
                ? { reply: replyExcerpt(reply) }
                : { error: t.error },
          );
        });
      } finally {
        // A failed write must not leave the task held as running.
        this.active.delete(t.id);
        if (!this.stopped) queueMicrotask(() => void this.schedule());
      }
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
    const before = this.queueSnapshot(t);

    if (sendPending && t.pending_steers.length) {
      t.instructions.push(...t.pending_steers);
      t.pending_steers = [];
      this.requeue(t);
    } else {
      this.leaveOver(t);

      if (outcome !== "completed") {
        if (t.queue.length) t.queue_paused = true;
      } else if (t.queue.length && !t.queue_paused) {
        this.deliverQueued(t, t.queue.shift()!);
        this.requeue(t);
      }
    }

    this.queueChanged(t, before);
  }

  /** Moves the steers a turn didn't take to the front of the queue. */
  private leaveOver(t: Task) {
    t.queue.unshift(
      ...t.pending_steers.map((m) => ({
        ...m,
        delivery: "steer" as const,
        recorded: true,
      })),
    );

    t.pending_steers = [];
  }

  /** Records a queued message as sent, for the turn it starts. */
  private deliverQueued(t: Task, m: QueuedMessage) {
    if (!m.recorded) this.recordMessage(t, m, m.delivery);
    t.instructions.push({ id: m.id, message: m.message, from: m.from });
  }

  /** Marks a task as having its next turn ready to start. */
  private requeue(t: Task) {
    t.status = "queued";
    delete t.error;
    delete t.completed_at;
  }

  private recordMessage(
    t: Task,
    m: TaskMessage,
    delivery: QueuedMessage["delivery"],
  ) {
    this.store.event(t, "task.instruction", {
      message_id: m.id,
      message: m.message,
      from: m.from,
      delivery,
    });
  }

  /** The queue as `task.queue_changed` records it. */
  private queueSnapshot(t: Task) {
    return {
      queue: t.queue.map((m) => ({
        message_id: m.id,
        message: m.message,
        from: m.from,
      })),
      paused: !!t.queue_paused,
    };
  }

  /** Records the queue when it differs from `before`. */
  private queueChanged(t: Task, before: ReturnType<Control["queueSnapshot"]>) {
    const after = this.queueSnapshot(t);
    if (JSON.stringify(after) !== JSON.stringify(before))
      this.store.event(t, "task.queue_changed", after);
  }

  /**
   * Sends a pending steer to the provider. One the turn can't take any more
   * waits at the front of the queue instead.
   */
  private deliver(t: Task, a: Active, steer: TaskMessage) {
    if (!a.sink || a.sink({ id: steer.id, text: steer.message })) return true;
    const before = this.queueSnapshot(t);
    t.pending_steers = t.pending_steers.filter((m) => m.id !== steer.id);
    t.queue.unshift({ ...steer, delivery: "steer", recorded: true });

    this.store.transaction(() => {
      this.store.save(t);
      this.queueChanged(t, before);
    });

    return false;
  }

  /**
   * Ends a current_repo task's changes at a pinned snapshot of the checkout
   * now, when its turn ends or it waits for input, so later edits to the
   * shared checkout aren't counted. A failed snapshot leaves them as they
   * were.
   */
  private async recordEnd(t: Task) {
    if (t.workspace_strategy !== "current_repo") return;

    try {
      const end = await this.workspaces.snapshot(t.workspace!);
      await this.workspaces.pin(t, "end", end);
      t.end_tree = end;
    } catch {
      // Left as they were.
    }
  }

  /**
   * Records a successful turn's reply with the snapshots its changes start
   * and end at, each pinned for the turn so a later turn can't replace it.
   * A current_repo task's end is the one its changes stop at; a worktree's is
   * taken now. A failed snapshot leaves the end out.
   */
  private async recordReply(t: Task, text: string) {
    const turn = t.turn;
    let end: string | undefined;

    try {
      if (t.workspace_strategy === "current_repo") {
        await this.recordEnd(t);
        end = t.end_tree;
      } else end = await this.workspaces.snapshot(t.workspace!);

      await this.workspaces.pin(t, `turns/${turn}/start`, t.turn_start_tree!);
      if (end) await this.workspaces.pin(t, `turns/${turn}/end`, end);
    } catch {
      end = undefined;
    }

    this.drafts.clear(t.id);

    this.store.event(t, "agent.reply", {
      text,
      turn,
      start_tree: t.turn_start_tree,
      ...(end ? { end_tree: end } : {}),
    });
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
    if (!normalized || normalized.length > 200)
      throw new Error("Task title must contain 1 to 200 characters");
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
    )
      throw new Error(`Wait until the task stops before ${action}.`);

    return t;
  }

  /**
   * Deletes a task and everything related to it: its events, stored requests
   * and a worktree task's worktree and branch,
   * uncommitted changes included. A running, queued or waiting task is
   * interrupted first, since deleting is the only way to end a task for good.
   * `deleteAgentTask` also deletes the provider's session, which the task
   * could otherwise continue from. A task others depend on stays until they
   * are deleted, since a follow-up can still resume them.
   */
  async delete(owner: string, id: string, deleteAgentTask = false) {
    this.mutableTask(owner, id);

    const dependent = this.store
      .all(owner)
      .find((d) => d.depends_on.includes(id));

    if (dependent)
      throw new Error(
        `Task ${dependent.id} depends on this task. Delete it first.`,
      );

    this.deleting.add(id);

    return this.deleteResources(owner, id, deleteAgentTask);
  }

  /** Holds the whole batch against scheduling and new dependencies before cleanup yields. */
  async removeProject(owner: string, repository: string, deleteTasks = false) {
    if (!this.projects)
      throw new Error("Project management is unavailable in this service.");
    if (this.removingProjects.has(repository))
      throw new Error("Project task data is being removed");
    if (!deleteTasks) return this.projects.remove(repository);

    const tasks = this.store
      .all()
      .filter((task) => task.repository === repository);

    if (tasks.some((task) => task.owner !== owner))
      throw new Error(
        "This project has task data owned by another user. Remove those tasks first.",
      );
    const ids = new Set(tasks.map((task) => task.id));

    const dependent = this.store
      .all()
      .find(
        (task) =>
          !ids.has(task.id) && task.depends_on.some((id) => ids.has(id)),
      );

    if (dependent)
      throw new Error(
        `Task ${dependent.id} in another project depends on this project. Remove it first, or keep task data.`,
      );
    if (tasks.some((task) => this.deleting.has(task.id)))
      throw new Error(
        "A project task is already being removed. Wait and retry.",
      );
    // Delete dependents first so cleanup never leaves them without prerequisites.
    const ordered: Task[] = [];
    const remaining = [...tasks];

    while (remaining.length) {
      const index = remaining.findIndex(
        (task) =>
          !remaining.some((other) => other.depends_on.includes(task.id)),
      );

      if (index < 0)
        throw new Error(
          "Project tasks have circular dependencies. Keep task data and resolve them first.",
        );
      ordered.push(...remaining.splice(index, 1));
    }

    this.removingProjects.add(repository);
    for (const id of ids) this.deleting.add(id);

    try {
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

      for (const task of ordered)
        await this.deleteResources(owner, task.id, false);

      return this.projects.remove(repository);
    } catch (error) {
      throw new Error(
        `Project removal stopped; its approval is retained. Some extension task data may already be removed. ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    } finally {
      this.removingProjects.delete(repository);
      for (const id of ids) this.deleting.delete(id);
    }
  }

  private async deleteResources(
    owner: string,
    id: string,
    deleteAgentTask: boolean,
  ) {
    try {
      const a = this.active.get(id);
      if (a) await this.interruptActive(owner, id, a);
      const t = this.store.get(id, owner);

      // Keep the local task available to retry if provider cleanup fails.
      if (deleteAgentTask && t.session_id) {
        const provider = this.providers.get(t.provider);
        if (!provider?.deleteSession)
          throw new Error("Provider session deletion is unavailable");
        await provider.deleteSession(t);
      }

      await this.workspaces.discard(t);
      this.store.delete(id, owner);

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

    if (result.status === "removed")
      this.store.event(t, "task.worktree_removed", {
        path: t.workspace,
        branch: t.branch,
        forced: force,
      });

    return result;
  }

  /** Deletes a task's branch, once its worktree is removed. */
  async deleteBranch(owner: string, id: string) {
    const t = this.idleWorktreeTask(owner, id);
    await this.workspaces.deleteBranch(t);
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

    if (!BUSY.includes(t.status))
      throw new Error(`Cannot interrupt a ${t.status} task`);

    t.status = "interrupted";
    t.completed_at = now();
    delete t.waiting_reason;
    delete t.waiting_for;
    const before = this.queueSnapshot(t);
    if (t.queue.length) t.queue_paused = true;

    this.store.transaction(() => {
      this.store.save(t);
      this.store.event(t, "task.interrupted");
      this.queueChanged(t, before);
    });

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

    a.abort.abort(new Error("interrupted"));
    await a.done;

    return this.store.get(id, owner);
  }

  /** Applies a budget increase to an idle task without starting a turn. */
  applyBudget(owner: string, id: string, raise: BudgetRaise) {
    const task = this.mutableTask(owner, id);
    if (this.active.has(id) || BUSY.includes(task.status))
      throw new Error("A task's budget can only be changed while it is idle.");

    const originalBudget = task.budget;
    const budget = { ...originalBudget };
    const candidate = { ...task, budget };
    this.raiseBudget(candidate, raise);

    if (
      budget.max_runtime_minutes === task.budget.max_runtime_minutes &&
      budget.max_cost_usd === task.budget.max_cost_usd
    )
      throw new Error("Choose a changed budget limit to apply.");

    const costRaised =
      budget.max_cost_usd !== null &&
      originalBudget.max_cost_usd !== null &&
      budget.max_cost_usd > originalBudget.max_cost_usd;

    const runtimeRaised =
      budget.max_runtime_minutes !== null &&
      originalBudget.max_runtime_minutes !== null &&
      budget.max_runtime_minutes > originalBudget.max_runtime_minutes;

    this.validateBudgets(candidate);
    task.budget = budget;

    const previousRaise =
      task.budget_raised_for_turn?.turn === task.turn
        ? task.budget_raised_for_turn
        : undefined;

    // Keep a mixed-limit failure visible until each exhausted limit is changed.
    task.budget_raised_for_turn = {
      turn: task.turn,
      ...(previousRaise?.cost ? { cost: true } : {}),
      ...(previousRaise?.runtime ? { runtime: true } : {}),
      ...(costRaised ? { cost: true } : {}),
      ...(runtimeRaised ? { runtime: true } : {}),
    };

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
    options: { delivery?: Delivery; budget?: BudgetRaise } = {},
  ) {
    const delivery = options.delivery ?? "steer";
    const stored = this.mutableTask(owner, id);
    const a = this.active.get(id);

    if (!a && !BUSY.includes(stored.status)) {
      const sent = await this.followUp(owner, id, message, from, options);

      return { ...sent, state: "started" as const };
    }

    const t = a?.task ?? stored;

    if (t.pending_input && delivery === "steer")
      throw new Error(
        "The worker is waiting for input, so it can't be steered. Answer its request, or queue the message.",
      );

    if (options.budget) this.raiseBudget(t, options.budget);
    const m: TaskMessage = { id: `msg_${randomUUID()}`, message, from };

    if (delivery === "queue") {
      const before = this.queueSnapshot(t);
      t.queue.push({ ...m, delivery });

      this.store.transaction(() => {
        this.store.save(t);
        this.queueChanged(t, before);
      });

      return { task: t, message_id: m.id, state: "queued" as const };
    }

    // A turn that hasn't begun takes the message with its prompt.
    if (!a) t.instructions.push(m);
    else t.pending_steers.push(m);

    this.store.transaction(() => {
      this.recordMessage(t, m, delivery);
      this.store.save(t);
    });

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
    options: { delivery?: Delivery; budget?: BudgetRaise } = {},
  ) {
    const t = this.mutableTask(owner, id);
    if (this.active.has(id) || BUSY.includes(t.status))
      throw new Error("The task is busy; wait until its turn ends.");
    if (options.budget) this.raiseBudget(t, options.budget);
    this.validateBudgets(t);
    if (this.projects) await this.projects.resolve(t.repository);
    // Recheck after the awaits, so deletion can't resurrect a task.
    this.mutableTask(owner, id);
    const m: TaskMessage = { id: `msg_${randomUUID()}`, message, from };
    const before = this.queueSnapshot(t);

    t.instructions.push(m);
    delete t.queue_paused;
    this.requeue(t);

    this.store.transaction(() => {
      this.store.save(t);
      this.recordMessage(t, m, options.delivery ?? "steer");
      this.queueChanged(t, before);
      this.store.event(t, "task.queued");
    });

    void this.schedule();

    return { task: t, message_id: m.id };
  }

  /**
   * Raises a task's budget. Each limit can only go up: to a higher amount, or
   * to null for no limit.
   */
  private raiseBudget(t: Task, raise: BudgetRaise) {
    const budget = budgetRaiseSchema.parse(raise);

    for (const key of ["max_runtime_minutes", "max_cost_usd"] as const) {
      const next = budget[key],
        current = t.budget[key];

      if (next === undefined) continue;
      if (next !== null && (current === null || next < current))
        throw new Error(
          `The budget can only be raised: ${key} is ${current ?? "unlimited"}`,
        );
      t.budget[key] = next;
    }
  }

  /** The task's queue, as Control holds it while a turn runs. */
  private queueTask(owner: string, id: string) {
    const stored = this.mutableTask(owner, id);

    return this.active.get(id)?.task ?? stored;
  }

  /** Changes a queued message's text before it's sent. */
  editQueued(owner: string, id: string, messageId: string, message: string) {
    const t = this.queueTask(owner, id);
    const m = t.queue.find((m) => m.id === messageId);
    if (!m) throw new Error("That message is no longer queued.");
    if (m.recorded)
      throw new Error("A steer the worker already has can't be edited.");
    const before = this.queueSnapshot(t);
    m.message = message;

    this.store.transaction(() => {
      this.store.save(t);
      this.queueChanged(t, before);
    });

    return t;
  }

  /**
   * Moves a queued message to `index` in the queue. Steers the worker already
   * has stay at the front, so nothing moves ahead of them.
   */
  moveQueued(owner: string, id: string, messageId: string, index: number) {
    const t = this.queueTask(owner, id);
    const m = t.queue.find((m) => m.id === messageId);
    if (!m) throw new Error("That message is no longer queued.");
    if (m.recorded)
      throw new Error("A steer the worker already has stays at the front.");
    const before = this.queueSnapshot(t);
    const rest = t.queue.filter((q) => q !== m);
    const first = rest.filter((q) => q.recorded).length;
    rest.splice(Math.min(Math.max(index, first), rest.length), 0, m);
    t.queue = rest;

    this.store.transaction(() => {
      this.store.save(t);
      this.queueChanged(t, before);
    });

    return t;
  }

  /**
   * Removes a queued message before it's sent. The parent agent can remove
   * only messages it queued.
   */
  removeQueued(owner: string, id: string, messageId: string, by: Sender) {
    const t = this.queueTask(owner, id);
    const m = t.queue.find((m) => m.id === messageId);
    if (!m) throw new Error("That message is no longer queued.");
    if (by === "parent" && m.from !== "parent")
      throw new Error("The parent agent can remove only messages it queued.");
    const before = this.queueSnapshot(t);
    t.queue = t.queue.filter((q) => q !== m);
    if (!t.queue.length) delete t.queue_paused;

    this.store.transaction(() => {
      this.store.save(t);
      this.store.event(t, "task.message_removed", { message_id: m.id });
      this.queueChanged(t, before);
    });

    return t;
  }

  /** Removes every queued message. */
  clearQueue(owner: string, id: string) {
    const t = this.queueTask(owner, id);
    const before = this.queueSnapshot(t);
    const removed = t.queue;
    t.queue = [];
    delete t.queue_paused;

    this.store.transaction(() => {
      this.store.save(t);
      for (const m of removed)
        this.store.event(t, "task.message_removed", { message_id: m.id });
      this.queueChanged(t, before);
    });

    return t;
  }

  /** Resumes a paused queue; an idle task starts its next queued message. */
  resumeQueue(owner: string, id: string) {
    const t = this.queueTask(owner, id);
    const before = this.queueSnapshot(t);
    delete t.queue_paused;

    if (!this.active.has(id) && !BUSY.includes(t.status) && t.queue.length) {
      const next = t.queue.shift()!;
      this.requeue(t);

      this.store.transaction(() => {
        this.deliverQueued(t, next);
        this.store.save(t);
        this.queueChanged(t, before);
        this.store.event(t, "task.queued");
      });

      void this.schedule();

      return t;
    }

    this.store.transaction(() => {
      this.store.save(t);
      this.queueChanged(t, before);
    });

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
    if (t.pending_input?.id !== requestId)
      throw new Error("Input request is stale");
    if (
      pendingInputKind(t.pending_input) !== "question" &&
      authority !== "user" &&
      !this.providers.get(t.provider)?.taskPolicy.parentMayApprove(t)
    )
      throw new Error(
        "This permission requires user approval; use the approval buttons in the panel",
      );
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
      [...this.providers.values()].map((provider) => provider.close?.()),
    );

    this.store.close();

    const errors = [...tasks, ...providers].flatMap((result) =>
      result.status === "rejected" ? [result.reason] : [],
    );

    if (errors.length)
      throw new AggregateError(errors, "Worker shutdown incomplete");
  }
}
