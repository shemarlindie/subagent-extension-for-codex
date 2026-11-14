import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, onTestFinished, test } from "vitest";

import { FixtureProvider } from "../../../../dev/service/fixture-provider.js";
import { fixtureProvider } from "../../../../dev/service/fixture-provider-test-helpers.js";
import { copyCommittedRepository } from "../../../../tests/support/repository-test-harness.js";
import { until } from "../../../../tests/support/until.js";
import { SendRejectedError } from "../../../shared/tasks/conversation/send-errors.js";
import type { Task } from "../../../shared/tasks/model.js";
import type {
  PanelTask,
  TaskSummary,
} from "../../../shared/tasks/task-list.js";
import type { Provider, RunContext } from "../../features/providers/types.js";
import { Control } from "../../features/tasks/runtime/control.js";
import { sendRef } from "../../features/tasks/runtime/timing.js";
import { captureTiming } from "../../features/tasks/runtime/timing-test-harness.js";
import { TurnCheckpoints } from "../../features/tasks/runtime/turn-checkpoints-test-harness.js";
import { Store } from "../../features/tasks/storage/store.js";
import { Workspaces } from "../../features/workspaces/workspace.js";
import { withLogContext } from "../logging/logger.js";
import { callTool, definitions, isUserTool } from "./tools.js";

async function setup(provider: Provider = fixtureProvider()) {
  const dir = await mkdtemp(join(tmpdir(), "conversation-tools-"));
  const repo = join(dir, "repo");
  onTestFinished(() => rm(dir, { recursive: true, force: true }));
  await copyCommittedRepository(repo);
  const store = new Store(join(dir, "tasks.sqlite"));

  const c = new Control(
    store,
    new Workspaces(join(dir, "worktrees"), [repo]),
    new Map([["fixture", provider]]),
  );

  const parent = <T>(name: string, args: Record<string, unknown>) =>
    callTool(c, "alice", name, args, "parent") as Promise<T>;

  const user = <T>(name: string, args: Record<string, unknown>) =>
    callTool(c, "alice", name, args, "user") as Promise<T>;

  const start = (description: string, budget?: Task["budget"]) =>
    parent<Task>("start_task", {
      provider: "fixture",
      description,
      workspace_strategy: "worktree",
      repository: repo,
      ...(budget ? { budget } : {}),
    });

  return { c, store, parent, user, start, repo };
}

type StreamingOptions = {
  finished: Promise<void>;
  growDraft?: Promise<void>;
};

class Streaming extends FixtureProvider {
  constructor(private readonly options: StreamingOptions) {
    super();
  }

  override async run(c: RunContext) {
    c.delta("msg_live", "Half ");

    if (this.options.growDraft) {
      await this.options.growDraft;
      c.delta("msg_live", "a reply");
    }

    await this.options.finished;

    if (this.options.growDraft) {
      c.emit("agent.message", {
        role: "assistant",
        text: "Half a reply, done.",
        raw_response: { message: { id: "msg_live" } },
      });
    }

    return { reply: this.options.growDraft ? "Half a reply, done." : "Done." };
  }
}

type Messages = {
  messages: { id: string; kind: string; from: string; text: string }[];
  next_cursor: number;
  status: string;
  turn: number;
  running: boolean;
  pending_input: unknown;
  queued_messages: number;
};

test("tool names mark app-only tools and fit the host name budget", async () => {
  const names = Object.keys(definitions({} as Control, "alice"));

  for (const name of names) {
    assert.equal(isUserTool(name), name.startsWith("app_"), name);

    // Hosts qualify names as mcp__subagent-extension-for-codex__<tool> (31
    // characters) within a 64-character function-name limit.
    if (!isUserTool(name)) assert.ok(name.length <= 33, name);
  }

  await expect(
    callTool({} as Control, "alice", "app_steer_queued_message", {}),
  ).rejects.toThrow(/User tools require a user interface/);

  await expect(
    callTool({} as Control, "alice", "app_save_settings_file", {}),
  ).rejects.toThrow(/User tools require a user interface/);
});

