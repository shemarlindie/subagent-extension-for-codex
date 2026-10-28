import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { test } from "vitest";

import { FixtureProvider } from "../../../../../dev/service/fixture-provider.js";
import { copyCommittedRepository } from "../../../../../tests/support/repository-test-harness.js";
import { approvalModes, type Task } from "../../../../shared/tasks/model.js";
import { callTool } from "../../../platform/server/tools.js";
import { type RunContext, type TurnOutput } from "../../providers/types.js";
import { Workspaces } from "../../workspaces/workspace.js";
import { Control } from "../runtime/control.js";
import { Store } from "../storage/store.js";

const baseRequest = {
  provider: "fixture",
  description: "Check approval",
  workspace_strategy: "current_repo",
};

async function until(predicate: () => boolean) {
  for (let i = 0; i < 300; i++) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  throw new Error("Timed out waiting for task");
}

class PermissionProvider extends FixtureProvider {
  constructor(private readonly tool = "Bash") {
    super();
  }

  override async run(ctx: RunContext): Promise<TurnOutput> {
    const response = await ctx.input(
      this.tool,
      { command: "pwd", question: "Which approach?" },
      ctx.signal,
    );

    return {
      reply: JSON.stringify(response),
    };
  }
}

async function setup(provider = new PermissionProvider()) {
  const dir = await mkdtemp(join(tmpdir(), "approval-test-"));
  const repo = join(dir, "repo");
  await copyCommittedRepository(repo);

  const store = new Store(join(dir, "tasks.sqlite"));

  const c = new Control(
    store,
    new Workspaces(join(dir, "worktrees"), [repo]),
    new Map([[provider.id, provider]]),
    2,
  );

  return {
    c,
    store,
    request: { ...baseRequest, repository: repo },
    cleanup: async () => {
      await c.close();
      await rm(dir, { recursive: true, force: true });
    },
  };
}

for (const mode of approvalModes) {
  test(`parent tasks inherit the user's ${mode} default`, async () => {
    const { c, store, request, cleanup } = await setup();

    try {
      c.settings.update(
        "alice",
        { set: { approvals: { execution_mode: mode } } },
        "user",
      );

      const task = (await callTool(c, "alice", "start_task", request)) as Task;

      assert.equal(task.approval_mode, mode);

      if (mode === "auto_approve" || mode === "deny") {
        await until(() => store.get(task.id, "alice").status === "completed");

        assert.equal(
          JSON.parse(
            String(store.latestEvent(task.id, "agent.reply")!.data.text),
          ).approved,
          mode === "auto_approve",
        );

        assert.equal(store.get(task.id, "alice").pending_input, undefined);
        const events = store.events(task.id, "alice", 0);

        assert.equal(
          events.some((e) => e.type === "agent.input_required"),
          false,
        );

        assert.equal(
          events.some((e) => e.type === "agent.permission_decided"),
          true,
        );
      } else {
        await until(() => !!store.get(task.id, "alice").pending_input);

        assert.equal(
          store.get(task.id, "alice").waiting_reason,
          "waiting_for_permission",
        );
      }
    } finally {
      await cleanup();
    }
  });
}

for (const mode of ["auto_approve", "deny"] as const) {
  test(`${mode} still waits for question input and permits parent answers`, async () => {
    const { c, store, request, cleanup } = await setup(
      new PermissionProvider("AskUserQuestion"),
    );

    try {
      const task = await c.start("alice", { ...request, approval_mode: mode });
      await until(() => !!store.get(task.id, "alice").pending_input);

      assert.equal(
        store.get(task.id, "alice").waiting_reason,
        "waiting_for_user",
      );

      await callTool(c, "alice", "submit_input", {
        task_id: task.id,
        request_id: store.get(task.id, "alice").pending_input!.id,
        approved: true,
        input: { answer: "Option A" },
      });

      await until(() => store.get(task.id, "alice").status === "completed");

      assert.deepEqual(
        JSON.parse(String(store.latestEvent(task.id, "agent.reply")!.data.text))
          .input,
        { answer: "Option A" },
      );
    } finally {
      await cleanup();
    }
  });
}

test("interruption invalidates pending permission IDs across continuation", async () => {
  const { c, store, request, cleanup } = await setup();

  try {
    const task = await c.start("alice", request);
    await until(() => !!store.get(task.id, "alice").pending_input);
    const oldId = store.get(task.id, "alice").pending_input!.id;
    await c.interrupt("alice", task.id);
    assert.throws(() => c.input("alice", task.id, oldId, true), /stale/);
    await c.send("alice", task.id, "Continue", "user");
    await until(() => !!store.get(task.id, "alice").pending_input);
    const currentId = store.get(task.id, "alice").pending_input!.id;
    assert.notEqual(currentId, oldId);
    assert.throws(() => c.input("alice", task.id, oldId, true), /stale/);
    c.input("alice", task.id, currentId, false);
    await until(() => store.get(task.id, "alice").status === "completed");

    assert.equal(
      JSON.parse(String(store.latestEvent(task.id, "agent.reply")!.data.text))
        .approved,
      false,
    );
  } finally {
    await cleanup();
  }
});

test("parents can restrict approval authority but cannot escalate any saved mode", async () => {
  const { c, store, request, cleanup } = await setup();

  try {
    const ordered = [
      "deny",
      "ask_user",
      "parent_agent",
      "auto_approve",
    ] as const;

    for (let defaultIndex = 0; defaultIndex < ordered.length; defaultIndex++) {
      c.settings.update(
        "alice",
        { set: { approvals: { execution_mode: ordered[defaultIndex] } } },
        "user",
      );

      for (
        let requestedIndex = 0;
        requestedIndex < ordered.length;
        requestedIndex++
      ) {
        const approval_mode = ordered[requestedIndex];

        if (requestedIndex > defaultIndex) {
          const count = store.all().length;

          await assert.rejects(
            callTool(c, "alice", "start_task", {
              ...request,
              approval_mode,
            }),
            /exceeds/,
          );

          assert.equal(store.all().length, count);
        } else {
          const task = (await callTool(c, "alice", "start_task", {
            ...request,
            approval_mode,
          })) as Task;

          assert.equal(task.approval_mode, approval_mode);

          if (approval_mode === "deny" || approval_mode === "auto_approve") {
            await until(
              () => store.get(task.id, "alice").status === "completed",
            );
          } else {
            await until(() => !!store.get(task.id, "alice").pending_input);

            c.input(
              "alice",
              task.id,
              store.get(task.id, "alice").pending_input!.id,
              false,
              undefined,
              undefined,
              approval_mode === "parent_agent" ? "parent" : "user",
            );

            await until(
              () => store.get(task.id, "alice").status === "completed",
            );
          }
        }
      }
    }
  } finally {
    await cleanup();
  }
});
