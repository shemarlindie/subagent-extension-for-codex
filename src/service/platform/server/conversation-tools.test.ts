import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, test } from "vitest";

import { FixtureProvider } from "../../../../dev/service/fixture-provider.js";
import {
  PARENT_DELEGATION_PROTOCOL,
  PARENT_REPORT_PROTOCOL,
} from "../../../shared/tasks/conversation/parent-protocol.js";
import type { Task } from "../../../shared/tasks/model.js";
import type { ListedTask } from "../../../shared/tasks/task-list.js";
import type { Provider, RunContext } from "../../features/providers/types.js";
import { Control } from "../../features/tasks/runtime/control.js";
import { Store } from "../../features/tasks/storage/store.js";
import { Workspaces } from "../../features/workspaces/workspace.js";
import { openingTasks } from "../panel/panel-context.js";
import { callTool, definitions, isReadOnlyTool, isUserTool } from "./tools.js";

async function until(fn: () => boolean) {
  for (let i = 0; i < 300; i++) {
    if (fn()) return;
    await new Promise((r) => setTimeout(r, 10));
  }

  throw new Error("Timed out");
}

async function setup(provider: Provider = new FixtureProvider()) {
  const dir = await mkdtemp(join(tmpdir(), "conversation-tools-"));
  const repo = join(dir, "repo");
  await mkdir(repo);
  const git = (...args: string[]) => execFileSync("git", ["-C", repo, ...args]);
  git("init", "-q");
  git("config", "user.email", "test@example.invalid");
  git("config", "user.name", "Test");
  await writeFile(join(repo, "README.md"), "hello\n");
  git("add", ".");
  git("commit", "-qm", "initial");
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
    parent<Task>("start_agent_task", {
      provider: "fixture",
      description,
      workspace_strategy: "worktree",
      repository: repo,
      ...(budget ? { budget } : {}),
    });

  return { c, store, parent, user, start };
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

test("exactly the tools named for the user are refused to other callers", () => {
  const names = Object.keys(definitions({} as Control, "alice"));

  for (const name of names) {
    assert.equal(isUserTool(name), name.includes("_user_"), name);
  }
});

test("reads and the update wait are read-only; writes are not", () => {
  for (const name of [
    "get_agent_messages",
    "list_agent_tasks",
    "wait_user_agent_updates",
  ]) {
    assert.equal(isReadOnlyTool(name), true, name);
  }

  for (const name of ["send_agent_message", "delete_user_agent_task"]) {
    assert.equal(isReadOnlyTool(name), false, name);
  }
});

test("the old one-shot tools are gone and the conversation tools replace them", () => {
  const names = Object.keys(definitions({} as Control, "alice"));

  for (const name of [
    "send_agent_message",
    "get_agent_messages",
    "get_agent_message",
    "ack_agent_message",
    "remove_agent_queued_message",
    "send_user_agent_message",
    "raise_user_agent_budget",
    "edit_user_agent_queued_message",
    "move_user_agent_queued_message",
    "remove_user_agent_queued_message",
    "resume_user_agent_queue",
    "clear_user_agent_queue",
  ]) {
    assert.ok(names.includes(name), name);
  }

  for (const name of [
    "continue_agent_task",
    "send_agent_instruction",
    "get_agent_result",
    "cancel_agent_task",
    "retry_agent_task",
  ]) {
    assert.ok(!names.includes(name), name);
  }
});

test("a parent reads replies by long poll and sends follow-ups as messages", async () => {
  const { c, store, parent, start } = await setup();

  try {
    const t = await start("Review the parser");
    assert.equal(t.created_by, "parent");

    // Waits until the turn ends, then returns its complete messages.
    const first = await parent<Messages>("get_agent_messages", {
      task_id: t.id,
      wait_seconds: 5,
    });

    await until(() => store.get(t.id, "alice").status === "completed");

    const all = await parent<Messages>("get_agent_messages", {
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
    const quiet = await parent<Messages>("get_agent_messages", {
      task_id: t.id,
      after: all.next_cursor,
      wait_seconds: 0.2,
    });

    assert.deepEqual(quiet.messages, []);
    assert.equal(quiet.next_cursor, all.next_cursor);

    const sent = await parent<{ message_id: string; state: string }>(
      "send_agent_message",
      { task_id: t.id, message: "Check the lexer too" },
    );

    assert.equal(sent.state, "started");

    const next = await parent<Messages>("get_agent_messages", {
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
      "get_agent_task",
      { task_id: t.id },
    );

    assert.equal(task.turn, 2);
    assert.deepEqual(task.queue, []);
    assert.equal(task.reply.turn, 2);

    const [listed] = await parent<
      (Task & { reply: unknown; queued_messages: number })[]
    >("list_agent_tasks", {});

    assert.ok(listed);
    assert.deepEqual(listed.reply, task.reply);
    assert.equal(listed.queued_messages, 0);
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
      parent("send_agent_message", { task_id: t.id, message: "Steer" }),
      /waiting for input/,
    );

    const queued = await parent<{ message_id: string; state: string }>(
      "send_agent_message",
      { task_id: t.id, message: "Queued by parent", delivery: "queue" },
    );

    assert.equal(queued.state, "queued");

    const mine = await user<{ message_id: string }>("send_user_agent_message", {
      task_id: t.id,
      message: "Queued by user",
      delivery: "queue",
    });

    assert.deepEqual(
      store.get(t.id, "alice").queue.map((m) => m.from),
      ["parent", "user"],
    );

    assert.equal(
      (await parent<Messages>("get_agent_messages", { task_id: t.id }))
        .queued_messages,
      2,
    );

    await assert.rejects(
      parent("remove_agent_queued_message", {
        task_id: t.id,
        message_id: mine.message_id,
      }),
      /only messages it queued/,
    );

    await user("edit_user_agent_queued_message", {
      task_id: t.id,
      message_id: mine.message_id,
      message: "Edited",
    });

    await parent("remove_agent_queued_message", {
      task_id: t.id,
      message_id: queued.message_id,
    });

    assert.deepEqual(
      store.get(t.id, "alice").queue.map((m) => m.message),
      ["Edited"],
    );

    // Interrupt pauses the queue; resume starts it; clear empties it.
    await parent("interrupt_agent_task", { task_id: t.id });
    assert.equal(store.get(t.id, "alice").queue_paused, true);
    await user("resume_user_agent_queue", { task_id: t.id });
    await until(() => store.get(t.id, "alice").status === "completed");
    assert.equal(store.get(t.id, "alice").turn, 2);
    await user("clear_user_agent_queue", { task_id: t.id });

    // The user tools need a user interface.
    await assert.rejects(
      parent("send_user_agent_message", { task_id: t.id, message: "Hi" }),
      /user interface/,
    );

    await assert.rejects(
      parent("raise_user_agent_budget", {
        task_id: t.id,
        budget: { max_cost_usd: 6 },
      }),
      /user interface/,
    );

    const beforeBudgetApply = store.get(t.id, "alice");

    const updated = await user<{ budget: Task["budget"]; status: string }>(
      "raise_user_agent_budget",
      { task_id: t.id, budget: { max_cost_usd: 6 } },
    );

    assert.equal(updated.status, beforeBudgetApply.status);
    assert.equal(updated.budget.max_cost_usd, 6);
    assert.equal(store.get(t.id, "alice").turn, beforeBudgetApply.turn);
  } finally {
    await c.close();
  }
});

test("interrupt with send_pending sends the pending steers as the next turn", async () => {
  const { c, store, parent, start } = await setup();

  try {
    const t = await start("[late]");
    await until(() => store.get(t.id, "alice").status === "running");

    const steer = await parent<{ state: string }>("send_agent_message", {
      task_id: t.id,
      message: "Now this",
    });

    assert.equal(steer.state, "pending_steer");

    await parent("interrupt_agent_task", {
      task_id: t.id,
      send_pending: true,
    });

    await until(() => store.get(t.id, "alice").turn === 2);
    await until(() => store.get(t.id, "alice").status === "completed");
    assert.equal(store.get(t.id, "alice").queue_paused, undefined);
  } finally {
    await c.close();
  }
});

test("a reply streams as a draft the panel and parent can read, and only the finished message is stored", async () => {
  let finish!: () => void;
  const finished = new Promise<void>((resolve) => (finish = resolve));

  class Streaming extends FixtureProvider {
    override async run(c: RunContext) {
      c.delta("msg_live", "Half ");
      await new Promise((r) => setTimeout(r, 20));
      c.delta("msg_live", "a reply");
      await finished;

      c.emit("agent.message", {
        role: "assistant",
        text: "Half a reply, done.",
        raw_response: { message: { id: "msg_live" } },
      });

      return { reply: "Half a reply, done." };
    }
  }

  const { c, store, parent, user, start } = await setup(new Streaming());

  try {
    const t = await start("Write");
    await until(() => c.drafts.get(t.id)?.text === "Half ");

    // Waits for the draft to grow past what the panel has.
    const read = await user<{ draft: unknown; running: boolean }>(
      "wait_user_agent_updates",
      {
        after: store.revision("alice"),
        draft: { task_id: t.id, message_id: "msg_live", after_length: 5 },
        wait_ms: 5000,
      },
    );

    assert.deepEqual(read, {
      revision: store.revision("alice"),
      draft: { message_id: "msg_live", text: "Half a reply" },
      running: true,
    });

    // Task reads include it as a fallback.
    assert.deepEqual(
      (await parent<{ draft: unknown }>("get_agent_task", { task_id: t.id }))
        .draft,
      read.draft,
    );

    // A parent's read that waits out its time includes it.
    const messages = await parent<Messages & { draft?: unknown }>(
      "get_agent_messages",
      { task_id: t.id, after: store.lastEventId(t.id), wait_seconds: 0.1 },
    );

    assert.deepEqual(messages.messages, []);
    assert.deepEqual(messages.draft, read.draft);

    // Storing the message, which clears the draft, ends a waiting read.
    const before = store.revision("alice");

    const cleared = user<{ revision: string; draft: unknown }>(
      "wait_user_agent_updates",
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
        await user<{ draft: unknown }>("wait_user_agent_updates", {
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
    finish();
    await c.close();
  }
});

test("an update wait returns once the owner's revision changes, and a change ends its draft wait", async () => {
  let finish!: () => void;
  const finished = new Promise<void>((resolve) => (finish = resolve));

  class Streaming extends FixtureProvider {
    override async run(c: RunContext) {
      c.delta("msg_live", "Half ");
      await finished;

      return { reply: "Done." };
    }
  }

  const { c, store, user, start } = await setup(new Streaming());

  type Update = { revision: string; draft?: unknown; running?: boolean };

  const wait = (args: Record<string, unknown>) =>
    user<Update>("wait_user_agent_updates", args);

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
    const quiet = wait({ after: revision, wait_ms: 200 });
    store.save({ ...store.get(t.id, "alice"), id: "other", owner: "bob" });
    assert.deepEqual(await quiet, { revision });
    assert.ok(Date.now() - started >= 150);

    // The owner's change ends a draft wait, with the draft unchanged.
    const waiting = wait({
      after: revision,
      draft: { task_id: t.id, message_id: "msg_live", after_length: 5 },
      wait_ms: 5000,
    });

    await user("rename_user_agent_task", { task_id: t.id, title: "Renamed" });
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
      await wait({ after: ended, draft: { task_id: t.id }, wait_ms: 200 }),
      { revision: ended, draft: null, running: false },
    );

    assert.ok(Date.now() - idleStart >= 150);

    // Another owner's task has no draft to show.
    assert.deepEqual(
      await callTool(
        c,
        "bob",
        "wait_user_agent_updates",
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

test("parent message relay tools require app authority and preserve conversation scope", async () => {
  const { c, store, parent, user, start } = await setup();

  try {
    const created = await start("Review");
    const task = store.get(created.id, "alice");
    task.conversation_id = "parent-chat";
    store.save(task);
    store.event(task, "parent.message", { text: "Worker update" });

    await assert.rejects(
      parent("claim_user_agent_parent_message", {
        conversation_id: "parent-chat",
      }),
      /User tools require a user interface/,
    );

    assert.equal(
      await user("claim_user_agent_parent_message", {
        conversation_id: "other-chat",
      }),
      null,
    );

    const claimed = await user<{ task_id: string; attempt_id: number }>(
      "claim_user_agent_parent_message",
      { conversation_id: "parent-chat" },
    );

    assert.equal(claimed.task_id, task.id);

    await assert.rejects(
      parent("record_user_agent_parent_delivery", {
        task_id: task.id,
        attempt_id: claimed.attempt_id,
        conversation_id: "parent-chat",
        delivered: true,
      }),
      /User tools require a user interface/,
    );

    await user("record_user_agent_parent_delivery", {
      task_id: task.id,
      attempt_id: claimed.attempt_id,
      conversation_id: "parent-chat",
      delivered: true,
    });

    assert.equal(
      await user("claim_user_agent_parent_message", {
        conversation_id: "parent-chat",
      }),
      null,
    );
  } finally {
    await c.close();
  }
});

test("acknowledgement after claim records a skipped delivery through app tools", async () => {
  const { c, store, parent, user, start } = await setup();

  try {
    const created = await start("Review");
    await until(() => store.get(created.id, "alice").status === "completed");
    const task = store.get(created.id, "alice");
    task.conversation_id = "parent-chat";
    store.save(task);
    store.event(task, "parent.message", { text: "Worker update" });

    const claimed = await user<{
      task_id: string;
      message_id: string;
      attempt_id: number;
    }>("claim_user_agent_parent_message", { conversation_id: "parent-chat" });

    await parent("ack_agent_message", {
      task_id: task.id,
      message_id: claimed.message_id,
    });

    const report = await user<{ message: { acknowledged?: true } }>(
      "get_agent_message",
      { task_id: task.id, message_id: claimed.message_id },
    );

    expect(report.message.acknowledged).toBe(true);

    const result = await user("record_user_agent_parent_delivery", {
      task_id: task.id,
      attempt_id: claimed.attempt_id,
      conversation_id: "parent-chat",
      delivered: false,
      skipped: "acknowledged",
    });

    expect(result).toEqual({ recorded: true });

    expect(
      store.eventsOfTypes(task.id, ["parent.message_delivery"]),
    ).toMatchObject([
      {
        data: {
          attempt_id: claimed.attempt_id,
          delivered: false,
          skipped: "acknowledged",
        },
      },
    ]);
  } finally {
    await c.close();
  }
});

test.each(["poll-first", "notification-first"])(
  "explicit reports share an ID across polling and notifications (%s)",
  async (arrivalOrder) => {
    const { c, store, parent, user, start } = await setup();

    try {
      const created = await start("Review");
      await until(() => store.get(created.id, "alice").status === "completed");
      const task = store.get(created.id, "alice");
      task.conversation_id = "parent-chat";
      store.save(task);
      const before = store.lastEventId(task.id);

      const report = store.event(task, "parent.message", {
        text: "An explicit worker report.",
      });

      const id = `parent_${report.id}`;

      const poll = () =>
        parent<Messages & { messages: { parent_message?: true }[] }>(
          "get_agent_messages",
          { task_id: task.id, after: before },
        );

      const notify = () =>
        user<{ task_id: string; message_id: string; text: string }>(
          "claim_user_agent_parent_message",
          { conversation_id: "parent-chat" },
        );

      const first =
        arrivalOrder === "poll-first" ? await poll() : await notify();

      const second =
        arrivalOrder === "poll-first" ? await notify() : await poll();

      const polled = (
        arrivalOrder === "poll-first" ? first : second
      ) as Awaited<ReturnType<typeof poll>>;

      const notification = (
        arrivalOrder === "poll-first" ? second : first
      ) as Awaited<ReturnType<typeof notify>>;

      expect(polled.messages).toEqual([
        expect.objectContaining({
          id,
          text: "An explicit worker report.",
          from: "worker",
          parent_message: true,
        }),
      ]);

      expect(notification).toMatchObject({ task_id: task.id, message_id: id });
      expect(notification.text).toContain("already processed");
      expect(notification.text).toContain("get_agent_message");
      expect(notification.text).not.toContain("An explicit worker report.");

      // Advancing the polling cursor does not remove the stored report's lookup route.
      const quiet = await parent<Messages>("get_agent_messages", {
        task_id: task.id,
        after: polled.next_cursor,
      });

      expect(quiet.messages).toEqual([]);

      const exact = await parent<{ message: unknown }>("get_agent_message", {
        task_id: task.id,
        message_id: id,
      });

      expect(exact.message).toEqual(polled.messages[0]);

      expect(
        store.eventsOfTypes(task.id, ["parent.message_acknowledged"]),
      ).toEqual([]);

      const acknowledged = await parent("ack_agent_message", {
        task_id: task.id,
        message_id: id,
      });

      expect(acknowledged).toEqual({
        task_id: task.id,
        message_id: id,
        acknowledged: true,
        already_acknowledged: false,
      });

      const afterAck = await parent<{ message: unknown }>("get_agent_message", {
        task_id: task.id,
        message_id: id,
      });

      expect(afterAck.message).toEqual({
        ...polled.messages[0],
        acknowledged: true,
      });

      const replay = await parent<Messages>("get_agent_messages", {
        task_id: task.id,
        after: 0,
      });

      expect(replay.messages.find((message) => message.id === id)).toEqual(
        afterAck.message,
      );

      const afterCursor = await parent<Messages>("get_agent_messages", {
        task_id: task.id,
        after: polled.next_cursor,
      });

      expect(afterCursor.messages).toEqual([]);

      expect(afterCursor.next_cursor).toBeGreaterThanOrEqual(
        polled.next_cursor,
      );

      await expect(
        parent("ack_agent_message", { task_id: task.id, message_id: id }),
      ).resolves.toMatchObject({ already_acknowledged: true });

      await expect(
        callTool(
          c,
          "bob",
          "ack_agent_message",
          { task_id: task.id, message_id: id },
          "parent",
        ),
      ).rejects.toThrow(/Task not found/);

      await expect(
        parent("get_agent_message", {
          task_id: task.id,
          message_id: "parent_missing",
        }),
      ).rejects.toThrow(/Message not found/);

      await expect(
        callTool(
          c,
          "bob",
          "get_agent_message",
          { task_id: task.id, message_id: id },
          "parent",
        ),
      ).rejects.toThrow(/Task not found/);
    } finally {
      await c.close();
    }
  },
);

test("explicit parent reports wake an outstanding conversation long poll", async () => {
  let ready!: (context: RunContext) => void;

  const context = new Promise<RunContext>((resolve) => {
    ready = resolve;
  });

  let finish!: () => void;

  const finished = new Promise<void>((resolve) => {
    finish = resolve;
  });

  class Reporting extends FixtureProvider {
    override async run(context: RunContext) {
      ready(context);
      await finished;

      return { reply: "Done" };
    }
  }

  const { c, store, parent, start } = await setup(new Reporting());

  try {
    const task = await start("Report progress");
    const worker = await context;

    const pending = parent<
      Messages & { messages: { parent_message?: true }[] }
    >("get_agent_messages", {
      task_id: task.id,
      after: store.lastEventId(task.id),
      wait_seconds: 5,
    });

    // The tool installs its listener before reading, so a report can arrive immediately.
    const report = store.event(worker.task, "parent.message", {
      text: "Progress from the worker",
    });

    const result = await pending;
    expect(result.running).toBe(true);

    expect(result.messages).toEqual([
      expect.objectContaining({
        id: `parent_${report.id}`,
        text: "Progress from the worker",
        parent_message: true,
      }),
    ]);

    expect(result.next_cursor).toBeGreaterThanOrEqual(report.id);
  } finally {
    finish();
    await c.close();
  }
});

test("reading reports leaves them available for host delivery, while model acknowledgment suppresses unclaimed reports", async () => {
  const { c, store, parent, user, start } = await setup();

  try {
    const created = await start("Review");
    await until(() => store.get(created.id, "alice").status === "completed");
    const task = store.get(created.id, "alice");
    task.conversation_id = "parent-chat";
    store.save(task);
    const first = store.event(task, "parent.message", { text: "Read alone" });

    const second = store.event(task, "parent.message", {
      text: "Processed and acknowledged",
    });

    await parent("get_agent_messages", { task_id: task.id });

    await parent("get_agent_message", {
      task_id: task.id,
      message_id: `parent_${first.id}`,
    });

    expect(
      store.eventsOfTypes(task.id, ["parent.message_acknowledged"]),
    ).toEqual([]);

    await parent("ack_agent_message", {
      task_id: task.id,
      message_id: `parent_${second.id}`,
    });

    const notification = await user<{ message_id: string }>(
      "claim_user_agent_parent_message",
      { conversation_id: "parent-chat" },
    );

    expect(notification.message_id).toBe(`parent_${first.id}`);

    expect(
      await user("claim_user_agent_parent_message", {
        conversation_id: "parent-chat",
      }),
    ).toBeNull();

    await expect(
      parent("ack_agent_message", { task_id: task.id, message_id: "request" }),
    ).rejects.toThrow();

    await expect(
      parent("ack_agent_message", {
        task_id: task.id,
        message_id: "parent_999999",
      }),
    ).rejects.toThrow();

    expect(
      store.eventsOfTypes(task.id, ["parent.message_acknowledged"]),
    ).toHaveLength(1);
  } finally {
    await c.close();
  }
});

test("parent message tools publish the canonical polling and processing protocol", () => {
  const tools = definitions({} as Control, "alice");

  expect(tools.get_agent_messages.description).toContain(
    PARENT_DELEGATION_PROTOCOL,
  );

  expect(tools.get_agent_message.description).toContain(PARENT_REPORT_PROTOCOL);

  expect(tools.ack_agent_message.description).toContain(
    "after you successfully process",
  );
});

test("the panel records what the user has seen, and lists show what they haven't", async () => {
  const { c, store, parent, user, start } = await setup();

  try {
    const t = await start("Review the parser");
    await until(() => store.get(t.id, "alice").status === "completed");

    const listed = async () =>
      (
        await parent<ListedTask[]>("list_agent_tasks", {
          conversation_id: null,
        })
      ).find((task) => task.id === t.id)?.unseen;

    assert.equal(await listed(), true);

    // A task never seen is new from its start.
    const [never] = await parent<ListedTask[]>("list_agent_tasks", {
      conversation_id: null,
    });

    assert.equal(never?.seen_through, 0);

    // Chat's cursor covers the reply and the turn's end.
    const chat = await user<{ next_cursor: number }>("get_user_agent_chat", {
      task_id: t.id,
    });

    assert.deepEqual(
      await user("mark_user_agent_task_seen", {
        task_id: t.id,
        seen: true,
        through: chat.next_cursor,
      }),
      { unseen: false, through: chat.next_cursor },
    );

    assert.equal(await listed(), undefined);

    assert.deepEqual(
      await user("mark_user_agent_task_seen", { task_id: t.id, seen: false }),
      { unseen: true, through: chat.next_cursor },
    );

    assert.deepEqual(
      await user("mark_user_agent_tasks_seen", { task_ids: [t.id] }),
      { task_ids: [t.id] },
    );

    assert.equal(await listed(), undefined);

    // Marking from the turn's end leaves that end unseen.
    assert.deepEqual(
      await user("mark_user_agent_task_unseen_from", {
        task_id: t.id,
        event_id: chat.next_cursor,
      }),
      { unseen: true, through: chat.next_cursor - 1 },
    );

    // Only the user marks tasks, and only their own.
    await assert.rejects(
      parent("mark_user_agent_task_seen", { task_id: t.id, seen: true }),
      /User tools require a user interface/,
    );

    await assert.rejects(
      parent("mark_user_agent_task_unseen_from", {
        task_id: t.id,
        event_id: chat.next_cursor,
      }),
      /User tools require a user interface/,
    );

    await assert.rejects(
      callTool(
        c,
        "bob",
        "mark_user_agent_task_unseen_from",
        { task_id: t.id, event_id: chat.next_cursor },
        "user",
      ),
      /Task not found/,
    );

    await assert.rejects(
      callTool(
        c,
        "bob",
        "mark_user_agent_tasks_seen",
        { task_ids: [t.id] },
        "user",
      ),
      /Task not found/,
    );
  } finally {
    await c.close();
  }
});

test("the panel's opening tasks carry their seen state", async () => {
  const { c, store, start } = await setup();

  try {
    const t = await start("Review the parser");
    await until(() => store.get(t.id, "alice").status === "completed");

    // A reload opens the panel from these tasks, before its list read returns.
    const [opened] = openingTasks(c, "alice").filter(
      (task) => task.id === t.id,
    );

    assert.equal(opened?.unseen, true);
    assert.equal(opened?.seen_through, 0);
  } finally {
    await c.close();
  }
});