test("a parent reads replies by long poll and sends follow-ups as messages", async () => {
  const { c, store, parent, user, start } = await setup();

  try {
    const t = await start("Review the parser");
    assert.equal(t.created_by, "parent");

    // Waits until the turn ends, then returns its complete messages.
    const first = await parent<Messages>("list_messages", {
      task_id: t.id,
      wait_seconds: 5,
    });

    await until(() => store.get(t.id, "alice").status === "completed");

    const all = await parent<Messages>("list_messages", {
      task_id: t.id,
    });

    assert.ok(first.messages.length >= 1);

    assert.deepEqual(all.messages[0], {
      ...all.messages[0],
      id: "request",
      kind: "request",
      from: "parent",
    });

    assert.match(all.messages.at(-1)!.text, /Fixture task completed/);
    assert.equal(all.messages.at(-1)!.kind, "reply");
    assert.equal(all.running, false);

    // Nothing after the cursor: an immediate read is empty, and a wait
    // returns at its end.
    const quiet = await parent<Messages>("list_messages", {
      task_id: t.id,
      after: all.next_cursor,
      wait_seconds: 0.2,
    });

    assert.deepEqual(quiet.messages, []);
    assert.equal(quiet.next_cursor, all.next_cursor);

    const listed = async (args: Record<string, unknown> = {}) =>
      (
        await parent<TaskSummary[]>("list_tasks", {
          conversation_id: null,
          ...args,
        })
      ).find((task) => task.id === t.id);

    const panelList = async (args: Record<string, unknown>) =>
      (
        await user<{ tasks: PanelTask[] }>("app_list_tasks", {
          conversation_id: null,
          ...args,
        })
      ).tasks.map((task) => task.id);

    // Both lists share one archive filter that leaves archived tasks out by
    // default. The panel's also keeps tasks it names.
    await user("app_set_tasks_archived", { task_ids: [t.id], archived: true });
    assert.equal(await listed(), undefined);
    assert.ok((await listed({ archived: "include" }))?.archived_at);
    assert.ok((await listed({ archived: "only" }))?.archived_at);
    assert.deepEqual(await panelList({}), []);

    assert.deepEqual(await panelList({ include: [t.id] }), [t.id]);

    const [panelTask] = (
      await user<{ tasks: PanelTask[] }>("app_list_tasks", {
        conversation_id: null,
        archived: "only",
      })
    ).tasks;

    assert.ok(panelTask?.archived_at);
    assert.equal(panelTask.description, "Review the parser");
    const json = JSON.parse(JSON.stringify(panelTask)) as Partial<Task>;
    assert.ok(!("context" in json));

    const sent = await parent<{ message_id: string; state: string }>(
      "send_message",
      { task_id: t.id, message: "Check the lexer too" },
    );

    assert.equal(sent.state, "started");
    assert.equal((await listed())?.archived_at, undefined);

    const next = await parent<Messages>("list_messages", {
      task_id: t.id,
      after: all.next_cursor,
      wait_seconds: 5,
    });

    assert.deepEqual(next.messages[0], {
      ...next.messages[0],
      id: sent.message_id,
      from: "parent",
      text: "Check the lexer too",
    });

    // The task and list show the turn, queue and latest reply.
    await until(() => store.get(t.id, "alice").status === "completed");

    const task = await parent<Task & { reply: { turn: number; text: string } }>(
      "get_task",
      { task_id: t.id },
    );

    assert.equal(task.turn, 2);
    assert.deepEqual(task.queue, []);
    assert.equal(task.reply.turn, 2);

    // A summary leaves out the request, context and conversation.
    assert.deepEqual(await listed(), {
      id: t.id,
      title: t.title,
      status: "completed",
      repository: t.repository,
      worker_profile: t.worker_profile,
      turn: 2,
      reply: task.reply,
      queued_messages: 0,
    } satisfies TaskSummary);
  } finally {
    await c.close();
  }
});

test("a confirmed rejected send preserves its message and permits changed delivery", async () => {
  const { c, store, user, start } = await setup();

  try {
    const task = await start("[input]");
    await until(() => !!store.get(task.id, "alice").pending_input);

    const rejected = await user("app_send_message", {
      task_id: task.id,
      message: "Next",
      delivery: "steer",
      request_id: "rejected-steer",
    }).catch((error: unknown) => error);

    expect(rejected).toBeInstanceOf(SendRejectedError);

    expect(rejected).toHaveProperty(
      "message",
      "The worker is waiting for input, so it can't be steered. Answer its request, or queue the message.",
    );

    const queued = await user("app_send_message", {
      task_id: task.id,
      message: "Next",
      delivery: "queue",
      request_id: "new-queue",
    });

    expect(queued).toMatchObject({ state: "queued" });
    expect(store.get(task.id, "alice").queue).toHaveLength(1);
  } finally {
    await c.close();
  }
});

