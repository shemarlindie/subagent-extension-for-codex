import { test } from "vitest";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { Store } from "../src/core/store.js";
import { Workspaces } from "../src/core/workspace.js";
import { Control } from "../src/core/control.js";
import {
  approvalModes,
  type Result,
  type Task,
  type RunContext,
} from "../src/core/model.js";
import { FixtureProvider } from "../src/providers/fixture.js";
import { callTool } from "../src/server/tools.js";

const request = {
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

  async run(ctx: RunContext): Promise<Result> {
    const response = await ctx.input(
      this.tool,
      { command: "pwd", question: "Which approach?" },
      ctx.signal,
    );

    return {
      summary: JSON.stringify(response),
      findings: [],
      evidence: [],
      changes: [],
      tests: [],
      recommendations: [],
    };
  }
}

async function setup(provider = new PermissionProvider()) {
  const dir = await mkdtemp(join(tmpdir(), "approval-test-"));
  const repo = join(dir, "repo");
  await mkdir(repo);
  execFileSync("git", ["init", "-q", repo]);
  await writeFile(join(repo, "README.md"), "fixture\n");
  execFileSync("git", ["-C", repo, "add", "."]);

  execFileSync("git", [
    "-C",
    repo,
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.invalid",
    "commit",
    "-qm",
    "initial",
  ]);

  const store = new Store(join(dir, "tasks.sqlite"));

  const c = new Control(
    store,
    new Workspaces(join(dir, "worktrees"), [repo]),
    new Map([[provider.id, provider]]),
    repo,
    2,
  );

  return {
    c,
    store,
    cleanup: async () => {
      await c.close();
      await rm(dir, { recursive: true, force: true });
    },
  };
}

test("ask_user blocks parent approval and accepts an owner user decision", async () => {
  const { c, store, cleanup } = await setup();

  try {
    const task = (await callTool(
      c,
      "alice",
      "start_agent_task",
      request,
    )) as Task;

    await until(() => !!store.get(task.id, "alice").pending_input);
    const pending = store.get(task.id, "alice").pending_input!;

    const response = {
      task_id: task.id,
      request_id: pending.id,
      approved: true,
    };

    for (const approved of [true, false]) {
      await assert.rejects(
        callTool(c, "alice", "submit_agent_input", { ...response, approved }),
        /requires user approval/,
      );
    }

    assert.equal(store.get(task.id, "alice").pending_input?.id, pending.id);

    await assert.rejects(
      callTool(c, "bob", "submit_user_agent_input", response, "user"),
    );

    await callTool(c, "alice", "submit_user_agent_input", response, "user");
    await until(() => store.get(task.id, "alice").status === "completed");

    assert.equal(
      JSON.parse(store.get(task.id, "alice").result!.summary).approved,
      true,
    );

    assert.throws(() => c.input("alice", task.id, pending.id, true), /stale/);
  } finally {
    await cleanup();
  }
});

test("parent_agent permits parent decisions only after user configuration", async () => {
  const { c, store, cleanup } = await setup();

  try {
    c.settings.update(
      "alice",
      { set: { default_approval_mode: "parent_agent" } },
      "user",
    );

    const task = (await callTool(
      c,
      "alice",
      "start_agent_task",
      request,
    )) as Task;

    assert.equal(task.approval_mode, "parent_agent");
    await until(() => !!store.get(task.id, "alice").pending_input);

    await callTool(c, "alice", "submit_agent_input", {
      task_id: task.id,
      request_id: store.get(task.id, "alice").pending_input!.id,
      approved: true,
    });

    await until(() => store.get(task.id, "alice").status === "completed");

    assert.equal(
      JSON.parse(store.get(task.id, "alice").result!.summary).approved,
      true,
    );
  } finally {
    await cleanup();
  }
});

