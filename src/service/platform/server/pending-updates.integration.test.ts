import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, onTestFinished, test } from "vitest";

import { fixtureProvider } from "../../../../dev/service/fixture-provider-test-helpers.js";
import type { PendingTaskUpdates } from "../../../shared/tasks/conversation/parent-updates.js";
import { startSchema, type Task } from "../../../shared/tasks/model.js";
import { Control } from "../../features/tasks/runtime/control.js";
import { Store } from "../../features/tasks/storage/store.js";
import { Workspaces } from "../../features/workspaces/workspace.js";
import { callTool } from "./tools.js";

async function setup() {
  const dir = await mkdtemp(join(tmpdir(), "pending-updates-"));
  onTestFinished(() => rm(dir, { recursive: true, force: true }));
  const store = new Store(":memory:");

  const c = new Control(
    store,
    new Workspaces(join(dir, "worktrees"), []),
    new Map([["fixture", fixtureProvider()]]),
  );

  onTestFinished(() => c.close());

  const save = (id: string, patch: Partial<Task> = {}) => {
    const task: Task = {
      ...startSchema.parse({ repository: "/repo", description: "Review" }),
      provider: "fixture",
      title: `Task ${id}`,
      id,
      owner: "alice",
      conversation_id: "chat",
      status: "completed",
      created_at: "now",
      updated_at: "now",
      instructions: [],
      created_by: "parent",
      instructions_sent: 0,
      pending_steers: [],
      queue: [],
      turn: 1,
      runtime_ms: 0,
      ...patch,
    };

    store.save(task);

    return task;
  };

  const parent = (name: string, args: Record<string, unknown>) =>
    callTool(c, "alice", name, args, "parent");

  const user = (name: string, args: Record<string, unknown>) =>
    callTool(c, "alice", name, args, "user");

  const pending = async () =>
    (
      (await user("app_list_pending_updates", {
        conversation_id: "chat",
      })) as { tasks: PendingTaskUpdates[] }
    ).tasks;

  const ids = async () =>
    (await pending()).flatMap((t) => t.updates.map((u) => u.event_id));

  return { store, save, parent, user, pending, ids };
}

test("message reads record the updates they return as seen", async () => {
  const { store, save, parent, ids } = await setup();
  const t = save("one");
  const first = store.event(t, "agent.reply", { text: "First", turn: 1 });
  const second = store.event(t, "agent.reply", { text: "Second", turn: 2 });

  expect(await ids()).toEqual([second.id, first.id]);

  await parent("get_message", {
    task_id: t.id,
    message_id: `reply_${first.id}`,
  });

  expect(await ids()).toEqual([second.id]);

  // A read after the newest update returns and records nothing.
  await parent("list_messages", { task_id: t.id, after: second.id });
  expect(await ids()).toEqual([second.id]);

  await parent("list_messages", { task_id: t.id, after: first.id });
  expect(await ids()).toEqual([]);
});

test("pending updates cover replies, failures, budget stops and routed requests", async () => {
  const { store, save, user, pending } = await setup();
  const failed = save("failed");
  store.event(failed, "task.failed", { error: "Tests failed" });
  store.event(failed, "task.failed", { error: "Budget exceeded: $1.00" });

  const question = {
    id: "q",
    tool: "AskUserQuestion",
    kind: "question" as const,
    input: { questions: [{ question: "Which parser?" }] },
  };

  const asking = save("asking", { status: "waiting", pending_input: question });
  store.event(asking, "agent.input_required", { request: question });

  const permission = {
    id: "p",
    tool: "Bash",
    kind: "permission" as const,
    presentation: { description: "Run the tests", approveLabel: "Run" },
    input: {},
  };

  const userDecides = save("user-decides", {
    status: "waiting",
    pending_input: permission,
  });

  store.event(userDecides, "agent.input_required", { request: permission });

  const parentDecides = save("parent-decides", {
    status: "waiting",
    approval_mode: "parent_agent",
    pending_input: permission,
  });

  store.event(parentDecides, "agent.input_required", { request: permission });

  // An answered request, an interrupted turn and another conversation don't count.
  const answered = save("answered");
  store.event(answered, "agent.input_required", { request: question });
  store.event(answered, "task.interrupted", {});

  store.event(save("elsewhere", { conversation_id: "other" }), "agent.reply", {
    text: "Elsewhere",
    turn: 1,
  });

  // Archived and deleted tasks leave the list.
  const archived = save("archived");
  store.event(archived, "agent.reply", { text: "Archived", turn: 1 });

  await user("app_set_tasks_archived", {
    task_ids: [archived.id],
    archived: true,
  });

  const deleted = save("deleted");
  store.event(deleted, "agent.reply", { text: "Deleted", turn: 1 });
  store.delete(deleted.id, "alice");

  expect(
    (await pending()).map((t) => [
      t.task_id,
      t.updates.map((u) => [u.kind, u.text]),
    ]),
  ).toEqual([
    ["parent-decides", [["request", "Run the tests"]]],
    ["asking", [["request", "Which parser?"]]],
    [
      "failed",
      [
        ["budget", "Budget exceeded: $1.00"],
        ["failed", "Tests failed"],
      ],
    ],
  ]);
});

test("mark seen records only the chosen updates of the owner", async () => {
  const { store, save, user, ids } = await setup();
  const t = save("one");
  const first = store.event(t, "agent.reply", { text: "First", turn: 1 });
  const second = store.event(t, "agent.reply", { text: "Second", turn: 2 });
  const theirs = save("theirs", { owner: "bob" });

  const foreign = store.event(theirs, "agent.reply", {
    text: "Bob's",
    turn: 1,
  });

  await user("app_mark_updates_seen", { event_ids: [first.id, foreign.id] });

  expect(await ids()).toEqual([second.id]);

  expect(
    store.database.client
      .prepare("SELECT event_id FROM task_parent_seen")
      .all(),
  ).toEqual([{ event_id: first.id }]);
});