test("the user can steer an existing queued message and its original sender survives", async () => {
  const checkpoints = new TurnCheckpoints(1);

  const { c, store, parent, user, start } = await setup(
    fixtureProvider({ beforeReply: checkpoints.beforeReply }),
  );

  try {
    const task = await start("[slow]");
    await checkpoints.ready();

    const queued = await parent<{ message_id: string }>("send_message", {
      task_id: task.id,
      message: "Original parent note",
      delivery: "queue",
    });

    const args = { task_id: task.id, message_id: queued.message_id };

    await expect(
      callTool(c, "bob", "app_steer_queued_message", args, "user"),
    ).rejects.toThrow(/Task not found/);

    expect(store.get(task.id, "alice").queue).toHaveLength(1);
    await user("app_steer_queued_message", args);
    expect(store.get(task.id, "alice").queue).toEqual([]);

    expect(store.eventsOfTypes(task.id, ["task.instruction"])).toMatchObject([
      {
        data: {
          message_id: queued.message_id,
          message: "Original parent note",
          from: "parent",
          delivery: "steer",
        },
      },
    ]);

    await expect(user("app_steer_queued_message", args)).rejects.toThrow(
      /no longer queued/,
    );
  } finally {
    await c.close();
  }
});

test("delivery, sender and queue ownership follow the calling tool", async () => {
  const { c, store, parent, user, start } = await setup();

  try {
    const t = await start("[input]", {
      max_runtime_minutes: null,
      max_cost_usd: 5,
    });

    await until(() => !!store.get(t.id, "alice").pending_input);

    await assert.rejects(
      parent("send_message", { task_id: t.id, message: "Steer" }),
      /waiting for input/,
    );

    const queued = await parent<{ message_id: string; state: string }>(
      "send_message",
      { task_id: t.id, message: "Queued by parent", delivery: "queue" },
    );

    assert.equal(queued.state, "queued");

    const mine = await user<{ message_id: string }>("app_send_message", {
      task_id: t.id,
      message: "Queued by user",
      delivery: "queue",
    });

    assert.deepEqual(
      store.get(t.id, "alice").queue.map((m) => m.from),
      ["parent", "user"],
    );

    assert.equal(
      (await parent<Messages>("list_messages", { task_id: t.id }))
        .queued_messages,
      2,
    );

    await assert.rejects(
      parent("remove_queued_message", {
        task_id: t.id,
        message_id: mine.message_id,
      }),
      /only messages it queued/,
    );

    await user("app_edit_queued_message", {
      task_id: t.id,
      message_id: mine.message_id,
      message: "Edited",
    });

    await parent("remove_queued_message", {
      task_id: t.id,
      message_id: queued.message_id,
    });

    assert.deepEqual(
      store.get(t.id, "alice").queue.map((m) => m.message),
      ["Edited"],
    );

    // Interrupt pauses the queue; resume starts it; clear empties it.
    await parent("interrupt_task", { task_id: t.id });
    assert.equal(store.get(t.id, "alice").queue_paused, true);
    await user("app_resume_queue", { task_id: t.id });
    await until(() => store.get(t.id, "alice").status === "completed");
    assert.equal(store.get(t.id, "alice").turn, 2);
    await user("app_clear_queue", { task_id: t.id });

    const beforeBudgetApply = store.get(t.id, "alice");

    const updated = await user<{ budget: Task["budget"]; status: string }>(
      "app_raise_budget",
      { task_id: t.id, budget: { max_cost_usd: 6 } },
    );

    assert.equal(updated.status, beforeBudgetApply.status);
    assert.equal(updated.budget.max_cost_usd, 6);
    assert.equal(store.get(t.id, "alice").turn, beforeBudgetApply.turn);
  } finally {
    await c.close();
  }
});