test("parent cannot raise approval authority or mutate approval settings", async () => {
  const { c, store, cleanup } = await setup();

  try {
    for (const mode of ["parent_agent", "auto_approve"]) {
      await assert.rejects(
        callTool(c, "alice", "start_agent_task", {
          ...request,
          approval_mode: mode,
        }),
        /exceeds/,
      );

      await assert.rejects(
        callTool(c, "alice", "update_agent_settings", {
          set: { default_approval_mode: mode },
        }),
        /require a user decision/,
      );
    }

    assert.equal(store.all().length, 0);
    assert.equal(c.settings.values("alice").default_approval_mode, "ask_user");

    await callTool(c, "alice", "update_agent_settings", {
      set: { default_model: "Updated" },
    });

    assert.equal(c.settings.values("alice").default_model, "Updated");
  } finally {
    await cleanup();
  }
});

test("model calls cannot use any user-only approval tool", async () => {
  const { c, cleanup } = await setup();

  try {
    for (const name of [
      "start_user_agent_task",
      "submit_user_agent_input",
      "update_user_agent_settings",
    ]) {
      await assert.rejects(
        callTool(c, "alice", name, {}),
        /User tools require a user interface/,
      );
    }

    await callTool(
      c,
      "alice",
      "update_user_agent_settings",
      { set: { default_approval_mode: "auto_approve" } },
      "user",
    );

    assert.equal(
      c.settings.values("alice").default_approval_mode,
      "auto_approve",
    );
  } finally {
    await cleanup();
  }
});

for (const mode of approvalModes) {
  test(`parent tasks inherit the user's ${mode} default`, async () => {
    const { c, store, cleanup } = await setup();

    try {
      c.settings.update(
        "alice",
        { set: { default_approval_mode: mode } },
        "user",
      );

      const task = (await callTool(
        c,
        "alice",
        "start_agent_task",
        request,
      )) as Task;

      assert.equal(task.approval_mode, mode);

      if (mode === "auto_approve" || mode === "deny") {
        await until(() => store.get(task.id, "alice").status === "completed");

        assert.equal(
          JSON.parse(store.get(task.id, "alice").result!.summary).approved,
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
    const { c, store, cleanup } = await setup(
      new PermissionProvider("AskUserQuestion"),
    );

    try {
      const task = await c.start("alice", { ...request, approval_mode: mode });
      await until(() => !!store.get(task.id, "alice").pending_input);

      assert.equal(
        store.get(task.id, "alice").waiting_reason,
        "waiting_for_user",
      );

      await callTool(c, "alice", "submit_agent_input", {
        task_id: task.id,
        request_id: store.get(task.id, "alice").pending_input!.id,
        approved: true,
        input: { answer: "Option A" },
      });

      await until(() => store.get(task.id, "alice").status === "completed");

      assert.deepEqual(
        JSON.parse(store.get(task.id, "alice").result!.summary).input,
        { answer: "Option A" },
      );
    } finally {
      await cleanup();
    }
  });
}

test("interruption invalidates pending permission IDs across continuation", async () => {
  const { c, store, cleanup } = await setup();

  try {
    const task = await c.start("alice", request);
    await until(() => !!store.get(task.id, "alice").pending_input);
    const oldId = store.get(task.id, "alice").pending_input!.id;
    await c.stop("alice", task.id, "interrupted");
    assert.throws(() => c.input("alice", task.id, oldId, true), /stale/);
    await c.continue("alice", task.id);
    await until(() => !!store.get(task.id, "alice").pending_input);
    const currentId = store.get(task.id, "alice").pending_input!.id;
    assert.notEqual(currentId, oldId);
    assert.throws(() => c.input("alice", task.id, oldId, true), /stale/);
    c.input("alice", task.id, currentId, false);
    await until(() => store.get(task.id, "alice").status === "completed");

    assert.equal(
      JSON.parse(store.get(task.id, "alice").result!.summary).approved,
      false,
    );
  } finally {
    await cleanup();
  }
});

test("parents can restrict approval authority but cannot escalate any saved mode", async () => {
  const { c, store, cleanup } = await setup();

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
        { set: { default_approval_mode: ordered[defaultIndex] } },
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
            callTool(c, "alice", "start_agent_task", {
              ...request,
              approval_mode,
            }),
            /exceeds/,
          );

          assert.equal(store.all().length, count);
        } else {
          const task = (await callTool(c, "alice", "start_agent_task", {
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
