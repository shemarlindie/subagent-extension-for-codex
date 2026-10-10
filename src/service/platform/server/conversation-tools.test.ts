import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { test } from "vitest";

import { FixtureProvider } from "../../../../dev/service/fixture-provider.js";
import type { Task } from "../../../shared/tasks/model.js";
import type { Provider, RunContext } from "../../features/providers/types.js";
import { Control } from "../../features/tasks/runtime/control.js";
import { Store } from "../../features/tasks/storage/store.js";
import { Workspaces } from "../../features/workspaces/workspace.js";
import { callTool, definitions } from "./tools.js";

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
    repo,
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

test("the old one-shot tools are gone and the conversation tools replace them", () => {
  const names = Object.keys(definitions({} as Control, "alice"));

  for (const name of [
    "send_agent_message",
    "get_agent_messages",
    "remove_agent_queued_message",
    "send_user_agent_message",
    "raise_user_agent_budget",
    "edit_user_agent_queued_message",
    "remove_user_agent_queued_message",
    "resume_user_agent_queue",
    "clear_user_agent_queue",
  ])
    assert.ok(names.includes(name), name);

  for (const name of [
    "continue_agent_task",
    "send_agent_instruction",
    "get_agent_result",
    "cancel_agent_task",
    "retry_agent_task",
  ])
    assert.ok(!names.includes(name), name);
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
    async run(c: RunContext) {
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
      "get_user_agent_draft",
      { task_id: t.id, message_id: "msg_live", after_length: 5, wait_ms: 5000 },
    );

    assert.deepEqual(read, {
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

    // Storing the message clears the draft, which a waiting read reports.
    const cleared = user<{ draft: unknown }>("get_user_agent_draft", {
      task_id: t.id,
      message_id: "msg_live",
      after_length: 12,
      wait_ms: 5000,
    });

    finish();
    assert.equal((await cleared).draft, null);
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