test("undo restores removed queued messages with their identity, and never starts a turn", async () => {
  const { c, store, parent, user, start } = await setup();

  try {
    const t = await start("[input]");
    await until(() => !!store.get(t.id, "alice").pending_input);

    const queue = async (send: typeof user, tool: string, message: string) =>
      (
        await send<{ message_id: string }>(tool, {
          task_id: t.id,
          message,
          delivery: "queue",
        })
      ).message_id;

    const first = await queue(parent, "send_message", "From parent");
    const second = await queue(user, "app_send_message", "From user");
    const third = await queue(user, "app_send_message", "Last");

    await user("app_edit_queued_message", {
      task_id: t.id,
      message_id: first,
      message: "Edited parent note",
    });

    const queued = () =>
      store.get(t.id, "alice").queue.map((m) => [m.id, m.message, m.from]);

    const before = queued();

    await user("app_remove_queued_message", {
      task_id: t.id,
      message_id: first,
    });

    // Task reads leave out the messages the user removed.
    expect(store.get(t.id, "alice").removed_queue).toHaveLength(1);

    expect(
      (await parent<Task>("get_task", { task_id: t.id })).removed_queue,
    ).toBeUndefined();

    const { tasks } = await user<{ tasks: PanelTask[] }>("app_list_tasks", {});

    expect(
      tasks.find((task) => task.id === t.id)?.removed_queue,
    ).toBeUndefined();

    // A message the user never removed can't be made up.
    await user("app_restore_queued_messages", {
      task_id: t.id,
      messages: [
        { message_id: first, index: 0 },
        { message_id: "msg_made_up", index: 0 },
        { message_id: second, index: 0 },
      ],
    });

    expect(queued()).toEqual(before);
    expect(store.get(t.id, "alice").queue_paused).toBeUndefined();

    await user("app_clear_queue", {
      task_id: t.id,
      message_ids: [first, third],
    });

    expect(queued()).toEqual([before[1]]);
    await user("app_clear_queue", { task_id: t.id });

    await user("app_submit_input", {
      task_id: t.id,
      request_id: store.get(t.id, "alice").pending_input!.id,
      approved: true,
      input: { answers: {} },
    });

    await until(() => store.get(t.id, "alice").status === "completed");
    const turn = store.get(t.id, "alice").turn;

    // Messages queued again bring an archived task back to the lists.
    await user("app_set_tasks_archived", { task_ids: [t.id], archived: true });
    const archived = () => c.archive.times("alice", {}).has(t.id);
    expect(archived()).toBe(true);

    await user("app_restore_queued_messages", {
      task_id: t.id,
      messages: before.map(([id], index) => ({ message_id: id, index })),
    });

    const idle = store.get(t.id, "alice");

    expect(queued()).toEqual(before);
    expect(idle.queue_paused).toBe(true);
    expect(idle.status).toBe("completed");
    expect(idle.turn).toBe(turn);
    expect(archived()).toBe(false);
  } finally {
    await c.close();
  }
});

test("a reply streams as a draft the panel and parent can read, and only the finished message is stored", async () => {
  let finish!: () => void;
  const finished = new Promise<void>((resolve) => (finish = resolve));

  const growDraft = Promise.withResolvers<void>();

  const { c, store, parent, user, start } = await setup(
    new Streaming({ finished, growDraft: growDraft.promise }),
  );

  try {
    const t = await start("Write");
    await until(() => c.drafts.get(t.id)?.text === "Half ");

    // Waits for the draft to grow past what the panel has.
    const pending = user<{ draft: unknown; running: boolean }>(
      "app_wait_for_updates",
      {
        after: store.revision("alice"),
        draft: { task_id: t.id, message_id: "msg_live", after_length: 5 },
        wait_ms: 5000,
      },
    );

    growDraft.resolve();
    const read = await pending;

    assert.deepEqual(read, {
      revision: store.revision("alice"),
      draft: { message_id: "msg_live", text: "Half a reply" },
      running: true,
    });

    // Task reads include it as a fallback.
    assert.deepEqual(
      (await parent<{ draft: unknown }>("get_task", { task_id: t.id })).draft,
      read.draft,
    );

    // A parent's read that waits out its time includes it.
    const messages = await parent<Messages & { draft?: unknown }>(
      "list_messages",
      { task_id: t.id, after: store.lastEventId(t.id), wait_seconds: 0.1 },
    );

    assert.deepEqual(messages.messages, []);
    assert.deepEqual(messages.draft, read.draft);

    // Storing the message, which clears the draft, ends a waiting read.
    const before = store.revision("alice");

    const cleared = user<{ revision: string; draft: unknown }>(
      "app_wait_for_updates",
      {
        after: before,
        draft: { task_id: t.id, message_id: "msg_live", after_length: 12 },
        wait_ms: 5000,
      },
    );

    finish();
    const woken = await cleared;
    assert.ok(woken.draft === null || woken.revision !== before);
    await until(() => c.drafts.get(t.id) === undefined);

    assert.equal(
      (
        await user<{ draft: unknown }>("app_wait_for_updates", {
          draft: { task_id: t.id },
        })
      ).draft,
      null,
    );

    await until(() => store.get(t.id, "alice").status === "completed");
    assert.equal(c.drafts.get(t.id), undefined);

    // Deltas never reach the event log.
    assert.ok(
      !store.events(t.id, "alice").some((e) => e.type.includes("delta")),
    );
  } finally {
    growDraft.resolve();
    finish();
    await c.close();
  }
});

test("an update wait returns once the owner's revision changes, and a change ends its draft wait", async () => {
  let finish!: () => void;
  const finished = new Promise<void>((resolve) => (finish = resolve));

  const { c, store, user, start } = await setup(new Streaming({ finished }));

  type Update = { revision: string; draft?: unknown; running?: boolean };

  const wait = (args: Record<string, unknown>) =>
    user<Update>("app_wait_for_updates", args);

  try {
    const t = await start("Write");
    await until(() => c.drafts.get(t.id)?.text === "Half ");

    // Without a revision, or with another boot's, it returns at once.
    const { revision } = await wait({ wait_ms: 5000 });
    assert.equal(revision, store.revision("alice"));

    assert.deepEqual(await wait({ after: "restarted:0", wait_ms: 5000 }), {
      revision,
    });

    // Another owner's change doesn't wake it.
    const started = Date.now();
    const quiet = wait({ after: revision, wait_ms: 20 });
    store.save({ ...store.get(t.id, "alice"), id: "other", owner: "bob" });
    assert.deepEqual(await quiet, { revision });
    assert.ok(Date.now() - started >= 15);

    // The owner's change ends a draft wait, with the draft unchanged.
    const waiting = wait({
      after: revision,
      draft: { task_id: t.id, message_id: "msg_live", after_length: 5 },
      wait_ms: 5000,
    });

    await user("app_rename_task", { task_id: t.id, title: "Renamed" });
    const changed = await waiting;
    assert.notEqual(changed.revision, revision);

    assert.deepEqual(changed, {
      revision: store.revision("alice"),
      draft: { message_id: "msg_live", text: "Half " },
      running: true,
    });

    // A target whose turn has ended still waits for the revision.
    finish();
    await until(() => store.get(t.id, "alice").status === "completed");
    const ended = store.revision("alice");
    const idleStart = Date.now();

    assert.deepEqual(
      await wait({ after: ended, draft: { task_id: t.id }, wait_ms: 20 }),
      { revision: ended, draft: null, running: false },
    );

    assert.ok(Date.now() - idleStart >= 15);

    // Another owner's task has no draft to show.
    assert.deepEqual(
      await callTool(
        c,
        "bob",
        "app_wait_for_updates",
        { draft: { task_id: t.id } },
        "user",
      ),
      { revision: store.revision("bob"), draft: null, running: false },
    );
  } finally {
    finish();
    await c.close();
  }
});

test("an update wait returns the panel view as of its revision, except for draft growth alone", async () => {
  const finished = Promise.withResolvers<void>();
  const growDraft = Promise.withResolvers<void>();

  const { c, store, parent, user, repo } = await setup(
    new Streaming({ finished: finished.promise, growDraft: growDraft.promise }),
  );

  type Update = {
    revision: string;
    draft?: unknown;
    view?: {
      built_at: number;
      projects: unknown;
      list: { tasks: PanelTask[] };
      chat?: { items: { id: string }[]; next_cursor: number };
      activity?: { events: { id: number; type: string }[] };
      pending?: unknown;
    };
  };

  const wait = (args: Record<string, unknown>) =>
    user<Update>("app_wait_for_updates", args);

  try {
    const t = await parent<Task>("start_task", {
      provider: "fixture",
      description: "Write",
      workspace_strategy: "worktree",
      repository: repo,
      conversation_id: "chat",
    });

    await until(() => c.drafts.get(t.id)?.text === "Half ");

    const parts = {
      list: { conversation_id: "chat" },
      chat: { task_id: t.id, after: 0 },
      activity: { task_id: t.id, after: 0 },
      pending: { conversation_id: "chat" },
    };

    // Without after, it returns at once.
    const first = await wait({ view: parts });
    assert.equal(first.revision, store.revision("alice"));
    const { built_at: builtAt, ...view } = first.view!;
    assert.ok(Math.abs(Date.now() - builtAt) < 10_000);

    assert.deepEqual(view.projects, await user("list_projects", {}));
    assert.deepEqual(view.list, await user("app_list_tasks", parts.list));
    assert.deepEqual(view.pending, { tasks: [] });

    assert.deepEqual(
      view.chat?.items.map((item) => item.id),
      ["request"],
    );

    assert.deepEqual(
      view.activity?.events.map((event) => event.type),
      ["task.queued", "task.started"],
    );

    assert.equal(view.chat?.next_cursor, view.activity?.events.at(-1)?.id);

    // A wait that runs out returns the view.
    const quiet = await wait({
      after: first.revision,
      view: parts,
      wait_ms: 20,
    });

    assert.ok(quiet.view);

    // Draft growth alone returns the draft without the view.
    const growing = wait({
      after: first.revision,
      draft: { task_id: t.id, message_id: "msg_live", after_length: 5 },
      view: parts,
      wait_ms: 5000,
    });

    growDraft.resolve();

    assert.deepEqual(await growing, {
      revision: first.revision,
      draft: { message_id: "msg_live", text: "Half a reply" },
      running: true,
    });

    // A change returns the view as of the new revision.
    const changing = wait({
      after: first.revision,
      view: parts,
      wait_ms: 5000,
    });

    await user("app_rename_task", { task_id: t.id, title: "Renamed" });
    const changed = await changing;
    assert.equal(changed.revision, store.revision("alice"));
    assert.equal(changed.view?.list.tasks[0]?.title, "Renamed");

    // A missing selected task leaves its details out and the rest in.
    const missing = await wait({
      view: {
        ...parts,
        chat: { task_id: "missing" },
        activity: { task_id: "missing" },
      },
    });

    assert.deepEqual(Object.keys(missing.view!).sort(), [
      "built_at",
      "list",
      "pending",
      "projects",
    ]);
  } finally {
    growDraft.resolve();
    finished.resolve();
    await c.close();
  }
});

test("the panel appends its call durations to the timing log", async () => {
  const { c, user } = await setup();
  const timing = await captureTiming();
  const requestId = "0123456789abcdef0123456789abcdef";
  const taskId = "task_01234567-89ab-cdef-0123-456789abcdef";

  const aggregate = {
    operation: "activity_latest",
    phase: "decode",
    count: 3,
    total_ms: 12,
    max_ms: 7,
    rows: 205,
    groups: 0,
    stale_count: 0,
    error_count: 1,
  };

  try {
    for (const record of [
      { operation: "Send the secret plan", duration_ms: 12 },
      { operation: "app_send_message", duration_ms: 1, request_id: "My plan" },
      { operation: "app_send_message", duration_ms: 1, task_id: "My plan" },
      { ...aggregate, phase: "arbitrary prompt" },
      { ...aggregate, rows: -1 },
      { ...aggregate, count: 1.5 },
      { ...aggregate, total_ms: Infinity },
      { ...aggregate, max_ms: 1_000_000_000_001 },
      { ...aggregate, stale_count: 1_000_000_001 },
      { ...aggregate, metadata: "secret input" },
    ]) {
      await expect(
        user("app_record_timing", { records: [record] }),
      ).rejects.toThrow();
    }

    await expect(
      user("app_record_timing", { records: [aggregate], dropped_count: -1 }),
    ).rejects.toThrow();

    // Correlation fields are optional, since some operations have none.
    const recorded = await withLogContext({ request_id: "upload" }, () =>
      user("app_record_timing", {
        records: [
          { operation: "app_send_message", duration_ms: 12.5 },
          {
            operation: "app_send_message",
            duration_ms: 40,
            task_id: taskId,
            request_id: requestId,
            outcome: "success",
            ui_timed_out: true,
          },
          { operation: "interrupt_task", duration_ms: 3, outcome: "error" },
          aggregate,
        ],
        dropped_count: 4,
      }),
    );

    assert.deepEqual(recorded, { recorded: 4 });

    expect(await timing.records("transport")).toEqual([
      expect.objectContaining({
        operation: "app_send_message",
        duration_ms: 12.5,
      }),
      expect.objectContaining({
        task_id: taskId,
        send_ref: sendRef(requestId),
        outcome: "success",
        ui_timed_out: true,
      }),
      expect.objectContaining({ operation: "interrupt_task" }),
    ]);

    // The upload's own HTTP request ID and the raw send ID aren't recorded.
    const text = await readFile(timing.path, "utf8");
    expect(text).not.toContain(requestId);
    expect(text).not.toContain("upload");

    const records = text
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>);

    expect(records).toContainEqual(expect.objectContaining(aggregate));

    expect(records).toContainEqual(
      expect.objectContaining({ phase: "panel_reporting", dropped_count: 4 }),
    );
  } finally {
    await c.close();
  }
});
